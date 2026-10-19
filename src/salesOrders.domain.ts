import { noteNames } from "./format";
import { parseNum } from "./numbers";
import { gradeAvailability as gradeAvailabilityOf } from "./seasonOps.domain";
// ─────────────────────────────────────────────────────────────────────────────
// salesOrders.domain.ts — pure availability & reservation engine (Batch 1)
//
// The single home for reservation/availability math, extracted from
// SalesOrders.tsx and Inventory.tsx (which had diverged copies — finding G2).
// Pure: no React, no module state; lots/POs/orders are parameters.
//
// Semantics (pinned by tests, resolving finding B0-2):
//   An OPEN COMMITMENT reserves its UNSHIPPED REMAINDER (v6.41.0, ruling A5):
//     reserved(line) = max(0, line.qty - already-shipped-for-that-SO-line)
//   counted for every SO that is not Draft, not Cancelled, not Closed.
//   - Pre-dispatch (Confirmed/Reserved/Loading): nothing shipped yet, so the
//     remainder equals the full qty — identical to the old behaviour.
//   - Shipped/Delivered/Invoiced with a remainder (e.g. a partial truck loading
//     under one sale): the remainder stays reserved, so it can't be sold twice.
//     The shipped portion was already subtracted via SHIP_OUT, so this never
//     double-subtracts.
//   - Fully shipped: remainder 0, reserves nothing (unchanged common case).
//   - Closed: releases everything (an explicit decision to end the deal).
//   Shipped-per-line is derived from lot SHIP_OUT movements (soRef-tagged;
//   cancellations void them) via shippedKgByLine — no persisted shippedKg.
// ─────────────────────────────────────────────────────────────────────────────
import { SO_PRE_DISPATCH_STATUSES } from "./types";

// v6.41.0 (A5): statuses that still hold an open claim on stock. Everything
// except Draft (not committed), Cancelled (void) and Closed (deal ended).
const NON_RESERVING_STATUSES = new Set(["Draft", "Cancelled", "Closed"]);
export function soReservesStock(status: any): boolean { return !NON_RESERVING_STATUSES.has(String(status)); }

// Shipped kg for one SO line, derived from movements. Memo-free; callers may
// pass a prebuilt per-order map for efficiency, else it is computed on demand.
export function shippedForSOLine(order: any, lineIndex: number, lots: any[], shipments: any[]): number {
  try {
    const r = shippedKgByLine(order, lots || [], shipments || []);
    return (r.perLine && r.perLine[lineIndex]) || 0;
  } catch { return 0; }
}

export function normalizeProduct(p: any): string {
  return (p || "").toLowerCase().trim();
}
// FB-12: two lines match only if the product AND (when both specify a variety)
// the variety agree. If either side has no variety, fall back to product-only
// (backward-compatible with legacy data that lacks variety).
export function productsMatch(a: any, b: any, varA?: any, varB?: any): boolean {
  if (normalizeProduct(a) !== normalizeProduct(b)) return false;
  const va = normalizeProduct(varA), vb = normalizeProduct(varB);
  if (va && vb) return va === vb;
  return true;
}
/** v7.23.2 (A-SOL-1, owner 13 Oct): is this lot a true source for this sale line? Same item and the same variety (both written),
 *  and size, class, origin and coloration agree wherever both carry one. A lot without a variety is never a match. */
export function sourceMatch(line: any, lot: any): "match" | "no-variety" | "different" {
  const n = (v: any) => String(v ?? "").trim().toLowerCase();
  if (n(line?.product) !== n(lot?.product)) return "different";
  if (!n(lot?.variety)) return "no-variety";
  if (!n(line?.variety) || n(line.variety) !== n(lot.variety)) return "different";
  const agree = (a: any, b: any) => !n(a) || !n(b) || n(a) === n(b);
  return agree(line.size, lot.size) && agree(line.grade || line.quality, lot.quality) && agree(line.origin, lot.origin) && agree(line.coloration, lot.coloration) ? "match" : "different";
}
export function soClientName(o: any): string {
  if (o?.clientName) return o.clientName;
  if (o?.client && o.client.name) return o.client.name;
  return "—";
}
export function isPOUsableForConfirmedSO(po: any): boolean {
  if (!po) return false;
  return po.status !== "Draft" && po.status !== "Cancelled";
}

