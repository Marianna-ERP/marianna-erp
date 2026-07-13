// ─── INVOICING CORE ─────────────────────────────────────────────────────────
//
// The single source of truth for every invoice in and out, plus the migration
// that folds the four legacy representations into it, and the Fakturownia push
// payload builder. Pure functions only — no React, no storage, no side effects.
//
// Decisions locked in the spec:
//  • One model for SALES (receivable) and COST (payable) invoices.
//  • Operations/Admin see everything here; the precise P/L stays in Finance.
//  • Edit lock at "Sent" (Draft & Issued editable; Sent/pushed = locked).
//  • Net in PLN at each invoice's own locked fxRate.
//  • Fakturownia auto-numbers (we send number:null); KSeF stays Fakturownia-managed
//    for now (gov_save_and_send default OFF, single toggle to enable later).

import { nextId } from "./ids";
import { resolveFxRate } from "./fx";

export type InvoiceKind = "SALES" | "COST";
export type CostScope = "SHIPMENT" | "MONTHLY_SHARED" | "OVERHEAD";
// v6.30.1: COMMISSION added — the settlement close (settlement.domain) drafts a
// SALES invoice with this category; it was previously outside the union and
// unmapped in the Invoices UI (CATEGORY_META lookup crashed the list render).
export type InvoiceCategory = "SINV" | "COMMISSION" | "PURCHASE" | "FORWARDER" | "BROKER" | "WAREHOUSE" | "TRANSPORT" | "OTHER";
export type PaymentStatus = "Draft" | "Issued" | "Sent" | "Partially paid" | "Paid" | "Overdue" | "Cancelled";

export interface InvoiceLink { type: "SO" | "PO" | "Shipment" | "Lot"; number: string; }
export interface InvoicePosition { name: string; quantity: number; unit?: string; vatRate: number; netPrice?: number; grossTotal?: number; }

export interface Invoice {
  id: number;
  kind: InvoiceKind;
  category: InvoiceCategory;
  costScope?: CostScope;            // COST only
  number: string;                   // our ref; for SALES the Fakturownia legal number lands in fakturownia.legalNumber
  counterparty: { id?: number; name: string; nip?: string } | null;
  issueDate: string;
  saleDate: string;
  dueDate: string;
  paymentMethod: string;
  currency: string;
  fxRate: number;                   // locked rate to PLN
  netAmount: number;
  vatRate: number;
  vatAmount: number;
  grossAmount: number;
  netPLN: number;
  grossPLN: number;
  periodFrom?: string;              // MONTHLY_SHARED only
  periodTo?: string;
  positions: InvoicePosition[];
  links: InvoiceLink[];
  paymentStatus: PaymentStatus;
  paidAmount: number;
  notes: string;
  attachment: { name: string; size?: string } | null;
  creditNoteIds: number[];          // ids of credit/debit notes against this invoice
  allocation: any | null;           // written by the cost-allocation engine (v6.19)
  fakturownia: { exported: boolean; ref?: string | number; legalNumber?: string };
  source: string;                   // provenance, e.g. "SO:SO-2026-0091", "migrated:warehouseInvoice"
  createdAt: string;
  createdBy?: string;
  locked?: boolean;                 // true once Sent / pushed — edits restricted
}

// ── helpers ──
function n(v: any): number { const x = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(x) ? x : 0; }
function r2(x: number): number { return Math.round(x * 100) / 100; }
function arr<T = any>(v: any): T[] { return Array.isArray(v) ? v : []; }

// v6.32.0 (R7b-5): unused PAYABLE_CATEGORIES removed.
export function invoiceDirection(inv: Invoice): "receivable" | "payable" {
  return inv.kind === "SALES" ? "receivable" : "payable";
}
export function isLocked(inv: Invoice): boolean {
  return !!inv.locked || inv.paymentStatus === "Sent" || !!inv.fakturownia?.exported;
}

// Recompute the money fields consistently from net + vat rate + fx.
export function recomputeInvoiceMoney(inv: Partial<Invoice>): Partial<Invoice> {
  const net = r2(n(inv.netAmount));
  const vatRate = n(inv.vatRate);
  const fx = resolveFxRate(inv.fxRate, inv.currency);
  const vat = r2(net * vatRate / 100);
  const gross = r2(net + vat);
  return { ...inv, netAmount: net, vatRate, vatAmount: vat, grossAmount: gross, fxRate: fx, netPLN: r2(net * fx), grossPLN: r2(gross * fx) };
}

