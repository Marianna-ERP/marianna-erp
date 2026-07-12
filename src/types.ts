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
}

// ── Product catalog ──────────────────────────────────────────────────────────
export interface CatalogItem {
  item: string;
  varieties: string[];
  /** BP-8: default CN/HS per item/variety — added in the PO/SO batch. */
  defaultCnCode?: string;
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
}

export interface POrder {
  id: number;
  number: string;
  status: string;               // Draft | Confirmed | ... | Cancelled (reduced by BP-5)
  orderDate?: string;
  loadingDate?: string;
  expectedDeliveryDate?: string;
  promisedDateMeans?: string;   // folds into structured handover semantics (BP-1C)
  actualAvailabilityDate?: string | null; // removed from the form by BP-9
  paymentTerms?: string;
  paymentTermsOther?: string;
  buyIncoterm?: string;
  /** LEGACY flow — replaced by structured fields (BP-1) via the BP-12 shim. */
  flow?: string;
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
}

export interface SOrder {
  id: number | null;
  number: string;
  status: string;               // reduced to Draft/Confirmed/Cancelled by BP-19
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
  pendingInvoices?: any[];
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
  /** LEGACY flow-derived fields — mapped by the BP-12 shim, removed after Batch 4. */
  flow?: string;
  directFlow?: boolean;
  custodyType?: string;
  flowLabel?: string;
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
  /** LEGACY (BP-50): leg-level cost fields — cost lines are the only cost truth. */
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
export const SO_PRE_DISPATCH_STATUSES = new Set(["Confirmed", "Reserved", "Loading"]);

// ⚠ KNOWN DIVERGENCE (Batch 0 finding, resolve in Batch 1 with tests):
// Inventory's local lotReservations uses a WIDER reserving set
// (Confirmed…Closed, 7 statuses), so Inventory's availability display and the
// SalesOrders engine can disagree for Shipped/Delivered/Invoiced/Closed orders.
// Deliberately NOT unified here — changing either set changes availability
// behaviour. The Batch 1 engine unification decides the correct semantics.
