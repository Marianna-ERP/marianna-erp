// ─────────────────────────────────────────────────────────────────────────────
// so.domain.ts — v6.95.0: SALES ORDER RULES (owner decisions SO-1…SO-9 + PO-10, 10 Sept 2026)
// Pure.
// ─────────────────────────────────────────────────────────────────────────────
import { paymentBasisOf, dueDateFor } from "./po.domain";

const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
const r0 = (v: number) => Math.round(v);

// ── SO-1: grade on the line ───────────────────────────────────────────────────
export type Grade = "I" | "II";
/** Kilos of a grade still available on a lot: sorted grade kg minus what other live SO lines of that grade reserve. */
export function lotAvailabilityByGrade(lot: any, orders: any[], excludeOrderId?: any): { I: number; II: number; unsorted: number } {
  const g = lot?.grades || {};
  const reserved = { I: 0, II: 0 };
  (orders || []).forEach(o => {
    if (!o || o.status === "Draft" || o.status === "Cancelled" || (excludeOrderId != null && String(o.id) === String(excludeOrderId))) return;
    (o.items || []).forEach((it: any) => {
      if (it.sourceType !== "STOCK" || String(it.sourceRef) !== String(lot?.number)) return;
      const gr = String(it.grade || "I").toUpperCase() === "II" ? "II" : "I";
      reserved[gr] += num(it.qty);
    });
  });
  const I = Math.max(0, r0(num(g.I) - reserved.I)), II = Math.max(0, r0(num(g.II) - reserved.II));
  // v6.99.34 (A-R24-2, owner): what is unsorted is simply the physical stock minus what sorting has already classified.
  // The waste left the stock when it was written off, so it is never part of the unsorted pool.
  return { I, II, unsorted: Math.max(0, r0(num(lot?.physicalKg) - num(g.I) - num(g.II))) };
}

// ── SO-2: unit follows the PO line ────────────────────────────────────────────
export function lineFromPOLine(poLine: any): { pricingUnit: string; boxes: any; kgPerBox: any; unit: string; coloration?: any; cnCode?: any; packaging?: any } {
  const unit = String(poLine?.pricingUnit || "kg").toLowerCase() === "box" ? "box" : "kg";
  return {
    coloration: poLine?.coloration ?? "",   // v6.99.26 (owner): the sale inherits what was bought
    cnCode: poLine?.cnCode ?? "",
    packaging: poLine?.packaging ?? "", pricingUnit: unit, boxes: poLine?.boxes ?? null, kgPerBox: poLine?.kgPerBox ?? null, unit: unit === "box" ? "box" : "kg" };
}

// ── SO-3: the delivery EVENT depends on the sell incoterm ─────────────────────
export type DeliveryEvent = "discharged" | "delivered" | "loaded";
export function deliveryEventFor(sellIncoterm: any): { event: DeliveryEvent; where: string } {
  const ic = S(sellIncoterm).toUpperCase();
  if (["CFR", "CIF", "CPT", "CIP"].includes(ic)) return { event: "discharged", where: "arrival at the port of discharge" };
  if (["DAP", "DPU", "DDP"].includes(ic)) return { event: "delivered", where: "delivery at the client's place" };
  return { event: "loaded", where: "handover at loading (EXW / FCA / FOB)" };   // EXW FCA FOB FAS
}
const FIELD: Record<DeliveryEvent, string> = { discharged: "dischargedAt", delivered: "deliveredAt", loaded: "loadedAt" };
/** Actual delivery = the LAST unit event of the incoterm's kind on the shipments carrying this order. */
export function actualDeliveryDate(so: any, shipments: any[]): string {
  const soNo = S(so?.number); const f = FIELD[deliveryEventFor(so?.sellIncoterm).event];
  const dates: string[] = [];
  (shipments || []).forEach(sh => {
    if (!sh || String(sh.status) === "Cancelled") return;
    const carries = (sh.soRefs || []).map(String).includes(soNo) || (sh.goods || []).some((g: any) => String(g.soRef) === soNo);
    if (!carries) return;
    (sh.legs || []).forEach((l: any) => (l.vehicles || []).forEach((u: any) => { if (S(u[f])) dates.push(S(u[f])); }));
    // header mirrors as fallback (pre-v6.85 data)
    if (f === "deliveredAt" && S(sh.actualDeliveryDate)) dates.push(S(sh.actualDeliveryDate));
    if (f === "loadedAt" && S(sh.actualLoadingDate)) dates.push(S(sh.actualLoadingDate));
  });
  return dates.sort().slice(-1)[0] || "";
}
export function deliveryDelayDays(so: any, shipments: any[]): number | null {
  const planned = S(so?.deliveryDate).slice(0, 10), actual = actualDeliveryDate(so, shipments).slice(0, 10);
  if (!planned || !actual) return null;
  return Math.round((new Date(actual + "T00:00:00").getTime() - new Date(planned + "T00:00:00").getTime()) / 86400000);
}

