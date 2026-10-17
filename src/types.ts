// ─────────────────────────────────────────────────────────────────────────────
// types.ts — shared data contracts (Consolidation Batch 0)
//
// One place where the shape of every core record is declared. Modules import
// these instead of re-declaring or assuming shapes. The project compiles with
// strict:false, so these interfaces are the *contract*, tightened gradually:
// fields are typed as they exist in real stored data today (optional-heavy on
// purpose — records created by older versions may lack newer fields).
//
// Blueprint references: BP-1..54 (Consolidation Blueprint), Ownership Map §2.
// ─────────────────────────────────────────────────────────────────────────────

// ── Counterparties ───────────────────────────────────────────────────────────
export interface ContactPerson {
  id: number;
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
  notes?: string;
}

export interface Counterparty {
  id: number;
  /** Single role today; becomes roles: string[] in the BP-42 migration. */
  type: string;
  name: string;
  country?: string;
  address?: string;
  nip?: string;      // local tax id
  vatEuId?: string;  // EU VAT id (display falls back to this when nip absent)
  defaultCurrency?: string;
  paymentTerms?: string; // free text today; structured {days, basis} per BP-46
  notes?: string;
  contacts?: ContactPerson[];
  services?: string[];        // Forwarder / Carrier service tags
  warehouseTariff?: any;      // tariff rates + locationIds (warehouse role)
  /** LEGACY (BP-43): static list, replaced by computed linked documents. */
  linkedDocs?: string[];
  archived?: boolean;         // BP-44 archive-not-delete (not yet enforced)
  additionalTypes?: any[] | string[];   // v7.22.6 (FZ-20): stored in the data, now declared
  addr?: Record<string, any>;   // v7.22.6 (FZ-20): stored in the data, now declared
  addressNeedsCheck?: boolean;   // v7.22.6 (FZ-20): stored in the data, now declared
  countryIso?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  extraAddresses?: any[];   // v7.22.6 (FZ-20): stored in the data, now declared
  finance?: Record<string, any>;   // v7.22.6 (FZ-20): stored in the data, now declared
  paymentTermsDays?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  paymentTermsOther?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  people?: Record<string, any>[] | any[];   // v7.22.6 (FZ-20): stored in the data, now declared
  roles?: string[];   // v7.22.6 (FZ-20): stored in the data, now declared
  siteId?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  terms?: Record<string, any>;   // v7.22.6 (FZ-20): stored in the data, now declared
  mergedFromIds?: any[];   // v7.22.6 (FZ-20): written when two companies are merged — not in the 2 Oct file
}

// ── Product catalog ──────────────────────────────────────────────────────────
export interface CatalogItem {
  item: string;
  varieties: string[];
  /** BP-8: default CN/HS per item/variety — added in the PO/SO batch. */
  defaultCnCode?: string;
  /** v7.18.3 (A-AU-5): the item's calibres and colorations — order lines pick from them (deleted ones kept apart, struck through). */
  calibres?: string[];
  colorations?: string[];
  deletedCalibres?: string[];
  deletedColorations?: string[];
}

// ── Purchase Orders ──────────────────────────────────────────────────────────
export interface POLine {
  id: number;
  product: string;
  variety?: string;
  cnCode?: string;
  coloration?: string;
  origin?: string;
  size?: string;
  quality?: string;
  unit?: string;          // "Kg"
  qty: number | string;   // form keeps strings; engines must Number() it
  pallets?: number | string;
  unitPrice: number | string;
  /** LEGACY (BP-51): per-line currency removed — the PO header currency is the
   *  only pricing truth. Kept optional for old stored records. */
  currency?: string;
  packaging?: string;
  addedByPackingResult?: boolean;   // v7.22.6 (FZ-20): stored in the data, now declared
  boxes?: number | string;   // v7.22.6 (FZ-20): stored in the data, now declared
  estimatedQty?: number | string;   // v7.22.6 (FZ-20): stored in the data, now declared
  kgPerBox?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  packagingId?: string | null;   // v7.22.6 (FZ-20): stored in the data, now declared
  pricingUnit?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  quantityStatus?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
}

