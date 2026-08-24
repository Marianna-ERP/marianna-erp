// ─────────────────────────────────────────────────────────────────────────────
// shipments.domain.ts — pure shipment→inventory posting engine (Batch 3a)
//
// Replaces the inference-driven applyInventoryMovement branching. The posting
// is keyed off an EXPLICIT canonical purpose (BP-23) instead of guessing from
// soRefs — the root-cause class behind T-20. Legacy purposes and stored
// shipments are mapped by derivePurpose, so old data keeps posting correctly.
//
// Canonical purposes and their posting:
//   OUTBOUND  → SHIP_OUT per goods lot (client delivery / EXW collection)
//   INBOUND   → direct lot: PASS-THROUGH PAIR (IN + SHIP_OUT at the handover
//               point — goods enter our ownership and leave to the client in
//               one event; received/COGS counted, physical net 0)   [decision 2]
//               not-yet-received lot: IN (receipt into stock)
//               already-received lot: TRANSFER (relocation)
//   TRANSFER  → TRANSFER (move stock, keep quantities)
//   RETURN    → REVERSAL (restore returned qty to the destination)
//
// Idempotent per shipment: a lot that already has a movement for this shipment
// number is left untouched (same guard as before, now tested).
// ─────────────────────────────────────────────────────────────────────────────

import { findLotForSOLine } from "./salesOrders.domain";

