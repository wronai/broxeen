.PHONY: build-n5105 build-dev run run-url query ask stats narratives recent setup-model install-openvino-n5105

# ── Build ─────────────────────────────────────────────────────────────────────
build-dev:
	cargo build

build-n5105:
	RUSTFLAGS="-C target-cpu=tremont" \
	cargo build --release --features openvino

build-rpi5:
	RUSTFLAGS="-C target-cpu=cortex-a76 -C target-feature=+neon,+fp-armv8" \
	cargo build --release --features rpi5 --target aarch64-unknown-linux-gnu

# ── Run ───────────────────────────────────────────────────────────────────────
run:
	OPENROUTER_API_KEY=$(OPENROUTER_API_KEY) \
	RUST_LOG=broxeen_vision=info \
	cargo run --release --features openvino -- run

run-url:
	OPENROUTER_API_KEY=$(OPENROUTER_API_KEY) \
	RUST_LOG=broxeen_vision=info \
	cargo run --release --features openvino -- run \
	    --url "$(URL)" --camera-id "$(CAM)"

# Two cameras simultaneously:
run-cam2:
	OPENROUTER_API_KEY=$(OPENROUTER_API_KEY) \
	BROXEEN__CAMERA__URL=$(URL2) \
	BROXEEN__CAMERA__CAMERA_ID=cam2 \
	BROXEEN__DATABASE__PATH=monitoring_cam2.db \
	RUST_LOG=broxeen_vision=info \
	cargo run --release --features openvino -- run

# ── Query interface ───────────────────────────────────────────────────────────
query:
	OPENROUTER_API_KEY=$(OPENROUTER_API_KEY) \
	cargo run --release -- query

ask:
	OPENROUTER_API_KEY=$(OPENROUTER_API_KEY) \
	cargo run --release -- ask "$(Q)"
# Usage: make ask Q="ile osób było dziś widzianych?"

# ── Reports ───────────────────────────────────────────────────────────────────
stats:
	cargo run --release -- stats --hours 24

narratives:
	cargo run --release -- narratives --limit 5

recent:
	cargo run --release -- recent --limit 30

# ── Model setup ──────────────────────────────────────────────────────────────
setup-model:
	mkdir -p models
	pip3 install -q ultralytics
	python3 -c "\
from ultralytics import YOLO; \
m = YOLO('yolov8s.pt'); \
m.export(format='onnx', imgsz=640, opset=12, simplify=True); \
import shutil; shutil.move('yolov8s.onnx', 'models/yolov8s.onnx'); \
print('✓ models/yolov8s.onnx')"

# ── OpenVINO install (Intel N5105 — software only!) ──────────────────────────
install-openvino-n5105:
	@echo "=== Installing Intel OpenVINO runtime (software only, no extra hardware needed) ==="
	@echo "N5105 has Intel UHD 24EU iGPU — OpenVINO uses it automatically"
	wget -q https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB
	sudo apt-key add GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB
	echo "deb https://apt.repos.intel.com/openvino/2024 ubuntu22 main" | \
	    sudo tee /etc/apt/sources.list.d/intel-openvino-2024.list
	sudo apt update && sudo apt install -y openvino-2024.0.0
	@echo ""
	@echo "=== Set env vars for OpenVINO ==="
	@echo "source /opt/intel/openvino_2024/setupvars.sh"

# ── Local fallback: Ollama + LLaVA ───────────────────────────────────────────
install-ollama:
	curl -fsSL https://ollama.ai/install.sh | sh
	ollama pull llava:7b
	@echo "✓ Local LLM fallback: llava:7b via Ollama"

install-deps:
	sudo apt install -y libopencv-dev libclang-dev ffmpeg pkg-config build-essential

clean:
	cargo clean
	rm -f monitoring.db monitoring_cam2.db
