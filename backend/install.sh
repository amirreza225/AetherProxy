#!/usr/bin/env bash
# AetherProxy bare-metal installer (systemd, no Docker required)
# Supported: Debian/Ubuntu, RHEL/CentOS/AlmaLinux/Rocky, Fedora, Arch Linux
#
# Usage: sudo bash install.sh
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
PLAIN='\033[0m'

REPO_URL="https://github.com/amirreza225/AetherProxy.git"
INSTALL_DIR="${AETHER_INSTALL_DIR:-/opt/aetherproxy}"
BIN_DIR="/usr/local/bin"
DATA_DIR="/var/lib/aetherproxy"
CONF_DIR="/etc/aetherproxy"
ENV_FILE="$CONF_DIR/env"
SERVICE_USER="${AETHER_USER:-aetherproxy}"

# Minimum tool versions
GO_VERSION="1.24.2"
NODE_MIN_MAJOR="20"

# ── Helpers ───────────────────────────────────────────────────────────────────
info() { echo -e "${CYAN}[INFO]${PLAIN}  $*"; }
ok()   { echo -e "${GREEN}[ OK ]${PLAIN}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${PLAIN}  $*"; }
die()  { echo -e "${RED}[FAIL]${PLAIN}  $*" >&2; exit 1; }

echo -e ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${PLAIN}"
echo -e "${GREEN}${BOLD}║     AetherProxy — Bare-metal Installer           ║${PLAIN}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${PLAIN}"
echo -e ""

# ── Root check ────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && die "Run as root: sudo bash install.sh"

# ── Detect OS ─────────────────────────────────────────────────────────────────
if [[ -f /etc/os-release ]]; then
  # shellcheck source=/dev/null
  source /etc/os-release
  OS_ID="$ID"
else
  die "Cannot detect OS: /etc/os-release not found."
fi
info "Detected OS: $OS_ID"

# ── Install base packages ─────────────────────────────────────────────────────
info "Installing base packages (git, curl, wget, tar, gcc) ..."
case "$OS_ID" in
  ubuntu|debian|linuxmint)
    apt-get update -qq
    apt-get install -y -qq git curl wget tar gcc ;;
  centos|rhel|almalinux|rocky|oracle)
    yum install -y -q git curl wget tar gcc ;;
  fedora)
    dnf install -y -q git curl wget tar gcc ;;
  arch|manjaro|parch)
    pacman -Syu --noconfirm git curl wget tar gcc ;;
  opensuse*|sles)
    zypper install -y -q git curl wget tar gcc ;;
  *)
    warn "Unknown distro '$OS_ID'. Attempting apt-get ..."
    apt-get update -qq && apt-get install -y -qq git curl wget tar gcc ;;
esac
ok "Base packages ready."

# ── Install Go ────────────────────────────────────────────────────────────────
install_go() {
  local arch
  case "$(uname -m)" in
    x86_64|amd64)  arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    armv7*)        arch="armv6l" ;;
    *) die "Unsupported CPU architecture: $(uname -m)" ;;
  esac

  # Check for an existing, recent-enough Go installation
  if command -v go >/dev/null 2>&1; then
    local cur
    cur=$(go version | grep -oP '[\d.]+' | head -1)
    local req="1.22"
    if [[ "$(printf '%s\n' "$req" "$cur" | sort -V | head -1)" == "$req" ]]; then
      ok "Go $cur already installed (>= $req required)."
      return
    fi
    warn "Go $cur is too old (need >= $req). Installing $GO_VERSION ..."
  else
    info "Installing Go $GO_VERSION ..."
  fi

  local tarball="go${GO_VERSION}.linux-${arch}.tar.gz"
  wget -q "https://go.dev/dl/${tarball}" -O "/tmp/${tarball}"
  rm -rf /usr/local/go
  tar -C /usr/local -xzf "/tmp/${tarball}"
  rm -f "/tmp/${tarball}"
  ln -sf /usr/local/go/bin/go    "$BIN_DIR/go"
  ln -sf /usr/local/go/bin/gofmt "$BIN_DIR/gofmt"
  ok "Go $(go version | grep -oP '[\d.]+' | head -1) installed."
}
install_go

