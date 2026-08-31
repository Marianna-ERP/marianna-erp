import { dataKey } from "./useLocalStoredState";
// ─── SHARED LOCATIONS (v5.8 trunk, Option B consolidation) ──────────────────
//
// Single source of truth for all location lookups across PurchaseOrders,
// SalesOrders, Inventory and Shipments. Replaces the four separate per-module
// LOCATIONS arrays that had drifted (different spellings) and conflicted
// (id 8/10 both Biedronka, Shipments had an "(SO/PO id)" workaround).
//
// Option B approach (per decision): we KEEP all existing IDs so no seed data
// reference needs to change. We only:
//   1. unify spelling (proper Polish diacritics everywhere)
//   2. keep both alias IDs pointing at the same real place
//      (id 8 == id 10 == Biedronka DC Poznań; id 9 == id 11 == Lidl DC Chorzów)
//   3. add the `type` taxonomy and capability flags for future journey work (V6)
//
// A future V6 can renumber to a fully clean scheme; for now this fixes the
// real bug (conflicting/duplicate references) with zero churn to seed data.

export type LocationType =
  | "OwnWarehouse"
  | "RentedWarehouse"
  | "SupplierFacility"
  | "ClientFacility"
  | "Port"
  | "Airport"
  | "PortWarehouse"
  | "BondedWarehouse"
  | "Customs"
  | "BorderCrossing"
  | "RelayPoint";

// Legacy single-word type strings used in v5.8 seed (OWN / SUPPLIER / PORT /
// CLIENT / BROKER) are mapped to the richer taxonomy here.
export interface Location {
  id: number;
  type: LocationType;
  legacyType: string;          // the original "OWN"/"PORT"/etc. — kept so existing UI lookups by legacy type still work
  name: string;
  country: string;
  address?: string;
  aliasOf?: number;            // if set, this id is an alias for another canonical id (same physical place)
}

// Helper to keep the table compact
function L(id: number, type: LocationType, legacyType: string, name: string, country: string, address?: string, aliasOf?: number): Location {
  return { id, type, legacyType, name, country, address, aliasOf };
}

