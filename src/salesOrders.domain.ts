// ─────────────────────────────────────────────────────────────────────────────
// salesOrders.domain.ts — pure availability & reservation engine (Batch 1)
//
// The single home for reservation/availability math, extracted from
// SalesOrders.tsx and Inventory.tsx (which had diverged copies — finding G2).
// Pure: no React, no module state; lots/POs/orders are parameters.
//
// Semantics (pinned by tests, resolving finding B0-2):
//   Only PRE-DISPATCH orders reserve stock: Confirmed / Reserved / Loading.
//   Shipped+ orders already had their kg physically subtracted via SHIP_OUT
//   movements, so counting them again would double-subtract. Draft/Cancelled
//   never reserve. Inventory's unused 7-status set was dead code — removed.
// ─────────────────────────────────────────────────────────────────────────────
import { SO_PRE_DISPATCH_STATUSES } from "./types";

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
/** Variety-aware match between two line-like objects ({product, variety}). */
export function linesMatch(x: any, y: any): boolean {
  return productsMatch(x?.product, y?.product, x?.variety, y?.variety);
}
export function productVarietyKey(x: any): string {
  const p = normalizeProduct(x?.product);
  const v = normalizeProduct(x?.variety);
  return v ? `${p}|${v}` : p;
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
export function lotReservationsForPicker(lot: any, allOrders: any[], excludeOrderId: any): any {
  const reservations: any[] = [];
  let totalReserved = 0;
  (allOrders || []).forEach(o => {
    if (o.id === excludeOrderId) return;
    if (!SO_PRE_DISPATCH_STATUSES.has(o.status)) return;
    (o.items || []).forEach((it: any) => {
      if (it.sourceType !== "STOCK") return;
      if (it.sourceRef !== lot.number) return;
      if (!productsMatch(it.product, lot.product, it.variety, lot.variety)) return;
      const q = parseFloat(it.qty) || 0;
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
export function lotReservationsForStock(lot: any, sourceSOs: any[]): any {
  const reservations: any[] = [];
  let totalReserved = 0;
  (sourceSOs || []).forEach(o => {
    if (!SO_PRE_DISPATCH_STATUSES.has(o.status)) return;
    (o.items || []).forEach((it: any) => {
      const matchesStock = it.sourceType === "STOCK" && it.sourceRef === lot.number;
      const matchesPOBackedLot = it.sourceType === "PO" && lot.poRef === it.sourceRef && productsMatch(it.product, lot.product, it.variety, lot.variety);
      if (!matchesStock && !matchesPOBackedLot) return;
      if (!productsMatch(it.product, lot.product, it.variety, lot.variety)) return;
      const q = parseFloat(it.qty) || 0;
      if (q <= 0) return;
      reservations.push({ soNumber: o.number, soId: o.id, status: o.status, clientName: soClientName(o), qty: q, sourceType: it.sourceType });
      totalReserved += q;
    });
  });
  const directBasis = lot.directFlow ? (parseFloat(lot.expectedKg) || 0) : 0;
  const physical = lot.physicalKg ?? lot.receivedKg ?? 0;
  const availabilityBasis = lot.directFlow ? Math.max(directBasis, physical) : physical;
  return {
    physicalKg: physical,
    availabilityBasis,
    liveAvailable: Math.max(0, availabilityBasis - totalReserved),
    totalReserved,
    reservations,
  };
}

/** Reservations on one PO line from other pre-dispatch SOs. */
export function poLineReservations(po: any, poLine: any, allOrders: any[], excludeOrderId: any): any {
  const reservations: any[] = [];
  let totalReserved = 0;
  (allOrders || []).forEach(o => {
    if (o.id === excludeOrderId) return;
    if (!SO_PRE_DISPATCH_STATUSES.has(o.status)) return;
    (o.items || []).forEach((it: any) => {
      if (it.sourceType !== "PO") return;
      if (it.sourceRef !== po.number) return;
      if ((it.sourceLineId ?? 1) !== poLine.id) return;
      if (!productsMatch(it.product, poLine.product, it.variety, poLine.variety)) return;
      const q = parseFloat(it.qty) || 0;
      if (q <= 0) return;
      reservations.push({ soNumber: o.number, soId: o.id, status: o.status, qty: q });
      totalReserved += q;
    });
  });
  return {
    liveAvailable: Math.max(0, (poLine.available ?? 0) - totalReserved),
    totalReserved,
    reservations,
  };
}

/**
 * Per-line availability for an SO being edited. Extracted 1:1 from
 * SalesOrders.tsx (incl. the v6.18.24 received-PO exclusion and the
 * wrong-product guards). lots/pos are the picker-adapted shapes
 * (lot.availableKg, poLine.available).
 */
export function computeLineAvailability(soItems: any[], allOrders: any[], currentOrderId: any, lots: any[], pos: any[]): any[] {
  const LOTS = lots || [];
  const PO_REFS = pos || [];
  const committedFromStock: Record<string, number> = {};
  const committedFromPO: Record<string, number> = {};

  (allOrders || []).forEach(o => {
    if (o.id === currentOrderId) return;
    if (!SO_PRE_DISPATCH_STATUSES.has(o.status)) return;
    (o.items || []).forEach((it: any) => {
      if (!it.sourceType || !it.sourceRef) return;
      const q = parseFloat(it.qty) || 0;
      if (q <= 0) return;
      if (it.sourceType === "STOCK") {
        const lot = LOTS.find(l => l.number === it.sourceRef);
        if (!lot) return;
        if (!productsMatch(it.product, lot.product, it.variety, lot.variety)) return;
        committedFromStock[it.sourceRef] = (committedFromStock[it.sourceRef] || 0) + q;
      } else if (it.sourceType === "PO") {
        const po = PO_REFS.find(p => p.number === it.sourceRef);
        if (!po || !isPOUsableForConfirmedSO(po)) return;
        const poLine = po.items.find((l: any) => l.id === (it.sourceLineId ?? 1));
        if (!poLine) return;
        if (!productsMatch(it.product, poLine.product, it.variety, poLine.variety)) return;
        const k = `${it.sourceRef}::${it.sourceLineId ?? 1}`;
        committedFromPO[k] = (committedFromPO[k] || 0) + q;
      }
    });
  });

  function lotRemaining(lotNumber: string) {
    const lot = LOTS.find(l => l.number === lotNumber);
    if (!lot) return 0;
    return Math.max(0, lot.availableKg - (committedFromStock[lot.number] || 0));
  }
  function poLineRemaining(poNumber: string, lineId: any) {
    const po = PO_REFS.find(p => p.number === poNumber);
    if (!po || !isPOUsableForConfirmedSO(po)) return 0;
    const line = po.items.find((l: any) => l.id === (lineId ?? 1));
    if (!line) return 0;
    const k = `${po.number}::${line.id}`;
    return Math.max(0, line.available - (committedFromPO[k] || 0));
  }

  // Decision 1 (Batch 3a, precise partial receipt): kg already received into lots
  // is subtracted from that PO line's incoming supply — the received part counts
  // via the lot, the genuine remainder still counts as incoming. A fully received
  // PO therefore contributes 0 (same as the old v6.18.24 exclusion); a PO arriving
  // across multiple trucks contributes exactly what is still on the way.
  const receivedKgByPOProduct: Record<string, number> = {};
  LOTS.forEach((l: any) => {
    if (!l.poRef) return;
    const k = `${l.poRef}::${productVarietyKey(l)}`;  // FB-12: keyed by product+variety
    receivedKgByPOProduct[k] = (receivedKgByPOProduct[k] || 0) + Math.max(0, (l.receivedKg ?? 0));
  });

  return (soItems || []).map((it: any) => {
    const lineQty = parseFloat(it.qty) || 0;
    const lineKey = productVarietyKey(it); // FB-12

    let primaryAvailable = 0;
    let primaryProductMismatch = false;
    if (it.sourceType === "STOCK" && it.sourceRef) {
      const lot = LOTS.find(l => l.number === it.sourceRef);
      if (lot) {
        if (productsMatch(it.product, lot.product)) primaryAvailable = lotRemaining(it.sourceRef);
        else primaryProductMismatch = true;
      }
    } else if (it.sourceType === "PO" && it.sourceRef) {
      const po = PO_REFS.find(p => p.number === it.sourceRef);
      if (po && isPOUsableForConfirmedSO(po)) {
        const poLine = po.items.find((l: any) => l.id === (it.sourceLineId ?? 1));
        if (poLine) {
          if (productsMatch(it.product, poLine.product)) primaryAvailable = poLineRemaining(it.sourceRef, it.sourceLineId);
          else primaryProductMismatch = true;
        }
      }
    }

    let otherStockKg = 0, otherPOKg = 0;
    LOTS.forEach(lot => {
      if (productVarietyKey(lot) !== lineKey) return;  // FB-12: product+variety
      if (it.sourceType === "STOCK" && it.sourceRef === lot.number) return;
      otherStockKg += lotRemaining(lot.number);
    });
    PO_REFS.forEach(po => {
      (po.items || []).forEach((line: any) => {
        if (productVarietyKey(line) !== lineKey) return;  // FB-12: product+variety
        if (it.sourceType === "PO" && it.sourceRef === po.number && (it.sourceLineId ?? 1) === line.id) return;
        const received = receivedKgByPOProduct[`${po.number}::${productVarietyKey(line)}`] || 0;
        otherPOKg += Math.max(0, poLineRemaining(po.number, line.id) - received);
      });
    });

    const otherSourcesAvailable = otherStockKg + otherPOKg;
    const combinedAvailable = primaryAvailable + otherSourcesAvailable;
    const primaryShortfallAmount = Math.max(0, lineQty - primaryAvailable);

    return {
      lineQty,
      primaryAvailable: Math.round(primaryAvailable * 100) / 100,
      otherStockKg: Math.round(otherStockKg * 100) / 100,
      otherPOKg: Math.round(otherPOKg * 100) / 100,
      otherSourcesAvailable: Math.round(otherSourcesAvailable * 100) / 100,
      combinedAvailable: Math.round(combinedAvailable * 100) / 100,
      overage: Math.round(primaryShortfallAmount * 100) / 100,
      hasOverage: primaryShortfallAmount > 0.01,
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
  const claimed = opts.claimed;
  const free = (l: any) => !claimed || !claimed.has(String(l.number));
  if (it.sourceType === "STOCK" && it.sourceRef) {
    return (lots || []).find(l => String(l.number) === String(it.sourceRef)) || null;
  }
  if (it.sourceType === "PO" && it.sourceRef) {
    const byPO = (lots || []).filter(l => String(l.poRef || "") === String(it.sourceRef));
    if (it.sourceLineId != null) {
      const exact = byPO.find(l => l.poLineId != null && String(l.poLineId) === String(it.sourceLineId));
      if (exact) return exact;
    }
    const byProduct = byPO.find(l => free(l) && productsMatch(it.product, l.product, it.variety, l.variety));
    if (byProduct) return byProduct;
    return byPO.find(l => free(l) && normalizeProduct(l.product) === normalizeProduct(it.product)) || null;
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
      const matches = m.soRef ? String(m.soRef) === so : String(m.note || "").includes(so);
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
      !m.voided && (m.shipmentRef ? String(m.shipmentRef) === String(s.number) : String(m.note || "").includes(String(s.number)))));
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
        g => it.sourceType === "PO" && !!g.poRef && String(g.poRef) === String(it.sourceRef) && productsMatch(it.product, g.product, it.variety, g.variety),
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
