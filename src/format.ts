// ─────────────────────────────────────────────────────────────────────────────
// format.ts — shared number formatting (Consolidation Batch 2, R4)
//
// Canonical fmtNum (pl-PL locale) — was byte-identical in Inventory and
// Dashboard; those two now import it. The other modules' fmtNum/fmtMoney
// variants had drifted (different decimals/suffixes) and converge during their
// screen-rebuild batches — logged in the tracker, not silently changed here.
// ─────────────────────────────────────────────────────────────────────────────

export function fmtNum(n: any): string {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return Number(n).toLocaleString("pl-PL");
}

/** Money in PLN with thousands separators, no decimals (dashboard/inventory style). */

// ── v6.99.67 (A-AUD-1, owner): the helpers that were copied byte-for-byte into many files live here once. Only IDENTICAL
// copies were folded in; `num` exists in six flavours (they parse typed numbers differently) and stays per module until
// each flavour is reviewed — a parser is behaviour, not a duplicate.
export const S = (v: any) => String(v ?? "").trim();
export const r2 = (v: number) => { const n = Math.round(Number(v) * 100) / 100; return Number.isFinite(n) ? n : 0; };   // v6.99.146 (AUD-48): never NaN
export const r0 = (v: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };

// ── v6.99.74 (A-DT-1, owner 28 Sept): a date must exist. "31/06/2026" was stored as 2026-06-31 because the one date
// control checked only 1–31 for the day; PO-2026-0041 and its two lots carried it. One rule, used by the control and the check.
export function daysInMonth(year: number, month: number): number { const y = Number(year), m = Number(month); if (!Number.isFinite(y) || !Number.isFinite(m)) return 0; return new Date(Date.UTC(y, m, 0)).getUTCDate(); }   // v6.99.146 (AUD-48): never NaN
/** True for a real calendar day ("2026-06-30"), false for "2026-06-31" or "2026-02-30"; a trailing time is allowed. */
export function isRealISODate(v: any): boolean {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/); if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

// v6.99.99 (A-DEL-4, owner ruling 2 Oct): the stored status "Cancelled" is shown as "Deleted" on every screen, print and
// export — a deleted record stays on record, struck through, read-only. Cancel only ever means "go back". The stored value stays.
export function statusWord(s: any): string { const v = String(s ?? ""); return v === "Cancelled" ? "Deleted" : v.replace(/\bCancelled\b/g, "Deleted"); }   // v6.99.99 (A-DEL-4, owner ruling 2 Oct): the state word is DELETED

// v6.99.143 (AUD-47): a movement note names a document only as a WHOLE number — "SHP-2026-003" must not match "SHP-2026-0033"
export function noteNames(note: any, number: any): boolean {
  const n = String(number || "").trim(); if (!n) return false;
  const t = String(note || ""); const i = t.indexOf(n); if (i < 0) return false;
  const before = t[i - 1], after = t[i + n.length];
  return !(before && /[0-9A-Za-z]/.test(before)) && !(after && /[0-9]/.test(after));
}
