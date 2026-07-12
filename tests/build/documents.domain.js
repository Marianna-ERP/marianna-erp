"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// documents.domain.ts — pure computed document links (Consolidation Batch 4a)
//
// BP-3 / BP-49: a PO/SO must not rely on stored linkedShipments/linkedLots/
// linkedInvoices arrays (they drift — the same class as the counterparty
// linkedDocs issue). Linked records are DERIVED from the other documents that
// reference this one. Pure + parameterised; no React, no module state.
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.poSalesLink = exports.computedSOLinks = exports.computedPOLinks = void 0;
function refsOf(v) {
    if (Array.isArray(v))
        return v.filter(Boolean).map(String);
    return v ? [String(v)] : [];
}
/** Shipments that reference a PO (header poRefs or any goods-line poRef). */
function shipmentsForPO(poNumber, shipments) {
    const out = new Set();
    (shipments || []).forEach(s => {
        const hit = refsOf(s.poRefs).includes(poNumber) ||
            (s.goods || []).some((g) => g.poRef === poNumber);
        if (hit)
            out.add(s.number);
    });
    return Array.from(out);
}
function shipmentsForSO(soNumber, shipments) {
    const out = new Set();
    (shipments || []).forEach(s => {
        const hit = refsOf(s.soRefs).includes(soNumber) ||
            (s.goods || []).some((g) => g.soRef === soNumber);
        if (hit)
            out.add(s.number);
    });
    return Array.from(out);
}
function lotsForPO(poNumber, lots) {
    return (lots || []).filter(l => l.poRef === poNumber).map(l => l.number);
}
function invoicesForCounterpartyDoc(docNumber, kind, invoices) {
    const out = new Set();
    (invoices || []).forEach(inv => {
        const links = [...refsOf(inv.poRef), ...refsOf(inv.soRef), ...refsOf(inv.links),
            ...refsOf(inv.sourceRef), ...(inv.positions || []).flatMap((p) => [...refsOf(p.poRef), ...refsOf(p.soRef)])];
        if (links.includes(docNumber))
            out.add(inv.number);
    });
    return Array.from(out);
}
/** Computed linked records for a PO (BP-49). */
function computedPOLinks(po, { shipments = [], lots = [], invoices = [], orders = [] }) {
    // SOs that source from this PO (any line sourceType PO + sourceRef == po.number)
    const linkedSalesOrders = (orders || [])
        .filter((o) => (o.items || []).some((it) => it.sourceType === "PO" && it.sourceRef === po.number))
        .map((o) => o.number);
    return {
        linkedShipments: shipmentsForPO(po.number, shipments),
        linkedLots: lotsForPO(po.number, lots),
        linkedInvoices: invoicesForCounterpartyDoc(po.number, "PO", invoices),
        linkedSalesOrders,
    };
}
exports.computedPOLinks = computedPOLinks;
/** Computed linked records for an SO (BP-49). */
function computedSOLinks(so, { shipments = [], invoices = [], lots = [] }) {
    const linkedLots = Array.from(new Set((so.items || [])
        .map((it) => it.sourceType === "STOCK" ? it.sourceRef : null)
        .filter(Boolean)
        .concat((lots || []).filter((l) => (so.items || []).some((it) => it.sourceType === "PO" && it.sourceRef === l.poRef)).map((l) => l.number))));
    return {
        linkedShipments: shipmentsForSO(so.number, shipments),
        linkedInvoices: invoicesForCounterpartyDoc(so.number, "SO", invoices),
        linkedLots,
    };
}
exports.computedSOLinks = computedSOLinks;
/**
 * BP-3: the PO's sales-link state, derived from the SOs that source from it.
 * Unsold / Linked / Partially sold / Fully sold — quantity-aware where possible.
 */
function poSalesLink(po, orders) {
    const norm = (p) => String(p || "").toLowerCase().trim();
    const soLines = [];
    (orders || []).forEach(o => {
        if (o.status === "Cancelled")
            return;
        (o.items || []).forEach((it) => {
            if (it.sourceType === "PO" && it.sourceRef === po.number)
                soLines.push({ o, it });
        });
    });
    const linkedSOs = Array.from(new Set(soLines.map(x => x.o.number)));
    if (!linkedSOs.length)
        return { state: "Unsold", label: "Unsold", linkedSOs: [], soldKg: 0, orderedKg: 0, pct: 0 };
    const orderedKg = (po.items || []).reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
    const soldKg = soLines.reduce((s, x) => s + (parseFloat(x.it.qty) || 0), 0);
    const pct = orderedKg > 0 ? Math.round((soldKg / orderedKg) * 100) : 0;
    let state, label;
    if (orderedKg > 0 && soldKg >= orderedKg - 0.001) {
        state = "Fully";
        label = "Fully sold";
    }
    else if (linkedSOs.length > 1) {
        state = "Multiple";
        label = `Sold to ${linkedSOs.length} orders (${pct}%)`;
    }
    else if (orderedKg > 0 && soldKg > 0 && pct < 100) {
        state = "Partial";
        label = `Partially sold — ${linkedSOs[0]} (${pct}%)`;
    }
    else {
        state = "Linked";
        label = `Linked to ${linkedSOs[0]}`;
    }
    return { state, label, linkedSOs, soldKg, orderedKg, pct };
}
exports.poSalesLink = poSalesLink;
