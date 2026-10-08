// ── SHIPMENT & INVENTORY GATES (v6.78.0) ────────────────────────────────────
import { S } from "./format";
import { lotLoadedTwice } from "./lotView.domain";   // v7.11.5 (A-RV-28)
// The same shape Purchase Orders got in v6.72.0: a very small number of hard
// gates, more warnings that state their CONSEQUENCE, and a readiness view while
// you work rather than a refusal at the save button.
//
// The split is about consequence, not importance. A gate is for something that
// would leave the data saying a thing that did not happen. Everything else
// reports — because a truck at a dock does not wait for a form.

const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : 0; };

// ── SHIPMENTS ───────────────────────────────────────────────────────────────

/** THE ONE HARD GATE. Since v6.58.0, marking a shipment Loaded or Delivered
 *  POSTS INVENTORY MOVEMENTS. A shipment with no goods rows posts nothing and
 *  then reports itself as done — the same class as the phantom receipts: an
 *  action claiming to have happened when nothing did. Owner agreed this blocks.
 *
 *  Booking is deliberately NOT gated: the owner books a truck and sends the
 *  transport order before the goods are final, which is a real workflow. */
export function shipmentPostBlockReason(shipment: any, nextStatus: string, ctx: { orders?: any[]; lots?: any[] } = {}): string {
  if (!["Loaded", "Arrived", "Delivered", "Closed"].includes(S(nextStatus))) return "";
  const rows = (shipment?.goods || []).filter((g: any) => num(g?.qtyKg) > 0);
  if (rows.length) {
    // v7.9.1 (A-SHP-GATE-1, owner rule 8 Oct): a shipment may be booked on a draft sale and expected goods (the transport orders go out early),
    // but it moves on only when what it carries is confirmed — every sale Confirmed, every lot with its REAL kilos
    const open: string[] = [];
    const soNos = Array.from(new Set([...(shipment?.soRefs || []), ...rows.map((g: any) => g.soRef)].filter(Boolean).map(String)));
    soNos.forEach(no => { const so = (ctx.orders || []).find((o: any) => String(o.number) === no); if (so && S(so.status) === "Draft") open.push(`${no} is still a Draft — confirm it first`); });
    Array.from(new Set(rows.map((g: any) => g.lotRef).filter(Boolean).map(String))).forEach(no => { const lot = (ctx.lots || []).find((l: any) => String(l.number) === no); if (!lot) return; const real = num(lot.receivedKg) > 0 || (lot.movements || []).some((m: any) => m && !m.voided && m.type === "IN") || !!lot.directFlow; if (!real) open.push(`${no} has no real kilos yet — ${lot.poRef ? `${lot.poRef} not received` : "not received"}`); });
    return open.length ? `${S(shipment?.number) || "This shipment"} cannot become ${nextStatus} yet:\n• ${open.join("\n• ")}` : "";
  }
  return `${S(shipment?.number) || "This shipment"} carries no goods, so marking it ${nextStatus} would post nothing to inventory and still report the movement as done. Add what is on the truck first.`;
}

export interface Warning { field: string; why: string; }

/** Everything that WEAKENS a shipment but must not stop it.
 *  `strict` turns on the checks that only matter once goods are moving — a
 *  booking legitimately has no plates yet. */
export function shipmentWarnings(shipment: any, opts: { strict?: boolean; isExport?: boolean } = {}): Warning[] {
  const out: Warning[] = [];
  const legs = (shipment?.legs || []).filter((l: any) => S(l?.mode));
  const units = legs.flatMap((l: any) => (l.vehicles || []));

  const hasProvider = S(shipment?.carrierId) || S(shipment?.forwarderId)
    || legs.some((l: any) => S(l.carrierId) || S(l.forwarderId));
  if (!hasProvider) {
    out.push({ field: "carrier", why: "no carrier or forwarder — no transport order can be printed, and the freight cost has no supplier to land on" });
  }
  if (!S(shipment?.loadingDate)) {
    out.push({ field: "loading date", why: "no loading date — nothing shows when this is due, and overdue warnings can never fire" });
  }
  if (!S(shipment?.expectedDeliveryDate)) {
    out.push({ field: "delivery date", why: "no expected delivery — the client has no date and the order shows no timing" });
  }

  // Plates: a WARNING, never a gate. The owner books the truck and sends the
  // transport order BEFORE the registration is known — the numbers follow later.
  if (opts.strict) {
    const identified = units.some((u: any) => S(u?.truckPlate) || S(u?.containerNumber));
    if (units.length && !identified) {
      out.push({ field: "registration", why: "no plate or container number on any unit — the loading protocol will print its registration line blank, and a transport claim needs to name the truck" });
    }
  }

  // Several trucks on one leg with nothing said about what each carries: the
  // protocol splits the load evenly, which may not be what was loaded.
  legs.forEach((l: any, i: number) => {
    const vs = (l.vehicles || []);
    if (vs.length < 2) return;
    const assigned = vs.some((u: any) => (u?.load || []).some((a: any) => num(a?.qtyKg) > 0));
    if (!assigned) {
      out.push({ field: `leg ${i + 1} load`, why: `${vs.length} trucks with no split recorded — each loading protocol will show an equal share, which may not be what actually went on each truck` });
    }
  });

  if (opts.isExport && !(shipment?.customs?.applies === false) && !S(shipment?.customs?.declRef)) {
    out.push({ field: "customs", why: "no export declaration reference — it is the proof for zero-rating and is far harder to obtain once the goods have gone" });
  }
  return out;
}