# ── Install Node.js ───────────────────────────────────────────────────────────
install_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major=$(node --version | grep -oP '\d+' | head -1)
    if [[ "$major" -ge "$NODE_MIN_MAJOR" ]]; then
      ok "Node.js v$(node --version) already installed."
      return
    fi
    warn "Node.js v$(node --version) is too old (need v${NODE_MIN_MAJOR}+). Upgrading ..."
  else
    info "Installing Node.js ${NODE_MIN_MAJOR} via NodeSource ..."
  fi

  # NodeSource setup script handles both deb and rpm based distros
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MIN_MAJOR}.x" | bash - 2>/dev/null || \
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MIN_MAJOR}.x" | bash - 2>/dev/null || \
    die "Failed to add NodeSource repo. Install Node.js ${NODE_MIN_MAJOR}+ manually: https://nodejs.org"

  case "$OS_ID" in
    ubuntu|debian|linuxmint)       apt-get install -y -qq nodejs ;;
    centos|rhel|almalinux|rocky|\
    oracle|fedora)                 dnf install -y nodejs 2>/dev/null || yum install -y nodejs ;;
    *)                             apt-get install -y -qq nodejs ;;
  esac
  ok "Node.js $(node --version) installed."
}
install_node

# ── Install Caddy ─────────────────────────────────────────────────────────────
install_caddy() {
  if command -v caddy >/dev/null 2>&1; then
    ok "Caddy $(caddy version | head -1) already installed."
    return
  fi

  info "Installing Caddy ..."
  case "$OS_ID" in
    ubuntu|debian|linuxmint)
      apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        | tee /etc/apt/sources.list.d/caddy-stable.list
      apt-get update -qq && apt-get install -y -qq caddy ;;
    centos|rhel|almalinux|rocky|oracle|fedora)
      dnf copr enable -y @caddy/caddy 2>/dev/null && dnf install -y caddy || \
        die "Could not install Caddy. Install manually: https://caddyserver.com/docs/install" ;;
    *)
      # Generic: download binary from GitHub releases
      local arch
      case "$(uname -m)" in
        x86_64) arch="amd64" ;;
        aarch64) arch="arm64" ;;
        *) die "Install Caddy manually from https://caddyserver.com/docs/install" ;;
      esac
      local ver
      ver=$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest \
              | grep '"tag_name"' | grep -oP 'v[\d.]+')
      wget -q "https://github.com/caddyserver/caddy/releases/download/${ver}/caddy_${ver#v}_linux_${arch}.tar.gz" \
        -O /tmp/caddy.tar.gz
      tar -C "$BIN_DIR" -xzf /tmp/caddy.tar.gz caddy
      rm -f /tmp/caddy.tar.gz ;;
  esac
  ok "Caddy installed."
}
install_caddy

# ── Clone / update repo ───────────────────────────────────────────────────────
if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Updating repository at $INSTALL_DIR ..."
  git -C "$INSTALL_DIR" pull --ff-only
  ok "Repository updated."
else
  info "Cloning AetherProxy into $INSTALL_DIR ..."
  git clone --depth=1 "$REPO_URL" "$INSTALL_DIR"
  ok "Repository cloned."
fi

# ── Prompt for configuration (collect domains before building frontend) ────────
mkdir -p "$CONF_DIR"

PANEL_DOMAIN=""
API_DOMAIN=""
JWT_SECRET=""

if [[ -f "$ENV_FILE" ]]; then
  warn "Config at $ENV_FILE already exists — skipping interactive setup."
  warn "Delete it and re-run to reconfigure, or edit it directly."
  PANEL_DOMAIN=$(grep -m1 '^AETHER_ADMIN_ORIGIN=' "$ENV_FILE" | cut -d= -f2- | sed 's|https://||' || true)
  API_DOMAIN="$PANEL_DOMAIN"
else
  echo -e ""
  echo -e "${BOLD}  Domain Configuration${PLAIN}"
  echo -e "  Both domains must already point to this server's IP address.\n"
  read -rp "  Panel domain  (e.g. panel.example.com): " PANEL_DOMAIN
  [[ -z "$PANEL_DOMAIN" ]] && die "Panel domain cannot be empty."
  read -rp "  API domain    (e.g. api.example.com):   " API_DOMAIN
  [[ -z "$API_DOMAIN" ]] && die "API domain cannot be empty."

  if command -v openssl >/dev/null 2>&1; then
    JWT_SECRET=$(openssl rand -hex 32)
  else
    JWT_SECRET=$(tr -dc 'a-f0-9' < /dev/urandom | head -c 64)
  fi

  cat > "$ENV_FILE" <<ENVEOF
