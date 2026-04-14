#!/usr/bin/env bash
# AetherProxy Stealth Bridge — Standalone Installer
# Deploys a hardened VLESS+Reality relay node on an Iranian VPS.
# The relay fans traffic out across multiple external nodes so no single
# foreign IP dominates the outbound pattern.
#
# Usage:
#   bash deploy.sh                  # interactive
#   bash deploy.sh --yes            # auto-confirm all prompts
#   bash deploy.sh --non-interactive  # fully driven by env vars (CI/automation)
#   bash deploy.sh --update         # re-download binary, keep config
#   bash deploy.sh --uninstall      # clean removal
#   bash deploy.sh --dry-run        # print steps without executing
#
# Env vars for --non-interactive (N = 1..5):
#   BRIDGE_NODE_COUNT      number of external nodes
#   BRIDGE_NODE_N_IP       node N IP address
#   BRIDGE_NODE_N_PORT     node N port
#   BRIDGE_NODE_N_UUID     node N UUID
#   BRIDGE_NODE_N_PUBKEY   node N Reality public key
#   BRIDGE_NODE_N_SHORT_ID node N Reality short_id
#   BRIDGE_NODE_N_SNI      node N SNI (e.g. microsoft.com)
#   BRIDGE_LISTEN_PORT     inbound listen port (default: 443)
#   BRIDGE_SNI_TARGET      Reality SNI target (default: microsoft.com)
#   BRIDGE_CF_WORKER_URL   Cloudflare Worker URL (optional)
#   BRIDGE_CF_UUID         UUID for CF-fronted backend (required if CF URL set)
#   BRIDGE_TRAFFIC_SHAPING 1 to enable tc netem jitter on outbound (default: 0)
#   BRIDGE_FAKE_ACTIVITY   0 to disable benign cron maintenance jobs (default: 1)
#   BRIDGE_BUILD_SOURCE    1 to compile sing-box from source instead of downloading
#                            (requires Go, git, ~2 GB disk, 5-15 min; maximally strips
#                             all origin fingerprints at compile time)

set -euo pipefail

# ── Version & fixed constants ─────────────────────────────────────────────────
readonly SCRIPT_VERSION="1.0.0"
readonly SINGBOX_VERSION="1.13.4"
readonly SYS_USER="_netd"

# State file persists the chosen service name across install/update/uninstall runs.
# Stored as a hidden file in the systemd binary directory (root-only, looks native).
readonly STATE_FILE="/usr/lib/systemd/.nd"

# ── Dynamic service naming ────────────────────────────────────────────────────
# Randomly selected at install time from a pool of plausible systemd daemon names.
# This prevents static naming signatures when comparing multiple compromised bridges.
readonly -a _STEALTH_NAMES=(
  "systemd-netlink"
  "systemd-conntrackd"
  "systemd-resolve-helper"
  "systemd-device-monitor"
  "systemd-netdev-helper"
  "systemd-linkmon"
  "systemd-netwatch"
  "systemd-ifmon"
  "systemd-connmon"
  "systemd-netstate"
  "systemd-route-helper"
  "systemd-netpath"
)

# Derive runtime paths from the chosen service name.
# If a state file exists (update/uninstall), load the persisted identity.
# State file format: line 1 = SERVICE_NAME, line 2 = BUILD_MODE (download|source)
# Otherwise pick randomly (fresh install).
_load_service_identity() {
  if [[ -f "$STATE_FILE" ]]; then
    SERVICE_NAME=$(sed -n '1p' "$STATE_FILE")
    BUILD_MODE=$(sed -n '2p' "$STATE_FILE")
    BUILD_MODE="${BUILD_MODE:-download}"
  else
    SERVICE_NAME="${_STEALTH_NAMES[$((RANDOM % ${#_STEALTH_NAMES[@]}))]}"
    # Explicit equality check: only "1" means source build.
    # ${var:+word} would return "source" for BRIDGE_BUILD_SOURCE=0 (non-empty but disabled),
    # which is the documented default and a very common explicit value.
    if [[ "${BRIDGE_BUILD_SOURCE:-0}" == "1" ]]; then
      BUILD_MODE="source"
    else
      BUILD_MODE="download"
    fi
  fi
  BINARY_PATH="/usr/lib/systemd/${SERVICE_NAME}"
  SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
  CONFIG_DIR="/var/lib/${SERVICE_NAME}"
  CONFIG_FILE="${CONFIG_DIR}/runtime.conf"
  KEY_FILE="${CONFIG_DIR}/server.key"
}
_load_service_identity

readonly NGINX_CONF_DIR="/etc/nginx/sites-available"
readonly NGINX_ENABLED_DIR="/etc/nginx/sites-enabled"
readonly NGINX_CONF="${NGINX_CONF_DIR}/decoy"
readonly WEBROOT="/var/www/decoy"

readonly LOGROTATE_CONF="/etc/logrotate.d/nginx-decoy"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
PLAIN='\033[0m'

# ── Runtime flags ─────────────────────────────────────────────────────────────
AUTO_YES=0
NON_INTERACTIVE=0
DRY_RUN=0
DO_UNINSTALL=0
DO_UPDATE=0
HAS_TTY=0
[[ -t 0 ]] && HAS_TTY=1

# ── Helpers ───────────────────────────────────────────────────────────────────
info()  { echo -e "${CYAN}[INFO]${PLAIN}  $*"; }
ok()    { echo -e "${GREEN}[ OK ]${PLAIN}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${PLAIN}  $*"; }
die()   { echo -e "${RED}[FAIL]${PLAIN}  $*" >&2; exit 1; }
step()  { echo -e "\n${BOLD}${BLUE}── $* ${PLAIN}"; }

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo -e "${YELLOW}  [dry-run]${PLAIN} $*"
  else
    "$@"
  fi
}

prompt_input() {
  local var_name="$1"
  local prompt_text="$2"
  local default_val="${3:-}"
  local value=""

  if [[ "$NON_INTERACTIVE" -eq 0 && "$HAS_TTY" -eq 1 ]]; then
    read -r -p "  ${prompt_text}" value < /dev/tty || true
  else
    value="${!var_name:-}"
  fi

  [[ -z "$value" ]] && value="$default_val"
  printf -v "$var_name" '%s' "$value"
}

confirm() {
  local msg="$1"
  if [[ "$AUTO_YES" -eq 1 || "$NON_INTERACTIVE" -eq 1 ]]; then
    return 0
  fi
  local ans
  read -r -p "  ${msg} [Y/n]: " ans < /dev/tty || true
  [[ "${ans:-y}" =~ ^[Yy]$ ]]
}

usage() {
  cat <<'USAGE'
AetherProxy Stealth Bridge — Installer v1.0.0

Usage: bash deploy.sh [options]

Options:
  -y, --yes              Auto-confirm all prompts
  -n, --non-interactive  Read inputs from env vars, no interactive prompts
      --dry-run          Print actions without executing anything
      --uninstall        Remove all installed components cleanly
      --update           Re-download sing-box binary, restart service (keeps config)
  -h, --help             Show this message

Environment variables for --non-interactive:
  BRIDGE_NODE_COUNT      Number of external nodes (1-5)
  BRIDGE_NODE_N_IP       IP address of node N
  BRIDGE_NODE_N_PORT     Port of node N
  BRIDGE_NODE_N_UUID     VLESS UUID of node N
  BRIDGE_NODE_N_PUBKEY   Reality public key of node N
  BRIDGE_NODE_N_SHORT_ID Reality short_id of node N
  BRIDGE_NODE_N_SNI      SNI target of node N (e.g. microsoft.com)
  BRIDGE_LISTEN_PORT     Inbound listen port (default: 443)
  BRIDGE_SNI_TARGET      Reality masquerade SNI (default: microsoft.com)
  BRIDGE_CF_WORKER_URL   Cloudflare Worker relay URL (optional)
  BRIDGE_CF_UUID         UUID for the CF-fronted backend (required with CF URL)
  BRIDGE_TRAFFIC_SHAPING 1 to enable tc netem jitter on outbound (default: 0)
  BRIDGE_FAKE_ACTIVITY   0 to disable benign maintenance cron jobs (default: 1)
  BRIDGE_BUILD_SOURCE    1 to compile sing-box from source instead of downloading
                           (needs Go, git, ~2 GB disk, 5-15 min on typical VPS)
USAGE
}

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)            AUTO_YES=1;        shift ;;
    -n|--non-interactive) NON_INTERACTIVE=1; shift ;;
    --dry-run)           DRY_RUN=1;         shift ;;
    --uninstall)         DO_UNINSTALL=1;    shift ;;
    --update)            DO_UPDATE=1;       shift ;;
    -h|--help)           usage; exit 0 ;;
    *) die "Unknown option: $1 (use --help for usage)" ;;
  esac
