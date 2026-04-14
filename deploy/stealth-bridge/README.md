# AetherProxy Stealth Bridge

A hardened, standalone deployment script for a **relay node running inside Iran**. The bridge
receives VLESS+Reality connections from clients and fans traffic out across multiple external
AetherProxy nodes, so no single foreign IP dominates the outbound pattern.

> **Self-contained** — `deploy.sh` requires no external template files. Copy the single script
> to the VPS over SSH and run it.

---

## Architecture

```
Client (inside Iran)
        │  VLESS+Reality on port 443
        │  (appears as HTTPS to e.g. microsoft.com)
        ▼
 Iranian VPS Bridge  ──urltest──▶  Node A  (external AetherProxy)
  [systemd-netlink]              ├──▶  Node B  (external AetherProxy)
  disguised as systemd           ├──▶  Node C  (external AetherProxy)
  daemon, port 443               └──▶  Node CF (Cloudflare Worker relay)
```

Non-proxy connections to port 443 are transparently proxied to the SNI target
(e.g. microsoft.com) — `curl https://<vps-ip>` returns the real Microsoft page.

---

## Requirements

| Requirement | Detail |
|-------------|--------|
| OS | Ubuntu 22.04 LTS or 24.04 LTS |
| Architecture | amd64 or arm64 |
| RAM | 512 MB minimum (1 GB recommended) |
| Ports | 80 and 443 must be free before install |
| Root | Script must run as root |
| External nodes | 2+ recommended for traffic rotation |

---

## Quick Start

```bash
# Transfer script to VPS (from your machine)
scp deploy.sh root@<vps-ip>:/root/

# On the VPS — prepend this to disable history before running
unset HISTFILE

# Run installer
bash deploy.sh
```

### Non-interactive (automation/CI)

```bash
export BRIDGE_NODE_COUNT=2
export BRIDGE_NODE_1_IP=203.0.113.10
export BRIDGE_NODE_1_PORT=443
export BRIDGE_NODE_1_UUID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export BRIDGE_NODE_1_PUBKEY=<base64-reality-pubkey>
export BRIDGE_NODE_1_SHORT_ID=ab12cd34
export BRIDGE_NODE_1_SNI=microsoft.com
export BRIDGE_NODE_2_IP=198.51.100.20
# ... (repeat for node 2)
export BRIDGE_SNI_TARGET=microsoft.com
export BRIDGE_LISTEN_PORT=443

# Optional Cloudflare fronting slot
# export BRIDGE_CF_WORKER_URL=https://your-relay.workers.dev
# export BRIDGE_CF_UUID=<uuid-of-cf-backend-node>

bash deploy.sh --yes --non-interactive
```

---

## What Gets Installed

| Component | Location | Notes |
|-----------|----------|-------|
| sing-box binary | `/usr/lib/systemd/systemd-netlink` | Disguised as systemd helper |
| systemd service | `systemd-netlink.service` | Description: "Network Link State Monitor" |
| System user | `_netd` | No shell, no home directory |
| Config directory | `/var/lib/systemd-netlink/` | Permissions: `0750 root:_netd` |
| sing-box config | `/var/lib/systemd-netlink/runtime.conf` | Permissions: `0640 root:_netd` |
| nginx decoy | `/var/www/decoy/` | Persian tech blog served on port 80 |
| nginx vhost | `/etc/nginx/sites-available/decoy` | `server_tokens off`; no access logs |
| Firewall | ufw rules (or iptables) | Allows: 22, 80, 443/tcp |

---

## Stealth Layers

### 1. Disguised process
`ps aux` shows `systemd-netlink run -c /var/lib/systemd-netlink/runtime.conf`.
`systemctl list-units` shows `systemd-netlink.service` — indistinguishable from real
systemd daemons (`systemd-networkd`, `systemd-resolved`, `systemd-timesyncd`).

### 2. Hidden config path
Config lives in `/var/lib/systemd-netlink/` — the standard state directory pattern for
system daemons. No files in `/etc/sing-box/` or any known proxy config path.

### 3. Decoy web server
nginx serves a minimal Persian tech blog on port 80. Port 443 is owned by sing-box;
Reality transparently proxies non-proxy visitors to the SNI target site.

### 4. Zero logging
- sing-box log level: `error`, output: `/dev/null`
- systemd unit: `StandardOutput=null StandardError=null`
- `journalctl -u systemd-netlink` shows no entries
- nginx access log disabled; error log level `crit` only

### 5. Traffic rotation
sing-box `urltest` group health-checks all external nodes every 2 minutes and fans
traffic across whichever nodes are healthy. Adding a Cloudflare Worker slot means some
outbound traffic goes to Cloudflare IP ranges — indistinguishable from CDN usage.

### 6. Systemd hardening
Full sandboxing: `NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`,
`PrivateDevices`, `CapabilityBoundingSet=CAP_NET_BIND_SERVICE`,
`RestrictAddressFamilies=AF_INET AF_INET6`, `SystemCallFilter=@system-service`.
The service runs as the unprivileged `_netd` user with only the capability to bind
ports below 1024 (`AmbientCapabilities=CAP_NET_BIND_SERVICE`).

