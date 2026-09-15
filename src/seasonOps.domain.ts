// ─────────────────────────────────────────────────────────────────────────────
// seasonOps.domain.ts — v6.89.0: CONSIGNMENT SEASON RECORDS (pure)
// Owner rulings 6 Sept 2026 (CONSIGNMENT_SEASON_DESIGN.md, VEGA_PRO_REPORTING_MAPPING.md).
// One owner per fact:
//   supplier-delivery shipment (DDP truck we TRACK, don't pay)  → Shipments
//   receipt with ACTUAL boxes/kg + variance                     → Inventory ledger (posted)
//   inspection (Daifressh structure) + defect catalogue         → Inventory (lot) / Settings
//   sorting job: class I / class II (same lot, grade) / waste   → Inventory
//   stock count → reasoned adjustments                          → Inventory
// ─────────────────────────────────────────────────────────────────────────────
const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
const r0 = (v: number) => Math.round(v);
const r2 = (v: number) => Math.round(v * 100) / 100;

// ── SUPPLIER-DELIVERY SHIPMENT (decision 1) ─────────────────────────────────
/** One PO = one truck (V1). The supplier's truck is tracked, not paid: no transport order, no cost of ours. */
export function supplierDeliveryFromPO(po: any, deps: { nextId: () => any; nextNumber: () => string; todayISO: () => string }, announce: { plate?: string; driver?: string; eta?: string; supplierRef?: string } = {}): any {
  const goods = (po?.items || []).map((it: any, i: number) => ({
    id: deps.nextId(), poRef: po.number, poLineId: it.id ?? i + 1, product: it.product, variety: it.variety, size: it.size, quality: it.quality,
    packaging: it.packaging, packagingId: it.packagingId ?? null, cnCode: it.cnCode, origin: it.origin,
    qtyKg: num(it.qty), boxes: num(it.boxes) || null, pallets: num(it.pallets) || null, lotRef: it.lotRef || null,
  }));
  const kg = goods.reduce((s: number, g: any) => s + num(g.qtyKg), 0);
  const unit = { id: deps.nextId(), kind: "truck", truckPlate: S(announce.plate), announcedPlate: S(announce.plate), driverName: S(announce.driver),
    plannedLoadingDate: "", eta: S(announce.eta), supplierRef: S(announce.supplierRef), qtyKg: kg, carrierId: null, costAmount: 0, load: goods.map((g: any) => ({ goodsLineId: g.id, qtyKg: num(g.qtyKg) })) };
  return {
    id: deps.nextId(), number: deps.nextNumber(), status: "Booked", purpose: "INBOUND", arrangedBy: "SUPPLIER", mode: "Road",
    poRefs: [po.number], soRefs: [], lotRefs: goods.map((g: any) => g.lotRef).filter(Boolean), governingSoRef: null,
    supplierRef: S(announce.supplierRef), supplierId: po.supplier?.id ?? null,
    originText: po.supplier?.name || "supplier", destinationLocationId: po.destinationLocationId ?? null, destinationText: po.destinationText || "",
    expectedDeliveryDate: S(announce.eta) || po.deliveryDate || "",
    legs: [{ mode: "Road", fromText: po.supplier?.name || "supplier", toLocationId: po.destinationLocationId ?? null, toText: po.destinationText || "", carrierId: null, costAmount: 0, costCurrency: po.currency || "PLN", costFxRate: 1, vehicles: [unit] }],
    goods, costs: [], documents: [], notes: `Supplier-delivered (${po.buyIncoterm || "DDP"}) — tracked, not paid. Created from ${po.number}.`, createdAt: deps.todayISO(),
  };
}
export function isSupplierDelivery(sh: any): boolean { return String(sh?.arrangedBy || "").toUpperCase() === "SUPPLIER"; }
/** Plates announced vs plates that arrived. */
export function plateMismatch(unit: any): boolean {
  const a = S(unit?.announcedPlate).replace(/\s/g, "").toUpperCase(), b = S(unit?.truckPlate).replace(/\s/g, "").toUpperCase();
  return !!a && !!b && a !== b;
}

