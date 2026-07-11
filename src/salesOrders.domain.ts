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
    const product = normalizeProduct(it.product);
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