export const LOCATIONS: Location[] = [
  // ── Our storage (rented today; will include OwnWarehouse when Marianna opens one) ──
  L(1, "RentedWarehouse", "OWN", "WH-01 Poznań (Logipark)", "Poland", "Poznań / Logipark"),
  L(2, "RentedWarehouse", "OWN", "WH-02 Warszawa (ColdStore)", "Poland", "Warszawa cold storage"),

  // ── Supplier facilities ──
  L(3, "SupplierFacility", "SUPPLIER", "Białski Owoc — Biała Rawska", "Poland", "Wojska Polskiego 6F, 96-230 Biała Rawska"),
  L(4, "SupplierFacility", "SUPPLIER", "FreshFarm ES — Valencia", "Spain", "Valencia, Spain"),
  L(5, "SupplierFacility", "SUPPLIER", "AgriTrade MA — Agadir", "Morocco", "Agadir, Morocco"),

  // ── Ports (base set) ──
  L(6, "Port", "PORT", "Gdańsk Port", "Poland", "Gdańsk port"),
  L(7, "Port", "PORT", "Hamburg Port", "Germany", "Hamburg port"),

  // ── Client facilities (base set) ──
  // NOTE: id 8 and id 10 are the SAME place (Biedronka). v5.8 had both because
  // different modules referenced different ids. We keep both as aliases so no
  // seed reference breaks; id 10 is the canonical one.
  L(8, "ClientFacility", "CLIENT", "Biedronka DC Poznań", "Poland", "ul. Górecka 1, 60-201 Poznań", 10),
  L(9, "ClientFacility", "CLIENT", "Lidl DC Chorzów", "Poland", "Chorzów", 11),
  L(10, "ClientFacility", "CLIENT", "Biedronka DC Poznań", "Poland", "ul. Górecka 1, 60-201 Poznań"),
  L(11, "ClientFacility", "CLIENT", "Lidl DC Chorzów", "Poland", "Chorzów"),
  L(12, "ClientFacility", "CLIENT", "Fresco Hamburg", "Germany", "Hamburg"),
  L(13, "ClientFacility", "CLIENT", "Metro DC Warszawa", "Poland", "Warszawa"),
  L(14, "ClientFacility", "CLIENT", "Euro-Papryka Tarczyn", "Poland", "Tarczyn / Wola Przypkowska"),

  // ── Additional clients / mixed (from Shipments) ──
  L(21, "ClientFacility", "CLIENT", "Venice Cold Stores & Logistics SRL", "Italy", "Via Banchina dell'Azoto 17/B, 30175 Marghera"),
  L(22, "Customs", "BROKER", "AM sped s.c. — Słomczyn", "Poland", "Słomczyn 81, 05-600 Grójec"),
  L(23, "Port", "PORT", "Agadir / Casablanca port area", "Morocco", "Morocco port warehouse"),

  // ── Expanded port list (v5.8 added these consistently; IDs preserved) ──
  L(108, "Port", "PORT", "Algeciras Port", "Spain"),
  L(109, "Port", "PORT", "Jeddah Islamic Port", "Saudi Arabia"),
  L(110, "Port", "PORT", "Venice / Marghera Port", "Italy"),
  L(111, "Port", "PORT", "Rotterdam Port", "Netherlands"),
  L(112, "Port", "PORT", "Antwerp-Bruges Port", "Belgium"),
  L(113, "Port", "PORT", "Koper Port", "Slovenia"),
  L(114, "Port", "PORT", "Trieste Port", "Italy"),
  L(115, "Port", "PORT", "Genoa Port", "Italy"),
  L(116, "Port", "PORT", "Salerno Port", "Italy"),
  L(117, "Port", "PORT", "Valencia Port", "Spain"),
  L(118, "Port", "PORT", "Barcelona Port", "Spain"),
  L(119, "Port", "PORT", "Alexandria Port", "Egypt"),
  L(120, "Port", "PORT", "Port Said", "Egypt"),
  L(121, "Port", "PORT", "Agadir / Casablanca port area", "Morocco"),
  L(122, "Port", "PORT", "Ravenna Port", "Italy"),
  L(123, "Port", "PORT", "Rijeka Port", "Croatia"),
  L(124, "Port", "PORT", "Bremerhaven Port", "Germany"),
  L(125, "Port", "PORT", "Gdynia Port", "Poland"),
  L(126, "Port", "PORT", "Damietta Port", "Egypt"),

  // ── Airports (NEW — for the air-export flow, e.g. blueberries) ──
  L(201, "Airport", "PORT", "Warsaw Chopin Airport — Cargo", "Poland"),
  L(202, "Airport", "PORT", "Frankfurt Cargo Airport", "Germany"),
];

// ─── CUSTOM LOCATIONS (v6.3.0) ──────────────────────────────────────────────
// User-managed locations (new ports, airports, warehouses, client sites...)
// added via Settings → Locations & ports. Stored in localStorage under the
// same namespaced key scheme as all other app data, so they travel with the
// Settings JSON export/import. IDs start at 10000 to never clash with the
// built-in reference list above.

export const CUSTOM_LOCATION_ID_BASE = 10000;
// v6.38.0: these two stores are part of DATA_KEYS, so the v6.37.0 migration moved
// them to the current version's keys — but this file kept reading/writing "v1"
// hardcoded. Post-migration adds/edits landed in the stale safety copy (invisible
// to the live app and to exports). Fixed: address the current version, and adopt
// the v1 store ONE TIME below (it was the de-facto authoritative store until now).
const CUSTOM_LOCATIONS_KEY = dataKey("customLocations");

// Options offered in the Settings UI → mapped to (type, legacyType) pairs.
export const CUSTOM_LOCATION_TYPE_OPTIONS: { key: LocationType; label: string; legacyType: string }[] = [
  { key: "Port",             label: "Port",                          legacyType: "PORT" },
  { key: "PortWarehouse",    label: "Port warehouse",                legacyType: "PORT" },
  { key: "Airport",          label: "Airport (cargo)",               legacyType: "PORT" },
  { key: "ClientFacility",   label: "Client site / DC",              legacyType: "CLIENT" },
  { key: "SupplierFacility", label: "Supplier / producer site",      legacyType: "SUPPLIER" },
  { key: "RentedWarehouse",  label: "Our warehouse (own or rented)", legacyType: "OWN" },
  { key: "Customs",          label: "Customs / border point",        legacyType: "BROKER" },
];

