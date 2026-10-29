// ─────────────────────────────────────────────────────────────────────────────
import { S, r2, r0 } from "./format";
import { rateOf } from "./fx";   // v7.44.0 (AUD3-L2)
import { poExpectedArrival } from "./po.domain";   // v7.28.5 (Batch L)
import { parseNum } from "./numbers";   // v7.22.2 (FZ-22)
import { sellerPaysCarriage, takenAtSeller } from "./incoterms.domain";   // v7.22.3 (FZ-21): the one incoterm table
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
//   D3  who pays each leg → incoterms.legFreightPayers() (v7.19.0)
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

const num = (v: any): number => parseNum(v);   // v7.22.2 (FZ-22): one reader for every number — spaces and a decimal comma read the same everywhere

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

export interface CutOffWarning { unit: string; loadingDate: string; latest: string; booking: string; delivery?: string; cutOff?: string; }
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
    // v7.30.15 (owner test 21 Oct): a truck whose delivery date is known is judged by it — arriving on the cut-off day makes it; the
    // loading date plus the transit days is the estimate only while no delivery date is set
    const cut = S(b.cutOff).slice(0, 10); const delivery = S(unitUnloadedAt(u) || u.plannedDeliveryDate || leg.plannedDeliveryDate).slice(0, 10);
    if (delivery) { if (delivery > cut) out.push({ unit: S(u.truckPlate || u.id), loadingDate: date, latest: "", booking: b.number || "(booking)", delivery, cutOff: cut }); return; }
    if (!date) return;
    const latest = latestLoadingDate(b.cutOff, u.transitDays ?? 1);
    if (latest && date > latest) out.push({ unit: S(u.truckPlate || u.id), loadingDate: date, latest, booking: b.number || "(booking)", cutOff: cut });
  }));
  return out;
}

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

// ── D3 · v7.19.0 (A-INC-1): legsFromIncoterms retired (called nowhere) — who pays each leg comes from incoterms.legFreightPayers ──

// ── D11 · ONE DOCUMENT REGISTER (derived view over the three sources) ─────────
export interface DocRow { kind: string; ref: string; status: "Expected" | "Sent" | "Returned" | "Have it" | "N/A"; date?: string; link?: string; unit?: string; }
export function documentRegister(sh: any, protocols: any[] = []): DocRow[] {
  const rows: DocRow[] = [];
  const toStatus = S(sh?.confirmationStatus) === "Sent" || S(sh?.confirmationStatus) === "Confirmed" ? "Sent" : "Expected";
  rows.push({ kind: "Transport order", ref: S(sh?.transportOrderNo || sh?.number), status: toStatus as any, date: S(sh?.confirmationSentAt) });
  (protocols || []).forEach((p: any) => rows.push({ kind: "Loading protocol", ref: S(p.number), status: p.status === "Returned" ? "Returned" : p.status === "Sent" ? "Sent" : "Expected", date: S(p.returnedAt || p.sentAt), unit: S(p.truckPlate || p.unitId) }));
  (sh?.documents || []).forEach((d: any) => {
    const st = S(d.status).toLowerCase();
    rows.push({ kind: S(d.type) === "Other" && S(d.description) ? `Other — ${S(d.description)}` : S(d.type || "Document"), ref: S(d.ref || d.number), /* v7.18.2 (A-AU-4): Other shows its description */ status: st === "have it" ? "Have it" : st === "sent" ? "Sent" : st === "n/a" ? "N/A" : "Expected", date: S(d.date), link: S(d.link) });
  });
  return rows;
}
export function documentsOutstanding(rows: DocRow[]): DocRow[] { return rows.filter(r => r.status === "Expected" || (r.status === "Sent" && r.kind === "Loading protocol")); }

