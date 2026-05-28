// ─── MARGIN / P&L CALCULATIONS ──────────────────────────────────────────────
//
// Pure functions for computing P/L on a Sales Order. No React, no UI — this
// lives by itself so it can be unit-tested and re-used (Finance module, SO
// detail card, Dashboard KPI, future reports).
//
// Two views are supported:
//
//   ACTUAL ("settled")
//     Revenue   = lines that have shipped (via SHIP_OUT movements traceable to this SO).
//     COGS      = lot costs (PLN) × kg shipped, attributed via SHIP_OUT movements.
//     Direct    = shipment costs where invoice has actually been received (status "Received" or "Cost allocated").
//     Use when: looking at historical performance, post-mortem on a delivered SO.
//
//   FORECAST ("expected")
//     Revenue   = full SO commitment (all line totals).
//     COGS      = lot-cost-per-kg × demanded qty for STOCK lines;
//                 PO unit-price × FX × qty for PO-sourced lines (with no LINV/CINV/WINV yet).
//     Direct    = expected shipment costs (full pipeline, regardless of invoice status).
//     Use when: sales is deciding whether to confirm a deal, or comparing to ACTUAL post hoc.
//
// Both views return the same shape so the UI can flip a toggle without
// branching at render time.

export type MarginMode = "forecast" | "actual";

export interface MarginLine {
  label: string;
  amountPLN: number;
  amountSO?: number;  // in SO currency (revenue side; on cost side we generally keep PLN)
  note?: string;
}

export interface MarginBreakdown {
  mode: MarginMode;
  currency: string;       // SO currency (e.g., "PLN", "EUR", "USD")
  fxRate: number;         // 1 SO-currency = fxRate PLN

  // ── revenue ──
  revenueSO: number;      // total in SO currency
  revenuePLN: number;     // total in PLN (revenue × fxRate)
  revenueLines: MarginLine[];

  // ── cost of goods sold (PLN only — these are upstream costs paid in various currencies) ──
  cogsPLN: number;
  cogsLines: MarginLine[];

  // ── direct logistics / costs from shipments ──
  directCostsPLN: number;
  directLines: MarginLine[];

  // ── totals ──
  totalCostsPLN: number;
  marginPLN: number;
  marginSO: number;        // marginPLN ÷ fxRate, for SO-currency display
  marginPct: number;       // marginPLN / revenuePLN × 100 (0 if no revenue)