---

## Verification Checklist

Run these after install to confirm everything is working:

```bash
# Service is active
systemctl is-active systemd-netlink

# Port is listening (shows _netd process)
ss -tlnp | grep :443

# No proxy binary names visible
ps aux | grep -E 'sing-box|xray|v2ray'
# ↑ Should return empty

# No journald output (log suppression working)
journalctl -u systemd-netlink --no-pager -n 20
# ↑ Should show no log lines

# Decoy site responds
curl -s http://<vps-ip> | grep -i "فنی"

# Reality pass-through (returns microsoft.com content)
curl -sk https://<vps-ip> | grep -i microsoft

# Config not in /etc
ls /etc/sing-box/ 2>&1
# ↑ "No such file or directory"

# Config dir permissions
ls -la /var/lib/systemd-netlink/
# ↑ drwxr-x--- root:_netd

# Traffic rotation (during active use)
ss -tnp | grep _netd
# ↑ Should show connections to multiple distinct foreign IPs
```

---

## Managing the Bridge

```bash
# View service status
systemctl status systemd-netlink

# Restart service
systemctl restart systemd-netlink

# Update sing-box binary (keeps config)
bash deploy.sh --update

# Full removal
bash deploy.sh --uninstall

# Dry-run (see what would happen)
bash deploy.sh --dry-run
```

---

## Reality SNI Target Selection

The SNI target must support **TLS 1.3** and **ALPN h2**.

| Target | Notes |
|--------|-------|
| `microsoft.com` | **Default.** Extremely high global traffic, very hard to block |
| `www.apple.com` | Same properties, good alternative |
| `dl.google.com` | Google download server — high legitimate traffic |
| `www.samsung.com` | Alternative for diversity |

**Avoid:** `cloudflare.com` (recognizable as proxy-adjacent), any domain blocked in Iran.

---

## OpSec Notes

### Before installing

- Use a **fresh VPS** with no prior proxy tool footprint.
- Run `unset HISTFILE` in your SSH session **before** running the installer.
- Transfer the script over SCP, not via a public URL or pastebin.
- **Do not** install the AetherProxy admin panel on the same VPS.
- Verify your SSH key is the only authorized access method — disable password auth.

### After installing

- **Save the credentials immediately.** The install script writes them to
  `/tmp/bridge-creds-<timestamp>.txt`. Copy the file off the server, then:
  ```bash
  shred -z /tmp/bridge-creds-*.txt
  ```
- The install script itself can be deleted after a successful run:
  ```bash
  shred -z deploy.sh
  ```

### Credential rotation (every 30–90 days)

Rotating credentials requires a fresh install:
```bash
bash deploy.sh --uninstall
bash deploy.sh
```
Update all client configs with the new UUID, public key, and short_id immediately.

For binary-only updates (no credential change):
```bash
bash deploy.sh --update
```

### Bandwidth discipline

- Keep monthly outbound usage below ~800 GB to avoid anomaly flags.
- The `urltest` health checks (2-minute intervals, tiny Cloudflare probe) are negligible.
- If bandwidth spikes, the Cloudflare Worker slot absorbs peak traffic through CF IPs.

### Cloudflare fronting slot (optional)

The CF Worker slot uses the existing `deploy/cloudflare-worker/ws-relay-worker.js` from
the AetherProxy repo. Deploy it to Cloudflare Workers, then:

```bash
wrangler secret put ORIGIN_SERVER   # "your-external-node-ip:port"
wrangler secret put SECRET_HEADER   # random shared secret
```

Rotate the Worker URL every 60–90 days.

### Emergency procedures

**Immediate disable without trace:**
```bash
systemctl stop systemd-netlink
shred -z /var/lib/systemd-netlink/runtime.conf /var/lib/systemd-netlink/server.key
```

**Full removal:**
```bash
bash deploy.sh --uninstall
```

---

## Threat Model Summary

| Threat | Mitigation |
|--------|-----------|
| DPI detecting proxy protocol signatures | VLESS+Reality is TLS 1.3 to a real SNI target — indistinguishable from HTTPS |
| Single foreign IP in outbound traffic | `urltest` rotates across 2–5 nodes + optional Cloudflare IP slot |
| Known binary/service names in process list | Binary renamed; service name mimics systemd daemon |
| Config files in canonical proxy paths | Config in `/var/lib/systemd-netlink/` — no `/etc/sing-box/` |
| No real web service on 443 | Reality transparently proxies non-proxy visitors to SNI target |
| Log analysis showing proxy activity | All sing-box output goes to `/dev/null`; journald suppressed |
| Port scan revealing proxy | Port 443 shows as generic TLS; port 80 shows as nginx HTTP |

---

## Changelog

| Version | Notes |
|---------|-------|
| 1.0.0 | Initial release — sing-box 1.13.4, Ubuntu 22.04/24.04 |
