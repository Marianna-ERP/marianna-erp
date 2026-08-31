// ─── v6.45.0 one-time DATA HEAL (test-round root causes B + C) ───────────────
// Two classes of historical damage are repaired here, once, at load:
//
// C) Shipments that reached Delivered/Closed BEFORE the v6.44.0 close-posting
//    fix never posted their goods — their lots sit at "Expected" with no
//    movements, so COGS / direct costs / weights / integrity are all wrong
//    (deal 1: SHP-2026-0001 → LOT-2026-0001/2/3).
//
// B) Shipments built by the old product-name lot matcher can carry SEVERAL
//    goods rows pointing at the SAME lot while the sales order's lines map to
//    DIFFERENT lots (deal 2: both SHP-2026-0002 rows → LOT-2026-0004, starving
//    LOT-2026-0005). Rows are retagged to their line's true lot (soLineId ↔
//    sourceLineId ↔ poLineId), wrong movements are voided (audit-preserving),
//    and the goods are re-posted and costs re-allocated across the true lots.
//
// The heal is idempotent by construction (voided movements are skipped by the
// posting guard; allocation replaces by source) and additionally runs at most
// once per browser via a localStorage marker set by the caller (App).

import { postShipmentToLots, findLotForSOLine } from "./shipments.domain";
import { allocateShipmentCostsToLots, shipmentLotRefs } from "./costAllocation";
import { recomputeLotFromMovements } from "./inventory.domain";

const TERMINAL = new Set(["Delivered", "Closed"]);

// ─── v6.51.0 heal ────────────────────────────────────────────────────────────
// Two repairs for data created before the v6.51.0 fixes:
//  A) A further delivery against the same PO line was posted as a TRANSFER, which
//     adds no stock — so a 42 000 kg PO delivered in two trucks recorded only
//     21 000 kg received and reported a 50 % shortfall. Such transfers are
//     converted to receipts and the lot's received/physical figures rebuilt.
//  B) OUTBOUND delivery freight was allocated into the lot's landed cost, which
//     hid it from the sale's direct costs and inflated the cost of goods already
//     sold. Those allocated lines are removed from the lot; the cost stays on the
//     shipment, where the margin engine now reads it as a direct cost.
export function healRound651(input: { shipments: any[]; lots: any[] }): { lots: any[]; changed: boolean; notes: string[] } {
  const notes: string[] = [];
  let changed = false;
  const shipByNumber: Record<string, any> = {};
  (input.shipments || []).forEach((s: any) => { if (s?.number) shipByNumber[String(s.number)] = s; });

  const lots = (input.lots || []).map((lot: any) => {
    let movements = [...(lot.movements || [])];
    let touched = false;

    // A — convert mis-posted transfers back into receipts
    const ordered = num(lot.expectedKg);
    if (ordered > 0) {
      let received = movements.filter((m: any) => !m.voided && m.type === "IN")
        .reduce((a: number, m: any) => a + num(m.qtyKg), 0);
      movements = movements.map((m: any) => {
        if (m.voided || m.type !== "TRANSFER") return m;
        const sh = shipByNumber[String(m.shipmentRef || "")];
        if (!sh || String(sh.purpose || "").toUpperCase() !== "INBOUND") return m;
        const outstanding = Math.max(0, ordered - received);
        if (!(outstanding > 0) || !(num(m.qtyKg) > 0)) return m;
        const take = Math.min(num(m.qtyKg), outstanding);
        received += take;
        touched = true;
        notes.push(`${lot.number}: ${m.shipmentRef} re-posted as a receipt of ${take} kg (was a transfer)`);
        return { ...m, type: "IN", qtyKg: take, note: `IN via ${m.shipmentRef} — further delivery (healed v6.51.0)` };
      });
    }

    // B — drop outbound-shipment cost lines from the lot's landed cost
    const keptCosts = (lot.costs || []).filter((c: any) => {
      const src = String(c?.source || "");
      const shipNo = src.includes("/") ? src.split("/")[0] : "";
      const sh = shipNo ? shipByNumber[shipNo] : null;
      const isOutbound = sh && String(sh.purpose || "").toUpperCase() === "OUTBOUND";
      if (isOutbound) { touched = true; notes.push(`${lot.number}: removed ${shipNo} delivery cost from landed cost (belongs to the sale)`); }
      return !isOutbound;
    });

    if (!touched) return lot;
    changed = true;
    const receivedKg = movements.filter((m: any) => !m.voided && m.type === "IN").reduce((a: number, m: any) => a + num(m.qtyKg), 0);
    const shippedKg = movements.filter((m: any) => !m.voided && m.type === "SHIP_OUT").reduce((a: number, m: any) => a + num(m.qtyKg), 0);
    const physicalKg = Math.max(0, Math.round((receivedKg - shippedKg) * 1000) / 1000);
    const overIssuedKg = Math.max(0, Math.round((shippedKg - receivedKg) * 1000) / 1000);
    return {
      ...lot, movements, costs: keptCosts,
      receivedKg: Math.round(receivedKg * 1000) / 1000,
      physicalKg, overIssuedKg,
      status: physicalKg <= 0 && shippedKg > 0 ? "Shipped Out" : (receivedKg > 0 ? "In Stock" : lot.status),
    };
  });
  return { lots, changed, notes };
}
const num = (v: any) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

