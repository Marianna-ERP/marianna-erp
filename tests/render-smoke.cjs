// ══ RENDER SMOKE TEST — every module's list AND detail rendered against the OWNER'S OWN DATA (react-dom/server + jsdom) ══
// Purpose (owner, 14 Sept): no batch may break another. A crash like "cannot read properties of null" must be caught here, not in production.
const path = require("path"); const fs = require("fs");
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://marianna.local/" });
global.window = dom.window; global.document = dom.window.document; global.navigator = dom.window.navigator;
global.localStorage = dom.window.localStorage; global.sessionStorage = dom.window.sessionStorage; global.CustomEvent = dom.window.CustomEvent; global.HTMLElement = dom.window.HTMLElement;
global.fetch = async () => ({ ok: false });
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", jsx: "react-jsx", esModuleInterop: true, target: "es2019" } });
const React = require("react"); const { renderToStaticMarkup: _rsm } = require("react-dom/server");
// v6.99.59 (A-CB-2): every rendered screen is scanned for a dropdown that SHOWS a choice nobody made — no option selected
// and a first option that is not blank (a browser then displays that first option as if chosen).
const silentSelects = [];
function scanSelects(html, where) {
  const re = /<select\b[^>]*>([\s\S]*?)<\/select>/g; let m;
  while ((m = re.exec(html))) {
    const inner = m[1]; if (!/<option/.test(inner)) continue;
    if (/<option[^>]*selected=""/.test(inner)) continue;
    const first = inner.match(/<option([^>]*)>([^<]*)</); if (!first) continue;
    const v = (first[1].match(/value="([^"]*)"/) || [null, first[2]])[1];
    if (String(v).trim() === "") continue;
    silentSelects.push(`${where}: first option "${String(first[2]).slice(0, 40)}"`);
  }
}
let _where = "screen";
const renderToStaticMarkup = (el) => { const html = _rsm(el); try { scanSelects(html, _where); } catch (e) {} return html; };
const file = process.argv[2] || fs.readdirSync("/mnt/user-data/uploads").filter(f => /^marianna-erp_.*\.json$/.test(f)).map(f => "/mnt/user-data/uploads/" + f).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
const d = JSON.parse(fs.readFileSync(file, "utf8"));
// seed the browser stores the modules read directly
try { localStorage.setItem("marianna-erp:v2:customLocations", JSON.stringify(d.customLocations || [])); } catch {}
const noop = () => {}; const S = (k, v) => [d[k] || v || [], noop];
let passed = 0, failed = 0;
const render = (name, el) => { _where = name; try { const html = renderToStaticMarkup(el); if (!html || html.length < 50) throw new Error("empty render"); passed++; console.log("  ✓", name, `(${html.length} chars)`); } catch (e) { failed++; console.log("  ✗", name, "—", (e && e.message || String(e)).split("\n")[0].slice(0, 160)); } };
const common = { contacts: d.contacts, setContacts: noop, pos: d.pos, setPOs: noop, orders: d.orders, setOrders: noop, lots: d.lots, setLots: noop, shipments: d.shipments, setShipments: noop, invoices: d.invoices, setInvoices: noop, claims: d.claims || [], setClaims: noop, financeNotes: d.financeNotes || [], setFinanceNotes: noop, inspections: d.inspections || [], setInspections: noop, stockCounts: d.stockCounts || [], setStockCounts: noop, poSettlements: d.poSettlements || [], setPoSettlements: noop, defectCatalogue: d.defectCatalogue || [], packagingTypes: d.packagingTypes || [], productCatalog: d.productCatalog || [], users: d.users || [], userName: "", closedPeriods: d.closedPeriods || [], warehouseInvoices: d.warehouseInvoices || [], operationalCosts: d.operationalCosts || [], advancePayments: d.advancePayments || [], bankAccounts: d.bankAccounts || [], budgets: d.budgets || [], settledRefs: [], loadPlans: d.loadPlans || [], creditNotes: d.creditNotes || [] };
console.log("RENDER SMOKE against", path.basename(file));
const mods = [["Dashboard", "./src/Dashboard"], ["Contacts", "./src/Contacts"], ["PurchaseOrders", "./src/PurchaseOrders"], ["SalesOrders", "./src/SalesOrders"], ["Inventory", "./src/Inventory"], ["Shipments", "./src/Shipments"], ["Claims", "./src/Claims"], ["Invoices", "./src/Invoices"], ["Finance", "./src/Finance"], ["Settings", "./src/Settings"]];
mods.forEach(([name, p]) => { let C; try { C = require(path.resolve(p)).default; } catch (e) { failed++; console.log("  ✗", name, "import —", (e.message || "").split("\n")[0].slice(0, 160)); return; } render(name + " (list)", React.createElement(C, { ...common, notes: d.financeNotes || [], setNotes: noop })); });
// detail states: open the first real record of each module through its "initial selection" props where supported
const Inventory = require(path.resolve("./src/Inventory")).default; const lot = d.lots.find(l => l.number === "LOT-2026-0106") || d.lots[0];
render("Inventory detail " + (lot && lot.number), React.createElement(Inventory, { ...common, initialSelectedNumber: lot && lot.number }));
// the detail must actually be the detail — assert a marker only the lot screen renders
{ const html = renderToStaticMarkup(React.createElement(Inventory, { ...common, initialSelectedNumber: lot && lot.number }));
  const ok = html.includes("QUALITY &amp; HANDLING") || html.includes("LOT WORKBENCH");
  if (ok) { passed++; console.log("  \u2713 Inventory detail really opened (workbench present)"); } else { failed++; console.log("  \u2717 Inventory detail did not open — the smoke was testing the list"); } }
