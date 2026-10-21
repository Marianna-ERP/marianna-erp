// placeRepair.domain.ts — v7.28.8 (FZ-36, owner 20 Oct: "please repair in a clean way. no left over files or old code. let the user
// choose the place for the old file where it is missing"): A ROUTE PLACE THAT NO LONGER RESOLVES IS REPAIRED ONCE.
// A company's address place takes its id from the company's id; the company ids were re-minted in v6.99.97 (A-ID-1), so routes saved
// before point at addresses that no longer exist. Each such place is listed once per shipment, with where it sits (a leg's start or
// end, a truck's loading or unloading). It is FILLED when the shipment's purchase hands the goods over at the supplier (EXW / FCA) and
// the supplier has exactly one address, or when its sale delivers to the client (DAP / DPU / DDP) and the client has exactly one
// address; every other one is PICKED by the user from any place. Nothing here reads or keeps the old ids: a repaired route simply
// holds a place that resolves, and the list is empty.
import { ruleOf, D_RULES } from "./incoterms.domain";   // the one incoterm table (FZ-21)
const S = (v: any) => String(v ?? "").trim();
/** handed over at the supplier: the rules whose risk passes at the seller's premises or to our carrier at a named place */
const handedAtSupplier = (t: any) => { const r = ruleOf(t); return !!r && (r.riskAt === "seller-premises" || r.riskAt === "named-place-carrier"); };
const deliveredToClient = (t: any) => D_RULES.includes(S(t).toUpperCase());

export interface PlaceToRepair { shipment: string; oldId: string; where: string[]; fill: { id: any; name: string; why: string } | null }
export interface RepairCtx { known: (id: any) => boolean; pos?: any[]; orders?: any[]; contacts?: any[]; sitesOf: (company: any) => any[]; nameOf?: (id: any) => string }

export function placesToRepair(shipments: any[], ctx: RepairCtx): PlaceToRepair[] {
  const out: PlaceToRepair[] = [];
  (shipments || []).forEach((sh: any) => {
    if (!sh || S(sh.status) === "Cancelled") return;
    const legs = (sh.legs || []).filter((l: any) => l); if (!legs.length) return;
    const seen = new Map<string, PlaceToRepair>();
    const note = (id: any, label: string, end: "start" | "end" | "middle") => {
      if (id == null || S(id) === "" || ctx.known(id)) return;
      const k = S(id); const it = seen.get(k) || { shipment: S(sh.number), oldId: k, where: [], fill: null, _ends: new Set<string>() } as any;
      it.where.push(label); it._ends.add(end); seen.set(k, it);
    };
    legs.forEach((l: any, i: number) => {
      const end = (pos: "from" | "to") => (pos === "from" && i === 0) ? "start" : (pos === "to" && i === legs.length - 1) ? "end" : "middle";
      note(l.fromLocationId, `leg ${i + 1} start`, end("from")); note(l.toLocationId, `leg ${i + 1} end`, end("to"));
      (l.vehicles || []).forEach((u: any, ui: number) => { if (!u) return; note(u.pickupLocationId, `leg ${i + 1} truck ${ui + 1} loading`, end("from")); note(u.deliveryLocationId, `leg ${i + 1} truck ${ui + 1} unloading`, end("to")); });
    });
    seen.forEach((it: any) => {
      const ends: Set<string> = it._ends; delete it._ends;
      if (ends.size === 1 && ends.has("start")) {
        const po = (ctx.pos || []).find((p: any) => (sh.poRefs || []).map(String).includes(S(p?.number)));
        const sup = po && (ctx.contacts || []).find((c: any) => S(c?.id) === S(po?.supplier?.id));
        const sites = sup ? ctx.sitesOf(sup) : [];
        if (po && handedAtSupplier(po.buyIncoterm) && po.destinationLocationId != null && S(po.destinationLocationId) !== "" && ctx.known(po.destinationLocationId)) it.fill = { id: po.destinationLocationId, name: (ctx.nameOf ? ctx.nameOf(po.destinationLocationId) : "") || "the PO's named place", why: `bought ${S(po.buyIncoterm).toUpperCase()} at the named place (${po.number})` };   // v7.29.2: the rule's own handover place first
        else if (po && handedAtSupplier(po.buyIncoterm) && sites.length === 1) it.fill = { id: sites[0].id, name: S(sites[0].name), why: `bought ${S(po.buyIncoterm).toUpperCase()} at the supplier (${po.number}) — the supplier's only address` };
      }
      if (ends.size === 1 && ends.has("end")) {
        const soNo = S(sh.governingSoRef) || S((sh.soRefs || [])[0]);
        const so = soNo ? (ctx.orders || []).find((o: any) => S(o?.number) === soNo) : null;
        const cli = so && (ctx.contacts || []).find((c: any) => S(c?.id) === S(so?.client?.id));
        const sites = cli ? ctx.sitesOf(cli) : [];
        if (so && deliveredToClient(so.sellIncoterm) && sites.length === 1) it.fill = { id: sites[0].id, name: S(sites[0].name), why: `sold ${S(so.sellIncoterm).toUpperCase()} to the client (${so.number}) — the client's only address` };
      }
      out.push(it);
    });
  });
  return out;
}

/** The shipment with every occurrence of the unresolved place replaced by the chosen one (legs' start / end, trucks' loading / unloading). */
export function repairPlace(sh: any, oldId: any, newId: any): any {
  const same = (v: any) => v != null && S(v) === S(oldId);
  return { ...sh, legs: (sh.legs || []).map((l: any) => !l ? l : ({ ...l,
    fromLocationId: same(l.fromLocationId) ? newId : l.fromLocationId, toLocationId: same(l.toLocationId) ? newId : l.toLocationId,
    vehicles: (l.vehicles || []).map((u: any) => !u ? u : ({ ...u, ...(same(u.pickupLocationId) ? { pickupLocationId: newId } : {}), ...(same(u.deliveryLocationId) ? { deliveryLocationId: newId } : {}) })) })) };
}