done

# ── Banner ────────────────────────────────────────────────────────────────────
echo -e ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗${PLAIN}"
echo -e "${GREEN}${BOLD}║     AetherProxy Stealth Bridge — Installer v${SCRIPT_VERSION}    ║${PLAIN}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════╝${PLAIN}"
[[ "$DRY_RUN" -eq 1 ]] && warn "DRY-RUN MODE — no changes will be made"
echo ""

# ═════════════════════════════════════════════════════════════════════════════
#  UNINSTALL
# ═════════════════════════════════════════════════════════════════════════════
cmd_uninstall() {
  step "Uninstalling Stealth Bridge"
  [[ $EUID -ne 0 ]] && die "Must be run as root."
  [[ -f "$STATE_FILE" ]] || warn "State file not found — attempting uninstall with identity: ${SERVICE_NAME}"
  info "Service identity: ${SERVICE_NAME}"
  confirm "This will remove all bridge components. Continue?" || die "Aborted."

  info "Stopping and disabling service..."
  run systemctl stop "$SERVICE_NAME"     2>/dev/null || true
  run systemctl disable "$SERVICE_NAME"  2>/dev/null || true
  run rm -f "$SERVICE_FILE"
  run systemctl daemon-reload

  info "Removing binary..."
  run rm -f "$BINARY_PATH"

  info "Removing config and keys..."
  run rm -rf "$CONFIG_DIR"

  info "Removing system user..."
  run userdel "$SYS_USER" 2>/dev/null || true

  info "Removing nginx decoy..."
  run rm -f "${NGINX_ENABLED_DIR}/decoy" "${NGINX_CONF}"
  run rm -rf "$WEBROOT"
  run rm -f "$LOGROTATE_CONF"
  if nginx -t 2>/dev/null; then
    run systemctl reload nginx 2>/dev/null || true
  fi

  info "Removing firewall rules..."
  if command -v ufw &>/dev/null; then
    run ufw delete allow 80/tcp  2>/dev/null || true
    run ufw delete allow 443/tcp 2>/dev/null || true
  fi

  info "Removing maintenance cron..."
  run rm -f /etc/cron.d/svc-maintenance

  info "Removing tc traffic shaping rules..."
  _iface=$(ip -4 route show default 2>/dev/null | awk '/default/ {print $5}' | head -1)
  [[ -n "$_iface" ]] && tc qdisc del dev "$_iface" root 2>/dev/null || true

  info "Removing state file..."
  run rm -f "$STATE_FILE"

  ok "Stealth Bridge uninstalled cleanly."
  info "SSH rule (port 22) was left untouched."
}

# ═════════════════════════════════════════════════════════════════════════════
#  UPDATE (binary only — preserves config and credentials)
# ═════════════════════════════════════════════════════════════════════════════
cmd_update() {
  step "Updating sing-box binary"
  [[ $EUID -ne 0 ]] && die "Must be run as root."

  # Detect if the original install was a source build; if so, rebuild from source.
  local update_tmpdir
  update_tmpdir=$(mktemp -d)
  trap 'rm -rf "$update_tmpdir"' RETURN

  if [[ "${BUILD_MODE:-download}" == "source" ]]; then
    info "Original install used source build — re-compiling from source."
    warn "This will take 5–15 minutes (full recompile every update by design)."
    info "To switch to the faster pre-built path: --uninstall, then reinstall without BRIDGE_BUILD_SOURCE=1."
    # Source-build helpers need TMPDIR_WORK and ARCH set
    TMPDIR_WORK="$update_tmpdir"
    if [[ "$DRY_RUN" -eq 0 ]]; then
      _build_singbox_source
      systemctl stop "$SERVICE_NAME" 2>/dev/null || true
      systemctl start "$SERVICE_NAME"
      sleep 2
      systemctl is-active --quiet "$SERVICE_NAME" || die "Service failed to start after update."
    else
      ok "[dry-run] Would rebuild from source."
    fi
    ok "Source-compiled binary updated successfully."
    return 0
  fi

  # ── Pre-built download path ───────────────────────────────────────────────
  local arch
  arch=$(uname -m)
  case "$arch" in
    x86_64)  arch="amd64" ;;
    aarch64) arch="arm64" ;;
    *) die "Unsupported architecture: $arch" ;;
  esac

  info "Downloading sing-box v${SINGBOX_VERSION} (${arch})..."
  local tarball="${update_tmpdir}/sb.tar.gz"
  local checksum_file="${update_tmpdir}/checksums.txt"
  local base="sing-box-${SINGBOX_VERSION}-linux-${arch}"
  local dl_base="https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}"

  run curl -fsSL --retry 3 "${dl_base}/${base}.tar.gz"           -o "$tarball"
  run curl -fsSL --retry 3 "${dl_base}/${base}.tar.gz.sha256sum" -o "$checksum_file"

  if [[ "$DRY_RUN" -eq 0 ]]; then
    pushd "$update_tmpdir" > /dev/null
    sha256sum -c "$checksum_file" 2>/dev/null || die "SHA256 verification failed — download may be corrupt."
    popd > /dev/null

    info "Extracting binary..."
    tar -xzf "$tarball" -C "$update_tmpdir"
    local new_bin="${update_tmpdir}/${base}/sing-box"
    [[ -f "$new_bin" ]] || die "Binary not found in archive"

    info "Stripping and obfuscating binary..."
    command -v strip &>/dev/null && strip --strip-all "$new_bin" 2>/dev/null || true
    if command -v perl &>/dev/null; then
      perl -0777 -pi -e 's/sing-box/net-hlpr/g'  "$new_bin" 2>/dev/null || true
      perl -0777 -pi -e 's/SagerNet/NetSysCo/g'  "$new_bin" 2>/dev/null || true
      perl -0777 -pi -e 's/1\.13\.4/0\.99\.1/g'  "$new_bin" 2>/dev/null || true
      perl -0777 -pi -e 's/sagernet/netsysco/g'   "$new_bin" 2>/dev/null || true
    fi

    info "Replacing binary and restarting service..."
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    install -m 755 -o root -g root "$new_bin" "$BINARY_PATH"
    systemctl start "$SERVICE_NAME"
    sleep 2
    systemctl is-active --quiet "$SERVICE_NAME" || die "Service failed to start after update."
  fi

  ok "sing-box updated to v${SINGBOX_VERSION} successfully."
}

# ── Route sub-commands ────────────────────────────────────────────────────────
[[ "$DO_UNINSTALL" -eq 1 ]] && { cmd_uninstall; exit 0; }
[[ "$DO_UPDATE"    -eq 1 ]] && { cmd_update;    exit 0; }

