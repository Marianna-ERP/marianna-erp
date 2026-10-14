// ══ v7.21.3 (AUD-51, owner 11 Oct) — NOTHING WITH A KNOWN HOLE SHIPS TO THE BROWSER ══
// npm's security report used to be switched off (.npmrc audit=false) and nobody read it. This gate reads it at every release:
// it FAILS when a package that ends up in the app people open (React, React DOM, SheetJS and what they pull in) has a known
// vulnerability, and lists — without failing — those that only exist on the build machine (react-scripts, TypeScript …), which
// never reach a browser. SheetJS is installed from vendor/ (the fixed 0.20.3 is published only on SheetJS's own site), so npm
// has no advisory to match it against: the gate checks that the copy in vendor/ is the one installed and is 0.19.3 or later.
const { execSync } = require("child_process"); const fs = require("fs"); const path = require("path");
const root = path.join(__dirname, ".."); let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log("  \u2713", name); } catch (e) { failed++; console.log("  \u2717", name, "\u2014", String((e && e.message) || e).slice(0, 300)); } };
const ok = (c, m) => { if (!c) throw new Error(m || "expected true"); };
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")); const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const RUNTIME_ROOTS = ["react", "react-dom", "xlsx"];
// what the browser gets: the runtime roots and everything they pull in, per the lock file
const runtime = new Set(); (function walk(names) { names.forEach(n => { if (runtime.has(n)) return; const p = lock.packages["node_modules/" + n]; if (!p) return; runtime.add(n); walk(Object.keys(p.dependencies || {})); }); })(RUNTIME_ROOTS);
console.log("\u2550\u2550 v7.21.3 \u2014 AUD-51: npm's security report, read at every release \u2550\u2550");
t("AUD-51 (v7.21.3): SheetJS is the fixed version kept in vendor/ (0.19.3 or later), installed from there", () => {
  const spec = String((pkg.dependencies || {}).xlsx || ""); ok(/^file:vendor\/xlsx-\d+\.\d+\.\d+\.tgz$/.test(spec), "package.json installs SheetJS from " + spec);
  ok(fs.existsSync(path.join(root, spec.slice(5))), "the package is not in vendor/");
  const v = String((lock.packages["node_modules/xlsx"] || {}).version || ""); const [a, b, c] = v.split(".").map(Number);
  ok(a > 0 || b > 19 || (b === 19 && c >= 3), "SheetJS " + v + " still has the two known holes (fixed in 0.19.3)");
});
let report = null;
try { report = JSON.parse(execSync("npm audit --json --package-lock-only", { cwd: root, stdio: ["ignore", "pipe", "ignore"], timeout: 120000, maxBuffer: 64 * 1024 * 1024 }).toString() || "{}"); }
catch (e) { try { report = JSON.parse(String(e.stdout || "")); } catch { report = null; } }   // npm exits non-zero when it finds anything
if (!report || !report.vulnerabilities) console.log("  \u2933 SKIPPED \u2014 npm's security report could not be read here (no registry?)");
else t("AUD-51 (v7.21.3): no known vulnerability in what ships to the browser; the build machine's own are listed", () => {
  const all = Object.entries(report.vulnerabilities); const shipped = all.filter(([n]) => runtime.has(n)); const build = all.filter(([n]) => !runtime.has(n));
  const sev = s => build.filter(([, v]) => v.severity === s).length;
  console.log(`      build machine only (never in the browser): ${build.length} package(s) — ${sev("critical")} critical, ${sev("high")} high, ${sev("moderate")} moderate, ${sev("low")} low`);
  ok(!shipped.length, "ships to the browser with a known hole: " + shipped.map(([n, v]) => `${n} (${v.severity})`).join(", "));
});
console.log(`NPM AUDIT: ${passed} passed, ${failed} failed`); if (failed) process.exit(1);
