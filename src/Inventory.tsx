import { lotStatusLabel, lotIsDirect, lotValue, lotArrivedCell, lotLoadedTwice, consignmentHint } from "./lotView.domain";   // v6.99.81 (A-IN)
import React, { useState, useMemo } from "react";
import { exportRowsToXlsx, stamp as xlsStamp } from "./exportXlsx";
import { lotAvailabilityByGrade } from "./so.domain";
import { receiptMovement, gradeSplit, inspectionTotals, defectsFor, DEFECT_CATEGORIES, plateMismatch, inspectionVerdict, countLinesForLot, countedKgOf, samplePctOf, sortablePools, beforeReceiptWarning, lotReceiptDate, inspectionQtyNote } from "./seasonOps.domain";
import { SmallButton, ActionButton, DocLink } from "./ui";
import DateInput from "./DateInput";
import { nextSettlementNumber, buildCommissionInvoiceDraft } from "./settlement.domain";
import { claimsForLot } from "./claims.domain";
import { fmtNum } from "./format";
import { Card, Lbl, useConfirm, DocRef, cancelledDocSet} from "./ui";
import { recomputeLotFromMovements as domainRecomputeLot } from "./inventory.domain";
import { lotReservationsForStock, productsMatch as domainProductsMatch, soClientName } from "./salesOrders.domain";
import { nextId } from "./ids";
import { defaultFxRate } from "./fx";
import { unifiedLocations, locationById } from "./locations";
import { localTodayISO, formatDMY } from "./dates";
import { shipmentTradeDirection, MOVEMENT_LABELS, ownershipAtPoint } from "./tradeFlow.domain";
import { settlementCostComponents } from "./consignment";
import { recordAudit } from "./audit";
import { isArchived, DEFAULT_SEASON } from "./season.domain";
import { useUnsavedGuard } from "./unsaved";
import { r0 } from "./format";
import { LotDetail } from "./InventoryLot";
import { MovementModal, SettlementModal } from "./InventoryWindows";

// ─── REFERENCE DATA ─────────────────────────────────────────────────────────

const LOCATION_TYPES: Record<string, any> = {
  OWN:      { label: "Our Warehouse",   color: "#0284C7", bg: "#E0F2FE", icon: "🏢" },
  SUPPLIER: { label: "Supplier Site",   color: "#16A34A", bg: "#DCFCE7", icon: "🚜" },
  PORT:     { label: "Port / Transit",  color: "#D97706", bg: "#FEF3C7", icon: "⚓" },
  CLIENT:   { label: "Client Site",     color: "#7C3AED", bg: "#EDE9FE", icon: "🎯" },
  BROKER:   { label: "Customs / Broker", color: "#DB2777", bg: "#FCE7F3", icon: "🛃" },
  CUSTOMS:  { label: "Customs",         color: "#DB2777", bg: "#FCE7F3", icon: "🛃" },
};

// Safe lookup: never throws if a location carries a type not in the table above
// (e.g. a new legacyType added later). Falls back to a neutral default.
const DEFAULT_LOCATION_TYPE = { label: "Location", color: "#6B7280", bg: "#F3F4F6", icon: "📍" };
export function locType(t: string) {
  return LOCATION_TYPES[t] || DEFAULT_LOCATION_TYPE;
}

// LOCATIONS now comes from the shared ./locations source of truth. We map the
// rich `type` back onto the legacy single-word `type` field that this module's
// existing UI code expects (LOCATION_TYPES[loc.type]).
// v6.86.0: module-level LOCATIONS alias removed — pickers read unifiedLocations()
// v6.18.4 (P0-4): snapshot + live counterparty addresses, deduped, so movement
// pickers see a counterparty added this session without a browser refresh.
export function mergedLocations(contacts: any[]) {
  // v6.86.0 (owner ruling): ONE source — unifiedLocations() — no module-level merge, no demo seeds.
  return unifiedLocations(contacts || []).map((l: any) => ({ ...l, type: l.legacyType }));
}

// Lot status lifecycle — PHYSICAL states only.
// Reservations are NOT a lot status (they're computed from SO state — see lotReservations).
// Once SOs reach Shipped+, their kg leave the lot physically (decrements physicalKg).
const LOT_STATUSES: Record<string, any> = {
  Expected:      { color: "#6B7280", bg: "#F3F4F6", desc: "Ordered, not yet shipped from supplier" },
  "Direct Expected": { color: "#D97706", bg: "#FEF3C7", desc: "Direct supplier/producer to client or port · not received in our warehouse" },
  Cancelled:     { color: "#DC2626", bg: "#FEE2E2", desc: "Cancelled expected procurement" },
  "Blocked · PO Cancelled": { color: "#DC2626", bg: "#FEE2E2", desc: "PO cancelled; review any physical stock manually" },
  "In Transit":  { color: "#0284C7", bg: "#E0F2FE", desc: "Moving (supplier → port / port → warehouse / etc.)" },
  Customs:       { color: "#D97706", bg: "#FEF3C7", desc: "Awaiting customs clearance" },
  "In Stock":    { color: "#16A34A", bg: "#DCFCE7", desc: "Physically in our warehouse (may have SO reservations)" },
  "Shipped Out": { color: "#2563EB", bg: "#DBEAFE", desc: "Physically dispatched to client" },
  Damaged:       { color: "#DC2626", bg: "#FEE2E2", desc: "Written off — damaged beyond use" },
};

// Flow types — 11 flows in two groups (EXP / IMP). Aligned with PurchaseOrders + Shipments.
// v6.37.0: FLOW_TYPES retired — direction, journey, ownership and customs all derive
// from shipments/incoterms; legacy stored data was migrated (flowCleanup.migration, schema 2).


// v6.1.5: Standard Incoterm-aligned stage wording, derived from the stage kind and the
// flow's buy/sell Incoterm family. One source of truth → consistent across the app.

// v6.37.0: generic stage labels — a fallback only; stored/baked and shipment-derived
// journey stages carry their own real labels, which the render prefers.
export function standardStageLabel(kind: string) {
  switch (kind) {
    case "supplier": return "At supplier";
    case "transit_road": return "Road carriage";
    case "transit_sea": return "Sea freight";
    case "origin_port": return "Port of loading";
    case "customs_export": return "Export customs cleared";
    case "dest_port": return "Destination port";
    case "customs_import": return "Import customs cleared";
    case "our_wh": return "Received into our warehouse";
    case "client": return "Delivered to client";
    default: return kind;
  }
}

const STAGE_KIND_TO_POINT: Record<string, string> = {
  supplier: "supplier", transit_road: "supplier", origin_port: "origin_port",
  customs_export: "origin_port", transit_sea: "vessel", dest_port: "dest_port",
  customs_import: "dest_port", our_wh: "our_wh", client: "client",
};
function ownershipForStage(stageKind: string, stages?: any[], idx?: number, buyIncoterm?: string, sellIncoterm?: string) {
  // v6.37.0: ownership derives purely from the REAL incoterms (Phase C complete).
  // A transit leg follows the point it departs FROM (nearest preceding non-transit stage).
  let point = STAGE_KIND_TO_POINT[stageKind] || "supplier";
  const isTransit = stageKind === "transit_road" || stageKind === "transit_sea";
  if (isTransit && Array.isArray(stages) && typeof idx === "number") {
    for (let j = idx - 1; j >= 0; j--) {
      const pk = stages[j].kind;
      if (pk !== "transit_road" && pk !== "transit_sea") { point = STAGE_KIND_TO_POINT[pk] || point; break; }
    }
  }
  return ownershipAtPoint(point, buyIncoterm, sellIncoterm);
}
// v6.34.9 (Phase C): build a lot's journey from its REAL shipment legs, not the
// obsolete flow template. Each leg becomes a transit stage between its endpoints;
// the sequence reflects what was actually booked. Falls back to a minimal
// supplier→warehouse shell only when the lot has no shipments at all.
function journeyFromShipments(lot: any, shipments: any[], locResolve: (id: any) => any, buyIncoterm?: string, sellIncoterm?: string): any[] {
  const legs = legsForLot(lot, shipments);
  if (!legs.length) return [];
  const nameOf = (id: any, custom: any) => {
    const l = locResolve(id);
    return (l && l.name) || custom || "";
  };
  const stages: any[] = [];
  legs.forEach((lg: any, i: number) => {
    // v6.99.16 (A-R12-4): places live on the UNITS — the leg's from/to are legacy defaults (SHP-0035 showed a stale "Biedronka")
    const us = (lg.vehicles || []);
    const unitFrom = us.map((u: any) => String(u.pickupText || "").trim()).find(Boolean);
    const unitTo = us.map((u: any) => String(u.deliveryText || "").trim()).find(Boolean);
    const fromName = unitFrom || nameOf(lg.fromLocationId, lg.fromCustom);
    const toName = unitTo || nameOf(lg.toLocationId, lg.toCustom);
    const mode = lg.mode || "Road";
    const kind = mode === "Sea" ? "transit_sea" : mode === "Air" ? "transit_air" : "transit_road";
    // the origin stage (once, from the first leg)
    if (i === 0 && fromName) {
      stages.push({ seq: stages.length + 1, kind: "origin", label: fromName, ownership: "ours", plannedDate: lg.plannedPickupDate || null, actualDate: legActualLoad(lg), status: "pending" });
    }
    stages.push({
      seq: stages.length + 1, kind, mode,
      label: `${mode} → ${toName || "next stop"}`,
      ownership: "ours",
      plannedDate: lg.plannedDeliveryDate || null,
      actualDate: legActualDeliver(lg),
      status: "pending",
    });
  });
  // v6.37.0: real ownership per stage from the incoterms (was a placeholder "ours").
  return stages.map((st: any, i: number) => ({ ...st, ownership: ownershipForStage(st.kind, stages, i, buyIncoterm, sellIncoterm) }));
}

// On-the-fly journey for a lot with no stored journey — derived from real shipments
// (Phase C), falling back to the flow template only for legacy lots with no shipments.
export function journeyForLot(lot: any, shipments: any[] = [], orders: any[] = []) {
  // v6.35.1 (Phase C): resolve the REAL incoterms for ownership — buy from the lot (or its
  // stored value), sell from the governing SO that draws on this lot/PO.
  const lotBuyIncoterm = lot.buyIncoterm || lot.purchaseIncoterm || "";
  const govSo = (orders || []).find((o: any) => o.status !== "Cancelled" && (o.items || []).some((it: any) =>
    (it.sourceType === "STOCK" && String(it.sourceRef) === String(lot.number)) ||
    (it.sourceType === "PO" && lot.poRef && String(it.sourceRef) === String(lot.poRef))));
  const lotSellIncoterm = govSo?.sellIncoterm || "";
  // Phase C: prefer a stored journey, then one DERIVED FROM REAL SHIPMENTS, and only
  // then fall back to the legacy flow template (for old lots with neither).
  const fromShips = (Array.isArray(lot.journey) && lot.journey.length > 0) ? [] : journeyFromShipments(lot, shipments, locById, lotBuyIncoterm, lotSellIncoterm);
  const base = (Array.isArray(lot.journey) && lot.journey.length > 0)
    ? lot.journey
    : fromShips.length > 0
    ? fromShips
    : []; // v6.37.0: no template fallback — a lot with no stored journey and no shipments shows none
  // Drive each stage's status + actual date from real shipment legs, customs,
  // movements and SO status (mapping legs to stages by mode/sequence).
  return applyProgressToJourney(base, lot, shipments, orders);
}

// Map the lot's physical reality (movements + status + customs) to a "reached point"
// index along OWNERSHIP_POINT_ORDER, then mark journey stages done/active/pending.
// Find the shipment(s) that carry this lot (by lotRef / poRef / soRef).
function shipmentsForLot(lot: any, shipments: any[]) {
  if (!Array.isArray(shipments)) return [];
  return shipments.filter((sh: any) => {
    const lotRefs = sh.lotRefs || [];
    // v6.59.0 ROOT CAUSE of three separate lot defects. This used to match a
    // shipment that merely shared the lot's PO or SO, or that listed the lot in
    // the header lotRefs seeded at creation. So every shipment of PO-2026-0001
    // counted as carrying LOT-2026-0001 — which is why the lot's customs box
    // named SHP-2026-0002, why its direction badge read another shipment's
    // flow, and why extra sales orders appeared in its linked documents.
    // A shipment carries a lot when its GOODS say so. Header lotRefs are only
    // trusted for a shipment that has no goods rows yet (a booking).
    const carriedInGoods = (sh.goods || []).some((g: any) => String(g.lotRef || "") === String(lot.number));
    if (carriedInGoods) return true;
    if ((sh.goods || []).length) return false;
    return !!(lot.number && lotRefs.includes(lot.number));
  });
}

// Pull ordered legs (by their natural order) from the lot's shipments, tagged by mode.
function legsForLot(lot: any, shipments: any[]) {
  const shs = shipmentsForLot(lot, shipments);
  const legs: any[] = [];
  shs.forEach((sh: any) => (sh.legs || []).forEach((lg: any) => legs.push(lg)));
  return legs;
}
function legActualLoad(leg: any) {
  if (!leg) return null;
  // Prefer a per-unit actual load date, else the leg's actual loading date.
  const units = leg.transportUnits || leg.units || [];
  const u = units.find((x: any) => x.actualLoadDate);
  return (u && u.actualLoadDate) || leg.actualLoadingDate || null;
}
function legActualDeliver(leg: any) {
  if (!leg) return null;
  const units = leg.transportUnits || leg.units || [];
  const u = units.find((x: any) => x.actualUnloadDate);
  return (u && u.actualUnloadDate) || leg.actualDeliveryDate || null;
}

