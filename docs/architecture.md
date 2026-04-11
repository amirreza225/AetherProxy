# AetherProxy Architecture

## Repository layout

```
AetherProxy/
├── backend/                  # Go API server (Gin + GORM)
│   ├── api/                  # HTTP handlers, JWT session, WebSocket
│   ├── app/                  # Application bootstrap (Init / Start / Stop)
│   ├── cmd/                  # CLI commands (start, admin, setting, migration)
│   ├── config/               # Environment-driven configuration
│   ├── core/                 # sing-box wrapper + plugin interface
│   │   └── plugin/           # OutboundPlugin interface + loader
│   │       └── sample/       # Reference plugin implementation
│   ├── cronjob/              # Background cron jobs (stats, WAL checkpoint…)
│   ├── database/             # GORM + SQLite/PostgreSQL, AutoMigrate
│   │   └── model/            # GORM model definitions
│   ├── logger/               # Structured logging
│   ├── middleware/           # Gin middleware (domain validator, CORS…)
│   ├── network/              # Auto-HTTPS listener utilities
│   ├── service/              # Business logic layer
│   │   ├── config.go         # sing-box config generation & hot-reload
│   │   ├── evasion.go        # EvasionWatcher – censorship monitor
│   │   ├── node.go           # NodeService – remote VPS management + SSH deploy
│   │   ├── routing.go        # RoutingService – route.rules CRUD
│   │   └── …                 # user, client, inbound, outbound, stats…
│   ├── sub/                  # Subscription server (sing-box JSON, Clash YAML, QR)
│   ├── util/                 # Shared helpers (link gen, base64, sub info)
│   └── web/                  # Admin API HTTP server
│
├── frontend/                 # Next.js 15 admin panel
│   ├── messages/             # i18n dictionaries (en.json, fa.json)
│   └── src/
│       ├── app/              # Next.js App Router pages
│       │   ├── login/        # JWT login
│       │   └── (admin)/      # Protected admin layout
│       │       ├── dashboard/   # Live stats (WebSocket)
│       │       ├── nodes/       # Multi-node management
│       │       ├── users/       # User list
│       │       ├── subscriptions/ # Subscription link + QR code
│       │       ├── routing/     # Visual route rule editor
│       │       ├── analytics/   # Per-protocol traffic charts
│       │       ├── settings/    # Global settings display
│       │       └── plugins/     # Plugin registry
│       ├── components/ui/    # shadcn/ui component library
│       └── lib/api.ts        # Typed fetch wrapper for all backend endpoints
│
├── client-android/           # Flutter Android/iOS client (fork of hiddify-app)
│   └── android/app/          # Re-branded: dev.aetherproxy.app
│
├── client-desktop/           # Tauri 2.0 desktop client (React + Rust)
│   ├── src/                  # React frontend (connect/disconnect, subscription import)
│   └── src-tauri/            # Rust backend (sing-box process mgmt, system tray)
│
├── deploy/                   # Docker Compose, Caddy, install script
│   ├── docker-compose.yml    # backend + frontend + caddy + optional postgres
│   ├── Caddyfile             # Auto-TLS reverse proxy config
│   └── install.sh            # One-liner VPS install script
│
├── docs/                     # Extended documentation
│   ├── architecture.md       # This file
│   └── migration-sqlite-to-postgres.md
│
├── go.work                   # Go workspace (backend module)
├── Makefile                  # build / dev / test / lint / deploy targets
└── lefthook.yml              # Pre-commit hooks (Go lint, ESLint, Flutter analyze)
```

---

## Request flow

