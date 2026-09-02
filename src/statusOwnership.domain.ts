// ── STATUS OWNERSHIP (v6.77.0) ──────────────────────────────────────────────
// Owner ruling, Sept 2026: "once we create the shipment for that SO, the status
// of this SO should reflect the status of the shipment… we need to have
// distinction about where the ownership of each module ends and where the other
// begins so that the information flows with minimum human input."
//
// THE PROBLEM. A purchase order already works this way — you set only Draft,
// Confirmed and Cancelled, and operational progress shows as a computed badge,
// because the shipment owns whether goods moved. A SALES ORDER did not: the
// whole lifecycle was typed by hand, including four statuses the shipment
// already knew the truth about. So the same fact lived in two places and drifted
// — six sales orders in the owner's data are marked Shipped or Invoiced with no
// shipment against them at all, and their COGS reads zero as a result.
//
// THE SPLIT.
//   COMMERCIAL, owned by the sales order — decisions nobody else can know:
//       Draft · Confirmed · Invoiced · Closed · Cancelled
//   PHYSICAL, owned by the shipments — facts the sales order should not assert:
//       Reserved · Loading · Shipped · Delivered
//
// OWNER RULINGS that shape the derivation:
//   • NO PARTIAL. "We don't have partially shipped, it is not part of our
//     operations." So there is no half state: an order has shipped or it has not.
//   • ALL OR NOTHING on groupage. "Order becomes shipped when ALL of its goods
//     move, otherwise we won't know what is left to be shipped." One truck
//     serving two orders advances neither until each order's own goods are gone.
//   • OVERRIDE ALLOWED, but visible. The driver leaves and nobody updates the
//     shipment; you must be able to say so. It is recorded as an override, never
//     silently blended with a derived value.

const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : 0; };

/** Statuses the SALES ORDER owns. Everything else is derived. */
export const COMMERCIAL_SO_STATUSES = ["Draft", "Confirmed", "Invoiced", "Closed", "Cancelled"];
/** Statuses the SHIPMENTS own. These may no longer be typed on a sales order. */
// v6.79.0 (owner ruling, W-1): "Reserved" DROPPED as a status — reservation is an
// INVENTORY fact (kg allocated to the order, shown as a figure on the lot), not
// something a shipment can know. Only these three are shipment-derived.
export const PHYSICAL_SO_STATUSES = ["Loading", "Shipped", "Delivered"];

export function isCommercialStatus(s: any): boolean { return COMMERCIAL_SO_STATUSES.includes(S(s)); }
export function isPhysicalStatus(s: any): boolean { return PHYSICAL_SO_STATUSES.includes(S(s)); }

const LIVE = (sh: any) => {
  const st = S(sh?.status);
  return st !== "Cancelled" && st !== "Canceled" && st !== "Void";
};

export interface SoShipmentProgress {
  orderedKg: number;
  /** kg on live shipments that have at least left (Loaded or beyond) */
  movedKg: number;
  /** kg on live shipments that have arrived (Delivered / Closed) */
  deliveredKg: number;
  /** kg merely booked — a truck arranged but not yet loaded */
  bookedKg: number;
  shipments: string[];
  allMoved: boolean;
  allDelivered: boolean;
}

/** What this order's shipments say about it. Kilos, not counts — one truck can
 *  carry part of an order and an order can span several trucks. */
