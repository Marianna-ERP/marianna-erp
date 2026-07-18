import { paidFromEvents, notesTotalsAdjustment } from "./payments.domain";
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
  notesReceivableAdjPLN?: number; // BP-37: signed adjustment applied from credit/debit notes
  notesPayableAdjPLN?: number;
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
  invoices?: any[];           // v6.18.6 (P0-7): unified Invoices store — source of truth
  financeNotes?: any[];       // credit/debit notes (passed through; not yet in totals)
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

  // ── INVOICES (single source of truth) ───────────────────────────────────────
  // v6.18.6 (P0-7): receivables (SALES) and invoice-based payables (COST: warehouse,
  // freight, cost invoices) now come from the unified Invoices store — NOT from the
  // legacy orders.pendingInvoices / warehouseInvoices / operationalCosts reads. Those
  // legacy records are folded into `invoices` by migrateLegacyInvoices (idempotent),
  // so the totals match what they were — but edits/payments/new invoices made in the
  // Invoices module now flow straight through to the ledger and P/L.
  (inp.invoices || []).forEach((inv: any) => {
    if (!inv || inv.paymentStatus === "Cancelled") return;
    const isSales = inv.kind === "SALES";
    const gross = r2(n(inv.grossPLN) || n(inv.netPLN));
    if (gross <= 0 && !inv.number) return; // skip empty drafts (no number, no amount)
    const ref = `INV:${inv.id}`;
    // Paid if the invoice itself says so (payment recorded in the Invoices module),
    // or it's fully covered by recorded payments, or marked paid here / in Fakturownia.
    // Also honour the legacy SINV: mark-paid ref so previously-cleared sales invoices
    // don't reappear as open after the switch.
    const legacyPaid = isSales && settled.has(`SINV:${inv.number}`);
    // Batch 5b (BP-36): payments are EVENTS — paidFromEvents sums them, and
    // synthesises one event from a legacy paidAmount, so old data reads the same.
    const isPaid = inv.paymentStatus === "Paid"
      || (gross > 0 && paidFromEvents(inv) * (n(inv.fxRate) || 1) >= gross - 0.01)
      || settled.has(ref) || legacyPaid
      || fktPaid[String(inv.number)] === true;
    items.push({
      ref, direction: isSales ? "receivable" : "payable",
      kind: isSales ? "Sales invoice" : (inv.category === "WAREHOUSE" ? "Warehouse invoice" : inv.category === "PURCHASE" ? "PO purchase" : "Cost invoice"),
      counterparty: inv.counterparty?.name || "—",
      documentNo: inv.number || inv.fakturownia?.legalNumber || String(inv.id),
      date: inv.issueDate || inv.saleDate || "", dueDate: inv.dueDate || "",
      amountPLN: gross, currency: inv.currency || "PLN",
      amountOrig: r2(n(inv.grossAmount) || n(inv.netAmount) || gross),
      status: classify(inv.dueDate, isPaid, today),
      sourceModule: "Invoices", note: (inv.links || []).map((l: any) => l.number).filter(Boolean).join(", ") || inv.source || "",
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

  // ── PAYABLES: firm-price PO purchases not yet represented by a purchase invoice ──
  // v6.18.9 (#5): once a PO is Arrived it's folded into a PURCHASE invoice (counted in
  // the invoices loop above), so here we only count firm POs that don't yet have one —
  // i.e. the Confirmed-but-not-arrived commitment. Same total, counted exactly once.
  const poNumbersWithInvoice = new Set(
    (inp.invoices || [])
      .filter((inv: any) => inv && inv.kind === "COST")
      .flatMap((inv: any) => (inv.links || []).filter((l: any) => l.type === "PO").map((l: any) => String(l.number)))
  );
  (inp.pos || []).forEach((po: any) => {
    if ((po.pricingMode || "firm") === "consignment") return;
    if (!["Confirmed", "Received", "Closed", "Arrived"].includes(po.status)) return;
    if (poNumbersWithInvoice.has(String(po.number))) return; // now represented by a purchase invoice
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
      sourceModule: "Purchase Orders", note: po.buyIncoterm ? `Buy ${po.buyIncoterm}` : "",
    });
  });

  // Batch 5b (BP-37): credit/debit notes now ENTER the totals. A credit note we
  // issued reduces open receivables; a supplier's credit note reduces open payables;
  // debit notes increase their side. (This flip was deliberately test-pinned in the
  // old behaviour so it lands as an explicit change, not a drift.)
  const notesAdj = notesTotalsAdjustment(inp.financeNotes || []);
  const totals: LedgerTotals = {
    receivableOpenPLN: r2(Math.max(0, items.filter(i => i.direction === "receivable" && i.status !== "Paid").reduce((s, i) => s + i.amountPLN, 0) + notesAdj.receivableAdjPLN)),
    receivableOverduePLN: r2(items.filter(i => i.direction === "receivable" && i.status === "Overdue").reduce((s, i) => s + i.amountPLN, 0)),
    payableOpenPLN: r2(Math.max(0, items.filter(i => i.direction === "payable" && i.status !== "Paid").reduce((s, i) => s + i.amountPLN, 0) + notesAdj.payableAdjPLN)),
    payableOverduePLN: r2(items.filter(i => i.direction === "payable" && i.status === "Overdue").reduce((s, i) => s + i.amountPLN, 0)),
    notesReceivableAdjPLN: notesAdj.receivableAdjPLN,
    notesPayableAdjPLN: notesAdj.payableAdjPLN,
    netPositionPLN: 0,
  } as LedgerTotals;
  totals.netPositionPLN = r2(totals.receivableOpenPLN - totals.payableOpenPLN);
  return { items, totals };
}