// ── SO-4: payment days from the client → due date ─────────────────────────────
export function soPaymentDays(so: any, client: any): number {
  const own = num(so?.paymentDays); if (own > 0) return own;
  const inh = num(client?.paymentTermsDays); if (inh > 0) return inh;
  const m = S(so?.paymentTerms).match(/(\d{1,3})/); return m ? num(m[1]) : 0;
}
export function soInvoiceDueDate(issueISO: string, so: any, client: any): string { return dueDateFor(issueISO, paymentBasisOf(so?.paymentBasis ? so : client), soPaymentDays(so, client)); }   // v6.99.23: the basis decides whether days count

// ── SO-6: normalisation (idempotent) ──────────────────────────────────────────
export function normaliseSO(so: any): { so: any; changed: boolean } {
  let s: any = { ...so }; let changed = false;
  const drop = (k: string) => { if (k in s) { delete s[k]; changed = true; } };
  ["linkedInvoices", "linkedShipments", "actualDeliveryDate", "destinationMode", "_poETAByLine", "paymentTermsOther"].forEach(drop);
  if (!(num(s.paymentDays) > 0)) { const m = S(s.paymentTerms).match(/(\d{1,3})/); if (m) { s.paymentDays = num(m[1]); changed = true; } }
  if (!S(s.paymentBasis)) { s.paymentBasis = paymentBasisOf(s); changed = true; }   // v6.99.23: one source
  // v6.99.27: the line's class had two names — `quality` (commercial, read by invoices, shipments, settlement)
  // and `grade` (sorting, read by the availability engine). One control writes both; here they are kept in step.
  (s.items || []).forEach((it: any) => {
    const cls = S(it.grade) || S(it.quality) || "I";
    if (S(it.grade) !== cls) { it.grade = cls; changed = true; }
    if (S(it.quality) !== cls) { it.quality = cls; changed = true; }
  });
  if ("paymentTerms" in s) { delete s.paymentTerms; changed = true; }
  if (Array.isArray(s.items)) s.items = s.items.map((it: any) => { const n: any = { ...it }; if ("shippedKg" in n) { delete n.shippedKg; changed = true; } if ("unit" in n && !n.pricingUnit) { n.pricingUnit = String(n.unit || "kg").toLowerCase() === "box" ? "box" : "kg"; changed = true; } if ("unit" in n) { delete n.unit; changed = true; } if (!n.pricingUnit) { n.pricingUnit = "kg"; changed = true; } return n; });
  return { so: s, changed };
}

// ── SO-8: the locked rate is a fact with a date ───────────────────────────────
export function lockRate(so: any, todayISO: string): any {
  if (S(so?.fxLockedAt) || String(so?.currency || "PLN").toUpperCase() === "PLN") return so;
  return { ...so, fxLockedAt: todayISO };
}

