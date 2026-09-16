import React, { useState, useMemo } from "react";
import { issueReportNumber, lastReportNumber } from "./reportNumbers";
import { PrintLogo } from "./brand";
import LocationPicker from "./LocationPicker";
import { exportRowsToXlsx, stamp as xlsStamp } from "./exportXlsx";
import { lotAvailabilityByGrade } from "./so.domain";
import { receiptMovement, sortingJob as runSortingJob, gradeSplit, blankInspection, inspectionTotals, defectsFor, PEPPER_DEFECTS, DEFECT_CATEGORIES, applyStockCount, plateMismatch, gradeCommitmentWarning, inspectionVerdict, tolerancesFromLast, countLinesForLot, countedKgOf, samplePctOf, sortablePools } from "./seasonOps.domain";
import { PAGE_MAX, SmallButton } from "./ui";
import DateInput from "./DateInput";
import { nextSettlementNumber, buildCommissionInvoiceDraft } from "./settlement.domain";
import { claimsForLot } from "./claims.domain";
import { buildTraceTree } from "./trace.domain";
import { fmtNum } from "./format";
import { Card, Lbl, useConfirm, DocRef, cancelledDocSet} from "./ui";
import { recomputeLotFromMovements as domainRecomputeLot } from "./inventory.domain";
import { lotReservationsForStock, productsMatch as domainProductsMatch, soClientName } from "./salesOrders.domain";
import { nextId } from "./ids";
import { defaultFxRate } from "./fx";
import { unifiedLocations, locationById } from "./locations";
import { customsSummary } from "./customs.domain";
import { localTodayISO, formatDMY } from "./dates";
import { computeLotWarehouseCharges } from "./warehouseCharges";
import { shipmentTradeDirection, MOVEMENT_LABELS, ownershipAtPoint } from "./tradeFlow.domain";
import { computeLotSettlement, currentCommissionPct, currentCommissionRate, commissionPctForSales, settlementCostComponents } from "./consignment";
import { recordAudit } from "./audit";

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
function locType(t: string) {
  return LOCATION_TYPES[t] || DEFAULT_LOCATION_TYPE;
}

