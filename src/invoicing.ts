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
import { parseNum } from "./numbers";   // v7.22.2 (FZ-22)
import { scopeOf } from "./invoicePlus.domain";   // v7.26.1 (A-INV-6): the scope follows the category
import { countryIso, isEU } from "./counterparty.domain";   // v7.27.4 (AUD-16)

export type InvoiceKind = "SALES" | "COST";
// v7.26.1 (A-INV-6 / FZ-10, owner 17 Oct): ONE CLASSIFICATION — the direction (kind) and one category; where the cost is charged
// follows from the category (invoicePlus.domain.scopeOf) and is never chosen apart. Older values (SINV, FORWARDER, BROKER,
// TRANSPORT, MONTHLY_SHARED) are read as their category until the database step folds them.
export type CostScope = "SALES" | "PURCHASE" | "SHIPMENT" | "OVERHEAD" | "OTHER";
// v6.30.1: COMMISSION added — the settlement close (settlement.domain) drafts a
// SALES invoice with this category; it was previously outside the union and
// unmapped in the Invoices UI (CATEGORY_META lookup crashed the list render).
export type InvoiceCategory = "SALES" | "COMMISSION" | "PURCHASE" | "FREIGHT" | "CUSTOMS" | "WAREHOUSE" | "OVERHEAD" | "OTHER";
export type PaymentStatus = "Draft" | "Issued" | "Sent" | "Partially paid" | "Paid" | "Overdue" | "Cancelled";

export interface InvoiceLink { type: "SO" | "PO" | "Shipment" | "Lot"; number: string; }
export interface InvoicePosition { name: string; quantity: number; unit?: string; vatRate: number; netPrice?: number; grossTotal?: number; 
  cnCode?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  netTotal?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  origin?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  packaging?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  pallets?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  product?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  quality?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  size?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  unitPrice?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  variety?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
}

export interface Invoice {
  /** v6.68.1 (owner ruling): a pro-forma is the document an advance answers —
   *  excluded from receivable/payable totals; pushes to Fakturownia as kind
   *  "proforma"; the FINAL invoice is what advances get applied to. */
  isProforma?: boolean;
  /** v6.81.0 (D-60): the Fakturownia department (bank account) chosen for this invoice at send. */
  fakturowniaDepartmentId?: any;
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
  creditNoteIds?: number[];         // retired (IV-5): the notes point at their invoice — no new invoice writes it (v7.24.3)
  invoiceNotes?: string;            // v7.26.4 (A-INV-4): the notes printed on the invoice (sent to Fakturownia), filled from the sale
  allocation: any | null;           // written by the cost-allocation engine (v6.19)
  fakturownia: { exported: boolean; ref?: string | number; legalNumber?: string };
  source: string;                   // provenance, e.g. "SO:SO-2026-0091", "migrated:warehouseInvoice"
  createdAt: string;
  createdBy?: string;
  locked?: boolean;                 // true once Sent / pushed — edits restricted
  payments?: Record<string, any>[] | any[];   // v7.22.6 (FZ-20): stored in the data, now declared
}

