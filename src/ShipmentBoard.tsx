// ─────────────────────────────────────────────────────────────────────────────
// ShipmentBoard.tsx — v6.99.55 (BD-1…6, owner ruling 23 Sept)
// The dispatcher's weekly board as a VIEW: one row per truck, her 26 columns in her six steps, every cell writing to the
// module that owns it. Nothing is stored here. Import reconciles her workbook; export writes it back in her layout.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { BOARD_COLUMNS, STEP_META, boardRows, parseHerSheet, matchImportedRow, BoardRow, ImportedRow } from "./board.domain";
import { exportRowsToXlsx } from "./exportXlsx";
import { placeForPrint } from "./locations";
import { recordAudit } from "./audit";

const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => { const n = parseFloat(S(v).replace(",", ".").replace(/[^\d.-]/g, "")); return isFinite(n) ? n : 0; };
const toISO = (v: any): string => { const s = S(v); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})$/); if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; } return ""; };

export default function ShipmentBoard({ shipments = [], setShipments, pos = [], setPOs, orders = [], setOrders, lots = [], invoices = [], contacts = [], inspections = [], onOpenShipment = null, onCreateFromPO = null }: any) {
  const locName = (id: any, text: any) => placeForPrint(id, text, contacts).name || S(text);
  const rows = useMemo(() => boardRows({ shipments, pos, orders, lots, invoices, contacts, inspections, locName }), [shipments, pos, orders, lots, invoices, contacts, inspections]);   // eslint-disable-line react-hooks/exhaustive-deps
  const weeks = useMemo(() => { const m = new Map<string, { label: string; monday: string; rows: BoardRow[] }>(); rows.forEach(r => { if (!m.has(r.week.key)) m.set(r.week.key, { label: r.week.label, monday: r.week.monday, rows: [] }); m.get(r.week.key)!.rows.push(r); }); return Array.from(m.entries()).sort((a, b) => a[1].monday.localeCompare(b[1].monday)); }, [rows]);
  const [week, setWeek] = useState<string>("");
  const cur = weeks.find(([k]) => k === week) || weeks[weeks.length - 1];
  const [importReport, setImportReport] = useState<any>(null);
  const carriers = (contacts || []).filter((c: any) => (c.roles || [c.type, ...(c.additionalTypes || [])]).some((r: any) => ["Carrier", "Forwarder"].includes(String(r))));
  const clients = (contacts || []).filter((c: any) => (c.roles || [c.type, ...(c.additionalTypes || [])]).includes("Client"));

  // ── the writers: each cell writes to the module that owns the fact ──
  function writeUnit(r: BoardRow, patch: any) { setShipments && setShipments((prev: any[]) => (prev || []).map((sh: any) => sh.id !== r.shipment.id ? sh : { ...sh, legs: (sh.legs || []).map((l: any, li: number) => li !== r.legIdx ? l : { ...l, vehicles: (l.vehicles || []).map((u: any, ui: number) => ui === r.unitIdx ? { ...u, ...patch } : u) }) })); }
  function writeShipment(r: BoardRow, patch: any) { setShipments && setShipments((prev: any[]) => (prev || []).map((sh: any) => sh.id !== r.shipment.id ? sh : { ...sh, ...patch })); }
  function writeBooking(r: BoardRow, patch: any) { setShipments && setShipments((prev: any[]) => (prev || []).map((sh: any) => sh.id !== r.shipment.id ? sh : { ...sh, bookings: [{ ...((sh.bookings || [])[0] || {}), ...patch }, ...((sh.bookings || []).slice(1))] })); }
  function writeContainer(r: BoardRow, patch: any) { setShipments && setShipments((prev: any[]) => (prev || []).map((sh: any) => { if (sh.id !== r.shipment.id) return sh; const li = (sh.legs || []).findIndex((l: any) => ["sea", "air", "rail"].includes(String(l.mode || "").toLowerCase())); if (li < 0) return sh; return { ...sh, legs: sh.legs.map((l: any, i: number) => i !== li ? l : { ...l, vehicles: (l.vehicles || []).length ? l.vehicles.map((u: any, ui: number) => ui === 0 ? { ...u, ...patch } : u) : [{ id: Date.now(), kind: "container", ...patch }] }) }; })); }
  function writePOLinePrice(r: BoardRow, v: any) { if (!r.po || r.poLines.length !== 1 || !setPOs) return; const line = r.poLines[0]; setPOs((prev: any[]) => (prev || []).map((p: any) => p.id !== r.po.id ? p : { ...p, items: (p.items || []).map((it: any) => it === line || (it.id != null && it.id === line.id) ? { ...it, unitPrice: num(v) } : it) })); }
  function writeSO(r: BoardRow, patch: any) { if (!r.so || !setOrders) return; setOrders((prev: any[]) => (prev || []).map((o: any) => o.id !== r.so.id ? o : { ...o, ...patch })); }
  function writeSOLinePrice(r: BoardRow, v: any) { if (!r.so || !setOrders) return; const goodsSizes = new Set((r.shipment.goods || []).map((g: any) => S(g.size))); setOrders((prev: any[]) => (prev || []).map((o: any) => o.id !== r.so.id ? o : { ...o, items: (o.items || []).map((it: any) => goodsSizes.has(S(it.size)) || goodsSizes.size === 0 ? { ...it, unitPrice: num(v) } : it) })); }

  const inp: any = { width: "100%", border: "1px solid transparent", background: "transparent", padding: "3px 4px", fontSize: 11.5, borderRadius: 4 };
  const onFocus = (e: any) => { e.target.style.border = "1px solid #2563EB"; e.target.style.background = "#fff"; };
  const onBlur = (e: any) => { e.target.style.border = "1px solid transparent"; e.target.style.background = "transparent"; };

  function Cell({ r, col }: { r: BoardRow; col: any }) {
    const v = r.cells[col.key] || "";
    const ro = (title: string) => <div title={title} style={{ fontSize: 11.5, padding: "3px 4px", color: v ? "#111" : "#CBD5E1" }}>{v || "—"}</div>;
    switch (col.key) {
      case "product": case "supplier": case "packaging": return ro(r.po ? `from ${r.po.number} — edit on the PO` : "create the row from a PO line");
      case "purchasePrice": return r.poLines.length === 1 ? <input style={inp} defaultValue={v} onFocus={onFocus} onBlur={e => { onBlur(e); if (S(e.target.value) !== v) writePOLinePrice(r, e.target.value); }} /> : ro(r.poLines.length > 1 ? "several lines — edit on the PO" : "no PO line");
      case "salesPrice": return r.so ? <input style={inp} defaultValue={v} onFocus={onFocus} onBlur={e => { onBlur(e); if (S(e.target.value) !== v) writeSOLinePrice(r, e.target.value); }} /> : ro("create the SO first");
      case "client": return r.so ? <select style={inp} value={r.so.client?.id ?? ""} onChange={e => { const c = clients.find((x: any) => String(x.id) === e.target.value); if (c) writeSO(r, { client: { id: c.id, name: c.name, country: c.country, nip: c.nip, address: c.address } }); }}><option value="">—</option>{clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : ro("create the SO first");
      case "invoiceNo": return ro(v ? "issued — see Invoices" : "issued from Invoices when the goods are loaded");
      case "ip": return r.so ? <input style={inp} defaultValue={v} onFocus={onFocus} onBlur={e => { onBlur(e); if (S(e.target.value) !== v) writeSO(r, { importPermitNo: S(e.target.value) }); }} /> : ro("create the SO first");
      case "acid": return r.so ? <input style={inp} defaultValue={v} onFocus={onFocus} onBlur={e => { onBlur(e); if (S(e.target.value) !== v) writeSO(r, { acidNo: S(e.target.value) }); }} /> : ro("create the SO first");
      case "controller": return ro("the quality inspection on the lot (Quality & handling)");
      case "pos": return <input style={inp} defaultValue={v} placeholder="port" onFocus={onFocus} onBlur={e => { onBlur(e); if (S(e.target.value) !== v) writeBooking(r, { pol: S(e.target.value), polId: null }); }} />;
      case "pod": return <input style={inp} defaultValue={v} placeholder="port" onFocus={onFocus} onBlur={e => { onBlur(e); if (S(e.target.value) !== v) writeBooking(r, { pod: S(e.target.value), podId: null }); }} />;
      case "loadingDate": return <input type="date" style={inp} defaultValue={toISO(r.unit.plannedLoadingDate)} onFocus={onFocus} onBlur={e => { onBlur(e); writeUnit(r, { plannedLoadingDate: e.target.value }); }} />;
      case "unloadingDate": return <input type="date" style={inp} defaultValue={toISO(r.unit.plannedDeliveryDate)} onFocus={onFocus} onBlur={e => { onBlur(e); writeUnit(r, { plannedDeliveryDate: e.target.value }); }} />;
      case "truckCarrier": return <select style={inp} value={r.unit.carrierId ?? ""} onChange={e => writeUnit(r, { carrierId: e.target.value ? (isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)) : null })}><option value="">—</option>{carriers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>;
      case "truckPrice": return <input style={inp} defaultValue={v} placeholder="1870 EUR" onFocus={onFocus} onBlur={e => { onBlur(e); if (S(e.target.value) !== v) { const t = S(e.target.value); const cur = (t.match(/[A-Za-z]{3}|e$/) || [])[0]; writeUnit(r, { costAmount: num(t), costCurrency: cur ? (cur.toLowerCase() === "e" ? "EUR" : cur.toUpperCase()) : (r.unit.costCurrency || "EUR") }); } }} />;
      case "plates": return <input style={inp} defaultValue={v} placeholder="truck/trailer" onFocus={onFocus} onBlur={e => { onBlur(e); if (S(e.target.value) !== v) { const [t, tr] = S(e.target.value).split(/[/\s]+/); writeUnit(r, { truckPlate: t || "", trailerPlate: tr || "" }); } }} />;
      case "loadingPlace": return <input style={inp} defaultValue={v} onFocus={onFocus} onBlur={e => { onBlur(e); if (S(e.target.value) !== v) writeUnit(r, { pickupText: S(e.target.value), pickupLocationId: null }); }} />;
      case "unloadingPlace": return <input style={inp} defaultValue={v} onFocus={onFocus} onBlur={e => { onBlur(e); if (S(e.target.value) !== v) writeUnit(r, { deliveryText: S(e.target.value), deliveryLocationId: null }); }} />;
      case "unloadingTime": return <input style={inp} defaultValue={v} placeholder="08:00 - 11:00" onFocus={onFocus} onBlur={e => { onBlur(e); if (S(e.target.value) !== v) writeUnit(r, { plannedDeliveryTime: S(e.target.value) }); }} />;
      case "driver": return <input style={inp} defaultValue={v} placeholder="name +48 …" onFocus={onFocus} onBlur={e => { onBlur(e); if (S(e.target.value) !== v) { const t = S(e.target.value); const m = t.match(/^(.*?)\s*(\+?\d[\d\s]{6,})$/); writeUnit(r, { driverName: m ? S(m[1]) : t, driverPhone: m ? S(m[2]) : (r.unit.driverPhone || "") }); } }} />;
      case "containerCarrier": return <select style={inp} value={(() => { const li = (r.shipment.legs || []).find((l: any) => ["sea", "air", "rail"].includes(String(l.mode || "").toLowerCase())); return li?.vehicles?.[0]?.carrierId ?? (r.shipment.bookings || [])[0]?.forwarderId ?? ""; })()} onChange={e => { const id = e.target.value ? (isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)) : null; writeBooking(r, { forwarderId: id }); writeContainer(r, { carrierId: id }); }}><option value="">—</option>{carriers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>;
      case "containerPrice": return <input style={inp} defaultValue={v} placeholder="1700 EUR" onFocus={onFocus} onBlur={e => { onBlur(e); if (S(e.target.value) !== v) { const t = S(e.target.value); const cur = (t.match(/[A-Za-z]{3}|e$/) || [])[0]; writeContainer(r, { costAmount: num(t), costCurrency: cur ? (cur.toLowerCase() === "e" ? "EUR" : cur.toUpperCase()) : "EUR" }); } }} />;
      case "comments": return <input style={inp} defaultValue={v} onFocus={onFocus} onBlur={e => { onBlur(e); if (S(e.target.value) !== v) writeShipment(r, { notes: S(e.target.value) }); }} />;
      case "shippingLine": return <input style={inp} defaultValue={v} placeholder="Hapag Lloyd" onFocus={onFocus} onBlur={e => { onBlur(e); if (S(e.target.value) !== v) writeBooking(r, { line: S(e.target.value) }); }} />;
      case "etdEta": return <input style={inp} defaultValue={v} placeholder="13/09 - 24/09" onFocus={onFocus} onBlur={e => { onBlur(e); if (S(e.target.value) !== v) { const parts = S(e.target.value).split(/\s*[-–]\s*/); const y = new Date().getFullYear(); const fix = (p: string) => { const m = p.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/); return m ? `${m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; }; writeBooking(r, { etd: fix(parts[0] || ""), eta: fix(parts[1] || "") }); } }} />;
      default: return ro("");
    }
  }

  // ── BD-4: import her workbook — reconcile, fill only what is empty, show the differences ──
  function importFile(f: any) {
    if (!f) return; const rd = new FileReader();
    rd.onload = () => {
      const wb = XLSX.read(rd.result, { type: "array", cellDates: true });
      let all: ImportedRow[] = []; wb.SheetNames.forEach(n => { const m = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) as any[][]; all = all.concat(parseHerSheet(n, m)); });
      const report = all.map(row => { const m = matchImportedRow(row, rows); if (!m) return { row, hit: null, confidence: null, fills: [], diffs: [] };
        const fills: string[] = [], diffs: string[] = [];
        BOARD_COLUMNS.forEach(c => { const hers = S(row.cells[c.key]); const ours = S(m.hit.cells[c.key]); if (!hers) return; if (!ours) fills.push(c.key); else if (hers.toLowerCase() !== ours.toLowerCase()) diffs.push(`${c.label}: file "${hers}" · ERP "${ours}"`); });
        return { row, hit: m.hit, confidence: m.confidence, fills, diffs }; });
      setImportReport({ name: f.name, report });
    };
    rd.readAsArrayBuffer(f);
  }
  function applyImport() {
    if (!importReport) return; let n = 0;
    importReport.report.forEach((e: any) => { if (!e.hit || e.confidence !== "exact") return; const r: BoardRow = e.hit; const c = e.row.cells;
      const unitPatch: any = {};
      if (e.fills.includes("plates")) { const [t, tr] = S(c.plates).replace(/^SHP\d+\s*/i, "").split(/[/\s']+/); unitPatch.truckPlate = t || ""; unitPatch.trailerPlate = tr || ""; }
      if (e.fills.includes("driver")) unitPatch.driverName = S(c.driver);
      if (e.fills.includes("loadingDate")) unitPatch.plannedLoadingDate = toISO(c.loadingDate);
      if (e.fills.includes("unloadingDate")) unitPatch.plannedDeliveryDate = toISO(c.unloadingDate);
      if (e.fills.includes("loadingPlace")) unitPatch.pickupText = S(c.loadingPlace);
      if (e.fills.includes("unloadingPlace")) unitPatch.deliveryText = S(c.unloadingPlace);
      if (e.fills.includes("unloadingTime")) unitPatch.plannedDeliveryTime = S(c.unloadingTime);
      if (e.fills.includes("truckPrice")) unitPatch.costAmount = num(c.truckPrice);
      if (Object.keys(unitPatch).length) { writeUnit(r, unitPatch); n++; }
      const bk: any = {}; if (e.fills.includes("pos")) bk.pol = S(c.pos); if (e.fills.includes("pod")) bk.pod = S(c.pod); if (e.fills.includes("shippingLine")) bk.line = S(c.shippingLine);
      if (Object.keys(bk).length) { writeBooking(r, bk); n++; }
      if (e.fills.includes("comments")) { writeShipment(r, { notes: S(c.comments) }); n++; }
      if (r.so) { const so: any = {}; if (e.fills.includes("ip")) so.importPermitNo = S(c.ip); if (e.fills.includes("acid")) so.acidNo = S(c.acid); if (Object.keys(so).length) { writeSO(r, so); n++; } }
    });
    recordAudit({ module: "Shipments", docType: "Board", docNumber: importReport.name, action: "updated", summary: `Board import applied: ${n} document(s) filled from the workbook (exact matches only)` });
    setImportReport(null);
  }
  // ── BD-5: export the week back in her layout ──
  function exportWeek() {
    if (!cur) return;
    const cols = [{ key: "n", label: "" }, ...BOARD_COLUMNS.map(c => ({ key: c.key, label: c.label }))];
    exportRowsToXlsx(`Shipments_${cur[1].label.replace(" ", "_")}`, cur[1].rows.map((r, i) => ({ n: i + 1, ...r.cells })), cols as any, cur[1].label);
  }

  const stepOf: Record<number, any[]> = {}; BOARD_COLUMNS.forEach(c => { (stepOf[c.step] = stepOf[c.step] || []).push(c); });
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#FAFAFA" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "8px 16px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>Weekly board</div>
        <div style={{ fontSize: 11, color: "#64748B" }}>one row per truck · every cell writes to its module · nothing stored here</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {Object.entries(STEP_META).map(([k, m]) => <span key={k} style={{ fontSize: 10, fontWeight: 800, color: m.colour, background: m.bg, borderRadius: 6, padding: "2px 7px" }}>{m.label}</span>)}
          <label style={{ fontSize: 11.5, border: "1px dashed #1E40AF", color: "#1E40AF", borderRadius: 7, padding: "5px 10px", cursor: "pointer" }}>⬆ import her workbook<input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => importFile(e.target.files?.[0])} /></label>
          <button onClick={exportWeek} disabled={!cur} style={{ fontSize: 11.5, border: "1px solid #E5E7EB", background: "#fff", borderRadius: 7, padding: "5px 10px", cursor: "pointer" }}>⬇ export this week</button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, padding: "8px 16px 0", borderBottom: "1px solid #EBEBEB", background: "#fff", overflowX: "auto" }}>
        {weeks.map(([k, w]) => <button key={k} onClick={() => setWeek(k)} style={{ padding: "6px 12px", border: "1px solid #E5E7EB", borderBottom: cur && cur[0] === k ? "2px solid #0F172A" : "1px solid #E5E7EB", background: cur && cur[0] === k ? "#fff" : "#F8FAFC", borderRadius: "8px 8px 0 0", fontSize: 12, fontWeight: cur && cur[0] === k ? 800 : 500, cursor: "pointer" }}>{w.label} <span style={{ color: "#94A3B8" }}>· {w.rows.length}</span></button>)}
        {!weeks.length && <div style={{ fontSize: 12, color: "#94A3B8", padding: 8 }}>No trucks yet — create a shipment from a PO, or import the workbook.</div>}
      </div>
      {importReport && (
        <div style={{ margin: "10px 16px 0", border: "1px solid #BFDBFE", background: "#EFF6FF", borderRadius: 8, padding: "10px 12px", fontSize: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Import preview — {importReport.name}: {importReport.report.length} row(s) · {importReport.report.filter((e: any) => e.confidence === "exact").length} exact match(es) · {importReport.report.filter((e: any) => e.confidence === "probable").length} probable · {importReport.report.filter((e: any) => !e.hit).length} without a shipment</div>
          <div style={{ maxHeight: 180, overflow: "auto" }}>
            {importReport.report.map((e: any, i: number) => <div key={i} style={{ padding: "3px 0", borderTop: "1px solid #DBEAFE" }}>
              <b>{e.row.sheet} r{e.row.rowNo}</b> {e.row.cells.supplier || ""} {e.row.cells.plates ? `· ${e.row.cells.plates}` : ""} → {e.hit ? <span style={{ color: e.confidence === "exact" ? "#166534" : "#92400E" }}>{e.hit.shipment.number} ({e.confidence}){e.fills.length ? ` · fills ${e.fills.length} empty cell(s)` : ""}</span> : <span style={{ color: "#94A3B8" }}>no shipment — create it from the PO line first</span>}
              {e.diffs.length > 0 && <div style={{ color: "#92400E", fontSize: 11 }}>{e.diffs.slice(0, 3).map((d: string, k: number) => <div key={k}>⚠ {d}</div>)}</div>}
            </div>)}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button onClick={applyImport} style={{ fontSize: 12, border: "none", background: "#1E40AF", color: "#fff", borderRadius: 7, padding: "6px 12px", cursor: "pointer" }}>Fill the empty cells (exact matches only)</button>
            <button onClick={() => setImportReport(null)} style={{ fontSize: 12, border: "1px solid #E5E7EB", background: "#fff", borderRadius: 7, padding: "6px 12px", cursor: "pointer" }}>Cancel</button>
            <span style={{ fontSize: 11, color: "#64748B", alignSelf: "center" }}>Never overwrites what the ERP already holds — differences are only shown.</span>
          </div>
        </div>
      )}
      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
        {cur && (
          <table style={{ borderCollapse: "collapse", fontSize: 11.5, minWidth: 3200, background: "#fff" }}>
            <thead>
              <tr>{[1, 2, 3, 4, 5, 6].map(s => null)}
                <th style={{ border: "1px solid #E5E7EB", padding: 4, background: "#F8FAFC" }} rowSpan={2}>#</th>
                {BOARD_COLUMNS.map(c => <th key={c.key} style={{ border: "1px solid #E5E7EB", padding: "3px 4px", background: STEP_META[c.step].bg, color: STEP_META[c.step].colour, fontSize: 9.5, fontWeight: 800 }}>{STEP_META[c.step].label.split(" · ")[0]}</th>)}
                <th style={{ border: "1px solid #E5E7EB", padding: 4, background: "#F8FAFC" }} rowSpan={2}>ready</th>
              </tr>
              <tr>{BOARD_COLUMNS.map(c => <th key={c.key} style={{ border: "1px solid #E5E7EB", padding: "4px 5px", background: "#F8FAFC", textAlign: "left", fontSize: 11, minWidth: c.width || 100 }}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {cur[1].rows.map((r, i) => (
                <tr key={r.id} style={{ background: r.ready.closed ? "#F0FDF4" : r.ready.loadable ? "#F8FAFC" : "#fff" }}>
                  <td style={{ border: "1px solid #E5E7EB", padding: 4, textAlign: "center", fontWeight: 700 }}><span title={r.shipment.number} style={{ cursor: onOpenShipment ? "pointer" : "default", color: "#2563EB" }} onClick={() => onOpenShipment && onOpenShipment(r.shipment.number)}>{i + 1}</span></td>
                  {BOARD_COLUMNS.map(c => <td key={c.key} style={{ border: "1px solid #E5E7EB", padding: 0, background: !r.cells[c.key] && !r.ready.steps[c.step] ? "#FFFBEB" : undefined }}><Cell r={r} col={c} /></td>)}
                  <td style={{ border: "1px solid #E5E7EB", padding: 4, whiteSpace: "nowrap" }}>{[1, 2, 3, 4, 5, 6].map(s => <span key={s} title={STEP_META[s as 1].label} style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, marginRight: 2, background: r.ready.steps[s] ? "#16A34A" : "#E5E7EB" }} />)}{r.ready.closed ? <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 800, color: "#166534" }}>closed</span> : r.ready.loadable ? <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 800, color: "#0F766E" }}>loadable</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
