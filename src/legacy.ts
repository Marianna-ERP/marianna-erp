// ─────────────────────────────────────────────────────────────────────────────
// legacy.ts — v6.99.67 (A-AUD-1, owner) · the readers of RETIRED mirror fields, gathered in one place
// Each accessor reads the SOURCE first and the retired mirror only as a fallback for data written before the mirror was
// retired. When the DDL drops a mirror column (freeze item F-1), the fallback is deleted HERE and nowhere else.
// Mirrors and their sources:  paymentTermsDays → terms.paymentDays (v6.99.23/45)   ·   people[] → contacts[] (v6.99.45)
//                             grade → quality (v6.99.27)   ·   unit.qtyKg → unit.load[] (v6.99.8)   ·   address text → addr (v6.99.40)
// ─────────────────────────────────────────────────────────────────────────────
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : 0; };

/** Payment days of a counterparty: the terms first, the retired flat field only for old records. */
export function paymentDaysOf(cp: any): number {
  const t = cp?.terms || {};
  if (num(t.paymentDays) > 0) return num(t.paymentDays);
  return num(cp?.paymentTermsDays);   // F-1: delete this line when the column goes
}
/** The people of a counterparty: contacts[] first, the retired people[] for old records. */
export function peopleOf(cp: any): any[] {
  if (Array.isArray(cp?.contacts) && cp.contacts.length) return cp.contacts;
  return Array.isArray(cp?.people) ? cp.people : [];   // F-1
}
/** The class of a line or a lot: quality first, the retired grade for old records. */
export function qualityOf(x: any): string {
  return String(x?.quality || x?.grade || "");   // F-1: drop `grade`
}