export function soShipmentProgress(order: any, shipments: any[]): SoShipmentProgress {
  const soNo = S(order?.number);
  const orderedKg = (order?.items || []).reduce((a: number, it: any) => a + num(it.qty), 0);
  let movedKg = 0, deliveredKg = 0, bookedKg = 0;
  const seen = new Set<string>();

  (shipments || []).filter(LIVE).forEach(sh => {
    const rows = (sh.goods || []).filter((g: any) => S(g.soRef) === soNo);
    // A shipment with no per-row soRef but naming this order in its header still
    // carries it — older shipments were built that way.
    const kg = rows.length
      ? rows.reduce((a: number, g: any) => a + num(g.qtyKg), 0)
      : ((sh.soRefs || []).map(S).includes(soNo) && !(sh.goods || []).some((g: any) => g.soRef)
          ? (sh.goods || []).reduce((a: number, g: any) => a + num(g.qtyKg), 0) : 0);
    if (kg <= 0) return;
    seen.add(S(sh.number));
    const st = S(sh.status);
    if (st === "Delivered" || st === "Closed") { deliveredKg += kg; movedKg += kg; }
    else if (st === "Loaded") movedKg += kg;
    else bookedKg += kg;   // Draft / Booked — a truck arranged, nothing gone yet
  });

  // ALL OR NOTHING (owner ruling): 1 kg of slack absorbs whole-box rounding,
  // never a real remainder. An order with 1 000 kg still to load has NOT shipped
  // — that is the whole point of knowing what is left.
  const allMoved = orderedKg > 0 && movedKg >= orderedKg - 1;
  const allDelivered = orderedKg > 0 && deliveredKg >= orderedKg - 1;
  return { orderedKg, movedKg, deliveredKg, bookedKg, shipments: Array.from(seen), allMoved, allDelivered };
}

export interface DerivedStatus {
  status: string;
  /** the commercial status underneath — what the sales order itself holds */
  commercial: string;
  derived: boolean;
  overridden: boolean;
  reason: string;
  progress: SoShipmentProgress;
}

/**
 * The status to SHOW for a sales order.
 *
 * Cancelled and Draft always win — a cancelled order never happened and a draft
 * has committed to nothing, whatever trucks exist. Invoiced and Closed also win,
 * because they are commercial conclusions that come after delivery.
 *
 * Otherwise the shipments speak: all delivered → Delivered · all loaded →
 * Shipped · a truck booked → Loading · else the commercial status stands.
 */
export function deriveSoStatus(order: any, shipments: any[]): DerivedStatus {
  const held = S(order?.status);
  const progress = soShipmentProgress(order, shipments);
  const base = { commercial: held, progress };

  const override = S(order?.statusOverride);
  if (override) {
    return { ...base, status: override, derived: false, overridden: true,
      reason: `Set by hand to ${override}${order?.statusOverrideReason ? ` — ${order.statusOverrideReason}` : ""}. The shipments say ${describe(progress)}.` };
  }

  if (held === "Cancelled") return { ...base, status: "Cancelled", derived: false, overridden: false, reason: "Cancelled — it never happened." };
  if (held === "Draft") return { ...base, status: "Draft", derived: false, overridden: false, reason: "Still being prepared." };
  if (held === "Invoiced" || held === "Closed") {
    return { ...base, status: held, derived: false, overridden: false, reason: `${held} — a commercial conclusion the sales order owns.` };
  }

  if (progress.allDelivered) return { ...base, status: "Delivered", derived: true, overridden: false, reason: `All ${Math.round(progress.orderedKg).toLocaleString("pl-PL")} kg delivered on ${progress.shipments.join(", ")}.` };
  if (progress.allMoved) return { ...base, status: "Shipped", derived: true, overridden: false, reason: `All ${Math.round(progress.orderedKg).toLocaleString("pl-PL")} kg loaded on ${progress.shipments.join(", ")}.` };
  if (progress.movedKg > 0 || progress.bookedKg > 0) {
    const left = Math.max(0, Math.round(progress.orderedKg - progress.movedKg));
    return { ...base, status: "Loading", derived: true, overridden: false,
      reason: progress.movedKg > 0
        ? `${Math.round(progress.movedKg).toLocaleString("pl-PL")} kg gone, ${left.toLocaleString("pl-PL")} kg still to load — not shipped until all of it has moved.`
        : `Transport arranged on ${progress.shipments.join(", ")}, nothing loaded yet.` };
  }
  return { ...base, status: held || "Confirmed", derived: false, overridden: false, reason: "No shipment yet." };
}

