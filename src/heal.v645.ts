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
