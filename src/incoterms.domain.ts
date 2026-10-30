import { carrierOfUnit, docTypeOf } from "./shipmentModel.domain";   // v7.20.0 (A-INC-2): the review reads who a unit's carrier is and a document's type as the screens do
import { shipmentTradeDirection, shipmentEndPlaceId, shipmentStartPlaceId } from "./tradeFlow.domain";   // v7.20.0 (A-INC-2): customs are read from the direction, as in the editor
import { normalizeCustoms } from "./shipments.domain";
import { parseNum } from "./numbers";   // v7.20.0 (A-INC-2): an older shipment's customs read as the editor opens them
import { placeGroup } from "./locations";   // v7.27.14 (A-RV-38)
// ─── v7.9.0 (A-INC-1, owner ruling 8 Oct): ICC INCOTERMS® 2020 — the rules own where goods change hands ─────────────────
// Every rule carries TWO points: the DELIVERY point, where the risk passes, and the NAMED place, up to which the seller pays
// carriage. For the C-rules they differ (CFR / CIF: risk on board at the port of shipment, freight paid to the named port of
// destination; CPT / CIP: risk on handover to the first carrier, carriage paid to the named destination).
export type IncotermCode = "EXW" | "FCA" | "FAS" | "FOB" | "CFR" | "CIF" | "CPT" | "CIP" | "DAP" | "DPU" | "DDP";
export interface IncotermRule {
  code: IncotermCode; seaOnly: boolean;
  risk: string;                       // where the risk passes (delivery point), in words
  riskAt: "seller-premises" | "named-place-carrier" | "alongside-ship" | "on-board" | "first-carrier" | "destination";
  carriagePaidBy: "buyer" | "seller"; // main carriage
  costsTo: "delivery" | "named-destination";
  exportClearance: "buyer" | "seller"; importClearance: "buyer" | "seller";
  insurance: "" | "ICC (C) minimum" | "ICC (A)";
  name: string;                        // v7.22.3 (FZ-21): the official name — the one label every screen shows
  namedPlace: "seller-premises" | "origin-place" | "origin-port" | "destination-port" | "destination-place";   // what the named place IS
}
const R = (code: IncotermCode, seaOnly: boolean, riskAt: IncotermRule["riskAt"], risk: string, carriagePaidBy: "buyer" | "seller", costsTo: IncotermRule["costsTo"], exportClearance: "buyer" | "seller", importClearance: "buyer" | "seller", insurance: IncotermRule["insurance"] = ""): IncotermRule => ({ code, seaOnly, riskAt, risk, carriagePaidBy, costsTo, exportClearance, importClearance, insurance, name: INCOTERM_NAMES[code], namedPlace: NAMED_PLACE[code] });
// v7.22.3 (FZ-21, owner ruling 13 Oct): ONE TABLE FOR EVERYTHING — the official names and what each rule's named place is
const INCOTERM_NAMES: Record<string, string> = { EXW: "Ex Works", FCA: "Free Carrier", FAS: "Free Alongside Ship", FOB: "Free On Board", CFR: "Cost and Freight", CIF: "Cost, Insurance and Freight", CPT: "Carriage Paid To", CIP: "Carriage and Insurance Paid To", DAP: "Delivered at Place", DPU: "Delivered at Place Unloaded", DDP: "Delivered Duty Paid" };
const NAMED_PLACE: Record<string, IncotermRule["namedPlace"]> = { EXW: "seller-premises", FCA: "origin-place", FAS: "origin-port", FOB: "origin-port", CFR: "destination-port", CIF: "destination-port", CPT: "destination-place", CIP: "destination-place", DAP: "destination-place", DPU: "destination-place", DDP: "destination-place" };
export const INCOTERMS_2020: Record<IncotermCode, IncotermRule> = {
  EXW: R("EXW", false, "seller-premises", "at the seller's premises, not loaded", "buyer", "delivery", "buyer", "buyer"),
  FCA: R("FCA", false, "named-place-carrier", "handed to the buyer's carrier at the named place", "buyer", "delivery", "seller", "buyer"),
  FAS: R("FAS", true, "alongside-ship", "alongside the vessel at the port of shipment", "buyer", "delivery", "seller", "buyer"),
  FOB: R("FOB", true, "on-board", "on board the vessel at the port of shipment", "buyer", "delivery", "seller", "buyer"),
  CFR: R("CFR", true, "on-board", "on board the vessel at the port of shipment", "seller", "named-destination", "seller", "buyer"),
  CIF: R("CIF", true, "on-board", "on board the vessel at the port of shipment", "seller", "named-destination", "seller", "buyer", "ICC (C) minimum"),
  CPT: R("CPT", false, "first-carrier", "handed to the first carrier", "seller", "named-destination", "seller", "buyer"),
  CIP: R("CIP", false, "first-carrier", "handed to the first carrier", "seller", "named-destination", "seller", "buyer", "ICC (A)"),
  DAP: R("DAP", false, "destination", "at the named place, ready for unloading", "seller", "named-destination", "seller", "buyer"),
  DPU: R("DPU", false, "destination", "at the named place, unloaded", "seller", "named-destination", "seller", "buyer"),
  DDP: R("DDP", false, "destination", "at the named place, ready for unloading", "seller", "named-destination", "seller", "seller"),
};
export function ruleOf(code: any): IncotermRule | null { const k = String(code || "").trim().toUpperCase() as IncotermCode; return (INCOTERMS_2020 as any)[k] || null; }

// ── v7.22.3 (FZ-21, owner ruling 13 Oct): every incoterm question on every screen is answered HERE, from the table above. ──
// A term that is not one of the 11 Incoterms 2020 rules (an old DAT, a typo) is not read at all: the terms review names it on its
// PO or SO and the user picks the right rule; the forms show it as "outdated — choose again".
export const INCOTERM_CODES: IncotermCode[] = Object.keys(INCOTERMS_2020) as IncotermCode[];
export const isIncoterm2020 = (code: any): boolean => !!ruleOf(code);
export const incotermLabel = (code: any): string => { const r = ruleOf(code); return r ? `${r.code} — ${r.name}` : String(code || ""); };
/** EXW / FCA: the goods are taken at the seller's side — on a purchase, at the supplier's site by default. */
export const takenAtSeller = (code: any): boolean => ["seller-premises", "origin-place"].includes(String(ruleOf(code)?.namedPlace || ""));
/** FCA / FAS / FOB: the named place is where the goods leave — a port there is the port of loading. */
export const namedPlaceIsOrigin = (code: any): boolean => ["origin-place", "origin-port"].includes(String(ruleOf(code)?.namedPlace || ""));
/** C- and D-rules: the seller arranges and pays the main carriage. */
export const sellerPaysCarriage = (code: any): boolean => ruleOf(code)?.carriagePaidBy === "seller";
/** D-rules: the goods are delivered at the named destination (risk passes there). */
export const deliveredAtDestination = (code: any): boolean => ruleOf(code)?.riskAt === "destination";
/** C-rules: carriage paid to the destination, risk passed earlier. */
export const carriagePaidToDestination = (code: any): boolean => { const r = ruleOf(code); return !!r && r.carriagePaidBy === "seller" && r.riskAt !== "destination"; };
/** Where the goods come into our hands (buying) or leave them (selling), as the stock reads it. A named place that is a port
 *  counts as the port for the C- and D-rules; otherwise our warehouse (buying) or the client (selling). */
