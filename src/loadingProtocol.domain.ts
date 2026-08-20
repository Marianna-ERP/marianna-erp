// ─── v6.46.0  LOADING PROTOCOL / KARTA ZAŁADUNKU ─────────────────────────────
// The bilateral loading record the business sends to the producer, who fills it
// in and has it signed and stamped by BOTH himself (wydawca) and the transport
// company's driver (kierowca) at loading.
//
// Why it exists: footnote 1 of the paper form reserves the buyer's right to claim
// compensation for goods damaged or pallets overturned in transit. A CLEAN signed
// protocol at loading is what makes a later transport claim provable — without it
// the carrier can simply say the pallets were already bad. Damage discovered at
// unloading is recorded separately on the CMR remarks (signed by driver and the
// receiving warehouse), so this document deliberately covers LOADING only.
//
// Design notes
//  - The pallet manifest IS the substance of the form. We derive it from the
//    shipment's goods rows: boxes = ceil(netKg / capacity), then full pallets of
//    boxesPerPallet plus a final part-pallet — which reproduces the real sheets
//    exactly (19 422 kg = 1 494 boxes = 20 x 72 + 54 = 21 pallets).
//  - CALIBRE is deliberately left blank. A PO carries total kg per calibre and a
//    total pallet count, not the per-pallet allocation, and the split is only
//    known at loading — so the producer writes it by hand (ruling, test round 3).
//  - TEMPERATURE RECORDER numbers are also blank on the printed sheet: the
//    producer picks them at random from a pack of 10 and only then are they
//    known. They are captured when the signed protocol comes back, which is also
//    what feeds recorder tracking and any temperature claim.
//  - Rows are editable: a load may be 22 full pallets, or a producer may split
//    differently. Derivation is a starting point, never a constraint.

import { grossForGoodsLine, palletManifest, findPackaging, defaultPackagingForProduct, PackagingType } from "./packaging.domain";

const num = (v: any) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

// v6.52.0: a truck fills up by FLOOR SPACE or by WEIGHT, whichever comes first.
// 26 standard pallets of apples is ~24.3 t net + tare, over a typical 24 t payload —
// so the count limit alone would let you plan a truck that cannot legally move.
export type PalletType = "standard" | "euro";
export const PALLET_CAPACITY: Record<PalletType, number> = { standard: 26, euro: 33 };
export const DEFAULT_PAYLOAD_KG = 24000;

export interface LoadCheck { pallets: number; maxPallets: number; grossKg: number; maxKg: number; overPallets: boolean; overWeight: boolean; limit: "" | "pallets" | "weight"; }

/** Does this load fit on one truck? Reports whichever ceiling binds first. */
export function checkTruckLoad(pallets: number, grossKg: number, palletType: PalletType = "standard", payloadKg = DEFAULT_PAYLOAD_KG): LoadCheck {
  const maxPallets = PALLET_CAPACITY[palletType] || PALLET_CAPACITY.standard;
  const overPallets = pallets > maxPallets;
  const overWeight = grossKg > payloadKg;
  return { pallets, maxPallets, grossKg, maxKg: payloadKg, overPallets, overWeight,
    limit: overWeight ? "weight" : overPallets ? "pallets" : "" };
}

/** One row of the pallet table. Mirrors the paper columns 1:1. */
export interface ProtocolPalletRow {
  no: number;              // Nr palety
  boxes: number;           // Ilość opakowań (szt)
  kgPerBox: number;        // x KG
  /** v6.58.1: the PRODUCT on this pallet. The Item column was added to the
   *  printed sheet in v6.58.0 but the row had no product field behind it, so
   *  the column printed empty on every sheet. */
  product: string;         // Towar
  /** v6.52.0: pre-filled from the PO line so the producer CONFIRMS rather than
   *  transcribes. They correct only where the actual load differs. */
  variety: string;         // Odmiana
  size: string;            // Rozmiar — from the PO line, producer may correct
  boxesOk: boolean | null; // Skrzynki w dobrym stanie (Tak/Nie)
  goodsOk: boolean | null; // Towar nieuszkodzony (Tak/Nie)
  remarks: string;         // Uwagi
  observations: string;    // Obserwacje
}

