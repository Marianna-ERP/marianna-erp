// ─────────────────────────────────────────────────────────────────────────────
// advances.domain.ts — v6.68.0 (F-1): ADVANCE PAYMENTS (zaliczki)
//
// Money that arrives BEFORE any invoice exists gets a home: an on-account
// record per counterparty. Applying an advance to an invoice produces a
// standard payment event (source advance:{advId}:{allocId}) and an allocation
// entry on the advance — both sides carry the trail, nothing can double-apply.
// In Supabase this becomes the advance_payments table + allocations.
// ─────────────────────────────────────────────────────────────────────────────
import { applyPaymentEvent } from "./payments.domain";

const n = (v: any) => { const x = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface AdvanceAllocation { id: any; invoiceId: any; invoiceNumber: string; amount: number; date: string; }
export interface AdvancePayment {
  id: any; counterpartyName: string; contactId?: any;
  /** v6.68.1 (owner ruling): every advance answers a PRO-FORMA invoice — in both
   *  directions (RECEIVED against our pro-forma; PAID against the supplier's). */
  direction?: "RECEIVED" | "PAID";
  proformaId?: any; proformaNumber?: string;
  date: string; amount: number; currency: string; fxRate: number; amountPLN: number;
  source: string;              // bank:{lineId} | manual:{id} — idempotency key
  note?: string;
  allocations: AdvanceAllocation[];
}

export function advanceRemaining(adv: AdvancePayment): number {
  return r2(n(adv?.amount) - (adv?.allocations || []).reduce((s, a) => s + n(a.amount), 0));
}

export function advanceFromBankLine(line: any, deps: { nextId: () => any }): AdvancePayment {
  return {
    id: deps.nextId(),
    counterpartyName: String(line?.counterparty || "").slice(0, 80),
    date: String(line?.date || ""),
    amount: r2(n(line?.amount)),
    currency: String(line?.currency || "PLN").toUpperCase(),
    fxRate: line?.currency === "PLN" ? 1 : 0, // 0 = rate unknown; set when applied/settled
    amountPLN: line?.currency === "PLN" ? r2(n(line?.amount)) : 0,
    source: `bank:${line?.id}`,
    direction: "RECEIVED",
    proformaId: null, proformaNumber: "",
    note: String(line?.title || "").slice(0, 120),
    allocations: [],
  };
}

/** Apply part of an advance to an invoice. Returns the updated pair, or an error
 *  string. The invoice gains a normal payment event; partials accumulate. */
export function applyAdvanceToInvoice(
  adv: AdvancePayment, invoice: any, amount: any,
  deps: { nextId: () => any; todayISO: () => string }
): { advance: AdvancePayment; invoice: any } | { error: string } {
  const amt = r2(n(amount));
  const remaining = advanceRemaining(adv);
  if (!(amt > 0)) return { error: "Amount must be greater than zero." };
  if (amt - remaining > 0.005) return { error: `Only ${remaining.toLocaleString("pl-PL")} ${adv.currency} of this advance remains unallocated.` };
  if (String(invoice?.currency || "PLN").toUpperCase() !== adv.currency)
    return { error: `Currency mismatch — the advance is in ${adv.currency}, the invoice in ${invoice?.currency}. Cross-currency application stays manual with a stated rate.` };
  if (invoice?.paymentStatus === "Cancelled") return { error: "The invoice is cancelled." };
  if (invoice?.isProforma) return { error: "That is the PRO-FORMA — it explains why the money arrived, but it is not the receivable. Apply the advance to the FINAL invoice once issued." };
  const allocId = deps.nextId();
  const evt = {
    date: deps.todayISO(), amount: amt, method: "Advance",
    note: `Advance from ${adv.counterpartyName} (${adv.date})`,
    source: `advance:${adv.id}:${allocId}`,
  };
  const nextInvoice = applyPaymentEvent(invoice, evt, deps.nextId);
  const nextAdvance: AdvancePayment = {
    ...adv,
    allocations: [...(adv.allocations || []), { id: allocId, invoiceId: invoice.id, invoiceNumber: String(invoice.number || ""), amount: amt, date: evt.date }],
  };
  return { advance: nextAdvance, invoice: nextInvoice };
}

/** Idempotency across imports: every source already recorded as an advance. */
export function advanceSources(advances: AdvancePayment[]): Set<string> {
  return new Set((advances || []).map(a => String(a.source || "")).filter(Boolean));
}


/** v6.68.1: link an advance to the pro-forma it answers. Guards: the document
 *  must BE a pro-forma, in the advance's currency. */
export function linkAdvanceToProforma(adv: AdvancePayment, invoice: any): AdvancePayment | { error: string } {
  if (!invoice?.isProforma) return { error: "Only a pro-forma invoice can be linked here — the final invoice gets the advance APPLIED to it instead." };
  if (String(invoice?.currency || "PLN").toUpperCase() !== adv.currency) return { error: `Currency mismatch — the pro-forma is in ${invoice?.currency}, the advance in ${adv.currency}.` };
  return { ...adv, proformaId: invoice.id, proformaNumber: String(invoice.number || "") };
}
