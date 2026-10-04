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
console.log(`SOURCE GATES: ${checked - failed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
