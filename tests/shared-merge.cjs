// v7.14.0 (A-RV-01, owner 9 Oct): two people saving the same kind of record — run against a FAKE shared store (the same REST
// calls as Supabase: pull, PATCH pinned to a version). Proves: my change and a colleague's both survive; a record both changed keeps
// theirs and offers "Use mine"; a new document whose number was taken meanwhile is renumbered and said so. Fails on v7.13.5
// (there the whole change was set aside).
process.env.TZ = "Europe/Warsaw";
process.env.REACT_APP_SUPABASE_URL = "https://fake-project.supabase.co"; process.env.REACT_APP_SUPABASE_ANON_KEY = "anon-test";
const path = require("path");
const { JSDOM } = require("jsdom"); const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://marianna.local/" });
global.window = dom.window; global.document = dom.window.document; global.navigator = dom.window.navigator; global.localStorage = dom.window.localStorage; global.sessionStorage = dom.window.sessionStorage; global.CustomEvent = dom.window.CustomEvent; global.HTMLElement = dom.window.HTMLElement;
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", jsx: "react-jsx", esModuleInterop: true, target: "es2019" } });
console.error = () => {}; console.warn = () => {};
localStorage.setItem("marianna:shared:session", JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Date.now() + 3600e3, email: "maria@test" }));
localStorage.setItem("marianna:shared:first-pull", "done");
// ── the fake shared store ──
const server = new Map();   // key → { data, version, updated_by }
const seed = (key, data) => server.set(key, { data: JSON.parse(JSON.stringify(data)), version: 1, updated_by: "seed" });
const colleague = (key, fn) => { const r = server.get(key); server.set(key, { data: fn(JSON.parse(JSON.stringify(r.data))), version: r.version + 1, updated_by: "Hazem" }); };
global.fetch = async (url, init = {}) => {
  const u = new URL(url); const p = u.pathname.replace(/^\/rest\/v1\//, ""); const method = (init.method || "GET").toUpperCase();
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  if (p === "stores" && method === "GET") return ok(Array.from(server.entries()).map(([key, r]) => ({ key, data: r.data, version: r.version, updated_by: r.updated_by })));
  if (p === "stores" && method === "PATCH") {
    const key = decodeURIComponent((u.searchParams.get("key") || "").replace(/^eq\./, "")); const v = Number((u.searchParams.get("version") || "").replace(/^eq\./, ""));
    const r = server.get(key); const body = JSON.parse(init.body);
    if (!r || r.version !== v) return ok([]);
    server.set(key, { data: body.data, version: body.version, updated_by: body.updated_by }); return ok([{ key, data: body.data, version: body.version }]);
  }
  if (p === "stores" && method === "POST") { JSON.parse(init.body).forEach(b => server.set(b.key, { data: b.data, version: b.version || 1, updated_by: b.updated_by })); return ok([]); }
  return { ok: false, status: 404, json: async () => ({}) };
};
const LS = require(path.resolve("./src/useLocalStoredState")); const RS = require(path.resolve("./src/remoteStore"));
let passed = 0, failed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log("  \u2713", name); } catch (e) { failed++; console.log("  \u2717", name, "—", String(e && e.message || e).slice(0, 260)); } };
const ok = (c, m) => { if (!c) throw new Error(m || "expected true"); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const so = (id, number, extra = {}) => ({ id, number, status: "Draft", ...extra });
(async () => {
  console.log("SHARED MERGE — a colleague saved first (A-RV-01)");
  LS.DATA_KEYS.forEach(k => seed(k, k === "heals" ? {} : []));
  seed("orders", [so(1, "SO-2026-0001")]); seed("pos", [{ id: 50, number: "PO-2026-0001" }]);
  await RS.pullAll(); let st = null; RS.onSync(s => { st = s; }); const stop = RS.startSync("Maria");
  await t("my change to SO-0001 and a colleague's new SO-0002 both reach the shared data — nothing set aside", async () => {
    colleague("orders", d => [...d, so(2, "SO-2026-0002")]);
    LS.writeSharedStoreValue("orders", [so(1, "SO-2026-0001", { status: "Confirmed" })]);
    await wait(2200);
    const d = server.get("orders").data; ok(d.length === 2, "orders on the shared copy: " + JSON.stringify(d.map(x => x.number)));
    ok(d.find(x => x.id === 1).status === "Confirmed", "my change was lost"); ok(d.find(x => x.id === 2), "the colleague's order was lost");
    ok(!(st.conflicts || []).includes("orders"), "still reported as a whole-store conflict"); ok(JSON.stringify(LS.readStoreValue("orders")) === JSON.stringify(d), "this browser does not show the merge");
  });
  await t("SO-0001 changed by both: theirs stays, mine is offered — 'Use mine' puts mine back", async () => {
    colleague("orders", d => d.map(x => x.id === 1 ? { ...x, notes: "theirs" } : x));
    LS.writeSharedStoreValue("orders", (LS.readStoreValue("orders") || []).map(x => x.id === 1 ? { ...x, notes: "mine" } : x));
    await wait(2200);
    ok(server.get("orders").data.find(x => x.id === 1).notes === "theirs", "theirs not kept");
    const n = (st.notices || []).find(x => x.kind === "clash" && x.key === "orders" && x.id === "1"); ok(n && n.label === "SO-2026-0001" && n.by === "Hazem", "no clash notice naming SO-2026-0001 and Hazem: " + JSON.stringify(st.notices));
    await RS.keepMine("orders", "1"); await wait(100);
    ok(server.get("orders").data.find(x => x.id === 1).notes === "mine", "'Use mine' did not put mine back"); ok(!(st.notices || []).some(x => x.kind === "clash"), "the notice stays");
  });
  await t("two new orders with the same number: mine becomes SO-2026-0004 and the person is told", async () => {
    colleague("orders", d => [...d, so(8, "SO-2026-0003")]);
    LS.writeSharedStoreValue("orders", [...(LS.readStoreValue("orders") || []), so(7, "SO-2026-0003")]);
    await wait(2200);
    const d = server.get("orders").data; ok(d.find(x => x.id === 8).number === "SO-2026-0003" && d.find(x => x.id === 7).number === "SO-2026-0004", "numbers: " + JSON.stringify(d.map(x => [x.id, x.number])));
    ok((st.notices || []).some(x => x.kind === "renumbered" && x.label === "SO-2026-0003" && x.to === "SO-2026-0004"), "not told");
  });
  await t("the sync bar says it in words, with 'Use mine' on a clash (screen)", async () => {
    const React = require("react"); const { renderToStaticMarkup } = require("react-dom/server"); const G = require(path.resolve("./src/SharedStoreGate"));
    const h = renderToStaticMarkup(React.createElement(G.SharedStoreStatus, { sync: { ...st, notices: [...(st.notices || []), { key: "orders", kind: "clash", id: "1", label: "SO-2026-0001", by: "Hazem", at: "" }] }, userLabel: "Maria" })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    ok(/your new SO-2026-0003 is now SO-2026-0004/.test(h), "renumbering not shown: " + h.slice(0, 200)); ok(/SO-2026-0001: Hazem changed it at the same time/.test(h) && /Use mine/.test(h), "clash not shown");
  });
  stop && stop();
  console.log(`SHARED MERGE: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
