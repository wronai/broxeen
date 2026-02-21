.PHONY: help install dev dev-nvidia build test test-watch test-coverage clean lint format check clean-all

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

dev: ## Start development server with hot reload
	npm run tauri dev

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