// ── v6.92.0 (Round 8): LEDGER DISCIPLINE ON ALLOCATIONS ───────────────────────
/** A-R8-14: Σ allocations of a goods row across trucks may never exceed the row's kg. */
export function allocationRemaining(sh: any, goodsLineId: any, exceptUnitId?: any): number {
  const g = (sh?.goods || []).find((x: any) => String(x.id) === String(goodsLineId));
  if (!g) return 0;
  let used = 0;
  allUnits(sh).forEach(({ unit }) => { if (exceptUnitId != null && String(unit.id) === String(exceptUnitId)) return; (unit.load || []).forEach((a: any) => { if (String(a.goodsLineId) === String(goodsLineId)) used += num(a.qtyKg); }); });
  return Math.max(0, r0(num(g.qtyKg) - used));
}
export function setUnitLoad(sh: any, unitId: any, goodsLineId: any, kg: any): { sh: any; error?: string; remaining: number } {
  const want = r0(num(kg));
  const remaining = allocationRemaining(sh, goodsLineId, unitId);
  if (want > remaining) return { sh, error: `Only ${remaining.toLocaleString("pl-PL")} kg of this line remain unallocated — a truck cannot carry more than the shipment (and the sale) holds.`, remaining };
  const legs = (sh.legs || []).map((leg: any) => ({ ...leg, vehicles: (leg.vehicles || []).map((u: any) => {
    if (String(u.id) !== String(unitId)) return u;
    const rest = (u.load || []).filter((a: any) => String(a.goodsLineId) !== String(goodsLineId));
    return { ...u, load: want > 0 ? [...rest, { goodsLineId, qtyKg: want }] : rest };
  }) }));
  return { sh: syncUnitKgMirrors({ ...sh, legs }), remaining: remaining - want };
}
/** A-R8-12: automatic split — one truck takes everything; adding a truck re-splits evenly; explicit shares respected. */
export function autoAllocate(sh: any, legIndex = 0): any {
  const leg = (sh?.legs || [])[legIndex]; if (!leg) return sh;
  const trucks = (leg.vehicles || []).filter((u: any) => isTruck(u, leg));
  if (!trucks.length || !(sh.goods || []).length) return sh;
  // v6.99.8: units set BY HAND keep their loads; every other truck shares what remains (per goods row).
  const manualUnits = trucks.filter((u: any) => u.manualLoad && (u.load || []).some((a: any) => num(a.qtyKg) > 0));
  const autoUnits = trucks.filter((u: any) => !manualUnits.includes(u));
  if (!autoUnits.length) return sh;
  const goods = sh.goods || [];
  const remaining = goods.map((g: any) => Math.max(0, num(g.qtyKg) - manualUnits.reduce((s: number, u: any) => s + (u.load || []).filter((a: any) => String(a.goodsLineId) === String(g.id)).reduce((x: number, a: any) => x + num(a.qtyKg), 0), 0)));
  const n = autoUnits.length;
  const legs = (sh.legs || []).map((l: any, i: number) => i !== legIndex ? l : { ...l, vehicles: (l.vehicles || []).map((u: any) => {
    const k = autoUnits.indexOf(u); if (k < 0) return u;
    const load = goods.map((g: any, gi: number) => { const base = Math.floor(remaining[gi] / n); const extra = k === n - 1 ? remaining[gi] - base * n : 0; return { goodsLineId: g.id, qtyKg: base + extra }; }).filter((a: any) => a.qtyKg > 0);
    return { ...u, load, manualLoad: false };
  }) });
  return syncUnitKgMirrors({ ...sh, legs });
}
/** A-R8-16: a truck's kilos are a BUDGET across the containers it feeds. */
export function truckRemainingForFeeding(sh: any, truckId: any, exceptContainerId?: any): number {
  const truck = findUnit(sh, truckId); if (!truck) return 0;
  const total = unitKg(truck, sh);
  let used = 0;
  allUnits(sh).forEach(({ unit, leg }) => {
    if (!isContainer(unit, leg)) return;
    if (exceptContainerId != null && String(unit.id) === String(exceptContainerId)) return;
    feedersOf(unit).forEach(f => { if (String(f.fromUnitId) === String(truckId)) used += num(f.kg) > 0 ? num(f.kg) : total; });
  });
  return Math.max(0, r0(total - used));
}
export function addFeederChecked(sh: any, containerId: any, truckId: any, kg?: any): { sh: any; error?: string } {
  const remaining = truckRemainingForFeeding(sh, truckId, containerId);
  if (remaining <= 0) return { sh, error: "This truck is already fully placed in other containers." };
  const want = num(kg) > 0 ? r0(num(kg)) : remaining;
  if (want > remaining) return { sh, error: `Only ${remaining.toLocaleString("pl-PL")} kg of this truck remain to be placed.` };
  const cont = findUnit(sh, containerId); const cur = feedersOf(cont).filter(f => String(f.fromUnitId) !== String(truckId));
  return { sh: setFeeders(sh, containerId, [...cur, { fromUnitId: truckId, kg: want }]) };
}
// ── A-R8-18 / A-R8-19: CARRIER × LEG is the unit of work (transport order AND expected cost line) ──
export function jobsByCarrierLeg(sh: any): Array<{ key: string; carrierId: any; legIndex: number; mode: string; units: any[]; kg: number; amount: number; currency: string }> {
  const jobs: Record<string, any> = {};
  (sh?.legs || []).forEach((leg: any, li: number) => (leg.vehicles || []).forEach((u: any) => {
    const cid0 = carrierOfUnit(sh, leg, u);   // v6.99.39 (D-2): one answer, shared with the transport order
    const cid = cid0 == null ? "" : cid0;
    // v6.99.15 (A-R11-8): an unnamed unit with a PRICE still produces its cost line (supplier blank, flagged) — a missing line was worse than a blank supplier
    const keyId = (cid === "" || cid == null) ? (num(u.costAmount ?? u.unitPrice) > 0 ? "__unassigned__" : null) : cid;
    if (keyId == null) return;
    const key = `${String(keyId)}|${li}`;
    const j = jobs[key] || (jobs[key] = { key, carrierId: keyId === "__unassigned__" ? null : keyId, legIndex: li, mode: String(leg.mode || ""), units: [], kg: 0, amount: 0, currency: String(u.priceCurrency || leg.costCurrency || "PLN").toUpperCase() });
    j.units.push(u); j.kg += unitKg(u, sh); j.amount += num(u.costAmount ?? u.unitPrice);
  }));
  return Object.values(jobs);
}
/** Expected freight cost lines: one per carrier × leg (source LEGCAR:{leg}:{carrier}); replace-by-source. */
let fxFallback: (cur: string) => number = () => 1;
export function setFxFallback(fn: (cur: string) => number) { fxFallback = fn; }
// v7.19.7 (A-RV-36): A SAVE NEVER DOUBLES A FREIGHT LINE NOR FORGETS ITS INVOICE. Each carrier × leg line CONTINUES the line it was
// last time (same source), or ADOPTS an old freight line of its leg and type written before unit prices (no source) — the old line
// used to stay beside it, doubling the freight (13 shipments on the 2 Oct file). It keeps the line's id, invoice status and
// reference (every save used to reset them to Expected); an INVOICED amount stays — the invoice is the fact, and the screen flags a
// difference from the unit prices — while an expected one follows the units. An invoiced line no unit makes any more is kept as an
// ordinary line, never dropped.
const isInvoicedLine = (c: any) => !!c && !["", "Expected"].includes(String(c.invoiceStatus || "Expected"));
export function costLinesByCarrierLeg(sh: any, resolveName: (id: any) => string = () => "", payers?: Array<{ payer: string }>): any[] {
  const managed = (c: any) => /^(LEGCAR:|LEG:|leg-freight:)/.test(String(c?.source || ""));   // v6.99.9: the legacy per-leg lines are replaced too
  const keep = (sh?.costs || []).filter((c: any) => !managed(c));
  const before = (sh?.costs || []).filter((c: any) => String(c?.source || "").startsWith("LEGCAR:"));
  const typeOf = (mode: string) => mode.toLowerCase() === "sea" ? "sea_freight" : mode.toLowerCase() === "air" ? "air_freight" : "road_freight";
  const legOfOld = (c: any) => { const m = ({ road_freight: "Road", sea_freight: "Sea", air_freight: "Air", rail_freight: "Rail" } as Record<string, string>)[String(c?.type || "")]; return m ? (sh?.legs || []).findIndex((l: any) => String(l?.mode || "") === m) : -1; };
  const adopted = new Set<any>(), continued = new Set<any>();
  const lines = jobsByCarrierLeg(sh).filter(j => j.amount > 0 && (!payers || !payers[j.legIndex] || payers[j.legIndex].payer === "us")).map(j => {   // v7.19.0 (A-INC-1): a leg that is not ours makes no line
    const legFx = num((sh.legs[j.legIndex] || {}).costFxRate);
    const fx = (j.currency !== "PLN" && (!legFx || legFx === 1)) ? (num(fxFallback(j.currency)) || 1) : (legFx || 1);   // v6.99.14: a legacy leg at 1.0 uses the reference
    const base: any = { id: `legcar-${j.legIndex}-${j.carrierId}`, type: typeOf(j.mode),
      label: `${j.mode} freight — leg ${j.legIndex + 1} — ${j.carrierId ? (resolveName(j.carrierId) || "carrier") : "⚠ carrier not set on the unit"} (${j.units.length} unit${j.units.length > 1 ? "s" : ""})`,
      supplierId: j.carrierId || null, amount: r2(j.amount), currency: j.currency, fxRate: fx, amountPLN: r2(j.amount * fx), invoiceStatus: "Expected", responsibility: "Marianna", source: `LEGCAR:${j.legIndex}:${j.carrierId ?? "unassigned"}`, needsCarrier: !j.carrierId };
    // the same carrier × leg as last time — by its source, or by its leg and supplier when the source still names an earlier carrier id
    let prev: any = before.find((c: any) => !continued.has(c) && String(c.source) === base.source) || before.find((c: any) => !continued.has(c) && String(c.source).split(":")[1] === String(j.legIndex) && c.supplierId != null && String(c.supplierId) === String(j.carrierId ?? "")) || null;
    if (prev) continued.add(prev);
    else { const cand = keep.filter((c: any) => !adopted.has(c) && !String(c?.source || "") && !c?._customsAuto && c?.type === base.type && legOfOld(c) === j.legIndex);
      prev = cand.find((c: any) => String(c.supplierId ?? "") === String(j.carrierId ?? "")) || cand[0] || null; if (prev) adopted.add(prev); }
    if (!prev) return base;
    const inv = isInvoicedLine(prev);
    return { ...base, id: prev.id ?? base.id, invoiceStatus: prev.invoiceStatus || "Expected", ...(prev.invoiceRef ? { invoiceRef: prev.invoiceRef } : {}), ...(prev.allocationMethod ? { allocationMethod: prev.allocationMethod } : {}), ...(prev.notes ? { notes: prev.notes } : {}),
      ...(inv ? { amount: num(prev.amount), currency: prev.currency || base.currency, fxRate: num(prev.fxRate) || base.fxRate, amountPLN: num(prev.amountPLN) || r2(num(prev.amount) * rateOf(prev)) } : {}) };
  });
  const released = before.filter((c: any) => !continued.has(c) && isInvoicedLine(c) && (num(c.amount) > 0 || num(c.amountPLN) > 0)).map((c: any) => { const { source, needsCarrier, ...rest } = c; return { ...rest, notes: c.notes || c.label || "Freight" }; });
  return [...keep.filter((c: any) => !adopted.has(c)), ...released, ...lines];
}
/** v7.19.7 (A-RV-36): an invoiced carrier × leg line whose amount differs from its unit prices (the screen flags it). */
export function invoicedVsUnits(sh: any, c: any): { invoiced: number; units: number } | null {
  const m = String(c?.source || "").match(/^LEGCAR:(\d+):(.*)$/); if (!m || !isInvoicedLine(c)) return null;
  const j = jobsByCarrierLeg(sh).find(x => x.legIndex === Number(m[1]) && String(x.carrierId ?? "unassigned") === m[2]); const units = j ? r2(j.amount) : 0;
  return Math.abs(units - num(c.amount)) > 0.01 ? { invoiced: num(c.amount), units } : null;
}


