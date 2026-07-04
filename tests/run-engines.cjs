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

console.log("");
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
