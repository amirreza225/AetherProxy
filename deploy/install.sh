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
  -h, --help             Show this help

Environment variables:
  PANEL_DOMAIN           Panel domain (required in non-interactive mode)
  API_DOMAIN             API domain (required in non-interactive mode)
  AETHER_INSTALL_DIR     Install path (default: /opt/aetherproxy)
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
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1 (use --help for usage)"
      ;;
  esac
done

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
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build

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
echo -e "    ${BOLD}View logs  :${PLAIN}  docker compose -f $COMPOSE_FILE logs -f"
echo -e "    ${BOLD}Stop       :${PLAIN}  docker compose -f $COMPOSE_FILE down"
echo -e "    ${BOLD}Update     :${PLAIN}  bash $INSTALL_DIR/deploy/install.sh"
echo -e "    ${BOLD}Config file:${PLAIN}  $ENV_FILE"
echo -e ""