/** v6.99.9: legacy readers still use unit.qtyKg — keep it equal to the derived figure (mirror until the DDL). */
export function syncUnitKgMirrors(sh: any): any {
  const legs = (sh?.legs || []).map((leg: any) => ({ ...leg, vehicles: (leg.vehicles || []).map((u: any) => {
    const has = (u.load || []).some((a: any) => num(a?.qtyKg) > 0) || feedersOf(u).length > 0;
    if (!has) return u;
    const kg = unitKg(u, sh); return num(u.qtyKg) === kg ? u : { ...u, qtyKg: kg };
  }) }));
  return { ...sh, legs };
}


/** v6.99.14 (A-R10-3): a container's recorder is its feeder trucks' recorder(s) — live, not a copy. */
export function containerRecorder(container: any, sh: any): string {
  const fs = feedersOf(container);
  if (!fs.length) return S(container?.tempRecorderNo);
  const recs = fs.map(f => S(findUnit(sh, f.fromUnitId)?.tempRecorderNo)).filter(Boolean);
  return Array.from(new Set(recs)).join(", ") || S(container?.tempRecorderNo);
}


/** v6.99.39 (D-2, owner): who carries a unit. The unit's own carrier; on a sea / air / rail leg the booking's forwarder;
 *  otherwise nobody. Used by the cost lines AND the transport order, so the two can never name different carriers. */