/** SO source-picker semantics: STOCK-sourced draws on this lot from other
 *  pre-dispatch orders. (PO-backed demand is handled separately by the PO-line
 *  reservation functions — the picker shows PO rows on their own.) */

// v6.41.0 (A5): the reserved qty for one SO line under the remainder rule.
// ctx carries lots+shipments so the shipped portion can be derived; without it
// we fall back to the legacy pre-dispatch/full-qty rule (safe, unchanged).
interface ReserveCtx { lots?: any[]; shipments?: any[]; }
function reservedForLine(o: any, it: any, lineIndex: number, fullQty: number, ctx?: ReserveCtx): number {
  if (ctx && ctx.lots) {
    if (!soReservesStock(o.status)) return 0;
    const shipped = shippedForSOLine(o, lineIndex, ctx.lots, ctx.shipments || []);
    return Math.max(0, fullQty - shipped);
  }
  // legacy path (no remainder context available at this call site)
  if (!SO_PRE_DISPATCH_STATUSES.has(effectiveStatusOf(o, ctx))) return 0;   // v6.99.15 (A-R11-9): effective status — loaded goods are not reserved twice
  return fullQty;
}

export function lotReservationsForPicker(lot: any, allOrders: any[], excludeOrderId: any, ctx?: ReserveCtx): any {
  const reservations: any[] = [];
  let totalReserved = 0;
  (allOrders || []).forEach(o => {
    if (o.id === excludeOrderId) return;
    if (!(ctx && ctx.lots) && !SO_PRE_DISPATCH_STATUSES.has(effectiveStatusOf(o, ctx))) return;
    (o.items || []).forEach((it: any, li: number) => {
      if (it.sourceType !== "STOCK") return;
      if (it.sourceRef !== lot.number) return;
      if (!productsMatch(it.product, lot.product, it.variety, lot.variety)) return;
      const full = parseFloat(it.qty) || 0;
      if (full <= 0) return;
      const q = reservedForLine(o, it, li, full, ctx);
      if (q <= 0) return;
      reservations.push({ soNumber: o.number, soId: o.id, status: o.status, qty: q });
      totalReserved += q;
    });
  });
  return {
    liveAvailable: Math.max(0, (lot.availableKg ?? 0) - totalReserved),
    totalReserved,
    reservations,
  };
}

/** Inventory stock-view semantics: also counts PO-backed draws against the lot
 *  produced by that PO, and supports the direct-flow availability basis. */
export function lotReservationsForStock(lot: any, sourceSOs: any[], ctx?: ReserveCtx): any {
  const reservations: any[] = [];
  let totalReserved = 0;
  (sourceSOs || []).forEach(o => {
    if (!soReservesStock(o.status) && !(ctx && ctx.lots)) {
      if (!SO_PRE_DISPATCH_STATUSES.has(effectiveStatusOf(o, ctx))) return;
    }
    (o.items || []).forEach((it: any, li: number) => {
      const matchesStock = it.sourceType === "STOCK" && it.sourceRef === lot.number;
      const matchesPOBackedLot = false;
      if (!matchesStock && !matchesPOBackedLot) return;
      if (!productsMatch(it.product, lot.product, it.variety, lot.variety)) return;
      const full = parseFloat(it.qty) || 0;
      if (full <= 0) return;
      const q = reservedForLine(o, it, li, full, ctx);
      if (q <= 0) return;
      reservations.push({ soNumber: o.number, soId: o.id, status: o.status, clientName: soClientName(o), qty: q, sourceType: it.sourceType });
      totalReserved += q;
    });
  });
  const physical = lot.physicalKg ?? lot.receivedKg ?? 0;
  const availabilityBasis = lotSellableBasis(lot);   // v7.27.7 (FZ-30, P-12): the one rule the data checks read too
  return {
    physicalKg: physical,
    availabilityBasis,
    liveAvailable: Math.max(0, availabilityBasis - totalReserved),
    totalReserved,
    reservations,
  };
}

/** Reservations on one PO line from other pre-dispatch SOs. */

