// ─────────────────────────────────────────────────────────────────────────────
// shipmentModel.domain.ts — v6.85.0: THE REDESIGNED SHIPMENT MODEL (additive layer)
//
// Twelve owner rulings (SHIPMENTS_REDESIGN.md §8, 5 Sept 2026). Implemented as a
// layer OVER the existing record so nothing that other modules read changes
// shape: postings, statusOwnership, ledger, costs and the recall trace keep
// reading the fields they always read. New facts live in NEW fields; legacy
// fields (fromUnitId, leg carrierId, header dates) are written as MIRRORS for
// one release so old readers stay correct, and are dropped at the DDL.
//
//   D1  one shipment = one movement under one purpose; variation on the UNIT
//   D2  transport order per carrier            → transportOrdersByCarrier()
//   D3  legs & cost responsibility from incoterms → legsFromIncoterms()
//   D4  Inventory owns the ledger (unchanged here)
//   D5  BOOKING object (no., cut-off, ETD, ETA, POL/POD; vessel optional)
//   D6  purpose-split at a transload: de-vanning report spawns onward shipments
//   D7  catalogue: bonded/ferry/rail/multi-drop/repositioning/cross-dock unit & leg kinds
//   D8  kilos per unit DERIVED from goods allocation  → unitKg()
//   D9  carrier lives on the UNIT
//   D10 actual dates entered ONCE at the event, then travel → stampEvent()
//   D11 one document register                  → documentRegister()
//   D12 load plan derived from feeder links     → containerMap()
// ─────────────────────────────────────────────────────────────────────────────

const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
const r0 = (v: number) => Math.round(v);

// ── D5 · BOOKING ──────────────────────────────────────────────────────────────
export interface Booking {
  id: any; number: string; forwarderId?: any;
  pol?: string; pod?: string;
  cutOff?: string; etd?: string; eta?: string;
  vessel?: string; voyage?: string;          // optional (owner: normally not registered)
  containersPlanned?: number;
  blNumber?: string;
  actualEtd?: string; actualEta?: string;    // stamped by events (D10)
}
export function blankBooking(id: any): Booking { return { id, number: "", containersPlanned: 1 }; }

/** Latest loading date for a truck to make the booking's cut-off, given transit days. */
export function latestLoadingDate(cutOffISO: string, transitDays: number): string {
  const m = S(cutOffISO).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - Math.max(0, Math.round(num(transitDays))));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface CutOffWarning { unit: string; loadingDate: string; latest: string; booking: string; }
/** Trucks whose planned loading date cannot make their booking's cut-off (transit days per unit, default 1). */
export function cutOffWarnings(sh: any): CutOffWarning[] {
  const out: CutOffWarning[] = [];
  const bookings: Booking[] = sh?.bookings || [];
  if (!bookings.length) return out;
  (sh?.legs || []).forEach((leg: any) => (leg.vehicles || []).forEach((u: any) => {
    if (!isTruck(u, leg)) return;
    const b = bookings.find(x => String(x.id) === String(u.bookingId)) || bookings[0];
    if (!b?.cutOff) return;
    const date = S(u.loadedAt || u.plannedLoadingDate || leg.plannedPickupDate);
    if (!date) return;
    const latest = latestLoadingDate(b.cutOff, u.transitDays ?? 1);
    if (latest && date > latest) out.push({ unit: S(u.truckPlate || u.id), loadingDate: date, latest, booking: b.number || "(booking)" });
  }));
  return out;
}

// ── UNIT KINDS (D7 catalogue) ─────────────────────────────────────────────────
export const UNIT_KINDS = ["truck", "container", "wagon", "air", "ferry", "empty_container"] as const;
export const LEG_KINDS = ["road", "sea", "rail", "air", "ferry", "bonded_store", "cross_dock", "repositioning"] as const;
export function isTruck(u: any, leg?: any): boolean {
  const k = S(u?.kind).toLowerCase();
  if (k) return k === "truck";
  return String(leg?.mode || "").toLowerCase() === "road";
}
export function isContainer(u: any, leg?: any): boolean {
  const k = S(u?.kind).toLowerCase();
  if (k) return k === "container";
  return String(leg?.mode || "").toLowerCase() === "sea" || !!S(u?.containerNumber);
}