// v6.x: drive each journey stage's status + actual date from real data — matching
// shipment legs to stages by mode/sequence, plus customs, movements and SO status.
function applyProgressToJourney(journey: any[], lot: any, shipments: any[] = [], orders: any[] = []) {
  if (!journey.length) return journey;
  const customs = lot.customs || {};
  const movements = lot.movements || [];
  const legs = legsForLot(lot, shipments);
  const roadLegs = legs.filter((l: any) => l.mode === "Road");
  const seaLeg = legs.find((l: any) => l.mode === "Sea");
  const so = lot.soRef ? (orders || []).find((o: any) => o.number === lot.soRef) : null;
  const soDelivered = so && (so.status === "Delivered" || so.status === "Invoiced");

  const firstInMove = movements.find((m: any) => m.type === "IN");
  const shipOutMove = movements.find((m: any) => m.type === "SHIP_OUT");
  const ownMove = [...movements].reverse().find((m: any) => { const lc = locById(m.toId); return lc?.type === "OWN"; });
  const portMove = [...movements].reverse().find((m: any) => { const lc = locById(m.toId); return lc?.type === "PORT"; });

  // Track which road leg each transit_road stage uses (first road = pre-carriage,
  // a later transit_road = on-carriage → last road leg).
  let roadIdx = 0;

  const stageEvidence = journey.map((s: any, i: number) => {
    let status = "pending";
    let actualDate: string | null = s.actualDate || null;

    switch (s.kind) {
      case "supplier":
        // Goods are ready at the supplier once the lot exists (PO confirmed).
        status = "done"; actualDate = actualDate || lot.loadingDate || s.plannedDate || null;
        break;
      case "transit_road": {
        const leg = roadLegs[Math.min(roadIdx, roadLegs.length - 1)];
        roadIdx += 1;
        const d = legActualLoad(leg);
        if (d) { status = "done"; actualDate = d; }
        break;
      }
      case "origin_port": {
        // Loaded at port of loading: the (first) road leg has delivered, or the sea leg loaded.
        const d = legActualDeliver(roadLegs[0]) || legActualLoad(seaLeg);
        if (d) { status = "done"; actualDate = d; }
        break;
      }
      case "customs_export":
        if (customs.export?.status === "Cleared") { status = "done"; actualDate = customs.export.date || actualDate; }
        else if (customs.export?.status === "In progress") status = "active";
        break;
      case "transit_sea": {
        const d = legActualLoad(seaLeg);
        if (d) { status = "done"; actualDate = d; }
        break;
      }
      case "dest_port": {
        const d = legActualDeliver(seaLeg) || (portMove && portMove.date);
        if (d) { status = "done"; actualDate = d; }
        break;
      }
      case "customs_import":
        if (customs.import?.status === "Cleared") { status = "done"; actualDate = customs.import.date || actualDate; }
        else if (customs.import?.status === "In progress") status = "active";
        break;
      case "our_wh":
        if (ownMove || lot.status === "In Stock") { status = "done"; actualDate = (ownMove && ownMove.date) || actualDate; }
        break;
      case "client":
        if (shipOutMove || soDelivered || lot.status === "Shipped Out" || lot.status === "Delivered") {
          status = "done"; actualDate = (shipOutMove && shipOutMove.date) || actualDate;
        }
        break;
      default: break;
    }
    return { ...s, status, actualDate };
  });

  // v6.18.11 (#1): monotonic back-fill. Granular leg dates / customs flags often
  // aren't entered, leaving early stages "pending" even after the goods have clearly
  // arrived. But physical presence at a later point proves every earlier transit
  // point happened — you can't be In Stock without having passed sea/customs/road.
  // So find the furthest point actually reached (from movements + lot status) and
  // mark every stage up to it done, using the planned date when no actual exists.
  const idxOf = (kind: string) => { let r = -1; stageEvidence.forEach((s: any, i: number) => { if (s.kind === kind) r = i; }); return r; };
  const received = !!firstInMove || lot.status === "In Stock" || parseNum(lot.physicalKg) > 0 || parseNum(lot.receivedKg) > 0;
  const shippedOut = !!shipOutMove || ["Shipped Out", "Delivered"].includes(lot.status) || soDelivered;
  const directDelivered = lot.status === "Delivered (direct)";
  const atPort = !!portMove || lot.status === "Customs";
  let reached = -1;
  stageEvidence.forEach((s: any, i: number) => { if (s.status === "done") reached = i; });
  if (atPort) reached = Math.max(reached, idxOf("dest_port"));
  if (received) reached = Math.max(reached, idxOf("our_wh"));
  if (shippedOut || directDelivered) reached = Math.max(reached, idxOf("client"), idxOf("dest_port"));
  const backFilled = stageEvidence.map((s: any, i: number) => (i <= reached && s.status !== "done") ? { ...s, status: "done", actualDate: s.actualDate || s.plannedDate || null } : s);

  return backFilled.map((s: any, i: number, arr: any[]) => {
    // The first non-done stage becomes "active" (current frontier, shown orange).
    if (s.status === "pending") {
      const anyEarlierActive = arr.slice(0, i).some((x: any) => x.status === "active");
      const allEarlierDone = arr.slice(0, i).every((x: any) => x.status === "done");
      if (allEarlierDone && !anyEarlierActive) return { ...s, status: "active" };
    }
    return s;
  });
}

// The customs clearances relevant to a lot's flow (export and/or import).
// v6.35.2 (Phase C step 4): whether a lot has customs stages is now derived from its
// real shipments — a shipment with customs applied, or one that crosses the EU boundary
// (import/export direction) — not from the obsolete flow template.
export function customsStagesForLot(lot: any, shipments: any[]): string[] {
  const shs = shipmentsForLot(lot, shipments || []);
  const out = new Set<string>();
  shs.forEach((sh: any) => {
    if (sh.customs && sh.customs.applies) {
      const dir = String(sh.tradeDirection || "").toUpperCase();
      // classify by trade direction; default to import for an inbound movement.
      if (dir === "EXPORT" || dir === "CROSS_TRADE") out.add("export");
      if (dir === "IMPORT" || dir === "CROSS_TRADE") out.add("import");
      if (out.size === 0) out.add("import");
    }
  });
  return Array.from(out);
}

const QUALITY_GRADES = ["I", "IB", "II", "Industrial"]; // Polish convention (Klasa I/IB/II/Industrial)


// Movement types — physical operations only.
// SO reservations are NOT movements (they're a calculated overlay from SO state).
export const MOVEMENT_TYPES: Record<string, any> = {
  IN:        { label: "Stock In",   color: "#16A34A", icon: "↓", desc: "Lot received into a location" },
  TRANSFER:  { label: "Transfer",   color: "#0284C7", icon: "⇄", desc: "Move between locations (truck/port/WH)" },
  SHIP_OUT:  { label: "Ship Out",   color: "#2563EB", icon: "→", desc: "Physical dispatch to client (decrements physicalKg)" },
  REVERSAL:  { label: "SO Reversal", color: "#7C3AED", icon: "↩", desc: "Cancels a previous SO dispatch and restores stock" },
  DAMAGE:    { label: "Damage",     color: "#DC2626", icon: "⚠", desc: "Write-off — damaged or rejected" },
  RECLASS:   { label: "Reclassify", color: "#D97706", icon: "↻", desc: "Quality grade change (e.g. Kl. I → Kl. II)" },
};

// ─── SEED DATA — lots covering all 7 flows ──────────────────────────────────
export const today = localTodayISO();

export function locById(id) { return locationById(id) as any; } // v6.86.0: one resolver

// ─── SO STUB ────────────────────────────────────────────────────────────────
// Mirrors the 5 seed SOs from SalesOrders.tsx so reservations show up realistically
// in this standalone module. Replaced with live SO state on integration.
// Reserving semantics: SO_PRE_DISPATCH_STATUSES in ./types, applied by salesOrders.domain (B0-2 resolved:
// the old 7-status set here was dead code — availability always used the 3-status pre-dispatch set).

function getSOsStub() {
  return [
    { id: 1, number: "SO-2026-0094", status: "Delivered", clientName: "Biedronka",
      items: [{ product: "Golden Delicious", qty: 8000, sourceType: "STOCK", sourceRef: "LOT-2026-0091" }] },
    { id: 2, number: "SO-2026-0088", status: "Invoiced", clientName: "Lidl Polska",
      items: [{ product: "Golden Delicious", qty: 2400, sourceType: "STOCK", sourceRef: "LOT-2026-0091" }] },
    { id: 3, number: "SO-2026-0091", status: "Shipped", clientName: '"Euro-Papryka" Paweł Myziak',
      items: [
        { product: "Papryka Kapia",      qty: 6000, sourceType: "STOCK", sourceRef: "LOT-2026-0086" },
        { product: "Yellow Bell Pepper", qty: 3600, sourceType: "STOCK", sourceRef: "LOT-2026-0099" },
        { product: "Red Bell Pepper",    qty: 1200, sourceType: "STOCK", sourceRef: "LOT-2026-0095" },
      ] },
    { id: 4, number: "SO-2026-0102", status: "Confirmed", clientName: "Biedronka",
      items: [{ product: "Red Bell Pepper", qty: 5000, sourceType: "PO", sourceRef: "PO-2026-0121", sourceLineId: 1 }] },
    { id: 5, number: "SO-2026-0105", status: "Draft", clientName: "Metro Cash & Carry",
      items: [{ product: "Papryka Kapia", qty: 12000, sourceType: "PO", sourceRef: "PO-2026-0117", sourceLineId: 1 }] },
  ];
}
const SOS = getSOsStub();

const productsMatch = domainProductsMatch; // Batch 1
const _soClientName = soClientName; // Batch 1

// Returns: { liveAvailable, totalReserved, reservations: [{ soNumber, soId, status, clientName, qty }] }
// for a given lot, considering reservations from all SOs in RESERVING_SO_STATUSES
// matching the lot's product.
//
// Note: physicalKg is the lot's TRUE physical capacity (drops on SHIP_OUT movements).
// liveAvailable = physicalKg − reservations from SOs not yet Shipped+.
// Once an SO is Shipped+, the goods have physically left → physicalKg already dropped →
// that SO's reservation should NOT also subtract. We handle this by only counting
// reservations from SOs in Confirmed/Reserved/Loading (i.e. NOT yet physically dispatched).

// Normalize an SO from either the standalone stub shape ({clientName}) or the real SO module
// shape ({client: {name, ...}}). Returns flat clientName for display.

export function lotReservations(lot, sourceSOs, ctx) {
  // Engine: salesOrders.domain (Batch 1). G1: no SOS stub fallback — live SOs only.
  // v6.41.0 (A5): ctx {lots, shipments} enables the unshipped-remainder rule.
  return lotReservationsForStock(lot, sourceSOs ?? [], ctx);
}

// Returns array of SO references this lot has ever been linked to
// (across all statuses including Shipped+ historical).
export function soRefsFor(lot, sourceSOs, shipmentsList = []) {
  const list = sourceSOs ?? SOS;
  const refs = [];
  list.forEach(o => {
    if (o.status === "Cancelled") return;
    if (o.status === "Draft") return;
    (o.items || []).forEach(it => {
      const matchesStock = it.sourceType === "STOCK" && it.sourceRef === lot.number;
      const matchesPOBackedLot = it.sourceType === "PO" && lot.poRef === it.sourceRef && productsMatch(it.product, lot.product);
      if (!matchesStock && !matchesPOBackedLot) return;
      if (!productsMatch(it.product, lot.product)) return;
      if (!refs.find(r => r.number === o.number)) {
        refs.push({ number: o.number, status: o.status, clientName: _soClientName(o), sourceType: it.sourceType });
      }
    });
  });
  // v6.3.0: also surface SOs linked to this lot THROUGH A SHIPMENT — the shipment
  // knows the SO (header soRefs and per-goods soRef) even when the SO line itself
  // isn't sourced from this lot/PO directly.
  (shipmentsList || []).forEach(sh => {
    if (!sh || sh.status === "Cancelled") return;
    const lotRows = (sh.goods || []).filter(g => String(g.lotRef || "") === String(lot.number));
    const carriesLot = lotRows.length > 0
      || (!(sh.goods || []).length && (sh.lotRefs || []).includes(lot.number));
    if (!carriesLot) return;
    // v6.59.0: take the SO from THIS LOT'S rows. Pulling every header soRef
    // attributed a groupage shipment's other clients to this lot — the "2 SOs
    // on a lot that was sold once" defect. The header is used only when the
    // rows are silent AND it names exactly one order.
    const fromRows = lotRows.map(g => g.soRef).filter(Boolean);
    const shipmentSONumbers = uniqStrings(fromRows.length ? fromRows
      : ((sh.soRefs || []).length === 1 ? sh.soRefs : []));
    shipmentSONumbers.forEach(soNumber => {
      if (!soNumber) return;
      if (refs.find(r => r.number === soNumber)) return;
      const so = list.find(o => o.number === soNumber);
      if (so && so.status === "Cancelled") return;
      refs.push({
        number: soNumber,
        status: so ? so.status : "—",
        clientName: so ? _soClientName(so) : "",
        sourceType: "SHIPMENT",
        viaShipment: sh.number,
      });
    });
  });
  return refs;
}

function uniqStrings(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || "")).filter(Boolean)));
}

// v6.32.0 (R7b-5): demo seed INIT_LOTS moved out of the production bundle → dev/demoSeed.reference.ts