// v6.99.15 (A-R11-9): reservations read the EFFECTIVE status (shipments decide Loading / Shipped / Delivered — W-1).
// An order whose kilos already left the lot as SHIP_OUT must not reserve them a second time.
function effectiveStatusOf(o: any, ctx: any): string {
  const shipments = ctx?.shipments || [];
  if (o?.statusOverride) return String(o.statusOverride);
  const carrying = shipments.filter((s: any) => s && String(s.status) !== "Cancelled" && String(s.purpose || "").toUpperCase() !== "INBOUND" && ((s.soRefs || []).includes(o.number) || (s.goods || []).some((g: any) => g.soRef === o.number)));
  if (carrying.some((s: any) => ["Loaded", "In transit", "Delivered", "Closed"].includes(String(s.status)))) return "Shipped";
  return String(o?.status || "");
}

/**
 * Per-line availability for an SO being edited. Extracted 1:1 from
 * SalesOrders.tsx (incl. the v6.18.24 received-PO exclusion and the
 * wrong-product guards). lots/pos are the picker-adapted shapes
 * (lot.availableKg, poLine.available).
 */
/** v7.27.7 (FZ-30, P-12): the kilos a sale has already TAKEN from a lot — its SHIP_OUT movements, less reversals (a pass-through
 *  pair counts: the goods left to that sale). Read by the sale line's free kilos and by the data checks alike. */
export function takenBySale(lot: any, soNumber: any): number {
  const so = String(soNumber || ""); if (!so) return 0;
  return Math.max(0, (lot?.movements || []).reduce((a: number, m: any) => {
    if (!m || m.voided || String(m.soRef || "") !== so) return a;
    if (m.type === "SHIP_OUT") return a + (parseFloat(m.qtyKg) || 0);
    if (m.type === "REVERSAL") return a - (parseFloat(m.qtyKg) || 0);
    return a;
  }, 0));
}
/** v7.27.7 (FZ-30, P-12 — one rule, one reader): HOW MUCH OF A LOT CAN BE SOLD. A direct lot: its expected kilos (or what is physically
 *  there, if more); a lot not yet received: its expected kilos (it is sold ahead — A-ONE-1); otherwise what is physically there. The
 *  sale lines and the data checks read this same rule (the data check read a stored 'available' that is 0 before the receipt, and
 *  called 18 lots on the real copy 'oversold' that were sold ahead of their arrival). */
export function lotSellableBasis(lot: any): number {
  const physical = parseNum(lot?.physicalKg ?? lot?.receivedKg ?? 0);
  const expected = parseNum(lot?.expectedKg);
  if (lot?.directFlow) return Math.max(expected, physical);
  const notYetReceived = !parseNum(lot?.physicalKg) && !parseNum(lot?.receivedKg) && expected > 0;
  return notYetReceived ? expected : physical;
}

