// ── RECEIPTS AND STOCK (v6.55.0) ────────────────────────────────────────────
// User ruling, Aug 2026:
//
//   "The PO is consumed by SO and not Shipment, as a shipment could be moving
//    the cargo from the port to the warehouse until we sell it."
//
// Until v6.55.0 the create-shipment modal blocked you when the kilos already on
// shipments of a PO reached the PO quantity. That treats a MOVEMENT as
// CONSUMPTION, and in this business the same cargo moves several times:
// producer -> port warehouse -> container -> discharge port -> client. Five
// trucks and four containers carrying one order made the order look shipped
// twice over, and the second movement was refused.
//
// v6.34.6 had tried to patch this with a carve-out (a pre-carriage road leg to
// a PORT under CIF/CFR/CPT/CIP does not count). It only covered that one shape:
// it broke on a truck running to a customs point where the client transships,
// and on cargo loaded straight into a container at an Italian producer. The
// carve-out is removed with the rule it was patching.
//
// A purchase order is consumed by SALES ORDERS, and that ledger already exists
// and is correct (salesOrders.domain poLineReservations — per line, excluding
// Draft and Cancelled SOs). Nothing here duplicates it.
//
// What genuinely constrains a shipment is physical, and this module holds it:
//   1. RECEIPT  — how much of a PO actually arrived. Only the inbound movement
//                 counts, and over-receipt WARNS rather than blocks: producers
//                 over-load routinely and the PO already tracks variance.
//   2. STOCK    — you cannot move more kilos out of a lot than the lot holds.
//                 This one is a hard fact rather than a policy.

function num(v: any): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
}

function cancelled(x: any): boolean {
  const s = String(x?.status || "").trim();
  return s === "Cancelled" || s === "Canceled" || s === "Void";
}

/** Does this shipment RECEIVE goods against a purchase order?
 *  Only the first, inbound movement does. A transfer from the port to the
 *  warehouse, or an outbound delivery to a client, moves goods that have
 *  already been received — counting those is the double-count that blocked
 *  PO-2026-0009 and PO-2026-0013. */
export function isReceiptOfPO(sh: any): boolean {
  if (!sh || cancelled(sh)) return false;
  const p = String(sh.purpose || "").toUpperCase();
  // Absent purpose: treat a shipment that names a PO as a receipt, which is what
  // every pre-v6.55.0 inbound shipment is. Being generous here only ever makes
  // the warning MORE cautious, never the block tighter — there is no block.
  if (!p) return (sh.poRefs || []).length > 0;
  return p === "INBOUND";
}

/** Kilos received per PO line, across live inbound shipments. */
export function receivedKgByPoLine(shipments: any[], poNumber: string): Record<string, number> {
  const map: Record<string, number> = {};
  (shipments || []).filter(isReceiptOfPO).forEach(sh => {
    (sh.goods || []).forEach((g: any) => {
      if (String(g.poRef || "") !== String(poNumber)) return;
      const key = String(g.poLineId ?? g.lineId ?? "");
      if (!key) return;
      map[key] = (map[key] || 0) + num(g.qtyKg);
    });
  });
  return map;
}

export interface OverReceipt { lineId: string; product: string; orderedKg: number; receivedKg: number; overKg: number; }

/** Lines where more has arrived than was ordered.
 *  Reported, never blocked: a producer loading 21 008 kg against a 21 000 kg
 *  line is a Tuesday, not an error. `pendingKg` covers the shipment being
 *  created right now, which has not been saved yet. */
export function overReceiptCheck(poItems: any[], received: Record<string, number>, pendingKg: Record<string, number> = {}): OverReceipt[] {
  const out: OverReceipt[] = [];
  (poItems || []).forEach((it: any, idx: number) => {
    const id = String(it.id ?? idx + 1);
    const ordered = num(it.qty);
    if (ordered <= 0) return;
    const got = (received[id] || 0) + (pendingKg[id] || 0);
    // 1 kg of slack absorbs whole-box rounding (a 13 kg box never divides evenly
    // into a round order quantity) rather than crying wolf on every line.
    if (got > ordered + 1) {
      out.push({ lineId: id, product: String(it.product || ""), orderedKg: ordered, receivedKg: got, overKg: Math.round((got - ordered) * 10) / 10 });
    }
  });
  return out;
}

export interface StockShort { lotRef: string; product: string; availableKg: number; requestedKg: number; shortKg: number; }

/** Goods asked of lots that do not hold them.
 *  This is the constraint that replaces the PO guard, and unlike it this one is
 *  a physical fact: whatever the paperwork says, a lot cannot ship kilos it does
 *  not have. Applies to movements OUT of stock, not to a receipt (which is what
 *  creates the stock in the first place). */
export function lotStockCheck(goods: any[], lots: any[]): StockShort[] {
  const wanted: Record<string, number> = {};
  (goods || []).forEach((g: any) => {
    const ref = String(g.lotRef || "");
    if (!ref) return;
    wanted[ref] = (wanted[ref] || 0) + num(g.qtyKg);
  });
  const out: StockShort[] = [];
  Object.keys(wanted).forEach(ref => {
    const lot = (lots || []).find((l: any) => String(l.number ?? l.lotNumber ?? l.ref) === ref);
    if (!lot) return;                       // unknown lot cannot be judged
    const avail = num(lot.qtyKg ?? lot.remainingKg ?? lot.availableKg);
    if (avail <= 0) return;                 // lot with no quantity recorded — nothing to assert
    if (wanted[ref] > avail + 1) {
      out.push({ lotRef: ref, product: String(lot.product || ""), availableKg: avail, requestedKg: wanted[ref], shortKg: Math.round((wanted[ref] - avail) * 10) / 10 });
    }
  });
  return out;
}

/** One sentence for the create-shipment screen. Empty when there is nothing to
 *  say. Never a block — the caller decides, and in v6.55.0 nobody blocks. */
export function receiptWarningText(over: OverReceipt[]): string {
  if (!over.length) return "";
  const first = over[0];
  const more = over.length > 1 ? ` (and ${over.length - 1} more line${over.length > 2 ? "s" : ""})` : "";
  return `${first.product || "Line"} would be over-received by ${Math.round(first.overKg).toLocaleString("pl-PL")} kg — ordered ${Math.round(first.orderedKg).toLocaleString("pl-PL")}, arriving ${Math.round(first.receivedKg).toLocaleString("pl-PL")}${more}. Recorded as variance; nothing is blocked.`;
}