// ── MIGRATION: fold the four legacy sources into the unified model ──
// Idempotent by `source` tag — a record already migrated (same source) is skipped,
// so running this on every load never duplicates.
// ─── v6.33.0 (A3-6): the Invoices register is the SOLE owner of invoices ────
// The SO "Issue Sales Invoice" modal now writes HERE (via this builder) instead
// of into order.pendingInvoices. The source tag is the same one the legacy fold
// uses, so importing an old backup whose SO still carries the pendingInvoice
// can never duplicate an invoice already created through the API.
export function salesInvoiceSourceTag(soNumber: any, invNumber: any): string {
  return `SO:${soNumber}:${invNumber || ""}`;
}
export function salesInvoiceFromSODraft(order: any, pi: any): Invoice {
  const fx = resolveFxRate(pi.fxRate, pi.currency || order.currency);
  const net = r2(n(pi.netAmount));
  const vatRate = n(pi.vatRate);
  const vat = r2(n(pi.vatAmount) || net * vatRate / 100);
  const gross = r2(n(pi.grossAmount) || net + vat);
  return {
    id: nextId(), kind: "SALES", category: "SINV",
    number: pi.number || "", counterparty: pi.counterparty || order.client || null,
    issueDate: pi.issueDate || "", saleDate: pi.saleDate || "", dueDate: pi.dueDate || "",
    paymentMethod: pi.paymentMethod || "Transfer",
    currency: pi.currency || order.currency || "PLN", fxRate: fx,
    netAmount: net, vatRate, vatAmount: vat, grossAmount: gross,
    netPLN: r2(net * fx), grossPLN: r2(gross * fx),
    positions: arr(order.items).map((it: any) => ({ name: it.product || "", quantity: n(it.qty), unit: it.unit || "kg", vatRate, grossTotal: undefined })),
    links: [{ type: "SO", number: order.number }],
    paymentStatus: (pi.paymentStatus as PaymentStatus) || "Draft",
    paidAmount: n(pi.paidAmount),
    notes: pi.notes || "", attachment: pi.attachment || null,
    creditNoteIds: [], allocation: null,
    fakturownia: { exported: !!pi.fktMatched, ref: pi.fktId, legalNumber: pi.fktMatched ? pi.number : undefined },
    source: salesInvoiceSourceTag(order.number, pi.number || pi.id),
    createdAt: pi.createdAt || pi.issueDate || "", locked: pi.paymentStatus === "Sent" || !!pi.fktMatched,
  } as Invoice;
}

// v6.33.0 (A3-6): once the register owns an SO's invoices, the legacy
// order.pendingInvoices arrays are stripped. Pure; returns the SAME array
// reference when there is nothing to strip so React effects don't loop.
export function stripPendingInvoices(orders: any[]): { orders: any[]; changed: boolean } {
  let changed = false;
  const out = arr(orders).map((o: any) => {
    if (!o || !o.pendingInvoices || !o.pendingInvoices.length) return o;
    changed = true;
    const { pendingInvoices, ...rest } = o;
    return rest;
  });
  return { orders: changed ? out : orders, changed };
}

// ─── v6.33.0 (A3-5 residue): legacy Finance creditNotes → FinanceNote ────────
// The old Finance "Credit Notes" tab kept its own array that never entered the
// receivable/payable totals. Fold each record into the canonical notes model
// (all legacy records are CREDIT notes — the tab had no debit concept),
// idempotent by source tag; after this they DO adjust the ledger totals (BP-37).
export function migrateLegacyCreditNotes(opts: { existing: FinanceNote[]; creditNotes: any[] }): FinanceNote[] {
  const existing = arr<FinanceNote>(opts.existing);
  const have = new Set(existing.map(nte => nte.source).filter(Boolean));
  const out: FinanceNote[] = [...existing];
  arr(opts.creditNotes).forEach((cn: any) => {
    const src = `legacyCN:${cn.id}`;
    if (have.has(src)) return;
    const fx = resolveFxRate(cn.fxRate, cn.currency);
    const amount = n(cn.amount);
    out.push({
      id: nextId(), noteType: "CREDIT",
      direction: cn.direction === "incoming" ? "incoming" : "outgoing",
      invoiceId: null, relatedRef: cn.relatedRef || "",
      partyName: cn.partyName || "", category: cn.category || "Other",
      amount, currency: cn.currency || "PLN", fxRate: fx,
      amountPLN: r2(n(cn.amountPLN) || amount * fx),
      status: cn.status || "Draft", reason: cn.reason || "", date: cn.date || "",
      source: src,
    });
    have.add(src);
  });
  return out;
}