// ── RECEIPT WITH ACTUAL QUANTITY (G1) ───────────────────────────────────────
export interface ReceiptInput { kg: any; boxes?: any; date: string; toId?: any; note?: string; shipmentRef?: string | null; }
export function receiptMovement(lot: any, inp: ReceiptInput, deps: { nextId: () => any }): { movement: any; varianceKg: number; variancePct: number } {
  const kg = r0(num(inp.kg));
  const expected = num(lot?.expectedKg);
  const varianceKg = r0(kg - expected);
  const variancePct = expected > 0 ? r2(varianceKg / expected * 100) : 0;
  return {
    movement: { id: deps.nextId(), date: inp.date, type: "IN", qtyKg: kg, boxes: num(inp.boxes) || null, toId: inp.toId ?? lot?.locationId ?? null,
      shipmentRef: inp.shipmentRef ?? null, soRef: null,
      note: `${inp.note || "Receipt"}${expected ? ` — expected ${r0(expected).toLocaleString("pl-PL")} kg, received ${kg.toLocaleString("pl-PL")} kg (${varianceKg >= 0 ? "+" : ""}${varianceKg} kg, ${variancePct}%)` : ""}`,
      expectedKg: expected, varianceKg },
    varianceKg, variancePct,
  };
}

// ── INSPECTION (G2) — the Daifressh structure ────────────────────────────────
export const DEFECT_CATEGORIES = ["Unacceptable", "Progressive", "Major", "Minor"] as const;
export interface DefectLine { category: string; name: string; count?: any; pct?: any; }
export interface Measurement { name: string; avg?: any; max?: any; min?: any; status?: "Correct" | "Not correct" | "Not checked"; }
export interface Inspection {
  id: any; lotNumber: string; poRef?: string; shipmentRef?: string;
  stage: "pre-unloading" | "warehouse" | "client" | "other";
  date: string; inspector: string; product?: string; variety?: string;
  orderedQty?: any; checkedQty?: any; unit?: "boxes" | "kg"; samplePct?: number; temperature?: any;
  labellingBox?: string; labellingProduct?: string;
  measurements: Measurement[];
  finalWeightKg?: any; expectedWeightKg?: any;
  defects: DefectLine[];
  verdict: "Accepted" | "Sort" | "Rejected" | "Pending";
  observations?: string; links: string[];
}
export function blankInspection(lot: any, deps: { nextId: () => any; todayISO: () => string }, stage: Inspection["stage"] = "warehouse"): Inspection {
  return { id: deps.nextId(), lotNumber: S(lot?.number), poRef: lot?.poRef || "", stage, date: deps.todayISO(), inspector: "",
    product: lot?.product || "", variety: lot?.variety || "", orderedQty: num(lot?.expectedKg) || "", checkedQty: "", unit: "kg", samplePct: 0, temperature: "",
    labellingBox: "Not checked", labellingProduct: "Not checked",
    measurements: [{ name: "Box weight", status: "Not checked" }, { name: "Calibre / count", status: "Not checked" }, { name: "Size (mm)", status: "Not checked" }, { name: "Unit / pack weight", status: "Not checked" }],
    finalWeightKg: "", expectedWeightKg: num(lot?.expectedKg) || "", defects: [], verdict: "Pending", observations: "", links: [] };
}
export function inspectionTotals(ins: Inspection): { byCategory: Record<string, number>; totalPct: number; samplePct: number } {
  const byCategory: Record<string, number> = {};
  (ins?.defects || []).forEach(d => { byCategory[d.category] = r2((byCategory[d.category] || 0) + num(d.pct)); });
  const totalPct = r2(Object.values(byCategory).reduce((s, v) => s + v, 0));
  const samplePct = num(ins?.orderedQty) > 0 ? r2(num(ins?.checkedQty) / num(ins?.orderedQty) * 100) : num(ins?.samplePct);
  return { byCategory, totalPct, samplePct };
}
/** The defect catalogue per product (Settings); a starting set for peppers the owner can edit. */
export interface DefectCatalogueEntry { product: string; category: string; name: string; }
export const PEPPER_DEFECTS: DefectCatalogueEntry[] = [
  // v6.99.31 (owner 15 Sept): the producer's own quality sheet, verbatim — these names print on the quality report.
  { product: "Capsicum", category: "Unacceptable", name: "Spray deposits" },
  { product: "Capsicum", category: "Unacceptable", name: "Non-vegetable foreign matter" },
  { product: "Capsicum", category: "Unacceptable", name: "Foreign taints or smells" },
  { product: "Capsicum", category: "Unacceptable", name: "Pests presence" },
  { product: "Capsicum", category: "Progressive", name: "Rots and mould" },
  { product: "Capsicum", category: "Major", name: "Mechanical damage (more than 1 cm² on surface)" },
  { product: "Capsicum", category: "Major", name: "Black & sooty mould" },
  { product: "Capsicum", category: "Major", name: "Purple/black discolouration (more than 3 cm² / more than 20 % on surface)" },
  { product: "Capsicum", category: "Major", name: "Shrivel / dehydration" },
  { product: "Capsicum", category: "Major", name: "Misshape" },
  { product: "Capsicum", category: "Major", name: "Bruising" },
  { product: "Capsicum", category: "Major", name: "Insect damage" },
  { product: "Capsicum", category: "Major", name: "Heavy skin scarring" },
  { product: "Capsicum", category: "Minor", name: "Broken calyx" },
  { product: "Capsicum", category: "Minor", name: "Shrivelling (more than 1 cm² on surface)" },
  { product: "Capsicum", category: "Minor", name: "Red/green discolouration (more than 5 cm² / 30 % on surface)" },
  { product: "Capsicum", category: "Minor", name: "Purple/black discolouration (1–3 cm² / less than 20 % on surface)" },
  { product: "Capsicum", category: "Minor", name: "Mechanical damage (less than 1 cm² on surface)" },
  { product: "Capsicum", category: "Minor", name: "Light russetting (more than 5 % on surface)" },
  { product: "Capsicum", category: "Minor", name: "Minor scarring" },
  { product: "Capsicum", category: "Minor", name: "Silvering / thrips" },
];

