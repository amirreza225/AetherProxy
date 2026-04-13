# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is AetherProxy

AetherProxy is a self-hostable censorship-circumvention platform. It wraps [sing-box](https://github.com/SagerNet/sing-box) v1.13.4 with a Go API server, Next.js admin panel, multi-node management, subscription generation, a Flutter Android client (`client-android/`), and a Tauri/Vite desktop client (`client-desktop/`). Primary protocols: VLESS + Reality + uTLS and Hysteria2.

## Commands

### Backend (Go)
```bash
make backend-build    # go build -trimpath -ldflags="-s -w" -tags "with_utls,with_quic,..." -o ../bin/aetherproxy .
make backend-dev      # hot-reload with cosmtrek/air (go install github.com/air-verse/air@latest)
make backend-test     # go test -race ./...
make backend-lint     # golangci-lint run ./...
```

Default build tags (`BACKEND_TAGS`): `with_utls,with_quic,with_grpc,with_acme,with_gvisor,with_naive_outbound,with_purego`. Override via `make backend-build BACKEND_TAGS=...`.

> `make backend-dev` requires `cosmtrek/air`, not the R-language `air` tool. If `which air` points to the wrong one, install: `go install github.com/air-verse/air@latest` and ensure `$(go env GOPATH)/bin` is in `$PATH`. As a fallback: `cd backend && go run .`

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

### Obfuscation plugins
```bash
make plugin-build     # compile built-in plugins as optional .so files into plugins/
make plugin-test      # go test -race ./core/plugin/h2disguise/... ./core/plugin/wscdn/... ./core/plugin/grpcobfs/...
```

### Docker / Deploy
```bash
make deploy-up        # docker compose --env-file deploy/.env -f deploy/docker-compose.hostnet.yml up -d --build
make deploy-down      # stop all services
# With PostgreSQL:
docker compose -f deploy/docker-compose.hostnet.yml --profile postgres up -d
```

### Pre-commit hooks (lefthook)
`lefthook.yml` runs backend lint, frontend lint, and `flutter analyze` in parallel on every commit. Install with `lefthook install`.

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
| API v2 | `api/apiV2Handler.go` | Token-based auth for programmatic access (separate from JWT cookies) |
| Admin CLI | `cmd/` | Bootstrap and management commands (`cmd.go`, `admin.go`) |
| Services | `service/` | All business logic (see below) |
| sing-box wrapper | `core/` | Process management, protocol registration, traffic stats |
| Obfuscation plugins | `core/plugin/` | OutboundPlugin interface + built-in DPI-evasion plugins |
| Subscriptions | `sub/` | Base64 / Clash YAML / sing-box JSON / QR code generation |
| Database | `database/` | GORM models, SQLite (default) or PostgreSQL |
| Background jobs | `cronjob/` | Stats collection, health checks, WAL checkpoint |
| Config | `config/config.go` | All env-var parsing |
| Network | `network/` | Auto-HTTPS listener/conn wrappers |
| Middleware | `middleware/` | Domain validation middleware |
| Utilities | `util/` | Link generation, base64, outbound JSON helpers |
| Logger | `logger/` | Structured logging wrapper |

**Key service files:**
- `service/config.go` — generates sing-box JSON config and hot-reloads it
- `service/inbounds.go` — CRUD for inbound listeners (VLESS, Hysteria2, etc.)
- `service/outbounds.go` — CRUD for outbounds; calls `plugin.ApplyAll()` on every outbound JSON before it reaches sing-box (both batch startup and live hot-add paths)
- `service/tls.go` — manages TLS profile configs (certificates, Reality keys)
- `service/routing.go` — manages sing-box routing rules
- `service/user.go` — user management (traffic limits, expiry, subscription tokens)
- `service/node.go` — SSH deploy to remote nodes, 30-second health checks, failover
- `service/evasion.go` — scrapes Javid for censorship events, auto-switches protocols
- `service/discovery.go` — gossip-based decentralized peer discovery via hashicorp/memberlist; persists discovered peers to DB; supports signed bootstrap manifests (Ed25519)

### Frontend (`frontend/src/`)

App Router layout with a protected `(admin)` route group. Key directories:
- `app/(admin)/` — dashboard (WebSocket live stats), nodes, users, subscriptions, routing, analytics, plugins
- `components/ui/` — Base UI components (not standard shadcn — uses `@base-ui-components/react`, see existing components before adding new ones)
- `lib/api.ts` — typed fetch wrapper for all backend endpoints; uses `credentials: "include"` for JWT cookie
- `i18n/` + `messages/` — EN and FA/Farsi RTL via next-intl

### Plugin system (`backend/core/plugin/`)

The `OutboundPlugin` interface (`plugin.go`) allows transforming sing-box outbound JSON before it is applied. `ApplyAll()` is called in `service/outbounds.go` on every outbound.

**Three built-in DPI-evasion plugins** are registered statically in `app/app.go::Init()`:

| Plugin | Package | What it does |
|--------|---------|-------------|
| `h2disguise` | `core/plugin/h2disguise` | Injects HTTP/2 transport with browser UA headers |
| `wscdn` | `core/plugin/wscdn` | Routes over WebSocket through a Cloudflare Workers relay |
| `grpcobfs` | `core/plugin/grpcobfs` | Injects gRPC transport mimicking Google API service names |

All three default to `enabled: false`. **Only one transport plugin should be enabled at a time** — they all write to the same `transport` field. They skip Hysteria2/QUIC outbound types automatically.

The `wscdn` plugin requires the companion Cloudflare Worker in `deploy/cloudflare-worker/` (Workers Paid plan for TCP socket API). The plugin only rewrites the outbound's `server` field at runtime — the database retains the original origin address.

Each built-in plugin also ships a `so/main.go` wrapper (build tag `plugin`) for optional standalone `.so` compilation. Third-party `.so` plugins are scanned from `AETHER_PLUGINS_DIR` at startup via `app.loadPlugins()`.

**Restart safety:** `registerBuiltinPlugins()` is called in `Init()` (once), not `Start()`, because `RestartApp()` calls `Start()` again and `RegisterPlugin` panics on duplicate names.

### Database

GORM AutoMigrate (idempotent) runs on every startup. Driver is selected by whether `AETHER_DB_DSN` is set (PostgreSQL) or not (SQLite in `AETHER_DB_FOLDER`). Default credentials on first run: `admin` / `admin`. Login form fields are `user` and `pass` (not `username`/`password`).

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
| `AETHER_PLUGINS_DIR` | `<bin-dir>/plugins` | Directory scanned for third-party `.so` plugins |
| `NEXT_PUBLIC_API_URL` | `http://localhost:2095` | Frontend → backend URL (embedded at build time) |
| `AETHER_GOSSIP_PORT` | `7946` | UDP port for memberlist gossip |
| `AETHER_GOSSIP_BOOTSTRAP` | — | Comma-separated `host:port` bootstrap peers |
| `AETHER_GOSSIP_MANIFEST_URL` | — | URL to fetch signed bootstrap manifest JSON |
| `AETHER_GOSSIP_MANIFEST_PUBKEY` | — | Base64 Ed25519 pubkey to verify manifest signatures |

## Go workspace

`go.work` declares the `backend/` module. Run `go` commands from inside `backend/` or use `go work` from the repo root.

## WebSocket live stats

`GET /api/ws/stats` pushes traffic + evasion alerts every 2 seconds. The dashboard page (`frontend/src/app/(admin)/dashboard/`) consumes this.

## Subscription formats

`GET /sub/<token>` — base64 URI list  
`GET /sub/<token>?format=clash` — Clash/Mihomo YAML  
`GET /sub/<token>?format=json` — sing-box JSON  
`GET /sub/qr/<token>` — QR code PNG
