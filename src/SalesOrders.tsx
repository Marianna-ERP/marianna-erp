import { parseNum } from "./numbers";
import { statusWord } from "./format";
import { newestFirst } from "./moduleGuards.domain";
import { exportRowsToXlsx, stamp as xlsStamp } from "./exportXlsx";
import { SmallButton, notifySaved } from "./ui";
import DateInput from "./DateInput";
import React, { useState, useMemo } from "react";
import { buildCollectionShipment } from "./shipments.domain";
import { localTodayISO as domainToday, addDaysISO } from "./dates";
import { Card, Lbl, DocRef, cancelledDocSet, useConfirm, ActionButton} from "./ui";
import { PACKAGING_SEED } from "./packaging.domain";
import { effectiveSoStatus } from "./statusOwnership.domain";
import { lineTotal as lineTotalPU, pricingUnit as pricingUnitOf, kgPerBoxForLine, effectiveCounts } from "./pricingUnit.domain";
import { SO_STATUSES } from "./types";
import { isPOUsableForConfirmedSO, lotReservationsForPicker, computeLineAvailability as domainComputeLineAvailability , lotSellableBasis } from "./salesOrders.domain";
import { salesInvoiceFromSODraft } from "./invoicing";
import { nextId } from "./ids";
import { nextClaimNumber, blankClaim } from "./claims.domain";
import { defaultFxRate , rateOf } from "./fx";
import { getCounterpartiesByType } from "./Contacts";
import { readFakturowniaConfig, fetchInvoices, mapInvoice } from "./fakturownia";
import { locationById, placeForPrint } from "./locations";
import { termsToReview, termsFindingsForDoc } from "./incoterms.domain";   // v7.20.0 (A-INC-2): the SO view shows its terms to review
import { localTodayISO, formatDMY } from "./dates";
import { recordAudit } from "./audit";
import { isArchived, DEFAULT_SEASON } from "./season.domain";
import { companyProfile } from "./useLocalStoredState";
import { OrderForm } from "./SalesOrderForm";
import { InvoiceCreationModal, OrderDetail } from "./SalesOrderDetail";
import { SODoc } from "./SalesOrderDocument";
import { LOGO_DATA_URL } from "./brand";
import { requestNoteInInvoices } from "./noteRequest";   // v7.34.0 (CN-2)
import { invoicesForCounterpartyDoc, shipmentsForSO } from "./documents.domain";   // v7.28.5 (Batch L)
import { poExpectedArrival } from "./po.domain";   // v7.28.5 (Batch L)
import { peopleOf, companyAddressLine, companyCountryName } from "./counterparty.domain";   // v7.28.2 (Batch L)
import { exportNotesForSale, isFromPoland } from "./invoiceNotes.domain";   // v7.26.4 (A-INV-4)
import { issueNumber } from "./numbering";

// ─── SHARED UI ATOMS ──────────────────────────────────────────────────────
import { Inp } from "./ui";   // v7.44.0 (AUD3 redundancy): one copy, in ui.tsx
import { Sel } from "./ui";   // v7.27.8 (A-W5)

// ─── COMPANY ────────────────────────────────────────────────────────────────
export const COMPANY: any = companyProfile();   // v6.99.67 (A-AUD-1): the company block comes from Settings (defaults = the former literal)

// ─── BRAND ASSETS ──────────────────────────────────────────────────────────
// Logo embedded as base64 PNG — pulled in from PurchaseOrders.tsx so the printed SO is self-contained.
// v7.43.0 (AUD3 redundancy): the logo once — imported from brand.tsx

// ─── CLIENTS STUB ─────────────────────────────────────────────────────────
// Same pattern as PO's getSuppliersStub — to be replaced when integrated with Contacts.tsx
// (which exports getCounterpartiesByType(counterparties, "Client")).


function primaryContactValue(counterparty) {
  const contacts = peopleOf(counterparty);
  const primary = contacts.find(p => p.isPrimary) || contacts[0];
  return primary?.email || primary?.phone || counterparty.email || counterparty.contact || counterparty.phone || "";
}

function tradingPartnerFromCounterparty(counterparty) {
  return {
    id: counterparty.id,
    name: counterparty.name,
    country: companyCountryName(counterparty),   // v7.28.11 (Batch L)
    nip: counterparty.nip || "",
    vatEuId: counterparty.vatEuId || "",
    address: companyAddressLine(counterparty),   // v7.28.10 (Batch L)
    contact: primaryContactValue(counterparty),
  };
}

function clientsFromContacts(contacts) {
  const mapped = getCounterpartiesByType(contacts || [], "Client").map(tradingPartnerFromCounterparty);
  return mapped; // Batch 0 (G1): no stub-client fallback — empty contacts = empty pickers
}

// ─── PO REFS STUB ─────────────────────────────────────────────────────────
// Mirrors the PO export shape — replaced with live PO state on integration.
// Each entry: { number, status, supplier, currency, fxRate, requiresSea, expectedDelivery, items }
// where items[].id is referenced by sourceLineId on SO lines.

// ─── STOCK LOTS STUB ──────────────────────────────────────────────────────
// Mirrors the Inventory module's lot export — replaced on integration.

// v7.22.4 (A-RV-16, Batch F): NO HIDDEN MODULE COPIES. The lots, POs, shipments, contacts and packaging these screens read were
// module-level variables overwritten at the top of every render: a reader outside that render — a print, a second screen, a
// check — saw whatever the last render had left. They are now ONE value built from the props (buildSalesData), handed down
// through a React context; the helpers that need it take it as their last parameter.
export interface SalesData { lots: any[]; rawLots: any[]; poRefs: any[]; contacts: any[]; shipments: any[]; packagingTypes: any[] }
export const EMPTY_SALES_DATA: SalesData = { lots: [], rawLots: [], poRefs: [], contacts: [], shipments: [], packagingTypes: PACKAGING_SEED };
export const SalesDataContext = React.createContext<SalesData>(EMPTY_SALES_DATA);
export const useSalesData = (): SalesData => React.useContext(SalesDataContext);
function reserveCtx(sd: SalesData) { return sd.rawLots.length ? { lots: sd.rawLots, shipments: sd.shipments } : undefined; }

// Convert the lots into the Inventory→SalesOrders interface shape.
// Inventory stores: { number, product, quality, size, origin, warehouse, physicalKg, ... }
// SalesOrders expects: { number, product, quality, size, origin, warehouse, availableKg, packaging }
// We map physicalKg → availableKg so the source picker can still display a baseline figure.
// (The TRUE live availability is computed downstream by lotReservations with the SO list.)
// v6.99.147 (A-QC-7): a lot whose latest quality report says REJECTED is not for sale until sorting or a return decides
function rejectedByReport(lot: any, inspections: any[]): boolean {
  const mine = (inspections || []).filter((x: any) => x && x.status !== "Cancelled" && String(x.lotNumber) === String(lot?.number)).sort((a: any, b: any) => String(b.date || b.createdAt || "").localeCompare(String(a.date || a.createdAt || "")));
  return !!mine[0] && String(mine[0].verdict || "") === "Rejected";
}
function _adaptLotsFromInventory(invLots: any[], inspections: any[] = []) {
  return (invLots || []).filter((l: any) => l && !/Cancelled/.test(String(l.status || ""))).map(l => ({
    number: l.number,
    product: l.product,
    variety: l.variety || "",
    cnCode: l.cnCode || "",
    poRef: l.poRef || "",
    status: l.status || "",
    arrivalDate: l.arrivalDate || "",
    quality: l.quality,
    size: l.size,
    origin: l.origin,
    warehouse: l.warehouse || "—",
    locationName: (() => { try { return locationById(l.locationId)?.name || ""; } catch { return ""; } })(),   // v7.8.1 (A-SO-PK-2)
    // v6.99.127 (A-ONE-1, owner): a lot not yet received is sold on its EXPECTED kilos — selling from the PO is selling the lot made from it
    availableKg: rejectedByReport(l, inspections) ? 0 : lotSellableBasis(l),   // v7.41.0 (AUD3-L3): the one rule (a direct lot sells on the larger of expected and physical)
    rejected: rejectedByReport(l, inspections),
    lotState: /Cancelled/.test(String(l.status || "")) ? "deleted" : rejectedByReport(l, inspections) ? "rejected by quality report" : parseNum(l.physicalKg) > 0 ? "in stock" : parseNum(l.receivedKg) > 0 ? "received" : (l.directFlow || /direct/i.test(String(l.status || ""))) ? "direct" : "expected",
    physicalKg: l.physicalKg ?? 0,
    receivedKg: l.receivedKg ?? 0,
    packaging: l.packaging,
    // v6.45.0 (D): preserved for the engine — poLineId ties a lot to its PO line,
    // movements let the engine derive shipped kg (remainder rule + shipped-aware
    // PO supply). The old adapter dropped both, silently degrading the v6.41.0
    // remainder context inside computeLineAvailability.
    poLineId: l.poLineId ?? null,
    movements: l.movements || [],
  }));
}

// Convert POs from the PO module shape into the SalesOrders source-picker shape.
// PO has supplier:{name,country,...}, expectedDeliveryDate; SO wants flat supplierName, expectedDelivery.
// PO items lack an 'available' field — SO needs it for the picker. We set it to qty (full line),
// (v7.24.2: a sale line names its lot — nothing reserves a PO line downstream).
function _adaptPOsFromModule(pos) {
  return (pos || []).map(po => ({
    number: po.number,
    status: po.status,
    supplierName: po.supplier?.name || po.supplierName || "—",
    country: po.supplier?.country || po.country || "—",
    expectedDelivery: poExpectedArrival(po) || "—",   // v7.28.5 (Batch L)
    items: (po.items || []).map(it => ({
      ...it,
      available: it.available ?? (parseNum(it.qty) || 0),
    })),
  }));
}

// ─── DESTINATIONS ─────────────────────────────────────────────────────────
// v6.86.0: module-level LOCATIONS alias removed — pickers read unifiedLocations()
export const LOCATION_TYPES: Record<string, any> = {
  CLIENT: { icon: "🎯", label: "Client site" },
  OWN:    { icon: "🏢", label: "Our warehouse" },
  PORT:   { icon: "⚓", label: "Port / terminal" },
};
export function locById(id) { return locationById(id) as any; } // v6.86.0: one resolver
export function destinationDisplay(order) {
  const custom = String(order?.destinationText || order?.destinationLocationText || "").trim();
  if (custom) return custom;
  const loc = locById(order?.destinationLocationId);
  if (!loc) return "—";
  return `${loc.name}${loc.country ? `, ${loc.country}` : ""}`;
}
/** v6.99.39 (D-1): the DOCUMENT prints the place with its address — resolved from the id, the text only as a fallback. */
export function destinationForPrint(order: any, sd: SalesData): string {
  return placeForPrint(order?.destinationLocationId, order?.destinationText || order?.destinationLocationText, sd.contacts || []).line;
}

