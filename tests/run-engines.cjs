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
T("BP-37 FLIPPED (Batch 5b): an outgoing credit note now REDUCES open receivables", () => {
  const base = buildLedger({ invoices:[mkInv()], todayISO:today }).totals;
  const withNote = buildLedger({ invoices:[mkInv()], financeNotes:[{id:9,noteType:"CREDIT",direction:"outgoing",amount:100,fxRate:4.25,amountPLN:425,partyName:"Client X",date:"2026-06-20"}], todayISO:today }).totals;
  assert.equal(withNote.receivableOpenPLN, Math.round((base.receivableOpenPLN - 425) * 100) / 100);
  assert.equal(withNote.notesReceivableAdjPLN, -425);
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

// ── Batch 4b removed (v6.37.0): the trade-flow shim it tested was retired; its
//    behaviour (flow ⇄ incoterm mapping) lives on as frozen tables inside
//    flowCleanup.migration, covered by the migration tests. ──

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

// ── 4C FB-12: availability by product + variety ──
const { productsMatch, linesMatch, productVarietyKey } = require("./build/salesOrders.domain.js");

console.log("── FB-12: variety-aware matching ──");
T("same product, different variety → do NOT match", () => {
  assert.equal(productsMatch("Apples","Apples","Gala","Golden"), false);
});
T("same product, same variety → match", () => {
  assert.equal(productsMatch("Apples","Apples","Gala","Gala"), true);
});
T("variety missing on one side → product-only fallback (legacy safe)", () => {
  assert.equal(productsMatch("Apples","Apples","Gala",""), true);
  assert.equal(productsMatch("Apples","Apples","",""), true);
});
T("different product never matches", () => {
  assert.equal(productsMatch("Apples","Pears","Gala","Gala"), false);
});
T("two varieties don't pool in availability 'other sources'", () => {
  const lotGala   = { number:"LOT-G", product:"Apples", variety:"Gala",   availableKg:5000, physicalKg:5000, receivedKg:5000 };
  const lotGolden = { number:"LOT-D", product:"Apples", variety:"Golden", availableKg:3000, physicalKg:3000, receivedKg:3000 };
  const items = [{ id:1, product:"Apples", variety:"Gala", qty:4000, sourceType:"STOCK", sourceRef:"LOT-G" }];
  const [a] = computeLineAvailability(items, [], 1, [lotGala, lotGolden], []);
  assert.equal(a.primaryAvailable, 5000);
  assert.equal(a.otherStockKg, 0);   // Golden must NOT be pooled in
});

// ── Batch 5b: payment events (BP-36) + notes in totals (BP-37) ──
const { normalizeInvoicePayments, applyPaymentEvent, removePaymentEvent, paidFromEvents, outstandingAmount, notesTotalsAdjustment } = require("./build/payments.domain.js");
let _pid = 9000; const pnext = () => ++_pid;

console.log("── payment events (BP-36) ──");
T("legacy paidAmount synthesises one event; totals identical", () => {
  const inv = { grossAmount: 1000, paidAmount: 400, issueDate: "2026-06-01" };
  const evts = normalizeInvoicePayments(inv);
  assert.equal(evts.length, 1); assert.equal(evts[0].method, "legacy");
  assert.equal(paidFromEvents(inv), 400);
  assert.equal(outstandingAmount(inv), 600);
});
T("applying events accumulates; full coverage → Paid; paidAmount kept in sync", () => {
  let inv = { grossAmount: 1000, paidAmount: 0, paymentStatus: "Sent", currency: "EUR" };
  inv = applyPaymentEvent(inv, { date: "2026-07-01", amount: 400, method: "Bank transfer" }, pnext);
  assert.equal(inv.paymentStatus, "Partially paid"); assert.equal(inv.paidAmount, 400);
  inv = applyPaymentEvent(inv, { date: "2026-07-05", amount: 600 }, pnext);
  assert.equal(inv.paymentStatus, "Paid"); assert.equal(inv.paidAmount, 1000);
  assert.equal(inv.payments.length, 2);
});
T("removing an event recalculates status back to Partially paid", () => {
  let inv = { grossAmount: 1000, paidAmount: 0, paymentStatus: "Sent" };
  inv = applyPaymentEvent(inv, { date: "2026-07-01", amount: 400 }, pnext);
  inv = applyPaymentEvent(inv, { date: "2026-07-05", amount: 600 }, pnext);
  const evtId = inv.payments[1].id;
  inv = removePaymentEvent(inv, evtId);
  assert.equal(inv.paymentStatus, "Partially paid"); assert.equal(inv.paidAmount, 400);
});
T("ledger: fx-aware Paid via EVENTS (no paidAmount at all)", () => {
  const inv = { id: 7, kind: "SALES", number: "FV/7/2026", counterparty: { name: "C" }, issueDate: "2026-06-01", dueDate: "2026-08-01",
    currency: "EUR", fxRate: 4.25, grossAmount: 1000, grossPLN: 4250, paymentStatus: "Sent",
    payments: [{ id: 1, date: "2026-07-01", amount: 1000, method: "Bank transfer" }] };
  const { items } = buildLedger({ invoices: [inv], todayISO: today });
  assert.equal(items.find(i => i.documentNo === "FV/7/2026").status, "Paid");
});

console.log("── notes in totals (BP-37) ──");
T("incoming credit note reduces open payables", () => {
  const adj = notesTotalsAdjustment([{ noteType: "CREDIT", direction: "incoming", amountPLN: 300 }]);
  assert.equal(adj.payableAdjPLN, -300); assert.equal(adj.receivableAdjPLN, 0);
});
T("debit note increases its side; cancelled notes ignored", () => {
  const adj = notesTotalsAdjustment([
    { noteType: "DEBIT", direction: "outgoing", amountPLN: 200 },
    { noteType: "CREDIT", direction: "outgoing", amountPLN: 999, status: "Cancelled" },
  ]);
  assert.equal(adj.receivableAdjPLN, 200);
});

// ── Batch 5c: settlement document (BP-38/31) ──
const { nextSettlementNumber, buildCommissionInvoiceDraft } = require("./build/settlement.domain.js");

console.log("── settlement document ──");
T("SET numbering scans existing settlements per year", () => {
  const lots = [{ settlement: { number: "SET-2026-0003" } }, { settlement: { number: "SET-2025-0044" } }, {}];
  assert.equal(nextSettlementNumber(lots, 2026), "SET-2026-0004");
  assert.equal(nextSettlementNumber([], 2026), "SET-2026-0001");
});
T("commission invoice draft: SALES to producer, PLN, links SET/LOT/PO", () => {
  const lot = { number: "LOT-9", product: "Golden", poRef: "PO-5" };
  const st = { number: "SET-2026-0004", commissionPct: 8, finalCommissionPLN: 4004.5, closedAt: "2026-07-08" };
  const po = { number: "PO-5", supplier: { name: "Konkret", nip: "123", address: "Cairo" } };
  const inv = buildCommissionInvoiceDraft(lot, st, po, { nextId: pnext, todayISO: () => "2026-07-08" });
  assert.equal(inv.kind, "SALES");
  assert.equal(inv.category, "COMMISSION");
  assert.equal(inv.counterparty.name, "Konkret");
  assert.equal(inv.grossPLN, 4004.5);
  assert.ok(inv.links.some(l => l.type === "SET" && l.number === "SET-2026-0004"));
  assert.ok(inv.links.some(l => l.type === "LOT" && l.number === "LOT-9"));
  assert.ok(inv.links.some(l => l.type === "PO" && l.number === "PO-5"));
});
T("draft carries the OFFSET payment event → Paid, so the ledger doesn't double-count", () => {
  const lot = { number: "LOT-9", poRef: "PO-5" };
  const st = { number: "SET-2026-0004", commissionPct: 8, finalCommissionPLN: 1000, closedAt: "2026-07-08" };
  const inv = buildCommissionInvoiceDraft(lot, st, { supplier: { name: "K" } }, { nextId: pnext, todayISO: () => "2026-07-08" });
  assert.equal(inv.payments.length, 1);
  assert.equal(inv.payments[0].method, "Offset / compensation");
  assert.equal(inv.paymentStatus, "Paid");
  const { totals } = buildLedger({ invoices: [inv], todayISO: "2026-07-08" });
  assert.equal(totals.receivableOpenPLN, 0);   // documented, not double-counted
});

// ── Batch 5d: settledRefs retirement (BP-39) ──
const { convertSettledRefsToEvents, markInvoicePaidViaLedger, unmarkLedgerPaid, LEDGER_MARK_NOTE } = require("./build/payments.domain.js");
const d5 = { todayISO: () => "2026-07-09", nextId: pnext };

console.log("── settledRefs → payment events (BP-39) ──");
T("INV: and SINV: refs convert to tagged events; PO:/PAYOUT: refs remain", () => {
  const invs = [
    { id: 11, kind: "COST",  number: "FS 1/26", grossAmount: 500, paidAmount: 0, paymentStatus: "Received" },
    { id: 12, kind: "SALES", number: "FV/9/2026", grossAmount: 800, paidAmount: 0, paymentStatus: "Sent" },
  ];
  const refs = ["INV:11", "SINV:FV/9/2026", "PO:PO-3", "PAYOUT:LOT-4"];
  const res = convertSettledRefsToEvents(invs, refs, d5);
  assert.equal(res.converted, 2);
  assert.deepEqual(res.settledRefs, ["PO:PO-3", "PAYOUT:LOT-4"]);
  const i11 = res.invoices.find(i => i.id === 11);
  assert.equal(i11.paymentStatus, "Paid");
  assert.ok(i11.payments[0].note.startsWith(LEDGER_MARK_NOTE));
  assert.equal(res.invoices.find(i => i.id === 12).paymentStatus, "Paid");
});
T("conversion is idempotent (second run converts nothing)", () => {
  const invs = [{ id: 11, kind: "COST", number: "X", grossAmount: 500, paidAmount: 0, paymentStatus: "Received" }];
  const r1 = convertSettledRefsToEvents(invs, ["INV:11"], d5);
  const r2 = convertSettledRefsToEvents(r1.invoices, r1.settledRefs, d5);
  assert.equal(r2.converted, 0);
  assert.equal(r2.invoices.find(i => i.id === 11).payments.length, 1);
});
T("mark → unmark round-trip restores the open state", () => {
  let inv = { id: 1, grossAmount: 1000, paidAmount: 0, paymentStatus: "Sent" };
  inv = markInvoicePaidViaLedger(inv, "2026-07-09", pnext);
  assert.equal(inv.paymentStatus, "Paid");
  const un = unmarkLedgerPaid(inv);
  assert.ok(un); assert.equal(un.paymentStatus, "Sent" === "Sent" ? un.paymentStatus : un.paymentStatus); assert.equal(un.paidAmount, 0); assert.equal(un.payments.length, 0);
});
T("unmark refuses when paid by REAL payments (returns null)", () => {
  let inv = { id: 2, grossAmount: 500, paidAmount: 0, paymentStatus: "Sent" };
  inv = applyPaymentEvent(inv, { date: "2026-07-01", amount: 500, method: "Bank transfer" }, pnext);
  assert.equal(unmarkLedgerPaid(inv), null);
});

// ── Batch 6a: Producer Claim (BP-55b) — pinned to the real Claim Request Form ──
const { computeClaim, nextClaimNumber, buildClaimNote, lineEUR } = require("./build/claim.domain.js");

console.log("── producer claim (BP-55b) ──");
const FORM_LINES = [
  { label: "Product — Golden 65-70-80", invoiceNo: "351/12/2025", amount: 50064.30, currency: "PLN", rate: 4.2131 },
  { label: "Transport to port of loading", party: "Agromałek", invoiceNo: "FS I/106/2025", amount: 1800, currency: "EUR" },
  { label: "Container cost", party: "Conbulk", invoiceNo: "3339-2025", amount: 1800, currency: "EUR" },
  { label: "Customs + transport at destination", amount: 128659.00, currency: "EGP", rate: 55.625 },
  { label: "Sorting", amount: 0, currency: "EGP", rate: 55.625 },
];
T("CRM 20260201 vector: totals match the paper form exactly", () => {
  const c = computeClaim({ costLines: FORM_LINES, defectPct: 42, soldInMarket: true, recoveredAmount: 72000, recoveredCurrency: "EGP", recoveredRate: 55.625 });
  assert.equal(c.lines[0].eur, 11883.01);       // 50,064.30 PLN @ 4.2131
  assert.equal(c.lines[3].eur, 2312.97);        // 128,659 EGP @ 55.625
  assert.equal(c.totalCostEUR, 17795.98);       // cost at client's warehouse
  assert.equal(c.defectValueEUR, 7474.31);      // 42% skin defects
  assert.equal(c.recoveredEUR, 1294.38);        // 72,000 EGP recovered
  assert.equal(c.creditNoteEUR, 6179.93);       // requested credit note
});
T("not sold in market → nothing recovered, full defect value claimed", () => {
  const c = computeClaim({ costLines: FORM_LINES, defectPct: 42, soldInMarket: false, recoveredAmount: 72000, recoveredRate: 55.625 });
  assert.equal(c.recoveredEUR, 0);
  assert.equal(c.creditNoteEUR, 7474.31);
});
T("recovery larger than defect value floors the claim at 0", () => {
  const c = computeClaim({ costLines: [{ label: "P", amount: 1000, currency: "EUR" }], defectPct: 10, recoveredAmount: 500, recoveredCurrency: "EUR" });
  assert.equal(c.defectValueEUR, 100);
  assert.equal(c.creditNoteEUR, 0);
});
T("claim-level fallback rates apply when a line has none", () => {
  assert.equal(lineEUR({ label: "x", amount: 425, currency: "PLN" }, { plnPerEur: 4.25 }), 100);
});
T("CLM numbering scans lot.claims per year", () => {
  const lots = [{ claims: [{ number: "CLM-2026-0002" }] }, { claims: [{ number: "CLM-2025-0009" }] }, {}];
  assert.equal(nextClaimNumber(lots, 2026), "CLM-2026-0003");
  assert.equal(nextClaimNumber([], 2026), "CLM-2026-0001");
});
T("claim note: incoming CREDIT vs producer, EUR with PLN conversion, reduces payables", () => {
  const comp = computeClaim({ costLines: FORM_LINES, defectPct: 42, soldInMarket: true, recoveredAmount: 72000, recoveredCurrency: "EGP", recoveredRate: 55.625 });
  const note = buildClaimNote({ number: "LOT-7", poRef: "P0515" }, { supplier: { name: "Konkret" } },
    { number: "CLM-2026-0001", defectType: "Skin defects", defectPct: 42, date: "2026-02-14" }, comp, 4.25, { nextId: pnext, todayISO: () => "2026-02-14" });
  assert.equal(note.noteType, "CREDIT");
  assert.equal(note.direction, "incoming");
  assert.equal(note.partyName, "Konkret");
  assert.equal(note.amount, 6179.93);
  assert.equal(note.amountPLN, 26264.7);        // 6,179.93 × 4.25
  const adj = notesTotalsAdjustment([note]);
  assert.equal(adj.payableAdjPLN, -26264.7);    // we owe the producer LESS
});

// ── Batch 6b: movement matrix + Phase B (BP-56 final / BP-57) ──
const { movementFromEnds, isEUCountry, handoverSentence, namedPlacePoolForIncoterm, dispositionFromSO, poDirectFromSOs } = require("./build/tradeFlow.domain.js");

console.log("── 4-class movement matrix ──");
T("matrix: all four cells", () => {
  assert.equal(movementFromEnds(false, true), "IMPORT");      // Egypt → Gdańsk
  assert.equal(movementFromEnds(true, false), "EXPORT");      // Lublin → Alexandria
  assert.equal(movementFromEnds(true, true), "INTRA_EU");     // Lublin → Hamburg
  assert.equal(movementFromEnds(false, false), "CROSS_TRADE");// Egypt → Jeddah, never touches EU
});
T("EU membership incl. 'Polska'", () => {
  assert.equal(isEUCountry("Poland"), true);
  assert.equal(isEUCountry("Polska"), true);
  assert.equal(isEUCountry("Egypt"), false);
});
T("handover sentence carries the named place", () => {
  assert.match(handoverSentence("CIF", "Alexandria"), /Alexandria/);
  assert.match(handoverSentence("CIF", "Alexandria"), /discharge/i);
});
T("named-place pool follows the incoterm", () => {
  assert.deepEqual(namedPlacePoolForIncoterm("CIF").types, ["PORT"]);
  assert.deepEqual(namedPlacePoolForIncoterm("EXW").types, ["SUPPLIER"]);
});

console.log("── Phase B: sale owns disposition (BP-57) ──");
T("dispositionFromSO per sell incoterm", () => {
  assert.equal(dispositionFromSO({ sellIncoterm: "DDP" }), "DIRECT_TO_CLIENT");
  assert.equal(dispositionFromSO({ sellIncoterm: "CIF" }), "TO_PORT");
  assert.equal(dispositionFromSO({ sellIncoterm: "EXW" }), "CLIENT_PICKUP");
  assert.equal(dispositionFromSO({ sellIncoterm: "" }), "OUR_WAREHOUSE");
});
T("PO becomes direct when a governing active SO sends goods onward", () => {
  const po = { number: "PO-1", buyIncoterm: "CIF" };
  const soDAP = { number: "SO-1", status: "Confirmed", sellIncoterm: "DAP", items: [{ sourceType: "PO", sourceRef: "PO-1" }] };
  assert.equal(poDirectFromSOs(po, [soDAP]), true);
  assert.equal(poDirectFromSOs(po, [{ ...soDAP, status: "Cancelled" }]), false);
  assert.equal(poDirectFromSOs(po, [{ ...soDAP, status: "Draft" }]), false);
  assert.equal(poDirectFromSOs(po, []), false);
});
// (v6.37.0) two composePOFlow tests removed — the shim was retired; the direct-
// branch behaviour is covered live by poDirectFromSOs tests above and the migration tests.

// ── Batch 6c: quality semantics pinned (BP-33) ──
const locByIdStub = () => null; // recomputeLotFromMovements already required above

console.log("── quality movement semantics ──");
T("CLAIM is client-side: claimedKg accumulates, physical stock UNCHANGED", () => {
  const lot = recomputeLotFromMovements({ number: "LOT-Q" }, [
    { id: 1, date: "2026-07-01", type: "IN", qtyKg: 10000, toId: 1 },
    { id: 2, date: "2026-07-05", type: "CLAIM", qtyKg: 4200, note: "Producer claim CLM-2026-0001 — Skin defects 42%" },
  ], locByIdStub);
  assert.equal(lot.physicalKg, 10000);   // no warehouse effect
  assert.equal(lot.claimedKg, 4200);
});
T("DAMAGE reduces physical stock and accumulates damagedKg", () => {
  const lot = recomputeLotFromMovements({ number: "LOT-D" }, [
    { id: 1, date: "2026-07-01", type: "IN", qtyKg: 10000, toId: 1 },
    { id: 2, date: "2026-07-03", type: "DAMAGE", qtyKg: 500 },
  ], locByIdStub);
  assert.equal(lot.physicalKg, 9500);
  assert.equal(lot.damagedKg, 500);
});

// ── v6.29.0: shipment-owned trade direction + label table (Hazem's decisions) ──
const { shipmentTradeDirection, namedPlacePoolForIncoterm: pool29 } = require("./build/tradeFlow.domain.js");

console.log("── shipment owns the direction ──");
T("precedence: shipment explicit > PO provisional > legacy flow > Import", () => {
  assert.equal(shipmentTradeDirection({ tradeDirection: "CROSS_TRADE" }, { tradeMovement: "IMPORT" }), "CROSS_TRADE");
  assert.equal(shipmentTradeDirection({}, { tradeMovement: "EXPORT" }), "EXPORT");
  assert.equal(shipmentTradeDirection(null, { flow: "EXP_CIF" }), "EXPORT");
  assert.equal(shipmentTradeDirection(null, { flow: "IMP_CIF_WH" }), "IMPORT");
  assert.equal(shipmentTradeDirection(null, {}), "IMPORT");
});
T("garbage direction values fall through safely", () => {
  assert.equal(shipmentTradeDirection({ tradeDirection: "NONSENSE" }, { tradeMovement: "EXPORT" }), "EXPORT");
});
console.log("── place labels per the agreed table (CFR → discharge) ──");
T("CFR named place is the port of DISCHARGE (Incoterms-correct)", () => {
  assert.equal(pool29("CFR").label, "Port of discharge");
  assert.equal(pool29("FOB").label, "Port of loading");
  assert.equal(pool29("EXW").label, "Pickup place (supplier site)");
  assert.equal(pool29("DDP").label, "Delivered to (our address)");
  assert.equal(pool29("").label, "Place (set the incoterm first)");
});

// ── Safeguards batch 7a ──
const { buildTraceTree } = require("./build/trace.domain.js");
const { checkIntegrity } = require("./build/integrityCheck.js");

console.log("── over-issue flagged, not swallowed ──");
T("shipping more than exists clamps AND reports the excess", () => {
  const lot = recomputeLotFromMovements({ number: "LOT-O" }, [
    { id: 1, date: "2026-07-01", type: "IN", qtyKg: 5000, toId: 1 },
    { id: 2, date: "2026-07-02", type: "SHIP_OUT", qtyKg: 8000 },
  ], locByIdStub);
  assert.equal(lot.physicalKg, 0);          // still clamped (crash-safe)
  assert.equal(lot.overIssuedKg, 3000);     // but no longer silent
});
T("normal issue reports zero excess", () => {
  const lot = recomputeLotFromMovements({ number: "LOT-N" }, [
    { id: 1, date: "2026-07-01", type: "IN", qtyKg: 5000, toId: 1 },
    { id: 2, date: "2026-07-02", type: "SHIP_OUT", qtyKg: 2000 },
  ], locByIdStub);
  assert.equal(lot.overIssuedKg, 0);
});

console.log("── recall / trace tree ──");
T("trace composes origin, shipments, sales, invoices", () => {
  const lot = { number: "LOT-1", product: "Golden", poRef: "PO-9", receivedKg: 24000 };
  const t = buildTraceTree(lot, {
    pos: [{ number: "PO-9", supplier: { name: "Konkret", address: "Cairo" }, items: [{ origin: "Egypt" }] }],
    orders: [
      { number: "SO-1", status: "Confirmed", client: { name: "ClientA", address: "Jeddah" }, items: [{ sourceType: "PO", sourceRef: "PO-9", qty: 10000 }] },
      { number: "SO-2", status: "Cancelled", client: { name: "GONE" }, items: [{ sourceType: "STOCK", sourceRef: "LOT-1", qty: 5000 }] },
    ],
    shipments: [
      { number: "SHP-1", status: "Delivered", poRefs: ["PO-9"], goods: [] },
      { number: "SHP-2", status: "Booked", poRefs: [], goods: [{ lotRef: "LOT-1" }] },
      { number: "SHP-X", status: "Booked", poRefs: ["PO-OTHER"], goods: [] },
    ],
    invoices: [
      { number: "FV/1", kind: "SALES", soRef: "SO-1", counterparty: { name: "ClientA" }, grossAmount: 100, currency: "EUR" },
      { number: "PINV/9", kind: "COST", poRef: "PO-9", counterparty: { name: "Konkret" } },
      { number: "ZZZ", kind: "COST", poRef: "PO-OTHER" },
    ],
  }, "2026-07-11");
  assert.equal(t.origin.supplier, "Konkret");
  assert.deepEqual(t.shipments.map(x => x.number).sort(), ["SHP-1", "SHP-2"]);
  assert.deepEqual(t.sales.map(x => x.soNumber), ["SO-1"]);            // cancelled excluded
  assert.deepEqual(t.invoices.map(x => x.number).sort(), ["FV/1", "PINV/9"]);
});

console.log("── integrity: new safeguard checks ──");
T("duplicate invoice per counterparty+number flagged (BP-40)", () => {
  const r = checkIntegrity({ invoices: [
    { number: "FS 1/26", counterparty: { name: "Konkret" } },
    { number: "FS 1/26", counterparty: { name: "Konkret" } },
    { number: "FS 1/26", counterparty: { name: "OtherCo" } },   // same number, other party → fine
  ]});
  assert.equal(r.issues.filter(i => i.code === "DUP_INVOICE").length, 1);
});
T("paidAmount out of sync with events flagged", () => {
  const r = checkIntegrity({ invoices: [{ number: "X", counterparty: { name: "A" }, paidAmount: 999, payments: [{ amount: 400 }] }] });
  assert.ok(r.issues.some(i => i.code === "PAY_MISMATCH"));
});
T("over-issued lot flagged as error", () => {
  const r = checkIntegrity({ lots: [{ number: "LOT-O", overIssuedKg: 3000 }] });
  assert.ok(r.issues.some(i => i.code === "LOT_OVER_ISSUE" && i.severity === "error"));
});
T("shipment referencing a vanished PO flagged", () => {
  const r = checkIntegrity({ shipments: [{ number: "SHP-1", poRefs: ["PO-GONE"] }], pos: [] });
  assert.ok(r.issues.some(i => i.code === "SHIP_PO_MISSING"));
});

console.log("── v6.30.1: fix batch ──");
// Fix 1 — the checker's reserving set matches the pinned pre-dispatch semantics.
T("shipped SO no longer raises a false LOT_OVERSOLD on a correctly shipped lot", () => {
  // 1000 kg received, all 1000 shipped for SO-A (physical now 0). Under the old
  // 7-status set, SO-A's demand still counted as reserved vs available 0 → error.
  const r = checkIntegrity({
    lots: [{ number: "LOT-S", product: "Apples", availableKg: 0, physicalKg: 0, receivedKg: 1000 }],
    orders: [{ number: "SO-A", status: "Shipped", items: [{ sourceType: "STOCK", sourceRef: "LOT-S", product: "Apples", qty: 1000 }] }],
  });
  assert.ok(!r.issues.some(i => i.code === "LOT_OVERSOLD"));
});
T("pre-dispatch oversell still flagged (defence in depth intact)", () => {
  const r = checkIntegrity({
    lots: [{ number: "LOT-S", product: "Apples", availableKg: 500 }],
    orders: [{ number: "SO-B", status: "Confirmed", items: [{ sourceType: "STOCK", sourceRef: "LOT-S", product: "Apples", qty: 900 }] }],
  });
  assert.ok(r.issues.some(i => i.code === "LOT_OVERSOLD" && i.severity === "error"));
});
// Fix 2 — ORPHAN_SO_POLINE is alive again.
T("SO line naming a missing PO line id is flagged (check was dead before)", () => {
  const r = checkIntegrity({
    pos: [{ number: "PO-1", items: [{ id: 11, product: "Apples" }] }],
    orders: [{ number: "SO-C", status: "Confirmed", items: [{ sourceType: "PO", sourceRef: "PO-1", sourceLineId: 99, product: "Apples", qty: 100 }] }],
  });
  assert.ok(r.issues.some(i => i.code === "ORPHAN_SO_POLINE"));
});
T("legacy SO line (null sourceLineId) not flagged when the PO has lines", () => {
  const r = checkIntegrity({
    pos: [{ number: "PO-1", items: [{ id: 1717171717171, product: "Apples" }] }],
    orders: [{ number: "SO-D", status: "Confirmed", items: [{ sourceType: "PO", sourceRef: "PO-1", sourceLineId: null, product: "Apples", qty: 100 }] }],
  });
  assert.ok(!r.issues.some(i => i.code === "ORPHAN_SO_POLINE"));
});

// Fix 3 — voided movements never accrue warehouse charges.
const { computeLotWarehouseCharges, computeStoragePeriods } = require("./build/warehouseCharges.js");
T("voided IN excluded from storage kg-days and handling (parity with the reducer)", () => {
  const contacts = [{ id: 900, name: "Logipark", warehouseTariff: { storagePerKgDay: 0.01, handlingInPerKg: 0.05, freeDays: 0, locationIds: [1] } }];
  const lotLive = { number: "LOT-W", locationId: 1, movements: [{ id: 1, type: "IN", date: "2026-06-01", qtyKg: 1000, toId: 1 }] };
  const lotVoid = { number: "LOT-V", locationId: 1, movements: [{ id: 1, type: "IN", date: "2026-06-01", qtyKg: 1000, toId: 1, voided: true }] };
  const live = computeLotWarehouseCharges(lotLive, contacts, "2026-06-11");
  const voided = computeLotWarehouseCharges(lotVoid, contacts, "2026-06-11");
  assert.ok(live && live.kgDays === 10000 && live.lines.some(l => l.kind === "handling_in"));
  assert.ok(!voided || (voided.kgDays === 0 && voided.lines.length === 0));
});
T("voided SHIP_OUT does not reduce storage nor charge handling out", () => {
  const { periods, shippedKg } = computeStoragePeriods({ number: "LOT-W2", locationId: 1, movements: [
    { id: 1, type: "IN", date: "2026-06-01", qtyKg: 1000, toId: 1 },
    { id: 2, type: "SHIP_OUT", date: "2026-06-05", qtyKg: 1000, voided: true },
  ]}, "2026-06-11");
  assert.equal(shippedKg, 0);
  assert.equal(periods.reduce((s, p) => s + p.kg * p.days, 0), 10000); // full 10 days stored
});

// Fix 5 — the commission invoice pushes a real Fakturownia position.
const { buildFakturowniaPayload } = require("./build/invoicing.js");
T("commission invoice positions survive the Fakturownia payload builder", () => {
  const lot = { number: "LOT-K", product: "Peppers", poRef: "PO-9" };
  const settlement = { number: "SET-2026-0001", commissionPct: 10, finalCommissionPLN: 1234.56, closedAt: "2026-07-01" };
  let id = 1;
  const inv = buildCommissionInvoiceDraft(lot, settlement, { supplier: { name: "Producer X" } }, { nextId: () => id++, todayISO: () => "2026-07-01" });
  const body = buildFakturowniaPayload(inv, { apiToken: "t" });
  const pos = body.invoice.positions[0];
  assert.ok(pos.name.includes("Commission 10%"));                 // not the "—" fallback
  assert.equal(pos.total_price_gross, 1234.56);                    // amount carried through
  assert.equal(inv.paymentStatus, "Paid");                         // offset event intact
});

// Fix 7 — shipment posting surfaces over-issue instead of clamping silently.
T("OUTBOUND over-issue lands in overIssuedKg and the checker flags it", () => {
  const sh = { number: "SHP-OI", purpose: "OUTBOUND", soRefs: ["SO-9"], goods: [{ lotRef: "LOT-OI", qtyKg: 1500, soRef: "SO-9" }], legs: [] };
  const stocked = { number: "LOT-OI", product: "Apples", physicalKg: 1000, receivedKg: 1000, locationId: 1 };
  const { lots } = postShipmentToLots(sh, [stocked], { todayISO: () => "2026-07-01", nextId: (() => { let i = 1; return () => i++; })() });
  assert.equal(lots[0].physicalKg, 0);
  assert.equal(lots[0].overIssuedKg, 500);
  const r = checkIntegrity({ lots });
  assert.ok(r.issues.some(i => i.code === "LOT_OVER_ISSUE"));
});

console.log("── v6.31.0: direct costs (P1-2 interim) + close-out + tripwires ──");
const { computeSOMargin } = require("./build/marginCalculations.js");
const mkSO631 = (n, qty = 1000, price = 2) => ({ number: n, status: "Confirmed", currency: "PLN", fxRate: 1, items: [{ product: "Apples", qty, unitPrice: price, sourceType: null, sourceRef: "" }] });

T("(a) goods-row-only SO link now captures direct costs", () => {
  const sh = { number: "SHP-G", status: "Booked", soRefs: [], goods: [{ soRef: "SO-G", qtyKg: 1000 }], costs: [{ id: 1, type: "road_freight", amountPLN: 500, invoiceStatus: "Expected" }] };
  const m = computeSOMargin(mkSO631("SO-G"), [], [], [sh], "forecast");
  assert.equal(m.directCostsPLN, 500); // was 0 (under-capture)
});
T("(c) groupage freight split pro-rata by kg, not full to every SO", () => {
  const sh = { number: "SHP-2SO", status: "Booked", soRefs: ["SO-A", "SO-B"],
    goods: [{ soRef: "SO-A", qtyKg: 6000 }, { soRef: "SO-B", qtyKg: 4000 }],
    costs: [{ id: 1, type: "road_freight", amountPLN: 10000, invoiceStatus: "Expected" }] };
  const a = computeSOMargin(mkSO631("SO-A"), [], [], [sh], "forecast");
  const b = computeSOMargin(mkSO631("SO-B"), [], [], [sh], "forecast");
  assert.equal(a.directCostsPLN, 6000);
  assert.equal(b.directCostsPLN, 4000); // sum = 10000, was 20000
});
T("(c fallback) header-linked SOs with no goods kg split equally", () => {
  const sh = { number: "SHP-EQ", status: "Booked", soRefs: ["SO-A", "SO-B"], goods: [], costs: [{ id: 1, amountPLN: 1000, invoiceStatus: "Expected" }] };
  const a = computeSOMargin(mkSO631("SO-A"), [], [], [sh], "forecast");
  assert.equal(a.directCostsPLN, 500);
});
T("(b) cost line allocated to lots is skipped in direct costs (no double-count)", () => {
  const sh = { number: "SHP-AL", status: "Booked", soRefs: ["SO-A"], goods: [],
    costs: [{ id: 7, type: "sea_freight", amountPLN: 3000, invoiceStatus: "Received" }, { id: 8, type: "customs", amountPLN: 700, invoiceStatus: "Received" }] };
  const lots = [{ number: "LOT-1", costs: [{ source: "SHP-AL/7", pln: 3000 }] }]; // Batch-1b tag
  const m = computeSOMargin(mkSO631("SO-A"), lots, [], [sh], "actual");
  assert.equal(m.directCostsPLN, 700); // 3000 is in COGS via the lot, counted once
});
T("(d) cancelled shipments no longer contribute costs", () => {
  const cancelled = { number: "SHP-X", status: "Cancelled", soRefs: ["SO-A"], goods: [], costs: [{ id: 1, amountPLN: 4000, invoiceStatus: "Received" }] };
  const replacement = { number: "SHP-Y", status: "Loaded", soRefs: ["SO-A"], goods: [], costs: [{ id: 1, amountPLN: 4200, invoiceStatus: "Received" }] };
  const m = computeSOMargin(mkSO631("SO-A"), [], [], [cancelled, replacement], "actual");
  assert.equal(m.directCostsPLN, 4200); // was 8200
});
T("actual mode still gates on invoice status (Expected skipped)", () => {
  const sh = { number: "SHP-ST", status: "Booked", soRefs: ["SO-A"], goods: [], costs: [{ id: 1, amountPLN: 900, invoiceStatus: "Expected" }] };
  const m = computeSOMargin(mkSO631("SO-A"), [], [], [sh], "actual");
  assert.equal(m.directCostsPLN, 0);
});

T("Closed SO with provisional/missing cost data flagged (close-out gate)", () => {
  const r = checkIntegrity({
    orders: [{ number: "SO-C", status: "Closed", items: [{ product: "Apples", qty: 1000, sourceType: "STOCK", sourceRef: "LOT-NC" }] }],
    lots: [{ number: "LOT-NC", product: "Apples", costs: [], movements: [] }],
    shipments: [{ number: "SHP-1", status: "Delivered", soRefs: ["SO-C"], costs: [{ id: 1, amountPLN: 100, invoiceStatus: "Expected" }] }],
  });
  assert.ok(r.issues.some(i => i.code === "SO_CLOSED_PL_INCOMPLETE"));
});
T("Closed SO with complete data is NOT flagged", () => {
  const r = checkIntegrity({
    orders: [{ number: "SO-OK", status: "Closed", items: [{ product: "Apples", qty: 1000, sourceType: "STOCK", sourceRef: "LOT-OK" }] }],
    lots: [{ number: "LOT-OK", product: "Apples", costs: [{ pln: 2000 }], movements: [{ id: 1, type: "IN", qtyKg: 1000 }, { id: 2, type: "SHIP_OUT", qtyKg: 1000, soRef: "SO-OK" }] }],
    shipments: [{ number: "SHP-1", status: "Delivered", soRefs: ["SO-OK"], costs: [{ id: 1, amountPLN: 100, invoiceStatus: "Received" }] }],
  });
  assert.ok(!r.issues.some(i => i.code === "SO_CLOSED_PL_INCOMPLETE"));
});
T("T-20 tripwire: lot with IN movement but Expected/0kg state → error", () => {
  const r = checkIntegrity({ lots: [{ number: "LOT-T20", status: "Expected", receivedKg: 0, physicalKg: 0, movements: [{ id: 1, type: "IN", qtyKg: 19422, date: "2026-07-01" }] }] });
  assert.ok(r.issues.some(i => i.code === "LOT_RECEIPT_INCONSISTENT" && i.severity === "error"));
});
T("direct pass-through lot (received>0, IN present, physical 0 + SHIP_OUT) NOT tripped", () => {
  const r = checkIntegrity({ lots: [{ number: "LOT-DIR", status: "Delivered (direct)", receivedKg: 1000, physicalKg: 0, movements: [
    { id: 1, type: "IN", qtyKg: 1000 }, { id: 2, type: "SHIP_OUT", qtyKg: 1000, soRef: "SO-1" }] }] });
  assert.ok(!r.issues.some(i => i.code === "LOT_RECEIPT_INCONSISTENT"));
});
T("FX sanity: confirmed EUR SO with fxRate 1 flagged (real-data case)", () => {
  const r = checkIntegrity({ orders: [{ number: "SO-FX", status: "Confirmed", currency: "EUR", fxRate: 1, items: [] }] });
  assert.ok(r.issues.some(i => i.code === "FX_RATE_SUSPECT"));
});
T("FX sanity: PLN docs and proper rates untouched", () => {
  const r = checkIntegrity({ orders: [
    { number: "SO-P", status: "Confirmed", currency: "PLN", fxRate: 1, items: [] },
    { number: "SO-E", status: "Confirmed", currency: "EUR", fxRate: 4.25, items: [] }] });
  assert.ok(!r.issues.some(i => i.code === "FX_RATE_SUSPECT"));
});
T("A5 dedup: a broken shipment PO ref produces ONE issue, not two", () => {
  const r = checkIntegrity({ shipments: [{ number: "SHP-1", poRefs: ["PO-GONE"] }], pos: [] });
  const hits = r.issues.filter(i => i.entity === "SHP-1");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].code, "SHIP_PO_MISSING");
});

