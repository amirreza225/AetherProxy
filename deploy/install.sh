#!/usr/bin/env bash
# AetherProxy Docker Compose installer
# Usage: curl -fsSL https://raw.githubusercontent.com/amirreza225/AetherProxy/main/deploy/install.sh | sudo bash
# Auto-confirm prompts:
#   curl -fsSL https://raw.githubusercontent.com/amirreza225/AetherProxy/main/deploy/install.sh | sudo bash -s -- --yes
# Fully non-interactive:
#   PANEL_DOMAIN=panel.example.com API_DOMAIN=api.example.com \
#   curl -fsSL https://raw.githubusercontent.com/amirreza225/AetherProxy/main/deploy/install.sh | sudo -E bash -s -- --yes --non-interactive
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
PLAIN='\033[0m'

REPO_URL="https://github.com/amirreza225/AetherProxy.git"
INSTALL_DIR="${AETHER_INSTALL_DIR:-/opt/aetherproxy}"
COMPOSE_FILE="$INSTALL_DIR/deploy/docker-compose.yml"
ENV_FILE="$INSTALL_DIR/deploy/.env"
AUTO_YES=0
NON_INTERACTIVE=0
LOW_RAM_MODE=0
RESOLVED_COMPOSE_FILE=""

# ── Helpers ───────────────────────────────────────────────────────────────────
info() { echo -e "${CYAN}[INFO]${PLAIN}  $*"; }
ok()   { echo -e "${GREEN}[ OK ]${PLAIN}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${PLAIN}  $*"; }
die()  { echo -e "${RED}[FAIL]${PLAIN}  $*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
AetherProxy Docker installer

Options:
  -y, --yes              Auto-confirm yes/no prompts
  -n, --non-interactive  Do not prompt; require env vars for required values
  -l, --low-ram          Force conservative build settings for small VPS
  -h, --help             Show this help

Environment variables:
  PANEL_DOMAIN           Panel domain (required in non-interactive mode)
  API_DOMAIN             API domain (required in non-interactive mode)
  AETHER_INSTALL_DIR     Install path (default: /opt/aetherproxy)
  AETHER_LOW_RAM_BUILD   Set to 1 to force conservative build settings
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      AUTO_YES=1
      shift
      ;;
    -n|--non-interactive)
      NON_INTERACTIVE=1
      shift
      ;;
    -l|--low-ram)
      LOW_RAM_MODE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1 (use --help for usage)"
      ;;
  esac
done

if [[ "${AETHER_LOW_RAM_BUILD:-0}" == "1" ]]; then
  LOW_RAM_MODE=1
fi

if [[ "$LOW_RAM_MODE" -eq 0 && -r /proc/meminfo ]]; then
  _mem_kb=$(awk '/MemTotal:/ {print $2}' /proc/meminfo)
  if [[ -n "${_mem_kb:-}" && "$_mem_kb" -lt $((3072 * 1024)) ]]; then
    LOW_RAM_MODE=1
  fi
fi

HAS_TTY=0
[[ -r /dev/tty ]] && HAS_TTY=1

