// ─── LOCATIONS — CANONICAL SOURCE OF TRUTH ────────────────────────────────
//
// Single canonical list of physical/logical places where Marianna's goods can
// be at any point in their journey. Replaces the per-module LOCATIONS arrays
// that existed in V4 (PurchaseOrders, Inventory, Shipments, SalesOrders) —
// those had conflicting IDs (e.g., id 8 = "Algeciras Port" in PO but "Biedronka
// DC Poznań" in Inventory) and silently produced wrong references when
// modules cross-referenced.
//
// ID scheme:
//   100-199 = Our storage (RentedWarehouse today, OwnWarehouse when Marianna
//             opens its own one day)
//   200-299 = SupplierFacility (where we pick up from suppliers)
//   300-399 = ClientFacility (where we deliver to clients)
//   400-499 = Port (sea/inland ports — title transfer points for CIF)
//   500-599 = Airport (for air export flow — blueberries etc.)
//   600-699 = PortWarehouse / BondedWarehouse (3rd-party storage at ports)
//   700-799 = Customs / Broker facility
//   800-899 = RelayPoint (truck handover points)
//
// Each location has a `type` and `capabilities` so downstream code (e.g.,
// journey-stage validation in V6) can ask "can this location host customs
// clearance?" without hardcoding.

export type LocationType =
  | "OwnWarehouse"        // Future: when Marianna owns its own
  | "RentedWarehouse"     // Logipark, ColdStore (current setup)
  | "PortWarehouse"       // 3rd-party port-side storage
  | "BondedWarehouse"     // Formal customs storage
  | "SupplierFacility"    // Supplier's premises
  | "ClientFacility"      // Client's premises
  | "Port"                // Sea port (CIF transfer points)
  | "Airport"             // Cargo airports
  | "Customs"             // Customs broker / agent facility
  | "BorderCrossing"      // Specific border post
  | "RelayPoint";         // Truck handover meeting points

export interface LocationCapabilities {
  storage: boolean;             // can goods sit here?
  customsClearance: boolean;    // can customs be done here?
  refrigerated: boolean;        // reefer facility?
  qualityInspection: boolean;   // can our QC person work here?
  sorting: boolean;             // can sorting / repacking happen here?
}

export interface Location {
  id: number;
  type: LocationType;
  name: string;
  country: string;
  address?: string;
  operatorContactId?: number | null;   // ref to Contacts.id for the company running this place (null = we run it)
  capabilities: LocationCapabilities;
  storageCostModel?: "PerKgDay" | "PerPalletDay" | "PerPalletMove" | "Fixed" | null;
  contactInfo?: { name?: string; phone?: string; email?: string };
}

// ─── Default capability presets ────────────────────────────────────────────
const CAP_OWN_WAREHOUSE: LocationCapabilities = {
  storage: true, customsClearance: false, refrigerated: true, qualityInspection: true, sorting: true,
};
const CAP_RENTED_WAREHOUSE: LocationCapabilities = {
  storage: true, customsClearance: false, refrigerated: true, qualityInspection: true, sorting: true,
};
const CAP_PORT_WAREHOUSE: LocationCapabilities = {
  storage: true, customsClearance: true, refrigerated: true, qualityInspection: true, sorting: false,
};
const CAP_BONDED_WAREHOUSE: LocationCapabilities = {
  storage: true, customsClearance: true, refrigerated: false, qualityInspection: false, sorting: false,
};
const CAP_SUPPLIER_FACILITY: LocationCapabilities = {
  storage: false, customsClearance: false, refrigerated: false, qualityInspection: true, sorting: false,
};
const CAP_CLIENT_FACILITY: LocationCapabilities = {
  storage: false, customsClearance: false, refrigerated: false, qualityInspection: false, sorting: false,
};
const CAP_PORT: LocationCapabilities = {
  storage: false, customsClearance: true, refrigerated: false, qualityInspection: false, sorting: false,
};
const CAP_AIRPORT: LocationCapabilities = {
  storage: false, customsClearance: true, refrigerated: true, qualityInspection: false, sorting: false,
};
const CAP_CUSTOMS: LocationCapabilities = {
  storage: false, customsClearance: true, refrigerated: false, qualityInspection: false, sorting: false,
};
const CAP_BORDER_CROSSING: LocationCapabilities = {
  storage: false, customsClearance: true, refrigerated: false, qualityInspection: false, sorting: false,
};
const CAP_RELAY: LocationCapabilities = {
  storage: false, customsClearance: false, refrigerated: false, qualityInspection: false, sorting: false,
};

// ─── The canonical list ────────────────────────────────────────────────────
// IMPORTANT: operatorContactId values reference Contacts.tsx counterparty IDs.
// In V4, warehouse operators were already in Contacts as type "Warehouse". We
// keep those refs; if a contact doesn't exist for a given operator we leave
// the field null and it falls back to display the location name only.