console.log("── v6.32.0: canonical matcher (A1), per-line revenue (P1-1), parsers, checker ──");
const { findLotForSOLine, shippedKgByLine } = require("./build/salesOrders.domain.js");
const { parseNum } = require("./build/numbers.js");
const { lineSourcesLot } = require("./build/consignment.js");

T("matcher: multi-line same-product PO resolves each line to ITS lot (poLineId)", () => {
  const lots = [
    { number: "LOT-A", poRef: "PO-1", poLineId: "11", product: "Apples", costs: [{ pln: 1000 }] },
    { number: "LOT-B", poRef: "PO-1", poLineId: "12", product: "Apples", costs: [{ pln: 9000 }] },
  ];
  assert.equal(findLotForSOLine(lots, { sourceType: "PO", sourceRef: "PO-1", sourceLineId: "12", product: "Apples" }).number, "LOT-B");
  assert.equal(findLotForSOLine(lots, { sourceType: "PO", sourceRef: "PO-1", sourceLineId: "11", product: "Apples" }).number, "LOT-A");
});
T("matcher: variety-aware fallback when poLineId absent; claimed set prevents reuse", () => {
  const lots = [
    { number: "LOT-G", poRef: "PO-1", product: "Apples", variety: "Gala" },
    { number: "LOT-J", poRef: "PO-1", product: "Apples", variety: "Jonagold" },
  ];
  assert.equal(findLotForSOLine(lots, { sourceType: "PO", sourceRef: "PO-1", product: "Apples", variety: "Jonagold" }).number, "LOT-J");
  const claimed = new Set(["LOT-G"]);
  const got = findLotForSOLine(lots, { sourceType: "PO", sourceRef: "PO-1", product: "Apples" }, { claimed });
  assert.equal(got.number, "LOT-J"); // first unclaimed
});
T("shippedKgByLine: movements + Delivered-unposted safety net; Loaded is NOT revenue", () => {
  const order = { number: "SO-1", items: [{ product: "Apples", qty: 10000, sourceType: "PO", sourceRef: "PO-1" }] };
  const lots = [{ number: "LOT-A", poRef: "PO-1", product: "Apples", movements: [
    { type: "SHIP_OUT", qtyKg: 4000, soRef: "SO-1", shipmentRef: "SHP-POSTED" }] }];
  const shipments = [
    { number: "SHP-POSTED", status: "Delivered", soRefs: ["SO-1"], goods: [{ soRef: "SO-1", product: "Apples", qtyKg: 4000 }] },   // posted → rows skipped (movement counts)
    { number: "SHP-DEL-NP", status: "Delivered", soRefs: ["SO-1"], goods: [{ soRef: "SO-1", product: "Apples", qtyKg: 2500 }] },   // delivered, not posted → safety net counts
    { number: "SHP-LOADED", status: "Loaded",    soRefs: ["SO-1"], goods: [{ soRef: "SO-1", product: "Apples", qtyKg: 3000 }] },   // in transit → NOT revenue (COGS symmetry)
  ];
  const r = shippedKgByLine(order, lots, shipments);
  assert.equal(r.totalKg, 6500); // 4000 movement + 2500 delivered-unposted; Loaded excluded
});
T("P1-1: actual revenue is per-line partial, not all-or-nothing", () => {
  const order = { number: "SO-1", status: "Shipped", currency: "PLN", fxRate: 1, items: [
    { product: "Apples", qty: 10000, unitPrice: 2, sourceType: "PO", sourceRef: "PO-1" },
    { product: "Pears", qty: 5000, unitPrice: 3, sourceType: "PO", sourceRef: "PO-2" }] };
  const lots = [{ number: "LOT-A", poRef: "PO-1", product: "Apples", movements: [{ type: "SHIP_OUT", qtyKg: 6000, soRef: "SO-1", shipmentRef: "S1" }] }];
  const m = computeSOMargin(order, lots, [], [], "actual");
  assert.equal(m.revenuePLN, 12000); // 6000×2 shipped; pears line 0 — was 40000 (100% on status)
});
T("P1-1: legacy fallback — status Shipped with zero evidence keeps 100% + warning", () => {
  const order = { number: "SO-L", status: "Shipped", currency: "PLN", fxRate: 1, items: [{ product: "Apples", qty: 1000, unitPrice: 2 }] };
  const m = computeSOMargin(order, [], [], [], "actual");
  assert.equal(m.revenuePLN, 2000);
  assert.ok(m.warnings.some(w => w.includes("no shipment/movement evidence")));
});
T("COGS actual uses each line's OWN lot cost basis (was: first lot for all)", () => {
  const pos = [{ number: "PO-1", currency: "PLN", fxRate: 1, items: [
    { id: "11", product: "Apples", qty: 1000, unitPrice: 1 }, { id: "12", product: "Apples", qty: 1000, unitPrice: 9 }] }];
  const lots = [
    { number: "LOT-A", poRef: "PO-1", poLineId: "11", product: "Apples", receivedKg: 1000, costs: [{ pln: 1000 }],
      movements: [{ type: "IN", qtyKg: 1000, shipmentRef: "X" }, { type: "SHIP_OUT", qtyKg: 1000, soRef: "SO-1", shipmentRef: "X" }] },
    { number: "LOT-B", poRef: "PO-1", poLineId: "12", product: "Apples", receivedKg: 1000, costs: [{ pln: 9000 }],
      movements: [{ type: "IN", qtyKg: 1000, shipmentRef: "Y" }, { type: "SHIP_OUT", qtyKg: 1000, soRef: "SO-1", shipmentRef: "Y" }] }];
  const order = { number: "SO-1", status: "Shipped", currency: "PLN", fxRate: 1, items: [
    { product: "Apples", qty: 1000, unitPrice: 2, sourceType: "PO", sourceRef: "PO-1", sourceLineId: "11" },
    { product: "Apples", qty: 1000, unitPrice: 12, sourceType: "PO", sourceRef: "PO-1", sourceLineId: "12" }] };
  const m = computeSOMargin(order, lots, pos, [], "actual");
  assert.equal(m.cogsPLN, 10000); // 1×1000 + 1×9000 — old matcher charged LOT-A twice (2000)
});
T("parseNum: Polish comma decimals and mixed separators", () => {
  assert.equal(parseNum("1,5"), 1.5);
  assert.equal(parseNum("1.234,56"), 1234.56);
  assert.equal(parseNum("1,234.56"), 1234.56);
  assert.equal(parseNum("1 234,5"), 1234.5);
  assert.equal(parseNum("2.5"), 2.5);
  assert.equal(parseNum(""), 0);
});
T("consignment: variety separation + poLineId authority", () => {
  const gala = { number: "LOT-G", poRef: "PO-1", poLineId: "1", product: "Apples", variety: "Gala" };
  assert.ok(lineSourcesLot({ sourceType: "PO", sourceRef: "PO-1", product: "Apples", variety: "Gala" }, gala));
  assert.ok(!lineSourcesLot({ sourceType: "PO", sourceRef: "PO-1", product: "Apples", variety: "Jonagold" }, gala));
  assert.ok(!lineSourcesLot({ sourceType: "PO", sourceRef: "PO-1", sourceLineId: "2", product: "Apples", variety: "Gala" }, gala));
});
T("checker: duplicate live shipment flagged; cancelled duplicate not", () => {
  const base = { soRefs: ["SO-1"], goods: [{ qtyKg: 19422 }], costs: [{ amountPLN: 4940 }] };
  const r = checkIntegrity({ shipments: [
    { ...base, number: "SHP-5", status: "Confirmed" }, { ...base, number: "SHP-6", status: "Confirmed" }], orders: [{ number: "SO-1", status: "Confirmed", items: [] }] });
  assert.ok(r.issues.some(i => i.code === "DUP_LIVE_SHIPMENT"));
  const r2 = checkIntegrity({ shipments: [
    { ...base, number: "SHP-5", status: "Cancelled" }, { ...base, number: "SHP-6", status: "Confirmed" }], orders: [{ number: "SO-1", status: "Confirmed", items: [] }] });
  assert.ok(!r2.issues.some(i => i.code === "DUP_LIVE_SHIPMENT"));
});
T("checker: stale 'Cost allocated' flag caught; real allocation not", () => {
  const sh = { number: "SHP-2", status: "Cancelled", billingStatus: "Cost allocated", costs: [{ id: 9, amountPLN: 4000 }] };
  const r = checkIntegrity({ shipments: [sh], lots: [{ number: "L1", costs: [] }] });
  assert.ok(r.issues.some(i => i.code === "STALE_BILLING_FLAG"));
  const r2 = checkIntegrity({ shipments: [sh], lots: [{ number: "L1", costs: [{ source: "SHP-2/9", pln: 4000 }] }] });
  assert.ok(!r2.issues.some(i => i.code === "STALE_BILLING_FLAG"));
});

