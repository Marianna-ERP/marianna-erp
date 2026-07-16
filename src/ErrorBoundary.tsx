import React from "react";
import { exportAllData } from "./useLocalStoredState";
import { APP_VERSION } from "./version";

// Catches render-time errors anywhere below it and shows a reassuring recovery
// screen instead of a blank page. Crucially it tells the user their data is
// still safe in this browser (it's in localStorage, untouched by a render crash)
// and lets them download a backup before reloading.
interface State { error: Error | null; }

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error("[ErrorBoundary] Render error:", error, info);
  }

  downloadBackup = () => {
    try {
      const json = exportAllData();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.download = `marianna-erp_recovery_${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      window.alert("Could not create a backup automatically: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#FAFAFA", padding: 24, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <div style={{ maxWidth: 520, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 28, boxShadow: "0 10px 40px rgba(0,0,0,0.08)" }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#111", marginBottom: 8 }}>Something went wrong on screen</div>
          <div style={{ fontSize: 13.5, color: "#444", lineHeight: 1.6, marginBottom: 6 }}>
            This is a display error, not data loss. <strong>Your data is safe</strong> — it's stored in this browser and a screen crash doesn't touch it.
          </div>
          <div style={{ fontSize: 13.5, color: "#444", lineHeight: 1.6, marginBottom: 16 }}>
            Download a backup just to be safe, then reload. If it keeps happening, send the backup file and the message below.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <button onClick={this.downloadBackup} style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: "#16A34A", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>⤓ Download backup</button>
            <button onClick={() => window.location.reload()} style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #D1D5DB", background: "#fff", color: "#111", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>↻ Reload app</button>
          </div>
          <details style={{ fontSize: 12, color: "#777" }}>
            <summary style={{ cursor: "pointer" }}>Technical details (v{APP_VERSION})</summary>
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 8, background: "#F9FAFB", border: "1px solid #F3F4F6", borderRadius: 8, padding: 10, maxHeight: 200, overflow: "auto" }}>{String(this.state.error?.stack || this.state.error?.message || this.state.error)}</pre>
          </details>
        </div>
      </div>
    );
  }
}