export interface POrder {
  id: number;
  number: string;
  status: string;               // Draft | Confirmed | In Production | Shipped | Arrived | Closed | Cancelled — statuses beyond Confirmed are manual-only; KPIs derive from linked state (v6.36.1)
  orderDate?: string;
  loadingDate?: string;
  expectedDeliveryDate?: string;
  promisedDateMeans?: string;   // folds into structured handover semantics (BP-1C)
  actualAvailabilityDate?: string | null; // removed from the form by BP-9
  paymentTerms?: string;
  paymentTermsOther?: string;
  buyIncoterm?: string;
  supplier?: any;               // counterparty snapshot (id + legal snapshot rule)
  destinationLocationId?: number | string | null;
  destinationText?: string;
  requiresSea?: boolean;
  currency: string;
  fxRate: number;
  fxLockedAt?: string | null;
  items: POLine[];
  notes?: string;
  /** LEGACY (BP-49): stored link arrays — replaced by computed linked records. */
  linkedShipments?: string[];
  linkedLots?: string[];
  linkedInvoices?: string[];
  variance?: { expectedKg: number; receivedKg: number } | null;
  cancelledAt?: string;
  directFlow?: boolean;   // v7.22.6 (FZ-20): stored in the data, now declared
  lotRefs?: string[];   // v7.22.6 (FZ-20): stored in the data, now declared
  packingResultAt?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  paymentBasis?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  paymentDays?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  pricingMode?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  statusNormalisedFrom?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
}

// ── Sales Orders ─────────────────────────────────────────────────────────────
export interface SOLine {
  id: number;
  product: string;
  variety?: string;
  cnCode?: string;
  origin?: string;
  size?: string;
  quality?: string;
  unit?: string;
  qty: number | string;
  pallets?: number | string;
  unitPrice: number | string;
  sourceType: "STOCK" | "PO" | null;
  sourceRef: string;
  sourceLineId: number | null;
  packaging?: string;
  /** BP / audit P1-1: per-line shipped qty lands here in the engine batch. */
  shippedKg?: number;
  addedByPackingResult?: boolean;   // v7.22.6 (FZ-20): stored in the data, now declared
  boxes?: number | null;   // v7.22.6 (FZ-20): stored in the data, now declared
  coloration?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  grade?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  kgPerBox?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  packagingId?: string | null;   // v7.22.6 (FZ-20): stored in the data, now declared
  priceToAgree?: boolean;   // v7.22.6 (FZ-20): stored in the data, now declared
  pricingUnit?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  migratedFromPO?: string;   // v7.24.2 (FZ-20): the PO an old line was sold from, kept when it was pointed at its lot (A-ONE-1)
}

export interface SOrder {
  id: number | null;
  number: string;
  status: string;               // full lifecycle — see SO_STATUSES below (Draft…Closed, Cancelled)
  createdBy?: string;
  orderDate?: string;
  deliveryDate?: string;
  promisedDateMeans?: string;
  actualDeliveryDate?: string | null; // removed from the form by BP-17
  importPermitNo?: string;
  acidNo?: string;
  paymentTerms?: string;
  paymentTermsOther?: string;
  sellIncoterm?: string;
  client?: any;                 // counterparty snapshot
  destinationLocationId?: number | string | null;
  destinationText?: string;
  currency: string;
  fxRate: number;
  fxLockedAt?: string | null;
  items: SOLine[];
  notes?: string;
  /** LEGACY (BP-49 / A3-6): stored link + pending-invoice arrays. */
  linkedInvoices?: string[];
  linkedShipments?: string[];
  /** @deprecated v6.33.0 (A3-6): the Invoices register is the sole owner — this
   *  field is read only by the legacy fold, then stripped. Never write it. */
  pendingInvoices?: any[];
  blockedReason?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  cancelledAt?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  expectedLoadingDate?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  paymentBasis?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  paymentDays?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  statusOverride?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  statusOverrideAt?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  statusOverrideReason?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
}

// ── Inventory ────────────────────────────────────────────────────────────────
export type MovementType =
  | "IN" | "SHIP_OUT" | "REVERSAL"          // system events (protected)
  | "TRANSFER" | "DAMAGE" | "CLAIM" | "RECLASS"; // manual events (voidable)

