import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Stats {
  status: string;
  uptime_seconds: number;
  bytes_up: number;
  bytes_down: number;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

function App() {
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [subUrl, setSubUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const refreshStats = async () => {
      try {
        const s = await invoke<Stats>("get_stats");
        setStats(s);
        setConnected(s.status === "running");
      } catch {
        /* ignore */
      }
    };
    refreshStats();
    const t = setInterval(refreshStats, 3000);

    const unlisten = listen("proxy-toggle", () => handleToggle());

    return () => {
      clearInterval(t);
      unlisten.then((fn) => fn());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  async function handleToggle() {
    setError("");
    try {
      if (connected) {
        await invoke("stop_proxy");
        setConnected(false);
      } else {
        await invoke("start_proxy");
        setConnected(true);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleImport() {
    if (!subUrl.trim()) return;
    try {
      await invoke("import_subscription", { url: subUrl.trim() });
      setSubUrl("");
      alert("Subscription imported successfully.");
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>AetherProxy</h1>

      <div style={styles.statusBadge(connected)}>
        {connected ? "● Connected" : "○ Disconnected"}
      </div>

      <button style={styles.toggleBtn(connected)} onClick={handleToggle}>
        {connected ? "Disconnect" : "Connect"}
      </button>

      {stats && (
        <div style={styles.statsBox}>
          <p>↑ {formatBytes(stats.bytes_up)}</p>
          <p>↓ {formatBytes(stats.bytes_down)}</p>
          <p>Uptime: {stats.uptime_seconds}s</p>
        </div>
      )}

      <div style={styles.importBox}>
        <h2 style={styles.sectionTitle}>Import Subscription</h2>
        <input
          style={styles.input}
          placeholder="Paste subscription URL (aetherproxy://...)"
          value={subUrl}
          onChange={(e) => setSubUrl(e.target.value)}
        />
        <button style={styles.importBtn} onClick={handleImport}>
          Import
        </button>
      </div>

      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

const styles = {
  container: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 500,
    margin: "40px auto",
    padding: "0 20px",
    textAlign: "center" as const,
  },
  title: { fontSize: 28, marginBottom: 24 },
  statusBadge: (connected: boolean) => ({
    display: "inline-block",
    padding: "6px 16px",
    borderRadius: 20,
    background: connected ? "#22c55e" : "#94a3b8",
    color: "#fff",
    fontWeight: 600,
    marginBottom: 20,
  }),
  toggleBtn: (connected: boolean) => ({
    display: "block",
    width: "100%",
    padding: "14px 0",
    borderRadius: 8,
    border: "none",
    background: connected ? "#ef4444" : "#3b82f6",
    color: "#fff",
    fontSize: 18,
    fontWeight: 700,
    cursor: "pointer",
    marginBottom: 24,
  }),
  statsBox: {
    background: "#f1f5f9",
    borderRadius: 8,
    padding: "12px 16px",
    textAlign: "left" as const,
    marginBottom: 24,
    fontSize: 14,
  },
  importBox: {
    textAlign: "left" as const,
    marginTop: 8,
  },
  sectionTitle: { fontSize: 16, marginBottom: 8 },
  input: {
    width: "100%",
    boxSizing: "border-box" as const,
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    fontSize: 14,
    marginBottom: 8,
  },
  importBtn: {
    padding: "10px 24px",
    borderRadius: 6,
    border: "none",
    background: "#6366f1",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
  },
  error: { color: "#ef4444", marginTop: 12 },
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