# AetherProxy environment — $(date -u '+%Y-%m-%d %H:%M UTC')
AETHER_PORT=2095
AETHER_SUB_PORT=2096
AETHER_DB_FOLDER=$DATA_DIR/db
AETHER_JWT_SECRET=$JWT_SECRET
AETHER_ADMIN_ORIGIN=https://$PANEL_DOMAIN
AETHER_LOG_LEVEL=info
ENVEOF
  chmod 640 "$ENV_FILE"
  ok "Configuration written to $ENV_FILE"
fi

# ── Build backend ─────────────────────────────────────────────────────────────
info "Building backend binary ..."
(cd "$INSTALL_DIR/backend" && go build -trimpath -ldflags="-s -w" -o "$BIN_DIR/aetherproxy" .)
ok "Backend binary written to $BIN_DIR/aetherproxy"

# ── Build frontend ────────────────────────────────────────────────────────────
info "Installing frontend dependencies ..."
(cd "$INSTALL_DIR/frontend" && npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -5)
info "Building frontend (NEXT_PUBLIC_API_URL=https://${API_DOMAIN}) ..."
(cd "$INSTALL_DIR/frontend" \
  && NEXT_PUBLIC_API_URL="https://${API_DOMAIN}" npm run build 2>&1 | tail -10)
ok "Frontend built."

# ── Create service user and data directory ────────────────────────────────────
if ! id "$SERVICE_USER" &>/dev/null; then
  info "Creating system user: $SERVICE_USER ..."
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  ok "User $SERVICE_USER created."
fi
mkdir -p "$DATA_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
chown root:"$SERVICE_USER" "$ENV_FILE"

# Give the service user read access to the built frontend
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/frontend/.next" 2>/dev/null || true

# ── Write Caddy config ────────────────────────────────────────────────────────
CADDY_CONF="/etc/caddy/Caddyfile"
info "Writing Caddy config to $CADDY_CONF ..."
mkdir -p /etc/caddy
cat > "$CADDY_CONF" <<CADDYEOF
# AetherProxy — generated by install.sh
${PANEL_DOMAIN} {
    reverse_proxy localhost:3000
}

${API_DOMAIN} {
    reverse_proxy /api/*   localhost:2095
    reverse_proxy /apiv2/* localhost:2095
    reverse_proxy /sub/*   localhost:2096
}
CADDYEOF
ok "Caddy config written."

# ── Locate npm for the service ExecStart ─────────────────────────────────────
NPM_BIN=$(command -v npm)

# ── systemd: backend service ──────────────────────────────────────────────────
cat > /etc/systemd/system/aetherproxy-backend.service <<SVCEOF
[Unit]
Description=AetherProxy Backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
EnvironmentFile=$ENV_FILE
ExecStart=$BIN_DIR/aetherproxy
WorkingDirectory=$DATA_DIR
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
SVCEOF

# ── systemd: frontend service ─────────────────────────────────────────────────
cat > /etc/systemd/system/aetherproxy-frontend.service <<SVCEOF
[Unit]
Description=AetherProxy Frontend
After=aetherproxy-backend.service
Wants=aetherproxy-backend.service

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR/frontend
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
ExecStart=$NPM_BIN start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF

# ── Enable and start all services ─────────────────────────────────────────────
info "Enabling and starting services ..."
systemctl daemon-reload
systemctl enable --now aetherproxy-backend
systemctl enable --now aetherproxy-frontend
systemctl enable --now caddy
ok "All services started."

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
echo -e "    ${BOLD}Backend status :${PLAIN}  systemctl status aetherproxy-backend"
echo -e "    ${BOLD}Backend logs   :${PLAIN}  journalctl -u aetherproxy-backend -f"
echo -e "    ${BOLD}Frontend logs  :${PLAIN}  journalctl -u aetherproxy-frontend -f"
echo -e "    ${BOLD}Config file    :${PLAIN}  $ENV_FILE"
echo -e "    ${BOLD}Update         :${PLAIN}  git -C $INSTALL_DIR pull && sudo bash $INSTALL_DIR/backend/install.sh"
echo -e ""