// v6.99.35: a per-kg sales line must offer a KILO quantity field — the regression that blocked the owner
{ const SalesOrders = require(path.resolve("./src/SalesOrders")).default;
  const soKg = { id: 99901, number: "SO-TEST-KG", status: "Draft", client: d.contacts[0], currency: "PLN", fxRate: 1,
    items: [{ id: 1, product: "Capsicum", pricingUnit: "kg", qty: 1000, unitPrice: 5, sourceType: "", sourceRef: "" }] };
  try {
    const html = renderToStaticMarkup(React.createElement(SalesOrders, { ...common, orders: [...d.orders, soKg], initialSelectedNumber: "SO-TEST-KG", initialView: "form" }));
    const ok = html.includes("Qty (kg)") || html.includes("Qty (boxes)");
    if (ok) { passed++; console.log("  \u2713 sales line offers a quantity field for its pricing unit"); }
    else { failed++; console.log("  \u2717 sales line has no quantity field"); }
  } catch (e) { failed++; console.log("  \u2717 sales line quantity check —", (e.message || "").slice(0, 120)); } }
// G-B (owner 18 Sept): every printable document must render with its key headings — an empty report never ships again
{ const html = renderToStaticMarkup(React.createElement(Inventory, { ...common, initialSelectedNumber: lot && lot.number }));
  const checks = [["TRACEABILITY / RECALL REPORT", "1. PURCHASE"], ["2. SHIPMENTS"], ["3. SOLD TO"]];
  const okTrace = checks.every(group => group.every(s => html.includes(s)));
  if (okTrace) { passed++; console.log("  \u2713 recall report renders its three sections"); } else { failed++; console.log("  \u2717 recall report is missing a section"); }
  const hasInspection = (d.inspections || []).some(x => lot && x.lotNumber === lot.number);
  if (hasInspection) { const okQ = ["QUALITY REPORT", "EXTERNAL QUALITY", "Net %", "Recommendation"].every(s => html.includes(s));
    if (okQ) { passed++; console.log("  \u2713 quality report renders with tolerances, net % and recommendation"); } else { failed++; console.log("  \u2717 quality report missing a section"); } } }
