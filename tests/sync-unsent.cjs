// v7.37.0 (AUD3-B1): THE SHARED-DATA SYNC WHEN THE NETWORK FAILS — a change is kept in this browser until the shared copy has it:
// a failed save stays unsent (never "synced"), a reload does not pull over it, and it is pushed when the network returns.
process.env.TZ = "Europe/Warsaw"; const path = require("path");
const { JSDOM } = require("jsdom"); const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://marianna.local/" });
global.window = dom.window; global.document = dom.window.document; global.localStorage = dom.window.localStorage;
process.env.REACT_APP_SUPABASE_URL = "https://imitation.supabase.co"; process.env.REACT_APP_SUPABASE_ANON_KEY = "anon";
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", esModuleInterop: true, target: "es2019" } });
let passed = 0, failed = 0; const t = async (n, f) => { try { await f(); passed++; console.log("  ✓ " + n); } catch (e) { failed++; console.log("  ✗ " + n + " — " + (e && e.message)); } };
const ok = (c, m) => { if (!c) throw new Error(m || "not ok"); };
(async () => {
  console.log("SYNC — UNSENT CHANGES (imitation server)");
  const src = require("fs").readFileSync(path.resolve("./src/remoteStore.ts"), "utf8");
  await t("a change is written to the unsent queue before its push, cleared only when the push lands; the poll retries it first; the first pull never applies over it; a network blip keeps the session", async () => {
    ok(/markUnsent\(key, json\);/.test(src) && /await pushInner\(key, sent, by, attempt\); clearUnsent\(key, json\);/.test(src), "the queue is not written / cleared as it should");
    ok(/if \(unsentKeys\(\)\.length && !\(await flushUnsent\(by\)\.catch\(\(\) => false\)\)\) return;/.test(src), "the poll does not retry first");
    ok(/!unsent\.has\(r\.key\)\) applyStoreFromRemote/.test(src), "the first pull applies over an unsent change");
    ok(/if \(e && \(e\.status === 400 \|\| e\.status === 401\)\) saveSession\(null\)/.test(src), "a network blip still signs out");
  });
  await t("the queue itself: kept across a reload (localStorage), cleared only for the same content", async () => {
    const RS = require(path.resolve("./src/remoteStore"));
    localStorage.setItem("marianna:unsent:v1", JSON.stringify({ shipments: { json: "[1]", at: "x" } }));
    ok(RS.unsentKeys().join() === "shipments", "the queue is not read after a reload");
  });
  console.log(`SYNC UNSENT: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
