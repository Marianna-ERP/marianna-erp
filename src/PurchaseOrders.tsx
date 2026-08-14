import React, { useState, useMemo } from "react";
import { handoverPointForIncoterm, namedPlacePoolForIncoterm, handoverSentence, MOVEMENT_LABELS, poDirectFromSOs } from "./tradeFlow.domain";
import { Card, Lbl, SectionTitle, DocRef, cancelledDocSet, useConfirm } from "./ui";
import { LOGO_DATA_URL } from "./brand";
import { nextId } from "./ids";
import { FX_RATES } from "./fx";
import { getCounterpartiesByType } from "./Contacts";
import { LOCATIONS as SHARED_LOCATIONS, warehouseAddressLocations } from "./locations";
import { localTodayISO, formatDMY } from "./dates";
import { ItemVarietyPicker } from "./ProductPicker";
import { cnCodeForItem } from "./productCatalog";
import { recordAudit } from "./audit";

// ─── COMPANY ────────────────────────────────────────────────────────────────
const COMPANY = {
  name: "MARIANNA",
  person: "Hazem Osman",
  address: "ul. Długa 29,\n00-238 Warszawa\nPolska",
  nip: "PL525-284-27-87",
  regon: "387501311",
};

// ─── BRAND ASSETS ──────────────────────────────────────────────────────────
// Logo embedded as base64 PNG so the printed PO is self-contained — no external image hosting.
// Source: Marianna_logo.png (3333×3333 JPEG on black), processed to 600×208 on white.


// ─── CONTACTS STUB (to be replaced when integrated with Contacts.tsx) ─────
// Mirrors the shape of getCounterpartiesByType(counterparties, "Supplier").
// When integration happens, this stub is replaced with the helper from Contacts.tsx.
function getSuppliersStub() {
  return [
    { id: 1, type: "Supplier", name: "Białski Owoc", country: "Poland", nip: "8351595299", address: "ul. Kolejowa 35; 96-230 Biała Rawska", contact: "Aneta Głowala", email: "aneta@bialskiowoc.pl" },
    { id: 2, type: "Supplier", name: "FreshFarm ES", country: "Spain", nip: "ESB12345678", address: "Calle Major 12, Valencia", contact: "Carlos Ruiz", email: "c.ruiz@freshfarmes.com" },
    { id: 3, type: "Supplier", name: "AgriTrade MA", country: "Morocco", nip: "MA-200123", address: "Route de Casablanca, Agadir", contact: "Youssef Idrissi", email: "y.idrissi@agritrade.ma" },
    { id: 4, type: "Supplier", name: "Fructex Egypt Co.", country: "Egypt", nip: "463587936", address: "Industrial Zone, Borg El Arab, Alexandria", contact: "Ahmed Hassan", email: "a.hassan@fructex-eg.com" },
    { id: 5, type: "Supplier", name: "Jordan Fresh Exports", country: "Jordan", nip: "JO-887665", address: "King Abdullah Industrial City, Amman", contact: "Layla Khouri", email: "exports@jordanfresh.jo" },
  ];
}

// ─── REFERENCE ──────────────────────────────────────────────────────────────
const CURRENCIES = ["PLN", "EUR", "USD"];

const PAYMENT_TERMS = [
  "Advance payment",
  "Cash on delivery",
  "Cash against documents",
  "7 days from invoice date",
  "14 days from invoice date",
  "21 days from invoice date",
  "30 days from invoice date",
  "Other",
];

const INCOTERMS_BUY = [
  { code: "EXW", label: "EXW — Ex Works (we pick up at supplier)" },
  { code: "FCA", label: "FCA — Free Carrier" },
  { code: "FOB", label: "FOB — Free On Board (sea, we handle from port)" },
  { code: "CFR", label: "CFR — Cost & Freight (supplier ships, we customs)" },
  { code: "CIF", label: "CIF — Cost, Insurance, Freight (supplier ships+insures, we customs)" },
  { code: "CPT", label: "CPT — Carriage Paid To" },
  { code: "CIP", label: "CIP — Carriage and Insurance Paid To" },
  { code: "DAP", label: "DAP — Delivered At Place (supplier delivers, no customs)" },
  { code: "DDP", label: "DDP — Delivered Duty Paid (supplier does everything)" },
];

// Flow types — 11 flows organised in two groups (EXP / IMP).
// `buyIncoterms` is a soft hint used for the cross-validation warning, not a hard rule.
// `defaultRequiresSea` pre-fills the per-PO sea-freight toggle; user can override per deal.
// v6.37.0: FLOW_TYPES retired — every behaviour derives from shipments/incoterms;
// legacy stored data was migrated (flowCleanup.migration, schema 2).

// Canonical ordering of ownership points along any journey, used to compute whether
// a given stage falls inside the owned segment [buyOwnershipStart .. sellOwnershipEnd].
// Map a stage kind to the ownership point it sits at (for the owned-segment test).
// v6.37.0: STAGE_KIND_TO_POINT retired with the template journey seed.

// Groups for ordered rendering in UI (chips + dropdowns)
const QUALITY_GRADES = ["I", "IB", "II", "Industrial"];

const PO_STATUSES: Record<string, any> = {
  Draft:           { bg: "#F3F4F6", color: "#6B7280", desc: "Building the order" },
  Confirmed:       { bg: "#DBEAFE", color: "#2563EB", desc: "Agreed with supplier · FX rate locked" },
  "In Production": { bg: "#FEF3C7", color: "#D97706", desc: "Supplier preparing the goods" },
  Shipped:         { bg: "#E0F2FE", color: "#0284C7", desc: "Shipment dispatched against this PO" },
  Arrived:         { bg: "#DCFCE7", color: "#16A34A", desc: "Goods landed · lot created" },
  Closed:          { bg: "#D1FAE5", color: "#065F46", desc: "Invoiced, paid, closed" },
  Cancelled:       { bg: "#FEE2E2", color: "#DC2626", desc: "" },
};

const STATUS_LIFECYCLE = ["Draft", "Confirmed", "In Production", "Shipped", "Arrived", "Closed"];

// Destination location pool (mirrors Inventory/Shipments)
const LOCATION_TYPES: Record<string, any> = {
  OWN:      { label: "Our Warehouse",  color: "#0284C7", icon: "🏢" },
  SUPPLIER: { label: "Supplier Site",  color: "#16A34A", icon: "🚜" },
  PORT:     { label: "Port / Transit", color: "#D97706", icon: "⚓" },
  CLIENT:   { label: "Client Site",    color: "#7C3AED", icon: "🎯" },
  BROKER:   { label: "Customs / Broker", color: "#DB2777", icon: "🛃" },
};
// LOCATIONS now comes from the shared ./locations source of truth.
// Mapped so the legacy single-word `type` field still works in existing UI code.
const LOCATIONS = SHARED_LOCATIONS.map(l => ({ ...l, type: l.legacyType }));

// Which location type is the typical destination for each flow (drives optgroup ordering in the dropdown).
// User can still pick from any type — this just shows the most common option first.

// Stub FX rates for currency conversion in summary (would come from NBP in production)
// FX_RATES now sourced from ./fx (single source of truth)

// ─── SEED DATA ──────────────────────────────────────────────────────────────
const SUPPLIERS = getSuppliersStub();

function primaryContactValue(counterparty) {
  const contacts = counterparty.contacts || [];
  const primary = contacts.find(p => p.isPrimary) || contacts[0];
  return primary?.email || primary?.phone || counterparty.email || counterparty.contact || counterparty.phone || "";
}

function tradingPartnerFromCounterparty(counterparty) {
  return {
    id: counterparty.id,
    name: counterparty.name,
    country: counterparty.country || "",
    nip: counterparty.nip || "",
    vatEuId: counterparty.vatEuId || "",
    address: counterparty.address || "",
    contact: primaryContactValue(counterparty),
  };
}

function suppliersFromContacts(contacts) {
  const mapped = getCounterpartiesByType(contacts || [], "Supplier").map(tradingPartnerFromCounterparty);
  // v6.30.2 (G1 completion): no stub-supplier fallback — empty Contacts = empty picker,
  // mirroring the SO-side clientsFromContacts fix from Batch 0. The demo SUPPLIERS
  // array remains for standalone/dev seeds only; a clean system must stay clean.
  return mapped;
}

// v6.32.0 (R7b-5): demo seed INITIAL_ORDERS moved out of the production bundle → dev/demoSeed.reference.ts

// ─── SHARED ATOMS ───────────────────────────────────────────────────────────
function Inp({ value, onChange = () => {}, type = "text", placeholder = "", style = {}, disabled = false, list, title, max }: any) {
  const base = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: disabled ? "#F9FAFB" : "#fff" };
  return <input value={value ?? ""} onChange={onChange} type={type || "text"} placeholder={placeholder} disabled={disabled} list={list} title={title} max={max} style={{ ...base, ...style }} />;
}
function Sel({ value, onChange = () => {}, children, style = {}, disabled = false }: any) {
  const base = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: disabled ? "#F9FAFB" : "#fff" };
  return <select value={value || ""} onChange={onChange} disabled={disabled} style={{ ...base, ...style }}>{children}</select>;
}
function StatusBadge({ status }: any) {
  const s = PO_STATUSES[status] || { bg: "#F3F4F6", color: "#6B7280" };
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
  return <span style={{ background: p.bg, color: p.color, padding: "1px 7px", borderRadius: 4, fontSize: 10.5, fontWeight: 700, fontFamily: "ui-monospace, Menlo, monospace", whiteSpace: "nowrap" }}>Kl. {quality}</span>;
}
function FlowBadge({ flow, order = null, compact = false }: any) {
  // v6.29.0: terms-first vocabulary — old-flow and new POs render identically.
  // v6.43.0 (test-round #4/#5b): NO import/export direction is guessed here. Trade
  // direction is the shipment's truth, not the PO's — defaulting to "Import" showed
  // the wrong direction on export deals (e.g. CIF/CFR out of the EU). We show the
  // incoterm + named place only; a direction word appears solely if the PO carries
  // an explicit tradeMovement (legacy records that stored one).
  if (order && (order.buyIncoterm || order.tradeMovement)) {
    const dir = order.tradeMovement && MOVEMENT_LABELS[order.tradeMovement] ? MOVEMENT_LABELS[order.tradeMovement] : null;
    const place = order.destinationText || (LOCATIONS.find((l: any) => l.id === order.destinationLocationId)?.name) || "";
    return (
      <span title={handoverSentence(order.buyIncoterm, place)} style={{ display: "inline-block", maxWidth: "100%", background: "#F9FAFB", border: "1px solid #EBEBEB", padding: compact ? "1px 7px" : "3px 10px", borderRadius: 4, fontSize: compact ? 10.5 : 11.5, color: "#555", whiteSpace: compact ? "normal" : "nowrap", lineHeight: 1.25, fontWeight: 500 }}>
        {dir ? <b style={{ color: dir.color }}>{dir.label} · </b> : null}{order.buyIncoterm ? <>{order.buyIncoterm}{place ? ` ${place}` : ""}</> : null}
      </span>
    );
  }
  return null; // v6.37.0: no incoterm/movement on the PO → nothing to badge (flow key retired)
}

