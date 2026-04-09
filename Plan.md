# Plan: AetherProxy – Full Implementation Plan (All 4 Phases)

## Decisions
- **Backend**: Fork s-ui Go backend (keep `/api`, `/service`, `/database`, `/core`, `/sub`); remove s-ui's own frontend
- **Frontend**: Build from scratch with Next.js 15 + TypeScript + Tailwind + shadcn/ui
- **Android client**: Fork hiddify-app, re-brand, wire to AetherProxy backend
- **Desktop client**: Tauri 2.0 (Phase 2)
- **DB**: SQLite + GORM for MVP (Phase 1), migrate to PostgreSQL in Phase 2
- **Auth**: Swap s-ui session auth → JWT (stateless, compatible with Next.js frontend)
- **Team**: Solo developer
- **Repo layout**: monorepo under AetherProxy/

---

## Phase 1 – MVP (Weeks 1–4)

### 1.1 Repo & Dev Environment Setup
- Initialize monorepo: `backend/`, `frontend/`, `client-android/`, `deploy/`, `docs/`
- Add sing-box as a git submodule under `backend/core/singbox/`
- Configure Go workspace (`go.work`) for backend
- Set up pre-commit hooks (golangci-lint, prettier, flutter analyze)

### 1.2 Backend – Fork & Adapt s-ui
- Fork `alireza0/s-ui` into `backend/`
- Keep: `/api`, `/service`, `/database` (GORM + SQLite), `/core` (sing-box wrapper), `/sub`, `/util`, `/logger`
- Remove: `/web`, `/frontend` submodule, static file serving
- Replace session-based auth with JWT (access + refresh tokens, bcrypt password hash)
  - New `/api/auth/login`, `/api/auth/refresh` endpoints
  - JWT middleware replacing `SessionMiddleware`
- Add CORS middleware (origin restricted to admin panel domain via env var)
- Verify Reality + VLESS and Hysteria2 config generation paths in `/core` and `/service`
- Expose WebSocket endpoint `/api/ws/stats` for live traffic data
- ENV-driven config: `AETHER_DB_PATH`, `AETHER_JWT_SECRET`, `AETHER_ADMIN_ORIGIN`, `AETHER_PORT`
- Write `Makefile` targets: `build`, `dev`, `test`, `lint`

### 1.3 Frontend – Admin Panel (from scratch)
- Scaffold with `create-next-app` (App Router, TypeScript, Tailwind, ESLint)
- Install: `shadcn/ui`, `next-intl` (EN + FA/Farsi), `recharts` (charts), `swr` (data fetching), `zod` (validation)
- Pages/routes:
  - `/login` – JWT login form
  - `/dashboard` – Live node status cards, traffic sparklines, online client count (WebSocket feed)
  - `/nodes` – Node list + add/edit modal (single-node in Phase 1)
  - `/users` – User CRUD, traffic quota, expiry date
  - `/subscriptions` – Generate subscription link + QR code (via `qrcode.react`)
  - `/settings` – JWT secret rotation, Let's Encrypt domain, port config
- Auth: store JWT in `httpOnly` cookie via Next.js route handler; SWR refresh
- i18n: RTL layout for Farsi (`dir="rtl"` on `html`), `next-intl` dictionaries in `messages/en.json` + `messages/fa.json`
- Folder structure: `app/`, `components/`, `lib/api.ts` (typed fetch wrapper), `hooks/`

### 1.4 Android Client – Fork hiddify-app
- Fork `hiddify/hiddify-app` into `client-android/`
- Re-brand: rename app ID → `dev.aetherproxy.app`, update strings, icons, splash
- Update `hiddify-core` submodule pointer to latest stable tag
- Add "Import from AetherProxy" flow: accept subscription URL format used by backend `/sub/` endpoint
- Verify Reality + Hysteria2 protocols resolve in hiddify-core
- Ensure kill-switch (Android VPN service) and TUN mode work
- Smoke-test build: `flutter build apk --split-per-abi`