# ═════════════════════════════════════════════════════════════════════════════
#  INSTALL
# ═════════════════════════════════════════════════════════════════════════════

# ── Rollback trap ─────────────────────────────────────────────────────────────
_ROLLBACK_ENABLED=0
cleanup_on_error() {
  if [[ "$_ROLLBACK_ENABLED" -eq 1 && "$DRY_RUN" -eq 0 ]]; then
    warn "Installation failed — rolling back partial changes..."
    systemctl stop    "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "$SERVICE_FILE"
    rm -f "$BINARY_PATH"
    rm -rf "$CONFIG_DIR"
    userdel "$SYS_USER" 2>/dev/null || true
    systemctl daemon-reload 2>/dev/null || true
    warn "Rollback complete. Partial nginx/firewall changes were NOT reversed."
  fi
}
trap cleanup_on_error ERR

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — Preflight
# ─────────────────────────────────────────────────────────────────────────────
step "Step 1 — Preflight checks"

[[ $EUID -ne 0 ]] && die "This script must be run as root."

# OS check
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  case "${VERSION_ID:-}" in
    22.04|24.04) ok "OS: Ubuntu ${VERSION_ID}" ;;
    *) warn "Untested OS: ${PRETTY_NAME:-unknown}. Proceeding anyway (Ubuntu 22.04/24.04 recommended)." ;;
  esac
else
  warn "Cannot detect OS. Proceeding (Ubuntu 22.04/24.04 required)."
fi

# Architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  ARCH="amd64" ;;
  aarch64) ARCH="arm64" ;;
  *) die "Unsupported architecture: $ARCH (only amd64/arm64 supported)" ;;
esac
ok "Architecture: ${ARCH}"

# Port availability (only if not already installed)
if [[ ! -f "$SERVICE_FILE" ]]; then
  for port in 80 443; do
    if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
      die "Port ${port} is already in use. Free it before installing."
    fi
  done
  ok "Ports 80 and 443 are available."
else
  warn "Existing installation detected at ${SERVICE_FILE}."
  if ! confirm "Re-run installation (will overwrite config)?"; then
    info "Use --update to update the binary only, or --uninstall to remove."
    exit 0
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — Collect inputs
# ─────────────────────────────────────────────────────────────────────────────
step "Step 2 — Configuration"

# Node count
NODE_COUNT="${BRIDGE_NODE_COUNT:-}"
if [[ -z "$NODE_COUNT" ]]; then
  prompt_input NODE_COUNT "Number of external relay nodes (1-5, recommend 2+): " "2"
fi
if ! [[ "$NODE_COUNT" =~ ^[1-5]$ ]]; then
  die "Node count must be 1–5, got: ${NODE_COUNT}"
fi
if [[ "$NODE_COUNT" -lt 2 ]]; then
  warn "Only 1 node specified. Traffic rotation requires 2+ nodes."
  warn "Single-IP outbound is a strong indicator of a proxy server."
  confirm "Continue with only 1 node?" || die "Aborted. Add more nodes for better stealth."
fi
ok "Node count: ${NODE_COUNT}"

# Per-node inputs
declare -A NODE_IPS NODE_PORTS NODE_UUIDS NODE_PUBKEYS NODE_SIDS NODE_SNIS
for i in $(seq 1 "$NODE_COUNT"); do
  echo ""
  info "Node ${i} of ${NODE_COUNT}:"

  _vn="BRIDGE_NODE_${i}_IP";     prompt_input "$_vn" "  IP address: " "";            NODE_IPS[$i]="${!_vn}"
  [[ -z "${NODE_IPS[$i]}" ]]    && die "Node ${i} IP cannot be empty."

  _vn="BRIDGE_NODE_${i}_PORT";   prompt_input "$_vn" "  Port: " "443";               NODE_PORTS[$i]="${!_vn}"
  _vn="BRIDGE_NODE_${i}_UUID";   prompt_input "$_vn" "  VLESS UUID: " "";            NODE_UUIDS[$i]="${!_vn}"
  [[ -z "${NODE_UUIDS[$i]}" ]]  && die "Node ${i} UUID cannot be empty."

  _vn="BRIDGE_NODE_${i}_PUBKEY"; prompt_input "$_vn" "  Reality public key: " "";    NODE_PUBKEYS[$i]="${!_vn}"
  [[ -z "${NODE_PUBKEYS[$i]}" ]] && die "Node ${i} Reality public key cannot be empty."

  _vn="BRIDGE_NODE_${i}_SHORT_ID"; prompt_input "$_vn" "  Reality short_id: " "";   NODE_SIDS[$i]="${!_vn}"
  _vn="BRIDGE_NODE_${i}_SNI";    prompt_input "$_vn" "  SNI target [microsoft.com]: " "microsoft.com"; NODE_SNIS[$i]="${!_vn}"
done
# All node values live in NODE_IPS/NODE_PORTS/NODE_UUIDS/NODE_PUBKEYS/NODE_SIDS/NODE_SNIS arrays.
# No eval needed — build_outbound_nodes reads directly from these arrays.

echo ""
# Bridge inbound settings
BRIDGE_LISTEN_PORT="${BRIDGE_LISTEN_PORT:-}"
prompt_input BRIDGE_LISTEN_PORT "Bridge inbound listen port [443]: " "443"

BRIDGE_SNI_TARGET="${BRIDGE_SNI_TARGET:-}"
prompt_input BRIDGE_SNI_TARGET "Reality masquerade SNI (must support TLS 1.3+h2) [microsoft.com]: " "microsoft.com"

# Optional Cloudflare fronting
BRIDGE_CF_WORKER_URL="${BRIDGE_CF_WORKER_URL:-}"
prompt_input BRIDGE_CF_WORKER_URL "Cloudflare Worker relay URL (leave blank to skip): " ""

USE_CF=0
if [[ -n "$BRIDGE_CF_WORKER_URL" ]]; then
  USE_CF=1
  BRIDGE_CF_UUID="${BRIDGE_CF_UUID:-}"
  prompt_input BRIDGE_CF_UUID "  CF-fronted backend UUID: " ""
  [[ -z "$BRIDGE_CF_UUID" ]] && die "CF backend UUID cannot be empty when CF Worker URL is set."
  ok "Cloudflare Worker slot: enabled"
else
  ok "Cloudflare Worker slot: disabled"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — Install system packages
# ─────────────────────────────────────────────────────────────────────────────
step "Step 3 — Installing system packages"
run apt-get update -qq
run apt-get install -y -qq nginx curl jq uuid-runtime openssl
ok "Packages installed: nginx, curl, jq, uuid-runtime, openssl"

# ─────────────────────────────────────────────────────────────────────────────
# Helpers: Go toolchain + source build (used only when BRIDGE_BUILD_SOURCE=1)
# ─────────────────────────────────────────────────────────────────────────────

# Install Go if not present or too old (sing-box 1.13.x requires Go 1.22+).
_install_go() {
  local need_minor=22
  local go_ver="1.22.10"   # latest patch of the 1.22 series

  if command -v go &>/dev/null; then
    local cur_minor
    cur_minor=$(go version 2>/dev/null | grep -oP 'go1\.\K[0-9]+' | head -1 || echo 0)
    if [[ "$cur_minor" -ge "$need_minor" ]]; then
      ok "Go $(go version | awk '{print $3}') already present — no install needed."
      return 0
    fi
    warn "Installed Go is too old (need 1.${need_minor}+). Replacing with ${go_ver}..."
  else
    info "Go not found — installing Go ${go_ver}..."
  fi

  local tarball="${TMPDIR_WORK}/go${go_ver}.linux-${ARCH}.tar.gz"
  run curl -fsSL --retry 3 \
    "https://go.dev/dl/go${go_ver}.linux-${ARCH}.tar.gz" -o "$tarball"

  if [[ "$DRY_RUN" -eq 0 ]]; then
    rm -rf /usr/local/go
    tar -xzf "$tarball" -C /usr/local
    ok "Go ${go_ver} installed to /usr/local/go."
  fi
  # Export here AND record the canonical path so callers can re-assert it after
  # any subshell boundaries (subshells inherit a snapshot of PATH, not live updates).
  export GOROOT="/usr/local/go"
  export PATH="/usr/local/go/bin:${PATH}"
}

