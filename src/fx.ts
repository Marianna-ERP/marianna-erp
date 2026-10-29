import { addDaysISO, localTodayISO } from "./dates";   // v7.13.0: no UTC-date arithmetic outside dates.ts
// ─── FX RATES — SINGLE SOURCE OF TRUTH ──────────────────────────────────────
//
// Default reference rates to PLN, used ONLY as a fallback when a document hasn't
// captured its own rate yet (e.g. a freshly imported cost line, an estimated
// shipment cost). Whenever a document has its own `fxRate` — a PO's locked rate,
// an invoice's stated rate — that always takes precedence; these are just the
// seed defaults so the same numbers aren't hardcoded inconsistently across modules
// (previously 4.25/3.9 in some files, 4.2531/3.8812 in others).
//
// When a real FX feed or a Settings-managed table is added later, only this file
// changes.

export const FX_RATES: Record<string, number> = {
  PLN: 1,
  EUR: 4.2531,
  USD: 3.8812,
};

// Resolve a default rate for a currency (1 for PLN / unknown).
/** v6.99.0 (FN-7): the owner's season rates (Settings → FX) override the hard-coded seed. */
let FX_SETTINGS: Record<string, number> = {};
export function setFxSettings(s: Record<string, any> | null | undefined) { FX_SETTINGS = {}; Object.entries(s || {}).forEach(([k, v]) => { const n = parseFloat(String(v)); if (isFinite(n) && n > 0) FX_SETTINGS[k.toUpperCase()] = n; }); }
export function defaultFxRate(currency?: string): number {
  if (!currency) return 1;
  // v7.33.2 (FX-1, owner 26 Oct): the NBP table of the last working day before today, from the per-date tables this browser keeps fresh;
  // the old 'latest table' copy in the shared settings is only a fallback while no table has been read
  const c0 = String(currency).toUpperCase(); if (c0 === "PLN") return 1;
  const known = rateBefore(NBP, c0, todayIso()); if (known && known.rate > 0) return known.rate;
  const own = FX_SETTINGS[c0]; if (own) return own;
  const r = FX_RATES[String(currency).toUpperCase()];
  return r && isFinite(r) ? r : 1;
}

// Prefer an explicitly captured rate; fall back to the default for the currency.
// Accepts strings or numbers; returns a finite positive number (>=… 1 for blanks).
export function resolveFxRate(explicit: any, currency?: string): number {
  const e = parseFloat(String(explicit ?? "").replace(",", "."));
  if (isFinite(e) && e > 0) return e;
  return defaultFxRate(currency);
}


// ── v6.99.3 (owner: FX auto): NBP table A — the official daily reference; sets the reference rates when reachable.

// ── v6.99.14 (A-R10-4, owner rule): ONE FX rule for every document ──
//   pre-filled from the reference on the day the document is created · editable until confirmed/issued · then locked with its date.
export function documentFxDefault(currency: any): number {
  const c = String(currency || "PLN").toUpperCase();
  if (c === "PLN") return 1;
  const r = defaultFxRate(c);
  return r && r !== 1 ? r : 1;
}
/** A non-PLN document still at 1.0 is not priced — the reason to refuse confirm / issue. */
export function fxMissing(currency: any, fxRate: any): string {
  const c = String(currency || "PLN").toUpperCase();
  if (c === "PLN") return "";
  const r = parseFloat(String(fxRate ?? "").replace(",", "."));
  return !isFinite(r) || Math.abs(r - 1) < 1e-9 || r <= 0 ? `The document is in ${c} but its rate to PLN is 1.0 — set the rate (Settings → Reference FX pre-fills today's NBP rate) before confirming or issuing.` : "";
}

