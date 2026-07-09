// Engine scenario tests (Consolidation Batch 1 — audit P2-5).
// Run: npm run test:engines   (compiles the pure engines, then executes this file)
const assert = require("assert");
const { recomputeLotFromMovements } = require("./build/inventory.domain.js");
const { lotReservationsForPicker, lotReservationsForStock, poLineReservations, computeLineAvailability } = require("./build/salesOrders.domain.js");

const locById = id => ({ 1:{type:"OWN"}, 2:{type:"CLIENT"}, 3:{type:"PORT"} }[id] || null);
let pass = 0, fail = 0;
function T(name, fn){ try { fn(); pass++; console.log("  ✓ " + name); } catch(e){ fail++; console.log("  ✗ " + name + " — " + e.message); } }

console.log("── inventory.domain: movement reducer ──");
const baseLot = { number:"LOT-1", product:"Peppers", expectedKg:1000, baseLocationId:1, locationId:1 };
T("no movements → Expected, physical 0", () => {
  const r = recomputeLotFromMovements(baseLot, [], locById);
  assert.equal(r.status, "Expected"); assert.equal(r.physicalKg, 0);
});
T("IN 1000 to OWN → received 1000, physical 1000, In Stock", () => {
  const r = recomputeLotFromMovements(baseLot, [{id:1,type:"IN",date:"2026-01-01",qtyKg:1000,toId:1}], locById);
  assert.equal(r.receivedKg, 1000); assert.equal(r.physicalKg, 1000); assert.equal(r.status, "In Stock");
});
T("partial SHIP_OUT keeps location + In Stock (v6.18.10 #3)", () => {
  const r = recomputeLotFromMovements(baseLot, [
    {id:1,type:"IN",date:"2026-01-01",qtyKg:1000,toId:1},
    {id:2,type:"SHIP_OUT",date:"2026-01-02",qtyKg:400,toId:2}], locById);
  assert.equal(r.physicalKg, 600); assert.equal(r.locationId, 1); assert.equal(r.status, "In Stock");
});
T("full SHIP_OUT → Shipped Out", () => {
  const r = recomputeLotFromMovements(baseLot, [
    {id:1,type:"IN",date:"2026-01-01",qtyKg:1000,toId:1},
    {id:2,type:"SHIP_OUT",date:"2026-01-02",qtyKg:1000}], locById);
  assert.equal(r.physicalKg, 0); assert.equal(r.status, "Shipped Out");
});
T("voided TRANSFER excluded from replay (v6.18.17 Void)", () => {
  const r = recomputeLotFromMovements(baseLot, [
    {id:1,type:"IN",date:"2026-01-01",qtyKg:1000,toId:1},
    {id:2,type:"TRANSFER",date:"2026-01-02",qtyKg:1000,toId:3,voided:true}], locById);
  assert.equal(r.locationId, 1); assert.equal(r.movements.length, 1);
});
T("DAMAGE reduces physical into damagedKg", () => {
  const r = recomputeLotFromMovements(baseLot, [
    {id:1,type:"IN",date:"2026-01-01",qtyKg:1000,toId:1},
    {id:2,type:"DAMAGE",date:"2026-01-02",qtyKg:100}], locById);
  assert.equal(r.physicalKg, 900); assert.equal(r.damagedKg, 100);
});
T("REVERSAL restores stock after ship-out", () => {
  const r = recomputeLotFromMovements(baseLot, [
    {id:1,type:"IN",date:"2026-01-01",qtyKg:1000,toId:1},
    {id:2,type:"SHIP_OUT",date:"2026-01-02",qtyKg:1000},
    {id:3,type:"REVERSAL",date:"2026-01-03",qtyKg:200,toId:1}], locById);
  assert.equal(r.physicalKg, 200);
});
T("CLAIM never touches warehouse stock (v6.18.10 #5)", () => {
  const r = recomputeLotFromMovements(baseLot, [
    {id:1,type:"IN",date:"2026-01-01",qtyKg:1000,toId:1},
    {id:2,type:"CLAIM",date:"2026-01-02",qtyKg:300}], locById);
  assert.equal(r.physicalKg, 1000); assert.equal(r.claimedKg, 300);
});

console.log("── salesOrders.domain: reservations & availability ──");
const lot = { number:"LOT-1", product:"Peppers", availableKg:5000, poRef:"PO-1", physicalKg:5000, receivedKg:5000 };
const mkSO = (id, status, qty, src={sourceType:"STOCK",sourceRef:"LOT-1"}) =>
  ({ id, number:"SO-"+id, status, items:[{ id:1, product:"Peppers", qty, ...src }] });

