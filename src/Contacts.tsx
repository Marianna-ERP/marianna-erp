import React, { useState, useMemo, useRef } from "react";
import { Lbl } from "./ui";
import { nextId } from "./ids";
import { locationsByLegacyType, contactAddresses, warehouseCpLocId, LOGISTICS_POINT_KINDS, readLogisticsPoints, writeLogisticsPoints } from "./locations";
// xlsx (SheetJS) loaded for parsing Fakturownia exports — works on .xls, .xlsx, .csv
// Available in StackBlitz / Vite / Next without extra config.
import * as XLSX from "xlsx";

// ─── COMPANY & CONFIG ───────────────────────────────────────────────────────
const COMPANY = {
  name: "MARIANNA",
  person: "Hazem Osman",
};

const COUNTERPARTY_TYPES = ["Client", "Supplier", "Broker", "Forwarder", "Carrier", "Warehouse", "Other"];

const SERVICES = ["Road", "Sea", "Air", "Rail", "Customs", "Warehousing"];
// Types that have logistics services. For other types the services field is hidden.
const TYPES_WITH_SERVICES = new Set(["Forwarder", "Carrier"]);

const ROLES = ["Buyer", "Seller", "Logistics", "Finance", "Director", "Sales", "Operations", "Quality", "Other"];

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

const CURRENCIES = ["PLN", "EUR", "USD"];

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  Client:         { bg: "#DBEAFE", color: "#2563EB" },
  Supplier:       { bg: "#DCFCE7", color: "#16A34A" },
  Broker:         { bg: "#EDE9FE", color: "#7C3AED" },
  Forwarder:      { bg: "#FFEDD5", color: "#C2410C" },
  Carrier:        { bg: "#FEF3C7", color: "#D97706" },
  Warehouse:      { bg: "#E0F2FE", color: "#0284C7" },
  Other:          { bg: "#F3F4F6", color: "#6B7280" },
};

// Service tag colors — compact pills shown in lists + detail
const SERVICE_COLORS: Record<string, { bg: string; color: string; icon: string }> = {
  Road:         { bg: "#FEF3C7", color: "#92400E", icon: "🚛" },
  Sea:          { bg: "#DBEAFE", color: "#1E40AF", icon: "🚢" },
  Air:          { bg: "#F3E8FF", color: "#6D28D9", icon: "✈️" },
  Rail:         { bg: "#E5E7EB", color: "#374151", icon: "🚆" },
  Customs:      { bg: "#FEE2E2", color: "#991B1B", icon: "🛃" },
  Warehousing:  { bg: "#DCFCE7", color: "#166534", icon: "📦" },
};

