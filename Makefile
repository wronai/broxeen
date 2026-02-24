.PHONY: help \
        install dev dev-browser dev-nvidia build \
        test test-watch test-coverage \
        lint format check clean clean-all \
        playwright-install playwright-install-browsers playwright-install-deps \
        e2e e2e-network-scan \
        stop stop-port stop-services stop-all status restart \
        build-vision build-vision-release build-n5105 build-rpi5 \
        cargo-check cargo-check-vision \
        setup-model \
        openvino-detect openvino-install openvino-install-apt \
        openvino-install-pip openvino-install-docker openvino-install-brew \
        openvino-install-yum openvino-check openvino-devices openvino-activate \
        install-ollama install-vision-deps \
        nlp2cmd-setup nlp2cmd-test nlp2cmd-install nlp2cmd-status nlp2cmd-set-local nlp2cmd-env-setup nlp2cmd-env-show download-bielik \
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
	@echo -e "$(BOLD)║  NLP2CMD (Polish LLM Integration)                       ║$(RESET)"
	@grep -E '^nlp2cmd.*:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  $(CYAN)%-22s$(RESET) %s\n", $$1, $$2}'
	@echo -e "$(BOLD)╚═══════════════════════════════════════════════════════════╝$(RESET)"
	@echo ""


# ╔══════════════════════════════════════════════════════════════════╗
# ║  FRONTEND (Tauri + React) — original targets preserved          ║
# ╚══════════════════════════════════════════════════════════════════╝

install: ## Install Node dependencies + NLP2CMD integration
	corepack npm install
	@echo "Setting up NLP2CMD integration..."
	@if [ -f "setup_local_llm.sh" ]; then \
		chmod +x setup_local_llm.sh; \
		./setup_local_llm.sh --deps-only; \
	else \
		echo "NLP2CMD setup script not found, installing manually..."; \
		pip3 install -q nlp2cmd[all] llama-cpp-python 2>/dev/null || true; \
	fi

dev: ## Start development server with NLP2CMD integration
	@$(MAKE) stop-services >/dev/null 2>&1 || true
	@$(MAKE) stop-port >/dev/null 2>&1 || true
	@echo "Starting Broxeen with NLP2CMD integration..."
	@$(MAKE) nlp2cmd-status || true
	@echo -e "$(GREEN)✓ NLP2CMD integration ready$(RESET)"
	BROXEEN_NLP2CMD_ENABLED=1 corepack npm run tauri dev

dev-browser: ## Start frontend-only Vite dev server
	corepack npm run dev

dev-nvidia: ## Start dev server with Nvidia GPU fixes
	@$(MAKE) stop-services >/dev/null 2>&1 || true
	@$(MAKE) stop-port >/dev/null 2>&1 || true
	WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITE_OPERATORS_WORKAROUND=1 corepack npm run tauri dev

build: ## Build production version with NLP2CMD embedded
	@echo "Building Broxeen with NLP2CMD integration..."
	@$(MAKE) nlp2cmd-install || true
	@echo -e "$(GREEN)✓ NLP2CMD components embedded$(RESET)"
	BROXEEN_NLP2CMD_ENABLED=1 corepack npm run tauri build

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

playwright-install-browsers: ## Install Playwright browsers (downloads binaries)
	corepack pnpm exec playwright install

playwright-install-deps: ## Install system dependencies for Playwright browsers (requires sudo)
	sudo corepack pnpm exec playwright install-deps

playwright-install: ## Install Playwright browsers + system deps
	$(MAKE) playwright-install-browsers
	$(MAKE) playwright-install-deps

e2e: ## Run Playwright E2E tests
	corepack pnpm playwright test

e2e-network-scan: ## Run Playwright E2E: network-scanning-flow spec
	corepack pnpm playwright test e2e/network-scanning-flow.spec.ts

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
	@import openvino as ov
	@core = ov.Core()
	@print(f"  OpenVINO: {ov.__version__}")
	@print(f"  Devices:")
	@for d in core.available_devices:
	@    try:
	@        name = core.get_property(d, "FULL_DEVICE_NAME")
	@        print(f"    {d:8s} {name}")
	@    except:
	@        print(f"    {d}")
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
# ║  NLP2CMD INTEGRATION (Polish LLM)                              ║
# ╚══════════════════════════════════════════════════════════════════╝

nlp2cmd-setup: ## Complete NLP2CMD setup with Polish LLM
	@echo ""
	@echo -e "$(BOLD)Setting up NLP2CMD with Polish LLM integration...$(RESET)"
	@echo ""
	@if [ -f "setup_local_llm.sh" ]; then \
		chmod +x setup_local_llm.sh; \
		./setup_local_llm.sh; \
	else \
		echo "❌ Setup script not found. Creating basic setup..."; \
		pip3 install -q nlp2cmd[all] llama-cpp-python; \
		mkdir -p models; \
		echo "✅ Basic NLP2CMD setup complete"; \
	fi
	@echo ""
	@echo -e "$(GREEN)✓ NLP2CMD integration ready$(RESET)"
	@echo "Run 'make nlp2cmd-test' to verify installation"

