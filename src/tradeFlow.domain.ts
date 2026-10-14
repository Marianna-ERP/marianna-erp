import { isEU } from "./counterparty.domain";   // v7.12.0 (A-TD-1): the one country table
import { isReceiptOfPO } from "./receipts.domain";
import { ruleOf } from "./incoterms.domain";   // v7.22.3 (FZ-21): the one incoterm table

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

// ── Phase B (BP-57): the SALE owns disposition ───────────────────────────────
/** A sales order's disposition, derived from its sell terms. */
export function dispositionFromSO(so: any): string {
  // v7.22.3 (FZ-21): from the one table — what the sale's named place is decides where the goods go
  const np = ruleOf(so?.sellIncoterm)?.namedPlace;
  if (np === "seller-premises") return "CLIENT_PICKUP";
  if (np === "destination-place") return "DIRECT_TO_CLIENT";
  if (np === "origin-place" || np === "origin-port" || np === "destination-port") return "TO_PORT";
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
