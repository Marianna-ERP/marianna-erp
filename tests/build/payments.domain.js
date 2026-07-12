"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertSettledRefsToEvents = exports.unmarkLedgerPaid = exports.markInvoicePaidViaLedger = exports.LEDGER_MARK_NOTE = exports.notesTotalsAdjustment = exports.removePaymentEvent = exports.applyPaymentEvent = exports.outstandingAmount = exports.paidFromEvents = exports.normalizeInvoicePayments = exports.PAYMENT_METHODS = void 0;
const numbers_1 = require("./numbers");
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
const n = numbers_1.parseNum;
function r2(v) { return Math.round(v * 100) / 100; }
exports.PAYMENT_METHODS = ["Bank transfer", "Cash", "Offset / compensation", "Other"];
/** Normalise: returns the invoice's payment events, synthesising one from a
 *  legacy paidAmount when no events exist yet. Pure — does not mutate. */
function normalizeInvoicePayments(inv) {
    if (Array.isArray(inv === null || inv === void 0 ? void 0 : inv.payments) && inv.payments.length)
        return inv.payments;
    const legacy = n(inv === null || inv === void 0 ? void 0 : inv.paidAmount);
    if (legacy > 0) {
        return [{
                id: "legacy-1",
                date: String((inv === null || inv === void 0 ? void 0 : inv.paidDate) || (inv === null || inv === void 0 ? void 0 : inv.issueDate) || "").slice(0, 10),
                amount: r2(legacy),
                method: "legacy",
                note: "Migrated from the single paid amount",
            }];
    }
    return [];
}
exports.normalizeInvoicePayments = normalizeInvoicePayments;
/** Total paid in the INVOICE currency (sum of events). */
function paidFromEvents(inv) {
    return r2(normalizeInvoicePayments(inv).reduce((s, p) => s + n(p.amount), 0));
}
exports.paidFromEvents = paidFromEvents;
/** Outstanding in the invoice currency. */
function outstandingAmount(inv) {
    return r2(Math.max(0, n(inv === null || inv === void 0 ? void 0 : inv.grossAmount) - paidFromEvents(inv)));
}
exports.outstandingAmount = outstandingAmount;
function statusFor(inv, paid) {
    const gross = n(inv === null || inv === void 0 ? void 0 : inv.grossAmount);
    if (gross > 0 && paid >= gross - 0.01)
        return "Paid";
    if (paid > 0)
        return "Partially paid";
    return (inv === null || inv === void 0 ? void 0 : inv.paymentStatus) === "Paid" || (inv === null || inv === void 0 ? void 0 : inv.paymentStatus) === "Partially paid" ? "Sent" : ((inv === null || inv === void 0 ? void 0 : inv.paymentStatus) || "Draft");
}
/** Append a payment event; recomputes the derived paidAmount + paymentStatus. */
function applyPaymentEvent(inv, evt, nextId) {
    const events = [...normalizeInvoicePayments(inv), {
            id: nextId(), date: String(evt.date || "").slice(0, 10), amount: r2(n(evt.amount)),
            method: evt.method || "Bank transfer", note: evt.note || "",
        }];
    const paid = r2(events.reduce((s, p) => s + n(p.amount), 0));
    return { ...inv, payments: events, paidAmount: paid, paymentStatus: statusFor(inv, paid) };
}
exports.applyPaymentEvent = applyPaymentEvent;
/** Remove an event by id; recomputes derived fields (legacy event removable too). */
function removePaymentEvent(inv, evtId) {
    const events = normalizeInvoicePayments(inv).filter(p => String(p.id) !== String(evtId));
    const paid = r2(events.reduce((s, p) => s + n(p.amount), 0));
    return { ...inv, payments: events, paidAmount: paid, paymentStatus: statusFor(inv, paid) };
}
exports.removePaymentEvent = removePaymentEvent;
// ── BP-37: credit/debit notes enter the ledger totals ───────────────────────
// direction "outgoing" = a note WE issued to a client (receivable side);
// direction "incoming" = a note from a supplier to us (payable side).
// CREDIT reduces the open amount on its side; DEBIT increases it.
function notesTotalsAdjustment(financeNotes) {
    let recv = 0, pay = 0;
    (financeNotes || []).forEach((nt) => {
        if (!nt || nt.status === "Cancelled")
            return;
        const pln = n(nt.amountPLN) || n(nt.amount) * (n(nt.fxRate) || 1);
        if (pln <= 0)
            return;
        const sign = (nt.noteType === "DEBIT" || nt.noteKind === "DEBIT") ? +1 : -1; // CREDIT reduces
        if (nt.direction === "incoming")
            pay += sign * pln;
        else
            recv += sign * pln;
    });
    return { receivableAdjPLN: r2(recv), payableAdjPLN: r2(pay) };
}
exports.notesTotalsAdjustment = notesTotalsAdjustment;
// ── BP-39: settledRefs retirement ────────────────────────────────────────────
// "Mark paid" flags on INVOICES become real payment events (tagged, reversible).
// PO:/PAYOUT: refs keep the flag mechanism — they have no invoice record to
// carry events (they retire naturally when those rows become invoice records).
exports.LEDGER_MARK_NOTE = "[ledger-mark]";
function markInvoicePaidViaLedger(inv, todayISO, nextId) {
    const out = outstandingAmount(inv);
    if (out <= 0)
        return inv;
    return applyPaymentEvent(inv, {
        date: todayISO, amount: out, method: "Other",
        note: `${exports.LEDGER_MARK_NOTE} Marked paid in the Finance ledger`,
    }, nextId);
}
exports.markInvoicePaidViaLedger = markInvoicePaidViaLedger;
/** Undo a ledger mark: removes ONLY tagged mark events. Returns null if the
 *  invoice is paid by real (untagged) payments — the caller should say so. */
function unmarkLedgerPaid(inv) {
    const events = normalizeInvoicePayments(inv);
    const marks = events.filter(p => String(p.note || "").startsWith(exports.LEDGER_MARK_NOTE));
    if (!marks.length)
        return null;
    let next = inv;
    marks.forEach(m => { next = removePaymentEvent(next, m.id); });
    return next;
}
exports.unmarkLedgerPaid = unmarkLedgerPaid;
/** One-time conversion of legacy settledRefs: INV:<id> and SINV:<number> flags
 *  become tagged payment events on their invoices; other refs pass through. */
function convertSettledRefsToEvents(invoices, settledRefs, deps) {
    let converted = 0;
    let nextInvoices = invoices || [];
    const keep = [];
    (settledRefs || []).forEach(ref => {
        const r = String(ref);
        let inv = null;
        if (r.startsWith("INV:"))
            inv = nextInvoices.find((i) => String(i.id) === r.slice(4));
        else if (r.startsWith("SINV:"))
            inv = nextInvoices.find((i) => i.kind === "SALES" && String(i.number) === r.slice(5));
        if (!inv) {
            keep.push(r);
            return;
        }
        converted++;
        if (outstandingAmount(inv) > 0 && inv.paymentStatus !== "Paid") {
            const marked = markInvoicePaidViaLedger(inv, deps.todayISO(), deps.nextId);
            nextInvoices = nextInvoices.map((i) => i.id === inv.id ? marked : i);
        }
        // ref dropped either way — the invoice now carries/derives its own paid state
    });
    return { invoices: nextInvoices, settledRefs: keep, converted };
}
exports.convertSettledRefsToEvents = convertSettledRefsToEvents;