// ══ v7.13.0 (A-AU-2, owner 9 Oct): THE NBP RATE OF THE DAY BEFORE — one rule for every document ══════════════════════════════
// Owner rulings 9 Oct: NBP (the official source) · the standard rule: the average rate of NBP table A published on the LAST
// WORKING DAY BEFORE the document's date (a weekend or a public holiday has no table, so the one before it counts) · an invoice
// takes it for its issue date, a payment for the day the money is received, an order for its order date (less / plus the safety
// buffer, v7.13.4). Tables are read from api.nbp.pl and kept in this browser (they are public facts, the same for everyone).
const NBP_KEY = "marianna:nbp:tableA:v1";
type NbpStore = { days: Record<string, Record<string, number>>; covered: Record<string, 1> };
let NBP: NbpStore = { days: {}, covered: {} };
try { if (typeof localStorage !== "undefined") { const raw = localStorage.getItem(NBP_KEY); if (raw) NBP = { days: {}, covered: {}, ...JSON.parse(raw) }; } } catch { /* a fresh cache */ }
const saveNbp = () => { try { if (typeof localStorage !== "undefined") localStorage.setItem(NBP_KEY, JSON.stringify(NBP)); } catch { /* full storage: the cache simply stays in memory */ } };
const isoAdd = (iso: string, days: number) => addDaysISO(String(iso).slice(0, 10), days);   // dates.ts: the one date arithmetic (AUD-07/09)
const todayIso = () => localTodayISO();

/** PURE. The rate of the last table published strictly BEFORE dateISO — only when every day in between is known to have been
 *  read (a gap could hide a later table). PLN is 1. null = not known yet (read the tables first). */
