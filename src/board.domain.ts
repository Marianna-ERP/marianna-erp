// ─────────────────────────────────────────────────────────────────────────────
// board.domain.ts — v6.99.55 (BD-1…6, owner ruling 23 Sept)
// THE WEEKLY SHIPMENT BOARD: the dispatcher's spreadsheet as a VIEW over the modules. One row per truck, her 26 columns
// in her six steps, every cell reading from — and writing to — the module that owns it. The board stores nothing.
// ─────────────────────────────────────────────────────────────────────────────
const S = (v: any) => String(v ?? "").trim();

export type Step = 1 | 2 | 3 | 4 | 5 | 6;
export const STEP_META: Record<Step, { label: string; colour: string; bg: string }> = {
  1: { label: "1 · Purchase", colour: "#9F1239", bg: "#FFC6C6" },
  2: { label: "2 · Sea leg", colour: "#1E40AF", bg: "#E0E7FF" },
  3: { label: "3 · Truck", colour: "#5B21B6", bg: "#C5D3FF" },
  4: { label: "4 · Controller", colour: "#92400E", bg: "#FEF3C7" },
  5: { label: "5 · Plates & driver", colour: "#0369A1", bg: "#A3DBFF" },
  6: { label: "6 · Sale & documents", colour: "#166534", bg: "#DCFCE7" },
};
export interface BoardCol { key: string; label: string; step: Step; owner: "po" | "so" | "booking" | "unit" | "container" | "shipment" | "inspection" | "invoice"; width?: number; readonly?: boolean; }
/** Her 26 columns, her order. */
export const BOARD_COLUMNS: BoardCol[] = [
  { key: "product", label: "Product", step: 1, owner: "po", width: 150 },
  { key: "purchasePrice", label: "Purchase Price", step: 1, owner: "po", width: 90 },
  { key: "salesPrice", label: "Sales Price", step: 6, owner: "so", width: 90 },
  { key: "client", label: "Client", step: 6, owner: "so", width: 120 },
  { key: "packaging", label: "Foil & stickers & boxes", step: 1, owner: "po", width: 130 },
  { key: "invoiceNo", label: "Invoice No", step: 6, owner: "invoice", width: 110 },
  { key: "ip", label: "IP", step: 6, owner: "so", width: 130 },
  { key: "acid", label: "ACID", step: 6, owner: "so", width: 150 },
  { key: "controller", label: "Production date / Controlling person", step: 4, owner: "inspection", width: 160 },
  { key: "pos", label: "POS", step: 2, owner: "booking", width: 90 },
  { key: "pod", label: "POD", step: 2, owner: "booking", width: 90 },
  { key: "supplier", label: "Supplier name", step: 1, owner: "po", width: 130 },
  { key: "loadingDate", label: "Date of loading", step: 3, owner: "unit", width: 105 },
  { key: "unloadingDate", label: "Date of unloading", step: 3, owner: "unit", width: 105 },
  { key: "truckCarrier", label: "Transport 1 / truck", step: 3, owner: "unit", width: 120 },
  { key: "truckPrice", label: "Price", step: 3, owner: "unit", width: 90 },
  { key: "plates", label: "PLATES", step: 5, owner: "unit", width: 130 },
  { key: "loadingPlace", label: "Loading place", step: 3, owner: "unit", width: 170 },
  { key: "driver", label: "Driver", step: 5, owner: "unit", width: 130 },
  { key: "containerCarrier", label: "Transport 2 / CTR", step: 2, owner: "container", width: 110 },
  { key: "unloadingPlace", label: "Unloading place", step: 2, owner: "unit", width: 160 },
  { key: "unloadingTime", label: "Time of unloading", step: 2, owner: "unit", width: 100 },
  { key: "containerPrice", label: "Price", step: 2, owner: "container", width: 90 },
  { key: "comments", label: "Comments", step: 2, owner: "shipment", width: 160 },
  { key: "shippingLine", label: "Shipping line", step: 2, owner: "booking", width: 110 },
  { key: "etdEta", label: "ETD – ETA", step: 2, owner: "booking", width: 120 },
];

/** ISO week "W38" and the Monday of that week for grouping. */
export function weekOf(dateISO: any): { key: string; label: string; monday: string } {
  const d = S(dateISO).slice(0, 10); const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { key: "no-date", label: "no date yet", monday: "" };
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const day = dt.getUTCDay() || 7; dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((dt.getTime() - y0.getTime()) / 86400000) + 1) / 7);
  const mon = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() || 7) - 1));
  return { key: `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`, label: `week ${week}`, monday: mon.toISOString().slice(0, 10) };
}

export interface BoardRow { id: string; shipment: any; unit: any; legIdx: number; unitIdx: number; po: any; poLines: any[]; so: any; week: { key: string; label: string; monday: string }; cells: Record<string, string>; ready: { steps: Record<number, boolean>; loadable: boolean; closed: boolean }; }

