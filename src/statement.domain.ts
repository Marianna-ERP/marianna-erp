// ─────────────────────────────────────────────────────────────────────────────
// statement.domain.ts — v6.98.1: STATEMENT OF ACCOUNT per client / supplier
// A derived view over the Invoices register (invoices, credit/debit notes, payment
// events incl. bank, advance and offset). One statement per counterparty per
// currency; opening balance = everything before the period. Finance reads; nothing stored.
// ─────────────────────────────────────────────────────────────────────────────
const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface StatementLine { date: string; type: "Invoice" | "Credit note" | "Debit note" | "Payment" | "Offset" | "Advance"; ref: string; dueDate?: string; debit: number; credit: number; balance: number; note?: string; overdueDays?: number; }
export interface Statement { counterparty: string; side: "client" | "supplier"; currency: string; from: string; to: string; opening: number; lines: StatementLine[]; closing: number; overdue: number; aging: { current: number; d30: number; d60: number; d90: number; older: number }; }

function sameParty(a: any, b: any): boolean { return S(a).toLowerCase() === S(b).toLowerCase(); }
function isBefore(d: string, from: string) { return from && S(d) && S(d) < from; }

/** side "client": their invoices (SALES) are DEBITS to them, our credit notes and their payments are CREDITS.
 *  side "supplier": their invoices (COST) are CREDITS (we owe), our payments and their credit notes are DEBITS. */
export function statementFor(counterpartyName: string, side: "client" | "supplier", currency: string, invoices: any[], notes: any[], from: string, to: string, todayISO: string): Statement {
  const cur = S(currency || "PLN").toUpperCase();
  const kind = side === "client" ? "SALES" : "COST";
  const rows: Array<{ date: string; line: Omit<StatementLine, "balance"> }> = [];
  (invoices || []).forEach(inv => {
    if (!inv || inv.kind !== kind || inv.isProforma || inv.paymentStatus === "Cancelled" || inv.paymentStatus === "Draft") return;
    if (!sameParty(inv.counterparty?.name, counterpartyName) || S(inv.currency || "PLN").toUpperCase() !== cur) return;
    const gross = num(inv.grossAmount);
    rows.push({ date: S(inv.issueDate), line: { date: S(inv.issueDate), type: "Invoice", ref: S(inv.number), dueDate: S(inv.dueDate), debit: side === "client" ? gross : 0, credit: side === "client" ? 0 : gross } });
    (inv.payments || []).forEach((p: any) => {
      const amt = num(p.amount); if (!(amt > 0)) return;
      const src = S(p.source);
      const type: StatementLine["type"] = src.startsWith("note:") || /offset|compensation/i.test(S(p.method)) ? "Offset" : src.startsWith("advance:") ? "Advance" : "Payment";
      rows.push({ date: S(p.date), line: { date: S(p.date), type, ref: `${S(inv.number)} · ${S(p.method) || "payment"}`, debit: side === "client" ? 0 : amt, credit: side === "client" ? amt : 0, note: S(p.note) } });
    });
  });
  (notes || []).forEach(n => {
    if (!n || n.status === "Cancelled" || n.status === "Draft" || n.status === "Expected") return;
    if (!sameParty(n.partyName, counterpartyName) || S(n.currency || "PLN").toUpperCase() !== cur) return;
    const amt = num(n.amount); if (!(amt > 0)) return;
    const ours = S(n.issuedBy || (n.direction === "outgoing" ? "US" : "COUNTERPARTY")) === "US";
    const credit = S(n.noteType) === "CREDIT";
    // our credit note to a client → reduces what they owe (credit to them); their credit note to us (supplier) → reduces what we owe (debit on their account)
    let debit = 0, cr = 0;
    if (side === "client") { if (ours && credit) cr = amt; else if (ours && !credit) debit = amt; else if (!ours && credit) debit = amt; else cr = amt; }
    else { if (!ours && credit) debit = amt; else if (!ours && !credit) cr = amt; else if (ours && credit) cr = amt; else debit = amt; }
    rows.push({ date: S(n.date), line: { date: S(n.date), type: credit ? "Credit note" : "Debit note", ref: S(n.number) || `note ${n.id}`, debit, credit: cr, note: S(n.reason) } });
  });
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const sign = side === "client" ? 1 : -1;   // client balance = they owe us (+); supplier balance = we owe them shown as (+) via credit-debit
  let opening = 0; const lines: StatementLine[] = [];
  rows.forEach(({ date, line }) => {
    const delta = side === "client" ? line.debit - line.credit : line.credit - line.debit;
    if (isBefore(date, from)) { opening = r2(opening + delta); return; }
    if (to && date > to) return;
    lines.push({ ...line, balance: 0 });
  });
  let bal = opening;
  lines.forEach(l => { bal = r2(bal + (side === "client" ? l.debit - l.credit : l.credit - l.debit)); l.balance = bal; if (l.type === "Invoice" && l.dueDate && l.dueDate < todayISO) l.overdueDays = Math.round((new Date(todayISO).getTime() - new Date(l.dueDate).getTime()) / 86400000); });
  // overdue + aging from OPEN invoices (outstanding per invoice), regardless of the period
  const aging = { current: 0, d30: 0, d60: 0, d90: 0, older: 0 }; let overdue = 0;
  (invoices || []).forEach(inv => {
    if (!inv || inv.kind !== kind || inv.isProforma || ["Cancelled", "Draft"].includes(inv.paymentStatus)) return;
    if (!sameParty(inv.counterparty?.name, counterpartyName) || S(inv.currency || "PLN").toUpperCase() !== cur) return;
    const open = r2(num(inv.grossAmount) - num(inv.paidAmount)); if (open <= 0.005) return;
    const days = inv.dueDate ? Math.round((new Date(todayISO).getTime() - new Date(inv.dueDate).getTime()) / 86400000) : -1;
    if (days <= 0) aging.current += open; else if (days <= 30) aging.d30 += open; else if (days <= 60) aging.d60 += open; else if (days <= 90) aging.d90 += open; else aging.older += open;
    if (days > 0) overdue += open;
  });
  void sign;
  return { counterparty: counterpartyName, side, currency: cur, from, to, opening, lines, closing: r2(bal), overdue: r2(overdue), aging: { current: r2(aging.current), d30: r2(aging.d30), d60: r2(aging.d60), d90: r2(aging.d90), older: r2(aging.older) } };
}

/** Which currencies does this counterparty have documents in (one statement each)? */
export function statementCurrencies(counterpartyName: string, side: "client" | "supplier", invoices: any[], notes: any[]): string[] {
  const kind = side === "client" ? "SALES" : "COST"; const set = new Set<string>();
  (invoices || []).forEach(i => { if (i && i.kind === kind && !i.isProforma && i.paymentStatus !== "Cancelled" && sameParty(i.counterparty?.name, counterpartyName)) set.add(S(i.currency || "PLN").toUpperCase()); });
  (notes || []).forEach(n => { if (n && sameParty(n.partyName, counterpartyName)) set.add(S(n.currency || "PLN").toUpperCase()); });
  return Array.from(set).sort();
}
