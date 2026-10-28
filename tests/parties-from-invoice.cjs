// v7.32.2 (INV-QC, owner 26 Oct): "+ New company" on an invoice opens the Parties module's OWN form, prefilled; saving it creates the
// company through the module's own path and tells the App which invoices to link (jsdom, real DOM events).
process.env.TZ = "Europe/Warsaw"; const path = require("path");
const { JSDOM } = require("jsdom"); const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://marianna.local/", pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document; global.localStorage = dom.window.localStorage; global.sessionStorage = dom.window.sessionStorage; global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement; global.Event = dom.window.Event; global.CustomEvent = dom.window.CustomEvent; global.IS_REACT_ACT_ENVIRONMENT = true;
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", jsx: "react-jsx", esModuleInterop: true, target: "es2019" } });
const React = require("react"); const { createRoot } = require("react-dom/client"); const { act } = require("react");
let passed = 0, failed = 0; const t = async (name, fn) => { try { await fn(); passed++; console.log("  ✓ " + name); } catch (e) { failed++; console.log("  ✗ " + name + " — " + (e && e.message)); } };
const ok = (c, m) => { if (!c) throw new Error(m || "not ok"); };
(async () => {
  console.log("PARTIES — NEW COMPANY FROM AN INVOICE (jsdom)");
  const CP = require(path.resolve("./src/counterparty.domain")); const Contacts = require(path.resolve("./src/Contacts")).default;
  const inv = { id: 77, kind: "COST", number: "FV/6/10/2026", counterparty: { name: "BW-TRANS Bartosz Walo", taxNo: "PL1234567890", addr: { street: "Polna 3", postcode: "05-500", city: "Piaseczno", country: "Polska" } } };
  sessionStorage.setItem("marianna:contactsNewCompany", JSON.stringify({ prefill: CP.newCompanyFromInvoice(inv, () => null), linkInvoices: [77, 78], fromInvoice: inv.number, returnTo: "invoices" }));
  const host = document.createElement("div"); document.body.appendChild(host); let latest = [{ id: 1, name: "Existing Sp. z o.o.", roles: ["Client"], type: "Client", countryIso: "PL", people: [] }];
  function Host() { const [cs, setCs] = React.useState(latest); latest = cs; return React.createElement(Contacts, { contacts: cs, setContacts: setCs, pos: [], orders: [], shipments: [], invoices: [], claims: [], lots: [] }); }
  const root = createRoot(host); await act(async () => { root.render(React.createElement(Host)); });
  let told = null; window.addEventListener("marianna:companyCreated", e => { told = e.detail; });
  await t("the Parties module opens its own New Counterparty form, prefilled from the invoice (name, NIP, address, the country from the list)", async () => {
    ok(/New Counterparty — from invoice FV\/6\/10\/2026/.test(host.textContent), "not the module's own form for the invoice");
    const values = Array.from(host.querySelectorAll("input")).map(i => i.value); ok(values.includes("BW-TRANS Bartosz Walo") && values.includes("1234567890") && values.includes("Polna 3") && values.includes("05-500"), "a prefilled field is missing: " + values.filter(Boolean).slice(0, 8).join(" | "));
    const sel = Array.from(host.querySelectorAll("select")).find(s => Array.from(s.options).some(o => o.value === "PL")); ok(sel && sel.value === "PL", "the country is not chosen from the list");
  });
  await t("saving creates the company through the module's own path and tells the App which invoices to link", async () => {
    const add = Array.from(host.querySelectorAll("button")).find(b => b.textContent.trim() === "Add Counterparty"); ok(add, "no Add button");
    await act(async () => { add.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    const made = latest.find(c => c.name === "BW-TRANS Bartosz Walo"); ok(made && made.id != null && made.countryIso === "PL" && made.nip === "1234567890", "the company was not created as prefilled");
    ok(told && String(told.id) === String(made.id) && told.linkInvoices.join() === "77,78" && told.returnTo === "invoices", "the App was not told: " + JSON.stringify(told));
  });
  console.log(`PARTIES FROM INVOICE: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
