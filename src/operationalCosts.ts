import { computeSOMargin, MarginMode, MarginBreakdown } from "./marginCalculations";
import { kgOnInvoice } from "./invoiceKg";   // v7.53.0 (PL-1)
import { overheadPerKgByMonth } from "./correctionCosts.domain";   // v7.53.0 (PL-1)
import { rateOf } from "./fx";   // v7.44.0 (AUD3-L2)
import { parseNum } from "./numbers";   // v7.42.0 (AUD3-B6)

// ─── OPERATIONAL COSTS / OVERHEAD ALLOCATION ────────────────────────────────
// These costs are company-level expenses (salary, rent, accountant, software,
// general petrol, etc.). They are not direct landed costs and should not be
// pushed into inventory lots unless they are linked to a specific shipment.

export type OperationalCostStatus = "Budget" | "Expected" | "Received" | "Posted" | "Paid";
export type OperationalAllocationMethod =
  | "by_revenue"
  | "by_kg_sold"
  | "by_order_count"
  | "by_gross_margin"
  | "by_shipment_count"
  | "manual"
  | "not_allocated";

export type OperationalCostCategory =
  | "salary"
  | "office_rent"
  | "accountant"
  | "petrol"
  | "software"
  | "bank_fees"
  | "insurance"
  | "phone_internet"
  | "office_supplies"
  | "other";

export type OperationalCostCenter = "admin" | "sales" | "operations" | "logistics" | "finance" | "general";

export interface OperationalCost {
  id: number;
  period: string; // YYYY-MM
  date: string;
  category: OperationalCostCategory | string;
  description: string;
  supplierName?: string;
  invoiceNo?: string;   // v6.7: number of the received cost invoice (Fakturownia/KSeF)
  amount: number;
  currency: "PLN" | "EUR" | "USD" | string;
  fxRate: number;
  amountPLN: number;
  costCenter: OperationalCostCenter | string;
  allocationMethod: OperationalAllocationMethod;
  status: OperationalCostStatus;
  allocations?: { soNumber: string; amountPLN: number }[];
  notes?: string;
}

export interface OverheadLine {
  label: string;
  amountPLN: number;
  note?: string;
  costId?: number;
}

export interface OverheadAllocationResult {
  period: string;
  totalPLN: number;
  lines: OverheadLine[];
  warnings: string[];
}

export interface MarginWithOverhead extends MarginBreakdown {
  contributionMarginPLN: number;
  contributionMarginSO: number;
  contributionMarginPct: number;
  overheadCostsPLN: number;
  overheadLines: OverheadLine[];
  netMarginPLN: number;
  netMarginSO: number;
  netMarginPct: number;
  totalCostsWithOverheadPLN: number;
}

export interface NetAggregateMargin {
  totalRevenuePLN: number;
  totalCOGSPLN: number;
  totalDirectPLN: number;
  totalOverheadPLN: number;
  totalContributionPLN: number;
  totalNetMarginPLN: number;
  avgContributionPct: number;
  avgNetMarginPct: number;
  orderCount: number;
}

export const OPERATIONAL_COST_CATEGORIES = [
  { key: "salary", label: "Salary / payroll" },
  { key: "office_rent", label: "Office rent" },
  { key: "accountant", label: "Accountant / bookkeeping" },
  { key: "petrol", label: "General petrol" },
  { key: "software", label: "Software / subscriptions" },
  { key: "bank_fees", label: "Bank fees" },
  { key: "insurance", label: "General insurance" },
  { key: "phone_internet", label: "Phone / internet" },
  { key: "office_supplies", label: "Office supplies" },
  { key: "other", label: "Other overhead" },
];

export const ALLOCATION_METHODS = [
  { key: "by_revenue", label: "By revenue", hint: "Default for general business overhead" },
  { key: "by_kg_sold", label: "By kg sold", hint: "Good for operations/logistics workload" },
  { key: "by_order_count", label: "By order count", hint: "Good for admin/accounting fixed work" },
  { key: "by_gross_margin", label: "By contribution margin", hint: "Rewards/loads profitable orders" },
  { key: "by_shipment_count", label: "By shipment count", hint: "Good for logistics coordination" },
  { key: "manual", label: "Manual allocation", hint: "Use explicit SO amounts" },
  { key: "not_allocated", label: "Do not allocate", hint: "Track cost but exclude from SO P/L" },
];


