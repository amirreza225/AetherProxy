# AetherProxy Stealth Bridge

A hardened, standalone deployment script for a relay node running inside Iran.
The bridge accepts VLESS+Reality inbound traffic and fans outbound traffic across
multiple external AetherProxy nodes so no single destination dominates.

> Reality check: there is no such thing as a 100% undetectable proxy.
> This bridge is designed to reduce common detection vectors, not to guarantee invisibility.

The installer script is self-contained: copy `deploy.sh` to the VPS and run it.

---

## Architecture

```text
Client
  -> TCP 443 on VPS (nginx stream, ssl_preread)
      -> SNI == BRIDGE_SNI_TARGET         -> sing-box Reality backend (127.0.0.1:2443)
      -> SNI missing/non-matching/random  -> blind TCP fallback (BRIDGE_DECOY_UPSTREAM)

VPS outbound (sing-box urltest)
  -> Node A
  -> Node B
  -> Node C (optional)
  -> Cloudflare Worker slot (optional)

TCP 80 on VPS
  -> nginx generic HTTP decoy (returns 400)
```

Key point: unauthorized TLS traffic is not terminated locally with a fake certificate.
It is blindly proxied to a real upstream to avoid self-signed/localhost certificate fingerprints.

---

## What This Script Mitigates Well

- Static signature detection (known binary/service/config path fingerprints)
- Basic active probing (connect-and-inspect behavior on 443)
- Single-destination outbound concentration

---

## Requirements

| Requirement | Detail |
|-------------|--------|
| OS | Ubuntu 22.04 LTS or 24.04 LTS |
| Architecture | amd64 or arm64 |
| RAM | 512 MB minimum (1 GB recommended) |
| Root | Script must run as root |
| Free ports | 80 and your chosen BRIDGE_LISTEN_PORT |
| External nodes | 2+ recommended for traffic rotation |

---

## Quick Start

```bash
# Copy installer
scp deploy.sh root@<vps-ip>:/root/

# On VPS (optional but recommended)
unset HISTFILE

# Interactive install
bash deploy.sh
```

### Non-interactive Example

```bash
export BRIDGE_NODE_COUNT=2
export BRIDGE_NODE_1_IP=203.0.113.10
export BRIDGE_NODE_1_PORT=443
export BRIDGE_NODE_1_UUID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export BRIDGE_NODE_1_PUBKEY=<base64-reality-pubkey>
export BRIDGE_NODE_1_SHORT_ID=ab12cd34
export BRIDGE_NODE_1_SNI=example.com

export BRIDGE_NODE_2_IP=198.51.100.20
export BRIDGE_NODE_2_PORT=443
export BRIDGE_NODE_2_UUID=yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy
export BRIDGE_NODE_2_PUBKEY=<base64-reality-pubkey>
export BRIDGE_NODE_2_SHORT_ID=ef56aa90
export BRIDGE_NODE_2_SNI=example.org

export BRIDGE_LISTEN_PORT=443
export BRIDGE_SNI_TARGET=www.example-cdn-host.com
export BRIDGE_DECOY_UPSTREAM=www.microsoft.com:443

# Optional
# export BRIDGE_CF_WORKER_URL=https://your-relay.workers.dev
# export BRIDGE_CF_UUID=<uuid-of-cf-backend-node>
# export BRIDGE_URLTEST_URL=https://www.gstatic.com/generate_204
# export BRIDGE_URLTEST_INTERVAL=11m

bash deploy.sh --yes --non-interactive
```

---

## Installed Components

Service identity is randomized and persisted in `/usr/lib/systemd/.nd`.

| Component | Path Pattern | Notes |
|-----------|--------------|-------|
| sing-box binary | `/usr/lib/systemd/<service_name>` | Disguised as system helper |
| systemd unit | `/etc/systemd/system/<service_name>.service` | Description: Network Link State Monitor |
| system user | `_netd` | No shell, no home |
| runtime config dir | `/var/lib/<service_name>/` | Permissions: `0750 root:_netd` |
| runtime config | `/var/lib/<service_name>/runtime.conf` | Permissions: `0640 root:_netd` |
| nginx HTTP decoy | `/etc/nginx/sites-available/decoy` | Generic 400 on port 80 |
| nginx stream router | `/etc/nginx/stream-enabled/stealth-bridge.conf` | 443 SNI routing + blind fallback |

---

## Advanced Detection Reality

Sophisticated state-level censors can still use multi-layer heuristics.

### 1. SNI-to-IP Mismatch (metadata analysis)

How detection happens:
- The client sends SNI like `www.cloudflare.com` or `microsoft.com`, but the destination IP ASN belongs to a budget VPS provider.
- That SNI/ASN mismatch is a strong signal.

