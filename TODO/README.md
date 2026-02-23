# Broxeen Vision — Rust Motion Detection Pipeline

Wydajny pipeline detekcji ruchu w **czystym Rust** dla RPi 5 i Intel N5105 (MiniPC).
Minimalna liczba wywołań LLM — do Anthropic wysyłane są tylko wycięte obiekty ≤500px.

## Architektura

```
RTSP → CaptureStream (co N-tą klatkę)
    → MotionDetector (MOG2 background subtraction)
    → crop ≤500px JPEG
    → Detector (YOLOv8n ONNX via ort)
        → confidence ≥ 0.6 → zapis SQLite
        → confidence < 0.6 → LLM (Claude Haiku) → zapis SQLite
    → Statistics API
```

## Wymagania systemowe

### Ubuntu/Debian (RPi5 + N5105)
```bash
sudo apt install -y libopencv-dev libclang-dev ffmpeg pkg-config
```

### Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## Szybki start

```bash
# 1. Pobierz model
make setup-model

# 2. Skonfiguruj
cp broxeen.toml.example broxeen.toml
# edytuj broxeen.toml: URL kamery, API key

# 3. Buduj i uruchom
make build-n5105    # dla Intel N5105
make build-rpi5     # dla RPi 5

# 4. Uruchom
ANTHROPIC_API_KEY=sk-... ./target/release/broxeen-vision run
```

## CLI

```bash
# Uruchom pipeline
broxeen-vision run --url rtsp://... --camera-id front-door

# Statystyki (ostatnie 24h)
broxeen-vision stats --hours 24
broxeen-vision stats --hours 1 --camera front-door --json

# Ostatnie detekcje
broxeen-vision recent --limit 50

# Eksport miniatury
broxeen-vision thumbnail 42 --output obj_42.jpg
```

## Wydajność (szacunkowa)

| Platforma         | FPS efektywny | CPU     | RAM    | LLM calls/h |
|-------------------|---------------|---------|--------|-------------|
| RPi 5 (ARM A76)   | 5–8 fps       | ~40%    | ~250MB | ~10–30      |
| N5105 + OpenVINO  | 15–25 fps     | ~25%    | ~350MB | ~5–15       |

## Zmienne środowiskowe

```
ANTHROPIC_API_KEY=sk-ant-...
BROXEEN__CAMERA__URL=rtsp://...
BROXEEN__CAMERA__CAMERA_ID=front-door
BROXEEN__PIPELINE__PROCESS_EVERY_N_FRAMES=5
RUST_LOG=broxeen_vision=info
```
