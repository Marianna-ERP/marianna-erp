import React, { useState, useMemo } from "react";

// ─── REFERENCE DATA ─────────────────────────────────────────────────────────
const COMPANY = { name: "MARIANNA", nip: "PL525-284-27-87" };

// Location types — explained:
// OWN      — our warehouses we operate via partners (Logipark, ColdStore)
// SUPPLIER — producer / supplier site
// PORT     — port-side transit warehouse (Gdańsk, Hamburg)
// CLIENT   — client's receiving site (used for cross-dock and direct flows)
const LOCATION_TYPES: Record<string, any> = {
  OWN:      { label: "Our Warehouse",   color: "#0284C7", bg: "#E0F2FE", icon: "🏢" },
  SUPPLIER: { label: "Supplier Site",   color: "#16A34A", bg: "#DCFCE7", icon: "🚜" },
  PORT:     { label: "Port / Transit",  color: "#D97706", bg: "#FEF3C7", icon: "⚓" },
  CLIENT:   { label: "Client Site",     color: "#7C3AED", bg: "#EDE9FE", icon: "🎯" },
};

const LOCATIONS = [
  { id: 1,  type: "OWN",      name: "WH-01 Poznań (Logipark)",       country: "Poland" },
  { id: 2,  type: "OWN",      name: "WH-02 Warszawa (ColdStore)",    country: "Poland" },
  { id: 3,  type: "SUPPLIER", name: "Białski Owoc — Biała Rawska",   country: "Poland" },
  { id: 4,  type: "SUPPLIER", name: "FreshFarm ES — Valencia",       country: "Spain" },
  { id: 5,  type: "SUPPLIER", name: "AgriTrade MA — Agadir",         country: "Morocco" },
  { id: 6,   type: "PORT",    name: "Gdańsk Port — Transit",          country: "Poland" },
  { id: 7,   type: "PORT",    name: "Hamburg Port — Transit",         country: "Germany" },
  { id: 108, type: "PORT",    name: "Algeciras Port",                country: "Spain" },
  { id: 109, type: "PORT",    name: "Jeddah Islamic Port",           country: "Saudi Arabia" },
  { id: 110, type: "PORT",    name: "Venice / Marghera Port",        country: "Italy" },
  { id: 111, type: "PORT",    name: "Rotterdam Port",                country: "Netherlands" },
  { id: 112, type: "PORT",    name: "Antwerp-Bruges Port",           country: "Belgium" },
  { id: 113, type: "PORT",    name: "Koper Port",                    country: "Slovenia" },
  { id: 114, type: "PORT",    name: "Trieste Port",                  country: "Italy" },
  { id: 115, type: "PORT",    name: "Genoa Port",                    country: "Italy" },
  { id: 116, type: "PORT",    name: "Salerno Port",                  country: "Italy" },
  { id: 117, type: "PORT",    name: "Valencia Port",                 country: "Spain" },
  { id: 118, type: "PORT",    name: "Barcelona Port",                country: "Spain" },
  { id: 119, type: "PORT",    name: "Alexandria Port",               country: "Egypt" },
  { id: 120, type: "PORT",    name: "Port Said",                     country: "Egypt" },
  { id: 121, type: "PORT",    name: "Agadir / Casablanca port area", country: "Morocco" },
  // Legacy client IDs kept so older browser localStorage data still resolves
  { id: 8,  type: "CLIENT",   name: "Biedronka DC Poznań",            country: "Poland" },
  { id: 9,  type: "CLIENT",   name: "Lidl DC Chorzów",                country: "Poland" },
  // Current PO/SO client IDs
  { id: 10, type: "CLIENT",   name: "Biedronka DC Poznań",            country: "Poland" },
  { id: 11, type: "CLIENT",   name: "Lidl DC Chorzów",                country: "Poland" },
  { id: 12, type: "CLIENT",   name: "Fresco Hamburg",                 country: "Germany" },
  { id: 13, type: "CLIENT",   name: "Metro DC Warszawa",              country: "Poland" },
  { id: 14, type: "CLIENT",   name: "Euro-Papryka Tarczyn",           country: "Poland" },
];

// Lot status lifecycle — PHYSICAL states only.
// Reservations are NOT a lot status (they're computed from SO state — see lotReservations).
// Once SOs reach Shipped+, their kg leave the lot physically (decrements physicalKg).
const LOT_STATUSES: Record<string, any> = {
  Expected:      { color: "#6B7280", bg: "#F3F4F6", desc: "Ordered, not yet shipped from supplier" },
  "In Transit":  { color: "#0284C7", bg: "#E0F2FE", desc: "Moving (supplier → port / port → warehouse / etc.)" },
  Customs:       { color: "#D97706", bg: "#FEF3C7", desc: "Awaiting customs clearance" },
  "In Stock":    { color: "#16A34A", bg: "#DCFCE7", desc: "Physically in our warehouse (may have SO reservations)" },
  "Shipped Out": { color: "#2563EB", bg: "#DBEAFE", desc: "Physically dispatched to client" },
  Damaged:       { color: "#DC2626", bg: "#FEE2E2", desc: "Written off — damaged beyond use" },
};

// Flow types — 11 flows in two groups (EXP / IMP). Aligned with PurchaseOrders + Shipments.
const FLOW_TYPES: Record<string, any> = {
  // EXPORT
  EXP_EXWS:     { group: "EXP", short: "EXP · EXWs — client pickup",       emoji: "🤝", desc: "Client sends their truck to producer warehouse." },
  EXP_FOB:      { group: "EXP", short: "EXP · FOB — we truck to port",     emoji: "⚓", desc: "We truck to port, client takes over (no sea on our side)." },
  EXP_CIF:      { group: "EXP", short: "EXP · CIF — own full logistics",   emoji: "🚢", desc: "Producer → our truck → port → vessel (CIF)." },
  EXP_DDP_EU:   { group: "EXP", short: "EXP · DDP intra-EU",               emoji: "🚛", desc: "Producer → our truck → EU client (DDP)." },
  EXP_DDP_XEU:  { group: "EXP", short: "EXP · DDP extra-EU",               emoji: "🛃", desc: "Producer → our truck → export customs → client (DDP)." },
  // IMPORT
  IMP_EXWS_WH:  { group: "IMP", short: "IMP · EXWs → our WH",              emoji: "🔄", desc: "Our truck picks up at supplier → sea (if needed) → customs → our WH." },
  IMP_EXWS_DIR: { group: "IMP", short: "IMP · EXWs → direct to client",    emoji: "↗️", desc: "Our truck picks up at supplier → sea (if needed) → customs → client." },
  IMP_CIF_WH:   { group: "IMP", short: "IMP · CIF → our WH",               emoji: "📦", desc: "Supplier ships CIF → we customs + inland → our WH." },
  IMP_CIF_DIR:  { group: "IMP", short: "IMP · CIF → direct to client",     emoji: "➡️", desc: "Supplier ships CIF → we customs + inland → client." },
  IMP_DDP_WH:   { group: "IMP", short: "IMP · DDP → our WH",               emoji: "🏭", desc: "Supplier delivers DDP to our warehouse." },
  IMP_DDP_DIR:  { group: "IMP", short: "IMP · DDP → direct to client",     emoji: "🎯", desc: "Supplier delivers DDP straight to client." },
};

const FLOW_GROUPS = [
  { id: "EXP", label: "EXPORT", color: "#16A34A" },
  { id: "IMP", label: "IMPORT", color: "#2563EB" },
];

