import React, { useRef, useState } from "react";
import { exportAllData, importAllData, clearAllData, STORAGE_VERSION } from "./useLocalStoredState";
import { readCustomLocations, addCustomLocation, removeCustomLocation, CUSTOM_LOCATION_TYPE_OPTIONS } from "./locations";
import { readFakturowniaConfig, writeFakturowniaConfig, testConnection, FakturowniaConfig } from "./fakturownia";

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
  const [customLocations, setCustomLocations] = useState<any[]>(() => readCustomLocations());
  const [newLoc, setNewLoc] = useState<{ name: string; country: string; type: string; address: string }>({ name: "", country: "", type: "Port", address: "" });

  function handleAddLocation() {
    const name = newLoc.name.trim();
    if (!name) return;
    const clash = customLocations.find(l => String(l.name).trim().toLowerCase() === name.toLowerCase());
    if (clash) { setMessage({ kind: "error", text: `A custom location named "${name}" already exists.` }); return; }
    addCustomLocation({ name, country: newLoc.country, type: newLoc.type as any, address: newLoc.address });
    setCustomLocations(readCustomLocations());
    setNewLoc({ name: "", country: "", type: newLoc.type, address: "" });
    setMessage({ kind: "success", text: `Location "${name}" added. Reloading so all modules see it...` });
    setTimeout(() => window.location.reload(), 900);
  }

  function handleRemoveLocation(id: number, name: string) {
    if (!window.confirm(`Remove location "${name}"?\n\nAny PO/SO/shipment that references it will show it as a missing location until you pick a new one.`)) return;
    removeCustomLocation(id);
    setCustomLocations(readCustomLocations());
    setMessage({ kind: "info", text: `Location "${name}" removed. Reloading...` });
    setTimeout(() => window.location.reload(), 900);
  }

  // v6.8: Fakturownia read-only connection (token kept browser-local, never exported)
  const existingFkt = readFakturowniaConfig();
  const [fktSub, setFktSub] = useState(existingFkt?.subdomain || "");
  const [fktToken, setFktToken] = useState(existingFkt?.apiToken || "");
  const [fktBusy, setFktBusy] = useState(false);
  const [fktMsg, setFktMsg] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);

  async function handleFktTest() {
    setFktBusy(true); setFktMsg(null);
    const cfg: FakturowniaConfig = { subdomain: fktSub.trim(), apiToken: fktToken.trim() };
    const r = await testConnection(cfg);
    setFktBusy(false);
    if (r.ok) setFktMsg({ kind: "success", text: "Connection works — Fakturownia responded. You can now sync cost invoices from Finance → Operational Costs." });
    else if (r.corsLikely) setFktMsg({ kind: "error", text: "The browser couldn't reach Fakturownia (likely a CORS restriction on direct browser access). The file import still works; live sync will run from the Phase-2 backend." });
    else setFktMsg({ kind: "error", text: r.error || "Connection failed." });
  }

  function handleFktSave() {
    if (!fktSub.trim() || !fktToken.trim()) { setFktMsg({ kind: "error", text: "Enter both the account name and the API token." }); return; }
    writeFakturowniaConfig({ subdomain: fktSub.trim(), apiToken: fktToken.trim() });
    setFktMsg({ kind: "success", text: "Saved in this browser only. The token is never included in the data export." });
  }

  function handleFktDisconnect() {
    writeFakturowniaConfig(null);
    setFktSub(""); setFktToken("");
    setFktMsg({ kind: "info", text: "Disconnected — the token has been removed from this browser." });
  }

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
          <SectionTitle>LOCATIONS &amp; PORTS</SectionTitle>
          <div style={{ fontSize: 12.5, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "10px 12px", marginBottom: 14, lineHeight: 1.5 }}>
            <strong>Moved.</strong> Ports, relay points and forwarder cross-dock warehouses are now managed in <strong>Counterparties → Logistics points</strong>. Supplier, client and warehouse addresses come from their counterparty record, so there's nothing to re-enter. Any entries you added here still work and are listed below; please add new ones in the Logistics points tab.
          </div>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
            Add ports, airports, warehouses, client sites or customs points that are missing from the built-in list.
            They appear in every destination and leg From/To dropdown across PO, SO, Inventory and Shipments.
            Custom locations are saved with your data and included in the JSON export.
          </div>
          {customLocations.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              {customLocations.map((l: any) => (
                <div key={l.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center", padding: "7px 10px", border: "1px solid #F3F4F6", borderRadius: 7, marginBottom: 6, background: "#FAFAFA" }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{l.name}</span>
                    <span style={{ fontSize: 11.5, color: "#888", marginLeft: 8 }}>{l.country}{l.address ? ` · ${l.address}` : ""}</span>
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "#2563EB", background: "#EFF6FF", padding: "2px 8px", borderRadius: 5 }}>
                    {(CUSTOM_LOCATION_TYPE_OPTIONS.find(o => o.key === l.type) || {}).label || l.type}
                  </span>
                  <button onClick={() => handleRemoveLocation(l.id, l.name)} title="Remove this location"
                    style={{ border: "1px solid #FECACA", background: "#fff", color: "#DC2626", borderRadius: 6, padding: "3px 9px", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.9fr 1.1fr 1.4fr auto", gap: 10, alignItems: "end" }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>Name</label>
              <input value={newLoc.name} onChange={e => setNewLoc({ ...newLoc, name: e.target.value })} placeholder="e.g. Sokhna Port"
                style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, background: "#fff" }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>Country</label>
              <input value={newLoc.country} onChange={e => setNewLoc({ ...newLoc, country: e.target.value })} placeholder="e.g. Egypt"
                style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, background: "#fff" }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>Type</label>
              <select value={newLoc.type} onChange={e => setNewLoc({ ...newLoc, type: e.target.value })}
                style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, background: "#fff" }}>
                {CUSTOM_LOCATION_TYPE_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>Address (optional)</label>
              <input value={newLoc.address} onChange={e => setNewLoc({ ...newLoc, address: e.target.value })} placeholder="street, city"
                style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, background: "#fff" }} />
            </div>
            <Button onClick={handleAddLocation} variant="success" disabled={!newLoc.name.trim()}>+ Add</Button>
          </div>
          <div style={{ fontSize: 11, color: "#92400E", background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 6, padding: "7px 10px", marginTop: 12 }}>
            After adding or removing a location the page reloads so all modules pick it up.
          </div>
        </Card>

        <Card style={{ marginBottom: 16 }}>
          <SectionTitle>FAKTUROWNIA CONNECTION <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "#888" }}>· read-only invoice sync</span></SectionTitle>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
            Connect your Fakturownia account to pull cost invoices (issued to you via KSeF) straight into Operational Costs — no file export needed.
            This is <strong>read-only</strong>: the ERP only reads invoices, never creates or changes them. Your API token is stored
            <strong> only in this browser</strong> and is deliberately <strong>excluded from the data export</strong>, so it never travels in a shared file.
          </div>
          <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#92400E", marginBottom: 14 }}>
            Get the token in Fakturownia → Settings → API. Treat it like a password — if it has ever been shared, rotate it there first.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>Account name</label>
              <input value={fktSub} onChange={e => setFktSub(e.target.value)} placeholder="e.g. marianna2" style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
              <div style={{ fontSize: 10.5, color: "#AAA", marginTop: 3 }}>the part before .fakturownia.pl</div>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>API token</label>
              <input type="password" value={fktToken} onChange={e => setFktToken(e.target.value)} placeholder="paste API token" style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "ui-monospace, Menlo, monospace" }} />
            </div>
          </div>
          {fktMsg && (
            <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 7, fontSize: 12.5,
              background: fktMsg.kind === "success" ? "#ECFDF5" : fktMsg.kind === "error" ? "#FEE2E2" : "#EFF6FF",
              border: `1px solid ${fktMsg.kind === "success" ? "#A7F3D0" : fktMsg.kind === "error" ? "#FCA5A5" : "#BFDBFE"}`,
              color: fktMsg.kind === "success" ? "#065F46" : fktMsg.kind === "error" ? "#991B1B" : "#1E40AF" }}>
              {fktMsg.text}
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <Button onClick={handleFktSave} variant="primary">Save connection</Button>
            <Button onClick={handleFktTest} disabled={fktBusy || !fktSub.trim() || !fktToken.trim()}>{fktBusy ? "Testing…" : "Test connection"}</Button>
            {existingFkt && <Button onClick={handleFktDisconnect} variant="danger">Disconnect</Button>}
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
            Erase everything you've entered and return the system to a completely empty state. Use this if you've made test data unusable and want to start fresh. Export a backup first if in doubt.
          </div>
          <Button onClick={handleReset} variant="danger">⚠ Start fresh — erase ALL data</Button>
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