export interface HealDeps {
  todayISO: () => string;
  nextId: () => any;
  costMapper: { inventoryType: (code: any) => string; label: (code: any) => string };
}

export interface HealResult {
  shipments: any[];
  lots: any[];
  changed: boolean;
  notes: string[];
}

/** Map a shipment's goods rows to their TRUE lots via the governing SO's lines. */
function retagGoodsRows(sh: any, orders: any[], lots: any[], notes: string[]): { sh: any; retagged: boolean } {
  const soNumbers = new Set([
    ...((sh.soRefs || []).filter(Boolean).map(String)),
    ...((sh.goods || []).map((g: any) => g.soRef).filter(Boolean).map(String)),
  ]);
  if (!soNumbers.size) return { sh, retagged: false };

  let retagged = false;
  let goods = sh.goods || [];
  soNumbers.forEach(soNo => {
    const order = (orders || []).find((o: any) => String(o.number) === soNo);
    if (!order) return;
    // expected lot per SO line id, claimed so two same-product lines get their own lots
    const claimed = new Set<string>();
    const expectedByLineId: Record<string, string> = {};
    (order.items || []).forEach((it: any) => {
      const lot = findLotForSOLine(lots, it, { claimed });
      if (lot) { claimed.add(String(lot.number)); expectedByLineId[String(it.id)] = String(lot.number); }
    });
    goods = goods.map((g: any) => {
      if (String(g.soRef || "") !== soNo || g.soLineId == null) return g;
      const expected = expectedByLineId[String(g.soLineId)];
      if (!expected || String(g.lotRef || "") === expected) return g;
      retagged = true;
      notes.push(`${sh.number}: goods row for SO line ${g.soLineId} retagged ${g.lotRef || "(none)"} → ${expected}`);
      return { ...g, lotRef: expected };
    });
  });
  if (!retagged) return { sh, retagged: false };
  // refresh the shipment-level lotRefs from the corrected rows
  const lotRefs = Array.from(new Set(goods.map((g: any) => g.lotRef).filter(Boolean)));
  return { sh: { ...sh, goods, lotRefs }, retagged: true };
}

/** Does this shipment have any live (non-voided) posted movement? */
function hasLivePosting(sh: any, lots: any[]): boolean {
  return (lots || []).some((l: any) => (l.movements || []).some((m: any) =>
    !m.voided && (m.shipmentRef ? String(m.shipmentRef) === String(sh.number) : String(m.note || "").includes(String(sh.number)))));
}