const QUALITY_GRADES = ["I", "IB", "II", "Industrial"]; // Polish convention (Klasa I/IB/II/Industrial)

const PRODUCTS = [
  "Golden Delicious", "Red Bell Pepper", "Yellow Bell Pepper", "Green Bell Pepper",
  "Tomato Round", "Tomato Cherry", "Cucumber", "Courgette",
  "Aubergine", "Carrot", "Papryka Kapia", "Papryka Żółta", "Papryka Czerwona",
];

// Movement types — physical operations only.
// SO reservations are NOT movements (they're a calculated overlay from SO state).
const MOVEMENT_TYPES: Record<string, any> = {
  IN:        { label: "Stock In",   color: "#16A34A", icon: "↓", desc: "Lot received into a location" },
  TRANSFER:  { label: "Transfer",   color: "#0284C7", icon: "⇄", desc: "Move between locations (truck/port/WH)" },
  SHIP_OUT:  { label: "Ship Out",   color: "#2563EB", icon: "→", desc: "Physical dispatch to client (decrements physicalKg)" },
  REVERSAL:  { label: "SO Reversal", color: "#7C3AED", icon: "↩", desc: "Cancels a previous SO dispatch and restores stock" },
  DAMAGE:    { label: "Damage",     color: "#DC2626", icon: "⚠", desc: "Write-off — damaged or rejected" },
  RECLASS:   { label: "Reclassify", color: "#D97706", icon: "↻", desc: "Quality grade change (e.g. Kl. I → Kl. II)" },
};

// ─── SEED DATA — lots covering all 7 flows ──────────────────────────────────
const today = new Date().toISOString().split("T")[0];

function locById(id) { return LOCATIONS.find(l => String(l.id) === String(id)); }

// ─── SO STUB ────────────────────────────────────────────────────────────────
// Mirrors the 5 seed SOs from SalesOrders.tsx so reservations show up realistically
// in this standalone module. Replaced with live SO state on integration.
// "Reserving" = SO status in RESERVING_SO_STATUSES (Confirmed and beyond, but not Cancelled, not Draft).
const RESERVING_SO_STATUSES = new Set([
  "Confirmed", "Reserved", "Loading", "Shipped", "Delivered", "Invoiced", "Closed",
]);

function getSOsStub() {
  return [
    { id: 1, number: "SO-2026-0094", status: "Delivered", clientName: "Biedronka",
      items: [{ product: "Golden Delicious", qty: 8000, sourceType: "STOCK", sourceRef: "LOT-2026-0091" }] },
    { id: 2, number: "SO-2026-0088", status: "Invoiced", clientName: "Lidl Polska",
      items: [{ product: "Golden Delicious", qty: 2400, sourceType: "STOCK", sourceRef: "LOT-2026-0091" }] },
    { id: 3, number: "SO-2026-0091", status: "Shipped", clientName: '"Euro-Papryka" Paweł Myziak',
      items: [
        { product: "Papryka Kapia",      qty: 6000, sourceType: "STOCK", sourceRef: "LOT-2026-0086" },
        { product: "Yellow Bell Pepper", qty: 3600, sourceType: "STOCK", sourceRef: "LOT-2026-0099" },
        { product: "Red Bell Pepper",    qty: 1200, sourceType: "STOCK", sourceRef: "LOT-2026-0095" },
      ] },
    { id: 4, number: "SO-2026-0102", status: "Confirmed", clientName: "Biedronka",
      items: [{ product: "Red Bell Pepper", qty: 5000, sourceType: "PO", sourceRef: "PO-2026-0121", sourceLineId: 1 }] },
    { id: 5, number: "SO-2026-0105", status: "Draft", clientName: "Metro Cash & Carry",
      items: [{ product: "Papryka Kapia", qty: 12000, sourceType: "PO", sourceRef: "PO-2026-0117", sourceLineId: 1 }] },
  ];
}
const SOS = getSOsStub();

function productsMatch(a, b) {
  return (a || "").toLowerCase().trim() === (b || "").toLowerCase().trim();
}

// Returns: { liveAvailable, totalReserved, reservations: [{ soNumber, soId, status, clientName, qty }] }
// for a given lot, considering reservations from all SOs in RESERVING_SO_STATUSES
// matching the lot's product.
//
// Note: physicalKg is the lot's TRUE physical capacity (drops on SHIP_OUT movements).
// liveAvailable = physicalKg − reservations from SOs not yet Shipped+.
// Once an SO is Shipped+, the goods have physically left → physicalKg already dropped →
// that SO's reservation should NOT also subtract. We handle this by only counting
// reservations from SOs in Confirmed/Reserved/Loading (i.e. NOT yet physically dispatched).
const PRE_DISPATCH_STATUSES = new Set(["Confirmed", "Reserved", "Loading"]);

// Normalize an SO from either the standalone stub shape ({clientName}) or the real SO module
// shape ({client: {name, ...}}). Returns flat clientName for display.
function _soClientName(o) {
  if (o.clientName) return o.clientName;
  if (o.client && o.client.name) return o.client.name;
  return "—";
}

function lotReservations(lot, sourceSOs) {
  // Default to the module-scope SOS (standalone fallback); accept live SOs from shell.
  const list = sourceSOs ?? SOS;
  const reservations = [];
  let totalReserved = 0;
  list.forEach(o => {
    // Only Confirmed/Reserved/Loading count against the current physical pool.
    // Shipped+ SOs already had their kg physically subtracted via SHIP_OUT movements.
    if (!PRE_DISPATCH_STATUSES.has(o.status)) return;
    (o.items || []).forEach(it => {
      if (it.sourceType !== "STOCK") return;
      if (it.sourceRef !== lot.number) return;
      if (!productsMatch(it.product, lot.product)) return;
      const q = parseFloat(it.qty) || 0;
      if (q <= 0) return;
      reservations.push({ soNumber: o.number, soId: o.id, status: o.status, clientName: _soClientName(o), qty: q });
      totalReserved += q;
    });
  });
  const physical = lot.physicalKg ?? lot.receivedKg ?? 0;
  return {
    physicalKg: physical,
    liveAvailable: Math.max(0, physical - totalReserved),
    totalReserved,
    reservations,
  };
}

// Returns array of SO references this lot has ever been linked to
// (across all statuses including Shipped+ historical).
function soRefsFor(lot, sourceSOs) {
  const list = sourceSOs ?? SOS;
  const refs = [];
  list.forEach(o => {
    if (o.status === "Cancelled") return;
    if (o.status === "Draft") return;
    (o.items || []).forEach(it => {
      if (it.sourceType !== "STOCK") return;
      if (it.sourceRef !== lot.number) return;
      if (!productsMatch(it.product, lot.product)) return;
      if (!refs.find(r => r.number === o.number)) {
        refs.push({ number: o.number, status: o.status, clientName: _soClientName(o) });
      }
    });
  });
  return refs;
}

