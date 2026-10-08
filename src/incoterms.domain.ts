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
}
const R = (code: IncotermCode, seaOnly: boolean, riskAt: IncotermRule["riskAt"], risk: string, carriagePaidBy: "buyer" | "seller", costsTo: IncotermRule["costsTo"], exportClearance: "buyer" | "seller", importClearance: "buyer" | "seller", insurance: IncotermRule["insurance"] = ""): IncotermRule => ({ code, seaOnly, riskAt, risk, carriagePaidBy, costsTo, exportClearance, importClearance, insurance });
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
/** Do WE arrange (and pay) the main carriage? side "buy" = we are the buyer (PO); "sell" = we are the seller (SO). */
export function weArrangeCarriage(code: any, side: "buy" | "sell"): boolean { const r = ruleOf(code); if (!r) return false; return side === "buy" ? r.carriagePaidBy === "buyer" : r.carriagePaidBy === "seller"; }
/** Who clears customs for import / export, seen from our side. */
export function weClear(code: any, side: "buy" | "sell", which: "export" | "import"): boolean { const r = ruleOf(code); if (!r) return false; const party = which === "export" ? r.exportClearance : r.importClearance; return side === "buy" ? party === "buyer" : party === "seller"; }
/** Who carries the risk of a loss, given WHERE it happened relative to the delivery point: "before" → the seller, "after" → the buyer. */
export function riskBearer(code: any, lossBeforeDelivery: boolean): "seller" | "buyer" | "" { return ruleOf(code) ? (lossBeforeDelivery ? "seller" : "buyer") : ""; }
/** One plain sentence for a document or a screen. */
export function incotermSentence(code: any, namedPlace: string): string {
  const r = ruleOf(code); if (!r) return "";
  return `${r.code} ${namedPlace || "(named place missing)"} — risk passes ${r.risk}; ${r.carriagePaidBy === "seller" ? `seller pays carriage to ${namedPlace || "the named place"}` : "buyer arranges and pays the main carriage"}${r.insurance ? `; seller insures (${r.insurance})` : ""}; export clearance by the ${r.exportClearance}, import clearance by the ${r.importClearance}.`;
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