/** The four pre-loading condition checks from the right-hand column. */
export interface ProtocolChecks {
  transportClean: boolean | null;   // Potwierdzenie czystości środka transportu
  chamberClean: boolean | null;     // Potwierdzenie czystości komory chłodniczej
  foreignOdours: boolean | null;    // Obecność obcych zapachów (true = odours PRESENT)
  packagingCompliant: boolean | null; // Stan opakowań i palet: ZGODNY / NIEZGODNY
}

export type ProtocolStatus = "Draft" | "Sent" | "Returned";

export interface LoadingProtocol {
  id: any;
  number: string;               // house convention, e.g. LP-2026-0001
  shipmentRef: string;
  legId: any;
  /** v6.52.0: the protocol belongs to ONE TRUCK, not a shipment. */
  unitId: any;
  poRef: string;
  palletType: PalletType;
  departedOn: string;
  supplierName: string;         // Dostawca (the producer)
  supplierAddress: string;
  receiverName: string;         // Odbiorca (us)
  assortment: string;           // Asortyment, e.g. "jabłka świeże / fresh apples"
  truckPlate: string;
  trailerPlate: string;
  carrierName: string;
  chamberTempBeforeC: string;   // Temperatura komory chłodniczej przed załadunkiem
  checks: ProtocolChecks;
  rows: ProtocolPalletRow[];
  recorderNos: string[];        // temperature recorders — captured on return
  driverName: string;
  driverSignedDate: string;     // DATA (kierowca)
  issuerSignedDate: string;     // DATA (wydawca)
  status: ProtocolStatus;
  returnedAt: string;
  notes: string;
  /** v6.47.0: share link to the SIGNED, STAMPED scan (Dropbox). The sheet only
   *  becomes usable evidence once the signed copy exists somewhere retrievable. */
  scanLink: string;
  formVersion: string;          // the paper form's version stamp
}

/** Totals for a protocol — the honest source of net/gross once it comes back. */
export function protocolTotals(p: { rows?: ProtocolPalletRow[] }, types: PackagingType[] = [], product?: any) {
  // v6.57.0: the sheet always prints 21 lines, so the BLANK padding must never
  // reach the arithmetic — a 6-pallet truck reporting 21 pallets would break the
  // gross weight, the tare and the truck capacity check all at once.
  const rows = (p.rows || []).filter(r => !isBlankRow(r));
  const boxes = rows.reduce((a, r) => a + num(r.boxes), 0);
  const netKg = rows.reduce((a, r) => a + num(r.boxes) * num(r.kgPerBox), 0);
  const pallets = rows.length;
  const pk = defaultPackagingForProduct(types, product);
  const boxTare = pk ? num(pk.tareKg) : 0;
  const palletTare = pk ? num(pk.palletTareKg) : 0;
  const boxTareTotalKg = Math.round(boxes * boxTare * 1000) / 1000;
  const palletTareTotalKg = Math.round(pallets * palletTare * 1000) / 1000;
  return {
    boxes, pallets,
    netKg: Math.round(netKg * 1000) / 1000,
    boxTareTotalKg, palletTareTotalKg,
    grossKg: Math.round((netKg + boxTareTotalKg + palletTareTotalKg) * 1000) / 1000,
  };
}

/** Derive the pallet rows for a set of goods lines. */
export function deriveRows(lines: any[], types: PackagingType[]): ProtocolPalletRow[] {
  // v6.52.0: rows come from the PO/goods LINES, each of which states its product,
  // variety, calibre and total kilos. The pallet count per line is derived from the
  // packaging (72 x 13 kg = 936 kg a pallet, so 19 422 kg = 21 pallets with the last
  // part-filled) — which is why a standard load comes out at 21 without anyone
  // choosing that number. The producer confirms or corrects each row at loading.
  const rows: ProtocolPalletRow[] = [];
  const unresolved: string[] = [];
  let no = 1;
  (lines || []).forEach(g => {
    const net = num(g.qtyKg) || num(g.qty);
    if (net <= 0) return;
    const pk = findPackaging(types, g.packagingId) || findPackaging(types, g.packaging) || defaultPackagingForProduct(types, g.product);
    const capacity = pk && pk.capacityKg > 0 ? num(pk.capacityKg) : 0;
    // v6.57.1: previously a line whose packaging could not be resolved was
    // SKIPPED IN SILENCE, so a real PO could produce a sheet of 21 blank lines
    // with nothing to say why. The line still cannot be split into pallets
    // without a box weight, so it is reported instead of vanishing.
    if (!capacity) { unresolved.push(String(g.product || "line")); return; }
    const gross = grossForGoodsLine({ qtyKg: net, product: g.product, packaging: g.packaging, packagingId: g.packagingId, pallets: g.pallets }, types);
    const bpp = pk && num(pk.boxesPerPallet) > 0 ? num(pk.boxesPerPallet) : 0;
    palletManifest(gross.boxes, bpp).forEach(m => {
      rows.push({
        no: no++, product: String(g.product || ""), boxes: m.boxes, kgPerBox: capacity,
        variety: String(g.variety || "").trim(),
        size: String(g.size || "").trim(),
        boxesOk: null, goodsOk: null, remarks: "", observations: "",
      });
    });
  });
  lastDeriveUnresolved = unresolved;
  return padToSheet(rows);
}