function safe(n: any): number {
  const v = parseNum(n);
  return isFinite(v) ? v : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}







// ─── v6.32.0 (R7b-6): allocation-basis memoization ──────────────────────────


export function computeSOMarginWithOverhead(
  order: any,
  lots: any[],
  pos: any[],
  shipments: any[],
  mode: MarginMode,
  operationalCosts: OperationalCost[] = [],
  allOrders: any[] = [],
  invoices: any[] = [],
  financeNotes: any[] = []
): MarginWithOverhead {
  const base = computeSOMargin(order, lots, pos, shipments, mode, invoices, financeNotes)   /* v6.99.132 (AUD-34) */;
  // v7.53.0 (PL-1, owner 29 Oct): ONE OVERHEAD RULE — the month's operational costs ÷ the kilos on sales invoices dated that month, times this
  // sale's kilos on its own invoices of that month (the per-cost method is retired); a sale not yet invoiced carries no overhead yet
  const perKg = overheadPerKgByMonth(operationalCosts, invoices, kgOnInvoice);
  const mine = (invoices || []).filter((i: any) => i && i.kind === "SALES" && !["Cancelled", "Draft"].includes(String(i.paymentStatus)) && Number(i.grossAmount) > 0 && (i.links || []).some((l: any) => l && l.type === "SO" && String(l.number) === String(order?.number)));
  const ovLines: any[] = []; let ovTotal = 0;
  mine.forEach((i: any) => { const m = String(i.issueDate || "").slice(0, 7); const kg = kgOnInvoice(i); const rate = perKg[m]; if (!(kg > 0) || !(rate > 0)) return; const pln = round2(kg * rate); ovTotal += pln;
    ovLines.push({ label: `Overheads ${m} — ${kg.toLocaleString("pl-PL")} kg × ${rate.toFixed(3)} PLN/kg (invoice ${i.number})`, amountPLN: pln }); });
  const overhead = { totalPLN: round2(ovTotal), lines: ovLines, warnings: mine.some((i: any) => !(kgOnInvoice(i) > 0)) ? ["A sales invoice of this sale carries no kilos — its share of the month's overheads is unknown"] : [] } as any;
  const contributionMarginPLN = base.marginPLN;
  const contributionMarginSO = base.marginSO;
  const contributionMarginPct = base.marginPct;
  const totalCostsWithOverheadPLN = round2(base.totalCostsPLN + overhead.totalPLN);
  const netMarginPLN = round2(base.revenuePLN - totalCostsWithOverheadPLN);
  const netMarginSO = round2(netMarginPLN / rateOf(base));
  const netMarginPct = base.revenuePLN > 0 ? round2((netMarginPLN / base.revenuePLN) * 100) : 0;

  return {
    ...base,
    contributionMarginPLN,
    contributionMarginSO,
    contributionMarginPct,
    overheadCostsPLN: overhead.totalPLN,
    overheadLines: overhead.lines,
    netMarginPLN,
    netMarginSO,
    netMarginPct,
    totalCostsWithOverheadPLN,
    warnings: [...base.warnings, ...overhead.warnings],
  };
}

export function aggregateNetMargins(
  orders: any[],
  lots: any[],
  pos: any[],
  shipments: any[],
  mode: MarginMode,
  filter?: (o: any) => boolean,
  operationalCosts: OperationalCost[] = [],
  allOrdersForAllocation?: any[]
): NetAggregateMargin {
  const filtered = (orders || []).filter((o: any) => o.status !== "Cancelled").filter(filter || (() => true));
  const allocationUniverse = allOrdersForAllocation && allOrdersForAllocation.length ? allOrdersForAllocation : (orders || []);
  let totalRevenue = 0, totalCOGS = 0, totalDirect = 0, totalOverhead = 0, totalContribution = 0, totalNet = 0;
  filtered.forEach((o: any) => {
    const m = computeSOMarginWithOverhead(o, lots, pos, shipments, mode, operationalCosts, allocationUniverse);
    totalRevenue += m.revenuePLN;
    totalCOGS += m.cogsPLN;
    totalDirect += m.directCostsPLN;
    totalOverhead += m.overheadCostsPLN;
    totalContribution += m.contributionMarginPLN;
    totalNet += m.netMarginPLN;
  });
  return {
    totalRevenuePLN: round2(totalRevenue),
    totalCOGSPLN: round2(totalCOGS),
    totalDirectPLN: round2(totalDirect),
    totalOverheadPLN: round2(totalOverhead),
    totalContributionPLN: round2(totalContribution),
    totalNetMarginPLN: round2(totalNet),
    avgContributionPct: totalRevenue > 0 ? round2((totalContribution / totalRevenue) * 100) : 0,
    avgNetMarginPct: totalRevenue > 0 ? round2((totalNet / totalRevenue) * 100) : 0,
    orderCount: filtered.length,
  };
}

