"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildClaimNote = exports.nextClaimNumber = exports.computeClaim = exports.lineEUR = void 0;
const numbers_1 = require("./numbers");
// ─────────────────────────────────────────────────────────────────────────────
// claim.domain.ts — the Producer Claim document (Batch 6a, BP-55b / BP-33 / BP-37)
//
// Mirrors the business's Claim Request Form: quantify the total cost of the
// damaged consignment at the client's warehouse (multi-currency: PLN via the
// NBP rate, EGP via the EGP/EUR rate, EUR as-is), apply the defect percentage,
// subtract what was recovered by selling the defected product in the market,
// and request the balance from the producer as a credit note.
//
// Ownership (frozen map): the claim EVENT lives on the Inventory lot; the
// requested CREDIT NOTE is a FinanceNote (direction "incoming" — it reduces
// what we owe the producer, which the Batch-5b ledger flip already counts).
// All money maths per-line-rounded to 2dp, exactly like the paper form.
// ─────────────────────────────────────────────────────────────────────────────
// v6.32.0 (R7b-4): comma-aware canonical parser — "1,5" now parses as 1.5.
const n = numbers_1.parseNum;
function r2(v) { return Math.round(v * 100) / 100; }
/** One line's EUR value: own rate first, claim-level fallback second. */
function lineEUR(line, rates = {}) {
    const amt = n(line.amount);
    if (!amt)
        return 0;
    if (line.currency === "EUR")
        return r2(amt);
    if (line.currency === "PLN") {
        const rate = n(line.rate) || n(rates.plnPerEur);
        return rate > 0 ? r2(amt / rate) : 0;
    }
    // EGP
    const rate = n(line.rate) || n(rates.egpPerEur);
    return rate > 0 ? r2(amt / rate) : 0;
}
exports.lineEUR = lineEUR;
function computeClaim(input) {
    const rates = input.rates || {};
    const lines = (input.costLines || []).map(l => ({ ...l, eur: lineEUR(l, rates) }));
    const totalCostEUR = r2(lines.reduce((s, l) => s + l.eur, 0));
    const pct = Math.max(0, Math.min(100, n(input.defectPct)));
    const defectValueEUR = r2(totalCostEUR * pct / 100);
    let recoveredEUR = 0;
    if (input.soldInMarket !== false && n(input.recoveredAmount) > 0) {
        recoveredEUR = lineEUR({
            label: "recovered", amount: input.recoveredAmount,
            currency: input.recoveredCurrency || "EGP", rate: input.recoveredRate,
        }, rates);
    }
    const creditNoteEUR = r2(Math.max(0, defectValueEUR - recoveredEUR));
    return { lines, totalCostEUR, defectValueEUR, recoveredEUR, creditNoteEUR };
}
exports.computeClaim = computeClaim;
/** Next claim number, scanning existing lot.claims[].number values. */
function nextClaimNumber(lots, year) {
    let max = 0;
    (lots || []).forEach(l => {
        ((l === null || l === void 0 ? void 0 : l.claims) || []).forEach((c) => {
            const m = String((c === null || c === void 0 ? void 0 : c.number) || "").match(/^CLM-(\d{4})-(\d{4})$/);
            if (m && Number(m[1]) === year)
                max = Math.max(max, Number(m[2]));
        });
    });
    return `CLM-${year}-${String(max + 1).padStart(4, "0")}`;
}
exports.nextClaimNumber = nextClaimNumber;
/** The requested credit note as a FinanceNote (direction "incoming": it reduces
 *  what we owe the producer — the BP-37 ledger flip counts it immediately). */
function buildClaimNote(lot, po, claim, comp, eurPlnRate, deps) {
    var _a;
    const fx = n(eurPlnRate) || 1;
    return {
        id: deps.nextId(),
        noteType: "CREDIT",
        direction: "incoming",
        partyName: ((_a = po === null || po === void 0 ? void 0 : po.supplier) === null || _a === void 0 ? void 0 : _a.name) || claim.supplierName || "Producer",
        category: "Quality complaint",
        amount: comp.creditNoteEUR,
        currency: "EUR",
        fxRate: fx,
        amountPLN: r2(comp.creditNoteEUR * fx),
        status: "Draft",
        reason: `Producer claim ${claim.number || ""} — ${claim.defectType || "quality defect"} ${n(claim.defectPct)}% of consignment (lot ${lot.number}${lot.poRef ? ", " + lot.poRef : ""})`.trim(),
        date: claim.date || deps.todayISO(),
        relatedRef: claim.number || lot.number,
    };
}
exports.buildClaimNote = buildClaimNote;
