"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCommissionInvoiceDraft = exports.nextSettlementNumber = void 0;
// ─────────────────────────────────────────────────────────────────────────────
// settlement.domain.ts — the Settlement DOCUMENT (Batch 5c, BP-38/31)
//
// A closed consignment settlement stops being an anonymous lot-side computation
// and becomes a numbered document: SET-YYYY-NNNN. At finalisation the commission
// is materialised as a real SALES invoice to the producer, auto-drafted into the
// Invoices registry ("Invoices is the only money-document registry").
//
// Commission is collected by DEDUCTION from the producer payout, so the drafted
// invoice carries one payment event of method "Offset / compensation" for the
// full commission — it documents the commission without double-counting the
// ledger (the payout payable is already net of commission). If the business
// instead invoices the commission separately, the user deletes that offset
// event and the invoice becomes normally receivable.
// ─────────────────────────────────────────────────────────────────────────────
const payments_domain_1 = require("./payments.domain");
const numbers_1 = require("./numbers");
// v6.32.0 (R7b-4): comma-aware canonical parser — "1,5" now parses as 1.5.
const n = numbers_1.parseNum;
function r2(v) { return Math.round(v * 100) / 100; }
/** Next settlement number, scanning existing lot.settlement.number values. */
function nextSettlementNumber(lots, year) {
    let max = 0;
    (lots || []).forEach(l => {
        var _a;
        const m = String(((_a = l === null || l === void 0 ? void 0 : l.settlement) === null || _a === void 0 ? void 0 : _a.number) || "").match(/^SET-(\d{4})-(\d{4})$/);
        if (m && Number(m[1]) === year)
            max = Math.max(max, Number(m[2]));
    });
    return `SET-${year}-${String(max + 1).padStart(4, "0")}`;
}
exports.nextSettlementNumber = nextSettlementNumber;
/** Auto-draft the commission SALES invoice at settlement close. */
function buildCommissionInvoiceDraft(lot, settlement, po, deps) {
    var _a;
    const commission = r2(n((_a = settlement.finalCommissionPLN) !== null && _a !== void 0 ? _a : settlement.expectedCommissionPLN));
    const producer = (po === null || po === void 0 ? void 0 : po.supplier) || { name: "Producer" };
    const today = deps.todayISO();
    const base = {
        id: deps.nextId(),
        kind: "SALES",
        category: "COMMISSION",
        number: settlement.commissionInvoiceNo || "",
        counterparty: { name: producer.name || "Producer", nip: producer.nip || "", address: producer.address || "" },
        issueDate: settlement.closedAt || today,
        saleDate: settlement.closedAt || today,
        dueDate: settlement.producerDueDate || settlement.closedAt || today,
        currency: "PLN", fxRate: 1,
        netAmount: commission, netPLN: commission,
        vatRate: 0, grossAmount: commission, grossPLN: commission,
        paymentStatus: "Draft",
        paidAmount: 0,
        // v6.30.1: positions now use the canonical InvoicePosition shape
        // ({name, quantity, unit, vatRate, grossTotal}) — the previous
        // {description, qty, unitPrice, net} shape was invisible to
        // buildFakturowniaPayload, which would have pushed a nameless,
        // amount-less line ("—", qty 1) to Fakturownia.
        positions: [{
                name: `Commission ${n(settlement.commissionPct)}% — consignment settlement ${settlement.number || ""} (lot ${lot.number}${lot.product ? ", " + lot.product : ""})`.trim(),
                quantity: 1, unit: "service", vatRate: 0, grossTotal: commission,
            }],
        links: [
            { type: "LOT", number: lot.number },
            ...(lot.poRef ? [{ type: "PO", number: lot.poRef }] : []),
            ...(settlement.number ? [{ type: "SET", number: settlement.number }] : []),
        ],
        source: `Settlement ${settlement.number || lot.number}`,
        notes: `Auto-drafted at settlement close. Commission collected by deduction from the producer payout (payment recorded as offset).`,
    };
    // Offset event: commission collected by deduction from the payout.
    return (0, payments_domain_1.applyPaymentEvent)(base, {
        date: settlement.closedAt || today,
        amount: commission,
        method: "Offset / compensation",
        note: `Deducted from producer payout — ${settlement.number || lot.number}`,
    }, deps.nextId);
}
exports.buildCommissionInvoiceDraft = buildCommissionInvoiceDraft;