T("Confirmed order reserves; picker subtracts", () => {
  const r = lotReservationsForPicker(lot, [mkSO(2,"Confirmed",1000)], 99);
  assert.equal(r.totalReserved, 1000); assert.equal(r.liveAvailable, 4000);
});
T("Draft / Cancelled / Shipped do NOT reserve (B0-2 semantics pinned)", () => {
  const r = lotReservationsForPicker(lot, [mkSO(2,"Draft",500), mkSO(3,"Cancelled",500), mkSO(4,"Shipped",500), mkSO(5,"Delivered",500)], 99);
  assert.equal(r.totalReserved, 0); assert.equal(r.liveAvailable, 5000);
});
T("wrong-product pick doesn't reserve", () => {
  const bad = mkSO(2,"Confirmed",1000); bad.items[0].product = "Apples";
  const r = lotReservationsForPicker(lot, [bad], 99);
  assert.equal(r.totalReserved, 0);
});
T("own order excluded (excludeOrderId)", () => {
  const r = lotReservationsForPicker(lot, [mkSO(7,"Confirmed",1000)], 7);
  assert.equal(r.totalReserved, 0);
});
T("stock view: PO-backed draw reserves the PO's lot (Inventory semantics)", () => {
  const r = lotReservationsForStock(lot, [mkSO(2,"Confirmed",800,{sourceType:"PO",sourceRef:"PO-1",sourceLineId:1})]);
  assert.equal(r.totalReserved, 800); assert.equal(r.liveAvailable, 4200);
});
T("PO line reservations subtract from line.available", () => {
  const po = { number:"PO-1", status:"Confirmed", items:[{id:1,product:"Peppers",available:10000}] };
  const r = poLineReservations(po, po.items[0], [mkSO(2,"Confirmed",3000,{sourceType:"PO",sourceRef:"PO-1",sourceLineId:1})], 99);
  assert.equal(r.liveAvailable, 7000);
});

console.log("── computeLineAvailability (incl. T-22 regression) ──");
const receivedLot = { number:"LOT-1", product:"Peppers", availableKg:4300, poRef:"PO-1", physicalKg:4300, receivedKg:14300 };
const receivedPO  = { number:"PO-1", status:"Confirmed", items:[{id:1,product:"Peppers",available:14300}] };
const expectedPO  = { number:"PO-2", status:"Confirmed", items:[{id:1,product:"Peppers",available:6000}] };
T("received PO excluded from other sources (T-22)", () => {
  const items = [{ id:1, product:"Peppers", qty:10000, sourceType:"STOCK", sourceRef:"LOT-1" }];
  const [a] = computeLineAvailability(items, [], 1, [receivedLot], [receivedPO]);
  assert.equal(a.primaryAvailable, 4300);
  assert.equal(a.otherPOKg, 0);
  assert.equal(a.combinedAvailable, 4300);
});
T("expected (not-received) PO still counts as incoming", () => {
  const items = [{ id:1, product:"Peppers", qty:10000, sourceType:"STOCK", sourceRef:"LOT-1" }];
  const [a] = computeLineAvailability(items, [], 1, [receivedLot], [receivedPO, expectedPO]);
  assert.equal(a.otherPOKg, 6000);
  assert.equal(a.combinedAvailable, 10300);
});
T("Draft-PO source yields primaryAvailable 0 (confirmed-PO gate)", () => {
  const draftPO = { number:"PO-3", status:"Draft", items:[{id:1,product:"Peppers",available:9000}] };
  const items = [{ id:1, product:"Peppers", qty:1000, sourceType:"PO", sourceRef:"PO-3", sourceLineId:1 }];
  const [a] = computeLineAvailability(items, [], 1, [], [draftPO]);
  assert.equal(a.primaryAvailable, 0);
});
T("other reserving SO reduces the shared lot pool", () => {
  const items = [{ id:1, product:"Peppers", qty:4000, sourceType:"STOCK", sourceRef:"LOT-1" }];
  const other = mkSO(9,"Confirmed",2000);
  const [a] = computeLineAvailability(items, [other], 1, [receivedLot], []);
  assert.equal(a.primaryAvailable, 2300);
});
T("product mismatch on picked source flagged, not counted", () => {
  const items = [{ id:1, product:"Apples", qty:100, sourceType:"STOCK", sourceRef:"LOT-1" }];
  const [a] = computeLineAvailability(items, [], 1, [receivedLot], []);
  assert.equal(a.primaryProductMismatch, true); assert.equal(a.primaryAvailable, 0);
});


// ── Batch 1b additions ──
const { allocateShipmentCostsToLots } = require("./build/costAllocation.js");
const { buildLedger } = require("./build/ledger.js");
const mapper = { inventoryType: c => c === "customs" ? "customs" : "freight", label: c => c === "customs" ? "Customs" : "Freight" };

