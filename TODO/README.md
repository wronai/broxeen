# Broxeen Vision v0.3

**YOLOv8s + IoU tracking + OpenRouter LLM narratives — Intel N5105 MiniPC**  
Dwutorowa architektura: lokalny zapis per-sekunda + potwierdzenie LLM co minutę.

---

## ❓ Odpowiedzi na pytania

### Czy potrzebujemy ANTHROPIC_API_KEY?
**Nie.** Używamy **OpenRouter** (`OPENROUTER_API_KEY`), który obsługuje setki modeli.  
Polecany model: `google/gemini-2.0-flash-exp:free` (FREE tier, obsługuje obrazy).

### Czy można użyć OpenRouter?
**Tak.** OpenRouter ma API kompatybilne z OpenAI (`/v1/chat/completions`).  
Zmiana: tylko inna base URL i klucz API.

### Co jeśli OpenRouter nie ma modelu?
Automatyczny fallback na **lokalny Ollama z LLaVA** (`http://localhost:11434/v1`).  
Jeśli oba niedostępne → lokalny YOLO nadal działa, zapis do DB bez narracji.

### OpenVINO — sprzęt czy oprogramowanie?
**Tylko oprogramowanie.** N5105 ma wbudowany Intel UHD 24EU iGPU.  
OpenVINO to runtime który automatycznie go wykrywa i używa.  
Instalacja: `make install-openvino-n5105` (jedna komenda).

---

## Architektura

```
RTSP (2 kamery max) → co 4 klatki
    │
    ├─► MOG2 320×240 (activity gate, ~1ms) — skip blank frames
    │
    └─► YOLOv8s ONNX/OpenVINO 640×640 (~15ms N5105)
           └─► 20 klas: person/car/truck/bus/motorcycle/bicycle/
                        dog/cat/bird/horse/backpack/handbag/suitcase/
                        umbrella/bottle/chair/laptop/cell phone/clock/unknown
               └─► Tracker (IoU matching, UUID per obiekt)
                     └─► Track zakończony
                           │
                           ├─► TRACK A (natychmiastowy)
                           │     direction/speed/zone/crop → SQLite detections
                           │     ↓ <1ms opóźnienie
                           │
                           └─► TRACK B (co minutę)
                                 MinuteBuffer → LLM (OpenRouter / Ollama)
                                 Minimum 3 cropy jako obrazy + timeline
                                 → SQLite llm_events (narracja sceny)

Zapytania:
    broxeen-vision query
        → "ile osób było dziś?" → text-to-SQL → SQLite → wyniki w tabeli
```

---

## Szybki start

```bash
# 1. Zależności systemowe
make install-deps

# 2. OpenVINO runtime (tylko software!)
make install-openvino-n5105
source /opt/intel/openvino_2024/setupvars.sh

# 3. Model YOLOv8s ONNX
make setup-model

# 4. Lokalny fallback LLM (opcjonalny)
make install-ollama

# 5. Konfiguracja
# Ustaw URL kamery w broxeen.toml lub:
export BROXEEN__CAMERA__URL="rtsp://admin:pass@192.168.1.100:554/stream"
export OPENROUTER_API_KEY="sk-or-..."

# 6. Uruchom
make run
```

---

## CLI

```bash
# Monitoring
broxeen-vision run --url rtsp://... --camera-id front-door

# Interaktywne zapytania (text-to-SQL)
broxeen-vision query
  ❯ ile osób było widzianych dzisiaj?
  ❯ pokaż wszystkie samochody z ostatnich 2 godzin
  ❯ kiedy był ostatnio rower?
  ❯ policz przyjazdy i odjazdy samochodów

# Jedno pytanie
broxeen-vision ask "ile różnych osób było na scenie?"
make ask Q="pokaż obiekty między 8:00 a 9:00"

# Historia LLM
broxeen-vision narratives --limit 5

# Ostatnie detekcje
broxeen-vision recent --limit 30

# Statystyki
broxeen-vision stats --hours 24

# Thumbnail
broxeen-vision thumbnail 42
```

---

## Zmienne środowiskowe

```bash
# Wymagane
OPENROUTER_API_KEY=sk-or-v1-...
BROXEEN__CAMERA__URL=rtsp://admin:pass@IP:554/stream

# Opcjonalne (override broxeen.toml)
BROXEEN__CAMERA__CAMERA_ID=front-door
BROXEEN__DETECTOR__USE_OPENVINO=true
BROXEEN__SCENE__FLUSH_INTERVAL_SECS=60
BROXEEN__SCENE__MIN_CROPS_FOR_LLM=3
BROXEEN__DATABASE__PATH=monitoring.db
RUST_LOG=broxeen_vision=info
```

---

## Dwie kamery

```bash
# Terminal 1
BROXEEN__CAMERA__URL=rtsp://cam1... BROXEEN__CAMERA__CAMERA_ID=front \
BROXEEN__DATABASE__PATH=monitoring.db ./broxeen-vision run

# Terminal 2 — osobna baza lub ta sama (obie kamery zapisują do jednej)
BROXEEN__CAMERA__URL=rtsp://cam2... BROXEEN__CAMERA__CAMERA_ID=back \
BROXEEN__DATABASE__PATH=monitoring.db ./broxeen-vision run
```

Jedna wspólna baza pozwala na zapytania cross-kamera:
```
❯ ile samochodów wjechało przez front i wyjechało przez back?
```

---

## Wydajność N5105

| Komponent           | Czas     | Opis                              |
|---------------------|----------|-----------------------------------|
| MOG2 gate           | ~1ms     | 320×240, czy uruchamiać YOLO?     |
| YOLOv8s OpenVINO    | ~15–25ms | 640×640, iGPU N5105               |
| Tracker update      | <1ms     | IoU matching                      |
| SQLite insert       | <1ms     | WAL mode                          |
| **FPS efektywny**   | **8–12** | process_every=4, stream 25fps     |
| RAM                 | ~350MB   |                                   |
| LLM calls           | ~1/min   | jeśli min 3 cropy zebrane         |

---

## Schema bazy danych

```sql
-- Track A: każdy wykryty obiekt (natychmiast)
detections: id, timestamp, local_date, local_hour, camera_id, track_id,
            label, confidence, movement, direction, speed_label,
            entry_zone, exit_zone, duration_s, thumbnail(BLOB)

-- Track B: narracja LLM (co minutę)
llm_events: id, timestamp, camera_id, period_start, period_end,
            narrative, provider, crops_sent, context

-- Widok do zapytań NL
monitoring_history: (join detections + nearest llm_narrative)
```

---

## OpenRouter — polecane modele do wizji

| Model                                          | Koszt       | Jakość |
|------------------------------------------------|-------------|--------|
| `google/gemini-2.0-flash-exp:free`             | FREE        | ★★★★   |
| `meta-llama/llama-3.2-11b-vision-instruct:free`| FREE        | ★★★    |
| `google/gemini-flash-1.5`                      | $0.075/1M   | ★★★★★  |
| `openai/gpt-4o-mini`                           | $0.15/1M    | ★★★★★  |

Rejestracja: https://openrouter.ai — darmowe kredyty na start.