const OWNERSHIP_POINTS = ["supplier", "origin_port", "dest_port", "our_wh", "client"] as const;
export function handoverPointOf(code: any, side: "buy" | "sell", namedPlaceIsPort = false): string {
  const p = ruleOf(code)?.namedPlace; if (!p) return "";
  if (p === "seller-premises" || p === "origin-place") return "supplier";
  if (p === "origin-port") return "origin_port";
  if (p === "destination-port") return "dest_port";
  return namedPlaceIsPort ? "dest_port" : (side === "buy" ? "our_wh" : "client");
}
export function ownershipAtPoint(point: string, buyIncoterm: any, sellIncoterm: any): string {
  const order = OWNERSHIP_POINTS as readonly string[];
  const pI = order.indexOf(point), sI = order.indexOf(handoverPointOf(buyIncoterm, "buy") || "supplier"), eI = order.indexOf(handoverPointOf(sellIncoterm, "sell") || "client");
  if (pI === -1 || sI === -1 || eI === -1) return "owned";
  if (pI < sI) return "not_owned";
  if (pI > eI) return "handed_over";
  return "owned";
}
/** What to name as the place, the kinds of place to offer first, and one line of guidance — for a purchase or a sale. */
export function namedPlaceGuide(code: any, side: "buy" | "sell"): { kinds: string[]; label: string; hint: string } {
  const r = ruleOf(code);
  if (!r) return { kinds: ["SUPPLIER", "PORT", "OWN", "CLIENT"], label: "Place (choose an Incoterms 2020 rule first)", hint: code ? `"${code}" is not an Incoterms 2020 rule — choose the right one.` : "Choose the incoterm — it sets what to fill here." };
  const c = r.code, buy = side === "buy";
  switch (r.namedPlace) {
    case "seller-premises": return buy ? { kinds: ["SUPPLIER"], label: "Pickup place (supplier site)", hint: `${c} — we collect at the supplier's premises (defaults to the supplier's site).` }
                                       : { kinds: ["OWN", "SUPPLIER"], label: "Collection place", hint: `${c} — the client collects from us; we do not deliver.` };
    case "origin-place": return buy ? { kinds: ["SUPPLIER", "PORT"], label: "Hand-over place", hint: `${c} — handed to our carrier at the named place (defaults to the supplier's site).` }
                                    : { kinds: ["OWN", "PORT"], label: "Hand-over place", hint: `${c} — the place where we hand the goods to the client's carrier.` };
    case "origin-port": return { kinds: ["PORT"], label: "Port of loading", hint: `${c} — name the port of loading.` };
    case "destination-port": return { kinds: ["PORT"], label: buy ? "Port of discharge" : "Port of destination", hint: `${c} — name the port of discharge (destination port).` };
    default: return buy ? { kinds: ["OWN", "CLIENT"], label: "Delivery place", hint: `${c} — the place where the supplier's carriage ends (defaults to our warehouse; change if elsewhere).` }
                        : { kinds: ["CLIENT", "OWN"], label: "Delivery place", hint: `${c} — the client's address, or another address the client indicates.` };
  }
}
/** The one sentence under an incoterm — from the table: where the risk passes, who pays the carriage (and insures), who clears. */
export function incotermLine(code: any, side: "buy" | "sell", placeName = ""): string {
  const r = ruleOf(code); if (!r) return code ? `"${code}" is not an Incoterms 2020 rule — choose the right one.` : "";
  const us = side === "buy", other = us ? "the supplier" : "the client", at = placeName ? ` (${placeName})` : "";
  const riskTo = us ? "us" : other;
  const carriage = r.carriagePaidBy === "seller" ? `${us ? "The supplier pays" : "We pay"} the main carriage to the named place${at}${r.insurance ? ` and insure${us ? "s" : ""} it (${r.insurance})` : ""}` : `${us ? "We arrange" : "The client arranges"} and pay${us ? "" : "s"} the main carriage${r.namedPlace === "seller-premises" ? "" : ` from the named place${at}`}`;
  const who = (x: "buyer" | "seller") => x === "seller" ? (us ? other : "us") : (us ? "us" : other);
  return `${r.code} — the risk passes to ${riskTo} ${r.risk}. ${carriage}. Export clearance by ${who(r.exportClearance)}; import clearance by ${who(r.importClearance)}.`;
}

/** v7.9.2 (A-INC-1): EMPTY places on a shipment filled from their owners — the goods' location (origin), the booking's ports
 *  (POL / POD) and the governing sale's named place (destination). Never overwrites a place someone set. */
export function fillEmptyPlaces(sh: any, ctx: { orders?: any[]; lots?: any[] }): { next: any; filled: string[] } {
  const filled: string[] = []; if (!sh) return { next: sh, filled };
  const empty = (v: any) => v == null || v === "";
  const bk = (sh.bookings || [])[0] || {}; const pol = bk.polId ?? null, pod = bk.podId ?? null;
  const soNo = sh.governingSoRef || (sh.soRefs || [])[0]; const so = (ctx.orders || []).find((o: any) => String(o.number) === String(soNo));
  const dest = so?.destinationLocationId ?? null;
  const firstLot = (sh.goods || []).map((g: any) => (ctx.lots || []).find((l: any) => String(l.number) === String(g.lotRef))).find((l: any) => l && l.locationId != null);
  const origin = firstLot ? firstLot.locationId : null;
  const next = { ...sh, legs: (sh.legs || []).map((l: any) => ({ ...l })) };
  const set = (o: any, k: string, v: any, what: string) => { if (empty(o[k]) && !empty(v)) { o[k] = v; filled.push(what); } };
  set(next, "originLocationId", origin, "origin from the goods' location"); set(next, "destinationLocationId", dest, "destination from the sale's named place");
  const seaIdx = next.legs.findIndex((l: any) => String(l.mode) === "Sea");
  next.legs.forEach((l: any, i: number) => {
    const nth = `leg ${i + 1}`;
    if (String(l.mode) === "Sea") { set(l, "fromLocationId", pol, `${nth} from the booking's port of loading`); set(l, "toLocationId", pod ?? dest, `${nth} to the booking's port of discharge`); return; }
    if (seaIdx >= 0 && i < seaIdx) { set(l, "fromLocationId", origin, `${nth} from the goods' location`); set(l, "toLocationId", pol, `${nth} to the port of loading`); return; }
    if (seaIdx >= 0 && i > seaIdx) { set(l, "fromLocationId", pod, `${nth} from the port of discharge`); set(l, "toLocationId", dest, `${nth} to the sale's named place`); return; }
    set(l, "fromLocationId", origin, `${nth} from the goods' location`); set(l, "toLocationId", dest, `${nth} to the sale's named place`);
  });
  return { next: filled.length ? next : sh, filled };
}

// ─── v7.19.0 (A-INC-1, 1/5 — owner 8 Oct: 'the simple key is the incoterm on PO and SO'): WHO PAYS EACH LEG'S FREIGHT ──────
// Never typed: the PURCHASE term covers the legs up to the PO's named place (the seller's carriage — C- and D-rules up to it,
// FAS / FOB to the port of shipment, FCA to the named place, EXW nothing); the SALE term covers the legs after our handover
// (EXW all of them, FCA after the named place, FAS / FOB from the vessel, CFR / CIF after the port of destination, CPT / CIP /
// D-rules after the named place). Every other leg is ours. Goods that START at the PO's named place are past the supplier's
// part; goods coming TO US (an inbound shipment, the supplier's truck) are before the sale's. Only legs that are ours make a
// freight cost line; a line already on a leg that is not ours is flagged, never deleted.
export type FreightPayer = "us" | "supplier" | "client";
export interface LegFreight { payer: FreightPayer; term: string; doc: string; why: string; }
export const PAYER_LABEL: Record<FreightPayer, string> = { us: "ours", supplier: "the supplier's", client: "the client's" };
const up = (v: any) => String(v ?? "").trim().toUpperCase();
const sameId = (a: any, b: any) => a != null && a !== "" && b != null && b !== "" && String(a) === String(b);
const SEA_F = ["FAS", "FOB"], SEA_C = ["CFR", "CIF"];
/** The PO whose goods a shipment carries (its first PO reference). */
function poOfShipment(sh: any, pos: any[] = []): any { const refs = (sh?.poRefs || []).map(String); return (pos || []).find((p: any) => refs.includes(String(p?.number))) || null; }
/** The sale a shipment delivers: its governing sale, else its only sale; several sales and no governing one → none. */
function saleOfShipment(sh: any, orders: any[] = []): any {
  const g = String(sh?.governingSoRef || "").trim();
  const refs = g ? [g] : Array.from(new Set((sh?.soRefs || []).map(String).filter(Boolean))) as string[];
  return refs.length === 1 ? (orders || []).find((o: any) => String(o?.number) === refs[0]) || null : null;
}
/** Goods coming to us: an inbound shipment or the supplier's own truck. */
function comesToUs(sh: any): boolean { return up(sh?.purpose) === "INBOUND" || up(sh?.arrangedBy) === "SUPPLIER"; }
const startOf = (sh: any) => shipmentStartPlaceId(sh);   // v7.28.7 (Batch L): the route's start first — the guessed origin 1 no longer decides
/** v7.27.14 (A-RV-38, P-12): THE GOODS STILL TRAVEL UNDER THE PURCHASE — they come to us, or the shipment does not start at the PO's
*  named place — except a truck of ours that starts at our own warehouse: the purchase ended when the stock was received there. */
function underPurchase(sh: any, po: any, pt: string, ctx: any = {}): boolean {
if (!po || !ruleOf(pt)) return false;
if (comesToUs(sh)) return true;
const start = startOf(sh);
if (sameId(start, po.destinationLocationId)) return false;
const place = ctx && ctx.placeOf && start != null ? (typeof ctx.placeOf === "function" ? ctx.placeOf(start) : null) : null;
if (place && placeGroup(place) === "OWN") return false;
return true;
}
const arriving = (legs: any[], place: any) => (place == null || place === "") ? -1 : legs.findIndex((l: any) => sameId(l?.toLocationId, place));
const firstSea = (legs: any[]) => legs.findIndex((l: any) => String(l?.mode || "") === "Sea");
const idx = (legs: any[], keep: (i: number) => boolean) => legs.map((_: any, i: number) => i).filter(keep);
/** The legs the SUPPLIER pays under the PO. */
function supplierPaidLegs(sh: any, po: any): number[] {
  const legs = sh?.legs || []; const t = up(po?.buyIncoterm); if (!po || !ruleOf(t) || !legs.length || t === "EXW") return [];
  const np = po.destinationLocationId ?? null;
  if (!comesToUs(sh) && sameId(startOf(sh), np)) return [];   // the goods start at the PO's named place: the supplier's part is behind them
  const k = arriving(legs, np); const upTo = (j: number) => idx(legs, i => i <= j);
  if (t === "FCA") return k >= 0 ? upTo(k) : [];
  if (SEA_F.includes(t)) { if (k >= 0) return upTo(k); const s = firstSea(legs); return s > 0 ? upTo(s - 1) : []; }
  if (SEA_C.includes(t)) { if (k >= 0) return upTo(k); const s = firstSea(legs); return s >= 0 ? upTo(s) : []; }
  if (k >= 0) return upTo(k);   // CPT, CIP, DAP, DPU, DDP: carriage to the named place
  return comesToUs(sh) ? upTo(legs.length - 1) : [];
}
/** The legs the CLIENT pays under the sale. */
function clientPaidLegs(sh: any, so: any): number[] {
  const legs = sh?.legs || []; const t = up(so?.sellIncoterm); if (!so || !ruleOf(t) || !legs.length || comesToUs(sh)) return [];
  const np = so.destinationLocationId ?? null; const k = arriving(legs, np); const from = (j: number) => idx(legs, i => i >= j);
  if (t === "EXW") return from(0);
  if (t === "FCA") return k >= 0 ? from(k + 1) : (np == null || np === "" || sameId(startOf(sh), np)) ? from(0) : [];
  if (SEA_F.includes(t)) { const s = firstSea(legs); return s >= 0 ? from(s) : []; }
  if (SEA_C.includes(t)) { if (k >= 0) return from(k + 1); const s = firstSea(legs); return s >= 0 ? from(s + 1) : []; }
  return k >= 0 ? from(k + 1) : [];   // CPT, CIP, DAP, DPU, DDP: ours up to the named place
}
/** Who pays each leg's freight — one answer per leg, in the legs' order. */
export function legFreightPayers(sh: any, ctx: { pos?: any[]; orders?: any[] } = {}): LegFreight[] {
  const po = poOfShipment(sh, ctx.pos), so = saleOfShipment(sh, ctx.orders);
  const sup = new Set(supplierPaidLegs(sh, po)), cli = new Set(clientPaidLegs(sh, so));
  const bought = po && ruleOf(po.buyIncoterm) ? `bought ${up(po.buyIncoterm)}` : "", sold = so && ruleOf(so.sellIncoterm) && !comesToUs(sh) ? `sold ${up(so.sellIncoterm)}` : "";
  return (sh?.legs || []).map((_: any, i: number): LegFreight => sup.has(i) ? { payer: "supplier", term: up(po.buyIncoterm), doc: String(po.number), why: bought }
    : cli.has(i) ? { payer: "client", term: up(so.sellIncoterm), doc: String(so.number), why: sold }
    : { payer: "us", term: "", doc: "", why: [bought, sold].filter(Boolean).join(" · ") });
}
/** The leg a freight cost line belongs to: its source names it (LEGCAR:i / leg-freight:n), else the first leg of its mode. */
export function freightLineLeg(c: any, legs: any[] = []): number {
  const src = String(c?.source || ""); let m = src.match(/^LEGCAR:(\d+):/); if (m) return Number(m[1]);
  m = src.match(/^leg-freight:(\d+)$/); if (m) return Number(m[1]) - 1;
  const mode = ({ road_freight: "Road", sea_freight: "Sea", air_freight: "Air", rail_freight: "Rail" } as Record<string, string>)[String(c?.type || "")];
  return mode ? (legs || []).findIndex((l: any) => String(l?.mode || "") === mode) : -1;
}
/** A freight cost line on a leg that is not ours (null when it is ours, or not a freight line). */
export function freightLineNotOurs(c: any, legs: any[], payers: LegFreight[]): { leg: number; p: LegFreight } | null {
  if (!/_freight$/.test(String(c?.type || ""))) return null; const leg = freightLineLeg(c, legs); const p = leg >= 0 ? payers[leg] : null;
  return p && p.payer !== "us" ? { leg, p } : null;
}