// LOCATIONS now comes from the shared ./locations source of truth. We map the
// rich `type` back onto the legacy single-word `type` field that this module's
// existing UI code expects (LOCATION_TYPES[loc.type]).
// v6.86.0: module-level LOCATIONS alias removed — pickers read unifiedLocations()
// v6.18.4 (P0-4): snapshot + live counterparty addresses, deduped, so movement
// pickers see a counterparty added this session without a browser refresh.
function mergedLocations(contacts: any[]) {
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
function standardStageLabel(kind: string) {
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
function journeyForLot(lot: any, shipments: any[] = [], orders: any[] = []) {
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
function customsStagesForLot(lot: any, shipments: any[]): string[] {
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
const MOVEMENT_TYPES: Record<string, any> = {
  IN:        { label: "Stock In",   color: "#16A34A", icon: "↓", desc: "Lot received into a location" },
  TRANSFER:  { label: "Transfer",   color: "#0284C7", icon: "⇄", desc: "Move between locations (truck/port/WH)" },
  SHIP_OUT:  { label: "Ship Out",   color: "#2563EB", icon: "→", desc: "Physical dispatch to client (decrements physicalKg)" },
  REVERSAL:  { label: "SO Reversal", color: "#7C3AED", icon: "↩", desc: "Cancels a previous SO dispatch and restores stock" },
  DAMAGE:    { label: "Damage",     color: "#DC2626", icon: "⚠", desc: "Write-off — damaged or rejected" },
  RECLASS:   { label: "Reclassify", color: "#D97706", icon: "↻", desc: "Quality grade change (e.g. Kl. I → Kl. II)" },
};

// ─── SEED DATA — lots covering all 7 flows ──────────────────────────────────
const today = localTodayISO();

function locById(id) { return locationById(id) as any; } // v6.86.0: one resolver

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

function lotReservations(lot, sourceSOs, ctx) {
  // Engine: salesOrders.domain (Batch 1). G1: no SOS stub fallback — live SOs only.
  // v6.41.0 (A5): ctx {lots, shipments} enables the unshipped-remainder rule.
  return lotReservationsForStock(lot, sourceSOs ?? [], ctx);
}

// Returns array of SO references this lot has ever been linked to
// (across all statuses including Shipped+ historical).
function soRefsFor(lot, sourceSOs, shipmentsList = []) {
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
function Inp({ value, onChange = () => {}, type = "text", placeholder = "", style = {}, max }: any) {
  if (type === "date") return <DateInput value={value} onChange={onChange} disabled={false} placeholder={placeholder} style={style} />; // v6.81.0 (D-52)
  if (type === "number") return <input value={value ?? ""} onChange={(e: any) => onChange && onChange({ target: { value: String(e.target.value).replace(",", ".") } })} inputMode="decimal" placeholder={undefined} disabled={undefined} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", background: "#fff", ...(style || {}) }} title={undefined} />; // v6.99.6 (A-R9-5): Polish comma decimals accepted
  const base = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: "#fff" };
  return <input value={value || ""} onChange={onChange} type={type || "text"} placeholder={placeholder} max={max} style={{ ...base, ...style }} />;
}
function Sel({ value, onChange = () => {}, children, style = {} }: any) {
  const base = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: "#fff" };
  return <select value={value || ""} onChange={onChange} style={{ ...base, ...style }}>{children}</select>;
}
function SectionTitle({ children }: any) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em", marginBottom: 14 }}>{children}</div>;
}
function StatusBadge({ status }: any) {
  const s = LOT_STATUSES[status] || { bg: "#F3F4F6", color: "#6B7280" };
  return <span style={{ background: s.bg, color: s.color, padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{status}</span>;
}
function QualityBadge({ quality }: any) {
  const palette = {
    "I":          { bg: "#DCFCE7", color: "#16A34A" },  // top quality — green
    "IB":         { bg: "#ECFCCB", color: "#65A30D" },  // intermediate — lime
    "II":         { bg: "#FEF3C7", color: "#D97706" },  // secondary — amber
    "Industrial": { bg: "#FEE2E2", color: "#991B1B" },  // processing-grade — red
  };
  const p = palette[quality] || palette["I"];
  return <span style={{ background: p.bg, color: p.color, padding: "1px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", fontFamily: "ui-monospace, Menlo, monospace", whiteSpace: "nowrap" }}>Kl. {quality}</span>;
}
function LocationPill({ locationId, lot = null }: any) {
  const loc = locById(locationId);
  // v6.45.0 (test-round): a DIRECT lot never sits in one of our locations — the
  // goods go producer → client. Say so instead of showing an empty dash.
  if (!loc && lot) {
    const direct = !!lot.directFlow || lot.custodyType === "Direct" || /direct/i.test(String(lot.status || ""));
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
function LotDirectionBadge({ lot, shipments = [], orders = [], pos = [], compact = false }: any) {
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
  if (!shs.length && !(lot.movements || []).length) return null;
  for (const sh of shs) {
    const g = (sh?.goods || []).find((x: any) => String(x.lotRef || "") === String(lot.number) && x.tradeDirection && MOVEMENT_LABELS[x.tradeDirection]);
    if (g) { dir = g.tradeDirection; break; }
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
      <span style={{ fontWeight: 400, color: "#94A3B8", fontSize: 10.5 }}>· from shipment</span>
    </span>
  );
}

function VarianceBadge({ expected, actual }: any) {
  if (!expected || !actual) return null;
  const delta = actual - expected;
  if (delta === 0) return null;
  const pct = ((delta / expected) * 100).toFixed(1);
  const isShort = delta < 0;
  return (
    <span title={`Expected ${expected.toLocaleString()} kg, received ${actual.toLocaleString()} kg`}
      style={{ background: isShort ? "#FEF3C7" : "#DBEAFE", color: isShort ? "#92400E" : "#1E40AF", padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: "0.02em" }}>
      {delta > 0 ? "+" : ""}{pct}%
    </span>
  );
}

function parseNum(v, fallback = 0) {
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}
function fmtMoney(n, cur = "PLN") {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return `${Number(n).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}
// v6.36.1 (P2): stock age — the first real receipt (non-voided IN) is the arrival.
function lotArrivalDate(lot: any): string | null {
  const ins = (lot.movements || []).filter((m: any) => m && !m.voided && m.type === "IN" && m.date).map((m: any) => String(m.date)).sort();
  return ins[0] || null;
}
function lotAgeDays(lot: any): number | null {
  const d = lotArrivalDate(lot);
  if (!d) return null;
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  return days < 0 ? 0 : days;
}
function ageColor(days: number): string { return days <= 7 ? "#16A34A" : days <= 14 ? "#D97706" : "#DC2626"; }

function totalCost(lot) {
  return (lot.costs || []).reduce((s, c) => s + (c.pln || 0), 0);
}
function costPerKg(lot) {
  const total = totalCost(lot);
  // Denominator is the lot's original capacity (receivedKg), not what's left now.
  // We allocate cost across what came in — what's still here is just a portion of that.
  const denom = lot.receivedKg || lot.expectedKg || 0;
  return denom > 0 ? total / denom : 0;
}
function valueInStock(lot) {
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

// ─── MOVEMENT MODAL ─────────────────────────────────────────────────────────
function MovementModal({ lot, liveSOs = [], editing = null, initialMode = "movement", contacts = [], allLots = [], shipments = [], onCancel, onConfirm }: any) {
  const moveLocs = mergedLocations(contacts);
  // Default to TRANSFER for in-stock lots; IN for Expected/Direct Expected lots
  // (v6.3.0 fix — "Direct Expected" previously fell through to TRANSFER whose max
  // was 0 kg, making every quantity error out). In edit mode, prefill.
  // v6.11 (#11) / v6.13 (#14): two modes — "movement" (IN / Transfer / Ship Out)
  // and "quality" (Damage / Reclassify). The mode is fixed by which button opened
  // the modal (Record movement vs the red Record quality issue), so there is no
  // in-modal tab toggle anymore.
  const QUALITY_TYPES = ["DAMAGE", "RECLASS", "CLAIM"];
  // v6.35.4: manual movement is TRANSFER ONLY (relocation between our locations).
  // Receipts (IN) and dispatches (SHIP_OUT) are driven by Shipments — arrival posts the
  // receipt automatically, and an EXW client-collection posts the ship-out via its
  // collection shipment. This removes the manual receipt/dispatch that let a lot's state
  // drift from its shipment (T-20). Quality corrections stay in the separate quality mode.
  const MOVEMENT_MODE_TYPES = ["TRANSFER"]; // v6.99.28 (owner): DAMAGE is owned by the QUALITY INSPECTION (and the sorting job / stock count) — a manual movement moves goods, it never judges them. Legacy damage rows stay visible and voidable in the history. // v6.96.0 (IN-1, owner money rule): by hand only cost-free transfers and damage/corrections — receipts, ship-outs and reversals are shipment postings
  const mode: "movement" | "quality" = editing ? (QUALITY_TYPES.includes(editing.type) ? "quality" : "movement") : (initialMode === "quality" ? "quality" : "movement");
  const [type, setType] = useState(editing?.type || (mode === "quality" ? "DAMAGE" : "TRANSFER"));
  // v6.13 (#15): where the quality problem was detected along the journey.
  const QUALITY_DETECTED_AT = ["At port of discharge", "At the client (export delivery)", "At our warehouse (on arrival)", "At the client's warehouse (direct delivery)", "At supplier / origin", "Other"];
  const [detectedAt, setDetectedAt] = useState(editing?.detectedAt || QUALITY_DETECTED_AT[0]);
  const [qty, setQty] = useState(editing ? String(editing.qtyKg ?? "") : "");
  const [fromId, setFromId] = useState(editing?.fromId ?? lot.locationId);
  const [toId, setToId] = useState(editing?.toId ?? lot.locationId);
  const [note, setNote] = useState(editing?.note || "");
  const [soRef, setSoRef] = useState(editing?.soRef || "");
  const [date, setDate] = useState(editing?.date || today);
  // v6.18.10 (#5): a quality issue detected AT THE CLIENT (after we shipped) is a
  // client claim, not a warehouse write-off — it leaves our stock alone and drives a
  // credit note. "Detected at" decides which path runs.
  const CLIENT_SIDE_DETECTION = ["At the client (export delivery)", "At the client's warehouse (direct delivery)"];
  const clientSide = mode === "quality" && CLIENT_SIDE_DETECTION.includes(detectedAt);
  const lotShipSoRefs = Array.from(new Set((lot.movements || []).filter((m: any) => m.type === "SHIP_OUT" && m.soRef).map((m: any) => m.soRef)));
  const clientSORefs = (lotShipSoRefs.length ? lotShipSoRefs : (liveSOs || []).map((o: any) => o.number)).filter(Boolean);
  const [claimSoRef, setClaimSoRef] = useState(editing?.soRef || lotShipSoRefs[0] || "");
  const [claimValue, setClaimValue] = useState(editing?.claimValue != null ? String(editing.claimValue) : "");
  const [claimCurrency, setClaimCurrency] = useState(editing?.claimCurrency || "PLN");
  const effectiveType = clientSide && type === "DAMAGE" ? "CLAIM" : type;
  const reservationState = lotReservations(lot, liveSOs, { lots: allLots, shipments });
  // Direct-flow lots never physically enter our warehouse (physicalKg stays 0),
  // so quantity-reducing movements validate against the expected/direct quantity —
  // consistent with how lotReservations computes availability for direct lots.
  const isDirect = !!lot.directFlow || lot.status === "Direct Expected";
  const physicalBasis = isDirect
    ? Math.max(parseNum(lot.expectedKg), lot.physicalKg || 0)
    : (lot.physicalKg || 0);
  // In edit mode the max should add back this movement's own effect so it isn't
  // double-counted against itself.
  const selfQty = editing && (editing.type === type) ? parseNum(editing.qtyKg) : 0;
  const maxByType = {
    IN:       Infinity,
    TRANSFER: physicalBasis + selfQty,
    // v6.11 (#8): a Ship Out is the *physical* dispatch — for an EXW sale the lot is
    // already reserved/sold (liveAvailable = 0), which used to block it. Cap by the
    // physical (or expected, for direct flows) quantity instead of the reserved-net.
    SHIP_OUT: physicalBasis + selfQty,
    DAMAGE:   physicalBasis + selfQty,
    RECLASS:  physicalBasis + selfQty,
    CLAIM:    (parseNum(lot.receivedKg) || physicalBasis) + selfQty, // can't claim more than was ever received
  };
  const max = maxByType[effectiveType] ?? Infinity;
  const qtyNum = parseFloat(qty) || 0;
  const isInvalid = qtyNum <= 0 || qtyNum > max || (clientSide && !(parseFloat(claimValue) > 0));
  const typeInfo = MOVEMENT_TYPES[type] || {};
  const showRoute = type === "TRANSFER" || type === "IN" || type === "SHIP_OUT";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, padding: "24px 16px", overflowY: "auto" }}>
      <div style={{ background: "#fff", borderRadius: 14, width: 540, maxWidth: "100%", maxHeight: "calc(100vh - 48px)", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", margin: "auto" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #EBEBEB" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{editing ? (mode === "quality" ? "Edit quality issue" : "Edit movement") : (mode === "quality" ? "Record quality issue" : "Record movement")}</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{lot.number} · {lot.product}{lot.variety ? " — " + lot.variety : ""} · received {(lot.receivedKg || 0).toLocaleString()} kg, physical {(lot.physicalKg || 0).toLocaleString()} kg</div>
        </div>
        <div style={{ padding: 24 }}>
          {mode === "movement" ? (
            <div style={{ padding: "10px 12px", background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 8, fontSize: 11.5, color: "#92400E", lineHeight: 1.5, marginBottom: 16 }}>
              <strong>Manual movement relocates stock between your own locations</strong> (e.g. port → warehouse, warehouse → warehouse). Everything else is automatic: a shipment posts the <strong>receipt</strong> when it arrives and the <strong>ship-out</strong> when it delivers — with transport, cost and paperwork linked to the lot. To receive or dispatch goods, use <strong>Shipments</strong>, not a manual movement. (Quality issues and write-offs are recorded via <em>Record quality issue</em>.)
            </div>
          ) : clientSide ? (
            <div style={{ padding: "10px 12px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, fontSize: 11.5, color: "#1E40AF", lineHeight: 1.5, marginBottom: 16 }}>
              <strong>Client claim (goods already shipped).</strong> Because this defect was found at the client after delivery, it will <strong>not</strong> change your warehouse stock — those kg already left. Recording it logs a client claim against the delivery and creates a <strong>draft credit note</strong> to the client for the value below, which you can finalise in Invoices.
            </div>
          ) : (
            <div style={{ padding: "10px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, fontSize: 11.5, color: "#991B1B", lineHeight: 1.5, marginBottom: 16 }}>
              <strong>Quality issue (goods in our hands).</strong> <strong>Damage</strong> writes off rejected kg (reduces stock on hand), and <strong>Reclassify</strong> changes the quality grade (e.g. Kl. I → Kl. II) with no quantity change. If the defect is reported by the client after you shipped, change "Detected at" to a client location — it becomes a claim that won't touch your stock.
            </div>
          )}

          <div style={{ marginBottom: 4 }}><Lbl>{mode === "quality" ? "Quality issue type" : "Movement type"}</Lbl>
            <Sel value={type} onChange={e => setType(e.target.value)}>
              {Object.entries(MOVEMENT_TYPES).filter(([k]) => k !== "REVERSAL" && (mode === "quality" ? QUALITY_TYPES.includes(k) : MOVEMENT_MODE_TYPES.includes(k))).map(([k, v]: any) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </Sel>
          </div>
          {/* Live plain-language description of the selected type */}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#F8FAFC", border: "1px solid #EEF2F7", borderRadius: 8, padding: "8px 10px", marginBottom: 14 }}>
            <span style={{ color: typeInfo.color, fontWeight: 800, fontSize: 14, lineHeight: 1 }}>{typeInfo.icon}</span>
            <span style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.4 }}>{typeInfo.desc}{type === "IN" ? " — increases stock on hand." : type === "TRANSFER" ? " — same quantity, new location." : type === "SHIP_OUT" ? " — reduces stock on hand. Use for an EXW sale where the client collects with their own truck (no transport on our side)." : type === "DAMAGE" ? " — reduces stock on hand and records a write-off." : type === "RECLASS" ? " — no quantity change." : ""}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <Lbl>Quantity (kg) <span style={{ color: "#AAA", fontWeight: 400 }}>· max {max === Infinity ? "∞" : max.toLocaleString()}</span></Lbl>
              <Inp value={qty} onChange={e => setQty(e.target.value)} type="number" placeholder="0" />
            </div>
            <div>
              <Lbl>Date</Lbl>
              <Inp value={date} onChange={e => setDate(e.target.value)} type="date" max={localTodayISO()} />
            </div>
          </div>

          {clientSide && (
            <div style={{ marginBottom: 12, padding: "12px 14px", background: "#F8FAFF", border: "1px solid #DBEAFE", borderRadius: 8 }}>
              <div style={{ marginBottom: 10 }}>
                <Lbl>Delivery / sales order this claim is against</Lbl>
                <Sel value={claimSoRef} onChange={e => setClaimSoRef(e.target.value)}>
                  <option value="">— select the delivery —</option>
                  {clientSORefs.map((r: any) => <option key={r} value={r}>{r}</option>)}
                </Sel>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 12 }}>
                <div>
                  <Lbl>Agreed credit value</Lbl>
                  <Inp value={claimValue} onChange={e => setClaimValue(e.target.value)} type="number" placeholder="0.00" />
                </div>
                <div>
                  <Lbl>Currency</Lbl>
                  <Sel value={claimCurrency} onChange={e => setClaimCurrency(e.target.value)}>{["PLN", "EUR", "USD"].map(c => <option key={c}>{c}</option>)}</Sel>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#64748B", marginTop: 8, lineHeight: 1.4 }}>The {qty || "0"} kg won't be removed from warehouse stock. A draft credit note for this value goes to the client (linked to the sales invoice if one exists); finalise it in Invoices.</div>
            </div>
          )}

          {showRoute && !clientSide && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 24px 1fr", gap: 8, alignItems: "end", marginBottom: 12 }}>
              <div>
                <Lbl>{type === "IN" ? "Received from" : "From"}</Lbl>
                <Sel value={fromId} onChange={e => setFromId(parseInt(e.target.value))}>
                  {moveLocs.map((l: any) => <option key={l.id} value={l.id}>{locType(l.type).icon} {l.name}</option>)}
                </Sel>
              </div>
              <div style={{ textAlign: "center", paddingBottom: 9, color: "#94A3B8", fontSize: 16 }}>→</div>
              <div>
                <Lbl>{type === "SHIP_OUT" ? "Shipped to" : "To"}</Lbl>
                <LocationPicker value={toId ?? ""} contacts={contacts} onChange={(r: any) => setToId(r.id)} placeholder="— destination —" />
              </div>
            </div>
          )}

          {mode === "quality" && (
            <div style={{ marginBottom: 14 }}>
              <Lbl>Where was it detected?</Lbl>
              <Sel value={detectedAt} onChange={e => setDetectedAt(e.target.value)}>
                {QUALITY_DETECTED_AT.map(d => <option key={d}>{d}</option>)}
              </Sel>
              <div style={{ fontSize: 10.5, color: "#94A3B8", marginTop: 4, lineHeight: 1.4 }}>The problem is recorded against this lot, but it's usually found later in the journey — at the port of discharge, on arrival at our warehouse, or at the client.</div>
            </div>
          )}

          {type === "SHIP_OUT" && (
            <div style={{ marginBottom: 14 }}>
              <Lbl>For Sales Order <span style={{ color: "#BBB", fontWeight: 400 }}>(links this dispatch to the SO for correct P/L)</span></Lbl>
              <select value={soRef} onChange={e => setSoRef(e.target.value)} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", background: "#fff" }}>
                <option value="">— none / not linked —</option>
                {(reservationState.reservations || []).map((r: any) => (
                  <option key={r.soNumber} value={r.soNumber}>{r.soNumber}{r.clientName ? ` · ${r.clientName}` : ""} ({r.qty.toLocaleString("pl-PL")} kg)</option>
                ))}
                {/* Also allow any non-cancelled SO that sources this lot, even if not currently reserving */}
                {(liveSOs || [])
                  .filter((o: any) => !(reservationState.reservations || []).some((r: any) => r.soNumber === o.number))
                  .filter((o: any) => (o.items || []).some((it: any) => (it.sourceType === "STOCK" && it.sourceRef === lot.number) || (it.sourceType === "PO" && it.sourceRef === lot.poRef)))
                  .map((o: any) => <option key={o.number} value={o.number}>{o.number}{o.client?.name ? ` · ${o.client.name}` : ""}</option>)}
              </select>
            </div>
          )}

          <div style={{ marginBottom: 18 }}>
            <Lbl>Note</Lbl>
            <Inp value={note} onChange={e => setNote(e.target.value)} placeholder={mode === "quality" ? "e.g. 2 pallets soft/over-ripe found on arrival at Gdańsk" : "e.g. Reserved for SO-2026-0094 (Biedronka)"} />
          </div>
          {isInvalid && qty && (
            <div style={{ padding: "8px 12px", background: "#FEE2E2", color: "#9A1B1B", fontSize: 12, borderRadius: 6, marginBottom: 12 }}>
              {qtyNum > max ? `Quantity exceeds max (${max.toLocaleString()} kg)` : "Quantity must be greater than zero"}
            </div>
          )}
          {max === 0 && type !== "IN" && (
            <div style={{ padding: "8px 12px", background: "#FEF3C7", border: "1px solid #FDE68A", color: "#92400E", fontSize: 12, borderRadius: 6, marginBottom: 12 }}>
              This lot has <strong>no {type === "SHIP_OUT" ? "available" : "physical"} stock yet</strong>, so a {String(typeInfo.label || type).toLowerCase()} of any quantity is blocked.
              {(lot.physicalKg || 0) === 0 && !isDirect && <> Record a <strong>⊕ Receipt (IN)</strong> first to bring goods into stock, then come back to this movement.</>}
              {type === "SHIP_OUT" && (lot.physicalKg || 0) > 0 && <> All physical stock is currently reserved by confirmed SOs.</>}
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onCancel} style={{ flex: 1, padding: "10px", border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button onClick={() => onConfirm({ id: editing?.id, type: effectiveType, qtyKg: qtyNum, fromId, toId, note, date, soRef: effectiveType === "CLAIM" ? (claimSoRef || null) : (type === "SHIP_OUT" ? (soRef || null) : (editing?.soRef ?? null)), ...(mode === "quality" ? { detectedAt } : {}), ...(effectiveType === "CLAIM" ? { claimValue: parseFloat(claimValue) || 0, claimCurrency } : {}) })} disabled={isInvalid}
              style={{ flex: 1, padding: "10px", border: "none", borderRadius: 8, background: isInvalid ? "#D1D5DB" : "#111", color: "#fff", fontSize: 13, fontWeight: 600, cursor: isInvalid ? "not-allowed" : "pointer" }}>
              {editing ? "Save changes" : (mode === "quality" ? "Record quality issue" : "Record movement")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── INSPECTION MODAL (v6.2) ────────────────────────────────────────────────
const INSPECTION_CONTEXTS = [
  { code: "arrival", label: "Arrival QC (our inspection on receipt)" },
  { code: "warehouse", label: "Warehouse-reported (during storage)" },
  { code: "client", label: "Client feedback (after delivery)" },
  { code: "customs", label: "Customs examination" },
];
const INSPECTION_OUTCOMES = [
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
            <div><Lbl>Date</Lbl><Inp type="date" value={date} onChange={e => setDate(e.target.value)} max={localTodayISO()} /></div>
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
function printHtmlNodeInv(nodeId, title, notify = null) {
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


// ─── v6.6: CONSIGNMENT SETTLEMENT MODAL ─────────────────────────────────────
// Per-lot/truck settlement: gross sales (auto from SOs) − expenses (auto from
// lot costs + manual) = net sales value → producer invoice; commission % × net
// → our invoice; payout = net − commission. Closing writes the two cost
// components onto the lot so SO P/L lands at exactly the commission.
function SettlementModal({ lot, orders = [], contacts = [], pos = [], onCancel, onSave }: any) {
  const { confirm: stConfirm, dialogNode: stDialogNode } = useConfirm(); // P2-6
  const po = (pos || []).find((p: any) => p.number === lot.poRef);
  const producer = po ? (contacts || []).find((c: any) => normName(c.name) === normName(po.supplier?.name)) : null;
  const seasonPct = producer ? currentCommissionPct(producer, localTodayISO()) : null;
  const st = lot.settlement || { status: "None" };
  const [pct, setPct] = useState<any>(st.commissionPct ?? (seasonPct ?? ""));
  const [extra, setExtra] = useState<any[]>(st.extraExpenses || []);
  const [prodInvNo, setProdInvNo] = useState(st.producerInvoiceNo || "");
  const [prodInvPLN, setProdInvPLN] = useState<any>(st.producerInvoiceAmountPLN ?? "");
  const [commInvNo, setCommInvNo] = useState(st.commissionInvoiceNo || "");
  // v6.81.0 (D-57, owner ruling): tiers per TRUCK — the band follows this settlement's own gross.
  const rateRec = producer ? currentCommissionRate(producer, localTodayISO()) : null;
  const grossForBand = computeLotSettlement(lot, orders, 0, extra).grossPLN;
  const bandPct = rateRec && (rateRec.bands || []).length ? commissionPctForSales(rateRec, grossForBand) : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (bandPct != null && st.status !== "Closed" && (pct === "" || pct === seasonPct)) setPct(bandPct); }, [bandPct]);
  const calc = computeLotSettlement(lot, orders, parseFloat(pct) || 0, extra);
  const fmt = (x: number) => x.toLocaleString("pl-PL", { minimumFractionDigits: 2 }) + " PLN";
  const status = st.status || "None";
  // v6.63.0 (owner ruling D2): once Closed — its cost components written and the
  // commission invoice issued — a settlement can NEVER be reopened. Corrections,
  // like invoices, happen only via credit/debit note.
  const closedFinal = status === "Closed";
  const prodInvNum = parseFloat(prodInvPLN);
  const invVariance = isFinite(prodInvNum) && prodInvNum > 0 ? Math.round((prodInvNum - calc.netPLN) * 100) / 100 : null;

  function save(nextStatus: string) {
    if (closedFinal) return; // ruling D2: Closed is immutable — no path may rewrite it
    const settlement = {
      ...st,
      status: nextStatus,
      commissionPct: parseFloat(pct) || 0,
      extraExpenses: extra,
      producerInvoiceNo: prodInvNo,
      producerInvoiceAmountPLN: isFinite(prodInvNum) ? prodInvNum : null,
      commissionInvoiceNo: commInvNo,
      expectedNetPLN: calc.netPLN,
      expectedCommissionPLN: calc.commissionPLN,
      // commission is charged on the producer's ACTUAL invoiced net sales value
      finalCommissionPLN: isFinite(prodInvNum) && prodInvNum > 0 ? Math.round(prodInvNum * (parseFloat(pct) || 0)) / 100 : calc.commissionPLN,
      ...(nextStatus === "Sent" && !st.sentAt ? { sentAt: localTodayISO() } : {}),
      ...(nextStatus === "Closed" ? { closedAt: localTodayISO() } : {}),
    };
    onSave(settlement, nextStatus === "Closed");
  }

  function canClose() {
    return isFinite(prodInvNum) && prodInvNum > 0 && (parseFloat(pct) || 0) > 0;
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120, padding: 20 }}>
      {stDialogNode}
      <div style={{ width: 860, maxHeight: "92vh", overflow: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #EBEBEB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Consignment settlement {st?.number ? <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, fontWeight: 800, color: "#7C3AED", background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 6, padding: "1px 8px", marginRight: 6 }}>{st.number}</span> : null}· {lot.number}</div>
            <div style={{ fontSize: 11.5, color: "#888", marginTop: 2 }}>{po ? `${po.number} · ${po.supplier?.name || "producer"}` : "No PO link"} · status: <strong>{status}</strong>{producer && seasonPct !== null && <> · season rate {seasonPct}%</>}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => printHtmlNodeInv("settlement-statement", `Settlement-${lot.number}`)} style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: "#111", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Print / PDF statement</button>
            <button onClick={onCancel} style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Close</button>
          </div>
        </div>

        <div style={{ padding: "14px 22px", display: "grid", gridTemplateColumns: "200px 1fr 1fr 1fr", gap: 10, alignItems: "end", borderBottom: "1px solid #F3F4F6", background: "#FAFAFA" }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>Commission %</label>
            <input type="number" step="0.1" value={pct} onChange={e => setPct(e.target.value)} disabled={status === "Closed"} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>Producer invoice no. (their FV to us)</label>
            <input value={prodInvNo} onChange={e => setProdInvNo(e.target.value)} disabled={status === "Closed"} placeholder="FV/…" style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>Producer invoice amount (PLN)</label>
            <input type="number" value={prodInvPLN} onChange={e => setProdInvPLN(e.target.value)} disabled={status === "Closed"} placeholder={`expected ${fmt(calc.netPLN)}`} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
            {invVariance !== null && Math.abs(invVariance) >= 1 && <div style={{ fontSize: 10.5, color: invVariance > 0 ? "#DC2626" : "#D97706", marginTop: 3, fontWeight: 600 }}>{invVariance > 0 ? "+" : ""}{fmt(invVariance)} vs expected net</div>}
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>Our commission invoice no.</label>
            <input value={commInvNo} onChange={e => setCommInvNo(e.target.value)} disabled={status === "Closed"} placeholder="FV/…" style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
          </div>
        </div>

        {calc.warnings.length > 0 && (
          <div style={{ margin: "12px 22px 0", padding: "8px 12px", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 7, fontSize: 11.5, color: "#92400E" }}>
            {calc.warnings.map((w, i) => <div key={i}>· {w}</div>)}
          </div>
        )}

        {/* The bilingual statement — also the print target */}
        <div style={{ padding: 22 }}>
          <div id="settlement-statement" style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: "18px 22px", fontSize: 11.5 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>CONSIGNMENT SETTLEMENT / ROZLICZENIE SPRZEDAŻY KOMISOWEJ</div>
                <div style={{ color: "#555", marginTop: 2 }}>Lot / Partia: <strong>{lot.number}</strong> · {lot.product}{lot.variety ? " — " + lot.variety : ""} · {po ? `PO ${po.number}` : ""} · Date / Data: {localTodayISO()}</div>
              </div>
              <div style={{ textAlign: "right", color: "#555" }}>
                <div style={{ fontWeight: 700 }}>MARIANNA</div>
                <div>for / dla: {po?.supplier?.name || "Producer"}</div>
              </div>
            </div>
            <div style={{ fontWeight: 800, fontSize: 11, marginTop: 6 }}>1. Sales / Sprzedaż</div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 3 }}>
              <thead><tr>{["SO", "Client / Klient", "Product / Produkt", "Kg", "Price / Cena", "Value / Wartość PLN"].map(h => <th key={h} style={{ border: "1px solid #D1D5DB", padding: 3, background: "#F9FAFB", textAlign: "left", fontSize: 10 }}>{h}</th>)}</tr></thead>
              <tbody>{calc.salesLines.map((l, i) => <tr key={i}>
                <td style={{ border: "1px solid #D1D5DB", padding: 3 }}>{l.soNumber}</td>
                <td style={{ border: "1px solid #D1D5DB", padding: 3 }}>{l.client}</td>
                <td style={{ border: "1px solid #D1D5DB", padding: 3 }}>{l.product}</td>
                <td style={{ border: "1px solid #D1D5DB", padding: 3, textAlign: "right" }}>{l.kg.toLocaleString("pl-PL")}</td>
                <td style={{ border: "1px solid #D1D5DB", padding: 3, textAlign: "right" }}>{l.unitPrice.toFixed(2)} {l.currency}</td>
                <td style={{ border: "1px solid #D1D5DB", padding: 3, textAlign: "right" }}>{l.pln.toLocaleString("pl-PL", { minimumFractionDigits: 2 })}</td>
              </tr>)}</tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 2px", fontWeight: 700 }}>
              <span>Gross sales value / Wartość sprzedaży brutto ({calc.soldKg.toLocaleString("pl-PL")} kg)</span><span>{fmt(calc.grossPLN)}</span>
            </div>
            <div style={{ fontWeight: 800, fontSize: 11, marginTop: 6 }}>2. Deducted expenses / Potrącone koszty</div>
            {calc.expenseLines.map((l, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 2px", borderBottom: "1px dotted #E5E7EB" }}>
                <span>{l.label}{l.manual ? " (manual / ręczny)" : ""}</span><span>−{l.pln.toLocaleString("pl-PL", { minimumFractionDigits: 2 })}</span>
              </div>
            ))}
            {!calc.expenseLines.length && <div style={{ color: "#888", fontStyle: "italic", padding: "2px 2px" }}>No expenses recorded / Brak kosztów</div>}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 2px", fontWeight: 700 }}>
              <span>Total expenses / Suma kosztów</span><span>−{fmt(calc.expensesPLN)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 8px", background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 6, marginTop: 6, fontWeight: 800 }}>
              <span>3. NET SALES VALUE / WARTOŚĆ SPRZEDAŻY NETTO — producer invoices us this amount / producent wystawia fakturę na tę kwotę</span><span>{fmt(calc.netPLN)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 8px", marginTop: 4 }}>
              <span>4. Our commission / Nasza prowizja ({calc.commissionPct}% × net)</span><span>−{fmt(calc.commissionPLN)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 8px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 6, fontWeight: 800 }}>
              <span>5. PRODUCER PAYOUT / DO WYPŁATY PRODUCENTOWI</span><span>{fmt(calc.payoutPLN)}</span>
            </div>
          </div>

          {/* manual expense editor (not printed) */}
          {status !== "Closed" && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.05em", marginBottom: 6 }}>MANUAL EXPENSE LINES</div>
              {extra.map((e: any, i: number) => (
                <div key={e.id || i} style={{ display: "grid", gridTemplateColumns: "1fr 160px 34px", gap: 8, marginBottom: 6 }}>
                  <input value={e.label} onChange={ev => setExtra(prev => prev.map((x, idx) => idx === i ? { ...x, label: ev.target.value } : x))} placeholder="e.g. Phytosanitary certificate" style={{ border: "1px solid #E5E7EB", borderRadius: 6, padding: "7px 9px", fontSize: 12.5 }} />
                  <input type="number" value={e.pln} onChange={ev => setExtra(prev => prev.map((x, idx) => idx === i ? { ...x, pln: ev.target.value } : x))} placeholder="PLN" style={{ border: "1px solid #E5E7EB", borderRadius: 6, padding: "7px 9px", fontSize: 12.5 }} />
                  <button onClick={() => setExtra(prev => prev.filter((_, idx) => idx !== i))} style={{ border: "1px solid #FECACA", background: "#fff", color: "#DC2626", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 700 }}>✕</button>
                </div>
              ))}
              <button onClick={() => setExtra(prev => [...prev, { id: nextId(), label: "", pln: "" }])} style={{ padding: "6px 12px", borderRadius: 7, border: "none", background: "#16A34A", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>+ Add expense line</button>
            </div>
          )}
        </div>

        <div style={{ padding: "14px 22px", borderTop: "1px solid #EBEBEB", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          {status !== "Closed" && <button onClick={() => save(status === "None" ? "Draft" : status)} style={{ padding: "8px 16px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Save</button>}
          {(status === "None" || status === "Draft") && <button onClick={() => save("Sent")} style={{ padding: "8px 16px", borderRadius: 7, border: "none", background: "#2563EB", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Mark statement sent</button>}
          {closedFinal && <div style={{ fontSize: 12, color: "#B45309", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 7, padding: "8px 12px", fontWeight: 600 }}>🔒 Closed &amp; final (ruling D2) — this settlement cannot be reopened or edited. Corrections go through a credit or debit note.</div>}
          {status !== "Closed" && <button disabled={!canClose()} title={canClose() ? "Writes producer invoice and commission credit into the lot's landed cost" : "Enter commission % and the producer's invoice amount first"} onClick={async () => { if (await stConfirm({ tone: "warn", title: `Close settlement for ${lot.number}?`, message: `Producer invoice ${prodInvNo || "(no number)"} = ${fmt(prodInvNum)} and commission ${fmt(calc.commissionPLN)} will be written into the lot's landed cost. SO P/L for this lot becomes final.`, confirmLabel: "Close settlement" })) save("Closed"); }} style={{ padding: "8px 16px", borderRadius: 7, border: "none", background: canClose() ? "#16A34A" : "#E5E7EB", color: canClose() ? "#fff" : "#9CA3AF", fontSize: 13, fontWeight: 700, cursor: canClose() ? "pointer" : "not-allowed", fontFamily: "inherit" }}>Close settlement</button>}
        </div>
      </div>
    </div>
  );
}

function normName(v: any) { return String(v || "").trim().toLowerCase(); }

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
              <DateInput value={date} onChange={e => setDate(e.target.value)} max={localTodayISO()} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
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
          <div><label style={lblStyle}>Return date</label><DateInput value={date} onChange={e => setDate(e.target.value)} max={localTodayISO()} style={inpStyle} /></div>
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
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : 0; };
// v6.99.33 (owner): the row actions are unmistakable - edit in the same blue as Claims, delete in red.
const qhBtn: any = { padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer" };
const qhEdit: any = { ...qhBtn, border: "1px solid #2563EB", background: "#EFF6FF", color: "#1D4ED8" };
const qhPrint: any = { ...qhBtn, border: "1px solid #0E7490", background: "#F0FDFA", color: "#0E7490" };
const qhDelete: any = { ...qhBtn, border: "1px solid #DC2626", background: "#DC2626", color: "#fff" };
const r0 = (v: number) => Math.round(v);

function supplierRefOf(lot: any, shipments: any[]): string {
  // v6.99.34: the supplier's own reference travels on the truck that brought the lot (GM-004 and the like).
  const sh = (shipments || []).find((s: any) => s && String(s.status) !== "Cancelled" && ((s.poRefs || []).includes(lot?.poRef) || (s.goods || []).some((g: any) => String(g.lotRef) === String(lot?.number))) && (s.supplierRef || (s.legs || []).some((l: any) => (l.vehicles || []).some((u: any) => u.supplierRef))));
  if (!sh) return "";
  return String(sh.supplierRef || (sh.legs || []).flatMap((l: any) => (l.vehicles || []).map((u: any) => u.supplierRef)).find(Boolean) || "");
}

function SeasonActions({ lot, lots = [], setLots = null, inspections = [], setInspections = null, stockCounts = [], setStockCounts = null, recompute, claims = [], settlements = [], orders = [], pos = [], contacts = [], userName = "", shipments: shipmentsRef = [] }: any) {
  // v6.99.19 (A-R14-8): once a claim on this lot is finalised or its truck settlement is closed, the facts behind them are frozen.
  const frozenBy = (() => {
    const cl = (claims || []).find((c: any) => ["Settled", "Accepted", "Closed"].includes(String(c.status)) && ((c.subjects || []).some((s: any) => String(s.ref) === String(lot.number)) || String(c.rootDoc?.number) === String(lot.poRef)));
    if (cl) return `claim ${cl.number} is ${String(cl.status).toLowerCase()}`;
    const st = (settlements || []).find((s: any) => String(s.poNumber) === String(lot.poRef) && s.status === "Closed");
    if (st) return `settlement ${st.number || ""} is closed`.trim();
    return "";
  })();

  const [win, setWin] = React.useState<"" | "inspect" | "sort" | "count">("");
  const [ins, setIns] = React.useState<any>(null);
  const [qrNos, setQrNos] = React.useState<any>({});
  const [sortF, setSortF] = React.useState<any>(null);
  const [countF, setCountF] = React.useState<any>(null);
  const cat = PEPPER_DEFECTS;   // v6.99.33 (owner): the producer's defect list is part of the report definition — nothing to configure
  const myIns = (inspections || []).filter((x: any) => String(x.lotNumber) === String(lot.number)).sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
  const myJobs = (lot.sortingJobs || []).slice().sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
  const myCounts = (stockCounts || []).filter((c: any) => (c.lines || []).some((l: any) => String(l.lotNumber) === String(lot.number))).sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
  const po = (pos || []).find((p: any) => String(p.number) === String(lot.poRef)) || null;
  const g = gradeSplit(lot);


  // v6.99.33 (owner): a sorting job can be corrected or removed. The ledger is never rewritten: its RECLASS / DAMAGE
  // movements are VOIDED (visible, with a reason) and the job record is dropped; editing then re-posts a fresh job.
  function voidJob(j: any, why: string) {
    const src = `sorting:${j.id}`;
    const next = { ...lot, movements: (lot.movements || []).map((m: any) => String(m.source || "") === src && !m.voided ? { ...m, voided: true, voidReason: `sorting job ${why} on ${localTodayISO()}` } : m), sortingJobs: (lot.sortingJobs || []).filter((x: any) => String(x.id) !== String(j.id)) };
    const healed = recompute(next, next.movements);
    setLots && setLots((prev: any[]) => (prev || []).map((l: any) => l.id === lot.id ? healed : l));
    recordAudit({ module: "Inventory", docType: "Lot", docNumber: lot.number, action: "movement", summary: `Sorting job of ${j.date} ${why} — its movements voided` });
  }
  function openInspection(existing?: any) {
    setIns(existing ? { ...existing } : blankInspection(lot, { nextId, todayISO: localTodayISO, po, tolerances: tolerancesFromLast(inspections, lot.product) }));
    setWin("inspect");
  }
  function openSorting() {
    const last = myIns[0];
    // v6.99.34 (A-R24-3): start from the pool that still has goods — the unsorted remainder first, never the whole lot again.
    const pools = sortablePools(lot);
    const first = pools.find(x => x.kg > 0) || pools[0];
    setSortF({ date: localTodayISO(), followsInspection: last ? String(last.id) : "", fromPool: first.key, kgIn: first.kg || "", classIKg: "", classIIKg: "", wasteKg: "", by: "", hours: "", note: "" });
    setWin("sort");
  }
  function openCount() {
    // v6.99.34 (A-R24-4): only what the counter types is held in state — the system figures are read from the lot at render,
    // so a sorting or another count in the same session cannot leave the window counting against stale numbers.
    const kgPerBox = num((po?.items || []).find((it: any) => String(it.id) === String(lot.poLineId))?.kgPerBox) || num(lot.kgPerBox) || "";
    setCountF({ date: localTodayISO(), by: userName || "", reason: "", kgPerBox, entries: {} });
    setWin("count");
  }
  React.useEffect(() => { const h = () => openInspection(); window.addEventListener("marianna:open-inspection", h); return () => window.removeEventListener("marianna:open-inspection", h); });

  const bigBtn = (color: string, bg: string, icon: string, title: string, sub: string, onClick: any) => (
    <button onClick={onClick} disabled={!!frozenBy} style={{ flex: "1 1 210px", textAlign: "left", padding: "10px 14px", borderRadius: 10, border: `1px solid ${color}`, background: frozenBy ? "#F3F4F6" : bg, cursor: frozenBy ? "not-allowed" : "pointer" }}>
      <div style={{ fontSize: 13.5, fontWeight: 800, color }}>{icon} {title}</div>
      <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>{sub}</div>
    </button>
  );

  return (
    <div style={{ background: "#fff", border: "2px solid #0E7490", borderRadius: 12, marginBottom: 16, overflow: "hidden" }}>
      <div style={{ background: "#ECFEFF", borderBottom: "1px solid #A5F3FC", padding: "8px 16px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#0E7490", letterSpacing: "0.04em" }}>QUALITY &amp; HANDLING</div>
        <div style={{ fontSize: 11.5, color: "#0F766E" }}>class I {g.I.toLocaleString("pl-PL")} kg · class II {g.II.toLocaleString("pl-PL")} kg · waste {g.waste.toLocaleString("pl-PL")} kg</div>
      </div>
      <div style={{ padding: "12px 16px" }}>
        {frozenBy && <div style={{ fontSize: 11.5, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 7, padding: "6px 9px", marginBottom: 10 }}>🔒 Locked — {frozenBy}. Correct by voiding a movement in the history, or by re-opening the settlement.</div>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          {bigBtn("#0E7490", "#F0FDFA", "🔬", "Quality inspection", "check the goods and judge them", () => openInspection())}
          {bigBtn("#7C3AED", "#F5F3FF", "⚖", "Sorting job", "split what the inspection said to sort", openSorting)}
          {bigBtn("#B45309", "#FFFBEB", "📋", "Stock count", "verify what is physically there", openCount)}
        </div>

        {/* the timeline — one line per act, newest first */}
        {!myIns.length && !myJobs.length && !myCounts.length && <div style={{ fontSize: 12, color: "#94A3B8" }}>Nothing recorded yet — inspect the goods before sorting.</div>}
        {myIns.map((x: any) => { const v = inspectionVerdict(x); return (
          <div key={String(x.id)} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11.5, padding: "5px 0", borderTop: "1px solid #F1F5F9", flexWrap: "wrap" }}>
            <span style={{ width: 20 }}>🔬</span>
            <b style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{qrNos[String(x.id)] || lastReportNumber("QR", String(x.id)) || "—"}</b>
            <span>{x.date} · {x.stage} · {x.inspector || "—"}</span>
            <span>checked {num(x.checkedQty).toLocaleString("pl-PL")} {x.unit || "kg"} ({samplePctOf(x)} %)</span>
            <span>defects <b>{v.totalPct} %</b></span>
            <span style={{ fontWeight: 800, color: v.acceptable ? "#16A34A" : "#DC2626" }}>{v.acceptable ? "Acceptable" : "Not acceptable"}</span>
            <span style={{ color: "#64748B" }}>· {x.verdict}</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {!frozenBy && <button onClick={() => openInspection(x)} style={qhEdit}>✎ Edit</button>}
              <button style={qhPrint} onClick={() => { const no = lastReportNumber("QR", String(x.id)) || issueReportNumber("QR", `${lot.number} · inspection ${x.date}`, userName, "Inventory"); setQrNos((m: any) => ({ ...m, [String(x.id)]: no })); setTimeout(() => printHtmlNodeInv(`insp-print-${x.id}`, `${no}-${lot.number}`), 60); }}>⎙ Print</button>
              {!frozenBy && setInspections && <button style={qhDelete} onClick={() => { if (!window.confirm(`Delete the inspection of ${x.date}?`)) return; setInspections((prev: any[]) => (prev || []).filter((p: any) => String(p.id) !== String(x.id))); recordAudit({ module: "Inventory", docType: "Lot", docNumber: lot.number, action: "deleted", summary: `Inspection ${x.date} deleted` }); }}>🗑 Delete</button>}
            </span>
            <InspectionPrintDoc x={x} lot={lot} no={qrNos[String(x.id)] || lastReportNumber("QR", String(x.id))} supplierRef={supplierRefOf(lot, shipmentsRef)} />
          </div>
        ); })}
        {myJobs.map((j: any) => (
          <div key={String(j.id)} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11.5, padding: "5px 0", borderTop: "1px solid #F1F5F9", flexWrap: "wrap" }}>
            <span style={{ width: 20 }}>⚖</span><span>{j.date}</span>
            <span>sorted <b>{Math.round(num(j.kgIn)).toLocaleString("pl-PL")} kg</b> → I {Math.round(num(j.classIKg)).toLocaleString("pl-PL")} · II {Math.round(num(j.classIIKg)).toLocaleString("pl-PL")} · waste {Math.round(num(j.wasteKg)).toLocaleString("pl-PL")}</span>
            {j.by ? <span>· {j.by}</span> : null}{j.hours ? <span>· {j.hours} h</span> : null}
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {!frozenBy && <button style={qhEdit} onClick={() => { voidJob(j, "corrected"); setSortF({ date: j.date, followsInspection: j.followsInspection || "", kgIn: j.kgIn, classIKg: j.classIKg, classIIKg: j.classIIKg, wasteKg: j.wasteKg, by: j.by || "", hours: j.hours || "", note: j.note || "" }); setWin("sort"); }}>✎ Edit</button>}
              {!frozenBy && <button style={qhDelete} onClick={() => { if (!window.confirm(`Delete the sorting job of ${j.date}? Its RECLASS and DAMAGE movements are voided (they stay visible in the history).`)) return; voidJob(j, "deleted"); }}>🗑 Delete</button>}
            </span>
          </div>
        ))}
        {myCounts.map((c: any) => { const mine = (c.lines || []).filter((l: any) => String(l.lotNumber) === String(lot.number)); return (
          <div key={String(c.id)} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11.5, padding: "5px 0", borderTop: "1px solid #F1F5F9", flexWrap: "wrap" }}>
            <span style={{ width: 20 }}>📋</span><span>{c.date} count</span>
            {mine.map((l: any, k: number) => <span key={k}>{l.grade ? `class ${l.grade}: ` : ""}counted {Math.round(num(l.countedKg)).toLocaleString("pl-PL")} vs system {Math.round(num(l.systemKg)).toLocaleString("pl-PL")} → <b style={{ color: num(l.diffKg) ? "#B45309" : "#16A34A" }}>{num(l.diffKg) >= 0 ? "+" : ""}{Math.round(num(l.diffKg))} kg</b></span>)}
            {c.by ? <span>· {c.by}</span> : null}
          </div>
        ); })}
      </div>

      {win === "inspect" && ins && (
        <InspectionWindow ins={ins} setIns={setIns} lot={lot} cat={cat} onClose={() => setWin("")} onSave={(final: any) => {
          setInspections && setInspections((prev: any[]) => (prev || []).some((p: any) => String(p.id) === String(final.id)) ? (prev || []).map((p: any) => String(p.id) === String(final.id) ? final : p) : [...(prev || []), final]);
          recordAudit({ module: "Inventory", docType: "Lot", docNumber: lot.number, action: "movement", summary: `Quality inspection ${final.date} · defects ${inspectionVerdict(final).totalPct}% · ${final.verdict}` });
          setWin("");
        }} />
      )}
      {win === "sort" && sortF && (
        <SortingWindow f={sortF} setF={setSortF} lot={lot} inspections={myIns} contacts={contacts} onClose={() => setWin("")} onSave={() => {
          const r = runSortingJob(lot, { ...sortF, fromPool: sortF.fromPool || "UNSORTED", date: sortF.date || localTodayISO() }, { nextId });
          if (r.error) { window.alert(r.error); return; }
          const healed = recompute(r.lot, r.lot.movements);
          setLots && setLots((prev: any[]) => (prev || []).map((l: any) => l.id === lot.id ? healed : l));
          recordAudit({ module: "Inventory", docType: "Lot", docNumber: lot.number, action: "movement", summary: `Sorting job: I ${sortF.classIKg} · II ${sortF.classIIKg} · waste ${sortF.wasteKg} kg` });
          const warn = gradeCommitmentWarning(healed, orders || []); if (warn) window.alert("⚠ " + warn);
          setWin("");
        }} />
      )}
      {win === "count" && countF && (
        <CountWindow f={countF} setF={setCountF} lot={lot} onClose={() => setWin("")} onSave={() => {
          const lines = countLinesForLot(lot).filter((r: any) => !r.informational).map((r: any) => { const e = { ...(countF.entries || {})[r.grade || "-"], kgPerBox: countF.kgPerBox }; const counted = countedKgOf(e as any);
            return { lotNumber: lot.number, grade: r.grade, countedKg: counted, systemKg: r.systemKg, diffKg: r0(counted - num(r.systemKg)), pallets: (e as any).pallets, boxesPerPallet: (e as any).boxesPerPallet, looseBoxes: (e as any).looseBoxes }; });
          const count = { id: nextId(), date: countF.date || localTodayISO(), locationId: lot.locationId, by: countF.by || userName || "", lines };
          const res = applyStockCount(lots || [], count as any, countF.reason || "stock count", { nextId });
          setLots && setLots((prev: any[]) => (prev || []).map((l: any) => { const hit = (res.lots || []).find((x: any) => x.id === l.id); return hit ? recompute(hit, hit.movements) : l; }));
          setStockCounts && setStockCounts((prev: any[]) => [...(prev || []), count]);
          recordAudit({ module: "Inventory", docType: "Lot", docNumber: lot.number, action: "movement", summary: `Stock count ${count.date}: ${lines.map((l: any) => `${l.grade ? "class " + l.grade + " " : ""}${l.diffKg >= 0 ? "+" : ""}${l.diffKg} kg`).join(" · ")}` });
          setWin("");
        }} />
      )}
    </div>
  );
}