export function computeLineAvailability(soItems: any[], allOrders: any[], currentOrderId: any, lots: any[], pos: any[], shipments?: any[]): any[] {
  const _ctx: ReserveCtx | undefined = lots ? { lots, shipments: shipments || [] } : undefined;
  const LOTS = lots || [];
  const committedFromStock: Record<string, number> = {};

  (allOrders || []).forEach(o => {
    if (o.id === currentOrderId) return;
    if (!(_ctx && _ctx.lots) && !SO_PRE_DISPATCH_STATUSES.has(o.status)) return;
    (o.items || []).forEach((it: any, _li: number) => {
      if (!it.sourceType || !it.sourceRef) return;
      const _full = parseFloat(it.qty) || 0;
      const q = reservedForLine(o, it, _li, _full, _ctx);
      if (q <= 0) return;
      if (it.sourceType === "STOCK") {
        const lot = LOTS.find(l => l.number === it.sourceRef);
        if (!lot) return;
        if (!productsMatch(it.product, lot.product, it.variety, lot.variety)) return;
        committedFromStock[it.sourceRef] = (committedFromStock[it.sourceRef] || 0) + q;
      }
    });
  });

  function lotRemaining(lotNumber: string) {
    const lot = LOTS.find(l => l.number === lotNumber);
    if (!lot) return 0;
    return Math.max(0, lot.availableKg - (committedFromStock[lot.number] || 0));
  }

  // v6.51.0 / v6.58.1 (ROOT CAUSE B) carried to the lot a line names (v7.24.2, A-RV-15 b): what THIS sale already took from its
  // lot is still its own — a pass-through lot shipped to this sale, or a line partly shipped, must not read as supply someone
  // else took. (The rule lived in the old "from a PO" path; the lot path never had it.)
  const selfSO = String((allOrders || []).find((o: any) => o && o.id === currentOrderId)?.number || "");
  const ownShippedFrom = (lot: any) => takenBySale(lot, selfSO);   // v7.27.7 (P-12): the shared rule

  return (soItems || []).map((it: any) => {
    const lineQty = parseFloat(it.qty) || 0;

    let primaryAvailable = 0;
    let primaryProductMismatch = false;
    let gradeOfLine: "I" | "II" | null = null; let gradeStockKg: number | null = null;
    if (it.sourceType === "STOCK" && it.sourceRef) {
      const lot = LOTS.find(l => l.number === it.sourceRef);
      if (lot) {
        if (productsMatch(it.product, lot.product)) {
          primaryAvailable = lotRemaining(it.sourceRef) + ownShippedFrom(lot);   // v7.24.2: + what this sale already took from it
          // v6.99.22 (G-1, owner approval): grade is part of the promise. A sorted lot is not one pool —
          // selling class I that sorting turned into class II is selling what we do not have.
          const sorted = (lot.movements || []).some((m: any) => m && !m.voided && m.type === "RECLASS");
          if (sorted) {
            gradeOfLine = String(it.grade || "I").toUpperCase() === "II" ? "II" : "I";
            const ga = gradeAvailabilityOf(lot, allOrders, currentOrderId);
            gradeStockKg = gradeOfLine === "II" ? ga.stockII : ga.stockI;
            primaryAvailable = Math.max(0, gradeOfLine === "II" ? ga.II : ga.I);
          }
        }
        else primaryProductMismatch = true;
      }
    } 

    // v7.23.2 (A-SOL-1, owner 13 Oct): one statement per line — what its lot still has free; no "other sources", no "combined" figure
    const primaryShortfallAmount = Math.max(0, lineQty - primaryAvailable);

    return {
      lineQty,
      primaryAvailable: Math.round(primaryAvailable * 100) / 100,
      overage: Math.round(primaryShortfallAmount * 100) / 100,
      hasOverage: primaryShortfallAmount > 0.01,
      grade: gradeOfLine,                     // v6.99.22 (G-1): which class this line promises
      gradeStockKg: gradeStockKg,             // and how much of that class is in stock at all
      gradeShort: gradeOfLine ? Math.round(Math.max(0, lineQty - primaryAvailable) * 100) / 100 : 0,
      primaryShortfall: primaryShortfallAmount > 0.01,
      primaryProductMismatch,
    };
  });
}

// ─── v6.32.0: canonical SO-line → lot matcher (A1) ──────────────────────────
// Six modules matched an SO line to its lot with six divergent rules — none
// poLineId-aware except the expected-lot builder (FB-1), none variety-aware
// except the availability engine (FB-12). Real-data consequence: a multi-line
// same-product PO (e.g. 5 apple lines on one PO) resolved EVERY line to the
// FIRST lot, so actual COGS used the wrong cost basis. This is the single rule;
// all modules delegate here.
//   Priority: STOCK → lot by number;
//             PO    → poLineId (authoritative, FB-1) → poRef + product+variety
//                     (FB-12 semantics) → poRef + name only (legacy lots that
//                     predate poLineId/variety), first unclaimed.
export function findLotForSOLine(lots: any[], it: any, opts: { claimed?: Set<string> } = {}): any | null {
  if (!it) return null;
  void opts;   // v7.24.2 (A-RV-15 b): a line names its lot — nothing to claim any more
  if (it.sourceType === "STOCK" && it.sourceRef) {
    return (lots || []).find(l => String(l.number) === String(it.sourceRef)) || null;
  }
  
  return null;
}

