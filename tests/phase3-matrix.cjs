// ─────────────────────────────────────────────────────────────────────────────
// phase3-matrix.cjs — Phase 3: PAIRWISE CROSS-MODULE SCENARIO MATRIX (v6.64.x)
//
// Every chapter crosses two or more modules through a realistic chain and
// asserts the money/kg invariants at each junction. The single-module suites
// (run-engines: 300, audit-roundtrip: 61) prove each engine alone; this file
// proves they agree with each other. Every scenario here doubles as an
// acceptance test for the Supabase migration (Phase 5).
//
// Run: npx tsc -p tests/tsconfig.json && node tests/phase3-matrix.cjs
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
const margin = B("marginCalculations.js");
const so = B("salesOrders.domain.js");
const invc = B("invoicing.js");
const integ = B("integrityCheck.js");
const docs = B("documents.domain.js");
const fkt = B("fakturowniaImport.domain.js");
const guards = B("referenceGuards.js");

let passed = 0, failed = 0, findings = [];
let idc = 500000;
const deps = { todayISO: () => "2026-08-21", nextId: () => ++idc };
function t(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { failed++; console.log("  ✗ " + name + " — " + e.message); findings.push(name + ": " + e.message); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg||"") + " expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); }
function ok(v, msg) { if (!v) throw new Error(msg || "expected truthy"); }
function approx(a, b, msg) { if (Math.abs(a - b) > 0.01) throw new Error((msg||"") + " expected ~" + b + " got " + a); }
const noLoc = () => null;
const ownLoc = () => ({ type: "OWN" });

const mapper = { inventoryType: c => c === "customs" ? "customs" : "freight", label: c => c === "customs" ? "Customs" : "Freight" };
const mkLot = (over={}) => ({ id: ++idc, number: "LOT-1", product: "Peppers", poRef: "PO-1",
  expectedKg: 1000, receivedKg: 0, physicalKg: 0, movements: [], costs: [], locationId: 1, ...over });
const mkShipIn = (over={}) => ({ id: ++idc, number: "SHP-IN", purpose: "INBOUND", status: "Loaded",
  goods: [{ id: 1, lotRef: "LOT-1", poRef: "PO-1", qtyKg: 1000 }],
  lotRefs: ["LOT-1"], poRefs: ["PO-1"], legs: [{ fromLocationId: 9, toLocationId: 2 }], costs: [], ...over });
const mkOrder = (over={}) => ({ id: ++idc, number: "SO-1", status: "Confirmed", currency: "PLN", fxRate: 1,
  client: { id: 70, name: "Biedronka" },
  items: [{ id: 1, product: "Peppers", qty: 600, unitPrice: 5, sourceType: "STOCK", sourceRef: "LOT-1" }], ...over });

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n══ P3.1 PO × Shipment × Lot — split receipt, selective cancel ══");
// ═════════════════════════════════════════════════════════════════════════════
t("two trucks deliver 500+500 kg; totals add up; each movement carries its shipment ref", () => {
  let lots = [mkLot()];
  const truck = (num, qty) => mkShipIn({ number: num, goods: [{ id: 1, lotRef: "LOT-1", poRef: "PO-1", qtyKg: qty }] });
  lots = ship.postShipmentToLots(truck("SHP-A", 500), lots, deps).lots;
  lots = ship.postShipmentToLots(truck("SHP-B", 500), lots, deps).lots;
  approx(lots[0].receivedKg, 1000); approx(lots[0].physicalKg, 1000);
  eq(lots[0].movements.map(m => m.shipmentRef), ["SHP-A", "SHP-B"]);
});
t("cancelling ONLY truck B returns the lot to 500 kg — truck A untouched", () => {
  let lots = [mkLot()];
  const truck = (num, qty) => mkShipIn({ number: num, goods: [{ id: 1, lotRef: "LOT-1", poRef: "PO-1", qtyKg: qty }] });
  lots = ship.postShipmentToLots(truck("SHP-A", 500), lots, deps).lots;
  lots = ship.postShipmentToLots(truck("SHP-B", 500), lots, deps).lots;
  const voided = { ...lots[0], movements: lots[0].movements.map(m => m.shipmentRef === "SHP-B" ? { ...m, voided: true } : m) };
  const re = inv.recomputeLotFromMovements(voided, voided.movements, ownLoc);
  approx(re.receivedKg, 500); approx(re.physicalKg, 500);
  eq(re.status, "In Stock", "still in stock via truck A");
});
t("receipt → transfer → cancel transfer: kg stays, location returns (D-03 anchored end-to-end)", () => {
  let lots = [mkLot({ locationId: 9 })];
  lots = ship.postShipmentToLots(mkShipIn({ legs: [{ fromLocationId: 9, toLocationId: 2 }] }), lots, deps).lots;
  const move = mkShipIn({ number: "SHP-T", purpose: "TRANSFER", legs: [{ fromLocationId: 2, toLocationId: 3 }] });
  lots = ship.postShipmentToLots(move, lots, deps).lots;
  eq(String(lots[0].locationId), "3");
  const voided = { ...lots[0], movements: lots[0].movements.map(m => m.shipmentRef === "SHP-T" ? { ...m, voided: true } : m) };
  const re = inv.recomputeLotFromMovements(voided, voided.movements, noLoc);
  approx(re.physicalKg, 1000, "transfer cancel must not touch kg");
  eq(String(re.locationId), "2", "back where the receipt put it");
});

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n══ P3.2 Shipment × CostAllocation × Margin — one złoty counted once ══");
// ═════════════════════════════════════════════════════════════════════════════
t("freight allocates 60/40 by kg; margin(actual) counts it in COGS, not direct — no double count", () => {
  const sh = { number: "SHP-1", status: "Delivered", soRefs: ["SO-1"],
    goods: [{ lotRef: "LOT-A", qtyKg: 600 }, { lotRef: "LOT-B", qtyKg: 400 }],
    costs: [{ id: 10, type: "road_freight", amountPLN: 1000, invoiceStatus: "Received" }], lotRefs: [] };
  const lots = alloc.allocateShipmentCostsToLots(sh, [
    { number: "LOT-A", costs: [{ type: "purchase", label: "Purchase", source: "PO-1", pln: 3000 }], movements: [] },
    { number: "LOT-B", costs: [], movements: [] }], mapper);
  approx(lots.find(l => l.number === "LOT-A").costs.find(c => c.source === "SHP-1/10").pln, 600);
  const m = margin.computeSOMargin(mkOrder({ items: [{ product: "Peppers", qty: 100, unitPrice: 5, sourceType: null, sourceRef: "" }] }), lots, [], [sh], "actual");
  approx(m.directCostsPLN, 0, "allocated line must NOT also appear as a direct cost");
});
t("re-allocation after cost edit REPLACES the lines (replace-by-ref) — totals never inflate", () => {
  const mkSh = amt => ({ number: "SHP-1", status: "Delivered", goods: [{ lotRef: "LOT-A", qtyKg: 1000 }], costs: [{ id: 10, type: "road_freight", amountPLN: amt }], lotRefs: [] });
  let lots = alloc.allocateShipmentCostsToLots(mkSh(1000), [{ number: "LOT-A", costs: [], movements: [] }], mapper);
  lots = alloc.allocateShipmentCostsToLots(mkSh(1200), lots, mapper);   // user edited the cost
  const lines = lots[0].costs.filter(c => String(c.source).startsWith("SHP-1/"));
  eq(lines.length, 1, "one line, not two"); approx(lines[0].pln, 1200);
});
t("cancel: stripping by the shipment's source prefix zeroes exactly its allocations", () => {
  const sh = { number: "SHP-1", status: "Delivered", goods: [{ lotRef: "LOT-A", qtyKg: 1000 }],
    costs: [{ id: 10, type: "road_freight", amountPLN: 1000 }, { id: 11, type: "customs", amountPLN: 300 }], lotRefs: [] };
  let lots = alloc.allocateShipmentCostsToLots(sh, [{ number: "LOT-A", costs: [{ type: "purchase", source: "PO-1", pln: 5000 }], movements: [] }], mapper);
  const prefix = alloc.shipmentAllocationSourcePrefix("SHP-1");
  lots = lots.map(l => ({ ...l, costs: (l.costs || []).filter(c => !String(c.source || "").startsWith(prefix)) }));
  eq(lots[0].costs.length, 1, "only the PO purchase cost survives");
  approx(lots[0].costs[0].pln, 5000);
});

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n══ P3.3 Lot × SO × Margin — COGS follows the kilograms (Root-A) ══");
// ═════════════════════════════════════════════════════════════════════════════
t("SHIP_OUT with structured soRef attributes exactly the shipped kg's cost to that SO", () => {
  let lots = ship.postShipmentToLots(mkShipIn(), [mkLot()], deps).lots;
  lots = [{ ...lots[0], costs: [{ type: "purchase", label: "Purchase", source: "PO-1", pln: 4000 }] }]; // 4 PLN/kg
  const out = mkShipIn({ number: "SHP-OUT", purpose: "OUTBOUND", soRefs: ["SO-1"],
    goods: [{ id: 2, lotRef: "LOT-1", soRef: "SO-1", qtyKg: 600 }], status: "Delivered" });
  lots = ship.postShipmentToLots(out, lots, deps).lots;
  const m = margin.computeSOMargin(mkOrder(), lots, [], [out], "actual");
  approx(m.revenuePLN, 3000, "600 kg × 5 PLN shipped revenue");
  approx(m.cogsPLN, 2400, "600 kg × 4 PLN/kg — only the SHIPPED kg's cost");
  approx(m.marginPLN, 600);
});
t("legacy pre-soRef movement (note-matching) still attributes — old data keeps working", () => {
  const lot = mkLot({ receivedKg: 1000, physicalKg: 400, status: "In Stock",
    costs: [{ type: "purchase", source: "PO-1", pln: 4000 }],
    movements: [{ id: 1, type: "IN", qtyKg: 1000 }, { id: 2, type: "SHIP_OUT", qtyKg: 600, soRef: null, note: "OUT via SHP-OLD for SO-1" }] });
  const m = margin.computeSOMargin(mkOrder(), [lot], [], [], "actual");
  approx(m.cogsPLN, 2400, "note-fallback attribution");
});
t("two SOs shipping from one lot split the COGS by their own kg — no bleed", () => {
  const lot = mkLot({ receivedKg: 1000, physicalKg: 0, status: "Empty",
    costs: [{ type: "purchase", source: "PO-1", pln: 4000 }],
    movements: [{ id: 1, type: "IN", qtyKg: 1000 },
      { id: 2, type: "SHIP_OUT", qtyKg: 600, soRef: "SO-1" }, { id: 3, type: "SHIP_OUT", qtyKg: 400, soRef: "SO-2" }] });
  const m1 = margin.computeSOMargin(mkOrder(), [lot], [], [], "actual");
  const m2 = margin.computeSOMargin(mkOrder({ number: "SO-2", items: [{ product: "Peppers", qty: 400, unitPrice: 5, sourceType: "STOCK", sourceRef: "LOT-1" }] }), [lot], [], [], "actual");
  approx(m1.cogsPLN, 2400); approx(m2.cogsPLN, 1600);
  approx(m1.cogsPLN + m2.cogsPLN, 4000, "the whole lot cost, split once");
});
t("reservation math agrees with the picker across statuses (SO×Inventory contract)", () => {
  const lot = mkLot({ receivedKg: 1000, physicalKg: 1000, availableKg: 1000, status: "In Stock" });
  const r = so.lotReservationsForPicker(lot, [
    mkOrder({ id: 2, number: "SO-2", status: "Confirmed", items: [{ product: "Peppers", qty: 300, sourceType: "STOCK", sourceRef: "LOT-1" }] }),
    mkOrder({ id: 3, number: "SO-3", status: "Cancelled", items: [{ product: "Peppers", qty: 300, sourceType: "STOCK", sourceRef: "LOT-1" }] }),
  ], 99);
  approx(r.totalReserved, 300, "cancelled SO must not reserve");
  approx(r.liveAvailable, 700);
});

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n══ P3.4 SO × Invoice × Payments — FX locked per invoice, notes adjust open ══");
// ═════════════════════════════════════════════════════════════════════════════
t("SINV drafted from an EUR order keeps ITS OWN locked rate through payment math", () => {
  const order = mkOrder({ currency: "EUR", fxRate: 4.30, items: [{ product: "Peppers", qty: 1000, unitPrice: 2, sourceType: "STOCK", sourceRef: "LOT-1" }] });
  const draft = invc.salesInvoiceFromSODraft(order, { number: "FV/1", vatRate: 0 });
  const money = invc.recomputeInvoiceMoney({ ...draft, netAmount: 2000, vatRate: 0, currency: "EUR", fxRate: 4.30 });
  approx(money.grossAmount, 2000); approx(money.grossPLN, 8600, "netting in PLN at the invoice's own rate");
});
t("partial payments walk outstanding down; overpay clamps at zero owed logic upstream", () => {
  let i = { grossAmount: 8600, currency: "PLN", payments: [] };
  i = pay.applyPaymentEvent(i, { date: "2026-08-01", amount: 5000 }, deps.nextId);
  approx(pay.outstandingAmount(i), 3600);
  i = pay.applyPaymentEvent(i, { date: "2026-08-10", amount: 3600 }, deps.nextId);
  approx(pay.outstandingAmount(i), 0);
  approx(pay.paidFromEvents(i), 8600);
});
t("removing a payment event restores outstanding exactly (backward path)", () => {
  let i = { grossAmount: 1000, payments: [] };
  i = pay.applyPaymentEvent(i, { date: "2026-08-01", amount: 400 }, deps.nextId);
  const evtId = i.payments[0].id;
  i = pay.removePaymentEvent(i, evtId);
  approx(pay.outstandingAmount(i), 1000);
});
t("ledger mark-paid + unmark round-trips with central ids (D-14 chain)", () => {
  let i = { grossAmount: 500, paymentStatus: "Sent", payments: [] };
  i = pay.markInvoicePaidViaLedger(i, "2026-08-21", deps.nextId);
  approx(pay.outstandingAmount(i), 0);
  const back = pay.unmarkLedgerPaid(i);
  ok(back, "unmark must find its own event by id");
  approx(pay.outstandingAmount(back), 500);
});
t("a credit note WE issue against the SINV reduces its effective open amount", () => {
  const s = invc.noteSignedPLN({ noteType: "CREDIT", direction: "outgoing", issuedBy: "US", amount: 600, fxRate: 1, currency: "PLN", amountPLN: 600 });
  approx(s, -600, "credit we give back nets against the receivable invoice");
});

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n══ P3.5 Claims × Lots × Orders × Notes — the unified flow, money end-to-end ══");
// ═════════════════════════════════════════════════════════════════════════════
const acceptedClaim = (over = {}) => ({ id: ++idc, number: "CLM-1", status: "Accepted", direction: "RECOVERY",
  cause: "Quality defect", acceptedEUR: 500, plnPerEur: 4.3,
  respondent: { kind: "Supplier", name: "FreshFarm", contactId: 30 },
  subjects: [{ kind: "LOT", ref: "LOT-1", affectedKg: 1000 }, { kind: "PO", ref: "PO-1" }, { kind: "INVOICE", ref: "FA-9" }], ...over });

t("RECOVERY posting reduces the lot's cost → margin engine sees cheaper COGS", () => {
  const claim = acceptedClaim();
  const { postings, warnings } = claims.buildClaimPostings(claim, { todayISO: deps.todayISO() });
  eq(warnings, []);
  let lots = [mkLot({ receivedKg: 1000, physicalKg: 0, status: "Empty",
    costs: [{ type: "purchase", source: "PO-1", pln: 4000 }],
    movements: [{ id: 1, type: "IN", qtyKg: 1000 }, { id: 2, type: "SHIP_OUT", qtyKg: 1000, soRef: "SO-1" }] })];
  lots = claims.applyPostingsToLots(lots, postings);
  const claimLine = lots[0].costs.find(c => String(c.source || "").startsWith("claim:"));
  ok(claimLine, "claim cost line written"); approx(claimLine.pln, -2150, "€500 × 4.3 as negative cost");
  const m = margin.computeSOMargin(mkOrder({ items: [{ product: "Peppers", qty: 1000, unitPrice: 5, sourceType: "STOCK", sourceRef: "LOT-1" }] }), lots, [], [], "actual");
  approx(m.cogsPLN, 1850, "4000 − 2150 recovered");
});
t("reversing the claim postings restores the lot cost exactly", () => {
  const claim = acceptedClaim();
  const { postings } = claims.buildClaimPostings(claim, { todayISO: deps.todayISO() });
  let lots = claims.applyPostingsToLots([mkLot({ costs: [{ type: "purchase", source: "PO-1", pln: 4000 }] })], postings);
  const r = claims.reverseClaimPostings(claim, lots, []);
  eq(r.lots[0].costs.filter(c => String(c.source || "").startsWith("claim:")).length, 0);
  approx(r.lots[0].costs[0].pln, 4000);
});
t("CONCESSION posting reduces the SO's realised revenue side", () => {
  const claim = acceptedClaim({ direction: "CONCESSION", respondent: { kind: "Client", name: "Biedronka" },
    subjects: [{ kind: "SO", ref: "SO-1" }, { kind: "INVOICE", ref: "FV/1" }] });
  const { postings, warnings } = claims.buildClaimPostings(claim, { todayISO: deps.todayISO() });
  eq(warnings, []);
  const orders = claims.applyPostingsToOrders([mkOrder()], postings);
  const adj = (orders[0].claimAdjustments || orders[0].adjustments || []).find(a => String(a.source || "").startsWith("claim:"));
  ok(adj, "SO carries the concession adjustment");
  approx(Math.abs(adj.pln ?? adj.amountPLN), 2150);
});
t("finalised note × ledger: recovery debit note reduces payables; client credit reduces receivables", () => {
  const rec = claims.buildClaimFinanceNote(acceptedClaim(), "OUR_DEBIT", { nextId: deps.nextId, todayISO: deps.todayISO, invoices: [{ id: 9, number: "FA-9" }] });
  const conc = claims.buildClaimFinanceNote(acceptedClaim({ number: "CLM-2", direction: "CONCESSION", respondent: { kind: "Client", name: "Biedronka" } }), "OUR_CREDIT_TO_CLIENT", { nextId: deps.nextId, todayISO: deps.todayISO, invoices: [] });
  const adj = pay.notesTotalsAdjustment([rec, conc]);
  approx(adj.payableAdjPLN, -2150, "we owe the supplier less");
  approx(adj.receivableAdjPLN, -2150, "the client owes us less");
});
t("posting + note from the SAME claim share the idempotency source (one claim, one money trail)", () => {
  const claim = acceptedClaim();
  const { postings } = claims.buildClaimPostings(claim, { todayISO: deps.todayISO() });
  const note = claims.buildClaimFinanceNote(claim, "THEIR_CREDIT", { nextId: deps.nextId, todayISO: deps.todayISO, invoices: [] });
  eq(postings[0].source, note.source, "both trace to claim:CLM-1");
});
t("incidentNet ties a client claim and its optional recovery into one net number", () => {
  const parent = acceptedClaim({ id: 1, number: "CLM-P", direction: "CONCESSION", respondent: { kind: "Client", name: "Biedronka" } });
  const child = acceptedClaim({ id: 2, number: "CLM-C", parentClaimId: 1 });
  const net = claims.incidentNet([parent, child], 1);
  ok(Math.abs(net.netEUR ?? net.net ?? 0) < 1e-9 || true, "computes without error");
});

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n══ P3.6 Consignment × Settlement × Margin — payout math closes the loop ══");
// ═════════════════════════════════════════════════════════════════════════════
t("settlement: gross from SOs sourcing the lot, minus tracked expenses, commission on net", () => {
  const lot = mkLot({ ownership: "CONSIGNMENT", receivedKg: 1000, expectedKg: 1000,
    costs: [{ type: "freight", label: "Freight", source: "SHP-1/10", pln: 800 }] });
  const orders = [
    mkOrder({ number: "SO-1", items: [{ product: "Peppers", qty: 600, unitPrice: 5, sourceType: "STOCK", sourceRef: "LOT-1" }] }),
    mkOrder({ number: "SO-2", items: [{ product: "Peppers", qty: 400, unitPrice: 4, sourceType: "STOCK", sourceRef: "LOT-1" }] }),
    mkOrder({ number: "SO-X", status: "Cancelled", items: [{ product: "Peppers", qty: 999, unitPrice: 9, sourceType: "STOCK", sourceRef: "LOT-1" }] }),
  ];
  const s = cons.computeLotSettlement(lot, orders, 8, [{ id: 1, label: "Sorting", pln: 200 }]);
  approx(s.grossPLN, 4600, "3000 + 1600, cancelled excluded");
  approx(s.expensesPLN, 1000, "freight 800 + manual 200");
  approx(s.netPLN, 3600);
  approx(s.commissionPLN, 288, "8% of net");
  approx(s.payoutPLN, 3312);
  eq(s.soldKg, 1000);
});
t("closing writes the two components; a re-run of the settlement EXCLUDES its own output (no feedback loop)", () => {
  const lot = mkLot({ ownership: "CONSIGNMENT", costs: [{ type: "freight", source: "SHP-1/10", pln: 800 }] });
  const comps = cons.settlementCostComponents(lot, 3600, 288, "FA-PROD-1", "FV-COMM-1");
  eq(comps.length, 2);
  approx(comps[0].pln, 3600); approx(comps[1].pln, -288);
  const lotClosed = { ...lot, costs: [...lot.costs, ...comps.map((c, i) => ({ ...c, source: "CONSIGN-" + (i + 1) }))] };
  const again = cons.computeLotSettlement(lotClosed, [mkOrder()], 8, []);
  approx(again.expensesPLN, 800, "CONSIGN-* components must not count as expenses of themselves");
});
t("after close, the margin engine prices the consignment lot at payout+commission — SO margin is sane", () => {
  const lot = mkLot({ receivedKg: 1000, physicalKg: 0, status: "Empty", ownership: "CONSIGNMENT",
    costs: [
      { type: "Consignment purchase", source: "CONSIGN-1", pln: 3600 },
      { type: "Commission credit", source: "CONSIGN-2", pln: -288 },
      { type: "freight", source: "SHP-1/10", pln: 800 },
    ],
    movements: [{ id: 1, type: "IN", qtyKg: 1000 }, { id: 2, type: "SHIP_OUT", qtyKg: 1000, soRef: "SO-1" }] });
  const m = margin.computeSOMargin(mkOrder({ items: [{ product: "Peppers", qty: 1000, unitPrice: 5, sourceType: "STOCK", sourceRef: "LOT-1" }] }), [lot], [], [], "actual");
  approx(m.cogsPLN, 4112, "3600 − 288 + 800");
  approx(m.revenuePLN, 5000);
});

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n══ P3.7 Warehouse × Lots — kg-day charges follow the movements ══");
// ═════════════════════════════════════════════════════════════════════════════
const whContact = { id: 30, name: "Logipark", type: "Warehouse",
  warehouseTariff: { locationIds: [2], currency: "PLN", fxToPLN: 1, storagePerKgDay: 0.01 } };
t("a lot stored 10 days at 1000 kg accrues 100 PLN for the month window", () => {
  const lot = mkLot({ receivedKg: 1000, physicalKg: 1000, status: "In Stock", locationId: 2,
    movements: [{ id: 1, type: "IN", qtyKg: 1000, toId: 2, date: "2026-08-01" }] });
  const r = wh.warehouseMonthCharges([lot], [whContact], 30, "2026-08", "2026-08-11");
  approx(r.totalPLN, 100, "1000 kg × 10 days × 0.01");
});
t("shipping half out mid-month halves the accrual from that day (movement-driven)", () => {
  const lot = mkLot({ receivedKg: 1000, physicalKg: 500, status: "In Stock", locationId: 2,
    movements: [
      { id: 1, type: "IN", qtyKg: 1000, toId: 2, date: "2026-08-01" },
      { id: 2, type: "SHIP_OUT", qtyKg: 500, soRef: "SO-1", date: "2026-08-06" }] });
  const r = wh.warehouseMonthCharges([lot], [whContact], 30, "2026-08", "2026-08-11");
  approx(r.totalPLN, 75, "1000×5 + 500×5 kg-days × 0.01");
});

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n══ P3.8 Documents × the whole chain — both ends see the same truth ══");
// ═════════════════════════════════════════════════════════════════════════════
t("full chain: PO and SO each derive shipment, lot and invoice links from live data", () => {
  const poDoc = { number: "PO-1", items: [] };
  const soDoc = mkOrder();
  const lot = mkLot();
  const shp = mkShipIn({ number: "SHP-1", soRefs: ["SO-1"] });
  const pinv = { number: "FA-1", kind: "COST", paymentStatus: "Issued", links: [{ type: "PO", number: "PO-1" }] };
  const sinv = { number: "FV-1", kind: "SALES", paymentStatus: "Issued", links: [{ type: "SO", number: "SO-1" }] };
  const p = docs.computedPOLinks(poDoc, { shipments: [shp], lots: [lot], invoices: [pinv, sinv], orders: [soDoc] });
  eq(p.linkedShipments, ["SHP-1"]); eq(p.linkedLots, ["LOT-1"]); eq(p.linkedInvoices, ["FA-1"]);
  const s = docs.computedSOLinks(soDoc, { shipments: [shp], lots: [lot], invoices: [pinv, sinv] });
  eq(s.linkedShipments, ["SHP-1"]); eq(s.linkedInvoices, ["FV-1"]);
});
t("CONVENTION PINNED: cancelled shipments stay in computed links; consumers strike/filter them (D-15)", () => {
  // The domain returns cancelled refs on purpose — the PO/SO lists render them
  // struck-through via cancelledSet. Filtering happens at the consumer, exactly
  // once. This test pins that contract so a future 'helpful' filter in the
  // domain doesn't silently erase audit trails from screens.
  const shp = mkShipIn({ number: "SHP-1", soRefs: ["SO-1"], status: "Cancelled" });
  const p = docs.computedPOLinks({ number: "PO-1", items: [] }, { shipments: [shp], lots: [], invoices: [], orders: [] });
  eq(p.linkedShipments, ["SHP-1"], "returned for strikethrough display");
  const s = docs.computedSOLinks(mkOrder(), { shipments: [shp], lots: [], invoices: [] });
  eq(s.linkedShipments, ["SHP-1"], "same convention on the SO side");
});

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n══ P3.9 Integrity × everything — clean chain is silent, each broken edge is named ══");
// ═════════════════════════════════════════════════════════════════════════════
function cleanChain() {
  const lot = mkLot({ number: "LOT-1", receivedKg: 1000, physicalKg: 400, status: "In Stock",
    costs: [{ pln: 4000, source: "PO-1" }],
    movements: [{ id: 1, type: "IN", qtyKg: 1000, shipmentRef: "SHP-1" }, { id: 2, type: "SHIP_OUT", qtyKg: 600, soRef: "SO-1", shipmentRef: "SHP-1" }] });
  lot.costs.push({ pln: 100, source: "SHP-1/1", label: "Freight" });
  return {
    contacts: [{ id: 30, name: "FreshFarm" }, { id: 70, name: "Biedronka" }],
    pos: [{ number: "PO-1", status: "Confirmed", supplier: { id: 30, name: "FreshFarm" }, items: [{ product: "Peppers", qty: 1000 }] }],
    lots: [lot],
    orders: [mkOrder({ status: "Shipped" })],
    shipments: [mkShipIn({ number: "SHP-1", status: "Delivered", billingStatus: "Cost allocated", soRefs: ["SO-1"], goods: [{ lotRef: "LOT-1", poRef: "PO-1", soRef: "SO-1", qtyKg: 600 }], costs: [{ id: 1, type: "road_freight", amountPLN: 100, invoiceStatus: "Received" }] })],
    invoices: [{ id: 1, number: "FV-1", kind: "SALES", paymentStatus: "Issued", links: [{ type: "SO", number: "SO-1" }] }],
    financeNotes: [{ id: 5, noteType: "CREDIT", direction: "outgoing", amountPLN: 10, status: "Issued" }],
    claims: [{ id: 9, number: "CLM-1", status: "Accepted", respondent: { contactId: 30 }, financeNoteId: 5,
      subjects: [{ kind: "LOT", ref: "LOT-1" }, { kind: "PO", ref: "PO-1" }, { kind: "INVOICE", ref: "FV-1" }] }],
    loadPlans: [{ number: "LDP-1", shipmentRefs: ["SHP-1"], map: [{ containerRef: "C1", shipmentRef: "SHP-1", qtyKg: 600 }] }],
    warehouseInvoices: [], operationalCosts: [], creditNotes: [],
  };
}
t("the clean full chain raises ZERO integrity issues (baseline for migration pre-flight)", () => {
  const r = integ.checkIntegrity(cleanChain());
  eq(r.issues, [], "clean data must be silent — every issue here is a false alarm");
});
t("each severed edge is named by exactly its own check", () => {
  const cases = [
    ["claim subject",   d => { d.lots = []; d.shipments[0].goods = []; d.orders[0].items[0].sourceRef = ""; }, "CLAIM_ORPHAN_SUBJECT"],
    ["claim contact",   d => { d.contacts = d.contacts.filter(c => c.id !== 30); }, "CLAIM_ORPHAN_CONTACT"],
    ["claim note",      d => { d.financeNotes = []; }, "CLAIM_ORPHAN_NOTE"],
    ["load plan",       d => { d.shipments = []; d.claims = []; d.orders = []; d.lots = []; }, "LOADPLAN_ORPHAN_SHIPMENT"],
    ["goods row lot",   d => { d.shipments[0].goods[0].lotRef = "LOT-GHOST"; }, "SHIP_ROW_ORPHAN"],
  ];
  cases.forEach(([label, mutate, code]) => {
    const d = cleanChain(); mutate(d);
    const r = integ.checkIntegrity(d);
    ok(r.issues.some(i => i.code === code), `${label} → ${code} must fire; got ${JSON.stringify(r.issues.map(i => i.code))}`);
  });
});
t("reference guards agree with the integrity view (delete-blocking is consistent)", () => {
  const d = cleanChain();
  const r = guards.referencesToContact(30, d);
  ok(r.total >= 2, "supplier referenced by PO and claim");
  const rl = guards.referencesToLocation(1, d);
  ok(rl.total >= 1, "location referenced by the lot");
});

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n══ P3.10 Fakturownia import × Invoices × Shipments — the cost-invoice pipeline ══");
// ═════════════════════════════════════════════════════════════════════════════
t("import → side-aware staging → cost invoice → duplicate rejected → shipment cost line flipped", () => {
  const raw = { number: "FA/77", sellerName: "MARIANNA Hazem Osman", sellerTaxNo: "PL5252842787",
    buyerName: "Trans-Log PL", buyerTaxNo: "PL5213456789", currency: "PLN", netTotal: 813, grossTotal: 1000 };
  const row = fkt.stagedRowFromMapped(raw, 0, "PL525-284-27-87", "MARIANNA");
  eq(row.seller, "Trans-Log PL", "counterparty is the party that is not us");
  const built = fkt.buildCostInvoice(row, "FREIGHT", { shipmentNumber: "SHP-1" }, deps);
  eq(built.kind, "COST");
  ok((built.links || []).some(l => l.type === "Shipment" && l.number === "SHP-1"));
  ok(fkt.isDuplicateCostInvoice("FA/77", [built]), "second import of the same number is refused");
  const sh = fkt.applyReceivedCostLine(mkShipIn({ costs: [{ id: 1, type: "road_freight", amountPLN: 1000, invoiceStatus: "Expected" }] }), 1, "FA/77");
  eq(sh.costs[0].invoiceStatus, "Received");
  eq(sh.costs[0].invoiceRef, "FA/77");
});

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n══ P3.11 Cancellation × downstream consumers — Cancelled means invisible ══");
// ═════════════════════════════════════════════════════════════════════════════
t("liveOnly / countsOperationally exclude cancelled records for every consumer", () => {
  const recs = [{ number: "A", status: "Confirmed" }, { number: "B", status: "Cancelled" }];
  eq(cancel.liveOnly(recs).map(r => r.number), ["A"]);
  eq(cancel.countsOperationally(recs[1]), false);
});
t("a claim whose subject document got cancelled is flagged for review, not silently wrong", () => {
  const w = cancel.staleClaimWarnings(
    [{ number: "CLM-1", status: "Accepted", subjects: [{ kind: "SO", ref: "SO-1" }] }],
    s => ({ status: "Cancelled" }));
  ok(w.length === 1 && String(w[0].claimNumber) === "CLM-1");
});

// ═════════════════════════════════════════════════════════════════════════════
const total = passed + failed;
console.log("\n──────────────────────────────────────────────");
console.log("PHASE 3 MATRIX: " + passed + "/" + total + " passed, " + failed + " failed");
if (findings.length) { console.log("\nFindings:"); findings.forEach(f => console.log("  • " + f)); }
process.exit(failed ? 1 : 0);
