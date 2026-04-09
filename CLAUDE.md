# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is AetherProxy

AetherProxy is a self-hostable censorship-circumvention platform. It wraps [sing-box](https://github.com/SagerNet/sing-box) (the universal proxy engine) with a Go API server, Next.js admin panel, multi-node management, subscription generation, and a Flutter Android client. Primary protocols: VLESS + Reality + uTLS and Hysteria2.

## Commands

### Backend (Go)
```bash
make backend-build    # go build -trimpath -o ../bin/aetherproxy .
make backend-dev      # hot-reload with air (requires: go install github.com/air-verse/air@latest)
make backend-test     # go test -race ./...
make backend-lint     # golangci-lint run ./...
```

Run a single Go test:
```bash
cd backend && go test -run TestFunctionName ./path/to/package/...
```

### Frontend (Next.js)
```bash
make frontend-dev     # next dev  →  http://localhost:3000
make frontend-build   # next build
make frontend-lint    # eslint
```

### Combined
```bash
make build            # backend + frontend production build
make test             # all tests
make lint             # all linters (Go + JS + Flutter pre-commit hooks via lefthook)
```

### Docker / Deploy
```bash
make deploy-up        # docker compose -f deploy/docker-compose.yml up -d
make deploy-down      # stop all services
# With PostgreSQL:
docker compose -f deploy/docker-compose.yml --profile postgres up -d
```

## Architecture

### Request flow

```
Client → Caddy (TLS termination)
    /api/*      → backend :2095  (Gin REST + WebSocket)
    /sub/*      → backend :2096  (subscription server)
    /*          → frontend :3000 (Next.js admin panel)
```

### Backend layers (`backend/`)

| Layer | Path | Responsibility |
|-------|------|----------------|
| Entry | `main.go` | Signal handling; SIGHUP triggers restart |
| Lifecycle | `app/app.go` | Init → Start → Stop orchestration |
| HTTP | `web/web.go` | Gin setup, CORS, JWT middleware |
| Handlers | `api/apiHandler.go` | Route registration and HTTP dispatch |
| Services | `service/` | All business logic (see below) |
| sing-box wrapper | `core/` | Process management, protocol registration, traffic stats |
| Subscriptions | `sub/` | Base64 / Clash YAML / sing-box JSON / QR code generation |
| Database | `database/` | GORM models, SQLite (default) or PostgreSQL |
| Background jobs | `cronjob/` | Stats collection, health checks, WAL checkpoint |
| Config | `config/config.go` | All env-var parsing |

**Key service files:**
- `service/config.go` — generates sing-box JSON config and hot-reloads it
- `service/node.go` — SSH deploy to remote nodes, 30-second health checks, failover
- `service/evasion.go` — scrapes Javid for censorship events, auto-switches protocols

### Frontend (`frontend/src/`)

App Router layout with a protected `(admin)` route group. Key directories:
- `app/(admin)/` — dashboard (WebSocket live stats), nodes, users, subscriptions, routing, analytics, plugins
- `components/ui/` — shadcn/ui components
- `lib/api.ts` — typed fetch wrapper for all backend endpoints
- `i18n/` + `messages/` — EN and FA/Farsi RTL via next-intl

### Plugin system (`backend/core/plugin/`)

Outbound plugins are compiled Go `.so` files implementing the `OutboundPlugin` interface. A reference implementation is in `core/plugin/sample/`.

### Database

GORM AutoMigrate (idempotent) runs on every startup. Driver is selected by whether `AETHER_DB_DSN` is set (PostgreSQL) or not (SQLite in `AETHER_DB_FOLDER`).

## Environment variables

| Variable | Default | Notes |
|----------|---------|-------|
| `AETHER_PORT` | `2095` | API port |
| `AETHER_SUB_PORT` | `2096` | Subscription server port |
| `AETHER_DB_FOLDER` | `<bin-dir>/db` | SQLite path |
| `AETHER_DB_DSN` | — | PostgreSQL DSN; overrides SQLite |
| `AETHER_JWT_SECRET` | `change-me-in-production` | HS256 signing secret |
| `AETHER_ADMIN_ORIGIN` | `http://localhost:3000` | CORS allowed origin |
| `AETHER_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |
| `AETHER_DEBUG` | — | `true` enables verbose GORM logging |
| `NEXT_PUBLIC_API_URL` | `http://localhost:2095` | Frontend → backend URL |

## Go workspace

`go.work` declares the `backend/` module. Run `go` commands from inside `backend/` or use `go work` from the repo root.

## WebSocket live stats

`GET /api/ws/stats` pushes traffic + evasion alerts every 2 seconds. The dashboard page (`frontend/src/app/(admin)/dashboard/`) consumes this.

## Subscription formats

`GET /sub/<token>` — base64 URI list  
`GET /sub/<token>?format=clash` — Clash/Mihomo YAML  
`GET /sub/<token>?format=json` — sing-box JSON  
`GET /sub/qr/<token>` — QR code PNG