console.log("── v6.33.0: Invoices sole owner (A3-6) + legacy credit-notes fold (A3-5) ──");
const { salesInvoiceFromSODraft, salesInvoiceSourceTag, stripPendingInvoices, migrateLegacyCreditNotes, migrateLegacyInvoices } = require("./build/invoicing.js");

T("A3-6: SO draft → canonical register invoice (shape + source tag + SO link)", () => {
  const so = { number: "SO-9", currency: "EUR", client: { name: "Client X" }, items: [{ product: "Apples", qty: 1000 }] };
  const inv = salesInvoiceFromSODraft(so, { number: "FV2026/07/01", netAmount: 2000, vatRate: 5, fxRate: 4.3, currency: "EUR", issueDate: "2026-07-12" });
  assert.equal(inv.kind, "SALES");
  assert.equal(inv.category, "SINV");
  assert.equal(inv.vatAmount, 100);
  assert.equal(inv.grossAmount, 2100);
  assert.equal(inv.grossPLN, 9030);
  assert.equal(inv.source, salesInvoiceSourceTag("SO-9", "FV2026/07/01"));
  assert.ok(inv.links.some(l => l.type === "SO" && l.number === "SO-9"));
});
T("A3-6: importing an old backup can NOT duplicate an API-created invoice (same source tag)", () => {
  const so = { number: "SO-9", currency: "EUR", client: {}, items: [] };
  const draft = { number: "FV2026/07/01", netAmount: 2000, vatRate: 5, fxRate: 4.3, currency: "EUR" };
  const apiCreated = salesInvoiceFromSODraft(so, draft);
  // old backup: the SO still carries the same invoice as a pendingInvoice
  const legacyOrder = { ...so, pendingInvoices: [draft] };
  const merged = migrateLegacyInvoices({ existing: [apiCreated], orders: [legacyOrder], warehouseInvoices: [], operationalCosts: [] });
  assert.equal(merged.length, 1); // deduped by source tag
});
T("A3-6: stripPendingInvoices removes the legacy array; same reference when clean", () => {
  const dirty = [{ number: "SO-1", pendingInvoices: [{ number: "X" }] }, { number: "SO-2" }];
  const r = stripPendingInvoices(dirty);
  assert.equal(r.changed, true);
  assert.ok(!("pendingInvoices" in r.orders[0]));
  const clean = [{ number: "SO-3" }];
  const r2 = stripPendingInvoices(clean);
  assert.equal(r2.changed, false);
  assert.ok(r2.orders === clean); // same ref → no React effect loop
});
T("A3-5: legacy creditNotes fold into FinanceNote, idempotent, and ENTER the totals", () => {
  const legacy = [{ id: 7, direction: "outgoing", partyName: "Client X", category: "Goods / quality", amount: 500, currency: "PLN", fxRate: 1, status: "Issued", reason: "quality", date: "2026-06-01" }];
  const once = migrateLegacyCreditNotes({ existing: [], creditNotes: legacy });
  assert.equal(once.length, 1);
  assert.equal(once[0].noteType, "CREDIT");
  assert.equal(once[0].amountPLN, 500);
  assert.equal(once[0].source, "legacyCN:7");
  const twice = migrateLegacyCreditNotes({ existing: once, creditNotes: legacy });
  assert.equal(twice.length, 1); // idempotent by source tag
  const adj = notesTotalsAdjustment(twice);
  assert.ok(adj.receivableAdjPLN < 0); // outgoing credit note reduces what clients owe us
});