function describe(p: SoShipmentProgress): string {
  if (!p.shipments.length) return "no shipment exists";
  if (p.allDelivered) return "everything is delivered";
  if (p.allMoved) return "everything is loaded";
  if (p.movedKg > 0) return `${Math.round(p.movedKg).toLocaleString("pl-PL")} of ${Math.round(p.orderedKg).toLocaleString("pl-PL")} kg has moved`;
  return "transport is arranged but nothing has loaded";
}

/** Is the sales order claiming something its shipments do not support?
 *  This is what the six Shipped/Invoiced orders with no dispatch would have
 *  told the owner at the time, instead of quietly reading a zero COGS later. */
export function statusContradiction(order: any, shipments: any[]): string {
  const held = S(order?.status);
  if (!["Shipped", "Delivered", "Invoiced", "Closed"].includes(held)) return "";
  if (S(order?.statusOverride)) return "";
  const p = soShipmentProgress(order, shipments);
  if (!p.shipments.length) {
    return `${held} but no shipment carries this order — its cost of goods will read as zero until a dispatch exists.`;
  }
  if (!p.allMoved) {
    const left = Math.max(0, Math.round(p.orderedKg - p.movedKg));
    return `${held} but ${left.toLocaleString("pl-PL")} kg has not left yet.`;
  }
  return "";
}

/** Record a deliberate override. The reason is required — an override with no
 *  reason is indistinguishable from the drift this whole change removes. */
export function applyStatusOverride(order: any, status: string, reason: string, todayISO: string): any {
  if (!S(status)) return { ...order, statusOverride: "", statusOverrideReason: "", statusOverrideAt: "" };
  return { ...order, statusOverride: S(status), statusOverrideReason: S(reason), statusOverrideAt: S(todayISO) };
}


// ── v6.79.0 (W-1): ONE truth for every gate ───────────────────────────────────
// Before this, the derived status was only DISPLAYED while twelve gates still
// read the STORED status — a shipment could deliver and the Issue-invoice button
// stay hidden. Every gate now asks these two functions and nothing else.
const RANK: Record<string, number> = { Draft: 0, Confirmed: 1, Loading: 2, Shipped: 3, Delivered: 4, Invoiced: 5, Closed: 6, Cancelled: 99 };
export function effectiveSoStatus(order: any, shipments: any[]): string {
  return deriveSoStatus(order, shipments || []).status;
}
export function soRank(status: any): number { return RANK[S(status)] ?? 0; }
/** Goods have physically left (or later) — the gate for invoicing and locking. */
export function isShippedOrLater(order: any, shipments: any[]): boolean {
  const s = effectiveSoStatus(order, shipments);
  return ["Shipped", "Delivered", "Invoiced", "Closed"].includes(s);
}
/** Stored status must be COMMERCIAL. A typed physical status (pre-v6.79 data)
 *  is normalised: supported by shipments → Confirmed (the derivation shows it);
 *  not supported → kept as a visible OVERRIDE, never as a silent fact. */
export function normaliseStoredSoStatus(order: any, shipments: any[]): any {
  const held = S(order?.status);
  if (held === "Reserved") return { ...order, status: "Confirmed" };
  if (!PHYSICAL_SO_STATUSES.includes(held)) return order;
  const p = soShipmentProgress(order, shipments || []);
  const supported = held === "Delivered" ? p.allDelivered : held === "Shipped" ? p.allMoved : (p.movedKg > 0 || p.bookedKg > 0);
  if (supported) return { ...order, status: "Confirmed" };
  return { ...order, status: "Confirmed", statusOverride: held, statusOverrideReason: order?.statusOverrideReason || "Migrated v6.79.0 — typed before status derivation existed; shipments do not show it", statusOverrideAt: order?.statusOverrideAt || "" };
}
