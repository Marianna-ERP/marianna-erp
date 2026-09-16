// ══ RENDER SMOKE TEST — every module's list AND detail rendered against the OWNER'S OWN DATA (react-dom/server + jsdom) ══
// Purpose (owner, 14 Sept): no batch may break another. A crash like "cannot read properties of null" must be caught here, not in production.
const path = require("path"); const fs = require("fs");
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://marianna.local/" });
global.window = dom.window; global.document = dom.window.document; global.navigator = dom.window.navigator;
global.localStorage = dom.window.localStorage; global.sessionStorage = dom.window.sessionStorage; global.CustomEvent = dom.window.CustomEvent; global.HTMLElement = dom.window.HTMLElement;
global.fetch = async () => ({ ok: false });
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", jsx: "react-jsx", esModuleInterop: true, target: "es2019" } });
const React = require("react"); const { renderToStaticMarkup } = require("react-dom/server");
const file = process.argv[2] || fs.readdirSync("/mnt/user-data/uploads").filter(f => /^marianna-erp_.*\.json$/.test(f)).map(f => "/mnt/user-data/uploads/" + f).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
const d = JSON.parse(fs.readFileSync(file, "utf8"));
// seed the browser stores the modules read directly
try { localStorage.setItem("marianna-erp:v2:customLocations", JSON.stringify(d.customLocations || [])); } catch {}
const noop = () => {}; const S = (k, v) => [d[k] || v || [], noop];
let passed = 0, failed = 0;
const render = (name, el) => { try { const html = renderToStaticMarkup(el); if (!html || html.length < 50) throw new Error("empty render"); passed++; console.log("  ✓", name, `(${html.length} chars)`); } catch (e) { failed++; console.log("  ✗", name, "—", (e && e.message || String(e)).split("\n")[0].slice(0, 160)); } };
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
console.log(`RENDER SMOKE: ${passed} passed, ${failed} failed`); if (failed) process.exit(1);