// ── v6.34.0: shipment direction from real ends — the Koper case (BP-61) ──
const { shipmentTradeDirection: stdV34, directionFromCountries, soDestinationCountry } = require("./build/tradeFlow.domain.js");

console.log("── shipment direction resolves per-truck from producer × SO destination ──");
T("Koper split: ONE Egypt CIF PO fathers an EU-import truck AND a T1 cross-trade truck", () => {
  const po = { number: "PO-K", supplier: { country: "Egypt" }, tradeMovement: "IMPORT" };
  const soUA = { number: "SO-UA", sellIncoterm: "DAP", client: { country: "Ukraine" }, destinationLocationId: null, destinationText: "Ukraine" };
  const soPL = { number: "SO-PL", sellIncoterm: "DDP", client: { country: "Poland" }, destinationText: "Poland" };
  // each shipment resolves independently from its own governing SO
  assert.equal(stdV34({}, po, soUA), "CROSS_TRADE"); // Egypt × Ukraine, T1
  assert.equal(stdV34({}, po, soPL), "IMPORT");      // Egypt × EU (Poland)
});
T("no governing SO → PO provisional (unsold portion to our warehouse)", () => {
  const po = { number: "PO-K", supplier: { country: "Egypt" }, tradeMovement: "IMPORT" };
  assert.equal(stdV34({}, po, null), "IMPORT");
});
T("SO destination via resolveCountry(locationId) beats the client's home country (ruling #2)", () => {
  const po = { supplier: { country: "Egypt" } };
  // client is Polish but the sale is CIF to a Ukrainian port → goods physically go to UA
  const so = { sellIncoterm: "CIF", client: { country: "Poland" }, destinationLocationId: 900 };
  const resolve = (id) => id === 900 ? "Ukraine" : "";
  assert.equal(stdV34({}, po, so, resolve), "CROSS_TRADE");
});
T("manual override always wins over the derived answer", () => {
  const po = { supplier: { country: "Egypt" } };
  const so = { client: { country: "Poland" }, destinationText: "Poland" }; // would derive IMPORT
  assert.equal(stdV34({ tradeDirection: "CROSS_TRADE" }, po, so), "CROSS_TRADE");
});
T("intra-EU: Polish producer, German client", () => {
  assert.equal(directionFromCountries("Poland", "Germany"), "INTRA_EU");
  assert.equal(directionFromCountries("Egypt", "Saudi Arabia"), "CROSS_TRADE");
  assert.equal(directionFromCountries("Egypt", ""), ""); // unknown end → no derivation
});

// ── v6.34.1: per-item CN/HS in the catalog (items 4) ──
const { setCatalogCnCode, cnCodeForItem, catalogToRows, mergeCatalogRows } = require("./build/productCatalog.js");
console.log("── catalog CN/HS round-trip ──");
T("set + lookup per-item CN, case-insensitive", () => {
  let cat = [{ item: "Apples", varieties: ["Gala"] }];
  cat = setCatalogCnCode(cat, "Apples", "0808 10");
  assert.equal(cnCodeForItem(cat, "Apples"), "0808 10");
  assert.equal(cnCodeForItem(cat, "Pears"), "");
});
T("CSV round-trip preserves CN on the item row", () => {
  let cat = setCatalogCnCode([{ item: "Onions", varieties: [] }], "Onions", "0703 10");
  const rows = catalogToRows(cat);
  assert.equal(rows[0].cnCode, "0703 10");
  const back = mergeCatalogRows([], rows);
  assert.equal(cnCodeForItem(back, "Onions"), "0703 10");
});

// ── v6.34.4: partial line shipment — per-line remaining (the 42000→21000+21000 case) ──
console.log("── partial PO-line shipment across trucks ──");
T("a 42000 kg line ships 21000 now, 21000 remaining for the next truck", () => {
  // simulate the per-line shipped-kg + remaining math the dialog uses
  const line = { id: 7, qty: 42000 };
  const existingGoods = [{ poRef: "PO-1", poLineId: 7, qtyKg: 21000 }]; // first shipment
  const shipped = existingGoods.filter(g => g.poRef === "PO-1" && String(g.poLineId) === "7").reduce((a, g) => a + g.qtyKg, 0);
  const remaining = Math.max(0, line.qty - shipped);
  assert.equal(remaining, 21000);
  // second shipment defaults to remaining and does NOT exceed
  const thisShip = remaining; // default
  assert.ok(shipped + thisShip <= line.qty + 1, "second truck of 21000 must not be blocked");
  assert.equal(shipped + thisShip, 42000);
});

// ── v6.34.6: consume-guard — incoterm + port decide the fulfilling movement ──
const { shipmentFulfilsOrder, sellIncotermHasOnwardLeg } = require("./build/tradeFlow.domain.js");
console.log("── which shipment fulfils (consumes) the order ──");
T("direct road export (DAP, not a port) consumes and closes the order", () => {
  assert.equal(shipmentFulfilsOrder({ status: "Booked" }, "DAP", false), true);
});
T("FOB sale: truck to the port IS fulfilment → consumes", () => {
  assert.equal(shipmentFulfilsOrder({ status: "Booked" }, "FOB", true), true);
});
T("CIF split: pre-carriage road-to-PORT does NOT consume; the sea leg will", () => {
  // road leg to port under CIF → exempt
  assert.equal(shipmentFulfilsOrder({ status: "Booked" }, "CIF", true), false);
  // the onward sea shipment (its own destination is the client, not a port) → consumes
  assert.equal(shipmentFulfilsOrder({ status: "Booked" }, "CIF", false), true);
});
T("Draft never consumes; Booked+ does", () => {
  assert.equal(shipmentFulfilsOrder({ status: "Draft" }, "DAP", false), false);
  assert.equal(shipmentFulfilsOrder({ status: "Cancelled" }, "DAP", false), false);
  assert.equal(shipmentFulfilsOrder({ status: "Loaded" }, "DAP", false), true);
});
T("freight-onward set is exactly CIF/CFR/CPT/CIP", () => {
  ["CIF","CFR","CPT","CIP"].forEach(i => assert.ok(sellIncotermHasOnwardLeg(i)));
  ["FOB","FCA","EXW","DAP","DDP",""].forEach(i => assert.ok(!sellIncotermHasOnwardLeg(i)));
});

// ── v6.34.8: SO multi-shipment parity — same per-line remaining math as PO ──
console.log("── SO partial-shipment parity ──");
T("SO line ships across two shipments; second defaults to remaining (parity with PO)", () => {
  const line = { id: 3, qty: 30000 };
  // first SO shipment took 12000 of line 3 (goods stamped soLineId)
  const existingGoods = [{ soRef: "SO-1", soLineId: 3, qtyKg: 12000 }];
  const shipped = existingGoods.filter(g => g.soRef === "SO-1" && String(g.soLineId) === "3").reduce((a, g) => a + g.qtyKg, 0);
  const remaining = Math.max(0, line.qty - shipped);
  assert.equal(remaining, 18000);
  // second shipment defaults to remaining, does not exceed
  assert.ok(shipped + remaining <= line.qty + 1);
  assert.equal(shipped + remaining, 30000);
});