/** Are ALL of the shipment's goods lots fully posted (each has a live movement)? */
function fullyPosted(sh: any, lots: any[]): boolean {
  const refs = shipmentLotRefs(sh);
  if (!refs.length) return true;
  return refs.every(ref => {
    const lot = (lots || []).find((l: any) => String(l.number) === String(ref));
    if (!lot) return true; // nothing to post into
    return (lot.movements || []).some((m: any) =>
      !m.voided && (m.shipmentRef ? String(m.shipmentRef) === String(sh.number) : String(m.note || "").includes(String(sh.number))));
  });
}

export function healRound645(input: { shipments: any[]; lots: any[]; orders: any[] }, deps: HealDeps): HealResult {
  const notes: string[] = [];
  let lots = (input.lots || []).map((l: any) => ({ ...l }));
  let changed = false;

  const shipments = (input.shipments || []).map((sh0: any) => {
    // ── B: retag duplicated goods rows to their true lots ──
    const { sh, retagged } = retagGoodsRows(sh0, input.orders || [], lots, notes);

    const terminal = TERMINAL.has(String(sh.status));
    const needsRepost = retagged && hasLivePosting(sh, lots);
    const needsFirstPost = terminal && !fullyPosted(sh, lots);
    if (!needsRepost && !needsFirstPost && !retagged) return sh0;
    changed = true;

    if (needsRepost) {
      // void this shipment's live movements — the quantities were attributed to
      // the wrong lot(s); history is preserved, the fresh post below is correct.
      let voided = 0;
      lots = lots.map((l: any) => ({
        ...l,
        movements: (l.movements || []).map((m: any) => {
          const mine = !m.voided && (m.shipmentRef ? String(m.shipmentRef) === String(sh.number) : String(m.note || "").includes(String(sh.number)));
          if (!mine) return m;
          voided++;
          return { ...m, voided: true, voidNote: "v6.45.0 heal: re-posted after goods-row lot correction" };
        }),
      }));
      if (voided) notes.push(`${sh.number}: ${voided} misattributed movement(s) voided`);
      if (voided && !terminal) {
        // the shipment isn't terminal yet, so no fresh post follows — recompute
        // the affected lots so their derived fields (physical/status) reflect
        // the voiding instead of keeping stale "Shipped Out" labels. When the
        // user marks the shipment Delivered/Closed (on the fixed build), the
        // correct posting completes the story.
        lots = lots.map((l: any) => (l.movements || []).some((m: any) => m.voidNote && String(m.shipmentRef) === String(sh.number))
          ? recomputeLotFromMovements(l, l.movements || [], () => null) : l);
        notes.push(`${sh.number}: affected lots recomputed — mark the shipment Delivered/Closed to complete the corrected posting`);
      }
    }

    if (terminal && (needsRepost || needsFirstPost)) {
      const before = lots.map(l => (l.movements || []).length).join(",");
      lots = postShipmentToLots(sh, lots, { todayISO: deps.todayISO, nextId: deps.nextId }).lots;
      const after = lots.map(l => (l.movements || []).length).join(",");
      if (before !== after) notes.push(`${sh.number}: goods posted (${needsFirstPost ? "closed before v6.44.0" : "re-post after correction"})`);
      // re-allocate costs across the (now correct) lot set — replace-by-source
      const costTotal = (sh.costs || []).reduce((s: number, c: any) => s + num(c.amountPLN), 0);
      if (shipmentLotRefs(sh).length && costTotal > 0) {
        lots = allocateShipmentCostsToLots(sh, lots, deps.costMapper);
        notes.push(`${sh.number}: costs re-allocated across ${shipmentLotRefs(sh).length} lot(s)`);
      }
    }
    return sh;
  });

  return { shipments, lots, changed, notes };
}


