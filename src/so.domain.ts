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
  const sorted = num(g.I) + num(g.II) + num(g.waste);
  return { I, II, unsorted: Math.max(0, r0(num(lot?.physicalKg) - Math.max(0, sorted - num(g.waste)) )) };
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
export interface PackingResultRow { lineId: any; qty?: any; boxes?: any; }
/** Apply the producer's packing result: quantities become FINAL; lines not mentioned keep their estimate but are marked FINAL too (the result is complete). */
export function applyPackingResult(po: any, rows: PackingResultRow[], todayISO: string): any {
  const items = (po.items || []).map((it: any, i: number) => {
    const row = (rows || []).find(r => String(r.lineId) === String(it.id ?? i + 1));
    const n: any = { ...it, quantityStatus: "FINAL", estimatedQty: it.estimatedQty ?? it.qty };
    if (row) { if (row.qty !== undefined && row.qty !== "") n.qty = num(row.qty); if (row.boxes !== undefined && row.boxes !== "") n.boxes = num(row.boxes); }
    return n;
  });
  return { ...po, items, packingResultAt: todayISO };
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
