// ── LOAD PLAN (v6.56.0) ──────────────────────────────────────────────────────
// User ruling, Aug 2026 (Option B):
//
//   Keep ONE SHIPMENT = ONE CARRIER. Five trucks from different loading places
//   stay five shipments — "it is more lean like that". Add a grouping object
//   above them instead of making the shipment form carry several carriers.
//
// Named LOAD PLAN, not "consignment": src/consignment.ts already means the
// commercial arrangement where a producer ships goods and we sell and deduct
// before remitting. Two meanings for one word would be worse than a clumsy name.
//
// A load plan is the commercial movement your apple export actually is: five
// trucks collect from three producers, run to the port warehouse, and are
// transshipped into four 45-foot containers. Nine shipments, one export.
//
// DESIGN RULE — it stores LINKS AND THE MAP, nothing numeric.
// Every figure is derived on read from the member shipments. That is what keeps
// the Shipments module untouched and its tests valid, which is the reason
// Option B was chosen over rebuilding the shipment form.
//
// TRANSSHIPMENT MAP — required, and truck-to-container only.
// The forwarder tells you which trucks went into which container once they are
// loaded. What he does NOT tell you is which PALLET NUMBERS went where, and the
// user has flagged that this causes problems when cargo reaches the client. So
// the map records trucks and, where a truck is split, KILOS per container — it
// deliberately does not pretend to pallet identities nobody has. When the
// process changes and the forwarder reports pallet numbers, this is where they
// would go.

function num(v: any): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
}

function cancelled(x: any): boolean {
  const s = String(x?.status || "").trim();
  return s === "Cancelled" || s === "Canceled" || s === "Void";
}

export interface LoadPlanEntry {
  /** Container (or air container) this line describes — the receiving unit. */
  containerRef: string;
  /** Shipment number of the truck feeding it. */
  shipmentRef: string;
  /** Kilos from that truck in this container. Equal to the truck's whole load in
   *  the normal case; smaller when the truck is split across containers. */
  qtyKg: number;
}

export interface LoadPlan {
  id: any;
  number: string;
  name?: string;
  status?: string;
  /** Member shipments — the trucks and the sea/air legs, by number. */
  shipmentRefs: string[];
  /** Truck → container. Required before the plan is complete. */
  map: LoadPlanEntry[];
  notes?: string;
  createdAt?: string;
}

