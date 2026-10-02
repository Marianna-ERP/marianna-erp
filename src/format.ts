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
export const r2 = (v: number) => Math.round(v * 100) / 100;
export const r0 = (v: number) => Math.round(v);

// ── v6.99.74 (A-DT-1, owner 28 Sept): a date must exist. "31/06/2026" was stored as 2026-06-31 because the one date
// control checked only 1–31 for the day; PO-2026-0041 and its two lots carried it. One rule, used by the control and the check.
export function daysInMonth(year: number, month: number): number { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
/** True for a real calendar day ("2026-06-30"), false for "2026-06-31" or "2026-02-30"; a trailing time is allowed. */
export function isRealISODate(v: any): boolean {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/); if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

// v6.99.89 (A-NM-1, owner ruling 1 Oct): the stored status "Cancelled" is shown as "Withdrawn" on every screen, print and
// export — Cancel only ever means "go back". The stored value stays (many checks read it; the data is not migrated).
export function statusWord(s: any): string { const v = String(s ?? ""); return v === "Cancelled" ? "Withdrawn" : v.replace(/\bCancelled\b/g, "Withdrawn"); }
