import React, { useState, useMemo } from "react";
import { LOCATIONS as SHARED_LOCATIONS } from "./locations";

// ─── REFERENCE DATA ─────────────────────────────────────────────────────────
const COMPANY = { name: "MARIANNA", nip: "PL525-284-27-87" };

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
const FLOW_TYPES: Record<string, any> = {
  // EXPORT
  EXP_EXWS:     { group: "EXP", short: "EXP · EXWs — client pickup",       emoji: "🤝", desc: "Client sends their truck to producer warehouse.", buyOwnershipStart: "never", sellOwnershipEnd: "never", stageTemplate: [{ kind: "supplier", label: "At producer (ready)" }, { kind: "client", label: "Collected by client" }] },
  EXP_FOB:      { group: "EXP", short: "EXP · FOB — we truck to port",     emoji: "⚓", desc: "We truck to port, client takes over (no sea on our side).", buyOwnershipStart: "supplier", sellOwnershipEnd: "origin_port", stageTemplate: [{ kind: "supplier", label: "At producer" }, { kind: "transit_road", label: "Road to port of loading" }, { kind: "origin_port", label: "Port of loading (handed to client)" }] },
  EXP_CIF:      { group: "EXP", short: "EXP · CIF — own full logistics",   emoji: "🚢", desc: "Producer → our truck → port → vessel (CIF).", buyOwnershipStart: "supplier", sellOwnershipEnd: "dest_port", stageTemplate: [{ kind: "supplier", label: "At producer" }, { kind: "transit_road", label: "Road to port of loading" }, { kind: "origin_port", label: "Port of loading" }, { kind: "customs_export", label: "Export customs" }, { kind: "transit_sea", label: "Sea freight" }, { kind: "dest_port", label: "Destination port (handed to client)" }] },
  EXP_DDP_EU:   { group: "EXP", short: "EXP · DDP intra-EU",               emoji: "🚛", desc: "Producer → our truck → EU client (DDP).", buyOwnershipStart: "supplier", sellOwnershipEnd: "client", stageTemplate: [{ kind: "supplier", label: "At producer" }, { kind: "transit_road", label: "Road to client (intra-EU)" }, { kind: "client", label: "Delivered to client" }] },
  EXP_DDP_XEU:  { group: "EXP", short: "EXP · DDP extra-EU",               emoji: "🛃", desc: "Producer → our truck → export customs → client (DDP).", buyOwnershipStart: "supplier", sellOwnershipEnd: "client", stageTemplate: [{ kind: "supplier", label: "At producer" }, { kind: "transit_road", label: "Road to border" }, { kind: "customs_export", label: "Export customs" }, { kind: "transit_road", label: "Road to client" }, { kind: "client", label: "Delivered to client" }] },
  // IMPORT
  IMP_EXWS_WH:  { group: "IMP", short: "IMP · EXWs → our WH",              emoji: "🔄", desc: "Our truck picks up at supplier → sea (if needed) → customs → our WH.", buyOwnershipStart: "supplier", sellOwnershipEnd: "our_wh", stageTemplate: [{ kind: "supplier", label: "At supplier" }, { kind: "transit_road", label: "Road to port of loading" }, { kind: "origin_port", label: "Port of loading" }, { kind: "transit_sea", label: "Sea freight" }, { kind: "dest_port", label: "Destination port" }, { kind: "customs_import", label: "Import customs" }, { kind: "transit_road", label: "Road to our warehouse" }, { kind: "our_wh", label: "In our warehouse" }] },
  IMP_EXWS_DIR: { group: "IMP", short: "IMP · EXWs → direct to client",    emoji: "↗️", desc: "Our truck picks up at supplier → sea (if needed) → customs → client.", buyOwnershipStart: "supplier", sellOwnershipEnd: "client", stageTemplate: [{ kind: "supplier", label: "At supplier" }, { kind: "transit_road", label: "Road to port of loading" }, { kind: "origin_port", label: "Port of loading" }, { kind: "transit_sea", label: "Sea freight" }, { kind: "dest_port", label: "Destination port" }, { kind: "customs_import", label: "Import customs" }, { kind: "transit_road", label: "Road to client" }, { kind: "client", label: "Delivered to client" }] },
  IMP_CIF_WH:   { group: "IMP", short: "IMP · CIF → our WH",               emoji: "📦", desc: "Supplier ships CIF → we customs + inland → our WH.", buyOwnershipStart: "dest_port", sellOwnershipEnd: "our_wh", stageTemplate: [{ kind: "supplier", label: "At supplier (supplier ships)" }, { kind: "transit_sea", label: "Sea freight (supplier's risk)" }, { kind: "dest_port", label: "Destination port (we take over)" }, { kind: "customs_import", label: "Import customs" }, { kind: "transit_road", label: "Road to our warehouse" }, { kind: "our_wh", label: "In our warehouse" }] },
  IMP_CIF_DIR:  { group: "IMP", short: "IMP · CIF → direct to client",     emoji: "➡️", desc: "Supplier ships CIF → we customs + inland → client.", buyOwnershipStart: "dest_port", sellOwnershipEnd: "client", stageTemplate: [{ kind: "supplier", label: "At supplier (supplier ships)" }, { kind: "transit_sea", label: "Sea freight (supplier's risk)" }, { kind: "dest_port", label: "Destination port (we take over)" }, { kind: "customs_import", label: "Import customs" }, { kind: "transit_road", label: "Road to client" }, { kind: "client", label: "Delivered to client" }] },
  IMP_DDP_WH:   { group: "IMP", short: "IMP · DDP → our WH",               emoji: "🏭", desc: "Supplier delivers DDP to our warehouse.", buyOwnershipStart: "our_wh", sellOwnershipEnd: "our_wh", stageTemplate: [{ kind: "supplier", label: "At supplier (supplier delivers)" }, { kind: "transit_road", label: "Supplier's delivery (their risk)" }, { kind: "our_wh", label: "Received in our warehouse" }] },
  IMP_DDP_DIR:  { group: "IMP", short: "IMP · DDP → direct to client",     emoji: "🎯", desc: "Supplier delivers DDP straight to client.", buyOwnershipStart: "never", sellOwnershipEnd: "never", stageTemplate: [{ kind: "supplier", label: "At supplier (supplier delivers)" }, { kind: "client", label: "Delivered to client (pass-through)" }] },
};

const OWNERSHIP_POINT_ORDER = ["supplier", "origin_port", "vessel", "dest_port", "our_wh", "client"];

