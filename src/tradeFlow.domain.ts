// ─────────────────────────────────────────────────────────────────────────────
// tradeFlow.domain.ts — structured PO trade fields ⇄ legacy flow key (Batch 4b)
//
// BP-1 exposes the trade structure as explicit, editable fields. BP-12 keeps the
// legacy `flow` key (which Shipments and Inventory read heavily —
// FLOW_TYPES[lot.flow], isExport, journey templates) working by DERIVING it from
// the structured fields, and vice-versa for existing data. Bidirectional and
// lossless across the 12 known flows; unknown keys degrade gracefully.
//
// The four structured fields (BP-1):
//   tradeMovement : "EXPORT" | "IMPORT"           (we sell from PL/EU · we buy in)
//   purchaseIncoterm : EXW | FCA | FOB | CIF | DAP | DDP …
//   handoverPoint : "supplier" | "origin_port" | "dest_port" | "our_wh" | "client"
//   cargoPlan : "OUR_WAREHOUSE" | "DIRECT_TO_CLIENT" | "TO_PORT" | "CLIENT_PICKUP"
// ─────────────────────────────────────────────────────────────────────────────

// Legacy flow key → structured fields (for existing POs/lots).
const FLOW_TO_STRUCT: Record<string, any> = {
  EXP_EXWS:   { tradeMovement: "EXPORT", purchaseIncoterm: "EXW", handoverPoint: "supplier",    cargoPlan: "CLIENT_PICKUP" },
  EXP_FOB:    { tradeMovement: "EXPORT", purchaseIncoterm: "EXW", handoverPoint: "origin_port", cargoPlan: "TO_PORT" },
  EXP_CIF:    { tradeMovement: "EXPORT", purchaseIncoterm: "EXW", handoverPoint: "dest_port",   cargoPlan: "TO_PORT" },
  EXP_DDP_EU: { tradeMovement: "EXPORT", purchaseIncoterm: "EXW", handoverPoint: "client",      cargoPlan: "DIRECT_TO_CLIENT" },
  EXP_DDP_XEU:{ tradeMovement: "EXPORT", purchaseIncoterm: "EXW", handoverPoint: "client",      cargoPlan: "DIRECT_TO_CLIENT" },
  IMP_EXWS_WH:{ tradeMovement: "IMPORT", purchaseIncoterm: "EXW", handoverPoint: "supplier",    cargoPlan: "OUR_WAREHOUSE" },
  IMP_EXWS_DIR:{tradeMovement: "IMPORT", purchaseIncoterm: "EXW", handoverPoint: "supplier",    cargoPlan: "DIRECT_TO_CLIENT" },
  IMP_CIF_WH: { tradeMovement: "IMPORT", purchaseIncoterm: "CIF", handoverPoint: "dest_port",   cargoPlan: "OUR_WAREHOUSE" },
  IMP_CIF_DIR:{ tradeMovement: "IMPORT", purchaseIncoterm: "CIF", handoverPoint: "dest_port",   cargoPlan: "DIRECT_TO_CLIENT" },
  IMP_DDP_WH: { tradeMovement: "IMPORT", purchaseIncoterm: "DDP", handoverPoint: "our_wh",      cargoPlan: "OUR_WAREHOUSE" },
  IMP_DDP_DIR:{ tradeMovement: "IMPORT", purchaseIncoterm: "DDP", handoverPoint: "client",      cargoPlan: "DIRECT_TO_CLIENT" },
};

export function flowToStruct(flow: string): any {
  return FLOW_TO_STRUCT[flow] || null;
}

/**
 * Structured fields → the legacy flow key (BP-12 shim). Deterministic inverse of
 * the table above; picks the closest legacy flow so downstream FLOW_TYPES lookups,
 * journey templates and isExport keep working unchanged.
 */
export function structToFlow(s: any): string {
  if (!s || !s.tradeMovement) return "";
  const inc = String(s.purchaseIncoterm || "EXW").toUpperCase();
  const direct = s.cargoPlan === "DIRECT_TO_CLIENT";
  const pickup = s.cargoPlan === "CLIENT_PICKUP";
  const toPort = s.cargoPlan === "TO_PORT";

  if (s.tradeMovement === "EXPORT") {
    if (pickup) return "EXP_EXWS";
    if (toPort) return s.handoverPoint === "dest_port" || s.requiresSea ? "EXP_CIF" : "EXP_FOB";
    if (direct) return s.crossBorder ? "EXP_DDP_XEU" : "EXP_DDP_EU";
    return "EXP_CIF";
  }
  // IMPORT
  if (inc === "DDP" || inc === "DAP") return direct ? "IMP_DDP_DIR" : "IMP_DDP_WH";
  if (inc === "CIF" || inc === "CFR") return direct ? "IMP_CIF_DIR" : "IMP_CIF_WH";
  // EXW/FCA/FOB purchase
  return direct ? "IMP_EXWS_DIR" : "IMP_EXWS_WH";
}

