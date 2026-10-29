import { nextId } from "./ids";
import { dataKey, writeSharedStoreValue } from "./useLocalStoredState";
import { formatAddress as _fmtAddr } from "./address.domain";
import { rolesOf, companyAddressLine, companyCountryName } from "./counterparty.domain";   // v7.28.2 · v7.28.10 (Batch L)
const formatAddressOneLine = (a: any) => _fmtAddr(a, { oneLine: true });
// ─── SHARED LOCATIONS (v5.8 trunk, Option B consolidation) ──────────────────
//
// Single source of truth for all location lookups across PurchaseOrders,
// SalesOrders, Inventory and Shipments. Replaces the four separate per-module
// LOCATIONS arrays that had drifted (different spellings) and conflicted
// (ids 8/10 were one demo place, Shipments had an "(SO/PO id)" workaround).
//
// Option B approach (per decision): we KEEP all existing IDs so no seed data
// reference needs to change. We only:
//   1. unify spelling (proper Polish diacritics everywhere)
//   2. keep both alias IDs pointing at the same real place
//      (id 8 == id 10 and id 9 == id 11: the first version's demo client places)
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
  addr?: { street?: string; postcode?: string; city?: string; country?: string; note?: string };   // v6.99.41 (ADDR-2): the four parts; `address` mirrors them until the DDL
  id: number;
  type: LocationType;
  legacyType: string;          // the original "OWN"/"PORT"/etc. — kept so existing UI lookups by legacy type still work
  name: string;
  country: string;
  address?: string;
  aliasOf?: number;            // if set, this id is an alias for another canonical id (same physical place)
}

// Helper to keep the table compact



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
// v7.29.4: read when used, not while the module loads — the storage module and this one meet in a loop of imports
const customLocationsKey = () => dataKey("customLocations");

/** v7.27.3 (FZ-26 — owner rulings A-RV-37 and FZ-21: a place is read from its TYPE, no old word kept readable): the group a screen
 *  shows a place under — our warehouse, a supplier's or a client's site, a port (with port warehouses and cargo airports), customs —
 *  worked out from the type. The stored legacyType is written for old copies only and read by nothing outside this file. */
export type PlaceGroup = "OWN" | "SUPPLIER" | "CLIENT" | "PORT" | "BROKER" | "OTHER";
export function placeGroup(l: any): PlaceGroup {
  switch (String(l?.placeType || l?.type || "")) {   // placeType: where a screen keeps the real type beside the group
  case "OwnWarehouse": case "RentedWarehouse": return "OWN";
    case "SupplierFacility": return "SUPPLIER";
    case "ClientFacility": return "CLIENT";
    case "Port": case "PortWarehouse": case "Airport": return "PORT";
    case "Customs": return "BROKER";
    default: return "OTHER";
  }
}

// Options offered in the Settings UI → mapped to (type, legacyType) pairs.
const CUSTOM_LOCATION_TYPE_OPTIONS: { key: LocationType; label: string; legacyType: string }[] = [
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
    const raw = window.localStorage.getItem(customLocationsKey());
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
        addr: l.addr || undefined,   // v6.99.41 (ADDR-2): the parts survive the read, as the flag had to
        migratedFromSeed: !!l.migratedFromSeed,   // v6.99.29 (A-R19-4): the mapper used to drop this flag, so a migrated seed could never be told apart — or pruned
      } as Location & { custom: boolean; migratedFromSeed: boolean }));
  } catch (err) {
    console.warn("[locations] Could not read custom locations:", err);
    return [];
  }
}

function writeCustomLocations(list: Location[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    writeSharedStoreValue("customLocations", list);   /* v7.3.3 (A-SYNC-1) */
  } catch (err) {
    console.warn("[locations] Could not write custom locations:", err);
  }
}

