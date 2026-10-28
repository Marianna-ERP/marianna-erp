// placeReplace.domain.ts — v7.32.0 (FZ-04a, owner 26 Oct): THE OLD PLACES TO REPLACE. The public-places store (Parties › Locations) may
// still hold company-like entries the first version created itself (its sample warehouse, a sample producer, a sample client …) or a company's place
// typed beside its record. Each is replaced everywhere by an address from Parties — a company's or a public place's — then deleted.
import { readCustomLocations, isPublicPlaceType } from "./locations";

const S = (v: any) => String(v ?? "").trim();
/** The fields that hold a place, wherever they sit (a PO's named place, a lot's place and its movements, a shipment's legs, units and booking ports). */
export const PLACE_FIELD = /^(.*LocationId|locationId|toId|fromId|polId|podId|originId|destinationId|loadingPlaceId|unloadingPlaceId|placeId)$/;
export interface PlaceUses { pos: string[]; orders: string[]; lots: string[]; shipments: string[] }
export interface OldPlace { place: any; uses: PlaceUses; total: number }
export type Stores = { pos?: any[]; orders?: any[]; lots?: any[]; shipments?: any[] };

function walkUses(o: any, id: string, hit: () => void): void {
  if (Array.isArray(o)) { o.forEach(x => walkUses(x, id, hit)); return; }
  if (!o || typeof o !== "object") return;
  for (const [k, v] of Object.entries(o)) { if (PLACE_FIELD.test(k)) { if (v != null && S(v) === id) hit(); } else if (v && typeof v === "object") walkUses(v, id, hit); }
}
/** Where one place is used, document by document. */
export function usesOfPlace(id: any, data: Stores): PlaceUses {
  const out: PlaceUses = { pos: [], orders: [], lots: [], shipments: [] };
  (["pos", "orders", "lots", "shipments"] as const).forEach(store => (data[store] || []).forEach((rec: any) => { let n = 0; walkUses(rec, S(id), () => { n++; }); if (n) out[store].push(S(rec?.number || rec?.id)); }));
  return out;
}
/** The entries of the public-places store that are not public places — old company-like entries — with their uses. */
export function oldPlacesToReplace(data: Stores, store: any[] = readCustomLocations()): OldPlace[] {
  return (store || []).filter((l: any) => l && !isPublicPlaceType(l.type)).map((place: any) => { const uses = usesOfPlace(place.id, data); return { place, uses, total: uses.pos.length + uses.orders.length + uses.lots.length + uses.shipments.length }; });
}
/** Every field in every record that held OLD now holds NEW; what changed is listed for the audit trail. Records untouched are the same objects. */
export function replacePlaceEverywhere(data: Stores, oldId: any, newId: any): { pos: any[]; orders: any[]; lots: any[]; shipments: any[]; changed: Array<{ store: string; number: string; fields: number }> } {
  const changed: Array<{ store: string; number: string; fields: number }> = [];
  const swap = (o: any): { out: any; n: number } => {
    if (Array.isArray(o)) { let n = 0; const out = o.map(x => { const r = swap(x); n += r.n; return r.out; }); return { out: n ? out : o, n }; }
    if (!o || typeof o !== "object") return { out: o, n: 0 };
    let n = 0; const out: any = { ...o };
    for (const [k, v] of Object.entries(o)) {
      if (PLACE_FIELD.test(k)) { if (v != null && S(v) === S(oldId)) { out[k] = newId; n++; } }
      else if (v && typeof v === "object") { const r = swap(v); if (r.n) { out[k] = r.out; n += r.n; } }
    }
    return { out: n ? out : o, n };
  };
  const run = (store: keyof Stores) => (data[store] || []).map((rec: any) => { const r = swap(rec); if (r.n) changed.push({ store, number: S(rec?.number || rec?.id), fields: r.n }); return r.out; });
  return { pos: run("pos"), orders: run("orders"), lots: run("lots"), shipments: run("shipments"), changed };
}
