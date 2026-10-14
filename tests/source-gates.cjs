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