export interface LotMovement {
  id: number;
  type: MovementType | string;
  date: string;
  qtyKg: number;
  fromId?: number | string | null;
  toId?: number | string | null;
  soRef?: string;
  note?: string;
  source?: string;   // provenance tag (idempotency key for system events)
  voided?: boolean;  // v6.18.17: excluded from recompute, kept for the record
  voidedAt?: string;
  boxes?: any;   // v7.22.6 (FZ-20): stored in the data, now declared
  claimCurrency?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  claimValue?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  expectedKg?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  grade?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  poNote?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  shipmentRef?: string | null;   // v7.22.6 (FZ-20): stored in the data, now declared
  varianceKg?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
}

export interface LotCostLine {
  type: string;      // purchase | freight | customs | warehouse | ...
  label: string;
  source?: string;   // originating document ref — BP-52 replace-by-source key
  amount?: number;
  currency?: string;
  pln: number;
}

export interface Lot {
  id: number;
  number: string;
  product: string;
  variety?: string;
  cnCode?: string;
  quality?: string;
  size?: string;
  origin?: string;
  /** LIVE (v6.40.1 truth pass): derived from the governing sale's cargo plan
   *  (poDirectFromSOs at PO save). The availability engine and shipment posting
   *  depend on it — do NOT remove. */
  directFlow?: boolean;
  /** LEGACY read-only compat: old records carry it (isDirectLot ORs it in);
   *  never written since v6.37.0. */
  custodyType?: string;
  destinationText?: string;
  poRef?: string;
  poLineId?: number;
  locationId?: number | string | null;
  loadingDate?: string | null;   // becomes derived from shipment events (BP-34)
  arrivalDate?: string | null;   // becomes derived from shipment events (BP-34)
  productionDate?: string | null; // removed per BP-34
  expectedKg?: number;
  receivedKg?: number;   // cumulative received (reducer-derived after BP-32)
  physicalKg?: number;   // current on hand — DERIVED by the movement reducer
  damagedKg?: number;    // derived
  packaging?: string;
  status?: string;
  consignment?: boolean;
  settlement?: { status: string } & Record<string, any>;
  /** BP-52: becomes a derived cache rebuilt from source documents. */
  costs?: LotCostLine[];
  movements?: LotMovement[];
  baseLocationId?: number | string | null;
  cancelledAt?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  claimedKg?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  notes?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  overIssuedKg?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  packagingId?: string | null;   // v7.22.6 (FZ-20): stored in the data, now declared
  poStatus?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  wasteKg?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
}

// ── Shipments ────────────────────────────────────────────────────────────────
export type CostResponsibility = "Marianna" | "Supplier" | "Client" | "None";

export interface TransportUnit {
  id: number;
  mode?: string;
  qtyKg?: number;
  pallets?: number;
  truckPlate?: string;
  trailerPlate?: string;
  driverName?: string;
  driverPhone?: string;
  containerNumber?: string;
  sealNumber?: string;
  bookingNumber?: string;
  blNumber?: string;
  awbNumber?: string;
  shippingLine?: string;
  tempRecorderNo?: string;
  notes?: string;
  /** v6.53.0 — WHAT THIS TRUCK CARRIES (ruling: assign per unit).
   *  A shipment's goods are split across its trucks by explicit assignment, not
   *  proportionally and not at protocol time: the loading protocol for a truck
   *  derives its pallet rows from this list. A line may be split across trucks
   *  (a 42 000 kg PO delivered in two trucks), so the assignment is per LINE and
   *  per KG, never whole lines only.
   *  Empty / absent = this unit carries the whole shipment — the single-truck
   *  norm, and what every pre-v6.53.0 shipment means. */
  load?: Array<{ goodsLineId: any; qtyKg: number }>;
  /** v6.53.0: pallet footprint for THIS truck — standard 26 or euro 33. */
  palletType?: "standard" | "euro";
  actualLoadDate?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  actualUnloadDate?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  announcedPlate?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  carrierId?: number | string | null;   // v7.22.6 (FZ-20): stored in the data, now declared
  cmrNumber?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  costAmount?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  deliveredAt?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  deliveryLocationId?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  deliveryText?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  eta?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  feeders?: Record<string, any>[];   // v7.22.6 (FZ-20): stored in the data, now declared
  fromUnitId?: number | null;   // v7.22.6 (FZ-20): stored in the data, now declared
  kind?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  loadDateManual?: boolean;   // v7.22.6 (FZ-20): stored in the data, now declared
  loadedAt?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  manualLoad?: boolean;   // v7.22.6 (FZ-20): stored in the data, now declared
  pickupLocationId?: number | null;   // v7.22.6 (FZ-20): stored in the data, now declared
  pickupText?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  plannedDeliveryDate?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  plannedDeliveryTime?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  plannedLoadingDate?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  plannedLoadingTime?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  price?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  priceCurrency?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  supplierRef?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  unloadedAt?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
}

