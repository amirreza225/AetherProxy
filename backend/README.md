# AetherProxy – Backend

This directory contains the Go API server that drives the AetherProxy admin panel and serves sing-box configuration.

## Tech stack

| Component | Technology |
|---|---|
| HTTP framework | [Gin](https://github.com/gin-gonic/gin) |
| ORM | [GORM](https://gorm.io/) |
| Database | SQLite (default) or PostgreSQL |
| sing-box wrapper | [sing-box v1.13.x](https://github.com/SagerNet/sing-box) |
| Auth | HS256 JWT (httpOnly cookie + Bearer header) |
| Live push | WebSocket (`/api/ws/stats`) |

## Quick start

```bash
# From the backend/ directory:
go build -trimpath -o ../bin/aetherproxy .
export AETHER_JWT_SECRET="your-secret"
export AETHER_ADMIN_ORIGIN="http://localhost:3000"
../bin/aetherproxy
```

Or use the Makefile target from the repo root:

```bash
make backend-dev    # hot-reload via cosmtrek/air
```

## Directory layout

| Path | Responsibility |
|---|---|
| `api/` | HTTP handlers, JWT middleware, WebSocket |
| `app/` | Application bootstrap – Init / Start / Stop / Restart |
| `cmd/` | CLI commands (`start`, `admin`, `setting`) |
| `config/` | Environment-variable parsing |
| `core/` | sing-box process wrapper + plugin system |
| `core/plugin/` | `OutboundPlugin` interface, loader, and built-in plugins |
| `cronjob/` | Background jobs (traffic stats, WAL checkpoint) |
| `database/` | GORM models and `AutoMigrate` |
| `logger/` | Structured logging with throttle |
| `middleware/` | Gin middleware (domain validator) |
| `network/` | Auto-HTTPS listener helpers |
| `service/` | All business logic |
| `sub/` | Subscription server (base64, Clash YAML, sing-box JSON, QR) |
| `util/` | Link generation, base64, outbound JSON helpers |
| `web/` | Gin engine setup, CORS, JWT middleware wiring |

## Build tags

The default build uses these tags (see `Makefile`):

```
with_utls,with_quic,with_grpc,with_acme,with_gvisor,with_naive_outbound,with_purego
```

Override via `make backend-build BACKEND_TAGS=...`.

## Tests

```bash
go test -race ./...
```

## Lint

```bash
golangci-lint run ./...
# or via Makefile:
make backend-lint
```

## Contributing

See the [main CONTRIBUTING section](../README.md#contributing) and [`CONTRIBUTING.md`](CONTRIBUTING.md) for coding conventions and the pull-request process.