/** Products whose packaging could not be resolved on the last deriveRows call.
 *  Read straight after deriving, so the screen can explain an empty table
 *  instead of leaving the user staring at 21 blank lines. */
export let lastDeriveUnresolved: string[] = [];

/** Which packaging a goods line will use, and whether it can be resolved at all.
 *  Exposed so the UI can warn BEFORE the producer prints a useless sheet. */
export function packagingResolution(lines: any[], types: PackagingType[]): { ok: boolean; unresolved: string[] } {
  const bad: string[] = [];
  (lines || []).forEach(g => {
    const net = num(g.qtyKg) || num(g.qty);
    if (net <= 0) return;
    const pk = findPackaging(types, g.packagingId) || findPackaging(types, g.packaging) || defaultPackagingForProduct(types, g.product);
    if (!pk || num(pk.capacityKg) <= 0) bad.push(String(g.product || "line"));
  });
  return { ok: bad.length === 0, unresolved: bad };
}

/** v6.57.0: THE SHEET IS ALWAYS 21 LINES.
 *  Your paper form has 21 numbered rows whatever the truck carries, because the
 *  producer writes on the paper at the dock — a sheet printed with 6 lines for a
 *  6-pallet load leaves him nowhere to record the 7th pallet he actually put on.
 *  Derived rows fill from the top; the rest print empty and numbered. A load
 *  larger than 21 pallets simply runs longer: the 21 is a floor, never a cap. */
export const SHEET_MIN_ROWS = 21;

export function padToSheet(rows: ProtocolPalletRow[], min: number = SHEET_MIN_ROWS): ProtocolPalletRow[] {
  const out = [...(rows || [])];
  let no = out.length + 1;
  while (out.length < min) {
    out.push({ no: no++, boxes: 0, kgPerBox: 0, product: "", variety: "", size: "", boxesOk: null, goodsOk: null, remarks: "", observations: "" });
  }
  return out;
}

/** A row nobody has filled in — blank padding rather than a real pallet.
 *  Totals, completeness and the capacity check must all ignore these, or a
 *  6-pallet truck would report 21 pallets and 15 missing conditions. */
export function isBlankRow(r: any): boolean {
  return !r || (num(r.boxes) <= 0 && !String(r.product || "").trim() && !String(r.variety || "").trim() && !String(r.size || "").trim()
    && !String(r.remarks || "").trim() && !String(r.observations || "").trim()
    && r.boxesOk == null && r.goodsOk == null);
}

/** The rows that actually carry goods. */
export function filledRows(rows: any[]): any[] {
  return (rows || []).filter(r => !isBlankRow(r));
}

// ─── v6.53.0  ONE PROTOCOL PER TRUCK ─────────────────────────────────────────
// Ruling: the sheet is filled AT THE MOMENT OF LOADING, so it can never be
// issued before a shipment exists — it stays in Shipments and is never raised
// from a PO. What the PO does govern is permission: an unconfirmed PO must not
// put a truck under load, so issuing is gated on the linked PO being Confirmed.
//
// Ruling: goods are assigned PER UNIT. Each truck states what it carries
// (unit.load), and its sheet derives rows from that assignment alone. A line
// can be split across trucks, so the assignment is per line AND per kg.