export interface ShipmentLeg {
  id: number;
  mode: string;                 // Road | Sea | Rail | Air
  status?: string;
  // v6.30.1 — CONTRACT FIX: the previous declaration said originLocationId /
  // destinationLocationId / loadingDate / unloadingDate / units, but no code has
  // ever written those fields. Every leg builder in Shipments.tsx, the seeds and
  // the posting engine (shipments.domain postShipmentToLots) use the names below.
  // Anyone coding against the old contract produced legs the engine couldn't read
  // (destId/fromId silently fell through to fallbacks).
  fromLocationId?: number | string | null;
  fromCustom?: string;
  toLocationId?: number | string | null;
  toCustom?: string;
  carrierId?: number | string | null;
  forwarderId?: number | string | null;
  plannedPickupDate?: string;
  plannedPickupTime?: string;
  plannedDeliveryDate?: string;
  plannedDeliveryTime?: string;
  actualPickupDate?: string;
  actualDeliveryDate?: string;
  /** Transport units live in `vehicles` (v6.10 — one home for vehicle data);
   *  transportUnitsForLeg() falls back to the legacy leg-level fields below. */
  vehicles?: TransportUnit[];
  /** LEGACY leg-level unit fields (pre-v6.10) — read via transportUnitsForLeg. */
  vehiclePlate?: string;
  trailerPlate?: string;
  driverName?: string;
  driverPhone?: string;
  containerNumber?: string;
  sealNumber?: string;
  bookingNumber?: string;
  blNumber?: string;
  awbNumber?: string;
  shippingLine?: string;
  temperatureMinC?: number;
  temperatureMaxC?: number;
  /** LIVE (v6.37.1, v6.40.1 truth pass): legs are the freight ENTRY POINT —
   *  the save-time mirror sync (syncLegFreightCostLines) regenerates the
   *  shipment's financial cost lines from these fields. Not legacy. */
  costAmount?: number;
  costCurrency?: string;
  costFxRate?: number;
  costPLN?: number;
  /** BP-54: ordered stops for groupage (multi-load / multi-unload tours). */
  stops?: Array<{
    id: number;
    kind: "loading" | "unloading";
    locationId?: number | string | null;
    custom?: string;
    plannedAt?: string;
    goodsLineIds?: number[];
    notes?: string;
  }>;
  notes?: string;
  costResponsibility?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  fromText?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  toText?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
}

export interface ShipmentGoodsLine {
  id: number;
  poRef?: string;
  soRef?: string;
  lotRef?: string;
  product?: string;
  variety?: string;
  cnCode?: string;
  origin?: string;
  quality?: string;
  size?: string;
  packaging?: string;
  qtyKg?: number;
  grossKg?: number;
  pallets?: number;
  description?: string;
  _grossAuto?: boolean;   // v7.22.6 (FZ-20): stored in the data, now declared
  addedByPackingResult?: boolean;   // v7.22.6 (FZ-20): stored in the data, now declared
  boxes?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  packagingId?: string | null;   // v7.22.6 (FZ-20): stored in the data, now declared
  poLineId?: number | string;   // v7.22.6 (FZ-20): stored in the data, now declared
  soLineId?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
}

export interface ShipmentCostLine {
  id: number;
  type: string;                  // road_freight | sea_freight | customs | ...
  supplierId?: number | string | null;
  amount: number;
  currency: string;
  fxRate: number;
  amountPLN: number;
  invoiceStatus?: string;        // BP-28A: expected → received → checked
  invoiceRef?: string;
  allocationMethod?: string;
  /** BP-26: per-line responsibility (header field exists; per-line lands Batch 3). */
  costResponsibility?: CostResponsibility;
  notes?: string;
  _customsAuto?: boolean;   // v7.22.6 (FZ-20): stored in the data, now declared
  label?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  legId?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  needsCarrier?: boolean;   // v7.22.6 (FZ-20): stored in the data, now declared
  responsibility?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  source?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
}