function legacyTypeFor(type: LocationType): string {
  const opt = CUSTOM_LOCATION_TYPE_OPTIONS.find(o => o.key === type);
  return opt ? opt.legacyType : "PORT";
}


// ── v6.38.0 one-time adoption of post-migration strays ───────────────────────
// Until this fix, ALL custom-location / logistics-point writes (adds, edits,
// removals) went to the v1 keys even after the app's data moved to v2 — so the
// v1 store is the more current one. Adopt it wholesale into the current key,
// exactly once (marker-guarded), then the current key is authoritative forever.
(() => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const MARKER = dataKey("locationsKeyFixApplied");
    if (window.localStorage.getItem(MARKER)) return;
    // self-contained key pairs (const declarations further down are in their TDZ here)
    [["marianna-erp:v1:customLocations", dataKey("customLocations")], ["marianna-erp:v1:logisticsPoints", dataKey("logisticsPoints")]].forEach(([legacy, current]) => {
      if (legacy === current) return; // pre-migration installs: nothing to adopt
      const legacyRaw = window.localStorage.getItem(legacy);
      if (legacyRaw != null) window.localStorage.setItem(current, legacyRaw);
    });
    window.localStorage.setItem(MARKER, "1");
  } catch (err) { console.warn("[locations] key-fix adoption failed:", err); }
})();

export function readCustomLocations(): Location[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_LOCATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((l: any) => l && l.name)
      .map((l: any) => ({
        id: Number(l.id),
        type: (l.type || "Port") as LocationType,
        legacyType: l.legacyType || legacyTypeFor(l.type || "Port"),
        name: String(l.name),
        country: String(l.country || ""),
        address: l.address || undefined,
        custom: true,
      } as Location & { custom: boolean }));
  } catch (err) {
    console.warn("[locations] Could not read custom locations:", err);
    return [];
  }
}

function writeCustomLocations(list: Location[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(CUSTOM_LOCATIONS_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn("[locations] Could not write custom locations:", err);
  }
}

export function addCustomLocation(input: { name: string; country: string; type: LocationType; address?: string }): Location {
  const existing = readCustomLocations();
  const nextId = Math.max(CUSTOM_LOCATION_ID_BASE, ...existing.map(l => Number(l.id) || 0)) + 1;
  const loc: Location = {
    id: nextId,
    type: input.type,
    legacyType: legacyTypeFor(input.type),
    name: input.name.trim(),
    country: (input.country || "").trim(),
    address: (input.address || "").trim() || undefined,
  };
  writeCustomLocations([...existing, { ...loc, custom: true } as any]);
  return loc;
}

export function removeCustomLocation(id: number): void {
  writeCustomLocations(readCustomLocations().filter(l => Number(l.id) !== Number(id)));
}

// v6.36.0: edit an existing custom location (name / country / address / type).
export function updateCustomLocation(id: number, patch: { name?: string; country?: string; address?: string; type?: LocationType }): void {
  writeCustomLocations(readCustomLocations().map(l => Number(l.id) === Number(id)
    ? { ...l, ...patch, ...(patch.type ? { legacyType: legacyTypeFor(patch.type) } : {}) }
    : l));
}

// ── v6.36.0: BUILT-IN OVERRIDES ─────────────────────────────────────────────
// The built-in reference ports/warehouses are hardcoded, but their real-world
// details (esp. the exact transshipment-warehouse address a transport order
// needs) belong to the user. Overrides are stored per built-in id and applied
// at module load, before any module snapshots LOCATIONS.
// locationOverrides is NOT in DATA_KEYS (never migrated) — its "v1" name is just
// its permanent, version-independent name. Deliberately left as-is.
const LOCATION_OVERRIDES_KEY = "marianna-erp:v1:locationOverrides";
export function readLocationOverrides(): Record<string, { name?: string; country?: string; address?: string }> {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try { const raw = window.localStorage.getItem(LOCATION_OVERRIDES_KEY); const p = raw ? JSON.parse(raw) : {}; return p && typeof p === "object" ? p : {}; }
  catch { return {}; }
}
export function writeLocationOverride(id: number, patch: { name?: string; country?: string; address?: string }): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const all = readLocationOverrides();
  all[String(id)] = { ...(all[String(id)] || {}), ...patch };
  try { window.localStorage.setItem(LOCATION_OVERRIDES_KEY, JSON.stringify(all)); } catch {}
}
export function clearLocationOverride(id: number): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const all = readLocationOverrides(); delete all[String(id)];
  try { window.localStorage.setItem(LOCATION_OVERRIDES_KEY, JSON.stringify(all)); } catch {}
}

