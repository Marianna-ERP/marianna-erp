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
// v6.99.69 (A-BT-1): every rendered screen is scanned for buttons that break the vocabulary — a bare "×"/"x" close, glyph-prefixed
// Edit/Print, old export/import wordings, or a Delete that is not red.
const buttonFaults = [];
function scanButtons(html, where) {
  const re = /<button\b([^>]*)>([^<]{0,60})<\/button>/g; let m;
  while ((m = re.exec(html))) {
    const attrs = m[1], label = m[2].trim();
    if (/^(×|x|✕)$/.test(label) && !/title="Dismiss"|Remove variety|remove this item/.test(attrs)) buttonFaults.push(where + ': bare "' + label + '" close button');
    if (/^(✎ Edit|🖨 Print|⬇ Excel|Export CSV|⬇ Export CSV|⬆ Import her workbook|⬆ Upload file)/.test(label)) buttonFaults.push(where + ': old wording "' + label + '"');
    if (/^Delete\b/.test(label) && !/#DC2626|#B91C1C/i.test(attrs)) buttonFaults.push(where + ': Delete not red');
  }
}
const renderToStaticMarkup = (el) => { const html = _rsm(el); try { scanSelects(html, _where); scanButtons(html, _where); } catch (e) {} return html; };
const FX = require("./fixtures.cjs");   // v6.99.71 (A-TF-1): the data file and every fixture come from tests/fixtures
const file = FX.ownerDataFile(process.argv[2]);
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
// v6.99.64 (A-HD-1): EVERY module in the navigation shows the one header — the list is read from App.tsx's own switch,
// so a module added later is checked automatically (the v6.99.61 pass missed the audit trail because it used a hand-made list).
{ try {
    const appSrc = fs.readFileSync(path.resolve("./src/App.tsx"), "utf8");
    const keys = Array.from(appSrc.matchAll(/case "([a-z]+)":\s*\n?\s*(?:\/\/[^\n]*\n\s*)*return <([A-Z][A-Za-z]+)/g)).map(m => [m[1], m[2]]);
    const d8 = JSON.parse(fs.readFileSync(file, "utf8"));
    const props = { pos: d8.pos, setPOs: () => {}, orders: d8.orders, setOrders: () => {}, lots: d8.lots, setLots: () => {}, contacts: d8.contacts, setContacts: () => {}, shipments: d8.shipments, setShipments: () => {}, invoices: d8.invoices || [], setInvoices: () => {}, claims: d8.claims || [], setClaims: () => {}, auditLog: [], operationalCosts: [], setOperationalCosts: () => {}, users: [], userName: "", reloadFromStorage: () => {} };
    const files = { Dashboard: "Dashboard", Claims: "Claims", AuditTrail: "AuditTrail", Finance: "Finance", Contacts: "Contacts", PurchaseOrders: "PurchaseOrders", Inventory: "Inventory", SalesOrders: "SalesOrders", Shipments: "Shipments", Invoices: "Invoices", Settings: "Settings" };
    const bad = []; let n = 0;
    for (const [key, comp] of keys) {
      const file = files[comp]; if (!file) { bad.push(key + " → " + comp + " (unknown component — add it to this check)"); continue; }
      _where = "module " + key; let html = "";
      try { const mod = require(path.resolve("./src/" + file)); html = renderToStaticMarkup(React.createElement(mod.default || mod[comp], props)); } catch (e) { bad.push(key + " (render: " + (e.message || "").slice(0, 50) + ")"); continue; }
      n++;
      const shared = html.includes('data-module-header="1"'); const reference = /background:#fff;border-bottom:1px solid #EBEBEB;padding:0 28px;height:52px/.test(html.replace(/\s/g, "").replace(/border-bottom:1pxsolid#EBEBEB/g, "border-bottom:1px solid #EBEBEB").replace(/padding:028px/g, "padding:0 28px")) || /height:52px/.test(html);
      if (!shared && !reference) bad.push(key + " has its own header");
      { const at = html.indexOf('data-module-header="1"') >= 0 ? html.indexOf('data-module-header="1"') : html.search(/height:52px/);   // the TITLE inside the header bar only
        const bar = at >= 0 ? html.slice(at, at + 900) : ""; const m = bar.match(/font-size:(\d+)px;font-weight:(700|800)/);
        if (!m || m[1] !== "16") bad.push(key + " title is " + (m ? m[1] + " px" : "missing")); }
    }
    if (keys.length < 10) bad.push("only " + keys.length + " modules found in App.tsx — the reader needs fixing");
    if (!bad.length) { passed++; console.log("  \u2713 every module in the navigation (" + n + ") shows the one header"); } else { failed++; console.log("  \u2717 module headers — " + bad.join("; ")); }
  } catch (e) { failed++; console.log("  \u2717 module headers —", (e.message || "").slice(0, 120)); } }
// v6.99.63 (A-SH): the planning sheet renders her imported tabs with the owner's columns, and no colour index
{ try { const PS = require(path.resolve("./src/PlanningSheet")).default; const Sh = require(path.resolve("./src/sheet.domain")); const Bd = require(path.resolve("./src/board.domain")); const XLSX = require("xlsx");
    const wb = XLSX.readFile(FX.fixture("sample_season_workbook.xlsx"), { cellDates: true });
    const tabs = wb.SheetNames.map((n, i) => ({ ...Sh.importWorkbookRows(n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }), Bd.HER_HEADERS, "2026-09-25T10:00:00Z"), order: i + 1 }));
    const d7 = JSON.parse(fs.readFileSync(file, "utf8"));
    _where = "planning sheet";
    const html = renderToStaticMarkup(React.createElement(PS, { tabs, setTabs: () => {}, log: [], setLog: () => {}, contacts: d7.contacts, catalog: [], orders: d7.orders, invoices: d7.invoices || [] }));
    const ok = ["Planning sheet", "Controlling person", ">ETD<", ">ETA<", ">SO<", "New tab", "Add row", "Export file (all tabs)"].every(s => html.includes(s)) && !html.includes("1 · Purchase");
    if (ok) { passed++; console.log("  \u2713 planning sheet renders her 5 tabs with the owner's columns; no colour index"); } else { failed++; console.log("  \u2717 planning sheet did not render as expected"); }
  } catch (e) { failed++; console.log("  \u2717 planning sheet —", (e.message || "").slice(0, 120)); } }
// v6.99.61 (A-HD-1/2): one header, one width — the changed modules render the shared header and carry no width cap
{ try { const d6 = JSON.parse(fs.readFileSync(file, "utf8"));
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
    const d5 = JSON.parse(fs.readFileSync(file, "utf8"));
    const base = (d5.orders || []).find((o) => (o.items || []).some((it) => it.sourceType === "PO" && it.sourceRef)) || d5.orders[0];
    const so = { ...base, number: "SO-TEST-PRICE", status: "Confirmed", items: (base.items || []).map((it, i) => i === 0 ? { ...it, unitPrice: "" } : it) };
    _where = "SO form " + so.number;
    const html = renderToStaticMarkup(React.createElement(SOmod.default, { orders: [...d5.orders, so], setOrders: () => {}, contacts: d5.contacts, lots: d5.lots, pos: d5.pos, shipments: d5.shipments, initialSelectedNumber: so.number, initialView: "form" }));
    const held = html.includes("without quantity or sell price"); const fromSrc = /Class<span[^>]*> · from (PO|stock)/.test(html) || html.includes(" · from PO</span>");
    if (held && fromSrc) { passed++; console.log("  \u2713 SO confirm needs price and quantity; sourced lines show 'from PO/stock'"); } else { failed++; console.log("  \u2717 SO confirm needs price — held:" + held + " fromSource:" + fromSrc); }
  } catch (e) { failed++; console.log("  \u2717 SO confirm needs price —", (e.message || "").slice(0, 120)); } }
// v6.99.59 (A-OW/SU/BK/CU): the shipment editor — Close button, Header → Booking → Units, booking on one line, ports still shown
{ try { const ShMod = require(path.resolve("./src/Shipments"));
    const d4 = JSON.parse(fs.readFileSync(file, "utf8"));
    // the booking stage is open only while the shipment is being arranged — pick one that still is (a Delivered one folds it away)
    const arranging = (s) => !["Delivered", "Closed", "Cancelled"].includes(String(s.status || ""));
    const multi = (d4.shipments || []).filter((s) => String(s.mode || "").toLowerCase() === "multimodal" && (s.legs || []).length > 1);
    const sh = multi.find(arranging) || multi[0] || d4.shipments[0];
    _where = "shipment editor " + sh.number;
    const html = renderToStaticMarkup(React.createElement(ShMod.default, { shipments: d4.shipments, setShipments: () => {}, contacts: d4.contacts, lots: d4.lots, orders: d4.orders, pos: d4.pos, initialSelectedNumber: sh.number }));
    const iB = html.indexOf("Booking (sea"), iU = html.indexOf("Loading place");
    const checks = { close: />Close</.test(html), bookingBeforeUnits: iB > 0 && iU > iB, forwarderInBookingLine: html.indexOf(">Forwarder<") > iB, portsShown: html.includes(">POL") && html.includes("Shipping line"), noBareUnitWord: !/>unit<\/div>/.test(html) };
    const bad = Object.entries(checks).filter(([k, v]) => !v).map(([k]) => k);
    if (!bad.length) { passed++; console.log("  \u2713 shipment editor layout: Close · Header → Booking → Units · booking line · ports shown"); } else { failed++; console.log("  \u2717 shipment editor layout — " + bad.join(", ")); }
  } catch (e) { failed++; console.log("  \u2717 shipment editor layout —", (e.message || "").slice(0, 120)); } }
