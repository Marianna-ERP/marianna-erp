import { useConfirm } from "./ui";   // v7.22.5 (A-RV-17)
import { localTodayISO } from "./dates";
// ─────────────────────────────────────────────────────────────────────────────
// PlanningSheet.tsx — v6.99.63 (A-SH-1…13, owner 25 Sept)
// The weekly planning sheet: tabs · rows · cells, like her Excel, INSIDE the system and writing to NO module. Cells save as
// typed (there are no gates here to bypass). Every change is logged for the study of how the sheet is filled.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { SheetTab, SheetRow, SheetLogEntry, blankRow, sid, parseClipboard, productText, tabToGrid, importWorkbookRows, sheetUsage, setCellStyle, setColWidth, setRowHeight, TEXT_COLOURS, FILL_COLOURS, SHEET_COLUMNS, SHOWN_COLUMNS, ShownCol, shownText, shownValue, pasteShownGrid, cellClipboardText, readSheetDate, ROW_HEAD_KEY } from "./sheet.domain";
import { HER_HEADERS } from "./board.domain";
import { unifiedLocations , isPortType } from "./locations";
import { S } from "./format";
import { activeParties, rolesOf } from "./counterparty.domain";   // v7.10.2 (A-RV-15 · CP-4)

const nowISO = () => new Date().toISOString();

