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

/** One row of the pallet table. Mirrors the paper columns 1:1. */
export interface ProtocolPalletRow {
  no: number;              // Nr palety
  boxes: number;           // Ilość opakowań (szt)
  kgPerBox: number;        // x KG
  size: string;            // Rozmiar — HANDWRITTEN at loading, blank when printed
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
  const rows = p.rows || [];
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
export function deriveRows(goods: any[], types: PackagingType[]): ProtocolPalletRow[] {
  const rows: ProtocolPalletRow[] = [];
  let no = 1;
  (goods || []).forEach(g => {
    const net = num(g.qtyKg);
    if (net <= 0) return;
    const pk = findPackaging(types, g.packagingId) || findPackaging(types, g.packaging) || defaultPackagingForProduct(types, g.product);
    const capacity = pk && pk.capacityKg > 0 ? num(pk.capacityKg) : 0;
    if (!capacity) return;                       // unknown packaging → nothing to derive
    const gross = grossForGoodsLine({ qtyKg: net, product: g.product, packaging: g.packaging, packagingId: g.packagingId, pallets: g.pallets }, types);
    const bpp = pk && num(pk.boxesPerPallet) > 0 ? num(pk.boxesPerPallet) : 0;
    palletManifest(gross.boxes, bpp).forEach(m => {
      rows.push({
        no: no++, boxes: m.boxes, kgPerBox: capacity,
        size: "",                                 // handwritten at loading
        boxesOk: null, goodsOk: null, remarks: "", observations: "",
      });
    });
  });
  return rows;
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
  shipment: any; leg?: any; goods?: any[]; supplier?: any; receiverName?: string;
  carrierName?: string; types?: PackagingType[]; existingProtocols?: any[];
}, deps: BuildDeps): LoadingProtocol {
  const sh = input.shipment || {};
  const leg = input.leg || (sh.legs || [])[0] || {};
  const goods = input.goods && input.goods.length ? input.goods : (sh.goods || []);
  const types = input.types || [];
  const unit = (leg.vehicles || [])[0] || {};
  const products = Array.from(new Set((goods || []).map((g: any) => String(g.product || "").trim()).filter(Boolean)));

  return {
    id: deps.nextId(),
    number: nextProtocolNumber(input.existingProtocols || [], new Date(deps.todayISO()).getFullYear() || 2026),
    shipmentRef: sh.number || "",
    legId: leg.id ?? 1,
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
    recorderNos: [],
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
  (p?.rows || []).forEach((r: any) => {
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
export function protocolGaps(p: LoadingProtocol | any): string[] {
  const gaps: string[] = [];
  if (!String(p?.driverSignedDate || "").trim()) gaps.push("Driver signature date missing");
  if (!String(p?.issuerSignedDate || "").trim()) gaps.push("Producer (wydawca) signature date missing");
  if (!(p?.recorderNos || []).filter(Boolean).length) gaps.push("Temperature recorder number(s) not recorded");
  if (!String(p?.chamberTempBeforeC || "").trim()) gaps.push("Cold-chamber temperature before loading missing");
  if (!String(p?.scanLink || "").trim()) gaps.push("Signed scan not linked (Dropbox)");
  const c = p?.checks || {};
  if (c.transportClean === null || c.chamberClean === null || c.foreignOdours === null || c.packagingCompliant === null) {
    gaps.push("One or more condition checks not filled in");
  }
  if ((p?.rows || []).some((r: any) => !String(r.size || "").trim())) gaps.push("Calibre (Rozmiar) not written on every pallet");
  return gaps;
}
