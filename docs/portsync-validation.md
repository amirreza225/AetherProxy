# PortSync Manual Validation Runbook

This checklist validates inbound port lifecycle automation end-to-end across bare-metal and Docker deployments.

## Scope

- Local host UFW reconciliation for inbound create/edit/delete
- Remote node UFW reconciliation over SSH with retry queue behavior
- Docker bridge-mode limitation behavior
- Docker host-network mode full host-firewall behavior
- DeployNode post-deploy forced reconcile behavior

## Prerequisites

- Backend reachable and authenticated admin/API access available
- UFW installed on local host and any remote nodes
- UFW enabled on local host and any remote nodes
- At least one inbound type available for create/edit/delete
- For remote tests: one healthy node and one intentionally unreachable node

## Quick Sanity Checks

### Local host

```bash
sudo ufw status numbered
```

Expected:
- `Status: active`

### Remote node

```bash
ssh -i <key> -p <port> <user>@<host> "sudo ufw status numbered"
```

Expected:
- `Status: active`

## Scenario 1: Bare-Metal Local Reconcile

1. Create an inbound listening on port `443` (or another free port).
2. Verify managed UFW rule appears.

```bash
sudo ufw status numbered | grep aetherproxy
```

Expected:
- One or more tagged rules like `# aetherproxy:tcp:443` or `# aetherproxy:udp:443`.

3. Edit inbound port/protocol (for example from `443/tcp` to `8443/tcp` or to UDP-capable protocol).
4. Verify old tagged rules are removed and new tagged rules are present.

```bash
sudo ufw status numbered | grep aetherproxy
```

Expected:
- No stale tagged rule for old port/protocol
- New tagged rule for new desired port/protocol
- Non-tagged/manual rules remain untouched

5. Delete the inbound.
6. Verify related tagged rules are removed.

Expected:
- No remaining `aetherproxy:*:<deleted-port>` rule

## Scenario 2: Remote Convergence With One Offline Node

1. Ensure one node is reachable and one node is unreachable.
2. Create/edit/delete an inbound.
3. Verify API operation succeeds (does not fail due to unreachable node).
4. Check PortSync queue status.

```bash
curl -sS -H "Authorization: Bearer <token>" "https://<api-domain>/api/portsyncStatus?limit=50"
```

Expected:
- Pending task(s) for unreachable node scope=`node`
- Error context present in `lastError`

5. Restore offline node reachability.
6. Trigger immediate retry batch.

```bash
curl -sS -X POST -H "Authorization: Bearer <token>" "https://<api-domain>/api/portsyncRetry" -d "limit=50"
```

7. Re-check queue.

Expected:
- Node task cleared after successful reconcile

## Scenario 3: Docker Bridge Mode (Degraded Local Host Control)

1. Run with bridge compose and local sync disabled (`AETHER_PORT_SYNC_LOCAL_ENABLED=false`).
2. Create/edit/delete inbound.
3. Confirm API operations still succeed.
4. Verify host UFW does not claim full local automation.

Expected:
- Remote sync still functions when enabled
- Local host capability note reflects disabled/degraded local mode in status endpoint/UI

## Scenario 4: Docker Host-Network Mode (Full Local Host Control)

1. Enable host-network mode:
- `AETHER_DOCKER_HOSTNET=1`
- `AETHER_PORT_SYNC_LOCAL_ENABLED=true`
2. Start using hostnet compose file.
3. Create/edit/delete inbound.
4. Verify host UFW tagged rule lifecycle as in Scenario 1.

Expected:
- Tagged host UFW rules added/updated/removed correctly

## Scenario 5: DeployNode Forced Reconcile

1. Add/verify a node and confirm it is reachable.
2. Run DeployNode.
3. Confirm PortSync node reconcile is triggered for that node.

```bash
curl -sS -X POST -H "Authorization: Bearer <token>" "https://<api-domain>/api/deployNode" -d "id=<node-id>"
```

Optional check:

```bash
curl -sS -H "Authorization: Bearer <token>" "https://<api-domain>/api/portsyncStatus?limit=50"
```

Expected:
- Node state converges to desired firewall rules after deploy
- No persistent pending task for healthy/reachable node

## Pass Criteria

- Local inbound lifecycle consistently reconciles only `aetherproxy`-tagged rules
- Remote failures do not block CRUD and are retried successfully later
- Bridge mode behavior is explicitly degraded for local host firewall automation
- Host-network mode provides full local host firewall lifecycle management
- DeployNode drives immediate node firewall convergence