// ─── v7.19.1 (A-INC-1, 2/5): AN EXW SALE HAS NO OUTBOUND SHIPMENT OF OURS — the client collects (Record collection on the sale) ──
export function isExwSale(so: any): boolean { return up(so?.sellIncoterm) === "EXW"; }
/** The EXW sale an outbound shipment of ours would carry (null when none) — the client arranges that carriage. */
export function exwCarriageConflict(sh: any, orders: any[] = []): any {
  if (comesToUs(sh) || String(sh?.mode || "") === "Client pickup") return null; const so = saleOfShipment(sh, orders); return so && isExwSale(so) ? so : null;
}
// ─── v7.19.2 (A-INC-1, 3/5): A D-RULE PURCHASE COMES ON THE SUPPLIER'S TRUCK — tracked, not paid ──
export const D_RULES = ["DAP", "DPU", "DDP"];
export function isDRulePurchase(po: any): boolean { return D_RULES.includes(up(po?.buyIncoterm)); }
/** The supplier's truck: arranged by the supplier, or goods coming to us under a D-rule purchase — from the PO, never ticked. */
export function isSuppliersTruck(sh: any, pos: any[] = []): boolean { return up(sh?.arrangedBy) === "SUPPLIER" || (up(sh?.purpose) === "INBOUND" && isDRulePurchase(poOfShipment(sh, pos))); }

// ─── v7.19.3 (A-INC-1, 4/5): WHO CLEARS CUSTOMS — from the trade direction and the incoterms, never ticked ──────────────────
// Export clearance is the SELLER's unless EXW (then the buyer's); import clearance is the BUYER's unless DDP (then the seller's).
// Export is cleared where the goods start: under the purchase while they still travel under it (coming to us, or straight from
// the supplier), else under the sale. Import is cleared where they end: under the sale when they go to the client, else under
// the purchase. An intra-EU route crosses no customs border.
export interface ClearanceDuty { which: "export" | "import"; party: FreightPayer; why: string; doc: string; }
export function customsDuties(sh: any, ctx: { pos?: any[]; orders?: any[]; direction?: string; placeOf?: any } = {}): ClearanceDuty[] {
  const dir = up(ctx.direction); if (!dir || dir === "INTRA_EU") return [];
  const po = poOfShipment(sh, ctx.pos), so = saleOfShipment(sh, ctx.orders);
  const pt = up(po?.buyIncoterm), st = up(so?.sellIncoterm);
  const poSide = underPurchase(sh, po, pt, ctx);   // v7.27.14 (A-RV-38, P-12): one rule
  const soSide = !!so && !!ruleOf(st) && !comesToUs(sh);
  const out: ClearanceDuty[] = [];
  if (dir === "EXPORT" || dir === "CROSS_TRADE") out.push(poSide ? { which: "export", party: pt === "EXW" ? "us" : "supplier", why: `bought ${pt}`, doc: String(po.number) }
    : soSide ? { which: "export", party: st === "EXW" ? "client" : "us", why: `sold ${st}`, doc: String(so.number) } : { which: "export", party: "us", why: "no incoterm to say otherwise", doc: "" });
  if (dir === "IMPORT" || dir === "CROSS_TRADE") out.push(soSide ? { which: "import", party: st === "DDP" ? "us" : "client", why: `sold ${st}`, doc: String(so.number) }
    : (po && ruleOf(pt)) ? { which: "import", party: pt === "DDP" ? "supplier" : "us", why: `bought ${pt}`, doc: String(po.number) } : { which: "import", party: "us", why: "no incoterm to say otherwise", doc: "" });
  return out;
}
/** One line for the screen: "export — ours (sold CIF) · import — the client's (sold CIF)". */
export function customsDutiesText(duties: ClearanceDuty[]): string { return duties.map(x => `${x.which} — ${PAYER_LABEL[x.party]} (${x.why})`).join(" · "); }