/** Round-trip stability check used by tests: struct→flow→struct preserves the essentials. */
export function isDirectCargoPlan(s: any): boolean {
  return s?.cargoPlan === "DIRECT_TO_CLIENT";
}


/** Ensure a PO has both representations in sync (called on load / save). */
export function reconcilePOFlow(po: any): any {
  // If structured fields are present, they win and the legacy flow is derived.
  if (po.tradeMovement) {
    const flow = structToFlow(po) || po.flow || "";
    return { ...po, flow, directFlow: isDirectCargoPlan(po) };
  }
  // Otherwise derive structured fields from the legacy flow (existing data).
  const s = flowToStruct(po.flow);
  if (s) return { ...po, ...s, directFlow: s.cargoPlan === "DIRECT_TO_CLIENT" };
  return po;
}

// BP-56 / FB-4: incoterm-specific handover wording (derived, shown read-only).
export function handoverTextForIncoterm(incoterm: string, tradeMovement: string): string {
  const t = String(incoterm || "").toUpperCase();
  const map: Record<string, string> = {
    EXW: "Supplier premises — we collect at origin (all transport on us).",
    FCA: "Handed to our carrier at the named origin point.",
    FOB: "On board at the port of loading — sea freight onward on us.",
    CFR: "Seller pays freight to destination port; risk passes at loading.",
    CIF: "Port of discharge — seller covers freight + insurance to that port.",
    DAP: "Named destination — delivered unloaded; import duties on us.",
    DDP: "Delivered to destination, duties paid by the supplier.",
    DAT: "Delivered at terminal / named place, unloaded.",
  };
  return map[t] || (t ? `${t} — handover per incoterm.` : "Select a purchase incoterm to see the handover point.");
}

// Derive the physical handover point code from the incoterm (BP-56).
export function handoverPointForIncoterm(incoterm: string): string {
  const t = String(incoterm || "").toUpperCase();
  if (t === "EXW") return "supplier";
  if (t === "FCA") return "supplier";
  if (t === "FOB" || t === "CFR") return "origin_port";
  if (t === "CIF") return "dest_port";
  if (t === "DAP" || t === "DAT") return "client";
  if (t === "DDP") return "our_wh";
  return "";
}

// ═══ Batch 6b: PURCHASE TERMS collapse + 4-class movement + Phase B core ═══

// EU membership for the movement matrix (customs perspective, EU-27).
const EU_COUNTRIES = new Set(["austria","belgium","bulgaria","croatia","cyprus","czechia","czech republic","denmark","estonia","finland","france","germany","greece","hungary","ireland","italy","latvia","lithuania","luxembourg","malta","netherlands","poland","polska","portugal","romania","slovakia","slovenia","spain","sweden"]);
export function isEUCountry(country: any): boolean {
  return EU_COUNTRIES.has(String(country || "").trim().toLowerCase());
}

// The movement matrix (BP-56 final): origin × named place, from the EU-customs view.
//   origin ∉ EU, place ∈ EU  → IMPORT       (goods enter EU customs)
//   origin ∈ EU, place ∉ EU  → EXPORT       (goods leave EU customs)
//   origin ∈ EU, place ∈ EU  → INTRA_EU     (no customs border)
//   origin ∉ EU, place ∉ EU  → CROSS_TRADE  (goods never touch the EU)
export function movementFromEnds(originInEU: boolean, placeInEU: boolean): string {
  if (!originInEU && placeInEU) return "IMPORT";
  if (originInEU && !placeInEU) return "EXPORT";
  if (originInEU && placeInEU) return "INTRA_EU";
  return "CROSS_TRADE";
}
export const MOVEMENT_LABELS: Record<string, { label: string; color: string; hint: string }> = {
  IMPORT:      { label: "Import",      color: "#1D4ED8", hint: "Goods enter EU customs" },
  EXPORT:      { label: "Export",      color: "#15803D", hint: "Goods leave EU customs" },
  INTRA_EU:    { label: "Intra-EU",    color: "#7C3AED", hint: "No customs border" },
  CROSS_TRADE: { label: "Cross-trade", color: "#B45309", hint: "Goods never touch the EU — no EU customs at all" },
};

