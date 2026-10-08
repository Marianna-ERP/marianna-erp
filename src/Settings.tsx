import { ModulePage } from "./ui";
import { useConfirm, SmallButton } from "./ui";
import { PAGE_MAX } from "./ui";
import React, { useRef, useState, useEffect } from "react";
import { importAllData, clearAllData, STORAGE_VERSION, createBackup, listBackups, restoreBackup, deleteBackup, BackupMeta, storageUsage, startFreshSeason, transactionalCounts, MASTER_KEYS, readStoreValue, writeStoreValue, DATA_KEYS } from "./useLocalStoredState";
import { APP_VERSION } from "./version";
import RecoveryPanel from "./RecoveryPanel";   // v7.4.2 (A-REC-1)
import { useUnsavedGuard } from "./unsaved";   // v7.2.0
import { isSharedMode, isTestCopy, replaceSharedStores, sharedCopyAsExport, storesFromExport, readSession, ENV_LABEL } from "./remoteStore";   // v7.0.0 (A-SH-1)
import { userBySignIn, usersDiff, usersSaveProblems, rolesOrDefault, materializeUser, rightsSummary } from "./permissions.domain";   // v7.1.0 (A-USR-1) · v7.2.0 (A-SET-1)
import { AutoBackupCard } from "./BackupPanel";   // v6.99.70 (A-BK-1)
import { downloadAllData, flushFolderBackup } from "./autoBackup";
import { fetchDepartments } from "./fakturownia";
import { mapDepartments } from "./fakturowniaDepartments.domain";
import { readFakturowniaConfig, writeFakturowniaConfig, testConnection, FakturowniaConfig } from "./fakturownia";
import { addCatalogItem, addCatalogVariety, removeCatalogItem, removeCatalogVariety, mergeCatalogRows, catalogToRows, setCatalogCnCode } from "./productCatalog";
import { referencesToLocation } from "./referenceGuards";
import { MODULE_KEYS, FINANCE_KEYS, usersGaps } from "./permissions.domain";
import { CN_CODES } from "./cnCodes";
import { nextId as mintId } from "./ids";
import { renameCatalogItem } from "./productCatalog";
import { allLocations, addCustomLocation, updateCustomLocation, removeCustomLocation, CUSTOM_LOCATION_TYPE_OPTIONS, readLocationOverrides, writeLocationOverride, clearLocationOverride, CUSTOM_LOCATION_ID_BASE, LOGISTICS_POINT_BASE } from "./locations";
import { DEFAULT_SEASON, seasonsPresent, currentSeason, docSeason, sliceSeason, removeSeason, appendArchive, STORE_KIND } from "./season.domain";
import { recordAudit } from "./audit";
import { localTodayISO } from "./dates";

// ─── SETTINGS MODULE ────────────────────────────────────────────────────────
// Purpose: give testers tools to manage their local data — export it for
// sharing with the team, import a colleague's snapshot, or reset to demo.
//
// This is intentionally minimal. The "Storage Settings" panel becomes the
// place to add user-facing administration features as we grow (Phase 2:
// language, currency display preferences, notification settings, etc.)

const INP: any = { width: "100%", boxSizing: "border-box", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: "#fff" };
function Card({ children, style }: any) {
  return <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "20px 22px", ...style }}>{children}</div>;
}

function Lbl({ children }: any) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", letterSpacing: "0.05em", marginBottom: 3, textTransform: "uppercase" }}>{children}</div>;
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


// ── v6.36.0: PORTS & LOCATIONS manager ──────────────────────────────────────
// The panel removed in v6.15, rebuilt on the surviving engine. Built-in reference
// locations can have their real details OVERRIDDEN (name/country/address); custom
// locations are fully editable; logistics points and counterparty warehouses are
// listed read-only with a pointer to Parties. Changes reload the app so every
// module that snapshots LOCATIONS at import picks them up (the documented pattern).
// v6.99.54 (owner, cleanup): the Season tools of v6.99.52/53 (cut-off retirement · bring POs across · rebuild expected lots) were
// removed — the season model is ARCHIVE, not wipe-and-re-enter (see season.domain.ts). Their detector lives on as an integrity rule.