// ─── v7.19.4 (A-INC-1, 5/5 — approved 8 Oct): CLAIMS ROUTED BY THE RISK POINT ─────────────────────────────────────────────
// For a loss in transit (damage, temperature, shortage — not a quality defect, which is the seller's warranty, nor a delay or a
// wrong delivery, which is the carrier's performance) the claim names WHERE it happened: loading, a leg, unloading. The rule of
// each contract that still governed the goods there says who carried the risk: before its delivery point the seller, after it
// the buyer. A recovery goes to the supplier while the risk was his, else to the carrier of that stage; a client's claim for a
// loss after the risk passed to him is his to claim from the carrier (or the insurance under CIF / CIP), not from us.
export const RISK_CAUSES = ["Transport damage", "Temperature deviation", "Shortage"];
export interface JourneyStage { key: string; label: string; pos: number; leg: number; }
/** The stages of a shipment's journey: loading (0), each leg (1..n), unloading (n + 1). */
export function journeyStages(sh: any): JourneyStage[] {
  const legs = sh?.legs || []; const n = legs.length;
  return [{ key: "loading", label: "At loading", pos: 0, leg: n ? 0 : -1 },
    ...legs.map((l: any, i: number) => ({ key: `leg:${i}`, label: `Leg ${i + 1} · ${l?.mode || "?"}`, pos: i + 1, leg: i })),
    { key: "unloading", label: "At unloading", pos: n + 1, leg: n ? n - 1 : -1 }];
}
/** The first stage at which the BUYER carries the risk under a term (stages before it are the seller's). */
export function riskPassPos(sh: any, term: any, namedPlace: any): number {
  const legs = sh?.legs || []; const n = legs.length; const t = up(term); const k = arriving(legs, namedPlace); const s = firstSea(legs);
  if (t === "EXW") return 0;
  if (t === "FCA") return k >= 0 ? k + 2 : 1;                      // loaded on the buyer's carrier at the named place
  // alongside / on board at the port of shipment; with no vessel in this shipment: a truck starting at the named port (after the vessel)
  // runs after the risk passed (v7.27.14, A-RV-38), any other one runs before it
  // with no vessel in this shipment: a truck starting at a C rule's named port (the port of DESTINATION) runs after the risk passed on
  // board; a FAS / FOB named port is the port of shipment — before the vessel, so the risk is still the seller's (v7.29.2: the
  // v7.27.14 shortcut had been applied to FAS / FOB too, which Incoterms 2020 does not allow)
  if (["FAS", "FOB", "CFR", "CIF"].includes(t)) return s >= 0 ? s + 1 : (SEA_C.includes(t) && sameId(startOf(sh), namedPlace) ? 0 : n + 2);
  if (["CPT", "CIP"].includes(t)) return 1;                        // handed to the first carrier
  if (t === "DPU") return (k >= 0 ? k + 2 : n + 1) + 1;            // at the named place, unloaded
  if (["DAP", "DDP"].includes(t)) return k >= 0 ? k + 2 : n + 1;   // at the named place, ready for unloading
  return -1;
}
export interface RiskAtStage { stage: JourneyStage | null; purchase: { bearer: "supplier" | "us"; term: string; doc: string; insured: boolean } | null; sale: { bearer: "us" | "client"; term: string; doc: string; insured: boolean } | null; }
/** Who carried the risk at one stage of a shipment, under the purchase and under the sale that governed the goods there. */
export function riskAtStage(sh: any, stageKey: string, ctx: { pos?: any[]; orders?: any[]; placeOf?: any } = {}): RiskAtStage {
  const stage = journeyStages(sh).find(x => x.key === stageKey) || null; if (!stage) return { stage: null, purchase: null, sale: null };
  const po = poOfShipment(sh, ctx.pos), so = saleOfShipment(sh, ctx.orders); const pt = up(po?.buyIncoterm), st = up(so?.sellIncoterm);
  const poSide = underPurchase(sh, po, pt, ctx);   // v7.27.14 (A-RV-38, P-12): one rule
  const soSide = !!so && !!ruleOf(st) && !comesToUs(sh);
  const before = (term: string, np: any) => { const p = riskPassPos(sh, term, np); return p < 0 || stage.pos < p; };
  return { stage,
    purchase: poSide ? { bearer: before(pt, po.destinationLocationId) ? "supplier" : "us", term: pt, doc: String(po.number), insured: pt === "CIF" || pt === "CIP" } : null,
    sale: soSide ? { bearer: before(st, so.destinationLocationId) ? "us" : "client", term: st, doc: String(so.number), insured: st === "CIF" || st === "CIP" } : null };
}
/** The claim's routing at that stage: the respondent a recovery goes to, and the sentence the claim shows. */
export function claimRouting(claim: any, sh: any, ctx: { pos?: any[]; orders?: any[]; contacts?: any[] } = {}): { respondent: { kind: string; contactId: any; name: string } | null; note: string; warn: boolean } | null {
  const key = claim?.lossAt?.stage; if (!sh || !key || !RISK_CAUSES.includes(String(claim?.cause || ""))) return null;
  const r = riskAtStage(sh, key, ctx); if (!r.stage) return null;
  const leg = (sh.legs || [])[r.stage.leg] || null; const unit = leg ? ((leg.vehicles || [])[0] || {}) : {};
  const cid = unit.carrierId ?? leg?.carrierId ?? leg?.forwarderId ?? sh.carrierId ?? sh.forwarderId ?? null;
  const cc = (ctx.contacts || []).find((c: any) => sameId(c?.id, cid)) || null; const roles = (cc?.roles || [cc?.type]).map((x: any) => String(x || ""));
  const carrier = { kind: roles.includes("Forwarder") ? "Forwarder" : String(leg?.mode) === "Sea" ? "ShippingLine" : "Carrier", contactId: cc?.id ?? cid ?? null, name: cc?.name || "the carrier" };
  const where = r.stage.key === "loading" ? "at loading" : r.stage.key === "unloading" ? "at unloading" : `on leg ${r.stage.leg + 1} (${leg?.mode || ""})`;
  const po = poOfShipment(sh, ctx.pos); const sup = po ? { kind: "Supplier", contactId: po.supplier?.id ?? null, name: String(po.supplier?.name || "the supplier") } : null;
  if (String(claim?.direction) === "CONCESSION") {
    if (!r.sale) return { respondent: null, note: `No sale governed the goods ${where} — the client's claim is checked against the sale's own terms.`, warn: false };
    if (r.sale.bearer === "client") return { respondent: null, warn: true, note: `Sold ${r.sale.term} (${r.sale.doc}): the risk had passed to the client before the loss ${where} — the client claims it from ${carrier.name}${r.sale.insured ? " or on the insurance we provided" : ""}, not from us.` };
    const back = r.purchase && r.purchase.bearer === "supplier" && sup ? sup.name : carrier.name;
    return { respondent: null, warn: false, note: `Sold ${r.sale.term} (${r.sale.doc}): the risk was still ours ${where} — the client's claim stands; recover it from ${back}.` };
  }
  if (r.purchase && r.purchase.bearer === "supplier" && sup) return { respondent: sup, warn: false, note: `Bought ${r.purchase.term} (${r.purchase.doc}): the risk was still the supplier's ${where} — the claim goes to ${sup.name}.` };
  return { respondent: carrier, warn: false, note: `${r.purchase ? `Bought ${r.purchase.term} (${r.purchase.doc}): the risk had passed to us` : "The goods were ours"} ${where} — the claim goes to ${carrier.name}${r.purchase?.insured ? "; the supplier insured the cargo (" + r.purchase.term + ") — claim on the policy too" : ""}.` };
}
/** The shipment a claim is about: its shipment subject, else the live shipment carrying its lot or its sale. */
export function claimShipment(claim: any, shipments: any[] = []): any {
  const subs = claim?.subjects || []; const live = (shipments || []).filter((s: any) => String(s?.status) !== "Cancelled");
  const byNo = (n: any) => live.find((s: any) => String(s.number) === String(n)) || null;
  const lossNo = claim?.lossAt?.shipment; if (lossNo && byNo(lossNo)) return byNo(lossNo);
  const sh = subs.find((x: any) => x.kind === "SHIPMENT" || x.kind === "LEG"); if (sh && byNo(sh.ref)) return byNo(sh.ref);
  const lots = subs.filter((x: any) => x.kind === "LOT").map((x: any) => String(x.ref)), sos = subs.filter((x: any) => x.kind === "SO").map((x: any) => String(x.ref));
  return live.slice().sort((a: any, b: any) => String(b.number || "").localeCompare(String(a.number || ""), undefined, { numeric: true })).find((s: any) => (s.goods || []).some((g: any) => lots.includes(String(g.lotRef)) || sos.includes(String(g.soRef))) || (s.soRefs || []).some((x: any) => sos.includes(String(x)))) || null;
}