function nameOf(contacts: any[], id: any): string { const c = id != null ? (contacts || []).find((x: any) => String(x.id) === String(id)) : null; return c?.name || ""; }
function fmtD(iso: any): string { const m = S(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1].slice(2)}` : S(iso); }

/** One row per road unit of every live shipment — the sea container of the same shipment fills step-2 cells. */
export function boardRows(ctx: { shipments: any[]; pos: any[]; orders: any[]; lots: any[]; invoices: any[]; contacts: any[]; inspections: any[]; locName: (id: any, text: any) => string }): BoardRow[] {
  const rows: BoardRow[] = [];
  (ctx.shipments || []).forEach((sh: any) => {
    if (!sh || String(sh.status) === "Cancelled") return;
    const po = (ctx.pos || []).find((p: any) => (sh.poRefs || []).includes(p.number)) || null;
    const so = (ctx.orders || []).find((o: any) => String(o.number) === String(sh.governingSoRef || (sh.soRefs || [])[0])) || null;
    const booking = (sh.bookings || [])[0] || {};
    const seaLeg = (sh.legs || []).find((l: any) => ["sea", "air", "rail"].includes(String(l.mode || "").toLowerCase()));
    const container = seaLeg ? ((seaLeg.vehicles || [])[0] || {}) : {};
    const roadLeg = (sh.legs || []).find((l: any) => !["sea", "air", "rail"].includes(String(l.mode || "").toLowerCase())) || (sh.legs || [])[0];
    const roadIdx = (sh.legs || []).indexOf(roadLeg);
    const units = roadLeg ? (roadLeg.vehicles || []) : [];
    const list = units.length ? units : [{}];
    list.forEach((u: any, ui: number) => {
      const loadIds = new Set((u.load || []).map((a: any) => String(a.goodsLineId)));
      const goods = (sh.goods || []).filter((g: any) => !loadIds.size || loadIds.has(String(g.id)));
      const poLines = goods.map((g: any) => (po?.items || []).find((it: any, i: number) => String(it.id ?? i + 1) === String(g.poLineId)) || (po?.items || []).find((it: any) => S(it.product) === S(g.product) && S(it.size || "") === S(g.size || ""))).filter(Boolean);
      const soLines = goods.map((g: any) => (so?.items || []).find((it: any) => S(it.product) === S(g.product) && S(it.size || "") === S(g.size || ""))).filter(Boolean);
      const inspections = (ctx.inspections || []).filter((x: any) => goods.some((g: any) => String(g.lotRef) === String(x.lotNumber)));
      const inv = (ctx.invoices || []).find((iv: any) => iv.kind === "SALES" && (iv.links || []).some((l: any) => (l.type === "SO" && so && String(l.number) === String(so.number)) || (l.type === "Shipment" && String(l.number) === String(sh.number))));
      const sizes = goods.map((g: any) => S(g.size)).filter(Boolean);
      const cells: Record<string, string> = {
        product: goods.length ? `${goods[0].variety || goods[0].product}${sizes.length ? " " + Array.from(new Set(sizes)).join("/") : ""}` : (po?.items?.[0] ? `${po.items[0].variety || po.items[0].product}` : ""),
        purchasePrice: poLines.map((it: any) => it.unitPrice).filter((v: any) => v !== undefined && v !== "").join(" // "),
        salesPrice: soLines.map((it: any) => it.unitPrice).filter((v: any) => v !== undefined && v !== "").join(" // "),
        client: so?.client?.name || "",
        packaging: Array.from(new Set(goods.map((g: any) => S(g.packaging)).filter(Boolean))).join(", ") || S(po?.items?.[0]?.packaging),
        invoiceNo: inv?.number || "",
        ip: S(so?.importPermitNo === "N/A" ? "" : so?.importPermitNo),
        acid: S(so?.acidNo === "N/A" ? "" : so?.acidNo),
        controller: inspections.map((x: any) => `${fmtD(x.date)} ${x.inspector || ""}`.trim()).join("; "),
        pos: ctx.locName(booking.polId, booking.pol),
        pod: ctx.locName(booking.podId, booking.pod),
        supplier: po?.supplier?.name || "",
        loadingDate: fmtD(u.loadedAt || u.plannedLoadingDate),
        unloadingDate: fmtD(u.unloadedAt || u.plannedDeliveryDate),
        truckCarrier: nameOf(ctx.contacts, u.carrierId),
        truckPrice: u.costAmount ? `${u.costAmount} ${u.costCurrency || ""}`.trim() : "",
        plates: [u.truckPlate, u.trailerPlate].filter(Boolean).join("/"),
        loadingPlace: ctx.locName(u.pickupLocationId, u.pickupText),
        driver: [u.driverName, u.driverPhone].filter(Boolean).join(" "),
        containerCarrier: nameOf(ctx.contacts, container.carrierId ?? booking.forwarderId),
        unloadingPlace: ctx.locName(u.deliveryLocationId, u.deliveryText),
        unloadingTime: S(u.plannedDeliveryTime || u.deliveryWindow),
        containerPrice: container.costAmount ? `${container.costAmount} ${container.costCurrency || ""}`.trim() : "",
        comments: S(sh.notes),
        shippingLine: S(booking.line || booking.shippingLine),
        etdEta: [fmtD(booking.etd), fmtD(booking.eta)].filter(Boolean).join(" - "),
      };
      const steps: Record<number, boolean> = {
        1: !!(cells.product && cells.purchasePrice && cells.supplier),
        2: !!(cells.pos && cells.pod && cells.etdEta) || !seaLeg,
        3: !!(cells.loadingDate && cells.truckCarrier && cells.truckPrice && cells.loadingPlace),
        4: !!cells.controller,
        5: !!(cells.plates && cells.driver),
        6: !!(cells.client && cells.salesPrice && cells.invoiceNo),
      };
      rows.push({ id: `${sh.number}#${u.id ?? ui}`, shipment: sh, unit: u, legIdx: roadIdx < 0 ? 0 : roadIdx, unitIdx: ui, po, poLines, so, week: weekOf(u.plannedLoadingDate || u.loadedAt || sh.loadingDate || booking.etd), cells,
        ready: { steps, loadable: steps[1] && steps[2] && steps[3] && steps[5], closed: steps[6] && steps[1] && steps[3] && steps[5] } });
    });
  });
  return rows.sort((a, b) => a.week.monday.localeCompare(b.week.monday) || a.shipment.number.localeCompare(b.shipment.number));
}