function VarianceBadge({ variance }: any) {
  if (!variance || !variance.expectedKg || variance.receivedKg == null) return null;
  const delta = variance.receivedKg - variance.expectedKg;
  if (delta === 0) return null;
  const pct = ((delta / variance.expectedKg) * 100).toFixed(1);
  const isShort = delta < 0;
  return (
    <span title={`Expected ${variance.expectedKg.toLocaleString()} kg, received ${variance.receivedKg.toLocaleString()} kg`}
      style={{ background: isShort ? "#FEF3C7" : "#DBEAFE", color: isShort ? "#92400E" : "#1E40AF", padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
      {delta > 0 ? "+" : ""}{pct}%
    </span>
  );
}
function fmtNum(n) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("pl-PL");
}
function fmtMoney(n, cur = "PLN") {
  if (n == null || isNaN(n)) return "—";
  return `${Number(n).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}
function fmtDate(d) { return d || "—"; }

function locById(id) { return LOCATIONS.find(l => String(l.id) === String(id)); }
function destinationDisplay(order) {
  const custom = String(order?.destinationText || order?.destinationLocationText || "").trim();
  if (custom) return custom;
  const loc = locById(order?.destinationLocationId);
  if (!loc) return "—";
  return `${loc.name}${loc.country ? `, ${loc.country}` : ""}`;
}
function netTotal(items) { return items.reduce((s, i) => s + (parseFloat(i.qty) || 0) * (parseFloat(i.unitPrice) || 0), 0); }

// Generate next PO number for the current year by finding the highest existing sequence and adding 1.
// Format: PO-YYYY-NNNN (4-digit zero-padded sequence per year).
function nextPONumber(orders, year = new Date().getFullYear()) {
  const prefix = `PO-${year}-`;
  const seqs = orders
    .map(o => o.number || "")
    .filter(n => n.startsWith(prefix))
    .map(n => parseInt(n.slice(prefix.length), 10))
    .filter(n => !isNaN(n));
  const next = (seqs.length ? Math.max(...seqs) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}
function plnTotal(order) {
  const fx = order.fxRate || FX_RATES[order.currency] || 1;
  return netTotal(order.items) * fx;
}
function totalQtyKg(items) { return items.reduce((s, i) => s + (parseFloat(i.qty) || 0), 0); }

// ─── PO DOCUMENT (print template) ───────────────────────────────────────────
// Small bilingual label helper for the print template — English bold on top, Polish italic gray below
function BiLbl({ en, pl, align = "left" }: any) {
  return (
    <div style={{ textAlign: align as React.CSSProperties["textAlign"], lineHeight: 1.1 }}>
      <div style={{ fontWeight: 700, fontSize: 10 }}>{en}</div>
      <div style={{ fontStyle: "italic", color: "#666", fontSize: 8.5 }}>{pl}</div>
    </div>
  );
}

// Company logo block for the printed PO — uses the actual Marianna logo image
// (LOGO_DATA_URL constant defined near the top of the file, embedded base64 PNG on white).
function PrintLogo() {
  return (
    <div style={{ background: "#fff", display: "inline-block" }}>
      <img
        src={LOGO_DATA_URL}
        alt="Marianna"
        style={{ width: 240, height: "auto", display: "block" }}
      />
    </div>
  );
}

function PODoc({ order }: any) {
  const total = netTotal(order.items);
  const currency = order.currency || order.items[0]?.currency || "PLN";
  const paymentDisplay = order.paymentTerms === "Other" ? (order.paymentTermsOther || "Other") : order.paymentTerms;

  // Single source of truth for the row labels in the metadata + supplier blocks
  const meta = [
    { en: "PO No.",             pl: "Nr zamówienia",          value: order.number,             strong: true },
    { en: "Order date",         pl: "Data zamówienia",        value: formatDMY(order.orderDate) },
    { en: "Loading date",       pl: "Data załadunku",         value: formatDMY(order.loadingDate) },
    { en: "Expected delivery",  pl: "Przewidywana dostawa",   value: formatDMY(order.expectedDeliveryDate) },
    { en: "Destination",        pl: "Miejsce docelowe",       value: destinationDisplay(order) },
    { en: "Purchase Incoterm",  pl: "Warunki zakupu Incoterms", value: order.buyIncoterm,      strong: true },
    { en: "Payment",            pl: "Warunki płatności",      value: paymentDisplay },
  ];
  const supplierRows = [
    { en: "Name",      pl: "Nazwa",   value: order.supplier?.name || "—" },
    { en: "Country",   pl: "Kraj",    value: order.supplier?.country || "—" },
    { en: "Address",   pl: "Adres",   value: order.supplier?.address || "—" },
    { en: "NIP / VAT", pl: "NIP / VAT", value: order.supplier?.nip || "—" },
    { en: "Contact",   pl: "Kontakt", value: order.supplier?.contact || "—" },
  ];

  return (
    <div style={{ fontFamily: "Calibri, Arial, sans-serif", fontSize: 10.5, color: "#111", width: "100%" }}>
      {/* HEADER — logo top-left, title center, blank right for breathing room */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
        <tbody>
          <tr>
            <td style={{ width: "35%", verticalAlign: "middle", padding: "4px 0" }}>
              <PrintLogo />
            </td>
            <td style={{ width: "65%", textAlign: "right", verticalAlign: "middle" }}>
              <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.1 }}>Purchase Order</div>
              <div style={{ fontSize: 13, fontStyle: "italic", color: "#555", marginTop: 2 }}>Zamówienie zakupu</div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* META + BUYER */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #ccc", padding: "8px 10px", width: "50%", verticalAlign: "top" }}>
              {meta.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "baseline", marginBottom: i === meta.length - 1 ? 0 : 4, gap: 8 }}>
                  <div style={{ flex: "0 0 42%" }}>
                    <span style={{ fontWeight: 700, fontSize: 9.5 }}>{r.en}</span>
                    <span style={{ fontStyle: "italic", color: "#777", fontSize: 8.5, marginLeft: 4 }}>{r.pl}</span>
                  </div>
                  <div style={{ fontWeight: r.strong ? 700 : 500, fontSize: r.strong ? 12 : 11 }}>{r.value || "—"}</div>
                </div>
              ))}
            </td>
            <td style={{ border: "1px solid #ccc", padding: "8px 10px", verticalAlign: "top", width: "50%" }}>
              <BiLbl en="Buyer" pl="Nabywca" />
              <div style={{ marginTop: 4, fontWeight: 700, fontSize: 12 }}>{COMPANY.name}</div>
              <div style={{ fontSize: 11 }}>{COMPANY.person}</div>
              {COMPANY.address.split("\n").map((l, i) => <div key={i} style={{ fontSize: 11 }}>{l}</div>)}
              <div style={{ fontSize: 11, marginTop: 2 }}><span style={{ fontWeight: 600 }}>NIP:</span> {COMPANY.nip}</div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* SUPPLIER */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: -1 }}>
        <thead>
          <tr>
            <th colSpan={2} style={{ border: "1px solid #ccc", background: "#f9f9f9", padding: "6px 10px", textAlign: "left" }}>
              <BiLbl en="Supplier" pl="Dostawca / Sprzedawca" />
            </th>
          </tr>
        </thead>
        <tbody>
          {supplierRows.map(r => (
            <tr key={r.en}>
              <td style={{ border: "1px solid #ccc", padding: "5px 10px", width: "30%", verticalAlign: "top" }}>
                <span style={{ fontWeight: 700, fontSize: 9.5 }}>{r.en}</span>
                <span style={{ fontStyle: "italic", color: "#777", fontSize: 8.5, marginLeft: 4 }}>{r.pl}</span>
              </td>
              <td style={{ border: "1px solid #ccc", padding: "5px 10px", fontWeight: 500 }}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* GOODS TABLE */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: -1 }}>
        <thead>
          <tr>
            <th colSpan={11} style={{ border: "1px solid #ccc", background: "#f9f9f9", padding: "6px 10px", textAlign: "left" }}>
              <BiLbl en="Description of goods" pl="Opis towaru" />
            </th>
          </tr>
          <tr style={{ background: "#f3f3f3" }}>
            {[
              { en: "Product",     pl: "Produkt",      align: "left" },
              { en: "Origin",      pl: "Pochodzenie",  align: "left" },
              { en: "Size",        pl: "Kaliber",      align: "center" },
              { en: "Quality",     pl: "Klasa",        align: "center" },
              { en: "Packaging",   pl: "Opakowanie",   align: "left" },
              { en: "Pallets",     pl: "Palety",       align: "center" },
              { en: "Unit",        pl: "Jedn.",        align: "center" },
              { en: "Qty",         pl: "Ilość",        align: "right" },
              { en: "Unit Price",  pl: "Cena jedn.",   align: "right" },
              { en: "Currency",    pl: "Waluta",       align: "center" },
              { en: "Total",       pl: "Wartość",      align: "right" },
            ].map((h, i) => {
              const headerAlign = h.align as "left" | "center" | "right";
              return (
                <th key={i} style={{ border: "1px solid #ccc", padding: "5px 5px", textAlign: headerAlign, verticalAlign: "bottom" }}>
                  <BiLbl en={h.en} pl={h.pl} align={headerAlign} />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, i) => {
            const lt = ((parseFloat(item.qty) || 0) * (parseFloat(item.unitPrice) || 0)).toFixed(2);
            return (
              <tr key={i}>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", fontWeight: 700 }}>
                  {item.product}{item.variety ? <span style={{ fontWeight: 400 }}> — {item.variety}</span> : null}
                  {item.coloration && <div style={{ fontSize: 9.5, color: "#666", fontWeight: 400, fontStyle: "italic" }}>{item.coloration}</div>}
                </td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px" }}>{item.origin}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "center" }}>{item.size}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "center" }}>Kl. {item.quality}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px" }}>{item.packaging || "—"}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "center" }}>{item.pallets || "—"}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "center" }}>{item.unit || "Kg"}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "right" }}>{parseFloat(item.qty || 0).toLocaleString("pl-PL")}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "right" }}>{(order.pricingMode || "firm") === "consignment" ? "—" : parseFloat(item.unitPrice || 0).toFixed(2)}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "center" }}>{(order.pricingMode || "firm") === "consignment" ? "—" : order.currency}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "right", fontWeight: 600 }}>{(order.pricingMode || "firm") === "consignment" ? "Konsygnacja / Consignment" : parseFloat(lt).toLocaleString("pl-PL", { minimumFractionDigits: 2 })}</td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={9} style={{ border: "1px solid #ccc", padding: "6px 8px", verticalAlign: "top" }}>
              <div style={{ fontSize: 9, color: "#777" }}>
                <span style={{ fontWeight: 700, color: "#E05A2B" }}>Notes</span>
                <span style={{ fontStyle: "italic", marginLeft: 4 }}>/ Uwagi</span>
              </div>
              <div style={{ marginTop: 3, fontSize: 10.5, color: "#333", whiteSpace: "pre-wrap" }}>{order.notes || "—"}</div>
            </td>
            <td style={{ border: "1px solid #ccc", padding: "6px 8px", textAlign: "right", background: "#f9f9f9", verticalAlign: "top" }}>
              <BiLbl en="Net Total" pl="Suma netto" align="right" />
            </td>
            <td style={{ border: "1px solid #ccc", padding: "6px 8px", textAlign: "right", fontWeight: 700, fontSize: 12, verticalAlign: "top" }}>{(order.pricingMode || "firm") === "consignment" ? <span style={{ fontSize: 10.5 }}>Konsygnacja — rozliczenie ze sprzedaży / Consignment — settled on sales</span> : <>
              {total.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} {currency}
            </>}</td>
          </tr>
        </tbody>
      </table>

      {/* SIGNATURES — placed before the legal clause; reduced cell padding */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #ccc", padding: "10px 10px 6px", width: "50%", textAlign: "center", color: "#888" }}>
              <div style={{ height: 14 }} />
              <div style={{ borderTop: "1px solid #555", paddingTop: 3, margin: "0 auto", maxWidth: 220 }}>
                <BiLbl en="Supplier signature" pl="Podpis dostawcy" align="center" />
              </div>
            </td>
            <td style={{ border: "1px solid #ccc", padding: "10px 10px 6px", width: "50%", textAlign: "center", color: "#888" }}>
              <div style={{ height: 14 }} />
              <div style={{ borderTop: "1px solid #555", paddingTop: 3, margin: "0 auto", maxWidth: 220 }}>
                <BiLbl en="Buyer signature" pl="Podpis nabywcy" align="center" />
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* LEGAL ACCEPTANCE CLAUSE — printed at the end of the page, both languages */}
      <div style={{ marginTop: 8, padding: "6px 10px", border: "1px solid #E5E7EB", borderRadius: 4, background: "#FAFAFA" }}>
        <div style={{ fontSize: 7.5, color: "#666", fontStyle: "italic", lineHeight: 1.35, marginBottom: 4 }}>
          In the absence of any written objections from the supplier, the PO shall be considered accepted even if it is not signed, stamped, or returned by the supplier. The supplier remains responsible for the quality of the product until it reaches the final destination, provided that all transport conditions have been properly met.
        </div>
        <div style={{ fontSize: 7.5, color: "#666", fontStyle: "italic", lineHeight: 1.35 }}>
          W przypadku braku jakichkolwiek pisemnych zastrzeżeń ze strony dostawcy, zamówienie (PO) uznaje się za zaakceptowane, nawet jeśli nie zostało podpisane, opieczętowane ani odesłane przez dostawcę. Dostawca ponosi odpowiedzialność za jakość produktu aż do momentu dostarczenia go do miejsca docelowego, pod warunkiem że wszystkie warunki transportu zostały prawidłowo spełnione.
        </div>
      </div>
    </div>
  );
}

// ─── PRINT MODAL ────────────────────────────────────────────────────────────
function PrintModal({ order, onClose }: any) {
  const { alert: pmAlert, dialogNode: pmNode } = useConfirm(); // P2-6 completion
  // Inject a hidden iframe into the current document, populate it with the
  // A4-styled print HTML, then call print on the iframe's window.
  // This approach is more reliable than window.open + document.write, because
  //   (1) iframes are not blocked by popup blockers,
  //   (2) it works inside sandboxed contexts like StackBlitz preview,
  //   (3) document.write is treated as deprecated in modern Chrome.
  function printDoc() {
    const node = document.getElementById("po-print-doc");
    if (!node) {
      pmAlert({ tone: "warn", title: "Print", message: "Print preview not ready — please try again in a moment." });
      return;
    }

    // Remove any leftover print frame from a previous run
    const existing = document.getElementById("po-print-frame");
    if (existing) existing.remove();

    // Create the hidden iframe
    const iframe = document.createElement("iframe");
    iframe.id = "po-print-frame";
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${order.number}</title>
<style>
  @page { size: A4; margin: 12mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: Calibri, Arial, sans-serif;
    color: #111;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  #po-print-doc { width: 186mm; margin: 0 auto; }
  table { page-break-inside: avoid; border-collapse: collapse; }
  tr { page-break-inside: avoid; page-break-after: auto; }
  img { max-width: 100%; }
</style>
</head>
<body>${node.outerHTML}</body>
</html>`;

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      pmAlert({ tone: "warn", title: "Print", message: "Unable to open the print preview window. Please try again." });
      iframe.remove();
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    // Wait for the embedded base64 logo image to load before triggering print
    const fire = () => {
      // v6.18.8 (#1): the browser's "Save as PDF" uses the top document's title for
      // the default filename, so temporarily set it to the PO number, then restore.
      // v6.34.2: the browser reads the TOP document's title for the Save-as-PDF
      // filename when the user CONFIRMS the save — long after print() returns. Restore
      // on afterprint (real dialog close), not a 1s timeout, so the number sticks.
      const prevTitle = document.title;
      document.title = order.number || prevTitle;
      const restore = () => { document.title = prevTitle; iframe.remove(); };
      try {
        iframe.contentWindow?.focus();
        const w = iframe.contentWindow as any; if (w) w.onafterprint = restore;
        iframe.contentWindow?.print();
      } catch (e) {
        console.error("Print failed:", e);
        pmAlert({ tone: "warn", title: "Print", message: "Printing failed. Try opening the artifact in its own window and printing from there." });
      }
      setTimeout(() => { if (document.title === (order.number || prevTitle)) restore(); }, 60000);
    };

    // The image inside the iframe needs to finish loading first
    const img = doc.querySelector("img");
    if (img && !img.complete) {
      img.addEventListener("load", () => setTimeout(fire, 100));
      img.addEventListener("error", () => setTimeout(fire, 100));
      // Safety fallback: fire after 2s even if events don't trigger
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
            <button onClick={printDoc} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #2563EB", background: "#2563EB", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>🖨 Print / Save as PDF</button>
            <button onClick={onClose} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Close</button>
          </div>
        </div>
        <div style={{ padding: 24, overflowY: "auto", background: "#ECECEC" }}>
          {/* On-screen preview sized to mimic an A4 sheet */}
          <div id="po-print-doc" style={{ background: "#fff", padding: "8mm", boxShadow: "0 2px 12px rgba(0,0,0,0.15)", width: "186mm", margin: "0 auto", boxSizing: "content-box" }}>
            <PODoc order={order} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── EMAIL MODAL ────────────────────────────────────────────────────────────
// v6.18.14 (#1): resolve the supplier email LIVE from Contacts at send time, so an
// email added/changed in Contacts after the PO was created is seen without a refresh.
// Falls back to the copy embedded on the PO.
function bestContactEmail(cp: any) {
  const cs = (cp && cp.contacts) || [];
  const withEmail = cs.find((p: any) => p.isPrimary && p.email) || cs.find((p: any) => p.email);
  return (withEmail && withEmail.email) || (cp && cp.email) || "";
}
function liveEmailForOrder(order: any, contacts: any[]) {
  const sid = order && order.supplier && order.supplier.id;
  const live = (sid != null) ? (contacts || []).find((c: any) => String(c.id) === String(sid)) : null;
  return bestContactEmail(live) || (order && order.supplier && order.supplier.email) || "";
}

function EmailModal({ order, contacts = [], onClose }: any) {
  const { alert: emAlert, dialogNode: emNode } = useConfirm(); // P2-6 completion
  const resolvedEmail = liveEmailForOrder(order, contacts);
  const [subject, setSubject] = useState(`Purchase Order ${order.number} — ${COMPANY.name}`);
  const [body, setBody] = useState(`Dear ${order.supplier?.name || "Sir/Madam"},\n\nPlease find attached our Purchase Order ${order.number} for ${order.items.map(i => `${fmtNum(i.qty)} kg ${i.product}${i.variety ? " " + i.variety : ""}`).join(", ")}.\n\nPurchase Incoterm: ${order.buyIncoterm}\nLoading: ${formatDMY(order.loadingDate)}\nPayment: ${order.paymentTerms === "Other" ? order.paymentTermsOther : order.paymentTerms}\n\nKindly confirm receipt and the loading schedule.\n\nBest regards,\n${COMPANY.name}`);

  // ── Step 1: Open the print dialog so the user can "Save as PDF" ──
  // Same hidden-iframe approach as PrintModal so it works in sandboxed contexts.
  function openPrintForPdf() {
    const node = document.getElementById("po-print-doc");
    if (!node) {
      emAlert({ tone: "warn", title: "Print", message: "Print preview not ready — please try again in a moment." });
      return;
    }
    const existing = document.getElementById("po-email-print-frame");
    if (existing) existing.remove();
    const iframe = document.createElement("iframe");
    iframe.id = "po-email-print-frame";
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${order.number}</title>
<style>
  @page { size: A4; margin: 12mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: Calibri, Arial, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  #po-print-doc { width: 186mm; margin: 0 auto; }
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

  // ── Step 2: Open the user's email client with the draft message ──
  function openMailClient() {
    const to = resolvedEmail || "";
    const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      {emNode}
      <div style={{ background: "#fff", borderRadius: 14, width: 620, maxHeight: "92vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #EBEBEB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Email PO to {order.supplier?.name}</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Two-step send · PDF download, then email draft</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#999", cursor: "pointer" }}>×</button>
        </div>

        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Honest explanation of the workflow */}
          <div style={{ padding: "12px 14px", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, fontSize: 12, color: "#92400E", lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ Interim workflow — no backend yet</div>
            Until the email backend is built, sending happens in two steps:
            <ol style={{ margin: "6px 0 0 18px", padding: 0 }}>
              <li>Click <strong>Save PDF</strong> below — the print dialog opens. Choose <em>Save as PDF</em> as the destination, save the file (e.g. to your Desktop).</li>
              <li>Click <strong>Open email draft</strong> — your default mail app (Outlook, Apple Mail, Gmail) opens with the message pre-filled. Drag the saved PDF into the email as an attachment, then hit Send.</li>
            </ol>
          </div>

          <div><Lbl>TO</Lbl><Inp value={resolvedEmail || "(supplier email missing in Contacts)"} disabled style={{ background: "#F9FAFB", color: "#666" }} /></div>
          <div><Lbl>SUBJECT</Lbl><Inp value={subject} onChange={e => setSubject(e.target.value)} /></div>
          <div><Lbl>MESSAGE</Lbl><textarea value={body} onChange={e => setBody(e.target.value)} rows={10} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", outline: "none", resize: "vertical", lineHeight: 1.6 }} /></div>

          {/* Hidden PO document used for PDF generation — kept off-screen */}
          <div style={{ position: "absolute", left: -99999, top: 0 }}>
            <div id="po-print-doc" style={{ width: "186mm" }}>
              <PODoc order={order} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", borderTop: "1px solid #F3F4F6", paddingTop: 14, marginTop: 4 }}>
            <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button onClick={openPrintForPdf} style={{ padding: "8px 16px", borderRadius: 7, border: "1px solid #2563EB", background: "#fff", color: "#2563EB", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>① Save PDF</button>
            <button
              onClick={openMailClient}
              disabled={!resolvedEmail}
              title={!resolvedEmail ? "Supplier email missing in Contacts" : ""}
              style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: resolvedEmail ? "#16A34A" : "#D1D5DB", color: "#fff", fontSize: 13, fontWeight: 600, cursor: resolvedEmail ? "pointer" : "not-allowed" }}>
              ② Open email draft →
            </button>
          </div>

          {/* Backend roadmap note */}
          <div style={{ fontSize: 10.5, color: "#9CA3AF", lineHeight: 1.5, paddingTop: 4, fontStyle: "italic" }}>
            Coming with the backend: PDF auto-generation server-side, automatic attachment, send via Marianna's SMTP, delivery tracking, and a "Sent" timestamp on the PO.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LIFECYCLE TIMELINE ─────────────────────────────────────────────────────
function LifecycleTimeline({ status }: any) {
  // v6.13 (#1): standardised to match the Sales Order lifecycle bar (pill chips
  // with check-marks for completed stages) so PO and SO read the same way.
  const stages = STATUS_LIFECYCLE;
  const currentIdx = stages.indexOf(status);
  const isCancelled = status === "Cancelled";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      {stages.map((s, i) => {
        const past = !isCancelled && i < currentIdx;
        const current = !isCancelled && i === currentIdx;
        const palette = PO_STATUSES[s] || { bg: "#F3F4F6", color: "#6B7280" };
        return (
          <React.Fragment key={s}>
            <div style={{
              padding: "4px 9px", borderRadius: 14, fontSize: 10.5, fontWeight: 600,
              background: current ? palette.bg : (past ? "#F3F4F6" : "#FAFAFA"),
              color: current ? palette.color : (past ? "#374151" : "#CCC"),
              border: current ? `1px solid ${palette.color}` : "1px solid transparent",
              whiteSpace: "nowrap",
            }}>{past && "✓ "}{s}</div>
            {i < stages.length - 1 && <div style={{ width: 8, height: 1, background: past ? "#9CA3AF" : "#E5E7EB" }} />}
          </React.Fragment>
        );
      })}
      {isCancelled && <span style={{ marginLeft: 8, padding: "4px 9px", borderRadius: 14, fontSize: 10.5, fontWeight: 600, background: "#FEE2E2", color: "#DC2626" }}>✕ Cancelled</span>}
    </div>
  );
}

// ─── ORDER FORM ─────────────────────────────────────────────────────────────

// Batch 6b hard gate: a PO leaving Draft — or being printed/emailed to the
// producer — must carry its purchase terms. "CIF" without "CIF Alexandria" is
// only half the contract, so the incoterm and its named place gate together.
function poTermsMissing(o: any): string | null {
  if (!o?.buyIncoterm) return "the purchase incoterm";
  if (!(o?.destinationLocationId || (o?.destinationText || "").trim())) return `the named place for ${o.buyIncoterm}`;
  return null;
}

function OrderForm({ order, setOrder, productSuggestions = [], suppliers = SUPPLIERS, contacts = [], allSOs = [], allShipments = [], lots = [], productCatalog = [], setProductCatalog, onSave, onCancel, onPrint, onEmail }: any) {
  const { alert: ofAlert, dialogNode: ofPONode } = useConfirm(); // P2-6 completion
  const sf = (k, v) => setOrder(o => ({ ...o, [k]: v }));
  const si = (idx, k, v) => setOrder(o => { const it = [...o.items]; it[idx] = { ...it[idx], [k]: v }; return { ...o, items: it }; });
  // v6.10 (#9): goods can't be Shipped (or beyond) before they are loaded at origin.
  const SHIP_OR_LATER = ["Shipped", "Arrived", "Closed"];

  // v6.18.5 (P0-5) + v6.18.14 (#3): once anything downstream depends on this PO — a
  // linked SO line, a non-cancelled shipment, or a lot that's been received/moved — the
  // PO is the base of the structure and is FULLY locked: no field edits and no status
  // change at all (including revert-to-Draft and Cancel). It can only be removed by
  // unlinking every downstream document first, then deleting.
  const poNum = order.number;
  const hasLinkedSO = (allSOs || []).some((so: any) => so.status !== "Cancelled" && (so.items || []).some((it: any) => it.sourceType === "PO" && it.sourceRef === poNum));
  const hasShipment = (allShipments || []).some((sh: any) => (sh.poRefs || []).includes(poNum) && sh.status !== "Cancelled");
  // v6.35.0: a lot whose linked shipments are ALL cancelled must not keep the PO locked —
  // otherwise cancelling everything to fix the PO leaves it permanently trapped. We treat a
  // lot as "really received/moved" only if it has a non-cancelled shipment, OR it carries
  // manual movements that are not shipment-driven receipts.
  const shipmentsForLot = (lotNo: string) => (allShipments || []).filter((sh: any) =>
    (sh.lotRefs || []).map(String).includes(String(lotNo)) ||
    (sh.goods || []).some((g: any) => String(g.lotRef) === String(lotNo)));
  const lotReceivedOrMoved = (lots || []).some((l: any) => {
    if (l.poRef !== poNum) return false;
    const received = (parseFloat(l.receivedKg) > 0) || (parseFloat(l.physicalKg) > 0) || ((l.movements || []).length > 0);
    if (!received) return false;
    // If this lot has any linked shipment, only a NON-cancelled one keeps it "live".
    const shs = shipmentsForLot(l.number);
    if (shs.length > 0) return shs.some((sh: any) => sh.status !== "Cancelled");
    // No shipments at all: a lot with real received kg / movements is a genuine manual receipt → still locks.
    return received;
  });
  const hasDependents = hasLinkedSO || hasShipment || lotReceivedOrMoved;
  const terminalStatus = ["Arrived", "Shipped", "Closed", "Cancelled", "Invoiced"].includes(order.status);
  const isLocked = !!order.id && (hasDependents || (order.status !== "Draft" && terminalStatus)); // fully locked once anything depends on it

  const setStatus = (newStatus) => {
    recordAudit({ module: "Purchase orders", docType: "PO", docNumber: order.number, action: newStatus === "Cancelled" ? "cancelled" : "status", summary: `Status → ${newStatus}` });
    if (hasDependents) {
      const what = [hasLinkedSO && "a Sales Order", hasShipment && "a shipment", lotReceivedOrMoved && "received / moved inventory"].filter(Boolean).join(", ");
      ofAlert({ tone: "warn", title: "PO locked", message: `This PO is locked: it has downstream dependents (${what}).\n\nWhile anything is linked, its status can't be changed (including back to Draft) or cancelled — that would corrupt the linked records. Unlink all downstream documents first, then the PO can be changed or deleted.` });
      return;
    }
    if (SHIP_OR_LATER.includes(newStatus) && order.loadingDate && String(order.loadingDate) > localTodayISO()) {
      ofAlert({ tone: "warn", title: "Too early", message: `This PO can't be set to "${newStatus}" yet — the loading date (${order.loadingDate}) hasn't been reached.\n\nGoods can't leave origin before they are loaded. Update the loading date if it has actually changed, or wait until the loading date.` });
      return;
    }
    sf("status", newStatus);
  };
  const WAREHOUSE_ADDRESS = (warehouseAddressLocations(contacts || [])[0] || {}).address || (warehouseAddressLocations(contacts || [])[0] || {}).name || "";
  const addItem = () => setOrder(o => ({ ...o, items: [...o.items, { id: nextId(), product: "", variety: "", cnCode: "", coloration: "", origin: "", size: "", quality: "I", unit: "Kg", qty: "", pallets: "", boxes: "", unitPrice: "", currency: o.currency || "PLN", packaging: "" }] }));
  const removeItem = (idx) => setOrder(o => ({ ...o, items: o.items.filter((_, i) => i !== idx) }));
  const sSupplier = (name) => sf("supplier", suppliers.find(s => s.name === name) || null);
  const showOtherTerms = order.paymentTerms === "Other";

  const total = netTotal(order.items);
  const totalKg = totalQtyKg(order.items);
  const totalInPLN = total * (parseFloat(order.fxRate) || FX_RATES[order.currency] || 1);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {ofPONode}
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#2563EB", fontWeight: 500 }}>← Purchase Orders</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          {order.id && (() => {
            const isDraft = order.status === "Draft";
            const draftStyle = {
              padding: "5px 14px", borderRadius: 7, border: "1px solid #E5E7EB",
              background: isDraft ? "#F9FAFB" : "#fff",
              color: isDraft ? "#9CA3AF" : "#111",
              fontSize: 12, fontWeight: 600,
              cursor: isDraft ? "not-allowed" : "pointer"
            };
            const tip = isDraft ? "Confirm the PO first — drafts cannot be printed or sent to suppliers" : "";
            return <>
              <button onClick={isDraft ? undefined : onPrint} disabled={isDraft} title={tip} style={draftStyle}>🖨 Print / PDF</button>
              <button onClick={isDraft ? undefined : onEmail} disabled={isDraft} title={tip} style={draftStyle}>✉ Email Supplier</button>
            </>;
          })()}
          <button onClick={onCancel} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          <button onClick={() => onSave(order)} style={{ padding: "5px 16px", borderRadius: 7, border: "none", background: "#111", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Save</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, gap: 20 }}>
            <div style={{ minWidth: 0, flex: "1 1 auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                <StatusBadge status={order.status || "Draft"} />
                {(order.buyIncoterm || order.tradeMovement) && <FlowBadge order={order} />}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#111", fontFamily: "ui-monospace, Menlo, monospace" }}>{order.id ? order.number : "New Purchase Order"}</div>
              <div style={{ fontSize: 12, color: "#AAA", marginTop: 2 }}>{isLocked ? "Locked — commercial terms can't change; downstream records depend on this PO" : order.status !== "Draft" && order.id ? "Confirmed — still editable (nothing depends on it yet); edits re-sync the expected lot" : "Draft — all fields editable"}</div>
            </div>
            <div style={{ textAlign: "right", flex: "0 0 auto", whiteSpace: "nowrap" }}>
              <div style={{ fontSize: 11, color: "#888" }}>Total net</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#111" }}>{fmtMoney(total, order.currency)}</div>
              {order.currency !== "PLN" && <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{fmtMoney(totalInPLN, "PLN")} · rate {order.fxRate}</div>}
              <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{fmtNum(totalKg)} kg total</div>
            </div>
          </div>

          {isLocked && (
            <div style={{ marginBottom: 16, padding: "11px 14px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, fontSize: 12.5, color: "#92400E", lineHeight: 1.5 }}>
              🔒 <strong>This PO is locked.</strong> Its commercial terms (product, quantities, supplier, incoterm, flow, pricing) can't be changed because something downstream already depends on it{(() => {
                const reasons = [hasLinkedSO && "a sales order is sourced from it", hasShipment && "a shipment references it", lotReceivedOrMoved && "its goods have been received or moved"].filter(Boolean);
                return reasons.length ? ` — ${reasons.join(", ")}` : "";
              })()}. Every field is now locked — the PO is the building block the whole deal is built on, so once anything references it, it's frozen. To change anything, cancel this PO and raise a new one.
            </div>
          )}
          {!isLocked && order.id && order.status !== "Draft" && (
            <div style={{ marginBottom: 16, padding: "11px 14px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, fontSize: 12.5, color: "#1E40AF", lineHeight: 1.5 }}>
              ✎ <strong>Confirmed, and still editable.</strong> Nothing depends on this PO yet (no sales order, no shipment, goods not received), so you can still change its details — saving will re-sync the expected inventory lot. ⚠ As soon as you link a sales order, create a shipment, or receive goods, THIS PO LOCKS COMPLETELY — every field becomes read-only and can't be changed again. Get the details right now. (Reverting to Draft withdraws the not-yet-received lot.)
            </div>
          )}

          {/* Header card */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>ORDER DETAILS</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
              <div>
                <Lbl>Status</Lbl>
                <Sel value={order.status || "Draft"} onChange={e => setStatus(e.target.value)} disabled={hasDependents || order.status === "Cancelled"}
                  title={order.status === "Cancelled" ? "This PO is cancelled — kept for the record, read-only, and can't be reactivated." : hasDependents ? "Locked — a Sales Order, shipment or inventory depends on this PO. Unlink everything first." : ""}
                  style={{ borderLeft: `4px solid ${(PO_STATUSES[order.status || "Draft"] || {}).color || "#9CA3AF"}`, fontWeight: 700, color: (PO_STATUSES[order.status || "Draft"] || {}).color || "#111" }}>
                  {Object.keys(PO_STATUSES).map(s => <option key={s}>{s}</option>)}
                </Sel>
              </div>
              <div>
                <Lbl>PO number <span style={{ color: "#16A34A", fontWeight: 500 }}>· system number{!order.id ? ", auto-generated" : ""}</span></Lbl>
                {/* BP-6: number is a controlled document id — display/copy only, never edited. */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", border: "1px solid #E5E7EB", borderRadius: 8, background: "#F8FAFC", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, fontWeight: 700, color: "#334155" }}>
                  <span>{order.number || "PO-2026-…"}</span>
                  <button type="button" onClick={() => { try { navigator.clipboard.writeText(order.number || ""); } catch {} }} title="Copy PO number" style={{ marginLeft: "auto", border: "1px solid #E5E7EB", background: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 11, cursor: "pointer", fontWeight: 700, color: "#64748B" }}>Copy</button>
                </div>
              </div>
              <div>
                <Lbl>Order date</Lbl>
                <Inp disabled={isLocked} value={order.orderDate} onChange={e => sf("orderDate", e.target.value)} type="date" max={localTodayISO()} title="The date the PO was created/agreed with the supplier" />
              </div>
              <div>
                <Lbl>Loading date</Lbl>
                <Inp disabled={isLocked} value={order.loadingDate} onChange={e => sf("loadingDate", e.target.value)} type="date" title="When the supplier loads our truck / container — goods leave origin" />
                <div style={{ fontSize: 10, color: "#AAA", marginTop: 3, lineHeight: 1.4 }}>Goods leave origin</div>
              </div>
              <div>
                <Lbl>Expected delivery date</Lbl>
                <Inp disabled={isLocked} value={order.expectedDeliveryDate} onChange={e => sf("expectedDeliveryDate", e.target.value)} type="date" title="When the goods are expected to arrive at the agreed handover point" />
                {/* FB-14: 'means' dropdown removed — the handover point (derived from the incoterm) already says where. */}
              </div>
              <div>
                <Lbl>Actual availability</Lbl>
                {/* BP-9: no longer typed here — the real date comes from the Shipment arrival /
                    Inventory receipt event. Shown read-only when known. */}
                <div style={{ padding: "9px 11px", border: "1px dashed #E5E7EB", borderRadius: 8, background: "#FAFAFA", fontSize: 12.5, color: order.actualAvailabilityDate ? "#334155" : "#9CA3AF" }}>
                  {order.actualAvailabilityDate ? `${order.actualAvailabilityDate} · from arrival/receipt` : "From shipment arrival / inventory receipt"}
                </div>
                <div style={{ fontSize: 10, color: "#AAA", marginTop: 3, lineHeight: 1.4 }}>Fill once it arrives</div>
              </div>
              <div style={{ gridColumn: "span 3" }}>
                <Lbl>Supplier</Lbl>
                <Sel disabled={isLocked} value={order.supplier?.name || ""} onChange={e => sSupplier(e.target.value)}>
                  <option value="">— select —</option>
                  {suppliers.map(s => <option key={s.id} value={s.name}>{s.name} {s.country ? `· ${s.country}` : ""} {s.nip ? `(NIP ${s.nip})` : ""}</option>)}
                </Sel>
              </div>
            </div>
          </Card>

          {/* Flow + Incoterm + Sea */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>FLOW · PURCHASE INCOTERM · DESTINATION</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              {/* ═══ Batch 6b (BP-56 final): PURCHASE TERMS — the contract, not the machinery.
                  Incoterm + named place are THE inputs; movement + handover derive; the
                  direct-ness derives live from the governing sale (poDirectFromSOs at save). */}
              <div style={{ gridColumn: "1 / -1", border: "1px solid #E0E7FF", background: "#F5F7FF", borderRadius: 10, padding: "12px 14px", marginBottom: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#4338CA", letterSpacing: "0.04em", marginBottom: 8 }}>INCOTERM DELIVERY (PURCHASE) <span style={{ fontWeight: 500, color: "#818CF8" }}>· required to confirm / print / send</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 10 }}>
                  <div>
                    <Lbl>Purchase incoterm *</Lbl>
                    <Sel value={order.buyIncoterm || ""} onChange={e => { const inc = e.target.value; setOrder(o => {
                      const hp = handoverPointForIncoterm(inc);
                      // v6.34.1 (item 1): default the delivery place per the incoterm, mirroring the SO.
                      // EXW/FCA → supplier's address; DAP/DDP → our warehouse address; FOB/CFR/CIF → leave for a port pick.
                      const ic = String(inc).toUpperCase();
                      let patch: any = { ...o, buyIncoterm: inc, purchaseIncoterm: inc, handoverPoint: hp || o.handoverPoint };
                      if (ic === "EXW" || ic === "FCA") { patch.destinationLocationId = null; patch.destinationText = o.supplier?.address || o.destinationText || ""; }
                      else if (ic === "DAP" || ic === "DDP") { patch.destinationLocationId = null; patch.destinationText = (WAREHOUSE_ADDRESS || "") || o.destinationText || ""; }
                      else { patch.destinationText = o.destinationText || ""; } // ports: user picks from the pool
                      return patch;
                    }); }} disabled={isLocked}>
                      <option value="">— select —</option>
                      {INCOTERMS_BUY.map(i => <option key={i.code} value={i.code}>{i.code}</option>)}
                    </Sel>
                  </div>
                  <div>
                    {(() => {
                      const pool = namedPlacePoolForIncoterm(order.buyIncoterm);
                      // v6.29.0: merge live warehouse addresses from Contacts (v6.18.3
                      // behaviour inherited from the removed legacy Destination field).
                      const liveWh = warehouseAddressLocations(contacts || []).map((l: any) => ({ ...l, type: l.legacyType }));
                      const byId = new Map<any, any>();
                      [...LOCATIONS, ...liveWh].forEach((l: any) => byId.set(String(l.id), l));
                      const all = Array.from(byId.values());
                      const opts = all.filter((l: any) => pool.types.includes(l.type));
                      const rest = all.filter((l: any) => !pool.types.includes(l.type));
                      return (<>
                        <Lbl>{pool.label} *</Lbl>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <Sel disabled={isLocked} value={order.destinationLocationId ?? ""} onChange={e => sf("destinationLocationId", e.target.value ? Number(e.target.value) : null)}>
                            <option value="">— select the named place —</option>
                            {opts.map((d: any) => <option key={d.id} value={d.id}>{d.name || d.label}</option>)}
                            {rest.length > 0 && <optgroup label="Other places">{rest.map((d: any) => <option key={d.id} value={d.id}>{d.name || d.label}</option>)}</optgroup>}
                          </Sel>
                          <Inp disabled={isLocked} value={order.destinationText || ""} onChange={e => sf("destinationText", e.target.value)} placeholder="…or type it (e.g. Alexandria)" />
                        </div>
                        <div style={{ fontSize: 10.5, color: "#6366F1", marginTop: 5 }}>{(() => {
                          const ic = String(order.buyIncoterm || "").toUpperCase();
                          if (!ic) return "Select the purchase incoterm — it sets what to fill here.";
                          if (ic === "EXW" || ic === "FCA") return `${ic} — pickup at the supplier's premises (defaults to the supplier address).`;
                          if (ic === "FOB") return "FOB — name the port of loading.";
                          if (ic === "CFR" || ic === "CIF") return `${ic} — name the port of discharge (destination port).`;
                          if (ic === "DAP") return "DAP — delivery place (defaults to our warehouse; change if elsewhere).";
                          if (ic === "DDP") return "DDP — delivered to our address (duties paid by the supplier).";
                          return "";
                        })()}</div>
                      </>);
                    })()}
                  </div>
                </div>
                {(() => {
                  // v6.43.0 (test-round #2): the provisional IMPORT/EXPORT chip is
                  // removed — trade direction is the shipment's truth, and a flow-era
                  // guess here was misleading (showed intra-EU on a CIF export). The
                  // contractual handover sentence stays; it's a fact of the incoterm.
                  const placeName = order.destinationText || (LOCATIONS.find((l: any) => l.id === order.destinationLocationId)?.name) || "";
                  if (!order.buyIncoterm) return null;
                  return (
                    <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "#FBFCFF", border: "1px dashed #E0E7FF", fontSize: 11.5, color: "#4338CA", lineHeight: 1.45 }}>
                      {handoverSentence(order.buyIncoterm, placeName)}
                    </div>
                  );
                })()}
              </div>
              {/* v6.29.0: the legacy Destination field is GONE — the named place in
                  PURCHASE TERMS is the single location fact on a PO (both wrote the
                  same stored keys, so nothing is lost). Onward routing belongs to the
                  shipment; disposition to the sale. */}
            </div>
            {/* v6.43.0 (test-round #3/#4): the "Sea freight involved" toggle is
                removed — transport planning (road/sea/multimodal legs) is owned by
                the Shipment module, not declared on the PO. */}
          </Card>

          {/* Pricing */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>PAYMENT · CURRENCY · FX</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 14 }}>
              <div>
                <Lbl>Payment terms</Lbl>
                <Sel disabled={isLocked} value={order.paymentTerms} onChange={e => sf("paymentTerms", e.target.value)}>
                  {PAYMENT_TERMS.map(p => <option key={p}>{p}</option>)}
                </Sel>
                {showOtherTerms && (
                  <div style={{ marginTop: 8 }}>
                    <Inp value={order.paymentTermsOther || ""} onChange={e => sf("paymentTermsOther", e.target.value)} placeholder="Specify the terms" />
                  </div>
                )}
              </div>
              <div>
                <Lbl>Pricing</Lbl>
                <Sel value={order.pricingMode || "firm"} onChange={e => sf("pricingMode", e.target.value)} disabled={isLocked}
                  title="Consignment: the producer's price is settled from your sales later — the PO saves WITHOUT purchase prices.">
                  <option value="firm">Firm price</option>
                  <option value="consignment">Consignment — settled on sales</option>
                </Sel>
              </div>
              <div>
                <Lbl>Currency</Lbl>
                <Sel value={order.currency} onChange={e => setOrder(o => ({ ...o, currency: e.target.value, items: (o.items || []).map(it => ({ ...it, currency: e.target.value })) }))} disabled={isLocked}>
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </Sel>
              </div>
              <div>
                <Lbl>FX rate to PLN {isLocked && <span style={{ color: "#888", fontWeight: 400 }}>(locked)</span>}</Lbl>
                <Inp type="number" value={order.fxRate ?? ""} onChange={e => sf("fxRate", e.target.value)} disabled={isLocked} />
                {order.fxLockedAt && <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>Locked on {order.fxLockedAt}</div>}
              </div>
            </div>
          </Card>

          {/* Line items */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle right={<button onClick={isLocked ? undefined : addItem} disabled={isLocked} title={isLocked ? "Confirmed PO — line items are locked" : ""} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #16A34A", background: "#fff", color: isLocked ? "#9CA3AF" : "#16A34A", fontSize: 11, fontWeight: 600, cursor: isLocked ? "not-allowed" : "pointer", opacity: isLocked ? 0.5 : 1 }}>+ Add line</button>}>LINE ITEMS ({order.items.length})</SectionTitle>
            {/* Shared datalist — product autocomplete pulls from this; grows as POs are added */}
            <datalist id="po-product-suggestions">
              {productSuggestions.map(p => <option key={p} value={p} />)}
            </datalist>
            <fieldset disabled={isLocked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            {order.items.map((it, i) => {
              const lineTotal = (parseFloat(it.qty) || 0) * (parseFloat(it.unitPrice) || 0);
              // Normalize product casing on blur — if user typed "golden delicious" but list has "Golden Delicious", match it
              return (
                <div key={i} style={{ marginBottom: 12, padding: 12, background: "#FAFAFA", borderRadius: 8, border: "1px solid #F3F4F6" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "2.2fr 1fr 0.9fr 1fr 1.3fr 1.2fr 1.2fr 34px", gap: 8, alignItems: "end" }}>
                    <div>
                      <Lbl>Item / Variety</Lbl>
                      <ItemVarietyPicker catalog={productCatalog} setCatalog={setProductCatalog} item={it.product || ""} variety={it.variety || ""} onItem={(v: string) => {
                        // v6.34.1 (BP-8): auto-fill CN/HS from the catalog on product pick,
                        // empty-only so a manually-entered code is never overwritten.
                        setOrder(o => ({ ...o, items: o.items.map((row: any, ri: number) => {
                          if (ri !== i) return row;
                          const cn = (!row.cnCode || !String(row.cnCode).trim()) ? cnCodeForItem(productCatalog, v) : row.cnCode;
                          return { ...row, product: v, cnCode: cn };
                        }) }));
                      }} onVariety={(v: string) => si(i, "variety", v)} />
                    </div>
                    <div><Lbl>Origin</Lbl><Inp value={it.origin} onChange={e => si(i, "origin", e.target.value)} placeholder="Poland" /></div>
                    <div><Lbl>Size</Lbl><Inp value={it.size} onChange={e => si(i, "size", e.target.value)} placeholder="70-80" /></div>
                    <div><Lbl>Quality</Lbl><Sel value={it.quality} onChange={e => si(i, "quality", e.target.value)}>{QUALITY_GRADES.map(q => <option key={q}>{q}</option>)}</Sel></div>
                    <div><Lbl>Qty (kg)</Lbl><Inp type="number" value={it.qty} onChange={e => si(i, "qty", e.target.value)} placeholder="e.g. 19500" /></div>
                    <div><Lbl>Unit price</Lbl>{(order.pricingMode || "firm") === "consignment"
                      ? <div style={{ padding: "8px 10px", border: "1px dashed #D8B4FE", borderRadius: 6, fontSize: 12, color: "#7C3AED", background: "#FAF5FF", fontWeight: 600 }} title="Consignment — the producer's price is settled from your sales">Consignment ⚖</div>
                      : <Inp type="number" value={it.unitPrice} onChange={e => si(i, "unitPrice", e.target.value)} placeholder="e.g. 2.80" />}</div>
                    <div><Lbl>Line total</Lbl><div style={{ padding: "8px 10px", fontSize: 13, fontWeight: 700, color: "#111", whiteSpace: "nowrap" }}>{lineTotal.toLocaleString("pl-PL", { minimumFractionDigits: 2 })}</div></div>
                    <button onClick={() => removeItem(i)} disabled={order.items.length <= 1} style={{ height: 33, padding: "0 6px", border: "1px solid #FECACA", borderRadius: 6, background: "#fff", color: "#DC2626", fontSize: 11, cursor: order.items.length <= 1 ? "not-allowed" : "pointer", opacity: order.items.length <= 1 ? 0.4 : 1 }}>🗑</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 0.7fr 0.7fr 0.9fr", gap: 8, marginTop: 8 }}>
                    <div><Lbl>Coloration</Lbl><Inp value={it.coloration} onChange={e => si(i, "coloration", e.target.value)} placeholder="przełamany / red / etc." /></div>
                    <div><Lbl>Packaging</Lbl><Inp value={it.packaging} onChange={e => si(i, "packaging", e.target.value)} placeholder="13 kg wooden box / 5 kg carton / 10 kg mesh bag" /></div>
                    <div><Lbl>Boxes</Lbl><Inp type="number" value={it.boxes ?? ""} onChange={e => si(i, "boxes", e.target.value)} placeholder="e.g. 1500" /></div>
                    <div><Lbl>Pallets</Lbl><Inp type="number" value={it.pallets ?? ""} onChange={e => si(i, "pallets", e.target.value)} placeholder="e.g. 24" /></div>
                    <div><Lbl>CN / HS code</Lbl><Inp value={it.cnCode ?? ""} onChange={e => si(i, "cnCode", e.target.value)} placeholder="e.g. 0808 10" title="Customs tariff code for this item — carried to the SO and shipment" /></div>
                  </div>
                </div>
              );
            })}
            </fieldset>
          </Card>

          {/* Notes */}
          <Card>
            <SectionTitle>NOTES</SectionTitle>
            <textarea disabled={isLocked} value={order.notes || ""} onChange={e => sf("notes", e.target.value)} rows={4} placeholder="Special instructions, packing requirements, labels…"
              style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", outline: "none", resize: "vertical", lineHeight: 1.6 }} />
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── ORDER DETAIL ───────────────────────────────────────────────────────────
function OrderDetail({ order, onBack, onEdit, onDelete, onPrint, onEmail, computedShipments = [], computedSOs = [] }: any) {
  const total = netTotal(order.items);
  const totalKg = totalQtyKg(order.items);
  const totalPLN = plnTotal(order);
  const dest = locById(order.destinationLocationId);
  const destLabel = destinationDisplay(order);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#2563EB", fontWeight: 500 }}>← Purchase Orders</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          {(() => {
            const isDraft = order.status === "Draft";
            const draftStyle = {
              padding: "5px 14px", borderRadius: 7, border: "1px solid #E5E7EB",
              background: isDraft ? "#F9FAFB" : "#fff",
              color: isDraft ? "#9CA3AF" : "#111",
              fontSize: 12, fontWeight: 600,
              cursor: isDraft ? "not-allowed" : "pointer"
            };
            const tip = isDraft ? "Confirm the PO first — drafts cannot be printed or sent to suppliers" : "";
            return <>
              <button onClick={isDraft ? undefined : onPrint} disabled={isDraft} title={tip} style={draftStyle}>🖨 Print / PDF</button>
              <button onClick={isDraft ? undefined : onEmail} disabled={isDraft} title={tip} style={draftStyle}>✉ Email</button>
            </>;
          })()}
          {order.status === "Cancelled"
            ? <span style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #FECACA", background: "#FEF2F2", color: "#B91C1C", fontSize: 12, fontWeight: 600 }}>Cancelled — read-only</span>
            : <button onClick={onEdit} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #2563EB", background: "#fff", color: "#2563EB", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>✎ Edit</button>}
          <button onClick={onDelete} style={{ padding: "5px 12px", borderRadius: 7, border: "none", color: "#fff", background: "#DC2626", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Delete</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 20 }}>
            <div style={{ minWidth: 0, flex: "1 1 auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                <StatusBadge status={order.status} />
                {(order.buyIncoterm || order.tradeMovement) && <FlowBadge order={order} />}
                <VarianceBadge variance={order.variance} />
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#111", fontFamily: "ui-monospace, Menlo, monospace", marginBottom: 4 }}>{order.number}</div>
              <div style={{ fontSize: 13, color: "#444" }}>{order.supplier?.name} · {order.supplier?.country} {destLabel !== "—" && <>· destination {dest ? LOCATION_TYPES[dest.type]?.icon : "📍"} {destLabel}</>}</div>
            </div>
            <div style={{ textAlign: "right", flex: "0 0 auto", whiteSpace: "nowrap" }}>
              <div style={{ fontSize: 11, color: "#888" }}>Total value</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#111" }}>{fmtMoney(total, order.currency)}</div>
              {order.currency !== "PLN" && <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{fmtMoney(totalPLN, "PLN")} · rate {order.fxRate}</div>}
              <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{fmtNum(totalKg)} kg total</div>
            </div>
          </div>

          {/* Lifecycle */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>LIFECYCLE</SectionTitle>
            <LifecycleTimeline status={order.status} />
          </Card>

          {/* Two-column body */}
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 20 }}>
            <div>
              {/* Line items */}
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle>LINE ITEMS ({order.items.length})</SectionTitle>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: "#F9FAFB" }}>
                      {["Product", "Origin", "Size", "Kl.", "Packaging", "Boxes", "Qty kg", "Unit price", "Total"].map((h, i) => (
                        <th key={i} style={{ padding: "8px 10px", textAlign: i >= 5 ? "right" : "left", fontSize: 10, fontWeight: 700, color: "#888", letterSpacing: "0.06em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((it, i) => {
                      const lt = (parseFloat(it.qty) || 0) * (parseFloat(it.unitPrice) || 0);
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                          <td style={{ padding: "10px", fontWeight: 600 }}>
                            {it.product}{it.variety ? <span style={{ fontWeight: 400, color: "#666" }}> — {it.variety}</span> : null}
                            {it.coloration && <div style={{ fontSize: 10.5, color: "#AAA", fontWeight: 400 }}>{it.coloration}</div>}
                          </td>
                          <td style={{ padding: "10px", color: "#555" }}>{it.origin || "—"}</td>
                          <td style={{ padding: "10px", color: "#555" }}>{it.size || "—"}</td>
                          <td style={{ padding: "10px" }}><QualityBadge quality={it.quality} /></td>
                          <td style={{ padding: "10px", color: "#666", fontSize: 11.5 }}>{it.packaging || "—"}</td>
                          <td style={{ padding: "10px", textAlign: "right", color: "#555" }}>{it.boxes ? fmtNum(it.boxes) : "—"}</td>
                          <td style={{ padding: "10px", textAlign: "right", fontWeight: 600 }}>{fmtNum(it.qty)}</td>
                          <td style={{ padding: "10px", textAlign: "right" }}>{(order.pricingMode || "firm") === "consignment" ? <span style={{ color: "#7C3AED", fontWeight: 600 }}>Consignment ⚖</span> : <>{parseFloat(it.unitPrice || 0).toFixed(2)} {order.currency}</>}</td>
                          <td style={{ padding: "10px", textAlign: "right", fontWeight: 700 }}>{lt.toLocaleString("pl-PL", { minimumFractionDigits: 2 })}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: "#F9FAFB" }}>
                      <td colSpan={5} style={{ padding: "10px", fontWeight: 700, color: "#111" }}>Total</td>
                      <td style={{ padding: "10px", textAlign: "right", fontWeight: 700 }}>{fmtNum(order.items.reduce((s, it) => s + (parseFloat(it.boxes) || 0), 0)) || "—"}</td>
                      <td style={{ padding: "10px", textAlign: "right", fontWeight: 700 }}>{fmtNum(totalKg)} kg</td>
                      <td></td>
                      <td style={{ padding: "10px", textAlign: "right", fontWeight: 700, fontSize: 14 }}>{fmtMoney(total, order.currency)}</td>
                    </tr>
                  </tbody>
                </table>
              </Card>

              {/* v6.45.0: LINKED DOCUMENTS moved under Line items (user request) + renamed for consistency */}
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle>LINKED DOCUMENTS</SectionTitle>
                <LinkRow label="Sales orders" items={computedSOs} color="#16A34A" bg="#DCFCE7" />
                <LinkRow label="Shipments" items={computedShipments} color="#0284C7" bg="#E0F2FE" />
                <LinkRow label="Inventory lots" items={order.linkedLots} color="#92400E" bg="#FEF3C7" />
                <LinkRow label="Invoices" items={order.linkedInvoices} color="#16A34A" bg="#DCFCE7" />
                <div style={{ marginTop: 10, fontSize: 10.5, color: "#AAA", lineHeight: 1.5, fontStyle: "italic" }}>
                  Links are computed live: sales orders that source from this PO, shipments that carry it, and lots created from it.
                </div>
              </Card>

              {order.notes && (
                <Card style={{ marginBottom: 16 }}>
                  <SectionTitle>NOTES</SectionTitle>
                  <div style={{ fontSize: 12.5, color: "#444", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{order.notes}</div>
                </Card>
              )}
            </div>

            {/* Right column */}
            <div>
              {/* Supplier */}
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle>SUPPLIER</SectionTitle>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 4 }}>{order.supplier?.name}</div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>{order.supplier?.country}</div>
                {order.supplier?.nip && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, color: "#888" }}>NIP / VAT</div><div style={{ fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace" }}>{order.supplier.nip}</div></div>}
                {order.supplier?.address && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, color: "#888" }}>Address</div><div style={{ fontSize: 12, color: "#444" }}>{order.supplier.address}</div></div>}
                {order.supplier?.contact && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, color: "#888" }}>Contact</div><div style={{ fontSize: 12, color: "#444" }}>{order.supplier.contact}</div></div>}
                {order.supplier?.email && <div><div style={{ fontSize: 10, color: "#888" }}>Email</div><a href={`mailto:${order.supplier.email}`} style={{ fontSize: 12, color: "#2563EB", textDecoration: "none" }}>{order.supplier.email}</a></div>}
              </Card>

              {/* Dates + payment */}
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle>TERMS</SectionTitle>
                <div style={{ display: "grid", gap: 10, fontSize: 12 }}>
                  <div><div style={{ fontSize: 10, color: "#888" }}>ORDER DATE</div><div style={{ fontWeight: 500 }}>{fmtDate(order.orderDate)}</div></div>
                  <div title="When the supplier loads our truck/container — goods leave origin"><div style={{ fontSize: 10, color: "#888" }}>LOADING <span style={{ color: "#BBB", fontWeight: 400 }}>· goods leave origin</span></div><div style={{ fontWeight: 500 }}>{fmtDate(order.loadingDate)}</div></div>
                  <div title="When goods are expected to arrive at the destination"><div style={{ fontSize: 10, color: "#888" }}>EXPECTED DELIVERY <span style={{ color: "#BBB", fontWeight: 400 }}>· goods arrive</span></div><div style={{ fontWeight: 500 }}>{fmtDate(order.expectedDeliveryDate)}</div></div>
                  <div><div style={{ fontSize: 10, color: "#888" }}>PURCHASE INCOTERM</div><div style={{ fontWeight: 600 }}>{order.buyIncoterm || "—"}</div></div>
                  <div><div style={{ fontSize: 10, color: "#888" }}>DESTINATION</div><div style={{ fontWeight: 500 }}>{destLabel}</div></div>
                  <div>
                    <div style={{ fontSize: 10, color: "#888" }}>SEA FREIGHT</div>
<div style={{ fontWeight: 600, color: "#888" }}>—</div>
                  </div>
                  <div><div style={{ fontSize: 10, color: "#888" }}>PAYMENT</div><div style={{ fontWeight: 500 }}>{order.paymentTerms === "Other" ? (order.paymentTermsOther || "Other") : order.paymentTerms}</div></div>
                  <div><div style={{ fontSize: 10, color: "#888" }}>FX RATE</div><div style={{ fontWeight: 500, fontFamily: "ui-monospace, Menlo, monospace" }}>{order.fxRate} {order.currency} → PLN {order.fxLockedAt && <span style={{ fontSize: 10, color: "#AAA", fontFamily: "inherit" }}>(locked {order.fxLockedAt})</span>}</div></div>
                </div>
              </Card>

              {/* Variance (when arrived) */}
              {order.variance && order.variance.receivedKg != null && (
                <Card style={{ marginBottom: 16 }}>
                  <SectionTitle>QUANTITY VARIANCE</SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                    <div><div style={{ fontSize: 10, color: "#888" }}>EXPECTED</div><div style={{ fontSize: 16, fontWeight: 700 }}>{fmtNum(order.variance.expectedKg)} kg</div></div>
                    <div><div style={{ fontSize: 10, color: "#888" }}>RECEIVED</div><div style={{ fontSize: 16, fontWeight: 700 }}>{fmtNum(order.variance.receivedKg)} kg</div></div>
                  </div>
                  {(() => {
                    const delta = order.variance.receivedKg - order.variance.expectedKg;
                    const pct = (delta / order.variance.expectedKg) * 100;
                    if (delta === 0) return <div style={{ fontSize: 12, color: "#16A34A" }}>✓ Quantity matched exactly</div>;
                    return (
                      <div style={{ padding: "10px 12px", background: delta < 0 ? "#FEF3C7" : "#DBEAFE", border: `1px solid ${delta < 0 ? "#FDE68A" : "#BFDBFE"}`, borderRadius: 6, fontSize: 11.5, color: delta < 0 ? "#92400E" : "#1E40AF" }}>
                        <strong>{delta > 0 ? "Surplus" : "Shortfall"}:</strong> {Math.abs(delta).toLocaleString()} kg ({pct.toFixed(2)}%)
                      </div>
                    );
                  })()}
                </Card>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkRow({ label, items, color, bg }: any) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "#888", marginBottom: 4, letterSpacing: "0.04em" }}>{label.toUpperCase()}</div>
      {items?.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {items.map(ref => (
            <span key={ref} style={{ padding: "3px 8px", background: bg, color, border: `1px solid ${color}33`, borderRadius: 4, fontSize: 11, fontWeight: 600, fontFamily: "ui-monospace, Menlo, monospace" }}>{ref}</span>
          ))}
        </div>
      ) : <span style={{ fontSize: 11, color: "#CCC", fontStyle: "italic" }}>none yet</span>}
    </div>
  );
}


function uniqRefs(arr: any[] = []): string[] {
  return Array.from(
    new Set(
      (arr || [])
        .map((value: any) => String(value || "").trim())
        .filter((value: string) => value.length > 0)
    )
  );
}

function isInventoryTransferStatus(status) {
  return status && status !== "Draft" && status !== "Cancelled";
}



function poInventoryTransferErrors(order) {
  const errors = [];
  (order.items || []).forEach((it, idx) => {
    const line = `Line ${idx + 1}`;
    const qty = parseFloat(it.qty);
    const unitPrice = parseFloat(it.unitPrice);
    if (!String(it.product || "").trim()) errors.push(`${line}: product is missing`);
    if (!isFinite(qty) || qty <= 0) errors.push(`${line}: quantity must be greater than zero`);
    if ((order.pricingMode || "firm") !== "consignment" && (!isFinite(unitPrice) || unitPrice <= 0)) errors.push(`${line}: purchase price must be greater than zero`);
  });
  if (!(order.items || []).length) errors.push("At least one PO line is required");
  return errors;
}

function lotNumberYear(order) {
  const m = String(order.number || "").match(/PO-(\d{4})-/);
  return m ? m[1] : String(new Date().getFullYear());
}

function nextLotSerial(existingLots, year, offset = 1) {
  let max = 0;
  (existingLots || []).forEach(l => {
    const m = String(l.number || "").match(new RegExp(`LOT-${year}-(\\d+)`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return String(max + offset).padStart(4, "0");
}



function buildExpectedLotsFromPO(order, existingLots = []) {
  const year = lotNumberYear(order);
  const fx = parseFloat(order.fxRate) || 1;
  const existingForPO = (existingLots || []).filter(l => l.poRef === order.number);
  const lotRefs = [...existingForPO.map(l => l.number)];
  const newLots = [];
  const lotPatches = []; // v6.18.5 (P0-5): updates to existing not-yet-received lots

  (order.items || []).forEach((it, idx) => {
    const already = existingForPO.find(l => {
      // poLineId is authoritative: a lot matches its PO line by id. This prevents a
      // second line of the SAME product from colliding with the first line's lot
      // (the old name-fallback bug: two same-product lines → one lot, new line lost).
      if (String(l.poLineId || "") && String(l.poLineId) === String(it.id)) return true;
      if (String(l.poLineId || "")) return false; // has a (different) poLineId → not this line
      // Legacy lot with NO poLineId: fall back to product-name match, but only if no other
      // line already owns it and this is the first same-named line (idx-guarded).
      const nameMatch = String(l.product || "").trim().toLowerCase() === String(it.product || "").trim().toLowerCase();
      if (!nameMatch) return false;
      const firstSameNamedIdx = (order.items || []).findIndex(x => String(x.product || "").trim().toLowerCase() === String(it.product || "").trim().toLowerCase());
      return firstSameNamedIdx === idx;
    });

    const qty = parseFloat(it.qty) || 0;
    const unitPrice = parseFloat(it.unitPrice) || 0;
    const isConsignment = (order.pricingMode || "firm") === "consignment";
    const purchaseAmount = isConsignment ? 0 : Math.round(qty * unitPrice * 100) / 100;
    const purchasePLN = isConsignment ? 0 : Math.round(purchaseAmount * fx * 100) / 100;

    if (already) {
      // v6.18.5 (P0-5): a confirmed PO that nothing depends on yet stays editable,
      // and its edits SYNC the still-expected lot (instead of being silently ignored,
      // which is the old `if (already) return;` bug). Only touch lots that have NOT
      // received goods or moved — mirroring the prune guard — so real stock is safe.
      const untouched = !(parseFloat(already.receivedKg) > 0) && !(parseFloat(already.physicalKg) > 0) && !((already.movements || []).length);
      if (!untouched) return; // received/in-stock/moved → leave it exactly as is
      lotPatches.push({
        number: already.number,
        patch: {
          product: it.product || "Goods",
          variety: it.variety || "",
          cnCode: it.cnCode || "",
          quality: it.quality || "I",
          size: it.size || "",
          origin: it.origin || order.supplier?.country || "",
          poLineId: it.id ?? idx + 1,
          locationId: order.destinationLocationId || null,
          destinationText: destinationDisplay(order),
          directFlow: !!order.directFlow,
                    loadingDate: order.loadingDate || null,
          expectedKg: qty,
          packaging: it.packaging || "",
          status: order.directFlow ? "Direct Expected" : "Expected",
          arrivalDate: order.expectedDeliveryDate || null,
          consignment: isConsignment,
          // resync only the purchase cost line; keep any other cost lines (e.g. freight) intact
          costs: [
            ...((already.costs || []).filter((c: any) => c.type !== "purchase")),
            ...(isConsignment ? [] : [{ type: "purchase", label: `Purchase expected (${order.number})`, source: order.number, amount: purchaseAmount, currency: order.currency || "PLN", pln: purchasePLN }]),
          ],
        },
      });
      return;
    }

    const lotNumber = `LOT-${year}-${nextLotSerial([...(existingLots || []), ...newLots], year, 1)}`;
    lotRefs.push(lotNumber);
    newLots.push({
      id: nextId(),
      number: lotNumber,
      product: it.product || "Goods",
      variety: it.variety || "",
      cnCode: it.cnCode || "",
      quality: it.quality || "I",
      size: it.size || "",
      origin: it.origin || order.supplier?.country || "",
      poRef: order.number,
      poLineId: it.id ?? idx + 1,
      locationId: order.destinationLocationId || null,
      destinationText: destinationDisplay(order),
      directFlow: !!order.directFlow,
                  loadingDate: order.loadingDate || null,
      expectedKg: qty,
      receivedKg: 0,
      physicalKg: 0,
      damagedKg: 0,
      packaging: it.packaging || "",
      status: order.directFlow ? "Direct Expected" : "Expected",
      arrivalDate: order.expectedDeliveryDate || null,
      productionDate: null,
      consignment: isConsignment,
      settlement: isConsignment ? { status: "None" } : undefined,
      costs: isConsignment ? [] : [
        { type: "purchase", label: `Purchase expected (${order.number})`, source: order.number, amount: purchaseAmount, currency: order.currency || "PLN", pln: purchasePLN },
      ],
      movements: [],
      journey: [], // v6.37.0: a lot's journey derives from its shipments (v6.34.9); no template seed
      notes: `Auto-created from confirmed PO ${order.number}. Expected ${qty.toLocaleString("pl-PL")} kg ${isConsignment ? "ON CONSIGNMENT (price settled on sales)" : `at purchase price ${unitPrice} ${order.currency || "PLN"}/kg`}. Destination: ${destinationDisplay(order)}. ${order.directFlow ? "Direct flow · supplier/producer to client/port, not physically received in our warehouse" : "Warehouse/stock flow"}.`,
    });
  });

  return { lotRefs: uniqRefs(lotRefs), newLots, lotPatches };
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

// v6.35.0: render linked document numbers, striking through CANCELLED ones with a red
// line (kept on record but visibly voided). cancelledSet holds the cancelled numbers.
function LinkedDocNumbers({ nums, cancelledSet, color, icon, title }: any) {
  if (!nums || nums.length === 0) return null;
  // v6.54.0: say how many of these actually COUNT. A PO listing three shipments
  // of which two are cancelled reads as "three shipments" while every guard and
  // total sees one — the disagreement that makes people go looking for a record
  // to delete. Struck-through refs alone are easy to miss in a long list.
  const dead = (nums || []).filter((n: string) => cancelledSet && cancelledSet.has(String(n))).length;
  return (
    <div style={{ color }} title={title}>
      {icon} {nums.map((n: string, i: number) => (
        <span key={String(n)}>
          <DocRef num={n} cancelledSet={cancelledSet} />{i < nums.length - 1 ? ", " : ""}
        </span>
      ))}
      {dead > 0 && (
        <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#B91C1C", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 4, padding: "1px 5px" }}
          title={`${dead} cancelled — kept on record but counting toward nothing. ${nums.length - dead} of ${nums.length} are live.`}>
          {nums.length - dead}/{nums.length} live
        </span>
      )}
    </div>
  );
}

export default function PurchaseOrders({ pos: extPOs, setPOs: extSetPOs, contacts: extContacts, lots: extLots = [], setLots: extSetLots, orders: extSOs = [], setOrders: extSetSOs, shipments: extShipments = [], productCatalog = [], setProductCatalog }: any = {}) {
  const { confirm: uiConfirm, alert: uiAlert, dialogNode: poDialogNode } = useConfirm(); // P2-6
  // v6.35.1: shared cancelled-doc set (shipments + SOs + POs) for struck-through refs.
  const cancelledRefs = cancelledDocSet(extShipments, extSOs, extPOs);
  // Integration mode: parent shell passes state in. Standalone: use baked-in seed.
  const [localOrders, setLocalOrders] = useState<any[]>([]); // v6.32.0 (R7b-5): demo seed removed from bundle
  const orders = extPOs ?? localOrders;
  const setOrders = extSetPOs ?? setLocalOrders;
  const suppliers = useMemo(() => suppliersFromContacts(extContacts), [extContacts]);
  const lots = extLots || [];
  const [view, setView] = useState("list");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);
  const [printOrder, setPrintOrder] = useState(null);
  const [emailOrder, setEmailOrder] = useState(null);

  // filters
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterSupplier, setFilterSupplier] = useState("All");

  // KPIs
  const activeStatuses = new Set(["Draft", "Confirmed", "In Production", "Shipped"]);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Product autocomplete suggestions — unique, normalized list pulled from all existing line items
  // plus a small seed of common produce names. Grows automatically as you add new POs.
  const productSuggestions = useMemo(() => {
    const seed = ["Golden Delicious", "Red Bell Pepper", "Yellow Bell Pepper", "Green Bell Pepper", "Papryka Kapia", "Tomato Round", "Tomato Cherry", "Carrot", "Cucumber", "Courgette", "Onion Yellow", "Potato", "Garlic", "Cauliflower", "Broccoli", "Lettuce Iceberg", "Cabbage"];
    const fromOrders = orders.flatMap(o => o.items.map(i => (i.product || "").trim())).filter(Boolean);
    // Case-insensitive dedup, preserving the most recent casing
    const seen = new Map();
    [...fromOrders, ...seed].forEach(p => {
      const key = p.toLowerCase();
      if (!seen.has(key)) seen.set(key, p);
    });
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [orders]);
  // v6.36.1 (P2): KPIs derive from REAL linked state, not from PO statuses that
  // nothing auto-advances (status often stays "Confirmed" while shipments and lots
  // move) — the old ARRIVED counter was permanently 0 and overdue-loading kept
  // flagging POs whose goods had long since shipped.
  const openPO = (o: any) => o.status !== "Closed" && o.status !== "Cancelled";
  const goodsReceived = (o: any) => (lots || []).some((l: any) => l.poRef === o.number && (parseFloat(l.receivedKg) > 0 || parseFloat(l.physicalKg) > 0));
  const hasLiveShipment = (o: any) => (extShipments || []).some((s: any) => (s.poRefs || []).includes(o.number) && s.status !== "Cancelled" && s.status !== "Draft");
  const activeCount = orders.filter(openPO).length;
  const arrivedCount = orders.filter(o => openPO(o) && goodsReceived(o)).length;
  const pendingValue = orders.filter(openPO).reduce((s, o) => s + plnTotal(o), 0);
  const overdueLoading = orders.filter(o => {
    if (!openPO(o)) return false;
    if (goodsReceived(o) || hasLiveShipment(o)) return false; // goods moving/moved — not overdue
    if (!o.loadingDate) return false;
    return new Date(o.loadingDate) < todayStart;
  }).length;

  // filtered
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter(o => {
      if (filterStatus === "Active" && !activeStatuses.has(o.status)) return false;
      if (filterStatus !== "All" && filterStatus !== "Active" && o.status !== filterStatus) return false;
      if (filterSupplier !== "All" && o.supplier?.name !== filterSupplier) return false;
      if (q) {
        const hay = `${o.number} ${o.supplier?.name || ""} ${o.items.map(i => i.product).join(" ")} ${o.linkedShipments?.join(" ") || ""} ${o.linkedLots?.join(" ") || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, search, filterStatus, filterSupplier]);

  function reflectCancelledPOInInventory(po: any) {
    if (!extSetLots || !po?.number) return;
    extSetLots((prevLots: any[]) => (prevLots || []).map((lot: any) => {
      if (lot.poRef !== po.number) return lot;
      const hasPhysical = (parseFloat(lot.receivedKg) || 0) > 0 || (parseFloat(lot.physicalKg) || 0) > 0 || (lot.movements || []).length > 0;
      return {
        ...lot,
        poStatus: "Cancelled",
        status: hasPhysical ? "Blocked · PO Cancelled" : "Cancelled",
        expectedKg: hasPhysical ? lot.expectedKg : 0,
        cancelledAt: localTodayISO(),
        notes: `${lot.notes || ""}
PO ${po.number} was cancelled. Lot excluded from expected procurement availability.`.trim(),
      };
    }));
  }

  function reflectCancelledPOInSOs(po: any) {
    if (!extSetSOs || !po?.number) return;
    const today = localTodayISO();
    extSetSOs((prevSOs: any[]) => (prevSOs || []).map((so: any) => {
      const usesPO = (so.items || []).some((it: any) => it.sourceType === "PO" && it.sourceRef === po.number);
      if (!usesPO) return so;
      const terminal = new Set(["Shipped", "Delivered", "Invoiced", "Closed", "Cancelled"]);
      const nextStatus = terminal.has(so.status) ? so.status : "Draft";
      const blockNote = `PO ${po.number} was cancelled on ${today}. Review/resource this SO before confirming.`;
      return {
        ...so,
        status: nextStatus,
        blockedReason: blockNote,
        notes: String(so.notes || "").includes(blockNote) ? so.notes : `${so.notes || ""}
${blockNote}`.trim(),
      };
    }));
  }

  // mutations
  async function saveOrder(o) {
    // Batch 6b: hard confirm-gate — no PO past Draft without its terms.
    const termsMissing = poTermsMissing(o);
    if (!["Draft", "Cancelled"].includes(o.status) && termsMissing) {
      await uiAlert({ tone: "warn", title: "Terms incomplete", message: `This PO cannot be ${o.status === "Confirmed" ? "confirmed" : "saved as " + o.status} without ${termsMissing}. The purchase terms are the contract — the producer must see them.` });
      return;
    }
    // BP-57 Phase B: the internal flow is composed from the terms + the SALES
    // reality — a governing SO that sends goods onward makes this PO direct.
    if (o.buyIncoterm) o = { ...o, directFlow: poDirectFromSOs(o, extSOs) }; // v6.37.0: flow key retired — direct-ness derives live from the governing sale

    // Guard: prevent duplicate PO numbers (in case the user manually edited it)
    const previous = orders.find(p => p.id === o.id);
    const becomesCancelled = o.status === "Cancelled" && (!previous || previous.status !== "Cancelled");
    // v6.18.5 (P0-5): reverting a confirmed PO back to Draft withdraws its
    // not-yet-received expected lots (they were auto-committed on confirm).
    const revertingToDraft = !!previous && previous.status !== "Draft" && o.status === "Draft";
    const dup = orders.find(p => p.number === o.number && p.id !== o.id);
    if (dup) {
      await uiAlert({ tone: "warn", title: "Duplicate PO number", message: `PO number "${o.number}" is already used by another record. Please choose a different number.` });
      return;
    }

    // ERP guard: a PO may only create/update expected Inventory lots once all
    // commercially relevant line data is complete. Drafts can remain incomplete.
    if (isInventoryTransferStatus(o.status)) {
      const errors = poInventoryTransferErrors(o);
      if (errors.length) {
        await uiAlert({ tone: "warn", title: "Incomplete PO lines", message: `Cannot transfer PO ${o.number} to Inventory while quantity or price is missing/zero:\n\n${errors.join("\n")}` });
        return;
      }
    }

    let inventoryPlan = { lotRefs: [], newLots: [] } as any;
    if (isInventoryTransferStatus(o.status) && extSetLots) {
      inventoryPlan = buildExpectedLotsFromPO(o, lots);
    }

    // v6.11 (#2): when a PO line is removed, its still-expected lot must leave
    // Inventory too. We only prune lots that belong to this PO, are tied to a now
    // missing line id, and have NOT received any goods or movements — so real
    // stock is never destroyed.
    const currentLineIds = new Set((o.items || []).map((it, idx) => String(it.id ?? idx + 1)));
    const orphanLotNumbers = new Set(
      (lots || [])
        .filter(l => l.poRef === o.number
          && l.poLineId != null && String(l.poLineId) !== ""
          && !currentLineIds.has(String(l.poLineId))
          && (l.status === "Expected" || l.status === "Direct Expected")
          && !(parseFloat(l.receivedKg) > 0) && !(parseFloat(l.physicalKg) > 0)
          && !((l.movements || []).length))
        .map(l => l.number)
    );

    // v6.18.5 (P0-5): on revert-to-Draft, withdraw this PO's still-expected lots
    // (no goods received, no movements). Real stock is never removed.
    const withdrawLotNumbers = new Set<string>(
      revertingToDraft
        ? (lots || [])
            .filter(l => l.poRef === o.number
              && (l.status === "Expected" || l.status === "Direct Expected")
              && !(parseFloat(l.receivedKg) > 0) && !(parseFloat(l.physicalKg) > 0)
              && !((l.movements || []).length))
            .map(l => String(l.number))
        : []
    );
    const patchByNumber = new Map<string, any>((inventoryPlan.lotPatches || []).map((p: any) => [String(p.number), p.patch]));

    const savedId = o.id ?? nextId();
    const updated = {
      ...o,
      id: savedId,
      linkedShipments: o.linkedShipments || [],
      linkedLots: uniqRefs([...(o.linkedLots || []), ...(inventoryPlan.lotRefs || [])]).filter(n => !orphanLotNumbers.has(n) && !withdrawLotNumbers.has(String(n))),
      linkedInvoices: o.linkedInvoices || [],
    };

    if (updated.status === "Confirmed" && !updated.fxLockedAt) {
      updated.fxLockedAt = localTodayISO();
    }

    if (extSetLots && (inventoryPlan.newLots?.length || orphanLotNumbers.size || patchByNumber.size || withdrawLotNumbers.size)) {
      extSetLots(prev => {
        const existingNumbers = new Set((prev || []).map(l => l.number));
        const additions = (inventoryPlan.newLots || []).filter(l => !existingNumbers.has(l.number));
        const kept = (prev || [])
          .filter(l => !orphanLotNumbers.has(l.number) && !withdrawLotNumbers.has(String(l.number)))
          .map(l => patchByNumber.has(String(l.number)) ? { ...l, ...patchByNumber.get(String(l.number)) } : l);
        return [...kept, ...additions];
      });
    }

    recordAudit({ module: "Purchase orders", docType: "PO", docNumber: updated.number, action: o.id == null ? "created" : "saved", summary: `PO ${o.id == null ? "created" : "saved"} (${updated.status || "Draft"}${updated.buyIncoterm ? " · " + updated.buyIncoterm : ""})` });
    setOrders(prev => {
      const exists = prev.find(p => p.id === updated.id);
      if (exists) return prev.map(p => p.id === updated.id ? updated : p);
      return [...prev, updated];
    });

    if (becomesCancelled) {
      reflectCancelledPOInInventory(updated);
      reflectCancelledPOInSOs(updated);
    }

    setView("list");
    setForm(null);
  }

  function newOrder() {
    const nextNum = nextPONumber(orders);
    setForm({
      number: nextNum, status: "Draft",
      orderDate: localTodayISO(),
      loadingDate: "", expectedDeliveryDate: "", promisedDateMeans: "Arrival at our warehouse", actualAvailabilityDate: null,
      paymentTerms: "30 days from invoice date", paymentTermsOther: "",
      buyIncoterm: "", flow: "",
      supplier: null, destinationLocationId: null, destinationText: "", requiresSea: false,
      currency: "PLN", fxRate: 1, fxLockedAt: null,
      items: [{ id: nextId(), product: "", variety: "", cnCode: "", coloration: "", origin: "", size: "", quality: "I", unit: "Kg", qty: "", unitPrice: "", currency: "PLN", packaging: "" }],
      notes: "",
      linkedShipments: [], linkedLots: [], linkedInvoices: [], variance: null,
    });
    setView("form");
  }

  async function deleteOrder() {
    // v6.18.14 (#3): a PO can only be removed once nothing depends on it.
    const poNum = selected.number;
    const hasLinkedSO = (extSOs || []).some((so: any) => so.status !== "Cancelled" && (so.items || []).some((it: any) => it.sourceType === "PO" && it.sourceRef === poNum));
    const hasShipment = (extShipments || []).some((sh: any) => (sh.poRefs || []).includes(poNum) && sh.status !== "Cancelled");
    // v6.35.0: a lot whose linked shipments are ALL cancelled must not keep the PO locked —
  // otherwise cancelling everything to fix the PO leaves it permanently trapped. We treat a
  // lot as "really received/moved" only if it has a non-cancelled shipment, OR it carries
  // manual movements that are not shipment-driven receipts.
  const shipmentsForLot = (lotNo: string) => (extShipments || []).filter((sh: any) =>
    (sh.lotRefs || []).map(String).includes(String(lotNo)) ||
    (sh.goods || []).some((g: any) => String(g.lotRef) === String(lotNo)));
  const lotReceivedOrMoved = (lots || []).some((l: any) => {
    if (l.poRef !== poNum) return false;
    const received = (parseFloat(l.receivedKg) > 0) || (parseFloat(l.physicalKg) > 0) || ((l.movements || []).length > 0);
    if (!received) return false;
    // If this lot has any linked shipment, only a NON-cancelled one keeps it "live".
    const shs = shipmentsForLot(l.number);
    if (shs.length > 0) return shs.some((sh: any) => sh.status !== "Cancelled");
    // No shipments at all: a lot with real received kg / movements is a genuine manual receipt → still locks.
    return received;
  });
    if (hasLinkedSO || hasShipment || lotReceivedOrMoved) {
      const what = [hasLinkedSO && "a Sales Order", hasShipment && "a shipment", lotReceivedOrMoved && "received / moved inventory"].filter(Boolean).join(", ");
      await uiAlert({ tone: "warn", title: "PO has dependents", message: `PO ${poNum} can't be cancelled or deleted: it has downstream dependents (${what}).\n\nUnlink every downstream document first — remove the SO lines sourced from it, cancel/disconnect its shipments, and clear its inventory — then the PO can be removed.` });
      return;
    }
    if (!(await uiConfirm({ tone: "danger", title: `Cancel PO ${selected.number}?`, message: "Related expected lots will be blocked and non-shipped SOs sourced from this PO will return to Draft for review.", confirmLabel: "Cancel PO", cancelLabel: "Keep" }))) return;
    const cancelled = { ...selected, status: "Cancelled", cancelledAt: localTodayISO() };
    setOrders(prev => prev.map(o => o.id === selected.id ? cancelled : o));
    reflectCancelledPOInInventory(cancelled);
    reflectCancelledPOInSOs(cancelled);
    setSelected(null);
    setView("list");
  }

  // routes
  if (view === "form" && form) {
    return (
      <>
        {poDialogNode}
        {printOrder && <PrintModal order={printOrder} onClose={() => setPrintOrder(null)} />}
        {emailOrder && <EmailModal order={emailOrder} contacts={extContacts} onClose={() => setEmailOrder(null)} />}
        <OrderForm
          order={form} setOrder={setForm}
          productSuggestions={productSuggestions}
          suppliers={suppliers}
          contacts={extContacts}
          allSOs={extSOs}
          allShipments={extShipments}
          lots={lots}
          productCatalog={productCatalog}
          setProductCatalog={setProductCatalog}
          onSave={saveOrder}
          onCancel={() => { setView("list"); setForm(null); }}
          onPrint={async () => {
            if (form.status === "Draft") {
              await uiAlert({ tone: "warn", title: "Draft PO", message: "Cannot print or share a draft PO. Confirm the order first." });
              return;
            }
            { const _m = poTermsMissing(form); if (_m) { await uiAlert({ tone: "warn", title: "Terms incomplete", message: `Cannot print this PO without ${_m} — it is the contract the producer relies on. Edit the PO and complete the PURCHASE TERMS box.` }); return; } }
            setPrintOrder(form);
          }}
          onEmail={async () => {
            if (form.status === "Draft") {
              await uiAlert({ tone: "warn", title: "Draft PO", message: "Cannot email a draft PO to the supplier. Confirm the order first." });
              return;
            }
            { const _m = poTermsMissing(form); if (_m) { await uiAlert({ tone: "warn", title: "Terms incomplete", message: `Cannot email this PO without ${_m} — it is the contract the producer relies on. Edit the PO and complete the PURCHASE TERMS box.` }); return; } }
            setEmailOrder(form);
          }}
        />
      </>
    );
  }

  if (view === "detail" && selected) {
    return (
      <>
        {poDialogNode}
        {printOrder && <PrintModal order={printOrder} onClose={() => setPrintOrder(null)} />}
        {emailOrder && <EmailModal order={emailOrder} contacts={extContacts} onClose={() => setEmailOrder(null)} />}
        <OrderDetail
          order={selected}
          computedShipments={(extShipments || []).filter((s: any) => (s.poRefs || []).includes(selected.number) && s.status !== "Cancelled").map((s: any) => s.number)}
          computedSOs={(extSOs || []).filter((so: any) => so.status !== "Cancelled" && (so.items || []).some((it: any) => it.sourceType === "PO" && it.sourceRef === selected.number)).map((so: any) => so.number)}
          onBack={() => { setView("list"); setSelected(null); }}
          onEdit={() => { setForm({ ...selected }); setView("form"); }}
          onDelete={deleteOrder}
          onPrint={async () => {
            if (selected.status === "Draft") {
              await uiAlert({ tone: "warn", title: "Draft PO", message: "Cannot print or share a draft PO. Confirm the order first." });
              return;
            }
            { const _m = poTermsMissing(selected); if (_m) { await uiAlert({ tone: "warn", title: "Terms incomplete", message: `Cannot print this PO without ${_m} — it is the contract the producer relies on. Edit the PO and complete the PURCHASE TERMS box.` }); return; } }
            setPrintOrder(selected);
          }}
          onEmail={async () => {
            if (selected.status === "Draft") {
              await uiAlert({ tone: "warn", title: "Draft PO", message: "Cannot email a draft PO to the supplier. Confirm the order first." });
              return;
            }
            { const _m = poTermsMissing(selected); if (_m) { await uiAlert({ tone: "warn", title: "Terms incomplete", message: `Cannot email this PO without ${_m} — it is the contract the producer relies on. Edit the PO and complete the PURCHASE TERMS box.` }); return; } }
            setEmailOrder(selected);
          }}
        />
      </>
    );
  }

  // list view
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#FAFAFA" }}>
      {/* Top bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", flexShrink: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>Purchase Orders</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={newOrder} style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: "#16A34A", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>+ New PO</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        {/* KPI strip — compact */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
          <Card style={{ padding: "9px 12px" }}>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>OPEN <span style={{ color: "#CBD5E1", fontWeight: 400 }}>· not closed / cancelled</span></div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#111", marginTop: 2 }}>{activeCount}</div>
          </Card>
          <Card style={{ padding: "9px 12px" }}>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>GOODS IN <span style={{ color: "#CBD5E1", fontWeight: 400 }}>· lots received</span></div>
            <div style={{ fontSize: 17, fontWeight: 700, color: arrivedCount > 0 ? "#16A34A" : "#111", marginTop: 2 }}>{arrivedCount}</div>
          </Card>
          <Card style={{ padding: "9px 12px" }}>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>OPEN VALUE <span style={{ color: "#CBD5E1", fontWeight: 400 }}>· PLN</span></div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#111", marginTop: 2 }}>{fmtMoney(pendingValue, "PLN")}</div>
          </Card>
          <Card style={{ padding: "9px 12px" }}>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>LOADING OVERDUE</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: overdueLoading > 0 ? "#DC2626" : "#111", marginTop: 2 }}>{overdueLoading}</div>
          </Card>
        </div>

        {/* Filters — compact single row of dropdowns */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PO#, supplier, product…" style={{ flex: "1 1 240px", minWidth: 200, border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none", background: "#fff" }} />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} title="Filter by status" style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, background: "#fff", fontFamily: "inherit", maxWidth: 200 }}>
            <option value="Active">Active</option>
            <option value="All">All statuses</option>
            {Object.keys(PO_STATUSES).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {(() => {
            const counts: Record<string, number> = {};
            (orders || []).forEach((o: any) => { const n = o.supplier?.name; if (n) counts[n] = (counts[n] || 0) + 1; });
            const activeSuppliers = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            return (
              <select value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)} title="Filter by supplier" style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, background: "#fff", fontFamily: "inherit", maxWidth: 220 }}>
                <option value="All">All suppliers</option>
                {activeSuppliers.map(([name, n]) => <option key={name} value={name}>{name} ({n})</option>)}
              </select>
            );
          })()}
        </div>

        {/* Table */}
        <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 110px 130px 120px 160px", padding: "10px 18px", background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
            {["PO NUMBER", "SUPPLIER · PRODUCTS", "STATUS", "VALUE", "LOAD/DELIVERY", "LINKED DOCUMENTS"].map((h, i) => (
              <div key={i} style={{ fontSize: 10, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em" }}>{h}</div>
            ))}
          </div>
          {filtered.length === 0 && <div style={{ padding: "40px 20px", textAlign: "center", color: "#AAA", fontSize: 13 }}>No POs match the current filters.</div>}
          {filtered.map((o, idx) => {
            const total = netTotal(o.items);
            const totalKg = totalQtyKg(o.items);
            const totalPLN = plnTotal(o);
            const isLoadingOverdue = activeStatuses.has(o.status) && o.loadingDate && new Date(o.loadingDate) < todayStart;
            return (
              <div key={o.id} style={{ display: "grid", gridTemplateColumns: "150px 1fr 110px 130px 120px 160px", padding: "12px 18px", borderBottom: idx < filtered.length - 1 ? "1px solid #F3F4F6" : "none", alignItems: "center", background: o.status === "Cancelled" ? "#FEF2F2" : "#fff", color: o.status === "Cancelled" ? "#B91C1C" : undefined, cursor: "pointer" }}
                onClick={() => { setSelected(o); setView("detail"); }}
                onMouseEnter={e => e.currentTarget.style.background = "#FAFAFA"}
                onMouseLeave={e => e.currentTarget.style.background = "#fff"}
              >
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#2563EB", fontFamily: "ui-monospace, Menlo, monospace" }}>{o.number}</div>
                  <div style={{ marginTop: 3 }}><VarianceBadge variance={o.variance} /></div>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#111" }}>{o.supplier?.name || "—"}</div>
                  <div style={{ fontSize: 11, color: "#888" }}>{o.items.map(i => `${i.product}${i.variety ? " — " + i.variety : ""} · ${fmtNum(i.qty)} kg`).join(" / ")}</div>
                </div>
                <div><StatusBadge status={o.status} /></div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtMoney(total, o.currency)}

                  </div>
                  {o.currency !== "PLN" && <div style={{ fontSize: 10.5, color: "#AAA" }}>{fmtMoney(totalPLN, "PLN")}</div>}
                  <div style={{ fontSize: 10.5, color: "#AAA" }}>{fmtNum(totalKg)} kg</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: isLoadingOverdue ? "#DC2626" : "#666", fontWeight: isLoadingOverdue ? 600 : 400 }}>Load: {formatDMY(o.loadingDate) || "—"}</div>
                  <div style={{ fontSize: 11, color: "#666" }}>Del: {formatDMY(o.expectedDeliveryDate) || "—"}</div>
                </div>
                <div style={{ fontSize: 10.5, fontFamily: "ui-monospace, Menlo, monospace", lineHeight: 1.5 }}>
                  {/* v6.34.1 (item 3): show the linked DOCUMENT NUMBERS, not counts. */}
                  {/* v6.45.0: SOs are DERIVED (any order sourcing from this PO) — they
                      were missing entirely from this column. */}
                  {(() => { const sos = Array.from(new Set((extSOs || []).filter((so: any) => so.status !== "Cancelled" && (so.items || []).some((it: any) => it.sourceType === "PO" && it.sourceRef === o.number)).map((so: any) => so.number))); return sos.length ? <div style={{ color: "#7C3AED" }} title="Sales orders">🧾 {sos.join(", ")}</div> : null; })()}
                  <LinkedDocNumbers nums={o.linkedShipments} cancelledSet={cancelledRefs} color="#0284C7" icon="📦" title="Shipments" />
                  {o.linkedLots?.length > 0 && <div style={{ color: "#92400E" }} title="Lots">🏷 {o.linkedLots.join(", ")}</div>}
                  {o.linkedInvoices?.length > 0 && <div style={{ color: "#16A34A" }} title="Invoices">📄 {o.linkedInvoices.join(", ")}</div>}
                  {!o.linkedShipments?.length && !o.linkedLots?.length && !o.linkedInvoices?.length && !(extSOs || []).some((so: any) => so.status !== "Cancelled" && (so.items || []).some((it: any) => it.sourceType === "PO" && it.sourceRef === o.number)) && <span style={{ color: "#CCC" }}>—</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 16, fontSize: 11, color: "#AAA", textAlign: "center" }}>
          {filtered.length} of {orders.length} POs · Click any row to open · Linked documents (sales orders, shipments, lots, invoices) populate as the PO progresses
        </div>
      </div>
    </div>
  );
}