export const CURRENCIES = ["PLN", "EUR", "USD"];
export const QUALITY_GRADES = ["I", "IB", "II", "Industrial"];

// v6.99.23: the legacy PAYMENT_TERMS list retired — one source: basis + days (po.domain)

// ─── SEED DATA ────────────────────────────────────────────────────────────
// 5 example SOs in different lifecycle stages, covering both sourcing types.
// v6.32.0 (R7b-5): demo seed INIT_ORDERS moved out of the production bundle → dev/demoSeed.reference.ts

// ─── HELPERS ──────────────────────────────────────────────────────────────
export function fmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString("pl-PL", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
export function fmtMoney(n, cur) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return `${Number(n).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? " " + cur : ""}`;
}
export function fmtDate(d) { return d || "—"; }
export function netTotal(items, sd: SalesData) {
  // v6.61.0: a line priced per BOX totals boxes x price. Lines priced per kg —
  // every existing line — behave exactly as before, because pricingUnit is
  // absent on them and defaults to kg.
  return (items || []).reduce((sum, it) => sum + lineTotalPU(it, sd.packagingTypes), 0);
}
// Next SO number — scans for current year, increments highest NNNN
function nextSONumber(orders) {
  const year = new Date().getFullYear();
  const prefix = `SO-${year}-`;
  let maxNum = 0;
  (orders || []).forEach(o => {
    const m = (o.number || "").match(new RegExp(`^${prefix}(\\d{4})$`));
    if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
  });
  return `${prefix}${String(maxNum + 1).padStart(4, "0")}`;
}

// Next SINV (Sales Invoice) number — Polish-style FV/YYYY/NN/NNN.
// Scans existing invoices in the current year, increments highest seen.
// In the integrated app this lives in the Invoices module — here we keep
// a tiny helper so the SO module can preview what the invoice number will be.
export function nextSINVNumber(allInvoiceNumbers) {
  const year = new Date().getFullYear();
  // Common Polish faktura format: FV{year}/{month}/{seq}
  const month = String(new Date().getMonth() + 1).padStart(2, "0");
  const prefix = `FV${year}/${month}/`;
  let maxNum = 0;
  (allInvoiceNumbers || []).forEach(n => {
    const m = (n || "").match(new RegExp(`^FV${year}/\\d{2}/(\\d+)$`));
    if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
  });
  return `${prefix}${String(maxNum + 1).padStart(2, "0")}`;
}

// Parse the SO's payment terms string into days-from-invoice for the due date calc.
// Returns null if not parseable (user has to set due date manually).
function parsePaymentTermsDays(terms) {
  if (!terms) return null;
  const m = terms.match(/^(\d+)\s*days/i);
  if (m) return parseInt(m[1]);
  if (/cash/i.test(terms)) return 0;             // Cash on delivery / against documents
  if (/advance/i.test(terms)) return 0;          // Advance payment — already paid
  return null;
}

// Build a Sales Invoice (SINV) draft object from a Shipped SO.
// Mirrors the shape of invoice objects in Invoices.tsx (INIT_INVOICES seed there)
// so when integration happens, the object slots directly into the invoices state.
export function buildInvoiceFromSO(order, invoiceNumber, today, clientVatRate: any = null, sd: SalesData = EMPTY_SALES_DATA) {   // v7.18.7 (BP-46): + the client's default VAT rate
  const issueDate = today || localTodayISO();
  const saleDate = order.deliveryDate || issueDate; // when goods physically shipped
  const days = parsePaymentTermsDays(order.paymentTerms === "Other" ? order.paymentTermsOther : order.paymentTerms);
  let dueDate = "";
  if (days !== null) {
    dueDate = addDaysISO(issueDate, days);   // v6.99.122 (AUD-08): on the y-m-d parts — the clock change in March shifted it a day
  }
  // VAT — Polish food default is 5%, but it depends on product/destination.
  // We pre-fill 5% and flag for user review in the modal.
  const VAT_DEFAULT = clientVatRate !== null && clientVatRate !== undefined && clientVatRate !== "" && [0, 5, 8, 23].includes(Number(clientVatRate)) ? Number(clientVatRate) : 5;   // v7.18.7 (BP-46): the client's default when it has one
  const net = netTotal(order.items, sd);
  const vat = Math.round(net * VAT_DEFAULT) / 100;
  const gross = Math.round((net + vat) * 100) / 100;
  const fx = rateOf(order);

  return {
    // Generated on creation
    id: null,
    type: "SINV",
    number: invoiceNumber,
    issueDate,
    saleDate,
    dueDate,
    paymentMethod: "Transfer",
    counterparty: order.client,
    currency: order.currency,
    fxRate: fx,
    netAmount: net,
    vatRate: VAT_DEFAULT,
    vatAmount: vat,
    grossAmount: gross,
    netPLN: Math.round(net * fx * 100) / 100,
    grossPLN: Math.round(gross * fx * 100) / 100,
    linkedDocs: [{ type: "SO", number: order.number }],
    paymentStatus: "Draft",
    paidAmount: 0,
    notes: `Issued from ${order.number}${order.deliveryDate ? ` — Goods delivered ${order.deliveryDate}` : ""}.\nLines:\n${order.items.map(it => `• ${it.product}${it.variety ? " " + it.variety : ""} ${parseNum(it.qty || 0).toLocaleString("pl-PL")} kg @ ${parseNum(it.unitPrice || 0).toFixed(2)} ${order.currency}`).join("\n")}`,
    attachment: null,
    createdAt: issueDate,
    // SO traceability
    sourceSO: order.number,
  };
}

// Sourcing validation — every line must point to a stock lot or a PO before the SO
// can move past Draft. POs in any status count (including Draft) — the rule is about
// having a concrete procurement plan, not about the PO being final.
// Returns: { allSourced: bool, unsourcedIndexes: number[], blocked: bool }
export function validateSourcing(items) {
  const unsourcedIndexes = (items || [])
    .map((it, i) => (!it.sourceType || !it.sourceRef) ? i : null)
    .filter(i => i !== null);
  return {
    allSourced: unsourcedIndexes.length === 0,
    unsourcedIndexes,
  };
}


export function validatePOReadinessForSO(items: any[], sd: SalesData) {
  const blocked: any[] = [];
  (items || []).forEach((it: any, idx: number) => {
    // v6.99.127 (A-ONE-1): a line sells a LOT — its readiness is its PO's; the PO path stays for the old lines left on it
    const poNumber = it.sourceType === "STOCK" && it.sourceRef ? ((sd.rawLots || []).find((l: any) => String(l.number) === String(it.sourceRef)) || {}).poRef : null;
    if (!poNumber) return;
    const lot = it.sourceType === "STOCK" ? (sd.rawLots || []).find((l: any) => String(l.number) === String(it.sourceRef)) : null;
    if (lot && (parseNum(lot.physicalKg) > 0 || parseNum(lot.receivedKg) > 0)) return;   // received goods are ours whatever the PO says
    const po = sd.poRefs.find((p: any) => p.number === poNumber);
    if (!po || !isPOUsableForConfirmedSO(po)) {
      blocked.push({ idx, poRef: poNumber, status: po?.status || "Missing", product: it.product || "" });
    }
  });
  return blocked;
}

// ─── STOCK ACCOUNTING — single source of truth for "what's really available" ────
//
// The lot's stored `availableKg` is the ORIGINAL capacity when received. The live
// available pool is computed as:  originalKg − Σ(reservations from non-Cancelled, non-Draft SOs)
//
// Only pre-dispatch SO states reserve stock. Once an SO is Shipped or later,
// the stock should be represented by physical SHIP_OUT movements in Inventory, not
// by a still-open reservation. This keeps Sales Orders aligned with Inventory and
// prevents double-subtracting shipped quantities in integration mode.
// RESERVING_SO_STATUSES: canonical set imported from ./types (Batch 0).

// productsMatch/normalizeProduct: imported from ./salesOrders.domain (Batch 1).

// Returns: { liveAvailable, reservations: [{ soNumber, soId, status, qty }] }
// for a given lot, considering reservations from all SOs except `excludeOrderId`.
export function lotReservations(lot, allOrders, excludeOrderId, sd: SalesData) {
  return lotReservationsForPicker(lot, allOrders, excludeOrderId, reserveCtx(sd)); // engine: salesOrders.domain (Batch 1)
}

// Availability check — for each line, compute how much of its demanded qty is
// actually available across stock + PO sources matching the line's product, net of
// what OTHER non-Cancelled non-Draft SOs have already reserved from the same lots/POs.
//
// One source per line is the current data model, but we aggregate across:
//   (a) the line's own source (lot or PO line) for the headline figure
//   (b) ALL stock lots and PO lines matching the product, to give a "combined" pool
//
// Returns an array, one entry per line:
//   { lineQty, primaryAvailable, otherSourcesAvailable, combinedAvailable, overage, hasOverage }
// Detect when MULTIPLE lines in the SAME SO point at the same source (same lot, or
// same PO line). This catches the mistake of assigning one physical product twice
// within one order. Returns a map: sourceKey -> { indices:[...], totalQty, label }.
// Only sourced lines (STOCK/PO with a ref) are considered.
export function sameSoDuplicateSources(soItems) {
  const groups = {};
  (soItems || []).forEach((it, idx) => {
    if (!it.sourceType || !it.sourceRef) return;
    const key = `STOCK::${it.sourceRef}`;
    if (!groups[key]) groups[key] = { indices: [], totalQty: 0, sourceType: it.sourceType, sourceRef: it.sourceRef, sourceLineId: it.sourceLineId ?? 1 };
    groups[key].indices.push(idx);
    groups[key].totalQty += parseNum(it.qty) || 0;
  });
  // Keep only the groups that actually have more than one line (a real duplicate)
  const dups = {};
  Object.keys(groups).forEach(k => { if (groups[k].indices.length > 1) dups[k] = groups[k]; });
  return dups;
}