/** BD-4: read her workbook — one tab per week, header row, one row per truck. */
export const HER_HEADERS: Record<string, string> = {
  "Product": "product", "Purchase Price": "purchasePrice", "Sales Price": "salesPrice", "Client": "client", "Foil & stickiers & box": "packaging", "Foil & stickiers & boxes": "packaging", "Foil & stickers & boxes": "packaging",
  "Invoice No": "invoiceNo", "IP": "ip", "ACID": "acid", "Production date/ Controlling person": "controller", "POS": "pos", "POD": "pod", "Supplier name": "supplier",
  "Date of loading": "loadingDate", "Date of unloading": "unloadingDate", "Transport 1/ truck": "truckCarrier", "PLATES": "plates", "Loading place": "loadingPlace", "Driver": "driver",
  "Transport 2/ CTR": "containerCarrier", "Unoading place": "unloadingPlace", "Unloading place": "unloadingPlace", "Time of unloading": "unloadingTime", "Comments": "comments", "Shipping line": "shippingLine", "ETD - ETA": "etdEta",
};
export interface ImportedRow { sheet: string; rowNo: number; cells: Record<string, string>; }
export function parseHerSheet(sheetName: string, matrix: any[][]): ImportedRow[] {
  const header = (matrix[0] || []).map((h: any) => S(h).replace(/\s+/g, " ").trim());
  const map: Record<number, string> = {};
  let priceSeen = 0;
  header.forEach((h, c) => { if (h === "Price") { priceSeen++; map[c] = priceSeen === 1 ? "truckPrice" : "containerPrice"; return; } const k = HER_HEADERS[h] || HER_HEADERS[h.replace(/\s+$/, "")]; if (k) map[c] = k; });
  const out: ImportedRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] || []; const cells: Record<string, string> = {};
    Object.entries(map).forEach(([c, k]) => { const v = row[Number(c)]; if (v !== undefined && v !== null && S(v) !== "") cells[k] = v instanceof Date ? v.toISOString().slice(0, 10) : S(v); });
    if (Object.keys(cells).length < 2) continue;
    out.push({ sheet: sheetName, rowNo: r + 1, cells });
  }
  return out;
}
/** Match an imported row to a board row: plates first, then supplier + loading date. */
export function matchImportedRow(row: ImportedRow, board: BoardRow[]): { hit: BoardRow; confidence: "exact" | "probable" } | null {
  // exact = the TRUCK plate matches; probable = only the trailer (trailers travel with different trucks) or supplier + loading date
  const normP = (v: any) => S(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const plates = S(row.cells.plates).replace(/^SHP\d+\s*/i, "").split(/[/\s']+/).map(normP).filter(x => x.length >= 5);
  if (plates.length) {
    const truck = board.find(b => normP(b.unit.truckPlate) && plates[0] === normP(b.unit.truckPlate)); if (truck) return { hit: truck, confidence: "exact" };
    const any = board.find(b => { const bp = [b.unit.truckPlate, b.unit.trailerPlate].map(normP).filter(Boolean); return plates.some(p => bp.includes(p)); }); if (any) return { hit: any, confidence: "probable" };
  }
  const sup = S(row.cells.supplier).toLowerCase(); const ld = S(row.cells.loadingDate);
  if (sup) { const hit = board.find(b => S(b.cells.supplier).toLowerCase().startsWith(sup.slice(0, 6)) && (!ld || !b.cells.loadingDate || fmtD(ld) === b.cells.loadingDate || S(ld).slice(0, 10) === S(b.unit.plannedLoadingDate).slice(0, 10))); if (hit) return { hit, confidence: "probable" }; }
  return null;
}
