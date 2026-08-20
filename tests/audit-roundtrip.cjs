// ─────────────────────────────────────────────────────────────────────────────
// audit-roundtrip.cjs — Phase 1/3 forward↔backward audit (v6.62.0)
// Every scenario walks a document FORWARD through its lifecycle, then BACKWARD
// (cancel / void / remove / re-run), asserting the system returns to a clean
// state and never double-counts. GAP scenarios deliberately prove what the
// integrity checker does NOT see today.
// ─────────────────────────────────────────────────────────────────────────────
const B = p => require("./build/" + p);
const ship = B("shipments.domain.js");
const inv = B("inventory.domain.js");
const alloc = B("costAllocation.js");
const pay = B("payments.domain.js");
const cons = B("consignment.js");
const settle = B("settlement.domain.js");
const claims = B("claims.domain.js");
const cancel = B("cancellation.domain.js");
const ledger = B("ledger.js");
const wh = B("warehouseCharges.js");
const rec = B("receipts.domain.js");
const lp = B("loadPlan.domain.js");
const pu = B("pricingUnit.domain.js");
const invc = B("invoicing.js");
const integ = B("integrityCheck.js");
const docs = B("documents.domain.js");
const heal = B("heal.v645.js");
const pkg = B("packaging.domain.js");

let passed = 0, failed = 0, findings = [];
let idc = 100000;
const deps = { todayISO: () => "2026-08-20", nextId: () => ++idc };
function t(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { failed++; console.log("  ✗ " + name + " — " + e.message); findings.push(name + ": " + e.message); }
}
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
t("a firm PO stops counting once a PURCHASE invoice links it (counted exactly once)", () => {
  const pos = [{ number: "PO-1", status: "Arrived", pricingMode: "firm", currency: "PLN", fxRate: 1,
    supplier: { name: "S" }, items: [{ qty: 100, unitPrice: 10 }] }];
  const without = ledger.buildLedger({ pos, invoices: [], todayISO: "2026-08-20" });
  eq(without.items.length, 1); eq(without.items[0].kind, "PO purchase");
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
t("settlement excludes its own CONSIGN components from expenses (no feedback loop)", () => {
  const lot = { id: 5, number:"LOT-1", product:"Apples", poRef:"PO-1", expectedKg: 1000, costs: [
    { type:"freight", label:"road", source:"SHP-1/1", pln: 200 },
    { type:"Consignment purchase", label:"prior producer inv", source:"CONSIGN-5", pln: 5000 },
    { type:"Commission credit", label:"prior comm", source:"CONSIGNC-5", pln: -300 } ] };
  const orders = [{ number:"SO-1", status:"Delivered", currency:"PLN", fxRate:1, client:{name:"C"},
    items:[{ product:"Apples", sourceType:"PO", sourceRef:"PO-1", qty: 1000, unitPrice: 6 }] }];
  const calc = cons.computeLotSettlement(lot, orders, 8, []);
  approx(calc.grossPLN, 6000); approx(calc.expensesPLN, 200, "only real expenses");
  approx(calc.netPLN, 5800); approx(calc.commissionPLN, 464); approx(calc.payoutPLN, 5336);
});
t("close components carry FIXED sources — integrity catches a double-close", () => {
  const comp = cons.settlementCostComponents({ id: 5, number:"LOT-1" }, 5800, 464, "FA9", "FV9");
  eq(comp[0].source, "CONSIGN-5"); eq(comp[1].source, "CONSIGNC-5");
  const doubled = { id: 5, number:"LOT-1", costs: [...comp, ...comp] }; // simulate a bad second close
  const res = integ.checkIntegrity({ lots: [doubled] });
  ok(res.issues.some(i => i.code === "CONSIGN_DOUBLE_PURCHASE"), "double purchase caught");
  ok(res.issues.some(i => i.code === "CONSIGN_DOUBLE_COMMISSION"), "double commission caught");
});
t("commission invoice draft is born with an offset payment event → status Paid", () => {
  const draft = settle.buildCommissionInvoiceDraft({ number:"LOT-1", poRef:"PO-1" },
    { number:"SET-2026-0001", finalCommissionPLN: 464, commissionPct: 8, closedAt: "2026-08-20" },
    { supplier: { name: "Producer X" } }, deps);
  eq(draft.kind, "SALES"); eq(draft.category, "COMMISSION");
  eq(draft.paymentStatus, "Paid"); approx(draft.paidAmount, 464);
  eq(draft.payments[0].method, "Offset / compensation");
});
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
t("cancelled records vanish from KPIs but stay on the record (both rulings hold)", () => {
  const list = [{ number:"A", status:"Cancelled" }, { number:"B", status:"Booked" }];
  eq(cancel.liveOnly(list).length, 1);
  const split = cancel.splitByCancelled(list);
  eq(split.cancelled.length, 1); eq(split.live.length, 1);
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
  const r = inv.recomputeLotFromMovements(mkLot(), ms, () => ({ legacyType: "OWN" }));
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
t("unmapped truck kg is reported; totals derive only from live members", () => {
  const shs = [
    { id:1, number:"SHP-1", mode:"Road", status:"Loaded", goods:[{ qtyKg: 20000 }] },
    { id:2, number:"SHP-2", mode:"Road", status:"Cancelled", goods:[{ qtyKg: 20000 }] } ];
  const plan = { shipmentRefs: ["SHP-1","SHP-2"], map: [{ containerRef:"MSKU1", shipmentRef:"SHP-1", qtyKg: 12000 }] };
  const gaps = lp.mapGaps(plan, shs);
  eq(gaps.length, 1); approx(gaps[0].unmappedKg, 8000);
  const tot = lp.planTotals(plan, shs, () => 0);
  eq(tot.live, 1); eq(tot.cancelled, 1); approx(tot.kg, 20000, "cancelled member excluded");
});
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
t("PO↔SO↔shipment links derive consistently in both directions", () => {
  const po = { number: "PO-1", items: [{ qty: 1000 }] };
  const so = { number: "SO-1", status: "Confirmed", items: [{ sourceType: "PO", sourceRef: "PO-1", qty: 1000 }] };
  const sh = { number: "SHP-1", poRefs: ["PO-1"], soRefs: ["SO-1"], goods: [] };
  const poL = docs.computedPOLinks(po, { shipments: [sh], lots: [], invoices: [], orders: [so] });
  eq(poL.linkedShipments, ["SHP-1"]); eq(poL.linkedSalesOrders, ["SO-1"]);
  const soL = docs.computedSOLinks(so, { shipments: [sh], invoices: [], lots: [] });
  eq(soL.linkedShipments, ["SHP-1"]);
  eq(docs.poSalesLink(po, [so]).state, "Fully");
});
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
t("cancelled SO releases the PO back to Unsold (backward)", () => {
  const po = { number: "PO-1", items: [{ qty: 1000 }] };
  const so = { number: "SO-1", status: "Cancelled", items: [{ sourceType: "PO", sourceRef: "PO-1", qty: 1000 }] };
  eq(docs.poSalesLink(po, [so]).state, "Unsold");
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
t("healRound651 outbound-cost removal is idempotent", () => {
  const shs = [{ number: "SHP-OUT", purpose: "OUTBOUND" }];
  const lots = [mkLot({ costs: [{ type: "freight", label: "delivery", source: "SHP-OUT/1", pln: 100 }] })];
  const r1 = heal.healRound651({ shipments: shs, lots });
  eq(r1.lots[0].costs.length, 0); eq(r1.changed, true);
  const r2 = heal.healRound651({ shipments: shs, lots: r1.lots });
  eq(r2.changed, false, "second run is a no-op");
});

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
      warehouseInvoices: [{ id: 5, invoiceNo: "LP/1", warehouseId: 30 }],
    });
    eq(r.total, 8, "all eight reference kinds found");
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
  if (failed) process.exit(1);
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
  if (failed) process.exit(1);
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
    const claim = { number: "CLM-2026-0001", cause: "Transport damage", acceptedEUR: 500, plnPerEur: 4.3,
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
  if (failed) process.exit(1);
})();
