import { isEU } from "./counterparty.domain";   // v7.12.0 (A-TD-1): the one country table
import { isReceiptOfPO } from "./receipts.domain";   // v7.12.0 (A-TD-1): the first movement of the goods
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

// v7.12.0 (A-TD-1, owner 8 Oct): the separate EU list (English names only) is gone — EU or not comes from the ONE country
// table, counterparty.isEU (names in English and Polish, ISO codes, and the countries added in Settings).

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




/** A country string for the goods' ORIGIN — the producer, from the PO. */
export function poOriginCountry(po: any): string {
  if (!po) return "";
  return String(po.supplier?.country || (po.items || [])[0]?.origin || "").trim();
}

// ── v7.12.0 (A-TD-1, owner 8 Oct): ONE RULE FOR THE TRADE DIRECTION, FROM THE REAL ENDS ─────────────────────────────
// Until v7.11.5 the direction came from the producer's home country × the sale's destination, read a TYPED destination as if it
// were a country (22 of 29 sales on the 2 Oct file), said "Import" whenever no sale governed the truck, and judged goods already
// received in the EU from the producer's country. The rule now:
//   ORIGIN      — the first movement of the goods (the PO's receipt, the supplier's own truck) → the producer's country
//                 (their customs status is their origin); an onward movement → the shipment's starting place (filled from
//                 where the lots are, v7.9.2), else the producer.
//   DESTINATION — the governing sale's registered place → else the client's country (typed text is never read as a country)
//                 → with no sale: the shipment's destination place → the PO's named place → our company's country.
//   EU or not   — counterparty.isEU, the one country table. An end that cannot be known gives no direction ("—") and says
//                 which place to set; nothing defaults to "Import".
// v7.19.6 (A-TD-5): OUR country is Settings → Company's — App passes it in (the built-in "Poland" stands until it does, as COMPANY_DEFAULTS)
let OUR_COUNTRY_V = "Poland";
export function setOurCountry(c: any) { const v = String(c ?? "").trim(); if (v) OUR_COUNTRY_V = v; }
export function ourCountry(): string { return OUR_COUNTRY_V; }
export interface TradeEnd { country: string; from: string; }
export interface TradeEnds { origin: TradeEnd; destination: TradeEnd; direction: string; missing: string; }
const S_ = (v: any) => String(v ?? "").trim();
export function shipmentTradeEnds(sh: any, ctx: { pos?: any[]; orders?: any[]; countryOf?: (id: any) => string } = {}): TradeEnds {
  const cOf = (id: any) => (id === undefined || id === null || id === "" || !ctx.countryOf) ? "" : S_(ctx.countryOf(id));
  const poRefs = (sh?.poRefs || []).map(String);
  const po = (ctx.pos || []).find((p: any) => poRefs.includes(String(p?.number))) || null;
  const so = S_(sh?.governingSoRef) ? (ctx.orders || []).find((o: any) => String(o?.number) === S_(sh.governingSoRef)) || null : null;
  const legs = sh?.legs || [];
  const first = isReceiptOfPO(sh) || S_(sh?.arrangedBy).toUpperCase() === "SUPPLIER";
  let origin: TradeEnd = { country: "", from: "" };
  if (!first) { const c = cOf(sh?.originLocationId) || cOf(legs[0]?.fromLocationId); if (c) origin = { country: c, from: "starting place" }; }
  if (!origin.country) { const c = poOriginCountry(po); if (c) origin = { country: c, from: first ? "producer" : "producer — no starting place set" }; }
  let destination: TradeEnd = { country: "", from: "" };
  if (so) { const c = cOf(so.destinationLocationId); destination = c ? { country: c, from: "sale's place" } : S_(so.client?.country) ? { country: S_(so.client.country), from: "client's country" } : destination; }
  if (!destination.country) { const c = cOf(sh?.destinationLocationId) || cOf(legs.length ? legs[legs.length - 1]?.toLocationId : null); if (c) destination = { country: c, from: "shipment's destination" }; }
  if (!destination.country && po) { const c = cOf(po.destinationLocationId); if (c) destination = { country: c, from: "PO's named place" }; }
  if (!destination.country) destination = { country: ourCountry(), from: "our company" };
  if (!origin.country) return { origin, destination, direction: "", missing: "set the starting place (or link the PO)" };
  const oEU = isEU(origin.country), dEU = isEU(destination.country);
  if (oEU === null) return { origin, destination, direction: "", missing: `"${origin.country}" is not a country the system knows — add it in Settings → Countries` };
  if (dEU === null) return { origin, destination, direction: "", missing: `"${destination.country}" is not a country the system knows — add it in Settings → Countries` };
  return { origin, destination, direction: movementFromEnds(oEU, dEU), missing: "" };
}
/** The direction alone ("" when an end is unknown). Every reader asks this — nothing is stored (A-TD-2). */
export function shipmentTradeDirection(sh: any, ctx: { pos?: any[]; orders?: any[]; countryOf?: (id: any) => string } = {}): string {
  return shipmentTradeEnds(sh, ctx).direction;
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