function num(v: any): number {
  const x = parseFloat(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
}

export type ShipmentPurpose = "INBOUND" | "OUTBOUND" | "TRANSFER" | "RETURN";

export function derivePurpose(sh: any): ShipmentPurpose {
  const p = String(sh?.purpose || "").toUpperCase();
  if (p === "INBOUND" || p === "OUTBOUND" || p === "TRANSFER" || p === "RETURN") return p as ShipmentPurpose;
  // Legacy values + legacy inference (pre-Batch-3 shipments in stored data):
  if (p === "SO_DELIVERY" || (sh?.soRefs || []).length > 0) return "OUTBOUND";
  if (p === "TRANSFER_INTERNAL") return "TRANSFER";
  if (p === "RETURN_INBOUND") return "RETURN";
  return "INBOUND"; // PO_IMPORT / PO_EXPORT / unknown
}

export interface PostDeps { todayISO: () => string; nextId: () => number; }

/** Pure: returns { lots, changed } — untouched lots keep identity (===). */
export function postShipmentToLots(sh: any, lots: any[], deps: PostDeps) {
  const purpose = derivePurpose(sh);
  const changed: string[] = [];
  const nextLots = (lots || []).map(lot => {
    const relatedGoods = (sh.goods || []).filter((g: any) => g.lotRef === lot.number);
    if (!relatedGoods.length) return lot;
    // v6.45.0 (heal): VOIDED movements don't count — a voided posting was undone
    // (cancellation or heal), so a fresh post must be allowed.
    const hasMovement = (lot.movements || []).some((m: any) =>
      !m.voided && (m.shipmentRef ? String(m.shipmentRef) === String(sh.number) : String(m.note || "").includes(sh.number)));
    if (hasMovement) return lot;

    const qty = relatedGoods.reduce((s: number, g: any) => s + num(g.qtyKg), 0);
    const lastLeg = (sh.legs || [])[((sh.legs || []).length || 1) - 1] || {};
    const firstLeg = (sh.legs || [])[0] || {};
    const destId = lastLeg.toLocationId || sh.destinationLocationId || lot.locationId;
    const fromId = firstLeg.fromLocationId || lot.locationId;
    const currentPhysical = num(lot.physicalKg);
    // v6.63.0 (D-03): anchor the lot's ORIGINAL location before this posting moves
    // it. Cancellation voids the movements and recomputeLotFromMovements falls back
    // to baseLocationId — without the anchor it fell back to lot.locationId, which
    // this very posting had already overwritten with the DESTINATION, so a cancelled
    // transfer left the lot showing at a place the goods never (officially) reached.
    const baseAnchor = lot.baseLocationId ?? lot.locationId ?? fromId ?? null;
    const goodsSoRef = relatedGoods.map((g: any) => g.soRef).find(Boolean);
    // v6.51.0: stamp the movement with the date the goods actually MOVED, not the
    // day the record was created. Storage days and every date-based report depend
    // on this. Preference: actual delivery > planned delivery on the last leg >
    // loading date > pickup on the first leg > today (last resort).
    const date = sh.actualDeliveryDate
      || lastLeg.plannedDeliveryDate || sh.expectedDeliveryDate
      || sh.loadingDate || firstLeg.plannedPickupDate
      || deps.todayISO();
    changed.push(lot.number);

    if (purpose === "OUTBOUND") {
      // Decision 2 extension: an EXW/direct collection of a lot that never entered
      // our stock posts the PASS-THROUGH PAIR here too (ownership at handover).
      // v6.45.0 (parity with the v6.44.0 INBOUND fix): a PO-backed lot that was
      // NEVER received and leaves on a sold shipment is a pass-through by
      // definition — the goods went producer → client without touching our
      // stock. The old gate demanded the directFlow flag, which older/mis-built
      // lots don't carry, so genuine direct exports fell into the plain
      // SHIP_OUT branch: receivedKg stayed 0 (no weight anywhere) and the
      // over-issue clamp fired on legitimate goods.
      const isDirectLot = !!lot.directFlow || lot.custodyType === "Direct" || lot.status === "Direct Expected"
        || (!!lot.poRef && (goodsSoRef || (sh.soRefs || []).length > 0));
      const notYetIn = !(num(lot.receivedKg) > 0) && currentPhysical <= 0;
      if (isDirectLot && notYetIn) {
        const soRef = goodsSoRef || (sh.soRefs || [])[0] || null;
        const inMove = { id: deps.nextId(), date, type: "IN", qtyKg: qty, fromId, toId: fromId, soRef: null, shipmentRef: sh.number, note: `IN via ${sh.number} — direct flow (ownership at handover)` };
        const outMove = { id: deps.nextId(), date, type: "SHIP_OUT", qtyKg: qty, fromId, toId: destId, soRef, shipmentRef: sh.number, note: `SHIP_OUT via ${sh.number} — client collection / direct pass-through` };
        return { ...lot, receivedKg: Math.round((num(lot.receivedKg) + qty) * 1000) / 1000, physicalKg: currentPhysical, status: "Delivered (direct)", arrivalDate: lot.arrivalDate || date, movements: [...(lot.movements || []), inMove, outMove] };
      }
      const nextPhysical = Math.max(0, currentPhysical - qty);
      // v6.30.1 (Safeguards 7a parity): the movement reducer accumulates and the
      // integrity checker reports overIssuedKg, but this posting path clamped the
      // excess silently — an over-issue arriving via a shipment was invisible.
      const overIssue = qty > currentPhysical ? Math.round((qty - currentPhysical) * 1000) / 1000 : 0;
      const soRef = goodsSoRef || (sh.soRefs || [])[0] || null;
      const note = `SHIP_OUT via ${sh.number}${(sh.soRefs || []).length ? ` for ${(sh.soRefs || []).join(", ")}` : ""}`;
      const movement = { id: deps.nextId(), date, type: "SHIP_OUT", qtyKg: qty, fromId, toId: destId, soRef, shipmentRef: sh.number, note };
      return { ...lot, physicalKg: nextPhysical, overIssuedKg: Math.round(((num(lot.overIssuedKg)) + overIssue) * 1000) / 1000, status: nextPhysical <= 0 ? "Shipped Out" : lot.status, movements: [...(lot.movements || []), movement] };
    }

    if (purpose === "TRANSFER") {
      const movement = { id: deps.nextId(), date, type: "TRANSFER", qtyKg: qty, fromId, toId: destId, soRef: null, shipmentRef: sh.number, note: `TRANSFER via ${sh.number}` };
      return { ...lot, baseLocationId: baseAnchor, locationId: destId, movements: [...(lot.movements || []), movement] };
    }

    if (purpose === "RETURN") {
      const movement = { id: deps.nextId(), date, type: "REVERSAL", qtyKg: qty, fromId, toId: destId, soRef: goodsSoRef || null, shipmentRef: sh.number, note: `RETURN via ${sh.number} — restored to stock pending inspection` };
      return { ...lot, baseLocationId: baseAnchor, physicalKg: Math.round((currentPhysical + qty) * 1000) / 1000, locationId: destId, movements: [...(lot.movements || []), movement] };
    }

    // INBOUND
    // v6.44.0 (test-round core): recognise a DIRECT EXPORT pass-through even when the
    // lot's directFlow flag was never set — if this shipment's goods for the lot carry
    // an SO reference (the goods are sold, going straight to the client), it's a
    // pass-through, not a receipt into our stock. This is what produces the SHIP_OUT
    // that gives the SO its COGS.
    const goodsAreSold = relatedGoods.some((g: any) => !!g.soRef) || (sh.soRefs || []).length > 0;
    const goodsAreExport = relatedGoods.some((g: any) => String(g.tradeDirection || "").toUpperCase() === "EXPORT");
    const isDirect = !!lot.directFlow || lot.custodyType === "Direct" || lot.status === "Direct Expected" || (goodsAreSold && goodsAreExport);
    const notYetReceived = !(num(lot.receivedKg) > 0) && currentPhysical <= 0;
    if (isDirect) {
      // Decision 2 (pass-through pair): goods enter our ownership at the handover
      // point and leave to the client in the same event — never our warehouse.
      const soRef = goodsSoRef || (sh.soRefs || [])[0] || null;
      const inMove = { id: deps.nextId(), date, type: "IN", qtyKg: qty, fromId, toId: destId, soRef: null, shipmentRef: sh.number, note: `IN via ${sh.number} — direct flow (ownership at handover)` };
      const outMove = { id: deps.nextId(), date, type: "SHIP_OUT", qtyKg: qty, fromId: destId, toId: destId, soRef, shipmentRef: sh.number, note: `SHIP_OUT via ${sh.number} — direct pass-through to client` };
      return {
        ...lot,
        baseLocationId: baseAnchor,
        receivedKg: Math.round((num(lot.receivedKg) + qty) * 1000) / 1000,
        physicalKg: currentPhysical, // net zero — never in our stock
        locationId: destId,
        status: "Delivered (direct)",
        arrivalDate: sh.actualDeliveryDate || lot.arrivalDate || date,
        movements: [...(lot.movements || []), inMove, outMove],
      };
    }
    if (notYetReceived) {
      const movement = { id: deps.nextId(), date, type: "IN", qtyKg: qty, fromId, toId: destId, soRef: null, shipmentRef: sh.number, note: `IN via ${sh.number}` };
      return {
        ...lot,
        baseLocationId: baseAnchor,
        locationId: destId,
        receivedKg: Math.round((num(lot.receivedKg) + qty) * 1000) / 1000,
        physicalKg: Math.round((currentPhysical + qty) * 1000) / 1000,
        status: "In Stock",
        arrivalDate: sh.actualDeliveryDate || lot.arrivalDate || date,
        movements: [...(lot.movements || []), movement],
      };
    }
    // v6.51.0 (ROOT CAUSE A): a lot that has already been received is NOT
    // automatically a transfer target. A PO delivered in several trucks posts a
    // RECEIPT each time — the reported "Shortfall 21 000 kg (-50 %)" was a
    // 42 000 kg PO delivered in two loads where only the first counted, because
    // the second was booked as a warehouse move (which adds no stock).
    // It is a genuine TRANSFER only when the goods are being relocated: the lot
    // is already sitting somewhere and this shipment moves it elsewhere WITHOUT
    // bringing new quantity — i.e. the whole lot travels, or the PO line has no
    // outstanding quantity left to deliver.
    const orderedForLine = num(lot.expectedKg) || 0;
    const receivedSoFar = num(lot.receivedKg);
    const stillOutstanding = orderedForLine > 0 ? Math.max(0, orderedForLine - receivedSoFar) : 0;
    const isFurtherDelivery = stillOutstanding > 0 && qty > 0;
    if (isFurtherDelivery) {
      const takeQty = Math.min(qty, stillOutstanding);
      const movement = { id: deps.nextId(), date, type: "IN", qtyKg: takeQty, fromId, toId: destId, soRef: null, shipmentRef: sh.number, note: `IN via ${sh.number} — further delivery against ${lot.poRef || "the order"}` };
      return {
        baseLocationId: baseAnchor,
        ...lot,
        locationId: destId,
        receivedKg: Math.round((receivedSoFar + takeQty) * 1000) / 1000,
        physicalKg: Math.round((currentPhysical + takeQty) * 1000) / 1000,
        status: "In Stock",
        arrivalDate: lot.arrivalDate || date,
        movements: [...(lot.movements || []), movement],
      };
    }
    const movement = { id: deps.nextId(), date, type: "TRANSFER", qtyKg: qty, fromId, toId: destId, soRef: null, shipmentRef: sh.number, note: `TRANSFER via ${sh.number}` };
    return { ...lot, locationId: destId, movements: [...(lot.movements || []), movement] };
  });
  return { lots: nextLots, changed };
}

/** Cost responsibility for a shipment built from a PO (BP-26 — was hardcoded "Marianna"). */
export function responsibilityForPOShipment(po: any, supplierManagedTransport: boolean): string {
  const term = String(po?.buyIncoterm || "").toUpperCase();
  if (supplierManagedTransport || term === "DDP" || term === "DAP") return "Supplier";
  return "Marianna";
}

// ── EXW client collection (Batch 3b, decision 2) ────────────────────────────
// v6.32.0 (A1): delegates to the canonical matcher in salesOrders.domain —
// poLineId-first, variety-aware; this module's old name-only copy misresolved
// multi-line same-product POs.
export { findLotForSOLine };

export function nextShipmentNumberPure(shipments: any[], year: number): string {
  let max = 0;
  (shipments || []).forEach(s => {
    const m = String(s.number || "").match(/^SHP-(\d{4})-(\d{4})$/);
    if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]));
  });
  return `SHP-${year}-${String(max + 1).padStart(4, "0")}`;
}

