// ─── v6.9: RECEIVABLES & PAYABLES AGGREGATION ───────────────────────────────
// Pulls every "money owed" item the system already tracks into one ledger:
//   RECEIVABLE (money in)  ← sales invoices issued from SOs
//   PAYABLE   (money out)  ← producer consignment payouts, warehouse invoices,
//                            operational cost invoices, firm-price PO purchases
// Pure functions; no UI, no storage. The frontend marks items paid via a
// `settledRefs` set kept in app state; here we just compute and classify.

export type LedgerDirection = "receivable" | "payable";

export interface LedgerItem {
  ref: string;                 // stable id, e.g. "SINV:FV2026/05/1" or "WHINV:123"
  direction: LedgerDirection;
  kind: string;                // "Sales invoice" | "Producer payout" | "Warehouse invoice" | "Cost invoice" | "PO purchase"
  counterparty: string;
  documentNo: string;
  date: string;                // issue/created date
  dueDate: string;             // when payment is due ("" if unknown)
  amountPLN: number;
  currency: string;
  amountOrig: number;
  status: "Open" | "Paid" | "Overdue";
  sourceModule: string;        // where to go to see it
  note?: string;
}

export interface LedgerTotals {
  receivableOpenPLN: number;
  receivableOverduePLN: number;
  payableOpenPLN: number;
  payableOverduePLN: number;
  netPositionPLN: number;      // receivable open − payable open
}

function n(v: any): number { const x = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(x) ? x : 0; }
function r2(x: number): number { return Math.round(x * 100) / 100; }

function classify(dueDate: string, settled: boolean, todayISO: string): "Open" | "Paid" | "Overdue" {
  if (settled) return "Paid";
  if (dueDate && String(dueDate).slice(0, 10) < String(todayISO).slice(0, 10)) return "Overdue";
  return "Open";
}

export interface LedgerInputs {
  orders?: any[];
  lots?: any[];
  warehouseInvoices?: any[];
  operationalCosts?: any[];
  pos?: any[];
  settledRefs?: string[];     // refs the user marked paid
  fakturowniaPaid?: Record<string, boolean>; // invoiceNo → paid (from live sync)
  todayISO: string;
}