// v6.99.37 (QA-1/QA-5): the settlement prints the SAME quality report as the lot — one component, both screens
{ const PO = require(path.resolve("./src/PurchaseOrders")).default;
  const conPo = (d.pos || []).find(p => (p.pricingMode === "consignment") && (d.inspections || []).some(x => (d.lots || []).some(l => l.poRef === p.number && l.number === x.lotNumber)));
  if (conPo) {
    try { const html = renderToStaticMarkup(React.createElement(PO, { ...common, initialSelectedNumber: conPo.number }));
      const full = ["EXTERNAL QUALITY", "Tolerance %", "Net %", "Recommendation"].every(s => html.includes(s));
      if (full) { passed++; console.log("  \u2713 settlement prints the shared quality report (" + conPo.number + ")"); }
      else { failed++; console.log("  \u2717 settlement's quality report is not the shared component"); }
    } catch (e) { failed++; console.log("  \u2717 settlement quality report —", (e.message || "").slice(0, 120)); }
  }
}
// v6.99.42 (hotfix): the PO's supplier-truck box must SHOW the truck it registered (it filtered numbers as objects and always read empty)
{ const PO = require(path.resolve("./src/PurchaseOrders")).default;
  const sup = (d.shipments || []).find(s => String(s.arrangedBy || "").toUpperCase() === "SUPPLIER" && s.status !== "Cancelled" && (s.poRefs || []).length);
  if (sup) { try {
    const html = renderToStaticMarkup(React.createElement(PO, { ...common, initialSelectedNumber: sup.poRefs[0] }));
    const plate = ((sup.legs || []).flatMap(l => l.vehicles || [])[0] || {}).truckPlate || "";
    const ok = html.includes(sup.number) && (!plate || html.includes(plate)) && !html.includes("No truck registered yet");
    if (ok) { passed++; console.log("  \u2713 supplier-truck box shows the registered truck (" + sup.number + ")"); } else { failed++; console.log("  \u2717 supplier-truck box does not show " + sup.number); }
  } catch (e) { failed++; console.log("  \u2717 supplier-truck box —", (e.message || "").slice(0, 120)); } } }
// v6.99.63 (A-SH): the planning sheet renders her imported tabs with the owner's columns, and no colour index
{ try { const PS = require(path.resolve("./src/PlanningSheet")).default; const Sh = require(path.resolve("./src/sheet.domain")); const Bd = require(path.resolve("./src/board.domain")); const XLSX = require("xlsx");
    const wb = XLSX.readFile("/mnt/user-data/uploads/Shipments_season_2026_2027.xlsx", { cellDates: true });
    const tabs = wb.SheetNames.map((n, i) => ({ ...Sh.importWorkbookRows(n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }), Bd.HER_HEADERS, "2026-09-25T10:00:00Z"), order: i + 1 }));
    const d7 = JSON.parse(fs.readFileSync("/mnt/user-data/uploads/marianna-erp_v6_99_37_schema-v2_2026-09-17T08-49-45.json", "utf8"));
    _where = "planning sheet";
    const html = renderToStaticMarkup(React.createElement(PS, { tabs, setTabs: () => {}, log: [], setLog: () => {}, contacts: d7.contacts, catalog: [], orders: d7.orders, invoices: d7.invoices || [] }));
    const ok = ["Planning sheet", "Controlling person", ">ETD<", ">ETA<", ">SO<", "New tab", "Add row", "Export all tabs"].every(s => html.includes(s)) && !html.includes("1 · Purchase");
    if (ok) { passed++; console.log("  \u2713 planning sheet renders her 5 tabs with the owner's columns; no colour index"); } else { failed++; console.log("  \u2717 planning sheet did not render as expected"); }
  } catch (e) { failed++; console.log("  \u2717 planning sheet —", (e.message || "").slice(0, 120)); } }