/** The goods lines as loaded on ONE truck.
 *  No assignment = the whole shipment travels on this truck — the single-truck
 *  norm and the meaning of every shipment recorded before v6.53.0. */
export function unitGoodsLines(goods: any[], unit?: any): any[] {
  const load = (unit?.load || []).filter((a: any) => num(a?.qtyKg) > 0);
  if (!load.length) return goods || [];
  const out: any[] = [];
  (goods || []).forEach(g => {
    const a = load.find((x: any) => String(x.goodsLineId) === String(g.id));
    if (!a) return;
    // Everything about the line is kept — product, variety, calibre, packaging —
    // and only the quantity becomes this truck's share.
    out.push({ ...g, qtyKg: num(a.qtyKg), qty: num(a.qtyKg), pallets: undefined });
  });
  return out;
}

export interface AssignmentCheck { lineId: any; product: string; totalKg: number; assignedKg: number; unassignedKg: number; overKg: number; }

/** Does the per-unit assignment actually account for the shipment's goods?
 *  Reported rather than enforced: a truck may legitimately be loaded before the
 *  rest of the shipment is planned. Silence here is the dangerous state. */
export function assignmentCheck(goods: any[], units: any[]): AssignmentCheck[] {
  const anyAssigned = (units || []).some((u: any) => (u?.load || []).some((a: any) => num(a?.qtyKg) > 0));
  if (!anyAssigned) return [];
  return (goods || []).map(g => {
    const total = num(g.qtyKg) || num(g.qty);
    let assigned = 0;
    (units || []).forEach((u: any) => (u?.load || []).forEach((a: any) => {
      if (String(a.goodsLineId) === String(g.id)) assigned += num(a.qtyKg);
    }));
    return {
      lineId: g.id, product: String(g.product || ""), totalKg: total, assignedKg: assigned,
      unassignedKg: Math.max(0, Math.round((total - assigned) * 1000) / 1000),
      overKg: Math.max(0, Math.round((assigned - total) * 1000) / 1000),
    };
  }).filter(r => r.unassignedKg > 0.001 || r.overKg > 0.001);
}

/** Every protocol on a shipment.
 *  Reads forward over the pre-v6.53.0 single `loadingProtocol` object rather
 *  than migrating it — the same fold-forward the legacy leg-level vehicle
 *  fields already use, so no stored data is rewritten and nothing can be lost
 *  by a heal that runs before the stores have loaded. */
export function protocolsForShipment(sh: any): any[] {
  if (Array.isArray(sh?.loadingProtocols) && sh.loadingProtocols.length) return sh.loadingProtocols;
  return sh?.loadingProtocol ? [sh.loadingProtocol] : [];
}

/** The protocol for one truck. A legacy single sheet belongs to the first unit. */
export function protocolForUnit(sh: any, unitId: any): any {
  const all = protocolsForShipment(sh);
  const hit = all.find((p: any) => p && p.unitId != null && String(p.unitId) === String(unitId));
  if (hit) return hit;
  const legacy = all.find((p: any) => p && (p.unitId == null || p.unitId === ""));
  return legacy || null;
}

/** Replace-or-add one truck's sheet, leaving the other trucks' sheets alone. */
export function upsertProtocol(existing: any[], p: any): any[] {
  const list = [...(existing || [])];
  const i = list.findIndex((x: any) => x && (String(x.id) === String(p.id) ||
    (p.unitId != null && x.unitId != null && String(x.unitId) === String(p.unitId))));
  if (i >= 0) list[i] = p; else list.push(p);
  return list;
}

/** May a sheet be issued at all? An unconfirmed PO must not put a truck under
 *  load. Read from the shipment's own PO refs — the document does not move. */
export function poGateReason(shipment: any, pos: any[]): string {
  const refs = (shipment?.poRefs || []).filter(Boolean);
  if (!refs.length) return "";               // nothing linked — nothing to gate on
  const OPEN = new Set(["Confirmed", "Delivered", "Closed", "Partially delivered"]);
  const blocking = refs.filter((r: string) => {
    const po = (pos || []).find((x: any) => String(x?.number) === String(r));
    return po && !OPEN.has(String(po.status || ""));
  });
  if (!blocking.length) return "";
  return `${blocking.join(", ")} is not confirmed — a truck should not be loaded against an unconfirmed order.`;
}

