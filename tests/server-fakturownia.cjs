// ══ v7.21.1 (AUD-49, owner 11 Oct) — THE SERVER PART THAT HOLDS THE FAKTUROWNIA TOKEN ══
// api/fakturownia.js is driven with a simulated request and a simulated network: Supabase answers the sign-in check, Fakturownia
// answers the forwarded call. It proves the token stays on the server, the sign-in is checked first, only the app's own calls pass,
// and the TEST copy never creates an invoice. The browser side (src/fakturownia.ts) is driven the same way.
process.env.TZ = "Europe/Warsaw";
const path = require("path"); const fs = require("fs");
let passed = 0, failed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log("  \u2713", name); } catch (e) { failed++; console.log("  \u2717", name, "\u2014", String((e && e.message) || e).slice(0, 300)); } };
const ok = (c, m) => { if (!c) throw new Error(m || "expected true"); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m ? m + ": " : "") + JSON.stringify(a) + " \u2260 " + JSON.stringify(b)); };
const calls = [];
const mockFetch = handler => { global.fetch = async (url, init = {}) => { calls.push({ url: String(url), init }); return handler(String(url), init); }; };
const answer = (status, obj) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(obj), json: async () => obj });
const KEYS = ["FAKTUROWNIA_API_TOKEN", "FAKTUROWNIA_SUBDOMAIN", "REACT_APP_SUPABASE_URL", "REACT_APP_SUPABASE_ANON_KEY", "REACT_APP_ENV_LABEL"];
const setEnv = e => { KEYS.forEach(k => { delete process.env[k]; }); Object.assign(process.env, e); };
const SUPA = { REACT_APP_SUPABASE_URL: "https://proj.supabase.co/rest/v1/", REACT_APP_SUPABASE_ANON_KEY: "anon" };
const session = (url, init) => url.endsWith("/auth/v1/user") ? answer(((init.headers || {}).Authorization === "Bearer good") ? 200 : 401, { id: "u1" }) : null;
const H = require(path.resolve("./api/fakturownia.js"));
async function run(req) {
  const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }, end(s) { this.body = String(s || ""); } };
  await H({ method: "GET", headers: {}, ...req }, res); let body = null; try { body = JSON.parse(res.body); } catch { body = null; }
  return { status: res.statusCode, body, raw: res.body, headers: res.headers };
}
const fkt = () => calls.filter(c => /fakturownia\.pl/.test(c.url));
(async () => {
  console.log("\u2550\u2550 v7.21.1 \u2014 AUD-49: the Fakturownia token lives only in the server part \u2550\u2550");
  await t("AUD-49 (v7.21.1): without a valid sign-in the call is refused before anything reaches Fakturownia — the session is checked with Supabase at its origin", async () => {
    setEnv({ ...SUPA, FAKTUROWNIA_API_TOKEN: "SECRET", FAKTUROWNIA_SUBDOMAIN: "acme" }); calls.length = 0; mockFetch((u, i) => session(u, i) || answer(200, []));
    eq((await run({ query: { op: "invoices" } })).status, 401, "no sign-in");
    eq((await run({ query: { op: "invoices" }, headers: { authorization: "Bearer bad" } })).status, 401, "a session Supabase refuses");
    eq(fkt().length, 0, "Fakturownia was called"); ok(calls.some(c => c.url === "https://proj.supabase.co/auth/v1/user"), "the sign-in was not checked at Supabase's origin");
  });
  await t("AUD-49 (v7.21.1): signed in but nothing set in Vercel — the status says not connected, a call says which two settings to add", async () => {
    setEnv({ ...SUPA }); mockFetch((u, i) => session(u, i) || answer(200, []));
    const s = await run({ query: { op: "status" }, headers: { authorization: "Bearer good" } }); eq(s.status, 200); eq(s.body.configured, false);
    const r = await run({ query: { op: "invoices" }, headers: { authorization: "Bearer good" } }); eq(r.status, 503); ok(/FAKTUROWNIA_API_TOKEN and FAKTUROWNIA_SUBDOMAIN/.test(r.body.error), r.raw);
  });
  await t("AUD-49 (v7.21.1): connected — invoices are read with the server's token, only the app's own parameters pass, and the token never comes back", async () => {
    setEnv({ ...SUPA, FAKTUROWNIA_API_TOKEN: "SECRET", FAKTUROWNIA_SUBDOMAIN: "https://acme.fakturownia.pl/" }); calls.length = 0;
    mockFetch((u, i) => session(u, i) || answer(200, [{ id: 1, number: "FV 1/2026" }]));
    const r = await run({ query: { op: "invoices", page: "2", per_page: "100", income: "0", api_token: "EVIL", host: "evil.example" }, headers: { authorization: "Bearer good" } });
    eq(r.status, 200); eq(r.body[0].number, "FV 1/2026"); eq(r.headers["cache-control"], "no-store");
    const u = new URL(fkt()[0].url); eq(u.origin + u.pathname, "https://acme.fakturownia.pl/invoices.json"); eq(u.searchParams.get("api_token"), "SECRET", "not the server's token"); eq(u.searchParams.get("page"), "2"); eq(u.searchParams.get("host"), null, "a foreign parameter passed");
    ok(!/SECRET/.test(r.raw), "the token came back");
    const st = await run({ query: { op: "status" }, headers: { authorization: "Bearer good" } }); eq(st.body, { configured: true, account: "acme.fakturownia.pl", testCopy: false }); ok(!/SECRET/.test(st.raw), "the status shows the token");
    const ts = await run({ query: { op: "test" }, headers: { authorization: "Bearer good" } }); eq(ts.body.account, "acme.fakturownia.pl"); ok(!/SECRET/.test(ts.raw));
  });
  await t("AUD-49 (v7.21.1): creating an invoice — a token sent along is replaced by the server's; on the TEST copy it is refused and Fakturownia is never called", async () => {
    setEnv({ ...SUPA, FAKTUROWNIA_API_TOKEN: "SECRET", FAKTUROWNIA_SUBDOMAIN: "acme" }); calls.length = 0;
    // v7.37.0 (AUD3-A3): the caller is the linked owner — setup mode no longer issues invoices
    mockFetch((u, i) => (u.endsWith("/auth/v1/user") ? answer(((i.headers || {}).Authorization === "Bearer good") ? 200 : 401, { id: "u1", email: "owner@marianna.biz" }) : null) || (u.includes("/rest/v1/stores?key=eq.users") ? answer(200, [{ data: [{ id: 1, email: "owner@marianna.biz", isOwner: true }] }]) : answer(201, { id: 7, number: "FV 7/2026" })));
    const r = await run({ method: "POST", query: { op: "create" }, headers: { authorization: "Bearer good" }, body: { api_token: "EVIL", invoice: { kind: "vat" } } });
    eq(r.status, 200); eq(r.body.number, "FV 7/2026"); const p = fkt()[0]; eq(p.init.method, "POST"); const sent = JSON.parse(p.init.body); eq(sent.api_token, "SECRET"); eq(sent.invoice.kind, "vat"); eq(sent.invoice.gov_save_and_send, false, "v7.40.0 (AUD3-A4): the server never sends to KSeF by itself");
    setEnv({ ...SUPA, FAKTUROWNIA_API_TOKEN: "SECRET", FAKTUROWNIA_SUBDOMAIN: "acme", REACT_APP_ENV_LABEL: "TEST" }); calls.length = 0;
    const x = await run({ method: "POST", query: { op: "create" }, headers: { authorization: "Bearer good" }, body: { invoice: { kind: "vat" } } });
    eq(x.status, 403); ok(/TEST copy/.test(x.body.error), x.raw); eq(fkt().length, 0, "Fakturownia was called from TEST");
  });
  await t("M-2 (v7.30.1, audit F-04): a live invoice is issued only by the owner or a user with the Invoices module — read from the shared users list with the caller's own sign-in; with no owner linked everyone may", async () => {
  setEnv({ ...SUPA, FAKTUROWNIA_API_TOKEN: "SECRET", FAKTUROWNIA_SUBDOMAIN: "acme" });
  const EMAIL = { "Bearer own": "owner@firm.pl", "Bearer inv": "ops@firm.pl", "Bearer no": "Admin@Firm.pl", "Bearer stranger": "x@else.pl" };
  const users = [{ id: 1, email: "owner@firm.pl", isOwner: true, modules: {} }, { id: 2, email: "ops@firm.pl", isOwner: false, modules: { invoices: true } }, { id: 3, email: "admin@firm.pl", isOwner: false, modules: { invoices: false } }];
  let list = users;
  mockFetch((u, i) => { const auth = (i.headers || {}).Authorization;
  if (u.endsWith("/auth/v1/user")) return EMAIL[auth] ? answer(200, { id: "u", email: EMAIL[auth] }) : answer(401, {});
  if (u.includes("/rest/v1/stores?key=eq.users")) return answer(200, [{ data: list }]);
  return answer(201, { id: 9, number: "FV 9/2026" }); });
  const go = async who => { calls.length = 0; const r = await run({ method: "POST", query: { op: "create" }, headers: { authorization: who }, body: { invoice: { kind: "vat" } } }); return { status: r.status, sent: fkt().length }; };
  eq(JSON.stringify(await go("Bearer own")), JSON.stringify({ status: 200, sent: 1 }), "the owner");
  eq(JSON.stringify(await go("Bearer inv")), JSON.stringify({ status: 200, sent: 1 }), "a user with the Invoices module");
  eq(JSON.stringify(await go("Bearer no")), JSON.stringify({ status: 403, sent: 0 }), "a user without the Invoices module (e-mail case ignored)");
  eq(JSON.stringify(await go("Bearer stranger")), JSON.stringify({ status: 403, sent: 0 }), "a sign-in not in the users list");
  list = [{ id: 1, email: "", isOwner: true }];
  eq(JSON.stringify(await go("Bearer stranger")), JSON.stringify({ status: 403, sent: 0 }), "v7.37.0 (AUD3-A3): no owner linked = setup — no live invoice issued");
  });
  await t("AUD-49 (v7.21.1): any other request is refused", async () => {
    setEnv({ ...SUPA, FAKTUROWNIA_API_TOKEN: "SECRET", FAKTUROWNIA_SUBDOMAIN: "acme" }); calls.length = 0; mockFetch((u, i) => session(u, i) || answer(200, {}));
    eq((await run({ query: { op: "clients" }, headers: { authorization: "Bearer good" } })).status, 400); eq((await run({ method: "DELETE", query: { op: "invoices" }, headers: { authorization: "Bearer good" } })).status, 400); eq(fkt().length, 0);
  });
  await t("AUD-49 (v7.21.1): the browser side — no token anywhere in the app's code; a token an older build left is removed on the first read; calls go to the server part with the sign-in, never with a token", async () => {
    require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", jsx: "react-jsx", esModuleInterop: true, target: "es2019" } });
    const mem = {}; global.window = { localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } } };
    mem["marianna-erp:v1:fakturowniaConfig"] = JSON.stringify({ subdomain: "acme", apiToken: "OLD-TOKEN", liveWriteEnabled: true });
    mem["marianna:shared:session"] = JSON.stringify({ access_token: "good", refresh_token: "r", expires_at: Date.now() + 3600e3, email: "owner@example.com" });
    setEnv({ REACT_APP_SUPABASE_URL: "https://proj.supabase.co", REACT_APP_SUPABASE_ANON_KEY: "anon" });
    const F = require(path.resolve("./src/fakturownia"));
    eq(F.readFakturowniaConfig(), { liveWriteEnabled: true }); ok(!/OLD-TOKEN|apiToken|subdomain/.test(mem["marianna-erp:v1:fakturowniaConfig"]), "the old token stayed in the browser");
    calls.length = 0; mockFetch(async () => answer(200, [{ id: 1 }]));
    const r = await F.fetchInvoices(F.readFakturowniaConfig(), { income: 0, period: "last_month" }); ok(r.ok, r.error);
    ok(/^\/api\/fakturownia\?op=invoices&/.test(calls[0].url), calls[0].url); eq(calls[0].init.headers.Authorization, "Bearer good"); ok(!/api_token/.test(calls[0].url), "a token in the call");
    const src = ["fakturownia.ts", "invoicing.ts", "Invoices.tsx", "Settings.tsx", "SalesOrders.tsx"].map(f => fs.readFileSync(path.resolve("./src/" + f), "utf8")).join("\n");
    ok(!/apiToken:|\.apiToken|fktToken|paste API token/.test(src), "the browser code still handles a token");   // only the clean-up of an old one names it ok(!/fakturowniaBase\(/.test(src), "the browser still calls Fakturownia directly");
  });
  await t("A-INV-2 (v7.26.6): an invoice's PDF is read with the server's token and handed back as a PDF — only for a numeric Fakturownia id; the token never comes back; the browser asks through the server part", async () => {
    setEnv({ ...SUPA, FAKTUROWNIA_API_TOKEN: "SECRET", FAKTUROWNIA_SUBDOMAIN: "acme", REACT_APP_ENV_LABEL: "TEST" }); calls.length = 0;
    mockFetch((u, i) => session(u, i) || (u.includes("/rest/v1/stores?key=eq.users") ? answer(200, [{ data: [] }]) : { ok: true, status: 200, arrayBuffer: async () => Buffer.from("%PDF-1.4 test"), text: async () => "%PDF-1.4 test" }));   // v7.40.0 (AUD3-A4): the reads ask for the users list too
    const r = await run({ query: { op: "pdf", id: "1234" }, headers: { authorization: "Bearer good" } });
    eq(r.status, 200); eq(r.headers["content-type"], "application/pdf"); ok(/%PDF/.test(r.raw), "not the PDF"); ok(!/SECRET/.test(r.raw), "the token came back");
    const u = new URL(fkt()[0].url); eq(u.origin + u.pathname, "https://acme.fakturownia.pl/invoices/1234.pdf"); eq(u.searchParams.get("api_token"), "SECRET");
    const bad = await run({ query: { op: "pdf", id: "1234/../clients" }, headers: { authorization: "Bearer good" } }); eq(bad.status, 400);
    const anon = await run({ query: { op: "pdf", id: "1234" }, headers: {} }); eq(anon.status, 401);
  });

  console.log(`SERVER PART: ${passed} passed, ${failed} failed`); if (failed) process.exit(1);
})();