export function addCustomLocation(input: { name: string; country: string; type: LocationType; address?: string; addr?: any; ownerId?: any }): Location {
  const existing = readCustomLocations();
  // v7.17.5 (A-RV-06): the id comes from the one counter (two people adding a place no longer take the same highest + 1);
  // kept above the built-in places and never one already taken here
  const taken = new Set(existing.map(l => Number(l.id) || 0)); let newId = nextId(); if (newId <= CUSTOM_LOCATION_ID_BASE) newId += CUSTOM_LOCATION_ID_BASE;
  while (taken.has(newId)) newId += 1;
  const loc: Location = {
    id: newId,
    type: input.type,
    legacyType: legacyTypeFor(input.type),
    name: input.name.trim(),
    country: (input.country || "").trim(),
    address: (input.address || "").trim() || undefined,
  };
  writeCustomLocations([...existing, { ...loc, custom: true, ...(input.addr ? { addr: input.addr } : {}), ...(input.ownerId != null && input.ownerId !== "" ? { ownerId: input.ownerId } : {}) } as any]);   // v7.6.0 (A-LOC-1): a location may belong to a company
  return loc;
}

export function removeCustomLocation(id: number): void {
  writeCustomLocations(readCustomLocations().filter(l => Number(l.id) !== Number(id)));
}

// v6.36.0: edit an existing custom location (name / country / address / type).
export function updateCustomLocation(id: number, patch: { name?: string; country?: string; address?: string; addr?: any; type?: LocationType; ownerId?: any }): void {
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
/** v6.73.0: A→Z by name. New entries used to land at the bottom of every
 *  dropdown in entry order, which makes a list of eighty places unusable. */
export function sortLocations(list: Location[]): Location[] {
  return [...(list || [])].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pl"));
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

const WAREHOUSE_CP_LOC_BASE = 900000;

export function isWarehouseContact(c: any): boolean {
  return !!c && (c.type === "Warehouse" || rolesOf(c).includes("Warehouse"));
}

// Every address a counterparty has: its primary address (index 0) plus any
// extraAddresses[] (index 1..n). Always returns at least one entry.
export function contactAddresses(c: any): { address: string; index: number; siteId?: any }[] {
  // v6.96.0 (IN-6): an address carries a PERSISTENT siteId once stamped (stampSiteIds); the
  // index-based id is only the first-time default, so re-ordering addresses never moves a lot.
  const list: { address: string; index: number; siteId?: any }[] = [];
  // v6.99.40 (A-ADDR): the structured address is the source; the legacy one-line text is the fallback.
  const own = companyAddressLine(c, { withCountry: true });   // v7.28.10 (Batch L): the one reader — a place's line keeps the country, as before
  if (own) list.push({ address: own, index: 0, siteId: c?.siteId });
  (c?.extraAddresses || []).forEach((a: any, i: number) => {
    const addr = typeof a === "string" ? a : (a?.addr && (a.addr.street || a.addr.city) ? formatAddressOneLine(a.addr) : (a?.address || ""));
    if (String(addr).trim()) list.push({ address: (typeof a === "object" && a && String(a.label || "").trim() ? `${String(a.label).trim()}, ` : "") + String(addr), index: i + 1, siteId: typeof a === "object" ? a?.siteId : undefined });   // v7.36.2: a named address (a terminal) keeps its name — on the pickers and the transport order
  });
  if (!list.length) list.push({ address: "", index: 0, siteId: c?.siteId });
  return list;
}
/** One-time: give every counterparty address the id it currently derives, so existing lot/PO/SO references stay valid forever. */
function siteIdOf(c: any, index: number): any {
  const a = contactAddresses(c).find(x => x.index === index);
  return a && a.siteId != null ? a.siteId : null;
}
export function stampSiteIds(contacts: any[]): { contacts: any[]; changed: boolean } {
  let changed = false;
  const next = (contacts || []).map((c: any) => {
    if (!c) return c;
    let n = { ...c };
    if (companyAddressLine(c) && c.siteId == null) { n.siteId = warehouseCpLocId(c.id, 0); changed = true; }
    if (Array.isArray(c.extraAddresses)) {
      n.extraAddresses = c.extraAddresses.map((a: any, i: number) => {
        const obj = typeof a === "string" ? { address: a } : { ...a };
        if (obj.siteId == null && String(obj.address || "").trim()) { obj.siteId = newSiteId(c.id, i + 1); changed = true; }   // v6.99.97 (A-ID-1)
        return obj;
      });
    }
    return n;
  });
  return { contacts: next, changed };
}

export function warehouseCpLocId(contactId: any, addressIndex: number): number {
  return WAREHOUSE_CP_LOC_BASE + Number(contactId) * 100 + Number(addressIndex || 0);
}
// v6.99.97 (A-ID-1): company ids are now ~1.8 × 10^15, so base + id × 100 + n (~1.8 × 10^17) is beyond a number's exact range
// and address 1, 2… round onto address 0. A company's MAIN address keeps the formula (every stored reference already holds that
// value); a further address gets its id from the id counter when the formula would not be exact. Once given, the stored siteId
// is the address's id everywhere (rule 7) — nothing re-derives it.
export function exactSiteId(contactId: any, addressIndex: number): boolean {
  const v = WAREHOUSE_CP_LOC_BASE + Number(contactId) * 100 + Number(addressIndex || 0);
  return Number.isSafeInteger(v) && Number.isSafeInteger(Number(contactId) * 100);
}
export function newSiteId(contactId: any, addressIndex: number): number {
  return (Number(addressIndex || 0) === 0 || exactSiteId(contactId, addressIndex)) ? warehouseCpLocId(contactId, addressIndex) : nextId();
}

function counterpartyLocationRole(c: any): { legacyType: string; type: LocationType } | null {
  if (isWarehouseContact(c)) return { legacyType: "OWN", type: "RentedWarehouse" };
  const types = rolesOf(c);
  if (types.includes("Supplier")) return { legacyType: "SUPPLIER", type: "SupplierFacility" };
  if (types.includes("Client")) return { legacyType: "CLIENT", type: "ClientFacility" };
  if (c?.isPlace === true) return { legacyType: "OTHER", type: "ClientFacility" };   // v7.3.5 (A-LOC-1): any company may be ticked as a place
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
        id: (siteIdOf(c, index) ?? warehouseCpLocId(c.id, index)),
        type: role.type, legacyType: role.legacyType,
        name: index === 0 ? String(c.name) : `${c.name} — ${address || `address ${index + 1}`}`,
        country: companyCountryName(c), address: address || undefined,
        // v7.3.5 (A-LOC-1, owner 7 Oct): "goods are loaded / delivered here" — unticked, the address still resolves for every document
        // and print (same id), but it is no longer OFFERED in the location pickers
        ...({ ownerId: c.id, pickable: c.isPlace !== false } as any),
      });
    });
  });
  return out;
}