// ── v6.99.31 (owner): TOLERANCE per category decides Acceptable / Not acceptable. Unacceptable is always 0 %;
// the other three are editable per product in Settings. These defaults make the report work from the first day.
export const DEFAULT_TOLERANCES: Record<string, number> = { Unacceptable: 0, Progressive: 1, Major: 5, Minor: 10 };
export function tolerancesFor(settings: any, product: any): Record<string, number> {
  const per = (settings || {})[String(product || "").toLowerCase()] || (settings || {})["*"] || {};
  return { ...DEFAULT_TOLERANCES, ...per, Unacceptable: 0 };
}
/** The verdict of a quality report: per-category totals against their tolerance, then the whole sheet. */
export function inspectionVerdict(ins: Inspection, tolerances: Record<string, number>): {
  rows: Array<{ category: string; pct: number; tolerance: number; acceptable: boolean }>; totalPct: number; acceptable: boolean; advice: string;
} {
  const t = inspectionTotals(ins);
  const rows = DEFECT_CATEGORIES.map(cat => {
    const pct = r2(t.byCategory[cat] || 0);
    const tol = num((tolerances || {})[cat]);
    return { category: cat, pct, tolerance: tol, acceptable: pct <= tol + 1e-9 };
  });
  const acceptable = rows.every(r => r.acceptable);
  const unacceptableHit = rows.find(r => r.category === "Unacceptable" && r.pct > 0);
  const advice = unacceptableHit ? `Reject — unacceptable defects found (${unacceptableHit.pct} %).`
    : acceptable ? "Accept — within the agreed tolerances."
    : `Sort — combined defects ${t.totalPct} % exceed the tolerance for ${rows.filter(r => !r.acceptable).map(r => r.category.toLowerCase()).join(" and ")} defects.`;
  return { rows, totalPct: t.totalPct, acceptable, advice };
}
export function defectsFor(catalogue: DefectCatalogueEntry[], product: any): DefectCatalogueEntry[] {
  const p = S(product).toLowerCase();
  return (catalogue || []).filter(d => S(d.product).toLowerCase() === p || p.includes(S(d.product).toLowerCase()));
}