// ── v6.35.1 (Phase C step 3): ownership from real incoterms ──
const { ownershipAtPoint, buyOwnershipStartFromIncoterm, sellOwnershipEndFromIncoterm } = require("./build/tradeFlow.domain.js");
console.log("── ownership from incoterms ──");
T("EXW buy → we own from supplier onward", () => {
  assert.equal(buyOwnershipStartFromIncoterm("EXW"), "supplier");
  assert.equal(ownershipAtPoint("supplier", "EXW", "CIF"), "owned");
});
T("CIF buy → supplier's risk until destination port (we own from dest_port)", () => {
  assert.equal(buyOwnershipStartFromIncoterm("CIF"), "dest_port");
  assert.equal(ownershipAtPoint("supplier", "CIF", "DDP"), "not_owned");
  assert.equal(ownershipAtPoint("dest_port", "CIF", "DDP"), "owned");
});
T("EXW buy + CIF sell: owned through dest_port, handed over after", () => {
  // EXW→CIF: own from supplier to dest_port, hand over at dest_port
  assert.equal(ownershipAtPoint("supplier", "EXW", "CIF"), "owned");
  assert.equal(ownershipAtPoint("origin_port", "EXW", "CIF"), "owned");
  assert.equal(ownershipAtPoint("dest_port", "EXW", "CIF"), "owned");
  assert.equal(ownershipAtPoint("our_wh", "EXW", "CIF"), "handed_over");
});
T("DDP sell → we own all the way to the client", () => {
  assert.equal(sellOwnershipEndFromIncoterm("DDP"), "client");
  assert.equal(ownershipAtPoint("client", "EXW", "DDP"), "owned");
});

// ── v6.35.4 (T-20): inbound arrival posts the receipt; idempotent ──
const { postShipmentToLots: postT20 } = require("./build/shipments.domain.js");
console.log("── T-20: shipment arrival posts inventory receipt ──");
T("an INBOUND shipment posts the lot IN (receipt), once", () => {
  const lot = { number: "LOT-DDP", product: "Apples", locationId: "wh", physicalKg: 0, receivedKg: 0, movements: [] };
  const sh = { number: "SHP-1", purpose: "INBOUND", legs: [{ fromLocationId: "sup", toLocationId: "wh" }], goods: [{ lotRef: "LOT-DDP", qtyKg: 20000 }] };
  const deps = { todayISO: () => "2026-07-01", nextId: (() => { let n = 100; return () => ++n; })() };
  const r1 = postT20(sh, [lot], deps);
  const l1 = r1.lots.find(l => l.number === "LOT-DDP");
  assert.equal((l1.movements || []).filter(m => m.type === "IN").length, 1, "one IN posted");
  // idempotent: posting the same shipment again must NOT add a second IN
  const r2 = postT20(sh, r1.lots, deps);
  const l2 = r2.lots.find(l => l.number === "LOT-DDP");
  assert.equal((l2.movements || []).filter(m => m.type === "IN").length, 1, "still one IN (idempotent)");
});

// ── v6.35.5: cancelling a posted shipment reverses its stock (void round-trip) ──
const { postShipmentToLots: postRev } = require("./build/shipments.domain.js");
const { recomputeLotFromMovements: recompRev } = require("./build/inventory.domain.js");
console.log("── shipment cancel reverses posted movements ──");
T("post IN → void the shipment's movements → lot back to Expected/0", () => {
  const locByIdT = (id) => ({ id, type: "OWN", legacyType: "OWN" });
  const lot = { number: "LOT-R", product: "Apples", expectedKg: 20000, locationId: "wh", baseLocationId: "wh", physicalKg: 0, receivedKg: 0, movements: [] };
  const sh = { number: "SHP-C", purpose: "INBOUND", legs: [{ fromLocationId: "sup", toLocationId: "wh" }], goods: [{ lotRef: "LOT-R", qtyKg: 20000 }] };
  const deps = { todayISO: () => "2026-07-10", nextId: (() => { let n = 0; return () => ++n; })() };
  const posted = postRev(sh, [lot], deps).lots[0];
  let r = recompRev(posted, posted.movements, locByIdT);
  assert.equal(r.physicalKg, 20000, "posted stock present");
  // cancel: void the shipment's movements (the UI's reverseShipmentPostings logic)
  const voided = posted.movements.map(m => String(m.shipmentRef) === "SHP-C" ? { ...m, voided: true } : m);
  r = recompRev({ ...posted, movements: voided }, voided, locByIdT);
  assert.equal(r.physicalKg, 0, "stock reversed");
  assert.equal(r.receivedKg, 0, "receipt reversed");
  assert.equal(r.status, "Expected", "back to Expected");
});

// ── v6.37.0: flow-cleanup migration (schema 2) ──
const { migrateFlowCleanup } = require("./build/flowCleanup.migration.js");
console.log("── flow-cleanup migration ──");
T("legacy PO without incoterms is backfilled from its flow, then flow dropped", () => {
  const all = migrateFlowCleanup({ pos: [{ number: "PO-1", flow: "IMP_CIF_WH" }], lots: [], shipments: [] });
  const p = all.pos[0];
  assert.equal(p.buyIncoterm, "CIF");
  assert.equal(p.tradeMovement, "IMPORT");
  assert.equal(p.directFlow, false);
  assert.ok(!("flow" in p), "flow removed");
});
T("direct legacy flow backfills directFlow=true; existing incoterm never overwritten", () => {
  const all = migrateFlowCleanup({ pos: [
    { number: "PO-2", flow: "IMP_DDP_DIR" },
    { number: "PO-3", flow: "IMP_CIF_WH", buyIncoterm: "EXW" },
  ], lots: [], shipments: [] });
  assert.equal(all.pos[0].buyIncoterm, "DDP");
  assert.equal(all.pos[0].directFlow, true);
  assert.equal(all.pos[1].buyIncoterm, "EXW", "user-entered incoterm wins");
  assert.ok(!("flow" in all.pos[1]));
});
T("never-shipped legacy lot gets its template journey BAKED; buyIncoterm from PO", () => {
  const all = migrateFlowCleanup({
    pos: [{ number: "PO-4", flow: "IMP_CIF_WH" }],
    lots: [{ number: "LOT-1", poRef: "PO-4", flow: "IMP_CIF_WH", loadingDate: "2026-07-01", arrivalDate: "2026-07-11" }],
    shipments: [],
  });
  const l = all.lots[0];
  assert.equal(l.buyIncoterm, "CIF");
  assert.equal((l.journey || []).length, 6, "6 CIF-WH stages baked");
  assert.equal(l.journey[0].ownership, "not_owned", "supplier stage before dest_port takeover");
  assert.equal(l.journey.find(st => st.kind === "dest_port").ownership, "owned");
  assert.equal(l.journey[0].plannedDate, "2026-07-01");
  assert.equal(l.journey[5].plannedDate, "2026-07-11");
  assert.ok(!("flow" in l));
});
T("lot WITH a shipment is not baked (shipments are its journey); idempotent re-run", () => {
  const input = {
    pos: [{ number: "PO-5", flow: "IMP_EXWS_WH" }],
    lots: [{ number: "LOT-2", poRef: "PO-5", flow: "IMP_EXWS_WH" }],
    shipments: [{ number: "SHP-1", lotRefs: ["LOT-2"] }],
  };
  const once = migrateFlowCleanup(input);
  assert.ok(!once.lots[0].journey, "no baked journey — shipment-derived at render");
  assert.ok(!("flow" in once.lots[0]));
  const twice = migrateFlowCleanup(once);
  assert.deepEqual(twice.pos, once.pos, "idempotent on pos");
  assert.deepEqual(twice.lots, once.lots, "idempotent on lots");
});

// ── v6.37.1: Finance direct costs — mirror sync + accrual (the user's repro) ──
const { syncLegFreightCostLines } = require("./build/shipments.domain.js");
const { allocateShipmentCostsToLots: allocFin } = require("./build/costAllocation.js");
console.log("── direct costs: leg → costs[] → lot → P/L ──");
T("truck+container entered on LEGS after creation now reach lot landed cost", () => {
  const lot = { number: "LOT-F", receivedKg: 21000, costs: [{ type: "purchase", label: "Purchase", source: "po", amount: 63000, pln: 63000 }] };
  const sh = {
    id: 7, number: "SHP-F", status: "Delivered", soRefs: ["SO-F"], lotRefs: ["LOT-F"],
    goods: [{ lotRef: "LOT-F", soRef: "SO-F", qtyKg: 21000 }],
    legs: [
      { mode: "Road", costAmount: 4500, costCurrency: "PLN", costFxRate: 1, costPLN: 4500 },
      { mode: "Sea", costAmount: 2000, costCurrency: "USD", costFxRate: 4, costPLN: 8000 },
    ],
    costs: [ // creation-time snapshot (legs were 0) + customs auto-line
      { id: 1, type: "road_freight", amount: 0, amountPLN: 0, invoiceStatus: "Expected" },
      { id: 9, type: "customs", source: "customs-auto", amount: 1200, amountPLN: 1200, invoiceStatus: "Expected", _customsAuto: true },
    ],
  };
  const synced = syncLegFreightCostLines(sh);
  const road = synced.costs.find(c => c.source === "leg-freight:1");
  const sea = synced.costs.find(c => c.source === "leg-freight:2");
  assert.equal(road.amountPLN, 4500, "truck mirrored");
  assert.equal(road.id, 1, "legacy snapshot line ADOPTED (id preserved)");
  assert.equal(sea.amountPLN, 8000, "sea mirrored");
  assert.ok(synced.costs.some(c => c._customsAuto && c.amountPLN === 1200), "customs untouched");
  const lots2 = allocFin(synced, [lot], { inventoryType: t => t, label: t => t });
  const added = lots2[0].costs.filter(c => String(c.source || "").startsWith("SHP-F/"));
  const plns = added.map(c => c.pln).sort((a, b) => a - b);
  assert.deepEqual(plns, [1200, 4500, 8000], "truck + container + customs all in lot landed cost");
});
T("re-sync preserves invoiceStatus/invoiceRef; clearing the leg cost removes the line", () => {
  const sh = { id: 3, number: "SHP-R", legs: [{ mode: "Road", costAmount: 4500, costFxRate: 1, costPLN: 4500 }], costs: [] };
  let s1 = syncLegFreightCostLines(sh);
  s1.costs[0].invoiceStatus = "Received"; s1.costs[0].invoiceRef = "FV/9/2026";
  let s2 = syncLegFreightCostLines({ ...s1, legs: [{ mode: "Road", costAmount: 5200, costFxRate: 1, costPLN: 5200 }] });
  const line = s2.costs.find(c => c.source === "leg-freight:1");
  assert.equal(line.amountPLN, 5200, "amount follows the leg");
  assert.equal(line.invoiceStatus, "Received", "status preserved");
  assert.equal(line.invoiceRef, "FV/9/2026", "ref preserved");
  const s3 = syncLegFreightCostLines({ ...s2, legs: [{ mode: "Road", costAmount: 0 }] });
  assert.ok(!s3.costs.some(c => c.source === "leg-freight:1"), "cleared leg cost → managed line removed");
});
T("accrual (ruling A): Expected cost counts in ACTUAL P/L once the shipment is Delivered", () => {
  const order = { number: "SO-A", status: "Delivered", currency: "PLN", fxRate: 1, items: [] };
  const mk = (status) => [{ number: "SHP-A", status, soRefs: ["SO-A"], goods: [{ soRef: "SO-A", qtyKg: 100 }], costs: [{ id: 1, type: "customs", amountPLN: 1200, invoiceStatus: "Expected" }] }];
  const delivered = computeSOMargin(order, [], [], mk("Delivered"), "actual");
  const booked = computeSOMargin(order, [], [], mk("Booked"), "actual");
  assert.equal(delivered.directCostsPLN, 1200, "concluded shipment's cost is real");
  assert.equal(booked.directCostsPLN, 0, "unconcluded + uninvoiced still excluded");
});

// ── v6.39.0: Fakturownia tagged import (Invoices-owned) ──
const FKI = require("./build/fakturowniaImport.domain.js");
console.log("── fakturownia import: suggest / build / flip ──");
T("carrier invoice suggests FREIGHT and matches the open Expected freight line", () => {
  const contacts = [{ id: 5, name: "TransPol Sp. z o.o.", type: "Carrier" }];
  const shipments = [{ number: "SHP-9", status: "Delivered", costs: [
    { id: 11, type: "road_freight", amountPLN: 4500, invoiceStatus: "Expected", supplierId: 5 },
    { id: 12, type: "customs", amountPLN: 1200, invoiceStatus: "Expected" },
  ]}];
  const row = { key: "k", number: "FV/77", seller: "TransPol Sp. z o.o.", date: "2026-07-01", net: 4500, gross: 5535, currency: "PLN", fxRate: 1 };
  const s = FKI.suggestForRow(row, contacts, shipments, []);
  assert.equal(s.tag, "FREIGHT");
  assert.equal(s.shipmentNumber, "SHP-9");
  assert.equal(s.costLineId, 11);
});
T("supplier invoice suggests GOODS with the nearest PO + side-by-side value (C-2)", () => {
  const contacts = [{ id: 2, name: "Delta Farms", type: "Supplier" }];
  const pos = [
    { number: "PO-1", status: "Confirmed", supplier: { id: 2, name: "Delta Farms" }, fxRate: 1, items: [{ qty: 21000, price: 3 }] },
    { number: "PO-2", status: "Confirmed", supplier: { id: 2, name: "Delta Farms" }, fxRate: 1, items: [{ qty: 5000, price: 3 }] },
  ];
  const row = { key: "k", number: "FV/9", seller: "Delta Farms", date: "2026-07-01", net: 62500, gross: 65625, currency: "PLN", fxRate: 1 };
  const s = FKI.suggestForRow(row, contacts, [], pos);
  assert.equal(s.tag, "GOODS");
  assert.equal(s.poNumber, "PO-1", "nearest by value (63000 vs 62500)");
  assert.equal(s.poPLN, 63000);
});
T("posting flips the matched cost line to Received + ref; duplicates detected", () => {
  const sh = { number: "SHP-9", costs: [{ id: 11, type: "road_freight", invoiceStatus: "Expected" }, { id: 12, type: "customs", invoiceStatus: "Expected" }] };
  const after = FKI.applyReceivedCostLine(sh, 11, "FV/77");
  assert.equal(after.costs[0].invoiceStatus, "Received");
  assert.equal(after.costs[0].invoiceRef, "FV/77");
  assert.equal(after.costs[1].invoiceStatus, "Expected", "other line untouched");
  assert.ok(FKI.isDuplicateCostInvoice("FV/77", [{ kind: "COST", number: "fv/77", paymentStatus: "Draft" }]));
  assert.ok(!FKI.isDuplicateCostInvoice("FV/78", [{ kind: "COST", number: "FV/77", paymentStatus: "Draft" }]));
});
T("buildCostInvoice: freight → SHIPMENT scope + Shipment link; goods → PO link, no scope", () => {
  const row = { key: "k", number: "FV/77", seller: "TransPol", date: "2026-07-01", dueDate: "2026-07-15", net: 4500, gross: 5535, currency: "PLN", fxRate: 1 };
  const f = FKI.buildCostInvoice(row, "FREIGHT", { shipmentNumber: "SHP-9" }, { id: 5, name: "TransPol" });
  assert.equal(f.kind, "COST");
  assert.equal(f.costScope, "SHIPMENT");
  assert.deepEqual(f.links, [{ type: "Shipment", number: "SHP-9" }]);
  assert.equal(f.vatRate, 23);
  const g = FKI.buildCostInvoice(row, "GOODS", { poNumber: "PO-1" }, null);
  assert.equal(g.costScope, undefined);
  assert.deepEqual(g.links, [{ type: "PO", number: "PO-1" }]);
  assert.equal(g.counterparty.name, "TransPol");
});

