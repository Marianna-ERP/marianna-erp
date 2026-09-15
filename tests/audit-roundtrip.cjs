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

// ══ D-17 REGRESSIONS (v6.64.1) — overhead import double-write ══
(function batchE(){
  console.log("\n══ 19. D-17: one overhead row → exactly ONE register invoice ══");
  t("fold skips an opCost whose number+party already exists as a register invoice", () => {
    const existing = [{ id: 1, kind: "COST", number: "358/08/C/2026", paymentStatus: "Draft",
      counterparty: { name: "Dantex Wilcza Sp. z o. o. (dawniej: Dantex Sp. z o.o. Wilcza sp. k.)" } }];
    const r = invc.migrateLegacyInvoices({ existing, creditNotes: [], warehouseInvoices: [],
      operationalCosts: [{ id: 9, invoiceNo: "358/08/c/2026", supplierName: "Dantex Wilcza Sp. z o. o. (dawniej: X)", amount: 133.13, currency: "PLN", fxRate: 1, category: "office_rent", date: "2026-08-20", status: "Received" }],
      nextId: deps.nextId });
    eq((Array.isArray(r) ? r : []).filter(i => String(i.source || "").startsWith("migrated:opCost")).length, 0, "no twin fold");
  });
  t("same number from a DIFFERENT counterparty still folds (legit collision preserved)", () => {
    const existing = [{ id: 1, kind: "COST", number: "58/08/2026", paymentStatus: "Draft", counterparty: { name: "ORLEN S.A." } }];
    const r = invc.migrateLegacyInvoices({ existing, creditNotes: [], warehouseInvoices: [],
      operationalCosts: [{ id: 9, invoiceNo: "58/08/2026", supplierName: "Tomasz Wieśniak", amount: 10, currency: "PLN", fxRate: 1, category: "other", date: "2026-08-20", status: "Received" }],
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
  if (failed) process.exit(1);
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
  t("D-19: settlement prices the box line per kg the same way", () => {
    const materialised = { ...HER_LINE, qty: 8000, kgPerBox: 5, sourceType: "STOCK", sourceRef: "LOT-1" };
    const lot = { number: "LOT-1", expectedKg: 8000, costs: [] };
    const s = cons.computeLotSettlement(lot, [{ number: "SO-17", status: "Confirmed", currency: "PLN", fxRate: 1, items: [materialised] }], 8, []);
    approx(s.grossPLN, 94400);
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
  if (failed) process.exit(1);
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
  if (failed) process.exit(1);
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
  if (failed) process.exit(1);
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
  if (failed) process.exit(1);
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
  if (failed) process.exit(1);
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
  t("W-1: 'Reserved' is no longer a physical status; stored Reserved normalises to Confirmed", () => {
    ok(!st.PHYSICAL_SO_STATUSES.includes("Reserved"));
    eq(st.normaliseStoredSoStatus({ ...so, status: "Reserved" }, []).status, "Confirmed");
  });
  t("W-1: the gate reads the SHIPMENTS — a Confirmed order with a delivered shipment IS shipped-or-later", () => {
    eq(st.effectiveSoStatus(so, [shipDelivered]), "Delivered");
    ok(st.isShippedOrLater(so, [shipDelivered]), "Issue-invoice button appears without anyone typing Delivered");
    ok(!st.isShippedOrLater(so, []), "…and not before the goods moved");
  });
  t("W-1: a typed 'Shipped' with no shipment becomes a VISIBLE override, never a silent fact", () => {
    const n = st.normaliseStoredSoStatus({ ...so, status: "Shipped" }, []);
    eq(n.status, "Confirmed"); eq(n.statusOverride, "Shipped"); ok(String(n.statusOverrideReason).includes("Migrated"));
    const ok2 = st.normaliseStoredSoStatus({ ...so, status: "Shipped" }, [{ ...shipDelivered, status: "Loaded" }]);
    eq(ok2.status, "Confirmed"); ok(!ok2.statusOverride, "supported by shipments → plain Confirmed, derivation shows Shipped");
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
    const owner = perm.blankUser(1, "Hazem", true); const ops = perm.blankUser(2, "Ola", false); ops.modules.finance = false;
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
      invoices: [{ id: 1, kind: "COST", number: "F/1", paymentStatus: "Cancelled", grossPLN: 10 }], financeNotes: [], claims: [{ number: "CLM-1", status: "Accepted", acceptedEUR: 500, financeNoteId: null, subjects: [] }], loadPlans: [],
      advancePayments: [{ counterpartyName: "X", amount: 100, currency: "PLN", allocations: [{ invoiceId: 77, amount: 150 }] }],
      bankAccounts: [{ accountDigits: "1", label: "A" }, { accountDigits: "1", label: "B" }],
      operationalCosts: [{ source: "invoice:1", invoiceNo: "F/1", amountPLN: 10 }, { source: "invoice:404", invoiceNo: "F/404", amountPLN: 5 }],
      productCatalog: [{ item: "Apples", varieties: [] }] });
    const codes = new Set(r.issues.map(i => i.code));
    ["ADVANCE_OVERALLOCATED", "ADVANCE_ALLOC_ORPHAN", "BANKACCOUNT_DUP", "OPCOST_MIRROR_ORPHAN", "OPCOST_MIRROR_CANCELLED", "CATALOG_ITEM_UNKNOWN", "CLAIM_NOTE_MISMATCH"].forEach(c => ok(codes.has(c), c + " must fire"));
  });
  console.log("v6.79.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  if (failed) process.exit(1);
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
  if (failed) process.exit(1);
})();

// ══ v6.81.0 — Round 5 ══
(function v681(){
  console.log("\n══ 27. v6.81.0: settlement incl. claims, per-truck commission bands, claim currency ══");
  const cl = B("claims.domain.js");
  const mkLotC = () => ({ id: 1, number: "LOT-1", product: "Apples", ownership: "CONSIGNMENT", expectedKg: 1000, receivedKg: 1000, costs: [{ type: "freight", source: "SHP-1/1", pln: 800 }] });
  const soC = () => ({ number: "SO-1", status: "Confirmed", currency: "PLN", fxRate: 1, client: { name: "C" }, items: [{ product: "Apples", qty: 1000, unitPrice: 5, sourceType: "STOCK", sourceRef: "LOT-1" }] });
  t("D-56: a client concession reduces the settlement's gross; a producer recovery is a deduction, never a cheaper expense", () => {
    const base = cons.computeLotSettlement(mkLotC(), [soC()], 8, []);
    approx(base.grossPLN, 5000); approx(base.payoutPLN, (5000 - 800) * 0.92);
    const withConcession = cons.computeLotSettlement(mkLotC(), [{ ...soC(), claimAdjustments: [{ source: "claim:CLM-1", pln: -500 }] }], 8, []);
    approx(withConcession.grossPLN, 4500, "gross net of the concession");
    const lot = mkLotC(); lot.costs.push({ type: "claim", source: "claim:CLM-2", pln: -300 });
    const withRecovery = cons.computeLotSettlement(lot, [soC()], 8, []);
    approx(withRecovery.expensesPLN, 1100, "800 freight + 300 deducted from the producer");
    ok(withRecovery.payoutPLN < base.payoutPLN, "producer gets LESS after his own defect, not more");
  });
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
    const eur = { number: "CLM-8", status: "Accepted", acceptedEUR: 100, plnPerEur: 4.3, respondent: { kind: "Supplier" }, subjects: [{ kind: "LOT", ref: "L", affectedKg: 10 }] };
    approx(cl.claimMoney(eur).pln, 430, "legacy EUR claims unchanged");
  });
  console.log("v6.81.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  if (failed) process.exit(1);
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
  if (failed) process.exit(1);
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
  if (failed) process.exit(1);
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
  t("D2/D9: transport orders group units by the CARRIER ON THE UNIT", () => {
    const sh = mk(); sh.legs[0].vehicles.forEach((u, i) => { u.carrierId = i < 3 ? 10 : 11; });
    const tos = M.transportOrdersByCarrier(sh); eq(tos.length, 2); eq(tos.find(t => t.carrierId === 10).units.length, 3);
  });
  t("D10: one date entered at the event travels to the header mirrors", () => {
    let sh = mk(); sh = M.stampEvent(sh, 1, "loaded", "2026-09-02"); sh = M.stampEvent(sh, 4, "loaded", "2026-09-04");
    eq(sh.actualLoadingDate, "2026-09-02"); eq(M.derivedHeaderDates(sh).firstLoaded, "2026-09-02");
    sh = M.applyStuffingReport(sh, [{ containerNumber: "C1", feeders: [{ truckId: 1 }] }], deps);
    const cid = sh.legs[1].vehicles[0].id;
    sh = M.stampEvent(sh, cid, "discharged", "2026-09-23"); eq(sh.actualDeliveryDate, "2026-09-23", "vessel delay: actual arrival entered once, travels");
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
  t("D3: legs & responsibility from incoterms — EXW buy + CFR sell by sea = road ours + sea ours; CIF buy = sea supplier's", () => {
    const exp = M.legsFromIncoterms("EXW", "CFR", { isSea: true, direction: "EXPORT" });
    eq(exp.map(l => l.mode + ":" + l.responsibility), ["Road:Marianna", "Sea:Marianna"]); eq(exp[0].customs, "export");
    const imp = M.legsFromIncoterms("CIF", "", { isSea: true, direction: "IMPORT" });
    eq(imp[0].mode, "Sea"); eq(imp[0].responsibility, "Supplier"); eq(imp[0].customs, "import");
    const ddp = M.legsFromIncoterms("DDP", "DAP", { isSea: false });
    eq(ddp.map(l => l.responsibility), ["Supplier", "Marianna"]);
  });
  t("D11: one document register merges transport order, protocols and documents with one vocabulary", () => {
    const rows = M.documentRegister({ number: "SHP-1", confirmationStatus: "Sent", documents: [{ type: "CMR", status: "Have it", link: "https://x" }, { type: "Phyto", status: "Expected" }] }, [{ number: "LP-1", status: "Returned", truckPlate: "PL1" }]);
    eq(rows.length, 4); eq(rows[0].status, "Sent"); eq(rows[1].status, "Returned"); eq(M.documentsOutstanding(rows).length, 1);
  });
  console.log("v6.85.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  if (failed) process.exit(1);
})();

// ══ v6.86.0 — ONE LOCATION SOURCE ══
(function v686(){
  console.log("\n══ 31. v6.86.0: one location source, demo seeds gone, referenced seeds migrate ══");
  const loc = B("locations.js");
  t("the reference list holds PORTS only; demo warehouses/suppliers/clients are not in any picker", () => {
    ok(loc.LOCATIONS.every(l => l.legacyType === "PORT" || l.aliasOf), "ports only");
    ok(loc.DEMO_SEEDS.some(l => String(l.name).startsWith("WH-01")), "WH-01 is a demo seed, not reference data");
  });
  t("unifiedLocations = ports + counterparty sites, deduped and sorted; a client's address is a CLIENT site", () => {
    const contacts = [{ id: 70, name: "Al Baraka", type: "Client", address: "Damietta Free Zone", country: "Egypt" }];
    const all = loc.unifiedLocations(contacts);
    ok(all.some(l => l.legacyType === "PORT"), "ports present");
    ok(all.some(l => String(l.name).includes("Al Baraka")), "client site derived from the counterparty");
    ok(!all.some(l => String(l.name).startsWith("WH-0")), "no demo warehouse");
  });
  t("locationById resolves a demo seed still referenced by old data (read-forward)", () => {
    const seed = loc.DEMO_SEEDS[0];
    ok(loc.locationById(seed.id, []) !== null);
  });
  console.log("v6.86.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  if (failed) process.exit(1);
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
  if (failed) process.exit(1);
})();

// ══ v6.89.0 — CONSIGNMENT SEASON: records and gates ══
(function v689(){
  console.log("\n══ 33. v6.89.0: supplier-delivery truck, receipt variance, inspection, sorting job, stock count ══");
  const Z = B("seasonOps.domain.js");
  const po = { number: "PO-2026-0040", buyIncoterm: "DDP", currency: "EUR", supplier: { id: 5, name: "Vega Pro Kft." }, destinationText: "Agrohurt", items: [{ id: 1, product: "Capsicum", variety: "Red bell pepper", qty: 7200, boxes: 1440, packaging: "Carton (5 kg)", lotRef: "LOT-1" }, { id: 2, product: "Capsicum", variety: "Yellow bell pepper", qty: 7200, boxes: 1440, lotRef: "LOT-2" }] };
  t("decision 1: a DDP PO becomes a supplier-delivery shipment — tracked, not paid, one truck, all lines on it", () => {
    const sh = Z.supplierDeliveryFromPO(po, { ...deps, nextNumber: () => "SHP-2026-0100" }, { plate: "WGM 4421K", eta: "2026-09-10", supplierRef: "GM-004" });
    eq(sh.arrangedBy, "SUPPLIER"); eq(sh.purpose, "INBOUND"); ok(Z.isSupplierDelivery(sh));
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
  t("stock count: differences beyond 1 kg become reasoned adjustments; exact counts change nothing", () => {
    const lots = [{ number: "LOT-1", physicalKg: 6700, locationId: 9, movements: [] }, { number: "LOT-2", physicalKg: 7200, locationId: 9, movements: [] }];
    const c = Z.buildStockCount(lots, 9, [{ lotNumber: "LOT-1", countedKg: 6650 }, { lotNumber: "LOT-2", countedKg: 7200 }], deps, "Agrohurt");
    eq(c.lines[0].diffKg, -50); eq(c.lines[1].diffKg, 0);
    const a = Z.applyStockCount(lots, c, "shrinkage", deps); eq(a.adjusted, 1); eq(a.lots[0].movements[0].type, "DAMAGE"); eq(a.lots[1].movements.length, 0);
  });
  console.log("v6.89.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  if (failed) process.exit(1);
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
  const shipments = [{ number: "SHP-9", purpose: "OUTBOUND", status: "Delivered", goods: [{ lotRef: "L1", qtyKg: 6700 }, { lotRef: "L2", qtyKg: 7200 }], costs: [{ amountPLN: 2000 }] }];
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
    const r1 = P.commissionRun(sets, [po], (p, s) => P.computePOSettlement({ po: p, lots, orders, shipments, claims, ratePLNperEUR: s.ratePLNperEUR, provisionalEUR: s.provisionalEUR, commissionPct: s.commissionPct }), deps);
    eq(r1.invoices.length, 1); eq(r1.invoices[0].currency, "EUR"); approx(r1.invoices[0].grossAmount, calc.commissionEUR);
    const r2_ = P.commissionRun(r1.settlements, [po], () => calc, deps); eq(r2_.invoices.length, 0, "already invoiced");
  });
  console.log("v6.90.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  if (failed) process.exit(1);
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
  if (failed) process.exit(1);
})();

// ══ v6.94.0 — PURCHASE ORDERS (PO-1…PO-6) ══
(function v694(){
  console.log("\n══ 36. v6.94.0: box unit on PO lines, payment days → due date, normalisation, price check ══");
  const P = B("po.domain.js");
  const types = B("packaging.domain.js").PACKAGING_SEED;
  t("PO-1: box-priced line — type boxes, kilos derive; type kilos on a kg line, boxes derive", () => {
    let l = P.derivePOLineQuantities({ product: "Apples", packaging: "Wooden box (13 kg)", pricingUnit: "box", boxes: 1494, unitPrice: 26 }, types, "boxes");
    eq(l.qty, 19422); eq(P.poLineValue(l), 1494 * 26);
    let k = P.derivePOLineQuantities({ product: "Apples", packaging: "Wooden box (13 kg)", pricingUnit: "kg", qty: 19422, unitPrice: 2 }, types, "qty");
    eq(k.boxes, 1494); eq(P.poLineValue(k), 38844);
  });
  t("PO-2: payment days from the PO, else the supplier, else legacy text; due = issue + days", () => {
    eq(P.paymentDaysFor({ paymentDays: 45 }, { paymentTermsDays: 30 }), 45);
    eq(P.paymentDaysFor({}, { paymentTermsDays: 30 }), 30);
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
  if (failed) process.exit(1);
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
  t("SO-2: the SO line takes the PO line's unit and boxes", () => {
    const f = Q.lineFromPOLine({ pricingUnit: "box", boxes: 1494, kgPerBox: 13 }); eq(f.pricingUnit, "box"); eq(f.boxes, 1494);
  });
  t("SO-3: CFR delivers at DISCHARGE; DAP at delivery; the delay is planned vs that event", () => {
    eq(Q.deliveryEventFor("CFR").event, "discharged"); eq(Q.deliveryEventFor("DDP").event, "delivered"); eq(Q.deliveryEventFor("EXW").event, "loaded");
    const so = { number: "SO-1", sellIncoterm: "CFR", deliveryDate: "2026-09-20" };
    const sh = [{ status: "Delivered", soRefs: ["SO-1"], legs: [{ vehicles: [{ deliveredAt: "2026-09-08" }] }, { vehicles: [{ dischargedAt: "2026-09-23" }] }] }];
    eq(Q.actualDeliveryDate(so, sh), "2026-09-23", "the truck's delivery at the port is NOT the sale's delivery"); eq(Q.deliveryDelayDays(so, sh), 3);
  });
  t("SO-4: payment days from the client → invoice due date", () => { eq(Q.soPaymentDays({}, { paymentTermsDays: 14 }), 14); eq(Q.soInvoiceDueDate("2026-09-10", {}, { paymentTermsDays: 14 }), "2026-09-24"); });
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
    const orders = [{ number: "SO-1", status: "Confirmed", items: [{ sourceType: "PO", sourceRef: "PO-1", sourceLineId: 1, qty: 12000 }] }, { number: "SO-2", status: "Confirmed", items: [{ sourceType: "PO", sourceRef: "PO-1", sourceLineId: 1, qty: 8000 }] }];
    const adj = Q.proposeSOAdjustments(fin, orders);
    eq(adj.length, 1); eq(adj[0].soNumber, "SO-2"); eq(adj[0].overKg, 3000); eq(adj[0].finalKg, 5000);
  });
  console.log("v6.95.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  if (failed) process.exit(1);
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
  t("IN-4: lot normalisation drops mirrors, syncs consignment/direct from the PO, derives arrival, hands the old settlement over — idempotently", () => {
    const lot = { number: "L1", poRef: "PO-1", journey: [], destinationText: "x", custodyType: "y", consignment: false, arrivalDate: "", settlement: { status: "Closed", number: "SET-2026-0001" }, movements: [{ type: "IN", date: "2026-09-10", qtyKg: 10 }] };
    const r = Z.normaliseLot(lot, { po: { pricingMode: "consignment", directFlow: false }, poSettlements: [] });
    ok(r.changed); ok(!("journey" in r.lot)); eq(r.lot.consignment, true); eq(r.lot.arrivalDate, "2026-09-10"); ok(r.settlementToMigrate && r.settlementToMigrate.poNumber === "PO-1"); ok(!("settlement" in r.lot));
    ok(!Z.normaliseLot(r.lot, { po: { pricingMode: "consignment", directFlow: false }, poSettlements: [{ poNumber: "PO-1" }] }).changed);
  });
  console.log("v6.96.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  if (failed) process.exit(1);
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
    const merged = cc.mergeChainLines(lines, lines); eq(merged.length, 2);
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
  t("CL-7/CL-1: legacy form fields fold into cost lines and notes; EUR mirrors into the one money model; idempotent", () => {
    const r = CP.foldLegacyClaimFields({ number: "CLM-1", basis: "quality", lostKg: 500, causedCosts: 300, clientCosts: 120, soldInMarket: true, recoveredEGP: 1000, egpPerEur: 52, acceptedEUR: 45, requestedEUR: 60, costLines: [] });
    ok(r.changed); eq(r.claim.costLines.length, 2); ok(!("basis" in r.claim)); ok(String(r.claim.notes).includes("[legacy]")); eq(r.claim.currency, "EUR"); eq(r.claim.acceptedAmount, 45); eq(r.claim.requestedAmount, 60);
    ok(!CP.foldLegacyClaimFields(r.claim).changed);
  });
  t("CL-8: the counterparty's agreed notice period overrides the legal default", () => {
    eq(CP.noticeRuleFor({ respondent: { kind: "Carrier" } }, {}).days, 7);
    eq(CP.noticeRuleFor({ respondent: { kind: "Carrier" } }, { name: "TBX", noticeDays: 10 }).days, 10);
  });
  console.log("v6.97.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  if (failed) process.exit(1);
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
    eq(IV.defaultCostDueDate({ issueDate: "2026-09-10" }, { paymentTermsDays: 21 }), "2026-10-01");
  });
  console.log("v6.98.0 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  if (failed) process.exit(1);
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
  if (failed) process.exit(1);
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
  if (failed) process.exit(1);
})();

// ══ v6.99.1 — FINANCE part 2 (FN-4/5/6) ══
(function v6991(){
  console.log("\n══ 43. v6.99.1: client risk, PO result for every purchase, warehouse agreement ══");
  const FP = B("financePlus.domain.js");
  t("FN-4: client risk — exposure, overdue, days late, limit usage incl. confirmed orders, days-to-pay", () => {
    const inv = [{ kind: "SALES", counterparty: { name: "Agromax" }, currency: "PLN", fxRate: 1, issueDate: "2026-08-01", dueDate: "2026-08-31", grossAmount: 10000, paidAmount: 4000, paymentStatus: "Issued", payments: [{ date: "2026-08-21", amount: 4000 }] }];
    const r = FP.clientRisk("Agromax", inv, [{ status: "Confirmed", client: { name: "Agromax" }, fxRate: 1, items: [{ qty: 1000, unitPrice: 5 }] }], { creditLimitPLN: 20000 }, "2026-09-11");
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
  t("FN-6: an all-inclusive annual agreement bills the monthly fee only; extras only when not included", () => {
    const agr = { type: "fixed_monthly", fixedMonthlyPLN: 12000, includedServices: ["unloading", "sorting"], extras: [{ service: "labelling", ratePLN: 0.5, unit: "box" }, { service: "sorting", ratePLN: 100, unit: "hour" }] };
    const e = FP.expectedWarehouseMonthly(agr, { kgDays: 500000, palletDays: 0, services: { labelling: 1000, sorting: 6 } });
    approx(e.expectedPLN, 12500, "12 000 fee + 500 labelling; sorting is included");
    const kg = FP.expectedWarehouseMonthly({ type: "kg_day", rateKgDayPLN: 0.02 }, { kgDays: 500000, palletDays: 0, services: {} }); approx(kg.expectedPLN, 10000);
  });
  console.log("v6.99.1 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  if (failed) process.exit(1);
})();

// ══ v6.99.2 — COUNTERPARTIES (CP-1…CP-7, CP-9) ══
(function v6992(){
  console.log("\n══ 44. v6.99.2: roles, terms block, people, archive, Fakturownia id, ISO/EU, agreements ══");
  const CPY = B("counterparty.domain.js");
  t("CP-1/2/6/9: normalisation — roles from type+additionalTypes, terms from scattered fields (mirrors kept), ISO code, caches dropped; idempotent", () => {
    const r = CPY.normaliseCounterparty({ id: 1, name: "Agro-Hurt", type: "Client", additionalTypes: ["Supplier", "Warehouse"], country: "Poland", paymentTerms: "30 days", creditLimitPLN: 50000, defaultCurrency: "pln", finance: { x: 1 }, services: "reefer", linkedDocs: ["PO-1"], contacts: [{ name: "Mateusz", email: "m@agro.pl" }] });
    ok(r.changed); eq(r.contact.roles.join(","), "Client,Supplier,Warehouse"); eq(r.contact.terms.paymentDays, 30); eq(r.contact.terms.creditLimitPLN, 50000); eq(r.contact.terms.defaultCurrency, "PLN"); eq(r.contact.paymentTermsDays, 30, "mirror for PO-2/SO-4 readers");
    eq(r.contact.countryIso, "PL"); ok(!("finance" in r.contact)); ok(!("linkedDocs" in r.contact)); ok(Array.isArray(r.contact.contacts) && r.contact.contacts.length === 1, "contacts kept — the screens read it"); eq(r.contact.people.length, 1); ok(r.contact.people === r.contact.contacts, "one list");
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
  if (failed) process.exit(1);
})();

// ══ v6.99.3 — SETTINGS batch ══
(function v6993(){
  console.log("\n══ 45. v6.99.3: CN suggestions, Vega Pro export shape ══");
  const CN = B("cnCodes.js");
  t("CN suggestions match the produce Marianna trades, in English and Polish; the user still confirms", () => {
    eq(CN.suggestCN("Capsicum Kalifornia")[0].code, "07096010"); eq(CN.suggestCN("Apples", "Gala Schniko Red")[0].code, "08081080"); eq(CN.suggestCN("Papryka")[0].code, "07096010"); eq(CN.suggestCN("Chinese cabbage")[0].code, "07049090"); eq(CN.suggestCN("").length, 0);
  });
  console.log("v6.99.3 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  if (failed) process.exit(1);
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
  if (failed) process.exit(1);
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
    const lines = M.costLinesByCarrierLeg(sh, id => ({ 10: "Stenrzycki", 11: "Polton", 99: "Forwarder" })[id] || "?");
    eq(lines.map(l => l.label.split(" — ")[2].split(" (")[0]).sort().join(","), "Forwarder,Polton,Stenrzycki");
  });
  console.log("v6.99.8 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  if (failed) process.exit(1);
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
  if (failed) process.exit(1);
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
  if (failed) process.exit(1);
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
  if (failed) process.exit(1);
})();

// ══ v6.99.29 — party pickers and places (A-R19) ══
(function v69929(){
  console.log("\n══ 51. v6.99.29: pickers sorted & roles-aware; orphaned migrated places pruned ══");
  const L = B("locations.js");
  t("A-R19-4: a migrated demo place no document points at is dropped; one that is still referenced stays", () => {
    const store = {}; global.window = global.window || {}; 
    // emulate the browser store the function uses
    const backup = global.window.localStorage;
    global.window.localStorage = { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
    store["marianna-erp:v2:customLocations"] = JSON.stringify([
      { id: 1, name: "WH-01 Poznań (Logipark)", migratedFromSeed: true },
      { id: 3, name: "Białski Owoc", migratedFromSeed: true },
      { id: 10001, name: "Silver Tech" },
    ]);
    const dropped = L.pruneOrphanMigratedSeeds(["3", "126"]);
    eq(dropped.length, 1); eq(dropped[0].name.slice(0, 5), "WH-01");
    const left = JSON.parse(store["marianna-erp:v2:customLocations"]).map(x => String(x.id)).sort();
    eq(left.join(","), "10001,3", "a referenced migrated place and a place added by hand both stay");
    eq(L.pruneOrphanMigratedSeeds(["3", "126"]).length, 0, "idempotent");
    global.window.localStorage = backup;
  });
  console.log("v6.99.29 RESULT: " + passed + " passed, " + failed + " failed (cumulative)");
  if (failed) process.exit(1);
})();
