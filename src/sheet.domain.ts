// ─────────────────────────────────────────────────────────────────────────────
// sheet.domain.ts — v6.99.63 (A-SH-1…13, owner 25 Sept)
// THE PLANNING SHEET: the dispatcher's weekly workbook inside the system — tabs, rows, cells — deliberately writing to NO
// module until we have studied how it is filled (when, how often it changes, when it becomes solid). Every change is logged
// so that study can be done on facts. Pure helpers only; the screen is PlanningSheet.tsx.
// ─────────────────────────────────────────────────────────────────────────────
const S = (v: any) => String(v ?? "").trim();

export type CellKind = "text" | "date" | "list" | "product";
export interface SheetCol { key: string; label: string; kind: CellKind; list?: "clients" | "suppliers" | "ports" | "places" | "carriers" | "forwarders" | "orders"; width: number; }
/** Her columns in her order; the owner's additions: SO (after Client), Controlling person (after Production date), ETD and ETA as two dates. */
export const SHEET_COLUMNS: SheetCol[] = [
  { key: "product", label: "Product", kind: "product", width: 230 },
  { key: "purchasePrice", label: "Purchase Price", kind: "text", width: 100 },
  { key: "salesPrice", label: "Sales Price", kind: "text", width: 100 },
  { key: "client", label: "Client", kind: "list", list: "clients", width: 150 },
  { key: "so", label: "SO", kind: "list", list: "orders", width: 120 },
  { key: "packaging", label: "Foil & stickers & boxes", kind: "text", width: 150 },
  { key: "invoiceNo", label: "Invoice No", kind: "text", width: 110 },
  { key: "ip", label: "IP", kind: "text", width: 120 },
  { key: "acid", label: "ACID", kind: "text", width: 160 },
  { key: "productionDate", label: "Production date", kind: "date", width: 130 },
  { key: "controller", label: "Controlling person", kind: "text", width: 140 },
  { key: "pos", label: "POS", kind: "list", list: "ports", width: 120 },
  { key: "pod", label: "POD", kind: "list", list: "ports", width: 120 },
  { key: "supplier", label: "Supplier name", kind: "list", list: "suppliers", width: 150 },
  { key: "loadingDate", label: "Date of loading", kind: "date", width: 130 },
  { key: "unloadingDate", label: "Date of unloading", kind: "date", width: 130 },
  { key: "truckCarrier", label: "Transport 1 / truck", kind: "list", list: "carriers", width: 150 },
  { key: "truckPrice", label: "Price", kind: "text", width: 90 },
  { key: "plates", label: "PLATES", kind: "text", width: 140 },
  { key: "loadingPlace", label: "Loading place", kind: "list", list: "places", width: 170 },
  { key: "driver", label: "Driver", kind: "text", width: 150 },
  { key: "containerCarrier", label: "Transport 2 / CTR", kind: "list", list: "forwarders", width: 150 },
  { key: "unloadingPlace", label: "Unloading place", kind: "list", list: "places", width: 170 },
  { key: "unloadingTime", label: "Time of unloading", kind: "text", width: 110 },
  { key: "containerPrice", label: "Price", kind: "text", width: 90 },
  { key: "comments", label: "Comments", kind: "text", width: 180 },
  { key: "shippingLine", label: "Shipping line", kind: "text", width: 120 },
  { key: "etd", label: "ETD", kind: "date", width: 130 },
  { key: "eta", label: "ETA", kind: "date", width: 130 },
];

export interface SheetRow { id: string; createdAt: string; frozen?: boolean; cells: Record<string, any>; }
export interface SheetTab { id: string; name: string; order: number; createdAt: string; rows: SheetRow[]; }
export interface SheetLogEntry { at: string; who: string; tab: string; row?: string; col?: string; old?: any; now?: any; action: "cell" | "row+" | "row-" | "freeze" | "unfreeze" | "tab+" | "tab-" | "rename" | "import" | "paste"; }

