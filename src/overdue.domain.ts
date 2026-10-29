// overdue.domain.ts — v7.46.0 (INV2-5, Invoices analysis 29 Oct: "the filter shows 0, the tile 109, Finance 20"): ONE OVERDUE RULE for the
// Invoices tile, the status filter, the red "late" on a row, Finance and the statements. An invoice is overdue when it is a real document
// (issued — not a draft, a pro-forma or cancelled), not a correction, its due date has passed, and something is still open on it: its gross,
// less its credit notes, plus its debit notes, less what is paid. With no due date, one is taken from the company's payment terms.
const S = (v: any) => String(v ?? "").trim();
export function dueDateOf(inv: any, contacts: any[] = []): string {
  const d = S(inv?.dueDate).slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const co = (contacts || []).find((c: any) => c && inv?.counterparty?.id != null && String(c.id) === String(inv.counterparty.id));
  const days = Number(co?.terms?.paymentDays); const issued = S(inv?.issueDate).slice(0, 10);
  if (!(days >= 0) || !/^\d{4}-\d{2}-\d{2}$/.test(issued)) return "";
  const [y, m, dd] = issued.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, dd + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
export function openOf(inv: any, notes: any[] = []): number {
  const mine = (notes || []).filter((n: any) => n && n.invoiceId != null && String(n.invoiceId) === String(inv?.id) && !/Cancelled/i.test(S(n.status)));
  const adj = mine.reduce((s: number, n: any) => s + (S(n.noteType).toUpperCase() === "DEBIT" ? 1 : -1) * (Number(n.amount) || 0), 0);
  return Math.round(((Number(inv?.grossAmount ?? inv?.grossPLN) || 0) + adj - (Number(inv?.paidAmount) || 0)) * 100) / 100;
}
export function isOverdue(inv: any, todayISO: string, notes: any[] = [], contacts: any[] = []): boolean {
  if (!inv) return false; const st = S(inv.paymentStatus);
  if (st === "Draft" || st === "Cancelled" || st === "Paid" || inv.isProforma) return false;
  if (!(Number(inv.grossAmount ?? inv.grossPLN) > 0)) return false;   // a correction (a negative document) is never overdue
  const due = dueDateOf(inv, contacts); if (!due || due >= S(todayISO).slice(0, 10)) return false;
  return openOf(inv, notes) > 0.009;
}
