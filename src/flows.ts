// ─── PO FLOW TAXONOMY ───────────────────────────────────────────────────────
//
// The "flow" field on a PO is the single most important categorization for
// what physically happens with the cargo. It drives:
//   - which journey stages the cargo will pass through (V6)
//   - what costs typically apply (sea freight only on sea flows etc.)
//   - default destination types in the UI
//   - which counterparties get involved (carriers, brokers, port warehouses)
//   - when ownership transfers between supplier ↔ us ↔ client
//
// We have 10 canonical codes covering Marianna's real-world flows. New flows
// should only be added with care — each addition implies UI dropdowns,
// journey templates, and downstream decisions.

export type FlowCode =
  // ── Export flows (Marianna sells abroad or domestically) ──
  | "EXP_BY_SEA_CIF"           // Sea export, CIF terms — title to client at destination port
  | "EXP_BY_AIR_CIF"           // Air export, CIF — for premium products like blueberries
  | "EXP_BY_TRUCK_DAP"         // Road export, delivered to client warehouse
  | "EXP_BY_TRUCK_RELAY"       // Road export, handover at a relay point (client takes over there)

  // ── Import flows (Marianna buys from abroad) ──
  | "IMP_CIF_TO_OUR_WH"        // Import CIF, then our truck to our rented warehouse
  | "IMP_CIF_TO_CLIENT_WH"     // Import CIF, then our truck direct to client
  | "IMP_CIF_CROSSDOCK"        // Import CIF, client picks up from port (no detour)
  | "IMP_DDP_TO_OUR_WH"        // Supplier delivers DDP to our rented warehouse
  | "IMP_DDP_TO_CLIENT_WH"     // Supplier delivers DDP direct to client
  | "IMP_EXW";                 // We arrange everything from supplier door

export interface FlowMeta {
  code: FlowCode;
  direction: "Export" | "Import";
  label: string;                   // human-friendly UI label
  shortLabel: string;              // compact label for badges
  defaultIncoterm: string;         // typical Incoterm for this flow
  requiresSeaLeg: boolean;
  requiresAirLeg: boolean;
  typicalDestinationType:          // suggested destination location type in UI
    | "ClientFacility"
    | "RentedWarehouse"
    | "Port"
    | "Airport";
  // When does title typically transfer to us (for imports) or away from us (for exports)?
  // Used to decide ownership boundary on the lot in V6.
  ownershipEvent:
    | "PO_CONFIRMATION"          // we owe the goods as soon as PO is confirmed (rare)
    | "SUPPLIER_LOADING"         // goods become ours when supplier loads them
    | "PORT_ARRIVAL"             // goods become ours when they arrive at our port (CIF buy)
    | "CUSTOMS_CLEARED"          // goods become ours after customs (DDP buy)
    | "WAREHOUSE_ARRIVAL"        // goods become ours when they arrive at our warehouse
    | "CLIENT_DELIVERY"          // goods stop being ours when they reach the client (CIF sell)
    | "HANDOVER_POINT";          // goods stop being ours at a relay point
  notes: string;
}