export function migrateLegacyInvoices(opts: {
  existing: Invoice[];
  orders: any[];
  warehouseInvoices: any[];
  operationalCosts: any[];
  pos?: any[];
}): Invoice[] {
  const existing = arr<Invoice>(opts.existing);
  const haveSource = new Set(existing.map(i => i.source).filter(Boolean));
  const out: Invoice[] = [...existing];

  const pushIf = (source: string, build: () => Invoice) => {
    if (haveSource.has(source)) return;
    out.push(build());
    haveSource.add(source);
  };

  // 1. SALES invoices from SO pendingInvoices — same builder as the live A3-6
  // path (salesInvoiceFromSODraft), so folded and API-created invoices are one
  // shape and one source-tag namespace.
  arr(opts.orders).forEach((o: any) => {
    arr(o.pendingInvoices).forEach((pi: any) => {
      const src = salesInvoiceSourceTag(o.number, pi.number || pi.id);
      pushIf(src, () => salesInvoiceFromSODraft(o, pi));
    });
  });

  // 2. COST / WAREHOUSE from warehouseInvoices (monthly shared)
  arr(opts.warehouseInvoices).forEach((w: any) => {
    const src = `migrated:warehouseInvoice:${w.id}`;
    pushIf(src, () => {
      const fx = resolveFxRate(w.fxRate, w.currency);
      const net = r2(n(w.amount) || n(w.amountPLN) / (fx || 1));
      return {
        id: nextId(), kind: "COST", category: "WAREHOUSE", costScope: "MONTHLY_SHARED",
        number: w.invoiceNo || "", counterparty: { name: w.warehouseName || "Warehouse" },
        issueDate: w.date || "", saleDate: w.date || "", dueDate: w.dueDate || "",
        paymentMethod: "Transfer", currency: w.currency || "PLN", fxRate: fx,
        netAmount: net, vatRate: 0, vatAmount: 0, grossAmount: r2(net),
        netPLN: r2(n(w.amountPLN) || net * fx), grossPLN: r2(n(w.amountPLN) || net * fx),
        periodFrom: w.period ? `${w.period}-01` : undefined, periodTo: undefined,
        positions: [], links: [],
        paymentStatus: (w.status === "Approved" ? "Issued" : (w.status as PaymentStatus)) || "Issued",
        paidAmount: 0, notes: w.notes || "", attachment: null,
        creditNoteIds: [], allocation: w.allocatedLots ? { method: w.allocationMethod || "by_kg_days", lots: w.allocatedLots } : null,
        fakturownia: { exported: false },
        source: src, createdAt: w.date || "",
      };
    });
  });

  // 3. COST from operationalCosts that carry an invoice number
  arr(opts.operationalCosts).forEach((c: any) => {
    if (!String(c.invoiceNo || "").trim()) return; // payroll/taxes without an invoice stay out
    const src = `migrated:opCost:${c.id}`;
    pushIf(src, () => {
      const fx = resolveFxRate(c.fxRate, c.currency);
      const net = r2(n(c.amount));
      const gross = r2(n(c.amountPLN) || net * fx);
      const cat: InvoiceCategory =
        /forward/i.test(c.category || "") ? "FORWARDER" :
        /custom|broker|cło|clo/i.test(c.category || c.description || "") ? "BROKER" :
        /transport|freight|carrier/i.test(c.category || "") ? "TRANSPORT" :
        /warehouse|storage|magazyn/i.test(c.category || "") ? "WAREHOUSE" :
        /purchase|goods|towar/i.test(c.category || "") ? "PURCHASE" : "OTHER";
      const scope: CostScope = cat === "WAREHOUSE" || cat === "BROKER" ? "MONTHLY_SHARED" : (c.costCenter === "general" || cat === "OTHER" ? "OVERHEAD" : "SHIPMENT");
      return {
        id: nextId(), kind: "COST", category: cat, costScope: scope,
        number: c.invoiceNo, counterparty: { name: c.supplierName || c.seller || "—" },
        issueDate: c.date || "", saleDate: c.date || "", dueDate: c.dueDate || "",
        paymentMethod: "Transfer", currency: c.currency || "PLN", fxRate: fx,
        netAmount: net, vatRate: 0, vatAmount: 0, grossAmount: r2(net),
        netPLN: r2(net * fx), grossPLN: gross,
        periodFrom: c.period ? `${c.period}-01` : undefined,
        positions: [], links: [],
        paymentStatus: (c.status as PaymentStatus) || "Issued", paidAmount: 0,
        notes: c.notes || c.description || "", attachment: null,
        creditNoteIds: [], allocation: null, fakturownia: { exported: false },
        source: src, createdAt: c.date || "",
      };
    });
  });

  // 4. COST (PURCHASE) from firm-price POs once the goods have ARRIVED. The supplier's
  //    commercial invoice becomes payable on receipt; consignment POs are excluded
  //    (they settle as producer payouts, not purchase invoices). #5 / v6.18.9.
  arr(opts.pos).forEach((po: any) => {
    if ((po.pricingMode || "firm") === "consignment") return;
    if (!["Arrived", "Received", "Closed"].includes(po.status)) return; // only after goods received
    const total = arr(po.items).reduce((s: number, it: any) => s + n(it.qty) * n(it.unitPrice), 0);
    if (total <= 0) return;
    const src = `migrated:po:${po.id}`;
    pushIf(src, () => {
      const fx = resolveFxRate(po.fxRate, po.currency);
      const grossPLN = r2(total * fx);
      return {
        id: nextId(), kind: "COST", category: "PURCHASE", costScope: "SHIPMENT",
        number: po.supplierInvoiceNo || "", counterparty: po.supplier || { name: po.supplier?.name || "Supplier" },
        issueDate: po.arrivalDate || po.expectedDeliveryDate || po.orderDate || "", saleDate: po.arrivalDate || po.orderDate || "", dueDate: po.paymentDueDate || "",
        paymentMethod: "Transfer", currency: po.currency || "PLN", fxRate: fx,
        netAmount: r2(total), vatRate: 0, vatAmount: 0, grossAmount: r2(total),
        netPLN: grossPLN, grossPLN,
        positions: [], links: [{ type: "PO", number: po.number }],
        paymentStatus: "Issued", paidAmount: 0,
        notes: po.supplierInvoiceNo ? "" : "Awaiting the supplier's invoice number — add it here when received.",
        attachment: null, creditNoteIds: [], allocation: null, fakturownia: { exported: false },
        source: src, createdAt: po.arrivalDate || po.orderDate || "",
      } as Invoice;
    });
  });

  return out;
}