  // ── meta ──
  warnings: string[];      // anything the UI should call out (e.g., "PO line not yet received — using PO price as proxy")
  hasMissingData: boolean;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function safe(n: any): number {
  const v = parseFloat(n);
  return isFinite(v) ? v : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// COGS per kg for a lot — total cost divided by received qty (not physical).
// This matters because once received, the cost basis is fixed; ship-outs simply
// allocate that cost proportionally.
function lotCostPerKg(lot: any): number {
  const totalPLN = (lot.costs || []).reduce((s: number, c: any) => s + safe(c.pln), 0);
  const denom = safe(lot.receivedKg) || safe(lot.expectedKg);
  return denom > 0 ? totalPLN / denom : 0;
}

// Sum SHIP_OUT kg from this lot that mention the given SO number in the note.
// Inventory's SHIP_OUT movements have notes like "Shipped for SO-2026-0091 (Euro-Papryka)".
function lotShippedKgForSO(lot: any, soNumber: string): number {
  return (lot.movements || [])
    .filter((m: any) => m.type === "SHIP_OUT" && String(m.note || "").includes(soNumber))
    .reduce((s: number, m: any) => s + safe(m.qtyKg), 0);
}

// Same but for REVERSAL (when an SO was cancelled and its ship-out was reversed).
function lotReversedKgForSO(lot: any, soNumber: string): number {
  return (lot.movements || [])
    .filter((m: any) => m.type === "REVERSAL" && String(m.note || "").includes(soNumber))
    .reduce((s: number, m: any) => s + safe(m.qtyKg), 0);
}

// Net kg actually shipped (and not reversed) for this SO from this lot.
function lotNetShippedForSO(lot: any, soNumber: string): number {
  return Math.max(0, lotShippedKgForSO(lot, soNumber) - lotReversedKgForSO(lot, soNumber));
}

// Find a PO line referenced by a stock-out SO item.
// PO shape varies between standalone-stub and integrated — handle both:
//   { number, items: [{ id, product, unitPrice, qty, ... }], currency, fxRate, ... }
function findPOLine(pos: any[], poNumber: string, poLineId: any): { po: any; line: any } | null {
  const po = (pos || []).find((p: any) => p.number === poNumber);
  if (!po) return null;
  const line = (po.items || []).find((l: any) => String(l.id) === String(poLineId ?? 1)) || (po.items || [])[0];
  if (!line) return null;
  return { po, line };
}

// ─── REVENUE ────────────────────────────────────────────────────────────────

function computeRevenue(order: any, mode: MarginMode): { lines: MarginLine[]; totalSO: number } {
  const lines: MarginLine[] = [];
  let totalSO = 0;
  (order.items || []).forEach((it: any) => {
    const qty = safe(it.qty);
    const price = safe(it.unitPrice);
    const lineTotal = qty * price;
    let label = `${it.product || "—"} · ${qty.toLocaleString("pl-PL")} kg @ ${price} ${order.currency || "PLN"}/kg`;
    let amountSO = lineTotal;
    let note: string | undefined;

    if (mode === "actual") {
      // For "actual" view, we'd ideally count only the qty truly shipped. But
      // we don't have per-line ship-tracking — the lot's SHIP_OUT movements
      // only sum kg, not per-line revenue. For now: treat shipped/delivered/invoiced
      // SOs as 100% revenue, and not-yet-shipped lines as 0.
      const isLineShipped = ["Shipped", "Delivered", "Invoiced", "Closed"].includes(order.status);
      if (!isLineShipped) {
        amountSO = 0;
        note = "Not yet shipped";
      }
    }

    totalSO += amountSO;
    lines.push({ label, amountSO, amountPLN: round2(amountSO * safe(order.fxRate || 1)), note });
  });
  return { lines, totalSO: round2(totalSO) };
}

// ─── COGS ───────────────────────────────────────────────────────────────────

function computeCOGS(order: any, lots: any[], pos: any[], mode: MarginMode): { lines: MarginLine[]; totalPLN: number; warnings: string[]; hasMissingData: boolean } {
  const lines: MarginLine[] = [];
  let totalPLN = 0;
  const warnings: string[] = [];
  let hasMissingData = false;

  (order.items || []).forEach((it: any) => {
    const qty = safe(it.qty);
    const product = it.product || "—";

    if (it.sourceType === "STOCK" && it.sourceRef) {
      // STOCK-sourced line — find the lot and compute COGS
      const lot = (lots || []).find((l: any) => l.number === it.sourceRef);
      if (!lot) {
        warnings.push(`Line "${product}": referenced lot ${it.sourceRef} not found — COGS unknown.`);
        hasMissingData = true;
        return;
      }
      const costPerKg = lotCostPerKg(lot);
      let attributableKg = qty;
      if (mode === "actual") {
        // For ACTUAL view, only attribute the kg actually shipped from this lot for this SO
        const shipped = lotNetShippedForSO(lot, order.number);
        attributableKg = shipped;
        if (shipped === 0 && qty > 0 && ["Shipped", "Delivered", "Invoiced", "Closed"].includes(order.status)) {
          // SO claims to be shipped but no SHIP_OUT recorded against this lot — data gap
          warnings.push(`Line "${product}": SO is ${order.status} but no SHIP_OUT movement recorded against ${lot.number}. COGS may be understated.`);
          hasMissingData = true;
        }
      }
      const linePLN = round2(attributableKg * costPerKg);
      totalPLN += linePLN;
      lines.push({
        label: `${product} · ${attributableKg.toLocaleString("pl-PL")} kg from ${lot.number} @ ${round2(costPerKg)} PLN/kg`,
        amountPLN: linePLN,
        note: lot.costs?.length ? `${lot.costs.length} cost component(s) on lot` : "Lot has no cost data yet",
      });
      if (!lot.costs || lot.costs.length === 0) {
        warnings.push(`Line "${product}": lot ${lot.number} has no cost data — COGS shown as 0.`);
        hasMissingData = true;
      }
    } else if (it.sourceType === "PO" && it.sourceRef) {
      // PO-sourced line — use the PO's purchase price as proxy
      const found = findPOLine(pos, it.sourceRef, it.sourceLineId);
      if (!found) {
        warnings.push(`Line "${product}": referenced PO ${it.sourceRef} not found — COGS unknown.`);
        hasMissingData = true;
        return;
      }
      const { po, line } = found;
      const poPrice = safe(line.unitPrice);
      const poFx = safe(po.fxRate || 1) || 1;
      const purchaseCostPLN = round2(qty * poPrice * poFx);

      if (mode === "actual") {
        // Has the PO arrived? If a lot has been auto-created for this PO line, count its actual costs;
        // otherwise the goods haven't physically moved yet, so COGS = 0 for ACTUAL view
        const matchingLot = (lots || []).find((l: any) => l.poRef === po.number && (l.product || "").toLowerCase() === product.toLowerCase());
        if (matchingLot) {
          // Use the lot's cost basis × kg shipped
          const costPerKg = lotCostPerKg(matchingLot);
          const shipped = lotNetShippedForSO(matchingLot, order.number);
          const linePLN = round2(shipped * costPerKg);
          totalPLN += linePLN;
          lines.push({
            label: `${product} · ${shipped.toLocaleString("pl-PL")} kg from ${matchingLot.number} (PO ${po.number}) @ ${round2(costPerKg)} PLN/kg`,
            amountPLN: linePLN,
          });
        } else {
          // PO not yet arrived → no actual COGS yet
          lines.push({
            label: `${product} · ${qty.toLocaleString("pl-PL")} kg from PO ${po.number} (not yet arrived)`,
            amountPLN: 0,
            note: "PO not yet arrived — actual COGS not yet known",
          });
          if (["Shipped", "Delivered", "Invoiced", "Closed"].includes(order.status)) {
            warnings.push(`Line "${product}": SO is ${order.status} but PO ${po.number} has no matching arrived lot. Cannot compute actual COGS.`);
            hasMissingData = true;
          }
        }
      } else {
        // FORECAST: PO commitment price + an estimate of inland costs?
        // For now: just the purchase price. Logistics costs come from the shipment side.
        totalPLN += purchaseCostPLN;
        lines.push({
          label: `${product} · ${qty.toLocaleString("pl-PL")} kg from PO ${po.number} @ ${poPrice} ${po.currency || "PLN"}/kg`,
          amountPLN: purchaseCostPLN,
          note: "Forecast — purchase price only, logistics counted separately",
        });
      }
    } else {
      warnings.push(`Line "${product}": no source assigned — COGS cannot be computed.`);
      hasMissingData = true;
    }
  });

  return { lines, totalPLN: round2(totalPLN), warnings, hasMissingData };
}

// ─── DIRECT COSTS (logistics) ──────────────────────────────────────────────

function computeDirectCosts(order: any, shipments: any[], mode: MarginMode): { lines: MarginLine[]; totalPLN: number; warnings: string[] } {
  const lines: MarginLine[] = [];
  const warnings: string[] = [];
  let totalPLN = 0;

  // Shipments that link to this SO
  const linked = (shipments || []).filter((s: any) => (s.soRefs || []).includes(order.number));

  if (linked.length === 0) {
    return { lines, totalPLN: 0, warnings };
  }

  linked.forEach((sh: any) => {
    const costs = sh.costs || [];
    costs.forEach((c: any) => {
      const amountPLN = safe(c.amountPLN) || (safe(c.amount) * safe(c.fxRate || 1));
      // Filter by invoice status depending on mode
      if (mode === "actual") {
        // Only count costs that are actually invoiced/allocated
        const invStatus = c.invoiceStatus || "Expected";
        if (invStatus === "Expected") {
          // Skip — not yet a real cost
          return;
        }
      }
      // For FORECAST: count everything regardless of invoice status
      totalPLN += amountPLN;
      lines.push({
        label: `${sh.number} · ${c.type || "cost"} (${c.invoiceStatus || "Expected"})`,
        amountPLN: round2(amountPLN),
        note: c.notes || undefined,
      });
    });
  });

  return { lines, totalPLN: round2(totalPLN), warnings };
}

// ─── MAIN ENTRY POINT ───────────────────────────────────────────────────────

export function computeSOMargin(
  order: any,
  lots: any[],
  pos: any[],
  shipments: any[],
  mode: MarginMode
): MarginBreakdown {
  const currency = order.currency || "PLN";
  const fxRate = safe(order.fxRate || 1) || 1;

  const rev = computeRevenue(order, mode);
  const cogs = computeCOGS(order, lots, pos, mode);
  const direct = computeDirectCosts(order, shipments, mode);

  const revenuePLN = round2(rev.totalSO * fxRate);
  const totalCostsPLN = round2(cogs.totalPLN + direct.totalPLN);
  const marginPLN = round2(revenuePLN - totalCostsPLN);
  const marginSO = round2(marginPLN / fxRate);
  const marginPct = revenuePLN > 0 ? round2((marginPLN / revenuePLN) * 100) : 0;

  return {
    mode,
    currency,
    fxRate,

    revenueSO: rev.totalSO,
    revenuePLN,
    revenueLines: rev.lines,

    cogsPLN: cogs.totalPLN,
    cogsLines: cogs.lines,

    directCostsPLN: direct.totalPLN,
    directLines: direct.lines,

    totalCostsPLN,
    marginPLN,
    marginSO,
    marginPct,

    warnings: [...cogs.warnings, ...direct.warnings],
    hasMissingData: cogs.hasMissingData,
  };
}

// Convenience: aggregate margins across many SOs (for Finance module).
export interface AggregateMargin {
  totalRevenuePLN: number;
  totalCOGSPLN: number;
  totalDirectPLN: number;
  totalMarginPLN: number;
  avgMarginPct: number;
  orderCount: number;
}

export function aggregateMargins(
  orders: any[],
  lots: any[],
  pos: any[],
  shipments: any[],
  mode: MarginMode,
  filter?: (o: any) => boolean
): AggregateMargin {
  const filtered = (orders || []).filter(o => o.status !== "Cancelled").filter(filter || (() => true));
  let totalRev = 0, totalCOGS = 0, totalDirect = 0;
  filtered.forEach(o => {
    const m = computeSOMargin(o, lots, pos, shipments, mode);
    totalRev += m.revenuePLN;
    totalCOGS += m.cogsPLN;
    totalDirect += m.directCostsPLN;
  });
  const totalMargin = round2(totalRev - totalCOGS - totalDirect);
  return {
    totalRevenuePLN: round2(totalRev),
    totalCOGSPLN: round2(totalCOGS),
    totalDirectPLN: round2(totalDirect),
    totalMarginPLN: totalMargin,
    avgMarginPct: totalRev > 0 ? round2((totalMargin / totalRev) * 100) : 0,
    orderCount: filtered.length,
  };
}

// Convenience: group SOs by a key function and compute aggregate per group.
export function groupAndAggregateMargins(
  orders: any[],
  lots: any[],
  pos: any[],
  shipments: any[],
  mode: MarginMode,
  groupBy: (o: any) => string,
  filter?: (o: any) => boolean
): { key: string; agg: AggregateMargin }[] {
  const filtered = (orders || []).filter(o => o.status !== "Cancelled").filter(filter || (() => true));
  const groups: Record<string, any[]> = {};
  filtered.forEach(o => {
    const key = groupBy(o) || "—";
    if (!groups[key]) groups[key] = [];
    groups[key].push(o);
  });
  return Object.entries(groups)
    .map(([key, groupOrders]) => ({ key, agg: aggregateMargins(groupOrders, lots, pos, shipments, mode) }))
    .sort((a, b) => b.agg.totalMarginPLN - a.agg.totalMarginPLN);
}