// ─── SHARED UI ATOMS ────────────────────────────────────────────────────────
export function Inp({ value, onChange = () => {}, type = "text", placeholder = "", style = {}, max, min, noFuture, title }: any) {
  if (type === "date") return <DateInput value={value} onChange={onChange} disabled={false} placeholder={placeholder} style={style} min={min} max={max} noFuture={noFuture} title={title} />; // v6.81.0 (D-52)
  if (type === "number") return <input value={value ?? ""} onChange={(e: any) => onChange && onChange({ target: { value: String(e.target.value).replace(",", ".") } })} inputMode="decimal" placeholder={undefined} disabled={undefined} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", background: "#fff", ...(style || {}) }} title={undefined} />; // v6.99.6 (A-R9-5): Polish comma decimals accepted
  const base = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: "#fff" };
  return <input value={value || ""} onChange={onChange} type={type || "text"} placeholder={placeholder} max={max} style={{ ...base, ...style }} />;
}
export function Sel({ value, onChange = () => {}, children, style = {} }: any) {
  const base = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: "#fff" };
  return <select value={value || ""} onChange={onChange} style={{ ...base, ...style }}>{children}</select>;
}
export function SectionTitle({ children }: any) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em", marginBottom: 14 }}>{children}</div>;
}
export function StatusBadge({ status }: any) {
  // v6.99.81 (A-IN-4, owner): one plain word — Expected · In transit · In stock · Shipped · Delivered · Cancelled; the stored value is unchanged
  const s = lotStatusLabel(status); const desc = (LOT_STATUSES[status] || {}).desc;
  return <span title={desc || status} style={{ background: s.bg, color: s.color, padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{s.label}</span>;
}
export function QualityBadge({ quality }: any) {
  const palette = {
    "I":          { bg: "#DCFCE7", color: "#16A34A" },  // top quality — green
    "IB":         { bg: "#ECFCCB", color: "#65A30D" },  // intermediate — lime
    "II":         { bg: "#FEF3C7", color: "#D97706" },  // secondary — amber
    "Industrial": { bg: "#FEE2E2", color: "#991B1B" },  // processing-grade — red
  };
  const p = palette[quality] || palette["I"];
  return <span style={{ background: p.bg, color: p.color, padding: "1px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", fontFamily: "ui-monospace, Menlo, monospace", whiteSpace: "nowrap" }}>Kl. {quality}</span>;
}
export function LocationPill({ locationId, lot = null }: any) {
  const loc = locById(locationId);
  // v6.45.0 (test-round): a DIRECT lot never sits in one of our locations — the goods go producer → client.
  // v6.99.81 (A-IN-5, owner): say so ALWAYS — the last movement leaves the producer's or the client's place on the lot,
  // and that name was shown instead, as if the goods sat there.
  if (lot) {
    const direct = lotIsDirect(lot);
    if (direct) return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#7C3AED" }}>
        <span style={{ fontSize: 11 }}>↗</span>
        <span style={{ fontWeight: 500 }}>Direct · producer → client</span>
      </span>
    );
  }
  if (!loc) return <span style={{ color: "#CCC" }}>—</span>;
  const t = locType(loc.type);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#444" }}>
      <span style={{ fontSize: 11 }}>{t.icon}</span>
      <span style={{ fontWeight: 500 }}>{loc.name}</span>
    </span>
  );
}
// v6.34.7 (Step 1 of flow retirement): the lot's movement is DERIVED from its actual
// shipment (which now owns the trade direction), not from the obsolete PO flow key.
// An EXW-purchase + CIF-sale lot no longer mislabels itself "IMP · EXWs → our WH".
export function LotDirectionBadge({ lot, shipments = [], orders = [], pos = [], compact = false }: any) {
  const shs = shipmentsForLot(lot, shipments);
  // Prefer an explicit shipment direction; else derive from the lot's PO + governing SO.
  let dir = "";
  // v6.43.0 (test-round #5b): prefer an explicit direction on the shipment header,
  // then on THIS lot's goods row (where direct-export deals record EXPORT), before
  // any fallback — so a CIF/CFR export is never mislabelled "Import".
  // v6.59.0: THIS LOT'S OWN GOODS ROW WINS over the shipment header. A header
  // direction describes the shipment as a whole; on a mixed movement it can
  // disagree with the row, and the row is the one that knows what this lot did.
  // (SHP-2026-0002 in the test data: header EXPORT, goods rows IMPORT.)
  // v6.62.0: a lot that has never moved has no location and no flow to show —
  // it is Expected, not broken. A bare dash read as a failure.
  // v6.99.81 (A-IN-5, owner): a lot that has not moved yet still has a flow when its PO and its sale are known — derived
  // below from the two documents, exactly as for a moved lot; only a lot with neither shows nothing
  const hasDocs = !!(pos || []).find((p: any) => String(p.number) === String(lot.poRef)) && (orders || []).some((o: any) => o.status !== "Cancelled" && o.status !== "Draft" && (o.items || []).some((it: any) => (it.sourceType === "STOCK" && String(it.sourceRef) === String(lot.number)) || (it.sourceType === "PO" && lot.poRef && String(it.sourceRef) === String(lot.poRef))));
  if (!shs.length && !(lot.movements || []).length && !hasDocs) return null;
  for (const sh of shs) {
    // v6.99.67 (A-IN-1, owner): goods rows used to carry a COPY of the direction (written before the sale was known and never
    // re-derived — LOT-0119 read "import" beside LOT-0120's "export" on the same PO and sale). Only a USER'S choice on the
    // shipment header counts; everything else is derived below from the PO and the governing SO.
    const d = sh?.tradeDirection;
    if (d && MOVEMENT_LABELS[d]) { dir = d; break; }
  }
  if (!dir) {
    // v6.84.0 (Round 7): derive from the REAL ends — the PO's producer country × the
    // governing SO's destination. An EXW purchase in Poland sold CIF abroad is an EXPORT,
    // whatever the inbound-looking shipment header says. Falls back to the shipment only
    // when no sale governs the lot.
    const po = (pos || []).find((p: any) => String(p.number) === String(lot.poRef)) || null;
    const so = (orders || []).find((o: any) => o.status !== "Cancelled" && o.status !== "Draft" && (o.items || []).some((it: any) =>
      (it.sourceType === "STOCK" && String(it.sourceRef) === String(lot.number)) || (it.sourceType === "PO" && lot.poRef && String(it.sourceRef) === String(lot.poRef)))) || null;
    if (so) dir = shipmentTradeDirection(shs[0] || {}, po, so);
    else if (shs.length) dir = shipmentTradeDirection(shs[0], po);
  }
  if (!dir) return null;
  const lbl = MOVEMENT_LABELS[dir];
  if (!lbl) return null;
  if (compact) {
    return <span title={lbl.hint} style={{ background: "#fff", border: `1px solid ${lbl.color}33`, padding: "1px 7px", borderRadius: 4, fontSize: 10.5, fontWeight: 700, color: lbl.color, whiteSpace: "nowrap" }}>{lbl.label}</span>;
  }
  return (
    <span title={lbl.hint} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", background: "#fff", border: `1px solid ${lbl.color}33`, borderRadius: 8, fontSize: 11.5, fontWeight: 700, color: lbl.color }}>
      {lbl.label}
      <span style={{ fontWeight: 400, color: "#94A3B8", fontSize: 10.5 }}>· {shs.length ? "from shipment" : "from the PO and the sale"}</span>
    </span>
  );
}

export function VarianceBadge({ expected, actual, lot = null }: any) {
  if (!expected || !actual) return null;
  const delta = actual - expected;
  if (delta === 0) return null;
  const pct = ((delta / expected) * 100).toFixed(1);
  const isShort = delta < 0;
  const twice = lot ? lotLoadedTwice(lot) : null;   // v6.99.81 (A-IN-1, owner): "+100 %" = the same goods loaded on two shipments — say which
  return (
    <span title={twice ? `Loaded on ${twice.join(" and again on ")} — received ${actual.toLocaleString()} kg against ${expected.toLocaleString()} kg expected (kept as history)` : `Expected ${expected.toLocaleString()} kg, received ${actual.toLocaleString()} kg`}
      style={{ background: isShort ? "#FEF3C7" : "#DBEAFE", color: isShort ? "#92400E" : "#1E40AF", padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: "0.02em" }}>
      {delta > 0 ? "+" : ""}{pct}%
    </span>
  );
}

export function parseNum(v, fallback = 0) {
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}
export function fmtMoney(n, cur = "PLN") {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return `${Number(n).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}
// v6.36.1 (P2): stock age — the first real receipt (non-voided IN) is the arrival.
function lotArrivalDate(lot: any): string | null {
  const ins = (lot.movements || []).filter((m: any) => m && !m.voided && m.type === "IN" && m.date).map((m: any) => String(m.date)).sort();
  return ins[0] || null;
}
// v6.99.81: lotAgeDays retired — the Arrived · age column reads lotArrivedCell (lotView.domain)
function ageColor(days: number): string { return days <= 7 ? "#16A34A" : days <= 14 ? "#D97706" : "#DC2626"; }

export function totalCost(lot) {
  return (lot.costs || []).reduce((s, c) => s + (c.pln || 0), 0);
}
export function costPerKg(lot) {
  const total = totalCost(lot);
  // Denominator is the lot's original capacity (receivedKg), not what's left now.
  // We allocate cost across what came in — what's still here is just a portion of that.
  const denom = lot.receivedKg || lot.expectedKg || 0;
  return denom > 0 ? total / denom : 0;
}
export function valueInStock(lot) {
  // Value still on hand = what's physically here × per-kg cost basis.
  // Note: physicalKg already accounts for SHIP_OUT movements (goods gone).
  return (lot.physicalKg || 0) * costPerKg(lot);
}

// Replay a lot's full movement list to derive its running quantities, location and
// status from scratch. Used whenever movements are added, edited or deleted, so the
// lot stays consistent no matter what changed. (Replay-from-zero is valid because
// every quantity change is represented by a movement.)
function recomputeLotFromMovements(lot: any, movements: any[]) {
  return domainRecomputeLot(lot, movements, locById); // engine: inventory.domain (Batch 1)
}



// ─── INSPECTION MODAL (v6.2) ────────────────────────────────────────────────
export const INSPECTION_CONTEXTS = [
  { code: "arrival", label: "Arrival QC (our inspection on receipt)" },
  { code: "warehouse", label: "Warehouse-reported (during storage)" },
  { code: "client", label: "Client feedback (after delivery)" },
  { code: "customs", label: "Customs examination" },
];
export const INSPECTION_OUTCOMES = [
  { code: "ok", label: "Passed — no issue" },
  { code: "weight_loss", label: "Weight loss / shrinkage" },
  { code: "damage", label: "Damaged / spoiled (write-off)" },
  { code: "downgrade", label: "Quality downgrade" },
  { code: "rejection", label: "Client rejection" },
];
function InspectionModal({ lot, onCancel, onConfirm }: any) {
  const [context, setContext] = useState("arrival");
  const [date, setDate] = useState(today);
  const [outcome, setOutcome] = useState("ok");
  const [lossKg, setLossKg] = useState("");
  const [findings, setFindings] = useState("");
  const [proposeCN, setProposeCN] = useState(false);
  const [cnAmount, setCnAmount] = useState("");
  const [cnCurrency, setCnCurrency] = useState(lot.currency || "PLN");
  const affectsStock = outcome === "weight_loss" || outcome === "damage" || outcome === "rejection";
  // v6.3.0: direct-flow lots never enter our warehouse (physicalKg 0), so quality
  // write-offs validate against the expected/direct quantity instead.
  const lotIsDirect = !!lot.directFlow || lot.status === "Direct Expected";
  const maxLoss = lotIsDirect ? Math.max(parseFloat(lot.expectedKg) || 0, lot.physicalKg || 0) : (lot.physicalKg || 0);
  const lossNum = parseFloat(lossKg) || 0;
  const lossInvalid = affectsStock && (lossNum <= 0 || lossNum > maxLoss);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 95, padding: 20 }}>
      <div style={{ width: 540, maxHeight: "88vh", overflow: "auto", background: "#fff", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.24)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #EBEBEB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>🔍 Record inspection</strong>
          <span style={{ fontSize: 12, color: "#888" }}>{lot.number} · {lot.product}{lot.variety ? " — " + lot.variety : ""}</span>
        </div>
        <div style={{ padding: 20, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
            <div><Lbl>When / context</Lbl><Sel value={context} onChange={e => setContext(e.target.value)}>{INSPECTION_CONTEXTS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</Sel></div>
            <div><Lbl>Date</Lbl><Inp type="date" value={date} onChange={e => setDate(e.target.value)} noFuture /></div>
          </div>
          <div><Lbl>Outcome</Lbl><Sel value={outcome} onChange={e => setOutcome(e.target.value)}>{INSPECTION_OUTCOMES.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}</Sel></div>
          {affectsStock && (
            <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: 12 }}>
              <Lbl>Affected quantity (kg) · max {maxLoss.toLocaleString()}</Lbl>
              <Inp type="number" value={lossKg} onChange={e => setLossKg(e.target.value)} placeholder="0" />
              <div style={{ fontSize: 10.5, color: "#9A3412", marginTop: 6 }}>This records a write-off movement that reduces stock on hand by this amount.</div>
            </div>
          )}
          <div><Lbl>Findings / notes</Lbl>
            <textarea value={findings} onChange={e => setFindings(e.target.value)} rows={3}
              style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", outline: "none", resize: "vertical" }}
              placeholder="e.g. 3% shrinkage on arrival; soft fruit in 2 pallets; client reported mould on delivery" />
          </div>
          <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
              <input type="checkbox" checked={proposeCN} onChange={e => setProposeCN(e.target.checked)} />
              Propose a credit note for this inspection
            </label>
            {proposeCN && (
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginTop: 10 }}>
                <div><Lbl>Proposed credit amount</Lbl><Inp type="number" value={cnAmount} onChange={e => setCnAmount(e.target.value)} placeholder="0" /></div>
                <div><Lbl>Currency</Lbl><Sel value={cnCurrency} onChange={e => setCnCurrency(e.target.value)}><option>PLN</option><option>EUR</option><option>USD</option></Sel></div>
                <div style={{ gridColumn: "span 2", fontSize: 10.5, color: "#92400E", background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 6, padding: "6px 9px" }}>This records a <strong>proposed</strong> credit note on the lot. Issuing it formally happens in the Invoicing module (later).</div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button onClick={onCancel} style={{ flex: 1, padding: "10px", border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button
              disabled={lossInvalid || (proposeCN && (parseFloat(cnAmount) || 0) <= 0)}
              onClick={() => onConfirm({
                context, date, outcome,
                lossKg: affectsStock ? lossNum : 0,
                findings,
                creditNote: proposeCN ? { amount: parseFloat(cnAmount) || 0, currency: cnCurrency } : null,
              })}
              style={{ flex: 1, padding: "10px", border: "none", borderRadius: 8, background: (lossInvalid || (proposeCN && (parseFloat(cnAmount) || 0) <= 0)) ? "#D1D5DB" : "#0E7490", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Save inspection
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LOT DETAIL VIEW ────────────────────────────────────────────────────────

// ─── v6.6: print helper for the settlement statement (same pattern as Shipments) ─
export function printHtmlNodeInv(nodeId, title, notify = null) {
  const node = document.getElementById(nodeId);
  if (!node) { if (notify) notify({ tone: "warn", title: "Not ready", message: "Print preview not ready — please try again in a moment." }); else console.warn("print preview node missing:", nodeId); return; }
  const existing = document.getElementById(`${nodeId}-frame`);
  if (existing) existing.remove();
  const iframe = document.createElement("iframe");
  iframe.id = `${nodeId}-frame`;
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  /* v6.99.21 (A-R15-1): the report was cut on the right — fixed width + non-wrapping tables. Fit the page instead. */
  @page { size: A4; margin: 10mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: Arial, Calibri, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  * { box-sizing: border-box; max-width: 100%; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; page-break-inside: avoid; }
  td, th { word-wrap: break-word; overflow-wrap: anywhere; white-space: pre-line; vertical-align: top; }
  tr { page-break-inside: avoid; }
</style></head><body>${(() => { const c = node.cloneNode(true) as HTMLElement; c.style.position = "static"; c.style.left = "auto"; c.style.top = "auto"; c.style.width = "100%"; c.style.maxWidth = "100%"; return c.outerHTML; })()}</body></html>`;   // v6.99.17 (A-R13-4): the hidden report was printed off-page
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) { iframe.remove(); return; }
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => {
    const prevTitle = document.title; // v6.18.8 (#1): name the saved PDF after the document
    document.title = title || prevTitle;
    try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch {}
    setTimeout(() => { iframe.remove(); document.title = prevTitle; }, 1000);
  }, 150);
}



export function normName(v: any) { return String(v || "").trim().toLowerCase(); }