console.log("── costAllocation: replace-by-source ──");
const shp = { number:"SHP-1", costs:[{id:10,type:"road_freight",amountPLN:1000}],
  goods:[{lotRef:"LOT-A",qtyKg:6000},{lotRef:"LOT-B",qtyKg:4000}], lotRefs:[] };
const lots0 = [{number:"LOT-A",costs:[{type:"purchase",label:"Purchase",source:"PO-1",pln:5000}]},{number:"LOT-B",costs:[]},{number:"LOT-C",costs:[]}];

T("first allocation splits by kg (60/40)", () => {
  const out = allocateShipmentCostsToLots(shp, lots0, mapper);
  const a = out.find(l=>l.number==="LOT-A"), b = out.find(l=>l.number==="LOT-B");
  assert.equal(a.costs.find(c=>c.source==="SHP-1/10").pln, 600);
  assert.equal(b.costs.find(c=>c.source==="SHP-1/10").pln, 400);
  assert.ok(a.costs.find(c=>c.source==="PO-1"), "foreign source kept");
});
T("re-allocation after edit REPLACES (no stale line)", () => {
  const once = allocateShipmentCostsToLots(shp, lots0, mapper);
  const edited = { ...shp, costs:[{id:10,type:"road_freight",amountPLN:2000}] };
  const twice = allocateShipmentCostsToLots(edited, once, mapper);
  const a = twice.find(l=>l.number==="LOT-A");
  const mine = a.costs.filter(c=>String(c.source).startsWith("SHP-1/"));
  assert.equal(mine.length, 1, "exactly one line for this cost");
  assert.equal(mine[0].pln, 1200);
});
T("deleted shipment cost is cleaned up on re-allocation", () => {
  const once = allocateShipmentCostsToLots(shp, lots0, mapper);
  const emptied = { ...shp, costs:[] };
  const twice = allocateShipmentCostsToLots(emptied, once, mapper);
  const a = twice.find(l=>l.number==="LOT-A");
  assert.equal(a.costs.filter(c=>String(c.source).startsWith("SHP-1/")).length, 0);
  assert.ok(a.costs.find(c=>c.source==="PO-1"), "unrelated cost survives");
});
T("no goods rows → equal split across lotRefs", () => {
  const s2 = { number:"SHP-2", costs:[{id:1,type:"road_freight",amountPLN:900}], goods:[], lotRefs:["LOT-A","LOT-B","LOT-C"] };
  const out = allocateShipmentCostsToLots(s2, lots0, mapper);
  assert.equal(out.find(l=>l.number==="LOT-C").costs.find(c=>c.source==="SHP-2/1").pln, 300);
});
T("untouched lots keep identity (===)", () => {
  const out = allocateShipmentCostsToLots(shp, lots0, mapper);
  assert.strictEqual(out.find(l=>l.number==="LOT-C"), lots0.find(l=>l.number==="LOT-C"));
});

console.log("── ledger: payment classification (v6.18.21 fx fix pinned) ──");
const today = "2026-07-04";
const mkInv = (over={}) => ({ id:1, kind:"SALES", number:"FV/1/2026", counterparty:{name:"Client X"},
  issueDate:"2026-06-01", dueDate:"2026-08-01", currency:"EUR", fxRate:4.25,
  grossAmount:1000, grossPLN:4250, paidAmount:0, paymentStatus:"Issued", ...over });

T("paymentStatus Paid → Paid", () => {
  const { items } = buildLedger({ invoices:[mkInv({paymentStatus:"Paid"})], todayISO:today });
  assert.equal(items.find(i=>i.documentNo==="FV/1/2026").status, "Paid");
});
T("fx-aware fallback: 1000 EUR paid on 4250 PLN gross → Paid", () => {
  const { items } = buildLedger({ invoices:[mkInv({paidAmount:1000})], todayISO:today });
  assert.equal(items.find(i=>i.documentNo==="FV/1/2026").status, "Paid");
});
T("partial payment stays unpaid + in receivable totals", () => {
  const { items, totals } = buildLedger({ invoices:[mkInv({paidAmount:200})], todayISO:today });
  const it = items.find(i=>i.documentNo==="FV/1/2026");
  assert.notEqual(it.status, "Paid");
  assert.ok(totals.receivableOpenPLN > 0);
});
T("past dueDate unpaid → Overdue and in overdue totals", () => {
  const { items, totals } = buildLedger({ invoices:[mkInv({dueDate:"2026-06-15"})], todayISO:today });
  assert.equal(items.find(i=>i.documentNo==="FV/1/2026").status, "Overdue");
  assert.ok(totals.receivableOverduePLN >= 4250 - 0.01);
});
T("fakturowniaPaid sync marks Paid", () => {
  const { items } = buildLedger({ invoices:[mkInv()], fakturowniaPaid:{"FV/1/2026":true}, todayISO:today });
  assert.equal(items.find(i=>i.documentNo==="FV/1/2026").status, "Paid");
});
T("PIN current behaviour: financeNotes do NOT change totals yet (flips in Batch 5 / BP-37)", () => {
  const base = buildLedger({ invoices:[mkInv()], todayISO:today }).totals;
  const withNote = buildLedger({ invoices:[mkInv()], financeNotes:[{id:9,noteKind:"CREDIT",direction:"OUTGOING",amount:100,fxRate:4.25,amountPLN:425,partyName:"Client X",date:"2026-06-20"}], todayISO:today }).totals;
  assert.equal(base.receivableOpenPLN, withNote.receivableOpenPLN);
});