// ═══ v7.20.0–7.20.6 (A-INC-2, owner 11 Oct — P-9: 'any inconsistency with the incoterms is flagged for review') ════════════════
// EVERY INCONSISTENCY WITH THE INCOTERMS, AND ONE PLACE TO REVIEW THEM. Each check reads the records as they are stored against
// the two terms (the PO's and the sale's); it proposes nothing, changes nothing and blocks nothing. A finding names the term, the
// document whose term it is and the record that disagrees — the person reviewing decides whether the term or the record is wrong.
//   v7.20.0  the list, with the four kinds flagged since Batch D: freight on a leg that is not ours (v7.19.0), an outbound
//            shipment of ours for an EXW sale (v7.19.1), customs marked otherwise than the terms (v7.19.3), a claim aimed
//            elsewhere than the risk point says (v7.19.4)
//   v7.20.1  a CFR / CIF named place that is not a port           v7.20.4  a shipment's places against the named places
//   v7.20.2  a CIF / CIP sale with no insurance certificate held  v7.20.5  a carrier of ours on a leg someone else pays
//   v7.20.3  a sea-only rule on a journey with no sea and no port v7.20.6  a C- or D-rule sale with no freight of ours
export type TermsKind = "freight" | "exw" | "customs" | "claim" | "port" | "insurance" | "sea" | "places" | "carrier" | "nofreight" | "outdated" | "documents" | "rule" | "journey";   // v7.27.11 (FZ-16): an expected document not held at the stage that needs it   // v7.22.3 (FZ-21): a term that is not an Incoterms 2020 rule
export interface TermsFinding { kind: TermsKind; term: string; doc: string; record: string; recordKind: "shipment" | "order" | "po" | "claim"; shipment: string; text: string; recommend?: { side: "buy" | "sell"; doc: string; to: string }; }
export interface TermsCtx { pos?: any[]; orders?: any[]; shipments?: any[]; claims?: any[]; contacts?: any[]; lots?: any[]; placeOf?: (id: any) => any; countryOf?: (id: any) => string; }
const TERMS_KINDS: TermsKind[] = ["outdated", "port", "nofreight", "exw", "freight", "carrier", "customs", "insurance", "documents", "sea", "places", "claim", "rule", "journey"];
export const TERMS_KIND_LABEL: Record<TermsKind, string> = { journey: "the sale's whole journey across its shipments", rule: "the rule that fits what the shipment records", documents: "expected document missing", freight: "freight on a leg not ours", exw: "shipment of ours, sold EXW", customs: "customs", claim: "claim routing", port: "named place not a port", insurance: "no insurance certificate", sea: "sea rule, no sea leg", places: "places off the named place", carrier: "carrier on a leg not ours", nofreight: "no freight of ours", outdated: "not an Incoterms 2020 rule" };
const S0 = (v: any) => String(v ?? "").trim();
const known = (v: any) => v != null && v !== "";
const num0 = (v: any) => parseNum(v);   // numbers.parseNum — the one way to read a typed number (AUD-11)
const liveRec = (x: any) => !!x && !x.deleted && S0(x.status) !== "Cancelled";
const sideWord = (side: "buy" | "sell") => side === "buy" ? "Bought" : "Sold";
const termOfWhy = (why: string) => { const m = S0(why).match(/^(?:sold|bought) ([A-Z]{3})$/); return m ? m[1] : ""; };
const placeOfCtx = (ctx: TermsCtx, id: any) => (known(id) && ctx.placeOf ? ctx.placeOf(id) || null : null);
const placeName = (ctx: TermsCtx, id: any) => { const l = placeOfCtx(ctx, id); return l ? S0(l.name) : known(id) ? `place ${id}` : "—"; };
const contactName = (ctx: TermsCtx, id: any) => S0(((ctx.contacts || []).find((c: any) => sameId(c?.id, id)) || {}).name) || `company ${id}`;
const money = (c: any) => `${num0(c?.amount).toLocaleString("pl-PL")} ${S0(c?.currency)}`.trim();
const endOf = (sh: any) => shipmentEndPlaceId(sh);   // v7.27.13 (P-12): the route's end first — the header field only without legs
const SEA_ONLY = ["FAS", "FOB", "CFR", "CIF"];
export const C_RULES = ["CFR", "CIF", "CPT", "CIP"];
/** A place that is a port — of the type Port, or a port warehouse / terminal. Read on the type: the legacy word "PORT" is also
 *  given to airports and to every place of an unlisted type ("Other"), so it does not say "port". */
export function isPortPlace(loc: any): boolean { if (!loc) return false; return ["Port", "PortWarehouse"].includes(S0(loc.placeType || loc.type)); }   // v7.27.3 (FZ-26): by the type only
/** Every sale a shipment carries — its governing sale, its header references and its goods rows (cancelled sales left out). */
export function salesCarried(sh: any, orders: any[] = []): any[] {
  const refs = Array.from(new Set([S0(sh?.governingSoRef), ...(sh?.soRefs || []).map(S0), ...(sh?.goods || []).map((g: any) => S0(g?.soRef))].filter(Boolean)));
  return refs.map(n => (orders || []).find((o: any) => S0(o?.number) === n)).filter(liveRec);
}

// ── v7.20.1 (A-INC-2, 1): CFR / CIF name the PORT of destination ────────────────────────────────────────────────────────────
/** A CFR / CIF named place that is not a port — a place of another type, or an address typed with no place behind it. */
export function namedPlaceNotPort(doc: any, side: "buy" | "sell", ctx: TermsCtx = {}): { term: string; place: string; typed: boolean } | null {
  const t = up(side === "buy" ? doc?.buyIncoterm : doc?.sellIncoterm); if (!SEA_C.includes(t)) return null;
  const id = doc?.destinationLocationId, typed = S0(doc?.destinationText);
  if (known(id)) { const l = placeOfCtx(ctx, id); if (!l) return null; return isPortPlace(l) ? null : { term: t, place: S0(l.name) || typed, typed: false }; }
  return typed ? { term: t, place: typed, typed: true } : null;
}
// ── v7.20.2 (A-INC-2, 2): under CIF / CIP the seller — we — insures the cargo (ICC (C) minimum under CIF, (A) under CIP) ──────
// -- v7.27.11 (FZ-16, P-8 / P-9 / P-11): THE DOCUMENTS A SHIPMENT NEEDS, FROM ITS TERMS, ITS MODES AND WHERE IT GOES ----------------
// Read, never typed: the packing list always; our sales invoice with the goods we sell; the B/L for a sea leg, the AWB for an air
// leg (the CMR is captured per truck); the export declaration when we clear the export, and the phytosanitary certificate,
// certificate of origin and EUR.1 for a destination outside the EU; the import declaration when we clear an import, with the
// phyto and certificate of origin of goods from outside the EU; the T1 when the goods travel under transit; the insurance
// certificate when we sold CIF / CIP. The person records only that a document is held ('Have it', or sent).
export interface ExpectedDoc { type: string; why: string; stage: "loading" | "arrival"; held: boolean }
const HELD = ["Have it", "Sent", "N/A", "Not bought"];   // v7.29.1 (FZ-39): an insurance not bought is a fact, not a missing paper
const SYSTEM_EQUIV: Record<string, string[]> = { "Export declaration": ["Export declaration (EAD)"], "Import declaration": ["Customs declaration copy (SAD)"] };
function documentHeld(sh: any, type: string): boolean {
  const kinds = [type, ...(SYSTEM_EQUIV[type] || [])];
  return (sh?.documents || []).some((d: any) => (!!d && kinds.includes(docTypeOf(d.type).type) && HELD.includes(S0(d.status))) || (!!d && kinds.slice(1).includes(S0(d.type))));
}
export function expectedDocuments(sh: any, ctx: TermsCtx = {}): ExpectedDoc[] {
  if (!sh || !liveRec(sh)) return [];
  const out: ExpectedDoc[] = [];
  const add = (type: string, why: string, stage: "loading" | "arrival" = "loading", orAlso: string[] = []) => { if (!out.some(x => x.type === type)) out.push({ type, why, stage, held: documentHeld(sh, type) || orAlso.some(a => documentHeld(sh, a)) }); };
  const countryOf = ctx.countryOf || (ctx.placeOf ? (id: any) => S0((placeOfCtx(ctx, id) || {}).country) : null);
  const dir = countryOf ? shipmentTradeDirection(sh, { pos: ctx.pos, orders: ctx.orders, countryOf }) : "";
  const weClear = dir ? customsDuties(sh, { pos: ctx.pos, orders: ctx.orders, direction: dir, placeOf: ctx.placeOf }).some(x => x.party === "us") : false;
  const modes = new Set([...(sh.legs || []).map((l: any) => S0(l?.mode)), S0(sh.mode)].filter(Boolean));
  add("Packing list", "every shipment");
  const sales = salesCarried(sh, ctx.orders || []);
  if (!comesToUs(sh) && sales.length) add("Invoice", "our sales invoice travels with the goods");
  if (modes.has("Sea")) add("BL", "a sea leg"); if (modes.has("Air")) add("AWB", "an air leg");
  if (dir === "EXPORT") { if (weClear) add("Export declaration", "we clear the export"); ["Phytosanitary certificate", "Certificate of origin", "EUR.1"].forEach(x => add(x, "a destination outside the EU", "arrival")); }
  // an import proves its origin with the EUR.1 or a certificate of origin — either one is enough
  if (dir === "IMPORT") { if (weClear) add("Import declaration", "we clear the import", "arrival"); add("Phytosanitary certificate", "goods from outside the EU", "arrival"); add("Certificate of origin", "goods from outside the EU (or their EUR.1)", "arrival", ["EUR.1"]); }
  const c: any = normalizeCustoms(sh.customs || sh.customsClearance) || {};
  if (c.transit === true || /transit|\bT1\b/i.test(S0(c.procedure))) add("T1 transit", "the goods travel under transit");
  if (sales.some((o: any) => ["CIF", "CIP"].includes(up(o?.sellIncoterm)))) add(INSURANCE_DOC, "sold CIF / CIP — we insure the cargo");
  { const p0 = poOfShipment(sh, ctx.pos); if (comesToUs(sh) && p0 && ["CIF", "CIP"].includes(up(p0.buyIncoterm))) add(INSURANCE_DOC, `bought ${up(p0.buyIncoterm)} — the supplier insures the cargo for us and sends the certificate`, "arrival"); }   // v7.29.2 (Incoterms 2020 A5)
  return out;
}
/** The expected documents not held at the stage that needs them — loaded: what travels with the truck; arrived: the rest. */
export function documentsMissingAtStage(sh: any, ctx: TermsCtx = {}): ExpectedDoc[] {
  const st = S0(sh?.status); const loaded = ["Loaded", "In transit", "In Transit", "Arrived", "Delivered", "Closed"].includes(st); const arrived = ["Arrived", "Delivered", "Closed"].includes(st);
  return expectedDocuments(sh, ctx).filter(x => !x.held && x.type !== INSURANCE_DOC && (x.stage === "loading" ? loaded : arrived));
}
const INSURANCE_DOC = "Insurance certificate";
/** Does the shipment hold an insurance certificate (on its document list, had or sent)? */
function holdsInsurance(sh: any): boolean { return (sh?.documents || []).some((d: any) => docTypeOf(d?.type).type === INSURANCE_DOC && ["Have it", "Sent"].includes(S0(d?.status))); }
/** The CIF / CIP sales an outbound shipment of ours carries while it holds no insurance certificate. */
/** v7.29.1 (FZ-39): THE INSURANCE THE SHIPMENT RECORDS — insured (the certificate is held or sent), not insured (marked "Not bought"),
 *  or not recorded yet. Insurance is decided shipment by shipment. */
