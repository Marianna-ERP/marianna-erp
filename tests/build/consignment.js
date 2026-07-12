"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.settlementCostComponents = exports.computeLotSettlement = exports.lineSourcesLot = exports.currentCommissionPct = void 0;
const salesOrders_domain_1 = require("./salesOrders.domain");
function n(v) { const x = parseFloat(v); return isFinite(x) ? x : 0; }
function r2(x) { return Math.round(x * 100) / 100; }
function norm(s) { return String(s || "").trim().toLowerCase(); }
// Season commission for a producer: the rate with the latest validFrom <= date.
function currentCommissionPct(producer, dateISO) {
    const rates = ((producer === null || producer === void 0 ? void 0 : producer.commissionRates) || []).filter((r) => r && isFinite(parseFloat(r.pct)));
    if (!rates.length)
        return null;
    const applicable = rates
        .filter(r => !r.validFrom || String(r.validFrom) <= String(dateISO))
        .sort((a, b) => String(a.validFrom || "").localeCompare(String(b.validFrom || "")));
    const pick = applicable[applicable.length - 1] || rates[0];
    return n(pick.pct);
}
exports.currentCommissionPct = currentCommissionPct;
// Does an SO line source from this lot (directly, or via the lot's PO)?
function lineSourcesLot(item, lot) {
    if (!item || !lot)
        return false;
    if (item.sourceType === "STOCK" && String(item.sourceRef) === String(lot.number))
        return true;
    if (item.sourceType === "PO" && lot.poRef && String(item.sourceRef) === String(lot.poRef)) {
        // v6.32.0 (A1, canonical semantics): poLineId is authoritative when both
        // sides carry it (FB-1); otherwise variety-aware product match (FB-12) —
        // the old name-only rule could attribute one variety's sales to another
        // variety's consignment settlement.
        if (item.sourceLineId != null && lot.poLineId != null)
            return String(item.sourceLineId) === String(lot.poLineId);
        return (0, salesOrders_domain_1.productsMatch)(item.product, lot.product, item.variety, lot.variety);
    }
    return false;
}
exports.lineSourcesLot = lineSourcesLot;
function computeLotSettlement(lot, orders, commissionPct, extraExpenses = []) {
    const warnings = [];
    const salesLines = [];
    (orders || []).forEach((o) => {
        if (!o || o.status === "Draft" || o.status === "Cancelled")
            return;
        (o.items || []).forEach((it) => {
            var _a;
            if (!lineSourcesLot(it, lot))
                return;
            const kg = n(it.qty);
            const price = n(it.unitPrice);
            const fx = n(o.fxRate) || 1;
            if (kg <= 0)
                return;
            if (price <= 0)
                warnings.push(`SO ${o.number}: line "${it.product}" has no selling price yet — settlement is incomplete.`);
            salesLines.push({
                soNumber: o.number, client: ((_a = o.client) === null || _a === void 0 ? void 0 : _a.name) || "—", product: it.product || "—",
                kg, unitPrice: price, currency: o.currency || "PLN", fxRate: fx,
                pln: r2(kg * price * fx),
            });
        });
    });
    const grossPLN = r2(salesLines.reduce((s, l) => s + l.pln, 0));
    const soldKg = r2(salesLines.reduce((s, l) => s + l.kg, 0));
    if (soldKg === 0)
        warnings.push("No sales sourced from this lot yet — gross sales value is zero.");
    const expectedKg = n(lot === null || lot === void 0 ? void 0 : lot.expectedKg) || n(lot === null || lot === void 0 ? void 0 : lot.receivedKg);
    if (expectedKg > 0 && soldKg < expectedKg) {
        warnings.push(`Sold ${soldKg.toLocaleString("pl-PL")} kg of ${expectedKg.toLocaleString("pl-PL")} kg — ${(expectedKg - soldKg).toLocaleString("pl-PL")} kg not yet sold. Settle only when the truck is fully sold, or note the remainder.`);
    }
    if (expectedKg > 0 && soldKg > expectedKg * 1.001) {
        warnings.push(`Sold ${soldKg.toLocaleString("pl-PL")} kg exceeds the lot's ${expectedKg.toLocaleString("pl-PL")} kg — check for double-sourced SO lines.`);
    }
    // Expenses: every cost the system tracked on the lot (freight allocations,
    // approved warehouse invoices, customs...) EXCEPT settlement-written
    // components themselves, plus manual extra lines.
    const expenseLines = [];
    ((lot === null || lot === void 0 ? void 0 : lot.costs) || []).forEach((c) => {
        if (String(c.source || "").startsWith("CONSIGN"))
            return; // our own settlement output
        if (c.type === "purchase")
            return; // consignment lots have no purchase cost
        const pln = n(c.pln);
        if (pln === 0)
            return;
        expenseLines.push({ label: c.label || c.type || "Cost", pln: r2(pln), source: c.source });
    });
    (extraExpenses || []).forEach(e => {
        const pln = n(e.pln);
        if (pln === 0)
            return;
        expenseLines.push({ id: e.id, label: e.label || "Manual expense", pln: r2(pln), manual: true });
    });
    const expensesPLN = r2(expenseLines.reduce((s, l) => s + l.pln, 0));
    const netPLN = r2(grossPLN - expensesPLN);
    if (netPLN < 0)
        warnings.push("Expenses exceed gross sales — net sales value is negative. Verify expense lines before sending the statement.");
    const pct = n(commissionPct);
    const commissionPLN = r2(Math.max(0, netPLN) * pct / 100);
    const payoutPLN = r2(netPLN - commissionPLN);
    return { grossPLN, salesLines, expenseLines, expensesPLN, netPLN, commissionPct: pct, commissionPLN, payoutPLN, soldKg, warnings };
}
exports.computeLotSettlement = computeLotSettlement;
// Cost components written onto the lot when the settlement closes. Idempotent
// via fixed sources; producer invoice amount may differ from expected net.
function settlementCostComponents(lot, producerInvoicePLN, commissionPLN, producerInvoiceNo, commissionInvoiceNo) {
    return [
        { type: "Consignment purchase", label: `Producer invoice ${producerInvoiceNo || "(no number)"} — net sales value`, pln: r2(n(producerInvoicePLN)), source: `CONSIGN-${lot.id}` },
        { type: "Commission credit", label: `Our commission invoice ${commissionInvoiceNo || "(no number)"}`, pln: r2(-Math.abs(n(commissionPLN))), source: `CONSIGNC-${lot.id}` },
    ];
}
exports.settlementCostComponents = settlementCostComponents;
