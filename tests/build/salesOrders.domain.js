"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shippedKgByLine = exports.findLotForSOLine = exports.computeLineAvailability = exports.poLineReservations = exports.lotReservationsForStock = exports.lotReservationsForPicker = exports.isPOUsableForConfirmedSO = exports.soClientName = exports.productVarietyKey = exports.linesMatch = exports.productsMatch = exports.normalizeProduct = void 0;
// ─────────────────────────────────────────────────────────────────────────────
// salesOrders.domain.ts — pure availability & reservation engine (Batch 1)
//
// The single home for reservation/availability math, extracted from
// SalesOrders.tsx and Inventory.tsx (which had diverged copies — finding G2).
// Pure: no React, no module state; lots/POs/orders are parameters.
//
// Semantics (pinned by tests, resolving finding B0-2):
//   Only PRE-DISPATCH orders reserve stock: Confirmed / Reserved / Loading.
//   Shipped+ orders already had their kg physically subtracted via SHIP_OUT
//   movements, so counting them again would double-subtract. Draft/Cancelled
//   never reserve. Inventory's unused 7-status set was dead code — removed.
// ─────────────────────────────────────────────────────────────────────────────
const types_1 = require("./types");
function normalizeProduct(p) {
    return (p || "").toLowerCase().trim();
}
exports.normalizeProduct = normalizeProduct;
// FB-12: two lines match only if the product AND (when both specify a variety)
// the variety agree. If either side has no variety, fall back to product-only
// (backward-compatible with legacy data that lacks variety).
function productsMatch(a, b, varA, varB) {
    if (normalizeProduct(a) !== normalizeProduct(b))
        return false;
    const va = normalizeProduct(varA), vb = normalizeProduct(varB);
    if (va && vb)
        return va === vb;
    return true;
}
exports.productsMatch = productsMatch;
/** Variety-aware match between two line-like objects ({product, variety}). */
function linesMatch(x, y) {
    return productsMatch(x === null || x === void 0 ? void 0 : x.product, y === null || y === void 0 ? void 0 : y.product, x === null || x === void 0 ? void 0 : x.variety, y === null || y === void 0 ? void 0 : y.variety);
}
exports.linesMatch = linesMatch;
function productVarietyKey(x) {
    const p = normalizeProduct(x === null || x === void 0 ? void 0 : x.product);
    const v = normalizeProduct(x === null || x === void 0 ? void 0 : x.variety);
    return v ? `${p}|${v}` : p;
}
exports.productVarietyKey = productVarietyKey;
function soClientName(o) {
    if (o === null || o === void 0 ? void 0 : o.clientName)
        return o.clientName;
    if ((o === null || o === void 0 ? void 0 : o.client) && o.client.name)
        return o.client.name;
    return "—";
}
exports.soClientName = soClientName;
function isPOUsableForConfirmedSO(po) {
    if (!po)
        return false;
    return po.status !== "Draft" && po.status !== "Cancelled";
}
exports.isPOUsableForConfirmedSO = isPOUsableForConfirmedSO;
/** SO source-picker semantics: STOCK-sourced draws on this lot from other
 *  pre-dispatch orders. (PO-backed demand is handled separately by the PO-line
 *  reservation functions — the picker shows PO rows on their own.) */
function lotReservationsForPicker(lot, allOrders, excludeOrderId) {
    var _a;
    const reservations = [];
    let totalReserved = 0;
    (allOrders || []).forEach(o => {
        if (o.id === excludeOrderId)
            return;
        if (!types_1.SO_PRE_DISPATCH_STATUSES.has(o.status))
            return;
        (o.items || []).forEach((it) => {
            if (it.sourceType !== "STOCK")
                return;
            if (it.sourceRef !== lot.number)
                return;
            if (!productsMatch(it.product, lot.product, it.variety, lot.variety))
                return;
            const q = parseFloat(it.qty) || 0;
            if (q <= 0)
                return;
            reservations.push({ soNumber: o.number, soId: o.id, status: o.status, qty: q });
            totalReserved += q;
        });
    });
    return {
        liveAvailable: Math.max(0, ((_a = lot.availableKg) !== null && _a !== void 0 ? _a : 0) - totalReserved),
        totalReserved,
        reservations,
    };
}
exports.lotReservationsForPicker = lotReservationsForPicker;
/** Inventory stock-view semantics: also counts PO-backed draws against the lot
 *  produced by that PO, and supports the direct-flow availability basis. */
