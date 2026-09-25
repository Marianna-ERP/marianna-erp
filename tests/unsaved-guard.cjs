const fs = require("fs"); const path = require("path"); const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body><div id=r></div></body></html>", { url: "https://m.local/", pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document; global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
try { global.localStorage = dom.window.localStorage; } catch (e) {} try { global.navigator = dom.window.navigator; } catch (e) {}
global.requestAnimationFrame = (cb) => setTimeout(cb, 0); global.fetch = async () => ({ ok: false });
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", jsx: "react-jsx", esModuleInterop: true, target: "es2019" } });
const React = require("react"); const { createRoot } = require("react-dom/client"); const { act } = require("react");
const U = require(path.resolve(__dirname, "../src/unsaved"));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const t = async (name, fn) => { try { await fn(); pass++; console.log("  ✓ " + name); } catch (e) { fail++; console.log("  ✗ " + name + " — " + e.message); } };
const eq = (a, b, m) => { if (a !== b) throw new Error((m || "") + " expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); };
(async () => {
  let setD, saved = 0;
  function Ed({ active = true, refuse = false }) { const [d, sd] = React.useState({ a: 1 }); setD = sd; U.useUnsavedGuard({ id: "t", label: "Test form", draft: d, active, save: () => { saved++; if (!refuse) sd({ a: 1 }); } }); return null; }
  const root = createRoot(document.getElementById("r"));
  await t("US-1: opened and left alone → nothing to ask", async () => { await act(async () => root.render(React.createElement(Ed))); await sleep(500); eq(U.dirtyEntries().length, 0); });
  await t("US-1: a change makes the editor dirty, named", async () => { await act(async () => setD({ a: 2 })); eq(U.dirtyEntries().length, 1); eq(U.dirtyEntries()[0].label, "Test form"); });
  await t("US-2: Save and continue — a save that goes through clears it", async () => { global.IS_REACT_ACT_ENVIRONMENT = false; const ok = await U.saveAndCheck(U.dirtyEntries()); global.IS_REACT_ACT_ENVIRONMENT = true; eq(ok, true); eq(saved, 1); });   // outside act: React commits on its own, as in the app
  await t("US-2: a refused save keeps you on the form", async () => { await act(async () => root.render(React.createElement(Ed, { refuse: true }))); await act(async () => setD({ a: 3 })); let ok; await act(async () => { ok = await U.saveAndCheck(U.dirtyEntries()); }); eq(ok, false); });
  await t("US-1: a closed editor is not registered", async () => { await act(async () => root.render(React.createElement(Ed, { active: false }))); eq(U.dirtyEntries().length, 0); });
  await act(async () => root.unmount());
  // the real editors must not dirty themselves by opening (their mount-time derivations settle before the baseline)
  const d = JSON.parse(fs.readFileSync("/mnt/user-data/uploads/marianna-erp_v6_99_37_schema-v2_2026-09-17T08-49-45.json", "utf8"));
  const Sh = require(path.resolve(__dirname, "../src/Shipments")); const SO = require(path.resolve(__dirname, "../src/SalesOrders"));
  await t("US-4: the shipment editor, opened on a real shipment and left alone, asks nothing", async () => {
    const r2 = createRoot(document.getElementById("r")); const sh = d.shipments.find(s => (s.legs || []).length > 1) || d.shipments[0];
    await act(async () => r2.render(React.createElement(Sh.default, { shipments: d.shipments, setShipments: () => {}, contacts: d.contacts, lots: d.lots, orders: d.orders, pos: d.pos, initialSelectedNumber: sh.number })));
    await sleep(600); eq(U.openEditors().some(l => l.startsWith("Shipment")), true, "the editor registered"); eq(U.dirtyEntries().length, 0, "dirty after opening"); await act(async () => r2.unmount());
  });
  await t("US-4: the SO form, opened on a real order and left alone, asks nothing", async () => {
    const r3 = createRoot(document.getElementById("r")); const so = d.orders.find(o => o.status === "Confirmed") || d.orders[0];
    await act(async () => r3.render(React.createElement(SO.default, { orders: d.orders, setOrders: () => {}, contacts: d.contacts, lots: d.lots, pos: d.pos, shipments: d.shipments, initialSelectedNumber: so.number, initialView: "form" })));
    await sleep(600); eq(U.openEditors().some(l => l.startsWith("Sales order")), true, "the SO form registered"); const dirty = U.dirtyEntries(); eq(dirty.length, 0, "dirty after opening: " + dirty.map(x => x.label).join(",")); await act(async () => r3.unmount());
  });
  console.log(`UNSAVED GUARD: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