// v6.1.5: Standard Incoterm-aligned stage wording, derived from the stage kind and the
// flow's buy/sell Incoterm family. One source of truth → consistent across the app.
function incotermFamily(flow: string, side: "buy" | "sell") {
  // Infer the Incoterm family from the flow code.
  const f = flow || "";
  if (side === "buy") {
    if (f.includes("CIF")) return "CIF";
    if (f.includes("DDP")) return "DDP";
    if (f.includes("FOB")) return "FOB";
    return "EXW"; // EXWS / default pickup
  } else {
    if (f.startsWith("EXP_EXWS")) return "EXW";
    if (f.startsWith("EXP_FOB")) return "FOB";
    if (f.startsWith("EXP_CIF")) return "CIF";
    if (f.startsWith("EXP_DDP")) return "DDP";
    if (f.endsWith("_DIR")) return "DDP"; // sold delivered to client
    return ""; // import to our WH — no onward sale Incoterm at this point
  }
}
function standardStageLabel(kind: string, flow: string) {
  const buy = incotermFamily(flow, "buy");
  switch (kind) {
    case "supplier":
      return buy === "EXW" ? "EXW — at supplier"
           : "At supplier";
    case "transit_road": return "Road carriage";
    case "transit_sea":  return buy === "CIF" ? "Sea freight (CIF — supplier's risk)" : "Sea freight";
    case "origin_port":  return buy === "FOB" ? "FOB — loaded on vessel (port of loading)" : "Port of loading";
    case "customs_export": return "Export customs cleared";
    case "dest_port":    return buy === "CIF" ? "CIF — arrived at destination port" : "Destination port";
    case "customs_import": return "Import customs cleared";
    case "our_wh":       return "Received into our warehouse";
    case "client":       return "Delivered to client";
    default: return kind;
  }
}

