// correctionCosts.domain.ts — v7.47.0 (INV2-6, Batch INV-C, Invoices analysis 29 Oct: "a producer's price correction never reaches the
// lots; a carrier's correction leaves the shipment's cost unchanged"). ONE SOURCE: the correction note owns its amount — nothing is copied
// onto a lot or a cost line. The margin READS, at calculation time, the incoming credit / debit notes on the purchase invoices linked to a
// PO (goods) or to a shipment (freight, customs): a credit lowers the cost, a debit raises it, at the note's own PLN value (the rate of the
// invoice it corrects — owner decision 29 Oct).
import { rateOf } from "./fx";
const num = (v: any) => { const n = Number(v); return isFinite(n) ? n : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;
/** The signed PLN of the purchase corrections on the invoices linked to a PO or a shipment. */
export function correctionsPLNFor(linkType: "PO" | "Shipment", number: any, invoices: any[] = [], notes: any[] = []): number {
  if (!number) return 0;
  const ids = new Set((invoices || []).filter((i: any) => i && i.kind === "COST" && String(i.paymentStatus) !== "Cancelled" && (i.links || []).some((l: any) => l && l.type === linkType && String(l.number) === String(number))).map((i: any) => String(i.id)));
  if (!ids.size) return 0;
  return r2((notes || []).filter((n: any) => n && n.direction === "incoming" && n.invoiceId != null && ids.has(String(n.invoiceId)) && !/Cancelled|Void/i.test(String(n.status || "")))
    .reduce((s: number, n: any) => s + (String(n.noteType).toUpperCase() === "DEBIT" ? 1 : -1) * (num(n.amountPLN) || num(n.amount) * rateOf(n)), 0));
}
/** Per kg of a PO's lots: its corrections spread over the kilos of all its lots (received, else expected). */
export function poCorrectionPerKg(poRef: any, lots: any[] = [], invoices: any[] = [], notes: any[] = []): number {
  const pln = correctionsPLNFor("PO", poRef, invoices, notes); if (!pln) return 0;
  const kg = (lots || []).filter((l: any) => l && String(l.poRef || "") === String(poRef)).reduce((s: number, l: any) => s + (num(l.receivedKg) || num(l.expectedKg)), 0);
  return kg > 0 ? pln / kg : 0;
}

// ── v7.53.0 (PL-1, owner approved 29 Oct — THE P/L RULE): (1) our sales invoices and their credit notes; (2) the cargo's purchase invoices
// and their credit notes; (3) transport invoices and their credit notes; (4) overheads per month ÷ the kg on sales invoices dated that month;
// lost kilos carried by the kilos sold. ONE SOURCE: every amount is read from its document at calculation time — nothing is copied. ──
const kgOfLot = (l: any) => num(l?.receivedKg) || num(l?.expectedKg);
/** A lot's cost per kg: its purchase part from the PO's goods invoices when there are any (the PO price only until invoiced), its other
 *  costs as recorded, the PO's corrections; divided by the kilos SOLD once the lot is emptied (lost kilos carried by the kilos sold). */
export function lotCostPerKgByDocuments(lot: any, lots: any[] = [], invoices: any[] = [], notes: any[] = []): number {
  if (!lot) return 0;
  const costs = (lot.costs || []); const other = costs.filter((c: any) => String(c?.type) !== "purchase").reduce((s: number, c: any) => s + num(c?.pln), 0);
  let purchase = costs.filter((c: any) => String(c?.type) === "purchase").reduce((s: number, c: any) => s + num(c?.pln), 0);
  const poLots = (lots || []).filter((l: any) => l && String(l.poRef || "") === String(lot.poRef || "")); const poKg = poLots.reduce((s: number, l: any) => s + kgOfLot(l), 0);
  const invPLN = (invoices || []).filter((i: any) => i && i.kind === "COST" && !["Cancelled", "Draft"].includes(String(i.paymentStatus)) && (i.links || []).some((l: any) => l && l.type === "PO" && String(l.number) === String(lot.poRef || "")))
    .reduce((s: number, i: any) => s + num(i.netPLN) || num(i.netAmount) * rateOf(i), 0);
  if (lot.poRef && invPLN > 0 && poKg > 0) purchase = invPLN * (kgOfLot(lot) / poKg);
  const corr = lot.poRef && poKg > 0 ? correctionsPLNFor("PO", lot.poRef, invoices, notes) * (kgOfLot(lot) / poKg) : 0;
  const total = purchase + other + corr;
  const emptied = num(lot.receivedKg) > 0 && num(lot.physicalKg) <= 0.5;
  const soldKg = (lot.movements || []).filter((m: any) => m && !m.voided && String(m.type || m.kind).toUpperCase() === "SHIP_OUT").reduce((s: number, m: any) => s + num(m.qtyKg), 0);
  const denom = emptied && soldKg > 0 ? soldKg : kgOfLot(lot);
  return denom > 0 ? total / denom : 0;
}
/** The shipments with each invoiced cost line valued at its invoice (net, PLN) — several lines on one invoice share it by their expected amounts. */
export function shipmentsWithInvoicedCosts(shipments: any[] = [], invoices: any[] = []): any[] {
  const byNo = new Map<string, any>(); (invoices || []).forEach((i: any) => { if (i && i.kind === "COST" && !["Cancelled", "Draft"].includes(String(i.paymentStatus))) byNo.set(String(i.number || "").replace(/\s+/g, "").toUpperCase(), i); });
  return (shipments || []).map((s: any) => {
    if (!s || !Array.isArray(s.costs) || !s.costs.some((c: any) => c && c.invoiceRef)) return s;
    const groups = new Map<string, any[]>(); s.costs.forEach((c: any) => { if (c && c.invoiceRef) { const k = String(c.invoiceRef).replace(/\s+/g, "").toUpperCase(); groups.set(k, [...(groups.get(k) || []), c]); } });
    const val = new Map<any, number>();
    groups.forEach((lines, k) => { const inv = byNo.get(k); if (!inv) return; const pln = num(inv.netPLN) || num(inv.netAmount) * rateOf(inv); const exp = lines.reduce((a: number, c: any) => a + (num(c.amountPLN) || num(c.amount) * rateOf(c)), 0);
      lines.forEach((c: any) => val.set(c, exp > 0 ? pln * ((num(c.amountPLN) || num(c.amount) * rateOf(c)) / exp) : pln / lines.length)); });
    if (!val.size) return s;
    return { ...s, costs: s.costs.map((c: any) => val.has(c) ? { ...c, amountPLN: r2(val.get(c) as number), amount: r2((val.get(c) as number) / rateOf(c)), invoiced: true } : c) };
  });
}
/** Overheads per kilo, per month: the month's operational costs (PLN) ÷ the kilos on the sales invoices dated that month. */
export function overheadPerKgByMonth(operationalCosts: any[] = [], invoices: any[] = [], kgOn: (i: any) => number): Record<string, number> {
  const cost: Record<string, number> = {}, kg: Record<string, number> = {};
  (operationalCosts || []).forEach((c: any) => { if (!c || c.deleted || String(c.status) === "Cancelled") return; const m = String(c.date || c.period || "").slice(0, 7); if (!m) return; cost[m] = (cost[m] || 0) + (num(c.amountPLN) || num(c.amount) * rateOf(c)); });
  (invoices || []).forEach((i: any) => { if (!i || i.kind !== "SALES" || ["Cancelled", "Draft"].includes(String(i.paymentStatus)) || !(num(i.grossAmount) > 0)) return; const m = String(i.issueDate || "").slice(0, 7); kg[m] = (kg[m] || 0) + kgOn(i); });
  const out: Record<string, number> = {}; Object.keys(cost).forEach(m => { if (kg[m] > 0) out[m] = cost[m] / kg[m]; }); return out;
}