export const FLOWS: Record<FlowCode, FlowMeta> = {
  EXP_BY_SEA_CIF: {
    code: "EXP_BY_SEA_CIF",
    direction: "Export",
    label: "Sea export — CIF to destination port",
    shortLabel: "Sea CIF",
    defaultIncoterm: "CIF",
    requiresSeaLeg: true,
    requiresAirLeg: false,
    typicalDestinationType: "Port",
    ownershipEvent: "CLIENT_DELIVERY",  // we own until destination port
    notes: "Our truck → customs → port warehouse → container → vessel → destination port (CIF transfer).",
  },
  EXP_BY_AIR_CIF: {
    code: "EXP_BY_AIR_CIF",
    direction: "Export",
    label: "Air export — CIF to destination airport",
    shortLabel: "Air CIF",
    defaultIncoterm: "CIF",
    requiresSeaLeg: false,
    requiresAirLeg: true,
    typicalDestinationType: "Airport",
    ownershipEvent: "CLIENT_DELIVERY",
    notes: "For premium products (blueberries, etc.). Truck to airport → customs → flight → destination.",
  },
  EXP_BY_TRUCK_DAP: {
    code: "EXP_BY_TRUCK_DAP",
    direction: "Export",
    label: "Road export — delivered to client",
    shortLabel: "Road DAP",
    defaultIncoterm: "DAP",
    requiresSeaLeg: false,
    requiresAirLeg: false,
    typicalDestinationType: "ClientFacility",
    ownershipEvent: "CLIENT_DELIVERY",
    notes: "Our truck picks up from supplier → customs → direct to client warehouse.",
  },
  EXP_BY_TRUCK_RELAY: {
    code: "EXP_BY_TRUCK_RELAY",
    direction: "Export",
    label: "Road export — handover at relay point",
    shortLabel: "Road relay",
    defaultIncoterm: "DAP",
    requiresSeaLeg: false,
    requiresAirLeg: false,
    typicalDestinationType: "ClientFacility",
    ownershipEvent: "HANDOVER_POINT",
    notes: "Our truck delivers to a meeting point where client's truck takes over for the final leg.",
  },
  IMP_CIF_TO_OUR_WH: {
    code: "IMP_CIF_TO_OUR_WH",
    direction: "Import",
    label: "Sea import CIF — to our warehouse",
    shortLabel: "Sea CIF→WH",
    defaultIncoterm: "CIF",
    requiresSeaLeg: true,
    requiresAirLeg: false,
    typicalDestinationType: "RentedWarehouse",
    ownershipEvent: "PORT_ARRIVAL",
    notes: "Supplier ships CIF to EU port. Our forwarder receives, customs clears, our truck to our rented WH.",
  },
  IMP_CIF_TO_CLIENT_WH: {
    code: "IMP_CIF_TO_CLIENT_WH",
    direction: "Import",
    label: "Sea import CIF — direct to client",
    shortLabel: "Sea CIF→Client",
    defaultIncoterm: "CIF",
    requiresSeaLeg: true,
    requiresAirLeg: false,
    typicalDestinationType: "ClientFacility",
    ownershipEvent: "PORT_ARRIVAL",
    notes: "Supplier ships CIF to EU port. Our forwarder/broker customs clears. Our truck → direct to client.",
  },
  IMP_CIF_CROSSDOCK: {
    code: "IMP_CIF_CROSSDOCK",
    direction: "Import",
    label: "Sea import CIF — client picks up at port",
    shortLabel: "CIF crossdock",
    defaultIncoterm: "CIF",
    requiresSeaLeg: true,
    requiresAirLeg: false,
    typicalDestinationType: "Port",
    ownershipEvent: "PORT_ARRIVAL",
    notes: "Supplier ships CIF to EU port. After customs clearance, client's truck loads from the port directly.",
  },
  IMP_DDP_TO_OUR_WH: {
    code: "IMP_DDP_TO_OUR_WH",
    direction: "Import",
    label: "DDP import — to our warehouse",
    shortLabel: "DDP→WH",
    defaultIncoterm: "DDP",
    requiresSeaLeg: false,
    requiresAirLeg: false,
    typicalDestinationType: "RentedWarehouse",
    ownershipEvent: "WAREHOUSE_ARRIVAL",
    notes: "Supplier handles everything (transport + customs). Goods arrive directly at our rented WH for QC and sorting.",
  },
  IMP_DDP_TO_CLIENT_WH: {
    code: "IMP_DDP_TO_CLIENT_WH",
    direction: "Import",
    label: "DDP import — direct to client",
    shortLabel: "DDP→Client",
    defaultIncoterm: "DDP",
    requiresSeaLeg: false,
    requiresAirLeg: false,
    typicalDestinationType: "ClientFacility",
    ownershipEvent: "CLIENT_DELIVERY",  // we're effectively just a paper trade here
    notes: "Supplier handles everything end-to-end. NOTE: if client rejects, we may need to redirect to our WH for sorting.",
  },
  IMP_EXW: {
    code: "IMP_EXW",
    direction: "Import",
    label: "EXW import — we manage all transport",
    shortLabel: "EXW",
    defaultIncoterm: "EXW",
    requiresSeaLeg: true,
    requiresAirLeg: false,
    typicalDestinationType: "RentedWarehouse",
    ownershipEvent: "SUPPLIER_LOADING",
    notes: "Rare. We organize inland transport in supplier's country, sea freight, EU customs, onward delivery.",
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

export function flowMeta(code: FlowCode | string | null | undefined): FlowMeta | null {
  if (!code) return null;
  return FLOWS[code as FlowCode] || null;
}

export function flowDirection(code: FlowCode | string | null | undefined): "Export" | "Import" | null {
  return flowMeta(code)?.direction || null;
}

export function flowsByDirection(direction: "Export" | "Import"): FlowMeta[] {
  return Object.values(FLOWS).filter(f => f.direction === direction);
}

// ─── Migration map — V4 flow codes → V5 canonical codes ─────────────────────
// Used to upgrade existing seed POs to the new taxonomy. Mapping is based on
// the semantic intent of each V4 code, not the exact letters.

export const LEGACY_FLOW_MAP: Record<string, FlowCode> = {
  // V4 export codes
  "EXP_EXWS":     "EXP_BY_TRUCK_DAP",        // EXW supplier — close enough to DAP truck export
  "EXP_FOB":      "EXP_BY_SEA_CIF",          // FOB to a port — sea export
  "EXP_CIF":      "EXP_BY_SEA_CIF",          // CIF sea export
  "EXP_DDP_EU":   "EXP_BY_TRUCK_DAP",        // DDP within EU — road delivery
  "EXP_DDP_XEU":  "EXP_BY_TRUCK_DAP",        // DDP outside EU — same handling pattern

  // V4 import codes
  "IMP_EXWS_WH":  "IMP_EXW",                 // EXW supplier → our WH — full EXW chain
  "IMP_DDP_WH":   "IMP_DDP_TO_OUR_WH",       // DDP to our WH
  "IMP_CIF_WH":   "IMP_CIF_TO_OUR_WH",       // CIF → our WH
  "IMP_FCA":      "IMP_CIF_TO_OUR_WH",       // FCA (we pick up at supplier port) → approximate as CIF→WH
};

export function migrateLegacyFlow(legacyCode: string): FlowCode {
  return LEGACY_FLOW_MAP[legacyCode] || "IMP_DDP_TO_OUR_WH";  // safe default for unknowns
}

// ─── Date semantics ─────────────────────────────────────────────────────────
// The single date on each PO/SO used to be ambiguous (was it pickup? arrival?
// delivery to client?). V5 adds a `promisedDateMeans` enum so everyone knows
// exactly what the date refers to.

export type PromisedDateMeansPO =
  | "Pickup from supplier"
  | "Arrival at port"
  | "Arrival at our warehouse"
  | "Arrival at client";

export type PromisedDateMeansSO =
  | "Delivery to client"
  | "Pickup-ready at our side"
  | "Handover at relay"
  | "Loading at supplier"
  | "Arrival at destination port";   // for CIF/CIP sales

// Default `promisedDateMeans` value derived from the flow code.
export function defaultPODateMeans(code: FlowCode | string | null | undefined): PromisedDateMeansPO {
  const meta = flowMeta(code);
  if (!meta) return "Arrival at our warehouse";
  switch (meta.typicalDestinationType) {
    case "RentedWarehouse":  return "Arrival at our warehouse";
    case "ClientFacility":   return "Arrival at client";
    case "Port":             return "Arrival at port";
    case "Airport":          return "Arrival at port";  // we reuse "port" semantics for airport
    default:                 return "Arrival at our warehouse";
  }
}

export function defaultSODateMeans(sellIncoterm: string | null | undefined): PromisedDateMeansSO {
  switch ((sellIncoterm || "").toUpperCase()) {
    case "EXW":  return "Pickup-ready at our side";
    case "CIF":
    case "CFR":
    case "CIP":  return "Arrival at destination port";
    case "DAP":
    case "DDP":
    case "DPU":
    default:     return "Delivery to client";
  }
}
