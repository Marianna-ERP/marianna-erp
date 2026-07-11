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
export function fmtPLN0(n: any): string {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return `${Math.round(Number(n)).toLocaleString("pl-PL")} PLN`;
}