// Merge custom locations into the canonical list at module load. Modules that
// snapshot LOCATIONS at import time therefore see customs too; Settings reloads
// the page after add/remove so every module picks up changes consistently.
readCustomLocations().forEach(cl => {
  if (!LOCATIONS.find(l => String(l.id) === String(cl.id))) LOCATIONS.push(cl);
});

// v6.36.0: apply user overrides to built-ins (e.g. the real transshipment
// warehouse address on Koper) before any module snapshots LOCATIONS.
(() => {
  const ov = readLocationOverrides();
  Object.keys(ov).forEach(id => {
    const l = LOCATIONS.find(x => String(x.id) === String(id));
    if (!l) return;
    const p = ov[id] || {};
    if (p.name) l.name = p.name;
    if (p.country !== undefined) l.country = p.country || l.country;
    if (p.address !== undefined) (l as any).address = p.address || undefined;
  });
})();

// ─── LOGISTICS POINTS (v6.12) ───────────────────────────────────────────────
// The places that are NOT a counterparty's own premises: ports of loading and
// discharge, relay points, and cross-dock warehouses named by a forwarder
// (which are third-party sites, NOT the forwarder's address). They are managed
// in Counterparties → Logistics points and stored in localStorage. We register
// them into LOCATIONS at module load — before any module snapshots LOCATIONS —
// so every From/To/Destination picker and the (frozen) transport confirmation
// resolve them by id with no further wiring. Adding one reloads the app so this
// bootstrap re-runs, exactly like the legacy custom-locations did.

export const LOGISTICS_POINT_BASE = 800000;
const LOGISTICS_POINTS_KEY = dataKey("logisticsPoints");

export const LOGISTICS_POINT_KINDS: { key: string; label: string; type: LocationType; legacyType: string }[] = [
  { key: "PortLoading",   label: "Port of loading",       type: "Port",       legacyType: "PORT" },
  { key: "PortDischarge", label: "Port of discharge",     type: "Port",       legacyType: "PORT" },
  { key: "Relay",         label: "Relay point",           type: "RelayPoint", legacyType: "PORT" },
  { key: "CrossDock",     label: "Cross-dock warehouse",  type: "RelayPoint", legacyType: "PORT" },
];

export function logisticsPointLocId(id: any): number {
  return LOGISTICS_POINT_BASE + Number(id || 0);
}

export function readLogisticsPoints(): any[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(LOGISTICS_POINTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("[locations] Could not read logistics points:", err);
    return [];
  }
}

// Synchronous write so a follow-up page reload re-bootstraps with the new data
// (mirrors how custom locations persisted before a reload).
export function writeLogisticsPoints(list: any[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(LOGISTICS_POINTS_KEY, JSON.stringify(list || []));
  } catch (err) {
    console.warn("[locations] Could not write logistics points:", err);
  }
}

// Register (idempotently) logistics points as Location entries so locById/locText
// resolve them everywhere — including the transport confirmation snapshot.
export function registerLogisticsPoints(points: any[]): void {
  (points || []).forEach((p: any) => {
    if (!p || !p.name) return;
    const kind = LOGISTICS_POINT_KINDS.find(k => k.key === p.kind) || LOGISTICS_POINT_KINDS[0];
    const id = logisticsPointLocId(p.id);
    const loc: Location = {
      id,
      type: kind.type,
      legacyType: kind.legacyType,
      name: String(p.name),
      country: String(p.country || ""),
      address: (p.address || "").trim() || undefined,
    };
    const existing = LOCATIONS.find(l => String(l.id) === String(id));
    if (!existing) LOCATIONS.push(loc);
    else { existing.name = loc.name; existing.address = loc.address; existing.country = loc.country; existing.type = loc.type; existing.legacyType = loc.legacyType; }
  });
}