// ── PO-10: ESTIMATED quantities on a confirmed PO; the packing result makes them FINAL ──
export function isEstimatedLine(line: any): boolean { return String(line?.quantityStatus || "FINAL").toUpperCase() === "ESTIMATED"; }
export interface PackingResultRow { lineId?: any; qty?: any; boxes?: any; newLine?: any; }   // v6.99.50 (TO-2): a row without lineId and with newLine ADDS a line
/** Apply the producer's packing result: quantities become FINAL; lines not mentioned keep their estimate but are marked FINAL too (the result is complete). */
export function applyPackingResult(po: any, rows: PackingResultRow[], todayISO: string): any {
  const items = (po.items || []).map((it: any, i: number) => {
    const row = (rows || []).find(r => String(r.lineId) === String(it.id ?? i + 1));
    const n: any = { ...it, quantityStatus: "FINAL", estimatedQty: it.estimatedQty ?? it.qty };
    if (row) { if (row.qty !== undefined && row.qty !== "") n.qty = num(row.qty); if (row.boxes !== undefined && row.boxes !== "") n.boxes = num(row.boxes); }
    return n;
  });
  // v6.99.50 (TO-2, owner): the producer's packing list may bring a SIZE the order did not have — two pallets of 60-65 at their
  // own price — or drop a line. New lines arrive FINAL; a line set to 0 kg is kept at 0 (it shows what was ordered and not loaded).
  const added = (rows || []).filter(r => (r.lineId === undefined || r.lineId === null || r.lineId === "") && r.newLine && num(r.newLine.qty) > 0)
    .map((r, k) => {
      // v6.99.57 (A-PK-2, owner): an additional item is built from what was CHOSEN, not by copying line 1 — copying carried line 1's
      // CN code and its manual box/pallet overrides into a different item. Only origin and pricing unit are taken from the order.
      const base: any = items[0] || {}; const nl: any = r.newLine || {};
      return { id: nl.id ?? `pk-${todayISO}-${k + 1}`, product: nl.product || base.product || "", variety: nl.variety || "", size: nl.size || "", quality: nl.quality || base.quality || "I",
        coloration: nl.coloration || "", packaging: nl.packaging || "", packagingId: nl.packagingId ?? null, cnCode: nl.cnCode || "",
        origin: base.origin ?? nl.origin ?? "", pricingUnit: base.pricingUnit || nl.pricingUnit || "kg",
        qty: num(nl.qty), unitPrice: num(nl.unitPrice), quantityStatus: "FINAL", estimatedQty: 0, addedByPackingResult: true };
    });
  return { ...po, items: [...items, ...added], packingResultAt: todayISO };
}
export interface SOAdjustment { soNumber: string; lineIndex: number; product: string; soldKg: number; finalKg: number; overKg: number; }
/** Sales lines that the FINAL quantities can no longer cover — proposed, never applied silently. */
export function proposeSOAdjustments(po: any, orders: any[]): SOAdjustment[] {
  const out: SOAdjustment[] = [];
  (po.items || []).forEach((it: any, i: number) => {
    const lineId = String(it.id ?? i + 1); const finalKg = num(it.qty);
    const sellers: Array<{ o: any; idx: number; kg: number }> = [];
    (orders || []).forEach(o => { if (!o || o.status === "Cancelled" || o.status === "Draft") return; (o.items || []).forEach((x: any, idx: number) => { if (x.sourceType === "PO" && String(x.sourceRef) === String(po.number) && String(x.sourceLineId ?? 1) === lineId) sellers.push({ o, idx, kg: num(x.qty) }); }); });
    const sold = sellers.reduce((s, x) => s + x.kg, 0);
    if (sold <= finalKg + 1) return;
    let over = sold - finalKg;
    sellers.sort((a, b) => String(b.o.number).localeCompare(String(a.o.number))).forEach(x => { if (over <= 0) return; const cut = Math.min(over, x.kg); out.push({ soNumber: x.o.number, lineIndex: x.idx, product: String(it.product || ""), soldKg: x.kg, finalKg: r0(x.kg - cut), overKg: r0(cut) }); over -= cut; });
  });
  return out;
}