// v6.99.57 (A-PK-1): the packing-list window renders with its "Add additional items" button
{ try { const POmod = require(path.resolve("./src/PurchaseOrders"));
    const d3 = JSON.parse(fs.readFileSync(file, "utf8"));
    const po = (d3.pos || []).find((p) => p.status === "Confirmed");
    const html = renderToStaticMarkup(React.createElement(POmod.default, { pos: d3.pos, setPOs: () => {}, contacts: d3.contacts, lots: d3.lots, setLots: () => {}, orders: d3.orders, setOrders: () => {}, shipments: d3.shipments, setShipments: () => {}, initialSelectedNumber: po.number, initialAction: "packing" }));
    const ok = html.includes("Add additional items") && html.includes("Producer") && html.includes("BOXES LOADED") && !html.includes("Add a size that was loaded");
    if (ok) { passed++; console.log("  \u2713 packing-list window opens with 'Add additional items'"); } else { failed++; console.log("  \u2717 packing-list window did not render as expected"); }
  } catch (e) { failed++; console.log("  \u2717 packing-list window —", (e.message || "").slice(0, 120)); } }

// v6.99.70 (A-BK-1): the backup folder card and the banner in EVERY state; Settings with and without folder support
{ try {
    const BP = require(path.resolve("./src/BackupPanel")); const AB = require(path.resolve("./src/autoBackup"));
    const base = { folderName: "MARIANNA backups", lastWrittenAt: new Date().toISOString(), lastFileName: "marianna-erp_auto_2026-09-27_16-30-05_v6.99.70.json", lastError: "", filesKept: 12, lastDownloadDay: "", snoozedDay: "", busy: false };
    const expect = { unsupported: "Download today&#x27;s backup", notSet: "Choose folder…", active: "Back up to folder now", paused: "Paused", failed: "can&#x27;t be found", starting: "Starting" };
    const bad = [];
    for (const mode of Object.keys(expect)) {
      _where = "backup card · " + mode;
      const html = renderToStaticMarkup(React.createElement(BP.AutoBackupCardView, { status: { ...base, mode, lastError: mode === "failed" ? "The backup folder can't be found — choose it again in Settings." : "" } }));
      if (!html.includes("AUTOMATIC BACKUP FOLDER") || !html.includes(expect[mode])) bad.push("card " + mode);
    }
    // the banner: which state shows what — a failure is never snoozed, a healthy folder shows nothing
    const today = "2026-09-27";
    const cases = [
      [{ mode: "active" }, "none"], [{ mode: "starting" }, "none"], [{ mode: "notSet" }, "notSet"], [{ mode: "notSet", snoozedDay: today }, "none"],
      [{ mode: "paused" }, "paused"], [{ mode: "paused", snoozedDay: today }, "none"], [{ mode: "failed", snoozedDay: today }, "failed"],
      [{ mode: "unsupported" }, "unsupported"], [{ mode: "unsupported", lastDownloadDay: today }, "none"], [{ mode: "unsupported", lastDownloadDay: "2026-09-26" }, "unsupported"],
    ];
    cases.forEach(([p, want]) => { const got = AB.bannerFor({ ...base, ...p }, today); if (got !== want) bad.push(`banner ${JSON.stringify(p)} → ${got}, expected ${want}`); });
    const btn = { notSet: "Choose backup folder", paused: "Resume", failed: "Retry", unsupported: "Download today&#x27;s backup" };
    for (const kind of Object.keys(btn)) {
      _where = "backup banner · " + kind;
      const html = renderToStaticMarkup(React.createElement(BP.BackupBannerView, { kind, status: { ...base, mode: kind, lastError: "disk full" } }));
      if (!html.includes(btn[kind]) || !html.includes(`data-backup-banner="${kind}"`)) bad.push("banner view " + kind);
      if ((kind === "failed") === html.includes(">Later<")) bad.push("banner " + kind + ": Later " + (kind === "failed" ? "offered on a failure" : "missing"));
    }
    if (_rsm(React.createElement(BP.BackupBannerView, { kind: "none", status: base })) !== "") bad.push("banner 'none' is not empty");
    // Settings as jsdom opens it (no folder API) — the card explains the fallback; the old one-time reminder is gone from App
    const SettingsMod = require(path.resolve("./src/Settings")).default;
    _where = "Settings · no folder support";
    const hNo = renderToStaticMarkup(React.createElement(SettingsMod, common));
    if (!hNo.includes("AUTOMATIC BACKUP FOLDER") || !hNo.includes("can&#x27;t write to a folder")) bad.push("Settings without folder support");
    if (fs.readFileSync(path.resolve("./src/App.tsx"), "utf8").includes("backupReminderDismissed")) bad.push("the old reminder is still in App");
    // Settings in a browser WITH the folder API — fresh module instances so the status is read again; one local snapshot seeded
    window.showDirectoryPicker = function () {};
    Object.keys(require.cache).filter(k => /src[\\/](Settings|BackupPanel|autoBackup)\.tsx?$/.test(k)).forEach(k => { delete require.cache[k]; });
    localStorage.setItem("marianna-erp:backups", JSON.stringify([{ id: "1", label: "Auto — before import", createdAt: new Date().toISOString(), version: 2, sizeKB: 1 }]));
    localStorage.setItem("marianna-erp:backup:1", "{}");
    const Settings2 = require(path.resolve("./src/Settings")).default;
    _where = "Settings · with folder support";
    const hYes = renderToStaticMarkup(React.createElement(Settings2, common));
    if (!hYes.includes("Choose folder…") || hYes.includes("can&#x27;t write to a folder")) bad.push("Settings with folder support");
    if (!/title="Delete this backup"[^>]*>Delete</.test(hYes)) bad.push("local snapshot Delete is not the word Delete");
    delete window.showDirectoryPicker; localStorage.removeItem("marianna-erp:backups"); localStorage.removeItem("marianna-erp:backup:1");
    if (!bad.length) { passed++; console.log("  \u2713 backups: the folder card in 6 states, the banner in 10 cases, Settings with and without folder support"); }
    else { failed++; console.log("  \u2717 backups — " + bad.join(" · ")); }
  } catch (e) { failed++; console.log("  \u2717 backups —", (e.message || "").slice(0, 160)); } }

