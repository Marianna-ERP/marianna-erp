// ── v6.99.0 (FN-1/FN-2/FN-3): PERIOD CLOSE, MANAGEMENT SNAPSHOT, CASH PROJECTION ──
const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface ClosedPeriod { period: string; closedAt: string; closedBy: string; snapshot: any; }
export function isDateInClosedPeriod(dateISO: any, closed: ClosedPeriod[]): string | null {
  const p = S(dateISO).slice(0, 7); if (!p) return null;
  return (closed || []).some(c => c.period === p) ? p : null;
}
/** FN-1 guard for any money document: creating or changing one dated inside a closed month is refused. */
export function periodGuard(dateISO: any, closed: ClosedPeriod[]): string {
  const p = isDateInClosedPeriod(dateISO, closed);
  return p ? `Period ${p} is CLOSED — its figures were frozen for the accountant. Date the document in the open month, or ask the owner to re-open ${p}.` : "";
}
/** FN-2 snapshot: the numbers the package prints, frozen at close. */
export function buildSnapshot(period: string, inp: { totalAgg: any; ledgerTotals: any; stockKg: number; stockValuePLN: number; openClaims: number; settlementsClosed: number; realizedFxPLN: number; bankBalances: Array<{ label: string; currency: string; balance: number | null }> }): any {
  return { period, revenuePLN: r2(num(inp.totalAgg?.totalRevenuePLN)), cogsPLN: r2(num(inp.totalAgg?.totalCOGSPLN)), directPLN: r2(num(inp.totalAgg?.totalDirectPLN)), contributionPLN: r2(num(inp.totalAgg?.totalContributionPLN)), overheadPLN: r2(num(inp.totalAgg?.totalOverheadPLN)), netPLN: r2(num(inp.totalAgg?.totalNetMarginPLN)),
    receivableOpenPLN: r2(num(inp.ledgerTotals?.receivableOpenPLN)), receivableOverduePLN: r2(num(inp.ledgerTotals?.receivableOverduePLN)), payableOpenPLN: r2(num(inp.ledgerTotals?.payableOpenPLN)), payableOverduePLN: r2(num(inp.ledgerTotals?.payableOverduePLN)),
    stockKg: Math.round(num(inp.stockKg)), stockValuePLN: r2(num(inp.stockValuePLN)), openClaims: inp.openClaims, settlementsClosed: inp.settlementsClosed, realizedFxPLN: r2(num(inp.realizedFxPLN)), bankBalances: inp.bankBalances };
}
/** FN-3: cash projection — receivables in, payables out, by due-date bucket from today. */
export function cashProjection(invoices: any[], todayISO: string): { buckets: Array<{ label: string; inPLN: number; outPLN: number; netPLN: number }>; overdueInPLN: number; overdueOutPLN: number } {
  const b = [{ label: "0–30 days", from: 0, to: 30 }, { label: "31–60 days", from: 31, to: 60 }, { label: "61–90 days", from: 61, to: 90 }, { label: "later", from: 91, to: 1e9 }];
  const out = b.map(x => ({ label: x.label, inPLN: 0, outPLN: 0, netPLN: 0 }));
  let overdueIn = 0, overdueOut = 0;
  (invoices || []).forEach(inv => {
    if (!inv || inv.isProforma || ["Cancelled", "Draft"].includes(inv.paymentStatus)) return;
    const open = r2((num(inv.grossAmount) - num(inv.paidAmount)) * (num(inv.fxRate) || 1)); if (open <= 0.005) return;
    const due = S(inv.dueDate) || S(inv.issueDate); const days = due ? Math.round((new Date(due).getTime() - new Date(todayISO).getTime()) / 86400000) : 0;
    const isIn = inv.kind === "SALES";
    if (days < 0) { if (isIn) overdueIn += open; else overdueOut += open; return; }
    const i = b.findIndex(x => days >= x.from && days <= x.to); const k = i < 0 ? out.length - 1 : i;
    if (isIn) out[k].inPLN += open; else out[k].outPLN += open;
  });
  out.forEach(x => { x.inPLN = r2(x.inPLN); x.outPLN = r2(x.outPLN); x.netPLN = r2(x.inPLN - x.outPLN); });
  return { buckets: out, overdueInPLN: r2(overdueIn), overdueOutPLN: r2(overdueOut) };
}
