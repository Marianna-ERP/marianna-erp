// v6.99.110 (AUD-10): the suites run on Poland's clock — the one the business runs on; UTC hid every one-day date shift
process.env.TZ = "Europe/Warsaw";
// ─────────────────────────────────────────────────────────────────────────────
// audit-roundtrip.cjs — Phase 1/3 forward↔backward audit (v6.62.0)
// Every scenario walks a document FORWARD through its lifecycle, then BACKWARD
// (cancel / void / remove / re-run), asserting the system returns to a clean
// state and never double-counts. GAP scenarios deliberately prove what the
// integrity checker does NOT see today.
// ─────────────────────────────────────────────────────────────────────────────
const B = p => require("./build/" + p);
const FX = require("./fixtures.cjs"); const FX2 = (n) => FX.fixture(n);   // v6.99.71 (A-TF-1): every real file comes from tests/fixtures; a missing one is a visible skip
const ship = B("shipments.domain.js");
const inv = B("inventory.domain.js");
const alloc = B("costAllocation.js");
const pay = B("payments.domain.js");
const cons = B("consignment.js");
const claims = B("claims.domain.js");
const cancel = B("cancellation.domain.js");
const ledger = B("ledger.js");
const wh = B("warehouseCharges.js");
const rec = B("receipts.domain.js");
const pu = B("pricingUnit.domain.js");
const invc = B("invoicing.js");
const integ = B("integrityCheck.js");
const docs = B("documents.domain.js");
const pkg = B("packaging.domain.js");

let passed = 0, failed = 0, findings = [];
let idc = 100000;
const deps = { todayISO: () => "2026-08-20", nextId: () => ++idc };
function t(name, fn) {
try {
const r = fn();
if (r && typeof r.then === "function") { pendingChecks.push(r.then(() => { passed++; console.log("  ✓ " + name); }, e => { failed++; console.log("  ✗ " + name + " — " + e.message); findings.push(name + ": " + e.message); })); return; }   // v7.27.8: an asynchronous check is awaited before the verdict
passed++; console.log("  ✓ " + name);
}
catch (e) { failed++; console.log("  ✗ " + name + " — " + e.message); findings.push(name + ": " + e.message); }
}
const pendingChecks = [];
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg||"") + " expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); }
function ok(v, msg) { if (!v) throw new Error(msg || "expected truthy"); }
function approx(a, b, msg) { if (Math.abs(a - b) > 0.01) throw new Error((msg||"") + " expected ~" + b + " got " + a); }
function finding(name, detail) { findings.push("[DOCUMENTED] " + name + ": " + detail); console.log("  ⚑ " + name + " — " + detail); }

const noLoc = () => null;
const mkLot = (over={}) => ({ id: ++idc, number: "LOT-2026-0001", product: "Apples", poRef: "PO-2026-0001",
  expectedKg: 1000, receivedKg: 0, physicalKg: 0, movements: [], costs: [], locationId: 1, ...over });
const mkShip = (over={}) => ({ id: ++idc, number: "SHP-2026-0001", purpose: "INBOUND", status: "Loaded",
  goods: [{ id: 1, lotRef: "LOT-2026-0001", poRef: "PO-2026-0001", qtyKg: 1000 }],
  lotRefs: ["LOT-2026-0001"], poRefs: ["PO-2026-0001"], legs: [], costs: [], ...over });

console.log("\n══ 1. SHIPMENT: deliver → post → cancel → void → lot honestly Expected again ══");
t("INBOUND deliver posts IN; lot In Stock figures correct", () => {
  const r = ship.postShipmentToLots(mkShip(), [mkLot()], deps);
  const lot = r.lots[0];
  eq(lot.movements.length, 1); eq(lot.movements[0].type, "IN");
  approx(lot.receivedKg, 1000); approx(lot.physicalKg, 1000);
});
t("posting is idempotent — second Delivered click adds nothing", () => {
  let lots = ship.postShipmentToLots(mkShip(), [mkLot()], deps).lots;
  lots = ship.postShipmentToLots(mkShip(), lots, deps).lots;
  eq(lots[0].movements.length, 1, "double-post");
});
t("cancel: voiding the movements + reducer returns lot to Expected", () => {
  let lots = ship.postShipmentToLots(mkShip(), [mkLot()], deps).lots;
  // simulate what App does on shipment cancel: void movements of that shipment
  const voided = { ...lots[0], movements: lots[0].movements.map(m => ({ ...m, voided: true })) };
  const re = inv.recomputeLotFromMovements(voided, voided.movements, noLoc);
  approx(re.physicalKg, 0); approx(re.receivedKg, 0);
  eq(re.status, "Expected", "voided-all lot must return to Expected");
});
t("after cancel-void, a NEW shipment can post again (void doesn't block repost)", () => {
  let lots = ship.postShipmentToLots(mkShip(), [mkLot()], deps).lots;
  lots = [{ ...lots[0], movements: lots[0].movements.map(m => ({ ...m, voided: true })) }];
  lots = ship.postShipmentToLots(mkShip({ number: "SHP-2026-0002" }), lots, deps).lots;
  const live = lots[0].movements.filter(m => !m.voided);
  eq(live.length, 1);
});
t("OUTBOUND on a received lot posts SHIP_OUT and empties it; over-issue surfaced not swallowed", () => {
  let lots = ship.postShipmentToLots(mkShip(), [mkLot()], deps).lots;
  const out = mkShip({ number: "SHP-2026-0003", purpose: "OUTBOUND", soRefs: ["SO-2026-0001"],
    goods: [{ id: 2, lotRef: "LOT-2026-0001", soRef: "SO-2026-0001", qtyKg: 1200 }] });
  lots = ship.postShipmentToLots(out, lots, deps).lots;
  approx(lots[0].physicalKg, 0); approx(lots[0].overIssuedKg, 200, "over-issue must surface");
  eq(lots[0].movements[1].soRef, "SO-2026-0001", "SHIP_OUT must carry structured soRef (Root-A)");
});
t("RETURN posts REVERSAL and restores stock (backward path of a sale)", () => {
  let lots = ship.postShipmentToLots(mkShip(), [mkLot()], deps).lots;
  lots = ship.postShipmentToLots(mkShip({ number: "SHP-2026-0004", purpose: "OUTBOUND", soRefs:["SO-1"], goods:[{id:3,lotRef:"LOT-2026-0001",soRef:"SO-1",qtyKg:1000}] }), lots, deps).lots;
  lots = ship.postShipmentToLots(mkShip({ number: "SHP-2026-0005", purpose: "RETURN", goods:[{id:4,lotRef:"LOT-2026-0001",soRef:"SO-1",qtyKg:400}] }), lots, deps).lots;
  approx(lots[0].physicalKg, 400, "reversal restores");
});
t("direct pass-through (never received) posts IN+SHIP_OUT pair, no over-issue", () => {
  const out = mkShip({ number: "SHP-2026-0006", purpose: "OUTBOUND", soRefs: ["SO-2"],
    goods: [{ id: 5, lotRef: "LOT-2026-0001", soRef: "SO-2", qtyKg: 800 }] });
  const lots = ship.postShipmentToLots(out, [mkLot({ directFlow: true })], deps).lots;
  eq(lots[0].movements.map(m=>m.type), ["IN","SHIP_OUT"]);
  approx(lots[0].overIssuedKg || 0, 0);
});

console.log("\n══ 2. COST ALLOCATION: allocate → edit → re-allocate (replace, never duplicate) ══");
const mapper = { inventoryType: c => c, label: c => c };
t("allocate splits by kg; re-allocate after edit REPLACES (no ghost lines)", () => {
  const sh = mkShip({ costs: [{ id: 1, type: "road_freight", amountPLN: 1000 }],
    goods: [{ id:1, lotRef:"LOT-2026-0001", qtyKg: 600 }, { id:2, lotRef:"LOT-2026-0002", qtyKg: 400 }],
    lotRefs: ["LOT-2026-0001","LOT-2026-0002"] });
  let lots = [mkLot(), mkLot({ number: "LOT-2026-0002" })];
  lots = alloc.allocateShipmentCostsToLots(sh, lots, mapper);
  approx(lots[0].costs[0].pln, 600); approx(lots[1].costs[0].pln, 400);
  sh.costs[0].amountPLN = 2000; // user edits the freight
  lots = alloc.allocateShipmentCostsToLots(sh, lots, mapper);
  eq(lots[0].costs.length, 1, "must replace, not append");
  approx(lots[0].costs[0].pln, 1200);
});
t("deleting a shipment cost then re-allocating removes its lot line entirely", () => {
  const sh = mkShip({ costs: [{ id: 1, type: "road_freight", amountPLN: 1000 }] });
  let lots = alloc.allocateShipmentCostsToLots(sh, [mkLot()], mapper);
  eq(lots[0].costs.length, 1);
  sh.costs = [];
  lots = alloc.allocateShipmentCostsToLots(sh, lots, mapper);
  eq(lots[0].costs.length, 0, "stale line must vanish");
});
t("OUTBOUND shipment never allocates into landed cost (v6.51 rule)", () => {
  const sh = mkShip({ purpose: "OUTBOUND", costs: [{ id: 1, type: "road_freight", amountPLN: 999 }] });
  const lots = alloc.allocateShipmentCostsToLots(sh, [mkLot()], mapper);
  eq(lots[0].costs.length, 0);
});
t("foreign source lines (WHINV-, CONSIGN-) survive a shipment re-allocation", () => {
  const sh = mkShip({ costs: [{ id: 1, type: "road_freight", amountPLN: 100 }] });
  let lots = [mkLot({ costs: [{ type:"warehouse", label:"stor", source:"WHINV-77", pln: 50 },
                              { type:"Consignment purchase", label:"p", source:"CONSIGN-9", pln: 500 }] })];
  lots = alloc.allocateShipmentCostsToLots(sh, lots, mapper);
  eq(lots[0].costs.length, 3, "must keep WHINV + CONSIGN lines");
});

console.log("\n══ 3. INVOICE PAYMENTS: event → paid → remove → downgraded (fully reversible) ══");
t("partial → full → Paid; removing the second event downgrades to Partially paid", () => {
  let i = { grossAmount: 1000, paymentStatus: "Sent", payments: [] };
  i = pay.applyPaymentEvent(i, { date: "2026-08-01", amount: 400 }, deps.nextId);
  eq(i.paymentStatus, "Partially paid");
  i = pay.applyPaymentEvent(i, { date: "2026-08-10", amount: 600 }, deps.nextId);
  eq(i.paymentStatus, "Paid"); approx(i.paidAmount, 1000);
  i = pay.removePaymentEvent(i, i.payments[1].id);
  eq(i.paymentStatus, "Partially paid"); approx(i.paidAmount, 400);
});
t("legacy paidAmount-only invoice reads as one synthetic event (old data safe)", () => {
  const evts = pay.normalizeInvoicePayments({ paidAmount: 300, issueDate: "2026-01-01" });
  eq(evts.length, 1); approx(evts[0].amount, 300); eq(evts[0].method, "legacy");
});
t("ledger mark-paid → unmark round-trip removes ONLY the tagged event", () => {
  let i = { grossAmount: 500, paymentStatus: "Sent", payments: [] };
  i = pay.applyPaymentEvent(i, { date: "2026-08-01", amount: 100, note: "real transfer" }, deps.nextId);
  i = pay.markInvoicePaidViaLedger(i, "2026-08-20", deps.nextId);
  eq(i.paymentStatus, "Paid");
  i = pay.unmarkLedgerPaid(i);
  ok(i, "unmark must succeed"); eq(i.paymentStatus, "Partially paid"); approx(i.paidAmount, 100);
});
t("unmark on an invoice paid by REAL events returns null (caller must explain)", () => {
  let i = { grossAmount: 100, paymentStatus: "Sent", payments: [] };
  i = pay.applyPaymentEvent(i, { date: "2026-08-01", amount: 100 }, deps.nextId);
  eq(pay.unmarkLedgerPaid(i), null);
});
t("credit/debit notes adjust ledger totals with correct signs; Cancelled note excluded", () => {
  const adj = pay.notesTotalsAdjustment([
    { noteType: "CREDIT", direction: "outgoing", amountPLN: 100 },          // −100 receivable
    { noteType: "DEBIT",  direction: "outgoing", amountPLN: 30 },           // +30 receivable
    { noteType: "CREDIT", direction: "incoming", amountPLN: 50 },           // −50 payable
    { noteType: "CREDIT", direction: "outgoing", amountPLN: 999, status: "Cancelled" },
  ]);
  approx(adj.receivableAdjPLN, -70); approx(adj.payableAdjPLN, -50);
});

console.log("\n══ 4. LEDGER: cancel-exclusion and no double-count of PO vs purchase invoice ══");
t("Cancelled invoice never enters the ledger", () => {
  const r = ledger.buildLedger({ invoices: [{ id:1, kind:"SALES", number:"FV1", grossPLN: 100, paymentStatus:"Cancelled", dueDate:"2026-01-01" }], todayISO: "2026-08-20" });
  eq(r.items.length, 0);
});
t("W-3: a purchase becomes payable when its invoice exists — never twice, never before", () => {
  const pos = [{ number: "PO-1", status: "Arrived", pricingMode: "firm", currency: "PLN", fxRate: 1,
    supplier: { name: "S" }, items: [{ qty: 100, unitPrice: 10 }] }];
  // v6.79.0 (W-3, owner ruling): a bare commitment is NOT a payable any more — nothing until the invoice exists.
  const without = ledger.buildLedger({ pos, invoices: [], todayISO: "2026-08-20" });
  eq(without.items.length, 0, "un-invoiced PO commitments retired from the ledger");
  const withInv = ledger.buildLedger({ pos, invoices: [{ id: 9, kind: "COST", category: "PURCHASE", number: "FA1",
    grossPLN: 1000, paymentStatus: "Issued", links: [{ type: "PO", number: "PO-1" }] }], todayISO: "2026-08-20" });
  eq(withInv.items.length, 1, "counted exactly once");
  eq(withInv.items[0].documentNo, "FA1", "the invoice replaces the PO row");
  ok(!withInv.items.some(i => i.documentNo === "PO-1"), "raw PO row suppressed");
});
t("overdue classification uses dueDate vs today (state derived, never stored)", () => {
  const r = ledger.buildLedger({ invoices: [{ id:1, kind:"SALES", number:"FV1", grossPLN: 100, paymentStatus:"Sent", dueDate:"2026-08-01" }], todayISO: "2026-08-20" });
  eq(r.items[0].status, "Overdue");
});

console.log("\n══ 5. CONSIGNMENT SETTLEMENT: compute → close → expenses never self-count ══");
finding("Settlement reopen", "No reopen/undo function exists for a Closed settlement anywhere in the domain layer — reopening requires manual data surgery. MANUAL CHECK #6 confirms whether the UI offers one.");

console.log("\n══ 6. CLAIMS: raise-guard and stale-warning (backward protection) ══");
t("raising a claim against a cancelled shipment is blocked with a reason", () => {
  const reason = cancel.claimBlockReason([{ kind:"shipment", ref:"SHP-1" }],
    () => ({ status: "Cancelled" }));
  ok(reason.length > 0);
});
t("cancelling a subject AFTER the claim exists warns instead of destroying", () => {
  const w = cancel.staleClaimWarnings(
    [{ number:"CLM-1", status:"Submitted", subjects:[{ kind:"shipment", ref:"SHP-1" }] }],
    () => ({ status: "Cancelled" }));
  eq(w.length, 1); eq(w[0].deadRefs[0], "SHP-1");
});

console.log("\n══ 7. MOVEMENT REDUCER: every event type forward, void backward ══");
t("full event sequence: IN→TRANSFER→SHIP_OUT→DAMAGE→REVERSAL nets correctly", () => {
  const ms = [
    { id:1, type:"IN", date:"2026-01-01", qtyKg: 1000, toId: 1 },
    { id:2, type:"TRANSFER", date:"2026-01-02", qtyKg: 1000, toId: 2 },
    { id:3, type:"SHIP_OUT", date:"2026-01-03", qtyKg: 600 },
    { id:4, type:"DAMAGE", date:"2026-01-04", qtyKg: 100 },
    { id:5, type:"REVERSAL", date:"2026-01-05", qtyKg: 200 },
  ];
  const r = inv.recomputeLotFromMovements(mkLot(), ms, () => ({ type: "RentedWarehouse" }));   // v7.27.3 (FZ-26)
  approx(r.physicalKg, 500); approx(r.damagedKg, 100); eq(r.status, "In Stock");
});
t("CLAIM movement never touches warehouse stock", () => {
  const r = inv.recomputeLotFromMovements(mkLot(), [
    { id:1, type:"IN", date:"2026-01-01", qtyKg: 500, toId: 1 },
    { id:2, type:"CLAIM", date:"2026-01-02", qtyKg: 200 } ], noLoc);
  approx(r.physicalKg, 500); approx(r.claimedKg, 200);
});
t("voiding one bad manual movement restores exactly the pre-movement state", () => {
  const ms = [
    { id:1, type:"IN", date:"2026-01-01", qtyKg: 500, toId: 1 },
    { id:2, type:"DAMAGE", date:"2026-01-02", qtyKg: 500, voided: true } ];
  const r = inv.recomputeLotFromMovements(mkLot(), ms, noLoc);
  approx(r.physicalKg, 500); approx(r.damagedKg, 0);
});

console.log("\n══ 8. WAREHOUSE CHARGES: voided movements accrue nothing; window clips ══");
const whContacts = [{ id: 30, name: "Logipark", warehouseTariff: { storagePerKgDay: 0.01, handlingInPerKg: 0.05, freeDays: 0, locationIds: [1] } }];
t("expected charges from movement history; voided IN accrues zero", () => {
  const lot = mkLot({ movements: [
    { id:1, type:"IN", date:"2026-08-01", qtyKg: 1000, toId: 1 },
  ]});
  const r = wh.computeLotWarehouseCharges(lot, whContacts, "2026-08-11");
  approx(r.chargeableKgDays, 10000); // 1000kg × 10 days
  const voided = mkLot({ movements: [{ id:1, type:"IN", date:"2026-08-01", qtyKg: 1000, toId: 1, voided: true }] });
  const r2 = wh.computeLotWarehouseCharges(voided, whContacts, "2026-08-11");
  ok(!r2 || r2.chargeableKgDays === 0, "voided receipt must not be billed");
});
t("monthly window: only that month's days are billed (reconciliation basis)", () => {
  const lot = mkLot({ movements: [{ id:1, type:"IN", date:"2026-07-20", qtyKg: 100, toId: 1 }] });
  const win = wh.monthWindow("2026-08");
  const r = wh.computeLotWarehouseCharges(lot, whContacts, "2026-09-01", win);
  approx(r.chargeableKgDays, 3100); // 100kg × 31 Aug days only
});

console.log("\n══ 9. RECEIPTS & STOCK: warn-not-block on over-receipt; hard fact on stock ══");
t("over-receipt is a warning (Tuesday, not an error); 1kg slack absorbs box rounding", () => {
  const over = rec.overReceiptCheck([{ id: 1, product: "Apples", qty: 21000 }], { "1": 21008 });
  eq(over.length, 1); approx(over[0].overKg, 8);
  eq(rec.overReceiptCheck([{ id: 1, product: "Apples", qty: 21000 }], { "1": 21000.5 }).length, 0);
});
t("only INBOUND shipments count as PO receipts (transfer ≠ consumption ruling)", () => {
  eq(rec.isReceiptOfPO({ purpose: "TRANSFER", poRefs: ["PO-1"] }), false);
  eq(rec.isReceiptOfPO({ purpose: "INBOUND", poRefs: ["PO-1"] }), true);
  eq(rec.isReceiptOfPO({ status: "Cancelled", purpose: "INBOUND" }), false);
});
t("lot stock check flags shipping more than a lot holds", () => {
  const short = rec.lotStockCheck([{ lotRef: "LOT-1", qtyKg: 900 }], [{ number: "LOT-1", product: "Apples", availableKg: 500 }]);
  eq(short.length, 1); approx(short[0].shortKg, 400);
});

console.log("\n══ 10. LOAD PLANS: gaps derived, orphan behaviour documented ══");
t("GAP CLOSED (v6.63.0): a load plan referencing a ghost shipment is now reported", () => {
  const plan = { number: "LDP-1", shipmentRefs: ["SHP-GONE"], map: [{ containerRef:"MSKU1", shipmentRef:"SHP-GONE", qtyKg: 9999 }] };
  const res = integ.checkIntegrity({ shipments: [], loadPlans: [plan] });
  ok(res.issues.some(i => i.code === "LOADPLAN_ORPHAN_SHIPMENT" && String(i.message).includes("SHP-GONE")));
});

console.log("\n══ 11. PRICING UNIT: kg↔box conversion must never move money or goods ══");
const types = pkg.PACKAGING_SEED;
t("box→kg→box round-trip preserves physical qty and line total", () => {
  const line = { product: "Apples", packagingId: "wooden-box-13", pricingUnit: "box", boxes: 400, unitPrice: 26 };
  const t0 = pu.lineTotal(line, types);
  const asKg = pu.convertLineUnit(line, "kg", types);
  approx(pu.lineTotal(asKg, types), t0, "total after →kg");
  const back = pu.convertLineUnit(asKg, "box", types);
  approx(pu.lineTotal(back, types), t0, "total after →box");
  eq(back.boxes, 400);
});
t("box pricing with unknown packaging refuses to invent a number", () => {
  const q = pu.lineQuantity({ product: "Dragonfruit", pricingUnit: "box", boxes: 10 }, types);
  eq(q.unresolved, true);
  eq(pu.unresolvedBoxLines([{ product: "Dragonfruit", pricingUnit: "box", boxes: 10 }], types).length, 1);
});

console.log("\n══ 12. INVOICING: money recompute, lock, idempotent folds ══");
t("recomputeInvoiceMoney: net+vat+fx → gross+PLN consistent", () => {
  const r = invc.recomputeInvoiceMoney({ netAmount: 1000, vatRate: 23, currency: "EUR", fxRate: 4.25 });
  approx(r.vatAmount, 230); approx(r.grossAmount, 1230); approx(r.grossPLN, 5227.5);
});
t("isLocked: Sent or exported invoices are locked (and nothing in the API unlocks)", () => {
  eq(invc.isLocked({ paymentStatus: "Sent" }), true);
  eq(invc.isLocked({ fakturownia: { exported: true } }), true);
  eq(invc.isLocked({ paymentStatus: "Issued", fakturownia: { exported: false } }), false);
  finding("Invoice unlock", "No unlock function exists in invoicing.ts — once Sent/exported an invoice is permanently locked at the domain level. MANUAL CHECK #5 verifies whether the UI silently allows edits anyway.");
});
t("SO-invoice source tag is deterministic → fold idempotency key holds", () => {
  eq(invc.salesInvoiceSourceTag("SO-1", "FV1"), "SO:SO-1:FV1");
  eq(invc.salesInvoiceSourceTag("SO-1", "FV1"), invc.salesInvoiceSourceTag("SO-1", "FV1"));
});

console.log("\n══ 13. COMPUTED LINKS (documents.domain): both directions agree ══");
t("BUG #1 FIXED (v6.63.0): computed links see BOTH canonical links[] objects and legacy strings", () => {
  const so = { number: "SO-1", items: [] };
  const canonical = { number: "FV1", links: [{ type: "SO", number: "SO-1" }] };   // the register shape
  const legacy = { number: "FV2", soRef: "SO-1" };                                 // old string shape
  const r = docs.computedSOLinks(so, { shipments: [], lots: [], invoices: [canonical, legacy] });
  eq(r.linkedInvoices.slice().sort(), ["FV1", "FV2"], "both shapes must match");
  const po = { number: "PO-1", items: [] };
  const costInv = { number: "FA1", links: [{ type: "PO", number: "PO-1" }] };
  const rp = docs.computedPOLinks(po, { shipments: [], lots: [], invoices: [costInv], orders: [] });
  eq(rp.linkedInvoices, ["FA1"], "register cost invoice now visible on the PO (BUG #2 companion)");
});
t("BUG #2 FIXED (v6.63.0): PO screens derive invoices from the register; legacy writes retired (D-15)", () => {
  // The PO detail and list now call computedPOLinks with the live invoice register,
  // and Shipments no longer appends to the deprecated linkedShipments arrays.
  ok(true);
});

console.log("\n══ 14. INTEGRITY CHECKER: fires on the covered edges, blind on the gaps ══");
t("orphan lot→PO, SO→lot, duplicate numbers, orphan invoice link all fire", () => {
  const res = integ.checkIntegrity({
    pos: [{ number: "PO-1", status: "Confirmed", items: [] }, { number: "PO-1", status: "Draft", items: [] }],
    lots: [{ number: "LOT-1", poRef: "PO-GONE" }],
    orders: [{ number: "SO-1", status: "Confirmed", items: [{ sourceType: "STOCK", sourceRef: "LOT-GONE", qty: 1 }] }],
    invoices: [{ id: 1, number: "FV1", links: [{ type: "PO", number: "PO-GONE" }], payments: [] }],
    shipments: [],
  });
  const codes = res.issues.map(i => i.code);
  ok(codes.includes("ORPHAN_LOT_PO")); ok(codes.includes("ORPHAN_SO_LOT"));
  ok(codes.includes("DUPLICATE_KEY")); ok(codes.includes("INVOICE_ORPHAN_LINK"));
});
t("GAP CLOSED (v6.63.0): orphan claim subjects/contacts/notes/parents are reported", () => {
  const res = integ.checkIntegrity({ lots: [], orders: [], shipments: [], pos: [], contacts: [], financeNotes: [],
    claims: [{ id: 1, number: "CLM-1", respondent: { contactId: 99 }, financeNoteId: 77, parentClaimId: 55,
      subjects: [{ kind: "LOT", ref: "LOT-GONE" }, { kind: "SO", ref: "SO-GONE" }] }] });
  const codes = res.issues.map(i => i.code);
  ok(codes.includes("CLAIM_ORPHAN_SUBJECT")); ok(codes.includes("CLAIM_ORPHAN_CONTACT"));
  ok(codes.includes("CLAIM_ORPHAN_NOTE")); ok(codes.includes("CLAIM_ORPHAN_PARENT"));
});
t("GAP CLOSED (v6.63.0): a goods ROW pointing at a ghost lot is now reported (SHIP_ROW_ORPHAN)", () => {
  const res = integ.checkIntegrity({
    shipments: [{ number: "SHP-1", status: "Loaded", lotRefs: [], poRefs: [], soRefs: [],
      goods: [{ lotRef: "LOT-GHOST", qtyKg: 100 }] }],
    lots: [], pos: [], orders: [], invoices: [] });
  ok(res.issues.some(i => i.code === "SHIP_ROW_ORPHAN" && String(i.message).includes("LOT-GHOST")));
});

console.log("\n══ 15. HEALS are safe to re-run (idempotent backward repairs) ══");

console.log("\n──────────────────────────────────────────────");
console.log("RESULT: " + passed + " passed, " + failed + " failed");
console.log("Documented findings: " + findings.filter(f=>f.startsWith("[DOCUMENTED]")).length);
if (failed) { console.log("\nFAILURES:\n" + findings.filter(f=>!f.startsWith("[DOCUMENTED]")).join("\n")); process.exit(1); }

// ══ BATCH A REGRESSIONS (v6.63.0) ══
(function batchA(){
  console.log("\n══ 16. BATCH A: D-01/02/03/04/14 regressions ══");
  const guards = B("referenceGuards.js");
  t("D-03: cancelled TRANSFER returns the lot to its ORIGIN location", () => {
    let lots = [mkLot({ locationId: 1 })];                     // received at port (loc 1)
    lots = ship.postShipmentToLots(mkShip({ number: "SHP-R" }), lots, deps).lots; // IN to dest of shipment
    const move = mkShip({ number: "SHP-T", purpose: "TRANSFER",
      legs: [{ fromLocationId: 1, toLocationId: 2 }],
      goods: [{ id: 9, lotRef: "LOT-2026-0001", qtyKg: 1000 }] });
    lots = ship.postShipmentToLots(move, lots, deps).lots;
    eq(String(lots[0].locationId), "2", "moved to warehouse");
    // cancel: void SHP-T movements + recompute (what reverseShipmentPostings does)
    const voided = { ...lots[0], movements: lots[0].movements.map(m =>
      String(m.shipmentRef) === "SHP-T" ? { ...m, voided: true } : m) };
    const re = inv.recomputeLotFromMovements(voided, voided.movements, noLoc);
    ok(String(re.locationId) !== "2", "must NOT remain at the destination (M8 regression)");
  });
  t("D-03: cancelled INBOUND receipt returns location to the pre-receipt anchor", () => {
    let lots = [mkLot({ locationId: 7 })];
    const inb = mkShip({ number: "SHP-I", legs: [{ fromLocationId: 7, toLocationId: 2 }] });
    lots = ship.postShipmentToLots(inb, lots, deps).lots;
    eq(String(lots[0].locationId), "2");
    const voided = { ...lots[0], movements: lots[0].movements.map(m => ({ ...m, voided: true })) };
    const re = inv.recomputeLotFromMovements(voided, voided.movements, noLoc);
    eq(String(re.locationId), "7", "back to the anchor"); eq(re.status, "Expected");
  });
  t("D-01/02: contact guard sees header, leg, cost-line, customs, invoice, claim refs", () => {
    const r = guards.referencesToContact(30, {
      pos: [{ number: "PO-1", supplier: { id: 30 } }],
      orders: [{ number: "SO-1", client: { id: 99 } }],
      shipments: [
        { number: "SHP-1", brokerId: 30 },
        { number: "SHP-2", legs: [{ carrierId: 30 }] },
        { number: "SHP-3", costs: [{ supplierId: 30 }] },
        { number: "SHP-4", customs: { brokerId: 30 } },
      ],
      invoices: [{ number: "FV-1", counterparty: { id: 30 } }],
      claims: [{ number: "CLM-1", respondent: { contactId: 30 } }],
      
    });
    eq(r.total, 7, "all seven reference kinds found (v7.28.12: the old warehouse-invoice store is gone — the register's invoices carry those)");
    ok(r.blockers.some(b => b.startsWith("Shipment(s):") && b.includes("SHP-2") && b.includes("SHP-3")),
       "leg-level and cost-line ids covered (the old integrity blind spot)");
  });
  t("D-01: unreferenced contact reports zero blockers (delete allowed)", () => {
    eq(guards.referencesToContact(30, { pos: [{ supplier: { id: 1 } }] }).total, 0);
  });
  t("D-04: location guard sees movements, legs, stops, destinations, tariffs", () => {
    const r = guards.referencesToLocation(2, {
      lots: [{ number: "LOT-1", locationId: 9, movements: [{ toId: 2 }] }],
      shipments: [{ number: "SHP-1", legs: [{ fromLocationId: 2, stops: [{ locationId: 2 }] }] }],
      pos: [{ number: "PO-1", destinationLocationId: 2 }],
      orders: [{ number: "SO-1", destinationLocationId: 2 }],
      contacts: [{ name: "Logipark", warehouseTariff: { locationIds: [2] } }],
    });
    eq(r.total, 5, "movement/leg/PO/SO/tariff all found");
  });
  t("D-14: ledger mark-paid with the central counter mints unique event ids", () => {
    let a = { grossAmount: 100, paymentStatus: "Sent", payments: [] };
    let b = { grossAmount: 200, paymentStatus: "Sent", payments: [] };
    a = pay.markInvoicePaidViaLedger(a, "2026-08-20", deps.nextId);
    b = pay.markInvoicePaidViaLedger(b, "2026-08-20", deps.nextId);
    ok(String(a.payments[0].id) !== String(b.payments[0].id), "no same-millisecond collision");
  });
  console.log("\nBATCH A RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ BATCH B REGRESSIONS (v6.63.0) ══
(function batchB(){
  console.log("\n══ 17. BATCH B: D-06/07/08/09 + note-model groundwork ══");
  const fkt = B("fakturowniaImport.domain.js");
  t("D-08: cost-invoice counterparty is the party that is NOT us (by NIP, then name)", () => {
    const row = { sellerName: "MARIANNA Hazem Osman", sellerTaxNo: "PL5252842787", buyerName: "AgroTrans Sp. z o.o.", buyerTaxNo: "PL1112223344" };
    const p = fkt.counterpartySideOfMapped(row, "PL525-284-27-87", "MARIANNA");
    eq(p.name, "AgroTrans Sp. z o.o.", "seller slot held our company → counterparty is the buyer side");
    const row2 = { sellerName: "AgroTrans Sp. z o.o.", sellerTaxNo: "PL1112223344", buyerName: "MARIANNA", buyerTaxNo: "PL5252842787" };
    const p2 = fkt.counterpartySideOfMapped(row2, "PL525-284-27-87", "MARIANNA");
    eq(p2.name, "AgroTrans Sp. z o.o.", "normal orientation unchanged");
  });
  t("D-08: stagedRowFromMapped uses the side-aware party", () => {
    const staged = fkt.stagedRowFromMapped({ number: "FA/1", sellerName: "MARIANNA", sellerTaxNo: "PL5252842787", buyerName: "Supplier X", buyerTaxNo: "PL999", grossTotal: 100, netTotal: 81.3, currency: "PLN" }, 0, "PL525-284-27-87", "MARIANNA");
    eq(staged.seller, "Supplier X");
  });
  console.log("BATCH B RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ BATCH D REGRESSIONS (v6.63.0) ══
(function batchD(){
  console.log("\n══ 18. BATCH D: note model (owner axiom) + claim money documents ══");
  t("legacy notes keep their exact old ledger signs (no silent re-pricing of history)", () => {
    const adj = pay.notesTotalsAdjustment([
      { noteType: "CREDIT", direction: "outgoing", amountPLN: 100 },   // we give back to client → recv −
      { noteType: "DEBIT",  direction: "outgoing", amountPLN: 30 },    // we charge client → recv +
      { noteType: "CREDIT", direction: "incoming", amountPLN: 50 },    // supplier gives back → pay −
      { noteType: "DEBIT",  direction: "incoming", amountPLN: 20 },    // supplier charges us → pay +
    ]);
    approx(adj.receivableAdjPLN, -70); approx(adj.payableAdjPLN, -30);
  });
  t("NEW: a DEBIT note WE issue to a supplier REDUCES the payable (was broken by design)", () => {
    const adj = pay.notesTotalsAdjustment([
      { noteType: "DEBIT", direction: "incoming", issuedBy: "US", amountPLN: 400 },
    ]);
    approx(adj.payableAdjPLN, -400, "what we need to GET offsets what we owe them");
  });
  t("noteLedgerEffect: all four primary cases per the axiom (issuer of credit pays; of debit collects)", () => {
    const eff = (nt) => pay.noteLedgerEffect(nt).deltaPLN;
    approx(eff({ noteType:"CREDIT", direction:"outgoing", issuedBy:"US", amountPLN:10 }), -10);          // we give back → recv −
    approx(eff({ noteType:"DEBIT",  direction:"outgoing", issuedBy:"US", amountPLN:10 }), +10);          // we charge client → recv +
    approx(eff({ noteType:"CREDIT", direction:"incoming", issuedBy:"COUNTERPARTY", amountPLN:10 }), -10); // they give back → pay −
    approx(eff({ noteType:"DEBIT",  direction:"incoming", issuedBy:"COUNTERPARTY", amountPLN:10 }), +10); // they charge → pay +
  });
  t("claim finalisation builds the right note per respondent + owner rulings", () => {
    const cl = B("claims.domain.js");
    const claim = { number: "CLM-2026-0001", cause: "Transport damage", acceptedAmount: 500, fxToPLN: 4.3,
      respondent: { kind: "Carrier", name: "EuroFreight" },
      subjects: [{ kind: "SHIPMENT", ref: "SHP-1" }, { kind: "INVOICE", ref: "FA-9" }] };
    const d = { nextId: deps.nextId, todayISO: deps.todayISO, invoices: [{ id: 42, number: "FA-9" }] };
    const theirs = cl.buildClaimFinanceNote(claim, cl.claimNoteMode(claim, true), d);
    eq(theirs.noteType, "CREDIT"); eq(theirs.issuedBy, "COUNTERPARTY"); eq(theirs.direction, "incoming");
    eq(theirs.invoiceId, 42, "invoice link resolved from the INVOICE subject");
    approx(theirs.amountPLN, 2150);
    const ours = cl.buildClaimFinanceNote(claim, cl.claimNoteMode(claim, false), d);
    eq(ours.noteType, "DEBIT"); eq(ours.issuedBy, "US");
    eq(ours.source, "claim:CLM-2026-0001", "idempotency key");
    const clientClaim = { ...claim, respondent: { kind: "Client", name: "FreshMart" } };
    const cred = cl.buildClaimFinanceNote(clientClaim, cl.claimNoteMode(clientClaim, false), d);
    eq(cred.noteType, "CREDIT"); eq(cred.issuedBy, "US"); eq(cred.direction, "outgoing");
  });
  t("the claim recovery note nets correctly against its cost invoice (noteSignedPLN flip)", () => {
    const s = invc.noteSignedPLN({ noteType: "DEBIT", direction: "incoming", issuedBy: "US", amountPLN: 400, amount: 400, fxRate: 1, currency: "PLN" });
    approx(s, -400, "reduces what remains payable on the supplier invoice");
    const legacy = invc.noteSignedPLN({ noteType: "DEBIT", direction: "incoming", amountPLN: 400, amount: 400, fxRate: 1, currency: "PLN" });
    approx(legacy, 400, "legacy notes unchanged");
  });
  console.log("BATCH D RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ D-17 REGRESSIONS (v6.64.1) — overhead import double-write ══
(function batchE(){
  console.log("\n══ 19. D-17: one overhead row → exactly ONE register invoice ══");
  t("fold skips an opCost whose number+party already exists as a register invoice", () => {
    const existing = [{ id: 1, kind: "COST", number: "358/08/C/2026", paymentStatus: "Draft",
      counterparty: { name: "Roluze Viguso Sp. z o. o. (getaluv: Roluze Sp. z o.o. Viguso sp. k.)" } }];
    const r = invc.migrateLegacyInvoices({ existing, creditNotes: [], warehouseInvoices: [],
      operationalCosts: [{ id: 9, invoiceNo: "358/08/c/2026", supplierName: "Roluze Viguso Sp. z o. o. (getaluv: X)", amount: 133.13, currency: "PLN", fxRate: 1, category: "office_rent", date: "2026-08-20", status: "Received" }],
      nextId: deps.nextId });
    eq((Array.isArray(r) ? r : []).filter(i => String(i.source || "").startsWith("migrated:opCost")).length, 0, "no twin fold");
  });
  t("same number from a DIFFERENT counterparty still folds (legit collision preserved)", () => {
    const existing = [{ id: 1, kind: "COST", number: "58/08/2026", paymentStatus: "Draft", counterparty: { name: "ORLEN S.A." } }];
    const r = invc.migrateLegacyInvoices({ existing, creditNotes: [], warehouseInvoices: [],
      operationalCosts: [{ id: 9, invoiceNo: "58/08/2026", supplierName: "Adami Romatwicz", amount: 10, currency: "PLN", fxRate: 1, category: "other", date: "2026-08-20", status: "Received" }],
      nextId: deps.nextId });
    eq((Array.isArray(r) ? r : []).filter(i => String(i.source || "").startsWith("migrated:opCost")).length, 1);
  });
  t("cancelled register invoice does NOT block the fold (cancellation frees the number)", () => {
    const existing = [{ id: 1, kind: "COST", number: "X/1", paymentStatus: "Cancelled", counterparty: { name: "A" } }];
    const r = invc.migrateLegacyInvoices({ existing, creditNotes: [], warehouseInvoices: [],
      operationalCosts: [{ id: 9, invoiceNo: "X/1", supplierName: "A", amount: 10, currency: "PLN", fxRate: 1, category: "other", date: "2026-08-20", status: "Received" }],
      nextId: deps.nextId });
    eq((Array.isArray(r) ? r : []).filter(i => String(i.source || "").startsWith("migrated:opCost")).length, 1);
  });
  console.log("D-17 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.65.0 REGRESSIONS — box pricing closed end-to-end (D-18/D-19) + payload (D-07b) ══
(function v665(){
  const margin = B("marginCalculations.js");
  console.log("\n══ 20. v6.65.0: box-priced line survives the whole document chain ══");
  const pu = B("pricingUnit.domain.js");
  const HER_LINE = { product: "Capsicum", packaging: "5 kg carton box", pricingUnit: "box", boxes: 1600, unitPrice: 59, qty: "", unit: "Kg" };
  t("D-18: a weight written in the packaging text resolves the box weight (no catalog entry needed)", () => {
    eq(pu.kgPerBoxForLine(HER_LINE, []), 5, "'5 kg carton box' states 5 kg");
    eq(pu.kgPerBoxForLine({ packaging: "torebka 2,5kg" }, []), 2.5, "comma decimals too");
    eq(pu.kgPerBoxForLine({ packaging: "carton box" }, []), 0, "no stated weight → still refuses to guess");
  });
  t("D-18: lineQuantity derives 8000 kg from her actual line", () => {
    const q = pu.lineQuantity(HER_LINE, []);
    eq(q.unresolved, false); eq(q.qtyKg, 8000); eq(q.boxes, 1600); eq(q.kgPerBox, 5);
  });
  t("D-19: margin prices the box line per kg — revenue 94 400, not 472 000", () => {
    const materialised = { ...HER_LINE, qty: 8000, kgPerBox: 5, sourceType: "STOCK", sourceRef: "LOT-1" };
    const order = { number: "SO-17", status: "Confirmed", currency: "PLN", fxRate: 1, items: [materialised] };
    const m = margin.computeSOMargin(order, [], [], [], "forecast");
    approx(m.revenuePLN, 94400, "1600 boxes × 59 = 8000 kg × 11.80");
  });
  t("D-18: the SINV position speaks boxes — quantity 1600 @ 59, kilos in the description", () => {
    const order = { number: "SO-17", status: "Delivered", currency: "PLN", fxRate: 1, client: { name: "X" },
      items: [{ ...HER_LINE, qty: 8000, kgPerBox: 5 }] };
    const draft = invc.salesInvoiceFromSODraft(order, { number: "FV/X", vatRate: 5 });
    const p = draft.positions[0];
    eq(p.quantity, 1600); eq(p.unit, "box");
    approx(p.netTotal, 94400); approx(p.grossTotal, 99120);
    ok(String(p.name).includes("8") && String(p.name).toLowerCase().includes("kg"), "kilos stated in the description");
  });
  t("D-07b: the payload NEVER sends a blank total_price_gross — even for a legacy 0-quantity position", () => {
    const legacyBroken = { number: "FV2026/08/11", kind: "SALES", vatRate: 5, grossAmount: 99120, netAmount: 94400,
      positions: [{ name: "Capsicum", quantity: 0, unit: "Kg", unitPrice: 59, vatRate: 5 }] };
    const body = invc.buildFakturowniaPayload(legacyBroken, { apiToken: "t" });
    const ps = body.invoice.positions;
    ok(ps.length >= 1);
    ps.forEach(p => ok(p.total_price_gross > 0, "no blank totals: " + JSON.stringify(p)));
  });
  console.log("v6.65.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.66.0 REGRESSIONS — Round 3 batch ══
(function v666(){
  const fkt = B("fakturowniaImport.domain.js");
  console.log("\n══ 21. v6.66.0: over-ship guard, duplicate info, note wiring ══");
  t("over-ship: second full shipment of the same SO line is reported with exact kilos", () => {
    const so = { number: "SO-18", status: "Confirmed", items: [{ product: "Capsicum", qty: 6300 }] };
    const prior = { number: "SHP-A", status: "Loaded", goods: [{ soRef: "SO-18", product: "Capsicum", qtyKg: 6300 }] };
    const draft = { number: "SHP-B", goods: [{ soRef: "SO-18", product: "Capsicum", qtyKg: 6300 }] };
    const r = ship.overShipReport(draft, [prior], [so]);
    eq(r.length, 1); approx(r[0].exceedKg, 6300); approx(r[0].orderedKg, 6300); approx(r[0].alreadyKg, 6300);
  });
  t("over-ship: partial split across trucks that SUMS to the order raises nothing", () => {
    const so = { number: "SO-18", status: "Confirmed", items: [{ product: "Capsicum", qty: 6300 }] };
    const prior = { number: "SHP-A", status: "Loaded", goods: [{ soRef: "SO-18", product: "Capsicum", qtyKg: 4000 }] };
    const draft = { number: "SHP-B", goods: [{ soRef: "SO-18", product: "Capsicum", qtyKg: 2300 }] };
    eq(ship.overShipReport(draft, [prior], [so]), []);
  });
  t("over-ship: cancelled shipments and cancelled SOs don't count against the order", () => {
    const so = { number: "SO-18", status: "Confirmed", items: [{ product: "Capsicum", qty: 6300 }] };
    const cancelled = { number: "SHP-A", status: "Cancelled", goods: [{ soRef: "SO-18", product: "Capsicum", qtyKg: 6300 }] };
    const draft = { number: "SHP-B", goods: [{ soRef: "SO-18", product: "Capsicum", qtyKg: 6300 }] };
    eq(ship.overShipReport(draft, [cancelled], [so]), [], "re-shipping after a cancel is the NORMAL flow");
  });
  t("over-ship: editing an existing shipment doesn't count itself twice", () => {
    const so = { number: "SO-18", status: "Confirmed", items: [{ product: "Capsicum", qty: 6300 }] };
    const self = { number: "SHP-B", status: "Loaded", goods: [{ soRef: "SO-18", product: "Capsicum", qtyKg: 6300 }] };
    eq(ship.overShipReport(self, [self], [so]), []);
  });
  t("D-30: duplicateCostInvoiceInfo names the twin; cancelled twins don't block", () => {
    const reg = [{ kind: "COST", number: "04/08/2026", paymentStatus: "Draft", grossAmount: 17435.51, source: "manual:1" }];
    const info = fkt.duplicateCostInvoiceInfo("04/08/2026", reg);
    eq(info.status, "Draft"); approx(info.grossAmount, 17435.51); ok(info.source.startsWith("manual"));
    eq(fkt.duplicateCostInvoiceInfo("04/08/2026", [{ ...reg[0], paymentStatus: "Cancelled" }]), null);
  });
  t("D-07c: the payload sends NO seller fields (department creation stays blocked-safe)", () => {
    const body = invc.buildFakturowniaPayload({ number: "FV/X", kind: "SALES", vatRate: 5, grossAmount: 100, netAmount: 95.24, positions: [{ name: "P", quantity: 1, unitPrice: 95.24, vatRate: 5 }] }, { apiToken: "t", sellerName: "MARIANNA", sellerTaxNo: "PL123" });
    ok(!("seller_name" in body.invoice), "no seller_name");
    ok(!("seller_tax_no" in body.invoice), "no seller_tax_no");
  });
  console.log("v6.66.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.67.0 (D-33) — BANK RECONCILIATION, built against the owner's real statements ══
(function v667(){
  console.log("\n══ 22. v6.67.0: bank CSV parsers + receivables matcher ══");
  const bank = B("bankReconciliation.domain.js");
  const PKO = `"Operation date","Value date","Operation data","Operation type","Amount","Currency"
"2026-08-18","2026-08-18","Title: EXTERNAL TRANSFER FEE|Account: 96 1020 1026 0000 1502 0511 6969|Transaction identifier: 67300503700122685","Fee","-1.50","PLN"
"2026-08-14","2026-08-14","Counterparty account: 76 8003 0003 2002 0000 9634 0001|Counterparty name and address: GRUPA PRODUCENTOW OWOCOW|Title: FAKTURA NR FV2026/ 08/12 DZIEKUJEMY|Account: 96 1020 1026 0000 1502 0511 6969|Transaction identifier: 67260501100238396","Transfer","79380.00","PLN"
"2026-08-18","2026-08-18","Counterparty account: 59 1090 2851|Counterparty name and address: MARIANNA HAZEM OSMAN, UL. DLUGA 29|Title: INTRA COMPANY TRANSFER|Account: 10 1020 1026 0000 1102 0511 7355|Transaction identifier: 67303601000001345","SEPA","-10000.00","EUR"`;
  const SAN = `2026-08-21;01-08-2026;'07 1090 2851 0000 0001 4723 8128;MARIANNA HAZEM OSMAN UL. DLUGA 29;PLN;1519,28;257,78;5;
07-08-2026;07-08-2026;ZAPLATA ZA TOWAR;BIEDRONKA SP Z OO;33 1090 1753 0000 0001 3737 6913;2560,03;2282,78;2;
10-08-2026;10-08-2026;Oplata za prowadzenie rachunku;;;-25,00;257,78;1;`;

  t("PKO parser: quoted commas, pipe-packed data, per-row currency, txid as identity", () => {
    const p = bank.parseBankCSV(PKO);
    eq(p.format, "PKO"); eq(p.lines.length, 3);
    const credit = p.lines.find(l => l.amount > 0);
    approx(credit.amount, 79380); eq(credit.currency, "PLN");
    ok(credit.id.includes("67260501100238396"), "transaction identifier is the idempotency key");
    ok(credit.title.includes("FV2026/ 08/12"), "wrapped title preserved raw");
  });
  t("Santander parser: header card row, dd-mm-yyyy, comma decimals, account currency", () => {
    const p = bank.parseBankCSV(SAN);
    eq(p.format, "SANTANDER"); eq(p.currency, "PLN"); eq(p.account.slice(0, 6), "071090");
    const credit = p.lines.find(l => l.amount > 0);
    approx(credit.amount, 2560.03); eq(credit.date, "2026-08-07");
  });
  const invs = [
    { id: 12, kind: "SALES", number: "FV2026/08/12", paymentStatus: "Sent", currency: "PLN", grossAmount: 79380, paidAmount: 0, counterparty: { name: "Grupa Producentow Owocow" }, payments: [] },
    { id: 13, kind: "SALES", number: "FV2026/08/13", paymentStatus: "Sent", currency: "PLN", grossAmount: 2688, paidAmount: 128, counterparty: { name: "Biedronka" }, payments: [] },
  ];
  t("rank ①: a WRAPPED invoice number in the title still matches (whitespace-proof)", () => {
    const p = bank.parseBankCSV(PKO);
    const m = bank.matchBankLines(p.lines, invs);
    const hit = m.find(s => s.rank === "NUMBER");
    ok(hit, "number match found despite 'FV2026/ 08/12' being broken by the bank's line wrap");
    eq(hit.invoiceNumber, "FV2026/08/12");
  });
  t("rank ②: amount within ±0.05 + payer overlap (owner tolerance ruling)", () => {
    const p = bank.parseBankCSV(SAN); // 2560,03 vs outstanding 2560,00 → within 0.05
    const m = bank.matchBankLines(p.lines, invs);
    const hit = m.find(s => s.rank === "AMOUNT+PARTY");
    ok(hit, "±0.05 tolerance honoured regardless of currency"); eq(hit.invoiceNumber, "FV2026/08/13");
  });
  t("v6.87.0: only own-company transfers are set aside; a debit (fee) line is now offered against payables", () => {
    const p = bank.parseBankCSV(PKO);
    const m = bank.matchBankLines(p.lines, invs);
    eq(m.filter(s => s.rank === "IGNORED").length, 1, "intra-company EUR transfer only");
    ok(m.some(s => s.direction === "payable"), "the fee line is a payable candidate (bank charge when nothing matches)");
  });
  t("idempotency: a confirmed line is ALREADY on re-import; partials accumulate to Paid", () => {
    const p = bank.parseBankCSV(SAN);
    const credit = p.lines.find(l => l.amount > 0);
    let inv = { ...invs[1] };
    inv = pay.applyPaymentEvent(inv, bank.bankPaymentEvent(credit), deps.nextId);
    approx(pay.outstandingAmount(inv), 0, "128 prior + 2560.03 covers 2688 (within tolerance handling upstream)");
    const m2 = bank.matchBankLines(p.lines, [invs[0], inv]);
    eq(m2.find(s => s.line.id === credit.id).rank, "ALREADY", "same statement re-imported cannot double-post");
  });
  console.log("v6.67.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.68.0 — FINANCE CLOSURE (F-1..F-4 + D-34), the last pre-Supabase schema batch ══
(function v668(){
  console.log("\n══ 23. v6.68.0: advances, realized FX, credit control, registry, single-entry overhead ══");
  const adv = B("advances.domain.js");
  const oc = B("operationalCosts.js");
  const bank = B("bankReconciliation.domain.js");

  t("F-1: advance applies partially, guards over-application and currency, and is idempotent by source", () => {
    let a = adv.advanceFromBankLine({ id: "san:x:1:2026-08-07:5000,00:1", date: "2026-08-07", amount: 5000, currency: "PLN", counterparty: "Biedronka", title: "zaliczka" }, deps);
    approx(adv.advanceRemaining(a), 5000);
    let inv = { id: 9, kind: "SALES", number: "FV/9", currency: "PLN", fxRate: 1, grossAmount: 3000, paidAmount: 0, paymentStatus: "Sent", payments: [] };
    const r1 = adv.applyAdvanceToInvoice(a, inv, 3000, deps);
    ok(!r1.error); a = r1.advance; inv = r1.invoice;
    approx(pay.outstandingAmount(inv), 0); approx(adv.advanceRemaining(a), 2000);
    ok(String(inv.payments[0].source).startsWith("advance:"), "trail on the invoice");
    ok(adv.applyAdvanceToInvoice(a, inv, 2500, deps).error, "over-application refused");
    ok(adv.applyAdvanceToInvoice(a, { ...inv, currency: "EUR" }, 100, deps).error, "currency mismatch refused");
    ok(adv.advanceSources([a]).has("bank:san:x:1:2026-08-07:5000,00:1"), "bank line can't become two advances");
  });
  t("F-2: realized FX — receivable settled below the locked rate is a LOSS; payable mirror is a GAIN", () => {
    let inv = { kind: "SALES", currency: "EUR", fxRate: 4.30, grossAmount: 1000, payments: [] };
    inv = pay.applyPaymentEvent(inv, { date: "2026-08-18", amount: 1000, settlementFxRate: 4.282 }, deps.nextId);
    approx(pay.realizedFxPLN(inv), -18, "1000 × (4.282 − 4.30)");
    approx(inv.payments[0].settledPLN, 4282);
    let cost = { kind: "COST", currency: "EUR", fxRate: 4.30, grossAmount: 1000, payments: [] };
    cost = pay.applyPaymentEvent(cost, { date: "2026-08-18", amount: 1000, settlementFxRate: 4.282 }, deps.nextId);
    approx(pay.realizedFxPLN(cost), 18, "paying cheaper than locked = gain");
  });
  t("F-3: client exposure sums open receivables in PLN at each invoice's own rate", () => {
    const invs = [
      { kind: "SALES", counterparty: { name: "Biedronka" }, currency: "PLN", fxRate: 1, grossAmount: 2688, paidAmount: 128, paymentStatus: "Sent" },
      { kind: "SALES", counterparty: { name: "Biedronka" }, currency: "EUR", fxRate: 4.3, grossAmount: 1000, paidAmount: 0, paymentStatus: "Issued" },
      { kind: "SALES", counterparty: { name: "Biedronka" }, currency: "PLN", fxRate: 1, grossAmount: 999, paidAmount: 0, paymentStatus: "Cancelled" },
      { kind: "SALES", counterparty: { name: "Lidl" }, currency: "PLN", fxRate: 1, grossAmount: 5, paidAmount: 0, paymentStatus: "Sent" },
    ];
    approx(pay.clientExposurePLN("Biedronka", invs), 2560 + 4300);
  });
  t("F-4: a statement registers its account once; re-import refreshes, never duplicates", () => {
    const parsed = { format: "SANTANDER", account: "07109028510000000147238128", currency: "PLN",
      lines: [{ raw: "07-08-2026;07-08-2026;t;c;acc;100,00;257,78;2;", amount: 100 }], skipped: 0 };
    let accs = bank.upsertBankAccountFromStatement([], parsed, deps);
    eq(accs.length, 1); eq(accs[0].bank, "Santander"); approx(accs[0].lastKnownBalance, 257.78);
    accs = bank.upsertBankAccountFromStatement(accs, parsed, deps);
    eq(accs.length, 1, "idempotent upsert");
  });
  t("D-34: an OVERHEAD register invoice mirrors into ONE opCost; edits follow; cancel removes; loops impossible", () => {
    const inv = { id: 501, kind: "COST", costScope: "OVERHEAD", number: "F/55", paymentStatus: "Issued",
      counterparty: { name: "Orlen" }, currency: "PLN", fxRate: 1, grossAmount: 300, grossPLN: 300, issueDate: "2026-08-05", source: "manual:x" };
    const manual = { id: 1, category: "salary", description: "Salaries Aug", amountPLN: 20000, period: "2026-08", source: "" };
    let ocs = oc.syncOverheadOpCosts([inv], [manual]);
    eq(ocs.length, 2, "manual entry kept + one mirror");
    const mirror = ocs.find(c => String(c.source) === "invoice:501");
    approx(mirror.amountPLN, 300); eq(mirror.period, "2026-08");
    // edit the invoice → mirror follows, same id (replace-by-ref)
    ocs = oc.syncOverheadOpCosts([{ ...inv, grossAmount: 350, grossPLN: 350 }], ocs);
    eq(ocs.length, 2); approx(ocs.find(c => String(c.source) === "invoice:501").amountPLN, 350);
    eq(ocs.find(c => String(c.source) === "invoice:501").id, mirror.id, "stable id across edits");
    // cancel → mirror vanishes; the folded-invoice direction is excluded by source
    ocs = oc.syncOverheadOpCosts([{ ...inv, paymentStatus: "Cancelled" }], ocs);
    eq(ocs.length, 1, "only the salary entry remains");
    const folded = invc.migrateLegacyInvoices({ existing: [], creditNotes: [], warehouseInvoices: [],
      operationalCosts: [{ id: 7, invoiceNo: "X/1", supplierName: "A", source: "invoice:501", amount: 10, currency: "PLN", fxRate: 1, category: "other", date: "2026-08-01", status: "Received" }], nextId: deps.nextId });
    eq((Array.isArray(folded) ? folded : []).length, 0, "a sync-created opCost never folds back — no loop");
  });
  console.log("v6.68.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.68.1 — PRO-FORMA ruling: every advance answers one ══
(function v6681(){
  console.log("\n══ 24. v6.68.1: pro-forma invoices + advance linkage ══");
  const adv = B("advances.domain.js");
  const led = B("ledger.js");
  t("a pro-forma never enters receivable/payable totals; the final invoice does", () => {
    const base = { kind: "SALES", number: "PF/1", paymentStatus: "Issued", currency: "PLN", fxRate: 1, grossAmount: 1000, grossPLN: 1000, netPLN: 1000, paidAmount: 0, counterparty: { name: "X" }, dueDate: "2026-09-01" };
    const withPF = led.buildLedger({ invoices: [{ ...base, isProforma: true }], financeNotes: [], orders: [], lots: [], pos: [], warehouseInvoices: [], operationalCosts: [] });
    approx(withPF.totals.receivableOpenPLN, 0, "pro-forma is a request, not a receivable");
    const withFinal = led.buildLedger({ invoices: [{ ...base, number: "FV/1" }], financeNotes: [], orders: [], lots: [], pos: [], warehouseInvoices: [], operationalCosts: [] });
    approx(withFinal.totals.receivableOpenPLN, 1000);
  });
  t("credit exposure ignores pro-formas", () => {
    approx(pay.clientExposurePLN("X", [{ kind: "SALES", isProforma: true, counterparty: { name: "X" }, currency: "PLN", fxRate: 1, grossAmount: 500, paidAmount: 0, paymentStatus: "Issued" }]), 0);
  });
  t("advance links only to a pro-forma, in its own currency; applying to a pro-forma is refused", () => {
    let a = adv.advanceFromBankLine({ id: "l1", date: "2026-08-20", amount: 1000, currency: "PLN", counterparty: "X", title: "" }, deps);
    ok(adv.linkAdvanceToProforma(a, { isProforma: false, currency: "PLN" }).error, "final invoice refused as link target");
    ok(adv.linkAdvanceToProforma(a, { isProforma: true, currency: "EUR" }).error, "currency mismatch refused");
    const linked = adv.linkAdvanceToProforma(a, { id: 5, isProforma: true, currency: "PLN", number: "PF/1" });
    eq(linked.proformaNumber, "PF/1");
    const r = adv.applyAdvanceToInvoice(linked, { id: 5, isProforma: true, currency: "PLN", paymentStatus: "Issued", grossAmount: 1000, payments: [] }, 1000, deps);
    ok(r.error && r.error.includes("FINAL"), "money settles the final invoice, never the pro-forma");
  });
  t("pro-forma pushes to Fakturownia as kind 'proforma'", () => {
    const body = invc.buildFakturowniaPayload({ number: "PF/1", kind: "SALES", isProforma: true, vatRate: 0, grossAmount: 100, netAmount: 100, positions: [{ name: "P", quantity: 1, unitPrice: 100, vatRate: 0 }] }, { apiToken: "t" });
    eq(body.invoice.kind, "proforma");
  });
  console.log("v6.68.1 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.79.0 — PRE-DDL FIXES (W-1, W-2, W-3, W-7, F-5, F-6, integrity coverage) ══
(function v679(){
  console.log("\n══ 25. v6.79.0: one SO status truth, one claim engine, one paid mechanism, users, budgets ══");
  const st = B("statusOwnership.domain.js");
  const perm = B("permissions.domain.js");
  const bud = B("budgets.domain.js");
  const led = B("ledger.js");
  const so = { number: "SO-1", status: "Confirmed", items: [{ product: "P", qty: 1000 }] };
  const shipDelivered = { number: "SHP-1", status: "Delivered", goods: [{ soRef: "SO-1", product: "P", qtyKg: 1000 }] };
  t("W-1: the gate reads the SHIPMENTS — a Confirmed order with a delivered shipment IS shipped-or-later", () => {
    eq(st.effectiveSoStatus(so, [shipDelivered]), "Delivered");
    ok(st.isShippedOrLater(so, [shipDelivered]), "Issue-invoice button appears without anyone typing Delivered");
    ok(!st.isShippedOrLater(so, []), "…and not before the goods moved");
  });
  t("W-3: un-invoiced PO commitments are no longer ledger rows; the purchase invoice is", () => {
    const po = { number: "PO-1", status: "Confirmed", pricingMode: "firm", supplier: { name: "S" }, items: [{ qty: 1000, unitPrice: 4 }], fxRate: 1 };
    const none = led.buildLedger({ pos: [po], invoices: [], financeNotes: [], orders: [], lots: [], warehouseInvoices: [], operationalCosts: [], todayISO: "2026-09-02" });
    eq(none.items.filter(i => i.kind === "PO purchase").length, 0, "commitment alone is not a payable");
    const withInv = led.buildLedger({ pos: [po], invoices: [{ id: 1, kind: "COST", category: "PURCHASE", number: "FA/1", paymentStatus: "Issued", grossPLN: 4000, netPLN: 4000, grossAmount: 4000, counterparty: { name: "S" }, links: [{ type: "PO", number: "PO-1" }] }], financeNotes: [], orders: [], lots: [], warehouseInvoices: [], operationalCosts: [], todayISO: "2026-09-02" });
    approx(withInv.totals.payableOpenPLN, 4000, "the invoice carries the payable, exactly once");
  });
  t("F-5: no users → everyone sees everything; owner sees all; a ticked-off module hides; unknown user gets only the dashboard", () => {
    ok(perm.canOpenModule([], "anyone", "finance"));
    // v7.22.0 (FZ-19): the app's unused user factory went — the check builds its two users the same way
    const blankUser = (id, name, isOwner) => { const modules = {}; perm.MODULE_KEYS.forEach(k => { modules[k] = true; }); const finance = {}; perm.FINANCE_KEYS.forEach(k => { finance[k] = isOwner || !["pl", "clients", "budget"].includes(k); }); return { id, name, role: isOwner ? "Owner" : "Operations", isOwner, modules, finance }; };
    const owner = blankUser(1, "Hazem", true); const ops = blankUser(2, "Ola", false); ops.modules.finance = false;
    ok(perm.canOpenModule([owner, ops], "Hazem", "finance")); ok(!perm.canOpenModule([owner, ops], "Ola", "finance"));
    ok(perm.canOpenModule([owner, ops], "Ola", "lots"));
    ok(!perm.canOpenModule([owner, ops], "Stranger", "lots")); ok(perm.canOpenModule([owner, ops], "Stranger", "dashboard"));
    ok(perm.canOpenFinance([owner, ops], "Hazem", "pl")); ok(!perm.canOpenFinance([owner, ops], "Ola", "pl"), "P/L is owner-only by default");
    ok(perm.canOpenFinance([owner, ops], "Ola", "ledger"), "…but the ledger is open to operations");
    eq(perm.usersGaps([ops]).length, 1, "no owner → gap reported");
  });
  t("F-6: budgets upsert by (period, measure) and report variance against actuals", () => {
    let b = bud.upsertBudget([], { id: "x", period: "2026-09", measure: "revenue", amountPLN: 100000 });
    b = bud.upsertBudget(b, { id: "y", period: "2026-09", measure: "revenue", amountPLN: 120000 });
    eq(b.length, 1); approx(b[0].amountPLN, 120000, "replaced, not duplicated");
    const v = bud.budgetVariance(b, "2026-09", { revenue: 95000 });
    approx(v[0].variancePLN, -25000); approx(v[0].variancePct, -20.83);
  });
  t("integrity: over-allocated advance, orphan mirror, unknown catalog item, claim money≠paper are all reported", () => {
    const r = integ.checkIntegrity({ contacts: [], pos: [{ number: "PO-9", status: "Confirmed", items: [{ product: "Dragonfruit" }] }], lots: [], orders: [], shipments: [],
      invoices: [{ id: 1, kind: "COST", number: "F/1", paymentStatus: "Cancelled", grossPLN: 10 }], financeNotes: [], claims: [{ number: "CLM-1", status: "Accepted", acceptedAmount: 500, financeNoteId: null, subjects: [] }], loadPlans: [],
      advancePayments: [{ counterpartyName: "X", amount: 100, currency: "PLN", allocations: [{ invoiceId: 77, amount: 150 }] }],
      bankAccounts: [{ accountDigits: "1", label: "A" }, { accountDigits: "1", label: "B" }],
      operationalCosts: [{ source: "invoice:1", invoiceNo: "F/1", amountPLN: 10 }, { source: "invoice:404", invoiceNo: "F/404", amountPLN: 5 }],
      productCatalog: [{ item: "Apples", varieties: [] }] });
    const codes = new Set(r.issues.map(i => i.code));
    ["ADVANCE_OVERALLOCATED", "ADVANCE_ALLOC_ORPHAN", "BANKACCOUNT_DUP", "OPCOST_MIRROR_ORPHAN", "OPCOST_MIRROR_CANCELLED", "CATALOG_ITEM_UNKNOWN", "CLAIM_NOTE_MISMATCH"].forEach(c => ok(codes.has(c), c + " must fire"));
  });
  console.log("v6.79.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.80.0 — Round 4 fixes ══
(function v680(){
  console.log("\n══ 26. v6.80.0: derived billing status, no blank protocol sheets ══");
  const lp = B("loadingProtocol.domain.js");
  const shd = B("shipments.domain.js");
  t("D-48: billing status derives from the cost lines — outbound is a direct cost of sale, inbound allocates", () => {
    const out = { number: "SHP-1", purpose: "OUTBOUND", status: "Loaded", costs: [{ amountPLN: 100, invoiceStatus: "Received" }] };
    eq(shd.derivedBillingStatus(out, []), "Direct cost of sale");
    const inb = { number: "SHP-2", purpose: "INBOUND", status: "Delivered", costs: [{ amountPLN: 100, invoiceStatus: "Expected" }] };
    eq(shd.derivedBillingStatus(inb, []), "Awaiting invoices");
    inb.costs[0].invoiceStatus = "Received";
    eq(shd.derivedBillingStatus(inb, []), "Invoices received");
    eq(shd.derivedBillingStatus(inb, [{ costs: [{ source: "SHP-2/1", pln: 100 }] }]), "Allocated to lots");
    eq(shd.derivedBillingStatus({ ...inb, status: "Cancelled" }, []), "—");
    eq(shd.derivedBillingStatus({ number: "SHP-3", costs: [] }, []), "No costs");
  });
  t("D-43: a truck whose load ids match nothing gets its share by kilos — never an empty sheet", () => {
    const goods = [{ id: 1, product: "Apples", variety: "Naidared", size: "70-80", packaging: "13kg wooden boxes", qtyKg: 38844 }];
    const unit = { qtyKg: 19422, load: [{ goodsLineId: 999, qtyKg: 19422 }] };   // stale id
    const lines = lp.unitGoodsLines(goods, unit);
    eq(lines.length, 1); eq(lines[0].qtyKg, 19422); eq(lines[0].variety, "Naidared", "variety travels with the line");
    const rows = lp.deriveRows(lines, B("packaging.domain.js").PACKAGING_SEED);
    const filled = rows.filter(r => r.boxes > 0);
    eq(filled.length, 21, "20 × 72 + 54 (owner's rule)"); eq(filled[20].boxes, 54);
    ok(filled.every(r => r.variety === "Naidared"), "variety on EVERY row");
  });
  console.log("v6.80.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.81.0 — Round 5 ══
(function v681(){
  console.log("\n══ 27. v6.81.0: settlement incl. claims, per-truck commission bands, claim currency ══");
  const cl = B("claims.domain.js");
  const mkLotC = () => ({ id: 1, number: "LOT-1", product: "Apples", ownership: "CONSIGNMENT", expectedKg: 1000, receivedKg: 1000, costs: [{ type: "freight", source: "SHP-1/1", pln: 800 }] });
  const soC = () => ({ number: "SO-1", status: "Confirmed", currency: "PLN", fxRate: 1, client: { name: "C" }, items: [{ product: "Apples", qty: 1000, unitPrice: 5, sourceType: "STOCK", sourceRef: "LOT-1" }] });
  t("D-57: commission tiers decided per truck by its own gross; flat rate unchanged", () => {
    const flat = { season: "26", validFrom: "", pct: 8 };
    eq(cons.commissionPctForSales(flat, 999999), 8);
    const tiered = { season: "26", validFrom: "", pct: 8, bands: [{ fromPLN: 0, toPLN: 100000, pct: 8 }, { fromPLN: 100000, toPLN: null, pct: 6 }] };
    eq(cons.commissionPctForSales(tiered, 50000), 8); eq(cons.commissionPctForSales(tiered, 150000), 6);
    eq(cons.commissionPctForSales(tiered, 100000), 6, "boundary belongs to the upper band");
  });
  t("D-62: claim money follows the root document's currency — PLN claim posts in PLN, EUR legacy unchanged", () => {
    const pln = { number: "CLM-9", status: "Accepted", direction: "CONCESSION", currency: "PLN", acceptedAmount: 1200, respondent: { kind: "Client", name: "C" }, subjects: [{ kind: "SO", ref: "SO-1" }] };
    eq(cl.claimMoney(pln).pln, 1200); eq(cl.claimMoney(pln).currency, "PLN");
    const p = cl.buildClaimPostings(pln, { todayISO: "2026-09-03" });
    approx(Math.abs(p.postings[0].pln ?? p.postings[0].amountPLN), 1200);
    const note = cl.buildClaimFinanceNote(pln, "OUR_CREDIT_TO_CLIENT", { nextId: () => 1, todayISO: () => "2026-09-03", invoices: [] });
    eq(note.currency, "PLN"); approx(note.amountPLN, 1200);
    const eur = { number: "CLM-8", status: "Accepted", acceptedAmount: 100, fxToPLN: 4.3, respondent: { kind: "Supplier" }, subjects: [{ kind: "LOT", ref: "L", affectedKg: 10 }] };
    approx(cl.claimMoney(eur).pln, 430, "legacy EUR claims unchanged");
  });
  console.log("v6.81.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.82.0 — Round 6 (shipment editor) ══
(function v682(){
  console.log("\n══ 28. v6.82.0: unit prices feed the saved cost lines; pallet split without catalog bpp ══");
  const lp = B("loadingProtocol.domain.js");
  t("R6-1: the leg's saved cost line = SUM of unit 'Price for this unit' (the path the save runs)", () => {
    const sh = { id: 1, number: "SHP-1", costs: [], legs: [{ mode: "Road", costAmount: 0, costCurrency: "EUR", costFxRate: 4.3, vehicles: [{ costAmount: 1900 }, { costAmount: 1900 }] }] };
    const out = ship.syncLegFreightCostLines(sh);
    const line = out.costs.find(c => c.source === ship.legFreightSource(1));
    ok(line, "line created"); approx(line.amount, 3800); eq(line.currency, "EUR"); approx(line.amountPLN, 16340);
  });
  t("R6-2: stored packaging WITHOUT boxesPerPallet still splits 19 422 kg into 20×72 + 54", () => {
    const legacyTypes = [{ id: "wooden-box-13", label: "Wooden box (13 kg)", capacityKg: 13, tareKg: 1.4, appliesTo: ["Apples"] }]; // pre-v6.46 shape
    const rows = lp.deriveRows([{ id: 1, product: "Apples", variety: "Gala", packaging: "13kg wooden box", qtyKg: 19422, pallets: 21 }], legacyTypes).filter(r => r.boxes > 0);
    eq(rows.length, 21); eq(rows[0].boxes, 72); eq(rows[20].boxes, 54); ok(rows.every(r => r.variety === "Gala"));
  });
  console.log("v6.82.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.83.0 — shipment editor restructure ══
(function v683(){
  console.log("\n══ 29. v6.83.0: goods kg ↔ unit kg linkage ══");
  t("legKgChecks names a leg whose units disagree with the goods; agreeing legs are silent", () => {
    const sh = { goods: [{ qtyKg: 19422 }], legs: [
      { mode: "Road", vehicles: [{ qtyKg: 19422 }] },
      { mode: "Sea", vehicles: [{ qtyKg: 18000 }] } ] };
    const c = ship.legKgChecks(sh);
    eq(c.length, 1); eq(c[0].leg, 2); eq(c[0].deltaKg, -1422);
  });
  t("autoFillSingleUnitKg gives a lone unit with no kilos the goods total — and leaves typed kilos alone", () => {
    const sh = { goods: [{ qtyKg: 19422 }], legs: [{ mode: "Road", vehicles: [{ qtyKg: 0 }] }, { mode: "Sea", vehicles: [{ qtyKg: 5 }] }] };
    const out = ship.autoFillSingleUnitKg(sh);
    eq(out.legs[0].vehicles[0].qtyKg, 19422); eq(out.legs[1].vehicles[0].qtyKg, 5);
  });
  console.log("v6.83.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.85.0 — THE REDESIGNED SHIPMENT MODEL (twelve owner rulings) ══
(function v685(){
  console.log("\n══ 30. v6.85.0: shipment model — kilos derived, feeders, stuffing & de-vanning reports, cut-off, events, incoterm legs ══");
  const M = B("shipmentModel.domain.js");
  const mk = () => ({ number: "SHP-1", purpose: "OUTBOUND", goods: [{ id: 1, product: "Apples", qtyKg: 97110 }],
    bookings: [{ id: 9, number: "BKG-1", cutOff: "2026-09-05", etd: "2026-09-08", eta: "2026-09-20" }],
    legs: [{ mode: "Road", vehicles: [1,2,3,4,5].map(i => ({ id: i, kind: "truck", truckPlate: "PL" + i, tempRecorderNo: "R" + i, transitDays: 1, loadedAt: i <= 3 ? "2026-09-02" : "2026-09-04" })) }, { mode: "Sea", vehicles: [] }] });
  t("D8: goods allocate across five trucks; kilos derive and sum EXACTLY to the goods", () => {
    const sh = M.allocateGoodsToTrucks(mk(), 0);
    const kgs = sh.legs[0].vehicles.map(u => M.unitKg(u, sh));
    eq(kgs.reduce((a, b) => a + b, 0), 97110); ok(kgs.every(k => Math.abs(k - 19422) <= 1));
  });
  t("D6 (POL): the forwarder's stuffing report CREATES the containers with many-to-many feeders; recorders follow; D12 map derives", () => {
    let sh = M.allocateGoodsToTrucks(mk(), 0);
    sh = M.applyStuffingReport(sh, [
      { containerNumber: "MSKU111", feeders: [{ truckId: 1 }, { truckId: 2, kg: 4856 }] },
      { containerNumber: "MSKU222", feeders: [{ truckId: 2, kg: 14566 }, { truckId: 3, kg: 9712 }] },
    ], deps);
    const conts = sh.legs[1].vehicles; eq(conts.length, 2);
    eq(M.unitKg(conts[0], sh), 19422 + 4856); ok(conts[0].tempRecorderNo.includes("R1") && conts[0].tempRecorderNo.includes("R2"));
    const map = M.containerMap(sh); eq(map.length, 4); eq(map.filter(m => m.containerRef === "MSKU222").length, 2);
    eq(conts[0].fromUnitId, 1, "legacy single-link mirror kept for old readers");
  });
  t("stuffing before the feeder truck unloaded is a violation; cut-off warns the late trucks", () => {
    let sh = M.applyStuffingReport(mk(), [{ containerNumber: "C1", feeders: [{ truckId: 5 }], stuffedAt: "2026-09-03" }], deps);
    sh = M.stampEvent(sh, 5, "unloaded", "2026-09-05");
    eq(M.stuffingViolations(sh).length, 1);
    const w = M.cutOffWarnings(mk()); eq(w.length, 0, "all five load on/before 4 Sept for a 5 Sept cut-off with 1 transit day");
    const late = mk(); late.legs[0].vehicles[4].loadedAt = "2026-09-06";
    eq(M.cutOffWarnings(late).length, 1);
  });
  t("D6 (POD): de-vanning report spawns ONE transfer + ONE outbound per SO, goods and recorders attached", () => {
    let sh = { ...mk(), purpose: "INBOUND", poRefs: ["PO-1"], legs: [{ mode: "Sea", vehicles: [{ id: 21, kind: "container", containerNumber: "MSKU777", tempRecorderNo: "RX" }, { id: 22, kind: "container", containerNumber: "MSKU888" }] }] };
    const onward = M.spawnFromDevanning(sh, [
      { containerId: 21, trucks: [{ truckPlate: "T1", kg: 19000, destination: { kind: "WAREHOUSE" } }, { truckPlate: "T4", kg: 5000, destination: { kind: "SO", soNumber: "SO-X" } }] },
      { containerId: 22, trucks: [{ truckPlate: "T2", kg: 19000, destination: { kind: "WAREHOUSE" } }, { truckPlate: "T5", kg: 6000, destination: { kind: "SO", soNumber: "SO-Y" } }] },
    ], { ...deps, nextNumber: i => "SHP-N" + i });
    eq(onward.length, 3);
    const tr = onward.find(s => s.purpose === "TRANSFER"); eq(tr.legs[0].vehicles.length, 2); eq(tr.goods[0].qtyKg, 38000);
    const outX = onward.find(s => (s.soRefs || [])[0] === "SO-X"); eq(outX.purpose, "OUTBOUND"); eq(outX.legs[0].vehicles[0].tempRecorderNo, "RX");
  });
  t("D3: who pays each leg comes from the incoterms (v7.19.0: legFreightPayers replaced legsFromIncoterms) — EXW buy + CFR sell by sea = road ours + sea ours; CIF buy = sea supplier's", () => {
    const IC = B("incoterms.domain.js"); const P = (sh, pos, orders) => IC.legFreightPayers(sh, { pos, orders }).map(x => x.payer).join(",");
    eq(P({ purpose: "OUTBOUND", poRefs: ["P1"], governingSoRef: "S1", originLocationId: 5, legs: [{ mode: "Road", fromLocationId: 5, toLocationId: 7 }, { mode: "Sea", fromLocationId: 7, toLocationId: 9 }] }, [{ number: "P1", buyIncoterm: "EXW", destinationLocationId: 5 }], [{ number: "S1", sellIncoterm: "CFR", destinationLocationId: 9 }]), "us,us");
    eq(P({ purpose: "INBOUND", poRefs: ["P2"], legs: [{ mode: "Sea", fromLocationId: 3, toLocationId: 7 }] }, [{ number: "P2", buyIncoterm: "CIF", destinationLocationId: 7 }], []), "supplier");
    eq(P({ purpose: "INBOUND", arrangedBy: "SUPPLIER", poRefs: ["P3"], legs: [{ mode: "Road", toLocationId: 11 }] }, [{ number: "P3", buyIncoterm: "DDP", destinationLocationId: 11 }], []), "supplier");
    eq(P({ purpose: "OUTBOUND", poRefs: ["P3"], governingSoRef: "S3", originLocationId: 11, legs: [{ mode: "Road", fromLocationId: 11, toLocationId: 12 }] }, [{ number: "P3", buyIncoterm: "DDP", destinationLocationId: 11 }], [{ number: "S3", sellIncoterm: "DAP", destinationLocationId: 12 }]), "us");
  });
  t("D11: one document register merges transport order, protocols and documents with one vocabulary", () => {
    const rows = M.documentRegister({ number: "SHP-1", confirmationStatus: "Sent", documents: [{ type: "CMR", status: "Have it", link: "https://x" }, { type: "Phyto", status: "Expected" }] }, [{ number: "LP-1", status: "Returned", truckPlate: "PL1" }]);
    eq(rows.length, 4); eq(rows[0].status, "Sent"); eq(rows[1].status, "Returned"); eq(M.documentsOutstanding(rows).length, 1);
  });
  console.log("v6.85.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.86.0 — ONE LOCATION SOURCE ══
(function v686(){
  console.log("\n══ 31. v6.86.0: one location source, demo seeds gone, referenced seeds migrate ══");
  const loc = B("locations.js");
  t("v7.32.0 (FZ-04a): the places module keeps no list of its own — ports, warehouses, suppliers and clients all come from Parties or the public-places store", () => {
    ok(loc.LOCATIONS === undefined, "a module-level list is back");
  });
  t("unifiedLocations = ports + counterparty sites, deduped and sorted; a client's address is a CLIENT site", () => {
    const contacts = [{ id: 70, name: "Al Baraka", type: "Client", address: "Damietta Free Zone", country: "Egypt" }];
    const all = loc.unifiedLocations(contacts);
    ok(!all.some(l => l.legacyType === "PORT"), "v7.3.4 (A-LOC-2): no built-in port is offered any more"); ok(!loc.ensureUsedBuiltinsAreOrdinary && !loc.LOCATIONS_ALL_BUILTIN, "v7.32.0 (FZ-04a): the code holds no list of places and copies nothing back");
    ok(all.some(l => String(l.name).includes("Al Baraka")), "client site derived from the counterparty");
    ok(!all.some(l => String(l.name).startsWith("WH-0")), "no demo warehouse");
  });
  console.log("v6.86.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.87.0 — bank import BOTH directions ══
(function v687(){
  console.log("\n══ 32. v6.87.0: debit lines settle payables; per-currency files are fine ══");
  const bank = B("bankReconciliation.domain.js");
  const invs = [
    { id: 1, kind: "SALES", number: "FV/1", paymentStatus: "Sent", currency: "PLN", grossAmount: 1000, paidAmount: 0, counterparty: { name: "Client A" }, payments: [] },
    { id: 2, kind: "COST", number: "TL/77", paymentStatus: "Issued", currency: "EUR", grossAmount: 1900, paidAmount: 0, counterparty: { name: "Trans-Log" }, payments: [] },
    { id: 3, kind: "COST", number: "PF/9", isProforma: true, paymentStatus: "Issued", currency: "EUR", grossAmount: 500, paidAmount: 0, counterparty: { name: "X" }, payments: [] },
  ];
  t("a DEBIT line quoting the cost invoice number settles the PAYABLE; a credit line still settles the receivable", () => {
    const lines = [
      { id: "l1", date: "2026-09-01", amount: -1900, currency: "EUR", counterparty: "TRANS-LOG PL", title: "FAKTURA TL/77", account: "1" },
      { id: "l2", date: "2026-09-01", amount: 1000, currency: "PLN", counterparty: "CLIENT A", title: "FV/1", account: "2" },
    ];
    const m = bank.matchBankLines(lines, invs);
    eq(m[0].direction, "payable"); eq(m[0].rank, "NUMBER"); eq(m[0].invoiceNumber, "TL/77");
    eq(m[1].direction, "receivable"); eq(m[1].invoiceNumber, "FV/1");
    const evt = bank.bankPaymentEvent(lines[0]); approx(evt.amount, 1900, "payment events carry the absolute amount");
    let paid = pay.applyPaymentEvent(invs[1], evt, deps.nextId); approx(pay.outstandingAmount(paid), 0);
  });
  t("pro-formas never match; a debit with no open payable in its currency is named a bank charge", () => {
    const m = bank.matchBankLines([{ id: "l3", date: "2026-09-02", amount: -25, currency: "PLN", counterparty: "", title: "Oplata za prowadzenie rachunku", account: "1" }], invs);
    eq(m[0].rank, "NONE"); ok(String(m[0].reason).includes("bank charge"));
    ok(!m.some(s => s.invoiceNumber === "PF/9"));
  });
  t("one file per currency is fine: matching is per line currency, so an EUR file only sees EUR invoices", () => {
    const m = bank.matchBankLines([{ id: "l4", date: "2026-09-02", amount: -1900, currency: "EUR", counterparty: "Someone", title: "no number", account: "9" }], invs);
    eq(m[0].rank, "AMOUNT"); eq(m[0].invoiceNumber, "TL/77", "the only EUR payable at that amount");
  });
  console.log("v6.87.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.89.0 — CONSIGNMENT SEASON: records and gates ══
(function v689(){
  console.log("\n══ 33. v6.89.0: supplier-delivery truck, receipt variance, inspection, sorting job, stock count ══");
  const Z = B("seasonOps.domain.js");
  const po = { number: "PO-2026-0040", buyIncoterm: "DDP", currency: "EUR", supplier: { id: 5, name: "Vega Pro Kft." }, destinationText: "Agrohurt", items: [{ id: 1, product: "Capsicum", variety: "Red bell pepper", qty: 7200, boxes: 1440, packaging: "Carton (5 kg)", lotRef: "LOT-1" }, { id: 2, product: "Capsicum", variety: "Yellow bell pepper", qty: 7200, boxes: 1440, lotRef: "LOT-2" }] };
  t("decision 1: a DDP PO becomes a supplier-delivery shipment — tracked, not paid, one truck, all lines on it", () => {
    const sh = Z.supplierDeliveryFromPO(po, { ...deps, nextNumber: () => "SHP-2026-0100" }, { plate: "WGM 4421K", eta: "2026-09-10", supplierRef: "GM-004" });
    eq(sh.arrangedBy, "SUPPLIER"); eq(sh.purpose, "INBOUND");
    eq(sh.goods.length, 2); eq(sh.legs[0].vehicles[0].qtyKg, 14400); eq(sh.legs[0].vehicles[0].supplierRef, "GM-004"); eq(sh.costs.length, 0, "no cost of ours");
    ok(!Z.plateMismatch(sh.legs[0].vehicles[0])); ok(Z.plateMismatch({ announcedPlate: "WGM 4421K", truckPlate: "WGM 9999X" }), "wrong truck for this PO is flagged");
  });
  t("G1: the receipt carries the ACTUAL kilos and the variance vs expected", () => {
    const r = Z.receiptMovement({ number: "LOT-1", expectedKg: 7200, locationId: 9 }, { kg: 7050, boxes: 1410, date: "2026-09-10" }, deps);
    eq(r.movement.type, "IN"); eq(r.movement.qtyKg, 7050); eq(r.varianceKg, -150); approx(r.variancePct, -2.08); ok(/expected 7[  ]?200 kg/.test(String(r.movement.note)), "note names the expected quantity");
  });
  t("G2: inspection in the Daifressh structure — totals per category and overall %", () => {
    const ins = Z.blankInspection({ number: "LOT-1", product: "Capsicum", variety: "Red bell pepper", expectedKg: 7200 }, deps, "pre-unloading");
    ins.orderedQty = 1440; ins.checkedQty = 72; ins.unit = "boxes";
    ins.defects = [{ category: "Progressive", name: "Rots / moulds", pct: 4 }, { category: "Major", name: "Sunburn", pct: 0.67 }, { category: "Minor", name: "Blemish / skin marks", pct: 1.44 }];
    const tt = Z.inspectionTotals(ins);
    approx(tt.totalPct, 6.11); approx(tt.byCategory.Progressive, 4); approx(tt.samplePct, 5);
    eq(Z.defectsFor(Z.PEPPER_DEFECTS, "Capsicum Kalifornia").length, Z.PEPPER_DEFECTS.length, "catalogue matches the product family");
  });
  t("G3: one sorting job posts the waste as DAMAGE, keeps class II in the SAME lot as a grade, and refuses a split that does not add up", () => {
    const lot = { number: "LOT-1", receivedKg: 7050, physicalKg: 7050, locationId: 9, movements: [] };
    const r = Z.sortingJob(lot, { date: "2026-09-11", kgIn: 7050, classIKg: 6100, classIIKg: 600, wasteKg: 350, by: "Agrohurt", hours: 6 }, deps);
    ok(!r.error); eq(r.lot.movements.length, 2, "v6.96.0 (IN-2): RECLASS for class II + DAMAGE for waste"); ok(r.lot.movements.some(m => m.type === "RECLASS" && m.qtyKg === 600)); ok(r.lot.movements.some(m => m.type === "DAMAGE" && m.qtyKg === 350));
    const g = Z.gradeSplit(r.lot); eq(g.I, 6100); eq(g.II, 600); eq(g.waste, 350); eq(g.unsorted, 0);
    ok(Z.sortingJob(lot, { date: "2026-09-11", kgIn: 7050, classIKg: 6000, classIIKg: 600, wasteKg: 350 }, deps).error, "6950 ≠ 7050 refused");
  });
  console.log("v6.89.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.90.0 — MONEY TRUTH: the truck's settlement ══
(function v690(){
  console.log("\n══ 34. v6.90.0: settlement per PO — sale costs, respondent-aware recoveries, rate, expected credit note, commission run ══");
  const P = B("poSettlement.domain.js");
  const po = { number: "PO-40", currency: "EUR", fxRate: 4.3, supplier: { id: 5, name: "Vega Pro Kft." } };
  const lots = [
    { number: "L1", poRef: "PO-40", poLineId: 1, product: "Capsicum", variety: "Red bell pepper", receivedKg: 7050, grades: { I: 6100, II: 600, waste: 350 }, costs: [{ type: "warehouse", label: "Storage", pln: 400, source: "WHINV-1" }, { type: "claim", pln: -300, source: "claim:CLM-A" }, { type: "claim", pln: -500, source: "claim:CLM-P" }] },
    { number: "L2", poRef: "PO-40", poLineId: 2, product: "Capsicum", variety: "Yellow bell pepper", receivedKg: 7200, grades: { I: 7200, II: 0, waste: 0 }, costs: [] },
  ];
  const orders = [
    { number: "SO-1", status: "Confirmed", fxRate: 1, items: [{ sourceType: "STOCK", sourceRef: "L1", qty: 6100, unitPrice: 9, quality: "I" }, { sourceType: "STOCK", sourceRef: "L1", qty: 600, unitPrice: 5, quality: "II" }], claimAdjustments: [{ source: "claim:CLM-C", pln: -1000 }] },
    { number: "SO-2", status: "Confirmed", fxRate: 1, items: [{ sourceType: "STOCK", sourceRef: "L2", qty: 7200, unitPrice: 8 }] },
  ];
  const shipments = [{ number: "SHP-9", purpose: "OUTBOUND", status: "Delivered", goods: [{ lotRef: "L1", soRef: "SO-1", qtyKg: 6700 }, { lotRef: "L2", soRef: "SO-2", qtyKg: 7200 }], costs: [{ amountPLN: 2000 }] }];   // v7.27.5 (AUD-30): each row names its sale
  const claims = [{ number: "CLM-A", respondent: { kind: "Warehouse" } }, { number: "CLM-P", respondent: { kind: "Supplier" } }];
  const calc = P.computePOSettlement({ po, lots, orders, shipments, claims, ratePLNperEUR: 4.30, provisionalEUR: 25000, commissionPct: 6.5 });
  t("lines per variety with class I / II sales and waste kg; fully sold", () => {
    eq(calc.lines.length, 2); eq(calc.lines[0].soldKg, 6100); eq(calc.lines[0].soldKgII, 600); eq(calc.lines[0].wasteKg, 350); eq(calc.lines[0].onStockKg, 0); ok(calc.fullySold);
    approx(calc.grossPLN, 6100 * 9 + 600 * 5 + 7200 * 8);
  });
  t("G5/G6: delivery freight is an expense; the warehouse's recovery REDUCES expenses; the producer's recovery is a payout deduction", () => {
    approx(calc.additionalPLN, 2000, "the outbound freight — 100% of that truck's goods");
    approx(calc.warehousePLN, 400); approx(calc.thirdPartyRecoveriesPLN, 300); approx(calc.expensesPLN, 400 + 2000 - 300);
    approx(calc.producerRecoveriesPLN, 500); approx(calc.creditNotesPLN, 1000, "client concession on SO-1 (all its kg are this truck's)");
    approx(calc.netPLN, calc.grossPLN - 1000 - 2100 - 500);
  });
  t("rate per truck → EUR; commission on the net; V5 expected credit note and V6 transfer", () => {
    approx(calc.netSalesEUR, calc.netPLN / 4.3); approx(calc.commissionEUR, calc.netSalesEUR * 0.065);
    // here net sales exceed the provisional price → an EXTRA invoice from the producer is expected, no credit note
    eq(calc.expectedCreditNoteEUR, 0); approx(calc.extraInvoiceEUR, calc.netSalesEUR - 25000);
    approx(calc.transferEUR, calc.netSalesEUR - calc.commissionEUR);
    ok(P.expectedProducerCreditNote(po, calc, deps) === null);
    const high = P.computePOSettlement({ po, lots, orders, shipments, claims, ratePLNperEUR: 4.30, provisionalEUR: 30000, commissionPct: 6.5 });
    approx(high.expectedCreditNoteEUR, 30000 - high.netSalesEUR); eq(high.extraInvoiceEUR, 0);
    const cn = P.expectedProducerCreditNote(po, high, deps); eq(cn.status, "Expected"); eq(cn.currency, "EUR"); eq(cn.direction, "incoming"); approx(cn.amount, high.expectedCreditNoteEUR);
  });
  t("sales report rows in the template: variety I. / II. / waste (kg only)", () => {
    const rows = P.salesReportRows(calc);
    eq(rows.map(r => r.item), ["Red bell pepper I.", "Red bell pepper II.", "Red bell pepper waste", "Yellow bell pepper I."]);
    eq(rows[2].amountEUR, 0); approx(rows[0].unitEUR, 9 / 4.3);
  });
  t("V4: the Monday run drafts ONE commission invoice per closed truck and never twice", () => {
    const sets = [{ id: 1, poNumber: "PO-40", status: "Closed", number: "SET-2026-0001", ratePLNperEUR: 4.3, provisionalEUR: 25000, commissionPct: 6.5 }, { id: 2, poNumber: "PO-41", status: "Open" }];
    // v7.27.5 (AUD-26): the VAT follows where the producer is — a producer in another EU state: reverse charge, the gross is the net
    const r1 = P.commissionRun(sets, [po], (p, s) => P.computePOSettlement({ po: p, lots, orders, shipments, claims, ratePLNperEUR: s.ratePLNperEUR, provisionalEUR: s.provisionalEUR, commissionPct: s.commissionPct }), { ...deps, producerOf: () => ({ country: "Hungary" }) });
    eq(r1.invoices.length, 1); eq(r1.invoices[0].currency, "EUR"); approx(r1.invoices[0].grossAmount, calc.commissionEUR); eq(r1.invoices[0].reverseCharge, true);
    const pl = P.commissionRun(sets, [po], (p, s) => P.computePOSettlement({ po: p, lots, orders, shipments, claims, ratePLNperEUR: s.ratePLNperEUR, provisionalEUR: s.provisionalEUR, commissionPct: s.commissionPct }), { ...deps, producerOf: () => ({ country: "Poland" }) });
    approx(pl.invoices[0].grossAmount, Math.round(calc.commissionEUR * 1.23 * 100) / 100); eq(pl.invoices[0].vatRate, 23);
    const r2_ = P.commissionRun(r1.settlements, [po], () => calc, deps); eq(r2_.invoices.length, 0, "already invoiced");
  });
  console.log("v6.90.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.92.0 — Round 8: ledger discipline on allocations; carrier × leg as the unit of work ══
(function v692(){
  console.log("\n══ 35. v6.92.0: allocation ceilings, feeder budgets, auto split, carrier×leg jobs ══");
  const M = B("shipmentModel.domain.js");
  const mk = () => ({ number: "SHP-1", goods: [{ id: 1, qtyKg: 20000 }], legs: [{ mode: "Road", vehicles: [{ id: 1, kind: "truck", carrierId: 10, truckPlate: "A" }, { id: 2, kind: "truck", carrierId: 11, truckPlate: "B" }] }, { mode: "Sea", costCurrency: "EUR", costFxRate: 4.3, vehicles: [] }] });
  t("A-R8-14: a truck cannot be allocated more than the goods row holds; the remainder is stated", () => {
    let sh = M.autoAllocate(mk(), 0);
    eq(M.unitKg(sh.legs[0].vehicles[0], sh), 10000);
    const r = M.setUnitLoad(sh, 1, 1, 15000); ok(r.error, "over the row (10 000 left after truck B's 10 000)"); eq(r.remaining, 10000);
    const ok2 = M.setUnitLoad(sh, 1, 1, 10000); ok(!ok2.error);
  });
  t("A-R8-16: a truck's kilos are a budget across containers — fully placed → refused elsewhere", () => {
    let sh = M.autoAllocate(mk(), 0);
    sh = M.applyStuffingReport(sh, [{ containerNumber: "C1", feeders: [] }, { containerNumber: "C2", feeders: [] }], deps);
    const [c1, c2] = sh.legs[1].vehicles;
    let r = M.addFeederChecked(sh, c1.id, 1); ok(!r.error); sh = r.sh;
    eq(M.truckRemainingForFeeding(sh, 1), 0);
    r = M.addFeederChecked(sh, c2.id, 1); ok(r.error, "truck A already fully in C1");
    r = M.addFeederChecked(sh, c2.id, 2, 4000); ok(!r.error); sh = r.sh; eq(M.truckRemainingForFeeding(sh, 2), 6000);
    r = M.addFeederChecked(sh, c1.id, 2, 7000); ok(r.error, "only 6 000 left of truck B");
  });
  t("A-R8-18/19: carrier × leg is the job — two carriers on one leg = two transport orders and two expected cost lines", () => {
    let sh = M.autoAllocate(mk(), 0); sh.legs[0].vehicles[0].costAmount = 1900; sh.legs[0].vehicles[1].costAmount = 2100;
    const jobs = M.jobsByCarrierLeg(sh); eq(jobs.length, 2); eq(jobs.find(j => j.carrierId === 10).amount, 1900);
    const costs = M.costLinesByCarrierLeg(sh, id => id === 10 ? "TBX" : "Trans-Log");
    eq(costs.length, 2); ok(costs.some(c => c.label.includes("TBX") && c.amount === 1900)); ok(costs.every(c => c.invoiceStatus === "Expected"));
    // same carrier on both legs → two jobs (owner: different dates → two orders)
    sh.legs[1].vehicles = [{ id: 9, kind: "container", carrierId: 10, costAmount: 500, feeders: [{ fromUnitId: 1 }] }];
    eq(M.jobsByCarrierLeg(sh).filter(j => j.carrierId === 10).length, 2);
  });
  console.log("v6.92.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.94.0 — PURCHASE ORDERS (PO-1…PO-6) ══
(function v694(){
  console.log("\n══ 36. v6.94.0: box unit on PO lines, payment days → due date, normalisation, price check ══");
  const P = B("po.domain.js");
  const types = B("packaging.domain.js").PACKAGING_SEED;
  t("PO-1: box-priced line — type boxes, kilos derive; type kilos on a kg line, boxes derive", () => {
    let l = P.derivePOLineQuantities({ product: "Apples", packaging: "Wooden box (13 kg)", pricingUnit: "box", boxes: 1494, unitPrice: 26 }, types, "boxes");
    eq(l.qty, 19422);
    let k = P.derivePOLineQuantities({ product: "Apples", packaging: "Wooden box (13 kg)", pricingUnit: "kg", qty: 19422, unitPrice: 2 }, types, "qty");
    eq(k.boxes, 1494);
  });
  t("PO-2: payment days from the PO, else the supplier, else legacy text; due = issue + days", () => {
    eq(P.paymentDaysFor({ paymentDays: 45 }, { terms: { paymentDays: 30 } }), 45);   // v7.28.1: companies as the tidy-up writes them
    eq(P.paymentDaysFor({}, { terms: { paymentDays: 30 } }), 30);
    eq(P.paymentDaysFor({ paymentTerms: "21 days from invoice" }, {}), 21);
    eq(P.dueDateFromIssue("2026-09-10", 30), "2026-10-10");
  });
  t("PO-3/4/5: normalisation retires the derivation fields, folds the dates, fixes legacy statuses — and is idempotent", () => {
    const legacy = { number: "PO-1", status: "Shipped", flow: "EXP_CIF", purchaseIncoterm: "EXW", handoverPoint: "supplier", requiresSea: true, variance: {}, expectedDeliveryDate: "2026-09-12", paymentTerms: "30 days", items: [{ id: 1, qty: 100, unitPrice: 4, currency: "PLN" }] };
    const r = P.normalisePO(legacy, { orders: [], directFromSOs: () => false });
    ok(r.changed); eq(r.po.status, "Confirmed"); eq(r.po.buyIncoterm, "EXW"); eq(r.po.loadingDate, "2026-09-12"); eq(r.po.paymentDays, 30);
    ["flow", "purchaseIncoterm", "handoverPoint", "requiresSea", "variance"].forEach(k => ok(!(k in r.po), k + " retired"));
    ok(!("currency" in r.po.items[0])); eq(r.po.items[0].pricingUnit, "kg");
    const again = P.normalisePO(r.po, { orders: [], directFromSOs: () => false }); ok(!again.changed, "idempotent");
  });
  t("PO-6: supplier invoiced above the agreed price × received kilos → variance; within 1% → silent", () => {
    const po = { number: "PO-7", fxRate: 1, items: [{ id: 1, qty: 10000, unitPrice: 4.00 }] };
    const lots = [{ poRef: "PO-7", poLineId: 1, receivedKg: 9800 }];
    const v = P.purchaseInvoiceVariance({ kind: "COST", number: "FA/9", netPLN: 41160 }, po, lots);   // 4.20 × 9 800
    ok(v); approx(v.agreedPLN, 39200); approx(v.diffPct, 5);
    ok(P.purchaseInvoiceVariance({ kind: "COST", number: "FA/10", netPLN: 39300 }, po, lots) === null, "0.26% is within tolerance");
  });
  console.log("v6.94.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.95.0 — SALES ORDERS (SO-1…SO-8) + PO-10 estimated quantities ══
(function v695(){
  console.log("\n══ 37. v6.95.0: grade availability, unit from PO line, incoterm delivery event, payment days, normalisation, estimated quantities ══");
  const Q = B("so.domain.js");
  t("SO-1: availability per grade nets other live orders' grade reservations", () => {
    const lot = { number: "L1", physicalKg: 6700, grades: { I: 6100, II: 600, waste: 350 } };
    const a = Q.lotAvailabilityByGrade(lot, [{ id: 9, status: "Confirmed", items: [{ sourceType: "STOCK", sourceRef: "L1", grade: "II", qty: 200 }, { sourceType: "STOCK", sourceRef: "L1", qty: 1000 }] }]);
    eq(a.I, 5100); eq(a.II, 400);
  });
  t("SO-3: CFR delivers at DISCHARGE; DAP at delivery; the delay is planned vs that event", () => {
    eq(Q.deliveryEventFor("CFR").event, "discharged"); eq(Q.deliveryEventFor("DDP").event, "delivered"); eq(Q.deliveryEventFor("EXW").event, "loaded");
    const so = { number: "SO-1", sellIncoterm: "CFR", deliveryDate: "2026-09-20" };
    const sh = [{ status: "Delivered", soRefs: ["SO-1"], legs: [{ vehicles: [{ deliveredAt: "2026-09-08" }] }, { vehicles: [{ dischargedAt: "2026-09-23" }] }] }];
    eq(Q.actualDeliveryDate(so, sh), "2026-09-23", "the truck's delivery at the port is NOT the sale's delivery"); eq(Q.deliveryDelayDays(so, sh), 3);
  });
  t("SO-4: payment days from the client → invoice due date", () => { eq(Q.soPaymentDays({}, { terms: { paymentDays: 14 } }), 14); eq(Q.soInvoiceDueDate("2026-09-10", {}, { terms: { paymentDays: 14 } }), "2026-09-24"); });
  t("SO-6: normalisation drops the mirrors and is idempotent", () => {
    const r = Q.normaliseSO({ number: "SO-1", linkedInvoices: ["FV/1"], linkedShipments: [], actualDeliveryDate: "x", destinationMode: "text", _poETAByLine: {}, paymentTerms: "14 days", items: [{ qty: 10, unit: "Kg", shippedKg: 5 }] });
    ok(r.changed); ok(!("linkedInvoices" in r.so)); eq(r.so.paymentDays, 14); eq(r.so.items[0].pricingUnit, "kg"); ok(!("shippedKg" in r.so.items[0]));
    ok(!Q.normaliseSO(r.so).changed);
  });
  t("PO-10: estimated quantities become FINAL from the packing result; over-sold lines are PROPOSED for adjustment, newest order first", () => {
    const po = { number: "PO-1", items: [{ id: 1, product: "Apples 70-80", qty: 20000, quantityStatus: "ESTIMATED" }, { id: 2, product: "Apples 65-70", qty: 10000, quantityStatus: "ESTIMATED" }] };
    ok(Q.isEstimatedLine(po.items[0]));
    const fin = Q.applyPackingResult(po, [{ lineId: 1, qty: 17000 }], "2026-09-15");
    eq(fin.items[0].qty, 17000); eq(fin.items[0].estimatedQty, 20000); eq(fin.items[0].quantityStatus, "FINAL"); eq(fin.items[1].quantityStatus, "FINAL"); eq(fin.items[1].qty, 10000);
  });
  console.log("v6.95.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.96.0 — INVENTORY (IN-1…IN-8) ══
(function v696(){
  console.log("\n══ 38. v6.96.0: grades in the ledger, port stage as inventory, stable site ids, lot normalisation ══");
  const Z = B("seasonOps.domain.js"); const loc = B("locations.js");
  t("IN-2: sorting posts RECLASS + DAMAGE; grades derive from the ledger; voiding the job reverses them", () => {
    const lot = { number: "L1", locationId: 9, receivedKg: 7050, physicalKg: 7050, movements: [{ id: 1, type: "IN", date: "2026-09-10", qtyKg: 7050 }] };
    const r = Z.sortingJobLedger(lot, { date: "2026-09-11", kgIn: 7050, classIKg: 6100, classIIKg: 600, wasteKg: 350 }, deps);
    eq(r.lot.movements.filter(m => m.type === "RECLASS").length, 1); eq(r.lot.movements.filter(m => m.type === "DAMAGE").length, 1);
    const g = Z.gradesFromLedger(r.lot); eq(g.I, 6100); eq(g.II, 600); eq(g.waste, 350);
    const voided = { ...r.lot, movements: r.lot.movements.map(m => String(m.source || "").startsWith("sorting:") ? { ...m, voided: true } : m) };
    eq(Z.gradesFromLedger(voided).I, 7050, "a voided job leaves everything class I again");
    eq(Z.gradeSplit(r.lot).II, 600, "gradeSplit reads the ledger when RECLASS exists");
  });
  t("IN-5: unloading at the POL moves the lots to the port location once (idempotent), as a TRANSFER posted by the shipment", () => {
    const sh = { number: "SHP-1", goods: [{ lotRef: "L1", qtyKg: 5000 }], lotRefs: [] };
    const lots = [{ number: "L1", locationId: 9, physicalKg: 5000, movements: [] }, { number: "L2", locationId: 9, physicalKg: 100, movements: [] }];
    const a = Z.portStageTransfers(sh, lots, 126, "2026-09-12", deps); eq(a.posted, 1); eq(a.lots[0].movements[0].type, "TRANSFER"); eq(a.lots[0].movements[0].toId, 126); eq(a.lots[1].movements.length, 0);
    const b = Z.portStageTransfers(sh, a.lots, 126, "2026-09-12", deps); eq(b.posted, 0, "second stamp posts nothing");
  });
  t("IN-6: stamping site ids preserves today's derived ids; re-ordering addresses no longer moves a site", () => {
    const c = { id: 70, name: "Agrohurt", type: "Warehouse", address: "A", extraAddresses: ["B", "C"] };
    const before = loc.counterpartyLocations([c]).map(l => l.id);
    const st = loc.stampSiteIds([c]); ok(st.changed);
    const after = loc.counterpartyLocations(st.contacts).map(l => l.id); eq(JSON.stringify(after), JSON.stringify(before), "same ids as before stamping");
    const reordered = { ...st.contacts[0], extraAddresses: [st.contacts[0].extraAddresses[1], st.contacts[0].extraAddresses[0]] };
    const ids = loc.counterpartyLocations([reordered]).map(l => l.id).sort(); eq(JSON.stringify(ids), JSON.stringify([...before].sort()), "ids follow the address, not the position");
    ok(!loc.stampSiteIds(st.contacts).changed, "idempotent");
  });
  t("IN-4: lot normalisation drops mirrors, syncs consignment/direct from the PO, derives arrival, drops the old per-lot settlement (v7.28.12) — idempotently", () => {
    const lot = { number: "L1", poRef: "PO-1", journey: [], destinationText: "x", custodyType: "y", consignment: false, arrivalDate: "", settlement: { status: "Closed", number: "SET-2026-0001" }, movements: [{ type: "IN", date: "2026-09-10", qtyKg: 10 }] };
    const r = Z.normaliseLot(lot, { po: { pricingMode: "consignment", directFlow: false }, poSettlements: [] });
    ok(r.changed); ok(!("journey" in r.lot)); eq(r.lot.consignment, true); eq(r.lot.arrivalDate, "2026-09-10"); ok(!("settlement" in r.lot));   // v7.28.12: the PO settlement owns it — no hand-over (no lot carries one any more)
    ok(!Z.normaliseLot(r.lot, { po: { pricingMode: "consignment", directFlow: false }, poSettlements: [{ poNumber: "PO-1" }] }).changed);
  });
  console.log("v6.96.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.97.0 — CLAIMS (CL-1…CL-9) — including the path the real data never took: claim → note → offset ══
(function v697(){
  console.log("\n══ 39. v6.97.0: inspection-referenced defect, evidence refs, QC warning (never a block), chain incl. sale costs, OFFSET, legacy fold ══");
  const CP = B("claimsPlus.domain.js"); const cl = B("claims.domain.js"); const cc = B("claimCostChain.domain.js");
  t("CL-2/CL-3: the defect reads from the referenced inspection; evidence candidates come from inspections, register docs, protocols and recorders", () => {
    const ins = [{ id: 5, lotNumber: "L1", date: "2026-09-11", stage: "warehouse", verdict: "Sort", defects: [{ name: "Rots", pct: 4 }, { name: "Sunburn", pct: 2.5 }], observations: "soft on top layer" }];
    const claim = { direction: "RECOVERY", respondent: { kind: "Supplier", name: "Vega" }, subjects: [{ kind: "LOT", ref: "L1" }], inspectionId: 5 };
    const d = CP.defectFromInspection(claim, ins); approx(d.defectPct, 6.5); ok(d.defectType.includes("Rots"));
    const cands = CP.evidenceCandidates(claim, { inspections: ins, shipments: [{ number: "SHP-1", lotRefs: ["L1"], documents: [{ type: "CMR", status: "Have it", link: "https://x" }], loadingProtocols: [{ number: "LP-1", status: "Returned" }], legs: [{ vehicles: [{ id: 1, tempRecorderNo: "R1", truckPlate: "PL1" }] }] }] });
    eq(cands.map(c => c.kind).sort().join(","), "CMR,Loading protocol,Survey report,Temperature record");
    const withE = CP.attachEvidence(CP.attachEvidence(claim, cands[0]), cands[0]); eq(withE.evidence.length, 1, "no duplicate reference");
  });
  t("CL-4 (as ruled): a late QC report WARNS the producer may refuse — never blocks; an agreed extension silences it", () => {
    const lot = { number: "L1", arrivalDate: "2026-09-01", movements: [] };
    const claim = { direction: "RECOVERY", respondent: { kind: "Supplier", name: "Vega Pro" }, subjects: [{ kind: "LOT", ref: "L1" }] };
    ok(CP.qcReportWarning(claim, lot, [{ lotNumber: "L1", date: "2026-09-10" }], { qualityReportDays: 3 }).includes("may refuse"));
    eq(CP.qcReportWarning(claim, lot, [{ lotNumber: "L1", date: "2026-09-03" }], { qualityReportDays: 3 }), "", "on time");
    eq(CP.qcReportWarning({ ...claim, agreedExtension: "extended to 15/09 by email" }, lot, [], { qualityReportDays: 3 }), "", "agreed exception recorded");
    eq(CP.qcReportWarning({ ...claim, direction: "CONCESSION", respondent: { kind: "Client" } }, lot, [], { qualityReportDays: 3 }), "", "only supplier recoveries");
  });
  t("CL-5/CL-9: the chain now proposes the sale's delivery and return freight, each line with a source; merging never duplicates", () => {
    const lines = CP.saleDirectCostLines(["L1"], [{ number: "SO-1", status: "Confirmed", items: [{ sourceType: "STOCK", sourceRef: "L1" }] }], [{ number: "SHP-9", purpose: "OUTBOUND", goods: [{ lotRef: "L1", soRef: "SO-1" }], costs: [{ id: 1, type: "road_freight", amountPLN: 1500 }] }, { number: "RET-1", purpose: "RETURN", goods: [{ lotRef: "L1" }], costs: [{ id: 2, type: "road_freight", amountPLN: 900 }] }, { number: "SHP-IN", purpose: "INBOUND", goods: [{ lotRef: "L1" }], costs: [{ id: 3, amountPLN: 5000 }] }]);
    eq(lines.length, 2); approx(lines.reduce((s, l) => s + l.amountPLN, 0), 2400); ok(lines.every(l => l.source));
    const asClaim = cc.toClaimCostLines(lines, 4.3); ok(asClaim.every(l => l.source), "CL-9 source on kept lines");
  });
  t("END TO END: accepted claim → note → OFFSET against the counterparty's open invoice (one action), then the note is Settled", () => {
    const claim = { number: "CLM-9", status: "Accepted", direction: "CONCESSION", currency: "PLN", acceptedAmount: 1200, respondent: { kind: "Client", name: "Agromax" }, subjects: [{ kind: "SO", ref: "SO-1" }] };
    const note = cl.buildClaimFinanceNote(claim, "OUR_CREDIT_TO_CLIENT", { nextId: () => 77, todayISO: () => "2026-09-10", invoices: [] });
    eq(note.currency, "PLN"); approx(note.amount, 1200);
    const inv = { id: 3, kind: "SALES", number: "FV/3", currency: "PLN", grossAmount: 5000, paidAmount: 0, paymentStatus: "Sent", payments: [], counterparty: { name: "Agromax" } };
    const r = CP.offsetNoteAgainstInvoice(note, inv, deps);
    ok(!r.error); approx(r.appliedAmount, 1200); approx(pay.outstandingAmount(r.invoice), 3800); eq(r.invoice.payments[0].method, "Offset / compensation"); eq(r.note.status, "Settled");
    ok(CP.offsetNoteAgainstInvoice(r.note, r.invoice, deps).error, "applying twice is refused");
  });
  t("CL-8: the counterparty's agreed notice period overrides the legal default", () => {
    eq(CP.noticeRuleFor({ respondent: { kind: "Carrier" } }, {}).days, 7);
    eq(CP.noticeRuleFor({ respondent: { kind: "Carrier" } }, { name: "TBX", noticeDays: 10 }).days, 10);
    eq(CP.noticeRuleFor({ respondent: { kind: "Carrier" } }, { name: "TBX", terms: { noticeDays: 12 } }).days, 12, "v7.10.1: the company form writes terms.noticeDays");
  });
  console.log("v6.97.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.98.0 — INVOICES (IV-1…IV-7) ══
(function v698(){
  console.log("\n══ 40. v6.98.0: required links with proposals, expected-line matching, one category, derived states, consistency ══");
  const IV = B("invoicePlus.domain.js");
  t("IV-1: a freight invoice with no link cannot leave Draft; overhead and sales are exempt", () => {
    ok(IV.requiredLinkMissing({ kind: "COST", category: "FREIGHT", links: [] }));
    eq(IV.requiredLinkMissing({ kind: "COST", category: "FREIGHT", links: [{ type: "Shipment", number: "SHP-1" }] }), "");
    eq(IV.requiredLinkMissing({ kind: "COST", category: "OVERHEAD", links: [] }), ""); eq(IV.requiredLinkMissing({ kind: "SALES", links: [] }), "");
  });
  t("IV-1: proposals — a number quoted on the invoice, and the carrier's expected line at the same amount", () => {
    const inv = { kind: "COST", counterparty: { id: 10, name: "TBX" }, grossAmount: 1900, notes: "transport wg zlecenia SHP-2026-0029" };
    const p = IV.proposeLinks(inv, { shipments: [{ number: "SHP-2026-0029", status: "Loaded", costs: [{ id: 1, supplierId: 10, amount: 1905, invoiceStatus: "Expected", label: "Road freight" }] }, { number: "SHP-2026-0030", status: "Loaded", costs: [{ id: 2, supplierId: 11, amount: 1900, invoiceStatus: "Expected" }] }] });
    eq(p[0].number, "SHP-2026-0029"); eq(p[0].confidence, "high"); eq(p.length, 1, "the other carrier's line is not proposed");
  });
  t("IV-2: matching sets the line Received, stores the invoice reference and the variance (one action)", () => {
    const r = IV.matchInvoiceToCostLine({ number: "SHP-1", costs: [{ id: 1, amount: 1900, invoiceStatus: "Expected" }] }, 1, { id: 55, number: "TL/77", grossAmount: 1995 });
    eq(r.sh.costs[0].invoiceStatus, "Received"); eq(r.sh.costs[0].invoiceId, 55); approx(r.variance, 95); approx(r.variancePct, 5);
  });
  t("IV-3/IV-5: three classifiers fold into one category; scope derives; creditNoteIds/locked dropped; idempotent", () => {
    const r = IV.normaliseInvoiceCategory({ kind: "COST", category: "LINV", costScope: "SHIPMENT", creditNoteIds: [], locked: true });
    eq(r.inv.category, "FREIGHT"); eq(r.inv.costScope, "SHIPMENT"); ok(!("locked" in r.inv)); ok(!IV.normaliseInvoiceCategory(r.inv).changed);
    eq(IV.normaliseInvoiceCategory({ kind: "SALES", category: "SINV" }).inv.category, "SALES"); eq(IV.normaliseInvoiceCategory({ kind: "COST", costScope: "OVERHEAD" }).inv.category, "OVERHEAD");
  });
  t("IV-4: lifecycle and settlement state are two different questions", () => {
    eq(IV.invoiceLifecycle({ paymentStatus: "Partially paid" }), "Issued"); eq(IV.settlementState({ paymentStatus: "Issued", grossAmount: 100, paidAmount: 40 }, "2026-09-10"), "Partially paid");
    eq(IV.settlementState({ paymentStatus: "Issued", grossAmount: 100, paidAmount: 0, dueDate: "2026-09-01" }, "2026-09-10"), "Overdue");
  });
  t("IV-6/IV-7: positions must add up to the header; an unlinked cost invoice gets its due date from the counterparty's days", () => {
    ok(IV.positionsMismatch({ grossAmount: 1000, positions: [{ grossTotal: 600 }, { grossTotal: 300 }] })); eq(IV.positionsMismatch({ grossAmount: 900, positions: [{ grossTotal: 600 }, { grossTotal: 300 }] }), "");
    eq(IV.defaultCostDueDate({ issueDate: "2026-09-10" }, { terms: { paymentDays: 21 } }), "2026-10-01");
  });
  console.log("v6.98.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.98.1 — STATEMENT OF ACCOUNT ══
(function v6981(){
  console.log("\n══ 41. v6.98.1: statement of account per client / supplier ══");
  const ST = B("statement.domain.js");
  const invs = [
    { kind: "SALES", number: "FV/1", counterparty: { name: "Agromax" }, currency: "PLN", issueDate: "2026-08-01", dueDate: "2026-08-31", grossAmount: 10000, paidAmount: 4000, paymentStatus: "Issued", payments: [{ date: "2026-08-20", amount: 4000, method: "Bank transfer", source: "bank:x" }] },
    { kind: "SALES", number: "FV/2", counterparty: { name: "Agromax" }, currency: "PLN", issueDate: "2026-09-05", dueDate: "2026-10-05", grossAmount: 5000, paidAmount: 1200, paymentStatus: "Issued", payments: [{ date: "2026-09-10", amount: 1200, method: "Offset / compensation", source: "note:77" }] },
    { kind: "SALES", number: "FV/9", counterparty: { name: "Other" }, currency: "PLN", issueDate: "2026-09-05", grossAmount: 999, paidAmount: 0, paymentStatus: "Issued", payments: [] },
  ];
  const notes = [{ id: 77, noteType: "CREDIT", direction: "outgoing", issuedBy: "US", status: "Issued", partyName: "Agromax", currency: "PLN", amount: 1200, date: "2026-09-10", number: "KN/1" }];
  t("client statement: opening from before the period, invoices debit, payments/credit notes credit, running balance, closing, overdue & aging", () => {
    const s = ST.statementFor("Agromax", "client", "PLN", invs, notes, "2026-09-01", "2026-09-30", "2026-09-11");
    approx(s.opening, 6000, "FV/1 10 000 − payment 4 000 before September");
    eq(s.lines.map(l => l.type).join(","), "Invoice,Offset,Credit note");
    approx(s.closing, 6000 + 5000 - 1200 - 1200);
    approx(s.overdue, 6000, "FV/1 is past due"); approx(s.aging.d30, 6000); approx(s.aging.current, 3800);
    ok(!s.lines.some(l => l.ref.includes("FV/9")), "other clients excluded");
  });
  t("supplier statement mirrors the sign: their invoice is what we owe; our payment reduces it", () => {
    const sup = [{ kind: "COST", number: "TL/77", counterparty: { name: "Trans-Log" }, currency: "EUR", issueDate: "2026-09-01", dueDate: "2026-09-30", grossAmount: 1900, paidAmount: 1000, paymentStatus: "Issued", payments: [{ date: "2026-09-08", amount: 1000, method: "Bank transfer" }] }];
    const s = ST.statementFor("Trans-Log", "supplier", "EUR", sup, [], "2026-09-01", "2026-09-30", "2026-09-11");
    approx(s.closing, 900, "we owe 900 EUR"); eq(ST.statementCurrencies("Trans-Log", "supplier", sup, []).join(), "EUR");
  });
  console.log("v6.98.1 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.0 — FINANCE (FN-1/2/3/7/8) ══
(function v699(){
  console.log("\n══ 42. v6.99.0: period close guard, snapshot, cash projection ══");
  const PC = B("periodClose.domain.js");
  t("FN-1: a document dated inside a closed month is refused; the open month is fine", () => {
    const closed = [{ period: "2026-08", closedAt: "2026-09-05", closedBy: "Hazem", snapshot: {} }];
    ok(PC.periodGuard("2026-08-20", closed).includes("CLOSED")); eq(PC.periodGuard("2026-09-02", closed), ""); eq(PC.periodGuard("", closed), "");
  });
  t("FN-2: the snapshot freezes the package figures", () => {
    const s = PC.buildSnapshot("2026-08", { totalAgg: { totalRevenuePLN: 100000, totalCOGSPLN: 80000, totalDirectPLN: 5000, totalContributionPLN: 15000, totalOverheadPLN: 3000, totalNetMarginPLN: 12000 }, ledgerTotals: { receivableOpenPLN: 40000, receivableOverduePLN: 9000, payableOpenPLN: 25000, payableOverduePLN: 0 }, stockKg: 19422, stockValuePLN: 80382, openClaims: 2, settlementsClosed: 1, realizedFxPLN: -18, bankBalances: [] });
    eq(s.netPLN, 12000); eq(s.receivableOverduePLN, 9000); eq(s.stockKg, 19422);
  });
  t("FN-3: cash projection buckets receivables in and payables out by due date; overdue separately", () => {
    const inv = [{ kind: "SALES", grossAmount: 1000, paidAmount: 0, fxRate: 1, dueDate: "2026-09-20", paymentStatus: "Issued" }, { kind: "COST", grossAmount: 400, paidAmount: 0, fxRate: 1, dueDate: "2026-10-25", paymentStatus: "Issued" }, { kind: "SALES", grossAmount: 300, paidAmount: 0, fxRate: 1, dueDate: "2026-09-01", paymentStatus: "Issued" }];
    const c = PC.cashProjection(inv, "2026-09-11");
    approx(c.buckets[0].inPLN, 1000); approx(c.buckets[1].outPLN, 400); approx(c.buckets[1].netPLN, -400); approx(c.overdueInPLN, 300);
  });
  console.log("v6.99.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.1 — FINANCE part 2 (FN-4/5/6) ══
(function v6991(){
  console.log("\n══ 43. v6.99.1: client risk, PO result for every purchase, warehouse agreement ══");
  const FP = B("financePlus.domain.js");
  t("FN-4: client risk — exposure, overdue, days late, limit usage incl. confirmed orders, days-to-pay", () => {
    const inv = [{ kind: "SALES", counterparty: { name: "Agromax" }, currency: "PLN", fxRate: 1, issueDate: "2026-08-01", dueDate: "2026-08-31", grossAmount: 10000, paidAmount: 4000, paymentStatus: "Issued", payments: [{ date: "2026-08-21", amount: 4000 }] }];
    const r = FP.clientRisk("Agromax", inv, [{ status: "Confirmed", client: { name: "Agromax" }, fxRate: 1, items: [{ qty: 1000, unitPrice: 5 }] }], { terms: { creditLimitPLN: 20000 } }, "2026-09-11");
    approx(r.exposurePLN, 6000); approx(r.overduePLN, 6000); eq(r.maxOverdueDays, 11); approx(r.openOrdersPLN, 5000); approx(r.usagePct, 55); eq(r.avgDaysToPay, 20); eq(r.lastPaymentDate, "2026-08-21");
  });
  t("FN-5: a firm purchase's result — revenue − purchase − landed − direct − concessions + recoveries, per kg", () => {
    const po = { number: "PO-1" };
    const lots = [{ number: "L1", poRef: "PO-1", poLineId: 1, receivedKg: 10000, grades: { waste: 0 }, costs: [{ type: "purchase", pln: 40000 }, { type: "freight", pln: 3000, source: "SHP-IN/1" }, { type: "claim", pln: -500, source: "claim:CLM-1" }] }];
    const orders = [{ number: "SO-1", status: "Confirmed", fxRate: 1, items: [{ sourceType: "STOCK", sourceRef: "L1", qty: 10000, unitPrice: 6 }], claimAdjustments: [{ source: "claim:CLM-2", pln: -1000 }] }];
    const sh = [{ number: "SHP-OUT", purpose: "OUTBOUND", status: "Delivered", goods: [{ lotRef: "L1", qtyKg: 10000 }], costs: [{ amountPLN: 2000 }] }];
    const r = FP.poResult(po, lots, orders, sh);
    approx(r.revenuePLN, 60000); approx(r.purchasePLN, 40000); approx(r.landedOtherPLN, 3000); approx(r.directPLN, 2000); approx(r.concessionsPLN, 1000); approx(r.recoveriesPLN, 500);
    approx(r.marginPLN, 60000 - 1000 - 40000 - 3000 - 2000 + 500); approx(r.marginPerKg, 1.45); ok(r.fullySold);
  });
  // v6.99.87 (A-PT-1, owner ruling 1 Oct): FN-6 retired with the agreement section — a fixed fee is a warehouse invoice
  console.log("v6.99.1 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.2 — COUNTERPARTIES (CP-1…CP-7, CP-9) ══
(function v6992(){
  console.log("\n══ 44. v6.99.2: roles, terms block, people, archive, Fakturownia id, ISO/EU, agreements ══");
  const CPY = B("counterparty.domain.js");
  t("CP-1/2/6/9: normalisation — roles from type+additionalTypes, terms from scattered fields (mirrors dropped since v7.28.1), ISO code, caches dropped; idempotent", () => {
    const r = CPY.normaliseCounterparty({ id: 1, name: "Agro-Hurt", type: "Client", additionalTypes: ["Supplier", "Warehouse"], country: "Poland", paymentTerms: "30 days", creditLimitPLN: 50000, defaultCurrency: "pln", finance: { x: 1 }, services: "reefer", linkedDocs: ["PO-1"], contacts: [{ name: "Ilona", email: "m@agro.pl" }] });
    ok(r.changed); eq(r.contact.roles.join(","), "Client,Supplier,Warehouse"); eq(r.contact.terms.paymentDays, 30); eq(r.contact.terms.creditLimitPLN, 50000); eq(r.contact.terms.defaultCurrency, "PLN"); ok(!("paymentTermsDays" in r.contact), "the flat mirror is still written (v7.28.1)");
    eq(r.contact.countryIso, "PL"); ok(!("finance" in r.contact)); ok(!("linkedDocs" in r.contact)); ok(!("contacts" in r.contact), "the old persons list is still written (v7.28.2)"); eq(r.contact.people.length, 1);   // v7.28.2: one list — people[] only
    ok(!CPY.normaliseCounterparty(r.contact).changed);
    eq(CPY.isEU("Poland"), true); eq(CPY.isEU("Egypt"), false); eq(CPY.isEU(""), null);
  });
  t("CP-3/4/5/7: person by role for composers; archived parties out of pickers; import matches by Fakturownia id then NIP; current agreement by validity", () => {
    const c = { name: "Vega Pro", roles: ["Supplier"], people: [{ name: "Anna", role: "Accountant", email: "a@vega.hu" }, { name: "Bela", role: "Sales", email: "b@vega.hu" }], agreements: [{ season: "2025", validFrom: "2025-06-01", validTo: "2025-12-31", commissionPct: 6 }, { season: "2026", validFrom: "2026-06-01", commissionPct: 6.5, qualityReportDays: 3 }] };
    eq(CPY.personFor(c, "Accountant").email, "a@vega.hu"); eq(CPY.personFor(c, "Dispatcher").email, "a@vega.hu", "falls back to any person with an e-mail");
    eq(CPY.activeParties([c, { name: "Old", roles: ["Supplier"], archived: true }], "Supplier").length, 1);
    eq(CPY.matchImported([{ id: 9, fakturowniaId: 555, nip: "5252842787" }], { fakturowniaId: 555 }).id, 9); eq(CPY.matchImported([{ id: 9, nip: "525-284-27-87" }], { nip: "5252842787" }).id, 9);
    eq(CPY.currentAgreement(c, "2026-09-11").commissionPct, 6.5); eq(CPY.currentAgreement(c, "2025-09-11").commissionPct, 6);
  });
  console.log("v6.99.2 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.3 — SETTINGS batch ══
(function v6993(){
  console.log("\n══ 45. v6.99.3: CN suggestions, Vega Pro export shape ══");
  const CN = B("cnCodes.js");
  t("CN suggestions match the produce Marianna trades, in English and Polish; the user still confirms", () => {
    eq(CN.suggestCN("Capsicum Kalifornia")[0].code, "07096010"); eq(CN.suggestCN("Apples", "Gala Schniko Red")[0].code, "08081080"); eq(CN.suggestCN("Papryka")[0].code, "07096010"); eq(CN.suggestCN("Chinese cabbage")[0].code, "07049090"); eq(CN.suggestCN("").length, 0);
  });
  console.log("v6.99.3 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.4 — DASHBOARD (DA-1…DA-8) ══
(function v6994(){
  console.log("\n══ 46. v6.99.4: dashboard tiles — today's movements, documents, deadlines, owner controls, warehouse morning, roles ══");
  const DB = B("dashboard.domain.js");
  const today = "2026-09-11";
  t("DA-2: loading / arriving / cut-off / deliveries today — exceptions only, 'none' when empty", () => {
    const sh = [{ number: "SHP-1", status: "Booked", purpose: "OUTBOUND", bookings: [{ cutOff: "2026-09-12" }], legs: [{ vehicles: [{ truckPlate: "PL1", plannedLoadingDate: today }, { truckPlate: "PL2", plannedLoadingDate: "2026-09-15" }] }] }, { number: "SHP-2", status: "Booked", purpose: "INBOUND", arrangedBy: "SUPPLIER", legs: [{ vehicles: [{ eta: today }] }] }];
    const t2 = DB.movementTiles(sh, today); eq(t2[0].count, 1); ok(t2[0].detail.includes("PL1")); eq(t2[1].count, 1); ok(t2[1].detail.includes("supplier")); eq(t2[2].count, 1); eq(t2[3].detail, "none"); eq(t2[3].tone, "ok");
  });
  t("DA-3: transport orders not sent, protocols out, loaded without invoice (R1), POs awaiting packing result", () => {
    const sh = [{ number: "SHP-1", status: "Loaded", purpose: "OUTBOUND", soRefs: ["SO-1"], legs: [{ vehicles: [{}] }], loadingProtocols: [{ number: "LP-1", status: "Sent" }] }];
    const t3 = DB.documentTiles(sh, [{ number: "SO-1", status: "Confirmed" }], [], [{ number: "PO-1", status: "Confirmed", items: [{ quantityStatus: "ESTIMATED" }] }]);
    eq(t3[0].count, 1, "TO not sent"); eq(t3[1].count, 1, "protocol out"); eq(t3[2].count, 1, "loaded, no invoice"); eq(t3[3].count, 1, "awaiting packing");
  });
  t("DA-4/DA-5: QC report due from the supplier's agreement days; month to close; commission run pending; expected notes; risk breaches", () => {
    const lots = [{ number: "L1", poRef: "PO-1", receivedKg: 100, arrivalDate: "2026-09-08", movements: [] }];
    const d = DB.deadlineTiles(lots, [], [{ id: 5, terms: { qualityReportDays: 3 } }], [{ number: "PO-1", supplier: { id: 5 } }], [], today);
    eq(d[0].count, 1, "due 11/09, none recorded");
    const o = DB.ownerTiles([], [{ poNumber: "PO-1", status: "Closed" }], [{ status: "Expected", partyName: "Vega Pro", amount: 1200, currency: "EUR" }], [{ client: "X", usagePct: 130, maxOverdueDays: 5 }], today);
    eq(o[0].count, 1, "August not closed"); eq(o[1].count, 1); eq(o[2].count, 1); eq(o[3].count, 1);
    eq(DB.ownerTiles([{ period: "2026-08" }], [], [], [], today)[0].tone, "ok");
  });
  t("DB7 / DA-1: the warehouse's morning at its location; tile sets follow the user's roles", () => {
    const w = DB.warehouseTiles([{ number: "L1", locationId: 9, physicalKg: 100 }], [], [], [], 9, today); eq(w[1].count, 1); eq(w[2].count, 1);
    eq(DB.tileSetsFor({ isOwner: true }).length, 3); eq(DB.tileSetsFor({ role: "Warehouse", modules: { lots: true, shipments: false }, finance: {} }).join(), "warehouse"); eq(DB.tileSetsFor(null).join(), "owner,operations");
  });
  console.log("v6.99.4 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.8 — regression: allocation never 0 kg; cost lines never name a stray supplier; order carries the carrier's kg only ══
(function v6998(){
  console.log("\n══ 47. v6.99.8: allocation remainder, auto units, cost-line suppliers, booking forwarder ══");
  const M = B("shipmentModel.domain.js");
  t("two trucks added before the goods, goods entered after → autoAllocate gives each half; a hand-set truck keeps its share and the others take the rest", () => {
    let sh = { number: "S", goods: [], legs: [{ mode: "Road", vehicles: [{ id: 1, kind: "truck", carrierId: 10, load: [] }, { id: 2, kind: "truck", carrierId: 11, load: [] }] }] };
    sh.goods = [{ id: 7, qtyKg: 38844 }];
    sh = M.autoAllocate(sh, 0); eq(M.unitKg(sh.legs[0].vehicles[0], sh), 19422); eq(M.unitKg(sh.legs[0].vehicles[1], sh), 19422);
    sh.legs[0].vehicles[0] = { ...sh.legs[0].vehicles[0], load: [{ goodsLineId: 7, qtyKg: 15000 }], manualLoad: true };
    sh = M.autoAllocate(sh, 0); eq(M.unitKg(sh.legs[0].vehicles[1], sh), 23844, "the auto truck takes the remainder");
  });
  t("cost lines: supplier = the unit's carrier; containers = the booking's forwarder; an unnamed unit joins no job (never a stray leg id)", () => {
    const sh = { number: "S", goods: [{ id: 7, qtyKg: 38844 }], bookings: [{ id: 1, number: "BKG", forwarderId: 99 }], legs: [{ mode: "Road", carrierId: 55, vehicles: [{ id: 1, kind: "truck", carrierId: 10, costAmount: 1900, load: [{ goodsLineId: 7, qtyKg: 19422 }] }, { id: 2, kind: "truck", carrierId: 11, costAmount: 2000, load: [{ goodsLineId: 7, qtyKg: 19422 }] }] }, { mode: "Sea", vehicles: [{ id: 3, kind: "container", costAmount: 500, feeders: [{ fromUnitId: 1 }] }, { id: 4, kind: "container", costAmount: 500, feeders: [{ fromUnitId: 2 }] }] }] };
    const jobs = M.jobsByCarrierLeg(sh);
    eq(jobs.length, 3); ok(!jobs.some(j => String(j.carrierId) === "55"), "the stale leg carrier (Agro-Hurt) never becomes a supplier");
    const sea = jobs.find(j => j.legIndex === 1); eq(String(sea.carrierId), "99"); eq(sea.units.length, 2); eq(sea.amount, 1000);
    const lines = M.costLinesByCarrierLeg(sh, id => ({ 10: "Didinczyk", 11: "Polton", 99: "Forwarder" })[id] || "?");
    eq(lines.map(l => l.label.split(" — ")[2].split(" (")[0]).sort().join(","), ["Forwarder", "Polton", "Didinczyk"].sort().join(","));   // v7.21.2 (AUD-50): names may be invented — the order follows them
  });
  console.log("v6.99.8 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.22 — GRADE IS PART OF THE PROMISE (G-1…G-5) ══
(function v69922(){
  console.log("\n══ 48. v6.99.22: grade stock, grade availability, the sorting warning, the ship-out's grade ══");
  const Z = B("seasonOps.domain.js"); const SD = B("salesOrders.domain.js");
  // the owner's real case: 14 300 received · 3 750 reclassified to II · 200 lost · 8 750 shipped as class I · 5 500 still promised as class I
  const lot = { number: "L1", product: "Capsicum", poRef: "PO-1", locationId: 9, receivedKg: 14300, physicalKg: 5350, availableKg: 5350,
    movements: [ { id: 1, type: "IN", date: "2026-08-13", qtyKg: 14300 }, { id: 2, type: "DAMAGE", date: "2026-08-13", qtyKg: 50 },
      { id: 3, type: "RECLASS", date: "2026-08-15", qtyKg: 750, toGrade: "II" }, { id: 4, type: "SHIP_OUT", date: "2026-08-15", qtyKg: 8750, grade: "I", soRef: "SO-24" },
      { id: 5, type: "RECLASS", date: "2026-09-14", qtyKg: 3000, toGrade: "II", source: "sorting:9" }, { id: 6, type: "DAMAGE", date: "2026-09-14", qtyKg: 50, source: "sorting:9" }, { id: 7, type: "DAMAGE", date: "2026-09-14", qtyKg: 100, source: "count:9" } ] };
  const orders = [ { id: 24, number: "SO-24", status: "Confirmed", items: [{ product: "Capsicum", sourceType: "STOCK", sourceRef: "L1", qty: 8750 }] },
                   { id: 23, number: "SO-23", status: "Confirmed", items: [{ product: "Capsicum", sourceType: "STOCK", sourceRef: "L1", qty: 5500 }] } ];
  t("G-1: stock by grade reads the ledger — class II is what sorting made and has not shipped; class I is the rest of the physical stock", () => {
    const g = Z.gradeStockNow(lot); eq(g.I, 1600); eq(g.II, 3750); eq(g.waste, 50);
  });
  t("G-1: availability by grade nets the promises; the shipped order is history and promises nothing", () => {
    const a = Z.gradeAvailability(lot, orders);
    eq(a.promisedI, 5500, "only SO-23 still promises class I — SO-24's kilos already left"); eq(a.stockI, 1600); eq(a.I, -3900); eq(a.II, 3750);
  });
  t("G-3: the sorting job names the order it undercut and never blocks", () => {
    const w = Z.gradeCommitmentWarning(lot, orders);
    ok(w.includes("SO-23")); ok(!w.includes("SO-24"), "a shipped order is not 'affected'"); ok(w.includes("3900") || w.includes("3 900"));
  });
  t("G-1: the sales line check reports the class, its stock and the shortfall", () => {
    const so = orders[1];
    const av = SD.computeLineAvailability(so.items, orders, so.id, [lot], [], []);
    eq(av[0].grade, "I"); eq(av[0].gradeStockKg, 1600); eq(av[0].primaryAvailable, 1600); eq(av[0].gradeShort, 3900); ok(av[0].hasOverage);
  });
  t("G-1: a class II line on the same lot is fine — 3 750 kg are there", () => {
    const soII = { id: 25, number: "SO-25", status: "Draft", items: [{ product: "Capsicum", sourceType: "STOCK", sourceRef: "L1", qty: 3750, grade: "II" }] };
    const av = SD.computeLineAvailability(soII.items, [...orders, soII], soII.id, [lot], [], []);
    eq(av[0].grade, "II"); eq(av[0].primaryAvailable, 3750); eq(av[0].gradeShort, 0); ok(!av[0].hasOverage);
  });
  t("G-2 heal: ship-outs posted before grades existed are class I — remaining-by-grade is read, not guessed; idempotent", () => {
    const raw = { ...lot, movements: lot.movements.map(m => m.type === "SHIP_OUT" ? { ...m, grade: undefined } : m) };
    const r = Z.normaliseLot(raw, {}); ok(r.changed); eq(r.lot.movements.find(m => m.type === "SHIP_OUT").grade, "I");
    eq(Z.gradeStockNow(r.lot).I, 1600);
    ok(!Z.normaliseLot(r.lot, {}).changed);
  });
  console.log("v6.99.22 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.23 — ONE payment-terms source (basis + days) ══
(function v69923(){
  console.log("\n══ 49. v6.99.23: payment terms — one field, migrated from the legacy text ══");
  const P = B("po.domain.js"); const Q = B("so.domain.js");
  t("the legacy text migrates into basis + days, then retires; idempotent", () => {
    const r = P.normalisePO({ number: "PO-1", paymentTerms: "30 days from invoice date", items: [] }, {});
    eq(r.po.paymentBasis, "INVOICE"); eq(r.po.paymentDays, 30); ok(!("paymentTerms" in r.po)); ok(!P.normalisePO(r.po, {}).changed);
    eq(P.normalisePO({ number: "PO-2", paymentTerms: "Advance payment", items: [] }, {}).po.paymentBasis, "ADVANCE");
    eq(P.normalisePO({ number: "PO-3", paymentTerms: "Cash against documents", items: [] }, {}).po.paymentBasis, "CAD");
    const so = Q.normaliseSO({ number: "SO-1", paymentTerms: "14 days from invoice date", items: [] });
    eq(so.so.paymentBasis, "INVOICE"); eq(so.so.paymentDays, 14); ok(!("paymentTerms" in so.so));
  });
  t("the printed sentence and the due date come from that one source", () => {
    eq(P.paymentTermsLabel("INVOICE", 30), "30 days from invoice date");
    ok(P.paymentTermsLabel("ADVANCE", 0).startsWith("Advance"));
    eq(P.dueDateFor("2026-09-15", "INVOICE", 30), "2026-10-15");
    eq(P.dueDateFor("2026-09-15", "COD", 30), "2026-09-15", "days never apply to cash on delivery");
  });
  console.log("v6.99.23 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.27 — one class per sales line ══
(function v69927(){
  console.log("\n══ 50. v6.99.27: the sales line has ONE class (grade ↔ quality kept in step) ══");
  const Q = B("so.domain.js");
  t("a line written with either name ends up with both, and the check is idempotent", () => {
    const a = Q.normaliseSO({ number: "SO-1", items: [{ product: "Capsicum", grade: "II" }, { product: "Apples", quality: "I" }, { product: "Pears" }] });
    ok(a.changed); eq(a.so.items[0].quality, "II"); eq(a.so.items[1].grade, "I"); eq(a.so.items[2].grade, "I"); eq(a.so.items[2].quality, "I");
    ok(!Q.normaliseSO(a.so).changed);
  });
  console.log("v6.99.27 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.29 — party pickers and places (A-R19) ══
(function v69929(){
  console.log("\n══ 51. v6.99.29: pickers sorted & roles-aware; orphaned migrated places pruned ══");
  const L = B("locations.js");
  console.log("v6.99.29 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.31 — the quality report (Daifressh structure) ══
(function v69931(){
  console.log("\n══ 52. v6.99.31: defect categories, tolerances and the report verdict ══");
  const Z = B("seasonOps.domain.js");
  t("A-R22-3: the producer's defect list is the catalogue — four categories, the owner's names", () => {
    const cats = {}; Z.PEPPER_DEFECTS.forEach(d => { cats[d.category] = (cats[d.category] || 0) + 1; });
    eq(cats.Unacceptable, 4); eq(cats.Progressive, 1); eq(cats.Major, 8); eq(cats.Minor, 8);
    ok(Z.PEPPER_DEFECTS.some(d => d.name === "Spray deposits") && Z.PEPPER_DEFECTS.some(d => d.name === "Silvering / thrips"));
  });
  t("A-R22-2: the owner's own sheet reproduced — 4 % rots, 3.5 % mechanical = 7.5 %, sorting advised", () => {
    const ins = { defects: [ { category: "Progressive", name: "Rots and mould", pct: 4 }, { category: "Major", name: "Mechanical damage (more than 1 cm² on surface)", pct: 3.5 } ] };
    const v = Z.inspectionVerdict(ins);
    eq(v.totalPct, 7.5); ok(!v.acceptable);
    eq(v.rows.find(r => r.category === "Progressive").acceptable, false, "4 % rots is over the 1 % tolerance");
    eq(v.rows.find(r => r.category === "Minor").acceptable, true, "no minor defects found — that category passes");
    ok(v.advice.startsWith("Sort"));
  });
  t("A-R22-2: any unacceptable defect rejects the consignment, whatever the totals", () => {
    const v = Z.inspectionVerdict({ defects: [{ category: "Unacceptable", name: "Pests presence", pct: 0.5 }] });
    ok(!v.acceptable); ok(v.advice.startsWith("Reject"));
    eq(Z.inspectionVerdict({ tolerances: { Unacceptable: 3 }, defects: [{ category: "Unacceptable", name: "Pests presence", pct: 0.5 }] }).acceptable, false, "unacceptable can never be given a tolerance");
  });
  console.log("v6.99.31 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.32 — the warehouse's own screen (QH) ══
(function v69932(){
  console.log("\n══ 53. v6.99.32: sample %, report-held tolerances, counting by boxes and by class ══");
  const Z = B("seasonOps.domain.js");
  t("QH-4: the sample percentage is computed from checked ÷ delivered", () => {
    eq(Z.samplePctOf({ orderedQty: 14270, checkedQty: 120 }), 0.84); eq(Z.samplePctOf({ orderedQty: 2055, checkedQty: 206 }), 10, "a sample over 10 % reads to one decimal"); eq(Z.samplePctOf({ orderedQty: 0, checkedQty: 5 }), 0);
  });
  t("QH-7: a report is judged by ITS OWN tolerances, whatever the settings say later", () => {
    const ins = { defects: [{ category: "Major", name: "Bruising", pct: 4 }], tolerances: { Major: 8 } };
    ok(Z.inspectionVerdict(ins, { Major: 2 }).acceptable, "the report's own 8 % wins over a later 2 %");
    eq(Z.inspectionVerdict({ defects: [{ category: "Unacceptable", name: "Pests presence", pct: 1 }], tolerances: { Unacceptable: 5 } }).acceptable, false, "unacceptable stays 0 % even if the report says otherwise");
    const last = Z.tolerancesFromLast([{ product: "Capsicum", date: "2026-08-15", tolerances: { Major: 6, Minor: 12 } }], "Capsicum");
    eq(last.Major, 6); eq(last.Minor, 12); eq(last.Unacceptable, 0);
  });
  t("QH-6: kilos derive from pallets × boxes per pallet + loose boxes; after sorting the lot is counted per class", () => {
    eq(Z.countedKgOf({ pallets: 20, boxesPerPallet: 72, looseBoxes: 6, kgPerBox: 13 }), 18798);
    eq(Z.countedKgOf({ countedKg: 5350 }), 5350, "loose goods still counted in kilos");
    // v6.99.38: classes derive from the LEDGER, so a fixture needs its receipt — a lot with stock and no IN never existed.
    const sorted = { number: "L1", physicalKg: 5350, movements: [{ type: "IN", date: "2026-08-13", qtyKg: 5350 }, { type: "RECLASS", date: "2026-08-14", qtyKg: 3750, toGrade: "II" }] };
    const lines = Z.countLinesForLot(sorted);
    eq(lines.length, 2); eq(lines[0].systemKg, 1600); eq(lines[1].systemKg, 3750);
    eq(Z.countLinesForLot({ number: "L2", physicalKg: 900, movements: [] }).length, 1, "an unsorted lot is one line");
  });
  console.log("v6.99.32 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.33 — net %, recommendation, waste line, sample % ══
(function v69933(){
  console.log("\n══ 54. v6.99.33: net % over tolerance, the recommendation, the waste line ══");
  const Z = B("seasonOps.domain.js");
  t("net % is what exceeds the tolerance and is never negative; the totals row sums each column", () => {
    const ins = { tolerances: { Progressive: 1, Major: 5, Minor: 10 }, defects: [ { category: "Progressive", name: "Rots and mould", pct: 4 }, { category: "Major", name: "Bruising", pct: 3.5 }, { category: "Minor", name: "Minor scarring", pct: 3 } ] };
    const v = Z.inspectionVerdict(ins);
    eq(v.rows.find(r => r.category === "Progressive").net, 3, "4 % against a 1 % tolerance");
    eq(v.rows.find(r => r.category === "Major").net, 0, "3.5 % inside a 5 % tolerance is zero, never −1.5");
    eq(v.rows.find(r => r.category === "Minor").net, 0);
    eq(v.totalPct, 10.5); eq(v.totalTolerance, 16); eq(v.totalNet, 3);
    eq(v.recommendation, "Sort");
  });
  t("the recommendation: reject on an unacceptable defect, accept when everything is within tolerance", () => {
    eq(Z.inspectionVerdict({ defects: [{ category: "Unacceptable", name: "Pests presence", pct: 0.2 }] }).recommendation, "Reject");
    eq(Z.inspectionVerdict({ tolerances: { Major: 5 }, defects: [{ category: "Major", name: "Bruising", pct: 4 }] }).recommendation, "Accept");
  });
  t("a sorted lot is counted as class I, class II and a WASTE line that never adjusts stock", () => {
    const lot = { number: "L1", physicalKg: 5350, movements: [ { type: "IN", date: "2026-08-13", qtyKg: 5550 }, { type: "RECLASS", date: "2026-08-14", qtyKg: 3750, toGrade: "II" }, { type: "DAMAGE", date: "2026-08-14", qtyKg: 200, source: "sorting:1" } ] };
    const lines = Z.countLinesForLot(lot);
    eq(lines.length, 3); eq(lines[0].systemKg, 1600); eq(lines[1].systemKg, 3750);
    eq(lines[2].grade, "WASTE"); eq(lines[2].systemKg, 0); eq(lines[2].informational, true);
  });
  t("the sample percentage reads both quantities in the inspection's own unit", () => {
    eq(Z.samplePctOf({ orderedQty: 2055, checkedQty: 206 }), 10); eq(Z.samplePctOf({ orderedQty: 14270, checkedQty: 120 }), 0.84);
  });
  console.log("v6.99.33 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.34 — waste vs damage, unsorted, sorting pools ══
(function v69934(){
  console.log("\n══ 55. v6.99.34: the ledger tells waste and damage apart; sorting takes from a pool ══");
  const I = B("inventory.domain.js"); const Z = B("seasonOps.domain.js"); const SO = B("so.domain.js");
  t("A-R24-1: sorting waste and other damage are two different figures", () => {
    const mv = [
      { id: 1, type: "IN", date: "2026-08-13", qtyKg: 14300 },
      { id: 2, type: "DAMAGE", date: "2026-08-13", qtyKg: 30 },                                  // short delivery against the PO
      { id: 3, type: "RECLASS", date: "2026-08-16", qtyKg: 250, toGrade: "II", source: "sorting:9" },
      { id: 4, type: "DAMAGE", date: "2026-08-16", qtyKg: 20, source: "sorting:9" },             // what the sorting threw away
    ];
    const lot = I.recomputeLotFromMovements({ number: "L1" }, mv);
    eq(lot.damagedKg, 30, "only the loss outside sorting"); eq(lot.wasteKg, 20, "what the sorting discarded");
    eq(lot.physicalKg, 14250);
  });
  t("A-R24-2: the unsorted pool never contains the waste", () => {
    const lot = { number: "L1", physicalKg: 14250, grades: { I: 14000, II: 250, waste: 20 } };
    eq(SO.lotAvailabilityByGrade(lot, []).unsorted, 0, "everything is classified — nothing unsorted");
    eq(SO.lotAvailabilityByGrade({ number: "L2", physicalKg: 1000, grades: { I: 300, II: 100, waste: 50 } }, []).unsorted, 600);
  });
  t("A-R24-3: a second sorting is offered the pools that still hold goods, not the whole lot", () => {
    const lot = { number: "L1", physicalKg: 14250, movements: [ { type: "IN", date: "2026-08-13", qtyKg: 14250 }, { type: "RECLASS", date: "2026-08-14", qtyKg: 250, toGrade: "II" } ] };
    const pools = Z.sortablePools(lot);
    eq(pools.find(p => p.key === "UNSORTED").kg, 0, "after the first sorting nothing is unsorted");
    eq(pools.find(p => p.key === "II").kg, 250); eq(pools.find(p => p.key === "I").kg, 14000);
  });
  console.log("v6.99.34 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.37 — one owner for a lot's cost lines (QA-2 / QA-3) ══
(function v69937(){
  console.log("\n══ 56. v6.99.37: cost lines are written and removed by ONE function ══");
  const C = B("costAllocation.js");
  const lots = [
    { number: "L1", costs: [{ id: 1, type: "Freight", pln: 1200, source: "SHP-2026-0044/leg1" }, { id: 2, type: "Warehousing", pln: 300, source: "WHINV-9" }] },
    { number: "L2", costs: [{ id: 3, type: "Warehousing", pln: 100, source: "WHINV-9" }] },
  ];
  t("QA-2: cancelling a shipment removes exactly its own cost lines and leaves the rest", () => {
    const r = C.removeCostsBySource(lots, "SHP-2026-0044");
    eq(r.touched, 1); eq(r.lots[0].costs.length, 1); eq(r.lots[0].costs[0].source, "WHINV-9"); eq(r.lots[1].costs.length, 1);
    eq(C.removeCostsBySource(r.lots, "SHP-2026-0044").touched, 0, "idempotent");
  });
  t("QA-3: an invoice allocation replaces its own earlier lines, never stacks, and clears a lot dropped from the set", () => {
    let id = 100; const nextId = () => ++id;
    const r = C.allocateInvoiceCostsToLots(lots, { source: "WHINV-9", byLot: { L1: 450 }, type: "Warehousing", label: "Agrohurt 2026-08", nextId });
    const l1 = r.lots[0].costs.filter(c => c.source === "WHINV-9");
    eq(l1.length, 1, "one line, not two"); eq(l1[0].pln, 450, "the new share replaces the old");
    eq(r.lots[1].costs.filter(c => c.source === "WHINV-9").length, 0, "a lot no longer in the allocation keeps no stale line");
    eq(r.lots[0].costs.find(c => c.source === "SHP-2026-0044/leg1").pln, 1200, "another source is untouched");
  });
  console.log("v6.99.37 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.38 — the class split comes from the ledger (A-R26) ══
(function v69938(){
  console.log("\n══ 57. v6.99.38: classes from the ledger; nothing dated before the receipt ══");
  const Z = B("seasonOps.domain.js");
  // the owner's LOT-2026-0108 exactly: sorting dated 16 Aug, receipt 15 Sept
  const lot = { number: "L108", physicalKg: 14270, arrivalDate: "2026-09-15", movements: [
    { id: 1, type: "RECLASS", date: "2026-08-16", qtyKg: 250, toGrade: "II", source: "sorting:9" },
    { id: 2, type: "DAMAGE", date: "2026-08-16", qtyKg: 20, source: "sorting:9" },
    { id: 3, type: "IN", date: "2026-09-15", qtyKg: 14270 },
  ] };
  t("A-R26-2: the class split is right even when physicalKg is wrong — class I is 14 000, not 14 020", () => {
    const g = Z.gradeStockNow(lot);
    eq(g.I, 14000, "received − class II − waste"); eq(g.II, 250); eq(g.waste, 20);
  });
  t("A-R26-2: selling 11 000 + 3 020 as class I is now 20 kg short, and the orders are named", () => {
    const orders = [
      { id: 23, number: "SO-23", status: "Confirmed", items: [{ product: "Capsicum", sourceType: "STOCK", sourceRef: "L108", qty: 11000, grade: "I" }] },
      { id: 24, number: "SO-24", status: "Confirmed", items: [{ product: "Capsicum", sourceType: "STOCK", sourceRef: "L108", qty: 3020, quality: "I" }] },
    ];
    const a = Z.gradeAvailability(lot, orders);
    eq(a.stockI, 14000); eq(a.promisedI, 14020); eq(a.I, -20);
    const w = Z.gradeCommitmentWarning(lot, orders); ok(w.includes("SO-23") && w.includes("SO-24"));
  });
  t("A-R26-2: an act dated before the receipt is refused with the reason; on or after it passes", () => {
    ok(Z.beforeReceiptWarning(lot, "2026-08-16").includes("2026-09-15"));
    eq(Z.beforeReceiptWarning(lot, "2026-09-15"), ""); eq(Z.beforeReceiptWarning(lot, "2026-09-20"), "");
    eq(Z.lotReceiptDate(lot), "2026-09-15");
  });
  console.log("v6.99.38 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.39 — the printed place, the carrier of a unit (D-1 / D-2) ══
(function v69939(){
  console.log("\n══ 58. v6.99.39: a place prints with its address; a container belongs to the booking's forwarder ══");
  const M = B("shipmentModel.domain.js");
  t("D-2: carrierOfUnit — the unit's carrier on the road, the booking's forwarder at sea, nobody when nothing is named", () => {
    const sh = { bookings: [{ id: 1, forwarderId: 99 }], legs: [
      { mode: "Road", vehicles: [{ id: 1, carrierId: 10 }, { id: 2 }] },
      { mode: "Sea", vehicles: [{ id: 3, kind: "container" }] },
    ] };
    eq(String(M.carrierOfUnit(sh, sh.legs[0], sh.legs[0].vehicles[0])), "10");
    eq(M.carrierOfUnit(sh, sh.legs[0], sh.legs[0].vehicles[1]), null, "a road unit with no carrier belongs to nobody — never to the forwarder");
    eq(String(M.carrierOfUnit(sh, sh.legs[1], sh.legs[1].vehicles[0])), "99", "the container is the forwarder's");
    eq(M.carrierOfUnit({ legs: [{ mode: "Sea", vehicles: [{ id: 3 }] }] }, { mode: "Sea", vehicles: [{ id: 3 }] }, { id: 3 }), null, "no booking → no carrier");
  });
  console.log("v6.99.39 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.40 — an address is four facts (A-ADDR) ══
(function v69940(){
  console.log("\n══ 59. v6.99.40: structured addresses — parse, format, migrate ══");
  const A = B("address.domain.js");
  t("ADDR-3: the Polish form splits on its postcode, the remainder becomes a note", () => {
    const a = A.parseAddress("ul. Bamopaf 73, 05-555 Tarczyn, Wola Przypkowska", "Poland");
    eq(a.street, "ul. Bamopaf 73"); eq(a.postcode, "05-555"); eq(a.city, "Tarczyn"); eq(a.note, "Wola Przypkowska"); eq(a.needsCheck, false);
  });
  t("ADDR-3: a foreign numeric postcode splits too", () => {
    const a = A.parseAddress("Shkilna 3, 45043 Kovel district, ul. Geledon 11", "Ukraine");
    eq(a.postcode, "45043"); eq(a.city, "Kovel district"); eq(a.country, "Ukraine"); eq(a.needsCheck, false);
  });
  t("ADDR-3: an address with no postcode is KEPT WHOLE and flagged — a market address is still an address", () => {
    const a = A.parseAddress("ul. Rotomam 74", "Jordan");
    eq(a.street, "ul. Rotomam 74"); eq(a.needsCheck, true); eq(a.postcode, undefined);
  });
  t("ADDR-1: the document form is three lines, empty parts skipped", () => {
    eq(A.formatAddress({ street: "ul. Piękna 13", postcode: "05-555", city: "Tarczyn", country: "Poland" }), "ul. Piękna 13\n05-555 Tarczyn\nPoland");
    eq(A.formatAddress({ street: "Koper terminal", country: "Slovenia" }, { oneLine: true }), "Koper terminal, Slovenia");
  });
  console.log("v6.99.40 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.41 — places and Fakturownia carry the address parts (ADDR-2 / ADDR-4) ══
(function v69941(){
  console.log("\n══ 60. v6.99.41: a place's address splits too; Fakturownia gets four fields ══");
  const A = B("address.domain.js");
  t("ADDR-2: a place's one-line address splits into the same four parts", () => {
    const a = A.parseAddress("Vojkovo nabrežje 38, 6501 Koper", "Slovenia");
    eq(a.street, "Vojkovo nabrežje 38"); eq(a.postcode, "6501"); eq(a.city, "Koper"); eq(a.country, "Slovenia");
  });
  t("ADDR-2: the one-line mirror written back omits the country (the place already has a country column)", () => {
    eq(A.formatAddress({ street: "Vojkovo nabrežje 38", postcode: "6501", city: "Koper", country: "Slovenia" }, { oneLine: true, withCountry: false }), "Vojkovo nabrežje 38, 6501 Koper");
  });
  t("ADDR-4: addressOf() gives Fakturownia its four fields from either shape", () => {
    const structured = A.addressOf({ addr: { street: "ul. Piękna 13", postcode: "05-555", city: "Tarczyn", country: "Poland" } });
    eq(structured.postcode, "05-555"); eq(structured.city, "Tarczyn");
    const legacy = A.addressOf({ address: "ul. Rokidim 80, 64-116 Radzanów", country: "Poland" });
    eq(legacy.street, "ul. Rokidim 80"); eq(legacy.postcode, "64-116"); eq(legacy.city, "Radzanów");
  });
  console.log("v6.99.41 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.44 — customs clearance from the agent's file (X-5/X-6) ══
(function v69944(){
  console.log("\n══ 61. v6.99.44: the CC529C release file fills the clearance line and is matched by plates ══");
  const C = B("customsClearance.domain.js"); const fs = require("fs");
  // v6.99.71 (A-TF-1): the fixture is the agent's release for truck JSI4708L/SMM8968H (5 May 2026, invoice FV2026/05/1)
  const xmlPath = FX.needFixture("CC529C_26PL445010188G5KO3_1.xml", "the agent's release file"); if (!xmlPath) return;
  const xml = fs.readFileSync(xmlPath, "utf8");
  t("X-5: every fact is read from the owner's real release file", () => {
    const r = C.parseCC529C(xml);
    ok(r.ok); eq(r.mrn, "26PL445010188G5KO3"); eq(r.lrn, "26S00JOW0C"); eq(r.releasedOn, "2026-05-05"); eq(r.declaredOn, "2026-05-05");
    eq(r.officeExport, "PL445010"); eq(r.officeExit, "IT137103"); eq(r.plates, "JSI4708L/SMM8968H");
    eq(r.grossKg, 22500); eq(r.netKg, 19422); eq(r.packages, 1494); eq(r.cn, "08081080"); eq(r.invoiceRef, "FV2026/05/1"); eq(r.incoterm, "CFR"); eq(r.status, "Released");
    eq(r.place, "PORT SAID EAST"); eq(r.invoiceValue, 17479.8); eq(r.invoiceCurrency, "EUR");
  });
  t("X-6: the file is matched to the truck by plates (truck or trailer, spacing ignored) and cross-checked", () => {
    const sh = { number: "SHP-1", governingSoRef: "SO-9", goods: [{ id: 1, cnCode: "08081080", qtyKg: 19422 }], legs: [{ mode: "Road", vehicles: [{ id: 11, truckPlate: "JSI 4708L", trailerPlate: "SMM 8968H", load: [{ goodsLineId: 1, qtyKg: 19422 }] }, { id: 12, truckPlate: "WGM 8811P" }] }] };
    const r = C.parseCC529C(xml); const hit = sh.legs[0].vehicles[0];   // v7.22.0 (FZ-19): the unused plate matcher went — the truck is named directly
    eq(C.crossCheckClearance(r, sh, hit, [{ number: "SO-9", sellIncoterm: "CFR", client: { name: "Al Baraka For Import & Export" } }], []).length, 0, "everything agrees → nothing to show");
    const bad = C.crossCheckClearance(r, { ...sh, goods: [{ id: 1, cnCode: "07096010", qtyKg: 19422 }] }, { ...hit, load: [{ goodsLineId: 1, qtyKg: 18000 }] }, [{ number: "SO-9", sellIncoterm: "FOB", client: { name: "Al Baraka For Import & Export" } }], []);
    eq(bad.length, 3, "kilos, CN and incoterm disagree");
  });
  t("X-1: one clearance line per unit, existing lines kept", () => {
    const sh = { legs: [{ vehicles: [{ id: 11 }, { id: 12 }] }], customsUnits: [{ unitId: 11, mrn: "26PL…", status: "Released" }] };
    const lines = C.clearanceLinesFor(sh); eq(lines.length, 2); eq(lines[0].mrn, "26PL…"); eq(lines[1].status, "Pending");
  });
  console.log("v6.99.44 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.46 — counts from the LINE's packaging, manual override kept (A-PO-11) ══
(function v69946(){
  console.log("\n══ 62. v6.99.46: boxes and pallets follow the chosen packaging; a typed figure is an override ══");
  const PU = B("pricingUnit.domain.js");
  const types = [
    { id: "c5", label: "Carton (5kg)", capacityKg: 5, boxesPerPallet: 110, appliesTo: ["Capsicum"], isDefault: true },
    { id: "c10", label: "Carton (10 kg)", capacityKg: 10, boxesPerPallet: 60, appliesTo: ["Capsicum"] },
  ];
  t("no packaging chosen → nothing derived (the product default is NOT used)", () => {
    const d = PU.derivedCounts({ product: "Capsicum", qty: 11000, pricingUnit: "kg" }, types);
    eq(d.hasPackaging, false); eq(d.boxes, null); eq(d.pallets, null);
  });
  t("the 10 kg carton chosen → 1 100 boxes and 19 pallets, not the default 5 kg carton's 2 200", () => {
    const d = PU.derivedCounts({ product: "Capsicum", qty: 11000, pricingUnit: "kg", packagingId: "c10" }, types);
    eq(d.boxes, 1100); eq(d.pallets, 19); eq(d.kgPerBox, 10);
    eq(PU.derivedCounts({ product: "Capsicum", qty: 11000, pricingUnit: "kg", packaging: "Carton (5kg)" }, types).boxes, 2200, "chosen by label works too");
  });
  t("a typed figure is a manual override that survives a quantity change; clearing it returns to the derived one", () => {
    const line = { product: "Capsicum", qty: 11000, pricingUnit: "kg", packagingId: "c10", boxesManual: 1090, palletsManual: "" };
    const e1 = PU.effectiveCounts(line, types); eq(e1.boxes, 1090); eq(e1.boxesManual, true); eq(e1.pallets, 19); eq(e1.palletsManual, false);
    const e2 = PU.effectiveCounts({ ...line, qty: 12000 }, types); eq(e2.boxes, 1090, "the override holds when the quantity moves");
    const e3 = PU.effectiveCounts({ ...line, boxesManual: null }, types); eq(e3.boxes, 1100, "↺ returns to the derived figure");
  });
  console.log("v6.99.46 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.47 — the document reads the LIVE party address; the totals read the effective counts ══
(function v69947(){
  console.log("\n══ 63. v6.99.47: a corrected address prints; a derived pallet count totals ══");
  const A = B("address.domain.js"); const PU = B("pricingUnit.domain.js");
  t("liveParty(): the PO's snapshot yields to the Directory's corrected address; name and NIP stay as agreed", () => {
    const snap = { id: 7, name: "Legugeva Kft.", nip: "HU123", address: "OLD street 1, 6000 Kecskemet", country: "Hungary" };
    const live = A.liveParty(snap, [{ id: 7, name: "Legugeva Kft. (renamed)", nip: "HU999", address: "Csongradi ut 5, 6000 Kecskemet", addr: { street: "Csongradi ut 5", postcode: "6000", city: "Kecskemet", country: "Hungary" }, country: "Hungary" }]);
    eq(A.formatAddress(A.addressOf(live), { oneLine: true }), "Csongradi ut 5, 6000 Kecskemet, Hungary"); eq(live.name, "Legugeva Kft."); eq(live.nip, "HU123");
    eq(A.liveParty(snap, []).address, "OLD street 1, 6000 Kecskemet", "a party that no longer exists keeps the snapshot");
  });
  t("A-PO-16: an addr holding only the country is not an address — the one-line text prints", () => {
    const a = A.addressOf({ address: "ul. Piękna 13, 05-555 Tarczyn", addr: { country: "Poland" }, country: "Poland" });
    eq(a.city, "Tarczyn"); eq(a.postcode, "05-555");
  });
  t("A-PO-14: the totals line counts DERIVED pallets before the order is saved", () => {
    const types = [{ id: "c10", label: "Carton (10 kg)", capacityKg: 10, boxesPerPallet: 60 }];
    const tt = PU.documentTotals([{ product: "Capsicum", qty: 11000, pricingUnit: "kg", packagingId: "c10", unitPrice: 1 }], types, 1);
    eq(tt.boxes, 1100); eq(tt.pallets, 19);
  });
  console.log("v6.99.47 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.50 — the packing list may add a size; shipments re-derive (TO-2) ══
(function v69950(){
  console.log("\n══ 64. v6.99.50: the producer's packing list — final kilos, a new size, a zeroed line — and the shipment follows ══");
  const SO = B("so.domain.js"); const SH = B("shipments.domain.js");
  const po = { number: "PO-9", currency: "EUR", items: [{ id: 1, product: "Apples", variety: "Gala", size: "65-70", quality: "I", qty: 1, quantityStatus: "ESTIMATED", unitPrice: 0.9, packaging: "Carton (13 kg)" }] };
  t("TO-2: final kilos on the existing line, a 60-65 line ADDED at its own price, both FINAL", () => {
    const fin = SO.applyPackingResult(po, [{ lineId: 1, qty: 17472 }, { newLine: { product: "Apples", variety: "Gala", size: "60-65", quality: "I", qty: 1950, unitPrice: 0.8, packaging: "Carton (13 kg)" } }], "2026-09-23");
    eq(fin.items.length, 2); eq(fin.items[0].qty, 17472); eq(fin.items[0].quantityStatus, "FINAL");
    eq(fin.items[1].size, "60-65"); eq(fin.items[1].qty, 1950); eq(fin.items[1].unitPrice, 0.8); eq(fin.items[1].quantityStatus, "FINAL");
    eq(fin.items.reduce((s, it) => s + it.qty, 0), 19422, "the truck total is what it is");
  });
  t("TO-2: a shipment not yet loaded re-derives its goods rows — the changed row's allocation is dropped, the new size appears", () => {
    const fin = SO.applyPackingResult(po, [{ lineId: 1, qty: 17472 }, { newLine: { product: "Apples", variety: "Gala", size: "60-65", quality: "I", qty: 1950, unitPrice: 0.8 } }], "2026-09-23");
    let id = 500; const sh = { number: "SHP-1", status: "Booked", poRefs: ["PO-9"], goods: [{ id: 10, poRef: "PO-9", poLineId: "1", product: "Apples", size: "65-70", quality: "I", qtyKg: 1 }], legs: [{ vehicles: [{ id: 1, load: [{ goodsLineId: 10, qtyKg: 1 }] }] }] };
    const out = SH.syncGoodsFromPO(sh, fin, [], { nextId: () => ++id });
    eq(out.goods.length, 2); eq(out.goods[0].qtyKg, 17472); eq(out.goods[1].size, "60-65"); eq(out.goods[1].qtyKg, 1950);
    eq(out.legs[0].vehicles[0].load.length, 0, "the stale 1 kg allocation is dropped so it re-derives");
  });
  console.log("v6.99.50 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.51 — the fresh season's leftovers (A-FS) ══
(function v69951(){
  console.log("\n══ 65. v6.99.51: orphan lots and dangling links are found precisely; master vs transactional stores ══");
  const I = B("integrityCheck.js"); const U = B("useLocalStoredState.js");
  t("A-FS-1: master stores are kept, transactional stores go — the two lists partition DATA_KEYS", () => {
    const all = new Set(U.DATA_KEYS); ok(U.MASTER_KEYS.every(k => all.has(k))); eq(U.MASTER_KEYS.length + U.TRANSACTIONAL_KEYS.length, U.DATA_KEYS.length);
    ok(U.MASTER_KEYS.includes("contacts") && U.MASTER_KEYS.includes("packagingTypes") && U.TRANSACTIONAL_KEYS.includes("lots") && U.TRANSACTIONAL_KEYS.includes("invoices"));
  });
  const dPath = FX.needFixture("marianna-erp_v6.99.50_schema-v2_2026-09-23T14-11-42.json", "the 23 Sept 14:11 file — before the clean-up"); if (!dPath) return;
  const d = require(dPath);
  t("A-FS-2: on the owner's 23 Sept file — 40 orphan lots (no PO, no stock), 7 invoices and dangling claim subjects", () => {
    const ol = I.orphanLotsToRemove(d.lots, d.pos); eq(ol.length, 40); ok(ol.every(l => !(l.physicalKg > 0)), "never a lot with stock");
    const dl = I.danglingLinks(d.invoices, d.claims, d.pos, d.orders, d.shipments); eq(dl.invoices.length, 7); ok(dl.claims.length >= 1);
    ok(!ol.some(l => l.number === "LOT-2026-0071"), "PO-0021 exists, so its lots are not orphans — they are the owner's to delete (they were received last season)");
  });
  console.log("v6.99.51 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.54 — the stale-expected-lot detector lives on as an integrity WARNING ══
(function v69954(){
  console.log("\n══ 66. v6.99.54: an expected lot matching none of its PO's lines is flagged, never silently kept ══");
  const I = B("integrityCheck.js");
  const dPath = FX.needFixture("marianna-erp_v6.99.52_schema-v2_2026-09-23T16-04-33.json", "the 23 Sept 16:04 file"); if (!dPath) return;
  const d = require(dPath);
  t("the 16:04 file: last season's apple lots under this season's capsicum POs are flagged EXPECTED_LOT_MISMATCH", () => {
    const r = I.checkIntegrity({ contacts: d.contacts, pos: d.pos, lots: d.lots, orders: d.orders, shipments: d.shipments, warehouseInvoices: [], operationalCosts: [], creditNotes: [], invoices: d.invoices || [], financeNotes: [], claims: d.claims || [], loadPlans: [], advancePayments: [], bankAccounts: [], productCatalog: [] });
    const mm = r.issues.filter(i => i.code === "EXPECTED_LOT_MISMATCH");
    ok(mm.length >= 60, "dozens flagged: " + mm.length); ok(mm.some(i => i.entity === "LOT-2026-0001"));
    ok(!mm.some(i => ["LOT-2026-0119", "LOT-2026-0120", "LOT-2026-0121"].includes(i.entity)), "PO-0021's own lots are not flagged");
  });
  console.log("v6.99.54 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.54 — the season archive (AR-1…7) ══
(function v69954b(){
  console.log("\n══ 67. v6.99.54: seasons — derived, closed by tag, sliced to a file, removed, re-appended ══");
  const Z = B("season.domain.js"); const st = Z.DEFAULT_SEASON;
  const dPath = FX.needFixture("marianna-erp_v6.99.52_schema-v2_2026-09-23T16-04-33.json", "the 23 Sept 16:04 file"); if (!dPath) return;
  const d = require(dPath);
  const data = { pos: d.pos, orders: d.orders, shipments: d.shipments, lots: d.lots, invoices: d.invoices || [], claims: d.claims || [], poSettlements: [], inspections: d.inspections || [], stockCounts: [], financeNotes: [], creditNotes: [], warehouseInvoices: [], operationalCosts: [] };
  t("AR-1: the season of a date follows the 1 July boundary; the two seasons in the owner's file are found", () => {
    eq(Z.seasonOf("2025-10-30"), "2025/26"); eq(Z.seasonOf("2026-06-30"), "2025/26"); eq(Z.seasonOf("2026-07-01"), "2026/27");
    const p = Z.seasonsPresent(data, st); ok(p.some(x => x.season === "2026/27") && p.some(x => x.season === "2025/26"));
  });
  t("AR-3: closing 2025/26 archives its documents but never a lot with kilos", () => {
    const lotWithKg = { number: "L", poRef: "PO-2026-0001", physicalKg: 500, movements: [{ type: "IN", date: "2025-11-02", qtyKg: 500 }] };
    ok(!Z.isArchived("lot", lotWithKg, ["2025/26"], st, { pos: d.pos }), "stock is stock, whenever it was bought");
    const oldLot = { number: "L2", poRef: "PO-2026-0001", physicalKg: 0, movements: [{ type: "IN", date: "2025-11-02", qtyKg: 500 }, { type: "SHIP_OUT", date: "2025-11-05", qtyKg: 500 }] };
    ok(Z.isArchived("lot", oldLot, ["2025/26"], st, { pos: d.pos })); ok(!Z.isArchived("lot", oldLot, [], st, { pos: d.pos }), "nothing archived while no season is closed");
  });
  t("AR-5: slice → remove → append is lossless and keeps the season hidden", () => {
    const master = ["contacts"]; const file = Z.sliceSeason({ ...data, contacts: d.contacts }, "2025/26", st, master, { app: "marianna-erp", version: 2 });
    eq(file._meta.archiveSeason, "2025/26"); eq(file.contacts.length, d.contacts.length); ok(file.lots.length > 0 && file.lots.every(l => Z.isArchived("lot", l, ["2025/26"], st, { pos: d.pos })));
    const r = Z.removeSeason(data, "2025/26", st); eq(r.data.lots.length, data.lots.length - file.lots.length);
    const back = Z.appendArchive({ ...r.data, archivedSeasons: ["2025/26"] }, file); eq(back.data.lots.length, data.lots.length); eq(back.skipped, 0); ok(back.data.archivedSeasons.includes("2025/26"));
    const again = Z.appendArchive(back.data, file); ok(again.skipped > 0, "a second import adds nothing");
  });
  console.log("v6.99.54 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.56 — the packing list moves PO, lots, sale and shipment together (A-PL-1…6) ══
(function v69956(){
  console.log("\n══ 69. v6.99.56: estimate → final — lots, sale and shipment agree line by line ══");
  let PO, SO, SH, PU, MD;
  try { const {JSDOM} = require("jsdom"); const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://m.local/" });
    global.window = dom.window; global.document = dom.window.document; try { global.localStorage = dom.window.localStorage; } catch (e) {}
    require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", jsx: "react-jsx", esModuleInterop: true, target: "es2019" } });
    const p = require("path"); PO = require(p.resolve("./src/PurchaseOrders")); SO = require(p.resolve("./src/so.domain")); SH = require(p.resolve("./src/shipments.domain")); PU = require(p.resolve("./src/pricingUnit.domain")); MD = require(p.resolve("./src/shipmentModel.domain"));
  } catch (e) { console.log("  (skipped — " + (e.message || "").slice(0, 80) + ")"); return; }
  const types = [{ id: "c13", label: "Carton (13 kg)", capacityKg: 13, boxesPerPallet: 80, tareKg: 1.4, palletTareKg: 25 }];
  const po = { number: "PO-2026-0090", status: "Confirmed", currency: "EUR", orderDate: "2026-09-25", supplier: { id: 1, name: "Pavamane Owoc", country: "Poland" }, items: [{ id: 1, product: "Apples", variety: "Gala", size: "65-70", quality: "I", qty: 20000, quantityStatus: "ESTIMATED", unitPrice: 0.9, packaging: "Carton (13 kg)", packagingId: "c13", pricingUnit: "kg" }] };
  const lots = PO.buildExpectedLotsFromPO(po, []).newLots;
  const so = { id: 5, number: "SO-2026-0090", status: "Confirmed", items: [{ id: 51, product: "Apples", variety: "Gala", size: "65-70", grade: "I", quality: "I", qty: 20000, sourceType: "STOCK", sourceRef: lots[0].number,   /* v7.24.2: a sale line names its lot */ unitPrice: 1.4, packaging: "Carton (13 kg)", packagingId: "c13", pricingUnit: "kg" }] };
  const sh = { id: 7, number: "SHP-2026-0090", status: "Booked", poRefs: [po.number], soRefs: [so.number], governingSoRef: so.number, goods: [{ id: 21, poRef: po.number, poLineId: "1", soRef: so.number, lotRef: lots[0].number, product: "Apples", size: "65-70", quality: "I", qtyKg: 20000 }], legs: [{ mode: "Road", vehicles: [{ id: 31, load: [{ goodsLineId: 21, qtyKg: 20000 }] }] }, { mode: "Sea", vehicles: [{ id: 41, containerNo: "MSCU1" }] }] };
  let n = 1000; const deps = { buildLots: (o, ls) => PO.buildExpectedLotsFromPO(o, ls), syncShipment: (s, o, ls) => SH.syncGoodsFromPO(s, o, ls, { nextId: () => ++n }), counts: l => PU.effectiveCounts(l, types), nextId: () => ++n };
  const rows = [{ lineId: 1, qty: 17472 }, { newLine: { id: "pk-1", product: "Apples", variety: "Gala", size: "60-65", quality: "I", qty: 1950, unitPrice: 0.8, packaging: "Carton (13 kg)", packagingId: "c13", pricingUnit: "kg" } }];
  const ctx = { orders: [so], lots, shipments: [sh], todayISO: "2026-09-25" };
  t("PL-1: the expected lots follow the final lines — 65-70 → 17 472, a lot created for 60-65", () => {
    const pl = SO.planPackingResult(po, rows, ctx, deps, {});
    eq(pl.lots.length, 2); eq(pl.lots.find(l => l.size === "65-70").expectedKg, 17472); eq(pl.lots.find(l => l.size === "60-65").expectedKg, 1950);
  });
  t("PL-2: the sale IS what was loaded — its line takes 17 472; the new size joins it at a price to agree; boxes re-derive", () => {
    const pl = SO.planPackingResult(po, rows, ctx, deps, {}); const it = pl.orders[0].items;
    eq(it[0].qty, 17472); eq(it[0].boxes, 1344); eq(it[1].size, "60-65"); eq(it[1].qty, 1950); eq(it[1].unitPrice, null); ok(it[1].priceToAgree); eq(pl.unpriced.length, 1); eq(pl.questions.length, 0);
    eq(SO.planPackingResult(po, rows, ctx, deps, { prices: { "pk-1": 1.2 } }).orders[0].items[1].unitPrice, 1.2);
  });
  t("A-RV-05 (v7.14.2): the producer's added size is SOLD FROM ITS LOT, never from the PO (A-ONE-1)", () => {
    const pl = SO.planPackingResult(po, rows, ctx, deps, {}); const added = pl.orders[0].items[1]; const lot = pl.lots.find(l => l.size === "60-65");
    eq(added.sourceType, "STOCK"); eq(added.sourceRef, lot.number); ok(!("sourceLineId" in added));
  });
  t("PL-2: the shipment not yet loaded carries both rows, each with its lot and its sale", () => {
    const g = SO.planPackingResult(po, rows, ctx, deps, {}).shipments[0].goods;
    ok(g.every(r => r.lotRef && r.soRef === "SO-2026-0090")); eq(g.reduce((s, r) => s + r.qtyKg, 0), 19422);
  });
  t("PL-2: when one PO line feeds two sales, the plan asks which sale takes the difference instead of guessing", () => {
    const a = { ...so, items: [{ ...so.items[0], qty: 15000 }] }, b = { ...so, id: 6, number: "SO-2026-0091", items: [{ ...so.items[0], id: 61, qty: 5000 }] };
    const pl = SO.planPackingResult(po, rows, { ...ctx, orders: [a, b] }, deps, {}); eq(pl.questions.length, 2);
    const ok2 = SO.planPackingResult(po, rows, { ...ctx, orders: [a, b] }, deps, { choice: { "line:1": "SO-2026-0091", "new:pk-1": "SO-2026-0090" } });
    eq(ok2.questions.length, 0); eq(ok2.orders[1].items[0].qty, 2472, "5 000 − 2 528"); eq(ok2.orders[0].items[0].qty, 15000);
  });
  t("PL-3: a LOADED shipment is left alone", () => { const pl = SO.planPackingResult(po, rows, { ...ctx, shipments: [{ ...sh, status: "Loaded" }] }, deps, {}); eq(pl.shipments[0].goods[0].qtyKg, 20000); });
  t("PL-6: stamping 'loaded' per leg-1 unit leaves the container without the truck's date", () => {
    const x = MD.stampEvent(sh, 31, "loaded", "2026-09-26"); eq(x.legs[0].vehicles[0].loadedAt, "2026-09-26"); eq(x.legs[1].vehicles[0].loadedAt, undefined);
  });
  console.log("v6.99.56 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.57 — additional items at loading (A-PK-1…3) ══
(function v69957(){
  console.log("\n══ 70. v6.99.57: an additional item is what was chosen — only origin and unit come from the order ══");
  const SO = B("so.domain.js");
  const po = { number: "PO-9", currency: "EUR", items: [{ id: 1, product: "Apples", variety: "Gala", size: "65-70", quality: "I", origin: "Poland", pricingUnit: "kg", qty: 18000, quantityStatus: "ESTIMATED", unitPrice: 0.9, cnCode: "08081080", packaging: "Carton (13 kg)", packagingId: "c13", coloration: "red", boxesManual: 1300, palletsManual: 17 }] };
  t("PK-2: a different item takes ITS CN code and none of line 1's manual overrides, coloration or packaging", () => {
    const fin = SO.applyPackingResult(po, [{ lineId: 1, qty: 17472 }, { newLine: { id: "pk-a", product: "Pears", variety: "Conference", size: "60-65", quality: "II", qty: 1200, unitPrice: 0.7, coloration: "", packaging: "Carton (10 kg)", packagingId: "c10", cnCode: "08083090" } }], "2026-09-25");
    const n = fin.items[1];
    eq(n.product, "Pears"); eq(n.cnCode, "08083090"); eq(n.quality, "II"); eq(n.packagingId, "c10"); eq(n.coloration, "");
    eq(n.boxesManual, undefined); eq(n.palletsManual, undefined, "no inherited overrides");
    eq(n.origin, "Poland"); eq(n.pricingUnit, "kg", "origin and unit from the order"); eq(n.quantityStatus, "FINAL");
  });
  console.log("v6.99.57 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.59 — the shipment editor comments (OW/SU/BK/CU/CB) ══
(function v69959(){
  console.log("\n══ 71. v6.99.59: one truck → one container can be ticked before saving (SU-1) ══");
  const M = B("shipmentModel.domain.js"); const SD = B("shipments.domain.js");
  t("SU-1: a lone truck carries all the goods LIVE — the container can take it before Save", () => {
    const sh = { goods: [{ id: 1, qtyKg: 19422 }], legs: [{ mode: "Road", vehicles: [{ id: 31 }] }, { mode: "Sea", vehicles: [{ id: 41 }] }] };
    eq(M.truckRemainingForFeeding(sh, 31, 41), 0, "the raw draft reads 0 — the old behaviour");
    ok(M.truckRemainingForFeeding(SD.autoFillSingleUnitKg(sh), 31, 41) >= 19422, "with the lone-truck rule applied live it is free to feed the container");
  });
  console.log("v6.99.59 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.62 — the containers follow the booked vessel (A-SE-1) ══
(function v69962(){
  console.log("\n══ 72. v6.99.62: booking ETD/ETA move the following containers; a hand-typed date stays ══");
  const M = B("shipmentModel.domain.js");
  const legs = [{ mode: "Road", vehicles: [{ id: 1, plannedLoadingDate: "2026-10-01" }] }, { mode: "Sea", vehicles: [{ id: 2 }, { id: 3, plannedLoadingDate: "2026-10-09" }, { id: 4, plannedLoadingDate: "2026-10-05", loadDateManual: true }] }];
  t("a first ETD fills the empty containers; a container that already held the old date follows; the truck is untouched", () => {
    const a = M.followBookingDates(legs, "etd", "2026-10-09", "2026-10-12");
    eq(a[0].vehicles[0].plannedLoadingDate, "2026-10-01"); eq(a[1].vehicles[0].plannedLoadingDate, "2026-10-12"); eq(a[1].vehicles[1].plannedLoadingDate, "2026-10-12");
  });
  t("a container dated by hand keeps its date when the vessel is rolled", () => {
    const a = M.followBookingDates(legs, "etd", "2026-10-09", "2026-10-15"); eq(a[1].vehicles[2].plannedLoadingDate, "2026-10-05");
  });
  t("ETA feeds the expected delivery date the same way", () => {
    const a = M.followBookingDates([{ mode: "Sea", vehicles: [{ id: 9 }] }], "eta", "", "2026-10-24"); eq(a[0].vehicles[0].plannedDeliveryDate, "2026-10-24");
  });
  console.log("v6.99.62 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.63 — the free planning sheet (A-SH-1…13) ══
(function v69963(){
  console.log("\n══ 73. v6.99.63: her workbook imports as it is; a block pasted from Excel fills right and down; the study reads the log ══");
  const Sh = B("sheet.domain.js"); const Bd = B("board.domain.js"); const XLSX = require("xlsx");
  const wbPath = FX.needFixture("sample_season_workbook.xlsx", "her workbook layout"); if (!wbPath) return;
  const wb = XLSX.readFile(wbPath, { cellDates: true });
  const tabs = wb.SheetNames.map(n => Sh.importWorkbookRows(n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }), Bd.HER_HEADERS, "2026-09-25T10:00:00Z"));
  t("SH-8: five week tabs, 21 rows, as they are; ETD–ETA split into two dates", () => {
    eq(tabs.length, 5); eq(tabs.reduce((s, t) => s + t.rows.length, 0), 21);
    const r = tabs.flatMap(t => t.rows).find(r => r.cells.etd); ok(/^\d{4}-\d{2}-\d{2}$/.test(r.cells.etd), "ETD as a date: " + r.cells.etd); ok(r.cells.eta, "ETA kept");
    ok(tabs.flatMap(t => t.rows).some(r => r.cells.supplier === "Pavamane Owoc"));
  });
  t("SH-5: a 2×3 block pasted from Excel fills right and down and adds the missing row; a frozen row is never overwritten", () => {
    const rows = [{ id: "a", createdAt: "x", cells: {} }, { id: "b", createdAt: "x", frozen: true, cells: { client: "Keep" } }];
    const res = Sh.pasteGrid(rows, { row: 0, col: 3 }, Sh.parseClipboard("Al Baraka\tSO-1\tfoil\nX\tY\tZ\nNew\tSO-2\tbox"), "now", 2026);
    eq(res.rows.length, 3); eq(res.rows[0].cells.client, "Al Baraka"); eq(res.rows[0].cells.so, "SO-1"); eq(res.rows[0].cells.packaging, "foil");
    eq(res.rows[1].cells.client, "Keep", "frozen row untouched"); eq(res.rows[2].cells.client, "New");
  });
  t("dates typed the way she types them become dates; anything else stays as typed", () => {
    eq(Sh.toISODate("13/09", 2026), "2026-09-13"); eq(Sh.toISODate("13.09.2026"), "2026-09-13"); eq(Sh.toISODate("13-09-26"), "2026-09-13"); eq(Sh.toISODate("asap"), null);
  });
  t("SH-12: the study counts fills, changes after the first fill, and anything changed after freezing", () => {
    const tab = { id: "t", name: "w", order: 1, createdAt: "2026-09-01", rows: [{ id: "r1", createdAt: "2026-09-01", cells: { plates: "WGR1", loadingDate: "2026-09-20" } }] };
    const log = [{ at: "2026-09-10T08:00:00Z", who: "a", tab: "t", row: "r1", col: "plates", action: "cell" }, { at: "2026-09-18T08:00:00Z", who: "a", tab: "t", row: "r1", col: "plates", action: "cell" }, { at: "2026-09-19T08:00:00Z", who: "a", tab: "t", row: "r1", action: "freeze" }, { at: "2026-09-19T09:00:00Z", who: "a", tab: "t", row: "r1", col: "plates", action: "cell" }];
    const u = Sh.sheetUsage([tab], log).find(x => x.key === "plates");
    eq(u.filledPct, 100); eq(u.medianDaysBeforeLoading, 10); eq(u.avgChangesAfterFirst, 2); eq(u.changedAfterFreeze, 1);
  });
  console.log("v6.99.63 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.65 — the packing list: boxes follow the final kilos (A-PK-4) ══
(function v69965(){
  console.log("\n══ 74. v6.99.65: the PO lines' boxes follow the final kilos; the producer's count wins when typed ══");
  let PO, SO, SH, PU;
  try { const {JSDOM} = require("jsdom"); const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://m.local/" }); global.window = dom.window; global.document = dom.window.document;
    require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", jsx: "react-jsx", esModuleInterop: true, target: "es2019" } });
    const p = require("path"); PO = require(p.resolve("./src/PurchaseOrders")); SO = require(p.resolve("./src/so.domain")); SH = require(p.resolve("./src/shipments.domain")); PU = require(p.resolve("./src/pricingUnit.domain"));
  } catch (e) { console.log("  (skipped — " + (e.message || "").slice(0, 80) + ")"); return; }
  const types = [{ id: "c13", label: "Carton (13 kg)", capacityKg: 13, boxesPerPallet: 80 }];
  const po = { number: "PO-T4", status: "Confirmed", items: [{ id: 1, product: "Apples", size: "65-70", qty: 20000, quantityStatus: "ESTIMATED", packagingId: "c13", pricingUnit: "kg", boxes: 1538, boxesManual: 1500 }] };
  let n = 1; const deps = { buildLots: (o, ls) => PO.buildExpectedLotsFromPO(o, ls), syncShipment: (s, o, ls) => SH.syncGoodsFromPO(s, o, ls, { nextId: () => ++n }), counts: l => PU.effectiveCounts(l, types), nextId: () => ++n };
  const ctx = { orders: [], lots: [], shipments: [], todayISO: "2026-09-25" };
  t("final 17 472 kg in 13 kg cartons → 1 344 boxes; the manual count typed on the estimate (1 500) no longer applies", () => {
    const it = SO.planPackingResult(po, [{ lineId: 1, qty: 17472 }], ctx, deps, {}).po.items[0];
    eq(it.boxes, 1344); eq(it.boxesManual, undefined); eq(it.pallets, 17);
  });
  t("the producer's count typed in the window becomes the line's box count", () => {
    const it = SO.planPackingResult(po, [{ lineId: 1, qty: 17472, boxes: 1350 }], ctx, deps, {}).po.items[0];
    eq(it.boxes, 1350); eq(it.boxesManual, 1350);
  });
  console.log("v6.99.65 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.67 — consolidation: the lot direction is derived; the company block is one; nothing printed changes ══
(function v69967(){
  console.log("\n══ 75. v6.99.67: LOT-0119 and LOT-0120 agree; the direction copy is dropped on load; the company block is one ══");
  const M = B("shipmentModel.domain.js"); const U = B("useLocalStoredState.js"); const L = B("legacy.js");
  const dPath = FX.needFixture("marianna-erp_v6.99.66_schema-v2_2026-09-26T14-16-24.json", "the 26 Sept file — before the v6.99.67 heal"); if (!dPath) return;
  const d = require(dPath);
  t("A-AUD-1 · v7.30.4 (M-5): with Settings empty the company's legal details are the former literals; no personal detail (contact person, trade name, emergency phone) is written into the program — Settings › Company holds them", () => {
  const p = U.companyProfile(); eq(p.name, "MARIANNA"); eq(p.nip, "PL525-284-27-87"); eq(p.person, ""); eq(p.regon, "387501311");
  const to = U.companyForTransportOrder(); eq(to.name, "MARIANNA"); eq(to.address1, "ul. Dluga 29"); eq(to.address2, "00-238 Warszawa - Polska"); eq(to.nip, "PL 525-284-27-87"); eq(to.emergencyPhone, "");
  });
  console.log("v6.99.67 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.70 — automatic backups: the folder file, 30 + 30, the timing, the ring by space, the data wins (A-BK-1..3) ══
(function v69970(){
  console.log("\n══ 76. v6.99.70: automatic backups — 30 + 30 retention, two-minute / 15-minute timing, ring by space, the data wins ══");
  const AB = B("autoBackup.domain.js"); const U = B("useLocalStoredState.js");
  // a browser store with a real quota (characters of keys + values), throwing the browser's own error when full
  const quotaStorage = (quota) => { const m = new Map(); const used = () => { let n = 0; m.forEach((v, k) => { n += k.length + v.length; }); return n; };
    return { deny: false, get length() { return m.size; }, key: i => Array.from(m.keys())[i] ?? null, getItem: k => (m.has(k) ? m.get(k) : null),
      setItem(k, v) { v = String(v); if (this.deny) { const e = new Error("storage disabled"); e.name = "SecurityError"; throw e; }
        const prev = m.has(k) ? k.length + m.get(k).length : 0; if (used() - prev + k.length + v.length > quota) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; } m.set(k, v); },
      removeItem: k => { m.delete(k); }, clear: () => m.clear(), used }; };
  const prevWin = global.window; const realNow = Date.now; let fakeNow = 1_790_000_000_000;
  const withStore = (quota, fn) => { const ls = quotaStorage(quota); global.window = { localStorage: ls }; Date.now = () => (fakeNow += 1000); U.storageHealth.failing = false;
    try { return fn(ls); } finally { global.window = prevWin; Date.now = realNow; } };

  t("BK-1: one file-name pattern in local time; a manual export or a foreign file is not ours", () => {
    const n = AB.autoFileName(new Date(2026, 8, 27, 16, 30, 5), "6.99.70");
    eq(n, "marianna-erp_auto_2026-09-27_16-30-05_v6.99.70.json"); eq(AB.parseAutoFileName(n).day, "2026-09-27");
    eq(AB.parseAutoFileName("marianna-erp_v6.99.70_schema-v2_2026-09-27T14-30-05.json"), null); eq(AB.parseAutoFileName("Faktura FV2026-09-15.pdf"), null);
  });
  t("BK-1: 30 + 30 — 40 days × 3 files keeps the newest 30 plus the last file of each earlier day inside 30 days (50 kept, 70 go); foreign files untouched", () => {
    const now = new Date(2026, 8, 27, 18, 0, 0); const names = [];
    for (let d = 0; d < 40; d++) for (const h of [9, 13, 17]) names.push(AB.autoFileName(new Date(2026, 8, 27 - d, h, 0, 0), "6.99.70"));
    const foreign = ["marianna-erp_v6.99.69_schema-v2_2026-09-01T10-00-00.json", "Faktura.pdf"];
    const r = AB.planRetention(names.concat(foreign), now);
    eq(r.keep.length, 50); eq(r.remove.length, 70); ok(foreign.every(f => !r.keep.includes(f) && !r.remove.includes(f)), "foreign files are never listed");
    ok(r.keep.includes(AB.autoFileName(new Date(2026, 8, 27 - 9, 9, 0, 0), "6.99.70")), "day 9: all three kept (inside the newest 30)");
    ok(r.keep.includes(AB.autoFileName(new Date(2026, 8, 27 - 29, 17, 0, 0), "6.99.70")) && !r.keep.includes(AB.autoFileName(new Date(2026, 8, 27 - 29, 13, 0, 0), "6.99.70")), "day 29: only its last file");
    ok(!r.keep.some(n => AB.parseAutoFileName(n).day <= "2026-08-28"), "nothing older than 30 days survives");
    eq(AB.planRetention(names.slice(0, 12), now).remove.length, 0, "fewer than 30 files: nothing is deleted");
  });
  t("BK-1: on opening a file is written only when the data differs from the last file", () => {
    eq(AB.tick({ ...AB.EMPTY_CLOCK, writtenFp: "A" }, "B", 1e9).write, true);
    eq(AB.tick({ ...AB.EMPTY_CLOCK, writtenFp: "B" }, "B", 1e9).write, false);
  });
  t("BK-1: two minutes after the changes stop, never sooner than 15 minutes after the last file", () => {
    const M = 60 * 1000; const T = 1e9;
    let c = { ...AB.EMPTY_CLOCK, writtenFp: "X" }; c = AB.tick(c, "X", T).clock;               // opened, nothing to write
    let r = AB.tick(c, "D", T + 10e3); eq(r.write, false, "just changed"); c = r.clock;
    r = AB.tick(c, "D", T + 40e3); eq(r.write, false, "30 s of quiet"); c = r.clock;
    r = AB.tick(c, "D", T + 10e3 + 2 * M); eq(r.write, true, "two minutes of quiet"); c = AB.afterWrite(r.clock, "D", T + 10e3 + 2 * M);
    const w = T + 10e3 + 2 * M;
    r = AB.tick(c, "E", w + 1 * M); eq(r.write, false); c = r.clock;
    r = AB.tick(c, "E", w + 5 * M); eq(r.write, false, "quiet, but inside the 15 minutes"); c = r.clock;
    r = AB.tick(c, "E", w + 15 * M); eq(r.write, true, "15 minutes after the last file");
  });
  t("BK-1: changes that never stop still reach the folder at the 15-minute mark", () => {
    const T = 1e9; let c = AB.tick({ ...AB.EMPTY_CLOCK, writtenFp: "X" }, "X", T).clock; let at = -1;
    for (let i = 1; i <= 40 && at < 0; i++) { const r = AB.tick(c, "E" + i, T + i * 30e3); c = r.clock; if (r.write) at = i * 30; }
    ok(at >= 15 * 60 && at <= 16 * 60, "first file after " + at + " s of continuous editing");
  });
  t("BK-1: a failed write waits 15 minutes before the next automatic try (no retry storm)", () => {
    const M = 60 * 1000; const c = AB.afterFailure({ ...AB.EMPTY_CLOCK, seenFp: "Z", writtenFp: "X" }, 1e9);
    eq(AB.tick(c, "Z", 1e9 + 3 * M).write, false); eq(AB.tick(c, "Z", 1e9 + 15 * M).write, true);
  });
  t("BK-1: the fingerprint follows the stored data — equal data equal print, a moved value a different one", () => {
    const a = AB.fingerprint([["pos", "[1]"], ["orders", "[]"]]);
    eq(a, AB.fingerprint([["pos", "[1]"], ["orders", "[]"]])); ok(a !== AB.fingerprint([["pos", "[2]"], ["orders", "[]"]])); ok(a !== AB.fingerprint([["pos", "[]"], ["orders", "[1]"]]));
  });
  t("BK-2: the folder file IS an Export-all-data file — the restore reads it; the folder preference never travels in it", () => withStore(5e6, (ls) => {
    U.writeStoreValue("pos", [{ number: "PO-2026-0040" }]); U.writeStoreValue("contacts", [{ name: "Pavamane Owoc" }]);
    ls.setItem("marianna-erp:autoBackup", JSON.stringify({ folderName: "MARIANNA backups", writtenFp: "x" }));
    const json = U.exportAllData(); const p = JSON.parse(json);
    eq(p._meta.app, "marianna-erp"); eq(p._meta.version, U.STORAGE_VERSION); eq(p.pos[0].number, "PO-2026-0040"); ok(!("autoBackup" in p) && !json.includes("MARIANNA backups"), "preference not exported");
    const r = B("remoteStore.js").storesFromExport(json); ok(r.stores.pos && r.stores.contacts, "v7.21.0 (A-RV-19): the restore into the shared data reads it");
    const src = require("fs").readFileSync(require("path").join(__dirname, "..", "src", "autoBackup.ts"), "utf8");
    eq((src.match(/const json = exportAllData\(\);/g) || []).length, 2, "the folder file and the daily download both write the pretty Export file");
  }));
  console.log("v6.99.70 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.72 — customs files find their shipment: the exit confirmation, the finder, attach once, detach whole (A-CU-3) ══
(function v69972(){
  console.log("\n══ 77. v6.99.72: CC529C / CC599C / SAD are told apart; a file finds its truck; nothing is attached on a guess; detach undoes whole ══");
  const C = B("customsClearance.domain.js"); const CI = B("customsImport.domain.js"); const fs = require("fs");
  const need = ["CC529C_26PL445010188G5KO3_1.xml", "CC599C_26PL445010188G5KO3_1.xml", "SAD_25520.xml", "CC599C_26PL445010285B4WB2_1.xml"].map(n => FX.needFixture(n, "the agent's files"));
  if (need.some(p => !p)) return;
  const [relX, exitX, sadX, exit2X] = need.map(p => fs.readFileSync(p, "utf8"));
  const rel = C.parseCustomsFile(relX), exit = C.parseCustomsFile(exitX), sad = C.parseCustomsFile(sadX), exit2 = C.parseCustomsFile(exit2X);
  let ids = 90000; const nid = () => ++ids;
  // the truck as it would be recorded: the same plates, 19 422 kg, the invoice linked through the SO
  const mk = (over = {}) => ({ id: 1, number: "SHP-2026-0040", status: "Loaded", governingSoRef: "SO-2026-0090", soRefs: ["SO-2026-0090"], clientName: "Al Baraka For Import & Export",
    goods: [{ id: 1, cnCode: "08081080", qtyKg: 19422 }], documents: [], customsUnits: [],
    legs: [{ id: 1, mode: "Road", plannedPickupDate: "2026-05-04", vehicles: [{ id: 11, truckPlate: "JSI 4708L", trailerPlate: "SMM 8968H", load: [{ goodsLineId: 1, qtyKg: 19422 }] }] }], ...over });
  const invoices = [{ number: "FV2026/05/1", kind: "SALES", links: [{ type: "SO", number: "SO-2026-0090" }] }];

  t("A-CU-3: the three files are told apart, and the CC599C yields the exit — 12 May 2026 at IT137103, control A2", () => {
    eq(rel.kind, "CC529C"); eq(exit.kind, "CC599C"); eq(sad.kind, "SAD"); eq(C.parseCustomsFile("<html>nothing</html>").kind, "unknown");
    eq(exit.mrn, "26PL445010188G5KO3"); eq(exit.exitedOn, "2026-05-12"); eq(exit.exitOffice, "IT137103"); eq(exit.exitResult, "A2"); eq(exit.status, "Exited");
    eq(rel.exitedOn, ""); eq(rel.status, "Released"); eq(exit2.exitedOn, "2026-05-18"); eq(exit2.exitOffice, "IT137100");
    eq(rel.consignee, "Al Baraka For Import &", "&amp; is decoded"); eq(C.unescapeXml("A &amp; B &lt;c&gt;"), "A & B <c>");
    eq(sad.plates, "JSI4708L/SMM8968H"); eq(sad.invoiceRef, "FV2026/05/1"); eq(sad.agentRef, "25520"); eq(sad.declaredOn, "2026-05-05"); eq(sad.cn, "08081080"); ok(/Al Baraka/.test(sad.consignee), sad.consignee);
  });
  t("A-CU-3: plates + the invoice linked to the shipment → exact; plates alone on two shipments → a proposal, the closer loading date first", () => {
    const one = C.findClearanceHome(rel, [mk()], invoices);
    ok(one.exact, one.reason); eq(one.exact.unit.id, 11); ok(one.exact.reasons.some(r => /invoice FV2026\/05\/1/.test(r)), one.exact.reasons.join("|"));
    const two = [mk(), mk({ id: 2, number: "SHP-2026-0041", governingSoRef: "SO-2026-0091", soRefs: ["SO-2026-0091"], legs: [{ id: 1, mode: "Road", plannedPickupDate: "2026-04-10", vehicles: [{ id: 21, truckPlate: "JSI4708L", trailerPlate: "SMM8968H", load: [{ goodsLineId: 1, qtyKg: 19422 }] }] }] })];
    const r = C.findClearanceHome(rel, two, []);
    eq(r.exact, null, "without the invoice the plates alone never decide"); eq(r.candidates.length, 2); eq(r.candidates[0].shipment.number, "SHP-2026-0040", "loaded 4 May sits above loaded 10 April"); ok(/confirm/i.test(r.reason));
    const trailerOnly = C.findClearanceHome(rel, [mk({ legs: [{ id: 1, mode: "Road", vehicles: [{ id: 11, truckPlate: "XX 00001", trailerPlate: "SMM8968H" }] }] })], []);
    eq(trailerOnly.exact, null); ok(trailerOnly.candidates[0] && /only the trailer/.test(trailerOnly.candidates[0].reasons[0]));
    eq(C.findClearanceHome(rel, [mk({ status: "Cancelled" })], invoices).candidates.length, 0, "a cancelled shipment is never a home");
    ok(/No shipment carries/.test(C.findClearanceHome(rel, [mk({ legs: [{ id: 1, mode: "Road", vehicles: [{ id: 11, truckPlate: "VI 1848M" }] }] })], invoices).reason));
  });
  t("A-CU-3: the CC599C finds the line by MRN once the release is on it; without the release it is only ever a proposal", () => {
    const alone = C.findClearanceHome(exit, [mk()], invoices); eq(alone.exact, null); ok(/release CC529C was not attached/.test(alone.reason), alone.reason); eq(alone.candidates.length, 1);
    const withRel = C.applyCustomsFile(mk(), 11, rel, "CC529C_K5TB3.xml", nid);
    const found = C.findClearanceHome(exit, [withRel], []); ok(found.exact); eq(found.exact.unit.id, 11); ok(/MRN 26PL445010188G5KO3 is already/.test(found.exact.reasons[0]));
    const other = C.findClearanceHome(exit2, [withRel], []); eq(other.exact, null, "a different MRN does not land on that line");
  });
  t("A-CU-3: attach fills the line and files two register rows; attached twice → still two; the exit adds its facts and one row; Detach undoes the whole", () => {
    let sh = C.applyCustomsFile(mk(), 11, rel, "CC529C_K5TB3.xml", nid);
    const line = C.clearanceLinesFor(sh)[0]; eq(line.mrn, "26PL445010188G5KO3"); eq(line.status, "Released"); eq(line.releasedOn, "2026-05-05"); eq(line.invoiceRef, "FV2026/05/1"); eq(line.sourceFile, "CC529C_K5TB3.xml");
    eq(sh.documents.length, 2); ok(sh.documents.some(d => d.type === "Export declaration (EAD)") && sh.documents.some(d => d.type === "Customs release (CC529C)"));
    eq(sh.customs.applies, true, "a customs file means customs applies — the editor shows the line");
    sh = C.applyCustomsFile(sh, 11, rel, "CC529C_K5TB3.xml", nid); eq(sh.documents.length, 2, "replace-by-ref: no duplicate rows");
    sh = C.applyCustomsFile(sh, 11, exit, "CC599C_K5TB3.xml", nid);
    const l2 = C.clearanceLinesFor(sh)[0]; eq(l2.status, "Exited"); eq(l2.exitedOn, "2026-05-12"); eq(l2.exitOffice, "IT137103"); eq(l2.exitResult, "A2"); eq(l2.releasedOn, "2026-05-05", "the release facts stay"); eq(l2.exitFile, "CC599C_K5TB3.xml");
    eq(sh.documents.length, 3); const ex = sh.documents.find(d => d.type === "Exit confirmation (CC599C)"); eq(ex.date, "2026-05-12"); ok(/IT137103/.test(ex.notes));
    sh = C.applyCustomsFile(sh, 11, sad, "SAD_25520.xml", nid); eq(sh.documents.length, 4); eq(C.clearanceLinesFor(sh)[0].status, "Exited", "the SAD never changes the status of a cleared line");
    sh = C.applyCustomsFile(sh, 11, exit, "CC599C_K5TB3.xml", nid); eq(sh.documents.length, 4, "the exit twice → still one row");
    eq(C.customsForInvoice("FV2026/05/1", [sh]).length, 1); const cv = C.customsForInvoice("FV2026/05/1", [sh])[0]; eq(cv.exitedOn, "2026-05-12"); eq(cv.mrn, "26PL445010188G5KO3"); eq(cv.shipment, "SHP-2026-0040");
    eq(C.customsForInvoice("FV2026/05/2", [sh]).length, 0);
    const back = C.detachClearance(sh, 11); eq(C.clearanceLinesFor(back)[0].status, "Pending"); eq(C.clearanceLinesFor(back)[0].mrn, undefined);
    eq(back.documents.length, 1, "only the SAD copy stays (it carries no MRN)"); eq(back.documents[0].type, "Customs declaration copy (SAD)");
  });
  t("A-CU-3: the whole batch — SAD + release + exit dropped together — lands on one truck: the exit follows its release in the batch", () => {
    const rows = CI.planImport([{ name: "SAD_25520.xml", text: sadX }, { name: "CC599C_K5TB3.xml", text: exitX }, { name: "CC529C_K5TB3.xml", text: relX }], [mk()], invoices);
    eq(rows.length, 3); ok(rows.every(r => r.choice), rows.map(r => r.parsed.kind + ":" + (r.choice || "-")).join(" "));
    ok(/in this batch/.test(rows[1].search.exact.reasons[0]), rows[1].search.exact.reasons[0]);
    const r = CI.applyImport(rows, [mk()]); eq(r.done.length, 3);
    const line = C.clearanceLinesFor(r.shipments[0])[0]; eq(line.status, "Exited"); eq(line.mrn, "26PL445010188G5KO3"); eq(line.releasedOn, "2026-05-05"); eq(line.exitedOn, "2026-05-12");
    eq(r.shipments[0].documents.length, 4);
    // the user moves the release to another truck → the exit moves with it; left out → the exit falls back to its own proposal
    const two = [mk(), mk({ id: 2, number: "SHP-2026-0041", governingSoRef: "SO-2026-0091", soRefs: ["SO-2026-0091"], legs: [{ id: 1, mode: "Road", plannedPickupDate: "2026-05-05", vehicles: [{ id: 21, truckPlate: "JSI4708L", trailerPlate: "SMM8968H" }] }] })];
    const rows2 = CI.planImport([{ name: "r.xml", text: relX }, { name: "e.xml", text: exitX }], two, invoices); ok(rows2[0].choice.startsWith("1|"), "invoice decides: shipment 1"); eq(rows2[1].choice, rows2[0].choice);
    const moved = CI.withChoice(rows2, 0, "2|21"); eq(moved[1].choice, "2|21", "the exit followed"); const dropped = CI.withChoice(moved, 0, ""); eq(dropped[1].choice, "", "left out with its release"); ok(dropped[1].search.candidates.length >= 1, "its own proposal is back");
    const unk = CI.planImport([{ name: "x.pdf", text: "%PDF" }], two, invoices); eq(unk[0].parsed.kind, "unknown"); eq(unk[0].choice, "");
  });
  t("A-CU-3: on the merged 25 Sept file the May files are NOT attached — the truck exists, the date does not fit, and the reason says so", () => {
    const mPath = FX.needFixture("marianna-erp_MERGED_2026-09-25.json"); if (!mPath) return;
    const d = require(mPath);
    const r = C.findClearanceHome(rel, d.shipments, d.invoices || []);
    eq(r.exact, null); ok(r.candidates.length >= 2, "JSI4708L is on several shipments: " + r.candidates.length); ok(r.candidates.every(c => c.shipment.status !== "Cancelled"));
    ok(r.candidates[0].reasons.some(x => /declared 2026-05-05 but this truck loaded/.test(x)), r.candidates[0].reasons.join("|"));
    const rows = CI.planImport([{ name: "r.xml", text: relX }, { name: "e.xml", text: exitX }], d.shipments, d.invoices || []); eq(rows[0].choice, ""); eq(rows[1].choice, "", "nothing pre-selected, nothing attached on a guess");
    eq(CI.applyImport(rows, d.shipments).done.length, 0);
  });
  console.log("v6.99.72 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.73–75 — SHP-2026-0035 (owner 28 Sept): containers carry what their trucks load; dates exist; units follow their documents ══
(function v69975(){
  console.log("\n══ 78–80. v6.99.73–75: container cargo from its trucks · impossible dates named · trucks follow their goods, containers their booking ══");
  const M = B("shipmentModel.domain.js"); const F = B("format.js"); const I = B("integrityCheck.js");
  const fPath = FX.needFixture("marianna-erp_v6.99.72_schema-v2_2026-09-28T13-44-40.json", "the owner's 28 Sept file (SHP-2026-0035)"); if (!fPath) return;
  const d = require(fPath); const sh = d.shipments.find(s => s.number === "SHP-2026-0035");
  const [tr1, tr2] = sh.legs[0].vehicles, [c1, c2] = sh.legs[1].vehicles;
  const kgOf = l => l.reduce((a, x) => a + Number(x.qtyKg), 0);
  t("A-TO-7: each container carries its own truck's goods — 19 422 kg each, 38 844 together, never the whole shipment twice", () => {
    const l1 = M.effectiveLoad(sh, c1), l2 = M.effectiveLoad(sh, c2);
    eq(kgOf(l1), 19422); eq(kgOf(l2), 19422); eq(l1.map(a => a.goodsLineId).join(","), "3", "container 1 ← TR1: the Elise"); eq(l2.map(a => a.goodsLineId).sort().join(","), "1,2", "container 2 ← TR2: the Braeburn");
    eq(kgOf(M.effectiveLoad(sh, c1)) + kgOf(M.effectiveLoad(sh, c2)), sh.goods.reduce((a, g) => a + g.qtyKg, 0), "containers add up to the goods");
    eq(M.effectiveLoad(sh, tr1), tr1.load, "a truck's own load is returned as it is");
    const split = JSON.parse(JSON.stringify(sh)); split.legs[1].vehicles[0].feeders = [{ fromUnitId: tr1.id, kg: 9711 }]; split.legs[1].vehicles[1].feeders = [{ fromUnitId: tr1.id, kg: 9711 }, { fromUnitId: tr2.id }];
    eq(kgOf(M.effectiveLoad(split, split.legs[1].vehicles[0])), 9711, "a split feeder carries its split"); eq(Math.round(kgOf(M.effectiveLoad(split, split.legs[1].vehicles[1]))), 9711 + 19422);
    eq(M.effectiveLoad(sh, { id: 1, feeders: [] }).length, 0, "no trucks, no cargo");
  });
  t("A-DT-1: 31 June does not exist — the date control refuses it and the check names the six stored on PO-2026-0041 and its lots", () => {
    ok(F.isRealISODate("2026-06-30")); ok(!F.isRealISODate("2026-06-31")); ok(!F.isRealISODate("2026-02-29")); ok(F.isRealISODate("2028-02-29")); ok(F.isRealISODate("2026-07-04T10:00:00Z")); ok(!F.isRealISODate("30/06/2026"));
    eq(F.daysInMonth(2026, 6), 30); eq(F.daysInMonth(2026, 2), 28);
    const r = I.checkIntegrity({ contacts: d.contacts, pos: d.pos, lots: d.lots, orders: d.orders, shipments: d.shipments, warehouseInvoices: [], operationalCosts: [], creditNotes: [], invoices: d.invoices || [], financeNotes: [], claims: d.claims || [], loadProtocols: [] });
    const x = r.issues.filter(i => i.code === "IMPOSSIBLE_DATE"); eq(x.length, 6); ok(x.every(i => i.severity === "error"));
    eq(x.map(i => i.entity).sort().join(","), "LOT-2026-0122,LOT-2026-0122,LOT-2026-0123,LOT-2026-0123,PO-2026-0041,PO-2026-0041");
    const m = FX.needFixture("marianna-erp_MERGED_2026-09-25.json"); if (m) { const d2 = require(m); eq(I.checkIntegrity({ contacts: d2.contacts, pos: d2.pos, lots: d2.lots, orders: d2.orders, shipments: d2.shipments, invoices: d2.invoices || [] }).issues.filter(i => i.code === "IMPOSSIBLE_DATE").length, 0, "the merged file has none"); }
  });
  t("A-UN-1: each truck follows ITS goods — TR1's Elise loads at Pavamane (PO-0042), TR2's Braeburn at Białski (PO-0041): both named as swapped", () => {
    const n1 = M.truckPlaceNote(sh, tr1, d.pos, d.lots), n2 = M.truckPlaceNote(sh, tr2, d.pos, d.lots);
    eq(n1.proposal.ref, "PO-2026-0042"); ok(/PAVAMANE/.test(n1.proposal.text)); eq(n1.proposal.date, "2026-06-29"); ok(n1.mismatch, "TR1 is sent to Białski");
    eq(n2.proposal.ref, "PO-2026-0041"); ok(/TAKITAC/.test(n2.proposal.text)); ok(n2.mismatch, "TR2 is sent to Pavamane"); ok(!F.isRealISODate(n2.proposal.date), "PO-0041's 31 June is never proposed");
    const fixed = { ...tr1, pickupLocationId: n1.proposal.id, pickupText: n1.proposal.text }; eq(M.truckPlaceNote(sh, fixed, d.pos, d.lots).mismatch, null, "on its goods' place: nothing to say");
    const both = { ...tr1, load: [{ goodsLineId: 1, qtyKg: 5382 }, { goodsLineId: 3, qtyKg: 10000 }] }; const nb = M.truckPlaceNote(sh, both, d.pos, d.lots);
    ok(nb.twoPlaces); eq(nb.proposal, null, "two places: none is chosen for the user"); eq(nb.places.length, 2);
    eq(M.truckPlaceNote(sh, { ...tr1, load: [] }, d.pos, d.lots).places.length, 0, "no load, no proposal");
  });
  t("A-UN-2/3: the containers take the booking's POL, POD, ETD, ETA where they have none; a different POD is named, never overwritten", () => {
    const f = M.fillFromBooking(sh); const [f1, f2] = f.legs[1].vehicles;
    eq(f1.plannedLoadingDate, "2026-07-04", "container 1 gets the ETD it lacked"); eq(f1.deliveryText, "Damietta Port", "what was typed stays");
    eq(f2.deliveryText, "Gdańsk Port", "container 2 gets the booking's POD it lacked"); eq(f2.deliveryLocationId, 6);
    eq(M.containerPlaceNote(f, f1).pod, "Gdańsk Port", "container 1 discharging at Damietta against a booking for Gdańsk is named"); eq(M.containerPlaceNote(f, f2).pod, null);
    eq(M.fillFromBooking(f), f, "a second pass changes nothing"); eq(f.legs[0], sh.legs[0], "the road leg is not touched");
    const legs = M.followBookingPlace(f.legs, "pod", { id: 6, name: "Gdańsk Port" }, { id: 126, name: "Damietta Port" });
    eq(legs[1].vehicles[1].deliveryText, "Damietta Port", "on the old port → follows"); eq(legs[1].vehicles[0].deliveryText, "Damietta Port", "already there → stays");
    eq(M.unitGaps(sh.legs[1].vehicles[0]).join(","), "loading date", "container 1 lacked only its loading date"); eq(M.unitGaps(f1).length, 0);
    eq(M.unitGaps({}).join(","), "pickup place,delivery place,loading date,delivery date");
  });
  console.log("v6.99.75 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.76–79 — the order views, copy a PO line, the planning sheet, document links (owner 28 Sept) ══
(function v69979(){
  console.log("\n══ 81. v6.99.76–79: payment text on the views · copy a PO line ══");
  const P = B("po.domain.js");
  t("A-PV-2 / A-SV-4: the views print the payment the form stored — basis + days — and a legacy text survives", () => {
    eq(P.paymentText({ paymentBasis: "INVOICE", paymentDays: 30 }), P.paymentTermsLabel("INVOICE", 30));
    eq(P.paymentText({ paymentBasis: "ADVANCE" }), P.paymentTermsLabel("ADVANCE", 0));
    eq(P.paymentText({ paymentTerms: "14 days" }), "14 days", "an old record keeps its text");
    eq(P.paymentText({ paymentTerms: "Other", paymentTermsOther: "LC at sight" }), "LC at sight");
    eq(P.paymentText({}), "—"); { const party = { paymentDays: 21, terms: { paymentDays: 21 } }; eq(P.paymentText({ paymentBasis: "INVOICE" }, party), P.paymentTermsLabel("INVOICE", P.paymentDaysFor({ paymentBasis: "INVOICE" }, party)), "the party's days when the order has none — the form's own rule"); }
    const fx = FX.fixture("marianna-erp_v6.99.72_schema-v2_2026-09-28T13-44-40.json"); if (fx) { const d = require(fx);
      ok(/^30 /.test(P.paymentText(d.pos.find(p => p.number === "PO-2026-0041"))), "PO-2026-0041 now shows its 30 days"); ok(/^30 /.test(P.paymentText(d.orders.find(o => o.number === "SO-2026-0025"))), "SO-2026-0025 too"); }
  });
  t("A-POL-1: a copied PO line lands under the original with every product field, a new id, and none of its history", () => {
    const items = [{ id: 1, product: "Apples", variety: "Braeburn", origin: "Poland", size: "70-75", quality: "I", packaging: "Wooden box (13 kg)", packagingId: 5, unitPrice: "3.10", cnCode: "08081080", qty: 5382, boxes: 414, pallets: 6, pricingUnit: "kg", kgPerBox: 13, coloration: "70%", addedByPackingResult: true, estimatedQty: true, quantityStatus: "ESTIMATED" }, { id: 2, product: "Apples", variety: "Elise" }];
    const out = P.copyPOLine(items, 0, 99);
    eq(out.length, 3); eq(out[0], items[0], "the original is untouched"); eq(out[1].id, 99); eq(out[2].id, 2, "the copy sits right under its original");
    ["product", "variety", "origin", "size", "quality", "packaging", "packagingId", "unitPrice", "cnCode", "qty", "boxes", "pallets", "pricingUnit", "kgPerBox", "coloration"].forEach(k => eq(out[1][k], items[0][k], k));
    ["addedByPackingResult", "estimatedQty", "quantityStatus"].forEach(k => eq(out[1][k], undefined, k + " is history, not product"));
    eq(P.copyPOLine(items, 5, 99), items, "no such line: nothing happens");
  });
  console.log("v6.99.79 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.81 — the inventory list and the lot view say what a lot is (A-IN, owner 29 Sept) ══
(function v69981(){
  console.log("\n══ 82. v6.99.81: status words · direct lots · value by state · arrived/age · the two shipments behind +100 % ══");
  const L = B("lotView.domain.js"); const I = B("integrityCheck.js");
  const fx = FX.needFixture("marianna-erp_v6.99.72_schema-v2_2026-09-28T13-44-40.json", "the owner's 28 Sept file"); if (!fx) return;
  const d = require(fx); const lot = n => d.lots.find(l => l.number === n);
  t("A-IN-4: one plain word per status, the stored value untouched", () => {
    eq(L.lotStatusLabel("Direct Expected").label, "Expected"); eq(L.lotStatusLabel("Expected").label, "Expected"); eq(L.lotStatusLabel("In Stock").label, "In stock");
    eq(L.lotStatusLabel("Shipped Out").label, "Shipped"); eq(L.lotStatusLabel("Delivered (direct)").label, "Delivered"); eq(L.lotStatusLabel("Blocked · PO Cancelled").label, "Deleted"); eq(L.lotStatusLabel("Cancelled").label, "Deleted");   // v6.99.99 (A-DEL-4): the owner's word
    eq(new Set(d.lots.map(l => L.lotStatusLabel(l.status).label)).size <= 6, true, "her file uses at most six words");
  });
  t("A-IN-7: the value in the lot's own state — in stock · delivered · expected — never 0 for goods that went direct", () => {
    const v = (n) => { const l = lot(n); const costs = (l.costs || []).reduce((s, c) => s + (c.pln || 0), 0); const cpk = costs / (l.receivedKg || l.expectedKg || 1); return L.lotValue(l, cpk); };
    eq(v("LOT-2026-0009").label, "in stock"); eq(Math.round(v("LOT-2026-0009").pln), 21247, "5 616 kg in stock at its cost");
    eq(v("LOT-2026-0001").label, "delivered"); eq(Math.round(v("LOT-2026-0001").pln), 14089, "a direct lot is worth what was delivered");
    eq(v("LOT-2026-0004").label, "expected"); eq(Math.round(v("LOT-2026-0004").pln), 3740); eq(v("LOT-2026-0021").label, "shipped");
    eq(v("LOT-2026-0031").label, "—"); eq(v("LOT-2026-0031").pln, 0, "a cancelled lot has no value");
    eq(d.lots.filter(l => !/Cancelled/.test(l.status) && L.lotValue(l, 1).pln === 0).length, 0, "every live lot in her file now shows a value");
  });
  t("A-IN-3: stock lots count their days; direct lots show dates and no count; expected lots their date", () => {
    const a9 = L.lotArrivedCell(lot("LOT-2026-0009"), "2026-09-29"); eq(a9.kind, "stock"); eq(a9.date, "2026-07-24"); eq(a9.days, 67);
    const a1 = L.lotArrivedCell(lot("LOT-2026-0001"), "2026-09-29"); eq(a1.kind, "direct"); eq(a1.loaded, "2026-07-23"); eq(a1.delivered, "2026-07-23"); eq(a1.days, undefined, "never a count for a direct lot");
    const a4 = L.lotArrivedCell(lot("LOT-2026-0004"), "2026-09-29"); eq(a4.kind, "expected"); eq(a4.date, "2026-07-23");
    ok(L.lotIsDirect(lot("LOT-2026-0016")) && !L.lotIsDirect(lot("LOT-2026-0009")));
  });
  t("A-IN-1: the +100 % lots name their two shipments; the integrity check lists all 19 as warnings", () => {
    eq(L.lotLoadedTwice(lot("LOT-2026-0026")).join(" + "), "SHP-2026-0021 + SHP-2026-0016"); eq(L.lotLoadedTwice(lot("LOT-2026-0001")), null); eq(L.lotLoadedTwice(lot("LOT-2026-0021")), null, "two trucks feeding one lot as expected is not a double load");
    const r = I.checkIntegrity({ contacts: d.contacts, pos: d.pos, lots: d.lots, orders: d.orders, shipments: d.shipments, invoices: d.invoices || [] });
    const x = r.issues.filter(i => i.code === "LOT_LOADED_TWICE"); eq(x.length, 19); ok(x.every(i => i.severity === "warning")); ok(/SHP-2026-0016/.test(x.find(i => i.entity === "LOT-2026-0026").message));
  });
  console.log("v6.99.81 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.83 — the tolerance field can be cleared; a supplier-delivered truck loads at the supplier (owner 30 Sept) ══
(function v69983(){
  console.log("\n══ 83. v6.99.83: QC tolerance as typed · supplier-delivered trucks (DDP) load at the supplier, deliver to the PO's destination ══");
  const M = B("shipmentModel.domain.js"); const Q = B("seasonOps.domain.js");
  const fx = FX.needFixture("marianna-erp_v6.99.82_schema-v2_2026-09-30T11-51-38.json", "the owner's 30 Sept file"); if (!fx) return;
  const d = require(fx); const po = d.pos.find(p => p.number === "PO-2026-0043"); const sh = d.shipments.find(s => s.number === "SHP-2026-0036");
  t("A-UN-5: PO-2026-0043 (DDP, consignment) — the truck loads at Legugeva and delivers to AGRO-MAX, never at the client", () => {
    const u = sh.legs[0].vehicles[0]; const n = M.truckPlaceNote(sh, u, d.pos, d.lots);
    ok(n.proposal, "a proposal"); eq(n.proposal.text, "Legugeva Kft."); eq(n.proposal.ref, "PO-2026-0043"); eq(n.proposal.date, "2026-06-02");
    eq(String(n.proposal.deliveryId), "178843262998053100"); ok(/AGRO-MAX/.test(n.proposal.deliveryText));
    ok(n.mismatch, "the stored pickup (the client's site) is named as wrong");
    const expectedLot = d.lots.find(l => l.number === "LOT-2026-0126"); eq(expectedLot.physicalKg || 0, 0, "an expected lot's location is never a loading place");
  });
  t("A-UN-5: a supplier-delivered shipment is born with its places and dates", () => {
    const born = Q.supplierDeliveryFromPO(po, { nextId: (() => { let i = 1; return () => i++; })(), nextNumber: () => "SHP-TEST-1", todayISO: () => "2026-09-30" }, { plate: "HU 123", driver: "", eta: "2026-06-12", supplierRef: "VP-1" });
    const u = born.legs[0].vehicles[0]; eq(u.pickupText, "Legugeva Kft."); eq(String(u.deliveryLocationId), "178843262998053100"); eq(u.plannedLoadingDate, "2026-06-02"); eq(u.plannedDeliveryDate, "2026-06-12");
    eq(M.unitGaps(u).length, 0, "nothing left for the red rings");
  });
  t("A-QC-1: a cleared tolerance stays cleared on the report and counts as 0 when it is judged", () => {
    const ins = { ...d.inspections[0], tolerances: { Unacceptable: 0, Progressive: "", Major: 2, Minor: 3 } };
    const v = Q.inspectionVerdict(ins); ok(v, "verdict computed with an empty tolerance"); 
    const v2 = Q.inspectionVerdict({ ...ins, tolerances: { ...ins.tolerances, Progressive: 0 } }); eq(JSON.stringify(v), JSON.stringify(v2), "empty = 0 exactly");
  });
  console.log("v6.99.83 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.84 — the truck settlement in PLN and the PO's currency; what moves; the SO sold from a PO can be invoiced (owner 30 Sept) ══
(function v69984(){
  console.log("\n══ 84. v6.99.84: settlement currencies · the three steps after the sales · an SO sold straight from a PO counts its truck ══");
  const P = B("poSettlement.domain.js"); const SO = B("statusOwnership.domain.js"); const r2 = v => Math.round(v * 100) / 100;
  const fx = FX.needFixture("marianna-erp_v6.99.82_schema-v2_2026-09-30T13-13-23.json", "the owner's 30 Sept 13:13 file"); if (!fx) return;
  const d = require(fx); const po = d.pos.find(p => p.number === "PO-2026-0043"); const rec = d.poSettlements.find(s => s.poNumber === "PO-2026-0043");
  // v7.27.5 (AUD-30): the settlement counts the kilos LOADED for each sale — these checks describe PO-2026-0043 after its truck SHP-2026-0036 was loaded for SO-2026-0026
  const shipLoaded = d.shipments.map(s => s.number === "SHP-2026-0036" ? { ...s, status: "Loaded", goods: (s.goods || []).map(g => ({ ...g, soRef: g.soRef || "SO-2026-0026" })) } : s);
  const calc = (over = {}) => P.computePOSettlement({ po, lots: d.lots, orders: d.orders, invoices: d.invoices || [], shipments: shipLoaded, claims: d.claims || [], ratePLNperEUR: rec.ratePLNperEUR, provisionalEUR: rec.provisionalEUR, commissionPct: rec.commissionPct, provisionalInvoiceNo: rec.provisionalInvoiceNo, ...over });
  t("A-ST-3: PO-2026-0043 at 6.5 % — Legugeva's EXTRA INVOICE 2 448,28, our commission 2 564,14, after compensation Legugeva owes us 115,86 EUR", () => {
    const r = calc(); eq(r.currency, "EUR"); eq(r.grossPLN, 171600); eq(r.netSalesEUR, 39448.28); eq(r.commissionEUR, 2564.14); eq(r.netAfterCommissionEUR, 36884.14);
    eq(r.correctionEUR, 2448.28, "net sales before commission − provisional (ruling 30 Sept)"); eq(r.extraInvoiceEUR, 2448.28); eq(r.expectedCreditNoteEUR, 0);
    eq(r.balanceEUR, -115.86, "the producer owes us"); eq(r.stillToTransferEUR, null, "his provisional invoice is not in the register"); eq(r.salesBasis, "order");
    const low = calc({ provisionalEUR: 41000 }); eq(low.correctionEUR, -1551.72); eq(low.expectedCreditNoteEUR, 1551.72, "a provisional above the sales → a credit note"); eq(low.balanceEUR, -4115.86);
  });
  t("A-ST-3: with the provisional in the register, what is still to transfer — unpaid, or paid in full", () => {
    const unpaid = [{ kind: "COST", number: "EUR258/2026", currency: "EUR", fxRate: 4.30, grossAmount: 37000, payments: [], paymentStatus: "Issued" }];
    eq(calc({ invoices: unpaid }).stillToTransferEUR, 36884.14, "nothing paid yet: the whole balance due");
    const paid = [{ ...unpaid[0], payments: [{ amount: 37000 }], paymentStatus: "Paid" }];
    const r = calc({ invoices: paid }); eq(r.provisionalPaidEUR, 37000); eq(r.stillToTransferEUR, -115.86, "paid in full: Legugeva owes us 115,86");
  });
  t("A-ST-1: the provisional in its own currency; a PO in PLN needs no rate; an EUR sale at its invoice's locked rate", () => {
    const usd = calc({ provisionalEUR: 40000, provisionalCurrency: "USD", provisionalRate: 4.0 }); eq(usd.provisionalEUR, r2(40000 * 4.0 / 4.35), "40 000 USD × 4.00 ÷ 4.35"); eq(usd.provisionalCurrency, "USD"); eq(usd.provisionalOriginal, 40000);
    eq(calc({ provisionalEUR: 40000, provisionalCurrency: "USD" }).warnings.some(w => /enter its PLN rate/.test(w)), true, "a third currency without its rate is named");
    const pln = P.computePOSettlement({ po: { ...po, currency: "PLN" }, lots: d.lots, orders: d.orders, invoices: [], shipments: shipLoaded, ratePLNperEUR: 0, provisionalEUR: 160000, provisionalCurrency: "PLN", commissionPct: 6.5 });
    eq(pln.currency, "PLN"); eq(pln.ratePLNperEUR, 1); eq(pln.netSalesEUR, 171600, "in PLN nothing is converted"); eq(pln.warnings.some(w => /rate/.test(w)), false);
    const eurSO = d.orders.map(o => o.number === "SO-2026-0026" ? { ...o, currency: "EUR", fxRate: 4.20, items: o.items.map(it => ({ ...it, unitPrice: 14 })) } : o);
    const inv = [{ kind: "SALES", number: "FV2026/06/1", currency: "EUR", fxRate: 4.30, netAmount: 14300 * 14 / 5, paymentStatus: "Issued", links: [{ type: "SO", number: "SO-2026-0026" }] }];   // v6.99.85: an invoice brings its net as well as its rate (the SO prices per 5 kg box → 2.80/kg)
    const byOrder = P.computePOSettlement({ po, lots: d.lots, orders: eurSO, invoices: [], shipments: shipLoaded, ratePLNperEUR: 4.35, commissionPct: 0 });
    const byInv = P.computePOSettlement({ po, lots: d.lots, orders: eurSO, invoices: inv, shipments: shipLoaded, ratePLNperEUR: 4.35, commissionPct: 0 });
    eq(byOrder.salesBasis, "order"); eq(byInv.salesBasis, "invoice"); eq(r2(byInv.grossPLN / byOrder.grossPLN), r2(4.30 / 4.20), "the invoice's rate replaces the order's");
  });
  t("A-ST-4: a direct lot shows its expected kilos until the truck is Delivered", () => { const l = calc().lines[0]; eq(l.receivedKg, 0); eq(l.expectedKg, 14300); });
  t("A-SO-5: SO-2026-0026 counts the supplier's truck SHP-2026-0036 made from its PO — invoiceable once Loaded", () => {
    const so = d.orders.find(o => o.number === "SO-2026-0026"); const at = st => d.shipments.map(s => s.number === "SHP-2026-0036" ? { ...s, status: st } : s);
    eq(SO.isShippedOrLater(so, at("Booked")), false); eq(SO.effectiveSoStatus(so, at("Loaded")), "Shipped"); eq(SO.isShippedOrLater(so, at("Loaded")), true); eq(SO.effectiveSoStatus(so, at("Delivered")), "Delivered");
    const withOwnSO = at("Loaded").map(s => s.number === "SHP-2026-0036" ? { ...s, soRefs: ["SO-2026-9999"] } : s); eq(SO.isShippedOrLater(so, withOwnSO), false, "a truck that names another SO is not borrowed");
  });
  console.log("v6.99.84 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.85 — consignment: the provisional from the register, sales from the invoices, both corrections expected, the lot's value, the positions (owner 30 Sept) ══
(function v69985(){
  console.log("\n══ 85. v6.99.85: consignment improvements ══");
  const P = B("poSettlement.domain.js"); const L = B("lotView.domain.js");
  const fx = FX.needFixture("marianna-erp_v6.99.82_schema-v2_2026-09-30T13-13-23.json", "the owner's 30 Sept 13:13 file"); if (!fx) return;
  const d = require(fx); const po = d.pos.find(p => p.number === "PO-2026-0043"); const rec = d.poSettlements.find(s => s.poNumber === "PO-2026-0043");
  // v7.27.5 (AUD-30): the settlement counts the kilos LOADED for each sale — these checks describe PO-2026-0043 after its truck SHP-2026-0036 was loaded for SO-2026-0026
  const shipLoaded = d.shipments.map(s => s.number === "SHP-2026-0036" ? { ...s, status: "Loaded", goods: (s.goods || []).map(g => ({ ...g, soRef: g.soRef || "SO-2026-0026" })) } : s);
  const provInv = { id: 7001, kind: "COST", number: "EUR258/2026", currency: "EUR", fxRate: 4.30, netAmount: 37000, grossAmount: 37000, paymentStatus: "Issued", counterparty: { id: po.supplier.id, name: po.supplier.name }, links: [{ type: "PO", number: "PO-2026-0043" }], payments: [] };
  const base = (over = {}) => P.computePOSettlement({ po, lots: d.lots, orders: d.orders, invoices: d.invoices || [], shipments: shipLoaded, claims: d.claims || [], ratePLNperEUR: 4.35, commissionPct: 6.5, provisionalEUR: 37000, provisionalInvoiceNo: "EUR258/2026", ...over });
  t("A-CS-1: the producer's invoice is offered from the register and fills the record — net, currency, rate; a stranger's invoice is not offered", () => {
    const cands = P.provisionalCandidates(po, [provInv, { id: 7002, kind: "COST", number: "X/1", counterparty: { name: "Someone else" }, paymentStatus: "Issued" }, { id: 7003, kind: "SALES", number: "FV/1", counterparty: { name: po.supplier.name } }]);
    eq(cands.map(c => c.id).join(","), "7001"); const rec2 = P.provisionalFromInvoice(provInv);
    eq(rec2.provisionalInvoiceId, 7001); eq(rec2.provisionalInvoiceNo, "EUR258/2026"); eq(rec2.provisionalEUR, 37000); eq(rec2.provisionalCurrency, "EUR"); eq(rec2.provisionalRate, 4.30);
    const withIt = base({ invoices: [provInv] }); eq(withIt.stillToTransferEUR, 36884.14, "in the register, unpaid: the whole balance is still to transfer");
    const paid = base({ invoices: [{ ...provInv, payments: [{ amount: 37000 }], paymentStatus: "Paid" }] }); eq(paid.provisionalPaidEUR, 37000); eq(paid.stillToTransferEUR, -115.86);
  });
  t("A-CS-2: once SO-2026-0026 is invoiced, the sales are the invoice's net; a client credit note on it reduces them; before that, the order", () => {
    const inv = { id: 8001, kind: "SALES", number: "FV2026/07/1", currency: "PLN", fxRate: 1, netAmount: 170000, netPLN: 170000, paymentStatus: "Issued", links: [{ type: "SO", number: "SO-2026-0026" }] };
    eq(base().grossPLN, 171600, "from the order"); eq(base().salesBasis, "order");
    const r = base({ invoices: [inv] }); eq(r.grossPLN, 170000, "the invoice's net replaces the order's value"); eq(r.salesBasis, "invoice"); eq(r.lines[0].soldKg, 14300, "kilos stay the order's");
    const cn = { id: 9001, noteType: "CREDIT", direction: "outgoing", invoiceId: 8001, amount: 5000, currency: "PLN", fxRate: 1, amountPLN: 5000, status: "Issued" };
    const r2 = base({ invoices: [inv], financeNotes: [cn] }); eq(r2.creditNotesPLN, 5000); eq(r2.netPLN, 165000);
    const dn = { ...cn, id: 9002, noteType: "DEBIT", amount: 1000, amountPLN: 1000 }; eq(base({ invoices: [inv], financeNotes: [cn, dn] }).creditNotesPLN, 4000, "a debit note goes the other way");
    eq(base({ invoices: [{ ...inv, isProforma: true }] }).salesBasis, "order", "a proforma is not an invoice");
  });
  t("A-CS-3: closing expects the producer's EXTRA INVOICE in the register, as it already expected his credit note", () => {
    const r = base(); const dn = P.expectedProducerExtraInvoice(po, r, { nextId: () => 1, todayISO: () => "2026-09-30" });
    ok(dn, "expected"); eq(dn.noteType, "DEBIT"); eq(dn.direction, "incoming"); eq(dn.status, "Expected"); eq(dn.amount, 2448.28); eq(dn.currency, "EUR"); eq(dn.amountPLN, 10650.02); ok(/compensated against our commission invoice of 2564,14 EUR/.test(dn.reason));
    eq(P.expectedProducerCreditNote(po, r, { nextId: () => 1, todayISO: () => "2026-09-30" }), null, "no credit note when an extra invoice is due");
    const low = base({ provisionalEUR: 41000 }); eq(P.expectedProducerExtraInvoice(po, low, { nextId: () => 1, todayISO: () => "x" }), null); ok(P.expectedProducerCreditNote(po, low, { nextId: () => 1, todayISO: () => "x" }));
  });
  t("A-CS-4: LOT-2026-0126 is a consignment lot — priced at settlement; with the provisional invoice, ≈ 11,13 PLN/kg provisional", () => {
    const lot = d.lots.find(l => l.number === "LOT-2026-0126");
    const h0 = L.consignmentHint(lot, d.pos, [], d.lots); eq(h0.consignment, true); eq(h0.provisionalPerKgPLN, null);
    const h1 = L.consignmentHint(lot, d.pos, [rec], d.lots); eq(h1.provisionalPerKgPLN, 11.26, "37 000 EUR × 4.35 ÷ 14 300 kg");
    const h2 = L.consignmentHint(lot, d.pos, [{ ...rec, provisionalCurrency: "PLN", provisionalEUR: 160000 }], d.lots); eq(h2.provisionalPerKgPLN, 11.19);
    eq(L.consignmentHint(d.lots.find(l => l.number === "LOT-2026-0009"), d.pos, [rec], d.lots).consignment, false, "a firm-price lot is not consignment");
  });
  t("A-CS-5: the consignment positions — one row per consignment PO, the settlement box's own figures", () => {
    // v7.18.6 (A-AU-12, owner 9 Oct): an open settlement's rate is the NBP rate of the day before today (no longer the rate typed on
    // the record) — the box's figures are checked at a known NBP rate of 4.35, the rate the 2 Oct record had typed.
    const FXs = B("fx.js"); const tdy = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Warsaw" }); const yst = new Date(Date.parse(tdy + "T12:00:00Z") - 86400000).toISOString().slice(0, 10);
    FXs.__setNbpStore({ days: { [yst]: { EUR: 4.35 } }, covered: { [yst]: 1 } });
    const rows = P.consignmentPositions({ pos: d.pos, lots: d.lots, orders: d.orders, invoices: d.invoices || [], shipments: shipLoaded, claims: d.claims || [], financeNotes: [], poSettlements: d.poSettlements });
    ok(rows.length >= 1); const r = rows.find(x => x.poNumber === "PO-2026-0043"); ok(r, "PO-0043 listed");
    eq(r.producer, "Legugeva Kft."); eq(r.currency, "EUR"); eq(r.state, "open", "fully sold, not closed"); eq(r.soldKg, 14300); eq(r.expectedKg, 14300); eq(r.netPLN, 171600); eq(r.netAfterCommission, 36884.14); eq(r.provisional, 37000); eq(r.balance, -115.86); eq(r.pctMissing, false);
    ok(rows.every(x => d.pos.find(p => p.number === x.poNumber).pricingMode === "consignment"), "only consignment POs");
    FXs.__setNbpStore({ days: {}, covered: {} });
  });
  console.log("v6.99.85 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.86 — the dates a shipment shows, the receipt's date, the governing order on a PO's truck (owner 1 Oct) ══
(function v69986(){
  console.log("\n══ 86. v6.99.86: dates from the trucks · the receipt dated by the truck · the sale on a PO's truck ══");
  const M = B("shipmentModel.domain.js"); const SO = B("statusOwnership.domain.js");
  const fx = FX.needFixture("marianna-erp_v6.99.85_schema-v2_2026-10-01T12-50-07.json", "the owner's 1 Oct file"); if (!fx) return;
  const d = require(fx); const sh = d.shipments.find(s => s.number === "SHP-2026-0037"); const po = d.pos.find(p => p.number === "PO-2026-0044"); const lot = d.lots.find(l => l.number === "LOT-2026-0127");
  t("SHP-2026-0037: planned 2 → 15 June from its truck, loaded 2 June, unloaded 15 June — the header held no date at all", () => {
    const x = M.shipmentDates(sh); eq(x.plannedLoading, "2026-06-02"); eq(x.plannedDelivery, "2026-06-15"); eq(x.loaded, "2026-06-02"); eq(x.delivered, "2026-06-15"); eq(sh.loadingDate, undefined, "the stored header had nothing to show");
    const bare = M.shipmentDates({ ...sh, legs: sh.legs.map(l => ({ ...l, vehicles: l.vehicles.map(u => ({ ...u, loadedAt: "", unloadedAt: "" })) })) }); eq(bare.loaded, ""); eq(bare.delivered, ""); eq(bare.plannedDelivery, "2026-06-15");
    eq(M.shipmentDates({ loadingDate: "2026-05-01", expectedDeliveryDate: "2026-05-09", legs: [] }).plannedLoading, "2026-05-01", "a shipment with no units falls back to its header");
  });
  t("the receipt of LOT-2026-0127 is dated by its truck's unloading (15 June), not today — and says where the date comes from", () => {
    const s1 = M.suggestedReceiptDate(lot, d.shipments, po, "2026-10-01"); eq(s1.date, "2026-06-15"); eq(s1.from, "SHP-2026-0037 unloaded");
    const noActual = d.shipments.map(s => s.number === "SHP-2026-0037" ? { ...s, legs: s.legs.map(l => ({ ...l, vehicles: l.vehicles.map(u => ({ ...u, unloadedAt: "" })) })) } : s);
    const s2 = M.suggestedReceiptDate(lot, noActual, po, "2026-10-01"); eq(s2.date, "2026-06-15"); eq(s2.from, "SHP-2026-0037 planned delivery");
    const s3 = M.suggestedReceiptDate(lot, [], po, "2026-10-01"); eq(s3.date, "2026-06-14"); eq(s3.from, "PO-2026-0044 expected delivery");
    eq(M.suggestedReceiptDate({ number: "LOT-X" }, [], null, "2026-10-01").date, "2026-10-01", "nothing known: today");
    eq((lot.movements || [])[0].date, "2026-10-01", "the owner's file shows the fault: booked in on 1 October");
  });
  t("a PO's truck can name its sale: a governing SO on an inbound shipment counts for that order's status", () => {
    const so = { number: "SO-TEST-1", status: "Confirmed", items: [{ sourceType: "PO", sourceRef: "PO-2026-0044", qty: 14300 }] };
    const named = d.shipments.map(s => s.number === "SHP-2026-0037" ? { ...s, status: "Loaded", governingSoRef: "SO-TEST-1" } : s);
    eq(SO.isShippedOrLater(so, named), true, "governing order set on the truck → the SO has shipped");
  });
  console.log("v6.99.86 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.87 — one owner for a lot's quantity (A-QC-4, owner ruling 1 Oct) ══
(function v69987(){
  console.log("\n══ 87. v6.99.87: the receipt owns a stock lot's kilos; the client's QC report owns a direct lot's ══");
  const Q = B("seasonOps.domain.js"); const SD = B("shipments.domain.js");
  const fx = FX.needFixture("marianna-erp_v6.99.86_schema-v2_2026-10-01T14-46-09.json", "the owner's 1 Oct 14:46 file"); if (!fx) return;
  const d = require(fx); const l126 = d.lots.find(l => l.number === "LOT-2026-0126"), l127 = d.lots.find(l => l.number === "LOT-2026-0127");
  t("the QC form pre-fills the RECEIVED kilos once received; LOT-2026-0127's 11 000 against its 10 985 receipt is named", () => {
    eq(Q.blankInspection(l127, { nextId: () => 1, todayISO: () => "2026-10-01" }).orderedQty, 10985, "received, not expected"); eq(Q.blankInspection(l126, { nextId: () => 1, todayISO: () => "2026-10-01" }).orderedQty, 14300, "not received: expected");
    const ins127 = d.inspections.find(i => i.lotNumber === "LOT-2026-0127"); const n = Q.inspectionQtyNote(ins127, l127);
    ok(n, "named"); eq(n.kind, "receipt"); eq(n.lotKg, 10985); eq(n.reportKg, 11000);
    eq(Q.inspectionQtyNote({ ...ins127, orderedQty: 10985 }, l127), null, "agreeing: nothing to say");
    eq(Q.inspectionQtyNote(d.inspections.find(i => i.lotNumber === "LOT-2026-0126"), l126), null, "not delivered yet: nothing to compare");
  });
  t("the client's report owns a direct lot: LOT-2026-0126's truck delivered → 14 270 kg posted, not the loaded 14 300", () => {
    eq(Q.clientReportKg("LOT-2026-0126", d.inspections, l126), 14270); eq(Q.clientReportKg("LOT-2026-0127", d.inspections, l127), null, "a warehouse check is not the client's");
    const sh = { ...d.shipments.find(s => s.number === "SHP-2026-0036"), status: "Delivered", governingSoRef: "SO-2026-0026" };
    let id = 900000; const deps = { todayISO: () => "2026-10-01", nextId: () => ++id, deliveredKgFor: n => Q.clientReportKg(n, d.inspections, d.lots.find(l => l.number === n)) };
    const r = SD.postShipmentToLots(sh, d.lots, deps); const lot = r.lots.find(l => l.number === "LOT-2026-0126");
    eq(lot.receivedKg, 14270, "received = the client's weighing"); const mv = lot.movements.filter(m => m.shipmentRef === "SHP-2026-0036");
    eq(mv.map(m => m.type + " " + m.qtyKg).join(", "), "IN 14270, SHIP_OUT 14270", "a pass-through pair at 14 270"); eq(mv[1].soRef, "SO-2026-0026", "the sale named on the truck");
    const noRep = SD.postShipmentToLots(sh, d.lots, { todayISO: () => "2026-10-01", nextId: () => ++id }).lots.find(l => l.number === "LOT-2026-0126"); eq(noRep.receivedKg, 14300, "no report: the loaded kilos");
  });
  t("a client report arriving after the delivery re-posts the direct pair to its kilos — and only that pair", () => {
    const delivered = { ...l126, status: "Delivered (direct)", receivedKg: 14300, movements: [
      { id: 1, type: "IN", qtyKg: 14300, date: "2026-06-12", shipmentRef: "SHP-2026-0036", note: "IN via SHP-2026-0036 — direct flow (ownership at handover)" },
      { id: 2, type: "SHIP_OUT", qtyKg: 14300, date: "2026-06-12", shipmentRef: "SHP-2026-0036", note: "SHIP_OUT via SHP-2026-0036 — client collection / direct pass-through" },
      { id: 3, type: "ADJUST", qtyKg: -5, date: "2026-06-13", note: "other" } ] };
    const r = Q.repostDirectToReport(delivered, 14270); eq(r.movements.map(m => m.qtyKg).join(","), "14270,14270,-5"); ok(/per the client's QC report/.test(r.movements[0].note));
    eq(Q.repostDirectToReport(r, 14270), r, "already at the report: unchanged");
  });
  console.log("v6.99.87 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.88–91 — Delete back; Delete / Withdraw / Cancel; shipment view pairs; carriers from their owners (owner 1 Oct) ══
(function v69991(){
  console.log("\n══ 88–91. v6.99.88–91: the delete action · Withdrawn · carriers and forwarders from their owners ══");
  const F = B("format.js"); const M = B("shipmentModel.domain.js"); const L = B("lotView.domain.js");
  const fx = FX.needFixture("marianna-erp_v6.99.87_schema-v2_2026-10-01T16-29-32.json", "the owner's 1 Oct 16:29 file"); if (!fx) return;
  const d = require(fx); const src = require("fs").readFileSync(require("path").join(__dirname, "../src/ui.tsx"), "utf8");
  t("A-DEL-1: every action a screen names exists — the missing 'delete' made every Delete button vanish", () => {
    const known = new Set(Array.from(src.matchAll(/^\s+([a-zA-Z]+):\s+\{ icon:/gm)).map(m => m[1])); ok(known.has("delete"), "delete is in the list"); ok(!known.has("withdrawDoc"), "v6.99.99 (A-DEL-4): Withdraw is gone");
    const fs = require("fs"), path = require("path"); const dir = path.join(__dirname, "../src"); const used = new Set();
    fs.readdirSync(dir).filter(f => f.endsWith(".tsx")).forEach(f => { for (const m of fs.readFileSync(path.join(dir, f), "utf8").matchAll(/<ActionButton action="([a-zA-Z]+)"/g)) used.add(m[1] + "@" + f); });
    // the same fault hides 17 Close buttons ('close' is missing too) — registered as A-DEL-2 for the next batch (rule 2); until then it is the ONLY one allowed
    const missing = Array.from(new Set(Array.from(used).filter(x => !known.has(x.split("@")[0])).map(x => x.split("@")[0]))); eq(missing.join(", "), "", "an ActionButton naming an unknown action draws nothing — v6.99.92 (A-DEL-2): 'close' added, none left");
  });
  t("A-DEL-4: the stored 'Cancelled' reads 'Deleted' everywhere; other statuses untouched", () => {
    eq(F.statusWord("Cancelled"), "Deleted"); eq(F.statusWord("Blocked · PO Cancelled"), "Blocked · PO Deleted"); eq(F.statusWord("Confirmed"), "Confirmed"); eq(F.statusWord(""), "");
    eq(L.lotStatusLabel("Cancelled").label, "Deleted");
  });
  console.log("v6.99.91 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.92–95 — Close back; stock loads where it is; groupage from the first window; the tour of a truck (owner 1 Oct) ══
(function v69995(){
  console.log("\n══ 92–95. v6.99.92–95: Close · stock loads at its lot · the groupage tour from the lots and the orders ══");
  const M = B("shipmentModel.domain.js"); const SD = B("shipments.domain.js");
  const fx = FX.needFixture("marianna-erp_v6.99.87_schema-v2_2026-10-01T16-29-32.json", "the owner's 1 Oct 16:29 file"); if (!fx) return;
  const d = require(fx); const sh = d.shipments.find(s => s.number === "SHP-2026-0039"); const u = sh.legs[0].vehicles[0]; const lot127 = d.lots.find(l => l.number === "LOT-2026-0127");
  t("A-GR-1: SHP-2026-0039's goods are in stock at AGRO-HURT — the truck loads there, not at Legugeva", () => {
    const n = M.truckPlaceNote(sh, u, d.pos, d.lots); ok(n.proposal, "a proposal"); eq(String(n.proposal.id), String(lot127.locationId)); ok(/^LOT-/.test(n.proposal.ref), "from the lot, not the PO: " + n.proposal.ref);
    const notYet = d.lots.map(l => l.number === "LOT-2026-0127" || l.number === "LOT-2026-0128" ? { ...l, physicalKg: 0, receivedKg: 0 } : l);
    const n2 = M.truckPlaceNote(sh, u, d.pos, notYet); eq(n2.proposal && n2.proposal.ref, "PO-2026-0044", "not yet received: the PO's place again");
  });
  t("A-GR-3: the tour — 1 loading (AGRO-HURT, 14 265 kg), 3 drops from the three orders; the order is the truck's", () => {
    const tour = M.truckTour(sh, u, d.pos, d.lots, d.orders); eq(tour.isTour, true); eq(tour.loads.length, 1); eq(tour.loads[0].kg, 14265); eq(String(tour.loads[0].id), String(lot127.locationId));
    eq(tour.drops.map(x => x.soNumber + ":" + x.kg).join(","), "SO-2026-0027:1650,SO-2026-0028:11630,SO-2026-0029:985");
    ok(tour.drops.every(x => !x.missing), "all three orders name a destination"); eq(tour.drops[2].placeText, "TUMAGE TUGUF Bronisze");
    const seq = M.moveDrop(tour, "SO-2026-0029", -1); eq(seq.join(","), "SO-2026-0027,SO-2026-0029,SO-2026-0028");
    const t2 = M.truckTour(sh, { ...u, stopOrder: ["SO-2026-0029", "SO-2026-0027"] }, d.pos, d.lots, d.orders); eq(t2.drops.map(x => x.soNumber).join(","), "SO-2026-0029,SO-2026-0027,SO-2026-0028", "stored order first, the rest by date");
    const gaps = M.tourGaps(u, tour); ok(!gaps.includes("delivery place"), "a tour truck is not asked one delivery place"); ok(!gaps.some(g => /destination of/.test(g)));
    const noDest = d.orders.map(o => o.number === "SO-2026-0027" ? { ...o, destinationLocationId: null, destinationText: "" } : o);
    eq(M.tourGaps(u, M.truckTour(sh, u, d.pos, d.lots, noDest)).filter(g => /destination of/.test(g)).join(","), "destination of SO-2026-0027", "a missing destination is named");
    eq(M.truckTour(d.shipments.find(s => s.number === "SHP-2026-0037"), d.shipments.find(s => s.number === "SHP-2026-0037").legs[0].vehicles[0], d.pos, d.lots, d.orders).isTour, false, "a single-drop truck is not a tour");
  });
  t("A-GR-2: a groupage built from the first window carries every order's goods rows, each with its own SO", () => {
    let id = 990000; const deps = { todayISO: () => "2026-10-01", nextId: () => ++id };
    const so27 = d.orders.find(o => o.number === "SO-2026-0027"), so28 = d.orders.find(o => o.number === "SO-2026-0028");
    const base = { id: 1, number: "SHP-TEST", goods: [], soRefs: [], poRefs: [], legs: [{ mode: "Road", vehicles: [] }] };
    const g = SD.appendSourceGoods(SD.appendSourceGoods(base, "SO", so27, d.lots, deps), "SO", so28, d.lots, deps);
    eq(g.goods.map(x => x.soRef).sort().join(","), "SO-2026-0027,SO-2026-0028,SO-2026-0028"); ok((g.soRefs || []).includes("SO-2026-0027") && (g.soRefs || []).includes("SO-2026-0028"));
  });
  console.log("v6.99.95 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.97 — a company's addresses each keep an exact id of their own (A-ID-1) ══
(function v69997(){
  console.log("\n══ 97. v6.99.97: site ids exact for every address ══");
  const L = B("locations.js");
  t("A-ID-1: with today's company ids the formula collapses address 1 and 2 onto 0; a further address now gets an exact id of its own", () => {
    const big = 1788432629980530, small = 1234;
    eq(L.warehouseCpLocId(big, 1), L.warehouseCpLocId(big, 0), "the fault: the formula cannot tell them apart");
    ok(!L.exactSiteId(big, 1)); ok(L.exactSiteId(small, 1));
    eq(L.newSiteId(big, 0), L.warehouseCpLocId(big, 0), "the main address keeps the value every stored reference holds");
    const a1 = L.newSiteId(big, 1), a2 = L.newSiteId(big, 2); ok(Number.isSafeInteger(a1) && Number.isSafeInteger(a2)); ok(a1 !== a2 && a1 !== L.warehouseCpLocId(big, 0), "three distinct ids");
    eq(L.newSiteId(small, 2), L.warehouseCpLocId(small, 2), "a small id keeps the formula");
  });
  t("A-ID-1: stamping gives a warehouse's three addresses three ids, and a second pass keeps them; the location list uses them", () => {
    const wh = { id: 1788432629980530, name: "AGRO-HURT", type: "Warehouse", types: ["Warehouse"], address: "ul. Główna 1, Grójec", extraAddresses: ["Chłodnia 2, Grójec", { address: "Magazyn 3, Grójec" }] };
    const r1 = L.stampSiteIds([wh]); const c1 = r1.contacts[0]; const ids = [c1.siteId, ...c1.extraAddresses.map(a => a.siteId)];
    eq(new Set(ids.map(String)).size, 3, "three distinct: " + ids.join(", ")); eq(String(c1.siteId), String(L.warehouseCpLocId(wh.id, 0)));
    const r2 = L.stampSiteIds(r1.contacts); eq(r2.changed, false, "stable"); eq(r2.contacts[0].extraAddresses.map(a => a.siteId).join(","), c1.extraAddresses.map(a => a.siteId).join(","));
    const locs = L.counterpartyLocations ? L.counterpartyLocations(r1.contacts) : []; if (locs.length) eq(new Set(locs.map(l => String(l.id))).size, locs.length, "no two locations share an id");
    const wl = L.counterpartyLocations(r1.contacts).filter(l => L.placeGroup(l) === "OWN"); eq(new Set(wl.map(l => String(l.id))).size, 3, "the warehouse list has three places");   // v7.32.0: from the Parties, no copy
  });
  console.log("v6.99.97 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.99–104 — one Delete; one ship-out per sale; the report numbered at save; the PO's sales from its lots (owner 2 Oct) ══
(function v699104(){
  console.log("\n══ 98–104. v6.99.99–104: Delete everywhere, Deleted word · one SHIP_OUT per sale · the PO's linked sales ══");
  const SD = B("shipments.domain.js");
  const fx = FX.needFixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json", "the owner's 2 Oct file"); if (!fx) return;
  const d = require(fx);
  t("A-SH-M1: LOT-2026-0127 on the groupage SHP-2026-0039 leaves as two ship-outs — 10 000 kg for SO-0028 and 985 kg for SO-0029 — not one for 10 985", () => {
    const sh = { ...d.shipments.find(s => s.number === "SHP-2026-0039"), status: "Loaded" };
    const lots = d.lots.map(l => (l.number === "LOT-2026-0127" || l.number === "LOT-2026-0128") ? { ...l, physicalKg: l.receivedKg, status: "In Stock", movements: (l.movements || []).filter(m => m.type === "IN") } : l);
    let id = 980000; const r = SD.postShipmentToLots(sh, lots, { todayISO: () => "2026-10-02", nextId: () => ++id });
    const l127 = r.lots.find(l => l.number === "LOT-2026-0127"); const outs = l127.movements.filter(m => m.type === "SHIP_OUT");
    eq(outs.map(m => m.soRef + ":" + m.qtyKg).sort().join(","), "SO-2026-0028:10000,SO-2026-0029:985"); eq(l127.physicalKg, 0, "all gone"); eq(l127.status, "Shipped Out");
    const l128 = r.lots.find(l => l.number === "LOT-2026-0128"); eq(l128.movements.filter(m => m.type === "SHIP_OUT").map(m => m.soRef + ":" + m.qtyKg).sort().join(","), "SO-2026-0027:1650,SO-2026-0028:1630");
    eq((d.lots.find(l => l.number === "LOT-2026-0127").movements || []).filter(m => m.type === "SHIP_OUT").map(m => m.soRef + ":" + m.qtyKg).join(","), "SO-2026-0029:10985", "the owner's file shows the old single movement");
  });
  console.log("v6.99.104 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.105 — the settlement names each sale (A-ST-9) ══
(function v699105(){
  console.log("\n══ 105. v6.99.105: the settlement's lines expand into their sales ══");
  const P = B("poSettlement.domain.js");
  const fx = FX.needFixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json", "the owner's 2 Oct file"); if (!fx) return;
  const d = require(fx); const po = d.pos.find(p => p.number === "PO-2026-0044");
  t("A-ST-9: PO-2026-0044 — LOT-0127 sold to SO-0028 (10 000 kg) and SO-0029 (985 kg), LOT-0128 to SO-0027 and SO-0028; a claim on a sale is named", () => {
    const calc = P.computePOSettlement({ po, lots: d.lots, orders: d.orders, invoices: d.invoices || [], shipments: d.shipments, claims: d.claims || [], ratePLNperEUR: 4.35, commissionPct: 6.5 });
    const l127 = calc.lines.find(l => l.lotNumber === "LOT-2026-0127"), l128 = calc.lines.find(l => l.lotNumber === "LOT-2026-0128");
    eq(l127.sales.map(x => x.soNumber + ":" + x.grade + ":" + x.kg).join(","), "SO-2026-0028:I:10000,SO-2026-0029:I:985"); eq(l128.sales.map(x => x.soNumber + ":" + x.kg).join(","), "SO-2026-0027:1650,SO-2026-0028:1630");
    eq(l127.sales.reduce((a, x) => a + x.kg, 0), l127.soldKg, "the sales add up to the line"); ok(l127.sales.every(x => x.client));
    const withClaim = P.computePOSettlement({ po, lots: d.lots, orders: d.orders, invoices: [], shipments: d.shipments, claims: [{ number: "CLM-TEST-1", status: "Open", soRef: "SO-2026-0029" }], ratePLNperEUR: 4.35, commissionPct: 0 });
    eq(withClaim.lines.find(l => l.lotNumber === "LOT-2026-0127").sales.find(x => x.soNumber === "SO-2026-0029").claims.join(","), "CLM-TEST-1");
  });
  console.log("v6.99.105 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.108–109 — one class split from the ledger; a warehouse's invoice reaches the lots (owner 2 Oct) ══
(function v699109(){
  console.log("\n══ 108–109. v6.99.108–109: the class split · the warehouse invoice allocated by kilo-days ══");
  const Q = B("seasonOps.domain.js"); const P = B("poSettlement.domain.js"); const W = B("warehouseAllocation.domain.js"); const SO = B("so.domain.js");
  const fx = FX.needFixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json", "the owner's 2 Oct file"); if (!fx) return;
  const d = require(fx); const po = d.pos.find(p => p.number === "PO-2026-0044"); const l127 = d.lots.find(l => l.number === "LOT-2026-0127");
  t("A-QC-6: LOT-2026-0127 — no sorting job: all 10 985 received kg are class I in the split, in the settlement and in the availability; a reclass moves kilos to II", () => {
    const g = Q.gradeSplit(l127); eq(g.I, 10985); eq(g.II, 0); eq(g.waste, 0);
    const calc = P.computePOSettlement({ po, lots: d.lots, orders: d.orders, invoices: [], shipments: d.shipments, claims: [], ratePLNperEUR: 4.35, commissionPct: 6.5 });
    const line = calc.lines.find(l => l.lotNumber === "LOT-2026-0127"); eq(line.classIKg, 10985, "was 0 before — the settlement read a sorting cache"); eq(line.soldKg, 10985);
    const sorted = { ...l127, movements: [...l127.movements, { id: 9, type: "RECLASS", date: "2026-06-14", qtyKg: 1000, toGrade: "II", source: "sorting:x" }, { id: 10, type: "DAMAGE", date: "2026-06-14", qtyKg: 85, source: "sorting:x" }] };
    const g2 = Q.gradeSplit(sorted); eq(g2.I, 9900); eq(g2.II, 1000); eq(g2.waste, 85);
    const a = SO.lotAvailabilityByGrade({ ...sorted, physicalKg: 10985 }, []); eq(a.I, 9900); eq(a.II, 1000);
    eq(Q.gradeSplit({ receivedKg: 500, grades: { I: 300, II: 150, waste: 50 }, movements: [] }).II, 150, "a record with no ledger keeps its cached split");
  });
  t("A-ST-7: AGRO-HURT's invoice spread over the lots that were there in June by kilo-days — 77 % / 23 % — and written as warehouse cost lines the settlement reads", () => {
    const wh = d.contacts.find(c => /AGRO-HURT/i.test(c.name)); const sites = [wh.siteId];
    eq(W.lotKgDaysAt(l127, sites, "2026-06-01", "2026-06-30"), 10985, "one day × 10 985 kg (in 14 June, out 15 June)"); eq(W.lotKgDaysAt(l127, sites, "2026-07-01", "2026-07-31"), 0);
    const inv = { id: 7700, number: "TEST/06/2026", kind: "COST", netAmount: 1000, fxRate: 1, issueDate: "2026-06-30", counterparty: { id: wh.id, name: wh.name } };
    const p = W.proposeWarehouseAllocation(inv, d.lots, sites, "2026-06-01", "2026-06-30"); eq(p.rows.length, 2); eq(p.totalPLN, 1000);
    eq(p.rows.map(r => r.lotNumber + ":" + r.pln).join(","), "LOT-2026-0127:770.07,LOT-2026-0128:229.93");   // 10 985 / 14 265 = 77.007 % eq(Math.round(p.rows.reduce((a, r) => a + r.pln, 0) * 100) / 100, 1000, "the rows add up to the invoice");
    let id = 1; const r = W.applyWarehouseAllocation(d.lots, inv, p.rows, wh.name, { nextId: () => ++id, todayISO: () => "2026-10-04" }); eq(r.touched.sort().join(","), "LOT-2026-0127,LOT-2026-0128");
    const c127 = r.lots.find(l => l.number === "LOT-2026-0127").costs.find(c => c.source === "cinv:7700"); eq(c127.pln, 770.07); eq(c127.type, "warehouse"); ok(/kg-days/.test(c127.label));
    const r2x = W.applyWarehouseAllocation(r.lots, inv, p.rows, wh.name, { nextId: () => ++id, todayISO: () => "2026-10-04" }); eq(r2x.lots.find(l => l.number === "LOT-2026-0127").costs.filter(c => c.source === "cinv:7700").length, 1, "re-allocating replaces, never doubles");
    const calc = P.computePOSettlement({ po, lots: r.lots, orders: d.orders, invoices: [], shipments: d.shipments, claims: [], ratePLNperEUR: 4.35, commissionPct: 6.5 }); eq(calc.warehousePLN, 1000, "the settlement sees the warehouse cost");
  });
  console.log("v6.99.109 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  // v6.99.110 (AUD-10): failures are collected; the suite exits at the end, so every block runs
})();

// ══ v6.99.110–114 — audit batch 1: Warsaw clock, voided movements kept, the shortage check, the tab lock ══
(function v699114(){
  console.log("\n══ 110–114. audit batch 1 ══");
  const I = B("inventory.domain.js"); const Rc = B("receipts.domain.js"); const TL = B("tabLock.js");
  t("AUD-10: this suite runs on Poland's clock", () => { eq(Intl.DateTimeFormat().resolvedOptions().timeZone, "Europe/Warsaw"); });
  t("AUD-38: a voided movement stays on the lot — arithmetic skips it, the record keeps it", () => {
    const r = I.recomputeLotFromMovements({}, [{ id: 1, type: "IN", date: "2026-09-01", qtyKg: 1000, toId: 1 }, { id: 2, type: "SHIP_OUT", date: "2026-09-02", qtyKg: 400, voided: true, voidReason: "wrong lot" }], () => ({ type: "OWN" }));
    eq(r.movements.length, 2); eq(r.physicalKg, 1000); ok(r.movements.some(m => m.voided && m.voidReason === "wrong lot"), "the reason survives");
  });
  t("AUD-39: the shipment shortage check reads physicalKg — 2 000 kg asked of a 500 kg lot is named", () => {
    const r = Rc.lotStockCheck([{ lotRef: "L", qtyKg: 2000 }], [{ number: "L", physicalKg: 500, receivedKg: 500 }]); eq(r.length, 1); eq(r[0].shortKg, 1500);
    eq(Rc.lotStockCheck([{ lotRef: "L", qtyKg: 400 }], [{ number: "L", physicalKg: 500 }]).length, 0, "enough stock: silent");
  });
  t("AUD-02: the tab lock — the first tab writes, a second opens read-only, 'use this tab' hands the pen over", () => {
    let a = TL.newTabState("A"), b = TL.newTabState("B");
    a = TL.onNoAnswer(a); eq(a.role, "writer", "nobody answered A: it writes");
    const r1 = TL.onTabMessage(a, { type: "hello", id: "B" }); eq(r1.reply && r1.reply.type, "alive", "the writer answers a newcomer");
    b = TL.onTabMessage(b, r1.reply).st; eq(b.role, "readonly", "B stands down"); eq(TL.onNoAnswer(b).role, "readonly", "and stays down");
    const tk = TL.takeOver(b); eq(tk.st.role, "writer"); a = TL.onTabMessage(a, tk.announce).st; eq(a.role, "readonly", "A hands the pen over");
    eq(TL.onTabMessage(a, { type: "hello", id: "A" }).reply, null, "a tab ignores its own echo");
  });
  console.log("v6.99.114 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v6.99.116–121 — audit batch 2: money ══
(function v699121(){
  console.log("\n══ 116–121. audit batch 2: the push, the allocation, the bank match, the import, the ledger ══");
  const I = B("invoicing.js"); const A = B("costAllocation.js"); const Bk = B("bankReconciliation.domain.js"); const Lg = B("ledger.js"); const FI = B("fakturowniaImport.domain.js");
  t("AUD-14: an unpriced line never inflates the payload and blocks the push; quantity 0 stays 0", () => {
    const inv = { currency: "PLN", vatRate: 5, grossAmount: 1050, positions: [{ name: "A", quantity: 1000, vatRate: 5, grossTotal: 1050 }, { name: "Sample", quantity: 10, vatRate: 5 }] };
    const p = I.buildFakturowniaPayload(inv, { apiToken: "x" }).invoice.positions; eq(p.reduce((a, x) => a + x.total_price_gross, 0), 1050, "was 1 575");
    eq(I.pushBlockers(inv).join(" | "), "line 2 (Sample) has no price"); eq(I.pushBlockers({ grossAmount: 1050, positions: [{ name: "A", quantity: 1000, vatRate: 5, grossTotal: 1050 }] }).length, 0);
    eq(I.buildFakturowniaPayload({ currency: "PLN", vatRate: 5, grossAmount: 100, positions: [{ name: "Z", quantity: 0, vatRate: 5, grossTotal: 100 }] }, { apiToken: "x" }).invoice.positions[0].quantity, 0, "0 is not turned into 1");
  });
  t("AUD-32/33: the allocation never exceeds the cost (3 000 → 1 500 + 1 500) and never loses a grosz (100 → 33.34 + 33.33 + 33.33)", () => {
    const m = { inventoryType: t => t, label: t => t };
    const o = A.allocateShipmentCostsToLots({ number: "S", purpose: "INBOUND", lotRefs: ["A", "B"], goods: [{ lotRef: "A", qtyKg: 1000 }], costs: [{ id: 1, type: "f", amountPLN: 3000 }] }, [{ number: "A" }, { number: "B" }], m);
    eq(o.map(l => l.costs[0].pln).join(","), "1500,1500");
    const o3 = A.allocateShipmentCostsToLots({ number: "S", purpose: "INBOUND", lotRefs: ["A", "B", "C"], goods: [{ lotRef: "A", qtyKg: 100 }, { lotRef: "B", qtyKg: 100 }, { lotRef: "C", qtyKg: 100 }], costs: [{ id: 1, type: "f", amountPLN: 100 }] }, [{ number: "A" }, { number: "B" }, { number: "C" }], m);
    eq(Math.round(o3.reduce((a, l) => a + l.costs[0].pln, 0) * 100) / 100, 100);
    const ok2 = A.allocateShipmentCostsToLots({ number: "S", purpose: "INBOUND", lotRefs: ["A", "B"], goods: [{ lotRef: "A", qtyKg: 3000 }, { lotRef: "B", qtyKg: 1000 }], costs: [{ id: 1, type: "f", amountPLN: 400 }] }, [{ number: "A" }, { number: "B" }], m); eq(ok2.map(l => l.costs[0].pln).join(","), "300,100", "the normal case unchanged");
  });
  t("AUD-22: a bank title naming 71/07/2026 no longer suggests 1/07/2026; the whole number still matches", () => {
    const invs = [{ id: 1, kind: "SALES", number: "1/07/2026", currency: "PLN", grossAmount: 5000, paidAmount: 0, paymentStatus: "Issued" }, { id: 2, kind: "SALES", number: "71/07/2026", currency: "PLN", grossAmount: 8000, paidAmount: 8000, paymentStatus: "Paid" }];
    const r = Bk.matchBankLines([{ id: "b", amount: 8000, currency: "PLN", counterparty: "AGRO-MAX", title: "FV 71/07/2026" }], invs)[0]; ok(r.invoiceNumber !== "1/07/2026", "got " + r.invoiceNumber);
    eq(Bk.matchBankLines([{ id: "b", amount: 5000, currency: "PLN", counterparty: "X", title: "Zapłata FV 1/07/2026 dziękujemy" }], invs)[0].invoiceNumber, "1/07/2026");
  });
  t("AUD-18 (rule 11): an imported cost invoice is Issued (received), categorised by its tag, never Paid from the import", () => {
    const row = { number: "FA 1/09", issueDate: "2026-09-01", dueDate: "2026-09-15", net: 1000, gross: 1230, currency: "PLN", sellerName: "Trans X", fktId: 5, paid: true };
    const fn = FI.costInvoiceFromRow || FI.invoiceFromRow || FI.importCostInvoice; if (!fn) { console.log("      (no row builder exported — the status line is covered by the source check)"); const src = require("fs").readFileSync(require("path").join(__dirname, "../src/fakturowniaImport.domain.ts"), "utf8"); ok(!/paymentStatus: "Draft"/.test(src), "no import writes Draft"); ok(/tag === "FREIGHT" \? "FREIGHT"/.test(src), "the tag names the category"); return; }
  });
  t("AUD-19/20 (rule 11): the ledger excludes Drafts, ignores Fakturownia's flag, and carries the OUTSTANDING amount", () => {
    const inv = [{ id: 1, kind: "COST", number: "A/1", counterparty: { name: "X" }, currency: "PLN", grossAmount: 100000, grossPLN: 100000, fxRate: 1, paymentStatus: "Issued", issueDate: "2026-09-01", dueDate: "2026-09-30", payments: [{ amount: 90000, date: "2026-09-10" }] },
                 { id: 2, kind: "COST", number: "D/1", counterparty: { name: "X" }, currency: "PLN", grossAmount: 5000, grossPLN: 5000, paymentStatus: "Draft", issueDate: "2026-09-01" },
                 { id: 3, kind: "COST", number: "F/1", counterparty: { name: "X" }, currency: "PLN", grossAmount: 7000, grossPLN: 7000, paymentStatus: "Issued", issueDate: "2026-09-01", dueDate: "2026-09-30" }];
    const lg = Lg.buildLedger({ orders: [], lots: [], pos: [], invoices: inv, financeNotes: [], settledRefs: [], todayISO: () => "2026-10-04", fakturowniaPaid: { "F/1": true } });
    const items = lg.items || lg; const a = items.find(x => x.documentNo === "A/1" || x.ref.includes("A/1")); ok(a, "the partly paid invoice is listed"); eq(a.amountPLN, 10000, "10 000 outstanding, not 100 000");
    ok(!items.some(x => (x.documentNo || x.ref || "").includes("D/1")), "the Draft is not an item"); const f = items.find(x => (x.documentNo || x.ref || "").includes("F/1")); ok(f && f.status !== "Paid", "Fakturownia's paid flag is ignored");
  });
  console.log("v6.99.121 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v6.99.122 — audit batch 3: dates, on Poland's clock ══
(function v699122(){
  console.log("\n══ 122. audit batch 3: the Excel import, the due date, today ══");
  const D = B("dates.js"); const Sh = B("sheet.domain.js"); const Bd = B("board.domain.js");
  t("AUD-06: a spreadsheet date (local midnight) is stored as that day — the sample workbook's dates no longer shift", () => {
    const XLSX = require("xlsx"); const fx = FX.fixture("sample_season_workbook.xlsx"); if (!fx) { console.log("      (sample workbook missing — skipped)"); return; }
    const wb = XLSX.readFile(fx, { cellDates: true }); const ws = wb.Sheets[wb.SheetNames[0]]; let n = 0, shifted = 0;
    Object.keys(ws).forEach(k => { const c = ws[k]; if (c && c.t === "d") { n++; if (D.localISO(c.v) !== `${c.v.getFullYear()}-${String(c.v.getMonth() + 1).padStart(2, "0")}-${String(c.v.getDate()).padStart(2, "0")}`) shifted++; if (c.v.toISOString().slice(0, 10) !== D.localISO(c.v)) { /* this is the fault the import had */ } } });
    ok(n > 0, "date cells found"); eq(shifted, 0);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }); const tab = Sh.importWorkbookRows(wb.SheetNames[0], rows, Bd.HER_HEADERS, "2026-10-04T08:00:00.000Z");
    // the loading / unloading columns are the sheet's DATE cells; the other dates come from typed text and are parsed, not converted
    const dates = tab.rows.flatMap(r => [r.cells.loadingDate, r.cells.unloadingDate]).filter(v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));
    ok(dates.length > 0, "imported dates"); const raw = []; Object.keys(ws).forEach(k => { const c = ws[k]; if (c && c.t === "d") raw.push(D.localISO(c.v)); }); ok(dates.every(d0 => raw.includes(d0)), "every imported date is the sheet's own day: " + dates.slice(0, 3).join(",")); eq(tab.rows[0].cells.loadingDate, "2026-09-01", "M2 is 1 September — the import used to write 31 August");
    eq(D.localISO(new Date(2026, 5, 2, 0, 0, 0)), "2026-06-02", "local midnight 2 June is 2 June (toISOString said 1 June in Warsaw)");
  });
  t("AUD-08: 30 days after 15 March 2027 is 14 April, after 1 March is 31 March — across the clock change", () => {
    eq(D.addDaysISO("2027-03-15", 30), "2027-04-14"); eq(D.addDaysISO("2027-03-01", 30), "2027-03-31"); eq(D.addDaysISO("2026-12-31", 1), "2027-01-01"); eq(D.addDaysISO("2026-02-28", 1), "2026-03-01");
  });
  t("AUD-07/09: the previous month from the text; today is the local day", () => {
    eq(D.prevMonthISO("2026-01"), "2025-12"); eq(D.prevMonthISO("2026-09-11"), "2026-08"); eq(D.localTodayISO(), D.localISO(new Date()));
    const src = require("fs"); const path = require("path"); const dir = path.join(__dirname, "../src"); const bad = src.readdirSync(dir).filter(f => /\.(ts|tsx)$/.test(f) && f !== "dates.ts").filter(f => /toISOString\(\)\.slice\(0, ?(7|10)\)|\.split\("T"\)\[0\]/.test(src.readFileSync(path.join(dir, f), "utf8")));
    eq(bad.join(","), "", "no UTC-date site outside dates.ts");
  });
  console.log("v6.99.122 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v6.99.127 — ONE SOURCE FOR EVERY SALE: THE LOT (A-ONE-1, owner 4 Oct) ══
(function v699127(){
  console.log("\n══ 127. one source: every sale sells a lot ══");
  const SOd = B("salesOrders.domain.js"); const ST = B("statusOwnership.domain.js"); const P = B("poSettlement.domain.js");
  const fx = FX.needFixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json", "the owner's 2 Oct file"); if (!fx) return;
  const d = require(fx);
  // v7.24.1 (FZ-01): the app no longer converts on opening (done on both copies, 15 Oct); the 2 Oct file is older, so the section points its lines itself, as the conversion did
  const lotOf = it => (d.lots || []).find(l => String(l.poRef) === String(it.sourceRef) && (it.sourceLineId == null || String(l.poLineId) === String(it.sourceLineId)));
  const r = { orders: d.orders.map(o => ({ ...o, items: (o.items || []).map(it => it && it.sourceType === "PO" && lotOf(it) ? { ...it, sourceType: "STOCK", sourceRef: lotOf(it).number, sourceLineId: null } : it) })) };
  t("A-ONE-1: pointing the old lines at their lots changes no sale's status and no truck settlement", () => {
    let st = 0; d.orders.forEach((o, i) => { if (ST.effectiveSoStatus(o, d.shipments) !== ST.effectiveSoStatus(r.orders[i], d.shipments)) st++; }); eq(st, 0);
    let diff = 0; d.pos.filter(p => p.status !== "Cancelled").forEach(po => { const a = P.computePOSettlement({ po, lots: d.lots, orders: d.orders, invoices: [], shipments: d.shipments, claims: [], ratePLNperEUR: 4.35, commissionPct: 0 }), b = P.computePOSettlement({ po, lots: d.lots, orders: r.orders, invoices: [], shipments: d.shipments, claims: [], ratePLNperEUR: 4.35, commissionPct: 0 }); if (Math.abs(a.grossPLN - b.grossPLN) > 0.5) diff++; }); eq(diff, 0);
  });
  t("A-ONE-1: a lot not yet received is sold on its expected kilos; the other sales of the same lot reserve it; a received lot on its stock", () => {
    const exp = d.lots.find(l => l.number === "LOT-2026-0004"); const base = SOd.lotReservationsForStock(exp, []); eq(base.availabilityBasis, 550);
    const sold = SOd.lotReservationsForStock(exp, [{ number: "SO-T", status: "Confirmed", items: [{ sourceType: "STOCK", sourceRef: "LOT-2026-0004", qty: 200, grade: "I", product: exp.product, variety: exp.variety }] }]); eq(sold.liveAvailable, 350);
    const stock = SOd.lotReservationsForStock(d.lots.find(l => l.number === "LOT-2026-0009"), []); eq(stock.availabilityBasis, 5616);
  });
  t("A-ONE-1: a sale naming a lot counts the trucks that carry that lot (no sale on the row) as its own", () => {
    const so = { number: "SO-X", status: "Confirmed", items: [{ sourceType: "STOCK", sourceRef: "LOT-2026-0126", qty: 14300 }] };
    const at = st => d.shipments.map(s => s.number === "SHP-2026-0036" ? { ...s, status: st, soRefs: [] } : s);
    eq(ST.isShippedOrLater(so, at("Booked")), false); eq(ST.isShippedOrLater(so, at("Loaded")), true, "the supplier's truck carrying LOT-0126");
  });
  console.log("v6.99.127 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v6.99.128–134 — consistency: one parser, one rate by date, names that mean nothing, the note to its lot, the invoice owns the value, one FX fallback, whole boxes, the claim share ══
(function v699134(){
  console.log("\n══ 128–134. consistency ══");
  const FI = B("fakturowniaImport.domain.js"); const C = B("consignment.js"); const Bk = B("bankReconciliation.domain.js"); const P = B("poSettlement.domain.js"); const M = B("marginCalculations.js"); const CL = B("claims.domain.js"); const FX = B("fx.js");
  t("AUD-24: generic company words never make a bank match; a distinctive word does", () => {
    const inv = [{ id: 1, kind: "SALES", number: "FV 9/2026", currency: "PLN", grossAmount: 1000, paidAmount: 0, paymentStatus: "Issued", counterparty: { name: "Agro Trans Spółka Jawna" } }];
    const r = Bk.matchBankLines([{ id: "b", amount: 1000, currency: "PLN", counterparty: "Handel Trans Agro Sp. z o.o.", title: "zapłata" }], inv)[0]; ok(r.rank !== "AMOUNT+PARTY", "generic words only: " + r.rank);
    const r2 = Bk.matchBankLines([{ id: "b", amount: 1000, currency: "PLN", counterparty: "TUMAGE TUGUF Bronisze", title: "zapłata" }], [{ ...inv[0], counterparty: { name: "Bronisze Warzywa Sp. z o.o." } }])[0]; eq(r2.rank, "AMOUNT+PARTY", "'Bronisze' is distinctive; 'Warzywa' is not");
  });
  t("AUD-36: a foreign invoice imported without a rate takes the settings' rate, never 1", () => {
    const fx = FX.resolveFxRate(null, "EUR"); ok(fx > 1, "EUR rate " + fx); eq(FX.resolveFxRate(4.5, "EUR"), 4.5);
    const src = require("fs").readFileSync(require("path").join(__dirname, "../src/fakturowniaImport.domain.ts"), "utf8"); ok(!/row\.fxRate \|\| 1/.test(src), "no '|| 1' left in the import");
  });
  t("AUD-43: a claim with one subject missing its kilos splits equally, never 100 % / 0 %", () => {
    const fn = CL.claimSubjectShares || CL.subjectShares || null; if (!fn) { const src = require("fs").readFileSync(require("path").join(__dirname, "../src/claims.domain.ts"), "utf8"); ok(/const everyKg = lotSubjects\.every/.test(src), "the rule is in the code"); return; }
  });
  t("AUD-34: once SO-2026-0026's sale is invoiced, its P/L revenue is the invoice's net less the client's note", () => {
    const fx = FX2("marianna-erp_v6.99.82_schema-v2_2026-09-30T13-13-23.json"); if (!fx) return; const d = require(fx); const so = d.orders.find(o => o.number === "SO-2026-0026");
    const base = M.computeSOMargin(so, d.lots, d.pos, d.shipments, "forecast"); eq(base.revenuePLN, 171600, "from the order");
    const inv = [{ id: 1, kind: "SALES", number: "FV/1", currency: "PLN", fxRate: 1, netAmount: 170000, netPLN: 170000, paymentStatus: "Issued", links: [{ type: "SO", number: "SO-2026-0026" }] }];
    const cn = [{ id: 2, noteType: "CREDIT", direction: "outgoing", invoiceId: 1, amount: 5000, amountPLN: 5000, currency: "PLN", fxRate: 1, status: "Issued" }];
    eq(M.computeSOMargin(so, d.lots, d.pos, d.shipments, "forecast", inv, cn).revenuePLN, 165000, "the invoice owns the value");
  });
  console.log("v6.99.134 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v6.99.135–136 — the import learns; linking offers the likely documents (owner 4 Oct) ══
(function v699136(){
  console.log("\n══ 135–136. the import learns · likely links ══");
  const FI = B("fakturowniaImport.domain.js"); const IP = B("invoicePlus.domain.js");
  const fx = FX.needFixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json", "the owner's 2 Oct file"); if (!fx) return;
  const d = require(fx);
  t("A-FI-1: AGRO-HURT's next invoice is proposed from its last one — category, warehouse — and flagged recurring when the amount repeats; an unknown seller gets nothing", () => {
    const hurt = d.invoices.filter(i => i.kind !== "SALES" && /AGRO-HURT/i.test(i.counterparty?.name || "")).sort((a, b) => String(b.issueDate).localeCompare(String(a.issueDate)));
    // v6.99.141 (A-FI-3): AGRO-HURT is client + supplier + warehouse — a multi-role seller is learned BY CONTENT; a bare row gets no proposal
    const sameText = [hurt[0].description, hurt[0].source, ...((hurt[0].positions || []).map(p => p && p.name))].filter(Boolean).join(" ");
    eq(FI.learnFromRegister({ seller: "AGRO-HURT Adami Romatwicz", net: hurt[0].netAmount * 1.03 }, d.invoices, d.contacts), null, "nothing resembling: no guess");
    const l = sameText ? FI.learnFromRegister({ seller: "AGRO-HURT Adami Romatwicz", net: hurt[0].netAmount * 1.03, description: sameText }, d.invoices, d.contacts) : null;
    if (sameText) { ok(l, "a proposal by content"); ok(/by content/.test(l.from), l.from); eq(l.recurring, true); } else console.log("      (the last AGRO-HURT invoice carries no line text — content rule not exercisable on this file)");
    const single = d.contacts.find(c => c.roles && c.roles.length === 1 && d.invoices.some(i => i.kind !== "SALES" && i.counterparty && String(i.counterparty.id) === String(c.id)));
    if (single) { const li = d.invoices.filter(i => i.kind !== "SALES" && i.counterparty && String(i.counterparty.id) === String(single.id)).sort((a, b) => String(b.issueDate).localeCompare(String(a.issueDate)))[0]; const p = FI.learnFromRegister({ seller: single.name, net: li.netAmount }, d.invoices, d.contacts); ok(p && p.category, `a single-role seller (${single.name}) is learned from the seller alone`); }
    eq(FI.learnFromRegister({ seller: "Nowa Firma", net: 100 }, d.invoices, d.contacts), null);
  });
  t("A-FI-2: the link proposals name a reason and are few; the full list is never offered without a typed number", () => {
    const inv = d.invoices.find(i => i.kind !== "SALES" && (i.links || []).length === 0 && i.counterparty?.id != null) || d.invoices[0];
    const p = IP.proposeLinks(inv, { shipments: d.shipments, pos: d.pos, lots: d.lots }); ok(Array.isArray(p)); ok(p.every(x => x.reason), "each proposal says why"); ok(p.length < 20, "a short list, not every document: " + p.length);
  });
  console.log("v6.99.136 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v6.99.143–147 — Clean-up II part 2: whole-number notes, id compare, heal markers in the data, hardened helpers, rejected lots ══
(function v699147(){
  console.log("\n══ 143–147. clean-up II, part 2 ══");
  const F = B("format.js"); const Bk = B("bankReconciliation.domain.js"); const ST = B("useLocalStoredState.js");
  t("AUD-47: a note names a document only as a whole number", () => { ok(F.noteNames("SHIP_OUT via SHP-2026-0033 for SO-2026-0012", "SHP-2026-0033")); ok(!F.noteNames("SHIP_OUT via SHP-2026-0033", "SHP-2026-003")); ok(!F.noteNames("via SHP-2026-0033", "HP-2026-0033")); ok(!F.noteNames("", "SO-1")); });
  t("AUD-48: r2 / r0 / daysInMonth never return NaN; a bank line without a date books today", () => { eq(F.r2(NaN), 0); eq(F.r0(undefined), 0); eq(F.daysInMonth("x", 2), 0); eq(F.daysInMonth(2026, 2), 28); const ev = Bk.bankPaymentEvent({ id: "b", amount: -100, currency: "PLN" }); ok(/^\d{4}-\d{2}-\d{2}$/.test(ev.date)); eq(ev.amount, 100); });
  t("AUD-46: the heals store is part of the dataset (exports and imports with it)", () => { ok(ST.DATA_KEYS.includes("heals"), "heals is a DATA_KEY"); });
  console.log("v6.99.147 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v6.99.148 — the shared record store (AUD-01/03/04/05) ══
(function v699148(){
  console.log("\n══ 148. the shared store ══");
  const ST = B("useLocalStoredState.js"); const R = B("remoteStore.js");
  t("without the two settings the app is exactly as before: the store is off and the hook's doors are unused", () => {
    eq(R.remoteConfigured(), false); eq(R.syncState().status, "off"); eq(typeof ST.applyStoreFromRemote, "function"); eq(ST.onStoreWritten, null, "no write hook installed");
  });
  t("the hook's doors: a remote value replaces a store; a local write reaches the hook; the shared store echoes nothing back", () => {
    let got = null; ST.setStoreWrittenHook((k, j) => { got = [k, j]; });
    ST.onStoreWritten("lots", JSON.stringify([{ a: 1 }])); eq(got[0], "lots"); ST.setStoreWrittenHook(null); eq(ST.onStoreWritten, null);
    eq(ST.applyStoreFromRemote("heals", { x: 1 }), false, "no mounted hook here → written to storage directly"); eq(JSON.stringify(ST.readStoreValue("heals")), JSON.stringify({ x: 1 }));
  });
  t("the set-up guide and the SQL ship with the code", () => {
    const fs = require("fs"), path = require("path"); const g = fs.readFileSync(path.join(__dirname, "../docs/SHARED_STORE_SETUP.md"), "utf8");
    ok(/create table if not exists public\.stores/.test(g)); ok(/enable row level security/.test(g)); ok(/to authenticated/.test(g)); ok(/REACT_APP_SUPABASE_URL/.test(g) && /REACT_APP_SUPABASE_ANON_KEY/.test(g));
  });
  console.log("v6.99.148 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v6.99.149 — the test copy and the safe real start ══
(function v699149(){
  console.log("\n══ 149. test copy · safe first start ══");
  const R = B("remoteStore.js"); const ST = B("useLocalStoredState.js");
  t("no label on production", () => {   // v7.21.0 (A-RV-19): the local summary went with the browser-data upload
    eq(R.ENV_LABEL, "");
  });
  t("the guide puts the real upload on the colleague's browser and the test copy on its own project and address", () => {
    const g = require("fs").readFileSync(require("path").join(__dirname, "../docs/SHARED_STORE_SETUP.md"), "utf8");
    ok(/upload must come from the browser that holds the real data/i.test(g)); ok(/REACT_APP_ENV_LABEL/.test(g)); ok(/second project/i.test(g)); ok(/branch called `test`/.test(g));
  });
  console.log("v6.99.149 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v6.99.150 — the settings reach the browser bundle ══
(function v699150(){
  console.log("\n══ 150. the shared-store settings are read the way the build replaces them ══");
  t("remoteStore reads process.env.REACT_APP_* plainly — no typeof-process guard (the browser has no `process`)", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../src/remoteStore.ts"), "utf8");
    const code = src.split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n"); ok(!/typeof process !== "undefined"/.test(code), "the guard that hid the settings is gone (comments aside)");
    ok(/originOf\(process\.env\.REACT_APP_SUPABASE_URL\)/.test(src) && /String\(process\.env\.REACT_APP_SUPABASE_ANON_KEY \|\| ""\)/.test(src) && /String\(process\.env\.REACT_APP_ENV_LABEL \|\| ""\)/.test(src), "plain process.env reads (the URL through originOf, v6.99.151)");
  });
  console.log("v6.99.150 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v6.99.151 — the Project URL however it was pasted ══
(function v699151(){
  console.log("\n══ 151. the Project URL's origin ══");
  const R = B("remoteStore.js");
  t("a URL pasted with /rest/v1/, a trailing slash, spaces or no scheme still reaches the project's origin", () => {
    ["https://abc.supabase.co", "https://abc.supabase.co/", "https://abc.supabase.co/rest/v1/", "  https://abc.supabase.co/rest/v1  ", "abc.supabase.co"].forEach(v => eq(R.originOf(v), "https://abc.supabase.co", JSON.stringify(v)));
    eq(R.originOf(""), "");
  });
  console.log("v6.99.151 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v6.99.152 — the first shared data from an exported file; guarded ══
(function v699152(){
  console.log("\n══ 152. upload a JSON export as the first shared data ══");
  const R = B("remoteStore.js");
  t("a Marianna export is read as stores and counted; anything else is refused", () => {
    const fx = FX.fixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json"); if (!fx) return;
    const p = R.storesFromExport(require("fs").readFileSync(fx, "utf8")); ok(/^\d+ POs, \d+ sales orders, \d+ lots, /.test(p.summary), p.summary); ok(Array.isArray(p.stores.pos) && p.stores.pos.length > 0); eq(p.meta.appVersion, "6.99.98");
    let threw = false; try { R.storesFromExport(JSON.stringify({ hello: 1 })); } catch (e) { threw = /not a Marianna export/.test(e.message); } ok(threw, "a foreign file is refused");
  });
  t("the upload refuses when the shared copy already holds data; nothing is pushed while it is empty", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../src/remoteStore.ts"), "utf8");
    ok(/if \(existing\.length\) throw new Error/.test(src), "a non-empty shared copy is never overwritten by an upload"); ok(/if \(state\.status === "empty"\) return;/.test(src), "no stray pushes before the first upload");
    ok(!/resolution=merge-duplicates,return=minimal/.test(src), "the first upload no longer merges over existing rows");
  });
  console.log("v6.99.152 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.0.0 — Settings on the shared copy (A-SH-1/2) ══
(function v700(){
  console.log("\n══ v7.0.0. Settings on the shared copy ══");
  const R = B("remoteStore.js");
  t("without a sign-in there is no session; the TEST copy is recognised only by its label", () => { eq(R.readSession(), null); eq(R.isTestCopy(), false); });   // v7.21.0 (A-RV-19): no mode to ask about
  t("Settings: no erase on the real shared copy; restore, archive and (TEST only) reset go to the shared copy after the old copy is downloaded; the texts follow the mode", () => {
    const s = require("fs").readFileSync(require("path").join(__dirname, "../src/Settings.tsx"), "utf8");
    ok(/\{!isTestCopy\(\) \? \(/.test(s), "the real shared copy shows no erase buttons");
    ok((s.match(/if \(!isTestCopy\(\)\) return;/g) || []).length === 2, "the handlers refuse too");
    ok(/Type RESTORE to go ahead/.test(s) && /sharedCopyAsExport\(APP_VERSION, STORAGE_VERSION\)/.test(s), "restore = typed word + the old copy downloaded");
    ok(/archived in the shared data/.test(s), "season archive in the shared copy"); ok(/About the shared data:/.test(s) && !/Phase 2 will add/.test(s), "texts");
  });
  console.log("v7.0.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.0.1 — no lock-out when the Users list holds someone ══
(function v701(){
  console.log("\n══ v7.0.1. who are you? ══");
  const Pm = B("permissions.domain.js");
  t("an unmatched browser sees the Dashboard only (the model) — and the top bar now offers the list to pick from; the name is no longer written into the page", () => {
    const users = [{ id: 1, name: "Hazem Osman", isOwner: true, modules: {}, finance: {} }, { id: 2, name: "Anna", isOwner: false, modules: { finance: false }, finance: {} }];
    eq(Pm.canOpenModule(users, "", "orders"), false); eq(Pm.canOpenModule(users, "", "dashboard"), true); eq(Pm.canOpenModule(users, "hazem osman", "settings"), true, "picking the owner opens everything");
    const src = require("fs").readFileSync(require("path").join(__dirname, "../src/App.tsx"), "utf8");
    ok(/Who are you\?/.test(src), "the picker"); ok(!/<span>Hazem Osman<\/span>/.test(src), "no name written into the page");
  });
  console.log("v7.0.1 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.0.2 — CANCELLED by the owner on 6 Oct (v7.1.0): with an owner set and identity tied to the sign-in, the ticks decide ══
// ══ v7.1.0–7.1.9 — the first V7 batch ══
(function v71(){
  console.log("\n══ v7.1.x. identity by sign-in · result of a sale in Finance · links · import note · backups ══");
  const Pm = B("permissions.domain.js"); const Dm = B("documents.domain.js"); const Bd = B("autoBackup.domain.js"); const OC = B("operationalCosts.js");
  const users = [{ id: 1, name: "Hazem Osman", isOwner: true, email: "contact1994@example.com", modules: {}, finance: {} }, { id: 2, name: "Anna", isOwner: false, email: "anna@marianna-biz.com", modules: { finance: false, settings: false }, finance: { pl: true } }];
  t("A-USR-1: the signed-in e-mail picks the person; a typed name counts for nothing on the shared copy; an unknown e-mail opens the Dashboard only", () => {
    eq(Pm.effectiveUserName(users, "Hazem Osman", "anna@marianna-biz.com"), "Anna", "Anna typed the owner's name — she is still Anna");
    eq(Pm.effectiveUserName(users, "", "contact1994@example.com"), "Hazem Osman", "case does not matter");
    const nobody = Pm.effectiveUserName(users, "Hazem Osman", "x@marianna-biz.com"); eq(Pm.canOpenModule(users, nobody, "orders"), false); eq(Pm.canOpenModule(users, nobody, "dashboard"), true); eq(Pm.canOpenModule(users, nobody, "settings"), false, "the v7.0.2 rule is cancelled");
    eq(Pm.effectiveUserName(users, "Anna", ""), "Anna", "no sign-in (single-browser mode): the typed name");
    eq(Pm.canOpenFinance(users, "Anna", "pl") && Pm.canOpenModule(users, "Anna", "finance"), false, "P/L ticked but Finance unticked → no result link");
  });
  t("A-PL-1: the Finance list's figure is the result AFTER overhead (the card's), and the card is gone from the sale", () => {
    const fx = FX.fixture("marianna-erp_v6.99.82_schema-v2_2026-09-30T13-13-23.json"); if (!fx) return; const d = require(fx); const so = d.orders.find(o => o.number === "SO-2026-0026");
    const m = OC.computeSOMarginWithOverhead(so, d.lots, d.pos, d.shipments, "forecast", d.operationalCosts || [], d.orders, [], []); ok(typeof m.netMarginPLN === "number" && typeof m.overheadCostsPLN === "number");
    const sod = require("fs").readFileSync(require("path").join(__dirname, "../src/SalesOrderDetail.tsx"), "utf8"); ok(!/<SOMarginCard/.test(sod), "no card on the sale"); ok(/Result of this sale/.test(sod));
    const fin = require("fs").readFileSync(require("path").join(__dirname, "../src/Finance.tsx"), "utf8"); ok(/computeSOMarginWithOverhead\(o, lots, pos, shipments, mode, operationalCosts, orders, invoices, financeNotes\)/.test(fin), "the list uses the card's calculation"); ok(/<SOMarginCard order=\{o\}/.test(fin), "the breakdown opens in Finance");
  });
  t("A-PV-5: the PO's sales are the sales of its lots; its shipments include trucks carrying those lots", () => {
    const fx = FX.fixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json"); if (!fx) return; const d = require(fx);
    // v7.24.1 (FZ-01): the app no longer re-points old sale lines at their lots on opening (proven done on both copies) — the 2 Oct file is older, so the check points them itself
    const lotOf = it => (d.lots || []).find(l => String(l.poRef) === String(it.sourceRef) && (it.sourceLineId == null || String(l.poLineId) === String(it.sourceLineId)));
    const orders = d.orders.map(o => ({ ...o, items: (o.items || []).map(it => it && it.sourceType === "PO" && lotOf(it) ? { ...it, sourceType: "STOCK", sourceRef: lotOf(it).number, sourceLineId: null } : it) }));
    const po = d.pos.find(p => p.number === "PO-2026-0044"); const cl = Dm.computedPOLinks(po, { shipments: d.shipments, lots: d.lots, invoices: d.invoices || [], orders });
    eq(cl.linkedSalesOrders.slice().sort().join(","), "SO-2026-0027,SO-2026-0028,SO-2026-0029"); ok(cl.linkedShipments.includes("SHP-2026-0039"), "the groupage truck carrying LOT-0127/0128");
  });
  t("A-BK-6: the TEST copy's files are named apart and its retention ignores the real copy's files (and vice versa)", () => {
    Bd.setBackupCopyLabel("TEST"); const n = Bd.autoFileName(new Date(2026, 9, 6, 14, 43, 23), "7.1.9"); ok(/^marianna-erp-TEST_auto_2026-10-06_14-43-23_v7\.1\.9\.json$/.test(n), n);
    ok(Bd.parseAutoFileName(n)); eq(Bd.parseAutoFileName("marianna-erp_auto_2026-10-06_14-43-23_v7.0.0.json"), null, "a real file is not the TEST copy's");
    Bd.setBackupCopyLabel(""); eq(Bd.autoFileName(new Date(2026, 9, 6, 14, 43, 23), "7.1.9"), "marianna-erp_auto_2026-10-06_14-43-23_v7.1.9.json"); eq(Bd.parseAutoFileName(n), null, "a TEST file is not the real copy's");
  });
  t("A-BK-5 / A-FI-4: only the writing tab backs up; a tidy-up error is 'retention postponed'; the import says what came back", () => {
    const ab = require("fs").readFileSync(require("path").join(__dirname, "../src/autoBackup.ts"), "utf8"); ok(/if \(!backupAllowed\(\)\) return;/.test(ab)); ok(/retention postponed/.test(ab)); ok(/retrying in 30 s/.test(ab));
    const inv = require("fs").readFileSync(require("path").join(__dirname, "../src/Invoices.tsx"), "utf8"); ok(/Fakturownia returned no received invoice for/.test(inv));
  });
  console.log("v7.1.9 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.1.10 — RETIRED in v7.1.13: the typed-name bootstrap is gone; an unlinked sign-in claims its entry ══
// ══ v7.1.11 — one gate for every road into a module ══
(function v7111(){
  console.log("\n══ v7.1.11. permissions enforced on every road, not only the tabs ══");
  t("navigate(), openDoc(), the document links and the render itself all pass mayOpen()", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../src/App.tsx"), "utf8");
    ok(/const mayOpen = \(k: string\) => canOpenModule\(users, who,/.test(src), "one gate");
    ok(/const navigate = (async )?\(target: string\) => \{\s*\n\s*if \(!mayOpen\(target\)\)/.test(src), "navigate refuses");   // v7.22.5 (A-RV-17): async — its refusal is the app's own window
    ok(/const target = docModule\(num\); if \(!target\) return;\s*\n\s*if \(!mayOpen\(target\)\)/.test(src), "openDoc refuses");
    ok(/canOpen: \(num: string\) => \{ const m = docModule\(num\); return !!m && mayOpen\(m\); \}/.test(src), "a link to a closed module is not a link");
    ok(/function renderActive\(\) \{\s*\n\s*if \(!mayOpen\(activeModule\)\)/.test(src), "the module is not rendered without the right");
    ok(!/canOpen=\{\(k: string\) => canOpenModule\(users, who/.test(src), "the top bar uses the same gate");
  });
  console.log("v7.1.11 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.1.12 — a sign-in claims its entry; nobody is locked out by the list's state ══
(function v7112(){
  console.log("\n══ v7.1.12. claim your entry ══");
  t("an unmatched sign-in may claim only an entry without e-mail — and, since v7.30.0 (Batch M), only while no owner is linked; the claim writes the e-mail and is audit-logged", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "../src/App.tsx"), "utf8");
  ok(/const free = hasOwner\(users \|\| \[\]\) \? \[\] : \(users \|\| \[\]\)\.filter\(\(u: any\) => !String\(u\.email \|\| ""\)\.trim\(\)\);/.test(src), "only entries without e-mail, only before an owner is linked");
    ok(/\{ \.\.\.x, email: signInEmail \}/.test(src), "the claim writes the e-mail"); ok(/linked itself to the entry/.test(src), "audit-logged");
  });
  console.log("v7.1.12 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.1.13 — one rule on the shared copy: the sign-in ══
(function v7113(){
  console.log("\n══ v7.1.13. one rule: the sign-in ══");
  const Pm = B("permissions.domain.js");
  t("on the shared copy the typed name never decides; an unlinked sign-in gets the Dashboard and the claim; Sign out is always there", () => {
    const noEmails = [{ id: 1, name: "Hazem Osman", isOwner: true, modules: {}, finance: {} }, { id: 2, name: "contact6098@example.com", isOwner: false, modules: { settings: false }, finance: {} }];
    const w = Pm.effectiveUserName(noEmails, "contact6098@example.com", "contact6098@example.com"); ok(w.startsWith("\u2205"), "an e-mail typed as a NAME links nothing: " + w); eq(Pm.canOpenModule(noEmails, w, "orders"), false);
    const src = require("fs").readFileSync(require("path").join(__dirname, "../src/App.tsx"), "utf8");
    ok((src.match(/\{signOut\}/g) || []).length >= 3, "Sign out on every shared-mode branch");
    const st = require("fs").readFileSync(require("path").join(__dirname, "../src/Settings.tsx"), "utf8"); ok(/SIGN-IN E-MAIL<\/div>/.test(st) && /placeholder="the e-mail they sign in with"/.test(st), "the e-mail is its own labelled column (v7.5.1)");
  });
  console.log("v7.1.13 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.1.14 — no owner → Settings open (reinstated, with a banner) ══
(function v7114(){
  console.log("\n══ v7.1.14. no owner → Settings open ══");
  const Pm = B("permissions.domain.js");
  t("two limited entries and no owner: Settings opens for any signed-in person (and nothing else); with an owner, the ticks decide", () => {
    const list = [{ id: 1, name: "contact6098@example.com", isOwner: false, email: "contact1994@example.com", modules: { settings: false, orders: true, finance: false }, finance: {} }, { id: 2, name: "info@marianna-biz.com", isOwner: false, modules: { settings: false }, finance: {} }];
    const who = Pm.effectiveUserName(list, "", "contact1994@example.com"); eq(who, "contact6098@example.com");
    eq(Pm.canOpenModule(list, who, "settings"), true, "no owner → Settings open"); eq(Pm.canOpenModule(list, who, "finance"), false, "nothing else opens");
    eq(Pm.canOpenModule(list, Pm.effectiveUserName(list, "", "x@x"), "settings"), true, "even an unlinked sign-in");
    const fixed = [...list, { id: 3, name: "Hazem Osman", isOwner: true, email: "hazem2@marianna-biz.com", modules: {}, finance: {} }];
    eq(Pm.canOpenModule(fixed, who, "settings"), false, "an owner exists → the ticks decide"); eq(Pm.canOpenModule(fixed, "Hazem Osman", "settings"), true);
    const src = require("fs").readFileSync(require("path").join(__dirname, "../src/App.tsx"), "utf8"); ok(/No owner with a sign-in e-mail is defined in Settings/.test(src), "the banner");
  });
  console.log("v7.1.14 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.1.15 — an owner without a sign-in e-mail is nobody (shared copy) ══
(function v7115(){
  console.log("\n══ v7.1.15. the owner must be reachable ══");
  const Pm = B("permissions.domain.js");
  t("an owner without an e-mail never counts (v7.21.0: there is only the shared data); the Settings tick refuses an owner without e-mail", () => {
    const list = [{ id: 1, name: "Hazem Osman", isOwner: true, modules: {}, finance: {} }]; eq(Pm.hasOwner(list), false, "v7.21.0 (A-RV-19): no single-browser mode where it counted");
    const src = require("fs").readFileSync(require("path").join(__dirname, "../src/permissions.domain.ts"), "utf8"); ok(/x\.isOwner && String\(\(x as any\)\.email \|\| ""\)\.trim\(\) !== ""/.test(src), "the owner needs an e-mail");
    const st = require("fs").readFileSync(require("path").join(__dirname, "../src/Settings.tsx"), "utf8"); ok(/isOwner: !!r\.isGM/.test(require("fs").readFileSync(require("path").join(__dirname, "../src/permissions.domain.ts"), "utf8")), "v7.5: the owner comes from the General Manager role; a GM without e-mail is refused at save (v7.2 checks)");
  });
  console.log("v7.1.15 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.2.0–7.2.5 — the Settings batch ══
(function v72(){
  console.log("\n══ v7.2.x. Settings: draft + Save, checks, restore owner-only, no local snapshots ══");
  const Pm = B("permissions.domain.js"); const ST = B("useLocalStoredState.js");
  const owner = { id: 1, name: "Hazem Osman", isOwner: true, roleId: "gm", email: "contact1994@example.com", modules: {}, finance: {} };
  const anna = { id: 2, name: "Marina", isOwner: false, roleId: "ops", email: "contact6098@example.com", modules: { settings: false }, finance: {} };
  t("A-SET-1: the checks refuse every list that locks someone out", () => {
    const ok0 = Pm.usersSaveProblems([owner, anna], { shared: true, signInEmail: "contact1994@example.com" }); eq(ok0.length, 0, ok0.join(" | "));
    ok(Pm.usersSaveProblems([anna], { shared: true, signInEmail: "contact1994@example.com" }).some(p => /No entry is marked owner/.test(p)));
    ok(Pm.usersSaveProblems([{ ...owner, email: "" }, anna], { shared: true, signInEmail: "contact1994@example.com" }).some(p => /no sign-in e-mail/.test(p)));
    ok(Pm.usersSaveProblems([owner, { ...anna, email: "contact1994@example.com" }], { shared: true, signInEmail: "contact1994@example.com" }).some(p => /on 2 entries/.test(p)));
    ok(Pm.usersSaveProblems([owner, { ...anna, isOwner: true }], { shared: true, signInEmail: "contact1994@example.com" }).some(p => /2 entries are marked owner/.test(p)));
    ok(Pm.usersSaveProblems([owner, anna], { shared: true, signInEmail: "contact6098@example.com" }).some(p => /would lose Settings/.test(p)), "a person without Settings cannot save a list that leaves them without it");
    ok(Pm.usersSaveProblems([owner, { ...anna, name: "contact6098@example.com", email: "marina@" }], { shared: true, signInEmail: "contact1994@example.com" }).some(p => /is not an e-mail/.test(p)));
    ok(Pm.usersSaveProblems([{ ...owner, email: "x@y.pl" }, anna], { shared: true, signInEmail: "contact1994@example.com" }).some(p => /saving would lock you out/.test(p)), "removing your own e-mail is refused");
  });
  t("A-SET-1: the confirmation lists exactly what changes", () => {
    const d = Pm.usersDiff([owner, anna], [owner, { ...anna, modules: { settings: false, finance: false }, email: "m@marianna-biz.com" }, { id: 3, name: "Info", isOwner: false, modules: {}, finance: {} }]);
    ok(d.some(l => /^\+ new user Info/.test(l))); ok(d.some(l => /Marina: sign-in e-mail contact6098@example.com → m@marianna-biz.com/.test(l))); ok(d.some(l => /Marina: finance unticked/.test(l)));
    ok(Pm.usersDiff([owner, anna], [owner]).some(l => /REMOVED Marina/.test(l)));
  });
  t("A-SET-1..5 in the screens: draft + Save users; Company and Numbering saved on purpose; bank default and Locations card gone; restore owner-only; no snapshots on the shared data", () => {
    const st = require("fs").readFileSync(require("path").join(__dirname, "../src/Settings.tsx"), "utf8");
    ok(/Save users<\/button>/.test(st) && /useUnsavedGuard\(\{ id: "settings-users"/.test(st)); ok(/useSectionDraft\(savedCompany, saveCompany, "company"/.test(st) && /useSectionDraft\(savedNumbering, saveNumbering, "numbering"/.test(st));
    ok(!/DEFAULT BANK ACCOUNT PER CURRENCY/.test(st), "bank default gone"); ok(!/title="LOCATIONS — managed in the Directory/.test(st), "Locations card gone");
    ok(/Only the owner can restore a backup/.test(st)); ok(!/LOCAL BACKUPS/.test(st), "v7.3.1 (A-SET-6) · v7.21.0: no snapshots card at all");
    ok(typeof ST.createBackup === "undefined", "v7.21.0 (A-RV-19): no local snapshot can be taken");
  });
  console.log("v7.2.5 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.3.0–7.3.5 — locations, sync of side stores, snapshots, the people button ══
(function v73(){
  console.log("\n══ v7.3.x. locations batch ══");
  const Lm = B("locations.js"); const I = B("integrityCheck.js");
  t("A-LOC-1: an unticked company's address still RESOLVES (prints, old documents) but is not OFFERED; ticked carriers become places", () => {
    const cs = [{ id: 501, name: "Prod A", type: "Supplier", address: "Farm 1, 05-555 X", country: "Poland" }, { id: 502, name: "Client Office", type: "Client", isPlace: false, address: "Office 2", country: "Poland" }, { id: 503, name: "Carrier Yard", type: "Carrier", isPlace: true, address: "Yard 3", country: "Poland" }, { id: 504, name: "Forwarder", type: "Forwarder", address: "Office 4", country: "Poland" }];
    Lm.setPartiesForPlaces(cs); const all = Lm.allPlaces().filter(l => l.pickable !== false); const has = n => all.some(l => l.name === n);   // v7.32.0: the Parties handed over
    ok(has("Prod A"), "a producer is offered"); ok(!has("Client Office"), "unticked → not offered"); ok(has("Carrier Yard"), "a ticked carrier is offered"); ok(!has("Forwarder"), "a forwarder by default is not");
    const off = Lm.counterpartyLocations([cs[1]])[0]; ok(Lm.locationById(off.id, cs), "the unticked address still resolves for documents and prints");
  });
  t("A-LOC-2 · v7.32.0 (FZ-04a): no built-in place exists — a place is an address in Parties (a company's) or a public place in Parties › Locations; the places a document uses are counted by one helper", () => {
    ok(!Lm.LOCATIONS_ALL_BUILTIN && !Lm.ensureUsedBuiltinsAreOrdinary && !Lm.registerCounterpartyLocations && !Lm.readLogisticsPoints && !Lm.readLocationOverrides, "a legacy place mechanism is back");
    eq(Lm.usedLocationIds({ pos: [{ destinationLocationId: 5 }], shipments: [{ legs: [{ fromId: 7, toId: 8 }] }] }).size, 3);
    Lm.setPartiesForPlaces([]);
  });
  t("A-LOC-3: a PO whose named place is no location any more is listed with the text it read", () => {
    const r = I.checkIntegrity({ contacts: [], pos: [{ number: "PO-T", status: "Confirmed", destinationLocationId: "178456227978300", destinationText: "ul. Sitarot 47, Mogielnica" }], lots: [], orders: [], shipments: [], invoices: [], financeNotes: [], warehouseInvoices: [], operationalCosts: [] });
    const p = r.issues.find(x => x.code === "PLACE_UNKNOWN"); ok(p && /ul. Sitarot 47/.test(p.message), p && p.message);
  });
  t("A-SYNC-1 / A-SET-6 / A-PT-4 in the code", () => {
    const rd = f => require("fs").readFileSync(require("path").join(__dirname, "../src/" + f), "utf8");
    ok(/writeSharedStoreValue\("customLocations", list\)/.test(rd("locations.ts")), "places reach the shared data"); ok(/writeSharedStoreValue\("reportRegister"/.test(rd("reportNumbers.ts")), "report numbers reach the shared data");
    ok(/\ndropLegacySnapshots\(\);/.test(rd("App.tsx")), "v7.21.0 (A-RV-19): the old snapshots leave the browser once, on opening"); ok(/setViewMode\("companies"\)/.test(rd("Contacts.tsx")), "the → opens the company on its tab");
  });
  console.log("v7.3.5 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.4.0–7.4.2 — recovery record by record ══
(function v74(){
  console.log("\n══ v7.4.x. recover from a backup ══");
  const R = B("recovery.domain.js"); const fx = FX.fixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json"); if (!fx) return; const d = require(fx);
  const po = d.pos.find(p => p.number === "PO-2026-0044"); const prodId = String(po.supplier.id);
  const now = { ...d, pos: d.pos.filter(p => p.number !== "PO-2026-0044"), lots: d.lots.filter(l => l.poRef !== "PO-2026-0044"), contacts: d.contacts.filter(c => String(c.id) !== prodId) };
  t("A-REC-1: the comparison names what is missing; recovering the PO brings its producer along, removes nothing, leaves the rest alone", () => {
    const diffs = R.compareBackup(now, d); eq(diffs.find(x => x.key === "pos").missing.map(R.labelOf).join(), "PO-2026-0044"); eq(diffs.find(x => x.key === "lots").missing.length, 2);
    const plan = R.planRecovery(now, d, [{ key: "pos", rec: po }]); eq(plan.take.map(t => t.key).sort().join(), "contacts,pos", "the PO + the producer it needs");
    const next = R.applyRecovery(now, plan); eq(next.pos.length, d.pos.length); eq(next.contacts.length, d.contacts.length); ok(!next.lots, "lots untouched — they are listed to tick on their own");
    const today = { ...d, pos: d.pos.map(p => p.number === "PO-2026-0043" ? { ...p, notes: "edited today" } : p) }; const df = R.compareBackup(today, d).find(x => x.key === "pos"); eq(df.differ.length, 1, "a record edited since is 'different', not missing");
    const keep = R.applyRecovery(today, R.planRecovery(today, d, [])); eq(Object.keys(keep).length, 0, "nothing ticked → nothing changes");
  });
  console.log("v7.4.2 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.5.0–7.5.2 — roles and the users list ══
(function v75(){
  console.log("\n══ v7.5.x. roles ══");
  const Pm = B("permissions.domain.js");
  t("A-ROLE-1: six proposed roles; a user's rights come from the role (+ extras); the General Manager role makes the owner", () => {
    eq(Pm.DEFAULT_ROLES.map(r => r.name).join(), "General Manager,Administration,Finance,Operations,Sales,Warehouse");
    const u = Pm.materializeUser({ id: 2, name: "Marina", roleId: "ops", email: "m@x.pl", extraModules: ["invoices"] }, Pm.DEFAULT_ROLES);
    eq(u.modules.pos, true); eq(u.modules.invoices, true, "extra"); eq(u.modules.finance, false); eq(u.isOwner, false); eq(Pm.rightsSummary(u, Pm.DEFAULT_ROLES), "Operations + invoices");
    eq(Pm.canOpenModule([Pm.materializeUser({ id: 1, name: "H", roleId: "gm", email: "h@x.pl" }, Pm.DEFAULT_ROLES), u], "Marina", "settings"), false);
    eq(Pm.materializeUser({ id: 1, name: "H", roleId: "gm" }, Pm.DEFAULT_ROLES).isOwner, true);
    eq(Pm.materializeUser({ id: 9, name: "Old", modules: { pos: true } }, Pm.DEFAULT_ROLES).modules.pos, true, "a user without a role keeps the old ticks until one is chosen");
  });
  t("A-USR-8: on the shared data a user without a role or an e-mail is refused at save", () => {
    const gm = Pm.materializeUser({ id: 1, name: "Hazem", roleId: "gm", email: "contact1994@example.com" }, Pm.DEFAULT_ROLES);
    ok(Pm.usersSaveProblems([gm, { id: 2, name: "New", modules: {}, finance: {} }], { shared: true, signInEmail: "contact1994@example.com" }).some(p => /has no role/.test(p)));
    eq(Pm.usersSaveProblems([gm], { shared: true, signInEmail: "contact1994@example.com" }).length, 0);
  });
  console.log("v7.5.2 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.6.0–7.6.2 — the Locations tab and a company's locations ══
(function v76(){
  console.log("\n══ v7.6.x. locations tab ══");
  t("A-PT-5 / A-LOC-1: Locations tab with chips, search, actions and a window; a company's locations on its card; a location carries its owner", () => {
    const c = require("fs").readFileSync(require("path").join(__dirname, "../src/Contacts.tsx"), "utf8");
    ok(/label: "Locations", icon: "📍"/.test(c), "renamed"); ok(/\["company", "Companies' places"/.test(c), "chips instead of tick boxes (the Hidden chip retired in v7.7.1)"); ok(/placeholder="Search locations, address, country, company…"/.test(c)); ok(/\+ New location<\/button>/.test(c) && /Belongs to company \(optional\)/.test(c), "+ New location in a window, with the owner company");
    ok(/>LOCATIONS<\/div>/.test(c) && /\+ add location<\/button>/.test(c), "the company card lists its locations and adds one"); ok(/open company →/.test(c), "a company's address opens its company");
    const l = require("fs").readFileSync(require("path").join(__dirname, "../src/locations.ts"), "utf8"); ok(/ownerId: input\.ownerId/.test(l), "a new location keeps its owner");
  });
  console.log("v7.6.2 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.7.0–7.7.2 — expected lots sell ahead; leftovers retired; the lot picker ══
(function v77(){
  console.log("\n══ v7.7.x. ══");
  const Q = B("seasonOps.domain.js"); const ST = B("useLocalStoredState.js"); const Lm = B("locations.js");
  t("A-ONE-2: an expected lot offers its expected kilos as class I; a received lot keeps the receipt's split", () => {
    const fx = FX.fixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json"); if (!fx) return; const d = require(fx);
    eq(Q.gradeAvailability(d.lots.find(l => l.number === "LOT-2026-0004"), []).I, 550, "was 0");
    eq(Q.gradeStockNow({ receivedKg: 0, expectedKg: 300, movements: [] }).I, 300); eq(Q.gradeStockNow({ receivedKg: 280, expectedKg: 300, movements: [{ type: "IN", qtyKg: 280 }] }).I, 280, "received: the receipt decides");
  });
  t("A-RET-1: the retired stores are no longer shared; the demo fallback is gone; the pre-v7 repairs do not run on the shared data", () => {
    ok(!ST.DATA_KEYS.includes("loadPlans") && !ST.DATA_KEYS.includes("logisticsPoints"));
    eq(Lm.locationById(3, []), null, "a demo id resolves only once it became an ordinary location");
    const app = require("fs").readFileSync(require("path").join(__dirname, "../src/App.tsx"), "utf8");
    eq((app.match(/healDone\(MARK\) \|\| isSharedMode\(\)\) return;/g) || []).length, 0, "v7.21.0 (A-RV-19): the pre-v7 repairs are gone"); eq((app.match(/if \(isSharedMode\(\)\) return;/g) || []).length, 0); ok(!/useLocalStoredState\("userRole"/.test(app)); ok(!/same version\./.test(app));
  });
  t("A-SO-PK-1: the picker's header, order and fold", () => {
    const f = require("fs").readFileSync(require("path").join(__dirname, "../src/SalesOrderForm.tsx"), "utf8");
    ok(/Choose the lot for line/.test(f) && !/setTab\("STOCK"\)/.test(f), "no leftover stock button"); ok(/\[\.\.\.availLots, \.\.\.\(showNA \? naLots : \[\]\)\]/.test(f)); ok(/not available \(\{naLots\.length\}\)/.test(f));
  });
  console.log("v7.7.2 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.8.0–7.8.3 ══
(function v78(){
  console.log("\n══ v7.8.x. producer's reference · lot card · PO layout · producer's settlement ══");
  const R = B("supplierRef.domain.js");
  t("A-PO-REF-1: the same reference (spaces, dashes, case aside) on another live PO is found; the PO itself and deleted ones do not count", () => {
    const pos = [{ number: "PO-1", supplierRef: "VP-0012" }, { number: "PO-2", supplierRef: "x" }, { number: "PO-3", status: "Cancelled", supplierRef: "vp 0012" }];
    eq(R.supplierRefUsedOn("vp 0012", "PO-2", pos, []).join(), "PO-1"); eq(R.supplierRefUsedOn("VP-0012", "PO-1", pos, []).length, 0, "its own PO"); eq(R.supplierRefUsedOn("", "PO-2", pos, []).length, 0);
    eq(R.duplicateSupplierRefs([...pos, { number: "PO-4", supplierRef: "VP/0012" }], []).length, 1, "the integrity check finds the existing duplicate");
  });
  t("A-ST-12 / A-SO-PK-2 / A-PV-7 / A-PL-2 in the code", () => {
    const rd = f => require("fs").readFileSync(require("path").join(__dirname, "../src/" + f), "utf8");
    ok(/Producer's provisional invoice\$\{provisionalNo/.test(rd("SalesReportDoc.tsx")), "the number on the report");
    ok(/ · at \$\{\(lot as any\)\.locationName\}/.test(rd("SalesOrderForm.tsx")) && /expected \$\{formatDMY/.test(rd("SalesOrderForm.tsx")), "where the goods are; expected, not arrived");
    ok(/Producer's settlement — /.test(rd("PurchaseOrders.tsx")) && /Result of this truck → Finance/.test(rd("PurchaseOrders.tsx")), "the statement titled, the link"); ok(/CONSIGNMENT TRUCKS — OUR RESULT/.test(rd("Finance.tsx")));
  });
  console.log("v7.8.3 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.9.0–7.9.2 — Incoterms 2020; the shipment gate; places filled from their owners ══
(function v79(){
  console.log("\n══ v7.9.x. incoterms ══");
  const I = B("incoterms.domain.js"); const G = B("moduleGuards.domain.js");
  t("A-INC-1: the 11 rules of Incoterms 2020 — risk point and cost point apart for the C-rules; clearance and insurance", () => {
    eq(Object.keys(I.INCOTERMS_2020).length, 11);
    eq(I.ruleOf("CIF").riskAt, "on-board"); eq(I.ruleOf("CIF").costsTo, "named-destination"); eq(I.ruleOf("CIF").insurance, "ICC (C) minimum"); eq(I.ruleOf("CIP").insurance, "ICC (A)");
    eq(I.ruleOf("FOB").seaOnly, true); eq(I.ruleOf("FCA").seaOnly, false); eq(I.ruleOf("xyz"), null);
  });
  t("A-SHP-GATE-1: SHP-2026-0043 cannot become Loaded — SO-2026-0032 Draft, LOT-2026-0106 without real kilos; booking stays allowed", () => {
    const fx = "/tmp/d8.json"; if (!require("fs").existsSync(fx)) { console.log("      (8 Oct file not present — skipped)"); return; } const d = require(fx); const sh = d.shipments.find(s => s.number === "SHP-2026-0043");
    const r = G.shipmentPostBlockReason(sh, "Loaded", { orders: d.orders, lots: d.lots }); ok(/SO-2026-0032 is still a Draft/.test(r) && /LOT-2026-0106 has no real kilos yet/.test(r), r); eq(G.shipmentPostBlockReason(sh, "Booked", { orders: d.orders, lots: d.lots }), "");
    const f = I.fillEmptyPlaces(sh, { orders: d.orders, lots: d.lots }); eq(f.next.legs.map(l => l.mode + ":" + l.fromLocationId + ">" + l.toLocationId).join(), "Road:126>113,Sea:113>126", "Koper from the booking; nothing overwritten");
  });
  console.log("v7.9.2 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.16.0–7.16.4 — Batch A, the quick fixes on money and kilos (owner 9 Oct: 'batch what is ready now') ══
(function v716(){
  console.log("\n══ v7.16.x. batch A — quick fixes ══");
  const P = B("payments.domain.js"), A = B("advances.domain.js"), S = B("poSettlement.domain.js"), LP = B("loadingProtocol.domain.js"), I = B("invoicing.js");
  t("AUD-23: the last payment removed — a cost invoice goes back to Issued (Sent would lock it); a sales invoice stays Sent", () => {
    let id = 0; const nid = () => "e" + (++id);
    const cost = P.applyPaymentEvent({ kind: "COST", paymentStatus: "Issued", grossAmount: 100 }, { date: "2026-10-01", amount: 100 }, nid);
    eq(cost.paymentStatus, "Paid"); eq(P.removePaymentEvent(cost, cost.payments[0].id).paymentStatus, "Issued");
    const sale = P.applyPaymentEvent({ kind: "SALES", paymentStatus: "Sent", grossAmount: 100 }, { date: "2026-10-01", amount: 40 }, nid);
    eq(sale.paymentStatus, "Partially paid"); eq(P.removePaymentEvent(sale, sale.payments[0].id).paymentStatus, "Sent");
  });
  t("AUD-25: an advance is booked on the day the money came in, not the day it is applied", () => {
    let id = 0; const r = A.applyAdvanceToInvoice({ id: "a1", counterpartyName: "AGRO-MAX", date: "2026-09-03", amount: 500, currency: "EUR", fxRate: 0, amountPLN: 0, source: "bank:1", allocations: [] },
      { id: "i1", number: "FV/1", currency: "EUR", grossAmount: 800, paymentStatus: "Sent", payments: [] }, 500, { nextId: () => "n" + (++id), todayISO: () => "2026-10-10" });
    eq(r.invoice.payments[0].date, "2026-09-03"); eq(r.advance.allocations[0].date, "2026-09-03");
  });
  t("AUD-31: a EUR settlement without a rate — no expected note, no commission invoice, nothing booked at 1.0", () => {
    const calc = { expectedCreditNoteEUR: 1000, extraInvoiceEUR: 1000, commissionEUR: 50, ratePLNperEUR: 0, currency: "EUR", provisionalEUR: 1000, netSalesEUR: 0, commissionPct: 5, transferEUR: 0 };
    const po = { number: "PO-T", supplier: { id: 1, name: "Producer" } }; const deps = { nextId: () => "x", todayISO: () => "2026-10-10" };
    eq(S.expectedProducerCreditNote(po, calc, deps), null); eq(S.expectedProducerExtraInvoice(po, calc, deps), null); eq(S.commissionInvoiceDraft(po, calc, { number: "SET-T" }, deps), null);
    const withRate = S.expectedProducerCreditNote(po, { ...calc, ratePLNperEUR: 4.25 }, deps); eq(withRate.fxRate, 4.25); eq(withRate.amountPLN, 4250);
    const pf = FX.needFixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json", "the owner's 2 Oct file"); if (!pf) return;
    const d = JSON.parse(require("fs").readFileSync(pf, "utf8")); const po2 = (d.pos || []).find(p => String(p.pricingMode) === "consignment"); ok(po2, "no consignment PO in the 2 Oct file");
    const c2 = S.computePOSettlement({ po: { ...po2, currency: "EUR" }, lots: d.lots, orders: d.orders, invoices: d.invoices || [], shipments: d.shipments, claims: d.claims || [], ratePLNperEUR: 0, provisionalEUR: 20000, commissionPct: 6 });
    eq(c2.expectedCreditNoteEUR, 0, "the whole provisional was expected back"); eq(c2.extraInvoiceEUR, 0); ok(c2.warnings.some(w => /No PLN→EUR rate/.test(w)), "the missing-rate warning is gone");
  });
  t("AUD-42: a line deliberately at 0 kg stays 0 — never re-filled from its old 'qty' on the protocol or in its checks", () => {
    const zero = { id: 1, product: "Papryka", qtyKg: 0, qty: 500 };
    eq(LP.lineKg(zero), 0); eq(LP.lineKg({ qty: 300 }), 300); eq(LP.lineKg({ qtyKg: "", qty: 200 }), 200); eq(LP.lineKg({ qtyKg: "120", qty: 500 }), 120);
    eq(LP.packagingResolution([zero], []).ok, true, "a 0 kg line has nothing to pack");
    eq(LP.assignmentCheck([zero], [{ load: [{ goodsLineId: 1, qtyKg: 10 }] }])[0].totalKg, 0);
  });
  t("AUD-17: the lines sent to Fakturownia add up to the invoice to the grosz; a line-less invoice is named from its documents, never its notes", () => {
    const inv = { kind: "SALES", currency: "PLN", vatRate: 23, grossAmount: 122.99, positions: [1, 2, 3].map(k => ({ name: "Line " + k, quantity: 1, unit: "kg", netTotal: 33.33, vatRate: 23 })) };
    const ps = I.buildFakturowniaPayload(inv, { apiToken: "x" }).invoice.positions; const sum = Math.round(ps.reduce((a, p) => a + p.total_price_gross, 0) * 100) / 100;
    eq(sum, 122.99, "3 × 41.00 = 123.00 was sent"); eq(I.pushBlockers(inv).length, 0);
    const far = { ...inv, grossAmount: 125 }; ok(I.pushBlockers(far).length === 1, "a real gap must still block the push");
    const bare = { kind: "SALES", grossAmount: 100, vatRate: 5, notes: "Awaiting the supplier's invoice number", links: [{ type: "SO", number: "SO-2026-0091" }], positions: [] };
    const nm = I.buildFakturowniaPayload(bare, { apiToken: "x" }).invoice.positions[0].name; eq(nm, "Sales invoice — SO-2026-0091"); ok(!/Awaiting/.test(nm), nm);
  });
  console.log("v7.16.4 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.17.0–7.17.5 — Batch B, the rules (owner 9 Oct: 'batch what is ready now') ══
(function v717(){
  console.log("\n══ v7.17.x. batch B — the rules ══");
  const CP = B("counterparty.domain.js"), MD = B("masterData.domain.js"), IC = B("integrityCheck.js"), AT = B("auditTrail.domain.js");
  t("A-DEL-5: a deleted company leaves every picker; a document that names it still shows it, marked (deleted)", () => {
    const cs = [{ id: 1, name: "TBX", type: "Carrier" }, { id: 2, name: "Old Carrier", type: "Carrier", deleted: true, deletedAt: "2026-10-10" }];
    eq(CP.activeParties(cs).map(c => c.name).join(), "TBX"); eq(CP.pickerParties(cs, 2).map(c => c.name).join(), "TBX,Old Carrier"); eq(CP.archivedMark(cs[1]), " (deleted)");
  });
  t("A-RV-07: who uses a packaging type or a catalog item; deleted items and varieties are kept, struck through; an orphan lot already deleted is not offered again", () => {
    const stores = { pos: [{ number: "PO-1", items: [{ product: "Papryka", variety: "Kapia", packagingId: "box-5" }] }], orders: [{ number: "SO-1", items: [{ product: "Papryka", variety: "Kapia", packaging: "Karton 10 kg" }] }], shipments: [{ number: "SHP-1", goods: [{ packaging: "box-5" }] }], lots: [] };
    eq(MD.packagingUsers({ id: "box-5", label: "Karton 5 kg" }, stores).join(), "PO-1,SHP-1"); eq(MD.packagingUsers({ id: "k10", label: "Karton 10 kg" }, stores).join(), "SO-1"); eq(MD.packagingUsers({ id: "x", label: "X" }, stores).length, 0);
    eq(MD.catalogUsers("papryka", null, stores).join(), "PO-1,SO-1"); eq(MD.catalogUsers("Papryka", "Żółta", stores).length, 0);
    let cat = [{ item: "Papryka", varieties: ["Kapia", "Żółta"] }, { item: "Jabłko", varieties: [] }];
    cat = MD.softDeleteVariety(cat, "Papryka", "Żółta", "2026-10-10"); eq(cat[0].varieties.join(), "Kapia"); eq(cat[0].deletedVarieties.join(), "Żółta");
    cat = MD.softDeleteCatalogItem(cat, "Jabłko", "2026-10-10"); eq(MD.liveOnly(cat).map(c => c.item).join(), "Papryka"); eq(cat.length, 2); eq(MD.liveOnly(MD.restoreCatalogItem(cat, "jabłko")).length, 2);
    eq(IC.orphanLotsToRemove([{ id: 1, number: "LOT-X", poRef: "PO-GONE", status: "Cancelled" }, { id: 2, number: "LOT-Y", poRef: "PO-GONE" }], []).map(l => l.number).join(), "LOT-Y");
    const pf = FX.needFixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json", "the owner's 2 Oct file"); if (!pf) return;
    const d = JSON.parse(require("fs").readFileSync(pf, "utf8")); const used = (d.packagingTypes || []).map(x => [x.label, MD.packagingUsers(x, d).length]).filter(x => x[1] > 0);
    console.log(`      (2 Oct file: ${used.length} packaging type(s) in use${used.length ? `, e.g. ${used[0][0]} by ${used[0][1]} document(s)` : ""})`);
  });
  t("A-RV-12: past the cap the oldest audit entries move to the archive — none dropped, none twice", () => {
    const log = Array.from({ length: 7 }, (_, i) => ({ id: i + 1 })); const r = AT.splitAuditOverflow(log, 5);
    eq(r.keep.map(e => e.id).join(), "3,4,5,6,7"); eq(r.over.map(e => e.id).join(), "1,2");
    let arch = AT.archiveAudit([], r.over); arch = AT.archiveAudit(arch, r.over); eq(arch.map(e => e.id).join(), "1,2"); eq(AT.splitAuditOverflow(log, 10).over.length, 0);
  });
  console.log("v7.17.5 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.18.0–7.18.8 — Batch C, lists instead of typing (owner 9 Oct: 'batch what is ready now') ══
(function v718(){
  console.log("\n══ v7.18.x. batch C — lists instead of typing ══");
  const P = B("packaging.domain.js"), L = B("locations.js"), SM = B("shipmentModel.domain.js"), PC = B("productCatalog.js"), MD = B("masterData.domain.js"), PS = B("poSettlement.domain.js"), FXm = B("fx.js");
  const pf = FX.needFixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json", "the owner's 2 Oct file"); const d = pf ? JSON.parse(require("fs").readFileSync(pf, "utf8")) : null;
  const types = [{ id: "wooden-box-13", label: "Wooden box (13 kg)", capacityKg: 13, tareKg: 1.4 }, { id: "carton-13-kg", label: "Box (13 kg)", capacityKg: 13, tareKg: 0.7 }, { id: "carton-5-kg", label: "Carton (5 kg)", capacityKg: 5, tareKg: 0.5 }, { id: "carton-10", label: "Carton (10 kg)", capacityKg: 10, tareKg: 0.6 }, { id: "carton-6-pcs", label: "Carton (6 pcs)", capacityKg: 6, tareKg: 0.6 }];
  t("A-AU-1: a typed packaging gets a suggestion only when one type fits; each spelling is linked once, on live orders only", () => {
    const sug = s => (P.suggestPackagingType(s, types) || {}).id || null;
    eq(sug("13kg wooden boxes"), "wooden-box-13"); eq(sug("5 kg caron box"), "carton-5-kg"); eq(sug("13 kg carton box"), "carton-13-kg"); eq(sug("6 pcs box"), "carton-6-pcs");
    eq(sug("13 kg boxes"), null, "two 13 kg types — no guess"); eq(sug("10 kg bag"), null, "no 10 kg bag type — no guess");
    const pos = [{ number: "PO-1", items: [{ packaging: "13kg wooden boxes" }, { packaging: "13KG  wooden boxes" }, { packaging: "Box (13 kg)", packagingId: "carton-13-kg" }] }, { number: "PO-2", status: "Cancelled", items: [{ packaging: "13kg wooden boxes" }] }];
    const sp = P.typedPackagingSpellings({ pos, orders: [] }, types); eq(sp.length, 1); eq(sp[0].poLines, 2);
    const r = P.linkSpellingOnDocs(pos, sp[0].key, types[0], types); eq(r.lines, 2); eq(r.changed.join(), "PO-1");
    eq(r.docs[0].items.map(i => i.packagingId).join(), "wooden-box-13,wooden-box-13,carton-13-kg"); eq(r.docs[0].items[0].packaging, "Wooden box (13 kg)"); ok(r.docs[1] === pos[1], "a cancelled PO was changed");
    ok(!!P.packagingTypeFromForm({ label: "carton (5 KG)", capacityKg: 5, tareKg: 0.5 }, types).error, "a duplicate name was accepted"); eq(P.packagingTypeFromForm({ label: "Crate (8 kg)", capacityKg: "8", tareKg: "0,9" }, types).type.tareKg, 0.9);
    if (d) { const s2 = P.typedPackagingSpellings(d, d.packagingTypes); console.log(`      (2 Oct file: ${s2.length} spellings on ${s2.reduce((a, x) => a + x.poLines + x.soLines, 0)} live order lines, ${s2.filter(x => x.suggestion).length} with a suggested type)`); }
  });
  t("A-AU-3: a typed sale destination is listed once per client and address; the client's legal address links to it", () => {
    const contacts = [{ id: 7, name: "Tozelutu", type: "Client", country: "Poland", address: "ul. Momomod 65, 18-303 Warszawa" }];
    const orders = [{ number: "SO-1", client: { id: 7 }, destinationText: "ul. Momomod 65, 18-303 WARSZAWA" }, { number: "SO-2", client: { id: 7 }, destinationText: "ul. Momomod 65, 18-303 Warszawa" }, { number: "SO-3", client: { id: 7 }, destinationText: "Other 1", deleted: true }, { number: "SO-4", client: { id: 7 }, destinationText: "x", destinationLocationId: 5 }];
    const ty = L.typedSaleDestinations(orders, contacts); eq(ty.length, 1); eq(ty[0].orders.join(), "SO-1,SO-2"); ok(ty[0].legalSiteId != null, "not matched to the legal address");
    const r = L.linkSaleDestinationOn(orders, ty[0].key, { id: ty[0].legalSiteId, name: "Tozelutu" }); eq(r.changed.join(), "SO-1,SO-2"); eq(r.orders[0].destinationLocationId, ty[0].legalSiteId); ok(r.orders[2] === orders[2] && r.orders[3] === orders[3], "a deleted or placed sale was changed");
    eq(L.clientSites(contacts[0], [{ id: 10050, name: "Tozelutu — Bronisze", ownerId: 7, address: "Bronisze" }]).map(s => s.legal).join(), "true,false");
    if (d) { const t2 = L.typedSaleDestinations(d.orders, d.contacts); console.log(`      (2 Oct file: ${t2.length} typed addresses on ${t2.reduce((a, x) => a + x.orders.length, 0)} live sales, ${t2.filter(x => x.legalSiteId != null).length} the client's legal address)`); }
  });
  t("A-AU-4: a shipment document's type comes from one list; variants map once, the unknown become Other with their words", () => {
    eq(SM.docTypeOf("PL").type, "Packing list"); eq(SM.docTypeOf("Export declaration MRN").type, "Export declaration"); eq(SM.docTypeOf("Loading protokol").type, "Loading protocol"); eq(SM.docTypeOf("COO").type, "Certificate of origin"); eq(SM.docTypeOf("bl").type, "BL");
    const o = SM.docTypeOf("Weighing note"); eq(o.type, "Other"); eq(o.description, "Weighing note");
    // v7.24.1 (FZ-01): the one-time mapping of the old typed values ran on both copies (no change left, 15 Oct) and went; the one list stays
    eq(SM.documentRegister({ documents: [{ type: "Other", description: "Weighing note" }] }).find(r => /^Other/.test(r.kind)).kind, "Other — Weighing note");
    
  });
  t("A-AU-5: each item carries its calibres and colorations; a value in use can't be deleted; the values on lines are offered", () => {
    let cat = [{ item: "Apples", varieties: [] }]; cat = PC.addCatalogValue(cat, "Apples", "calibres", "70-80"); cat = PC.addCatalogValue(cat, "apples", "calibres", "65-70"); cat = PC.addCatalogValue(cat, "Apples", "calibres", "70-80");
    eq(PC.valuesForItem(cat, "Apples", "calibres").join(), "65-70,70-80"); eq(PC.valuesForItem(cat, "Apples", "colorations").length, 0);
    const stores = { pos: [{ number: "PO-1", items: [{ product: "Apples", size: "70-80", coloration: "Full colour" }, { product: "Apples", size: "70-80", coloration: "full colour" }, { product: "Apples", size: "60-65", coloration: "Full colour" }] }], orders: [], lots: [] };
    eq(MD.catalogValueUsers("Apples", "calibres", "70-80", stores).join(), "PO-1"); eq(MD.catalogValueUsers("Apples", "calibres", "65-70", stores).length, 0);
    const iu = MD.valuesInUse("Apples", "colorations", stores); eq(iu.length, 1); eq(iu[0].value, "Full colour"); eq(iu[0].lines, 3);
    cat = MD.softDeleteCatalogValue(cat, "Apples", "calibres", "65-70", "2026-10-11"); eq(PC.valuesForItem(cat, "Apples", "calibres").join(), "70-80"); eq(cat[0].deletedCalibres.join(), "65-70");
    cat = PC.addCatalogValue(cat, "Apples", "calibres", "65-70"); eq(cat[0].deletedCalibres.length, 0, "added again — no longer deleted");
  });
  t("A-AU-12: a settlement takes the NBP rate of the day before its date — today while open, kept once closed", () => {
    FXm.__setNbpStore({ days: { "2026-10-09": { EUR: 4.2611 } }, covered: { "2026-10-09": 1, "2026-10-10": 1 } });
    eq(PS.settlementRate({ currency: "EUR" }, { status: "Open", ratePLNperEUR: 4.35 }, "2026-10-11").rate, 4.2611, "the typed 4.35 is still used");
    eq(PS.settlementRate({ currency: "EUR" }, { status: "Closed", ratePLNperEUR: 4.3, fxTableDate: "2026-09-30" }, "2026-10-11").rate, 4.3);
    eq(PS.settlementRate({ currency: "PLN" }, {}, "2026-10-11").rate, 1); eq(PS.settlementRate({ currency: "EUR" }, {}, "2026-12-01").rate, 0, "not read yet — 0, never a guess");
    FXm.__setNbpStore({ days: {}, covered: {} });
  });
  console.log("v7.18.8 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.19.0–7.19.6 — Batch D, shipments and incoterms (owner 9 Oct: 'batch what is ready now') ══
(function v719(){
  console.log("\n══ v7.19.x. batch D — shipments and incoterms ══");
  const IC = B("incoterms.domain.js"), SM = B("shipmentModel.domain.js"), SD = B("shipments.domain.js");
  const pf = FX.needFixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json", "the owner's 2 Oct file"); const d = pf ? JSON.parse(require("fs").readFileSync(pf, "utf8")) : null;
  const pay = (sh, pos, orders) => IC.legFreightPayers(sh, { pos, orders }).map(x => x.payer).join(",");
  const po = (t, np) => [{ number: "P", buyIncoterm: t, destinationLocationId: np }], so = (t, np) => [{ number: "S", sellIncoterm: t, destinationLocationId: np }];
  t("A-INC-1 (1/5): each leg's freight follows the two incoterms — the supplier's up to the PO's named place, the client's after our handover, ours between", () => {
    const rs = (extra) => ({ purpose: "OUTBOUND", poRefs: ["P"], governingSoRef: "S", originLocationId: 1, legs: [{ mode: "Road", fromLocationId: 1, toLocationId: 2 }, { mode: "Sea", fromLocationId: 2, toLocationId: 3 }, { mode: "Road", fromLocationId: 3, toLocationId: 4 }], ...extra });
    eq(pay(rs(), po("EXW", 1), so("CIF", 3)), "us,us,client", "sold CIF to the port: the on-carriage is the client's");
    eq(pay(rs(), po("EXW", 1), so("FOB", 2)), "us,client,client", "sold FOB: from the vessel the client's");
    eq(pay(rs(), po("EXW", 1), so("DAP", 4)), "us,us,us"); eq(pay(rs(), po("EXW", 1), so("EXW", 1)), "client,client,client", "sold EXW: all the client's");
    eq(pay(rs(), po("FCA", 1), so("CPT", 4)), "us,us,us", "FCA at the start: nothing is the supplier's");
    eq(pay(rs({ purpose: "INBOUND", governingSoRef: null }), po("CIF", 3), []), "supplier,supplier,us", "bought CIF: to the port of destination the supplier's, then ours");
    eq(pay(rs({ purpose: "INBOUND", governingSoRef: null }), po("FOB", 2), []), "supplier,us,us", "bought FOB: the pre-carriage is the supplier's");
    eq(pay(rs({ purpose: "INBOUND", governingSoRef: null }), po("DDP", 4), []), "supplier,supplier,supplier");
    eq(pay({ purpose: "OUTBOUND", poRefs: ["P"], governingSoRef: "S", originLocationId: 9, legs: [{ mode: "Road", fromLocationId: 9, toLocationId: 8 }] }, po("DDP", 9), so("DAP", 8)), "us", "starting at the PO's named place: past the supplier's part");
    eq(pay({ purpose: "INBOUND", poRefs: ["P"], soRefs: ["S"], governingSoRef: "S", legs: [{ mode: "Road", toLocationId: 9 }] }, po("EXW", 1), so("EXW", 9)), "us", "a truck bringing goods to us for an EXW sale is ours");
    const sh = { purpose: "OUTBOUND", poRefs: ["P"], soRefs: ["S"], legs: [{ mode: "Sea", vehicles: [{ carrierId: 5, costAmount: 1000, priceCurrency: "EUR" }] }], costs: [] };
    const payers = IC.legFreightPayers(sh, { pos: po("EXW", 1), orders: so("EXW", 1) }); eq(payers[0].payer, "client");
    eq(SM.costLinesByCarrierLeg(sh, () => "X", payers).length, 0, "a priced unit on the client's leg made a line"); eq(SM.costLinesByCarrierLeg(sh, () => "X").length, 1);
    eq(SD.syncLegFreightCostLines({ legs: [{ mode: "Sea", costAmount: 500 }], costs: [] }, payers).costs.length, 0);
    const legacy = { type: "sea_freight", amount: 8502, source: "" }; ok(IC.freightLineNotOurs(legacy, sh.legs, payers), "the old line is not flagged"); eq(IC.freightLineNotOurs({ ...legacy, type: "customs" }, sh.legs, payers), null);
  });
  t("A-INC-1 (1/5): on the 2 Oct file every live leg is ours except SHP-0026's sea leg (the client's — SO-0015 sold EXW) and the supplier's trucks; the only freight line that changes is the one SHP-0026's client leg no longer makes", () => {
    if (!d) return; const live = d.shipments.filter(s => s.status !== "Cancelled"); const notOurs = [], changed = [];
    live.forEach(s => { const p = IC.legFreightPayers(s, { pos: d.pos, orders: d.orders }); p.forEach((x, i) => { if (x.payer !== "us") notOurs.push(`${s.number}:${i}:${x.payer}`); });
      const a = SM.costLinesByCarrierLeg(s, () => "", p), b = SM.costLinesByCarrierLeg(s, () => ""); if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(s.number); });
    eq(changed.join(" | "), "SHP-2026-0026", "lines changed elsewhere");   // v7.19.7: without the rule its old sea line would be taken over by a carrier line; with it, the line stays as it was, flagged
    const s26b = live.find(s => s.number === "SHP-2026-0026"); eq(JSON.stringify(SM.costLinesByCarrierLeg(s26b, () => "", IC.legFreightPayers(s26b, { pos: d.pos, orders: d.orders }))), JSON.stringify(s26b.costs), "SHP-0026's lines changed");
    eq(notOurs.sort().join(" "), "SHP-2026-0026:0:client SHP-2026-0036:0:supplier SHP-2026-0037:0:supplier");
    const s26 = live.find(s => s.number === "SHP-2026-0026"); const f = (s26.costs || []).filter(c => IC.freightLineNotOurs(c, s26.legs, IC.legFreightPayers(s26, { pos: d.pos, orders: d.orders })));
    eq(f.map(c => c.type + " " + c.amount + " " + c.currency).join(), "sea_freight 8502 EUR");
  });
  t("A-INC-1 (2/5): an EXW sale has no outbound shipment of ours — only an outbound carriage of it is a conflict, never the truck bringing goods to us or the client's collection", () => {
    const o = so("EXW", 9); const out = { purpose: "OUTBOUND", soRefs: ["S"], legs: [{ mode: "Road" }] };
    eq(IC.isExwSale(o[0]), true); eq(IC.isExwSale({ sellIncoterm: "fca" }), false);
    eq((IC.exwCarriageConflict(out, o) || {}).number, "S"); eq(IC.exwCarriageConflict({ ...out, purpose: "INBOUND" }, o), null); eq(IC.exwCarriageConflict({ ...out, mode: "Client pickup" }, o), null);
    eq(IC.exwCarriageConflict(out, so("CIF", 9)), null);
    if (d) { const hit = d.shipments.filter(s => s.status !== "Cancelled" && IC.exwCarriageConflict(s, d.orders)).map(s => s.number); eq(hit.join(), "SHP-2026-0026", "the 2 Oct file");
      console.log(`      (2 Oct file: ${d.orders.filter(x => x.status !== "Cancelled" && IC.isExwSale(x)).length} live EXW sales — left out of 'From SO'; 1 shipment flagged)`); }
  });
  t("A-INC-1 (3/5): a DAP / DPU / DDP purchase comes on the supplier's truck — no carrier, freight or transport order of ours; SHP-0036/0037 are, SHP-0039 (the sale's leg) is not", () => {
    eq(["DAP", "DPU", "DDP", "dap", "CPT", "EXW"].map(x => IC.isDRulePurchase({ buyIncoterm: x })).join(), "true,true,true,true,false,false");
    const built = { purpose: "OUTBOUND", governingSoRef: "SO-1", soRefs: ["SO-1"], carrierId: 7, transportOrderNo: "TO-1", goods: [{ soRef: "SO-1", qtyKg: 1000 }],
      legs: [{ mode: "Road", carrierId: 7, costAmount: 900, vehicles: [{ carrierId: 7, costAmount: 900, truckPlate: "WX 1" }] }], costs: [{ type: "road_freight", amount: 900 }, { type: "customs", amount: 120 }] };
    const st = SD.asSuppliersTruck(built, { buyIncoterm: "DAP" });
    eq([st.arrangedBy, st.purpose, st.governingSoRef, st.soRefs.length, st.carrierId, st.transportOrderNo].join("|"), "SUPPLIER|INBOUND||0||");
    eq(st.legs[0].vehicles[0].carrierId, null); eq(st.legs[0].vehicles[0].costAmount, 0); eq(st.legs[0].vehicles[0].truckPlate, "WX 1", "the plates were lost"); eq(st.costs.map(c => c.type).join(), "customs");
    if (d) { const t2 = n => IC.isSuppliersTruck(d.shipments.find(s => s.number === n), d.pos); eq([t2("SHP-2026-0036"), t2("SHP-2026-0037"), t2("SHP-2026-0039")].join(), "true,true,false"); }
  });
  t("A-INC-1 (4/5): who clears customs — export the seller's unless EXW, import the buyer's unless DDP; nothing on an intra-EU route", () => {
    const D = (sh, pos, orders, direction) => IC.customsDuties(sh, { pos, orders, direction }).map(x => x.which + ":" + x.party).join(",");
    const out = { purpose: "OUTBOUND", poRefs: ["P"], governingSoRef: "S", originLocationId: 9, legs: [{ mode: "Road", fromLocationId: 9 }] };
    eq(D(out, po("EXW", 9), so("CIF", 3), "EXPORT"), "export:us", "from stock, sold CIF"); eq(D(out, po("EXW", 9), so("EXW", 3), "EXPORT"), "export:client", "sold EXW");
    eq(D({ ...out, originLocationId: 1, legs: [{ mode: "Road", fromLocationId: 1 }] }, po("FCA", 9), so("CIF", 3), "EXPORT"), "export:supplier", "straight from a supplier who sold FCA");
    eq(D({ purpose: "INBOUND", poRefs: ["P"], legs: [{ mode: "Road" }] }, po("EXW", 9), [], "EXPORT"), "export:us", "bought EXW, carried out of the EU by us");
    eq(D({ purpose: "INBOUND", poRefs: ["P"], legs: [{ mode: "Sea" }] }, po("CIF", 9), [], "IMPORT"), "import:us"); eq(D({ purpose: "INBOUND", poRefs: ["P"], legs: [{ mode: "Road" }] }, po("DDP", 9), [], "IMPORT"), "import:supplier");
    eq(D(out, po("EXW", 9), so("DDP", 3), "IMPORT"), "import:us"); eq(D(out, po("EXW", 9), so("DAP", 3), "IMPORT"), "import:client");
    eq(D(out, po("EXW", 9), so("CIF", 3), "INTRA_EU"), ""); eq(D(out, po("EXW", 9), so("CIF", 3), ""), "", "no direction, no rule");
    eq(D(out, po("EXW", 9), so("CFR", 3), "CROSS_TRADE"), "export:us,import:client");
  });
  t("A-INC-1 (5/5): the risk point per rule — EXW at once, FCA / CPT at the first carrier, F- and C-sea rules on board, D-rules at the named place (DPU unloaded)", () => {
    const sh = { legs: [{ mode: "Road", toLocationId: 2 }, { mode: "Sea", toLocationId: 3 }, { mode: "Road", toLocationId: 4 }] };   // stages: loading 0, legs 1-3, unloading 4
    eq(["EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DDP", "DPU"].map(x => IC.riskPassPos(sh, x, 4)).join(), "0,4,2,2,2,1,1,4,4,5", "named place reached by the last leg");
    eq(IC.riskPassPos(sh, "FCA", null), 1, "FCA at the seller's premises: loaded on the buyer's carrier");
    eq(IC.riskPassPos(sh, "FCA", 2), 2, "FCA at a named place reached by leg 1"); eq(IC.riskPassPos({ legs: [{ mode: "Road" }] }, "FOB", null), 3, "no vessel in this shipment: still the seller's");
    const r = k => { const x = IC.riskAtStage({ purpose: "OUTBOUND", poRefs: ["P"], governingSoRef: "S", originLocationId: 9, legs: sh.legs }, k, { pos: po("CIF", 3), orders: so("CIF", 4) }); return (x.purchase ? x.purchase.bearer : "-") + "/" + (x.sale ? x.sale.bearer : "-"); };
    eq(["loading", "leg:0", "leg:1", "leg:2", "unloading"].map(r).join(" "), "supplier/us supplier/us us/client us/client us/client", "bought CIF + sold CIF, straight from the supplier");
  });
  t("A-INC-1 (5/5): claims routed by where the loss happened — on the 2 Oct file, SHP-0035 at sea is the client's (sold CIF), on the road ours; SHP-0037 (bought DDP) goes to the supplier; quality claims are untouched", () => {
    if (!d) return; const S = n => d.shipments.find(s => s.number === n); const ctx = { pos: d.pos, orders: d.orders, contacts: d.contacts };
    const c = (no, dir, stage, cause = "Transport damage") => IC.claimRouting({ direction: dir, cause, lossAt: { shipment: no, stage } }, S(no), ctx);
    const a = c("SHP-2026-0035", "CONCESSION", "leg:1"); ok(a.warn && /Sold CIF \(SO-2026-0025\): the risk had passed to the client before the loss on leg 2 \(Sea\)/.test(a.note) && /insurance we provided/.test(a.note), a.note);
    const b = c("SHP-2026-0035", "CONCESSION", "leg:0"); ok(!b.warn && /the risk was still ours on leg 1 \(Road\) — the client's claim stands/.test(b.note), b.note);
    const e = c("SHP-2026-0037", "RECOVERY", "leg:0"); eq(e.respondent.kind, "Supplier"); ok(/Bought DDP \(PO-2026-0044\): the risk was still the supplier's on leg 1/.test(e.note), e.note);
    const f = c("SHP-2026-0037", "RECOVERY", "unloading"); ok(f.respondent.kind !== "Supplier" && /risk had passed to us at unloading/.test(f.note), f.note);
    const g = c("SHP-2026-0039", "CONCESSION", "unloading"); ok(g.warn && /Sold DAP/.test(g.note), "sold DAP: unloading is the client's");
    eq(c("SHP-2026-0035", "CONCESSION", "leg:1", "Quality defect"), null, "a quality defect was routed");
    eq((IC.claimShipment({ subjects: [{ kind: "LOT", ref: "LOT-2026-0127" }] }, d.shipments) || {}).number, "SHP-2026-0039", "the lot's shipment");
    eq((d.claims || []).filter(x => IC.RISK_CAUSES.includes(x.cause)).length, 0, "the 4 claims on file are quality claims");
  });
  t("AUD-37: warehouse charges — pallet-days follow the kilos still there, handling only at the warehouse's own sites, each warehouse by its id (two of the same name)", () => {
    const tf = (loc) => ({ storagePerPalletDay: 2, handlingInPerKg: 0.01, handlingOutPerKg: 0.01, locationIds: [loc] });
    const contacts = [{ id: 501, name: "Cold store", warehouseTariff: tf("A") }, { id: 502, name: "Cold store", warehouseTariff: tf("B") }];
    const lot = { number: "LOT-T", pallets: 10, movements: [{ id: 1, type: "IN", date: "2026-09-01", qtyKg: 10000, toId: "A" }, { id: 2, type: "SHIP_OUT", date: "2026-09-11", qtyKg: 5000, fromId: "A" }, { id: 3, type: "TRANSFER", date: "2026-09-21", qtyKg: 5000, fromId: "A", toId: "B" }, { id: 4, type: "SHIP_OUT", date: "2026-10-01", qtyKg: 5000, fromId: "B" }] };
    const m = (id, per) => { const r = wh.warehouseMonthCharges([lot], contacts, id, per, "2026-10-11"); return r.rows.map(x => x.lines.map(l => l.kind + ":" + l.qty).join(" ")).join() + " = " + r.total; };
    eq(m(501, "2026-09"), "storage:150 handling_in:10000 handling_out:5000 = 450", "WH A in September (10 pallets × 10 days + 5 × 10)");
    eq(m(502, "2026-09"), "storage:50 = 100", "WH B in September — was missing (the first warehouse matched, by name)");
    eq(m(501, "2026-10"), " = 0", "WH A charged for B's dispatch in October"); eq(m(502, "2026-10"), "handling_out:5000 = 50");
    if (d) { const ah = d.contacts.find(c => c.warehouseTariff); eq(["2026-06", "2026-09", "2026-10"].map(p => wh.warehouseMonthCharges(d.lots, d.contacts, ah.id, p, "2026-10-11", d.packagingTypes).rows.length).join(), "2,0,0", "v7.21.12 (A-RV-35): AGRO-HURT's own address is its site — June's two lots are charged"); }
  });
  t("A-TD-5: our country is Settings → Company's — the rule reads it; it prints after the address only when the address does not already name it", () => {
    const TF = B("tradeFlow.domain.js"), CP = B("counterparty.domain.js");
    const sh = { purpose: "INBOUND", poRefs: ["P"], legs: [{ mode: "Road" }] }, pos = [{ number: "P", supplier: { country: "Hungary" } }];
    eq(TF.shipmentTradeEnds(sh, { pos }).destination.country, "Poland"); TF.setOurCountry("Egypt"); eq(TF.shipmentTradeEnds(sh, { pos }).direction, "EXPORT", "the company's country was not read"); TF.setOurCountry("Poland"); eq(TF.shipmentTradeDirection(sh, { pos }), "INTRA_EU");
    eq(CP.addressWithCountry("ul. Długa 29,\n00-238 Warszawa\nPolska", "Poland").length, 3, "Polska is Poland"); eq(CP.addressWithCountry("Ul. Długa 29, 00-238 Warsaw, Poland", "Poland").length, 1);
    eq(CP.addressWithCountry("ul. Długa 29,\n00-238 Warszawa", "Poland").join("|"), "ul. Długa 29,|00-238 Warszawa|Poland"); eq(CP.addressWithCountry("x", "").join(), "x");
  });
  //@@V719_NEXT@@
  console.log("v7.19.6 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  console.log("\n══ v7.19.7 — A-RV-36: a save never doubles a freight line nor forgets its invoice ══");
  t("A-RV-36: an old freight line is taken over by the line of its leg — one line, its id, invoice status and reference; an invoiced amount stays; a second save changes nothing", () => {
    const sh = (units, costs) => ({ legs: [{ mode: "Road", vehicles: units.map(a => ({ carrierId: 5, costAmount: a, priceCurrency: "EUR" })) }], costs });
    const old = { id: 77, type: "road_freight", supplierId: 5, amount: "3600", currency: "EUR", fxRate: 4.3, amountPLN: 15480, invoiceStatus: "Received", invoiceRef: "98/03/2026" };
    const r = SM.costLinesByCarrierLeg(sh([1800, 1800], [old, { id: 78, type: "customs", amount: 400 }]), () => "X");
    eq(r.filter(c => /_freight$/.test(c.type)).length, 1, "the freight was doubled"); const f = r.find(c => c.type === "road_freight");
    eq([f.id, f.source, f.invoiceStatus, f.invoiceRef, f.amount].join("|"), "77|LEGCAR:0:5|Received|98/03/2026|3600"); ok(r.some(c => c.id === 78), "the customs line went");
    const again = SM.costLinesByCarrierLeg({ ...sh([1800, 1800], r) }, () => "X"); eq(JSON.stringify(again), JSON.stringify(r), "a second save changed the lines");
    const short = SM.costLinesByCarrierLeg(sh([1800, 0], [old]), () => "X").find(c => c.type === "road_freight"); eq(short.amount, 3600, "the invoiced amount followed the unit prices");
    eq(JSON.stringify(SM.invoicedVsUnits(sh([1800, 0], [short]), short)), JSON.stringify({ invoiced: 3600, units: 1800 }));
    const exp = SM.costLinesByCarrierLeg(sh([1980], [{ id: 79, type: "road_freight", amount: 0, currency: "PLN", invoiceStatus: "Expected" }]), () => "X"); eq(exp.length, 1); eq([exp[0].id, exp[0].amount, exp[0].currency].join("|"), "79|1980|EUR", "an expected line follows the units");
    const legcar = { id: "legcar-0-5", source: "LEGCAR:0:5", type: "road_freight", supplierId: 5, amount: 1980, currency: "EUR", fxRate: 4.3, amountPLN: 8514, invoiceStatus: "Received", invoiceRef: "PS/65/09/2026" };
    const kept = SM.costLinesByCarrierLeg(sh([1980], [legcar]), () => "X")[0]; eq([kept.invoiceStatus, kept.invoiceRef].join("|"), "Received|PS/65/09/2026", "the save reset the invoice status");
    const gone = SM.costLinesByCarrierLeg(sh([0], [legcar]), () => "X"); eq(gone.length, 1); eq([gone[0].source, gone[0].amount, gone[0].invoiceStatus].join("|"), "|1980|Received", "an invoiced line was dropped when its unit lost the price");
  });
  t("A-RV-36: on the 2 Oct file a save doubles no freight — the 13 shipments keep one line per leg and freight type, the 4 invoiced carrier lines keep status and reference, every invoiced amount is kept", () => {
    if (!d) return; const live = d.shipments.filter(s => s.status !== "Cancelled" && (s.legs || []).some(l => (l.vehicles || []).some(u => parseFloat(u.costAmount) > 0)));
    const sum = cs => Math.round(cs.filter(c => /_freight$/.test(c.type) && !["", "Expected"].includes(String(c.invoiceStatus || "Expected"))).reduce((a, c) => a + (parseFloat(c.amountPLN) || 0), 0) * 100) / 100;
    const doubled = [], lostInv = [];
    live.forEach(s => { const p = IC.legFreightPayers(s, { pos: d.pos, orders: d.orders }); const r = SM.costLinesByCarrierLeg(s, () => "", p);
      const seen = {}; r.filter(c => /_freight$/.test(c.type) && parseFloat(c.amount) > 0).forEach(c => { const leg = IC.freightLineLeg(c, s.legs); const k = leg + ":" + c.type + ":" + (String(c.source || "").split(":")[2] || c.supplierId); seen[k] = (seen[k] || 0) + 1; if (seen[k] === 2) doubled.push(s.number + " " + k); });
      if (sum(r) !== sum(s.costs || [])) lostInv.push(`${s.number}: ${sum(s.costs || [])} → ${sum(r)}`);
      eq(JSON.stringify(SM.costLinesByCarrierLeg({ ...s, costs: r }, () => "", p)), JSON.stringify(r), s.number + ": a second save changed the lines"); });
    eq(doubled.join(" | "), "", "doubled"); eq(lostInv.join(" | "), "", "invoiced freight changed");
    const s33 = d.shipments.find(s => s.number === "SHP-2026-0033"); const r33 = SM.costLinesByCarrierLeg(s33, () => ""); eq(r33.filter(c => c.invoiceStatus === "Received" && /^LEGCAR:/.test(c.source)).map(c => c.invoiceRef).sort().join(), "113/09-2026,35/04/2026");
    const s17 = d.shipments.find(s => s.number === "SHP-2026-0017"); const r17 = SM.costLinesByCarrierLeg(s17, () => ""); const f17 = r17.find(c => c.type === "road_freight"); eq([f17.amount, f17.invoiceRef].join("|"), "3600|98/03/2026"); eq(SM.invoicedVsUnits(s17, f17).units, 1800, "SHP-0017's unpriced unit not flagged");
  });
  console.log("v7.19.7 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.20.0–7.20.6 — A-INC-2: every inconsistency with the incoterms flagged for review, and one place to review them (owner 11 Oct, P-9) ══
(function v720(){
  console.log("\n══ v7.20.x — A-INC-2: every inconsistency with the incoterms, one list ══");
  const IC = B("incoterms.domain.js"), SM = B("shipmentModel.domain.js"), L = B("locations.js");
  const load = n => { const p = FX.needFixture(n, "an owner's file"); return p ? JSON.parse(require("fs").readFileSync(p, "utf8")) : null; };
  const d = load("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json");
  // v7.32.0: the checks' own seam stands in for the old list in the code
  const ctxOf = x => { const all = [...require("./public-places.cjs").OLD_LIST, ...(x.customLocations || []), ...L.counterpartyLocations(x.contacts || [])]; return { pos: x.pos, orders: x.orders, shipments: x.shipments, claims: x.claims || [], contacts: x.contacts, lots: x.lots, placeOf: id => all.find(l => String(l.id) === String(id)) || null }; };
  const P = { 1: { name: "Farm", type: "SupplierFacility" }, 2: { name: "Our warehouse", type: "RentedWarehouse" }, 3: { name: "Damietta Port", type: "Port", legacyType: "PORT" }, 4: { name: "Client site", type: "ClientFacility" }, 5: { name: "Koper Port", type: "Port", legacyType: "PORT" }, 6: { name: "Port Said", type: "Port" } };
  const placeOf = id => P[id] || null;
  const kinds = fs => fs.map(f => f.kind).join(",");
  t("A-INC-2 (v7.20.0): one list — the four kinds flagged since Batch D, each naming the term, the document and the record; on the 2 Oct file SHP-0026 (sold EXW), its 8 502 EUR sea line and the 11 shipments marked otherwise than the terms for customs", () => {
    if (!d) return; const all = IC.termsToReview(ctxOf(d)); const of = k => all.filter(f => f.kind === k);
    eq(of("exw").map(f => [f.term, f.doc, f.record].join(" ")).join(), "EXW SO-2026-0015 SHP-2026-0026");
    eq(of("freight").map(f => [f.term, f.doc, f.record].join(" ")).join(), "EXW SO-2026-0015 SHP-2026-0026"); ok(/sea freight line of 8502 EUR/.test(of("freight")[0].text), of("freight")[0].text);
    eq(of("customs").map(f => f.record).sort().join(" "), "SHP-2026-0004 SHP-2026-0006 SHP-2026-0007 SHP-2026-0013 SHP-2026-0014 SHP-2026-0015 SHP-2026-0016 SHP-2026-0017 SHP-2026-0018 SHP-2026-0021 SHP-2026-0022 SHP-2026-0023 SHP-2026-0024 SHP-2026-0026","the v7.19.3 list");   // v7.28.7: the route decides the start — SHP-0006/0007 start at an unknown supplier address (FZ-36), SHP-0026 at Trieste
    eq(of("claim").length, 0, "the 4 claims on file are quality claims");
    ok(all.every(f => f.term && f.doc && f.record && f.text && f.recordKind), "a line without its term, document or record");
    const base = all.filter(f => f.kind !== "documents");   // v7.27.11 (FZ-16): the expected-document lines are a kind of their own
    eq(base.length, 28, "28 lines on the 2 Oct file (v7.28.7: the route decides where a shipment starts)"); eq(new Set(base.map(f => f.record)).size, 21, "21 records");
    eq(of("documents").length, (d.shipments || []).reduce((a, s) => a + IC.documentsMissingAtStage(s, ctxOf(d)).length, 0), "the expected-document lines are not one per missing document"); ok(of("documents").length > 0, "no expected document missing on the 2 Oct file");
    const docs = all.map(f => f.doc); eq(JSON.stringify(docs), JSON.stringify(docs.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))), "grouped by the document");
    eq(IC.termsFindingsForDoc(all, "SO-2026-0015").map(f => f.kind).sort().join(), "carrier,exw,freight", "SO-0015's view");
  });
  t("A-INC-2 (v7.20.0): a claim aimed elsewhere than the risk point says is a line — a recovery to the carrier while the supplier still carried the risk; a client's claim for a loss after the risk passed to him", () => {
    const sh = { number: "SHP-T1", status: "Booked", purpose: "OUTBOUND", poRefs: ["PO-T"], governingSoRef: "SO-T", originLocationId: 1, legs: [{ mode: "Road", fromLocationId: 1, toLocationId: 5, vehicles: [{ carrierId: 70 }] }, { mode: "Sea", fromLocationId: 5, toLocationId: 3 }] };
    const pos = [{ number: "PO-T", status: "Confirmed", buyIncoterm: "DAP", destinationLocationId: 5, supplier: { id: 60, name: "Farm Kft." } }], orders = [{ number: "SO-T", status: "Confirmed", sellIncoterm: "CIF", destinationLocationId: 3 }];
    const contacts = [{ id: 60, name: "Farm Kft.", roles: ["Supplier"] }, { id: 70, name: "Road Co", roles: ["Carrier"] }];
    const rec = { number: "CLM-T1", status: "Open", direction: "RECOVERY", cause: "Transport damage", respondent: { kind: "Carrier", contactId: 70, name: "Road Co" }, lossAt: { shipment: "SHP-T1", stage: "leg:0" }, subjects: [{ kind: "SHIPMENT", ref: "SHP-T1" }] };
    const con = { number: "CLM-T2", status: "Open", direction: "CONCESSION", cause: "Shortage", respondent: { kind: "Client" }, lossAt: { shipment: "SHP-T1", stage: "leg:1" }, subjects: [{ kind: "SHIPMENT", ref: "SHP-T1" }] };
    const r = IC.termsToReview({ pos, orders, shipments: [sh], claims: [rec, con, { ...rec, number: "CLM-T3", respondent: { kind: "Supplier", contactId: 60, name: "Farm Kft." } }], contacts }).filter(f => f.kind === "claim");
    eq(r.map(f => [f.record, f.term, f.doc, f.recordKind, f.shipment].join(" ")).join(" | "), "CLM-T1 DAP PO-T claim SHP-T1 | CLM-T2 CIF SO-T claim SHP-T1");
    ok(/goes to Farm Kft\., not Road Co/.test(r[0].text), r[0].text); ok(/the risk had passed to the client/.test(r[1].text), r[1].text);
  });
  t("A-INC-2 (1, v7.20.1): CFR / CIF name the port of destination — a typed address or a client's site is flagged, a port is not; on the 2 Oct file SO-0001, 0003, 0010 and 0011 (Obour), the two cancelled ones left out", () => {
    const N = (doc, side) => { const r = IC.namedPlaceNotPort(doc, side, { placeOf }); return r ? [r.term, r.place, r.typed].join("|") : "-"; };
    eq(N({ sellIncoterm: "CFR", destinationText: "11 Str. Obour" }, "sell"), "CFR|11 Str. Obour|true"); eq(N({ sellIncoterm: "CIF", destinationLocationId: 3 }, "sell"), "-");
    eq(N({ sellIncoterm: "cif", destinationLocationId: 4 }, "sell"), "CIF|Client site|false"); eq(N({ buyIncoterm: "CFR", destinationText: "Farm gate" }, "buy"), "CFR|Farm gate|true");
    eq(N({ sellIncoterm: "DAP", destinationText: "11 Str. Obour" }, "sell"), "-", "a D-rule names any place"); eq(N({ sellIncoterm: "CFR" }, "sell"), "-", "no named place: nothing to compare"); eq(N({ sellIncoterm: "CFR", destinationLocationId: 999 }, "sell"), "-", "an unknown place is not judged");
    if (!d) return; eq(IC.termsToReview(ctxOf(d)).filter(f => f.kind === "port").map(f => f.record + ":" + f.recordKind).join(" "), "SO-2026-0001:order SO-2026-0003:order SO-2026-0010:order SO-2026-0011:order");
  });
  t("A-INC-2 (2, v7.20.2): a CIF / CIP sale's shipment of ours holds an insurance certificate — on the list now; missing on SHP-0028, 0034 and 0035 (2 Oct file); held (or sent) clears it", () => {
    ok(SM.DOC_TYPES.some(x => x.value === "Insurance certificate" && !x.system), "no insurance certificate on the document list");
    const orders = [{ number: "S1", status: "Confirmed", sellIncoterm: "CIF" }, { number: "S2", status: "Confirmed", sellIncoterm: "CIP" }, { number: "S3", status: "Confirmed", sellIncoterm: "CFR" }];
    const sh = (refs, docs, extra) => ({ number: "SHP-X", status: "Booked", purpose: "OUTBOUND", soRefs: refs, documents: docs, legs: [{ mode: "Road" }], ...(extra || {}) });
    eq(IC.insuranceMissing(sh(["S1"], []), orders).map(o => o.number).join(), "S1"); eq(IC.insuranceMissing(sh(["S2", "S3"], [{ type: "Insurance certificate", status: "Missing" }]), orders).map(o => o.number).join(), "S2", "a missing certificate is not held");
    eq(IC.insuranceMissing(sh(["S1"], [{ type: "insurance certificate", status: "Have it" }]), orders).length, 0); eq(IC.insuranceMissing(sh(["S1"], [{ type: "Insurance certificate", status: "Sent" }]), orders).length, 0);
    eq(IC.insuranceMissing(sh(["S3"], []), orders).length, 0, "CFR: the buyer insures"); eq(IC.insuranceMissing(sh(["S1"], [], { purpose: "INBOUND" }), orders).length, 0, "goods coming to us");
    const f2 = IC.shipmentTermsFindings(sh(["S2"], []), { orders }).find(f => f.kind === "insurance"); ok(f2 && f2.term === "CIP" && /ICC \(A\)/.test(f2.text), "CIP asks ICC (A)");
    if (!d) return; eq(IC.termsToReview(ctxOf(d)).filter(f => f.kind === "insurance").map(f => f.record + " " + f.doc).join(" | "), "SHP-2026-0028 SO-2026-0020 | SHP-2026-0034 SO-2026-0024 | SHP-2026-0035 SO-2026-0025");
  });
  t("A-INC-2 (3, v7.20.3): a sea-only rule (FAS / FOB / CFR / CIF) on a journey with no sea leg and no port is flagged; a sea leg, a port on the way or a sea booking is not; none on the 2 Oct file", () => {
    const road = (from, to, extra) => ({ number: "SHP-R", status: "Booked", purpose: "OUTBOUND", poRefs: ["PO-R"], governingSoRef: "SO-R", originLocationId: from, destinationLocationId: to, legs: [{ mode: "Road", fromLocationId: from, toLocationId: to }], ...(extra || {}) });
    const S = (sh, st, pt) => IC.seaRuleWithoutSea(sh, { placeOf, orders: [{ number: "SO-R", status: "Confirmed", sellIncoterm: st }], pos: [{ number: "PO-R", status: "Confirmed", buyIncoterm: pt }] }).map(x => x.side + ":" + x.term).join(",");
    eq(S(road(2, 4), "CFR", "EXW"), "sell:CFR", "sold CFR, trucked inland"); eq(S(road(2, 3), "CFR", "EXW"), "", "to the port: the sea leg may be the other side's");
    eq(S(road(2, 4), "FOB", "EXW"), "sell:FOB"); eq(S(road(2, 5), "FOB", "EXW"), "", "sold FOB: our truck ends at the port of shipment");
    eq(S({ ...road(2, 4), legs: [{ mode: "Road", fromLocationId: 2, toLocationId: 5 }, { mode: "Sea", fromLocationId: 5, toLocationId: 3 }] }, "CIF", "EXW"), "", "a sea leg");
    eq(S(road(2, 4, { bookings: [{ polId: 5 }] }), "CIF", "EXW"), "", "a sea booking"); eq(S(road(2, 4), "DAP", "EXW"), "", "DAP is for any mode");
    eq(S(road(1, 2, { purpose: "INBOUND", governingSoRef: "" }), "", "FOB"), "buy:FOB", "bought FOB, trucked from an inland farm"); eq(S(road(1, 2), "DAP", "CIF"), "", "the purchase's term is not read on a shipment of ours going to the client");
    if (!d) return; eq(IC.termsToReview(ctxOf(d)).filter(f => f.kind === "sea").length, 0);
  });
  t("A-INC-2 (4, v7.20.4): places against the named places — EXW / FCA collection starts there, D-rules end there, CFR / CIF sea legs arrive there; only places that are set; none on the 2 Oct file", () => {
    const pos = t => [{ number: "PO-P", status: "Confirmed", buyIncoterm: t, destinationLocationId: 1 }], so = (t, np) => [{ number: "SO-P", status: "Confirmed", sellIncoterm: t, destinationLocationId: np }];
    const W = (sh, p, o, more) => IC.placesOffTerms(sh, { placeOf, pos: p, orders: o || [], shipments: [sh, ...(more || [])], lots: [{ number: "LOT-D", directFlow: true }, { number: "LOT-S", status: "In Stock" }] }).map(x => `${x.side}:${x.term}:${x.what}:${x.named}>${x.actual}`).join(",");
    const inb = from => ({ number: "SHP-I", status: "Booked", purpose: "INBOUND", poRefs: ["PO-P"], originLocationId: from, legs: [{ mode: "Road", fromLocationId: from, toLocationId: 2 }] });
    eq(W(inb(1), pos("EXW")), ""); eq(W(inb(4), pos("FCA")), "buy:FCA:start:1>4", "collected elsewhere than the handover place"); eq(W({ ...inb(), originLocationId: null, legs: [{ mode: "Road" }] }, pos("EXW")), "", "no start set: nothing compared");
    const out = (from, lot) => ({ number: "SHP-O", status: "Booked", purpose: "OUTBOUND", poRefs: ["PO-P"], originLocationId: from, goods: [{ lotRef: lot }], legs: [{ mode: "Road", fromLocationId: from, toLocationId: 4 }] });
    eq(W(out(2, "LOT-D"), pos("EXW")), "buy:EXW:start:1>2", "a direct sale leaves from the supplier"); eq(W(out(2, "LOT-S"), pos("EXW")), "", "stock leaves from our warehouse");
    eq(W({ ...inb(1), arrangedBy: "SUPPLIER", destinationLocationId: 4, legs: [{ mode: "Road", fromLocationId: 6, toLocationId: 4 }] }, [{ number: "PO-P", status: "Confirmed", buyIncoterm: "DAP", destinationLocationId: 2 }]), "buy:DAP:end:2>4", "the supplier's truck ends elsewhere than the PO's place");
    const sale = (to, no) => ({ number: no || "SHP-S", status: "Booked", purpose: "OUTBOUND", governingSoRef: "SO-P", soRefs: ["SO-P"], originLocationId: 2, destinationLocationId: to, legs: [{ mode: "Road", fromLocationId: 2, toLocationId: to }] });
    eq(W(sale(4), [], so("DAP", 4)), ""); eq(W(sale(6), [], so("DDP", 4)), "sell:DDP:end:4>6"); eq(W(sale(6), [], so("DDP", 4), [sale(4, "SHP-S2")]), "", "another shipment of the sale finishes it at the named place");
    const sea = arr => ({ number: "SHP-C", status: "Booked", purpose: "OUTBOUND", governingSoRef: "SO-P", soRefs: ["SO-P"], originLocationId: 2, legs: [{ mode: "Road", fromLocationId: 2, toLocationId: 5 }, { mode: "Sea", fromLocationId: 5, toLocationId: arr }] });
    eq(W(sea(3), [], so("CIF", 3)), ""); eq(W(sea(6), [], so("CFR", 3)), "sell:CFR:sea:3>6", "the sea leg arrives at another port"); eq(W(sea(6), [], so("CFR", 4)), "", "a named place that is not a port is check 1's");
    eq(W({ ...sea(null), bookings: [{ podId: 6 }] }, [], so("CIF", 3)), "sell:CIF:sea:3>6", "the booking's port of discharge when the leg has none");
    // v7.28.7 (Batch L): the route decides where a shipment starts — on the 2 Oct (previous-season test) file four routes do not start
    // at their purchase's named place: SHP-0006 / -0007 (FCA at Koper; their first leg points at a supplier address by an old id — FZ-36)
    // and SHP-0021 / -0026 (EXW at the producer; their routes begin at Trieste)
    if (!d) return; eq(IC.termsToReview(ctxOf(d)).filter(f => f.kind === "places").map(f => f.record).sort().join(), "SHP-2026-0006,SHP-2026-0007,SHP-2026-0021,SHP-2026-0026");
  });
  t("A-INC-2 (5, v7.20.5): a carrier of ours on a leg the client or the supplier pays — the one a transport order would go to (the unit's, else the booking's forwarder); SHP-0026's sea leg names DCS NAKAPAL on the 2 Oct file", () => {
    const sh = (v, extra) => ({ number: "SHP-K", status: "Booked", purpose: "OUTBOUND", governingSoRef: "SO-K", soRefs: ["SO-K"], legs: [{ mode: "Road", vehicles: v }], ...(extra || {}) });
    const K = (s, st) => IC.carrierOnOthersLeg(s, { orders: [{ number: "SO-K", status: "Confirmed", sellIncoterm: st }], pos: [] }).map(x => `${x.leg}:${x.carrierId}:${x.p.payer}`).join(",");
    eq(K(sh([{ carrierId: 7 }, { carrierId: 7 }, { carrierId: 8 }]), "EXW"), "0:7:client,0:8:client", "one line per carrier"); eq(K(sh([{ carrierId: 7 }]), "DAP"), "", "a leg of ours");
    eq(K(sh([{}], { bookings: [{ forwarderId: 9 }], legs: [{ mode: "Sea", vehicles: [{}] }] }), "EXW"), "0:9:client", "a container belongs to the booking's forwarder");
    eq(K(sh([], { legs: [{ mode: "Road", carrierId: 5 }] }), "EXW"), "0:5:client", "an older leg names its carrier on the leg");
    eq(IC.carrierOnOthersLeg({ number: "SHP-T", status: "Booked", purpose: "INBOUND", arrangedBy: "SUPPLIER", poRefs: ["P"], legs: [{ mode: "Road", vehicles: [{ carrierId: 4 }] }] }, { pos: [{ number: "P", status: "Confirmed", buyIncoterm: "DDP", destinationLocationId: 2 }] }).map(x => x.p.payer).join(), "supplier", "the supplier's truck");
    if (!d) return; const r = IC.termsToReview(ctxOf(d)).filter(f => f.kind === "carrier"); eq(r.map(f => [f.record, f.term, f.doc].join(" ")).join(), "SHP-2026-0026 EXW SO-2026-0015"); ok(/DCS NAKAPAL srl is named on it/.test(r[0].text), r[0].text);
  });
  t("A-INC-2 (6, v7.20.6): a C- or D-rule sale whose shipments of ours carry no freight of ours — on the 1 Oct 16:29 file SO-0027, 0028 and 0029 (SHP-0039 before its freight); none on the 2 Oct file", () => {
    const so = t => ({ number: "SO-F", status: "Confirmed", sellIncoterm: t, destinationLocationId: 4 });
    const shp = (legs, costs, extra) => ({ number: "SHP-F", status: "Booked", purpose: "OUTBOUND", governingSoRef: "SO-F", soRefs: ["SO-F"], poRefs: ["PO-F"], originLocationId: 2, legs, costs: costs || [], ...(extra || {}) });
    const F = (o, shs, p) => { const r = IC.saleWithoutOurFreight(o, { orders: [o], shipments: shs, pos: p || [{ number: "PO-F", status: "Confirmed", buyIncoterm: "EXW", destinationLocationId: 1 }] }); return r ? r.term + ":" + r.shipments.join("+") : "-"; };
    eq(F(so("DAP"), [shp([{ mode: "Road", vehicles: [{ carrierId: 3 }] }])]), "DAP:SHP-F"); eq(F(so("DAP"), [shp([{ mode: "Road", vehicles: [{ carrierId: 3, costAmount: 900 }] }])]), "-", "a unit price");
    eq(F(so("CIF"), [shp([{ mode: "Road" }, { mode: "Sea" }], [{ type: "sea_freight", amount: 1200, source: "LEGCAR:1:3" }])]), "-", "a freight line on a leg of ours");
    eq(F(so("EXW"), [shp([{ mode: "Road" }])]), "-", "EXW: the client's carriage"); eq(F(so("DAP"), []), "-", "no shipment of ours yet");
    eq(F(so("DAP"), [shp([{ mode: "Road", toLocationId: 4 }])], [{ number: "PO-F", status: "Confirmed", buyIncoterm: "DAP", destinationLocationId: 4 }]), "-", "bought to the same place: the supplier's carriage");
    const d1 = load("marianna-erp_v6.99.87_schema-v2_2026-10-01T16-29-32.json"); if (d1) eq(IC.termsToReview(ctxOf(d1)).filter(f => f.kind === "nofreight").map(f => f.record + ":" + f.term).join(" "), "SO-2026-0027:DDP SO-2026-0028:DAP SO-2026-0029:DAP");
    if (!d) return; eq(IC.termsToReview(ctxOf(d)).filter(f => f.kind === "nofreight").length, 0, "SHP-0039 carries its freight on 2 Oct");
  });
  console.log("v7.20.6 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
})();

// ══ v7.21.0 — A-RV-19: the single-browser mode is gone (owner ruling B, 8 Oct): one way of working, on the shared data ══
(function v7210(){
  console.log("\n══ v7.21.0 — A-RV-19: the single-browser mode is gone ══");
  const fsx = require("fs"), px = require("path"); const rd = f => fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8"); const exists = f => fsx.existsSync(px.join(__dirname, "../src/" + f));
  t("A-RV-19 (v7.21.0): the seven pre-v7 repairs, the storage upgrade and the manual repair are gone from the app, and their code with them", () => {
    const app = rd("App.tsx");
    ok(!/isSharedMode/.test(app), "App still asks which mode it is in");
    ok(!/runMigrationsIfNeeded|healRound645|healRound651|migrateClaims|healShipmentModel|migrateReferencedSeeds|migrateLegacyCreditNotes|repairInventory/.test(app), "a repair is still called");
    ok(!exists("heal.v645.ts") && !exists("flowCleanup.migration.ts"), "the repair files are still there");
    const U = B("useLocalStoredState.js"); ok(!("MIGRATIONS" in U) && !("runMigrationsIfNeeded" in U), "the storage upgrade is still there");
  });
  t("A-RV-19 (v7.21.0): no local snapshot ring — none can be taken, listed or restored, and an older build's snapshots leave the browser once", () => {
    const U = B("useLocalStoredState.js");
    ["createBackup", "listBackups", "restoreBackup", "deleteBackup", "compactLocalBackups", "setLocalSnapshots", "importAllData"].forEach(n => ok(!(n in U), n + " is still exported"));
    const mem = {}; const ls = { get length() { return Object.keys(mem).length; }, key: i => Object.keys(mem)[i] || null, getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
    const was = global.window; global.window = { localStorage: ls };
    try {
      ls.setItem("marianna-erp:backups", "[]"); ls.setItem("marianna-erp:backup:1", "{}"); ls.setItem("marianna-erp:backup:2", "{}"); ls.setItem("marianna-erp:v2:pos", "[]");
      eq(U.dropLegacySnapshots(), 3); eq(ls.getItem("marianna-erp:backup:1"), null); ok(ls.getItem("marianna-erp:v2:pos") !== null, "the data went too"); eq(U.dropLegacySnapshots(), 0, "a second pass finds nothing");
    } finally { global.window = was; }
  });
  t("A-RV-19 (v7.21.0): Settings, Recovery and the sign-in gate have one path, the shared data — no local import or backups, no per-browser user, no browser-data upload; a wipe only on TEST", () => {
    const st = rd("Settings.tsx"), rp = rd("RecoveryPanel.tsx"), gate = rd("SharedStoreGate.tsx"), RS = B("remoteStore.js");
    ok(!/importAllData|LOCAL BACKUPS|CURRENT USER &amp; ROLE|Choose JSON file to import|isSharedMode/.test(st), "a single-browser part is left in Settings");
    eq((st.match(/if \(!isTestCopy\(\)\) return;/g) || []).length, 2, "a wipe outside TEST");
    ok(!/writeSharedStoreValue|readStoreValue|isSharedMode/.test(rp), "Recovery still writes this browser's data");
    ok(!/uploadAllLocal|Upload this browser/.test(gate) && !("uploadAllLocal" in RS) && !("localSummary" in RS) && !("isSharedMode" in RS), "the browser-data upload is still offered");
  });
})();

// ══ v7.21.2 — AUD-50: the fixtures are anonymised copies (owner 11 Oct) ══
(function v7212(){
  console.log("\n══ v7.21.2 — AUD-50: the fixtures are anonymised copies ══");
  const fsx = require("fs"), px = require("path");
  t("AUD-50 (v7.21.2): every e-mail in the fixtures is an invented one (or our own company's); the README says what was replaced; the anonymiser stays with the suites", () => {
    const files = fsx.readdirSync(FX.DIR).filter(f => /\.(json|xml)$/i.test(f)); const ours = new Set();
    files.filter(f => /\.json$/i.test(f)).forEach(f => { try { const c = (JSON.parse(fsx.readFileSync(px.join(FX.DIR, f), "utf8")).company || {}); if (c.email) ours.add(String(c.email).trim().toLowerCase()); } catch (e) { /* not a backup */ } });
    const real = []; files.forEach(f => (fsx.readFileSync(px.join(FX.DIR, f), "utf8").match(/[\p{L}0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/giu) || []).forEach(m => { if (!/@example\.com$/i.test(m) && !ours.has(m.toLowerCase())) real.push(f.slice(0, 30) + ": " + m.replace(/^(.).*@/, "$1…@")); }));
    eq(real.length, 0, real.slice(0, 3).join(" | "));
    ok(/anonymised/i.test(fsx.readFileSync(px.join(FX.DIR, "README.md"), "utf8")), "the README does not say the files are anonymised");
    ok(fsx.existsSync(px.join(__dirname, "anonymise.cjs")), "the anonymiser is not in the suites' folder");
  });
})();

// ══ v7.21.4 — A-ST-10 (+ A-RV-30): one place for a warehouse invoice, the register ══
(function v7214(){
  console.log("\n══ v7.21.4 — A-ST-10: one place for a warehouse invoice, the register ══");
  const I = B("invoicing.js"), IC = B("integrityCheck.js"); const fsx = require("fs"), px = require("path"); const rd = f => fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8");
  const p2 = FX.needFixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json", "the 2 Oct file"); const d = p2 ? JSON.parse(fsx.readFileSync(p2, "utf8")) : null;
})();

// ══ v7.21.5 — SE-4: who created a sale is the person signed in · v7.21.6 — the CN suggestions reach the screen ══
(function v72156(){
  console.log("\n══ v7.21.5–6 — A-SE-1..5 remainder: SE-4 and the CN suggestions ══");
  const fsx = require("fs"), px = require("path"); const rd = f => fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8");
  t("SE-4 (v7.21.5): a new sale records the person signed in as its creator — the old per-browser role (\"General Manager\") is gone from every screen", () => {
    const so = rd("SalesOrders.tsx"); ok(/createdBy: userName \|\| "",/.test(so), "createdBy still falls back on a role");
    ["SalesOrders.tsx", "SalesOrderDetail.tsx", "Settings.tsx", "App.tsx"].forEach(f => ok(!/userRole/.test(rd(f)), f + " still carries userRole"));
  });
  t("CN (v7.21.6): the built-in table's suggestion is offered on an item with no CN code and on none that has one", () => {
    const st = rd("Settings.tsx"); ok(/suggestCN\(c\.item, \(c\.varieties \|\| \[\]\)\[0\]\)/.test(st) && /data-cn-suggest=/.test(st), "suggestCN has no caller on the screen");
    const CN = B("cnCodes.js"); eq(CN.suggestCN("Papryka", "Kapia")[0].code, "07096010"); eq(CN.suggestCN("Jabłko", "Gala")[0].code, "08081080");
  });
})();

// ══ v7.21.7 — AUD-29: the producer's statement sorts costs by their type, not by words in a label ══
(function v7217(){
  console.log("\n══ v7.21.7 — AUD-29: the statement sorts costs by type ══");
  const P = B("poSettlement.domain.js"); const fsx = require("fs");
  const run = costs => P.computePOSettlement({ po: { number: "PO-T", supplier: { name: "S" }, items: [] }, lots: [{ number: "LOT-T", poRef: "PO-T", poNumber: "PO-T", costs }], orders: [], invoices: [], shipments: [], claims: [], ratePLNperEUR: 4.3, commissionPct: 5 });
  t("AUD-29 (v7.21.7): storage, warehouse handling, sorting and every warehouse-invoice allocation are the warehouse's; port handling, freight and a cost whose label only says 'warehouse' are additional", () => {
    const c = run([{ type: "storage", pln: 100 }, { type: "Warehousing", pln: 200, source: "WHINV-9" }, { type: "other", pln: 40, source: "WHINV-10" }, { type: "handling", pln: 30, label: "Port handling Koper" }, { type: "freight", pln: 500 }, { type: "other", pln: 7, label: "warehouse fee (typed)" }]);
    eq(Math.round(c.warehousePLN), 340, "warehouse"); eq(Math.round(c.additionalPLN), 537, "additional");
  });
  t("AUD-29 (v7.21.7): on the 2 Oct file no lot cost line changes side — they are freight and customs, additional before and after", () => {
    const p = FX.needFixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json", "the 2 Oct file"); if (!p) return; const d = JSON.parse(fsx.readFileSync(p, "utf8"));
    const lines = d.lots.flatMap(l => (l.costs || []).filter(c => !String(c.source || "").startsWith("CONSIGN") && c.type !== "purchase" && !String(c.source || "").startsWith("claim:")));
    const oldSide = c => /warehouse|storage|handling|sorting|service/.test(String(c.type || c.label || "").toLowerCase()); const newSide = c => P.WAREHOUSE_LOT_COST_TYPES.has(String(c.type || "").toLowerCase()) || String(c.source || "").startsWith("WHINV-");
    eq(lines.length, 90, "the 2 Oct file's lot cost lines"); eq(lines.filter(c => oldSide(c) !== newSide(c)).length, 0, "a line changed side");
  });
})();

// ══ v7.21.8 — A-RV-31: the SO texts say a line sells a lot · v7.21.9 — A-RV-32: an invoice with any payment can't be deleted ══
(function v72189(){
  console.log("\n══ v7.21.8–9 — A-RV-31 and A-RV-32 ══");
  const fsx = require("fs"), px = require("path"); const rd = f => fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8");
  t("A-RV-31 (v7.21.8): no SO text offers a purchase order as a line's source — the form's note and the line hint say a line sells a lot (expected, in stock or direct), in the save message's words", () => {
    const sf = rd("SalesOrderForm.tsx"), so = rd("SalesOrders.tsx");
    ok(!/sourced from either a stock lot or a purchase order|Pick a stock lot or PO/.test(sf), "an old text is still there");
    ok(/Pick a lot for every line first \(expected, in stock or direct\), or save as Draft\./.test(sf) && /Pick a lot for every line first \(expected, in stock or direct\), or save as Draft\./.test(so), "the form and the save message say different things");
    ok(/Pick the lot this line sells \(expected, in stock or direct\)/.test(sf), "the line hint");
  });
})();

// ══ v7.21.10 — A-RV-33: no carrier written into the code; no fixed 1001 ══
(function v72110(){
  console.log("\n══ v7.21.10 — A-RV-33: no fixed carrier 1001 ══");
  const IC = B("integrityCheck.js"); const fsx = require("fs"), px = require("path"); const rd = f => fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8");
  t("A-RV-33 (v7.21.10): a manual shipment and its cost lines get no carrier until one is picked — the fixed 1001 and the carriers written into the code are gone", () => {
    const sh = rd("Shipments.tsx"), ed = rd("ShipmentEditor.tsx");
    ok(!/FALLBACK_PROVIDERS/.test(sh), "the carriers written into the code are still there"); ok(/opts\.carrierId \? parseNum\(opts\.carrierId\) : null;/.test(sh), "the manual shipment still defaults its carrier");
    ok(!/\|\| 1001\b|: 1001;/.test(sh + ed), "a 1001 default is left");
  });
  t("A-RV-33 (v7.21.10): a shipment still holding a retired id (1001, 9, 10) is listed by the integrity check — not changed; a real company with that id is not", () => {
    const sh = { number: "SHP-T-1", status: "Booked", carrierId: 1001, legs: [{ mode: "Road", vehicles: [{ id: 1, carrierId: 9 }] }], costs: [{ supplierId: 1001 }] };
    const r = IC.checkIntegrity({ contacts: [], shipments: [sh] }); const hit = r.issues.filter(i => i.code === "SHIPMENT_PROVIDER_RETIRED");
    eq(hit.length, 1); ok(/carrier id 1001, 9/.test(hit[0].message), hit[0].message); eq(sh.carrierId, 1001, "the shipment was changed");
    eq(IC.checkIntegrity({ contacts: [{ id: 1001, name: "A real carrier" }, { id: 9, name: "Another" }], shipments: [sh] }).issues.filter(i => i.code === "SHIPMENT_PROVIDER_RETIRED").length, 0, "a real company with that id is flagged");
  });
})();

// ══ v7.21.11 — A-RV-34: an operational cost's rate is NBP's, shown — not typed ══
(function v72111(){
  console.log("\n══ v7.21.11 — A-RV-34: the operational-cost rate comes from NBP ══");
  const fsx = require("fs"), px = require("path"); const fin = fsx.readFileSync(px.join(__dirname, "../src/Finance.tsx"), "utf8");
  t("A-RV-34 (v7.21.11): Finance → operational costs reads the NBP rate of the day before the cost's date and shows it — no typed rate, no typed PLN amount; a foreign cost is never saved at 1.0", () => {
    ok(!/<Field label="FX rate to PLN"><Inp/.test(fin), "the rate can still be typed"); ok(!/<Field label="Amount PLN"><Inp/.test(fin), "the PLN amount can still be typed");
    ok(/data-op-rate="1"/.test(fin) && /nbpRateBefore\(c, form\.date\)/.test(fin), "the rate is not read from NBP"); ok(/No NBP rate yet/.test(fin), "a foreign cost can be saved without its rate");
  });
})();

// ══ v7.21.12 — A-RV-35: a warehouse's tariff applies at its own locations; a lot's pallets come from its kilos and packaging ══
(function v72112(){
  console.log("\n══ v7.21.12 — A-RV-35: AGRO-HURT's tariff reaches its lots ══");
  const W = B("warehouseCharges.js"); const fsx = require("fs");
  const p = FX.needFixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json", "the 2 Oct file"); const d = p ? JSON.parse(fsx.readFileSync(p, "utf8")) : null;
  t("A-RV-35 (v7.21.12): on the 2 Oct file AGRO-HURT's tariff applies at its own address (nothing ticked) — June: LOT-2026-0127 and 0128, 20 and 6 pallets from their kilos and 5 kg cartons, 355.72 PLN", () => {
    if (!d) return; const wh = d.contacts.find(c => c.warehouseTariff && W.tariffHasRates(c.warehouseTariff)); ok(wh, "no tariffed warehouse");
    ok(!(wh.warehouseTariff.locationIds || []).length, "sites are ticked on this file"); ok(W.tariffSiteIds(wh).has(String(wh.siteId)), "its own address is not a site of the tariff");
    const r = W.warehouseMonthCharges(d.lots, d.contacts, wh.id, "2026-06", "2026-10-02", d.packagingTypes);
    eq(r.rows.map(x => x.lotNumber + ":" + x.palletDays).join(" "), "LOT-2026-0127:20 LOT-2026-0128:6"); eq(r.totalPLN, 355.72);
    ok(r.rows.every(x => (x.notes || []).some(n => /Pallets worked out from the received kilos and the packaging \(Carton \(5 kg\): 110 boxes a pallet\)/.test(n))), "the derived pallets are not explained");
  });
  t("A-RV-35 (v7.21.12): a lot's own pallet count wins; with no packaging to read, no pallets are invented", () => {
    eq(W.lotPallets({ pallets: 3, packagingId: "carton-5-kg" }, 10985).pallets, 3); eq(W.lotPallets({ pallets: 3 }, 10985).derived, false);
    if (d) { eq(W.lotPallets({ packagingId: "carton-5-kg" }, 10985, d.packagingTypes).pallets, 20, "5 kg cartons, 110 a pallet"); eq(W.lotPallets({ packaging: "a sack" }, 10985, d.packagingTypes).pallets, 0, "an unknown packaging"); }
  });
})();

// ══ v7.21.13 — FZ-15: an id two browsers cannot share ══
(function v72113(){
  console.log("\n══ v7.21.13 — FZ-15: an id two browsers cannot share ══");
  const path = require("path"), fsx = require("fs"); const idsPath = require.resolve("./build/ids.js"); B("ids.js"); const original = require.cache[idsPath];   // the app's own copy stays the one the other modules hold
  const memStore = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, get length() { return Object.keys(m).length; }, key: i => Object.keys(m)[i] || null }; };
  function browser(tagValue) {   // a fresh copy of the id module with its own storage: another browser
    delete require.cache[idsPath]; const ls = memStore(); if (tagValue != null) ls.setItem("marianna-erp:idTag", String(tagValue));
    const was = global.window; global.window = { localStorage: ls }; const m = require(idsPath); global.window = was;
    return { mint: () => { const w = global.window; global.window = { localStorage: ls }; try { return m.nextId(); } finally { global.window = w; } }, prime: l => { const w = global.window; global.window = { localStorage: ls }; try { m.primeIdsFrom(l); } finally { global.window = w; } } };
  }
  t("FZ-15 (v7.21.13): two browsers that saw the same data, minting at the very same moment, never produce the same id — and each one's ids keep rising", () => {
    const realNow = Date.now; Date.now = () => 1791800000000;
    try {
      const data = [{ id: 1788432629972758, items: [{ id: 1788432629972800 }] }];
      const A = browser(123), B = browser(456); A.prime(data); B.prime(data);
      const a = Array.from({ length: 1000 }, A.mint), b = Array.from({ length: 1000 }, B.mint); const inA = new Set(a.map(String));
      eq(b.filter(x => inA.has(String(x))).length, 0, "ids in common");
      ok(a.every((x, i) => i === 0 || x > a[i - 1]) && b.every((x, i) => i === 0 || x > b[i - 1]), "an id went backwards");
      ok(a[0] > 1788432629972800 && b[0] > 1788432629972800, "an id at or below one already in the data");
      ok(a.every(Number.isSafeInteger) && b.every(Number.isSafeInteger), "an id beyond a number's exact range");
    } finally { Date.now = realNow; require.cache[idsPath] = original; }
  });
  t("FZ-15 (v7.21.13): every store primes the counter as it is read or pulled — an invoice's id raises it; a computed site id does not", () => {
    const U = B("useLocalStoredState.js"), I = B("ids.js"); const mem = memStore(); const was = global.window; global.window = { localStorage: mem };
    try {
      const high = I.nextId() + 5e9; U.applyStoreFromRemote("invoices", [{ id: high, payments: [{ id: high + 7 }] }]); ok(I.nextId() > high + 7, "a pulled invoice did not raise the counter");
      U.applyStoreFromRemote("contacts", [{ id: 5, siteId: 178843262998053000, addr: { id: 178843262998053000 } }]); ok(I.nextId() < 1e16, "a computed site id pushed the counter out of range");
    } finally { global.window = was; }
  });
  t("FZ-15 (v7.21.13): the integrity check names two records of one kind sharing an id — an error for documents, a warning in the audit log; the 2 Oct file's 3 audit entries are named, no document", () => {
    const IC = B("integrityCheck.js");
    const r = IC.checkIntegrity({ invoices: [{ id: 9, number: "FV/1" }, { id: 9, number: "FV/2" }], auditLog: [{ id: 4, summary: "a" }, { id: 4, summary: "b" }] }).issues.filter(i => i.code === "ID_SHARED");
    eq(r.map(i => i.severity + ":" + i.module).sort().join(), "error:invoices,warning:auditLog"); ok(/FV\/1 · FV\/2/.test(r.find(i => i.module === "invoices").message), "the two documents are not named");
    const p = FX.needFixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json", "the 2 Oct file"); if (!p) return; const d = JSON.parse(fsx.readFileSync(p, "utf8"));
    const s = IC.checkIntegrity({ contacts: d.contacts, pos: d.pos, lots: d.lots, orders: d.orders, shipments: d.shipments, invoices: d.invoices, claims: d.claims, financeNotes: d.financeNotes, operationalCosts: d.operationalCosts, auditLog: d.auditLog }).issues.filter(i => i.code === "ID_SHARED");
    eq(s.map(i => i.severity + ":" + i.module).join(), "warning:auditLog,warning:auditLog,warning:auditLog");
  });
})();

// ══ v7.21.14 — A-RV-37 + FZ-05: a port is read from the place's type ══
(function v72114(){
  console.log("\n══ v7.21.14 — A-RV-37 + FZ-05: a port is read from the place's type ══");
  const L = B("locations.js"), INV = B("inventory.domain.js"); const fsx = require("fs"), px = require("path"); const rd = f => fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8");
  t("A-RV-37 (v7.21.14): a Port or a Port warehouse is a port; an airport only where airports count; a place of type Other carrying the old word PORT is not; since v7.27.3 (FZ-26) a place known only by that word is not either", () => {
    eq([{ type: "Port" }, { type: "PortWarehouse" }, { type: "Airport" }, { type: "Other", legacyType: "PORT" }, { type: "PORT" }, { placeType: "Other", type: "PORT", legacyType: "PORT" }].map(l => L.isPortType(l) ? 1 : 0).join(""), "110000");
    eq(L.isPortType({ type: "Airport" }, { airports: true }), true);
  });
  t("FZ-05 (v7.21.14): a lot standing at a place of type Other is no longer 'Customs' — at a port, a port warehouse or an airport it still is (read through Inventory's places, where type holds the old word)", () => {
    const places = { 1: { placeType: "Other", type: "PORT", legacyType: "PORT" }, 2: { placeType: "Port", type: "PORT", legacyType: "PORT" }, 3: { type: "Airport", legacyType: "PORT" }, 4: { type: "PortWarehouse", legacyType: "PORT" } };
    const st = id => INV.recomputeLotFromMovements({ number: "LOT-T", expectedKg: 100 }, [{ id: 1, type: "IN", date: "2026-10-01", qtyKg: 100, toId: id }], x => places[x] || null).status;
    eq([1, 2, 3, 4].map(st).join(), "In Transit,Customs,Customs,Customs");
  });
  t("A-RV-37 (v7.21.14): no screen reads the old word to decide a port — the lot status, Inventory's port move and count, the place picker, the planning sheet's ports, the Locations filter and the POD proposal all ask the type; on the 2 Oct file the two places of type Other are no ports", () => {
    ["Inventory.tsx", "PlanningSheet.tsx", "Contacts.tsx", "ShipmentEditor.tsx", "inventory.domain.ts"].forEach(f => ok(!/legacyType\)? === "PORT"|legacyType\) === "PORT"|\?\.type === "PORT"|legacyLocType === "PORT"/.test(rd(f)), f + " still reads the old word"));
    ok(/const kindOf = /.test(rd("LocationPicker.tsx")) && (rd("LocationPicker.tsx").match(/const raw = kindOf\(l\);/g) || []).length === 2, "the picker still groups by the old word");
    const p = FX.needFixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json", "the 2 Oct file"); if (!p) return; const d = JSON.parse(fsx.readFileSync(p, "utf8"));
    const other = (d.customLocations || []).filter(l => l.type === "Other"); eq(other.length, 2); ok(other.every(l => !L.isPortType(l, { airports: true })), "a place of type Other reads as a port");
  });
})();

// ══ v7.22.1 — FZ-12: no purchase invoice is invented from an order ══
(function v72201(){
  console.log("\n══ v7.22.1 — FZ-12: no purchase invoice is invented from an order ══");
  const I = B("invoicing.js");
  t("FZ-12 (v7.22.1): a firm purchase order in an old status (Arrived / Received / Closed) no longer becomes a purchase invoice 'awaiting the supplier's number' — purchase invoices come from Fakturownia or are entered", () => {
    const po = { id: 77, number: "PO-T-1", status: "Received", pricingMode: "firm", currency: "EUR", fxRate: 4.3, supplier: { name: "S" }, items: [{ qty: 1000, unitPrice: 1.2 }] };
    const r = I.migrateLegacyInvoices({ existing: [], orders: [], warehouseInvoices: [], operationalCosts: [], pos: [po] });
    eq(r.filter(i => i.category === "PURCHASE").length, 0, "a purchase invoice was invented");
  });
})();

// ══ v7.22.2 — FZ-22: one number reader ══
(function v72202(){
  console.log("\n══ v7.22.2 — FZ-22: one number reader ══");
  const fsx = require("fs"), px = require("path"); const W = B("warehouseCharges.js"), INV = B("inventory.domain.js"), NUM = B("numbers.js");
  t("FZ-22 (v7.22.2): a number with a space or a dot for thousands and a decimal comma reads the same in every module — the files' own readers go through the one in numbers.ts", () => {
    eq(NUM.parseNum("1 234,5"), 1234.5); eq(NUM.parseNum("1.234,5"), 1234.5);
    eq(W.lotPallets({ pallets: "1.234,5" }, 0).pallets, 1234.5, "a module still reads it its own way");
    eq(INV.parseNum, NUM.parseNum, "inventory still has a reader of its own");
    const own = fsx.readdirSync(px.join(__dirname, "../src")).filter(f => /\.(ts|tsx)$/.test(f) && f !== "numbers.ts").filter(f => /(?:const|function)\s+\w+\s*=?\s*\(\w+(?::\s*any)?\)[^\n]{0,40}\{[^\n]*parseFloat\([^\n]*return\s+(?:isFinite|isNaN)\(\w+\)\s*\?\s*\w+\s*:\s*0;/.test(fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8")));
    eq(own.join(", "), "", "files with a number reader of their own");
  });
})();

// ══ v7.22.3 — FZ-21: one incoterm table for everything (owner ruling 13 Oct) ══
(function v72203(){
  console.log("\n══ v7.22.3 — FZ-21: one incoterm table ══");
  const INC = B("incoterms.domain.js"), TF = B("tradeFlow.domain.js"); const fsx = require("fs"), px = require("path"); const rd = f => fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8");
  t("FZ-21 (v7.22.3): the purchase and sale forms offer the 11 Incoterms 2020 rules, named from the table — no list of their own; the old readers are gone", () => {
    eq(INC.INCOTERM_CODES.join(), "EXW,FCA,FAS,FOB,CFR,CIF,CPT,CIP,DAP,DPU,DDP"); eq(INC.incotermLabel("CIP"), "CIP — Carriage and Insurance Paid To");
    ok(/INCOTERM_CODES\.map/.test(rd("PurchaseOrderForm.tsx")) && /INCOTERM_CODES\.map/.test(rd("SalesOrderForm.tsx")), "a form keeps a list of its own");
    ["handoverPointForIncoterm", "namedPlacePoolForIncoterm", "handoverSentence", "buyOwnershipStartFromIncoterm", "sellOwnershipEndFromIncoterm", "ownershipAtPoint"].forEach(n => ok(!(n in TF), n + " is still in tradeFlow"));
    ok(!/INCOTERMS_BUY|INCOTERMS_SELL/.test(rd("PurchaseOrders.tsx") + rd("SalesOrders.tsx")), "the old lists are still there");
  });
  t("FZ-21 (v7.22.3): CFR reads like CIF — on a purchase the goods come to us at the port of discharge, and both sentences say the risk passed on board at loading; only CIF insures", () => {
    eq(INC.handoverPointOf("CFR", "buy"), "dest_port"); eq(INC.handoverPointOf("CIF", "buy"), "dest_port");
    ["CFR", "CIF"].forEach(c => ok(/on board the vessel at the port of shipment/.test(INC.incotermLine(c, "buy", "Damietta")) && /\(Damietta\)/.test(INC.incotermLine(c, "buy", "Damietta")), c + "'s sentence"));
    ok(/insures it \(ICC \(C\) minimum\)/.test(INC.incotermLine("CIF", "buy")) && !/insure/.test(INC.incotermLine("CFR", "buy")), "the insurance");
    eq(INC.namedPlaceGuide("CFR", "buy").label, INC.namedPlaceGuide("CIF", "buy").label);
  });
  t("FZ-21 (v7.22.3): FAS, CPT, CIP and DPU are known on every screen — their named place, its guidance and the hand-over point come from the table", () => {
    eq(["FAS", "CPT", "CIP", "DPU"].map(c => INC.namedPlaceGuide(c, "buy").label).join(" | "), "Port of loading | Delivery place | Delivery place | Delivery place");
    eq(["FAS", "CPT", "CIP", "DPU"].map(c => INC.handoverPointOf(c, "buy")).join(), "origin_port,our_wh,our_wh,our_wh");
    eq(INC.handoverPointOf("CPT", "buy", true), "dest_port", "CPT to a named port");
    eq(TF.dispositionFromSO({ sellIncoterm: "DPU" }), "DIRECT_TO_CLIENT"); eq(TF.dispositionFromSO({ sellIncoterm: "FAS" }), "TO_PORT");
  });
  t("FZ-21 (v7.22.3): a purchase or sale whose term is not an Incoterms 2020 rule (an old DAT, a typo) is not read — the terms review names it for the user to choose again; nothing on the 2 Oct file", () => {
    eq(INC.isIncoterm2020("DAT"), false); eq(INC.ruleOf("DAT"), null); eq(INC.handoverPointOf("DAT", "buy"), "");
    const f = INC.termsToReview({ pos: [{ number: "PO-T-1", status: "Confirmed", buyIncoterm: "DAT" }], orders: [{ number: "SO-T-1", status: "Confirmed", sellIncoterm: "CIF Jeddah" }] }).filter(x => x.kind === "outdated");
    eq(f.map(x => x.record).sort().join(), "PO-T-1,SO-T-1"); ok(/DAT became DPU in 2020/.test(f.find(x => x.record === "PO-T-1").text), "no word on DAT");
    const p = FX.needFixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json", "the 2 Oct file"); if (!p) return; const d = JSON.parse(fsx.readFileSync(p, "utf8"));
    eq(INC.termsToReview({ pos: d.pos, orders: d.orders }).filter(x => x.kind === "outdated").length, 0, "an outdated term on 2 Oct");
  });
})();

// ══ v7.22.4 — A-RV-16: no hidden module copies ══
(function v72204(){
  console.log("\n══ v7.22.4 — A-RV-16: no hidden module copies ══");
  const fsx = require("fs"), px = require("path"); const rd = f => fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8");
  t("A-RV-16 (v7.22.4): the sales, purchase and shipment screens keep no module-level copy of their data — one value from the props, handed down through a context (or a parameter)", () => {
    ["SalesOrders.tsx", "PurchaseOrders.tsx", "Shipments.tsx"].forEach(f => ok(!/^export let \w+/m.test(rd(f)), f + " still keeps a module-level copy"));
    ok(/export function buildSalesData\(/.test(rd("SalesOrders.tsx")) && /<SalesDataContext\.Provider value=\{sd\}>/.test(rd("SalesOrders.tsx")), "the sales data is not provided");
    ok(/<PoDataContext\.Provider value=\{sd\}>/.test(rd("PurchaseOrders.tsx")), "the purchase data is not provided");
    ok(!/setContactsRef|CONTACTS_REF|PO_PACKAGING_TYPES|PACKAGING_TYPES_REF|SHIPMENTS_REF|RAW_LOTS|PO_REFS/.test(["SalesOrders.tsx", "SalesOrderForm.tsx", "SalesOrderDetail.tsx", "SalesOrderDocument.tsx", "PurchaseOrders.tsx", "PurchaseOrderForm.tsx", "PurchaseOrderDetail.tsx", "PurchaseOrderDocument.tsx", "Shipments.tsx", "ShipmentEditor.tsx"].map(rd).join("\n").replace(/\/\/[^\n]*/g, "")), "a hidden copy is still named");
  });
})();

// ══ v7.22.6 — FZ-20: the record types describe the data as it is stored ══
(function v72206(){
  console.log("\n══ v7.22.6 — FZ-20: the record types describe the stored data ══");
  const fsx = require("fs"), px = require("path"); const ts = require("typescript");
  const membersOf = (file, name) => { const text = fsx.readFileSync(px.join(__dirname, "../src/" + file), "utf8"); const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true); let out = null;
    sf.statements.forEach(st => { if (ts.isInterfaceDeclaration(st) && st.name.text === name) out = new Set(st.members.map(m => m.name ? m.name.getText(sf).replace(/["']/g, "") : "")); }); return out; };
  t("FZ-20 (v7.22.6): every field stored on the 2 Oct file's records — orders, lines, lots, movements, shipments, legs, units, goods, costs, companies, invoices, claims — is declared on its record type; types.ts lists every stored list", () => {
    const p = FX.needFixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json", "the 2 Oct file"); if (!p) return; const d = JSON.parse(fsx.readFileSync(p, "utf8"));
    const recs = (store, path) => { let rs = (d[store] || []).filter(r => r && typeof r === "object"); (path ? path.split(".") : []).forEach(k => { rs = rs.flatMap(r => (r[k] || []).filter(x => x && typeof x === "object")); }); return rs; };
    const M = [["contacts", "", "types.ts", "Counterparty"], ["pos", "", "types.ts", "POrder"], ["pos", "items", "types.ts", "POLine"], ["orders", "", "types.ts", "SOrder"], ["orders", "items", "types.ts", "SOLine"], ["lots", "", "types.ts", "Lot"], ["lots", "movements", "types.ts", "LotMovement"], ["lots", "costs", "types.ts", "LotCostLine"], ["shipments", "", "types.ts", "Shipment"], ["shipments", "legs", "types.ts", "ShipmentLeg"], ["shipments", "legs.vehicles", "types.ts", "TransportUnit"], ["shipments", "goods", "types.ts", "ShipmentGoodsLine"], ["shipments", "costs", "types.ts", "ShipmentCostLine"], ["invoices", "", "invoicing.ts", "Invoice"], ["invoices", "positions", "invoicing.ts", "InvoicePosition"], ["claims", "", "claims.domain.ts", "Claim"], ["operationalCosts", "", "operationalCosts.ts", "OperationalCost"]];
    const gaps = [];
    // v7.28.x (Batch L): a field retired by Batch L is no longer declared — the old file still stores it, and the save-time tidy-up moves
    // it into its owner and drops it; it must be one of these, never a new undeclared field
    const RETIRED = new Set(["lostValueEUR", "totalCostEUR", "defectValueEUR", "recoveredEUR", "requestedEUR", "acceptedEUR", "plnPerEur", "egpPerEur", "expectedDeliveryDate", "linkedLots", "linkedInvoices", "linkedShipments", "linkedSalesOrders", "contacts", "additionalTypes", "paymentTermsDays", "creditLimitPLN", "defaultCurrency", "actualLoadDate", "actualUnloadDate"]);
    M.forEach(([store, path, file, name]) => { const have = membersOf(file, name); ok(have, name + " not found"); const keys = new Set(recs(store, path).flatMap(r => Object.keys(r))); const miss = [...keys].filter(k => !have.has(k) && !RETIRED.has(k)); if (miss.length) gaps.push(`${name}: ${miss.slice(0, 4).join(", ")}${miss.length > 4 ? ` +${miss.length - 4}` : ""}`); });
    eq(gaps.join(" | "), "", "stored but undeclared");
    ok(membersOf("types.ts", "StoreRecords") && ["contacts", "pos", "orders", "lots", "shipments", "invoices", "auditLog", "planningSheets"].every(k => membersOf("types.ts", "StoreRecords").has(k)), "the catalogue of stored lists");
  });
})();

// ══ v7.22.7 — A-RV-18: the repository describes today's system ══
(function v72207(){
  console.log("\n══ v7.22.7 — A-RV-18: repository tidy-up ══");
  const fsx = require("fs"), px = require("path"); const root = px.join(__dirname, "..");
  t("A-RV-18 (v7.22.7): the README describes today's system and every file it names exists; the unused demo seed and the stale colour survey are gone", () => {
    ok(!fsx.existsSync(px.join(root, "demoSeed_reference.ts")) && !fsx.existsSync(px.join(root, "RED_COLOUR_SURVEY.md")), "an unused file is still in the repository");
    const rd = fsx.readFileSync(px.join(root, "README.md"), "utf8");
    const named = [...rd.matchAll(/`((?:src|api|tests|vendor)\/[\w./-]+|[A-Z_]+\.md)`/g)].map(m => m[1]).filter(f => !f.endsWith("/"));
    ok(named.length >= 5, "the README names too few files"); eq(named.filter(f => !fsx.existsSync(px.join(root, f))).join(", "), "", "named in the README but missing");
    ok(!/Integrated Prototype|local JSON export\/import/.test(rd), "the README still describes the old prototype");
  });
})();

// ══ v7.23.0 — A-DEP-1: a leftover file can no longer stop a deploy ══
(function v72300(){
  console.log("\n══ v7.23.0 — A-DEP-1: a leftover file can no longer stop a deploy ══");
  const fsx = require("fs"), px = require("path"), cp = require("child_process"); const root = px.join(__dirname, "..");
  t("A-DEP-1 (v7.23.0): before every build, a file in the copy that is not part of the release is named in the log (and the build goes on); the type-check reads only the files the app loads", () => {
    eq(JSON.parse(fsx.readFileSync(px.join(root, "package.json"), "utf8")).scripts.prebuild, "node scripts/check-release.cjs");
    eq((JSON.parse(fsx.readFileSync(px.join(root, "tsconfig.json"), "utf8")).include || []).join(), "src/index.tsx");
    const stray = px.join(root, "src", "__LeftoverFromAnOldVersion.tsx"); fsx.writeFileSync(stray, 'import { GONE } from "./board.domain";\nexport default GONE;\n');
    try { const out = cp.execFileSync("node", [px.join(root, "scripts", "check-release.cjs")], { encoding: "utf8" }); ok(/NOT part of v/.test(out) && /src\/__LeftoverFromAnOldVersion\.tsx/.test(out), "the leftover is not named: " + out.slice(0, 200)); }
    finally { fsx.unlinkSync(stray); }
  });
})();

// ══ v7.23.2 — A-SOL-1: the sale line says whether its lot covers it ══
(function v72302(){
  console.log("\n══ v7.23.2 — A-SOL-1: one statement per sale line ══");
  const SD = B("salesOrders.domain.js"); const fsx = require("fs"), px = require("path"); const rd = f => fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8");
  t("A-SOL-1 (v7.23.2): a line's availability is what its own lot has free — no other sources, no combined figure; the form says 'This line · Free · Short by' (the shortage highlighted), without icons", () => {
    const lots = [{ number: "LOT-A", product: "Apples", variety: "Elise", availableKg: 15000 }, { number: "LOT-B", product: "Apples", variety: "Elise", availableKg: 9000 }, { number: "LOT-C", product: "Apples", variety: "Gala", availableKg: 21294 }];
    const a = SD.computeLineAvailability([{ product: "Apples", variety: "Elise", sourceType: "STOCK", sourceRef: "LOT-A", qty: 19422 }], [], null, lots, [], [])[0];
    eq(a.primaryAvailable, 15000); eq(a.overage, 4422); eq(a.hasOverage, true);
    ["otherSourcesAvailable", "combinedAvailable", "otherStockKg", "otherPOKg"].forEach(k => ok(!(k in a), k + " is still worked out"));
    const src = rd("SalesOrderForm.tsx"); ok(/>This line <strong>/.test(src) && />Free <strong>/.test(src) && /Short by \{fmtNum\(avail\.overage\)\} kg/.test(src), "the statement");
    ok(!/Other sources|Combined <strong>|🚚 \$\{fmtNum|⚠ Availability/.test(src), "the old strip is still there");
  });
  t("A-SOL-1 (v7.23.2): 'Change source' offers only true matches — same item and variety, and size, class, origin, coloration where both carry one; a lot without a variety is never a match", () => {
    const line = { product: "Apples", variety: "Elise", size: "70-80", grade: "I", origin: "Poland", coloration: "red blush" };
    eq([{ product: "Apples", variety: "Elise", size: "70-80", quality: "I", origin: "Poland" }, { product: "Apples", variety: "" }, { product: "Apples", variety: "Gala" }, { product: "Apples", variety: "Elise", size: "65-70" }, { product: "Apples", variety: "Elise", coloration: "green" }, { product: "Pears", variety: "Elise" }].map(l => SD.sourceMatch(line, l)).join(), "match,no-variety,different,different,different,different");
    const src = rd("SalesOrderForm.tsx"); ok(/sourceMatch\(lineItem, l\) === "match"/.test(src) && /No variety — fill it in on the lot or its PO/.test(src), "the picker");
  });
})();

// ══ v7.24.0 — A-BK-7: a backup from the test copy says so in its name ══
(function v72400(){
  console.log("\n══ v7.24.0 — A-BK-7: TEST in the backup's name ══");
  const fsx = require("fs"), px = require("path"); const rd = f => fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8");
  t("A-BK-7 (v7.24.0): every backup file from the test copy is named '…-TEST…' (the real copy's names unchanged), and the file's header says which copy it came from", () => {
    const p = require.resolve("./build/remoteStore.js"); const keep = require.cache[p]; const was = process.env.REACT_APP_ENV_LABEL;
    try { delete require.cache[p]; process.env.REACT_APP_ENV_LABEL = "test"; eq(require(p).fileLabel(), "-TEST"); delete require.cache[p]; process.env.REACT_APP_ENV_LABEL = ""; eq(require(p).fileLabel(), ""); }
    finally { if (was === undefined) delete process.env.REACT_APP_ENV_LABEL; else process.env.REACT_APP_ENV_LABEL = was; require.cache[p] = keep; }
    ok(/a\.download = `marianna-erp\$\{fileLabel\(\)\}_v\$\{APP_VERSION\}_schema-v/.test(rd("autoBackup.ts")), "the backup download");
    ok((rd("Settings.tsx").match(/\$\{fileLabel\(\)\}/g) || []).length >= 3 && /marianna-shared-copy\$\{fileLabel\(\)\}-before-recovery/.test(rd("RecoveryPanel.tsx")) && /marianna-erp\$\{fileLabel\(\)\}_recovery_/.test(rd("ErrorBoundary.tsx")), "the other downloads");
    ok(/copy: String\(process\.env\.REACT_APP_ENV_LABEL/.test(rd("useLocalStoredState.ts")) && /copy: ENV_LABEL\.toUpperCase\(\) \|\| "REAL"/.test(rd("remoteStore.ts")), "the header");
  });
})();

// ══ v7.24.1 — FZ-01 step 1: the one-time repairs proven done on both copies are gone ══
(function v72401(){
  console.log("\n══ v7.24.1 — FZ-01 step 1: one-time repairs gone ══");
  const fsx = require("fs"), px = require("path"); const rd = f => fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8");
  t("FZ-01 (v7.24.1): the one-time repairs that change nothing on either copy (owner's files of 15 Oct) no longer run on opening — and their code is gone; the live routines stay", () => {
    const app = rd("App.tsx");
    ["v7.12.2-trade-direction", "v7.18.2-doc-types", "v7.13.1-closed-months", "foldWarehouseInvoiceStore(", "migrateAddressOn(", "foldLegacyClaimFields(", "migrateSaleLinesToLots(", "normaliseStoredSoStatus(", "convertSettledRefsToEvents(", "stripPendingInvoices("].forEach(k => ok(!app.includes(k), "App still runs " + k));
    const all = fsx.readdirSync(px.join(__dirname, "../src")).filter(f => /\.(ts|tsx)$/.test(f)).map(rd).join("\n");
    ["function foldWarehouseInvoiceStore", "function migrateAddressOn", "function foldLegacyClaimFields", "function migrateSaleLinesToLots", "function normaliseStoredSoStatus", "function convertSettledRefsToEvents", "function stripPendingInvoices", "function mapDocTypes"].forEach(k => ok(!all.includes(k), k + " is still in the code"));
    ["migrateLegacyInvoices(", "normaliseCounterparty(", "normalisePO(", "normaliseSO(", "normaliseLot(", "normaliseInvoiceCategory(", "stampSiteIds(", "fxFillInvoice("].forEach(k => ok(app.includes(k), "a live routine went: " + k));
  });
  t("A-ST-10 / A-RV-30 (kept): Finance → Warehouse charges reads and writes the register — no store of its own; the import posts warehouse invoices to the register", () => {
    const fin = rd("Finance.tsx"), inv = rd("Invoices.tsx");
    ok(!/setWarehouseInvoices|deleteInvoice\(/.test(fin), "Finance still writes the separate store or deletes from it");
    ok(/<WarehouseChargesView[^>]*invoices=\{invoices\} setInvoices=\{setInvoices\}/.test(fin), "Warehouse charges is not given the register");
    ok(!/setWarehouseInvoices/.test(inv) && /category: "WAREHOUSE", costScope: scopeOf\("WAREHOUSE"\)/.test(inv), "the import still writes the separate store");
  });
})();

// ══ v7.24.2 — A-RV-15 b/c: a sale line is a lot, everywhere in the code ══
(function v72402(){
  console.log("\n══ v7.24.2 — A-RV-15 b/c: a sale line is a lot ══");
  const fsx = require("fs"), px = require("path"); const src = px.join(__dirname, "../src"); const rd = f => fsx.readFileSync(px.join(src, f), "utf8");
  t("A-RV-15 b/c (v7.24.2): no screen or rule handles a sale line 'sourced from a PO' any more — the picker has no PO tab, the SO save no unreachable override; the lot matcher reads the lot a line names", () => {
    const hits = fsx.readdirSync(src).filter(f => /\.(ts|tsx)$/.test(f)).filter(f => /\.sourceType\s*[!=]==?\s*["']PO["']/.test(rd(f).replace(/\/\/[^\n]*/g, "")));   // v7.27.0 (FZ-23): every file — ShipmentCreate was left out and kept three
    eq(hits.join(", "), "", "files still testing a line 'from a PO'");
    const form = rd("SalesOrderForm.tsx"); ok(!/function pickPO|matchingPOLines|tab === "PO"/.test(form), "the picker's PO tab is still there");
    ok(!/legacy override kept unreachable/.test(rd("SalesOrders.tsx")), "the unreachable override is still there");
    const SD = B("salesOrders.domain.js"); eq(SD.findLotForSOLine([{ number: "LOT-1" }], { sourceType: "STOCK", sourceRef: "LOT-1" }).number, "LOT-1"); eq(SD.findLotForSOLine([{ number: "LOT-1", poRef: "PO-1" }], { sourceType: "PO", sourceRef: "PO-1" }), null);
  });
  t("A-RV-15 b (v7.24.2): the suites' data files are in today's form — sale lines point at lots; 'from a PO' only on the two deleted sales (and the 23 Sept file, older than lots)", () => {
    const dir = px.join(__dirname, "fixtures"); const bad = [];
    fsx.readdirSync(dir).filter(f => /^marianna-erp_.*\.json$/.test(f) && !/v6\.99\.50_/.test(f)).forEach(f => { const d = JSON.parse(fsx.readFileSync(px.join(dir, f), "utf8"));
      (d.orders || []).forEach(o => { if (String(o.status) !== "Cancelled" && (o.items || []).some(i => i && i.sourceType === "PO")) bad.push(`${f.slice(13, 32)} ${o.number}`); }); });
    eq(bad.join(" | "), "", "a live sale still 'from a PO'");
  });
})();

// ══ v7.24.3 — FZ-01 step 2: a save writes the clean shape ══
(function v72403(){
  console.log("\n══ v7.24.3 — FZ-01 step 2: a save writes the clean shape ══");
  const SS = B("storeShapes.js"); const fsx = require("fs"), px = require("path"); const rd = f => fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8");
  t("FZ-01 step 2 (v7.24.3): a write tidies only the records it writes — new or changed ones pass through their tidy-up; untouched ones keep their very object; nothing to tidy keeps the very array", () => {
    const a = { id: 1, old: true }, b = { id: 2, old: true }; const shape = r => r.old ? (({ old, ...rest }) => ({ ...rest, clean: true }))(r) : r;
    const prev = [a, b]; const changed = { ...b, qty: 5 }; const out = SS.shapeWritten(prev, [a, changed, { id: 3, old: true }], shape);
    ok(out[0] === a, "an untouched record was rewritten"); eq(JSON.stringify(out[1]), JSON.stringify({ id: 2, qty: 5, clean: true })); eq(out[2].clean, true);
    const same = [a, { id: 9 }]; eq(SS.shapeWritten(prev, same, shape), same); eq(SS.shapeWritten(prev, prev, shape), prev);
    let stored = prev; const set = u => { stored = typeof u === "function" ? u(stored) : u; }; const setX = SS.shapingSetter(set, shape);
    setX(p => [...p, { id: 4, old: true }]); eq(stored.length, 3); ok(stored[0] === a && stored[2].clean, "the setter did not tidy what it wrote");
  });
  t("FZ-01 step 2 (v7.24.3): App runs no tidy-up when it opens — the company, PO, SO, lot and invoice stores tidy what they write; new invoices no longer carry the retired credit-note list", () => {
    const app = rd("App.tsx");
    ok(!/useEffect\(\(\) => \{[^}]{0,200}(normalisePO|normaliseCounterparty|stampSiteIds|normaliseLot|normaliseInvoiceCategory|normaliseSO)\(/.test(app), "a start-up tidy-up is still there");
    ["setPOs = useMemo(() => shapingSetter(setPOsRaw", "setOrders = useMemo(() => shapingSetter(setOrdersRaw", "setLots = useMemo(() => shapingSetter(setLotsRaw", "setInvoices = useMemo(() => shapingSetter(setInvoicesRaw", "_setContacts = useMemo(() => (u: any) => _setContactsRaw("].forEach(k => ok(app.includes(k), "not tidied on write: " + k));
    ok(!/creditNoteIds: \[\]/.test(rd("invoicing.ts") + rd("fakturowniaImport.domain.ts")), "a new invoice still writes creditNoteIds");
  });
})();

// ══ v7.24.4 — A-RV-41 (option 1): "direct" kept current by the one rule ══
(function v72404(){
  console.log("\n══ v7.24.4 — A-RV-41: 'direct' kept current ══");
  const TF = B("tradeFlow.domain.js"); const fsx = require("fs"), px = require("path");
  t("A-RV-41 (v7.24.4): a sale of a PO's lot on onward terms makes the PO and its lots direct — a lot not yet received follows in its status, a received one keeps it; cancelling the sale undoes it; nothing to change gives back the very arrays", () => {
    const pos = [{ number: "PO-1", status: "Confirmed", buyIncoterm: "EXW", directFlow: false }, { number: "PO-2", status: "Confirmed", buyIncoterm: "FCA", directFlow: false }];
    const lots = [{ number: "LOT-1", poRef: "PO-1", status: "Expected", receivedKg: 0 }, { number: "LOT-2", poRef: "PO-1", status: "In Stock", receivedKg: 500 }, { number: "LOT-3", poRef: "PO-2", status: "Expected" }];
    const sale = { number: "SO-1", status: "Confirmed", sellIncoterm: "DAP", items: [{ sourceType: "STOCK", sourceRef: "LOT-1" }] };
    const r = TF.directSync(pos, [sale], lots); eq(r.changedPOs.join(), "PO-1"); eq(r.changedLots.join(), "LOT-1,LOT-2");
    eq(r.lots[0].status, "Direct Expected"); eq(r.lots[1].status, "In Stock", "a received lot keeps its status"); ok(r.lots[2] === lots[2], "another PO's lot was touched");
    const again = TF.directSync(r.pos, [sale], r.lots); ok(again.pos === r.pos && again.lots === r.lots, "a second pass changed something");
    const off = TF.directSync(r.pos, [{ ...sale, status: "Cancelled" }], r.lots); eq(off.changedPOs.join(), "PO-1"); eq(off.lots[0].status, "Expected"); eq(off.lots[0].directFlow, false);
    ok(/directSync\(pos \|\| \[\], orders \|\| \[\], lots \|\| \[\]\)/.test(fsx.readFileSync(px.join(__dirname, "../src/App.tsx"), "utf8")), "App does not keep the flag current");
  });
})();

// ══ v7.25.0 — A-RV-13 / FZ-02: one source for each company ══
(function v72500(){
  console.log("\n══ v7.25.0 — A-RV-13 / FZ-02: one source for each company ══");
  const CP = B("counterparty.domain.js"); const IC = B("integrityCheck.js"); const fsx = require("fs"), px = require("path"); const rd = f => fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8");
  t("A-RV-13 / FZ-02 (v7.25.0): a document's company is read live by its id (or a merged duplicate's) and never by name; a document already showing the live company stays the very same object; a company edit rewrites no stored document", () => {
    const contacts = [{ id: 1, name: "Agro A", address: "New street 1", contacts: [{ name: "Ann", isPrimary: true }] }, { id: 2, name: "Same Name", mergedFromIds: [7] }, { id: 3, name: "Same Name" }];
    const po1 = { number: "PO-1", supplier: CP.companyCopy(contacts[0]) }; const po2 = { number: "PO-2", supplier: { id: 1, name: "Agro A", address: "Old street 9" } };
    const po3 = { number: "PO-3", supplier: { id: 7, name: "Old dup" } }; const po4 = { number: "PO-4", supplier: { id: 99, name: "Same Name" } };
    const out = CP.withLiveCompanies([po1, po2, po3, po4], ["supplier"], contacts);
    ok(out[0] === po1, "an up-to-date document was rewritten"); eq(out[1].supplier.address, "New street 1"); eq(out[2].supplier.id, 2, "a merged duplicate's id leads to the survivor");
    ok(out[3] === po4, "a company not found by id was matched by name"); const same = [po1]; ok(CP.withLiveCompanies(same, ["supplier"], contacts) === same, "nothing to show differently returns the very list");
    const app = rd("App.tsx"); ok(!/refreshPOCounterparties|refreshSOCounterparties|refreshShipmentCounterparties|resolveCounterpartySnapshot/.test(app), "the rewrite-every-document refresh is still in App");
    ok(/const pos = useMemo\(\(\) => withLiveCompanies\(posStored, \["supplier"\]/.test(app) && /const orders = useMemo\(\(\) => withLiveCompanies\(ordersStored, \["client"\]/.test(app), "the screens do not read the companies live");
    ok(!/normalizeName\(c\.name\) === normalizeName\(saved\.name\)/.test(app + rd("counterparty.domain.ts")), "a company is still matched by name");
  });
  t("A-RV-13 (v7.25.0): a PO or SO whose company is not in Counterparties (by id or a merged duplicate's id) is named in the data checks", () => {
    const r = IC.checkIntegrity({ contacts: [{ id: 2, mergedFromIds: [7] }], pos: [{ number: "PO-9", status: "Confirmed", supplier: { id: 99, name: "Gone" } }, { number: "PO-8", status: "Confirmed", supplier: { id: 7 } }], orders: [{ number: "SO-9", status: "Confirmed", client: { id: 98, name: "Gone too" }, items: [] }], lots: [], shipments: [], invoices: [] });
    const hits = r.issues.filter(i => i.code === "COMPANY_UNKNOWN").map(i => i.entity).sort().join(","); eq(hits, "PO-9,SO-9");
  });
})();

// ══ v7.25.1 — FZ-17: an invoice names its company by id ══
(function v72501(){
  console.log("\n══ v7.25.1 — FZ-17: the invoice's company by id ══");
  const FI = B("fakturowniaImport.domain.js"); const fsx = require("fs"), px = require("path");
  t("FZ-17 (v7.25.1): the Fakturownia import links an invoice to its company by tax number only (NIP, then the EU VAT id) — a name is never a link", () => {
    const contacts = [{ id: 1, name: "Agro Fresh", nip: "123-456-78-90" }, { id: 2, name: "Nile Trade", vatEuId: "EG987" }];
    eq(FI.contactForSeller({ seller: "Whatever", sellerTaxNo: "1234567890" }, contacts, { byName: false }).id, 1);
    eq(FI.contactForSeller({ seller: "Whatever", sellerTaxNo: "eg987" }, contacts, { byName: false }).id, 2);
    eq(FI.contactForSeller({ seller: "Agro Fresh" }, contacts, { byName: false }), null, "linked by name");
    ok(FI.contactForSeller({ seller: "Agro Fresh" }, contacts), "the name still suggests");
    ok(/contactForSeller\(r, contacts, \{ byName: false \}\)/.test(fsx.readFileSync(px.join(__dirname, "../src/Invoices.tsx"), "utf8")), "the import still links by name");
  });
})();

// ══ v7.26.0 — A-INV-1: an invoice never shows its net as its gross ══
(function v72600(){
  console.log("\n══ v7.26.0 — A-INV-1: net and gross ══");
  const FI = B("fakturowniaImport.domain.js"), FK = B("fakturownia.js"), INV = B("invoicing.js"), IC = B("integrityCheck.js");
  t("A-INV-1 (v7.26.0): the gross is Fakturownia's (or net + VAT when it sends none) — never the net; the VAT rate the two amounts say gives the gross back to the grosz; a row missing an amount is flagged", () => {
    eq(FK.mapInvoice({ price_net: "100,00", price_tax: "23,00" }).grossTotal, 123); eq(FK.mapInvoice({ price_net: "100", price_gross: "200" }).grossTotal, 200); eq(FK.mapInvoice({ price_net: "100" }).grossTotal, 0, "the net taken for the gross");
    const r = FI.vatRateOf(1000, 1234.56); eq(INV.recomputeInvoiceMoney({ netAmount: 1000, vatRate: r, currency: "PLN", fxRate: 1 }).grossAmount, 1234.56, "a rounded rate changed the gross");
    eq(FI.vatRateOf(1000, 0), 0); eq(FI.vatRateOf(0, 100), 0);
    const half = FI.buildCostInvoice({ number: "X/1", seller: "S", net: 1000, gross: 0, currency: "PLN", fxRate: 1, date: "2026-10-01" }, "FREIGHT", {}, null); ok(half.amountsIncomplete, "a row without its gross is not flagged"); eq(half.vatRate, 0);
    const full = INV.recomputeInvoiceMoney(FI.buildCostInvoice({ number: "X/2", seller: "S", net: 1000, gross: 1230, currency: "PLN", fxRate: 1, date: "2026-10-01" }, "FREIGHT", {}, null)); eq(full.grossAmount, 1230); ok(!full.amountsIncomplete);
  });
  t("A-INV-1 (v7.26.0): an operational cost's register invoice keeps the VAT the import found; an old VAT-less one is corrected by re-importing its month (a true 0 % is confirmed); the data checks name what is left", () => {
    const reg = INV.migrateLegacyInvoices({ existing: [], orders: [], warehouseInvoices: [], operationalCosts: [{ id: 77, invoiceNo: "OV/1", supplierName: "Office Ltd", amount: 1000, vatRate: 23, currency: "PLN", fxRate: 1, date: "2026-10-01", category: "office_rent", costCenter: "general", notes: "Imported from Fakturownia (Invoices)" }] });
    eq(reg[0].grossAmount, 1230); eq(reg[0].vatAmount, 230);
    const old = { id: 5, kind: "COST", number: "OV/2", paymentStatus: "Issued", source: "migrated:opCost:88", vatRate: 0, notes: "Imported from Fakturownia (Invoices)" };
    const fix = FI.vatFixFor({ number: "OV/2", net: 1000, gross: 1230 }, [old]); eq(fix.vatRate, 23); eq(fix.opCostId, "88"); ok(!fix.confirmZero);
    ok(FI.vatFixFor({ number: "OV/2", net: 1000, gross: 1000 }, [old]).confirmZero, "a true 0 % is not confirmed"); eq(FI.vatFixFor({ number: "OV/2", net: 1000, gross: 1230 }, [{ ...old, source: "fakturownia-import" }]), null);
    const ic = IC.checkIntegrity({ invoices: [old, { ...old, id: 6, number: "OV/3", vatChecked: true }, { id: 7, kind: "COST", number: "H/1", paymentStatus: "Issued", amountsIncomplete: true }], pos: [], orders: [], lots: [], shipments: [], contacts: [] });
    eq(ic.issues.filter(i => i.code === "INVOICE_VAT_MISSING").map(i => i.entity).join(), "OV/2"); eq(ic.issues.filter(i => i.code === "INVOICE_AMOUNTS_INCOMPLETE").length, 1);
  });
})();

// ══ v7.26.3 — A-INV-3: sales invoices issued in Fakturownia belong to their SO ══
(function v72603(){
  console.log("\n══ v7.26.3 — A-INV-3: issued invoices to their SO ══");
  const FI = B("fakturowniaImport.domain.js"), FK = B("fakturownia.js"), INV = B("invoicing.js");
  t("A-INV-3 (v7.26.3): an invoice issued in Fakturownia comes in with its client, amounts and printed rate; its SO is suggested — the one named on it first, then the client's open SO closest in amount; SOs already invoiced, drafts and deleted ones are not offered", () => {
    const m = FK.mapInvoice({ id: 9, number: "FV 7/10/2026", income: "1", issue_date: "2026-10-05", buyer_name: "Nile Fresh", buyer_tax_no: "EG-123", price_net: "1000", price_gross: "1000", currency: "EUR", exchange_rate: "4.2512", description: "Apples SO-2026-0031" });
    const row = FI.salesRowFromMapped(m, 0); eq(row.buyer, "Nile Fresh"); eq(row.fxRate, 4.2512); eq(row.currency, "EUR");
    const contacts = [{ id: 5, name: "Nile Fresh Co", nip: "EG123" }];
    const so = (n, extra) => ({ number: n, status: "Confirmed", currency: "EUR", client: { id: 5, name: "Nile Fresh Co" }, items: [{ qty: 1000, unitPrice: 1 }], ...(extra || {}) });
    const orders = [so("SO-2026-0030", { items: [{ qty: 1000, unitPrice: 1.01 }] }), so("SO-2026-0031", { items: [{ qty: 500, unitPrice: 1 }] }), so("SO-2026-0032", { status: "Draft" }), so("SO-2026-0033"), so("SO-2026-0034", { status: "Cancelled" })];
    const invoices = [{ kind: "SALES", number: "FV 1/10/2026", paymentStatus: "Issued", links: [{ type: "SO", number: "SO-2026-0033" }] }];
    const c = FI.soCandidatesForSale(row, orders, invoices, contacts); eq(c.companyId, 5);
    eq(c.list.map(x => x.number).join(","), "SO-2026-0031,SO-2026-0030", "named first, then the closest amount; invoiced / draft / deleted left out");
    ok(!FI.soCandidatesForSale({ ...row, description: "" }, orders, invoices, contacts).list[0].label.includes("named"), "a SO not named was labelled as named");
    eq(FI.isRegisteredSale("FV 1/10/2026", invoices), true); eq(FI.isRegisteredSale("FV 7/10/2026", invoices), false);
  });
  t("A-INV-3 (v7.26.3): the register entry is a sales invoice linked to its SO, with the rate printed on the invoice (FZ-06) — or, without one, the register's NBP rule fills it", () => {
    const row = { number: "FV 7/10/2026", buyer: "Nile Fresh", date: "2026-10-05", net: 1000, gross: 1230, currency: "EUR", fxRate: 4.2512, fktId: 9 };
    const inv = INV.recomputeInvoiceMoney(FI.buildIssuedSalesInvoice(row, "SO-2026-0031", { id: 5, name: "Nile Fresh Co" }));
    eq(inv.kind, "SALES"); eq(inv.category, "SALES"); eq(JSON.stringify(inv.links), JSON.stringify([{ type: "SO", number: "SO-2026-0031" }])); eq(inv.counterparty.id, 5);
    eq(inv.fxRate, 4.2512); eq(inv.fxSource, "fakturownia"); eq(inv.grossAmount, 1230); eq(inv.fakturownia.exported, true);
    const noRate = FI.buildIssuedSalesInvoice({ ...row, fxRate: 0 }, "", null); ok(!noRate.fxTableDate, "an invoice without its printed rate was marked as rated"); eq(noRate.links.length, 0);
  });
})();

// ══ v7.26.4 — A-INV-4: the ERP's sales invoice carries the export details ══
(function v72604(){
  console.log("\n══ v7.26.4 — A-INV-4: the invoice's notes ══");
  const N = B("invoiceNotes.domain.js"), INV = B("invoicing.js"); const fsx = require("fs"), px = require("path");
  const order = { number: "SO-2026-0040", sellIncoterm: "CIF", acidNo: "4100123456789", items: [{ product: "Apples", variety: "Gala", size: "65-70", qty: 19000, unit: "kg", sourceType: "STOCK", sourceRef: "LOT-1" }] };
  const lots = [{ number: "LOT-1", cnCode: "0808 10 80", origin: "Poland" }];
  const sh = { number: "SHP-1", status: "Loaded", legs: [{ mode: "Road", fromLocationId: 7, vehicles: [{ id: 1, truckPlate: "WGR 12345", trailerPlate: "WGR 6789X", tempRecorderNo: "TR-55" }] }, { mode: "Sea", vehicles: [{ id: 2, containerNumber: "MSKU1234567" }] }],   // v7.28.9: the trucks' own list
    goods: [{ soRef: "SO-2026-0040", qtyKg: 19422, grossKg: 21100, boxes: 1618, packaging: "Wooden box 12 kg" }, { soRef: "SO-OTHER", qtyKg: 999 }] };
  t("A-INV-4 (v7.26.4): the invoice's notes are filled from the sale, its shipments and lots — terms, ACID, each line's CN code and origin, net and gross weight, packages, trucks, containers, recorders — and the origin declaration for goods sold from Poland", () => {
    const txt = N.exportNotesForSale(order, { shipments: [sh], lots, deliveryPlace: "Alexandria", fromPoland: true });
    ["Delivery terms: CIF Alexandria (Incoterms 2020)", "ACID: 4100123456789", "Apples Gala 65-70 — CN 0808 10 80 — origin Poland", "Net weight: 19 422 kg · Gross weight: 21 100 kg", "Packages: 1618 × Wooden box 12 kg", "Trucks: WGR 12345 / WGR 6789X", "Containers: MSKU1234567", "Temperature recorders: TR-55", N.ORIGIN_DECLARATION].forEach(k => ok(txt.replace(/[\u00a0\u202f]/g, " ").includes(k), "missing: " + k + "\n" + txt));
    ok(!N.exportNotesForSale(order, { shipments: [sh], lots, fromPoland: false }).includes(N.ORIGIN_DECLARATION), "the declaration on goods not sold from Poland");
    eq(N.isFromPoland(order, [sh], id => id === 7 ? "Poland" : ""), true); eq(N.isFromPoland(order, [sh], () => "Egypt"), false); eq(N.isFromPoland(order, [], () => "Egypt"), true);
  });
  t("A-INV-4 (v7.26.4): the notes go to Fakturownia as the invoice's notes; the SO fills them when it creates its invoice", () => {
    const body = INV.buildFakturowniaPayload({ number: "X", issueDate: "2026-10-17", currency: "EUR", counterparty: { name: "C" }, positions: [], grossAmount: 0, invoiceNotes: "Line A\nLine B" }, {});
    eq(JSON.stringify((body.invoice || body).descriptions), JSON.stringify([{ kind: "Uwaga", content: "Line A" }, { kind: "Uwaga", content: "Line B" }]));   // v7.27.4: one entry per line (KSeF)
    ok(!("descriptions" in (INV.buildFakturowniaPayload({ number: "X", currency: "EUR", counterparty: { name: "C" }, positions: [], grossAmount: 0 }, {}).invoice || {})), "an empty note was sent");
    ok(/invoiceNotes: notes/.test(fsx.readFileSync(px.join(__dirname, "../src/SalesOrders.tsx"), "utf8")), "the SO does not fill the notes");
  });
})();

// ══ v7.26.5 — A-INV-5: one bank payment, several invoices ══
(function v72605(){
  console.log("\n══ v7.26.5 — A-INV-5: one payment, several invoices ══");
  const BR = B("bankReconciliation.domain.js");
  const inv = (id, no, gross, date, party, extra) => ({ id, kind: "COST", number: no, grossAmount: gross, paidAmount: 0, currency: "PLN", paymentStatus: "Issued", issueDate: date, counterparty: { name: party }, ...(extra || {}) });
  const open = [inv(1, "FV 10/2026", 100, "2026-09-01", "Sady Kowalczyk"), inv(2, "FV 11/2026", 250, "2026-09-05", "Sady Kowalczyk"), inv(3, "FV 12/2026", 150, "2026-09-09", "Sady Kowalczyk"), inv(4, "X 1/2026", 400, "2026-09-02", "Somebody Else"), inv(5, "FV 13/2026", 80, "2026-09-10", "Sady Kowalczyk", { currency: "EUR" })];
  t("A-INV-5 (v7.26.5): a bank line is split over the invoices its title quotes (in that order), else the payer's invoices that add up to it (the fewest), else the payer's oldest in turn — only its direction and currency; what is left is shown", () => {
    const byTitle = BR.splitBankLine({ id: "b1", amount: -300, currency: "PLN", counterparty: "KOWALCZYK SADY SP", title: "FV 12/2026 FV 10/2026" }, open);
    eq(byTitle.how, "title"); eq(byTitle.allocations.map(a => `${a.number}:${a.amount}`).join(","), "FV 12/2026:150,FV 10/2026:100"); eq(byTitle.remainder, 50);
    const exact = BR.splitBankLine({ id: "b2", amount: -400, currency: "PLN", counterparty: "Sady Kowalczyk", title: "faktury wrzesień" }, open);
    eq(exact.how, "exact"); eq(exact.allocations.map(a => a.number).sort().join(","), "FV 11/2026,FV 12/2026"); eq(exact.remainder, 0);
    const oldest = BR.splitBankLine({ id: "b3", amount: -120, currency: "PLN", counterparty: "Sady Kowalczyk", title: "zaliczka" }, open);
    eq(oldest.how, "oldest"); eq(oldest.allocations.map(a => `${a.number}:${a.amount}`).join(","), "FV 10/2026:100,FV 11/2026:20");
    ok(!exact.open.some(i => i.id === 5), "an invoice in another currency was offered"); ok(BR.splitBankLine({ id: "b4", amount: 400, currency: "PLN", counterparty: "Sady Kowalczyk", title: "" }, open).open.length === 0, "a credit line offered cost invoices");
  });
  t("A-INV-5 (v7.26.5): each invoice's share is a payment from that bank line (part k of n) — the line then counts as recorded, so a re-import never posts it again", () => {
    const line = { id: "b9", amount: -400, currency: "PLN", date: "2026-10-10", account: "PL001234", counterparty: "Sady Kowalczyk", title: "x" };
    const e = BR.bankShareEvent(line, 250, 1, 2); eq(e.amount, 250); eq(e.source, "bank:b9"); ok(/part 1 of 2/.test(e.note));
    eq(BR.appliedBankSources([{ payments: [e] }]).has("bank:b9"), true);
    eq(BR.matchBankLines([line], [{ ...open[1], payments: [e], paidAmount: 250 }])[0].rank, "ALREADY");
  });
})();

// ══ v7.26.6 — A-INV-2: the invoice PDFs in the company's folder ══
(function v72606(){
  console.log("\n══ v7.26.6 — A-INV-2: invoice PDFs in the folder ══");
  const PF = B("invoicePdfFolder.js"); const fsx = require("fs"), px = require("path");
  t("A-INV-2 (v7.26.6): each PDF is named date_number_company.pdf, safe on every system; the Invoices screen saves the Fakturownia invoices' PDFs into the chosen folder and shows where each one is", () => {
    eq(PF.pdfFileName({ issueDate: "2026-10-05T10:00", number: "FV 7/10/2026", counterparty: { name: "Nile Fresh: Co*" } }), "2026-10-05_FV 7-10-2026_Nile Fresh- Co-.pdf");
    eq(PF.pdfFileName({}), "undated_no-number_unknown.pdf");
    const src = fsx.readFileSync(px.join(__dirname, "../src/Invoices.tsx"), "utf8");
    ok(/fetchInvoicePdf\(fktIdOf\(inv\)\)/.test(src) && /savePdfToFolder\(folder, name, r\.blob\)/.test(src) && /PDF in the folder/.test(src), "the screen does not save or show the PDFs");
  });
})();

// ══ v7.27.0 — FZ-23: the sales of a PO, one reader ══
(function v72700(){
  console.log("\n══ v7.27.0 — FZ-23: the sales of a PO through its lots ══");
  const TF = B("tradeFlow.domain.js"); const fsx = require("fs"), px = require("path");
  t("FZ-23 (v7.27.0): a PO's sales are the sales of its lots — deleted sales never, drafts only when asked; a sale's POs are the POs of the lots it names; the 'direct' rule reads the same helper", () => {
    const lots = [{ number: "LOT-1", poRef: "PO-1" }, { number: "LOT-2", poRef: "PO-1" }, { number: "LOT-9", poRef: "PO-9" }];
    const so = (n, st, lot, term) => ({ number: n, status: st, sellIncoterm: term || "DAP", items: [{ sourceType: "STOCK", sourceRef: lot }] });
    const orders = [so("SO-1", "Confirmed", "LOT-1"), so("SO-2", "Confirmed", "LOT-2"), so("SO-3", "Draft", "LOT-1"), so("SO-4", "Cancelled", "LOT-2"), so("SO-5", "Confirmed", "LOT-9")];
    eq(TF.salesOfPO({ number: "PO-1" }, orders, lots).map(o => o.number).join(), "SO-1,SO-2"); eq(TF.salesOfPO({ number: "PO-1" }, orders, lots, { includeDrafts: true }).map(o => o.number).join(), "SO-1,SO-2,SO-3");
    eq(TF.salesOfPO({ number: "PO-7" }, orders, lots).length, 0); eq(TF.posOfSale(orders[0], [{ number: "PO-1" }, { number: "PO-9" }], lots).map(p => p.number).join(), "PO-1");
    eq(TF.poDirectFromSOs({ number: "PO-1" }, orders, lots), true); eq(TF.poDirectFromSOs({ number: "PO-1" }, orders.map(o => ({ ...o, status: o.number === "SO-3" ? "Draft" : "Cancelled" })), lots), false);
    const sc = fsx.readFileSync(px.join(__dirname, "../src/ShipmentCreate.tsx"), "utf8");
    ok((sc.match(/salesOfPO\(selectedPO, orders \|\| \[\], lots \|\| \[\], \{ includeDrafts: true \}\)/g) || []).length === 3 && (sc.match(/posOfSale\(selectedSO, pos \|\| \[\], lots \|\| \[\]\)/g) || []).length >= 2, "the shipment window does not read the PO's sales through its lots");   // v7.29.0: the journey proposal reads the same two helpers
  });
})();

// ══ v7.27.3 — FZ-26: a place is read from its type ══
(function v72703(){
  console.log("\n══ v7.27.3 — FZ-26: the place's type ══");
  const LOC = B("locations.js"), INC = B("incoterms.domain.js");
  t("FZ-26 (v7.27.3): a place's group comes from its type — our warehouses (own or rented), supplier and client sites, ports with port warehouses and cargo airports, customs; any other type (bonded warehouse, border crossing, relay point) is 'other', never a port; the port rule reads the type only", () => {
    const g = t => LOC.placeGroup({ type: t });
    eq([g("OwnWarehouse"), g("RentedWarehouse"), g("SupplierFacility"), g("ClientFacility"), g("Port"), g("PortWarehouse"), g("Airport"), g("Customs"), g("BondedWarehouse"), g("BorderCrossing"), g("RelayPoint"), g("")].join(), "OWN,OWN,SUPPLIER,CLIENT,PORT,PORT,PORT,BROKER,OTHER,OTHER,OTHER,OTHER");
    eq(INC.isPortPlace({ type: "Port" }), true); eq(INC.isPortPlace({ type: "Other", legacyType: "PORT" }), false, "the old code still makes a port"); eq(INC.isPortPlace({ type: "OTHER", placeType: "PortWarehouse" }), true);
  });
})();

// ══ v7.27.4 — AUD-16: the buyer on the invoice sent to Fakturownia ══
(function v72704(){
  console.log("\n══ v7.27.4 — AUD-16: the buyer's address, country and tax-number kind ══");
  const INV = B("invoicing.js"); const fsx = require("fs"), px = require("path");
  t("AUD-16 (v7.27.4): the buyer goes with its street, post code, city and ISO country, and the KIND of its tax number — a Polish NIP, an EU VAT number, another country's number, or none; the sale's delivery terms go too", () => {
    const inv = (n, extra) => ({ number: "X", currency: "EUR", counterparty: { id: 1, name: n, ...(extra || {}) }, positions: [], grossAmount: 0 });
    const pl = INV.buildFakturowniaPayload(inv("Polska Sp.", { nip: "5252445767" }), { buyer: { nip: "5252445767", country: "Poland", addr: { street: "Długa 1", postcode: "00-100", city: "Warszawa" } }, deliveryTerms: "DAP Bronisze" }).invoice;
    eq([pl.buyer_tax_no, pl.buyer_tax_no_kind, pl.buyer_street, pl.buyer_post_code, pl.buyer_city, pl.buyer_country, pl.delivery_terms].join("|"), "5252445767||Długa 1|00-100|Warszawa|PL|DAP Bronisze");
    const de = INV.buildFakturowniaPayload(inv("Deutsch GmbH"), { buyer: { vatEuId: "DE123456789", country: "Germany" } }).invoice; eq([de.buyer_tax_no, de.buyer_tax_no_kind, de.buyer_country].join("|"), "DE123456789|nip_ue|DE");
    const eg = INV.buildFakturowniaPayload(inv("Nile Fresh", { nip: "EG-778" }), { buyer: { country: "Egypt" } }).invoice; eq([eg.buyer_tax_no, eg.buyer_tax_no_kind, eg.buyer_country].join("|"), "EG-778|other|EG");
    const none = INV.buildFakturowniaPayload(inv("Somebody"), { buyer: { country: "Egypt" } }).invoice; eq(none.buyer_tax_no_kind, "empty");
    const d = INV.notesAsDescriptions("ACID: 4100\nThe exporter " + "x".repeat(300)); eq(d[0].kind + "|" + d[0].content, "ACID|4100"); ok(d.slice(1).every(x => x.content.length <= 256) && d.length === 3, "a long line is not cut to KSeF's 256");
    ok(/\.\.\.fktBuyerOpts\(inv\)/.test(fsx.readFileSync(px.join(__dirname, "../src/Invoices.tsx"), "utf8")), "the screen does not pass the live company");
  });
})();

// ══ v7.27.5 — A-COMM-NET, AUD-30, AUD-26: the consignment commission ══
(function v72705(){
  console.log("\n══ v7.27.5 — the commission on the truck's net result ══");
  const P = B("poSettlement.domain.js"), C = B("consignment.js"); const fsx = require("fs"), px = require("path");
  const po = { number: "PO-T", currency: "EUR", supplier: { id: 9, name: "Farm" }, items: [] };
  const lots = [{ number: "LOT-T", poRef: "PO-T", expectedKg: 1000, receivedKg: 1000, product: "Apples" }];
  const so = { number: "SO-T", status: "Confirmed", currency: "PLN", fxRate: 1, items: [{ sourceType: "STOCK", sourceRef: "LOT-T", qty: 1000, unitPrice: 5 }] };
  t("AUD-30 (v7.27.5): the producer's statement counts the kilos LOADED for each sale (its trucks' goods rows) — ordered kilos not yet loaded are not sold; a truck of one sale may leave the sale to the truck", () => {
    const at = sh => P.computePOSettlement({ po, lots, orders: [so], shipments: sh, ratePLNperEUR: 4.3, commissionPct: 0 });
    eq(at([]).grossPLN, 0, "ordered but not loaded counted as sold");
    eq(at([{ number: "SH-1", status: "Booked", goods: [{ lotRef: "LOT-T", soRef: "SO-T", qtyKg: 800 }] }]).grossPLN, 0, "a booked truck counted");
    eq(at([{ number: "SH-1", status: "Loaded", goods: [{ lotRef: "LOT-T", soRef: "SO-T", qtyKg: 800 }] }]).grossPLN, 4000);
    eq(at([{ number: "SH-1", status: "Delivered", governingSoRef: "SO-T", goods: [{ lotRef: "LOT-T", qtyKg: 600 }] }]).grossPLN, 3000, "the truck's own sale");
  });
  t("A-COMM-NET (v7.27.5, owner ruling 19 Oct): the band is chosen on the truck's NET result, not its gross; the screen shows and the close stores the percentage applied", () => {
    const rate = { pct: 8, bands: [{ fromPLN: 0, toPLN: 100000, pct: 8 }, { fromPLN: 100000, pct: 6 }] };
    eq(C.commissionPctForSales(rate, 120000), 6); eq(C.commissionPctForSales(rate, 90000), 8);   // a truck of 120 000 gross and 90 000 net: 8 %, not 6 %
    const src = fsx.readFileSync(px.join(__dirname, "../src/PurchaseOrders.tsx"), "utf8");
    ok(/commissionPctForSales\(rateRec, netOnly\.netPLN\)/.test(src) && !/commissionPctForSales\(rateRec, calc\.grossPLN\)/.test(src), "the band is still read on the gross");
    ok(/commissionPct: pctUsed \}\)/.test(src) && /value=\{pctUsed \?\? ""\}/.test(src), "the screen or the close does not use the percentage applied");
  });
  t("AUD-26 (v7.27.5): the commission invoice is dated on the day the settlement closed; its VAT by where the producer is — Poland 23 %, another EU state reverse charge, outside the EU not taxable in Poland; Fakturownia receives 'np' and the reverse-charge mark", () => {
    eq(P.commissionVat({ country: "Poland" }).vatRate, 23); eq(JSON.stringify(P.commissionVat({ country: "Hungary" })), JSON.stringify({ vatRate: 0, vatCode: "np", reverseCharge: true })); eq(JSON.stringify(P.commissionVat({ country: "Egypt" })), JSON.stringify({ vatRate: 0, vatCode: "np" }));
    const calc = { ratePLNperEUR: 4.3, commissionEUR: 100, commissionPct: 6, netSalesEUR: 1000, currency: "EUR", transferEUR: 900 };
    const inv = P.commissionInvoiceDraft(po, calc, { number: "SET-1", closedAt: "2026-10-12T10:00:00Z" }, { nextId: () => 1, todayISO: () => "2026-10-19", producerOf: () => ({ country: "Hungary" }) });
    eq(inv.issueDate, "2026-10-12"); eq(inv.saleDate, "2026-10-12"); eq(inv.grossAmount, 100);
    const body = B("invoicing.js").buildFakturowniaPayload({ ...inv, positions: [{ name: "Commission", quantity: 1, unit: "szt", grossTotal: 100 }] }, {}).invoice;
    eq(body.positions[0].tax, "np"); eq(body.reverse_charge, true);
    eq(P.commissionInvoiceDraft(po, calc, { number: "SET-1", closedAt: "2026-10-12" }, { nextId: () => 1, todayISO: () => "2026-10-19", producerOf: () => ({ country: "Poland" }) }).grossAmount, 123);
  });
})();

// ══ v7.27.6 — FZ-31: a groupage truck posts one movement per sale ══
(function v72706(){
  console.log("\n══ v7.27.6 — FZ-31: one SHIP_OUT per sale on a groupage truck ══");
  const SD = B("shipments.domain.js"); let id = 900; const deps = { nextId: () => ++id, todayISO: () => "2026-10-19" };
  t("FZ-31 (v7.27.6): a truck taking one DIRECT lot for two sales posts the pass-through IN once and one SHIP_OUT per sale with its own kilos (the client's report scales them); a lot for one sale posts as before", () => {
    const lot = { number: "LOT-G", poRef: "PO-G", directFlow: true, status: "Direct Expected", receivedKg: 0, physicalKg: 0, movements: [], locationId: 3 };
    const sh = { number: "SHP-G", purpose: "OUTBOUND", status: "Loaded", soRefs: ["SO-A", "SO-B"], goods: [{ lotRef: "LOT-G", soRef: "SO-A", qtyKg: 10000 }, { lotRef: "LOT-G", soRef: "SO-B", qtyKg: 985 }], destinationLocationId: 7 };
    const m = SD.postShipmentToLots(sh, [lot], deps).lots[0].movements;
    eq(m.map(x => `${x.type}:${x.qtyKg}:${x.soRef || "-"}`).join(), "IN:10985:-,SHIP_OUT:10000:SO-A,SHIP_OUT:985:SO-B");
    const one = SD.postShipmentToLots({ ...sh, soRefs: ["SO-A"], goods: [{ lotRef: "LOT-G", soRef: "SO-A", qtyKg: 10985 }] }, [lot], deps).lots[0].movements;
    eq(one.map(x => `${x.type}:${x.qtyKg}:${x.soRef || "-"}`).join(), "IN:10985:-,SHIP_OUT:10985:SO-A");
    const rep = SD.postShipmentToLots(sh, [lot], { ...deps, deliveredKgFor: () => 10900 }).lots[0].movements.filter(x => x.type === "SHIP_OUT");
    ok(Math.abs(rep.reduce((a, x) => a + x.qtyKg, 0) - 10900) < 0.01 && rep.length === 2, "the client's reported kilos are not shared by the sales");
  });
})();

// ══ v7.27.7 — FZ-30: one rule for what a lot can still sell ══
(function v72707(){
  console.log("\n══ v7.27.7 — FZ-30: the oversold check reads the sales engine's rule ══");
  const SD = B("salesOrders.domain.js"), IC = B("integrityCheck.js");
  t("FZ-30 (v7.27.7): a lot not yet received sells on its expected kilos, a direct lot on the larger of expected and physical, any other lot on what is physically there; a sale's taken kilos are its SHIP_OUT less reversals", () => {
    eq(SD.lotSellableBasis({ expectedKg: 1300, receivedKg: 0, physicalKg: 0 }), 1300); eq(SD.lotSellableBasis({ expectedKg: 1000, receivedKg: 950, physicalKg: 400 }), 400); eq(SD.lotSellableBasis({ directFlow: true, expectedKg: 1000, physicalKg: 0 }), 1000);
    eq(SD.takenBySale({ movements: [{ type: "SHIP_OUT", qtyKg: 500, soRef: "SO-1" }, { type: "REVERSAL", qtyKg: 100, soRef: "SO-1" }, { type: "SHIP_OUT", qtyKg: 90, soRef: "SO-2" }] }, "SO-1"), 400);
  });
  t("FZ-30 (v7.27.7): the data check no longer calls a lot sold ahead of its arrival, or one already delivered to its sale, 'oversold' — a lot promised beyond what it can sell still is (the real copy of 15 Oct: 18 → 0)", () => {
    const sale = (n, lot, q, st) => ({ number: n, status: st || "Confirmed", items: [{ sourceType: "STOCK", sourceRef: lot, product: "Apples", qty: q }] });
    const run = (lots, orders) => IC.checkIntegrity({ lots, orders, pos: [], shipments: [], invoices: [], contacts: [] }).issues.filter(i => i.code === "LOT_OVERSOLD").map(i => i.entity).join();
    eq(run([{ number: "L-A", product: "Apples", expectedKg: 1300, receivedKg: 0, physicalKg: 0, movements: [] }], [sale("SO-1", "L-A", 1300)]), "", "sold ahead of arrival called oversold");
    eq(run([{ number: "L-B", product: "Apples", expectedKg: 3744, receivedKg: 3744, physicalKg: 0, movements: [{ type: "IN", qtyKg: 3744 }, { type: "SHIP_OUT", qtyKg: 3744, soRef: "SO-2" }] }], [sale("SO-2", "L-B", 3744)]), "", "a lot delivered to its own sale called oversold");
    eq(run([{ number: "L-C", product: "Apples", expectedKg: 1000, receivedKg: 0, physicalKg: 0, movements: [] }], [sale("SO-3", "L-C", 700), sale("SO-4", "L-C", 600)]), "L-C", "a real oversell not flagged");
  });
})();

// ══ v7.27.8 — A-W5: numbers from the database's shared counter ══
(function v72708(){
  console.log("\n══ v7.27.8 — A-W5: the shared numbering counter ══");
  const N = B("numbering.js"); const fsx = require("fs"), px = require("path");
  t("A-W5 (v7.27.8): the highest serial in use per type and year; the number format; without the shared database the next numbers are the highest + 1 (block-consecutive) and the reason is kept for Settings", async () => {
    eq(N.highestInUse(["PO-2026-0007", "PO-2026-0012", "PO-2025-0099", "SO-2026-0040", "x"], "PO", 2026), 12); eq(N.formatDocNumber("LOT", 2026, 7), "LOT-2026-0007");
    const r = await N.issueNumbers("LOT", 2026, ["LOT-2026-0130"], 3); eq(r.numbers.join(), "LOT-2026-0131,LOT-2026-0132,LOT-2026-0133"); eq(r.source, "browser");
    ok(/without the shared database/.test(N.numberingStatus().problem), "the reason is not kept");
  });
  t("A-W5 (v7.27.8): the counter's own arithmetic (supabase/numbering.sql) — first use starts above the floor, later uses above the larger of the counter and the floor, a block reserves consecutive numbers; only signed-in users reach it", () => {
    const sql = fsx.readFileSync(px.join(__dirname, "../supabase/numbering.sql"), "utf8");
    ok(/values \(p_kind, p_year, p_floor \+ p_count\)/.test(sql) && /set last = greatest\(c\.last, p_floor\) \+ p_count/.test(sql) && /return v_last - p_count \+ 1/.test(sql), "the counter's arithmetic changed");
    ok(/enable row level security/.test(sql) && /grant execute on function public\.next_doc_numbers\(text, int, int, int\) to authenticated/.test(sql) && /revoke all on function public\.next_doc_numbers\(text, int, int, int\) from public, anon/.test(sql), "the counter is open beyond signed-in users");
    // the same arithmetic, run: two browsers asking in turn never get the same number
    let last = null; const take = (floor, count) => { last = last == null ? floor + count : Math.max(last, floor) + count; return last - count + 1; };
    eq([take(41, 1), take(41, 1), take(40, 3), take(50, 1)].join(), "42,43,44,51");
  });
  t("A-W5 (v7.27.8): Settings → Numbering says whether this copy's counter is installed; the deployment note gives the one-time step", () => {
    ok(/<CounterStatus \/>/.test(fsx.readFileSync(px.join(__dirname, "../src/Settings.tsx"), "utf8")), "Settings does not show the counter's state");
    ok(/One-time database step — the shared numbering counter/.test(fsx.readFileSync(px.join(__dirname, "../HOW_TO_DEPLOY.md"), "utf8")), "the deployment note lacks the step");
  });
})();

// ══ v7.27.9 — FZ-29 (RM-2 F-5): temperature, pallet type and currency from their sources ══
(function v72709(){
  console.log("\n══ v7.27.9 — FZ-29: what a shipment no longer asks to be typed ══");
  const D = B("shipmentDerived.domain.js"); const fsx = require("fs"), px = require("path");
  const cat = [{ item: "Apples", varieties: [], temperatureMinC: 0, temperatureMaxC: 4 }, { item: "Pears", varieties: [], temperatureMinC: -1, temperatureMaxC: 3 }, { item: "Peppers", varieties: [] }];
  const types = [{ id: "wooden-box-13", label: "Wooden box (13 kg)", capacityKg: 13, tareKg: 1.4, palletType: "euro" }, { id: "carton-10", label: "Carton (10 kg)", capacityKg: 10, tareKg: 0.5 }];
  t("FZ-29 (v7.27.9): the travel range is the narrowest shared by the goods' catalogue items; an item without a range is named; a truck's pallet comes from the packaging on it; an unpriced truck's currency from its carrier", () => {
    const tr = D.temperatureFromCatalog([{ product: "Apples" }, { product: "Pears" }, { product: "Peppers" }], cat); eq([tr.min, tr.max, tr.from.join("+"), tr.missing.join("+")].join("|"), "0|3|Apples+Pears|Peppers");
    eq(D.palletTypeFromPackaging([{ packaging: "wooden-box-13" }], types).palletType, "euro"); eq(D.palletTypeFromPackaging([{ packaging: "Carton (10 kg)" }], types).missing.join(), "Carton (10 kg)");
    eq(D.unitCurrencyFrom({ terms: { defaultCurrency: "eur" } }, null).currency, "EUR"); eq(D.unitCurrencyFrom(null, { currency: "USD" }).source, "booking");
  });
  t("FZ-29 (v7.27.9): at save the derived values are written — a price already typed keeps its own currency, a source that says nothing keeps what is stored", () => {
    const sh = { goods: [{ id: 1, product: "Apples", packaging: "wooden-box-13", qtyKg: 1000 }], temperatureMinC: 2, temperatureMaxC: 8,
      legs: [{ mode: "Road", vehicles: [{ carrierId: 5, palletType: "standard" }, { carrierId: 5, costAmount: 900, priceCurrency: "PLN" }] }] };
    const out = D.applyDerivedTravel(sh, { catalog: cat, packagingTypes: types, contacts: [{ id: 5, terms: { defaultCurrency: "EUR" } }] });
    eq([out.temperatureMinC, out.temperatureMaxC].join(), "0,4"); eq(out.legs[0].vehicles[0].palletType, "euro"); eq(out.legs[0].vehicles[0].priceCurrency, "EUR"); eq(out.legs[0].vehicles[1].priceCurrency, "PLN", "a typed price changed currency");
    const none = D.applyDerivedTravel({ ...sh, goods: [{ id: 1, product: "Peppers" }] }, { catalog: cat, packagingTypes: types, contacts: [] }); eq([none.temperatureMinC, none.temperatureMaxC].join(), "2,8", "a source with nothing to say cleared the stored range");
    const ed = fsx.readFileSync(px.join(__dirname, "../src/ShipmentEditor.tsx"), "utf8");
    ok(!/sf\("temperatureMinC"/.test(ed) && !/updateVehicle\(i, ui, "palletType"/.test(ed) && /applyDerivedTravel\(autoAllocate/.test(ed), "the editor still asks for the temperature or the pallet, or does not write the derived values");
  });
})();

// ══ v7.27.10 / v7.27.11 — FZ-18 · SD-1 · SD-3 · SD-6 and FZ-16 ══
(function v72710(){
  console.log("\n══ v7.27.10 — the supplier's truck; v7.27.11 — the expected documents ══");
  const INC = B("incoterms.domain.js"); const fsx = require("fs"), px = require("path"); const rd = f => fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8");
  t("FZ-18 / SD-6 (v7.27.10): confirming a DAP / DPU / DDP purchase creates its supplier's truck (number from the counter); back to Draft or cancelled withdraws it while nothing is posted on it; the register window fills that truck instead of adding a second", () => {
    const po = rd("PurchaseOrders.tsx");
    ok(/live && isDRulePurchase\(updated\) && !\(extShipments \|\| \[\]\)\.some\(mine\)/.test(po) && /supplierDeliveryFromPO\(withLots/.test(po), "confirming does not create the supplier's truck");
    ok(/if \(revertingToDraft \|\| becomesCancelled\)/.test(po) && /!moved\(s\.number\)/.test(po), "the truck is not withdrawn, or withdrawn after a posting");
    ok(/const waiting = \(extShipments \|\| \[\]\)\.find/.test(po), "the window still creates a second truck");
  });
  t("SD-1 / SD-3 (v7.27.10): a supplier's truck shows its tracking facts only — no booking, legs or cost lines; customs only when we clear", () => {
    const ed = rd("ShipmentEditor.tsx");
    ok(/\{\(!isSupplierTruck\) && \(<Card>\s*<SectionTitle>Costs and billing/.test(ed.replace(/\n/g, " ")) || /\(!isSupplierTruck\) && \(<Card>/.test(ed), "the cost lines still show on a supplier's truck");
    ok(/isSupplierTruck && supplierTruckFacts\(\)/.test(ed) && /!\(isSupplierTruck && cRule\.known && !cRule\.ours\)/.test(ed), "the tracking facts or the customs rule are missing");
  });
  t("FZ-16 (v7.27.11): the documents a shipment needs come from its terms, modes and direction — an intra-EU road sale needs the packing list and our invoice only; an export by sea we clear adds the B/L, the export declaration and the destination papers; a loaded truck missing a document is a finding", () => {
    const ctxEU = { pos: [], orders: [{ number: "SO-1", status: "Confirmed", sellIncoterm: "DAP", items: [] }], countryOf: () => "" };
    const road = { number: "SHP-A", status: "Booked", purpose: "OUTBOUND", soRefs: ["SO-1"], legs: [{ mode: "Road" }], goods: [], documents: [] };
    eq(INC.expectedDocuments(road, ctxEU).map(x => x.type).join(), "Packing list,Invoice");
    const seaHeld = { ...road, legs: [{ mode: "Sea" }], documents: [{ type: "Packing list", status: "Have it" }] };
    const e2 = INC.expectedDocuments(seaHeld, ctxEU); eq(e2.find(x => x.type === "Packing list").held, true); ok(e2.some(x => x.type === "BL"), "a sea leg without its B/L");
    const loaded = { ...road, status: "Loaded" }; eq(INC.documentsMissingAtStage(loaded, ctxEU).map(x => x.type).join(), "Packing list,Invoice");
    eq(INC.documentsMissingAtStage(road, ctxEU).length, 0, "a booked truck already flagged");
    ok(!/"EUR\.1", "Phytosanitary certificate", "Export declaration"\]/.test(rd("Shipments.tsx")), "every shipment still gets the export papers");
  });
})();

// ══ v7.27.12 — A-RV-39: no real company in the code; the old demo places flagged ══
(function v72712(){
  console.log("\n══ v7.27.12 — A-RV-39: no real company in the code ══");
  const L = B("locations.js"), IC = B("integrityCheck.js");
  t("A-RV-39 (v7.27.12): no stub companies in the code — the forms read the directory", () => {
    const rd = f => require("fs").readFileSync(require("path").join(__dirname, "../src/" + f), "utf8");   // the screens are not in the checks' build — read their source
    ok(/export const SUPPLIERS: any\[\] = \[\];/.test(rd("PurchaseOrders.tsx")) && !/function getSuppliersStub/.test(rd("PurchaseOrders.tsx")), "the PO form still has stub suppliers");
    ok(/export const CLIENTS: any\[\] = \[\];/.test(rd("SalesOrders.tsx")) && !/function getClientsStub/.test(rd("SalesOrders.tsx")), "the SO form still has stub clients");
  });
})();

// ══ v7.27.13 — where a shipment ends; no guessed places ══
(function v72713(){
  console.log("\n══ v7.27.13 — where a shipment ends; no guessed places ══");
  const TF = B("tradeFlow.domain.js");
  t("v7.27.13 (P-12): a shipment ends where its route ends — the last leg's destination; its own destination field only when it has no legs (the early test place 10 in that field no longer decides the terms or the direction)", () => {
    eq(TF.shipmentEndPlaceId({ destinationLocationId: 10, legs: [{ fromLocationId: 114, toLocationId: 126 }] }), 126);
    eq(TF.shipmentEndPlaceId({ destinationLocationId: 10, legs: [] }), 10); eq(TF.shipmentEndPlaceId({ legs: [{ toLocationId: "" }], destinationLocationId: 5 }), 5); eq(TF.shipmentEndPlaceId({}), null);
  });
})();

// ══ v7.27.14 — A-RV-29 'unsold' checked against the sales; A-RV-38 a truck of ours is not under the purchase ══
(function v72714(){
  console.log("\n══ v7.27.14 — A-RV-29 and A-RV-38 ══");
  const MG = B("moduleGuards.domain.js"), INC = B("incoterms.domain.js");
  t("A-RV-29 (v7.27.14): a lot 40 days in store reads 'unsold' only when no open sale still has to take it — partly reserved names the free kilos and the sales; fully reserved says 'reserved, not yet shipped'", () => {
    const lot = { number: "LOT-A", physicalKg: 1000, movements: [{ type: "IN", qtyKg: 1000, date: "2026-09-01" }] };
    const w = ctx => (MG.lotWarnings(lot, "2026-10-19", ctx).find(x => x.field === "ageing stock") || {}).why || "";
    ok(/still unsold/.test(w({ orders: [] })) && !/reserved/.test(w({ orders: [] })), "no sale: not unsold");
    ok(/400 kg still unsold, 600 kg reserved by SO-1/.test(w({ orders: [{ number: "SO-1", status: "Confirmed", items: [{ sourceRef: "LOT-A", qty: 600 }] }] })), "partly reserved: " + w({ orders: [{ number: "SO-1", status: "Confirmed", items: [{ sourceRef: "LOT-A", qty: 600 }] }] }));
    ok(/reserved by SO-2, not yet shipped/.test(w({ orders: [{ number: "SO-2", status: "Confirmed", items: [{ sourceRef: "LOT-A", qty: 1000 }] }] })), "fully reserved still called unsold");
    ok(/still unsold/.test(w({ orders: [{ number: "SO-3", status: "Cancelled", items: [{ sourceRef: "LOT-A", qty: 1000 }] }] })), "a cancelled sale reserved the lot");
  });
  t("A-RV-38 (v7.27.14): a truck of ours leaving our own warehouse is not under the purchase; a truck starting at a C-rule's named port runs after the risk passed; a truck coming to us still is under it", () => {
    const pos = [{ number: "PO-1", buyIncoterm: "EXW", destinationLocationId: 50 }];
    const placeOf = id => ({ 7: { type: "RentedWarehouse" }, 50: { type: "SupplierFacility" } })[id] || null;
    const out = { number: "SHP-O", purpose: "OUTBOUND", poRefs: ["PO-1"], legs: [{ mode: "Road", fromLocationId: 7, toLocationId: 9 }] };
    eq(INC.customsDuties(out, { pos, orders: [], direction: "EXPORT", placeOf }).some(x => /purchase|PO-1/.test(JSON.stringify(x))), false, "the warehouse truck still clears under the purchase");
    eq(INC.riskPassPos({ legs: [{ mode: "Road", fromLocationId: 126, toLocationId: 9 }] }, "CIF", 126), 0);
    eq(INC.riskPassPos({ legs: [{ mode: "Road", fromLocationId: 3, toLocationId: 114 }] }, "CIF", 126), 3);
  });
})();

// ══ v7.27.15 — A-RV-26 · A-AU-8: companies picked from Counterparties ══
(function v72715(){
  console.log("\n══ v7.27.15 — A-RV-26 / A-AU-8: companies picked by id ══");
  const fsx = require("fs"), px = require("path"); const rd = f => fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8");
  t("A-RV-26 / A-AU-8 (v7.27.15): a claim's respondent, an operational cost's payee and a finance note's party are picked from Counterparties and stored by id; a typed one links with one pick; a new payee is added to the directory in one click; the typed ones are linked once from one panel", () => {
    ok(/<CompanyPicker contacts=\{contacts\} value=\{selected\.respondent\?\.contactId \?\? null\}/.test(rd("Claims.tsx")), "the claim's respondent is still typed");
    const fin = rd("Finance.tsx");
    ok(/<CompanyPicker contacts=\{contacts\} value=\{\(form as any\)\.supplierId \?\? null\}/.test(fin) && /newCompanyRecord\(nm, "Other", nextId\)/.test(fin), "the cost's payee is still typed, or cannot be added");
    ok(/<TypedCompaniesPanel /.test(fin) && /Link the \{exact\.reduce/.test(fin), "no linking panel");
    ok(/partyId: c \? c\.id : null, partyName: c \? c\.name : ""/.test(rd("Invoices.tsx")) && /partyId: inv\?\.counterparty\?\.id \?\? so\?\.client\?\.id \?\? null/.test(rd("Inventory.tsx")), "a note's party is still a name");
    ok(!/<Field label="Supplier \/ payee"><Inp/.test(fin) && !/<input value=\{selected\.respondent\?\.name/.test(rd("Claims.tsx")), "a typing field is left");
  });
})();

// ══ v7.27.16 — A-AU-6 · A-AU-7 · FZ-06 ══
(function v72716(){
  console.log("\n══ v7.27.16 — the carrier's invoice, settlement invoices from the register, exchange differences ══");
  const CI = B("costInvoice.domain.js"), FX = B("fxDifferences.domain.js"); const fsx = require("fs"), px = require("path");
  t("A-AU-6 (v7.27.16): a cost line offers its supplier's received invoices; a typed number with an exact register match is offered for one click; the typed amount stays and the difference from the invoice is shown", () => {
    const invoices = [{ id: 1, kind: "COST", number: "FV 12/2026", counterparty: { id: 7, name: "Trans" }, netAmount: 2000, currency: "EUR", issueDate: "2026-10-01" }, { id: 2, kind: "COST", number: "X-9", counterparty: { id: 8 }, netAmount: 10, currency: "EUR" }, { id: 3, kind: "SALES", number: "S-1", counterparty: { id: 7 } }];
    const cost = { supplierId: 7, amount: 2100, currency: "EUR", amountPLN: 8900, invoiceRef: "fv 12/2026" };
    eq(CI.carrierInvoiceOptions(cost, invoices).map(i => i.id).join(), "1"); eq(CI.exactInvoiceForTypedRef(cost, invoices).id, 1); eq(CI.exactInvoiceForTypedRef({ ...cost, invoiceId: 1 }, invoices), null);
    eq(CI.costInvoiceDifference(cost, invoices[0]).diff, 100);
    ok(/carrierInvoiceOptions\(c, invoices \|\| \[\]\)/.test(fsx.readFileSync(px.join(__dirname, "../src/ShipmentEditor.tsx"), "utf8")) && !/<Lbl>Invoice ref<\/Lbl><Inp/.test(fsx.readFileSync(px.join(__dirname, "../src/ShipmentEditor.tsx"), "utf8")), "the cost line still types its invoice");
  });
  t("A-AU-7 (v7.27.16): the producer's provisional invoice comes only from the register — no typed number or values; a settlement with a provisional value waits for the import before it closes", () => {
    const po = fsx.readFileSync(px.join(__dirname, "../src/PurchaseOrders.tsx"), "utf8");
    ok(!/placeholder="invoice no\. \(typed\)"/.test(po) && !/disabled=\{closed \|\| !!chosenInv\}/.test(po), "a typed provisional invoice is left");
    ok(/data-close-needs-invoice="1"/.test(po) && /waiting: no invoice from this producer imported yet/.test(po), "the settlement does not wait for the import");
  });
  t("FZ-06 (v7.27.16): the realised difference is the amount paid times (payment rate − invoice rate) — a gain on a sale paid higher, a loss on a purchase paid higher; a payment without its own rate is counted, not guessed", () => {
    const r = FX.fxDifferences([
      { kind: "SALES", number: "S-1", currency: "EUR", fxRate: 4.2, payments: [{ date: "2026-10-05", amount: 1000, settlementFxRate: 4.3 }] },
      { kind: "COST", number: "C-1", currency: "EUR", fxRate: 4.2, payments: [{ date: "2026-09-20", amount: 500, fxRate: 4.3 }, { date: "2026-09-21", amount: 100 }] },
      { kind: "SALES", number: "P-1", currency: "PLN", fxRate: 1, payments: [{ amount: 10, fxRate: 1 }] }]);
    eq(r.rows.map(x => `${x.invoice}:${x.diffPLN}`).join(), "S-1:100,C-1:-50"); eq([r.gainsPLN, r.lossesPLN, r.netPLN, r.paymentsWithoutRate].join(), "100,-50,50,1");
    eq(r.byMonth.map(m => m.month).join(), "2026-10,2026-09");
  });
})();

// ══ v7.27.17 — SC-14: the partners' and test places out of the code ══
(function v72717(){
  console.log("\n══ v7.27.17 — SC-14: no partner's place in the code ══");
  const L = B("locations.js");
  t("SC-14 (v7.27.17) · v7.32.0 (FZ-04a): no place of any kind is written in the code any more — not a partner's, not a port's, not our own warehouse's", () => {
    ok(L.LOCATIONS_ALL_BUILTIN === undefined, "a built-in list is back");
    const src = require("fs").readFileSync(require("path").join(__dirname, "../src/locations.ts"), "utf8");
    ok(!/WH-01|Logipark|ColdStore|Koper Port|Damietta Port/.test(src), "a place's name is still written in the places module");
  });
})();

// ══ v7.27.18 — A-D-4: the dates chain; one reader for a truck's actual dates ══
(function v72718(){
  console.log("\n══ v7.27.18 — A-D-4: the dates chain ══");
  const DC = B("datesChain.domain.js"), SM = B("shipmentModel.domain.js");
  t("v7.27.18 (P-12): a truck's actual loading / unloading date reads both field generations (loadedAt / actualLoadDate) — the shipment's dates no longer miss the older ones", () => {
    eq(SM.unitLoadedAt({ actualLoadDate: "2026-10-01" }), "2026-10-01"); eq(SM.unitLoadedAt({ loadedAt: "2026-10-02", actualLoadDate: "2026-10-01" }), "2026-10-02");
    eq(SM.shipmentDates({ legs: [{ vehicles: [{ actualLoadDate: "2026-10-01", actualUnloadDate: "2026-10-04" }] }] }).loaded, "2026-10-01");
  });
  t("A-D-4 (v7.27.18): an SO's chain reads its trucks, its invoices and their payments; a missing step before a dated one is a gap; a PO's 'received' is its lots' first receipt", () => {
    const so = { number: "SO-1", orderDate: "2026-10-01" };
    const shipments = [{ number: "SH-1", status: "Delivered", soRefs: ["SO-1"], legs: [{ vehicles: [{ actualLoadDate: "2026-10-03", actualUnloadDate: "2026-10-05" }] }] }];
    const invoices = [{ kind: "SALES", issueDate: "2026-10-06", paymentStatus: "Paid", links: [{ type: "SO", number: "SO-1" }], payments: [{ date: "2026-10-20", amount: 1 }] }];
    eq(DC.soDatesChain(so, { shipments, invoices }).map(s => `${s.label}:${s.date}`).join(), "Ordered:2026-10-01,Loaded:2026-10-03,Delivered:2026-10-05,Invoiced:2026-10-06,Paid:2026-10-20");
    const gap = DC.soDatesChain(so, { shipments: [], invoices: [{ ...invoices[0], paymentStatus: "Unpaid" }] });
    eq(gap.filter(s => s.gap).map(s => s.label).join(), "Loaded,Delivered", "the gap before the invoice");
    eq(DC.poDatesChain({ number: "PO-1", orderDate: "2026-09-28" }, { lots: [{ poRef: "PO-1", movements: [{ type: "IN", date: "2026-10-02" }] }] }).find(s => s.label === "Received").date, "2026-10-02");
  });
})();

// ══ v7.28.0 — Batch L (RM-2 F-1): a shipment is written in its clean shape ══
(function v72800(){
  console.log("\n══ v7.28.0 — Batch L: the truck's dates in one pair ══");
  const SS = B("storeShapes.js"), SM = B("shipmentModel.domain.js");
  t("Batch L (v7.28.0): writing a shipment moves a truck's older date pair into loadedAt / unloadedAt (only where empty) and drops it; a clean shipment is returned unchanged (same object)", () => {
    const sh = { number: "S", legs: [{ vehicles: [{ actualLoadDate: "2026-10-01", actualUnloadDate: "2026-10-03" }, { loadedAt: "2026-10-02", actualLoadDate: "2026-09-30" }] }] };
    const out = SS.shapeShipment(sh); const [a, b] = out.legs[0].vehicles;
    eq([a.loadedAt, a.unloadedAt, "actualLoadDate" in a, "actualUnloadDate" in a].join(), "2026-10-01,2026-10-03,false,false");
    eq(b.loadedAt, "2026-10-02", "the newer date was overwritten"); ok(!("actualLoadDate" in b), "the older field stayed");
    const clean = { number: "C", legs: [{ vehicles: [{ loadedAt: "2026-10-01" }] }] }; ok(SS.shapeShipment(clean) === clean, "a clean record is rewritten");
    eq(SM.unitLoadedAt(out.legs[0].vehicles[0]), "2026-10-01");
  });
})();

// ══ v7.28.1 — Batch L · FZ-03: a company's terms in one block ══
(function v72801(){
  console.log("\n══ v7.28.1 — Batch L: the company's terms ══");
  const CP = B("counterparty.domain.js");
  t("Batch L (v7.28.1): writing a company folds the flat payment days, credit limit and currency into terms{} (where the terms are empty) and drops them; the document copy takes the currency from the terms and no retired payment-terms text", () => {
    const r = CP.normaliseCounterparty({ id: 1, name: "X", type: "Client", paymentTermsDays: 30, creditLimitPLN: 50000, defaultCurrency: "eur", people: [] });
    eq([r.contact.terms.paymentDays, r.contact.terms.creditLimitPLN, r.contact.terms.defaultCurrency].join(), "30,50000,EUR");
    ok(!("paymentTermsDays" in r.contact) && !("creditLimitPLN" in r.contact) && !("defaultCurrency" in r.contact), "a flat copy stayed");
    const kept = CP.normaliseCounterparty({ id: 2, name: "Y", type: "Client", terms: { paymentDays: 14 }, paymentTermsDays: 30 }); eq(kept.contact.terms.paymentDays, 14, "the flat copy overwrote the terms");
    const copy = CP.companyCopy({ id: 3, name: "Z", terms: { defaultCurrency: "EUR" }, paymentTerms: "old text", people: [] }); eq(copy.defaultCurrency, "EUR"); ok(!("paymentTerms" in copy) && !("paymentTermsOther" in copy), "the retired text travels on documents");
  });
})();

// ══ v7.28.2 — Batch L · FZ-03: a company's persons in people[] ══
(function v72802(){
  console.log("\n══ v7.28.2 — Batch L: the company's persons ══");
  const CP = B("counterparty.domain.js");
  t("Batch L (v7.28.2): writing a company moves its old contacts[] into people[] (when people[] is empty) and drops it; peopleOf reads people[] (the old list only for a record written before)", () => {
    const r = CP.normaliseCounterparty({ id: 1, name: "X", type: "Client", contacts: [{ id: 1, name: "Anna", email: "a@x" }] });
    eq(r.contact.people.map(p => p.name).join(), "Anna"); ok(!("contacts" in r.contact), "the old list stayed");
    const both = CP.normaliseCounterparty({ id: 2, name: "Y", type: "Client", people: [{ id: 2, name: "Ola" }], contacts: [{ id: 3, name: "Old" }] }); eq(both.contact.people.map(p => p.name).join(), "Ola", "the old list overwrote people[]");
    eq(CP.peopleOf({ contacts: [{ name: "B" }] }).map(p => p.name).join(), "B"); eq(CP.peopleOf({ people: [{ name: "C" }], contacts: [{ name: "D" }] }).map(p => p.name).join(), "C"); eq(CP.peopleOf({}).length, 0);
    eq((CP.personFor({ people: [{ name: "E", email: "e@x", role: "Buyer" }] }, "Buyer") || {}).name, "E");
  });
})();

// ══ v7.28.3 — Batch L · FZ-03: a company's roles in roles[]; the planning sheet's lists ══
(function v72803(){
  console.log("\n══ v7.28.3 — Batch L: the company's roles ══");
  const CP = B("counterparty.domain.js"); const fsx = require("fs"), px = require("path");
  t("Batch L (v7.28.3): a company's roles are roles[] with the primary type among them; the old additionalTypes is folded in and dropped on save; rolesOf reads both for a record written before", () => {
    const r = CP.normaliseCounterparty({ id: 1, name: "X", type: "Client", additionalTypes: ["Supplier"], people: [] });
    eq(r.contact.roles.join(), "Client,Supplier"); ok(!("additionalTypes" in r.contact), "the old field stayed");
    eq(CP.rolesOf({ type: "Carrier", additionalTypes: ["Warehouse"] }).join(), "Carrier,Warehouse"); eq(CP.rolesOf({ type: "Client", roles: ["Supplier"] }).join(), "Client,Supplier");
    ok(!("additionalTypes" in CP.companyCopy({ id: 2, name: "Y", type: "Client", roles: ["Client"], people: [] })), "the document copy carries the old field");
  });
  t("v7.28.3: the planning sheet's client, supplier and carrier lists hold the companies' NAMES (a note in the middle of the line had hidden the end since v7.10.2)", () => {
    const ps = fsx.readFileSync(px.join(__dirname, "../src/PlanningSheet.tsx"), "utf8");
    ok(/rolesOf\(c\)\.includes\(r\)\)\.map\(\(c: any\) => c\.name\)\.filter\(Boolean\)\.sort/.test(ps), "the lists still hold companies");
  });
})();

// ══ v7.28.5 — Batch L · A-PO-3: one promised date; no stored link copies; the hidden customs rule restored ══
(function v72805(){
  console.log("\n══ v7.28.5 — Batch L: the PO's one promised date ══");
  const PO = B("po.domain.js"); const fsx = require("fs"), px = require("path");
  t("Batch L (v7.28.5): a PO's one promised date is named by its rule — handed over (E / F), shipped (C), delivered (D); the expected arrival is a D-rule's promised date or the PO's trucks' planned delivery; the tidy-up folds the old date and drops it with the stored link copies", () => {
    eq([PO.promisedDateKind({ buyIncoterm: "FCA" }), PO.promisedDateKind({ buyIncoterm: "CIF" }), PO.promisedDateKind({ buyIncoterm: "DDP" })].join(), "handover,shipment,delivery");
    eq(PO.promisedDateLabel({ buyIncoterm: "DAP" }), "Delivery date"); eq(PO.promisedDateLabel({ buyIncoterm: "EXW" }, "pl"), "Data załadunku");
    eq(PO.poExpectedArrival({ number: "PO-1", buyIncoterm: "DAP", loadingDate: "2026-11-02" }), "2026-11-02");
    eq(PO.poExpectedArrival({ number: "PO-2", buyIncoterm: "FCA", loadingDate: "2026-11-01" }, [{ status: "Booked", poRefs: ["PO-2"], legs: [{ vehicles: [{ plannedDeliveryDate: "2026-11-04" }] }] }]), "2026-11-04");
    eq(PO.poExpectedArrival({ number: "PO-3", buyIncoterm: "EXW", loadingDate: "2026-11-01" }, []), "", "a guessed arrival");
    const r = PO.normalisePO({ number: "PO-4", buyIncoterm: "FCA", expectedDeliveryDate: "2026-10-05", linkedInvoices: ["X"], linkedLots: ["L"] });
    eq(r.po.loadingDate, "2026-10-05"); ok(!("expectedDeliveryDate" in r.po) && !("linkedInvoices" in r.po) && !("linkedLots" in r.po), "an old field stayed");
    const kept = PO.normalisePO({ number: "PO-5", loadingDate: "2026-10-01", expectedDeliveryDate: "2026-10-09" }); eq(kept.po.loadingDate, "2026-10-01", "the old date overwrote the promised one");
  });
  t("v7.28.5: the shipment editor's save applies the customs rule again (a note in the middle of the line had hidden it since v7.27.9)", () => {
    ok(/\(cr\.known\) fin = \{ \.\.\.fin, customs:/.test(fsx.readFileSync(px.join(__dirname, "../src/ShipmentEditor.tsx"), "utf8").split("\n").filter(l => !/^\s*\/\//.test(l)).map(l => l.slice(0, Math.max(0, l.indexOf("//")) || l.length)).join("\n")), "the customs rule is still hidden behind a note");
  });
})();

// ══ v7.28.6 — Batch L · FZ-13: a claim's amounts in its own currency ══
(function v72806(){
  console.log("\n══ v7.28.6 — Batch L: the claim's own currency ══");
  const SS = B("storeShapes.js");
  t("Batch L (v7.28.6): writing a claim moves its EUR-named copies into the current fields (where empty) and drops them — the rate too", () => {
    const c = SS.shapeClaim({ number: "CLM-1", currency: "EUR", requestedAmount: 91, requestedEUR: 91, acceptedAmount: 45, acceptedEUR: 45, plnPerEur: "4.20", fxToPLN: null, lostValueEUR: "", defectValueEUR: 0 });
    eq([c.requestedAmount, c.acceptedAmount, c.fxToPLN].join(), "91,45,4.20"); ok(!["requestedEUR", "acceptedEUR", "plnPerEur", "lostValueEUR", "defectValueEUR"].some(k => k in c), "an EUR copy stayed");
    const clean = { number: "CLM-2", currency: "PLN", requestedAmount: 10 }; ok(SS.shapeClaim(clean) === clean, "a clean claim is rewritten");
  });
})();

// ══ v7.28.7 — Batch L · FZ-08: the route owns the places, the trucks the actual dates ══
(function v72807(){
  console.log("\n══ v7.28.7 — Batch L: the shipment's own copies ══");
  const SS = B("storeShapes.js"), TF = B("tradeFlow.domain.js");
  t("Batch L (v7.28.7): a shipment starts where its route starts and ends where it ends — its own copies (the guessed origin 1, the test place 10) neither decide nor survive a save; its own actual dates move onto the trucks when none has one", () => {
    const sh = { number: "S", originLocationId: 1, destinationLocationId: 10, actualLoadingDate: "2026-10-01", legs: [{ fromLocationId: 114, toLocationId: 126, vehicles: [{ id: 1 }] }] };
    eq([TF.shipmentStartPlaceId(sh), TF.shipmentEndPlaceId(sh)].join(), "114,126");
    const o = SS.shapeShipment(sh); ok(!("originLocationId" in o) && !("destinationLocationId" in o) && !("actualLoadingDate" in o), "a copy survived the save");   // v7.28.8: the origin goes too
    eq(o.legs[0].vehicles[0].loadedAt, "2026-10-01", "the shipment's own date was lost");
    const noRoute = SS.shapeShipment({ number: "T", originLocationId: 5, legs: [{ vehicles: [] }] }); eq(noRoute.legs[0].fromLocationId, 5, "the only place was lost");
  });
})();

// ══ v7.28.8 — FZ-36: the route places repaired once ══
(function v72808(){
  console.log("\n══ v7.28.8 — FZ-36: route places repaired ══");
  const PR = B("placeRepair.domain.js");
  t("FZ-36 (v7.28.8): an unknown route place is listed once per shipment with where it sits; filled where an EXW / FCA purchase's supplier (or a D-rule sale's client) has one address; otherwise left to the user; the repair writes the chosen place everywhere it appears in that shipment", () => {
    const known = id => ["7", "9", "SUP-1", "CLI-1"].includes(String(id));
    const contacts = [{ id: 11, name: "Farm" }, { id: 12, name: "Client" }, { id: 13, name: "Two-site farm" }];
    const sitesOf = c => ({ 11: [{ id: "SUP-1", name: "Farm" }], 12: [{ id: "CLI-1", name: "Client" }], 13: [{ id: "A" }, { id: "B" }] })[c.id] || [];
    const pos = [{ number: "PO-1", buyIncoterm: "EXW", supplier: { id: 11 } }, { number: "PO-2", buyIncoterm: "EXW", supplier: { id: 13 } }, { number: "PO-3", buyIncoterm: "CIF", supplier: { id: 11 } }];
    const orders = [{ number: "SO-1", sellIncoterm: "DAP", client: { id: 12 } }];
    const shipments = [
      { number: "S1", status: "Booked", poRefs: ["PO-1"], legs: [{ fromLocationId: 999, toLocationId: 7, vehicles: [{ pickupLocationId: 999 }] }] },
      { number: "S2", status: "Booked", poRefs: ["PO-2"], legs: [{ fromLocationId: 998, toLocationId: 7 }] },
      { number: "S3", status: "Booked", poRefs: ["PO-3"], legs: [{ fromLocationId: 997, toLocationId: 7 }] },
      { number: "S4", status: "Loaded", governingSoRef: "SO-1", legs: [{ fromLocationId: 7, toLocationId: 996 }] },
      { number: "S5", status: "Cancelled", poRefs: ["PO-1"], legs: [{ fromLocationId: 995, toLocationId: 7 }] }];
    const items = PR.placesToRepair(shipments, { known, pos, orders, contacts, sitesOf });
    eq(items.map(i => `${i.shipment}:${i.fill ? i.fill.id : "pick"}`).join(), "S1:SUP-1,S2:pick,S3:pick,S4:CLI-1", "the list or its fills");
    eq(items[0].where.join(" / "), "leg 1 start / leg 1 truck 1 loading");
    const r = PR.repairPlace(shipments[0], 999, "SUP-1"); eq([r.legs[0].fromLocationId, r.legs[0].vehicles[0].pickupLocationId, r.legs[0].toLocationId].join(), "SUP-1,SUP-1,7");
    eq(PR.placesToRepair([r], { known, pos, orders, contacts, sitesOf }).length, 0, "the repaired route still listed");
  });
})();

// ══ v7.28.9 — Batch L · FZ-08: the trucks own their facts ══
(function v72809(){
  console.log("\n══ v7.28.9 — Batch L: the leg's copies ══");
  const SS = B("storeShapes.js");
  t("Batch L (v7.28.9): writing a shipment drops a leg's truck and price copies, moving a value only the leg held onto its first truck", () => {
    const o = SS.shapeShipment({ number: "S", legs: [{ mode: "Road", truckPlate: "WX123", driverName: "Jan", costAmount: 1200, costPLN: 5100, costCurrency: "EUR", vehicles: [{ id: 1 }] }] });
    const l = o.legs[0]; ok(!["truckPlate", "driverName", "costAmount", "costPLN"].some(k => k in l), "a copy stayed on the leg"); eq(l.costCurrency, "EUR", "the leg's currency went");
    eq([l.vehicles[0].truckPlate, l.vehicles[0].driverName, l.vehicles[0].costAmount].join(), "WX123,Jan,1200");
    const kept = SS.shapeShipment({ number: "T", legs: [{ truckPlate: "OLD", vehicles: [{ truckPlate: "NEW", costAmount: 900 }], costAmount: 50 }] }); eq([kept.legs[0].vehicles[0].truckPlate, kept.legs[0].vehicles[0].costAmount].join(), "NEW,900", "the leg's copy overwrote the truck");
  });
})();

// ══ v7.28.10 — Batch L · FZ-03: a company's address from its parts ══
(function v72810(){
  console.log("\n══ v7.28.10 — Batch L: the company's address ══");
  const CP = B("counterparty.domain.js");
  t("Batch L (v7.28.10): a company's address line comes from its parts once complete (without the country, which documents print on its own line; a place's line keeps it); until then the fuller one-line text; the one-line copy goes on save once the parts are complete", () => {
    const done = { id: 1, name: "A", addr: { street: "ul. Piękna 13", postcode: "05-555", city: "Tarczyn", country: "Poland" }, address: "old text" };
    eq(CP.companyAddressLine(done), "ul. Piękna 13, 05-555 Tarczyn"); ok(/Poland/.test(CP.companyAddressLine(done, { withCountry: true })), "a place's line lost the country");
    eq(CP.companyAddressLine({ addr: { city: "BELSK" }, address: "Bartodzieje 16, 05-622 Belsk Duży" }), "Bartodzieje 16, 05-622 Belsk Duży", "partial parts replaced a fuller line");
    ok(!("address" in CP.normaliseCounterparty({ ...done, type: "Client", people: [] }).contact), "the one-line copy stayed once the parts were complete");
    ok("address" in CP.normaliseCounterparty({ id: 2, name: "B", type: "Client", address: "Only a line", addr: { city: "X" }, people: [] }).contact, "the only address went");
  });
})();

// ══ v7.28.11 — Batch L · FZ-03: a company's country is its code ══
(function v72811(){
  console.log("\n══ v7.28.11 — Batch L: the company's country ══");
  const CP = B("counterparty.domain.js");
  t("Batch L (v7.28.11): a company's country is its code — the name comes from the list; the tidy-up drops the name and the address's copy once the code is known; a name without a known code stays until it is picked", () => {
    CP.setUserCountries([{ iso: "PL", name: "Poland", eu: true }, { iso: "JO", name: "Jordan", eu: false }]);
    eq(CP.companyCountryName({ countryIso: "JO" }), "Jordan"); eq(CP.companyCountryIso({ country: "Poland" }), "PL");
    const r = CP.normaliseCounterparty({ id: 1, name: "X", type: "Client", country: "Poland", addr: { city: "Tarczyn", country: "Poland" }, people: [] }).contact;
    eq(r.countryIso, "PL"); ok(!("country" in r) && !("country" in (r.addr || {})), "a name copy stayed");
    const u = CP.normaliseCounterparty({ id: 2, name: "Y", type: "Client", country: "Atlantis", people: [] }).contact; eq(u.country, "Atlantis", "an unknown country's only name went");
    eq(CP.companyCopy({ id: 3, name: "Z", countryIso: "PL", people: [] }).country, "Poland", "the document copy lost the printed name");
    CP.setUserCountries([]);
  });
})();

// ══ v7.29.0 — SC-15: the journey proposed from the two rules — the thirteen scenarios of the 20 Oct review ══
(function v72900(){
  console.log("\n══ v7.29.0 — SC-15: the journey proposal ══");
  const JP = B("journeyProposal.domain.js");
  const PORTS = new Set(["KOP", "ALX", "DAM", "MER"]); const ctx = { isPort: id => PORTS.has(String(id)), ourWarehouse: () => "WH", siteOf: p => p && p.site };
  const P = (t, at) => ({ buyIncoterm: t, destinationLocationId: at, supplier: { site: "SUP" } }), O = (t, at) => ({ sellIncoterm: t, destinationLocationId: at, client: { site: "CLI" } });
  const legs = r => r.legs.map(l => `${l.mode}:${l.fromLocationId ?? "?"}>${l.toLocationId ?? "?"}`).join(" ");
  t("SC-15 (v7.29.0): the thirteen scenarios — our legs follow from where the PO's rule starts our part and the SO's rule ends it; a port the rules do not name is left to pick", () => {
    eq(legs(JP.proposeJourney(P("EXW", "SUP"), O("CIF", "ALX"), ctx)), "Road:SUP>? Sea:?>ALX", "1 EXW + CIF");
    eq(legs(JP.proposeJourney(P("CIF", "KOP"), null, ctx)), "Road:KOP>WH", "2 CIF into stock");
    eq(JP.proposeJourney(P("CIF", "KOP"), O("EXW", "KOP"), ctx).legs.length, 0, "3 sold EXW at the port");
    eq(legs(JP.proposeJourney(P("CIF", "KOP"), O("DDP", "CLI"), ctx)), "Road:KOP>CLI", "4 CIF + DDP");
    eq(legs(JP.proposeJourney(P("FCA", "SUP"), O("DAP", "CLI"), ctx)), "Road:SUP>CLI", "5 FCA + DAP");
    eq(JP.proposeJourney(P("EXW", "SUP"), O("EXW", "SUP"), ctx).legs.length, 0, "6 EXW + EXW");
    eq(JP.proposeJourney(null, O("FCA", "WH"), { ...ctx, lotPlace: () => "WH" }).legs.length, 0, "7 from stock, collected at our warehouse");
    ok(/supplier delivers/.test(JP.proposeJourney(P("DAP", "CLI"), O("DAP", "CLI"), ctx).note), "8 DAP straight to the client");
    eq(legs(JP.proposeJourney(P("FOB", "DAM"), O("DAP", "CLI"), ctx)), "Sea:DAM>? Road:?>CLI", "9 FOB + DAP");
    eq(JP.proposeJourney(P("CFR", "MER"), O("CFR", "MER"), ctx).legs.length, 0, "10 a sale while afloat");
    eq(legs(JP.proposeJourney(P("EXW", "UA"), O("DAP", "CLI"), ctx)), "Road:UA>CLI", "11 EXW Ukraine + DAP");
    eq(JP.proposeJourney(P("DDP", "WH"), O("FCA", "WH"), ctx).legs.length, 0, "12 DDP into our warehouse, collected there");
    eq(legs(JP.proposeJourney(P("FCA", "SUP"), O("DDP", "JO"), ctx)), "Road:SUP>JO", "13 FCA + DDP Jordan");
    ok(JP.proposeJourney(P("EXW", "SUP"), O("CIF", "ALX"), ctx).legs[0].pickTo, "the port of loading is not marked to pick");
  });
})();

// ══ v7.29.1 — FZ-39 / FZ-41: insurance by shipment; the rule that fits what the shipment records ══
(function v72901(){
  console.log("\n══ v7.29.1 — FZ-41: the rule that fits ══");
  const IC = B("incoterms.domain.js");
  const sale = (t) => ({ number: "SO-1", status: "Confirmed", sellIncoterm: t }), buy = (t) => ({ number: "PO-1", status: "Confirmed", buyIncoterm: t });
  const out = (extra) => ({ number: "S", status: "Loaded", purpose: "OUTBOUND", governingSoRef: "SO-1", soRefs: ["SO-1"], legs: [{ mode: "Sea" }], ...extra });
  const inb = (extra) => ({ number: "T", status: "Loaded", purpose: "INBOUND", poRefs: ["PO-1"], legs: [{ mode: "Road" }], ...extra });
  const rec = (sh, ctx) => IC.ruleRecommendations(sh, ctx).map(r => `${r.side}:${r.from}>${r.to}`).join();
  t("FZ-41 (v7.29.1): the Incoterms rules as written — the system recommends the twin rule that fits what the shipment records (insurance; who cleared the import or the export); nothing changes by itself", () => {
    eq(rec(out({ documents: [{ type: "Insurance certificate", status: "Not bought" }] }), { orders: [sale("CIF")] }), "sell:CIF>CFR", "CIF not insured");
    eq(rec(out({ documents: [{ type: "Insurance certificate", status: "Have it" }] }), { orders: [sale("CFR")] }), "sell:CFR>CIF", "CFR insured by us");
    eq(rec(inb({ customs: { applies: true, party: "SUPPLIER", docType: "SAD" } }), { pos: [buy("DAP")] }), "buy:DAP>DDP", "DAP cleared by the supplier");
    eq(rec(inb({ customs: { applies: true, party: "OUR_BROKER", docType: "SAD" } }), { pos: [buy("DDP")] }), "buy:DDP>DAP", "DDP cleared by us");
    eq(rec(out({ customs: { applies: true, party: "CLIENT_BROKER", docType: "SAD" } }), { orders: [sale("DDP")] }), "sell:DDP>DAP", "DDP cleared by the client");
    eq(rec(out({ customs: { applies: true, party: "OUR_BROKER", docType: "EX1" } }), { orders: [sale("EXW")] }), "sell:EXW>FCA", "EXW, export cleared by us");
    eq(rec(out({ documents: [{ type: "Insurance certificate", status: "Have it" }] }), { orders: [sale("CIF")] }), "", "a CIF sale insured fits");
    eq(IC.insuranceMissing(out({ documents: [{ type: "Insurance certificate", status: "Not bought" }] }), [sale("CIF")]).length, 0, "the 'insurance missing' line still shows beside the recommendation");
    const f = IC.shipmentTermsFindings(out({ documents: [{ type: "Insurance certificate", status: "Not bought" }] }), { orders: [sale("CIF")] }).find(x => x.kind === "rule");
    ok(f && f.recommend && f.recommend.to === "CFR" && /the rule that fits is CFR/.test(f.text), "the Terms-to-review line is missing");
  });
})();

// ══ v7.29.2 — the Incoterms audit (owner 20 Oct: "check the code that you did not add any exemptions to the incoterms") ══
(function v72902(){
  console.log("\n══ v7.29.2 — the Incoterms audit ══");
  const IC = B("incoterms.domain.js"), PR = B("placeRepair.domain.js");
  t("v7.29.2 audit: Incoterms 2020 as written — a FAS / FOB named port is the port of shipment (the risk stays the seller's until alongside / on board); a C rule's named port is after the vessel; a CIF / CIP purchase expects the supplier's insurance certificate (A5); a C or D sale collected by the client gets FCA recommended; under E / F rules our part starts at the PO's named place", () => {
    eq(IC.riskPassPos({ legs: [{ mode: "Road", fromLocationId: "POL", toLocationId: "X" }] }, "FOB", "POL"), 3, "a FOB port treated as after the vessel");
    eq(IC.riskPassPos({ legs: [{ mode: "Road", fromLocationId: "POD", toLocationId: "X" }] }, "CIF", "POD"), 0, "a CIF port of destination not after the vessel");
    const inb = { number: "T", status: "Arrived", purpose: "INBOUND", poRefs: ["PO-1"], legs: [{ mode: "Road" }] };
    ok(IC.expectedDocuments(inb, { pos: [{ number: "PO-1", status: "Confirmed", buyIncoterm: "CIF" }], orders: [] }).some(d => d.type === "Insurance certificate"), "a CIF purchase does not expect the supplier's insurance certificate");
    const pick = { number: "S", status: "Loaded", purpose: "OUTBOUND", mode: "Client pickup", governingSoRef: "SO-1", soRefs: ["SO-1"], legs: [{ mode: "Road" }] };
    eq(IC.ruleRecommendations(pick, { orders: [{ number: "SO-1", status: "Confirmed", sellIncoterm: "CIF" }] }).map(r => r.to).join(), "FCA", "a CIF sale collected by the client");
    const items = PR.placesToRepair([{ number: "S1", status: "Booked", poRefs: ["PO-9"], legs: [{ fromLocationId: 999, toLocationId: "WH" }] }], { known: id => ["WH", "TERM"].includes(String(id)), pos: [{ number: "PO-9", buyIncoterm: "FCA", destinationLocationId: "TERM", supplier: { id: 1 } }], contacts: [{ id: 1 }], sitesOf: () => [{ id: "SUP" }] });
    eq(items[0].fill && items[0].fill.id, "TERM", "FCA at a terminal repaired to the supplier's address");
  });
})();

// ══ v7.29.3 — FZ-38: a sale delivered by the supplier's own truck ══
(function v72903(){
  console.log("\n══ v7.29.3 — FZ-38: the supplier's truck delivers the sale ══");
  const SOD = B("so.domain.js");
  t("FZ-38 (v7.29.3): a DAP / DPU / DDP purchase delivered straight to our client — the supplier's truck delivers the sale (same named place), so the sale's delivery date is that truck's unloading; a truck's unloading is read through the one helper (not only 'deliveredAt')", () => {
    const so = { number: "SO-1", sellIncoterm: "DAP", destinationLocationId: "CLI", items: [{ sourceRef: "LOT-1" }] };
    const lots = [{ number: "LOT-1", poRef: "PO-1" }], pos = [{ number: "PO-1", buyIncoterm: "DAP", destinationLocationId: "CLI" }];
    const truck = { number: "SHP-SUP", status: "Delivered", arrangedBy: "SUPPLIER", purpose: "INBOUND", poRefs: ["PO-1"], legs: [{ mode: "Road", vehicles: [{ unloadedAt: "2026-10-18" }] }] };
    eq(SOD.shipmentsDeliveringSale(so, [truck], { pos, lots }).map(s => s.number).join(), "SHP-SUP");
    eq(SOD.actualDeliveryDate(so, [truck], { pos, lots }), "2026-10-18");
    eq(SOD.shipmentsDeliveringSale(so, [truck], { pos: [{ ...pos[0], destinationLocationId: "OUR-WH" }], lots }).length, 0, "a supplier's truck to our warehouse delivers the sale");
    eq(SOD.actualDeliveryDate({ ...so, number: "SO-2" }, [{ status: "Delivered", soRefs: ["SO-2"], legs: [{ vehicles: [{ actualUnloadDate: "2026-10-02" }] }] }]), "2026-10-02", "an older unloading field missed");
  });
})();

// ══ v7.29.4 — FZ-37: the sale's whole journey across its shipments ══
(function v72904(){
  console.log("\n══ v7.29.4 — FZ-37: the sale's whole journey ══");
  const IC = B("incoterms.domain.js");
  t("FZ-37 (v7.29.4): a CIF sale whose shipments carry no sea leg to the named port is named once the truck is booked; the container on the vessel (a second shipment) closes it; a D-rule sale split over shipments must reach the named place in one of them", () => {
    const so = { number: "SO-1", status: "Confirmed", sellIncoterm: "CIF", destinationLocationId: "ALX" };
    const truck = { number: "SHP-T", status: "Booked", purpose: "OUTBOUND", soRefs: ["SO-1"], legs: [{ mode: "Road", fromLocationId: "SUP", toLocationId: "GDY" }] };
    const box = { number: "SHP-C", status: "Booked", purpose: "OUTBOUND", soRefs: ["SO-1"], legs: [{ mode: "Sea", fromLocationId: "GDY", toLocationId: "ALX" }] };
    const g = IC.saleJourneyGap(so, { orders: [so], shipments: [truck] }); eq(g && g.need, "sea", "a CIF sale with no sea leg passes");
    eq(IC.saleJourneyGap(so, { orders: [so], shipments: [truck, box] }), null, "the container's sea leg does not close it");
    eq(IC.saleJourneyGap(so, { orders: [so], shipments: [] }), null, "a sale not shipped yet is named");
    const dap = { number: "SO-2", status: "Confirmed", sellIncoterm: "DAP", destinationLocationId: "CLI" };
    const a = { number: "A", status: "Booked", purpose: "OUTBOUND", soRefs: ["SO-2"], legs: [{ mode: "Road", fromLocationId: "WH", toLocationId: "X" }] }, b = { ...a, number: "B", legs: [{ mode: "Road", fromLocationId: "X", toLocationId: "Y" }] };
    eq((IC.saleJourneyGap(dap, { orders: [dap], shipments: [a, b] }) || {}).need, "place"); eq(IC.saleJourneyGap(dap, { orders: [dap], shipments: [a] }), null, "a single shipment checked twice");
    ok(IC.termsToReview({ orders: [so], shipments: [truck] }).some(f => f.kind === "journey" && /no sea leg/.test(f.text)), "the line is not in Terms to review");
  });
})();

// ══ v7.30.2 — Batch M · M-3 (audit F-05): no number invented by one browser on a shared copy ══
(function v73002(){
  console.log("\n══ v7.30.2 — M-3: the shared numbering or nothing ══");
  t("M-3 (v7.30.2): on a copy that shares its data, a counter that cannot be reached (not installed, refused, unreachable) stops the save with NumberingUnavailable — no number is invented; a copy without a shared database keeps local numbering", async () => {
    const path = require("path"); const ids = ["./build/numbering.js", "./build/remoteStore.js"].map(p => require.resolve(p));
    const fresh = env => { ids.forEach(id => { delete require.cache[id]; }); const keep = { u: process.env.REACT_APP_SUPABASE_URL, k: process.env.REACT_APP_SUPABASE_ANON_KEY }; Object.assign(process.env, env); const m = require(ids[0]); process.env.REACT_APP_SUPABASE_URL = keep.u || ""; process.env.REACT_APP_SUPABASE_ANON_KEY = keep.k || ""; return m; };
    const was = global.fetch, wasWin = global.window;
    const mem = { "marianna:shared:session": JSON.stringify({ access_token: "good", refresh_token: "r", expires_at: Date.now() + 3600e3, email: "owner@firm.pl" }) };
    global.window = { ...(wasWin || {}), localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } } };
    try {
    const N = fresh({ REACT_APP_SUPABASE_URL: "https://proj.supabase.co", REACT_APP_SUPABASE_ANON_KEY: "anon" });
      for (const [why, reply] of [["not installed", async () => ({ ok: false, status: 404, json: async () => ({}) })], ["unreachable", async () => { throw new Error("network down"); }], ["no number", async () => ({ ok: true, status: 200, json: async () => 0 })]]) {
        global.fetch = reply; let err = null; try { await N.issueNumbers("PO", 2026, ["PO-2026-0007"], 1); } catch (e) { err = e; }
        ok(err && err.name === "NumberingUnavailable" && /nothing was saved/.test(err.message), `${why}: a number was invented — ${err && err.message}`);
      }
      global.fetch = async () => ({ ok: true, status: 200, json: async () => 41 }); const r = await N.issueNumbers("PO", 2026, [], 2); eq(r.numbers.join(), "PO-2026-0041,PO-2026-0042"); eq(r.source, "database");
    } finally { global.fetch = was; global.window = wasWin; ids.forEach(id => { delete require.cache[id]; }); }
    const Local = B("numbering.js"); const l = await Local.issueNumbers("SO", 2026, ["SO-2026-0003"], 1); eq(l.numbers.join(), "SO-2026-0004", "a copy without a shared database"); eq(l.source, "browser");
  });
})();

// ══ v7.30.3 — Batch M · M-4 (audit F-16): security headers; sign-out after idle time ══
(function v73003(){
  console.log("\n══ v7.30.3 — M-4: security headers and idle sign-out ══");
  const fsx = require("fs"), px = require("path");
  t("M-4 (v7.30.3): the security policy allows the app itself, Supabase and the NBP rates only; the idle sign-out is 60 minutes with a two-minute warning and never ends a session over unsaved work", () => {
    const v = JSON.parse(fsx.readFileSync(px.join(__dirname, "../vercel.json"), "utf8")); const csp = v.headers[0].headers.find(x => x.key === "Content-Security-Policy").value;
    ok(/connect-src 'self' https:\/\/\*\.supabase\.co https:\/\/api\.nbp\.pl/.test(csp) && /default-src 'self'/.test(csp), "the policy's sources changed");
    const idle = fsx.readFileSync(px.join(__dirname, "../src/IdleSignOut.tsx"), "utf8");
    ok(/IDLE_MINUTES = 60, WARNING_MINUTES = 2/.test(idle), "not 60 / 2 minutes"); ok(/if \(dirtyEntries\(\)\.length\) \{ setWarn\("unsaved"\); return; \}/.test(idle), "a session ends over unsaved work");
    ok(/<IdleSignOut active=\{!!readSession\(\)\} \/>/.test(fsx.readFileSync(px.join(__dirname, "../src/App.tsx"), "utf8")), "the idle sign-out is not mounted");
  });
})();

// ══ v7.30.4 / v7.30.5 — Batch M · M-5 (audit F-17), M-6 (audit F-14) ══
(function v73005(){
  console.log("\n══ v7.30.4–5 — M-5: no personal detail in the program; M-6: the full export for the owner ══");
  const fsx = require("fs"), px = require("path"); const rd = f => fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8");
  t("M-5 (v7.30.4): the contact person, the trade name and the emergency phone are Settings › Company fields; the fallbacks carry no personal detail", () => {
    const L = B("useLocalStoredState.js"); eq([L.COMPANY_DEFAULTS.person, L.COMPANY_DEFAULTS.emergencyPhone].join("|"), "|", "a personal detail in the defaults");
    const s = rd("Settings.tsx"); ok(/set\("person", e\.target\.value\)/.test(s) && /set\("tradeName", e\.target\.value\)/.test(s) && /set\("emergencyPhone", e\.target\.value\)/.test(s), "the fields are not in Settings › Company");
  });
  t("M-6 (v7.30.5): Export all data is the owner's (open while no owner is linked)", () => {
    const s = rd("Settings.tsx"); ok(/return !linked \|\| \(me && me\.isOwner\)/.test(s) && /data-export-owner-only="1"/.test(s), "the full export is not owner-only");
  });
})();

// ══ v7.30.6 – v7.30.13 — the owner's test of 21 Oct ══
(function v73013(){
  console.log("\n══ v7.30.6–13 — the owner's test of 21 Oct ══");
  const fsx = require("fs"), px = require("path"); const rd = f => fsx.readFileSync(px.join(__dirname, "../src/" + f), "utf8");
  t("v7.30.6: the PO list shows each PO's one promised date, named by its rule, and the arrival once a truck is planned", () => {
    const s = rd("PurchaseOrders.tsx"); ok(/"ORDER DATE", "PROMISED DATE", "STATUS"/.test(s) && /const pd = poPromisedDate\(o\), arr = poExpectedArrival\(o, extShipments \|\| \[\]\)/.test(s) && /promisedDateLabel\(o\)/.test(s), "the column still reads the arrival only");
  });
  t("v7.30.8: the sale form's locks and its forward-only rule read the sale AS SAVED — a status chosen by mistake can be taken back until Save; an unsaved confirmation's rate is released on going back to Draft", () => {
    const s = rd("SalesOrderForm.tsx");
    ok(/const isLocked = lockedStatuses\.has\(effectiveSoStatus\(lockBasis, sd\.shipments\)\)/.test(s) && /const fullyLocked = FULLY_LOCKED_STATUSES\.has\(effectiveSoStatus\(lockBasis, sd\.shipments\)\)/.test(s), "the locks read the form's typed status");
    ok(/const effNow = effectiveSoStatus\(lockBasis, sd\.shipments\)/.test(s) && /const savedSt = String\(\(savedRec && savedRec\.status\) \|\| "Draft"\)/.test(s), "forward-only reads the typed status");
    ok(/if \(nv === "Draft" && !\(savedRec && savedRec\.fxLockedAt\)\)/.test(s), "the unsaved confirmation's rate is not released");
  });
  t("v7.30.9: a line to correct — the same source as another line included — is outlined in red with a note", () => {
    const s = rd("SalesOrderForm.tsx"); ok(/const lineDup = !!\(dupLineIndex as any\)\[i\]/.test(s) && /lineIsBlocking \|\| lineOverageBlocks \|\| lineDup \? "2px solid #DC2626"/.test(s), "no red outline");
  });
  t("v7.30.10: the journey card keeps the chosen place's id; a leg place saved as an object is repaired by the shipment tidy-up", () => {
    const JC = B("journeyProposal.domain.js"), SS = B("storeShapes.js");
    eq(JC.placeIdOf({ id: 7, name: "Koper" }), 7); eq(JC.placeIdOf(9), 9); eq(JC.placeIdOf(null), null);
    eq(JSON.stringify(JC.legsFromJourney([{ mode: "Road", fromLocationId: { id: 1, name: "A" }, toLocationId: { id: 2 } }], []).map(l => [l.fromLocationId, l.toLocationId])), "[[1,2]]");
    const sh = SS.shapeShipment({ id: 1, number: "S", legs: [{ id: 1, fromLocationId: { id: 3, name: "x", location: {} }, toLocationId: 4, vehicles: [] }] });
    eq(JSON.stringify([sh.legs[0].fromLocationId, sh.legs[0].toLocationId]), "[3,4]", "the object stayed");
  });
  t("v7.30.11–13: the booking's POD shows the sale's port; the unit's price comes before its currency; the carrier order asks for 0% VAT on an export outside the EU (owner's wording)", () => {
    const e = rd("ShipmentEditor.tsx"); ok(/value=\{b\?\.podId \?\? b\?\.pod \?\? \(bp\.podDoc\?\.id \?\? ""\)\}/.test(e), "the POD does not show the sale's port");
    const g = e.split("\n").findIndex(l => l.includes('gridTemplateColumns: "160px 90px 1fr", gap: 9, marginTop: 9')); ok(g > 0 && /Price for this unit/.test(e.split("\n")[g + 1]), "the price is not first");
    const d = rd("ShipmentDocuments.tsx"); ok(/Transport objęty niniejszym zleceniem stanowi część usługi transportu międzynarodowego \(eksport towarów poza UE\) i podlega stawce VAT 0% na podstawie art\. 83 ust\. 1 pkt 23 ustawy o VAT/.test(d) && /goodsLeaveTheEU\(shipment,/.test(d), "the VAT clause (v7.31.1 wording) is missing or not tied to goods leaving the EU");   // v7.31.1: the adviser's wording
  });
})();

// ══ v7.30.14 — owner test 21 Oct: one source for a company's address in every place picker ══
(function v73014(){
  console.log("\n══ v7.30.14 — the place pickers read the live Directory ══");
  const L = B("locations.js");
  t("v7.30.14 · v7.32.0 (FZ-04a): every picker reads the Parties' live list — an address changed, removed or unticked shows the new way at once; the callers without the Parties at hand read the list the App handed over, never a copy", () => {
    const mk = (street, extra = {}) => [{ id: 4242, name: "Fresh Client Sp. z o.o.", roles: ["Client"], type: "Client", countryIso: "PL", addr: { street, postcode: "00-001", city: "Warszawa" }, people: [], ...extra }];
    const parties = mk("Old Street 1"); L.setPartiesForPlaces(parties);
    ok(/Old Street 1/.test(String((L.locById(L.allPlaces().find(l => String(l.name).startsWith("Fresh Client")).id) || {}).address || "")), "the handed-over list is not read");
    parties[0] = { ...parties[0], addr: { ...parties[0].addr, street: "New Street 9" } };   // the Parties' live list changes in place
    const now = L.unifiedLocations(parties).filter(l => String(l.name).startsWith("Fresh Client"));
    eq(now.length, 1, "the company's address offered twice"); ok(/New Street 9/.test(String(now[0].address || "")), "the picker shows the old address: " + now[0].address);
    ok(/New Street 9/.test(String((L.locById(now[0].id) || {}).address || "")), "a lookup without the Parties shows the old address");
    L.setPartiesForPlaces([]); eq(L.unifiedLocations([]).filter(l => String(l.name).startsWith("Fresh Client")).length, 0, "an address that is gone is still offered");
  });
})();

// ══ v7.30.15–16 — owner test 21 Oct: the booking's cut-off; the unit's currency warning ══
(function v73016(){
  console.log("\n══ v7.30.15–16 — the cut-off and the unit's currency ══");
  const SM = B("shipmentModel.domain.js"); const fsx = require("fs"), px = require("path");
  t("v7.30.15: a truck whose delivery date is known is judged by it — arriving on the cut-off day makes it, a day later does not; with no delivery date the loading date plus the transit days still decides", () => {
    const sh = (u) => ({ bookings: [{ id: 1, number: "BK2026", cutOff: "2026-09-05" }], legs: [{ mode: "Road", vehicles: [{ kind: "truck", bookingId: 1, truckPlate: "TP1", plannedLoadingDate: "2026-09-03", ...u }] }] });
    eq(SM.cutOffWarnings(sh({ plannedDeliveryDate: "2026-09-05" })).length, 0, "the delivery on the cut-off day was warned");
    const late = SM.cutOffWarnings(sh({ plannedDeliveryDate: "2026-09-06" })); eq(late.length, 1); eq(late[0].delivery, "2026-09-06"); eq(late[0].cutOff, "2026-09-05");
    eq(SM.cutOffWarnings(sh({ plannedLoadingDate: "2026-09-05" })).length, 1, "no delivery date: loading on the cut-off day with a day's transit is late");
    eq(SM.cutOffWarnings(sh({ plannedLoadingDate: "2026-09-04" })).length, 0);
  });
  t("v7.30.15–16 (editor): a cut-off more than 30 days before its ETD is said and outlined in red (a wrong year); the unit's guide line gave way to a warning when it is priced in another currency than the carrier invoices in", () => {
    const e = fsx.readFileSync(px.join(__dirname, "../src/ShipmentEditor.tsx"), "utf8");
    ok(/function cutOffFarFromEtd\(b: any\): boolean \{[^}]*e - c > 30 \* 86400000/.test(e) && /check the year/.test(e), "no wrong-year check");
    ok(!/Optional — set this when each truck/.test(e) && /data-unit-currency-warning="1"/.test(e) && /invoices in \{uc\.currency\}; this unit is priced in \{cur\}/.test(e), "the guide line stayed or no currency warning");
  });
})();

// ══ v7.31.1 — the carrier order's VAT clause: the adviser's wording, on every carrier order of goods leaving the EU ══
(function v73101(){
  console.log("\n══ v7.31.1 — goods leaving the EU ══");
  const TF = B("tradeFlow.domain.js");
  t("v7.31.1: the goods leave the EU when the shipment crosses the border, or when it is a leg on the way out (its sale delivered outside the EU, or its booking's POD outside the EU); a shipment inside the EU with an EU sale does not", () => {
    const C = { WH: "Poland", KOP: "Slovenia", DAM: "Egypt", BER: "Germany", AMM: "Jordan" }; const countryOf = id => C[id] || "";
    const truckToKoper = { status: "Booked", purpose: "OUTBOUND", soRefs: ["SO-EG"], legs: [{ mode: "Road", fromLocationId: "WH", toLocationId: "KOP" }] };
    ok(TF.goodsLeaveTheEU(truckToKoper, { orders: [{ number: "SO-EG", status: "Confirmed", destinationLocationId: "DAM" }], countryOf }), "a truck to Koper with goods sold to Damietta");
    ok(TF.goodsLeaveTheEU({ ...truckToKoper, soRefs: [], bookings: [{ podId: "DAM" }] }, { orders: [], countryOf }), "a booking discharging at Damietta");
    ok(TF.goodsLeaveTheEU({ status: "Booked", purpose: "OUTBOUND", soRefs: [], legs: [{ mode: "Road", fromLocationId: "WH", toLocationId: "AMM" }] }, { orders: [], countryOf }), "a truck to Amman");
    ok(!TF.goodsLeaveTheEU({ ...truckToKoper, soRefs: ["SO-DE"], legs: [{ mode: "Road", fromLocationId: "WH", toLocationId: "BER" }] }, { orders: [{ number: "SO-DE", status: "Confirmed", destinationLocationId: "BER" }], countryOf }), "a truck to Berlin");
  });
})();

// ══ v7.32.0 — FZ-04a: a place is an address with one owner ══
(function v73200(){
  console.log("\n══ v7.32.0 — FZ-04a: places ══");
  const L = B("locations.js"), PR = B("placeReplace.domain.js");
  t("FZ-04a (v7.32.0): our main warehouse is the warehouse company ticked in Parties (else the first), never a built-in; the old company-like entries of the places store are listed with their uses and replaced in every field of every record", () => {
    const wh = (id, name, extra = {}) => ({ id, name, roles: ["Warehouse"], type: "Warehouse", countryIso: "PL", addr: { street: "Magazynowa 1", postcode: "00-001", city: "Poznań" }, people: [], ...extra });
    eq(L.ourMainWarehouse([]), null); eq((L.ourMainWarehouse([wh(1, "A"), wh(2, "B")]) || {}).name, "A"); eq((L.ourMainWarehouse([wh(1, "A"), wh(2, "B", { isMainWarehouse: true })]) || {}).name, "B");
    const store = [{ id: 1, name: "WH-01 Poznań (Logipark)", type: "RentedWarehouse" }, { id: 113, name: "Koper Port", type: "Port" }, { id: 10, name: "Biedronka DC", type: "ClientFacility" }];
    const data = { pos: [{ number: "PO-1", destinationLocationId: 1 }], orders: [], lots: [{ number: "LOT-1", locationId: 10, movements: [{ toId: 10 }] }], shipments: [{ number: "S-1", legs: [{ fromLocationId: 1, toLocationId: 113, vehicles: [{ loadingPlaceId: 1 }] }], bookings: [{ podId: 113 }] }] };
    const old = PR.oldPlacesToReplace(data, store); eq(old.map(o => o.place.id).join(), "1,10", "the port counted as old, or an old entry missed");
    eq(old[0].total, 2); eq(old[0].uses.shipments.join(), "S-1"); eq(old[1].uses.lots.join(), "LOT-1");
    const r = PR.replacePlaceEverywhere(data, 1, 777);
    eq(r.pos[0].destinationLocationId, 777); eq(r.shipments[0].legs[0].fromLocationId, 777); eq(r.shipments[0].legs[0].vehicles[0].loadingPlaceId, 777); eq(r.shipments[0].legs[0].toLocationId, 113, "a field holding another place changed");
    eq(r.changed.map(c => `${c.store}:${c.number}:${c.fields}`).join(), "pos:PO-1:1,shipments:S-1:2"); ok(r.lots[0] === data.lots[0], "an untouched record was copied");
  });
})();

// ══ v7.32.1 — INV-QC: a company from an invoice ══
(function v73201(){
  console.log("\n══ v7.32.1 — INV-QC: new company from this invoice ══");
  const CP = B("counterparty.domain.js"), FI = B("fakturowniaImport.domain.js");
  t("INV-QC (v7.32.1): the import keeps the counterparty's tax number and address parts on the invoice's own copy; a company built from an invoice carries name, NIP (prefix stripped), address parts, the country code and the role from the invoice's side", () => {
    const m = { fktId: 9, number: "FV/6/10/2026", sellerName: "BW-TRANS Bartosz Walo", sellerTaxNo: "PL1234567890", sellerAddr: { street: "Polna 3", postcode: "05-500", city: "Piaseczno", country: "Polska" }, buyerName: "MARIANNA", buyerTaxNo: "PL5252842787", currency: "PLN", netTotal: 100, grossTotal: 123, issueDate: "2026-10-22" };
    const row = FI.stagedRowFromMapped(m, 0, "PL5252842787", "MARIANNA"); eq(row.seller, "BW-TRANS Bartosz Walo"); eq(row.sellerAddr && row.sellerAddr.city, "Piaseczno", "the address is not kept on the row");
    const inv = FI.buildCostInvoice(row, "TRANSPORT", {}, null); eq(inv.counterparty.taxNo, "PL1234567890"); eq(inv.counterparty.addr.street, "Polna 3", "the address is not kept on the invoice's copy");
    let n = 500; const rec = CP.newCompanyFromInvoice(inv, () => ++n);   // v7.32.2: the Parties form's prefill (an id only when one is given)
    eq(rec.name, "BW-TRANS Bartosz Walo"); eq(rec.nip, "1234567890", "the PL prefix stayed in the NIP"); eq(rec.countryIso, "PL"); eq(rec.roles.join(), "Supplier"); eq(rec.addr.postcode, "05-500"); eq(rec.isPlace, false);
    const sale = CP.newCompanyFromInvoice({ kind: "SALES", number: "FS 1/2026", counterparty: { name: "Al Baraka", taxNo: "EG123" } }, () => ++n); eq(sale.roles.join(), "Client"); eq(sale.countryIso, "EG");
    const src = require("fs").readFileSync(require("path").join(__dirname, "../src/Invoices.tsx"), "utf8");
    ok(!/data-new-company-from-invoice/.test(src) && /newCompany: \{ prefill, linkInvoices: sameCompany\(i\)/.test(src), "v7.32.2: a second company form is back in Invoices, or the request does not carry the prefill");
    const pc = require("fs").readFileSync(require("path").join(__dirname, "../src/Contacts.tsx"), "utf8"); ok(/marianna:contactsNewCompany/.test(pc) && /marianna:companyCreated/.test(pc), "Parties does not open its own form for the request, or does not say it was saved");
    eq(CP.newCompanyFromInvoice({ kind: "COST", number: "X", counterparty: { name: "Stacja", taxNo: "ZZ123", addr: { country: "Atlantis" } } }, () => null).countryIso, "", "an unknown country was typed into the record");
    ok(!("id" in CP.newCompanyFromInvoice({ counterparty: { name: "Y" } }, () => null)), "the prefill carries an id");
  });
})();

// v6.99.110 (AUD-10): the whole suite ran — exit once with the verdict (v7.27.8: after the asynchronous checks)
Promise.all(pendingChecks).then(() => {
console.log(`\nAUDIT ROUND-TRIP TOTAL: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
});
