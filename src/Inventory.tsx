import React, { useState, useMemo } from "react";
import { nextSettlementNumber, buildCommissionInvoiceDraft } from "./settlement.domain";
import { computeClaim, buildClaimNote } from "./claim.domain";
import { nextClaimNumber, blankClaim, claimsForLot } from "./claims.domain";
import { buildTraceTree } from "./trace.domain";
import { fmtNum } from "./format";
import { Card, Lbl, useConfirm, DocRef, cancelledDocSet } from "./ui";
import { recomputeLotFromMovements as domainRecomputeLot } from "./inventory.domain";
import { lotReservationsForStock, productsMatch as domainProductsMatch, soClientName } from "./salesOrders.domain";
import { nextId } from "./ids";
import { defaultFxRate } from "./fx";
import { LOCATIONS as SHARED_LOCATIONS, counterpartyLocations } from "./locations";
import { localTodayISO, formatDMY } from "./dates";
import { computeLotWarehouseCharges } from "./warehouseCharges";
import { shipmentTradeDirection, MOVEMENT_LABELS, ownershipAtPoint } from "./tradeFlow.domain";
import { computeLotSettlement, currentCommissionPct, settlementCostComponents } from "./consignment";
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
const LOCATIONS = SHARED_LOCATIONS.map(l => ({ ...l, type: l.legacyType }));
// v6.18.4 (P0-4): snapshot + live counterparty addresses, deduped, so movement
// pickers see a counterparty added this session without a browser refresh.
function mergedLocations(contacts: any[]) {
  const live = counterpartyLocations(contacts || []).map((l: any) => ({ ...l, type: l.legacyType }));
  const byId = new Map<string, any>();
  [...LOCATIONS, ...live].forEach((l: any) => { if (!byId.has(String(l.id))) byId.set(String(l.id), l); });
  return [...byId.values()];
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
    const fromName = nameOf(lg.fromLocationId, lg.fromCustom);
    const toName = nameOf(lg.toLocationId, lg.toCustom);
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
    const poRefs = sh.poRefs || [];
    const soRefs = sh.soRefs || [];
    return (lot.number && lotRefs.includes(lot.number))
        || (lot.poRef && poRefs.includes(lot.poRef))
        || (lot.soRef && soRefs.includes(lot.soRef));
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

function locById(id) { return LOCATIONS.find(l => String(l.id) === String(id)); }

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
    const carriesLot = (sh.lotRefs || []).includes(lot.number)
      || (sh.goods || []).some(g => g.lotRef === lot.number);
    if (!carriesLot) return;
    const shipmentSONumbers = uniqStrings([
      ...(sh.soRefs || []),
      ...((sh.goods || []).filter(g => g.lotRef === lot.number).map(g => g.soRef)),
    ]);
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
function LotDirectionBadge({ lot, shipments = [], orders = [], compact = false }: any) {
  const shs = shipmentsForLot(lot, shipments);
  // Prefer an explicit shipment direction; else derive from the lot's PO + governing SO.
  let dir = "";
  // v6.43.0 (test-round #5b): prefer an explicit direction on the shipment header,
  // then on THIS lot's goods row (where direct-export deals record EXPORT), before
  // any fallback — so a CIF/CFR export is never mislabelled "Import".
  for (const sh of shs) {
    const d = sh?.tradeDirection;
    if (d && MOVEMENT_LABELS[d]) { dir = d; break; }
    const g = (sh?.goods || []).find((x: any) => String(x.lotRef || "") === String(lot.number) && x.tradeDirection && MOVEMENT_LABELS[x.tradeDirection]);
    if (g) { dir = g.tradeDirection; break; }
  }
  if (!dir && shs.length) {
    // last resort: derive from the shipment context (may still fall back to Import
    // for genuinely inbound flows with no other signal).
    dir = shipmentTradeDirection(shs[0], null);
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
  const MOVEMENT_MODE_TYPES = ["TRANSFER"];
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
                <Sel value={toId} onChange={e => setToId(parseInt(e.target.value))}>
                  {moveLocs.map((l: any) => <option key={l.id} value={l.id}>{locType(l.type).icon} {l.name}</option>)}
                </Sel>
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
  @page { size: A4; margin: 12mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: Arial, Calibri, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table { border-collapse: collapse; width: 100%; page-break-inside: avoid; }
  tr { page-break-inside: avoid; }
</style></head><body>${node.outerHTML}</body></html>`;
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
  const calc = computeLotSettlement(lot, orders, parseFloat(pct) || 0, extra);
  const fmt = (x: number) => x.toLocaleString("pl-PL", { minimumFractionDigits: 2 }) + " PLN";
  const status = st.status || "None";
  const prodInvNum = parseFloat(prodInvPLN);
  const invVariance = isFinite(prodInvNum) && prodInvNum > 0 ? Math.round((prodInvNum - calc.netPLN) * 100) / 100 : null;

  function save(nextStatus: string) {
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
              <input type="date" value={date} onChange={e => setDate(e.target.value)} max={localTodayISO()} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
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
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
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
          <div><label style={lblStyle}>Return date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} max={localTodayISO()} style={inpStyle} /></div>
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

function LotDetail({ lot, onBack, onMove, onQualityIssue, onEditMovement, onDeleteMovement, onVoidMovement, onDelete, onInspect, onReturn, liveSOs, shipments, allLots = [], contacts = [], onRecordSorting, onOpenSettlement, onOpenClaim = null, tracePOs = [], traceInvoices = [], lotClaims = [] }: any) {
  const res = lotReservations(lot, liveSOs, { lots: allLots, shipments });
  const cpk = costPerKg(lot);
  const total = totalCost(lot);
  const value = valueInStock(lot);
  const variance = (lot.receivedKg || 0) - (lot.expectedKg || 0);
  const shippedOutKg = Math.max(0, (lot.receivedKg || 0) - (lot.physicalKg || 0) - (lot.damagedKg || 0));

  // Qty stripe segments — show the lifecycle of the receivedKg
  const segments = [
    { key: "Available",   kg: res.liveAvailable,   color: "#16A34A" },
    { key: "Reserved",    kg: res.totalReserved,   color: "#7C3AED" },
    { key: "Shipped out", kg: shippedOutKg,        color: "#2563EB" },
    { key: "Damaged",     kg: lot.damagedKg || 0,  color: "#DC2626" },
  ].filter(s => s.kg > 0);
  const totalKg = segments.reduce((s, x) => s + x.kg, 0);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#2563EB", fontWeight: 500 }}>← Inventory</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <button onClick={onMove} style={{ padding: "5px 14px", borderRadius: 7, border: "none", background: "#16A34A", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>+ Record movement</button>
          <button onClick={onQualityIssue} style={{ padding: "5px 14px", borderRadius: 7, border: "none", background: "#DC2626", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>⚠ Record quality issue</button>
          {(lot.movements || []).some((m: any) => m.type === "SHIP_OUT") && (
            <button onClick={onReturn} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #7C3AED", background: "#fff", color: "#7C3AED", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>↩ Return to warehouse</button>
          )}
          <button onClick={onDelete} style={{ padding: "5px 12px", borderRadius: 7, border: "none", color: "#fff", background: "#DC2626", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Delete</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <StatusBadge status={lot.status} />
                <QualityBadge quality={lot.quality} />
                <VarianceBadge expected={lot.expectedKg} actual={lot.receivedKg} />
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#111", fontFamily: "ui-monospace, Menlo, monospace", marginBottom: 4 }}>{lot.number}</div>
              <div style={{ fontSize: 14, color: "#444" }}>{lot.product}{lot.variety ? " — " + lot.variety : ""} · {lot.size || "—"} · {lot.origin || "—"} · {lot.packaging}</div>
              <div style={{ marginTop: 10 }}><LotDirectionBadge lot={lot} shipments={shipments} orders={liveSOs} /></div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#888" }}>Value of physical stock</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#111" }}>{fmtMoney(value)}</div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{fmtMoney(cpk)}/kg · received {fmtNum(lot.receivedKg)} kg</div>
            </div>
          </div>

          {/* Qty breakdown — v6.3.0 compact strip (PO-module density): figures + bar on one row */}
          <Card style={{ marginBottom: 12, padding: "12px 16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "110px repeat(5, minmax(72px, 1fr)) 1.5fr", gap: 10, alignItems: "center" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#AAA", letterSpacing: "0.05em" }}>QUANTITY<br />BREAKDOWN</div>
              <div><div style={{ fontSize: 9, color: "#888" }}>EXPECTED</div><div style={{ fontSize: 12.5, fontWeight: 600, color: "#555" }}>{fmtNum(lot.expectedKg)} kg</div></div>
              <div><div style={{ fontSize: 9, color: "#888" }}>RECEIVED</div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#111" }}>{fmtNum(lot.receivedKg)} kg</div></div>
              <div title="Live: physicalKg − reservations from pre-dispatch SOs"><div style={{ fontSize: 9, color: "#16A34A" }}>AVAILABLE</div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#16A34A" }}>{fmtNum(res.liveAvailable)} kg</div></div>
              <div title="From Confirmed/Reserved/Loading SOs"><div style={{ fontSize: 9, color: "#7C3AED" }}>RESERVED</div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#7C3AED" }}>{fmtNum(res.totalReserved)} kg</div></div>
              <div><div style={{ fontSize: 9, color: "#DC2626" }}>DAMAGED</div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#DC2626" }}>{fmtNum(lot.damagedKg)} kg</div></div>
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
                    Settlement status: <strong>{(lot.settlement && lot.settlement.status) || "None"}</strong>
                    {lot.settlement?.closedAt ? ` · closed ${lot.settlement.closedAt}` : lot.settlement?.sentAt ? ` · statement sent ${lot.settlement.sentAt}` : ""}
                  </div>
                </div>
                <button onClick={() => onOpenSettlement && onOpenSettlement(lot)} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: "#7C3AED", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {(lot.settlement?.status === "Closed") ? "View settlement" : "Open settlement"}
                </button>
                {onOpenClaim && (
                  <button onClick={() => onOpenClaim(lot)} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: "#B45309", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", marginLeft: 8 }} title="Quantify damage on this consignment and request a credit note from the producer">
                    {(lotClaims || []).length ? `Producer claim (${(lotClaims || []).length})` : "Producer claim"}
                  </button>
                )}
                <button onClick={() => printHtmlNodeInv("lot-trace-doc", `Trace-${lot.number}`)} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #0F766E", background: "#fff", color: "#0F766E", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", marginLeft: 8 }} title="One-click recall report: where this lot came from and everywhere it went — supplier, shipments, clients, invoices.">
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
                          const sentence = [
                            who ? `Cleared by ${who}` : "",
                            broker?.name ? `(${broker.name})` : "",
                            c.place ? `at ${c.place}` : "",
                            c.t1Transit ? "· moved under T1 transit" : "",
                            c.entryRef ? `· entry ${c.entryRef}` : "",
                          ].filter(Boolean).join(" ");
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
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle right={<button onClick={onInspect} style={{ fontSize: 11, padding: "4px 10px", border: "1px solid #0E7490", background: "#fff", color: "#0E7490", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>+ Record inspection</button>}>INSPECTIONS{(lot.inspections || []).length ? ` (${lot.inspections.length})` : ""}</SectionTitle>
                {(lot.inspections || []).length === 0 && <div style={{ fontSize: 12, color: "#AAA" }}>No inspections recorded. Record one when goods are checked on arrival, in storage, by a client, or at customs.</div>}
                {(lot.inspections || []).map((ins, i) => {
                  const ctx = INSPECTION_CONTEXTS.find(c => c.code === ins.context);
                  const out = INSPECTION_OUTCOMES.find(o => o.code === ins.outcome);
                  const bad = ins.outcome !== "ok";
                  return (
                    <div key={i} style={{ padding: "10px 0", borderBottom: i < lot.inspections.length - 1 ? "1px solid #F3F4F6" : "none" }}>
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
                  const t = buildTraceTree(lot, { pos: tracePOs, orders: liveSOs, shipments, invoices: traceInvoices }, localTodayISO());
                  const cell = { border: "1px solid #999", padding: "4px 6px", fontSize: 11 } as any;
                  const hd = { ...cell, background: "#F3F4F6", fontWeight: 700 } as any;
                  return (
                    <div id="lot-trace-doc" style={{ position: "absolute", left: -10000, top: 0, width: 780, background: "#fff", color: "#111", fontFamily: "Arial, sans-serif", fontSize: 12, padding: 24 }}>
                      <div style={{ fontSize: 17, fontWeight: 800 }}>TRACEABILITY / RECALL REPORT — {t.lot.number}</div>
                      <div style={{ marginBottom: 10 }}>Generated / Wygenerowano: {t.generatedAt} · {t.lot.product}{t.lot.variety ? ` — ${t.lot.variety}` : ""} · received {Number(t.lot.receivedKg || 0).toLocaleString("pl-PL")} kg</div>
                      <div style={{ fontWeight: 800, margin: "8px 0 4px" }}>ORIGIN / POCHODZENIE</div>
                      <div>PO: <b>{t.origin.poNumber || "—"}</b> · Supplier / Dostawca: <b>{t.origin.supplier || "—"}</b>{t.origin.origin ? ` · Origin: ${t.origin.origin}` : ""}{t.origin.supplierAddress ? ` · ${t.origin.supplierAddress}` : ""}</div>
                      <div style={{ fontWeight: 800, margin: "10px 0 4px" }}>SHIPMENTS / TRANSPORTY ({t.shipments.length})</div>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["No.", "Direction", "Route", "Dates", "Carrier", "Status"].map(h => <th key={h} style={hd}>{h}</th>)}</tr></thead>
                        <tbody>{t.shipments.map((s: any) => <tr key={s.number}>{[s.number, s.direction || "—", [s.from, s.to].filter(Boolean).join(" → ") || "—", s.dates || "—", s.carrier || "—", s.status || "—"].map((v: any, k: number) => <td key={String(k)} style={cell}>{v}</td>)}</tr>)}</tbody></table>
                      <div style={{ fontWeight: 800, margin: "10px 0 4px" }}>SOLD TO / SPRZEDANO ({t.sales.length})</div>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["SO", "Client / Klient", "Qty kg", "Destination", "Status"].map(h => <th key={h} style={hd}>{h}</th>)}</tr></thead>
                        <tbody>{t.sales.map((s: any, k: number) => <tr key={String(k)}>{[s.soNumber, s.client, s.qtyKg.toLocaleString("pl-PL"), s.destination || "—", s.status || "—"].map((v: any, j: number) => <td key={String(j)} style={cell}>{v}</td>)}</tr>)}</tbody></table>
                      <div style={{ fontWeight: 800, margin: "10px 0 4px" }}>RELATED INVOICES / FAKTURY ({t.invoices.length})</div>
                      <div>{t.invoices.map((v: any) => `${v.number}${v.counterparty ? ` (${v.counterparty})` : ""}`).join(" · ") || "—"}</div>
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
function ClaimModal({ lot, po, existing = null, onCancel, onSave }: any) {
  const CUR = ["PLN", "EUR", "EGP"];
  const seedLines = () => {
    if (existing?.costLines?.length) return existing.costLines;
    const fromCosts = (lot.costs || []).filter((c: any) => ["PLN", "EUR"].includes(c.currency)).map((c: any) => ({
      id: nextId(), label: c.label || c.type || "Cost", party: "", invoiceNo: c.source || "", amount: c.amount, currency: c.currency, rate: "",
    }));
    return fromCosts.length ? fromCosts : [
      { id: nextId(), label: `Product — ${lot.product || ""}`.trim(), party: po?.supplier?.name || "", invoiceNo: "", amount: "", currency: "PLN", rate: "" },
      { id: nextId(), label: "Transport to port of loading", party: "", invoiceNo: "", amount: "", currency: "EUR", rate: "" },
      { id: nextId(), label: "Container cost", party: "", invoiceNo: "", amount: "", currency: "EUR", rate: "" },
      { id: nextId(), label: "Customs + transport at destination", party: "", invoiceNo: "", amount: "", currency: "EGP", rate: "" },
      { id: nextId(), label: "Sorting", party: "", invoiceNo: "", amount: "", currency: "EGP", rate: "" },
    ];
  };
  const [claim, setClaim] = useState(() => existing ? { ...existing } : {
    number: "", date: localTodayISO(), containerNo: "", supplierName: po?.supplier?.name || "",
    defectType: "", defectPct: "", soldInMarket: true, recoveredAmount: "", recoveredCurrency: "EGP", recoveredRate: "",
    eurPlnRate: "", notes: "", status: "Draft",
    // Batch 6c (BP-33): physical + lifecycle dimensions of the claim
    affectedKg: "", acceptedEUR: "", resolutionNote: "", resolvedAt: null,
  });
  const [lines, setLines] = useState(seedLines);
  const cf = (k: any, v: any) => setClaim((c: any) => ({ ...c, [k]: v }));
  const lf = (id: any, k: any, v: any) => setLines((prev: any[]) => prev.map(l => l.id === id ? { ...l, [k]: v } : l));
  const comp = computeClaim({
    costLines: lines, defectPct: claim.defectPct, soldInMarket: !!claim.soldInMarket,
    recoveredAmount: claim.recoveredAmount, recoveredCurrency: claim.recoveredCurrency, recoveredRate: claim.recoveredRate,
  });
  const eur = (v: number) => `€${(v || 0).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const inp = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 7, padding: "6px 8px", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box" } as any;
  const th = { padding: "5px 6px", fontSize: 10, color: "#94A3B8", textAlign: "left", borderBottom: "1px solid #E5E7EB", fontWeight: 700, letterSpacing: "0.03em" } as any;
  const td = { padding: "4px 4px", verticalAlign: "middle" } as any;
  const canIssue = comp.totalCostEUR > 0 && parseFloat(String(claim.defectPct)) > 0 && parseFloat(String(claim.eurPlnRate)) > 0;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", zIndex: 7000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 16px", overflowY: "auto" }} onClick={onCancel}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: 920, maxWidth: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.3)", padding: 22, marginBottom: 40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Producer claim / Reklamacja do producenta</div>
          {claim.number ? <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, fontWeight: 800, color: "#B45309", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, padding: "1px 8px" }}>{claim.number}</span> : <span style={{ fontSize: 11, color: "#94A3B8" }}>draft — number assigned on issue</span>}
        </div>
        <div style={{ fontSize: 11.5, color: "#64748B", marginBottom: 12 }}>Lot <b>{lot.number}</b>{lot.poRef ? <> · PO <b>{lot.poRef}</b></> : null}{lot.product ? <> · {lot.product}</> : null} — quantify the damage, deduct market recovery, request the balance from the producer as a credit note.</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div><Lbl>Claim date</Lbl><input type="date" value={claim.date} onChange={(e: any) => cf("date", e.target.value)} style={inp} /></div>
          <div><Lbl>Container no.</Lbl><input value={claim.containerNo} onChange={(e: any) => cf("containerNo", e.target.value)} placeholder="e.g. SEGU9867650" style={inp} /></div>
          <div><Lbl>Supplier / producer</Lbl><input value={claim.supplierName} onChange={(e: any) => cf("supplierName", e.target.value)} style={inp} /></div>
          <div><Lbl>EUR→PLN rate (for the note)</Lbl><input type="number" value={claim.eurPlnRate} onChange={(e: any) => cf("eurPlnRate", e.target.value)} placeholder="e.g. 4.25" style={inp} /></div>
        </div>

        <SectionTitle>COST OF THE CONSIGNMENT AT CLIENT'S WAREHOUSE</SectionTitle>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 6 }}>
          <thead><tr>
            <th style={th}>COST ITEM</th><th style={th}>PARTY</th><th style={th}>INVOICE NO.</th>
            <th style={{ ...th, width: 110 }}>AMOUNT</th><th style={{ ...th, width: 64 }}>CUR</th>
            <th style={{ ...th, width: 84 }} title="PLN: NBP PLN-per-EUR · EGP: EGP-per-EUR">RATE→EUR</th>
            <th style={{ ...th, width: 96, textAlign: "right" }}>EUR</th><th style={{ ...th, width: 30 }}></th>
          </tr></thead>
          <tbody>
            {comp.lines.map((l: any) => (
              <tr key={String(l.id)} style={{ borderBottom: "1px solid #F8FAFC" }}>
                <td style={td}><input value={l.label} onChange={(e: any) => lf(l.id, "label", e.target.value)} style={inp} /></td>
                <td style={td}><input value={l.party || ""} onChange={(e: any) => lf(l.id, "party", e.target.value)} style={inp} /></td>
                <td style={td}><input value={l.invoiceNo || ""} onChange={(e: any) => lf(l.id, "invoiceNo", e.target.value)} style={inp} /></td>
                <td style={td}><input type="number" value={l.amount} onChange={(e: any) => lf(l.id, "amount", e.target.value)} style={inp} /></td>
                <td style={td}><select value={l.currency} onChange={(e: any) => lf(l.id, "currency", e.target.value)} style={inp}>{CUR.map(c => <option key={c}>{c}</option>)}</select></td>
                <td style={td}>{l.currency === "EUR" ? <span style={{ fontSize: 10.5, color: "#CBD5E1" }}>—</span> : <input type="number" value={l.rate || ""} onChange={(e: any) => lf(l.id, "rate", e.target.value)} placeholder={l.currency === "PLN" ? "NBP" : "EGP/€"} style={inp} />}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 700, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>{eur(l.eur)}</td>
                <td style={td}><button onClick={() => setLines((prev: any[]) => prev.filter(x => x.id !== l.id))} style={{ border: "none", background: "transparent", color: "#DC2626", cursor: "pointer", fontSize: 13 }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => setLines((prev: any[]) => [...prev, { id: nextId(), label: "", party: "", invoiceNo: "", amount: "", currency: "EUR", rate: "" }])} style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 11.5, fontWeight: 700, cursor: "pointer", marginBottom: 14 }}>+ Add cost line</button>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 12 }}>
          <div style={{ border: "1px solid #FEE2E2", background: "#FEF2F2", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "#B91C1C", letterSpacing: "0.04em", marginBottom: 8 }}>DEFECT</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 84px 120px", gap: 8 }}>
              <div><Lbl>Type of defects</Lbl><input value={claim.defectType} onChange={(e: any) => cf("defectType", e.target.value)} placeholder="e.g. Skin defects" style={inp} /></div>
              <div><Lbl>% of consignment</Lbl><input type="number" value={claim.defectPct} onChange={(e: any) => cf("defectPct", e.target.value)} placeholder="42" style={inp} /></div>
              <div>
                <Lbl>Affected qty (kg)</Lbl>
                <input type="number" value={claim.affectedKg ?? ""} onChange={(e: any) => cf("affectedKg", e.target.value)} placeholder={String(Math.round((parseFloat(claim.defectPct) || 0) / 100 * (lot.receivedKg || 0)) || "")} style={inp} />
                {(parseFloat(claim.defectPct) > 0 && lot.receivedKg > 0 && !claim.affectedKg) && (
                  <button type="button" onClick={() => cf("affectedKg", String(Math.round((parseFloat(claim.defectPct) || 0) / 100 * lot.receivedKg)))} style={{ fontSize: 9.5, border: "none", background: "transparent", color: "#B45309", cursor: "pointer", padding: "2px 0", fontWeight: 700 }}>use {Math.round((parseFloat(claim.defectPct) || 0) / 100 * lot.receivedKg).toLocaleString("pl-PL")} kg ({claim.defectPct}% of received)</button>
                )}
              </div>
            </div>
          </div>
          <div style={{ border: "1px solid #DCFCE7", background: "#F0FDF4", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "#15803D", letterSpacing: "0.04em", marginBottom: 8 }}>RECOVERY — DEFECTED PRODUCT SOLD IN THE MARKET?</div>
            <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 70px 84px", gap: 8, alignItems: "end" }}>
              <div><Lbl>Sold?</Lbl><select value={claim.soldInMarket ? "yes" : "no"} onChange={(e: any) => cf("soldInMarket", e.target.value === "yes")} style={inp}><option value="yes">Yes</option><option value="no">No</option></select></div>
              <div><Lbl>Recovered amount</Lbl><input type="number" disabled={!claim.soldInMarket} value={claim.recoveredAmount} onChange={(e: any) => cf("recoveredAmount", e.target.value)} style={{ ...inp, opacity: claim.soldInMarket ? 1 : 0.5 }} /></div>
              <div><Lbl>Cur</Lbl><select disabled={!claim.soldInMarket} value={claim.recoveredCurrency} onChange={(e: any) => cf("recoveredCurrency", e.target.value)} style={{ ...inp, opacity: claim.soldInMarket ? 1 : 0.5 }}>{CUR.map(c => <option key={c}>{c}</option>)}</select></div>
              <div><Lbl>Rate→EUR</Lbl><input type="number" disabled={!claim.soldInMarket || claim.recoveredCurrency === "EUR"} value={claim.recoveredRate} onChange={(e: any) => cf("recoveredRate", e.target.value)} style={{ ...inp, opacity: claim.soldInMarket && claim.recoveredCurrency !== "EUR" ? 1 : 0.5 }} /></div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
          {[["Total cost at client's WH", comp.totalCostEUR, "#334155"], ["Defect value", comp.defectValueEUR, "#B91C1C"], ["Recovered", comp.recoveredEUR, "#15803D"], ["REQUESTED CREDIT NOTE", comp.creditNoteEUR, "#B45309"]].map((x: any) => (
            <div key={String(x[0])} style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: "10px 12px", background: "#FAFAFA" }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: "#94A3B8", letterSpacing: "0.04em" }}>{x[0]}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: x[2], fontFamily: "ui-monospace, Menlo, monospace" }}>{eur(x[1])}</div>
            </div>
          ))}
        </div>

        {claim.status && claim.status !== "Draft" && (
          <div style={{ border: "1px solid #E0E7FF", background: "#F5F7FF", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "#4338CA", letterSpacing: "0.04em", marginBottom: 8 }}>RESOLUTION — PRODUCER'S ANSWER</div>
            <div style={{ display: "grid", gridTemplateColumns: "150px 130px 1fr", gap: 8 }}>
              <div><Lbl>Status</Lbl><select value={claim.status} onChange={(e: any) => setClaim((c: any) => ({ ...c, status: e.target.value, resolvedAt: ["Accepted", "Rejected", "Settled"].includes(e.target.value) ? (c.resolvedAt || localTodayISO()) : null }))} style={inp}>
                {["Issued", "Accepted", "Rejected", "Settled"].map((s: string) => <option key={s}>{s}</option>)}
              </select></div>
              <div><Lbl>Accepted (EUR)</Lbl><input type="number" value={claim.acceptedEUR ?? ""} onChange={(e: any) => cf("acceptedEUR", e.target.value)} placeholder={String(comp.creditNoteEUR || "")} style={inp} disabled={claim.status === "Rejected"} /></div>
              <div><Lbl>Resolution note</Lbl><input value={claim.resolutionNote ?? ""} onChange={(e: any) => cf("resolutionNote", e.target.value)} placeholder="e.g. producer accepted 5,000 EUR — credit note KN 12/2026" style={inp} /></div>
            </div>
            {claim.acceptedEUR && parseFloat(claim.acceptedEUR) !== comp.creditNoteEUR && (
              <div style={{ fontSize: 10.5, color: "#B45309", marginTop: 6 }}>Accepted differs from requested ({comp.creditNoteEUR.toFixed(2)} EUR) — remember to adjust the draft credit note in the Invoices module (it owns the note).</div>
            )}
          </div>
        )}
        <div style={{ marginBottom: 12 }}><Lbl>Notes</Lbl><textarea value={claim.notes} onChange={(e: any) => cf("notes", e.target.value)} rows={2} style={{ ...inp, resize: "vertical" }} /></div>

        {/* printable bilingual document */}
        <div id="producer-claim-doc" style={{ position: "absolute", left: -10000, top: 0, width: 780, background: "#fff", color: "#111", fontFamily: "Arial, sans-serif", fontSize: 12, padding: 24 }}>
          <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 2 }}>CLAIM REQUEST / WNIOSEK REKLAMACYJNY {claim.number ? `— ${claim.number}` : ""}</div>
          <div style={{ marginBottom: 10 }}>Date / Data: {claim.date} · PO: {lot.poRef || "—"} · Container / Kontener: {claim.containerNo || "—"} · Supplier / Dostawca: {claim.supplierName || "—"} · Lot: {lot.number}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
            <thead><tr>{["Cost item / Pozycja", "Party / Strona", "Invoice / Faktura", "Amount / Kwota", "Cur", "Rate / Kurs", "EUR"].map(h => <th key={h} style={{ border: "1px solid #999", padding: "4px 6px", fontSize: 10.5, background: "#F3F4F6", textAlign: "left" }}>{h}</th>)}</tr></thead>
            <tbody>{comp.lines.map((l: any) => (
              <tr key={String(l.id)}>{[l.label, l.party || "—", l.invoiceNo || "—", (parseFloat(l.amount) || 0).toLocaleString("pl-PL", { minimumFractionDigits: 2 }), l.currency, l.currency === "EUR" ? "—" : (l.rate || "—"), eur(l.eur)].map((v: any, k: number) => <td key={String(k)} style={{ border: "1px solid #999", padding: "4px 6px", fontSize: 11 }}>{v}</td>)}</tr>
            ))}</tbody>
          </table>
          <div>Total cost of the consignment at client's warehouse / Koszt całkowity: <b>{eur(comp.totalCostEUR)}</b></div>
          <div>Type of defects / Rodzaj wad: <b>{claim.defectType || "—"}</b> · {claim.defectPct || 0}% of consignment / partii</div>
          <div>Value of defects / Wartość wad: <b>{eur(comp.defectValueEUR)}</b></div>
          <div>Defected product sold in the market / Sprzedaż wadliwego towaru: <b>{claim.soldInMarket ? "YES / TAK" : "NO / NIE"}</b>{claim.soldInMarket ? <> · recovered / odzyskano: <b>{eur(comp.recoveredEUR)}</b></> : null}</div>
          <div style={{ fontSize: 14, fontWeight: 800, marginTop: 8 }}>REQUESTED CREDIT NOTE / WNIOSKOWANA NOTA KREDYTOWA: {eur(comp.creditNoteEUR)}</div>
          {claim.notes ? <div style={{ marginTop: 8 }}>Notes / Uwagi: {claim.notes}</div> : null}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <button onClick={() => printHtmlNodeInv("producer-claim-doc", `Claim-${claim.number || lot.number}`)} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: "#111", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Print / PDF claim</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onCancel} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
            <button onClick={() => onSave({ ...claim, costLines: lines }, comp, false)} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #B45309", background: "#fff", color: "#B45309", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Save</button>
            <button disabled={!canIssue || claim.status === "Issued"} onClick={() => onSave({ ...claim, costLines: lines }, comp, true)} title={claim.status === "Issued" ? "Already issued" : !canIssue ? "Needs cost lines, a defect % and the EUR→PLN rate" : "Assigns the CLM number and drafts the incoming credit note"} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: (!canIssue || claim.status === "Issued") ? "#D1D5DB" : "#B45309", color: "#fff", fontSize: 12, fontWeight: 700, cursor: (!canIssue || claim.status === "Issued") ? "not-allowed" : "pointer" }}>{claim.status === "Issued" ? "Issued ✓" : "Issue claim"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Inventory({ lots: extLots, setLots: extSetLots, allOrders: extOrders, contacts: extContacts = [], shipments: extShipments = [], setShipments: extSetShipments = null, pos: extPOs = [], invoices: extInvoices = [], setInvoices: extSetInvoices = null, financeNotes: extFinanceNotes = [], setFinanceNotes: extSetFinanceNotes = null, claims: extClaims = [], setClaims: extSetClaims = null }: any = {}) {
  const cancelledRefs = cancelledDocSet(extPOs, extOrders, extShipments); // v6.35.1: strike cancelled source refs
  const { confirm: uiConfirm, alert: uiAlert, dialogNode } = useConfirm(); // Batch 2 (P2-6)
  // Integration mode: parent passes lots state and live SOs. Standalone: local seed + module-scope SOS.
  const [localLots, setLocalLots] = useState<any[]>([]); // v6.32.0 (R7b-5): demo seed removed from bundle
  const lots = extLots ?? localLots;
  const setLots = extSetLots ?? setLocalLots;
  // Live SOs from shell (replaces the standalone-only module-scope SOS).
  // If shell doesn't pass any (standalone), helpers fall through to local SOS via their default param.
  const liveSOs = extOrders;
  const shipments = extShipments;
  const [view, setView] = useState("list");
  const [selectedId, setSelectedId] = useState(null);
  const selected = useMemo(() => lots.find(l => l.id === selectedId) ?? null, [lots, selectedId]);
  const [showMovement, setShowMovement] = useState(false);
  const [movementMode, setMovementMode] = useState<"movement" | "quality">("movement");
  const [sortingLot, setSortingLot] = useState(null); // v6.5: lot for the sorting-event modal
  const [settlementLot, setSettlementLot] = useState(null); // v6.6: lot for the consignment settlement modal
  const [claimLot, setClaimLot] = useState(null); // Batch 6a (BP-55b): lot for the producer-claim modal
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
    if (sortBy === "default") return base;
    const key = (l: any) => lotArrivalDate(l) || "9999-12-31"; // no arrival sorts last on oldest-first
    return [...base].sort((a, b) => sortBy === "oldest" ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a)));
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
        {showMovement && <MovementModal lot={selected} liveSOs={liveSOs} editing={editingMovement} initialMode={movementMode} contacts={extContacts} allLots={lots} shipments={shipments} onCancel={() => { setShowMovement(false); setEditingMovement(null); }} onConfirm={recordMovement} />}

        {sortingLot && <SortingModal lot={sortingLot} onCancel={() => setSortingLot(null)} onConfirm={({ kg, date, note }) => {
          setLots(prev => prev.map(l => l.id === sortingLot.id ? { ...l, serviceEvents: [...(l.serviceEvents || []), { id: nextId(), type: "SORTING", kg, date, note }] } : l));
          setSortingLot(null);
        }} />}

        {showReturn && selected && <ReturnModal lot={selected} contacts={extContacts} onCancel={() => setShowReturn(false)} onConfirm={returnToWarehouse} />}

        {claimLot && <ClaimModal
          lot={lots.find(l => l.id === claimLot.id) || claimLot}
          po={(extPOs || []).find((p: any) => p.number === (lots.find(l => l.id === claimLot.id) || claimLot).poRef) || null}
          {...{} /* v6.48.0: the claim document comes from the claims store now */}
          existing={(() => {
            const lotNo = (lots.find(l => l.id === claimLot.id) || claimLot).number;
            const mine = claimsForLot(extClaims || [], lotNo).filter((c: any) => c.direction === "RECOVERY");
            const c = mine[0];
            if (!c) return null;
            // adapt the stored record back to the shape ClaimModal edits
            return { id: c.id, number: c.number, date: c.date, lines: c.costLines || [],
              defectType: c.defectType, defectPct: c.defectPct, soldInMarket: c.soldInMarket,
              recoveredEGP: c.recoveredEGP, egpPerEur: c.egpPerEur, eurPlnRate: c.plnPerEur,
              affectedKg: (c.subjects || []).find((x: any) => x.kind === "LOT" && String(x.ref) === String(lotNo))?.affectedKg ?? "",
              status: c.status === "Draft" ? "Draft" : "Issued", notes: c.notes,
              requestedCreditEUR: c.requestedEUR };
          })()}
          onCancel={() => setClaimLot(null)}
          onSave={(claim, comp, issue) => {
            // Batch 6a (BP-55b): issuing assigns the CLM number and drafts the
            // incoming credit note against the producer (idempotent by number).
            if (issue && !claim.number) {
              claim = { ...claim, number: nextClaimNumber(extClaims || [], new Date().getFullYear()) };
            }
            if (issue) claim = { ...claim, status: "Issued", requestedCreditEUR: comp.creditNoteEUR, totalCostEUR: comp.totalCostEUR, defectValueEUR: comp.defectValueEUR, recoveredEUR: comp.recoveredEUR };
            const lotNow = lots.find(l => l.id === claimLot.id) || claimLot;
            const poForClaim = (extPOs || []).find((p: any) => p.number === lotNow.poRef) || null;
            if (issue && extSetFinanceNotes) {
              const clmNo = claim.number;
              const claimForNote = claim;
              const compForNote = comp;
              const poForNote = (extPOs || []).find((p: any) => p.number === lotNow.poRef) || null;
              extSetFinanceNotes((prev: any[]) => {
                const exists = (prev || []).some((nt: any) => nt.relatedRef === clmNo);
                if (exists) return prev;
                const note = buildClaimNote(lotNow, poForNote, claimForNote, compForNote, claimForNote.eurPlnRate, { nextId, todayISO: localTodayISO });
                return [note, ...(prev || [])];
              });
            }
            // v6.48.0 (Phase 1): the claim DOCUMENT lives in the claims store now.
            // The old code wrote it into lot.claims[] with a filter that dropped
            // every existing claim whenever a new one was saved (defect D1), and a
            // lot can genuinely carry more than one claim. The lot keeps only what
            // is inventory truth: the CLAIM movement and claimedKg.
            const withId = claim.id ? claim : { ...claim, id: nextId() };
            if (typeof extSetClaims === "function") {
              const lotNoForClaim = lotNow.number;
              extSetClaims((prev: any[]) => {
                const list = prev || [];
                const idx = list.findIndex((c: any) => String(c.id) === String(withId.id) || (withId.number && String(c.number) === String(withId.number)));
                const record = {
                  ...blankClaim(),
                  ...(idx >= 0 ? list[idx] : {}),
                  id: idx >= 0 ? list[idx].id : withId.id,
                  number: withId.number || (idx >= 0 ? list[idx].number : ""),
                  direction: "RECOVERY",
                  respondent: { kind: "Supplier", contactId: poForClaim?.supplierId ?? null, name: poForClaim?.supplier?.name || "" },
                  cause: "Quality defect",
                  subjects: [
                    { kind: "LOT", ref: lotNoForClaim, affectedKg: parseFloat(String(withId.affectedKg || "")) || undefined },
                    ...(lotNow.poRef ? [{ kind: "PO", ref: lotNow.poRef }] : []),
                  ],
                  date: withId.date || localTodayISO(),
                  costLines: withId.lines || [],
                  defectType: withId.defectType || "",
                  defectPct: withId.defectPct ?? "",
                  soldInMarket: withId.soldInMarket ?? null,
                  recoveredEGP: withId.recoveredEGP ?? "",
                  egpPerEur: withId.egpPerEur ?? "",
                  plnPerEur: withId.eurPlnRate ?? "",
                  totalCostEUR: comp?.totalCostEUR ?? 0,
                  defectValueEUR: comp?.defectValueEUR ?? 0,
                  recoveredEUR: comp?.recoveredEUR ?? 0,
                  requestedEUR: comp?.creditNoteEUR ?? withId.requestedCreditEUR ?? 0,
                  status: issue ? "Submitted" : "Draft",
                  notes: withId.notes || "",
                };
                return idx >= 0 ? list.map((c: any, i: number) => i === idx ? record : c) : [...list, record];
              });
            }
            setLots(prev => prev.map(l => {
              if (l.id !== claimLot.id) return l;
              let next = { ...l };
              // Batch 6c (BP-33): issuing a claim with an affected quantity logs a
              // CLAIM movement — client-side, NO warehouse stock effect (reducer
              // semantics v6.18.10 #5) — so the lot's claimedKg reflects reality.
              const kg = parseFloat(String(claim.affectedKg || "")) || 0;
              if (issue && kg > 0) {
                const already = (l.movements || []).some((m: any) => m.type === "CLAIM" && String(m.note || "").includes(withId.number));
                if (!already) {
                  next = {
                    ...next,
                    movements: [...(l.movements || []), { id: nextId(), date: claim.date || localTodayISO(), type: "CLAIM", qtyKg: kg, note: `Producer claim ${withId.number} — ${claim.defectType || "quality defect"} ${claim.defectPct || 0}%` }],
                    claimedKg: (l.claimedKg || 0) + kg,
                  };
                }
              }
              return next;
            }));
            if (issue) setClaimLot(null);
          }}
        />}
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
          allLots={lots}
          lotClaims={claimsForLot(extClaims || [], selected?.number).filter((c: any) => c.direction === "RECOVERY")}
          lot={selected}
          onBack={() => { setView("list"); setSelectedId(null); }}
          onMove={() => { setEditingMovement(null); setMovementMode("movement"); setShowMovement(true); }}
          onQualityIssue={() => { setEditingMovement(null); setMovementMode("quality"); setShowMovement(true); }}
          onEditMovement={(m: any) => { setEditingMovement(m); setMovementMode(["DAMAGE", "RECLASS"].includes(m.type) ? "quality" : "movement"); setShowMovement(true); }}
          onDeleteMovement={deleteMovement}
          onVoidMovement={voidMovement}
          onInspect={() => setShowInspection(true)}
          onReturn={() => setShowReturn(true)}
          onDelete={deleteLot}
          liveSOs={liveSOs}
          shipments={extShipments}
          contacts={extContacts}
          onRecordSorting={(l) => setSortingLot(l)}
          onOpenSettlement={(l) => setSettlementLot(l)}
          onOpenClaim={(l) => setClaimLot(l)}
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
            {["LOT", "PRODUCT", "KL.", "STATUS", "LOCATION & FLOW", "AVAIL/PHYSICAL", "VALUE PLN", "LINKED"].map((h, i) => (
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
                  <div style={{ fontSize: 11, color: "#AAA" }}>{l.size || "—"} · {l.origin || "—"} · {l.packaging}</div>
                  {(() => { const d = lotArrivalDate(l); const age = lotAgeDays(l); return d ? (
                    <div style={{ fontSize: 10.5, marginTop: 2 }}><span style={{ color: "#94A3B8" }}>arrived {d}</span> <span style={{ fontWeight: 700, color: ageColor(age as number) }}>· {age} d</span></div>
                  ) : null; })()}
                </div>
                <div><QualityBadge quality={l.quality} /></div>
                <div><StatusBadge status={l.status} /></div>
                <div>
                  <LocationPill locationId={l.locationId} lot={l} />
                  <div style={{ marginTop: 3 }}><LotDirectionBadge lot={l} shipments={shipments} orders={liveSOs} compact /></div>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#16A34A" }}>{fmtNum(res.liveAvailable)} <span style={{ fontSize: 11, color: "#AAA", fontWeight: 400 }}>/ {fmtNum(l.physicalKg || 0)} kg</span></div>
                  {res.totalReserved > 0 && <div style={{ fontSize: 10.5, color: "#7C3AED", fontWeight: 600 }}>{fmtNum(res.totalReserved)} reserved · {res.reservations.length} SO</div>}
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
