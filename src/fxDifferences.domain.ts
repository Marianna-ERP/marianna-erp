// fxDifferences.domain.ts — v7.27.16 (FZ-06, owner decision 17 Oct): REALISED EXCHANGE DIFFERENCES.
// The invoice locks its rate when it is issued; each payment locks its own rate when it is booked. The difference between the two,
// on the amount paid, is the realised gain or loss in PLN: a sale paid at a higher rate than invoiced is a gain, a purchase paid at
// a higher rate is a loss. Payments without a rate of their own are counted, not guessed.
import { parseNum } from "./numbers";

const S = (v: any) => String(v ?? "").trim();
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface FxDifferenceRow { date: string; month: string; invoice: string; counterparty: string; kind: "SALES" | "COST"; currency: string; amount: number; invoiceRate: number; paymentRate: number; diffPLN: number }

export function fxDifferences(invoices: any[]): { rows: FxDifferenceRow[]; gainsPLN: number; lossesPLN: number; netPLN: number; byMonth: Array<{ month: string; netPLN: number }>; paymentsWithoutRate: number } {
  const rows: FxDifferenceRow[] = []; let withoutRate = 0;
  (invoices || []).forEach((inv: any) => {
    const cur = S(inv?.currency).toUpperCase(); const invRate = parseNum(inv?.fxRate);
    if (!inv || !cur || cur === "PLN" || !(invRate > 0) || inv.isProforma || S(inv.paymentStatus) === "Cancelled") return;
    const kind: "SALES" | "COST" = inv.kind === "SALES" ? "SALES" : "COST";
    (inv.payments || []).forEach((p: any) => {
      if (!p || p.voided) return;
      const payRate = parseNum(p.settlementFxRate ?? p.fxRate ?? p.rate); const amount = parseNum(p.amount);
      if (!(amount > 0)) return;
      if (!(payRate > 0)) { withoutRate++; return; }
      const sign = kind === "SALES" ? 1 : -1;
      const date = S(p.date).slice(0, 10);
      rows.push({ date, month: date.slice(0, 7), invoice: S(inv.number), counterparty: S(inv.counterparty?.name), kind, currency: cur, amount, invoiceRate: invRate, paymentRate: payRate, diffPLN: r2(sign * amount * (payRate - invRate)) });
    });
  });
  rows.sort((a, b) => b.date.localeCompare(a.date));
  const gainsPLN = r2(rows.filter(x => x.diffPLN > 0).reduce((a, x) => a + x.diffPLN, 0));
  const lossesPLN = r2(rows.filter(x => x.diffPLN < 0).reduce((a, x) => a + x.diffPLN, 0));
  const months = new Map<string, number>(); rows.forEach(x => months.set(x.month, r2((months.get(x.month) || 0) + x.diffPLN)));
  return { rows, gainsPLN, lossesPLN, netPLN: r2(gainsPLN + lossesPLN), byMonth: Array.from(months.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([month, netPLN]) => ({ month, netPLN })), paymentsWithoutRate: withoutRate };
}
