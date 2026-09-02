// ── BUDGETS (v6.79.0, F-6) ───────────────────────────────────────────────────
// Owner ruling: a budgets table now ("may not be used now but will become
// handy later"). Monthly targets per measure; variance derives from actuals.
export type BudgetMeasure = "revenue" | "contribution" | "overhead" | "net";
export const BUDGET_MEASURES: BudgetMeasure[] = ["revenue", "contribution", "overhead", "net"];

export interface Budget { id: any; period: string; measure: BudgetMeasure; amountPLN: number; note?: string; }

const n = (v: any) => { const x = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

/** One budget per (period, measure) — setting it again replaces. */
export function upsertBudget(budgets: Budget[], b: Budget): Budget[] {
  const rest = (budgets || []).filter(x => !(x.period === b.period && x.measure === b.measure));
  return [...rest, { ...b, amountPLN: r2(n(b.amountPLN)) }].sort((a, c) => a.period.localeCompare(c.period) || a.measure.localeCompare(c.measure));
}

export interface BudgetVariance { period: string; measure: BudgetMeasure; budgetPLN: number; actualPLN: number; variancePLN: number; variancePct: number | null; }

/** Budget vs actual for one period. `actuals` come from the P/L aggregate. */
export function budgetVariance(budgets: Budget[], period: string, actuals: Partial<Record<BudgetMeasure, number>>): BudgetVariance[] {
  return (budgets || []).filter(b => b.period === period).map(b => {
    const actual = r2(n(actuals[b.measure]));
    const variance = r2(actual - n(b.amountPLN));
    return { period, measure: b.measure, budgetPLN: n(b.amountPLN), actualPLN: actual, variancePLN: variance,
      variancePct: n(b.amountPLN) ? r2(variance / Math.abs(n(b.amountPLN)) * 100) : null };
  });
}
