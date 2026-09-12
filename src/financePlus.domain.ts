// ─────────────────────────────────────────────────────────────────────────────
// financePlus.domain.ts — v6.99.1: FINANCE PART 2 (FN-4 client risk · FN-5 PO result for every PO · FN-6 warehouse agreement)
// Pure. Reads; stores nothing.
// ─────────────────────────────────────────────────────────────────────────────
const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;
const days = (a: string, b: string) => Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);

// ── FN-4: CLIENT RISK ─────────────────────────────────────────────────────────
export interface ClientRisk { client: string; limitPLN: number; exposurePLN: number; usagePct: number | null; overduePLN: number; maxOverdueDays: number; openInvoices: number; lastPaymentDate: string; avgDaysToPay: number | null; openOrdersPLN: number; }
export function clientRisk(clientName: string, invoices: any[], orders: any[], contact: any, todayISO: string): ClientRisk {
  const key = S(clientName).toLowerCase();
  let exposure = 0, overdue = 0, maxOver = 0, open = 0, lastPay = ""; const payDays: number[] = [];
  (invoices || []).forEach(i => {
    if (!i || i.kind !== "SALES" || i.isProforma || ["Cancelled", "Draft"].includes(i.paymentStatus) || S(i.counterparty?.name).toLowerCase() !== key) return;
    const fx = num(i.fxRate) || 1; const openAmt = r2((num(i.grossAmount) - num(i.paidAmount)) * fx);
    (i.payments || []).forEach((p: any) => { if (S(p.date) > lastPay) lastPay = S(p.date); if (S(i.issueDate) && S(p.date)) payDays.push(days(S(i.issueDate), S(p.date))); });
    if (openAmt <= 0.005) return;
    exposure += openAmt; open++;
    if (S(i.dueDate) && S(i.dueDate) < todayISO) { overdue += openAmt; maxOver = Math.max(maxOver, days(S(i.dueDate), todayISO)); }
  });
  const openOrders = (orders || []).filter(o => o && ["Confirmed"].includes(o.status) && S(o.client?.name).toLowerCase() === key)
    .reduce((s, o) => s + (o.items || []).reduce((a: number, it: any) => a + (String(it.pricingUnit || "") === "box" ? num(it.boxes) : num(it.qty)) * num(it.unitPrice), 0) * (num(o.fxRate) || 1), 0);
  const limit = num(contact?.creditLimitPLN);
  return { client: clientName, limitPLN: limit, exposurePLN: r2(exposure), usagePct: limit > 0 ? r2((exposure + openOrders) / limit * 100) : null, overduePLN: r2(overdue), maxOverdueDays: maxOver, openInvoices: open, lastPaymentDate: lastPay, avgDaysToPay: payDays.length ? Math.round(payDays.reduce((s, d) => s + d, 0) / payDays.length) : null, openOrdersPLN: r2(openOrders) };
}
export function clientRiskTable(invoices: any[], orders: any[], contacts: any[], todayISO: string): ClientRisk[] {
  const names = new Set<string>();
  (invoices || []).forEach(i => { if (i?.kind === "SALES" && !["Cancelled", "Draft"].includes(i.paymentStatus) && S(i.counterparty?.name)) names.add(S(i.counterparty.name)); });
  (orders || []).forEach(o => { if (o?.status === "Confirmed" && S(o.client?.name)) names.add(S(o.client.name)); });
  return Array.from(names).map(n => clientRisk(n, invoices, orders, (contacts || []).find(c => S(c.name).toLowerCase() === n.toLowerCase()), todayISO))
    .sort((a, b) => (b.overduePLN - a.overduePLN) || (b.exposurePLN - a.exposurePLN));
}

