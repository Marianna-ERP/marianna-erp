import { computeSOMargin, MarginMode, MarginBreakdown } from "./marginCalculations";

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

export const INIT_OPERATIONAL_COSTS: OperationalCost[] = [
  {
    id: 9001,
    period: "2026-05",
    date: "2026-05-31",
    category: "salary",
    description: "Operations and sales salaries - May budget",
    supplierName: "Internal payroll",
    amount: 42000,
    currency: "PLN",
    fxRate: 1,
    amountPLN: 42000,
    costCenter: "operations",
    allocationMethod: "by_kg_sold",
    status: "Budget",
    notes: "Forecast overhead allocation for May testing.",
  },
  {
    id: 9002,
    period: "2026-05",
    date: "2026-05-10",
    category: "office_rent",
    description: "Office rent - May",
    supplierName: "Office landlord",
    amount: 7500,
    currency: "PLN",
    fxRate: 1,
    amountPLN: 7500,
    costCenter: "admin",
    allocationMethod: "by_revenue",
    status: "Received",
    notes: "General monthly overhead.",
  },
  {
    id: 9003,
    period: "2026-05",
    date: "2026-05-15",
    category: "accountant",
    description: "Accounting fee - May",
    supplierName: "Accounting office",
    amount: 2200,
    currency: "PLN",
    fxRate: 1,
    amountPLN: 2200,
    costCenter: "finance",
    allocationMethod: "by_order_count",
    status: "Received",
    notes: "Monthly accounting fee allocated evenly by active SO.",
  },
  {
    id: 9004,
    period: "2026-05",
    date: "2026-05-20",
    category: "petrol",
    description: "General petrol / errands - May",
    supplierName: "Fuel cards",
    amount: 1850,
    currency: "PLN",
    fxRate: 1,
    amountPLN: 1850,
    costCenter: "logistics",
    allocationMethod: "by_shipment_count",
    status: "Expected",
    notes: "Only included in Forecast until posted/received.",
  },
];

function safe(n: any): number {
  const v = parseFloat(n);
  return isFinite(v) ? v : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function orderPeriod(order: any): string {
  return String(order.orderDate || order.deliveryDate || "").substring(0, 7) || "—";
}

function activeForOverhead(order: any): boolean {
  return !!order && order.status !== "Draft" && order.status !== "Cancelled";
}

function countableCost(cost: OperationalCost, mode: MarginMode): boolean {
  if (!cost || cost.allocationMethod === "not_allocated") return false;
  if (mode === "forecast") return ["Budget", "Expected", "Received", "Posted", "Paid"].includes(cost.status || "Expected");
  // Batch 5d (BP-38): in ACTUAL mode the honest evidence of spend is a real cost
  // invoice — an entry linked to one (invoiceRef) counts regardless of its status
  // label. The status path remains for entries not yet linked (legacy data).
  if ((cost as any).invoiceRef) return true;
  return ["Received", "Posted", "Paid"].includes(cost.status || "Expected");
}

function kgForOrder(order: any, mode: MarginMode): number {
  if (mode === "actual" && !["Shipped", "Delivered", "Invoiced", "Closed"].includes(order.status)) return 0;
  return (order.items || []).reduce((s: number, it: any) => s + safe(it.qty), 0);
}

function shipmentCountForOrder(order: any, shipments: any[]): number {
  const number = String(order.number || "");
  const linked = (shipments || []).filter((s: any) => (s.soRefs || []).includes(number) || (s.linkedSORefs || []).includes(number));
  return linked.length || 1;
}

function basisForOrder(
  method: OperationalAllocationMethod,
  order: any,
  lots: any[],
  pos: any[],
  shipments: any[],
  mode: MarginMode
): number {
  if (!activeForOverhead(order)) return 0;
  if (method === "by_order_count") return 1;
  if (method === "by_kg_sold") return Math.max(0, kgForOrder(order, mode));
  if (method === "by_shipment_count") return Math.max(0, shipmentCountForOrder(order, shipments));
  const base = computeSOMargin(order, lots, pos, shipments, mode);
  if (method === "by_gross_margin") return Math.max(0, base.marginPLN);
  // Default: by revenue
  return Math.max(0, base.revenuePLN);
}

export function computeAllocatedOverhead(
  order: any,
  allOrders: any[],
  lots: any[],
  pos: any[],
  shipments: any[],
  operationalCosts: OperationalCost[] = [],
  mode: MarginMode
): OverheadAllocationResult {
  const period = orderPeriod(order);
  const lines: OverheadLine[] = [];
  const warnings: string[] = [];
  let totalPLN = 0;

  if (!activeForOverhead(order)) return { period, totalPLN: 0, lines, warnings };

  const periodOrders = (allOrders && allOrders.length ? allOrders : [order]).filter((o: any) => activeForOverhead(o) && orderPeriod(o) === period);
  const periodCosts = (operationalCosts || []).filter((c: OperationalCost) => String(c.period || "") === period && countableCost(c, mode));

  periodCosts.forEach((cost: OperationalCost) => {
    const amountPLN = safe(cost.amountPLN) || safe(cost.amount) * (safe(cost.fxRate) || 1);
    if (amountPLN <= 0) return;

    if (cost.allocationMethod === "manual") {
      const manual = (cost.allocations || []).find(a => String(a.soNumber) === String(order.number));
      const manualAmount = manual ? safe(manual.amountPLN) : 0;
      if (manualAmount > 0) {
        totalPLN += manualAmount;
        lines.push({
          label: `${cost.description || cost.category} · manual allocation`,
          amountPLN: round2(manualAmount),
          note: `${cost.status} · ${cost.costCenter}`,
          costId: cost.id,
        });
      }
      return;
    }

    const method = (cost.allocationMethod || "by_revenue") as OperationalAllocationMethod;
    const denominator = periodOrders.reduce((s: number, o: any) => s + basisForOrder(method, o, lots, pos, shipments, mode), 0);
    const numerator = basisForOrder(method, order, lots, pos, shipments, mode);
    if (denominator <= 0 || numerator <= 0) {
      warnings.push(`Overhead "${cost.description || cost.category}" could not be allocated by ${method.replace(/_/g, " ")} because allocation basis is zero.`);
      return;
    }
    const allocated = round2(amountPLN * numerator / denominator);
    totalPLN += allocated;
    lines.push({
      label: `${cost.description || cost.category} · ${method.replace(/_/g, " ")}`,
      amountPLN: allocated,
      note: `${cost.status} · ${cost.costCenter} · ${period}`,
      costId: cost.id,
    });
  });

  return { period, totalPLN: round2(totalPLN), lines, warnings };
}

export function computeSOMarginWithOverhead(
  order: any,
  lots: any[],
  pos: any[],
  shipments: any[],
  mode: MarginMode,
  operationalCosts: OperationalCost[] = [],
  allOrders: any[] = []
): MarginWithOverhead {
  const base = computeSOMargin(order, lots, pos, shipments, mode);
  const overhead = computeAllocatedOverhead(order, allOrders && allOrders.length ? allOrders : [order], lots, pos, shipments, operationalCosts, mode);
  const contributionMarginPLN = base.marginPLN;
  const contributionMarginSO = base.marginSO;
  const contributionMarginPct = base.marginPct;
  const totalCostsWithOverheadPLN = round2(base.totalCostsPLN + overhead.totalPLN);
  const netMarginPLN = round2(base.revenuePLN - totalCostsWithOverheadPLN);
  const netMarginSO = round2(netMarginPLN / (base.fxRate || 1));
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