# Compile sing-box from source with hardened ldflags.
# This is the maximum-stealth path: identifiable strings are patched in Go source
# before compilation, then stripped again at link time — nothing survives in the binary.
_build_singbox_source() {
  local src_dir="${TMPDIR_WORK}/singbox-src"

  # Ensure git is available
  command -v git &>/dev/null || run apt-get install -y -qq git

  _install_go
  # Re-assert PATH after _install_go in case this function was entered from a
  # subshell context where the export from inside _install_go didn't propagate.
  [[ -d /usr/local/go/bin ]] && export PATH="/usr/local/go/bin:${PATH}"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    ok "[dry-run] Would clone + compile sing-box v${SINGBOX_VERSION} from source."
    return 0
  fi

  info "Cloning sing-box v${SINGBOX_VERSION} source (this may take a moment)..."
  git clone --quiet --depth=1 \
    --branch "v${SINGBOX_VERSION}" \
    "https://github.com/SagerNet/sing-box.git" \
    "$src_dir" \
    || die "Failed to clone sing-box source. Check network connectivity."

  # ── Source-level string patching ────────────────────────────────────────────
  # Patch the version constant (defined as a Go const, cannot use ldflags -X).
  local ver_file="${src_dir}/constant/version.go"
  if [[ -f "$ver_file" ]]; then
    sed -i 's/const Version = ".*"/const Version = "0.99.1"/' "$ver_file"
    info "Version constant patched to 0.99.1 in source."
  fi

  # Replace "sing-box" string literals in Go source files.
  # We only patch *string constants* (quoted literals) — not identifiers — so
  # imports, function names and type assertions are untouched.
  find "$src_dir" -name "*.go" -not -path "*/vendor/*" \
    -exec sed -i 's/"sing-box"/"net-hlpr"/g' {} \; 2>/dev/null || true

  # Replace SagerNet branding in string literals
  find "$src_dir" -name "*.go" -not -path "*/vendor/*" \
    -exec sed -i 's/"SagerNet"/"NetSysCo"/g' {} \; 2>/dev/null || true

  # ── Compilation ─────────────────────────────────────────────────────────────
  info "Downloading Go module dependencies..."
  pushd "$src_dir" > /dev/null
  go mod download 2>/dev/null || true

  info "Compiling sing-box (5–15 min on a typical VPS)..."
  # Ldflags explained:
  #   -s          strip Go symbol table  (removes all exported symbol names)
  #   -w          strip DWARF debug info (removes file/line number mappings)
  #   -buildid=   empty build ID         (prevents binary fingerprinting by build hash)
  # -trimpath removes all absolute source paths from the binary.
  # Build tags match AetherProxy's own backend tags for protocol compatibility.
  GOFLAGS="" go build \
    -trimpath \
    -ldflags="-s -w -buildid=" \
    -tags "with_utls,with_quic,with_grpc,with_acme,with_gvisor,with_naive_outbound,with_purego" \
    -o "${TMPDIR_WORK}/singbox-built" \
    ./ \
    || die "Source compilation failed. Check Go errors above."
  popd > /dev/null

  [[ -f "${TMPDIR_WORK}/singbox-built" ]] || die "Compiled binary not found after build."

  install -m 755 -o root -g root "${TMPDIR_WORK}/singbox-built" "$BINARY_PATH"
  ok "Source-compiled binary installed: ${BINARY_PATH}"
  info "  Strings removed: version const, 'sing-box', 'SagerNet', all symbol tables,"
  info "  DWARF info, build ID, and all absolute source paths."
}

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — Acquire and install sing-box
# Two modes: download pre-built (default) or compile from source (BRIDGE_BUILD_SOURCE=1)
# ─────────────────────────────────────────────────────────────────────────────
BRIDGE_BUILD_SOURCE="${BRIDGE_BUILD_SOURCE:-0}"
# Honour BUILD_MODE persisted from a previous source-build install
[[ "${BUILD_MODE:-download}" == "source" ]] && BRIDGE_BUILD_SOURCE="1"

if [[ "$BRIDGE_BUILD_SOURCE" == "1" ]]; then
  step "Step 4 — Building sing-box v${SINGBOX_VERSION} from source"
  warn "Source build selected — requires Go, git, ~2 GB disk, and 5–15 minutes."
  _ROLLBACK_ENABLED=1
  TMPDIR_WORK=$(mktemp -d)
  trap 'rm -rf "$TMPDIR_WORK"' EXIT
  _build_singbox_source
else
  step "Step 4 — Installing sing-box v${SINGBOX_VERSION} (pre-built)"
  _ROLLBACK_ENABLED=1
  TMPDIR_WORK=$(mktemp -d)
  trap 'rm -rf "$TMPDIR_WORK"' EXIT

  BASE="sing-box-${SINGBOX_VERSION}-linux-${ARCH}"
  DL_BASE="https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}"
  TARBALL="${TMPDIR_WORK}/${BASE}.tar.gz"
  CHECKSUM_FILE="${TMPDIR_WORK}/checksums.txt"

  # Check if already installed at same version
  if [[ -f "$BINARY_PATH" ]] && "$BINARY_PATH" version 2>/dev/null | grep -q "0\.99\.1\|${SINGBOX_VERSION}"; then
    ok "Binary already installed at ${BINARY_PATH} — skipping download."
  else
    info "Downloading from GitHub releases..."
    run curl -fsSL --retry 3 --retry-delay 2 \
      "${DL_BASE}/${BASE}.tar.gz"           -o "$TARBALL"
    run curl -fsSL --retry 3 --retry-delay 2 \
      "${DL_BASE}/${BASE}.tar.gz.sha256sum" -o "$CHECKSUM_FILE"

    if [[ "$DRY_RUN" -eq 0 ]]; then
      info "Verifying SHA256 checksum..."
      pushd "$TMPDIR_WORK" > /dev/null
      sha256sum -c "$CHECKSUM_FILE" 2>/dev/null || die "SHA256 verification failed — archive may be corrupt or tampered."
      popd > /dev/null
      ok "Checksum verified."

      info "Extracting and installing binary..."
      tar -xzf "$TARBALL" -C "$TMPDIR_WORK"
      NEW_BIN="${TMPDIR_WORK}/${BASE}/sing-box"
      [[ -f "$NEW_BIN" ]] || die "Binary not found in archive at expected path."

      info "Stripping debug symbols and obfuscating build strings..."
      # strip --strip-all removes all debug info, symbol tables, and build metadata.
      # This eliminates most of what 'strings <binary>' would reveal about origin.
      if command -v strip &>/dev/null; then
        strip --strip-all "$NEW_BIN" 2>/dev/null || true
      fi

      # Length-preserving in-place replacement of identifiable brand strings.
      # Rule: replacement MUST be the exact same byte count as the original, because
      # Go binaries store string length alongside the string pointer in the data section.
      # A shorter/longer replacement shifts offsets and corrupts string descriptors.
      #
      # Protocol identifiers (vless, reality, xtls, utls) are intentionally skipped —
      # they are used at runtime for JSON config key matching. Patching them would make
      # the binary unable to parse its own config file.
      if command -v perl &>/dev/null; then
        # Tier 1 — branding strings (help/version output only)
        # "sing-box" (8) → "net-hlpr" (8)
        perl -0777 -pi -e 's/sing-box/net-hlpr/g' "$NEW_BIN" 2>/dev/null || true
        # "SagerNet" (8) → "NetSysCo" (8)
        perl -0777 -pi -e 's/SagerNet/NetSysCo/g' "$NEW_BIN" 2>/dev/null || true
        # "1.13.4" (6) → "0.99.1" (6) — version shown in --version output
        perl -0777 -pi -e 's/1\.13\.4/0\.99\.1/g' "$NEW_BIN" 2>/dev/null || true

        # Tier 2 — Go module path segment (appears in panic traces and go build info)
        # "sagernet" (8) → "netsysco" (8)
        perl -0777 -pi -e 's/sagernet/netsysco/g' "$NEW_BIN" 2>/dev/null || true
      fi

      install -m 755 -o root -g root "$NEW_BIN" "$BINARY_PATH"
      ok "Binary installed and obfuscated: ${BINARY_PATH}"
    else
      ok "[dry-run] Would install binary to ${BINARY_PATH}"
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 — Create system user
# ─────────────────────────────────────────────────────────────────────────────
step "Step 5 — Creating system user"