// ── SORTING JOB (G3) — one entry: class I / class II (same lot, grade) / waste ──
export interface SortingInput { date: string; kgIn: any; classIKg: any; classIIKg: any; wasteKg: any; by?: string; hours?: any; notes?: string; }
/** v6.96.0 (IN-2): the sorting job now lives in the LEDGER — RECLASS for class II, DAMAGE for waste. */
export function sortingJob(lot: any, inp: SortingInput, deps: { nextId: () => any }): { lot: any; job: any; error?: string } {
  return sortingJobLedger(lot, inp, deps);
}
/** kg by grade for the sales report: I, II and waste; unsorted = physical − (I + II). */
export function gradeSplit(lot: any): { I: number; II: number; waste: number; unsorted: number } {
  const g = (lot?.movements || []).some((m: any) => m && !m.voided && (m.type === "RECLASS" || String(m.source || "").startsWith("sorting:"))) ? gradesFromLedger(lot) : (lot?.grades || {});   // v6.96.0 (IN-2): the ledger wins
  const I = num(g.I), II = num(g.II), waste = num(g.waste);
  const received = num(lot?.receivedKg);
  return { I, II, waste, unsorted: Math.max(0, r0(received - I - II - waste)) };
}

// ── STOCK COUNT ─────────────────────────────────────────────────────────────
export interface StockCountLine { lotNumber: string; countedKg: any; countedBoxes?: any; }
export interface StockCount { id: any; date: string; locationId: any; by: string; lines: Array<StockCountLine & { systemKg: number; diffKg: number }>; }
export function buildStockCount(lots: any[], locationId: any, lines: StockCountLine[], deps: { nextId: () => any; todayISO: () => string }, by = ""): StockCount {
  return { id: deps.nextId(), date: deps.todayISO(), locationId, by,
    lines: (lines || []).map(l => { const lot = (lots || []).find(x => String(x.number) === String(l.lotNumber)); const sys = r0(num(lot?.physicalKg)); const c = r0(num(l.countedKg)); return { ...l, countedKg: c, systemKg: sys, diffKg: r0(c - sys) }; }) };
}
/** Apply a count: every difference beyond 1 kg becomes a reasoned CORRECTION movement on the lot. */
export function applyStockCount(lots: any[], count: StockCount, reason: string, deps: { nextId: () => any }): { lots: any[]; adjusted: number } {
  let adjusted = 0;
  const next = (lots || []).map(lot => {
    const line = count.lines.find(l => String(l.lotNumber) === String(lot.number));
    if (!line || Math.abs(line.diffKg) <= 1) return lot;
    adjusted++;
    const mv = line.diffKg > 0
      ? { id: deps.nextId(), date: count.date, type: "IN", qtyKg: line.diffKg, toId: lot.locationId ?? null, note: `Stock count ${count.date}: +${line.diffKg} kg — ${reason}`, source: `count:${count.id}` }
      : { id: deps.nextId(), date: count.date, type: "DAMAGE", qtyKg: -line.diffKg, toId: lot.locationId ?? null, note: `Stock count ${count.date}: ${line.diffKg} kg — ${reason}`, source: `count:${count.id}` };
    return { ...lot, movements: [...(lot.movements || []), mv] };
  });
  return { lots: next, adjusted };
}

