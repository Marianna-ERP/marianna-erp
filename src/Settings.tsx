import React, { useRef, useState } from "react";
import { exportAllData, importAllData, clearAllData, STORAGE_VERSION } from "./useLocalStoredState";

// ─── SETTINGS MODULE ────────────────────────────────────────────────────────
// Purpose: give testers tools to manage their local data — export it for
// sharing with the team, import a colleague's snapshot, or reset to demo.
//
// This is intentionally minimal. The "Storage Settings" panel becomes the
// place to add user-facing administration features as we grow (Phase 2:
// language, currency display preferences, notification settings, etc.)

function Card({ children, style }: any) {
  return <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "20px 22px", ...style }}>{children}</div>;
}

function SectionTitle({ children }: any) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em", marginBottom: 14 }}>{children}</div>;
}

function Button({ onClick, children, variant = "default", disabled = false, style }: any) {
  const variants: any = {
    default:  { bg: "#fff",    color: "#111",     border: "#E5E7EB" },
    primary:  { bg: "#111",    color: "#fff",     border: "#111" },
    danger:   { bg: "#fff",    color: "#DC2626",  border: "#FECACA" },
    success:  { bg: "#16A34A", color: "#fff",     border: "#16A34A" },
  };
  const v = variants[variant] || variants.default;
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: "8px 16px", borderRadius: 7, border: `1px solid ${v.border}`,
      background: disabled ? "#F3F4F6" : v.bg,
      color: disabled ? "#9CA3AF" : v.color,
      fontSize: 13, fontWeight: 600,
      cursor: disabled ? "not-allowed" : "pointer",
      fontFamily: "inherit",
      ...style,
    }}>{children}</button>
  );
}

export default function Settings({
  reloadFromStorage,
  userRole,
  setUserRole,
  userName,
  setUserName,
}: {
  reloadFromStorage: () => void;
  userRole?: string;
  setUserRole?: (r: string) => void;
  userName?: string;
  setUserName?: (n: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ kind: "info" | "success" | "error"; text: string } | null>(null);

  function handleExport() {
    try {
      const json = exportAllData();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.download = `marianna-erp-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMessage({ kind: "success", text: "Export downloaded. Send this file to a colleague to share your test data." });
    } catch (err) {
      setMessage({ kind: "error", text: "Export failed: " + (err instanceof Error ? err.message : String(err)) });
    }
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  function handleFileSelected(e: any) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        setMessage({ kind: "error", text: "Could not read file as text." });
        return;
      }
      const outcome = importAllData(result);
      if (!outcome.ok) {
        setMessage({ kind: "error", text: outcome.error || "Import failed." });
        return;
      }
      const loadedDesc = (outcome.loaded || []).join(", ") || "no recognized data";
      setMessage({ kind: "success", text: `Imported: ${loadedDesc}. Reloading page to refresh state...` });
      // Reload after a short delay so the user sees the message
      setTimeout(() => {
        // Force a page reload so all modules pick up the new localStorage values
        window.location.reload();
      }, 1200);
    };
    reader.onerror = () => setMessage({ kind: "error", text: "Could not read the file." });
    reader.readAsText(file);
    // Reset the input so selecting the same file twice still fires onChange
    e.target.value = "";
  }

  function handleReset() {
    const confirmed = window.confirm(
      "Start fresh — clear ALL your data?\n\n" +
      "This wipes contacts, POs, lots, sales orders, shipments, and operational costs, " +
      "returning the system to a completely empty state. Anything you've entered will be lost. " +
      "This cannot be undone — export a backup first if you want to keep it."
    );
    if (!confirmed) return;
    clearAllData();
    setMessage({ kind: "info", text: "All data cleared. Reloading to an empty system..." });
    setTimeout(() => window.location.reload(), 800);
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "24px 28px", background: "#FAFAFA" }}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#111", letterSpacing: "-0.3px" }}>Settings</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
            Manage the local-only data stored in your browser. Storage schema: v{STORAGE_VERSION}.
          </div>
        </div>

        {message && (
          <div style={{
            marginBottom: 16, padding: "12px 16px", borderRadius: 8,
            background: message.kind === "success" ? "#ECFDF5" : message.kind === "error" ? "#FEE2E2" : "#EFF6FF",
            border: `1px solid ${message.kind === "success" ? "#A7F3D0" : message.kind === "error" ? "#FCA5A5" : "#BFDBFE"}`,
            color: message.kind === "success" ? "#065F46" : message.kind === "error" ? "#991B1B" : "#1E40AF",
            fontSize: 13,
          }}>
            {message.text}
          </div>
        )}

        <Card style={{ marginBottom: 16 }}>
          <SectionTitle>CURRENT USER &amp; ROLE</SectionTitle>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
            Your role controls who can see Sales Order profitability (P/L). Assistant and Operations don't see P/L at all; Sales sees P/L only for orders they created; Financial Director and General Manager see all P/L. (No login yet — this is a simple switch for testing.)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>Role</label>
              <select
                value={userRole || "General Manager"}
                onChange={e => setUserRole && setUserRole(e.target.value)}
                style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, background: "#fff" }}
              >
                {["Assistant", "Operations", "Sales", "Financial Director", "General Manager"].map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>Your name (used to tag SOs you create)</label>
              <input
                value={userName || ""}
                onChange={e => setUserName && setUserName(e.target.value)}
                placeholder="e.g. Anna (sales)"
                style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, background: "#fff" }}
              />
            </div>
          </div>
        </Card>

        <Card style={{ marginBottom: 16 }}>
          <SectionTitle>EXPORT</SectionTitle>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
            Download a JSON file containing all your contacts, POs, lots, sales orders, shipments, and operational costs. Share this with a colleague so they can see exactly what you see, or send it to Hazem as feedback.
          </div>
          <Button onClick={handleExport} variant="primary">📥 Export all data as JSON</Button>
        </Card>

        <Card style={{ marginBottom: 16 }}>
          <SectionTitle>IMPORT</SectionTitle>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
            Load a colleague's exported JSON file. <strong>This replaces your current data</strong> — export first if you want to keep what you have.
          </div>
          <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={handleFileSelected} style={{ display: "none" }} />
          <Button onClick={handleImportClick}>📤 Choose JSON file to import...</Button>
        </Card>

        <Card style={{ marginBottom: 16, borderLeft: "3px solid #DC2626" }}>
          <SectionTitle>RESET</SectionTitle>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
            Erase everything you've entered and reload the original demo data. Use this if you've made test data unusable and want to start fresh.
          </div>
          <Button onClick={handleReset} variant="danger">⚠ Reset to demo data</Button>
        </Card>

        <div style={{ marginTop: 24, padding: "14px 16px", background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 8, fontSize: 12, color: "#92400E", lineHeight: 1.5 }}>
          <strong>About local storage:</strong> Data lives in your browser only. Different browsers, devices, or private windows have separate copies. Clearing your browser data will wipe MARIANNA ERP data. There is no server — feedback gets shared via JSON export.
        </div>

        <div style={{ marginTop: 16, fontSize: 11, color: "#AAA", textAlign: "center" }}>
          Phase 2 will add: a real backend with shared data, login, audit trail, and automatic backups.
        </div>
      </div>
    </div>
  );
}