function insuranceRecorded(sh: any): "insured" | "not insured" | "" {
  const docs = (sh?.documents || []).filter((d: any) => docTypeOf(d?.type).type === INSURANCE_DOC);
  if (docs.some((d: any) => ["Have it", "Sent"].includes(S0(d?.status)))) return "insured";
  return docs.some((d: any) => S0(d?.status) === "Not bought") ? "not insured" : "";
}
// v7.29.1 (FZ-41, owner 20 Oct: "Let us stick to the incoterms without changes … in case CIF and no insurance is selected, system should
// recommend CFR as new basis … in case user mixes the terms system should recommend the correct one"): THE RULE THAT FITS WHAT THE
// SHIPMENT RECORDS. Incoterms 2020 as written — each rule's twin differs in one duty only: the insurance (CIF / CFR, CIP / CPT), the
// import clearance (DDP / DAP), the export clearance (FCA / EXW). Nothing is changed by itself; the team changes the document.
const WITHOUT_INSURANCE: Record<string, string> = { CIF: "CFR", CIP: "CPT" };
const WITH_INSURANCE: Record<string, string> = { CFR: "CIF", CPT: "CIP" };
export interface RuleFit { side: "buy" | "sell"; doc: string; from: string; to: string; why: string }
export function ruleRecommendations(sh: any, ctx: { pos?: any[]; orders?: any[]; direction?: string; placeOf?: any } = {}): RuleFit[] {
  if (!liveRec(sh)) return [];
  const out: RuleFit[] = []; const po = poOfShipment(sh, ctx.pos), so = saleOfShipment(sh, ctx.orders);
  const pt = up(po?.buyIncoterm), st = up(so?.sellIncoterm); const toUs = comesToUs(sh);
  const add = (side: "buy" | "sell", doc: any, from: string, to: string, why: string) => { if (doc && from && to && from !== to) out.push({ side, doc: S0(doc.number), from, to, why }); };
  const ins = insuranceRecorded(sh);
  if (so && !toUs && ins === "not insured" && WITHOUT_INSURANCE[st]) add("sell", so, st, WITHOUT_INSURANCE[st], "the shipment records no insurance bought");
  if (so && !toUs && ins === "insured" && WITH_INSURANCE[st]) add("sell", so, st, WITH_INSURANCE[st], "the shipment holds an insurance certificate we bought for the client");
  if (po && toUs && ins === "not insured" && WITHOUT_INSURANCE[pt]) add("buy", po, pt, WITHOUT_INSURANCE[pt], "the supplier provided no insurance");
  // v7.29.2: under a C or D rule we contract the carriage; when the client collects, the rule that fits is FCA (handed to his carrier)
  if (so && !toUs && S0(sh?.mode) === "Client pickup" && (C_RULES.includes(st) || D_RULES.includes(st))) add("sell", so, st, "FCA", "the client collects the goods with his own carrier");
  const c: any = normalizeCustoms(sh.customs || sh.customsClearance) || {};
  if (c.applies && S0(c.party)) {
    const dir = up(ctx.direction); const doc = up(c.docType);
    const which = doc === "EX1" ? "export" : doc === "SAD" ? "import" : dir === "EXPORT" ? "export" : dir === "IMPORT" ? "import" : "";
    const by = ["OUR_BROKER", "FORWARDER"].includes(up(c.party)) ? "us" : up(c.party) === "CLIENT_BROKER" ? "client" : up(c.party) === "SUPPLIER" ? "supplier" : "";
    const poSide = !!po && (toUs || underPurchase(sh, po, pt, ctx)); const soSide = !!so && !toUs;
    if (which === "import" && poSide && by === "supplier" && pt === "DAP") add("buy", po, pt, "DDP", "the import is cleared by the supplier");
    if (which === "import" && poSide && by === "us" && pt === "DDP") add("buy", po, pt, "DAP", "the import is cleared by us");
    if (which === "export" && poSide && by === "supplier" && pt === "EXW") add("buy", po, pt, "FCA", "the export is cleared by the supplier");
    if (which === "export" && poSide && by === "us" && pt === "FCA") add("buy", po, pt, "EXW", "the export is cleared by us");
    if (which === "import" && soSide && by === "us" && st === "DAP") add("sell", so, st, "DDP", "the import is cleared by us");
    if (which === "import" && soSide && by === "client" && st === "DDP") add("sell", so, st, "DAP", "the import is cleared by the client's broker");
    if (which === "export" && soSide && by === "us" && st === "EXW") add("sell", so, st, "FCA", "the export is cleared by us");
    if (which === "export" && soSide && by === "client" && st === "FCA") add("sell", so, st, "EXW", "the export is cleared by the client's broker");
  }
  return out;
}
export function insuranceMissing(sh: any, orders: any[] = []): any[] {
if (!liveRec(sh) || comesToUs(sh) || S0(sh?.mode) === "Client pickup" || holdsInsurance(sh) || insuranceRecorded(sh) === "not insured") return [];   // not bought: the rule recommendation speaks
  return salesCarried(sh, orders).filter((o: any) => ["CIF", "CIP"].includes(up(o?.sellIncoterm)));
}
// ── v7.20.3 (A-INC-2, 3): FAS / FOB / CFR / CIF are for sea transport only ──────────────────────────────────────────────────
/** A sea-only rule on a journey with no sea leg and no port on its way (a sea leg run by the other side starts or ends at a
 *  port, so a journey touching a port is not flagged). Read on the shipment that brings the goods to us (the purchase's term)
 *  and on the shipment of ours that carries them to the client (the sale's term). */
