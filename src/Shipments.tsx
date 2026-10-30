import { fillEmptyPlaces, termsToReview, deliveredAtDestination , expectedDocuments } from "./incoterms.domain";   // v7.9.2 · v7.20.0 (A-INC-2): the incoterm review
import { TermsReviewList, TERMS_REVIEW } from "./TermsReview";   // v7.20.0 (A-INC-2)
import { statusWord } from "./format";
import { ModuleHeader, ActionButton, notifySaved, DocRef } from "./ui";
import React, { useMemo, useState } from "react";
import { exportRowsToXlsx, stamp as xlsStamp } from "./exportXlsx";

import DateInput from "./DateInput";
import { postShipmentToLots, derivePurpose, syncLegFreightCostLines, legFreightSource, findLotForSOLine, carriedRefs } from "./shipments.domain";
import { grossForGoodsLine, PACKAGING_SEED } from "./packaging.domain";
import { recomputeLotFromMovements } from "./inventory.domain";
import LoadingProtocolModal from "./LoadingProtocolModal";
import { protocolsForShipment, upsertProtocol, poGateReason } from "./loadingProtocol.domain";
import { isCancelled, liveOnly, releaseSummaryText } from "./cancellation.domain";
import { shipmentPostBlockReason, newestFirst } from "./moduleGuards.domain";
import { overShipReport, derivedBillingStatus } from "./shipments.domain";
import { setFxFallback, applyStuffingReport, spawnFromDevanning, stampEvent, costLinesByCarrierLeg, carrierOfUnit, shipmentDates, unitLoadedAt, unitUnloadedAt } from "./shipmentModel.domain";

import { blankClaim, nextClaimNumber } from "./claims.domain";
import { SmallButton, useConfirm } from "./ui";
import { allocateShipmentCostsToLots, shipmentLotRefs as engineShipmentLotRefs, shipmentAllocationSourcePrefix, removeCostsBySource } from "./costAllocation";
import { nextId } from "./ids";
import { resolveFxRate, defaultFxRate, documentFxDefault , rateOf } from "./fx";
import { unifiedLocations, locationById, placeGroup } from "./locations";
import { localTodayISO, formatDMY } from "./dates";
import { recordAudit } from "./audit";
import { isArchived, DEFAULT_SEASON } from "./season.domain";
import PlanningSheet from "./PlanningSheet";   // v6.99.63 — ShipmentBoard (the live view) kept in the repository for the later connection
import { isEstimatedLine } from "./so.domain";
import { companyForTransportOrder } from "./useLocalStoredState";
import { EditShipmentModal } from "./ShipmentEditor";
import CustomsImportModal from "./CustomsImportModal";
import { clientReportKg } from "./seasonOps.domain";   // v6.99.87   // v6.99.72 (A-CU-3)
import { CreateShipmentModal } from "./ShipmentCreate";
import { ShipmentDetail } from "./ShipmentDetail";
import { TransportOrderPrintModal, TransportOrderEmailModal } from "./ShipmentDocuments";
import { parseNum as sharedParseNum } from "./numbers";   // v7.38.0 (AUD3-B6)
import { RatesToReviewPanel } from "./RatesToReviewPanel";   // v7.33.2 (FX-1)
import { PlaceRepairPanel } from "./PlaceRepairPanel";   // v7.28.8 (FZ-36)
import { poExpectedArrival } from "./po.domain";   // v7.28.5 (Batch L)
import { peopleOf, rolesOf, companyAddressLine, companyCountryName } from "./counterparty.domain";   // v7.28.2 (Batch L)
import { outstandingCustoms } from "./customs.domain";   // v7.10.4 (A-RV-15)
import { soClientName } from "./salesOrders.domain";   // v7.23.5 (A-SHV-1)
import { issueNumbers, issueNumber } from "./numbering";
import { Sel } from "./ui";   // v7.44.0 (AUD3 redundancy): one copy, in ui.tsx
import { Lbl } from "./ui";   // v7.44.0 (AUD3 redundancy): one copy, in ui.tsx
import { Card } from "./ui";   // v7.44.0 (AUD3 redundancy): one copy, in ui.tsx
import { SectionTitle } from "./ui";   // v7.27.8 (A-W5)
const CUSTOMS_OPEN = "Customs open";   // v7.10.4 (A-RV-15): the Shipments list filter for clearances not yet Cleared
// v6.92.0 (A-R8-18): expected freight lines per CARRIER × LEG replace the per-leg line when any unit carries a price.
// v7.22.4 (A-RV-16): no hidden copy of the counterparties — costLinesByCarrierLegApply takes them as a parameter
/** v6.99.7 (A-R9-11): the most a goods row may carry = its source line's kg minus what OTHER live shipments already carry of that line. */
export function goodsRowCap(g: any, draft: any, orders: any[] = [], pos: any[] = [], otherShipments: any[] = []): number | null {   // v7.22.4 (A-RV-16): the other shipments come as a parameter
  const parse = (v: any): number => parseNum(v);   // v7.22.2 (FZ-22): one reader for every number — spaces and a decimal comma read the same everywhere
  let lineKg: number | null = null;
  if (g?.soRef) { const so = (orders || []).find((o: any) => String(o.number) === String(g.soRef)); const it = so && (so.items || []).find((x: any, i: number) => String(x.id ?? i + 1) === String(g.soLineId) || (g.soLineId == null && String(x.product).toLowerCase() === String(g.product).toLowerCase())); if (it) lineKg = parse(it.qty); }
  else if (g?.poRef) { const po = (pos || []).find((p: any) => String(p.number) === String(g.poRef)); const it = po && (po.items || []).find((x: any, i: number) => String(x.id ?? i + 1) === String(g.poLineId)); if (it) lineKg = parse(it.qty); }
  if (lineKg == null) return null;
  const carriedElsewhere = (otherShipments || []).filter((s: any) => s && s.id !== draft.id && String(s.status) !== "Cancelled").reduce((sum: number, s: any) => sum + (s.goods || []).filter((x: any) => (g.soRef && String(x.soRef) === String(g.soRef) && String(x.soLineId ?? "") === String(g.soLineId ?? "")) || (!g.soRef && g.poRef && String(x.poRef) === String(g.poRef) && String(x.poLineId ?? "") === String(g.poLineId ?? ""))).reduce((a: number, x: any) => a + parse(x.qtyKg), 0), 0);
  return Math.max(0, lineKg - carriedElsewhere);
}

export function allUnitsCarrierNames(sh: any, contacts: any[]): string[] {
  const out: string[] = [];
  (sh?.legs || []).forEach((l: any) => (l.vehicles || []).forEach((u: any) => { const id = u.carrierId ?? l.carrierId ?? l.forwarderId; const c = (contacts || []).find((x: any) => String(x.id) === String(id)); if (c) out.push(c.name); }));
  return out;
}
setFxFallback((cur: string) => documentFxDefault(cur));
export function costLinesByCarrierLegApply(sh: any, payers: Array<{ payer: string }> | undefined, contacts: any[]): any {   // v7.19.0 (A-INC-1): payers = incoterms.legFreightPayers
  const anyPriced = (sh.legs || []).some((l: any) => (l.vehicles || []).some((u: any) => parseNum(u?.costAmount, 0) > 0));
  if (!anyPriced) return syncLegFreightCostLines(sh, payers);
  return { ...sh, costs: costLinesByCarrierLeg(sh, (id: any) => ((contacts || []).find((c: any) => String(c.id) === String(id)) || {}).name || "", payers) };
}


// MARIANNA ERP - Shipments / Logistics module
// Standalone-friendly: when no props are passed it starts empty (demo seeds moved out of the bundle in v6.32.0).
// fallback providers, POs, SOs and lots. In the shell, App.tsx passes live state.

export const COMPANY: any = companyForTransportOrder();   // v6.99.67 (A-AUD-1): the letterhead derives from the ONE company profile (Settings); its former literal is the default

export { LOGO_DATA_URL } from "./brand";   // v7.43.0 (AUD3 redundancy): the logo once, in brand.tsx (was embedded here too)

export const STATUS_ORDER = ["Booked", "Confirmed", "Loaded", "Arrived", "Delivered", "Closed", "Cancelled"];
const SHIPMENT_STATUSES = {
  Booked:    { bg: "#DBEAFE", color: "#2563EB" },
  Confirmed: { bg: "#E0F2FE", color: "#0284C7" },
  Loaded:    { bg: "#ECFCCB", color: "#65A30D" },
  Arrived:   { bg: "#DCFCE7", color: "#16A34A" },
  Delivered: { bg: "#D1FAE5", color: "#059669" },
  Closed:    { bg: "#111827", color: "#FFFFFF" },
  Cancelled: { bg: "#FEE2E2", color: "#DC2626" },
};

export const HEADER_MODES = ["Road", "Sea", "Rail", "Air", "Multimodal"];
export const LEG_MODES = ["Road", "Sea", "Rail", "Air"];

// Sentinel for a road leg whose carrier has not been chosen yet. Kept DISTINCT
// from any forwarder id so the two legs never merge onto one transport order.
const TBD_CARRIER_ID = "TBD_CARRIER";
export const LEG_STATUSES = ["Booked", "Confirmed", "Loaded", "In Transit", "Arrived", "Delivered", "Cancelled"];

// v6.43.0 (test-round #8): a Delivered/Closed shipment shouldn't show legs still
// sitting at "Booked"/"Loaded" — once the whole shipment has arrived and closed,
// each leg has, by definition, completed. Derive a DISPLAY status that cascades a
// terminal shipment status onto its legs (stored leg.status is left untouched;
// this is display-only, consistent with the derived-truth model).
// v6.50.0: generalised. Marking a shipment Loaded left a sea leg sitting at
// "Booked" — the whole shipment had moved on but half of it still read as if
// nothing had happened. A leg may be AHEAD of its shipment (the truck has
// arrived while the vessel is still sailing) but it can never be BEHIND it, so
// any leg below the shipment's own stage is displayed at that stage.
const LEG_RANK: Record<string, number> = { Booked: 0, Confirmed: 1, Loaded: 2, "In Transit": 3, Arrived: 4, Delivered: 5 };
const SHIPMENT_TO_LEG: Record<string, string> = {
  Draft: "Booked", Booked: "Booked", Confirmed: "Confirmed", Loaded: "Loaded",
  "In Transit": "In Transit", Arrived: "Arrived", Delivered: "Delivered", Closed: "Delivered",
};
export function legDisplayStatus(legStatus: any, shipmentStatus: any): string {
  const ls = String(legStatus || "Booked");
  const ss = String(shipmentStatus || "");
  if (ls === "Cancelled") return ls;
  if (ss === "Cancelled") return "Cancelled";
  const floor = SHIPMENT_TO_LEG[ss];
  if (!floor) return ls;
  const lr = LEG_RANK[ls] ?? 0;
  const fr = LEG_RANK[floor] ?? 0;
  return lr < fr ? floor : ls;
}

const MODE_CONFIG = {
  Road:       { bg: "#EFF6FF", color: "#2563EB", label: "Road", icon: "🚚" },
  Sea:        { bg: "#CFFAFE", color: "#0E7490", label: "Sea", icon: "🚢" },
  Rail:       { bg: "#DCFCE7", color: "#15803D", label: "Rail", icon: "🚆" },
  Air:        { bg: "#FCE7F3", color: "#DB2777", label: "Air", icon: "✈️" },
  Multimodal: { bg: "#F5F3FF", color: "#7C3AED", label: "Multimodal", icon: "🔀" },
};

export const COST_TYPES = [
  { code: "road_freight", label: "Road freight", inventoryType: "freight" },
  { code: "sea_freight", label: "Sea freight", inventoryType: "freight" },
  { code: "rail_freight", label: "Rail freight", inventoryType: "freight" },
  { code: "air_freight", label: "Air freight", inventoryType: "freight" },
  { code: "pre_carriage", label: "Pre-carriage", inventoryType: "freight" },
  { code: "on_carriage", label: "On-carriage", inventoryType: "freight" },
  { code: "customs", label: "Customs / documents", inventoryType: "customs" },
  { code: "port_handling", label: "Port handling", inventoryType: "handling" },
  { code: "warehouse", label: "Warehouse handling", inventoryType: "storage" },
  { code: "insurance", label: "Insurance", inventoryType: "insurance" },
  { code: "demurrage", label: "Demurrage / detention", inventoryType: "freight" },
  { code: "other", label: "Other", inventoryType: "other" },
];

// Core freight cost lines that must not be deleted from a shipment (it should always
// keep its primary freight cost). Pre/on-carriage are NOT locked — they are optional
// sub-legs the user may legitimately remove.
const PROTECTED_FREIGHT_TYPES = new Set(["road_freight", "sea_freight", "rail_freight", "air_freight"]);
export function isFreightCostType(type) {
  return PROTECTED_FREIGHT_TYPES.has(type);
}
// v6.18.17 (D10): map a leg's transport mode to its freight cost type, so a multimodal
// shipment gets one freight line per leg (road_freight for the road leg, sea_freight for
// the sea leg, etc.) instead of a single lumped line.
function freightTypeForMode(mode) {
  return mode === "Air" ? "air_freight" : mode === "Rail" ? "rail_freight" : mode === "Road" ? "road_freight" : "sea_freight";
}
function legUnitPriceSum(leg) {
  // v6.80.0 (D-49, owner ruling): the expected invoice is the SUM of the prices
  // entered per truck/container — never retyped. Falls back to the leg amount.
  const units = transportUnitsForLeg(leg) || [];
  const priced = units.filter((u) => parseNum(u?.costAmount ?? u?.unitPrice, 0) > 0);   // v6.82.0: ONE field — "Price for this unit"
  if (!priced.length) return null;
  return priced.reduce((s, u) => s + parseNum(u.costAmount ?? u.unitPrice, 0), 0);
}
function freightCostsFromLegs(legs, fallbackCurrency, fallbackSupplier, contactsList = []) {
  const nameOf = (id) => { const c = (contactsList || []).find((x) => String(x.id) === String(id)); return c ? c.name : ""; };
  return (legs || []).map((leg, idx) => {
    const amt = legUnitPriceSum(leg) ?? 0;   // v6.80.0 (D-49) · v7.28.9 (Batch L): the trucks own the price
    const cur = leg.costCurrency || fallbackCurrency || "PLN";
    const fx = resolveFxRate(leg.costFxRate, cur);
    return {
      id: idx + 1,
      source: legFreightSource(idx + 1), // v6.37.1: stable identity — the save-time sync manages this line
      type: freightTypeForMode(leg.mode),
      supplierId: leg.carrierId || leg.forwarderId || fallbackSupplier || null,
      amount: amt, currency: cur, fxRate: fx, amountPLN: Math.round(amt * fx * 100) / 100,
      invoiceStatus: "Expected", invoiceRef: "", allocationMethod: "by_kg",
      // v6.66.0 (D-24): the line says WHO gets paid — the leg's own carrier/forwarder.
      notes: `${leg.mode} leg ${idx + 1}${nameOf(leg.carrierId || leg.forwarderId) ? " — " + nameOf(leg.carrierId || leg.forwarderId) : ""}`,
    };
  });
}

// v6.86.0: module-level LOCATIONS alias removed — pickers read unifiedLocations()
// v6.18.4 (P0-4): static snapshot + live counterparty addresses, deduped, so a
// counterparty added this session appears in pickers without a browser refresh.
export function mergedLocations(contacts: any[]) {
  // v6.86.0 (owner ruling): ONE source — unifiedLocations() — no module-level merge, no demo seeds.
  return unifiedLocations(contacts || []).map((l: any) => ({ ...l, placeType: l.type, type: placeGroup(l) }));   // v7.27.3 (FZ-26): from the type
}

// v6.32.0 (R7b-5): demo seed STANDALONE_POS moved out of the production bundle → dev/demoSeed.reference.ts

// v6.32.0 (R7b-5): demo seed STANDALONE_SOS moved out of the production bundle → dev/demoSeed.reference.ts

// v6.32.0 (R7b-5): demo seed STANDALONE_LOTS moved out of the production bundle → dev/demoSeed.reference.ts

const STANDARD_ROAD_TERMS = [
  "Payment is due 30 days after receipt of the invoice together with confirmed original CMR and loading specification / stamped invoice.",
  "The carrier is financially responsible for the transported goods.",
  "The loading space must be clean, free of foreign smell, mould and pest traces. Refrigerated trailers must be washed and disinfected regularly.",
  "The driver must supervise loading, unloading and correctness of transport documents.",
  `In case of any problem the driver must immediately contact the ordering party at ${COMPANY.emergencyPhone}.`,
  "Late truck positioning may result in a contractual penalty up to 200 EUR.",
  "The agreed transport temperature must be maintained continuously. Temperature sensors should be calibrated regularly.",
  "The vehicle must hold documents allowing food transport when required.",
  "Loaded trailers must remain under supervision and protected against uncontrolled access.",
  "No written objection within one hour is treated as acceptance of the transport order. Later cancellation may be charged up to 50% of freight.",
  "The carrier confirms valid OCP insurance and must provide a copy of the policy on request.",
  "Disputes are subject to Polish transport law / CMR and the competent court for Warsaw.",
];

