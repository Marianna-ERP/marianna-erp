// fxNbp.domain.ts — v7.13.1 / v7.13.3 (A-AU-11 / A-AU-2, owner 9 Oct): give foreign-currency invoices and their payments the NBP rate
// of the last working day BEFORE their own date. Pure: the tables come from fx.ts (read beforehand); closed months are never touched.
import { nbpRateBeforeKnown } from "./fx";
import { normalizeInvoicePayments } from "./payments.domain";
import { recomputeInvoiceMoney } from "./invoicing";

const ISO = /^\d{4}-\d{2}-\d{2}/;
const foreign = (i: any) => !!i && String(i.currency || "PLN").toUpperCase() !== "PLN" && i.paymentStatus !== "Cancelled";
/** An invoice not yet rated from NBP (fxTableDate marks a rated one), outside a closed month. */
function fxNeedsInvoice(i: any, isClosed: (d: string) => boolean): boolean { return foreign(i) && ISO.test(String(i.issueDate || "")) && !i.fxTableDate && !isClosed(i.issueDate); }
/** A payment of a foreign invoice with no rate yet, outside a closed month. */
function fxNeedsPayment(i: any, p: any, isClosed: (d: string) => boolean): boolean { return foreign(i) && !(Number(p?.settlementFxRate) > 0) && ISO.test(String(p?.date || "")) && !isClosed(p.date); }
/** The dates whose NBP tables are needed (sorted). */
export function fxDatesNeeded(invoices: any[], isClosed: (d: string) => boolean): string[] {
  return (invoices || []).flatMap((i: any) => [fxNeedsInvoice(i, isClosed) ? String(i.issueDate).slice(0, 10) : "",
    ...normalizeInvoicePayments(i).filter((p: any) => fxNeedsPayment(i, p, isClosed)).map((p: any) => String(p.date).slice(0, 10))]).filter(Boolean).sort();
}
/** One invoice with its NBP rates filled where known (unchanged object when nothing to do). log (optional) collects what changed. */
export function fxFillInvoice(inv: any, isClosed: (d: string) => boolean, log?: string[] | null): any {
  if (!foreign(inv)) return inv;
  const cur = String(inv.currency).toUpperCase(); let out = inv;
  if (fxNeedsInvoice(inv, isClosed)) { const r = nbpRateBeforeKnown(cur, inv.issueDate);
    if (r) { const moved = Math.abs(r.rate - Number(inv.fxRate || 0)) > 0.00005;
      out = { ...(moved ? recomputeInvoiceMoney({ ...inv, fxRate: r.rate }) : inv), fxTableDate: r.tableDate };
      if (log && moved) log.push(`${inv.number} ${inv.fxRate} → ${r.rate} (NBP ${r.tableDate})`); } }
  let touched = false;
  const evs = normalizeInvoicePayments(out).map((p: any) => { if (!fxNeedsPayment(out, p, isClosed)) return p; const r = nbpRateBeforeKnown(cur, p.date); if (!r) return p; touched = true;
    if (log) log.push(`${inv.number} payment of ${String(p.date).slice(0, 10)}: NBP ${r.tableDate} ${r.rate}`);
    return { ...p, settlementFxRate: r.rate, settledPLN: Math.round(r.rate * Number(p.amount || 0) * 100) / 100, fxTableDate: r.tableDate }; });
  return touched ? { ...out, payments: evs } : out;
}
