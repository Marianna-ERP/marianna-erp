// v7.10.x (A-RV-15 / A-RV-22, owner 8 Oct): "connect to screen" — and Done must mean ON THE SCREEN.
// CL-5, CL-8 and CP-4 were recorded Done for months while no screen called their engines; the engine tests passed.
// Every check here renders the real screen on the owner's 2 Oct file and looks for what a person would see.
// Each check fails on v7.9.2 (proved when the batch was built).
process.env.TZ = "Europe/Warsaw";
const path = require("path"); const fs = require("fs");
const { JSDOM } = require("jsdom"); const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://marianna.local/", pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document; global.navigator = dom.window.navigator; global.localStorage = dom.window.localStorage;
global.sessionStorage = dom.window.sessionStorage; global.CustomEvent = dom.window.CustomEvent; global.HTMLElement = dom.window.HTMLElement; global.fetch = async () => ({ ok: false });
global.IS_REACT_ACT_ENVIRONMENT = true;
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", jsx: "react-jsx", esModuleInterop: true, target: "es2019" } });
const React = require("react"); const { createRoot } = require("react-dom/client"); const { act } = require("react"); const { renderToStaticMarkup } = require("react-dom/server");
const FX = require("./fixtures.cjs");
let passed = 0, failed = 0; console.error = () => {};
const t = async (name, fn) => { try { await fn(); passed++; console.log("  \u2713", name); } catch (e) { failed++; console.log("  \u2717", name, "—", String(e && e.message || e).slice(0, 240)); } };
const ok = (c, m) => { if (!c) throw new Error(m || "expected true"); };
const T = h => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ");