// ── v6.99.54 (AR-1 · AR-3 · AR-5, owner ruling 23 Sept): SEASONS — close, export, remove, re-import. Nothing is deleted at season end. ──
function SeasonsPanel({ refStores = {}, seasonSettings, setSeasonSettings, archivedSeasons = [], setArchivedSeasons, stConfirm, setMessage }: any) {
  const st = seasonSettings || DEFAULT_SEASON;
  const data: any = { pos: refStores.pos || [], orders: refStores.orders || [], shipments: refStores.shipments || [], lots: refStores.lots || [], invoices: readStoreValue("invoices"), claims: readStoreValue("claims"), poSettlements: readStoreValue("poSettlements"), inspections: readStoreValue("inspections"), stockCounts: readStoreValue("stockCounts"), financeNotes: readStoreValue("financeNotes"), creditNotes: readStoreValue("creditNotes"), warehouseInvoices: readStoreValue("warehouseInvoices"), operationalCosts: readStoreValue("operationalCosts") };
  const present = seasonsPresent(data, st);
  const today = localTodayISO(); const cur = currentSeason(today, st);
  const liveLots = (season: string) => (data.lots || []).filter((l: any) => (Number(l.physicalKg) || 0) > 0 && docSeason("lot", l, st, { pos: data.pos }) === season).length;
  async function closeSeason(season: string) {
    const ok = await stConfirm({ tone: "warn", title: `Close season ${season}?`, message: `Its documents are TAGGED archived and leave the day-to-day screens ("include archived" shows them). Nothing is deleted. ${liveLots(season) ? liveLots(season) + " lot(s) of that season still hold kilos — they stay live as this season's stock." : ""}`, confirmLabel: "Close the season", cancelLabel: "Keep it open" });
    if (!ok) return;
    setArchivedSeasons((prev: string[]) => Array.from(new Set([...(prev || []), season])));
    recordAudit({ module: "System", docType: "Season", docNumber: season, action: "status", summary: `Season ${season} closed — documents archived (tagged, not deleted)` });
    setMessage({ kind: "info", text: `Season ${season} closed. Its documents are archived.` });
  }
  function reopen(season: string) { setArchivedSeasons((prev: string[]) => (prev || []).filter(s => s !== season)); recordAudit({ module: "System", docType: "Season", docNumber: season, action: "status", summary: `Season ${season} re-opened` }); }
  function exportSeason(season: string) {
    const fileObj = sliceSeason({ ...data, ...Object.fromEntries(MASTER_KEYS.map(k => [k, readStoreValue(k)])) }, season, st, MASTER_KEYS, { app: "marianna-erp", version: STORAGE_VERSION, exportedBy: "Settings → Seasons" });
    const blob = new Blob([JSON.stringify(fileObj)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `marianna-archive_${season.replace("/", "-")}_${today}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    recordAudit({ module: "System", docType: "Season", docNumber: season, action: "exported", summary: `Season ${season} exported to its own archive file` });
  }
  async function removeExported(season: string) {
    const ok = await stConfirm({ tone: "danger", title: `Remove season ${season} from this browser?`, message: "Only after you have EXPORTED it and kept the file. The archived documents of that season leave this browser (a backup is saved first); lots with kilos stay. Import the archive file to read them again.", confirmLabel: "Remove from this browser", cancelLabel: "Keep" });
    if (!ok) return;
    await flushFolderBackup();   // v6.99.70 (A-BK): the folder gets the state before the overwrite
    createBackup(`Auto — before removing season ${season}`);
    const all: any = {}; Object.keys(STORE_KIND).forEach(k => { all[k] = readStoreValue(k); }); all.pos = readStoreValue("pos");
    const r = removeSeason(all, season, st);
    Object.entries(r.data).forEach(([k, v]) => { if (Object.keys(STORE_KIND).includes(k)) writeStoreValue(k, v); });
    if (isSharedMode()) { try { const note = await pushStoresToShared(Object.keys(r.data).filter(k => Object.keys(STORE_KIND).includes(k)), `archiving ${season}`); setMessage({ kind: "info", text: `Season ${season} archived in the shared data — ${note}. Reloading…` }); setTimeout(() => window.location.reload(), 1400); return; } catch (x: any) { setMessage({ kind: "error", text: `Archiving in the shared data failed: ${String(x?.message || x)}` }); return; } }   // v7.0.0 (A-SH-1)
    recordAudit({ module: "System", docType: "Season", docNumber: season, action: "deleted", summary: `Season ${season} removed from this browser after export: ${Object.entries(r.removed).map(([k, n]) => `${k} ${n}`).join(", ")}` });
    setMessage({ kind: "info", text: `Season ${season} removed from this browser. Reloading…` }); setTimeout(() => window.location.reload(), 900);
  }
  function importArchive(f: any) { if (!f) return; const rd = new FileReader(); rd.onload = async () => {
    let parsed: any; try { parsed = JSON.parse(String(rd.result || "")); } catch { setMessage({ kind: "error", text: "Not a valid file." }); return; }
    if (!parsed?._meta || parsed._meta.app !== "marianna-erp") { setMessage({ kind: "error", text: "Not a MARIANNA archive file." }); return; }
    const cur: any = {}; Object.keys(STORE_KIND).forEach(k => { cur[k] = readStoreValue(k); }); cur.archivedSeasons = archivedSeasons;
    const r = appendArchive(cur, parsed);
    const ok = await stConfirm({ tone: "info", title: `Import archive ${r.seasons.join(", ") || ""}?`, message: `Appended (hidden as archived): ${Object.entries(r.added).map(([k, n]) => `${k} ${n}`).join(", ") || "nothing new"}${r.skipped ? ` · ${r.skipped} already here` : ""}. Nothing live is changed.`, confirmLabel: "Import", cancelLabel: "Cancel" });
    if (!ok) return;
    await flushFolderBackup();   // v6.99.70 (A-BK)
    createBackup("Auto — before importing an archive");
    Object.entries(r.data).forEach(([k, v]) => { if (Object.keys(STORE_KIND).includes(k)) writeStoreValue(k, v); });
    setArchivedSeasons(() => r.data.archivedSeasons || archivedSeasons);
    recordAudit({ module: "System", docType: "Season", docNumber: r.seasons.join(",") || f.name, action: "created", summary: `Archive imported: ${Object.entries(r.added).map(([k, n]) => `${k} ${n}`).join(", ")}` });
    setMessage({ kind: "info", text: "Archive imported. Reloading…" }); setTimeout(() => window.location.reload(), 900);
  }; rd.readAsText(f); }
  return (
    <Card style={{ marginBottom: 16 }}>
      <SectionTitle>SEASONS</SectionTitle>
      <div style={{ fontSize: 11.5, color: "#64748B", marginBottom: 10 }}>Numbers continue across seasons. A closed season is <b>archived</b> — its documents leave the day-to-day screens but stay in the file; export it to its own file to keep the system light, re-import it whenever an old claim or recall needs it. A lot that still holds kilos never archives.</div>
      <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap", marginBottom: 10 }}>
        <div><Lbl>Season starts on</Lbl><div style={{ display: "flex", gap: 6 }}><input type="number" min={1} max={31} value={st.startDay} onChange={e => setSeasonSettings && setSeasonSettings({ ...st, startDay: Math.max(1, Math.min(31, parseInt(e.target.value) || 1)) })} style={{ width: 56, border: "1px solid #E5E7EB", borderRadius: 6, padding: "6px 8px", fontSize: 12 }} /><select value={st.startMonth} onChange={e => setSeasonSettings && setSeasonSettings({ ...st, startMonth: parseInt(e.target.value) })} style={{ border: "1px solid #E5E7EB", borderRadius: 6, padding: "6px 8px", fontSize: 12 }}>{["January","February","March","April","May","June","July","August","September","October","November","December"].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></div></div>
        <div style={{ fontSize: 12 }}>Current season: <b>{cur}</b></div>
        <label style={{ fontSize: 12, border: "1px dashed #1E40AF", color: "#1E40AF", borderRadius: 7, padding: "6px 10px", cursor: "pointer", marginLeft: "auto" }}>Import file (archive)<input type="file" accept=".json,application/json" style={{ display: "none" }} onChange={e => importArchive(e.target.files?.[0])} /></label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr auto", gap: 8, fontSize: 10, fontWeight: 700, color: "#94A3B8" }}><div>SEASON</div><div>DOCUMENTS</div><div>STATE</div><div /></div>
      {present.map(({ season, count }) => { const closed = (archivedSeasons || []).includes(season); return (
        <div key={season} style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr auto", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px solid #F1F5F9", fontSize: 12.5 }}>
          <div style={{ fontWeight: 800 }}>{season}{season === cur ? <span style={{ color: "#16A34A", fontSize: 10.5 }}> · current</span> : null}</div>
          <div>{count} document(s){liveLots(season) ? ` · ${liveLots(season)} lot(s) with kilos stay live` : ""}</div>
          <div style={{ color: closed ? "#92400E" : "#16A34A", fontWeight: 700 }}>{closed ? "archived" : "open"}</div>
          <div style={{ display: "flex", gap: 6 }}>
            {!closed && season !== cur && <SmallButton onClick={() => closeSeason(season)}>Close season</SmallButton>}
            {closed && <SmallButton onClick={() => exportSeason(season)}>Export file</SmallButton>}
            {closed && <SmallButton kind="red" onClick={() => removeExported(season)}>Remove from browser</SmallButton>}
            {closed && <SmallButton onClick={() => reopen(season)}>Re-open</SmallButton>}
          </div>
        </div>); })}
      {!present.length && <div style={{ fontSize: 12, color: "#94A3B8" }}>No documents yet.</div>}
    </Card>
  );
}

function LocationsPanel({ refStores = {} }: any) {
  const { confirm: lpConfirm, alert: lpAlert, dialogNode: lpNode } = useConfirm(); // P2-6
  const [q, setQ] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState("All");
  const [editingId, setEditingId] = React.useState<any>(null);
  const [edit, setEdit] = React.useState<any>({});
  const [add, setAdd] = React.useState<any>({ name: "", type: "Port", country: "", address: "" });
  const overrides = readLocationOverrides();
  // v6.38.0: this list manages ONLY built-in and custom locations. Party-derived
  // addresses (suppliers/clients/warehouses) and logistics points remain in every
  // picker but are managed in Parties — they don't belong in this list and were
  // the "can't delete / wrong data" confusion.
  const sourceOf = (l: any) => Number(l.id) >= CUSTOM_LOCATION_ID_BASE ? "Custom" : "Built-in";
  // v6.43.0 (test-round #12): this manager is for PORTS only. Built-in party
  // facilities (rented warehouse / supplier / client / customs) belong to the
  // Parties module — they were wrongly mixed into the built-in seed here and
  // couldn't be deleted. We now show only genuine Port-type built-ins; custom
  // entries the user added stay visible and manageable. Party facilities are
  // unaffected in storage and still feed the pickers via counterpartyLocations.
  const PORT_TYPES = new Set(["Port", "PortWarehouse"]);
  const locs = allLocations().filter((l: any) =>
    Number(l.id) < LOGISTICS_POINT_BASE &&
    (sourceOf(l) === "Custom" || PORT_TYPES.has(String(l.type))));
  const types = ["All", ...Array.from(new Set(locs.map((l: any) => l.type)))];
  const shown = locs.filter((l: any) => (typeFilter === "All" || l.type === typeFilter) &&
    (!q.trim() || `${l.name} ${l.country} ${l.address || ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  const reloadNote = async () => { await lpAlert({ tone: "info", title: "Saved", message: "The app will reload so all location pickers see the change." }); window.location.reload(); };
  const startEdit = (l: any) => { setEditingId(l.id); setEdit({ name: l.name, country: l.country || "", address: l.address || "" }); };
  const saveEdit = (l: any) => {
    const src = sourceOf(l);
    if (src === "Custom") updateCustomLocation(Number(l.id), { name: edit.name, country: edit.country, address: edit.address });
    else if (src === "Built-in") writeLocationOverride(Number(l.id), { name: edit.name, country: edit.country, address: edit.address });
    reloadNote();
  };
  const inp = { border: "1px solid #E5E7EB", borderRadius: 6, padding: "5px 8px", fontSize: 12, width: "100%" } as any;
  return (
    <Card style={{ marginBottom: 16 }}>
      {lpNode}
      <SectionTitle>PORTS &amp; LOCATIONS <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "#888" }}>· feeds port pickers, the over-ship guard and transport-order addresses</span></SectionTitle>
      <div style={{ fontSize: 11.5, color: "#64748B", margin: "6px 0 12px" }}>
        Add your own ports, port/transshipment warehouses or facilities here — they appear in every location picker.
        Built-in reference locations can be edited too (e.g. put the real transshipment-warehouse address on a port) — shown with an <span style={{ color: "#B45309", fontWeight: 700 }}>edited</span> mark.
        Supplier / client / warehouse addresses and forwarders' relay points are <strong>not listed here</strong> — they live in <strong>Parties</strong> (and still appear in every location picker automatically).
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.1fr 0.9fr 1.6fr auto", gap: 8, alignItems: "end", marginBottom: 12, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: 10 }}>
        <div><Lbl>Name</Lbl><input style={inp} value={add.name} onChange={e => setAdd((a: any) => ({ ...a, name: e.target.value }))} placeholder="e.g. Luka Koper CFS warehouse" /></div>
        <div><Lbl>Type</Lbl><select style={inp} value={add.type} onChange={e => setAdd((a: any) => ({ ...a, type: e.target.value }))}>{CUSTOM_LOCATION_TYPE_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></div>
        <div><Lbl>Country</Lbl><input style={inp} value={add.country} onChange={e => setAdd((a: any) => ({ ...a, country: e.target.value }))} placeholder="Slovenia" /></div>
        <div><Lbl>Address</Lbl><input style={inp} value={add.address} onChange={e => setAdd((a: any) => ({ ...a, address: e.target.value }))} placeholder="street, city — printed on transport orders" /></div>
        <button disabled={!add.name.trim()} onClick={() => { addCustomLocation({ name: add.name, country: add.country, type: add.type, address: add.address }); reloadNote(); }}
          style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: add.name.trim() ? "#111" : "#D1D5DB", color: "#fff", fontSize: 12, fontWeight: 700, cursor: add.name.trim() ? "pointer" : "not-allowed" }}>+ Add</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input style={{ ...inp, maxWidth: 260 }} value={q} onChange={e => setQ(e.target.value)} placeholder="Search name / country / address…" />
        <select style={{ ...inp, maxWidth: 180 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>{types.map(t => <option key={String(t)}>{String(t)}</option>)}</select>
        <div style={{ fontSize: 11, color: "#94A3B8", alignSelf: "center" }}>{shown.length} of {locs.length}</div>
      </div>
      <div style={{ maxHeight: 340, overflowY: "auto", border: "1px solid #F1F5F9", borderRadius: 8 }}>
        {shown.map((l: any) => {
          const src = sourceOf(l);
          const overridden = src === "Built-in" && !!overrides[String(l.id)];
          const editable = src === "Custom" || src === "Built-in";
          const isEd = editingId === l.id;
          return (
            <div key={l.id} style={{ display: "grid", gridTemplateColumns: "1.5fr 0.9fr 0.8fr 1.7fr 0.9fr auto", gap: 8, padding: "7px 10px", borderBottom: "1px solid #F8FAFC", fontSize: 12, alignItems: "center" }}>
              {isEd ? <input style={inp} value={edit.name} onChange={e => setEdit((x: any) => ({ ...x, name: e.target.value }))} />
                    : <div style={{ fontWeight: 600 }}>{l.name}{overridden && <span style={{ marginLeft: 6, fontSize: 9.5, color: "#B45309", fontWeight: 700 }}>edited</span>}</div>}
              <div style={{ color: "#64748B" }}>{l.type}</div>
              {isEd ? <input style={inp} value={edit.country} onChange={e => setEdit((x: any) => ({ ...x, country: e.target.value }))} /> : <div style={{ color: "#64748B" }}>{l.country}</div>}
              {isEd ? <input style={inp} value={edit.address} onChange={e => setEdit((x: any) => ({ ...x, address: e.target.value }))} placeholder="address" /> : <div style={{ color: "#94A3B8", fontSize: 11 }}>{l.address || "—"}</div>}
              <div style={{ fontSize: 10, color: src === "Built-in" ? "#64748B" : src === "Custom" ? "#0369A1" : "#7C3AED" }}>{src}</div>
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                {isEd ? (<>
                  <button onClick={() => saveEdit(l)} style={{ border: "none", background: "#111", color: "#fff", borderRadius: 6, fontSize: 11, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>Save</button>
                  <button onClick={() => setEditingId(null)} style={{ border: "1px solid #E5E7EB", background: "#fff", borderRadius: 6, fontSize: 11, padding: "4px 10px", cursor: "pointer" }}>Cancel</button>
                </>) : (<>
                  {editable && <button onClick={() => startEdit(l)} style={{ border: "1px solid #E5E7EB", background: "#fff", borderRadius: 6, fontSize: 11, padding: "3px 9px", cursor: "pointer" }}>Edit</button>}
                  {overridden && <button title="Restore the built-in details" onClick={() => { clearLocationOverride(Number(l.id)); reloadNote(); }} style={{ border: "1px solid #FDE68A", background: "#fff", color: "#B45309", borderRadius: 6, fontSize: 11, padding: "3px 9px", cursor: "pointer" }}>Reset</button>}
                  {src === "Custom" && <button onClick={async () => {
                    // v6.63.0 (D-04, M8): a location still referenced by lots, movements,
                    // shipments/legs, PO/SO destinations or a warehouse tariff must not be
                    // removable — removing it blanked the lot's location with no fallback.
                    const refs = referencesToLocation(Number(l.id), refStores);
                    if (refs.total > 0) {
                      await lpAlert({ tone: "warn", title: `${l.name} is still in use`, message: `It can't be removed while referenced by:\n\n${refs.blockers.map((b: string) => "• " + b).join("\n")}\n\nRe-point or complete those documents first; an unused location can then be removed.` });
                      return;
                    }
                    if (await lpConfirm({ tone: "danger", title: `Remove ${l.name}?`, message: "Nothing references this location. It will be removed.", confirmLabel: "Remove" })) { removeCustomLocation(Number(l.id)); reloadNote(); } }} style={{ border: "none", background: "#DC2626", color: "#fff", borderRadius: 6, fontSize: 11, padding: "3px 9px", cursor: "pointer", fontWeight: 700 }}>Remove</button>}
                </>)}
              </div>
            </div>
          );
        })}
        {shown.length === 0 && <div style={{ padding: 18, textAlign: "center", color: "#AAA", fontSize: 12.5 }}>No locations match.</div>}
      </div>
    </Card>
  );
}


// ── v6.38.0 (R1-C): full-screen editor window for the reference-data managers ──
function FullScreenModal({ title, onClose, children }: any) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", zIndex: 70, display: "flex", alignItems: "stretch", justifyContent: "center", padding: "3vh 3vw" }} onClick={onClose}>
      <div style={{ background: "#F8FAFC", borderRadius: 14, width: "100%", maxWidth: PAGE_MAX, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 64px rgba(15,23,42,0.35)" }} onClick={(e: any) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", background: "#fff", borderBottom: "1px solid #E5E7EB" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#111" }}>{title}</div>
          <button onClick={onClose} style={{ border: "1px solid #E5E7EB", background: "#fff", borderRadius: 8, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Close</button>
        </div>
        <div style={{ overflowY: "auto", padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}

// Compact summary card shown in Settings; the real editing happens in the window.
function ManageCard({ title, summary, buttonLabel, onManage }: any) {
  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#94A3B8", letterSpacing: "0.06em", textTransform: "uppercase" }}>{title}</div>
          <div style={{ fontSize: 12.5, color: "#64748B", marginTop: 4 }}>{summary}</div>
        </div>
        <button onClick={onManage} style={{ flexShrink: 0, border: "none", background: "#111", color: "#fff", borderRadius: 8, padding: "9px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{buttonLabel}</button>
      </div>
    </Card>
  );
}

// ─── v6.44.0 (test-round #7): packaging types → gross weight ────────────────
// Gross weight is driven by packaging, not a flat percentage: a wooden box holds
// 13 kg of apples and weighs 1.4 kg empty, so gross = net + boxes x tare. This
// panel maintains that table; shipments derive gross from it.
function PackagingPanel({ types, setTypes }: any) {
  const { confirm: pkConfirm, alert: pkAlert, dialogNode: pkNode } = useConfirm(); // P2-6
  const blank = { id: "", label: "", capacityKg: "", tareKg: "", boxesPerPallet: "", palletTareKg: "", appliesTo: "" };
  const [form, setForm] = React.useState<any>(blank);
  const list = types || [];
  const sf = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    const label = String(form.label || "").trim();
    const cap = parseFloat(form.capacityKg), tare = parseFloat(form.tareKg);
    if (!label) { await pkAlert({ tone: "warn", title: "Name required", message: "Give the packaging a name, e.g. \u201cWooden box (13 kg)\u201d." }); return; }
    if (!(cap > 0)) { await pkAlert({ tone: "warn", title: "Capacity required", message: "How many kg of product does one unit hold?" }); return; }
    if (!(tare >= 0)) { await pkAlert({ tone: "warn", title: "Tare required", message: "How much does the empty unit weigh?" }); return; }
    const id = String(form.id || "").trim() || label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const appliesTo = String(form.appliesTo || "").split(",").map((x: string) => x.trim()).filter(Boolean);
    const next = [...list.filter((t: any) => t.id !== id), { id, label, capacityKg: cap, tareKg: tare, boxesPerPallet: parseFloat(form.boxesPerPallet) || 0, palletTareKg: parseFloat(form.palletTareKg) || 0, appliesTo }];
    setTypes(next); setForm(blank);
  };
  const edit = (t: any) => setForm({ id: t.id, label: t.label, capacityKg: t.capacityKg, tareKg: t.tareKg, boxesPerPallet: t.boxesPerPallet ?? "", palletTareKg: t.palletTareKg ?? "", appliesTo: (t.appliesTo || []).join(", ") });
  const del = async (t: any) => {
    if (!(await pkConfirm({ tone: "danger", title: `Remove "${t.label}"?`, message: "Shipment lines already using it keep their saved gross weight.", confirmLabel: "Remove" }))) return;
    setTypes(list.filter((x: any) => x.id !== t.id));
  };

  return (
    <div>
      {pkNode}
      <div style={{ fontSize: 12.5, color: "#555", lineHeight: 1.6, marginBottom: 14 }}>
        Gross weight on transport orders is calculated as <strong>net + (number of units x empty-unit weight)</strong>.
        Gross also includes the pallets themselves. Apples travel in wooden boxes holding 13&nbsp;kg (1.4&nbsp;kg empty, 72 to a pallet), so 19&nbsp;422&nbsp;kg net = 1&nbsp;494 boxes on 21 pallets = 22&nbsp;038.6&nbsp;kg gross.
        Set <em>applies to</em> so a product picks its packaging automatically.
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginBottom: 18 }}>
        <thead><tr style={{ background: "#F9FAFB", textAlign: "left" }}>
          <th style={{ padding: "7px 9px" }}>Packaging</th>
          <th style={{ padding: "7px 9px", textAlign: "right" }}>Holds (kg)</th>
          <th style={{ padding: "7px 9px", textAlign: "right" }}>Empty (kg)</th>
          <th style={{ padding: "7px 9px", textAlign: "right" }}>Boxes / pallet</th>
          <th style={{ padding: "7px 9px", textAlign: "right" }}>Pallet (kg)</th>
          <th style={{ padding: "7px 9px" }}>Applies to</th>
          <th style={{ padding: "7px 9px" }}></th>
        </tr></thead>
        <tbody>
          {list.map((t: any) => (
            <tr key={t.id} style={{ borderTop: "1px solid #F1F5F9" }}>
              <td style={{ padding: "7px 9px", fontWeight: 600 }}>{t.label}</td>
              <td style={{ padding: "7px 9px", textAlign: "right" }}>{t.capacityKg}</td>
              <td style={{ padding: "7px 9px", textAlign: "right" }}>{t.tareKg}</td>
              <td style={{ padding: "7px 9px", textAlign: "right" }}>{t.boxesPerPallet || "—"}</td>
              <td style={{ padding: "7px 9px", textAlign: "right" }}>{t.palletTareKg || "—"}</td>
              <td style={{ padding: "7px 9px", color: "#64748B" }}>{(t.appliesTo || []).join(", ") || "—"}</td>
              <td style={{ padding: "7px 9px", textAlign: "right", whiteSpace: "nowrap" }}>
                <SmallButton onClick={() => edit(t)}>Edit</SmallButton>{" "}
                <SmallButton kind="red" onClick={() => del(t)}>Remove</SmallButton>
              </td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={7} style={{ padding: "10px 9px", color: "#9CA3AF" }}>No packaging types yet.</td></tr>}
        </tbody>
      </table>
      <Card>
        <SectionTitle>{form.id ? "EDIT PACKAGING" : "ADD PACKAGING"}</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 2fr auto", gap: 10, alignItems: "end", marginTop: 10 }}>
          <div><Lbl>Name</Lbl><input value={form.label} onChange={e => sf("label", e.target.value)} placeholder="Wooden box (13 kg)" style={INP} /></div>
          <div><Lbl>Holds (kg)</Lbl><input type="number" value={form.capacityKg} onChange={e => sf("capacityKg", e.target.value)} placeholder="13" style={INP} /></div>
          <div><Lbl>Empty (kg)</Lbl><input type="number" value={form.tareKg} onChange={e => sf("tareKg", e.target.value)} placeholder="1.4" style={INP} /></div>
          <div><Lbl>Boxes / pallet</Lbl><input type="number" value={form.boxesPerPallet} onChange={e => sf("boxesPerPallet", e.target.value)} placeholder="72" style={INP} /></div>
          <div><Lbl>Pallet (kg)</Lbl><input type="number" value={form.palletTareKg} onChange={e => sf("palletTareKg", e.target.value)} placeholder="25" style={INP} /></div>
          <div><Lbl>Applies to (comma separated)</Lbl><input value={form.appliesTo} onChange={e => sf("appliesTo", e.target.value)} placeholder="Apples, Pears" style={INP} /></div>
          <div style={{ display: "flex", gap: 6 }}>
            <SmallButton kind="dark" onClick={save}>{form.id ? "Save" : "Add"}</SmallButton>
            {form.id ? <SmallButton onClick={() => setForm(blank)}>Cancel</SmallButton> : null}
          </div>
        </div>
      </Card>
    </div>
  );
}

function ProductCatalogPanel({ catalog, setCatalog, refStores = {} }: any) {
  const { confirm: pcConfirm, alert: pcAlert, dialogNode: pcNode } = useConfirm(); // P2-6
  const [newItem, setNewItem] = useState("");
  const [vDraft, setVDraft] = useState<Record<string, string>>({});
  const [catQuery, setCatQuery] = useState(""); // v6.63.0 (D-12) — declared with the other hooks (rules-of-hooks)
  const fileRef = useRef<HTMLInputElement>(null);
  if (!setCatalog) return null;
  // v6.63.0 (D-12, M9): filter box + rename. Renames do NOT cascade into existing
  // PO/SO lines and lots (they keep the typed name), so the dialog states exactly
  // how many document lines will keep the old name.
  const usageCount = (name: string) => {
    const eqName = (v: any) => String(v || "").trim().toLowerCase() === String(name).trim().toLowerCase();
    let n = 0;
    (refStores.pos || []).forEach((p: any) => (p.items || []).forEach((it: any) => { if (eqName(it.product)) n++; }));
    (refStores.orders || []).forEach((o: any) => (o.items || []).forEach((it: any) => { if (eqName(it.product)) n++; }));
    (refStores.lots || []).forEach((l: any) => { if (eqName(l.product)) n++; });
    return n;
  };
  const renameItem = async (item: string) => {
    const used = usageCount(item);
    const next = typeof window !== "undefined" ? window.prompt(`Rename "${item}" to:`, item) : null;
    if (!next || !String(next).trim() || String(next).trim() === item) return;
    const target = String(next).trim();
    if ((catalog || []).some((c: any) => String(c.item).toLowerCase() === target.toLowerCase())) {
      await pcAlert({ tone: "warn", title: "Name already exists", message: `"${target}" is already in the catalog. To merge two items, remove one and keep its varieties on the other.` });
      return;
    }
    const note = used > 0 ? `\n\n⚠ ${used} existing PO/SO line(s) and lot(s) keep the OLD name "${item}" — renames don't cascade into issued documents. They will show as "(not in list)" until edited.` : "";
    if (!(await pcConfirm({ tone: "warn", title: `Rename "${item}" → "${target}"?`, message: `New documents will offer "${target}".${note}`, confirmLabel: "Rename" }))) return;
    setCatalog((c: any) => renameCatalogItem(c || [], item, target));
  };
  const itemsAll = catalog || [];
  const items = catQuery.trim()
    ? itemsAll.filter((c: any) => String(c.item).toLowerCase().includes(catQuery.trim().toLowerCase())
        || (c.varieties || []).some((v: string) => String(v).toLowerCase().includes(catQuery.trim().toLowerCase())))
    : itemsAll;
  const inp: any = { border: "1px solid #E5E7EB", borderRadius: 7, padding: "7px 10px", fontSize: 13, fontFamily: "inherit", outline: "none" };

  const addItem = () => { const n = newItem.trim(); if (!n) return; setCatalog((c: any) => addCatalogItem(c || [], n)); setNewItem(""); };
  const addVar = (item: string) => { const v = (vDraft[item] || "").trim(); if (!v) return; setCatalog((c: any) => addCatalogVariety(c || [], item, v)); setVDraft(d => ({ ...d, [item]: "" })); };
  const rmVar = (item: string, v: string) => setCatalog((c: any) => removeCatalogVariety(c || [], item, v));
  const rmItem = async (item: string) => {
    const used = usageCount(item);
    const note = used > 0 ? ` ${used} existing document line(s)/lot(s) keep the name and will show "(not in list)".` : "";
    if (await pcConfirm({ tone: "danger", title: `Remove "${item}"?`, message: `This removes the item and its varieties from the catalog.${note}`, confirmLabel: "Remove" })) setCatalog((c: any) => removeCatalogItem(c || [], item));
  };

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
        if (!lines.length) { pcAlert({ tone: "warn", title: "Empty file", message: "The file contains no rows." }); return; }
        const hdr = parseLine(lines[0]).map(h => h.trim().toLowerCase());
        const ci = hdr.findIndex(h => h === "cn" || h === "hs" || h === "cncode" || h === "cn/hs" || h === "cn code" || h.includes("cn"));
        const ii = hdr.indexOf("item"), vi = hdr.indexOf("variety");
        const start = ii >= 0 ? 1 : 0;
        const rows = lines.slice(start).map(l => { const cols = parseLine(l); return { item: (ii >= 0 ? cols[ii] : cols[0] || "").trim(), variety: (vi >= 0 ? cols[vi] : cols[1] || "").trim(), cnCode: (ci >= 0 ? cols[ci] || "" : "").trim() }; }).filter(r => r.item);
        if (!rows.length) { pcAlert({ tone: "warn", title: "No rows found", message: "No Item rows found. Use columns: Item, Variety." }); return; }
        setCatalog((c: any) => mergeCatalogRows(c || [], rows));
        pcAlert({ tone: "info", title: "Imported", message: `Imported ${rows.length} row(s) into the catalog.` });
      } catch (err) { pcAlert({ tone: "warn", title: "Import failed", message: "Could not read CSV: " + (err instanceof Error ? err.message : String(err)) }); }
    };
    reader.readAsText(file);
  };
  const exportCsv = () => {
    const rows = catalogToRows(items);
    const csv = "Item,Variety,CN/HS\n" + rows.map(r => `"${r.item.replace(/"/g, '""')}","${r.variety.replace(/"/g, '""')}","${(r.cnCode || "").replace(/"/g, '""')}"`).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "product-catalog.csv"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <Card style={{ marginBottom: 16 }}>
      {pcNode}
      <SectionTitle>PRODUCT CATALOG <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "#888" }}>· Item / Variety used on PO &amp; SO lines</span></SectionTitle>
      <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
        The single list everyone picks products from, so the same item is named the same way everywhere. New products added from a PO/SO line land here too. Sizes are not part of this — size stays its own field on the line.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <input value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addItem(); }} placeholder="New item (e.g. Pears)" style={{ ...inp, minWidth: 220 }} />
        <Button variant="primary" onClick={addItem}>+ Add item</Button>
        <span style={{ flex: 1 }} />
        <Button onClick={() => fileRef.current?.click()}>Import CSV</Button>
        <Button onClick={exportCsv}>Export file (CSV)</Button>
        <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) importCsv(f); e.currentTarget.value = ""; }} />
      </div>
      <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid #F0F0F0", borderRadius: 8 }}>
        <div style={{ marginBottom: 10 }}>
          <input value={catQuery} onChange={e => setCatQuery(e.target.value)} placeholder="Filter items or varieties…" style={{ ...inp, width: "100%" }} />
        </div>
        {items.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#AAA", fontSize: 13 }}>{catQuery ? "No items match the filter." : "No items yet. Add one above or import a CSV."}</div>}
        {items.map((c: any) => (
          <div key={c.item} style={{ padding: "12px 14px", borderBottom: "1px solid #F5F5F5" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>{c.item} <span style={{ fontSize: 11, fontWeight: 400, color: "#AAA" }}>· {c.varieties.length} {c.varieties.length === 1 ? "variety" : "varieties"}</span></div>
              <input value={c.defaultCnCode || ""} onChange={e => setCatalog((cat: any) => setCatalogCnCode(cat || [], c.item, e.target.value))} placeholder="CN/HS" title="Default CN/HS customs code for this item — auto-fills new PO lines. v6.99.3: suggestions from the built-in produce table (chapter 07/08); you confirm." list="cn-suggest" style={{ ...inp, padding: "3px 8px", fontSize: 12, width: 90, marginRight: 8 }} />
              <button onClick={() => renameItem(c.item)} title="Rename item (does not cascade into issued documents)" style={{ border: "1px solid #E5E7EB", color: "#374151", background: "#fff", borderRadius: 6, fontSize: 11, padding: "3px 9px", cursor: "pointer", fontWeight: 600, marginRight: 6 }}>Rename</button>
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


// ── v6.79.0 (F-5, owner ruling): USERS & TICK-BOX PERMISSIONS ─────────────────
// Each user sees only the modules ticked; Finance P/L, client analysis and
// budgets default to the OWNER only. Convenience gate on localStorage; becomes
// row-level security on Supabase with exactly this shape.

// ─── v7.5.0 (A-ROLE-1, owner 6–7 Oct): THE ROLES — rights ticked once per role; users choose a role ────────────────
const MOD_LABEL_R: Record<string, string> = { dashboard: "Dashboard", pos: "POs", lots: "Inventory", orders: "SOs", shipments: "Shipments", loadplans: "Load plans", invoices: "Invoices", claims: "Claims", finance: "Finance", contacts: "Parties", audit: "Audit", settings: "Settings" };
function RolesPanel({ roles: savedRoles = [], setRoles: saveRoles = null, users = [], setUsers = null }: any) {
  const base = rolesOrDefault(savedRoles);
  const { draft, setDraft, bar } = useSectionDraft(base, (next: any) => {
    if (typeof saveRoles !== "function") return; saveRoles(next);
    if (typeof setUsers === "function") setUsers((users || []).map((u: any) => materializeUser(u, next)));   // users follow their role at once
  }, "roles", "Roles");
  const list: any[] = Array.isArray(draft) ? draft : base;
  const setRole = (id: string, patch: any) => setDraft(list.map((r: any) => r.id === id ? { ...r, ...patch } : r));
  if (typeof saveRoles !== "function") return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>🧩 Roles</div>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 10 }}>Tick once what each role may open; every user chooses a role below. The General Manager sees everything and manages users, roles and backups.{!(savedRoles || []).length && <b style={{ color: "#B45309" }}> These are the proposed roles — press Save to adopt them.</b>}</div>
      {list.map((r: any) => (
        <div key={r.id} style={{ borderTop: "1px solid #F1F5F9", padding: "8px 0" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 4 }}>
            <input value={r.name} onChange={e => setRole(r.id, { name: e.target.value })} style={{ border: "1px solid #E5E7EB", borderRadius: 6, padding: "4px 8px", fontSize: 12.5, fontWeight: 800, width: 180 }} />
            {r.isGM && <span style={{ fontSize: 11, color: "#15803D", fontWeight: 700 }}>sees everything</span>}
          </div>
          {!r.isGM && <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11.5 }}>
            {MODULE_KEYS.filter(k => k !== "loadplans").map(k => <label key={k} style={{ display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={!!r.modules?.[k]} onChange={e => setRole(r.id, { modules: { ...r.modules, [k]: e.target.checked } })} />{MOD_LABEL_R[k] || k}</label>)}
          </div>}
          {!r.isGM && r.modules?.finance && <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11, color: "#475569", marginTop: 4, paddingLeft: 12 }}>Finance →
            {FINANCE_KEYS.map(k => <label key={k} style={{ display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={!!r.finance?.[k]} onChange={e => setRole(r.id, { finance: { ...r.finance, [k]: e.target.checked } })} />{k}</label>)}
          </div>}
        </div>
      ))}
      <button onClick={() => { const name = window.prompt("Name of the new role:"); if (name && name.trim()) setDraft([...list, { id: `role-${Date.now().toString(36)}`, name: name.trim(), modules: { dashboard: true }, finance: {} }]); }} style={{ marginTop: 6, padding: "5px 12px", borderRadius: 7, border: "1px dashed #94A3B8", background: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Add role</button>
      {bar}
    </div>
  );
}

function UsersPanel({ users: savedUsers = [], setUsers: saveUsers = null, roles: savedRolesU = [] }: any) {
  const roleList = rolesOrDefault(savedRolesU); const [editing, setEditing] = useState<Record<string, boolean>>({});   // v7.5.1 (A-USR-8)
  // v7.2.0 (A-SET-1, owner 6 Oct): the list is edited as a DRAFT — nothing is written until "Save users", which shows what changes and
  // refuses a list that would lock anyone out. Before, every tick and letter went to the shared data at once.
  const [users, setUsers] = useState<any[]>(savedUsers || []);
  const savedJson = JSON.stringify(savedUsers || []); const dirty = JSON.stringify(users) !== savedJson;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  useEffect(() => { if (!dirtyRef.current) setUsers(savedUsers || []); }, [savedJson]);   // eslint-disable-line react-hooks/exhaustive-deps
  useUnsavedGuard({ id: "settings-users", label: "Settings → Users & permissions", draft: users, resetKey: savedJson, save: () => saveDraft() });
  // (v7.5.1: removed with the old per-user tick grid)
  const shared = isSharedMode(); const signInEmail = shared ? (readSession()?.email || "") : "";
  const problems = dirty ? usersSaveProblems(users, { shared, signInEmail }) : [];
  function saveDraft(): boolean {
    const p = usersSaveProblems(users, { shared, signInEmail }); if (p.length) { window.alert(`The users can't be saved yet:\n\n• ${p.join("\n• ")}`); return false; }
    const d = usersDiff(savedUsers || [], users); if (!d.length) return true;
    if (!window.confirm(`Save these changes to the users${shared ? " — for everyone" : ""}?\n\n${d.join("\n")}`)) return false;
    saveUsers(users); recordAudit({ module: "Settings", docType: "Users", docNumber: "users", action: "updated", summary: d.join(" · ").slice(0, 900) }); return true;
  }
  if (typeof saveUsers !== "function") return null;
  // (v7.5.1: removed with the old per-user tick grid)
  // (v7.5.1: removed with the old per-user tick grid)
  const gaps = usersGaps(users);
  // (v7.5.1: removed with the old per-user tick grid)
  return (
    <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>👥 Users & permissions</div>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 10 }}>Tick what each user may open. With no users defined everyone sees everything; the first user should be the owner. The user is recognised by the name entered in Settings → "Your name".</div>
      {gaps.map((g, i) => <div key={i} style={{ fontSize: 11.5, color: "#B45309", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, padding: "5px 9px", marginBottom: 6 }}>{g}</div>)}
      {/* v7.5.1 (A-USR-8, owner 6 Oct): each user is a row — name · role (from the Roles above) · sign-in e-mail — read-only once saved, Edit unlocks it */}
      <button onClick={() => { const id = mintId(); setUsers((prev: any[]) => [...(prev || []), { id, name: "", roleId: "", email: "", isOwner: false, modules: { dashboard: true }, finance: {} }]); setEditing(e => ({ ...e, [String(id)]: true })); }} style={{ marginBottom: 10, padding: "6px 14px", borderRadius: 8, border: "none", background: "#111", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>+ Add user</button>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 1.6fr 1.4fr 150px", gap: 8, padding: "6px 0", fontSize: 10.5, fontWeight: 700, color: "#94A3B8", letterSpacing: "0.05em" }}><div>NAME</div><div>ROLE</div><div>SIGN-IN E-MAIL</div><div>RIGHTS</div><div /></div>
      {(users || []).map((u: any) => { const ed = !!editing[String(u.id)]; const inp: any = { border: "1px solid #E5E7EB", borderRadius: 6, padding: "5px 8px", fontSize: 12.5, width: "100%", boxSizing: "border-box" };
        const upd = (patch: any) => setUsers((prev: any[]) => (prev || []).map((x: any) => x.id === u.id ? materializeUser({ ...x, ...patch }, roleList) : x));
        return (
        <div key={String(u.id)} style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 1.6fr 1.4fr 150px", gap: 8, padding: "8px 0", borderTop: "1px solid #F1F5F9", alignItems: "center", fontSize: 12.5, background: ed ? "#FFFBEB" : "transparent" }}>
          {ed ? <input value={u.name || ""} placeholder="full name" onChange={e => upd({ name: e.target.value })} style={inp} /> : <div style={{ fontWeight: 800 }}>{u.name || "—"}{u.isOwner ? <span style={{ color: "#15803D", fontWeight: 700 }}> · GM</span> : null}</div>}
          {ed ? <select value={u.roleId || ""} onChange={e => upd({ roleId: e.target.value })} style={inp}><option value="">choose a role…</option>{roleList.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select> : <div style={{ color: u.roleId ? "#111" : "#B45309" }}>{(roleList.find((r: any) => String(r.id) === String(u.roleId)) || {} as any).name || (u.role ? `${u.role} (choose a role)` : "no role")}</div>}
          {ed ? <input value={u.email || ""} placeholder="the e-mail they sign in with" onChange={e => upd({ email: e.target.value.trim() })} style={inp} /> : <div style={{ color: u.email ? "#334155" : "#B45309" }}>{u.email || "not linked"}</div>}
          <div style={{ fontSize: 11.5, color: "#475569" }}>{rightsSummary(u, roleList)}
            {ed && u.roleId && <details style={{ marginTop: 4 }}><summary style={{ cursor: "pointer", color: "#64748B" }}>extra modules for this person</summary>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>{MODULE_KEYS.filter(k => k !== "loadplans" && !((roleList.find((r: any) => String(r.id) === String(u.roleId)) || {} as any).modules || {})[k]).map(k => <label key={k} style={{ display: "flex", gap: 3, alignItems: "center" }}><input type="checkbox" checked={(u.extraModules || []).includes(k)} onChange={e => upd({ extraModules: e.target.checked ? [...(u.extraModules || []), k] : (u.extraModules || []).filter((x: string) => x !== k) })} />{k}</label>)}</div></details>}
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button onClick={() => setEditing(e => ({ ...e, [String(u.id)]: !ed }))} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{ed ? "Done" : "Edit"}</button>
            <button onClick={() => { if (window.confirm(`Remove ${u.name || "this user"} from the list? (Nothing changes until Save users.)`)) setUsers((prev: any[]) => (prev || []).filter((x: any) => x.id !== u.id)); }} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #FECACA", background: "#fff", color: "#DC2626", fontSize: 12, cursor: "pointer" }}>Remove</button>
          </div>
        </div>); })}
      {/* v7.2.0 (A-SET-1): nothing is written until Save; the bar says what is pending and why a save is refused */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #F1F5F9", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button disabled={!dirty} onClick={() => saveDraft()} style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: dirty ? (problems.length ? "#B45309" : "#16A34A") : "#E5E7EB", color: dirty ? "#fff" : "#94A3B8", fontSize: 12.5, fontWeight: 800, cursor: dirty ? "pointer" : "default" }}>Save users</button>
        <button disabled={!dirty} onClick={() => { if (window.confirm("Discard the changes to the users?")) setUsers(savedUsers || []); }} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", color: dirty ? "#111" : "#94A3B8", fontSize: 12.5, fontWeight: 700, cursor: dirty ? "pointer" : "default" }}>Cancel</button>
        {dirty ? <span style={{ fontSize: 11.5, color: problems.length ? "#B45309" : "#475569", fontWeight: 600 }}>{problems.length ? `Not savable yet: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}` : `${usersDiff(savedUsers || [], users).length} change(s) not saved yet`}</span> : <span style={{ fontSize: 11.5, color: "#94A3B8" }}>no unsaved changes</span>}
      </div>
    </div>
  );
}


// ── v6.89.0: DEFECT CATALOGUE (per product · category · defect) — drives the inspection form ──
// v6.99.33 (owner): the defect catalogue panel retired — the producer's defect list is part of the quality report's definition
// (seasonOps.domain PEPPER_DEFECTS) and the tolerances travel on each report. Nothing about quality is configured here any more.


// ── v6.99.0 (FN-7): REFERENCE FX RATES — the season's rates, set by the owner; documents still lock their own rate ──
function FxSettingsPanel({ fxSettings = {}, setFxSettings = null }: any) {
  if (typeof setFxSettings !== "function") return null;
  const inp: any = { border: "1px solid #E5E7EB", borderRadius: 6, padding: "5px 8px", fontSize: 12, width: 110 };
  return (
    <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>💱 Reference FX rates (PLN per unit){fxSettings?._nbp ? <span style={{ fontSize: 11, fontWeight: 500, color: "#16A34A", marginLeft: 8 }}>NBP table A of {String(fxSettings._nbp).replace(/(\d{4})(\d{2})(\d{2})/, "$3/$2/$1")} loaded</span> : <span style={{ fontSize: 11, fontWeight: 500, color: "#B45309", marginLeft: 8 }}>NBP not reachable — built-in seed until you type a rate</span>}</div>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>Used only to PRE-FILL a new document's rate. Every document locks its own rate; the truck settlement uses its own. Blank = the built-in seed.</div>
      <div style={{ display: "flex", gap: 14 }}>{["EUR", "USD", "GBP"].map(c => <label key={c} style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>{c}<input type="number" step="0.0001" value={fxSettings?.[c] ?? ""} onChange={e => setFxSettings((prev: any) => ({ ...(prev || {}), [c]: e.target.value }))} style={inp} /></label>)}</div>
    </div>
  );
}


// ── v6.99.3 (SE-1): COMPANY — identity printed on every document; default bank account per currency ──

// ─── v7.2.1 (A-SET-1): the same explicit Save for the other sections that change identity or numbering ──────────────────
function useSectionDraft(saved: any, save: ((v: any) => void) | null, id: string, label: string) {
  const savedJson = JSON.stringify(saved ?? {}); const [draft, setDraft] = useState<any>(saved ?? {});
  const dirty = JSON.stringify(draft) !== savedJson; const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  useEffect(() => { if (!dirtyRef.current) setDraft(saved ?? {}); }, [savedJson]);   // eslint-disable-line react-hooks/exhaustive-deps
  const doSave = () => { if (!dirty || typeof save !== "function") return true; const keys = Array.from(new Set([...Object.keys(saved || {}), ...Object.keys(draft || {})])).filter(k => JSON.stringify((saved || {})[k]) !== JSON.stringify((draft || {})[k]));
    if (!window.confirm(`Save ${label}${isSharedMode() ? " — for everyone" : ""}?\n\n${keys.map(k => `${k}: ${JSON.stringify((saved || {})[k] ?? "")} → ${JSON.stringify((draft || {})[k] ?? "")}`).join("\n")}`)) return false;
    save(draft); recordAudit({ module: "Settings", docType: label, docNumber: id, action: "updated", summary: keys.join(", ") }); return true; };
  useUnsavedGuard({ id: `settings-${id}`, label: `Settings → ${label}`, draft, resetKey: savedJson, save: doSave });
  const bar = (
    <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
      <button disabled={!dirty} onClick={() => doSave()} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: dirty ? "#16A34A" : "#E5E7EB", color: dirty ? "#fff" : "#94A3B8", fontSize: 12, fontWeight: 800, cursor: dirty ? "pointer" : "default" }}>Save</button>
      <button disabled={!dirty} onClick={() => setDraft(saved ?? {})} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", color: dirty ? "#111" : "#94A3B8", fontSize: 12, fontWeight: 700, cursor: dirty ? "pointer" : "default" }}>Cancel</button>
      <span style={{ fontSize: 11.5, color: dirty ? "#475569" : "#94A3B8" }}>{dirty ? "changes not saved yet" : "no unsaved changes"}</span>
    </div>);
  return { draft, setDraft, bar };
}

function CompanyPanel({ company: savedCompany = {}, setCompany: saveCompany = null }: any) {
  const { draft: company, setDraft: setCompany, bar } = useSectionDraft(savedCompany, saveCompany, "company", "Company information");   // v7.2.1
  if (typeof saveCompany !== "function") return null;
  const inp: any = { border: "1px solid #E5E7EB", borderRadius: 7, padding: "7px 10px", fontSize: 12.5, width: "100%", boxSizing: "border-box" };
  const set = (k: string, v: any) => setCompany((prev: any) => ({ ...(prev || {}), [k]: v }));
  return (
    <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>🏢 Company</div>
      <datalist id="cn-suggest">{CN_CODES.map(c => <option key={c.code} value={c.code}>{c.description}</option>)}</datalist>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>Marianna's identity as printed on transport orders, protocols, statements and reports. Blank fields fall back to the built-in details.</div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
        <input placeholder="Legal name" value={company.name || ""} onChange={e => set("name", e.target.value)} style={inp} />
        <input placeholder="NIP" value={company.nip || ""} onChange={e => set("nip", e.target.value)} style={inp} />
        <input placeholder="Phone" value={company.phone || ""} onChange={e => set("phone", e.target.value)} style={inp} />
        <input placeholder="Address" value={company.address || ""} onChange={e => set("address", e.target.value)} style={{ ...inp, gridColumn: "1 / 3" }} />
        <input placeholder="E-mail" value={company.email || ""} onChange={e => set("email", e.target.value)} style={inp} />
      </div>
      {/* v7.2.2 (A-SET-2, owner): "default bank account per currency" removed — nothing read it (the push uses the Invoices module's own default); this section is the company block printed on documents */}
      {bar}{/* v7.2.1 (A-SET-1) */}
    </div>
  );
}
// ── v6.99.3 (SE-3): NUMBERING — prefixes per document type; the DDL replaces the year-scan with sequences ──
function NumberingPanel({ numbering: savedNumbering = {}, setNumbering: saveNumbering = null }: any) {
  const { draft: numbering, setDraft: setNumbering, bar } = useSectionDraft(savedNumbering, saveNumbering, "numbering", "Numbering");   // v7.2.1
  if (typeof saveNumbering !== "function") return null;
  const kinds = [["PO", "Purchase order"], ["SO", "Sales order"], ["SHP", "Shipment"], ["LOT", "Lot"], ["CLM", "Claim"], ["LP", "Loading protocol"], ["SET", "Settlement"]];
  return (
    <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>🔢 Numbering</div>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>Prefix per document type — numbers are PREFIX-YYYY-NNNN, sequence resets each year. Existing documents keep their numbers. On Supabase the sequence is issued by the database (no collisions across browsers).</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{kinds.map(([k, label]) => <label key={k} style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>{label}<input value={numbering?.[k] ?? k} onChange={e => setNumbering((prev: any) => ({ ...(prev || {}), [k]: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || k }))} style={{ border: "1px solid #E5E7EB", borderRadius: 6, padding: "5px 8px", fontSize: 12, width: 70, fontFamily: "ui-monospace, Menlo, monospace" }} /></label>)}</div>
      {bar}{/* v7.2.1 (A-SET-1) */}
    </div>
  );
}


// ─── v7.0.0 (A-SH-1): in SHARED mode a whole-copy change is deliberate — the current shared copy is downloaded first, then the
// stores are replaced in Supabase (new versions) so every colleague's tab takes them; in single-browser mode nothing changes.
async function pushStoresToShared(keys: string[], what: string): Promise<string> {
  const json = await sharedCopyAsExport(APP_VERSION, STORAGE_VERSION);
  const blob = new Blob([json], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `marianna-shared-copy-before-${what.replace(/\s+/g, "-")}-${localTodayISO()}.json`; document.body.appendChild(a); a.click(); a.remove();
  const stores: Record<string, any> = {}; keys.forEach(k => { stores[k] = readStoreValue(k); });
  const n = await replaceSharedStores(stores, readSession()?.email || "");
  return `${n} store(s) replaced in the shared data${ENV_LABEL ? ` (${ENV_LABEL})` : ""}; the shared copy as it was is in your downloads`;
}
export default function Settings({ roles = [], setRoles = null,
  reloadFromStorage,
  refStores = {},
  repairInventory = () => null,
  userRole,
  setUserRole,
  userName,
  setUserName,
  productCatalog = [],
  setProductCatalog,
  packagingTypes = [],
  setPackagingTypes,
  users = [],
  setUsers = null,
  fxSettings = {},
  setFxSettings = null,
  company = {},
  setCompany = null,
  numbering = {},
  setNumbering = null,
  seasonSettings = null,
  setSeasonSettings = null,
  archivedSeasons = [],
  setArchivedSeasons = null,
}: {
  roles?: any[]; setRoles?: any;   // v7.5.0
  reloadFromStorage: () => void;
  refStores?: any;
  repairInventory?: () => any;
  userRole?: string;
  setUserRole?: (r: string) => void;
  userName?: string;
  setUserName?: (n: string) => void;
  productCatalog?: any[];
  setProductCatalog?: (v: any) => void;
  packagingTypes?: any[];
  setPackagingTypes?: (v: any) => void;
  users?: any[];
  setUsers?: any;
  fxSettings?: any;
  setFxSettings?: any;
  company?: any;
  setCompany?: any;
  numbering?: any;
  setNumbering?: any;
  seasonSettings?: any;
  setSeasonSettings?: any;
  archivedSeasons?: string[];
  setArchivedSeasons?: any;
}) {
  const { confirm: stConfirm, dialogNode: stNode } = useConfirm(); // P2-6
  const [manage, setManage] = React.useState<null | "products" | "locations" | "packaging">(null); // v6.38.0 (R1-C)
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
  const [fktDepts, setFktDepts] = useState<any[]>(() => {
    try { return JSON.parse(window.localStorage.getItem("marianna-erp:fktDepartments") || "[]"); } catch { return []; }
  });
  const [fktDeptDefaults, setFktDeptDefaults] = useState<Record<string, any>>(() => {
    try { return JSON.parse(window.localStorage.getItem("marianna-erp:fktDepartmentDefaults") || "{}"); } catch { return {}; }
  });
  async function handleFktDepartments() {
    const cfg = readFakturowniaConfig();
    if (!cfg) { setFktMsg({ kind: "error", text: "Save the account and token first." }); return; }
    setFktBusy(true);
    const r = await fetchDepartments(cfg);
    setFktBusy(false);
    if (!r.ok) { setFktMsg({ kind: "error", text: r.corsLikely ? "The browser blocked the call. This needs the backend." : (r.error || "Fakturownia did not answer.") }); return; }
    const mapped = mapDepartments(r.data || []);
    setFktDepts(mapped);
    try { window.localStorage.setItem("marianna-erp:fktDepartments", JSON.stringify(mapped)); } catch {}
    setFktMsg({ kind: "success", text: `${mapped.length} bank account(s) read. Set a default for each currency you invoice in.` });
  }
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
  const [showRecovery, setShowRecovery] = useState(false);   // v7.4.2 (A-REC-1)

  function handleExport() {
    try {
      downloadAllData();   // v6.99.70 (A-BK): one routine for Export and the daily download; either counts as today's backup
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
    reader.onload = async () => {
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
      const proceed = await stConfirm({
        tone: "danger",
        title: "Replace all data?",
        message: "Import will REPLACE all data currently in this browser with the contents of this file.\n\nThere is no merge — anything here that isn't in the file will be gone.\n\nA backup of your current data will be saved automatically first, so you can undo it from Settings → Local backups." + versionWarn,
        confirmLabel: "Replace & import", cancelLabel: "Cancel",
      });
      if (!proceed) { setMessage({ kind: "info", text: "Import cancelled — nothing was changed." }); return; }
      await flushFolderBackup();   // v6.99.70 (A-BK): the folder gets the state before the overwrite
      // v7.0.0 (A-SH-1): in shared mode a backup is restored INTO the shared copy, for everyone — counted, typed, the old copy downloaded first
      if (isSharedMode()) {
        { const meU = userBySignIn(users || [], readSession()?.email); if (!meU || !meU.isOwner) { setMessage({ kind: "error", text: "Only the owner can restore a backup into the shared data." }); return; } }   // v7.2.4 (A-SET-4)
        let parsed: any; try { parsed = storesFromExport(result); } catch (x: any) { setMessage({ kind: "error", text: String(x?.message || x) }); return; }
        const word = window.prompt(`RESTORE this file into the SHARED data${ENV_LABEL ? ` (${ENV_LABEL})` : ""} — for everyone?\n\nFile: ${file.name}\nExported: ${String(parsed.meta?.exportedAt || "?").replace("T", " ").slice(0, 16)}, app ${parsed.meta?.appVersion || "?"}\nIt holds: ${parsed.summary}\n\nEvery colleague's screen will show this data. The shared copy as it is now will be downloaded first.\n\nType RESTORE to go ahead:`);
        if (String(word || "").trim().toUpperCase() !== "RESTORE") { setMessage({ kind: "info", text: "Restore not done (the confirmation word was not typed)." }); return; }
        try {
          const json = await sharedCopyAsExport(APP_VERSION, STORAGE_VERSION); const blob = new Blob([json], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `marianna-shared-copy-before-restore-${localTodayISO()}.json`; document.body.appendChild(a); a.click(); a.remove();
          const n = await replaceSharedStores(parsed.stores, readSession()?.email || ""); recordAudit({ module: "System", docType: "Restore", docNumber: file.name, action: "updated", summary: `Shared data restored from ${file.name} (${parsed.summary}); ${n} stores replaced` });
          setMessage({ kind: "success", text: `Restored into the shared data: ${n} stores from ${file.name}. Reloading…` }); setTimeout(() => window.location.reload(), 1400);
        } catch (x: any) { setMessage({ kind: "error", text: `Restore failed: ${String(x?.message || x)}` }); }
        return;
      }
      const outcome = importAllData(result);
      if (!outcome.ok) {
        setMessage({ kind: "error", text: outcome.error || "Import failed." });
        return;
      }
      refreshBackups();
      const loadedDesc = (outcome.loaded || []).join(", ") || "no recognized data";
      const clearedNote = (outcome.cleared || []).length ? ` Stores absent from the file were cleared so no stale documents survive: ${(outcome.cleared || []).join(", ")}.` : "";
      const backupNote = outcome.backup ? " A backup of your previous data was saved (Settings → Local backups)." : "";
      setMessage({ kind: "success", text: `Imported: ${loadedDesc}.${clearedNote}${backupNote} Reloading…` });
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

  async function handleRestore(b: BackupMeta) {
    if (!(await stConfirm({ tone: "danger", title: "Restore this backup?", message: `From ${new Date(b.createdAt).toLocaleString()}.\n\nThis REPLACES current data. Your current data will itself be backed up first, so this is reversible.`, confirmLabel: "Restore" }))) return;
    await flushFolderBackup();   // v6.99.70 (A-BK)
    const outcome = restoreBackup(b.id);
    if (!outcome.ok) { setMessage({ kind: "error", text: outcome.error || "Restore failed." }); return; }
    setMessage({ kind: "success", text: "Backup restored. Reloading…" });
    setTimeout(() => window.location.reload(), 1200);
  }

  async function handleDeleteBackup(b: BackupMeta) {
    if (!(await stConfirm({ tone: "danger", title: "Delete backup?", message: "Delete this backup permanently?", confirmLabel: "Delete" }))) return;
    deleteBackup(b.id);
    refreshBackups();
  }



  // v6.99.51 (A-FS-1, owner): keep the master data, clear the season's documents together
  async function handleFreshSeason() {
    const counts = transactionalCounts();
    const list = counts.map(c => `${c.key}: ${c.count}`).join(" · ") || "nothing to clear";
    const confirmed = await stConfirm({ tone: "danger", title: "Wipe every document, keep the master data?",
      message: `KEEPS: counterparties, places, countries, packaging, product catalogue, users, company, FX settings, bank accounts.\nCLEARS, all together: ${list}.\nA backup is saved first.`,
      confirmLabel: "Wipe the documents", cancelLabel: "Keep everything" });
    if (!confirmed) return;
    const resetNo = await stConfirm({ tone: "info", title: "Reset the numbering?", message: "Start PO / SO / SHP / LOT numbers again from 0001 for the new season? (Choose No to continue the sequence.)", confirmLabel: "Yes, restart at 0001", cancelLabel: "No, continue" });
    await flushFolderBackup();   // v6.99.70 (A-BK)
    if (isSharedMode() && !isTestCopy()) return;   // v7.0.0: never on the real shared copy (the button is not shown there)
    const backup = startFreshSeason({ resetNumbering: !!resetNo });
    if (isSharedMode() && isTestCopy()) { try { const note = await pushStoresToShared(DATA_KEYS.slice(), "fresh-season"); setMessage({ kind: "info", text: `TEST data wiped (master data kept) — ${note}. Reloading…` }); setTimeout(() => window.location.reload(), 1400); return; } catch (x: any) { setMessage({ kind: "error", text: String(x?.message || x) }); return; } }
    refreshBackups();
    setMessage({ kind: "info", text: `Fresh season started${backup ? " (a backup was saved first)" : ""} — master data kept. Reloading…` });
    setTimeout(() => window.location.reload(), 1000);
  }
  async function handleReset() {
    const confirmed = await stConfirm({
      tone: "danger",
      title: "Start fresh — clear ALL data?",
      message: "This wipes contacts, POs, lots, sales orders, shipments, operational costs, credit notes and logistics points, returning the system to a completely empty state.\n\nA backup will be saved automatically first, so you can undo this from Settings → Local backups.",
      confirmLabel: "Clear all data", cancelLabel: "Keep my data",
    });
    if (!confirmed) return;
    await flushFolderBackup();   // v6.99.70 (A-BK)
    if (isSharedMode() && !isTestCopy()) return;   // v7.0.0: never on the real shared copy (the button is not shown there)
    const backup = clearAllData();
    if (isSharedMode() && isTestCopy()) { try { const note = await pushStoresToShared(DATA_KEYS.slice(), "start-fresh"); setMessage({ kind: "info", text: `TEST data erased — ${note}. Reloading…` }); setTimeout(() => window.location.reload(), 1400); return; } catch (x: any) { setMessage({ kind: "error", text: String(x?.message || x) }); return; } }
    refreshBackups();
    setMessage({ kind: "info", text: `All data cleared${backup ? " (a backup was saved first)" : ""}. Reloading to an empty system…` });
    setTimeout(() => window.location.reload(), 1000);
  }

  return (
    <ModulePage title="Settings" right={<span style={{ fontSize: 11, color: "#AAA" }}>storage schema v{STORAGE_VERSION}</span>}>   {/* v6.99.61 (A-HD-1): shared header; the form column stays narrow */}
      {stNode}
      <div style={{ maxWidth: 800, margin: "0 auto" }}>

        {/* Batch 5: storage usage — the one number that predicts the localStorage failure mode. */}
        {(() => {
          const u = storageUsage();
          const warn = u.pct >= 70;
          return (
            <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 10, border: `1px solid ${warn ? "#FDE68A" : "#E5E7EB"}`, background: warn ? "#FFFBEB" : "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#444" }}>Browser storage used</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: warn ? "#B45309" : "#16A34A" }}>{u.totalKB.toLocaleString()} KB / ~{(u.budgetKB / 1024).toFixed(0)} MB ({u.pct}%)</div>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: "#F1F5F9", overflow: "hidden" }}>
                <div style={{ width: `${u.pct}%`, height: "100%", background: warn ? "#D97706" : "#16A34A" }} />
              </div>
              <div style={{ fontSize: 10.5, color: "#94A3B8", marginTop: 6 }}>
                Largest: {u.perKey.slice(0, 4).map(k => `${k.key} ${k.kb} KB`).join(" · ") || "—"}
                {warn ? " — consider deleting old local backups below to free space." : ""}
              </div>
            </div>
          );
        })()}

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

        {!isSharedMode() && (   /* v7.5.2 (A-ROLE-1): on the shared data who you are = your sign-in, what you may do = your role — no per-browser user & role */
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle>CURRENT USER &amp; ROLE</SectionTitle>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
            Your role controls who can see Sales Order profitability (P/L). Assistant and Operations don't see P/L at all; Sales sees P/L only for orders they created; Financial Director and General Manager see all P/L. (No login yet — this is a simple switch for testing.)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {/* v7.7.1 (A-RET-1): the per-browser role is retired — what a person may do comes from their role in Users */}
            {isSharedMode() ? (
              <div>{/* v7.1.0 (A-USR-1): on the shared data the sign-in decides — nothing to type */}
                <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>You are signed in as</label>
                <div style={{ fontSize: 13 }}>{readSession()?.email || "—"}{(() => { const u = userBySignIn(users || [], readSession()?.email); return u ? ` → ${u.name}${u.isOwner ? " (owner)" : ""}` : " — not in the Users list yet: add this e-mail to your entry below"; })()}</div>
              </div>
            ) : (
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>Your name (used to tag SOs you create)</label>
              <input
                value={userName || ""}
                onChange={e => setUserName && setUserName(e.target.value)}
                placeholder="e.g. Anna (sales)"
                style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, background: "#fff" }}
              />
            </div>
            )}
          </div>
        </Card>
        )}

        {/* v6.99.14 (owner): CONFIGURATION lives on the main page — nothing hidden inside another editor */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em", margin: "18px 0 10px" }}>CONFIGURATION</div>
        <CompanyPanel company={company} setCompany={setCompany} />
        <FxSettingsPanel fxSettings={fxSettings} setFxSettings={setFxSettings} />
        <NumberingPanel numbering={numbering} setNumbering={setNumbering} />
        <RolesPanel roles={roles} setRoles={setRoles} users={users} setUsers={setUsers} />{/* v7.5.0 (A-ROLE-1) */}
        <UsersPanel users={users} setUsers={setUsers} roles={roles} />

        {/* v6.38.0 (R1-C): reference data opens in dedicated editor windows */}
        <ManageCard
          title="PRODUCT CATALOG"
          summary={`${(productCatalog || []).length} item${(productCatalog || []).length === 1 ? "" : "s"} · ${(productCatalog || []).reduce((n: number, it: any) => n + ((it.varieties || []).length), 0)} varieties · controls the Item/Variety pickers and CN codes`}
          buttonLabel="Manage products…"
          onManage={() => setManage("products")}
        />
        {/* v7.2.3 (A-SET-3, owner): the Locations card is gone — Counterparties → Places is the one place to edit them (rule 7) */}
        <ManageCard
          title="PACKAGING TYPES — capacity, tare, boxes per pallet, pallet tare (feeds gross weight, pallet tables, kg per box)"
          summary={`${(packagingTypes || []).length} type${(packagingTypes || []).length === 1 ? "" : "s"} · box capacity + empty weight drive the gross weight printed on transport orders`}
          buttonLabel="Manage packaging…"
          onManage={() => setManage("packaging")}
        />
        {manage === "packaging" && (
          <FullScreenModal title="Packaging types" onClose={() => setManage(null)}>
            <PackagingPanel types={packagingTypes} setTypes={setPackagingTypes} />
          </FullScreenModal>
        )}
        {manage === "products" && (
          <FullScreenModal title="Product catalog" onClose={() => setManage(null)}>
            <ProductCatalogPanel catalog={productCatalog} setCatalog={setProductCatalog}  refStores={refStores} />
          </FullScreenModal>
        )}
        {manage === "locations" && (
          <FullScreenModal title="Ports & locations" onClose={() => setManage(null)}>
            <LocationsPanel refStores={refStores} />
          </FullScreenModal>
        )}

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

          {/* v6.75.0 BANK ACCOUNTS. Fakturownia holds each bank account as a
              "department". This account has several per currency, and until now
              every pushed invoice took whichever one Fakturownia treats as its
              main — so a PLN or USD invoice printed a EUR account number to the
              client. Set a default per currency and an invoice never has to ask. */}
          <div style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Bank accounts (Fakturownia departments)</div>
            <div style={{ fontSize: 11, color: "#64748B", lineHeight: 1.5, marginBottom: 8 }}>
              Each account issues in one currency. Choose which one an invoice should carry for each currency you invoice in — a wrong account number on a document that has reached KSeF can only be corrected by issuing another one.
            </div>
            {!fktDepts.length && <div style={{ fontSize: 11.5, color: "#94A3B8", marginBottom: 8 }}>No accounts loaded yet — read them from Fakturownia.</div>}
            {/* v6.76.0: every account listed with its bank number, and its
                currency SET BY HAND where it could not be read. Parsing a label
                is guesswork; seven rows set once is not. */}
            {fktDepts.length > 0 && <div style={{ marginBottom: 10 }}>
              {fktDepts.map((d: any) => (
                <div key={d.id} style={{ display: "grid", gridTemplateColumns: "1fr 150px 80px", gap: 8, alignItems: "center", marginBottom: 4, fontSize: 11.5 }}>
                  <div><strong>{d.name}</strong>{d.taxNo ? <span style={{ color: "#94A3B8" }}> · {d.taxNo}</span> : null}</div>
                  <div style={{ color: "#64748B", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis" }} title={d.bankAccount}>{d.bankAccount || "—"}</div>
                  <select value={d.currency || ""} onChange={e => {
                      const next = fktDepts.map((x: any) => x.id === d.id ? { ...x, currency: e.target.value } : x);
                      setFktDepts(next);
                      try { window.localStorage.setItem("marianna-erp:fktDepartments", JSON.stringify(next)); } catch {}
                    }} style={{ border: `1px solid ${d.currency ? "#E5E7EB" : "#FCA5A5"}`, borderRadius: 6, padding: "4px 6px", fontSize: 11.5 }}>
                    <option value="">— set —</option>
                    {["PLN", "EUR", "USD", "GBP", "CHF"].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              ))}
            </div>}
            {Array.from(new Set(fktDepts.map((d: any) => d.currency).filter(Boolean))).sort().map((cur: any) => (
              <div key={cur} style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 8, alignItems: "center", marginBottom: 5 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{cur}</div>
                <select value={fktDeptDefaults[cur] ?? ""} onChange={e => { const m = { ...fktDeptDefaults, [cur]: e.target.value }; setFktDeptDefaults(m); try { window.localStorage.setItem("marianna-erp:fktDepartmentDefaults", JSON.stringify(m)); } catch {} }}
                  style={{ border: "1px solid #E5E7EB", borderRadius: 6, padding: "6px 8px", fontSize: 12.5 }}>
                  <option value="">— ask each time —</option>
                  {fktDepts.filter((d: any) => d.currency === cur).map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}{d.bankAccount ? ` · …${String(d.bankAccount).slice(-6)}` : ""}</option>
                  ))}
                </select>
              </div>
            ))}
            <Button onClick={handleFktDepartments} disabled={fktBusy}>Read bank accounts from Fakturownia</Button>
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

        {/* v7.2.4 (A-SET-4, owner): on the shared data this RESTORES a backup into the shared data for everyone — the owner only */}
        {isSharedMode() && !(() => { const me = userBySignIn(users || [], readSession()?.email); return !!(me && me.isOwner); })() ? (
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>RESTORE A BACKUP INTO THE SHARED DATA</SectionTitle>
            <div style={{ fontSize: 13, color: "#64748B", lineHeight: 1.55 }}>Only the owner can restore a backup — it replaces the shared data for everyone.</div>
          </Card>
        ) : isSharedMode() ? (<>
          {/* v7.4.2 (A-REC-1): record-by-record recovery first — the full replace stays below for a real disaster */}
          <Card style={{ marginBottom: 16, borderLeft: "3px solid #16A34A" }}>
            <SectionTitle>RECOVER FROM A BACKUP</SectionTitle>
            <div style={{ fontSize: 13, color: "#444", marginBottom: 12, lineHeight: 1.55 }}>Bring back lost or damaged records from a backup file or a Supabase snapshot — you see what is missing or different, tick what to bring back, and each record returns with what it needs (its company, its place, its PO…). <strong>Nothing that exists now is removed.</strong></div>
            <Button variant="primary" onClick={() => setShowRecovery(true)}>Recover from a backup…</Button>
            {showRecovery && <RecoveryPanel onClose={() => setShowRecovery(false)} />}
          </Card>
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>RESTORE A BACKUP INTO THE SHARED DATA</SectionTitle>
            <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
              Choose a backup file (from the automatic backup folder or an export). It <strong>replaces the shared data for everyone</strong>: you see the file's date and counts first, type RESTORE to confirm, and the shared data as it is now is downloaded before anything changes.
            </div>
            <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={handleFileSelected} style={{ display: "none" }} />
            <Button onClick={handleImportClick}>📤 Choose the backup file…</Button>
          </Card>
        </>
        ) : (
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle>IMPORT</SectionTitle>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
            Load a colleague's exported JSON file. <strong>This replaces all your current data — there is no merge.</strong> A backup of your current data is saved automatically first, so you can undo it from Local backups below. The file must come from the same app version (v{APP_VERSION}).
          </div>
          <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={handleFileSelected} style={{ display: "none" }} />
          <Button onClick={handleImportClick}>📤 Choose JSON file to import...</Button>
        </Card>
        )}

        <AutoBackupCard />

        {/* v7.2.5 (A-SET-5, owner): on the shared data no local snapshots are taken — only the old ones can be deleted, after checking the folder backup */}
        {/* v7.3.1 (A-SET-6, owner 7 Oct): no snapshots card on the shared data — each browser deletes its old snapshots by itself after a folder backup */}
        {isSharedMode() ? null : (
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle>LOCAL BACKUPS</SectionTitle>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
            Snapshots taken before each import, restore or wipe, kept in this browser as long as there is room — they may use up to 70 % of the browser storage together with your data, and when the data needs the space the oldest snapshot gives way first. Use one to undo an overwrite. They stay on this computer; the backup folder above is the copy that leaves it.
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
                  <SmallButton kind="delete" title="Delete this backup" onClick={() => handleDeleteBackup(b)}>Delete</SmallButton>
                </div>
              ))}
            </div>
          )}
        </Card>
        )}

        {/* v6.51.1: a manual repair, so a data fix is never at the mercy of an
            automatic trigger firing at the right moment. Safe to press at any time —
            the repair only changes records that are genuinely wrong, and pressing it
            twice changes nothing the second time. */}
        {/* v6.86.0 (owner ruling): "Repair inventory records" retired — a one-time August repair, already applied and
            covered by tests. The routine (healRound651) stays in the migration toolkit for the Supabase import. */}

        <SeasonsPanel refStores={refStores} seasonSettings={seasonSettings} setSeasonSettings={setSeasonSettings} archivedSeasons={archivedSeasons} setArchivedSeasons={setArchivedSeasons} stConfirm={stConfirm} setMessage={setMessage} />
        {/* v7.0.0 (A-SH-1, owner 6 Oct): on the REAL shared copy nobody can erase the business's data from a button; on the TEST copy the
            two buttons act on the shared test data for everyone testing; in single-browser mode they work as before */}
        {isSharedMode() && !isTestCopy() ? (
          <Card style={{ marginBottom: 16, borderLeft: "3px solid #94A3B8" }}>
            <SectionTitle>RESET</SectionTitle>
            <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.5 }}>Erasing is not available on the shared data — everyone works on it. To go back to an earlier state, <b>Import</b> a backup above: it is restored into the shared data after a typed confirmation, and the shared copy as it was is downloaded first. To try things out, use the TEST copy.</div>
          </Card>
        ) : (
        <Card style={{ marginBottom: 16, borderLeft: "3px solid #DC2626" }}>
          <SectionTitle>RESET{isSharedMode() && isTestCopy() ? " — acts on the shared TEST data, for everyone testing" : ""}</SectionTitle>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
            Erase everything you've entered and return the system to a completely empty state. Use this if you've made test data unusable and want to start fresh. A backup is saved automatically first (see Local backups).
          </div>
          <Button onClick={handleFreshSeason} variant="danger" title="v6.99.51: keeps the master data, clears every document of the season together">⚠ Emergency: wipe all documents (keep master data)</Button>
          <Button onClick={handleReset} variant="danger">⚠ Start fresh — erase ALL data</Button>
        </Card>
        )}

        <div style={{ marginTop: 24, padding: "14px 16px", background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 8, fontSize: 12, color: "#92400E", lineHeight: 1.5 }}>
          {isSharedMode() ? <><strong>About the shared data:</strong> The data lives in the shared copy{ENV_LABEL ? ` (${ENV_LABEL})` : ""} on Supabase (Frankfurt) — everyone signed in reads and writes the same records; colleagues' saves appear within 20 seconds. This browser keeps a working copy and its local snapshots; Export all data saves what this browser holds, which is the shared copy once synced. Signing out (the pill in the top bar) leaves the shared copy untouched.</> : <><strong>About local storage:</strong> Data lives in your browser only. Different browsers, devices, or private windows have separate copies. Clearing your browser data will wipe MARIANNA ERP data. There is no server: a copy leaves this computer only through the backup folder or an export.</>}{/* v7.0.0 (A-SH-2) */}</div>

        {/* v7.0.0 (A-SH-2): the "Phase 2" footer is gone — the shared data, login and audit trail are here */}
      </div>
    </ModulePage>
  );
}