// ── v6.96.0 (IN-2): GRADES IN THE LEDGER — sorting posts RECLASS (I→II) + DAMAGE (waste); grades derive ──
export function gradesFromLedger(lot: any): { I: number; II: number; waste: number } {
  const live = (lot?.movements || []).filter((m: any) => m && !m.voided);
  const receivedLedger = live.filter((m: any) => m.type === "IN").reduce((s: number, m: any) => s + num(m.qtyKg), 0);
  const received = receivedLedger > 0 ? receivedLedger : num(lot?.receivedKg);   // lots received before the ledger carried the IN (read-forward)
  const toII = live.filter((m: any) => m.type === "RECLASS" && String(m.toGrade || "II") === "II").reduce((s: number, m: any) => s + num(m.qtyKg), 0);
  const backToI = live.filter((m: any) => m.type === "RECLASS" && String(m.toGrade) === "I").reduce((s: number, m: any) => s + num(m.qtyKg), 0);
  const waste = live.filter((m: any) => m.type === "DAMAGE" && String(m.source || "").startsWith("sorting:")).reduce((s: number, m: any) => s + num(m.qtyKg), 0);
  const II = Math.max(0, r0(toII - backToI));
  return { I: Math.max(0, r0(received - II - waste)), II, waste: r0(waste) };
}
/** IN-2 sorting job: one entry → RECLASS for class II, DAMAGE for waste; nothing accumulated outside the ledger. */
export function sortingJobLedger(lot: any, inp: SortingInput, deps: { nextId: () => any }): { lot: any; job: any; error?: string } {
  const kgIn = num(inp.kgIn), i = num(inp.classIKg), ii = num(inp.classIIKg), w = num(inp.wasteKg);
  if (Math.abs(kgIn - (i + ii + w)) > 1) return { lot, job: null, error: `Sorted ${kgIn} kg but class I + class II + waste = ${i + ii + w} kg — the split must equal what went in.` };
  const job = { id: deps.nextId(), date: inp.date, kgIn, classIKg: i, classIIKg: ii, wasteKg: w, by: S(inp.by), hours: num(inp.hours) || null, notes: S(inp.notes) };
  const movements = [...(lot.movements || [])];
  if (ii > 0) movements.push({ id: deps.nextId(), date: inp.date, type: "RECLASS", qtyKg: ii, fromGrade: "I", toGrade: "II", toId: lot.locationId ?? null, note: `Sorting — class II · job ${job.id}${inp.by ? " · " + inp.by : ""}`, source: `sorting:${job.id}` });
  if (w > 0) movements.push({ id: deps.nextId(), date: inp.date, type: "DAMAGE", qtyKg: w, toId: lot.locationId ?? null, note: `Sorting waste — job ${job.id}${inp.by ? " · " + inp.by : ""}`, source: `sorting:${job.id}` });
  const next = { ...lot, movements, serviceEvents: [...(lot.serviceEvents || []), { id: job.id, type: "SORTING", date: inp.date, kg: kgIn, note: `class I ${i} · class II ${ii} · waste ${w}` }], sortingJobs: [...(lot.sortingJobs || []), job] };
  next.grades = gradesFromLedger(next);   // cache for readers; the ledger is the truth
  return { lot: next, job };
}