// ── Batch 3a: shipment posting engine + decisions 1 & 2 ──
const { postShipmentToLots, derivePurpose, responsibilityForPOShipment } = require("./build/shipments.domain.js");
let _id = 5000; const deps = { todayISO: () => "2026-07-05", nextId: () => ++_id };

console.log("── shipments.domain: purpose + posting ──");
T("derivePurpose: legacy mapping preserved", () => {
  assert.equal(derivePurpose({ purpose:"SO_DELIVERY" }), "OUTBOUND");
  assert.equal(derivePurpose({ purpose:"PO_IMPORT" }), "INBOUND");
  assert.equal(derivePurpose({ soRefs:["SO-1"] }), "OUTBOUND");
  assert.equal(derivePurpose({ purpose:"OUTBOUND" }), "OUTBOUND");
});
const inbound = { number:"SHP-10", purpose:"INBOUND", goods:[{lotRef:"LOT-X",qtyKg:1000}], destinationLocationId:1 };
const lotX = { number:"LOT-X", product:"Peppers", physicalKg:0, receivedKg:0, movements:[], locationId:9 };
T("INBOUND receipt: IN movement, received+physical, In Stock", () => {
  const { lots } = postShipmentToLots(inbound, [lotX], deps);
  const l = lots[0];
  assert.equal(l.physicalKg, 1000); assert.equal(l.receivedKg, 1000); assert.equal(l.status, "In Stock");
  assert.equal(l.movements.length, 1); assert.equal(l.movements[0].type, "IN");
});
T("OUTBOUND: SHIP_OUT with goods-level soRef", () => {
  const out = { number:"SHP-11", purpose:"OUTBOUND", soRefs:["SO-9"], goods:[{lotRef:"LOT-X",qtyKg:400,soRef:"SO-9"}] };
  const stocked = { ...lotX, physicalKg:1000, receivedKg:1000 };
  const { lots } = postShipmentToLots(out, [stocked], deps);
  assert.equal(lots[0].physicalKg, 600);
  assert.equal(lots[0].movements[0].type, "SHIP_OUT");
  assert.equal(lots[0].movements[0].soRef, "SO-9");
});
T("direct lot: PASS-THROUGH PAIR — received counted, physical net 0 (decision 2)", () => {
  const direct = { ...lotX, directFlow: true };
  const sh = { number:"SHP-12", purpose:"INBOUND", soRefs:["SO-7"], goods:[{lotRef:"LOT-X",qtyKg:1000,soRef:"SO-7"}], destinationLocationId:2 };
  const { lots } = postShipmentToLots(sh, [direct], deps);
  const l = lots[0];
  assert.equal(l.receivedKg, 1000);
  assert.equal(l.physicalKg, 0);
  assert.equal(l.movements.length, 2);
  assert.equal(l.movements[0].type, "IN");
  assert.equal(l.movements[1].type, "SHIP_OUT");
  assert.equal(l.movements[1].soRef, "SO-7");
  assert.equal(l.status, "Delivered (direct)");
});
T("idempotent: second apply is a no-op", () => {
  const once = postShipmentToLots(inbound, [lotX], deps).lots;
  const twice = postShipmentToLots(inbound, once, deps).lots;
  assert.equal(twice[0].movements.length, 1);
  assert.strictEqual(twice[0], once[0]);
});
T("TRANSFER purpose moves stock without changing quantities", () => {
  const stocked = { ...lotX, physicalKg:1000, receivedKg:1000, locationId:1 };
  const sh = { number:"SHP-13", purpose:"TRANSFER", goods:[{lotRef:"LOT-X",qtyKg:1000}], destinationLocationId:3 };
  const { lots } = postShipmentToLots(sh, [stocked], deps);
  assert.equal(lots[0].physicalKg, 1000); assert.equal(lots[0].locationId, 3);
  assert.equal(lots[0].movements[0].type, "TRANSFER");
});
T("responsibilityForPOShipment: DAP/DDP → Supplier (kills the hardcoded Marianna)", () => {
  assert.equal(responsibilityForPOShipment({ buyIncoterm:"DDP" }, false), "Supplier");
  assert.equal(responsibilityForPOShipment({ buyIncoterm:"DAP" }, false), "Supplier");
  assert.equal(responsibilityForPOShipment({ buyIncoterm:"EXW" }, false), "Marianna");
  assert.equal(responsibilityForPOShipment({ buyIncoterm:"EXW" }, true), "Supplier");
});