export interface Shipment {
  id: number;
  number: string;
  transportOrderNo?: string;
  mode?: string;
  /** Landing field for BP-23 — full enum (inbound/outbound/transfer/return) in Batch 3. */
  purpose?: string;
  status: string;
  poRefs?: string[];
  soRefs?: string[];
  lotRefs?: string[];
  carrierId?: number | string | null;
  forwarderId?: number | string | null;
  brokerId?: number | string | null;
  vehicleCount?: number;
  originLocationId?: number | string | null;
  originCustom?: string;
  destinationLocationId?: number | string | null;
  destinationCustom?: string;
  /** Header-level today; hardcoded "Marianna" in builders — fixed in Batch 3 (BP-26). */
  costResponsibility?: CostResponsibility | string;
  loadingDate?: string;
  expectedDeliveryDate?: string;
  actualLoadingDate?: string | null;    // BP-34: real event dates, not click dates
  actualDeliveryDate?: string | null;
  customsClearance?: any;               // free string today; structured object per BP-27
  temperatureMinC?: number;
  temperatureMaxC?: number;
  confirmationStatus?: string;
  confirmationSentAt?: string | null;
  billingStatus?: string;
  notes?: string;
  legs?: ShipmentLeg[];
  goods?: ShipmentGoodsLine[];
  costs?: ShipmentCostLine[];
  documents?: Array<{ id: number; type: string; ref?: string; status?: string; date?: string; notes?: string }>;
  supplierManagedTransport?: boolean;   // "Bought DAP/DDP"
  cancelledAt?: string;
  arrangedBy?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  bookings?: Record<string, any>[] | any[];   // v7.22.6 (FZ-20): stored in the data, now declared
  createdAt?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  customOrderTerms?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  customs?: Record<string, any>;   // v7.22.6 (FZ-20): stored in the data, now declared
  destinationText?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  docsCourierDate?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  docsCourierTrackingNo?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  governingSoRef?: string | null;   // v7.22.6 (FZ-20): stored in the data, now declared
  loadingProtocol?: Record<string, any>;   // v7.22.6 (FZ-20): stored in the data, now declared
  loadingProtocols?: Record<string, any>[];   // v7.22.6 (FZ-20): stored in the data, now declared
  originText?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  supplierId?: number;   // v7.22.6 (FZ-20): stored in the data, now declared
  supplierRef?: string;   // v7.22.6 (FZ-20): stored in the data, now declared
  terms?: string[];   // v7.22.6 (FZ-20): stored in the data, now declared
  tradeDirection?: string | null;   // v7.22.6 (FZ-20): stored in the data, now declared
  transportOrders?: Record<string, { sentAt?: string; told?: any }>;   // v7.22.6 (FZ-20): written by the app (transport order sent, per carrier and leg) — not in the 2 Oct file
}

// ── Canonical SO status semantics (single source — BP-48 / Batch 0) ─────────
// Visual + ordering map used by SalesOrders (and any module showing SO badges).
export const SO_STATUSES: Record<string, any> = {
  Draft:       { bg: "#F3F4F6", color: "#6B7280", order: 0, desc: "Being prepared — can edit freely" },
  Confirmed:   { bg: "#DBEAFE", color: "#2563EB", order: 1, desc: "Agreed with client, prices locked" },
  Reserved:    { bg: "#E0F2FE", color: "#0369A1", order: 2, desc: "Stock allocated / PO confirmed" },
  Loading:     { bg: "#FEF3C7", color: "#D97706", order: 3, desc: "Goods being prepared / loaded" },
  Shipped:     { bg: "#EDE9FE", color: "#7C3AED", order: 4, desc: "Handed to carrier, en route" },
  Delivered:   { bg: "#DCFCE7", color: "#16A34A", order: 5, desc: "Client confirmed receipt" },
  Invoiced:    { bg: "#D1FAE5", color: "#059669", order: 6, desc: "Sales invoice (SINV) issued" },
  Closed:      { bg: "#F3F4F6", color: "#374151", order: 7, desc: "Paid and complete" },
  Cancelled:   { bg: "#FEE2E2", color: "#DC2626", order: -1, desc: "Cancelled" },
};

