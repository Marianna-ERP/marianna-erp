import { parseNum } from "./numbers";
// ─────────────────────────────────────────────────────────────────────────────
// payments.domain.ts — payment EVENTS on invoices (Batch 5b, BP-36)
//
// An invoice's payments become a list of dated events (date, amount, method,
// note) instead of a single mutable paidAmount. Strategy is DERIVE-ON-READ:
// no storage-version bump — a legacy invoice with paidAmount > 0 and no
// payments[] is normalised to one synthetic "legacy" event, so old data and
// old shared-JSON exports keep working unchanged in both directions.
// paidAmount is kept written as a derived cache so everything that still reads
// it (fx-aware ledger fallback, Fakturownia sync display) stays correct.
// ─────────────────────────────────────────────────────────────────────────────

// v6.32.0 (R7b-4): comma-aware canonical parser — "1,5" now parses as 1.5.
const n = parseNum;
function r2(v: number): number { return Math.round(v * 100) / 100; }

export interface PaymentEvent {
  id: any;
  date: string;        // ISO yyyy-mm-dd
  amount: number;      // in the INVOICE currency
  method: string;      // Bank transfer | Cash | Offset / compensation | Other | legacy
  note?: string;
}

export const PAYMENT_METHODS = ["Bank transfer", "Cash", "Offset / compensation", "Other"];

/** Normalise: returns the invoice's payment events, synthesising one from a
 *  legacy paidAmount when no events exist yet. Pure — does not mutate. */
export function normalizeInvoicePayments(inv: any): PaymentEvent[] {
  if (Array.isArray(inv?.payments) && inv.payments.length) return inv.payments;
  const legacy = n(inv?.paidAmount);
  if (legacy > 0) {
    return [{
      id: "legacy-1",
      date: String(inv?.paidDate || inv?.issueDate || "").slice(0, 10),
      amount: r2(legacy),
      method: "legacy",
      note: "Migrated from the single paid amount",
    }];
  }
  return [];
}

/** Total paid in the INVOICE currency (sum of events). */
export function paidFromEvents(inv: any): number {
  return r2(normalizeInvoicePayments(inv).reduce((s, p) => s + n(p.amount), 0));
}

/** Outstanding in the invoice currency. */
export function outstandingAmount(inv: any): number {
  return r2(Math.max(0, n(inv?.grossAmount) - paidFromEvents(inv)));
}

function statusFor(inv: any, paid: number): string {
  const gross = n(inv?.grossAmount);
  if (gross > 0 && paid >= gross - 0.01) return "Paid";
  if (paid > 0) return "Partially paid";
  return inv?.paymentStatus === "Paid" || inv?.paymentStatus === "Partially paid" ? "Sent" : (inv?.paymentStatus || "Draft");
}

/** Append a payment event; recomputes the derived paidAmount + paymentStatus. */
export function applyPaymentEvent(inv: any, evt: { date: string; amount: any; method?: string; note?: string; source?: string }, nextId: () => any): any {
  const events = [...normalizeInvoicePayments(inv), {
    id: nextId(), date: String(evt.date || "").slice(0, 10), amount: r2(n(evt.amount)),
    method: evt.method || "Bank transfer", note: evt.note || "",
    // v6.67.0 (D-33): bank-sourced events carry bank:{account}:{lineId} so a
    // re-imported statement can never double-post — same idempotency discipline
    // as claim: and WHINV- sources.
    ...(evt.source ? { source: String(evt.source) } : {}),
  }];
  const paid = r2(events.reduce((s, p) => s + n(p.amount), 0));
  return { ...inv, payments: events, paidAmount: paid, paymentStatus: statusFor(inv, paid) };
}

/** Remove an event by id; recomputes derived fields (legacy event removable too). */
export function removePaymentEvent(inv: any, evtId: any): any {
  const events = normalizeInvoicePayments(inv).filter(p => String(p.id) !== String(evtId));
  const paid = r2(events.reduce((s, p) => s + n(p.amount), 0));
  return { ...inv, payments: events, paidAmount: paid, paymentStatus: statusFor(inv, paid) };
}