console.log("── decision 1: precise partial receipt ──");
T("partially received PO: only the remainder counts as incoming", () => {
  const partLot = { number:"LOT-P", product:"Peppers", availableKg:8000, poRef:"PO-9", physicalKg:8000, receivedKg:8000 };
  const po9 = { number:"PO-9", status:"Confirmed", items:[{id:1,product:"Peppers",available:14300}] };
  const items = [{ id:1, product:"Peppers", qty:10000, sourceType:"STOCK", sourceRef:"LOT-P" }];
  const [a] = computeLineAvailability(items, [], 1, [partLot], [po9]);
  assert.equal(a.primaryAvailable, 8000);
  assert.equal(a.otherPOKg, 6300);           // 14300 − 8000 still on the way
  assert.equal(a.combinedAvailable, 14300);  // no double-count, no under-count
});
T("fully received PO still contributes 0 (T-22 preserved)", () => {
  const fullLot = { number:"LOT-F", product:"Peppers", availableKg:4300, poRef:"PO-8", physicalKg:4300, receivedKg:14300 };
  const po8 = { number:"PO-8", status:"Confirmed", items:[{id:1,product:"Peppers",available:14300}] };
  const items = [{ id:1, product:"Peppers", qty:10000, sourceType:"STOCK", sourceRef:"LOT-F" }];
  const [a] = computeLineAvailability(items, [], 1, [fullLot], [po8]);
  assert.equal(a.otherPOKg, 0);
  assert.equal(a.combinedAvailable, 4300);
});

// ── Batch 3b: EXW collection builder + OUTBOUND pass-through ──
const { buildCollectionShipment, nextShipmentNumberPure } = require("./build/shipments.domain.js");

console.log("── EXW collection (decision 2, Batch 3b) ──");
const exwSO = { id: 5, number: "SO-2026-0009", client: { name: "Fresh Client GmbH" },
  items: [{ id: 1, product: "Peppers", variety: "Red California", qty: 5000, packaging: "5 kg carton", sourceType: "STOCK", sourceRef: "LOT-W" }] };
const whLot = { number: "LOT-W", product: "Peppers", poRef: "PO-4", locationId: 1, physicalKg: 8000, receivedKg: 8000, movements: [] };

T("buildCollectionShipment: minimal record — OUTBOUND, Client responsibility, no legs/costs", () => {
  const sh = buildCollectionShipment(exwSO, [whLot], [], { date: "2026-07-05", truckPlate: "WZ 123", driverName: "Jan" }, deps);
  assert.equal(sh.purpose, "OUTBOUND");
  assert.equal(sh.costResponsibility, "Client");
  assert.equal(sh.legs.length, 0);
  assert.equal(sh.costs.length, 0);
  assert.equal(sh.goods.length, 1);
  assert.equal(sh.goods[0].lotRef, "LOT-W");
  assert.equal(sh.goods[0].soRef, "SO-2026-0009");
  assert.equal(sh.originLocationId, 1);   // origin = where the lot sits
  assert.equal(sh.collection.truckPlate, "WZ 123");
});
T("collection numbering follows the SHP-YYYY-NNNN sequence", () => {
  const n = nextShipmentNumberPure([{ number: "SHP-2026-0007" }, { number: "SHP-2025-0099" }], 2026);
  assert.equal(n, "SHP-2026-0008");
});
T("collecting a DIRECT lot at the producer posts the pass-through pair (OUTBOUND)", () => {
  const producerLot = { number: "LOT-D", product: "Peppers", poRef: "PO-6", locationId: 44, directFlow: true, physicalKg: 0, receivedKg: 0, movements: [] };
  const dirSO = { id: 6, number: "SO-2026-0010", client: { name: "X" }, items: [{ id: 1, product: "Peppers", qty: 3000, sourceType: "PO", sourceRef: "PO-6" }] };
  const sh = buildCollectionShipment(dirSO, [producerLot], [], { date: "2026-07-05" }, deps);
  assert.equal(sh.goods[0].lotRef, "LOT-D");
  const { lots } = postShipmentToLots(sh, [producerLot], deps);
  const l = lots[0];
  assert.equal(l.receivedKg, 3000);          // ownership counted at handover
  assert.equal(l.physicalKg, 0);             // never our warehouse stock
  assert.equal(l.movements.length, 2);
  assert.equal(l.movements[0].type, "IN");
  assert.equal(l.movements[1].type, "SHIP_OUT");
  assert.equal(l.movements[1].soRef, "SO-2026-0010");
});
T("collection of stocked lot ships out normally on apply", () => {
  const sh = buildCollectionShipment(exwSO, [whLot], [], { date: "2026-07-05" }, deps);
  const { lots } = postShipmentToLots(sh, [whLot], deps);
  assert.equal(lots[0].physicalKg, 3000);   // 8000 − 5000
  assert.equal(lots[0].movements[0].type, "SHIP_OUT");
});