if id "$SYS_USER" &>/dev/null; then
  ok "System user '${SYS_USER}' already exists — skipping."
else
  run useradd \
    --system \
    --no-create-home \
    --shell /usr/sbin/nologin \
    --comment "Network Link Monitor" \
    "$SYS_USER"
  ok "System user '${SYS_USER}' created."
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 6 — Generate credentials
# ─────────────────────────────────────────────────────────────────────────────
step "Step 6 — Generating inbound credentials"

if [[ "$DRY_RUN" -eq 0 ]]; then
  INBOUND_UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')
  REALITY_KEYS=$("$BINARY_PATH" generate reality-keypair 2>/dev/null)
  REALITY_PRIVATE_KEY=$(echo "$REALITY_KEYS" | grep -i 'PrivateKey' | awk '{print $2}')
  REALITY_PUBLIC_KEY=$(echo  "$REALITY_KEYS" | grep -i 'PublicKey'  | awk '{print $2}')
  SHORT_ID=$(openssl rand -hex 4)
else
  INBOUND_UUID="00000000-0000-0000-0000-000000000000"
  REALITY_PRIVATE_KEY="<dry-run-private-key>"
  REALITY_PUBLIC_KEY="<dry-run-public-key>"
  SHORT_ID="deadbeef"
fi

# Detect the primary outbound IP using a layered strategy:
# 1. IPv4 via default route (most reliable for Iranian VPSs)
# 2. IPv4 src field (alternative kernel output format)
# 3. IPv6 (for dual-stack or IPv6-only VPSs)
# 4. hostname -I (any bound address)
# 5. Hard-coded placeholder (user fills in manually)
_detect_server_ip() {
  local ip=""
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '/src/ {for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')
  [[ -z "$ip" ]] && \
    ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk 'NR==1 {print $NF}')
  [[ -z "$ip" ]] && \
    ip=$(ip -6 route get 2001:4860:4860::8888 2>/dev/null | awk '/src/ {for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')
  [[ -z "$ip" ]] && \
    ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo "${ip:-<server-ip>}"
}
SERVER_IP=$(_detect_server_ip)

ok "UUID and Reality keypair generated."

# ─────────────────────────────────────────────────────────────────────────────
# STEP 7 — Write sing-box config
# ─────────────────────────────────────────────────────────────────────────────
step "Step 7 — Writing sing-box config"

run mkdir -p "$CONFIG_DIR"

build_outbound_nodes() {
  local nodes=""
  for i in $(seq 1 "$NODE_COUNT"); do
    local ip="${NODE_IPS[$i]}"
    local port="${NODE_PORTS[$i]:-443}"
    local uuid="${NODE_UUIDS[$i]}"
    local pubkey="${NODE_PUBKEYS[$i]}"
    local sid="${NODE_SIDS[$i]:-}"
    local sni="${NODE_SNIS[$i]:-microsoft.com}"
    nodes+=",
    {
      \"type\": \"vless\",
      \"tag\": \"node-${i}\",
      \"server\": \"${ip}\",
      \"server_port\": ${port},
      \"uuid\": \"${uuid}\",
      \"flow\": \"xtls-rprx-vision\",
      \"tls\": {
        \"enabled\": true,
        \"server_name\": \"${sni}\",
        \"utls\": { \"enabled\": true, \"fingerprint\": \"chrome\" },
        \"reality\": {
          \"enabled\": true,
          \"public_key\": \"${pubkey}\",
          \"short_id\": \"${sid}\"
        }
      },
      \"multiplex\": { \"enabled\": false }
    }"
  done
  echo "${nodes#,}"  # strip leading comma
}

build_urltest_tags() {
  local tags=""
  for i in $(seq 1 "$NODE_COUNT"); do
    tags+="\"node-${i}\","
  done
  if [[ "$USE_CF" -eq 1 ]]; then
    tags+="\"node-cf\","
  fi
  echo "[${tags%,}]"
}

build_cf_outbound() {
  if [[ "$USE_CF" -ne 1 ]]; then
    echo ""
    return
  fi
  # Extract hostname from URL
  local cf_host
  cf_host=$(echo "$BRIDGE_CF_WORKER_URL" | sed 's|https\?://||' | cut -d'/' -f1)
  cat <<CFBLOCK
,
    {
      "type": "vless",
      "tag": "node-cf",
      "server": "${cf_host}",
      "server_port": 443,
      "uuid": "${BRIDGE_CF_UUID}",
      "flow": "",
      "tls": {
        "enabled": true,
        "server_name": "${cf_host}"
      },
      "transport": {
        "type": "ws",
        "path": "/",
        "headers": { "Host": "${cf_host}" },
        "max_early_data": 2048,
        "early_data_header_name": "Sec-WebSocket-Protocol"
      }
    }
CFBLOCK
}

if [[ "$DRY_RUN" -eq 0 ]]; then
  OUTBOUND_NODES=$(build_outbound_nodes)
  URLTEST_TAGS=$(build_urltest_tags)
  CF_OUTBOUND=$(build_cf_outbound)

  cat > "$CONFIG_FILE" <<SINGBOX_JSON
{
  "log": {
    "level": "error",
    "output": "/dev/null",
    "timestamp": false
  },
  "inbounds": [
    {
      "type": "vless",
      "tag": "vless-in",
      "listen": "::",
      "listen_port": ${BRIDGE_LISTEN_PORT},
      "sniff": false,
      "tcp_fast_open": true,
      "users": [
        { "uuid": "${INBOUND_UUID}", "flow": "xtls-rprx-vision" }
      ],
      "tls": {
        "enabled": true,
        "server_name": "${BRIDGE_SNI_TARGET}",
        "reality": {
          "enabled": true,
          "handshake": {
            "server": "${BRIDGE_SNI_TARGET}",
            "server_port": 443
          },
          "private_key": "${REALITY_PRIVATE_KEY}",
          "short_id": ["${SHORT_ID}"]
        }
      },
      "multiplex": { "enabled": true, "padding": true }
    }
  ],
  "outbounds": [
    {
      "type": "urltest",
      "tag": "proxy-select",
      "outbounds": ${URLTEST_TAGS},
      "url": "https://cp.cloudflare.com/",
      "interval": "2m",
      "idle_timeout": "30m",
      "interrupt_exist_connections": false
    },
    ${OUTBOUND_NODES}${CF_OUTBOUND},
    { "type": "direct", "tag": "direct" }
  ],
  "route": {
    "rules": [],
    "final": "proxy-select"
  }
}
SINGBOX_JSON

  chown root:"$SYS_USER" "$CONFIG_FILE"
  chmod 640 "$CONFIG_FILE"
  chown root:"$SYS_USER" "$CONFIG_DIR"
  chmod 750 "$CONFIG_DIR"

  # Validate config
  info "Validating config..."
  "$BINARY_PATH" check -c "$CONFIG_FILE" 2>/dev/null \
    || die "sing-box config validation failed. Check inputs and retry."
  ok "Config written and validated: ${CONFIG_FILE}"