const STAGE_KIND_TO_POINT: Record<string, string> = {
  supplier: "supplier", transit_road: "supplier", origin_port: "origin_port",
  customs_export: "origin_port", transit_sea: "vessel", dest_port: "dest_port",
  customs_import: "dest_port", our_wh: "our_wh", client: "client",
};
function ownershipForStage(flow: string, stageKind: string, stages?: any[], idx?: number) {
  const f = FLOW_TYPES[flow];
  if (!f) return "owned";
  if (f.buyOwnershipStart === "never" || f.sellOwnershipEnd === "never") return "not_owned";
  // A transit leg (road/sea) sits BETWEEN two points; its ownership follows the
  // point it departs FROM — i.e. the nearest preceding non-transit stage's point.
  let point = STAGE_KIND_TO_POINT[stageKind] || "supplier";
  const isTransit = stageKind === "transit_road" || stageKind === "transit_sea";
  if (isTransit && Array.isArray(stages) && typeof idx === "number") {
    for (let j = idx - 1; j >= 0; j--) {
      const pk = stages[j].kind;
      if (pk !== "transit_road" && pk !== "transit_sea") { point = STAGE_KIND_TO_POINT[pk] || point; break; }
    }
  }
  const sI = OWNERSHIP_POINT_ORDER.indexOf(f.buyOwnershipStart);
  const eI = OWNERSHIP_POINT_ORDER.indexOf(f.sellOwnershipEnd);
  const pI = OWNERSHIP_POINT_ORDER.indexOf(point);
  if (sI === -1 || eI === -1 || pI === -1) return "owned";
  if (pI < sI) return "not_owned";
  if (pI > eI) return "handed_over";
  return "owned";
}
// On-the-fly journey for a lot that has a flow but no stored journey (seed/old lots).
function journeyForLot(lot: any, shipments: any[] = [], orders: any[] = []) {
  const base = (Array.isArray(lot.journey) && lot.journey.length > 0)
    ? lot.journey
    : (() => {
        const f = FLOW_TYPES[lot.flow];
        if (!f || !Array.isArray(f.stageTemplate)) return [];
        const load = lot.loadingDate || null;
        const arrive = lot.arrivalDate || null;
        const n = f.stageTemplate.length;
        return f.stageTemplate.map((st: any, i: number) => {
          let plannedDate: string | null = null;
          if (load && arrive && n > 1) {
            const t0 = new Date(load).getTime(), t1 = new Date(arrive).getTime();
            plannedDate = new Date(t0 + (t1 - t0) * (i / (n - 1))).toISOString().split("T")[0];
          } else if (i === 0) plannedDate = load;
          else if (i === n - 1) plannedDate = arrive;
          return { seq: i + 1, kind: st.kind, label: st.label, ownership: ownershipForStage(lot.flow, st.kind, f.stageTemplate, i), plannedDate, actualDate: null, status: "pending" };
        });
      })();
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

  return journey.map((s: any, i: number) => {
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
  }).map((s: any, i: number, arr: any[]) => {
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
function customsStagesForFlow(flow: string) {
  const f = FLOW_TYPES[flow];
  if (!f || !Array.isArray(f.stageTemplate)) return [];
  const kinds = f.stageTemplate.map((s: any) => s.kind);
  const out: string[] = [];
  if (kinds.includes("customs_export")) out.push("export");
  if (kinds.includes("customs_import")) out.push("import");
  return out;
}

const FLOW_GROUPS = [
  { id: "EXP", label: "EXPORT", color: "#16A34A" },
  { id: "IMP", label: "IMPORT", color: "#2563EB" },
];

const QUALITY_GRADES = ["I", "IB", "II", "Industrial"]; // Polish convention (Klasa I/IB/II/Industrial)

const PRODUCTS = [
  "Golden Delicious", "Red Bell Pepper", "Yellow Bell Pepper", "Green Bell Pepper",
  "Tomato Round", "Tomato Cherry", "Cucumber", "Courgette",
  "Aubergine", "Carrot", "Papryka Kapia", "Papryka Żółta", "Papryka Czerwona",
];

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
const today = new Date().toISOString().split("T")[0];

function locById(id) { return LOCATIONS.find(l => String(l.id) === String(id)); }

// ─── SO STUB ────────────────────────────────────────────────────────────────
// Mirrors the 5 seed SOs from SalesOrders.tsx so reservations show up realistically
// in this standalone module. Replaced with live SO state on integration.
// "Reserving" = SO status in RESERVING_SO_STATUSES (Confirmed and beyond, but not Cancelled, not Draft).
const RESERVING_SO_STATUSES = new Set([
  "Confirmed", "Reserved", "Loading", "Shipped", "Delivered", "Invoiced", "Closed",
]);

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

function productsMatch(a, b) {
  return (a || "").toLowerCase().trim() === (b || "").toLowerCase().trim();
}

// Returns: { liveAvailable, totalReserved, reservations: [{ soNumber, soId, status, clientName, qty }] }
// for a given lot, considering reservations from all SOs in RESERVING_SO_STATUSES
// matching the lot's product.
//
// Note: physicalKg is the lot's TRUE physical capacity (drops on SHIP_OUT movements).
// liveAvailable = physicalKg − reservations from SOs not yet Shipped+.
// Once an SO is Shipped+, the goods have physically left → physicalKg already dropped →
// that SO's reservation should NOT also subtract. We handle this by only counting
// reservations from SOs in Confirmed/Reserved/Loading (i.e. NOT yet physically dispatched).
const PRE_DISPATCH_STATUSES = new Set(["Confirmed", "Reserved", "Loading"]);

// Normalize an SO from either the standalone stub shape ({clientName}) or the real SO module
// shape ({client: {name, ...}}). Returns flat clientName for display.
function _soClientName(o) {
  if (o.clientName) return o.clientName;
  if (o.client && o.client.name) return o.client.name;
  return "—";
}

function lotReservations(lot, sourceSOs) {
  // Default to the module-scope SOS (standalone fallback); accept live SOs from shell.
  const list = sourceSOs ?? SOS;
  const reservations = [];
  let totalReserved = 0;
  list.forEach(o => {
    // Only Confirmed/Reserved/Loading count against the current physical pool.
    // Shipped+ SOs already had their kg physically subtracted via SHIP_OUT movements.
    if (!PRE_DISPATCH_STATUSES.has(o.status)) return;
    (o.items || []).forEach(it => {
      const matchesStock = it.sourceType === "STOCK" && it.sourceRef === lot.number;
      const matchesPOBackedLot = it.sourceType === "PO" && lot.poRef === it.sourceRef && productsMatch(it.product, lot.product);
      if (!matchesStock && !matchesPOBackedLot) return;
      if (!productsMatch(it.product, lot.product)) return;
      const q = parseFloat(it.qty) || 0;
      if (q <= 0) return;
      reservations.push({ soNumber: o.number, soId: o.id, status: o.status, clientName: _soClientName(o), qty: q, sourceType: it.sourceType });
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

export const INIT_LOTS = [
  // EXPORT — apples (CIF) — currently in port transit
  {
    id: 1, number: "LOT-2026-0091", product: "Golden Delicious", quality: "I", size: "70-80", origin: "Poland",
    flow: "EXP_CIF",
    poRef: "PO-2025-0468",
    locationId: 6, // Gdańsk Port
    expectedKg: 19500,
    receivedKg: 19422,      // what came in when received
    physicalKg: 19422,      // still physically present (in port transit, not yet dispatched)
    damagedKg: 0,
    packaging: "13 kg wooden box",
    status: "In Transit",
    arrivalDate: "2026-05-20", productionDate: "2026-05-18",
    costs: [
      { type: "purchase", label: "Purchase (PINV)",         source: "PINV-2026-0021", amount: 54381.60, currency: "PLN", pln: 54381.60 },
      { type: "freight",  label: "Inland freight (LINV)",   source: "LINV-2026-0008", amount: 2400.00,  currency: "PLN", pln: 2400.00 },
      { type: "customs",  label: "Export customs + phyto",  source: "CINV-2026-0003", amount: 187.00,   currency: "PLN", pln: 187.00 },
    ],
    movements: [
      { id: 1, date: "2026-05-19", type: "IN",       qtyKg: 19422, fromId: 3, toId: 3, note: "Loaded at producer, expected 19,500 kg" },
      { id: 2, date: "2026-05-20", type: "TRANSFER", qtyKg: 19422, fromId: 3, toId: 6, note: "Trucked to Gdańsk port" },
    ],
    notes: "EXW producer Białski Owoc. Sold CIF to overseas client. Vessel ETA destination: 2026-06-12.",
  },

  // Apples in our WH — has heavy SO reservations from seed SOs 1 & 2 (Biedronka + Lidl)
  // SO-2026-0094 (Delivered, 8000 kg) and SO-2026-0088 (Invoiced, 2400 kg) — both Shipped+, so they DON'T count vs liveAvailable
  // (their physical departure should have already been recorded via SHIP_OUT movements — see below)
  {
    id: 2, number: "LOT-2026-0091B", product: "Golden Delicious", quality: "I", size: "70-80", origin: "Poland",
    flow: "IMP_DDP_WH",
    poRef: "PO-2025-0470",
    locationId: 1, // WH-01 Poznań
    expectedKg: 22800,
    receivedKg: 22800,
    physicalKg: 12400,  // 22800 received − 8000 (SO-94) − 2400 (SO-88) shipped out = 12400 left physically
    damagedKg: 0,
    packaging: "13 kg wooden box",
    status: "In Stock",
    arrivalDate: "2026-04-28", productionDate: "2026-04-25",
    costs: [
      { type: "purchase", label: "Purchase (PINV)",         source: "PINV-2026-0019", amount: 11400.00, currency: "PLN", pln: 11400.00 },
      { type: "storage",  label: "Storage May 1-26 (alloc)", source: "WINV-2026-0002", amount: 386.00,   currency: "PLN", pln: 386.00 },
    ],
    movements: [
      { id: 1, date: "2026-04-28", type: "IN",       qtyKg: 22800, fromId: 3, toId: 1, note: "DDP delivery from Białski" },
      { id: 2, date: "2026-01-25", type: "SHIP_OUT", qtyKg: 8000,  fromId: 1, toId: 8, note: "Shipped for SO-2026-0094 (Biedronka DC Poznań)" },
      { id: 3, date: "2026-01-20", type: "SHIP_OUT", qtyKg: 2400,  fromId: 1, toId: 9, note: "Shipped for SO-2026-0088 (Lidl DC Chorzów)" },
    ],
    notes: "Apple lot for retailer chains. 12,400 kg still physically present.",
  },

  // Import carrots — In Stock, partially damaged
  {
    id: 3, number: "LOT-2026-0088", product: "Carrot", quality: "I", size: "60-100", origin: "Morocco",
    flow: "IMP_CIF_WH",
    poRef: "PO-2026-0118",
    locationId: 1,
    expectedKg: 24000,
    receivedKg: 23720,
    physicalKg: 23420,  // received 23720 − 300 damaged write-off = 23420 physically
    damagedKg: 300,
    packaging: "10 kg mesh bag",
    status: "In Stock",
    arrivalDate: "2026-05-15", productionDate: "2026-05-05",
    costs: [
      { type: "purchase", label: "Purchase (PINV)",                source: "PINV-2026-0024", amount: 4350.00,  currency: "EUR", pln: 18505.00 },
      { type: "freight",  label: "Port→WH freight (LINV)",         source: "LINV-2026-0010", amount: 1800.00,  currency: "PLN", pln: 1800.00 },
      { type: "customs",  label: "Import duties + VAT + phyto",    source: "CINV-2026-0004", amount: 2310.00,  currency: "PLN", pln: 2310.00 },
      { type: "storage",  label: "Storage May 1-15 (allocated)",   source: "WINV-2026-0002", amount: 142.00,   currency: "PLN", pln: 142.00 },
    ],
    movements: [
      { id: 1, date: "2026-05-14", type: "IN",       qtyKg: 23720, fromId: 5, toId: 6, note: "Arrived Gdańsk port from Morocco" },
      { id: 2, date: "2026-05-15", type: "TRANSFER", qtyKg: 23720, fromId: 6, toId: 1, note: "Customs cleared, trucked to WH-01" },
      { id: 3, date: "2026-05-22", type: "DAMAGE",   qtyKg: 300,   fromId: 1, toId: 1, note: "Quality check — 300 kg molded, write-off" },
    ],
    notes: "Expected 24,000 kg, received 23,720 (−280 kg, 1.2% variance). Will split across 3–4 retailers.",
  },

  // Import tomato — Shipped Out (whole lot delivered direct to Biedronka)
  {
    id: 4, number: "LOT-2026-0089", product: "Tomato Round", quality: "I", size: "M", origin: "Spain",
    flow: "IMP_CIF_DIR",
    poRef: "PO-2026-0120",
    locationId: 8, // Biedronka DC Poznań — direct flow, never our WH
    expectedKg: 18000,
    receivedKg: 17940,
    physicalKg: 0,  // entire lot dispatched direct
    damagedKg: 0,
    packaging: "5 kg carton",
    status: "Shipped Out",
    arrivalDate: "2026-05-23", productionDate: "2026-05-10",
    costs: [
      { type: "purchase", label: "Purchase (PINV)",                source: "PINV-2026-0025", amount: 8400.00,  currency: "EUR", pln: 35820.00 },
      { type: "freight",  label: "Port→client freight (LINV)",     source: "LINV-2026-0012", amount: 1450.00,  currency: "PLN", pln: 1450.00 },
      { type: "customs",  label: "Import customs (CINV)",          source: "CINV-2026-0005", amount: 1620.00,  currency: "PLN", pln: 1620.00 },
    ],
    movements: [
      { id: 1, date: "2026-05-21", type: "IN",       qtyKg: 17940, fromId: 4, toId: 6, note: "Arrived Gdańsk from Spain" },
      { id: 2, date: "2026-05-22", type: "TRANSFER", qtyKg: 17940, fromId: 6, toId: 8, note: "Customs cleared, direct to Biedronka" },
      { id: 3, date: "2026-05-23", type: "SHIP_OUT", qtyKg: 17940, fromId: 8, toId: 8, note: "POD signed at Biedronka DC Poznań" },
    ],
    notes: "Direct flow — never entered our WH. Full container sold to single client.",
  },

  // Papryka Kapia — heavy SO reservations from active SOs
  // SO-2026-0091 (Shipped, 6000 kg) — already departed, doesn't count vs liveAvailable
  // Result: 8500 received − 6000 SHIP_OUT = 2500 physically present, no pre-dispatch reservations → liveAvailable = 2500
  {
    id: 5, number: "LOT-2026-0086", product: "Papryka Kapia", quality: "I", size: "M", origin: "Jordania",
    flow: "IMP_EXWS_WH",
    poRef: "PO-2026-0117",
    locationId: 1, // moved into our WH after customs
    expectedKg: 8500,
    receivedKg: 8500,
    physicalKg: 2500,
    damagedKg: 0,
    packaging: "5 kg carton",
    status: "In Stock",
    arrivalDate: "2026-01-22", productionDate: "2026-01-18",
    costs: [
      { type: "purchase", label: "Purchase EXW (PINV)",            source: "PINV-2026-0008", amount: 8800.00,  currency: "USD", pln: 34155.00 },
      { type: "freight",  label: "Producer→port truck (LINV)",    source: "LINV-2026-0003", amount: 2100.00,  currency: "PLN", pln: 2100.00 },
      { type: "customs",  label: "Import duties + phyto",          source: "CINV-2026-0002", amount: 985.00,   currency: "PLN", pln: 985.00 },
    ],
    movements: [
      { id: 1, date: "2026-01-19", type: "IN",       qtyKg: 8500, fromId: 5, toId: 5, note: "Loaded at producer Agadir (EXW)" },
      { id: 2, date: "2026-01-20", type: "TRANSFER", qtyKg: 8500, fromId: 5, toId: 6, note: "Arrived Gdańsk" },
      { id: 3, date: "2026-01-22", type: "TRANSFER", qtyKg: 8500, fromId: 6, toId: 1, note: "Customs cleared, trucked to WH-01" },
      { id: 4, date: "2026-01-29", type: "SHIP_OUT", qtyKg: 6000, fromId: 1, toId: 14, note: "Shipped for SO-2026-0091 (Euro-Papryka)" },
    ],
    notes: "Origin Jordania. 2,500 kg still physically present in WH-01.",
  },

  // Red Bell Pepper — small remainder, post-shipout to Euro-Papryka
  {
    id: 6, number: "LOT-2026-0095", product: "Red Bell Pepper", quality: "I", size: "L", origin: "Jordania",
    flow: "IMP_DDP_WH",
    poRef: "PO-2026-0115",
    locationId: 2, // WH-02 Warszawa
    expectedKg: 2300,
    receivedKg: 2300,
    physicalKg: 1100,  // 2300 − 1200 (SO-91) shipped = 1100
    damagedKg: 0,
    packaging: "5 kg carton",
    status: "In Stock",
    arrivalDate: "2026-01-26", productionDate: "2026-01-22",
    costs: [
      { type: "purchase", label: "Purchase DDP (PINV)",            source: "PINV-2026-0007", amount: 9250.00,  currency: "EUR", pln: 39341.18 },
    ],
    movements: [
      { id: 1, date: "2026-01-26", type: "IN",       qtyKg: 2300, fromId: 4, toId: 2, note: "DDP delivery from FreshFarm ES" },
      { id: 2, date: "2026-01-29", type: "SHIP_OUT", qtyKg: 1200, fromId: 2, toId: 14, note: "Shipped for SO-2026-0091 (Euro-Papryka)" },
    ],
    notes: "1,100 kg remaining for further allocation.",
  },

  // Yellow Bell Pepper — small remainder after Euro-Papryka
  {
    id: 7, number: "LOT-2026-0099", product: "Yellow Bell Pepper", quality: "I", size: "L", origin: "Jordania",
    flow: "IMP_DDP_WH",
    poRef: "PO-2026-0116",
    locationId: 2,
    expectedKg: 4200,
    receivedKg: 4200,
    physicalKg: 600,  // 4200 − 3600 (SO-91) = 600
    damagedKg: 0,
    packaging: "5 kg carton",
    status: "In Stock",
    arrivalDate: "2026-01-26", productionDate: "2026-01-22",
    costs: [
      { type: "purchase", label: "Purchase DDP (PINV)",            source: "PINV-2026-0006", amount: 12000.00, currency: "EUR", pln: 51037.20 },
    ],
    movements: [
      { id: 1, date: "2026-01-26", type: "IN",       qtyKg: 4200, fromId: 4, toId: 2, note: "DDP delivery from FreshFarm ES" },
      { id: 2, date: "2026-01-29", type: "SHIP_OUT", qtyKg: 3600, fromId: 2, toId: 14, note: "Shipped for SO-2026-0091 (Euro-Papryka)" },
    ],
    notes: "600 kg remaining.",
  },

  // Expected lot (just-confirmed PO, not yet shipped)
  {
    id: 8, number: "LOT-2026-0100", product: "Red Bell Pepper", quality: "I", size: "L", origin: "Spain",
    flow: "IMP_DDP_WH",
    poRef: "PO-2026-0121",
    locationId: 4,
    expectedKg: 8000,
    receivedKg: 0,
    physicalKg: 0,
    damagedKg: 0,
    packaging: "5 kg carton",
    status: "Expected",
    arrivalDate: "2026-06-05", productionDate: null,
    costs: [
      { type: "purchase", label: "Purchase DDP (PINV — expected)", source: "PO-2026-0121", amount: 14800.00, currency: "EUR", pln: 62945.88 },
    ],
    movements: [],
    notes: "PO confirmed, supplier loading week of 2026-06-02. Expected DDP arrival 2026-06-05.",
  },
];

// ─── SHARED UI ATOMS ────────────────────────────────────────────────────────
function Inp({ value, onChange = () => {}, type = "text", placeholder = "", style = {} }: any) {
  const base = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: "#fff" };
  return <input value={value || ""} onChange={onChange} type={type || "text"} placeholder={placeholder} style={{ ...base, ...style }} />;
}
function Sel({ value, onChange = () => {}, children, style = {} }: any) {
  const base = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: "#fff" };
  return <select value={value || ""} onChange={onChange} style={{ ...base, ...style }}>{children}</select>;
}
function Lbl({ children }: any) {
  return <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>{children}</label>;
}
function Card({ children, style = {} }: any) {
  return <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "18px 20px", ...style }}>{children}</div>;
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
function LocationPill({ locationId }: any) {
  const loc = locById(locationId);
  if (!loc) return <span style={{ color: "#CCC" }}>—</span>;
  const t = locType(loc.type);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#444" }}>
      <span style={{ fontSize: 11 }}>{t.icon}</span>
      <span style={{ fontWeight: 500 }}>{loc.name}</span>
    </span>
  );
}
function FlowBadge({ flow, compact = false }: any) {
  const f = FLOW_TYPES[flow];
  if (!f) return null;
  if (compact) {
    return <span title={f.desc} style={{ background: "#F9FAFB", border: "1px solid #EBEBEB", padding: "1px 7px", borderRadius: 4, fontSize: 10.5, color: "#555", whiteSpace: "nowrap" }}>{f.emoji} {f.short}</span>;
  }
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px", background: "#F9FAFB", border: "1px solid #EBEBEB", borderRadius: 8 }}>
      <span style={{ fontSize: 14 }}>{f.emoji}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#111" }}>{f.short}</div>
        <div style={{ fontSize: 10.5, color: "#888" }}>{f.desc}</div>
      </div>
    </div>
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

function fmtNum(n) {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return Number(n).toLocaleString("pl-PL");
}
function parseNum(v, fallback = 0) {
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}
function fmtMoney(n, cur = "PLN") {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return `${Number(n).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}
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
  let receivedKg = 0, physicalKg = 0, damagedKg = 0;
  let locationId = lot.baseLocationId ?? lot.locationId;
  let status = lot.expectedKg && movements.length === 0 ? "Expected" : (lot.status || "Expected");
  const ordered = [...movements].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || (a.id || 0) - (b.id || 0));
  let sawIn = false, sawShipOut = false;
  ordered.forEach(m => {
    const q = parseNum(m.qtyKg);
    switch (m.type) {
      case "IN": receivedKg += q; physicalKg += q; locationId = m.toId; sawIn = true; break;
      case "TRANSFER": locationId = m.toId; break;
      case "SHIP_OUT": physicalKg = Math.max(0, physicalKg - q); locationId = m.toId || locationId; sawShipOut = true; break;
      case "REVERSAL": physicalKg += q; break;
      case "DAMAGE": physicalKg = Math.max(0, physicalKg - q); damagedKg += q; break;
      case "RECLASS": break;
      default: break;
    }
  });
  // Derive status from the final physical state + location.
  // v6.3.0 fix: locById returns the shared (rich) taxonomy — the legacy OWN/PORT/CLIENT
  // strings this logic was written against now live in legacyType.
  const loc = locById(locationId);
  const legacyLocType = (loc as any)?.legacyType || loc?.type;
  if (sawShipOut && physicalKg === 0) status = "Shipped Out";
  else if (sawIn || physicalKg > 0) {
    if (legacyLocType === "OWN") status = "In Stock";
    else if (legacyLocType === "PORT") status = "Customs";
    else if (legacyLocType === "CLIENT") status = "Shipped Out";
    else status = "In Transit";
  } else if (movements.length === 0 && lot.expectedKg) {
    status = "Expected";
  }
  return { ...lot, movements: ordered, receivedKg, physicalKg, damagedKg, locationId, status };
}

// ─── MOVEMENT MODAL ─────────────────────────────────────────────────────────
function MovementModal({ lot, liveSOs = [], editing = null, onCancel, onConfirm }: any) {
  // Default to TRANSFER for in-stock lots; IN for Expected/Direct Expected lots
  // (v6.3.0 fix — "Direct Expected" previously fell through to TRANSFER whose max
  // was 0 kg, making every quantity error out). In edit mode, prefill.
  const isExpectedLike = lot.status === "Expected" || lot.status === "Direct Expected";
  const [type, setType] = useState(editing?.type || (isExpectedLike ? "IN" : "TRANSFER"));
  const [qty, setQty] = useState(editing ? String(editing.qtyKg ?? "") : "");
  const [fromId, setFromId] = useState(editing?.fromId ?? lot.locationId);
  const [toId, setToId] = useState(editing?.toId ?? lot.locationId);
  const [note, setNote] = useState(editing?.note || "");
  const [date, setDate] = useState(editing?.date || today);
  const reservationState = lotReservations(lot, liveSOs);
  const liveAvailableKg = reservationState.liveAvailable;
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
    SHIP_OUT: (liveAvailableKg || 0) + selfQty,
    DAMAGE:   physicalBasis + selfQty,
    RECLASS:  physicalBasis + selfQty,
  };
  const max = maxByType[type];
  const qtyNum = parseFloat(qty) || 0;
  const isInvalid = qtyNum <= 0 || qtyNum > max;
  const typeInfo = MOVEMENT_TYPES[type] || {};
  const showRoute = type === "TRANSFER" || type === "IN" || type === "SHIP_OUT";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#fff", borderRadius: 14, width: 540, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #EBEBEB" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{editing ? "Edit movement" : "Record movement"}</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{lot.number} · {lot.product} · received {(lot.receivedKg || 0).toLocaleString()} kg, physical {(lot.physicalKg || 0).toLocaleString()} kg</div>
        </div>
        <div style={{ padding: 24 }}>
          <div style={{ padding: "10px 12px", background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 8, fontSize: 11.5, color: "#92400E", lineHeight: 1.5, marginBottom: 16 }}>
            <strong>Movement or Shipment?</strong> Record a movement here when the goods move but <strong>we don't arrange the transport</strong> — e.g. an <strong>EXW sale where the client collects with their own truck</strong> (use "Ship Out"), or for receipts, transfers between locations, and stock corrections. If <strong>we book / pay for / document the transport</strong> (carrier, freight cost, transport order), create it from <strong>Shipments</strong> instead, so the cost and paperwork stay linked to the lot.
          </div>

          <div style={{ marginBottom: 4 }}><Lbl>Movement type</Lbl>
            <Sel value={type} onChange={e => setType(e.target.value)}>
              {Object.entries(MOVEMENT_TYPES).filter(([k]) => k !== "REVERSAL").map(([k, v]: any) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
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
              <Inp value={date} onChange={e => setDate(e.target.value)} type="date" />
            </div>
          </div>

          {showRoute && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 24px 1fr", gap: 8, alignItems: "end", marginBottom: 12 }}>
              <div>
                <Lbl>{type === "IN" ? "Received from" : "From"}</Lbl>
                <Sel value={fromId} onChange={e => setFromId(parseInt(e.target.value))}>
                  {LOCATIONS.map(l => <option key={l.id} value={l.id}>{locType(l.type).icon} {l.name}</option>)}
                </Sel>
              </div>
              <div style={{ textAlign: "center", paddingBottom: 9, color: "#94A3B8", fontSize: 16 }}>→</div>
              <div>
                <Lbl>{type === "SHIP_OUT" ? "Shipped to" : "To"}</Lbl>
                <Sel value={toId} onChange={e => setToId(parseInt(e.target.value))}>
                  {LOCATIONS.map(l => <option key={l.id} value={l.id}>{locType(l.type).icon} {l.name}</option>)}
                </Sel>
              </div>
            </div>
          )}

          <div style={{ marginBottom: 18 }}>
            <Lbl>Note</Lbl>
            <Inp value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Reserved for SO-2026-0094 (Biedronka)" />
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
            <button onClick={() => onConfirm({ id: editing?.id, type, qtyKg: qtyNum, fromId, toId, note, date })} disabled={isInvalid}
              style={{ flex: 1, padding: "10px", border: "none", borderRadius: 8, background: isInvalid ? "#D1D5DB" : "#111", color: "#fff", fontSize: 13, fontWeight: 600, cursor: isInvalid ? "not-allowed" : "pointer" }}>
              {editing ? "Save changes" : "Record movement"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CUSTOMS MODAL (v6.1d) ──────────────────────────────────────────────────
function CustomsModal({ lot, kind, brokers = [], onCancel, onConfirm }: any) {
  const existing = (lot.customs && lot.customs[kind]) || {};
  const [status, setStatus] = useState(existing.status || "Not started");
  const [declRef, setDeclRef] = useState(existing.declRef || "");
  const [brokerId, setBrokerId] = useState(existing.brokerId || "");
  const [date, setDate] = useState(existing.date || "");
  const [cost, setCost] = useState(existing.cost != null ? String(existing.cost) : "");
  const [currency, setCurrency] = useState(existing.currency || "PLN");
  const title = kind === "export" ? "Export customs clearance" : "Import customs clearance";
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 90, padding: 20 }}>
      <div style={{ width: 480, background: "#fff", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.24)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #EBEBEB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>🛃 {title}</strong>
          <span style={{ fontSize: 12, color: "#888" }}>{lot.number}</span>
        </div>
        <div style={{ padding: 20, display: "grid", gap: 12 }}>
          <div><Lbl>Status</Lbl><Sel value={status} onChange={e => setStatus(e.target.value)}>{["Not started", "In progress", "Cleared", "Held"].map(s => <option key={s}>{s}</option>)}</Sel></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><Lbl>Declaration ref (SAD / MRN)</Lbl><Inp value={declRef} onChange={e => setDeclRef(e.target.value)} placeholder="e.g. 26PL..." /></div>
            <div><Lbl>Clearance date</Lbl><Inp type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          </div>
          <div><Lbl>Customs broker</Lbl><Sel value={brokerId} onChange={e => setBrokerId(e.target.value)}><option value="">— none —</option>{brokers.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</Sel></div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
            <div><Lbl>Customs cost (flows into lot cost)</Lbl><Inp type="number" value={cost} onChange={e => setCost(e.target.value)} placeholder="0" /></div>
            <div><Lbl>Currency</Lbl><Sel value={currency} onChange={e => setCurrency(e.target.value)}><option>PLN</option><option>EUR</option><option>USD</option></Sel></div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button onClick={onCancel} style={{ flex: 1, padding: "10px", border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button onClick={() => onConfirm(kind, { status, declRef, brokerId: brokerId ? parseInt(brokerId) : null, date, cost: parseFloat(cost) || 0, currency })} style={{ flex: 1, padding: "10px", border: "none", borderRadius: 8, background: "#DB2777", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Save clearance</button>
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
          <span style={{ fontSize: 12, color: "#888" }}>{lot.number} · {lot.product}</span>
        </div>
        <div style={{ padding: 20, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
            <div><Lbl>When / context</Lbl><Sel value={context} onChange={e => setContext(e.target.value)}>{INSPECTION_CONTEXTS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</Sel></div>
            <div><Lbl>Date</Lbl><Inp type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
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
function LotDetail({ lot, onBack, onMove, onEditMovement, onDeleteMovement, onDelete, onCustoms, onInspect, liveSOs, shipments }: any) {
  const res = lotReservations(lot, liveSOs);
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
          <button onClick={onDelete} style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid #FECACA", color: "#DC2626", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Delete</button>
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
              <div style={{ fontSize: 14, color: "#444" }}>{lot.product} · {lot.size || "—"} · {lot.origin || "—"} · {lot.packaging}</div>
              <div style={{ marginTop: 10 }}><FlowBadge flow={lot.flow} /></div>
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

          {/* Reservations card — only shown when there are live reservations */}
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
                      const labelText = standardStageLabel(s.kind, lot.flow);
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
                                ? `${s.actualDate || s.plannedDate || ""} · done`
                                : active
                                  ? `${s.plannedDate ? "planned " + s.plannedDate : "date TBA"} · in progress`
                                  : `${s.plannedDate ? "planned " + s.plannedDate : "date TBA"}`}
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
                const kinds = customsStagesForFlow(lot.flow);
                if (kinds.length === 0) return null;
                const customs = lot.customs || {};
                const statusColor = (st: string) => st === "Cleared" ? { c: "#16A34A", bg: "#DCFCE7" } : st === "In progress" ? { c: "#D97706", bg: "#FEF3C7" } : st === "Held" ? { c: "#DC2626", bg: "#FEE2E2" } : { c: "#6B7280", bg: "#F3F4F6" };
                return (
                  <Card style={{ marginBottom: 16 }}>
                    <SectionTitle>CUSTOMS</SectionTitle>
                    {kinds.map((k) => {
                      const c = customs[k] || {};
                      const st = c.status || "Not started";
                      const sc = statusColor(st);
                      return (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid #F3F4F6" }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>🛃 {k === "export" ? "Export clearance" : "Import clearance"}</div>
                            <div style={{ fontSize: 11, color: "#888", marginTop: 3 }}>
                              {c.declRef ? `Ref ${c.declRef}` : "No declaration ref"}{c.date ? ` · ${c.date}` : ""}
                              {c.cost ? ` · ${fmtNum(c.cost)} ${c.currency || "PLN"}` : ""}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: sc.c, background: sc.bg, padding: "2px 9px", borderRadius: 10 }}>{st}</span>
                            <button onClick={() => onCustoms(k)} style={{ fontSize: 11, padding: "4px 10px", border: "1px solid #2563EB", background: "#fff", borderRadius: 6, cursor: "pointer", color: "#2563EB", fontWeight: 600 }}>Edit</button>
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ fontSize: 10.5, color: "#AAA", marginTop: 8, fontStyle: "italic" }}>Customs cost entered here flows into the lot's cost breakdown and marks the matching journey stage.</div>
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
                      return (
                        <div key={i} style={{ display: "flex", gap: 14, paddingBottom: 14, position: "relative" }}>
                          <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#fff", border: `2px solid ${mt.color}`, color: mt.color, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, zIndex: 1 }}>{mt.icon}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                              <div style={{ fontSize: 12.5 }}>
                                <span style={{ fontWeight: 600, color: mt.color }}>{mt.label}</span>
                                <span style={{ color: "#444", marginLeft: 6 }}>· {fmtNum(m.qtyKg)} kg</span>
                                {isMove && <span style={{ color: "#666", marginLeft: 6 }}>· {fromLoc?.name} → {toLoc?.name}</span>}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                                <span style={{ fontSize: 11, color: "#AAA" }}>{m.date}</span>
                                {onEditMovement && <button onClick={() => onEditMovement(m)} title="Edit movement" style={{ fontSize: 10.5, padding: "2px 7px", border: "1px solid #2563EB", background: "#fff", borderRadius: 5, cursor: "pointer", color: "#2563EB", fontWeight: 600 }}>Edit</button>}
                                {onDeleteMovement && <button onClick={() => onDeleteMovement(m.id)} title="Delete movement" style={{ fontSize: 10.5, padding: "2px 7px", border: "1px solid #FECACA", background: "#fff", borderRadius: 5, cursor: "pointer", color: "#DC2626" }}>✕</button>}
                              </div>
                            </div>
                            {m.note && <div style={{ fontSize: 11.5, color: "#888", marginTop: 2 }}>{m.note}</div>}
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
                    <LocationPill locationId={lot.locationId} />
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
                          Production: <span style={{ fontWeight: 500 }}>{lot.productionDate || "—"}</span><br />
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
export default function Inventory({ lots: extLots, setLots: extSetLots, allOrders: extOrders, contacts: extContacts = [], shipments: extShipments = [] }: any = {}) {
  // Integration mode: parent passes lots state and live SOs. Standalone: local seed + module-scope SOS.
  const [localLots, setLocalLots] = useState(INIT_LOTS);
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
  const [editingMovement, setEditingMovement] = useState(null);
  const [showCustoms, setShowCustoms] = useState(null); // "export" | "import" | null
  const [showInspection, setShowInspection] = useState(false);
  const [search, setSearch] = useState("");
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
    return lots.filter(l => {
      const loc = locById(l.locationId);
      if (filterStatus === "inPossession" && !inPossessionStatuses.has(l.status)) return false;
      if (filterStatus !== "all" && filterStatus !== "inPossession" && l.status !== filterStatus) return false;
      if (filterLocationType !== "All" && loc?.type !== filterLocationType) return false;
      if (filterProduct !== "All" && l.product !== filterProduct) return false;
      if (filterQuality !== "All" && l.quality !== filterQuality) return false;
      if (q) {
        const soList = soRefsFor(l, liveSOs, shipments).map(s => s.number).join(" ");
        const hay = `${l.number} ${l.product} ${l.poRef || ""} ${soList} ${loc?.name || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [lots, liveSOs, search, filterStatus, filterLocationType, filterProduct, filterQuality]);

  // ── mutations ───────────────────────────────────────────────────────
  function recordMovement({ id, type, qtyKg, fromId, toId, note, date }: any) {
    setLots(prev => prev.map(l => {
      if (l.id !== selected.id) return l;
      // Capture a stable base location for replay (origin before any movement).
      const baseLocationId = l.baseLocationId ?? (l.movements?.[0]?.fromId ?? l.locationId);
      let movements;
      if (id != null) {
        // EDIT: replace the existing movement by id.
        movements = (l.movements || []).map(m => m.id === id ? { ...m, type, qtyKg, fromId, toId, note, date } : m);
      } else {
        // ADD: append a new movement.
        movements = [...(l.movements || []), { id: Date.now(), date: date || today, type, qtyKg, fromId, toId, note }];
      }
      // Recompute all derived quantities/status/location from the full movement list.
      return recomputeLotFromMovements({ ...l, baseLocationId }, movements);
    }));
    setShowMovement(false);
    setEditingMovement(null);
  }

  function deleteMovement(movId) {
    if (!window.confirm("Delete this movement? Stock will be recalculated.")) return;
    setLots(prev => prev.map(l => {
      if (l.id !== selected.id) return l;
      const baseLocationId = l.baseLocationId ?? (l.movements?.[0]?.fromId ?? l.locationId);
      const movements = (l.movements || []).filter(m => m.id !== movId);
      return recomputeLotFromMovements({ ...l, baseLocationId }, movements);
    }));
  }

  function saveCustoms(kind, data) {
    setLots(prev => prev.map(l => {
      if (l.id !== selected.id) return l;
      const customs = { ...(l.customs || {}), [kind]: data };
      // Mirror the customs cost into the lot's cost breakdown (replace any prior
      // customs cost line for this kind, so editing doesn't double-count).
      const tag = kind === "export" ? "Export customs" : "Import customs";
      const fx = data.currency === "PLN" ? 1 : data.currency === "EUR" ? 4.25 : 3.9;
      const otherCosts = (l.costs || []).filter(c => c.label !== tag);
      const costs = data.cost > 0
        ? [...otherCosts, { type: "customs", label: tag, source: data.declRef || "customs", amount: data.cost, currency: data.currency, pln: Math.round(data.cost * fx * 100) / 100 }]
        : otherCosts;
      const next = { ...l, customs, costs };
      return next;
    }));
    setShowCustoms(null);
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
        movements = [...movements, { id: Date.now(), date: data.date || today, type: "DAMAGE", qtyKg: data.lossKg, fromId: l.locationId, toId: l.locationId, note: `${label}${data.findings ? " — " + data.findings : ""}` }];
      }
      const recomputed = recomputeLotFromMovements({ ...l, baseLocationId, inspections }, movements);
      return recomputed;
    }));
    setShowInspection(false);
  }

  function deleteLot() {
    if (!selected) return;
    if (!window.confirm(`Delete lot ${selected.number}? It will be soft-deleted.`)) return;
    setLots(prev => prev.filter(l => l.id !== selected.id));
    setSelectedId(null);
    setView("list");
  }

  // ── routes ──────────────────────────────────────────────────────────
  if (view === "detail" && selected) {
    const brokers = (extContacts || []).filter((c: any) => c.type === "Broker" || c.type === "Forwarder" || (c.services || []).includes("Customs"));
    return (
      <>
        {showMovement && <MovementModal lot={selected} liveSOs={liveSOs} editing={editingMovement} onCancel={() => { setShowMovement(false); setEditingMovement(null); }} onConfirm={recordMovement} />}
        {showCustoms && <CustomsModal lot={selected} kind={showCustoms} brokers={brokers} onCancel={() => setShowCustoms(null)} onConfirm={saveCustoms} />}
        {showInspection && <InspectionModal lot={selected} onCancel={() => setShowInspection(false)} onConfirm={saveInspection} />}
        <LotDetail
          lot={selected}
          onBack={() => { setView("list"); setSelectedId(null); }}
          onMove={() => { setEditingMovement(null); setShowMovement(true); }}
          onEditMovement={(m: any) => { setEditingMovement(m); setShowMovement(true); }}
          onDeleteMovement={deleteMovement}
          onCustoms={(k: any) => setShowCustoms(k)}
          onInspect={() => setShowInspection(true)}
          onDelete={deleteLot}
          liveSOs={liveSOs}
          shipments={extShipments}
        />
      </>
    );
  }

  // ── list view ───────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#FAFAFA" }}>
      {/* Top bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", flexShrink: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>Inventory Lots</div>
        <div style={{ marginLeft: "auto", fontSize: 12, color: "#AAA" }}>Phase 1 — lot tracking · cost view · movements</div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 20 }}>
          <Card>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>IN STOCK</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#111", marginTop: 6 }}>{fmtNum(Math.round(totalKgInStock))} <span style={{ fontSize: 14, color: "#888", fontWeight: 600 }}>kg</span></div>
            <div style={{ fontSize: 11, color: "#AAA", marginTop: 4 }}>{inStock.length} active lots</div>
          </Card>
          <Card>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>STOCK VALUE</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#16A34A", marginTop: 6 }}>{fmtMoney(totalValueInStock)}</div>
            <div style={{ fontSize: 11, color: "#AAA", marginTop: 4 }}>at cost basis</div>
          </Card>
          <Card>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>AT PORT / CUSTOMS</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: lotsAtPort > 0 ? "#D97706" : "#111", marginTop: 6 }}>{lotsAtPort}</div>
            <div style={{ fontSize: 11, color: "#AAA", marginTop: 4 }}>awaiting clearance</div>
          </Card>
          <Card>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>WITH VARIANCE</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: lotsWithVariance > 0 ? "#D97706" : "#111", marginTop: 6 }}>{lotsWithVariance}</div>
            <div style={{ fontSize: 11, color: "#AAA", marginTop: 4 }}>actual ≠ expected ≥1%</div>
          </Card>
          <Card>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>DAMAGED</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: totalDamagedKg > 0 ? "#DC2626" : "#111", marginTop: 6 }}>{fmtNum(totalDamagedKg)} <span style={{ fontSize: 14, color: "#888", fontWeight: 600 }}>kg</span></div>
            <div style={{ fontSize: 11, color: "#AAA", marginTop: 4 }}>across all lots</div>
          </Card>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search lot ref, product, PO/SO, location…" style={{ flex: "1 1 280px", minWidth: 260, border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 14px", fontSize: 13, outline: "none", background: "#fff" }} />
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#AAA", fontWeight: 700, letterSpacing: "0.06em", marginRight: 4 }}>STATUS</span>
          <button onClick={() => setFilterStatus("inPossession")} style={chipStyle(filterStatus === "inPossession")}>In our possession</button>
          <button onClick={() => setFilterStatus("all")} style={chipStyle(filterStatus === "all")}>All</button>
          {Object.keys(LOT_STATUSES).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} style={chipStyle(filterStatus === s, LOT_STATUSES[s].color)}>{s}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#AAA", fontWeight: 700, letterSpacing: "0.06em", marginRight: 4 }}>LOCATION</span>
          {["All", ...Object.keys(LOCATION_TYPES)].map(t => (
            <button key={t} onClick={() => setFilterLocationType(t)} style={chipStyle(filterLocationType === t)}>
              {t === "All" ? "All" : `${locType(t).icon} ${locType(t).label}`}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#AAA", fontWeight: 700, letterSpacing: "0.06em", marginRight: 4 }}>PRODUCT</span>
          {["All", ...PRODUCTS].map(p => (
            <button key={p} onClick={() => setFilterProduct(p)} style={chipStyle(filterProduct === p)}>{p}</button>
          ))}
          <span style={{ fontSize: 10, color: "#AAA", fontWeight: 700, letterSpacing: "0.06em", marginLeft: 16, marginRight: 4 }}>QUALITY</span>
          {["All", ...QUALITY_GRADES].map(q => (
            <button key={q} onClick={() => setFilterQuality(q)} style={chipStyle(filterQuality === q)}>{q === "All" ? "All" : `Kl. ${q}`}</button>
          ))}
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
            const loc = locById(l.locationId);
            const cpk = costPerKg(l);
            const res = lotReservations(l, liveSOs);
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
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#111" }}>{l.product}</div>
                  <div style={{ fontSize: 11, color: "#AAA" }}>{l.size || "—"} · {l.origin || "—"} · {l.packaging}</div>
                </div>
                <div><QualityBadge quality={l.quality} /></div>
                <div><StatusBadge status={l.status} /></div>
                <div>
                  <LocationPill locationId={l.locationId} />
                  <div style={{ marginTop: 3 }}><FlowBadge flow={l.flow} compact /></div>
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
                  {l.poRef && <div style={{ fontSize: 11, color: "#1D4ED8", fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 600 }}>{l.poRef}</div>}
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
function chipStyle(active, accent = "#111") {
  return {
    padding: "4px 10px", borderRadius: 6, border: "1px solid", borderColor: active ? "#111" : "#E5E7EB",
    background: active ? "#111" : "#fff", color: active ? "#fff" : (accent || "#555"),
    fontSize: 11, cursor: "pointer", fontWeight: 500, fontFamily: "inherit",
  };
}