/** Minimal collection shipment: no legs, no transport order, no freight —
 *  purpose OUTBOUND, responsibility Client; origin = where the sourced lot sits
 *  (our warehouse for stock sales, the producer's site for direct EXW). */
export function buildCollectionShipment(so: any, lots: any[], shipments: any[], info: any, deps: PostDeps & { year?: number }) {
  const year = info?.year || new Date(deps.todayISO()).getFullYear();
  const goods = (so.items || []).map((it: any) => {
    const lot = findLotForSOLine(lots, it);
    return {
      id: deps.nextId(),
      poRef: it.sourceType === "PO" ? it.sourceRef : (lot?.poRef || ""),
      soRef: so.number,
      lotRef: lot?.number || (it.sourceType === "STOCK" ? it.sourceRef : ""),
      product: it.product, variety: it.variety || "", cnCode: it.cnCode || "",
      origin: it.origin, quality: it.quality, size: it.size, packaging: it.packaging,
      qtyKg: num(it.qty), pallets: num(it.pallets) || 0,
      description: `${it.product || "Goods"}${it.variety ? " " + it.variety : ""} ${it.packaging || ""}`.trim(),
    };
  }).filter((g: any) => g.lotRef);
  const firstLot = goods.length ? (lots || []).find(l => l.number === goods[0].lotRef) : null;
  return {
    id: deps.nextId(),
    number: nextShipmentNumberPure(shipments, year),
    transportOrderNo: "",
    mode: "Client pickup",
    purpose: "OUTBOUND",
    status: "Booked",
    poRefs: Array.from(new Set(goods.map((g: any) => g.poRef).filter(Boolean))),
    soRefs: [so.number],
    lotRefs: Array.from(new Set(goods.map((g: any) => g.lotRef))),
    costResponsibility: "Client",
    supplierManagedTransport: false,
    originLocationId: firstLot?.locationId ?? null,
    destinationCustom: `Client collection (EXW) — ${so.client?.name || ""}`.trim(),
    loadingDate: info?.date || deps.todayISO(),
    expectedDeliveryDate: info?.date || deps.todayISO(),
    collection: { date: info?.date || deps.todayISO(), truckPlate: info?.truckPlate || "", driverName: info?.driverName || "", notes: info?.notes || "" },
    legs: [], goods, costs: [],
    documents: [],
    notes: `EXW client collection recorded from ${so.number}.${info?.notes ? " " + info.notes : ""}`,
  };
}

