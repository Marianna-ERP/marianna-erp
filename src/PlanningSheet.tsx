// ─────────────────────────────────────────────────────────────────────────────
// PlanningSheet.tsx — v6.99.63 (A-SH-1…13, owner 25 Sept)
// The weekly planning sheet: tabs · rows · cells, like her Excel, INSIDE the system and writing to NO module. Cells save as
// typed (there are no gates here to bypass). Every change is logged for the study of how the sheet is filled.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { SHEET_COLUMNS, SheetTab, SheetRow, SheetLogEntry, blankRow, sid, parseClipboard, pasteGrid, productText, tabToGrid, importWorkbookRows, sheetUsage, toISODate } from "./sheet.domain";
import { HER_HEADERS } from "./board.domain";
import { unifiedLocations } from "./locations";

const S = (v: any) => String(v ?? "").trim();
const nowISO = () => new Date().toISOString();
const rolesOf = (c: any) => (Array.isArray(c?.roles) && c.roles.length ? c.roles : [c?.type, ...(c?.additionalTypes || [])]).map((x: any) => String(x || ""));

export default function PlanningSheet({ tabs = [], setTabs, log = [], setLog, contacts = [], catalog = [], orders = [], invoices = [], userName = "" }: any) {
  const sorted: SheetTab[] = useMemo(() => [...(tabs || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [tabs]);
  const [activeId, setActiveId] = useState<string>("");
  const tab = sorted.find(t => t.id === activeId) || sorted[sorted.length - 1] || null;
  const [sel, setSel] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const [showUsage, setShowUsage] = useState(false);
  const who = userName || "user";

  // ── the Directory lists the dropdown cells choose from ──
  const lists = useMemo(() => {
    const by = (r: string) => (contacts || []).filter((c: any) => rolesOf(c).includes(r)).map((c: any) => c.name).filter(Boolean).sort((a: string, b: string) => a.localeCompare(b, "pl"));
    const locs = unifiedLocations(contacts || []);
    const ports = locs.filter((l: any) => String(l.type) === "Port" || String((l as any).legacyType) === "PORT").map((l: any) => l.name);
    return { clients: by("Client"), suppliers: by("Supplier"), carriers: by("Carrier"), forwarders: Array.from(new Set([...by("Forwarder"), ...by("Shipping line")])),
      ports: Array.from(new Set(ports)).sort(), places: Array.from(new Set(locs.map((l: any) => l.name))).sort(),
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
  function duplicateRow(i: number) { if (!tab) return; const src = tab.rows[i]; const r = { ...blankRow(nowISO()), cells: JSON.parse(JSON.stringify(src.cells)) }; updateTab(tab.id, t => { const rows = [...t.rows]; rows.splice(i + 1, 0, r); return { ...t, rows }; }); addLog([{ at: nowISO(), who, tab: tab.id, row: r.id, action: "row+" }]); }
  function deleteRow(i: number) { if (!tab) return; const r = tab.rows[i]; if (r.frozen) { window.alert("A frozen row cannot be deleted — unfreeze it first."); return; } if (!window.confirm("Delete this row?")) return; updateTab(tab.id, t => ({ ...t, rows: t.rows.filter((_, k) => k !== i) })); addLog([{ at: nowISO(), who, tab: tab.id, row: r.id, action: "row-" }]); }
  function toggleFreeze(i: number) { if (!tab) return; const r = tab.rows[i]; if (r.frozen && !window.confirm("Unfreeze this row? It becomes editable again (recorded).")) return; updateTab(tab.id, t => ({ ...t, rows: t.rows.map((x, k) => k === i ? { ...x, frozen: !x.frozen } : x) })); addLog([{ at: nowISO(), who, tab: tab.id, row: r.id, action: r.frozen ? "unfreeze" : "freeze" }]); }
  // ── tabs ──
  function newTab() { const name = window.prompt("Name of the new tab", `week ${sorted.length + 1}`); if (!name) return; const t: SheetTab = { id: sid("t"), name: S(name), order: (sorted[sorted.length - 1]?.order ?? 0) + 1, createdAt: nowISO(), rows: [blankRow(nowISO())] }; setTabs((prev: SheetTab[]) => [...(prev || []), t]); setActiveId(t.id); addLog([{ at: nowISO(), who, tab: t.id, action: "tab+", now: t.name }]); }
  function renameTab() { if (!tab) return; const name = window.prompt("Rename the tab", tab.name); if (!name || S(name) === tab.name) return; updateTab(tab.id, t => ({ ...t, name: S(name) })); addLog([{ at: nowISO(), who, tab: tab.id, action: "rename", old: tab.name, now: S(name) }]); }
  function moveTab(dir: -1 | 1) { if (!tab) return; const i = sorted.findIndex(t => t.id === tab.id); const j = i + dir; if (j < 0 || j >= sorted.length) return; const a = sorted[i], b = sorted[j]; setTabs((prev: SheetTab[]) => (prev || []).map(t => t.id === a.id ? { ...t, order: b.order } : t.id === b.id ? { ...t, order: a.order } : t)); }
  function deleteTab() { if (!tab) return; if (tab.rows.some(r => r.frozen)) { window.alert("This tab has frozen rows — unfreeze them before deleting the tab."); return; } if (!window.confirm(`Delete the tab "${tab.name}" and its ${tab.rows.length} row(s)?`)) return; setTabs((prev: SheetTab[]) => (prev || []).filter(t => t.id !== tab.id)); addLog([{ at: nowISO(), who, tab: tab.id, action: "tab-", old: tab.name }]); setActiveId(""); }
  function freezeTab() { if (!tab) return; if (!window.confirm(`Freeze every row of "${tab.name}"?`)) return; updateTab(tab.id, t => ({ ...t, rows: t.rows.map(r => ({ ...r, frozen: true })) })); addLog(tab.rows.filter(r => !r.frozen).map(r => ({ at: nowISO(), who, tab: tab.id, row: r.id, action: "freeze" as const }))); }
  // ── paste a block from Excel ──
  function onPaste(e: React.ClipboardEvent) {
    if (!tab) return; const text = e.clipboardData.getData("text/plain"); if (!/[\t\n]/.test(text)) return;   // a single value pastes normally into the cell
    e.preventDefault();
    const res = pasteGrid(tab.rows, sel, parseClipboard(text), nowISO(), new Date().getFullYear());
    updateTab(tab.id, t => ({ ...t, rows: res.rows }));
    addLog(res.changed.map(c => ({ at: nowISO(), who, tab: tab.id, row: c.row, col: c.col, old: c.old, now: c.now, action: "paste" as const })));
  }
  function copyTab() { if (!tab) return; const tsv = [SHEET_COLUMNS.map(c => c.label), ...tabToGrid(tab)].map(r => r.join("\t")).join("\n"); try { navigator.clipboard.writeText(tsv); } catch { /* ignore */ } }
  // ── her workbook in, the sheet out ──
  function importFile(f: any) {
    if (!f) return; const rd = new FileReader();
    rd.onload = () => { const wb = XLSX.read(rd.result, { type: "array", cellDates: true }); let order = (sorted[sorted.length - 1]?.order ?? 0);
      const added: SheetTab[] = wb.SheetNames.map(n => ({ ...importWorkbookRows(n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) as any[][], HER_HEADERS, nowISO()), order: ++order }));
      if (!window.confirm(`Import ${added.length} tab(s), ${added.reduce((s, t) => s + t.rows.length, 0)} row(s) from ${f.name}? Existing tabs are kept.`)) return;
      setTabs((prev: SheetTab[]) => [...(prev || []), ...added]); addLog(added.map(t => ({ at: nowISO(), who, tab: t.id, action: "import" as const, now: `${t.name} · ${t.rows.length} rows from ${f.name}` }))); if (added[0]) setActiveId(added[0].id); };
    rd.readAsArrayBuffer(f);
  }
  function exportXlsx(all: boolean) {
    const wb = XLSX.utils.book_new(); const list = all ? sorted : (tab ? [tab] : []);
    list.forEach(t => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([SHEET_COLUMNS.map(c => c.label), ...tabToGrid(t)]), t.name.slice(0, 31) || "sheet"));
    if (list.length) XLSX.writeFile(wb, `Planning_sheet_${all ? "all" : (tab?.name || "tab").replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
  function exportLog() { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["when", "who", "action", "tab", "row", "column", "old", "new"], ...(log || []).map((e: SheetLogEntry) => [e.at, e.who, e.action, (sorted.find(t => t.id === e.tab)?.name) || e.tab, e.row || "", e.col || "", typeof e.old === "object" ? productText(e.old) : S(e.old), typeof e.now === "object" ? productText(e.now) : S(e.now)])]), "change log"); XLSX.writeFile(wb, `Planning_sheet_changes_${new Date().toISOString().slice(0, 10)}.xlsx`); }

  const inp: any = { width: "100%", border: "1px solid transparent", background: "transparent", padding: "4px 5px", fontSize: 12, borderRadius: 4, boxSizing: "border-box" };
  const amber = { ...inp, border: "1px solid #F59E0B", background: "#FFFBEB" };
  const btn: any = { fontSize: 11.5, border: "1px solid #E5E7EB", background: "#fff", borderRadius: 7, padding: "5px 10px", cursor: "pointer" };

  function Cell({ r, ri, ci }: { r: SheetRow; ri: number; ci: number }) {
    const c = SHEET_COLUMNS[ci]; const v = r.cells[c.key]; const dis = !!r.frozen;
    const focus = () => setSel({ row: ri, col: ci });
    const k = `${r.id}-${c.key}-${JSON.stringify(v ?? "")}`;
    if (c.kind === "product") { const p = typeof v === "object" && v ? v : { item: S(v), variety: "", size: "" }; const inCat = !p.item || (lists.items || []).includes(p.item);
      return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 60px", gap: 2 }}>
        <input key={k + "i"} list="ps-items" disabled={dis} defaultValue={p.item} placeholder="item" onFocus={focus} onBlur={e => commit(r, c.key, { ...p, item: S(e.target.value) })} style={inCat ? inp : amber} title={inCat ? "" : "not in the product catalogue"} />
        <input key={k + "v"} list="ps-varieties" disabled={dis} defaultValue={p.variety} placeholder="variety" onFocus={focus} onBlur={e => commit(r, c.key, { ...p, variety: S(e.target.value) })} style={inp} />
        <input key={k + "s"} disabled={dis} defaultValue={p.size} placeholder="size" onFocus={focus} onBlur={e => commit(r, c.key, { ...p, size: S(e.target.value) })} style={inp} /></div>; }
    if (c.kind === "date") { const iso = !S(v) || /^\d{4}-\d{2}-\d{2}$/.test(S(v));
      return iso ? <input key={k} type="date" disabled={dis} defaultValue={S(v)} onFocus={focus} onChange={e => commit(r, c.key, e.target.value)} style={inp} />
        : <input key={k} disabled={dis} defaultValue={S(v)} onFocus={focus} title="not a date — type dd/mm/yyyy" onBlur={e => { const t = toISODate(e.target.value); commit(r, c.key, t === null ? S(e.target.value) : t); }} style={amber} />; }
    if (c.kind === "list") { const known = !S(v) || (lists[c.list!] || []).includes(S(v));
      return <input key={k} list={"ps-" + c.list} disabled={dis} defaultValue={S(v)} onFocus={focus} onBlur={e => commit(r, c.key, S(e.target.value))} style={known ? inp : amber} title={known ? "" : "not in the Directory"} />; }
    return <input key={k} disabled={dis} defaultValue={S(v)} onFocus={focus} onBlur={e => commit(r, c.key, S(e.target.value))} style={inp} />;
  }

  const usage = showUsage ? sheetUsage(sorted, log || []) : [];
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#FAFAFA" }}>
      {["clients", "suppliers", "carriers", "forwarders", "ports", "places", "orders", "items", "varieties"].map(k => <datalist key={k} id={"ps-" + k}>{(lists[k] || []).map((x: string) => <option key={x} value={x} />)}</datalist>)}
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "8px 16px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>Planning sheet</div>
        <div style={{ fontSize: 11, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, padding: "2px 8px" }}>a planning sheet — it writes to no module; every change is recorded for the study</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ ...btn, borderStyle: "dashed", color: "#1E40AF" }}>⬆ Import her workbook<input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => importFile(e.target.files?.[0])} /></label>
          <button style={btn} onClick={() => exportXlsx(false)} disabled={!tab}>⬇ Export this tab</button>
          <button style={btn} onClick={() => exportXlsx(true)} disabled={!sorted.length}>⬇ Export all tabs</button>
          <button style={btn} onClick={copyTab} disabled={!tab} title="copies the tab as a table you can paste into Excel">⧉ Copy tab</button>
          <button style={{ ...btn, background: showUsage ? "#0F172A" : "#fff", color: showUsage ? "#fff" : "#111" }} onClick={() => setShowUsage(!showUsage)}>How the sheet is used</button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, padding: "8px 16px 0", borderBottom: "1px solid #EBEBEB", background: "#fff", alignItems: "flex-end", overflowX: "auto" }}>
        {sorted.map(t => <button key={t.id} onClick={() => setActiveId(t.id)} style={{ padding: "6px 12px", border: "1px solid #E5E7EB", borderBottom: tab && tab.id === t.id ? "2px solid #0F172A" : "1px solid #E5E7EB", background: tab && tab.id === t.id ? "#fff" : "#F8FAFC", borderRadius: "8px 8px 0 0", fontSize: 12, fontWeight: tab && tab.id === t.id ? 800 : 500, cursor: "pointer", whiteSpace: "nowrap" }}>{t.name} <span style={{ color: "#94A3B8" }}>· {t.rows.length}</span></button>)}
        <button onClick={newTab} style={{ ...btn, marginBottom: 2 }}>＋ New tab</button>
        {tab && <span style={{ display: "inline-flex", gap: 4, marginLeft: 8, marginBottom: 2 }}>
          <button style={btn} onClick={() => moveTab(-1)} title="move left">◀</button><button style={btn} onClick={() => moveTab(1)} title="move right">▶</button>
          <button style={btn} onClick={renameTab}>✎ Rename</button><button style={btn} onClick={freezeTab}>🔒 Freeze tab</button>
          <button style={{ ...btn, color: "#B91C1C", borderColor: "#FECACA" }} onClick={deleteTab}>✕ Delete tab</button></span>}
      </div>
      {showUsage && (
        <div style={{ margin: "10px 16px 0", border: "1px solid #E5E7EB", background: "#fff", borderRadius: 8, padding: "8px 10px", maxHeight: 260, overflow: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}><div style={{ fontSize: 12, fontWeight: 800 }}>How the sheet is used — from {(log || []).length} recorded change(s)</div><button style={{ ...btn, marginLeft: "auto" }} onClick={exportLog}>⬇ Export the change log</button></div>
          <table style={{ borderCollapse: "collapse", fontSize: 11.5, width: "100%" }}>
            <thead><tr>{["Column", "Filled", "First filled (median days before loading)", "Changes after the first fill (avg)", "Changes after freezing"].map(h => <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #E5E7EB", padding: "3px 6px", color: "#64748B" }}>{h}</th>)}</tr></thead>
            <tbody>{usage.map(u => <tr key={u.key}><td style={{ padding: "3px 6px" }}>{u.label}</td><td style={{ padding: "3px 6px" }}>{u.filledPct}%</td><td style={{ padding: "3px 6px" }}>{u.medianDaysBeforeLoading === null ? "—" : u.medianDaysBeforeLoading}</td><td style={{ padding: "3px 6px" }}>{u.avgChangesAfterFirst}</td><td style={{ padding: "3px 6px", color: u.changedAfterFreeze ? "#B91C1C" : undefined, fontWeight: u.changedAfterFreeze ? 800 : 400 }}>{u.changedAfterFreeze}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <div style={{ flex: 1, overflow: "auto", padding: "10px 16px" }} onPaste={onPaste}>
        {!tab && <div style={{ fontSize: 12.5, color: "#94A3B8", padding: 12 }}>No tab yet — ＋ New tab, or ⬆ Import her workbook to start from her real file.</div>}
        {tab && (
          <table style={{ borderCollapse: "collapse", fontSize: 12, background: "#fff", minWidth: SHEET_COLUMNS.reduce((s, c) => s + c.width, 150) }}>
            <thead><tr>
              <th style={{ position: "sticky", top: 0, zIndex: 2, background: "#F1F5F9", border: "1px solid #E5E7EB", padding: "5px 6px", width: 150, textAlign: "left", fontSize: 11 }}>#</th>
              {SHEET_COLUMNS.map(c => <th key={c.key} style={{ position: "sticky", top: 0, zIndex: 1, background: "#F1F5F9", border: "1px solid #E5E7EB", padding: "5px 6px", textAlign: "left", fontSize: 11, minWidth: c.width, whiteSpace: "nowrap" }}>{c.label}</th>)}
            </tr></thead>
            <tbody>
              {tab.rows.map((r, ri) => (
                <tr key={r.id} style={{ background: r.frozen ? "#F1F5F9" : "#fff" }}>
                  <td style={{ border: "1px solid #E5E7EB", padding: "2px 4px", whiteSpace: "nowrap", fontSize: 11 }}>
                    <b style={{ display: "inline-block", width: 22 }}>{ri + 1}</b>
                    <button title="insert a row above" onClick={() => addRow(ri)} style={{ border: "none", background: "none", cursor: "pointer" }}>↥</button>
                    <button title="insert a row below" onClick={() => addRow(ri + 1)} style={{ border: "none", background: "none", cursor: "pointer" }}>↧</button>
                    <button title="duplicate the row" onClick={() => duplicateRow(ri)} style={{ border: "none", background: "none", cursor: "pointer" }}>⧉</button>
                    <button title={r.frozen ? "unfreeze" : "freeze on loading day"} onClick={() => toggleFreeze(ri)} style={{ border: "none", background: "none", cursor: "pointer" }}>{r.frozen ? "🔒" : "🔓"}</button>
                    <button title="delete the row" onClick={() => deleteRow(ri)} style={{ border: "none", background: "none", cursor: "pointer", color: "#B91C1C" }}>✕</button>
                  </td>
                  {SHEET_COLUMNS.map((c, ci) => <td key={c.key} style={{ border: "1px solid #E5E7EB", padding: 0, outline: sel.row === ri && sel.col === ci ? "2px solid #2563EB" : undefined }}><Cell r={r} ri={ri} ci={ci} /></td>)}
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
