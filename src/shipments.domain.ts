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
    const hasMovement = (lot.movements || []).some((m: any) =>
      (m.shipmentRef ? String(m.shipmentRef) === String(sh.number) : String(m.note || "").includes(sh.number)));
    if (hasMovement) return lot;

    const qty = relatedGoods.reduce((s: number, g: any) => s + num(g.qtyKg), 0);
    const lastLeg = (sh.legs || [])[((sh.legs || []).length || 1) - 1] || {};
    const firstLeg = (sh.legs || [])[0] || {};
    const destId = lastLeg.toLocationId || sh.destinationLocationId || lot.locationId;
    const fromId = firstLeg.fromLocationId || lot.locationId;
    const currentPhysical = num(lot.physicalKg);
    const goodsSoRef = relatedGoods.map((g: any) => g.soRef).find(Boolean);
    const date = sh.actualDeliveryDate || deps.todayISO();
    changed.push(lot.number);

    if (purpose === "OUTBOUND") {
      // Decision 2 extension: an EXW/direct collection of a lot that never entered
      // our stock posts the PASS-THROUGH PAIR here too (ownership at handover).
      const isDirectLot = !!lot.directFlow || lot.custodyType === "Direct" || lot.status === "Direct Expected";
      const notYetIn = !(num(lot.receivedKg) > 0) && currentPhysical <= 0;
      if (isDirectLot && notYetIn) {
        const soRef = goodsSoRef || (sh.soRefs || [])[0] || null;
        const inMove = { id: deps.nextId(), date, type: "IN", qtyKg: qty, fromId, toId: fromId, soRef: null, shipmentRef: sh.number, note: `IN via ${sh.number} — direct flow (ownership at handover)` };
        const outMove = { id: deps.nextId(), date, type: "SHIP_OUT", qtyKg: qty, fromId, toId: destId, soRef, shipmentRef: sh.number, note: `SHIP_OUT via ${sh.number} — client collection / direct pass-through` };
        return { ...lot, receivedKg: Math.round((num(lot.receivedKg) + qty) * 1000) / 1000, physicalKg: currentPhysical, status: "Delivered (direct)", arrivalDate: lot.arrivalDate || date, movements: [...(lot.movements || []), inMove, outMove] };
      }
      const nextPhysical = Math.max(0, currentPhysical - qty);
      const soRef = goodsSoRef || (sh.soRefs || [])[0] || null;
      const note = `SHIP_OUT via ${sh.number}${(sh.soRefs || []).length ? ` for ${(sh.soRefs || []).join(", ")}` : ""}`;
      const movement = { id: deps.nextId(), date, type: "SHIP_OUT", qtyKg: qty, fromId, toId: destId, soRef, shipmentRef: sh.number, note };
      return { ...lot, physicalKg: nextPhysical, status: nextPhysical <= 0 ? "Shipped Out" : lot.status, movements: [...(lot.movements || []), movement] };
    }

    if (purpose === "TRANSFER") {
      const movement = { id: deps.nextId(), date, type: "TRANSFER", qtyKg: qty, fromId, toId: destId, soRef: null, shipmentRef: sh.number, note: `TRANSFER via ${sh.number}` };
      return { ...lot, locationId: destId, movements: [...(lot.movements || []), movement] };
    }

    if (purpose === "RETURN") {
      const movement = { id: deps.nextId(), date, type: "REVERSAL", qtyKg: qty, fromId, toId: destId, soRef: goodsSoRef || null, shipmentRef: sh.number, note: `RETURN via ${sh.number} — restored to stock pending inspection` };
      return { ...lot, physicalKg: Math.round((currentPhysical + qty) * 1000) / 1000, locationId: destId, movements: [...(lot.movements || []), movement] };
    }

    // INBOUND
    const isDirect = !!lot.directFlow || lot.custodyType === "Direct" || lot.status === "Direct Expected";
    const notYetReceived = !(num(lot.receivedKg) > 0) && currentPhysical <= 0;
    if (isDirect) {
      // Decision 2 (pass-through pair): goods enter our ownership at the handover
      // point and leave to the client in the same event — never our warehouse.
      const soRef = goodsSoRef || (sh.soRefs || [])[0] || null;
      const inMove = { id: deps.nextId(), date, type: "IN", qtyKg: qty, fromId, toId: destId, soRef: null, shipmentRef: sh.number, note: `IN via ${sh.number} — direct flow (ownership at handover)` };
      const outMove = { id: deps.nextId(), date, type: "SHIP_OUT", qtyKg: qty, fromId: destId, toId: destId, soRef, shipmentRef: sh.number, note: `SHIP_OUT via ${sh.number} — direct pass-through to client` };
      return {
        ...lot,
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
        locationId: destId,
        receivedKg: Math.round((num(lot.receivedKg) + qty) * 1000) / 1000,
        physicalKg: Math.round((currentPhysical + qty) * 1000) / 1000,
        status: "In Stock",
        arrivalDate: sh.actualDeliveryDate || lot.arrivalDate || date,
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
export function findLotForSOLine(lots: any[], it: any): any | null {
  if (!it?.sourceRef) return null;
  if (it.sourceType === "STOCK") return (lots || []).find(l => l.number === it.sourceRef) || null;
  if (it.sourceType === "PO") {
    const norm = (p: any) => String(p || "").toLowerCase().trim();
    return (lots || []).find(l => l.poRef === it.sourceRef && norm(l.product) === norm(it.product)) || null;
  }
  return null;
}

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
