"use strict";
// ─── DATA INTEGRITY CHECKER ─────────────────────────────────────────────────
//
// A single pure function that scans the whole dataset for structural problems —
// the kinds of silent corruption that the per-module entry guards don't catch
// because they arise from imports, deletes, edits, legacy data, or cross-module
// drift rather than from a single form submission.
//
// No React, no storage, no mutation. Give it the app state; it returns a
// severity-ranked list of issues. The UI can render a "N data issues" badge and
// a detail panel from the result. Nothing here changes behaviour — it only
// reports — so it is safe to run on every load.
//
// Issue severities:
//   "error"   — will produce wrong money figures or a broken reference NOW.
//   "warning" — risky / likely a mistake, but not certainly wrong.
//   "info"    — worth knowing; benign in isolation.
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkIntegrity = void 0;
// ── small helpers (kept local so this module has zero imports) ──
function num(v) { const x = parseFloat(String(v !== null && v !== void 0 ? v : "").replace(/\s/g, "").replace(",", ".")); return isFinite(x) ? x : 0; }
function r2(x) { return Math.round(x * 100) / 100; }
function norm(s) { return String(s !== null && s !== void 0 ? s : "").trim().toLowerCase(); }
function arr(v) { return Array.isArray(v) ? v : []; }
// v6.30.1: aligned with SO_PRE_DISPATCH_STATUSES (types.ts / Batch 1 decision).
// Shipped+ orders already had their kg physically subtracted via SHIP_OUT, so
// counting them as reserving here double-subtracted and raised false LOT_OVERSOLD
// errors on every correctly shipped lot. Kept as a local copy (this module has
// zero imports by design) — if the canonical set changes, change both.
const RESERVING_SO_STATUSES = new Set(["Confirmed", "Reserved", "Loading"]);
const SHIPPED_PLUS = new Set(["Shipped", "Delivered", "Invoiced", "Closed"]);
function checkIntegrity(inp) {
    const issues = [];
    const add = (severity, code, module, entity, message) => issues.push({ severity, code, module, entity, message });
    const contacts = arr(inp.contacts);
    const pos = arr(inp.pos);
    const lots = arr(inp.lots);
    const orders = arr(inp.orders);
    const shipments = arr(inp.shipments);
    const warehouseInvoices = arr(inp.warehouseInvoices);
    // Lookup sets for fast reference checks.
    const poByNumber = new Map(pos.map((p) => [String(p.number), p]));
    const lotByNumber = new Map(lots.map((l) => [String(l.number), l]));
    const orderByNumber = new Map(orders.map((o) => [String(o.number), o]));
    const contactIds = new Set(contacts.map((c) => String(c.id)));
    const contactMergedIds = new Set(contacts.flatMap((c) => arr(c.mergedFromIds).map(String)));
    // ── 1. Orphaned references ────────────────────────────────────────────────
    // Lot pointing at a PO that no longer exists.
    lots.forEach((lot) => {
        if ((lot === null || lot === void 0 ? void 0 : lot.poRef) && !poByNumber.has(String(lot.poRef))) {
            add("error", "ORPHAN_LOT_PO", "Inventory", lot.number || "(unnumbered lot)", `Lot references PO ${lot.poRef}, which no longer exists. Its purchase cost and supplier payout cannot resolve.`);
        }
    });
    // SO line pointing at a missing lot or PO line.
    orders.forEach((o) => {
        if ((o === null || o === void 0 ? void 0 : o.status) === "Cancelled")
            return;
        arr(o.items).forEach((it) => {
            var _a;
            if (it.sourceType === "STOCK" && it.sourceRef && !lotByNumber.has(String(it.sourceRef))) {
                add("error", "ORPHAN_SO_LOT", "Sales Orders", o.number || "(unnumbered SO)", `Line "${it.product || "—"}" sources stock lot ${it.sourceRef}, which no longer exists. COGS cannot be computed.`);
            }
            if (it.sourceType === "PO" && it.sourceRef) {
                const po = poByNumber.get(String(it.sourceRef));
                if (!po) {
                    add("error", "ORPHAN_SO_PO", "Sales Orders", o.number || "(unnumbered SO)", `Line "${it.product || "—"}" sources PO ${it.sourceRef}, which no longer exists. COGS cannot be computed.`);
                }
                else {
                    // v6.30.1: the old `|| po.items.length > 0` made this check dead — any PO
                    // with at least one line passed, so a missing line id was never flagged.
                    // Strict when the SO line names an explicit sourceLineId; a legacy line
                    // (sourceLineId null → defaulted) only requires the PO to have lines,
                    // because legacy PO line ids are timestamps and "1" would never match.
                    const hasLine = it.sourceLineId != null
                        ? arr(po.items).some((l) => String(l.id) === String(it.sourceLineId))
                        : arr(po.items).length > 0;
                    const lineId = (_a = it.sourceLineId) !== null && _a !== void 0 ? _a : 1;
                    if (!hasLine) {
                        add("warning", "ORPHAN_SO_POLINE", "Sales Orders", o.number || "(unnumbered SO)", `Line "${it.product || "—"}" references PO ${it.sourceRef} line ${lineId}, which is missing.`);
                    }
                }
            }
            if (!it.sourceType || !it.sourceRef) {
                // unsourced lines are only a problem once the SO is committed
                if (o.status && o.status !== "Draft") {
                    add("warning", "SO_LINE_UNSOURCED", "Sales Orders", o.number || "(unnumbered SO)", `Line "${it.product || "—"}" has no source assigned but the SO is ${o.status}. COGS will be missing.`);
                }
            }
        });
    });
    // Shipment refs pointing at missing lots. (PO/SO refs are checked ONCE, in
    // 7a.4 below, as errors — v6.31.0 removed the duplicate warnings this section
    // used to emit for the same condition, which double-counted the badge.)
    shipments.forEach((sh) => {
        arr(sh.lotRefs).forEach((ref) => {
            if (!lotByNumber.has(String(ref)))
                add("warning", "ORPHAN_SHIP_LOT", "Shipments", sh.number || "(unnumbered shipment)", `Shipment references lot ${ref}, which no longer exists.`);
        });
    });
    // ── 2. Oversold lots (defence in depth behind the SO confirm gate) ─────────
    // Sum reserving-SO demand per lot and compare to availableKg. The SO form
    // blocks this at entry, but imported/edited data can still arrive oversold.
    lots.forEach((lot) => {
        var _a, _b;
        const avail = num((_b = (_a = lot.availableKg) !== null && _a !== void 0 ? _a : lot.physicalKg) !== null && _b !== void 0 ? _b : lot.receivedKg);
        let reserved = 0;
        const claimers = [];
        orders.forEach((o) => {
            if (!RESERVING_SO_STATUSES.has(o.status))
                return;
            arr(o.items).forEach((it) => {
                if (it.sourceType === "STOCK" && String(it.sourceRef) === String(lot.number) && norm(it.product) === norm(lot.product)) {
                    const q = num(it.qty);
                    if (q > 0) {
                        reserved += q;
                        claimers.push(o.number);
                    }
                }
            });
        });
        if (reserved > avail + 0.01 && reserved > 0) {
            add("error", "LOT_OVERSOLD", "Inventory", lot.number || "(unnumbered lot)", `Committed ${r2(reserved).toLocaleString("pl-PL")} kg exceeds available ${r2(avail).toLocaleString("pl-PL")} kg (claimed by ${[...new Set(claimers)].join(", ")}).`);
        }
    });
    // ── 3. SO marked shipped+ but no traceable SHIP_OUT for it ─────────────────
    // The margin engine attributes COGS by matching the SO number inside SHIP_OUT
    // movement notes. If a committed SO has no such movement, COGS is understated.
    orders.forEach((o) => {
        if (!SHIPPED_PLUS.has(o.status))
            return;
        const soNo = String(o.number);
        let shippedKg = 0;
        lots.forEach((lot) => {
            arr(lot.movements).forEach((m) => {
                const matches = m.soRef ? String(m.soRef) === soNo : String(m.note || "").includes(soNo);
                if (m.type === "SHIP_OUT" && matches)
                    shippedKg += num(m.qtyKg);
                if (m.type === "REVERSAL" && matches)
                    shippedKg -= num(m.qtyKg);
            });
        });
        const demand = arr(o.items).reduce((s, it) => s + num(it.qty), 0);
        if (shippedKg <= 0 && demand > 0) {
            add("warning", "SO_SHIPPED_NO_MOVEMENT", "Sales Orders", soNo, `SO is ${o.status} but no SHIP_OUT movement is traceable to it. Its COGS will read as zero.`);
        }
    });
    // ── 4. SHIP_OUT note ambiguity (substring collision) ───────────────────────
    // If one SO number is a substring of another, note-based matching is unsafe.
    const soNumbers = orders.map((o) => String(o.number)).filter(Boolean);
    soNumbers.forEach((a) => {
        soNumbers.forEach((b) => {
            if (a !== b && b.includes(a)) {
                add("info", "SO_NUMBER_SUBSTRING", "Sales Orders", a, `SO number "${a}" is contained inside "${b}". Note-based ship-out matching could confuse the two; a structured soRef on movements avoids this.`);
            }
        });
    });
    // ── 5. Consignment settlement double-write ─────────────────────────────────
    // The settlement writes two cost lines keyed CONSIGN-<id> / CONSIGNC-<id>.
    // More than one of either means a re-close didn't replace cleanly → double count.
    lots.forEach((lot) => {
        const costs = arr(lot.costs);
        const purch = costs.filter((c) => String(c.source || "") === `CONSIGN-${lot.id}`);
        const comm = costs.filter((c) => String(c.source || "") === `CONSIGNC-${lot.id}`);
        if (purch.length > 1)
            add("error", "CONSIGN_DOUBLE_PURCHASE", "Inventory", lot.number || "(unnumbered lot)", `${purch.length} consignment purchase components on one lot — settlement double-counted.`);
        if (comm.length > 1)
            add("error", "CONSIGN_DOUBLE_COMMISSION", "Inventory", lot.number || "(unnumbered lot)", `${comm.length} commission credit components on one lot — settlement double-counted.`);
    });
    // ── 6. Allocations referencing a missing warehouse invoice ─────────────────
    // Cost lines tagged with a warehouse-invoice ref whose invoice no longer exists.
    // Finance tags allocated warehouse cost lines with source `WHINV-<id>` (hyphen).
    const whInvoiceIds = new Set(warehouseInvoices.map((w) => `WHINV-${w.id}`));
    lots.forEach((lot) => {
        arr(lot.costs).forEach((c) => {
            const src = String(c.source || "");
            if (src.startsWith("WHINV-") && !whInvoiceIds.has(src)) {
                add("warning", "ALLOC_MISSING_INVOICE", "Inventory", lot.number || "(unnumbered lot)", `A cost line is tagged to ${src}, but that warehouse invoice no longer exists. The allocation is stale.`);
            }
        });
    });
    // ── 7. Counterparty snapshots whose id no longer resolves ──────────────────
    const checkSnapshot = (snap, module, entity, role) => {
        if (!snap || snap.id === undefined || snap.id === null)
            return;
        const id = String(snap.id);
        if (!contactIds.has(id) && !contactMergedIds.has(id)) {
            add("warning", "SNAPSHOT_UNRESOLVED", module, entity, `${role} "${snap.name || id}" no longer matches a counterparty by id (only by name, which is unreliable). Re-select it to re-link.`);
        }
    };
    pos.forEach((p) => checkSnapshot(p.supplier, "Purchase Orders", p.number || "(unnumbered PO)", "Supplier"));
    orders.forEach((o) => checkSnapshot(o.client, "Sales Orders", o.number || "(unnumbered SO)", "Client"));
    // ── 8. Duplicate primary keys (numbers / ids) ──────────────────────────────
    const dupScan = (list, key, module, label) => {
        const seen = new Map();
        list.forEach((x) => { var _a; const k = String((_a = x === null || x === void 0 ? void 0 : x[key]) !== null && _a !== void 0 ? _a : ""); if (!k)
            return; seen.set(k, (seen.get(k) || 0) + 1); });
        seen.forEach((count, k) => { if (count > 1)
            add("error", "DUPLICATE_KEY", module, k, `${count} ${label} share the ${key} "${k}". References to it are ambiguous.`); });
    };
    dupScan(pos, "number", "Purchase Orders", "POs");
    dupScan(lots, "number", "Inventory", "lots");
    dupScan(orders, "number", "Sales Orders", "SOs");
    dupScan(shipments, "number", "Shipments", "shipments");
    // ── 9. Invoices & finance notes (v6.18.6, P0-7) ────────────────────────────
    const invoices = arr(inp.invoices);
    const financeNotes = arr(inp.financeNotes);
    const shipByNumber = new Set(shipments.map((s) => String(s.number)));
    const invoiceById = new Map(invoices.map((i) => [String(i.id), i]));
    // Invoice links pointing at records that no longer exist.
    invoices.forEach((inv) => {
        if ((inv === null || inv === void 0 ? void 0 : inv.paymentStatus) === "Cancelled")
            return;
        const label = inv.number || `invoice #${inv.id}`;
        arr(inv.links).forEach((lk) => {
            const num2 = String((lk === null || lk === void 0 ? void 0 : lk.number) || "");
            if (!num2)
                return;
            const missing = (lk.type === "SO" && !orderByNumber.has(num2)) ||
                (lk.type === "PO" && !poByNumber.has(num2)) ||
                (lk.type === "Lot" && !lotByNumber.has(num2)) ||
                (lk.type === "Shipment" && !shipByNumber.has(num2));
            if (missing)
                add("warning", "INVOICE_ORPHAN_LINK", "Invoices", label, `Invoice links to ${lk.type} ${num2}, which no longer exists.`);
        });
        // A recorded payment larger than the invoice total.
        if (num(inv.paidAmount) > num(inv.grossPLN || inv.netPLN) + 0.01 && num(inv.grossPLN || inv.netPLN) > 0) {
            add("warning", "INVOICE_OVERPAID", "Invoices", label, `Recorded payments (${r2(num(inv.paidAmount))}) exceed the invoice total (${r2(num(inv.grossPLN || inv.netPLN))}).`);
        }
    });
    // Duplicate invoice numbers within the same direction (sales vs cost).
    const invKeySeen = new Map();
    invoices.forEach((inv) => {
        const num2 = norm(inv.number);
        if (!num2 || inv.paymentStatus === "Cancelled")
            return;
        const k = `${inv.kind || "?"}|${num2}`;
        invKeySeen.set(k, (invKeySeen.get(k) || 0) + 1);
    });
    invKeySeen.forEach((count, k) => {
        if (count > 1)
            add("warning", "DUPLICATE_INVOICE_NO", "Invoices", k.split("|")[1], `${count} ${k.split("|")[0] === "SALES" ? "sales" : "cost"} invoices share the number "${k.split("|")[1]}".`);
    });
    // Finance note (credit/debit) pointing at a missing invoice.
    financeNotes.forEach((note) => {
        if ((note === null || note === void 0 ? void 0 : note.invoiceId) == null)
            return;
        if (!invoiceById.has(String(note.invoiceId))) {
            add("warning", "NOTE_ORPHAN_INVOICE", "Invoices", note.number || `${note.noteType || "note"} #${note.id}`, `${note.noteType || "Credit/debit"} note references invoice #${note.invoiceId}, which no longer exists.`);
        }
    });
    // ── 10. Shipment ↔ inventory consistency (v6.18.7, P1-6) ───────────────────
    // A delivered shipment whose lots show no recorded movement — stock probably
    // wasn't received/shipped (the "apply inventory" step was missed).
    shipments.forEach((sh) => {
        if ((sh === null || sh === void 0 ? void 0 : sh.status) !== "Delivered")
            return;
        const lotRefs = new Set([...arr(sh.lotRefs), ...arr(sh.goods).map((g) => g.lotRef)].filter(Boolean).map(String));
        if (!lotRefs.size)
            return;
        const anyMissing = [...lotRefs].some((lr) => {
            const lot = lotByNumber.get(lr);
            if (!lot)
                return false; // missing lot is reported separately
            return !arr(lot.movements).some((m) => String(m.shipmentRef) === String(sh.number));
        });
        if (anyMissing)
            add("warning", "SHIPMENT_NO_MOVEMENT", "Shipments", sh.number || "(unnumbered shipment)", `Shipment is Delivered but at least one of its lots has no inventory movement — stock may not have been received or shipped out. Open it and apply the inventory movement.`);
    });
    // A delivered/arrived shipment carrying logistics costs that were never allocated
    // to inventory lot costing — those costs are missing from COGS.
    shipments.forEach((sh) => {
        if (!["Delivered", "Arrived"].includes(sh === null || sh === void 0 ? void 0 : sh.status))
            return;
        const hasCost = arr(sh.costs).some((c) => num(c.amountPLN) > 0);
        if (hasCost && sh.billingStatus !== "Cost allocated") {
            add("info", "SHIPMENT_COST_UNALLOCATED", "Shipments", sh.number || "(unnumbered shipment)", `Shipment has logistics costs not yet allocated to inventory (billing status: ${sh.billingStatus || "—"}). They won't appear in lot COGS until allocated.`);
        }
    });
    // ── Safeguards batch 7a ──────────────────────────────────────────────────
    // 7a.1 Duplicate invoice per counterparty + number (BP-40 completion): the
    // same legal number from the same party twice = double-counted money.
    {
        const seen = new Map();
        invoices.forEach((v) => {
            var _a, _b;
            const num = String(v.number || "").trim();
            if (!num)
                return; // drafts without official numbers are fine
            const key = `${String(((_a = v.counterparty) === null || _a === void 0 ? void 0 : _a.name) || "").trim().toLowerCase()}::${num.toLowerCase()}`;
            if (seen.has(key))
                add("error", "DUP_INVOICE", "Invoices", num, `Duplicate invoice "${num}" for ${((_b = v.counterparty) === null || _b === void 0 ? void 0 : _b.name) || "(party)"} — the same legal number is registered twice (double-counted money).`);
            else
                seen.set(key, num);
        });
    }
    // 7a.2 Derived paidAmount vs payment events out of sync (Batch 5b invariant).
    invoices.forEach((v) => {
        if (!Array.isArray(v.payments) || !v.payments.length)
            return;
        const sum = Math.round(v.payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0) * 100) / 100;
        const cached = Math.round((parseFloat(v.paidAmount) || 0) * 100) / 100;
        if (Math.abs(sum - cached) > 0.01)
            add("warning", "PAY_MISMATCH", "Invoices", v.number || "(draft)", `Paid amount ${cached} differs from the sum of payment events ${sum} — recalculated on next payment edit, but worth a look.`);
    });
    // 7a.3 Over-issued lots: shipping/damaging more than existed was silently
    // clamped before; the reducer now reports the excess.
    lots.forEach((l) => {
        const over = parseFloat(l.overIssuedKg) || 0;
        if (over > 0)
            add("error", "LOT_OVER_ISSUE", "Inventory", l.number || "(lot)", `${over} kg more was shipped/damaged out of this lot than it ever contained — a quantity was mistyped somewhere (the stock was clamped at 0, but the movements don't add up).`);
    });
    // 7a.4 Shipments pointing at documents that don't exist.
    {
        const poNums = new Set(pos.map((p) => p.number));
        const soNums = new Set(orders.map((o) => o.number));
        shipments.forEach((s) => {
            (Array.isArray(s.poRefs) ? s.poRefs : []).forEach((r) => {
                if (r && !poNums.has(r))
                    add("error", "SHIP_PO_MISSING", "Shipments", s.number || "(shipment)", `References PO ${r}, which no longer exists.`);
            });
            (Array.isArray(s.soRefs) ? s.soRefs : []).forEach((r) => {
                if (r && !soNums.has(r))
                    add("error", "SHIP_SO_MISSING", "Shipments", s.number || "(shipment)", `References SO ${r}, which no longer exists.`);
            });
        });
    }
    // ── v6.31.0: close-out completeness, receipt-loss tripwire, FX sanity ──────
    // 11.1 SO CLOSE-OUT COMPLETENESS. The business reads an SO's P/L once, at
    // close — so a Closed SO with provisional cost data means the one number that
    // matters was read incomplete. Aggregates the reasons into a single warning.
    {
        const shipmentsForSO = (soNumber) => shipments.filter((s) => s && s.status !== "Cancelled" && (arr(s.soRefs).map(String).includes(String(soNumber)) ||
            arr(s.goods).some((g) => String((g === null || g === void 0 ? void 0 : g.soRef) || "") === String(soNumber))));
        orders.forEach((o) => {
            if ((o === null || o === void 0 ? void 0 : o.status) !== "Closed")
                return;
            const reasons = [];
            const linked = shipmentsForSO(o.number);
            const expectedCosts = linked.flatMap((s) => arr(s.costs).filter((c) => (c.invoiceStatus || "Expected") === "Expected"));
            if (expectedCosts.length)
                reasons.push(`${expectedCosts.length} shipment cost line(s) still "Expected" (no invoice received)`);
            // Sourced lots with no cost data → COGS reads zero for those kg.
            arr(o.items).forEach((it) => {
                if (it.sourceType === "STOCK" && it.sourceRef) {
                    const lot = lotByNumber.get(String(it.sourceRef));
                    if (lot && !arr(lot.costs).length)
                        reasons.push(`lot ${it.sourceRef} has no cost data`);
                }
            });
            // No traceable SHIP_OUT at all → actual COGS is zero (mirrors check 3,
            // which only covers Shipped+; Closed is where it is fatal for the number).
            let shipped = 0;
            lots.forEach((lot) => arr(lot.movements).forEach((m) => {
                if (m.voided)
                    return;
                const matches = m.soRef ? String(m.soRef) === String(o.number) : String(m.note || "").includes(String(o.number));
                if (m.type === "SHIP_OUT" && matches)
                    shipped += num(m.qtyKg);
            }));
            const demand = arr(o.items).reduce((s, it) => s + num(it.qty), 0);
            if (shipped <= 0 && demand > 0)
                reasons.push("no SHIP_OUT movement traceable to this SO — actual COGS reads zero");
            if (reasons.length)
                add("warning", "SO_CLOSED_PL_INCOMPLETE", "Sales Orders", o.number || "(unnumbered SO)", `SO is Closed but its final P/L is incomplete: ${reasons.slice(0, 3).join("; ")}${reasons.length > 3 ? ` (+${reasons.length - 3} more)` : ""}. The close-out figure is understated or provisional.`);
        });
    }
    // 11.2 RECEIPT-LOSS TRIPWIRE (T-20). "Lot reset to Expected/0 kg although the
    // shipment shows arrived" is under investigation awaiting a repro — these two
    // read-only checks catch the aftermath the moment it happens on real data.
    lots.forEach((l) => {
        const inMoves = arr(l.movements).filter((m) => (m === null || m === void 0 ? void 0 : m.type) === "IN" && !m.voided);
        const receivedKg = num(l.receivedKg);
        if (inMoves.length && (l.status === "Expected" || (receivedKg === 0 && num(l.physicalKg) === 0 && !arr(l.movements).some((m) => (m === null || m === void 0 ? void 0 : m.type) === "SHIP_OUT" && !m.voided)))) {
            add("error", "LOT_RECEIPT_INCONSISTENT", "Inventory", l.number || "(lot)", `Lot has ${inMoves.length} IN movement(s) but reads ${l.status || "Expected"} / ${receivedKg} kg received — its receipt state was reset while the history survived. (T-20 tripwire: note what was done just before this appeared.)`);
        }
        if (receivedKg > 0 && arr(l.movements).length > 0 && !inMoves.length) {
            add("warning", "LOT_RECEIPT_NO_MOVEMENT", "Inventory", l.number || "(lot)", `Lot shows ${receivedKg} kg received but no (non-voided) IN movement — state and history have drifted; a recompute would zero it.`);
        }
    });
    // 11.3 FX SANITY (tier-2 item, pulled forward — found live in real data: an EUR
    // SO with fxRate 1 understates PLN revenue ~4×). A non-PLN document whose
    // locked rate is missing or ≈1 almost certainly never had its rate set.
    {
        const fxSuspect = (cur, fx) => {
            const c = String(cur || "PLN").toUpperCase();
            if (c === "PLN")
                return false;
            const r = num(fx);
            return r <= 1.05; // 0/blank parses to 0; EUR/USD ≈ 4 — anything ≤1.05 is unset
        };
        orders.forEach((o) => {
            if ((o === null || o === void 0 ? void 0 : o.status) === "Cancelled" || (o === null || o === void 0 ? void 0 : o.status) === "Draft")
                return;
            if (fxSuspect(o.currency, o.fxRate))
                add("warning", "FX_RATE_SUSPECT", "Sales Orders", o.number || "(SO)", `SO is in ${String(o.currency).toUpperCase()} with fxRate ${num(o.fxRate) || "blank"} — PLN revenue and margin are understated until the locked rate is set.`);
        });
        pos.forEach((p) => {
            if ((p === null || p === void 0 ? void 0 : p.status) === "Cancelled" || (p === null || p === void 0 ? void 0 : p.status) === "Draft")
                return;
            if (fxSuspect(p.currency, p.fxRate))
                add("warning", "FX_RATE_SUSPECT", "Purchase Orders", p.number || "(PO)", `PO is in ${String(p.currency).toUpperCase()} with fxRate ${num(p.fxRate) || "blank"} — PLN cost is understated until the locked rate is set.`);
        });
        arr(inp.invoices).forEach((v) => {
            if (!v || v.paymentStatus === "Cancelled")
                return;
            if (fxSuspect(v.currency, v.fxRate))
                add("warning", "FX_RATE_SUSPECT", "Invoices", v.number || `invoice #${v.id}`, `Invoice is in ${String(v.currency).toUpperCase()} with fxRate ${num(v.fxRate) || "blank"} — its PLN amounts are understated.`);
        });
    }
    // ── v6.32.0: operational-testing safeguards ─────────────────────────────
    // 12.1 DUPLICATE LIVE SHIPMENT. Two non-cancelled shipments for the same SO
    // with identical goods kg and identical cost totals — the re-booked-truck
    // pattern where the superseded booking was never cancelled, silently doubling
    // freight in the SO's P/L. (Found live: SHP-2026-0005 / 0006.)
    {
        const live = shipments.filter((s) => s && s.status !== "Cancelled");
        const key = (s) => {
            const sos = arr(s.soRefs).filter(Boolean).map(String).sort().join("+");
            const kg = arr(s.goods).reduce((t, g) => t + num(g === null || g === void 0 ? void 0 : g.qtyKg), 0);
            const cost = arr(s.costs).reduce((t, c) => t + (num(c === null || c === void 0 ? void 0 : c.amountPLN) || num(c === null || c === void 0 ? void 0 : c.amount) * (num(c === null || c === void 0 ? void 0 : c.fxRate) || 1)), 0);
            return sos ? `${sos}|${Math.round(kg)}|${Math.round(cost)}` : null;
        };
        const seen = new Map();
        live.forEach((s) => {
            const k = key(s);
            if (!k)
                return;
            if (seen.has(k)) {
                add("warning", "DUP_LIVE_SHIPMENT", "Shipments", s.number || "(shipment)", `Looks like a duplicate of ${seen.get(k)} — same SO link, same goods kg, same cost total, both live. If one superseded the other, cancel the old booking; otherwise the SO carries the freight twice.`);
            }
            else
                seen.set(k, s.number || "(shipment)");
        });
    }
    // 12.2 STALE BILLING FLAG. billingStatus says "Cost allocated" but no lot
    // carries this shipment's allocation tags (Batch-1b replace-by-source) — the
    // allocation never ran or was reverted; the flag misleads the tester.
    shipments.forEach((sh) => {
        if (!sh || sh.billingStatus !== "Cost allocated")
            return;
        if (!arr(sh.costs).length)
            return;
        const tagged = lots.some((l) => arr(l.costs).some((c) => String((c === null || c === void 0 ? void 0 : c.source) || "").startsWith(`${sh.number}/`)));
        if (!tagged)
            add("warning", "STALE_BILLING_FLAG", "Shipments", sh.number || "(shipment)", `billingStatus is "Cost allocated" but no lot carries this shipment's cost allocation — the flag is stale (allocation never ran, was reverted, or the shipment was cancelled). Re-run the allocation or reset the status.`);
    });
    const counts = {
        error: issues.filter(i => i.severity === "error").length,
        warning: issues.filter(i => i.severity === "warning").length,
        info: issues.filter(i => i.severity === "info").length,
        total: issues.length,
    };
    // Stable sort: errors first, then warnings, then info; preserve discovery order within.
    const rank = { error: 0, warning: 1, info: 2 };
    issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
    return { issues, counts, okay: counts.error === 0 };
}
exports.checkIntegrity = checkIntegrity;
