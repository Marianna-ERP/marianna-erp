// ─── v6.99.109 (A-ST-7, owner 2 Oct): A WAREHOUSE'S INVOICE REACHES THE LOTS — ONE PATH ───────────────────────────────
// AGRO-HURT's monthly invoices sat in the register linked to nothing, so no truck settlement ever saw a warehouse cost.
// Now a cost invoice from a warehouse counterparty is allocated to the lots that were at that warehouse in the invoice's
// period, by kilo-days (the time each lot's kilos spent there), and the allocation writes the lots' "warehouse" cost lines
// — the lines the settlement, the lot value and the P/L already read. Re-allocating replaces the same invoice's lines.
import { S, r2 } from "./format";
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
const dayNum = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);

/** Kilo-days a lot spent at the given sites between from and to (inclusive), from its own movements. */
export function lotKgDaysAt(lot: any, siteIds: any[], fromISO: string, toISO: string): number {
  const sites = new Set((siteIds || []).map(String)); if (!sites.size) return 0;
  const live = (lot?.movements || []).filter((m: any) => m && !m.voided && m.date && /^\d{4}-\d{2}-\d{2}/.test(String(m.date))).map((m: any) => ({ ...m, day: dayNum(String(m.date).slice(0, 10)) })).sort((a: any, b: any) => a.day - b.day);
  const from = dayNum(fromISO), to = dayNum(toISO); if (!(to >= from)) return 0;
  // kilos present at the sites, day by day: + on IN / TRANSFER_IN / REVERSAL into a site, − on SHIP_OUT / TRANSFER / DAMAGE / CLAIM out of it
  const events: Array<[number, number]> = [];
  live.forEach((m: any) => {
    const q = num(m.qtyKg); const toHere = m.toId != null && sites.has(String(m.toId)); const fromHere = m.fromId != null && sites.has(String(m.fromId));
    if (["IN", "TRANSFER", "REVERSAL", "CORRECTION"].includes(m.type) && toHere) events.push([m.day, q]);
    if (["SHIP_OUT", "TRANSFER", "DAMAGE", "CLAIM", "ADJUST", "CORRECTION"].includes(m.type) && fromHere) events.push([m.day, -q]);
    if (m.type === "CORRECTION" && !toHere && !fromHere && m.locationId != null && sites.has(String(m.locationId))) events.push([m.day, q]);
  });
  if (!events.length) return 0;
  events.sort((a, b) => a[0] - b[0]);
  let kg = 0, kgDays = 0, cursor = from, i = 0;
  // kilos present before the window
  while (i < events.length && events[i][0] < from) { kg += events[i][1]; i++; }
  for (; i < events.length && events[i][0] <= to; i++) { const [day, delta] = events[i]; if (day > cursor) { kgDays += Math.max(0, kg) * (day - cursor); cursor = day; } kg += delta; }
  if (to + 1 > cursor) kgDays += Math.max(0, kg) * (to + 1 - cursor);
  return Math.round(kgDays);
}
export interface AllocationRow { lotNumber: string; product: string; kgDays: number; sharePct: number; pln: number; }
/** The proposal: every lot with kilo-days at the warehouse in the period, the invoice's net PLN spread by kilo-days. */
export function proposeWarehouseAllocation(invoice: any, lots: any[], siteIds: any[], fromISO: string, toISO: string): { rows: AllocationRow[]; totalPLN: number; kgDays: number } {
  const totalPLN = r2(num(invoice?.netPLN) || num(invoice?.netAmount) * (num(invoice?.fxRate) || 1));
  const kd = (lots || []).filter((l: any) => l && !/Cancelled/.test(String(l.status))).map((l: any) => ({ l, kgDays: lotKgDaysAt(l, siteIds, fromISO, toISO) })).filter(x => x.kgDays > 0);
  const sum = kd.reduce((a, x) => a + x.kgDays, 0);
  const rows: AllocationRow[] = kd.map(x => ({ lotNumber: String(x.l.number), product: [x.l.product, x.l.variety].filter(Boolean).join(" — "), kgDays: x.kgDays, sharePct: sum ? r2(x.kgDays / sum * 100) : 0, pln: sum ? r2(totalPLN * x.kgDays / sum) : 0 }));
  // the rounding remainder lands on the largest share (AUD-33), so the rows add up to the invoice
  const spread = r2(rows.reduce((a, r) => a + r.pln, 0)); if (rows.length && Math.abs(spread - totalPLN) >= 0.005) { const big = rows.reduce((a, r) => (r.pln > a.pln ? r : a), rows[0]); big.pln = r2(big.pln + (totalPLN - spread)); }
  rows.sort((a, b) => b.kgDays - a.kgDays);
  return { rows, totalPLN, kgDays: sum };
}
/** Apply: the lots get one "warehouse" cost line each for this invoice (replace-by-ref: a re-allocation replaces, never doubles). */
export function applyWarehouseAllocation(lots: any[], invoice: any, rows: AllocationRow[], warehouseName: string, deps: { nextId: () => any; todayISO: () => string }): { lots: any[]; touched: string[] } {
  const ref = `cinv:${invoice?.id}`; const touched: string[] = [];
  const next = (lots || []).map((l: any) => {
    const row = rows.find(r => String(r.lotNumber) === String(l?.number)); const had = (l?.costs || []).some((c: any) => String(c.source) === ref);
    if (!row && !had) return l;
    const kept = (l.costs || []).filter((c: any) => String(c.source) !== ref);
    touched.push(String(l.number));
    if (!row || !(row.pln > 0)) return { ...l, costs: kept };
    return { ...l, costs: [...kept, { id: deps.nextId(), type: "warehouse", label: `${warehouseName || "Warehouse"} · ${S(invoice?.number)} · ${row.kgDays.toLocaleString("pl-PL")} kg-days`, pln: row.pln, amountPLN: row.pln, source: ref, invoiceRef: S(invoice?.number), date: deps.todayISO() }] };
  });
  return { lots: next, touched };
}
