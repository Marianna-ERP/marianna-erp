import { isEU } from "./counterparty.domain";   // v7.12.0 (A-TD-1): the one country table
import { isReceiptOfPO } from "./receipts.domain";
import { ruleOf, salesCarried } from "./incoterms.domain";   // v7.22.3 (FZ-21): the one incoterm table · v7.31.1: the sales a shipment carries

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

/** Phase B core: a PO is a DIRECT (never-our-warehouse) flow when an active sale sells one of ITS LOTS and that sale's terms
 *  send the goods straight onward. v7.24.2 (A-RV-41): a sale line names a lot (A-ONE-1) — the rule reads the PO's lots; it
 *  used to look for lines "sourced from the PO", which no sale has had since, so it answered "not direct" for every PO. */
export function poDirectFromSOs(po: any, orders: any[], lots: any[] = []): boolean {
return salesOfPO(po, orders, lots).some((o: any) => { const d = dispositionFromSO(o); return d === "DIRECT_TO_CLIENT" || d === "TO_PORT" || d === "CLIENT_PICKUP"; });
}

/** v7.27.0 (FZ-23, P-12 — owner 19 Oct): THE SALES OF A PO, ONE READER. A sale line names a lot (A-ONE-1), so a PO's sales are the
*  sales of its lots — for the 'direct' rule, for the shipment created from a PO (its delivery date, the 'which client?' choice when one
*  PO feeds two sales) and for every screen that asks. Deleted sales never count; drafts only when asked for. */
export function salesOfPO(po: any, orders: any[], lots: any[], opts: { includeDrafts?: boolean } = {}): any[] {
const mine = new Set((lots || []).filter((l: any) => l && String(l.poRef) === String(po?.number)).map((l: any) => String(l.number)));
if (!mine.size) return [];
return (orders || []).filter((o: any) => o && o.status !== "Cancelled" && (opts.includeDrafts || o.status !== "Draft") && (o.items || []).some((it: any) => it && it.sourceRef != null && mine.has(String(it.sourceRef))));
}
/** v7.27.0 (FZ-23): the POs a sale's goods come from — through the lots its lines name. */
export function posOfSale(so: any, pos: any[], lots: any[]): any[] {
const lotPo = new Map((lots || []).filter((l: any) => l).map((l: any) => [String(l.number), String(l.poRef || "")]));
const nos = new Set((so?.items || []).map((it: any) => lotPo.get(String(it?.sourceRef))).filter(Boolean));
return (pos || []).filter((p: any) => p && nos.has(String(p.number)));
}




/** v7.24.4 (A-RV-41, owner option 1, 17 Oct): "DIRECT" IS NEVER TYPED — the one rule keeps the stored flag current. Whenever a sale,
 *  a PO or a lot changes, each PO's flag is what poDirectFromSOs says, and each of its lots carries its PO's flag; a lot not yet
 *  received follows it in its status too (Expected ↔ Direct Expected). Lots already received keep their status — posting never
 *  receives them again. Only differences are returned: nothing to change gives back the very arrays. */
export function directSync(pos: any[], orders: any[], lots: any[]): { pos: any[]; lots: any[]; changedPOs: string[]; changedLots: string[] } {
  const want = new Map<string, boolean>();
  (pos || []).forEach((p: any) => { if (p && p.status !== "Cancelled" && p.buyIncoterm) want.set(String(p.number), poDirectFromSOs(p, orders || [], lots || [])); });
  const changedPOs: string[] = [], changedLots: string[] = [];
  const nextPOs = (pos || []).map((p: any) => { const w = p && want.get(String(p.number)); if (w === undefined || !!p.directFlow === w) return p; changedPOs.push(String(p.number)); return { ...p, directFlow: w }; });
  const nextLots = (lots || []).map((l: any) => {
    const w = l && want.get(String(l.poRef)); if (w === undefined) return l;
    const st = String(l.status || ""); const st2 = !w && st === "Direct Expected" ? "Expected" : (w && st === "Expected" ? "Direct Expected" : st);
    if (!!l.directFlow === w && st2 === st) return l;
    changedLots.push(String(l.number)); return { ...l, directFlow: w, status: st2 };
  });
  return { pos: changedPOs.length ? nextPOs : pos, lots: changedLots.length ? nextLots : lots, changedPOs, changedLots };
}