nlp2cmd-install: ## Install NLP2CMD dependencies only
	@echo "Installing NLP2CMD dependencies..."
	@if [ ! -d "venv_llm" ]; then \
		echo "Creating virtual environment..."; \
		python3 -m venv venv_llm; \
	fi
	@source venv_llm/bin/activate && \
		pip install -q nlp2cmd[all] llama-cpp-python litellm 2>/dev/null || \
		pip install -q nlp2cmd[all] llama-cpp-python litellm --break-system-packages 2>/dev/null || \
		echo "⚠️ Failed to install NLP2CMD dependencies"
	@mkdir -p models
	@if [ ! -f "local_llm_config.json" ]; then \
		echo "Creating default NLP2CMD config..."; \
		echo '{"default_model_type": "mock", "language": "pl"}' > local_llm_config.json; \
	fi
	@echo "✅ NLP2CMD dependencies installed"

# Download Bielik model for Rust LLM integration (Ollama)
download-bielik: ## Download Bielik-1.5B model for local LLM via Ollama
	@echo "📥 Setting up Bielik-1.5B model for local LLM..."
	@echo "🔧 Checking if Ollama is running..."
	@if curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then \
		echo "✅ Ollama is running"; \
		echo "📥 Pulling Bielik model..."; \
		curl -s http://localhost:11434/api/pull -X POST -d '{"name":"bielik:1.5b"}' || echo "⚠️ Pull failed"; \
		echo "✅ Bielik model setup complete"; \
	else \
		echo "❌ Ollama is not running"; \
		echo "   Install Ollama first: curl -fsSL https://ollama.ai/install.sh | sh"; \
		echo "   Then start: ollama serve"; \
	fi

nlp2cmd-test: ## Test NLP2CMD integration with Polish queries
	@echo "Testing NLP2CMD Polish LLM integration..."
	@echo ""
	@if [ -f "mock_polish_llm_test.py" ]; then \
		if [ -d "venv_llm" ]; then \
			source venv_llm/bin/activate && python3 mock_polish_llm_test.py; \
		else \
			python3 mock_polish_llm_test.py; \
		fi; \
	else \
		echo "❌ Test script not found"; \
		echo "Run 'make nlp2cmd-setup' first"; \
	fi

nlp2cmd-status: ## Show NLP2CMD integration status
	@echo ""
	@echo "NLP2CMD Integration Status:"
	@echo "========================="
	@echo ""
	@if [ -d "venv_llm" ]; then \
		source venv_llm/bin/activate && python3 -c "import nlp2cmd" 2>/dev/null; \
	else \
		python3 -c "import nlp2cmd" 2>/dev/null; \
	fi; \
	if [ $$? -eq 0 ]; then \
		echo -e "  NLP2CMD:        $(GREEN)INSTALLED$(RESET)"; \
		if [ -d "venv_llm" ]; then \
			source venv_llm/bin/activate && python3 -c "import nlp2cmd; print(f'  Version: {nlp2cmd.__version__}')" 2>/dev/null || true; \
		else \
			python3 -c "import nlp2cmd; print(f'  Version: {nlp2cmd.__version__}')" 2>/dev/null || true; \
		fi; \
	else \
		echo -e "  NLP2CMD:        $(YELLOW)NOT INSTALLED$(RESET)"; \
	fi
	@echo ""
	@echo "  Models available:"
	@if [ -f "models/polka-1.1b-chat.gguf" ]; then \
		echo -e "    - Polka-1.1B: $(GREEN)Available$(RESET)"; \
	else \
		echo -e "    - Polka-1.1B: $(YELLOW)Not downloaded$(RESET)"; \
	fi
	@if curl -s http://localhost:11434/api/tags 2>/dev/null | grep -q "bielik"; then \
		echo -e "    - Bielik-1.5B: $(GREEN)Available (Ollama)$(RESET)"; \
	else \
		echo -e "    - Bielik-1.5B: $(YELLOW)Not available (Ollama)$(RESET)"; \
	fi
	@if [ -n "$$NLP2CMD_LLM_MODEL_PATH" ] && [ -f "$$NLP2CMD_LLM_MODEL_PATH" ]; then \
		echo -e "    - Local GGUF: $(GREEN)$$NLP2CMD_LLM_MODEL_PATH$(RESET)"; \
	elif [ -n "$$NLP2CMD_LLM_MODEL_PATH" ]; then \
		echo -e "    - Local GGUF: $(YELLOW)$$NLP2CMD_LLM_MODEL_PATH (not found)$(RESET)"; \
	fi
	@if curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then \
		echo -e "    - Ollama:      $(GREEN)Running$(RESET)"; \
	else \
		echo -e "    - Ollama:      $(YELLOW)Not running$(RESET)"; \
	fi
	@echo ""
	@if [ -f "local_llm_config.json" ]; then \
		echo -e "  Config:         $(GREEN)Found$(RESET)"; \
	else \
		echo -e "  Config:         $(YELLOW)Not found$(RESET)"; \
	fi
	@echo ""
	@echo "Environment:"
	@if [ -n "$$BROXEEN_NLP2CMD_ENABLED" ]; then \
		echo -e "  BROXEEN_NLP2CMD_ENABLED: $(GREEN)$$BROXEEN_NLP2CMD_ENABLED$(RESET)"; \
	else \
		echo -e "  BROXEEN_NLP2CMD_ENABLED: $(YELLOW)Not set$(RESET)"; \
	fi
	@if [ -n "$$LITELLM_MODEL" ]; then \
		echo -e "  LITELLM_MODEL:           $(GREEN)$$LITELLM_MODEL$(RESET)"; \
	fi
	@if [ -n "$$NLP2CMD_LLM_MODEL_PATH" ]; then \
		echo -e "  NLP2CMD_LLM_MODEL_PATH:  $(GREEN)$$NLP2CMD_LLM_MODEL_PATH$(RESET)"; \
	fi
	@echo ""

