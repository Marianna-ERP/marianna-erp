// v6.99.110 (AUD-10): the suites run on Poland's clock — the one the business runs on; UTC hid every one-day date shift
process.env.TZ = "Europe/Warsaw";
// ══ v6.99.70 (A-BK-1/2) — BACKUP FOLDER ENGINE against a simulated folder (jsdom + ts-node) ══
// The pure rules are pinned in audit-roundtrip (block 76). This suite drives the BROWSER part — src/autoBackup.ts — end to
// end: the folder the user picks is simulated with the same calls Chrome offers (getFileHandle, createWritable, entries,
// removeEntry, queryPermission/requestPermission), so every path the owner can meet is exercised without a browser.
const path = require("path");
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://marianna.local/" });
global.window = dom.window; global.document = dom.window.document; global.navigator = dom.window.navigator;
global.localStorage = dom.window.localStorage; global.CustomEvent = dom.window.CustomEvent; global.HTMLElement = dom.window.HTMLElement;
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", jsx: "react-jsx", esModuleInterop: true, target: "es2019" } });

// ── a folder as Chrome exposes it ──
function simulatedFolder(name) {
  const files = new Map(); const f = { name, kind: "directory", files, perm: "granted", failNext: null };
  f.queryPermission = async () => f.perm;
  f.requestPermission = async () => { if (f.perm === "prompt") f.perm = "granted"; return f.perm; };
  f.getFileHandle = async (n, opts) => {
    if (f.failNext) { const e = new Error(f.failNext); e.name = f.failNext; f.failNext = null; throw e; }
    if (f.perm !== "granted") { const e = new Error("permission"); e.name = "NotAllowedError"; throw e; }
    if (!files.has(n) && !(opts && opts.create)) { const e = new Error("missing"); e.name = "NotFoundError"; throw e; }
    return { kind: "file", name: n, createWritable: async () => { let buf = ""; return { write: async (s) => { buf += s; }, close: async () => { files.set(n, buf); } }; } };
  };
  f.entries = async function* () { for (const n of Array.from(files.keys())) yield [n, { kind: "file", name: n }]; };
  f.removeEntry = async (n) => { files.delete(n); };
  return f;
}

let passed = 0, failed = 0; const warned = []; console.warn = (...a) => warned.push(a.map(String).join(" ").slice(0, 120));
const t = async (name, fn) => { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { failed++; console.log("  ✗", name, "—", String(e && e.message || e).slice(0, 200)); } };
const ok = (c, m) => { if (!c) throw new Error(m || "expected true"); };
const eq = (a, b, m) => { if (a !== b) throw new Error((m ? m + ": " : "") + JSON.stringify(a) + " ≠ " + JSON.stringify(b)); };