// ─── v6.5: SORTING EVENT MODAL ──────────────────────────────────────────────
// Logs a warehouse sorting service on the lot (kg sorted on a date). No stock
// change — it feeds the expected warehouse charges (sorting rate × kg).
function SortingModal({ lot, onCancel, onConfirm }: any) {
  const [kg, setKg] = useState("");
  const [date, setDate] = useState(localTodayISO());
  const [note, setNote] = useState("");
  const kgNum = parseNum(kg);
  const maxKg = Math.max(lot.physicalKg || 0, parseNum(lot.expectedKg));
  const invalid = !(kgNum > 0) || kgNum > maxKg;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120, padding: 20 }}>
      <div style={{ width: 440, background: "#fff", borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #EBEBEB" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Record sorting · {lot.number}</div>
          <div style={{ fontSize: 11.5, color: "#888", marginTop: 3 }}>Warehouse sorting service — charged per kg on the warehouse tariff. Does not change stock; record any rejected kg separately as a quality issue.</div>
        </div>
        <div style={{ padding: "16px 22px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>Sorted quantity (kg)</label>
              <input type="number" value={kg} onChange={e => setKg(e.target.value)} placeholder={`max ${maxKg.toLocaleString("pl-PL")}`} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>Date</label>
              <DateInput value={date} onChange={e => setDate(e.target.value)} noFuture style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
            </div>
          </div>
          <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>Note (optional)</label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. pre-dispatch sorting for SO-2026-014" style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
          {invalid && kg && <div style={{ marginTop: 10, padding: "7px 10px", background: "#FEE2E2", borderRadius: 6, fontSize: 12, color: "#991B1B" }}>Quantity must be between 0 and {maxKg.toLocaleString("pl-PL")} kg.</div>}
        </div>
        <div style={{ padding: "14px 22px", borderTop: "1px solid #EBEBEB", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onCancel} style={{ padding: "8px 16px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button disabled={invalid} onClick={() => onConfirm({ kg: kgNum, date, note })} style={{ padding: "8px 16px", borderRadius: 7, border: "none", background: invalid ? "#E5E7EB" : "#16A34A", color: invalid ? "#9CA3AF" : "#fff", fontSize: 13, fontWeight: 700, cursor: invalid ? "not-allowed" : "pointer", fontFamily: "inherit" }}>Record sorting</button>
        </div>
      </div>
    </div>
  );
}

// ─── v6.5 anchor end ────────────────────────────────────────────────────────
function ReturnModal({ lot, contacts = [], onCancel, onConfirm }: any) {
  const locs = mergedLocations(contacts);
  const ownWarehouses = locs.filter((l: any) => l.type === "OWN");
  const lastShip = [...(lot.movements || [])].reverse().find((m: any) => m.type === "SHIP_OUT");
  const defTo = ownWarehouses.find((w: any) => String(w.id) === String(lot.locationId))?.id || ownWarehouses[0]?.id || "";
  const [kg, setKg] = useState("");
  const [fromId, setFromId] = useState(String(lastShip?.toId || ""));
  const [toId, setToId] = useState(String(defTo || ""));
  const [cost, setCost] = useState("");
  const [currency, setCurrency] = useState(lot.currency || "PLN");
  const [fxRate, setFxRate] = useState((lot.currency || "PLN") === "PLN" ? "1" : "");
  const [date, setDate] = useState(localTodayISO());
  const [reason, setReason] = useState("");
  const kgN = parseNum(kg);
  const valid = kgN > 0 && !!toId;
  const lblStyle: any = { fontSize: 11, fontWeight: 600, color: "#64748B", marginBottom: 4, display: "block" };
  const inpStyle: any = { width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, padding: "24px 16px", overflowY: "auto" }}>
      <div style={{ background: "#fff", borderRadius: 14, width: 520, maxWidth: "100%", maxHeight: "calc(100vh - 48px)", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", margin: "auto", padding: 22 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>↩ Return to warehouse — {lot.number}</div>
        <div style={{ fontSize: 11.5, color: "#64748B", lineHeight: 1.5, marginBottom: 16 }}>
          A return restores stock to your warehouse and books the return transport as a shipment with its cost. It does <strong>not</strong> reopen the original sale — settle any value with the client via a quality issue / credit note.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><label style={lblStyle}>Returned kg</label><input type="number" value={kg} onChange={e => setKg(e.target.value)} style={inpStyle} placeholder="e.g. 5" /></div>
          <div><label style={lblStyle}>Return date</label><DateInput value={date} onChange={e => setDate(e.target.value)} noFuture style={inpStyle} /></div>
          <div><label style={lblStyle}>From (client)</label><select value={fromId} onChange={e => setFromId(e.target.value)} style={inpStyle}><option value="">—</option>{locs.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
          <div><label style={lblStyle}>To (warehouse)</label><select value={toId} onChange={e => setToId(e.target.value)} style={inpStyle}><option value="">—</option>{ownWarehouses.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
          <div><label style={lblStyle}>Return transport cost</label><input type="number" value={cost} onChange={e => setCost(e.target.value)} style={inpStyle} placeholder="0" /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div><label style={lblStyle}>Currency</label><select value={currency} onChange={e => { setCurrency(e.target.value); setFxRate(e.target.value === "PLN" ? "1" : ""); }} style={inpStyle}>{["PLN", "EUR", "USD"].map(c => <option key={c}>{c}</option>)}</select></div>
            <div><label style={lblStyle}>FX → PLN</label><input type="number" value={fxRate} onChange={e => setFxRate(e.target.value)} style={inpStyle} /></div>
          </div>
        </div>
        <div style={{ marginTop: 12 }}><label style={lblStyle}>Reason / note</label><input value={reason} onChange={e => setReason(e.target.value)} style={inpStyle} placeholder="e.g. Quality dispute — returned by client" /></div>
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: "10px", border: "1px solid #E2E8F0", borderRadius: 8, background: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button disabled={!valid} onClick={() => onConfirm({ kg: kgN, fromId, toId, cost: parseNum(cost), currency, fxRate: parseNum(fxRate) || 1, date, reason })} style={{ flex: 1, padding: "10px", border: "none", borderRadius: 8, background: valid ? "#7C3AED" : "#CBD5E1", color: "#fff", fontSize: 13, fontWeight: 700, cursor: valid ? "pointer" : "not-allowed", fontFamily: "inherit" }}>Return to warehouse</button>
        </div>
      </div>
    </div>
  );
}


// ── v6.89.0 (consignment season): QUALITY INSPECTION · SORTING JOB · STOCK COUNT ──
// One owner per fact: inspections store (lot-referenced), sorting posts DAMAGE + grade split on the lot,
// stock counts create reasoned adjustments. Compact forms; the Lot Workbench (v6.91) composes them.
// ── v6.99.32 (A-QH-1…8, owner ruling 15 Sept): QUALITY & HANDLING — the warehouse's own screen ──
// Three acts, in the order they happen in the building: inspect → sort → count. Each opens its own WINDOW
// (the old toggles unfolded a form under the buttons and read as a wall of text). Ownership is unchanged:
// the inspection judges, the sorting re-classes, the count corrects — none of them does another's job.
export const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : 0; };
// v6.99.33 (owner): the row actions are unmistakable - edit in the same blue as Claims, delete in red.
const qhBtn: any = { padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer" };
export const qhEdit: any = { ...qhBtn, border: "1px solid #2563EB", background: "#EFF6FF", color: "#1D4ED8" };
export const qhPrint: any = { ...qhBtn, border: "1px solid #0E7490", background: "#F0FDFA", color: "#0E7490" };
export const qhDelete: any = { ...qhBtn, border: "1px solid #DC2626", background: "#DC2626", color: "#fff" };

export function supplierRefOf(lot: any, shipments: any[]): string {
  // v6.99.34: the supplier's own reference travels on the truck that brought the lot (GM-004 and the like).
  const sh = (shipments || []).find((s: any) => s && String(s.status) !== "Cancelled" && ((s.poRefs || []).includes(lot?.poRef) || (s.goods || []).some((g: any) => String(g.lotRef) === String(lot?.number))) && (s.supplierRef || (s.legs || []).some((l: any) => (l.vehicles || []).some((u: any) => u.supplierRef))));
  if (!sh) return "";
  return String(sh.supplierRef || (sh.legs || []).flatMap((l: any) => (l.vehicles || []).map((u: any) => u.supplierRef)).find(Boolean) || "");
}


// ── v6.99.32: the three windows of Quality & Handling (A-QH-1/3/5/6/8) ──
function QhWindow({ title, subtitle, colour, onClose, onSave, saveLabel = "Save", confirmText = "", children, extra = null, draft = undefined }: any) {
  useUnsavedGuard({ id: "qh-window", label: `${String(title || "").trim()} — ${subtitle || ""}`, draft, active: draft !== undefined, save: () => onSave() });   // v6.99.58 (A-US)
  // v6.99.34 (A-R24-5, owner): the confirmation belongs to THIS window — the application-wide dialog appeared detached from it.
  const [asking, setAsking] = React.useState(false);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflow: "auto" }}>
      <div style={{ background: "#fff", borderRadius: 12, width: "min(980px, 100%)", border: `2px solid ${colour}`, overflow: "hidden" }}>
        <div style={{ background: "#F8FAFC", borderBottom: `1px solid ${colour}33`, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <div><div style={{ fontSize: 14, fontWeight: 800, color: colour }}>{title}</div><div style={{ fontSize: 11.5, color: "#64748B" }}>{subtitle}</div></div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {extra}
            <SmallButton kind="close" onClick={onClose}>Close</SmallButton>
            <button onClick={() => (confirmText ? setAsking(true) : onSave())} style={{ padding: "6px 16px", borderRadius: 7, border: "none", background: colour, color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>{saveLabel}</button>
          </div>
        </div>
        <div style={{ padding: "14px 16px", maxHeight: "72vh", overflow: "auto" }}>{children}</div>
        {asking && (
          <div style={{ borderTop: `2px solid ${colour}`, background: "#F8FAFC", padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>{confirmText}</div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <SmallButton onClick={() => setAsking(false)}>No, go back</SmallButton>
              <button onClick={() => { setAsking(false); onSave(); }} style={{ padding: "6px 16px", borderRadius: 7, border: "none", background: colour, color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>Yes, {saveLabel.toLowerCase()}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
const qhInp: any = { border: "1px solid #E5E7EB", borderRadius: 7, padding: "7px 9px", fontSize: 12.5, width: "100%", boxSizing: "border-box" };
function QhField({ label, hint, children }: any) {
  return <div><div style={{ fontSize: 10.5, fontWeight: 700, color: "#94A3B8", marginBottom: 3 }}>{label}</div>{children}{hint ? <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 2 }}>{hint}</div> : null}</div>;
}

/** A-QH-3/4/7/8: the quality report as the producer's sheet — header · external quality · defects · conclusion. */
export function InspectionWindow({ ins, setIns, lot, cat, onClose, onSave }: any) {
  const set = (k: string, v: any) => setIns((x: any) => ({ ...x, [k]: v }));
  const v = inspectionVerdict(ins);
  const checks: any[] = ins.externalChecks || [];
  const setCheck = (i: number, k: string, val: any) => set("externalChecks", checks.map((c, j) => j === i ? { ...c, [k]: val } : c));
  // v6.99.83 (A-QC-1, owner 30 Sept): the field kept snapping back to 0 — clearing it stored 0 at once. Keep the text as typed;
  // an empty or unfinished value counts as 0 only when the report is judged (inspectionVerdict).
  const setTol = (categoryName: string, val: any) => set("tolerances", { ...(ins.tolerances || {}), [categoryName]: val === "" ? "" : (isFinite(parseFloat(val)) ? parseFloat(val) : val) });
  return (
    <QhWindow draft={ins} title="🔬 Quality inspection" subtitle={`${lot.number} · ${lot.product}${lot.variety ? " — " + lot.variety : ""}`} colour="#0E7490" onClose={onClose} onSave={() => onSave(ins)} saveLabel="Save report">
      <div style={{ fontSize: 10.5, fontWeight: 800, color: "#94A3B8", marginBottom: 6 }}>HEADER</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
        <QhField label="Date of inspection" hint={beforeReceiptWarning(lot, ins.date) || undefined}><DateInput value={ins.date} min={lotReceiptDate(lot) || undefined} onChange={(e: any) => set("date", e.target.value)} /></QhField>
        <QhField label="Location of inspection"><Sel value={ins.stage} onChange={(e: any) => set("stage", e.target.value)}><option value="pre-unloading">On arrival / pre-unloading</option><option value="warehouse">In our warehouse</option><option value="client">At the client</option><option value="other">Other</option></Sel></QhField>
        <QhField label="Inspector"><input value={ins.inspector || ""} onChange={e => set("inspector", e.target.value)} style={qhInp} /></QhField>
        <QhField label="Temperature (°C)"><input value={ins.temperature ?? ""} onChange={e => set("temperature", e.target.value)} style={qhInp} /></QhField>
        <QhField label={`Quantity delivered (${ins.unit || "kg"})`}><input type="number" value={ins.orderedQty ?? ""} onChange={e => set("orderedQty", e.target.value)} style={qhInp} />{(() => { const n = inspectionQtyNote(ins, lot); if (!n) return null; const k = (v: number) => Math.round(v).toLocaleString("pl-PL");
          return <div style={{ fontSize: 10.5, fontWeight: 700, color: "#B45309", marginTop: 3 }}>{n.kind === "receipt" ? `⚠ the receipt says ${k(n.lotKg)} kg — correct the receipt if this report is right` : `the lot will be re-posted from ${k(n.lotKg)} to ${k(n.reportKg)} kg — the client's report owns a direct lot`}</div>; })()}</QhField>
        <QhField label={`Quantity checked (${ins.unit || "kg"})`} hint="same unit as delivered"><input type="number" value={ins.checkedQty ?? ""} onChange={e => set("checkedQty", e.target.value)} style={qhInp} /></QhField>
        <QhField label="Unit" hint="applies to both quantities"><Sel value={ins.unit || "kg"} onChange={(e: any) => { const u = e.target.value; const kpb = num((ins.externalChecks || []).find((c: any) => String(c.name).startsWith("Unit pack weight"))?.expected) || 0;
        setIns((x: any) => { const conv = (val: any) => { const n = num(val); if (!n || !kpb) return val; return u === "boxes" ? Math.round(n / kpb) : Math.round(n * kpb); };
          return { ...x, unit: u, orderedQty: conv(x.orderedQty), checkedQty: conv(x.checkedQty) }; }); }}><option value="kg">kg</option><option value="boxes">boxes</option></Sel></QhField>
        <QhField label="Sample %" hint="computed: checked ÷ delivered"><div style={{ ...qhInp, background: "#F8FAFC", fontWeight: 800 }}>{samplePctOf(ins)} %</div></QhField>
      </div>

      <div style={{ fontSize: 10.5, fontWeight: 800, color: "#94A3B8", marginBottom: 6 }}>EXTERNAL QUALITY — what we ordered against what arrived</div>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.7fr 0.7fr 0.7fr 1fr", gap: 8, fontSize: 10, fontWeight: 700, color: "#94A3B8" }}><div>CHECK</div><div>EXPECTED</div><div>MAX</div><div>AVG</div><div>MIN</div><div>RESULT</div></div>
      {checks.map((c: any, i: number) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.7fr 0.7fr 0.7fr 1fr", gap: 8, alignItems: "center", padding: "3px 0" }}>
          <div style={{ fontSize: 12 }}>{c.name}</div>
          <input value={c.expected ?? ""} onChange={e => setCheck(i, "expected", e.target.value)} style={qhInp} />
          <input value={c.max ?? ""} onChange={e => setCheck(i, "max", e.target.value)} style={qhInp} />
          <input value={c.avg ?? ""} onChange={e => setCheck(i, "avg", e.target.value)} style={qhInp} />
          <input value={c.min ?? ""} onChange={e => setCheck(i, "min", e.target.value)} style={qhInp} />
          <Sel value={c.status || "Not checked"} onChange={(e: any) => setCheck(i, "status", e.target.value)}><option>Not checked</option><option>Correct</option><option>Not correct</option></Sel>
        </div>
      ))}

      <div style={{ fontSize: 10.5, fontWeight: 800, color: "#94A3B8", margin: "14px 0 6px" }}>DEFECTS</div>
      {(ins.defects || []).map((d: any, i: number) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "150px 1fr 90px 90px 34px", gap: 8, marginBottom: 5, alignItems: "center" }}>
          <Sel value={d.category} onChange={(e: any) => set("defects", ins.defects.map((x: any, k: number) => k === i ? { ...x, category: e.target.value, name: "" } : x))}>{DEFECT_CATEGORIES.map((c: string) => <option key={c}>{c}</option>)}</Sel>
          <Sel value={d.name} onChange={(e: any) => set("defects", ins.defects.map((x: any, k: number) => k === i ? { ...x, name: e.target.value } : x))}>
            <option value="">— defect —</option>
            {defectsFor(cat, lot.product).filter((x: any) => String(x.category) === String(d.category)).map((x: any, k: number) => <option key={k} value={x.name}>{x.name}</option>)}
            {d.name && !defectsFor(cat, lot.product).some((x: any) => x.name === d.name) && <option value={d.name}>{d.name}</option>}
          </Sel>
          <input type="number" step="0.01" placeholder="% found" value={d.pct ?? ""} onChange={e => set("defects", ins.defects.map((x: any, k: number) => k === i ? { ...x, pct: e.target.value } : x))} style={qhInp} />
          <div style={{ fontSize: 10.5, color: "#94A3B8", textAlign: "center" }}>tol. {parseFloat((ins.tolerances || {})[d.category]) || 0} %</div>
          <ActionButton action="close" onClick={() => set("defects", ins.defects.filter((_: any, k: number) => k !== i))} />
        </div>
      ))}
      <button onClick={() => set("defects", [...(ins.defects || []), { category: "Major", name: "", pct: "" }])}
        style={{ width: "100%", padding: "9px", marginTop: 4, border: "2px dashed #0E7490", borderRadius: 8, background: "#F0FDFA", color: "#0E7490", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>⊕ Add defect</button>

      <div style={{ fontSize: 10.5, fontWeight: 800, color: "#94A3B8", margin: "14px 0 6px" }}>TOLERANCES &amp; CONCLUSION <span style={{ fontWeight: 500, textTransform: "none" }}>— the limits this report is judged against; they travel with it</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 8 }}>
        {v.rows.map((r: any) => (
          <div key={r.category} style={{ border: `1px solid ${r.acceptable ? "#BBF7D0" : "#FECACA"}`, background: r.acceptable ? "#F0FDF4" : "#FEF2F2", borderRadius: 8, padding: "7px 9px" }}>
            <div style={{ fontSize: 11, fontWeight: 800 }}>{r.category}</div>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{r.pct} %</div>
            <div style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 3 }}>
              <span style={{ fontSize: 10.5, color: "#64748B" }}>tolerance</span>
              <input type="number" step="0.1" disabled={r.category === "Unacceptable"} value={(ins.tolerances || {})[r.category] ?? r.tolerance} onChange={e => setTol(r.category, e.target.value)}
                title={r.category === "Unacceptable" ? "Always 0 % — one unacceptable defect rejects the consignment" : ""} style={{ ...qhInp, width: 62, padding: "3px 6px", background: r.category === "Unacceptable" ? "#F3F4F6" : "#fff" }} />
              <span style={{ fontSize: 10.5 }}>%</span>
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: r.acceptable ? "#16A34A" : "#DC2626", marginTop: 3 }}>{r.acceptable ? "Acceptable" : "Not acceptable"}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 10, alignItems: "start" }}>
        <QhField label="Verdict" hint={v.advice}><Sel value={ins.verdict} onChange={(e: any) => set("verdict", e.target.value)}><option>Pending</option><option>Accepted</option><option>Sort</option><option>Rejected</option></Sel></QhField>
        <QhField label={`Comments · total defects ${v.totalPct} %`}><textarea value={ins.observations || ""} onChange={e => set("observations", e.target.value)} rows={2} style={{ ...qhInp, resize: "vertical" }} /></QhField>
      </div>
      <QhField label="Pictures / report link"><input value={(ins.links || [])[0] || ""} onChange={e => set("links", [e.target.value])} placeholder="https://…" style={qhInp} /></QhField>
    </QhWindow>
  );
}

/** A-QH-5: sorting follows an inspection; it warns when there is none but never blocks. */
export function SortingWindow({ f, setF, lot, inspections = [], contacts = [], onClose, onSave }: any) {
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const placed = num(f.classIKg) + num(f.classIIKg) + num(f.wasteKg);
  const remaining = r0(num(f.kgIn) - placed);
  const follows = inspections.find((x: any) => String(x.id) === String(f.followsInspection));
  return (
    <QhWindow draft={f} title="⚖ Sorting job" subtitle={`${lot.number} · splits what the inspection said to sort`} colour="#7C3AED" onClose={onClose}
      onSave={onSave} saveLabel="Post sorting"
      confirmText={`Post this sorting: ${num(f.kgIn).toLocaleString("pl-PL")} kg → class I ${num(f.classIKg).toLocaleString("pl-PL")} · class II ${num(f.classIIKg).toLocaleString("pl-PL")} · waste ${num(f.wasteKg).toLocaleString("pl-PL")}${follows ? "" : " (no inspection referenced)"}?`}>
      {!inspections.length && <div style={{ fontSize: 11.5, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 7, padding: "6px 9px", marginBottom: 10 }}>No quality inspection on this lot yet — sorting normally follows one. You can still post it.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
        <QhField label="Date sorted" hint={beforeReceiptWarning(lot, f.date) || undefined}><DateInput value={f.date} min={lotReceiptDate(lot) || undefined} onChange={(e: any) => set("date", e.target.value)} /></QhField>
        <QhField label="What is being sorted" hint="a second sorting takes from what is left, not from the whole lot">
          <Sel value={f.fromPool || "UNSORTED"} onChange={(e: any) => { const k = e.target.value; const pool = sortablePools(lot).find((x: any) => x.key === k); setF((x: any) => ({ ...x, fromPool: k, kgIn: pool ? pool.kg : x.kgIn })); }}>
            {sortablePools(lot).map((x: any) => <option key={x.key} value={x.key}>{x.label} — {x.kg.toLocaleString("pl-PL")} kg available</option>)}
          </Sel>
        </QhField>
        <QhField label="Follows inspection"><Sel value={f.followsInspection || ""} onChange={(e: any) => set("followsInspection", e.target.value)}><option value="">— none —</option>{inspections.map((x: any) => <option key={String(x.id)} value={String(x.id)}>{x.date} · {x.verdict} · defects {inspectionVerdict(x).totalPct} %</option>)}</Sel></QhField>
        <QhField label="Sorted by"><input value={f.by || ""} onChange={e => set("by", e.target.value)} placeholder="our team / warehouse" style={qhInp} list="qh-sorters" /><datalist id="qh-sorters">{(contacts || []).filter((c: any) => (c.roles || [c.type]).includes("Warehouse")).map((c: any) => <option key={String(c.id)} value={c.name} />)}</datalist></QhField>
        <QhField label="Hours"><input type="number" value={f.hours ?? ""} onChange={e => set("hours", e.target.value)} style={qhInp} /></QhField>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <QhField label="Kg sorted (in)"><input type="number" value={f.kgIn ?? ""} onChange={e => set("kgIn", e.target.value)} style={qhInp} /></QhField>
        <QhField label="→ Class I"><input type="number" value={f.classIKg ?? ""} onChange={e => set("classIKg", e.target.value)} style={qhInp} /></QhField>
        <QhField label="→ Class II"><input type="number" value={f.classIIKg ?? ""} onChange={e => set("classIIKg", e.target.value)} style={qhInp} /></QhField>
        <QhField label="→ Waste"><input type="number" value={f.wasteKg ?? ""} onChange={e => set("wasteKg", e.target.value)} style={qhInp} /></QhField>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: remaining === 0 ? "#16A34A" : "#B45309" }}>
        {remaining === 0 ? "✓ the three add up to the kilos sorted" : `${remaining > 0 ? remaining.toLocaleString("pl-PL") + " kg not yet placed" : Math.abs(remaining).toLocaleString("pl-PL") + " kg more than sorted"}`}
      </div>
      <QhField label="Note"><input value={f.note || ""} onChange={e => set("note", e.target.value)} style={qhInp} /></QhField>
    </QhWindow>
  );
}

/** A-QH-6: counted as the warehouse counts — pallets and boxes, per class. */
export function CountWindow({ f, setF, lot, onClose, onSave }: any) {
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const setRow = (grade: string, k: string, v: any) => set("entries", { ...(f.entries || {}), [grade || "-"]: { ...((f.entries || {})[grade || "-"] || {}), [k]: v } });
  return (
    <QhWindow draft={f} title="📋 Stock count" subtitle={`${lot.number} · what is physically on the floor`} colour="#B45309" onClose={onClose} onSave={onSave} saveLabel="Save count & adjust"
      confirmText="Save this count? Differences beyond 1 kg are posted as reasoned adjustments on their class.">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
        <QhField label="Date counted" hint={beforeReceiptWarning(lot, f.date) || undefined}><DateInput value={f.date} min={lotReceiptDate(lot) || undefined} onChange={(e: any) => set("date", e.target.value)} /></QhField>
        <QhField label="Counted by"><input value={f.by || ""} onChange={e => set("by", e.target.value)} style={qhInp} /></QhField>
        <QhField label="Reason / note"><input value={f.reason || ""} onChange={e => set("reason", e.target.value)} placeholder="monthly count, spot check…" style={qhInp} /></QhField>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.7fr 0.9fr 0.8fr 0.8fr 1fr 1fr", gap: 8, fontSize: 10, fontWeight: 700, color: "#94A3B8" }}>
        <div>LINE</div><div>PALLETS</div><div>BOXES / PAL</div><div>LOOSE BOXES</div><div>KG / BOX</div><div>COUNTED KG</div><div>SYSTEM · DIFF</div>
      </div>
      {countLinesForLot(lot).map((r: any, i: number) => { const e = { ...((f.entries || {})[r.grade || "-"] || {}), kgPerBox: (f.entries || {})[r.grade || "-"]?.kgPerBox ?? f.kgPerBox }; const kg = countedKgOf(e as any); const diff = r0(kg - num(r.systemKg)); return (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 0.7fr 0.9fr 0.8fr 0.8fr 1fr 1fr", gap: 8, alignItems: "center", padding: "4px 0", borderTop: "1px solid #F8FAFC" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: r.informational ? "#94A3B8" : "#111" }}>{r.label}</div>
          <input type="number" value={(e as any).pallets ?? ""} onChange={ev => setRow(r.grade, "pallets", ev.target.value)} style={qhInp} />
          <input type="number" value={(e as any).boxesPerPallet ?? ""} onChange={ev => setRow(r.grade, "boxesPerPallet", ev.target.value)} style={qhInp} />
          <input type="number" value={(e as any).looseBoxes ?? ""} onChange={ev => setRow(r.grade, "looseBoxes", ev.target.value)} style={qhInp} />
          <input type="number" value={(e as any).kgPerBox ?? ""} onChange={ev => setRow(r.grade, "kgPerBox", ev.target.value)} style={qhInp} />
          <input type="number" value={kg > 0 ? kg : ((e as any).countedKg ?? "")} onChange={ev => setRow(r.grade, "countedKg", ev.target.value)} disabled={kg > 0} title={kg > 0 ? "derived from the boxes" : "loose goods — type the kilos"} style={{ ...qhInp, background: kg > 0 ? "#F8FAFC" : "#fff", fontWeight: 700 }} />
          <div style={{ fontSize: 11.5 }}>{r.informational ? <span style={{ color: "#94A3B8" }}>not adjusted</span> : <>{Math.round(num(r.systemKg)).toLocaleString("pl-PL")} · <b style={{ color: diff === 0 ? "#16A34A" : "#B45309" }}>{diff >= 0 ? "+" : ""}{diff}</b></>}</div>
        </div>
      ); })}
      <div style={{ marginTop: 8, fontSize: 11, color: "#64748B" }}>Waste and damaged boxes were written off when they were found — count them on their own line if they are still on the floor; that figure never adjusts the stock. A difference beyond 1 kg on class I or class II becomes a reasoned adjustment on that class.</div>
    </QhWindow>
  );
}

/** The printable quality report (hidden; printed by number). */
// v6.99.37 (QA-1): the printable quality report moved to QualityReportDoc.tsx — one component, two screens.


// ── v6.91.0: THE LOT WORKBENCH — one screen per lot, composed from the owning modules, storing nothing ──
export function LotWorkbench({ lot, shipments = [], inspections = [], claims = [], orders = [], settlements = [], contacts = [], pos = [] }: any) {
  const S = (v: any) => String(v ?? "").trim();
  const num = (v: any) => { const n = parseFloat(String(v ?? "")); return isFinite(n) ? n : 0; };
  // Arrival: the supplier-delivery (or any inbound) shipment that carried this lot
  const arrival = (shipments || []).find((s: any) => String(s.purpose || "").toUpperCase() === "INBOUND" && ((s.lotRefs || []).map(String).includes(String(lot.number)) || (s.goods || []).some((g: any) => String(g.lotRef) === String(lot.number) || (lot.poRef && String(g.poRef) === String(lot.poRef)))));
  const unit = arrival ? ((arrival.legs || [])[0]?.vehicles || [])[0] : null;
  const receipt = (lot.movements || []).find((m: any) => m.type === "IN" && !m.voided && m.varianceKg !== undefined);
  const ins = (inspections || []).filter((x: any) => String(x.lotNumber) === String(lot.number)).sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
  const lastIns = ins[0];
  const lotClaims = (claims || []).filter((c: any) => (c.subjects || []).some((s: any) => String(s.ref || s.number) === String(lot.number)) || (c.rootDoc && String(c.rootDoc.number) === String(lot.poRef)));
  const g = gradeSplit(lot);
  const sales = (orders || []).filter((o: any) => o.status !== "Cancelled" && o.status !== "Draft" && (o.items || []).some((it: any) => (it.sourceType === "STOCK" && String(it.sourceRef) === String(lot.number)) || (it.sourceType === "PO" && lot.poRef && String(it.sourceRef) === String(lot.poRef))));
  const soldKg = sales.reduce((s: number, o: any) => s + (o.items || []).filter((it: any) => (it.sourceType === "STOCK" && String(it.sourceRef) === String(lot.number)) || (it.sourceType === "PO" && lot.poRef && String(it.sourceRef) === String(lot.poRef))).reduce((a: number, it: any) => a + num(it.qty), 0), 0);
  const settlement = (settlements || []).find((s: any) => String(s.poNumber) === String(lot.poRef));
  const supplier = (contacts || []).find((c: any) => (c.type === "Supplier" || (c.roles || []).includes("Supplier")) && S(c.name) && (arrival?.supplierId != null ? String(c.id) === String(arrival.supplierId) : false));
  const reportDays = num(supplier?.reportDays) || num(supplier?.agreement?.qualityReportDays) || 0;
  const arrivedAt = S(unit?.arrivedAt || unit?.deliveredAt || receipt?.date || lot.arrivalDate);
  const dueQC = arrivedAt && reportDays ? new Date(new Date(arrivedAt).getTime() + reportDays * 86400000).toISOString().slice(0, 10) : "";
  const tile = (title: string, body: any, color = "#111") => (
    <div style={{ background: "#FAFAFA", border: "1px solid #F1F5F9", borderRadius: 8, padding: "8px 10px", minWidth: 0 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: "#94A3B8", letterSpacing: 0.4 }}>{title}</div>
      <div style={{ fontSize: 11.5, color, marginTop: 3, lineHeight: 1.45 }}>{body}</div>
    </div>
  );
  return (
    <div style={{ background: "#fff", border: "2px solid #1E293B", borderRadius: 12, marginBottom: 16, overflow: "hidden" }}>
      {/* v6.99.34 (A-R24-6, owner): the title line is the ONE place where our lot number and the supplier's reference
          sit together — the only link between their vocabulary and ours. It is set in type you can read across the room. */}
      {/* v6.99.81 (A-IN-9, owner): a light header, dark text; the PO number leads — this is where the producer's reference meets
          our PO, the link that matters on a consignment — and the lot number and variety, already at the top of the page, are gone */}
      {(() => { const po = (pos || []).find((p: any) => String(p.number) === String(lot.poRef)); const consignment = String(po?.pricingMode || "") === "consignment"; return (
      <div style={{ background: "#F1F5F9", color: "#0F172A", padding: "10px 16px", display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", borderBottom: "1px solid #E2E8F0" }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "#64748B" }}>LOT WORKBENCH</span>
        {lot.poRef ? <DocLink num={lot.poRef} from={lot.number}><span style={{ fontSize: 16, fontWeight: 800, fontFamily: "ui-monospace, Menlo, monospace", color: "#1D4ED8" }}>{lot.poRef}</span></DocLink> : <span style={{ fontSize: 13, color: "#94A3B8" }}>no purchase order</span>}
        {consignment ? <span style={{ fontSize: 11, fontWeight: 700, background: "#EDE9FE", color: "#6D28D9", padding: "2px 10px", borderRadius: 20 }}>consignment</span> : null}
        {unit?.supplierRef ? <span style={{ fontSize: 13, fontWeight: 700, background: "#DBEAFE", color: "#1E40AF", padding: "2px 10px", borderRadius: 20 }}>supplier ref {unit.supplierRef}</span> : <span style={{ fontSize: 12, color: "#94A3B8" }}>no supplier reference yet</span>}
        {po?.supplier?.name ? <span style={{ fontSize: 12.5, color: "#334155" }}>{po.supplier.name}</span> : null}
      </div>); })()}
      <div style={{ padding: "12px 16px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
        {tile("ARRIVAL", arrival ? <>{arrival.number} · {arrival.arrangedBy === "SUPPLIER" ? "supplier's truck" : "our shipment"}<br />{unit?.truckPlate || unit?.announcedPlate || "plates —"}{plateMismatch(unit) ? <b style={{ color: "#DC2626" }}> · plates differ from announced!</b> : ""}<br />{arrivedAt ? `arrived ${arrivedAt}` : (unit?.eta ? `ETA ${unit.eta}` : "not arrived")}</> : <span style={{ color: "#94A3B8" }}>no inbound shipment{lot.poRef ? " — register the supplier's truck on the PO" : ""}</span>)}
        {/* v6.99.17 (A-R13-7): RECEIPT tile removed — the quantity breakdown already shows expected / received / variance */}
        {tile("QUALITY", lastIns ? <>{lastIns.stage} {lastIns.date}<br />defects <b>{inspectionTotals(lastIns).totalPct}%</b> · <b style={{ color: lastIns.verdict === "Rejected" ? "#DC2626" : lastIns.verdict === "Sort" ? "#B45309" : "#16A34A" }}>{lastIns.verdict}</b><br />{ins.length} inspection(s){lotClaims.length ? ` · ${lotClaims.length} claim(s)` : ""}</> : <span style={{ color: dueQC ? "#B45309" : "#94A3B8" }}>no inspection{dueQC ? ` — QC report due ${dueQC}` : ""}{lotClaims.length ? ` · ${lotClaims.length} claim(s)` : ""}</span>, lastIns ? "#111" : "#94A3B8")}
        {!lotIsDirect(lot) && tile("STOCK — AVAILABLE NOW", (() => { const a = lotAvailabilityByGrade(lot, orders); return <><div>class I <b>{a.I.toLocaleString("pl-PL")}</b> kg</div><div>class II <b>{a.II.toLocaleString("pl-PL")}</b> kg</div>{a.unsorted > 0 ? <div>unsorted {a.unsorted.toLocaleString("pl-PL")} kg</div> : null}<div style={{ color: "#94A3B8" }}>waste {g.waste.toLocaleString("pl-PL")} kg</div></>; })())}
        {tile("SALES", <>{sales.length ? sales.map((o: any) => { const kg = (o.items || []).filter((it: any) => (it.sourceType === "STOCK" && String(it.sourceRef) === String(lot.number)) || (it.sourceType === "PO" && lot.poRef && String(it.sourceRef) === String(lot.poRef))).reduce((a: number, it: any) => a + num(it.qty), 0); return <div key={o.number}>{o.number} · <b>{Math.round(kg).toLocaleString("pl-PL")} kg</b>{o.items?.some((it: any) => it.grade === "II") ? " · II" : ""} · {o.status}</div>; }) : <span style={{ color: "#94A3B8" }}>no sales yet</span>}<span style={{ color: num(lot.receivedKg) > 0 && soldKg + g.waste >= num(lot.receivedKg) - 1 ? "#16A34A" : "#B45309" }}>{num(lot.receivedKg) > 0 && soldKg + g.waste >= num(lot.receivedKg) - 1 ? "fully sold" : `${Math.max(0, Math.round(num(lot.receivedKg) - soldKg - g.waste)).toLocaleString("pl-PL")} kg to sell`}</span></>)}
        {tile("SETTLEMENT (on the PO)", settlement ? <>{settlement.number ? settlement.number + " · " : ""}<b style={{ color: settlement.status === "Closed" ? "#16A34A" : "#B45309" }}>{settlement.status}</b>{settlement.closedAt ? ` · closed ${settlement.closedAt}` : ""}<br />{settlement.commissionInvoiceId ? "commission invoice issued" : settlement.status === "Closed" ? "commission not yet invoiced — waiting for the Monday commission run" : "closes on the PO when the truck is sold"}</> : <span style={{ color: "#94A3B8" }}>{lot.poRef ? `not opened yet — on ${lot.poRef}` : "—"}</span>)}
      </div>
      <div style={{ marginTop: 8, fontSize: 10.5, color: "#94A3B8" }}>Actions live below in their owning sections: Receive · Inspect · Sort · Count · Move · Return · Claim; the settlement, its reports and the commission run are on the PO. This strip stores nothing — it reads what each module owns.</div>
      </div>
    </div>
  );
}




// ─── MAIN — LIST VIEW + ROUTER ──────────────────────────────────────────────

// ── Batch 6a (BP-55b): Producer Claim modal — mirrors the Claim Request Form ──
// v6.79.0 (W-2): the legacy lot-side Claim Request Form was retired — claims are
// one document type with one numbering scheme in the Claims module (D-13).

export default function Inventory({ archive = null, initialSelectedNumber = "", lots: extLots, setLots: extSetLots, allOrders: extOrders, contacts: extContacts = [], shipments: extShipments = [], setShipments: extSetShipments = null, pos: extPOs = [], invoices: extInvoices = [], setInvoices: extSetInvoices = null, financeNotes: extFinanceNotes = [], setFinanceNotes: extSetFinanceNotes = null, claims: extClaims = [], onStartClaim = null , inspections: extInspections = [], setInspections: extSetInspections = null, defectCatalogue: extDefectCatalogue = [], stockCounts: extStockCounts = [], setStockCounts: extSetStockCounts = null , poSettlements: extSettlements = [] }: any = {}) {
  const cancelledRefs = cancelledDocSet(extPOs, extOrders, extShipments); // v6.35.1: strike cancelled source refs
  const { confirm: uiConfirm, alert: uiAlert, prompt: uiPrompt, dialogNode } = useConfirm(); // Batch 2 (P2-6) + v6.89.0 prompt
  // Integration mode: parent passes lots state and live SOs. Standalone: local seed + module-scope SOS.
  const [localLots, setLocalLots] = useState<any[]>([]); // v6.32.0 (R7b-5): demo seed removed from bundle
  const lots = extLots ?? localLots;
  const setLots = extSetLots ?? setLocalLots;
  // Live SOs from shell (replaces the standalone-only module-scope SOS).
  // If shell doesn't pass any (standalone), helpers fall through to local SOS via their default param.
  const liveSOs = extOrders;
  const shipments = extShipments;
  // v6.99.32: a lot can be opened directly (deep link, and the render smoke exercises the DETAIL, not just the list)
  const [view, setView] = useState(initialSelectedNumber ? "detail" : "list");
  const [selectedId, setSelectedId] = useState<any>(() => (extLots || []).find((l: any) => String(l.number) === String(initialSelectedNumber))?.id ?? null);
  const selected = useMemo(() => lots.find(l => l.id === selectedId) ?? null, [lots, selectedId]);
  const [showMovement, setShowMovement] = useState(false);
  const [movementMode, setMovementMode] = useState<"movement" | "quality">("movement");
  const [sortingLot, setSortingLot] = useState(null); // v6.5: lot for the sorting-event modal
  const [settlementLot, setSettlementLot] = useState(null); // v6.6: lot for the consignment settlement modal
  const [editingMovement, setEditingMovement] = useState(null);
  const [showReturn, setShowReturn] = useState(false); // v6.18.12 (#4): return-to-warehouse modal
  const [showInspection, setShowInspection] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("default"); // v6.36.1: default | oldest | newest (by arrival)
  const [filterStatus, setFilterStatus] = useState("all"); // all | inPossession | <specific>
  const [filterLocationType, setFilterLocationType] = useState("All");
  const [filterProduct, setFilterProduct] = useState("All");
  const [filterQuality, setFilterQuality] = useState("All");

  // ── KPIs ─────────────────────────────────────────────────────────────
  // "In stock" = physically in our warehouse (Reserved is no longer a status — it's an overlay)
  const inStock = lots.filter(l => l.status === "In Stock");
  const totalKgInStock = inStock.reduce((s, l) => s + (l.physicalKg || 0), 0);
  const totalValueInStock = inStock.reduce((s, l) => s + valueInStock(l), 0);
  const lotsAtPort = lots.filter(l => locById(l.locationId)?.type === "PORT" && l.status !== "Shipped Out").length;
  const lotsWithVariance = lots.filter(l => l.expectedKg > 0 && l.receivedKg > 0 && Math.abs(l.receivedKg - l.expectedKg) / l.expectedKg > 0.01).length;
  const totalDamagedKg = lots.reduce((s, l) => s + (l.damagedKg || 0), 0);

  // ── filtered ────────────────────────────────────────────────────────
  // v6.99.54 (AR-4, owner): the day-to-day lists show the CURRENT season; archived documents appear only with "include archived".
  const archiveShow = (doc: any) => !archive || archive.includeArchived || !isArchived("lot", doc, archive.archivedSeasons || [], archive.settings || DEFAULT_SEASON, { pos: archive.pos || [] });
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // "In our possession" = anything that hasn't physically left us yet
    const inPossessionStatuses = new Set(["Expected", "In Transit", "Customs", "In Stock"]);
    const base = lots.filter(l => {
      if (!archiveShow(l)) return false;   // v6.99.54 (AR-4)
      const loc = locById(l.locationId);
      if (filterStatus === "inPossession" && !inPossessionStatuses.has(l.status)) return false;
      if (filterStatus !== "all" && filterStatus !== "inPossession" && l.status !== filterStatus) return false;
      if (filterLocationType !== "All" && loc?.type !== filterLocationType) return false;
      if (filterProduct !== "All" && l.product !== filterProduct) return false;
      if (filterQuality !== "All" && l.quality !== filterQuality) return false;
      if (q) {
        const soList = soRefsFor(l, liveSOs, shipments).map(s => s.number).join(" ");
        const hay = `${l.number} ${l.product} ${l.variety || ""} ${l.poRef || ""} ${soList} ${loc?.name || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (sortBy === "default") return [...base].sort((a: any, b: any) => String(b.number || "").localeCompare(String(a.number || ""), undefined, { numeric: true })); // v6.80.0 (D-45): registers newest first
    const key = (l: any) => lotArrivalDate(l) || "9999-12-31"; // no arrival sorts last on oldest-first
    return [...base].sort((a, b) => sortBy === "oldest" ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lots, liveSOs, search, filterStatus, filterLocationType, filterProduct, filterQuality, sortBy]);

  // v6.18.21 (audit P1): the product filter is derived from the lots actually in
  // inventory (catalog-picked on the PO) instead of a hardcoded list that drifted.
  // Explicit string[] so the JSX key type is satisfied under the strict CRA build.
  const productOptions = useMemo<string[]>(() => {
    const set = new Set<string>();
    (lots || []).forEach((l: any) => { if (l && l.product) set.add(String(l.product)); });
    return Array.from(set).sort();
  }, [lots]);

  // ── mutations ───────────────────────────────────────────────────────
  function recordMovement({ id, type, qtyKg, fromId, toId, note, date, soRef, detectedAt, claimValue, claimCurrency, partyName }: any) {
    recordAudit({ module: "Inventory", docType: "Lot", docNumber: selected?.number || "?", action: type === "CLAIM" ? "claim" : "movement", summary: `${type}${qtyKg ? " " + Number(qtyKg).toLocaleString("pl-PL") + " kg" : ""}${note ? " - " + note : ""}` });
    setLots(prev => prev.map(l => {
      if (l.id !== selected.id) return l;
      // Capture a stable base location for replay (origin before any movement).
      const baseLocationId = l.baseLocationId ?? (l.movements?.[0]?.fromId ?? l.locationId);
      const extra: any = {};
      if (detectedAt) extra.detectedAt = detectedAt;
      if (type === "CLAIM") { extra.claimValue = parseNum(claimValue); extra.claimCurrency = claimCurrency || "PLN"; }
      let movements;
      if (id != null) {
        // EDIT: replace the existing movement by id.
        movements = (l.movements || []).map(m => m.id === id ? { ...m, type, qtyKg, fromId, toId, note, date, soRef: soRef ?? m.soRef ?? null, ...extra } : m);
      } else {
        // ADD: append a new movement.
        movements = [...(l.movements || []), { id: nextId(), date: date || today, type, qtyKg, fromId, toId, note, soRef: soRef ?? null, ...extra }];
      }
      // Recompute all derived quantities/status/location from the full movement list.
      return recomputeLotFromMovements({ ...l, baseLocationId }, movements);
    }));
    // v6.18.10 (#5): a client-side quality claim creates a DRAFT credit note to the
    // client (linked to the sales invoice if one exists), leaving warehouse stock alone.
    if (type === "CLAIM" && parseNum(claimValue) > 0 && extSetFinanceNotes && id == null) {
      const inv = (extInvoices || []).find((i: any) => i.kind === "SALES" && (i.links || []).some((lk: any) => String(lk.number) === String(soRef)));
      const so = (extOrders || []).find((o: any) => o.number === soRef);
      const party = partyName || inv?.counterparty?.name || so?.client?.name || "Client";
      const cur = claimCurrency || inv?.currency || so?.currency || "PLN";
      const fx = defaultFxRate(cur);
      const amt = parseNum(claimValue);
      extSetFinanceNotes((prev: any[]) => [...(prev || []), {
        id: nextId(), noteType: "CREDIT", direction: "outgoing",
        invoiceId: inv?.id ?? null, relatedRef: soRef || selected.number, partyName: party,
        category: "Quality", amount: amt, currency: cur, fxRate: fx, amountPLN: Math.round(amt * fx * 100) / 100,
        status: "Draft", reason: `Quality claim — ${qtyKg} kg defective on ${selected.number}${soRef ? ` (${soRef})` : ""}`,
        date: date || today, source: `claim:lot:${selected.id}:${Date.now()}`,
      }]);
    }
    setShowMovement(false);
    setEditingMovement(null);
  }

  // v6.18.12 (#4): a return is a standalone event — restore stock to the warehouse
  // (REVERSAL) and book the return transport as its own shipment with the cost. It does
  // NOT reopen the original SO; value is settled via the quality-issue / credit-note path.
  function returnToWarehouse(d: any) {
    const fx = parseNum(d.fxRate) || 1;
    const costN = parseNum(d.cost);
    setLots(prev => prev.map(l => {
      if (l.id !== selected.id) return l;
      const baseLocationId = l.baseLocationId ?? (l.movements?.[0]?.fromId ?? l.locationId);
      const movements = [...(l.movements || []), { id: nextId(), date: d.date || today, type: "REVERSAL", qtyKg: d.kg, fromId: d.fromId || null, toId: d.toId, note: d.reason || "Return to warehouse" }];
      return recomputeLotFromMovements({ ...l, baseLocationId }, movements);
    }));
    if (typeof extSetShipments === "function") {
      extSetShipments((prev: any[]) => {
        const year = new Date(d.date || Date.now()).getFullYear();
        const retCount = (prev || []).filter((s: any) => s.purpose === "RETURN").length;
        const number = `RET-${year}-${String(retCount + 1).padStart(4, "0")}`;
        const costPLN = Math.round(costN * fx * 100) / 100;
        const sh = {
          id: nextId(), number, purpose: "RETURN", status: "Delivered", billingStatus: "Not ready",
          loadingDate: d.date, expectedDeliveryDate: d.date,
          legs: [{ id: 1, mode: "Road", status: "Delivered", fromLocationId: d.fromId || null, toLocationId: d.toId, carrierId: null, plannedPickupDate: d.date, plannedDeliveryDate: d.date, costAmount: costN, costCurrency: d.currency, costFxRate: fx, costPLN, notes: "Return from client" }],
          costs: costN > 0 ? [{ id: 1, type: "return_freight", supplierId: null, amount: costN, currency: d.currency, fxRate: fx, amountPLN: costPLN, invoiceStatus: "Expected", invoiceRef: "", allocationMethod: "by_kg", notes: d.reason || "Return transport" }] : [],
          documents: [], lotRefs: [selected.number], terms: "", customs: { applies: false },
          notes: `Return to warehouse: ${d.kg} kg of ${selected.number}.${d.reason ? " " + d.reason : ""}`,
        };
        return [sh, ...(prev || [])];
      });
    }
    setShowReturn(false);
  }

  async function deleteMovement(movId) {
    if (!(await uiConfirm({ tone: "danger", title: "Delete movement", message: "Stock will be recalculated.", confirmLabel: "Delete" }))) return;
    setLots(prev => prev.map(l => {
      if (l.id !== selected.id) return l;
      const baseLocationId = l.baseLocationId ?? (l.movements?.[0]?.fromId ?? l.locationId);
      const movements = (l.movements || []).filter(m => m.id !== movId);
      return recomputeLotFromMovements({ ...l, baseLocationId }, movements);
    }));
  }
  // v6.18.17 (C): void a wrongly-entered MANUAL movement/reclass/claim. The entry is
  // kept in the lot's history (shown red, read-only) for the record, but excluded from
  // the stock recompute. System events (IN / SHIP_OUT / REVERSAL) can't be voided here —
  // they're driven by the PO / shipment / return and would desync the lot.
  async function voidMovement(movId) {
    if (!(await uiConfirm({ tone: "danger", title: "Void this entry?", message: "It stays in the history (marked voided, in red) but no longer affects stock. This can't be undone.", confirmLabel: "Void" }))) return;
    setLots(prev => prev.map(l => {
      if (l.id !== selected.id) return l;
      const baseLocationId = l.baseLocationId ?? (l.movements?.[0]?.fromId ?? l.locationId);
      const movements = (l.movements || []).map(m => m.id === movId ? { ...m, voided: true, voidedAt: localTodayISO() } : m);
      return recomputeLotFromMovements({ ...l, baseLocationId }, movements);
    }));
  }


  function saveInspection(data) {
    setLots(prev => prev.map(l => {
      if (l.id !== selected.id) return l;
      const baseLocationId = l.baseLocationId ?? (l.movements?.[0]?.fromId ?? l.locationId);
      const inspections = [...(l.inspections || []), {
        context: data.context, date: data.date, outcome: data.outcome,
        lossKg: data.lossKg || 0, findings: data.findings || "",
        creditNote: data.creditNote || null,
      }];
      let movements = l.movements || [];
      // A weight-loss / damage / rejection outcome records a DAMAGE write-off movement.
      if (data.lossKg > 0) {
        const label = data.outcome === "weight_loss" ? "Inspection: weight loss" : data.outcome === "rejection" ? "Inspection: client rejection" : "Inspection: damage";
        movements = [...movements, { id: nextId(), date: data.date || today, type: "DAMAGE", qtyKg: data.lossKg, fromId: l.locationId, toId: l.locationId, note: `${label}${data.findings ? " — " + data.findings : ""}` }];
      }
      const recomputed = recomputeLotFromMovements({ ...l, baseLocationId, inspections }, movements);
      return recomputed;
    }));
    setShowInspection(false);
  }

  async function deleteLot() {
    if (!selected) return;
    const lotNo = selected.number;

    // Gather dependents that would be orphaned by removing this lot.
    const dependentSOs = (liveSOs || []).filter((o: any) =>
      o.status !== "Cancelled" &&
      (o.items || []).some((it: any) =>
        (it.sourceType === "STOCK" && String(it.sourceRef) === String(lotNo)) ||
        (it.sourceType === "PO" && selected.poRef && String(it.sourceRef) === String(selected.poRef))
      )
    ).map((o: any) => o.number);

    const dependentShipments = (shipments || []).filter((sh: any) =>
      (sh.lotRefs || []).map(String).includes(String(lotNo)) ||
      (sh.goods || []).some((g: any) => String(g.lotRef) === String(lotNo))
    ).map((sh: any) => sh.number);

    const hasPhysical = (parseFloat(selected.receivedKg) || 0) > 0
      || (parseFloat(selected.physicalKg) || 0) > 0
      || (selected.movements || []).length > 0;

    const blockers: string[] = [];
    if (dependentSOs.length) blockers.push(`• Sales Order(s): ${[...new Set(dependentSOs)].join(", ")}`);
    if (dependentShipments.length) blockers.push(`• Shipment(s): ${[...new Set(dependentShipments)].join(", ")}`);
    if (hasPhysical) blockers.push("• This lot has received goods / recorded movements (real stock history).");

    if (blockers.length) {
      await uiAlert({
        tone: "warn",
        title: `Lot ${lotNo} can't be deleted`,
        message: `It's still referenced:\n\n${blockers.join("\n")}\n\nDeleting it would leave dangling references that distort COGS and reports. Cancel the dependent Sales Order(s)/Shipment(s) first, or void its movements, then an empty, unreferenced lot can be removed.`,
      });
      return;
    }
    if (!(await uiConfirm({ tone: "danger", title: `Delete lot ${lotNo}?`, message: "This permanently removes it from inventory.", confirmLabel: "Delete lot" }))) return;

    setLots(prev => prev.filter(l => l.id !== selected.id));
    setSelectedId(null);
    setView("list");
  }

  // ── routes ──────────────────────────────────────────────────────────
  if (view === "detail" && selected) {
    return (
      <>
        {/* v6.99.28 (owner): the prompts/confirmations of the lot actions were mounted only in the LIST view — pressing "Receive into stock" seemed to do nothing until you went back */}
        {dialogNode}
        {showMovement && <MovementModal lot={selected} liveSOs={liveSOs} editing={editingMovement} initialMode={movementMode} contacts={extContacts} allLots={lots} shipments={shipments} onCancel={() => { setShowMovement(false); setEditingMovement(null); }} onConfirm={recordMovement} />}

        {sortingLot && <SortingModal lot={sortingLot} onCancel={() => setSortingLot(null)} onConfirm={({ kg, date, note }) => {
          setLots(prev => prev.map(l => l.id === sortingLot.id ? { ...l, serviceEvents: [...(l.serviceEvents || []), { id: nextId(), type: "SORTING", kg, date, note }] } : l));
          setSortingLot(null);
        }} />}

        {showReturn && selected && <ReturnModal lot={selected} contacts={extContacts} onCancel={() => setShowReturn(false)} onConfirm={returnToWarehouse} />}
        {settlementLot && <SettlementModal lot={lots.find(l => l.id === settlementLot.id) || settlementLot} orders={liveSOs} contacts={extContacts} pos={extPOs}
          onCancel={() => setSettlementLot(null)}
          onSave={(settlement, close) => {
            // Batch 5c (BP-38/31): a closed settlement is a NUMBERED DOCUMENT.
            if (close && !settlement.number) {
              settlement = { ...settlement, number: nextSettlementNumber(lots, new Date().getFullYear()) };
            }
            // Auto-draft the commission invoice into the Invoices registry (idempotent:
            // skip if an invoice already links to this settlement number).
            if (close && extSetInvoices) {
              const setNo = settlement.number;
              const lotForDraft = lots.find(l => l.id === settlementLot.id) || settlementLot;
              const po = (extPOs || []).find((p: any) => p.number === lotForDraft.poRef) || null;
              extSetInvoices((prev: any[]) => {
                const exists = (prev || []).some((inv: any) => (inv.links || []).some((lk: any) => lk.type === "SET" && lk.number === setNo));
                if (exists) return prev;
                const draft = buildCommissionInvoiceDraft(lotForDraft, settlement, po, { nextId, todayISO: localTodayISO });
                return [draft, ...(prev || [])];
              });
            }
            setLots(prev => prev.map(l => {
              if (l.id !== settlementLot.id) return l;
              let next = { ...l, settlement };
              if (close) {
                const comps = settlementCostComponents(l, settlement.producerInvoiceAmountPLN, settlement.finalCommissionPLN ?? settlement.expectedCommissionPLN, settlement.producerInvoiceNo, settlement.commissionInvoiceNo);
                // Replace-by-ref: drop any prior settlement components for THIS lot
                // (so re-closing a corrected settlement rewrites cleanly and never
                // double-counts), then add the fresh pair.
                const compSources = new Set(comps.map((c: any) => c.source));
                const withoutPrior = (l.costs || []).filter((c: any) => !compSources.has(c.source));
                next = { ...next, costs: [...withoutPrior, ...comps] };
              }
              return next;
            }));
            if (close) setSettlementLot(null);
          }} />}        {showInspection && <InspectionModal lot={selected} onCancel={() => setShowInspection(false)} onConfirm={saveInspection} />}
        <LotDetail
          season={{ lots, orders: liveSOs, shipments, setLots: extSetLots, inspections: extInspections, setInspections: extSetInspections, defectCatalogue: extDefectCatalogue, stockCounts: extStockCounts, setStockCounts: extSetStockCounts, claims: extClaims, settlements: extSettlements, claimsForLock: extClaims, settlementsForLock: extSettlements, recompute: (l: any, mv: any[]) => recomputeLotFromMovements(l, mv) }}
          pos={extPOs}
          allLots={lots}
          lotClaims={claimsForLot(extClaims || [], selected?.number).filter((c: any) => c.direction === "RECOVERY")}
          lot={selected}
          onBack={() => { setView("list"); setSelectedId(null); }}
          onMove={() => { setEditingMovement(null); setMovementMode("movement"); setShowMovement(true); }}
          onQualityIssue={() => window.dispatchEvent(new CustomEvent("marianna:open-inspection"))}   // v6.99.17 (A-R13-10): "Report quality issue" = the Quality inspection (one form); a claim follows from it
          onEditMovement={(m: any) => { setEditingMovement(m); setMovementMode(["DAMAGE", "RECLASS"].includes(m.type) ? "quality" : "movement"); setShowMovement(true); }}
          onDeleteMovement={deleteMovement}
          onVoidMovement={voidMovement}
          onInspect={() => window.dispatchEvent(new CustomEvent("marianna:open-inspection"))}
          onReturn={() => setShowReturn(true)}
          onDirectReceive={async () => {
            // v6.65.0 (D-20, DDP): a PO bought DDP has no shipment of ours — the
            // supplier delivers. The PO says Arrived while the lot stays Expected
            // forever, because only shipment postings created receipts. This posts
            // the receipt directly: one IN movement for the expected kilos at the
            // lot's destination, then the standard recompute. Fully visible and
            // voidable in the movement history like any other receipt.
            // v6.89.0 (G1, owner ruling): the receipt asks the ACTUAL kilos — every truck arrives with a discrepancy.
            const expectedKg = parseFloat(String(selected?.expectedKg)) || 0;
            const typed = await uiPrompt({ title: `Receive ${selected.number} — actual quantity`, message: `Expected ${Math.round(expectedKg).toLocaleString("pl-PL")} kg. Enter the kilos actually received (the variance is recorded on the receipt):`, defaultValue: String(Math.round(expectedKg)), confirmLabel: "Continue" });
            if (typed === null) return;
            const kg = parseFloat(String(typed).replace(",", ".")) || 0;
            if (!(kg > 0)) { await uiAlert({ tone: "warn", title: "No quantity", message: "Enter the kilos actually received — set the PO line quantity first." }); return; }
            const directCaveat = selected.status === "Direct Expected"
              ? "\n\n⚠ This lot is marked DIRECT FLOW (supplier → client, never our warehouse). Receiving it here converts it to a normal warehouse lot — do this only if the goods really arrived at OUR location (e.g. a DDP purchase)." : "";
            const ok = await uiConfirm({ tone: "warn", title: `Receive ${kg.toLocaleString("pl-PL")} kg into stock?`,
              message: `Direct receipt (no shipment) for ${selected.number} — use this for DDP / delivered-by-supplier arrivals. The stock becomes available at the lot's location and the movement appears in the history (voidable).${directCaveat}`, confirmLabel: "Receive into stock" });
            if (!ok) return;
            setLots((prev: any[]) => prev.map((l: any) => {
              if (l.id !== selected.id) return l;
              const mv = { ...receiptMovement(l, { kg, date: today, note: "Direct receipt (DDP)" }, { nextId }).movement, toId: l.locationId ?? null, soRef: null, shipmentRef: null, poNote: `${l.poRef || "no PO"}`  };
              const next = recomputeLotFromMovements({ ...l, directFlow: false, status: l.status === "Direct Expected" ? "Expected" : l.status }, [...(l.movements || []), mv]);
              setSelectedId(next.id);
              return next;
            }));
          }}
          onDelete={deleteLot}
          liveSOs={liveSOs}
          shipments={extShipments}
          contacts={extContacts}
          onRecordSorting={(l) => setSortingLot(l)}
          onOpenSettlement={(l) => setSettlementLot(l)}
          onOpenClaim={(l) => {
            // v6.63.0 (D-13): one claims UI — pre-filled with the lot, its PO,
            // the producer and the purchase invoice.
            if (typeof onStartClaim === "function") {
              const po = (extPOs || []).find((p: any) => p.number === l.poRef) || null;
              const producer = po ? (extContacts || []).find((c: any) => String(c.name || "").trim().toLowerCase() === String(po.supplier?.name || "").trim().toLowerCase()) : null;
              const pinv = (extInvoices || []).find((i: any) => i.kind === "COST" && i.category === "PURCHASE" && i.paymentStatus !== "Cancelled" && (i.links || []).some((lk: any) => lk.type === "PO" && String(lk.number) === String(l.poRef)));
              onStartClaim({
                respondentKind: "Supplier", direction: "RECOVERY", currency: po?.currency || "PLN", fxToPLN: po?.fxRate || 1, // v6.81.0 (D-62)
                respondentName: po?.supplier?.name || "", contactId: producer ? producer.id : null,
                subjects: [
                  { kind: "LOT", ref: l.number },
                  ...(l.poRef ? [{ kind: "PO", ref: l.poRef }] : []),
                  ...(pinv ? [{ kind: "INVOICE", ref: pinv.number }] : []),
                ],
                notes: `Producer claim on ${l.number}`,
              });
              return;
            }
            /* v6.79.0 (W-2): no legacy fallback — claims live in the Claims module */ }}
          tracePOs={extPOs}
          traceInvoices={extInvoices}
        />
      </>
    );
  }

  // ── list view ───────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#FAFAFA" }}>
      {dialogNode}
      {/* Top bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", flexShrink: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>Inventory Lots</div>
        <div style={{ marginLeft: "auto", fontSize: 12, color: "#AAA" }}>Phase 1 — lot tracking · cost view · movements</div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        {/* KPIs — compact */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 12 }}>
          <Card style={{ padding: "9px 12px" }}>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>IN STOCK <span style={{ color: "#CBD5E1", fontWeight: 400 }}>· {inStock.length} lots</span></div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111", marginTop: 2 }}>{fmtNum(Math.round(totalKgInStock))} <span style={{ fontSize: 12, color: "#888", fontWeight: 600 }}>kg</span></div>
          </Card>
          <Card style={{ padding: "9px 12px" }}>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>STOCK VALUE</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#16A34A", marginTop: 2 }}>{fmtMoney(totalValueInStock)}</div>
          </Card>
          <Card style={{ padding: "9px 12px" }}>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>AT PORT / CUSTOMS</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: lotsAtPort > 0 ? "#D97706" : "#111", marginTop: 2 }}>{lotsAtPort}</div>
          </Card>
          <Card style={{ padding: "9px 12px" }}>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>WITH VARIANCE</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: lotsWithVariance > 0 ? "#D97706" : "#111", marginTop: 2 }}>{lotsWithVariance}</div>
          </Card>
          <Card style={{ padding: "9px 12px" }}>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>DAMAGED</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: totalDamagedKg > 0 ? "#DC2626" : "#111", marginTop: 2 }}>{fmtNum(totalDamagedKg)} <span style={{ fontSize: 12, color: "#888", fontWeight: 600 }}>kg</span></div>
          </Card>
        </div>

        {/* Filters — compact single row of dropdowns */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search lot, product, PO/SO, location…" style={{ flex: "1 1 220px", minWidth: 190, border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none", background: "#fff" }} />
          <SmallButton onClick={() => exportRowsToXlsx(`stock_on_hand_${xlsStamp()}`, filtered, [{ key: "number", label: "Lot" }, { key: "product", label: "Product" }, { key: "variety", label: "Variety" }, { key: "size", label: "Calibre" }, { key: "quality", label: "Class" }, { key: "status", label: "Status" }, { key: "locationId", label: "Location", fmt: (v: any) => (locById(v) || {}).name || "" }, { key: "expectedKg", label: "Expected kg" }, { key: "receivedKg", label: "Received kg" }, { key: "physicalKg", label: "Physical kg" }, { key: "reservedKg", label: "Reserved kg" }, { key: "grades", label: "Grades I/II/waste", fmt: (v: any) => v ? `${v.I || 0} / ${v.II || 0} / ${v.waste || 0}` : "" }, { key: "poRef", label: "PO" }, { key: "arrivalDate", label: "Arrived" }, { key: "costs", label: "Landed cost PLN", fmt: (v: any) => (v || []).reduce((s: number, c: any) => s + (Number(c.pln) || 0), 0) }], "Stock")} title="v6.99.0: exports the rows as filtered, columns as shown">Export file (Excel)</SmallButton>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} title="Sort by stock age (arrival date of the first receipt)" style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, background: "#fff" }}>
            <option value="default">Sort: default</option>
            <option value="oldest">Oldest stock first</option>
            <option value="newest">Newest stock first</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} title="Filter by status" style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, background: "#fff", fontFamily: "inherit", maxWidth: 200 }}>
            <option value="inPossession">In our possession</option>
            <option value="all">All statuses</option>
            {Object.keys(LOT_STATUSES).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterLocationType} onChange={e => setFilterLocationType(e.target.value)} title="Filter by location" style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, background: "#fff", fontFamily: "inherit", maxWidth: 200 }}>
            {["All", ...Object.keys(LOCATION_TYPES)].map(t => <option key={t} value={t}>{t === "All" ? "All locations" : `${locType(t).icon} ${locType(t).label}`}</option>)}
          </select>
          <select value={filterProduct} onChange={e => setFilterProduct(e.target.value)} title="Filter by product" style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, background: "#fff", fontFamily: "inherit", maxWidth: 180 }}>
            {["All", ...productOptions].map(p => <option key={p} value={p}>{p === "All" ? "All products" : p}</option>)}
          </select>
          <select value={filterQuality} onChange={e => setFilterQuality(e.target.value)} title="Filter by quality" style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, background: "#fff", fontFamily: "inherit", maxWidth: 140 }}>
            {["All", ...QUALITY_GRADES].map(q => <option key={q} value={q}>{q === "All" ? "All grades" : `Kl. ${q}`}</option>)}
          </select>
        </div>

        {/* Table */}
        <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 60px 110px 1fr 150px 140px 130px 120px", padding: "10px 18px", background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
            {/* v6.58.0: "LINKED" renamed LINKED DOCUMENTS; the quantity column now
                 states which figure is which rather than a bare pair. */}
            {["LOT", "PRODUCT", "KL.", "STATUS", "LOCATION & FLOW", "ARRIVED · AGE", "QUANTITY", "VALUE PLN", "LINKED DOCUMENTS"].map((h, i) => (
              <div key={i} style={{ fontSize: 10, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em" }}>{h}</div>
            ))}
          </div>
          {filtered.length === 0 && <div style={{ padding: "40px 20px", textAlign: "center", color: "#AAA", fontSize: 13 }}>No lots match the current filters.</div>}
          {filtered.map((l, idx) => {
            const cpk = costPerKg(l);
            const res = lotReservations(l, liveSOs, { lots, shipments });
            const soList = soRefsFor(l, liveSOs, shipments);
            return (
              <div key={l.id} style={{ display: "grid", gridTemplateColumns: "150px 1fr 60px 110px 1fr 150px 140px 130px 120px", padding: "12px 18px", borderBottom: idx < filtered.length - 1 ? "1px solid #F3F4F6" : "none", alignItems: "center", background: "#fff", cursor: "pointer" }}
                onClick={() => { setSelectedId(l.id); setView("detail"); }}
                onMouseEnter={e => e.currentTarget.style.background = "#FAFAFA"}
                onMouseLeave={e => e.currentTarget.style.background = "#fff"}
              >
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#2563EB", fontFamily: "ui-monospace, Menlo, monospace" }}>{l.number}</div>
                  <div style={{ marginTop: 3 }}><VarianceBadge expected={l.expectedKg} actual={l.receivedKg} lot={l} /></div>
                </div>
                {/* v6.99.81 (A-IN-2, owner): item — variety · size, packaging, origin (readable) · producer; the arrival moved to its own column */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{l.product}{l.variety ? " — " + l.variety : ""}</div>
                  <div style={{ fontSize: 12, color: "#334155", marginTop: 1 }}>{[l.size, l.packaging, l.origin].filter(Boolean).join(" · ") || "—"}</div>
                  {(() => { const po = (extPOs || []).find((x: any) => String(x.number) === String(l.poRef));
                    const sup = po?.supplier?.name || l.supplierName || "";
                    return sup ? <div style={{ fontSize: 11, color: "#64748B", marginTop: 1 }}>{sup}</div> : null; })()}
                </div>
                <div><QualityBadge quality={l.quality} /></div>
                <div><StatusBadge status={l.status} /></div>
                <div>
                  <LocationPill locationId={l.locationId} lot={l} />
                  <div style={{ marginTop: 3 }}><LotDirectionBadge lot={l} shipments={shipments} orders={liveSOs} pos={extPOs} compact /></div>
                </div>
                {/* v6.99.81 (A-IN-3, owner): stock lots count their days with us; a direct lot shows its dates and no count */}
                <div>{(() => { const a = lotArrivedCell(l, localTodayISO()); const D = (d: any) => d ? formatDMY(d) : "—";
                  if (a.kind === "stock") return <><div style={{ fontSize: 12, color: "#334155" }}>arrived {D(a.date)}</div>{a.days !== undefined && <div style={{ fontSize: 11, fontWeight: 700, color: ageColor(a.days) }}>{a.days} d on stock</div>}</>;
                  if (a.kind === "direct") return <><div style={{ fontSize: 11.5, fontWeight: 700, color: "#7C3AED" }}>Direct</div><div style={{ fontSize: 11, color: "#64748B" }}>{a.loaded ? `loaded ${D(a.loaded)}` : ""}{a.delivered ? ` · delivered ${D(a.delivered)}` : ""}</div></>;
                  if (a.kind === "expected") return <div style={{ fontSize: 11.5, color: "#B45309", fontWeight: 600 }}>expected {D(a.date)}</div>;
                  return <span style={{ color: "#CCC" }}>—</span>; })()}</div>
                <div>
                  {(() => {
                    const onHand = parseNum(l.physicalKg, 0) || parseNum(l.receivedKg, 0) || parseNum(l.expectedKg, 0);
                    const isExpected = !parseNum(l.physicalKg, 0) && !parseNum(l.receivedKg, 0) && parseNum(l.expectedKg, 0) > 0;
                    return <>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{fmtNum(onHand)} kg{isExpected ? <span style={{ fontSize: 10, color: "#B45309", fontWeight: 600 }}> expected</span> : null}</div>
                      {/* v6.99.81 (A-IN-6, owner): free in green, reserved in orange */}
                      <div style={{ fontSize: 10.5 }}><span style={{ color: "#16A34A", fontWeight: 700 }}>{fmtNum(res.liveAvailable)} free</span><span style={{ color: "#94A3B8" }}> · </span><span style={{ color: "#D97706", fontWeight: 700 }}>{fmtNum(res.totalReserved)} reserved</span></div>
                    </>;
                  })()}
                  {l.damagedKg > 0 && <div style={{ fontSize: 10.5, color: "#DC2626", fontWeight: 600 }}>{fmtNum(l.damagedKg)} damaged</div>}
                </div>
                {/* v6.99.81 (A-IN-7, owner): the value in the lot's own state — in stock · delivered · expected — never "0" for goods that went direct */}
                <div>{(() => { const v = lotValue(l, cpk); const ch = cpk > 0 ? { consignment: false, provisionalPerKgPLN: null } : consignmentHint(l, extPOs || [], extSettlements || [], lots || []);
                  // v6.99.85 (A-CS-4): a consignment lot has no cost until its settlement — say so, and show the producer's provisional value per kg when known
                  if (ch.consignment) return <>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#6D28D9" }}>{ch.provisionalPerKgPLN != null ? "≈ " + fmtMoney(ch.provisionalPerKgPLN * v.kg).replace(" PLN", "") : "consignment"}</div>
                    <div style={{ fontSize: 10, color: "#64748B" }}>{ch.provisionalPerKgPLN != null ? <>provisional · ≈ {fmtMoney(ch.provisionalPerKgPLN)}/kg</> : "priced at settlement"}</div>
                  </>;
                  return <>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{fmtMoney(v.pln).replace(" PLN", "")}</div>
                  <div style={{ fontSize: 10, color: "#64748B" }}>{v.label !== "—" ? <span style={{ fontWeight: 700, color: v.label === "in stock" ? "#16A34A" : v.label === "expected" ? "#B45309" : "#0F766E" }}>{v.label}</span> : null}{v.label !== "—" ? " · " : ""}{fmtMoney(cpk)}/kg</div>
                </>; })()}</div>
                <div>
                  {l.poRef && <div style={{ fontSize: 11, color: "#1D4ED8", fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 600 }}><DocRef num={l.poRef} cancelledSet={cancelledRefs} /></div>}
                  {soList.slice(0, 2).map(s => (
                    <div key={s.number} style={{ fontSize: 11, color: "#15803D", fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 600 }}>{s.number}</div>
                  ))}
                  {soList.length > 2 && <div style={{ fontSize: 10, color: "#AAA" }}>+{soList.length - 2} more</div>}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 16, fontSize: 11, color: "#AAA", textAlign: "center" }}>
          {filtered.length} of {lots.length} lots · Click any row to open · Live availability computed from SO state · Phase 2 adds damage reports, storage allocation, cost recalc into SO margins
        </div>
      </div>
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────────
