// monthReport.domain.ts — v7.61.0 (RPT-M, owner approved 30 Oct): THE MONTH REPORT FOR THE ACCOUNTANT — what the month's documents say, read
// from them (one source): the P/L by the owner's lines, the month-end open balances, the month's VAT, and the checks to clear before sending.
// Each line carries the accountant's account code (Settings › Company), so the cross-check is line by line. The bank parts (balances per
// statement, bank-only costs, exchange differences) arrive with BANK-2 / BANK-3, after acceptance testing.
import { rateOf } from "./fx";
import { openOf } from "./overdue.domain";
import { OPERATIONAL_COST_CATEGORIES } from "./operationalCosts";
const num = (v: any) => { const n = Number(v); return isFinite(n) ? n : 0; }; const r2 = (v: number) => Math.round(v * 100) / 100;
const live = (i: any) => i && !i.isProforma && !["Cancelled", "Draft"].includes(String(i.paymentStatus));   // v7.62.0 (ACC-2): a pro-forma is not a document of account
const LINE_OF_CATEGORY: Record<string, string> = { GOODS: "cargo", PURCHASE: "cargo", FREIGHT: "transport", CUSTOMS: "clearance", WAREHOUSE: "warehouse", OVERHEAD: "overheads" };
export interface MonthReport { month: string; pl: Array<{ line: string; label: string; pln: number; code: string }>; result: number;
  balances: { receivablesPLN: number; payablesPLN: number }; vat: { salesVatPLN: number; purchaseVatPLN: number }; checks: Array<{ check: string; count: number }>;
  details: Array<{ date: string; document: string; party: string; nip: string; category: string; code: string; netPLN: number; vatPLN: number; grossPLN: number }> }
export function monthReport(month: string, d: { invoices?: any[]; notes?: any[]; operationalCosts?: any[]; bankLines?: any; accountCodes?: Record<string, string> }): MonthReport {
  const codes = d.accountCodes || {}; const inMonth = (s: any) => String(s || "").slice(0, 7) === month; const end = `${month}-31`;
  const sums: Record<string, number> = { revenue: 0, cargo: 0, transport: 0, clearance: 0, warehouse: 0, overheads: 0, financial: 0 }; const details: MonthReport["details"] = [];
  (d.invoices || []).filter(live).forEach((i: any) => { if (!inMonth(i.issueDate)) return; const rate = rateOf(i); const net = num(i.netAmount) * rate, vat = (num(i.grossAmount) - num(i.netAmount)) * rate;
    const line = i.kind === "SALES" ? "revenue" : (LINE_OF_CATEGORY[String(i.category || "").toUpperCase()] || "overheads"); sums[line] += net;
    const cat = i.kind === "SALES" ? "sales" : String(i.category || "").toLowerCase();
    details.push({ date: String(i.issueDate || "").slice(0, 10), document: String(i.number || ""), party: String(i.counterparty?.name || ""), nip: String(i.counterparty?.nip || i.counterparty?.taxNo || ""), category: cat, code: codes[cat === "purchase" ? "goods" : cat] || "", netPLN: r2(net), vatPLN: r2(vat), grossPLN: r2(net + vat) }); });
  (d.notes || []).forEach((n: any) => { if (!n || /Cancelled|Draft/i.test(String(n.status || "")) || !inMonth(n.date)) return; const pln = num(n.amountPLN) || num(n.amount) * rateOf(n); const sign = String(n.noteType).toUpperCase() === "DEBIT" ? 1 : -1;
    if (n.direction === "outgoing") sums.revenue += sign * pln; else sums.cargo += sign * pln; });
  (d.operationalCosts || []).forEach((c: any) => { if (!c || c.deleted || !inMonth(c.date) || String(c.source || "").startsWith("invoice:")) return; const cat = OPERATIONAL_COST_CATEGORIES.find(x => x.key === c.category); const pln = num(c.amountPLN) || num(c.amount) * rateOf(c);
    sums[cat && cat.plLine === "financial" ? "financial" : "overheads"] += pln; });
  const LABEL: Record<string, string> = { revenue: "Revenue (sales invoices less credit notes)", cargo: "Cargo (goods purchases and their corrections)", transport: "Transport", clearance: "Clearance & documents", warehouse: "Warehouse & handling", overheads: "Overheads", financial: "Financial costs" };
  const CODE: Record<string, string> = { revenue: codes.sales || "", cargo: codes.goods || "", transport: codes.freight || "", clearance: codes.customs || "", warehouse: codes.warehouse || "", overheads: "", financial: codes.bank_fees || "" };
  const pl = Object.keys(LABEL).map(k => ({ line: k, label: LABEL[k], pln: r2(sums[k]), code: CODE[k] }));
  const result = r2(sums.revenue - sums.cargo - sums.transport - sums.clearance - sums.warehouse - sums.overheads - sums.financial);
  let rec = 0, pay = 0; (d.invoices || []).filter(live).forEach((i: any) => { if (String(i.issueDate || "") > end || !(num(i.grossAmount) > 0)) return; const open = openOf(i, d.notes || []) * rateOf(i); if (open <= 0.005) return; if (i.kind === "SALES") rec += open; else pay += open; });
  let sv = 0, pv = 0; details.forEach(x => { if (x.category === "sales") sv += x.vatPLN; else pv += x.vatPLN; });
  const bl: any = d.bankLines && typeof d.bankLines === "object" ? d.bankLines : { lines: [], done: {} }; const openBank = (bl.lines || []).filter((l: any) => l && String(l.date || "").slice(0, 7) === month && !(bl.done || {})[l.id]).length;
  const checks = [{ check: "Documents still Draft", count: (d.invoices || []).filter((i: any) => i && String(i.paymentStatus) === "Draft" && inMonth(i.issueDate)).length },
    { check: "Purchase invoices without a category", count: (d.invoices || []).filter((i: any) => live(i) && i.kind === "COST" && inMonth(i.issueDate) && !i.category).length },
    { check: "Sales invoices not linked to their SO", count: (d.invoices || []).filter((i: any) => live(i) && i.kind === "SALES" && inMonth(i.issueDate) && num(i.grossAmount) > 0 && !(i.links || []).some((l: any) => l && l.type === "SO")).length },
    { check: "Bank lines not matched", count: openBank }];
  return { month, pl, result, balances: { receivablesPLN: r2(rec), payablesPLN: r2(pay) }, vat: { salesVatPLN: r2(sv), purchaseVatPLN: r2(pv) }, checks, details };
}
