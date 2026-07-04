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
export function productsMatch(a: any, b: any): boolean {
  return normalizeProduct(a) === normalizeProduct(b);
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
      if (!productsMatch(it.product, lot.product)) return;
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
      const matchesPOBackedLot = it.sourceType === "PO" && lot.poRef === it.sourceRef && productsMatch(it.product, lot.product);
      if (!matchesStock && !matchesPOBackedLot) return;
      if (!productsMatch(it.product, lot.product)) return;
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
      if (!productsMatch(it.product, poLine.product)) return;
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
        if (!productsMatch(it.product, lot.product)) return;
        committedFromStock[it.sourceRef] = (committedFromStock[it.sourceRef] || 0) + q;
      } else if (it.sourceType === "PO") {
        const po = PO_REFS.find(p => p.number === it.sourceRef);
        if (!po || !isPOUsableForConfirmedSO(po)) return;
        const poLine = po.items.find((l: any) => l.id === (it.sourceLineId ?? 1));
        if (!poLine) return;
        if (!productsMatch(it.product, poLine.product)) return;
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

  // v6.18.24: a PO already received into a lot must not also count as incoming supply.
  const receivedPOProduct = new Set(
    LOTS
      .filter((l: any) => l.poRef && ((l.physicalKg ?? 0) > 0 || (l.receivedKg ?? 0) > 0))
      .map((l: any) => `${l.poRef}::${normalizeProduct(l.product)}`)
  );

  return (soItems || []).map((it: any) => {
    const lineQty = parseFloat(it.qty) || 0;
    const product = normalizeProduct(it.product);

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
      if (normalizeProduct(lot.product) !== product) return;
      if (it.sourceType === "STOCK" && it.sourceRef === lot.number) return;
      otherStockKg += lotRemaining(lot.number);
    });
    PO_REFS.forEach(po => {
      (po.items || []).forEach((line: any) => {
        if (normalizeProduct(line.product) !== product) return;
        if (it.sourceType === "PO" && it.sourceRef === po.number && (it.sourceLineId ?? 1) === line.id) return;
        if (receivedPOProduct.has(`${po.number}::${normalizeProduct(line.product)}`)) return;
        otherPOKg += poLineRemaining(po.number, line.id);
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
