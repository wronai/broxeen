#!/usr/bin/env python3
"""
Smart Motion Detection Pipeline for Broxeen — Edge Computing (RPi5 / N5105)
=============================================================================
Philosophy: send to LLM ONLY what changed — cropped object, max 500px,
            locally classified from 10 classes.

Pipeline:
  RTSP → every N frames → MOG2 BackgroundSubtractor
      → contours → crop + resize ≤500px
      → YOLOv8n nano (local, <40ms RPi / <5ms N5105)
      → confidence ≥ threshold? → save SQLite + thumbnail
      → confidence < threshold? → send crop to LLM (Claude Haiku)
          → update SQLite with LLM verification

Usage:
  python3 motion_pipeline.py --rtsp rtsp://user:pass@192.168.1.100:554/stream \
                              --camera-id cam01 \
                              --db /path/to/detections.db \
                              [--platform rpi5|n5105|auto] \
                              [--process-every 5] \
                              [--min-area 2000] \
                              [--max-area 200000] \
                              [--var-threshold 50] \
                              [--bg-history 500] \
                              [--llm-threshold 0.6] \
                              [--cooldown 10] \
                              [--max-crop 500] \
                              [--llm-model anthropic/claude-haiku-4-5] \
                              [--api-key sk-or-v1-...] \
                              [--night-mode] \
                              [--stats-interval 60] \
                              [--output-events] \
                              [--verbose]

Environment variables:
  OPENROUTER_API_KEY  — API key for LLM verification (OpenRouter)
  ANTHROPIC_API_KEY   — Direct Anthropic API key (alternative)
"""

import argparse
import base64
import io
import json
import logging
import os
import signal
import sqlite3
import sys
import time
from datetime import datetime
from typing import Optional

import cv2
import numpy as np

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
except ImportError:
    YOLO_AVAILABLE = False

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

# ── 10-class mapping ─────────────────────────────────────────────────────────

CLASSES_10 = [
    "person", "car", "truck", "bus", "motorcycle",
    "bicycle", "dog", "cat", "bird", "unknown",
]

YOLO_TO_10_CLASSES = {
    "person": "person",
    "car": "car",
    "truck": "truck",
    "bus": "bus",
    "motorcycle": "motorcycle",
    "bicycle": "bicycle",
    "dog": "dog",
    "cat": "cat",
    "bird": "bird",
}

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("motion_pipeline")


# ── Database ──────────────────────────────────────────────────────────────────

