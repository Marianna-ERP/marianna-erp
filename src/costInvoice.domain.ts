// costInvoice.domain.ts — v7.27.16 (A-AU-6, owner approved 17 Oct — option a): A SHIPMENT COST LINE LINKS ITS CARRIER'S INVOICE.
// The line picks the received invoice of its supplier from the register (imported from Fakturownia / KSeF); the amount stays as typed
// and a difference from the invoice is shown. A line that still carries a typed invoice number offers the register invoice with
// exactly that number in one click; otherwise it waits ('awaiting the invoice'). Option (b) — the invoice's amount, currency and rate
// replacing the typed ones — comes with the database step.
import { parseNum } from "./numbers";

const S = (v: any) => String(v ?? "").trim();
const n = (v: any) => parseNum(v);

/** The register invoices a cost line can link: received (cost) invoices of its supplier, not cancelled. */
export function carrierInvoiceOptions(cost: any, invoices: any[]): any[] {
  const sup = cost?.supplierId != null && cost.supplierId !== "" ? String(cost.supplierId) : "";
  return (invoices || []).filter((i: any) => i && i.kind === "COST" && S(i.paymentStatus) !== "Cancelled" && !i.isProforma && (!sup || String(i.counterparty?.id ?? "") === sup))
    .slice().sort((a: any, b: any) => S(b.issueDate).localeCompare(S(a.issueDate)));
}

/** The register invoice whose number is exactly the line's typed reference — offered, never linked silently. */
export function exactInvoiceForTypedRef(cost: any, invoices: any[]): any | null {
  const ref = S(cost?.invoiceRef).toLowerCase(); if (!ref || cost?.invoiceId != null) return null;
  return carrierInvoiceOptions(cost, invoices).find((i: any) => S(i.number).toLowerCase() === ref) || null;
}

/** The typed amount against the linked invoice: in the line's currency when they share it, else in PLN. */
export function costInvoiceDifference(cost: any, inv: any): { currency: string; line: number; invoice: number; diff: number } | null {
  if (!cost || !inv) return null;
  if (S(inv.currency) && S(inv.currency) === S(cost.currency)) { const line = n(cost.amount), invoice = n(inv.netAmount); return { currency: S(cost.currency), line, invoice, diff: Math.round((line - invoice) * 100) / 100 }; }
  const line = n(cost.amountPLN), invoice = n(inv.netPLN); if (!(invoice > 0)) return null;
  return { currency: "PLN", line, invoice, diff: Math.round((line - invoice) * 100) / 100 };
}
