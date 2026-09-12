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
  { product: "Capsicum", category: "Unacceptable", name: "Foreign matter" }, { product: "Capsicum", category: "Unacceptable", name: "Pest and disease" },
  { product: "Capsicum", category: "Progressive", name: "Rots / moulds" }, { product: "Capsicum", category: "Progressive", name: "Soft / breakdown" },
  { product: "Capsicum", category: "Major", name: "Sunburn" }, { product: "Capsicum", category: "Major", name: "Cracks" }, { product: "Capsicum", category: "Major", name: "Misshapen" },
  { product: "Capsicum", category: "Minor", name: "Blemish / skin marks" }, { product: "Capsicum", category: "Minor", name: "Colour not uniform" }, { product: "Capsicum", category: "Minor", name: "Stem damage" },
];
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