Mitigation:
- Prefer plausible `BRIDGE_SNI_TARGET` values that could reasonably live behind your VPS provider/region.
- Use Cloudflare Worker slot where possible so some traffic naturally blends into Cloudflare IP ranges.

### 2. Traffic-flow fingerprinting (timing and packet-size ML)

How detection happens:
- Payload is encrypted, but packet timing/size sequences can still classify proxy tunnels.

Mitigation:
- Keep `xtls-rprx-vision` (already used).
- Keep multiplex padding enabled in client profiles.
- Use optional `BRIDGE_TRAFFIC_SHAPING=1` to inject jitter and reduce strict timing regularity.

### 3. Active probing latency trap

How detection happens:
- Prober sends junk/missing SNI.
- Your server forwards to fallback upstream and returns response.
- Added RTT from extra hop can reveal transparent proxy behavior if fallback is far away.

Mitigation:
- Set `BRIDGE_DECOY_UPSTREAM` to a high-reputation host geographically close to your VPS.
- Keep RTT delta as small as possible.

### 4. Client-side TLS fingerprinting (JA3/JA4)

How detection happens:
- Censor classifies ClientHello signatures from client apps.
- Non-browser TLS signatures are easy to flag.

Mitigation:
- Ensure clients use uTLS and browser-like fingerprints matching your profile (for example Chrome/Firefox).
- Keep client and server fingerprint strategy consistent.

---

## SNI and Fallback Selection Guide

### BRIDGE_SNI_TARGET

- Must support TLS 1.3 and ALPN h2.
- Should be plausible for your VPS geography/provider.
- Avoid hardcoding the same globally popular value on every deployment.

### BRIDGE_DECOY_UPSTREAM

- Format: `host:port` (example: `www.microsoft.com:443`).
- Must be external (not localhost).
- Prefer reputable hosts with low-latency path from your VPS.

---

## Verification Checklist

```bash
# Resolve randomized service name
SERVICE_NAME="$(sed -n '1p' /usr/lib/systemd/.nd)"

# Service state
systemctl is-active "$SERVICE_NAME"

# Public listener
ss -tlnp | grep :443

# HTTP decoy behavior
curl -i http://<vps-ip>
# Expect: 400 Bad Request

# Matching SNI path (Reality backend)
openssl s_client -connect <vps-ip>:443 -servername <BRIDGE_SNI_TARGET> </dev/null

# Non-matching SNI path (blind fallback)
openssl s_client -connect <vps-ip>:443 -servername not-real.example </dev/null
# Expect: valid external cert chain from fallback path, not localhost self-signed cert

# Confirm no standard proxy config path
ls /etc/sing-box/ 2>&1

# Outbound diversity during real traffic
ss -tnp | grep _netd
```

---

## Managing the Bridge

```bash
SERVICE_NAME="$(sed -n '1p' /usr/lib/systemd/.nd)"

systemctl status "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# Binary refresh only
bash deploy.sh --update

# Full uninstall
bash deploy.sh --uninstall

# Preview actions
bash deploy.sh --dry-run
```

---

## OpSec Notes

### Before install

- Use a fresh VPS where possible.
- Avoid reusing the same SNI/fallback pair across many nodes.
- Disable shell history for installation session (`unset HISTFILE`).

### After install

- Save credentials immediately from `/tmp/bridge-creds-<timestamp>.txt`.
- Remove credential file from server after copy:

```bash
shred -z /tmp/bridge-creds-*.txt
```

### Rotation

- Credentials: rotate every 30 to 90 days with fresh reinstall.
- Worker URL/fallback target: rotate periodically.
- Binary updates: `bash deploy.sh --update`.

### Bandwidth and cadence

- Keep usage patterns reasonable for the server profile.
- urltest defaults are randomized (URL and interval) unless explicitly overridden.

---

## Threat Model Snapshot

| Detection Method | Current Mitigation | Residual Risk |
|------------------|--------------------|---------------|
| Static signatures | Disguised service/binary paths, stripped builds | Advanced forensic baselining |
| Active probing | 443 SNI routing + blind TCP fallback | RTT correlation if fallback is far away |
| Outbound concentration | Multiple nodes + optional CF slot + urltest | Poor node diversity still fingerprintable |
| TLS fingerprinting | uTLS/browser-like strategy support | Client misconfiguration remains common |
| Traffic-shape ML | xtls-rprx-vision + optional jitter shaping | High-confidence ML at scale can still detect anomalies |

---

## Changelog

| Version | Notes |
|---------|-------|
| 1.0.0 | Initial bridge README updated for stream-based blind fallback, realistic detection limits, and advanced OPSEC guidance |
