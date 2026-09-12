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
  const own = FX_SETTINGS[String(currency).toUpperCase()]; if (own) return own;
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
export async function fetchNbpRates(): Promise<Record<string, number> | null> {
  try {
    const r = await fetch("https://api.nbp.pl/api/exchangerates/tables/A?format=json");
    if (!r.ok) return null;
    const j = await r.json(); const rates = (j?.[0]?.rates || []) as any[];
    const out: Record<string, number> = {};
    rates.forEach((x: any) => { const c = String(x.code || "").toUpperCase(); const m = Number(x.mid); if (["EUR", "USD", "GBP", "HUF", "CZK"].includes(c) && isFinite(m) && m > 0) out[c] = Math.round(m * 10000) / 10000; });
    return Object.keys(out).length ? { ...out, _date: (j?.[0]?.effectiveDate ? Number(String(j[0].effectiveDate).replace(/-/g, "")) : 0) } as any : null;
  } catch { return null; }
}