// ── v6.96.0 (IN-4): lot normalisation — mirrors retired, cache re-derived (idempotent) ──
export function normaliseLot(lot: any, ctx: { po?: any; poSettlements?: any[] } = {}): { lot: any; changed: boolean; settlementToMigrate?: any } {
  let l: any = { ...lot }; let changed = false; let settlementToMigrate: any = undefined;
  ["journey", "destinationText", "custodyType"].forEach(k => { if (k in l) { delete l[k]; changed = true; } });
  if (ctx.po) {
    const cons = (ctx.po.pricingMode || "firm") === "consignment";
    if (!!l.consignment !== cons) { l.consignment = cons; changed = true; }
    if (ctx.po.directFlow !== undefined && !!l.directFlow !== !!ctx.po.directFlow) { l.directFlow = !!ctx.po.directFlow; changed = true; }   // synced derivation, never typed
  }
  // v6.99.22 (G-2 heal): movements posted before grades existed took class I — state it, so remaining-by-grade is read, not guessed.
  if (Array.isArray(l.movements) && l.movements.some((m: any) => m && m.type === "SHIP_OUT" && !m.grade)) {
    l.movements = l.movements.map((m: any) => (m && m.type === "SHIP_OUT" && !m.grade) ? { ...m, grade: "I" } : m);
    changed = true;
  }
  const firstIn = (l.movements || []).filter((m: any) => m && !m.voided && m.type === "IN").map((m: any) => String(m.date || "")).filter(Boolean).sort()[0];
  if (firstIn && l.arrivalDate !== firstIn) { l.arrivalDate = firstIn; changed = true; }
  if (l.settlement && ctx.poSettlements && !ctx.poSettlements.some(s => String(s.poNumber) === String(l.poRef))) { settlementToMigrate = { ...l.settlement, poNumber: l.poRef, fromLot: l.number }; }
  if (l.settlement && ctx.poSettlements) { delete l.settlement; changed = true; }
  const g = gradesFromLedger(l);
  if ((l.movements || []).some((m: any) => m.type === "RECLASS" || String(m.source || "").startsWith("sorting:"))) { if (JSON.stringify(l.grades || {}) !== JSON.stringify(g)) { l.grades = g; changed = true; } }
  return { lot: l, changed, settlementToMigrate };
}

// ── v6.96.0 (IN-5): the quay is inventory — unloading at the POL / clearance at the POD posts a TRANSFER to the port location ──
export function portStageTransfers(sh: any, lots: any[], portLocationId: any, dateISO: string, deps: { nextId: () => any }, kind: "unloaded" | "cleared" = "unloaded"): { lots: any[]; posted: number } {
  const refs = new Set<string>();
  (sh?.goods || []).forEach((g: any) => { if (g.lotRef) refs.add(String(g.lotRef)); });
  (sh?.lotRefs || []).forEach((r: any) => refs.add(String(r)));
  let posted = 0;
  const source = `unit_event:${kind}:${sh?.number}`;
  const next = (lots || []).map(lot => {
    if (!refs.has(String(lot.number))) return lot;
    if ((lot.movements || []).some((m: any) => m.source === source)) return lot;   // idempotent
    if (String(lot.locationId ?? "") === String(portLocationId ?? "")) return lot;
    posted++;
    return { ...lot, movements: [...(lot.movements || []), { id: deps.nextId(), date: dateISO, type: "TRANSFER", qtyKg: r0(num(lot.physicalKg)), fromId: lot.locationId ?? null, toId: portLocationId ?? null, shipmentRef: sh.number, note: `${kind === "unloaded" ? "Unloaded at the port of loading" : "Discharged & cleared at the port of discharge"} — ${sh.number}`, source }] };
  });
  return { lots: next, posted };
}

// ── v6.99.22 (G-1…G-4, owner approval 14 Sept): GRADE IS PART OF THE PROMISE ──
// Sorting turns sound fruit into class II. What is in stock is therefore not one number but
// two: class I and class II. These read the LEDGER (RECLASS in, ship-outs out) — no new store.