export function carrierOfUnit(sh: any, leg: any, u: any): any | null {
  if (u?.carrierId != null && u.carrierId !== "") return u.carrierId;
  const seaLike = ["sea", "air", "rail"].includes(String(leg?.mode || "").toLowerCase());
  if (seaLike) { const fwd = (sh?.bookings || [])[0]?.forwarderId; if (fwd != null && fwd !== "") return fwd; }
  // legacy: a leg-level id only when NO unit on the leg names a carrier
  const anyNamed = (leg?.vehicles || []).some((x: any) => x?.carrierId != null && x.carrierId !== "");
  if (!anyNamed) { const legacy = leg?.carrierId ?? leg?.forwarderId; if (legacy != null && legacy !== "") return legacy; }
  return null;
}

// ── v6.99.62 (A-SE-1, owner 25 Sept): the containers sail on the booked vessel ──
// When the booking's ETD / ETA changes, every sea/air/rail unit that FOLLOWS the booking takes the new date: a unit follows when
// its date was never typed by hand (no manual flag) and is empty or still equal to the booking's previous date. A unit dated by
// hand keeps its date — the screen shows the difference and offers ↺ back to the booking.
export function followBookingDates(legs: any[], key: "etd" | "eta", prevValue: any, newValue: any): any[] {
  const field = key === "etd" ? "plannedLoadingDate" : "plannedDeliveryDate";
  const flag = key === "etd" ? "loadDateManual" : "deliveryDateManual";
  const prev = String(prevValue || "");
  return (legs || []).map((l: any) => !["sea", "air", "rail"].includes(String(l?.mode || "").toLowerCase()) ? l
    : { ...l, vehicles: (l.vehicles || []).map((u: any) => (u[flag] || (u[field] && String(u[field]) !== prev)) ? u : { ...u, [field]: newValue }) });
}

// ── v6.99.73 (A-TO-7, owner 28 Sept): a container carries what its trucks put in it ──────────────────────────────────
// A container has no load of its own: its trucks fill it (feeders). The transport order read `u.load` only and, finding
// nothing, printed ALL the shipment's goods on every container — SHP-2026-0035's two containers showed 42 pallets each
// instead of 21. The effective load is the trucks' load, scaled by the split kg when a truck feeds more than one container.
export function effectiveLoad(sh: any, u: any): Array<{ goodsLineId: any; qtyKg: number }> {
  if ((u?.load || []).length) return u.load;
  const fs = feedersOf(u); if (!fs.length) return [];
  const acc = new Map<string, { goodsLineId: any; qtyKg: number }>();
  fs.forEach(f => {
    const t = findUnit(sh, f.fromUnitId); const tl = (t?.load || []).filter((a: any) => num(a.qtyKg) > 0); if (!tl.length) return;
    const tKg = tl.reduce((s: number, a: any) => s + num(a.qtyKg), 0);
    const share = num(f.kg) > 0 ? Math.min(1, num(f.kg) / tKg) : 1;
    tl.forEach((a: any) => { const k = String(a.goodsLineId); const cur = acc.get(k) || { goodsLineId: a.goodsLineId, qtyKg: 0 }; cur.qtyKg += num(a.qtyKg) * share; acc.set(k, cur); });
  });
  return Array.from(acc.values()).map(x => ({ ...x, qtyKg: Math.round(x.qtyKg * 1000) / 1000 }));
}