/** BP-53 (groupage): append another PO's / SO's goods to an existing shipment.
 *  Goods rows carry per-line poRef/soRef/lotRef; header ref arrays are merged. */
export function appendSourceGoods(sh: any, kind: "PO" | "SO", doc: any, lots: any[], deps: PostDeps) {
  const norm = (p: any) => String(p || "").toLowerCase().trim();
  const newGoods = (doc.items || []).map((it: any) => {
    const lot = kind === "SO"
      ? findLotForSOLine(lots, it)
      : (lots || []).find(l => l.poRef === doc.number && norm(l.product) === norm(it.product)) || null;
    return {
      id: deps.nextId(),
      poRef: kind === "PO" ? doc.number : (it.sourceType === "PO" ? it.sourceRef : (lot?.poRef || "")),
      soRef: kind === "SO" ? doc.number : "",
      lotRef: lot?.number || (kind === "SO" && it.sourceType === "STOCK" ? it.sourceRef : ""),
      product: it.product, variety: it.variety || "", cnCode: it.cnCode || "",
      origin: it.origin, quality: it.quality, size: it.size, packaging: it.packaging,
      qtyKg: num(it.qty), pallets: num(it.pallets) || 0,
      description: `${it.product || "Goods"}${it.variety ? " " + it.variety : ""} ${it.packaging || ""}`.trim(),
    };
  });
  const uniq = (a: any[]) => Array.from(new Set(a.filter(Boolean)));
  const poRefs = uniq([...(sh.poRefs || []), ...newGoods.map((g: any) => g.poRef)]);
  const soRefs = uniq([...(sh.soRefs || []), ...newGoods.map((g: any) => g.soRef)]);
  // FB-7: rebuild the notes summary from ALL linked refs, not just the first PO.
  const refList = [...poRefs, ...soRefs].join(", ");
  const baseNote = String(sh.notes || "").replace(/\s*\(groupage:[^)]*\)\s*$/i, "").trim();
  const notes = poRefs.length + soRefs.length > 1
    ? `${baseNote}${baseNote ? " " : ""}(groupage: ${refList})`
    : sh.notes;
  return {
    ...sh,
    notes,
    goods: [...(sh.goods || []), ...newGoods],
    poRefs, soRefs,
    lotRefs: uniq([...(sh.lotRefs || []), ...newGoods.map((g: any) => g.lotRef)]),
  };
}