/** What is in stock NOW, by grade. class II = reclassified in − shipped out as II; class I = the rest of the physical stock. */
export function gradeStockNow(lot: any): { I: number; II: number; waste: number } {
  const live = (lot?.movements || []).filter((m: any) => m && !m.voided);
  const toII = live.filter((m: any) => m.type === "RECLASS" && String(m.toGrade || "II").toUpperCase() === "II").reduce((s: number, m: any) => s + num(m.qtyKg), 0);
  const backToI = live.filter((m: any) => m.type === "RECLASS" && String(m.toGrade).toUpperCase() === "I").reduce((s: number, m: any) => s + num(m.qtyKg), 0);
  const outII = live.filter((m: any) => ["SHIP_OUT", "DAMAGE"].includes(m.type) && String(m.grade || "").toUpperCase() === "II").reduce((s: number, m: any) => s + num(m.qtyKg), 0);
  const backII = live.filter((m: any) => m.type === "REVERSAL" && String(m.grade || "").toUpperCase() === "II").reduce((s: number, m: any) => s + num(m.qtyKg), 0);
  const physical = num(lot?.physicalKg);
  const II = Math.max(0, Math.min(physical, r0(toII - backToI - outII + backII)));
  return { I: Math.max(0, r0(physical - II)), II, waste: r0(live.filter((m: any) => m.type === "DAMAGE" && String(m.source || "").startsWith("sorting:")).reduce((s: number, m: any) => s + num(m.qtyKg), 0)) };
}

/** Available per grade = in stock of that grade − what other live orders promise of that grade. */
export function gradeAvailability(lot: any, orders: any[], excludeOrderId?: any): { I: number; II: number; promisedI: number; promisedII: number; stockI: number; stockII: number } {
  const stock = gradeStockNow(lot);
  let promisedI = 0, promisedII = 0;
  (orders || []).forEach(o => {
    if (!o || ["Draft", "Cancelled"].includes(String(o.status))) return;
    if (excludeOrderId != null && String(o.id) === String(excludeOrderId)) return;
    // an order whose goods already left the lot is history, not a promise (v6.99.15 rule)
    const gone = (o.items || []).some((it: any) => it.sourceType === "STOCK" && String(it.sourceRef) === String(lot?.number)) &&
      (lot?.movements || []).some((m: any) => m && !m.voided && m.type === "SHIP_OUT" && String(m.soRef || "") === String(o.number));
    if (gone) return;
    (o.items || []).forEach((it: any) => {
      if (it.sourceType !== "STOCK" || String(it.sourceRef) !== String(lot?.number)) return;
      const g = String(it.grade || "I").toUpperCase() === "II" ? "II" : "I";
      if (g === "II") promisedII += num(it.qty); else promisedI += num(it.qty);
    });
  });
  return { I: r0(stock.I - promisedI), II: r0(stock.II - promisedII), promisedI: r0(promisedI), promisedII: r0(promisedII), stockI: stock.I, stockII: stock.II };
}

/** G-3: after sorting, say which live orders can no longer be served in the grade they promise. */
export function gradeCommitmentWarning(lot: any, orders: any[]): string {
  const a = gradeAvailability(lot, orders);
  if (a.I >= -1) return "";
  const gone = (o: any) => (lot?.movements || []).some((m: any) => m && !m.voided && m.type === "SHIP_OUT" && String(m.soRef || "") === String(o.number));
  const affected = (orders || []).filter(o => o && !["Draft", "Cancelled"].includes(String(o.status)) && !gone(o) && (o.items || []).some((it: any) => it.sourceType === "STOCK" && String(it.sourceRef) === String(lot?.number) && String(it.grade || "I").toUpperCase() !== "II")).map(o => o.number);
  return `${lot?.number}: class I in stock is ${a.stockI.toLocaleString("pl-PL")} kg but ${a.promisedI.toLocaleString("pl-PL")} kg are sold as class I${affected.length ? ` (${affected.join(", ")})` : ""} — short ${Math.abs(a.I).toLocaleString("pl-PL")} kg. Class II available: ${a.II.toLocaleString("pl-PL")} kg. Adjust the order(s): split by grade, source elsewhere, or short-deliver.`;
}