// ── v6.99.75 (A-UN-4): the four facts a transport order needs on each unit — one rule for "Mark sent" and the red fields ──
export function unitGaps(u: any): Array<"pickup place" | "delivery place" | "loading date" | "delivery date"> {
  const out: any[] = [];
  if (!(u?.pickupText || u?.pickupLocationId)) out.push("pickup place");
  if (!(u?.deliveryText || u?.deliveryLocationId)) out.push("delivery place");
  if (!u?.plannedLoadingDate) out.push("loading date");
  if (!u?.plannedDeliveryDate) out.push("delivery date");
  return out;
}

// ── v6.99.75 (A-UN-1, owner 28 Sept): a truck loads where ITS goods are ─────────────────────────────────────────────
// Several POs on one SO: each truck follows the goods it carries, never the SO. A load line → its goods row → its PO:
// on EXW / FCA the PO's named place is the producer's site and the PO's loading date is the day. Goods from stock load
// at the lot's location. A truck whose goods come from two places is named, never silently given one of them.
export interface LoadPlace { id: any; text: string; ref: string; date: string; deliveryId?: any; deliveryText?: string; }
// v7.22.3 (FZ-21): "the supplier delivers" = the seller pays the main carriage — read from the one table (sellerPaysCarriage)
const samePlace = (aId: any, aText: any, bId: any, bText: any) => (aId != null && aId !== "" && bId != null && bId !== "") ? String(aId) === String(bId) : S(aText).toLowerCase() === S(bText).toLowerCase() && !!S(aText);
/** Where ONE goods row is collected (the rules above, unchanged since v6.99.93). */
export function placeOfGoods(g: any, pos: any[] = [], lots: any[] = []): LoadPlace | null {
  const po = (pos || []).find((p: any) => String(p.number) === String(g?.poRef)) || null;
  const lot = (lots || []).find((l: any) => String(l.number) === String(g?.lotRef)) || null;
  // v6.99.93 (A-GR-1, owner 1 Oct — my regression from v6.99.83): goods ALREADY IN STOCK load where the lot is (the lot owns its
  // location); the PO's terms only say where goods not yet received will be collected
  if (lot && num(lot.physicalKg) > 0 && (lot.locationId != null || S(lot.locationText))) return { id: lot.locationId ?? null, text: S(lot.locationText), ref: S(lot.number), date: "" };
  if (po && takenAtSeller(po.buyIncoterm) && (po.destinationLocationId != null || S(po.destinationText))) return { id: po.destinationLocationId ?? null, text: S(po.destinationText || po.supplier?.name || po.supplier), ref: S(po.number), date: S(po.loadingDate) };
  // v6.99.83 (A-UN-5, owner 30 Sept): on a supplier-delivered PO (DDP, DAP, CIF…) the truck loads at the SUPPLIER and delivers to
  // the PO's destination — the lot's location (where it will arrive) is never the loading place; a lot's location counts only in stock
  if (po && sellerPaysCarriage(po.buyIncoterm) && S(po.supplier?.name || po.supplier)) return { id: null, text: S(po.supplier?.name || po.supplier), ref: S(po.number), date: S(po.loadingDate), deliveryId: po.destinationLocationId ?? null, deliveryText: S(po.destinationText) };
  return null;
}
export function truckLoadPlaces(sh: any, u: any, pos: any[] = [], lots: any[] = []): LoadPlace[] {
  const out: LoadPlace[] = [];
  (u?.load || []).filter((a: any) => num(a.qtyKg) > 0).forEach((a: any) => {
    const g = (sh?.goods || []).find((x: any) => String(x.id) === String(a.goodsLineId)); if (!g) return;
    const p = placeOfGoods(g, pos, lots);
    if (p && !out.some(q => samePlace(q.id, q.text, p!.id, p!.text))) out.push(p);
  });
  return out;
}

