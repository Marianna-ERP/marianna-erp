// storeShapes.ts — v7.24.3 (FZ-01 step 2, owner approved 15 Oct): A SAVE WRITES THE CLEAN SHAPE.
// The tidy-ups (companies, POs, SOs, lots, invoices) used to run once when the app opened — on the browser's cached copy, never
// on the shared data that arrives after it, so old fields kept coming back (the owner's files of 15 Oct: 18 POs, 50 lots, 77
// invoices still carrying them). They now run on what a save WRITES: every record that is new or changed passes through its
// tidy-up on its way into the store; records nobody touched are left exactly as they are.

/** The store after a write: each record that is new or changed (not the same object as before) is passed through `shape`. */
export function shapeWritten(prev: any[] | null | undefined, next: any, shape: (rec: any) => any): any {
  if (!Array.isArray(next) || next === prev) return next;
  const was = new Set(prev || []);
  let changed = false;
  const out = next.map((r: any) => { if (!r || typeof r !== "object" || was.has(r)) return r; const s = shape(r); if (s !== r) changed = true; return s; });
  return changed ? out : next;
}

/** A store setter that tidies what it writes (the same call shapes as React's setState: a value or an updater). */
export function shapingSetter(set: (u: any) => void, shape: (rec: any) => any): (u: any) => void {
  return (u: any) => set((prev: any[]) => shapeWritten(prev, typeof u === "function" ? u(prev) : u, shape));
}

/** v7.28.0 (Batch L · FZ-08 part, RM-2 F-1): A SHIPMENT IS WRITTEN IN ITS CLEAN SHAPE — a truck's actual dates live in loadedAt /
 *  unloadedAt; the older pair (actualLoadDate / actualUnloadDate) is moved there when the new one is empty, then dropped. Returns the
 *  same object when nothing changes, so an unchanged record is not rewritten. */