```
Browser / Client
      │
      │ HTTPS
      ▼
  Caddy (reverse proxy + auto-TLS)
      │
    ├── /api/*  ──────────►  {$API_UPSTREAM}  (Gin API server)
      │                            │
      │                            ├── JWT middleware (httpOnly cookie + Bearer)
      │                            ├── ApiHandler (GET/POST switch)
      │                            ├── ApiService (business logic)
      │                            │     ├── NodeService (SSH deploy, health check)
      │                            │     ├── RoutingService (route.rules)
      │                            │     ├── EvasionWatcher (Javid scraper)
      │                            │     └── plugin.ApplyAll (outbound transform)
      │                            └── WebSocket /api/ws/stats (2s live push)
      │                                   └── evasion alerts + onlines + status
      │
    ├── /sub/*  ──────────►  {$SUB_UPSTREAM}  (Subscription server)
      │                            ├── GET /:subid        – base64 link list
      │                            ├── GET /:subid?format=clash  – Clash YAML
      │                            ├── GET /:subid?format=json   – sing-box JSON
      │                            └── GET /qr/:subid     – QR code PNG
      │
      └── /*  ──────────────►  frontend:3000  (Next.js admin panel)
```

---

## Authentication

- Login: `POST /api/login` → issues HS256 JWT (24h) + sets `aether_token` httpOnly cookie
- All API requests: checked by `GetLoginUser()` which reads `Authorization: Bearer` header first, then `aether_token` cookie
- Frontend: token also stored in `sessionStorage` for programmatic `Authorization` header usage

---

## Database

| Driver    | When selected                                              |
|-----------|-----------------------------------------------------------|
| SQLite    | `AETHER_DB_DSN` is empty (default) or a file path         |
| PostgreSQL| `AETHER_DB_DSN` starts with `postgres://` or `host=`      |

GORM `AutoMigrate` runs on every startup via `database.Migrate()` – safe to
restart without manual schema changes.

---

## Plugin system

Plugins implement `core/plugin.OutboundPlugin`. They can be:
- **Static** – registered at startup via `plugin.RegisterPlugin()`
- **Dynamic** – loaded from a `.so` file via `plugin.LoadPlugin(path)`

The `ApplyAll(outboundJSON)` function is called during config generation to
let all enabled plugins transform outbound objects before they are written to
the sing-box config.

See `core/plugin/sample/` for a reference implementation.

---

## Environment variables

| Variable              | Default                     | Description                                  |
|-----------------------|-----------------------------|----------------------------------------------|
| `AETHER_PORT`         | `2095`                      | API server port                              |
| `AETHER_SUB_PORT`     | `2096`                      | Subscription server port                     |
| `AETHER_DB_FOLDER`    | `<binary-dir>/db`           | SQLite database directory                    |
| `AETHER_DB_DSN`       | –                           | Full DSN for PostgreSQL (overrides folder)   |
| `AETHER_JWT_SECRET`   | `change-me-in-production`   | JWT signing secret                           |
| `AETHER_ADMIN_ORIGIN` | `http://localhost:3000`     | CORS allowed origin for admin panel          |
| `AETHER_LOG_LEVEL`    | `info`                      | Log level: debug / info / warn / error       |
| `AETHER_DEBUG`        | –                           | Set to `true` to enable GORM query logging   |
| `AETHER_DOCKER_HOSTNET` | `false`                  | Signals backend is running in host-network mode |
| `AETHER_PORT_SYNC_ENABLED` | `true`                | Enable inbound firewall reconciliation        |
| `AETHER_PORT_SYNC_LOCAL_ENABLED` | `true`          | Local-host UFW reconciliation toggle          |
| `AETHER_PORT_SYNC_REMOTE_ENABLED` | `true`         | Remote-node UFW reconciliation toggle         |
| `AETHER_PORT_SYNC_RETRY_SECONDS` | `30`            | Base retry delay for failed sync tasks        |
| `AETHER_PORT_SYNC_UFW_BIN` | `ufw`                  | UFW binary path used by reconciliation        |

Deploy layer variables used by Caddy upstream routing:

- `API_UPSTREAM` (default `backend:2095`)
- `SUB_UPSTREAM` (default `backend:2096`)
