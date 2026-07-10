// ─────────────────────────────────────────────────────────────────────────────
// settlement.domain.ts — the Settlement DOCUMENT (Batch 5c, BP-38/31)
//
// A closed consignment settlement stops being an anonymous lot-side computation
// and becomes a numbered document: SET-YYYY-NNNN. At finalisation the commission
// is materialised as a real SALES invoice to the producer, auto-drafted into the
// Invoices registry ("Invoices is the only money-document registry").
//
// Commission is collected by DEDUCTION from the producer payout, so the drafted
// invoice carries one payment event of method "Offset / compensation" for the
// full commission — it documents the commission without double-counting the
// ledger (the payout payable is already net of commission). If the business
// instead invoices the commission separately, the user deletes that offset
// event and the invoice becomes normally receivable.
// ─────────────────────────────────────────────────────────────────────────────
import { applyPaymentEvent } from "./payments.domain";

function n(v: any): number { const x = parseFloat(String(v ?? "")); return isFinite(x) ? x : 0; }
function r2(v: number): number { return Math.round(v * 100) / 100; }

/** Next settlement number, scanning existing lot.settlement.number values. */
export function nextSettlementNumber(lots: any[], year: number): string {
  let max = 0;
  (lots || []).forEach(l => {
    const m = String(l?.settlement?.number || "").match(/^SET-(\d{4})-(\d{4})$/);
    if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]));
  });
  return `SET-${year}-${String(max + 1).padStart(4, "0")}`;
}

export interface CommissionDraftDeps { nextId: () => any; todayISO: () => string; }

/** Auto-draft the commission SALES invoice at settlement close. */
export function buildCommissionInvoiceDraft(lot: any, settlement: any, po: any, deps: CommissionDraftDeps): any {
  const commission = r2(n(settlement.finalCommissionPLN ?? settlement.expectedCommissionPLN));
  const producer = po?.supplier || { name: "Producer" };
  const today = deps.todayISO();
  const base: any = {
    id: deps.nextId(),
    kind: "SALES",
    category: "COMMISSION",
    number: settlement.commissionInvoiceNo || "", // official number comes from Fakturownia when issued
    counterparty: { name: producer.name || "Producer", nip: producer.nip || "", address: producer.address || "" },
    issueDate: settlement.closedAt || today,
    saleDate: settlement.closedAt || today,
    dueDate: settlement.producerDueDate || settlement.closedAt || today,
    currency: "PLN", fxRate: 1,
    netAmount: commission, netPLN: commission,
    vatRate: 0, grossAmount: commission, grossPLN: commission,
    paymentStatus: "Draft",
    paidAmount: 0,
    positions: [{
      id: deps.nextId(),
      description: `Commission ${n(settlement.commissionPct)}% — consignment settlement ${settlement.number || ""} (lot ${lot.number}${lot.product ? ", " + lot.product : ""})`.trim(),
      qty: 1, unit: "service", unitPrice: commission, net: commission,
    }],
    links: [
      { type: "LOT", number: lot.number },
      ...(lot.poRef ? [{ type: "PO", number: lot.poRef }] : []),
      ...(settlement.number ? [{ type: "SET", number: settlement.number }] : []),
    ],
    source: `Settlement ${settlement.number || lot.number}`,
    notes: `Auto-drafted at settlement close. Commission collected by deduction from the producer payout (payment recorded as offset).`,
  };
  // Offset event: commission collected by deduction from the payout.
  return applyPaymentEvent(base, {
    date: settlement.closedAt || today,
    amount: commission,
    method: "Offset / compensation",
    note: `Deducted from producer payout — ${settlement.number || lot.number}`,
  }, deps.nextId);
}