// ── D8 · KILOS DERIVED ────────────────────────────────────────────────────────
/** A unit's kilos: from its goods allocation; a container from its feeders; never typed. */
export function unitKg(u: any, sh: any): number {
  const loads = (u?.load || []).filter((a: any) => num(a?.qtyKg) > 0);
  if (loads.length) return r0(loads.reduce((s: number, a: any) => s + num(a.qtyKg), 0));
  const feeders = feedersOf(u);
  if (feeders.length) return r0(feeders.reduce((s: number, f: any) => s + feederKg(f, sh), 0));
  return r0(num(u?.qtyKg));   // legacy typed value, read-forward only
}
export function allUnits(sh: any): Array<{ unit: any; leg: any; legIndex: number }> {
  const out: any[] = [];
  (sh?.legs || []).forEach((leg: any, i: number) => (leg.vehicles || []).forEach((u: any) => out.push({ unit: u, leg, legIndex: i })));
  return out;
}
/** Allocate the goods across the trucks of a leg — evenly, or by explicit shares. */
export function allocateGoodsToTrucks(sh: any, legIndex = 0, shares?: number[]): any {
  const goods = sh?.goods || [];
  const leg = (sh?.legs || [])[legIndex]; if (!leg) return sh;
  const trucks = (leg.vehicles || []);
  if (!trucks.length || !goods.length) return sh;
  const n = trucks.length;
  const w = shares && shares.length === n && shares.some(x => x > 0) ? shares : trucks.map(() => 1);
  const wsum = w.reduce((s, x) => s + x, 0);
  const vehicles = trucks.map((u: any, ti: number) => ({
    ...u,
    load: goods.map((g: any) => ({ goodsLineId: g.id, qtyKg: Math.round(num(g.qtyKg) * (w[ti] / wsum)) })),
  }));
  // fix rounding drift on the last truck so totals match the goods exactly
  goods.forEach((g: any, gi: number) => {
    const total = vehicles.reduce((s: number, u: any) => s + num(u.load[gi].qtyKg), 0);
    vehicles[n - 1].load[gi].qtyKg += r0(num(g.qtyKg) - total);
  });
  const legs = (sh.legs || []).map((l: any, i: number) => i === legIndex ? { ...l, vehicles } : l);
  return { ...sh, legs };
}

// ── FEEDERS (container ← trucks, many-to-many; D1/D12) ────────────────────────
export interface Feeder { fromUnitId: any; kg?: number; }
export function feedersOf(u: any): Feeder[] {
  if (Array.isArray(u?.feeders) && u.feeders.length) return u.feeders;
  if (u?.fromUnitId != null && u.fromUnitId !== "") return [{ fromUnitId: u.fromUnitId }];   // legacy single link
  return [];
}
export function findUnit(sh: any, id: any): any | null {
  return allUnits(sh).map(x => x.unit).find(u => String(u?.id) === String(id)) || null;
}
export function feederKg(f: Feeder, sh: any): number {
  if (num(f?.kg) > 0) return num(f.kg);
  const src = findUnit(sh, f.fromUnitId);
  return src ? unitKg(src, sh) : 0;
}
/** Set a container's feeders; mirrors the first one into fromUnitId for legacy readers; recorders follow. */
export function setFeeders(sh: any, containerId: any, feeders: Feeder[]): any {
  const legs = (sh.legs || []).map((leg: any) => ({
    ...leg,
    vehicles: (leg.vehicles || []).map((u: any) => {
      if (String(u.id) !== String(containerId)) return u;
      const recs = feeders.map(f => S(findUnit(sh, f.fromUnitId)?.tempRecorderNo)).filter(Boolean);
      return { ...u, feeders, fromUnitId: feeders[0]?.fromUnitId ?? null,
        tempRecorderNo: recs.length ? Array.from(new Set(recs)).join(", ") : u.tempRecorderNo,
        qtyKg: feeders.reduce((s, f) => s + feederKg(f, sh), 0) };
    }),
  }));
  return { ...sh, legs };
}
/** D12: the truck→container map, derived. */
export function containerMap(sh: any): Array<{ containerRef: string; shipmentRef: string; fromUnit: string; qtyKg: number }> {
  const out: any[] = [];
  allUnits(sh).forEach(({ unit, leg }) => {
    if (!isContainer(unit, leg)) return;
    feedersOf(unit).forEach(f => {
      const src = findUnit(sh, f.fromUnitId);
      out.push({ containerRef: S(unit.containerNumber || unit.id), shipmentRef: S(sh.number), fromUnit: S(src?.truckPlate || src?.id || f.fromUnitId), qtyKg: feederKg(f, sh) });
    });
  });
  return out;
}
/** A container may not be stuffed before every feeder truck has unloaded. */
export function stuffingViolations(sh: any): string[] {
  const out: string[] = [];
  allUnits(sh).forEach(({ unit, leg }) => {
    if (!isContainer(unit, leg) || !S(unit.stuffedAt)) return;
    feedersOf(unit).forEach(f => {
      const src = findUnit(sh, f.fromUnitId);
      if (src && S(src.unloadedAt) && S(src.unloadedAt) > S(unit.stuffedAt))
        out.push(`${S(unit.containerNumber || unit.id)} stuffed ${unit.stuffedAt} but ${S(src.truckPlate || src.id)} unloaded ${src.unloadedAt}`);
    });
  });
  return out;
}