// v6.32.0 (R7b-5): demo seed INIT_SHIPMENTS moved out of the production bundle → dev/demoSeed.reference.ts

export function todayISO() {
  return localTodayISO();
}

export function fmtNum(n) {
  if (n === undefined || n === null || n === "" || isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("pl-PL", { maximumFractionDigits: 2 });
}

export function fmtMoney(n, cur = "PLN") {
  if (n === undefined || n === null || n === "" || isNaN(Number(n))) return "-";
  return `${Number(n).toLocaleString("pl-PL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${cur}`;
}

export function parseNum(n: any, fallback = 0) { const x = sharedParseNum(n); return Number.isFinite(x) && String(n ?? "").trim() !== "" ? x : fallback; }   // v7.38.0 (AUD3-B6): the one reader ("19 422" is 19422, "12,5" is 12.5)

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

export function locById(id) {
  return locationById(id) as any; // v6.86.0: one resolver
}
// v6.34.0: a location id → its country, for the direction matrix.
export function countryOfLocation(id) {
  const l = locById(id);
  return l ? String(l.country || "") : "";
}

export function locText(id, fallback = "") {
  const l = locById(id);
  if (!l) return fallback || "-";
  return `${l.name}${l.address ? `, ${l.address}` : ""}`;
}

function statusRank(status) {
  const i = STATUS_ORDER.indexOf(status);
  return i < 0 ? 999 : i;
}


export function locationTextFromFields(id, custom) {
  if (custom) return custom;
  return locText(id);
}


// ─── v6.3.0: grouped, mode-aware From/To selector ──────────────────────────
// Replaces the free-text datalist (easy to mistype) with a structured dropdown
// grouped by location type. Sea/Air/Rail legs list ports & airports first.
// "✏ Custom…" keeps the free-text escape hatch for one-off places.

// v6.99.12: LegLocationSelect removed — places live on the units (LocationPicker)

// ─── v6.3.0: standard shipment document checklist ───────────────────────────
// Every shipment carries a standard set of export documents. The set is
// conditional on the transport modes present (CMR for road, BL for sea, AWB for
// air) and users can add free manual rows for anything else.
function standardDocTypesFor(shipment) {
  const legModes = new Set((shipment.legs || []).map(l => l.mode));
  if (!legModes.size && shipment.mode) legModes.add(shipment.mode);
  const types = ["Packing list"];   // v7.27.11 (FZ-16): the export papers are no longer added to every shipment — the expected set is read from its terms
  // v6.14 (#13): CMR is no longer a checklist row — it's captured per road unit.
  // v6.14 (#9): "Transport order" is not a manual row either — the system tracks
  // it from the email action to each carrier/forwarder.
  if (legModes.has("Sea") || shipment.mode === "Sea") types.push("BL");
  if (legModes.has("Air") || shipment.mode === "Air") types.push("AWB");
  return types;
}

// v6.99.49 (SD-2, owner): a supplier's truck is not arranged by us — its ladder reads Announced → In transit → Arrived → Closed
// (stored statuses unchanged: Booked · Loaded · Delivered · Closed, so every posting and report keeps working). Arrived = the receipt.
const SUPPLIER_STATUS_LABEL: Record<string, string> = { Draft: "Announced", Booked: "Announced", Loaded: "In transit", "In transit": "In transit", Delivered: "Arrived", Closed: "Closed", Cancelled: "Cancelled" };
function shipmentStatusLabel(sh: any): string { return String(sh?.arrangedBy || "").toUpperCase() === "SUPPLIER" ? (SUPPLIER_STATUS_LABEL[String(sh?.status)] || String(sh?.status || "")) : String(sh?.status || ""); }

export function findUnitIn(sh: any, id: any): any { for (const l of (sh?.legs || [])) for (const u of (l.vehicles || [])) if (String(u.id) === String(id)) return u; return null; }   // v6.99.59 (A-SU-1)

export function withStandardDocs(shipment) {
  const existing = shipment.documents || [];
  const have = new Set(existing.map(d => String(d.type || "").trim().toLowerCase()));
  const missing = standardDocTypesFor(shipment)
    .filter(t => !have.has(t.toLowerCase()))
    .map((t) => ({ id: nextId(), type: t, ref: "", status: "Missing", date: "", notes: "", link: "" }));
  if (!missing.length) return shipment;
  return { ...shipment, documents: [...existing, ...missing] };
}

// ─── v6.4.0: derive ALL SO links of a shipment ──────────────────────────────
// Header soRefs ∪ per-goods soRef ∪ SOs whose lines source from this shipment's
// POs. Fixes the header not showing the SO when the link lives on goods rows or
// when the SO was attached to the PO after the shipment was created.
function shipmentSORefs(shipment, orders = []) {
  const set = new Set(
    [...(shipment.soRefs || []), ...((shipment.goods || []).map((g: any) => g.soRef))]
      .map(x => String(x || "")).filter(Boolean)
  );
  // v6.50.0: the PO→SO derivation only makes sense for a shipment that FULFILS a
  // sale. An INBOUND internal movement (port → our warehouse under a PO) is
  // governed by the PO alone — whichever SO happens to sell that PO's goods later
  // has nothing to do with this truck, and showing it made port-to-warehouse
  // shipments claim sales orders they never carried.
  // Derivation only ever FILLS A GAP. If the shipment already states which sales
  // orders it serves — on the header or on its goods rows — that is the truth and
  // we must not widen it: SHP-…-0006 carries SO-…-0005 and SHP-…-0007 carries
  // SO-…-0006, yet both drew from one PO, so deriving added the other's order to
  // each. And an INBOUND internal movement (port → our warehouse under a PO) is
  // governed by the PO alone, whichever SO happens to sell those goods later.
  const explicitlyLinked = set.size > 0;
  const isInbound = String(shipment?.purpose || "").toUpperCase() === "INBOUND";
  if (!explicitlyLinked && !isInbound) {
    (orders || []).forEach((o: any) => {
      if (!o || o.status === "Cancelled") return;
      const sourcesPO = false;
      if (sourcesPO && o.number) set.add(String(o.number));
    });
  }
  // v6.18.18 (#7): a cancelled SO must not linger in a shipment's linked records, even if
  // its number was stored on soRefs / goods before it was cancelled.
  const cancelled = new Set((orders || []).filter((o: any) => o && o.status === "Cancelled").map((o: any) => String(o.number)));
  return Array.from(set).filter(n => !cancelled.has(String(n)));
}

// v6.46.0: Polish genitive for the provider role — the transport-order title
// previously printed "ZLECENIE DLA CARRIER" (Polish sentence, English noun).
const PROVIDER_ROLE_PL: Record<string, string> = {
  Carrier: "PRZEWOŹNIKA",
  Forwarder: "SPEDYTORA",
  Broker: "AGENCJI CELNEJ",
  Warehouse: "MAGAZYNU",
};
export function providerRolePL(role: any): string {
  return PROVIDER_ROLE_PL[String(role)] || "PRZEWOŹNIKA";
}
export function providerRoleForLeg(leg, providerId) {
  if (String(leg.carrierId || "") === String(providerId || "")) return "Carrier";
  if (String(leg.forwarderId || "") === String(providerId || "")) return "Forwarder";
  return "Carrier";
}

export function providerIdsForShipment(shipment) {
  const ids = [];
  // v6.99.6 (A-R9-15 / D9): the carrier lives on the UNIT — providers are whoever the units name (leg-level only as legacy fallback)
  // v6.99.39 (D-2): providers are whoever carrierOfUnit() names — containers belong to the booking's forwarder
  (shipment.legs || []).forEach(leg => { (transportUnitsForLeg(leg) || []).forEach((u: any) => { const c = carrierOfUnit(shipment, leg, u); if (c != null) ids.push(c); }); });
  // NOTE: we intentionally do NOT pull from shipment.costs[].supplierId — a cost
  // line can reference a broker or other party not actually performing transport,
  // which would wrongly appear in the transport-order provider dropdown.
  // Only fall back to shipment-level providers if no leg carried any provider at all.
  if (!ids.length) {
    if (shipment.carrierId) ids.push(shipment.carrierId);
    if (shipment.forwarderId) ids.push(shipment.forwarderId);
  }
  return Array.from(new Set(ids.map(x => String(x))));
}

export function providerLegs(shipment, providerId) {
  const pid = String(providerId || "");
  // v6.99.6 (A-R9-15): a provider's legs are the legs where one of ITS units rides (leg-level ids as legacy fallback)
  const legs = (shipment.legs || []).filter(leg => (transportUnitsForLeg(leg) || []).some((u: any) => String(carrierOfUnit(shipment, leg, u) ?? "") === pid));   // v6.99.39 (D-2)
  // v6.18.17 (E12): do NOT fall back to the first leg — a provider's transport order must
  // reflect only its OWN leg(s). Returning leg 1 for a provider not on it is the multimodal
  // bug where the second-leg forwarder's order showed the first leg's loading/unloading.
  return legs;
}

export function providerCosts(shipment, providerId) {
  const pid = String(providerId || "");
  const costs = (shipment.costs || []).filter(c => String(c.supplierId || "") === pid);
  if (costs.length) return costs;
  return [];
}


// v6.35.5 (A1a/A1b): changing the shipment mode must not strand data. Road stores the
// provider in carrierId while Sea/Air use forwarderId — so we MIGRATE the selection
// between the fields instead of losing it. And a single-leg shipment's leg follows the
// header mode; switching to Multimodal appends a Sea leg so header and legs agree.
export function modeChangePatch(prev: any, newMode: string) {
  const patch: any = { ...prev, mode: newMode };
  const usesForwarder = newMode === "Sea" || newMode === "Air";
  if (usesForwarder && !patch.forwarderId && patch.carrierId) { patch.forwarderId = patch.carrierId; patch.carrierId = null; }
  if (!usesForwarder && newMode !== "Multimodal" && !patch.carrierId && patch.forwarderId) { patch.carrierId = patch.forwarderId; patch.forwarderId = null; }
  const legs = prev.legs || [];
  if (legs.length === 1) {
    if (newMode === "Multimodal") {
      if (legs[0].mode !== "Sea") {
        patch.legs = [
          { ...legs[0] },
          { id: (legs[0].id || 1) + 1, mode: "Sea", status: "Booked", fromLocationId: null, fromCustom: "", toLocationId: legs[0].toLocationId ?? null, toCustom: legs[0].toCustom || "", forwarderId: patch.forwarderId || null, plannedPickupDate: legs[0].plannedDeliveryDate || null, plannedDeliveryDate: legs[0].plannedDeliveryDate || null, containerNumber: "", sealNumber: "", bookingNumber: "", blNumber: "", shippingLine: "", costAmount: 0, costCurrency: legs[0].costCurrency || "PLN", costFxRate: legs[0].costFxRate || 1, costPLN: 0, notes: "Sea leg (added on Multimodal)" },
        ];
      }
    } else {
      patch.legs = [{ ...legs[0], mode: newMode, carrierId: !usesForwarder ? (legs[0].carrierId ?? patch.carrierId ?? null) : legs[0].carrierId, forwarderId: usesForwarder ? (legs[0].forwarderId ?? patch.forwarderId ?? null) : legs[0].forwarderId }];
    }
  }
  return patch;
}

export function blankTransportUnit(mode = "Road") {
  return {
    id: nextId(),
    mode,
    qtyKg: 0,
    pallets: 0,
    truckPlate: "",
    trailerPlate: "",
    driverName: "",
    driverPhone: "",
    cmrNumber: "",
    tempRecorderNo: "",
    fromUnitId: null,   // v6.80.0 (D-50): container ← loaded from truck (previous leg unit)
    containerNumber: "",
    sealNumber: "",
    bookingNumber: "",
    blNumber: "",
    awbNumber: "",
    shippingLine: "",
    loadedAt: "",
    unloadedAt: "",   // v7.28.0 (Batch L): the one pair of a truck's actual dates
    costAmount: 0,
    notes: "",
  };
}


/** v6.99.6 (A-R9-15): the units a given provider carries on a leg (all units when none names a carrier — legacy). */
export function providerUnitsForLeg(leg: any, providerId: any, sh: any = null): any[] {
  // v6.99.39 (D-2): the units a provider carries on a leg — by carrierOfUnit(), never "all units" as a fallback
  // (that fallback is how the road carrier's trucks appeared under the sea leg)
  const all = transportUnitsForLeg(leg); const pid = String(providerId || "");
  const named = all.filter((u: any) => carrierOfUnit(sh, leg, u) != null);
  if (!named.length) return sh ? [] : all;
  return all.filter((u: any) => String(carrierOfUnit(sh, leg, u) ?? "") === pid);
}
export function transportUnitsForLeg(leg) {   // v7.28.9 (Batch L): the trucks are the leg's units — no unit is made from the leg's old copies
  return Array.isArray(leg?.vehicles) ? leg.vehicles : [];
}

/** v6.53.0: how many ROAD trucks this shipment loads — one loading protocol each.
 *  A road leg with no units recorded still means one truck, not zero, or a
 *  shipment would report "0/0 back" and read as complete with nothing on file. */
export function roadTruckCount(shipment) {
  return (shipment.legs || []).reduce((sum, leg) => {
    if (leg?.mode !== "Road") return sum;
    return sum + Math.max(1, transportUnitsForLeg(leg).length);
  }, 0);
}

export function shipmentVehicleCount(shipment) {
  const count = (shipment.legs || []).reduce((sum, leg) => sum + transportUnitsForLeg(leg).length, 0);
  return count || parseNum(shipment.vehicleCount, 0);
}

function providerFromContact(c) {
  const cs = peopleOf(c);
  const primary = cs.find(p => p.isPrimary) || cs[0] || {};
  // v6.18.14 (#6): the email shouldn't depend on it being on the primary contact —
  // use the primary's email, else the first contact that has one, else the company email.
  const emailHolder = cs.find(p => p.isPrimary && p.email) || cs.find(p => p.email) || {};
  return {
    id: c.id,
    type: c.type,
    roles: rolesOf(c),   // v7.28.2 (Batch L)
    name: c.name,
    country: companyCountryName(c),   // v7.28.11 (Batch L)
    nip: c.nip || "",
    address: companyAddressLine(c),   // v7.28.10 (Batch L)
    services: c.services || [],
    contact: primary.name || "",
    email: emailHolder.email || c.email || "",
    phone: primary.phone || emailHolder.phone || "",
  };
}

export function logisticsProviders(contacts = [], service = "") {
  const fromContacts = (contacts || [])
    .filter(c => {
      const types = rolesOf(c);
      const isLogistics = types.some(t => ["Carrier", "Forwarder", "Broker", "Warehouse"].includes(t));
      if (!isLogistics) return false;
      if (!service) return true;
      const svc = c.services || [];
      if (svc.includes(service)) return true;
      // v6.13 (#2/#3): a counterparty entered as Carrier/Forwarder/Broker but with
      // no declared "services" list must still appear in the matching dropdown.
      // Fall back to the counterparty TYPE so real contacts are never excluded.
      if (svc.length === 0) {
        if (service === "Road") return types.includes("Carrier") || types.includes("Forwarder");
        if (service === "Sea" || service === "Air") return types.includes("Forwarder") || types.includes("Carrier");
        if (service === "Customs") return types.includes("Broker") || types.includes("Forwarder");
        if (service === "Warehousing") return types.includes("Warehouse");
      }
      return (service === "Customs" && types.includes("Broker"));
    })
    .map(providerFromContact);
  // v6.30.2 (clean system): pickers list Contacts only · v7.21.10 (A-RV-33): the fallback carriers are gone from the code
  const combined = [...fromContacts];
  const seen = new Set();
  return combined.filter(p => {
    if (seen.has(String(p.id))) return false;
    seen.add(String(p.id));
    return true;
  });
}

export function providerById(id, contacts = []) {
  if (!id && id !== 0) return null;
  if (String(id) === TBD_CARRIER_ID) return { id: TBD_CARRIER_ID, name: "TBD carrier — to be assigned", type: "Carrier", address: "", nip: "", isTBD: true };
  const live = logisticsProviders(contacts);
  const fromContacts = live.find(p => String(p.id) === String(id));
  if (fromContacts) return fromContacts;
  // v7.21.10 (A-RV-33, owner 11 Oct): no carrier written into the code any more — an id that is no company in Contacts names nobody
  // (the integrity check lists a shipment still holding one of the retired ids 1001 / 9 / 10)
  return null;
}

export function providerName(id, contacts = []) {
  return providerById(id, contacts)?.name || "-";
}

export function costTypeLabel(code) {
  return COST_TYPES.find(t => t.code === code)?.label || code || "Cost";
}

function costInventoryType(code) {
  return COST_TYPES.find(t => t.code === code)?.inventoryType || "freight";
}

export function shipmentCostPLN(shipment) {
  return (shipment.costs || []).reduce((s, c) => s + parseNum(c.amountPLN || (parseNum(c.amount) * parseNum(c.fxRate, 1))), 0);
}

export function shipmentKg(shipment) {
  return (shipment.goods || []).reduce((s, g) => s + parseNum(g.qtyKg), 0);
}

function nextShipmentNumber(shipments) {
  const year = new Date().getFullYear();
  let max = 0;
  (shipments || []).forEach(s => {
    // v6.31.0: year-scoped like nextShipmentNumberPure (shipments.domain) — the
    // old year-blind regex took the global max, so from 1 January the two
    // generators diverged (this one continuing, the domain one restarting).
    const m = String(s.number || "").match(/^SHP-(\d{4})-(\d+)$/);
    if (m && Number(m[1]) === year) max = Math.max(max, parseInt(m[2], 10));
  });
  return `SHP-${year}-${String(max + 1).padStart(4, "0")}`;
}

function guessSupplierLocationId(po) {
  const name = (po?.supplier?.name || "").toLowerCase();
  if (name.includes("bial")) return 3;
  if (name.includes("freshfarm") || name.includes("valencia")) return 4;
  if (name.includes("agritrade") || name.includes("agadir") || name.includes("morocco")) return 5;
  return null;
}

// v6.45.0 (B): findLotForLine removed — it matched by product name only and
// paired every same-product line with the FIRST lot. Use findLotForSOLine
// (id-aware, claimed-set) from the domain instead.

function norm(v) {
  return String(v || "").trim().toLowerCase();
}


// v6.3.0: every newly built shipment starts with the standard document checklist.
export function buildShipmentFromPO(po, opts, shipments, lots, governingSO = null, contactsList = []) { return withStandardDocs(buildShipmentFromPO__raw(po, opts, shipments, lots, governingSO, contactsList)); }
export function buildShipmentFromSO(so, opts, shipments, lots, contactsList = []) { return withStandardDocs(buildShipmentFromSO__raw(so, opts, shipments, lots, contactsList)); }
export function buildManualShipment(opts, shipments) { return withStandardDocs(buildManualShipment__raw(opts, shipments)); }

function buildShipmentFromPO__raw(po, opts, shipments, lots, governingSO = null, contactsList = []) {
  const id = nextId();
  const number = (opts && opts.number) || nextShipmentNumber(shipments);   // v7.27.8 (A-W5): the counter's number when the caller took one
  // v6.29.0: the shipment owns the trade direction — seeded from the PO's
  // provisional value here, editable on the shipment afterwards.
  // v6.62.0: no longer computed here. The header is left on Auto so the
  // direction re-derives from the producer's country and the governing SO each
  // time it is read, instead of freezing whatever was true at creation and
  // being forgotten. Goods rows built from an SO still carry their own.
  const mode = opts.mode || "Road"; // v6.34.6: mode is a per-shipment choice; sea being part of the trade no longer forces Multimodal
  const carrierId = opts.carrierId ? parseNum(opts.carrierId) : null;
  const forwarderId = opts.forwarderId ? parseNum(opts.forwarderId) : null;
  // v6.32.0 (P1-7, terms-aware): the PO's named place (BP-56) is the HANDOVER
  // point — where OUR journey starts. So:
  //   • EXW/FCA/FOB/CIF/CFR/CIP → shipment ORIGIN defaults to the named place
  //     (for CIF that is the port of discharge, seller-paid main carriage —
  //     previously the origin wrongly defaulted to the producer, making the
  //     journey look producer→warehouse);
  //   • DAP/DPU/DDP (seller delivers) → named place is OUR delivery place, so
  //     it stays the DESTINATION default and the origin stays the supplier.
  // Fallback for POs without a named place: supplier facility as before.
  const sellerDelivers = deliveredAtDestination(po.buyIncoterm);   // v7.22.3 (FZ-21)
  const namedPlaceId = po.destinationLocationId || null;
  const namedPlaceText = po.destinationText || "";
  const supplierGuessId = guessSupplierLocationId(po);
  const supplierText = po.supplier ? `${po.supplier.name}${po.supplier.address ? ", " + po.supplier.address : ""}${po.supplier.country ? ", " + po.supplier.country : ""}` : "";
  const originLocationId = (!sellerDelivers && namedPlaceId) || supplierGuessId || opts.originLocationId || null;
  const originCustom = originLocationId ? "" : (opts.originCustom || (!sellerDelivers && namedPlaceText) || supplierText);
  const destinationLocationId = (sellerDelivers ? namedPlaceId : null) || opts.destinationLocationId || null;
  const destinationCustom = destinationLocationId ? "" : (opts.destinationCustom || (sellerDelivers ? namedPlaceText : ""));
  const poLotRefs = uniq([...(lots || []).filter(l => l.poRef === po.number).map(l => l.number)]);
  // Find any SO that sources from this PO, so goods rows can carry the SO ref.
  const soRefForPO = (opts.soRefs && opts.soRefs[0]) || "";
  // The user may load only SOME of the PO's products on this shipment. If
  // opts.selectedItemIds is provided, restrict goods to those line ids; otherwise
  // include all PO items (back-compat).
  // Keep the TRUE line index/id so per-line qty + poLineId stamping stay correct.
  const lineQtys = opts.lineQtys || {};
  const indexedItems = (po.items || []).map((it, idx) => ({ it, idx, id: String(it.id ?? idx + 1) }));
  const loadable = (opts.selectedItemIds && opts.selectedItemIds.length)
    ? indexedItems.filter(x => opts.selectedItemIds.map(String).includes(x.id))
    : indexedItems;
  const goods = loadable.map(({ it, idx, id }, gi) => {
    const lot = poLotRefs[idx] || poLotRefs[0] || "";
    // v6.34.4: ship the entered 'ship now' qty when provided, else the full line qty.
    const entered = lineQtys[id];
    const qty = (entered === undefined || entered === "") ? parseNum(it.qty) : parseNum(entered);
    return {
      id: gi + 1,
      poRef: po.number,
      poLineId: it.id ?? idx + 1,   // v6.34.4: stamp the source line so per-line shipped-kg is countable
      // v6.62.0 (user ruling): a new shipment's header direction is left on
      // AUTO so it re-derives from the producer's country and the governing SO,
      // rather than freezing whatever was true at creation and being forgotten.
      // The goods rows still carry their own computed direction for lot badges.
      tradeDirection: null,
      soRef: soRefForPO,
      lotRef: lot,
      product: it.product || "Goods",
      variety: it.variety || "",
      cnCode: it.cnCode || "",
      origin: it.origin || po.supplier?.country || "",
      quality: it.quality || "I",
      size: it.size || "",
      packaging: it.packaging || "",
      qtyKg: qty,
      grossKg: parseNum(it.grossKg) || grossForGoodsLine({ qtyKg: qty, product: it.product, packaging: it.packaging }, PACKAGING_SEED).grossKg,
      pallets: parseNum(it.pallets) || 0,
      description: `${it.product || "Goods"}${it.variety ? " " + it.variety : ""} ${it.packaging || ""}`.trim(),
    };
  });
  const totalKg = goods.reduce((s, g) => s + parseNum(g.qtyKg), 0);
  // Per-leg costs: caller may pass opts.legCosts; otherwise legs start at 0 cost
  // (user fills them in) rather than every leg inheriting the same guessed amount.
  const amount = parseNum(opts.amount, 0);
  const currency = opts.currency || (mode === "Sea" || mode === "Multimodal" ? "USD" : "PLN");
  const fxRate = resolveFxRate(opts.fxRate, currency) || defaultFxRate(currency) || 1; // v6.99.6 (A-R9-16): one FX source

  const roadLeg: any = { id: 1, mode: "Road", status: "Booked", fromLocationId: originLocationId, fromCustom: originCustom, toLocationId: destinationLocationId, toCustom: destinationCustom, carrierId: carrierId || TBD_CARRIER_ID, plannedPickupDate: opts.loadingDate || po.loadingDate || todayISO(), plannedDeliveryDate: opts.expectedDeliveryDate || poExpectedArrival(po) || todayISO(), vehiclePlate: "", trailerPlate: "", driverName: "", driverPhone: "", temperatureMinC: parseNum(opts.temperatureMinC, 2), temperatureMaxC: parseNum(opts.temperatureMaxC, 8), costAmount: amount, costCurrency: currency, costFxRate: fxRate, costPLN: Math.round(amount * fxRate * 100) / 100, notes: `Generated from ${po.number}` };
  // v6.3.0 leg defaults: Multimodal starts with TWO legs (road pre-carriage + sea
  // main); every other mode starts with ONE leg of that mode. "+ Add leg" covers
  // anything extra (e.g. on-carriage after customs).
  let legs: any[] = [roadLeg];
  if (mode === "Multimodal") {
    legs = [
      { ...roadLeg, id: 1, mode: "Road", fromLocationId: originLocationId, fromCustom: originCustom, toLocationId: null, toCustom: "", plannedDeliveryDate: opts.loadingDate || po.loadingDate || todayISO(), costAmount: 0, costPLN: 0, notes: `Pre-carriage for ${po.number}` },
      { id: 2, mode: "Sea", status: "Booked", fromLocationId: null, fromCustom: "", toLocationId: destinationLocationId, toCustom: destinationCustom, forwarderId: forwarderId || null, plannedPickupDate: opts.loadingDate || po.loadingDate || todayISO(), plannedDeliveryDate: opts.expectedDeliveryDate || poExpectedArrival(po) || todayISO(), containerNumber: "", sealNumber: "", bookingNumber: "", blNumber: "", shippingLine: "", costAmount: 0, costCurrency: currency, costFxRate: fxRate, costPLN: 0, notes: `Sea leg for ${po.number}` },
    ];
  } else if (mode === "Sea" || mode === "Rail" || mode === "Air") {
    legs = [{
      id: 1, mode, status: "Booked",
      fromLocationId: originLocationId, fromCustom: originCustom,
      toLocationId: destinationLocationId, toCustom: destinationCustom,
      forwarderId: forwarderId || null, carrierId: carrierId || null,
      plannedPickupDate: opts.loadingDate || po.loadingDate || todayISO(),
      plannedDeliveryDate: opts.expectedDeliveryDate || poExpectedArrival(po) || todayISO(),
      containerNumber: "", sealNumber: "", bookingNumber: "", blNumber: "", awbNumber: "", shippingLine: "",
      temperatureMinC: parseNum(opts.temperatureMinC, 2), temperatureMaxC: parseNum(opts.temperatureMaxC, 8),
      costAmount: amount, costCurrency: currency, costFxRate: fxRate, costPLN: Math.round(amount * fxRate * 100) / 100,
      notes: `${mode} leg for ${po.number}`,
    }];
  }

  const costsFromLegs = freightCostsFromLegs(legs, currency, carrierId || forwarderId, contactsList);

  return {
    id,
    number,
    transportOrderNo: number,
    mode,
    purpose: "INBOUND", // Batch 3a canonical (legacy PO_IMPORT/PO_EXPORT mapped by derivePurpose)
    status: "Booked",
    poRefs: [po.number],
    soRefs: (opts.soRefs || []),
    governingSoRef: opts.governingSoRef || (governingSO && governingSO.number) || "",
    lotRefs: poLotRefs,
    carrierId,
    forwarderId,
    brokerId: null,
    vehicleCount: 1,
    originLocationId,
    originCustom,
    destinationLocationId,
    destinationCustom,
    loadingDate: opts.loadingDate || po.loadingDate || todayISO(),
    expectedDeliveryDate: opts.expectedDeliveryDate || poExpectedArrival(po) || todayISO(),
    actualLoadingDate: null,
    actualDeliveryDate: null,
    customsClearance: mode === "Road" ? "Not required / to be confirmed" : "To be confirmed",
    temperatureMinC: parseNum(opts.temperatureMinC, 2),
    temperatureMaxC: parseNum(opts.temperatureMaxC, 8),
    confirmationStatus: "Not sent",
    confirmationSentAt: null,
    billingStatus: "Not ready",
    notes: `Created from ${po.number}. Total goods ${fmtNum(totalKg)} kg.`,
    legs,
    goods,
    costs: costsFromLegs,
    documents: [
      { id: 1, type: "Transport order", ref: "", status: "Required", date: "", notes: "Generate and send to provider" },
      { id: 2, type: mode === "Air" ? "AWB" : mode === "Sea" || mode === "Multimodal" ? "BL" : "CMR", ref: "", status: "Required", date: "", notes: "Required before closing" },
    ],
    terms: STANDARD_ROAD_TERMS,
  };
}

function buildShipmentFromSO__raw(so, opts, shipments, lots, contactsList = []) {
  // v6.45.0 (B): the shipment owns the trade direction — derived from its
  // governing SO (the from-PO builder already did this; this one never did,
  // which is why direct-export lots showed "Import").
  // v7.12.1 (A-TD-2): no direction is written — every reader asks tradeFlow.shipmentTradeDirection (rule 7: one source)
  const id = nextId();
  const number = (opts && opts.number) || nextShipmentNumber(shipments);   // v7.27.8 (A-W5): the counter's number when the caller took one
  const mode = opts.mode || "Road";
  // No carrier chosen (e.g. EXW sale where the client arranges transport) → leave the
  // road leg unassigned (TBD) rather than forcing a default carrier.
  const carrierId = opts.carrierId ? parseNum(opts.carrierId) : null;
  const forwarderId = opts.forwarderId ? parseNum(opts.forwarderId) : null;
  // v6.45.0 (B): id-aware matching here too — the old matcher gave every
  // same-product line the FIRST lot, so lotRefs lost the second lot entirely.
  const _refClaimed = new Set<string>();
  const _lotForLine = (it: any) => { const l = findLotForSOLine(lots, it, { claimed: _refClaimed }); if (l) _refClaimed.add(String(l.number)); return l; };
  const _lineLots = (so.items || []).map((it: any) => _lotForLine(it));
  const firstLot = _lineLots[0] || null;
  // v7.27.13 (owner 19 Oct: the early test place on these shipments "is a mistake … created by an early version to test the data"): no place is ever
  // guessed — the early versions put place 1 / place 10 on every shipment whose sale named no place; now it stays empty until known
  const originLocationId = firstLot?.locationId || opts.originLocationId || null;
  const destinationLocationId = so.destinationLocationId || opts.destinationLocationId || null;
  const poRefs = uniq((so.items || []).filter(it => false).map(it => it.sourceRef));
  const lotRefs = uniq((so.items || []).map((it: any, i: number) => _lineLots[i]?.number || (it.sourceType === "STOCK" ? it.sourceRef : "")).filter(Boolean));
  // v6.34.8: SO parity with PO — honour selectedItemIds, per-line "ship now" qty
  // (opts.lineQtys, default full line), and stamp soLineId for per-line shipped-kg counting.
  const lineQtys = opts.lineQtys || {};
  const indexedItems = (so.items || []).map((it, idx) => ({ it, idx, id: String(it.id ?? idx + 1) }));
  const loadable = (opts.selectedItemIds && opts.selectedItemIds.length)
    ? indexedItems.filter(x => opts.selectedItemIds.map(String).includes(x.id))
    : indexedItems;
  // v6.45.0 (ROOT CAUSE B): the old product-name matcher paired EVERY same-product
  // line with the FIRST lot of the PO (both SO-2026-0002 lines → LOT-2026-0004).
  // The id-aware domain matcher pairs each line with ITS lot (sourceLineId ↔
  // poLineId), and the claimed set stops one lot serving two lines.
  const _claimedLots = new Set<string>();
  const goods = loadable.map(({ it, idx, id }, gi) => {
    const lot = findLotForSOLine(lots, it, { claimed: _claimedLots });
    if (lot) _claimedLots.add(String(lot.number));
    let palletCount = parseNum(it.pallets) || 0;
    if (!palletCount && lot) palletCount = parseNum(lot.pallets) || 0;
    const entered = lineQtys[id];
    const qty = (entered === undefined || entered === "") ? parseNum(it.qty) : parseNum(entered);
    return {
      id: gi + 1,
      poRef: lot?.poRef || "",
      soRef: so.number,
      soLineId: it.id ?? idx + 1,   // v6.34.8: stamp the source SO line
      lotRef: lot?.number || (it.sourceType === "STOCK" ? it.sourceRef : ""),
      product: it.product || "Goods",
      variety: it.variety || "",
      cnCode: it.cnCode || "",
      origin: it.origin || "",
      quality: it.quality || "I",
      size: it.size || "",
      packaging: it.packaging || "",
      qtyKg: qty,
      grossKg: grossForGoodsLine({ qtyKg: qty, product: it.product, packaging: it.packaging }, PACKAGING_SEED).grossKg,
      pallets: palletCount,
      description: `${it.product || "Goods"}${it.variety ? " " + it.variety : ""} ${it.packaging || ""}`.trim(),
    };
  });
  const amount = parseNum(opts.amount, 0);
  const currency = opts.currency || "PLN";
  const fxRate = resolveFxRate(opts.fxRate, currency) || defaultFxRate(currency) || 1; // v6.99.6 (A-R9-16): one FX source
  const soLegs = mode === "Multimodal" ? [
      { id: 1, mode: "Road", status: "Booked", fromLocationId: originLocationId, toLocationId: null, carrierId, plannedPickupDate: opts.loadingDate || todayISO(), plannedDeliveryDate: opts.loadingDate || todayISO(), vehiclePlate: "", trailerPlate: "", driverName: "", driverPhone: "", temperatureMinC: parseNum(opts.temperatureMinC, 2), temperatureMaxC: parseNum(opts.temperatureMaxC, 8), costAmount: 0, costCurrency: currency, costFxRate: fxRate, costPLN: 0, notes: `Pre-carriage for ${so.number}` },
      { id: 2, mode: "Sea", status: "Booked", fromLocationId: null, toLocationId: destinationLocationId, forwarderId: forwarderId || null, plannedPickupDate: opts.loadingDate || todayISO(), plannedDeliveryDate: opts.expectedDeliveryDate || so.deliveryDate || todayISO(), containerNumber: "", sealNumber: "", bookingNumber: "", blNumber: "", shippingLine: "", costAmount: 0, costCurrency: currency, costFxRate: fxRate, costPLN: 0, notes: `Sea leg for ${so.number}` },
    ] : [
      { id: 1, mode, status: "Booked", fromLocationId: originLocationId, toLocationId: destinationLocationId, carrierId, forwarderId: forwarderId || null, plannedPickupDate: opts.loadingDate || todayISO(), plannedDeliveryDate: opts.expectedDeliveryDate || so.deliveryDate || todayISO(), vehiclePlate: "", trailerPlate: "", driverName: "", driverPhone: "", containerNumber: "", sealNumber: "", bookingNumber: "", blNumber: "", awbNumber: "", shippingLine: "", temperatureMinC: parseNum(opts.temperatureMinC, 2), temperatureMaxC: parseNum(opts.temperatureMaxC, 8), costAmount: amount, costCurrency: currency, costFxRate: fxRate, costPLN: Math.round(amount * fxRate * 100) / 100, notes: `Delivery for ${so.number}` },
    ];
  return {
    id,
    number,
    transportOrderNo: number,
    mode,
    purpose: "OUTBOUND", // Batch 3a canonical
    status: "Booked",
    poRefs,
    governingSoRef: so.number, // v6.82.0 (Round 6): the SO chosen in the first window governs — never blank in the header
    soRefs: [so.number],
    tradeDirection: null,         // v6.99.6 (A-R9-8): AUTO — the header derives; only a user choice is stored
    lotRefs,
    carrierId,
    forwarderId,
    brokerId: null,
    vehicleCount: 1,
    loadingDate: opts.loadingDate || todayISO(),
    expectedDeliveryDate: opts.expectedDeliveryDate || so.deliveryDate || todayISO(),
    actualLoadingDate: null,
    actualDeliveryDate: null,
    originLocationId,
    destinationLocationId,
    customsClearance: "Not required / to be confirmed",
    temperatureMinC: parseNum(opts.temperatureMinC, 2),
    temperatureMaxC: parseNum(opts.temperatureMaxC, 8),
    confirmationStatus: "Not sent",
    confirmationSentAt: null,
    billingStatus: "Not ready",
    notes: `Created from ${so.number}. Delivery to ${so.client?.name || "client"}.`,
    legs: soLegs,
    goods,
    costs: freightCostsFromLegs(soLegs, currency, carrierId || forwarderId, contactsList),
    documents: [
      { id: 1, type: "Transport order", ref: "", status: "Required", date: "", notes: "Generate and send to carrier" },
      { id: 2, type: "CMR", ref: "", status: "Required", date: "", notes: "Original CMR required for billing" },
    ],
    terms: STANDARD_ROAD_TERMS,
  };
}

function buildManualShipment__raw(opts, shipments) {
  const id = nextId();
  const number = (opts && opts.number) || nextShipmentNumber(shipments);   // v7.27.8 (A-W5): the counter's number when the caller took one
  const mode = opts.mode || "Road";
  const carrierId = opts.carrierId ? parseNum(opts.carrierId) : null;   // v7.21.10 (A-RV-33): no carrier until one is picked from the list — never the fixed 1001
  const forwarderId = opts.forwarderId ? parseNum(opts.forwarderId) : null;
  const amount = parseNum(opts.amount, 0);
  const currency = opts.currency || "PLN";
  const fxRate = resolveFxRate(opts.fxRate, currency) || defaultFxRate(currency) || 1; // v6.99.6 (A-R9-16): one FX source
  const qtyKg = parseNum(opts.qtyKg, 0);
  return {
    id,
    number,
    transportOrderNo: number,
    mode,
    purpose: "INBOUND", // Batch 3a: manual defaults to inbound; the 3b editor lets the user pick
    status: "Booked",
    poRefs: opts.poRef ? [opts.poRef] : [],
    soRefs: opts.soRef ? [opts.soRef] : [],
    lotRefs: opts.lotRef ? [opts.lotRef] : [],
    carrierId,
    forwarderId,
    brokerId: null,
    vehicleCount: 1,
    loadingDate: opts.loadingDate || todayISO(),
    expectedDeliveryDate: opts.expectedDeliveryDate || todayISO(),
    actualLoadingDate: null,
    actualDeliveryDate: null,
    originLocationId: (opts.originLocationId ? parseNum(opts.originLocationId) : null),
    destinationLocationId: (opts.destinationLocationId ? parseNum(opts.destinationLocationId) : null),
    customsClearance: opts.customsClearance || "To be confirmed",
    temperatureMinC: parseNum(opts.temperatureMinC, 2),
    temperatureMaxC: parseNum(opts.temperatureMaxC, 8),
    confirmationStatus: "Not sent",
    confirmationSentAt: null,
    billingStatus: "Not ready",
    notes: opts.notes || "Manual shipment",
    legs: mode === "Multimodal"
      ? [ // v6.35.5 (A1d): a manual Multimodal shipment starts with BOTH legs, like the
          // PO/SO builders — road pre-carriage to the (yet unset) port + sea main leg.
          { id: 1, mode: "Road", status: "Booked", fromLocationId: (opts.originLocationId ? parseNum(opts.originLocationId) : null), toLocationId: null, toCustom: "", carrierId, forwarderId: null, plannedPickupDate: opts.loadingDate || todayISO(), plannedDeliveryDate: opts.loadingDate || todayISO(), vehiclePlate: "", trailerPlate: "", driverName: "", driverPhone: "", temperatureMinC: parseNum(opts.temperatureMinC, 2), temperatureMaxC: parseNum(opts.temperatureMaxC, 8), costAmount: amount, costCurrency: currency, costFxRate: fxRate, costPLN: Math.round(amount * fxRate * 100) / 100, notes: "Pre-carriage (manual)" },
          { id: 2, mode: "Sea", status: "Booked", fromLocationId: null, fromCustom: "", toLocationId: (opts.destinationLocationId ? parseNum(opts.destinationLocationId) : null), forwarderId: forwarderId || null, plannedPickupDate: opts.loadingDate || todayISO(), plannedDeliveryDate: opts.expectedDeliveryDate || todayISO(), containerNumber: "", sealNumber: "", bookingNumber: "", blNumber: "", shippingLine: "", costAmount: 0, costCurrency: currency, costFxRate: fxRate, costPLN: 0, notes: "Sea leg (manual)" },
        ]
      : [
          { id: 1, mode, status: "Booked", fromLocationId: (opts.originLocationId ? parseNum(opts.originLocationId) : null), toLocationId: (opts.destinationLocationId ? parseNum(opts.destinationLocationId) : null), carrierId, forwarderId, plannedPickupDate: opts.loadingDate || todayISO(), plannedDeliveryDate: opts.expectedDeliveryDate || todayISO(), vehiclePlate: "", trailerPlate: "", driverName: "", driverPhone: "", containerNumber: "", sealNumber: "", bookingNumber: "", blNumber: "", temperatureMinC: parseNum(opts.temperatureMinC, 2), temperatureMaxC: parseNum(opts.temperatureMaxC, 8), costAmount: amount, costCurrency: currency, costFxRate: fxRate, costPLN: Math.round(amount * fxRate * 100) / 100, notes: opts.notes || "Manual leg" },
        ],
    goods: [
      { id: 1, poRef: opts.poRef || "", soRef: opts.soRef || "", lotRef: opts.lotRef || "", product: opts.product || "Goods", origin: opts.origin || "", quality: opts.quality || "I", size: opts.size || "", packaging: opts.packaging || "", qtyKg, grossKg: grossForGoodsLine({ qtyKg, product: opts.product, packaging: opts.packaging }, PACKAGING_SEED).grossKg, pallets: parseNum(opts.pallets, Math.max(1, Math.round(qtyKg / 900))), description: opts.product || "Goods" },
    ],
    costs: [
      { id: 1, type: mode === "Air" ? "air_freight" : mode === "Rail" ? "rail_freight" : mode === "Sea" ? "sea_freight" : "road_freight", supplierId: forwarderId || carrierId, amount, currency, fxRate, amountPLN: Math.round(amount * fxRate * 100) / 100, invoiceStatus: "Expected", invoiceRef: "", allocationMethod: "by_kg", notes: "Expected freight" },
    ],
    documents: [
      { id: 1, type: "Transport order", ref: "", status: "Required", date: "", notes: "Generate and send to provider" },
      { id: 2, type: mode === "Air" ? "AWB" : mode === "Sea" || mode === "Multimodal" ? "BL" : "CMR", ref: "", status: "Required", date: "", notes: "Required for billing" },
    ],
    terms: STANDARD_ROAD_TERMS,
  };
}

export function Inp({ value, onChange = () => {}, type = "text", placeholder = "", style = {}, disabled = false, title = "", max, list, min, noFuture }: any) {
  if (type === "date") return <DateInput value={value} onChange={onChange} disabled={disabled} placeholder={placeholder} style={style} min={min} max={max} noFuture={noFuture} title={title} />; // v6.81.0 (D-52)
  if (type === "number") return <input value={value ?? ""} onChange={(e: any) => onChange && onChange({ target: { value: String(e.target.value).replace(",", ".") } })} inputMode="decimal" placeholder={placeholder || undefined} disabled={undefined} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", background: "#fff", ...(style || {}) }} title={undefined} />; // v6.99.6 (A-R9-5): Polish comma decimals accepted
  return <input value={value ?? ""} onChange={onChange} type={type || "text"} placeholder={placeholder} disabled={disabled} title={title} max={max} list={list} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 7, padding: "8px 10px", fontSize: 13, color: disabled ? "#888" : "#111", outline: "none", fontFamily: "inherit", background: disabled ? "#F9FAFB" : "#fff", ...style }} />;
} export { Sel }; export { Lbl }; export { Card }; export { SectionTitle };   // v7.44.0 (AUD3 redundancy): one copy, in ui.tsx
export function StatusBadge({ status, shipment = null }: any) {
  // v6.99.49 (SD-2/SD-5): a supplier's truck shows its own ladder and a "supplier's truck" mark
  const label = shipment ? shipmentStatusLabel(shipment) : status;
  const isSup = shipment && String(shipment.arrangedBy || "").toUpperCase() === "SUPPLIER";
  if (isSup) return <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><StatusBadgeInner status={status} label={label} /><span title="the supplier delivers — we track the truck, no freight cost of ours" style={{ fontSize: 10, fontWeight: 800, color: "#0F766E", background: "#F0FDFA", border: "1px solid #99F6E4", borderRadius: 20, padding: "1px 7px" }}>supplier's truck</span></span>;
  return <StatusBadgeInner status={status} label={label} />;
}
function StatusBadgeInner({ status, label }: any) {
  const s = SHIPMENT_STATUSES[status] || SHIPMENT_STATUSES.Booked;
  return <span style={{ background: s.bg, color: s.color, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{statusWord(label ?? status)}</span>;
}
export function ModeBadge({ mode }: any) {
  const m = MODE_CONFIG[mode] || MODE_CONFIG.Road;
  return <span style={{ background: m.bg, color: m.color, padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{m.icon ? m.icon + " " : ""}{m.label}</span>;
}
export function BillingBadge({ status }: any) {
  const color = status === "Cost allocated" || status === "Closed" ? "#059669" : status === "Ready for supplier invoice" ? "#D97706" : "#6B7280";
  const bg = status === "Cost allocated" || status === "Closed" ? "#D1FAE5" : status === "Ready for supplier invoice" ? "#FEF3C7" : "#F3F4F6";
  return <span style={{ background: bg, color, padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700 }}>{status || "Not ready"}</span>;
}
// SmallButton: shared kit (./ui) — Batch 2.
function EmptyState({ title, sub }: any) {
  return <Card style={{ textAlign: "center", padding: 32, color: "#888" }}><div style={{ fontSize: 14, fontWeight: 700, color: "#444" }}>{title}</div><div style={{ fontSize: 12, marginTop: 4 }}>{sub}</div></Card>;
}

function Kpi({ label, value, sub, onClick }: any) {
  return <div onClick={onClick} title={sub || ""} style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 10, padding: "9px 12px", cursor: onClick ? "pointer" : "default" }}>
    <div style={{ fontSize: 10, color: "#888", fontWeight: 800, letterSpacing: "0.04em", marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.3px" }}>{value}</div>
  </div>;
}

/** v7.23.5 (A-SHV-1, owner approved 13 Oct): the shipments as a full-width list, one row per shipment; a click opens its page. */
function ShipmentTable({ rows, contacts, orders = [], pos = [], termsAll = [], onOpen }: any) {
  const S = (v: any) => String(v ?? "").trim();
  const th: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 600, color: "#94A3B8", padding: "9px 10px", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap", background: "#fff" };
  const td: React.CSSProperties = { textAlign: "left", fontSize: 12, padding: "10px", borderBottom: "1px solid #F1F5F9", verticalAlign: "top" };
  const day = (actual: any, planned: any) => S(actual) ? <span>{formatDMY(S(actual).slice(0, 10))}</span> : S(planned) ? <span style={{ color: "#94A3B8" }}>{formatDMY(S(planned).slice(0, 10))} (planned)</span> : <span style={{ color: "#CBD5E1" }}>—</span>;
  const clientOf = (r: string) => { const o: any = (orders || []).find((x: any) => S(x.number) === r); return o ? soClientName(o) : ""; };
  const supplierOf = (r: string) => { const p: any = (pos || []).find((x: any) => S(x.number) === r); return p ? S(p.supplier?.name || p.supplierName || p.supplier) : ""; };
  const refs = (list: string[], nameOf: (r: string) => string) => list.length ? <>{list.slice(0, 2).map(r => <div key={r} style={{ marginBottom: 6 }}><DocRef num={r} /><div>{nameOf(r)}</div></div>)}{list.length > 2 && <div style={{ fontSize: 11, color: "#94A3B8" }}>+ {list.length - 2} more</div>}</> : <span style={{ color: "#CBD5E1" }}>—</span>;
  return <Card style={{ padding: 0, overflowX: "auto" }}>
    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
      <thead><tr>{["Shipment", "Status", "Mode and route", "Loading → delivery", "SO / Client", "PO / Supplier", "Carriers / Forwarders", "Weight", "Still missing"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>{(rows || []).map((sh: any) => {
        const dead = isCancelled(sh); const cr = carriedRefs(sh); const d = shipmentDates(sh); const legs: any[] = sh.legs || [];
        const from = legs.length ? locationTextFromFields(legs[0].fromLocationId, legs[0].fromCustom) : ""; const to = legs.length ? locationTextFromFields(legs[legs.length - 1].toLocationId, legs[legs.length - 1].toCustom) : "";
        const providers = Array.from(new Set(providerIdsForShipment(sh).map((id: any) => providerName(id, contacts)).filter(Boolean)));
        const docs = (sh.documents || []).filter((x: any) => ["Required", "Missing"].includes(x.status)).map((x: any) => S(x.type));
        const noPlates = !dead && !["Delivered", "Closed"].includes(S(sh.status)) && legs.some((l: any) => l.mode === "Road" && transportUnitsForLeg(l).some((u: any) => !S(u.truckPlate || u.vehiclePlate)));
        const terms = (termsAll || []).filter((x: any) => x.shipment === S(sh.number)).length;
        const missing = dead ? [] : [...docs.slice(0, 2), ...(docs.length > 2 ? [`+ ${docs.length - 2} documents`] : []), ...(noPlates ? ["plates"] : []), ...(terms ? [`${terms} term${terms > 1 ? "s" : ""} to review`] : [])];
        return <tr key={sh.id} onClick={() => onOpen(sh)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") onOpen(sh); }} style={{ cursor: "pointer", background: dead ? "#FEF2F2" : undefined }}>
          <td style={{ ...td, fontWeight: 700, color: dead ? "#B91C1C" : "#0E7490", whiteSpace: "nowrap", textDecoration: dead ? "line-through" : undefined }}>{sh.number}</td>
          <td style={td}><StatusBadge status={sh.status} shipment={sh} /></td>
          <td style={td}><ModeBadge mode={sh.mode} />{(from || to) && <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>{from || "—"} → {to || "—"}</div>}</td>
          <td style={{ ...td, whiteSpace: "nowrap" }}>{day(d.loaded, d.plannedLoading)}<br />{day(d.delivered, d.plannedDelivery)}</td>
          <td style={td}>{refs(cr.soRefs, clientOf)}</td>
          <td style={td}>{refs(cr.poRefs, supplierOf)}</td>
          <td style={td}>{providers.length ? providers.map(p => <div key={p}>{p}</div>) : <span style={{ color: "#CBD5E1" }}>—</span>}</td>
          <td style={{ ...td, whiteSpace: "nowrap" }}>{shipmentKg(sh) ? `${fmtNum(shipmentKg(sh))} kg` : "—"}</td>
          <td style={td}>{missing.length ? missing.map((m, i) => <span key={i} style={{ display: "inline-block", margin: "0 4px 3px 0", padding: "1px 7px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "#FFF8E6", color: "#8A5A00", whiteSpace: "nowrap" }}>{m}</span>) : <span style={{ fontSize: 11, color: "#94A3B8" }}>nothing</span>}</td>
        </tr>; })}</tbody>
    </table>
  </Card>;
}

// v6.18.12 (#2): keep a single auto-managed "customs" cost line in sync with the
// shipment's structured customs section, so the clearance cost flows into allocation
// and Finance like any other cost. Manual customs cost lines (no _customsAuto) are left
// untouched.
// v6.34.6: does this shipment consume the PO/SO shipped budget? Delegates to the
// pure engine rule (sell incoterm + port destination). destIsPort is resolved from

// v6.55.0: shipmentConsumesBudget() removed. It answered "does this movement
// use up the order?" — a question with no correct answer, because the same
// cargo moves several times. Consumption lives on the sales order.


export function syncCustomsCostLine(sh: any) {
  // v6.34.5: ONE auto-managed customs line, identified by a stable source tag (not a
  // fresh id each save) so it can't duplicate, and preserving the id + any manual
  // supplier edit of the existing auto-line. Removing it clears customs.applies so it
  // does not resurrect on the next save.
  const prevAuto = (sh.costs || []).find((c: any) => c._customsAuto || c.source === "customs-auto");
  const costs = (sh.costs || []).filter((c: any) => !(c._customsAuto || c.source === "customs-auto"));
  const c = sh.customs || {};
  const amt = parseNum(c.cost);
  // v7.19.3 (A-INC-1, 4/5): when customs is not ours (the terms say the other side clears) an auto line that carries money is
  // RELEASED as an ordinary line — flagged on the shipment, never dropped silently.
  if (!(c.applies && amt > 0) && prevAuto && (parseNum(prevAuto.amount) > 0 || parseNum(prevAuto.amountPLN) > 0)) {
    const { _customsAuto, source, ...rest } = prevAuto; costs.push({ ...rest, notes: prevAuto.notes || "Customs clearance" });
  }
  if (c.applies && amt > 0) {
    const fx = rateOf(c);
    costs.push({
      id: prevAuto?.id ?? nextId(),
      source: "customs-auto",
      type: "customs",
      // broker from the customs section is the single source of truth; fall back to any
      // manual supplier the user set on the existing auto-line, then the shipment broker.
      supplierId: sh.brokerId ?? prevAuto?.supplierId ?? null,
      amount: amt, currency: c.currency || "PLN", fxRate: fx,
      amountPLN: Math.round(amt * fx * 100) / 100,
      invoiceStatus: prevAuto?.invoiceStatus || "Expected",
      invoiceRef: prevAuto?.invoiceRef || "", allocationMethod: "by_kg",
      notes: c.notes || "Customs clearance", _customsAuto: true,
    });
  }
  return { ...sh, costs };
}

/**
 * BP-60 part D (v6.57.0): the editor grouped by LIFECYCLE STAGE.
 *
 * The editor showed every field a shipment will ever have, all at once, from
 * the moment it was booked. Booking a truck meant scrolling past BL numbers and
 * closing costs that cannot possibly be known yet. Grouping by when the
 * information ARRIVES lets you open the stage you are actually in.
 *
 * Deliberately NOT a wizard: every stage stays open-able at any time, because
 * real shipments do not proceed in order — a BL sometimes lands before the
 * driver's name does.
 */
export function Stage({ title, subtitle, done, total, open, onToggle, children }: any) {
  const complete = total > 0 && done >= total;
  return <Card style={{ padding: 0, overflow: "hidden" }}>
    <button onClick={onToggle} style={{ width: "100%", border: "none", background: open ? "#FAFAFA" : "#fff", cursor: "pointer", padding: "11px 16px", display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: complete ? "#22C55E" : done > 0 ? "#F59E0B" : "#E5E7EB" }}
        title={total > 0 ? `${done} of ${total} filled in` : ""} />
      <span style={{ fontSize: 13, fontWeight: 800, color: "#111" }}>{title}</span>
      {subtitle && <span style={{ fontSize: 11, color: "#94A3B8" }}>{subtitle}</span>}
      <span style={{ flex: 1 }} />
      {total > 0 && <span style={{ fontSize: 10, color: complete ? "#166534" : "#64748B" }}>{done}/{total}</span>}
      <span style={{ fontSize: 11, color: "#94A3B8" }}>{open ? "\u25B2" : "\u25BC"}</span>
    </button>
    {open && <div style={{ padding: "4px 16px 16px" }}>{children}</div>}
  </Card>;
}



export function FieldPrint({ en, pl, value }: any) {
  return (
    <div style={{ border: "1px solid #D1D5DB", padding: 8, minHeight: 46 }}>
      <div style={{ fontSize: 9, color: "#6B7280", fontWeight: 800, textTransform: "uppercase" }}>{en}</div>
      <div style={{ fontSize: 9, color: "#9CA3AF", fontWeight: 700, fontStyle: "italic" }}>{pl}</div>
      <div style={{ whiteSpace: "pre-line", marginTop: 4, fontWeight: 650 }}>{value || "TBA"}</div>
    </div>
  );
}






// ── v6.85.0 (D6): FORWARDER'S REPORTS — the two messages that create containers or onward shipments ──
export function ForwarderReports({ shipment, orders = [], onStuffing, onDevanning }: any) {
  const [mode, setMode] = React.useState<"" | "stuff" | "devan">("");
  const [rows, setRows] = React.useState<any[]>([]);
  const trucks: any[] = []; const containers: any[] = [];
  (shipment.legs || []).forEach((l: any) => (l.vehicles || []).forEach((u: any) => {
    const isC = String(u.kind || "").toLowerCase() === "container" || String(l.mode || "").toLowerCase() === "sea" || !!u.containerNumber;
    (isC ? containers : trucks).push(u);
  }));
  const isSeaish = ["sea", "multimodal"].includes(String(shipment.mode || "").toLowerCase());
  if (!isSeaish) return null;
  const inp: any = { border: "1px solid #E5E7EB", borderRadius: 6, padding: "5px 8px", fontSize: 11 };
  return (
    <Card>
      <SectionTitle right={<span style={{ display: "flex", gap: 6 }}>
        {trucks.length > 0 && <SmallButton kind={mode === "stuff" ? "dark" : "default"} onClick={() => { setMode(mode === "stuff" ? "" : "stuff"); setRows([{ containerNumber: "", seal: "", feeders: [] }]); }}>Forwarder's loading report (POL)</SmallButton>}
        {containers.length > 0 && shipment.purpose === "INBOUND" && <SmallButton kind={mode === "devan" ? "dark" : "default"} onClick={() => { setMode(mode === "devan" ? "" : "devan"); setRows([{ containerId: containers[0]?.id, truckPlate: "", kg: "", destKind: "WAREHOUSE", soNumber: "" }]); }}>De-vanning report (POD) → onward shipments</SmallButton>}
      </span>}>Containers — forwarder's reports</SectionTitle>
      {/* v6.99.87 (A-SD-3, owner): what the two reports do */}
      <div style={{ fontSize: 11, color: "#64748B", marginTop: -6, marginBottom: 8 }}>At the port of loading: which trucks went into which container (number, seal) — fills each container's cargo on the sea transport order and its customs line. At the port of discharge: which container goes onto which truck and where (our warehouse or a client's order) — creates the onward shipments.</div>
      <div style={{ fontSize: 11, color: "#64748B", marginBottom: 8 }}>
        We never record stuffing or de-vanning ourselves — the forwarder reports it. Enter the report once: containers (with the trucks that fed them) are created at the POL; at the POD the onward transfer and delivery shipments are created from where each truck goes.
      </div>
      {mode === "stuff" && (<>
        {rows.map((r: any, i: number) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "150px 110px 1fr 30px", gap: 8, marginBottom: 6, alignItems: "start" }}>
            <input placeholder="Container no." value={r.containerNumber} onChange={e => setRows(rs => rs.map((x, k) => k === i ? { ...x, containerNumber: e.target.value } : x))} style={inp} />
            <input placeholder="Seal" value={r.seal} onChange={e => setRows(rs => rs.map((x, k) => k === i ? { ...x, seal: e.target.value } : x))} style={inp} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {trucks.map((t: any) => { const f = r.feeders.find((z: any) => String(z.truckId) === String(t.id));
                return <label key={String(t.id)} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11, border: "1px solid " + (f ? "#7C3AED" : "#E5E7EB"), borderRadius: 6, padding: "2px 6px" }}>
                  <input type="checkbox" checked={!!f} onChange={() => setRows(rs => rs.map((x, k) => k === i ? { ...x, feeders: f ? x.feeders.filter((z: any) => String(z.truckId) !== String(t.id)) : [...x.feeders, { truckId: t.id }] } : x))} />
                  {t.truckPlate || `truck ${t.id}`}{f && <input type="number" placeholder="split kg" value={f.kg ?? ""} onChange={e => setRows(rs => rs.map((x, k) => k === i ? { ...x, feeders: x.feeders.map((z: any) => String(z.truckId) === String(t.id) ? { ...z, kg: parseNum(e.target.value, 0) || undefined } : z) } : x))} style={{ ...inp, width: 68, padding: "1px 4px" }} />}
                </label>; })}
            </div>
            <ActionButton action="remove" onClick={() => setRows(rs => rs.filter((_, k) => k !== i))} />
          </div>
        ))}
        <div style={{ display: "flex", gap: 8 }}>
          <SmallButton onClick={() => setRows(rs => [...rs, { containerNumber: "", seal: "", feeders: [] }])}>+ Container</SmallButton>
          <SmallButton kind="green" onClick={() => { onStuffing(rows.filter((r: any) => r.containerNumber.trim() && r.feeders.length)); setMode(""); }}>Create containers from report</SmallButton>
        </div>
      </>)}
      {mode === "devan" && (<>
        {rows.map((r: any, i: number) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "150px 120px 90px 130px 1fr 30px", gap: 8, marginBottom: 6 }}>
            <select value={r.containerId ?? ""} onChange={e => setRows(rs => rs.map((x, k) => k === i ? { ...x, containerId: e.target.value } : x))} style={inp}>{containers.map((c: any) => <option key={String(c.id)} value={c.id}>{c.containerNumber || `container ${c.id}`}</option>)}</select>
            <input placeholder="Truck plate" value={r.truckPlate} onChange={e => setRows(rs => rs.map((x, k) => k === i ? { ...x, truckPlate: e.target.value } : x))} style={inp} />
            <input type="number" placeholder="kg" value={r.kg} onChange={e => setRows(rs => rs.map((x, k) => k === i ? { ...x, kg: e.target.value } : x))} style={inp} />
            <select value={r.destKind} onChange={e => setRows(rs => rs.map((x, k) => k === i ? { ...x, destKind: e.target.value } : x))} style={inp}><option value="WAREHOUSE">→ our warehouse (transfer)</option><option value="SO">→ client (SO)</option></select>
            {r.destKind === "SO" ? <select value={r.soNumber} onChange={e => setRows(rs => rs.map((x, k) => k === i ? { ...x, soNumber: e.target.value } : x))} style={inp}><option value="">— sales order —</option>{(orders || []).filter((o: any) => o.status !== "Cancelled" && o.status !== "Draft").map((o: any) => <option key={o.number} value={o.number}>{o.number} · {o.client?.name}</option>)}</select> : <span />}
            <ActionButton action="remove" onClick={() => setRows(rs => rs.filter((_, k) => k !== i))} />
          </div>
        ))}
        <div style={{ display: "flex", gap: 8 }}>
          <SmallButton onClick={() => setRows(rs => [...rs, { containerId: containers[0]?.id, truckPlate: "", kg: "", destKind: "WAREHOUSE", soNumber: "" }])}>+ Truck</SmallButton>
          <SmallButton kind="green" onClick={() => { onDevanning(rows.filter((r: any) => r.truckPlate.trim() && parseNum(r.kg, 0) > 0 && (r.destKind === "WAREHOUSE" || r.soNumber))); setMode(""); }}>Create onward shipments</SmallButton>
        </div>
      </>)}
    </Card>
  );
}


// ── v6.93.0 (A-R8-19): TRANSPORT ORDERS — one per CARRIER × LEG, each with its own Mark sent ──

// ── v6.99.50 (TO-4, owner): what the carrier was told when the order was sent — pallets and gross per shipment, derived — so a
// later final weight can be compared with it. Stored WITH the send record (a fact of the send, not a second quantity).
function sentCargoSnapshot(sh: any, types: any[]): { pallets: number; grossKg: number } {
  let pallets = 0, grossKg = 0;
  (sh?.goods || []).forEach((g: any) => { const gr = grossForGoodsLine({ ...g, boxes: undefined, pallets: undefined }, types || []); pallets += gr.pallets || 0; grossKg += gr.grossKg || parseNum(g.qtyKg); });
  return { pallets, grossKg: Math.round(grossKg) };
}
export function cargoVariance(sh: any, types: any[]): { told: { pallets: number; grossKg: number } | null; now: { pallets: number; grossKg: number }; overKg: number } | null {
  const sends = Object.values(sh?.transportOrders || {}) as any[];
  const told = sends.map(s => s?.told).filter(Boolean).sort((a: any, b: any) => 0)[0] || null;
  if (!told) return null;
  const now = sentCargoSnapshot(sh, types);
  return { told, now, overKg: now.grossKg - told.grossKg };
}



export const th = { padding: "8px 8px", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 800 };
export const td = { padding: "9px 8px", verticalAlign: "top" };
export function ChecklistLine({ ok, label, warnText = "" }: any) {
  return <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #F1F5F9" }}><div style={{ fontSize: 12, color: "#444" }}>{label}</div><div style={{ fontSize: 11, fontWeight: 800, color: ok ? "#16A34A" : "#D97706" }}>{ok ? "OK" : (warnText || "Open")}</div></div>;
}

export default function Shipments({ archive = null, claims: extClaims = [], initialStatusFilter = "",   // v7.20.0 (A-INC-2): the claims the review reads; the Dashboard opens the list on its filter
  shipments: extShipments,
  packagingTypes = [],
  claims = [],   // v7.27.8 (A-W5): the app passes the claims — the counter starts above the highest number
  setClaims = null,
  setShipments: extSetShipments,
  contacts: extContacts = [],
  // v6.30.2: no `= []` defaults on pos/lots/orders — with them, `??` could never
  // distinguish "standalone (props undefined)" from "clean system (empty array)".
  pos: extPOs,
  setPOs: extSetPOs,
  lots: extLots,
  setLots: extSetLots,
  orders: extOrders,
  setOrders: extSetOrders,
  onNavigate = () => {},
  onOpenPacking = null,   // v6.99.56 (A-PL-5)
  onStartClaim = null,
  initialSelectedNumber = "",
  initialEdit = false,   // v7.23.5 (A-SHV-1): open the editor directly (the suites' way in) — a link now opens the shipment's page
  invoices: extInvoices = [],
  inspections: extInspections = [],
  planningSheets = [], setPlanningSheets = null, planningSheetLog = [], setPlanningSheetLog = null, productCatalog: productCatalogProp = [], userName: userNameProp = "",   // v6.99.63   // v6.99.55 (BD-1): the board reads the inspection header for step 4
}: any = {}) {
  const { confirm: shConfirm, prompt: shPrompt, alert: shAlert, dialogNode: shDialogNode } = useConfirm(); // P2-6 + v6.85.0 (D10 date prompt)
  // v6.45.0 (A): synchronous mirror of the shipments array for chain-safe updates.
  const shipmentsMirror = React.useRef(null);
  React.useEffect(() => { shipmentsMirror.current = shipments; });
  const [localShipments, setLocalShipments] = useState<any[]>([]); // v6.32.0 (R7b-5): demo seed removed from bundle
  const [localPOs] = useState<any[]>([]);   // v7.22.0 (FZ-19): read-only fallback — the legacy PO link writes are gone
  const [localLots, setLocalLots] = useState<any[]>([]);
  const [localOrders, setLocalOrders] = useState<any[]>([]);
  const shipments = extShipments || localShipments;
  const setShipments = extSetShipments || setLocalShipments;
  // v6.30.2 (G1 completion): nullish fallback, not length-based. The integrated app
  // always passes arrays; an EMPTY array (clean system after reset) must stay empty,
  // not silently swap in the STANDALONE_* demo data. Stubs remain for true standalone
  // use only (props undefined).
  const pos = extPOs ?? localPOs;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const lots = extLots ?? localLots;
  const setLots = extSetLots || setLocalLots;
  const orders = extOrders ?? localOrders;
  const setOrders = extSetOrders || setLocalOrders;
  const contacts = React.useMemo(() => extContacts || [], [extContacts]);

  const [selectedId, setSelectedId] = useState(() => ((initialSelectedNumber && (shipments || []).find((x: any) => String(x.number) === String(initialSelectedNumber))) || shipments[0] || {}).id || null);   // v7.23.5 (A-SHV-1)
  const [boardView, setBoardView] = useState(false);   // v6.99.55 (BD-1): list · detail · BOARD
  const [query, setQuery] = useState("");
  const [modeFilter, setModeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter || "Open");   // v7.20.0: the Dashboard's 'Terms to review' tile opens on that filter
  const [showCreate, setShowCreate] = useState(false);
  // v6.56.0: Load Plan lives as a TAB inside Shipments (user ruling), not a
  // separate module — it is the same work, one level up.
  const [tab, setTab] = useState("shipments");
  // Which load plan a shipment belongs to, so the list can badge it — a truck
  // that is part of a bigger export should say so where you scan for it.
  // v6.99.124 (A-LP-1): load plans retired — no plan number on the list any more
  // v6.99.42: a shipment can be opened from another module ("Open" on the PO's supplier-truck box)
  const [showCustomsImport, setShowCustomsImport] = useState(false);   // v6.99.72 (A-CU-3)
  const [editShipment, setEditShipment] = useState<any>(() => (initialEdit && initialSelectedNumber ? (extShipments || []).find((x: any) => String(x.number) === String(initialSelectedNumber)) || null : null));   // v7.23.5 (A-SHV-1): a link from another module opens the shipment's PAGE; only initialEdit opens the editor
  const [pageOpen, setPageOpen] = useState<boolean>(() => !!(initialSelectedNumber && (extShipments || []).some((x: any) => String(x.number) === String(initialSelectedNumber))));
  const [printShipment, setPrintShipment] = useState(null);
  const [protocolShipment, setProtocolShipment] = useState<any>(null);
  const [emailShipment, setEmailShipment] = useState(null);
  const [toast, setToast] = useState("");

  const sorted = useMemo(() => [...shipments].sort((a, b) => statusRank(a.status) - statusRank(b.status) || String(b.loadingDate || "").localeCompare(String(a.loadingDate || ""))), [shipments]);
  // v6.99.54 (AR-4, owner): the day-to-day lists show the CURRENT season; archived documents appear only with "include archived".
  const archiveShow = (doc: any) => !archive || archive.includeArchived || !isArchived("shipment", doc, archive.archivedSeasons || [], archive.settings || DEFAULT_SEASON, { pos: archive.pos || [] });
  const customsOpenSet = useMemo(() => new Set(outstandingCustoms(shipments).map(r => r.number)), [shipments]);   // v7.10.4 (A-RV-15)
  // v7.20.0 (A-INC-2, P-9): every inconsistency with the incoterms — this season's shipments, sales and purchases (as the Dashboard counts them) and the claims
  const inSeason = (kind: string, doc: any) => !archive || archive.includeArchived || !isArchived(kind as any, doc, archive.archivedSeasons || [], archive.settings || DEFAULT_SEASON, { pos: archive.pos || [] });
  const termsAll = useMemo(() => termsToReview({ pos: (pos || []).filter((p: any) => inSeason("po", p)), orders: (orders || []).filter((o: any) => inSeason("so", o)), shipments: (shipments || []).filter((s: any) => inSeason("shipment", s)), claims: extClaims || [], contacts, lots: lots || [], placeOf: (id: any) => locationById(id, contacts), countryOf: countryOfLocation }), [pos, orders, shipments, extClaims, contacts, lots, archive]);   // eslint-disable-line react-hooks/exhaustive-deps
  const termsShipmentSet = useMemo(() => new Set(termsAll.map(x => x.shipment).filter(Boolean)), [termsAll]);
  const termsShown = useMemo(() => { const q = norm(query); return q ? termsAll.filter(x => [x.term, x.doc, x.record, x.text].join(" ").toLowerCase().includes(q)) : termsAll; }, [termsAll, query]);   // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = useMemo(() => {
    const q = norm(query);
    return sorted.filter(s => {
      if (!archiveShow(s)) return false;   // v6.99.54 (AR-4)
      if (modeFilter !== "All" && s.mode !== modeFilter) return false;
      if (statusFilter === "Open" && ["Closed", "Cancelled"].includes(s.status)) return false;
      if (statusFilter === TERMS_REVIEW) { if (!termsShipmentSet.has(String(s.number))) return false; }   // v7.20.0 (A-INC-2): shipments with a term to review
      else if (statusFilter === CUSTOMS_OPEN) { if (!customsOpenSet.has(String(s.number))) return false; }   // v7.10.4 (A-RV-15): shipments whose customs clearance is still open
      else if (statusFilter !== "All" && statusFilter !== "Open" && s.status !== statusFilter) return false;
      if (!q) return true;
      const hay = [s.number, s.transportOrderNo, s.status, s.mode, s.purpose, ...(s.poRefs || []), ...(s.soRefs || []), ...(s.lotRefs || []), providerName(s.carrierId || s.forwarderId, contacts), ...(s.goods || []).map(g => g.product)].join(" ").toLowerCase();
      return hay.includes(q);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, query, modeFilter, statusFilter, contacts, archive, customsOpenSet, termsShipmentSet]);
  const selected = shipments.find(s => s.id === selectedId) || filtered[0] || shipments[0] || null;

  // v6.58.0 one-time reconcile: shipments that reached Loaded/Arrived before
  // auto-posting existed left their lots stuck at "Expected". Apply the missed
  // movements once, guarded on data being present (the v6.51.1 lesson) and on
  // postShipmentToLots' own idempotence, so nothing double-posts.
  const reconciledRef = React.useRef(false);
  React.useEffect(() => {
    if (reconciledRef.current) return;
    if (!(shipments || []).length || !(lots || []).length) return;   // data-present guard
    reconciledRef.current = true;
    const eligible = shipments.filter((sh: any) => ["Loaded", "Arrived", "Delivered", "Closed"].includes(sh.status) && !isCancelled(sh));
    let touched = 0;
    eligible.forEach((sh: any) => {
      const refs = engineShipmentLotRefs(sh);
      const missing = refs.some((r: any) => {
        const lot = (lots || []).find((l: any) => String(l.number) === String(r));
        return lot && !(lot.movements || []).some((m: any) => String(m.shipmentRef) === String(sh.number));
      });
      if (missing) { applyInventoryMovement(sh); touched += 1; }
    });
    if (touched) {
      try { recordAudit({ module: "Shipments", docType: "Reconcile", docNumber: "v6.58.0", action: "auto-posted",
        summary: `${touched} shipment(s) had reached Loaded without lot movements — posted now.` }); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipments, lots]);

  const kpis = useMemo(() => {
    // v6.54.0: a cancelled shipment NEVER HAPPENED, so it counts toward nothing.
    // Before this release only `open` and `inTransit` excluded it, while
    // missingDocs / billingReady / unallocated silently counted cancelled
    // shipments — a document never chased, an invoice never coming, a cost that
    // was already stripped off the lots at cancellation time. Every one of those
    // was a task on a screen that no one could ever complete.
    const live = liveOnly<any>(shipments);
    const open = live.filter(s => s.status !== "Closed");
    const inTransit = live.filter(s => ["Loaded", "Arrived"].includes(s.status));
    const missingDocs = live.filter(s => (s.documents || []).some(d => ["Required", "Missing"].includes(d.status))).length;
    const billingReady = live.filter(s => s.billingStatus === "Ready for supplier invoice").length;
    const unallocated = live.filter(s => shipmentCostPLN(s) > 0 && !["Cost allocated", "Direct cost of sale", "Closed"].includes(s.billingStatus)).length;
    return { open: open.length, inTransit: inTransit.length, missingDocs, billingReady, unallocated };
  }, [shipments]);

  async function saveShipment(next) {
    { const f = fillEmptyPlaces(next, { orders: extOrders || [], lots: extLots || [] }); if (f.filled.length) next = f.next; }   // v7.9.2 (A-INC-1): empty places filled from their owners, never overwritten
    // v6.66.0 (owner ruling): over-shipping an SO is confirm-gated, not silent.
    const over = overShipReport(next, shipments, extOrders || []);
    if (over.length) {
      const lines = over.map(o => `• ${o.soRef} · ${o.product}: ordered ${o.orderedKg.toLocaleString("pl-PL")} kg, already shipped ${o.alreadyKg.toLocaleString("pl-PL")}, this shipment adds ${o.thisKg.toLocaleString("pl-PL")} → OVER by ${o.exceedKg.toLocaleString("pl-PL")} kg`).join("\n");
      const ok = await shConfirm({ tone: "danger", title: "This would ship MORE than was ordered", message: `${lines}\n\nThe same goods may already be on another live shipment. Ship anyway?`, confirmLabel: "Ship anyway", cancelLabel: "Go back" });
      if (!ok) return;
    }
    const { __isNew, ...clean } = next || {};
    if (__isNew) {
      setShipments(prev => [clean, ...prev]);
      setSelectedId(clean.id);
      recordAudit({ module: "Shipments", docType: "Shipment", docNumber: clean.number, action: "created", summary: `Shipment created (${clean.mode || "?"} · ${clean.status || "Draft"})` });
      setToast(`${clean.number} created.`);
    } else {
      setShipments(prev => prev.map(s => s.id === clean.id ? clean : s));
      // v6.37.1 (F-2): a shipment whose costs are already in lot costing re-allocates on
      // every save, so cost edits flow through automatically (replace-by-source = idempotent).
      if (clean.billingStatus === "Cost allocated" && engineShipmentLotRefs(clean).length) {
        setLots(prev => allocateShipmentCostsToLots(clean, prev, { inventoryType: costInventoryType, label: costTypeLabel }));
        setToast(`${clean.number} saved — lot costing updated.`);
      } else {
        setToast(`${clean.number} saved.`);
      }
    }
    setEditShipment(null);
    notifySaved(String(next?.number || ""));   // v6.99.69 (A-CF-3)
  }

  function createShipment(sh) {
    // Batch 3c (BP-25): one-step — the full editor opens immediately on the new
    // draft; nothing is committed until Save. Cancel discards the draft.
    // v6.99.43 (M-6, owner): step 2 starts arranged — the first road unit is scaffolded with the goods so the dispatcher
    // lands on "which truck, which carrier, what price" instead of on an empty leg.
    const legs = (sh.legs || []).map((leg: any, i: number) => {
      if (i !== 0 || (leg.vehicles || []).length) return leg;
      const unit: any = blankTransportUnit(leg.mode);
      const load = (sh.goods || []).map((g: any) => ({ goodsLineId: g.id, qtyKg: parseNum(g.qtyKg) })).filter((a: any) => a.qtyKg > 0);
      if (load.length) unit.load = load;
      return { ...leg, vehicles: [unit] };
    });
    setShowCreate(false);
    // v6.99.59 (A-OW-3, owner): the shipment is SAVED as a Draft first — closing the editor keeps it, nothing typed in the
    // create window is lost; the editor then edits a record that exists.
    const created = { ...sh, legs, status: sh.status || "Draft" };
    delete (created as any).__isNew;
    setShipments(prev => [created, ...prev]);
    setSelectedId(created.id);
    recordAudit({ module: "Shipments", docType: "Shipment", docNumber: created.number, action: "created", summary: `Shipment created as Draft (${created.mode || "?"}) — opened for arranging` });
    setEditShipment(created);
  }

  // v6.45.0 (ROOT CAUSE A): chain-safe updates. The old version built `updated`
  // from the RENDER SNAPSHOT of `shipments`, so when one action chained two
  // updates (status → then allocation, as Delivered/Closed do), the second was
  // built from the stale pre-status base and CLOBBERED the status back — the
  // user's "Delivered ×3, stored Loaded" audit trail. The ref mirror below is
  // updated synchronously, so successive updates in one action always build on
  // each other; state itself is still set functionally.
  function updateShipment(id, updater) {
    const base = (shipmentsMirror.current || shipments).find(s => s.id === id);
    if (!base) return null;
    const updated = typeof updater === "function" ? updater(base) : { ...base, ...updater };
    shipmentsMirror.current = (shipmentsMirror.current || shipments).map(s => s.id === id ? updated : s);
    setShipments(prev => prev.map(s => s.id === id ? updated : s));
    return updated;
  }



  function markConfirmationSent(sh) {
    const next = updateShipment(sh.id, s => ({ ...s, confirmationStatus: "Sent", confirmationSentAt: new Date().toISOString(), documents: (s.documents || []).map(d => d.type === "Transport order" ? { ...d, status: "Sent", ref: s.transportOrderNo || s.number, date: todayISO() } : d) }));
    setPrintShipment(next || sh);
    setToast(`${sh.number} marked as sent to carrier/forwarder.`);
  }
  // v6.4.0: sea/air/rail transport orders use manually entered terms (the
  // standard 10 clauses are road/CMR-specific). Saved once per shipment.
  function saveOrderTerms(sh, text) {
    const next = updateShipment(sh.id, s => ({ ...s, customOrderTerms: text }));
    if (next) setPrintShipment(next);
  }

  // v6.49.0: build a RECOVERY claim from this shipment. The respondent defaults to
  // the leg's carrier/forwarder, the subjects name the shipment and every lot it
  // carried, and the evidence is pre-linked from what the shipment already holds:
  // the signed loading protocol and the CMR scan. The basis defaults to MIXED —
  // a transport claim is normally cargo lost PLUS the cost of putting it right.
  async function raiseTransportClaim(sh) {
    // v6.63.0 (D-13): one claims UI — navigate to Claims pre-filled with the
    // shipment, the responsible carrier/forwarder and its transport invoice.
    if (typeof onStartClaim === "function") {
      const findContact = (id: any) => id == null ? null : (contacts || []).find((c: any) => String(c.id) === String(id)) || null;
      const carrier = findContact(sh.carrierId) || findContact(sh.forwarderId) || null;
      const kind = sh.forwarderId && !sh.carrierId ? "Forwarder" : "Carrier";
      const tInv = (extInvoices || []).find((i: any) => i.kind === "COST" && i.paymentStatus !== "Cancelled" && (i.links || []).some((lk: any) => lk.type === "Shipment" && String(lk.number) === String(sh.number)));
      onStartClaim({
        respondentKind: kind, direction: "RECOVERY", currency: (sh.costs || [])[0]?.currency || sh.currency || "PLN", fxToPLN: (sh.costs || [])[0]?.fxRate || 1, // v6.81.0 (D-62)
        respondentName: carrier?.name || "", contactId: carrier?.id ?? null,
        cause: "Transport damage",
        subjects: [
          { kind: "SHIPMENT", ref: sh.number },
          ...((sh.lotRefs || []).slice(0, 3).map((r: any) => ({ kind: "LOT", ref: r }))),
          ...(tInv ? [{ kind: "INVOICE", ref: tInv.number }] : []),
        ],
        notes: `Transport claim on ${sh.number}`,
      });
      return;
    }

    if (typeof setClaims !== "function") return;
    // v6.54.0 (user ruling): a cancelled shipment never happened, so there is
    // nothing to claim against. Blocked at the point of raising rather than
    // filtered out later — a drafted claim on a void movement would otherwise
    // travel to a carrier before anyone noticed.
    if (isCancelled(sh)) {
      await shConfirm({ tone: "warn", title: "Shipment cancelled",
        message: `${sh.number} was cancelled — the movement never happened, so there is nothing to claim against. If goods really did travel, un-cancel the shipment first.`,
        confirmLabel: "OK" });
      return;
    }
    const leg = (sh.legs || [])[0] || {};
    const providerId = leg.carrierId || leg.forwarderId || sh.carrierId || sh.forwarderId;
    const provider = (contacts || []).find((c) => String(c.id) === String(providerId));
    const kind = (leg.forwarderId || sh.forwarderId) ? "Forwarder" : "Carrier";
    const lotRefs = uniq((sh.goods || []).map((g) => g.lotRef).filter(Boolean));
    const evidence = [];
    // v6.53.0 made sheets per-truck; a claim must cite ALL of them, not the
    // legacy single one — a groupage truck's damage may sit on any of them.
    const sheets = protocolsForShipment(sh);
    sheets.forEach((p) => evidence.push({ kind: `Loading protocol ${p.number}${p.truckPlate ? ` (${p.truckPlate})` : ""}`, ref: p.number, link: p.scanLink || "" }));
    const lp = sheets[0] || null;
    (sh.documents || []).filter((d) => ["cmr", "bl", "awb"].includes(String(d.type || "").toLowerCase()))
      .forEach((d) => evidence.push({ kind: d.type, ref: d.ref || "", link: d.link || "" }));
    const recorders = (sh.legs || []).flatMap((l) => transportUnitsForLeg(l)).map((u) => u.tempRecorderNo).filter(Boolean);
    if (recorders.length) evidence.push({ kind: "Temperature recorder", ref: recorders.join(", "), link: "" });

    const today = localTodayISO();
    const clmNo = await issueNumber("CLM", new Date(today).getFullYear() || new Date().getFullYear(), (claims || []).map((x: any) => x.number));   // v7.27.8 (A-W5)
    setClaims((prev) => {
      const list = prev || [];
      return [...list, {
        ...blankClaim(),
        id: nextId(),
        number: clmNo || nextClaimNumber(list, new Date(today).getFullYear() || 2026),
        direction: "RECOVERY",
        respondent: { kind, contactId: providerId ?? null, name: provider?.name || "" },
        cause: "Transport damage",
        basis: "MIXED",
        subjects: [
          { kind: "SHIPMENT", ref: sh.number },
          ...lotRefs.map((r) => ({ kind: "LOT", ref: r })),
          ...uniq(sh.soRefs || []).map((r) => ({ kind: "SO", ref: r })),
        ],
        date: today,
        status: "Draft",
        evidence,
        notes: `Raised from ${sh.number}${sheets.length
          ? ` · ${sheets.filter((p) => p.status === "Returned").length}/${sheets.length} loading protocol(s) signed & returned`
          : " · no loading protocol on file"}`,
      }];
    });
    await shConfirm({
      tone: "info", title: "Transport claim drafted",
      message: `A recovery claim against ${provider?.name || kind.toLowerCase()} has been created in Claims, covering ${sh.number}${lotRefs.length ? ` and ${lotRefs.length} lot(s)` : ""}.\n\nOpen Claims to set the amounts, the notice deadline and the evidence.${lp && lp.status !== "Returned" ? "\n\nNote: the loading protocol for this shipment has not come back signed — without it the carrier can argue the pallets were already damaged." : ""}`,
      confirmLabel: "OK", cancelLabel: "Close",
    });
  }

  async function quickStatus(sh, status) {
    // v6.99.49 (X-4, owner): with several trucks, every goods row must be fully spread across them before the shipment is LOADED —
    // the protocol and the CMR print what each truck carries, and an unallocated remainder prints nowhere.
    if (String(status) === "Loaded") {
      // v6.99.66 (A-SA-2, owner): the customs invoice needs a CONFIRMED sale — the last decision moment is loading day
      { const refs = Array.from(new Set([String(sh.governingSoRef || ""), ...shipmentSORefs(sh, orders)].filter(Boolean)));
        const drafts = refs.filter(n => String(((orders || []).find((o: any) => String(o.number) === n) || {}).status) === "Draft");
        if (drafts.length) { await shAlert({ tone: "warn", title: "The sale is still a draft", message: `Confirm ${drafts.join(", ")} first — the customs invoice needs a confirmed sale. The client can still change while it is a draft.` }); return; } }
      // v6.99.56 (A-PL-5, owner): what is loaded is posted to stock — never an estimate. The producer's packing list comes first.
      { const n2 = (v: any) => String(v ?? "").trim().toLowerCase();
        const estPOs = Array.from(new Set((sh.goods || []).map((g: any) => { const po = (pos || []).find((p: any) => String(p.number) === String(g.poRef)); if (!po) return ""; const line = (po.items || []).find((it: any, i: number) => String(it.id ?? i + 1) === String(g.poLineId)) || (po.items || []).find((it: any) => n2(it.product) === n2(g.product) && n2(it.size || "") === n2(g.size || "")); return line && isEstimatedLine(line) ? String(po.number) : ""; }).filter(Boolean))) as string[];
        if (estPOs.length) {
          const go = await shConfirm({ tone: "warn", title: "Quantities still estimated", message: `${estPOs.join(", ")} still ${estPOs.length > 1 ? "carry" : "carries"} estimated quantities. Enter the producer's packing list first — the shipment, the sale and the lots follow it, and then the truck can be marked loaded.`, confirmLabel: onOpenPacking ? `Open the packing list of ${estPOs[0]}` : "OK", cancelLabel: "Not now" });
          if (go && typeof onOpenPacking === "function") onOpenPacking(estPOs[0]);
          return;
        } }
      const trucks = ((sh.legs || [])[0]?.vehicles || []);
      if (trucks.length > 1) {
        const gaps = (sh.goods || []).map((g: any) => { const alloc = trucks.reduce((s: number, u: any) => s + parseNum(((u.load || []).find((x: any) => String(x.goodsLineId) === String(g.id)) || {}).qtyKg), 0); const un = Math.round(parseNum(g.qtyKg) - alloc); return Math.abs(un) > 1 ? `${g.product || "row"}: ${un > 0 ? un + " kg not on any truck" : Math.abs(un) + " kg over-allocated"}` : null; }).filter(Boolean) as string[];
        if (gaps.length) { await shAlert({ tone: "warn", title: "Goods not fully allocated", message: `Spread every row across the trucks before marking loaded:\n${gaps.join("\n")}` }); return; }
      }
    }
    // v6.99.39 (G-6, owner): a sea / air / rail shipment cannot be LOADED without its booking — cut-off, POL, POD and the
    // forwarder are what the containers, the BL and the sea freight line hang on.
    if (String(status) === "Loaded" && ["sea", "multimodal", "air", "rail"].includes(String(sh.mode || "").toLowerCase())) {
      const b = (sh.bookings || [])[0] || {};
      const missing = [!b.number && "booking number", !b.cutOff && "cut-off", !b.pol && "POL", !b.pod && "POD", !b.forwarderId && "forwarder"].filter(Boolean) as string[];
      if (missing.length) { await shAlert({ tone: "warn", title: "Booking incomplete", message: `Complete the booking before marking the shipment loaded: ${missing.join(", ")}.` }); return; }
    }
    // v6.85.0 (D10, owner ruling): the actual date is entered ONCE, here, when the event
    // happens — default today, editable (backdate when the news arrives late) — and it
    // travels: unit events, header mirrors, SO planned-vs-actual, posting dates.
    if (["Loaded", "Delivered"].includes(String(status))) {
      const ans = await shPrompt({ title: `${status} — actual date`, message: `When did it actually happen? (dd/mm/yyyy — default today; backdate if you learnt it later)`, defaultValue: todayISO().split("-").reverse().join("/"), confirmLabel: `Mark ${status}` });
      if (ans === null) return;
      const m = String(ans).trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
      const iso = m ? `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}` : todayISO();
      // v6.99.15 (A-R11-10): a date that differs from the plan is confirmed, with the difference shown
      const planned = (sh.legs || []).flatMap((l: any) => (l.vehicles || []).map((u: any) => String(status === "Loaded" ? (u.plannedLoadingDate || "") : (u.plannedDeliveryDate || "")).slice(0, 10))).filter(Boolean);
      if (planned.length && !planned.includes(iso)) { const dd = Math.round((new Date(iso).getTime() - new Date(planned[0]).getTime()) / 86400000); const okDate = await shConfirm({ tone: "warn", title: `${status} on a different date`, message: `Planned ${planned.join(", ")}, actual ${iso} (${dd > 0 ? dd + " day(s) late" : Math.abs(dd) + " day(s) early"}). Record it anyway?`, confirmLabel: "Yes, record" }); if (!okDate) return; }
      const kind = status === "Loaded" ? "loaded" : (String(sh.purpose || "").toUpperCase() === "INBOUND" && ["sea", "multimodal"].includes(String(sh.mode || "").toLowerCase()) ? "discharged" : "delivered");
      // v6.99.56 (A-PL-6): "Loaded" = the goods leave the origin — the leg-1 units. A container on the sea leg is stuffed, sails and
      // discharges on its own events; it must not inherit the truck's loading day.
      const stampLoaded = (x: any) => { if (kind !== "loaded") return stampEvent(x, null, kind as any, iso); const ids = (((x.legs || [])[0] || {}).vehicles || []).map((u: any) => u.id); return ids.length ? ids.reduce((acc: any, id: any) => stampEvent(acc, id, "loaded", iso), x) : x; };
      updateShipment(sh.id, (s: any) => stampLoaded(s));
      sh = stampLoaded(sh);
    }
    // v6.78.0 THE ONE GATE. Since v6.58.0 these statuses POST INVENTORY. A
    // shipment with no goods posts nothing and still reports the movement as
    // done — the same class as the phantom receipts. Booking is never gated:
    // the transport order goes to the carrier before the goods are final.
    const postBlock = shipmentPostBlockReason(sh, status, { orders: extOrders || [], lots: extLots || [] });   // v7.9.1 (A-SHP-GATE-1)
    if (postBlock) {
      await shConfirm({ tone: "warn", title: `${sh.number} has no goods`, message: postBlock, confirmLabel: "OK" });
      return;
    }
    // v6.35.0: destructive transition needs an explicit confirmation (2-step).
    if (status === "Cancelled") {
      const ok = await shConfirm({ tone: "danger", title: `Cancel shipment ${sh.number}?`, message: "It will be kept on record as Cancelled (read-only) and will no longer count toward its PO/SO budget. Any inventory movements it already posted (receipts / ship-outs) will be reversed. This can't be undone.", confirmLabel: "Cancel shipment", cancelLabel: "Keep" });
      if (!ok) return;
    }
    const today = todayISO();
    const next = updateShipment(sh.id, s => {
      const patch: any = { ...s, status };
      if (status === "Confirmed") patch.confirmationStatus = s.confirmationStatus === "Not sent" ? "Generated" : s.confirmationStatus;
      if (status === "Loaded") {
        // v7.28.7 (Batch L): the trucks own the actual dates — a truck of the first leg without a loading date gets today's
        patch.legs = (s.legs || []).map((l, idx) => idx === 0 ? { ...l, status: "Loaded", actualPickupDate: l.actualPickupDate || today, vehicles: (l.vehicles || []).map((u: any) => unitLoadedAt(u) ? u : { ...u, loadedAt: today }) } : l);
      }
      if (status === "Arrived") {
        patch.legs = (s.legs || []).map((l, idx, arr) => idx === arr.length - 1 ? { ...l, status: "Arrived", actualDeliveryDate: l.actualDeliveryDate || today } : l);
      }
      if (status === "Delivered") {
        patch.billingStatus = "Ready for supplier invoice";   // v7.28.7 (Batch L): the trucks of the last leg without an unloading date get today's
        patch.legs = (s.legs || []).map((l, idx, arr) => idx === arr.length - 1 ? { ...l, status: "Delivered", actualDeliveryDate: l.actualDeliveryDate || today, vehicles: (l.vehicles || []).map((u: any) => unitUnloadedAt(u) ? u : { ...u, unloadedAt: today }) } : l);
      }
      if (status === "Closed") {
        patch.billingStatus = s.billingStatus === "Not ready" ? "Ready for supplier invoice" : s.billingStatus;
      }
      if (status === "Cancelled") {
        // v6.66.0 (D-31): allocations are stripped on cancel, so the billing flag
        // falls with them — "Cost allocated" on a cancelled shipment tripped
        // STALE_BILLING_FLAG forever.
        patch.billingStatus = "Not ready";
      }
      return patch;
    });
    if (next) {
      recordAudit({ module: "Shipments", docType: "Shipment", docNumber: next.number, action: status === "Cancelled" ? "cancelled" : "status", summary: status === "Cancelled" ? "Cancelled — inventory postings & allocated costs reversed" : `Status → ${status}` });
      // v6.35.5: cancellation reverses whatever this shipment posted to inventory.
      if (status === "Cancelled") {
        const releasedKg = (next.goods || []).reduce((a: number, g: any) => a + (parseNum(g.qtyKg, 0) || 0), 0);
        const n = reverseShipmentPostings(next);
        // v6.37.1 (F-3): also remove this shipment's ALLOCATED COST lines from lots —
        // a cancelled shipment must not leave phantom landed cost (cost-side mirror of
        // the v6.35.5 phantom-stock fix).
        // v6.99.37 (QA-2): removing a cost line is INVENTORY's business — one function, tested, used by everyone.
        const prefix = shipmentAllocationSourcePrefix(next.number);
        let costTouched = 0;
        setLots(prev => { const r = removeCostsBySource(prev || [], prefix); costTouched = r.touched; return r.lots; });
        // v6.54.0: the truck never ran, so its signed sheets are no longer
        // evidence of anything. They stay on record (nothing is deleted) but
        // read as void, and cannot be issued or marked returned.
        const sheets = protocolsForShipment(next);
        const toVoid = sheets.filter((p: any) => p && p.status !== "Void").length;
        if (toVoid > 0) {
          const voided = sheets.map((p: any) => p && p.status !== "Void"
            ? { ...p, status: "Void", voidedAt: todayISO(), voidNote: `${next.number} cancelled` } : p);
          updateShipment(next.id, (s: any) => ({ ...s, loadingProtocols: voided }));
          setProtocolShipment((cur: any) => cur && cur.id === next.id ? { ...cur, loadingProtocols: voided } : cur);
        }
        // v6.54.0: what a cancellation RELEASED belongs in the trail, not in a
        // toast that vanishes. Under a keep-everything policy the reversal is
        // exactly the part someone will need to reconstruct later.
        const summary = releaseSummaryText({ lotPostings: n, costLots: costTouched, protocols: toVoid, kg: releasedKg });
        try {
          recordAudit({ module: "Shipments", docType: "Shipment", docNumber: next.number,
            action: "cancelled", summary: `Cancelled — ${summary}.` });
        } catch {}
        setToast(`${next.number} cancelled — ${summary}.`);
      }
      // v6.35.4 (T-20): post the inventory movement as soon as the goods ARRIVE, not only
      // at Delivered — for an inbound shipment, arrival at the warehouse IS the receipt.
      // postShipmentToLots is idempotent (its hasMovement guard prevents double-posting),
      // so running on both Arrived and Delivered is safe.
      // v6.58.0 (user ruling: no manual step in the normal flow): LOADED also
      // posts — for an outbound shipment, leaving the dock IS the movement.
      // Waiting for Arrived left the lot reading "Expected, 0 kg, journey at
      // the producer" while a loaded truck was on the road. Idempotent, so
      // Loaded -> Arrived -> Delivered posts each stage exactly once.
      if (status === "Loaded" || status === "Arrived" || status === "Delivered" || status === "Closed") {
        applyInventoryMovement(next);
      }
      // v6.37.1 (F-2, ruling A): delivery concludes the transaction — costs allocate
      // automatically into lot costing (idempotent). The manual button remains for earlier use.
      if ((status === "Delivered" || status === "Closed") && engineShipmentLotRefs(next).length && shipmentCostPLN(next) > 0) {
        allocateCosts(next);
      }
      if (status === "Delivered" || status === "Closed") {
        // v6.79.0 (W-1): physical status is DERIVED from this shipment — nothing to write. A Draft order that ships is confirmed by the fact.
        setOrders(prev => prev.map(o => (next.soRefs || []).includes(o.number) ? { ...o, status: o.status === "Draft" ? "Confirmed" : o.status } : o));
      }
    }
    setToast(`${sh.number} moved to ${status}.`);
  }

  function sendToBilling(sh) {
    updateShipment(sh.id, s => ({ ...s, billingStatus: "Ready for supplier invoice" }));
    setToast(`${sh.number} sent to billing queue. Expected logistics invoice(s): ${fmtMoney(shipmentCostPLN(sh), "PLN")}.`);
  }

  function allocateCosts(sh) {
    // Batch 1b: pure engine with REPLACE-BY-SOURCE — re-allocating after a cost
    // edit/delete replaces this shipment's prior lot lines instead of appending
    // (fixes the stale-allocation audit finding). Tested in tests/run-engines.cjs.
    if (!engineShipmentLotRefs(sh).length) {
      setToast("No lot references on this shipment. Add a lotRef first, then allocate costs.");
      return;
    }
    // v6.62.0: the flag used to be set UNCONDITIONALLY, right after calling the
    // engine — so the screen reported "Cost allocated" even when the engine had
    // returned the lots untouched. That is exactly what happened here: an
    // OUTBOUND shipment does not build landed cost (v6.51.0 — freight that
    // DELIVERS goods to a client is a direct cost of that sale, not part of what
    // the goods cost us), so the engine correctly did nothing and the flag
    // claimed success anyway. Now the status follows what actually landed.
    // v6.76.0: this used to compute `landed` INSIDE the state updater and read it
    // in a setTimeout. Under React 18 the updater is not guaranteed to have run
    // by then, so `landed` read 0, the flag was never set, and the integrity
    // check reported unallocated costs on shipments whose costs HAD allocated —
    // the user pressed the button, the lots gained their lines, and the warning
    // stayed. Computed up front from the same inputs the engine uses: no timing
    // dependency at all.
    const prefixNow = shipmentAllocationSourcePrefix(sh.number); // v6.80.0 (D-40): was passed the object → "[object Object]/" → never counted
    const landed = (allocateShipmentCostsToLots(sh, lots, { inventoryType: costInventoryType, label: costTypeLabel }) || [])
      .reduce((n: number, lot: any) => n + ((lot.costs || []).filter((c: any) => String(c.source || "").startsWith(prefixNow)).length), 0);
    setLots(prev => allocateShipmentCostsToLots(sh, prev, { inventoryType: costInventoryType, label: costTypeLabel }));
    (() => {
      if (landed > 0) {
        updateShipment(sh.id, s => ({ ...s, billingStatus: derivedBillingStatus({ ...s }, lots) }));
        recordAudit({ module: "Shipments", docType: "Shipment", docNumber: sh.number, action: "allocated", summary: `Logistics costs allocated into lot landed cost (${landed} line(s))` });
        setToast(`${sh.number} logistics costs allocated to inventory lot costing.`);
      } else if (String(sh.purpose || "").toUpperCase() === "OUTBOUND") {
        // Not a failure — a different, correct destination for the money.
        updateShipment(sh.id, s => ({ ...s, billingStatus: "Direct cost of sale" }));
        recordAudit({ module: "Shipments", docType: "Shipment", docNumber: sh.number, action: "not allocated", summary: "Outbound delivery — freight is a direct cost of the sale, not lot landed cost" });
        setToast(`${sh.number} is an outbound delivery, so its freight is a direct cost of the sale rather than lot landed cost. Nothing was added to the lots.`);
      } else {
        setToast(`${sh.number}: nothing could be allocated — check that the cost lines have amounts and that the lots exist.`);
      }
    })();
  }


  // v6.35.5: cancelling a shipment AFTER its movements were posted must not leave
  // phantom stock. We VOID the shipment's movements (the reducer ignores voided ones)
  // and recompute each touched lot — a clean, auditable reversal that keeps history.
  function reverseShipmentPostings(sh) {
    const matches = (m) => m && !m.voided && (m.shipmentRef ? String(m.shipmentRef) === String(sh.number) : String(m.note || "").includes(sh.number));
    let touched = 0;
    setLots(prev => (prev || []).map(lot => {
      const has = (lot.movements || []).some(matches);
      if (!has) return lot;
      touched++;
      const movements = (lot.movements || []).map(m => matches(m) ? { ...m, voided: true, voidNote: `Voided — ${sh.number} cancelled` } : m);
      return recomputeLotFromMovements({ ...lot, movements }, movements, locById);
    }));
    return touched;
  }

  function applyInventoryMovement(sh) {
    // Batch 3a: posting is engine-driven and keyed off the EXPLICIT canonical
    // purpose (shipments.domain, tested) — no more inference from soRefs.
    const purpose = derivePurpose(sh);
    setLots(prev => postShipmentToLots(sh, prev, { todayISO, nextId, deliveredKgFor: (n: string) => clientReportKg(n, extInspections || [], (prev || []).find((l: any) => String(l.number) === n)) }).lots);   // v6.99.87 (A-QC-4)
    if (purpose === "OUTBOUND") {
      // v6.79.0 (W-1): derived — only a Draft is promoted to Confirmed; Shipped/Delivered come from the shipments.
      setOrders(prev => prev.map(o => (sh.soRefs || []).includes(o.number) ? { ...o, status: o.status === "Draft" ? "Confirmed" : o.status } : o));
    }
    setToast(`${sh.number} inventory movement applied where matching lot refs exist.`);
  }


  return <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", background: "#FAFAFA" }}>
    {shDialogNode}
    <ModuleHeader title="Shipments" right={<>
            <div style={{ display: "inline-flex", border: "1px solid #CBD5E1", borderRadius: 8, overflow: "hidden" }}>
              {[["list", "List"], ["board", "Weekly board"]].map(([k, l]) => <button key={k} onClick={() => setBoardView(k === "board")} style={{ padding: "4px 10px", border: "none", fontSize: 11, fontWeight: 800, cursor: "pointer", background: (k === "board") === boardView ? "#0F172A" : "#fff", color: (k === "board") === boardView ? "#fff" : "#475569" }}>{l}</button>)}
            </div>
      <div style={{ display: "flex", gap: 8 }}><ActionButton action="importCsv" label="Import customs files" title="v6.99.72 (A-CU-3): drop the agent's files — release (CC529C), exit confirmation (CC599C), SAD copy — each finds its truck" onClick={() => setShowCustomsImport(true)} /><SmallButton onClick={() => exportRowsToXlsx(`shipments_${xlsStamp()}`, filtered, [{ key: "number", label: "Shipment" }, { key: "purpose", label: "Purpose" }, { key: "arrangedBy", label: "Arranged by" }, { key: "mode", label: "Mode" }, { key: "status", label: "Status" }, { key: "poRefs", label: "POs", fmt: (v: any) => (v || []).join(", ") }, { key: "soRefs", label: "SOs", fmt: (v: any) => (v || []).join(", ") }, { key: "legs", label: "Units", fmt: (v: any) => (v || []).flatMap((l: any) => (l.vehicles || []).map((u: any) => `${u.truckPlate || u.containerNumber || "unit"} ${Math.round(Number(u.qtyKg) || 0)} kg${u.loadedAt ? " loaded " + u.loadedAt : ""}`)).join(" | ") }, { key: "actualLoadingDate", label: "Loaded" }, { key: "actualDeliveryDate", label: "Delivered" }, { key: "costs", label: "Costs PLN", fmt: (v: any) => (v || []).reduce((s: number, c: any) => s + (Number(c.amountPLN) || 0), 0) }, { key: "billingStatus", label: "Billing" }], "Shipments")} title="v6.99.0: exports the rows as filtered">Export file (Excel)</SmallButton><SmallButton onClick={() => setShowCreate(true)} kind="green">+ New shipment</SmallButton></div>
    </>} />   {/* v6.99.61 (A-HD-1) */}
    <div style={{ padding: "16px 28px 10px", borderBottom: "1px solid #EBEBEB", background: "#FAFAFA" }}>   {/* v6.99.61 (A-HD-2): full width, no cap */}
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          <Kpi label="OPEN SHIPMENTS" value={kpis.open} sub="not closed / not cancelled" />
          <Kpi label="IN TRANSIT" value={kpis.inTransit} sub="loaded, in transit or arrived" />
          <Kpi label="MISSING DOCS" value={kpis.missingDocs} sub="CMR, BL, OCP or confirmation" />
          <Kpi label="BILLING READY" value={kpis.billingReady} sub="waiting for supplier invoice" />
          <Kpi label="UNALLOCATED COSTS" value={kpis.unallocated} sub="costs not yet in lot costing" />
        </div>
        {/* v6.56.0: Shipments | Load plans. A load plan is the commercial
            movement several shipments add up to — five trucks and four
            containers are one export, nine shipments. */}
        <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
          {[["shipments", `Shipments (${filtered.length})`]].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              border: "none", background: "transparent", cursor: "pointer", padding: "6px 2px", marginRight: 14,
              fontSize: 12, fontWeight: tab === k ? 800 : 600, color: tab === k ? "#111" : "#94A3B8",
              borderBottom: tab === k ? "2px solid #111" : "2px solid transparent",
            }}>{label}</button>
          ))}
        </div>
      </div>
    </div>
    {boardView && <PlanningSheet tabs={planningSheets || []} setTabs={setPlanningSheets || (() => {})} log={planningSheetLog || []} setLog={setPlanningSheetLog || (() => {})} contacts={contacts} catalog={productCatalogProp || []} orders={orders} invoices={extInvoices || []} userName={userNameProp || ""} />}   {/* v6.99.63 (A-SH): the free planning sheet */}
    <div style={{ display: boardView ? "none" : "contents" }}>

    {toast && <div style={{ margin: "12px 28px 0", background: "#F0FDF4", border: "1px solid #BBF7D0", color: "#166534", borderRadius: 9, padding: "9px 12px", fontSize: 12, display: "flex", justifyContent: "space-between" }}><span>{toast}</span><ActionButton action="close" onClick={() => setToast("")} /></div>}

    {/* v6.99.124 (A-LP-1, owner): the Load plans tab retired — the shipment editor's trucks, containers and forwarder reports do what it did */}

    <div style={{ flex: 1, overflow: "auto", padding: "16px 28px 24px", display: tab === "shipments" ? "block" : "none" }}>
      {pageOpen && selected ? (<>   {/* v7.23.5 (A-SHV-1, owner approved 13 Oct): the shipment as its own page, like a PO or an SO */}
        <button type="button" onClick={() => setPageOpen(false)} style={{ border: "none", background: "none", padding: "2px 0", marginBottom: 8, fontSize: 13, fontWeight: 600, color: "#2563EB", cursor: "pointer" }}>← Shipments</button>
          <ShipmentDetail packagingTypes={packagingTypes} shipment={selected} shipmentInvoices={extInvoices || []} expectedDocs={expectedDocuments(selected, { pos, orders, placeOf: (id: any) => locationById(id, contacts) })} onSetDocument={(type: string, status: string = "Have it") => updateShipment(selected.id, (s: any) => { const docs = s.documents || []; const ix = docs.findIndex((d: any) => String(d.type) === type); const row = { ...(ix >= 0 ? docs[ix] : { id: nextId(), type, ref: "", notes: "", link: "" }), status, date: localTodayISO() }; return { ...s, documents: ix >= 0 ? docs.map((d: any, k: number) => k === ix ? row : d) : [...docs, row] }; })} termsFindings={termsAll.filter(x => x.shipment === String(selected.number))} contacts={contacts} orders={orders} pos={pos} lots={lots} onEdit={() => setEditShipment(selected)} onPrint={() => setPrintShipment(selected)} onLoadingProtocol={() => setProtocolShipment(selected)} onRaiseClaim={() => raiseTransportClaim(selected)} onEmail={() => setEmailShipment(selected)} onQuickStatus={(status) => quickStatus(selected, status)} onSendBilling={() => sendToBilling(selected)} onAllocateCosts={() => allocateCosts(selected)} onApplyInventory={() => applyInventoryMovement(selected)}
            allShipments={shipments}   /* v7.23.6 (A-SHV-1): one DHL for several shipments of a client */
            onSetOriginals={(nos: string[], dhl: string, date: string) => { setShipments((prev: any[]) => (prev || []).map((s: any) => nos.includes(String(s.number)) ? { ...s, docsCourierTrackingNo: dhl, docsCourierDate: date } : s)); recordAudit({ module: "Shipments", docType: "Shipment", docNumber: nos.join(", "), action: "updated", summary: `Originals sent by DHL ${dhl} on ${date}: ${nos.join(", ")}` }); setToast(`DHL ${dhl} saved on ${nos.length} shipment(s): ${nos.join(", ")}.`); }}
            onMarkTOSent={(key: string) => { updateShipment(selected.id, (s: any) => ({ ...s, transportOrders: { ...(s.transportOrders || {}), [key]: { sentAt: todayISO(), told: sentCargoSnapshot(s, packagingTypes || []) } }, confirmationStatus: "Sent", confirmationSentAt: s.confirmationSentAt || todayISO() })); recordAudit({ module: "Shipments", docType: "Shipment", docNumber: selected.number, action: "status", summary: `Transport order ${key} marked sent` }); }}
            onStuffing={(rows: any[]) => { updateShipment(selected.id, (s: any) => applyStuffingReport(s, rows, { nextId })); setToast(`${selected.number}: ${rows.length} container(s) created from the forwarder's report.`); }}
            onDevanning={async (rows: any[]) => {
              const byC: Record<string, any> = {};
              rows.forEach((r: any) => { (byC[String(r.containerId)] = byC[String(r.containerId)] || { containerId: r.containerId, trucks: [] }).trucks.push({ truckPlate: r.truckPlate, kg: parseNum(r.kg, 0), destination: r.destKind === "SO" ? { kind: "SO", soNumber: r.soNumber } : { kind: "WAREHOUSE" } }); });
              const issued = (await issueNumbers("SHP", new Date().getFullYear(), (shipments || []).map((x: any) => x.number), Math.max(1, rows.length))).numbers;   // v7.27.8 (A-W5)
              let n = 0; const spawned = spawnFromDevanning(selected, Object.values(byC), { nextId, todayISO, nextNumber: () => { if (issued[n]) return issued[n++]; const num = nextShipmentNumber([...shipments, ...Array.from({ length: n }, (_, k) => ({ number: `${nextShipmentNumber(shipments).slice(0, -4)}${String(parseInt(nextShipmentNumber(shipments).slice(-4), 10) + k).padStart(4, "0")}` }))]); n++; return num; } });
              setShipments((prev: any[]) => [...(prev || []), ...spawned]);
              recordAudit({ module: "Shipments", docType: "Shipment", docNumber: selected.number, action: "created", summary: `De-vanning report → ${spawned.map((s: any) => s.number + " (" + s.purpose + ")").join(", ")}` });
              setToast(`${spawned.length} onward shipment(s) created from the de-vanning report: ${spawned.map((s: any) => s.number).join(", ")}.`);
            }} />
      </>) : (<>
      <PlaceRepairPanel shipments={shipments} setShipments={setShipments} contacts={contacts} pos={pos} orders={orders} />
      <RatesToReviewPanel shipments={shipments} setShipments={setShipments} />{/* v7.28.8 (FZ-36): until no route place is left to repair */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1fr) 160px 200px", gap: 8, marginBottom: 12 }}>
          <Inp value={query} onChange={e => setQuery(e.target.value)} placeholder="Search shipment, PO, SO, lot, provider..." />
          <Sel value={modeFilter} onChange={e => setModeFilter(e.target.value)}><option>All</option>{HEADER_MODES.map(m => <option key={m}>{m}</option>)}</Sel><Sel value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option>Open</option><option>All</option>{STATUS_ORDER.map(s => <option key={s} value={s}>{statusWord(s)}</option>)}<option value={CUSTOMS_OPEN}>{CUSTOMS_OPEN} ({customsOpenSet.size})</option><option value={TERMS_REVIEW}>{TERMS_REVIEW} ({termsAll.length})</option></Sel>
        </div>
        {statusFilter === TERMS_REVIEW   // v7.20.0 (A-INC-2): the review; a shipment line opens that shipment's page (v7.23.5)
          ? <Card style={{ padding: 0 }}><TermsReviewList findings={termsShown} onOpenShipment={(no: string) => { const sh = shipments.find((x: any) => String(x.number) === String(no)); if (sh) { setSelectedId(sh.id); setPageOpen(true); } }} /></Card>
          : filtered.length ? <ShipmentTable rows={newestFirst(filtered)} contacts={contacts} orders={orders} pos={pos} termsAll={termsAll} onOpen={(sh: any) => { setSelectedId(sh.id); setPageOpen(true); }} /> : <EmptyState title="No shipments" sub="Adjust filters or create a new shipment." />}
      </>)}
    </div>

    {showCreate && <CreateShipmentModal productCatalog={productCatalogProp} pos={pos} orders={orders} lots={lots} contacts={contacts} shipments={shipments} onCancel={() => setShowCreate(false)} onCreate={createShipment} />}
    {editShipment && <EditShipmentModal shipment={editShipment} contacts={contacts} lots={lots} pos={pos} orders={orders} packagingTypes={packagingTypes} productCatalog={productCatalogProp} allShipmentsForCap={shipments} invoices={extInvoices} onCancel={() => setEditShipment(null)} onSave={saveShipment} />}
    {showCustomsImport && <CustomsImportModal shipments={shipments} invoices={extInvoices} onClose={() => setShowCustomsImport(false)} setShipments={(next: any[]) => { setShipments(() => next); notifySaved("customs files"); }} />}
    {protocolShipment && <LoadingProtocolModal
      shipment={protocolShipment}
      contacts={contacts}
      pos={pos}
      lots={lots}   /* v7.15.2 */
      packagingTypes={packagingTypes.length ? packagingTypes : PACKAGING_SEED}
      allShipments={shipments}
      companyName={COMPANY.name}
      company={COMPANY}
      shipmentCancelled={isCancelled(protocolShipment)}
      gateReason={poGateReason(protocolShipment, pos)}
      onSave={(p: any, unitId: any) => {
        // v6.53.0: sheets live in an ARRAY, one per truck. The write folds the
        // legacy single `loadingProtocol` forward on first save and then clears
        // it, so no shipment ever carries both shapes at once.
        const withUnit = { ...p, unitId: p.unitId ?? unitId ?? null };
        const apply = (sh: any) => {
          const next = upsertProtocol(protocolsForShipment(sh), withUnit);
          const out = { ...sh, loadingProtocols: next };
          delete out.loadingProtocol;
          return out;
        };
        updateShipment(protocolShipment.id, apply);
        setProtocolShipment((cur: any) => cur ? apply(cur) : cur);
        try {
          recordAudit({ module: "Shipments", docType: "Loading protocol", docNumber: p.number,
            action: p.status === "Returned" ? "returned" : "saved",
            summary: `${protocolShipment.number} · ${(p.rows || []).length} pallets · ${p.status}${p.truckPlate ? ` · ${p.truckPlate}` : ""}${(p.recorderNos || []).length ? ` · recorders ${(p.recorderNos || []).join(", ")}` : ""}` });
        } catch {}
      }}
      onClose={() => setProtocolShipment(null)}
    />}
    {printShipment && <TransportOrderPrintModal lots={lots} pos={pos} packagingTypes={packagingTypes} shipment={printShipment} contacts={contacts} orders={orders} onSaveTerms={(text) => saveOrderTerms(printShipment, text)} onClose={() => setPrintShipment(null)} onMarkSent={() => markConfirmationSent(printShipment)} onEmail={() => { const sh = printShipment; setPrintShipment(null); setEmailShipment(sh); }} />}
    {emailShipment && <TransportOrderEmailModal lots={lots} pos={pos} packagingTypes={packagingTypes} shipment={emailShipment} contacts={contacts} orders={orders} onClose={() => setEmailShipment(null)} onMarkSent={() => markConfirmationSent(emailShipment)} />}
    </div>
  </div>;
}
