// shipmentDerived.domain.ts — v7.27.9 (FZ-29 · RM-2 F-5 agreed 25 Sept · P-8 / P-11): WHAT A SHIPMENT NO LONGER ASKS TO BE TYPED.
// The travel temperature comes from the catalogue items of its goods, a truck's pallet type from the packaging of the goods
// loaded on it, and the currency of a truck's price from its carrier's terms (or the sea booking). Each value is shown in the
// editor with where it comes from, and written into the shipment when it is saved, so documents and checks keep reading it.
// Where the source says nothing (an item without a range, a packaging without a pallet, a carrier without a currency) the
// stored value stays and the editor names the missing setting; a price already typed keeps its own currency.
import { findPackaging } from "./packaging.domain";
import { carrierOfUnit } from "./shipmentModel.domain";
import { documentFxDefault } from "./fx";
import { parseNum } from "./numbers";

const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => parseNum(v);   // FZ-22: the one number reader
const uniq = (a: string[]) => Array.from(new Set(a.filter(Boolean)));

/** The range a shipment travels at: the narrowest range shared by its goods' items (highest minimum, lowest maximum). */
export function temperatureFromCatalog(goods: any[], catalog: any[]): { min?: number; max?: number; from: string[]; missing: string[]; clash: boolean } {
  const items = uniq((goods || []).map((g: any) => S(g?.product)));
  let min: number | undefined, max: number | undefined; const from: string[] = [], missing: string[] = [];
  items.forEach(p => {
    const c = (catalog || []).find((x: any) => S(x?.item).toLowerCase() === p.toLowerCase());
    const lo = c?.temperatureMinC, hi = c?.temperatureMaxC;
    if (lo == null && hi == null) { missing.push(p); return; }
    from.push(p);
    if (lo != null) min = min == null ? Number(lo) : Math.max(min, Number(lo));
    if (hi != null) max = max == null ? Number(hi) : Math.min(max, Number(hi));
  });
  return { min, max, from, missing, clash: min != null && max != null && min > max };
}

/** The goods rows a truck carries: its own load, or every goods row when the truck takes the whole shipment. */
export function goodsOnUnit(sh: any, u: any): any[] {
  const load = (u?.load || []).filter((a: any) => a && num(a.qtyKg) > 0);
  if (!load.length) return sh?.goods || [];
  const ids = new Set(load.map((a: any) => String(a.goodsLineId)));
  return (sh?.goods || []).filter((g: any) => ids.has(String(g?.id)));
}

/** A truck's pallet type from the packaging of the goods on it. */
export function palletTypeFromPackaging(rows: any[], types: any[]): { palletType?: "standard" | "euro"; mixed: boolean; missing: string[] } {
  const kinds = new Set<string>(); const missing: string[] = [];
  (rows || []).forEach((g: any) => { const t: any = findPackaging(types || [], g?.packaging); if (t?.palletType) kinds.add(t.palletType); else if (S(g?.packaging)) missing.push(S(t?.label || g.packaging)); });
  return { palletType: kinds.size === 1 ? (Array.from(kinds)[0] as any) : undefined, mixed: kinds.size > 1, missing: uniq(missing) };
}

/** The currency a truck's price is in: its carrier's, else the sea booking's. */
export function unitCurrencyFrom(carrier: any, booking: any): { currency?: string; source: "carrier" | "booking" | "" } {
  const c = S(carrier?.terms?.defaultCurrency || carrier?.defaultCurrency).toUpperCase(); if (c) return { currency: c, source: "carrier" };
  const b = S(booking?.currency).toUpperCase(); if (b) return { currency: b, source: "booking" };
  return { source: "" };
}

/** Written at save: the derived values replace the typed ones wherever their source has a value. */
export function applyDerivedTravel(sh: any, ctx: { catalog?: any[]; packagingTypes?: any[]; contacts?: any[] }): any {
  if (!sh) return sh;
  const tr = temperatureFromCatalog(sh.goods || [], ctx.catalog || []);
  const out: any = { ...sh };
  if (tr.min != null) out.temperatureMinC = tr.min;
  if (tr.max != null) out.temperatureMaxC = tr.max;
  out.legs = (sh.legs || []).map((leg: any) => {
    let legCur: string | null = null;
    const vehicles = (leg.vehicles || []).map((u: any) => {
      let v = u;
      const pt = palletTypeFromPackaging(goodsOnUnit(sh, u), ctx.packagingTypes || []);
      if (pt.palletType && v.palletType !== pt.palletType) v = { ...v, palletType: pt.palletType };
      if (!(num(v.costAmount) > 0)) {   // a price not yet typed takes the carrier's currency; a typed one keeps its own
        const cid = carrierOfUnit(sh, leg, v); const carrier = cid != null ? (ctx.contacts || []).find((c: any) => String(c?.id) === String(cid)) : null;
        const uc = unitCurrencyFrom(carrier, (sh.bookings || [])[0] || sh.booking);
        if (uc.currency && v.priceCurrency !== uc.currency) { v = { ...v, priceCurrency: uc.currency }; legCur = legCur || uc.currency; }
      }
      return v;
    });
    const l2: any = { ...leg, vehicles };
    if (legCur && !(num(leg.costAmount) > 0) && leg.costCurrency !== legCur) { l2.costCurrency = legCur; l2.costFxRate = documentFxDefault(legCur); }
    return l2;
  });
  return out;
}