// Bootstrap at module load (mirrors the custom-locations merge above) so every
// consumer that snapshots LOCATIONS at import sees logistics points too.
registerLogisticsPoints(readLogisticsPoints());

// ─── Lookups ────────────────────────────────────────────────────────────────

export function locById(id: any): Location | null {
  if (id === null || id === undefined || id === "") return null;
  return LOCATIONS.find(l => String(l.id) === String(id)) || null;
}

export function locText(id: any, fallback = ""): string {
  const l = locById(id);
  if (!l) return fallback || "—";
  return l.address ? `${l.name}, ${l.address}` : l.name;
}

export function locationsOfType(...types: LocationType[]): Location[] {
  return LOCATIONS.filter(l => types.includes(l.type) && !l.aliasOf);
}

// Locations filtered by the LEGACY type string (OWN/PORT/CLIENT/SUPPLIER/BROKER)
// — used by existing v5.8 dropdowns that group by legacy type. Aliases hidden so
// dropdowns don't show Biedronka twice.
export function locationsByLegacyType(legacyType: string): Location[] {
  return LOCATIONS.filter(l => l.legacyType === legacyType && !l.aliasOf);
}

// All non-alias locations (for datalists / full dropdowns)
// ─── v6.73.0: BUILT-IN LOCATIONS ARE EDITABLE AND DELETABLE ─────────────────
// Owner ruling: "I do not need any data that is built in by default that can
// not be edited or changed."
//
// The seed table above stays as it is — it is reference data shipped with the
// build, and rewriting it per user would make every install different. Instead
// an OVERRIDE layer sits on top: a hidden flag, or replacement fields, stored
// per id. allLocations() applies it on read. Nothing is destroyed, so a
// location hidden by mistake can be restored, and an override is dropped
// automatically once its id no longer exists in a future seed.
//
// This is the same read-forward discipline used for legacy customs roles and
// per-truck protocols: change what is SHOWN, never rewrite what is STORED.
// The existing override layer above already stores name/country/address per
// built-in id. v6.73.0 adds the two things the owner asked for and it lacked:
// a HIDDEN flag (the user's "delete" for a built-in they never use) and
// alphabetical ordering. Hiding is reversible by design — nothing is destroyed,
// so a location hidden by mistake comes back.

export function hideBuiltInLocation(id: number): void { writeLocationOverride(id, { hidden: true } as any); }
export function restoreBuiltInLocation(id: number): void {
  const all = readLocationOverrides() as any;
  const o = all[String(id)];
  if (!o) return;
  delete o.hidden;
  if (!Object.keys(o).length) clearLocationOverride(id);
  else writeLocationOverride(id, o);
}

/** Pure form, for tests: apply an override map to a location list. */
export function applyLocationOverrides(list: Location[], overrides: Record<string, any>): Location[] {
  return (list || [])
    .filter(l => !(overrides || {})[String(l.id)]?.hidden)
    .map(l => {
      const o = (overrides || {})[String(l.id)];
      if (!o) return l;
      return { ...l, ...(o.name ? { name: o.name } : {}), ...(o.country ? { country: o.country } : {}), ...(o.address ? { address: o.address } : {}) };
    });
}

/** v6.73.0: A→Z by name. New entries used to land at the bottom of every
 *  dropdown in entry order, which makes a list of eighty places unusable. */
export function sortLocations(list: Location[]): Location[] {
  return [...(list || [])].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pl"));
}

export function allLocations(): Location[] {
  return sortLocations(applyLocationOverrides(LOCATIONS.filter(l => !l.aliasOf), readLocationOverrides()));
}

// ─── v6.10: WAREHOUSE COUNTERPARTIES AS LOCATIONS ───────────────────────────
// Warehouses are counterparties (we receive invoices from them) and one
// warehouse company can have several delivery addresses. These helpers turn the
// "Warehouse" counterparties (and each of their addresses) into selectable
// Location entries so that (a) the tariff's "operates" picker can reference them
// and (b) destination dropdowns can send cargo to them. Synthetic ids are
// derived from the counterparty id + address index and never clash with the
// built-in/custom ranges. locations.ts cannot import Contacts, so callers pass
// the contacts list in.

export const WAREHOUSE_CP_LOC_BASE = 900000;

export function isWarehouseContact(c: any): boolean {
  return !!c && (c.type === "Warehouse" || (c.additionalTypes || []).includes("Warehouse"));
}