export function computeLineAvailability(soItems, allOrders, currentOrderId, sd: SalesData) {
  // Engine extracted to salesOrders.domain (Batch 1) — LOTS/PO_REFS passed explicitly.
  return domainComputeLineAvailability(soItems, allOrders, currentOrderId, sd.lots, sd.poRefs, sd.shipments);
} export { Inp }; export { Sel };   // v7.44.0 (AUD3 redundancy): one copy, in ui.tsx
export function StatusBadge({ status }: any) {
  const s = SO_STATUSES[status] || { bg: "#F3F4F6", color: "#6B7280" };
  return <span style={{ background: s.bg, color: s.color, padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{statusWord(status)}</span>;
}
export function QualityBadge({ quality }: any) {
  const palette = {
    "I":          { bg: "#DCFCE7", color: "#16A34A" },
    "IB":         { bg: "#ECFCCB", color: "#65A30D" },
    "II":         { bg: "#FEF3C7", color: "#D97706" },
    "Industrial": { bg: "#FEE2E2", color: "#991B1B" },
  };
  const p = palette[quality] || palette["I"];
  return <span style={{ background: p.bg, color: p.color, padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, fontFamily: "inherit", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>Kl. {quality}</span>;
}
export function SourceBadge({ sourceType, sourceRef, supplierName }: any) {
  if (!sourceType || !sourceRef) return <span style={{ fontSize: 10, color: "#AAA", fontStyle: "italic" }}>unsourced</span>;
  const isStock = sourceType === "STOCK";
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, fontFamily: "inherit", fontVariantNumeric: "tabular-nums",
        // v6.93.0 (A-R8-5, owner colour rule): informational source chip is GREEN — red is for cancelled/warnings only
        background: isStock ? "#E0F2FE" : "#F0FDF4",
        color: isStock ? "#0369A1" : "#166534",
      }}>
        {sourceRef}
      </span>
      {!isStock && supplierName && <span style={{ fontSize: 10, color: "#166534", paddingLeft: 2 }}>{supplierName}</span>}
    </span>
  );
}


// ─── LIFECYCLE BAR ────────────────────────────────────────────────────────
export function LifecycleBar({ status }: any) {
  const stages = ["Draft", "Confirmed", "Loading", "Shipped", "Delivered", "Invoiced", "Closed"]; // v6.79.0: Reserved dropped (W-1)
  const currentOrder = SO_STATUSES[status]?.order ?? 0;
  const isCancelled = status === "Cancelled";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {stages.map((s, i) => {
        const stageOrder = SO_STATUSES[s].order;
        const past = !isCancelled && stageOrder < currentOrder;
        const current = !isCancelled && stageOrder === currentOrder;
        return (
          <React.Fragment key={s}>
            <div style={{
              padding: "4px 9px", borderRadius: 14, fontSize: 10, fontWeight: 600,
              background: current ? SO_STATUSES[s].bg : (past ? "#F3F4F6" : "#FAFAFA"),
              color: current ? SO_STATUSES[s].color : (past ? "#374151" : "#CCC"),
              border: current ? `1px solid ${SO_STATUSES[s].color}` : "1px solid transparent",
              whiteSpace: "nowrap",
            }}>{past && "✓ "}{s}</div>
            {i < stages.length - 1 && <div style={{ width: 8, height: 1, background: past ? "#9CA3AF" : "#E5E7EB" }} />}
          </React.Fragment>
        );
      })}
      {isCancelled && <span style={{ marginLeft: 8, padding: "4px 9px", borderRadius: 14, fontSize: 10, fontWeight: 600, background: "#FEE2E2", color: "#DC2626" }}>✕ Cancelled</span>}
    </div>
  );
}


// ─── PRINTED SO DOC ───────────────────────────────────────────────────────
// Bilingual EN/PL, A4, logo top-left. Mirror of PODoc but with sales polarity:
// we are Sprzedawca (seller), client is Nabywca (buyer). No legal clause.
export function BiLbl({ en, pl, align = "left" }: any) {
  return (
    <div style={{ textAlign: align as React.CSSProperties["textAlign"], lineHeight: 1.1 }}>
      <div style={{ fontWeight: 700, fontSize: 10 }}>{en}</div>
      <div style={{ fontStyle: "italic", color: "#666", fontSize: 8.5 }}>{pl}</div>
    </div>
  );
}
export function PrintLogo() {
  return (
    <div style={{ background: "#fff", display: "inline-block" }}>
      <img src={LOGO_DATA_URL} alt="Marianna" style={{ width: 240, height: "auto", display: "block" }} />
    </div>
  );
}

