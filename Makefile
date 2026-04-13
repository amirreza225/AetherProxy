.PHONY: help build dev test lint backend-build backend-dev backend-test backend-lint \
        frontend-dev frontend-build frontend-lint deploy-up deploy-down \
        plugin-build plugin-test

GOBIN  := $(shell which go 2>/dev/null || echo /usr/local/go/bin/go)
GOPATH := $(shell go env GOPATH 2>/dev/null || echo $$HOME/go)
AIR    := $(GOPATH)/bin/air
NPM   := npm

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ── Backend ───────────────────────────────────────────────────────────────────
BACKEND_TAGS ?= with_utls,with_quic,with_grpc,with_acme,with_gvisor,with_naive_outbound,with_purego

backend-build: ## Build the Go backend binary
	cd backend && $(GOBIN) build -trimpath -ldflags="-s -w" -tags "$(BACKEND_TAGS)" -o ../bin/aetherproxy .

backend-dev: ## Run the Go backend in watch mode (requires air)
	cd backend && $(AIR)

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
deploy-up: ## Start all services via docker compose (host networking)
	docker compose --env-file deploy/.env -f deploy/docker-compose.hostnet.yml up -d --build

deploy-down: ## Stop all services
	docker compose -f deploy/docker-compose.hostnet.yml down

# ── Obfuscation plugins ───────────────────────────────────────────────────────
# Plugins must be built with the same Go toolchain and module graph as the main
# binary.  Place the resulting .so files in the directory pointed to by
# AETHER_PLUGINS_DIR (default: plugins/ next to the binary).
#
# NOTE: Go plugins are only supported on Linux and macOS.
# NOTE: Only one transport plugin (h2disguise, wscdn, grpcobfs) should be
#       enabled at a time — they all inject into the same transport field.

PLUGIN_TAGS := with_quic,with_grpc,with_utls,with_acme,with_gvisor,with_naive_outbound,with_musl,badlinkname,tfogo_checklinkname0,with_tailscale
PLUGIN_LDFLAGS := -checklinkname=0

plugin-build: ## Build all obfuscation plugins as .so files into plugins/ (optional, they are also built in statically)
	@mkdir -p plugins
	cd backend && $(GOBIN) build -buildmode=plugin -tags "plugin,$(PLUGIN_TAGS)" \
	    -ldflags "$(PLUGIN_LDFLAGS)" -o ../plugins/h2disguise.so ./core/plugin/h2disguise/so
	cd backend && $(GOBIN) build -buildmode=plugin -tags "plugin,$(PLUGIN_TAGS)" \
	    -ldflags "$(PLUGIN_LDFLAGS)" -o ../plugins/wscdn.so ./core/plugin/wscdn/so
	cd backend && $(GOBIN) build -buildmode=plugin -tags "plugin,$(PLUGIN_TAGS)" \
	    -ldflags "$(PLUGIN_LDFLAGS)" -o ../plugins/grpcobfs.so ./core/plugin/grpcobfs/so
	@echo "Plugins built in plugins/"

plugin-test: ## Run unit tests for all obfuscation plugins
	cd backend && $(GOBIN) test -race ./core/plugin/h2disguise/... ./core/plugin/wscdn/... ./core/plugin/grpcobfs/...