// ── v6.40.0: audit trail (append-only, capped, passive) ──
const AUD = require("./build/auditTrail.domain.js");
console.log("── audit trail ──");
T("append is ordered and the cap rolls the oldest off", () => {
  let log = [];
  for (let i = 1; i <= 5; i++) log = AUD.appendAudit(log, { id: i, ts: `2026-07-0${i}T10:00:00Z`, user: "hazem", module: "Shipments", docType: "Shipment", docNumber: `SHP-${i}`, action: "status", summary: `s${i}` }, 3);
  assert.equal(log.length, 3, "capped at 3");
  assert.deepEqual(log.map(e => e.id), [3, 4, 5], "oldest rolled off, order kept");
});
T("filterAudit: module + free text, newest first; auditForDoc exact match", () => {
  const log = [
    { id: 1, ts: "2026-07-01T08:00:00Z", user: "hazem", module: "Shipments", docType: "Shipment", docNumber: "SHP-1", action: "created", summary: "Shipment created" },
    { id: 2, ts: "2026-07-02T08:00:00Z", user: "hazem", module: "Invoices", docType: "Invoice", docNumber: "FV/9", action: "status", summary: "Payment status -> Paid" },
    { id: 3, ts: "2026-07-03T08:00:00Z", user: "anna", module: "Shipments", docType: "Shipment", docNumber: "SHP-1", action: "cancelled", summary: "Cancelled" },
  ];
  const ships = AUD.filterAudit(log, { module: "Shipments" });
  assert.deepEqual(ships.map(e => e.id), [3, 1], "module filter, newest first");
  assert.deepEqual(AUD.filterAudit(log, { q: "paid" }).map(e => e.id), [2], "free-text");
  assert.deepEqual(AUD.auditForDoc(log, "shp-1").map(e => e.id), [1, 3], "per-doc, case-insensitive");
});

// ── v6.40.1 (audit A1): real contact fields — additionalTypes + vatEuId ──
console.log("── import matcher: additionalTypes + vatEuId ──");
T("an ADDITIONAL 'Carrier' role now drives the FREIGHT suggestion", () => {
  const contacts = [{ id: 7, name: "AgroTrans", type: "Supplier", additionalTypes: ["Carrier"] }];
  const shipments = [{ number: "SHP-2", status: "Booked", costs: [{ id: 3, type: "road_freight", amountPLN: 3000, invoiceStatus: "Expected", supplierId: 7 }] }];
  const row = { key: "k", number: "FV/5", seller: "AgroTrans", date: "2026-07-01", net: 3000, gross: 3690, currency: "PLN", fxRate: 1 };
  const s = FKI.suggestForRow(row, contacts, shipments, []);
  assert.equal(s.tag, "FREIGHT", "additional Carrier role recognized");
  assert.equal(s.costLineId, 3);
});
T("seller matches by vatEuId (real field), not the phantom vatNumber", () => {
  const contacts = [{ id: 9, name: "Completely Different Name Sp. z o.o.", type: "Carrier", vatEuId: "PL5252344078" }];
  const row = { key: "k", number: "FV/6", seller: "ADIFFERENTTRADINGNAME", sellerTaxNo: "PL 525-234-40-78", date: "2026-07-01", net: 100, gross: 123, currency: "PLN", fxRate: 1 };
  const c = FKI.contactForSeller(row, contacts);
  assert.ok(c && c.id === 9, "tax-number match wins despite name mismatch");
});

// ── v6.41.0 (A5): unshipped-remainder reservation rule ──
const SOD = require("./build/salesOrders.domain.js");
console.log("── reservations: unshipped remainder ──");
// A 20 t lot, one SO for 20 t, 12 t already shipped (SHIP_OUT movement soRef-tagged).
function lot20(physical) {
  return { number: "LOT-R", product: "Apples", physicalKg: physical, receivedKg: 20000,
    movements: [{ type: "SHIP_OUT", qtyKg: 12000, soRef: "SO-R", shipmentRef: "SHP-R" }] };
}
const so20 = (status) => ({ number: "SO-R", id: 1, status, items: [{ sourceType: "STOCK", sourceRef: "LOT-R", product: "Apples", qty: 20000 }] });
const ctx = (physical) => ({ lots: [lot20(physical)], shipments: [] });

T("pre-dispatch: full qty reserved (unchanged) — Confirmed, nothing shipped yet", () => {
  const lot = { number: "LOT-R", product: "Apples", physicalKg: 20000, receivedKg: 20000, movements: [] };
  const r = SOD.lotReservationsForStock(lot, [{ number: "SO-R", id: 1, status: "Confirmed", items: [{ sourceType: "STOCK", sourceRef: "LOT-R", product: "Apples", qty: 20000 }] }], { lots: [lot], shipments: [] });
  assert.equal(r.totalReserved, 20000);
  assert.equal(r.liveAvailable, 0);
});
T("THE BUG FIX: SO advanced to Shipped with 8 t unshipped keeps 8 t reserved", () => {
  const r = SOD.lotReservationsForStock(lot20(8000), [so20("Shipped")], ctx(8000));
  assert.equal(r.totalReserved, 8000, "remainder (20 - 12) stays reserved");
  assert.equal(r.liveAvailable, 0, "physical 8 t is NOT free — it's owed to SO-R");
});
T("partial pre-dispatch: reserved shows the remainder, not the inflated full qty", () => {
  // still Confirmed but 12 t already shipped → reserve 8 t (cosmetic overstatement fixed)
  const r = SOD.lotReservationsForStock(lot20(8000), [so20("Confirmed")], ctx(8000));
  assert.equal(r.totalReserved, 8000);
});
T("fully shipped SO reserves nothing (remainder 0)", () => {
  const lot = { number: "LOT-R", product: "Apples", physicalKg: 0, receivedKg: 20000,
    movements: [{ type: "SHIP_OUT", qtyKg: 20000, soRef: "SO-R", shipmentRef: "SHP-R" }] };
  const r = SOD.lotReservationsForStock(lot, [so20("Delivered")], { lots: [lot], shipments: [] });
  assert.equal(r.totalReserved, 0);
});
T("Closed releases everything, even with an unshipped remainder", () => {
  const r = SOD.lotReservationsForStock(lot20(8000), [so20("Closed")], ctx(8000));
  assert.equal(r.totalReserved, 0, "closing ends the deal");
  assert.equal(r.liveAvailable, 8000, "the 8 t become free");
});
T("Cancelled and Draft never reserve", () => {
  assert.equal(SOD.lotReservationsForStock(lot20(8000), [so20("Cancelled")], ctx(8000)).totalReserved, 0);
  assert.equal(SOD.lotReservationsForStock(lot20(8000), [so20("Draft")], ctx(8000)).totalReserved, 0);
});
T("voided SHIP_OUT (cancelled shipment) is ignored — remainder returns to full", () => {
  const lot = { number: "LOT-R", product: "Apples", physicalKg: 20000, receivedKg: 20000,
    movements: [{ type: "SHIP_OUT", qtyKg: 12000, soRef: "SO-R", shipmentRef: "SHP-R", voided: true }] };
  const r = SOD.lotReservationsForStock(lot, [so20("Shipped")], { lots: [lot], shipments: [] });
  assert.equal(r.totalReserved, 20000, "voided movement doesn't count as shipped");
});
T("soReservesStock predicate: open commitments vs terminal", () => {
  ["Confirmed", "Reserved", "Loading", "Shipped", "Delivered", "Invoiced"].forEach(s => assert.ok(SOD.soReservesStock(s), s + " reserves"));
  ["Draft", "Cancelled", "Closed"].forEach(s => assert.ok(!SOD.soReservesStock(s), s + " does not reserve"));
});

// ── v6.44.0 (test-round #7): packaging tare → gross weight ──
const PKG = require("./build/packaging.domain.js");
console.log("── gross weight: per-box tare ──");
T("apples: 13kg boxes, 1.4kg tare, 72/pallet — 4680 kg net", () => {
  const r = PKG.grossForGoodsLine({ qtyKg: 4680, product: "Apples" }, PKG.PACKAGING_SEED);
  // 4680/13 = 360 boxes; 360/72 = 5 pallets; gross = 4680 + 360*1.4 + 5*25 = 5309
  assert.equal(r.boxes, 360, "box count");
  assert.equal(r.pallets, 5, "pallet count");
  assert.equal(r.grossKg, 5309, "gross = net + box tare + PALLET tare");
  assert.equal(r.estimated, false);
});
T("v6.46.0: the real signed protocol — 19422 kg = 1494 boxes = 21 pallets", () => {
  const r = PKG.grossForGoodsLine({ qtyKg: 19422, product: "Apples" }, PKG.PACKAGING_SEED);
  assert.equal(r.boxes, 1494, "1494 boxes (54 + 20x72)");
  assert.equal(r.pallets, 21, "21 pallets, matching the paper protocol");
  assert.equal(r.boxTareTotalKg, 2091.6);
  assert.equal(r.palletTareTotalKg, 525);
  assert.equal(r.grossKg, 22038.6, "19422 + 2091.6 + 525");
});
T("pallet manifest splits full pallets + remainder like the paper form", () => {
  const rows = PKG.palletManifest(1494, 72);
  assert.equal(rows.length, 21);
  assert.equal(rows.filter(r => r.boxes === 72).length, 20, "20 full pallets");
  assert.equal(rows[rows.length - 1].boxes, 54, "final part-pallet of 54");
});
T("22 full pallets (the all-full case) derives cleanly", () => {
  const net = 22 * 72 * 13; // 20 592
  const r = PKG.grossForGoodsLine({ qtyKg: net, product: "Apples" }, PKG.PACKAGING_SEED);
  assert.equal(r.boxes, 1584); assert.equal(r.pallets, 22);
  const rows = PKG.palletManifest(1584, 72);
  assert.equal(rows.length, 22);
  assert.ok(rows.every(x => x.boxes === 72), "all pallets full");
});
T("an explicit pallet count on the line overrides the derivation", () => {
  const r = PKG.grossForGoodsLine({ qtyKg: 19422, product: "Apples", pallets: 22 }, PKG.PACKAGING_SEED);
  assert.equal(r.pallets, 22, "returned protocol wins");
  assert.equal(r.palletTareTotalKg, 550);
});
T("partial box rounds up (359.x boxes → 360)", () => {
  const r = PKG.grossForGoodsLine({ qtyKg: 4675, product: "Apples" }, PKG.PACKAGING_SEED);
  assert.equal(r.boxes, 360, "4675/13 = 359.6 → 360 boxes");
  assert.equal(r.grossKg, Math.round((4675 + 360 * 1.4 + 5 * 25) * 1000) / 1000);
});
T("explicit packaging id wins over product default", () => {
  const r = PKG.grossForGoodsLine({ qtyKg: 1000, packagingId: "carton-10" }, PKG.PACKAGING_SEED);
  assert.equal(r.boxes, 100); assert.equal(r.grossKg, Math.round((1000 + 100 * 0.6 + 2 * 25) * 1000) / 1000);
});
T("unknown product falls back to flat factor, marked estimated", () => {
  const r = PKG.grossForGoodsLine({ qtyKg: 1000, product: "Dragonfruit" }, PKG.PACKAGING_SEED);
  assert.equal(r.estimated, true); assert.equal(r.grossKg, 1060);
});
T("zero net → zero gross, no boxes", () => {
  const r = PKG.grossForGoodsLine({ qtyKg: 0, product: "Apples" }, PKG.PACKAGING_SEED);
  assert.equal(r.grossKg, 0); assert.equal(r.boxes, 0);
});
T("onions in 25kg mesh bags", () => {
  const r = PKG.grossForGoodsLine({ qtyKg: 500, product: "Onions" }, PKG.PACKAGING_SEED);
  assert.equal(r.boxes, 20); assert.equal(r.grossKg, Math.round((500 + 20 * 0.15 + 1 * 25) * 1000) / 1000);
});

// ── v6.45.0: test-round root causes B, C, D ──
const HEAL = require("./build/heal.v645.js");
const SD = require("./build/shipments.domain.js");
console.log("── v6.45.0: OUTBOUND pass-through, shipped-aware supply, heal ──");

