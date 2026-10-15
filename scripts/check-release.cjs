// check-release.cjs — runs before every build (npm "prebuild"; A-DEP-1, v7.23.0). The GitHub copy keeps every file ever
// uploaded unless it is deleted by hand, so files from older versions pile up. This names them in the build log. It never
// stops the build: the type-check reads only the files the app loads (tsconfig "include": src/index.tsx), so a leftover
// cannot break it — but it should still be deleted (an old file under api/ would even be deployed as an endpoint).
const fs = require("fs"), path = require("path");
const { walk, root } = require("./release-files.cjs");
let list; try { list = JSON.parse(fs.readFileSync(path.join(root, "release-files.json"), "utf8")); } catch { console.log("RELEASE CHECK: release-files.json is missing — cannot tell which files belong to this release."); process.exit(0); }
const have = new Set(walk(root)), want = new Set(list.files || []);
const extra = [...have].filter(f => !want.has(f)).sort(), missing = [...want].filter(f => !have.has(f)).sort();
if (!extra.length && !missing.length) { console.log(`RELEASE CHECK: v${list.version} — the copy holds exactly the release's ${want.size} files.`); process.exit(0); }
const bar = "=".repeat(78);
console.log(`\n${bar}\nRELEASE CHECK — v${list.version}`);
if (extra.length) { console.log(`These ${extra.length} file(s) are NOT part of v${list.version} — delete them from the GitHub copy:`); extra.forEach(f => console.log(`   ${f}`)); }
if (missing.length) { console.log(`These ${missing.length} file(s) of v${list.version} are MISSING from the copy — upload the whole release:`); missing.forEach(f => console.log(`   ${f}`)); }
console.log(`(the build goes on: files the app does not load are not built)\n${bar}\n`);
process.exit(0);
