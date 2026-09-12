// ─────────────────────────────────────────────────────────────────────────────
// invoicePlus.domain.ts — v6.98.0: INVOICES BATCH (IV-1…IV-7, owner 10 Sept 2026)
// Pure.
// ─────────────────────────────────────────────────────────────────────────────
import { paymentDaysFor, dueDateFromIssue } from "./po.domain";

const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

// ── IV-3: ONE classification ──────────────────────────────────────────────────
export const CATEGORIES = ["SALES", "COMMISSION", "PURCHASE", "FREIGHT", "CUSTOMS", "WAREHOUSE", "OVERHEAD", "OTHER"] as const;
export type Category = typeof CATEGORIES[number];
export function scopeOf(category: any): "SALES" | "PURCHASE" | "SHIPMENT" | "OVERHEAD" | "OTHER" {
  const c = S(category).toUpperCase();
  if (c === "SALES" || c === "COMMISSION" || c === "SINV") return "SALES";
  if (c === "PURCHASE") return "PURCHASE";
  if (c === "FREIGHT" || c === "CUSTOMS" || c === "WAREHOUSE" || c === "LOGISTICS") return "SHIPMENT";
  if (c === "OVERHEAD") return "OVERHEAD";
  return "OTHER";
}
/** Fold the three legacy classifiers into one category (idempotent). */
export function normaliseInvoiceCategory(inv: any): { inv: any; changed: boolean } {
  const i: any = { ...inv }; let changed = false;
  const kind = S(i.kind).toUpperCase(); const cat = S(i.category).toUpperCase(); const scope = S(i.costScope).toUpperCase();
  let next: Category | null = null;
  if (kind === "SALES") next = cat === "COMMISSION" ? "COMMISSION" : "SALES";
  else if (cat === "PURCHASE" || cat === "PINV") next = "PURCHASE";
  else if (cat === "WAREHOUSE" || cat === "WINV") next = "WAREHOUSE";
  else if (cat === "CUSTOMS" || cat === "CINV") next = "CUSTOMS";
  else if (cat === "LOGISTICS" || cat === "LINV" || cat === "FREIGHT" || scope === "SHIPMENT") next = "FREIGHT";
  else if (scope === "OVERHEAD" || cat === "OVERHEAD") next = "OVERHEAD";
  else if (CATEGORIES.includes(cat as Category)) next = cat as Category;
  else next = "OTHER";
  if (i.category !== next) { i.category = next; changed = true; }
  const derivedScope = scopeOf(next);
  if (i.costScope !== derivedScope) { i.costScope = derivedScope; changed = true; }   // kept as a SYNCED derivation for readers
  ["creditNoteIds", "locked"].forEach(k => { if (k in i) { delete i[k]; changed = true; } });   // IV-5
  return { inv: i, changed };
}

// ── IV-4: lifecycle vs settlement state ───────────────────────────────────────
export function invoiceLifecycle(inv: any): "Draft" | "Issued" | "Sent" | "Cancelled" {
  const s = S(inv?.paymentStatus);
  if (s === "Cancelled") return "Cancelled";
  if (s === "Draft") return "Draft";
  if (s === "Sent") return "Sent";
  if (s === "Paid" || s === "Partially paid" || s === "Overdue") return inv?.fakturownia?.exported || inv?.sentAt ? "Sent" : "Issued";
  return "Issued";
}
export function settlementState(inv: any, todayISO: string): "Unpaid" | "Partially paid" | "Paid" | "Overdue" | "—" {
  if (invoiceLifecycle(inv) === "Cancelled" || invoiceLifecycle(inv) === "Draft" || inv?.isProforma) return "—";
  const gross = num(inv?.grossAmount), paid = num(inv?.paidAmount);
  if (gross > 0 && paid >= gross - 0.01) return "Paid";
  if (paid > 0) return "Partially paid";
  return S(inv?.dueDate) && S(inv.dueDate) < S(todayISO) ? "Overdue" : "Unpaid";
}

