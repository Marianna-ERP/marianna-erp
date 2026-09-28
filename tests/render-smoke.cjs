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

{ const bf = Array.from(new Set(buttonFaults));
  if (!bf.length) { passed++; console.log("  \u2713 button vocabulary: close is 'Close', Delete is red, Import/Export/Print/Edit use the one wording"); }
  else { failed++; console.log("  \u2717 button vocabulary (" + bf.length + "):"); bf.slice(0, 20).forEach(s => console.log("      " + s)); } }
{ const uniq = Array.from(new Set(silentSelects));
  if (!uniq.length) { passed++; console.log("  \u2713 no dropdown shows a choice nobody made"); }
  else { failed++; console.log("  \u2717 dropdowns showing an unchosen first option (" + uniq.length + "):"); uniq.slice(0, 30).forEach(s => console.log("      " + s)); } }
console.log(`RENDER SMOKE: ${passed} passed, ${failed} failed`); if (failed) process.exit(1);