// ── v7.15.0 (A-LS-3, owner 9 Oct: "a single truck can collect from 2 different producers"): THE TRUCK'S LOADING STOPS ──
// Derived from what the truck carries — never typed: each load line's goods row brings its place (placeOfGoods) and date; rows
// from the same place make one stop; stops in date order. What is collected at each stop is listed (product, kilos).
export interface LoadingStop { key: string; id: any; text: string; date: string; refs: string[]; goodsLineIds: string[]; kg: number; lines: Array<{ goodsLineId: string; product: string; variety: string; size: string; kg: number }>; }
export const stopKeyOf = (p: { id: any; text: any }) => (p.id != null && p.id !== "" ? `id:${p.id}` : `t:${S(p.text).toLowerCase()}`);
export function truckLoadingStops(sh: any, u: any, pos: any[] = [], lots: any[] = []): LoadingStop[] {
  const out: LoadingStop[] = [];
  (u?.load || []).filter((a: any) => num(a.qtyKg) > 0).forEach((a: any) => {
    const g = (sh?.goods || []).find((x: any) => String(x.id) === String(a.goodsLineId)); if (!g) return;
    const p = placeOfGoods(g, pos, lots); if (!p) return;
    let s = out.find(q => samePlace(q.id, q.text, p.id, p.text));
    if (!s) { s = { key: stopKeyOf(p), id: p.id, text: p.text, date: p.date, refs: [], goodsLineIds: [], kg: 0, lines: [] }; out.push(s); }
    if (p.ref && !s.refs.includes(p.ref)) s.refs.push(p.ref);
    if (!s.date && p.date) s.date = p.date;
    s.goodsLineIds.push(String(g.id)); s.kg += num(a.qtyKg);
    s.lines.push({ goodsLineId: String(g.id), product: S(g.product), variety: S(g.variety), size: S(g.size), kg: num(a.qtyKg) });
  });
  return out.sort((x, y) => (x.date || "9999-12-31").localeCompare(y.date || "9999-12-31") || x.text.localeCompare(y.text));
}
/** The truck limited to one stop's goods (for that producer's loading protocol). */
export function unitForStop(u: any, stop: LoadingStop): any { return { ...u, load: (u?.load || []).filter((a: any) => stop.goodsLineIds.includes(String(a.goodsLineId))) }; }
export interface TruckPlaceNote { places: LoadPlace[]; proposal: LoadPlace | null; mismatch: LoadPlace | null; twoPlaces: boolean; }
export function truckPlaceNote(sh: any, u: any, pos: any[] = [], lots: any[] = []): TruckPlaceNote {
  const places = truckLoadPlaces(sh, u, pos, lots);
  const proposal = places.length === 1 ? places[0] : null;
  const hasPickup = u?.pickupLocationId != null || !!S(u?.pickupText);
  const mismatch = proposal && hasPickup && !samePlace(u.pickupLocationId, u.pickupText, proposal.id, proposal.text) ? proposal : null;
  return { places, proposal, mismatch, twoPlaces: places.length > 1 };
}

// ── v6.99.75 (A-UN-2): containers sail on their booking — POL, POD, ETD, ETA fill every container that has none ──────
export function bookingOf(sh: any, u: any): any | null { const bs = sh?.bookings || []; return bs.find((b: any) => String(b.id) === String(u?.bookingId)) || bs[0] || null; }
const isSeaLike = (l: any) => ["sea", "air", "rail"].includes(S(l?.mode).toLowerCase());
export function fillFromBooking(sh: any): any {
  if (!(sh?.bookings || []).length) return sh;
  let changed = false;
  const legs = (sh.legs || []).map((l: any) => !isSeaLike(l) ? l : { ...l, vehicles: (l.vehicles || []).map((u: any) => {
    const b = bookingOf(sh, u); if (!b) return u; const n = { ...u };
    if (!S(n.plannedLoadingDate) && S(b.etd)) n.plannedLoadingDate = b.etd;
    if (!S(n.plannedDeliveryDate) && S(b.eta)) n.plannedDeliveryDate = b.eta;
    if (n.pickupLocationId == null && !S(n.pickupText) && (b.polId != null || S(b.pol))) { n.pickupLocationId = b.polId ?? null; n.pickupText = S(b.pol); }
    if (n.deliveryLocationId == null && !S(n.deliveryText) && (b.podId != null || S(b.pod))) { n.deliveryLocationId = b.podId ?? null; n.deliveryText = S(b.pod); }
    if (JSON.stringify(n) !== JSON.stringify(u)) changed = true; return n; }) });
  return changed ? { ...sh, legs } : sh;
}
/** When the booking's POL or POD changes, a container that was empty or still on the old port takes the new one. */
export function followBookingPlace(legs: any[], key: "pol" | "pod", prev: { id: any; name: any }, next: { id: any; name: any }): any[] {
  const idF = key === "pol" ? "pickupLocationId" : "deliveryLocationId", txF = key === "pol" ? "pickupText" : "deliveryText";
  return (legs || []).map((l: any) => !isSeaLike(l) ? l : { ...l, vehicles: (l.vehicles || []).map((u: any) => {
    const empty = u[idF] == null && !S(u[txF]); const onOld = !empty && samePlace(u[idF], u[txF], prev?.id, prev?.name);
    return (empty || onOld) ? { ...u, [idF]: next?.id ?? null, [txF]: S(next?.name) } : u; }) });
}
/** A container discharging somewhere other than its booking's POD (or loading off its POL) is named. */
export function containerPlaceNote(sh: any, u: any): { pol: string | null; pod: string | null } {
  const b = bookingOf(sh, u); if (!b) return { pol: null, pod: null };
  const polOff = (b.polId != null || S(b.pol)) && (u.pickupLocationId != null || S(u.pickupText)) && !samePlace(u.pickupLocationId, u.pickupText, b.polId, b.pol);
  const podOff = (b.podId != null || S(b.pod)) && (u.deliveryLocationId != null || S(u.deliveryText)) && !samePlace(u.deliveryLocationId, u.deliveryText, b.podId, b.pod);
  return { pol: polOff ? S(b.pol) : null, pod: podOff ? S(b.pod) : null };
}