// Statuses that reserve stock in the SalesOrders availability engine and are
// counted as the pre-dispatch pipeline on the Dashboard. (Identical 3-status
// sets in both files today — centralised without behaviour change.)
// Pre-dispatch statuses (used for labels and as the legacy full-qty fallback
// when no remainder context is available). The live reservation rule is the
// UNSHIPPED-REMAINDER rule in salesOrders.domain (v6.41.0, ruling A5): an open
// commitment reserves qty minus already-shipped, for every SO that is not
// Draft/Cancelled/Closed. Inventory and the SalesOrders engine share that one
// engine — they agree by construction (the old 7-vs-3 divergence is resolved).
export const SO_PRE_DISPATCH_STATUSES = new Set(["Confirmed", "Reserved", "Loading"]);

// ══ v7.22.6 (FZ-20, Batch F): THE RECORDS AS THEY ARE STORED — one catalogue, read from the data itself; the base for the table map ══
// The record types that live with their module are named here too, so this file lists every stored record.
export type { Invoice, InvoicePosition, FinanceNote } from "./invoicing";
export type { OperationalCost } from "./operationalCosts";
export type { Claim } from "./claims.domain";
export type { PackagingType } from "./packaging.domain";
export type { Inspection, StockCount } from "./seasonOps.domain";
export type { AdvancePayment } from "./advances.domain";
export type { BankAccount } from "./bankReconciliation.domain";
export type { Budget } from "./budgets.domain";
export type { ClosedPeriod } from "./periodClose.domain";
export type { AppUser } from "./permissions.domain";
/** A PO's settlement with its supplier (commission or truck settlement), as stored. */
export interface PoSettlement {
  commissionPct?: number;
  id?: number;
  poNumber?: string;
  provisionalEUR?: number;
  provisionalInvoiceNo?: string;
  ratePLNperEUR?: number;
  status?: string;
}
/** A place added in Settings (port, warehouse, border…), as stored. */
export interface CustomLocation {
  addr?: Record<string, any>;
  address?: string;
  country?: string;
  custom?: boolean;
  id?: number;
  legacyType?: string;
  migratedFromSeed?: boolean;
  name?: string;
  type?: string;
}
/** A quality report kept on record, as stored. */
export interface ReportEntry {
  by?: string;
  issuedAt?: string;
  kind?: string;
  number?: string;
  subject?: string;
}
/** One tab of the planning sheet, as stored. */
export interface PlanningSheet {
  createdAt?: string;
  id?: string;
  name?: string;
  order?: number;
  rows?: Record<string, any>[];
}
/** One change on the planning sheet, as stored. */
export interface PlanningSheetLogEntry {
  action?: string;
  at?: string;
  col?: string;
  now?: Record<string, any> | string;
  row?: string;
  tab?: string;
  who?: string;
}
/** One line of the audit trail, as stored. */
export interface AuditEntry {
  action?: string;
  docNumber?: string;
  docType?: string;
  id?: number;
  module?: string;
  summary?: string;
  ts?: string;
  user?: string;
}
/** Settings → Company, as stored. */
export interface CompanyProfile {
  address?: string;
  email?: string;
  name?: string;
  nip?: string;
  phone?: string;
}
/** When a season starts, as stored. */
export interface SeasonSettings {
  startDay?: number;
  startMonth?: number;
}
/** Every stored list and the record it holds (retired stores — warehouseInvoices, settledRefs, creditNotes, loadPlans, logisticsPoints — are emptied or gone and not listed). */
export interface StoreRecords {
  contacts: Counterparty; pos: POrder; orders: SOrder; lots: Lot; shipments: Shipment; invoices: import("./invoicing").Invoice; financeNotes: import("./invoicing").FinanceNote;
  operationalCosts: import("./operationalCosts").OperationalCost; claims: import("./claims.domain").Claim; inspections: import("./seasonOps.domain").Inspection; stockCounts: import("./seasonOps.domain").StockCount;
  advancePayments: import("./advances.domain").AdvancePayment; bankAccounts: import("./bankReconciliation.domain").BankAccount; budgets: import("./budgets.domain").Budget; closedPeriods: import("./periodClose.domain").ClosedPeriod;
  users: import("./permissions.domain").AppUser; productCatalog: CatalogItem; packagingTypes: import("./packaging.domain").PackagingType; poSettlements: PoSettlement; customLocations: CustomLocation;
  reportRegister: ReportEntry; planningSheets: PlanningSheet; planningSheetLog: PlanningSheetLogEntry; auditLog: AuditEntry;
}
