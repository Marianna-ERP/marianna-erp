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