// ── Batch 3c: multi-source groupage (BP-53) ──
const { appendSourceGoods } = require("./build/shipments.domain.js");

console.log("── groupage: appendSourceGoods ──");
T("appending a second PO merges goods + refs and resolves lots", () => {
  const sh = { number:"SHP-20", purpose:"INBOUND", poRefs:["PO-1"], soRefs:[], lotRefs:["LOT-1"],
    goods:[{ id:1, poRef:"PO-1", soRef:"", lotRef:"LOT-1", product:"Peppers", qtyKg:8000 }] };
  const po2 = { number:"PO-2", status:"Confirmed", items:[{ id:1, product:"Apples", variety:"Gala", qty:5000, pallets:10 }] };
  const lots = [{ number:"LOT-2", poRef:"PO-2", product:"Apples", locationId:3 }];
  const out = appendSourceGoods(sh, "PO", po2, lots, deps);
  assert.equal(out.goods.length, 2);
  assert.equal(out.goods[1].poRef, "PO-2");
  assert.equal(out.goods[1].lotRef, "LOT-2");
  assert.deepEqual(out.poRefs, ["PO-1","PO-2"]);
  assert.deepEqual(out.lotRefs, ["LOT-1","LOT-2"]);
});
T("appending an SO carries the soRef per goods line (sales groupage)", () => {
  const sh = { number:"SHP-21", purpose:"OUTBOUND", poRefs:[], soRefs:["SO-1"], lotRefs:["LOT-1"],
    goods:[{ id:1, poRef:"", soRef:"SO-1", lotRef:"LOT-1", product:"Peppers", qtyKg:4000 }] };
  const so2 = { number:"SO-2", status:"Confirmed", items:[{ id:1, product:"Peppers", qty:3000, sourceType:"STOCK", sourceRef:"LOT-9" }] };
  const lots = [{ number:"LOT-9", product:"Peppers", locationId:1 }];
  const out = appendSourceGoods(sh, "SO", so2, lots, deps);
  assert.equal(out.goods.length, 2);
  assert.equal(out.goods[1].soRef, "SO-2");
  assert.equal(out.goods[1].lotRef, "LOT-9");
  assert.deepEqual(out.soRefs, ["SO-1","SO-2"]);
});
T("posting a two-SO groupage delivery ships both lots against their own SOs", () => {
  const lots = [
    { number:"LOT-1", product:"Peppers", physicalKg:5000, receivedKg:5000, movements:[], locationId:1 },
    { number:"LOT-9", product:"Peppers", physicalKg:4000, receivedKg:4000, movements:[], locationId:1 },
  ];
  const sh = { number:"SHP-22", purpose:"OUTBOUND", soRefs:["SO-1","SO-2"],
    goods:[{ lotRef:"LOT-1", qtyKg:4000, soRef:"SO-1" }, { lotRef:"LOT-9", qtyKg:3000, soRef:"SO-2" }] };
  const { lots: out } = postShipmentToLots(sh, lots, deps);
  assert.equal(out[0].physicalKg, 1000);
  assert.equal(out[0].movements[0].soRef, "SO-1");
  assert.equal(out[1].physicalKg, 1000);
  assert.equal(out[1].movements[0].soRef, "SO-2");
});

// ── Batch 3d: lifecycle next-action + customs migration ──
const { nextShipmentAction, canonicalStatus, normalizeCustoms } = require("./build/shipments.domain.js");

console.log("── lifecycle: single next action (BP-22) ──");
T("legacy statuses map to canonical", () => {
  assert.equal(canonicalStatus("Confirmed"), "Booked");
  assert.equal(canonicalStatus("Arrived"), "Loaded");
  assert.equal(canonicalStatus("In Transit"), "Loaded");
});
T("next action follows the chain", () => {
  assert.equal(nextShipmentAction({ status:"Draft" }).to, "Booked");
  assert.equal(nextShipmentAction({ status:"Booked" }).to, "Loaded");
  assert.equal(nextShipmentAction({ status:"Loaded" }).to, "Delivered");
  assert.equal(nextShipmentAction({ status:"Delivered" }).to, "Closed");
  assert.equal(nextShipmentAction({ status:"Confirmed" }).to, "Loaded"); // legacy → Booked → next
});
T("closed / cancelled have no next action", () => {
  assert.equal(nextShipmentAction({ status:"Closed" }), null);
  assert.equal(nextShipmentAction({ status:"Cancelled" }), null);
});

