import React, { useRef, useState } from "react";
import { exportAllData, importAllData, clearAllData, STORAGE_VERSION, createBackup, listBackups, restoreBackup, deleteBackup, BackupMeta } from "./useLocalStoredState";
import { APP_VERSION } from "./version";
import { readFakturowniaConfig, writeFakturowniaConfig, testConnection, FakturowniaConfig } from "./fakturownia";
import { addCatalogItem, addCatalogVariety, removeCatalogItem, removeCatalogVariety, mergeCatalogRows, catalogToRows } from "./productCatalog";

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

function ProductCatalogPanel({ catalog, setCatalog }: any) {
  const [newItem, setNewItem] = useState("");
  const [vDraft, setVDraft] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  if (!setCatalog) return null;
  const items = catalog || [];
  const inp: any = { border: "1px solid #E5E7EB", borderRadius: 7, padding: "7px 10px", fontSize: 13, fontFamily: "inherit", outline: "none" };

  const addItem = () => { const n = newItem.trim(); if (!n) return; setCatalog((c: any) => addCatalogItem(c || [], n)); setNewItem(""); };
  const addVar = (item: string) => { const v = (vDraft[item] || "").trim(); if (!v) return; setCatalog((c: any) => addCatalogVariety(c || [], item, v)); setVDraft(d => ({ ...d, [item]: "" })); };
  const rmVar = (item: string, v: string) => setCatalog((c: any) => removeCatalogVariety(c || [], item, v));
  const rmItem = (item: string) => { if (window.confirm(`Remove "${item}" and its varieties from the catalog?`)) setCatalog((c: any) => removeCatalogItem(c || [], item)); };

  function parseLine(line: string): string[] {
    const out: string[] = []; let f = "", inQ = false;
    for (let i = 0; i < line.length; i++) { const ch = line[i]; if (inQ) { if (ch === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else inQ = false; } else f += ch; } else { if (ch === '"') inQ = true; else if (ch === ",") { out.push(f); f = ""; } else f += ch; } }
    out.push(f); return out;
  }
  const importCsv = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = String(e.target?.result || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const lines = text.split("\n").filter(l => l.trim());
        if (!lines.length) { alert("Empty file."); return; }
        const hdr = parseLine(lines[0]).map(h => h.trim().toLowerCase());
        const ii = hdr.indexOf("item"), vi = hdr.indexOf("variety");
        const start = ii >= 0 ? 1 : 0;
        const rows = lines.slice(start).map(l => { const cols = parseLine(l); return { item: (ii >= 0 ? cols[ii] : cols[0] || "").trim(), variety: (vi >= 0 ? cols[vi] : cols[1] || "").trim() }; }).filter(r => r.item);
        if (!rows.length) { alert("No Item rows found. Use columns: Item, Variety."); return; }
        setCatalog((c: any) => mergeCatalogRows(c || [], rows));
        alert(`Imported ${rows.length} row(s) into the catalog.`);
      } catch (err) { alert("Could not read CSV: " + (err instanceof Error ? err.message : String(err))); }
    };
    reader.readAsText(file);
  };
  const exportCsv = () => {
    const rows = catalogToRows(items);
    const csv = "Item,Variety\n" + rows.map(r => `"${r.item.replace(/"/g, '""')}","${r.variety.replace(/"/g, '""')}"`).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "product-catalog.csv"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <Card style={{ marginBottom: 16 }}>
      <SectionTitle>PRODUCT CATALOG <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "#888" }}>· Item / Variety used on PO &amp; SO lines</span></SectionTitle>
      <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
        The single list everyone picks products from, so the same item is named the same way everywhere. New products added from a PO/SO line land here too. Sizes are not part of this — size stays its own field on the line.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <input value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addItem(); }} placeholder="New item (e.g. Pears)" style={{ ...inp, minWidth: 220 }} />
        <Button variant="primary" onClick={addItem}>+ Add item</Button>
        <span style={{ flex: 1 }} />
        <Button onClick={() => fileRef.current?.click()}>Import CSV</Button>
        <Button onClick={exportCsv}>Export CSV</Button>
        <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) importCsv(f); e.currentTarget.value = ""; }} />
      </div>
      <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid #F0F0F0", borderRadius: 8 }}>
        {items.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#AAA", fontSize: 13 }}>No items yet. Add one above or import a CSV.</div>}
        {items.map((c: any) => (
          <div key={c.item} style={{ padding: "12px 14px", borderBottom: "1px solid #F5F5F5" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>{c.item} <span style={{ fontSize: 11, fontWeight: 400, color: "#AAA" }}>· {c.varieties.length} {c.varieties.length === 1 ? "variety" : "varieties"}</span></div>
              <button onClick={() => rmItem(c.item)} title="Remove item" style={{ border: "1px solid #FECACA", color: "#DC2626", background: "#fff", borderRadius: 6, fontSize: 11, padding: "3px 9px", cursor: "pointer", fontWeight: 600 }}>Remove</button>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {c.varieties.map((v: string) => (
                <span key={v} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#F3F4F6", borderRadius: 14, padding: "3px 6px 3px 11px", fontSize: 12 }}>
                  {v}<button onClick={() => rmVar(c.item, v)} title="Remove variety" style={{ border: "none", background: "#E5E7EB", color: "#666", borderRadius: "50%", width: 16, height: 16, lineHeight: "14px", cursor: "pointer", fontSize: 11 }}>×</button>
                </span>
              ))}
              <input value={vDraft[c.item] || ""} onChange={e => setVDraft(d => ({ ...d, [c.item]: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") addVar(c.item); }} placeholder="+ variety" style={{ ...inp, padding: "4px 8px", fontSize: 12, width: 130 }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function Settings({
  reloadFromStorage,
  userRole,
  setUserRole,
  userName,
  setUserName,
  productCatalog = [],
  setProductCatalog,
}: {
  reloadFromStorage: () => void;
  userRole?: string;
  setUserRole?: (r: string) => void;
  userName?: string;
  setUserName?: (n: string) => void;
  productCatalog?: any[];
  setProductCatalog?: (v: any) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ kind: "info" | "success" | "error"; text: string } | null>(null);

  // v6.15: the "Locations & ports" panel was removed — ports / relay points / cross-dock
  // warehouses are managed in Counterparties → Logistics points, and supplier/client/
  // warehouse addresses come from the counterparty record. Any locations added here in
  // older versions still resolve on existing documents (readCustomLocations in locations.ts).

  // v6.8: Fakturownia read-only connection (token kept browser-local, never exported)
  const existingFkt = readFakturowniaConfig();
  const [fktSub, setFktSub] = useState(existingFkt?.subdomain || "");
  const [fktToken, setFktToken] = useState(existingFkt?.apiToken || "");
  const [fktLiveWrite, setFktLiveWrite] = useState(existingFkt?.liveWriteEnabled === true);
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
    writeFakturowniaConfig({ subdomain: fktSub.trim(), apiToken: fktToken.trim(), liveWriteEnabled: fktLiveWrite });
    setFktMsg({ kind: "success", text: `Saved in this browser only (token never exported). Live invoice creation is ${fktLiveWrite ? "ENABLED" : "off"}.` });
  }

  function handleFktDisconnect() {
    writeFakturowniaConfig(null);
    setFktSub(""); setFktToken(""); setFktLiveWrite(false);
    setFktMsg({ kind: "info", text: "Disconnected — the token has been removed from this browser." });
  }

  const [backups, setBackups] = useState<BackupMeta[]>(() => listBackups());
  const refreshBackups = () => setBackups(listBackups());

  function handleExport() {
    try {
      const json = exportAllData();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      // v6.17: stamp the build + schema version so testers can see at a glance
      // whether a shared file matches their app build before importing.
      a.download = `marianna-erp_v${APP_VERSION}_schema-v${STORAGE_VERSION}_${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMessage({ kind: "success", text: `Export downloaded (build v${APP_VERSION}). Whoever imports it must be on the same app version (v${APP_VERSION}).` });
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
    e.target.value = ""; // reset early so the same file can be re-picked later
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        setMessage({ kind: "error", text: "Could not read file as text." });
        return;
      }
      // v6.18.4 (P0-2): the export now stamps appVersion in _meta. Warn loudly if
      // the file was made on a different build (same schema can still differ in
      // fields). Schema-version mismatch stays a hard block inside importAllData.
      let versionWarn = "";
      try {
        const meta = JSON.parse(result)?._meta;
        const fileApp = meta?.appVersion;
        if (fileApp && fileApp !== APP_VERSION) {
          versionWarn = `\n\n⚠ This file was made on app v${fileApp}, but you are on v${APP_VERSION}. Fields can differ between builds — everyone sharing files should be on the same version.`;
        } else if (!fileApp) {
          versionWarn = `\n\n⚠ This file has no app-version stamp (older export). Import only if you know it matches v${APP_VERSION}.`;
        }
      } catch { /* importAllData will report invalid JSON */ }
      const proceed = window.confirm(
        "Import will REPLACE all data currently in this browser with the contents of this file.\n\n" +
        "There is no merge — anything here that isn't in the file will be gone.\n\n" +
        "A backup of your current data will be saved automatically first, so you can undo it from Settings → Local backups." +
        versionWarn +
        "\n\nContinue?"
      );
      if (!proceed) { setMessage({ kind: "info", text: "Import cancelled — nothing was changed." }); return; }
      const outcome = importAllData(result);
      if (!outcome.ok) {
        setMessage({ kind: "error", text: outcome.error || "Import failed." });
        return;
      }
      refreshBackups();
      const loadedDesc = (outcome.loaded || []).join(", ") || "no recognized data";
      const backupNote = outcome.backup ? " A backup of your previous data was saved (Settings → Local backups)." : "";
      setMessage({ kind: "success", text: `Imported: ${loadedDesc}.${backupNote} Reloading…` });
      setTimeout(() => { window.location.reload(); }, 1400);
    };
    reader.onerror = () => setMessage({ kind: "error", text: "Could not read the file." });
    reader.readAsText(file);
  }

  function handleBackupNow() {
    const meta = createBackup("Manual backup");
    refreshBackups();
    setMessage(meta ? { kind: "success", text: "Backup saved locally." } : { kind: "error", text: "Could not save a backup (storage may be full)." });
  }

  function handleRestore(b: BackupMeta) {
    if (!window.confirm(`Restore the backup from ${new Date(b.createdAt).toLocaleString()}?\n\nThis REPLACES current data. Your current data will itself be backed up first, so this is reversible.`)) return;
    const outcome = restoreBackup(b.id);
    if (!outcome.ok) { setMessage({ kind: "error", text: outcome.error || "Restore failed." }); return; }
    setMessage({ kind: "success", text: "Backup restored. Reloading…" });
    setTimeout(() => window.location.reload(), 1200);
  }

  function handleDeleteBackup(b: BackupMeta) {
    if (!window.confirm("Delete this backup permanently?")) return;
    deleteBackup(b.id);
    refreshBackups();
  }

  function handleReset() {
    const confirmed = window.confirm(
      "Start fresh — clear ALL your data?\n\n" +
      "This wipes contacts, POs, lots, sales orders, shipments, operational costs, credit notes and logistics points, " +
      "returning the system to a completely empty state.\n\n" +
      "A backup will be saved automatically first, so you can undo this from Settings → Local backups."
    );
    if (!confirmed) return;
    const backup = clearAllData();
    refreshBackups();
    setMessage({ kind: "info", text: `All data cleared${backup ? " (a backup was saved first)" : ""}. Reloading to an empty system…` });
    setTimeout(() => window.location.reload(), 1000);
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

        <ProductCatalogPanel catalog={productCatalog} setCatalog={setProductCatalog} />

        <Card style={{ marginBottom: 16 }}>
          <SectionTitle>FAKTUROWNIA CONNECTION <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "#888" }}>· invoice sync</span></SectionTitle>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
            Connect your Fakturownia account to pull cost invoices (issued to you via KSeF) straight into Operational Costs — no file export needed.
            By default this connection is used for <strong>reading and matching</strong> only. Creating real invoices in Fakturownia from the
            Invoices module is a separate action that stays <strong>turned off</strong> unless you enable it below. Your API token is stored
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
          <div style={{ background: fktLiveWrite ? "#FEF2F2" : "#F9FAFB", border: `1px solid ${fktLiveWrite ? "#FECACA" : "#E5E7EB"}`, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer", fontSize: 12.5, color: "#374151" }}>
              <input type="checkbox" checked={fktLiveWrite} onChange={e => setFktLiveWrite(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                <strong>Allow creating real invoices in Fakturownia from this browser</strong> (off by default).
                Leave this off until a backend with a server-side token, role permissions and an audit trail exists — pushing an invoice is a
                real legal/accounting action. With it off, the Invoices module still lets you <em>copy the payload</em> to create the invoice manually.
                {fktLiveWrite && <span style={{ display: "block", marginTop: 5, color: "#991B1B", fontWeight: 600 }}>⚠ Live creation is enabled — “Send to Fakturownia” will create real invoices. Use only in a controlled, authorised test.</span>}
              </span>
            </label>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Button onClick={handleFktSave} variant="primary">Save connection</Button>
            <Button onClick={handleFktTest} disabled={fktBusy || !fktSub.trim() || !fktToken.trim()}>{fktBusy ? "Testing…" : "Test connection"}</Button>
            {existingFkt && <Button onClick={handleFktDisconnect} variant="danger">Disconnect</Button>}
          </div>
        </Card>

        <Card style={{ marginBottom: 16 }}>
          <SectionTitle>EXPORT</SectionTitle>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
            Download a JSON file containing all your data (contacts, POs, lots, sales orders, shipments, operational costs, credit notes and logistics points). Share it with a colleague, or send it to Hazem as feedback. The filename includes the app version (<strong>v{APP_VERSION}</strong>) — whoever imports it must be on the same version.
          </div>
          <Button onClick={handleExport} variant="primary">📥 Export all data as JSON</Button>
        </Card>

        <Card style={{ marginBottom: 16 }}>
          <SectionTitle>IMPORT</SectionTitle>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
            Load a colleague's exported JSON file. <strong>This replaces all your current data — there is no merge.</strong> A backup of your current data is saved automatically first, so you can undo it from Local backups below. The file must come from the same app version (v{APP_VERSION}).
          </div>
          <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={handleFileSelected} style={{ display: "none" }} />
          <Button onClick={handleImportClick}>📤 Choose JSON file to import...</Button>
        </Card>

        <Card style={{ marginBottom: 16 }}>
          <SectionTitle>LOCAL BACKUPS</SectionTitle>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
            Automatic snapshots taken before each import or reset, kept in this browser (last {8}). Use one to undo an overwrite. These are a safety net, not a substitute for exporting a file you keep elsewhere.
          </div>
          <div style={{ marginBottom: 12 }}><Button onClick={handleBackupNow} variant="primary">＋ Create backup now</Button></div>
          {backups.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "#888" }}>No backups yet. One will be created automatically the next time you import or reset.</div>
          ) : (
            <div style={{ border: "1px solid #EDEDED", borderRadius: 8, overflow: "hidden" }}>
              {backups.map((b: BackupMeta) => (
                <div key={b.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center", padding: "9px 12px", borderBottom: "1px solid #F5F5F5" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.label}</div>
                    <div style={{ fontSize: 11, color: "#888" }}>{new Date(b.createdAt).toLocaleString()} · {b.sizeKB} KB · schema v{b.version}</div>
                  </div>
                  <button onClick={() => handleRestore(b)} title="Replace current data with this backup" style={{ border: "1px solid #BFDBFE", background: "#fff", color: "#2563EB", borderRadius: 6, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Restore</button>
                  <button onClick={() => handleDeleteBackup(b)} title="Delete this backup" style={{ border: "1px solid #FECACA", background: "#fff", color: "#DC2626", borderRadius: 6, padding: "5px 9px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card style={{ marginBottom: 16, borderLeft: "3px solid #DC2626" }}>
          <SectionTitle>RESET</SectionTitle>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
            Erase everything you've entered and return the system to a completely empty state. Use this if you've made test data unusable and want to start fresh. A backup is saved automatically first (see Local backups).
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