/** A country string for the goods' ORIGIN — the producer, from the PO. */
function poOriginCountry(po: any): string {
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
function ourCountry(): string { return OUR_COUNTRY_V; }
export interface TradeEnd { country: string; from: string; }
export interface TradeEnds { origin: TradeEnd; destination: TradeEnd; direction: string; missing: string; }
const S_ = (v: any) => String(v ?? "").trim();
export function shipmentTradeEnds(sh: any, ctx: { pos?: any[]; orders?: any[]; countryOf?: (id: any) => string } = {}): TradeEnds {
  const cOf = (id: any) => (id === undefined || id === null || id === "" || !ctx.countryOf) ? "" : S_(ctx.countryOf(id));
  const poRefs = (sh?.poRefs || []).map(String);
  const po = (ctx.pos || []).find((p: any) => poRefs.includes(String(p?.number))) || null;
  const so = S_(sh?.governingSoRef) ? (ctx.orders || []).find((o: any) => String(o?.number) === S_(sh.governingSoRef)) || null : null;
  const first = isReceiptOfPO(sh) || S_(sh?.arrangedBy).toUpperCase() === "SUPPLIER";
  let origin: TradeEnd = { country: "", from: "" };
  if (!first) { const c = cOf(shipmentStartPlaceId(sh)); if (c) origin = { country: c, from: "starting place" }; }   // v7.28.7: the route's start first
  if (!origin.country) { const c = poOriginCountry(po); if (c) origin = { country: c, from: first ? "producer" : (shipmentStartPlaceId(sh) != null ? "producer — the starting place is not a known place" : "producer — no starting place set") }; }
  let destination: TradeEnd = { country: "", from: "" };
  if (so) { const c = cOf(so.destinationLocationId); destination = c ? { country: c, from: "sale's place" } : S_(so.client?.country) ? { country: S_(so.client.country), from: "client's country" } : destination; }
  if (!destination.country) { const c = cOf(shipmentEndPlaceId(sh));   /* v7.27.13 (P-12): the route's end first */ if (c) destination = { country: c, from: "shipment's destination" }; }
  if (!destination.country && po) { const c = cOf(po.destinationLocationId); if (c) destination = { country: c, from: "PO's named place" }; }
  if (!destination.country) destination = { country: ourCountry(), from: "our company" };
  if (!origin.country) return { origin, destination, direction: "", missing: "set the starting place (or link the PO)" };
  const oEU = isEU(origin.country), dEU = isEU(destination.country);
  if (oEU === null) return { origin, destination, direction: "", missing: `"${origin.country}" is not a country the system knows — add it in Settings → Countries` };
  if (dEU === null) return { origin, destination, direction: "", missing: `"${destination.country}" is not a country the system knows — add it in Settings → Countries` };
  return { origin, destination, direction: movementFromEnds(oEU, dEU), missing: "" };
}
/** The direction alone ("" when an end is unknown). Every reader asks this — nothing is stored (A-TD-2). */
/** v7.27.13 (P-12): WHERE A SHIPMENT ENDS — its route's last leg (places live on the route since A-R12-4); the shipment's own
 *  destination field only when it has no legs. One reader for the terms review, the trade direction and the documents. */
/** v7.28.7 (Batch L · FZ-08, P-12): WHERE A SHIPMENT STARTS — its route's first leg; its own origin field only without legs. */
export function shipmentStartPlaceId(sh: any): any {
  const first = (sh?.legs || []).filter((l: any) => l)[0];
  const v = first && first.fromLocationId != null && first.fromLocationId !== "" ? first.fromLocationId : (sh?.originLocationId ?? null);
  return v === "" ? null : v;
}
export function shipmentEndPlaceId(sh: any): any {
  const legs = (sh?.legs || []).filter((l: any) => l); const last = legs.length ? legs[legs.length - 1] : null;
  const v = last && last.toLocationId != null && last.toLocationId !== "" ? last.toLocationId : (sh?.destinationLocationId ?? null);
  return v === "" ? null : v;
}
export function shipmentTradeDirection(sh: any, ctx: { pos?: any[]; orders?: any[]; countryOf?: (id: any) => string } = {}): string {
  return shipmentTradeEnds(sh, ctx).direction;
}

/** v7.31.1 (owner 26 Oct, the adviser's wording for the carrier order): THE GOODS OF THIS SHIPMENT LEAVE THE EU — the shipment crosses
 *  the border itself, or it is a leg on the way out: a sale it carries is delivered outside the EU, or its booking's port of discharge
 *  is outside the EU (a truck to Koper with apples sold to Damietta). */
export function goodsLeaveTheEU(sh: any, ctx: { pos?: any[]; orders?: any[]; countryOf: (id: any) => string }): boolean {
  const outside = (id: any) => id != null && String(id) !== "" && isEU(ctx.countryOf(id)) === false;
  return shipmentTradeDirection(sh, { pos: ctx.pos, orders: ctx.orders, countryOf: ctx.countryOf }) === "EXPORT"
    || salesCarried(sh, ctx.orders || []).some((o: any) => outside(o?.destinationLocationId))
    || (sh?.bookings || []).some((b: any) => outside(b?.podId ?? b?.pod));
}