### 1.5 Deployment
- `deploy/docker-compose.yml`: services `backend` (Go binary), `caddy` (reverse proxy + auto TLS)
- `deploy/Caddyfile.template`: auto HTTPS for admin panel domain + sing-box port passthrough
- `deploy/install.sh`: one-liner (curl | bash) that clones repo, sets ENV, runs docker compose up -d
- GitHub Actions CI: lint + build backend (Go), lint + build frontend (Node), flutter analyze

---

## Phase 2 – Core (Weeks 5–10)

### 2.1 Multi-Node Architecture
- New DB table `nodes` (id, name, host, ssh_port, ssh_key_path, status, last_ping, provider)
- Backend `NodeService`: SSH to remote VPS → write sing-box JSON config → restart service
  - Use `golang.org/x/crypto/ssh` for SSH client
  - Store per-node sing-box process state
- Health-check goroutine (every 30s): TCP ping + protocol probe → update `nodes.status`
- Failover logic in `/sub/` generator: exclude unhealthy nodes from subscription output
- Frontend `/nodes` page: multi-node list, add node (SSH key upload), live status badge, deploy button

### 2.2 PostgreSQL Migration
- Add `AETHER_DB_DSN` env var; GORM auto-selects driver (sqlite3 vs postgres) based on DSN scheme
- Write `backend/database/migrate.go` using GORM `AutoMigrate` (idempotent)
- Update `deploy/docker-compose.yml` with optional `postgres` service + `POSTGRES_*` env vars
- Document SQLite → PostgreSQL data export path (dump + restore script)

### 2.3 Advanced Routing UI
- New `/routing` page: visual rule editor (table-based, add/remove rules)
- Rules map to sing-box `route.rules` JSON: fields `inbound`, `network`, `domain_suffix`, `geoip`, `outbound`
- Backend endpoint `PUT /api/routing` writes rules to active sing-box config and hot-reloads
- Bundle sing-box geo assets (`geoip.db`, `geosite.db`) in backend Docker image

### 2.4 Desktop Client (Tauri 2.0)
- New workspace `client-desktop/` using `create-tauri-app` (Rust + React/TypeScript frontend)
- Rust side: shell out to sing-box binary (bundled in `src-tauri/resources/`) via `std::process::Command`
  - Commands: `start_proxy(config_json)`, `stop_proxy()`, `get_stats() -> StatsJson`
- Frontend: reuse component library from admin panel (shared `packages/ui/` if desired)
- Feature parity with Android: subscription import, auto-best-node, kill-switch (Windows firewall rules / macOS pf / Linux iptables via `sudo` prompt)
- System tray (Tauri `tray` plugin): status icon, quick connect/disconnect
- Package targets: `.msi` (Windows), `.dmg` (macOS), `.AppImage` (Linux)
- CI matrix: `windows-latest`, `macos-latest`, `ubuntu-latest`

---

## Phase 3 – Polish (Weeks 11–16)

### 3.1 Dynamic Evasion & Javid Integration
- Background service `EvasionWatcher` in backend
  - HTTP scraper for `javidnetworkwatch.com` (or structured data endpoint if available) on 10-min interval
  - Parse reported blocked protocols/ports/domains → store in `evasion_events` DB table
  - Emit rule-adjustment suggestions via WebSocket to admin panel
  - Auto-switch logic: if Reality blocks detected AND Hysteria2 healthy → promote Hysteria2 subscriptions
- Telemetry (opt-in): anonymous aggregated stats → configurable remote endpoint (self-hosted InfluxDB or HTTPS POST)

### 3.2 Analytics Dashboard
- New `/analytics` page:
  - Per-protocol success rate (line chart, 24h/7d/30d range)
  - Per-node latency heatmap
  - Censorship event timeline (annotated on traffic chart)
  - Active clients geographic distribution (if IP geolocation enabled)
- Backend: aggregate `stats` table with time-bucketing query; expose `/api/analytics` REST endpoint