def init_db(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS detections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            camera_id TEXT NOT NULL,
            label TEXT NOT NULL,
            confidence REAL,
            llm_label TEXT,
            llm_description TEXT,
            thumbnail BLOB NOT NULL,
            bbox_x1 INTEGER, bbox_y1 INTEGER,
            bbox_x2 INTEGER, bbox_y2 INTEGER,
            area INTEGER,
            sent_to_llm INTEGER DEFAULT 0
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_timestamp ON detections(timestamp)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_label ON detections(label)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_camera ON detections(camera_id)")
    conn.commit()
    log.info("DB initialised: %s", db_path)
    return conn


def save_detection(
    conn: sqlite3.Connection,
    camera_id: str,
    label: str,
    confidence: float,
    crop_img: np.ndarray,
    bbox: tuple,
    max_crop_px: int = 500,
) -> int:
    h, w = crop_img.shape[:2]
    if max(h, w) > max_crop_px:
        scale = max_crop_px / max(h, w)
        crop_img = cv2.resize(crop_img, (int(w * scale), int(h * scale)))

    if PIL_AVAILABLE:
        pil_img = Image.fromarray(cv2.cvtColor(crop_img, cv2.COLOR_BGR2RGB))
        buf = io.BytesIO()
        pil_img.save(buf, format="JPEG", quality=75)
        thumbnail = buf.getvalue()
    else:
        _, buf = cv2.imencode(".jpg", crop_img, [cv2.IMWRITE_JPEG_QUALITY, 75])
        thumbnail = buf.tobytes()

    cur = conn.execute(
        """
        INSERT INTO detections
            (timestamp, camera_id, label, confidence, thumbnail,
             bbox_x1, bbox_y1, bbox_x2, bbox_y2, area)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            datetime.now().isoformat(),
            camera_id,
            label,
            confidence,
            thumbnail,
            bbox[0], bbox[1], bbox[2], bbox[3],
            (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]),
        ),
    )
    conn.commit()
    return cur.lastrowid


def update_detection_llm(
    conn: sqlite3.Connection,
    det_id: int,
    llm_label: str,
    llm_description: str,
) -> None:
    conn.execute(
        "UPDATE detections SET llm_label=?, llm_description=?, sent_to_llm=1 WHERE id=?",
        (llm_label, llm_description, det_id),
    )
    conn.commit()


def get_statistics(
    conn: sqlite3.Connection,
    camera_id: Optional[str] = None,
    hours: int = 24,
) -> dict:
    where = f"timestamp > datetime('now', '-{hours} hours')"
    if camera_id:
        where += f" AND camera_id = '{camera_id}'"

    rows = conn.execute(
        f"SELECT label, COUNT(*) FROM detections WHERE {where} GROUP BY label ORDER BY 2 DESC"
    ).fetchall()
    by_class = {r[0]: r[1] for r in rows}

    rows = conn.execute(
        f"SELECT strftime('%H', timestamp), COUNT(*) FROM detections WHERE {where} GROUP BY 1"
    ).fetchall()
    by_hour = {r[0]: r[1] for r in rows}

    row = conn.execute(
        f"""
        SELECT COUNT(DISTINCT
            CAST(strftime('%s', timestamp) / 30 AS INTEGER) || '_' || label
        ) FROM detections WHERE {where} AND label IN ('person', 'car', 'truck')
        """
    ).fetchone()
    unique_events = row[0] if row else 0

    total = conn.execute(f"SELECT COUNT(*) FROM detections WHERE {where}").fetchone()[0]
    llm_sent = conn.execute(
        f"SELECT COUNT(*) FROM detections WHERE {where} AND sent_to_llm=1"
    ).fetchone()[0]

    return {
        "by_class": by_class,
        "by_hour": by_hour,
        "unique_events_30s": unique_events,
        "total": total,
        "llm_sent": llm_sent,
        "llm_reduction_pct": round((1 - llm_sent / max(total, 1)) * 100, 1),
    }


# ── Motion detection ──────────────────────────────────────────────────────────

def create_bg_subtractor(history: int = 500, var_threshold: int = 50) -> cv2.BackgroundSubtractorMOG2:
    return cv2.createBackgroundSubtractorMOG2(
        history=history,
        varThreshold=var_threshold,
        detectShadows=False,
    )


def extract_moving_objects(
    frame: np.ndarray,
    bg_subtractor: cv2.BackgroundSubtractorMOG2,
    min_area: int = 2000,
    max_area: int = 200000,
    target_width: int = 640,
) -> list:
    scale = target_width / frame.shape[1]
    small = cv2.resize(frame, (target_width, int(frame.shape[0] * scale)))

    fg_mask = bg_subtractor.apply(small)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, kernel)
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel)

    contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    crops = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if min_area < area < max_area:
            x, y, w, h = cv2.boundingRect(cnt)
            pad = int(min(w, h) * 0.1)
            x1 = max(0, x - pad)
            y1 = max(0, y - pad)
            x2 = min(small.shape[1], x + w + pad)
            y2 = min(small.shape[0], y + h + pad)
            crop = small[y1:y2, x1:x2]
            if crop.size > 0:
                crops.append({"crop": crop, "bbox": (x1, y1, x2, y2), "area": int(area)})

    return crops


# ── Local classification ──────────────────────────────────────────────────────

class LocalClassifier:
    def __init__(self, platform: str = "auto"):
        self.model = None
        self.platform = platform
        self._load_model()

    def _load_model(self) -> None:
        if not YOLO_AVAILABLE:
            log.warning("ultralytics not installed — local classification disabled")
            return
        try:
            model_path = self._select_model_path()
            self.model = YOLO(model_path)
            log.info("YOLOv8n loaded: %s (platform=%s)", model_path, self.platform)
        except Exception as e:
            log.warning("Failed to load YOLO model: %s", e)

    def _select_model_path(self) -> str:
        if self.platform == "n5105":
            ov_path = "yolov8n_openvino_model"
            if os.path.isdir(ov_path):
                return ov_path
        if self.platform in ("rpi5", "rpi"):
            tflite_path = "yolov8n_float16.tflite"
            if os.path.isfile(tflite_path):
                return tflite_path
        return "yolov8n.pt"

    def classify(self, crop_img: np.ndarray, max_px: int = 500) -> tuple:
        """Returns (label, confidence, resized_crop)."""
        if self.model is None:
            return "unknown", 0.0, crop_img

        h, w = crop_img.shape[:2]
        if max(h, w) > max_px:
            scale = max_px / max(h, w)
            crop_img = cv2.resize(crop_img, (int(w * scale), int(h * scale)))

        try:
            results = self.model(crop_img, verbose=False, conf=0.4)
            if results and results[0].boxes and len(results[0].boxes) > 0:
                box = results[0].boxes[0]
                cls_id = int(box.cls)
                conf = float(box.conf)
                yolo_label = self.model.names.get(cls_id, "unknown")
                label = YOLO_TO_10_CLASSES.get(yolo_label, "unknown")
                return label, conf, crop_img
        except Exception as e:
            log.debug("YOLO inference error: %s", e)

        return "unknown", 0.0, crop_img


# ── LLM verification ──────────────────────────────────────────────────────────

class LlmVerifier:
    def __init__(self, api_key: str, model: str = "anthropic/claude-haiku-4-5"):
        self.api_key = api_key
        self.model = model
        self._base_url = "https://openrouter.ai/api/v1/chat/completions"

    def _crop_to_b64(self, crop_img: np.ndarray, max_px: int = 500) -> str:
        h, w = crop_img.shape[:2]
        if max(h, w) > max_px:
            scale = max_px / max(h, w)
            crop_img = cv2.resize(crop_img, (int(w * scale), int(h * scale)))
        _, buf = cv2.imencode(".jpg", crop_img, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return base64.b64encode(buf).decode()

    def verify(self, crop_img: np.ndarray, local_label: str, camera_id: str) -> tuple:
        """Returns (llm_label, description). Falls back to (local_label, '') on error."""
        if not self.api_key or not REQUESTS_AVAILABLE:
            return local_label, ""

        img_b64 = self._crop_to_b64(crop_img)
        payload = {
            "model": self.model,
            "max_tokens": 100,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{img_b64}",
                            },
                        },
                        {
                            "type": "text",
                            "text": (
                                f"Camera: {camera_id}. Local classifier: {local_label}. "
                                "What is this object? Answer in format: LABEL|brief description. "
                                "Labels: person/car/truck/bus/motorcycle/bicycle/dog/cat/bird/unknown"
                            ),
                        },
                    ],
                }
            ],
        }
        try:
            resp = requests.post(
                self._base_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=15,
            )
            resp.raise_for_status()
            text = resp.json()["choices"][0]["message"]["content"].strip()
            parts = text.split("|", 1)
            llm_label = parts[0].strip().lower()
            description = parts[1].strip() if len(parts) > 1 else ""
            if llm_label not in CLASSES_10:
                llm_label = "unknown"
            return llm_label, description
        except Exception as e:
            log.warning("LLM verification failed: %s", e)
            return local_label, ""


# ── LLM filter logic ──────────────────────────────────────────────────────────

def should_send_to_llm(
    label: str,
    confidence: float,
    threshold: float = 0.6,
    night_mode: bool = False,
    night_person_always: bool = True,
) -> bool:
    if confidence < threshold:
        return True
    if label == "person" and night_mode and night_person_always:
        return True
    return False


# ── Main pipeline ─────────────────────────────────────────────────────────────

class MotionPipeline:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.running = False
        self.conn = init_db(args.db)
        self.bg_subtractor = create_bg_subtractor(args.bg_history, args.var_threshold)
        self.classifier = LocalClassifier(platform=args.platform)
        api_key = args.api_key or os.environ.get("OPENROUTER_API_KEY") or os.environ.get("ANTHROPIC_API_KEY", "")
        self.verifier = LlmVerifier(api_key=api_key, model=args.llm_model)
        self.last_seen: dict = {}
        self.stats = {"frames": 0, "processed": 0, "detections": 0, "llm_calls": 0}
        self._last_stats_emit = time.time()

    def _is_in_cooldown(self, label: str) -> bool:
        now = time.time()
        last = self.last_seen.get(label)
        if last is not None and (now - last) < self.args.cooldown:
            return True
        return False

    def _update_cooldown(self, label: str) -> None:
        self.last_seen[label] = time.time()

    def _emit_event(self, event: dict) -> None:
        if self.args.output_events:
            print(json.dumps(event), flush=True)

    def _maybe_emit_stats(self) -> None:
        now = time.time()
        if now - self._last_stats_emit >= self.args.stats_interval:
            db_stats = get_statistics(self.conn, self.args.camera_id)
            self._emit_event({"type": "stats", "pipeline": self.stats, "db": db_stats})
            self._last_stats_emit = now

    def process_frame(self, frame: np.ndarray) -> None:
        crops = extract_moving_objects(
            frame,
            self.bg_subtractor,
            min_area=self.args.min_area,
            max_area=self.args.max_area,
        )

        for obj in crops:
            label, conf, crop = self.classifier.classify(obj["crop"], max_px=self.args.max_crop)

            if self._is_in_cooldown(label):
                continue
            self._update_cooldown(label)

            det_id = save_detection(
                self.conn,
                self.args.camera_id,
                label,
                conf,
                crop,
                obj["bbox"],
                max_crop_px=self.args.max_crop,
            )
            self.stats["detections"] += 1

            event = {
                "type": "detection",
                "id": det_id,
                "camera_id": self.args.camera_id,
                "label": label,
                "confidence": round(conf, 3),
                "bbox": obj["bbox"],
                "area": obj["area"],
                "timestamp": datetime.now().isoformat(),
                "sent_to_llm": False,
            }

            if should_send_to_llm(
                label, conf,
                threshold=self.args.llm_threshold,
                night_mode=self.args.night_mode,
                night_person_always=True,
            ):
                self.stats["llm_calls"] += 1
                llm_label, llm_desc = self.verifier.verify(crop, label, self.args.camera_id)
                update_detection_llm(self.conn, det_id, llm_label, llm_desc)
                event["sent_to_llm"] = True
                event["llm_label"] = llm_label
                event["llm_description"] = llm_desc
                if self.args.verbose:
                    log.info(
                        "[LLM] cam=%s local=%s(%.2f) → llm=%s: %s",
                        self.args.camera_id, label, conf, llm_label, llm_desc[:80],
                    )
            elif self.args.verbose:
                log.info(
                    "[DET] cam=%s label=%s conf=%.2f area=%d",
                    self.args.camera_id, label, conf, obj["area"],
                )

            self._emit_event(event)

    def run(self) -> None:
        cap = cv2.VideoCapture(self.args.rtsp)
        if not cap.isOpened():
            log.error("Cannot open stream: %s", self.args.rtsp)
            sys.exit(1)

        log.info(
            "Pipeline started: cam=%s every=%d frames platform=%s",
            self.args.camera_id, self.args.process_every, self.args.platform,
        )
        self._emit_event({"type": "started", "camera_id": self.args.camera_id})

        self.running = True
        frame_count = 0

        try:
            while self.running:
                ret, frame = cap.read()
                if not ret:
                    log.warning("Stream read failed, retrying in 2s...")
                    time.sleep(2)
                    cap.release()
                    cap = cv2.VideoCapture(self.args.rtsp)
                    continue

                frame_count += 1
                self.stats["frames"] += 1

                if frame_count % self.args.process_every != 0:
                    continue

                self.stats["processed"] += 1
                self.process_frame(frame)
                self._maybe_emit_stats()

        except KeyboardInterrupt:
            log.info("Interrupted by user")
        finally:
            cap.release()
            self.running = False
            final_stats = get_statistics(self.conn, self.args.camera_id)
            self._emit_event({"type": "stopped", "camera_id": self.args.camera_id, "stats": final_stats})
            log.info(
                "Pipeline stopped. Frames=%d processed=%d detections=%d llm_calls=%d",
                self.stats["frames"], self.stats["processed"],
                self.stats["detections"], self.stats["llm_calls"],
            )


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Smart Motion Detection Pipeline")
    p.add_argument("--rtsp", required=True, help="RTSP stream URL")
    p.add_argument("--camera-id", default="cam01", help="Camera identifier")
    p.add_argument("--db", default="detections.db", help="SQLite DB path")
    p.add_argument("--platform", default="auto", choices=["auto", "rpi5", "n5105"],
                   help="Hardware platform hint")
    p.add_argument("--process-every", type=int, default=5,
                   help="Process every N-th frame (RPi5: 5, N5105: 3)")
    p.add_argument("--min-area", type=int, default=2000,
                   help="Minimum contour area in pixels")
    p.add_argument("--max-area", type=int, default=200000,
                   help="Maximum contour area in pixels")
    p.add_argument("--var-threshold", type=int, default=50,
                   help="MOG2 variance threshold")
    p.add_argument("--bg-history", type=int, default=500,
                   help="MOG2 background history frames")
    p.add_argument("--llm-threshold", type=float, default=0.6,
                   help="Confidence below which LLM verification is triggered")
    p.add_argument("--cooldown", type=float, default=10.0,
                   help="Cooldown seconds per label")
    p.add_argument("--max-crop", type=int, default=500,
                   help="Max crop dimension in pixels")
    p.add_argument("--llm-model", default="anthropic/claude-haiku-4-5",
                   help="LLM model for verification")
    p.add_argument("--api-key", default="",
                   help="OpenRouter/Anthropic API key (or set OPENROUTER_API_KEY env)")
    p.add_argument("--night-mode", action="store_true",
                   help="Always send persons to LLM in night mode")
    p.add_argument("--stats-interval", type=int, default=60,
                   help="Emit stats event every N seconds")
    p.add_argument("--output-events", action="store_true",
                   help="Print JSON events to stdout (for Tauri subprocess integration)")
    p.add_argument("--verbose", action="store_true",
                   help="Verbose logging")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    if args.verbose:
        log.setLevel(logging.DEBUG)

    pipeline = MotionPipeline(args)

    def _handle_signal(sig, frame):
        log.info("Signal %s received, stopping...", sig)
        pipeline.running = False

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    pipeline.run()


if __name__ == "__main__":
    main()