function lotReservationsForStock(lot, sourceSOs) {
    var _a, _b;
    const reservations = [];
    let totalReserved = 0;
    (sourceSOs || []).forEach(o => {
        if (!types_1.SO_PRE_DISPATCH_STATUSES.has(o.status))
            return;
        (o.items || []).forEach((it) => {
            const matchesStock = it.sourceType === "STOCK" && it.sourceRef === lot.number;
            const matchesPOBackedLot = it.sourceType === "PO" && lot.poRef === it.sourceRef && productsMatch(it.product, lot.product, it.variety, lot.variety);
            if (!matchesStock && !matchesPOBackedLot)
                return;
            if (!productsMatch(it.product, lot.product, it.variety, lot.variety))
                return;
            const q = parseFloat(it.qty) || 0;
            if (q <= 0)
                return;
            reservations.push({ soNumber: o.number, soId: o.id, status: o.status, clientName: soClientName(o), qty: q, sourceType: it.sourceType });
            totalReserved += q;
        });
    });
    const directBasis = lot.directFlow ? (parseFloat(lot.expectedKg) || 0) : 0;
    const physical = (_b = (_a = lot.physicalKg) !== null && _a !== void 0 ? _a : lot.receivedKg) !== null && _b !== void 0 ? _b : 0;
    const availabilityBasis = lot.directFlow ? Math.max(directBasis, physical) : physical;
    return {
        physicalKg: physical,
        availabilityBasis,
        liveAvailable: Math.max(0, availabilityBasis - totalReserved),
        totalReserved,
        reservations,
    };
}
exports.lotReservationsForStock = lotReservationsForStock;
/** Reservations on one PO line from other pre-dispatch SOs. */
function poLineReservations(po, poLine, allOrders, excludeOrderId) {
    var _a;
    const reservations = [];
    let totalReserved = 0;
    (allOrders || []).forEach(o => {
        if (o.id === excludeOrderId)
            return;
        if (!types_1.SO_PRE_DISPATCH_STATUSES.has(o.status))
            return;
        (o.items || []).forEach((it) => {
            var _a;
            if (it.sourceType !== "PO")
                return;
            if (it.sourceRef !== po.number)
                return;
            if (((_a = it.sourceLineId) !== null && _a !== void 0 ? _a : 1) !== poLine.id)
                return;
            if (!productsMatch(it.product, poLine.product, it.variety, poLine.variety))
                return;
            const q = parseFloat(it.qty) || 0;
            if (q <= 0)
                return;
            reservations.push({ soNumber: o.number, soId: o.id, status: o.status, qty: q });
            totalReserved += q;
        });
    });
    return {
        liveAvailable: Math.max(0, ((_a = poLine.available) !== null && _a !== void 0 ? _a : 0) - totalReserved),
        totalReserved,
        reservations,
    };
}
exports.poLineReservations = poLineReservations;
/**
 * Per-line availability for an SO being edited. Extracted 1:1 from
 * SalesOrders.tsx (incl. the v6.18.24 received-PO exclusion and the
 * wrong-product guards). lots/pos are the picker-adapted shapes
 * (lot.availableKg, poLine.available).
 */