// v6.99.61 (A-HD-1/2): one header, one width — the changed modules render the shared header and carry no width cap
{ try { const d6 = JSON.parse(fs.readFileSync("/mnt/user-data/uploads/marianna-erp_v6_99_37_schema-v2_2026-09-17T08-49-45.json", "utf8"));
    const props = { pos: d6.pos, orders: d6.orders, lots: d6.lots, contacts: d6.contacts, shipments: d6.shipments, invoices: d6.invoices || [], claims: d6.claims || [], setShipments: () => {}, setClaims: () => {}, operationalCosts: [], setOperationalCosts: () => {}, users: [], userName: "" };
    const bad = [];
    for (const [name, file] of [["Dashboard", "Dashboard"], ["Finance", "Finance"], ["Shipments", "Shipments"], ["Claims", "Claims"], ["Settings", "Settings"]]) {
      _where = name; let html = "";
      try { html = renderToStaticMarkup(React.createElement(require(path.resolve("./src/" + file)).default, props)); } catch (e) { bad.push(name + " (render: " + (e.message || "").slice(0, 60) + ")"); continue; }
      if (!html.includes('data-module-header="1"')) bad.push(name + " has no shared header");
      if (name !== "Settings" && /max-width:\s*(1400|1450|1720)px/.test(html)) bad.push(name + " still capped");
    }
    if (!bad.length) { passed++; console.log("  \u2713 one header, one width: Dashboard · Finance · Shipments · Claims · Settings"); } else { failed++; console.log("  \u2717 one header, one width — " + bad.join("; ")); }
  } catch (e) { failed++; console.log("  \u2717 one header, one width —", (e.message || "").slice(0, 120)); } }
// v6.99.60 (A-SO-1/2): a Confirmed SO without price or quantity is held; a sourced line's origin/size/class are the source's
{ try { const SOmod = require(path.resolve("./src/SalesOrders"));
    const d5 = JSON.parse(fs.readFileSync("/mnt/user-data/uploads/marianna-erp_v6_99_37_schema-v2_2026-09-17T08-49-45.json", "utf8"));
    const base = (d5.orders || []).find((o) => (o.items || []).some((it) => it.sourceType === "PO" && it.sourceRef)) || d5.orders[0];
    const so = { ...base, number: "SO-TEST-PRICE", status: "Confirmed", items: (base.items || []).map((it, i) => i === 0 ? { ...it, unitPrice: "" } : it) };
    _where = "SO form " + so.number;
    const html = renderToStaticMarkup(React.createElement(SOmod.default, { orders: [...d5.orders, so], setOrders: () => {}, contacts: d5.contacts, lots: d5.lots, pos: d5.pos, shipments: d5.shipments, initialSelectedNumber: so.number, initialView: "form" }));
    const held = html.includes("without quantity or sell price"); const fromSrc = /Class<span[^>]*> · from (PO|stock)/.test(html) || html.includes(" · from PO</span>");
    if (held && fromSrc) { passed++; console.log("  \u2713 SO confirm needs price and quantity; sourced lines show 'from PO/stock'"); } else { failed++; console.log("  \u2717 SO confirm needs price — held:" + held + " fromSource:" + fromSrc); }
  } catch (e) { failed++; console.log("  \u2717 SO confirm needs price —", (e.message || "").slice(0, 120)); } }
