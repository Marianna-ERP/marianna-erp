// v6.99.110 (AUD-10): the suites run on Poland's clock — the one the business runs on; UTC hid every one-day date shift
process.env.TZ = "Europe/Warsaw";
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
  console.log("PLANNING SHEET — AS IN EXCEL (jsdom, real DOM events)");
  // v7.31.0 (WB-1…6, owner 21 Oct): the board behaves as Excel — a click selects, Ctrl+C / Ctrl+V / Delete act on the whole cell,
  // typing replaces, double-click or F2 edits, Alt+Enter is a new line; the content bar; the product as three columns; dated ranges
  const SD = require(path.resolve("./src/sheet.domain"));
  const tabs0 = [{ id: "t1", name: "week 43", order: 1, createdAt: "x", rows: [
    { id: "r1", createdAt: "x", cells: { client: "Al Baraka", comments: "first", product: { item: "Apples", variety: "Golden", size: "70+" } } },
    { id: "r2", createdAt: "x", cells: { client: "", comments: "" } }, { id: "r3", createdAt: "x", cells: {} }] }];
  const m = mount(tabs0); await m.render();
  const gridEl = () => m.host.querySelector("[data-sheet-grid='1']");
  const colIx = label => SD.SHOWN_COLUMNS.findIndex(c => c.label === label);
  const cellEl = (r, label) => m.host.querySelector(`[data-sheet-cell='${r}:${colIx(label)}']`);
  const rowOf = id => m.latest()[0].rows.find(r => r.id === id);
  const key = async (k, extra = {}) => { await act(async () => { gridEl().dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true, ...extra })); }); };
  const click = async el => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true })); }); await act(async () => { gridEl().focus(); }); };
  const clip = async (type, text) => { const store = { "text/plain": text || "" }; const ev = new dom.window.Event(type, { bubbles: true, cancelable: true }); ev.clipboardData = { setData: (k2, v) => { store[k2] = v; }, getData: k2 => store[k2] || "" }; await act(async () => { gridEl().dispatchEvent(ev); }); return store["text/plain"]; };

  await t("WB-6: a click SELECTS a cell (no text box opens); typing replaces its content; Enter stores it and moves down", async () => {
    await click(cellEl(0, "Comments")); ok(!m.host.querySelector("[data-sheet-editor]"), "a click opened the cell for typing");
    await key("x"); const ed = m.host.querySelector("[data-sheet-editor]"); ok(ed && ed.value === "x", "typing did not replace the content: " + (ed && ed.value));
    const tset = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set;
    await act(async () => { tset.call(ed, "xyz"); ed.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    ok(rowOf("r1").cells.comments === "xyz", "not stored: " + rowOf("r1").cells.comments);
  });
  await t("WB-6: Ctrl+C copies the whole selected cell; Ctrl+V on another selected cell REPLACES its content (nothing to clear first); Delete clears", async () => {
    await click(cellEl(0, "Client")); const copied = await clip("copy"); ok(copied === "Al Baraka", "copied: " + copied);
    await act(async () => { m.latest(); }); await click(cellEl(1, "Comments"));
    await clip("paste", "Al Baraka"); ok(rowOf("r2").cells.comments === "Al Baraka", "the paste did not replace the cell: " + rowOf("r2").cells.comments);
    await clip("paste", "second paste"); ok(rowOf("r2").cells.comments === "second paste", "a second paste was added to what was there: " + rowOf("r2").cells.comments);
    await key("Delete"); ok(!rowOf("r2").cells.comments, "Delete did not clear the cell");
  });
  await t("WB-6 / WB-3: Alt+Enter is a new line in the same cell; a cell of several lines copies as ONE cell; the content bar shows the whole text and edits it", async () => {
    await click(cellEl(0, "Comments")); await key("F2"); const ed = m.host.querySelector("[data-sheet-editor]"); ok(ed, "F2 did not open the cell"); ok(ed.value === "xyz", "F2 did not keep the content");
    await act(async () => { ed.selectionStart = ed.selectionEnd = ed.value.length; ed.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", altKey: true, bubbles: true })); });
    const tset = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set;
    await act(async () => { tset.call(ed, ed.value + "line 2"); ed.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    ok(rowOf("r1").cells.comments === "xyz\nline 2", "two lines not stored: " + JSON.stringify(rowOf("r1").cells.comments));
    await click(cellEl(0, "Comments")); const copied = await clip("copy"); ok(copied === '"xyz\nline 2"', "not copied as one Excel cell: " + JSON.stringify(copied));
    ok(JSON.stringify(SD.parseClipboard(copied)) === JSON.stringify([["xyz\nline 2"]]), "the quoted cell does not paste back as one cell");
    const bar = m.host.querySelector("[data-sheet-bar='1']"); ok(bar && bar.value === "xyz\nline 2", "the content bar does not show the whole text");
    await act(async () => { tset.call(bar, "edited in the bar"); bar.dispatchEvent(new dom.window.FocusEvent("blur", { bubbles: false })); bar.dispatchEvent(new dom.window.FocusEvent("focusout", { bubbles: true })); });
    ok(rowOf("r1").cells.comments === "edited in the bar", "the bar did not store: " + rowOf("r1").cells.comments);
  });
  await t("WB-2: the product shows as three columns — Item, Variety, Size — each with its own width; writing the variety keeps the item and the size (one product stored)", async () => {
    ok(["Item", "Variety", "Size"].every(l => colIx(l) >= 0), "not three columns"); ok(cellEl(0, "Variety").textContent === "Golden");
    await click(cellEl(0, "Variety")); await key("R"); const ed = m.host.querySelector("[data-sheet-editor]");
    const iset = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    await act(async () => { iset.call(ed, "Red Delicious"); ed.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    ok(JSON.stringify(rowOf("r1").cells.product) === JSON.stringify({ item: "Apples", variety: "Red Delicious", size: "70+" }), "the product: " + JSON.stringify(rowOf("r1").cells.product));
    ok(m.host.querySelectorAll("[data-col-resize]").length === SD.SHOWN_COLUMNS.length + 1, "the first column (or another) cannot be resized (WB-1)");
  });
  await t("WB-5: a date cell takes free text in dd/mm/yyyy — one date is stored as a date and shown dd/mm/yyyy, a range '20-21/10' stays as written and its first day is the date read", async () => {
    const write = async text => { await click(cellEl(2, "Production date")); await key("2"); const ed = m.host.querySelector("[data-sheet-editor]"); const iset = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
      await act(async () => { iset.call(ed, text); ed.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }); };
    await write("20/10/2026"); ok(rowOf("r3").cells.productionDate === "2026-10-20" && cellEl(2, "Production date").textContent === "20/10/2026", "one date: " + rowOf("r3").cells.productionDate);
    await write("20-21/10"); ok(rowOf("r3").cells.productionDate === "20-21/10", "the range was changed: " + rowOf("r3").cells.productionDate);
    ok(SD.readSheetDate("20-21/10", 2026).iso === "2026-10-20" && SD.readSheetDate("20/10-22/10", 2026).iso === "2026-10-20" && SD.readSheetDate("soon", 2026).iso === null, "the first day of a range is not the date read");
  });
  await t("WB-4 + the look: the places are offered with their addresses; bold and fill still apply to the selected cell", async () => {
    const PS2 = require(path.resolve("./src/PlanningSheet")).default; ok(PS2);
    await click(cellEl(0, "Client")); const bar = m.host.querySelector("[data-sheet-format='1']"); ok(bar, "no formatting bar");
    const bold = Array.from(bar.querySelectorAll("button")).find(b => b.textContent === "B"); await act(async () => { bold.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
    ok(rowOf("r1").styles && rowOf("r1").styles.client && rowOf("r1").styles.client.b, "bold was not kept");
    const src = fs.readFileSync(path.resolve("./src/PlanningSheet.tsx"), "utf8"); ok(/places: Array\.from\(new Set\(locs\.map\(\(l: any\) => \[S\(l\.name\), S\(l\.address\)/.test(src), "the places are offered by name only");
  });
  console.log(`SHEET TYPING: ${passed} passed, ${failed} failed`); if (warned.length) console.log("  (react warnings:", warned.slice(0, 2).join(" | "), ")");
  process.exit(failed ? 1 : 0);
})();