export function shapeShipment(sh: any): any {
  // v7.30.10 (owner test 21 Oct): a leg place written by the v7.29.0–v7.30.5 journey card as { id, name, location } becomes its id
  if (sh && Array.isArray(sh.legs) && sh.legs.some((l: any) => l && ((l.fromLocationId && typeof l.fromLocationId === "object") || (l.toLocationId && typeof l.toLocationId === "object"))))
    sh = { ...sh, legs: sh.legs.map((l: any) => !l ? l : { ...l, fromLocationId: l.fromLocationId && typeof l.fromLocationId === "object" ? (l.fromLocationId.id ?? null) : l.fromLocationId, toLocationId: l.toLocationId && typeof l.toLocationId === "object" ? (l.toLocationId.id ?? null) : l.toLocationId }) };
  if (!sh || !Array.isArray(sh.legs)) return sh;
  let changed = false;
  const legs = sh.legs.map((l: any) => {
    if (!l || !Array.isArray(l.vehicles)) return l;
    let legChanged = false;
    const vehicles = l.vehicles.map((u: any) => {
      if (!u || (!("actualLoadDate" in u) && !("actualUnloadDate" in u))) return u;
      const v: any = { ...u };
      if (!String(v.loadedAt || "").trim() && String(v.actualLoadDate || "").trim()) v.loadedAt = String(v.actualLoadDate).trim();
      if (!String(v.unloadedAt || "").trim() && String(v.actualUnloadDate || "").trim()) v.unloadedAt = String(v.actualUnloadDate).trim();
      delete v.actualLoadDate; delete v.actualUnloadDate; legChanged = true; return v;
    });
    if (!legChanged) return l; changed = true; return { ...l, vehicles };
  });
  let out: any = changed ? { ...sh, legs } : sh;
  // v7.28.9 (Batch L · FZ-08): a leg's truck and price copies go — the trucks own the plates, the driver, the container and the price;
  // a value only the leg held moves onto its first truck first
  const LEG_COPIES = ["vehiclePlate", "truckPlate", "trailerPlate", "driverName", "driverPhone", "containerNumber", "costAmount", "costPLN", "transportUnits", "units"];
  if ((out.legs || []).some((l: any) => l && LEG_COPIES.some(k => k in l))) {
  out = { ...out, legs: out.legs.map((l: any) => {
  if (!l || !LEG_COPIES.some(k => k in l)) return l;
  const old = Array.isArray(l.vehicles) && l.vehicles.length ? l.vehicles : (Array.isArray(l.transportUnits) && l.transportUnits.length ? l.transportUnits : (Array.isArray(l.units) ? l.units : (l.vehicles || [])));   // an old unit list becomes the trucks
  const v0: any[] = old.map((u: any) => (u ? { ...u } : u)); const u0 = v0.find((u: any) => u);
  const put = (from: string, to: string) => { const val = l[from]; if (u0 && val != null && String(val).trim() !== "" && (u0[to] == null || String(u0[to]).trim() === "")) u0[to] = val; };
  put("vehiclePlate", "truckPlate"); put("truckPlate", "truckPlate"); put("trailerPlate", "trailerPlate"); put("driverName", "driverName"); put("driverPhone", "driverPhone"); put("containerNumber", "containerNumber");
  if (u0 && Number(l.costAmount) > 0 && !v0.some((u: any) => u && Number(u.costAmount ?? u.unitPrice) > 0)) u0.costAmount = l.costAmount;
  const nl: any = { ...l, vehicles: v0 }; LEG_COPIES.forEach(k => { delete nl[k]; }); return nl;
  }) };
  }
  // v7.28.7 (Batch L · FZ-08): the route owns the places and the trucks own the actual dates — the shipment's own copies go: its origin
  // and destination when its route has a start and an end (moved there first where the route lacks them), its actual loading and
  // delivery dates when a truck has its date (moved onto the first / last leg's trucks first where none has one)
  const L0 = (out.legs || []).filter((l: any) => l);
  const has = (v: any) => v != null && String(v).trim() !== "";
  if (L0.length && ("originLocationId" in out || "destinationLocationId" in out || "actualLoadingDate" in out || "actualDeliveryDate" in out)) {
  out = { ...out, legs: out.legs.map((l: any) => (l ? { ...l, vehicles: (l.vehicles || []).map((u: any) => (u ? { ...u } : u)) } : l)) };
  const legsW = out.legs.filter((l: any) => l); const first = legsW[0], last = legsW[legsW.length - 1];
  // v7.28.8 (FZ-36): the shipment's own ORIGIN goes too — the repair of the route places reads the purchase and the sale, not this copy
  if ("originLocationId" in out) { if (!has(first.fromLocationId) && has(out.originLocationId)) first.fromLocationId = out.originLocationId; delete out.originLocationId; }
  if ("destinationLocationId" in out) { if (!has(last.toLocationId) && has(out.destinationLocationId)) last.toLocationId = out.destinationLocationId; delete out.destinationLocationId; }
  const units = legsW.flatMap((l: any) => (l.vehicles || []).filter((u: any) => u));
  if ("actualLoadingDate" in out) { if (has(out.actualLoadingDate) && !units.some((u: any) => has(u.loadedAt) || has(u.actualLoadDate))) (first.vehicles || []).forEach((u: any) => { if (u) u.loadedAt = String(out.actualLoadingDate).slice(0, 10); }); delete out.actualLoadingDate; }
  if ("actualDeliveryDate" in out) { if (has(out.actualDeliveryDate) && !units.some((u: any) => has(u.unloadedAt) || has(u.actualUnloadDate))) (last.vehicles || []).forEach((u: any) => { if (u) u.unloadedAt = String(out.actualDeliveryDate).slice(0, 10); }); delete out.actualDeliveryDate; }
  }
  return out;
  }

/** v7.28.6 (Batch L · FZ-13, RM-2 F-1): A CLAIM IS WRITTEN IN ITS CLEAN SHAPE — every amount in the claim's own currency. The EUR-named
 *  copies of a claim written before (requestedEUR, acceptedEUR, plnPerEur, lostValueEUR, defectValueEUR, recoveredEUR, totalCostEUR,
 *  egpPerEur) move into the current fields where those are empty, then are dropped. */
const CLAIM_OLD: Array<[string, string]> = [["requestedEUR", "requestedAmount"], ["acceptedEUR", "acceptedAmount"], ["plnPerEur", "fxToPLN"], ["lostValueEUR", "lostValue"], ["defectValueEUR", "defectValue"], ["recoveredEUR", "recovered"], ["totalCostEUR", "totalCost"], ["egpPerEur", "egpRate"]];
export function shapeClaim(c: any): any {
  if (!c || !CLAIM_OLD.some(([o]) => o in c)) return c;
  const out: any = { ...c }; const empty = (v: any) => v == null || String(v).trim() === "" || (typeof v === "number" && v === 0);
  CLAIM_OLD.forEach(([o, n]) => { if (o in out) { if (empty(out[n]) && !empty(out[o])) out[n] = out[o]; delete out[o]; } });
  return out;
}