export function rateBefore(store: NbpStore, code: string, dateISO: string, lookbackDays = 14): { rate: number; tableDate: string } | null {
  const c = String(code || "PLN").toUpperCase(); const d = String(dateISO || "").slice(0, 10);
  if (c === "PLN") return { rate: 1, tableDate: d };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  for (let i = 1; i <= lookbackDays; i++) {
    const day = isoAdd(d, -i);
    if (!store.covered[day] && !store.days[day]) return null;   // not read yet: unknown, never a guess
    const r = store.days[day]?.[c];
    if (r && r > 0) return { rate: r, tableDate: day };
  }
  return null;
}
/** PURE. Adds NBP tables (the API's JSON) and marks [from..to] as read. */
export function addNbpTables(store: NbpStore, tables: any[], fromISO: string, toISO: string): NbpStore {
  const next: NbpStore = { days: { ...store.days }, covered: { ...store.covered } };
  (tables || []).forEach((t: any) => { const day = String(t?.effectiveDate || "").slice(0, 10); if (!day) return; const r: Record<string, number> = {};
    (t.rates || []).forEach((x: any) => { const m = Number(x?.mid); if (x?.code && isFinite(m) && m > 0) r[String(x.code).toUpperCase()] = Math.round(m * 10000) / 10000; }); next.days[day] = r; });
  for (let day = fromISO; day <= toISO; day = isoAdd(day, 1)) next.covered[day] = 1;
  return next;
}
/** Reads the tables NBP published between two dates (in 90-day pieces — the API's limit is 93), keeps them, never twice. */
export async function ensureNbpRange(fromISO: string, toISO: string): Promise<boolean> {
  const today = todayIso(); const to = toISO > today ? today : toISO;
  if (!fromISO || fromISO > to) return true;
  let ok = true;
  for (let start = fromISO; start <= to; start = isoAdd(start, 90)) {
    const end = isoAdd(start, 89) < to ? isoAdd(start, 89) : to;
    let allRead = true; for (let day = start; day <= end; day = isoAdd(day, 1)) if (!NBP.covered[day]) { allRead = false; break; }
    if (allRead) continue;
    try {
      const r = await fetch(`https://api.nbp.pl/api/exchangerates/tables/A/${start}/${end}/?format=json`);
      if (r.status === 404) { NBP = addNbpTables(NBP, [], start, end); continue; }   // no table in that window (holidays): read, empty
      if (!r.ok) { ok = false; continue; }
      NBP = addNbpTables(NBP, await r.json(), start, end);
    } catch { ok = false; }
  }
  saveNbp(); return ok;
}
/** The rate for a document dated dateISO (async: reads the tables if needed). null when NBP cannot be reached. */
export async function nbpRateBefore(code: string, dateISO: string): Promise<{ rate: number; tableDate: string } | null> {
  const c = String(code || "PLN").toUpperCase(); if (c === "PLN") return { rate: 1, tableDate: String(dateISO || "").slice(0, 10) };
  const d = String(dateISO || "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  await ensureNbpRange(isoAdd(d, -14), isoAdd(d, -1));
  return rateBefore(NBP, c, d);
}
/** The same, from what this browser has already read (sync, for screens). */
export function nbpRateBeforeKnown(code: string, dateISO: string): { rate: number; tableDate: string } | null { return rateBefore(NBP, code, dateISO); }
/** For the tests: start from a given cache. */
export function __setNbpStore(s: NbpStore) { NBP = { days: { ...(s?.days || {}) }, covered: { ...(s?.covered || {}) } }; }

// ── v7.13.4 (A-AU-2): the safety buffer on ORDERS only — set once in Settings → Reference FX (owner: "a buffer", 9 Oct) ──
// A sale is priced at the NBP rate less the buffer (the euro may be weaker when paid); a purchase at the rate plus it.
// Invoices and payments never take a buffer: they carry the legal rate.
export function orderBufferPct(): number { const b = FX_SETTINGS["_BUFFERPCT"]; return isFinite(b) && b >= 0 && b < 50 ? b : 0; }
export function orderRateFrom(nbp: number, side: "SALE" | "PURCHASE", bufferPct = orderBufferPct()): number {
  if (!(nbp > 0)) return 0; const k = side === "SALE" ? 1 - bufferPct / 100 : 1 + bufferPct / 100;
  return Math.round(nbp * k * 10000) / 10000;
}

// ── v7.33.2 (FX-1, owner 26 Oct: "the NBP box referred to table A of 06/10 until I refreshed the browser"): ONE RULE FOR EVERY RATE — the NBP
// table A of the last working day before the record's own date. The tables are read for the last fortnight when the app starts, again when
// the day changes and when the window comes back into view, so no rate is ever taken from a table older than the record's date. ──
/** The NBP rate for a record dated dateISO (today when none), from the tables already read; null when not read yet. */
export function fxRateFor(currency: any, dateISO?: string): number | null {
  const c = String(currency || "PLN").toUpperCase(); if (c === "PLN") return 1;
  const d = /^\d{4}-\d{2}-\d{2}/.test(String(dateISO || "")) ? String(dateISO).slice(0, 10) : todayIso();
  const r = rateBefore(NBP, c, d); return r && r.rate > 0 ? r.rate : null;
}
/** The newest table this browser holds, and how many days it covers (for the Settings box). */
export function nbpHeld(): { latest: string; days: number } { const days = Object.keys(NBP.days || {}).sort(); return { latest: days[days.length - 1] || "", days: days.length }; }
/** Keep the last fortnight's tables read (the start, a new day, the window back in view); resolves true when NBP answered. */
export async function refreshNbp(): Promise<boolean> { const today = todayIso(); return ensureNbpRange(isoAdd(today, -14), today); }

/** v7.44.0 (AUD3-L2, external audit: "a missing exchange rate silently means 1.0 in about 45 places"): THE RATE OF A RECORD — PLN is 1;
 *  a foreign-currency record's own rate when it is a real one (above 1 — no EUR or USD rate is ever 1); otherwise the NBP rate of its own
 *  date (the last working day before it), else the reference rate — never 1 for a foreign currency. */
export function rateOf(rec: any): number {
  const cur = String(rec?.currency || "PLN").toUpperCase(); if (cur === "PLN") return 1;
  const own = Number(String(rec?.fxRate ?? "").replace(",", ".")); if (own > 0 && own !== 1) return own;
  const d = String(rec?.date || rec?.issueDate || rec?.sellDate || rec?.orderDate || rec?.saleDate || "").slice(0, 10);
  return fxRateFor(cur, d || undefined) ?? defaultFxRate(cur);
}