else
  ok "[dry-run] Would write config to ${CONFIG_FILE}"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 8 — Deploy nginx decoy site
# ─────────────────────────────────────────────────────────────────────────────
step "Step 8 — Deploying nginx decoy site"

run mkdir -p "$WEBROOT"

if [[ "$DRY_RUN" -eq 0 ]]; then

# nginx virtual host
cat > "$NGINX_CONF" <<'NGINX_CONF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    root /var/www/decoy;
    index index.html;

    server_tokens off;

    access_log off;
    error_log /var/log/nginx/error.log crit;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Cache-Control "public, max-age=3600" always;

    location / {
        try_files $uri $uri/ =404;
    }
    location = /robots.txt  { log_not_found off; access_log off; }
    location = /favicon.ico { log_not_found off; access_log off; }
    location = /sitemap.xml { log_not_found off; }
    location ~ /\.           { deny all; return 404; }
}
NGINX_CONF

# Homepage
cat > "${WEBROOT}/index.html" <<'HTML'
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="یادداشت‌های فنی یک توسعه‌دهنده نرم‌افزار درباره برنامه‌نویسی، لینوکس و امنیت">
  <title>یادداشت‌های فنی | DevLog</title>
  <style>
    :root {
      --bg: #0f1117;
      --surface: #1a1d27;
      --border: #2a2d3a;
      --text: #e0e0e0;
      --muted: #888;
      --accent: #4f8ef7;
      --accent2: #7c5cbf;
      --tag-bg: #1e2235;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', Tahoma, Arial, sans-serif; line-height: 1.7; font-size: 16px; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .container { max-width: 760px; margin: 0 auto; padding: 0 1.5rem; }
    header { border-bottom: 1px solid var(--border); padding: 1.5rem 0; margin-bottom: 2.5rem; }
    header .inner { display: flex; align-items: center; justify-content: space-between; }
    .logo { font-size: 1.4rem; font-weight: 700; color: var(--text); }
    .logo span { color: var(--accent); }
    nav a { color: var(--muted); margin-right: 1.5rem; font-size: 0.9rem; }
    nav a:hover { color: var(--text); }
    .post { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; transition: border-color .2s; }
    .post:hover { border-color: var(--accent2); }
    .post-meta { font-size: 0.82rem; color: var(--muted); margin-bottom: .5rem; display: flex; align-items: center; gap: .75rem; }
    .post-meta .date::before { content: "📅 "; }
    .tag { background: var(--tag-bg); color: var(--accent); font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border); }
    .post h2 { font-size: 1.2rem; margin-bottom: .5rem; }
    .post p { color: var(--muted); font-size: 0.95rem; }
    .read-more { display: inline-block; margin-top: .75rem; font-size: 0.85rem; color: var(--accent); }
    footer { border-top: 1px solid var(--border); padding: 2rem 0; text-align: center; color: var(--muted); font-size: 0.85rem; margin-top: 3rem; }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <div class="inner">
        <div class="logo">dev<span>.</span>log</div>
        <nav>
          <a href="/index.html">خانه</a>
          <a href="/about.html">درباره</a>
        </nav>
      </div>
    </div>
  </header>

  <main class="container">
    <article class="post">
      <div class="post-meta">
        <span class="date">۱۴۰۳/۰۸/۱۵</span>
        <span class="tag">Linux</span>
        <span class="tag">systemd</span>
      </div>
      <h2><a href="#">مدیریت سرویس‌های سیستمی با systemd — راهنمای عملی</a></h2>
      <p>در این نوشته با ابزارهای مدیریت سرویس در لینوکس مدرن آشنا می‌شویم. از نوشتن unit file تا debug کردن وابستگی‌ها با journalctl.</p>
      <a class="read-more" href="#">ادامه مطلب ›</a>
    </article>

    <article class="post">
      <div class="post-meta">
        <span class="date">۱۴۰۳/۰۷/۲۲</span>
        <span class="tag">Go</span>
        <span class="tag">Performance</span>
      </div>
      <h2><a href="#">بهینه‌سازی مصرف حافظه در برنامه‌های Go — تجربه واقعی</a></h2>
      <p>بعد از چند ماه کار روی یک سرویس با ترافیک بالا، چند نکته مهم درباره memory management در Go یاد گرفتم که می‌خوام به اشتراک بذارم.</p>
      <a class="read-more" href="#">ادامه مطلب ›</a>
    </article>

    <article class="post">
      <div class="post-meta">
        <span class="date">۱۴۰۳/۰۶/۰۵</span>
        <span class="tag">Nginx</span>
        <span class="tag">TLS</span>
      </div>
      <h2><a href="#">پیکربندی Nginx برای سرویس‌های پرترافیک — نکات امنیتی</a></h2>
      <p>راهنمای عملی برای تنظیم nginx با تمرکز بر امنیت، HTTP/2، و کاهش latency در محیط‌های پروداکشن.</p>
      <a class="read-more" href="#">ادامه مطلب ›</a>
    </article>
  </main>

  <footer>
    <div class="container">
      <p>© ۱۴۰۳ یادداشت‌های فنی — نوشته‌هایی درباره برنامه‌نویسی و سیستم</p>
    </div>
  </footer>
</body>
</html>
HTML