// ── IV-1: a cost invoice must name what it pays for ───────────────────────────
export function requiredLinkMissing(inv: any): string {
  if (S(inv?.kind).toUpperCase() !== "COST") return "";
  if (inv?.isProforma) return "";
  const scope = scopeOf(inv?.category || (S(inv?.costScope) === "OVERHEAD" ? "OVERHEAD" : ""));
  if (scope === "OVERHEAD") return "";
  const links = (inv?.links || []).filter((l: any) => ["PO", "SHIPMENT", "LOT", "SET"].includes(S(l.type).toUpperCase()));
  return links.length ? "" : "A cost invoice must name what it pays for — link the purchase order, the shipment or the lot (or classify it as overhead) before it leaves Draft. Unlinked freight never reaches landed cost or the truck's settlement.";
}
export interface LinkProposal { type: "PO" | "SHIPMENT" | "LOT"; number: string; reason: string; confidence: "high" | "medium"; costId?: any; }
/** Propose links from the text (PO-/SHP-/LOT- numbers) and from expected cost lines (same carrier, same amount ±1 %). */
export function proposeLinks(inv: any, ctx: { pos?: any[]; shipments?: any[]; lots?: any[] }): LinkProposal[] {
  const out: LinkProposal[] = [];
  const text = [inv?.notes, inv?.description, inv?.source, ...((inv?.positions || []).map((p: any) => p.name))].map(S).join(" ");
  const seen = new Set<string>();
  (text.match(/\b(PO|SHP|LOT)-\d{4}-\d{4}\b/gi) || []).forEach(m => { const n = m.toUpperCase(); if (seen.has(n)) return; seen.add(n); out.push({ type: n.startsWith("PO") ? "PO" : n.startsWith("SHP") ? "SHIPMENT" : "LOT", number: n, reason: "number quoted on the invoice", confidence: "high" }); });
  const cpId = inv?.counterparty?.id; const cpName = S(inv?.counterparty?.name).toLowerCase();
  const gross = num(inv?.grossAmount) || num(inv?.netAmount);
  (ctx.shipments || []).forEach(sh => {
    if (!sh || String(sh.status) === "Cancelled") return;
    (sh.costs || []).forEach((c: any) => {
      if (S(c.invoiceStatus) === "Received" || S(c.invoiceStatus) === "Checked") return;
      const sameParty = (cpId != null && String(c.supplierId) === String(cpId));
      const amt = num(c.amount) || num(c.amountPLN);
      const sameAmount = gross > 0 && amt > 0 && Math.abs(amt - gross) / gross <= 0.01;
      if (sameParty && sameAmount && !seen.has(sh.number)) { seen.add(sh.number); out.push({ type: "SHIPMENT", number: sh.number, reason: `expected ${c.label || c.type} of ${amt.toLocaleString("pl-PL")} from the same carrier`, confidence: "high", costId: c.id }); }
      else if (sameParty && !seen.has(sh.number) && (sh.costs || []).length === 1) { seen.add(sh.number); out.push({ type: "SHIPMENT", number: sh.number, reason: "the only open expected cost from this carrier", confidence: "medium", costId: c.id }); }
    });
  });
  void cpName;
  return out;
}

// ── IV-2: expected cost line ↔ invoice, by reference, one action ──────────────
export function matchInvoiceToCostLine(sh: any, costId: any, inv: any): { sh: any; variance: number; variancePct: number | null } {
  let variance = 0, variancePct: number | null = null;
  const costs = (sh.costs || []).map((c: any) => {
    if (String(c.id) !== String(costId)) return c;
    const expected = num(c.amount) || num(c.amountPLN);
    const invoiced = num(inv?.grossAmount) || num(inv?.netAmount);
    variance = r2(invoiced - expected); variancePct = expected > 0 ? r2(variance / expected * 100) : null;
    return { ...c, invoiceStatus: "Received", invoiceId: inv.id, invoiceNumber: inv.number, invoicedAmount: invoiced, invoiceVariance: variance };
  });
  return { sh: { ...sh, costs }, variance, variancePct };
}

// ── IV-6: header = Σ positions when positions exist ───────────────────────────
export function positionsMismatch(inv: any): string {
  const pos = inv?.positions || []; if (!pos.length) return "";
  const sum = r2(pos.reduce((s: number, p: any) => s + (num(p.grossTotal) || num(p.total) || num(p.quantity) * num(p.unitPrice) * (1 + num(p.vatRate) / 100)), 0));
  const gross = r2(num(inv?.grossAmount));
  if (!(gross > 0) || Math.abs(sum - gross) <= 0.05) return "";
  return `Positions add up to ${sum.toLocaleString("pl-PL")} but the header says ${gross.toLocaleString("pl-PL")} ${inv?.currency || ""} — one of them is wrong.`;
}

// ── IV-7: due date for an unlinked cost invoice from the counterparty's terms ──
export function defaultCostDueDate(inv: any, counterparty: any): string {
  const days = paymentDaysFor({}, counterparty); return dueDateFromIssue(S(inv?.issueDate), days);
}