export function seaRuleWithoutSea(sh: any, ctx: TermsCtx = {}): Array<{ side: "buy" | "sell"; term: string; doc: string }> {
  const legs = sh?.legs || []; if (!liveRec(sh) || !legs.length || firstSea(legs) >= 0 || String(sh?.mode || "") === "Sea") return [];
  if ((sh?.bookings || []).some((b: any) => known(b?.polId) || known(b?.podId) || S0(b?.pol) || S0(b?.pod))) return [];
  const ids = [shipmentStartPlaceId(sh), shipmentEndPlaceId(sh), ...legs.flatMap((l: any) => [l?.fromLocationId, l?.toLocationId, ...(l?.vehicles || []).flatMap((u: any) => [u?.pickupLocationId, u?.deliveryLocationId])])].filter(known);
  if (ids.some(id => isPortPlace(placeOfCtx(ctx, id)))) return [];
  const out: Array<{ side: "buy" | "sell"; term: string; doc: string }> = [];
  const po = poOfShipment(sh, ctx.pos), so = saleOfShipment(sh, ctx.orders);
  if (po && comesToUs(sh) && SEA_ONLY.includes(up(po.buyIncoterm))) out.push({ side: "buy", term: up(po.buyIncoterm), doc: S0(po.number) });
  if (so && !comesToUs(sh) && SEA_ONLY.includes(up(so.sellIncoterm))) out.push({ side: "sell", term: up(so.sellIncoterm), doc: S0(so.number) });
  return out;
}
// ── v7.20.4 (A-INC-2, 4): the shipment's places against the named places ─────────────────────────────────────────────────────
// EXW / FCA purchase: the goods are handed to us at the PO's named place, so the shipment that collects them from the supplier
// (coming to us, or straight to the client) starts there. D-rules: the carriage ends at the named place — the supplier's truck
// at the PO's, ours at the sale's (unless another shipment of ours finishes that sale's journey there). CFR / CIF: the sea leg
// arrives at the named port. Only places that are set are compared — an empty one is filled from its owner (v7.9.2).
export interface PlaceOff { side: "buy" | "sell"; term: string; doc: string; what: "start" | "end" | "sea"; named: any; actual: any; }
export function placesOffTerms(sh: any, ctx: TermsCtx = {}): PlaceOff[] {
  const legs = sh?.legs || []; if (!liveRec(sh) || !legs.length) return [];
  const out: PlaceOff[] = []; const po = poOfShipment(sh, ctx.pos), so = saleOfShipment(sh, ctx.orders);
  const pt = up(po?.buyIncoterm), st = up(so?.sellIncoterm); const start = startOf(sh), end = endOf(sh);
  const seaArr = (() => { const s = legs.map((l: any, i: number) => String(l?.mode || "") === "Sea" ? i : -1).filter((i: number) => i >= 0); if (!s.length) return null; const l = legs[s[s.length - 1]]; return l?.toLocationId ?? (sh?.bookings || [])[0]?.podId ?? null; })();
  if (po && ["EXW", "FCA"].includes(pt) && known(po.destinationLocationId) && known(start)) {
    const lotsHere = (sh?.goods || []).map((g: any) => (ctx.lots || []).find((l: any) => S0(l?.number) === S0(g?.lotRef))).filter(Boolean);
    const direct = lotsHere.length > 0 && lotsHere.every((l: any) => !!l.directFlow || /direct/i.test(S0(l.status)));
    const named = (sh?.poRefs || []).map((n: any) => (ctx.pos || []).find((p: any) => S0(p?.number) === S0(n))).filter(Boolean).map((p: any) => p.destinationLocationId);
    if ((comesToUs(sh) || direct) && !named.some((np: any) => sameId(np, start))) out.push({ side: "buy", term: pt, doc: S0(po.number), what: "start", named: po.destinationLocationId, actual: start });
  }
  if (po && D_RULES.includes(pt) && comesToUs(sh) && known(po.destinationLocationId) && known(end) && !sameId(end, po.destinationLocationId)) out.push({ side: "buy", term: pt, doc: S0(po.number), what: "end", named: po.destinationLocationId, actual: end });
  if (so && !comesToUs(sh) && D_RULES.includes(st) && known(so.destinationLocationId) && known(end) && !sameId(end, so.destinationLocationId)) {
    const finished = (ctx.shipments || []).some((x: any) => x !== sh && S0(x?.number) !== S0(sh?.number) && liveRec(x) && !comesToUs(x) && salesCarried(x, ctx.orders).some((o: any) => S0(o.number) === S0(so.number)) && sameId(endOf(x), so.destinationLocationId));
    if (!finished) out.push({ side: "sell", term: st, doc: S0(so.number), what: "end", named: so.destinationLocationId, actual: end });
  }
  const portNamed = (doc: any) => known(doc?.destinationLocationId) && (!ctx.placeOf || isPortPlace(placeOfCtx(ctx, doc.destinationLocationId)));
  if (so && !comesToUs(sh) && SEA_C.includes(st) && known(seaArr) && portNamed(so) && !sameId(seaArr, so.destinationLocationId)) out.push({ side: "sell", term: st, doc: S0(so.number), what: "sea", named: so.destinationLocationId, actual: seaArr });
  if (po && comesToUs(sh) && SEA_C.includes(pt) && known(seaArr) && portNamed(po) && !sameId(seaArr, po.destinationLocationId)) out.push({ side: "buy", term: pt, doc: S0(po.number), what: "sea", named: po.destinationLocationId, actual: seaArr });
  return out;
}
// ── v7.20.5 (A-INC-2, 5): a carrier of ours on a leg the supplier or the client pays — a transport order would go out to it ────
/** Every carrier a unit names (as the transport orders read it) on a leg whose freight is not ours. */
export function carrierOnOthersLeg(sh: any, ctx: TermsCtx = {}): Array<{ leg: number; carrierId: any; p: LegFreight }> {
  if (!liveRec(sh)) return []; const payers = legFreightPayers(sh, ctx); const out: Array<{ leg: number; carrierId: any; p: LegFreight }> = [];
  (sh?.legs || []).forEach((l: any, i: number) => {
    const p = payers[i]; if (!p || p.payer === "us") return; const seen = new Set<string>();
    const units = (l?.vehicles || []).length ? l.vehicles : [l];   // an older leg without units names its carrier on the leg itself
    units.forEach((u: any) => { const c = carrierOfUnit(sh, l, u); if (!known(c) || seen.has(String(c))) return; seen.add(String(c)); out.push({ leg: i, carrierId: c, p }); });
  });
  return out;
}
// ── v7.20.6 (A-INC-2, 6): under a C- or D-rule sale we pay the carriage to the named place ──────────────────────────────────────
/** A C- or D-rule sale whose shipments of ours carry no freight of ours: no freight line (with an amount) and no unit price on
 *  any leg that is ours. A sale with no shipment of ours yet, or whose legs the supplier pays (bought to the same place), is not
 *  flagged. */
/** v7.29.4 (FZ-37): THE SALE'S WHOLE JOURNEY — read across all the shipments that deliver it (a transshipment is a truck to the port
 *  warehouse and a container on the vessel, two records): under CFR / CIF one of them must carry the sea leg to the named port; under a
 *  D rule, CPT or CIP one of them must reach the named place. A single shipment is already checked against the named place on its own;
 *  this check reads the shipments together. Silent until a shipment exists and while the sale names no place. */
export function saleJourneyGap(so: any, ctx: TermsCtx = {}): { term: string; shipments: string[]; need: "sea" | "place" } | null {
  const t = up(so?.sellIncoterm); const r = ruleOf(t); if (!liveRec(so) || !r || r.carriagePaidBy !== "seller" || !known(so?.destinationLocationId)) return null;
  const mine = (ctx.shipments || []).filter((sh: any) => liveRec(sh) && !comesToUs(sh) && S0(sh?.mode) !== "Client pickup" && salesCarried(sh, ctx.orders).some((o: any) => S0(o.number) === S0(so.number)));
  if (!mine.length) return null;
  const legs = mine.flatMap((sh: any) => (sh.legs || []).filter((l: any) => l));
  if (r.seaOnly) return legs.some((l: any) => S0(l.mode) === "Sea" && sameId(l.toLocationId, so.destinationLocationId)) ? null : { term: t, shipments: mine.map((s: any) => S0(s.number)), need: "sea" };
  if (mine.length < 2) return null;
  return legs.some((l: any) => sameId(l.toLocationId, so.destinationLocationId)) ? null : { term: t, shipments: mine.map((s: any) => S0(s.number)), need: "place" };
}
export function saleWithoutOurFreight(so: any, ctx: TermsCtx = {}): { term: string; shipments: string[] } | null {
  const t = up(so?.sellIncoterm); if (!liveRec(so) || !(C_RULES.includes(t) || D_RULES.includes(t))) return null;
  const mine = (ctx.shipments || []).filter((sh: any) => liveRec(sh) && !comesToUs(sh) && S0(sh?.mode) !== "Client pickup" && salesCarried(sh, ctx.orders).some((o: any) => S0(o.number) === S0(so.number)));
  if (!mine.length) return null;
  let ourLegs = 0, paid = false;
  mine.forEach((sh: any) => {
    const payers = legFreightPayers(sh, ctx);
    (sh.legs || []).forEach((l: any, i: number) => { if ((payers[i] || {}).payer !== "us") return; ourLegs++; if ((l?.vehicles || []).some((u: any) => num0(u?.costAmount) > 0)) paid = true;   /* v7.28.9: the trucks own the price */ });
    (sh.costs || []).forEach((c: any) => { if (/_freight$/.test(S0(c?.type)) && num0(c?.amount) > 0 && !freightLineNotOurs(c, sh.legs || [], payers)) paid = true; });
  });
  return ourLegs > 0 && !paid ? { term: t, shipments: mine.map((s: any) => S0(s.number)) } : null;
}