export function buildLedger(inp: LedgerInputs): { items: LedgerItem[]; totals: LedgerTotals } {
  const today = inp.todayISO;
  const settled = new Set((inp.settledRefs || []).map(String));
  const fktPaid = inp.fakturowniaPaid || {};
  const items: LedgerItem[] = [];

  // ── RECEIVABLES: sales invoices issued from SOs ──
  (inp.orders || []).forEach((o: any) => {
    if (!o || o.status === "Cancelled") return;
    (o.pendingInvoices || []).forEach((inv: any) => {
      const ref = `SINV:${inv.number}`;
      const isPaid = settled.has(ref) || fktPaid[String(inv.number)] === true || inv.fktPaid === true;
      items.push({
        ref, direction: "receivable", kind: "Sales invoice",
        counterparty: o.client?.name || "—",
        documentNo: inv.number, date: inv.issueDate || inv.date || "", dueDate: inv.dueDate || "",
        amountPLN: r2(n(inv.grossPLN) || n(inv.netPLN) || n(inv.grossAmount) * (n(inv.fxRate) || 1)),
        currency: inv.currency || o.currency || "PLN",
        amountOrig: r2(n(inv.grossAmount) || n(inv.netAmount)),
        status: classify(inv.dueDate, isPaid, today),
        sourceModule: "Sales Orders", note: o.number,
      });
    });
  });

  // ── PAYABLES: producer consignment payouts (closed settlements) ──
  (inp.lots || []).forEach((lot: any) => {
    const s = lot?.settlement;
    if (!s || s.status !== "Closed") return;
    const payoutPLN = r2(n(s.producerInvoiceAmountPLN) - n(s.finalCommissionPLN ?? s.expectedCommissionPLN));
    if (payoutPLN <= 0) return;
    const ref = `PAYOUT:${lot.number}`;
    items.push({
      ref, direction: "payable", kind: "Producer payout",
      counterparty: (inp.pos || []).find((p: any) => p.number === lot.poRef)?.supplier?.name || "Producer",
      documentNo: s.producerInvoiceNo || lot.poRef || lot.number, date: s.closedAt || "", dueDate: s.producerDueDate || "",
      amountPLN: payoutPLN, currency: "PLN", amountOrig: payoutPLN,
      status: classify(s.producerDueDate, settled.has(ref), today),
      sourceModule: "Inventory", note: `Consignment ${lot.number}`,
    });
  });

  // ── PAYABLES: warehouse invoices ──
  (inp.warehouseInvoices || []).forEach((inv: any) => {
    const ref = `WHINV:${inv.id}`;
    items.push({
      ref, direction: "payable", kind: "Warehouse invoice",
      counterparty: inv.warehouseName || "Warehouse",
      documentNo: inv.invoiceNo || String(inv.id), date: inv.date || "", dueDate: inv.dueDate || "",
      amountPLN: r2(n(inv.amountPLN)), currency: inv.currency || "PLN", amountOrig: r2(n(inv.amount)),
      status: classify(inv.dueDate, settled.has(ref) || inv.status === "Paid", today),
      sourceModule: "Finance · Warehouse charges", note: inv.period,
    });
  });

  // ── PAYABLES: operational cost invoices (those with an invoice number) ──
  (inp.operationalCosts || []).forEach((c: any) => {
    if (!c.invoiceNo) return; // only invoice-backed costs are payables; payroll/taxes excluded
    const ref = `COST:${c.id}`;
    items.push({
      ref, direction: "payable", kind: "Cost invoice",
      counterparty: c.supplierName || "—",
      documentNo: c.invoiceNo, date: c.date || "", dueDate: c.dueDate || "",
      amountPLN: r2(n(c.amountPLN)), currency: c.currency || "PLN", amountOrig: r2(n(c.amount)),
      status: classify(c.dueDate, settled.has(ref) || c.status === "Paid", today),
      sourceModule: "Finance · Operational costs", note: c.description,
    });
  });

  // ── PAYABLES: firm-price PO purchases (non-consignment, confirmed) ──
  (inp.pos || []).forEach((po: any) => {
    if ((po.pricingMode || "firm") === "consignment") return;
    if (!["Confirmed", "Received", "Closed", "Arrived"].includes(po.status)) return;
    const total = (po.items || []).reduce((s: number, it: any) => s + n(it.qty) * n(it.unitPrice), 0);
    if (total <= 0) return;
    const fx = n(po.fxRate) || 1;
    const ref = `PO:${po.number}`;
    items.push({
      ref, direction: "payable", kind: "PO purchase",
      counterparty: po.supplier?.name || "Supplier",
      documentNo: po.number, date: po.orderDate || "", dueDate: po.paymentDueDate || "",
      amountPLN: r2(total * fx), currency: po.currency || "PLN", amountOrig: r2(total),
      status: classify(po.paymentDueDate, settled.has(ref), today),
      sourceModule: "Purchase Orders", note: po.flow,
    });
  });

  const totals: LedgerTotals = {
    receivableOpenPLN: r2(items.filter(i => i.direction === "receivable" && i.status !== "Paid").reduce((s, i) => s + i.amountPLN, 0)),
    receivableOverduePLN: r2(items.filter(i => i.direction === "receivable" && i.status === "Overdue").reduce((s, i) => s + i.amountPLN, 0)),
    payableOpenPLN: r2(items.filter(i => i.direction === "payable" && i.status !== "Paid").reduce((s, i) => s + i.amountPLN, 0)),
    payableOverduePLN: r2(items.filter(i => i.direction === "payable" && i.status === "Overdue").reduce((s, i) => s + i.amountPLN, 0)),
    netPositionPLN: 0,
  };
  totals.netPositionPLN = r2(totals.receivableOpenPLN - totals.payableOpenPLN);
  return { items, totals };
}
