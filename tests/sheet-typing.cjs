// ══ v6.99.82 (A-PS-3, owner 29 Sept) — THE PLANNING SHEET KEEPS THE CELL YOU CLICKED ══
// The owner: "I can move between cells with the mouse, but typing does nothing." A cell component declared inside the
// sheet was re-created on every re-render of the sheet — and moving the focus outline IS a re-render — so the input
// under the cursor was replaced by a new one the moment it was focused. This suite clicks a cell as a browser does and
// checks that the very same input is still there, still focused, and still takes what is typed. It fails on v6.99.81.
const path = require("path"); const fs = require("fs");
const { JSDOM } = require("jsdom"); const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://marianna.local/", pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document; global.navigator = dom.window.navigator; global.localStorage = dom.window.localStorage; global.CustomEvent = dom.window.CustomEvent; global.HTMLElement = dom.window.HTMLElement; global.fetch = async () => ({ ok: false });
global.IS_REACT_ACT_ENVIRONMENT = true;
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", jsx: "react-jsx", esModuleInterop: true, target: "es2019" } });
const React = require("react"); const { createRoot } = require("react-dom/client"); const { act } = require("react");
const FX = require("./fixtures.cjs");
const PS = require(path.resolve("./src/PlanningSheet")).default;
let passed = 0, failed = 0; const warned = []; console.error = (...a) => warned.push(String(a[0]).slice(0, 80));
const t = async (name, fn) => { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { failed++; console.log("  ✗", name, "—", String(e && e.message || e).slice(0, 220)); } };
const ok = (c, m) => { if (!c) throw new Error(m || "expected true"); };

function mount(tabs0) {
  let latest = tabs0; const host = document.createElement("div"); document.body.appendChild(host);
  function Host() { const [tabs, setTabs] = React.useState(tabs0); const [log, setLog] = React.useState([]); latest = tabs; return React.createElement(PS, { tabs, setTabs, log, setLog, contacts: [], catalog: [], invoices: [] }); }
  const root = createRoot(host); return { host, root, latest: () => latest, render: () => act(async () => { root.render(React.createElement(Host)); }) };
}
const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;

(async () => {
  console.log("PLANNING SHEET — TYPING (jsdom, real DOM events)");
  const fx = FX.fixture("marianna-erp_v6.99.79_schema-v2_2026-09-29T11-01-43.json");
  const tabs0 = fx ? JSON.parse(fs.readFileSync(fx, "utf8")).planningSheets : [{ id: "t1", name: "week 40", order: 1, createdAt: "x", rows: [{ id: "r1", createdAt: "x", cells: { client: "Al Baraka", supplier: "Grójecki Owoc" } }] }];
  const m = mount(tabs0); await m.render();

  await t("clicking a cell keeps THAT input: still in the document, still focused, after the sheet re-draws the outline", async () => {
    const cell = Array.from(m.host.querySelectorAll("table input")).find(i => i.value === "Al Baraka"); ok(cell, "a client cell");
    await act(async () => { cell.focus(); cell.dispatchEvent(new dom.window.FocusEvent("focusin", { bubbles: true })); });
    ok(document.contains(cell), "the input was replaced by a new one (the v6.99.81 fault)"); ok(document.activeElement === cell, "focus lost");
  });
  await t("what is typed stays in the cell, and leaving the cell stores it", async () => {
    const cell = Array.from(m.host.querySelectorAll("table input")).find(i => i.value === "Al Baraka"); ok(cell);
    await act(async () => { cell.focus(); cell.dispatchEvent(new dom.window.FocusEvent("focusin", { bubbles: true })); });
    await act(async () => { setter.call(cell, "Al Baraka TEST"); cell.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    ok(document.contains(cell) && cell.value === "Al Baraka TEST", "the typed text vanished");
    await act(async () => { cell.dispatchEvent(new dom.window.FocusEvent("focusout", { bubbles: true })); cell.blur(); });
    ok(m.latest().flatMap(x => x.rows).some(r => r.cells.client === "Al Baraka TEST"), "not stored on leaving the cell");
  });
  await t("Enter stores the cell and moves down; Escape puts the stored value back", async () => {
    const cells = Array.from(m.host.querySelectorAll("table input")).filter(i => i.value === "Al Baraka TEST" || i.value === "Al Baraka"); const cell = cells[0]; ok(cell);
    await act(async () => { cell.focus(); cell.dispatchEvent(new dom.window.FocusEvent("focusin", { bubbles: true })); });
    await act(async () => { setter.call(cell, "Al Baraka ENTER"); cell.dispatchEvent(new dom.window.Event("input", { bubbles: true })); cell.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    ok(m.latest().flatMap(x => x.rows).some(r => r.cells.client === "Al Baraka ENTER"), "Enter did not store");
    const c2 = Array.from(m.host.querySelectorAll("table input")).find(i => i.value === "Al Baraka ENTER"); ok(c2);
    await act(async () => { c2.focus(); c2.dispatchEvent(new dom.window.FocusEvent("focusin", { bubbles: true })); setter.call(c2, "typo"); c2.dispatchEvent(new dom.window.Event("input", { bubbles: true })); c2.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    ok(!m.latest().flatMap(x => x.rows).some(r => r.cells.client === "typo"), "Escape stored the typo");
  });
  console.log(`SHEET TYPING: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