// ── INVENTORY ───────────────────────────────────────────────────────────────

// v7.11.1 (A-RV-23, owner 8 Oct): movementBlockReason retired — no screen called it, and the movement window's own limit
// (InventoryWindows maxByType) is the more complete rule: direct lots count their expected kilos, an edited movement is not
// counted against itself. One rule, the one people use.

/** A lot expected for too long. Owner ruling: TEN DAYS.
 *  Either it arrived and nobody said so — in which case the sales orders drawing
 *  on it are reading stock that is not confirmed — or the producer never sent it
 *  and the purchase order should be closed short. */
export const LOT_AGEING_DAYS = 10;

export function lotWarnings(lot: any, todayISO: string): Warning[] {
  const out: Warning[] = [];
  const status = S(lot?.status);
  const expected = num(lot?.expectedKg);
  const received = num(lot?.receivedKg);

  if (status === "Expected" && expected > 0) {
    const since = S(lot?.loadingDate) || S(lot?.expectedDate) || S(lot?.createdAt);
    const days = daysBetween(since, todayISO);
    if (days != null && days > LOT_AGEING_DAYS) {
      out.push({ field: "still expected", why: `expected for ${days} days — either it arrived and was never recorded (so orders are reading stock nobody has confirmed), or the producer never sent it and the purchase order should be closed short` });
    }
  }

  if (expected > 0 && received > 0) {
    const delta = received - expected;
    const pct = Math.abs(delta) / expected * 100;
    if (pct >= 5) {
      out.push({
        field: "variance",
        why: `${delta > 0 ? "over" : "short"} by ${Math.abs(Math.round(delta)).toLocaleString("pl-PL")} kg (${pct.toFixed(1)}%) against what was ordered — worth agreeing with the producer before his invoice arrives`,
      });
    }
  }

  const live = (lot?.movements || []).filter((m: any) => m && !m.voided);
  const unexplained = live.filter((m: any) => !S(m?.shipmentRef) && !S(m?.note) && !S(m?.reason)).length;
  if (unexplained) {
    out.push({ field: "unexplained movements", why: `${unexplained} movement(s) with no shipment, note or reason — an unexplained kilo is the hardest thing to reconstruct months later` });
  }

  if (num(lot?.physicalKg) > 0) {
    const lastIn = live.filter((m: any) => S(m?.type).toUpperCase() === "IN").map((m: any) => S(m?.date)).sort().pop();
    const days = daysBetween(lastIn || "", todayISO);
    if (days != null && days > 30) {
      out.push({ field: "ageing stock", why: `in store ${days} days and still unsold — fruit ages, and storage is charged for every one of those days` });
    }
  }
  return out;
}

/** v7.10.3 (A-RV-15, owner 8 Oct): the lot warnings shown on screen — the two the owner approved (a lot still expected after
 *  ten days; received kilos 5 % or more off the order). The other two of lotWarnings (unexplained movements, ageing stock)
 *  wait for the owner (registered A-RV-24). Shown in amber: they are hints, not errors. */
export const LOT_WARNINGS_SHOWN = ["still expected", "variance", "unexplained movements", "ageing stock"];   // v7.11.2 (A-RV-24, owner 8 Oct): all four
export function lotWarningsShown(lot: any, todayISO: string): Warning[] {
  if (/Cancelled|Deleted/.test(S(lot?.status))) return [];
  // v7.11.5 (A-RV-28, owner 8 Oct): a lot received twice (kept as history by ruling) already says so with its +100 % badge — no ±5 % warning on top
  const twice = !!lotLoadedTwice(lot);
  return lotWarnings(lot, todayISO).filter(w => LOT_WARNINGS_SHOWN.includes(w.field) && !(w.field === "variance" && twice));
}

function daysBetween(fromISO: string, toISO: string): number | null {
  const a = S(fromISO).slice(0, 10), b = S(toISO).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const d = (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000;
  return isFinite(d) ? Math.round(d) : null;
}

// ── LIST ORDER ──────────────────────────────────────────────────────────────
// Owner ruling: "newest first for document registers, alphabetical for
// reference data." The distinction is what the list is FOR — a register is a
// record of what happened, and the thing you want is almost always the thing
// you just made. Reference data is looked up by name, and alphabetical is the
// only order in which lookup is fast.

/** Documents: newest first, by number then date — the number carries the year
 *  and a running sequence, so it orders correctly without parsing dates. */
export function newestFirst<T extends Record<string, any>>(rows: T[], numberKey = "number", dateKey = "date"): T[] {
  return [...(rows || [])].sort((a, b) => {
    const an = S(a?.[numberKey]), bn = S(b?.[numberKey]);
    if (an && bn && an !== bn) return bn.localeCompare(an, undefined, { numeric: true });
    return S(b?.[dateKey]).localeCompare(S(a?.[dateKey]));
  });
}

/** Reference data: A→Z, Polish collation so ą, ć, ł sort where a reader expects. */
export function alphabetical<T extends Record<string, any>>(rows: T[], nameKey = "name"): T[] {
  return [...(rows || [])].sort((a, b) => S(a?.[nameKey]).localeCompare(S(b?.[nameKey]), "pl", { sensitivity: "base" }));
}