// ── FORWARDER'S STUFFING REPORT (D6 mirror at the POL) ────────────────────────
export interface StuffingRow { containerNumber: string; seal?: string; feeders: Array<{ truckId: any; kg?: number }>; stuffedAt?: string; bookingId?: any; }
/** Creates the container units (one per reported container) on the sea leg with their feeder links. */
export function applyStuffingReport(sh: any, rows: StuffingRow[], deps: { nextId: () => any }, seaLegIndex?: number): any {
  let legs = [...(sh.legs || [])];
  let idx = seaLegIndex ?? legs.findIndex((l: any) => String(l.mode || "").toLowerCase() === "sea");
  if (idx < 0) { legs.push({ mode: "Sea", vehicles: [] }); idx = legs.length - 1; }
  const existing = legs[idx].vehicles || [];
  const added = rows.filter(r => S(r.containerNumber)).map(r => ({
    id: deps.nextId(), kind: "container", containerNumber: S(r.containerNumber), sealNumber: S(r.seal),
    bookingId: r.bookingId ?? (sh.bookings || [])[0]?.id ?? null, stuffedAt: S(r.stuffedAt),
    feeders: r.feeders.map(f => ({ fromUnitId: f.truckId, kg: num(f.kg) || undefined })),
    fromUnitId: r.feeders[0]?.truckId ?? null, load: [], qtyKg: 0, tempRecorderNo: "",
  }));
  legs[idx] = { ...legs[idx], vehicles: [...existing, ...added] };
  let next = { ...sh, legs };
  added.forEach(c => { next = setFeeders(next, c.id, c.feeders); });
  return next;
}