// ─── v6.32.0: per-line shipped kg (P1-1 engine) ─────────────────────────────
// Actual revenue used to be all-or-nothing on SO *status*; partial deliveries
// were mis-stated. This computes, per SO line, the kg actually dispatched, from
// two evidence sources with precise dedup:
//   1. lot SHIP_OUT movements for this SO (net of REVERSAL), via the canonical
//      matcher — authoritative once a shipment has POSTED (movements carry
//      shipmentRef);
//   2. safety net: goods rows of DELIVERED/CLOSED shipments that have not
//      posted movements yet (transient failure case). Loaded shipments are
//      deliberately NOT revenue: COGS recognises at posting (Delivered), and
//      recognising revenue earlier than its cost showed absurd mid-flight
//      margins (full revenue, zero cost). At Delivered the two sides align.
// Kg pools are allocated greedily across the SO's lines in order, capped at
// each line's qty, so two lines sourcing the same lot never double-claim.
export function shippedKgByLine(order: any, lots: any[], shipments: any[]): { perLine: number[]; totalKg: number; hasEvidence: boolean } {
  const so = String(order?.number || "");
  const items = order?.items || [];
  const nrm = (s: any) => { const v = String(s || ""); if (v === "Arrived" || v === "In Transit" || v === "In transit") return "Loaded"; if (v === "Confirmed") return "Booked"; return v; };
  const DISPATCHED = new Set(["Delivered", "Closed"]);

  // 1. movement pool per lot (net shipped kg for this SO)
  const movePool = new Map<string, number>();
  (lots || []).forEach((l: any) => {
    let kg = 0;
    (l.movements || []).forEach((m: any) => {
      if (m?.voided) return;
      const matches = m.soRef ? String(m.soRef) === so : noteNames(m.note, so);
      if (!matches) return;
      if (m.type === "SHIP_OUT") kg += Number(m.qtyKg) || 0;
      if (m.type === "REVERSAL") kg -= Number(m.qtyKg) || 0;
    });
    if (kg > 0) movePool.set(String(l.number), kg);
  });

  // 2. goods-row pool from dispatched, not-yet-posted, live shipments
  type GoodsRow = { kg: number; product: any; variety: any; poRef: any; lotRef: any };
  const goodsPool: GoodsRow[] = [];
  (shipments || []).forEach((s: any) => {
    if (!s || s.status === "Cancelled" || !DISPATCHED.has(nrm(s.status))) return;
    const posted = (lots || []).some((l: any) => (l.movements || []).some((m: any) =>
      !m.voided && (m.shipmentRef ? String(m.shipmentRef) === String(s.number) : noteNames(m.note, String(s.number)))));
    if (posted) return; // its kg already live in the movement pool
    const headerSOs = (s.soRefs || []).filter(Boolean).map(String);
    (s.goods || []).forEach((g: any) => {
      if (!g) return;
      const rowSO = g.soRef ? String(g.soRef) : null;
      const belongs = rowSO ? rowSO === so : (headerSOs.length === 1 && headerSOs[0] === so);
      if (!belongs) return;
      const kg = Number(g.qtyKg) || 0;
      if (kg > 0) goodsPool.push({ kg, product: g.product, variety: g.variety, poRef: g.poRef, lotRef: g.lotRef });
    });
  });

  const hasEvidence = movePool.size > 0 || goodsPool.length > 0;
  const claimed = new Set<string>();
  const perLine = items.map((it: any) => {
    let need = Number(it.qty) || 0;
    let got = 0;
    // (1) movements of the line's lot
    const lot = findLotForSOLine(lots, it, { claimed });
    if (lot) {
      claimed.add(String(lot.number));
      const avail = movePool.get(String(lot.number)) || 0;
      const take = Math.min(need, avail);
      if (take > 0) { got += take; need -= take; movePool.set(String(lot.number), avail - take); }
    }
    // (2) goods rows: lotRef → poRef+product/variety → product/variety
    if (need > 0) {
      const passes: ((g: GoodsRow) => boolean)[] = [
        g => !!lot && String(g.lotRef || "") === String(lot.number),
        g => false,
        g => productsMatch(it.product, g.product, it.variety, g.variety),
      ];
      for (const pass of passes) {
        if (need <= 0) break;
        for (const g of goodsPool) {
          if (need <= 0) break;
          if (g.kg <= 0 || !pass(g)) continue;
          const take = Math.min(need, g.kg);
          got += take; need -= take; g.kg -= take;
        }
      }
    }
    return got;
  });
  return { perLine, totalKg: perLine.reduce((a: number, b: number) => a + b, 0), hasEvidence };
}
