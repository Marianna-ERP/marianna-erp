// invoiceNotes.domain.ts — v7.26.4 (A-INV-4, owner 17 Oct): THE ERP'S SALES INVOICE CARRIES THE EXPORT DETAILS.
// The team's Fakturownia invoices carry what a buyer and a border need: the delivery terms, the ACID, the goods with their CN code
// and origin, the weights, the packages, the trucks and containers, the temperature recorders, and — for every sale of goods leaving
// from Poland, to EU and non-EU clients alike — the origin declaration. Rather than many fixed rules, the ERP fills one NOTES text
// from the sale, its shipments and its lots; the user edits it as needed; it goes to the invoice's notes in Fakturownia.

import { parseNum } from "./numbers";

export const ORIGIN_DECLARATION = "The exporter of the products covered by this document declares that, except where otherwise clearly indicated, these products are of Polish preferential origin";

const S = (v: any) => String(v ?? "").trim();
const kg = (v: number) => `${Math.round(v).toLocaleString("pl-PL")} kg`;
const uniq = (xs: string[]) => Array.from(new Set(xs.map(S).filter(Boolean)));

/** The shipments carrying this sale (not deleted). */
function shipmentsOfSale(order: any, shipments: any[]): any[] {
  const no = S(order?.number);
  return (shipments || []).filter((sh: any) => sh && S(sh.status) !== "Cancelled" && (sh.goods || []).some((g: any) => S(g?.soRef) === no));
}

/** Are the goods sold from Poland? Yes unless every shipment of the sale starts outside Poland (no shipment yet: yes). */
export function isFromPoland(order: any, shipments: any[], countryOf: (locationId: any, custom: any) => string): boolean {
  const mine = shipmentsOfSale(order, shipments);
  if (!mine.length) return true;
  return mine.some((sh: any) => { const l0 = (sh.legs || [])[0]; const c = l0 ? S(countryOf(l0.fromLocationId, l0.fromCustom)) : ""; return !c || /^(pl|poland|polska)$/i.test(c); });
}

/** The notes text for the sale's invoice — each line only when the sale has it. */
export function exportNotesForSale(order: any, ctx: { shipments?: any[]; lots?: any[]; deliveryPlace?: string; fromPoland?: boolean } = {}): string {
  const lines: string[] = [];
  const no = S(order?.number); const lots = ctx.lots || [];
  const lotOf = (ref: any) => lots.find((l: any) => l && S(l.number) === S(ref));
  const term = S(order?.sellIncoterm || order?.incoterm);
  if (term) lines.push(`Delivery terms: ${term}${S(ctx.deliveryPlace) ? ` ${S(ctx.deliveryPlace)}` : ""} (Incoterms 2020)`);
  if (S(order?.acidNo)) lines.push(`ACID: ${S(order.acidNo)}`);
  (order?.items || []).forEach((it: any) => {
    if (!it || !S(it.product)) return; const lot = it.sourceType === "STOCK" ? lotOf(it.sourceRef) : null;
    const cn = S(it.cnCode || lot?.cnCode); const origin = S(it.origin || lot?.origin);
    lines.push(`${[it.product, it.variety, it.size].map(S).filter(Boolean).join(" ")}${cn ? ` — CN ${cn}` : ""}${origin ? ` — origin ${origin}` : ""}`);
  });
  const mine = shipmentsOfSale(order, ctx.shipments || []);
  const goods = mine.flatMap((sh: any) => (sh.goods || []).filter((g: any) => S(g?.soRef) === no));
  const net = goods.length ? goods.reduce((a: number, g: any) => a + parseNum(g.qtyKg), 0) : (order?.items || []).reduce((a: number, it: any) => a + (/^kg$/i.test(S(it.unit || "kg")) ? parseNum(it.qty) : 0), 0);
  const gross = goods.reduce((a: number, g: any) => a + parseNum(g.grossKg), 0);
  if (net > 0) lines.push(`Net weight: ${kg(net)}${gross > 0 ? ` · Gross weight: ${kg(gross)}` : ""}`);
  const packs = new Map<string, number>();
  (goods.length ? goods : (order?.items || [])).forEach((g: any) => { const b = parseNum(g?.boxes); if (b > 0) packs.set(S(g.packaging) || "packages", (packs.get(S(g.packaging) || "packages") || 0) + b); });
  if (packs.size) lines.push(`Packages: ${Array.from(packs.entries()).map(([p, b]) => `${Math.round(b).toLocaleString("pl-PL")} × ${p}`).join(" · ")}`);
  // a leg keeps its trucks / containers as vehicles (older records: transportUnits or units)
  const units = mine.flatMap((sh: any) => (sh.legs || []).flatMap((leg: any) => (Array.isArray(leg?.vehicles) ? leg.vehicles : [])));   // v7.28.9 (Batch L): the trucks only
  const trucks = uniq(units.map((u: any) => [S(u.truckPlate || u.vehiclePlate), S(u.trailerPlate)].filter(Boolean).join(" / ")));
  const containers = uniq(units.map((u: any) => u.containerNumber));
  const recorders = uniq(units.map((u: any) => u.tempRecorderNo));
  if (trucks.length) lines.push(`Trucks: ${trucks.join(", ")}`);
  if (containers.length) lines.push(`Containers: ${containers.join(", ")}`);
  if (recorders.length) lines.push(`Temperature recorders: ${recorders.join(", ")}`);
  if (ctx.fromPoland !== false) lines.push(ORIGIN_DECLARATION);
  return lines.join("\n");
}