console.log("── customs: string → object migration (BP-27) ──");
T("legacy 'not required' string → applies:false, cleared", () => {
  const c = normalizeCustoms("Not required - EU road");
  assert.equal(c.applies, false); assert.equal(c.status, "cleared"); assert.equal(c.role, "not_required");
});
T("legacy broker string → applies:true, pending, place preserved", () => {
  const c = normalizeCustoms("CustomsPro / Gdansk");
  assert.equal(c.applies, true); assert.equal(c.status, "pending"); assert.equal(c.place, "CustomsPro / Gdansk");
  assert.equal(c._migratedFrom, "CustomsPro / Gdansk");
});
T("already-structured customs passes through untouched", () => {
  const obj = { applies:true, role:"our_broker", status:"cleared", place:"X" };
  assert.strictEqual(normalizeCustoms(obj), obj);
});
T("T1 detected from legacy text", () => {
  assert.equal(normalizeCustoms("T1 transit + local broker").t1Transit, true);
});

// ── Batch 4a: computed document links (BP-3 / BP-49) ──
const { computedPOLinks, computedSOLinks, poSalesLink } = require("./build/documents.domain.js");

console.log("── computed links: PO ──");
const po = { number:"PO-1", items:[{ id:1, product:"Peppers", qty:10000 }] };
const shipments = [
  { number:"SHP-1", poRefs:["PO-1"], goods:[] },
  { number:"SHP-2", poRefs:[], goods:[{ poRef:"PO-1" }] },      // goods-level link
  { number:"SHP-3", poRefs:["PO-9"], goods:[] },                 // unrelated
];
const lots = [{ number:"LOT-1", poRef:"PO-1" }, { number:"LOT-2", poRef:"PO-9" }];
const orders = [{ number:"SO-5", status:"Confirmed", items:[{ sourceType:"PO", sourceRef:"PO-1", qty:4000, product:"Peppers" }] }];
const invoices = [{ number:"PINV-1", poRef:"PO-1" }, { number:"PINV-2", poRef:"PO-2" }];

T("PO shipments computed from header + goods refs", () => {
  const l = computedPOLinks(po, { shipments, lots, invoices, orders });
  assert.deepEqual(l.linkedShipments.sort(), ["SHP-1","SHP-2"]);
  assert.deepEqual(l.linkedLots, ["LOT-1"]);
  assert.deepEqual(l.linkedInvoices, ["PINV-1"]);
  assert.deepEqual(l.linkedSalesOrders, ["SO-5"]);
});

console.log("── computed links: SO ──");
T("SO shipments + stock lot computed", () => {
  const so = { number:"SO-5", items:[{ sourceType:"STOCK", sourceRef:"LOT-1" }] };
  const shps = [{ number:"SHP-7", soRefs:["SO-5"], goods:[] }, { number:"SHP-8", soRefs:[], goods:[{ soRef:"SO-5" }] }];
  const l = computedSOLinks(so, { shipments: shps, invoices: [], lots: [] });
  assert.deepEqual(l.linkedShipments.sort(), ["SHP-7","SHP-8"]);
  assert.deepEqual(l.linkedLots, ["LOT-1"]);
});

console.log("── PO sales link (BP-3) ──");
T("unsold PO", () => { assert.equal(poSalesLink(po, []).state, "Unsold"); });
T("partially sold (40%)", () => {
  const r = poSalesLink(po, orders);
  assert.equal(r.state, "Partial"); assert.equal(r.pct, 40);  // single SO, 4000/10000
});
T("fully sold", () => {
  const full = [{ number:"SO-5", status:"Confirmed", items:[{ sourceType:"PO", sourceRef:"PO-1", qty:10000, product:"Peppers" }] }];
  assert.equal(poSalesLink(po, full).state, "Fully");
});
T("multiple orders", () => {
  const multi = [
    { number:"SO-5", status:"Confirmed", items:[{ sourceType:"PO", sourceRef:"PO-1", qty:3000, product:"Peppers" }] },
    { number:"SO-6", status:"Confirmed", items:[{ sourceType:"PO", sourceRef:"PO-1", qty:2000, product:"Peppers" }] },
  ];
  const r = poSalesLink(po, multi);
  assert.equal(r.state, "Multiple"); assert.equal(r.linkedSOs.length, 2);
});
T("cancelled SO doesn't count as sold", () => {
  const canc = [{ number:"SO-9", status:"Cancelled", items:[{ sourceType:"PO", sourceRef:"PO-1", qty:10000, product:"Peppers" }] }];
  assert.equal(poSalesLink(po, canc).state, "Unsold");
});

// ── Batch 4b: trade-flow shim (BP-1 / BP-12) ──
const { flowToStruct, structToFlow, reconcilePOFlow, isDirectCargoPlan } = require("./build/tradeFlow.domain.js");