// ── v6.86.0: ONE SOURCE FOR EVERY LOCATION PICKER ─────────────────────────────
// ports (reference) + the user's custom locations (Settings) + every counterparty
// site derived from its addresses (warehouse / supplier / client / broker). No
// module builds its own merge any more; no demo seed appears anywhere.
/** v7.21.14 (A-RV-37 · FZ-05, owner 12 Oct): what a place IS comes from its TYPE — never from the old one-word code, which
 *  also calls a place of type Other "PORT". A port is a Port or a Port warehouse; an airport counts only where the list means
 *  airports (and for "Customs"). A place known only by the old word (no type at all) keeps it. `placeType` is the real type
 *  where a screen has replaced `type` with the old word (Inventory). */
const PORT_TYPES = ["Port", "PortWarehouse"];
function placeTypeOf(l: any): string { return String(l?.placeType ?? l?.type ?? ""); }
export function isPortType(l: any, opts: { airports?: boolean } = {}): boolean {
  if (!l) return false; const t = placeTypeOf(l);
  return PORT_TYPES.includes(t) || (!!opts.airports && t === "Airport");   // v7.27.3 (FZ-26): the type only — the old word "PORT" no longer makes a port
}
/** Resolve any location id — built-in, custom or counterparty site. */
// ── v7.32.0 (FZ-04a, owner 26 Oct: "we should not have the old built-in warehouse anywhere … check location fields in every module and from where they read")
// ONE RULE: A PLACE IS AN ADDRESS WITH ONE OWNER — a company's address lives on its record in Parties › Companies; a public place
// (a port, a cargo airport, a border crossing, a port terminal) lives in Parties › Locations. Nothing else holds a place: no list in
// the code, no copy taken at start, no copy-back of old numbers. Every picker, list and print reads allPlaces(parties). ──
/** The public-place types Parties › Locations holds; anything else found in that store is an old company-like entry to replace. */
const PUBLIC_PLACE_TYPES: string[] = ["Port", "PortWarehouse", "Airport", "BorderCrossing", "CustomsOffice", "RelayPoint"];
export function isPublicPlaceType(type: any): boolean { return PUBLIC_PLACE_TYPES.includes(String(type || "")); }
/** The Parties the App hands over (its live list, not a copy) for the few callers that resolve a place without passing them. */
let PARTIES_FOR_PLACES: any[] = [];
export function setPartiesForPlaces(parties: any[]): void { PARTIES_FOR_PLACES = Array.isArray(parties) ? parties : []; }
/** Every place: the companies' addresses (Parties › Companies) and the public places (Parties › Locations), A→Z. */
export function allPlaces(parties?: any[]): Location[] {
  const byId = new Map<string, Location>();
  counterpartyLocations(parties ?? PARTIES_FOR_PLACES).forEach(l => { if (l && !byId.has(String(l.id))) byId.set(String(l.id), l); });
  readCustomLocations().forEach(l => { if (l && isPublicPlaceType((l as any).type) && !byId.has(String(l.id))) byId.set(String(l.id), l); });   // v7.36.1 (PLACES-2): an old company-like entry is never offered
  return sortLocations(Array.from(byId.values()));
}
/** The older name of allPlaces, kept for the callers. */
export function unifiedLocations(contacts: any[] = []): Location[] { return allPlaces(contacts && contacts.length ? contacts : undefined); }
/** v7.32.0: OUR MAIN WAREHOUSE — the warehouse company ticked "our main warehouse" in Parties (its first address); without a tick, the
 *  first warehouse company; without one, null. Read by the PO form's DAP / DDP delivery address and the journey's "into our stock". */