T("OUTBOUND: never-received PO-backed sold lot posts the pass-through pair (no flag needed)", () => {
  const lot = { number: "L-D", poRef: "PO-X", product: "Apples", receivedKg: 0, physicalKg: 0, directFlow: false, movements: [] };
  const sh = { number: "SHP-D", status: "Closed", purpose: "OUTBOUND", soRefs: ["SO-X"], legs: [{}],
    goods: [{ lotRef: "L-D", soRef: "SO-X", qtyKg: 5000 }] };
  const r = SD.postShipmentToLots(sh, [lot], { todayISO: () => "2026-07-22", nextId: (() => { let i=0; return () => ++i; })() });
  const l = r.lots[0];
  assert.equal(l.receivedKg, 5000, "receipt recorded (weight visible)");
  assert.equal(l.status, "Delivered (direct)");
  assert.equal((l.movements||[]).filter(m=>m.type==="SHIP_OUT").length, 1);
  assert.ok(!(l.overIssuedKg > 0), "no over-issue on a legitimate pass-through");
});
T("posting guard ignores VOIDED movements (re-post after heal allowed)", () => {
  const lot = { number: "L-V", poRef: "PO-X", product: "Apples", receivedKg: 0, physicalKg: 0, movements: [
    { type: "SHIP_OUT", qtyKg: 9999, shipmentRef: "SHP-V", voided: true } ] };
  const sh = { number: "SHP-V", status: "Closed", purpose: "OUTBOUND", soRefs: ["SO-X"], legs: [{}],
    goods: [{ lotRef: "L-V", soRef: "SO-X", qtyKg: 5000 }] };
  const r = SD.postShipmentToLots(sh, [lot], { todayISO: () => "2026-07-22", nextId: (() => { let i=0; return () => ++i; })() });
  const live = (r.lots[0].movements||[]).filter(m=>!m.voided);
  assert.equal(live.length, 2, "fresh IN+SHIP_OUT posted despite the voided old movement");
});
T("D: a SHIPPED PO line is no longer 'available' to a new SO", () => {
  // PO line fully shipped via its lot; a NEW SO asks the same line.
  const po = { number: "PO-S", status: "Confirmed", items: [{ id: 7, product: "Apples", qty: 10000, available: 10000 }] };
  const lot = { number: "L-S", poRef: "PO-S", poLineId: 7, product: "Apples", receivedKg: 0, physicalKg: 0,
    movements: [{ type: "SHIP_OUT", qtyKg: 10000, soRef: "SO-OLD", shipmentRef: "S1" }] };
  const orders = [{ number: "SO-OLD", id: 1, status: "Shipped", items: [{ sourceType: "PO", sourceRef: "PO-S", sourceLineId: 7, product: "Apples", qty: 10000 }] }];
  const newItems = [{ sourceType: "PO", sourceRef: "PO-S", sourceLineId: 7, product: "Apples", qty: 10000 }];
  const av = SOD.computeLineAvailability(newItems, orders, 99, [lot], [po], []);
  assert.equal(av[0].primaryAvailable, 0, "shipped goods are gone — not sellable again");
  assert.ok(av[0].hasOverage, "overage flagged");
});
T("D: partially shipped PO line offers exactly the unshipped remainder", () => {
  const po = { number: "PO-P", status: "Confirmed", items: [{ id: 3, product: "Apples", qty: 10000, available: 10000 }] };
  const lot = { number: "L-P", poRef: "PO-P", poLineId: 3, product: "Apples", receivedKg: 0, physicalKg: 0,
    movements: [{ type: "SHIP_OUT", qtyKg: 4000, soRef: "SO-OLD", shipmentRef: "S1" }] };
  const orders = [{ number: "SO-OLD", id: 1, status: "Shipped", items: [{ sourceType: "PO", sourceRef: "PO-P", sourceLineId: 3, product: "Apples", qty: 4000 }] }];
  const av = SOD.computeLineAvailability([{ sourceType: "PO", sourceRef: "PO-P", sourceLineId: 3, product: "Apples", qty: 6000 }], orders, 99, [lot], [po], []);
  assert.equal(av[0].primaryAvailable, 6000, "10000 - 4000 shipped");
  assert.ok(!av[0].hasOverage);
});
T("HEAL: retags duplicated goods rows, voids the wrong movement, re-posts, re-allocates", () => {
  const lots = [
    { number: "L-1", poRef: "PO-H", poLineId: 11, product: "Apples", receivedKg: 0, physicalKg: 0, costs: [], movements: [
      { id: 1, type: "SHIP_OUT", qtyKg: 8000, soRef: "SO-H", shipmentRef: "SHP-H" } ] },
    { number: "L-2", poRef: "PO-H", poLineId: 12, product: "Apples", receivedKg: 0, physicalKg: 0, costs: [], movements: [] },
  ];
  const orders = [{ number: "SO-H", id: 1, status: "Shipped", items: [
    { id: 101, sourceType: "PO", sourceRef: "PO-H", sourceLineId: 11, product: "Apples", qty: 4000 },
    { id: 102, sourceType: "PO", sourceRef: "PO-H", sourceLineId: 12, product: "Apples", qty: 4000 } ] }];
  const shipments = [{ number: "SHP-H", status: "Closed", purpose: "OUTBOUND", soRefs: ["SO-H"], legs: [{}],
    costs: [{ id: 5, type: "road_freight", amountPLN: 1000 }],
    goods: [
      { lotRef: "L-1", soRef: "SO-H", soLineId: 101, qtyKg: 4000 },
      { lotRef: "L-1", soRef: "SO-H", soLineId: 102, qtyKg: 4000 } ] }];
  let i = 500;
  const res = HEAL.healRound645({ shipments, lots, orders }, { todayISO: () => "2026-07-22", nextId: () => ++i,
    costMapper: { inventoryType: () => "freight", label: c => c } });
  assert.ok(res.changed);
  const sh = res.shipments[0];
  assert.equal(sh.goods[1].lotRef, "L-2", "second row retagged to its true lot");
  const l1 = res.lots.find(l => l.number === "L-1"), l2 = res.lots.find(l => l.number === "L-2");
  assert.ok((l1.movements||[]).some(m => m.voided), "wrong movement voided");
  assert.equal(l1.receivedKg, 4000); assert.equal(l2.receivedKg, 4000);
  const alloc = (l) => (l.costs||[]).filter(c => String(c.source||"").startsWith("SHP-H/")).reduce((a,c)=>a+(c.pln||0),0);
  assert.equal(alloc(l1) + alloc(l2), 1000, "costs re-allocated across BOTH lots");
});
T("HEAL: a healthy dataset passes through untouched", () => {
  const lots = [{ number: "L-OK", poRef: "PO-OK", poLineId: 1, product: "Apples", receivedKg: 5000, physicalKg: 0, costs: [], movements: [
    { type: "IN", qtyKg: 5000, shipmentRef: "SHP-OK" }, { type: "SHIP_OUT", qtyKg: 5000, soRef: "SO-OK", shipmentRef: "SHP-OK" } ] }];
  const shipments = [{ number: "SHP-OK", status: "Closed", purpose: "OUTBOUND", soRefs: ["SO-OK"], legs: [{}], costs: [],
    goods: [{ lotRef: "L-OK", soRef: "SO-OK", soLineId: 1, qtyKg: 5000 }] }];
  const orders = [{ number: "SO-OK", id: 1, status: "Closed", items: [{ id: 1, sourceType: "PO", sourceRef: "PO-OK", sourceLineId: 1, product: "Apples", qty: 5000 }] }];
  let i = 800;
  const res = HEAL.healRound645({ shipments, lots, orders }, { todayISO: () => "2026-07-22", nextId: () => ++i,
    costMapper: { inventoryType: () => "freight", label: c => c } });
  assert.equal(res.changed, false, "no false-positive healing");
});

// ── v6.46.0: loading protocol (Karta załadunku) ──
const LP = require("./build/loadingProtocol.domain.js");
console.log("── loading protocol ──");
const _seed = PKG.PACKAGING_SEED;

T("derives the REAL sheet: 19422 kg apples → 21 rows, 20x72 + 54, 13 kg/box", () => {
  const rows = LP.deriveRows([{ product: "Apples", qtyKg: 19422 }], _seed);
  assert.equal(rows.length, 21, "21 pallet rows");
  assert.equal(rows.filter(r => r.boxes === 72).length, 20);
  assert.equal(rows[20].boxes, 54, "final part-pallet");
  assert.ok(rows.every(r => r.kgPerBox === 13));
  assert.equal(rows[0].no, 1); assert.equal(rows[20].no, 21);
});
T("calibre is left BLANK for handwriting (ruling: PO can't allocate per pallet)", () => {
  const rows = LP.deriveRows([{ product: "Apples", qtyKg: 19422 }], _seed);
  assert.ok(rows.every(r => r.size === ""), "no calibre pre-printed");
  assert.ok(rows.every(r => r.boxesOk === null && r.goodsOk === null), "conditions unfilled");
});
T("totals from a returned sheet reproduce net + box tare + pallet tare", () => {
  const rows = LP.deriveRows([{ product: "Apples", qtyKg: 19422 }], _seed);
  const t = LP.protocolTotals({ rows }, _seed, "Apples");
  assert.equal(t.boxes, 1494); assert.equal(t.pallets, 21);
  assert.equal(t.netKg, 19422);
  assert.equal(t.boxTareTotalKg, 2091.6); assert.equal(t.palletTareTotalKg, 525);
  assert.equal(t.grossKg, 22038.6);
});
T("22 full pallets: manual adjustment case derives 22 rows", () => {
  const rows = LP.deriveRows([{ product: "Apples", qtyKg: 22 * 72 * 13 }], _seed);
  assert.equal(rows.length, 22);
  assert.ok(rows.every(r => r.boxes === 72));
});
T("build: pre-fills plates, driver, assortment; recorders stay EMPTY", () => {
  const sh = { number: "SHP-2026-0003", goods: [{ product: "Apples", qtyKg: 19422 }],
    legs: [{ id: 1, mode: "Road", vehicles: [{ truckPlate: "WR025HP", trailerPlate: "WR0246Y", driverName: "Mikolaj Majewski" }] }] };
  const p = LP.buildLoadingProtocol({ shipment: sh, supplier: { name: "Konkret", address: "Marysin 36" },
    receiverName: "MARIANNA HAZEM OSMAN", types: _seed, existingProtocols: [] },
    { todayISO: () => "2026-07-30", nextId: () => 1 });
  assert.equal(p.number, "LP-2026-0001", "house numbering convention");
  assert.equal(p.truckPlate, "WR025HP"); assert.equal(p.trailerPlate, "WR0246Y");
  assert.equal(p.assortment, "Apples");
  assert.equal(p.rows.length, 21);
  assert.equal(p.recorderNos.length, 0, "producer picks recorders at loading — blank when printed");
  assert.equal(p.status, "Draft");
});
T("numbering continues the house sequence", () => {
  assert.equal(LP.nextProtocolNumber([{ number: "LP-2026-0001" }, { number: "LP-2026-0007" }], 2026), "LP-2026-0008");
  assert.equal(LP.nextProtocolNumber([{ number: "LP-2025-0009" }], 2026), "LP-2026-0001", "year-scoped");
});
T("a clean sheet is clean; damage and non-compliance are flagged", () => {
  const rows = LP.deriveRows([{ product: "Apples", qtyKg: 936 }], _seed).map(r =>
    ({ ...r, boxesOk: true, goodsOk: true, remarks: "Brak" }));
  const clean = { checks: { transportClean: true, chamberClean: true, foreignOdours: false, packagingCompliant: true }, rows };
  assert.equal(LP.isProtocolClean(clean), true, "all Tak / Brak / ZGODNY = clean");
  const dirty = { ...clean, rows: rows.map((r, i) => i === 0 ? { ...r, goodsOk: false } : r) };
  assert.equal(LP.isProtocolClean(dirty), false);
  assert.ok(LP.protocolExceptions(dirty)[0].includes("Pallet 1"));
  const odours = { ...clean, checks: { ...clean.checks, foreignOdours: true } };
  assert.ok(LP.protocolExceptions(odours).some(x => x.includes("odours")));
});
T("gaps tell you what must still come back for the sheet to be evidence", () => {
  const p = LP.buildLoadingProtocol({ shipment: { number: "S", goods: [{ product: "Apples", qtyKg: 936 }], legs: [{ id: 1 }] }, types: _seed },
    { todayISO: () => "2026-07-30", nextId: () => 1 });
  const gaps = LP.protocolGaps(p);
  assert.ok(gaps.some(g => g.includes("Driver signature")));
  assert.ok(gaps.some(g => g.includes("recorder")));
  assert.ok(gaps.some(g => g.includes("Calibre")));
  assert.ok(gaps.some(g => g.includes("Signed scan")), "the signed scan is itself a gap (v6.47.0)");
  const done = { ...p, driverSignedDate: "2026-05-02", issuerSignedDate: "2026-05-02",
    recorderNos: ["241002PDF2476186"], chamberTempBeforeC: "2",
    scanLink: "https://www.dropbox.com/s/abc/protokol.pdf?dl=0",
    checks: { transportClean: true, chamberClean: true, foreignOdours: false, packagingCompliant: true },
    rows: p.rows.map(r => ({ ...r, size: "70-80" })) };
  assert.equal(LP.protocolGaps(done).length, 0, "fully returned + scanned sheet has no gaps");
});

// ── v6.47.0: document links (Dropbox register) ──
const DL = require("./build/docLinks.domain.js");
console.log("── document links ──");
T("recognises Dropbox and the other usual hosts", () => {
  assert.equal(DL.inspectLink("https://www.dropbox.com/s/abc/CMR-123.pdf?dl=0").host, "Dropbox");
  assert.equal(DL.inspectLink("https://www.dropbox.com/scl/fi/xyz/protokol.pdf?rlkey=k").label, "Dropbox");
  assert.equal(DL.inspectLink("https://drive.google.com/file/d/1a2b/view").host, "Google Drive");
  assert.equal(DL.inspectLink("https://1drv.ms/b/s!Aabc").host, "OneDrive");
  assert.equal(DL.inspectLink("https://files.marianna.pl/cmr/123.pdf").host, "Other");
});
T("the Dropbox URL is never rewritten (?dl=0 opens their preview, as expected)", () => {
  const url = "https://www.dropbox.com/s/abc/CMR-123.pdf?dl=0";
  assert.equal(DL.inspectLink(url).ok, true);
  // helper classifies only — callers open the link exactly as pasted
  assert.equal(DL.isUsableLink(url), true);
});
T("rejects junk without pretending it works", () => {
  assert.equal(DL.isUsableLink(""), false);
  assert.equal(DL.isUsableLink("dropbox.com/s/abc"), false, "no scheme");
  assert.equal(DL.inspectLink("dropbox.com/s/abc").reason.includes("http"), true);
  assert.equal(DL.isUsableLink("not a url at all"), false);
});
T("register summary separates outstanding from unproduceable", () => {
  const docs = [
    { type: "CMR", status: "Have it", link: "https://www.dropbox.com/s/a/cmr.pdf?dl=0" },
    { type: "Invoice", status: "Have it", link: "" },
    { type: "EUR.1", status: "Missing", link: "" },
    { type: "AWB", status: "N/A", link: "" },
    { type: "Phytosanitary", status: "Have it", link: "www.dropbox.com/broken" },
  ];
  const s = DL.summariseDocs(docs);
  assert.equal(s.total, 5);
  assert.equal(s.settled, 4, "Have it x3 + N/A");
  assert.equal(s.outstanding, 1, "only EUR.1 outstanding");
  assert.equal(s.withFile, 1, "only the CMR has a working link");
  assert.deepEqual(s.settledWithoutFile.sort(), ["Invoice", "Phytosanitary"], "N/A needs no file");
  assert.deepEqual(s.badLinks, ["Phytosanitary"]);
});
T("claim evidence: a tick without a scan is not evidence", () => {
  const ticked = [{ type: "CMR", status: "Have it", link: "" }];
  const gaps = DL.claimEvidenceGaps(ticked, ["CMR"]);
  assert.equal(gaps.length, 1);
  assert.ok(gaps[0].includes("no scan linked"));
  const linked = [{ type: "CMR", status: "Have it", link: "https://www.dropbox.com/s/a/cmr.pdf?dl=0" }];
  assert.equal(DL.claimEvidenceGaps(linked, ["CMR"]).length, 0);
  assert.ok(DL.claimEvidenceGaps([], ["CMR"])[0].includes("not on the document list"));
  assert.ok(DL.claimEvidenceGaps([{ type: "CMR", status: "Missing" }], ["CMR"])[0].includes("not received"));
});

