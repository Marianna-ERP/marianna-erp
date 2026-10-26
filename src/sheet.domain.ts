import { localISO } from "./dates";
// ─────────────────────────────────────────────────────────────────────────────
import { S } from "./format";
// sheet.domain.ts — v6.99.63 (A-SH-1…13, owner 25 Sept)
// THE PLANNING SHEET: the dispatcher's weekly workbook inside the system — tabs, rows, cells — deliberately writing to NO
// module until we have studied how it is filled (when, how often it changes, when it becomes solid). Every change is logged
// so that study can be done on facts. Pure helpers only; the screen is PlanningSheet.tsx.
// ─────────────────────────────────────────────────────────────────────────────

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

// v7.30.17 (owner test 21 Oct: "like an excel sheet — another line in the same cell, cell height and width, bold letters and colours
// for the letters and the cells"): the sheet keeps its own LOOK beside its content — a row's height, a tab's column widths, a cell's
// bold / text colour / fill. Presentation only: never logged for the study, never read by any module.
export interface CellStyle { b?: boolean; color?: string; fill?: string; }
export interface SheetRow { id: string; createdAt: string; frozen?: boolean; cells: Record<string, any>; height?: number; styles?: Record<string, CellStyle>; }
export interface SheetTab { id: string; name: string; order: number; createdAt: string; rows: SheetRow[]; widths?: Record<string, number>; }
export const TEXT_COLOURS = ["#111827", "#B91C1C", "#C2410C", "#15803D", "#1D4ED8", "#7E22CE", "#6B7280"];
export const FILL_COLOURS = ["#FEF08A", "#FECACA", "#FED7AA", "#BBF7D0", "#BFDBFE", "#E9D5FF", "#E5E7EB"];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
/** A cell's look changed (a patch value of null clears that part; an empty look is removed). */
export function setCellStyle(tab: SheetTab, rowId: string, key: string, patch: Partial<Record<keyof CellStyle, any>> | null): SheetTab {
return { ...tab, rows: (tab.rows || []).map(r => {
if (r.id !== rowId) return r;
const cur: any = { ...((r.styles || {})[key] || {}) };
if (patch === null) { Object.keys(cur).forEach(k => delete cur[k]); } else Object.entries(patch).forEach(([k, v]) => { if (v === null || v === undefined || v === false || v === "") delete cur[k]; else cur[k] = v; });
const styles: any = { ...(r.styles || {}) }; if (Object.keys(cur).length) styles[key] = cur; else delete styles[key];
const n: any = { ...r, styles }; if (!Object.keys(styles).length) delete n.styles; return n;
}) };
}
/** A column's width (50–600 px) and a row's height (24–400 px), as dragged. */
export function setColWidth(tab: SheetTab, key: string, px: number): SheetTab { return { ...tab, widths: { ...(tab.widths || {}), [key]: clamp(px, 50, 600) } }; }
export function setRowHeight(tab: SheetTab, rowId: string, px: number): SheetTab { return { ...tab, rows: (tab.rows || []).map(r => r.id === rowId ? { ...r, height: clamp(px, 24, 400) } : r) }; }
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
/** Tab-separated text (copied from Excel) → a grid of strings. v7.31.0 (WB-6): Excel's quoting is read — a cell that holds several
*  lines or a tab comes "…" (with "" for a quote) and stays ONE cell. */
export function parseClipboard(text: string): string[][] {
const t = String(text || "").replace(/\r\n/g, "\n").replace(/\n$/, "");
if (!t.includes('"')) return t.split("\n").map(line => line.split("\t"));
const rows: string[][] = []; let row: string[] = []; let cell = ""; let i = 0; let quoted = false; let atStart = true;
while (i < t.length) {
const ch = t[i];
if (quoted) { if (ch === '"' && t[i + 1] === '"') { cell += '"'; i += 2; continue; } if (ch === '"') { quoted = false; i++; continue; } cell += ch; i++; continue; }
if (ch === '"' && atStart) { quoted = true; atStart = false; i++; continue; }
if (ch === "\t") { row.push(cell); cell = ""; atStart = true; i++; continue; }
if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; atStart = true; i++; continue; }
cell += ch; atStart = false; i++;
}
row.push(cell); rows.push(row); return rows;
}
/** The value a pasted/typed string becomes in a column. */
/** v7.31.0 (WB-5, owner 21 Oct: "some cases the production of a container is done on more days so we write 20-21/10"): what a date
*  cell holds, read — one date (13/09, 13.09.2026, 2026-09-13), or a range kept as written ("20-21/10", "20/10-22/10") whose FIRST
*  day is the date the system reads; null when it is neither. */
export function readSheetDate(v: any, yearHint?: number): { iso: string | null; range: boolean } {
const s = S(v); if (!s) return { iso: "", range: false };
const one = toISODate(s, yearHint); if (one !== null) return { iso: one, range: false };
let m = s.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/);
if (m) { const iso = toISODate(`${m[1]}/${m[3]}${m[4] ? "/" + m[4] : ""}`, yearHint); if (iso && +m[2] >= +m[1] && +m[2] <= 31) return { iso, range: true }; }
m = s.match(/^(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)\s*[-–]\s*(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)$/);
if (m) { const a = toISODate(m[1], yearHint), b = toISODate(m[2], yearHint); if (a && b) return { iso: a, range: true }; }
return { iso: null, range: false };
}
/** A date cell shown: one date as dd/mm/yyyy, a range as written. */
export function sheetDateText(v: any): string { const s = S(v); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; }
export function coerce(col: SheetCol, raw: any, yearHint?: number): any {
if (col.kind === "date") { const iso = toISODate(raw, yearHint); return iso === null ? S(raw) : iso; }   // a range stays as typed (readSheetDate reads its first day)
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
      const v = v0 instanceof Date ? localISO(v0) : S(v0);   // v6.99.122 (AUD-06): local day — toISOString wrote the day before in Poland
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
      const ld = readSheetDate(r.cells.loadingDate).iso || ""; if (/^\d{4}-\d{2}-\d{2}$/.test(ld)) lead.push(days(es[0].at.slice(0, 10), ld));   // v7.31.0: a range by its first day
      const fz = frozenAt.get(r.id); if (fz) afterFreeze += es.filter(e => e.at > fz).length; });
    lead.sort((a, b) => a - b);
    return { key: c.key, label: c.label, filledPct: rows.length ? Math.round((filled / rows.length) * 100) : 0, medianDaysBeforeLoading: lead.length ? lead[Math.floor(lead.length / 2)] : null, avgChangesAfterFirst: withAny ? Math.round((changes / withAny) * 10) / 10 : 0, changedAfterFreeze: afterFreeze };
  });
}

