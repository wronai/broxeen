.PHONY: help install dev dev-nvidia build test test-watch test-coverage clean lint format check clean-all stop stop-port stop-services stop-all status restart

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

dev: ## Start development server with hot reload
	npm run tauri dev

dev-browser: ## Start frontend-only Vite dev server
	npm run dev

dev-nvidia: ## Start development server with Nvidia GPU fixes
	WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITE_OPERATORS_WORKAROUND=1 npm run tauri dev

build: ## Build production version
	npm run tauri build

test: ## Run all tests
	npm test

test-watch: ## Run tests in watch mode
	npm run test:watch

test-coverage: ## Run tests with coverage report
	npm run test:coverage

lint: ## Run linting checks
	npm run lint || true

format: ## Format code
	npm run format || true

check: ## Run type checking
	npm run check || true

clean: ## Clean build artifacts and dependencies
	rm -rf node_modules dist target
	rm -rf .coverage coverage
	npm cache clean --force || true

clean-all: ## Full clean including Docker
	$(MAKE) clean
	docker compose down -v 2>/dev/null || true
	docker system prune -f 2>/dev/null || true

stop: ## Stop development server and related processes
	@echo "🛑 Stopping Broxeen development server..."
	@pkill -f "npm run tauri dev" 2>/dev/null || true
	@pkill -f "vite" 2>/dev/null || true
	@pkill -f "tauri dev" 2>/dev/null || true
	@sleep 1
	@echo "✅ Development server stopped"

stop-port: ## Stop processes running on port 5173
	@echo "🛑 Stopping processes on port 5173..."
	@if lsof -i:5173 >/dev/null 2>&1; then \
		lsof -ti:5173 | xargs -r kill -9 2>/dev/null || true; \
		sleep 1; \
	fi
	@echo "✅ Port 5173 cleared"

stop-services: ## Stop all related services and background processes
	@echo "🛑 Stopping all Broxeen services..."
	@pkill -f "broxeen" 2>/dev/null || true
	@pkill -f "node.*5173" 2>/dev/null || true
	@pkill -f "npm.*dev" 2>/dev/null || true
	@pkill -f "tauri.*dev" 2>/dev/null || true
	@pkill -f "vite.*5173" 2>/dev/null || true
	@sleep 1
	@echo "✅ All services stopped"

stop-all: ## Stop everything (services + port + clean)
	@echo "🛑 Stopping all Broxeen processes and cleaning..."
	@$(MAKE) stop-services >/dev/null 2>&1 || true
	@$(MAKE) stop-port >/dev/null 2>&1 || true
	@echo "🧹 Cleaning up temporary files..."
	@rm -rf /tmp/broxeen-* 2>/dev/null || true
	@rm -rf .vite 2>/dev/null || true
	@echo "✅ All processes stopped and cleaned"

status: ## Show status of Broxeen processes and ports
	@echo "📊 Broxeen Status Report:"
	@echo "========================"
	@if pgrep -f "npm run tauri dev" >/dev/null; then \
		echo "✅ Development server: RUNNING"; \
	else \
		echo "❌ Development server: STOPPED"; \
	fi
	@if lsof -i:5173 >/dev/null 2>&1; then \
		echo "✅ Port 5173: IN USE"; \
		lsof -i:5173; \
	else \
		echo "❌ Port 5173: FREE"; \
	fi
	@if pgrep -f "vite" >/dev/null; then \
		echo "✅ Vite: RUNNING"; \
	else \
		echo "❌ Vite: STOPPED"; \
	fi

restart: ## Restart development server
	@echo "🔄 Restarting Broxeen development server..."
	@$(MAKE) stop-all >/dev/null 2>&1 || true
	@sleep 2
	@echo "🚀 Starting development server..."
	@npm run tauri dev