export function groupAndAggregateNetMargins(
  orders: any[],
  lots: any[],
  pos: any[],
  shipments: any[],
  mode: MarginMode,
  groupBy: (o: any) => string,
  filter?: (o: any) => boolean,
  operationalCosts: OperationalCost[] = []
): { key: string; agg: NetAggregateMargin }[] {
  const filtered = (orders || []).filter((o: any) => o.status !== "Cancelled").filter(filter || (() => true));
  const groups: Record<string, any[]> = {};
  filtered.forEach((o: any) => {
    const key = groupBy(o) || "—";
    if (!groups[key]) groups[key] = [];
    groups[key].push(o);
  });
  return Object.entries(groups)
    .map(([key, groupOrders]) => ({ key, agg: aggregateNetMargins(groupOrders, lots, pos, shipments, mode, undefined, operationalCosts, filtered) }))
    .sort((a, b) => b.agg.totalNetMarginPLN - a.agg.totalNetMarginPLN);
}


// ── v6.68.0 (D-34): SINGLE-ENTRY OVERHEAD ────────────────────────────────────
// The register is the source of truth. Every non-cancelled COST invoice with
// costScope OVERHEAD mirrors into exactly one operational cost (source
// `invoice:{id}`, replace-by-ref: edits follow, cancellation removes). Manual
// operational costs — salaries, ZUS, taxes, anything without an invoice — are
// untouched. The reverse mirror (import-tag OVERHEAD → opCost → folded invoice)
// is excluded by source on both sides, so the two mirrors can never loop.
function opCostFromOverheadInvoice(inv: any, keepId?: any): OperationalCost {
  const period = String(inv.issueDate || inv.saleDate || "").slice(0, 7);
  const amount = safe(inv.grossAmount) || safe(inv.netAmount);
  const fx = safe(inv.fxRate) || 1;
  return {
    id: keepId ?? inv.id,
    category: "other",
    description: `${inv.number || "(no number)"} — ${inv.counterparty?.name || ""}`.trim(),
    supplierName: inv.counterparty?.name || "",
    invoiceNo: inv.number || "",
    amount, currency: inv.currency || "PLN", fxRate: fx,
    amountPLN: safe(inv.grossPLN) || Math.round(amount * fx * 100) / 100,
    date: inv.issueDate || "", period,
    status: inv.paymentStatus === "Paid" ? "Paid" : "Received",
    costCenter: "general",
    allocationMethod: "by_revenue",
    source: `invoice:${inv.id}`,
  } as any;
}

export function syncOverheadOpCosts(invoices: any[], opCosts: OperationalCost[]): OperationalCost[] {
  const manual = (opCosts || []).filter((c: any) => !String(c.source || "").startsWith("invoice:"));
  const prevBySource = new Map((opCosts || []).filter((c: any) => String(c.source || "").startsWith("invoice:")).map((c: any) => [String(c.source), c]));
  const mirrors: OperationalCost[] = [];
  (invoices || []).forEach((inv: any) => {
    if (inv?.kind !== "COST" || inv?.costScope !== "OVERHEAD") return;
    if (inv?.paymentStatus === "Cancelled") return;                              // cancel removes the mirror
    if (String(inv?.source || "").startsWith("migrated:opCost")) return;         // that invoice is itself a mirror
    const prev: any = prevBySource.get(`invoice:${inv.id}`);
    mirrors.push(opCostFromOverheadInvoice(inv, prev ? prev.id : undefined));
  });
  return [...manual, ...mirrors];
}