// v6.99.59 (A-OW/SU/BK/CU): the shipment editor — Close button, Header → Booking → Units, booking on one line, ports still shown
{ try { const ShMod = require(path.resolve("./src/Shipments"));
    const d4 = JSON.parse(fs.readFileSync("/mnt/user-data/uploads/marianna-erp_v6_99_37_schema-v2_2026-09-17T08-49-45.json", "utf8"));
    const sh = (d4.shipments || []).find((s) => String(s.mode || "").toLowerCase() === "multimodal" && (s.legs || []).length > 1) || d4.shipments[0];
    _where = "shipment editor " + sh.number;
    const html = renderToStaticMarkup(React.createElement(ShMod.default, { shipments: d4.shipments, setShipments: () => {}, contacts: d4.contacts, lots: d4.lots, orders: d4.orders, pos: d4.pos, initialSelectedNumber: sh.number }));
    const iB = html.indexOf("Booking (sea"), iU = html.indexOf("Loading place");
    const checks = { close: />Close</.test(html), bookingBeforeUnits: iB > 0 && iU > iB, forwarderInBookingLine: html.indexOf(">Forwarder<") > iB, portsShown: html.includes(">POL") && html.includes("Shipping line"), noBareUnitWord: !/>unit<\/div>/.test(html) };
    const bad = Object.entries(checks).filter(([k, v]) => !v).map(([k]) => k);
    if (!bad.length) { passed++; console.log("  \u2713 shipment editor layout: Close · Header → Booking → Units · booking line · ports shown"); } else { failed++; console.log("  \u2717 shipment editor layout — " + bad.join(", ")); }
  } catch (e) { failed++; console.log("  \u2717 shipment editor layout —", (e.message || "").slice(0, 120)); } }
// v6.99.57 (A-PK-1): the packing-list window renders with its "Add additional items" button
{ try { const POmod = require(path.resolve("./src/PurchaseOrders"));
    const d3 = JSON.parse(fs.readFileSync("/mnt/user-data/uploads/marianna-erp_v6_99_37_schema-v2_2026-09-17T08-49-45.json", "utf8"));
    const po = (d3.pos || []).find((p) => p.status === "Confirmed");
    const html = renderToStaticMarkup(React.createElement(POmod.default, { pos: d3.pos, setPOs: () => {}, contacts: d3.contacts, lots: d3.lots, setLots: () => {}, orders: d3.orders, setOrders: () => {}, shipments: d3.shipments, setShipments: () => {}, initialSelectedNumber: po.number, initialAction: "packing" }));
    const ok = html.includes("Add additional items") && html.includes("Producer") && !html.includes("Add a size that was loaded");
    if (ok) { passed++; console.log("  \u2713 packing-list window opens with 'Add additional items'"); } else { failed++; console.log("  \u2717 packing-list window did not render as expected"); }
  } catch (e) { failed++; console.log("  \u2717 packing-list window —", (e.message || "").slice(0, 120)); } }
// v6.99.55 (BD-1): the weekly board renders one row per truck on real data
{ try { const Board = require(path.resolve("./src/ShipmentBoard")).default;
    const d2 = JSON.parse(fs.readFileSync("/mnt/user-data/uploads/marianna-erp_v6_99_37_schema-v2_2026-09-17T08-49-45.json", "utf8"));
    const html = renderToStaticMarkup(React.createElement(Board, { shipments: d2.shipments, setShipments: () => {}, pos: d2.pos, setPOs: () => {}, orders: d2.orders, setOrders: () => {}, lots: d2.lots, invoices: d2.invoices || [], contacts: d2.contacts, inspections: d2.inspections || [] }));
    const ok = html.includes("Weekly board") && html.includes("Purchase Price") && html.includes("PLATES") && (html.match(/<tr/g) || []).length > 3 && (html.match(/week \d+/g) || []).length >= 3;
    if (ok) { passed++; console.log("  \u2713 weekly board renders her columns and the trucks (" + (html.match(/<tr/g) || []).length + " rows)"); } else { failed++; console.log("  \u2717 weekly board did not render"); }
  } catch (e) { failed++; console.log("  \u2717 weekly board —", (e.message || "").slice(0, 120)); } }
{ const uniq = Array.from(new Set(silentSelects));
  if (!uniq.length) { passed++; console.log("  \u2713 no dropdown shows a choice nobody made"); }
  else { failed++; console.log("  \u2717 dropdowns showing an unchosen first option (" + uniq.length + "):"); uniq.slice(0, 30).forEach(s => console.log("      " + s)); } }
console.log(`RENDER SMOKE: ${passed} passed, ${failed} failed`); if (failed) process.exit(1);
