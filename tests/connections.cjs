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

  // ── CP-4: an archived carrier (Rotoze) leaves the pickers; a shipment that already names it keeps it, marked ──
  const { EditShipmentModal } = require(path.resolve("./src/ShipmentEditor"));
  const ed = sh => T(renderToStaticMarkup(React.createElement(EditShipmentModal, { shipment: d.shipments.find(s => s.number === sh), contacts: d.contacts, lots: d.lots, pos: d.pos, orders: d.orders, packagingTypes: d.packagingTypes || [], allShipmentsForCap: d.shipments, invoices: d.invoices || [], onSave: noop, onCancel: noop })));
  await t("CP-4: SHP-2026-0031's carrier picker offers no archived company (Rotoze)", async () => { const h = ed("SHP-2026-0031"); ok(/choose the carrier/.test(h) && /TBX/.test(h), "the carrier picker is not drawn"); ok(!/Rotoze/.test(h), "Rotoze is still offered"); });
  await t("CP-4: SHP-2026-0033, which names Rotoze, still shows it — marked (archived)", async () => { const h = ed("SHP-2026-0033"); ok(/Rotoze[^<]{0,40}\(archived\)/.test(h), "Rotoze not shown as archived"); });

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

  // ══ v7.11.x — the second batch of the review (A-RV-23 / 24 / 25 / 27 / 28) ══
  const setVal = (el, v) => { const proto = el.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new dom.window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); };
  await t("A-RV-23: the shipment window warns when ONE PO line goes over what was ordered (amber, per line)", async () => {
    const SC = require(path.resolve("./src/ShipmentCreate")); const Cr = SC.CreateShipmentModal || SC.default;
    // a confirmed PO with two lines and no live shipment yet — every line still has its quantity box
    const po = d.pos.find(p => p.status !== "Draft" && p.status !== "Cancelled" && (p.items || []).length >= 2 && (p.items || []).every(it => parseFloat(it.qty) > 0)
      && !d.shipments.some(s => s.status !== "Cancelled" && (s.poRefs || []).includes(p.number)));
    ok(po, "no confirmed, not yet shipped PO with two lines in the file");
    const host2 = document.createElement("div"); document.body.appendChild(host2); const r2 = createRoot(host2);
    await act(async () => { r2.render(React.createElement(Cr, { pos: d.pos, orders: d.orders, lots: d.lots, contacts: d.contacts, shipments: d.shipments, onCancel: noop, onCreate: noop })); });
    const sel = Array.from(host2.querySelectorAll("select")).find(s => Array.from(s.options).some(o => o.value === po.number)); ok(sel, "no PO reference select");
    await act(async () => { setVal(sel, po.number); });
    ok(!host2.querySelector('[data-over-receipt="1"]'), "warns before anything goes over");
    const qtyInputs = Array.from(host2.querySelectorAll('input[inputmode="decimal"]')); ok(qtyInputs.length >= 2, "no per-line quantity inputs");
    const ordered = parseFloat(po.items[0].qty); await act(async () => { setVal(qtyInputs[0], String(ordered + 500)); });
    const w = host2.querySelector('[data-over-receipt="1"]'); ok(w, "no warning when line 1 is 500 kg over");
    ok(/would be over-received by 500 kg/.test((w.textContent || "").replace(/[\u00a0\u202f]/g, " ")), "the sentence does not name the 500 kg: " + w.textContent);
    ok(!/#DC2626|#991B1B/i.test(w.getAttribute("style") || ""), "the warning is red");
    await act(async () => { r2.unmount(); });
  });
  await t("A-RV-23: the unused engine copy of the movement limit is gone (the movement window keeps its own)", async () => {
    ok(!/export function movementBlockReason/.test(fs.readFileSync(path.resolve("./src/moduleGuards.domain.ts"), "utf8")), "movementBlockReason still there");
  });
  await t("A-RV-24: the Inventory list also marks unexplained movements and stock in store > 30 days", async () => {
    const h = T(renderToStaticMarkup(React.createElement(Inv, invProps)));
    const a = (h.match(/unexplained movement\(s\)/g) || []).length, b = (h.match(/d in store, unsold/g) || []).length;
    ok(a + b > 0, "neither warning shown"); console.log(`      (${a} lots with unexplained movements, ${b} lots in store > 30 days, on the 2 Oct file)`);
  });
  await t("A-RV-28: a lot received twice (LOT-2026-0026, +100 %) carries no ±5 % warning on top of its badge", async () => {
    const h = T(renderToStaticMarkup(React.createElement(Inv, { ...invProps, initialSelectedNumber: "LOT-2026-0026" })));
    ok(/LOT-2026-0026/.test(h), "the lot did not open"); ok(!/Received against ordered/.test(h), "the variance warning is still shown");
  });
  await t("A-RV-25: the SO view shows a status set by hand, with its reason and date", async () => {
    const so0 = d.orders.find(o => o.status === "Confirmed") || d.orders[0];
    const so = { ...so0, status: "Shipped", statusOverride: "Shipped", statusOverrideReason: "client collected at the warehouse", statusOverrideAt: "2026-10-08" };
    const SOm = require(path.resolve("./src/SalesOrders")).default;
    const h = T(renderToStaticMarkup(React.createElement(SOm, { orders: d.orders.map(o => o.id === so.id ? so : o), setOrders: noop, invLots: d.lots, setLots: noop, allPOs: d.pos, contacts: d.contacts, shipments: d.shipments, setShipments: noop, invoices: d.invoices || [], setInvoices: noop, claims: d.claims || [], packagingTypes: d.packagingTypes || [], initialSelectedNumber: so.number })));
    ok(/set by hand — client collected at the warehouse · 08\/10\/2026/.test(h), "no 'set by hand' mark: " + (h.match(/Shipped.{0,120}/) || [""])[0]);
  });
  await t("A-RV-27: '+ Pallet' gives the new pallet the product, variety and calibre of the last real pallet", async () => {
    const LP = require(path.resolve("./src/LoadingProtocolModal")).default; const sh = d.shipments.find(s => s.number === "SHP-2026-0039");
    const host3 = document.createElement("div"); document.body.appendChild(host3); const r3 = createRoot(host3);
    await act(async () => { r3.render(React.createElement(LP, { shipment: sh, contacts: d.contacts, pos: d.pos, packagingTypes: d.packagingTypes || [], allShipments: d.shipments, onSave: noop, onClose: noop })); });
    const sizes = () => Array.from(host3.querySelectorAll('input[placeholder="70-80"]')).map(i => i.value);
    const before = sizes(); const lastReal = before.filter(Boolean).pop(); ok(lastReal, "no pallet with a calibre to inherit from");
    const btn = Array.from(host3.querySelectorAll("button")).find(b => /\+ Pallet/.test(b.textContent || "")); ok(btn, "no '+ Pallet' button");
    await act(async () => { btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
    const after = sizes(); ok(after.length === before.length + 1, "no pallet added"); ok(after[after.length - 1] === lastReal, `the new pallet's calibre is "${after[after.length - 1]}", not "${lastReal}"`);
    await act(async () => { r3.unmount(); });
  });

  // ══ v7.12.x — the trade direction from the real ends (A-TD-1 … A-TD-4, owner 8 Oct) ══
  { const { EditShipmentModal: EdM } = require(path.resolve("./src/ShipmentEditor"));
    const edH = (s) => renderToStaticMarkup(React.createElement(EdM, { shipment: s, contacts: d.contacts, lots: d.lots, pos: d.pos, orders: d.orders, packagingTypes: d.packagingTypes || [], allShipmentsForCap: d.shipments, invoices: d.invoices || [], onSave: noop, onCancel: noop }));
    const dirOf = (h) => (h.match(/data-trade-direction="([^"]*)"/) || [])[1];
    // a delivered shipment opens with its Arrange stage folded; the same record with status Booked shows it (same places, same sale)
    const shp = (n) => { const s = d.shipments.find(x => x.number === n); return ["Delivered", "Closed", "Arrived"].includes(s.status) ? { ...s, status: "Booked" } : s; };
    await t("A-TD-1: Koper → Warsaw (SHP-2026-0007) is Intra-EU — a typed address is not read as a country", async () => { ok(dirOf(edH(shp("SHP-2026-0007"))) === "INTRA_EU", "got " + dirOf(edH(shp("SHP-2026-0007")))); });
    await t("A-TD-1: the Hungarian producer's own truck to us (SHP-2026-0036) is Intra-EU, not a default Import", async () => { ok(dirOf(edH(shp("SHP-2026-0036"))) === "INTRA_EU", "got " + dirOf(edH(shp("SHP-2026-0036")))); });
    await t("A-TD-1: Poland → Egypt with no sale (SHP-2026-0030) is Export", async () => { ok(dirOf(edH(shp("SHP-2026-0030"))) === "EXPORT", "got " + dirOf(edH(shp("SHP-2026-0030")))); });
    await t("A-TD-2: the editor's customs check knows an export with NO stored direction (SHP-2026-0035): the zero-rating wording", async () => {
      const s = { ...d.shipments.find(x => x.number === "SHP-2026-0035"), status: "Loaded", tradeDirection: undefined, customs: { applies: true, place: "PL", party: "OUR_BROKER", status: "Cleared", docType: "EX1", declRef: "", clearedOn: "2026-09-30" } };
      ok(/proof for zero-rating/.test(T(edH(s))), "the export wording is missing — customs treats the export as an import");
    });
    await t("A-TD-2: the trace report names each shipment's direction from the rule (LOT-2026-0123 on SHP-2026-0035 → Export)", async () => {
      const Tr = require(path.resolve("./src/trace.domain")); const Lm = require(path.resolve("./src/locations"));
      const tree = Tr.buildTraceTree(d.lots.find(l => l.number === "LOT-2026-0123"), { contacts: d.contacts, pos: d.pos, orders: d.orders, shipments: d.shipments, invoices: d.invoices || [], countryOf: (id) => String((Lm.locationById(id) || {}).country || "") }, "2026-10-08");
      const s = JSON.stringify(tree); ok(/"number":"SHP-2026-0035"[^}]*"direction":"EXPORT"/.test(s), "SHP-2026-0035 carries no Export in the trace");
    });
    await t("A-TD-2: the Inventory lot badge shows the two ends the rule used (LOT-2026-0127: Hungary → Poland)", async () => {
      const h = T(renderToStaticMarkup(React.createElement(Inv, { ...invProps, initialSelectedNumber: "LOT-2026-0127" }))); ok(/Intra-EU · Hungary → Poland/.test(h), "no 'Hungary → Poland' on the lot's badge: " + (h.match(/(Import|Export|Intra-EU|Cross-trade) · .{0,40}/) || [""])[0]);
    });
    await t("A-TD-3: no 'manual override stored' line any more (SHP-2026-0007 still carries an old IMPORT in the 2 Oct file)", async () => {
      ok(!/manual override stored/.test(T(edH(shp("SHP-2026-0007")))), "the old line is still drawn");
      ok(/HEAL-7\.12\.2/.test(fs.readFileSync(path.resolve("./src/App.tsx"), "utf8")), "no one-time clear in App");
    });
    await t("A-TD-4: the editor shows the countries actually used and where each comes from", async () => {
      const h = T(edH(shp("SHP-2026-0007"))); ok(/Slovenia \(starting place\) → Poland \(client's country\)/.test(h), "got: " + (h.match(/Trade direction.{0,160}/) || [""])[0]);
    });
  }

  // ══ v7.13.x — exchange rates from NBP, the day before (A-AU-2 / A-AU-11, owner 9 Oct) ══
  { const nbpJson = (from) => { const out = []; const d0 = new Date(from + "T12:00:00Z"); for (let i = 0; i < 95; i++) { const d = new Date(d0); d.setUTCDate(d.getUTCDate() + i); const dow = d.getUTCDay(); if (dow === 0 || dow === 6) continue; const iso = d.toISOString().slice(0, 10); out.push({ effectiveDate: iso, rates: [{ code: "EUR", mid: 4.2 + (i % 10) / 100 }, { code: "USD", mid: 3.7 }] }); } return out; };
    global.fetch = async (url) => { const m = String(url).match(/tables\/A\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})/); if (!m) return { ok: false, status: 500 }; return { ok: true, status: 200, json: async () => nbpJson(m[1]).filter(x => x.effectiveDate <= m[2]) }; };
    const FXN = require(path.resolve("./src/fx"));
    await t("v7.13.0: Settings shows the NBP rates (read, not typed) and the order buffer with its own Save", async () => {
      const St = require(path.resolve("./src/Settings")).default;
      const h = renderToStaticMarkup(React.createElement(St, { fxSettings: { EUR: 4.2711, USD: 3.71, GBP: 5.0, _nbp: 20261008, _bufferPct: 2 }, setFxSettings: noop, contacts: d.contacts, users: [], setUsers: noop, userName: "Hazem Osman" }));
      ok(/data-fx-reference="1"/.test(h) && /EUR <b>4\.2711<\/b>/.test(h), "no read-only NBP rates"); ok(/data-fx-buffer="1"/.test(h), "no buffer field");
      ok(!/step="0\.0001"[^>]*value="4\.2711"/.test(h), "the EUR rate can still be typed");
    });
    await t("v7.13.2: an EUR invoice's rate is NBP of the day before its issue date — shown, not typed", async () => {
      const inv = (d.invoices || []).find(i => i.currency === "EUR" && i.issueDate); ok(inv, "no EUR invoice in the file");
      const InvM = require(path.resolve("./src/Invoices")).default; const host4 = document.createElement("div"); document.body.appendChild(host4); const r4 = createRoot(host4);
      await act(async () => { r4.render(React.createElement(InvM, { invoices: d.invoices, setInvoices: noop, contacts: d.contacts, orders: d.orders, pos: d.pos, lots: d.lots, shipments: d.shipments, financeNotes: [], setFinanceNotes: noop, initialSelectedNumber: inv.number })); });
      const edit = Array.from(host4.querySelectorAll("button")).find(b => /Edit/.test(b.textContent || "")); ok(edit, "no Edit button on the invoice");
      await act(async () => { edit.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });
      const note = host4.querySelector('[data-fx-note="1"]'); ok(note && /NBP table A of \d{4}-\d{2}-\d{2} \(the last working day before the issue date\)/.test(note.textContent || ""), "no NBP note: " + (note && note.textContent));
      const fxInp = note.parentElement.querySelector("input"); ok(fxInp && fxInp.disabled, "the rate can still be typed");
      const exp = FXN.nbpRateBeforeKnown("EUR", inv.issueDate); ok(exp && Number(fxInp.value) === exp.rate, `rate ${fxInp && fxInp.value} is not NBP ${exp && exp.rate}`);
      await act(async () => { r4.unmount(); });
    });
    await t("v7.13.3: recording a payment shows the NBP rate of the day before the money arrived; nothing to type", async () => {
      const inv = (d.invoices || []).find(i => i.currency === "EUR" && i.paymentStatus !== "Paid" && i.paymentStatus !== "Cancelled"); ok(inv, "no open EUR invoice");
      const InvM = require(path.resolve("./src/Invoices")).default; const host5 = document.createElement("div"); document.body.appendChild(host5); const r5 = createRoot(host5);
      await act(async () => { r5.render(React.createElement(InvM, { invoices: d.invoices, setInvoices: noop, contacts: d.contacts, orders: d.orders, pos: d.pos, lots: d.lots, shipments: d.shipments, financeNotes: [], setFinanceNotes: noop, initialSelectedNumber: inv.number })); });
      const btn = Array.from(host5.querySelectorAll("button")).find(b => /payment/i.test(b.textContent || "") && /record|add|\+/i.test(b.textContent || "")); ok(btn, "no payment button");
      await act(async () => { btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });
      const pr = host5.querySelector('[data-payment-rate="1"]'); ok(pr && /NBP table A of \d{4}-\d{2}-\d{2}, the last working day before/.test(pr.textContent || ""), "no NBP payment rate: " + (pr && pr.textContent));
      ok(!Array.from(host5.querySelectorAll("input")).some(i => /e\.g\. /.test(i.getAttribute("placeholder") || "") && i.getAttribute("step") === "0.0001"), "the bank rate can still be typed");
      await act(async () => { r5.unmount(); });
    });
    await t("v7.13.4: a draft EUR sale's rate is NBP of the day before its order date less the buffer — shown, with 'agreed rate…'", async () => {
      FXN.setFxSettings({ EUR: 4.27, _bufferPct: 2 });
      const SOF = require(path.resolve("./src/SalesOrderForm")); const Form = SOF.OrderForm;
      const so = { ...(d.orders.find(o => o.currency === "EUR") || d.orders[0]), currency: "EUR", status: "Draft", fxLockedAt: "", fxAgreedReason: "", orderDate: "2026-09-30" };
      const host6 = document.createElement("div"); document.body.appendChild(host6); const r6 = createRoot(host6);
      await act(async () => { r6.render(React.createElement(Form, { order: so, setOrder: noop, onSave: noop, onCancel: noop, allOrders: d.orders, contacts: d.contacts, lots: d.lots, pos: d.pos, shipments: d.shipments })); });
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });
      const n = host6.querySelector('[data-fx-order="1"]'); const e = FXN.nbpRateBeforeKnown("EUR", "2026-09-30");
      ok(n && new RegExp(`NBP ${e.tableDate} ${e.rate} − 2 % buffer`).test(n.textContent || ""), "no NBP basis on the order: " + (n && n.textContent)); ok(/agreed rate…/.test(n.textContent || ""), "no 'agreed rate…'");
      await act(async () => { r6.unmount(); });
    });
    await t("v7.13.5: Finance shows exchange differences by client (realised against invoiced)", async () => {
      const inv = { id: 99001, number: "FV/T/1", kind: "SALES", currency: "EUR", fxRate: 4.27, issueDate: "2026-09-24", grossAmount: 1000, counterparty: { name: "Al Baraka For Import & Export" }, paymentStatus: "Paid", payments: [{ id: 1, date: "2026-10-01", amount: 600, settlementFxRate: 4.30 }, { id: 2, date: "2026-10-05", amount: 400, settlementFxRate: 4.25 }] };
      const Fin = require(path.resolve("./src/Finance")).default; const host7 = document.createElement("div"); document.body.appendChild(host7); const r7 = createRoot(host7);
      await act(async () => { r7.render(React.createElement(Fin, { contacts: d.contacts, pos: d.pos, orders: d.orders, lots: d.lots, shipments: d.shipments, invoices: [...(d.invoices || []), inv], financeNotes: [], claims: [], userName: "Hazem Osman", users: [] })); });
      const tab = Array.from(host7.querySelectorAll("button")).find(b => /Receivables & Payables/.test(b.textContent || "")); ok(tab, "no 'Receivables & Payables' tab");
      await act(async () => { tab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
      const h = (host7.textContent || "").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " "); await act(async () => { r7.unmount(); });
      ok(/EXCHANGE DIFFERENCES BY CLIENT/.test(h), "no per-client table"); ok(/Al Baraka For Import & Export ?we receive ?1 ?000,00 EUR \(2\) ?4\.2700 ?4\.2800 ?10,00/.test(h), "row not as expected: " + (h.match(/EXCHANGE DIFFERENCES BY CLIENT.{0,400}/) || [""])[0]);
    });
  }

  await t("A-RV-03 (v7.14.1): the supplier's-truck window takes the shipments' one numbering — never a count (checked in the code)", async () => {
    const src = fs.readFileSync(path.resolve("./src/PurchaseOrders.tsx"), "utf8");
    ok(/nextNumber: \(\) => nextShipmentNumberPure\(all, yr\)/.test(src), "not the shipments' generator"); ok(!/\.filter\(\(n: string\) => n\.includes\(`-\$\{yr\}-`\)\)\.length \+ 1/.test(src), "the count is still there");
  });

  // ══ v7.15.x — a truck at two producers; one forwarder with trucks at different producers (A-LS-2/3/4, owner 9 Oct) ══
  { const C = 1788432629971550;   // one carrier (forwarder) for both trucks
    const SH = { id: 990001, number: "SHP-2026-0990", status: "Booked", purpose: "INBOUND", mode: "Road", poRefs: ["PO-2026-0003", "PO-2026-0008", "PO-2026-0001"],
      customOrderTerms: "Payment 30 days after delivery with the CMR copy.\nTemperature recorder mandatory.",
      goods: [{ id: 9101, poRef: "PO-2026-0003", product: "Apples", variety: "Gala", size: "70-80", qtyKg: 10000, packaging: "13 kg wooden boxes" },
              { id: 9102, poRef: "PO-2026-0008", product: "Apples", variety: "Golden Delicious", size: "65-70", qtyKg: 8000, packaging: "13 kg wooden boxes" },
              { id: 9103, poRef: "PO-2026-0001", product: "Apples", variety: "Idared", size: "70-80", qtyKg: 12000, packaging: "13 kg wooden boxes" }],
      legs: [{ id: 1, mode: "Road", carrierId: C, vehicles: [
        { id: 501, truckPlate: "WX 1111", carrierId: C, load: [{ goodsLineId: 9101, qtyKg: 10000 }, { goodsLineId: 9102, qtyKg: 8000 }], plannedLoadingDate: "2026-07-23", plannedDeliveryDate: "2026-07-30" },
        { id: 502, truckPlate: "WY 2222", carrierId: C, load: [{ goodsLineId: 9103, qtyKg: 12000 }], plannedLoadingDate: "2026-02-20", plannedDeliveryDate: "2026-02-22" }] }] };
    const SM = require(path.resolve("./src/shipmentModel.domain"));
    const nameOf = (po) => (d.pos.find(p => p.number === po).supplier || {}).name;
    await t("v7.15.0: the truck's stops come from its goods — AGRO-HURT (23 July) then AGRO-MAX (4 Aug), each with its kilos", async () => {
      const st = SM.truckLoadingStops(SH, SH.legs[0].vehicles[0], d.pos, d.lots);
      ok(st.length === 2 && st[0].refs[0] === "PO-2026-0003" && st[1].refs[0] === "PO-2026-0008", JSON.stringify(st.map(s => s.refs)));
      ok(st[0].date === "2026-07-23" && st[1].date === "2026-08-04" && st[0].kg === 10000 && st[1].kg === 8000, "dates / kilos");
    });
    const { EditShipmentModal: EdM2 } = require(path.resolve("./src/ShipmentEditor"));
    const edT = (s) => T(renderToStaticMarkup(React.createElement(EdM2, { shipment: s, contacts: d.contacts, lots: d.lots, pos: d.pos, orders: d.orders, packagingTypes: d.packagingTypes || [], allShipmentsForCap: d.shipments, invoices: [], onSave: noop, onCancel: noop })));
    await t("v7.15.0: the truck card shows 'Loading 1 · Loading 2' (read-only), not 'split the truck'", async () => {
      const h = edT(SH); ok(/Loading 1 ·[^·]*· 23\/07\/2026 · Apples 70-80 10 ?000 kg \(PO-2026-0003\)/.test(h), "stop 1: " + (h.match(/Loading 1.{0,140}/) || [""])[0]);
      ok(/Loading 2 ·[^·]*· 04\/08\/2026 · Apples 65-70 8 ?000 kg \(PO-2026-0008\)/.test(h), "stop 2"); ok(!/split the truck/.test(h), "still says split the truck");
    });
    await t("v7.15.3: a delivery date before the last loading is flagged in amber", async () => {
      const bad = JSON.parse(JSON.stringify(SH)); bad.legs[0].vehicles[0].plannedDeliveryDate = "2026-07-30";   // before the 4 Aug stop
      const h = edT(bad); ok(/delivery 30\/07\/2026 is before the last loading 04\/08\/2026/.test(h), "no warning");
      const good = JSON.parse(JSON.stringify(SH)); good.legs[0].vehicles[0].plannedDeliveryDate = "2026-08-06"; ok(!/is before the last loading/.test(edT(good)), "warns on a good date");
    });
    const SD = require(path.resolve("./src/ShipmentDocuments"));
    const toH = renderToStaticMarkup(React.createElement(SD.TransportOrderDocument, { shipment: SH, contacts: d.contacts, providerId: C, orders: d.orders, pos: d.pos, lots: d.lots, packagingTypes: d.packagingTypes || [] }));
    const toT = T(toH);
    await t("v7.15.1: ONE order for the forwarder prints BOTH trucks, every stop with its own date and goods", async () => {
      ok(/WX 1111/.test(toT) && /WY 2222/.test(toT), "a truck is missing");
      ok(/2026-07-23 — Apples Gala 70-80 10 ?000 kg/.test(toT) && /2026-08-04 — Apples Golden Delicious 65-70 8 ?000 kg/.test(toT) && /2026-02-20 — Apples Idared 70-80 12 ?000 kg/.test(toT), "a stop's date or goods missing: " + (toT.match(/Route stops.{0,500}/) || [""])[0]);
    });
    await t("v7.15.1: the conditions print — the standard road terms AND the written ones — kept with the signatures", async () => {
      ok(/Terms \/ Warunki/.test(toT), "no terms block"); ok(/Additional conditions \/ Warunki dodatkowe/.test(toT) && /Payment 30 days after delivery with the CMR copy\./.test(toT) && /Temperature recorder mandatory\./.test(toT), "written conditions missing");
      ok(/data-terms-together="1"/.test(toH), "not kept together"); ok(toT.indexOf("Additional conditions") < toT.indexOf("Carrier / Zleceniobiorca Date, stamp"), "conditions not before the signatures");
    });
    await t("v7.15.2: ONE protocol per producer — truck WX 1111 has two sheets (AGRO-HURT, AGRO-MAX), WY 2222 one; three numbers", async () => {
      const LP = require(path.resolve("./src/LoadingProtocolModal")).default;
      const h = T(renderToStaticMarkup(React.createElement(LP, { shipment: SH, contacts: d.contacts, pos: d.pos, lots: d.lots, packagingTypes: d.packagingTypes || [], allShipments: d.shipments, onSave: noop, onClose: noop })));
      const tabs = h.match(/WX 1111 · 1\/2[^·]*· LP-\d{4}-\d+|WX 1111 · 2\/2[^·]*· LP-\d{4}-\d+|WY 2222 · LP-\d{4}-\d+/g) || [];
      ok(tabs.length === 3, "sheets: " + JSON.stringify(tabs) + " — " + (h.match(/Truck .{0,300}/) || [""])[0]);
      const nums = tabs.map(x => x.match(/LP-\d{4}-\d+/)[0]); ok(new Set(nums).size === 3, "numbers repeat: " + nums);
      ok(new RegExp(nameOf("PO-2026-0003").slice(0, 12)).test(h), "the first sheet does not name AGRO-HURT as the place of loading");
    });
  }

  // ══ v7.16.5–7.16.11 — Batch A, the screens and the words (owner 9 Oct: 'batch what is ready now') ══
  const srcOf = f => fs.readFileSync(path.resolve("./src/" + f), "utf8");
  await t("AUD-31: a foreign-currency settlement cannot be closed without its rate (the screen says why)", async () => {
    ok(/data-close-needs-rate="1"/.test(srcOf("PurchaseOrders.tsx")) && /cur !== "PLN" && !\(Number\(rate\) > 0\)/.test(srcOf("PurchaseOrders.tsx")), "the close is not gated on the rate");
  });
  await t("A-RV-14: the SO view shows our own payment state, never Fakturownia's paid flag; a match needs the same tax id", async () => {
    const v = srcOf("SalesOrderDetail.tsx"), so = srcOf("SalesOrders.tsx");
    ok(!/fakturownia\?\.paid/.test(v) && /settlementState\(inv, localTodayISO\(\)\)/.test(v), "the SO view still reads Fakturownia's flag");
    ok(!/paid: !!hit\.paid/.test(so) && !/status: hit\.status/.test(so), "Fakturownia's paid flag / status are still stored"); ok(!/\.includes\(String\(order\.client\.nip\)/.test(so), "the tax id still matches by 'contains'");
  });
  await t("A-RV-09: one meaning per word — Delete for stored records, Remove for lines, Close only to go back", async () => {
    const closeRemoves = ["Inventory.tsx", "InventoryWindows.tsx", "Shipments.tsx"].filter(f => /<ActionButton action="close" onClick=\{\(\) => set\w*\([^)]*\.filter\(/.test(srcOf(f)));
    ok(!closeRemoves.length, "a Close button still removes a line in " + closeRemoves.join(", "));
    ok(!/title: `Cancel invoice/.test(srcOf("Invoices.tsx")) && /confirmLabel: "Delete invoice"/.test(srcOf("Invoices.tsx")), "'Delete invoice' still opens 'Cancel invoice'");
    ok(!/Cancel the dependent Sales Order/.test(srcOf("Inventory.tsx")), "the blocked lot delete still says Cancel");
    ok(!/Pick a stock lot or a PO for every line/.test(srcOf("SalesOrders.tsx")), "the SO save message still offers a PO");
    const st = srcOf("Settings.tsx"); ok(!/confirmLabel: "Remove"/.test(st) && !/onClick=\{\(\) => (del\(t\)|rmItem\(c\.item\))\}[^>]*>Remove</.test(st), "master data still says Remove");
  });
  await t("A-RV-08: a place in use names the documents that use it", async () => {
    const c = srcOf("Contacts.tsx"); ok(/const usersOf = \(id: any\): string\[\]/.test(c) && /is used by \$\{docs\.length\} document\(s\): \$\{docs\.slice\(0, 12\)/.test(c), "the refusal does not name the documents");
    // on the 2 Oct file: the places the documents use, and who uses the first
    const used = {}; d.shipments.forEach(sh => (sh.legs || []).forEach(lg => [lg.fromLocationId, lg.toLocationId].forEach(x => { if (x != null) (used[x] = used[x] || new Set()).add(sh.number); })));
    const top = Object.entries(used).sort((a, b) => b[1].size - a[1].size)[0]; if (top) console.log(`      (e.g. place ${top[0]}: ${top[1].size} shipments would be named)`);
  });
  await t("A-TD-6: the PO badge shows the incoterm and place only — an old stored direction adds no word", async () => {
    const { FlowBadge } = require(path.resolve("./src/PurchaseOrders"));
    const h = T(renderToStaticMarkup(React.createElement(FlowBadge, { order: { buyIncoterm: "EXW", tradeMovement: "EXPORT", destinationText: "Jabłonna" } })));
    ok(/EXW Jabłonna/.test(h) && !/export/i.test(h), "badge reads: " + h.trim());
  });
  await t("BP-9 / BP-17: 'Actual availability' is off the PO form and 'Actual delivery' off the SO form", async () => {
    const { OrderForm } = require(path.resolve("./src/PurchaseOrderForm")); const po = d.pos[0];
    const h = T(renderToStaticMarkup(React.createElement(OrderForm, { order: { ...po, status: "Draft" }, setOrder: noop, contacts: d.contacts, allSOs: d.orders, allShipments: d.shipments, lots: d.lots, onSave: noop, onCancel: noop })));
    ok(/Expected delivery date/.test(h), "the PO form did not render"); ok(!/Actual availability/.test(h), "the PO form still shows 'Actual availability'");
    ok(!/<Lbl>Actual delivery<\/Lbl>/.test(srcOf("SalesOrderForm.tsx")), "the SO form still shows 'Actual delivery'");
  });
  await t("A-RV-04: a catalog CN code is saved with Save, not at each keystroke", async () => {
    const { ProductCatalogPanel } = require(path.resolve("./src/Settings")); ok(ProductCatalogPanel, "the catalog panel is not reachable");
    let cat = [{ item: "Papryka", varieties: ["Kapia"], defaultCnCode: "0709" }]; let writes = 0;
    const setCatalog = u => { writes++; cat = typeof u === "function" ? u(cat) : u; };
    const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
    await act(async () => { root.render(React.createElement(ProductCatalogPanel, { catalog: cat, setCatalog })); });
    const inp = host.querySelector('input[placeholder="CN/HS"]'); ok(inp, "no CN input");
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(inp, "070960"); inp.dispatchEvent(new window.Event("input", { bubbles: true })); });
    ok(writes === 0, `typing wrote the catalog ${writes} time(s)`);
    const save = Array.from(host.querySelectorAll("button")).find(b => (b.textContent || "").trim() === "Save"); ok(save && !save.disabled, "no active Save under the catalog");
    const oc = window.confirm; window.confirm = () => true; await act(async () => { save.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); window.confirm = oc;
    ok(writes === 1 && cat[0].defaultCnCode === "070960", `after Save: ${writes} write(s), code '${cat[0].defaultCnCode}'`);
    await act(async () => { root.unmount(); });
  });

  // ══ v7.17.0–7.17.5 — Batch B, the rules (owner 9 Oct: 'batch what is ready now') ══
  const base17 = { contacts: d.contacts, setContacts: noop, pos: d.pos, setPOs: noop, orders: d.orders, setOrders: noop, allOrders: d.orders, lots: d.lots, setLots: noop, shipments: d.shipments, setShipments: noop, invoices: d.invoices || [], setInvoices: noop, claims: d.claims || [], inspections: d.inspections || [], packagingTypes: d.packagingTypes || [] };
  await t("A-DEL-5: a deleted company stays on record — out of the default list, under 'Deleted'", async () => {
    const Ct = require(path.resolve("./src/Contacts")).default; const victim = d.contacts.find(c => c.type === "Carrier" && !c.archived) || d.contacts[0];
    const h = renderToStaticMarkup(React.createElement(Ct, { ...base17, contacts: d.contacts.map(c => c.id === victim.id ? { ...c, deleted: true, deletedAt: "2026-10-10" } : c) }));
    ok(!h.includes(`data-company-row="${victim.id}"`), `${victim.name} is still in the default list`); ok(/Deleted/.test(T(h)), "no 'Deleted' chip");
  });
  const clickable = async (host, label, notTitle) => Array.from(host.querySelectorAll("button")).find(b => (b.textContent || "").trim() === label && b.title !== notTitle);
  await t("A-RV-07: a catalog item in use can't be deleted (its documents named); an unused one is kept, marked deleted", async () => {
    const { ProductCatalogPanel } = require(path.resolve("./src/Settings")); const refStores = { pos: [{ number: "PO-T-1", items: [{ product: "Papryka", variety: "Kapia" }] }], orders: [], lots: [] };
    for (const [item, inUse] of [["Papryka", true], ["Jabłko", false]]) {
      let cat = [{ item, varieties: [] }]; let writes = 0; const setCatalog = u => { writes++; cat = typeof u === "function" ? u(cat) : u; };
      const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
      await act(async () => { root.render(React.createElement(ProductCatalogPanel, { catalog: cat, setCatalog, refStores })); });
      const del = Array.from(host.querySelectorAll("button")).find(b => b.title === "Delete item"); ok(del, "no Delete on the item");
      await act(async () => { del.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
      if (inUse) { ok(/can't be deleted/.test(host.textContent) && /PO-T-1/.test(host.textContent), "a used item: " + (host.textContent || "").slice(0, 160)); ok(writes === 0, "the used item was written"); }
      else { const yes = await clickable(host, "Delete", "Delete item"); ok(yes, "no confirmation"); await act(async () => { yes.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); ok(writes === 1 && cat.length === 1 && cat[0].deleted === true, `unused item after Delete: ${JSON.stringify(cat)}`); }
      await act(async () => { root.unmount(); });
    }
  });
  await t("A-RV-10: Delete is on every record view — PO, SO, shipment, lot, invoice (a paid one too), claim, company", async () => {
    const miss = []; const hasDel = h => /<button[^>]*>\s*(🗑\s*)?Delete\b[^<]*<\/button>|<button[^>]*title="Delete"/.test(h); const live = a => (a || []).find(x => x && x.status !== "Cancelled");
    const mods = { PO: ["./src/PurchaseOrders", live(d.pos)], SO: ["./src/SalesOrders", live(d.orders)], shipment: ["./src/Shipments", live(d.shipments)], lot: ["./src/Inventory", live(d.lots)], invoice: ["./src/Invoices", (d.invoices || []).find(i => i.paymentStatus === "Paid") || live(d.invoices)] };
    for (const [k, [m, rec]] of Object.entries(mods)) { if (!rec) { miss.push(k + ": no record"); continue; }
      try { const h = renderToStaticMarkup(React.createElement(require(path.resolve(m)).default, { ...base17, initialSelectedNumber: rec.number })); if (!hasDel(h)) miss.push(`${k} ${rec.number}`); } catch (e) { miss.push(`${k}: ${String(e.message).slice(0, 50)}`); } }
    const ch = renderToStaticMarkup(React.createElement(require(path.resolve("./src/Contacts")).default, base17)); if (!hasDel(ch)) miss.push("company");
    const Claims = require(path.resolve("./src/Claims")).default; const sup = d.contacts.find(c => (c.roles || [c.type]).includes("Supplier")) || d.contacts[0];
    const claim = { id: "t-clm-17", number: "CLM-TEST-0017", date: "2026-10-01", direction: "RECOVERY", status: "Open", cause: "Quality defect", currency: "EUR", respondent: { kind: "Supplier", contactId: sup.id, name: sup.name }, subjects: [], costLines: [], clientCosts: [] };
    const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
    await act(async () => { root.render(React.createElement(Claims, { ...base17, claims: [claim], setClaims: noop })); });
    for (const e of Array.from(host.querySelectorAll("*")).filter(e => Array.from(e.childNodes).some(n => n.nodeType === 3 && /CLM-TEST-0017/.test(n.textContent || "")))) { await act(async () => { e.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); if (/Respondent — who is on the other side/.test(host.textContent || "")) break; }
    if (!hasDel(host.innerHTML)) miss.push("claim"); await act(async () => { root.unmount(); });
    ok(!miss.length, "no Delete on: " + miss.join(" · "));
    ok(/A paid invoice|Its payments must be removed first/.test(srcOf("Invoices.tsx"))   /* v7.21.9 (A-RV-32): the refusal now covers any payment */ && !/inv\.paymentStatus !== "Paid" && inv\.paymentStatus !== "Cancelled" && <button onClick=\{\(\) => onMarkStatus\("Cancelled"\)\}/.test(srcOf("Invoices.tsx")), "a paid invoice still hides Delete");
  });
  await t("A-RV-11: overdue is amber; money going out is neutral — red is kept for real risks", async () => {
    const h = renderToStaticMarkup(React.createElement(require(path.resolve("./src/Invoices")).default, base17));
    ok(!/background:#DC2626[^>]*>\s*\+ Cost invoice/.test(h), "'+ Cost invoice' is still red"); ok(!/color:#DC2626[^>]*>\d+d late/.test(h), "'N d late' is still red");
    ok(!/PAYABLE · OPEN<\/div><div style="[^"]*color:#DC2626/.test(srcOf("Finance.tsx").replace(/\s+/g, " ")) && !/s === "Overdue" \? "#DC2626"/.test(srcOf("Finance.tsx")), "Finance still shows overdue / payable in red");
    ok(!/overdueLoading > 0 \? "#DC2626"/.test(srcOf("PurchaseOrders.tsx")), "the PO list's overdue-loading tile is still red");
  });
  await t("A-RV-12: payments, company / person deletes and merges, packaging and catalog changes are audited; the oldest entries go to the archive", async () => {
    const inv = srcOf("Invoices.tsx"), ct = srcOf("Contacts.tsx"), st = srcOf("Settings.tsx"), app = srcOf("App.tsx");
    ok(/Payment recorded:/.test(inv) && /Payment removed:/.test(inv), "payments not audited"); ok(/docType: "Company", [^}]*action: "deleted"/.test(ct) && /action: "merged"/.test(ct) && /docType: "Person"/.test(ct), "company / person changes not audited");
    ok(/docType: "Packaging"/.test(st) && /docType: "Catalog"/.test(st), "packaging / catalog not audited"); ok(/splitAuditOverflow\(/.test(app) && /"auditArchive"/.test(srcOf("useLocalStoredState.ts")), "the oldest entries are still dropped");
  });
  await t("A-RV-06: report numbers are the highest of their kind + 1; record ids come from the one counter", async () => {
    const y = new Date().getFullYear(); localStorage.setItem("marianna-erp:v2:reportRegister", JSON.stringify([{ number: `QR-${y}-0001`, kind: "QR" }, { number: `QR-${y}-0003`, kind: "QR" }]));
    const n = require(path.resolve("./src/reportNumbers")).issueReportNumber("QR", "test"); ok(n === `QR-${y}-0004`, "got " + n + " (a count repeats QR-…-0003)");
    ok(!/role-\$\{Date\.now\(\)/.test(srcOf("Settings.tsx")) && !/id: contacts\.length \+ 1/.test(srcOf("Contacts.tsx")) && !/pk-\$\{Date\.now\(\)/.test(srcOf("PurchaseOrderDetail.tsx")) && !/Math\.max\(CUSTOM_LOCATION_ID_BASE, \.\.\.existing/.test(srcOf("locations.ts")), "an id is still made outside the counter");
  });

  // ══ v7.18.0–7.18.8 — Batch C, lists instead of typing (owner 9 Oct: 'batch what is ready now') ══
  const click18 = async el => { await act(async () => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }); };
  await t("A-AU-1: a PO line's packaging is picked from the types; a typed one shows as 'typed — not linked'", async () => {
    const { OrderForm } = require(path.resolve("./src/PurchaseOrderForm")); const po = d.pos.find(p => (p.items || []).some(i => i.packaging && !i.packagingId));
    const h = renderToStaticMarkup(React.createElement(OrderForm, { order: { ...po, status: "Draft" }, setOrder: noop, contacts: d.contacts, allSOs: d.orders, allShipments: d.shipments, lots: d.lots, onSave: noop, onCancel: noop, setPackagingTypes: noop }));
    ok(/data-packaging-picker="1"/.test(h), "no packaging picker"); ok(!/list="po-packaging-types"/.test(h), "the packaging is still typed"); ok(/typed — not linked/.test(T(h)) && /New packaging type/.test(T(h)), "no typed marker / no '+ New packaging type'");
  });
  await t("A-AU-1: Settings → Packaging types lists each typed spelling once and links it with Link", async () => {
    const { PackagingPanel } = require(path.resolve("./src/Settings")); const calls = [];
    const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
    await act(async () => { root.render(React.createElement(PackagingPanel, { types: d.packagingTypes, setTypes: noop, refStores: { pos: d.pos, orders: d.orders, lots: d.lots, shipments: d.shipments }, onLinkSpelling: (k, ty) => calls.push([k, ty.id]) })); });
    const rows = host.querySelectorAll("[data-typed-spelling]"); ok(rows.length >= 10, `${rows.length} spelling rows`);
    const row = host.querySelector('[data-typed-spelling="13kg wooden boxes"]'); ok(row, "no row for '13kg wooden boxes'");
    await click18(Array.from(row.querySelectorAll("button")).find(b => (b.textContent || "").trim() === "Link"));
    const yes = Array.from(host.querySelectorAll("button")).find(b => (b.textContent || "").trim() === "Link" && !b.closest("[data-typed-spelling]")); ok(yes, "no confirmation"); await click18(yes);
    ok(calls.length === 1 && calls[0][0] === "13kg wooden boxes" && calls[0][1] === "wooden-box-13", "linked: " + JSON.stringify(calls)); await act(async () => { root.unmount(); });
  });
  await t("A-AU-3: a sale's destination is one of the client's sites; Counterparties → Locations lists the typed addresses once", async () => {
    const { OrderForm } = require(path.resolve("./src/SalesOrderForm")); const so = d.orders.find(o => o.client && o.client.name === "TOLEBAVAT REBAL");
    const h = T(renderToStaticMarkup(React.createElement(OrderForm, { order: { ...so, status: "Draft", destinationMode: "client", destinationText: "", destinationLocationId: null }, setOrder: noop, allOrders: d.orders, contacts: d.contacts, onSave: noop, onCancel: noop })));
    ok(/Legal address/.test(h) && /Add a site for this client/.test(h), "the client's sites are not offered");
    const { PortsView } = require(path.resolve("./src/Contacts"));
    const ph = renderToStaticMarkup(React.createElement(PortsView, { counterparties: d.contacts, pos: d.pos, orders: d.orders, lots: d.lots, shipments: d.shipments, onLinkSaleDestination: noop }));
    const n = (T(ph).match(/Link to the legal address/g) || []).length; ok(/data-typed-destinations="1"/.test(ph) && n === 5, `${n} 'Link to the legal address' (5 expected on the 2 Oct file)`);
  });
  await t("A-AU-4: a shipment document's type is picked from the one list", async () => {
    // the documents sit in the editor's closing stage, which opens by itself once a shipment is delivered (a person opens it the same way)
    const sh28 = d.shipments.find(s => s.number === "SHP-2026-0028");
    const h = T(renderToStaticMarkup(React.createElement(EditShipmentModal, { shipment: { ...sh28, status: "Delivered" }, contacts: d.contacts, lots: d.lots, pos: d.pos, orders: d.orders, packagingTypes: d.packagingTypes || [], allShipmentsForCap: d.shipments, invoices: d.invoices || [], onSave: noop, onCancel: noop }))); ok(/— pick the type —/.test(h) && /Certificate of origin/.test(h), "the document type is still typed"); ok(/Loading protokol \(typed\)/.test(h), "a type outside the list is not marked typed");
  });
  await t("A-AU-5: calibre and coloration are picked from the item's lists; Settings → Catalog offers the values already on lines", async () => {
    const { OrderForm } = require(path.resolve("./src/PurchaseOrderForm")); const po = d.pos.find(p => (p.items || []).some(i => i.product === "Apples" && i.size)); const cat = [{ item: "Apples", varieties: ["Gala"], calibres: ["65-70"], colorations: [] }];
    const h = renderToStaticMarkup(React.createElement(OrderForm, { order: { ...po, status: "Draft" }, setOrder: noop, contacts: d.contacts, allSOs: d.orders, allShipments: d.shipments, lots: d.lots, productCatalog: cat, setProductCatalog: noop, onSave: noop, onCancel: noop }));
    ok(/data-catalog-value="calibres"/.test(h) && /data-catalog-value="colorations"/.test(h), "size / coloration are still typed");
    const { ProductCatalogPanel } = require(path.resolve("./src/Settings"));
    const s = T(renderToStaticMarkup(React.createElement(ProductCatalogPanel, { catalog: cat, setCatalog: noop, refStores: { pos: d.pos, orders: d.orders, lots: d.lots } })));
    ok(/Calibres/.test(s) && /Colorations/.test(s) && /\+ 70-80/.test(s), "no calibre lists, or 70-80 (on the lines) not offered");
  });
  await t("A-AU-9: the manual shipment form picks the product, the PO and the SO from lists", async () => {
    const s = srcOf("ShipmentCreate.tsx"); ok(!/<Inp value=\{form\.(product|poRef|soRef)\}/.test(s) && /catalogItems\(productCatalog\)/.test(s), "still typed");
  });
  await t("A-AU-10: the inspector and the counter come from Users, the sorter from our team or a warehouse, a claim's costs from their lists", async () => {
    const inv = srcOf("Inventory.tsx"), cl = srcOf("Claims.tsx");
    ok(/label="Inspector"><NamePicker/.test(inv) && /label="Counted by"><NamePicker/.test(inv) && /label="Sorted by"><NamePicker value=\{f\.by\} options=\{\["Our team"/.test(inv), "a name is still typed in Inventory");
    ok(require(path.resolve("./src/Inventory")).userNames([{ name: "Hazem" }, { name: "Ana", deleted: true }, { email: "m@x.pl" }]).join() === "Hazem,m@x.pl", "the users list is not read");
    ok(!/<input value=\{cc\.label/.test(cl) && !/<input value=\{l\.label/.test(cl) && /<CostLabelPicker value=\{cc\.label\} options=\{CAUSED_COST_LABELS\}/.test(cl), "a claim's cost line is still typed");
  });
  await t("A-AU-12: claims, settlements and warehouse invoices take NBP rates — none typed", async () => {
    const cl = srcOf("Claims.tsx"), po = srcOf("PurchaseOrders.tsx"), fi = srcOf("Finance.tsx");
    ok(!/patch\(selected\.id, \{ plnPerEur: e\.target\.value \}\)/.test(cl) && /nbpRateBefore\("EUR", date\)/.test(cl), "the claim's rate is still typed");
    ok(!/upd\(\{ ratePLNperEUR: parseFloat/.test(po) && /settlementRate\(order, rec/.test(po), "the settlement's rate is still typed");
    ok(!/setInv\(\{ \.\.\.inv, fxRate: e\.target\.value \}\)/.test(fi) && /nbpRateBefore\(c, inv\.date\)/.test(fi), "the warehouse invoice's rate is still typed");
  });
  await t("BP-46: a company may carry a default VAT rate; an invoice draft for it starts there", async () => {
    ok(/Default VAT rate \(invoices\)/.test(srcOf("Contacts.tsx")) && /terms\?\.defaultVatRate/.test(srcOf("Invoices.tsx")), "no default VAT rate on the company / the invoice form");
    const { buildInvoiceFromSO } = require(path.resolve("./src/SalesOrders")); const so = d.orders.find(o => (o.items || []).length);
    ok(buildInvoiceFromSO(so, "FV-T", "2026-10-11", 8).vatRate === 8 && buildInvoiceFromSO(so, "FV-T", "2026-10-11").vatRate === 5, "the client's rate is not used (or the 5 % default moved)");
  });
  await t("BP-51: a PO line carries no currency — a new line and a header change write none", async () => {
    const s = srcOf("PurchaseOrderForm.tsx"); ok(!/currency: o\.currency \|\| "PLN", packaging/.test(s) && !/\(\{ \.\.\.it, currency: e\.target\.value \}\)/.test(s) && !/unitPrice: "", currency: "PLN", packaging/.test(srcOf("PurchaseOrders.tsx")), "a line currency is still written");
  });

  // ══ v7.19.x — Batch D, shipments and incoterms ══
  const edS = sh => T(renderToStaticMarkup(React.createElement(EditShipmentModal, { shipment: sh, contacts: d.contacts, lots: d.lots, pos: d.pos, orders: d.orders, packagingTypes: d.packagingTypes || [], allShipmentsForCap: d.shipments, invoices: d.invoices || [], onSave: noop, onCancel: noop })));
  const shp = (no, extra) => ({ ...d.shipments.find(s => s.number === no), ...(extra || {}) });
  await t("A-INC-1 (1/5): the editor says who pays each leg — SHP-2026-0026's sea leg is the client's (SO-0015 sold EXW) and its old sea freight is flagged; SHP-2026-0039's leg is ours", async () => {
    const a = edS(shp("SHP-2026-0026", { status: "Booked" })); ok(/Freight: the client's · sold EXW/.test(a), "no payer on the sea leg: " + (a.match(/Leg #1.{0,160}/) || ["(no leg)"])[0]);
    const c = edS(shp("SHP-2026-0026", { status: "Delivered" })); ok(/Not ours under the terms: leg 1's freight is the client's \(sold EXW, SO-2026-0015\)/.test(c), "the 8 502 EUR sea line is not flagged");
    const b = edS(shp("SHP-2026-0039", { status: "Booked" })); ok(/Freight: ours · bought DDP · sold DAP/.test(b), "SHP-0039's leg is not shown as ours"); ok(!/Not ours under the terms/.test(edS(shp("SHP-2026-0039", { status: "Delivered" }))), "SHP-0039's road freight flagged");
  });
  await t("A-INC-1 (2/5): EXW sales are not offered for a shipment of ours (From SO, groupage); SHP-2026-0026, carrying SO-0015 sold EXW, says so", async () => {
    const s = srcOf("ShipmentCreate.tsx"); ok((s.match(/!isExwSale\(o\)/g) || []).length === 2 && /EXW sale\{exwHidden > 1 \? "s" : ""\} not listed/.test(s), "EXW sales still offered in the create window");
    ok(/SO-2026-0015 is sold EXW — the client arranges and pays the carriage/.test(edS(shp("SHP-2026-0026", { status: "Booked" }))), "no EXW notice on SHP-0026");
    ok(!/is sold EXW — the client arranges/.test(edS(shp("SHP-2026-0039", { status: "Booked" }))), "SHP-0039 (sold DAP) flagged");
  });
  await t("A-INC-1 (3/5): every D-rule purchase builds the supplier's truck; the editor states it from the PO — the hand tick is gone", async () => {
    const s = srcOf("ShipmentCreate.tsx"); ok(/if \(isDRule && sh\) sh = asSuppliersTruck\(sh, selectedPO\)/.test(s) && !/=== "DDP";/.test(s), "the create window still treats DDP alone");
    ok(/Bought DDP \(PO-2026-0044\) — the supplier's truck: tracked, not paid/.test(edS(shp("SHP-2026-0037", { status: "Delivered" }))), "SHP-0037 does not say it is the supplier's truck");
    const h = edS(shp("SHP-2026-0039", { status: "Delivered" })); ok(!/Bought DAP\/DDP — the supplier arranges/.test(h) && !/the supplier's truck: tracked/.test(h), "the tick is still there, or SHP-0039 called the supplier's truck");
  });
  await t("A-INC-1 (4/5): the customs section says who clears from the terms — an export sold CIF is ours, the same sold EXW is the client's (no fields, no cost line); a customs cost already there is kept, flagged", async () => {
    const ShM = require(path.resolve("./src/Shipments")); ShM.setContactsRef(d.contacts);
    const a = edS(shp("SHP-2026-0035", { status: "Loaded" })); ok(/Who clears: export — ours \(sold CIF\)/.test(a) && /Cleared where/.test(a), "SHP-0035 (sold CIF): " + (a.match(/Who clears.{0,80}|Customs clearance applies.{0,40}/) || ["(nothing)"])[0]);
    const orders2 = d.orders.map(o => o.number === "SO-2026-0025" ? { ...o, sellIncoterm: "EXW" } : o);
    const b = T(renderToStaticMarkup(React.createElement(EditShipmentModal, { shipment: shp("SHP-2026-0035", { status: "Loaded", customs: { applies: true, cost: 450, currency: "PLN" } }), contacts: d.contacts, lots: d.lots, pos: d.pos, orders: orders2, packagingTypes: d.packagingTypes || [], allShipmentsForCap: d.shipments, invoices: d.invoices || [], onSave: noop, onCancel: noop })));
    ok(/Who clears: export — the client's \(sold EXW\)/.test(b) && !/Cleared where/.test(b), "sold EXW: the client's, no fields"); ok(/is marked 'customs applies', but under the terms the other side clears/.test(b) && /the customs cost stays as an ordinary cost line/.test(b), "the disagreement is not flagged");
    const kept = ShM.syncCustomsCostLine({ customs: { applies: false, cost: 450 }, costs: [{ id: 5, source: "customs-auto", _customsAuto: true, type: "customs", amount: 450, amountPLN: 450 }] });
    ok(kept.costs.length === 1 && !kept.costs[0].source && kept.costs[0].amount === 450, "the customs money was dropped");
    const dis = d.shipments.filter(s => s.status !== "Cancelled").map(s => { const dir = require(path.resolve("./src/tradeFlow.domain")).shipmentTradeDirection(s, { pos: d.pos, orders: d.orders, countryOf: ShM.countryOfLocation }); const du = require(path.resolve("./src/incoterms.domain")).customsDuties(s, { pos: d.pos, orders: d.orders, direction: dir }); const ours = du.some(x => x.party === "us"); return dir && !!(s.customs || {}).applies !== ours ? `${s.number} (${dir}: ${du.map(x => x.which + " " + x.party).join(", ") || "nothing"}; marked ${(s.customs || {}).applies ? "applies" : "not"})` : null; }).filter(Boolean);
    console.log("      (2 Oct file — marked otherwise than the terms say: " + (dis.join("; ") || "none") + ")");
  });
  await t("A-INC-1 (5/5): a transport claim asks where it happened and routes by the risk point — a client's claim for a loss at sea on SHP-2026-0035 (sold CIF) is the client's to claim", async () => {
    const cl = { id: "t-clm-9", number: "CLM-TEST-0009", date: "2026-10-11", direction: "CONCESSION", status: "Draft", cause: "Transport damage", currency: "EUR", respondent: { kind: "Client", contactId: null, name: "Al Baraka" }, subjects: [{ kind: "SHIPMENT", ref: "SHP-2026-0035" }], lossAt: { shipment: "SHP-2026-0035", stage: "leg:1" }, costLines: [], clientCosts: [] };
    const host2 = document.createElement("div"); document.body.appendChild(host2); const root2 = createRoot(host2); const Cl = require(path.resolve("./src/Claims")).default;
    await act(async () => { root2.render(React.createElement(Cl, { claims: [cl], setClaims: noop, contacts: d.contacts, lots: d.lots, orders: d.orders, pos: d.pos, shipments: d.shipments, invoices: d.invoices || [], financeNotes: d.financeNotes || [], inspections: d.inspections || [] })); });
    for (const e of Array.from(host2.querySelectorAll("*")).filter(e => Array.from(e.childNodes).some(n => n.nodeType === 3 && /CLM-TEST-0009/.test(n.textContent || "")))) { await act(async () => { e.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); if (/Respondent — who is on the other side/.test(host2.textContent || "")) break; }
    const tx = (host2.textContent || "").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ");
    ok(/Where did it happen on SHP-2026-0035\?/.test(tx), "no 'where did it happen' on a transport claim"); ok(/Sold CIF \(SO-2026-0025\): the risk had passed to the client before the loss on leg 2 \(Sea\)/.test(tx), "not routed: " + (tx.match(/Sold .{0,120}|Link the shipment.{0,60}/) || ["(no routing)"])[0]);
    await act(async () => { root2.unmount(); });
  });
  await t("A-TD-5: Settings → Company picks the country from the list; App passes it to the trade-direction rule; the documents print it with the address", async () => {
    ok(/set\("country", e\.target\.value\)/.test(srcOf("Settings.tsx")) && /readCountries\(\)/.test(srcOf("Settings.tsx")), "no country on the company"); ok(/setOurCountry\(/.test(srcOf("App.tsx")) && !/OUR_COUNTRY = "Poland"/.test(srcOf("tradeFlow.domain.ts")), "the rule still reads the constant");
    ok(["PurchaseOrderDocument.tsx", "SalesOrderDocument.tsx", "SalesReportDoc.tsx"].every(f => /companyAddressLines\(COMPANY\)/.test(srcOf(f))), "a document prints the bare address");
  });
  //@@C719_NEXT@@
  await t("A-RV-36: saving SHP-2026-0021 keeps one sea freight line (9 142 EUR, Received); SHP-2026-0017's invoice is kept and flagged against its unit prices", async () => {
    const ShM = require(path.resolve("./src/Shipments")); ShM.setContactsRef(d.contacts); const IC2 = require(path.resolve("./src/incoterms.domain"));
    const save = no => { const s = d.shipments.find(x => x.number === no); return { ...s, costs: ShM.costLinesByCarrierLegApply(s, IC2.legFreightPayers(s, { pos: d.pos, orders: d.orders })).costs }; };
    const s21 = save("SHP-2026-0021"); const sea = s21.costs.filter(c => c.type === "sea_freight"); ok(sea.length === 1 && Number(sea[0].amount) === 9142 && sea[0].invoiceStatus === "Received", "SHP-0021: " + JSON.stringify(sea.map(c => [c.amount, c.invoiceStatus])));
    const h = edS({ ...save("SHP-2026-0017"), status: "Delivered" }); ok(/Invoiced 3 ?600 EUR; the unit prices on this leg add up to 1 ?800 EUR/.test(h), "SHP-0017's difference is not flagged");
  });

  // ══ v7.20.x — A-INC-2: every inconsistency with the incoterms flagged for review, and one place to review them ══
  const ShM20 = require(path.resolve("./src/Shipments")); ShM20.setContactsRef(d.contacts);
  const shipList = extra => T(renderToStaticMarkup(React.createElement(ShM20.default, { shipments: d.shipments, setShipments: noop, contacts: d.contacts, pos: d.pos, lots: d.lots, orders: d.orders, claims: d.claims || [], setLots: noop, setOrders: noop, setPOs: noop, packagingTypes: d.packagingTypes || [], invoices: d.invoices || [], inspections: d.inspections || [], ...(extra || {}) })));
  const soView = (no, data) => { const x = data || d; return T(renderToStaticMarkup(React.createElement(require(path.resolve("./src/SalesOrders")).default, { orders: x.orders, setOrders: noop, contacts: x.contacts, allPOs: x.pos, invLots: x.lots, setLots: noop, shipments: x.shipments, setShipments: noop, invoices: x.invoices || [], claims: x.claims || [], financeNotes: x.financeNotes || [], packagingTypes: x.packagingTypes || [], initialSelectedNumber: no }))); };
  await t("A-INC-2 (v7.20.0): Shipments has a 'Terms to review' filter — 21 lines on 19 records on the 2 Oct file, sales included, each naming the term, the document and the record", async () => {
    const h = shipList({ initialStatusFilter: "Terms to review" });
    ok(/Terms to review \(21\)/.test(h), "no 'Terms to review (21)' in the filter"); ok(/21 inconsistencies with the incoterms on 19 records/.test(h), "the review is not drawn: " + (h.match(/inconsistenc.{0,80}/) || ["(none)"])[0]);
    ok(/CFR SO-2026-0001 named place not a port ⚠ Sold CFR: the named place must be the port of destination/.test(h), "SO-0001's line is missing");
    ok(/CIF SO-2026-0020 → SHP-2026-0028 no insurance certificate ⚠ Sold CIF: we insure the cargo — ICC \(C\) minimum/.test(h), "SHP-0028's line is missing");
    const plain = shipList(); ok(/Terms to review \(21\)/.test(plain) && !/inconsistencies with the incoterms on/.test(plain), "the review shows without the filter");
  });
  await t("A-INC-2 (v7.20.0): the selected shipment's detail shows its terms to review (SHP-2026-0028)", async () => {
    const s28 = d.shipments.find(s => s.number === "SHP-2026-0028"); const h = shipList({ shipments: [s28, ...d.shipments.filter(s => s !== s28)] });
    ok(/Terms to review \(1\) — the incoterms say otherwise[^⚠]*CIF SO-2026-0020 no insurance certificate/.test(h), "SHP-0028's detail shows no terms to review");
  });
  await t("A-INC-2 (v7.20.0): the Dashboard counts the terms to review (21) and its tile opens Shipments on that filter", async () => {
    const Dash = require(path.resolve("./src/Dashboard")).default; let got = null;
    const h3 = document.createElement("div"); document.body.appendChild(h3); const r3 = createRoot(h3);
    await act(async () => { r3.render(React.createElement(Dash, { pos: d.pos, orders: d.orders, lots: d.lots, contacts: d.contacts, shipments: d.shipments, invoices: d.invoices || [], claims: d.claims || [], onNavigate: noop, onOpenFilter: (m, f) => { got = m + "|" + f; } })); });
    const tx = (h3.textContent || "").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " "); ok(/TERMS TO REVIEW\s*21 · /.test(tx), "no count: " + (tx.match(/TERMS TO REVIEW.{0,60}/) || ["(no tile)"])[0]);
    const el = Array.from(h3.querySelectorAll("div")).find(e => (e.textContent || "").trim() === "TERMS TO REVIEW");
    await act(async () => { el && el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); ok(got === "shipments|Terms to review", "the tile did not open the filter: " + got);
    await act(async () => { r3.unmount(); });
  });
  await t("A-INC-2 (v7.20.0): App hands Shipments the claims and the Dashboard's filter; a claim's number opens the claim", async () => {
    const a = srcOf("App.tsx"); ok(/claims=\{claims\} initialStatusFilter=\{shipmentsFilter\}/.test(a), "Shipments gets no claims or filter"); ok(/onOpenFilter=\{\(m: string, flt: string\) => \{ setShipmentsFilter\(flt\); navigate\(m\); \}\}/.test(a), "the Dashboard cannot open the filter");
    ok(/if \(has\(claims\)\) return "claims";/.test(a) && /initialSelectedNumber=\{openDocNum\.module === "claims"/.test(a), "a claim number opens nothing");
    const cl = { id: "t-clm-20", number: "CLM-TEST-0020", date: "2026-10-11", direction: "RECOVERY", status: "Open", cause: "Quality defect", currency: "EUR", respondent: { kind: "Supplier", name: "X" }, subjects: [], costLines: [], clientCosts: [] };
    const h = T(renderToStaticMarkup(React.createElement(require(path.resolve("./src/Claims")).default, { claims: [cl], setClaims: noop, contacts: d.contacts, lots: d.lots, orders: d.orders, pos: d.pos, shipments: d.shipments, invoices: [], financeNotes: [], inspections: [], initialSelectedNumber: "CLM-TEST-0020" })));
    ok(/Respondent — who is on the other side/.test(h), "the claim did not open");
  });
  await t("A-INC-2 (1, v7.20.1): SO-2026-0001 (sold CFR to a typed address in Obour) says its named place must be the port of destination; SO-2026-0020 (CIF Damietta Port) does not", async () => {
    { const typed = String(d.orders.find(o => o.number === "SO-2026-0001").destinationText || "").split(",").slice(0, 2).join(",").trim(); ok(typed && new RegExp("Sold CFR: the named place must be the port of destination — it is (&quot;|\")" + typed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(soView("SO-2026-0001")), "SO-0001 not flagged"); }   // v7.21.2 (AUD-50): the typed address is read from the (anonymised) file ok(!/named place must be the port/.test(soView("SO-2026-0020")), "SO-0020 flagged");
  });
  await t("A-INC-2 (v7.20.0): SO-2026-0015's view lists what disagrees with its EXW term — on SHP-2026-0026 a shipment of ours, its sea freight, its forwarder", async () => {
    const h = soView("SO-2026-0015"); ok(/Terms to review \(3\)/.test(h) && /EXW SO-2026-0015 → SHP-2026-0026 shipment of ours, sold EXW/.test(h) && /freight on a leg not ours/.test(h) && /carrier on a leg not ours/.test(h), "SO-0015's view: " + (h.match(/Terms to review.{0,200}/) || ["(nothing)"])[0]);
  });
  await t("A-INC-2 (1, v7.20.1): a purchase bought CIF to a typed address says so on the PO's view", async () => {
    const pos2 = d.pos.map(p => p.number === "PO-2026-0007" ? { ...p, buyIncoterm: "CIF", destinationLocationId: null, destinationText: "Farm gate, Mazowsze" } : p);
    const h = T(renderToStaticMarkup(React.createElement(require(path.resolve("./src/PurchaseOrders")).default, { pos: pos2, setPOs: noop, contacts: d.contacts, lots: d.lots, setLots: noop, orders: d.orders, setOrders: noop, shipments: d.shipments, invoices: d.invoices || [], claims: d.claims || [], initialSelectedNumber: "PO-2026-0007" })));
    ok(/Bought CIF: the named place must be the port of destination — it is (&quot;|")Farm gate, Mazowsze/.test(h), "the PO's view says nothing: " + (h.match(/Terms to review.{0,160}/) || ["(no box)"])[0]);
  });
  await t("A-INC-2 (2, v7.20.2): SHP-2026-0028 (sold CIF) asks for the insurance certificate, on top and by its documents; the list offers it and holding it clears the flag", async () => {
    const s28 = shp("SHP-2026-0028", { status: "Delivered" }); const a = edS(s28); ok(/Terms to review \(1\)/.test(a) && (a.match(/this shipment holds no insurance certificate/g) || []).length === 2, "not flagged on top and by the documents");
    const raw = renderToStaticMarkup(React.createElement(EditShipmentModal, { shipment: s28, contacts: d.contacts, lots: d.lots, pos: d.pos, orders: d.orders, packagingTypes: d.packagingTypes || [], allShipmentsForCap: d.shipments, invoices: d.invoices || [], onSave: noop, onCancel: noop }));
    ok(/>Insurance certificate<\/option>/.test(raw), "the document list does not offer it"); ok(!/no insurance certificate/.test(edS({ ...s28, documents: [...(s28.documents || []), { id: 99, type: "Insurance certificate", status: "Have it" }] })), "a held certificate is still flagged");
  });
  await t("A-INC-2 (5, v7.20.5): SHP-2026-0026's sea unit names DCS NAKAPAL on a leg the client pays (sold EXW) — a transport order would go out", async () => {
    ok(/Leg 1's freight is the client's \(sold EXW, SO-2026-0015\), yet DCS NAKAPAL srl is named on this unit — a transport order would go out to them/.test(edS(shp("SHP-2026-0026", { status: "Booked" }))), "no flag by the unit");
    ok(!/is named on this unit/.test(edS(shp("SHP-2026-0039", { status: "Booked" }))), "SHP-0039 (legs ours) flagged");
  });
  await t("A-INC-2 (3–4, v7.20.3–4): the editor flags a sea-only rule on a road journey, and a D-rule carriage ending elsewhere than its named place (SHP-2026-0039 with its sale's term changed)", async () => {
    const s39 = shp("SHP-2026-0039", { status: "Booked" }); const gov = s39.governingSoRef || (s39.soRefs || [])[0];
    const withSO = patch => T(renderToStaticMarkup(React.createElement(EditShipmentModal, { shipment: s39, contacts: d.contacts, lots: d.lots, pos: d.pos, orders: d.orders.map(o => o.number === gov ? { ...o, ...patch } : o), packagingTypes: d.packagingTypes || [], allShipmentsForCap: d.shipments, invoices: d.invoices || [], onSave: noop, onCancel: noop })));
    ok(/Sold CFR, a rule for sea transport only — this shipment has no sea leg and no port on its way/.test(withSO({ sellIncoterm: "CFR" })), "a CFR road journey is not flagged");
    ok(/Sold DAP to Damietta Port: the carriage ends there — this shipment ends at/.test(withSO({ sellIncoterm: "DAP", destinationLocationId: 126 })), "an end elsewhere than the named place is not flagged");
    ok(!/Terms to review \(/.test(withSO({})), "SHP-0039 as it is has a term to review");
  });
  await t("A-INC-2 (6, v7.20.6): on the 1 Oct 16:29 file SO-2026-0027 (sold DDP) says its shipment SHP-2026-0039 carries no freight of ours", async () => {
    const p1 = FX.fixture("marianna-erp_v6.99.87_schema-v2_2026-10-01T16-29-32.json"); if (!p1) { console.log("  ⤳ SKIPPED — fixture missing: the 1 Oct 16:29 file"); return; }
    ok(/Sold DDP: we pay the carriage to the named place — yet its shipment SHP-2026-0039 carries no freight of ours/.test(soView("SO-2026-0027", JSON.parse(fs.readFileSync(p1, "utf8")))), "SO-0027 not flagged");
  });

  // ══ v7.21.9 — A-RV-32: an invoice with any payment on it can't be deleted ══
  await t("A-RV-32 (v7.21.9): Delete on a partly paid invoice is refused and names its payment — the invoice is not cancelled", async () => {
    const Inv = require(path.resolve("./src/Invoices")).default; let invs = [{ id: 9101, kind: "SALES", category: "GOODS", number: "FV/T/1", counterparty: { name: "Client T" }, issueDate: "2026-09-01", dueDate: "2026-09-15", currency: "PLN", fxRate: 1, netAmount: 1000, vatRate: 0, vatAmount: 0, grossAmount: 1000, netPLN: 1000, grossPLN: 1000, positions: [], links: [], paymentStatus: "Sent", paidAmount: 100, payments: [{ id: 1, date: "2026-09-05", amount: 100, method: "Transfer" }], notes: "", attachment: null, fakturownia: { exported: false }, source: "manual" }];
    let cancelled = false; const setInvoices = u => { const n = typeof u === "function" ? u(invs) : u; if (n.some(i => i.id === 9101 && i.paymentStatus === "Cancelled")) cancelled = true; invs = n; };
    const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
    await act(async () => { root.render(React.createElement(Inv, { invoices: invs, setInvoices, orders: [], setOrders: noop, contacts: [], lots: [], shipments: [], financeNotes: [], initialSelectedNumber: "FV/T/1" })); });
    const del = Array.from(host.querySelectorAll("button")).find(b => /^\s*Delete invoice/.test(b.textContent || "")); ok(del, "no Delete on the invoice");
    await act(async () => { del.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    const txt = T(host.innerHTML); ok(/can't be deleted/.test(txt) && /It has 1 payment on it/.test(txt) && /2026-09-05/.test(txt), "no refusal naming the payment: " + (txt.match(/FV\/T\/1.{0,120}/) || [""])[0]); ok(!cancelled, "the invoice was cancelled");
    await act(async () => { root.unmount(); }); host.remove();
  });

  // ══ v7.21.6 — the CN suggestions reach the product catalogue ══
  await t("CN (v7.21.6): Settings → Product catalogue offers Papryka its CN code (07096010) — one click fills the draft, nothing is saved until Save", async () => {
    const { ProductCatalogPanel } = require(path.resolve("./src/Settings")); let cat = [{ item: "Papryka", varieties: ["Kapia"], defaultCnCode: "" }, { item: "Jabłko", varieties: ["Gala"], defaultCnCode: "08081080" }]; let writes = 0;
    const setCatalog = u => { writes++; cat = typeof u === "function" ? u(cat) : u; };
    const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
    await act(async () => { root.render(React.createElement(ProductCatalogPanel, { catalog: cat, setCatalog, refStores: { pos: [], orders: [], lots: [] } })); });
    const btns = Array.from(host.querySelectorAll("button[data-cn-suggest]")); ok(btns.length === 1 && btns[0].getAttribute("data-cn-suggest") === "07096010", "suggestions shown: " + btns.map(b => b.getAttribute("data-cn-suggest")).join());
    await act(async () => { btns[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    ok(Array.from(host.querySelectorAll("input")).some(i => i.value === "07096010"), "the draft was not filled"); ok(writes === 0, "the catalogue was written before Save");
    await act(async () => { root.unmount(); }); host.remove();
  });

  // ══ v7.21.1 — AUD-49 (owner 11 Oct): no token box — Settings shows what the server part holds ══
  await t("AUD-49 (v7.21.1): Settings → Fakturownia asks for no token — it shows the server part's connection, the test, the live-push switch and the bank accounts", async () => {
    const St = require(path.resolve("./src/Settings")).default;
    const h = renderToStaticMarkup(React.createElement(St, { fxSettings: {}, setFxSettings: noop, contacts: d.contacts, users: [], setUsers: noop, userName: "x" })); const tx = T(h);
    ok(!/paste API token|type="password"/.test(h), "a token box is still there"); ok(/data-fkt-server="1"/.test(h) && /Checking the connection/.test(tx), "no server status line");
    ok(/never in a browser/.test(tx) && /Test connection/.test(tx) && /Read bank accounts from Fakturownia/.test(tx) && /Allow creating real invoices in Fakturownia from this browser/.test(tx), "a part of the panel is missing");
  });

  // ══ v7.21.0 — A-RV-19 (owner ruling B, 8 Oct): no single-browser mode ══
  await t("A-RV-19 (v7.21.0): a copy without the two shared-data settings says it isn't connected — it never runs on its own browser's data", async () => {
    const G = require(path.resolve("./src/SharedStoreGate"));
    function W() { const s = G.useSharedStore("x"); return React.createElement("div", null, s.ready ? "THE APP RAN" : s.node); }
    const h = T(renderToStaticMarkup(React.createElement(W)));
    ok(/This copy isn't connected to the shared data/.test(h), h.slice(0, 160)); ok(!/THE APP RAN/.test(h), "the app ran on this browser's data"); ok(/restore it into the TEST copy/.test(h), "no word on old backups");
  });

  console.log(`CONNECTIONS: ${passed} passed, ${failed} failed`); if (failed) process.exit(1);
})();
