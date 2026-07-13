// ─── v6.5.0: WAREHOUSE CHARGES ENGINE ───────────────────────────────────────
// Computes EXPECTED rented-warehouse charges per lot from its movement history,
// so the warehouse's invoice can be double-checked line by line.
//
//   storage   = kg-days (or pallet-days) at the warehouse × tariff rate,
//               after an optional free period from first receipt
//   handling  = received kg × in-rate, shipped kg × out-rate
//   sorting   = logged sorting events (kg × rate)
//
// Pure functions only — no React, no storage. Testable in isolation.

export interface WarehouseTariff {
  storagePerKgDay?: number;      // PLN-equivalent rate per kg per day
  storagePerPalletDay?: number;  // alternative basis: per pallet position per day
  handlingInPerKg?: number;
  handlingOutPerKg?: number;
  sortingPerKg?: number;
  freeDays?: number;             // first N days after receipt not charged
  currency?: string;             // tariff currency (default PLN)
  fxToPLN?: number;              // rate to PLN (default 1)
  locationIds?: (number | string)[]; // which locations this warehouse operates
}

export interface ChargeLine {
  kind: "storage" | "handling_in" | "handling_out" | "sorting";
  label: string;
  qty: number;        // kg-days / pallet-days / kg
  unit: string;
  rate: number;
  amount: number;     // in tariff currency
  amountPLN: number;
  date?: string;
  note?: string;
}

export interface LotWarehouseCharges {
  lotNumber: string;
  warehouseName: string;
  currency: string;
  fxToPLN: number;
  kgDays: number;
  palletDays: number;
  chargeableKgDays: number;
  chargeablePalletDays: number;
  basis: "pallet" | "kg" | "none";
  lines: ChargeLine[];
  total: number;       // tariff currency
  totalPLN: number;
  notes: string[];
}

function safeN(v: any): number { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; }
function r2(n: number): number { return Math.round(n * 100) / 100; }
function dayMs(d: string): number {
  // date-only midnight (local) — tolerate "YYYY-MM-DDTHH:mm" legacy values
  const s = String(d || "").slice(0, 10);
  const [y, m, dd] = s.split("-").map(Number);
  if (!y || !m || !dd) return NaN;
  return new Date(y, m - 1, dd).getTime();
}
const DAY = 86400000;

// Resolve which warehouse counterparty (with a tariff) operates a location.
export function warehouseForLocation(contacts: any[], locationId: any): { warehouse: any; tariff: WarehouseTariff } | null {
  if (locationId === null || locationId === undefined || locationId === "") return null;
  for (const c of contacts || []) {
    const t = c?.warehouseTariff;
    if (!t) continue;
    if ((t.locationIds || []).map(String).includes(String(locationId))) return { warehouse: c, tariff: t };
  }
  return null;
}

export function tariffHasRates(t?: WarehouseTariff | null): boolean {
  if (!t) return false;
  return safeN(t.storagePerKgDay) > 0 || safeN(t.storagePerPalletDay) > 0 || safeN(t.handlingInPerKg) > 0 || safeN(t.handlingOutPerKg) > 0 || safeN(t.sortingPerKg) > 0;
}

// ── Storage periods ─────────────────────────────────────────────────────────
// Walk the movements chronologically and produce [{locationId, from, to, kg}]
// stretches of physical stock. The final open stretch runs to `asOf`.
export interface StoragePeriod { locationId: any; from: string; to: string; kg: number; days: number }

export function computeStoragePeriods(lot: any, asOfISO: string): { periods: StoragePeriod[]; firstInDate: string | null; receivedKg: number; shippedKg: number } {
  // v6.30.1: voided movements are excluded here exactly as in
  // recomputeLotFromMovements (v6.18.17) — a voided IN/SHIP_OUT must not accrue
  // kg-days or handling in the expected warehouse invoice.
  const movements = [...(lot?.movements || [])]
    .filter((m: any) => m && !m.voided && m.date && isFinite(dayMs(m.date)))
    .sort((a: any, b: any) => dayMs(a.date) - dayMs(b.date) || (a.id || 0) - (b.id || 0));
  const periods: StoragePeriod[] = [];
  let kg = 0;
  let loc: any = null;
  let cursor: string | null = null;
  let firstInDate: string | null = null;
  let receivedKg = 0, shippedKg = 0;

  const close = (until: string) => {
    if (cursor && kg > 0 && loc !== null && loc !== undefined) {
      const days = Math.max(0, Math.round((dayMs(until) - dayMs(cursor)) / DAY));
      if (days > 0) periods.push({ locationId: loc, from: cursor, to: until, kg, days });
    }
    cursor = until;
  };

  movements.forEach((m: any) => {
    const d = String(m.date).slice(0, 10);
    close(d);
    const q = safeN(m.qtyKg);
    if (m.type === "IN") {
      kg += q; receivedKg += q;
      if (m.toId !== undefined && m.toId !== null) loc = m.toId;
      if (!firstInDate) firstInDate = d;
    } else if (m.type === "TRANSFER") {
      if (m.toId !== undefined && m.toId !== null) loc = m.toId;
    } else if (m.type === "SHIP_OUT") {
      kg = Math.max(0, kg - q); shippedKg += q;
    } else if (m.type === "DAMAGE") {
      kg = Math.max(0, kg - q);
    } else if (m.type === "REVERSAL") {
      kg += q; shippedKg = Math.max(0, shippedKg - q);
    }
    if (loc === null && lot?.locationId !== undefined) loc = lot.locationId;
  });
  close(String(asOfISO).slice(0, 10));
  return { periods, firstInDate, receivedKg: r2(receivedKg), shippedKg: r2(shippedKg) };
}

