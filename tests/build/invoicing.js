"use strict";
// ─── INVOICING CORE ─────────────────────────────────────────────────────────
//
// The single source of truth for every invoice in and out, plus the migration
// that folds the four legacy representations into it, and the Fakturownia push
// payload builder. Pure functions only — no React, no storage, no side effects.
//
// Decisions locked in the spec:
//  • One model for SALES (receivable) and COST (payable) invoices.
//  • Operations/Admin see everything here; the precise P/L stays in Finance.
//  • Edit lock at "Sent" (Draft & Issued editable; Sent/pushed = locked).
//  • Net in PLN at each invoice's own locked fxRate.
//  • Fakturownia auto-numbers (we send number:null); KSeF stays Fakturownia-managed
//    for now (gov_save_and_send default OFF, single toggle to enable later).
Object.defineProperty(exports, "__esModule", { value: true });
exports.noteSignedPLN = exports.buildFakturowniaPayload = exports.migrateLegacyInvoices = exports.migrateLegacyCreditNotes = exports.stripPendingInvoices = exports.salesInvoiceFromSODraft = exports.salesInvoiceSourceTag = exports.recomputeInvoiceMoney = exports.isLocked = exports.invoiceDirection = void 0;
const ids_1 = require("./ids");
const fx_1 = require("./fx");
// ── helpers ──
function n(v) { const x = parseFloat(String(v !== null && v !== void 0 ? v : "").replace(/\s/g, "").replace(",", ".")); return isFinite(x) ? x : 0; }
function r2(x) { return Math.round(x * 100) / 100; }
function arr(v) { return Array.isArray(v) ? v : []; }
// v6.32.0 (R7b-5): unused PAYABLE_CATEGORIES removed.
function invoiceDirection(inv) {
    return inv.kind === "SALES" ? "receivable" : "payable";
}
exports.invoiceDirection = invoiceDirection;
function isLocked(inv) {
    var _a;
    return !!inv.locked || inv.paymentStatus === "Sent" || !!((_a = inv.fakturownia) === null || _a === void 0 ? void 0 : _a.exported);
}
exports.isLocked = isLocked;
// Recompute the money fields consistently from net + vat rate + fx.
function recomputeInvoiceMoney(inv) {
    const net = r2(n(inv.netAmount));
    const vatRate = n(inv.vatRate);
    const fx = (0, fx_1.resolveFxRate)(inv.fxRate, inv.currency);
    const vat = r2(net * vatRate / 100);
    const gross = r2(net + vat);
    return { ...inv, netAmount: net, vatRate, vatAmount: vat, grossAmount: gross, fxRate: fx, netPLN: r2(net * fx), grossPLN: r2(gross * fx) };
}
exports.recomputeInvoiceMoney = recomputeInvoiceMoney;
// ── MIGRATION: fold the four legacy sources into the unified model ──
// Idempotent by `source` tag — a record already migrated (same source) is skipped,
// so running this on every load never duplicates.
// ─── v6.33.0 (A3-6): the Invoices register is the SOLE owner of invoices ────
// The SO "Issue Sales Invoice" modal now writes HERE (via this builder) instead
// of into order.pendingInvoices. The source tag is the same one the legacy fold
// uses, so importing an old backup whose SO still carries the pendingInvoice
// can never duplicate an invoice already created through the API.
function salesInvoiceSourceTag(soNumber, invNumber) {
    return `SO:${soNumber}:${invNumber || ""}`;
}
exports.salesInvoiceSourceTag = salesInvoiceSourceTag;
function salesInvoiceFromSODraft(order, pi) {
    const fx = (0, fx_1.resolveFxRate)(pi.fxRate, pi.currency || order.currency);
    const net = r2(n(pi.netAmount));
    const vatRate = n(pi.vatRate);
    const vat = r2(n(pi.vatAmount) || net * vatRate / 100);
    const gross = r2(n(pi.grossAmount) || net + vat);
    return {
        id: (0, ids_1.nextId)(), kind: "SALES", category: "SINV",
        number: pi.number || "", counterparty: pi.counterparty || order.client || null,
        issueDate: pi.issueDate || "", saleDate: pi.saleDate || "", dueDate: pi.dueDate || "",
        paymentMethod: pi.paymentMethod || "Transfer",
        currency: pi.currency || order.currency || "PLN", fxRate: fx,
        netAmount: net, vatRate, vatAmount: vat, grossAmount: gross,
        netPLN: r2(net * fx), grossPLN: r2(gross * fx),
        positions: arr(order.items).map((it) => ({ name: it.product || "", quantity: n(it.qty), unit: it.unit || "kg", vatRate, grossTotal: undefined })),
        links: [{ type: "SO", number: order.number }],
        paymentStatus: pi.paymentStatus || "Draft",
        paidAmount: n(pi.paidAmount),
        notes: pi.notes || "", attachment: pi.attachment || null,
        creditNoteIds: [], allocation: null,
        fakturownia: { exported: !!pi.fktMatched, ref: pi.fktId, legalNumber: pi.fktMatched ? pi.number : undefined },
        source: salesInvoiceSourceTag(order.number, pi.number || pi.id),
        createdAt: pi.createdAt || pi.issueDate || "", locked: pi.paymentStatus === "Sent" || !!pi.fktMatched,
    };
}
exports.salesInvoiceFromSODraft = salesInvoiceFromSODraft;
// v6.33.0 (A3-6): once the register owns an SO's invoices, the legacy
// order.pendingInvoices arrays are stripped. Pure; returns the SAME array
// reference when there is nothing to strip so React effects don't loop.
function stripPendingInvoices(orders) {
    let changed = false;
    const out = arr(orders).map((o) => {
        if (!o || !o.pendingInvoices || !o.pendingInvoices.length)
            return o;
        changed = true;
        const { pendingInvoices, ...rest } = o;
        return rest;
    });
    return { orders: changed ? out : orders, changed };
}
exports.stripPendingInvoices = stripPendingInvoices;
// ─── v6.33.0 (A3-5 residue): legacy Finance creditNotes → FinanceNote ────────
// The old Finance "Credit Notes" tab kept its own array that never entered the
// receivable/payable totals. Fold each record into the canonical notes model
// (all legacy records are CREDIT notes — the tab had no debit concept),
// idempotent by source tag; after this they DO adjust the ledger totals (BP-37).
function migrateLegacyCreditNotes(opts) {
    const existing = arr(opts.existing);
    const have = new Set(existing.map(nte => nte.source).filter(Boolean));
    const out = [...existing];
    arr(opts.creditNotes).forEach((cn) => {
        const src = `legacyCN:${cn.id}`;
        if (have.has(src))
            return;
        const fx = (0, fx_1.resolveFxRate)(cn.fxRate, cn.currency);
        const amount = n(cn.amount);
        out.push({
            id: (0, ids_1.nextId)(), noteType: "CREDIT",
            direction: cn.direction === "incoming" ? "incoming" : "outgoing",
            invoiceId: null, relatedRef: cn.relatedRef || "",
            partyName: cn.partyName || "", category: cn.category || "Other",
            amount, currency: cn.currency || "PLN", fxRate: fx,
            amountPLN: r2(n(cn.amountPLN) || amount * fx),
            status: cn.status || "Draft", reason: cn.reason || "", date: cn.date || "",
            source: src,
        });
        have.add(src);
    });
    return out;
}
exports.migrateLegacyCreditNotes = migrateLegacyCreditNotes;
function migrateLegacyInvoices(opts) {
    const existing = arr(opts.existing);
    const haveSource = new Set(existing.map(i => i.source).filter(Boolean));
    const out = [...existing];
    const pushIf = (source, build) => {
        if (haveSource.has(source))
            return;
        out.push(build());
        haveSource.add(source);
    };
    // 1. SALES invoices from SO pendingInvoices — same builder as the live A3-6
    // path (salesInvoiceFromSODraft), so folded and API-created invoices are one
    // shape and one source-tag namespace.
    arr(opts.orders).forEach((o) => {
        arr(o.pendingInvoices).forEach((pi) => {
            const src = salesInvoiceSourceTag(o.number, pi.number || pi.id);
            pushIf(src, () => salesInvoiceFromSODraft(o, pi));
        });
    });
    // 2. COST / WAREHOUSE from warehouseInvoices (monthly shared)
    arr(opts.warehouseInvoices).forEach((w) => {
        const src = `migrated:warehouseInvoice:${w.id}`;
        pushIf(src, () => {
            const fx = (0, fx_1.resolveFxRate)(w.fxRate, w.currency);
            const net = r2(n(w.amount) || n(w.amountPLN) / (fx || 1));
            const gross = r2(n(w.amountPLN) || net * fx);
            return {
                id: (0, ids_1.nextId)(), kind: "COST", category: "WAREHOUSE", costScope: "MONTHLY_SHARED",
                number: w.invoiceNo || "", counterparty: { name: w.warehouseName || "Warehouse" },
                issueDate: w.date || "", saleDate: w.date || "", dueDate: w.dueDate || "",
                paymentMethod: "Transfer", currency: w.currency || "PLN", fxRate: fx,
                netAmount: net, vatRate: 0, vatAmount: 0, grossAmount: r2(net),
                netPLN: r2(n(w.amountPLN) || net * fx), grossPLN: r2(n(w.amountPLN) || net * fx),
                periodFrom: w.period ? `${w.period}-01` : undefined, periodTo: undefined,
                positions: [], links: [],
                paymentStatus: (w.status === "Approved" ? "Issued" : w.status) || "Issued",
                paidAmount: 0, notes: w.notes || "", attachment: null,
                creditNoteIds: [], allocation: w.allocatedLots ? { method: w.allocationMethod || "by_kg_days", lots: w.allocatedLots } : null,
                fakturownia: { exported: false },
                source: src, createdAt: w.date || "",
            };
        });
    });
    // 3. COST from operationalCosts that carry an invoice number
    arr(opts.operationalCosts).forEach((c) => {
        if (!String(c.invoiceNo || "").trim())
            return; // payroll/taxes without an invoice stay out
        const src = `migrated:opCost:${c.id}`;
        pushIf(src, () => {
            const fx = (0, fx_1.resolveFxRate)(c.fxRate, c.currency);
            const net = r2(n(c.amount));
            const gross = r2(n(c.amountPLN) || net * fx);
            const cat = /forward/i.test(c.category || "") ? "FORWARDER" :
                /custom|broker|cło|clo/i.test(c.category || c.description || "") ? "BROKER" :
                    /transport|freight|carrier/i.test(c.category || "") ? "TRANSPORT" :
                        /warehouse|storage|magazyn/i.test(c.category || "") ? "WAREHOUSE" :
                            /purchase|goods|towar/i.test(c.category || "") ? "PURCHASE" : "OTHER";
            const scope = cat === "WAREHOUSE" || cat === "BROKER" ? "MONTHLY_SHARED" : (c.costCenter === "general" || cat === "OTHER" ? "OVERHEAD" : "SHIPMENT");
            return {
                id: (0, ids_1.nextId)(), kind: "COST", category: cat, costScope: scope,
                number: c.invoiceNo, counterparty: { name: c.supplierName || c.seller || "—" },
                issueDate: c.date || "", saleDate: c.date || "", dueDate: c.dueDate || "",
                paymentMethod: "Transfer", currency: c.currency || "PLN", fxRate: fx,
                netAmount: net, vatRate: 0, vatAmount: 0, grossAmount: r2(net),
                netPLN: r2(net * fx), grossPLN: gross,
                periodFrom: c.period ? `${c.period}-01` : undefined,
                positions: [], links: [],
                paymentStatus: c.status || "Issued", paidAmount: 0,
                notes: c.notes || c.description || "", attachment: null,
                creditNoteIds: [], allocation: null, fakturownia: { exported: false },
                source: src, createdAt: c.date || "",
            };
        });
    });
    // 4. COST (PURCHASE) from firm-price POs once the goods have ARRIVED. The supplier's
    //    commercial invoice becomes payable on receipt; consignment POs are excluded
    //    (they settle as producer payouts, not purchase invoices). #5 / v6.18.9.
    arr(opts.pos).forEach((po) => {
        if ((po.pricingMode || "firm") === "consignment")
            return;
        if (!["Arrived", "Received", "Closed"].includes(po.status))
            return; // only after goods received
        const total = arr(po.items).reduce((s, it) => s + n(it.qty) * n(it.unitPrice), 0);
        if (total <= 0)
            return;
        const src = `migrated:po:${po.id}`;
        pushIf(src, () => {
            var _a;
            const fx = (0, fx_1.resolveFxRate)(po.fxRate, po.currency);
            const grossPLN = r2(total * fx);
            return {
                id: (0, ids_1.nextId)(), kind: "COST", category: "PURCHASE", costScope: "SHIPMENT",
                number: po.supplierInvoiceNo || "", counterparty: po.supplier || { name: ((_a = po.supplier) === null || _a === void 0 ? void 0 : _a.name) || "Supplier" },
                issueDate: po.arrivalDate || po.expectedDeliveryDate || po.orderDate || "", saleDate: po.arrivalDate || po.orderDate || "", dueDate: po.paymentDueDate || "",
                paymentMethod: "Transfer", currency: po.currency || "PLN", fxRate: fx,
                netAmount: r2(total), vatRate: 0, vatAmount: 0, grossAmount: r2(total),
                netPLN: grossPLN, grossPLN,
                positions: [], links: [{ type: "PO", number: po.number }],
                paymentStatus: "Issued", paidAmount: 0,
                notes: po.supplierInvoiceNo ? "" : "Awaiting the supplier's invoice number — add it here when received.",
                attachment: null, creditNoteIds: [], allocation: null, fakturownia: { exported: false },
                source: src, createdAt: po.arrivalDate || po.orderDate || "",
            };
        });
    });
    return out;
}
exports.migrateLegacyInvoices = migrateLegacyInvoices;
// ── FAKTUROWNIA PUSH PAYLOAD (verified contract, spec §10) ──
// Builds the POST /invoices.json body for a SALES invoice. Auto-numbering (number:null).
// gov_save_and_send defaults OFF — KSeF stays Fakturownia-managed for now.
function buildFakturowniaPayload(inv, opts) {
    var _a, _b, _c;
    const positions = arr(inv.positions).map(p => ({
        name: p.name || "—",
        quantity: n(p.quantity) || 1,
        quantity_unit: p.unit || "kg",
        tax: n(p.vatRate),
        total_price_gross: p.grossTotal != null ? r2(n(p.grossTotal)) : undefined,
        total_price_net: p.grossTotal == null && p.netPrice != null ? r2(n(p.netPrice) * (n(p.quantity) || 1)) : undefined,
    }));
    // If no per-line positions exist (migrated invoices), fall back to one summary line.
    const safePositions = positions.length ? positions : [{
            name: ((_a = inv.notes) === null || _a === void 0 ? void 0 : _a.slice(0, 80)) || "Sales invoice", quantity: 1, quantity_unit: "szt.",
            tax: n(inv.vatRate), total_price_gross: r2(n(inv.grossAmount)),
        }];
    const body = {
        api_token: opts.apiToken,
        invoice: {
            kind: "vat",
            number: null,
            issue_date: inv.issueDate || undefined,
            sell_date: inv.saleDate || inv.issueDate || undefined,
            payment_to: inv.dueDate || undefined,
            payment_type: (inv.paymentMethod || "transfer").toLowerCase(),
            buyer_name: ((_b = inv.counterparty) === null || _b === void 0 ? void 0 : _b.name) || "",
            buyer_tax_no: ((_c = inv.counterparty) === null || _c === void 0 ? void 0 : _c.nip) || "",
            buyer_company: true,
            currency: inv.currency || "PLN",
            positions: safePositions,
        },
    };
    if (opts.sellerName)
        body.invoice.seller_name = opts.sellerName;
    if (opts.sellerTaxNo)
        body.invoice.seller_tax_no = opts.sellerTaxNo;
    if (opts.govSaveAndSend)
        body.gov_save_and_send = true; // default OFF (Q3-c)
    return body;
}
exports.buildFakturowniaPayload = buildFakturowniaPayload;
// Net adjustment a note applies to an invoice's effective amount (PLN).
function noteSignedPLN(note) {
    const mag = r2(n(note.amountPLN) || n(note.amount) * (0, fx_1.resolveFxRate)(note.fxRate, note.currency));
    return note.noteType === "DEBIT" ? mag : -mag;
}
exports.noteSignedPLN = noteSignedPLN;
