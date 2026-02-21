.PHONY: help install test test-docker dev prod build clean lint

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies locally
	pip install -r requirements.txt

test: ## Run tests locally
	pytest tests/ -v --tb=short --cov=app --cov-report=term-missing

test-docker: ## Run tests in Docker
	docker compose --profile test run --rm broxeen-test

dev: ## Start development server (hot reload)
	docker compose --profile dev up --build broxeen-dev

prod: ## Start production server
	docker compose up --build -d broxeen

build: ## Build Docker image
	docker compose build broxeen

clean: ## Stop containers and remove volumes
	docker compose --profile dev --profile test down -v
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -delete 2>/dev/null || true
	rm -rf .pytest_cache htmlcov .coverage

lint: ## Check code with basic checks
	python -m py_compile app/__init__.py
	python -m py_compile app/phonetic.py
	python -m py_compile app/resolver.py
	python -m py_compile app/extractor.py
	python -m py_compile app/cache.py
	python -m py_compile app/contacts.py
	python -m py_compile app/routes.py
	python -m py_compile app/factory.py
	python -m py_compile wsgi.py
	@echo "✓ All modules compile successfully"

run-local: ## Run locally without Docker
	python wsgi.py