// ── v6.99.32: the three windows of Quality & Handling (A-QH-1/3/5/6/8) ──
function QhWindow({ title, subtitle, colour, onClose, onSave, saveLabel = "Save", confirmText = "", children, extra = null }: any) {
  // v6.99.34 (A-R24-5, owner): the confirmation belongs to THIS window — the application-wide dialog appeared detached from it.
  const [asking, setAsking] = React.useState(false);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflow: "auto" }}>
      <div style={{ background: "#fff", borderRadius: 12, width: "min(980px, 100%)", border: `2px solid ${colour}`, overflow: "hidden" }}>
        <div style={{ background: "#F8FAFC", borderBottom: `1px solid ${colour}33`, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <div><div style={{ fontSize: 14, fontWeight: 800, color: colour }}>{title}</div><div style={{ fontSize: 11.5, color: "#64748B" }}>{subtitle}</div></div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {extra}
            <SmallButton onClick={onClose}>Close</SmallButton>
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
function InspectionWindow({ ins, setIns, lot, cat, onClose, onSave }: any) {
  const set = (k: string, v: any) => setIns((x: any) => ({ ...x, [k]: v }));
  const v = inspectionVerdict(ins);
  const checks: any[] = ins.externalChecks || [];
  const setCheck = (i: number, k: string, val: any) => set("externalChecks", checks.map((c, j) => j === i ? { ...c, [k]: val } : c));
  const setTol = (categoryName: string, val: any) => set("tolerances", { ...(ins.tolerances || {}), [categoryName]: parseFloat(val) || 0 });
  return (
    <QhWindow title="🔬 Quality inspection" subtitle={`${lot.number} · ${lot.product}${lot.variety ? " — " + lot.variety : ""}`} colour="#0E7490" onClose={onClose} onSave={() => onSave(ins)} saveLabel="Save report">
      <div style={{ fontSize: 10.5, fontWeight: 800, color: "#94A3B8", marginBottom: 6 }}>HEADER</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
        <QhField label="Date of inspection"><DateInput value={ins.date} onChange={(e: any) => set("date", e.target.value)} /></QhField>
        <QhField label="Location of inspection"><Sel value={ins.stage} onChange={(e: any) => set("stage", e.target.value)}><option value="pre-unloading">On arrival / pre-unloading</option><option value="warehouse">In our warehouse</option><option value="client">At the client</option><option value="other">Other</option></Sel></QhField>
        <QhField label="Inspector"><input value={ins.inspector || ""} onChange={e => set("inspector", e.target.value)} style={qhInp} /></QhField>
        <QhField label="Temperature (°C)"><input value={ins.temperature ?? ""} onChange={e => set("temperature", e.target.value)} style={qhInp} /></QhField>
        <QhField label={`Quantity delivered (${ins.unit || "kg"})`}><input type="number" value={ins.orderedQty ?? ""} onChange={e => set("orderedQty", e.target.value)} style={qhInp} /></QhField>
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
          <div style={{ fontSize: 10.5, color: "#94A3B8", textAlign: "center" }}>tol. {(ins.tolerances || {})[d.category] ?? 0} %</div>
          <button onClick={() => set("defects", ins.defects.filter((_: any, k: number) => k !== i))} style={{ border: "1px solid #FECACA", background: "#fff", color: "#DC2626", borderRadius: 6, height: 32, cursor: "pointer" }}>✕</button>
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
function SortingWindow({ f, setF, lot, inspections = [], contacts = [], onClose, onSave }: any) {
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const placed = num(f.classIKg) + num(f.classIIKg) + num(f.wasteKg);
  const remaining = r0(num(f.kgIn) - placed);
  const follows = inspections.find((x: any) => String(x.id) === String(f.followsInspection));
  return (
    <QhWindow title="⚖ Sorting job" subtitle={`${lot.number} · splits what the inspection said to sort`} colour="#7C3AED" onClose={onClose}
      onSave={onSave} saveLabel="Post sorting"
      confirmText={`Post this sorting: ${num(f.kgIn).toLocaleString("pl-PL")} kg → class I ${num(f.classIKg).toLocaleString("pl-PL")} · class II ${num(f.classIIKg).toLocaleString("pl-PL")} · waste ${num(f.wasteKg).toLocaleString("pl-PL")}${follows ? "" : " (no inspection referenced)"}?`}>
      {!inspections.length && <div style={{ fontSize: 11.5, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 7, padding: "6px 9px", marginBottom: 10 }}>No quality inspection on this lot yet — sorting normally follows one. You can still post it.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
        <QhField label="Date sorted"><DateInput value={f.date} onChange={(e: any) => set("date", e.target.value)} /></QhField>
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
function CountWindow({ f, setF, lot, onClose, onSave }: any) {
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const setRow = (grade: string, k: string, v: any) => set("entries", { ...(f.entries || {}), [grade || "-"]: { ...((f.entries || {})[grade || "-"] || {}), [k]: v } });
  return (
    <QhWindow title="📋 Stock count" subtitle={`${lot.number} · what is physically on the floor`} colour="#B45309" onClose={onClose} onSave={onSave} saveLabel="Save count & adjust"
      confirmText="Save this count? Differences beyond 1 kg are posted as reasoned adjustments on their class.">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
        <QhField label="Date counted"><DateInput value={f.date} onChange={(e: any) => set("date", e.target.value)} /></QhField>
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
function InspectionPrintDoc({ x, lot, no, supplierRef = "" }: any) {
  const v = inspectionVerdict(x);
  // v6.99.33 (owner): readable on paper — wide first columns that never wrap, centred figures, air between the sections.
  const cell = { border: "1px solid #999", padding: "4px 7px", fontSize: 11, textAlign: "center" } as any;
  const left = { ...cell, textAlign: "left", whiteSpace: "nowrap" } as any;
  const hd = { ...cell, background: "#F3F4F6", fontWeight: 700 } as any;
  const hdL = { ...left, background: "#F3F4F6", fontWeight: 700 } as any;
  const section = { fontWeight: 800, margin: "20px 0 6px", fontSize: 12.5, letterSpacing: "0.03em" } as any;
  const green = "#166534", red = "#B91C1C";
  return (
    <div id={`insp-print-${x.id}`} style={{ position: "absolute", left: -10000, top: 0, width: 780, background: "#fff", fontFamily: "Arial", fontSize: 12, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", borderBottom: "2px solid #111", paddingBottom: 10, marginBottom: 10 }}>
        <PrintLogo width={180} />
        <div style={{ marginLeft: "auto", textAlign: "right" }}><div style={{ fontSize: 15, fontWeight: 800 }}>QUALITY REPORT</div><div style={{ fontSize: 13, fontWeight: 800, fontFamily: "ui-monospace, Menlo, monospace" }}>{no || ""}</div></div>
      </div>
      <div style={{ textAlign: "center", margin: "22px 0 24px" }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>{lot.product}{lot.variety ? ` — ${lot.variety}` : ""}</div>
        {/* v6.99.34 (A-R24-7, owner): our reference and the supplier's, same type, side by side — the only link between the two vocabularies */}
        <div style={{ fontSize: 16, fontWeight: 800, marginTop: 6 }}>{lot.number}{supplierRef ? `  ·  supplier ref ${supplierRef}` : ""}</div>
      </div>

      <table style={{ borderCollapse: "collapse", width: "100%" }}><tbody>
        <tr><td style={hdL}>Date</td><td style={cell}>{x.date}</td><td style={hdL}>Location</td><td style={cell}>{x.stage}</td></tr>
        <tr><td style={hdL}>Inspector</td><td style={cell}>{x.inspector || "—"}</td><td style={hdL}>Temperature</td><td style={cell}>{x.temperature ?? "—"}</td></tr>
        <tr><td style={hdL}>Quantity delivered</td><td style={cell}>{num(x.orderedQty).toLocaleString("pl-PL")} {x.unit || "kg"}</td><td style={hdL}>Quantity checked</td><td style={cell}>{num(x.checkedQty).toLocaleString("pl-PL")} {x.unit || "kg"} ({samplePctOf(x)} %)</td></tr>
      </tbody></table>

      <div style={section}>EXTERNAL QUALITY</div>
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
        <colgroup><col style={{ width: "34%" }} /><col style={{ width: "18%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /></colgroup>
        <tbody>
          <tr><th style={hdL}>Check</th>{["Expected", "Max", "Avg", "Min", "Result"].map(h => <th key={h} style={hd}>{h}</th>)}</tr>
          {(x.externalChecks || []).map((c: any, i: number) => <tr key={i}><td style={left}>{c.name}</td>{[c.expected ?? "—", c.max ?? "—", c.avg ?? "—", c.min ?? "—", c.status || "Not checked"].map((val: any, k: number) => <td key={k} style={cell}>{val}</td>)}</tr>)}
        </tbody>
      </table>

      <div style={section}>DEFECTS</div>
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
        <colgroup><col style={{ width: "22%" }} /><col style={{ width: "58%" }} /><col style={{ width: "20%" }} /></colgroup>
        <tbody>
          <tr><th style={hdL}>Category</th><th style={hdL}>Defect</th><th style={hd}>% found</th></tr>
          {!(x.defects || []).length && <tr><td style={left} colSpan={3}>— none recorded —</td></tr>}
          {(x.defects || []).map((d: any, i: number) => <tr key={i}><td style={left}>{d.category}</td><td style={{ ...left, whiteSpace: "normal" }}>{d.name}</td><td style={cell}>{d.pct}</td></tr>)}
        </tbody>
      </table>

      <table style={{ borderCollapse: "collapse", marginTop: 14, width: "100%", tableLayout: "fixed" }}>
        <colgroup><col style={{ width: "34%" }} /><col style={{ width: "16%" }} /><col style={{ width: "16%" }} /><col style={{ width: "14%" }} /><col style={{ width: "20%" }} /></colgroup>
        <tbody>
          <tr><th style={hdL}>Category</th>{["Total %", "Tolerance %", "Net %", "Result"].map(h => <th key={h} style={hd}>{h}</th>)}</tr>
          {v.rows.map((r: any) => <tr key={r.category}>
            <td style={left}>{r.category} defects</td><td style={cell}>{r.pct}</td><td style={cell}>{r.tolerance}</td><td style={{ ...cell, fontWeight: 700 }}>{r.net}</td>
            <td style={{ ...cell, fontWeight: 800, color: r.acceptable ? green : red }}>{r.acceptable ? "Acceptable" : "Not acceptable"}</td>
          </tr>)}
          <tr style={{ background: "#F9FAFB" }}>
            <td style={{ ...left, fontWeight: 800 }}>Total quality report</td>
            <td style={{ ...cell, fontWeight: 800 }}>{v.totalPct}</td><td style={{ ...cell, fontWeight: 800 }}>{v.totalTolerance}</td><td style={{ ...cell, fontWeight: 800 }}>{v.totalNet}</td>
            <td style={{ ...cell, fontWeight: 800, color: v.acceptable ? green : red }}>{v.acceptable ? "Acceptable" : "Not acceptable"}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ margin: "22px 0 6px", fontSize: 12.5 }}>Verdict: <b>{x.verdict}</b>{x.observations ? ` · ${x.observations}` : ""}</div>
      <div style={{ margin: "6px 0 22px", fontSize: 13, fontWeight: 800, color: v.recommendation === "Reject" ? red : v.recommendation === "Sort" ? "#B45309" : green }}>
        Recommendation: {v.recommendation} <span style={{ fontWeight: 500, color: "#444", fontSize: 11.5 }}>— {v.advice}</span>
      </div>
      <div style={{ fontSize: 9.5, color: "#666", borderTop: "1px solid #DDD", paddingTop: 8 }}>Issued from MARIANNA ERP · {no || ""} · recorded in the audit trail.</div>
    </div>
  );
}


// ── v6.91.0: THE LOT WORKBENCH — one screen per lot, composed from the owning modules, storing nothing ──
function LotWorkbench({ lot, shipments = [], inspections = [], claims = [], orders = [], settlements = [], contacts = [] }: any) {
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
      <div style={{ background: "#0F172A", color: "#fff", padding: "10px 16px", display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "#94A3B8" }}>LOT WORKBENCH</span>
        <span style={{ fontSize: 16, fontWeight: 800, fontFamily: "ui-monospace, Menlo, monospace" }}>{lot.number}</span>
        {unit?.supplierRef ? <span style={{ fontSize: 13, fontWeight: 700, background: "#1D4ED8", padding: "2px 10px", borderRadius: 20 }}>supplier ref {unit.supplierRef}</span> : null}
        <span style={{ fontSize: 13.5 }}>{lot.product}{lot.variety ? ` — ${lot.variety}` : ""}</span>
        {lot.poRef ? <span style={{ fontSize: 12, color: "#CBD5E1" }}>· {lot.poRef}</span> : null}
      </div>
      <div style={{ padding: "12px 16px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
        {tile("ARRIVAL", arrival ? <>{arrival.number} · {arrival.arrangedBy === "SUPPLIER" ? "supplier's truck" : "our shipment"}<br />{unit?.truckPlate || unit?.announcedPlate || "plates —"}{plateMismatch(unit) ? <b style={{ color: "#DC2626" }}> · plates differ from announced!</b> : ""}<br />{arrivedAt ? `arrived ${arrivedAt}` : (unit?.eta ? `ETA ${unit.eta}` : "not arrived")}</> : <span style={{ color: "#94A3B8" }}>no inbound shipment{lot.poRef ? " — register the supplier's truck on the PO" : ""}</span>)}
        {/* v6.99.17 (A-R13-7): RECEIPT tile removed — the quantity breakdown already shows expected / received / variance */}
        {tile("QUALITY", lastIns ? <>{lastIns.stage} {lastIns.date}<br />defects <b>{inspectionTotals(lastIns).totalPct}%</b> · <b style={{ color: lastIns.verdict === "Rejected" ? "#DC2626" : lastIns.verdict === "Sort" ? "#B45309" : "#16A34A" }}>{lastIns.verdict}</b><br />{ins.length} inspection(s){lotClaims.length ? ` · ${lotClaims.length} claim(s)` : ""}</> : <span style={{ color: dueQC ? "#B45309" : "#94A3B8" }}>no inspection{dueQC ? ` — QC report due ${dueQC}` : ""}{lotClaims.length ? ` · ${lotClaims.length} claim(s)` : ""}</span>, lastIns ? "#111" : "#94A3B8")}
        {tile("STOCK — AVAILABLE NOW", (() => { const a = lotAvailabilityByGrade(lot, orders); return <><div>class I <b>{a.I.toLocaleString("pl-PL")}</b> kg</div><div>class II <b>{a.II.toLocaleString("pl-PL")}</b> kg</div>{a.unsorted > 0 ? <div>unsorted {a.unsorted.toLocaleString("pl-PL")} kg</div> : null}<div style={{ color: "#94A3B8" }}>waste {g.waste.toLocaleString("pl-PL")} kg</div></>; })())}
        {tile("SALES", <>{sales.length ? sales.map((o: any) => { const kg = (o.items || []).filter((it: any) => (it.sourceType === "STOCK" && String(it.sourceRef) === String(lot.number)) || (it.sourceType === "PO" && lot.poRef && String(it.sourceRef) === String(lot.poRef))).reduce((a: number, it: any) => a + num(it.qty), 0); return <div key={o.number}>{o.number} · <b>{Math.round(kg).toLocaleString("pl-PL")} kg</b>{o.items?.some((it: any) => it.grade === "II") ? " · II" : ""} · {o.status}</div>; }) : <span style={{ color: "#94A3B8" }}>no sales yet</span>}<span style={{ color: num(lot.receivedKg) > 0 && soldKg + g.waste >= num(lot.receivedKg) - 1 ? "#16A34A" : "#B45309" }}>{num(lot.receivedKg) > 0 && soldKg + g.waste >= num(lot.receivedKg) - 1 ? "fully sold" : `${Math.max(0, Math.round(num(lot.receivedKg) - soldKg - g.waste)).toLocaleString("pl-PL")} kg to sell`}</span></>)}
        {tile("SETTLEMENT (on the PO)", settlement ? <>{settlement.number ? settlement.number + " · " : ""}<b style={{ color: settlement.status === "Closed" ? "#16A34A" : "#B45309" }}>{settlement.status}</b>{settlement.closedAt ? ` · closed ${settlement.closedAt}` : ""}<br />{settlement.commissionInvoiceId ? "commission invoice issued" : settlement.status === "Closed" ? "commission not yet invoiced — waiting for the Monday commission run" : "closes on the PO when the truck is sold"}</> : <span style={{ color: "#94A3B8" }}>{lot.poRef ? `not opened yet — on ${lot.poRef}` : "—"}</span>)}
      </div>
      <div style={{ marginTop: 8, fontSize: 10.5, color: "#94A3B8" }}>Actions live below in their owning sections: Receive · Inspect · Sort · Count · Move · Return · Claim; the settlement, its reports and the commission run are on the PO. This strip stores nothing — it reads what each module owns.</div>
      </div>
    </div>
  );
}



function LotDetail({ lot, pos = [], onBack, onMove, onQualityIssue, onEditMovement, onDeleteMovement, onVoidMovement, onDelete, onInspect, onReturn, liveSOs, shipments, allLots = [], contacts = [], onRecordSorting, onOpenSettlement, onOpenClaim = null, onDirectReceive = null, tracePOs = [], traceInvoices = [], lotClaims = [], season = null , userName = "" }: any) {
  // v6.99.30 (A-R21-3, owner): a recall document must be identifiable afterwards — it carries its own number,
  // minted when it is issued and written to the audit trail with the lot and the person who ran it.
  const [traceNo, setTraceNo] = useState<string>("");
  const seasonInspections = season?.inspections || [];   // v6.99.17 (A-R13-9): ONE inspections store — the legacy card reads it too
  const res = lotReservations(lot, liveSOs, { lots: allLots, shipments });
  const cpk = costPerKg(lot);
  const total = totalCost(lot);
  const value = valueInStock(lot);
  const variance = (lot.receivedKg || 0) - (lot.expectedKg || 0);
  const shippedOutKg = Math.max(0, (lot.receivedKg || 0) - (lot.physicalKg || 0) - (lot.damagedKg || 0) - (lot.wasteKg || 0));   // v6.99.34 (A-R24-1)

  // Qty stripe segments — show the lifecycle of the receivedKg
  const segments = [
    { key: "Available",   kg: res.liveAvailable,   color: "#16A34A" },
    { key: "Reserved",    kg: res.totalReserved,   color: "#7C3AED" },
    { key: "Shipped out", kg: shippedOutKg,        color: "#2563EB" },
    { key: "Damaged",     kg: lot.damagedKg || 0,  color: "#DC2626" },
    { key: "Waste (sorting)", kg: lot.wasteKg || 0, color: "#6B7280" },
  ].filter(s => s.kg > 0);
  const totalKg = segments.reduce((s, x) => s + x.kg, 0);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#2563EB", fontWeight: 500 }}>← Inventory</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <button onClick={onMove} title="v6.99.28: cost-free transfers only — damage belongs to the quality inspection" style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #7DD3FC", background: "#E0F2FE", color: "#0369A1", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Record movement</button>
          {/* v6.99.30 (A-R21-1, owner): the header's "Report quality issue" is gone — quality has ONE entry, the Quality inspection in Season actions */}
          {(lot.movements || []).some((m: any) => m.type === "SHIP_OUT") && (
            <button onClick={onReturn} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #7C3AED", background: "#fff", color: "#7C3AED", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>↩ Return to warehouse</button>
          )}
          {/* v6.99.28 (owner): only a purchase the SUPPLIER delivers (DDP / DAP / DPU) is received here — every other lot arrives through its shipment */}
          {typeof onDirectReceive === "function" && (lot.status === "Expected" || lot.status === "Direct Expected") && !(lot.movements || []).some((m: any) => !m.voided) && ["DDP", "DAP", "DPU"].includes(String((pos || []).find((x: any) => String(x.number) === String(lot.poRef))?.buyIncoterm || "").toUpperCase()) && (
            <button onClick={onDirectReceive} title="For DDP / direct arrivals with no shipment of ours: posts the receipt movement so the stock becomes available." style={{ padding: "5px 14px", borderRadius: 7, border: "none", background: "#16A34A", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>📥 Receive into stock (direct/DDP)</button>
          )}
          <button onClick={onDelete} style={{ padding: "5px 12px", borderRadius: 7, border: "none", color: "#fff", background: "#DC2626", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Delete</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
        <div style={{ maxWidth: PAGE_MAX, margin: "0 auto" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22 }}>
            <div>
              {/* v6.59.0 (user ruling): the lot NUMBER comes first. Status,
                  class and the expected/received variance sat above it, so the
                  eye met three qualifiers before the thing being qualified. */}
              <div style={{ fontSize: 26, fontWeight: 700, color: "#111", fontFamily: "ui-monospace, Menlo, monospace", marginBottom: 6 }}>{lot.number}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <StatusBadge status={lot.status} />
                <QualityBadge quality={lot.quality} />
                <VarianceBadge expected={lot.expectedKg} actual={lot.receivedKg} />
              </div>
              {/* v6.59.0: the supplier — asked far more often than the packaging. */}
              {(() => { const po = (pos || []).find((x: any) => String(x.number) === String(lot.poRef));
                const sup = po?.supplier?.name || lot.supplierName || "";
                // v6.65.0 (owner request): the supplier must read as a different kind of
                // information than the product — amber, smaller caps, not near-black.
                return sup ? <div style={{ fontSize: 11.5, fontWeight: 700, color: "#0369A1", letterSpacing: "0.03em", textTransform: "uppercase", marginBottom: 2 }}>{sup}</div> : null; })()}
              <div style={{ fontSize: 14, color: "#444" }}>{lot.product}{lot.variety ? " — " + lot.variety : ""} · {lot.size || "—"} · {lot.origin || "—"} · {lot.packaging}</div>
              <div style={{ marginTop: 10 }}><LotDirectionBadge lot={lot} shipments={shipments} orders={liveSOs} pos={pos} /></div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#888" }}>Value of physical stock</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#111" }}>{fmtMoney(value)}</div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{fmtMoney(cpk)}/kg · received {fmtNum(lot.receivedKg)} kg</div>
            </div>
          </div>

          {/* Qty breakdown — v6.3.0 compact strip (PO-module density): figures + bar on one row */}
          <Card style={{ marginBottom: 12, padding: "12px 16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(78px, 1fr))", gap: 10, alignItems: "center" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#AAA", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>QUANTITY<br />BREAKDOWN</div>
              <div><div style={{ fontSize: 9, color: "#888" }}>EXPECTED</div><div style={{ fontSize: 12.5, fontWeight: 600, color: "#555" }}>{fmtNum(lot.expectedKg)} kg</div></div>
              <div><div style={{ fontSize: 9, color: "#888" }}>RECEIVED</div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#111" }}>{fmtNum(lot.receivedKg)} kg</div></div>
              <div title="Live: physicalKg − reservations from pre-dispatch SOs"><div style={{ fontSize: 9, color: "#16A34A" }}>AVAILABLE</div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#16A34A" }}>{fmtNum(res.liveAvailable)} kg</div></div>
              <div title="From Confirmed/Reserved/Loading SOs"><div style={{ fontSize: 9, color: "#7C3AED" }}>RESERVED</div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#7C3AED" }}>{fmtNum(res.totalReserved)} kg</div></div>
              {(() => { const g = { ...gradeSplit(lot), waste: num(lot.wasteKg) || gradeSplit(lot).waste }; return (g.II > 0 || g.waste > 0) ? <><div title="v6.99.19: sorted classes — CLASS II is sound fruit reclassified by sorting; WASTE is what the sorting threw away (a DAMAGE movement with source sorting:). DAMAGED is any other loss: transit damage, a count adjustment, damage found in store."><div style={{ fontSize: 9, color: "#166534" }}>CLASS I</div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#166534" }}>{fmtNum(g.I)} kg</div></div><div><div style={{ fontSize: 9, color: "#B45309" }}>CLASS II</div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#B45309" }}>{fmtNum(g.II)} kg</div></div><div><div style={{ fontSize: 9, color: "#6B7280" }}>WASTE (sorting)</div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#6B7280" }}>{fmtNum(g.waste)} kg</div></div></> : null; })()}
              <div><div title="v6.99.19: DAMAGED = losses outside sorting (transit, store, count adjustments). Sorting waste is shown separately."><div style={{ fontSize: 9, color: "#DC2626" }}>DAMAGED</div></div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#DC2626" }}>{fmtNum(lot.damagedKg)} kg</div></div>
              <div>
                {totalKg > 0 && (
                  <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", border: "1px solid #F3F4F6" }} title={segments.map(s => `${s.key}: ${s.kg.toLocaleString()} kg`).join("  ·  ")}>
                    {segments.map((s, i) => (
                      <div key={i} title={`${s.key}: ${s.kg.toLocaleString()} kg (${((s.kg / totalKg) * 100).toFixed(1)}%)`} style={{ background: s.color, width: `${(s.kg / totalKg) * 100}%` }} />
                    ))}
                  </div>
                )}
              </div>
            </div>
            {variance !== 0 && lot.receivedKg > 0 && (
              <div style={{ marginTop: 8, padding: "5px 9px", background: variance < 0 ? "#FEF3C7" : "#DBEAFE", border: `1px solid ${variance < 0 ? "#FDE68A" : "#BFDBFE"}`, borderRadius: 6, fontSize: 11, color: variance < 0 ? "#92400E" : "#1E40AF" }}>
                <strong>{variance > 0 ? "Surplus" : "Shortfall"}:</strong> {Math.abs(variance).toLocaleString()} kg ({((variance / lot.expectedKg) * 100).toFixed(2)}%) vs PO {lot.poRef}
                <span title={variance < 0 ? "Common causes: moisture loss in transit, weight check at port, damage. Consider raising a damage report if responsibility lies with carrier or supplier." : "Higher than ordered — confirm with supplier."} style={{ marginLeft: 6, cursor: "help", color: "inherit", opacity: 0.7 }}>ⓘ</span>
              </div>
            )}
          </Card>

          {/* v6.6: consignment banner + settlement entry point */}
          {lot.consignment && (
            <Card style={{ marginBottom: 12, border: "1px solid #DDD6FE", background: "#FAF5FF" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: "#6D28D9" }}>⚖ CONSIGNMENT LOT — price settled on sales</div>
                  <div style={{ fontSize: 11.5, color: "#7C3AED", marginTop: 3, lineHeight: 1.5 }}>
                    Producer's goods in our custody. Sell at your prices; all expenses are deducted at settlement.
                    Settled per truck on the purchase order (all lots of the PO together; expenses include delivery freight; producer invoice in its own currency).
                    {lot.settlement?.closedAt ? ` · closed ${lot.settlement.closedAt}` : lot.settlement?.sentAt ? ` · statement sent ${lot.settlement.sentAt}` : ""}
                  </div>
                </div>
{/* v6.99.17 (A-R13-2, ownership): the settlement is per PO (truck) and lives in PURCHASE ORDERS — the old per-lot settlement is retired */}
                <span style={{ fontSize: 11.5, color: "#6D28D9", fontWeight: 700 }}>Settlement: on {lot.poRef || "the PO"} (Purchase Orders → Truck settlement)</span>
                {onOpenClaim && (
                  <button onClick={() => onOpenClaim(lot)} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: "#B45309", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", marginLeft: 8 }} title="Quantify damage on this consignment and request a credit note from the producer">
                    {(lotClaims || []).length ? `Producer claim (${(lotClaims || []).length})` : "Producer claim"}
                  </button>
                )}
                <button onClick={() => { const no = issueReportNumber("TRC", lot.number, userName); setTraceNo(no); setTimeout(() => printHtmlNodeInv("lot-trace-doc", `${no}-${lot.number}`), 60); }} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #0F766E", background: "#fff", color: "#0F766E", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", marginLeft: 8 }} title="One-click recall report: where this lot came from and everywhere it went — supplier, shipments, clients, invoices.">
                  🔎 Trace / recall
                </button>
              </div>
            </Card>
          )}

          {/* v6.5: expected warehouse charges — predicted from movements + tariff */}
          {(() => {
            const wh = computeLotWarehouseCharges(lot, contacts, localTodayISO());
            if (!wh) return null;
            return (
              <Card style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <SectionTitle>WAREHOUSE CHARGES — EXPECTED · {wh.warehouseName.toUpperCase()}</SectionTitle>
                    <div style={{ fontSize: 10.5, color: "#888", marginTop: -8 }}>
                      {wh.basis === "pallet"
                        ? `${wh.chargeablePalletDays.toLocaleString("pl-PL")} chargeable pallet-days`
                        : `${wh.chargeableKgDays.toLocaleString("pl-PL")} chargeable kg-days`}
                      {" "}accrued to date · predicted from this lot's movements — compare against the warehouse invoice
                    </div>
                  </div>
                  <button onClick={() => onRecordSorting && onRecordSorting(lot)} style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: "#16A34A", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>+ Record sorting</button>
                </div>
                {wh.lines.map((l, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #F9FAFB", fontSize: 12, color: "#444" }}>
                    <span>{l.label}{l.date ? <span style={{ color: "#999", fontSize: 10.5 }}> · {formatDMY(l.date)}</span> : null}{l.note ? <span style={{ color: "#999", fontSize: 10.5 }}> — {l.note}</span> : null}</span>
                    <span style={{ fontWeight: 600 }}>{l.amount.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} {wh.currency}</span>
                  </div>
                ))}
                {!wh.lines.length && <div style={{ fontSize: 11, color: "#AAA", fontStyle: "italic" }}>No chargeable activity yet (free period or no stock days).</div>}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, padding: "8px 10px", background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 7 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#0C4A6E" }}>Expected invoice for this lot (to date)</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#0C4A6E" }}>
                    {wh.total.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} {wh.currency}
                    {wh.currency !== "PLN" && <span style={{ fontWeight: 500, color: "#0369A1", marginLeft: 8, fontSize: 11 }}>≈ {wh.totalPLN.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} PLN</span>}
                  </span>
                </div>
                {wh.notes.map((n, i) => <div key={i} style={{ fontSize: 10.5, color: "#92400E", marginTop: 6 }}>ⓘ {n}</div>)}
                <div style={{ fontSize: 10, color: "#AAA", marginTop: 6 }}>Monthly totals per warehouse and invoice reconciliation: Finance → Warehouse charges.</div>
              </Card>
            );
          })()}
          {res.reservations.length > 0 && (
            <Card style={{ marginBottom: 16, border: "1px solid #DDD6FE", background: "#FAF8FF" }}>
              <SectionTitle>RESERVATIONS · {res.reservations.length} SO{res.reservations.length !== 1 ? "s" : ""}</SectionTitle>
              <div style={{ display: "grid", gap: 8 }}>
                {res.reservations.map((r, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "160px 1fr 100px 100px", gap: 10, alignItems: "center", padding: "8px 10px", background: "#fff", border: "1px solid #EDE9FE", borderRadius: 7 }}>
                    <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, fontWeight: 700, color: "#7C3AED" }}>{r.soNumber}</div>
                    <div style={{ fontSize: 12, color: "#555" }}>{r.clientName}</div>
                    <div><StatusBadge status={r.status} /></div>
                    <div style={{ textAlign: "right", fontSize: 12.5, fontWeight: 600, color: "#7C3AED" }}>{fmtNum(r.qty)} kg</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 10.5, color: "#888", fontStyle: "italic" }}>
                Only SOs in Confirmed/Reserved/Loading status count against live availability. Shipped+ SOs have already physically left and are reflected in SHIP_OUT movements.
              </div>
            </Card>
          )}

          {/* Two-column body */}
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
            <div>
              {/* Journey (v6.1b) — planned stages from the PO flow, with ownership coding */}
              {(() => { const journey = journeyForLot(lot, shipments || [], liveSOs || []); return journey.length > 0 && (
                <Card style={{ marginBottom: 16 }}>
                  <SectionTitle>JOURNEY · {journey.length} STAGES</SectionTitle>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 14, lineHeight: 1.5 }}>
                    Planned route for this lot, from its flow. <span style={{ color: "#16A34A", fontWeight: 600 }}>Green = ours (our risk)</span>; grey = not yet ours / handed to client.
                  </div>
                  <div style={{ position: "relative" }}>
                    {journey.map((s, i) => {
                      const owned = s.ownership === "owned";
                      const tagText = s.ownership === "owned" ? "OURS" : s.ownership === "not_owned" ? "supplier's" : "client's";
                      const done = s.status === "done";
                      const active = s.status === "active";
                      const dotColor = done ? "#16A34A" : active ? "#D97706" : (owned ? "#86EFAC" : "#D1D5DB");
                      // Black/gray emphasis: stages where goods are OURS render in black;
                      // the supplier's / client's portions render gray.
                      const textColor = owned ? "#111827" : "#9CA3AF";
                      const labelText = s.label || standardStageLabel(s.kind); // v6.34.9: prefer the real (shipment-derived) stage label
                      const last = i === journey.length - 1;
                      return (
                        <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", paddingBottom: last ? 0 : 16, position: "relative" }}>
                          {!last && <div style={{ position: "absolute", left: 7, top: 18, bottom: 0, width: 2, background: done ? "#16A34A" : "#E5E7EB" }} />}
                          <div style={{ width: 16, height: 16, borderRadius: "50%", background: dotColor, flexShrink: 0, marginTop: 2, border: "2px solid #fff", boxShadow: "0 0 0 1px " + dotColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 900 }}>{done ? "✓" : ""}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                              <span style={{ fontSize: 13, fontWeight: owned ? 700 : 500, color: textColor }}>{labelText}{active && <span style={{ color: "#D97706", fontWeight: 700, fontSize: 10, marginLeft: 6 }}>● IN PROGRESS</span>}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, color: owned ? "#16A34A" : "#9CA3AF", background: owned ? "#DCFCE7" : "#F3F4F6", padding: "1px 7px", borderRadius: 10, whiteSpace: "nowrap" }}>{tagText}</span>
                            </div>
                            <div style={{ fontSize: 11, marginTop: 2, color: done ? "#9CA3AF" : active ? "#D97706" : "#9CA3AF" }}>
                              {done
                                ? `${formatDMY(s.actualDate || s.plannedDate) || ""} · done`
                                : active
                                  ? `${s.plannedDate ? "planned " + formatDMY(s.plannedDate) : "date TBA"} · in progress`
                                  : `${s.plannedDate ? "planned " + formatDMY(s.plannedDate) : "date TBA"}`}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ); })()}

              {/* Customs overlay (v6.1d) — independent clearance events, editable */}
              {(() => {
                const kinds = customsStagesForLot(lot, shipments);
                if (kinds.length === 0) return null;
                return (
                  <Card style={{ marginBottom: 16 }}>
                    <SectionTitle>CUSTOMS CLEARANCE</SectionTitle>
                    {/* v6.51.0 (user ruling): was a signpost saying "managed in shipments".
                        Now it SUMMARISES the clearance facts already held on the shipments
                        that carried this lot, so the lot answers "was this cleared, by whom,
                        under what reference, at what cost" without opening each shipment. */}
                    {(() => {
                      const carrying = (shipments || []).filter((s: any) => s && s.status !== "Cancelled"
                        && ((s.goods || []).some((g: any) => String(g.lotRef) === String(lot.number)) || (s.lotRefs || []).includes(lot.number)));
                      const withCustoms = carrying.filter((s: any) => (s.customs || {}).applies);
                      const customsCostPLN = (lot.costs || [])
                        .filter((c: any) => String(c.type || "").toLowerCase().includes("customs"))
                        .reduce((a: number, c: any) => a + (parseFloat(c.pln) || 0), 0);
                      if (!withCustoms.length && !customsCostPLN) {
                        return <div style={{ fontSize: 12, color: "#94A3B8", lineHeight: 1.6 }}>
                          No customs clearance recorded on the shipments carrying this lot. Clearance is captured on the shipment (Shipments → <em>Customs clearance</em>) and summarised here.
                        </div>;
                      }
                      const ROLE: any = { our_broker: "our Polish broker", forwarder_abroad: "the forwarder abroad", t1_local_broker: "a local broker under T1", not_required: "no clearance required" };
                      const ST: any = { cleared: { t: "Cleared", c: "#059669", bg: "#DCFCE7" }, in_progress: { t: "Being cleared", c: "#B45309", bg: "#FEF3C7" }, pending: { t: "Not yet cleared", c: "#B91C1C", bg: "#FEE2E2" } };
                      const allCleared = withCustoms.every((s: any) => String((s.customs || {}).status) === "cleared");
                      return <div>
                        {/* one plain sentence first — the answer most people want */}
                        <div style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.6, marginBottom: 10 }}>
                          {withCustoms.length === 0
                            ? "No customs clearance was needed for the shipments carrying this lot."
                            : allCleared
                              ? <>These goods have been <strong style={{ color: "#059669" }}>cleared through customs</strong>{withCustoms.length > 1 ? ` on all ${withCustoms.length} shipments that carried them` : ""}.</>
                              : <>Customs is <strong style={{ color: "#B45309" }}>not yet complete</strong> for these goods — see the shipment(s) below.</>}
                        </div>
                        {withCustoms.map((s: any, i: number) => {
                          const c = s.customs || {};
                          const st = ST[String(c.status || "pending")] || ST.pending;
                          const broker = (contacts || []).find((x: any) => String(x.id) === String(c.brokerId || s.brokerId));
                          const who = ROLE[c.role] || "";
                          // v6.58.0: role "not_required" used to concatenate into
                          // "Cleared by no clearance required (broker name)" — nonsense.
                          // v6.60.0: the shared summary replaces this ad-hoc
                          // concatenation, so one sentence is produced the same
                          // way everywhere and cannot contradict itself.
                          const shared = customsSummary(c, broker?.name);
                          const sentence = shared || (c.role === "not_required" ? "No customs clearance was required for this shipment" : [
                            who ? `Cleared by ${who}` : "",
                            broker?.name ? `(${broker.name})` : "",
                            c.place ? `at ${c.place}` : "",
                            c.t1Transit ? "· moved under T1 transit" : "",
                            c.entryRef ? `· entry ${c.entryRef}` : "",
                          ].filter(Boolean).join(" "));
                          return <div key={i} style={{ padding: "8px 0", borderTop: i ? "1px solid #F1F5F9" : "none", fontSize: 12 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
                              <span style={{ fontWeight: 700 }}>{s.number}</span>
                              <span style={{ background: st.bg, color: st.c, borderRadius: 999, padding: "1px 9px", fontSize: 10.5, fontWeight: 800 }}>{st.t}</span>
                            </div>
                            <div style={{ color: "#64748B", lineHeight: 1.5 }}>{sentence || "No clearance details recorded on this shipment."}</div>
                          </div>;
                        })}
                        <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid #E5E7EB", fontSize: 12, color: "#334155", lineHeight: 1.55 }}>
                          {customsCostPLN > 0
                            ? <>Customs and duty cost included in this lot's landed cost: <strong>{customsCostPLN.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} PLN</strong>. It is already part of the cost of goods used in every sale from this lot.</>
                            : <span style={{ color: "#94A3B8" }}>No customs cost has been allocated to this lot.</span>}
                        </div>
                      </div>;
                    })()}
                  </Card>
                );
              })()}

              {/* Inspections (v6.2) — recordable at any stage */}
              {season && <LotWorkbench lot={lot} shipments={shipments} inspections={season.inspections} claims={season.claims || []} orders={liveSOs} settlements={season.settlements || []} contacts={contacts} />}
              {season && <SeasonActions lot={lot} {...season} />}
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle right={<button onClick={onInspect} style={{ fontSize: 11, padding: "4px 10px", border: "1px solid #0E7490", background: "#fff", color: "#0E7490", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>+ Record inspection</button>}>INSPECTIONS{(lot.inspections || []).length ? ` (${lot.inspections.length})` : ""}</SectionTitle>
                {(lot.inspections || []).length === 0 && <div style={{ fontSize: 12, color: "#AAA" }}>No inspections recorded. Record one when goods are checked on arrival, in storage, by a client, or at customs.</div>}
                {([...(lot.inspections || []), ...((seasonInspections || []).filter((x: any) => String(x.lotNumber) === String(lot.number)).map((x: any) => ({ date: x.date, context: `${x.stage} — quality inspection`, outcome: x.verdict, findings: `defects ${inspectionTotals(x).totalPct}%: ` + ((x.defects || []).map((d: any) => `${d.name} ${d.pct}%`).join(", ") || "none") + (x.observations ? ` — ${x.observations}` : "") + (x.inspector ? ` · ${x.inspector}` : ""), lossKg: 0, creditNote: null, _season: true })))]).map((ins, i) => {
                  const ctx = INSPECTION_CONTEXTS.find(c => c.code === ins.context);
                  const out = INSPECTION_OUTCOMES.find(o => o.code === ins.outcome);
                  const bad = ins.outcome !== "ok";
                  return (
                    <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid #F3F4F6" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#111" }}>🔍 {ctx ? ctx.label.split(" (")[0] : ins.context}</div>
                        <span style={{ fontSize: 10.5, color: "#AAA" }}>{ins.date}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: bad ? "#B91C1C" : "#16A34A", fontWeight: 600, marginTop: 3 }}>
                        {out ? out.label : ins.outcome}{ins.lossKg ? ` · −${fmtNum(ins.lossKg)} kg` : ""}
                      </div>
                      {ins.findings && <div style={{ fontSize: 11.5, color: "#666", marginTop: 3 }}>{ins.findings}</div>}
                      {ins.creditNote && <div style={{ fontSize: 11, color: "#92400E", marginTop: 4, background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 6, padding: "4px 8px", display: "inline-block" }}>Proposed credit note: {fmtNum(ins.creditNote.amount)} {ins.creditNote.currency} (to be issued in Invoicing)</div>}
                    </div>
                  );
                })}
              </Card>

              {/* Movement history */}
              <Card style={{ marginBottom: 16 }}>
                {(() => {
                  // Safeguards 7a: the recall report — hidden, print-only.
                  const co = (() => { try { return JSON.parse(window.localStorage.getItem("marianna-erp:v2:company") || "{}"); } catch { return {}; } })();
                  const companyName = co.name || "MARIANNA";
                  const companyAddress = co.address || "";
                  const companyNip = co.nip || "";
                  const t = buildTraceTree(lot, { contacts, pos: tracePOs, orders: liveSOs, shipments, invoices: traceInvoices }, localTodayISO());
                  const cell = { border: "1px solid #999", padding: "4px 6px", fontSize: 11 } as any;
                  const hd = { ...cell, background: "#F3F4F6", fontWeight: 700 } as any;
                  return (
                    <div id="lot-trace-doc" style={{ position: "absolute", left: -10000, top: 0, width: 780, background: "#fff", color: "#111", fontFamily: "Arial, Calibri, sans-serif", fontSize: 12, padding: 24 }}>
                      {/* v6.99.30 (owner 15 Sept): the recall document — real logo, its own number, three sections in the owner's order */}
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, borderBottom: "2px solid #111", paddingBottom: 10, marginBottom: 12 }}>
                        <PrintLogo width={200} />
                        <div style={{ marginLeft: "auto", textAlign: "right", fontSize: 9.5, color: "#444" }}>{companyName}<br />{companyAddress}<br />{companyNip ? `NIP ${companyNip}` : ""}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                        <div style={{ fontSize: 17, fontWeight: 800 }}>TRACEABILITY / RECALL REPORT</div>
                        <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "ui-monospace, Menlo, monospace" }}>{traceNo}</div>
                      </div>
                      <div style={{ marginBottom: 12, fontSize: 11, color: "#444" }}>Lot / Partia: <b>{t.lot.number}</b> · generated / wygenerowano {t.generatedAt}{userName ? ` · ${userName}` : ""}</div>

                      <div style={{ fontWeight: 800, margin: "10px 0 4px" }}>1. PURCHASE / ZAKUP</div>
                      <table><tbody>
                        {[["PO / Zamówienie", t.origin.poNumber || "—"], ["Lot / Partia", t.lot.number], ["Supplier / Dostawca", t.origin.supplier || "—"], ["Origin / Pochodzenie", t.origin.origin || "—"],
                          ["Product / Produkt", `${t.lot.product}${t.lot.variety ? ` — ${t.lot.variety}` : ""}`], ["Packaging / Opakowanie", t.lot.packaging || "—"], ["Size / Kaliber", t.lot.size || "—"],
                          ["Quantity received / Ilość przyjęta", `${Number(t.lot.receivedKg || 0).toLocaleString("pl-PL")} kg`],
                          ["Still in stock / Na stanie", `${Number(t.lot.physicalKg || 0).toLocaleString("pl-PL")} kg${(t.lot.inStockII || 0) > 0 ? ` — class I ${Number(t.lot.inStockI || 0).toLocaleString("pl-PL")} kg · class II ${Number(t.lot.inStockII || 0).toLocaleString("pl-PL")} kg` : ""}`]
                        ].map(([k, v]: any) => <tr key={k}><td style={{ ...cell, width: 230, background: "#F9FAFB" }}>{k}</td><td style={cell}>{v}</td></tr>)}
                      </tbody></table>

                      <div style={{ fontWeight: 800, margin: "14px 0 4px" }}>2. SHIPMENTS / TRANSPORTY ({t.shipments.length})</div>
                      <table><tbody>
                        <tr>{["Shipment / Transport", "Loading place / Miejsce załadunku", "Loading date", "Unloading place / Miejsce rozładunku", "Unloading date", "Carrier / Przewoźnik"].map(h => <th key={h} style={hd}>{h}</th>)}</tr>
                        {!t.shipments.length && <tr><td style={cell} colSpan={6}>— none yet / brak —</td></tr>}
                        {t.shipments.map((s: any) => <tr key={s.number}>{[s.number, s.from || "—", s.loadedAt || "—", s.to || "—", s.unloadedAt || "—", s.carrier || "—"].map((v: any, k: number) => <td key={k} style={cell}>{v}</td>)}</tr>)}
                      </tbody></table>

                      <div style={{ fontWeight: 800, margin: "14px 0 4px" }}>3. SOLD TO / SPRZEDANO ({t.sales.length})</div>
                      <table><tbody>
                        <tr>{["SO", "Client / Klient", "Qty kg", "Incoterm", "Delivery place / Miejsce dostawy", "Delivery date"].map(h => <th key={h} style={hd}>{h}</th>)}</tr>
                        {!t.sales.length && <tr><td style={cell} colSpan={6}>— none yet / brak —</td></tr>}
                        {t.sales.map((s: any) => <tr key={s.soNumber}>{[s.soNumber, s.client, Number(s.qtyKg || 0).toLocaleString("pl-PL"), s.incoterm || "—", s.destination || "—", s.deliveredAt || "—"].map((v: any, k: number) => <td key={k} style={cell}>{v}</td>)}</tr>)}
                      </tbody></table>
                      <div style={{ fontWeight: 700, margin: "10px 0 4px", fontSize: 11 }}>Related invoices / Powiązane faktury ({t.invoices.length})</div>
                      <table><tbody>
                        <tr>{["Invoice / Faktura", "Kind", "Counterparty / Kontrahent", "Gross"].map(h => <th key={h} style={hd}>{h}</th>)}</tr>
                        {!t.invoices.length && <tr><td style={cell} colSpan={4}>— none yet / brak —</td></tr>}
                        {t.invoices.map((iv: any) => <tr key={iv.number}>{[iv.number, iv.kind || "—", iv.counterparty || "—", iv.gross || "—"].map((v: any, k: number) => <td key={k} style={cell}>{v}</td>)}</tr>)}
                      </tbody></table>
                      <div style={{ marginTop: 16, fontSize: 9.5, color: "#666" }}>Issued from MARIANNA ERP · {traceNo} · this report is recorded in the audit trail.</div>
                    </div>
                  );
                })()}
                {(() => {
                  // Batch 6c (BP-33): one place for the lot's quality story —
                  // claims, claimed/damaged totals, quality movements.
                  const claims = lotClaims || [];   // v6.48.0: from the claims store
                  const qmoves = (lot.movements || []).filter((m: any) => ["DAMAGE", "RECLASS", "CLAIM"].includes(m.type));
                  if (!claims.length && !qmoves.length && !(lot.claimedKg > 0) && !(lot.damagedKg > 0)) return null;
                  const chip = (s: string) => ({ Draft: "#94A3B8", Issued: "#B45309", Accepted: "#15803D", Rejected: "#DC2626", Settled: "#4338CA" } as any)[s] || "#94A3B8";
                  return (
                    <div style={{ border: "1px solid #FDE68A", background: "#FFFBEB", borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: claims.length ? 8 : 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "#B45309", letterSpacing: "0.04em" }}>QUALITY & CLAIMS</div>
                        {lot.claimedKg > 0 && <span style={{ fontSize: 10.5, color: "#B45309" }}>claimed {Number(lot.claimedKg).toLocaleString("pl-PL")} kg</span>}
                        {lot.damagedKg > 0 && <span style={{ fontSize: 10.5, color: "#DC2626" }}>damaged {Number(lot.damagedKg).toLocaleString("pl-PL")} kg</span>}
                        {qmoves.length > 0 && <span style={{ fontSize: 10.5, color: "#94A3B8" }}>· {qmoves.length} quality movement{qmoves.length !== 1 ? "s" : ""} in the history below</span>}
                      </div>
                      {claims.map((c: any) => (
                        <div key={String(c.id)} onClick={() => onOpenClaim && onOpenClaim(lot)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 7, background: "#fff", border: "1px solid #FDE68A", marginBottom: 4, cursor: onOpenClaim ? "pointer" : "default", fontSize: 12 }}>
                          <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 800, color: "#B45309" }}>{c.number || "draft"}</span>
                          <span style={{ color: "#64748B" }}>{c.date}</span>
                          <span>{c.defectType || "defect"} · {c.defectPct || 0}%{c.affectedKg ? ` · ${Number(c.affectedKg).toLocaleString("pl-PL")} kg` : ""}</span>
                          <span style={{ marginLeft: "auto", fontWeight: 700 }}>{c.requestedCreditEUR ? `€${Number(c.requestedCreditEUR).toLocaleString("pl-PL", { minimumFractionDigits: 2 })}` : ""}</span>
                          {c.status === "Accepted" && c.acceptedEUR ? <span style={{ fontSize: 10.5, color: "#15803D" }}>accepted €{Number(c.acceptedEUR).toLocaleString("pl-PL", { minimumFractionDigits: 2 })}</span> : null}
                          <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: chip(c.status), borderRadius: 999, padding: "1px 8px" }}>{c.status || "Draft"}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <SectionTitle>MOVEMENT HISTORY ({lot.movements.length})</SectionTitle>
                {lot.movements.length === 0 && (
                  <div style={{ fontSize: 12, color: "#AAA", padding: "12px 0" }}>No movements yet — this lot is still in "Expected" status.</div>
                )}
                {lot.movements.length > 0 && (
                  <div style={{ position: "relative" }}>
                    <div style={{ position: "absolute", left: 11, top: 14, bottom: 14, width: 1, background: "#E5E7EB" }} />
                    {lot.movements.map((m, i) => {
                      const mt = MOVEMENT_TYPES[m.type] || { color: "#888", label: m.type, icon: "·" };
                      const fromLoc = locById(m.fromId);
                      const toLoc = locById(m.toId);
                      const isMove = m.fromId !== m.toId;
                      const isVoided = !!m.voided;
                      const canVoid = !isVoided && ["TRANSFER", "DAMAGE", "CLAIM", "RECLASS"].includes(m.type); // manual events only; IN/SHIP_OUT/REVERSAL are system-driven
                      return (
                        <div key={i} style={{ display: "flex", gap: 14, paddingBottom: 14, position: "relative", opacity: isVoided ? 0.6 : 1 }}>
                          <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#fff", border: `2px solid ${isVoided ? "#DC2626" : mt.color}`, color: isVoided ? "#DC2626" : mt.color, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, zIndex: 1 }}>{isVoided ? "✕" : mt.icon}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                              <div style={{ fontSize: 12.5, textDecoration: isVoided ? "line-through" : "none", color: isVoided ? "#B91C1C" : undefined }}>
                                <span style={{ fontWeight: 600, color: isVoided ? "#B91C1C" : mt.color }}>{mt.label}</span>
                                <span style={{ color: isVoided ? "#B91C1C" : "#444", marginLeft: 6 }}>· {fmtNum(m.qtyKg)} kg</span>
                                {isMove && <span style={{ color: isVoided ? "#B91C1C" : "#666", marginLeft: 6 }}>· {fromLoc?.name} → {toLoc?.name}</span>}
                                {isVoided && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: "#B91C1C", background: "#FEE2E2", border: "1px solid #FECACA", borderRadius: 5, padding: "1px 6px" }}>VOIDED</span>}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                                <span style={{ fontSize: 11, color: "#AAA" }}>{formatDMY(m.date)}</span>
                                {!isVoided && onEditMovement && <button onClick={() => onEditMovement(m)} title="Edit movement" style={{ fontSize: 10.5, padding: "2px 7px", border: "1px solid #2563EB", background: "#fff", borderRadius: 5, cursor: "pointer", color: "#2563EB", fontWeight: 600 }}>Edit</button>}
                                {canVoid && onVoidMovement && <button onClick={() => onVoidMovement(m.id)} title="Void this entry — kept in the record but removed from stock" style={{ fontSize: 10.5, padding: "2px 7px", border: "1px solid #FECACA", background: "#fff", borderRadius: 5, cursor: "pointer", color: "#DC2626", fontWeight: 600 }}>Void</button>}
                              </div>
                            </div>
                            {m.note && <div style={{ fontSize: 11.5, color: "#888", marginTop: 2, textDecoration: isVoided ? "line-through" : "none" }}>{m.note}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* Notes */}
              {lot.notes && (
                <Card>
                  <SectionTitle>NOTES</SectionTitle>
                  <div style={{ fontSize: 12.5, color: "#444", lineHeight: 1.5 }}>{lot.notes}</div>
                </Card>
              )}
            </div>

            {/* Right column */}
            <div>
              {/* Linked docs */}
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle>LINKED DOCUMENTS</SectionTitle>
                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#888", marginBottom: 3 }}>PURCHASE ORDER</div>
                    {lot.poRef ? (
                      <div style={{ padding: "6px 10px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 6, fontSize: 12.5, color: "#1D4ED8", fontWeight: 600, fontFamily: "ui-monospace, Menlo, monospace", display: "inline-block" }}>{lot.poRef}</div>
                    ) : <span style={{ fontSize: 12, color: "#AAA" }}>—</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#888", marginBottom: 3 }}>SALES ORDERS ({soRefsFor(lot, liveSOs, shipments).length})</div>
                    {soRefsFor(lot, liveSOs, shipments).length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {soRefsFor(lot, liveSOs, shipments).map(s => (
                          <div key={s.number} title={`${s.clientName || ""}${s.status && s.status !== "—" ? ` · ${s.status}` : ""}${s.viaShipment ? ` · linked via shipment ${s.viaShipment}` : ""}`} style={{ padding: "4px 8px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 5, fontSize: 11, color: "#15803D", fontWeight: 600, fontFamily: "ui-monospace, Menlo, monospace" }}>
                            {s.number}{s.viaShipment ? <span style={{ fontSize: 9, color: "#16A34A", fontWeight: 700, marginLeft: 4 }}>via {s.viaShipment}</span> : null}
                          </div>
                        ))}
                      </div>
                    ) : <span style={{ fontSize: 12, color: "#AAA" }}>Not yet linked</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#888", marginBottom: 3 }}>CURRENT LOCATION</div>
                    <LocationPill locationId={lot.locationId} lot={lot} />
                    {lot.directFlow && <div style={{ fontSize: 11, color: "#92400E", marginTop: 4 }}>{lot.destinationText || "Direct destination"}</div>}
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#888", marginBottom: 3 }}>DATES</div>
                    <div style={{ fontSize: 12, color: "#444" }}>
                      {lot.directFlow ? (
                        <>
                          Loading / pickup: <span style={{ fontWeight: 500 }}>{lot.loadingDate || "—"}</span><br />
                          ETA destination: <span style={{ fontWeight: 500 }}>{lot.arrivalDate || "—"}</span><br />
                          <span style={{ color: "#92400E", fontSize: 11 }}>Direct flow · not received into our warehouse</span>
                        </>
                      ) : (
                        <>
                          {/* v6.51.0 (user ruling): the production date is the producer's
                              harvest/packing date — nothing in the current workflow captures
                              it, so it was blank on every lot. Hidden from the UI; the field
                              stays in the data model for when producer documents feed it. */}
                          {lot.productionDate ? <>Production: <span style={{ fontWeight: 500 }}>{lot.productionDate}</span><br /></> : null}
                          Arrival: <span style={{ fontWeight: 500 }}>{lot.arrivalDate || "—"}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Card>

              {/* Cost breakdown */}
              <Card>
                <SectionTitle>COST BREAKDOWN</SectionTitle>
                {(lot.costs || []).map((c, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 0", borderBottom: i < lot.costs.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                    <div>
                      <div style={{ fontSize: 12, color: "#444" }}>{c.label}</div>
                      <div style={{ fontSize: 10.5, color: "#2563EB", fontFamily: "ui-monospace, Menlo, monospace", marginTop: 1 }}>{c.source}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{fmtMoney(c.pln)}</div>
                      {c.currency && c.currency !== "PLN" && (
                        <div style={{ fontSize: 10, color: "#888", marginTop: 1 }}>({fmtMoney(c.amount, c.currency)})</div>
                      )}
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: 8, padding: "10px 0 0", borderTop: "2px solid #E5E7EB", display: "flex", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>Total cost</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>{fmtMoney(total)}</div>
                </div>
                <div style={{ marginTop: 8, padding: "10px 12px", background: "#F9FAFB", borderRadius: 8, display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11.5, color: "#666" }}>Cost per kg (PLN)</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#111", fontFamily: "ui-monospace, Menlo, monospace" }}>{fmtMoney(cpk)}/kg</span>
                </div>
                <div style={{ marginTop: 10, fontSize: 10.5, color: "#AAA", fontStyle: "italic", lineHeight: 1.5 }}>
                  Costs accumulate as invoices arrive. Storage allocation (WINV) recalculates monthly.
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN — LIST VIEW + ROUTER ──────────────────────────────────────────────

// ── Batch 6a (BP-55b): Producer Claim modal — mirrors the Claim Request Form ──
// v6.79.0 (W-2): the legacy lot-side Claim Request Form was retired — claims are
// one document type with one numbering scheme in the Claims module (D-13).

export default function Inventory({ initialSelectedNumber = "", lots: extLots, setLots: extSetLots, allOrders: extOrders, contacts: extContacts = [], shipments: extShipments = [], setShipments: extSetShipments = null, pos: extPOs = [], invoices: extInvoices = [], setInvoices: extSetInvoices = null, financeNotes: extFinanceNotes = [], setFinanceNotes: extSetFinanceNotes = null, claims: extClaims = [], onStartClaim = null , inspections: extInspections = [], setInspections: extSetInspections = null, defectCatalogue: extDefectCatalogue = [], stockCounts: extStockCounts = [], setStockCounts: extSetStockCounts = null , poSettlements: extSettlements = [] }: any = {}) {
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
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // "In our possession" = anything that hasn't physically left us yet
    const inPossessionStatuses = new Set(["Expected", "In Transit", "Customs", "In Stock"]);
    const base = lots.filter(l => {
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
          <SmallButton onClick={() => exportRowsToXlsx(`stock_on_hand_${xlsStamp()}`, filtered, [{ key: "number", label: "Lot" }, { key: "product", label: "Product" }, { key: "variety", label: "Variety" }, { key: "size", label: "Calibre" }, { key: "quality", label: "Class" }, { key: "status", label: "Status" }, { key: "locationId", label: "Location", fmt: (v: any) => (locById(v) || {}).name || "" }, { key: "expectedKg", label: "Expected kg" }, { key: "receivedKg", label: "Received kg" }, { key: "physicalKg", label: "Physical kg" }, { key: "reservedKg", label: "Reserved kg" }, { key: "grades", label: "Grades I/II/waste", fmt: (v: any) => v ? `${v.I || 0} / ${v.II || 0} / ${v.waste || 0}` : "" }, { key: "poRef", label: "PO" }, { key: "arrivalDate", label: "Arrived" }, { key: "costs", label: "Landed cost PLN", fmt: (v: any) => (v || []).reduce((s: number, c: any) => s + (Number(c.pln) || 0), 0) }], "Stock")} title="v6.99.0: exports the rows as filtered, columns as shown">⬇ Excel</SmallButton>
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
          <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 60px 110px 1fr 140px 130px 120px", padding: "10px 18px", background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
            {/* v6.58.0: "LINKED" renamed LINKED DOCUMENTS; the quantity column now
                 states which figure is which rather than a bare pair. */}
            {["LOT", "PRODUCT", "KL.", "STATUS", "LOCATION & FLOW", "QUANTITY", "VALUE PLN", "LINKED DOCUMENTS"].map((h, i) => (
              <div key={i} style={{ fontSize: 10, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em" }}>{h}</div>
            ))}
          </div>
          {filtered.length === 0 && <div style={{ padding: "40px 20px", textAlign: "center", color: "#AAA", fontSize: 13 }}>No lots match the current filters.</div>}
          {filtered.map((l, idx) => {
            const cpk = costPerKg(l);
            const res = lotReservations(l, liveSOs, { lots, shipments });
            const soList = soRefsFor(l, liveSOs, shipments);
            return (
              <div key={l.id} style={{ display: "grid", gridTemplateColumns: "150px 1fr 60px 110px 1fr 140px 130px 120px", padding: "12px 18px", borderBottom: idx < filtered.length - 1 ? "1px solid #F3F4F6" : "none", alignItems: "center", background: "#fff", cursor: "pointer" }}
                onClick={() => { setSelectedId(l.id); setView("detail"); }}
                onMouseEnter={e => e.currentTarget.style.background = "#FAFAFA"}
                onMouseLeave={e => e.currentTarget.style.background = "#fff"}
              >
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#2563EB", fontFamily: "ui-monospace, Menlo, monospace" }}>{l.number}</div>
                  <div style={{ marginTop: 3 }}><VarianceBadge expected={l.expectedKg} actual={l.receivedKg} /></div>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#111" }}>{l.product}{l.variety ? " — " + l.variety : ""}</div>
                  {/* v6.58.0: the supplier belongs here — "whose fruit is this"
                      is asked far more often than the packaging. */}
                  {(() => { const po = (extPOs || []).find((x: any) => String(x.number) === String(l.poRef));
                    const sup = po?.supplier?.name || l.supplierName || "";
                    return sup ? <div style={{ fontSize: 11.5, color: "#475569", fontWeight: 600 }}>{sup}</div> : null; })()}
                  <div style={{ fontSize: 11, color: "#AAA" }}>{l.size || "—"} · {l.origin || "—"} · {l.packaging}</div>
                  {(() => { const d = lotArrivalDate(l); const age = lotAgeDays(l); return d ? (
                    <div style={{ fontSize: 10.5, marginTop: 2 }}><span style={{ color: "#94A3B8" }}>arrived {d}</span> <span style={{ fontWeight: 700, color: ageColor(age as number) }}>· {age} d</span></div>
                  ) : null; })()}
                </div>
                <div><QualityBadge quality={l.quality} /></div>
                <div><StatusBadge status={l.status} /></div>
                <div>
                  <LocationPill locationId={l.locationId} lot={l} />
                  <div style={{ marginTop: 3 }}><LotDirectionBadge lot={l} shipments={shipments} orders={liveSOs} pos={extPOs} compact /></div>
                </div>
                <div>
                  {/* v6.58.0: lead with the LOT'S OWN QUANTITY, whatever its
                      booked/reserved/sold state. Previously a fully reserved lot
                      showed "0 / 0" plus "19 422 reserved · 1 SO", which never
                      answered "how much is in this lot". */}
                  {(() => {
                    const onHand = parseNum(l.physicalKg, 0) || parseNum(l.receivedKg, 0) || parseNum(l.expectedKg, 0);
                    const isExpected = !parseNum(l.physicalKg, 0) && !parseNum(l.receivedKg, 0) && parseNum(l.expectedKg, 0) > 0;
                    return <>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{fmtNum(onHand)} kg{isExpected ? <span style={{ fontSize: 10, color: "#B45309", fontWeight: 600 }}> expected</span> : null}</div>
                      <div style={{ fontSize: 10.5, color: "#64748B" }}>{fmtNum(res.liveAvailable)} free · {fmtNum(res.totalReserved)} reserved</div>
                    </>;
                  })()}
                  {l.damagedKg > 0 && <div style={{ fontSize: 10.5, color: "#DC2626", fontWeight: 600 }}>{fmtNum(l.damagedKg)} damaged</div>}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{fmtMoney(valueInStock(l)).replace(" PLN", "")}</div>
                  <div style={{ fontSize: 10, color: "#AAA" }}>{fmtMoney(cpk)}/kg</div>
                </div>
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
