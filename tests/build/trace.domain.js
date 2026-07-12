"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// trace.domain.ts — one-click lot traceability (Safeguards batch 7a)
//
// The recall question every produce ERP must answer in one click:
// "this lot is contaminated — where did it come from, and everywhere it went."
// Pure composition of the links that already exist (Batch 4a computed links):
// lot → PO/supplier → shipments → sales orders/clients → invoices.
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTraceTree = void 0;
function arr(v) { return Array.isArray(v) ? v : []; }
function refs(v) { return arr(v).filter(Boolean).map(String); }
function buildTraceTree(lot, inp, todayISO) {
    var _a, _b, _c;
    const pos = arr(inp.pos), orders = arr(inp.orders), shipments = arr(inp.shipments), invoices = arr(inp.invoices);
    const po = pos.find(p => p.number === lot.poRef) || null;
    // Shipments touching this lot: header lotRefs, goods lotRef, or the lot's PO.
    const ship = shipments.filter(s => refs(s.lotRefs).includes(lot.number) ||
        arr(s.goods).some((g) => g.lotRef === lot.number) ||
        (lot.poRef && (refs(s.poRefs).includes(lot.poRef) || arr(s.goods).some((g) => g.poRef === lot.poRef)))).map(s => {
        var _a, _b, _c;
        return ({
            number: s.number, status: s.status, direction: s.tradeDirection || undefined,
            carrier: s.carrierName || undefined,
            from: s.originText || ((_b = (_a = s.legs) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.fromCustom) || undefined,
            to: s.destinationText || ((_c = (s.legs || []).slice(-1)[0]) === null || _c === void 0 ? void 0 : _c.toCustom) || undefined,
            dates: [s.expectedLoadingDate, s.expectedDeliveryDate].filter(Boolean).join(" → ") || undefined,
        });
    });
    // Sales orders drawing on this lot: STOCK lines on the lot, or PO lines on its PO.
    const sales = [];
    orders.forEach(o => {
        if (o.status === "Cancelled")
            return;
        arr(o.items).forEach((it) => {
            var _a, _b;
            const hits = (it.sourceType === "STOCK" && it.sourceRef === lot.number) ||
                (it.sourceType === "PO" && lot.poRef && it.sourceRef === lot.poRef);
            if (hits)
                sales.push({
                    soNumber: o.number, client: ((_a = o.client) === null || _a === void 0 ? void 0 : _a.name) || "(client)",
                    qtyKg: parseFloat(it.qty) || 0, status: o.status,
                    destination: o.destinationText || ((_b = o.client) === null || _b === void 0 ? void 0 : _b.address) || undefined,
                });
        });
    });
    // Invoices linked to the lot, its PO, or the SOs above.
    const soNums = new Set(sales.map(s => s.soNumber));
    const inv = invoices.filter(v => {
        const links = arr(v.links);
        if (links.some((lk) => (lk.type === "LOT" && lk.number === lot.number) || (lk.type === "PO" && lk.number === lot.poRef)))
            return true;
        if (v.poRef && v.poRef === lot.poRef)
            return true;
        if (v.soRef && soNums.has(v.soRef))
            return true;
        return false;
    }).map(v => { var _a; return ({ number: v.number || "(draft)", kind: v.kind, counterparty: (_a = v.counterparty) === null || _a === void 0 ? void 0 : _a.name, gross: v.grossAmount != null ? `${v.grossAmount} ${v.currency || ""}`.trim() : undefined }); });
    return {
        lot: { number: lot.number, product: lot.product || "", variety: lot.variety || undefined, receivedKg: lot.receivedKg, physicalKg: lot.physicalKg },
        origin: { poNumber: lot.poRef || null, supplier: ((_a = po === null || po === void 0 ? void 0 : po.supplier) === null || _a === void 0 ? void 0 : _a.name) || null, supplierAddress: ((_b = po === null || po === void 0 ? void 0 : po.supplier) === null || _b === void 0 ? void 0 : _b.address) || undefined, origin: ((_c = ((po === null || po === void 0 ? void 0 : po.items) || [])[0]) === null || _c === void 0 ? void 0 : _c.origin) || undefined },
        shipments: ship, sales, invoices: inv,
        generatedAt: todayISO,
    };
}
exports.buildTraceTree = buildTraceTree;