// ── v6.99.56 (A-PL-1 · PL-2, owner 25 Sept): WHAT THE PRODUCER'S PACKING LIST MOVES — in one plan ──
// The packing list is what was actually loaded, so it moves four places together: the PO lines (final), the PO's expected
// lots (the same builder used at confirmation), the SO lines that sell those PO lines (they ARE what was loaded for that
// sale), and the goods rows of every shipment not yet loaded. A size the producer added is appended to the sale with a
// blank price marked "price to agree". The only questions asked are the ones the data cannot answer: which SO takes a
// difference when one PO line feeds several SOs, and which SO takes a new size when the PO feeds several.
export interface PackingPlan { po: any; lots: any[]; orders: any[]; shipments: any[]; soChanges: string[]; questions: Array<{ key: string; label: string; options: string[] }>; unpriced: string[]; }
export function planPackingResult(
  po: any, rows: PackingResultRow[],
  ctx: { orders: any[]; lots: any[]; shipments: any[]; todayISO: string },
  deps: { buildLots: (po: any, lots: any[]) => { newLots: any[]; lotPatches: any[]; lotRefs: string[] }; syncShipment: (sh: any, po: any, lots: any[]) => any; counts?: (line: any) => { boxes: any; pallets: any }; nextId?: () => any },
  answers: { choice?: Record<string, string>; prices?: Record<string, any> } = {}
): PackingPlan {
  const norm = (v: any) => String(v ?? "").trim().toLowerCase();
  const fin0 = applyPackingResult(po, rows, ctx.todayISO);
  // 1) the PO's expected lots — the builder of the confirmation, nothing else
  const plan = deps.buildLots(fin0, ctx.lots || []);
  const lots = [...(ctx.lots || []).map((l: any) => { const pt = (plan.lotPatches || []).find((x: any) => x.number === l.number); return pt ? { ...l, ...pt.patch } : l; }), ...(plan.newLots || [])];
  const fin = { ...fin0, lotRefs: plan.lotRefs || fin0.lotRefs };
  const lineId = (it: any, i: number) => String(it?.id ?? i + 1);
  const poLots = new Map<string, any>(lots.filter((l: any) => String(l.poRef) === String(po.number)).map((l: any) => [String(l.number), l]));
  const byFacts = (it: any) => { const k = (fin.items || []).findIndex((x: any) => norm(x.product) === norm(it.product) && norm(x.size || "") === norm(it.size || "")); return k >= 0 ? lineId(fin.items[k], k) : ""; };
  // 2) which SO lines sell which PO line
  const orders = (ctx.orders || []).map((o: any) => ({ ...o, items: (o.items || []).map((it: any) => ({ ...it })) }));
  const byLine = new Map<string, Array<{ o: any; idx: number }>>();
  orders.forEach((o: any) => { if (!o || String(o.status) === "Cancelled") return; (o.items || []).forEach((it: any, idx: number) => {
    let pl = "";
    if (it.sourceType === "PO" && String(it.sourceRef) === String(po.number)) pl = it.sourceLineId != null ? String(it.sourceLineId) : byFacts(it);
    else if (it.sourceType === "STOCK" && poLots.has(String(it.sourceRef))) { const l = poLots.get(String(it.sourceRef)); pl = l?.poLineId != null ? String(l.poLineId) : byFacts(it); }
    if (!pl) return; if (!byLine.has(pl)) byLine.set(pl, []); byLine.get(pl)!.push({ o, idx });
  }); });
  const soChanges: string[] = [], questions: PackingPlan["questions"] = [], unpriced: string[] = [];
  const recount = (it: any) => deps.counts ? { ...it, ...(() => { const c = deps.counts!(it); return { boxes: c.boxes ?? it.boxes, pallets: c.pallets ?? it.pallets }; })() } : it;
  const choice = answers.choice || {}, prices = answers.prices || {};
  // 3) existing lines: the sale takes the final kilos
  (fin.items || []).forEach((it: any, i: number) => {
    if (it.addedByPackingResult) return;
    const id = lineId(it, i); const L = byLine.get(id) || []; const finalKg = num(it.qty);
    if (L.length === 1) { const { o, idx } = L[0]; const was = num(o.items[idx].qty); if (Math.abs(was - finalKg) > 0.5) { o.items[idx] = recount({ ...o.items[idx], qty: finalKg }); soChanges.push(`${o.number}: ${it.product} ${it.size || ""} ${Math.round(was).toLocaleString("pl-PL")} → ${Math.round(finalKg).toLocaleString("pl-PL")} kg`); } }
    else if (L.length > 1) {
      const sum = L.reduce((s, x) => s + num(x.o.items[x.idx].qty), 0); const diff = finalKg - sum;
      if (Math.abs(diff) > 0.5) { const key = `line:${id}`; const opts = Array.from(new Set(L.map(x => String(x.o.number))));
        const pick = choice[key]; if (!pick) { questions.push({ key, label: `${it.product} ${it.size || ""}: ${diff > 0 ? "+" : ""}${Math.round(diff).toLocaleString("pl-PL")} kg — which sale takes the difference?`, options: opts }); return; }
        const x = L.find(y => String(y.o.number) === pick)!; const was = num(x.o.items[x.idx].qty); const now = Math.max(0, was + diff);
        x.o.items[x.idx] = recount({ ...x.o.items[x.idx], qty: now }); soChanges.push(`${pick}: ${it.product} ${it.size || ""} ${Math.round(was).toLocaleString("pl-PL")} → ${Math.round(now).toLocaleString("pl-PL")} kg`); }
    }
  });
  // 4) a size the producer added: appended to the sale, price to agree
  const salesOfPO = Array.from(new Set(Array.from(byLine.values()).flat().map(x => String(x.o.number))));
  const appendedFor = new Map<string, string>();
  (fin.items || []).forEach((it: any, i: number) => {
    if (!it.addedByPackingResult) return;
    const id = lineId(it, i); let target = salesOfPO.length === 1 ? salesOfPO[0] : (choice[`new:${id}`] || "");
    if (!salesOfPO.length) { soChanges.push(`${it.product} ${it.size || ""} ${Math.round(num(it.qty)).toLocaleString("pl-PL")} kg — no sale linked to ${po.number}: stays in stock`); return; }
    if (!target) { questions.push({ key: `new:${id}`, label: `New size ${it.product} ${it.size || ""} (${Math.round(num(it.qty)).toLocaleString("pl-PL")} kg) — which sale was it loaded for?`, options: salesOfPO }); return; }
    const o = orders.find((x: any) => String(x.number) === target); if (!o) return;
    const price = num(prices[id]);
    o.items.push(recount({ id: deps.nextId ? deps.nextId() : `so-${ctx.todayISO}-${id}`, product: it.product, variety: it.variety || "", size: it.size || "", quality: it.quality || "I", grade: it.quality || "I", qty: num(it.qty),
      pricingUnit: it.pricingUnit || "kg", packaging: it.packaging, packagingId: it.packagingId, cnCode: it.cnCode || "", origin: it.origin || "", sourceType: "PO", sourceRef: po.number, sourceLineId: it.id ?? i + 1,
      unitPrice: price > 0 ? price : null, priceToAgree: !(price > 0), addedByPackingResult: true }));
    appendedFor.set(id, target);
    soChanges.push(`${target}: + ${it.product} ${it.size || ""} ${Math.round(num(it.qty)).toLocaleString("pl-PL")} kg${price > 0 ? ` at ${price}` : " — price to agree"}`);
    if (!(price > 0)) unpriced.push(`${target} · ${it.product} ${it.size || ""}`);
  });
  // 5) shipments not yet loaded re-derive; a new size's row carries its sale
  const shipments = (ctx.shipments || []).map((sh: any) => {
    if (!sh || !(sh.poRefs || []).includes(po.number) || !["Draft", "Booked"].includes(String(sh.status))) return sh;
    const s2 = deps.syncShipment(sh, fin, lots);
    const carries = (so: string) => String(s2.governingSoRef || "") === so || (s2.soRefs || []).includes(so);
    return { ...s2, goods: (s2.goods || []).map((g: any) => { const so = appendedFor.get(String(g.poLineId)); return g.addedByPackingResult && !g.soRef && so && carries(so) ? { ...g, soRef: so } : g; }) };
  });
  return { po: fin, lots, orders, shipments, soChanges, questions, unpriced };
}