// ── helpers ──
function n(v: any): number { return parseNum(v); }   // v7.22.2 (FZ-22)
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
    id: nextId(), kind: "SALES", category: "SALES",
    number: pi.number || "", counterparty: pi.counterparty || order.client || null,
    issueDate: pi.issueDate || "", saleDate: pi.saleDate || "", dueDate: pi.dueDate || "",
    paymentMethod: pi.paymentMethod || "Transfer",
    currency: pi.currency || order.currency || "PLN", fxRate: fx,
    netAmount: net, vatRate, vatAmount: vat, grossAmount: gross,
    netPLN: r2(net * fx), grossPLN: r2(gross * fx),
    // v6.51.0: an invoice that travels with the cargo has to describe it. The SO
    // already holds variety, origin, calibre, quality, CN code and the price —
    // previously only the product name and quantity were copied, so the invoice
    // showed amounts with no idea what had been sold.
    positions: arr(order.items).map((it: any) => {
      // v6.65.0 (D-18): a box-priced line invoices in ITS unit — quantity is the
      // box count, unitPrice per box; the kilos ride along in the description.
      // (Previously quantity copied it.qty, which is empty until derived, so a
      // box line produced a 0-quantity position and Fakturownia rejected it.)
      const isBox = String(it.pricingUnit || "") === "box";
      const boxes = Math.round(n(it.boxes));
      const kgQty = n(it.qty) || (isBox && n(it.kgPerBox) > 0 ? r2(boxes * n(it.kgPerBox)) : 0);
      const qty = isBox && boxes > 0 ? boxes : kgQty;
      const price = n(it.unitPrice);
      const lineNet = r2(qty * price);
      const descr = [it.product, it.variety, it.size ? `cal. ${it.size}` : "", it.quality ? `kl. ${it.quality}` : "",
        isBox && kgQty ? `${boxes} × ${it.packaging || "box"} = ${kgQty.toLocaleString("pl-PL")} kg` : ""]
        .filter(Boolean).join(" · ");
      return {
        name: descr || it.product || "",
        product: it.product || "", variety: it.variety || "",
        size: it.size || "", quality: it.quality || "",
        origin: it.origin || "", cnCode: it.cnCode || "",
        packaging: it.packaging || "", pallets: n(it.pallets) || undefined,
        quantity: qty, unit: isBox ? "box" : (it.unit || "kg"),
        unitPrice: price || undefined,
        netTotal: lineNet || undefined,
        vatRate,
        grossTotal: lineNet ? r2(lineNet * (1 + vatRate / 100)) : undefined,
      };
    }),
    links: [{ type: "SO", number: order.number }],
    paymentStatus: (pi.paymentStatus as PaymentStatus) || "Draft",
    paidAmount: n(pi.paidAmount),
    notes: pi.notes || "", attachment: pi.attachment || null,
    allocation: null,
    fakturownia: { exported: !!pi.fktMatched, ref: pi.fktId, legalNumber: pi.fktMatched ? pi.number : undefined },
    source: salesInvoiceSourceTag(order.number, pi.number || pi.id),
    createdAt: pi.createdAt || pi.issueDate || "", locked: pi.paymentStatus === "Sent" || !!pi.fktMatched,
  } as Invoice;
}