// ── v7.20.0 (A-INC-2): ONE LIST ──────────────────────────────────────────────────────────────────────────────────────────────
/** What one shipment disagrees with — every check that reads a single shipment (the editor runs it on its draft). */
export function shipmentTermsFindings(sh: any, ctx: TermsCtx = {}): TermsFinding[] {
  if (!liveRec(sh)) return []; const no = S0(sh.number); const out: TermsFinding[] = [];
  const f = (kind: TermsKind, term: string, doc: string, text: string) => out.push({ kind, term, doc, record: no, recordKind: "shipment", shipment: no, text });
  const payers = legFreightPayers(sh, ctx);
  (sh.costs || []).forEach((c: any) => { const n = freightLineNotOurs(c, sh.legs || [], payers); if (n) f("freight", n.p.term, n.p.doc, `Leg ${n.leg + 1}'s freight is ${PAYER_LABEL[n.p.payer]} (${n.p.why}) — this shipment holds a ${S0(c.type).replace(/_/g, " ")} line of ${money(c)}. Recharged to them, or is the incoterm wrong?`); });
  const exw = exwCarriageConflict(sh, ctx.orders || []); if (exw) f("exw", "EXW", S0(exw.number), "Sold EXW — the client arranges and pays the carriage, yet this is an outbound shipment of ours. If the client collected, record it on the sale.");
  const countryOf = ctx.countryOf || (ctx.placeOf ? (id: any) => S0((placeOfCtx(ctx, id) || {}).country) : null);
  const direction = countryOf ? shipmentTradeDirection(sh, { pos: ctx.pos, orders: ctx.orders, countryOf }) : "";
  if (direction) {
    const duties = customsDuties(sh, { pos: ctx.pos, orders: ctx.orders, direction, placeOf: ctx.placeOf }); const ours = duties.some(x => x.party === "us");
    const key = duties.find(x => ours ? x.party === "us" : x.party !== "us") || null; const tm = key ? termOfWhy(key.why) : "", dc = key ? key.doc : "";
    const c = normalizeCustoms(sh.customs || sh.customsClearance) || {}; const said = duties.length ? ` (${customsDutiesText(duties)})` : "";
    if (!!c.applies !== ours) f("customs", tm, dc, `${c.applies ? "Marked 'customs applies'" : "Not marked for customs"}, but under the terms ${ours ? "we clear" : duties.length ? "the other side clears" : "nothing is cleared"}${said}. Saving the shipment follows the terms.`);
    if (!ours) (sh.costs || []).filter((x: any) => S0(x?.type) === "customs").forEach((x: any) => f("customs", tm, dc, `A customs cost line of ${money(x)}, but customs is not ours under the terms${said || " (no customs border on this route)"}. Recharged, or is the incoterm wrong?`));
  }
  { // v7.27.11 (FZ-16): named by the sale (or purchase) the shipment serves, like every line of the list
  const keyDoc = S0(sh.governingSoRef || (sh.soRefs || [])[0] || (sh.poRefs || [])[0] || no);
  const so = (ctx.orders || []).find((o: any) => S0(o?.number) === keyDoc); const po = (ctx.pos || []).find((p: any) => S0(p?.number) === keyDoc);
  const keyTerm = up(so?.sellIncoterm || po?.buyIncoterm || "") || "—";
  documentsMissingAtStage(sh, ctx).forEach(x => f("documents", keyTerm, keyDoc, `${x.type} not held — expected for ${x.why} (${x.stage === "loading" ? "with the truck" : "by arrival"}). Record it under Documents.`));
  }
  ruleRecommendations(sh, { pos: ctx.pos, orders: ctx.orders, direction, placeOf: ctx.placeOf }).forEach(r => out.push({ kind: "rule", term: r.from, doc: r.doc, record: no, recordKind: "shipment", shipment: no,
  text: `${r.side === "sell" ? "Sold" : "Bought"} ${r.from}, but ${r.why}: the rule that fits is ${r.to} — change it on ${r.doc}.`, recommend: { side: r.side, doc: r.doc, to: r.to } }));   // v7.29.1 (FZ-41)
  insuranceMissing(sh, ctx.orders || []).forEach((o: any) => { const t = up(o.sellIncoterm); f("insurance", t, S0(o.number), `Sold ${t}: we insure the cargo — ICC ${t === "CIF" ? "(C) minimum" : "(A)"} — but this shipment holds no insurance certificate. Record it under Documents as '${INSURANCE_DOC}'.`); });
  seaRuleWithoutSea(sh, ctx).forEach(x => f("sea", x.term, x.doc, `${sideWord(x.side)} ${x.term}, a rule for sea transport only — this shipment has no sea leg and no port on its way.`));
  placesOffTerms(sh, ctx).forEach(x => f("places", x.term, x.doc, x.what === "start" ? `Bought ${x.term} at ${placeName(ctx, x.named)}: the goods are handed to us there — this shipment starts at ${placeName(ctx, x.actual)}.`
    : x.what === "end" ? `${sideWord(x.side)} ${x.term} to ${placeName(ctx, x.named)}: the carriage ends there — this shipment ends at ${placeName(ctx, x.actual)}.`
    : `${sideWord(x.side)} ${x.term} ${placeName(ctx, x.named)}: the sea leg arrives at the named port — on this shipment it arrives at ${placeName(ctx, x.actual)}.`));
  carrierOnOthersLeg(sh, ctx).forEach(x => f("carrier", x.p.term, x.p.doc, `Leg ${x.leg + 1}'s freight is ${PAYER_LABEL[x.p.payer]} (${x.p.why}), yet ${contactName(ctx, x.carrierId)} is named on it — a transport order would go out to them.`));
  return out;
}
/** Every inconsistency with the incoterms in the data — shipments, sales, purchases and claims — one line each. */
export function termsToReview(ctx: TermsCtx = {}): TermsFinding[] {
  const out: TermsFinding[] = [];
  (ctx.shipments || []).filter(liveRec).forEach((sh: any) => out.push(...shipmentTermsFindings(sh, ctx)));
  // v7.22.3 (FZ-21, owner ruling 13 Oct): a term that is not one of the 11 Incoterms 2020 rules is not read at all — it is named
  // here, on its record, for the user to choose the right rule (an old DAT became DPU in 2020)
  const outdated = (t: any, verb: string) => `${verb} "${S0(t)}": not one of the 11 Incoterms 2020 rules — open the order and choose the right one${S0(t).toUpperCase() === "DAT" ? " (DAT became DPU in 2020)" : ""}.`;
  (ctx.orders || []).filter(liveRec).filter((o: any) => S0(o.sellIncoterm) && !isIncoterm2020(o.sellIncoterm)).forEach((o: any) => out.push({ kind: "outdated", term: S0(o.sellIncoterm), doc: S0(o.number), record: S0(o.number), recordKind: "order", shipment: "", text: outdated(o.sellIncoterm, "Sold") }));
  (ctx.pos || []).filter(liveRec).filter((p: any) => S0(p.buyIncoterm) && !isIncoterm2020(p.buyIncoterm)).forEach((p: any) => out.push({ kind: "outdated", term: S0(p.buyIncoterm), doc: S0(p.number), record: S0(p.number), recordKind: "po", shipment: "", text: outdated(p.buyIncoterm, "Bought") }));
  (ctx.orders || []).filter(liveRec).forEach((o: any) => {
    const no = S0(o.number); const n = namedPlaceNotPort(o, "sell", ctx);
    if (n) out.push({ kind: "port", term: n.term, doc: no, record: no, recordKind: "order", shipment: "", text: `Sold ${n.term}: the named place must be the port of destination — it is ${n.typed ? `"${n.place}", an address typed with no port behind it` : `${n.place}, not a port`}.` });
    const jg = saleJourneyGap(o, ctx);   // v7.29.4 (FZ-37)
    if (jg) out.push({ kind: "journey", term: jg.term, doc: no, record: no, recordKind: "order", shipment: jg.shipments[0] || "", text: jg.need === "sea" ? `Sold ${jg.term}: the vessel to the named port is ours to book — ${jg.shipments.length > 1 ? `its shipments (${jg.shipments.join(", ")}) carry` : `its shipment ${jg.shipments[0]} carries`} no sea leg to it yet` : `Sold ${jg.term}: none of its shipments (${jg.shipments.join(", ")}) reaches the named place yet` });
    const nf = saleWithoutOurFreight(o, ctx);
    if (nf) out.push({ kind: "nofreight", term: nf.term, doc: no, record: no, recordKind: "order", shipment: "", text: `Sold ${nf.term}: we pay the carriage to the named place — yet ${nf.shipments.length > 1 ? `its shipments (${nf.shipments.join(", ")}) carry` : `its shipment ${nf.shipments[0]} carries`} no freight of ours (no freight line, no unit price on a leg of ours).` });
  });
  (ctx.pos || []).filter(liveRec).forEach((p: any) => {
    const no = S0(p.number); const n = namedPlaceNotPort(p, "buy", ctx);
    if (n) out.push({ kind: "port", term: n.term, doc: no, record: no, recordKind: "po", shipment: "", text: `Bought ${n.term}: the named place must be the port of destination — it is ${n.typed ? `"${n.place}", an address typed with no port behind it` : `${n.place}, not a port`}.` });
  });
  (ctx.claims || []).filter(liveRec).forEach((cl: any) => {
    const sh = claimShipment(cl, ctx.shipments || []); if (!sh) return; const rt = claimRouting(cl, sh, ctx); if (!rt) return;
    const r = riskAtStage(sh, S0(cl.lossAt?.stage), ctx); const side = S0(cl.direction) === "CONCESSION" ? r.sale : (r.purchase && r.purchase.bearer === "supplier" ? r.purchase : (r.purchase || r.sale));
    const base = { kind: "claim" as TermsKind, term: side ? side.term : "", doc: side ? side.doc : "", record: S0(cl.number), recordKind: "claim" as const, shipment: S0(sh.number) };
    if (rt.respondent && S0(cl.respondent?.contactId) !== S0(rt.respondent.contactId)) out.push({ ...base, text: `Under the terms this claim goes to ${rt.respondent.name}, not ${S0(cl.respondent?.name) || "the party named"}. ${rt.note}` });
    else if (rt.warn) out.push({ ...base, text: rt.note });
  });
  const rank = (k: TermsKind) => TERMS_KINDS.indexOf(k); const docKey = (x: TermsFinding) => x.doc || "~";   // grouped by the document whose term it is (POs, then sales), then by record
  return out.sort((a, b) => docKey(a).localeCompare(docKey(b), undefined, { numeric: true }) || a.record.localeCompare(b.record, undefined, { numeric: true }) || rank(a.kind) - rank(b.kind));
}
/** The findings a document's own view shows: those under its term (its own record and the shipments and claims it governs). */
export function termsFindingsForDoc(findings: TermsFinding[], docNumber: any): TermsFinding[] { const n = S0(docNumber); return (findings || []).filter(f => f.doc === n || f.record === n); }
