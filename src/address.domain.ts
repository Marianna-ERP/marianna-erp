// ─────────────────────────────────────────────────────────────────────────────
// address.domain.ts — v6.99.40 (A-ADDR, owner proposal 18 Sept)
// An address is FOUR facts, not one string: street (with number) · postcode · city · country.
// Storing them together is why a document cannot print a proper three-line address, why Fakturownia's
// four fields had to be flattened, and why a city could not be filtered. One shape, one formatter,
// one parser for what we already hold — the original text is kept until the DDL (declared mirror).
// ─────────────────────────────────────────────────────────────────────────────
const S = (v: any) => String(v ?? "").trim();

export interface Address { street?: string; postcode?: string; city?: string; country?: string; note?: string; }

/** Is there anything in it? */
export function hasAddress(a: any): boolean {
  return !!(a && (S(a.street) || S(a.postcode) || S(a.city) || S(a.note)));
}

/** The document form: three lines — street / postcode city / country. Empty parts are skipped, never printed blank. */
export function formatAddress(a: Address | null | undefined, opts: { oneLine?: boolean; withCountry?: boolean } = {}): string {
  if (!a) return "";
  const withCountry = opts.withCountry !== false;
  const l1 = S(a.street);
  const l2 = [S(a.postcode), S(a.city)].filter(Boolean).join(" ");
  const l3 = withCountry ? S(a.country) : "";
  const lines = [l1, l2, l3, S(a.note)].filter(Boolean);
  return opts.oneLine ? lines.join(", ") : lines.join("\n");
}

/** The short form for lists and pickers: city, country. */
export function shortAddress(a: Address | null | undefined): string {
  if (!a) return "";
  return [S(a.city), S(a.country)].filter(Boolean).join(", ");
}

/**
 * Split a legacy one-line address. Two anchors, in order:
 *   · a Polish postcode  NN-NNN   → "ul. Piękna 13, 05-555 Tarczyn"
 *   · any 4–6 digit postcode      → "Shkilna 3, 45043 Kovel district"
 * Whatever does not split keeps its whole text in `street` and is marked needsCheck — a market
 * address or a PO box is a real address even without a postcode, and must not be mangled to fit a form.
 */
export function parseAddress(text: any, country?: any): Address & { needsCheck: boolean } {
  const raw = S(text).replace(/\s*\n\s*/g, ", ").replace(/\s{2,}/g, " ");
  const base = { country: S(country) || "" };
  if (!raw) return { ...base, needsCheck: false };
  const pl = raw.match(/^(.*?)[,\s]+(\d{2}-\d{3})\s+([^,]+?)(?:,\s*(.*))?$/);
  const intl = raw.match(/^(.*?)[,\s]+(\d{4,6})\s+([^,]+?)(?:,\s*(.*))?$/);
  const m = pl || intl;
  if (m) {
    const street = S(m[1]).replace(/,\s*$/, "");
    const note = S(m[4]);
    return { ...base, street, postcode: S(m[2]), city: S(m[3]).replace(/,\s*$/, ""), note: note || undefined, needsCheck: false };
  }
  return { ...base, street: raw, needsCheck: true };
}

/** One-time migration for a record that carries a legacy `address` string. Idempotent. */
export function migrateAddressOn(rec: any, textField = "address"): { rec: any; changed: boolean } {
  if (!rec || typeof rec !== "object") return { rec, changed: false };
  if (rec.addr && (S(rec.addr.street) || S(rec.addr.city) || S(rec.addr.postcode))) return { rec, changed: false };
  const text = S(rec[textField]);
  if (!text) return { rec, changed: false };
  const parsed = parseAddress(text, rec.country);
  const addr: Address = { street: parsed.street, postcode: parsed.postcode, city: parsed.city, country: parsed.country || S(rec.country), note: parsed.note };
  return { rec: { ...rec, addr, addressNeedsCheck: parsed.needsCheck || undefined }, changed: true };
}

/** The line a document prints for a party or a place: its name, then its address. */
export function addressOf(rec: any): Address {
  if (rec?.addr && hasAddress(rec.addr)) return rec.addr as Address;
  const p = parseAddress(rec?.address, rec?.country);
  return { street: p.street, postcode: p.postcode, city: p.city, country: p.country, note: p.note };
}