export const LOCATIONS: Location[] = [
  // ── Our storage (rented today) ──
  { id: 101, type: "RentedWarehouse", name: "WH-01 Poznań (Logipark)", country: "Poland",
    address: "Logipark, Poznań", operatorContactId: null /* TODO: link to Logipark contact */,
    capabilities: CAP_RENTED_WAREHOUSE, storageCostModel: "PerKgDay" },
  { id: 102, type: "RentedWarehouse", name: "WH-02 Warszawa (ColdStore)", country: "Poland",
    address: "Warszawa cold storage", operatorContactId: null /* TODO: link to ColdStore contact */,
    capabilities: CAP_RENTED_WAREHOUSE, storageCostModel: "PerKgDay" },

  // ── Supplier facilities ──
  { id: 201, type: "SupplierFacility", name: "Białski Owoc — Biała Rawska", country: "Poland",
    address: "Wojska Polskiego 6F, 96-230 Biała Rawska", capabilities: CAP_SUPPLIER_FACILITY },
  { id: 202, type: "SupplierFacility", name: "FreshFarm ES — Valencia", country: "Spain",
    address: "Valencia, Spain", capabilities: CAP_SUPPLIER_FACILITY },
  { id: 203, type: "SupplierFacility", name: "AgriTrade MA — Agadir", country: "Morocco",
    address: "Agadir, Morocco", capabilities: CAP_SUPPLIER_FACILITY },

  // ── Client facilities ──
  { id: 301, type: "ClientFacility", name: "Biedronka DC Poznań", country: "Poland",
    address: "ul. Górecka 1, 60-201 Poznań", capabilities: CAP_CLIENT_FACILITY },
  { id: 302, type: "ClientFacility", name: "Lidl DC Chorzów", country: "Poland",
    address: "Chorzów", capabilities: CAP_CLIENT_FACILITY },
  { id: 303, type: "ClientFacility", name: "Fresco Hamburg", country: "Germany",
    address: "Hamburg", capabilities: CAP_CLIENT_FACILITY },
  { id: 304, type: "ClientFacility", name: "Metro DC Warszawa", country: "Poland",
    address: "Warszawa", capabilities: CAP_CLIENT_FACILITY },
  { id: 305, type: "ClientFacility", name: "Euro-Papryka Tarczyn", country: "Poland",
    address: "Tarczyn / Wola Przypkowska", capabilities: CAP_CLIENT_FACILITY },
  { id: 306, type: "ClientFacility", name: "Venice Cold Stores & Logistics SRL", country: "Italy",
    address: "Via Banchina dell'Azoto 17/B, 30175 Marghera", capabilities: CAP_CLIENT_FACILITY },

  // ── Ports ──
  { id: 401, type: "Port", name: "Gdańsk Port", country: "Poland", capabilities: CAP_PORT },
  { id: 402, type: "Port", name: "Gdynia Port", country: "Poland", capabilities: CAP_PORT },
  { id: 403, type: "Port", name: "Hamburg Port", country: "Germany", capabilities: CAP_PORT },
  { id: 404, type: "Port", name: "Algeciras Port", country: "Spain", capabilities: CAP_PORT },
  { id: 405, type: "Port", name: "Port of Jeddah", country: "Saudi Arabia", capabilities: CAP_PORT },
  { id: 406, type: "Port", name: "Agadir / Casablanca port area", country: "Morocco", capabilities: CAP_PORT },

  // ── Airports (for air export flow — blueberries etc.) ──
  { id: 501, type: "Airport", name: "Warsaw Chopin Airport — Cargo", country: "Poland", capabilities: CAP_AIRPORT },
  { id: 502, type: "Airport", name: "Frankfurt Cargo Airport", country: "Germany", capabilities: CAP_AIRPORT },

  // ── Port warehouses (3rd-party storage at ports) ──
  { id: 601, type: "PortWarehouse", name: "Gdańsk Port Warehouse (DSV)", country: "Poland",
    capabilities: CAP_PORT_WAREHOUSE, storageCostModel: "PerPalletDay" },
  { id: 602, type: "PortWarehouse", name: "Gdynia Port Warehouse", country: "Poland",
    capabilities: CAP_PORT_WAREHOUSE, storageCostModel: "PerPalletDay" },

  // ── Customs / brokers ──
  { id: 701, type: "Customs", name: "AM sped — Słomczyn", country: "Poland",
    address: "Słomczyn 81, 05-600 Grójec", capabilities: CAP_CUSTOMS },
];

// ─── Lookup helpers ─────────────────────────────────────────────────────────

export function locById(id: number | null | undefined): Location | null {
  if (id === null || id === undefined) return null;
  return LOCATIONS.find(l => l.id === Number(id)) || null;
}

export function locText(id: number | null | undefined, fallback = ""): string {
  const l = locById(id);
  if (!l) return fallback || "—";
  return l.address ? `${l.name}, ${l.address}` : l.name;
}

export function locationsOfType(...types: LocationType[]): Location[] {
  return LOCATIONS.filter(l => types.includes(l.type));
}

export function locationsWithCapability(cap: keyof LocationCapabilities): Location[] {
  return LOCATIONS.filter(l => l.capabilities[cap]);
}

// ─── Legacy → canonical migration map ──────────────────────────────────────
// V4 had module-local LOCATIONS arrays with conflicting IDs. This map
// translates old IDs (per source module) to new canonical IDs. Used during
// seed migration; once migrated, no module should ever use legacy IDs again.

export const LEGACY_ID_MAP: Record<string, Record<number, number>> = {
  // PurchaseOrders.tsx LOCATIONS
  PO: {
    1: 101, 2: 102, 6: 401, 7: 403, 8: 404, 9: 405,
    10: 301, 11: 302, 12: 303, 13: 304, 14: 305,
  },
  // Inventory.tsx LOCATIONS
  INV: {
    1: 101, 2: 102, 3: 201, 4: 202, 5: 203,
    6: 401, 7: 403, 8: 301, 9: 302, 10: 303, 14: 305,
  },
  // Shipments.tsx LOCATIONS
  SHP: {
    1: 101, 2: 102, 3: 201, 4: 202, 5: 203,
    6: 401, 7: 403, 8: 301, 9: 302, 10: 301, 11: 302,
    12: 303, 13: 304, 14: 305, 21: 306, 22: 701, 23: 406,
  },
  // SalesOrders.tsx LOCATIONS
  SO: {
    1: 101, 2: 102, 10: 301, 11: 302, 13: 304,
  },
};