export const INIT_LOTS = [
  // EXPORT — apples (CIF) — currently in port transit
  {
    id: 1, number: "LOT-2026-0091", product: "Golden Delicious", quality: "I", size: "70-80", origin: "Poland",
    flow: "EXP_CIF",
    poRef: "PO-2025-0468",
    locationId: 6, // Gdańsk Port
    expectedKg: 19500,
    receivedKg: 19422,      // what came in when received
    physicalKg: 19422,      // still physically present (in port transit, not yet dispatched)
    damagedKg: 0,
    packaging: "13 kg wooden box",
    status: "In Transit",
    arrivalDate: "2026-05-20", productionDate: "2026-05-18",
    costs: [
      { type: "purchase", label: "Purchase (PINV)",         source: "PINV-2026-0021", amount: 54381.60, currency: "PLN", pln: 54381.60 },
      { type: "freight",  label: "Inland freight (LINV)",   source: "LINV-2026-0008", amount: 2400.00,  currency: "PLN", pln: 2400.00 },
      { type: "customs",  label: "Export customs + phyto",  source: "CINV-2026-0003", amount: 187.00,   currency: "PLN", pln: 187.00 },
    ],
    movements: [
      { id: 1, date: "2026-05-19", type: "IN",       qtyKg: 19422, fromId: 3, toId: 3, note: "Loaded at producer, expected 19,500 kg" },
      { id: 2, date: "2026-05-20", type: "TRANSFER", qtyKg: 19422, fromId: 3, toId: 6, note: "Trucked to Gdańsk port" },
    ],
    notes: "EXW producer Białski Owoc. Sold CIF to overseas client. Vessel ETA destination: 2026-06-12.",
  },

  // Apples in our WH — has heavy SO reservations from seed SOs 1 & 2 (Biedronka + Lidl)
  // SO-2026-0094 (Delivered, 8000 kg) and SO-2026-0088 (Invoiced, 2400 kg) — both Shipped+, so they DON'T count vs liveAvailable
  // (their physical departure should have already been recorded via SHIP_OUT movements — see below)
  {
    id: 2, number: "LOT-2026-0091B", product: "Golden Delicious", quality: "I", size: "70-80", origin: "Poland",
    flow: "IMP_DDP_WH",
    poRef: "PO-2025-0470",
    locationId: 1, // WH-01 Poznań
    expectedKg: 22800,
    receivedKg: 22800,
    physicalKg: 12400,  // 22800 received − 8000 (SO-94) − 2400 (SO-88) shipped out = 12400 left physically
    damagedKg: 0,
    packaging: "13 kg wooden box",
    status: "In Stock",
    arrivalDate: "2026-04-28", productionDate: "2026-04-25",
    costs: [
      { type: "purchase", label: "Purchase (PINV)",         source: "PINV-2026-0019", amount: 11400.00, currency: "PLN", pln: 11400.00 },
      { type: "storage",  label: "Storage May 1-26 (alloc)", source: "WINV-2026-0002", amount: 386.00,   currency: "PLN", pln: 386.00 },
    ],
    movements: [
      { id: 1, date: "2026-04-28", type: "IN",       qtyKg: 22800, fromId: 3, toId: 1, note: "DDP delivery from Białski" },
      { id: 2, date: "2026-01-25", type: "SHIP_OUT", qtyKg: 8000,  fromId: 1, toId: 8, note: "Shipped for SO-2026-0094 (Biedronka DC Poznań)" },
      { id: 3, date: "2026-01-20", type: "SHIP_OUT", qtyKg: 2400,  fromId: 1, toId: 9, note: "Shipped for SO-2026-0088 (Lidl DC Chorzów)" },
    ],
    notes: "Apple lot for retailer chains. 12,400 kg still physically present.",
  },

  // Import carrots — In Stock, partially damaged
  {
    id: 3, number: "LOT-2026-0088", product: "Carrot", quality: "I", size: "60-100", origin: "Morocco",
    flow: "IMP_CIF_WH",
    poRef: "PO-2026-0118",
    locationId: 1,
    expectedKg: 24000,
    receivedKg: 23720,
    physicalKg: 23420,  // received 23720 − 300 damaged write-off = 23420 physically
    damagedKg: 300,
    packaging: "10 kg mesh bag",
    status: "In Stock",
    arrivalDate: "2026-05-15", productionDate: "2026-05-05",
    costs: [
      { type: "purchase", label: "Purchase (PINV)",                source: "PINV-2026-0024", amount: 4350.00,  currency: "EUR", pln: 18505.00 },
      { type: "freight",  label: "Port→WH freight (LINV)",         source: "LINV-2026-0010", amount: 1800.00,  currency: "PLN", pln: 1800.00 },
      { type: "customs",  label: "Import duties + VAT + phyto",    source: "CINV-2026-0004", amount: 2310.00,  currency: "PLN", pln: 2310.00 },
      { type: "storage",  label: "Storage May 1-15 (allocated)",   source: "WINV-2026-0002", amount: 142.00,   currency: "PLN", pln: 142.00 },
    ],
    movements: [
      { id: 1, date: "2026-05-14", type: "IN",       qtyKg: 23720, fromId: 5, toId: 6, note: "Arrived Gdańsk port from Morocco" },
      { id: 2, date: "2026-05-15", type: "TRANSFER", qtyKg: 23720, fromId: 6, toId: 1, note: "Customs cleared, trucked to WH-01" },
      { id: 3, date: "2026-05-22", type: "DAMAGE",   qtyKg: 300,   fromId: 1, toId: 1, note: "Quality check — 300 kg molded, write-off" },
    ],
    notes: "Expected 24,000 kg, received 23,720 (−280 kg, 1.2% variance). Will split across 3–4 retailers.",
  },

  // Import tomato — Shipped Out (whole lot delivered direct to Biedronka)
  {
    id: 4, number: "LOT-2026-0089", product: "Tomato Round", quality: "I", size: "M", origin: "Spain",
    flow: "IMP_CIF_DIR",
    poRef: "PO-2026-0120",
    locationId: 8, // Biedronka DC Poznań — direct flow, never our WH
    expectedKg: 18000,
    receivedKg: 17940,
    physicalKg: 0,  // entire lot dispatched direct
    damagedKg: 0,
    packaging: "5 kg carton",
    status: "Shipped Out",
    arrivalDate: "2026-05-23", productionDate: "2026-05-10",
    costs: [
      { type: "purchase", label: "Purchase (PINV)",                source: "PINV-2026-0025", amount: 8400.00,  currency: "EUR", pln: 35820.00 },
      { type: "freight",  label: "Port→client freight (LINV)",     source: "LINV-2026-0012", amount: 1450.00,  currency: "PLN", pln: 1450.00 },
      { type: "customs",  label: "Import customs (CINV)",          source: "CINV-2026-0005", amount: 1620.00,  currency: "PLN", pln: 1620.00 },
    ],
    movements: [
      { id: 1, date: "2026-05-21", type: "IN",       qtyKg: 17940, fromId: 4, toId: 6, note: "Arrived Gdańsk from Spain" },
      { id: 2, date: "2026-05-22", type: "TRANSFER", qtyKg: 17940, fromId: 6, toId: 8, note: "Customs cleared, direct to Biedronka" },
      { id: 3, date: "2026-05-23", type: "SHIP_OUT", qtyKg: 17940, fromId: 8, toId: 8, note: "POD signed at Biedronka DC Poznań" },
    ],
    notes: "Direct flow — never entered our WH. Full container sold to single client.",
  },

  // Papryka Kapia — heavy SO reservations from active SOs
  // SO-2026-0091 (Shipped, 6000 kg) — already departed, doesn't count vs liveAvailable
  // Result: 8500 received − 6000 SHIP_OUT = 2500 physically present, no pre-dispatch reservations → liveAvailable = 2500
  {
    id: 5, number: "LOT-2026-0086", product: "Papryka Kapia", quality: "I", size: "M", origin: "Jordania",
    flow: "IMP_EXWS_WH",
    poRef: "PO-2026-0117",
    locationId: 1, // moved into our WH after customs
    expectedKg: 8500,
    receivedKg: 8500,
    physicalKg: 2500,
    damagedKg: 0,
    packaging: "5 kg carton",
    status: "In Stock",
    arrivalDate: "2026-01-22", productionDate: "2026-01-18",
    costs: [
      { type: "purchase", label: "Purchase EXW (PINV)",            source: "PINV-2026-0008", amount: 8800.00,  currency: "USD", pln: 34155.00 },
      { type: "freight",  label: "Producer→port truck (LINV)",    source: "LINV-2026-0003", amount: 2100.00,  currency: "PLN", pln: 2100.00 },
      { type: "customs",  label: "Import duties + phyto",          source: "CINV-2026-0002", amount: 985.00,   currency: "PLN", pln: 985.00 },
    ],
    movements: [
      { id: 1, date: "2026-01-19", type: "IN",       qtyKg: 8500, fromId: 5, toId: 5, note: "Loaded at producer Agadir (EXW)" },
      { id: 2, date: "2026-01-20", type: "TRANSFER", qtyKg: 8500, fromId: 5, toId: 6, note: "Arrived Gdańsk" },
      { id: 3, date: "2026-01-22", type: "TRANSFER", qtyKg: 8500, fromId: 6, toId: 1, note: "Customs cleared, trucked to WH-01" },
      { id: 4, date: "2026-01-29", type: "SHIP_OUT", qtyKg: 6000, fromId: 1, toId: 14, note: "Shipped for SO-2026-0091 (Euro-Papryka)" },
    ],
    notes: "Origin Jordania. 2,500 kg still physically present in WH-01.",
  },

  // Red Bell Pepper — small remainder, post-shipout to Euro-Papryka
  {
    id: 6, number: "LOT-2026-0095", product: "Red Bell Pepper", quality: "I", size: "L", origin: "Jordania",
    flow: "IMP_DDP_WH",
    poRef: "PO-2026-0115",
    locationId: 2, // WH-02 Warszawa
    expectedKg: 2300,
    receivedKg: 2300,
    physicalKg: 1100,  // 2300 − 1200 (SO-91) shipped = 1100
    damagedKg: 0,
    packaging: "5 kg carton",
    status: "In Stock",
    arrivalDate: "2026-01-26", productionDate: "2026-01-22",
    costs: [
      { type: "purchase", label: "Purchase DDP (PINV)",            source: "PINV-2026-0007", amount: 9250.00,  currency: "EUR", pln: 39341.18 },
    ],
    movements: [
      { id: 1, date: "2026-01-26", type: "IN",       qtyKg: 2300, fromId: 4, toId: 2, note: "DDP delivery from FreshFarm ES" },
      { id: 2, date: "2026-01-29", type: "SHIP_OUT", qtyKg: 1200, fromId: 2, toId: 14, note: "Shipped for SO-2026-0091 (Euro-Papryka)" },
    ],
    notes: "1,100 kg remaining for further allocation.",
  },

  // Yellow Bell Pepper — small remainder after Euro-Papryka
  {
    id: 7, number: "LOT-2026-0099", product: "Yellow Bell Pepper", quality: "I", size: "L", origin: "Jordania",
    flow: "IMP_DDP_WH",
    poRef: "PO-2026-0116",
    locationId: 2,
    expectedKg: 4200,
    receivedKg: 4200,
    physicalKg: 600,  // 4200 − 3600 (SO-91) = 600
    damagedKg: 0,
    packaging: "5 kg carton",
    status: "In Stock",
    arrivalDate: "2026-01-26", productionDate: "2026-01-22",
    costs: [
      { type: "purchase", label: "Purchase DDP (PINV)",            source: "PINV-2026-0006", amount: 12000.00, currency: "EUR", pln: 51037.20 },
    ],
    movements: [
      { id: 1, date: "2026-01-26", type: "IN",       qtyKg: 4200, fromId: 4, toId: 2, note: "DDP delivery from FreshFarm ES" },
      { id: 2, date: "2026-01-29", type: "SHIP_OUT", qtyKg: 3600, fromId: 2, toId: 14, note: "Shipped for SO-2026-0091 (Euro-Papryka)" },
    ],
    notes: "600 kg remaining.",
  },

  // Expected lot (just-confirmed PO, not yet shipped)
  {
    id: 8, number: "LOT-2026-0100", product: "Red Bell Pepper", quality: "I", size: "L", origin: "Spain",
    flow: "IMP_DDP_WH",
    poRef: "PO-2026-0121",
    locationId: 4,
    expectedKg: 8000,
    receivedKg: 0,
    physicalKg: 0,
    damagedKg: 0,
    packaging: "5 kg carton",
    status: "Expected",
    arrivalDate: "2026-06-05", productionDate: null,
    costs: [
      { type: "purchase", label: "Purchase DDP (PINV — expected)", source: "PO-2026-0121", amount: 14800.00, currency: "EUR", pln: 62945.88 },
    ],
    movements: [],
    notes: "PO confirmed, supplier loading week of 2026-06-02. Expected DDP arrival 2026-06-05.",
  },
];