// ── FAKTUROWNIA PUSH PAYLOAD (verified contract, spec §10) ──
// Builds the POST /invoices.json body for a SALES invoice. Auto-numbering (number:null).
// gov_save_and_send defaults OFF — KSeF stays Fakturownia-managed for now.
export function buildFakturowniaPayload(inv: Invoice, opts: { apiToken: string; sellerName?: string; sellerTaxNo?: string; govSaveAndSend?: boolean }) {
  const positions = arr<InvoicePosition>(inv.positions).map(p => ({
    name: p.name || "—",
    quantity: n(p.quantity) || 1,
    quantity_unit: p.unit || "kg",
    tax: n(p.vatRate),
    total_price_gross: p.grossTotal != null ? r2(n(p.grossTotal)) : undefined,
    total_price_net: p.grossTotal == null && p.netPrice != null ? r2(n(p.netPrice) * (n(p.quantity) || 1)) : undefined,
  }));
  // If no per-line positions exist (migrated invoices), fall back to one summary line.
  const safePositions = positions.length ? positions : [{
    name: inv.notes?.slice(0, 80) || "Sales invoice", quantity: 1, quantity_unit: "szt.",
    tax: n(inv.vatRate), total_price_gross: r2(n(inv.grossAmount)),
  }];
  const body: any = {
    api_token: opts.apiToken,
    invoice: {
      kind: "vat",
      number: null,                 // Fakturownia auto-numbers (Q3-a)
      issue_date: inv.issueDate || undefined,
      sell_date: inv.saleDate || inv.issueDate || undefined,
      payment_to: inv.dueDate || undefined,
      payment_type: (inv.paymentMethod || "transfer").toLowerCase(),
      buyer_name: inv.counterparty?.name || "",
      buyer_tax_no: inv.counterparty?.nip || "",
      buyer_company: true,          // clients are companies — needed for KSeF auto-send
      currency: inv.currency || "PLN",
      positions: safePositions,
    },
  };
  if (opts.sellerName) body.invoice.seller_name = opts.sellerName;
  if (opts.sellerTaxNo) body.invoice.seller_tax_no = opts.sellerTaxNo;
  if (opts.govSaveAndSend) body.gov_save_and_send = true; // default OFF (Q3-c)
  return body;
}

// ── credit / debit notes (extends the existing creditNotes model) ──
export type NoteType = "CREDIT" | "DEBIT";
export interface FinanceNote {
  id: number;
  noteType: NoteType;
  direction: "incoming" | "outgoing";
  invoiceId: number | null;          // structured link to the adjusted invoice
  relatedRef: string;                // human ref (SO/PO/shipment) kept for display
  partyName: string;
  category: string;
  amount: number;
  currency: string;
  fxRate: number;
  amountPLN: number;
  status: string;
  reason: string;
  date: string;
  source?: string;
}

// Net adjustment a note applies to an invoice's effective amount (PLN).
export function noteSignedPLN(note: FinanceNote): number {
  const mag = r2(n(note.amountPLN) || n(note.amount) * resolveFxRate(note.fxRate, note.currency));
  return note.noteType === "DEBIT" ? mag : -mag;
}