// ── Shipment lifecycle (BP-22) ──────────────────────────────────────────────
// Canonical simplified statuses. Legacy statuses map on read so old data and the
// full-editor dropdown keep working during the transition.
export const SHIPMENT_LIFECYCLE = ["Draft", "Booked", "Loaded", "Delivered", "Closed"];

export function canonicalStatus(s: any): string {
  const v = String(s || "").trim();
  if (v === "Confirmed") return "Booked";
  if (v === "Arrived" || v === "In Transit") return "Loaded";
  if (v === "Planned") return "Draft";
  return v || "Draft";
}

/** The single next logical action for a shipment (BP-22) — not all buttons at once. */
export function nextShipmentAction(sh: any): { label: string; to: string; kind: string } | null {
  const s = canonicalStatus(sh?.status);
  if (s === "Cancelled" || s === "Closed") return null;
  switch (s) {
    case "Draft":     return { label: "Confirm booking", to: "Booked",    kind: "dark" };
    case "Booked":    return { label: "Mark loaded",     to: "Loaded",    kind: "amber" };
    case "Loaded":    return { label: "Mark delivered",  to: "Delivered", kind: "green" };
    case "Delivered": return { label: "Close shipment",  to: "Closed",    kind: "dark" };
    default:          return { label: "Confirm booking", to: "Booked",    kind: "dark" };
  }
}