/** Add an empty pallet row (producer loaded more than planned). */
export function addBlankRow(rows: ProtocolPalletRow[], like?: Partial<ProtocolPalletRow>): ProtocolPalletRow[] {
  // v6.57.0: inherit from the last row that actually carries goods, not from the
  // blank padding at the bottom of the sheet — otherwise an added pallet arrives
  // with no variety and no calibre and the producer has to retype both.
  const real = filledRows(rows);
  const last = real[real.length - 1] || (rows || [])[(rows || []).length - 1];
  const next = [...(rows || []), {
    no: 0, boxes: like?.boxes ?? last?.boxes ?? 72, kgPerBox: like?.kgPerBox ?? last?.kgPerBox ?? 13,
    product: like?.product ?? last?.product ?? "", variety: like?.variety ?? last?.variety ?? "", size: like?.size ?? last?.size ?? "",
    boxesOk: null, goodsOk: null, remarks: "", observations: "",
  } as ProtocolPalletRow];
  return next.map((r, i) => ({ ...r, no: i + 1 }));
}

/** "Loaded exactly as printed" — the common case, in one action. */
export function confirmAsLoaded(rows: ProtocolPalletRow[]): ProtocolPalletRow[] {
  // v6.57.0: ticks only the rows carrying goods. Ticking the blank padding would
  // make 15 empty lines read as inspected-and-sound pallets — the exact false
  // completeness this sheet exists to prevent.
  return (rows || []).map(r => isBlankRow(r) ? r : ({ ...r, boxesOk: true, goodsOk: true, remarks: r.remarks || "Brak" }));
}