// ── D6 · DE-VANNING REPORT AT THE POD → onward shipments ──────────────────────
export interface DevanningRow { containerId: any; trucks: Array<{ truckPlate: string; kg: number; destination: { kind: "WAREHOUSE"; locationId?: any } | { kind: "SO"; soNumber: string } }>; }
/** Proposes the onward shipments: one TRANSFER (PO-based) for warehouse trucks, one OUTBOUND per SO. */
export function spawnFromDevanning(sh: any, rows: DevanningRow[], deps: { nextId: () => any; nextNumber: (i: number) => string; todayISO: () => string }): any[] {
  const byDest: Record<string, any> = {};
  rows.forEach(r => r.trucks.forEach(t => {
    const key = t.destination.kind === "WAREHOUSE" ? "TRANSFER" : `SO:${t.destination.soNumber}`;
    const b = byDest[key] || (byDest[key] = { key, purpose: t.destination.kind === "WAREHOUSE" ? "TRANSFER" : "OUTBOUND",
      soRefs: t.destination.kind === "SO" ? [t.destination.soNumber] : [], trucks: [] as any[], containers: new Set<string>() });
    const cont = findUnit(sh, r.containerId);
    b.trucks.push({ id: deps.nextId(), kind: "truck", truckPlate: t.truckPlate, qtyKg: r0(t.kg), carrierId: null,
      fedFromContainer: S(cont?.containerNumber || r.containerId), tempRecorderNo: S(cont?.tempRecorderNo),
      load: (sh.goods || []).length === 1 ? [{ goodsLineId: sh.goods[0].id, qtyKg: r0(t.kg) }] : [] });
    b.containers.add(S(cont?.containerNumber || r.containerId));
  }));
  return Object.values(byDest).map((b: any, i: number) => ({
    id: deps.nextId(), number: deps.nextNumber(i), status: "Draft", purpose: b.purpose, mode: "Road",
    poRefs: sh.poRefs || [], soRefs: b.soRefs, lotRefs: sh.lotRefs || [],
    parentShipmentRef: sh.number, devannedFrom: Array.from(b.containers),
    goods: (sh.goods || []).map((g: any) => ({ ...g, id: deps.nextId(), qtyKg: b.trucks.reduce((s: number, t: any) => s + num(t.qtyKg), 0) })),
    legs: [{ mode: "Road", fromText: sh.legs?.slice(-1)[0]?.toText || "POD", vehicles: b.trucks }],
    costs: [], documents: [], createdAt: deps.todayISO(),
    notes: `Spawned from de-vanning of ${sh.number} — containers ${Array.from(b.containers).join(", ")}`,
  }));
}

// ── D2 · TRANSPORT ORDERS PER CARRIER ─────────────────────────────────────────
export function transportOrdersByCarrier(sh: any): Array<{ carrierId: any; units: any[]; kg: number }> {
  const groups: Record<string, any> = {};
  allUnits(sh).forEach(({ unit, leg }) => {
    const cid = unit.carrierId ?? leg.carrierId ?? leg.forwarderId ?? sh.carrierId ?? sh.forwarderId ?? "";
    const g = groups[String(cid)] || (groups[String(cid)] = { carrierId: cid, units: [], kg: 0 });
    g.units.push(unit); g.kg += unitKg(unit, sh);
  });
  return Object.values(groups);
}

// ── D10 · ONE DATE, ENTERED AT THE EVENT ──────────────────────────────────────
export type EventKind = "loaded" | "unloaded" | "stuffed" | "shipped" | "discharged" | "cleared" | "delivered";
const FIELD: Record<EventKind, string> = { loaded: "loadedAt", unloaded: "unloadedAt", stuffed: "stuffedAt", shipped: "shippedAt", discharged: "dischargedAt", cleared: "clearedAt", delivered: "deliveredAt" };
/** Stamp an event date on a unit (or on every unit when unitId is null). Header mirrors derive. */
export function stampEvent(sh: any, unitId: any | null, kind: EventKind, dateISO: string): any {
  const f = FIELD[kind];
  const legs = (sh.legs || []).map((leg: any) => ({ ...leg, vehicles: (leg.vehicles || []).map((u: any) => (unitId == null || String(u.id) === String(unitId)) ? { ...u, [f]: dateISO } : u) }));
  const next = { ...sh, legs };
  const all = allUnits(next).map(x => x.unit);
  const min = (k: string) => all.map(u => S(u[k])).filter(Boolean).sort()[0] || "";
  const max = (k: string) => all.map(u => S(u[k])).filter(Boolean).sort().slice(-1)[0] || "";
  // mirrors for legacy readers (header dates) — derived, never typed
  if (kind === "loaded") next.actualLoadingDate = min("loadedAt") || next.actualLoadingDate;
  if (kind === "delivered" || kind === "discharged") next.actualDeliveryDate = max(f) || next.actualDeliveryDate;
  return next;
}
export function derivedHeaderDates(sh: any): { firstLoaded: string; lastDelivered: string } {
  const all = allUnits(sh).map(x => x.unit);
  const sorted = (k: string) => all.map(u => S(u[k])).filter(Boolean).sort();
  return { firstLoaded: sorted("loadedAt")[0] || "", lastDelivered: sorted("deliveredAt").slice(-1)[0] || sorted("dischargedAt").slice(-1)[0] || "" };
}