// ── v7.31.0 (WB-2, owner 21 Oct): THE COLUMNS AS SHOWN — the product as three columns (Item, Variety, Size), each with its own
// width; the stored product stays one value, so her workbook's import, the export and the study are unchanged ──
export interface ShownCol { key: string; label: string; kind: CellKind; list?: SheetCol["list"] | "items" | "varieties"; width: number; dataKey: string; part?: "item" | "variety" | "size"; }
export const SHOWN_COLUMNS: ShownCol[] = SHEET_COLUMNS.flatMap((c): ShownCol[] => c.kind === "product"
  ? [{ key: c.key + ".item", label: "Item", kind: "text", list: "items", width: 120, dataKey: c.key, part: "item" },
     { key: c.key + ".variety", label: "Variety", kind: "text", list: "varieties", width: 110, dataKey: c.key, part: "variety" },
     { key: c.key + ".size", label: "Size", kind: "text", width: 70, dataKey: c.key, part: "size" }]
  : [{ key: c.key, label: c.label, kind: c.kind, list: c.list, width: c.width, dataKey: c.key }]);
const productOf = (v: any) => (typeof v === "object" && v ? { item: S(v.item), variety: S(v.variety), size: S(v.size) } : { item: S(v), variety: "", size: "" });
/** What a shown cell holds, as text (a date as dd/mm/yyyy). */
export function shownText(row: SheetRow, col: ShownCol): string {
  const v = (row?.cells || {})[col.dataKey]; if (col.part) return productOf(v)[col.part];
  return col.kind === "date" ? sheetDateText(v) : S(v);
}
/** What writing TEXT into a shown cell stores: the product's part inside the one product; a date read as for typing; else as typed. */
export function shownValue(row: SheetRow, col: ShownCol, text: any, yearHint?: number): { key: string; value: any } {
  if (col.part) { const p = productOf((row?.cells || {})[col.dataKey]); return { key: col.dataKey, value: { ...p, [col.part]: S(text) } }; }
  const dataCol = SHEET_COLUMNS.find(c => c.key === col.dataKey)!; return { key: col.dataKey, value: coerce(dataCol, text, yearHint) };
}
/** Paste a block at a shown (row, col) — right and down, rows added when needed, frozen rows skipped. */
export function pasteShownGrid(rows: SheetRow[], at: { row: number; col: number }, grid: string[][], now: string, yearHint?: number): { rows: SheetRow[]; changed: Array<{ row: string; col: string; old: any; now: any }> } {
  const out = rows.map(r => ({ ...r, cells: { ...r.cells } })); const changed: Array<{ row: string; col: string; old: any; now: any }> = [];
  grid.forEach((line, dr) => {
    const ri = at.row + dr; while (out.length <= ri) out.push(blankRow(now));
    const r = out[ri]; if (r.frozen) return;
    line.forEach((raw, dc) => { const col = SHOWN_COLUMNS[at.col + dc]; if (!col) return; const { key, value } = shownValue(r, col, raw, yearHint); const old = r.cells[key];
      if (JSON.stringify(old ?? "") !== JSON.stringify(value ?? "")) { r.cells[key] = value; changed.push({ row: r.id, col: key, old, now: value }); } });
  });
  return { rows: out, changed };
}
/** One cell copied as Excel does: quoted when it holds several lines, a tab or a quote. */
export function cellClipboardText(text: any): string { const s = S(text); return /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
/** WB-1: the width of the first column (the row number and its buttons) is kept like any other. */
export const ROW_HEAD_KEY = "#rows";