export function nextLoadPlanNumber(existing: any[], year: number): string {
  const prefix = `LDP-${year}-`;
  const n = (existing || [])
    .map(p => String(p?.number || ""))
    .filter(s => s.startsWith(prefix))
    .map(s => parseInt(s.slice(prefix.length), 10))
    .filter(x => isFinite(x))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(n + 1).padStart(4, "0")}`;
}

export function blankLoadPlan(existing: any[], year: number, id: any, todayISO: string): LoadPlan {
  return { id, number: nextLoadPlanNumber(existing, year), name: "", status: "Open", shipmentRefs: [], map: [], notes: "", createdAt: todayISO };
}

/** The member shipments, resolved. Cancelled members stay listed — nothing is
 *  ever deleted — but they are excluded from every total below. */
export function planShipments(plan: any, shipments: any[]): any[] {
  const refs = new Set((plan?.shipmentRefs || []).map((r: any) => String(r)));
  return (shipments || []).filter(s => refs.has(String(s.number)));
}

export interface PlanTotals {
  shipments: number; live: number; cancelled: number;
  kg: number; pallets: number;
  poRefs: string[]; soRefs: string[];
  freightPLN: number;
  protocolsBack: number; protocolsTotal: number;
}

/** Everything numeric about a load plan, derived on read. Nothing here is
 *  stored, so a plan can never disagree with its shipments. */
export function planTotals(plan: any, shipments: any[], costPLN: (sh: any) => number): PlanTotals {
  const members = planShipments(plan, shipments);
  const live = members.filter(s => !cancelled(s));
  const pos = new Set<string>(), sos = new Set<string>();
  let kg = 0, pallets = 0, freight = 0, back = 0, total = 0;
  live.forEach(s => {
    (s.poRefs || []).forEach((r: any) => r && pos.add(String(r)));
    (s.soRefs || []).forEach((r: any) => r && sos.add(String(r)));
    (s.goods || []).forEach((g: any) => { kg += num(g.qtyKg); pallets += num(g.pallets); });
    freight += num(costPLN(s));
    const sheets = Array.isArray(s.loadingProtocols) && s.loadingProtocols.length
      ? s.loadingProtocols : (s.loadingProtocol ? [s.loadingProtocol] : []);
    sheets.forEach((p: any) => { total += 1; if (p && p.status === "Returned") back += 1; });
  });
  return {
    shipments: members.length, live: live.length, cancelled: members.length - live.length,
    kg, pallets, poRefs: Array.from(pos), soRefs: Array.from(sos), freightPLN: freight,
    protocolsBack: back, protocolsTotal: total,
  };
}

export interface MapGap { shipmentRef: string; shipmentKg: number; mappedKg: number; unmappedKg: number; overKg: number; }

/** Which trucks are not fully accounted for in the containers.
 *  The map is REQUIRED, so an empty map on a plan with members is itself the
 *  gap — reported rather than passed over in silence, because a truck missing
 *  from the map is exactly the one nobody can trace when the client complains. */
export function mapGaps(plan: any, shipments: any[]): MapGap[] {
  const out: MapGap[] = [];
  planShipments(plan, shipments).filter(s => !cancelled(s)).forEach(s => {
    const shipKg = (s.goods || []).reduce((a: number, g: any) => a + num(g.qtyKg), 0);
    if (shipKg <= 0) return;
    // Only ROAD shipments feed containers. A sea or air leg is the movement OF
    // the containers, not cargo waiting to be stuffed into one — and the
    // container carries the forwarder's own number (MSKU 123456), never the sea
    // shipment's number, so it cannot be matched by reference either.
    if (String(s.mode || "").toLowerCase() !== "road") return;
    // Defensive: if a shipment number has been used as a container reference,
    // it is a receiving unit whatever its mode says.
    if ((plan?.map || []).some((e: any) => String(e.containerRef) === String(s.number))) return;
    const mapped = (plan?.map || [])
      .filter((e: any) => String(e.shipmentRef) === String(s.number))
      .reduce((a: number, e: any) => a + num(e.qtyKg), 0);
    const unmapped = Math.max(0, Math.round((shipKg - mapped) * 10) / 10);
    const over = Math.max(0, Math.round((mapped - shipKg) * 10) / 10);
    if (unmapped > 1 || over > 1) out.push({ shipmentRef: String(s.number), shipmentKg: shipKg, mappedKg: mapped, unmappedKg: unmapped, overKg: over });
  });
  return out;
}

/** What a container holds, by feeding truck. The claim chain runs through here:
 *  damage in a container names the trucks that filled it, and each truck's
 *  loading protocol carries the producer, variety, calibre and dock condition. */
export function containerContents(plan: any): Array<{ containerRef: string; feeds: LoadPlanEntry[]; kg: number }> {
  const byContainer: Record<string, LoadPlanEntry[]> = {};
  (plan?.map || []).forEach((e: any) => {
    const c = String(e.containerRef || "");
    if (!c) return;
    (byContainer[c] = byContainer[c] || []).push({ containerRef: c, shipmentRef: String(e.shipmentRef || ""), qtyKg: num(e.qtyKg) });
  });
  return Object.keys(byContainer).sort().map(c => ({
    containerRef: c, feeds: byContainer[c],
    kg: byContainer[c].reduce((a, e) => a + e.qtyKg, 0),
  }));
}

/** Trucks feeding a given container — the first hop of a damage trace. */
export function tracebackFromContainer(plan: any, containerRef: string): string[] {
  return Array.from(new Set((plan?.map || [])
    .filter((e: any) => String(e.containerRef) === String(containerRef))
    .map((e: any) => String(e.shipmentRef))));
}

/** Is the plan ready to be considered complete? The map being required is the
 *  point of the object, so an unmapped truck blocks completeness the same way a
 *  missing signature blocks a loading protocol. */
export function planGaps(plan: any, shipments: any[]): string[] {
  const gaps: string[] = [];
  const t = planTotals(plan, shipments, () => 0);
  if (!t.live) gaps.push("no live shipments in this plan");
  if (!(plan?.map || []).length && t.live > 0) gaps.push("transshipment map is empty — the forwarder's container loading has not been recorded");
  mapGaps(plan, shipments).forEach(g => {
    if (g.unmappedKg > 1) gaps.push(`${g.shipmentRef}: ${Math.round(g.unmappedKg).toLocaleString("pl-PL")} kg not placed in any container`);
    if (g.overKg > 1) gaps.push(`${g.shipmentRef}: ${Math.round(g.overKg).toLocaleString("pl-PL")} kg more placed than the truck carries`);
  });
  if (t.protocolsTotal > 0 && t.protocolsBack < t.protocolsTotal) {
    gaps.push(`${t.protocolsBack}/${t.protocolsTotal} loading protocols returned`);
  }
  return gaps;
}