let seq = 0;
export function sid(prefix: string): string { seq = (seq + 1) % 100000; return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`; }
export function blankRow(now: string): SheetRow { return { id: sid("r"), createdAt: now, cells: {} }; }

/** Dates typed or pasted as 13/09, 13.09.2026, 13-09-26 or ISO → ISO; anything else stays as typed (shown amber). */
export function toISODate(v: any, yearHint?: number): string | null {
  const s = S(v); if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/);
  if (m) { const y = m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : String(yearHint || new Date().getFullYear()); const mo = m[2].padStart(2, "0"), d = m[1].padStart(2, "0"); if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) return `${y}-${mo}-${d}`; }
  return null;
}
/** Tab-separated text (copied from Excel) → a grid of strings. */
export function parseClipboard(text: string): string[][] {
  const t = String(text || "").replace(/\r\n/g, "\n").replace(/\n$/, "");
  return t.split("\n").map(line => line.split("\t"));
}
/** The value a pasted/typed string becomes in a column. */
export function coerce(col: SheetCol, raw: any, yearHint?: number): any {
  if (col.kind === "date") { const iso = toISODate(raw, yearHint); return iso === null ? S(raw) : iso; }
  if (col.kind === "product") return { item: S(raw), variety: "", size: "" };
  return S(raw);
}
/** Paste a grid at (row, col) — fills right and down, adds rows when needed; frozen rows are skipped, never overwritten. */
export function pasteGrid(rows: SheetRow[], at: { row: number; col: number }, grid: string[][], now: string, yearHint?: number): { rows: SheetRow[]; changed: Array<{ row: string; col: string; old: any; now: any }> } {
  const out = rows.map(r => ({ ...r, cells: { ...r.cells } })); const changed: Array<{ row: string; col: string; old: any; now: any }> = [];
  grid.forEach((line, dr) => {
    const ri = at.row + dr; while (out.length <= ri) out.push(blankRow(now));
    const r = out[ri]; if (r.frozen) return;
    line.forEach((raw, dc) => { const col = SHEET_COLUMNS[at.col + dc]; if (!col) return; const v = coerce(col, raw, yearHint); const old = r.cells[col.key]; if (JSON.stringify(old ?? "") !== JSON.stringify(v ?? "")) { r.cells[col.key] = v; changed.push({ row: r.id, col: col.key, old, now: v }); } });
  });
  return { rows: out, changed };
}
export function productText(v: any): string { if (!v) return ""; if (typeof v === "string") return v; return [v.item, v.variety, v.size].map(S).filter(Boolean).join(" "); }
/** Grid of the tab as strings in the sheet's column order (copy, export). */
export function tabToGrid(tab: SheetTab): string[][] { return (tab.rows || []).map(r => SHEET_COLUMNS.map(c => c.kind === "product" ? productText(r.cells[c.key]) : S(r.cells[c.key]))); }

/** Import her workbook AS IT IS: one tab per sheet, rows unchanged; ETD–ETA and 'Production date / controlling person' split. */
export function importWorkbookRows(sheetName: string, matrix: any[][], headerMap: Record<string, string>, now: string): SheetTab {
  const header = (matrix[0] || []).map((h: any) => S(h).replace(/\s+/g, " "));
  const map: Record<number, string> = {}; let priceSeen = 0;
  header.forEach((h, c) => { if (h === "Price") { priceSeen++; map[c] = priceSeen === 1 ? "truckPrice" : "containerPrice"; return; } const k = headerMap[h] || headerMap[h.replace(/\s+$/, "")]; if (k) map[c] = k; });
  const year = new Date(now).getFullYear();
  const rows: SheetRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r] || []; const cells: Record<string, any> = {}; let filled = 0;
    Object.entries(map).forEach(([c, k]) => {
      const v0 = line[Number(c)]; if (v0 === undefined || v0 === null || S(v0) === "") return; filled++;
      const v = v0 instanceof Date ? v0.toISOString().slice(0, 10) : S(v0);
      if (k === "etdEta") { const [a, b] = S(v).replace(/\bET[AD]\b[:.]?\s*/gi, "").split(/\s*[-–]\s*/).filter(x => S(x)); /* "ETD 07/09 - ETA 18/09" as well as "07/09 - 18/09" */ const strip = (x: any) => S(x).replace(/^[A-Z]{2,5}\s+(?=\d)/, ""); const e1 = toISODate(strip(a), year), e2 = toISODate(strip(b), year);   /* "DAM 15/09" → 15/09 (the port is in POD) */ cells.etd = e1 === null ? S(a) : e1; if (b) cells.eta = e2 === null ? S(b) : e2; return; }
      if (k === "controller") {   // "31.08.2026 / JDR & HZM", "JDR 08.09.2026" — one date and the person(s); several dates stay as typed
        const t = S(v); const dates = t.match(/\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?/g) || [];
        if (dates.length === 1) { const iso = toISODate(dates[0], year); cells.productionDate = iso === null ? dates[0] : iso; const who = S(t.replace(dates[0], "")).replace(/^[/;,\s-]+|[/;,\s-]+$/g, ""); if (who) cells.controller = who; }
        else cells.controller = t; return; }
      if (k === "product") { cells.product = { item: S(v), variety: "", size: "" }; return; }
      if (k === "loadingDate" || k === "unloadingDate") { const iso = toISODate(v, year); cells[k] = iso === null ? S(v) : iso; return; }
      cells[k] = S(v);
    });
    if (filled >= 2) rows.push({ id: sid("r"), createdAt: now, cells });
  }
  return { id: sid("t"), name: sheetName, order: 0, createdAt: now, rows };
}

/** SH-12 — how the sheet is used, from the change log alone. */
export interface ColumnUsage { key: string; label: string; filledPct: number; medianDaysBeforeLoading: number | null; avgChangesAfterFirst: number; changedAfterFreeze: number; }
export function sheetUsage(tabs: SheetTab[], log: SheetLogEntry[]): ColumnUsage[] {
  const rows = (tabs || []).flatMap(t => t.rows || []);
  const byRowCol = new Map<string, SheetLogEntry[]>();
  (log || []).filter(e => e.action === "cell" || e.action === "paste").forEach(e => { const k = `${e.row}|${e.col}`; if (!byRowCol.has(k)) byRowCol.set(k, []); byRowCol.get(k)!.push(e); });
  const frozenAt = new Map<string, string>(); (log || []).filter(e => e.action === "freeze" && e.row).forEach(e => { if (!frozenAt.has(e.row!)) frozenAt.set(e.row!, e.at); });
  const days = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
  return SHEET_COLUMNS.map(c => {
    const filled = rows.filter(r => { const v = r.cells[c.key]; return c.kind === "product" ? !!productText(v) : S(v) !== ""; }).length;
    const lead: number[] = []; let changes = 0, withAny = 0, afterFreeze = 0;
    rows.forEach(r => { const es = (byRowCol.get(`${r.id}|${c.key}`) || []).sort((a, b) => a.at.localeCompare(b.at)); if (!es.length) return; withAny++; changes += Math.max(0, es.length - 1);
      const ld = S(r.cells.loadingDate); if (/^\d{4}-\d{2}-\d{2}$/.test(ld)) lead.push(days(es[0].at.slice(0, 10), ld));
      const fz = frozenAt.get(r.id); if (fz) afterFreeze += es.filter(e => e.at > fz).length; });
    lead.sort((a, b) => a - b);
    return { key: c.key, label: c.label, filledPct: rows.length ? Math.round((filled / rows.length) * 100) : 0, medianDaysBeforeLoading: lead.length ? lead[Math.floor(lead.length / 2)] : null, avgChangesAfterFirst: withAny ? Math.round((changes / withAny) * 10) / 10 : 0, changedAfterFreeze: afterFreeze };
  });
}
