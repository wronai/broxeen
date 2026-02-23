.PHONY: help \
        install dev dev-browser dev-nvidia build \
        test test-watch test-coverage \
        lint format check clean clean-all \
        stop stop-port stop-services stop-all status restart \
        build-vision build-vision-release build-n5105 build-rpi5 \
        cargo-check cargo-check-vision \
        setup-model \
        openvino-detect openvino-install openvino-install-apt \
        openvino-install-pip openvino-install-docker openvino-install-brew \
        openvino-install-yum openvino-check openvino-devices openvino-activate \
        install-ollama install-vision-deps \
        run run-url run-cam2 query ask stats narratives recent thumbnail

# ╔══════════════════════════════════════════════════════════════════╗
# ║  Broxeen Vision — Makefile                                      ║
# ╠══════════════════════════════════════════════════════════════════╣
# ║  make help            — show all targets                        ║
# ║  make openvino-detect — detect your platform                    ║
# ║  make openvino-install— auto-install OpenVINO                   ║
# ╚══════════════════════════════════════════════════════════════════╝

SHELL := /bin/bash

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPTS_DIR  := scripts
PLATFORM_FILE:= .platform-detection

# ── Colors ────────────────────────────────────────────────────────────────────
CYAN  := \033[0;36m
GREEN := \033[0;32m
YELLOW:= \033[1;33m
BOLD  := \033[1m
RESET := \033[0m

# ╔══════════════════════════════════════════════════════════════════╗
# ║  HELP                                                           ║
# ╚══════════════════════════════════════════════════════════════════╝

help: ## Show all available targets
	@echo ""
	@echo -e "$(BOLD)╔═══════════════════════════════════════════════════════════╗$(RESET)"
	@echo -e "$(BOLD)║   Broxeen Vision — Available Commands                   ║$(RESET)"
	@echo -e "$(BOLD)╠═══════════════════════════════════════════════════════════╣$(RESET)"
	@echo -e "$(BOLD)║  Frontend / App (Tauri)                                  ║$(RESET)"
	@grep -E '^(install|dev|dev-|build|test|lint|format|check|clean|stop|status|restart)[^-].*:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  $(CYAN)%-22s$(RESET) %s\n", $$1, $$2}'
	@echo -e "$(BOLD)║  Vision Pipeline (Rust + OpenVINO)                      ║$(RESET)"
	@grep -E '^(build-vision|build-n5105|build-rpi5|cargo|setup-model|run|query|ask|stats|narratives|recent|thumbnail).*:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  $(CYAN)%-22s$(RESET) %s\n", $$1, $$2}'
	@echo -e "$(BOLD)║  OpenVINO Installation                                  ║$(RESET)"
	@grep -E '^openvino.*:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  $(CYAN)%-22s$(RESET) %s\n", $$1, $$2}'
	@echo -e "$(BOLD)║  LLM (Ollama local fallback)                            ║$(RESET)"
	@grep -E '^install-(ollama|vision-deps).*:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  $(CYAN)%-22s$(RESET) %s\n", $$1, $$2}'
	@echo -e "$(BOLD)╚═══════════════════════════════════════════════════════════╝$(RESET)"
	@echo ""


# ╔══════════════════════════════════════════════════════════════════╗
# ║  FRONTEND (Tauri + React) — original targets preserved          ║
# ╚══════════════════════════════════════════════════════════════════╝

install: ## Install Node dependencies
	corepack npm install

dev: ## Start development server with hot reload
	@$(MAKE) stop-services >/dev/null 2>&1 || true
	@$(MAKE) stop-port >/dev/null 2>&1 || true
	corepack npm run tauri dev

dev-browser: ## Start frontend-only Vite dev server
	corepack npm run dev

dev-nvidia: ## Start dev server with Nvidia GPU fixes
	@$(MAKE) stop-services >/dev/null 2>&1 || true
	@$(MAKE) stop-port >/dev/null 2>&1 || true
	WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITE_OPERATORS_WORKAROUND=1 corepack npm run tauri dev

build: ## Build production version (Tauri app)
	corepack npm run tauri build

test: ## Run all tests
	corepack npm test

test-watch: ## Run tests in watch mode
	corepack npm run test:watch

test-coverage: ## Run tests with coverage report
	corepack npm run test:coverage

lint: ## Run linting checks
	corepack npm run lint || true

format: ## Format code
	corepack npm run format || true

check: ## Run type checking
	corepack npm run check || true

clean: ## Clean build artifacts and node_modules
	rm -rf node_modules dist target
	rm -rf .coverage coverage
	corepack npm cache clean --force || true

clean-all: ## Full clean including Docker
	$(MAKE) clean
	docker compose down -v 2>/dev/null || true
	docker system prune -f 2>/dev/null || true

stop: ## Stop development server
	@echo "Stopping Broxeen development server..."
	@pkill -f "npm run tauri dev" 2>/dev/null || true
	@pkill -f "vite" 2>/dev/null || true
	@pkill -f "tauri dev" 2>/dev/null || true
	@sleep 1
	@echo "Development server stopped"

stop-port: ## Stop processes on port 5173
	@echo "Stopping processes on port 5173..."
	@if lsof -i:5173 >/dev/null 2>&1; then \
		lsof -ti:5173 | xargs -r kill -9 2>/dev/null || true; \
		sleep 1; \
	fi
	@echo "Port 5173 cleared"

stop-services: ## Stop all related services
	@echo "Stopping all Broxeen services..."
	@pkill -f "broxeen" 2>/dev/null || true
	@pkill -f "node.*5173" 2>/dev/null || true
	@pkill -f "npm.*dev" 2>/dev/null || true
	@pkill -f "tauri.*dev" 2>/dev/null || true
	@pkill -f "vite.*5173" 2>/dev/null || true
	@sleep 1
	@echo "All services stopped"

stop-all: ## Stop everything (services + port)
	@$(MAKE) stop-services >/dev/null 2>&1 || true
	@$(MAKE) stop-port >/dev/null 2>&1 || true
	@rm -rf /tmp/broxeen-* 2>/dev/null || true
	@rm -rf .vite 2>/dev/null || true
	@echo "All processes stopped"

status: ## Show status of Broxeen processes and ports
	@echo ""
	@echo "Broxeen Status:"
	@if pgrep -f "npm run tauri dev" >/dev/null; then echo "  Dev server:  RUNNING"; else echo "  Dev server:  STOPPED"; fi
	@if lsof -i:5173 >/dev/null 2>&1; then echo "  Port 5173:   IN USE"; else echo "  Port 5173:   FREE"; fi
	@if pgrep -f "broxeen-vision" >/dev/null; then echo "  Vision:      RUNNING"; else echo "  Vision:      STOPPED"; fi
	@echo ""

restart: ## Restart development server
	@$(MAKE) stop-all >/dev/null 2>&1 || true
	@sleep 2
	@$(MAKE) dev


# ╔══════════════════════════════════════════════════════════════════╗
# ║  VISION PIPELINE (Rust)                                         ║
# ╚══════════════════════════════════════════════════════════════════╝

build-vision: ## Build vision pipeline (debug, default features)
	cd src-tauri && cargo build --features vision

build-vision-release: ## Build vision pipeline (release)
	cd src-tauri && cargo build --release --features vision

build-n5105: ## Build optimised for Intel N5105 + OpenVINO
	cd src-tauri && RUSTFLAGS="-C target-cpu=tremont" \
	    cargo build --release --features "vision,openvino"

build-rpi5: ## Build optimised for Raspberry Pi 5 (ARM NEON)
	cd src-tauri && \
	RUSTFLAGS="-C target-cpu=cortex-a76 -C target-feature=+neon,+fp-armv8" \
	    cargo build --release --features "vision,rpi5" \
	    --target aarch64-unknown-linux-gnu

cargo-check: ## Check Rust compilation (no vision features)
	cd src-tauri && cargo check

cargo-check-vision: ## Check Rust compilation with vision feature
	cd src-tauri && cargo check --features vision

# ── Model ─────────────────────────────────────────────────────────────────────

setup-model: ## Download and export YOLOv8s ONNX model
	@echo "Downloading YOLOv8s model (requires ultralytics)..."
	mkdir -p models
	pip3 install -q ultralytics
	python3 -c "\
from ultralytics import YOLO; \
m = YOLO('yolov8s.pt'); \
m.export(format='onnx', imgsz=640, opset=12, simplify=True); \
import shutil; shutil.move('yolov8s.onnx', 'models/yolov8s.onnx'); \
print('Model ready: models/yolov8s.onnx')"

setup-model-nano: ## Download YOLOv8n (nano, for slower hardware)
	mkdir -p models
	pip3 install -q ultralytics
	python3 -c "\
from ultralytics import YOLO; \
m = YOLO('yolov8n.pt'); \
m.export(format='onnx', imgsz=640, opset=12, simplify=True); \
import shutil; shutil.move('yolov8n.onnx', 'models/yolov8n.onnx'); \
print('Model ready: models/yolov8n.onnx')"

# ── Vision runtime ────────────────────────────────────────────────────────────

run: ## Start vision monitoring pipeline
	@OPENROUTER_API_KEY=$(OPENROUTER_API_KEY) \
	RUST_LOG=broxeen_vision=info \
	./target/release/broxeen-vision run

run-url: ## Start with explicit camera URL (URL= CAM= required)
	@OPENROUTER_API_KEY=$(OPENROUTER_API_KEY) \
	RUST_LOG=broxeen_vision=info \
	./target/release/broxeen-vision run \
	    --url "$(URL)" --camera-id "$(CAM)"
# Usage: make run-url URL="rtsp://admin:pass@192.168.1.100:554/stream" CAM="front-door"

run-cam2: ## Start second camera instance (URL2= required)
	@OPENROUTER_API_KEY=$(OPENROUTER_API_KEY) \
	BROXEEN__CAMERA__URL=$(URL2) \
	BROXEEN__CAMERA__CAMERA_ID=cam2 \
	BROXEEN__DATABASE__PATH=monitoring.db \
	RUST_LOG=broxeen_vision=info \
	./target/release/broxeen-vision run

query: ## Interactive natural language query interface
	@OPENROUTER_API_KEY=$(OPENROUTER_API_KEY) ./target/release/broxeen-vision query

ask: ## Ask a single question (Q= required)
	@OPENROUTER_API_KEY=$(OPENROUTER_API_KEY) \
	./target/release/broxeen-vision ask "$(Q)"
# Usage: make ask Q="ile osób było dziś widzianych?"

stats: ## Show 24h detection statistics
	./target/release/broxeen-vision stats --hours 24

narratives: ## Show recent LLM scene narratives
	./target/release/broxeen-vision narratives --limit 5

recent: ## Show recent detections
	./target/release/broxeen-vision recent --limit 30

thumbnail: ## Export thumbnail for detection ID (ID= required)
	./target/release/broxeen-vision thumbnail $(ID)
# Usage: make thumbnail ID=42


# ╔══════════════════════════════════════════════════════════════════╗
# ║  OPENVINO INSTALLATION                                          ║
# ╚══════════════════════════════════════════════════════════════════╝
#
# Quick reference:
#   make openvino-detect    — detect platform + recommend EP
#   make openvino-install   — auto-detect + install
#   make openvino-check     — verify current installation
#   make openvino-devices   — list devices detected by OpenVINO

openvino-detect: ## Detect platform and show recommended OpenVINO EP
	@echo ""
	@bash $(SCRIPTS_DIR)/detect-platform.sh
	@echo ""

openvino-install: ## Auto-detect platform and install OpenVINO (recommended)
	@echo ""
	@bash $(SCRIPTS_DIR)/install-openvino.sh
	@echo ""

openvino-install-apt: ## Install OpenVINO via Intel APT repo (Ubuntu 20/22/24)
	@bash $(SCRIPTS_DIR)/install-openvino.sh --apt

openvino-install-pip: ## Install OpenVINO via pip in virtualenv (any platform)
	@bash $(SCRIPTS_DIR)/install-openvino.sh --pip

openvino-install-yum: ## Install OpenVINO via Intel YUM repo (Fedora/RHEL)
	@bash $(SCRIPTS_DIR)/install-openvino.sh --yum

openvino-install-brew: ## Install OpenVINO via Homebrew (macOS)
	@bash $(SCRIPTS_DIR)/install-openvino.sh --brew

openvino-install-docker: ## Install OpenVINO via Docker (any platform, isolated)
	@bash $(SCRIPTS_DIR)/install-openvino.sh --docker

openvino-check: ## Check current OpenVINO installation
	@echo ""
	@bash $(SCRIPTS_DIR)/install-openvino.sh --check
	@echo ""

openvino-devices: ## List devices available to OpenVINO
	@echo ""
	@python3 - << 'EOF' 2>/dev/null || echo "  OpenVINO not found. Run: make openvino-install"
import openvino as ov
core = ov.Core()
print(f"  OpenVINO: {ov.__version__}")
print(f"  Devices:")
for d in core.available_devices:
    try:
        name = core.get_property(d, "FULL_DEVICE_NAME")
        print(f"    {d:8s} {name}")
    except:
        print(f"    {d}")
EOF
	@echo ""

openvino-activate: ## Print command to activate OpenVINO in current shell
	@echo ""
	@for f in \
	    /opt/intel/openvino_2024/setupvars.sh \
	    /opt/intel/openvino/setupvars.sh \
	    $$(ls -d /opt/intel/openvino_* 2>/dev/null | sort -V | tail -1)/setupvars.sh; do \
	    if [ -f "$$f" ]; then \
	        echo -e "  Run: $(CYAN)source $$f$(RESET)"; \
	        break; \
	    fi; \
	done
	@if [ -f /opt/openvino-env/bin/activate ]; then \
	    echo -e "  Or:  $(CYAN)source /opt/openvino-env/bin/activate$(RESET)"; \
	fi
	@echo ""


# ╔══════════════════════════════════════════════════════════════════╗
# ║  LLM FALLBACK (Ollama)                                         ║
# ╚══════════════════════════════════════════════════════════════════╝

install-ollama: ## Install Ollama + LLaVA vision model (local LLM fallback)
	@echo "Installing Ollama..."
	curl -fsSL https://ollama.ai/install.sh | sh
	ollama pull llava:7b
	@echo ""
	@echo "Local LLM ready: llava:7b"
	@echo "Set in broxeen.toml:"
	@echo "  [llm]"
	@echo "  local_base_url = \"http://localhost:11434/v1\""
	@echo "  local_model = \"llava:7b\""
	@echo ""

install-vision-deps: ## Install system deps for vision feature (Linux)
	sudo apt-get install -y \
	    libopencv-dev libclang-dev ffmpeg pkg-config \
	    build-essential cmake \
	    libglib2.0-dev libgl1-mesa-glx


# ╔══════════════════════════════════════════════════════════════════╗
# ║  FULL SETUP (one-shot)                                         ║
# ╚══════════════════════════════════════════════════════════════════╝

setup-all: ## Full setup: detect + deps + OpenVINO + model (Ubuntu)
	@echo ""
	@echo -e "$(BOLD)Full setup starting...$(RESET)"
	$(MAKE) openvino-detect
	$(MAKE) install-vision-deps
	$(MAKE) openvino-install
	$(MAKE) setup-model
	@echo ""
	@echo -e "$(GREEN)$(BOLD)Setup complete! Next: make build-n5105 && make run$(RESET)"
	@echo ""