(async () => {
  console.log("CONNECTIONS — the engines reach the screens (A-RV-15 / A-RV-22)");
  const pf = FX.needFixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json", "the owner's 2 Oct file");
  if (!pf) { console.log("CONNECTIONS: skipped"); return; }
  const d = JSON.parse(fs.readFileSync(pf, "utf8"));
  try { localStorage.setItem("marianna-erp:v2:customLocations", JSON.stringify(d.customLocations || [])); const Lm = require(path.resolve("./src/locations")); Lm.ensureUsedBuiltinsAreOrdinary(Lm.usedLocationIds(d)); } catch (e) { /* as the app does at start */ }
  const noop = () => {};

  // ── CL-5 + CL-8 on the Claims screen: a recovery claim on LOT-2026-0127 (sold on SO, delivered by SHP-2026-0039) ──
  const lot = d.lots.find(l => l.number === "LOT-2026-0127"); const po = d.pos.find(p => p.number === lot.poRef);
  const sup = d.contacts.find(c => String(c.id) === String(po?.supplier?.id)) || d.contacts.find(c => (c.roles || [c.type]).includes("Supplier"));
  const contacts = d.contacts.map(c => String(c.id) === String(sup.id) ? { ...c, terms: { ...(c.terms || {}), noticeDays: 21 } } : c);
  const claim = { id: "t-clm-1", number: "CLM-TEST-0001", date: "2026-09-20", direction: "RECOVERY", status: "Open", cause: "Quality defect", currency: "EUR",
    respondent: { kind: "Supplier", contactId: sup.id, name: sup.name }, subjects: [{ kind: "LOT", ref: "LOT-2026-0127" }], costLines: [], clientCosts: [] };
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
  const Claims = require(path.resolve("./src/Claims")).default;
  await act(async () => { root.render(React.createElement(Claims, { claims: [claim], setClaims: noop, contacts, lots: d.lots, orders: d.orders, pos: d.pos, shipments: d.shipments, invoices: d.invoices || [], financeNotes: d.financeNotes || [], inspections: d.inspections || [] })); });
  // open the claim as a person does: click where its number is written (the click bubbles to the register row) until the claim opens
  let hit = null;
  for (const e of Array.from(host.querySelectorAll("*")).filter(e => Array.from(e.childNodes).some(n => n.nodeType === 3 && /CLM-TEST-0001/.test(n.textContent || "")))) {
    await act(async () => { e.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
    if (/Respondent — who is on the other side/.test(host.textContent || "")) { hit = e; break; }
  }
  const text = (host.textContent || "").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ");
  await t("CL-5: the claim's cost chain offers the sale's delivery freight (SHP-2026-0039)", async () => {
    ok(hit, "the claim row was not found in the list"); ok(/SHP-2026-0039 \(delivery\)/.test(text), "no delivery-freight line in the chain: " + (text.match(/COST CHAIN.{0,240}/) || ["(no chain shown)"])[0]);
  });
  await t("CL-8: the suggested notice deadline follows the company's 21 agreed days (not the legal 14)", async () => {
    ok(/Agreement with .{0,80}: 21 day\(s\)/.test(text), "basis not the agreement: " + (text.match(/Suggested.{0,160}/) || ["(no suggestion)"])[0]);
    ok(/Suggested 2026-10-11/.test(text), "deadline is not 20 Sept + 21 days");
  });
  await act(async () => { root.unmount(); });

  // ── CP-4: an archived carrier (Polkon) leaves the pickers; a shipment that already names it keeps it, marked ──
  const { EditShipmentModal } = require(path.resolve("./src/ShipmentEditor"));
  const ed = sh => T(renderToStaticMarkup(React.createElement(EditShipmentModal, { shipment: d.shipments.find(s => s.number === sh), contacts: d.contacts, lots: d.lots, pos: d.pos, orders: d.orders, packagingTypes: d.packagingTypes || [], allShipmentsForCap: d.shipments, invoices: d.invoices || [], onSave: noop, onCancel: noop })));
  await t("CP-4: SHP-2026-0031's carrier picker offers no archived company (Polkon)", async () => { const h = ed("SHP-2026-0031"); ok(/choose the carrier/.test(h) && /TBX/.test(h), "the carrier picker is not drawn"); ok(!/Polkon/.test(h), "Polkon is still offered"); });
  await t("CP-4: SHP-2026-0033, which names Polkon, still shows it — marked (archived)", async () => { const h = ed("SHP-2026-0033"); ok(/Polkon[^<]{0,40}\(archived\)/.test(h), "Polkon not shown as archived"); });

  // ── Lot warnings (owner's two): on the Inventory list and on the lot ──
  const Inv = require(path.resolve("./src/Inventory")).default;
  const invProps = { lots: d.lots, setLots: noop, allOrders: d.orders, contacts: d.contacts, shipments: d.shipments, pos: d.pos, invoices: d.invoices || [], claims: d.claims || [], inspections: d.inspections || [], packagingTypes: d.packagingTypes || [] };
  await t("lot warnings: the Inventory list marks lots still expected > 10 days or received ±5 %", async () => {
    const html = renderToStaticMarkup(React.createElement(Inv, invProps)); const n = (html.match(/data-lot-warning="1"/g) || []).length;
    ok(n > 0, "no lot carries a warning mark"); console.log(`      (${n} lots marked on the 2 Oct file)`);
  });
  await t("lot warnings: LOT-2026-0004 (expected since 23 July) says so on its own view, in amber", async () => {
    const h = renderToStaticMarkup(React.createElement(Inv, { ...invProps, initialSelectedNumber: "LOT-2026-0004" }));
    ok(/data-lot-warning="1"/.test(h) && /Still expected/.test(T(h)), "the lot view shows no warning"); ok(!/data-lot-warning="1"[^>]*#DC2626/.test(h), "the warning is red");
  });

  // ── Customs still open: a choice on the Shipments list filter ──
  await t("customs: the Shipments list offers 'Customs open (N)'", async () => {
    const Sh = require(path.resolve("./src/Shipments")).default; const h = T(renderToStaticMarkup(React.createElement(Sh, { contacts: d.contacts, pos: d.pos, orders: d.orders, lots: d.lots, shipments: d.shipments, setShipments: noop, invoices: d.invoices || [] })));
    const m = h.match(/Customs open \((\d+)\)/); ok(m, "no 'Customs open' choice"); console.log(`      (${m[1]} shipments with customs still open on the 2 Oct file)`);
  });

  // ── Loading protocol: loaded exactly as printed ──
  await t("protocol: the window offers 'Loaded exactly as printed'", async () => {
    const LP = require(path.resolve("./src/LoadingProtocolModal")).default;
    const h = T(renderToStaticMarkup(React.createElement(LP, { shipment: d.shipments.find(s => s.number === "SHP-2026-0039"), contacts: d.contacts, pos: d.pos, packagingTypes: d.packagingTypes || [], allShipments: d.shipments, onSave: noop, onClose: noop })));
    ok(/Loaded exactly as printed/.test(h), "no such button");
  });

  // ── A status set by hand asks for the reason (checked in the code: the choice happens inside a dialog) ──
  await t("SO status by hand: the reason is asked and stored through applyStatusOverride; no invented sentence", async () => {
    const src = fs.readFileSync(path.resolve("./src/SalesOrderForm.tsx"), "utf8");
    ok(/ofPrompt\(/.test(src) && /applyStatusOverride\(o, nv, why,/.test(src), "the reason is not asked"); ok(!/Set by hand — shipments do not show it yet/.test(src), "the fixed sentence is still written");
  });

  console.log(`CONNECTIONS: ${passed} passed, ${failed} failed`); if (failed) process.exit(1);
})();
