"use strict";
// ─── MARGIN / P&L CALCULATIONS ──────────────────────────────────────────────
//
// Pure functions for computing P/L on a Sales Order. No React, no UI — this
// lives by itself so it can be unit-tested and re-used (Finance module, SO
// detail card, Dashboard KPI, future reports).
//
// Two views are supported:
//
//   ACTUAL ("settled")
//     Revenue   = lines that have shipped (via SHIP_OUT movements traceable to this SO).
//     COGS      = lot costs (PLN) × kg shipped, attributed via SHIP_OUT movements.
//     Direct    = shipment costs where invoice has actually been received (status "Received" or "Cost allocated").
//     Use when: looking at historical performance, post-mortem on a delivered SO.
//
//   FORECAST ("expected")
//     Revenue   = full SO commitment (all line totals).
//     COGS      = lot-cost-per-kg × demanded qty for STOCK lines;
//                 PO unit-price × FX × qty for PO-sourced lines (with no LINV/CINV/WINV yet).
//     Direct    = expected shipment costs (full pipeline, regardless of invoice status).
//     Use when: sales is deciding whether to confirm a deal, or comparing to ACTUAL post hoc.
//
// Both views return the same shape so the UI can flip a toggle without
// branching at render time.
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeSOMargin = void 0;
const salesOrders_domain_1 = require("./salesOrders.domain");
// ─── helpers ────────────────────────────────────────────────────────────────
function safe(n) {
    const v = parseFloat(n);
    return isFinite(v) ? v : 0;
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
// COGS per kg for a lot — total cost divided by received qty (not physical).
// This matters because once received, the cost basis is fixed; ship-outs simply
// allocate that cost proportionally.
function lotCostPerKg(lot) {
    const totalPLN = (lot.costs || []).reduce((s, c) => s + safe(c.pln), 0);
    const denom = safe(lot.receivedKg) || safe(lot.expectedKg);
    return denom > 0 ? totalPLN / denom : 0;
}
// Sum SHIP_OUT kg from this lot for the given SO. Prefers the structured `soRef`
// field; falls back to substring-matching the SO number in the note for legacy
// movements created before soRef existed.
function lotShippedKgForSO(lot, soNumber) {
    return (lot.movements || [])
        .filter((m) => m.type === "SHIP_OUT" && (m.soRef ? String(m.soRef) === String(soNumber) : String(m.note || "").includes(soNumber)))
        .reduce((s, m) => s + safe(m.qtyKg), 0);
}
// Same but for REVERSAL (when an SO was cancelled and its ship-out was reversed).
function lotReversedKgForSO(lot, soNumber) {
    return (lot.movements || [])
        .filter((m) => m.type === "REVERSAL" && (m.soRef ? String(m.soRef) === String(soNumber) : String(m.note || "").includes(soNumber)))
        .reduce((s, m) => s + safe(m.qtyKg), 0);
}
// Net kg actually shipped (and not reversed) for this SO from this lot.
function lotNetShippedForSO(lot, soNumber) {
    return Math.max(0, lotShippedKgForSO(lot, soNumber) - lotReversedKgForSO(lot, soNumber));
}
// Find a PO line referenced by a stock-out SO item.
// PO shape varies between standalone-stub and integrated — handle both:
//   { number, items: [{ id, product, unitPrice, qty, ... }], currency, fxRate, ... }
function findPOLine(pos, poNumber, poLineId) {
    const po = (pos || []).find((p) => p.number === poNumber);
    if (!po)
        return null;
    const line = (po.items || []).find((l) => String(l.id) === String(poLineId !== null && poLineId !== void 0 ? poLineId : 1)) || (po.items || [])[0];
    if (!line)
        return null;
    return { po, line };
}
// ─── REVENUE ────────────────────────────────────────────────────────────────
function computeRevenue(order, mode, lots = [], shipments = []) {
    const lines = [];
    const warnings = [];
    let totalSO = 0;
    // v6.32.0 (P1-1): actual revenue by kg actually dispatched per line, from
    // SHIP_OUT movements + dispatched-shipment goods rows (deduped in the engine).
    // If the SO status claims shipped but NO shipping evidence exists anywhere
    // (legacy / manually-statused data), fall back to the old status-based 100%
    // WITH a warning — older test data keeps its numbers while being flagged.
    const statusShipped = ["Shipped", "Delivered", "Invoiced", "Closed"].includes(order.status);
    let shipped = null;
    if (mode === "actual") {
        shipped = (0, salesOrders_domain_1.shippedKgByLine)(order, lots, shipments);
        if (!shipped.hasEvidence && statusShipped) {
            warnings.push(`SO is ${order.status} but no shipment/movement evidence exists — actual revenue assumed 100% (legacy). Record the shipment to make this real.`);
        }
    }
    (order.items || []).forEach((it, idx) => {
        const qty = safe(it.qty);
        const price = safe(it.unitPrice);
        const lineTotal = qty * price;
        let label = `${it.product || "—"} · ${qty.toLocaleString("pl-PL")} kg @ ${price} ${order.currency || "PLN"}/kg`;
        let amountSO = lineTotal;
        let note;
        if (mode === "actual" && shipped) {
            if (!shipped.hasEvidence) {
                if (!statusShipped) {
                    amountSO = 0;
                    note = "Not yet shipped";
                }
            }
            else {
                const kg = Math.min(shipped.perLine[idx] || 0, qty);
                amountSO = round2(kg * price);
                if (kg <= 0)
                    note = "Not yet shipped";
                else if (kg < qty) {
                    note = `Partial: ${kg.toLocaleString("pl-PL")} of ${qty.toLocaleString("pl-PL")} kg shipped`;
                    label = `${it.product || "—"} · ${kg.toLocaleString("pl-PL")}/${qty.toLocaleString("pl-PL")} kg @ ${price} ${order.currency || "PLN"}/kg`;
                }
            }
        }
        totalSO += amountSO;
        lines.push({ label, amountSO, amountPLN: round2(amountSO * safe(order.fxRate || 1)), note });
    });
    return { lines, totalSO: round2(totalSO), warnings };
}
// ─── COGS ───────────────────────────────────────────────────────────────────
function computeCOGS(order, lots, pos, mode) {
    const lines = [];
    const cogsClaimedLots = new Set(); // v6.32.0 (A1): one lot serves one line
    let totalPLN = 0;
    const warnings = [];
    let hasMissingData = false;
    (order.items || []).forEach((it) => {
        var _a;
        const qty = safe(it.qty);
        const product = it.product || "—";
        if (it.sourceType === "STOCK" && it.sourceRef) {
            // STOCK-sourced line — find the lot and compute COGS
            const lot = (lots || []).find((l) => l.number === it.sourceRef);
            if (!lot) {
                warnings.push(`Line "${product}": referenced lot ${it.sourceRef} not found — COGS unknown.`);
                hasMissingData = true;
                return;
            }
            const costPerKg = lotCostPerKg(lot);
            let attributableKg = qty;
            if (mode === "actual") {
                // For ACTUAL view, only attribute the kg actually shipped from this lot for this SO
                const shipped = lotNetShippedForSO(lot, order.number);
                attributableKg = shipped;
                if (shipped === 0 && qty > 0 && ["Shipped", "Delivered", "Invoiced", "Closed"].includes(order.status)) {
                    // SO claims to be shipped but no SHIP_OUT recorded against this lot — data gap
                    warnings.push(`Line "${product}": SO is ${order.status} but no SHIP_OUT movement recorded against ${lot.number}. COGS may be understated.`);
                    hasMissingData = true;
                }
            }
            const linePLN = round2(attributableKg * costPerKg);
            totalPLN += linePLN;
            lines.push({
                label: `${product} · ${attributableKg.toLocaleString("pl-PL")} kg from ${lot.number} @ ${round2(costPerKg)} PLN/kg`,
                amountPLN: linePLN,
                note: ((_a = lot.costs) === null || _a === void 0 ? void 0 : _a.length) ? `${lot.costs.length} cost component(s) on lot` : "Lot has no cost data yet",
            });
            if (!lot.costs || lot.costs.length === 0) {
                warnings.push(`Line "${product}": lot ${lot.number} has no cost data — COGS shown as 0.`);
                hasMissingData = true;
            }
        }
        else if (it.sourceType === "PO" && it.sourceRef) {
            // PO-sourced line — use the PO's purchase price as proxy
            const found = findPOLine(pos, it.sourceRef, it.sourceLineId);
            if (!found) {
                warnings.push(`Line "${product}": referenced PO ${it.sourceRef} not found — COGS unknown.`);
                hasMissingData = true;
                return;
            }
            const { po, line } = found;
            const poPrice = safe(line.unitPrice);
            const poFx = safe(po.fxRate || 1) || 1;
            const purchaseCostPLN = round2(qty * poPrice * poFx);
            if (mode === "actual") {
                // Has the PO arrived? If a lot has been auto-created for this PO line, count its actual costs;
                // otherwise the goods haven't physically moved yet, so COGS = 0 for ACTUAL view
                // v6.32.0 (A1): canonical matcher — poLineId-first, variety-aware. The old
                // name-only find resolved every line of a multi-line same-product PO to
                // the FIRST lot (wrong cost basis on real multi-line POs).
                const matchingLot = (0, salesOrders_domain_1.findLotForSOLine)(lots, it, { claimed: cogsClaimedLots });
                if (matchingLot)
                    cogsClaimedLots.add(String(matchingLot.number));
                if (matchingLot) {
                    // Use the lot's cost basis × kg shipped
                    const costPerKg = lotCostPerKg(matchingLot);
                    const shipped = lotNetShippedForSO(matchingLot, order.number);
                    const linePLN = round2(shipped * costPerKg);
                    totalPLN += linePLN;
                    lines.push({
                        label: `${product} · ${shipped.toLocaleString("pl-PL")} kg from ${matchingLot.number} (PO ${po.number}) @ ${round2(costPerKg)} PLN/kg`,
                        amountPLN: linePLN,
                    });
                }
                else {
                    // PO not yet arrived → no actual COGS yet
                    lines.push({
                        label: `${product} · ${qty.toLocaleString("pl-PL")} kg from PO ${po.number} (not yet arrived)`,
                        amountPLN: 0,
                        note: "PO not yet arrived — actual COGS not yet known",
                    });
                    if (["Shipped", "Delivered", "Invoiced", "Closed"].includes(order.status)) {
                        warnings.push(`Line "${product}": SO is ${order.status} but PO ${po.number} has no matching arrived lot. Cannot compute actual COGS.`);
                        hasMissingData = true;
                    }
                }
            }
            else {
                // FORECAST: PO commitment price + an estimate of inland costs?
                // For now: just the purchase price. Logistics costs come from the shipment side.
                totalPLN += purchaseCostPLN;
                lines.push({
                    label: `${product} · ${qty.toLocaleString("pl-PL")} kg from PO ${po.number} @ ${poPrice} ${po.currency || "PLN"}/kg`,
                    amountPLN: purchaseCostPLN,
                    note: "Forecast — purchase price only, logistics counted separately",
                });
            }
        }
        else {
            warnings.push(`Line "${product}": no source assigned — COGS cannot be computed.`);
            hasMissingData = true;
        }
    });
    return { lines, totalPLN: round2(totalPLN), warnings, hasMissingData };
}
// ─── DIRECT COSTS (logistics) ──────────────────────────────────────────────
// v6.31.0 (P1-2 interim / BP-28B groundwork) — this function had four defects,
// confirmed on real data:
//   (a) under-capture: only header soRefs were read, so a shipment whose SO link
//       lives on goods rows (groupage / SO backfilled in cargo) contributed 0;
//   (b) vertical double-count: a cost line already allocated to lots (Batch 1b
//       replace-by-source, tag "SHP-x/costId") ALSO counted as a direct cost —
//       the same zloty in COGS and in direct;
//   (c) horizontal double-count: the FULL shipment cost was charged to EVERY
//       linked SO (a 2-SO groupage counted its freight twice in aggregates);
//   (d) cancelled shipments still contributed costs (a re-booked truck burdened
//       the SO with both the cancelled and the replacement freight).
// Now: linked SOs = header soRefs ∪ goods[].soRef; each SO takes its kg share of
// the goods rows (equal split across linked SOs when no goods kg is assigned);
// cost lines whose allocation tag exists on any lot are skipped (they are in
// COGS); Cancelled shipments are excluded (T-14: kept for the record, out of P/L).
// The explicit cost-ownership flag (BP-26/41) will formalise (b) by declaration;
// this makes the numbers correct from the data that already exists.
function shipmentSOShare(sh, soNumber) {
    const goods = (sh.goods || []).filter((g) => g);
    const linkedSOs = new Set([
        ...((sh.soRefs || []).filter(Boolean).map(String)),
        ...goods.map((g) => g.soRef).filter(Boolean).map(String),
    ]);
    if (!linkedSOs.has(String(soNumber)))
        return 0;
    if (linkedSOs.size === 1)
        return 1;
    const assigned = goods.filter((g) => g.soRef);
    const totalKg = assigned.reduce((s, g) => s + safe(g.qtyKg), 0);
    if (totalKg > 0) {
        const soKg = assigned.filter((g) => String(g.soRef) === String(soNumber))
            .reduce((s, g) => s + safe(g.qtyKg), 0);
        return soKg / totalKg;
    }
    return 1 / linkedSOs.size; // no kg assigned to SOs → equal split
}
function costLineAllocatedToLots(sh, cost, lots) {
    const tag = `${sh.number}/${cost.id}`;
    return (lots || []).some((l) => (l.costs || []).some((c) => String(c.source || "") === tag));
}
function computeDirectCosts(order, shipments, mode, lots = []) {
    const lines = [];
    const warnings = [];
    let totalPLN = 0;
    // Shipments that link to this SO — header refs OR goods-row refs (defect a),
    // excluding Cancelled (defect d).
    const linked = (shipments || []).filter((s) => s && s.status !== "Cancelled" && shipmentSOShare(s, order.number) > 0);
    if (linked.length === 0) {
        return { lines, totalPLN: 0, warnings };
    }
    linked.forEach((sh) => {
        const share = shipmentSOShare(sh, order.number);
        const costs = sh.costs || [];
        costs.forEach((c) => {
            const amountPLN = safe(c.amountPLN) || (safe(c.amount) * safe(c.fxRate || 1));
            // Filter by invoice status depending on mode
            if (mode === "actual") {
                // Only count costs that are actually invoiced/allocated
                const invStatus = c.invoiceStatus || "Expected";
                if (invStatus === "Expected") {
                    // Skip — not yet a real cost
                    return;
                }
            }
            // Defect (b): this cost line already lives on lot landed cost → it reaches
            // the SO through COGS; counting it here too would double it.
            if (costLineAllocatedToLots(sh, c, lots))
                return;
            const shareAmount = round2(amountPLN * share);
            if (shareAmount === 0)
                return;
            totalPLN += shareAmount;
            lines.push({
                label: `${sh.number} · ${c.type || "cost"} (${c.invoiceStatus || "Expected"})${share < 1 ? ` · ${Math.round(share * 100)}% share` : ""}`,
                amountPLN: shareAmount,
                note: c.notes || undefined,
            });
        });
    });
    return { lines, totalPLN: round2(totalPLN), warnings };
}
// ─── MAIN ENTRY POINT ───────────────────────────────────────────────────────
function computeSOMargin(order, lots, pos, shipments, mode) {
    const currency = order.currency || "PLN";
    const fxRate = safe(order.fxRate || 1) || 1;
    const rev = computeRevenue(order, mode, lots, shipments);
    const cogs = computeCOGS(order, lots, pos, mode);
    const direct = computeDirectCosts(order, shipments, mode, lots);
    const revenuePLN = round2(rev.totalSO * fxRate);
    const totalCostsPLN = round2(cogs.totalPLN + direct.totalPLN);
    const marginPLN = round2(revenuePLN - totalCostsPLN);
    const marginSO = round2(marginPLN / fxRate);
    const marginPct = revenuePLN > 0 ? round2((marginPLN / revenuePLN) * 100) : 0;
    return {
        mode,
        currency,
        fxRate,
        revenueSO: rev.totalSO,
        revenuePLN,
        revenueLines: rev.lines,
        cogsPLN: cogs.totalPLN,
        cogsLines: cogs.lines,
        directCostsPLN: direct.totalPLN,
        directLines: direct.lines,
        totalCostsPLN,
        marginPLN,
        marginSO,
        marginPct,
        warnings: [...rev.warnings, ...cogs.warnings, ...direct.warnings],
        hasMissingData: cogs.hasMissingData,
    };
}
exports.computeSOMargin = computeSOMargin;
// v6.32.0 (R7b-5): unused aggregateMargins/groupAndAggregateMargins removed —
// Finance aggregates per-SO via computeSOMargin directly.