(async () => {
  console.log("BACKUP FOLDER ENGINE (simulated Chrome folder)");
  const folder = simulatedFolder("MARIANNA backups");
  window.showDirectoryPicker = async () => folder;
  localStorage.setItem("marianna-erp:v2:pos", JSON.stringify([{ number: "PO-2026-0040", supplier: { name: "Grójecki Owoc" } }]));
  localStorage.setItem("marianna-erp:v2:contacts", JSON.stringify([{ name: "Grójecki Owoc" }]));
  const AB = require(path.resolve("./src/autoBackup"));
  const U = require(path.resolve("./src/useLocalStoredState"));
  const D = require(path.resolve("./src/autoBackup.domain"));

  await t("choosing the folder writes the first file at once, and it is exactly the Export-all-data file", async () => {
    const r = await AB.chooseBackupFolder(); ok(r.ok, r.message);
    const names = Array.from(folder.files.keys()); eq(names.length, 1); ok(D.parseAutoFileName(names[0]), "our pattern: " + names[0]);
    const content = folder.files.get(names[0]); const p = JSON.parse(content);
    eq(p._meta.app, "marianna-erp"); eq(p.pos[0].number, "PO-2026-0040");
    eq(content.replace(/"exportedAt": "[^"]*"/, ""), U.exportAllData().replace(/"exportedAt": "[^"]*"/, ""), "same bytes as Export all data (apart from the time stamp)");
    ok(U.importAllData(content, { autoBackup: false }).ok, "Import accepts it");
    const st = AB.getAutoBackupStatus(); eq(st.mode, "active"); eq(st.folderName, "MARIANNA backups"); eq(st.lastFileName, names[0]);
    eq(AB.bannerFor(st, D.localDay(new Date())), "none", "healthy: no banner");
  });

  await t("the folder preference is per browser: not in the Export file, not among the data stores", async () => {
    ok(localStorage.getItem("marianna-erp:autoBackup"), "status record kept");
    ok(!U.DATA_KEYS.includes("autoBackup")); ok(!U.exportAllData().includes("MARIANNA backups"));
  });

  await t("30 + 30 in the real folder: 70 old files and a manual export — the old ones pruned, the export untouched", async () => {
    const now = new Date();
    for (let d = 1; d <= 35; d++) for (const h of [9, 17]) { const when = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d, h, 0, 0); folder.files.set(D.autoFileName(when, "6.99.69"), "{}"); }
    const manual = "marianna-erp_v6.99.69_schema-v2_2026-09-20T10-00-00.json"; folder.files.set(manual, "{}");
    ok(await AB.backupNow(), "Back up now wrote a file");
    const ours = Array.from(folder.files.keys()).filter(n => D.parseAutoFileName(n));
    const expect = D.planRetention(ours, now);
    eq(expect.remove.length, 0, "what is left is exactly what the rule keeps"); ok(ours.length <= 60 && ours.length >= 30, "kept " + ours.length);
    ok(folder.files.has(manual), "a manual export in the same folder is never deleted");
    eq(AB.getAutoBackupStatus().filesKept, ours.length);
  });

  await t("unchanged data writes nothing; before an import or a wipe, a change goes to the folder at once", async () => {
    const before = Array.from(folder.files.keys()).join("|");
    await AB.flushFolderBackup(); eq(Array.from(folder.files.keys()).join("|"), before, "unchanged data: the folder is untouched");
    await new Promise(r => setTimeout(r, 1100));   // the file name carries seconds — a new second, a new name
    localStorage.setItem("marianna-erp:v2:pos", JSON.stringify([{ number: "PO-2026-0041" }]));
    await AB.flushFolderBackup();
    const newest = Array.from(folder.files.keys()).filter(n => D.parseAutoFileName(n)).sort().pop();
    ok(folder.files.get(newest).includes("PO-2026-0041"), "the newest file holds the change, although it came within the 15 minutes");
  });

  await t("a folder that disappeared: red, with the reason, and the red banner cannot be snoozed", async () => {
    folder.failNext = "NotFoundError";
    ok(!(await AB.backupNow()), "reported as failed");
    const st = AB.getAutoBackupStatus(); eq(st.mode, "failed"); ok(/can't be found/.test(st.lastError), st.lastError);
    AB.snoozeBackupBanner(); eq(AB.bannerFor(AB.getAutoBackupStatus(), D.localDay(new Date())), "failed", "Later does not hide a failure");
    ok(await AB.backupNow(), "Retry succeeds once the folder is back"); eq(AB.getAutoBackupStatus().mode, "active");
  });

  await t("after a browser restart the access is paused (amber, not red); Resume asks once and writes what was waiting", async () => {
    await new Promise(r => setTimeout(r, 1100));
    folder.perm = "prompt";                                   // what Chrome reports after a restart
    localStorage.setItem("marianna-erp:v2:pos", JSON.stringify([{ number: "PO-2026-0042" }]));
    await AB.flushFolderBackup();                             // a write attempt while the browser withholds access
    const st = AB.getAutoBackupStatus(); eq(st.mode, "paused"); eq(AB.bannerFor({ ...st, snoozedDay: "" }, D.localDay(new Date())), "paused");
    ok(!Array.from(folder.files.values()).some(c => c.includes("PO-2026-0042")), "nothing written while paused");
    ok(await AB.resumeBackupFolder(), "Resume granted"); eq(AB.getAutoBackupStatus().mode, "active");
    const newest = Array.from(folder.files.keys()).filter(n => D.parseAutoFileName(n)).sort().pop();
    ok(folder.files.get(newest).includes("PO-2026-0042"), "the waiting change is written on Resume");
  });

  await t("Stop: no more files, the files already written stay, the card offers Choose again", async () => {
    const n = folder.files.size; await AB.stopFolderBackup();
    eq(folder.files.size, n, "files stay"); eq(AB.getAutoBackupStatus().mode, "notSet");
    localStorage.setItem("marianna-erp:v2:pos", JSON.stringify([{ number: "PO-2026-0043" }]));
    await AB.flushFolderBackup(); eq(folder.files.size, n, "nothing written after Stop");
  });

  await t("a browser without folder access: the daily download counts as today's backup and silences the strip", async () => {
    delete window.showDirectoryPicker;
    Object.keys(require.cache).filter(k => /src[\\/]autoBackup\.ts$/.test(k)).forEach(k => { delete require.cache[k]; });
    localStorage.removeItem("marianna-erp:autoBackup");
    const AB2 = require(path.resolve("./src/autoBackup")); await AB2.startAutoBackup();
    const today = D.localDay(new Date());
    eq(AB2.getAutoBackupStatus().mode, "unsupported"); eq(AB2.bannerFor(AB2.getAutoBackupStatus(), today), "unsupported");
    window.URL.createObjectURL = () => "blob:x"; window.URL.revokeObjectURL = () => {}; global.URL = window.URL; global.Blob = window.Blob;
    const name = AB2.downloadAllData(); ok(/^marianna-erp_v.*_schema-v2_.*\.json$/.test(name), name);
    eq(AB2.bannerFor(AB2.getAutoBackupStatus(), today), "none", "downloaded today: no strip");
  });

  console.log(`BACKUP FOLDER: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
