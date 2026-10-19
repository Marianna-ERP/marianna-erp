// v6.99.113 (AUD-10 / AUD-11, external audit 4 Oct) — SOURCE GATES
// Two faults keep coming back: a UTC date written where the local date is meant (`toISOString().slice(0,10)` is yesterday in
// Poland after midnight), and ad-hoc number parsing that disagrees with numbers.parseNum. The allow-list holds every site that
// exists today; a file's count may only go DOWN, and a new file may not appear. Shrinking happens in the dates batch (AUD-06..09)
// and the parsing clean-up (AUD-11).
process.env.TZ = "Europe/Warsaw";
const fs = require("fs"), path = require("path");
const src = path.join(__dirname, "../src"); const allow = require("./source-gates.allowlist.json");
const rules = [
  { key: "utcDates", label: "UTC date written as a local date (toISOString().slice / split(\"T\"))", re: /toISOString\(\)\.slice\(0, ?(7|10)\)|toISOString\(\)\.split\("T"\)\[0\]|\.split\("T"\)\[0\]/g, exempt: ["dates.ts"] },
  { key: "parseFloat", label: "ad-hoc parseFloat (use numbers.parseNum)", re: /parseFloat\(/g, exempt: ["numbers.ts"] },
];
let failed = 0, checked = 0;
console.log("SOURCE GATES (Warsaw clock)");
for (const r of rules) {
  const seen = {};
  fs.readdirSync(src).filter(f => /\.(ts|tsx)$/.test(f) && !r.exempt.includes(f)).forEach(f => { const n = (fs.readFileSync(path.join(src, f), "utf8").match(r.re) || []).length; if (n) seen[f] = n; });
  const over = Object.entries(seen).filter(([f, n]) => n > (allow[r.key][f] || 0));
  const total = Object.values(seen).reduce((a, b) => a + b, 0), allowed = Object.values(allow[r.key]).reduce((a, b) => a + b, 0);
  checked++;
  if (over.length) { failed++; console.log(`  ✗ ${r.label}: ${over.map(([f, n]) => `${f} ${allow[r.key][f] || 0} → ${n}`).join(", ")} (new sites — route through dates.ts / numbers.ts)`); }
  else console.log(`  ✓ ${r.label}: ${total} sites in ${Object.keys(seen).length} files, allowed ${allowed} — none added${total < allowed ? ` (${allowed - total} removed since the list was frozen)` : ""}`);
}
// the clock itself: the suite must be running on Poland's clock
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; checked++;
if (tz !== "Europe/Warsaw") { failed++; console.log(`  ✗ clock: ${tz} — the suites must run in Europe/Warsaw`); } else console.log("  ✓ clock: Europe/Warsaw");
// v7.27.13 (owner 19 Oct, P-8 / P-13): NO PLACE IS GUESSED — a shipment builder never falls back to a fixed place id (the early
// versions put place 10, a test place, on every shipment whose sale named no place; place 1 likewise for the origin)
{
  checked++; const off = [];
  fs.readdirSync(src).filter(f => /\.(ts|tsx)$/.test(f)).forEach(f => fs.readFileSync(path.join(src, f), "utf8").split("\n").forEach((l, i) => { const c = l.replace(/\/\/[^\n]*/g, ""); if (/LocationId[^;\n]{0,80}(\|\||\?\?)\s*\d+\s*[;,)]/.test(c) || /parseNum\(opts\.\w*LocationId,\s*\d+\)/.test(c)) off.push(`${f}:${i + 1}`); }));
  if (off.length) { failed++; console.log(`  ✗ no guessed place: ${off.length} fallback(s) to a fixed place id — ${off.slice(0, 5).join(", ")}`); } else console.log("  ✓ no guessed place: no builder falls back to a fixed place id");
}
// v7.27.12 (A-RV-39, P-13): NO REAL COMPANY IN THE CODE — no tax number written as a literal, none of the names the stub lists
// and demo places carried; the directory and the data hold the companies.
{
  checked++; const off = [];
  // the built-in places of real producers and clients (Białski Owoc, Euro-Papryka…) are still read by your data (place 3: 9
  // references on the real copy) — they move into the places table with FZ-04; the names removed in v7.27.12 must not come back
  // the stub companies removed in v7.27.12 and the partners' / test places removed from the built-in list in v7.27.17 (SC-14)
  const NAMES = /Myziak|Metro Cash|Lidl|zakupy@|Biedronka|Białski|Euro-Papryka|Venice Cold Stores|AM sped|FreshFarm|AgriTrade|Fresco Hamburg|Metro DC|Górecka|Wojska Polskiego 6F|Banchina dell'Azoto|Słomczyn 81/;
  fs.readdirSync(src).filter(f => /\.(ts|tsx)$/.test(f)).forEach(f => fs.readFileSync(path.join(src, f), "utf8").split("\n").forEach((l, i) => { if (NAMES.test(l) || /nip:\s*["']\d{10}["']/.test(l)) off.push(`${f}:${i + 1}`); }));
  if (off.length) { failed++; console.log(`  ✗ no real company in the code: ${off.length} line(s) — ${off.slice(0, 5).join(", ")}`); } else console.log("  ✓ no real company in the code: no tax number or company name written into a source file");
}
// v7.27.8 (A-W5, P-13 — owner ruling 19 Oct: numbers from the database counter now): NO CREATION PATH WORKS OUT A NUMBER ON ITS
// OWN. The local generators may only be: their own definitions; the fallback after the counter's number (x || next…);
// the provisional number a new PO / SO form or a protocol draft shows (each confirmed from the counter at save); the
// lot builder (its two callers renumber its lots from the counter). Each allowance is checked against its companion.
{
  checked++; const off = [];
  const GEN = /\b(nextPONumber|nextSONumber|nextShipmentNumber|nextShipmentNumberPure|nextClaimNumber|nextProtocolNumber|nextSettlementNumberPO|nextLotSerial)\(/;
  const rd = f => fs.readFileSync(path.join(src, f), "utf8");
  const companion = { "PurchaseOrders.tsx": () => /issueNumber\("PO"/.test(rd("PurchaseOrders.tsx")) && (rd("PurchaseOrders.tsx").match(/issueNumbers\("LOT"/g) || []).length >= 2 && /issueNumber\("SET"/.test(rd("PurchaseOrders.tsx")),
    "SalesOrders.tsx": () => /issueNumber\("SO"/.test(rd("SalesOrders.tsx")), "loadingProtocol.domain.ts": () => /issueNumber\("LP"/.test(rd("LoadingProtocolModal.tsx")) };
  fs.readdirSync(src).filter(f => /\.(ts|tsx)$/.test(f)).forEach(f => rd(f).split("\n").forEach((l, i) => {
    const code = l.replace(/\/\/[^\n]*/g, ""); if (!GEN.test(code)) return;
    if (/^\s*(export\s+)?function\s+next/.test(code)) return;                                         // its own definition
    if (/\|\|\s*next[A-Z]\w*\(|issued\[n\]/.test(code)) return;                                       // the fallback after the counter's number
    if (/const nextNum = nextPONumber\(orders\)|number: nextSONumber\(orders\)|number: nextProtocolNumber\(input\.existingProtocols|nextLotSerial\(\[\.\.\.\(existingLots/.test(code) && companion[f] && companion[f]()) return;   // provisional, confirmed at save
    if (/Array\.from\(\{ length: n \}/.test(code)) return;                                               // inside the devanning fallback
    off.push(`${f}:${i + 1}`);
  }));
  if (off.length) { failed++; console.log(`  ✗ numbers from the counter: ${off.length} creation path(s) number on their own — ${off.slice(0, 5).join(", ")}`); } else console.log("  ✓ numbers from the counter: every creation path takes its number from the database's shared counter");
}
// v7.27.3 (FZ-26, P-13 — owner rulings A-RV-37 and FZ-21): A PLACE IS READ FROM ITS TYPE. Only the places module writes the old
// one-word code (for old copies); no other file reads it — every screen group comes from placeGroup(type).
{
  checked++; const off = [];
  fs.readdirSync(src).filter(f => /\.(ts|tsx)$/.test(f) && !["locations.ts", "types.ts"].includes(f)).forEach(f => fs.readFileSync(path.join(src, f), "utf8").split("\n").forEach((l, i) => { if (/legacyType/.test(l.replace(/\/\/[^\n]*/g, ""))) off.push(`${f}:${i + 1}`); }));
  if (off.length) { failed++; console.log(`  ✗ place type: the old code read in ${off.length} place(s) — ${off.slice(0, 5).join(", ")}`); } else console.log("  ✓ place type: no screen or rule reads the old place code — groups come from the type");
}
// v7.27.2 (FZ-25, P-13 — owner rule F-2): EVERY DATE A SCREEN SHOWS IS dd/mm/yyyy — a date field displayed as a value (the text of
// an element, a branch of ?:, an operand of || / ?? / +, a template span, a cut to the day, a hover title) goes through formatDMY.
// Inputs keep the ISO form the browser's date field needs; printed documents have their own layout and checks.
{
  checked++; const ts = require("typescript"); const off = [];
  const PRINT = new Set(["PurchaseOrderDocument.tsx", "SalesOrderDocument.tsx", "QualityReportDoc.tsx", "SalesReportDoc.tsx", "ShipmentDocuments.tsx", "LoadingProtocolModal.tsx"]);
  const NAME = /^(date|eta|etd|ETA|ETD|[a-z][A-Za-z0-9]*(Date|At|On|Eta|Etd))$/; const SKIP = new Set(["shippedOn"]);
  const values = (e, out) => {
    if (!e) return out;
    if (ts.isParenthesizedExpression(e)) return values(e.expression, out);
    if (ts.isPropertyAccessExpression(e) || ts.isIdentifier(e)) { out.push(e); return out; }
    if (ts.isBinaryExpression(e) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(e.operatorToken.kind)) { values(e.left, out); values(e.right, out); return out; }
    if (ts.isConditionalExpression(e)) { values(e.whenTrue, out); values(e.whenFalse, out); return out; }
    if (ts.isTemplateExpression(e)) { e.templateSpans.forEach(s => values(s.expression, out)); return out; }
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === "slice") { let inner = e.expression.expression; if (ts.isCallExpression(inner) && inner.expression.getText() === "String" && inner.arguments.length === 1) inner = inner.arguments[0]; if (ts.isPropertyAccessExpression(inner) || ts.isIdentifier(inner)) out.push(inner); }
    return out;
  };
  fs.readdirSync(src).filter(f => f.endsWith(".tsx") && !PRINT.has(f)).forEach(f => {
    const text = fs.readFileSync(path.join(src, f), "utf8"); const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    (function w(n) {
      const shown = ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent) || (ts.isJsxAttribute(n.parent) && n.parent.name.getText(sf) === "title"));
      if (shown) values(n.expression, []).forEach(v => { const leaf = ts.isPropertyAccessExpression(v) ? v.name.getText(sf) : v.getText(sf); if (NAME.test(leaf) && !SKIP.has(leaf)) off.push(`${f}:${sf.getLineAndCharacterOfPosition(v.getStart(sf)).line + 1} ${v.getText(sf)}`); });
      ts.forEachChild(n, w);
    })(sf);
  });
  if (off.length) { failed++; console.log(`  ✗ dates dd/mm/yyyy: ${off.length} shown as stored — ${off.slice(0, 5).join(", ")}`); } else console.log("  ✓ dates dd/mm/yyyy: every date a screen shows goes through formatDMY");
}
// v7.27.1 (FZ-24, P-13 — owner rule A-RV-13 / P-8): A COMPANY IS CHOSEN AND FOUND BY ITS ID, NEVER BY ITS NAME (two companies of one
// name would swap). Names may still SUGGEST (the review lists, the import's suggestions) — those never search these lists by name.
{
  checked++; const off = [];
  const re = /\b(contacts|clients|suppliers|counterparties|companies)\b[^;\n]{0,40}\.find\(\(?\s*\w+(?:\s*:\s*any)?\s*\)?\s*=>\s*[^;\n]{0,80}\.name\b[^;\n]{0,40}===/;
  fs.readdirSync(src).filter(f => /\.(ts|tsx)$/.test(f)).forEach(f => fs.readFileSync(path.join(src, f), "utf8").split("\n").forEach((l, i) => { if (re.test(l.replace(/\/\/[^\n]*/g, ""))) off.push(`${f}:${i + 1}`); }));
  if (off.length) { failed++; console.log(`  ✗ companies by id: ${off.length} lookup(s) by name — ${off.slice(0, 5).join(", ")}`); } else console.log("  ✓ companies by id: no screen finds a company by its name");
}
// v7.23.4 (A-UI-2, Batch G): ONE FONT AND ONE SCALE ON EVERY SCREEN — text sizes 10, 11, 12, 13, 14, 16, 20, 24 px and the app's own
// font (even-width figures where numbers line up). Printed documents keep theirs: the document files, the pieces they borrow from
// the screens (BiLbl, PrintLogo, FieldPrint) and the screen parts printed as they are (management package, statement, lot trace)
{
  checked++; const ts = require("typescript"); const SCALE = new Set([10, 11, 12, 13, 14, 16, 20, 24]);
  const PRINT_FILES = new Set(["PurchaseOrderDocument.tsx", "SalesOrderDocument.tsx", "QualityReportDoc.tsx", "SalesReportDoc.tsx", "ShipmentDocuments.tsx", "LoadingProtocolModal.tsx"]);
  const PRINT_PIECES = new Set(["BiLbl", "PrintLogo", "FieldPrint"]); const PRINTED_IDS = new Set(["mgmt-package", "statement-print", "lot-trace-doc"]);
  const off = [];
  fs.readdirSync(src).filter(f => /\.tsx$/.test(f) && !PRINT_FILES.has(f)).forEach(f => {
    const text = fs.readFileSync(path.join(src, f), "utf8"); const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const line = n => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    (function w(n) {
      if ((ts.isFunctionDeclaration(n) && n.name && PRINT_PIECES.has(n.name.text))) return;
      const op = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
      if (op && op.attributes.properties.some(a => ts.isJsxAttribute(a) && a.name.getText(sf) === "id" && a.initializer && ts.isStringLiteral(a.initializer) && PRINTED_IDS.has(a.initializer.text))) return;
      if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "fontSize" && ts.isNumericLiteral(n.initializer) && !SCALE.has(Number(n.initializer.text))) off.push(`${f}:${line(n)} ${n.initializer.text}px`);
      if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "fontFamily" && /monospace/.test(n.initializer.getText(sf))) off.push(`${f}:${line(n)} typewriter font`);
      ts.forEachChild(n, w);
    })(sf);
  });
  if (off.length) { failed++; console.log(`  ✗ one font: ${off.length} off the standard — ${off.slice(0, 4).join(", ")}`); } else console.log("  ✓ one font: every screen size is on the scale (10–24 px) and in the app's font; printed documents keep theirs");
}
// v7.23.0 (A-DEP-1, Batch G): THE RELEASE LIST IS THE REPOSITORY — release-files.json names exactly the files of this version,
// so the pre-build check can name any leftover in the GitHub copy; and the type-check reads only what the app loads
{
  checked++; const { walk, root } = require("../scripts/release-files.cjs"); let rl = null; try { rl = JSON.parse(fs.readFileSync(path.join(root, "release-files.json"), "utf8")); } catch {}
  const ver = (fs.readFileSync(path.join(src, "version.ts"), "utf8").match(/APP_VERSION = "([^"]+)"/) || [])[1];
  const have = walk(root).sort(); const listed = (rl && rl.files) || [];
  const extra = have.filter(f => !listed.includes(f)), gone = listed.filter(f => !have.includes(f));
  const inc = JSON.parse(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8")).include || [];
  if (!rl || rl.version !== ver || extra.length || gone.length || inc.join() !== "src/index.tsx") { failed++; console.log(`  ✗ release list: ${!rl ? "missing" : `v${rl.version} for v${ver}; not listed ${extra.slice(0, 3).join(", ")}; listed but absent ${gone.slice(0, 3).join(", ")}`}${inc.join() !== "src/index.tsx" ? "; the type-check reads more than the app" : ""} — run npm run release:files`); }
  else console.log(`  ✓ release list: v${ver}, ${have.length} files, exactly the repository; the type-check reads what the app loads`);
}
// v7.22.5 (A-RV-17, Batch F): THE APP'S OWN WINDOWS — no browser confirm / alert / prompt; only the crash screen keeps one,
// because it is a class component shown when the app itself has failed
{
  checked++; const hits = [];
  fs.readdirSync(src).filter(f => /\.(ts|tsx)$/.test(f) && f !== "ErrorBoundary.tsx").forEach(f => fs.readFileSync(path.join(src, f), "utf8").split("\n").forEach((l, i) => { if (/window\.(confirm|alert|prompt)\(/.test(l.replace(/\/\/.*$/, ""))) hits.push(`${f}:${i + 1}`); }));
  if (hits.length) { failed++; console.log(`  ✗ own windows: ${hits.length} browser pop-up(s) — ${hits.slice(0, 5).join(", ")}`); } else console.log("  ✓ own windows: no browser confirm, alert or prompt outside the crash screen");
}
// v7.22.3 (FZ-21, owner ruling 13 Oct): ONE INCOTERM TABLE — no file but incoterms.domain.ts names an incoterm (comments aside)
{
  checked++; const hits = [];
  fs.readdirSync(src).filter(f => /\.(ts|tsx)$/.test(f) && f !== "incoterms.domain.ts").forEach(f => fs.readFileSync(path.join(src, f), "utf8").split("\n").forEach((l, i) => {
    const s = l.trim(); if (s.startsWith("//") || s.startsWith("*") || s.startsWith("/*")) return;
    if (/["'`](EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP|DAT)["'`]/.test(l.replace(/\/\/.*$/, ""))) hits.push(`${f}:${i + 1}`);
  }));
  if (hits.length) { failed++; console.log(`  ✗ one incoterm table: ${hits.length} line(s) name a term outside it — ${hits.slice(0, 5).join(", ")}`); } else console.log("  ✓ one incoterm table: no file outside incoterms.domain.ts names a term");
}
// v7.22.0 (FZ-19, Batch F): DEAD CODE CANNOT COME BACK UNSEEN — (1) every file of the app is reached from its start (index.tsx)
{
  checked++; const seen = new Set(); const files = fs.readdirSync(src).filter(f => /\.(ts|tsx)$/.test(f) && !/\.d\.ts$/.test(f));
  const resolve = spec => ["", ".ts", ".tsx"].map(x => spec + x).find(c => files.includes(c));
  const walk = f => { if (!f || seen.has(f)) return; seen.add(f); const t = fs.readFileSync(path.join(src, f), "utf8"); (t.match(/(?:from\s+|import\s*\(\s*|import\s+)["']\.\/([^"']+)["']/g) || []).forEach(m => walk(resolve(m.replace(/^.*["']\.\//, "").replace(/["']$/, "")))); };
  walk("index.tsx"); const lost = files.filter(f => !seen.has(f));
  if (lost.length) { failed++; console.log(`  ✗ reachable: ${lost.length} file(s) no screen can load — ${lost.join(", ")}`); } else console.log(`  ✓ reachable: all ${files.length} files are loaded from the app's start`);
}
// (2) no variable, import or function inside a file is declared and never used (TypeScript's own check)
{
  checked++; let out = ""; try { out = require("child_process").execSync("npx tsc --noEmit --noUnusedLocals -p .", { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 }).toString(); } catch (e) { out = String(e.stdout || "") + String(e.stderr || ""); }
  const unused = (out.match(/error TS61(33|92|96|98)[^\n]*/g) || []);
  if (unused.length) { failed++; console.log(`  ✗ unused: ${unused.length} — ${unused.slice(0, 3).join(" | ")}`); } else console.log("  ✓ unused: no variable, import or function is declared and never used");
}
console.log(`SOURCE GATES: ${checked - failed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