// ─── v6.73.0 heal — PHANTOM RECEIPTS ─────────────────────────────────────────
// A lot cannot be received twice. Before v6.73.0 the INBOUND posting branch
// computed a "not yet received" guard and never applied it, so on a
// producer → port → container export BOTH legs could post a pass-through pair.
// Whether it doubled depended on the order the legs were marked Loaded.
//
// This voids the SECOND receipt and its matching ship-out on any lot that shows
// more than one live IN for the same quantity from different shipments, then
// rebuilds the derived figures. Voided, never deleted (owner ruling) — the
// history stays readable and says why.
//
// Physical stock was never wrong: every phantom IN had a matching SHIP_OUT, so
// quantities always netted out. What was wrong is receivedKg, and everything
// that reads it — received-vs-expected variance and the supply calculations.
export function healPhantomReceipts(input: { lots: any[] }): { lots: any[]; changed: boolean; notes: string[] } {
  const notes: string[] = [];
  let changed = false;

  const lots = (input.lots || []).map((lot: any) => {
    const live = (lot.movements || []).filter((m: any) => m && !m.voided);
    const ins = live.filter((m: any) => m.type === "IN");
    if (ins.length < 2) return lot;

    // Keep the EARLIEST receipt — the goods genuinely arrived once, on the first
    // leg that brought them in. Later identical receipts are the phantom.
    const ordered = [...ins].sort((a: any, b: any) =>
      String(a.date || "").localeCompare(String(b.date || "")) || (a.id || 0) - (b.id || 0));
    // A SECOND RECEIPT IS NOT AUTOMATICALLY PHANTOM. A 42 000 kg order delivered
    // by two trucks of 21 000 is received twice, correctly — LOT-2026-0021 in
    // the owner's data is exactly that, and an earlier draft of this heal would
    // have voided half of a genuine delivery. Two receipts are only phantom when
    // they OVERFILL the order: the goods cannot have arrived more than once.
    const orderedKg = num(lot.expectedKg);
    const totalIn = ordered.reduce((a: number, m: any) => a + num(m.qtyKg), 0);
    // 1 kg of slack for whole-box rounding; producers over-load, and an
    // over-DELIVERY is a variance to record, not a duplicate to erase. Only a
    // receipt that takes the lot to roughly DOUBLE its order is a re-post.
    if (!(orderedKg > 0) || totalIn <= orderedKg * 1.5) return lot;

    // Drop later receipts, newest first, until what remains fits the order.
    const drop: any[] = [];
    let running = totalIn;
    for (let i = ordered.length - 1; i > 0 && running > orderedKg + 1; i--) {
      drop.push(ordered[i]);
      running -= num(ordered[i].qtyKg);
    }
    if (!drop.length) return lot;

    const dropShipments = new Set(drop.map((m: any) => String(m.shipmentRef || "")));
    const movements = (lot.movements || []).map((m: any) => {
      if (m.voided) return m;
      const mine = dropShipments.has(String(m.shipmentRef || ""));
      // Void the phantom receipt AND the ship-out it was paired with — dropping
      // the IN alone would leave an unmatched issue and a negative balance.
      if (mine && (m.type === "IN" || m.type === "SHIP_OUT")) {
        return { ...m, voided: true, voidNote: "v6.73.0 heal: goods already received on an earlier leg — a lot cannot be received twice" };
      }
      return m;
    });

    const receivedKg = movements.filter((m: any) => !m.voided && m.type === "IN").reduce((a: number, m: any) => a + num(m.qtyKg), 0);
    const shippedKg = movements.filter((m: any) => !m.voided && m.type === "SHIP_OUT").reduce((a: number, m: any) => a + num(m.qtyKg), 0);
    const physicalKg = Math.max(0, Math.round((receivedKg - shippedKg) * 1000) / 1000);
    changed = true;
    notes.push(`${lot.number}: ${drop.length} phantom receipt(s) voided (${dropShipments.size ? Array.from(dropShipments).join(", ") : "?"}) — receivedKg ${num(lot.receivedKg)} → ${receivedKg}`);
    return {
      ...lot, movements,
      receivedKg: Math.round(receivedKg * 1000) / 1000,
      physicalKg,
      overIssuedKg: Math.max(0, Math.round((shippedKg - receivedKg) * 1000) / 1000),
    };
  });

  return { lots, changed, notes };
}
