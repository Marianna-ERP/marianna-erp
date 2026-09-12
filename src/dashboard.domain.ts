// ─────────────────────────────────────────────────────────────────────────────
// dashboard.domain.ts — v6.99.4: THE DASHBOARD'S QUESTIONS (owner decisions DA-1…DA-8)
// Pure tile queries. Every tile = exceptions / today's events only; "none" when empty.
// ─────────────────────────────────────────────────────────────────────────────
const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
const addDays = (iso: string, d: number) => { const m = S(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return ""; const x = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };

export interface Tile { key: string; title: string; count: number; detail: string; tone: "ok" | "warn" | "bad"; module: string; }
const tile = (key: string, title: string, items: string[], module: string, badWhen = 1, noneText = "none"): Tile => ({ key, title, count: items.length, detail: items.length ? items.slice(0, 4).join(" · ") + (items.length > 4 ? ` +${items.length - 4}` : "") : noneText, tone: items.length >= badWhen ? "bad" : items.length ? "warn" : "ok", module });

// ── DA-2 · TODAY'S MOVEMENTS (operations) ────────────────────────────────────
export function movementTiles(shipments: any[], todayISO: string): Tile[] {
  const live = (shipments || []).filter(s => s && !["Cancelled", "Delivered", "Closed"].includes(String(s.status)));
  const units = live.flatMap(s => (s.legs || []).flatMap((l: any) => (l.vehicles || []).map((u: any) => ({ s, l, u }))));
  const loadingToday = units.filter(x => S(x.u.plannedLoadingDate) === todayISO && !S(x.u.loadedAt)).map(x => `${x.s.number} ${x.u.truckPlate || ""}`.trim());
  const arrivingToday = units.filter(x => (S(x.u.eta) === todayISO || S(x.u.plannedDeliveryDate) === todayISO) && !S(x.u.deliveredAt) && !S(x.u.arrivedAt)).map(x => `${x.s.number}${x.s.arrangedBy === "SUPPLIER" ? " (supplier's truck)" : ""}`);
  const cutoffSoon = live.flatMap(s => (s.bookings || []).filter((b: any) => S(b.cutOff) && b.cutOff >= todayISO && b.cutOff <= addDays(todayISO, 2)).map((b: any) => `${s.number} cut-off ${b.cutOff}`));
  const deliveriesToday = live.filter(s => String(s.purpose || "").toUpperCase() === "OUTBOUND" && (S(s.expectedDeliveryDate) === todayISO || (s.legs || []).some((l: any) => (l.vehicles || []).some((u: any) => S(u.plannedDeliveryDate) === todayISO)))).map(s => s.number);
  return [tile("loading", "LOADING TODAY", loadingToday, "shipments", 99), tile("arriving", "ARRIVING TODAY", arrivingToday, "shipments", 99), tile("cutoff", "CUT-OFF ≤ 2 DAYS", cutoffSoon, "shipments", 1), tile("deliver", "DELIVERIES TODAY", deliveriesToday, "shipments", 99)];
}

// ── DA-3 · OUTSTANDING DOCUMENTS (operations) ────────────────────────────────
export function documentTiles(shipments: any[], orders: any[], invoices: any[], pos: any[]): Tile[] {
  const live = (shipments || []).filter(s => s && !["Cancelled", "Delivered", "Closed", "Draft"].includes(String(s.status)));
  const toNotSent = live.filter(s => (s.legs || []).some((l: any) => (l.vehicles || []).length) && !(s.transportOrders && Object.keys(s.transportOrders).length) && S(s.confirmationStatus) !== "Sent" && s.arrangedBy !== "SUPPLIER").map(s => s.number);
  const protocolsOut = (shipments || []).flatMap(s => (s.loadingProtocols || []).filter((p: any) => p.status === "Sent").map((p: any) => p.number));
  const loadedNoInvoice = (orders || []).filter(o => o && !["Cancelled", "Draft", "Invoiced", "Closed"].includes(o.status) && (shipments || []).some(s => String(s.purpose || "").toUpperCase() === "OUTBOUND" && ["Loaded", "In transit", "Delivered"].includes(String(s.status)) && ((s.soRefs || []).includes(o.number) || (s.goods || []).some((g: any) => g.soRef === o.number))) && !(invoices || []).some(i => i.kind === "SALES" && !i.isProforma && !["Cancelled", "Draft"].includes(i.paymentStatus) && (i.links || []).some((l: any) => l.type === "SO" && String(l.number) === String(o.number)))).map(o => o.number);
  const awaitingPacking = (pos || []).filter(p => p && p.status === "Confirmed" && (p.items || []).some((it: any) => String(it.quantityStatus || "").toUpperCase() === "ESTIMATED")).map(p => p.number);
  return [tile("to", "TRANSPORT ORDERS NOT SENT", toNotSent, "shipments", 1), tile("lp", "PROTOCOLS NOT RETURNED", protocolsOut, "shipments", 3), tile("inv", "LOADED WITHOUT INVOICE", loadedNoInvoice, "orders", 1), tile("pack", "AWAITING PACKING RESULT", awaitingPacking, "pos", 99)];
}

// ── DA-4 · DEADLINES (operations / owner) ────────────────────────────────────
export function deadlineTiles(lots: any[], inspections: any[], contacts: any[], pos: any[], claims: any[], todayISO: string): Tile[] {
  const qcDue: string[] = [];
  (lots || []).forEach(l => {
    if (!l || String(l.status) === "Cancelled" || !(num(l.receivedKg) > 0)) return;
    const po = (pos || []).find(p => String(p.number) === String(l.poRef)); const sup = po ? (contacts || []).find(c => String(c.id) === String(po.supplier?.id)) : null;
    const days = num(sup?.terms?.qualityReportDays) || num(sup?.qualityReportDays); if (!(days > 0)) return;
    const arrival = S(l.arrivalDate) || (l.movements || []).filter((m: any) => m.type === "IN" && !m.voided).map((m: any) => S(m.date)).sort()[0]; if (!arrival) return;
    const due = addDays(arrival, days);
    const done = (inspections || []).some(x => String(x.lotNumber) === String(l.number));
    if (!done && due <= addDays(todayISO, 1)) qcDue.push(`${l.number} due ${due}`);
  });
  const notices = (claims || []).filter(c => c && !["Settled", "Rejected", "Withdrawn", "Closed", "Accepted"].includes(String(c.status)) && S(c.noticeDeadline) && c.noticeDeadline <= addDays(todayISO, 2) && !S(c.notifiedAt)).map(c => `${c.number} by ${c.noticeDeadline}`);
  return [tile("qc", "QC REPORT DUE", qcDue, "lots", 1), tile("notice", "CLAIM NOTICES DUE", notices, "claims", 1)];
}

// ── DA-5 · OWNER CONTROLS ────────────────────────────────────────────────────
export function ownerTiles(closedPeriods: any[], poSettlements: any[], financeNotes: any[], risk: Array<{ client: string; usagePct: number | null; maxOverdueDays: number }>, todayISO: string): Tile[] {
  const prev = (() => { const d = new Date(todayISO.slice(0, 4) + "-" + todayISO.slice(5, 7) + "-01T00:00:00"); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const monthOpen = (closedPeriods || []).some(c => c.period === prev) ? [] : [`${prev} not closed`];
  const runPending = (poSettlements || []).filter(s => s.status === "Closed" && !s.commissionInvoiceId).map(s => s.poNumber);
  const expectedNotes = (financeNotes || []).filter(n => n && n.status === "Expected").map(n => `${n.partyName} ${num(n.amount).toLocaleString("pl-PL")} ${n.currency}`);
  const breaches = (risk || []).filter(r => (r.usagePct != null && r.usagePct > 100) || r.maxOverdueDays > 30).map(r => `${r.client}${r.maxOverdueDays > 30 ? ` ${r.maxOverdueDays}d late` : ""}${r.usagePct != null && r.usagePct > 100 ? ` ${r.usagePct}% of limit` : ""}`);
  return [tile("close", "MONTH TO CLOSE", monthOpen, "finance", 1), tile("run", "COMMISSION RUN PENDING", runPending, "pos", 1), tile("cn", "EXPECTED CREDIT NOTES", expectedNotes, "invoices", 99), tile("risk", "CLIENT RISK BREACHES", breaches, "finance", 1)];
}

// ── DB7 · WAREHOUSE MORNING ──────────────────────────────────────────────────
export function warehouseTiles(lots: any[], shipments: any[], inspections: any[], stockCounts: any[], locationId: any, todayISO: string): Tile[] {
  const mine = (lots || []).filter(l => l && String(l.locationId) === String(locationId));
  const arrivals = (shipments || []).filter(s => s && String(s.purpose || "").toUpperCase() === "INBOUND" && !["Cancelled", "Delivered"].includes(String(s.status)) && (String(s.destinationLocationId) === String(locationId)) && (s.legs || []).some((l: any) => (l.vehicles || []).some((u: any) => S(u.eta) === todayISO || S(u.plannedDeliveryDate) === todayISO))).map(s => `${s.number}${s.supplierRef ? " · " + s.supplierRef : ""}`);
  const toInspect = mine.filter(l => num(l.physicalKg) > 0 && !(inspections || []).some(x => String(x.lotNumber) === String(l.number))).map(l => l.number);
  const countDue = (stockCounts || []).some(c => String(c.locationId) === String(locationId) && S(c.date) === todayISO) ? [] : (mine.some(l => num(l.physicalKg) > 0) ? ["today's count not done"] : []);
  return [tile("arr", "ARRIVALS EXPECTED TODAY", arrivals, "lots", 99), tile("insp", "LOTS AWAITING INSPECTION", toInspect, "lots", 1), tile("count", "STOCK COUNT", countDue, "lots", 1, "done today")];
}

// ── DA-7 · INTEGRITY ─────────────────────────────────────────────────────────
export function integrityTile(issues: any[]): Tile {
  const e = (issues || []).filter(i => i.severity === "error").length, w = (issues || []).filter(i => i.severity === "warning").length, n = (issues || []).filter(i => i.severity === "info").length;
  return { key: "integrity", title: "DATA INTEGRITY", count: e + w, detail: e || w ? `${e} error(s) · ${w} warning(s) · ${n} info` : (n ? `all clear · ${n} info` : "all clear"), tone: e ? "bad" : w ? "warn" : "ok", module: "integrity" };
}

/** DA-1: which tile sets a user sees — from the roles they hold (owner sees everything). */
export function tileSetsFor(user: any | null | undefined): Array<"owner" | "operations" | "warehouse"> {
  if (!user) return ["owner", "operations"];          // model off → today's behaviour (owner + operations)
  if (user.isOwner) return ["owner", "operations", "warehouse"];
  const sets: Array<"owner" | "operations" | "warehouse"> = [];
  const isWarehouse = String(user.role || "").toLowerCase() === "warehouse" || (user.modules?.lots !== false && user.modules?.shipments === false && user.modules?.orders === false);
  if (isWarehouse) return ["warehouse"];
  if (user.finance?.pl) sets.push("owner");
  if (user.modules?.shipments !== false || user.modules?.orders !== false) sets.push("operations");
  return sets.length ? sets : ["operations"];
}