export function migrateLegacyInvoices(opts: {
  existing: Invoice[];
  orders: any[];
  warehouseInvoices: any[];
  operationalCosts: any[];
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
  // v6.64.1 (D-17): number-level twin guard. The fold's pushIf only knows its own
  // source markers, so a register invoice written DIRECTLY (e.g. by an import)
  // with the same legal number + counterparty was invisible to it and got folded
  // again. Same number from a DIFFERENT counterparty is legitimate and still folds.
  const normNo = (v: any) => String(v || "").toLowerCase().replace(/\s+/g, "");
  const normParty = (v: any) => String(v || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 24);
  const registerTwins = new Set(
    arr(opts.existing)
      .filter((i: any) => i.kind === "COST" && i.paymentStatus !== "Cancelled" && String(i.number || "").trim())
      .map((i: any) => normNo(i.number) + "|" + normParty(i.counterparty?.name)));
  const hasTwin = (number: any, party: any) => registerTwins.has(normNo(number) + "|" + normParty(party));

  arr(opts.warehouseInvoices).forEach((w: any) => {
    if (hasTwin(w.invoiceNo, w.warehouseName)) return; // v6.64.1 (D-17)
    const src = `migrated:warehouseInvoice:${w.id}`;
    pushIf(src, () => {
      const fx = resolveFxRate(w.fxRate, w.currency);
      const net = r2(n(w.amount) || n(w.amountPLN) / (fx || 1));
      return {
        id: nextId(), kind: "COST", category: "WAREHOUSE", costScope: scopeOf("WAREHOUSE"),
        number: w.invoiceNo || "", counterparty: { name: w.warehouseName || "Warehouse" },
        issueDate: w.date || "", saleDate: w.date || "", dueDate: w.dueDate || "",
        paymentMethod: "Transfer", currency: w.currency || "PLN", fxRate: fx,
        netAmount: net, vatRate: 0, vatAmount: 0, grossAmount: r2(net),
        netPLN: r2(n(w.amountPLN) || net * fx), grossPLN: r2(n(w.amountPLN) || net * fx),
        periodFrom: w.period ? `${w.period}-01` : undefined, periodTo: undefined,
        positions: [], links: [],
        paymentStatus: (w.status === "Approved" ? "Issued" : (w.status as PaymentStatus)) || "Issued",
        paidAmount: 0, notes: w.notes || "", attachment: null,
        allocation: w.allocatedLots ? { method: w.allocationMethod || "by_kg_days", lots: w.allocatedLots } : null,
        fakturownia: { exported: false },
        source: src, createdAt: w.date || "",
      };
    });
  });

  // 3. COST from operationalCosts that carry an invoice number
  arr(opts.operationalCosts).forEach((c: any) => {
    if (!String(c.invoiceNo || "").trim()) return; // payroll/taxes without an invoice stay out
    if (String(c.source || "").startsWith("invoice:")) return; // v6.68.0 (D-34): this opCost IS a mirror of a register invoice — folding it back would loop
    if (hasTwin(c.invoiceNo, c.supplierName)) return; // v6.64.1 (D-17)
    const src = `migrated:opCost:${c.id}`;
    pushIf(src, () => {
      const fx = resolveFxRate(c.fxRate, c.currency);
      const net = r2(n(c.amount));
      const rate = n(c.vatRate);   // v7.26.0 (A-INV-1): the VAT the import found on the invoice (0 for a cost typed by hand)
      const grossAmt = r2(net + r2(net * rate / 100));
      const cat: InvoiceCategory =
        /forward|transport|freight|carrier/i.test(c.category || "") ? "FREIGHT" :
        /custom|broker|cło|clo/i.test(c.category || c.description || "") ? "CUSTOMS" :
        /warehouse|storage|magazyn/i.test(c.category || "") ? "WAREHOUSE" :
        /purchase|goods|towar/i.test(c.category || "") ? "PURCHASE" : "OTHER";
      const scope: CostScope = cat === "OTHER" && c.costCenter === "general" ? "OVERHEAD" : scopeOf(cat);   // v7.26.1: the scope follows the category
      return {
        id: nextId(), kind: "COST", category: (cat === "OTHER" && scope === "OVERHEAD" ? "OVERHEAD" : cat) as InvoiceCategory, costScope: scope,
        number: c.invoiceNo, counterparty: { name: c.supplierName || c.seller || "—" },
        issueDate: c.date || "", saleDate: c.date || "", dueDate: c.dueDate || "",
        paymentMethod: "Transfer", currency: c.currency || "PLN", fxRate: fx,
        netAmount: net, vatRate: rate, vatAmount: r2(grossAmt - net), grossAmount: grossAmt,
        netPLN: r2(net * fx), grossPLN: r2(grossAmt * fx),
        periodFrom: c.period ? `${c.period}-01` : undefined,
        positions: [], links: [],
        paymentStatus: (c.status as PaymentStatus) || "Issued", paidAmount: 0,
        notes: c.notes || c.description || "", attachment: null,
        allocation: null, fakturownia: { exported: false },
        source: src, createdAt: c.date || "",
      };
    });
  });

  // 4. (retired v7.22.1 — FZ-12, Batch F) A firm PO in Arrived / Received / Closed used to become an invented PURCHASE invoice
  //    ("Awaiting the supplier's invoice number"). Those statuses are retired by normalisePO, so it could only fire on an old
  //    backup restored into TEST — and a purchase invoice is never invented from an order: it comes from Fakturownia or is entered.

  return out;
}

/** v7.16.4 (AUD-17): the one summary line of an invoice that has no lines is named from what it is for — its linked
 *  documents — never from the notes, which are free text and would become a line of a legal invoice. */
export function fallbackLineName(inv: any): string {
  const refs = arr<any>(inv?.links).map((l: any) => String(l?.number || "").trim()).filter(Boolean);
  return refs.length ? `Sales invoice — ${refs.join(", ")}`.slice(0, 120) : "Sales invoice";
}

// ── FAKTUROWNIA PUSH PAYLOAD (verified contract, spec §10) ──
// Builds the POST /invoices.json body for a SALES invoice. Auto-numbering (number:null).
// gov_save_and_send defaults OFF — KSeF stays Fakturownia-managed for now.
/** v7.27.4 (AUD-16): the buyer as Fakturownia (and later KSeF) needs it — address, ISO country and the KIND of its tax number: a Polish
*  NIP (kind left empty = NIP), an EU VAT number of another member state ('nip_ue'), another country's tax number ('other'), or none
*  ('empty'). Read from the live company (by id) the caller passes. */
export function buyerFields(inv: any, company: any): Record<string, any> {
const S = (v: any) => String(v ?? "").trim();
const iso = countryIso(company?.countryIso || company?.addr?.country || company?.country || "");
const nip = S(inv?.counterparty?.nip || company?.nip), eu = S(company?.vatEuId);
const out: Record<string, any> = {};
if (!iso || iso === "PL") { out.buyer_tax_no = nip; if (!nip) out.buyer_tax_no_kind = "empty"; }
else if (isEU(iso) && (eu || nip)) { out.buyer_tax_no = eu || nip; out.buyer_tax_no_kind = "nip_ue"; }
else if (nip || eu) { out.buyer_tax_no = nip || eu; out.buyer_tax_no_kind = "other"; }
else { out.buyer_tax_no = ""; out.buyer_tax_no_kind = "empty"; }
const a = company?.addr || {};
if (S(a.street)) out.buyer_street = S(a.street);
if (S(a.postcode)) out.buyer_post_code = S(a.postcode);
if (S(a.city)) out.buyer_city = S(a.city);
if (iso) out.buyer_country = iso;
return out;
}
/** v7.27.4: the invoice's notes as Fakturownia's notes — one entry per line ('Label: text' keeps its label), none longer than the
*  256 characters KSeF accepts (a longer line continues in the next entry). */
export function notesAsDescriptions(notes: any): Array<{ kind: string; content: string }> {
const out: Array<{ kind: string; content: string }> = [];
String(notes ?? "").split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(line => {
const m = line.match(/^([^:]{1,40}):\s*(.+)$/); const kind = m ? m[1].trim() : "Uwaga"; let content = m ? m[2].trim() : line;
while (content.length > 256) { out.push({ kind, content: content.slice(0, 256) }); content = content.slice(256); }
if (content) out.push({ kind, content });
});
return out;
}
export function buildFakturowniaPayload(inv: Invoice, opts: { sellerName?: string; sellerTaxNo?: string; govSaveAndSend?: boolean ; departmentId?: any; buyer?: any; deliveryTerms?: string }) {
  // v6.65.0 (D-07b): Fakturownia requires total_price_gross per position and her
  // first live push proved a position can arrive without stored totals. The
  // payload now derives them in order of preference — stored gross → stored net
  // ×(1+VAT) → quantity×unitPrice×(1+VAT) → the invoice's own gross when it is
  // a single-position document — and never sends a blank.
  const positions = arr<InvoicePosition>(inv.positions).map((p, _i, all) => {
    const qty = n(p.quantity);   // v6.99.116 (AUD-14): a quantity of 0 is 0 — never turned into 1
    const vat = n(p.vatRate ?? inv.vatRate);
    let gross = p.grossTotal != null ? r2(n(p.grossTotal)) : 0;
    if (!gross && (p as any).netTotal != null) gross = r2(n((p as any).netTotal) * (1 + vat / 100));
    if (!gross && (p as any).unitPrice != null) gross = r2(qty * n((p as any).unitPrice) * (1 + vat / 100));
    if (!gross && (p as any).netPrice != null) gross = r2(qty * n((p as any).netPrice) * (1 + vat / 100));
    if (!gross && all.length === 1) gross = r2(n(inv.grossAmount));
    return {
      name: p.name || "—",
      quantity: qty,
      quantity_unit: p.unit || "kg",
      tax: (inv as any).vatCode === "np" ? "np" : vat,   // v7.27.5 (AUD-26): not taxable in Poland
      total_price_gross: gross || (all.length === 1 ? r2(n(inv.grossAmount)) : 0),   // v6.99.116 (AUD-14): the invoice total is never spread over lines — an unpriced line stays 0 and blocks the push (pushBlockers)
    };
  }).filter(p => n(p.total_price_gross) > 0);
  // v7.16.4 (AUD-17): rounding each line to the grosz can leave the lines 1–2 grosz off the invoice total; that remainder goes
  // on the largest line, so the invoice Fakturownia issues equals our register. A larger gap is not rounding: it stays, and
  // pushBlockers refuses the push (AUD-14 — the invoice total is never spread over lines).
  { const g = r2(n(inv.grossAmount)); const diff = r2(g - r2(positions.reduce((a, p) => a + n(p.total_price_gross), 0)));
    if (positions.length && g > 0 && diff !== 0 && Math.abs(diff) <= 0.02) {
      let k = 0; positions.forEach((p, i) => { if (n(p.total_price_gross) > n(positions[k].total_price_gross)) k = i; });
      positions[k] = { ...positions[k], total_price_gross: r2(n(positions[k].total_price_gross) + diff) };
    } }
  // If no per-line positions exist (migrated invoices), fall back to one summary line.
  const safePositions = positions.length ? positions : [{
    name: fallbackLineName(inv), quantity: 1, quantity_unit: "szt.",   // v7.16.4 (AUD-17): never named from the notes
    tax: (inv as any).vatCode === "np" ? "np" : n(inv.vatRate), total_price_gross: r2(n(inv.grossAmount)),
    }];
  const body: any = {
    invoice: {
      kind: inv.isProforma ? "proforma" : "vat", // v6.68.1: pro-formas push as pro-formas
      number: null,                 // Fakturownia auto-numbers (Q3-a)
      issue_date: inv.issueDate || undefined,
      sell_date: inv.saleDate || inv.issueDate || undefined,
      payment_to: inv.dueDate || undefined,
      payment_type: (inv.paymentMethod || "transfer").toLowerCase(),
      buyer_name: inv.counterparty?.name || "",
      ...buyerFields(inv, opts.buyer),   // v7.27.4 (AUD-16): address, ISO country, the kind of tax number
      ...((inv as any).reverseCharge ? { reverse_charge: true } : {}),   // v7.27.5 (AUD-26): a service to a business in another EU state
      buyer_company: true,          // clients are companies — needed for KSeF auto-send
      ...(String(opts.deliveryTerms || "").trim() ? { delivery_terms: String(opts.deliveryTerms).trim().slice(0, 256) } : {}),   // v7.27.4: the sale's Incoterms 2020 rule and place
      currency: inv.currency || "PLN",
      positions: safePositions,
      ...(notesAsDescriptions((inv as any).invoiceNotes).length ? { descriptions: notesAsDescriptions((inv as any).invoiceNotes) } : {}),   // v7.26.4 (A-INV-4) / v7.27.4: the notes, one entry per line, ≤256 characters each (KSeF)
      },
  };
  // v6.66.0 (D-07c): seller fields removed. Sending seller_name made Fakturownia
  // try to CREATE a department, which the account's bank-account security level
  // rightly blocks (API-injected departments are an invoice-fraud vector).
  //
  // v6.75.0: the note that used to sit here said "a single-company account
  // applies its default department automatically". This account is NOT
  // single-company — seven departments across two legal entities, each holding
  // one bank account in one currency. So every pushed invoice took the default
  // (Marianna EUR PKO) and a PLN or USD invoice printed a EUR account number to
  // the client, on a document that had already reached KSeF.
  //
  // department_id SELECTS an existing department rather than creating one, so it
  // is safe where seller_name was not. The caller resolves it through
  // chooseDepartment() and must not push while the choice is ambiguous.
  if (opts.departmentId != null && String(opts.departmentId)) {
    body.invoice.department_id = opts.departmentId;
  }

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
  const base = note.noteType === "DEBIT" ? mag : -mag;
  // v6.63.0 (owner axiom): relative to the linked invoice's open amount, a note
  // issued by the OTHER side of the usual issuer flips its sign — e.g. a DEBIT
  // note WE issue against a supplier's cost invoice (claim recovery) REDUCES
  // what remains payable on it. Legacy notes (no issuedBy) keep the old sign.
  const issuedBy = String((note as any).issuedBy || "").toUpperCase();
  const legacyDefault = note.direction === "incoming" ? "COUNTERPARTY" : "US";
  return (issuedBy === "US" || issuedBy === "COUNTERPARTY") && issuedBy !== legacyDefault ? -base : base;
}

/** v6.99.116 (AUD-14): what stops an invoice from being pushed — every line must carry its own price; the lines must add up to the invoice. */
export function pushBlockers(inv: Invoice): string[] {
  const out: string[] = []; const ps = arr<InvoicePosition>(inv.positions);
  if (ps.length > 1) {
    ps.forEach((p, i) => { const priced = n((p as any).grossTotal) > 0 || n((p as any).netTotal) > 0 || (p as any).unitPrice != null || (p as any).netPrice != null; if (!priced) out.push(`line ${i + 1} (${String(p.name || "").trim() || "unnamed"}) has no price`); if (!(n(p.quantity) > 0)) out.push(`line ${i + 1} (${String(p.name || "").trim() || "unnamed"}) has no quantity`); });
    const payload = buildFakturowniaPayload(inv, {} as any).invoice.positions;
    const sum = r2(payload.reduce((a: number, x: any) => a + n(x.total_price_gross), 0)); const g = r2(n(inv.grossAmount));
    if (g > 0 && Math.abs(sum - g) > 0.02) out.push(`the lines add up to ${sum.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} but the invoice says ${g.toLocaleString("pl-PL", { minimumFractionDigits: 2 })}`);
  }
  return out;
}