// Clip a period to a window [from, to) given as ISO dates; returns days inside.
function clipDays(p: StoragePeriod, winFrom?: string, winTo?: string): number {
  const a = Math.max(dayMs(p.from), winFrom ? dayMs(winFrom) : -Infinity);
  const b = Math.min(dayMs(p.to), winTo ? dayMs(winTo) : Infinity);
  return Math.max(0, Math.round((b - a) / DAY));
}

// Chargeable days = days after the free window (freeUntil exclusive).
function chargeableDaysOf(p: StoragePeriod, freeUntil: number | null, winFrom?: string, winTo?: string): number {
  const a0 = Math.max(dayMs(p.from), winFrom ? dayMs(winFrom) : -Infinity);
  const a = freeUntil !== null ? Math.max(a0, freeUntil) : a0;
  const b = Math.min(dayMs(p.to), winTo ? dayMs(winTo) : Infinity);
  return Math.max(0, Math.round((b - a) / DAY));
}

export interface ChargeWindow { from?: string; to?: string } // [from, to) — for monthly clipping

export function computeLotWarehouseCharges(
  lot: any,
  contacts: any[],
  asOfISO: string,
  win?: ChargeWindow
): LotWarehouseCharges | null {
  const { periods, firstInDate } = computeStoragePeriods(lot, asOfISO);
  // Tariff resolves per stored location; in practice a lot sits in one tariffed
  // warehouse. Use the first tariffed location found among periods (or lot.locationId).
  let match = null as any;
  for (const p of periods) { match = warehouseForLocation(contacts, p.locationId); if (match) break; }
  if (!match) match = warehouseForLocation(contacts, lot?.locationId);
  if (!match || !tariffHasRates(match.tariff)) return null;
  const t: WarehouseTariff = match.tariff;
  const currency = t.currency || "PLN";
  const fx = safeN(t.fxToPLN) || 1;
  const freeDays = Math.max(0, Math.round(safeN(t.freeDays)));
  const freeUntil = firstInDate && freeDays > 0 ? dayMs(firstInDate) + freeDays * DAY : null;
  const notes: string[] = [];
  if (freeDays > 0 && firstInDate) notes.push(`Free period: first ${freeDays} day(s) from receipt (${firstInDate}) not charged.`);

  const tariffedPeriods = periods.filter(p => {
    const m = warehouseForLocation(contacts, p.locationId);
    return m && m.warehouse.id === match.warehouse.id;
  });
  const kgDays = r2(tariffedPeriods.reduce((s, p) => s + p.kg * clipDays(p, win?.from, win?.to), 0));
  const chargeableKgDays = r2(tariffedPeriods.reduce((s, p) => s + p.kg * chargeableDaysOf(p, freeUntil, win?.from, win?.to), 0));
  const pallets = safeN(lot?.pallets);
  const palletDays = r2(tariffedPeriods.reduce((s, p) => s + pallets * clipDays(p, win?.from, win?.to), 0));
  const chargeablePalletDays = r2(tariffedPeriods.reduce((s, p) => s + pallets * chargeableDaysOf(p, freeUntil, win?.from, win?.to), 0));

  const lines: ChargeLine[] = [];
  // Storage: pallet basis takes precedence when its rate is set AND the lot has a pallet count.
  let basis: "pallet" | "kg" | "none" = "none";
  if (safeN(t.storagePerPalletDay) > 0 && pallets > 0) {
    basis = "pallet";
    const amount = r2(chargeablePalletDays * safeN(t.storagePerPalletDay));
    if (chargeablePalletDays > 0) lines.push({ kind: "storage", label: `Storage · ${chargeablePalletDays.toLocaleString("pl-PL")} pallet-days @ ${t.storagePerPalletDay}`, qty: chargeablePalletDays, unit: "pallet-day", rate: safeN(t.storagePerPalletDay), amount, amountPLN: r2(amount * fx) });
  } else if (safeN(t.storagePerKgDay) > 0) {
    basis = "kg";
    const amount = r2(chargeableKgDays * safeN(t.storagePerKgDay));
    if (chargeableKgDays > 0) lines.push({ kind: "storage", label: `Storage · ${chargeableKgDays.toLocaleString("pl-PL")} kg-days @ ${t.storagePerKgDay}`, qty: chargeableKgDays, unit: "kg-day", rate: safeN(t.storagePerKgDay), amount, amountPLN: r2(amount * fx) });
  } else if (safeN(t.storagePerPalletDay) > 0 && pallets === 0) {
    notes.push("Tariff is per pallet-day but the lot has no pallet count — storage not estimated. Add pallets to the lot or set a kg/day rate.");
  }

  // Handling in / out — only events INSIDE the window (or all when no window).
  const inWin = (d: string) => {
    const x = dayMs(d);
    return (!win?.from || x >= dayMs(win.from)) && (!win?.to || x < dayMs(win.to));
  };
  if (safeN(t.handlingInPerKg) > 0) {
    const kgIn = (lot?.movements || []).filter((m: any) => m.type === "IN" && !m.voided && inWin(m.date)).reduce((s: number, m: any) => s + safeN(m.qtyKg), 0);
    if (kgIn > 0) { const a = r2(kgIn * safeN(t.handlingInPerKg)); lines.push({ kind: "handling_in", label: `Handling in · ${kgIn.toLocaleString("pl-PL")} kg @ ${t.handlingInPerKg}`, qty: kgIn, unit: "kg", rate: safeN(t.handlingInPerKg), amount: a, amountPLN: r2(a * fx) }); }
  }
  if (safeN(t.handlingOutPerKg) > 0) {
    const kgOut = (lot?.movements || []).filter((m: any) => m.type === "SHIP_OUT" && !m.voided && inWin(m.date)).reduce((s: number, m: any) => s + safeN(m.qtyKg), 0);
    if (kgOut > 0) { const a = r2(kgOut * safeN(t.handlingOutPerKg)); lines.push({ kind: "handling_out", label: `Handling out · ${kgOut.toLocaleString("pl-PL")} kg @ ${t.handlingOutPerKg}`, qty: kgOut, unit: "kg", rate: safeN(t.handlingOutPerKg), amount: a, amountPLN: r2(a * fx) }); }
  }
  // Sorting events logged on the lot.
  if (safeN(t.sortingPerKg) > 0) {
    (lot?.serviceEvents || []).filter((e: any) => e.type === "SORTING" && e.date && inWin(e.date)).forEach((e: any) => {
      const kgS = safeN(e.kg);
      if (kgS <= 0) return;
      const a = r2(kgS * safeN(t.sortingPerKg));
      lines.push({ kind: "sorting", label: `Sorting · ${kgS.toLocaleString("pl-PL")} kg @ ${t.sortingPerKg}`, qty: kgS, unit: "kg", rate: safeN(t.sortingPerKg), amount: a, amountPLN: r2(a * fx), date: e.date, note: e.note });
    });
  }

  const total = r2(lines.reduce((s, l) => s + l.amount, 0));
  return {
    lotNumber: lot?.number || "—",
    warehouseName: match.warehouse.name,
    currency, fxToPLN: fx,
    kgDays, palletDays, chargeableKgDays, chargeablePalletDays, basis,
    lines, total, totalPLN: r2(total * fx), notes,
  };
}

