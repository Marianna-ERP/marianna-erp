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
export function defaultFxRate(currency?: string): number {
  if (!currency) return 1;
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