// ── BP-37: credit/debit notes enter the ledger totals ───────────────────────
// direction "outgoing" = a note WE issued to a client (receivable side);
// direction "incoming" = a note from a supplier to us (payable side).
// CREDIT reduces the open amount on its side; DEBIT increases it.
// ── v6.63.0 (owner axiom): "a credit note is what we give back; a debit note is
// what we get." Generalised: THE ISSUER OF A CREDIT NOTE PAYS; THE ISSUER OF A
// DEBIT NOTE COLLECTS. Every note carries issuedBy ("US" | "COUNTERPARTY");
// legacy notes without it derive it from direction (outgoing → US, incoming →
// COUNTERPARTY), which reproduces the old behaviour EXACTLY. The new capability
// this unlocks: a DEBIT note WE issue to a supplier/carrier (claim recovery)
// now correctly REDUCES the payable instead of increasing it.
export function noteIssuedBy(nt: any): "US" | "COUNTERPARTY" {
  const v = String(nt?.issuedBy || "").toUpperCase();
  if (v === "US" || v === "COUNTERPARTY") return v as any;
  return nt?.direction === "incoming" ? "COUNTERPARTY" : "US";
}

/** Signed PLN effect of one note on its side's OPEN total.
 *  sign = issuer(US:+1/THEM:−1) × type(DEBIT:+1/CREDIT:−1) × side(receivable:+1/payable:−1) */
export function noteLedgerEffect(nt: any): { side: "receivable" | "payable"; deltaPLN: number } {
  const pln = n(nt?.amountPLN) || n(nt?.amount) * (n(nt?.fxRate) || 1);
  const side: "receivable" | "payable" = nt?.direction === "incoming" ? "payable" : "receivable";
  if (!nt || nt.status === "Cancelled" || pln <= 0) return { side, deltaPLN: 0 };
  const issuer = noteIssuedBy(nt) === "US" ? 1 : -1;
  const type = (nt.noteType === "DEBIT" || nt.noteKind === "DEBIT") ? 1 : -1;
  const sideSign = side === "receivable" ? 1 : -1;
  return { side, deltaPLN: r2(issuer * type * sideSign * pln) };
}

export function notesTotalsAdjustment(financeNotes: any[]): { receivableAdjPLN: number; payableAdjPLN: number } {
  let recv = 0, pay = 0;
  (financeNotes || []).forEach((nt: any) => {
    const eff = noteLedgerEffect(nt);
    if (eff.side === "payable") pay += eff.deltaPLN; else recv += eff.deltaPLN;
  });
  return { receivableAdjPLN: r2(recv), payableAdjPLN: r2(pay) };
}

// ── BP-39: settledRefs retirement ────────────────────────────────────────────
// "Mark paid" flags on INVOICES become real payment events (tagged, reversible).
// PO:/PAYOUT: refs keep the flag mechanism — they have no invoice record to
// carry events (they retire naturally when those rows become invoice records).
export const LEDGER_MARK_NOTE = "[ledger-mark]";

export function markInvoicePaidViaLedger(inv: any, todayISO: string, nextId: () => any): any {
  const out = outstandingAmount(inv);
  if (out <= 0) return inv;
  return applyPaymentEvent(inv, {
    date: todayISO, amount: out, method: "Other",
    note: `${LEDGER_MARK_NOTE} Marked paid in the Finance ledger`,
  }, nextId);
}

/** Undo a ledger mark: removes ONLY tagged mark events. Returns null if the
 *  invoice is paid by real (untagged) payments — the caller should say so. */
export function unmarkLedgerPaid(inv: any): any | null {
  const events = normalizeInvoicePayments(inv);
  const marks = events.filter(p => String(p.note || "").startsWith(LEDGER_MARK_NOTE));
  if (!marks.length) return null;
  let next = inv;
  marks.forEach(m => { next = removePaymentEvent(next, m.id); });
  return next;
}

/** One-time conversion of legacy settledRefs: INV:<id> and SINV:<number> flags
 *  become tagged payment events on their invoices; other refs pass through. */
export function convertSettledRefsToEvents(invoices: any[], settledRefs: string[], deps: { todayISO: () => string; nextId: () => any }): { invoices: any[]; settledRefs: string[]; converted: number } {
  let converted = 0;
  let nextInvoices = invoices || [];
  const keep: string[] = [];
  (settledRefs || []).forEach(ref => {
    const r = String(ref);
    let inv: any = null;
    if (r.startsWith("INV:")) inv = nextInvoices.find((i: any) => String(i.id) === r.slice(4));
    else if (r.startsWith("SINV:")) inv = nextInvoices.find((i: any) => i.kind === "SALES" && String(i.number) === r.slice(5));
    if (!inv) { keep.push(r); return; }
    converted++;
    if (outstandingAmount(inv) > 0 && inv.paymentStatus !== "Paid") {
      const marked = markInvoicePaidViaLedger(inv, deps.todayISO(), deps.nextId);
      nextInvoices = nextInvoices.map((i: any) => i.id === inv.id ? marked : i);
    }
    // ref dropped either way — the invoice now carries/derives its own paid state
  });
  return { invoices: nextInvoices, settledRefs: keep, converted };
}