// Every address a counterparty has: its primary address (index 0) plus any
// extraAddresses[] (index 1..n). Always returns at least one entry.
export function contactAddresses(c: any): { address: string; index: number }[] {
  const list: { address: string; index: number }[] = [];
  if (c?.address) list.push({ address: String(c.address), index: 0 });
  (c?.extraAddresses || []).forEach((a: any, i: number) => {
    const addr = typeof a === "string" ? a : (a?.address || "");
    if (String(addr).trim()) list.push({ address: String(addr), index: i + 1 });
  });
  if (!list.length) list.push({ address: "", index: 0 });
  return list;
}

export function warehouseCpLocId(contactId: any, addressIndex: number): number {
  return WAREHOUSE_CP_LOC_BASE + Number(contactId) * 100 + Number(addressIndex || 0);
}

// Build (and register) Location entries for warehouse counterparties' addresses.
// Registration is idempotent and additive so locById/locText resolve them in
// every module without each module having to know about contacts.
export function warehouseAddressLocations(contacts: any[]): Location[] {
  const out: Location[] = [];
  (contacts || []).filter(isWarehouseContact).forEach((c: any) => {
    contactAddresses(c).forEach(({ address, index }) => {
      const id = warehouseCpLocId(c.id, index);
      const name = index === 0 ? String(c.name) : `${c.name} — ${address || `address ${index + 1}`}`;
      out.push({ id, type: "RentedWarehouse", legacyType: "OWN", name, country: c.country || "", address: address || undefined });
    });
  });
  out.forEach(loc => {
    const existing = LOCATIONS.find(l => String(l.id) === String(loc.id));
    if (!existing) LOCATIONS.push(loc);
    else { existing.name = loc.name; existing.address = loc.address; existing.country = loc.country; }
  });
  return out;
}