// ── Customs (BP-27): structured object with string→object migration ─────────
export function normalizeCustoms(raw: any): any {
  if (raw && typeof raw === "object") return raw;
  const text = String(raw || "").trim();
  const notReq = /not required|n\/a|none/i.test(text) || text === "";
  return {
    applies: !notReq,
    role: notReq ? "not_required" : "",      // our_broker | forwarder_abroad | t1_local_broker | not_required
    place: notReq ? "" : text,               // free text preserved from the legacy string
    status: notReq ? "cleared" : "pending",  // pending | in_progress | cleared
    t1Transit: /t1/i.test(text),
    brokerId: null,
    cost: null, currency: "PLN", fxRate: 1,
    _migratedFrom: typeof raw === "string" ? raw : undefined,
  };
}

// ── v6.37.1 (Finance direct costs, F-1): the freight MIRROR SYNC ─────────────
// Legs are the operational entry point for freight (truck rate, sea rate); the
// financial pipeline (KPIs, billing, allocation, SO margin) reads costs[]. Until
// now costs[] was a one-time snapshot at creation — edit a leg's cost later and
// finance never saw it (the reported truck/container loss). This sync runs on
// every save, exactly like the customs sync (v6.34.5): one managed line per leg
// with a STABLE identity (source "leg-freight:{n}"), amounts from the leg,
// preserving the line's id / invoiceStatus / invoiceRef across re-syncs, removed
// when the leg's cost is cleared. It ADOPTS a legacy unsourced snapshot line of
// the same freight type (builder-era data) instead of duplicating it. Manually
// added lines (other types, or extra unsourced lines) are never touched.
const FREIGHT_TYPE_BY_MODE: Record<string, string> = { Air: "air_freight", Rail: "rail_freight", Road: "road_freight", Sea: "sea_freight" };
export function legFreightSource(legNo: number): string { return `leg-freight:${legNo}`; }
export function syncLegFreightCostLines(sh: any): any {
  const legs = sh?.legs || [];
  const numv = (v: any) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  let costs = [...(sh?.costs || [])];
  legs.forEach((leg: any, i: number) => {
    const n = i + 1;
    const src = legFreightSource(n);
    const type = FREIGHT_TYPE_BY_MODE[leg?.mode] || "sea_freight";
    const amt = numv(leg?.costAmount);
    const fx = numv(leg?.costFxRate) || 1;
    const pln = numv(leg?.costPLN) || Math.round(amt * fx * 100) / 100;
    let idx = costs.findIndex((c: any) => c && String(c.source || "") === src);
    if (idx === -1 && amt > 0) {
      idx = costs.findIndex((c: any) => c && !c.source && !c._customsAuto && c.type === type);
    }
    if (amt > 0) {
      const prev = idx >= 0 ? costs[idx] : null;
      const line = {
        id: prev?.id ?? (numv(sh?.id) || 0) * 1000 + 900 + n,
        source: src, type,
        supplierId: leg?.carrierId || leg?.forwarderId || prev?.supplierId || null,
        amount: amt, currency: leg?.costCurrency || "PLN", fxRate: fx, amountPLN: pln,
        invoiceStatus: prev?.invoiceStatus || "Expected",
        invoiceRef: prev?.invoiceRef || "",
        allocationMethod: prev?.allocationMethod || "by_kg",
        notes: `${leg?.mode || "?"} leg ${n}`,
      };
      if (idx >= 0) costs[idx] = line; else costs.push(line);
    } else if (idx >= 0 && String(costs[idx].source || "") === src) {
      // v6.50.0 (test round): DO NOT silently delete a freight line that carries
      // real money just because the leg's own cost field is empty. Most freight is
      // typed straight into the cost line and never onto the leg, so a line that
      // had once been adopted by a leg vanished on the next save — the reported
      // "road and sea freight disappear after saving customs" data loss.
      // The leg simply stops MANAGING the line: we release it (drop the source) so
      // it survives as an ordinary manual cost line. Only a genuinely empty
      // managed line is removed.
      const existing = costs[idx];
      const carriesMoney = numv(existing?.amount) > 0 || numv(existing?.amountPLN) > 0;
      if (carriesMoney) {
        const released = { ...existing };
        delete released.source;
        released.notes = String(existing?.notes || "").replace(/^(Road|Sea|Air|Rail|\?) leg \d+$/, "").trim() || existing?.notes || "";
        costs[idx] = released;
      } else {
        costs.splice(idx, 1);
      }
    }
  });
  // drop managed lines for legs that no longer exist
  costs = costs.filter((c: any) => {
    const m = /^leg-freight:(\d+)$/.exec(String(c?.source || ""));
    return !m || Number(m[1]) <= legs.length;
  });
  return { ...sh, costs };
}


