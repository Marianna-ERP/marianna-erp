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
