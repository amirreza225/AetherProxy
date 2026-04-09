/**
 * AetherProxy WebSocket Relay Worker
 *
 * Relays WebSocket connections from the sing-box wscdn plugin to the actual
 * origin proxy server.  The client (sing-box) connects to this Cloudflare
 * Worker over HTTPS/WS; the Worker opens a raw TCP socket to the configured
 * origin and bidirectionally pipes data between the two.
 *
 * This is the server-side counterpart to the wscdn outbound plugin.  The
 * overall architecture is inspired by the meek transport used in Tor:
 *   Client → CF Workers edge (this script) → Origin proxy
 *
 * Requirements:
 *   - Cloudflare Workers Paid plan (for the `connect()` TCP socket API)
 *   - Workers Compatibility flag: nodejs_compat
 *
 * Deployment:
 *   wrangler deploy
 *   wrangler secret put ORIGIN_SERVER   # e.g. "203.0.113.10:443"
 *   wrangler secret put SECRET_HEADER   # optional shared secret
 *   wrangler secret put ALLOWED_ORIGINS # optional comma-separated allowlist
 *
 * Security notes:
 *   - Set ALLOWED_ORIGINS to your own origin IPs/hostnames to prevent open-relay abuse.
 *   - Use SECRET_HEADER to require a shared secret in X-Relay-Secret request header.
 *   - Without both of these, anyone who discovers the Worker URL can relay through it.
 */

export default {
  async fetch(request, env) {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response(
        "AetherProxy WS Relay — WebSocket upgrade required",
        { status: 426, headers: { "Upgrade": "websocket" } }
      );
    }

    // Optional shared-secret validation.
    if (env.SECRET_HEADER) {
      const provided = request.headers.get("X-Relay-Secret");
      if (provided !== env.SECRET_HEADER) {
        return new Response("Forbidden", { status: 403 });
      }
    }

    // Resolve origin: per-request header takes precedence over env var.
    const originServer =
      request.headers.get("X-Origin-Server") || env.ORIGIN_SERVER || "";
    if (!originServer) {
      return new Response(
        "No origin server configured. Set ORIGIN_SERVER via wrangler secret.",
        { status: 502 }
      );
    }

    // Validate against allowlist when configured.
    if (env.ALLOWED_ORIGINS) {
      const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
      const [originHost] = originServer.split(":");
      if (!allowed.includes(originHost)) {
        return new Response("Origin not in allowlist", { status: 403 });
      }
    }

    // Parse host and port.
    const lastColon = originServer.lastIndexOf(":");
    const originHost =
      lastColon !== -1 ? originServer.slice(0, lastColon) : originServer;
    const originPort =
      lastColon !== -1 ? parseInt(originServer.slice(lastColon + 1), 10) : 443;

    if (!originHost || isNaN(originPort) || originPort < 1 || originPort > 65535) {
      return new Response("Invalid origin server format (expected host:port)", {
        status: 502,
      });
    }

    // Upgrade the incoming client connection to WebSocket.
    const { 0: clientSocket, 1: serverSocket } = new WebSocketPair();
    serverSocket.accept();

    // Open a TCP socket to the origin proxy using the CF Workers connect() API.
    // This API is available on the Workers Paid plan with nodejs_compat flag.
    let tcpSocket;
    try {
      tcpSocket = connect({ hostname: originHost, port: originPort });
    } catch (err) {
      serverSocket.close(1011, "Failed to connect to origin");
      return new Response("Failed to connect to origin: " + err.message, {
        status: 502,
      });
    }

    // Pipe: client WebSocket → origin TCP.
    serverSocket.addEventListener("message", async (event) => {
      try {
        const writer = tcpSocket.writable.getWriter();
        const data =
          typeof event.data === "string"
            ? new TextEncoder().encode(event.data)
            : event.data;
        await writer.write(data);
        writer.releaseLock();
      } catch {
        // Origin closed; let the close handler below clean up.
      }
    });

    // Pipe: origin TCP → client WebSocket.
    (async () => {
      const reader = tcpSocket.readable.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (serverSocket.readyState === WebSocket.OPEN) {
            serverSocket.send(value);
          }
        }
      } catch {
        // Ignore read errors; both sides will close.
      } finally {
        if (serverSocket.readyState === WebSocket.OPEN) {
          serverSocket.close(1000, "Origin closed connection");
        }
      }
    })();

    // Clean up TCP socket when the client disconnects.
    serverSocket.addEventListener("close", () => {
      try { tcpSocket.close(); } catch { /* ignore */ }
    });
    serverSocket.addEventListener("error", () => {
      try { tcpSocket.close(); } catch { /* ignore */ }
    });

    return new Response(null, {
      status: 101,
      webSocket: clientSocket,
    });
  },
};