// ─── SEED DATA — counterparty-first, contacts nested ────────────────────────
export const INIT_COUNTERPARTIES = [
  {
    id: 1, type: "Supplier", name: "Białski Owoc", country: "Poland",
    address: "ul. Kolejowa 35, 96-230 Biała Rawska",
    nip: "8351595299", vatEuId: "PL8351595299",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    notes: "Long-term apple supplier — 13kg wooden box format",
    linkedDocs: ["PO-2025-0468"],
    contacts: [
      { id: 1, name: "Aneta Głowala", role: "Sales", email: "aneta@bialskiowoc.pl", phone: "+48 600 111 222", isPrimary: true, notes: "" },
      { id: 2, name: "Krzysztof Bialski", role: "Director", email: "k.bialski@bialskiowoc.pl", phone: "", isPrimary: false, notes: "Decision maker on pricing" },
    ],
  },
  {
    id: 2, type: "Supplier", name: "FreshFarm ES", country: "Spain",
    address: "Calle Major 12, Valencia",
    nip: "B12345678", vatEuId: "ESB12345678",
    defaultCurrency: "EUR", paymentTerms: "14 days from invoice date",
    notes: "Bell peppers — 5kg carton",
    linkedDocs: ["PO-2026-0112"],
    contacts: [
      { id: 1, name: "Carlos Ruiz", role: "Sales", email: "c.ruiz@freshfarmes.com", phone: "+34 961 234 567", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 3, type: "Supplier", name: "AgriTrade MA", country: "Morocco",
    address: "Route de Casablanca, Agadir",
    nip: "MA-200123", vatEuId: "",
    defaultCurrency: "USD", paymentTerms: "Advance payment",
    notes: "Tomatoes, courgettes — winter season",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Youssef Idrissi", role: "Sales", email: "y.idrissi@agritrade.ma", phone: "", isPrimary: true, notes: "" },
      { id: 2, name: "Fatima El Khattabi", role: "Quality", email: "quality@agritrade.ma", phone: "+212 528 845 100", isPrimary: false, notes: "Phytosanitary docs" },
    ],
  },
  {
    id: 4, type: "Client", name: "Biedronka", country: "Poland",
    address: "ul. Górecka 1, 60-201 Poznań",
    nip: "7792308495", vatEuId: "PL7792308495",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    notes: "Discount chain — strict delivery windows",
    linkedDocs: ["SO-2026-0094"],
    contacts: [
      { id: 1, name: "Marek Nowak", role: "Buyer", email: "zamowienia@biedronka.pl", phone: "+48 61 850 1000", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 5, type: "Client", name: "Lidl Polska", country: "Poland",
    address: "ul. Świdnicka 12, 41-508 Chorzów",
    nip: "6272685925", vatEuId: "PL6272685925",
    defaultCurrency: "PLN", paymentTerms: "14 days from invoice date",
    notes: "",
    linkedDocs: ["SO-2026-0088"],
    contacts: [
      { id: 1, name: "Anna Wiśniewska", role: "Buyer", email: "fresh@lidl.pl", phone: "+48 32 604 8000", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 6, type: "Client", name: "Metro Cash & Carry", country: "Poland",
    address: "ul. Metrobus 1, 02-274 Warszawa",
    nip: "5210088510", vatEuId: "PL5210088510",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    notes: "",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Piotr Zając", role: "Buyer", email: "p.zajac@metro.pl", phone: "", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 7, type: "Client", name: "Fresco Import GmbH", country: "Germany",
    address: "Marktstraße 44, 20357 Hamburg",
    nip: "DE234567890", vatEuId: "DE234567890",
    defaultCurrency: "EUR", paymentTerms: "30 days from invoice date",
    notes: "EU reverse-charge VAT applies",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Klaus Weber", role: "Buyer", email: "orders@fresco-import.de", phone: "+49 40 123 456", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 8, type: "Client", name: '"Euro-Papryka" Paweł Myziak', country: "Poland",
    address: "ul. Piękna 13, 05-555 Tarczyn, Wola Przypkowska",
    nip: "7981158890", vatEuId: "PL7981158890",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    notes: "",
    linkedDocs: ["SO-2026-0091"],
    contacts: [
      { id: 1, name: "Paweł Myziak", role: "Director", email: "biuro@euro-papryka.pl", phone: "", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 9, type: "Carrier", name: "Trans-Logistics PL", country: "Poland",
    address: "ul. Transportowa 5, 02-001 Warszawa",
    nip: "5213456789", vatEuId: "PL5213456789",
    defaultCurrency: "PLN", paymentTerms: "14 days from invoice date",
    services: ["Road"],
    notes: "Direct road carrier — domestic & EU trucking",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Tomasz Mazur", role: "Logistics", email: "dispatch@trans-logistics.pl", phone: "+48 22 555 8800", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 10, type: "Carrier", name: "EuroFreight GmbH", country: "Germany",
    address: "Hafenstraße 12, 20359 Hamburg",
    nip: "DE876543210", vatEuId: "DE876543210",
    defaultCurrency: "EUR", paymentTerms: "30 days from invoice date",
    services: ["Road"],
    notes: "German road operator — cross-border PL/DE/BeNeLux",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Lukas Hoffmann", role: "Logistics", email: "ops@eurofreight.de", phone: "+49 40 876 5432", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 15, type: "Forwarder", name: "Raben Logistics PL", country: "Poland",
    address: "ul. Zbożowa 1, 62-023 Gądki",
    nip: "7820210577", vatEuId: "PL7820210577",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    services: ["Road", "Sea", "Customs"],
    notes: "Main forwarder for Gdańsk-routed imports. Books containers + arranges inland trucking + handles customs paperwork.",
    linkedDocs: ["PO-2026-0118"],
    contacts: [
      { id: 1, name: "Joanna Krawczyk", role: "Operations", email: "j.krawczyk@raben.pl", phone: "+48 61 898 5200", isPrimary: true, notes: "Account manager for Marianna" },
      { id: 2, name: "Bartosz Nowak", role: "Sales", email: "b.nowak@raben.pl", phone: "", isPrimary: false, notes: "Sea freight bookings" },
    ],
  },
  {
    id: 16, type: "Forwarder", name: "DSV Solutions Polska", country: "Poland",
    address: "ul. Logistyczna 4, 05-090 Raszyn",
    nip: "5252222333", vatEuId: "PL5252222333",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    services: ["Road", "Sea", "Air", "Customs", "Warehousing"],
    notes: "Multi-modal forwarder — used for Hamburg & Algeciras routes. Also offers transit warehousing.",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Piotr Sobieski", role: "Operations", email: "p.sobieski@dsv.pl", phone: "+48 22 333 4400", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 17, type: "Forwarder", name: "Pekaes SA", country: "Poland",
    address: "ul. Spedycyjna 2, 03-310 Warszawa",
    nip: "5260250289", vatEuId: "PL5260250289",
    defaultCurrency: "PLN", paymentTerms: "14 days from invoice date",
    services: ["Road", "Customs"],
    notes: "Road forwarder — strong on intra-EU routes, also handles export customs",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Robert Adamski", role: "Operations", email: "r.adamski@pekaes.pl", phone: "+48 22 460 3000", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 18, type: "Carrier", name: "MSC Mediterranean Shipping", country: "Switzerland",
    address: "Chemin Rieu 12-14, 1208 Geneva",
    nip: "", vatEuId: "",
    defaultCurrency: "USD", paymentTerms: "Advance payment",
    services: ["Sea"],
    notes: "Direct shipping line — used occasionally when forwarder doesn't have rates",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "MSC Poland Office", role: "Sales", email: "bookings.pl@msc.com", phone: "+48 58 765 4300", isPrimary: true, notes: "Booking through Gdynia office" },
    ],
  },
  {
    // Multi-role example — same legal entity buys produce from us AND rents us their fleet AND lets us use their cold-storage
    id: 19, type: "Client", additionalTypes: ["Carrier", "Warehouse"],
    name: "Polfrost Logistyka", country: "Poland",
    address: "ul. Mroźna 4, 80-298 Gdańsk",
    nip: "5832914455", vatEuId: "PL5832914455",
    defaultCurrency: "PLN", paymentTerms: "21 days from invoice date",
    services: ["Road", "Warehousing"],
    finance: { bankName: "mBank SA", accountNumber: "PL12 1140 2004 0000 3502 0987 6543", swift: "BREXPLPW" },
    notes: "Wears three hats: buys leftover stock from us at discount, runs reefer trucks we sometimes hire, and rents us pallet positions in their Gdańsk cold store.",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Krzysztof Wiśniewski", role: "Director", email: "k.wisniewski@polfrost.pl", phone: "+48 58 712 4400", isPrimary: true, notes: "Single point of contact across all three relationships" },
      { id: 2, name: "Magdalena Polak", role: "Operations", email: "m.polak@polfrost.pl", phone: "", isPrimary: false, notes: "Day-to-day for warehouse + dispatch" },
    ],
  },
  {
    id: 11, type: "Broker", name: "CustomsPro Sp. z o.o.", country: "Poland",
    address: "ul. Celna 4, 02-100 Warszawa",
    nip: "5252111222", vatEuId: "PL5252111222",
    defaultCurrency: "PLN", paymentTerms: "14 days from invoice date",
    notes: "Customs broker — advances phytosanitary fees (37 PLN/cert)",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Magdalena Kowal", role: "Operations", email: "m.kowal@customspro.pl", phone: "+48 22 633 4500", isPrimary: true, notes: "" },
      { id: 2, name: "Jan Wójcik", role: "Finance", email: "billing@customspro.pl", phone: "", isPrimary: false, notes: "Monthly invoices" },
    ],
  },
  {
    id: 12, type: "Broker", name: "Hartmann Broker", country: "Germany",
    address: "Hafenstraße 8, 20359 Hamburg",
    nip: "DE-9876543", vatEuId: "DE987654321",
    defaultCurrency: "EUR", paymentTerms: "30 days from invoice date",
    notes: "Preferred customs broker for Hamburg port",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Stefan Hartmann", role: "Operations", email: "s.hartmann@hartmann-customs.de", phone: "+49 40 123 456", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 13, type: "Warehouse", name: "WH-01 Poznań (Logipark)", country: "Poland",
    address: "ul. Magazynowa 1, 60-001 Poznań",
    nip: "7779988877", vatEuId: "PL7779988877",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    notes: "Cold storage — monthly invoice allocated by kg-days",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Roman Lewandowski", role: "Operations", email: "wh01@logipark.pl", phone: "+48 61 800 1234", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 14, type: "Warehouse", name: "WH-02 Warszawa (ColdStore)", country: "Poland",
    address: "ul. Chłodna 50, 00-872 Warszawa",
    nip: "5251122334", vatEuId: "PL5251122334",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    notes: "",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Beata Sienkiewicz", role: "Operations", email: "ops@coldstore.pl", phone: "+48 22 887 6543", isPrimary: true, notes: "" },
    ],
  },

  // ─── BASELINE TEST SET (for end-to-end testing of the logistics flow) ──────
  {
    id: 51, type: "Supplier", name: "Owoce Polska Sp. z o.o.", country: "Poland",
    address: "ul. Sadownicza 12, 96-200 Rawa Mazowiecka",
    nip: "8361122334", vatEuId: "PL8361122334",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    notes: "Baseline test supplier — Polish apples & pears, 13 kg wooden box",
    linkedDocs: [],
    contacts: [
      { id: 1, name: "Marek Kowalczyk", role: "Sales", email: "marek@owocepolska.pl", phone: "+48 601 234 567", isPrimary: true, notes: "Primary contact for loadings" },
    ],
  },
  {
    id: 52, type: "Client", name: "Nile Fresh Imports", country: "Egypt",
    address: "14 El Horreya Road, Alexandria",
    nip: "EG-204556789", vatEuId: "",
    defaultCurrency: "USD", paymentTerms: "Prepaid / TT before shipment",
    notes: "Baseline test client — Egyptian importer, receives at Alexandria Port (CIF)",
    contacts: [
      { id: 1, name: "Ahmed Hassan", role: "Purchasing", email: "ahmed@nilefresh.eg", phone: "+20 100 555 1234", isPrimary: true, notes: "Speaks EN/AR" },
    ],
  },
  {
    id: 53, type: "Carrier", name: "PolTrans Drogowy", country: "Poland",
    address: "ul. Transportowa 8, 02-672 Warszawa",
    nip: "5262233445", vatEuId: "PL5262233445",
    defaultCurrency: "PLN", paymentTerms: "30 days after CMR",
    services: ["Road"],
    notes: "Baseline test road carrier — reefer trucks, PL & EU",
    contacts: [
      { id: 1, name: "Janusz Wójcik", role: "Dispatch", email: "dyspozytor@poltrans.pl", phone: "+48 22 612 3456", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 54, type: "Forwarder", name: "Adriatica Forwarding S.r.l.", country: "Italy",
    address: "Via del Porto 22, 30175 Marghera VE",
    nip: "IT-09887766554", vatEuId: "IT09887766554",
    defaultCurrency: "EUR", paymentTerms: "30 days from invoice date",
    services: ["Sea", "Road", "Customs"],
    notes: "Baseline test forwarder — Italian sea + inland, container bookings",
    contacts: [
      { id: 1, name: "Giulia Ferrari", role: "Operations", email: "g.ferrari@adriatica-fwd.it", phone: "+39 041 555 7788", isPrimary: true, notes: "" },
    ],
  },

  // ── Additional baseline test parties (round 2) ──
  {
    id: 55, type: "Client", name: "Cairo Fresh Trading", country: "Egypt",
    address: "El Obour Market, Cairo",
    nip: "EG-301229988", vatEuId: "",
    defaultCurrency: "USD", paymentTerms: "Prepaid / TT before shipment",
    notes: "Baseline test client — Cairo wholesaler, receives at Damietta / Port Said",
    contacts: [
      { id: 1, name: "Mostafa Saleh", role: "Purchasing", email: "mostafa@cairofresh.eg", phone: "+20 122 444 7788", isPrimary: true, notes: "EN/AR" },
    ],
  },
  {
    id: 56, type: "Client", name: "Delta Produce Co.", country: "Egypt",
    address: "Industrial Zone, Damietta",
    nip: "EG-302554411", vatEuId: "",
    defaultCurrency: "USD", paymentTerms: "CAD — cash against documents",
    notes: "Baseline test client — Damietta importer, reefer containers",
    contacts: [
      { id: 1, name: "Hany Fawzy", role: "Imports", email: "hany@deltaproduce.eg", phone: "+20 100 778 2211", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 57, type: "Supplier", name: "Alex Agro Export", country: "Egypt",
    address: "Agricultural Road, Beheira (Alexandria area)",
    nip: "EG-205667788", vatEuId: "",
    defaultCurrency: "USD", paymentTerms: "30% advance, 70% against BL copy",
    notes: "Baseline test supplier — Egyptian citrus & potatoes, ships from Alexandria/Damietta",
    contacts: [
      { id: 1, name: "Tarek El-Sayed", role: "Sales", email: "tarek@alexagro.eg", phone: "+20 111 223 3445", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 58, type: "Supplier", name: "Nile Valley Farms", country: "Egypt",
    address: "Nubaria, Beheira Governorate",
    nip: "EG-206334455", vatEuId: "",
    defaultCurrency: "USD", paymentTerms: "Prepaid 50% / 50% on loading",
    notes: "Baseline test supplier — Egyptian grapes, onions, oranges",
    contacts: [
      { id: 1, name: "Sherif Ramadan", role: "Export Manager", email: "sherif@nilevalley.eg", phone: "+20 109 556 6778", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 59, type: "Supplier", name: "Sadowniczy Eksport Sp. z o.o.", country: "Poland",
    address: "ul. Grójecka 110, 05-600 Grójec",
    nip: "7972244668", vatEuId: "PL7972244668",
    defaultCurrency: "PLN", paymentTerms: "21 days from invoice date",
    notes: "Baseline test supplier — Polish apples (Grójec region), 13 kg box",
    contacts: [
      { id: 1, name: "Krzysztof Lewandowski", role: "Sales", email: "k.lewandowski@sadowniczy.pl", phone: "+48 605 112 334", isPrimary: true, notes: "" },
    ],
  },
  {
    id: 60, type: "Supplier", name: "Warzywa Polskie S.A.", country: "Poland",
    address: "ul. Ogrodnicza 5, 96-100 Skierniewice",
    nip: "8361177553", vatEuId: "PL8361177553",
    defaultCurrency: "PLN", paymentTerms: "30 days from invoice date",
    notes: "Baseline test supplier — Polish vegetables (cabbage, carrots, onions)",
    contacts: [
      { id: 1, name: "Agnieszka Nowak", role: "Sales", email: "a.nowak@warzywapolskie.pl", phone: "+48 601 778 990", isPrimary: true, notes: "" },
    ],
  },
];

// ─── SHARED UI ATOMS (mirror FreshTradeERP.tsx) ─────────────────────────────
function Inp({ value, onChange, type, placeholder, style, inputMode }: any) {
  const base = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: "#fff" };
  return <input value={value || ""} onChange={onChange} type={type || "text"} inputMode={inputMode} placeholder={placeholder} style={{ ...base, ...style }} />;
}
function Sel({ value, onChange, children, style }: any) {
  const base = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: "#fff" };
  return <select value={value || ""} onChange={onChange} style={{ ...base, ...style }}>{children}</select>;
}
function TypeBadge({ type }: any) {
  const s = TYPE_COLORS[type] || TYPE_COLORS["Other"];
  return (
    <span style={{ background: s.bg, color: s.color, padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
      {type}
    </span>
  );
}
function Avatar({ label, color, bg, size = 44 }: any) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.36, fontWeight: 700, color, flexShrink: 0 }}>
      {(label || "?")[0].toUpperCase()}
    </div>
  );
}
function ServiceTag({ service, size = "normal" }: any) {
  const p = SERVICE_COLORS[service];
  if (!p) return null;
  const sized = size === "small"
    ? { fontSize: 10, padding: "1px 6px", gap: 3, iconSize: 10 }
    : { fontSize: 11, padding: "2px 8px", gap: 4, iconSize: 11 };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: sized.gap, background: p.bg, color: p.color, padding: sized.padding, borderRadius: 4, fontSize: sized.fontSize, fontWeight: 600, whiteSpace: "nowrap" }}>
      <span style={{ fontSize: sized.iconSize }}>{p.icon}</span>{service}
    </span>
  );
}
function ServicesRow({ services, size = "normal", emptyHint = null }: any) {
  if (!services || services.length === 0) return emptyHint ? <span style={{ fontSize: 11, color: "#CCC", fontStyle: "italic" }}>{emptyHint}</span> : null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {services.map(s => <ServiceTag key={s} service={s} size={size} />)}
    </div>
  );
}
// True if the counterparty's primary OR any additional type is logistics-related (Forwarder/Carrier).
function showServicesRow(c) {
  if (!c.services || c.services.length === 0) return false;
  const all = [c.type, ...(c.additionalTypes || [])];
  return all.some(t => TYPES_WITH_SERVICES.has(t));
}

// ─── HELPERS (for other modules to consume) ─────────────────────────────────
// Mimics the legacy flat arrays (SUPPLIERS, CLIENTS, …) so Invoices.tsx etc.
// can switch to a single source of truth later with one-line changes.
export function getCounterpartiesByType(counterparties, type) {
  return counterparties.filter(c => c.type === type || (c.additionalTypes || []).includes(type)).map(c => {
    const primary = c.contacts.find(p => p.isPrimary) || c.contacts[0];
    return {
      id: c.id,
      name: c.name,
      country: c.country,
      nip: c.nip,
      type: c.type,
      additionalTypes: c.additionalTypes || [],
      address: c.address,
      services: c.services || [],
      contact: primary?.name || "",
      email: primary?.email || "",
    };
  });
}
// For Shipments.tsx — get all logistics providers (Forwarder + Carrier) that can do a given mode.
// Use when populating carrier dropdowns on a shipment leg.
export function getLogisticsProvidersByService(counterparties, service) {
  return counterparties
    .filter(c => {
      const allTypes = [c.type, ...(c.additionalTypes || [])];
      return allTypes.some(t => TYPES_WITH_SERVICES.has(t)) && (c.services || []).includes(service);
    })
    .map(c => ({
      id: c.id, name: c.name, type: c.type, additionalTypes: c.additionalTypes || [], services: c.services,
      country: c.country,
    }));
}

// ─── COUNTERPARTY MODAL — company-level details ─────────────────────────────
function CounterpartyModal({ counterparty, contacts = [], onSave, onClose }: any) {
  const defaultFinance = { bankName: "", accountNumber: "", swift: "" };
  const blank = { type: "Client", additionalTypes: [], name: "", country: "", address: "", nip: "", vatEuId: "", defaultCurrency: "PLN", paymentTerms: "30 days from invoice date", paymentTermsOther: "", services: [], finance: defaultFinance, notes: "" };
  const [form, setForm] = useState(counterparty ? { additionalTypes: [], services: [], paymentTermsOther: "", ...counterparty, finance: { ...defaultFinance, ...(counterparty.finance || {}) } } : { ...blank, id: null });
  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const sff = (k, v) => setForm(f => ({ ...f, finance: { ...(f.finance || {}), [k]: v } }));
  // v6.10 (#6): keep the RAW typed text in the tariff fields while editing so
  // intermediate states like "0," / "0." and comma decimals ("0,30") survive.
  // Coercion to a number happens once, on save (see numC / handleSave).
  const sft = (k, v) => setForm(f => ({ ...f, warehouseTariff: { ...(f.warehouseTariff || {}), [k]: v } }));
  const toggleTariffLocation = (id) => setForm(f => {
    const cur = (f.warehouseTariff?.locationIds || []).map(String);
    const next = cur.includes(String(id)) ? cur.filter(x => x !== String(id)) : [...cur, String(id)];
    return { ...f, warehouseTariff: { ...(f.warehouseTariff || {}), locationIds: next } };
  });
  // v6.18.3 (#1): a warehouse operates at ITS OWN address(es) — we bill from its
  // main legal address regardless of which of its sites holds the goods. So the
  // operating-location candidates are this warehouse's own addresses (main + extra),
  // not the global list of every warehouse (which wrongly showed WH-01/WH-02).
  const warehouseLocations = form.id
    ? contactAddresses(form).map(({ address, index }: any) => ({
        id: warehouseCpLocId(form.id, index),
        name: index === 0 ? `${form.name || "Main address"} (main)` : `${form.name || "Site"} — ${address || `address ${index + 1}`}`,
        address,
      }))
    : [];
  // v6.10 (#8): a warehouse company can have more than one delivery address.
  const addExtraAddress = () => setForm(f => ({ ...f, extraAddresses: [...(f.extraAddresses || []), ""] }));
  const setExtraAddress = (i, v) => setForm(f => ({ ...f, extraAddresses: (f.extraAddresses || []).map((a, idx) => idx === i ? v : a) }));
  const removeExtraAddress = (i) => setForm(f => ({ ...f, extraAddresses: (f.extraAddresses || []).filter((_, idx) => idx !== i) }));
  // v6.6: seasonal commission rates (consignment sales)
  const setCommissionRate = (i, k, v) => setForm(f => ({ ...f, commissionRates: (f.commissionRates || []).map((r, idx) => idx === i ? { ...r, [k]: v } : r) }));
  const addCommissionRate = () => setForm(f => ({ ...f, commissionRates: [...(f.commissionRates || []), { id: nextId(), season: "", validFrom: "", pct: "" }] }));
  const removeCommissionRate = (i) => setForm(f => ({ ...f, commissionRates: (f.commissionRates || []).filter((_, idx) => idx !== i) }));
  const toggleService = (s) => setForm(f => ({ ...f, services: (f.services || []).includes(s) ? f.services.filter(x => x !== s) : [...(f.services || []), s] }));
  const toggleAdditionalType = (t) => setForm(f => ({ ...f, additionalTypes: (f.additionalTypes || []).includes(t) ? f.additionalTypes.filter(x => x !== t) : [...(f.additionalTypes || []), t] }));
  // Services field is visible if PRIMARY type OR any additional type is logistics-related
  const allTypes = [form.type, ...(form.additionalTypes || [])];
  const showServices = allTypes.some(t => TYPES_WITH_SERVICES.has(t));
  const showOtherTerms = form.paymentTerms === "Other";

  // v6.10 (#6): comma-tolerant numeric coercion applied once, on save. Empty
  // stays empty; "0,30" / "0.30" both become 0.3; garbage becomes empty.
  const numC = (v: any) => {
    if (v === "" || v === null || v === undefined) return "";
    const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
    return isFinite(n) ? n : "";
  };
  function handleSave() {
    if (!form.name) return;
    const t = form.warehouseTariff;
    const normTariff = t ? {
      ...t,
      storagePerKgDay: numC(t.storagePerKgDay),
      storagePerPalletDay: numC(t.storagePerPalletDay),
      freeDays: numC(t.freeDays),
      handlingInPerKg: numC(t.handlingInPerKg),
      handlingOutPerKg: numC(t.handlingOutPerKg),
      sortingPerKg: numC(t.sortingPerKg),
      fxToPLN: numC(t.fxToPLN),
    } : t;
    const normCommissions = form.commissionRates
      ? form.commissionRates.map((r: any) => ({ ...r, pct: numC(r.pct) }))
      : form.commissionRates;
    const cleanExtra = (form.extraAddresses || []).map((a: any) => (typeof a === "string" ? a : a?.address || "")).filter((a: string) => String(a).trim());
    onSave({
      ...form,
      ...(t ? { warehouseTariff: normTariff } : {}),
      ...(form.commissionRates ? { commissionRates: normCommissions } : {}),
      extraAddresses: cleanExtra,
    });
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 14, width: "min(640px, 96vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.18)", overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #F3F4F6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>{counterparty ? "Edit Counterparty" : "New Counterparty"}</div>
            <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>Company-level details. Contact people are added on the next step.</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#999" }}>×</button>
        </div>
        <div style={{ overflowY: "auto", padding: "22px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em", marginBottom: 12 }}>COMPANY</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><Lbl>Primary type</Lbl><Sel value={form.type} onChange={e => sf("type", e.target.value)}>{COUNTERPARTY_TYPES.map(t => <option key={t}>{t}</option>)}</Sel></div>
              <div><Lbl>Company name</Lbl><Inp value={form.name} onChange={e => sf("name", e.target.value)} placeholder="e.g. FreshFarm ES" /></div>
              <div style={{ gridColumn: "span 2" }}>
                <Lbl>Also acts as <span style={{ color: "#BBB", fontWeight: 400 }}>(optional — for counterparties wearing multiple hats)</span></Lbl>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {COUNTERPARTY_TYPES.filter(t => t !== form.type && t !== "Other").map(t => {
                    const active = (form.additionalTypes || []).includes(t);
                    const palette = TYPE_COLORS[t];
                    return (
                      <button key={t} type="button" onClick={() => toggleAdditionalType(t)}
                        style={{
                          padding: "4px 10px", borderRadius: 6,
                          border: `1px solid ${active ? palette.color : "#E5E7EB"}`,
                          background: active ? palette.bg : "#fff",
                          color: active ? palette.color : "#888",
                          fontSize: 11, fontWeight: active ? 600 : 500, cursor: "pointer",
                        }}>
                        {active && "✓ "}{t}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div><Lbl>Country</Lbl><Inp value={form.country} onChange={e => sf("country", e.target.value)} placeholder="e.g. Poland" /></div>
              <div><Lbl>NIP / Local Tax ID / EU VAT number</Lbl><Inp value={form.nip || form.vatEuId || ""} onChange={e => sf("nip", e.target.value)} placeholder="e.g. 5252842787 or PL5252842787" /></div>
              <div style={{ gridColumn: "span 2" }}><Lbl>Address</Lbl><Inp value={form.address} onChange={e => sf("address", e.target.value)} placeholder="Street, City, Postcode" /></div>
              <div><Lbl>Default currency</Lbl><Sel value={form.defaultCurrency} onChange={e => sf("defaultCurrency", e.target.value)}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</Sel></div>
              <div style={{ gridColumn: "span 2" }}>
                <Lbl>Default payment terms</Lbl>
                <Sel value={form.paymentTerms} onChange={e => sf("paymentTerms", e.target.value)}>{PAYMENT_TERMS.map(p => <option key={p}>{p}</option>)}</Sel>
                {showOtherTerms && (
                  <div style={{ marginTop: 8 }}>
                    <Inp value={form.paymentTermsOther} onChange={e => sf("paymentTermsOther", e.target.value)} placeholder='Specify the terms — e.g. "50% advance, 50% on delivery", "L/C at sight"' />
                  </div>
                )}
              </div>
            </div>
          </div>
          {showServices && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em", marginBottom: 8 }}>
                SERVICES PROVIDED
                <span style={{ marginLeft: 8, fontWeight: 400, color: "#BBB", textTransform: "none", letterSpacing: 0 }}>
                  Tick everything this counterparty can do for you
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {SERVICES.map(s => {
                  const active = (form.services || []).includes(s);
                  const palette = SERVICE_COLORS[s];
                  return (
                    <button key={s} type="button" onClick={() => toggleService(s)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "6px 12px", borderRadius: 20,
                        border: `1px solid ${active ? palette.color : "#E5E7EB"}`,
                        background: active ? palette.bg : "#fff",
                        color: active ? palette.color : "#666",
                        fontSize: 12, fontWeight: active ? 600 : 500, cursor: "pointer",
                      }}>
                      <span style={{ fontSize: 13 }}>{palette.icon}</span>{s}
                      {active && <span style={{ fontSize: 10, opacity: 0.7 }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em", marginBottom: 8 }}>FINANCE</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ gridColumn: "span 2" }}><Lbl>Bank</Lbl><Inp value={form.finance?.bankName || ""} onChange={e => sff("bankName", e.target.value)} placeholder="e.g. PKO Bank Polski SA" /></div>
              <div style={{ gridColumn: "span 2" }}><Lbl>Account number (IBAN)</Lbl><Inp value={form.finance?.accountNumber || ""} onChange={e => sff("accountNumber", e.target.value)} placeholder="PL96 1020 1026 0000 1502 0511 6969" /></div>
              <div><Lbl>SWIFT / BIC</Lbl><Inp value={form.finance?.swift || ""} onChange={e => sff("swift", e.target.value)} placeholder="BPKOPLPW" /></div>
            </div>
          </div>
          {allTypes.includes("Warehouse") && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em", marginBottom: 8 }}>WAREHOUSE TARIFF <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· used to predict and check this warehouse's invoices</span></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div><Lbl>Storage / kg / day</Lbl><Inp type="text" inputMode="decimal" value={form.warehouseTariff?.storagePerKgDay ?? ""} onChange={e => sft("storagePerKgDay", e.target.value)} placeholder="e.g. 0,01" /></div>
                <div><Lbl>Storage / pallet / day</Lbl><Inp type="text" inputMode="decimal" value={form.warehouseTariff?.storagePerPalletDay ?? ""} onChange={e => sft("storagePerPalletDay", e.target.value)} placeholder="e.g. 2,00" /></div>
                <div><Lbl>Free days from receipt</Lbl><Inp type="text" inputMode="numeric" value={form.warehouseTariff?.freeDays ?? ""} onChange={e => sft("freeDays", e.target.value)} placeholder="0" /></div>
                <div><Lbl>Handling in / kg</Lbl><Inp type="text" inputMode="decimal" value={form.warehouseTariff?.handlingInPerKg ?? ""} onChange={e => sft("handlingInPerKg", e.target.value)} placeholder="e.g. 0,30" /></div>
                <div><Lbl>Handling out / kg</Lbl><Inp type="text" inputMode="decimal" value={form.warehouseTariff?.handlingOutPerKg ?? ""} onChange={e => sft("handlingOutPerKg", e.target.value)} placeholder="e.g. 0,30" /></div>
                <div><Lbl>Sorting / kg</Lbl><Inp type="text" inputMode="decimal" value={form.warehouseTariff?.sortingPerKg ?? ""} onChange={e => sft("sortingPerKg", e.target.value)} placeholder="e.g. 0,15" /></div>
                <div><Lbl>Currency</Lbl>
                  <select value={form.warehouseTariff?.currency || "PLN"} onChange={e => sft("currency", e.target.value)} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, background: "#fff" }}>
                    {["PLN", "EUR", "USD"].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div><Lbl>FX → PLN</Lbl><Inp type="text" inputMode="decimal" value={form.warehouseTariff?.fxToPLN ?? ""} onChange={e => sft("fxToPLN", e.target.value)} placeholder={(form.warehouseTariff?.currency || "PLN") === "PLN" ? "1" : "4,25"} /></div>
              </div>
              <Lbl>Locations this warehouse operates <span style={{ color: "#AAA", fontWeight: 400 }}>(lots stored there are charged on this tariff)</span></Lbl>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                {warehouseLocations.map((l: any) => {
                  const on = (form.warehouseTariff?.locationIds || []).map(String).includes(String(l.id));
                  return (
                    <button key={l.id} type="button" onClick={() => toggleTariffLocation(l.id)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 7, border: `1.5px solid ${on ? "#16A34A" : "#E5E7EB"}`, background: on ? "#F0FDF4" : "#fff", color: on ? "#15803D" : "#666", fontSize: 12, fontWeight: on ? 600 : 500, cursor: "pointer", fontFamily: "inherit" }}>
                      {l.name}{on && <span style={{ fontSize: 10, opacity: 0.7 }}>✓</span>}
                    </button>
                  );
                })}
                {!warehouseLocations.length && <span style={{ fontSize: 11, color: "#AAA", fontStyle: "italic" }}>{form.id ? "This warehouse has no address yet — add one above and it becomes its operating location." : "Save this warehouse first; its address then becomes its operating location. Add more addresses below for extra sites."}</span>}
              </div>
              <div style={{ marginTop: 12 }}>
                <Lbl>Additional delivery addresses <span style={{ color: "#AAA", fontWeight: 400 }}>(if this warehouse has more than one site we can send cargo to)</span></Lbl>
                {(form.extraAddresses || []).map((a: any, i: number) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 34px", gap: 8, marginBottom: 6, alignItems: "center" }}>
                    <Inp value={typeof a === "string" ? a : (a?.address || "")} onChange={e => setExtraAddress(i, e.target.value)} placeholder="Street, City, Postcode" />
                    <button type="button" onClick={() => removeExtraAddress(i)} style={{ border: "1px solid #FECACA", background: "#fff", color: "#DC2626", borderRadius: 6, padding: "8px 0", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>✕</button>
                  </div>
                ))}
                <button type="button" onClick={addExtraAddress} style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", color: "#2563EB", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>+ Add another address</button>
              </div>
            </div>
          )}
          {allTypes.includes("Supplier") && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em", marginBottom: 8 }}>COMMISSION — CONSIGNMENT SALES <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· season rates; the rate valid on the settlement date is prefilled</span></div>
              {(form.commissionRates || []).map((r: any, i: number) => (
                <div key={r.id || i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 0.7fr 34px", gap: 8, marginBottom: 6, alignItems: "end" }}>
                  <div><Lbl>Season</Lbl><Inp value={r.season || ""} onChange={e => setCommissionRate(i, "season", e.target.value)} placeholder="e.g. 2026/27" /></div>
                  <div><Lbl>Valid from</Lbl><Inp type="date" value={r.validFrom || ""} onChange={e => setCommissionRate(i, "validFrom", e.target.value)} /></div>
                  <div><Lbl>Commission %</Lbl><Inp type="text" inputMode="decimal" value={r.pct ?? ""} onChange={e => setCommissionRate(i, "pct", e.target.value)} placeholder="e.g. 10" /></div>
                  <button type="button" onClick={() => removeCommissionRate(i)} style={{ border: "1px solid #FECACA", background: "#fff", color: "#DC2626", borderRadius: 6, padding: "8px 0", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>✕</button>
                </div>
              ))}
              <button type="button" onClick={addCommissionRate} style={{ padding: "6px 12px", borderRadius: 7, border: "none", background: "#16A34A", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>+ Add season rate</button>
            </div>
          )}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em", marginBottom: 8 }}>NOTES</div>
            <textarea value={form.notes} onChange={e => sf("notes", e.target.value)} rows={3}
              placeholder="Payment preferences, certifications, special instructions…"
              style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none", fontFamily: "inherit", resize: "vertical", lineHeight: 1.6 }} />
          </div>
        </div>
        <div style={{ padding: "14px 24px", borderTop: "1px solid #F3F4F6", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ padding: "8px 20px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSave}
            style={{ padding: "8px 22px", borderRadius: 7, border: "none", background: "#111", color: "#fff", fontSize: 13, fontWeight: 600, cursor: form.name ? "pointer" : "not-allowed", opacity: form.name ? 1 : 0.5 }}>
            {counterparty ? "Save Changes" : "Add Counterparty"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── INLINE PERSON EDITOR (used inside the detail panel) ────────────────────
function PersonEditor({ person, onSave, onCancel }: any) {
  const blank = { name: "", role: "Buyer", email: "", phone: "", isPrimary: false, notes: "" };
  const [form, setForm] = useState(person ? { ...person } : { ...blank, id: null });
  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 10, padding: 12, marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.06em", marginBottom: 10 }}>{person?.id ? "EDIT PERSON" : "NEW PERSON"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <div><Lbl>Full name</Lbl><Inp value={form.name} onChange={e => sf("name", e.target.value)} placeholder="e.g. Anna Nowak" /></div>
        <div><Lbl>Role</Lbl><Sel value={form.role} onChange={e => sf("role", e.target.value)}>{ROLES.map(r => <option key={r}>{r}</option>)}</Sel></div>
        <div><Lbl>Email</Lbl><Inp value={form.email} onChange={e => sf("email", e.target.value)} type="email" placeholder="name@company.com" /></div>
        <div><Lbl>Phone</Lbl><Inp value={form.phone} onChange={e => sf("phone", e.target.value)} placeholder="+48 …" /></div>
      </div>
      <div style={{ marginBottom: 8 }}>
        <Lbl>Notes (optional)</Lbl>
        <Inp value={form.notes} onChange={e => sf("notes", e.target.value)} placeholder="e.g. Decision maker on pricing" />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#555", cursor: "pointer", marginBottom: 10 }}>
        <input type="checkbox" checked={form.isPrimary} onChange={e => sf("isPrimary", e.target.checked)} />
        Primary contact for this company
      </label>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, cursor: "pointer" }}>Cancel</button>
        <button onClick={() => { if (!form.name) return; onSave(form); }} style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: "#111", color: "#fff", fontSize: 12, fontWeight: 600, cursor: form.name ? "pointer" : "not-allowed", opacity: form.name ? 1 : 0.5 }}>
          Save
        </button>
      </div>
    </div>
  );
}

// ─── DETAIL PANEL — counterparty header + person list ───────────────────────
function CounterpartyDetailPanel({ counterparty, onEditCompany, onDeleteCompany, onClose, onEmail, onSavePerson, onDeletePerson, onSetPrimary }: any) {
  const [editingPersonId, setEditingPersonId] = useState(null); // person.id | "new" | null
  const typeStyle = TYPE_COLORS[counterparty.type] || TYPE_COLORS["Other"];

  function handleSavePerson(p) {
    onSavePerson(counterparty.id, p);
    setEditingPersonId(null);
  }

  return (
    <div style={{ width: 380, background: "#fff", borderLeft: "1px solid #EBEBEB", display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #F3F4F6", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <TypeBadge type={counterparty.type} />
        {(counterparty.additionalTypes || []).map(t => (
          <span key={t} title={`Also acts as ${t}`}
            style={{ background: TYPE_COLORS[t]?.bg || "#F3F4F6", color: TYPE_COLORS[t]?.color || "#6B7280", padding: "2px 8px", borderRadius: 16, fontSize: 10.5, fontWeight: 700 }}>
            + {t}
          </span>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#CCC" }}>×</button>
      </div>

      <div style={{ overflowY: "auto", flex: 1 }}>
        {/* Company header */}
        <div style={{ padding: "20px 20px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            <Avatar label={counterparty.name} bg={typeStyle.bg} color={typeStyle.color} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#111", lineHeight: 1.2 }}>{counterparty.name}</div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{counterparty.country || "—"} · {counterparty.defaultCurrency}</div>
            </div>
          </div>
          {[
            { label: "NIP / Local Tax ID / EU VAT number", value: counterparty.nip || counterparty.vatEuId },
            { label: "Address", value: counterparty.address },
            { label: "Payment terms", value: counterparty.paymentTerms === "Other" ? (counterparty.paymentTermsOther || "Other (unspecified)") : counterparty.paymentTerms },
          ].map(({ label, value }) => value ? (
            <div key={label} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#BBB", letterSpacing: "0.06em", marginBottom: 2 }}>{label.toUpperCase()}</div>
              <div style={{ fontSize: 13, color: "#333" }}>{value}</div>
            </div>
          ) : null)}
          {showServicesRow(counterparty) && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#BBB", letterSpacing: "0.06em", marginBottom: 6 }}>SERVICES</div>
              <ServicesRow services={counterparty.services} />
            </div>
          )}
        </div>

        {(counterparty.finance?.bankName || counterparty.finance?.accountNumber) && (
          <div style={{ margin: "0 20px 14px", padding: 12, background: "#F9FAFB", border: "1px solid #F3F4F6", borderRadius: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#BBB", letterSpacing: "0.06em", marginBottom: 8 }}>FINANCE</div>
            {counterparty.finance.bankName && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: "#999" }}>Bank</div>
                <div style={{ fontSize: 12.5, color: "#333", fontWeight: 500 }}>{counterparty.finance.bankName}</div>
              </div>
            )}
            {counterparty.finance.accountNumber && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: "#999" }}>Account</div>
                <div style={{ fontSize: 11.5, color: "#333", fontFamily: "ui-monospace, Menlo, monospace", wordBreak: "break-all" }}>{counterparty.finance.accountNumber}</div>
              </div>
            )}
            {counterparty.finance.swift && (
              <div>
                <div style={{ fontSize: 10, color: "#999" }}>SWIFT / BIC</div>
                <div style={{ fontSize: 12, color: "#333", fontFamily: "ui-monospace, Menlo, monospace" }}>{counterparty.finance.swift}</div>
              </div>
            )}
          </div>
        )}

        {counterparty.notes && (
          <div style={{ margin: "0 20px 14px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#BBB", letterSpacing: "0.06em", marginBottom: 6 }}>NOTES</div>
            <div style={{ fontSize: 12.5, color: "#555", lineHeight: 1.6 }}>{counterparty.notes}</div>
          </div>
        )}

        {counterparty.linkedDocs?.length > 0 && (
          <div style={{ margin: "0 20px 14px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#BBB", letterSpacing: "0.06em", marginBottom: 6 }}>LINKED DOCUMENTS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {counterparty.linkedDocs.map(ref => (
                <span key={ref} style={{ background: "#EFF6FF", color: "#2563EB", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4, fontFamily: "ui-monospace, Menlo, monospace" }}>{ref}</span>
              ))}
            </div>
          </div>
        )}

        {/* Contact persons */}
        <div style={{ margin: "0 20px 20px", paddingTop: 10, borderTop: "1px solid #F3F4F6" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#BBB", letterSpacing: "0.06em" }}>CONTACT PEOPLE ({counterparty.contacts.length})</div>
            {editingPersonId !== "new" && (
              <button onClick={() => setEditingPersonId("new")} style={{ background: "#16A34A", border: "1px solid #16A34A", borderRadius: 6, fontSize: 11, padding: "3px 10px", cursor: "pointer", color: "#fff", fontWeight: 600 }}>+ Add contact</button>
            )}
          </div>

          {editingPersonId === "new" && (
            <PersonEditor onSave={handleSavePerson} onCancel={() => setEditingPersonId(null)} />
          )}

          {counterparty.contacts.map(p => editingPersonId === p.id ? (
            <PersonEditor key={p.id} person={p} onSave={handleSavePerson} onCancel={() => setEditingPersonId(null)} />
          ) : (
            <div key={p.id} style={{ padding: 12, border: "1px solid #F3F4F6", borderRadius: 10, marginBottom: 8, background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{p.name}</div>
                    {p.isPrimary && <span style={{ fontSize: 9, fontWeight: 700, color: "#16A34A", background: "#DCFCE7", padding: "1px 6px", borderRadius: 4, letterSpacing: "0.04em" }}>PRIMARY</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 1 }}>{p.role}</div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {p.email && <button onClick={() => onEmail(counterparty, p)} title="Email" style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 4, fontSize: 11, padding: "2px 6px", cursor: "pointer" }}>✉</button>}
                  {!p.isPrimary && <button onClick={() => onSetPrimary(counterparty.id, p.id)} title="Make primary" style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 4, fontSize: 11, padding: "2px 6px", cursor: "pointer" }}>★</button>}
                  <button onClick={() => setEditingPersonId(p.id)} title="Edit contact" style={{ background: "#fff", border: "1px solid #2563EB", borderRadius: 4, fontSize: 11, padding: "2px 8px", cursor: "pointer", color: "#2563EB", fontWeight: 600 }}>✎ Edit contact</button>
                  {counterparty.contacts.length > 1 && (
                    <button onClick={() => { if (window.confirm(`Remove ${p.name}?`)) onDeletePerson(counterparty.id, p.id); }} title="Delete" style={{ background: "none", border: "1px solid #FECACA", color: "#DC2626", borderRadius: 4, fontSize: 11, padding: "2px 6px", cursor: "pointer" }}>🗑</button>
                  )}
                </div>
              </div>
              {p.email && (
                <div style={{ fontSize: 12, marginBottom: 2 }}>
                  <a href={`mailto:${p.email}`} style={{ color: "#2563EB", textDecoration: "none" }}>{p.email}</a>
                </div>
              )}
              {p.phone && <div style={{ fontSize: 12, color: "#555" }}>{p.phone}</div>}
              {p.notes && <div style={{ fontSize: 11, color: "#888", marginTop: 6, fontStyle: "italic" }}>{p.notes}</div>}
            </div>
          ))}

          {counterparty.contacts.length === 0 && editingPersonId !== "new" && (
            <div style={{ padding: 18, textAlign: "center", color: "#AAA", fontSize: 12, border: "1px dashed #E5E7EB", borderRadius: 8 }}>
              No contact people yet. Click <strong>+ Add</strong> above.
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: "12px 20px", borderTop: "1px solid #F3F4F6", display: "flex", gap: 8 }}>
        <button onClick={() => onEditCompany(counterparty)} style={{ flex: 1, padding: "7px 0", borderRadius: 7, border: "1px solid #2563EB", background: "#fff", color: "#2563EB", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>✎ Edit company</button>
        <button onClick={() => { if (window.confirm(`Delete ${counterparty.name} and all ${counterparty.contacts.length} contact(s)?`)) { onDeleteCompany(counterparty.id); onClose(); } }} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: "#FEE2E2", color: "#DC2626", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>🗑</button>
      </div>
    </div>
  );
}

// ─── EMAIL QUICK MODAL ──────────────────────────────────────────────────────
function EmailModal({ counterparty, person, onClose }: any) {
  const [subject, setSubject] = useState(`Message from ${COMPANY.name} — ${new Date().toLocaleDateString("pl-PL")}`);
  const [body, setBody] = useState(`Dear ${person.name || "Sir/Madam"},\n\nI am writing to you on behalf of ${COMPANY.name}.\n\n\n\nBest regards,\n${COMPANY.person}\n${COMPANY.name}`);
  const [sent, setSent] = useState(false);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 14, width: 520, boxShadow: "0 24px 80px rgba(0,0,0,0.18)", overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #F3F4F6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Email · {person.name}</div>
            <div style={{ fontSize: 11, color: "#999" }}>{counterparty.name}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#999" }}>×</button>
        </div>
        {sent ? (
          <div style={{ padding: "40px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✓</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#16A34A" }}>Email sent!</div>
          </div>
        ) : (
          <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div><Lbl>TO</Lbl><Inp value={person.email} onChange={() => {}} style={{ background: "#F9FAFB", color: "#666" }} /></div>
            <div><Lbl>SUBJECT</Lbl><Inp value={subject} onChange={e => setSubject(e.target.value)} /></div>
            <div><Lbl>MESSAGE</Lbl><textarea value={body} onChange={e => setBody(e.target.value)} rows={8} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none", fontFamily: "inherit", resize: "vertical", lineHeight: 1.6 }} /></div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => { setSent(true); setTimeout(onClose, 1800); }} style={{ padding: "8px 20px", borderRadius: 7, border: "none", background: "#111", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Send</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CSV EXPORT ─────────────────────────────────────────────────────────────
function exportCSV(rows, filename) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── FAKTUROWNIA IMPORT ─────────────────────────────────────────────────────
// Parses a Fakturownia kontrahenci export (.xls/.xlsx/.csv) and lets the
// user review + bulk-assign types before committing.

// EU member country prefixes (used to detect EU VAT format)
const EU_VAT_PREFIXES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR",
  "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

// Country → default counterparty type mapping (the import auto-rules)
const COUNTRY_TYPE_RULES: Record<string, string> = {
  // Producer countries (typically suppliers for fresh produce)
  Egypt: "Supplier", Jordan: "Supplier", Libya: "Supplier", Morocco: "Supplier",
  "Saudi Arabia": "Supplier", "United Arab Emirates": "Supplier", Oman: "Supplier",
  Qatar: "Supplier", Cambodia: "Supplier", Chile: "Supplier", Colombia: "Supplier",
  Belarus: "Supplier", Ukraine: "Supplier",
  // EU client countries
  Germany: "Client", Italy: "Client", Hungary: "Client", Croatia: "Client",
  France: "Client", Spain: "Client", Greece: "Client", Romania: "Client",
  Netherlands: "Client", Belgium: "Client", Czechia: "Client", "Czech Republic": "Client",
  // Poland gets a special rule — see assignDefaultType()
};

// Smart parse a TAX ID into either a local NIP or an EU VAT id
function parseTaxId(raw) {
  if (!raw) return { nip: "", vatEuId: "" };
  let s = String(raw).trim();
  // Strip common prefixes like "VAT ID:", "NIP:"
  s = s.replace(/^(VAT\s*ID:?|NIP:?|VAT:?|Tax\s*ID:?)\s*/i, "").trim();
  // Strip all whitespace, hyphens, dots for the "compact" form
  const compact = s.replace(/[\s\-\.]/g, "").toUpperCase();
  // Detect 2-letter EU prefix
  if (compact.length >= 4) {
    const prefix = compact.substring(0, 2);
    if (EU_VAT_PREFIXES.has(prefix)) {
      return { nip: "", vatEuId: compact };
    }
  }
  // Special case: all-zeros or placeholder
  if (/^[0\-\s]+$/.test(s)) return { nip: "", vatEuId: "" };
  // Otherwise treat as local tax ID
  return { nip: compact, vatEuId: "" };
}

// Compose address from Street + Postcode + City
function composeAddress(street, postcode, city) {
  const parts = [];
  if (street) parts.push(String(street).trim());
  const pc = postcode ? String(postcode).trim() : "";
  const ct = city ? String(city).trim() : "";
  if (pc && ct) parts.push(`${pc} ${ct}`);
  else if (pc) parts.push(pc);
  else if (ct) parts.push(ct);
  return parts.join(", ");
}

// Decide default type for an imported record
function assignDefaultType({ isCompany, country, hasNip }: any) {
  // Individuals (Company=False) are Polish farmers/small suppliers
  if (isCompany === false) return "Supplier";
  // Apply country rule
  const rule = COUNTRY_TYPE_RULES[country];
  if (rule) return rule;
  // Poland — companies are mixed; default to Client (most B2B records are buyers)
  if (country === "Poland") return "Client";
  // Unknown country — leave as Other for the user to assign
  return "Other";
}

// Default currency by country
function defaultCurrencyByCountry(country) {
  if (!country) return "PLN";
  const c = String(country).trim();
  if (c === "Poland") return "PLN";
  const euCountries = ["Germany", "Italy", "Hungary", "Croatia", "France", "Spain", "Greece", "Netherlands", "Belgium", "Czechia", "Romania", "Slovakia", "Slovenia", "Portugal", "Ireland", "Austria", "Finland", "Estonia"];
  if (euCountries.includes(c)) return "EUR";
  return "USD";
}

// Parse a Fakturownia row into our counterparty shape
function parseFakturowniaRow(row, existingCounterparties) {
  const taxId = parseTaxId(row["TAX ID"]);
  const hasNip = !!(taxId.nip || taxId.vatEuId);
  const isCompany = row["Company"] === true || row["Company"] === "true" || row["Company"] === "True";
  const country = row["Country"] ? String(row["Country"]).trim() : "";
  const name = row["Client"] ? String(row["Client"]).trim() : "";
  const firstName = row["First name"] ? String(row["First name"]).trim() : "";
  const lastName = row["Last name"] ? String(row["Last name"]).trim() : "";
  const email = row["E-mail"] ? String(row["E-mail"]).trim() : "";
  const phone = (row["Phone number"] || row["Mobile phone"] || "");
  const personName = [firstName, lastName].filter(Boolean).join(" ").trim();

  // Build the primary contact — fall back to a placeholder if no person info
  const primaryContact = personName
    ? { id: 1, name: personName, role: "Other", email, phone: String(phone).trim(), isPrimary: true, notes: "" }
    : email || phone
      ? { id: 1, name: "—", role: "Other", email, phone: String(phone).trim(), isPrimary: true, notes: "Contact person name unknown" }
      : null;

  // Dedup detection — use the SAME fuzzy matcher as the merge tool (tax-digit
  // match + legal-suffix-stripped name containment), so the import flags the same
  // duplicates the merge screen would, instead of a narrower exact-match rule.
  const dupMatches = findCounterpartyDuplicates(
    { name, nip: taxId.nip, vatEuId: taxId.vatEuId },
    existingCounterparties || [],
    null
  );
  let duplicateOf = null;
  if (dupMatches.length) duplicateOf = dupMatches[0].reason === "tax" ? "nip" : "name";

  return {
    // Importer-only fields (not persisted)
    _row: row["ID"] || row["__rowNum__"] || "",
    _selected: !duplicateOf,
    _duplicate: duplicateOf,
    // Counterparty fields
    type: assignDefaultType({ isCompany, country, hasNip }),
    additionalTypes: [],
    name,
    country,
    address: composeAddress(row["Street"], row["Postcode"], row["City"]),
    nip: taxId.nip,
    vatEuId: taxId.vatEuId,
    defaultCurrency: defaultCurrencyByCountry(country),
    paymentTerms: "30 days from invoice date",
    paymentTermsOther: "",
    services: [],
    finance: {
      bankName: row["Bank"] ? String(row["Bank"]).trim() : "",
      accountNumber: row["Account Number"] ? String(row["Account Number"]).trim() : "",
      swift: "",
    },
    notes: [
      row["Website"] && `Website: ${row["Website"]}`,
      row["Additional note"],
    ].filter(Boolean).join(" · ") || "",
    contacts: primaryContact ? [primaryContact] : [],
  };
}

// ─── CSV IMPORT (our own export format — round-trips contacts.csv) ───────────
// Minimal RFC-4180 parser: handles quoted fields, escaped quotes ("") and
// embedded commas / newlines.
function splitCsvText(text: string): string[][] {
  const s = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = []; let row: string[] = []; let field = ""; let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length && !(r.length === 1 && r[0].trim() === ""));
}

// Parse a CSV produced by our own "Export CSV" (one row per contact person, so
// several rows can share a company). Groups rows back into counterparties and
// flags duplicates with the same fuzzy matcher the merge tool uses.
function parseOwnCsv(text: string, existingCounterparties: any[]) {
  const rows = splitCsvText(text);
  if (rows.length < 2) return [];
  const header = rows[0].map(h => String(h || "").trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const idx = {
    type: col("Type"), addt: col("Also acts as"), company: col("Company"), country: col("Country"),
    nip: col("NIP"), vat: col("EU VAT"), address: col("Address"), currency: col("Currency"),
    terms: col("Payment Terms"), services: col("Services"), pname: col("Person Name"),
    prole: col("Role"), pemail: col("Email"), pphone: col("Phone"), pprimary: col("Primary"), notes: col("Notes"),
  };
  if (idx.company < 0) throw new Error("This CSV doesn't look like a contacts export — the 'Company' column is missing.");
  const get = (r: string[], i: number) => (i >= 0 && i < r.length ? String(r[i] ?? "").trim() : "");
  const splitList = (v: string) => String(v || "").split(";").map(x => x.trim()).filter(Boolean);
  const groups = new Map<string, string[][]>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const company = get(r, idx.company);
    if (!company) continue;
    const key = `${company.toLowerCase()}||${get(r, idx.country).toLowerCase()}||${get(r, idx.nip).toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const out: any[] = [];
  groups.forEach(grp => {
    const r0 = grp[0];
    const name = get(r0, idx.company);
    const country = get(r0, idx.country);
    const nip = get(r0, idx.nip);
    const vatEuId = get(r0, idx.vat);
    const contacts: any[] = [];
    grp.forEach(r => {
      const pn = get(r, idx.pname), pe = get(r, idx.pemail), pp = get(r, idx.pphone);
      if (pn || pe || pp) contacts.push({
        id: contacts.length + 1, name: pn || "—", role: get(r, idx.prole) || "Other",
        email: pe, phone: pp, isPrimary: /^(yes|true|1)$/i.test(get(r, idx.pprimary)) || contacts.length === 0, notes: "",
      });
    });
    const dupMatches = findCounterpartyDuplicates({ name, nip, vatEuId }, existingCounterparties || [], null);
    const duplicateOf = dupMatches.length ? (dupMatches[0].reason === "tax" ? "nip" : "name") : null;
    out.push({
      _row: name, _selected: !duplicateOf, _duplicate: duplicateOf,
      type: get(r0, idx.type) || "Other",
      additionalTypes: splitList(get(r0, idx.addt)),
      name, country, address: get(r0, idx.address), nip, vatEuId,
      defaultCurrency: get(r0, idx.currency) || defaultCurrencyByCountry(country),
      paymentTerms: get(r0, idx.terms) || "30 days from invoice date", paymentTermsOther: "",
      services: splitList(get(r0, idx.services)),
      finance: { bankName: "", accountNumber: "", swift: "" },
      notes: get(r0, idx.notes), contacts,
    });
  });
  return out;
}

function ImportModal({ existingCounterparties, onCancel, onImport, source = "fakturownia" }: any) {
  const isCsv = source === "csv";
  const [stage, setStage] = useState("upload"); // upload | parsing | review
  const [filename, setFilename] = useState("");
  const [parsedRows, setParsedRows] = useState<any[]>([]); // array of parsed counterparty candidates
  const [filterType, setFilterType] = useState("All");
  const [filterDup, setFilterDup] = useState("All"); // All | Duplicates | New
  const [search, setSearch] = useState("");
  const fileInputRef = useRef(null);

  function handleFile(file) {
    if (!file) return;
    setFilename(file.name);
    setStage("parsing");
    if (isCsv) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = parseOwnCsv(String(e.target?.result || ""), existingCounterparties);
          if (!parsed.length) throw new Error("No contact rows found in the file.");
          setParsedRows(parsed);
          setStage("review");
        } catch (err) {
          alert("Could not parse CSV: " + (err instanceof Error ? err.message : String(err)));
          setStage("upload");
        }
      };
      reader.readAsText(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = e.target?.result;
        if (!(result instanceof ArrayBuffer)) {
          throw new Error("Could not read file as ArrayBuffer");
        }
        const data = new Uint8Array(result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        const parsed = rows
          .filter(r => r["Client"] && String(r["Client"]).trim() && String(r["Client"]).trim() !== "-")
          .map(r => parseFakturowniaRow(r, existingCounterparties));
        setParsedRows(parsed);
        setStage("review");
      } catch (err) {
        alert("Could not parse file: " + (err instanceof Error ? err.message : String(err)));
        setStage("upload");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // Bulk operations
  function setTypeForFiltered(type) {
    setParsedRows(rows => rows.map(r => visible(r) ? { ...r, type } : r));
  }
  function selectAllFiltered(selected) {
    setParsedRows(rows => rows.map(r => visible(r) ? { ...r, _selected: selected } : r));
  }
  function toggleRow(idx, k, v) {
    setParsedRows(rows => rows.map((r, i) => i === idx ? { ...r, [k]: v } : r));
  }
  function visible(r) {
    if (filterType !== "All" && r.type !== filterType) return false;
    if (filterDup === "Duplicates" && !r._duplicate) return false;
    if (filterDup === "New" && r._duplicate) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${r.name} ${r.country} ${r.nip} ${r.vatEuId}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }

  const visibleRows = parsedRows.filter(visible);
  const selectedCount = parsedRows.filter(r => r._selected).length;
  const duplicateCount = parsedRows.filter(r => r._duplicate).length;
  const countByType: Record<string, number> = parsedRows.reduce((acc: Record<string, number>, r: any) => {
    const type = String(r.type || "Other");
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  function commit() {
    const toImport = parsedRows.filter(r => r._selected).map(r => {
      // strip internal fields before commit
      const { _row, _selected, _duplicate, ...clean } = r;
      return clean;
    });
    onImport(toImport);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 14, width: "min(1280px, 98vw)", maxHeight: "94vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.18)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #F3F4F6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>{isCsv ? "Import contacts from CSV" : "Import contacts from Fakturownia"}</div>
            <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>
              {stage === "upload" && (isCsv ? "Drop a contacts CSV (same columns as Export CSV)" : "Drop the kontrahenci export (.xls / .xlsx / .csv)")}
              {stage === "parsing" && "Parsing the file…"}
              {stage === "review" && `${parsedRows.length} records parsed — review and assign types, then import`}
            </div>
          </div>
          <button onClick={onCancel} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999" }}>×</button>
        </div>

        {/* Stage: upload */}
        {stage === "upload" && (
          <div style={{ padding: 32, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.background = "#F0F9FF"; e.currentTarget.style.borderColor = "#0284C7"; }}
              onDragLeave={e => { e.currentTarget.style.background = "#FAFAFA"; e.currentTarget.style.borderColor = "#E5E7EB"; }}
              onDrop={e => { e.preventDefault(); e.currentTarget.style.background = "#FAFAFA"; e.currentTarget.style.borderColor = "#E5E7EB"; const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              onClick={() => fileInputRef.current?.click()}
              style={{ border: "2px dashed #E5E7EB", borderRadius: 12, padding: "60px 40px", textAlign: "center", background: "#FAFAFA", cursor: "pointer", transition: "all 0.15s", width: "100%", maxWidth: 520 }}
            >
              <div style={{ fontSize: 44, marginBottom: 12 }}>📊</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#111", marginBottom: 6 }}>{isCsv ? "Drop a contacts CSV here" : "Drop the Fakturownia export here"}</div>
              <div style={{ fontSize: 12.5, color: "#888" }}>{isCsv ? "A .csv with the same columns as Export CSV · max ~10 MB" : "Supports .xls / .xlsx / .csv · max ~10 MB"}</div>
              <input ref={fileInputRef} type="file" accept={isCsv ? ".csv" : ".xls,.xlsx,.csv"} style={{ display: "none" }} onChange={e => handleFile(e.target.files?.[0])} />
            </div>
            <div style={{ marginTop: 18, padding: "12px 16px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, maxWidth: 520, fontSize: 12, color: "#92400E" }}>
              {isCsv
                ? <><strong>Tip:</strong> use a file with the same columns as <em>Export CSV</em> (<code>Type, Company, Country, NIP, EU VAT, Address, Currency, Payment Terms, Services, Person Name, Role, Email, Phone, Primary, Notes</code>). Several rows with the same company are merged into one contact with multiple people. Likely duplicates are flagged so you can skip them.</>
                : <><strong>Tip:</strong> in Fakturownia, go to <em>Kontrahenci → Eksport → XLS</em>. The columns we expect are <code>ID, Client, TAX ID, City, Country, Company, E-mail, Bank, Account Number</code> and a few more — the standard export already includes them.</>}
            </div>
          </div>
        )}

        {/* Stage: parsing */}
        {stage === "parsing" && (
          <div style={{ padding: 60, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 48, height: 48, border: "3px solid #E5E7EB", borderTopColor: "#2563EB", borderRadius: "50%", animation: "spin 0.8s linear infinite", marginBottom: 16 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: "#111", marginBottom: 4 }}>Parsing {filename}…</div>
            <div style={{ fontSize: 12, color: "#888" }}>Detecting types, splitting NIP / EU VAT, checking duplicates</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Stage: review */}
        {stage === "review" && (
          <>
            {/* Summary bar */}
            <div style={{ padding: "12px 24px", background: "#F9FAFB", borderBottom: "1px solid #F3F4F6", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, color: "#444" }}>
                <strong>{selectedCount}</strong> of {parsedRows.length} selected to import
                {duplicateCount > 0 && <span style={{ color: "#D97706", marginLeft: 8 }}>· {duplicateCount} possible duplicate{duplicateCount !== 1 ? "s" : ""}</span>}
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 14, fontSize: 11, color: "#666" }}>
                {Object.entries(countByType).map(([t, n]) => (
                  <span key={t}><strong style={{ color: TYPE_COLORS[t]?.color || "#111" }}>{n}</strong> {t}</span>
                ))}
              </div>
            </div>

            {/* Filters + bulk actions */}
            <div style={{ padding: "10px 24px", borderBottom: "1px solid #F3F4F6", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name / NIP / country…" style={{ flex: "1 1 220px", minWidth: 180, border: "1px solid #E5E7EB", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, outline: "none" }} />
              <div style={{ display: "flex", gap: 4 }}>
                {["All", "New", "Duplicates"].map(d => (
                  <button key={d} onClick={() => setFilterDup(d)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid", borderColor: filterDup === d ? "#111" : "#E5E7EB", background: filterDup === d ? "#111" : "#fff", color: filterDup === d ? "#fff" : "#555", fontSize: 11, cursor: "pointer", fontWeight: 500 }}>{d}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {["All", ...COUNTERPARTY_TYPES].map(t => (
                  <button key={t} onClick={() => setFilterType(t)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid", borderColor: filterType === t ? "#111" : "#E5E7EB", background: filterType === t ? "#111" : "#fff", color: filterType === t ? "#fff" : (t === "All" ? "#555" : TYPE_COLORS[t]?.color), fontSize: 11, cursor: "pointer", fontWeight: 500 }}>{t}</button>
                ))}
              </div>
            </div>

            <div style={{ padding: "8px 24px", borderBottom: "1px solid #F3F4F6", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "#FAFAFA" }}>
              <span style={{ fontSize: 10, color: "#888", fontWeight: 700, letterSpacing: "0.06em" }}>BULK ON {visibleRows.length} VISIBLE:</span>
              <button onClick={() => selectAllFiltered(true)} style={bulkStyle("#16A34A")}>✓ Select all</button>
              <button onClick={() => selectAllFiltered(false)} style={bulkStyle("#6B7280")}>○ Deselect all</button>
              <span style={{ fontSize: 11, color: "#AAA", margin: "0 4px" }}>· set type:</span>
              {COUNTERPARTY_TYPES.map(t => (
                <button key={t} onClick={() => setTypeForFiltered(t)} style={{ padding: "3px 9px", borderRadius: 5, border: `1px solid ${TYPE_COLORS[t]?.color}`, background: "#fff", color: TYPE_COLORS[t]?.color, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                  → {t}
                </button>
              ))}
            </div>

            {/* Table */}
            <div style={{ flex: 1, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead style={{ position: "sticky", top: 0, background: "#F9FAFB", zIndex: 1 }}>
                  <tr style={{ borderBottom: "1px solid #E5E7EB" }}>
                    {["", "Type", "Company / Person", "Country", "NIP", "EU VAT", "Email", "Bank", "Status"].map((h, i) => (
                      <th key={i} style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#888", letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => {
                    const idx = parsedRows.indexOf(r);
                    return (
                      <tr key={idx} style={{ borderBottom: "1px solid #F3F4F6", background: r._duplicate ? "#FFFBEB" : (r._selected ? "#fff" : "#FAFAFA") }}>
                        <td style={{ padding: "8px 10px" }}>
                          <input type="checkbox" checked={!!r._selected} onChange={e => toggleRow(idx, "_selected", e.target.checked)} />
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <select value={r.type} onChange={e => toggleRow(idx, "type", e.target.value)}
                            style={{ border: `1px solid ${TYPE_COLORS[r.type]?.color || "#E5E7EB"}`, color: TYPE_COLORS[r.type]?.color || "#111", background: TYPE_COLORS[r.type]?.bg || "#fff", borderRadius: 4, padding: "2px 6px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                            {COUNTERPARTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <div style={{ fontWeight: 600, color: "#111", maxWidth: 280, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.name}>{r.name}</div>
                          {r.address && <div style={{ fontSize: 10.5, color: "#999", maxWidth: 280, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.address}>{r.address}</div>}
                          {r.contacts[0]?.name && r.contacts[0].name !== "—" && (
                            <div style={{ fontSize: 10.5, color: "#666" }}>👤 {r.contacts[0].name}</div>
                          )}
                        </td>
                        <td style={{ padding: "8px 10px", color: "#555" }}>{r.country || <span style={{ color: "#CCC" }}>—</span>}</td>
                        <td style={{ padding: "8px 10px", color: "#555", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11 }}>{r.nip || <span style={{ color: "#CCC" }}>—</span>}</td>
                        <td style={{ padding: "8px 10px", color: "#555", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11 }}>{r.vatEuId || <span style={{ color: "#CCC" }}>—</span>}</td>
                        <td style={{ padding: "8px 10px", color: "#2563EB", fontSize: 11, maxWidth: 160, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.contacts[0]?.email}>{r.contacts[0]?.email || <span style={{ color: "#CCC" }}>—</span>}</td>
                        <td style={{ padding: "8px 10px", color: "#666", fontSize: 11 }}>
                          {r.finance.bankName && <div style={{ maxWidth: 120, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.finance.bankName}>{r.finance.bankName}</div>}
                          {r.finance.accountNumber && <div style={{ color: "#AAA", fontSize: 10, fontFamily: "ui-monospace, Menlo, monospace" }}>✓ acct</div>}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {r._duplicate ? (
                            <span style={{ background: "#FEF3C7", color: "#92400E", padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700 }} title={`Possible duplicate (match by ${r._duplicate})`}>DUP · {r._duplicate}</span>
                          ) : (
                            <span style={{ background: "#DCFCE7", color: "#16A34A", padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>NEW</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {visibleRows.length === 0 && (
                    <tr><td colSpan={9} style={{ padding: "40px", textAlign: "center", color: "#AAA", fontSize: 13 }}>No records match the current filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div style={{ padding: "14px 24px", borderTop: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 12, color: "#666" }}>
                {selectedCount === 0 ? "Select records to enable import." : `Ready to import ${selectedCount} record${selectedCount !== 1 ? "s" : ""}.`}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={onCancel} style={{ padding: "8px 20px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
                <button onClick={commit} disabled={selectedCount === 0}
                  style={{ padding: "8px 22px", borderRadius: 7, border: "none", background: selectedCount === 0 ? "#D1D5DB" : "#111", color: "#fff", fontSize: 13, fontWeight: 600, cursor: selectedCount === 0 ? "not-allowed" : "pointer" }}>
                  Import {selectedCount} record{selectedCount !== 1 ? "s" : ""}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function bulkStyle(color) {
  return { padding: "3px 9px", borderRadius: 5, border: "1px solid #E5E7EB", background: "#fff", color, fontSize: 11, cursor: "pointer", fontWeight: 600 };
}

// ─── MAIN ───────────────────────────────────────────────────────────────────
// ─── v6.3.0: DUPLICATE DETECTION & MERGE ────────────────────────────────────
// Fuzzy company-name matching (strips punctuation and legal suffixes) plus
// strict tax-ID matching. Used when saving a counterparty manually and by the
// "Find duplicates" scan. Merging keeps one record (its id survives), combines
// contact people and linked docs, and remembers the absorbed id in
// mergedFromIds so App-level snapshot refreshing re-points old documents.

const LEGAL_SUFFIX_TOKENS = new Set([
  "sp", "z", "o", "oo", "k", "j", "sa", "s", "a", "c", "srl", "r", "l", "gmbh",
  "ltd", "llc", "inc", "bv", "b", "v", "sarl", "sas", "plc", "oy", "ab", "as",
  "doo", "d", "sl", "spzoo", "co", "company", "spolka", "spółka", "zoo",
]);

function normalizeCompanyName(name) {
  const tokens = String(name || "")
    .toLowerCase()
    .replace(/[.,;:()"'’&/\\-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  // Drop trailing legal-form tokens ("sp z o o", "s r l", "gmbh"...) but never
  // drop everything — keep at least the first token.
  let end = tokens.length;
  while (end > 1 && LEGAL_SUFFIX_TOKENS.has(tokens[end - 1])) end--;
  return tokens.slice(0, end).join(" ");
}

function taxDigits(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function namesFuzzyMatch(a, b) {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // containment ("owoce polska" vs "owoce polska sp z o o" already handled by
  // suffix stripping; this also catches "freshfarm" vs "freshfarm valencia")
  if (na.length >= 5 && nb.length >= 5 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

function findCounterpartyDuplicates(candidate, list, excludeId) {
  const candTax = taxDigits(candidate.nip || candidate.vatEuId);
  const matches = [];
  (list || []).forEach(c => {
    if (excludeId != null && String(c.id) === String(excludeId)) return;
    const cTax = taxDigits(c.nip || c.vatEuId);
    if (candTax && cTax && candTax.length >= 6 && candTax === cTax) {
      matches.push({ counterparty: c, reason: "tax", detail: `same tax ID ${candidate.nip || candidate.vatEuId}` });
      return;
    }
    if (namesFuzzyMatch(candidate.name, c.name)) {
      matches.push({ counterparty: c, reason: "name", detail: `similar name "${c.name}"` });
    }
  });
  return matches;
}

// Fields offered for per-field choice in the merge dialog.
const MERGE_FIELDS = [
  { key: "name", label: "Company name" },
  { key: "type", label: "Main type" },
  { key: "country", label: "Country" },
  { key: "address", label: "Address" },
  { key: "nip", label: "NIP / Tax ID / EU VAT" },
  { key: "defaultCurrency", label: "Default currency" },
  { key: "paymentTerms", label: "Payment terms" },
  { key: "paymentTermsOther", label: "Payment terms (other)" },
  { key: "notes", label: "Notes" },
];

function mergeValueDisplay(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ") || "—";
  return String(v);
}

function MergeCounterpartiesModal({ keep, incoming, onApply, onCancel }: any) {
  // Per-field choice: "keep" | "incoming". Default: keep, unless keep's value is empty.
  // v6.10: for the tax-id row, compare the combined identity (nip OR vatEuId) so
  // a record whose only tax value sits in vatEuId still surfaces as a choice.
  const mergeFieldValue = (rec: any, key: string) => key === "nip" ? (rec?.nip || rec?.vatEuId || "") : rec?.[key];
  const [choices, setChoices] = useState(() => {
    const init: any = {};
    MERGE_FIELDS.forEach(f => {
      const kv = mergeFieldValue(keep, f.key), iv = mergeFieldValue(incoming, f.key);
      init[f.key] = (!kv && iv) ? "incoming" : "keep";
    });
    return init;
  });
  const differing = MERGE_FIELDS.filter(f => {
    const kv = mergeFieldValue(keep, f.key) ?? "", iv = mergeFieldValue(incoming, f.key) ?? "";
    return String(kv) !== String(iv) && (kv !== "" || iv !== "");
  });
  function buildMerged() {
    const merged: any = { ...keep };
    MERGE_FIELDS.forEach(f => {
      merged[f.key] = choices[f.key] === "incoming" ? (incoming[f.key] ?? "") : (keep[f.key] ?? "");
    });
    // v6.10: tax identity (nip + vatEuId) is a single paired choice. The chosen
    // side's tax id wins COMPLETELY — both nip and vatEuId are taken from it — so
    // a stale EU-VAT carried over from the kept record can never resurface. This
    // was the cause of "the VAT number in certain cases cannot be deleted".
    const taxSide = choices["nip"] === "incoming" ? incoming : keep;
    merged.nip = taxSide.nip ?? "";
    merged.vatEuId = taxSide.vatEuId ?? "";
    // Union of secondary types and services
    merged.additionalTypes = Array.from(new Set([...(keep.additionalTypes || []), ...(incoming.additionalTypes || []), ...(incoming.type && incoming.type !== merged.type ? [incoming.type] : [])])).filter(t => t !== merged.type);
    merged.services = Array.from(new Set([...(keep.services || []), ...(incoming.services || [])]));
    // Combine people (dedupe by name+email) and linked docs
    const people = [...(keep.contacts || [])];
    (incoming.contacts || []).forEach(p => {
      const dup = people.find(x => String(x.name || "").trim().toLowerCase() === String(p.name || "").trim().toLowerCase() && String(x.email || "").trim().toLowerCase() === String(p.email || "").trim().toLowerCase());
      if (!dup) people.push({ ...p, id: nextId(), isPrimary: false });
    });
    merged.contacts = people;
    merged.linkedDocs = Array.from(new Set([...(keep.linkedDocs || []), ...(incoming.linkedDocs || [])]));
    // Finance: keep's unless empty
    merged.finance = {
      bankName: keep.finance?.bankName || incoming.finance?.bankName || "",
      accountNumber: keep.finance?.accountNumber || incoming.finance?.accountNumber || "",
      swift: keep.finance?.swift || incoming.finance?.swift || "",
    };
    // Remember absorbed ids so saved PO/SO snapshots re-point to the survivor
    merged.mergedFromIds = Array.from(new Set([...(keep.mergedFromIds || []), ...(incoming.id != null ? [String(incoming.id)] : []), ...(incoming.mergedFromIds || [])]));
    return merged;
  }
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 130, padding: 20 }}>
      <div style={{ width: 720, maxHeight: "88vh", overflow: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ padding: "18px 24px", borderBottom: "1px solid #EBEBEB" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Merge duplicate counterparties</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>
            Keeping <strong style={{ color: "#111" }}>{keep.name}</strong>{incoming.id != null ? <> — absorbing <strong style={{ color: "#DC2626" }}>{incoming.name}</strong> (it will be removed; its contact people, linked documents and references move to the kept record)</> : <> — folding in the data you just entered</>}.
          </div>
        </div>
        <div style={{ padding: "16px 24px" }}>
          {differing.length === 0 && (
            <div style={{ fontSize: 13, color: "#666", padding: "10px 0" }}>All compared fields are identical — contact people and linked documents will simply be combined.</div>
          )}
          {differing.map(f => (
            <div key={f.key} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#888", letterSpacing: "0.04em", marginBottom: 5 }}>{f.label.toUpperCase()}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {(["keep", "incoming"] as const).map(side => {
                  const rec = side === "keep" ? keep : incoming;
                  const active = choices[f.key] === side;
                  return (
                    <label key={side} style={{ display: "flex", gap: 8, alignItems: "flex-start", border: `1.5px solid ${active ? "#16A34A" : "#E5E7EB"}`, background: active ? "#F0FDF4" : "#fff", borderRadius: 8, padding: "8px 10px", cursor: "pointer" }}>
                      <input type="radio" checked={active} onChange={() => setChoices(prev => ({ ...prev, [f.key]: side }))} style={{ marginTop: 2 }} />
                      <span>
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: side === "keep" ? "#16A34A" : "#D97706", display: "block" }}>{side === "keep" ? "KEPT RECORD" : (incoming.id != null ? "DUPLICATE RECORD" : "NEW ENTRY")}</span>
                        <span style={{ fontSize: 12.5, color: "#111" }}>{mergeValueDisplay(mergeFieldValue(rec, f.key))}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <div style={{ fontSize: 11, color: "#1E40AF", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 7, padding: "8px 10px", marginTop: 4 }}>
            Contact people and linked documents from both records are combined automatically. Existing POs, SOs and shipments that pointed at the removed record re-point to the kept one.
          </div>
        </div>
        <div style={{ padding: "14px 24px", borderTop: "1px solid #EBEBEB", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onCancel} style={{ padding: "8px 18px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button onClick={() => onApply(buildMerged(), incoming.id ?? null)} style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: "#16A34A", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Merge records</button>
        </div>
      </div>
    </div>
  );
}

function DuplicateReviewModal({ candidate, matches, onOpenExisting, onMergeInto, onSaveAnyway, onCancel }: any) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 125, padding: 20 }}>
      <div style={{ width: 640, maxHeight: "85vh", overflow: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ padding: "18px 24px", borderBottom: "1px solid #EBEBEB" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>⚠ Possible duplicate counterparty</div>
          <div style={{ fontSize: 12.5, color: "#666", marginTop: 4, lineHeight: 1.5 }}>
            You're saving <strong>"{candidate.name}"</strong>, but {matches.length === 1 ? "a similar record already exists" : `${matches.length} similar records already exist`}. Check below before creating a duplicate.
          </div>
        </div>
        <div style={{ padding: "14px 24px" }}>
          {matches.map((m, i) => (
            <div key={i} style={{ border: "1px solid #FDE68A", background: "#FFFBEB", borderRadius: 9, padding: "11px 13px", marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111" }}>{m.counterparty.name}</div>
                  <div style={{ fontSize: 11.5, color: "#92400E", marginTop: 2 }}>
                    Match: {m.reason === "tax" ? "same tax ID" : "similar name"} · {m.counterparty.country || "—"} · {m.counterparty.type}{m.counterparty.nip ? ` · ${m.counterparty.nip}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button onClick={() => onOpenExisting(m.counterparty)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Open existing</button>
                  <button onClick={() => onMergeInto(m.counterparty)} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#2563EB", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Merge…</button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: "14px 24px", borderTop: "1px solid #EBEBEB", display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button onClick={onCancel} style={{ padding: "8px 18px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>← Go back &amp; edit</button>
          <button onClick={onSaveAnyway} style={{ padding: "8px 18px", borderRadius: 7, border: "1px solid #FECACA", background: "#fff", color: "#DC2626", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>These are different companies — save anyway</button>
        </div>
      </div>
    </div>
  );
}

function FindDuplicatesModal({ pairs, onReview, onClose }: any) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 125, padding: 20 }}>
      <div style={{ width: 640, maxHeight: "85vh", overflow: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ padding: "18px 24px", borderBottom: "1px solid #EBEBEB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Find duplicates</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{pairs.length ? `${pairs.length} suspected duplicate pair${pairs.length !== 1 ? "s" : ""} found — review and merge.` : "No suspected duplicates found. 🎉"}</div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 22, color: "#888", cursor: "pointer" }}>×</button>
        </div>
        <div style={{ padding: "14px 24px" }}>
          {pairs.map((p, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, border: "1px solid #F3F4F6", borderRadius: 9, padding: "10px 13px", marginBottom: 8 }}>
              <div style={{ fontSize: 12.5, color: "#111", lineHeight: 1.5 }}>
                <strong>{p.a.name}</strong> <span style={{ color: "#AAA" }}>↔</span> <strong>{p.b.name}</strong>
                <div style={{ fontSize: 11, color: "#92400E" }}>{p.reason === "tax" ? "Same tax ID" : "Similar name"} · {p.a.type}/{p.b.type}</div>
              </div>
              <button onClick={() => onReview(p)} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#2563EB", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>Review &amp; merge</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Contacts({ contacts: extContacts, setContacts: extSetContacts, logisticsPoints: extLogisticsPoints, setLogisticsPoints: extSetLogisticsPoints }: any = {}) {
  // Integration mode: if parent passes state in, use it (shell owns state).
  // Standalone mode: use local state with the baked-in seed.
  const [localContacts, setLocalContacts] = useState(INIT_COUNTERPARTIES);
  const counterparties = extContacts ?? localContacts;
  const setCounterparties = extSetContacts ?? setLocalContacts;
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("All");
  const [viewMode, setViewMode] = useState("companies"); // companies | people | logistics
  const [localLogisticsPoints, setLocalLogisticsPoints] = useState(() => readLogisticsPoints());
  const logisticsPoints = extLogisticsPoints ?? localLogisticsPoints;
  const setLogisticsPoints = extSetLogisticsPoints ?? setLocalLogisticsPoints;
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null); // null | "new" | counterparty-to-edit
  const [emailTarget, setEmailTarget] = useState(null); // { counterparty, person } | null
  const [showImport, setShowImport] = useState(false);
  const [importSource, setImportSource] = useState("fakturownia"); // "fakturownia" | "csv"
  const [importResult, setImportResult] = useState(null); // toast { count } | null
  // v6.3.0 duplicate handling
  const [dupReview, setDupReview] = useState(null);   // { candidate, matches } | null
  const [mergeTarget, setMergeTarget] = useState(null); // { keep, incoming } | null
  const [dupePairs, setDupePairs] = useState(null);   // array | null (Find duplicates results)

  const selected = counterparties.find(c => c.id === selectedId) || null;

  // ── filtered companies ─────────────────────────────────────────────────
  const filteredCompanies = useMemo(() => {
    const q = search.trim().toLowerCase();
    return counterparties.filter(c => {
      const matchType = filterType === "All" || c.type === filterType || (c.additionalTypes || []).includes(filterType);
      if (!matchType) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q)
        || (c.country || "").toLowerCase().includes(q)
        || (c.nip || "").toLowerCase().includes(q)
        || (c.vatEuId || "").toLowerCase().includes(q)
        || (c.services || []).some(s => s.toLowerCase().includes(q))
        || c.contacts.some(p =>
          (p.name || "").toLowerCase().includes(q)
          || (p.email || "").toLowerCase().includes(q)
          || (p.role || "").toLowerCase().includes(q));
    });
  }, [counterparties, search, filterType]);

  // ── flattened people (for People view) ────────────────────────────────
  const filteredPeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = [];
    counterparties.forEach(c => {
      if (filterType !== "All" && c.type !== filterType && !(c.additionalTypes || []).includes(filterType)) return;
      c.contacts.forEach(p => {
        const matches = !q
          || (p.name || "").toLowerCase().includes(q)
          || (p.email || "").toLowerCase().includes(q)
          || (p.role || "").toLowerCase().includes(q)
          || c.name.toLowerCase().includes(q);
        if (matches) rows.push({ counterparty: c, person: p });
      });
    });
    return rows;
  }, [counterparties, search, filterType]);

  // ── stats ──────────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c: Record<string, number> = { All: counterparties.length };
    COUNTERPARTY_TYPES.forEach(t => {
      c[t] = counterparties.filter(x => x.type === t || (x.additionalTypes || []).includes(t)).length;
    });
    return c;
  }, [counterparties]);

  // ── mutations ──────────────────────────────────────────────────────────
  function saveCounterparty(c) {
    // v6.3.0: duplicate guard — on a NEW record, or when an existing record's
    // name/tax-ID changed, check for matches (tax-ID strict, name fuzzy) and
    // let the user open the existing record, merge, or save anyway.
    let shouldCheck = true;
    if (c.id) {
      const before = counterparties.find(p => p.id === c.id);
      if (before
        && normalizeCompanyName(before.name) === normalizeCompanyName(c.name)
        && taxDigits(before.nip || before.vatEuId) === taxDigits(c.nip || c.vatEuId)) {
        shouldCheck = false; // name and tax unchanged — don't nag on routine edits
      }
    }
    if (shouldCheck) {
      const matches = findCounterpartyDuplicates(c, counterparties, c.id);
      if (matches.length) {
        setDupReview({ candidate: c, matches });
        return;
      }
    }
    commitCounterparty(c);
  }

  function commitCounterparty(c) {
    setCounterparties(prev => {
      if (c.id) return prev.map(p => p.id === c.id ? { ...p, ...c } : p);
      const newC = { ...c, id: nextId(), contacts: [], linkedDocs: [] };
      setSelectedId(newC.id);
      return [...prev, newC];
    });
    setModal(null);
    setDupReview(null);
  }

  function applyMerge(merged, removeId) {
    setCounterparties(prev => prev
      .filter(p => removeId == null || String(p.id) !== String(removeId))
      .map(p => String(p.id) === String(merged.id) ? merged : p));
    setSelectedId(merged.id);
    setMergeTarget(null);
    setDupReview(null);
    setModal(null);
    setDupePairs(null);
  }

  function scanForDuplicates() {
    const pairs: any[] = [];
    for (let i = 0; i < counterparties.length; i++) {
      for (let j = i + 1; j < counterparties.length; j++) {
        const a = counterparties[i], b = counterparties[j];
        const aTax = taxDigits(a.nip || a.vatEuId), bTax = taxDigits(b.nip || b.vatEuId);
        if (aTax && bTax && aTax.length >= 6 && aTax === bTax) { pairs.push({ a, b, reason: "tax" }); continue; }
        if (namesFuzzyMatch(a.name, b.name)) pairs.push({ a, b, reason: "name" });
      }
    }
    setDupePairs(pairs);
  }
  function deleteCounterparty(id) {
    setCounterparties(prev => prev.filter(c => c.id !== id));
    if (selectedId === id) setSelectedId(null);
  }
  function savePerson(counterpartyId, person) {
    setCounterparties(prev => prev.map(c => {
      if (c.id !== counterpartyId) return c;
      let nextContacts;
      if (person.id) {
        nextContacts = c.contacts.map(p => p.id === person.id ? { ...p, ...person } : p);
      } else {
        const newId = nextId();
        const isFirstPrimary = c.contacts.length === 0;
        nextContacts = [...c.contacts, { ...person, id: newId, isPrimary: person.isPrimary || isFirstPrimary }];
      }
      // Ensure exactly one primary if the new/edited record is primary
      if (person.isPrimary) {
        nextContacts = nextContacts.map(p => ({
          ...p,
          isPrimary: (person.id ? p.id === person.id : p.id === Math.max(...nextContacts.map(x => x.id))),
        }));
      }
      // Or if no one is primary, make the first one primary
      if (!nextContacts.some(p => p.isPrimary) && nextContacts.length > 0) {
        nextContacts = nextContacts.map((p, i) => i === 0 ? { ...p, isPrimary: true } : p);
      }
      return { ...c, contacts: nextContacts };
    }));
  }
  function deletePerson(counterpartyId, personId) {
    setCounterparties(prev => prev.map(c => {
      if (c.id !== counterpartyId) return c;
      const nextContacts = c.contacts.filter(p => p.id !== personId);
      // If we removed the primary, promote the first remaining person
      if (!nextContacts.some(p => p.isPrimary) && nextContacts.length > 0) {
        nextContacts[0] = { ...nextContacts[0], isPrimary: true };
      }
      return { ...c, contacts: nextContacts };
    }));
  }
  function setPrimary(counterpartyId, personId) {
    setCounterparties(prev => prev.map(c => {
      if (c.id !== counterpartyId) return c;
      return { ...c, contacts: c.contacts.map(p => ({ ...p, isPrimary: p.id === personId })) };
    }));
  }

  function handleImport(toImport) {
    // Assign fresh, never-reused IDs and merge into state.
    const newRecords = toImport.map((r) => ({
      ...r,
      id: nextId(),
      linkedDocs: [],
    }));
    setCounterparties(prev => [...prev, ...newRecords]);
    setShowImport(false);
    setImportResult({ count: newRecords.length });
    setTimeout(() => setImportResult(null), 5000);
  }

  function handleExport() {
    const rows = [
      ["Type", "Also acts as", "Company", "Country", "NIP", "EU VAT", "Address", "Currency", "Payment Terms", "Services", "Person Name", "Role", "Email", "Phone", "Primary", "Notes"],
    ];
    counterparties.forEach(c => {
      const services = (c.services || []).join("; ");
      const terms = c.paymentTerms === "Other" ? (c.paymentTermsOther || "Other") : c.paymentTerms;
      const addt = (c.additionalTypes || []).join("; ");
      if (c.contacts.length === 0) {
        rows.push([c.type, addt, c.name, c.country, c.nip, c.vatEuId, c.address, c.defaultCurrency, terms, services, "", "", "", "", "", c.notes]);
      } else {
        c.contacts.forEach(p => {
          rows.push([c.type, addt, c.name, c.country, c.nip, c.vatEuId, c.address, c.defaultCurrency, terms, services, p.name, p.role, p.email, p.phone, p.isPrimary ? "yes" : "", p.notes]);
        });
      }
    });
    exportCSV(rows, "contacts.csv");
  }

  // ── render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#FAFAFA" }}>
      {modal && (
        <CounterpartyModal
          counterparty={modal === "new" ? null : modal}
          contacts={counterparties}
          onSave={saveCounterparty}
          onClose={() => setModal(null)}
        />
      )}
      {dupReview && !mergeTarget && (
        <DuplicateReviewModal
          candidate={dupReview.candidate}
          matches={dupReview.matches}
          onOpenExisting={(c) => { setDupReview(null); setModal(null); setSelectedId(c.id); }}
          onMergeInto={(c) => setMergeTarget({ keep: c, incoming: dupReview.candidate })}
          onSaveAnyway={() => commitCounterparty(dupReview.candidate)}
          onCancel={() => setDupReview(null)}
        />
      )}
      {mergeTarget && (
        <MergeCounterpartiesModal
          keep={mergeTarget.keep}
          incoming={mergeTarget.incoming}
          onApply={applyMerge}
          onCancel={() => setMergeTarget(null)}
        />
      )}
      {dupePairs && !mergeTarget && (
        <FindDuplicatesModal
          pairs={dupePairs}
          onReview={(p) => setMergeTarget({ keep: p.a, incoming: p.b })}
          onClose={() => setDupePairs(null)}
        />
      )}
      {emailTarget && <EmailModal counterparty={emailTarget.counterparty} person={emailTarget.person} onClose={() => setEmailTarget(null)} />}
      {showImport && <ImportModal existingCounterparties={counterparties} source={importSource} onCancel={() => setShowImport(false)} onImport={handleImport} />}
      {importResult && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: "#16A34A", color: "#fff", padding: "14px 20px", borderRadius: 10, boxShadow: "0 6px 24px rgba(0,0,0,0.18)", fontSize: 13, fontWeight: 600, zIndex: 200 }}>
          ✓ Imported {importResult.count} counterparty record{importResult.count !== 1 ? "s" : ""}
        </div>
      )}

      {/* Topbar */}
      <div style={{ height: 56, background: "#fff", borderBottom: "1px solid #EBEBEB", display: "flex", alignItems: "center", padding: "0 28px", gap: 14, flexShrink: 0 }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: "#111", flex: 1 }}>Contacts</span>
        {/* View toggle */}
        <div style={{ display: "flex", background: "#F3F4F6", borderRadius: 8, padding: 2 }}>
          {[
            { key: "companies", label: "Companies", icon: "🏢" },
            { key: "people", label: "People", icon: "👤" },
            { key: "logistics", label: "Logistics points", icon: "⚓" },
          ].map(o => (
            <button key={o.key} onClick={() => setViewMode(o.key)}
              style={{ padding: "5px 14px", borderRadius: 6, border: "none", background: viewMode === o.key ? "#fff" : "transparent", color: viewMode === o.key ? "#111" : "#888", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: viewMode === o.key ? "0 1px 2px rgba(0,0,0,0.06)" : "none", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 13 }}>{o.icon}</span>
              {o.label}
            </button>
          ))}
        </div>
        <button onClick={() => { setImportSource("fakturownia"); setShowImport(true); }} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #2563EB", background: "#fff", fontSize: 12, fontWeight: 600, color: "#2563EB", cursor: "pointer" }}>📥 Import from Fakturownia</button>
        <button onClick={() => { setImportSource("csv"); setShowImport(true); }} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #2563EB", background: "#fff", fontSize: 12, fontWeight: 600, color: "#2563EB", cursor: "pointer" }}>📥 Import CSV</button>
        <button onClick={handleExport} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>⬇ Export CSV</button>
        <button onClick={scanForDuplicates} title="Scan all counterparties for suspected duplicates (same tax ID or similar name)" style={{ background: "#fff", color: "#2563EB", border: "1px solid #BFDBFE", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>⧉ Find duplicates</button>
        <button onClick={() => setModal("new")} style={{ background: "#16A34A", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ New Counterparty</button>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Main area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Filter chips */}
          {viewMode !== "logistics" && (<>
          <div style={{ padding: "14px 28px 0", display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
            {[{ label: "All", count: counts.All }, ...COUNTERPARTY_TYPES.map(t => ({ label: t, count: counts[t] || 0 }))].map(({ label, count }) => (
              <button key={label} onClick={() => setFilterType(label)}
                style={{ padding: "6px 14px", borderRadius: 20, border: "1px solid", borderColor: filterType === label ? "#111" : "#E5E7EB", background: filterType === label ? "#111" : "#fff", color: filterType === label ? "#fff" : "#555", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                {label}
                <span style={{ background: filterType === label ? "rgba(255,255,255,0.2)" : "#F3F4F6", borderRadius: 10, padding: "0 6px", fontSize: 11, fontWeight: 700, color: filterType === label ? "#fff" : "#888" }}>{count}</span>
              </button>
            ))}
          </div>

          {/* Search */}
          <div style={{ padding: "12px 28px", flexShrink: 0 }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={viewMode === "companies" ? "Search companies, NIP, contacts…" : "Search people, role, email, company…"}
              style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 14px", fontSize: 13, outline: "none", background: "#fff" }} />
          </div>
          </>)}

          {/* Table */}
          <div style={{ flex: 1, overflowY: "auto", padding: "0 28px 24px" }}>
            {viewMode === "logistics" ? (
              <LogisticsPointsView points={logisticsPoints} setPoints={setLogisticsPoints} />
            ) : (<>
            <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, overflow: "hidden" }}>
              {viewMode === "companies" ? (
                <CompaniesTable
                  rows={filteredCompanies}
                  selectedId={selectedId}
                  onSelect={id => setSelectedId(sel => sel === id ? null : id)}
                  onEdit={c => setModal(c)}
                  onDelete={deleteCounterparty}
                  onEmail={(c) => {
                    const primary = c.contacts.find(p => p.isPrimary) || c.contacts[0];
                    if (primary && primary.email) setEmailTarget({ counterparty: c, person: primary });
                  }}
                />
              ) : (
                <PeopleTable
                  rows={filteredPeople}
                  onOpenCompany={id => setSelectedId(id)}
                  onEmail={(c, p) => setEmailTarget({ counterparty: c, person: p })}
                />
              )}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: "#AAA", textAlign: "right" }}>
              Showing {viewMode === "companies" ? filteredCompanies.length : filteredPeople.length}
              {viewMode === "companies" ? ` of ${counterparties.length} companies` : ` of ${counterparties.reduce((s, c) => s + c.contacts.length, 0)} people`}
            </div>
            </>)}
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <CounterpartyDetailPanel
            counterparty={selected}
            onEditCompany={c => setModal(c)}
            onDeleteCompany={deleteCounterparty}
            onClose={() => setSelectedId(null)}
            onEmail={(c, p) => setEmailTarget({ counterparty: c, person: p })}
            onSavePerson={savePerson}
            onDeletePerson={deletePerson}
            onSetPrimary={setPrimary}
          />
        )}
      </div>
    </div>
  );
}

// ─── LOGISTICS POINTS (v6.12) ───────────────────────────────────────────────
// Ports of loading / discharge, relay points and forwarder cross-dock warehouses
// — the only places that are NOT a counterparty's own premises. Managed here so
// every From / To / Destination picker (and the transport confirmation) draws
// from one source. Saving reloads the app so the location registry re-bootstraps.
function blankLogisticsPoint() {
  return { id: null, name: "", kind: LOGISTICS_POINT_KINDS[0].key, country: "", address: "", notes: "" };
}
function LogisticsPointsView({ points = [], setPoints }: any) {
  const [form, setForm] = useState<any>(() => blankLogisticsPoint());
  const sf = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));
  const kindLabel = (key: string) => (LOGISTICS_POINT_KINDS.find(k => k.key === key) || {}).label || key;

  const persistAndReload = (next: any[]) => {
    writeLogisticsPoints(next);   // synchronous, so the reload re-bootstraps with it
    setPoints(next);
    if (typeof window !== "undefined") setTimeout(() => window.location.reload(), 30);
  };
  const save = () => {
    if (!String(form.name || "").trim()) { window.alert("Enter a name for the location."); return; }
    const list = [...(points || [])];
    if (form.id == null) {
      const newPointId = nextId();
      list.push({ ...form, id: newPointId, name: form.name.trim() });
    } else {
      const i = list.findIndex((p: any) => p.id === form.id);
      if (i >= 0) list[i] = { ...form, name: form.name.trim() };
    }
    persistAndReload(list);
  };
  const edit = (p: any) => setForm({ ...p });
  const del = (p: any) => { if (window.confirm(`Delete "${p.name}"? Documents already using it keep their saved address.`)) persistAndReload((points || []).filter((x: any) => x.id !== p.id)); };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 16 }}>
      <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{form.id == null ? "New logistics point" : "Edit logistics point"}</div>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 12, lineHeight: 1.45 }}>Ports, relay points and forwarder cross-dock warehouses. Supplier / client / warehouse addresses come from their counterparty record — don't re-enter them here.</div>
        <div style={{ marginBottom: 10 }}><Lbl>Kind</Lbl><Sel value={form.kind} onChange={e => sf("kind", e.target.value)}>{LOGISTICS_POINT_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}</Sel></div>
        <div style={{ marginBottom: 10 }}><Lbl>Name</Lbl><Inp value={form.name} onChange={e => sf("name", e.target.value)} placeholder="e.g. Gdańsk DCT, Mersin cross-dock" /></div>
        <div style={{ marginBottom: 10 }}><Lbl>Country</Lbl><Inp value={form.country} onChange={e => sf("country", e.target.value)} placeholder="Poland / Türkiye / …" /></div>
        <div style={{ marginBottom: 10 }}><Lbl>Address</Lbl><Inp value={form.address} onChange={e => sf("address", e.target.value)} placeholder="full address used on the transport order" /></div>
        <div style={{ marginBottom: 14 }}><Lbl>Notes</Lbl><Inp value={form.notes} onChange={e => sf("notes", e.target.value)} placeholder="optional" /></div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={save} style={{ flex: 1, padding: "9px", border: "none", borderRadius: 8, background: "#16A34A", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{form.id == null ? "Add point" : "Save changes"}</button>
          {form.id != null && <button onClick={() => setForm(blankLogisticsPoint())} style={{ padding: "9px 14px", border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>}
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "160px 1.2fr 1fr 120px 90px", padding: "10px 16px", background: "#F9FAFB", borderBottom: "1px solid #F3F4F6", fontSize: 10, fontWeight: 700, color: "#888", letterSpacing: "0.05em" }}>
          <div>KIND</div><div>NAME</div><div>ADDRESS</div><div>COUNTRY</div><div></div>
        </div>
        {(points || []).length === 0 && <div style={{ padding: 18, fontSize: 12.5, color: "#888" }}>No logistics points yet. Add the ports, relay points and forwarder cross-dock warehouses you use — they'll appear in every From / To / Destination picker.</div>}
        {(points || []).map((p: any) => (
          <div key={p.id} style={{ display: "grid", gridTemplateColumns: "160px 1.2fr 1fr 120px 90px", padding: "11px 16px", borderBottom: "1px solid #F7F7F7", fontSize: 12, alignItems: "center" }}>
            <div style={{ color: "#555" }}>{kindLabel(p.kind)}</div>
            <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.name}>{p.name}</div>
            <div style={{ color: "#666", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.address}>{p.address || "—"}</div>
            <div style={{ color: "#666" }}>{p.country || "—"}</div>
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <button onClick={() => edit(p)} title="Edit" style={{ border: "1px solid #E5E7EB", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12, padding: "3px 7px" }}>✎</button>
              <button onClick={() => del(p)} title="Delete" style={{ border: "1px solid #FECACA", background: "#fff", color: "#DC2626", borderRadius: 6, cursor: "pointer", fontSize: 12, padding: "3px 7px" }}>✕</button>
            </div>
          </div>
        ))}
        <div style={{ padding: "10px 16px", fontSize: 10.5, color: "#AAA", lineHeight: 1.5 }}>Saving reloads the app so these points appear in every picker and on the transport confirmation.</div>
      </div>
    </div>
  );
}

// ─── COMPANIES TABLE ────────────────────────────────────────────────────────
function CompaniesTable({ rows, selectedId, onSelect, onEdit, onDelete, onEmail }: any) {  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr 110px 80px 130px", padding: "10px 20px", background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
        {["TYPE", "COMPANY", "PRIMARY CONTACT", "COUNTRY", "PEOPLE", "ACTIONS"].map((h, i) => (
          <div key={i} style={{ fontSize: 10, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em" }}>{h}</div>
        ))}
      </div>
      {rows.length === 0 && <div style={{ padding: "50px 20px", textAlign: "center", color: "#AAA", fontSize: 13 }}>No counterparties found.</div>}
      {rows.map((c, idx) => {
        const primary = c.contacts.find(p => p.isPrimary) || c.contacts[0];
        return (
          <div key={c.id}
            onClick={() => onSelect(c.id)}
            style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr 110px 80px 130px", padding: "13px 20px", borderBottom: idx < rows.length - 1 ? "1px solid #F3F4F6" : "none", alignItems: "center", background: selectedId === c.id ? "#F8FAFF" : "#fff", cursor: "pointer", borderLeft: selectedId === c.id ? "3px solid #2563EB" : "3px solid transparent", transition: "background 0.1s" }}
            onMouseEnter={e => { if (selectedId !== c.id) e.currentTarget.style.background = "#FAFAFA"; }}
            onMouseLeave={e => { if (selectedId !== c.id) e.currentTarget.style.background = "#fff"; }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
              <TypeBadge type={c.type} />
              {(c.additionalTypes || []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {c.additionalTypes.map(t => (
                    <span key={t} title={`Also acts as ${t}`}
                      style={{ background: TYPE_COLORS[t]?.bg || "#F3F4F6", color: TYPE_COLORS[t]?.color || "#6B7280", padding: "0 6px", borderRadius: 3, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em" }}>
                      +{t}
                    </span>
                  ))}
                </div>
              )}
              {showServicesRow(c) && (
                <ServicesRow services={c.services} size="small" />
              )}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{c.name}</div>
              <div style={{ fontSize: 11, color: "#AAA" }}>{c.nip || c.vatEuId || "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 13, color: "#333" }}>{primary?.name || <span style={{ color: "#CCC", fontStyle: "italic" }}>no contact</span>}</div>
              <div style={{ fontSize: 11, color: "#AAA" }}>{primary?.role || ""}{primary?.email ? ` · ${primary.email}` : ""}</div>
            </div>
            <div style={{ fontSize: 12.5, color: "#555" }}>{c.country || "—"}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#555" }}>
              {c.contacts.length}
              {c.contacts.length > 1 && <span style={{ fontSize: 10, color: "#AAA", marginLeft: 4 }}>👥</span>}
            </div>
            <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
              {primary?.email && <button onClick={() => onEmail(c)} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, cursor: "pointer" }} title="Email primary">✉</button>}
              <button onClick={() => onEdit(c)} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #2563EB", background: "#fff", color: "#2563EB", fontSize: 12, fontWeight: 600, cursor: "pointer" }} title="Edit">✎ Edit</button>
              <button onClick={() => { if (window.confirm(`Delete ${c.name} and ${c.contacts.length} contact(s)?`)) onDelete(c.id); }} style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: "#FEE2E2", color: "#DC2626", fontSize: 12, cursor: "pointer" }} title="Delete">🗑</button>
            </div>
          </div>
        );
      })}
    </>
  );
}

// ─── PEOPLE TABLE ───────────────────────────────────────────────────────────
function PeopleTable({ rows, onOpenCompany, onEmail }: any) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 110px 110px 200px 90px", padding: "10px 20px", background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
        {["NAME", "COMPANY", "TYPE", "ROLE", "EMAIL", "ACTIONS"].map((h, i) => (
          <div key={i} style={{ fontSize: 10, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em" }}>{h}</div>
        ))}
      </div>
      {rows.length === 0 && <div style={{ padding: "50px 20px", textAlign: "center", color: "#AAA", fontSize: 13 }}>No people found.</div>}
      {rows.map(({ counterparty, person }, idx) => (
        <div key={`${counterparty.id}-${person.id}`}
          onClick={() => onOpenCompany(counterparty.id)}
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr 110px 110px 200px 90px", padding: "13px 20px", borderBottom: idx < rows.length - 1 ? "1px solid #F3F4F6" : "none", alignItems: "center", background: "#fff", cursor: "pointer", transition: "background 0.1s" }}
          onMouseEnter={e => e.currentTarget.style.background = "#FAFAFA"}
          onMouseLeave={e => e.currentTarget.style.background = "#fff"}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{person.name}</div>
            {person.isPrimary && <span style={{ fontSize: 9, fontWeight: 700, color: "#16A34A", background: "#DCFCE7", padding: "1px 5px", borderRadius: 3, letterSpacing: "0.03em" }}>PRIMARY</span>}
          </div>
          <div style={{ fontSize: 13, color: "#333" }}>{counterparty.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            <TypeBadge type={counterparty.type} />
            {(counterparty.additionalTypes || []).slice(0, 2).map(t => (
              <span key={t} title={`Also acts as ${t}`}
                style={{ background: TYPE_COLORS[t]?.bg || "#F3F4F6", color: TYPE_COLORS[t]?.color || "#6B7280", padding: "0 5px", borderRadius: 3, fontSize: 9, fontWeight: 700 }}>
                +{t.slice(0, 3)}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "#666" }}>{person.role}</div>
          <div style={{ fontSize: 12, color: "#2563EB", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{person.email || "—"}</div>
          <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
            {person.email && <button onClick={() => onEmail(counterparty, person)} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, cursor: "pointer" }} title="Email">✉</button>}
            <button onClick={() => onOpenCompany(counterparty.id)} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, cursor: "pointer" }} title="Open company">→</button>
          </div>
        </div>
      ))}
    </>
  );
}
