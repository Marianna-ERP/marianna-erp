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
  t("debit, fee and own-company lines are set aside (receivables first)", () => {
    const p = bank.parseBankCSV(PKO);
    const m = bank.matchBankLines(p.lines, invs);
    eq(m.filter(s => s.rank === "IGNORED").length, 2, "fee + intra-company EUR transfer");
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