// ── v6.99.86 (owner 1 Oct): the dates a shipment SHOWS — planned and actual, from its units ─────────────────────────
// The list showed the header's dates stored at creation and the detail the leg's planned dates; neither read the units,
// where the planned dates live and where the actual loading / unloading are entered. One reader for both.
export interface ShipmentDates { plannedLoading: string; plannedDelivery: string; loaded: string; delivered: string; }
/** v7.27.18 (A-D-4, P-12): a truck's actual loading / unloading date — one reader for the two generations of the field: the editor
*  writes loadedAt / unloadedAt; trucks entered before keep actualLoadDate / actualUnloadDate (51 of 57 on the real copy of 15 Oct). */
export function unitLoadedAt(u: any): string { return S(u?.loadedAt) || S(u?.actualLoadDate); }
export function unitUnloadedAt(u: any): string { return S(u?.unloadedAt) || S(u?.actualUnloadDate); }
export function shipmentDates(sh: any): ShipmentDates {
  const units = allUnits(sh).map(x => x.unit); const legs = sh?.legs || [];
  const pick = (vals: string[], last = false) => { const v = vals.map(S).filter(Boolean).sort(); return last ? (v[v.length - 1] || "") : (v[0] || ""); };
  return {
    plannedLoading: pick(units.map((u: any) => u.plannedLoadingDate)) || pick(legs.map((l: any) => l.plannedPickupDate)) || S(sh?.loadingDate),
    plannedDelivery: pick(units.map((u: any) => u.plannedDeliveryDate), true) || pick(legs.map((l: any) => l.plannedDeliveryDate), true) || S(sh?.expectedDeliveryDate),
    loaded: pick(units.map((u: any) => unitLoadedAt(u))),
    delivered: pick(units.map((u: any) => S(u.deliveredAt) || unitUnloadedAt(u) || S(u.dischargedAt)), true),
  };
}
/** When a lot delivered by the supplier is received: the truck's actual unloading, else its planned delivery, else the PO's. */
export function suggestedReceiptDate(lot: any, shipments: any[], po: any, todayISO: string): { date: string; from: string } {
  const sh = (shipments || []).find((s: any) => String(s?.status) !== "Cancelled" && (s.goods || []).some((g: any) => String(g.lotRef) === String(lot?.number)));
  if (sh) { const d = shipmentDates(sh); if (d.delivered) return { date: d.delivered, from: `${sh.number} unloaded` }; if (d.plannedDelivery) return { date: d.plannedDelivery, from: `${sh.number} planned delivery` }; }
  { const arr = po ? poExpectedArrival(po, shipments) : ""; if (arr) return { date: arr, from: `${po.number} expected delivery` }; }   // v7.28.5 (Batch L): the PO's one promised date
  if (S(lot?.arrivalDate)) return { date: S(lot.arrivalDate), from: "the lot's expected arrival" };
  return { date: todayISO, from: "today" };
}