// ── v6.58.0: WHAT A SHIPMENT ACTUALLY CARRIES ────────────────────────────────
// Header poRefs/soRefs/lotRefs are seeded from the SOURCE DOCUMENT at creation,
// so a shipment carrying one lot of a two-PO source displayed both POs and all
// the source's lots. Related documents must come from the goods on board.
export function carriedRefs(sh: any): { poRefs: string[]; soRefs: string[]; lotRefs: string[] } {
  const pos = new Set<string>(), sos = new Set<string>(), lots = new Set<string>();
  const goods = (sh?.goods || []).filter((g: any) => {
    const n = parseFloat(String(g?.qtyKg ?? "").replace(",", "."));
    return isFinite(n) && n > 0;   // a zero-kg line moves nothing and links nothing
  });
  goods.forEach((g: any) => {
    if (g.poRef) pos.add(String(g.poRef));
    if (g.soRef) sos.add(String(g.soRef));
    if (g.lotRef) lots.add(String(g.lotRef));
  });
  // A shipment with no goods yet falls back to the seeds — a booking still
  // needs to say which order it belongs to.
  if (!goods.length) return {
    poRefs: (sh?.poRefs || []).map(String), soRefs: (sh?.soRefs || []).map(String), lotRefs: (sh?.lotRefs || []).map(String),
  };
  return { poRefs: Array.from(pos), soRefs: Array.from(sos), lotRefs: Array.from(lots) };
}


// ── v6.66.0: OVER-SHIP GUARD (owner ruling, Round 3) ─────────────────────────
// "Do we have a guard that would not allow to ship the same product twice?"
// The picker already warns; this makes the SAVE itself confirm-gated. Pure and
// testable: given the draft, all shipments and all SOs, name every goods row
// that would push an SO line past what was ordered.
export function overShipReport(draft: any, allShipments: any[], orders: any[]): Array<{ soRef: string; product: string; orderedKg: number; alreadyKg: number; thisKg: number; exceedKg: number }> {
  const out: any[] = [];
  const rows = (draft?.goods || []).filter((g: any) => g?.soRef && Number(g?.qtyKg) > 0);
  const bySo: Record<string, { product: string; thisKg: number }[]> = {};
  rows.forEach((g: any) => { (bySo[String(g.soRef)] = bySo[String(g.soRef)] || []).push({ product: String(g.product || ""), thisKg: Number(g.qtyKg) || 0 }); });
  Object.keys(bySo).forEach(soRef => {
    const so = (orders || []).find((o: any) => String(o.number) === String(soRef));
    if (!so || so.status === "Cancelled") return;
    const products = new Set(bySo[soRef].map(r => r.product));
    products.forEach(product => {
      const eqP = (v: any) => !product || String(v || "") === product;
      const orderedKg = (so.items || []).filter((it: any) => eqP(it.product)).reduce((a: number, it: any) => a + (Number(it.qty) || 0), 0);
      if (!(orderedKg > 0)) return; // no stated kg → nothing to guard against
      const alreadyKg = (allShipments || [])
        .filter((s: any) => s.status !== "Cancelled" && String(s.number) !== String(draft?.number))
        .reduce((a: number, s: any) => a + (s.goods || []).filter((g: any) => String(g.soRef) === soRef && eqP(g.product)).reduce((x: number, g: any) => x + (Number(g.qtyKg) || 0), 0), 0);
      const thisKg = bySo[soRef].filter(r => r.product === product).reduce((a, r) => a + r.thisKg, 0);
      const exceedKg = Math.round((alreadyKg + thisKg - orderedKg) * 1000) / 1000;
      if (exceedKg > 0) out.push({ soRef, product: product || "(any)", orderedKg, alreadyKg, thisKg, exceedKg });
    });
  });
  return out;
}