// ─── SHARED UI ATOMS ────────────────────────────────────────────────────────
function Inp({ value, onChange = () => {}, type = "text", placeholder = "", style = {} }: any) {
  const base = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: "#fff" };
  return <input value={value || ""} onChange={onChange} type={type || "text"} placeholder={placeholder} style={{ ...base, ...style }} />;
}
function Sel({ value, onChange = () => {}, children, style = {} }: any) {
  const base = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: "#fff" };
  return <select value={value || ""} onChange={onChange} style={{ ...base, ...style }}>{children}</select>;
}
function Lbl({ children }: any) {
  return <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>{children}</label>;
}
function Card({ children, style = {} }: any) {
  return <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "18px 20px", ...style }}>{children}</div>;
}
function SectionTitle({ children }: any) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em", marginBottom: 14 }}>{children}</div>;
}
function StatusBadge({ status }: any) {
  const s = LOT_STATUSES[status] || { bg: "#F3F4F6", color: "#6B7280" };
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
  return <span style={{ background: p.bg, color: p.color, padding: "1px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", fontFamily: "ui-monospace, Menlo, monospace", whiteSpace: "nowrap" }}>Kl. {quality}</span>;
}
function LocationPill({ locationId }: any) {
  const loc = locById(locationId);
  if (!loc) return <span style={{ color: "#CCC" }}>—</span>;
  const t = LOCATION_TYPES[loc.type];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#444" }}>
      <span style={{ fontSize: 11 }}>{t.icon}</span>
      <span style={{ fontWeight: 500 }}>{loc.name}</span>
    </span>
  );
}
function FlowBadge({ flow, compact = false }: any) {
  const f = FLOW_TYPES[flow];
  if (!f) return null;
  if (compact) {
    return <span title={f.desc} style={{ background: "#F9FAFB", border: "1px solid #EBEBEB", padding: "1px 7px", borderRadius: 4, fontSize: 10.5, color: "#555", whiteSpace: "nowrap" }}>{f.emoji} {f.short}</span>;
  }
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px", background: "#F9FAFB", border: "1px solid #EBEBEB", borderRadius: 8 }}>
      <span style={{ fontSize: 14 }}>{f.emoji}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#111" }}>{f.short}</div>
        <div style={{ fontSize: 10.5, color: "#888" }}>{f.desc}</div>
      </div>
    </div>
  );
}
function VarianceBadge({ expected, actual }: any) {
  if (!expected || !actual) return null;
  const delta = actual - expected;
  if (delta === 0) return null;
  const pct = ((delta / expected) * 100).toFixed(1);
  const isShort = delta < 0;
  return (
    <span title={`Expected ${expected.toLocaleString()} kg, received ${actual.toLocaleString()} kg`}
      style={{ background: isShort ? "#FEF3C7" : "#DBEAFE", color: isShort ? "#92400E" : "#1E40AF", padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: "0.02em" }}>
      {delta > 0 ? "+" : ""}{pct}%
    </span>
  );
}