function computeLineAvailability(soItems, allOrders, currentOrderId, lots, pos) {
    const LOTS = lots || [];
    const PO_REFS = pos || [];
    const committedFromStock = {};
    const committedFromPO = {};
    (allOrders || []).forEach(o => {
        if (o.id === currentOrderId)
            return;
        if (!types_1.SO_PRE_DISPATCH_STATUSES.has(o.status))
            return;
        (o.items || []).forEach((it) => {
            var _a;
            if (!it.sourceType || !it.sourceRef)
                return;
            const q = parseFloat(it.qty) || 0;
            if (q <= 0)
                return;
            if (it.sourceType === "STOCK") {
                const lot = LOTS.find(l => l.number === it.sourceRef);
                if (!lot)
                    return;
                if (!productsMatch(it.product, lot.product, it.variety, lot.variety))
                    return;
                committedFromStock[it.sourceRef] = (committedFromStock[it.sourceRef] || 0) + q;
            }
            else if (it.sourceType === "PO") {
                const po = PO_REFS.find(p => p.number === it.sourceRef);
                if (!po || !isPOUsableForConfirmedSO(po))
                    return;
                const poLine = po.items.find((l) => { var _a; return l.id === ((_a = it.sourceLineId) !== null && _a !== void 0 ? _a : 1); });
                if (!poLine)
                    return;
                if (!productsMatch(it.product, poLine.product, it.variety, poLine.variety))
                    return;
                const k = `${it.sourceRef}::${(_a = it.sourceLineId) !== null && _a !== void 0 ? _a : 1}`;
                committedFromPO[k] = (committedFromPO[k] || 0) + q;
            }
        });
    });
    function lotRemaining(lotNumber) {
        const lot = LOTS.find(l => l.number === lotNumber);
        if (!lot)
            return 0;
        return Math.max(0, lot.availableKg - (committedFromStock[lot.number] || 0));
    }
    function poLineRemaining(poNumber, lineId) {
        const po = PO_REFS.find(p => p.number === poNumber);
        if (!po || !isPOUsableForConfirmedSO(po))
            return 0;
        const line = po.items.find((l) => l.id === (lineId !== null && lineId !== void 0 ? lineId : 1));
        if (!line)
            return 0;
        const k = `${po.number}::${line.id}`;
        return Math.max(0, line.available - (committedFromPO[k] || 0));
    }
    // Decision 1 (Batch 3a, precise partial receipt): kg already received into lots
    // is subtracted from that PO line's incoming supply — the received part counts
    // via the lot, the genuine remainder still counts as incoming. A fully received
    // PO therefore contributes 0 (same as the old v6.18.24 exclusion); a PO arriving
    // across multiple trucks contributes exactly what is still on the way.
    const receivedKgByPOProduct = {};
    LOTS.forEach((l) => {
        var _a;
        if (!l.poRef)
            return;
        const k = `${l.poRef}::${productVarietyKey(l)}`; // FB-12: keyed by product+variety
        receivedKgByPOProduct[k] = (receivedKgByPOProduct[k] || 0) + Math.max(0, ((_a = l.receivedKg) !== null && _a !== void 0 ? _a : 0));
    });
    return (soItems || []).map((it) => {
        const lineQty = parseFloat(it.qty) || 0;
        const product = normalizeProduct(it.product);
        const lineKey = productVarietyKey(it); // FB-12
        let primaryAvailable = 0;
        let primaryProductMismatch = false;
        if (it.sourceType === "STOCK" && it.sourceRef) {
            const lot = LOTS.find(l => l.number === it.sourceRef);
            if (lot) {
                if (productsMatch(it.product, lot.product))
                    primaryAvailable = lotRemaining(it.sourceRef);
                else
                    primaryProductMismatch = true;
            }
        }
        else if (it.sourceType === "PO" && it.sourceRef) {
            const po = PO_REFS.find(p => p.number === it.sourceRef);
            if (po && isPOUsableForConfirmedSO(po)) {
                const poLine = po.items.find((l) => { var _a; return l.id === ((_a = it.sourceLineId) !== null && _a !== void 0 ? _a : 1); });
                if (poLine) {
                    if (productsMatch(it.product, poLine.product))
                        primaryAvailable = poLineRemaining(it.sourceRef, it.sourceLineId);
                    else
                        primaryProductMismatch = true;
                }
            }
        }
        let otherStockKg = 0, otherPOKg = 0;
        LOTS.forEach(lot => {
            if (productVarietyKey(lot) !== lineKey)
                return; // FB-12: product+variety
            if (it.sourceType === "STOCK" && it.sourceRef === lot.number)
                return;
            otherStockKg += lotRemaining(lot.number);
        });
        PO_REFS.forEach(po => {
            (po.items || []).forEach((line) => {
                var _a;
                if (productVarietyKey(line) !== lineKey)
                    return; // FB-12: product+variety
                if (it.sourceType === "PO" && it.sourceRef === po.number && ((_a = it.sourceLineId) !== null && _a !== void 0 ? _a : 1) === line.id)
                    return;
                const received = receivedKgByPOProduct[`${po.number}::${productVarietyKey(line)}`] || 0;
                otherPOKg += Math.max(0, poLineRemaining(po.number, line.id) - received);
            });
        });
        const otherSourcesAvailable = otherStockKg + otherPOKg;
        const combinedAvailable = primaryAvailable + otherSourcesAvailable;
        const primaryShortfallAmount = Math.max(0, lineQty - primaryAvailable);
        return {
            lineQty,
            primaryAvailable: Math.round(primaryAvailable * 100) / 100,
            otherStockKg: Math.round(otherStockKg * 100) / 100,
            otherPOKg: Math.round(otherPOKg * 100) / 100,
            otherSourcesAvailable: Math.round(otherSourcesAvailable * 100) / 100,
            combinedAvailable: Math.round(combinedAvailable * 100) / 100,
            overage: Math.round(primaryShortfallAmount * 100) / 100,
            hasOverage: primaryShortfallAmount > 0.01,
            primaryShortfall: primaryShortfallAmount > 0.01,
            primaryProductMismatch,
        };
    });
}
exports.computeLineAvailability = computeLineAvailability;
// ─── v6.32.0: canonical SO-line → lot matcher (A1) ──────────────────────────
// Six modules matched an SO line to its lot with six divergent rules — none
// poLineId-aware except the expected-lot builder (FB-1), none variety-aware
// except the availability engine (FB-12). Real-data consequence: a multi-line
// same-product PO (e.g. 5 apple lines on one PO) resolved EVERY line to the
// FIRST lot, so actual COGS used the wrong cost basis. This is the single rule;
// all modules delegate here.
//   Priority: STOCK → lot by number;
//             PO    → poLineId (authoritative, FB-1) → poRef + product+variety
//                     (FB-12 semantics) → poRef + name only (legacy lots that
//                     predate poLineId/variety), first unclaimed.
function findLotForSOLine(lots, it, opts = {}) {
    if (!it)
        return null;
    const claimed = opts.claimed;
    const free = (l) => !claimed || !claimed.has(String(l.number));
    if (it.sourceType === "STOCK" && it.sourceRef) {
        return (lots || []).find(l => String(l.number) === String(it.sourceRef)) || null;
    }
    if (it.sourceType === "PO" && it.sourceRef) {
        const byPO = (lots || []).filter(l => String(l.poRef || "") === String(it.sourceRef));
        if (it.sourceLineId != null) {
            const exact = byPO.find(l => l.poLineId != null && String(l.poLineId) === String(it.sourceLineId));
            if (exact)
                return exact;
        }
        const byProduct = byPO.find(l => free(l) && productsMatch(it.product, l.product, it.variety, l.variety));
        if (byProduct)
            return byProduct;
        return byPO.find(l => free(l) && normalizeProduct(l.product) === normalizeProduct(it.product)) || null;
    }
    return null;
}
exports.findLotForSOLine = findLotForSOLine;
// ─── v6.32.0: per-line shipped kg (P1-1 engine) ─────────────────────────────
// Actual revenue used to be all-or-nothing on SO *status*; partial deliveries
// were mis-stated. This computes, per SO line, the kg actually dispatched, from
// two evidence sources with precise dedup:
//   1. lot SHIP_OUT movements for this SO (net of REVERSAL), via the canonical
//      matcher — authoritative once a shipment has POSTED (movements carry
//      shipmentRef);
//   2. safety net: goods rows of DELIVERED/CLOSED shipments that have not
//      posted movements yet (transient failure case). Loaded shipments are
//      deliberately NOT revenue: COGS recognises at posting (Delivered), and
//      recognising revenue earlier than its cost showed absurd mid-flight
//      margins (full revenue, zero cost). At Delivered the two sides align.
// Kg pools are allocated greedily across the SO's lines in order, capped at
// each line's qty, so two lines sourcing the same lot never double-claim.
function shippedKgByLine(order, lots, shipments) {
    const so = String((order === null || order === void 0 ? void 0 : order.number) || "");
    const items = (order === null || order === void 0 ? void 0 : order.items) || [];
    const nrm = (s) => { const v = String(s || ""); if (v === "Arrived" || v === "In Transit" || v === "In transit")
        return "Loaded"; if (v === "Confirmed")
        return "Booked"; return v; };
    const DISPATCHED = new Set(["Delivered", "Closed"]);
    // 1. movement pool per lot (net shipped kg for this SO)
    const movePool = new Map();
    (lots || []).forEach((l) => {
        let kg = 0;
        (l.movements || []).forEach((m) => {
            if (m === null || m === void 0 ? void 0 : m.voided)
                return;
            const matches = m.soRef ? String(m.soRef) === so : String(m.note || "").includes(so);
            if (!matches)
                return;
            if (m.type === "SHIP_OUT")
                kg += Number(m.qtyKg) || 0;
            if (m.type === "REVERSAL")
                kg -= Number(m.qtyKg) || 0;
        });
        if (kg > 0)
            movePool.set(String(l.number), kg);
    });
    const goodsPool = [];
    (shipments || []).forEach((s) => {
        if (!s || s.status === "Cancelled" || !DISPATCHED.has(nrm(s.status)))
            return;
        const posted = (lots || []).some((l) => (l.movements || []).some((m) => !m.voided && (m.shipmentRef ? String(m.shipmentRef) === String(s.number) : String(m.note || "").includes(String(s.number)))));
        if (posted)
            return; // its kg already live in the movement pool
        const headerSOs = (s.soRefs || []).filter(Boolean).map(String);
        (s.goods || []).forEach((g) => {
            if (!g)
                return;
            const rowSO = g.soRef ? String(g.soRef) : null;
            const belongs = rowSO ? rowSO === so : (headerSOs.length === 1 && headerSOs[0] === so);
            if (!belongs)
                return;
            const kg = Number(g.qtyKg) || 0;
            if (kg > 0)
                goodsPool.push({ kg, product: g.product, variety: g.variety, poRef: g.poRef, lotRef: g.lotRef });
        });
    });
    const hasEvidence = movePool.size > 0 || goodsPool.length > 0;
    const claimed = new Set();
    const perLine = items.map((it) => {
        let need = Number(it.qty) || 0;
        let got = 0;
        // (1) movements of the line's lot
        const lot = findLotForSOLine(lots, it, { claimed });
        if (lot) {
            claimed.add(String(lot.number));
            const avail = movePool.get(String(lot.number)) || 0;
            const take = Math.min(need, avail);
            if (take > 0) {
                got += take;
                need -= take;
                movePool.set(String(lot.number), avail - take);
            }
        }
        // (2) goods rows: lotRef → poRef+product/variety → product/variety
        if (need > 0) {
            const passes = [
                g => !!lot && String(g.lotRef || "") === String(lot.number),
                g => it.sourceType === "PO" && !!g.poRef && String(g.poRef) === String(it.sourceRef) && productsMatch(it.product, g.product, it.variety, g.variety),
                g => productsMatch(it.product, g.product, it.variety, g.variety),
            ];
            for (const pass of passes) {
                if (need <= 0)
                    break;
                for (const g of goodsPool) {
                    if (need <= 0)
                        break;
                    if (g.kg <= 0 || !pass(g))
                        continue;
                    const take = Math.min(need, g.kg);
                    got += take;
                    need -= take;
                    g.kg -= take;
                }
            }
        }
        return got;
    });
    return { perLine, totalKg: perLine.reduce((a, b) => a + b, 0), hasEvidence };
}
exports.shippedKgByLine = shippedKgByLine;