export function ourMainWarehouse(parties?: any[]): Location | null {
  const list = (parties ?? PARTIES_FOR_PLACES).filter((c: any) => c && !c.archived && !c.deleted && isWarehouseContact(c));
  const pick = list.find((c: any) => c.isMainWarehouse) || list[0]; if (!pick) return null;
  return counterpartyLocations([pick])[0] || null;
}
export function locationById(id: any, contacts: any[] = []): Location | null {
  if (id === null || id === undefined || id === "") return null;
  return allPlaces(contacts && contacts.length ? contacts : undefined).find(l => String(l.id) === String(id)) || readCustomLocations().find(l => l && String(l.id) === String(id)) || null;   // v7.36.1: an old entry still resolves for the records that use it   // v7.32.0: the Parties, or the live list the App handed over
}

// ── v6.99.39 (D-1, owner 18 Sept): ONE resolver for how a place is PRINTED ──
// Screens show a place's short name; documents need its address. The picker stores the id (and the name as a
// readable fallback); every printed document resolves the id here. The text is used only when there is no id —
// a legacy or typed value — so a registered place always prints with its address.
export function placeForPrint(id: any, text: any, contacts: any[] = []): { name: string; address: string; country: string; line: string } {
  const loc: any = (id !== null && id !== undefined && id !== "") ? locationById(id, contacts) : null;
  if (loc) {
    // v6.99.48 (A-PO-15, owner): the structured address when the place has one; the one-line text otherwise — and the
    // country is printed ONCE (a legacy one-line address often already ends with it).
    const a: any = (loc as any).addr;
    const country = String(loc.country || a?.country || "").trim();
    let address = a && (a.street || a.postcode || a.city) ? [a.street, [a.postcode, a.city].filter(Boolean).join(" ")].filter(Boolean).map((s: any) => String(s).trim()).join(", ")
      : Array.from(new Set([loc.address, (loc as any).city].filter(Boolean).map((s: any) => String(s).trim()).filter(Boolean))).join(", ");
    const endsWithCountry = country && new RegExp(`(^|[,·\\s])${country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i").test(address);
    const line = [loc.name, address, endsWithCountry ? "" : country].filter(Boolean).join(" · ");
    return { name: String(loc.name || ""), address, country, line };
  }
  const t = String(text || "").trim();
  return { name: t, address: "", country: "", line: t };
}


// ══ v7.18.1 (A-AU-3, owner 9 Oct — P-8, 'lists instead of typing') ════════════════════════════════════════════════════════════
// A sale's destination is one of the CLIENT'S SITES — its legal address when that is ticked as a place, or a location it owns —
// or a place from the list; never an address typed (or copied) as text. The addresses typed on sales before are listed once in
// Counterparties → Locations: each becomes the client's site (its legal address when it is the same address, else a new location
// of the client), and its sales are linked to it.
const addressKey = (s: any) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
const liveDoc = (o: any) => !!o && !o.deleted && o.status !== "Cancelled";
const hasPlaceId = (o: any) => o?.destinationLocationId != null && String(o.destinationLocationId) !== "";
/** The client's sites: its legal address (when it is a place) and its other addresses, then the locations it owns. */
export function clientSites(client: any, custom: any[]): Array<{ id: any; name: string; address: string; country: string; legal: boolean }> {
  if (!client || client.id == null) return [];
  const own = counterpartyLocations([client]).filter((l: any) => l.pickable !== false)
    .map((l: any) => ({ id: l.id, name: String(l.name), address: String(l.address || ""), country: String(l.country || ""), legal: String(l.name) === String(client.name) }));
  const owned = (custom || []).filter((l: any) => l && String(l.ownerId) === String(client.id) && !l.deleted && !l.hidden)
    .map((l: any) => ({ id: l.id, name: String(l.name), address: String(l.address || ""), country: String(l.country || ""), legal: false }));
  return [...own, ...owned];
}
export interface TypedDestination { key: string; text: string; clientId: any; clientName: string; country: string; orders: string[]; legalSiteId: any; }
const destKey = (o: any) => `${o?.client?.id ?? "?"}|${addressKey(o?.destinationText)}`;
/** Every live sale whose destination is text with no place, once per client and address. legalSiteId: the client's legal
 *  address is that same address (and is a place) — the sales are linked to it; otherwise the address becomes a new site. */
export function typedSaleDestinations(orders: any[], contacts: any[]): TypedDestination[] {
  const map = new Map<string, TypedDestination>();
  (orders || []).forEach((o: any) => {
    const text = String(o?.destinationText || "").trim(); if (!liveDoc(o) || !text || hasPlaceId(o)) return;
    const key = destKey(o); let e = map.get(key);
    if (!e) {
      const c = (contacts || []).find((x: any) => String(x.id) === String(o.client?.id)) || null;
      const legal = c && c.isPlace !== false ? counterpartyLocations([c]).find((l: any) => String(l.name) === String(c.name)) : null;
      const same = !!legal && [legal.address, companyAddressLine(c)].some((a: any) => !!addressKey(a) && addressKey(a) === addressKey(text));
      e = { key, text: text.replace(/\s+/g, " "), clientId: c ? c.id : (o.client?.id ?? null), clientName: String(c?.name || o.client?.name || "—").trim(), country: String((c ? companyCountryName(c) : "") || o.client?.country || ""), orders: [], legalSiteId: same ? legal!.id : null };
      map.set(key, e);
    }
    e.orders.push(String(o.number));
  });
  return Array.from(map.values()).sort((a, b) => a.clientName.localeCompare(b.clientName, "pl") || b.orders.length - a.orders.length);
}
/** The one-time link: every live sale typed with this client and address names the site (the place decides; its name is shown). */
export function linkSaleDestinationOn(orders: any[], key: string, site: { id: any; name: string }): { orders: any[]; changed: string[] } {
  const changed: string[] = [];
  const next = (orders || []).map((o: any) => {
    if (!liveDoc(o) || hasPlaceId(o) || !String(o?.destinationText || "").trim() || destKey(o) !== key) return o;
    changed.push(String(o.number)); return { ...o, destinationLocationId: site.id, destinationText: site.name };
  });
  return { orders: next, changed };
}