// Candidate "operated" locations for a warehouse tariff: the built-in/custom
// warehouse-type locations PLUS the warehouse counterparties' own addresses.
export function warehouseLocationOptions(contacts: any[]): Location[] {
  const builtins = LOCATIONS.filter(l =>
    !l.aliasOf &&
    Number(l.id) < WAREHOUSE_CP_LOC_BASE &&
    (l.type === "RentedWarehouse" || l.type === "OwnWarehouse" || l.type === "PortWarehouse" || l.type === "BondedWarehouse")
  );
  const cp = warehouseAddressLocations(contacts);
  const seen = new Set<string>();
  return [...builtins, ...cp].filter(l => { const k = String(l.id); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Flat list of warehouse destinations (counterparty × address) for destination
// dropdowns. Each option stores a stable location id and shows company + address.
export function warehouseDestinationOptions(contacts: any[]): { id: number; contactId: any; name: string; address: string }[] {
  const out: { id: number; contactId: any; name: string; address: string }[] = [];
  (contacts || []).filter(isWarehouseContact).forEach((c: any) => {
    contactAddresses(c).forEach(({ address, index }) => {
      out.push({ id: warehouseCpLocId(c.id, index), contactId: c.id, name: c.name, address });
    });
  });
  return out;
}

// ─── COUNTERPARTY ADDRESSES AS LOCATIONS (v6.15, #6) ────────────────────────
// From / To / Destination must offer the supplier, client and warehouse
// addresses entered in the Counterparties module — not a separate list. We
// register every such address into LOCATIONS with a stable id (the same
// 900000 + contactId*100 + addressIndex scheme the warehouse helper already
// uses) and the right legacyType, so the pickers (which filter LOCATIONS by
// legacyType) and the transport confirmation (which resolves by id) both see
// them. Bootstrapped at module load from localStorage BEFORE any module
// snapshots LOCATIONS — mirroring the logistics-points bootstrap. A reload is
// what propagates newly added counterparties (same pattern used elsewhere).

function counterpartyLocationRole(c: any): { legacyType: string; type: LocationType } | null {
  if (isWarehouseContact(c)) return { legacyType: "OWN", type: "RentedWarehouse" };
  const types = [c?.type, ...((c?.additionalTypes) || [])];
  if (types.includes("Supplier")) return { legacyType: "SUPPLIER", type: "SupplierFacility" };
  if (types.includes("Client")) return { legacyType: "CLIENT", type: "ClientFacility" };
  return null; // carriers / forwarders / brokers are providers, not delivery places
}

// Pure builder: every supplier / client / warehouse counterparty address as a
// Location (no mutation). v6.18.4 (P0-4): used at render time by the SO, Shipment
// and Inventory pickers so a counterparty added this session appears immediately,
// without waiting for the module-load bootstrap (which only runs on a refresh).
export function counterpartyLocations(contacts: any[]): Location[] {
  const out: Location[] = [];
  (contacts || []).forEach((c: any) => {
    const role = counterpartyLocationRole(c);
    if (!role || (c.id == null)) return;
    contactAddresses(c).forEach(({ address, index }) => {
      out.push({
        id: warehouseCpLocId(c.id, index),
        type: role.type, legacyType: role.legacyType,
        name: index === 0 ? String(c.name) : `${c.name} — ${address || `address ${index + 1}`}`,
        country: c.country || "", address: address || undefined,
      });
    });
  });
  return out;
}

// Register (idempotently) supplier / client / warehouse counterparty addresses.
export function registerCounterpartyLocations(contacts: any[]): void {
  counterpartyLocations(contacts).forEach((loc: Location) => {
    const existing = LOCATIONS.find(l => String(l.id) === String(loc.id));
    if (!existing) LOCATIONS.push(loc);
    else { existing.name = loc.name; existing.address = loc.address; existing.country = loc.country; existing.type = loc.type; existing.legacyType = loc.legacyType; }
  });
}

function readContactsFromStorage(): any[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(dataKey("contacts")); // v6.38.0: current version, not the frozen v1 safety copy
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("[locations] Could not read contacts for location bootstrap:", err);
    return [];
  }
}

// Bootstrap at module load — runs to completion before importers snapshot LOCATIONS.
registerCounterpartyLocations(readContactsFromStorage());


// ─── v6.73.0: COUNTRY IS A PICKLIST, NOT FREE TEXT ──────────────────────────
// A supplier's country was typed by hand and one record read "Poalnd". The EU
// membership lookup failed on the misspelling, so a Polish producer selling to
// Egypt classified as CROSS_TRADE instead of EXPORT — a wrong customs
// classification produced silently by a single transposed letter.
//
// The list carries every EU state (which is what the movement matrix tests) plus
// the countries this business actually trades with. Free text is still accepted
// for anywhere unusual, but the field offers the list first and the integrity
// checker flags a country it does not recognise.
export const COUNTRY_LIST: string[] = [
  // EU-27 — these decide import/export/intra-EU classification
  "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czechia", "Denmark", "Estonia",
  "Finland", "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia",
  "Lithuania", "Luxembourg", "Malta", "Netherlands", "Poland", "Portugal", "Romania",
  "Slovakia", "Slovenia", "Spain", "Sweden",
  // Trading partners outside the EU
  "Albania", "Belarus", "Bosnia and Herzegovina", "Egypt", "Georgia", "Iraq", "Israel",
  "Jordan", "Kuwait", "Lebanon", "Libya", "Moldova", "Montenegro", "Morocco", "North Macedonia",
  "Norway", "Oman", "Qatar", "Saudi Arabia", "Serbia", "Switzerland", "Tunisia", "Türkiye",
  "Ukraine", "United Arab Emirates", "United Kingdom",
  // Further afield, seen in the data
  "Cambodia", "Chile", "Colombia", "India", "Kenya", "South Africa", "United States",
];

const COUNTRY_SET = new Set(COUNTRY_LIST.map(c => c.toLowerCase()));

/** Is this a country the system recognises? Blank is not an error — unknown is. */
export function isKnownCountry(v: any): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return !s || COUNTRY_SET.has(s);
}

/** Closest known country to a misspelling, or "" — so a warning can suggest the
 *  fix rather than only reporting the fault. One transposition away is enough. */
export function suggestCountry(v: any): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s || COUNTRY_SET.has(s)) return "";
  const sorted = (x: string) => x.split("").sort().join("");
  const target = sorted(s);
  const hit = COUNTRY_LIST.find(c => {
    const l = c.toLowerCase();
    return Math.abs(l.length - s.length) <= 1 && sorted(l) === target;
  });
  return hit || "";
}
