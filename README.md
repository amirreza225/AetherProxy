# AetherProxy

**AetherProxy** is a production-grade, self-hostable censorship-circumvention platform purpose-built for high-threat environments (Iran, Russia, China, …). It combines [sing-box](https://github.com/SagerNet/sing-box) as the universal proxy engine with a modern admin panel, multi-node management, automatic censorship monitoring, and polished cross-platform clients.

> **Primary protocols:** VLESS + Reality + uTLS (DPI masquerading) and Hysteria2 (QUIC/UDP anti-throttling).

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick Start (Docker)](#quick-start-docker)
- [Manual Setup](#manual-setup)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Subscription Formats](#subscription-formats)
- [Android Client](#android-client)
- [Desktop Client (Tauri)](#desktop-client-tauri)
- [Plugin System](#plugin-system)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## Features

| Phase | Feature | Status |
|---|---|---|
| 1 | JWT authentication (httpOnly cookie + Bearer) | ✅ |
| 1 | CORS middleware (env-configurable origin) | ✅ |
| 1 | WebSocket live stats (`/api/ws/stats`) | ✅ |
| 1 | Admin panel – Dashboard, Nodes, Users, Subscriptions, Settings | ✅ |
| 1 | i18n – English + Persian (RTL) | ✅ |
| 1 | Docker Compose + Caddy auto-TLS deploy | ✅ |
| 2 | Multi-node management (SSH deploy + 30s health checks) | ✅ |
| 2 | Failover – offline nodes excluded from subscription output | ✅ |
| 2 | PostgreSQL support (`AETHER_DB_DSN`) | ✅ |
| 2 | Visual routing rule editor | ✅ |
| 2 | Tauri 2.0 desktop client skeleton | ✅ |
| 3 | EvasionWatcher – Javid scraper, auto-promotes Hysteria2 | ✅ |
| 3 | Real-time evasion alerts via WebSocket | ✅ |
| 3 | Analytics dashboard (per-protocol traffic, evasion events) | ✅ |
| 3 | Clash/Mihomo YAML subscription (`?format=clash`) | ✅ |
| 3 | QR code PNG endpoint (`/sub/qr/:token`) | ✅ |
| 3 | `Profile-Update-Interval` header in subscription responses | ✅ |
| 4 | Plugin system (`OutboundPlugin` interface + .so loader) | ✅ |
| 4 | Sample plugin with tag-suffix transform | ✅ |

---

## Architecture

```
Caddy (auto-TLS)
  ├── /api/*  → backend:2095   (Go/Gin API + WebSocket)
  ├── /sub/*  → backend:2096   (Subscription server)
  └── /*      → frontend:3000  (Next.js admin panel)
```

See [`docs/architecture.md`](docs/architecture.md) for the full request flow, module map, and database schema.

---

## Quick Start (Docker)

**Prerequisites:** Docker + Docker Compose v2, a domain pointed at your VPS.

```bash
curl -fsSL https://raw.githubusercontent.com/amirreza225/AetherProxy/main/deploy/install.sh | bash
```

This script:
1. Clones the repo to `/opt/aetherproxy`
2. Generates a random `AETHER_JWT_SECRET`
3. Creates `deploy/.env` for you to edit
4. Runs `docker compose up -d`

After the install, **edit `/opt/aetherproxy/deploy/.env`** to set your real domains, then:

```bash
docker compose -f /opt/aetherproxy/deploy/docker-compose.yml restart
```

### PostgreSQL (optional)

Add the Postgres vars to `.env` and start with the `postgres` profile:

```bash
# deploy/.env
AETHER_DB_DSN=postgres://aether:secret@postgres:5432/aether?sslmode=disable
POSTGRES_PASSWORD=secret

docker compose --profile postgres -f deploy/docker-compose.yml up -d
```

See [`docs/migration-sqlite-to-postgres.md`](docs/migration-sqlite-to-postgres.md) for data migration.

---

## Manual Setup

### Backend

```bash
cd backend
go build -trimpath -o ../bin/aetherproxy .

export AETHER_JWT_SECRET="your-secret"
export AETHER_ADMIN_ORIGIN="http://localhost:3000"
../bin/aetherproxy
```

### Frontend

```bash
cd frontend
npm install
npm run dev          # dev server on http://localhost:3000
npm run build        # production build
```

### Android client

```bash
cd client-android
flutter pub get
flutter analyze
flutter build apk --split-per-abi
```

### Desktop client (Tauri)

```bash
cd client-desktop
npm install
npm run tauri dev    # development
npm run tauri build  # produce .msi / .dmg / .AppImage
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AETHER_PORT` | `2095` | API server TCP port |
| `AETHER_SUB_PORT` | `2096` | Subscription server port |
| `AETHER_DB_FOLDER` | `<binary-dir>/db` | SQLite database directory |
| `AETHER_DB_DSN` | – | Full GORM DSN for PostgreSQL (overrides folder) |
| `AETHER_JWT_SECRET` | `change-me-in-production` | JWT HS256 signing secret |
| `AETHER_ADMIN_ORIGIN` | `http://localhost:3000` | CORS allowed origin |
| `AETHER_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `AETHER_DEBUG` | – | Set to `true` for verbose GORM query logging |
| `NEXT_PUBLIC_API_URL` | `http://localhost:2095` | Frontend → backend API URL |
| `NEXT_PUBLIC_SUB_URL` | `http://localhost:2096` | Frontend subscription base URL |

---

## API Reference

All endpoints except `/api/login` require a valid JWT via:
- `Authorization: Bearer <token>` header, **or**
- `aether_token` httpOnly cookie (set automatically on login)

### Authentication

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/login` | Login – returns `{ success, obj: { token } }` |
| `GET` | `/api/logout` | Expire cookie and invalidate session |
| `POST` | `/api/changePass` | Change admin password |

### Core Data

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/load` | Full config + clients + inbounds (delta-aware via `?lu=` timestamp) |
| `GET` | `/api/inbounds` | All inbound configurations |
| `GET` | `/api/outbounds` | All outbound configurations |
| `GET` | `/api/clients` | All clients |
| `GET` | `/api/users` | Admin user list |
| `GET` | `/api/settings` | Global settings |
| `GET` | `/api/stats` | Traffic statistics |
| `GET` | `/api/logs` | Recent sing-box logs |
| `POST` | `/api/save` | Save full configuration |

### Nodes (Phase 2)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/nodes` | List all remote VPS nodes |
| `POST` | `/api/createNode` | Add a new node |
| `POST` | `/api/updateNode` | Update node metadata |
| `POST` | `/api/deleteNode` | Delete a node (stops health check) |
| `POST` | `/api/deployNode` | SSH-deploy current sing-box config to node |

### Routing (Phase 2)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/routing` | Get current route.rules |
| `POST` | `/api/saveRouting` | Replace route.rules + hot-reload |

### Analytics (Phase 3)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/analytics?h=24` | Per-protocol traffic + evasion events (`h` = 24 / 168 / 720) |

### Plugins (Phase 4)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/plugins` | List registered plugins |
| `POST` | `/api/setPluginEnabled` | Enable / disable a plugin |
| `POST` | `/api/setPluginConfig` | Update plugin JSON config |

### WebSocket

| Path | Description |
|---|---|
| `GET` `/api/ws/stats` | Streams `{ onlines, status, evasionAlerts }` every 2 seconds |

---

## Subscription Formats

The subscription server runs on a separate port (`AETHER_SUB_PORT`, default `2096`).

| URL pattern | Output | Description |
|---|---|---|
| `/sub/<token>` | Base64 URI list | Default – compatible with most clients |
| `/sub/<token>?format=clash` | Clash/Mihomo YAML | For FlClash, Mihomo, Clash Meta |
| `/sub/<token>?format=json` | sing-box JSON | For sing-box native clients |
| `/sub/qr/<token>` | PNG image | QR code of the subscription URL |

All responses include `Profile-Update-Interval`, `Subscription-Userinfo`, and `Profile-Title` headers.

**Failover:** Nodes whose health check returns `offline` are automatically excluded from subscription output.

---

## Android Client

The Android client is a re-branded fork of [hiddify/hiddify-app](https://github.com/hiddify/hiddify-app):

- **Package ID:** `dev.aetherproxy.app`
- **Deep links:** `aetherproxy://`, `hiddify://`, `v2ray://`, `clash://`, `sing-box://`
- Import a subscription by sharing an `aetherproxy://` or HTTPS subscription URL with the app, or scan the QR code from the admin panel.

```bash
flutter build apk --split-per-abi   # debug/test APKs
flutter build appbundle             # Google Play release
```

---

## Desktop Client (Tauri)

Located in `client-desktop/`. Built with Tauri 2.0 (Rust) + React + TypeScript.

**Features:**
- One-click Connect / Disconnect via system tray
- Subscription import (`aetherproxy://` deep link or paste URL)
- Live stats (bytes up/down, uptime)
- Starts/stops the bundled `sing-box` binary via Tauri `shell` commands

**Build:**

```bash
cd client-desktop
npm install
npm run tauri build
```

Artifacts: `.msi` (Windows), `.dmg`+`.app` (macOS), `.AppImage`+`.deb` (Linux).

---

## Plugin System

AetherProxy supports Go outbound plugins that can modify sing-box outbound JSON
at config-generation time.

### Interface

```go
type OutboundPlugin interface {
    Name()          string
    Description()   string
    DefaultConfig() json.RawMessage
    Apply(outboundJSON, cfgJSON json.RawMessage) (json.RawMessage, error)
    Enabled()       bool
    SetEnabled(bool)
}
```

### Static registration

```go
import "github.com/aetherproxy/backend/core/plugin"
import "github.com/aetherproxy/backend/core/plugin/sample"

func init() {
    plugin.RegisterPlugin(sample.Plugin)
}
```

### Dynamic loading (.so)

```bash
# Build as shared library (Linux only)
go build -buildmode=plugin -o my_plugin.so ./path/to/plugin/pkg

# The .so must export a symbol named "Plugin" satisfying OutboundPlugin
```

```go
plugin.LoadPlugin("/path/to/my_plugin.so")
```

See [`backend/core/plugin/sample/`](backend/core/plugin/sample/) for a reference implementation.

---

## Development

```bash
# Build everything
make build

# Start backend dev server (requires air: go install github.com/air-verse/air@latest)
make backend-dev

# Start frontend dev server
make frontend-dev

# Run all tests
make test

# Lint all code
make lint

# Deploy via Docker Compose
make deploy-up
```

Pre-commit hooks are managed by [lefthook](https://github.com/evilmartians/lefthook):

```bash
brew install lefthook    # or: go install github.com/evilmartians/lefthook@latest
lefthook install
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes and ensure `make lint` + `make test` pass
4. Open a pull request against `main`

---

## License

MIT — see [LICENSE](LICENSE).

---

> Built with ❤️ for freedom of access. AetherProxy is a tool; responsibility for its use lies with the operator.