/** Next protocol number, house convention LP-YYYY-NNNN. */
export function nextProtocolNumber(existing: any[], year: number): string {
  const prefix = `LP-${year}-`;
  let max = 0;
  (existing || []).forEach((p: any) => {
    const n = String(p?.number || "");
    if (!n.startsWith(prefix)) return;
    const v = parseInt(n.slice(prefix.length), 10);
    if (!isNaN(v) && v > max) max = v;
  });
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export interface BuildDeps { todayISO: () => string; nextId: () => any; }

/** Build a fresh protocol from a shipment + its first (loading) leg. */
export function buildLoadingProtocol(input: {
  shipment: any; leg?: any; unit?: any; goods?: any[]; supplier?: any; receiverName?: string; poRef?: string; palletType?: PalletType;
  carrierName?: string; types?: PackagingType[]; existingProtocols?: any[];
}, deps: BuildDeps): LoadingProtocol {
  const sh = input.shipment || {};
  const leg = input.leg || (sh.legs || [])[0] || {};
  const allGoods = input.goods && input.goods.length ? input.goods : (sh.goods || []);
  const types = input.types || [];
  const unit = input.unit || (leg.vehicles || [])[0] || {};
  // v6.53.0: the sheet covers THIS TRUCK's load, not the shipment's. With no
  // assignment recorded the truck carries everything — the single-truck norm.
  const goods = unitGoodsLines(allGoods, unit);
  const products = Array.from(new Set((goods || []).map((g: any) => String(g.product || "").trim()).filter(Boolean)));

  return {
    id: deps.nextId(),
    number: nextProtocolNumber(input.existingProtocols || [], new Date(deps.todayISO()).getFullYear() || 2026),
    shipmentRef: sh.number || "",
    legId: leg.id ?? 1,
    unitId: unit.id ?? null,
    poRef: input.poRef || (sh.poRefs || [])[0] || "",
    palletType: (input.palletType as PalletType) || (unit.palletType as PalletType) || "standard",
    departedOn: "",
    supplierName: input.supplier?.name || "",
    supplierAddress: input.supplier?.address || "",
    receiverName: input.receiverName || "",
    assortment: products.join(", "),
    truckPlate: unit.truckPlate || leg.vehiclePlate || "",
    trailerPlate: unit.trailerPlate || leg.trailerPlate || "",
    carrierName: input.carrierName || "",
    chamberTempBeforeC: "",
    checks: { transportClean: null, chamberClean: null, foreignOdours: null, packagingCompliant: null },
    rows: deriveRows(goods, types),
    recorderNos: String(unit.tempRecorderNo || "").trim() ? [String(unit.tempRecorderNo).trim()] : [],
    driverName: unit.driverName || leg.driverName || "",
    driverSignedDate: "",
    issuerSignedDate: "",
    status: "Draft",
    returnedAt: "",
    notes: "",
    scanLink: "",
    formVersion: "25.10.23",
  };
}

/**
 * Is the returned protocol CLEAN — i.e. does it establish that the goods left in
 * good order? A clean protocol is the evidence base for a transport claim.
 * Anything flagged becomes a pre-existing condition recorded before departure.
 */
export function protocolExceptions(p: LoadingProtocol | any): string[] {
  const out: string[] = [];
  const c = p?.checks || {};
  if (c.transportClean === false) out.push("Vehicle not clean / środek transportu niezgodny");
  if (c.chamberClean === false) out.push("Cold chamber not clean / komora chłodnicza niezgodna");
  if (c.foreignOdours === true) out.push("Foreign odours present / obecne obce zapachy");
  if (c.packagingCompliant === false) out.push("Packaging or pallets non-compliant / stan opakowań NIEZGODNY");
  filledRows(p?.rows || []).forEach((r: any) => {
    if (r.boxesOk === false) out.push(`Pallet ${r.no}: boxes damaged / skrzynki uszkodzone`);
    if (r.goodsOk === false) out.push(`Pallet ${r.no}: goods damaged / towar uszkodzony`);
    if (String(r.remarks || "").trim() && String(r.remarks).trim().toLowerCase() !== "brak") out.push(`Pallet ${r.no}: ${r.remarks}`);
  });
  return out;
}

export function isProtocolClean(p: LoadingProtocol | any): boolean {
  return protocolExceptions(p).length === 0;
}

/** What still has to come back before the protocol can serve as evidence. */
/** A driver signs AT THE DOCK, before departure. A signature dated after the goods
 *  left proves nothing about the state they left in — the exact weakness a carrier
 *  would rely on — so it is surfaced rather than silently accepted. */
export function signatureWarnings(p: any): string[] {
  const out: string[] = [];
  const dep = String(p?.departedOn || "").trim();
  const drv = String(p?.driverSignedDate || "").trim();
  const iss = String(p?.issuerSignedDate || "").trim();
  if (dep && drv && drv > dep) out.push(`Driver signed ${drv}, after the truck left on ${dep} — a signature collected after departure is weak evidence.`);
  if (dep && iss && iss > dep) out.push(`Producer signed ${iss}, after the truck left on ${dep}.`);
  if (drv && iss && drv !== iss) out.push(`Driver (${drv}) and producer (${iss}) signed on different days — both sign at the dock.`);
  return out;
}

/** Is the returned sheet genuinely usable as evidence? */
export function isProtocolComplete(p: any): boolean { return protocolGaps(p).length === 0; }

export function protocolGaps(p: LoadingProtocol | any): string[] {
  const gaps: string[] = [];
  if (!String(p?.driverSignedDate || "").trim()) gaps.push("Driver signature date missing");
  if (!String(p?.issuerSignedDate || "").trim()) gaps.push("Producer (wydawca) signature date missing");
  if (!(p?.recorderNos || []).filter(Boolean).length) gaps.push("Temperature recorder number(s) not recorded");
  if (!String(p?.chamberTempBeforeC || "").trim()) gaps.push("Cold-chamber temperature before loading missing");
  if (!String(p?.scanLink || "").trim()) gaps.push("Signed scan not linked — the stamped original is the evidence");
  const c = p?.checks || {};
  if (c.transportClean === null || c.chamberClean === null || c.foreignOdours === null || c.packagingCompliant === null) {
    gaps.push("One or more condition checks not filled in");
  }
  // v6.57.0: only rows that carry goods are judged. The sheet prints 21 lines by
  // design, and empty padding is not an unconfirmed pallet — treating it as one
  // would make every sheet permanently incomplete.
  const real = filledRows(p?.rows || []);
  if (real.some((r: any) => !String(r.size || "").trim())) gaps.push("Calibre (Rozmiar) missing on some pallets");
  if (real.some((r: any) => r.boxesOk === null || r.goodsOk === null)) gaps.push("Pallet condition not confirmed on every row");
  return gaps;
}