nlp2cmd-set-local: ## Set local GGUF model via environment variables
	@echo "Setting up local GGUF model environment..."
	@if [ -z "$(MODEL_PATH)" ]; then \
		echo "Usage: make nlp2cmd-set-local MODEL_PATH=/path/to/model.gguf"; \
		echo "Example: make nlp2cmd-set-local MODEL_PATH=models/polka-1.1b-chat.gguf"; \
		exit 1; \
	fi
	@if [ ! -f "$(MODEL_PATH)" ]; then \
		echo "❌ Model file not found: $(MODEL_PATH)"; \
		exit 1; \
	fi
	@echo "export LITELLM_MODEL=\"local/model\"" > .nlp2cmd-env
	@echo "export NLP2CMD_LLM_MODEL_PATH=\"$(MODEL_PATH)\"" >> .nlp2cmd-env
	@echo ""
	@echo "✅ Local model configured: $(MODEL_PATH)"
	@echo "📝 Environment variables saved to .nlp2cmd-env"
	@echo "🔄 To activate: source .nlp2cmd-env"
	@echo "🚀 Then run: make dev"

nlp2cmd-env-setup: ## Load NLP2CMD environment variables
	@if [ -f ".nlp2cmd-env" ]; then \
		echo "Loading NLP2CMD environment..."; \
		source .nlp2cmd-env; \
		echo "✅ Environment loaded"; \
		echo "📋 Active variables:"; \
		grep "^export" .nlp2cmd-env | sed 's/export/  /'; \
	else \
		echo "❌ .nlp2cmd-env not found"; \
		echo "💡 Create with: make nlp2cmd-set-local MODEL_PATH=/path/to/model.gguf"; \
	fi

nlp2cmd-env-show: ## Show current NLP2CMD environment variables
	@echo "Current NLP2CMD Environment:"
	@echo "============================="
	@echo ""
	@if [ -n "$$LITELLM_MODEL" ]; then \
		echo -e "  LITELLM_MODEL:          $(GREEN)$$LITELLM_MODEL$(RESET)"; \
	else \
		echo -e "  LITELLM_MODEL:          $(YELLOW)Not set$(RESET)"; \
	fi
	@if [ -n "$$NLP2CMD_LLM_MODEL_PATH" ]; then \
		if [ -f "$$NLP2CMD_LLM_MODEL_PATH" ]; then \
			echo -e "  NLP2CMD_LLM_MODEL_PATH: $(GREEN)$$NLP2CMD_LLM_MODEL_PATH$(RESET)"; \
		else \
			echo -e "  NLP2CMD_LLM_MODEL_PATH: $(YELLOW)$$NLP2CMD_LLM_MODEL_PATH (file not found)$(RESET)"; \
		fi; \
	else \
		echo -e "  NLP2CMD_LLM_MODEL_PATH: $(YELLOW)Not set$(RESET)"; \
	fi
	@if [ -f ".nlp2cmd-env" ]; then \
		echo -e "  Config file:           $(GREEN).nlp2cmd-env$(RESET)"; \
	else \
		echo -e "  Config file:           $(YELLOW)Not found$(RESET)"; \
	fi
	@echo ""


# ╔══════════════════════════════════════════════════════════════════╗
# ║  FULL SETUP (one-shot)                                         ║
# ╚══════════════════════════════════════════════════════════════════╝

setup-all: ## Full setup: NLP2CMD + Bielik model + detect + deps + OpenVINO + model
	@echo ""
	@echo -e "$(BOLD)Full setup starting...$(RESET)"
	$(MAKE) nlp2cmd-setup
	$(MAKE) download-bielik
	$(MAKE) openvino-detect
	$(MAKE) install-vision-deps
	$(MAKE) openvino-install
	$(MAKE) setup-model
	@echo ""
	@echo -e "$(GREEN)$(BOLD)Setup complete! Next: make build-n5105 && make run$(RESET)"
	@echo -e "$(GREEN)Or for development: make dev$(RESET)"
	@echo ""
