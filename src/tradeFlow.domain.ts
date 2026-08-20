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
// v6.37.0: the legacy flow-key shim (FLOW_TO_STRUCT / structToFlow / reconcilePOFlow)
// was retired — stored data was migrated by flowCleanup.migration (schema 2).


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



// ── v6.34.0: the SHIPMENT resolves direction from its REAL ends ──────────────
// A shipment's direction is a fact about ITS journey — producer country (from
// the PO) × final destination country (from the governing SO's destination).
// One CIF-Koper PO can father an EU-import truck AND a T1 cross-trade truck;
// each shipment resolves independently once its governing SO is known.
//
// Resolution order (first hit wins):
//   1. explicit manual override on the shipment (the human's final word — the
//      T1-at-an-EU-port subtlety the matrix can't infer)
//   2. DERIVED from ends: producer country × SO destination country, via the
//      four-class matrix — the automatic, correct answer for the common case
//   3. the PO's provisional movement (no governing SO — unsold-to-warehouse)
//   4. legacy flow key, then Import
export const TRADE_DIRECTIONS = ["IMPORT", "EXPORT", "INTRA_EU", "CROSS_TRADE"];

/** A country string for the shipment's ORIGIN — the producer, from the PO. */
export function poOriginCountry(po: any, resolveCountry?: (id: any) => string): string {
  if (!po) return "";
  return String(po.supplier?.country || (po.items || [])[0]?.origin || "").trim();
}

/** A country string for the FINAL DESTINATION — from the governing SO. Prefers
 *  the SO's named destination (per its sell incoterm) over the client's home
 *  country: a CIF-to-a-port sale goes where the goods physically go (ruling #2).
 *  resolveCountry maps a destinationLocationId → its country. */
export function soDestinationCountry(so: any, resolveCountry?: (id: any) => string): string {
  if (!so) return "";
  if (so.destinationLocationId != null && resolveCountry) {
    const c = resolveCountry(so.destinationLocationId);
    if (c) return String(c).trim();
  }
  if (so.destinationText) {
    // free-typed place — best effort: a trailing country-ish token, else the client's country
    const txt = String(so.destinationText).trim();
    if (txt) return txt;
  }
  return String(so.client?.country || "").trim();
}

/** The derived direction from two country strings, or "" when either is unknown. */
export function directionFromCountries(originCountry: string, destCountry: string): string {
  if (!originCountry || !destCountry) return "";
  return movementFromEnds(isEUCountry(originCountry), isEUCountry(destCountry));
}

export function shipmentTradeDirection(shipment: any, po: any, so: any = null, resolveCountry?: (id: any) => string): string {
  // 1. explicit manual override — always wins
  if (shipment?.tradeDirection && MOVEMENT_LABELS[shipment.tradeDirection]) return shipment.tradeDirection;
  // 2. derived from the real ends when a governing SO is known
  if (so) {
    const derived = directionFromCountries(poOriginCountry(po, resolveCountry), soDestinationCountry(so, resolveCountry));
    if (derived) return derived;
  }
  // 3. PO provisional (no SO — unsold portion to warehouse)
  if (po?.tradeMovement && MOVEMENT_LABELS[po.tradeMovement]) return po.tradeMovement;
  // 4. legacy flow key, then Import
  if (String(po?.flow || "").startsWith("EXP")) return "EXPORT";
  return "IMPORT";
}

// ── v6.34.6: does a shipment FULFIL its PO/SO (consume the shipped budget)? ──────
// The fulfilling movement is decided by the SELL INCOTERM + the destination:
//   • FOB/FCA/EXW sales: our obligation ends at the port/handover — the leg to the
//     port IS fulfilment → it consumes.
//   • CIF/CFR/CPT/CIP sales: main carriage is on us, so an ONWARD (sea) leg follows;
//     the PRE-CARRIAGE road leg to a PORT does NOT consume (the onward leg will) —
//     otherwise the same goods count twice (5 trucks + 4 containers).
//   • Anything else (DAP/DDP/road-direct, no port hop): the movement is fulfilment → consumes.
// A shipment only counts once it is BOOKED or beyond (Draft is still being built).
const FREIGHT_ONWARD_SELL = new Set(["CIF", "CFR", "CPT", "CIP"]);
export function sellIncotermHasOnwardLeg(sellIncoterm: any): boolean {
  return FREIGHT_ONWARD_SELL.has(String(sellIncoterm || "").toUpperCase());
}
// v6.55.0: shipmentFulfilsOrder() REMOVED, together with the carve-out it held.
// It existed to stop a pre-carriage road leg to a port under CIF/CFR/CPT/CIP
// from consuming a purchase order twice. That was a patch on a wrong premise —
// shipments do not consume purchase orders at all — and it only ever covered
// that one shape: it still double-counted a truck to a customs point where the
// client transships, and cargo loaded straight into a container at the
// producer. Consumption is a sales-order question (salesOrders.domain).
// sellIncotermHasOnwardLeg() is kept: it describes a real fact about incoterms
// and is used elsewhere.

// ── v6.35.1 (Phase C step 3): ownership boundaries from the REAL incoterms, not the flow key.
// buyOwnershipStart = the point at which WE take ownership from the supplier (buy incoterm).
// sellOwnershipEnd  = the point at which we hand ownership to the client (sell incoterm).
// Points, earliest→latest along a trade: supplier → origin_port → dest_port → our_wh → client.
export const OWNERSHIP_POINTS = ["supplier", "origin_port", "dest_port", "our_wh", "client"] as const;
export function buyOwnershipStartFromIncoterm(buyIncoterm: any): string {
  const ic = String(buyIncoterm || "").toUpperCase();
  // where WE become owner when buying:
  if (ic === "EXW" || ic === "FCA") return "supplier";      // we take over at the supplier
  if (ic === "FOB" || ic === "FAS") return "origin_port";    // we take over at the port of loading
  if (ic === "CIF" || ic === "CFR" || ic === "CIP" || ic === "CPT") return "dest_port"; // supplier's risk to destination port
  if (ic === "DAP" || ic === "DPU") return "our_wh";         // supplier delivers to us
  if (ic === "DDP") return "our_wh";                          // supplier delivers duty-paid to us
  return "supplier";
}
export function sellOwnershipEndFromIncoterm(sellIncoterm: any): string {
  const ic = String(sellIncoterm || "").toUpperCase();
  // where WE stop being owner when selling:
  if (ic === "EXW" || ic === "FCA") return "supplier";       // client collects at origin
  if (ic === "FOB" || ic === "FAS") return "origin_port";    // handed over at port of loading
  if (ic === "CIF" || ic === "CFR" || ic === "CIP" || ic === "CPT") return "dest_port"; // our risk to destination port
  if (ic === "DAP" || ic === "DPU" || ic === "DDP") return "client"; // we deliver to client
  return "client";
}
/**
 * Ownership state of the goods at a given transfer point, from the real incoterms.
 * Returns "not_owned" | "owned" | "handed_over".
 */
export function ownershipAtPoint(point: string, buyIncoterm: any, sellIncoterm: any): string {
  const order = OWNERSHIP_POINTS as readonly string[];
  const start = buyOwnershipStartFromIncoterm(buyIncoterm);
  const end = sellOwnershipEndFromIncoterm(sellIncoterm);
  const pI = order.indexOf(point);
  const sI = order.indexOf(start);
  const eI = order.indexOf(end);
  if (pI === -1 || sI === -1 || eI === -1) return "owned";
  if (pI < sI) return "not_owned";
  if (pI > eI) return "handed_over";
  return "owned";
}