// Monthly window helper: [first day of month, first day of next month)
export function monthWindow(period: string): ChargeWindow {
  const [y, m] = String(period || "").split("-").map(Number);
  if (!y || !m) return {};
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const to = `${ny}-${String(nm).padStart(2, "0")}-01`;
  return { from, to };
}

// All lots' expected charges at one warehouse for one month — the invoice we
// SHOULD receive. asOf is clipped so future days of the current month don't accrue.
export function warehouseMonthCharges(
  lots: any[],
  contacts: any[],
  warehouseId: any,
  period: string,
  todayISO: string
): { rows: LotWarehouseCharges[]; total: number; totalPLN: number; currency: string } {
  const win = monthWindow(period);
  const asOf = win.to && dayMs(win.to) < dayMs(todayISO) ? win.to : todayISO;
  const rows: LotWarehouseCharges[] = [];
  (lots || []).forEach(lot => {
    const r = computeLotWarehouseCharges(lot, contacts, asOf, win);
    if (!r || !r.lines.length) return;
    // keep only rows belonging to the selected warehouse
    const m = (contacts || []).find((c: any) => String(c.id) === String(warehouseId));
    if (!m || r.warehouseName !== m.name) return;
    rows.push(r);
  });
  const total = r2(rows.reduce((s, r) => s + r.total, 0));
  const totalPLN = r2(rows.reduce((s, r) => s + r.totalPLN, 0));
  return { rows, total, totalPLN, currency: rows[0]?.currency || "PLN" };
}

export interface WarehouseInvoice {
  id: number;
  warehouseId: any;
  warehouseName?: string;
  period: string;          // YYYY-MM
  invoiceNo: string;
  date: string;
  amount: number;
  currency: string;
  fxRate: number;
  amountPLN: number;
  status: "Received" | "Approved";
  notes?: string;
  allocatedLots?: { lotNumber: string; amountPLN: number }[];
}