// v6.99.72 (A-CU-3): the customs import — exact / confirm / not placed / done rows; the editor line with an exit; the invoice's CUSTOMS card
{ try {
    const CI = require(path.resolve("./src/customsImport.domain")); const C = require(path.resolve("./src/customsClearance.domain")); const CIM = require(path.resolve("./src/CustomsImportModal"));
    const relX = fs.readFileSync(FX.fixture("CC529C_26PL445010003K5TB3_1.xml"), "utf8"), exitX = fs.readFileSync(FX.fixture("CC599C_26PL445010003K5TB3_1.xml"), "utf8"), sadX = fs.readFileSync(FX.fixture("SAD_25520.xml"), "utf8");
    const bad = [];
    const mk = (over = {}) => ({ id: 7001, number: "SHP-2026-0040", status: "Loaded", tradeDirection: "EXPORT", governingSoRef: "SO-2026-0090", soRefs: ["SO-2026-0090"], clientName: "Al Baraka For Import & Export", goods: [{ id: 1, cnCode: "08081080", qtyKg: 19422 }], documents: [], customsUnits: [],
      legs: [{ id: 1, mode: "Road", plannedPickupDate: "2026-05-04", vehicles: [{ id: 11, truckPlate: "WRA 5749J", trailerPlate: "WRA 5925F", load: [{ goodsLineId: 1, qtyKg: 19422 }] }] }], ...over });
    const invoices = [{ id: 5001, number: "FV2026/05/1", kind: "SALES", paymentStatus: "Issued", currency: "EUR", fxRate: 4.24, netAmount: 17479.8, vatAmount: 0, grossAmount: 17479.8, netPLN: 74114, grossPLN: 74114, vatRate: 0, issueDate: "2026-05-05", dueDate: "2026-06-04", counterparty: { name: "Al Baraka For Import & Export" }, links: [{ type: "SO", number: "SO-2026-0090" }], payments: [] }];
    // 1. the import window: exact (release + exit in one batch), a proposal (plates on two shipments, no invoice), not placed, unknown, done
    const two = [mk(), mk({ id: 7002, number: "SHP-2026-0041", governingSoRef: "SO-2026-0091", soRefs: ["SO-2026-0091"], legs: [{ id: 1, mode: "Road", plannedPickupDate: "2026-05-05", vehicles: [{ id: 21, truckPlate: "WRA5749J", trailerPlate: "WRA5925F" }] }] })];
    const rows = CI.planImport([{ name: "CC529C.xml", text: relX }, { name: "CC599C.xml", text: exitX }, { name: "SAD.xml", text: sadX }, { name: "CC529C_other_invoice.xml", text: relX.replace(/FV2026\/05\/1/g, "FV2026/05/9").replace(/26PL445010003K5TB3/g, "26PL445010003K5TB9") }, { name: "other.xml", text: relX.replace(/WRA5749J\/WRA5925F/g, "ZZ00001/ZZ00002") }, { name: "note.pdf", text: "%PDF" }], two, invoices);
    if (!rows[0].search.exact || !rows[1].search.exact || rows[3].search.exact || rows[3].search.candidates.length < 2) bad.push("planning: expected exact, exact(batch), -, proposal; got " + rows.map(r => (r.search.exact ? "exact" : r.search.candidates.length + " cand")).join(", "));
    rows[2].done = "SHP-2026-0040 · WRA 5749J";
    _where = "customs import";
    const html = renderToStaticMarkup(React.createElement(CIM.CustomsImportView, { rows, setRows: () => {}, onAttach: () => {}, onClose: () => {}, onFiles: () => {}, result: "" }));
    const want = ["Import customs files", "Release for export (CC529C)", "Exit confirmation (CC599C)", "Declaration copy (SAD)", "Not a customs file", ">Confirm<", "leave this file out", "Not placed", "No shipment carries the plates", "✓ Attached to SHP-2026-0040", "left the EU <strong>2026-05-12</strong>", "MRN <strong>26PL445010003K5TB3</strong>", ">Close<"];
    want.forEach(w => { if (!html.includes(w)) bad.push("import window lacks " + JSON.stringify(w)); });
    if (!/<button[^>]*#16A34A[^>]*>Attach \d+ files?<\/button>/.test(html)) bad.push("no green Attach button");
    // 2. the editor: an Exited line shows the exit and offers Detach; the status list has the fifth status
    const ShMod = require(path.resolve("./src/Shipments"));
    let sh = C.applyCustomsFile(mk(), 11, C.parseCustomsFile(relX), "CC529C.xml", () => 90001); sh = C.applyCustomsFile(sh, 11, C.parseCustomsFile(exitX), "CC599C.xml", () => 90002);
    _where = "shipment editor · customs line";
    const eh = renderToStaticMarkup(React.createElement(ShMod.default, { shipments: [sh], setShipments: () => {}, contacts: [], lots: [], orders: [{ number: "SO-2026-0090", client: { name: "Al Baraka For Import & Export" }, sellIncoterm: "CFR" }], pos: [], invoices, initialSelectedNumber: sh.number }));
    [">Exited<", "left the EU 2026-05-12", "IT137103", ">Detach file<", "Import customs files"].forEach(w => { if (!eh.includes(w)) bad.push("editor lacks " + JSON.stringify(w)); });
    if (!/<button[^>]*>Detach file<\/button>/.test(eh) || !/<button[^>]*#DC2626[^>]*>Detach file<\/button>/.test(eh)) bad.push("Detach is not the white/red remove button");
    // 3. the invoice: the CUSTOMS card reads the shipment
    const Inv = require(path.resolve("./src/Invoices")).default;
    _where = "invoice detail · customs";
    const ih = renderToStaticMarkup(React.createElement(Inv, { ...common, invoices, shipments: [sh], initialSelectedNumber: "FV2026/05/1" }));
    ["CUSTOMS", "SHP-2026-0040", "exit confirmed 2026-05-12", "MRN 26PL445010003K5TB3"].forEach(w => { if (!ih.includes(w)) bad.push("invoice detail lacks " + JSON.stringify(w)); });
    const ih2 = renderToStaticMarkup(React.createElement(Inv, { ...common, invoices, shipments: [C.applyCustomsFile(mk(), 11, C.parseCustomsFile(relX), "CC529C.xml", () => 90003)], initialSelectedNumber: "FV2026/05/1" }));
    if (!ih2.includes("exit not confirmed yet")) bad.push("invoice detail: a release without exit must say so");
    if (!bad.length) { passed++; console.log("  \u2713 customs files: the import window in 5 states, the Exited line with Detach, the invoice's CUSTOMS card"); }
    else { failed++; console.log("  \u2717 customs files — " + bad.join(" · ")); }
  } catch (e) { failed++; console.log("  \u2717 customs files —", (e.stack || e.message || "").split("\n").slice(0, 2).join(" ").slice(0, 220)); } }

// v6.99.73–75 (A-TO-7, A-DT-1, A-UN): SHP-2026-0035 from the owner's 28 Sept file — the sea order's cargo, the legs box, the editor
{ try {
    const p35 = FX.fixture("marianna-erp_v6.99.72_schema-v2_2026-09-28T13-44-40.json"); if (!p35) throw new Error("fixture missing");
    const d9 = JSON.parse(fs.readFileSync(p35, "utf8")); const sh = d9.shipments.find(x => x.number === "SHP-2026-0035"); const bad = [];
    const SD = require(path.resolve("./src/ShipmentDocuments")); const txt = h => h.replace(/<\/(td|th)>/g, " | ").replace(/<\/tr>/g, "\n").replace(/<[^>]+>/g, "");
    _where = "SHP-2026-0035 sea order";
    const sea = txt(renderToStaticMarkup(React.createElement(SD.TransportOrderDocument, { shipment: sh, contacts: d9.contacts, providerId: sh.bookings[0].forwarderId, legIds: ["2"], orders: d9.orders, pos: d9.pos, packagingTypes: d9.packagingTypes || [] })));
    const rows = sea.split("\n").filter(l => /^unit \d/.test(l.trim()) || /^Total/.test(l.trim()));
    const cell = (r, p, g) => new RegExp(`≈\\s${p}\\s\\|\\s≈\\s${g.replace(" ", "\\s")}\\s`).test(r.replace(/[\u00a0\u202f]/g, " "));   // pl-PL groups with a no-break space
    if (!(rows.length === 3 && cell(rows[0], "21", "22 039") && cell(rows[1], "21", "22 039") && cell(rows[2], "42", "44 077"))) bad.push("sea cargo: " + rows.join(" // "));
    _where = "SHP-2026-0035 print dialog";
    const box = (pid) => { const h = renderToStaticMarkup(React.createElement(SD.TransportOrderPrintModal, { shipment: sh, contacts: d9.contacts, orders: d9.orders, pos: d9.pos, packagingTypes: d9.packagingTypes || [], onClose: () => {}, onMarkSent: () => {}, onEmail: () => {} }));
      const i = h.indexOf("LEGS ON THIS ORDER"); return txt(h.slice(i, i + 3000)); };
    const b1 = box(); if (!/Leg #1 · Road/.test(b1)) bad.push("legs box lacks leg 1"); if (!/Venice cold store/.test(b1)) bad.push("legs box: leg 1 does not end at the truck's delivery place");
    { // the leg's own start must not decide what the box says: blank it, and the chosen carrier's truck still names its place
      const cp = JSON.parse(JSON.stringify(sh)); cp.legs[0].fromLocationId = null; const pid = require(path.resolve("./src/Shipments")).providerIdsForShipment(cp)[0];
      const h = renderToStaticMarkup(React.createElement(SD.TransportOrderPrintModal, { shipment: cp, contacts: d9.contacts, orders: d9.orders, pos: d9.pos, packagingTypes: d9.packagingTypes || [], onClose: () => {}, onMarkSent: () => {}, onEmail: () => {} }));
      const i = h.indexOf("LEGS ON THIS ORDER"); const t1 = txt(h.slice(i, i + 3000)); const truck = cp.legs[0].vehicles.find(u => String(u.carrierId) === String(pid));
      if (!truck || !t1.includes(String(truck.pickupText).slice(0, 20))) bad.push("legs box does not name the chosen carrier's own loading place (" + (truck ? truck.pickupText : "no truck for " + pid) + ")"); }
    { const DI = require(path.resolve("./src/DateInput")); if (DI.dmyToIso("31/06/2026") !== null || DI.dmyToIso("29/02/2026") !== null || DI.dmyToIso("30/06/2026") !== "2026-06-30" || DI.dmyToIso("29/02/2028") !== "2028-02-29") bad.push("A-DT-1: the date control still accepts a day that does not exist"); }
    _where = "SHP-2026-0035 editor";
    const ShMod = require(path.resolve("./src/Shipments"));
    const eh = renderToStaticMarkup(React.createElement(ShMod.default, { shipments: d9.shipments, setShipments: () => {}, contacts: d9.contacts, lots: d9.lots, orders: d9.orders, pos: d9.pos, invoices: d9.invoices || [], initialSelectedNumber: "SHP-2026-0035" }));
    const et = eh.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#x27;/g, "'");
    [["its goods are PO-2026-0042's", "TR1's swap"], ["its goods are PO-2026-0041's", "TR2's swap"], ["SO-2026-0025 delivers to Damietta Port — this booking discharges at Gdańsk Port", "POD vs SO"], ["the booking discharges at Gdańsk Port", "container 1 vs booking"], ["Use it", "one-click fix"], ["↺ booking", "back to the booking"]].forEach(([w, why]) => { if (!et.includes(w)) bad.push("editor lacks " + why + ": " + JSON.stringify(w)); });
    const rings = (eh.match(/box-shadow:0 0 0 2px #FCA5A5/g) || []).length;
    // opened, the containers took the booking's missing ETD and POD; what stays empty on SHP-0035 is outlined (it has no gaps left but the truck times) — and a unit with gaps is outlined
    const gapSh = JSON.parse(JSON.stringify(sh)); gapSh.legs[0].vehicles[1].plannedDeliveryDate = ""; gapSh.legs[0].vehicles[1].deliveryLocationId = null; gapSh.legs[0].vehicles[1].deliveryText = ""; gapSh.bookings[0].eta = "";
    const gh = renderToStaticMarkup(React.createElement(ShMod.default, { shipments: [gapSh], setShipments: () => {}, contacts: d9.contacts, lots: d9.lots, orders: d9.orders, pos: d9.pos, invoices: [], initialSelectedNumber: "SHP-2026-0035" }));
    const gr = (gh.match(/box-shadow:0 0 0 2px #FCA5A5/g) || []).length; if (gr < rings + 3) bad.push(`red rings: ${rings} on the file, ${gr} with 3 more gaps`);
    if (!bad.length) { passed++; console.log(`  \u2713 SHP-2026-0035: containers 21 + 21 pallets (was 42 + 42); the legs box follows the carrier; the editor names both swapped trucks, the POD against the SO, and rings what is empty (${rings} → ${gr})`); }
    else { failed++; console.log("  \u2717 SHP-2026-0035 — " + bad.join(" · ")); }
  } catch (e) { failed++; console.log("  \u2717 SHP-2026-0035 —", (e.stack || e.message || "").split("\n").slice(0, 2).join(" ").slice(0, 220)); } }

// v6.99.76–79 (A-PV, A-SV, A-POL-1, A-PS-1, A-NAV-1, owner 28 Sept): the order views, the PO line copy, the sheet, the links
{ try {
    const pf = FX.fixture("marianna-erp_v6.99.72_schema-v2_2026-09-28T13-44-40.json"); if (!pf) throw new Error("fixture missing");
    const d9 = JSON.parse(fs.readFileSync(pf, "utf8")); const bad = []; const T = h => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
    const c9 = { ...common, contacts: d9.contacts, pos: d9.pos, orders: d9.orders, lots: d9.lots, shipments: d9.shipments, invoices: d9.invoices || [] };
    const POm = require(path.resolve("./src/PurchaseOrders")); const SOm = require(path.resolve("./src/SalesOrders")); const UI = require(path.resolve("./src/ui"));
    // A-PV: PO-2026-0041's view
    _where = "PO view PO-2026-0041";
    const pv = renderToStaticMarkup(React.createElement(POm.default, { ...c9, initialSelectedNumber: "PO-2026-0041" })); const pt = T(pv);
    ["ORDER DETAILS", "LOADING DATE", "EXPECTED DELIVERY DATE"].forEach(w => { if (!pt.includes(w)) bad.push("PO view lacks " + w); });
    if (/>TERMS</.test(pv)) bad.push("PO view still titled TERMS");
    if (!/PAYMENT 30 /.test(pt)) bad.push("PO view payment: " + (pt.match(/PAYMENT .{0,40}/) || [""])[0]);
    if (/<a [^>]*data-doclink/.test(pv)) bad.push("outside App the numbers must stay plain text");
    // A-NAV-1: the same view inside the route: its linked numbers are links, and a click never reaches the row
    _where = "PO view with the document route";
    const opened = []; const nav = { open: (n, from) => opened.push(n + "<" + from), canOpen: n => /^(SO|SHP|LOT|PO)-/.test(n) };
    const pvn = renderToStaticMarkup(React.createElement(UI.DocNavContext.Provider, { value: nav }, React.createElement(POm.default, { ...c9, initialSelectedNumber: "PO-2026-0041" })));
    const links = (pvn.match(/<a [^>]*data-doclink="1"[^>]*title="Open ([^"]+)"/g) || []).map(x => x.match(/Open ([^"]+)/)[1]);
    if (!links.some(n => /^SO-/.test(n)) || !links.some(n => /^LOT-/.test(n))) bad.push("PO view links: " + links.join(","));
    // A-SV: SO-2026-0025's view
    _where = "SO view SO-2026-0025";
    const sv = renderToStaticMarkup(React.createElement(SOm.default, { ...c9, initialSelectedNumber: "SO-2026-0025" })); const st = T(sv);
    const heads = (sv.match(/LINE ITEMS[\s\S]*?<\/thead>/) || [""])[0].match(/<th[^>]*>([^<]*)<\/th>/g) || [];
    const hs = heads.map(h => h.replace(/<[^>]+>/g, "")).join("|"); if (hs !== "SOURCE|PRODUCT|ORIGIN|KL.|PACKAGING|BOXES|QTY KG|UNIT PRICE|TOTAL") bad.push("SO columns: " + hs);
    if (!/<td colspan="5"[^>]*>Total<\/td>/i.test(sv)) bad.push("SO total row is not the PO's");
    const cl = (st.match(/CLIENT .{0,260}/) || [""])[0]; ["NIP / VAT", "Contact", "Email"].forEach(w => { if (!cl.includes(w)) bad.push("client box lacks " + w); });
    const od = (st.match(/ORDER DETAILS (.{0,420})/) || ["", ""])[1];
    const order = ["ORDER DATE", "EXPECTED LOADING DATE", "EXPECTED DELIVERY DATE", "SALES INCOTERM", "DESTINATION", "PAYMENT", "IMPORT PERMIT NO.", "ACID NO."]; let at = -1;
    order.forEach(w => { const k = od.indexOf(w, at + 1); if (k < 0) bad.push("order details lacks " + w + " (in order)"); else at = k; });
    if (/CURRENCY/.test(od)) bad.push("order details still shows currency"); if (!/PAYMENT 30 /.test(od)) bad.push("SO payment: " + (od.match(/PAYMENT .{0,30}/) || [""])[0]);
    // A-POL-1: the PO form — copy before delete on the second row, the row still one row; consignment reads "Consignment"
    _where = "PO form lines";
    const po41 = d9.pos.find(p => p.number === "PO-2026-0041");
    for (const mode of ["firm", "consignment"]) {
      const draft = { ...po41, id: undefined, number: "PO-TEST-" + mode, status: "Draft", pricingMode: mode };
      const { OrderForm } = require(path.resolve("./src/PurchaseOrderForm"));
      const fh = renderToStaticMarkup(React.createElement(OrderForm, { order: draft, setOrder: () => {}, contacts: d9.contacts, allSOs: d9.orders, allShipments: d9.shipments, lots: d9.lots, onSave: () => {}, onCancel: () => {} }));
      const rows2 = fh.match(/grid-template-columns:0\.85fr 1\.4fr 0\.8fr 0\.7fr 0\.85fr minmax\(112px, 1\.1fr\) 38px 38px[\s\S]*?🗑<\/button>/g) || [];
      if (!rows2.length) { bad.push(mode + ": the second row is not the 8-cell row (form not reached?)"); continue; }
      rows2.forEach(r => { const ic = r.indexOf(">⧉</button>"), id = r.indexOf("🗑</button>"); if (ic < 0 || ic > id) bad.push(mode + ": copy is not before delete on the second row"); });
      if (mode === "consignment" && !rows2.every(r => />Consignment<\/div>/.test(r))) bad.push("consignment: the line total does not read Consignment");
      if (mode === "firm" && rows2.some(r => />Consignment<\/div>/.test(r))) bad.push("firm: Consignment shown on a priced line");
    }
    // A-PS-1: no Copy tab
    _where = "planning sheet";
    const PS = require(path.resolve("./src/PlanningSheet")).default; const ph = renderToStaticMarkup(React.createElement(PS, { tabs: [{ id: "t1", name: "week 40", rows: [] }], setTabs: () => {}, log: [], setLog: () => {}, contacts: [], catalog: [] }));
    if (/Copy tab/.test(ph)) bad.push("the planning sheet still offers Copy tab");
    if (!bad.length) { passed++; console.log(`  \u2713 order views (Order details, payment 30 days, the SO's 9 columns + the PO's total row, client box), PO line copy before delete (firm + consignment), no Copy tab, ${links.length} document links in the PO view`); }
    else { failed++; console.log("  \u2717 views / copy / links — " + bad.join(" · ")); }
  } catch (e) { failed++; console.log("  \u2717 views / copy / links —", (e.stack || e.message || "").split("\n").slice(0, 2).join(" ").slice(0, 220)); } }

// v6.99.81 (A-IN, owner 29 Sept): the inventory list and the lot view on her 28 Sept file
{ try {
    const pf = FX.fixture("marianna-erp_v6.99.72_schema-v2_2026-09-28T13-44-40.json"); if (!pf) throw new Error("fixture missing");
    const d9 = JSON.parse(fs.readFileSync(pf, "utf8")); const bad = []; const T = h => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ");
    const c9 = { ...common, contacts: d9.contacts, pos: d9.pos, orders: d9.orders, lots: d9.lots, shipments: d9.shipments, invoices: d9.invoices || [] };
    const Inv = require(path.resolve("./src/Inventory")).default;
    _where = "inventory list";
    const lh = renderToStaticMarkup(React.createElement(Inv, { ...c9 })); const lt = T(lh);
    ["ARRIVED · AGE", "d on stock", "expected 23/07/2026", "Direct · producer → client", ">Delivered<", ">In stock<", ">Expected<", ">Shipped<"].forEach(w => { if (!(w.startsWith(">") ? lh.includes(w) : lt.includes(w))) bad.push("list lacks " + JSON.stringify(w)); });
    const badgeWords = (lh.match(/border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap">([^<]*)</g) || []).map(x => x.replace(/.*">/, "").replace("<", ""));
    if (badgeWords.some(w => /\(direct\)|Shipped Out|Direct Expected/.test(w))) bad.push("a stored status word leaked onto a badge: " + badgeWords.filter(w => /\(|Out|Direct/.test(w)).join(","));
    if (!/color:#16A34A;font-weight:700">[\d\s]+ free</.test(lh) || !/color:#D97706;font-weight:700">[\d\s]+ reserved</.test(lh)) bad.push("free/reserved colours");
    const zeros = (lh.match(/font-weight:600;color:#111">0,00<\/div><div style="font-size:10px;color:#64748B"><span[^>]*>(in stock|delivered|expected|shipped)</g) || []).length; if (zeros > 0) bad.push(`${zeros} live lots still show a 0,00 value`);
    if (!/title="Loaded on SHP-2026-0021 and again on SHP-2026-0016/.test(lh)) bad.push("the +100 % badge does not name its two shipments");
    if (/arrived 02\.03\.2026 · 2\d\d d/.test(lt)) bad.push("a direct lot still counts days on stock");
    _where = "lot view LOT-2026-0026 (direct, delivered)";
    const v26 = renderToStaticMarkup(React.createElement(Inv, { ...c9, initialSelectedNumber: "LOT-2026-0026" })); const t26 = T(v26);
    if (!/Value delivered/.test(t26)) bad.push("lot view value label"); if (/received [\d\s]+ kg\b/.test((t26.match(/Value delivered.{0,120}/) || [""])[0])) bad.push("received-kg line still under the value");
    if (/COST BREAKDOWN/.test(t26)) bad.push("cost breakdown box still there"); if (/CURRENT LOCATION|ETA destination/.test(t26)) bad.push("location / dates still in Linked documents");
    if (/background:#0F172A;color:#fff/.test(v26)) bad.push("workbench header still dark"); if (!/LOT WORKBENCH.{0,200}PO-2026-00/.test(t26)) bad.push("workbench header does not lead with the PO");
    if (/STOCK — AVAILABLE NOW/.test(t26)) bad.push("stock tile shown on a direct lot");
    const nav = { open: () => {}, canOpen: n => /^(SO|SHP|LOT|PO)-/.test(n) }; const UI = require(path.resolve("./src/ui"));
    const v26n = renderToStaticMarkup(React.createElement(UI.DocNavContext.Provider, { value: nav }, React.createElement(Inv, { ...c9, initialSelectedNumber: "LOT-2026-0026" })));
    const links = (v26n.match(/data-doclink="1"[^>]*title="Open ([^"]+)"/g) || []).map(x => x.match(/Open ([^"]+)/)[1]); if (!links.some(n => /^PO-/.test(n))) bad.push("lot view links: " + links.join(","));
    _where = "lot view LOT-2026-0009 (in stock)";
    const v9 = T(renderToStaticMarkup(React.createElement(Inv, { ...c9, initialSelectedNumber: "LOT-2026-0009" })));
    if (!/Value in stock/.test(v9)) bad.push("stock lot value label"); if (!/STOCK — AVAILABLE NOW/.test(v9)) bad.push("stock tile missing on a stock lot");
    if (!bad.length) { passed++; console.log("  \u2713 inventory: list (status words, arrived/age, direct flow, colours, value by state, the +100 % explained), lot view (value label, no cost box, light workbench led by the PO, links)"); }
    else { failed++; console.log("  \u2717 inventory — " + bad.join(" · ")); }
  } catch (e) { failed++; console.log("  \u2717 inventory —", (e.stack || e.message || "").split("\n").slice(0, 2).join(" ").slice(0, 220)); } }

// v6.99.84 (A-ST, A-PO-C1, owner 30 Sept) — pl-PL groups thousands only from 5 digits (2564,14 but 39 448,28): PO-2026-0043's settlement box, its two reports, and the PO list markers
{ try {
    const pf = FX.fixture("marianna-erp_v6.99.82_schema-v2_2026-09-30T13-13-23.json"); if (!pf) throw new Error("fixture missing");
    const d9 = JSON.parse(fs.readFileSync(pf, "utf8")); const bad = []; const T = h => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ");
    const c9 = { ...common, contacts: d9.contacts, pos: d9.pos, orders: d9.orders, lots: d9.lots, shipments: d9.shipments, invoices: d9.invoices || [], poSettlements: d9.poSettlements, settlements: d9.poSettlements, inspections: d9.inspections || [] };
    const POm = require(path.resolve("./src/PurchaseOrders"));
    _where = "PO-2026-0043 settlement";
    const po = d9.pos.find(p => p.number === "PO-2026-0043");
    const box = renderToStaticMarkup(React.createElement(POm.TruckSettlementCard, { order: po, lots: d9.lots, orders: d9.orders, invoices: d9.invoices || [], shipments: d9.shipments, claims: d9.claims || [], inspections: d9.inspections || [], contacts: d9.contacts, settlements: d9.poSettlements, setSettlements: () => {} }));
    const bt = T(box);
    ["IN PLN", "Sales (excl. VAT) 171 600,00 PLN", "IN EUR · rate 4.35", "Sales after costs 39 448,28 EUR", "Our commission 6.5% 2564,14 EUR", "1 · Vega-Pro Kft. issues an EXTRA INVOICE 2448,28 EUR", "2 · we issue our COMMISSION INVOICE 2564,14 EUR", "3 · after compensation Vega-Pro Kft. owes us 115,86 EUR", "14 300 expected"].forEach(w => { if (!bt.includes(w)) bad.push("box lacks " + JSON.stringify(w)); });
    if (/Transfer after compensation|Gross sales|Net sales /.test(bt)) bad.push("an old label survived");
    if (/ARRIVED<\/div>|SORTED INTO/.test(box)) bad.push("the label line is still there (A-PV-3)"); if (/−0,00|\+0,00/.test(bt)) bad.push("signed zero lines still shown (A-ST-8)");
    if (!/<option[^>]*>USD<\/option>/.test(box)) bad.push("provisional currency choice missing");
    const srep = (box.match(/id="sales-report-doc-[^"]+"[\s\S]*?(?=<div id="qc-report-)/) || [""])[0]; const st = T(srep);
    ["Sales report", "Raport sprzedaży", "Producer", "Vega-Pro Kft.", "PO-2026-0043", "3 · After compensation — Vega-Pro Kft. owes us 115,86 EUR"].forEach(w => { if (!st.includes(w)) bad.push("sales report lacks " + JSON.stringify(w)); });
    if (!/<img[^>]*src="data:image/.test(srep)) bad.push("sales report without the company logo");
    const qrep = (box.match(/id="qc-report-[^"]+"[\s\S]*$/) || [""])[0];
    if (/id="insp-print-[^"]+" style="position:absolute;left:-10000px/.test(qrep)) bad.push("quality report still parked off the page inside the print copy");
    if (!/id="insp-print-/.test(qrep)) bad.push("no quality report for LOT-2026-0126");
    _where = "PO list";
    const lh = renderToStaticMarkup(React.createElement(POm.default, { ...c9 })); const lt = T(lh);
    if (!/>Consignment( \(\d+\))?<\/button>/.test(lh)) bad.push("no Consignment filter"); const iC = lh.search(/>Consignment( \(\d+\))?<\/button>/), iE = lh.indexOf("Estimated only"); if (iE >= 0 && iC > iE) bad.push("Consignment filter is not before Estimated only");
    if (!/PO-2026-0043<\/div>\s*<div style="display:flex;gap:4px;margin-top:2px"><span[^>]*>consignment<\/span>/.test(lh)) bad.push("PO-2026-0043 lacks its consignment line under the number");
    if (!bad.length) { passed++; console.log("  \u2713 PO-2026-0043 settlement: PLN → EUR → the three steps (extra invoice 2 448,28 · commission 2 564,14 · Vega-Pro owes us 115,86), labels over their columns, 14 300 expected; sales report on the template with the logo; quality report in the page; PO list consignment line + filter"); }
    else { failed++; console.log("  \u2717 settlement / reports / PO list — " + bad.join(" · ")); }
  } catch (e) { failed++; console.log("  \u2717 settlement / reports / PO list —", (e.stack || e.message || "").split("\n").slice(0, 2).join(" ").slice(0, 220)); } }

// v6.99.85 (A-CS-1..5): the provisional from the register, the consignment lot's value, the Finance positions
{ try {
    const pf = FX.fixture("marianna-erp_v6.99.82_schema-v2_2026-09-30T13-13-23.json"); if (!pf) throw new Error("fixture missing");
    const d9 = JSON.parse(fs.readFileSync(pf, "utf8")); const bad = []; const T = h => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ");
    const po = d9.pos.find(p => p.number === "PO-2026-0043");
    const provInv = { id: 7001, kind: "COST", number: "EUR258/2026", currency: "EUR", fxRate: 4.30, netAmount: 37000, grossAmount: 37000, paymentStatus: "Issued", counterparty: { id: po.supplier.id, name: po.supplier.name }, links: [{ type: "PO", number: "PO-2026-0043" }], payments: [], issueDate: "2026-06-05", dueDate: "2026-07-05" };
    const POm = require(path.resolve("./src/PurchaseOrders"));
    _where = "settlement box — provisional from the register";
    const rec = { ...d9.poSettlements[0], provisionalInvoiceId: 7001, provisionalCurrency: "EUR", provisionalRate: 4.30 };
    const box = renderToStaticMarkup(React.createElement(POm.TruckSettlementCard, { order: po, lots: d9.lots, orders: d9.orders, invoices: [provInv], shipments: d9.shipments, claims: [], inspections: d9.inspections || [], contacts: d9.contacts, settlements: [rec], setSettlements: () => {}, financeNotes: [] }));
    const bt = T(box);
    if (!/<option value="7001"[^>]*>EUR258\/2026 · 37[\s\u00a0\u202f]000,00 EUR net · Issued<\/option>/.test(box)) bad.push("the producer's invoice is not offered from the register");
    if (!/provisional paid 0,00 EUR · still to transfer to Vega-Pro Kft. 36 884,14 EUR/.test(bt)) bad.push("still to transfer not shown: " + (bt.match(/provisional paid.{0,80}/) || [""])[0]);
    if (/assumed paid|register it as a cost invoice/.test(bt)) bad.push("the 'not in the register' hint shows although the invoice is picked");
    _where = "inventory — consignment lot";
    const Inv = require(path.resolve("./src/Inventory")).default;
    const c9 = { ...common, contacts: d9.contacts, pos: d9.pos, orders: d9.orders, lots: d9.lots, shipments: d9.shipments, invoices: [], poSettlements: d9.poSettlements };
    const lh = T(renderToStaticMarkup(React.createElement(Inv, { ...c9 })));
    const i126 = lh.indexOf("LOT-2026-0126"); const row = lh.slice(i126, i126 + 420);
    if (!/provisional · ≈ 11,26 PLN\/kg/.test(row)) bad.push("list: no provisional value on LOT-0126: " + row.slice(0, 200));
    const vh = T(renderToStaticMarkup(React.createElement(Inv, { ...c9, initialSelectedNumber: "LOT-2026-0126" })));
    if (!/Consignment — priced at settlement/.test(vh) || !/provisional · ≈ 11,26 PLN\/kg/.test(vh)) bad.push("lot view: consignment value block");
    const lh0 = T(renderToStaticMarkup(React.createElement(Inv, { ...c9, poSettlements: [] }))); const r0 = lh0.slice(lh0.indexOf("LOT-2026-0126"), lh0.indexOf("LOT-2026-0126") + 400);
    if (!/consignment priced at settlement/.test(r0)) bad.push("list without a provisional: no 'priced at settlement'");
    _where = "finance — consignment positions";
    const Fin = require(path.resolve("./src/Finance")).default;
    const fh = renderToStaticMarkup(React.createElement(Fin, { ...c9, financeNotes: [], claims: [], userName: "Hazem Osman", users: [] })); const ft = T(fh);
    if (!/CONSIGNMENT POSITIONS/.test(ft)) bad.push("no consignment positions card");
    const fi = ft.indexOf("PO-2026-0043"); const frow = ft.slice(fi, fi + 500);
    ["Vega-Pro Kft.", "14 300", "171 600,00 PLN", "36 884,14 EUR", "37 000,00 EUR", "not in the register", "Vega-Pro Kft. owes us 115,86 EUR", "OPEN"].forEach(w => { if (!frow.includes(w)) bad.push("positions row lacks " + JSON.stringify(w)); });
    if (!bad.length) { passed++; console.log("  \u2713 consignment: the provisional picked from the register (still to transfer 36 884,14), LOT-0126 ≈ 11,26 PLN/kg provisional / priced at settlement, the Finance positions row"); }
    else { failed++; console.log("  \u2717 consignment — " + bad.join(" · ")); }
  } catch (e) { failed++; console.log("  \u2717 consignment —", (e.stack || e.message || "").split("\n").slice(0, 2).join(" ").slice(0, 220)); } }

// v6.99.86 (owner 1 Oct): the list and the detail show the trucks' dates; the governing order on a PO's truck; the receive window
{ try {
    const pf = FX.fixture("marianna-erp_v6.99.85_schema-v2_2026-10-01T12-50-07.json"); if (!pf) throw new Error("fixture missing");
    const d9 = JSON.parse(fs.readFileSync(pf, "utf8")); const bad = []; const T = h => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ");
    const c9 = { ...common, contacts: d9.contacts, pos: d9.pos, orders: d9.orders, lots: d9.lots, shipments: d9.shipments, invoices: d9.invoices || [] };
    const ShMod = require(path.resolve("./src/Shipments"));
    _where = "shipments list — SHP-2026-0037";
    const lh = renderToStaticMarkup(React.createElement(ShMod.default, { ...c9, setShipments: () => {} }));
    const li = lh.indexOf("SHP-2026-0037"); const row = lh.slice(li, li + 1600);
    if (!/title="actual dates from the trucks[^"]*">2026-06-02 → 2026-06-15</.test(row)) bad.push("list row does not show the truck's actual dates: " + (T(row).slice(0, 160)));
    _where = "shipment editor — SHP-2026-0037 governing order";
    const eh = renderToStaticMarkup(React.createElement(ShMod.default, { ...c9, setShipments: () => {}, initialSelectedNumber: "SHP-2026-0037" })); const et = T(eh);
    if (!/Governing order/.test(et)) bad.push("no governing-order field on the PO's truck"); if (!/PO-2026-0044 · purchase · DDP/.test(et)) bad.push("the purchase is not named"); if (!/— no sale: to our warehouse —/.test(et)) bad.push("the sale cannot be chosen");
    _where = "shipment detail — SHP-2026-0037 dates";
    const Det = require(path.resolve("./src/ShipmentDetail")).ShipmentDetail; const sh = d9.shipments.find(s => s.number === "SHP-2026-0037");
    const dh = T(renderToStaticMarkup(React.createElement(Det, { shipment: sh, contacts: d9.contacts, lots: d9.lots, orders: d9.orders, pos: d9.pos, invoices: [], shipments: d9.shipments, onBack: () => {}, onEdit: () => {} })));
    if (!/2026-06-02 loaded/.test(dh) || !/2026-06-15 unloaded/.test(dh)) bad.push("detail leg row lacks the actual dates: " + (dh.match(/LOADING .{0,60}/) || [""])[0]);
    _where = "receive window";
    const W = require(path.resolve("./src/InventoryWindows")); const M = require(path.resolve("./src/shipmentModel.domain")); const lot = d9.lots.find(l => l.number === "LOT-2026-0127"); const po = d9.pos.find(p => p.number === "PO-2026-0044");
    const wh = renderToStaticMarkup(React.createElement(W.ReceiveLotModal, { lot, suggested: M.suggestedReceiptDate(lot, d9.shipments, po, "2026-10-01"), locationName: "Our warehouse", onCancel: () => {}, onConfirm: () => {} })); const wt = T(wh);
    if (!/value="2026-06-15"/.test(wh)) bad.push("the window does not propose the truck's date"); if (!/from SHP-2026-0037 unloaded/.test(wt)) bad.push("the window does not say where the date comes from"); if (!/expected 11 000 kg/.test(wt)) bad.push("expected kilos"); if (!/Our warehouse/.test(wt)) bad.push("the place");
    if (!bad.length) { passed++; console.log("  \u2713 trucks' dates on the list (2026-06-02 → 2026-06-15, actual) and the detail (loaded / unloaded); governing order on the PO's truck; the receive window dated 15 June from SHP-2026-0037"); }
    else { failed++; console.log("  \u2717 dates / governing order / receive — " + bad.join(" · ")); }
  } catch (e) { failed++; console.log("  \u2717 dates / governing order / receive —", (e.stack || e.message || "").split("\n").slice(0, 2).join(" ").slice(0, 220)); } }

// v6.99.87 (A-QC-2, A-SH-G2, A-SD-1..3, A-PT-1..3, owner 1 Oct): layouts and the removed sections
{ try {
    const pf = FX.fixture("marianna-erp_v6.99.86_schema-v2_2026-10-01T14-46-09.json"); if (!pf) throw new Error("fixture missing");
    const d9 = JSON.parse(fs.readFileSync(pf, "utf8")); const bad = []; const T = h => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ");
    const c9 = { ...common, contacts: d9.contacts, pos: d9.pos, orders: d9.orders, lots: d9.lots, shipments: d9.shipments, invoices: d9.invoices || [], inspections: d9.inspections || [] };
    _where = "lot view LOT-2026-0127 layout";
    const Inv = require(path.resolve("./src/Inventory")).default;
    const lt = T(renderToStaticMarkup(React.createElement(Inv, { ...c9, initialSelectedNumber: "LOT-2026-0127" })));
    const at = w => lt.indexOf(w); const iL = at("LINKED DOCUMENTS"), iI = at("+ Record inspection") >= 0 ? at("+ Record inspection") : at("INSPECTIONS"), iM = at("MOVEMENT HISTORY"), iW = at("LOT WORKBENCH");
    if (!(iW >= 0 && iL > iW && iM > iL)) bad.push(`lot view order: workbench ${iW}, linked ${iL}, movements ${iM}`);
    _where = "shipment detail SHP-2026-0035";
    const Det = require(path.resolve("./src/ShipmentDetail")).ShipmentDetail; const sh = d9.shipments.find(s => s.number === "SHP-2026-0035");
    const dt = T(renderToStaticMarkup(React.createElement(Det, { shipment: sh, contacts: d9.contacts, lots: d9.lots, orders: d9.orders, pos: d9.pos, onStuffing: () => {}, onDevanning: () => {}, onEdit: () => {} })));
    const g = dt.indexOf("Goods"), to = dt.indexOf("Transport orders") >= 0 ? dt.indexOf("Transport orders") : dt.indexOf("TRANSPORT ORDERS"), fw = dt.indexOf("Containers — forwarder's reports"), dc = dt.indexOf("Documents");
    if (!(g > 0 && fw > g)) bad.push(`goods not before the forwarder box (goods ${g}, forwarder ${fw})`); if (fw < 0) bad.push("forwarder box not retitled");
    if (/Document register/.test(dt)) bad.push("the document register box is still separate"); if (!(dc > 0 && /Documents.{0,40}Transport order/.test(dt.slice(dc)))) bad.push("Documents does not start with the transport order line");
    if (!/port of loading: which trucks went into which container/i.test(dt)) bad.push("forwarder box lacks its explanation");
    _where = "shipment editor SHP-2026-0037 governing order";
    const ShMod = require(path.resolve("./src/Shipments")); const eh = renderToStaticMarkup(React.createElement(ShMod.default, { ...c9, setShipments: () => {}, initialSelectedNumber: "SHP-2026-0037" }));
    if (!/<div style="grid-column:1 \/ -1">.{0,200}Governing order/.test(eh.replace(/\n/g, " "))) bad.push("the governing-order block is not on a line of its own");
    _where = "parties";
    const Con = require(path.resolve("./src/Contacts")).default; const wh = d9.contacts.find(c => /Warehouse/i.test(String(c.type || ""))) || d9.contacts[0];
    const ph = T(renderToStaticMarkup(React.createElement(Con, { ...c9, initialSelectedId: wh.id, initialViewMode: "people" })));
    if (/WAREHOUSE AGREEMENT|Charged through our forwarder/.test(ph)) bad.push("the agreement section or the forwarder box is still there");
    if (!bad.length) { passed++; console.log("  \u2713 lot view (Linked documents → Inspections → Movement history → Notes on the right), shipment view (Goods under the transport, one Documents box, the forwarder box explained), governing order on its own line, Parties without the agreement and the forwarder box"); }
    else { failed++; console.log("  \u2717 layouts — " + bad.join(" · ")); }
  } catch (e) { failed++; console.log("  \u2717 layouts —", (e.stack || e.message || "").split("\n").slice(0, 2).join(" ").slice(0, 220)); } }

// v6.99.88–91 (A-DEL-1, A-NM-1, A-SD-4, A-SD-5): Delete / Withdraw on the PO and SO views; the shipment view pairs; carriers on the leg row
{ try {
    const pf = FX.fixture("marianna-erp_v6.99.87_schema-v2_2026-10-01T16-29-32.json"); if (!pf) throw new Error("fixture missing");
    const d9 = JSON.parse(fs.readFileSync(pf, "utf8")); const bad = []; const T = h => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ");
    const c9 = { ...common, contacts: d9.contacts, pos: d9.pos, orders: d9.orders, lots: d9.lots, shipments: d9.shipments, invoices: d9.invoices || [] };
    const POm = require(path.resolve("./src/PurchaseOrders")); const SOm = require(path.resolve("./src/SalesOrders"));
    _where = "PO view PO-2026-0044"; const pv = renderToStaticMarkup(React.createElement(POm.default, { ...c9, initialSelectedNumber: "PO-2026-0044" }));
    if (!/<button[^>]*background:#DC2626[^>]*>Delete<\/button>/.test(pv)) bad.push("PO view: no solid red Delete"); if (/>Withdraw<\/button>/.test(pv)) bad.push("PO view: Withdraw still there (A-DEL-4)");
    _where = "SO view SO-2026-0027"; const sv = renderToStaticMarkup(React.createElement(SOm.default, { ...c9, initialSelectedNumber: "SO-2026-0027" }));
    if (!/>Delete<\/button>/.test(sv) || />Withdraw<\/button>/.test(sv)) bad.push("SO view: Delete missing or Withdraw still there");
    const cancelledPO = d9.pos.find(p => p.status === "Cancelled"); if (cancelledPO) { const cv = T(renderToStaticMarkup(React.createElement(POm.default, { ...c9, initialSelectedNumber: cancelledPO.number }))); if (!/Deleted — read-only/.test(cv)) bad.push("a deleted PO does not say so"); if (/\bCancelled\b/.test(cv.replace(/Cancelled at/g, ""))) bad.push("the word Cancelled still shows on a deleted PO"); }
    _where = "shipment view SHP-2026-0035"; const Det = require(path.resolve("./src/ShipmentDetail")).ShipmentDetail; const M = require(path.resolve("./src/shipmentModel.domain"));
    const sh35 = d9.shipments.find(s => s.number === "SHP-2026-0035"); const dh = renderToStaticMarkup(React.createElement(Det, { shipment: sh35, contacts: d9.contacts, lots: d9.lots, orders: d9.orders, pos: d9.pos, onEdit: () => {} })); const dt = T(dh);
    if (!/AGRO-HURT[^|]{0,40}\+ Mikolaj Majewski|Mikolaj Majewski[^|]{0,40}\+ AGRO-HURT/.test(dt)) bad.push("road leg: the trucks' carriers not named: " + (dt.match(/Route \/ legs.{0,160}/) || [""])[0]); if (!/DCS TRAMACO/.test(dt)) bad.push("sea leg: the booking's forwarder not named");
    const iCh = dt.indexOf("Operational checklist"), iDoc = dt.indexOf("Documents", iCh), iCost = dt.indexOf("Costs / billing"); if (!(iCh > 0 && iDoc > iCh && iCost > iDoc)) bad.push(`pairs order: checklist ${iCh}, documents ${iDoc}, costs ${iCost}`);
    const sh31 = M.healShipmentModel(d9.shipments.find(s => s.number === "SHP-2026-0031")).sh; const d31 = T(renderToStaticMarkup(React.createElement(Det, { shipment: sh31, contacts: d9.contacts, lots: d9.lots, orders: d9.orders, pos: d9.pos, onEdit: () => {} })));
    if (!/TBX/.test(d31) || !/DCS TRAMACO/.test(d31)) bad.push("SHP-0031 after the heal: carrier / forwarder not shown");
    if (!bad.length) { passed++; console.log("  \u2713 PO / SO views: solid red Delete + Withdraw; withdrawn reads Withdrawn; shipment view: checklist | documents, costs | notes; the leg row names the trucks' carriers and the booking's forwarder (SHP-0035, SHP-0031 after the heal)"); }
    else { failed++; console.log("  \u2717 delete / withdraw / pairs / carriers — " + bad.join(" · ")); }
  } catch (e) { failed++; console.log("  \u2717 delete / withdraw / pairs / carriers —", (e.stack || e.message || "").split("\n").slice(0, 2).join(" ").slice(0, 220)); } }

// v6.99.92–96 (A-DEL-2, A-GR-2..4): Close drawn; the groupage picker; SHP-2026-0039's tour in the editor and on its transport order
{ try {
    const pf = FX.fixture("marianna-erp_v6.99.87_schema-v2_2026-10-01T16-29-32.json"); if (!pf) throw new Error("fixture missing");
    const d9 = JSON.parse(fs.readFileSync(pf, "utf8")); const bad = []; const T = h => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ");
    const c9 = { ...common, contacts: d9.contacts, pos: d9.pos, orders: d9.orders, lots: d9.lots, shipments: d9.shipments, invoices: d9.invoices || [] };
    _where = "a window header Close"; const SC = require(path.resolve("./src/ShipmentCreate")); const Cr = SC.CreateShipmentModal || SC.default;
    const ch = renderToStaticMarkup(React.createElement(Cr, { pos: d9.pos, orders: d9.orders, lots: d9.lots, contacts: d9.contacts, shipments: d9.shipments, onCancel: () => {}, onCreate: () => {} }));
    if (!/>Close<\/button>/.test(ch)) bad.push("the create window's header Close is not drawn");
    _where = "SHP-2026-0039 editor tour"; const ShMod = require(path.resolve("./src/Shipments"));
    const et = T(renderToStaticMarkup(React.createElement(ShMod.default, { ...c9, setShipments: () => {}, initialSelectedNumber: "SHP-2026-0039" })));
    ["TOUR · 1 LOADING · 3 UNLOADING", "Load 1 · AGRO-HURT", "14 265 kg", "Unload 1 ·", "SO-2026-0027", "Unload 3 · MJ VEG Bronisze · SO-2026-0029"].forEach(w => { if (!et.includes(w)) bad.push("editor tour lacks " + JSON.stringify(w)); });
    if (/its goods are PO-2026-0044's/.test(et)) bad.push("the truck is still told to load at the producer");
    _where = "SHP-2026-0039 transport order"; const SD = require(path.resolve("./src/ShipmentDocuments")); const sh0 = d9.shipments.find(s => s.number === "SHP-2026-0039");
    // the truck has no carrier yet in the owner's file — an order is printed for a carrier, so one is given here
    const carrier = d9.contacts.find(c => /Carrier/i.test(String(c.type || ""))) || d9.contacts[0]; const sh = { ...sh0, legs: sh0.legs.map((l, i) => i ? l : { ...l, vehicles: l.vehicles.map(u => ({ ...u, carrierId: carrier.id })) }) };
    const th = T(renderToStaticMarkup(React.createElement(SD.TransportOrderDocument, { shipment: sh, contacts: d9.contacts, providerId: carrier.id, legIds: ["1"], orders: d9.orders, pos: d9.pos, lots: d9.lots, packagingTypes: d9.packagingTypes || [] })));
    ["Route stops / Punkty trasy", "Loading / Zaladunek", "14 265 kg", "Unloading / Rozladunek", "1650 kg · SO-2026-0027", "11 630 kg · SO-2026-0028", "985 kg · SO-2026-0029"].forEach(w => { if (!th.includes(w)) bad.push("transport order lacks " + JSON.stringify(w)); });
    if (!bad.length) { passed++; console.log("  \u2713 window header Close drawn; SHP-2026-0039: the tour in the editor (load at AGRO-HURT 14 265 kg, 3 drops) and on its transport order with the cargo per drop"); }
    else { failed++; console.log("  \u2717 close / groupage — " + bad.join(" · ")); }
  } catch (e) { failed++; console.log("  \u2717 close / groupage —", (e.stack || e.message || "").split("\n").slice(0, 2).join(" ").slice(0, 220)); } }

// v6.99.102–104 (A-PV-4, A-ST-8, A-PV-3): PO-2026-0044's view — its sales linked, the settlement full width with less / plus lines
{ try {
    const pf = FX.fixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json"); if (!pf) throw new Error("fixture missing");
    const d9 = JSON.parse(fs.readFileSync(pf, "utf8")); const bad = []; const T = h => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ");
    const c9 = { ...common, contacts: d9.contacts, pos: d9.pos, orders: d9.orders, lots: d9.lots, shipments: d9.shipments, invoices: d9.invoices || [], poSettlements: d9.poSettlements || [], claims: d9.claims || [] };
    const POm = require(path.resolve("./src/PurchaseOrders"));
    _where = "PO view PO-2026-0044"; const pv = renderToStaticMarkup(React.createElement(POm.default, { ...c9, initialSelectedNumber: "PO-2026-0044" })); const pt = T(pv);
    ["SO-2026-0027", "SO-2026-0028", "SO-2026-0029"].forEach(n => { if (!pt.includes(n)) bad.push("linked documents lack " + n); });
    const iS = pt.indexOf("Truck settlement"), iL = pt.indexOf("LINKED DOCUMENTS"), iO = pt.indexOf("ORDER DETAILS"); if (!(iS > 0 && iO > iS && iL > iO)) bad.push(`order: settlement ${iS}, order details ${iO}, linked ${iL}`);
    if (/less: .* 0,00 PLN|−0,00/.test(pt)) bad.push("a zero or signed line shows"); if (!/Sales \(excl\. VAT\)/.test(pt)) bad.push("sales line missing");
    if (!/↳ SO-2026-0028/.test(pt) || !/↳ SO-2026-0029/.test(pt)) bad.push("the settlement lines do not name their sales (A-ST-9)");
    const lh2 = T(renderToStaticMarkup(React.createElement(POm.default, { ...c9 }))); if (/PO-2026-0010/.test(lh2)) bad.push("a deleted PO shows in the list by default (A-DEL-4)");
    if (!bad.length) { passed++; console.log("  \u2713 PO-2026-0044: the three sales linked through its lots; settlement first and full width, Order details, then Linked documents; less / plus lines without signs"); }
    else { failed++; console.log("  \u2717 PO-2026-0044 view — " + bad.join(" · ")); }
  } catch (e) { failed++; console.log("  \u2717 PO-2026-0044 view —", (e.stack || e.message || "").split("\n").slice(0, 2).join(" ").slice(0, 220)); } }

// v6.99.108–109: the lot's class tile and the settlement show the ledger's split; the warehouse invoice offers Allocate to lots
{ try {
    const pf = FX.fixture("marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json"); if (!pf) throw new Error("fixture missing");
    const d9 = JSON.parse(fs.readFileSync(pf, "utf8")); const bad = []; const T = h => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ");
    const c9 = { ...common, contacts: d9.contacts, pos: d9.pos, orders: d9.orders, lots: d9.lots, shipments: d9.shipments, invoices: d9.invoices || [], poSettlements: d9.poSettlements || [], claims: d9.claims || [], notes: d9.financeNotes || [] };
    _where = "PO-2026-0044 settlement class I"; const POm = require(path.resolve("./src/PurchaseOrders")); const pt = T(renderToStaticMarkup(React.createElement(POm.default, { ...c9, initialSelectedNumber: "PO-2026-0044" })));
    const i127 = pt.indexOf("LOT-2026-0127"); const row = pt.slice(i127, i127 + 160); if (!/10 985 10 985/.test(row.replace(/\s+/g, " "))) bad.push("settlement row: class I not 10 985: " + row.slice(0, 120));
    _where = "invoice 128/09/2026 (AGRO-HURT)"; const Inv = require(path.resolve("./src/Invoices")).default;
    const ih = T(renderToStaticMarkup(React.createElement(Inv, { ...c9, setInvoices: () => {}, setLots: () => {}, initialSelectedNumber: "128/09/2026" })));
    if (!/Allocate to lots/.test(ih)) bad.push("the warehouse invoice offers no Allocate to lots: " + (ih.match(/128\/09\/2026.{0,100}/) || [""])[0]);
    if (!bad.length) { passed++; console.log("  \u2713 the settlement shows class I = received for the unsorted lot; AGRO-HURT's invoice offers Allocate to lots"); }
    else { failed++; console.log("  \u2717 class split / allocation — " + bad.join(" · ")); }
  } catch (e) { failed++; console.log("  \u2717 class split / allocation —", (e.stack || e.message || "").split("\n").slice(0, 2).join(" ").slice(0, 220)); } }

{ const bf = Array.from(new Set(buttonFaults));
  if (!bf.length) { passed++; console.log("  \u2713 button vocabulary: close is 'Close', Delete is red, Import/Export/Print/Edit use the one wording"); }
  else { failed++; console.log("  \u2717 button vocabulary (" + bf.length + "):"); bf.slice(0, 20).forEach(s => console.log("      " + s)); } }
{ const uniq = Array.from(new Set(silentSelects));
  if (!uniq.length) { passed++; console.log("  \u2713 no dropdown shows a choice nobody made"); }
  else { failed++; console.log("  \u2717 dropdowns showing an unchosen first option (" + uniq.length + "):"); uniq.slice(0, 30).forEach(s => console.log("      " + s)); } }
console.log(`RENDER SMOKE: ${passed} passed, ${failed} failed`); if (failed) process.exit(1);