### 3.3 Subscription Enhancements
- Clash/Mihomo YAML format output from `/sub/clash/` endpoint
- sing-box JSON format (existing)
- QR code served as `/sub/qr/{token}` PNG endpoint (Go `skip1245/gozxing` or front-end renders)
- Auto-update interval header (`Profile-Update-Interval: 6`) in subscription responses

### 3.4 iOS Client Polish
- Enable iOS build target in hiddify-app fork: `flutter build ipa`
- Add `NetworkExtension` entitlement (packet tunnel provider)
- Swift `HiddifyCorePlugin` calls into hiddify-core Go shared library (existing in hiddify-app)
- TestFlight release workflow in CI (requires Apple dev membership)

---

## Phase 4 – Advanced (Ongoing)

### 4.1 Plugin System
- Go interface `OutboundPlugin` in `backend/core/plugin/`:
  ```
  type OutboundPlugin interface {
    Name() string
    GenerateConfig(params map[string]any) (json.RawMessage, error)
    Probe(host string, timeout time.Duration) (bool, error)
  }
  ```
- Load plugins from `plugins/` dir via Go `plugin.Open` (`.so` files) or static registration map
- Frontend plugin registry page: list installed plugins, configure params, enable/disable

### 4.2 Steganography / Deep Obfuscation Layer
- Research: HTTP/2 multiplexing disguise, WebSocket over CDN (Cloudflare Workers relay), gRPC obfuscation
- Implement as a custom sing-box outbound plugin (Phase 4.1 foundation required)
- Inspired by: Obfs4, meek transports — but integrated natively

### 4.3 Decentralized Node Discovery
- Gossip protocol (`hashicorp/memberlist` or custom UDP broadcast) for node-to-node awareness
- Optional: publish node availability to a DHT (libp2p kad) without central server
- Bootstrap node list embedded in client (updatable via signed manifest)
- Admin panel: "Join decentralized network" toggle

---

## Relevant Files & References

| File/Path | Purpose |
|---|---|
| `backend/` | Forked from `alireza0/s-ui` — Go + Gin + GORM |
| `backend/api/` | Gin HTTP & WebSocket handlers — adapt auth middleware |
| `backend/service/` | Business logic: Users, Clients, Inbounds, Stats — keep mostly intact |
| `backend/database/` | GORM models + SQLite → add nodes, evasion_events tables |
| `backend/core/` | sing-box wrapper — keep; verify Reality/Hysteria2 paths |
| `backend/sub/` | Subscription link generation — extend for Clash/QR |
| `frontend/` | New Next.js 15 app — `app/`, `components/ui/` (shadcn), `lib/api.ts` |
| `client-android/` | Forked from `hiddify/hiddify-app` — Flutter + hiddify-core submodule |
| `client-desktop/` | New Tauri 2.0 workspace (Phase 2) |
| `deploy/docker-compose.yml` | Backend + Caddy services |
| `deploy/install.sh` | One-liner deployment script |

---

## Verification Steps (per Phase)

**Phase 1:**
1. `make test` passes all Go unit tests in `backend/`
2. `curl -X POST /api/auth/login` returns JWT; subsequent `/api/users` with Bearer succeeds
3. sing-box Reality + Hysteria2 inbound config generated correctly (`/api/inbounds`)
4. Android APK installs, imports subscription URL, connects via Reality + Hysteria2
5. Admin panel accessible at HTTPS domain; Dashboard shows live stats via WebSocket
6. `docker compose up -d` on fresh $5 VPS completes in <10 min

**Phase 2:**
7. Add second node via admin panel; health check marks it online within 60s
8. Subscription link excludes unhealthy node after node goes offline
9. Tauri desktop app builds on all 3 platforms without errors
10. PostgreSQL mode: GORM `AutoMigrate` runs clean on fresh Postgres DB

**Phase 3:**
11. Javid scraper runs without panicking; `evasion_events` table populated
12. Analytics page shows 24h per-protocol success rates  
13. Clash YAML subscription parseable by FlClash/Mihomo

**Phase 4:**
14. Sample plugin `.so` loaded at runtime; appears in admin plugin registry
15. Decentralized mode: two nodes discover each other without central coordination