console.log("── trade flow: struct ⇄ legacy key ──");
const ALL_FLOWS = ["EXP_EXWS","EXP_FOB","EXP_CIF","EXP_DDP_EU","EXP_DDP_XEU","IMP_EXWS_WH","IMP_EXWS_DIR","IMP_CIF_WH","IMP_CIF_DIR","IMP_DDP_WH","IMP_DDP_DIR"];
T("every legacy flow decomposes to structured fields", () => {
  ALL_FLOWS.forEach(f => {
    const s = flowToStruct(f);
    assert.ok(s, `${f} has struct`);
    assert.ok(["EXPORT","IMPORT"].includes(s.tradeMovement), `${f} movement`);
  });
});
T("round-trip flow → struct → flow is stable for import flows", () => {
  ["IMP_EXWS_WH","IMP_EXWS_DIR","IMP_CIF_WH","IMP_CIF_DIR","IMP_DDP_WH","IMP_DDP_DIR"].forEach(f => {
    assert.equal(structToFlow(flowToStruct(f)), f, `${f} round-trips`);
  });
});
T("direct cargo plan flags directFlow", () => {
  assert.equal(isDirectCargoPlan(flowToStruct("IMP_CIF_DIR")), true);
  assert.equal(isDirectCargoPlan(flowToStruct("IMP_CIF_WH")), false);
});
T("reconcile: structured fields present → flow derived, directFlow set", () => {
  const po = reconcilePOFlow({ tradeMovement:"IMPORT", purchaseIncoterm:"CIF", handoverPoint:"dest_port", cargoPlan:"DIRECT_TO_CLIENT" });
  assert.equal(po.flow, "IMP_CIF_DIR");
  assert.equal(po.directFlow, true);
});
T("reconcile: legacy flow only → structured fields backfilled", () => {
  const po = reconcilePOFlow({ flow:"IMP_DDP_WH" });
  assert.equal(po.tradeMovement, "IMPORT");
  assert.equal(po.purchaseIncoterm, "DDP");
  assert.equal(po.cargoPlan, "OUR_WAREHOUSE");
});
T("export client pickup maps to EXP_EXWS", () => {
  assert.equal(structToFlow({ tradeMovement:"EXPORT", cargoPlan:"CLIENT_PICKUP" }), "EXP_EXWS");
});
T("DAP purchase treated like DDP for warehouse plan", () => {
  assert.equal(structToFlow({ tradeMovement:"IMPORT", purchaseIncoterm:"DAP", cargoPlan:"OUR_WAREHOUSE" }), "IMP_DDP_WH");
});
T("unknown flow degrades without throwing", () => {
  assert.equal(flowToStruct("NONSENSE"), null);
  assert.equal(reconcilePOFlow({ flow:"NONSENSE" }).flow, "NONSENSE");
});

// ── Test round 2 fixes: FB-7 groupage notes + BP-56 handover wording ──
const { handoverTextForIncoterm, handoverPointForIncoterm } = require("./build/tradeFlow.domain.js");

console.log("── FB-7: groupage notes name all sources ──");
T("appending a 2nd PO puts BOTH refs in the notes", () => {
  const sh = { number:"SHP-30", notes:"Pre-carriage for PO-1", poRefs:["PO-1"], soRefs:[], lotRefs:["LOT-1"], goods:[{ poRef:"PO-1", lotRef:"LOT-1", product:"X", qtyKg:1000 }] };
  const po2 = { number:"PO-2", status:"Confirmed", items:[{ id:1, product:"Y", qty:2000 }] };
  const out = appendSourceGoods(sh, "PO", po2, [{ number:"LOT-2", poRef:"PO-2", product:"Y" }], deps);
  assert.ok(out.notes.includes("PO-1") && out.notes.includes("PO-2"), "both refs in notes: " + out.notes);
  assert.deepEqual(out.poRefs, ["PO-1","PO-2"]);
});

console.log("── BP-56: handover derived from incoterm ──");
T("CIF handover text mentions port of discharge", () => {
  assert.match(handoverTextForIncoterm("CIF","IMPORT"), /discharge/i);
});
T("EXW handover text mentions collect at origin", () => {
  assert.match(handoverTextForIncoterm("EXW","IMPORT"), /origin|collect/i);
});
T("handover POINT derived per incoterm", () => {
  assert.equal(handoverPointForIncoterm("CIF"), "dest_port");
  assert.equal(handoverPointForIncoterm("EXW"), "supplier");
  assert.equal(handoverPointForIncoterm("DDP"), "our_wh");
});
T("empty incoterm → prompt text, no throw", () => {
  assert.match(handoverTextForIncoterm("",""), /select/i);
});

console.log("");
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