/** Which location types the named place should offer, per incoterm. */
// Labels per Hazem's table (v6.29.0): plain words, the label says what to type.
// CFR corrected to the DISCHARGE port (Cost and Freight *to named port of
// destination* — risk passes at loading, but the named place is the destination).
export function namedPlacePoolForIncoterm(incoterm: string): { types: string[]; label: string } {
  const t = String(incoterm || "").toUpperCase();
  if (t === "EXW" || t === "FCA") return { types: ["SUPPLIER"], label: "Pickup place (supplier site)" };
  if (t === "FOB") return { types: ["PORT"], label: "Port of loading" };
  if (t === "CFR" || t === "CIF") return { types: ["PORT"], label: "Port of discharge" };
  if (t === "DAP" || t === "DAT") return { types: ["CLIENT", "OWN"], label: "Delivery place" };
  if (t === "DDP") return { types: ["OWN", "CLIENT"], label: "Delivered to (our address)" };
  return { types: ["SUPPLIER", "PORT", "OWN", "CLIENT"], label: "Place (set the incoterm first)" };
}

/** One contractual sentence: responsibilities + the named place, in words. */
export function handoverSentence(incoterm: string, placeName: string): string {
  const t = String(incoterm || "").toUpperCase();
  const p = placeName ? ` — ${placeName}` : "";
  const map: Record<string, string> = {
    EXW: `We collect at the supplier's premises${p}; all transport and export formalities on us.`,
    FCA: `Handed to our carrier at the named origin point${p}; main carriage on us.`,
    FOB: `Loaded on board at the port of loading${p}; sea freight onward on us.`,
    CFR: `Seller pays freight to the destination port${p}; risk passes to us at loading.`,
    CIF: `We take over at the port of discharge${p}; seller covers freight + insurance to that port.`,
    DAP: `Delivered to the named place${p}, unloading and import duties on us.`,
    DAT: `Delivered at terminal${p}, unloaded.`,
    DDP: `Delivered to us${p} with duties paid by the supplier — no logistics on our side.`,
  };
  return map[t] || (t ? `${t}${p} — handover per Incoterms 2020.` : "Select the purchase incoterm — it defines who does what, and where we take over.");
}

// ── Phase B (BP-57): the SALE owns disposition ───────────────────────────────
/** A sales order's disposition, derived from its sell terms. */
export function dispositionFromSO(so: any): string {
  const ic = String(so?.sellIncoterm || "").toUpperCase();
  if (ic === "EXW") return "CLIENT_PICKUP";
  if (ic === "DAP" || ic === "DDP" || ic === "DAT") return "DIRECT_TO_CLIENT";
  if (ic === "CIF" || ic === "CFR" || ic === "FOB" || ic === "FCA") return "TO_PORT";
  return "OUR_WAREHOUSE";
}

/** Phase B core: a PO is a DIRECT (never-our-warehouse) flow when a governing
 *  active SO sources it and that sale's terms send goods straight onward. */
export function poDirectFromSOs(po: any, orders: any[]): boolean {
  return (orders || []).some((o: any) => {
    if (!o || o.status === "Cancelled" || o.status === "Draft") return false;
    const sources = (o.items || []).some((it: any) => it.sourceType === "PO" && it.sourceRef === po.number);
    if (!sources) return false;
    const d = dispositionFromSO(o);
    return d === "DIRECT_TO_CLIENT" || d === "TO_PORT" || d === "CLIENT_PICKUP";
  });
}

/** Recompose the PO's internal flow from its terms + the sales reality (Phase B). */
export function composePOFlow(po: any, orders: any[]): { flow: string; directFlow: boolean } {
  const direct = poDirectFromSOs(po, orders);
  const movement = po.tradeMovement || "IMPORT";
  const st = {
    tradeMovement: movement === "EXPORT" ? "EXPORT" : "IMPORT", // legacy keys are binary; INTRA_EU/CROSS_TRADE ride the import branch
    purchaseIncoterm: po.buyIncoterm || po.purchaseIncoterm || "EXW",
    cargoPlan: (direct || movement === "CROSS_TRADE") ? "DIRECT_TO_CLIENT" : "OUR_WAREHOUSE",
    handoverPoint: po.handoverPoint,
  };
  return { flow: structToFlow(st) || po.flow || "", directFlow: st.cargoPlan === "DIRECT_TO_CLIENT" };
}

// ── v6.29.0: the SHIPMENT owns the trade direction (double-entry removed) ────
// The PO carries no direction input — only a provisional read-only chip. The
// journey's truth lives on the shipment: explicit field first, then the PO's
// provisional value, then the legacy flow key, then Import.
export const TRADE_DIRECTIONS = ["IMPORT", "EXPORT", "INTRA_EU", "CROSS_TRADE"];
export function shipmentTradeDirection(shipment: any, po: any): string {
  if (shipment?.tradeDirection && MOVEMENT_LABELS[shipment.tradeDirection]) return shipment.tradeDirection;
  if (po?.tradeMovement && MOVEMENT_LABELS[po.tradeMovement]) return po.tradeMovement;
  if (String(po?.flow || "").startsWith("EXP")) return "EXPORT";
  return "IMPORT";
}