function fmtNum(n) {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return Number(n).toLocaleString("pl-PL");
}
function fmtMoney(n, cur = "PLN") {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return `${Number(n).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}
function totalCost(lot) {
  return (lot.costs || []).reduce((s, c) => s + (c.pln || 0), 0);
}
function costPerKg(lot) {
  const total = totalCost(lot);
  // Denominator is the lot's original capacity (receivedKg), not what's left now.
  // We allocate cost across what came in — what's still here is just a portion of that.
  const denom = lot.receivedKg || lot.expectedKg || 0;
  return denom > 0 ? total / denom : 0;
}
function valueInStock(lot) {
  // Value still on hand = what's physically here × per-kg cost basis.
  // Note: physicalKg already accounts for SHIP_OUT movements (goods gone).
  return (lot.physicalKg || 0) * costPerKg(lot);
}

// ─── MOVEMENT MODAL ─────────────────────────────────────────────────────────
function MovementModal({ lot, liveSOs = [], onCancel, onConfirm }: any) {
  // Default to TRANSFER for in-stock lots; IN for Expected lots
  const [type, setType] = useState(lot.status === "Expected" ? "IN" : "TRANSFER");
  const [qty, setQty] = useState("");
  const [fromId, setFromId] = useState(lot.locationId);
  const [toId, setToId] = useState(lot.locationId);
  const [note, setNote] = useState("");
  // Max-by-type: physical operations bounded by physicalKg. Generic manual SHIP_OUT
  // is bounded by live available stock so it cannot consume kg reserved for an SO.
  const reservationState = lotReservations(lot, liveSOs);
  const liveAvailableKg = reservationState.liveAvailable;
  const maxByType = {
    IN:       Infinity,                  // No upper bound on receiving more
    TRANSFER: lot.physicalKg || 0,       // Can only move what's physically here
    SHIP_OUT: liveAvailableKg || 0,      // Manual ship-out cannot consume reserved kg
    DAMAGE:   lot.physicalKg || 0,       // Can only write off what's here
    RECLASS:  lot.physicalKg || 0,       // Reclass what's here
  };
  const max = maxByType[type];
  const qtyNum = parseFloat(qty) || 0;
  const isInvalid = qtyNum <= 0 || qtyNum > max;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#fff", borderRadius: 14, width: 520, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #EBEBEB" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Record movement</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{lot.number} · {lot.product} · received {(lot.receivedKg || 0).toLocaleString()} kg, physical {(lot.physicalKg || 0).toLocaleString()} kg</div>
        </div>
        <div style={{ padding: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <Lbl>Movement type</Lbl>
              <Sel value={type} onChange={e => setType(e.target.value)}>
                {Object.entries(MOVEMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </Sel>
            </div>
            <div>
              <Lbl>Quantity (kg) <span style={{ color: "#AAA", fontWeight: 400 }}>· max {max === Infinity ? "∞" : max.toLocaleString()}</span></Lbl>
              <Inp value={qty} onChange={e => setQty(e.target.value)} type="number" placeholder="0" />
            </div>
          </div>
          {(type === "TRANSFER" || type === "IN" || type === "SHIP_OUT") && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <Lbl>From</Lbl>
                <Sel value={fromId} onChange={e => setFromId(parseInt(e.target.value))}>
                  {LOCATIONS.map(l => <option key={l.id} value={l.id}>{LOCATION_TYPES[l.type].icon} {l.name}</option>)}
                </Sel>
              </div>
              <div>
                <Lbl>To</Lbl>
                <Sel value={toId} onChange={e => setToId(parseInt(e.target.value))}>
                  {LOCATIONS.map(l => <option key={l.id} value={l.id}>{LOCATION_TYPES[l.type].icon} {l.name}</option>)}
                </Sel>
              </div>
            </div>
          )}
          <div style={{ marginBottom: 18 }}>
            <Lbl>Note</Lbl>
            <Inp value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Reserved for SO-2026-0094 (Biedronka)" />
          </div>
          {isInvalid && qty && (
            <div style={{ padding: "8px 12px", background: "#FEE2E2", color: "#9A1B1B", fontSize: 12, borderRadius: 6, marginBottom: 12 }}>
              {qtyNum > max ? `Quantity exceeds max (${max.toLocaleString()} kg)` : "Quantity must be greater than zero"}
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onCancel} style={{ flex: 1, padding: "10px", border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button onClick={() => onConfirm({ type, qtyKg: qtyNum, fromId, toId, note })} disabled={isInvalid}
              style={{ flex: 1, padding: "10px", border: "none", borderRadius: 8, background: isInvalid ? "#D1D5DB" : "#111", color: "#fff", fontSize: 13, fontWeight: 600, cursor: isInvalid ? "not-allowed" : "pointer" }}>
              Record movement
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LOT DETAIL VIEW ────────────────────────────────────────────────────────
function LotDetail({ lot, onBack, onMove, onDelete, liveSOs }: any) {
  const res = lotReservations(lot, liveSOs);
  const cpk = costPerKg(lot);
  const total = totalCost(lot);
  const value = valueInStock(lot);
  const variance = (lot.receivedKg || 0) - (lot.expectedKg || 0);
  const shippedOutKg = Math.max(0, (lot.receivedKg || 0) - (lot.physicalKg || 0) - (lot.damagedKg || 0));

  // Qty stripe segments — show the lifecycle of the receivedKg
  const segments = [
    { key: "Available",   kg: res.liveAvailable,   color: "#16A34A" },
    { key: "Reserved",    kg: res.totalReserved,   color: "#7C3AED" },
    { key: "Shipped out", kg: shippedOutKg,        color: "#2563EB" },
    { key: "Damaged",     kg: lot.damagedKg || 0,  color: "#DC2626" },
  ].filter(s => s.kg > 0);
  const totalKg = segments.reduce((s, x) => s + x.kg, 0);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#2563EB", fontWeight: 500 }}>← Inventory</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <button onClick={onMove} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #111", background: "#111", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>+ Record movement</button>
          <button onClick={onDelete} style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid #FECACA", color: "#DC2626", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Delete</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <StatusBadge status={lot.status} />
                <QualityBadge quality={lot.quality} />
                <VarianceBadge expected={lot.expectedKg} actual={lot.receivedKg} />
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#111", fontFamily: "ui-monospace, Menlo, monospace", marginBottom: 4 }}>{lot.number}</div>
              <div style={{ fontSize: 14, color: "#444" }}>{lot.product} · {lot.size || "—"} · {lot.origin || "—"} · {lot.packaging}</div>
              <div style={{ marginTop: 10 }}><FlowBadge flow={lot.flow} /></div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#888" }}>Value of physical stock</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#111" }}>{fmtMoney(value)}</div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{fmtMoney(cpk)}/kg · received {fmtNum(lot.receivedKg)} kg</div>
            </div>
          </div>

          {/* Qty breakdown bar — five numbers showing the lifecycle */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>QUANTITY BREAKDOWN</SectionTitle>
            <div style={{ marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
              <div><div style={{ fontSize: 10, color: "#888" }}>EXPECTED</div><div style={{ fontSize: 16, fontWeight: 600, color: "#555" }}>{fmtNum(lot.expectedKg)} kg</div></div>
              <div><div style={{ fontSize: 10, color: "#888" }}>RECEIVED</div><div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>{fmtNum(lot.receivedKg)} kg</div></div>
              <div title="Live: physicalKg − reservations from pre-dispatch SOs"><div style={{ fontSize: 10, color: "#16A34A" }}>AVAILABLE (live)</div><div style={{ fontSize: 16, fontWeight: 700, color: "#16A34A" }}>{fmtNum(res.liveAvailable)} kg</div></div>
              <div title="From Confirmed/Reserved/Loading SOs"><div style={{ fontSize: 10, color: "#7C3AED" }}>RESERVED (live)</div><div style={{ fontSize: 16, fontWeight: 700, color: "#7C3AED" }}>{fmtNum(res.totalReserved)} kg</div></div>
              <div><div style={{ fontSize: 10, color: "#DC2626" }}>DAMAGED</div><div style={{ fontSize: 16, fontWeight: 700, color: "#DC2626" }}>{fmtNum(lot.damagedKg)} kg</div></div>
            </div>
            {totalKg > 0 && (
              <>
                <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", border: "1px solid #F3F4F6" }}>
                  {segments.map((s, i) => (
                    <div key={i} title={`${s.key}: ${s.kg.toLocaleString()} kg`} style={{ background: s.color, width: `${(s.kg / totalKg) * 100}%` }} />
                  ))}
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11, color: "#888", flexWrap: "wrap" }}>
                  {segments.map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 8, height: 8, background: s.color, borderRadius: 2 }} />
                      <span>{s.key}: {fmtNum(s.kg)} kg ({((s.kg / totalKg) * 100).toFixed(1)}%)</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {variance !== 0 && lot.receivedKg > 0 && (
              <div style={{ marginTop: 14, padding: "10px 12px", background: variance < 0 ? "#FEF3C7" : "#DBEAFE", border: `1px solid ${variance < 0 ? "#FDE68A" : "#BFDBFE"}`, borderRadius: 8, fontSize: 12, color: variance < 0 ? "#92400E" : "#1E40AF" }}>
                <strong>{variance > 0 ? "Surplus" : "Shortfall"}:</strong> {Math.abs(variance).toLocaleString()} kg ({((variance / lot.expectedKg) * 100).toFixed(2)}%) vs PO {lot.poRef}.
                {variance < 0 ? " Common causes: moisture loss in transit, weight check at port, damage. Consider raising a damage report if responsibility lies with carrier or supplier." : " Higher than ordered — confirm with supplier."}
              </div>
            )}
          </Card>

          {/* Reservations card — only shown when there are live reservations */}
          {res.reservations.length > 0 && (
            <Card style={{ marginBottom: 16, border: "1px solid #DDD6FE", background: "#FAF8FF" }}>
              <SectionTitle>RESERVATIONS · {res.reservations.length} SO{res.reservations.length !== 1 ? "s" : ""}</SectionTitle>
              <div style={{ display: "grid", gap: 8 }}>
                {res.reservations.map((r, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "160px 1fr 100px 100px", gap: 10, alignItems: "center", padding: "8px 10px", background: "#fff", border: "1px solid #EDE9FE", borderRadius: 7 }}>
                    <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, fontWeight: 700, color: "#7C3AED" }}>{r.soNumber}</div>
                    <div style={{ fontSize: 12, color: "#555" }}>{r.clientName}</div>
                    <div><StatusBadge status={r.status} /></div>
                    <div style={{ textAlign: "right", fontSize: 12.5, fontWeight: 600, color: "#7C3AED" }}>{fmtNum(r.qty)} kg</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 10.5, color: "#888", fontStyle: "italic" }}>
                Only SOs in Confirmed/Reserved/Loading status count against live availability. Shipped+ SOs have already physically left and are reflected in SHIP_OUT movements.
              </div>
            </Card>
          )}

          {/* Two-column body */}
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
            <div>
              {/* Movement history */}
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle>MOVEMENT HISTORY ({lot.movements.length})</SectionTitle>
                {lot.movements.length === 0 && (
                  <div style={{ fontSize: 12, color: "#AAA", padding: "12px 0" }}>No movements yet — this lot is still in "Expected" status.</div>
                )}
                {lot.movements.length > 0 && (
                  <div style={{ position: "relative" }}>
                    <div style={{ position: "absolute", left: 11, top: 14, bottom: 14, width: 1, background: "#E5E7EB" }} />
                    {lot.movements.map((m, i) => {
                      const mt = MOVEMENT_TYPES[m.type] || { color: "#888", label: m.type, icon: "·" };
                      const fromLoc = locById(m.fromId);
                      const toLoc = locById(m.toId);
                      const isMove = m.fromId !== m.toId;
                      return (
                        <div key={i} style={{ display: "flex", gap: 14, paddingBottom: 14, position: "relative" }}>
                          <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#fff", border: `2px solid ${mt.color}`, color: mt.color, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, zIndex: 1 }}>{mt.icon}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                              <div style={{ fontSize: 12.5 }}>
                                <span style={{ fontWeight: 600, color: mt.color }}>{mt.label}</span>
                                <span style={{ color: "#444", marginLeft: 6 }}>· {fmtNum(m.qtyKg)} kg</span>
                                {isMove && <span style={{ color: "#666", marginLeft: 6 }}>· {fromLoc?.name} → {toLoc?.name}</span>}
                              </div>
                              <div style={{ fontSize: 11, color: "#AAA", whiteSpace: "nowrap" }}>{m.date}</div>
                            </div>
                            {m.note && <div style={{ fontSize: 11.5, color: "#888", marginTop: 2 }}>{m.note}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* Notes */}
              {lot.notes && (
                <Card>
                  <SectionTitle>NOTES</SectionTitle>
                  <div style={{ fontSize: 12.5, color: "#444", lineHeight: 1.5 }}>{lot.notes}</div>
                </Card>
              )}
            </div>

            {/* Right column */}
            <div>
              {/* Linked docs */}
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle>LINKED DOCUMENTS</SectionTitle>
                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#888", marginBottom: 3 }}>PURCHASE ORDER</div>
                    {lot.poRef ? (
                      <div style={{ padding: "6px 10px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 6, fontSize: 12.5, color: "#1D4ED8", fontWeight: 600, fontFamily: "ui-monospace, Menlo, monospace", display: "inline-block" }}>{lot.poRef}</div>
                    ) : <span style={{ fontSize: 12, color: "#AAA" }}>—</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#888", marginBottom: 3 }}>SALES ORDERS ({soRefsFor(lot, liveSOs).length})</div>
                    {soRefsFor(lot, liveSOs).length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {soRefsFor(lot, liveSOs).map(s => (
                          <div key={s.number} title={`${s.clientName} · ${s.status}`} style={{ padding: "4px 8px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 5, fontSize: 11, color: "#15803D", fontWeight: 600, fontFamily: "ui-monospace, Menlo, monospace" }}>{s.number}</div>
                        ))}
                      </div>
                    ) : <span style={{ fontSize: 12, color: "#AAA" }}>Not yet linked</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#888", marginBottom: 3 }}>CURRENT LOCATION</div>
                    <LocationPill locationId={lot.locationId} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#888", marginBottom: 3 }}>DATES</div>
                    <div style={{ fontSize: 12, color: "#444" }}>
                      Production: <span style={{ fontWeight: 500 }}>{lot.productionDate || "—"}</span><br />
                      Arrival: <span style={{ fontWeight: 500 }}>{lot.arrivalDate || "—"}</span>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Cost breakdown */}
              <Card>
                <SectionTitle>COST BREAKDOWN</SectionTitle>
                {(lot.costs || []).map((c, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 0", borderBottom: i < lot.costs.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                    <div>
                      <div style={{ fontSize: 12, color: "#444" }}>{c.label}</div>
                      <div style={{ fontSize: 10.5, color: "#2563EB", fontFamily: "ui-monospace, Menlo, monospace", marginTop: 1 }}>{c.source}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{fmtMoney(c.pln)}</div>
                      {c.currency && c.currency !== "PLN" && (
                        <div style={{ fontSize: 10, color: "#888", marginTop: 1 }}>({fmtMoney(c.amount, c.currency)})</div>
                      )}
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: 8, padding: "10px 0 0", borderTop: "2px solid #E5E7EB", display: "flex", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>Total cost</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>{fmtMoney(total)}</div>
                </div>
                <div style={{ marginTop: 8, padding: "10px 12px", background: "#F9FAFB", borderRadius: 8, display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11.5, color: "#666" }}>Cost per kg (PLN)</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#111", fontFamily: "ui-monospace, Menlo, monospace" }}>{fmtMoney(cpk)}/kg</span>
                </div>
                <div style={{ marginTop: 10, fontSize: 10.5, color: "#AAA", fontStyle: "italic", lineHeight: 1.5 }}>
                  Costs accumulate as invoices arrive. Storage allocation (WINV) recalculates monthly.
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN — LIST VIEW + ROUTER ──────────────────────────────────────────────
export default function Inventory({ lots: extLots, setLots: extSetLots, allOrders: extOrders }: any = {}) {
  // Integration mode: parent passes lots state and live SOs. Standalone: local seed + module-scope SOS.
  const [localLots, setLocalLots] = useState(INIT_LOTS);
  const lots = extLots ?? localLots;
  const setLots = extSetLots ?? setLocalLots;
  // Live SOs from shell (replaces the standalone-only module-scope SOS).
  // If shell doesn't pass any (standalone), helpers fall through to local SOS via their default param.
  const liveSOs = extOrders;
  const [view, setView] = useState("list");
  const [selectedId, setSelectedId] = useState(null);
  const selected = useMemo(() => lots.find(l => l.id === selectedId) ?? null, [lots, selectedId]);
  const [showMovement, setShowMovement] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("inPossession"); // inPossession | all | <specific>
  const [filterLocationType, setFilterLocationType] = useState("All");
  const [filterProduct, setFilterProduct] = useState("All");
  const [filterQuality, setFilterQuality] = useState("All");

  // ── KPIs ─────────────────────────────────────────────────────────────
  // "In stock" = physically in our warehouse (Reserved is no longer a status — it's an overlay)
  const inStock = lots.filter(l => l.status === "In Stock");
  const totalKgInStock = inStock.reduce((s, l) => s + (l.physicalKg || 0), 0);
  const totalValueInStock = inStock.reduce((s, l) => s + valueInStock(l), 0);
  const lotsAtPort = lots.filter(l => locById(l.locationId)?.type === "PORT" && l.status !== "Shipped Out").length;
  const lotsWithVariance = lots.filter(l => l.expectedKg > 0 && l.receivedKg > 0 && Math.abs(l.receivedKg - l.expectedKg) / l.expectedKg > 0.01).length;
  const totalDamagedKg = lots.reduce((s, l) => s + (l.damagedKg || 0), 0);

  // ── filtered ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // "In our possession" = anything that hasn't physically left us yet
    const inPossessionStatuses = new Set(["Expected", "In Transit", "Customs", "In Stock"]);
    return lots.filter(l => {
      const loc = locById(l.locationId);
      if (filterStatus === "inPossession" && !inPossessionStatuses.has(l.status)) return false;
      if (filterStatus !== "all" && filterStatus !== "inPossession" && l.status !== filterStatus) return false;
      if (filterLocationType !== "All" && loc?.type !== filterLocationType) return false;
      if (filterProduct !== "All" && l.product !== filterProduct) return false;
      if (filterQuality !== "All" && l.quality !== filterQuality) return false;
      if (q) {
        const soList = soRefsFor(l, liveSOs).map(s => s.number).join(" ");
        const hay = `${l.number} ${l.product} ${l.poRef || ""} ${soList} ${loc?.name || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [lots, liveSOs, search, filterStatus, filterLocationType, filterProduct, filterQuality]);

  // ── mutations ───────────────────────────────────────────────────────
  function recordMovement({ type, qtyKg, fromId, toId, note }: any) {
    setLots(prev => prev.map(l => {
      if (l.id !== selected.id) return l;
      const m = { id: Date.now(), date: today, type, qtyKg, fromId, toId, note };
      const next = { ...l, movements: [...l.movements, m] };
      switch (type) {
        case "IN":
          // Receiving stock: bumps both receivedKg (cumulative) and physicalKg (currently here)
          next.receivedKg = (next.receivedKg || 0) + qtyKg;
          next.physicalKg = (next.physicalKg || 0) + qtyKg;
          next.locationId = toId;
          break;
        case "TRANSFER":
          // Physical move — physicalKg unchanged, location updates
          next.locationId = toId;
          break;
        case "SHIP_OUT":
          // Goods physically leave — decrement physicalKg
          next.physicalKg = Math.max(0, (next.physicalKg || 0) - qtyKg);
          break;
        case "DAMAGE":
          // Write-off — decrement physicalKg, bump damagedKg
          next.physicalKg = Math.max(0, (next.physicalKg || 0) - qtyKg);
          next.damagedKg = (next.damagedKg || 0) + qtyKg;
          break;
        case "RECLASS":
          // Quality grade change — recorded in movement, no quantity change
          // (Future: split into two sub-lots — Phase 2)
          break;
        default: break;
      }
      // Auto-status transitions based on physical state
      if (type === "TRANSFER") {
        const newLoc = locById(toId);
        if (newLoc?.type === "OWN") next.status = "In Stock";
        else if (newLoc?.type === "PORT") next.status = "Customs";
        // CLIENT location is reached via SHIP_OUT, not TRANSFER (in this model)
      }
      if (type === "SHIP_OUT" && next.physicalKg === 0) {
        next.status = "Shipped Out";
      }
      if (type === "IN" && next.status === "Expected") {
        const newLoc = locById(toId);
        if (newLoc?.type === "OWN") next.status = "In Stock";
        else if (newLoc?.type === "PORT") next.status = "Customs";
        else next.status = "In Transit";
      }
      return next;
    }));
    setShowMovement(false);
  }

  function deleteLot() {
    if (!selected) return;
    if (!window.confirm(`Delete lot ${selected.number}? It will be soft-deleted.`)) return;
    setLots(prev => prev.filter(l => l.id !== selected.id));
    setSelectedId(null);
    setView("list");
  }

  // ── routes ──────────────────────────────────────────────────────────
  if (view === "detail" && selected) {
    return (
      <>
        {showMovement && <MovementModal lot={selected} liveSOs={liveSOs} onCancel={() => setShowMovement(false)} onConfirm={recordMovement} />}
        <LotDetail
          lot={selected}
          onBack={() => { setView("list"); setSelectedId(null); }}
          onMove={() => setShowMovement(true)}
          onDelete={deleteLot}
          liveSOs={liveSOs}
        />
      </>
    );
  }

  // ── list view ───────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#FAFAFA" }}>
      {/* Top bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", flexShrink: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>Inventory Lots</div>
        <div style={{ marginLeft: "auto", fontSize: 12, color: "#AAA" }}>Phase 1 — lot tracking · cost view · movements</div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 20 }}>
          <Card>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>IN STOCK</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#111", marginTop: 6 }}>{fmtNum(Math.round(totalKgInStock))} <span style={{ fontSize: 14, color: "#888", fontWeight: 600 }}>kg</span></div>
            <div style={{ fontSize: 11, color: "#AAA", marginTop: 4 }}>{inStock.length} active lots</div>
          </Card>
          <Card>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>STOCK VALUE</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#16A34A", marginTop: 6 }}>{fmtMoney(totalValueInStock)}</div>
            <div style={{ fontSize: 11, color: "#AAA", marginTop: 4 }}>at cost basis</div>
          </Card>
          <Card>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>AT PORT / CUSTOMS</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: lotsAtPort > 0 ? "#D97706" : "#111", marginTop: 6 }}>{lotsAtPort}</div>
            <div style={{ fontSize: 11, color: "#AAA", marginTop: 4 }}>awaiting clearance</div>
          </Card>
          <Card>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>WITH VARIANCE</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: lotsWithVariance > 0 ? "#D97706" : "#111", marginTop: 6 }}>{lotsWithVariance}</div>
            <div style={{ fontSize: 11, color: "#AAA", marginTop: 4 }}>actual ≠ expected ≥1%</div>
          </Card>
          <Card>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>DAMAGED</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: totalDamagedKg > 0 ? "#DC2626" : "#111", marginTop: 6 }}>{fmtNum(totalDamagedKg)} <span style={{ fontSize: 14, color: "#888", fontWeight: 600 }}>kg</span></div>
            <div style={{ fontSize: 11, color: "#AAA", marginTop: 4 }}>across all lots</div>
          </Card>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search lot ref, product, PO/SO, location…" style={{ flex: "1 1 280px", minWidth: 260, border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 14px", fontSize: 13, outline: "none", background: "#fff" }} />
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#AAA", fontWeight: 700, letterSpacing: "0.06em", marginRight: 4 }}>STATUS</span>
          <button onClick={() => setFilterStatus("inPossession")} style={chipStyle(filterStatus === "inPossession")}>In our possession</button>
          <button onClick={() => setFilterStatus("all")} style={chipStyle(filterStatus === "all")}>All</button>
          {Object.keys(LOT_STATUSES).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} style={chipStyle(filterStatus === s, LOT_STATUSES[s].color)}>{s}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#AAA", fontWeight: 700, letterSpacing: "0.06em", marginRight: 4 }}>LOCATION</span>
          {["All", ...Object.keys(LOCATION_TYPES)].map(t => (
            <button key={t} onClick={() => setFilterLocationType(t)} style={chipStyle(filterLocationType === t)}>
              {t === "All" ? "All" : `${LOCATION_TYPES[t].icon} ${LOCATION_TYPES[t].label}`}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#AAA", fontWeight: 700, letterSpacing: "0.06em", marginRight: 4 }}>PRODUCT</span>
          {["All", ...PRODUCTS].map(p => (
            <button key={p} onClick={() => setFilterProduct(p)} style={chipStyle(filterProduct === p)}>{p}</button>
          ))}
          <span style={{ fontSize: 10, color: "#AAA", fontWeight: 700, letterSpacing: "0.06em", marginLeft: 16, marginRight: 4 }}>QUALITY</span>
          {["All", ...QUALITY_GRADES].map(q => (
            <button key={q} onClick={() => setFilterQuality(q)} style={chipStyle(filterQuality === q)}>{q === "All" ? "All" : `Kl. ${q}`}</button>
          ))}
        </div>

        {/* Table */}
        <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 60px 110px 1fr 140px 130px 120px", padding: "10px 18px", background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
            {["LOT", "PRODUCT", "KL.", "STATUS", "LOCATION & FLOW", "AVAIL/PHYSICAL", "VALUE PLN", "LINKED"].map((h, i) => (
              <div key={i} style={{ fontSize: 10, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em" }}>{h}</div>
            ))}
          </div>
          {filtered.length === 0 && <div style={{ padding: "40px 20px", textAlign: "center", color: "#AAA", fontSize: 13 }}>No lots match the current filters.</div>}
          {filtered.map((l, idx) => {
            const loc = locById(l.locationId);
            const cpk = costPerKg(l);
            const res = lotReservations(l, liveSOs);
            const soList = soRefsFor(l, liveSOs);
            return (
              <div key={l.id} style={{ display: "grid", gridTemplateColumns: "150px 1fr 60px 110px 1fr 140px 130px 120px", padding: "12px 18px", borderBottom: idx < filtered.length - 1 ? "1px solid #F3F4F6" : "none", alignItems: "center", background: "#fff", cursor: "pointer" }}
                onClick={() => { setSelectedId(l.id); setView("detail"); }}
                onMouseEnter={e => e.currentTarget.style.background = "#FAFAFA"}
                onMouseLeave={e => e.currentTarget.style.background = "#fff"}
              >
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#2563EB", fontFamily: "ui-monospace, Menlo, monospace" }}>{l.number}</div>
                  <div style={{ marginTop: 3 }}><VarianceBadge expected={l.expectedKg} actual={l.receivedKg} /></div>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#111" }}>{l.product}</div>
                  <div style={{ fontSize: 11, color: "#AAA" }}>{l.size || "—"} · {l.origin || "—"} · {l.packaging}</div>
                </div>
                <div><QualityBadge quality={l.quality} /></div>
                <div><StatusBadge status={l.status} /></div>
                <div>
                  <LocationPill locationId={l.locationId} />
                  <div style={{ marginTop: 3 }}><FlowBadge flow={l.flow} compact /></div>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#16A34A" }}>{fmtNum(res.liveAvailable)} <span style={{ fontSize: 11, color: "#AAA", fontWeight: 400 }}>/ {fmtNum(l.physicalKg || 0)} kg</span></div>
                  {res.totalReserved > 0 && <div style={{ fontSize: 10.5, color: "#7C3AED", fontWeight: 600 }}>{fmtNum(res.totalReserved)} reserved · {res.reservations.length} SO</div>}
                  {l.damagedKg > 0 && <div style={{ fontSize: 10.5, color: "#DC2626", fontWeight: 600 }}>{fmtNum(l.damagedKg)} damaged</div>}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{fmtMoney(valueInStock(l)).replace(" PLN", "")}</div>
                  <div style={{ fontSize: 10, color: "#AAA" }}>{fmtMoney(cpk)}/kg</div>
                </div>
                <div>
                  {l.poRef && <div style={{ fontSize: 11, color: "#1D4ED8", fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 600 }}>{l.poRef}</div>}
                  {soList.slice(0, 2).map(s => (
                    <div key={s.number} style={{ fontSize: 11, color: "#15803D", fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 600 }}>{s.number}</div>
                  ))}
                  {soList.length > 2 && <div style={{ fontSize: 10, color: "#AAA" }}>+{soList.length - 2} more</div>}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 16, fontSize: 11, color: "#AAA", textAlign: "center" }}>
          {filtered.length} of {lots.length} lots · Click any row to open · Live availability computed from SO state · Phase 2 adds damage reports, storage allocation, cost recalc into SO margins
        </div>
      </div>
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────────
function chipStyle(active, accent = "#111") {
  return {
    padding: "4px 10px", borderRadius: 6, border: "1px solid", borderColor: active ? "#111" : "#E5E7EB",
    background: active ? "#111" : "#fff", color: active ? "#fff" : (accent || "#555"),
    fontSize: 11, cursor: "pointer", fontWeight: 500, fontFamily: "inherit",
  };
}
