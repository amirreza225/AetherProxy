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
- [Client Management](#client-management)
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

**Prerequisites:**
- Ubuntu/Debian VPS with root access
- Docker + Docker Compose v2 (installer can auto-install Docker)
- Two DNS records already pointed to your VPS IP: panel domain + API domain

```bash
curl -fsSL https://raw.githubusercontent.com/amirreza225/AetherProxy/main/deploy/install.sh | sudo bash -s -- --yes
```

This script:
1. Clones or updates the repo at `/opt/aetherproxy`
2. Prompts for `PANEL_DOMAIN` and `API_DOMAIN` (if `deploy/.env` does not already exist)
3. Generates a random `AETHER_JWT_SECRET`
4. Creates `deploy/.env`
5. Builds and starts services with Docker Compose

If `deploy/.env` already exists, the installer skips domain prompts and reuses your existing config.

### Non-interactive install (CI / automation)

```bash
PANEL_DOMAIN=panel.example.com API_DOMAIN=api.example.com \
curl -fsSL https://raw.githubusercontent.com/amirreza225/AetherProxy/main/deploy/install.sh | sudo -E bash -s -- --yes --non-interactive
```

### Low-RAM VPS behavior (2GB servers)

The installer automatically enables a conservative build mode on small-memory hosts (below ~3GB RAM).
You can also force it explicitly:

```bash
curl -fsSL https://raw.githubusercontent.com/amirreza225/AetherProxy/main/deploy/install.sh | sudo bash -s -- --yes --low-ram
```

Or with env var:

```bash
AETHER_LOW_RAM_BUILD=1 curl -fsSL https://raw.githubusercontent.com/amirreza225/AetherProxy/main/deploy/install.sh | sudo -E bash -s -- --yes
```

For manual rebuilds on small VPSes, use conservative build settings:

```bash
GO_BUILD_P=1 GO_BUILD_GOMAXPROCS=1 GO_BUILD_GOMEMLIMIT=700MiB GO_BUILD_GOGC=30 COMPOSE_PARALLEL_LIMIT=1 \
docker compose --env-file deploy/.env -f deploy/docker-compose.hostnet.yml up -d --build
```

Or use the Makefile shortcut:

```bash
make deploy-up-lowram
```

After install/update, you can restart services manually anytime with:

```bash
docker compose -f /opt/aetherproxy/deploy/docker-compose.yml restart
```

### Host-network backend mode (recommended for host firewall automation)

If you want backend-in-container to reconcile host UFW rules for inbound ports,
enable host-network override mode:

1. Edit `deploy/.env` and set:

```bash
AETHER_DOCKER_HOSTNET=1
AETHER_PORT_SYNC_LOCAL_ENABLED=true
API_UPSTREAM=host.docker.internal:2095
SUB_UPSTREAM=host.docker.internal:2096
```

2. Start with override file:

```bash
docker compose --env-file deploy/.env \
  -f deploy/docker-compose.hostnet.yml \
  up -d --build
```

In default bridge mode, local host-firewall sync is typically disabled while remote-node sync remains enabled.

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
| `AETHER_LOG_THROTTLE_DISABLED` | `false` | Set to `true` to disable repeat-log throttling during deep debugging |
| `AETHER_LOG_AUTO_THROTTLE_WINDOW_SECONDS` | `20` | Global window (seconds) for auto-throttling identical `INFO`/`WARNING`/`ERROR` logs (`0` disables) |
| `AETHER_LOG_AUTO_THROTTLE_DEBUG` | `false` | Include `DEBUG` logs in global auto-throttling |
| `AETHER_GOSSIP_PORT` | `7946` | Memberlist discovery port (TCP/UDP) |
| `AETHER_DOCKER_HOSTNET` | `false` | Signals backend runtime is host-networked (used by local firewall capability checks) |
| `AETHER_PORT_SYNC_ENABLED` | `true` | Enable inbound port/firewall automation |
| `AETHER_PORT_SYNC_LOCAL_ENABLED` | `true` | Reconcile local host firewall rules |
| `AETHER_PORT_SYNC_REMOTE_ENABLED` | `true` | Reconcile remote node firewall rules over SSH |
| `AETHER_PORT_SYNC_RETRY_SECONDS` | `30` | Base retry delay (seconds) for failed sync tasks |
| `AETHER_PORT_SYNC_UFW_BIN` | `ufw` | UFW binary path used by reconciliation |
| `NEXT_PUBLIC_API_URL` | `http://localhost:2095` | Frontend → backend API URL |
| `NEXT_PUBLIC_SUB_URL` | `http://localhost:2096` | Frontend subscription base URL |
| `GO_BUILD_P` | – | Optional `go build` package parallelism (`1` recommended for 2GB VPS) |
| `GO_BUILD_GOMAXPROCS` | – | Optional max OS threads for Go build (`1` recommended for 2GB VPS) |
| `GO_BUILD_GOMEMLIMIT` | – | Optional Go compiler memory cap (example: `700MiB`) |
| `GO_BUILD_GOGC` | – | Optional Go compiler GC aggressiveness (example: `30`) |
| `COMPOSE_PARALLEL_LIMIT` | – | Optional Compose build parallelism (`1` for low-RAM hosts) |

Port sync automation manages only AetherProxy-tagged UFW rules. In containerized deployments, full host-firewall control requires host-network mode and container network capabilities (NET_ADMIN).
When discovery gossip is active (or bootstrap/manifest discovery is configured), PortSync also manages `AETHER_GOSSIP_PORT` for both TCP and UDP.

---

## Client Management

This section explains the two distinct concepts of **admin users** (people who manage the panel) and **clients** (end-users who connect through proxy accounts), and the full lifecycle of creating and distributing proxy access.

### 1. Admin login and first-run security

On first start, AetherProxy creates one admin account with default credentials:

| Field | Default |
|---|---|
| Username | `admin` |
| Password | `admin` |

> **⚠️ Change these immediately after deployment.**

Open the admin panel (`https://<PANEL_DOMAIN>`) and navigate to **Settings → Change Password**, or call the API directly:

```bash
curl -X POST https://<API_DOMAIN>/api/changePass \
  -d "oldPass=admin&newUsername=myadmin&newPass=StrongP@ss!"
```

The login form fields are `user` and `pass` (not `username` / `password`):

```bash
curl -X POST https://<API_DOMAIN>/api/login \
  -d "user=myadmin&pass=StrongP@ss!"
```

A successful login sets an `aether_token` httpOnly cookie and returns `{ "obj": { "token": "<jwt>" } }`. Pass the token as a `Bearer` header for subsequent API calls.

---

### 2. Create inbounds (proxy listeners)

Before you can give clients access, you need at least one **inbound** — a sing-box listening endpoint that accepts proxy connections.

In the admin panel go to **Inbounds → Add Inbound** and choose a protocol:

| Protocol | Recommended use |
|---|---|
| `vless` + Reality + uTLS | Low-traffic or high-censorship environments; looks like HTTPS |
| `hysteria2` | High-throughput, lossy networks (QUIC/UDP) |
| `trojan` | TLS-based, wide client support |
| `shadowsocks` | Simple; pair with ShadowTLS for obfuscation |

Assign a unique **tag** (e.g. `vless-reality`). This tag is used in proxy links delivered to clients.

---

### 3. Create a client account

A **client** is a named proxy account. Its `name` doubles as the subscription token — keep it unguessable (treat it like a password).

#### Via the admin panel

1. Go to **Clients → Add Client**.
2. Fill in the required fields:

| Field | Description |
|---|---|
| **Name** | Unique identifier — also the subscription URL slug (e.g. `alice-2024`). |
| **Inbounds** | Select one or more inbounds the client may use. |
| **Volume** | Data cap in bytes; `0` = unlimited. |
| **Expiry** | Expiry date/time; leave blank for never. |
| **Group** | Optional label for organising clients (e.g. `team-a`). |
| **Description** | Free-text note for the operator. |
| **Auto Reset** | Periodically reset traffic counters (set Reset Days). |
| **Delay Start** | Don't start the expiry/quota clock until the client first connects. |

3. Click **Save**. AetherProxy auto-generates proxy links for every assigned inbound.

#### Via the API (bulk creation example)

```bash
curl -b "aether_token=<jwt>" \
     -X POST https://<API_DOMAIN>/api/save \
     -d "object=clients" \
     -d "action=addbulk" \
     -d 'data=[{"name":"alice-2024","enable":true,"inbounds":[1],"volume":10737418240,"expiry":0}]'
```

- `inbounds` is an array of inbound **IDs** (visible on the Inbounds page or via `GET /api/inbounds`).
- `volume` is in bytes (`10737418240` = 10 GB). Use `0` for unlimited.
- `expiry` is a Unix timestamp in seconds (`0` = never expires).

---

### 4. Distribute subscription URLs to clients

Once a client is created, their subscription URL is:

```
https://<API_DOMAIN>/sub/<client-name>
```

For example, a client named `alice-2024` receives:

```
https://api.example.com/sub/alice-2024
```

#### Alternative formats

| URL | Format | Best for |
|---|---|---|
| `https://<API_DOMAIN>/sub/<name>` | Base64 URI list | Most clients (v2rayNG, NekoBox, …) |
| `https://<API_DOMAIN>/sub/<name>?format=clash` | Clash/Mihomo YAML | FlClash, Clash Meta, Mihomo |
| `https://<API_DOMAIN>/sub/<name>?format=json` | sing-box JSON | sing-box native clients |
| `https://<API_DOMAIN>/sub/qr/<name>` | QR code PNG | Easy phone import |

The response always includes `Subscription-Userinfo` (usage/quota), `Profile-Update-Interval`, and `Profile-Title` headers so clients that support them can display remaining quota and auto-refresh.

#### Share via QR code

Open `https://<API_DOMAIN>/sub/qr/<client-name>` in a browser — it renders a 256×256 PNG that the AetherProxy Android app (or any sing-box / v2ray client with camera import) can scan to add the subscription in one step.

---

### 5. How clients connect

#### Android (AetherProxy / Hiddify app)

1. Open the app.
2. Tap **+** → **Add from URL**, paste the subscription URL, or tap **Scan QR** and point the camera at the QR code.
3. Tap **Connect**. The app will fetch the latest proxy list from the subscription URL automatically.

#### Desktop (AetherProxy Tauri client)

1. Open the system-tray app.
2. Click **Import Subscription** and paste the URL.
3. Click **Connect** in the main window.

#### Other compatible clients (v2rayNG, NekoBox, Mihomo, …)

These clients accept any of the three subscription formats. Import the Base64 URL for the widest compatibility:

1. Open the client's subscription / profile manager.
2. Add a new subscription and paste `https://<API_DOMAIN>/sub/<client-name>`.
3. Click **Update** to pull the latest proxy list.
4. Select a server and connect.

---

### 6. Traffic limits and expiry

| Behaviour | How it works |
|---|---|
| **Volume cap** | When `up + down >= volume` the client is automatically disabled. |
| **Expiry** | When the current time passes the `expiry` timestamp the client is automatically disabled. |
| **Auto Reset** | Every `resetDays` days traffic counters are zeroed and (if volume-depleted) the client is re-enabled. |
| **Delay Start** | Expiry clock starts from first-byte activity, not account creation. |

Disabled clients receive a `400` error from the subscription server — their proxy apps will show a connection failure, signalling that their quota or subscription has ended.

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

### Port Sync Operations

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/portsyncStatus?limit=30` | PortSync queue and capability snapshot (pending tasks, retries, local capability note) |
| `POST` | `/api/portsyncSync` | Queue immediate reconcile (`reason`, optional `nodeId`) |
| `POST` | `/api/portsyncRetry` | Process due retry tasks immediately (`limit`, default 30) |
| `POST` | `/api/portsyncClear` | Clear queued tasks (`scope` optional: `local`/`node`, `nodeId` optional) |

Manual end-to-end validation checklist: [`docs/portsync-validation.md`](docs/portsync-validation.md)

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

# Deploy with conservative build settings on low-RAM VPSes
make deploy-up-lowram
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
