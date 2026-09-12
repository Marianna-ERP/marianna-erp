// ─────────────────────────────────────────────────────────────────────────────
// po.domain.ts — v6.94.0: PURCHASE ORDER RULES (owner decisions PO-1…PO-9, 9 Sept 2026)
//   PO-1 box as an ordered unit: pricingUnit kg|box per line; type one, the other derives
//   PO-2 paymentDays (default from the supplier); due date = invoice issue date + days
//   PO-3/PO-4 one promised date; stored derivations retired by a one-time normalisation
//   PO-5 legacy statuses (Shipped/Arrived/Received/Closed) → Confirmed
//   PO-6 purchase-invoice price check vs the agreed price × received kg
// Pure.
// ─────────────────────────────────────────────────────────────────────────────
import { kgPerBoxForLine } from "./pricingUnit.domain";

const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

// ── PO-1 ─────────────────────────────────────────────────────────────────────
/** Recompute the derived side of a PO line after the user typed the other. */
export function derivePOLineQuantities(line: any, packagingTypes: any[], changed: "qty" | "boxes" | "unit" | "packaging"): any {
  const unit = String(line?.pricingUnit || "kg").toLowerCase() === "box" ? "box" : "kg";
  const kgPerBox = kgPerBoxForLine(line, packagingTypes);
  const out = { ...line, pricingUnit: unit };
  if (kgPerBox <= 0) return out;                       // cannot convert — leave both as typed
  if (unit === "box") {
    if (changed !== "qty") out.qty = Math.round(num(line.boxes) * kgPerBox * 1000) / 1000;
    else out.boxes = Math.round(num(line.qty) / kgPerBox);
  } else {
    if (changed !== "boxes") out.boxes = num(line.qty) > 0 ? Math.round(num(line.qty) / kgPerBox) : line.boxes;
    else out.qty = Math.round(num(line.boxes) * kgPerBox * 1000) / 1000;
  }
  out.kgPerBox = kgPerBox;
  return out;
}
/** Line value in the PO currency, whatever the unit. */
export function poLineValue(line: any): number {
  const unit = String(line?.pricingUnit || "kg").toLowerCase();
  return r2((unit === "box" ? num(line?.boxes) : num(line?.qty)) * num(line?.unitPrice));
}

// ── PO-2 ─────────────────────────────────────────────────────────────────────
export function paymentDaysFor(po: any, supplier: any): number {
  const own = num(po?.paymentDays);
  if (own > 0) return own;
  const inherited = num(supplier?.paymentTermsDays);
  if (inherited > 0) return inherited;
  const m = S(po?.paymentTerms).match(/(\d{1,3})/);   // legacy free text "30 days"
  return m ? num(m[1]) : 0;
}
export function dueDateFromIssue(issueISO: string, days: number): string {
  const m = S(issueISO).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m || !(days > 0)) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Math.round(days));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── PO-3 / PO-4 / PO-5: one-time normalisation (idempotent) ─────────────────
export const LEGACY_PO_STATUSES = ["Shipped", "Arrived", "Received", "Closed"];
export function normalisePO(po: any, ctx: { orders?: any[]; directFromSOs?: (po: any, orders: any[]) => boolean } = {}): { po: any; changed: boolean } {
  let p: any = { ...po }; let changed = false;
  const drop = (k: string) => { if (k in p) { delete p[k]; changed = true; } };
  if (!S(p.buyIncoterm) && S(p.purchaseIncoterm)) { p.buyIncoterm = p.purchaseIncoterm; changed = true; }
  if (!S(p.loadingDate) && S(p.expectedDeliveryDate)) { p.loadingDate = p.expectedDeliveryDate; changed = true; }
  ["flow", "flowLabel", "purchaseIncoterm", "handoverPoint", "requiresSea", "variance", "actualAvailabilityDate"].forEach(drop);   // expectedDeliveryDate: read-forward until the DDL (PO-3 partial)
  if (LEGACY_PO_STATUSES.includes(S(p.status))) { p.status = "Confirmed"; p.statusNormalisedFrom = po.status; changed = true; }
  if (!(num(p.paymentDays) > 0)) { const m = S(p.paymentTerms).match(/(\d{1,3})/); if (m) { p.paymentDays = num(m[1]); changed = true; } }
  if (Array.isArray(p.items)) {
    const items = p.items.map((it: any) => {
      const n: any = { ...it };
      if ("currency" in n) { delete n.currency; changed = true; }
      if (!n.pricingUnit) { n.pricingUnit = "kg"; changed = true; }
      return n;
    });
    p.items = items;
  }
  if (ctx.directFromSOs && Array.isArray(ctx.orders)) {
    const d = ctx.directFromSOs(p, ctx.orders);
    if (p.directFlow !== d) { p.directFlow = d; changed = true; }   // kept as a SYNCED derivation for readers; never typed
  }
  return { po: p, changed };
}

// ── PO-6 ─────────────────────────────────────────────────────────────────────
export interface PriceVariance { poNumber: string; invoiceNumber: string; agreedPLN: number; invoicedPLN: number; diffPLN: number; diffPct: number; }
/** Purchase invoice net vs agreed price × received (or ordered) kg, at the PO's locked rate. */
export function purchaseInvoiceVariance(inv: any, po: any, lots: any[], tolerancePct = 1): PriceVariance | null {
  if (!inv || !po || inv.kind !== "COST") return null;
  const fx = num(po.fxRate) || 1;
  const myLots = (lots || []).filter(l => String(l.poRef) === String(po.number));
  let agreed = 0;
  (po.items || []).forEach((it: any, i: number) => {
    const lot = myLots.find(l => String(l.poLineId ?? "") === String(it.id ?? i + 1));
    const kg = lot && num(lot.receivedKg) > 0 ? num(lot.receivedKg) : num(it.qty);
    const unit = String(it.pricingUnit || "kg").toLowerCase();
    const pricePerKg = unit === "box" && num(it.kgPerBox) > 0 ? num(it.unitPrice) / num(it.kgPerBox) : num(it.unitPrice);
    agreed += kg * pricePerKg;
  });
  const agreedPLN = r2(agreed * fx);
  const invoicedPLN = r2(num(inv.netPLN) || num(inv.netAmount) * (num(inv.fxRate) || 1));
  if (!(agreedPLN > 0) || !(invoicedPLN > 0)) return null;
  const diff = r2(invoicedPLN - agreedPLN); const pct = r2(diff / agreedPLN * 100);
  if (Math.abs(pct) <= tolerancePct) return null;
  return { poNumber: po.number, invoiceNumber: inv.number || String(inv.id), agreedPLN, invoicedPLN, diffPLN: diff, diffPct: pct };
}