# Read user input from /dev/tty so prompts still work when script is piped via stdin.
# If no TTY is available, fallback to pre-set environment variables.
prompt_input() {
  local var_name="$1"
  local prompt="$2"
  local default_value="${3-}"
  local value=""

  if [[ "$NON_INTERACTIVE" -eq 0 && "$HAS_TTY" -eq 1 ]]; then
    read -r -p "$prompt" value < /dev/tty || true
  else
    value="${!var_name-}"
  fi

  [[ -z "$value" ]] && value="$default_value"
  [[ -z "$value" ]] && return 1

  printf -v "$var_name" '%s' "$value"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local file="$3"

  if grep -qE "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

get_env_value() {
  local key="$1"
  local file="$2"
  grep -m1 "^${key}=" "$file" 2>/dev/null | cut -d= -f2- || true
}

is_truthy() {
  local raw="${1:-}"
  raw="${raw,,}"
  case "$raw" in
    1|true|yes|y|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

resolve_compose_file() {
  local preferred="$1"
  local legacy="$2"

  if [[ -f "$preferred" ]]; then
    RESOLVED_COMPOSE_FILE="$preferred"
    return 0
  fi
  if [[ -n "$legacy" && -f "$legacy" ]]; then
    warn "Preferred compose path missing; using legacy path: $legacy"
    RESOLVED_COMPOSE_FILE="$legacy"
    return 0
  fi
  die "Compose file not found: $preferred. Run 'git -C $INSTALL_DIR pull --ff-only' and retry."
}

validate_compose_file() {
  local compose_file="$1"
  if ! docker compose --env-file "$ENV_FILE" -f "$compose_file" config >/dev/null; then
    die "Compose validation failed for: $compose_file"
  fi
}

echo -e ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${PLAIN}"
echo -e "${GREEN}${BOLD}║        AetherProxy — Docker Installer            ║${PLAIN}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${PLAIN}"
echo -e ""

# ── Root check ────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && die "This script must be run as root. Try: sudo bash install.sh"

# ── Check / install git ───────────────────────────────────────────────────────
command -v git >/dev/null 2>&1 || die "git is required but not installed."

# ── Check / install Docker ────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  warn "Docker is not installed."
  _ans=""
  if [[ "$AUTO_YES" -eq 1 ]]; then
    _ans="y"
  elif [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    die "Docker is not installed. In non-interactive mode, re-run with --yes to auto-install Docker or install Docker manually."
  else
    prompt_input _ans "  Install Docker automatically? [Y/n]: " "y" || true
  fi
  if [[ "${_ans:-y}" =~ ^[Yy]$ ]]; then
    info "Installing Docker via get.docker.com ..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
    ok "Docker installed and started."
  else
    die "Docker is required. See: https://docs.docker.com/engine/install/"
  fi
fi

if ! docker compose version >/dev/null 2>&1; then
  die "Docker Compose v2 is required. Update Docker or install the plugin:\n  https://docs.docker.com/compose/install/"
fi

ok "Docker $(docker --version | grep -oP '[\d.]+' | head -1) + Compose v2 detected."

# ── Clone / update ────────────────────────────────────────────────────────────
if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Updating existing installation at $INSTALL_DIR ..."
  git -C "$INSTALL_DIR" pull --ff-only
  ok "Repository updated."
else
  info "Cloning AetherProxy into $INSTALL_DIR ..."
  git clone --depth=1 "$REPO_URL" "$INSTALL_DIR"
  ok "Repository cloned."
fi

# ── Generate a random secret (openssl with /dev/urandom fallback) ─────────────
_gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    tr -dc 'a-f0-9' < /dev/urandom | head -c 64
  fi
}

# ── Configure .env ────────────────────────────────────────────────────────────
PANEL_DOMAIN="${PANEL_DOMAIN:-}"
API_DOMAIN="${API_DOMAIN:-}"

if [[ -f "$ENV_FILE" ]]; then
  warn "Config file already exists at $ENV_FILE — skipping interactive setup."
  warn "Delete it and re-run to reconfigure, or edit it directly."
else
  echo -e ""
  echo -e "${BLUE}${BOLD}  Domain Configuration${PLAIN}"
  echo -e "  Both domains must already point to this server's IP address.\n"

  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    warn "Non-interactive mode enabled. Reading PANEL_DOMAIN and API_DOMAIN from environment."
  elif [[ "$HAS_TTY" -eq 0 ]]; then
    warn "No interactive TTY detected. Using PANEL_DOMAIN and API_DOMAIN from environment."
  fi

  prompt_input PANEL_DOMAIN "  Panel domain  (e.g. panel.example.com): " || true
  [[ -z "${PANEL_DOMAIN:-}" ]] && die "Panel domain cannot be empty. Provide PANEL_DOMAIN and API_DOMAIN env vars for non-interactive runs."

  prompt_input API_DOMAIN "  API domain    (e.g. api.example.com):   " || true
  [[ -z "${API_DOMAIN:-}" ]] && die "API domain cannot be empty. Provide PANEL_DOMAIN and API_DOMAIN env vars for non-interactive runs."

  JWT_SECRET=$(_gen_secret)
  info "Writing $ENV_FILE ..."
  cat > "$ENV_FILE" <<ENVEOF
# AetherProxy environment — generated $(date -u '+%Y-%m-%d %H:%M UTC')
# Edit this file to customise your deployment, then restart with:
#   docker compose -f $COMPOSE_FILE up -d

# ── Domains ───────────────────────────────────────────────────────────────────
PANEL_DOMAIN=${PANEL_DOMAIN}
API_DOMAIN=${API_DOMAIN}

# ── Application URLs (used by Caddy and the Next.js build) ────────────────────
AETHER_ADMIN_ORIGIN=https://${PANEL_DOMAIN}
NEXT_PUBLIC_API_URL=https://${API_DOMAIN}

# ── Security — keep this value secret ─────────────────────────────────────────
AETHER_JWT_SECRET=${JWT_SECRET}

# ── Logging ───────────────────────────────────────────────────────────────────
AETHER_LOG_LEVEL=info

# ── Docker networking mode ────────────────────────────────────────────────────
# Set to 1 to enable host-network backend mode:
# - installer uses deploy/docker-compose.hostnet.yml
# - backend can manage host UFW when NET_ADMIN is available
AETHER_DOCKER_HOSTNET=0
API_UPSTREAM=backend:2095
SUB_UPSTREAM=backend:2096

# ── Inbound port/firewall automation ──────────────────────────────────────────
AETHER_PORT_SYNC_ENABLED=true
# In bridge mode, host firewall is not managed by default.
AETHER_PORT_SYNC_LOCAL_ENABLED=false
AETHER_PORT_SYNC_REMOTE_ENABLED=true
AETHER_PORT_SYNC_RETRY_SECONDS=30
# Override only if ufw is installed at a non-standard path.
# AETHER_PORT_SYNC_UFW_BIN=ufw

# ── Optional: PostgreSQL ──────────────────────────────────────────────────────
# Uncomment and fill in to use PostgreSQL instead of the default SQLite:
# AETHER_DB_DSN=postgres://aether:secret@postgres:5432/aether?sslmode=disable
# POSTGRES_PASSWORD=secret
ENVEOF
  ok "Configuration written."
fi

# Read domain names from .env for the post-install summary
_pd=$(grep -m1 '^PANEL_DOMAIN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-) || true
_ad=$(grep -m1 '^API_DOMAIN='   "$ENV_FILE" 2>/dev/null | cut -d= -f2-) || true
PANEL_DOMAIN="${_pd:-<panel-domain>}"
API_DOMAIN="${_ad:-<api-domain>}"

# ── Start services ────────────────────────────────────────────────────────────
echo -e ""
info "Building images and starting services (first run may take several minutes) ..."

if [[ "$LOW_RAM_MODE" -eq 1 ]]; then
  warn "Low-RAM build mode enabled (serialized compose build + conservative Go compiler parallelism)."
  export GO_BUILD_P="${GO_BUILD_P:-1}"
  export GO_BUILD_GOMAXPROCS="${GO_BUILD_GOMAXPROCS:-1}"
  export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"
fi

compose_file="$COMPOSE_FILE"
resolve_compose_file "$INSTALL_DIR/deploy/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
compose_file="$RESOLVED_COMPOSE_FILE"

_hostnet=$(get_env_value "AETHER_DOCKER_HOSTNET" "$ENV_FILE")
_api_upstream=$(get_env_value "API_UPSTREAM" "$ENV_FILE")
_sub_upstream=$(get_env_value "SUB_UPSTREAM" "$ENV_FILE")
_local_sync=$(get_env_value "AETHER_PORT_SYNC_LOCAL_ENABLED" "$ENV_FILE")
if is_truthy "${_hostnet:-0}"; then
  resolve_compose_file "$INSTALL_DIR/deploy/docker-compose.hostnet.yml" "$INSTALL_DIR/docker-compose.hostnet.yml"
  compose_file="$RESOLVED_COMPOSE_FILE"
  info "Host-network backend mode is enabled."

  if ! is_truthy "${_local_sync:-}"; then
    set_env_value "AETHER_PORT_SYNC_LOCAL_ENABLED" "true" "$ENV_FILE"
    info "AETHER_PORT_SYNC_LOCAL_ENABLED set to true for host-network mode."
  fi

  # Keep custom upstreams untouched; only switch bridge defaults.
  if [[ -z "${_api_upstream:-}" || "${_api_upstream}" == "backend:2095" ]]; then
    set_env_value "API_UPSTREAM" "host.docker.internal:2095" "$ENV_FILE"
    info "API_UPSTREAM set to host.docker.internal:2095 for host-network mode."
  fi
  if [[ -z "${_sub_upstream:-}" || "${_sub_upstream}" == "backend:2096" ]]; then
    set_env_value "SUB_UPSTREAM" "host.docker.internal:2096" "$ENV_FILE"
    info "SUB_UPSTREAM set to host.docker.internal:2096 for host-network mode."
  fi
else
  info "Bridge backend mode is enabled."

  if [[ -z "${_local_sync:-}" ]]; then
    set_env_value "AETHER_PORT_SYNC_LOCAL_ENABLED" "false" "$ENV_FILE"
    info "AETHER_PORT_SYNC_LOCAL_ENABLED set to false for bridge mode."
  elif is_truthy "$_local_sync"; then
    warn "AETHER_PORT_SYNC_LOCAL_ENABLED is true in bridge mode; host firewall updates may fail in containerized bridge deployments."
  fi

  # If values were auto-switched previously, restore bridge defaults.
  if [[ "${_api_upstream:-}" == "host.docker.internal:2095" ]]; then
    set_env_value "API_UPSTREAM" "backend:2095" "$ENV_FILE"
    info "API_UPSTREAM restored to backend:2095 for bridge mode."
  fi
  if [[ "${_sub_upstream:-}" == "host.docker.internal:2096" ]]; then
    set_env_value "SUB_UPSTREAM" "backend:2096" "$ENV_FILE"
    info "SUB_UPSTREAM restored to backend:2096 for bridge mode."
  fi

  warn "Bridge mode only exposes published container ports. Use host-network mode for dynamic inbound ports."
fi

compose_args=(--env-file "$ENV_FILE" -f "$compose_file")
compose_cmd="docker compose --env-file $ENV_FILE -f $compose_file"

info "Validating compose configuration (${compose_file}) ..."
validate_compose_file "$compose_file"

docker compose "${compose_args[@]}" up -d --build

echo -e ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗${PLAIN}"
echo -e "${GREEN}${BOLD}║           ✅  AetherProxy is running!                ║${PLAIN}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════╝${PLAIN}"
echo -e ""
echo -e "  🌐 Admin panel : ${CYAN}https://${PANEL_DOMAIN}${PLAIN}"
echo -e "  🔌 API / subs  : ${CYAN}https://${API_DOMAIN}${PLAIN}"
echo -e ""
echo -e "  ${YELLOW}Default login: admin / admin — change it immediately!${PLAIN}"
echo -e ""
echo -e "  Useful commands:"
echo -e "    ${BOLD}View logs  :${PLAIN}  $compose_cmd logs -f"
echo -e "    ${BOLD}Stop       :${PLAIN}  $compose_cmd down"
echo -e "    ${BOLD}Update     :${PLAIN}  bash $INSTALL_DIR/deploy/install.sh"
echo -e "    ${BOLD}Config file:${PLAIN}  $ENV_FILE"
echo -e ""