// ── FN-5: THE RESULT OF EVERY PURCHASE (firm-price mirror of the consignment settlement) ──
export interface PoResult { poNumber: string; lots: number; receivedKg: number; soldKg: number; revenuePLN: number; purchasePLN: number; landedOtherPLN: number; directPLN: number; concessionsPLN: number; recoveriesPLN: number; marginPLN: number; marginPerKg: number | null; fullySold: boolean; }
function sourcesLot(it: any, lot: any): boolean {
  if (it?.sourceType === "STOCK" && String(it.sourceRef) === String(lot.number)) return true;
  if (it?.sourceType === "PO" && lot.poRef && String(it.sourceRef) === String(lot.poRef)) { if (it.sourceLineId != null && lot.poLineId != null) return String(it.sourceLineId) === String(lot.poLineId); return true; }
  return false;
}
export function poResult(po: any, lots: any[], orders: any[], shipments: any[]): PoResult {
  const myLots = (lots || []).filter(l => String(l?.poRef) === String(po?.number));
  const live = (orders || []).filter(o => o && !["Draft", "Cancelled"].includes(o.status));
  let revenue = 0, sold = 0, concessions = 0;
  live.forEach(o => {
    const fx = num(o.fxRate) || 1;
    (o.items || []).forEach((it: any) => {
      if (!myLots.some(l => sourcesLot(it, l))) return;
      const kg = num(it.qty); const price = String(it.pricingUnit || "") === "box" && num(it.kgPerBox) > 0 ? num(it.unitPrice) / num(it.kgPerBox) : num(it.unitPrice);
      sold += kg; revenue += kg * price * fx;
    });
    const soKg = (o.items || []).reduce((s: number, it: any) => s + num(it.qty), 0);
    const truckKg = (o.items || []).filter((it: any) => myLots.some(l => sourcesLot(it, l))).reduce((s: number, it: any) => s + num(it.qty), 0);
    if (truckKg > 0 && soKg > 0) (o.claimAdjustments || []).forEach((a: any) => { if (String(a?.source || "").startsWith("claim:")) concessions += Math.abs(num(a.pln ?? a.amountPLN)) * Math.min(1, truckKg / soKg); });
  });
  let purchase = 0, landedOther = 0, recoveries = 0;
  myLots.forEach(l => (l.costs || []).forEach((c: any) => { const src = String(c.source || ""); const pln = num(c.pln); if (src.startsWith("CONSIGN")) return; if (c.type === "purchase") purchase += pln; else if (src.startsWith("claim:")) recoveries += Math.abs(pln); else landedOther += pln; }));
  let direct = 0;
  (shipments || []).forEach(sh => {
    if (!sh || String(sh.purpose || "").toUpperCase() !== "OUTBOUND" || String(sh.status) === "Cancelled") return;
    const goods = sh.goods || []; const total = goods.reduce((s: number, g: any) => s + num(g.qtyKg), 0); if (!(total > 0)) return;
    const mine = goods.filter((g: any) => myLots.some(l => String(g.lotRef) === String(l.number))).reduce((s: number, g: any) => s + num(g.qtyKg), 0); if (!(mine > 0)) return;
    (sh.costs || []).forEach((c: any) => { direct += num(c.amountPLN) * Math.min(1, mine / total); });
  });
  const received = myLots.reduce((s, l) => s + num(l.receivedKg), 0);
  const waste = myLots.reduce((s, l) => s + num(l?.grades?.waste), 0);
  const margin = r2(revenue - concessions - purchase - landedOther - direct + recoveries);
  return { poNumber: po?.number, lots: myLots.length, receivedKg: Math.round(received), soldKg: Math.round(sold), revenuePLN: r2(revenue), purchasePLN: r2(purchase), landedOtherPLN: r2(landedOther), directPLN: r2(direct), concessionsPLN: r2(concessions), recoveriesPLN: r2(recoveries), marginPLN: margin, marginPerKg: sold > 0 ? r2(margin / sold) : null, fullySold: received > 0 && sold + waste >= received - 1 };
}

// ── FN-6: WAREHOUSE AGREEMENT (owner 6 Sept: annual, all-inclusive, or per unit) ──
export type AgreementType = "per_service" | "kg_day" | "pallet_day" | "fixed_monthly";
export interface WarehouseAgreement { type: AgreementType; rateKgDayPLN?: any; ratePalletDayPLN?: any; fixedMonthlyPLN?: any; includedServices?: string[]; extras?: Array<{ service: string; ratePLN: any; unit: string }>; validFrom?: string; notes?: string; }
export const WAREHOUSE_SERVICES = ["unloading", "loading", "sorting", "repalletising", "labelling", "cold_storage", "handling"];
export function expectedWarehouseMonthly(agreement: WarehouseAgreement | null | undefined, usage: { kgDays: number; palletDays: number; services: Record<string, number> }): { expectedPLN: number; lines: Array<{ label: string; pln: number }> } {
  if (!agreement) return { expectedPLN: 0, lines: [] };
  const lines: Array<{ label: string; pln: number }> = [];
  if (agreement.type === "fixed_monthly") lines.push({ label: "Annual agreement — monthly fee", pln: r2(num(agreement.fixedMonthlyPLN)) });
  if (agreement.type === "kg_day") lines.push({ label: `Storage ${Math.round(usage.kgDays).toLocaleString("pl-PL")} kg-days`, pln: r2(usage.kgDays * num(agreement.rateKgDayPLN)) });
  if (agreement.type === "pallet_day") lines.push({ label: `Storage ${Math.round(usage.palletDays).toLocaleString("pl-PL")} pallet-days`, pln: r2(usage.palletDays * num(agreement.ratePalletDayPLN)) });
  const included = new Set(agreement.includedServices || []);
  (agreement.extras || []).forEach(x => { if (included.has(x.service)) return; const q = num(usage.services?.[x.service]); if (q > 0) lines.push({ label: `${x.service} × ${q}`, pln: r2(q * num(x.ratePLN)) }); });
  return { expectedPLN: r2(lines.reduce((s, l) => s + l.pln, 0)), lines };
}