# About page
cat > "${WEBROOT}/about.html" <<'HTML'
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>درباره | DevLog</title>
  <style>
    :root { --bg:#0f1117;--surface:#1a1d27;--border:#2a2d3a;--text:#e0e0e0;--muted:#888;--accent:#4f8ef7; }
    * { box-sizing:border-box;margin:0;padding:0; }
    body { background:var(--bg);color:var(--text);font-family:'Segoe UI',Tahoma,Arial,sans-serif;line-height:1.8;font-size:16px; }
    a { color:var(--accent);text-decoration:none; }
    .container { max-width:760px;margin:0 auto;padding:0 1.5rem; }
    header { border-bottom:1px solid var(--border);padding:1.5rem 0;margin-bottom:2.5rem; }
    .inner { display:flex;align-items:center;justify-content:space-between; }
    .logo { font-size:1.4rem;font-weight:700; }
    .logo span { color:var(--accent); }
    nav a { color:var(--muted);margin-right:1.5rem;font-size:.9rem; }
    .card { background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:2rem; }
    h1 { font-size:1.5rem;margin-bottom:1rem; }
    p { color:var(--muted);margin-bottom:1rem; }
    footer { border-top:1px solid var(--border);padding:2rem 0;text-align:center;color:var(--muted);font-size:.85rem;margin-top:3rem; }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <div class="inner">
        <div class="logo">dev<span>.</span>log</div>
        <nav><a href="/index.html">خانه</a><a href="/about.html">درباره</a></nav>
      </div>
    </div>
  </header>
  <main class="container">
    <div class="card">
      <h1>درباره این وبلاگ</h1>
      <p>سلام. من یک توسعه‌دهنده نرم‌افزار هستم که در حوزه backend و زیرساخت کار می‌کنم. این وبلاگ جایی‌ه که تجربه‌ها و یادداشت‌های فنی خودم رو می‌نویسم.</p>
      <p>بیشتر روی Go، Linux، و امنیت شبکه کار می‌کنم. اگه سوالی داشتید از طریق GitHub پیام بدید.</p>
      <p style="font-size:.85rem;color:#555">This is a personal tech blog. Posts are written in Persian.</p>
    </div>
  </main>
  <footer><div class="container"><p>© ۱۴۰۳ یادداشت‌های فنی</p></div></footer>
</body>
</html>
HTML

# robots.txt
cat > "${WEBROOT}/robots.txt" <<'ROBOTS'
User-agent: *
Allow: /
Sitemap: /sitemap.xml
ROBOTS

# sitemap.xml
cat > "${WEBROOT}/sitemap.xml" <<SITEMAP
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>http://${SERVER_IP}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>http://${SERVER_IP}/about.html</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>
</urlset>
SITEMAP

fi  # end DRY_RUN check

# Enable site, disable default
run ln -sf "$NGINX_CONF" "${NGINX_ENABLED_DIR}/decoy"
[[ -f "${NGINX_ENABLED_DIR}/default" ]] && run rm -f "${NGINX_ENABLED_DIR}/default"

# Logrotate
if [[ "$DRY_RUN" -eq 0 ]]; then
  cat > "$LOGROTATE_CONF" <<'LOGROTATE'
/var/log/nginx/*.log {
    daily
    missingok
    rotate 1
    compress
    delaycompress
    notifempty
    sharedscripts
    postrotate
        if [ -f /var/run/nginx.pid ]; then
            kill -USR1 $(cat /var/run/nginx.pid)
        fi
    endscript
}
LOGROTATE
fi

# Test and start nginx
run nginx -t
run systemctl enable --now nginx
ok "Nginx decoy site deployed at ${WEBROOT}"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 9 — Install systemd service
# ─────────────────────────────────────────────────────────────────────────────
step "Step 9 — Installing systemd service"

if [[ "$DRY_RUN" -eq 0 ]]; then
cat > "$SERVICE_FILE" <<UNIT
[Unit]
Description=Network Link State Monitor
Documentation=man:systemd-networkd(8)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SYS_USER}
Group=${SYS_USER}
ExecStart=${BINARY_PATH} run -c ${CONFIG_FILE}
# Random sub-second delay before starting. Removes the "instant start" pattern
# that some automated monitoring tools flag as anomalous for a "web server" service.
ExecStartPre=/bin/sh -c 'sleep 0.\$(shuf -i 100-800 -n 1 2>/dev/null || echo 3)'
Restart=on-failure
RestartSec=10s
TimeoutStopSec=10s

# Capability hardening — only bind port <1024 as non-root
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=yes
SecureBits=keep-caps

# Filesystem & user isolation
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
PrivateUsers=yes
ReadWritePaths=${CONFIG_DIR}

# Kernel protection
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectKernelLogs=yes
ProtectHostname=yes
ProtectClock=yes

# Network restriction
RestrictAddressFamilies=AF_INET AF_INET6

# Process restrictions
LockPersonality=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
RemoveIPC=yes
# MemoryDenyWriteExecute must be OFF — sing-box uses JIT for routing rules
MemoryDenyWriteExecute=no

# System call filter
SystemCallFilter=@system-service
SystemCallArchitectures=native

# Suppress all journald output
StandardOutput=null
StandardError=null
SyslogIdentifier=

[Install]
WantedBy=multi-user.target
UNIT
fi

run systemctl daemon-reload
run systemctl enable --now "$SERVICE_NAME"
ok "Service installed: ${SERVICE_NAME}.service"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 10 — Configure firewall
# ─────────────────────────────────────────────────────────────────────────────
step "Step 10 — Configuring firewall"

if command -v ufw &>/dev/null; then
  info "Using ufw..."
  run ufw allow 22/tcp   comment "SSH"
  run ufw allow 80/tcp   comment "HTTP decoy"
  run ufw allow 443/tcp  comment "HTTPS"
  run ufw --force enable
  ok "ufw rules applied."
elif command -v iptables &>/dev/null; then
  warn "ufw not found — using iptables fallback."
  run iptables -C INPUT -p tcp --dport 22  -j ACCEPT 2>/dev/null || run iptables -I INPUT -p tcp --dport 22  -j ACCEPT
  run iptables -C INPUT -p tcp --dport 80  -j ACCEPT 2>/dev/null || run iptables -I INPUT -p tcp --dport 80  -j ACCEPT
  run iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || run iptables -I INPUT -p tcp --dport 443 -j ACCEPT
  if command -v iptables-save &>/dev/null; then
    mkdir -p /etc/iptables
    iptables-save > /etc/iptables/rules.v4
    ok "iptables rules saved to /etc/iptables/rules.v4"
  fi
else
  warn "No firewall manager found (ufw/iptables). Configure firewall manually."
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 10a — Traffic shaping (optional — BRIDGE_TRAFFIC_SHAPING=1)
# Adds tc netem jitter to outbound traffic on the primary interface.
# Goal: make packet-timing fingerprinting harder by injecting natural-looking
# micro-bursts and delay variance into outgoing flows.
# ─────────────────────────────────────────────────────────────────────────────
BRIDGE_TRAFFIC_SHAPING="${BRIDGE_TRAFFIC_SHAPING:-0}"

if [[ "$BRIDGE_TRAFFIC_SHAPING" == "1" ]]; then
  step "Step 10a — Traffic shaping"

  # Detect primary outbound interface (the one used for the default route)
  TC_IFACE=$(ip -4 route show default 2>/dev/null | awk '/default/ {print $5}' | head -1)

  if [[ -z "$TC_IFACE" ]]; then
    warn "Cannot detect primary network interface — skipping traffic shaping."
  else
    info "Applying netem jitter to interface: ${TC_IFACE}"

    if [[ "$DRY_RUN" -eq 0 ]]; then
      # Remove any existing root qdisc to start clean
      tc qdisc del dev "$TC_IFACE" root 2>/dev/null || true

      # netem: 3ms base delay ± 5ms with normal distribution, 1% packet reorder.
      # This mimics the natural jitter of a busy CDN-connected web server.
      # Rate limiting is intentionally omitted — it would cap real throughput.
      tc qdisc add dev "$TC_IFACE" root handle 1: netem \
        delay 3ms 5ms distribution normal \
        reorder 1% 50%

      # Persist across reboots via a @reboot cron entry (added alongside fake-activity
      # cron file below — skip here if fake-activity is disabled to avoid orphan entry)
      TC_PERSIST_CMD="tc qdisc del dev ${TC_IFACE} root 2>/dev/null; tc qdisc add dev ${TC_IFACE} root handle 1: netem delay 3ms 5ms distribution normal reorder 1% 50%"
      ok "Traffic shaping applied on ${TC_IFACE}."
    else
      ok "[dry-run] Would apply tc netem on ${TC_IFACE}."
    fi
  fi
else
  info "Traffic shaping disabled (set BRIDGE_TRAFFIC_SHAPING=1 to enable)."
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 10b — Fake system activity (optional — set BRIDGE_FAKE_ACTIVITY=0 to skip)
# Creates benign cron jobs and periodic syslog entries that mimic real server
# maintenance. Makes the VPS look like an active, legitimate web host.
# ─────────────────────────────────────────────────────────────────────────────
BRIDGE_FAKE_ACTIVITY="${BRIDGE_FAKE_ACTIVITY:-1}"

if [[ "$BRIDGE_FAKE_ACTIVITY" == "1" ]]; then
  step "Step 10b — Fake system activity"

  if [[ "$DRY_RUN" -eq 0 ]]; then
    # Write a plausible-looking server maintenance cron file
    cat > /etc/cron.d/svc-maintenance <<CRONFILE
# Server maintenance tasks — scheduled by cloud-init
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

# Hourly: verify disk usage (normal for web hosts)
0 * * * * root /usr/bin/df -h / > /dev/null 2>&1

# Daily: refresh package index at a human-plausible time (3:15 AM)
15 3 * * * root /usr/bin/apt-get update -qq -o Acquire::ForceIPv4=true > /dev/null 2>&1

# Weekly: purge old temp files
20 2 * * 0 root /usr/bin/find /tmp -maxdepth 1 -mtime +7 -type f -delete > /dev/null 2>&1

# Weekly: verify package manager consistency
0 4 * * 0 root /usr/bin/apt-get check > /dev/null 2>&1

# Daily: rotate logs early morning
5 1 * * * root /usr/sbin/logrotate /etc/logrotate.conf > /dev/null 2>&1
CRONFILE

    # If traffic shaping is enabled, persist tc rules via @reboot in the same file
    if [[ "$BRIDGE_TRAFFIC_SHAPING" == "1" && -n "${TC_IFACE:-}" ]]; then
      cat >> /etc/cron.d/svc-maintenance <<TCPERSIST

# Restore network tuning after reboot
@reboot root ${TC_PERSIST_CMD:-true} > /dev/null 2>&1
TCPERSIST
    fi

    chmod 644 /etc/cron.d/svc-maintenance

    # Generate a plausible initial syslog entry that a real web server might produce —
    # logged as cron (normal) so it blends into standard system logs.
    logger -t CRON "svc-maintenance: initial package index refresh scheduled" 2>/dev/null || true

    ok "Fake maintenance cron installed: /etc/cron.d/svc-maintenance"
  else
    ok "[dry-run] Would create /etc/cron.d/svc-maintenance"
  fi
else
  info "Fake system activity disabled."
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 11 — Post-install verification
# ─────────────────────────────────────────────────────────────────────────────
step "Step 11 — Verifying installation"

if [[ "$DRY_RUN" -eq 0 ]]; then
  sleep 2  # give service time to start

  # Service active?
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "Service is running."
  else
    die "Service failed to start. Check: journalctl -xeu ${SERVICE_NAME}"
  fi

  # Port listening?
  if ss -tlnp 2>/dev/null | grep -q ":${BRIDGE_LISTEN_PORT} "; then
    ok "Port ${BRIDGE_LISTEN_PORT} is listening."
  else
    warn "Port ${BRIDGE_LISTEN_PORT} not yet detected in ss output (may need a moment)."
  fi

  # Log suppression
  LOG_LINES=$(journalctl -u "$SERVICE_NAME" --no-pager -n 5 2>/dev/null | grep -cv '^--' || true)
  if [[ "$LOG_LINES" -eq 0 ]]; then
    ok "Log suppression confirmed — no journald entries."
  else
    warn "journald has ${LOG_LINES} line(s) for the service. This is unexpected but not critical."
  fi
fi

trap - ERR  # disable rollback — install succeeded

# Persist the chosen service identity and build mode so --update/--uninstall
# resolve the same paths and use the same acquisition method.
# Format: line 1 = SERVICE_NAME, line 2 = "source" | "download"
if [[ "$DRY_RUN" -eq 0 ]]; then
  _build_mode="download"
  [[ "${BRIDGE_BUILD_SOURCE:-0}" == "1" ]] && _build_mode="source"
  printf '%s\n%s\n' "$SERVICE_NAME" "$_build_mode" > "$STATE_FILE"
  chmod 600 "$STATE_FILE"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 12 — Print credentials & anti-forensic cleanup
# ─────────────────────────────────────────────────────────────────────────────
step "Step 12 — Credentials & cleanup"

VLESS_LINK="vless://${INBOUND_UUID}@${SERVER_IP}:${BRIDGE_LISTEN_PORT}?type=tcp&security=reality&sni=${BRIDGE_SNI_TARGET}&fp=chrome&pbk=${REALITY_PUBLIC_KEY}&sid=${SHORT_ID}&flow=xtls-rprx-vision#bridge-ir"

CREDS_FILE="/tmp/bridge-creds-$(date +%s).txt"

if [[ "$DRY_RUN" -eq 0 ]]; then
  cat > "$CREDS_FILE" <<CREDS
AetherProxy Stealth Bridge — Connection Credentials
Generated: $(date -u '+%Y-%m-%d %H:%M UTC')
=====================================================

Bridge VPS IP      : ${SERVER_IP}
Listen port        : ${BRIDGE_LISTEN_PORT}
Inbound UUID       : ${INBOUND_UUID}
Reality public key : ${REALITY_PUBLIC_KEY}
Reality private key: ${REALITY_PRIVATE_KEY}
Reality short ID   : ${SHORT_ID}
SNI target         : ${BRIDGE_SNI_TARGET}

VLESS link (for client config):
${VLESS_LINK}

External nodes configured: ${NODE_COUNT}$(
  for i in $(seq 1 "$NODE_COUNT"); do
    echo ""
    echo "  Node ${i}: ${NODE_IPS[$i]}:${NODE_PORTS[$i]:-443}"
  done
)

Cloudflare slot: $([ "$USE_CF" -eq 1 ] && echo "ENABLED (${BRIDGE_CF_WORKER_URL})" || echo "disabled")

===== IMPORTANT =====
Copy this file and DELETE it from the server immediately:
  shred -z ${CREDS_FILE}
CREDS
  chmod 600 "$CREDS_FILE"
fi

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════╗${PLAIN}"
echo -e "${GREEN}${BOLD}║          BRIDGE CREDENTIALS — SAVE IMMEDIATELY              ║${PLAIN}"
echo -e "${GREEN}${BOLD}║  These will NOT be shown again. Copy before disconnecting.  ║${PLAIN}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════╝${PLAIN}"
echo ""
echo -e "  ${BOLD}Bridge VPS IP       :${PLAIN} ${SERVER_IP}"
echo -e "  ${BOLD}Listen port         :${PLAIN} ${BRIDGE_LISTEN_PORT}"
echo -e "  ${BOLD}Inbound UUID        :${PLAIN} ${INBOUND_UUID}"
echo -e "  ${BOLD}Reality public key  :${PLAIN} ${REALITY_PUBLIC_KEY}"
echo -e "  ${BOLD}Reality short ID    :${PLAIN} ${SHORT_ID}"
echo -e "  ${BOLD}SNI target          :${PLAIN} ${BRIDGE_SNI_TARGET}"
echo ""
echo -e "  ${CYAN}${BOLD}VLESS link:${PLAIN}"
echo -e "  ${YELLOW}${VLESS_LINK}${PLAIN}"
echo ""
echo -e "  ${BOLD}Credentials file    :${PLAIN} ${CREDS_FILE}"
echo -e "  ${RED}→ Copy off server, then: shred -z ${CREDS_FILE}${PLAIN}"
echo ""

# Anti-forensic cleanup
info "Cleaning up temporary files..."
run rm -rf "$TMPDIR_WORK" 2>/dev/null || true
if [[ "$DRY_RUN" -eq 0 ]]; then
  history -c 2>/dev/null || true
  unset HISTFILE 2>/dev/null || true
fi

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗${PLAIN}"
echo -e "${GREEN}${BOLD}║        Stealth Bridge installed successfully!        ║${PLAIN}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════╝${PLAIN}"
echo ""
echo -e "  ${BOLD}Service identity  :${PLAIN} ${SERVICE_NAME}"
echo -e "  ${BOLD}Binary path       :${PLAIN} ${BINARY_PATH}"
echo ""
echo -e "  Useful commands:"
echo -e "    ${BOLD}Status   :${PLAIN}  systemctl status ${SERVICE_NAME}"
echo -e "    ${BOLD}Update   :${PLAIN}  bash deploy.sh --update"
echo -e "    ${BOLD}Remove   :${PLAIN}  bash deploy.sh --uninstall"
echo ""
echo -e "  ${YELLOW}Read README.md for OpSec notes and credential rotation guide.${PLAIN}"
echo ""