// ── v6.99.95 (A-GR-3, owner ruling 1 Oct): THE TOUR OF A TRUCK, derived from the documents that own each fact ─────────
// Loading stops = where its goods are (the lot's stock location; for goods not yet received the PO's place) — the lots and
// POs own them. Unloading stops = the destinations of the SOs whose goods it carries, each with that SO's delivery date —
// the SOs own them. The truck stores only the ORDER of its drops (unit.stopOrder: SO numbers). Nothing is typed twice.
export interface TourLoad { id: any; text: string; refs: string[]; kg: number; }
export interface TourDrop { soNumber: string; client: string; placeId: any; placeText: string; date: string; kg: number; missing: boolean; }
export interface Tour { loads: TourLoad[]; drops: TourDrop[]; isTour: boolean; missing: string[]; }
export function truckTour(sh: any, u: any, pos: any[] = [], lots: any[] = [], orders: any[] = []): Tour {
  const loads: TourLoad[] = []; const drops: TourDrop[] = [];
  (u?.load || []).filter((a: any) => num(a.qtyKg) > 0).forEach((a: any) => {
    const g = (sh?.goods || []).find((x: any) => String(x.id) === String(a.goodsLineId)); if (!g) return;
    const kg = num(a.qtyKg);
    const lp = truckLoadPlaces(sh, { load: [a] }, pos, lots)[0];
    if (lp) { const hit = loads.find(l => samePlace(l.id, l.text, lp.id, lp.text)); if (hit) { hit.kg += kg; if (!hit.refs.includes(lp.ref)) hit.refs.push(lp.ref); } else loads.push({ id: lp.id, text: lp.text, refs: [lp.ref], kg }); }
    const soNo = S(g.soRef); if (!soNo) return;
    const so = (orders || []).find((o: any) => String(o.number) === soNo) || null;
    const hit = drops.find(dr => dr.soNumber === soNo);
    if (hit) { hit.kg += kg; return; }
    const placeId = so?.destinationLocationId ?? null; const placeText = S(so?.destinationText);
    drops.push({ soNumber: soNo, client: S(so?.client?.name), placeId, placeText, date: S(so?.deliveryDate), kg, missing: placeId == null && !placeText });
  });
  const order: string[] = (u?.stopOrder || []).map(String);
  drops.sort((x, y) => { const ix = order.indexOf(x.soNumber), iy = order.indexOf(y.soNumber); if (ix >= 0 || iy >= 0) return (ix < 0 ? 999 : ix) - (iy < 0 ? 999 : iy); return x.date.localeCompare(y.date) || x.soNumber.localeCompare(y.soNumber); });
  loads.forEach(l => { l.kg = Math.round(l.kg * 1000) / 1000; }); drops.forEach(dr => { dr.kg = Math.round(dr.kg * 1000) / 1000; });
  return { loads, drops, isTour: drops.length > 1 || loads.length > 1, missing: drops.filter(dr => dr.missing).map(dr => dr.soNumber) };
}
/** Move one drop up or down in the truck's stop order (the only thing the truck stores about its tour). */
export function moveDrop(tour: Tour, soNumber: string, dir: -1 | 1): string[] {
  const seq = tour.drops.map(dr => dr.soNumber); const i = seq.indexOf(soNumber); const j = i + dir;
  if (i < 0 || j < 0 || j >= seq.length) return seq;
  const out = seq.slice(); [out[i], out[j]] = [out[j], out[i]]; return out;
}
/** The transport order's gaps for a tour truck: every drop needs its SO's destination; the unit's own delivery place is not asked. */
export function tourGaps(u: any, tour: Tour | null): string[] {
  const base = unitGaps(u) as string[];
  if (!tour || !tour.isTour) return base;
  // the drops replace the one delivery place; the loading stops replace the one pickup place when there are any
  return base.filter(g => g === "delivery place" ? false : g === "pickup place" ? !tour.loads.length : true).concat(tour.missing.map(n => `destination of ${n}`));
}


// ══ v7.18.2 (A-AU-4, owner 9 Oct — P-8, 'lists instead of typing'): A SHIPMENT DOCUMENT'S TYPE COMES FROM ONE LIST ══════════════
// The checklist and the register read these types, so a variant ('PL', 'Export declaration MRN') could leave a document
// 'missing' that is there. "BL" stays the stored word (three readers use it), shown as B/L. AWB (air) and the four rows the
// customs-file import writes are on the list too. Anything else is Other, with a description. The variants already stored are
// mapped once per dataset (App, named in the audit trail).
export const DOC_TYPES: { value: string; label: string; system?: boolean }[] = [
  { value: "Invoice", label: "Invoice" }, { value: "Packing list", label: "Packing list" }, { value: "CMR", label: "CMR" },
  { value: "BL", label: "B/L" }, { value: "AWB", label: "AWB (air waybill)" }, { value: "EUR.1", label: "EUR.1" },
  { value: "Phytosanitary certificate", label: "Phytosanitary certificate" }, { value: "Certificate of origin", label: "Certificate of origin" }, { value: "Insurance certificate", label: "Insurance certificate" },   // v7.20.2 (A-INC-2): the certificate a CIF / CIP sale holds
  { value: "Export declaration", label: "Export declaration" }, { value: "Import declaration", label: "Import declaration" }, { value: "T1 transit", label: "T1 transit" },   // v7.27.11 (FZ-16)
  { value: "Transport order", label: "Transport order" }, { value: "Loading protocol", label: "Loading protocol" },
  { value: "Export declaration (EAD)", label: "Export declaration (EAD)", system: true }, { value: "Customs release (CC529C)", label: "Customs release (CC529C)", system: true },
  { value: "Exit confirmation (CC599C)", label: "Exit confirmation (CC599C)", system: true }, { value: "Customs declaration copy (SAD)", label: "Customs declaration copy (SAD)", system: true },
  { value: "Other", label: "Other" },
];
const DOC_ALIASES: Record<string, string> = { "export declaration mrn": "Export declaration", "pl": "Packing list", "loading protokol": "Loading protocol", "loading protokół": "Loading protocol", "coo": "Certificate of origin", "b/l": "BL", "bill of lading": "BL", "phytosanitary": "Phytosanitary certificate", "phyto": "Phytosanitary certificate", "eur1": "EUR.1", "eur 1": "EUR.1" };
/** The list's value for a stored type — the type itself when it is on the list; a known variant mapped; anything else Other. */
export function docTypeOf(typed: any): { type: string; description?: string } {
  const s = S(typed); if (!s) return { type: "" };
  const hit = DOC_TYPES.find(t => t.value.toLowerCase() === s.toLowerCase()); if (hit) return { type: hit.value };
  const al = DOC_ALIASES[s.toLowerCase().replace(/\s+/g, " ")]; if (al) return { type: al };
  return { type: "Other", description: s };
}
