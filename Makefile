.PHONY: help build dev test lint backend-build backend-dev backend-test backend-lint \
        frontend-dev frontend-build frontend-lint deploy-up deploy-down

GOBIN := $(shell which go 2>/dev/null || echo /usr/local/go/bin/go)
NPM   := npm

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ── Backend ───────────────────────────────────────────────────────────────────
backend-build: ## Build the Go backend binary
	cd backend && $(GOBIN) build -trimpath -ldflags="-s -w" -o ../bin/aetherproxy .

backend-dev: ## Run the Go backend in watch mode (requires air)
	cd backend && air

backend-test: ## Run Go unit tests
	cd backend && $(GOBIN) test ./... -race -timeout 60s

backend-lint: ## Lint Go code (requires golangci-lint)
	cd backend && golangci-lint run ./...

# ── Frontend ──────────────────────────────────────────────────────────────────
frontend-dev: ## Start Next.js dev server
	cd frontend && $(NPM) run dev

frontend-build: ## Build Next.js for production
	cd frontend && $(NPM) run build

frontend-lint: ## Lint Next.js code
	cd frontend && $(NPM) run lint

# ── Combined shortcuts ────────────────────────────────────────────────────────
build: backend-build frontend-build ## Build everything

dev: ## Start backend + frontend dev servers (requires tmux or two terminals)
	@echo "Run 'make backend-dev' and 'make frontend-dev' in separate terminals."

test: backend-test ## Run all tests

lint: backend-lint frontend-lint ## Lint all code

# ── Deploy ────────────────────────────────────────────────────────────────────
deploy-up: ## Start all services via docker compose
	docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build

deploy-down: ## Stop all services
	docker compose -f deploy/docker-compose.yml down