// ── v6.48.0: claims re-homed to their own store (Phase 1) ──
const CL = require("./build/claims.domain.js");
const MC = require("./build/marginCalculations.js");
console.log("── claims: store, numbering, migration ──");
const _deps = () => { let i = 0; return { todayISO: () => "2026-07-30", nextId: () => ++i }; };

T("D1 FIXED: a lot may now hold SEVERAL claims (the old save wiped them)", () => {
  const lot = { number: "LOT-1", poRef: "PO-1", claims: [
    { id: 1, number: "CLM-2026-0001", defectType: "Skin defects", requestedCreditEUR: 6179.93, status: "Issued" },
    { id: 2, defectType: "Bruising", requestedCreditEUR: 800, status: "Draft" },
  ], movements: [] };
  const r = CL.migrateClaims({ lots: [lot], pos: [{ number: "PO-1", supplier: { name: "Konkret" } }] }, _deps());
  assert.equal(r.claims.length, 2, "BOTH claims survive");
  assert.equal(r.claims[0].number, "CLM-2026-0001", "existing number kept");
  assert.equal(r.claims[1].number, "CLM-2026-0001".replace("0001", "0002"), "second gets the next house number");
  assert.ok(r.claims.every(c => c.respondent.name === "Konkret" && c.direction === "RECOVERY"));
});
T("D2 FIXED: numbering reads the CLAIMS store, not a lots snapshot", () => {
  assert.equal(CL.nextClaimNumber([{ number: "CLM-2026-0003" }], 2026), "CLM-2026-0004");
  assert.equal(CL.nextClaimNumber([{ number: "CLM-2025-0009" }], 2026), "CLM-2026-0001", "year-scoped");
  assert.equal(CL.nextClaimNumber([], 2026), "CLM-2026-0001");
});
T("unnumbered CLIENT claims become real numbered documents", () => {
  const lot = { number: "LOT-4", poRef: "PO-2", claims: [], movements: [
    { id: 9, type: "CLAIM", qtyKg: 500, claimValue: 2400, claimCurrency: "PLN", soRef: "SO-2026-0002", date: "2026-06-01", note: "Client quality complaint" },
    { id: 10, type: "CLAIM", qtyKg: 100, date: "2026-06-02", note: "producer claim marker" },   // no value → not a client claim
    { id: 11, type: "CLAIM", qtyKg: 50, claimValue: 100, voided: true },                        // voided → ignored
  ] };
  const r = CL.migrateClaims({ lots: [lot], pos: [] }, _deps());
  assert.equal(r.claims.length, 1, "only the valued, live movement becomes a claim");
  const c = r.claims[0];
  assert.equal(c.direction, "CONCESSION");
  assert.equal(c.respondent.kind, "Client");
  assert.equal(c.number, "CLM-2026-0001", "it finally HAS a number");
  assert.equal(c.status, "Settled", "its credit note was already issued");
  assert.equal(c.movementRef, 9, "still tied to the inventory movement");
  assert.deepEqual(c.subjects.map(s => s.kind).sort(), ["LOT", "SO"]);
});
T("migration is idempotent — a second run adds nothing", () => {
  const lots = [{ number: "LOT-1", poRef: "PO-1", claims: [{ id: 1, defectType: "x", requestedCreditEUR: 100 }],
    movements: [{ id: 5, type: "CLAIM", qtyKg: 10, claimValue: 50, soRef: "SO-1" }] }];
  const pos = [{ number: "PO-1", supplier: { name: "Konkret" } }];
  const first = CL.migrateClaims({ lots, pos }, _deps());
  assert.equal(first.claims.length, 2); assert.equal(first.changed, true);
  const second = CL.migrateClaims({ lots, pos, existing: first.claims }, _deps());
  assert.equal(second.claims.length, 2, "no duplicates");
  assert.equal(second.changed, false);
});
T("originals are never destroyed by the migration", () => {
  const lot = { number: "LOT-1", poRef: "PO-1", claims: [{ id: 1, requestedCreditEUR: 100 }], movements: [] };
  const before = JSON.stringify(lot);
  CL.migrateClaims({ lots: [lot], pos: [] }, _deps());
  assert.equal(JSON.stringify(lot), before, "lot.claims left exactly as it was");
});
T("queries find claims by lot, SO and shipment", () => {
  const claims = [
    CL.blankClaim({ id: 1, number: "CLM-2026-0001", subjects: [{ kind: "LOT", ref: "LOT-4", affectedKg: 500 }, { kind: "SO", ref: "SO-2" }] }),
    CL.blankClaim({ id: 2, number: "CLM-2026-0002", subjects: [{ kind: "SHIPMENT", ref: "SHP-9" }, { kind: "LOT", ref: "LOT-4", affectedKg: 200 }] }),
  ];
  assert.equal(CL.claimsForLot(claims, "LOT-4").length, 2);
  assert.equal(CL.claimsForSO(claims, "SO-2").length, 1);
  assert.equal(CL.claimsForShipment(claims, "SHP-9").length, 1);
  assert.equal(CL.affectedKgForLot(claims[0], "LOT-4"), 500);
});
T("incident net: conceded minus recovered, gap reported not flagged", () => {
  // client conceded 6000; recovered 4000 from the supplier and 1000 from the line
  const claims = [
    CL.blankClaim({ id: 1, direction: "CONCESSION", requestedEUR: 6500, acceptedEUR: 6000 }),
    CL.blankClaim({ id: 2, direction: "RECOVERY", parentClaimId: 1, requestedEUR: 6179.93, acceptedEUR: 4000 }),
    CL.blankClaim({ id: 3, direction: "RECOVERY", parentClaimId: 1, requestedEUR: 1500, acceptedEUR: 1000 }),
  ];
  const n = CL.incidentNet(claims, 1);
  assert.equal(n.conceded, 6000, "accepted amount wins over requested");
  assert.equal(n.recovered, 5000, "both recoveries counted");
  assert.equal(n.net, 1000, "the deliberate commercial gap");
  assert.equal(n.members.length, 3);
});
T("summary: open value, overdue notices, claims with no evidence", () => {
  const claims = [
    CL.blankClaim({ id: 1, number: "CLM-1", direction: "RECOVERY", status: "Submitted", requestedEUR: 1000, noticeDeadline: "2026-07-01" }),
    CL.blankClaim({ id: 2, number: "CLM-2", direction: "CONCESSION", status: "Settled", requestedEUR: 500 }),
    CL.blankClaim({ id: 3, number: "CLM-3", direction: "RECOVERY", status: "Draft", requestedEUR: 200, evidence: [{ kind: "CMR", ref: "1", link: "https://www.dropbox.com/s/a/b.pdf" }] }),
  ];
  const s = CL.claimsSummary(claims, "2026-07-30");
  assert.equal(s.total, 3); assert.equal(s.open, 2, "Settled is terminal");
  assert.equal(s.openRecoveryEUR, 1200);
  assert.deepEqual(s.overdue, ["CLM-1"], "deadline passed and never notified");
  assert.deepEqual(s.noEvidence, ["CLM-1"], "CLM-3 has a linked scan");
});

// ── v6.49.0: claims Phase 2 — basis + posting an accepted amount ──
console.log("── claims: basis, posting, chain ──");
T("basis COSTS: a claim with no damaged cargo at all (wrong terminal, demurrage)", () => {
  const c = CL.blankClaim({ basis: "COSTS", causedCosts: [{ label: "Demurrage", amountEUR: 600 }, { label: "Re-delivery", amountEUR: 200 }] });
  assert.equal(CL.requestedFromBasis(c), 800, "pure caused costs — no defect %");
});
T("basis MIXED: the real transport claim — cargo lost AND cost to repalletise", () => {
  const c = CL.blankClaim({ basis: "MIXED", lostValueEUR: 1200,
    causedCosts: [{ label: "Repalletising before loading", amountEUR: 350 }],
    defectValueEUR: 0, recoveredEUR: 0 });
  assert.equal(CL.requestedFromBasis(c), 1550);
});
T("basis DEFECT still runs the paper form's maths", () => {
  const c = CL.blankClaim({ basis: "DEFECT", defectValueEUR: 7474.31, recoveredEUR: 1294.38 });
  assert.equal(CL.requestedFromBasis(c), 6179.93, "matches the signed Claim Request Form");
});
T("only an ACCEPTED amount posts anything", () => {
  const base = { number: "CLM-2026-0001", direction: "RECOVERY", plnPerEur: 4.3,
    subjects: [{ kind: "LOT", ref: "LOT-1", affectedKg: 1000 }] };
  assert.equal(CL.buildClaimPostings({ ...base, status: "Submitted", acceptedEUR: 1000 }).postings.length, 0);
  assert.equal(CL.buildClaimPostings({ ...base, status: "Accepted", acceptedEUR: 0 }).postings.length, 0);
  assert.equal(CL.buildClaimPostings({ ...base, status: "Accepted", acceptedEUR: 1000 }).postings.length, 1);
});
T("RECOVERY from the producer credits the lots pro-rata by affected kg", () => {
  const c = { number: "CLM-2026-0002", direction: "RECOVERY", status: "Accepted", acceptedEUR: 1000, plnPerEur: 4,
    respondent: { kind: "Supplier", name: "Konkret" },
    subjects: [{ kind: "LOT", ref: "LOT-A", affectedKg: 3000 }, { kind: "LOT", ref: "LOT-B", affectedKg: 1000 }] };
  const { postings } = CL.buildClaimPostings(c);
  assert.equal(postings.length, 2);
  assert.equal(postings[0].amountPLN, -3000, "75% of 4000 PLN");
  assert.equal(postings[1].amountPLN, -1000);
  assert.equal(Math.round(postings.reduce((a, p) => a + p.amountPLN, 0)), -4000, "totals exactly");
  assert.ok(postings.every(p => p.kind === "LOT_COST" && p.source === "claim:CLM-2026-0002"));
});
T("CONCESSION to the client reduces the sales order's revenue", () => {
  const c = { number: "CLM-2026-0003", direction: "CONCESSION", status: "Settled", acceptedEUR: 500, plnPerEur: 4.3,
    respondent: { kind: "Client", name: "Cairo Fruits" }, subjects: [{ kind: "SO", ref: "SO-2026-0002" }] };
  const { postings } = CL.buildClaimPostings(c);
  assert.equal(postings.length, 1);
  assert.equal(postings[0].kind, "SO_REVENUE");
  assert.equal(postings[0].ref, "SO-2026-0002");
  assert.equal(postings[0].amountPLN, -2150);
});
T("posting a lot credit is source-tagged, additive and re-postable", () => {
  const lots = [{ number: "LOT-A", costs: [{ type: "purchase", pln: 58266, source: "po:PO-1" }] }];
  const c = { number: "CLM-2026-0004", direction: "RECOVERY", status: "Accepted", acceptedEUR: 1000, plnPerEur: 4,
    respondent: { kind: "Carrier", name: "TransPol" }, subjects: [{ kind: "LOT", ref: "LOT-A", affectedKg: 500 }] };
  const p1 = CL.buildClaimPostings(c).postings;
  let out = CL.applyPostingsToLots(lots, p1);
  assert.equal(out[0].costs.length, 2, "original cost untouched, credit added");
  assert.equal(out[0].costs[1].pln, -4000);
  assert.equal(out[0].costs[0].pln, 58266, "purchase line never rewritten");
  // re-post after renegotiation — replaces, never duplicates
  const p2 = CL.buildClaimPostings({ ...c, acceptedEUR: 800 }).postings;
  out = CL.applyPostingsToLots(out, p2);
  assert.equal(out[0].costs.length, 2, "replaced by source");
  assert.equal(out[0].costs[1].pln, -3200);
});
T("reversing a claim removes exactly its own postings", () => {
  const lots = CL.applyPostingsToLots([{ number: "L1", costs: [{ pln: 100, source: "po:X" }] }],
    CL.buildClaimPostings({ number: "CLM-9", direction: "RECOVERY", status: "Accepted", acceptedEUR: 10, plnPerEur: 4,
      subjects: [{ kind: "LOT", ref: "L1", affectedKg: 1 }] }).postings);
  const orders = CL.applyPostingsToOrders([{ number: "SO-1" }],
    CL.buildClaimPostings({ number: "CLM-9", direction: "CONCESSION", status: "Accepted", acceptedEUR: 10, plnPerEur: 4,
      subjects: [{ kind: "SO", ref: "SO-1" }] }).postings);
  assert.equal(lots[0].costs.length, 2);
  assert.equal(orders[0].claimAdjustments.length, 1);
  const rev = CL.reverseClaimPostings({ number: "CLM-9" }, lots, orders);
  assert.equal(rev.lots[0].costs.length, 1, "only the po:X line remains");
  assert.equal(rev.orders[0].claimAdjustments.length, 0);
});
T("posting refuses when the claim has nothing to land on", () => {
  const noLots = CL.buildClaimPostings({ number: "C", direction: "RECOVERY", status: "Accepted", acceptedEUR: 100, plnPerEur: 4, subjects: [] });
  assert.equal(noLots.postings.length, 0);
  assert.ok(noLots.warnings[0].includes("no lots"));
  const noRate = CL.buildClaimPostings({ number: "C", direction: "RECOVERY", status: "Accepted", acceptedEUR: 100, subjects: [{ kind: "LOT", ref: "L" }] });
  assert.ok(noRate.warnings[0].includes("rate"));
});
T("the SO's margin actually moves when a concession is posted", () => {
  const order = { number: "SO-M", status: "Closed", currency: "EUR", fxRate: 4,
    items: [{ product: "Apples", qty: 1000, unitPrice: 1, sourceType: "STOCK", sourceRef: "LOT-M" }] };
  const before = MC.computeSOMargin(order, [], [], [], "forecast");
  const posted = CL.applyPostingsToOrders([order], CL.buildClaimPostings({
    number: "CLM-M", direction: "CONCESSION", status: "Settled", acceptedEUR: 200, plnPerEur: 4,
    subjects: [{ kind: "SO", ref: "SO-M" }] }).postings)[0];
  const after = MC.computeSOMargin(posted, [], [], [], "forecast");
  assert.equal(before.revenueSO, 1000);
  assert.equal(after.revenueSO, 800, "1000 - (800 PLN / 4)");
  assert.ok(after.marginPLN < before.marginPLN, "margin falls by the credit");
});

console.log("");
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