export default function PlanningSheet({ tabs = [], setTabs, log = [], setLog, contacts = [], catalog = [], orders = [], invoices = [], userName = "" }: any) {
  const { confirm: uiConfirm, alert: uiAlert, prompt: uiPrompt, dialogNode } = useConfirm();   // v7.22.5 (A-RV-17): the app's own windows, not the browser's
  const sorted: SheetTab[] = useMemo(() => [...(tabs || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [tabs]);
  const [activeId, setActiveId] = useState<string>("");
  const tab = sorted.find(t => t.id === activeId) || sorted[sorted.length - 1] || null;
  const [sel, setSel] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const [showUsage, setShowUsage] = useState(false);
  // v7.30.17: sizes as they are dragged (saved on release), and the drag itself
  const [liveW, setLiveW] = useState<Record<string, number>>({}); const [liveH, setLiveH] = useState<Record<string, number>>({});
  const drag = useRef<any>(null);
  useEffect(() => {
  const move = (e: MouseEvent) => { const d = drag.current; if (!d) return;
  if (d.kind === "col") setLiveW(w => ({ ...w, [d.key]: Math.max(50, Math.min(600, d.start + e.clientX - d.x)) }));
  else setLiveH(h => ({ ...h, [d.id]: Math.max(24, Math.min(400, d.start + e.clientY - d.y)) })); };
  const up = () => { const d = drag.current; if (!d) return; drag.current = null;
  if (d.kind === "col") setLiveW(w => { const px = w[d.key]; if (px && d.tabId) setTabs((prev: SheetTab[]) => (prev || []).map(x => x.id === d.tabId ? setColWidth(x, d.key, px) : x)); const n = { ...w }; delete n[d.key]; return n; });
  else setLiveH(h => { const px = h[d.id]; if (px && d.tabId) setTabs((prev: SheetTab[]) => (prev || []).map(x => x.id === d.tabId ? setRowHeight(x, d.id, px) : x)); const n = { ...h }; delete n[d.id]; return n; }); };
  window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [setTabs]);
  const who = userName || "user";

  // ── the Directory lists the dropdown cells choose from ──
  const lists = useMemo(() => {
    // v7.10.2 (A-RV-15 · CP-4) · v7.28.2: a note in the middle of this line had hidden its end since v7.10.2 — the lists held companies, not names
    const by = (r: string) => activeParties(contacts).filter((c: any) => rolesOf(c).includes(r)).map((c: any) => c.name).filter(Boolean).sort((a: string, b: string) => a.localeCompare(b, "pl"));
    const locs = unifiedLocations(contacts || []);
    const ports = locs.filter((l: any) => isPortType(l)).map((l: any) => l.name);   // v7.21.14 (A-RV-37): by the type — a place of type Other is no port
    return { clients: by("Client"), suppliers: by("Supplier"), carriers: by("Carrier"), forwarders: Array.from(new Set([...by("Forwarder"), ...by("Shipping line")])),
      ports: Array.from(new Set(ports)).sort(),
      // v7.31.0 (WB-4, owner 21 Oct: "the loading place column refers once more to the supplier name and not the address"): each place with its address
      places: Array.from(new Set(locs.map((l: any) => [S(l.name), S(l.address).replace(/\s*\n\s*/g, ", ")].filter(Boolean).join(" · ")))).sort(), placeNames: Array.from(new Set(locs.map((l: any) => S(l.name)))),
      orders: (orders || []).filter((o: any) => o.status !== "Cancelled").map((o: any) => o.number),
      items: (catalog || []).map((c: any) => c.item), varieties: Array.from(new Set((catalog || []).flatMap((c: any) => c.varieties || []))) } as Record<string, string[]>;
  }, [contacts, orders, catalog]);

  const addLog = (entries: SheetLogEntry[]) => { if (setLog && entries.length) setLog((prev: any[]) => [...(prev || []), ...entries]); };
  const updateTab = (id: string, fn: (t: SheetTab) => SheetTab) => setTabs((prev: SheetTab[]) => (prev || []).map(t => t.id === id ? fn(t) : t));

  function commit(row: SheetRow, key: string, value: any) {
    if (!tab || row.frozen) return;
    const old = row.cells[key];
    if (JSON.stringify(old ?? "") === JSON.stringify(value ?? "")) return;
    const patch: Record<string, any> = { [key]: value };
    const entries: SheetLogEntry[] = [{ at: nowISO(), who, tab: tab.id, row: row.id, col: key, old, now: value, action: "cell" }];
    // SH-10: choosing the SO fills the invoice number from the Invoices register (still editable)
    if (key === "so" && S(value) && !S(row.cells.invoiceNo)) {
      const inv = (invoices || []).find((iv: any) => (iv.kind === "SALES" || iv.type === "SINV") && (iv.links || iv.linkedDocs || []).some((l: any) => l.type === "SO" && String(l.number) === S(value)));
      if (inv) { patch.invoiceNo = inv.number; entries.push({ at: nowISO(), who, tab: tab.id, row: row.id, col: "invoiceNo", old: row.cells.invoiceNo, now: inv.number, action: "cell" }); }
    }
    updateTab(tab.id, t => ({ ...t, rows: t.rows.map(r => r.id === row.id ? { ...r, cells: { ...r.cells, ...patch } } : r) }));
    addLog(entries);
  }
  // ── rows ──
  function addRow(at?: number) { if (!tab) return; const r = blankRow(nowISO()); updateTab(tab.id, t => { const rows = [...t.rows]; rows.splice(at === undefined ? rows.length : at, 0, r); return { ...t, rows }; }); addLog([{ at: nowISO(), who, tab: tab.id, row: r.id, action: "row+" }]); }
  function duplicateRow(i: number) { if (!tab) return; const src = tab.rows[i]; const r = { ...blankRow(nowISO()), cells: JSON.parse(JSON.stringify(src.cells)), ...(src.styles ? { styles: JSON.parse(JSON.stringify(src.styles)) } : {}), ...(src.height ? { height: src.height } : {}) }; updateTab(tab.id, t => { const rows = [...t.rows]; rows.splice(i + 1, 0, r); return { ...t, rows }; }); addLog([{ at: nowISO(), who, tab: tab.id, row: r.id, action: "row+" }]); }
  async function deleteRow(i: number) { if (!tab) return; const r = tab.rows[i]; if (r.frozen) { (await uiAlert({ message: "A frozen row cannot be deleted — unfreeze it first." })); return; } if (!(await uiConfirm({ title: "Please confirm", message: "Delete this row?" }))) return; updateTab(tab.id, t => ({ ...t, rows: t.rows.filter((_, k) => k !== i) })); addLog([{ at: nowISO(), who, tab: tab.id, row: r.id, action: "row-" }]); }
  async function toggleFreeze(i: number) { if (!tab) return; const r = tab.rows[i]; if (r.frozen && !(await uiConfirm({ title: "Please confirm", message: "Unfreeze this row? It becomes editable again (recorded)." }))) return; updateTab(tab.id, t => ({ ...t, rows: t.rows.map((x, k) => k === i ? { ...x, frozen: !x.frozen } : x) })); addLog([{ at: nowISO(), who, tab: tab.id, row: r.id, action: r.frozen ? "unfreeze" : "freeze" }]); }
  // ── tabs ──
  async function newTab() { const name = (await uiPrompt({ message: "Name of the new tab", defaultValue: `week ${sorted.length + 1}` })); if (!name) return; const t: SheetTab = { id: sid("t"), name: S(name), order: (sorted[sorted.length - 1]?.order ?? 0) + 1, createdAt: nowISO(), rows: [blankRow(nowISO())] }; setTabs((prev: SheetTab[]) => [...(prev || []), t]); setActiveId(t.id); addLog([{ at: nowISO(), who, tab: t.id, action: "tab+", now: t.name }]); }
  async function renameTab() { if (!tab) return; const name = (await uiPrompt({ message: "Rename the tab", defaultValue: tab.name })); if (!name || S(name) === tab.name) return; updateTab(tab.id, t => ({ ...t, name: S(name) })); addLog([{ at: nowISO(), who, tab: tab.id, action: "rename", old: tab.name, now: S(name) }]); }
  function moveTab(dir: -1 | 1) { if (!tab) return; const i = sorted.findIndex(t => t.id === tab.id); const j = i + dir; if (j < 0 || j >= sorted.length) return; const a = sorted[i], b = sorted[j]; setTabs((prev: SheetTab[]) => (prev || []).map(t => t.id === a.id ? { ...t, order: b.order } : t.id === b.id ? { ...t, order: a.order } : t)); }
  async function deleteTab() { if (!tab) return; if (tab.rows.some(r => r.frozen)) { (await uiAlert({ message: "This tab has frozen rows — unfreeze them before deleting the tab." })); return; } if (!(await uiConfirm({ title: "Please confirm", message: `Delete the tab "${tab.name}" and its ${tab.rows.length} row(s)?` }))) return; setTabs((prev: SheetTab[]) => (prev || []).filter(t => t.id !== tab.id)); addLog([{ at: nowISO(), who, tab: tab.id, action: "tab-", old: tab.name }]); setActiveId(""); }
  async function freezeTab() { if (!tab) return; if (!(await uiConfirm({ title: "Please confirm", message: `Freeze every row of "${tab.name}"?` }))) return; updateTab(tab.id, t => ({ ...t, rows: t.rows.map(r => ({ ...r, frozen: true })) })); addLog(tab.rows.filter(r => !r.frozen).map(r => ({ at: nowISO(), who, tab: tab.id, row: r.id, action: "freeze" as const }))); }
  // ── her workbook in, the sheet out ──
  function importFile(f: any) {
    if (!f) return; const rd = new FileReader();
    rd.onload = async () => { const wb = XLSX.read(rd.result, { type: "array", cellDates: true }); let order = (sorted[sorted.length - 1]?.order ?? 0);
      const added: SheetTab[] = wb.SheetNames.map(n => ({ ...importWorkbookRows(n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) as any[][], HER_HEADERS, nowISO()), order: ++order }));
      if (!(await uiConfirm({ title: "Please confirm", message: `Import ${added.length} tab(s), ${added.reduce((s, t) => s + t.rows.length, 0)} row(s) from ${f.name}? Existing tabs are kept.` }))) return;
      setTabs((prev: SheetTab[]) => [...(prev || []), ...added]); addLog(added.map(t => ({ at: nowISO(), who, tab: t.id, action: "import" as const, now: `${t.name} · ${t.rows.length} rows from ${f.name}` }))); if (added[0]) setActiveId(added[0].id); };
    rd.readAsArrayBuffer(f);
  }
  function exportXlsx(all: boolean) {
    const wb = XLSX.utils.book_new(); const list = all ? sorted : (tab ? [tab] : []);
    list.forEach(t => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([SHEET_COLUMNS.map(c => c.label), ...tabToGrid(t)]), t.name.slice(0, 31) || "sheet"));
    if (list.length) XLSX.writeFile(wb, `Planning_sheet_${all ? "all" : (tab?.name || "tab").replace(/\s+/g, "_")}_${localTodayISO()}.xlsx`);
  }
  function exportLog() { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["when", "who", "action", "tab", "row", "column", "old", "new"], ...(log || []).map((e: SheetLogEntry) => [e.at, e.who, e.action, (sorted.find(t => t.id === e.tab)?.name) || e.tab, e.row || "", e.col || "", typeof e.old === "object" ? productText(e.old) : S(e.old), typeof e.now === "object" ? productText(e.now) : S(e.now)])]), "change log"); XLSX.writeFile(wb, `Planning_sheet_changes_${localTodayISO()}.xlsx`); }

  const btn: any = { fontSize: 11, border: "1px solid #E5E7EB", background: "#fff", borderRadius: 7, padding: "5px 10px", cursor: "pointer" };

  // ── v7.31.0 (WB-6, owner 21 Oct: "copy / paste from one cell to another does not work"): AS IN EXCEL — a click SELECTS a cell;
  // Ctrl+C / Ctrl+X / Ctrl+V / Delete act on the whole selected cell; typing replaces it; a double-click or F2 edits it in place;
  // the arrow keys, Tab and Enter move the selection. Every change is still recorded for the study. ──
  const grid = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<null | { seed?: string }>(null);
  const yearHint = new Date().getFullYear();
  const cols: ShownCol[] = SHOWN_COLUMNS;
  const rowsOf = (): SheetRow[] => (tab ? tab.rows : []);
  const move = (dr: number, dc: number) => setSel(s => ({ row: Math.max(0, Math.min(rowsOf().length - 1, s.row + dr)), col: Math.max(0, Math.min(cols.length - 1, s.col + dc)) }));
  const backToGrid = () => { setTimeout(() => { try { if (grid.current && !(document.activeElement && (document.activeElement as any).dataset && (document.activeElement as any).dataset.sheetEditor)) grid.current.focus(); } catch { /* gone */ } }, 0); };
  function writeShown(r: SheetRow, col: ShownCol, text: any) { const { key, value } = shownValue(r, col, text, yearHint); commit(r, key, value); }
  function stopEdit(save: boolean, text?: any, then?: [number, number]) {
    const r = rowsOf()[sel.row]; const col = cols[sel.col];
    if (save && r && col && text !== undefined && String(text).replace(/\s+$/, "") !== shownText(r, col)) writeShown(r, col, String(text).replace(/\s+$/, ""));
    setEditing(null); if (then) move(then[0], then[1]); backToGrid();
  }
  function gridKeys(e: React.KeyboardEvent) {
    if (editing || e.target !== grid.current || !tab) return;
    const r = rowsOf()[sel.row]; const col = cols[sel.col]; const k = e.key;
    if (k === "ArrowDown") { e.preventDefault(); move(1, 0); } else if (k === "ArrowUp") { e.preventDefault(); move(-1, 0); }
    else if (k === "ArrowRight") { e.preventDefault(); move(0, 1); } else if (k === "ArrowLeft") { e.preventDefault(); move(0, -1); }
    else if (k === "Tab") { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); } else if (k === "Enter") { e.preventDefault(); move(e.shiftKey ? -1 : 1, 0); }
    else if (k === "F2") { e.preventDefault(); if (r && !r.frozen) setEditing({}); }
    else if (k === "Delete" || k === "Backspace") { e.preventDefault(); if (r && col && !r.frozen && shownText(r, col)) writeShown(r, col, ""); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (r && !r.frozen) setEditing({ seed: k }); }
  }
  function onCopy(e: React.ClipboardEvent, cut = false) {
    if (editing || e.target !== grid.current || !tab) return; const r = rowsOf()[sel.row]; const col = cols[sel.col]; if (!r || !col) return;
    e.preventDefault(); e.clipboardData.setData("text/plain", cellClipboardText(shownText(r, col)));
    if (cut && !r.frozen && shownText(r, col)) writeShown(r, col, "");
  }
  function onPaste(e: React.ClipboardEvent) {
    if (editing || e.target !== grid.current || !tab) return; e.preventDefault();
    const blocks = parseClipboard(e.clipboardData.getData("text/plain")); if (!blocks.length) return;
    const res = pasteShownGrid(tab.rows, sel, blocks, nowISO(), yearHint); if (!res.changed.length) return;
    updateTab(tab.id, x => ({ ...x, rows: res.rows }));
    addLog(res.changed.map(c => ({ at: nowISO(), who, tab: tab.id, row: c.row, col: c.col, old: c.old, now: c.now, action: "paste" as const })));
  }
  // a cell to look at again — a name not in the Directory, a product not in the catalogue, a date that is neither a date nor a range
  function doubtful(r: SheetRow, col: ShownCol): string {
    const txt = shownText(r, col); if (!txt) return "";
    if (col.kind === "date") return readSheetDate((r.cells || {})[col.dataKey], yearHint).iso === null ? "not a date — type dd/mm/yyyy, or a range such as 20-21/10" : "";
    if (col.part === "item") return (lists.items || []).includes(txt) ? "" : "not in the product catalogue";
    if (col.kind === "list" && col.list) { const known = (lists[col.list] || []).includes(txt) || (col.list === "places" && (lists.placeNames || []).includes(txt)); return known ? "" : "not in the Directory"; }
    return "";
  }
  function editor(r: SheetRow, col: ShownCol) {
    const seed = editing && editing.seed !== undefined ? editing.seed : undefined; const start = seed !== undefined ? seed : shownText(r, col);
    const st: any = (r.styles || {})[col.key] || {}; const look: any = { ...(st.b ? { fontWeight: 800 } : {}), ...(st.color ? { color: st.color } : {}) };
    const box: any = { width: "100%", height: "100%", minHeight: 24, border: "none", outline: "2px solid #2563EB", background: "#fff", padding: "4px 5px", fontSize: 12, boxSizing: "border-box", fontFamily: "inherit", lineHeight: 1.35, resize: "none", display: "block", ...look };
    const keys = (e: any) => {
      if (e.key === "Enter" && (e.altKey || e.shiftKey) && e.target.tagName === "TEXTAREA") { e.preventDefault(); const el = e.target; const a2 = el.selectionStart ?? el.value.length, b2 = el.selectionEnd ?? a2; el.value = el.value.slice(0, a2) + "\n" + el.value.slice(b2); el.selectionStart = el.selectionEnd = a2 + 1; return; }
      if (e.key === "Enter") { e.preventDefault(); stopEdit(true, e.target.value, [1, 0]); return; }
      if (e.key === "Tab") { e.preventDefault(); stopEdit(true, e.target.value, [0, e.shiftKey ? -1 : 1]); return; }
      if (e.key === "Escape") { e.preventDefault(); stopEdit(false); }
    };
    const focusEnd = (el: any) => { if (el && document.activeElement !== el) { el.focus(); const n = String(el.value || "").length; try { el.setSelectionRange(n, n); } catch { /* not a text box */ } } };
    const listId = col.list ? "ps-" + col.list : undefined;
    if (col.kind === "text" && !col.part) return <textarea data-sheet-editor="1" ref={focusEnd} defaultValue={start} onKeyDown={keys} onBlur={e => { if (editing) stopEdit(true, e.target.value); }} style={{ ...box, whiteSpace: "pre-wrap", overflow: "hidden" }} rows={Math.max(1, String(start).split("\n").length)} />;
    return <input data-sheet-editor="1" ref={focusEnd} list={listId} defaultValue={start} onKeyDown={keys} onBlur={e => { if (editing) stopEdit(true, e.target.value); }} style={box} placeholder={col.kind === "date" ? "dd/mm/yyyy or 20-21/10" : undefined} />;
  }

  const usage = showUsage ? sheetUsage(sorted, log || []) : [];
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#FAFAFA" }}>{dialogNode}
      {["clients", "suppliers", "carriers", "forwarders", "ports", "places", "orders", "items", "varieties"].map(k => <datalist key={k} id={"ps-" + k}>{(lists[k] || []).map((x: string) => <option key={x} value={x} />)}</datalist>)}
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "8px 16px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>Planning sheet</div>
        <div style={{ fontSize: 11, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, padding: "2px 8px" }}>a planning sheet — it writes to no module; every change is recorded for the study</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ ...btn, borderStyle: "dashed", color: "#1E40AF" }}>Import file<input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => importFile(e.target.files?.[0])} /></label>
          <button style={btn} onClick={() => exportXlsx(false)} disabled={!tab}>Export file (this tab)</button>
          <button style={btn} onClick={() => exportXlsx(true)} disabled={!sorted.length}>Export file (all tabs)</button>
          {/* v6.99.78 (A-PS-1, owner): "Copy tab" removed — every tab is a different week; pasting rows from Excel into a cell (Ctrl+V) stays */}
          <button style={{ ...btn, background: showUsage ? "#0F172A" : "#fff", color: showUsage ? "#fff" : "#111" }} onClick={() => setShowUsage(!showUsage)}>How the sheet is used</button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, padding: "8px 16px 0", borderBottom: "1px solid #EBEBEB", background: "#fff", alignItems: "flex-end", overflowX: "auto" }}>
        {sorted.map(t => <button key={t.id} onClick={() => setActiveId(t.id)} style={{ padding: "6px 12px", border: "1px solid #E5E7EB", borderBottom: tab && tab.id === t.id ? "2px solid #0F172A" : "1px solid #E5E7EB", background: tab && tab.id === t.id ? "#fff" : "#F8FAFC", borderRadius: "8px 8px 0 0", fontSize: 12, fontWeight: tab && tab.id === t.id ? 800 : 500, cursor: "pointer", whiteSpace: "nowrap" }}>{t.name} <span style={{ color: "#94A3B8" }}>· {t.rows.length}</span></button>)}
        <button onClick={newTab} style={{ ...btn, marginBottom: 2 }}>＋ New tab</button>
        {tab && <span style={{ display: "inline-flex", gap: 4, marginLeft: 8, marginBottom: 2 }}>
          <button style={btn} onClick={() => moveTab(-1)} title="move left">◀</button><button style={btn} onClick={() => moveTab(1)} title="move right">▶</button>
          <button style={btn} onClick={renameTab}>✎ Rename</button><button style={btn} onClick={freezeTab}>🔒 Freeze tab</button>
          <button style={{ ...btn, background: "#DC2626", color: "#fff", borderColor: "#DC2626" }} onClick={deleteTab}>Delete tab</button></span>}
      </div>
      {tab && (() => { const row = tab.rows[sel.row]; const col = SHOWN_COLUMNS[sel.col]; if (!row || !col) return null; const st: any = (row.styles || {})[col.key] || {};
      const apply = (patch: any) => updateTab(tab.id, x => setCellStyle(x, row.id, col.key, patch));
      const sw = (bg: string, on: boolean, onClick: () => void, title: string, text = "") => <button key={title} title={title} onMouseDown={e => e.preventDefault()} onClick={onClick} style={{ width: 20, height: 20, borderRadius: 4, border: on ? "2px solid #0F172A" : "1px solid #CBD5E1", background: bg, cursor: "pointer", fontSize: 11, fontWeight: 800, color: "#fff", padding: 0 }}>{text}</button>;
      return <div data-sheet-format="1" style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 16px", background: "#fff", borderBottom: "1px solid #EBEBEB", flexWrap: "wrap", fontSize: 11 }}>   {/* v7.30.17: the selected cell's look */}
      <span style={{ color: "#64748B" }}>Cell {sel.row + 1} · {col.label}:</span>
      <button title="bold" onMouseDown={e => e.preventDefault()} onClick={() => apply({ b: !st.b })} style={{ ...btn, padding: "2px 9px", fontWeight: 900, background: st.b ? "#0F172A" : "#fff", color: st.b ? "#fff" : "#111" }}>B</button>
      <span style={{ color: "#64748B", marginLeft: 6 }}>Text</span>{TEXT_COLOURS.map(c2 => sw(c2, st.color === c2, () => apply({ color: st.color === c2 ? null : c2 }), "text " + c2))}
      <span style={{ color: "#64748B", marginLeft: 6 }}>Fill</span>{FILL_COLOURS.map(c2 => sw(c2, st.fill === c2, () => apply({ fill: st.fill === c2 ? null : c2 }), "fill " + c2))}
      <button onMouseDown={e => e.preventDefault()} onClick={() => apply(null)} style={{ ...btn, padding: "2px 8px", marginLeft: 6 }}>Clear format</button>
          <span style={{ color: "#94A3B8", marginLeft: "auto" }}>Ctrl+C / Ctrl+V / Delete on the selected cell · double-click or F2 to edit · Alt+Enter: a new line · drag an edge to resize</span>
        </div>; })()}
      {tab && (() => { const row = tab.rows[sel.row]; const col = SHOWN_COLUMNS[sel.col]; if (!row || !col) return null;   /* v7.31.0 (WB-3): the selected cell's whole content, as Excel's formula bar */
        return <div data-sheet-content="1" style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 16px", background: "#fff", borderBottom: "1px solid #EBEBEB" }}>
          <span style={{ fontSize: 11, color: "#64748B", whiteSpace: "nowrap", paddingTop: 5, minWidth: 140 }}>{col.label} · row {sel.row + 1}</span>
          <textarea key={row.id + col.key + shownText(row, col)} data-sheet-bar="1" disabled={!!row.frozen} defaultValue={shownText(row, col)} rows={Math.min(6, Math.max(1, shownText(row, col).split("\n").length))}
            onKeyDown={(e: any) => { if (e.key === "Enter" && !e.altKey && !e.shiftKey) { e.preventDefault(); e.target.blur(); } else if (e.key === "Escape") { e.preventDefault(); e.target.value = shownText(row, col); e.target.blur(); } }}
            onBlur={(e: any) => { const v = String(e.target.value || "").replace(/\s+$/, ""); if (v !== shownText(row, col)) writeShown(row, col, v); }}
            style={{ flex: 1, border: "1px solid #E5E7EB", borderRadius: 6, padding: "4px 8px", fontSize: 12, fontFamily: "inherit", resize: "vertical", lineHeight: 1.35, background: row.frozen ? "#F8FAFC" : "#fff" }} />
        </div>; })()}

      {showUsage && (
        <div style={{ margin: "10px 16px 0", border: "1px solid #E5E7EB", background: "#fff", borderRadius: 8, padding: "8px 10px", maxHeight: 260, overflow: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}><div style={{ fontSize: 12, fontWeight: 800 }}>How the sheet is used — from {(log || []).length} recorded change(s)</div><button style={{ ...btn, marginLeft: "auto" }} onClick={exportLog}>Export file (change log)</button></div>
          <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
            <thead><tr>{["Column", "Filled", "First filled (median days before loading)", "Changes after the first fill (avg)", "Changes after freezing"].map(h => <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #E5E7EB", padding: "3px 6px", color: "#64748B" }}>{h}</th>)}</tr></thead>
            <tbody>{usage.map(u => <tr key={u.key}><td style={{ padding: "3px 6px" }}>{u.label}</td><td style={{ padding: "3px 6px" }}>{u.filledPct}%</td><td style={{ padding: "3px 6px" }}>{u.medianDaysBeforeLoading === null ? "—" : u.medianDaysBeforeLoading}</td><td style={{ padding: "3px 6px" }}>{u.avgChangesAfterFirst}</td><td style={{ padding: "3px 6px", color: u.changedAfterFreeze ? "#B91C1C" : undefined, fontWeight: u.changedAfterFreeze ? 800 : 400 }}>{u.changedAfterFreeze}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <div ref={grid} tabIndex={0} data-sheet-grid="1" style={{ flex: 1, overflow: "auto", padding: "10px 16px", outline: "none" }} onKeyDown={gridKeys} onCopy={e => onCopy(e)} onCut={e => onCopy(e, true)} onPaste={onPaste}>
        {!tab && <div style={{ fontSize: 12, color: "#94A3B8", padding: 12 }}>No tab yet — ＋ New tab, or Import file to start from her real file.</div>}
        {tab && (
          <table style={{ borderCollapse: "collapse", fontSize: 12, background: "#fff", tableLayout: "fixed", width: SHOWN_COLUMNS.reduce((s, c) => s + (liveW[c.key] || (tab.widths || {})[c.key] || c.width), liveW[ROW_HEAD_KEY] || (tab.widths || {})[ROW_HEAD_KEY] || 150) }}>
            <thead><tr>
{(() => { const w = liveW[ROW_HEAD_KEY] || (tab.widths || {})[ROW_HEAD_KEY] || 150;   /* v7.31.0 (WB-1): the first column is sized like the others */
                return <th style={{ position: "sticky", top: 0, zIndex: 2, background: "#F1F5F9", border: "1px solid #E5E7EB", padding: "5px 6px", width: w, minWidth: w, maxWidth: w, textAlign: "left", fontSize: 11, overflow: "hidden" }}>#
                  <span data-col-resize={ROW_HEAD_KEY} title="drag to change the width" onMouseDown={e => { e.preventDefault(); drag.current = { kind: "col", key: ROW_HEAD_KEY, x: e.clientX, start: w, tabId: tab.id }; }} style={{ position: "absolute", top: 0, right: 0, width: 6, height: "100%", cursor: "col-resize" }} /></th>; })()}
              {SHOWN_COLUMNS.map(c => { const w = liveW[c.key] || (tab.widths || {})[c.key] || c.width;
              return <th key={c.key} style={{ position: "sticky", top: 0, zIndex: 1, background: "#F1F5F9", border: "1px solid #E5E7EB", padding: "5px 6px", textAlign: "left", fontSize: 11, width: w, minWidth: w, maxWidth: w, whiteSpace: "nowrap", overflow: "hidden" }}>{c.label}
              <span data-col-resize={c.key} title="drag to change the width" onMouseDown={e => { e.preventDefault(); drag.current = { kind: "col", key: c.key, x: e.clientX, start: w, tabId: tab.id }; }} style={{ position: "absolute", top: 0, right: 0, width: 6, height: "100%", cursor: "col-resize" }} /></th>; })}
            </tr></thead>
            <tbody>
              {tab.rows.map((r, ri) => (
                <tr key={r.id} style={{ background: r.frozen ? "#F1F5F9" : "#fff", height: liveH[r.id] || r.height || undefined }}>
                <td style={{ border: "1px solid #E5E7EB", padding: "2px 4px", whiteSpace: "nowrap", fontSize: 11, position: "relative", verticalAlign: "top" }}>
                <span data-row-resize={r.id} title="drag to change the height" onMouseDown={e => { e.preventDefault(); const trEl = (e.target as any).closest("tr"); drag.current = { kind: "row", id: r.id, y: e.clientY, start: (trEl && trEl.getBoundingClientRect().height) || r.height || 30, tabId: tab.id }; }} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 5, cursor: "row-resize" }} />
                    <b style={{ display: "inline-block", width: 22 }}>{ri + 1}</b>
                    <button title="insert a row above" onClick={() => addRow(ri)} style={{ border: "none", background: "none", cursor: "pointer" }}>↥</button>
                    <button title="insert a row below" onClick={() => addRow(ri + 1)} style={{ border: "none", background: "none", cursor: "pointer" }}>↧</button>
                    <button title="duplicate the row" onClick={() => duplicateRow(ri)} style={{ border: "none", background: "none", cursor: "pointer" }}>⧉</button>
                    <button title={r.frozen ? "unfreeze" : "freeze on loading day"} onClick={() => toggleFreeze(ri)} style={{ border: "none", background: "none", cursor: "pointer" }}>{r.frozen ? "🔒" : "🔓"}</button>
                    <button title="delete the row" onClick={() => deleteRow(ri)} style={{ border: "none", background: "none", cursor: "pointer", color: "#B91C1C", fontWeight: 800 }}>Delete</button>
                  </td>
                  {SHOWN_COLUMNS.map((c, ci) => { const st: any = (r.styles || {})[c.key] || {}; const here = sel.row === ri && sel.col === ci; const txt = shownText(r, c); const doubt = doubtful(r, c);
                    return <td key={c.key} data-sheet-cell={`${ri}:${ci}`} onMouseDown={() => { if (!(editing && here)) { if (editing) setEditing(null); setSel({ row: ri, col: ci }); backToGrid(); } }} onDoubleClick={() => { setSel({ row: ri, col: ci }); if (!r.frozen) setEditing({}); }}
                      style={{ border: "1px solid #E5E7EB", padding: 0, verticalAlign: "top", background: st.fill || (doubt ? "#FFFBEB" : undefined), outline: here ? "2px solid #2563EB" : undefined, outlineOffset: -2, overflow: "hidden", cursor: "cell" }} title={doubt || (txt.length > 24 || txt.includes("\n") ? txt : "")}>
                      {here && editing ? editor(r, c) : <div style={{ padding: "4px 5px", minHeight: 24, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.35, fontWeight: st.b ? 800 : undefined, color: st.color || (r.frozen ? "#64748B" : undefined), boxShadow: doubt ? "inset 0 0 0 1px #F59E0B" : undefined }}>{txt}</div>}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab && <button onClick={() => addRow()} style={{ ...btn, marginTop: 8 }}>＋ Add row</button>}
      </div>
    </div>
  );
}
