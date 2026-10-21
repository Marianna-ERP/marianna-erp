// journeyProposal.domain.ts — v7.29.0 (SC-15, owner 20 Oct: "yes, let the system propose and team to confirm allowing team to choose
// freely from all available options"): OUR LEGS, PROPOSED FROM THE PURCHASE'S AND THE SALE'S RULES.
// The PO's rule says where our part starts (handover point A), the SO's rule where it ends (B); the legs between them follow from who
// pays the main carriage and whether the rule is a sea rule — all read from the one incoterm table (FZ-21). A port the rules need but
// do not name is left for the team to pick. Nothing is created here: the team sees the legs, changes any of them, then creates.
import { ruleOf } from "./incoterms.domain";

const S = (v: any) => String(v ?? "").trim();
export interface ProposedLeg { mode: "Road" | "Sea" | "Air" | "Rail"; fromLocationId: any; toLocationId: any; why: string; pickFrom?: boolean; pickTo?: boolean }
export interface JourneyProposal { legs: ProposedLeg[]; note: string }
export interface JourneyCtx { siteOf?: (company: any) => any; ourWarehouse?: () => any; lotPlace?: () => any; isPort?: (id: any) => boolean }

const has = (v: any) => v != null && S(v) !== "";
const same = (a: any, b: any) => has(a) && has(b) && S(a) === S(b);

export function proposeJourney(po: any, so: any, ctx: JourneyCtx = {}): JourneyProposal {
  const pr = po ? ruleOf(po.buyIncoterm) : null, sr = so ? ruleOf(so.sellIncoterm) : null;
  const term = (d: any, side: "buy" | "sell") => S(side === "buy" ? d?.buyIncoterm : d?.sellIncoterm).toUpperCase();
  // A — where our part starts
  let A: any = null; let aWhy = "";
  if (po && pr) { A = has(po.destinationLocationId) ? po.destinationLocationId : (pr.carriagePaidBy === "buyer" && ctx.siteOf ? ctx.siteOf(po.supplier) : null); aWhy = `bought ${term(po, "buy")}${has(po.destinationLocationId) ? " at the named place" : ""}`; }
  else if (ctx.lotPlace) { A = ctx.lotPlace(); aWhy = "from stock"; }
  const weBookSeaFromA = !!(pr && pr.carriagePaidBy === "buyer" && pr.seaOnly);   // FAS / FOB bought: our vessel from the port of shipment
  // a D-rule purchase delivered straight to the client: the supplier's truck covers the journey
  if (pr && pr.riskAt === "destination" && so && sr && same(po.destinationLocationId, so.destinationLocationId)) return { legs: [], note: `the supplier delivers to the client's place (bought ${term(po, "buy")}, sold ${term(so, "sell")}) — no leg of ours` };
  // B — where our part ends
  let B: any = null; let bWhy = "";
  if (so && sr) {
    if (sr.carriagePaidBy === "buyer") {
      if (sr.riskAt === "seller-premises") return { legs: [], note: `sold ${term(so, "sell")} — the client collects${A ? " where the goods are" : ""}; no leg of ours` };
      B = has(so.destinationLocationId) ? so.destinationLocationId : A; bWhy = `sold ${term(so, "sell")} at the named place`;
    } else { B = has(so.destinationLocationId) ? so.destinationLocationId : (ctx.siteOf ? ctx.siteOf(so.client) : null); bWhy = `sold ${term(so, "sell")} to the named place`; }
  } else if (po) { B = ctx.ourWarehouse ? ctx.ourWarehouse() : null; bWhy = "into our stock"; }
  if (!has(A) && !has(B)) return { legs: [], note: "the rules name no place yet — set the named places on the PO and the SO" };
  if (same(A, B)) return { legs: [], note: "the goods are handed over where they are — no leg of ours" };
  const legs: ProposedLeg[] = [];
  const road = (from: any, to: any, why: string, pf = false, pt = false) => legs.push({ mode: "Road", fromLocationId: from ?? null, toLocationId: to ?? null, why, pickFrom: pf || !has(from), pickTo: pt || !has(to) });
  const sea = (from: any, to: any, why: string, pf = false, pt = false) => legs.push({ mode: "Sea", fromLocationId: from ?? null, toLocationId: to ?? null, why, pickFrom: pf || !has(from), pickTo: pt || !has(to) });
  const port = (id: any) => !!(ctx.isPort && has(id) && ctx.isPort(id));
  const saleBySea = !!(sr && sr.carriagePaidBy === "seller" && sr.seaOnly);   // CFR / CIF sold: our vessel to the named port
  const saleToPort = !!(sr && sr.carriagePaidBy === "buyer" && sr.seaOnly);   // FAS / FOB sold: our truck to the port of shipment
  if (weBookSeaFromA) {
    if (saleBySea) sea(A, B, `${aWhy}, ${bWhy}: our vessel`);
    else { sea(A, null, `${aWhy}: our vessel from the port of shipment — pick the port of discharge`, false, true); if (!port(B)) road(null, B, `${bWhy}: on from the port of discharge`, true, false); }
  } else if (saleBySea) {
    if (port(A)) sea(A, B, `${aWhy}; ${bWhy}: our vessel`);
    else { road(A, null, `${aWhy}: to the port of loading — pick it (your port warehouse)`, false, true); sea(null, B, `${bWhy}: our vessel from the port of loading`, true, false); }
  } else if (saleToPort) road(A, B, `${aWhy}; ${bWhy}: our truck to the port of shipment`);
  else road(A, B, `${aWhy}${bWhy ? "; " + bWhy : ""}`);
  return { legs, note: "" };
}

// v7.30.10 (owner test 21 Oct): the picker hands back { id, name, location } — the journey keeps the place's id (it kept the whole
// object, so the field showed empty after a choice)
export const placeIdOf = (v: any) => (v && typeof v === "object" ? (v.id ?? null) : (v ?? null));

/** The shipment's legs from the journey: the first leg of the same mode keeps the built trucks (the goods ride on them), every other
 *  leg starts with one empty unit of its own. */
export function legsFromJourney(journey: any[], builtLegs: any[] = []): any[] {
  const tpl = (builtLegs || [])[0] || {}; let reused = false;
  return (journey || []).map((j: any, i: number) => {
    const fromBuilt = !reused && String(tpl.mode || "Road") === String(j.mode);
    if (fromBuilt) reused = true;
    return { ...(fromBuilt ? tpl : {}), id: i + 1, mode: j.mode, status: fromBuilt ? (tpl.status || "Booked") : "Booked", fromLocationId: placeIdOf(j.fromLocationId), toLocationId: placeIdOf(j.toLocationId),
      vehicles: fromBuilt && Array.isArray(tpl.vehicles) && tpl.vehicles.length ? tpl.vehicles : [{ id: 1 }] };
  });
}