// ── D3 · LEGS FROM INCOTERMS ──────────────────────────────────────────────────
export interface LegProposal { mode: string; kind: string; from: string; to: string; responsibility: "Marianna" | "Supplier" | "Client"; customs?: "export" | "import" | null; }
export function legsFromIncoterms(buy: string, sell: string, ctx: { producer?: string; pol?: string; pod?: string; ourWarehouse?: string; client?: string; isSea?: boolean; direction?: string }): LegProposal[] {
  const B = S(buy).toUpperCase(), Se = S(sell).toUpperCase();
  const legs: LegProposal[] = [];
  const exportCustoms = ctx.direction === "EXPORT" ? "export" : null;
  const importCustoms = ctx.direction === "IMPORT" ? "import" : null;
  // pre-carriage
  if (["EXW", "FCA"].includes(B)) legs.push({ mode: "Road", kind: "road", from: ctx.producer || "producer", to: ctx.isSea ? (ctx.pol || "POL") : (ctx.client || ctx.ourWarehouse || "destination"), responsibility: "Marianna", customs: exportCustoms });
  else if (["DAP", "DPU", "DDP"].includes(B)) legs.push({ mode: "Road", kind: "road", from: ctx.producer || "producer", to: ctx.ourWarehouse || "our warehouse", responsibility: "Supplier" });
  // main carriage
  if (ctx.isSea) {
    const ours = !["CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"].includes(B) && ["CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"].includes(Se);
    legs.push({ mode: "Sea", kind: "sea", from: ctx.pol || "POL", to: ctx.pod || "POD", responsibility: ours ? "Marianna" : (["CFR", "CIF", "CPT", "CIP"].includes(B) ? "Supplier" : "Client"), customs: importCustoms });
  }
  // on-carriage
  if (["DAP", "DPU", "DDP"].includes(Se)) legs.push({ mode: "Road", kind: "road", from: ctx.isSea ? (ctx.pod || "POD") : (ctx.ourWarehouse || "our warehouse"), to: ctx.client || "client", responsibility: "Marianna" });
  return legs;
}

// ── D11 · ONE DOCUMENT REGISTER (derived view over the three sources) ─────────
export interface DocRow { kind: string; ref: string; status: "Expected" | "Sent" | "Returned" | "Have it" | "N/A"; date?: string; link?: string; unit?: string; }
export function documentRegister(sh: any, protocols: any[] = []): DocRow[] {
  const rows: DocRow[] = [];
  const toStatus = S(sh?.confirmationStatus) === "Sent" || S(sh?.confirmationStatus) === "Confirmed" ? "Sent" : "Expected";
  rows.push({ kind: "Transport order", ref: S(sh?.transportOrderNo || sh?.number), status: toStatus as any, date: S(sh?.confirmationSentAt) });
  (protocols || []).forEach((p: any) => rows.push({ kind: "Loading protocol", ref: S(p.number), status: p.status === "Returned" ? "Returned" : p.status === "Sent" ? "Sent" : "Expected", date: S(p.returnedAt || p.sentAt), unit: S(p.truckPlate || p.unitId) }));
  (sh?.documents || []).forEach((d: any) => {
    const st = S(d.status).toLowerCase();
    rows.push({ kind: S(d.type || "Document"), ref: S(d.ref || d.number), status: st === "have it" ? "Have it" : st === "sent" ? "Sent" : st === "n/a" ? "N/A" : "Expected", date: S(d.date), link: S(d.link) });
  });
  return rows;
}
export function documentsOutstanding(rows: DocRow[]): DocRow[] { return rows.filter(r => r.status === "Expected" || (r.status === "Sent" && r.kind === "Loading protocol")); }