// ─── PRINT MODAL ──────────────────────────────────────────────────────────
function PrintModal({ order, onClose }: any) {
  const { alert: pmAlert, dialogNode: pmNode } = useConfirm(); // P2-6 completion
  function printDoc() {
    const node = document.getElementById("so-print-doc");
    if (!node) { pmAlert({ tone: "warn", title: "Not ready", message: "Print preview not ready — please try again in a moment." }); return; }
    const existing = document.getElementById("so-print-frame");
    if (existing) existing.remove();
    const iframe = document.createElement("iframe");
    iframe.id = "so-print-frame";
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(iframe);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${order.number}</title>
<style>
  @page { size: A4; margin: 12mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: Calibri, Arial, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  #so-print-doc { width: 186mm; margin: 0 auto; }
  table { page-break-inside: avoid; border-collapse: collapse; }
  tr { page-break-inside: avoid; }
  img { max-width: 100%; }
</style></head><body>${node.outerHTML}</body></html>`;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) { iframe.remove(); return; }
    doc.open(); doc.write(html); doc.close();
    const fire = () => {
      const prevTitle = document.title; // v6.34.2: restore on afterprint, not 1s
      document.title = order.number || prevTitle;
      const restore = () => { document.title = prevTitle; iframe.remove(); };
      try { iframe.contentWindow?.focus(); const w = iframe.contentWindow as any; if (w) w.onafterprint = restore; iframe.contentWindow?.print(); } catch {}
      setTimeout(() => { if (document.title === (order.number || prevTitle)) restore(); }, 60000);
    };
    const img = doc.querySelector("img");
    if (img && !img.complete) {
      img.addEventListener("load", () => setTimeout(fire, 100));
      img.addEventListener("error", () => setTimeout(fire, 100));
      setTimeout(fire, 2000);
    } else {
      setTimeout(fire, 200);
    }
  }
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      {pmNode}
      <div style={{ background: "#fff", borderRadius: 14, width: "min(940px, 96vw)", maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #EBEBEB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Preview · {order.number}</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>A4 format · in the print dialog, set Destination to "Save as PDF"</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={printDoc} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #2563EB", background: "#2563EB", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Print</button>
            <button onClick={onClose} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Close</button>
          </div>
        </div>
        <div style={{ padding: 24, overflowY: "auto", background: "#ECECEC" }}>
          <div id="so-print-doc" style={{ background: "#fff", padding: "8mm", boxShadow: "0 2px 12px rgba(0,0,0,0.15)", width: "186mm", margin: "0 auto", boxSizing: "content-box" }}>
            <SODoc order={order} />
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── EMAIL MODAL ──────────────────────────────────────────────────────────
function bestContactEmail(cp: any) {
  const cs = peopleOf(cp);
  const withEmail = cs.find((p: any) => p.isPrimary && p.email) || cs.find((p: any) => p.email);
  return (withEmail && withEmail.email) || (cp && cp.email) || "";
}
function EmailModal({ order, contacts = [], onClose }: any) {
  const { alert: emAlert, dialogNode: emNode } = useConfirm(); // P2-6 completion
  // v6.18.14 (#1): resolve the client email LIVE from Contacts at send time.
  const sid = order && order.client && order.client.id;
  const liveClient = (sid != null) ? (contacts || []).find((c: any) => String(c.id) === String(sid)) : null;
  const recipient = bestContactEmail(liveClient) || order.client?.email || order.client?.contact || "";
  const [subject, setSubject] = useState(`Sales Order ${order.number} — ${COMPANY.name}`);
  const [body, setBody] = useState(`Dear ${order.client?.name || "Sir/Madam"},\n\nPlease find attached our Sales Order confirmation ${order.number} for ${order.items.map(i => `${fmtNum(i.qty)} kg ${i.product}${i.variety ? " " + i.variety : ""}`).join(", ")}.\n\nDelivery date: ${formatDMY(order.deliveryDate) || "TBA"}\nIncoterm: ${order.sellIncoterm}\nPayment: ${order.paymentTerms === "Other" ? order.paymentTermsOther : order.paymentTerms}${order.importPermitNo ? `\nImport permit no.: ${order.importPermitNo}` : ""}${order.acidNo ? `\nACID no.: ${order.acidNo}` : ""}\n\nPlease confirm receipt.\n\nBest regards,\n${COMPANY.name}`);

  function openPrintForPdf() {
    const node = document.getElementById("so-print-doc");
    if (!node) { emAlert({ tone: "warn", title: "Not ready", message: "Print preview not ready — please try again in a moment." }); return; }
    const existing = document.getElementById("so-email-print-frame");
    if (existing) existing.remove();
    const iframe = document.createElement("iframe");
    iframe.id = "so-email-print-frame";
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(iframe);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${order.number}</title>
<style>
  @page { size: A4; margin: 12mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: Calibri, Arial, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  #so-print-doc { width: 186mm; margin: 0 auto; }
  table { page-break-inside: avoid; border-collapse: collapse; }
  tr { page-break-inside: avoid; }
  img { max-width: 100%; }
</style></head><body>${node.outerHTML}</body></html>`;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) { iframe.remove(); return; }
    doc.open(); doc.write(html); doc.close();
    const fire = () => {
      const prevTitle = document.title; // v6.34.2: restore on afterprint, not 1s
      document.title = order.number || prevTitle;
      const restore = () => { document.title = prevTitle; iframe.remove(); };
      try { iframe.contentWindow?.focus(); const w = iframe.contentWindow as any; if (w) w.onafterprint = restore; iframe.contentWindow?.print(); } catch {}
      setTimeout(() => { if (document.title === (order.number || prevTitle)) restore(); }, 60000);
    };
    const img = doc.querySelector("img");
    if (img && !img.complete) {
      img.addEventListener("load", () => setTimeout(fire, 100));
      img.addEventListener("error", () => setTimeout(fire, 100));
      setTimeout(fire, 2000);
    } else {
      setTimeout(fire, 200);
    }
  }

  function openMailClient() {
    const mailto = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      {emNode}
      <div style={{ background: "#fff", borderRadius: 14, width: 620, maxHeight: "92vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #EBEBEB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Email SO to {order.client?.name}</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Two-step send · PDF download, then email draft</div>
          </div>
          <ActionButton action="close" onClick={onClose} />
        </div>
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ padding: "12px 14px", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, fontSize: 12, color: "#92400E", lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>How sending works</div>
            Sending takes two steps: save the SO as PDF, then open an email draft and attach the PDF manually.
          </div>
          <div><Lbl>TO</Lbl><Inp value={recipient || "(client email missing in Contacts)"} disabled style={{ background: "#F9FAFB", color: "#666" }} /></div>
          <div><Lbl>SUBJECT</Lbl><Inp value={subject} onChange={e => setSubject(e.target.value)} /></div>
          <div><Lbl>MESSAGE</Lbl><textarea value={body} onChange={e => setBody(e.target.value)} rows={10} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", outline: "none", resize: "vertical", lineHeight: 1.6 }} /></div>
          <div style={{ position: "absolute", left: -99999, top: 0 }}>
            <div id="so-print-doc" style={{ width: "186mm" }}>
              <SODoc order={order} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", borderTop: "1px solid #F3F4F6", paddingTop: 14, marginTop: 4 }}>
            <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button onClick={openPrintForPdf} style={{ padding: "8px 16px", borderRadius: 7, border: "1px solid #2563EB", background: "#fff", color: "#2563EB", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>① Save PDF</button>
            <button onClick={openMailClient} disabled={!recipient} title={!recipient ? "Client email missing in Contacts" : ""} style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: recipient ? "#16A34A" : "#D1D5DB", color: "#fff", fontSize: 13, fontWeight: 600, cursor: recipient ? "pointer" : "not-allowed" }}>② Open email draft →</button>
          </div>
        </div>
      </div>
    </div>
  );
}




// ─── ORDER FORM ───────────────────────────────────────────────────────────

// Batch 6b hard gate (SO side): the sale's contract to the CLIENT — sell
// incoterm + a resolved destination — gates confirm/print/email. This is also
// the foundation Phase B stands on: disposition derives from these terms.
function soTermsMissing(o: any): string | null {
  if (!o?.sellIncoterm) return "the sell incoterm";
  const mode = o.destinationMode || ((o.destinationLocationId || o.destinationText) ? "other" : "client");
  if (mode === "client") {
    if (!(o.destinationLocationId || (o.client?.address || "").trim())) return "the client's site (or pick another destination)";   // v7.18.1 (A-AU-3)
    return null;
  }
  if (!(o.destinationLocationId || (o.destinationText || "").trim())) return `the destination for ${o.sellIncoterm}`;
  return null;
}




// ─── MAIN — LIST VIEW + ROUTER ────────────────────────────────────────────

function CollectionModal({ so, onClose, onSave }: any) {
  const [date, setDate] = useState(localTodayISO());
  const [truckPlate, setTruckPlate] = useState("");
  const [driverName, setDriverName] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 8000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: 440, maxWidth: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.25)", padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Record client collection — {so.number}</div>
        <div style={{ fontSize: 11, color: "#64748B", marginBottom: 12 }}>EXW: the client collects the goods. This creates a minimal collection shipment (no transport order, no freight on our side) and, on Delivered, ships the sourced lots out of inventory.</div>
        <Lbl>Collection date</Lbl>
        <DateInput value={date} onChange={e => setDate(e.target.value)} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", fontSize: 12, marginBottom: 10, fontFamily: "inherit" }} />
        <Lbl>Client truck plate (optional)</Lbl>
        <input value={truckPlate} onChange={e => setTruckPlate(e.target.value)} placeholder="e.g. WZ 12345" style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", fontSize: 12, marginBottom: 10, fontFamily: "inherit" }} />
        <Lbl>Driver (optional)</Lbl>
        <input value={driverName} onChange={e => setDriverName(e.target.value)} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", fontSize: 12, marginBottom: 10, fontFamily: "inherit" }} />
        <Lbl>Note (optional)</Lbl>
        <input value={notes} onChange={e => setNotes(e.target.value)} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", fontSize: 12, marginBottom: 14, fontFamily: "inherit" }} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
          <button onClick={() => onSave({ date, truckPlate, driverName, notes })} style={{ padding: "7px 12px", borderRadius: 7, border: "none", background: "#0369A1", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Create collection record</button>
        </div>
      </div>
    </div>
  );
}

function SalesOrdersScreen({ archive = null,
  claims: extClaims = [],
  setClaims: extSetClaims = null,
  orders: extOrders, setOrders: extSetOrders,
  invLots: extInvLots, setLots: extSetLots, allPOs: extPOs, shipments: extShipments = [], setShipments: extSetShipments = null,
  contacts: extContacts,
  packagingTypes = [], setPackagingTypes = null,   // v7.18.0 (A-AU-1)
  operationalCosts: extOperationalCosts = [],
  invoices: extInvoices = null, setInvoices: extSetInvoices = null,
  financeNotes: extFinanceNotes = [], setFinanceNotes: extSetFinanceNotes = null, inspections: extInspections = [],
  canOpenResult = false, onOpenResult = null,   // v7.1.3 (A-PL-1)
  userName = "",
  productCatalog = [],
  setProductCatalog,
  onStartClaim = null,
  initialSelectedNumber = "",
  initialView = "",
}: any = {}) {
  const sd = useSalesData();   // v7.22.4 (A-RV-16): the data comes from the module's context, not a hidden module copy
  const { confirm: uiConfirm, alert: uiAlert, dialogNode: soDialogNode } = useConfirm(); // P2-6
  // v6.35.1: cancelled document numbers (POs, SOs, shipments) for struck-through refs.
  const cancelledRefs = cancelledDocSet(extPOs, extOrders, extShipments);
  // Integration mode: shell owns SO state. Standalone: local state with seed.
  const [localOrders, setLocalOrders] = useState<any[]>([]); // v6.32.0 (R7b-5): demo seed removed from bundle
  // v6.33.0 (A3-6): the Invoices register is the sole owner of invoices — this
  // module reads and writes THERE, never into order.pendingInvoices.
  const [localInvoices, setLocalInvoices] = useState<any[]>([]);
  const invoices = extInvoices ?? localInvoices;
  const setInvoices = extSetInvoices ?? setLocalInvoices;
  const invoicesForSO = (soNumber: any) => (invoices || []).filter((iv: any) =>
    (iv.links || []).some((l: any) => l.type === "SO" && String(l.number) === String(soNumber)));
  const orders = extOrders ?? localOrders;
  const setOrders = extSetOrders ?? setLocalOrders;

  // v6.9: read-only Fakturownia sales-invoice matching
  const fktCfg = readFakturowniaConfig();
  const fktConfigured = !!fktCfg;
  const [fktMatching, setFktMatching] = useState(false);
  const [fktMatchMsg, setFktMatchMsg] = useState(null);
  async function matchInvoicesFromFakturownia(order) {
    if (!fktCfg) return;
    setFktMatching(true); setFktMatchMsg(null);
    const r = await fetchInvoices(fktCfg, { income: 1, period: "this_year" });
    setFktMatching(false);
    if (!r.ok) { setFktMatchMsg({ kind: "error", text: r.error || "Fetch failed."   /* v7.21.1 (AUD-49) */ }); return; }
    const fktList = (r.data || []).map(mapInvoice);
    let matched = 0;
    // v6.33.0 (A3-6): the match result is written on the REGISTER invoices
    // linked to this SO (fakturownia.*), never on the order.
    setInvoices((prev: any[]) => (prev || []).map((reg: any) => {
      const linksThisSO = (reg.links || []).some((l: any) => l.type === "SO" && String(l.number) === String(order.number));
      if (!linksThisSO || reg.kind !== "SALES") return reg;
      // match by exact invoice number, else by client tax id + gross amount
      let hit = fktList.find(iv => String(iv.number).trim() === String(reg.number).trim());
      if (!hit) {
        hit = fktList.find(iv => {
          const amtClose = Math.abs((iv.grossTotal || 0) - (reg.grossAmount || 0)) < 1;
          const taxMatch = order.client?.nip && iv.buyerTaxNo && String(iv.buyerTaxNo).replace(/\D/g, "") === String(order.client.nip).replace(/\D/g, "");   // v7.16.5 (A-RV-14): the same tax id, not one that contains it
          return amtClose && taxMatch;
        });
      }
      if (!hit) return reg;
      matched++;
      // v7.16.5 (A-RV-14 · rule 11): the bank is the only source of payment — Fakturownia's paid flag, and its status (which can say "paid"), are not kept
      const { paid: _fktPaid, status: _fktStatus, ...fk } = (reg.fakturownia || {}) as any;
      return { ...reg, locked: true, fakturownia: { ...fk, exported: true, legalNumber: hit.number, ksef: hit.ksefNo || "" } };
    }));
    setFktMatchMsg({ kind: matched ? "success" : "error", text: matched ? `Matched ${matched} invoice(s) from Fakturownia.` : "No matching invoice found in Fakturownia for this SO yet." });
  }

  const termsAll = useMemo(() => termsToReview({ pos: extPOs || [], orders: orders || [], shipments: extShipments || [], claims: extClaims || [], contacts: extContacts || [], lots: extInvLots || [], placeOf: (id: any) => locationById(id, extContacts || []) }), [extPOs, orders, extShipments, extClaims, extContacts, extInvLots]);   // v7.20.0 (A-INC-2)
  const clients = useMemo(() => clientsFromContacts((extContacts || []).filter((c: any) => !c.archived && !c.deleted)), [extContacts]); // v6.99.2 (CP-4): archived parties leave the picker

  // v6.99.35: an order can be opened directly (deep link, and the render smoke exercises the EDITOR, where the regression was)
  const openDirect = (extOrders || []).find((o: any) => String(o.number) === String(initialSelectedNumber)) || null;
  const [view, setView] = useState(openDirect ? (initialView || "detail") : "list"); // list | form | detail
  const [selected, setSelected] = useState<any>(openDirect);
  const [form, setForm] = useState<any>(openDirect && initialView === "form" ? { ...openDirect } : null);
  const [printOrder, setPrintOrder] = useState(null);
  const [emailOrder, setEmailOrder] = useState(null);
  const [invoiceOrder, setInvoiceOrder] = useState(null); // SO being invoiced via the modal
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterClient, setFilterClient] = useState("All");

  // v6.33.0 (A3-6): numbering sees the WHOLE Invoices register (an SINV created
  // directly in the Invoices module previously wasn't seen here — latent number
  // collision), plus linkedInvoices as belt-and-braces for pre-register data.
  function allInvoiceNumbers() {
    return [
      ...(invoices || []).map((iv: any) => iv.number),
    ].filter(Boolean);
  }

  // Product suggestions, same pattern as PO
  // v6.99.54 (AR-4, owner): the day-to-day lists show the CURRENT season; archived documents appear only with "include archived".
  const archiveShow = (doc: any) => !archive || archive.includeArchived || !isArchived("so", doc, archive.archivedSeasons || [], archive.settings || DEFAULT_SEASON, { pos: archive.pos || [] });
  const productSuggestions = useMemo((): string[] => {
    const seed: string[] = ["Golden Delicious", "Red Bell Pepper", "Yellow Bell Pepper", "Green Bell Pepper", "Papryka Kapia", "Tomato Round", "Tomato Cherry", "Carrot", "Cucumber", "Courgette", "Onion Yellow", "Potato", "Garlic", "Cauliflower", "Broccoli", "Lettuce Iceberg", "Cabbage"];
    const fromOrders: string[] = orders
      .flatMap((o: any) => (o.items || []).map((i: any) => String(i.product || "").trim()))
      .filter((value: string) => value.length > 0);
    const seen = new Map<string, string>();
    [...fromOrders, ...seed].forEach((product: string) => {
      const key = product.toLowerCase();
      if (!seen.has(key)) seen.set(key, product);
    });
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [orders]);

  // KPIs
  const activeStatuses = new Set(["Draft", "Confirmed", "Loading", "Shipped"]);
  const activeCount = orders.filter(o => activeStatuses.has(o.status)).length;
  const deliveredNotInvoicedCount = orders.filter(o => effectiveSoStatus(o, sd.shipments) === "Delivered").length; // v6.79.0 (W-1)
  const activeValuePLN = orders
    .filter(o => activeStatuses.has(o.status))
    .reduce((sum, o) => sum + netTotal(o.items, sd) * rateOf(o), 0);
  const upcomingDeliveryCount = orders.filter(o => {
    if (!o.deliveryDate || !activeStatuses.has(o.status)) return false;
    const days = Math.floor((new Date(o.deliveryDate).getTime() - Date.now()) / 86400000);
    return days >= 0 && days <= 7;
  }).length;

  // Filter
  const filtered = orders.filter(o => archiveShow(o) &&   /* v6.99.54 (AR-4) */
    (!search || o.number.toLowerCase().includes(search.toLowerCase()) || (o.client?.name || "").toLowerCase().includes(search.toLowerCase()) || o.items.some(it => (it.product || "").toLowerCase().includes(search.toLowerCase()) || (it.sourceRef || "").toLowerCase().includes(search.toLowerCase()))) &&
    (filterStatus === "All" ? o.status !== "Cancelled" : o.status === filterStatus) &&   // v6.99.106 (A-DEL-4): deleted records show only under the Deleted entry
    (filterClient === "All" || o.client?.name === filterClient)
  );

  // Handlers
  function newOrder() {
    setForm({
      id: null,
      number: nextSONumber(orders),
      status: "Draft",
      createdBy: userName || "",   // v7.21.5 (SE-4): the person signed in — never the old per-browser role ("General Manager")
      orderDate: localTodayISO(),
      deliveryDate: "",
      promisedDateMeans: "Delivery to client",
      actualDeliveryDate: null,
      importPermitNo: "",
      acidNo: "",
      paymentTerms: "30 days from invoice date",
      paymentTermsOther: "",
      sellIncoterm: "",   // v7.22.3 (FZ-21): no term assumed — the user chooses one of the 11 Incoterms 2020 rules
      client: null,
      destinationLocationId: null,
      destinationText: "",
      currency: "PLN", fxRate: 1, fxLockedAt: null,
      items: [{ id: nextId(), product: "", variety: "", cnCode: "", origin: "", size: "", quality: "I", unit: "Kg", qty: "", pallets: "", unitPrice: "", sourceType: null, sourceRef: "", sourceLineId: null, packaging: "" }],
      notes: "",
      
    });
    setView("form");
  }

  function reverseCancelledSOInInventory(order) {
    // Cancelling an SO already releases reservations automatically because Cancelled is not a reserving status.
    // This function additionally reverses any physical SHIP_OUT movement that was already posted for this SO.
    if (!extSetLots || !order) return;
    const today = localTodayISO();
    extSetLots(prevLots => prevLots.map(lot => {
      // v6.30.1: direct pass-through lots (IN+SHIP_OUT pair, never our stock) must
      // NOT be restored: adding a REVERSAL here pushed physicalKg above zero on a
      // lot that was never in our warehouse — phantom stock the availability engine
      // would then offer for sale. Goods physically delivered straight to a client
      // come back via a return shipment (purpose RETURN) or a claim, not a cancel.
      const isDirectLot = !!lot.directFlow || lot.custodyType === "Direct"
        || lot.status === "Direct Expected" || lot.status === "Delivered (direct)";
      if (isDirectLot) return lot;

      const alreadyReversed = (lot.movements || []).some(m => m.type === "REVERSAL" && (m.soRef ? String(m.soRef) === String(order.number) : String(m.note || "").includes(order.number)));
      if (alreadyReversed) return lot;

      let qtyToRestore = 0;
      (order.items || []).forEach(it => {
        const lineQty = parseNum(it.qty) || 0;
        let matchesLot = false;
        if (it.sourceType === "STOCK" && it.sourceRef === lot.number) matchesLot = true;
        // v6.32.0 (A1): poLineId-first + variety-aware (was product-name only)
        
        if (!matchesLot) return;

        const shippedForSO = (lot.movements || [])
          .filter(m => m.type === "SHIP_OUT" && (m.soRef ? String(m.soRef) === String(order.number) : String(m.note || "").includes(order.number)))
          .reduce((sum, m) => sum + (parseNum(m.qtyKg) || 0), 0);
        if (shippedForSO > 0) qtyToRestore += Math.min(lineQty || shippedForSO, shippedForSO);
      });

      if (qtyToRestore <= 0) return lot;
      const reversal = {
        id: nextId(),
        date: today,
        type: "REVERSAL",
        qtyKg: qtyToRestore,
        fromId: lot.locationId,
        toId: lot.locationId,
        soRef: order.number,
        note: `Inventory reversal for cancelled ${order.number}`,
      };
      const nextPhysical = (parseNum(lot.physicalKg) || 0) + qtyToRestore;
      return {
        ...lot,
        physicalKg: nextPhysical,
        status: lot.status === "Shipped Out" ? "In Stock" : lot.status,
        movements: [...(lot.movements || []), reversal],
      };
    }));
  }

  async function saveOrder(o) {
    // v6.99.46 (A-PO-11): the stored boxes / pallets ARE the effective counts (derived from the line's packaging unless
    // overridden), so every reader downstream — totals, shipments, protocol, invoices — sees one figure.
    o = { ...o, items: (o.items || []).map((it: any) => { const ec = effectiveCounts(it, sd.packagingTypes || []); const isBoxUnit = String(it.pricingUnit || "kg") !== "kg"; return { ...it, boxes: isBoxUnit ? it.boxes : (ec.boxes ?? it.boxes ?? null), pallets: ec.pallets ?? it.pallets ?? null }; }) };
    // v6.65.0 (D-18): kilos are the single stored quantity (v6.61 ruling), so a
    // box-priced line must land in storage with its derived kg in `qty` and its
    // box weight in `kgPerBox` — every engine (reservations, margin, settlement,
    // allocation) reads those raw fields and must never learn about boxes.
    o = { ...o, items: (o.items || []).map((it: any) => {
      if (pricingUnitOf(it) !== "box") return it;
      const kgPerBox = kgPerBoxForLine(it, sd.packagingTypes);
      if (kgPerBox <= 0) return it; // unresolved — the form already warns loudly
      const boxes = Math.round(parseNum(String(it.boxes || 0)) || 0);
      return { ...it, kgPerBox, qty: Math.round(boxes * kgPerBox * 1000) / 1000 };
    }) };
    // Batch 6b: hard confirm-gate — no SO past Draft without its sell terms.
    const termsMissing = soTermsMissing(o);
    if (!["Draft", "Cancelled"].includes(o.status) && termsMissing) {
      await uiAlert({ tone: "warn", title: "Terms incomplete", message: `This SO cannot move to ${o.status} without ${termsMissing}. A term without its named place is only half the contract.` });
      return;
    }

    // Duplicate number guard
    // v7.27.8 (A-W5): a NEW order takes its number from the shared counter when it is saved — the form showed a provisional one
    if (o.id == null) { const yr = parseInt(String(o.orderDate || localTodayISO()).slice(0, 4), 10) || new Date().getFullYear(); o = { ...o, number: await issueNumber("SO", yr, (orders || []).map((x: any) => x.number)) }; }
    const dup = orders.find(p => p.number === o.number && p.id !== o.id);
    if (dup) { await uiAlert({ tone: "warn", title: "Duplicate SO number", message: `SO number ${o.number} already exists.` }); return; }
    // v6.3.0: import-document duplicate guard. Import permits and ACID numbers are
    // single-use — re-using one across orders/shipments risks customs rejection.
    // Block by default; allow an explicit, recorded override.
    {
      const conflicts: any[] = [];
      (["importPermitNo", "acidNo"] as const).forEach(field => {
        const v = String(o[field] || "").trim();
        if (!v || v.toLowerCase() === "n/a") return;
        orders.forEach(p => {
          if (p.id === o.id) return;
          if (String(p[field] || "").trim().toLowerCase() !== v.toLowerCase()) return;
          const linkedShipments = (extShipments || [])
            .filter((sh: any) => (sh.soRefs || []).includes(p.number))
            .map((sh: any) => sh.number);
          conflicts.push({ field, value: v, soNumber: p.number, shipments: linkedShipments });
        });
      });
      if (conflicts.length) {
        const label = (f: string) => f === "importPermitNo" ? "Import permit" : "ACID number";
        const lines = conflicts.map(c =>
          `• ${label(c.field)} "${c.value}" already used on ${c.soNumber}${c.shipments.length ? ` (shipment${c.shipments.length > 1 ? "s" : ""} ${c.shipments.join(", ")})` : ""}`
        ).join("\n");
        // v6.92.0 (A-R8-3, owner ruling): import permit and ACID numbers are UNIQUE per SO — a hard block, no override.
        await uiAlert({ tone: "danger", title: "Duplicate import document number", message: `${lines}\n\nImport permits and ACID numbers are single-use: this SO cannot be saved with a number already used on another order. Correct the number.` });
        return;
      }
    }
    // Sourcing rule guard — defensive, even though the UI already blocks this
    const src = validateSourcing(o.items);
    const needsSource = !src.allSourced && o.status !== "Draft" && o.status !== "Cancelled";
    if (needsSource) {
      await uiAlert({ tone: "warn", title: "Lines unsourced", message: `Cannot save SO as ${o.status} — ${src.unsourcedIndexes.length} line(s) unsourced. Pick a lot for every line first (expected, in stock or direct), or save as Draft.` });
      return;
    }
    const poIssues = validatePOReadinessForSO(o.items, sd);
    if (poIssues.length && o.status !== "Draft" && o.status !== "Cancelled") {
      const poDetails = poIssues.map((x: any) => `• Line ${x.idx + 1}: ${x.poRef} (${x.status})`).join("\n");
      await uiAlert({ tone: "warn", title: "Source PO not usable", message: `Cannot save SO as ${o.status} because it refers to a PO that is Draft, Cancelled or missing:\n\n${poDetails}\n\nConfirm the PO first, choose another source, or keep the SO as Draft.` });
      return;
    }
    // Availability guard — same hard rule, parallel to sourcing.
    // Can't promise to a client what we cannot supply (from stock or any PO).
    const avail = computeLineAvailability(o.items, orders, o.id, sd);
    const overCount = avail.filter(a => a.hasOverage).length;
    const needsSupply = overCount > 0 && o.status !== "Draft" && o.status !== "Cancelled";
    if (needsSupply) {
      const details = avail
        .map((a: any, i: number) => a.hasOverage ? `  • Line ${i + 1}: short by ${a.overage.toLocaleString("pl-PL")} kg (demand ${a.lineQty.toLocaleString("pl-PL")} kg, primary source available ${a.primaryAvailable.toLocaleString("pl-PL")} kg)` : null)
        .filter((value: string | null): value is string => typeof value === "string")
        .join("\n");
      await uiAlert({ tone: "warn", title: "Over available supply", message: `Cannot save SO as ${o.status} — ${overCount} line(s) exceed available supply:\n\n${details}\n\nReduce qty, switch source, or arrange more procurement.` });
      return;
    }
    // Detect Shipped transition — compare incoming status with previously-saved one.
    // If this is the moment the SO becomes Shipped (and no invoice has been created yet
    // for this SO), open the InvoiceCreationModal as a follow-up.
    const previous = orders.find(p => p.id === o.id);
    const becameShipped = o.status === "Shipped" && (!previous || previous.status !== "Shipped");
    const becameCancelled = o.status === "Cancelled" && (!previous || previous.status !== "Cancelled");
    const alreadyInvoiced = (invoicesForCounterpartyDoc(o.number, "SO", extInvoices || []).length > 0)   /* v7.28.5 (Batch L): from the register, not a stored copy */
      || invoicesForSO(o.number).some((iv: any) => iv.paymentStatus !== "Cancelled"); // v6.80.0 (D-44): a cancelled invoice frees the order

    const savedOrder = { ...o, id: o.id ?? nextId() };
    recordAudit({ module: "Sales orders", docType: "SO", docNumber: savedOrder.number, action: o.id == null ? "created" : "saved", summary: `SO ${o.id == null ? "created" : "saved"} (${savedOrder.status || "Draft"}${savedOrder.sellIncoterm ? " · " + savedOrder.sellIncoterm : ""})` });
    setOrders(prev => {
      const exists = prev.find(p => p.id === savedOrder.id);
      if (exists) return prev.map(p => p.id === savedOrder.id ? savedOrder : p);
      return [...prev, savedOrder];
    });
    setView("list");
    notifySaved(String(o?.number || ""));   // v6.99.69 (A-CF-3)
    setForm(null);

    // Open the invoice creation modal if applicable. Use the same saved id that
    // was written to state; calling Date.now() twice could link the invoice to
    // an SO id that was never saved.
    if (becameShipped && !alreadyInvoiced) {
      setTimeout(() => setInvoiceOrder(savedOrder), 100);
    }
    if (becameCancelled) {
      reverseCancelledSOInInventory(savedOrder);
    }
  }
  function editOrder(o) {
    setForm({ ...o });
    setView("form");
  }
  function openDetail(o) {
    setSelected(o);
    setView("detail");
  }
  // Batch 3b (decision 2): EXW client collection — one click creates the minimal
  // collection shipment (purpose OUTBOUND, responsibility Client, no legs/TO/freight).
  const [collectionFor, setCollectionFor] = useState<any>(null);
  const [clientClaimFor, setClientClaimFor] = useState<any>(null); // v6.36.2 (P3)
  const [cc, setCc] = useState<any>({ lotId: "", qty: "", value: "", cur: "PLN", note: "" });

  // v6.36.2 (P3): client claim recorded FROM THE SO — appends a CLAIM movement to the
  // sourced lot (stock untouched; those kg already left) and drafts an outgoing credit
  // note, exactly like the Inventory quality-flow path.
  async function saveClientClaim() {   // v7.27.8 (A-W5): async — the claim number comes from the counter
    const soDoc = clientClaimFor; if (!soDoc) return;
    const lotsAll = extInvLots || [];
    const lot = lotsAll.find((l: any) => String(l.id) === String(cc.lotId));
    const amt = parseNum(cc.value) || 0;
    if (!lot || amt <= 0) return;
    const qty = parseNum(cc.qty) || 0;
    const today = domainToday();
    const mv = { id: nextId(), date: today, type: "CLAIM", qtyKg: qty, soRef: soDoc.number, claimValue: amt, claimCurrency: cc.cur || "PLN", note: cc.note || `Client claim on ${soDoc.number}`, source: `claim:so:${soDoc.id}:${Date.now()}` };
    if (extSetLots) extSetLots((prev: any[]) => (prev || []).map((l: any) => l.id === lot.id ? { ...l, movements: [...(l.movements || []), mv], claimedKg: (parseNum(l.claimedKg) || 0) + qty } : l));
    // v6.48.0 (Phase 1): a client claim is now a numbered DOCUMENT, not just a
    // movement. Previously it had no number, no status and nothing to cite in
    // correspondence — half the claim population was invisible as documents.
    const clmNo = await issueNumber("CLM", new Date(localTodayISO()).getFullYear() || new Date().getFullYear(), (extClaims || []).map((x: any) => x.number));   // v7.27.8 (A-W5)
    if (typeof extSetClaims === "function") {
      extSetClaims((prev: any[]) => {
        const list = prev || [];
        const number = clmNo || nextClaimNumber(list, new Date(today).getFullYear() || 2026);
        return [...list, {
          ...blankClaim(),
          id: nextId(), number,
          direction: "CONCESSION",
          respondent: { kind: "Client", contactId: null, name: soDoc.client?.name || "" },
          cause: "Quality defect",
          subjects: [
            { kind: "LOT", ref: lot.number, affectedKg: qty || undefined },
            { kind: "SO", ref: soDoc.number },
          ],
          date: today,
          requestedAmount: 0,
          status: "Submitted",
          movementRef: mv.id,
          notes: [cc.note || "", `Credit ${amt} ${cc.cur || "PLN"} requested`].filter(Boolean).join(" · "),
        }];
      });
    }
    if (extSetFinanceNotes) {
      const inv = (extInvoices || []).find((i: any) => i.kind === "SALES" && i.paymentStatus !== "Cancelled" && (i.links || []).some((lk: any) => String(lk.number) === String(soDoc.number)));
      const cur = cc.cur || inv?.currency || soDoc.currency || "PLN";
      const fx = defaultFxRate(cur);
      requestNoteInInvoices({   // v7.34.0 (CN-2): created in Invoices, on its own form
        noteType: "CREDIT", direction: "outgoing",
        invoiceId: inv?.id ?? null, relatedRef: soDoc.number, partyId: inv?.counterparty?.id ?? soDoc.client?.id ?? null, partyName: inv?.counterparty?.name || soDoc.client?.name || "",
        category: "Quality", amount: amt, currency: cur, fxRate: fx, amountPLN: Math.round(amt * fx * 100) / 100,
        status: "Draft", reason: `Client quality claim — ${qty ? qty + " kg " : ""}on ${lot.number} (${soDoc.number})`,
        date: today, source: mv.source,
      });
    }
    recordAudit({ module: "Sales orders", docType: "SO", docNumber: soDoc.number, action: "claim", summary: `Client claim recorded on ${lot.number} — ${amt.toLocaleString("pl-PL")} ${cc.cur || "PLN"}; credit note drafted` });
    setClientClaimFor(null);
  }

  async function recordCollection(info) {
    if (!extSetShipments) { await uiAlert({ tone: "warn", title: "Unavailable", message: "Shipments store not available." }); return; }
    const number = await issueNumber("SHP", new Date().getFullYear(), (extShipments || []).map((x: any) => x.number));   // v7.27.8 (A-W5)
    const built = buildCollectionShipment(collectionFor, extInvLots || [], extShipments, { ...info, number }, { todayISO: domainToday, nextId });
    if (!built.goods.length) { await uiAlert({ tone: "warn", title: "Nothing to collect", message: "No sourced lines found — source the SO lines from stock or a PO first, then record the collection." }); return; }
    extSetShipments(prev => [built, ...(prev || [])]);
    /* v7.28.5 (Batch L): the SO no longer stores a copy of its shipments — they are worked out from the shipments */
    setCollectionFor(null);
  }

  // v6.99.99 (A-DEL-4, owner ruling 2 Oct): ONE Delete — the SO stays on record (shown "Deleted"), struck through, read-only;
  // blocked while anything depends on it, the dependants named by number.
  function soDependants(so: any): string[] {
    const no = so.number; const out: string[] = [];
    (extShipments || []).filter((sh: any) => sh && sh.status !== "Cancelled" && ((sh.soRefs || []).includes(no) || String(sh.governingSoRef) === String(no) || (sh.goods || []).some((g: any) => String(g.soRef) === String(no)))).forEach((sh: any) => out.push(sh.number));
    (extInvoices || []).filter((i: any) => i && i.paymentStatus !== "Cancelled" && (i.links || []).some((l: any) => l.type === "SO" && String(l.number) === String(no))).forEach((i: any) => out.push(i.number));
    ((extClaims as any[]) || []).filter((c: any) => c && c.status !== "Cancelled" && (String(c.soRef) === String(no) || String(c.orderRef) === String(no))).forEach((c: any) => out.push(c.number));
    return out;
  }
  async function deleteOrder() {
    const deps = soDependants(selected);
    if (deps.length) { await uiAlert({ tone: "warn", title: `${selected.number} can't be deleted`, message: `These documents depend on it — delete them first:\n\n${deps.join("\n")}` }); return; }
    if (!(await uiConfirm({ tone: "danger", title: `Delete ${selected.number}?`, message: "Reservations will be released. The order stays on record, struck through and read-only.", confirmLabel: "Delete", cancelLabel: "Keep" }))) return;
    const cancelled = { ...selected, status: "Cancelled", cancelledAt: localTodayISO() };
    reverseCancelledSOInInventory(cancelled);
    setOrders(prev => prev.map(p => p.id === selected.id ? cancelled : p));
    setSelected(null);
    setView("list");
  }
  // v6.33.0 (A3-6): confirm handler writes the canonical invoice into the
  // Invoices REGISTER (sole owner) — order.pendingInvoices is never written
  // again. The SO keeps only the number cross-reference in linkedInvoices and
  // advances to Invoiced.
  function confirmInvoiceCreation(draft) {
    const targetId = invoiceOrder.id;
    // v7.26.4 (A-INV-4): the invoice's notes filled from the sale, its shipments and lots (editable in Invoices before it is issued)
    const notes = exportNotesForSale(invoiceOrder, { shipments: sd.shipments, lots: sd.rawLots && sd.rawLots.length ? sd.rawLots : sd.lots, deliveryPlace: destinationDisplay(invoiceOrder),
    fromPoland: isFromPoland(invoiceOrder, sd.shipments, (id: any, custom: any) => String((locationById(id, sd.contacts) as any)?.country || custom?.country || "")) });
    const canonical = { ...salesInvoiceFromSODraft(invoiceOrder, draft), invoiceNotes: notes };
    setInvoices((prev: any[]) => [...(prev || []), canonical]);
    // #4: issuing the invoice advances the SO to "Invoiced" (from Shipped/Delivered).
    // Closed stays Closed; earlier stages aren't forced forward.
    const advance = (st: string) => (["Shipped", "Delivered"].includes(st) ? "Invoiced" : st);
    // v6.80.0 (D-44/W-8): no stored link array — the register is the truth; a clear result message.
    const patch = (p: any) => ({ ...p, status: advance(p.status) });
    setOrders(prev => prev.map(p => p.id === targetId ? patch(p) : p));
    if (selected && selected.id === targetId) setSelected(prev => patch(prev));
    setInvoiceOrder(null);
    uiAlert({ tone: "info", title: "Sales invoice created", message: `${canonical.number || "Draft invoice"} is now in the Invoices module (status Draft). Next steps there: Mark issued → Send to Fakturownia. The SO shows it under INVOICES.` });
  }

  // Routes
  if (view === "form" && form) {
    return (
      <>
        {soDialogNode}
        {printOrder && <PrintModal order={printOrder} onClose={() => setPrintOrder(null)} />}
        {emailOrder && <EmailModal order={emailOrder} contacts={extContacts} onClose={() => setEmailOrder(null)} />}
        {invoiceOrder && <InvoiceCreationModal order={invoiceOrder} existingInvoiceNumbers={allInvoiceNumbers()} onCancel={() => setInvoiceOrder(null)} onConfirm={confirmInvoiceCreation} />}
        <OrderForm
          order={form} setOrder={setForm}
          productSuggestions={productSuggestions}
          allOrders={orders}
          clients={clients}
          contacts={extContacts}
          productCatalog={productCatalog}
          setProductCatalog={setProductCatalog}
          setPackagingTypes={setPackagingTypes}
          onSave={saveOrder}
          onCancel={() => { setView("list"); setForm(null); }}
          onPrint={async () => {
            if (form.status === "Draft") {
              await uiAlert({ tone: "warn", title: "Draft SO", message: "Cannot print or share a draft SO. Confirm the order first." });
              return;
            }
            { const _m = soTermsMissing(form); if (_m) { await uiAlert({ tone: "warn", title: "Terms incomplete", message: `Cannot print this SO without ${_m} — the client must see the delivery terms.` }); return; } }
            setPrintOrder(form);
          }}
          onEmail={async () => {
            if (form.status === "Draft") {
              await uiAlert({ tone: "warn", title: "Draft SO", message: "Cannot email a draft SO. Confirm the order first." });
              return;
            }
            { const _m = soTermsMissing(form); if (_m) { await uiAlert({ tone: "warn", title: "Terms incomplete", message: `Cannot email this SO without ${_m} — the client must see the delivery terms.` }); return; } }
            setEmailOrder(form);
          }}
         allInvoices={extInvoices} />
      </>
    );
  }
  if (view === "detail" && selected) {
    return (
      <>
        {soDialogNode}
        {/* v6.99.15 (A-R11-6): the client-collection dialog was mounted only in the list view — pressing the button in the detail did nothing */}
        {collectionFor && <CollectionModal so={collectionFor} onClose={() => setCollectionFor(null)} onSave={recordCollection} />}
        {printOrder && <PrintModal order={printOrder} onClose={() => setPrintOrder(null)} />}
        {emailOrder && <EmailModal order={emailOrder} contacts={extContacts} onClose={() => setEmailOrder(null)} />}
        {invoiceOrder && <InvoiceCreationModal order={invoiceOrder} existingInvoiceNumbers={allInvoiceNumbers()} onCancel={() => setInvoiceOrder(null)} onConfirm={confirmInvoiceCreation} />}
        <OrderDetail
          order={selected}
          onChangeRule={async (r: any) => { if (!(await uiConfirm({ title: `Change ${r.doc} to ${r.to}?`, message: `The rule on ${r.doc} becomes ${r.to} (Incoterms 2020) — what the shipment records fits it. Prices and documents already issued are not changed.`, confirmLabel: `Change to ${r.to}` }))) return; setOrders((prev: any[]) => (prev || []).map((x: any) => String(x?.number) === String(r.doc) ? { ...x, sellIncoterm: r.to } : x)); }}   // v7.29.1 (FZ-41): one click, after confirming
          termsFindings={termsFindingsForDoc(termsAll, selected.number)}
          soInvoices={invoicesForSO(selected.number)} financeNotes={extFinanceNotes}
          allOrders={orders}
          fktConfigured={fktConfigured}
          fktMatching={fktMatching}
          fktMatchMsg={fktMatchMsg}
          onMatchInvoices={matchInvoicesFromFakturownia}
          lots={extInvLots || []}
          pos={extPOs || []}
          shipments={extShipments || []}
          operationalCosts={extOperationalCosts || []}
          canOpenResult={canOpenResult} onOpenResult={onOpenResult}
          userName={userName}
          onBack={() => { setView("list"); setSelected(null); }}
          onEdit={() => editOrder(selected)}
          onPrint={async () => {
            if (selected.status === "Draft") {
              await uiAlert({ tone: "warn", title: "Draft SO", message: "Cannot print or share a draft SO. Confirm the order first." });
              return;
            }
            { const _m = soTermsMissing(selected); if (_m) { await uiAlert({ tone: "warn", title: "Terms incomplete", message: `Cannot print this SO without ${_m} — the client must see the delivery terms.` }); return; } }
            setPrintOrder(selected);
          }}
          onEmail={async () => {
            if (selected.status === "Draft") {
              await uiAlert({ tone: "warn", title: "Draft SO", message: "Cannot email a draft SO. Confirm the order first." });
              return;
            }
            { const _m = soTermsMissing(selected); if (_m) { await uiAlert({ tone: "warn", title: "Terms incomplete", message: `Cannot email this SO without ${_m} — the client must see the delivery terms.` }); return; } }
            setEmailOrder(selected);
          }}
          onIssueInvoice={() => setInvoiceOrder(selected)}
          onDelete={deleteOrder}
          onRecordCollection={() => setCollectionFor(selected)}
          onRecordClientClaim={() => {
            // v6.63.0 (D-13): one claims UI — this button now opens the Claims module
            // pre-filled with the SO, its client and its sales invoice. The old local
            // modal remains only as a fallback for standalone use.
            if (typeof onStartClaim === "function") {
              const sinv = (extInvoices || []).find((i: any) => i.kind === "SALES" && i.paymentStatus !== "Cancelled" && (i.links || []).some((lk: any) => lk.type === "SO" && String(lk.number) === String(selected.number)));
              const clientContact = (extContacts || []).find((c: any) => String(c.name || "").trim().toLowerCase() === String(selected.client?.name || "").trim().toLowerCase());
              onStartClaim({
                respondentKind: "Client", direction: "CONCESSION", currency: selected.currency || "PLN", fxToPLN: selected.fxRate || 1, // v6.81.0 (D-62)
                respondentName: selected.client?.name || "", contactId: clientContact ? clientContact.id : null,
                subjects: [
                  { kind: "SO", ref: selected.number },
                  ...(sinv ? [{ kind: "INVOICE", ref: sinv.number }] : []),
                ],
                notes: `Client claim on ${selected.number}`,
              });
              return;
            }
            setClientClaimFor(selected); setCc({ lotId: "", qty: "", value: "", cur: selected.currency || "PLN", note: "" }); }}
        />
      </>
    );
  }

  // List view
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#FAFAFA" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", flexShrink: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>Sales Orders</div>
        <div style={{ marginLeft: "auto" }}>
          <SmallButton onClick={() => exportRowsToXlsx(`sales_orders_${xlsStamp()}`, filtered, [{ key: "number", label: "SO" }, { key: "client", label: "Client", fmt: (v: any) => v?.name || "" }, { key: "sellIncoterm", label: "Terms" }, { key: "destinationText", label: "Destination" }, { key: "orderDate", label: "Ordered" }, { key: "deliveryDate", label: "Delivery planned" }, { key: "status", label: "Status" }, { key: "currency", label: "Currency" }, { key: "fxRate", label: "Rate" }, { key: "items", label: "Lines", fmt: (v: any) => (v || []).map((it: any) => `${it.product}${it.variety ? " " + it.variety : ""} ${it.size || ""} ${it.grade ? "grade " + it.grade : ""} ${it.qty} kg @ ${it.unitPrice}`).join(" | ") }, { key: "acidNo", label: "ACID" }, { key: "importPermitNo", label: "Permit" }], "Sales orders")} title="v6.99.0: exports the rows as filtered, columns as shown">Export file (Excel)</SmallButton>
          <ActionButton action="create" label="Add new SO" onClick={newOrder} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        {/* KPI strip — compact */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
          <Card style={{ padding: "9px 12px" }}>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>ACTIVE <span style={{ color: "#CBD5E1", fontWeight: 400 }}>· in progress</span></div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111", marginTop: 2 }}>{activeCount}</div>
          </Card>
          <Card style={{ padding: "9px 12px" }}>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>ACTIVE VALUE</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#16A34A", marginTop: 2 }}>{fmtMoney(activeValuePLN, "PLN")}</div>
          </Card>
          <Card style={{ padding: "9px 12px" }}>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>AWAITING INVOICE <span style={{ color: "#CBD5E1", fontWeight: 400 }}>· delivered</span></div>
            <div style={{ fontSize: 16, fontWeight: 700, color: deliveredNotInvoicedCount > 0 ? "#D97706" : "#111", marginTop: 2 }} title="Sales orders marked Delivered that have not yet been invoiced — your invoicing backlog.">{deliveredNotInvoicedCount}</div>
          </Card>
          <Card style={{ padding: "9px 12px" }}>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>DUE SOON <span style={{ color: "#CBD5E1", fontWeight: 400 }}>· next 7 days</span></div>
            <div style={{ fontSize: 16, fontWeight: 700, color: upcomingDeliveryCount > 0 ? "#7C3AED" : "#111", marginTop: 2 }} title="Active orders whose delivery date falls within the next 7 days — deliveries to prepare for.">{upcomingDeliveryCount}</div>
          </Card>
        </div>

        {/* Filters — compact single row */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SO, client, product, LOT/PO…" style={{ flex: "1 1 240px", minWidth: 200, border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none", background: "#fff" }} />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} title="Filter by status" style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", fontSize: 12, background: "#fff", fontFamily: "inherit", maxWidth: 200 }}>
            {["All", ...Object.keys(SO_STATUSES)].map(s => <option key={s} value={s}>{s === "All" ? "All statuses" : statusWord(s)}</option>)}
          </select>
          <Sel value={filterClient} onChange={e => setFilterClient(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="All">All clients</option>
            {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </Sel>
        </div>

        {/* Table */}
        <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 110px 110px 130px 130px 140px", padding: "10px 18px", background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
            {["SO NUMBER", "CLIENT", "ORDER DATE", "DELIVERY DATE", "STATUS", "TOTAL", "LINKED DOCUMENTS"].map((h, i) => (
              <div key={i} style={{ fontSize: 10, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em" }}>{h}</div>
            ))}
          </div>
          {filtered.length === 0 && <div style={{ padding: "40px 20px", textAlign: "center", color: "#AAA", fontSize: 13 }}>No sales orders found.</div>}
          {/* v6.78.0: newest first — a register is a record of what happened, and
                  the row you want is almost always the one you just made. */}
              {newestFirst(filtered).map((o, idx) => {
            // Build a small sources summary string
            const sources: string[] = o.items
              .map((it: any) => it.sourceRef ? String(it.sourceRef) : null)   /* v7.23.3 (A-UI-1): no icon */
              .filter((value: any): value is string => typeof value === "string" && value.length > 0);
            const uniqueSources: string[] = Array.from(new Set<string>(sources));
            // Quick overage check for the row badge
            const rowAvail = ["Shipped", "Delivered", "Invoiced", "Closed"].includes(String(effectiveSoStatus(o, sd.shipments || []))) ? [] : computeLineAvailability(o.items, orders, o.id, sd);   // v6.99.16: history is not checked
            const rowOverageCount = rowAvail.filter(a => a.hasOverage).length;
            return (
              <div key={o.id} style={{ display: "grid", gridTemplateColumns: "140px 1fr 110px 110px 130px 130px 140px", padding: "12px 18px", borderBottom: idx < filtered.length - 1 ? "1px solid #F3F4F6" : "none", alignItems: "center", background: "#fff", cursor: "pointer" }}
                onClick={() => openDetail(o)}
                onMouseEnter={e => e.currentTarget.style.background = o.status === "Cancelled" ? "#FEE2E2" : "#FAFAFA"}
                onMouseLeave={e => e.currentTarget.style.background = o.status === "Cancelled" ? "#FEF2F2" : "#fff"}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: o.status === "Cancelled" ? "#B91C1C" : "#2563EB", textDecoration: o.status === "Cancelled" ? "line-through" : "none", textDecorationColor: "#DC2626", fontFamily: "inherit", fontVariantNumeric: "tabular-nums" }}>{o.number}</div>
                  {rowOverageCount > 0 && (
                    <div title={`${rowOverageCount} line(s) exceed available supply`} style={{ display: "inline-block", marginTop: 3, padding: "1px 6px", background: "#FFFBEB", color: "#92400E", border: "1px solid #FCD34D", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                      ⚠ {rowOverageCount} short
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#111" }}>{o.client?.name || "—"}</div>
                  <div style={{ fontSize: 11, color: "#AAA" }}>{o.items.length} {o.items.length === 1 ? "line" : "lines"} · {fmtNum(o.items.reduce((s, it) => s + (parseNum(it.qty) || 0), 0))} kg</div>
                </div>
                <div style={{ fontSize: 12, color: "#555" }}>{formatDMY(o.orderDate)}</div>
                <div style={{ fontSize: 12, color: "#555" }}>{formatDMY(o.deliveryDate) || "—"}</div>
                <div><StatusBadge status={o.status} /></div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtMoney(netTotal(o.items, sd), o.currency)}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, fontFamily: "inherit", fontVariantNumeric: "tabular-nums" }}>
                  {/* v6.34.2 (module review): list the linked source documents, don't truncate to 2. */}
                  {uniqueSources.length === 0 && <span style={{ fontSize: 10, color: "#CCC", fontStyle: "italic", fontFamily: "inherit" }}>unsourced</span>}
                  {uniqueSources.map((s, i) => {
                    const bare = String(s);   // v7.23.3 (A-UI-1): the numbers carry no icon any more
                    return <span key={i} style={{ fontSize: 10 }}><DocRef num={bare} cancelledSet={cancelledRefs} /></span>;
                  })}
                  {/* v6.45.0: shipments + invoices were missing from this column —
                      the SO showed only its SOURCE documents even after shipping. */}
                  {(() => {
                    const shps = Array.from(new Set([
                      ...shipmentsForSO(o.number, extShipments || []),   // v7.28.5 (Batch L): worked out from the shipments
                      ...((extShipments || []).filter((sh: any) => sh.status !== "Cancelled" && ((sh.soRefs || []).includes(o.number) || (sh.goods || []).some((g: any) => g.soRef === o.number))).map((sh: any) => sh.number)),
                    ]));
                    return shps.map((n: any, i: number) => <span key={"sh" + i} style={{ fontSize: 10 }}><DocRef num={n} cancelledSet={cancelledRefs} /></span>);
                  })()}
                  {invoicesForCounterpartyDoc(o.number, "SO", extInvoices || []).map((n: any, i: number) => <span key={"inv" + i} style={{ fontSize: 10 }}><DocRef num={n} cancelledSet={cancelledRefs} /></span>)}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 20, fontSize: 11, color: "#AAA", textAlign: "center" }}>
          {filtered.length} of {orders.length} sales orders · Click any row to open
        </div>
      </div>
      {clientClaimFor && (() => {
        const soDoc = clientClaimFor;
        const lotsAll = extInvLots || [];
        const linked = lotsAll.filter((l: any) =>
          (l.movements || []).some((m: any) => m && !m.voided && m.type === "SHIP_OUT" && String(m.soRef) === String(soDoc.number)) ||
          (soDoc.items || []).some((it: any) => it.sourceType === "STOCK" && String(it.sourceRef) === String(l.number)));
        const pool = linked.length ? linked : lotsAll;
        const inp = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 7, padding: "7px 10px", fontSize: 13 } as any;
        const canSave = cc.lotId && parseNum(cc.value) > 0;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }} onClick={() => setClientClaimFor(null)}>
            <div style={{ background: "#fff", borderRadius: 14, padding: 22, width: 480, maxWidth: "92vw" }} onClick={(e: any) => e.stopPropagation()}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Record client claim — {soDoc.number}</div>
              <div style={{ fontSize: 11, color: "#64748B", marginBottom: 12 }}>Logs the claim against the delivered lot and drafts an outgoing <strong>credit note</strong> (finalise it in Invoices). Warehouse stock is not touched — those kg already left.</div>
              <Lbl>Lot the claim concerns</Lbl>
              <select style={inp} value={cc.lotId} onChange={(e: any) => setCc((x: any) => ({ ...x, lotId: e.target.value }))}>
                <option value="">— select lot —</option>
                {pool.map((l: any) => <option key={l.id} value={l.id}>{l.number} · {l.product}{l.variety ? " — " + l.variety : ""}</option>)}
              </select>
              {!linked.length && <div style={{ fontSize: 10, color: "#B45309", marginTop: 4 }}>No lot is linked to this SO automatically — pick the delivered lot yourself.</div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 0.7fr", gap: 10, marginTop: 12 }}>
                <div><Lbl>Affected kg (optional)</Lbl><input style={inp} inputMode="decimal" value={cc.qty} onChange={(e: any) => setCc((x: any) => ({ ...x, qty: e.target.value }))} placeholder="0" /></div>
                <div><Lbl>Claim value</Lbl><input style={inp} inputMode="decimal" value={cc.value} onChange={(e: any) => setCc((x: any) => ({ ...x, value: e.target.value }))} placeholder="0.00" /></div>
                <div><Lbl>Currency</Lbl><select style={inp} value={cc.cur} onChange={(e: any) => setCc((x: any) => ({ ...x, cur: e.target.value }))}>{["PLN", "EUR", "USD"].map(c => <option key={c}>{c}</option>)}</select></div>
              </div>
              <div style={{ marginTop: 12 }}><Lbl>Note</Lbl><input style={inp} value={cc.note} onChange={(e: any) => setCc((x: any) => ({ ...x, note: e.target.value }))} placeholder="What the client reported…" /></div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
                <button onClick={() => setClientClaimFor(null)} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                <button disabled={!canSave} onClick={saveClientClaim} style={{ padding: "7px 16px", borderRadius: 7, border: "none", background: canSave ? "#B45309" : "#D1D5DB", color: "#fff", fontSize: 12, fontWeight: 700, cursor: canSave ? "pointer" : "not-allowed" }}>Record claim + draft credit note</button>
              </div>
            </div>
          </div>
        );
      })()}
      {collectionFor && (
        <CollectionModal so={collectionFor} onClose={() => setCollectionFor(null)} onSave={recordCollection} />
      )}

    </div>
  );
}


/** v7.23.1 (A-SOL-2): the coloration of the lot a sale line sells (read from the lot's PO line). */
export function lotColorationOf(lotNumber: any, sd: SalesData): string { return String(((sd.lots || []).find((l: any) => String(l.number) === String(lotNumber)) || {}).coloration || ""); }
/** v7.23.1 (A-SOL-2): on saving, a lot-sourced line without a coloration takes its lot's. */
export function withLotColorations(order: any, sd: SalesData): any {
  return { ...order, items: (order.items || []).map((it: any) => it && it.sourceType === "STOCK" && it.sourceRef && !it.coloration && lotColorationOf(it.sourceRef, sd) ? { ...it, coloration: lotColorationOf(it.sourceRef, sd) } : it) };
}
/** v7.22.4 (A-RV-16): the data the sales screens read, built once from the props (no module copy). */
export function buildSalesData(p: { invLots?: any[]; inspections?: any[]; pos?: any[]; shipments?: any[]; contacts?: any[]; packagingTypes?: any[] }): SalesData {
  const poRefs = p.pos ? _adaptPOsFromModule(p.pos) : [];
  // v6.18.23: a lot created before the PO→lot variety/CN-HS copy won't carry those fields — backfilled from its PO line
  // v7.23.1 (A-SOL-2, owner 13 Oct): a lot reads what it does not carry itself from ITS PO line — the variety, the CN code and the
  // coloration (kept on the PO line only); the line is the lot's own (poLineId), else the one of the same item and variety
  const lots = (p.invLots ? _adaptLotsFromInventory(p.invLots, p.inspections) : []).map((lot: any) => {
    if (!lot.poRef || (lot.variety && lot.cnCode && lot.coloration)) return lot;
    const po: any = poRefs.find((x: any) => x.number === lot.poRef); const items: any[] = (po && po.items) || [];
    const same = (it: any) => String(it.product || "").toLowerCase() === String(lot.product || "").toLowerCase();
    const line: any = (lot.poLineId != null && items.find((it: any) => String(it.id) === String(lot.poLineId)))
      || items.find((it: any) => same(it) && String(it.variety || "").toLowerCase() === String(lot.variety || "").toLowerCase()) || items.find(same);
    if (!line) return lot;
    return { ...lot, variety: lot.variety || line.variety || "", cnCode: lot.cnCode || line.cnCode || "", coloration: lot.coloration || line.coloration || "" };
  });
  return { lots, rawLots: p.invLots || [], poRefs, contacts: p.contacts || [], shipments: p.shipments || [], packagingTypes: (p.packagingTypes && p.packagingTypes.length) ? p.packagingTypes : PACKAGING_SEED };
}
export default function SalesOrders(props: any) {
  const p = props || {};
  const sd = useMemo(() => buildSalesData({ invLots: p.invLots, inspections: p.inspections, pos: p.allPOs, shipments: p.shipments, contacts: p.contacts, packagingTypes: p.packagingTypes }), [p.invLots, p.inspections, p.allPOs, p.shipments, p.contacts, p.packagingTypes]);
  return <SalesDataContext.Provider value={sd}><SalesOrdersScreen {...p} /></SalesDataContext.Provider>;
}
