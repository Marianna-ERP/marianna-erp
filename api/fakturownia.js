// ─── v7.21.1 (AUD-49, owner 11 Oct): THE ONLY PLACE THE FAKTUROWNIA TOKEN IS READ ─────────────────────────────────────────
// A small server part of the app, run by Vercel next to the pages. The token is a hidden Vercel setting (FAKTUROWNIA_API_TOKEN,
// with FAKTUROWNIA_SUBDOMAIN = the account's address part); no browser ever holds it. Every request must carry the caller's
// sign-in (the Supabase session token of the shared data), checked with Supabase before anything is forwarded. Only the calls
// the app makes are allowed: read invoices, read departments (bank accounts), test, read an invoice's PDF (v7.26.6), and create an invoice — never on the TEST
// copy (REACT_APP_ENV_LABEL=TEST). Answers never contain the token.
const GET_PATHS = { invoices: "/invoices.json", departments: "/departments.json", test: "/invoices.json" };
const PASS_PARAMS = ["page", "per_page", "period", "date_from", "date_to", "income", "search"];
const env = k => String(process.env[k] || "").trim();
function originOf(v) { const t = String(v || "").trim(); if (!t) return ""; try { return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`).origin; } catch { return t.replace(/\/+$/, ""); } }
function send(res, status, obj) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(obj)); }
function queryOf(req) { if (req.query && typeof req.query === "object") return req.query; try { return Object.fromEntries(new URL(req.url || "/", "http://local").searchParams); } catch { return {}; } }
async function bodyOf(req) {
  if (req.body !== undefined && req.body !== null) { if (typeof req.body === "string") { try { return JSON.parse(req.body || "{}"); } catch { return null; } } return req.body; }
  return new Promise(resolve => { let s = ""; req.on("data", c => { s += c; }); req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch { resolve(null); } }); req.on("error", () => resolve(null)); });
}
// v7.30.1 (Batch M · M-2, external audit 21 Oct: F-04): the caller is known, not only signed in — the sign-in's e-mail comes back
async function signedIn(req) {
const m = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || "").match(/^Bearer\s+(\S+)$/i);
const url = originOf(env("REACT_APP_SUPABASE_URL")), key = env("REACT_APP_SUPABASE_ANON_KEY");
if (!m || !url || !key) return null;
try { const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${m[1]}` } }); if (!r.ok) return null;
let u = null; try { u = await r.json(); } catch { u = null; } return { token: m[1], email: String((u && u.email) || "").trim().toLowerCase() }; } catch { return null; }
}
// v7.30.1 (Batch M · M-2): MAY THIS PERSON ISSUE A LIVE INVOICE — the users list of the shared copy (Settings › Users), read with the
// caller's own sign-in: the owner, or a user with the Invoices module ticked. With no owner linked yet the users model is off and
// everyone may, as in the app itself.
// v7.40.0 (AUD3-A4, external audit: "reading invoices, bank accounts and PDFs needs a sign-in only"): reads need the same rights as issuing —
// the owner or a user with the Invoices module; while no owner is linked (setup) a signed-in person may still read
async function mayReadInvoices(who) {
const url = originOf(env("REACT_APP_SUPABASE_URL")), key = env("REACT_APP_SUPABASE_ANON_KEY");
try {
const r = await fetch(`${url}/rest/v1/stores?key=eq.users&select=data`, { headers: { apikey: key, Authorization: `Bearer ${who.token}`, Accept: "application/json" } });
if (!r.ok) return false;
const rows = await r.json(); const users = Array.isArray(rows) && rows[0] && Array.isArray(rows[0].data) ? rows[0].data : [];
if (!users.some(u => u && u.isOwner && String(u.email || "").trim() !== "")) return true;
const me = users.find(u => u && String(u.email || "").trim().toLowerCase() === who.email);
return !!(me && (me.isOwner || (me.modules && me.modules.invoices === true)));
} catch { return false; }
}
async function mayIssueInvoices(who) {
const url = originOf(env("REACT_APP_SUPABASE_URL")), key = env("REACT_APP_SUPABASE_ANON_KEY");
try {
const r = await fetch(`${url}/rest/v1/stores?key=eq.users&select=data`, { headers: { apikey: key, Authorization: `Bearer ${who.token}`, Accept: "application/json" } });
if (!r.ok) return false;
const rows = await r.json(); const users = Array.isArray(rows) && rows[0] && Array.isArray(rows[0].data) ? rows[0].data : [];
const linkedOwner = users.some(u => u && u.isOwner && String(u.email || "").trim() !== "");
if (!linkedOwner) return false;   // v7.37.0 (AUD3-A3): no linked owner = setup, and setup never issues a live invoice
const me = users.find(u => u && String(u.email || "").trim().toLowerCase() === who.email);
return !!(me && (me.isOwner || (me.modules && me.modules.invoices === true)));
} catch { return false; }
}
const detailOf = d => (d ? ` Details: ${(typeof d === "string" ? d : JSON.stringify(d.message ?? d.errors ?? d)).slice(0, 400)}` : "");
module.exports = async function handler(req, res) {
  try {
    const who = await signedIn(req);
    if (!who) return send(res, 401, { error: "Sign in to MARIANNA first." });
    const q = queryOf(req); const op = String(q.op || "");
    const token = env("FAKTUROWNIA_API_TOKEN");
    const sub = env("FAKTUROWNIA_SUBDOMAIN").replace(/^https?:\/\//i, "").replace(/\.fakturownia\.pl.*$/i, "").replace(/\/.*$/, "");
    const testCopy = /^test$/i.test(env("REACT_APP_ENV_LABEL"));
    if (op === "status") return send(res, 200, { configured: !!(token && sub), account: sub ? `${sub}.fakturownia.pl` : "", testCopy });
    if (!token || !sub) return send(res, 503, { error: "Fakturownia isn't connected yet: the settings FAKTUROWNIA_API_TOKEN and FAKTUROWNIA_SUBDOMAIN are missing in Vercel. Until then, use the file import." });
    const base = `https://${sub}.fakturownia.pl`;
    if (req.method === "GET" && (GET_PATHS[op] || op === "pdf") && !(await mayReadInvoices(who))) return send(res, 403, { error: "Only the owner or a user with the Invoices module (Settings › Users) can read Fakturownia." });   // v7.40.0 (AUD3-A4)
    if (req.method === "GET" && GET_PATHS[op]) {
      const url = new URL(base + GET_PATHS[op]);
      if (op === "test") { url.searchParams.set("page", "1"); url.searchParams.set("per_page", "1"); url.searchParams.set("period", "this_month"); }
      else PASS_PARAMS.forEach(p => { const v = q[p]; if (v !== undefined && v !== null && v !== "") url.searchParams.set(p, String(v)); });
      url.searchParams.set("api_token", token);
      const r = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch { data = null; }
      if (!r.ok) return send(res, r.status, { error: r.status === 401 ? "Fakturownia refused the token kept in Vercel — check FAKTUROWNIA_API_TOKEN." : `Fakturownia answered HTTP ${r.status}.` });
      if (op === "test") return send(res, 200, { count: Array.isArray(data) ? data.length : 0, account: `${sub}.fakturownia.pl` });
      return send(res, 200, data);
    }
    // v7.26.6 (A-INV-2, owner 17 Oct): an invoice's PDF, to keep in the company's folder -- read-only, so the TEST copy may ask too
    if (req.method === "GET" && op === "pdf") {
      const id = String(q.id || ""); if (!/^\d{1,12}$/.test(id)) return send(res, 400, { error: "No Fakturownia invoice id." });
      const r = await fetch(`${base}/invoices/${id}.pdf?api_token=${encodeURIComponent(token)}`, { headers: { Accept: "application/pdf" } });
      if (!r.ok) return send(res, r.status, { error: r.status === 401 ? "Fakturownia refused the token kept in Vercel -- check FAKTUROWNIA_API_TOKEN." : `Fakturownia answered HTTP ${r.status} for the PDF.` });
      const buf = Buffer.from(await r.arrayBuffer());
      res.statusCode = 200; res.setHeader("Content-Type", "application/pdf"); res.setHeader("Cache-Control", "no-store"); res.end(buf); return;
    }
    if (req.method === "POST" && op === "create") {
      if (testCopy) return send(res, 403, { error: "This is the TEST copy: invoices are never created in Fakturownia from here." });
      if (!(await mayIssueInvoices(who))) return send(res, 403, { error: "Only the owner or a user with the Invoices module (Settings › Users) can issue an invoice in Fakturownia." });   // v7.30.1 (M-2)
      const body = await bodyOf(req); if (!body || typeof body !== "object" || !body.invoice) return send(res, 400, { error: "No invoice in the request." });
      const inv = { ...body.invoice }; const kind = String(inv.kind || "vat");
      if (!["vat", "correction"].includes(kind)) return send(res, 400, { error: `This server issues only VAT invoices and corrections, not "${kind}".` });   // v7.40.0 (AUD3-A4)
      inv.gov_save_and_send = false;   // v7.40.0 (AUD3-A4): never sent to KSeF from here — KSeF stays a deliberate step in Fakturownia
      const payload = { invoice: inv };
      const r = await fetch(`${base}/invoices.json`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ ...payload, api_token: token }) });
      const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch { data = text || null; }
      if (!r.ok) return send(res, r.status, { error: (r.status === 422 ? "Fakturownia rejected the invoice data (HTTP 422)." : r.status === 401 ? "Fakturownia refused the token kept in Vercel — it may be read-only." : `Fakturownia answered HTTP ${r.status}.`) + detailOf(data) });
      return send(res, 200, data);
    }
    // v7.48.0 (INV2-7, owner decision 29 Oct — ONE REGISTER: every purchase invoice, foreign ones included, ends in Fakturownia): a purchase
    // invoice entered in the ERP (a foreign supplier's) is registered in Fakturownia as an expense (income 0), never sent to KSeF from here
    if (req.method === "POST" && op === "expense") {
      if (testCopy) return send(res, 403, { error: "This is the TEST copy: nothing is registered in Fakturownia from here." });
      if (!(await mayIssueInvoices(who))) return send(res, 403, { error: "Only the owner or a user with the Invoices module (Settings › Users) can register an invoice in Fakturownia." });
      const body = await bodyOf(req); if (!body || typeof body !== "object" || !body.invoice) return send(res, 400, { error: "No invoice in the request." });
      const inv = { ...body.invoice, income: "0", kind: "vat", gov_save_and_send: false };
      const r = await fetch(`${base}/invoices.json`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ invoice: inv, api_token: token }) });
      const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch { data = text || null; }
      if (!r.ok) return send(res, r.status, { error: r.status === 422 ? "Fakturownia rejected the purchase invoice's data (HTTP 422)." : `Fakturownia answered HTTP ${r.status}.` });
      return send(res, 200, data);
    }
    return send(res, 400, { error: "Not an allowed Fakturownia request." });
  } catch (e) { return send(res, 502, { error: "Fakturownia could not be reached from the server." }); }
};
