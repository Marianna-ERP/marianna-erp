// ─────────────────────────────────────────────────────────────────────────────
import { S, r2 } from "./format";
import { rateOf } from "./fx";   // v7.44.0 (AUD3-L2)
import { parseNum } from "./numbers";   // v7.22.2 (FZ-22)
// financePlus.domain.ts — v6.99.1: FINANCE PART 2 (FN-4 client risk · FN-5 PO result for every PO · FN-6 warehouse agreement)
// Pure. Reads; stores nothing.
// ─────────────────────────────────────────────────────────────────────────────
const num = (v: any): number => parseNum(v);   // v7.22.2 (FZ-22): one reader for every number — spaces and a decimal comma read the same everywhere
const days = (a: string, b: string) => Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);

// ── FN-4: CLIENT RISK ─────────────────────────────────────────────────────────
export interface ClientRisk { client: string; limitPLN: number; exposurePLN: number; usagePct: number | null; overduePLN: number; maxOverdueDays: number; openInvoices: number; lastPaymentDate: string; avgDaysToPay: number | null; openOrdersPLN: number; }
export function clientRisk(clientName: string, invoices: any[], orders: any[], contact: any, todayISO: string): ClientRisk {
// v7.27.1 (FZ-24): a client is its company id — an invoice or order linked to it counts by id; one still naming its company in text
// only (not yet linked, A-RV-26 / FZ-17) counts under that text, never matched to a company by name.
const key = S(clientName).toLowerCase(); const cid = contact && contact.id != null ? String(contact.id) : "";
const isMine = (party: any) => cid ? String(party?.id ?? "") === cid : (party?.id == null && S(party?.name).toLowerCase() === key);
  let exposure = 0, overdue = 0, maxOver = 0, open = 0, lastPay = ""; const payDays: number[] = [];
  (invoices || []).forEach(i => {
    if (!i || i.kind !== "SALES" || i.isProforma || ["Cancelled", "Draft"].includes(i.paymentStatus) || !isMine(i.counterparty)) return;
    const fx = rateOf(i); const openAmt = r2((num(i.grossAmount) - num(i.paidAmount)) * fx);
    (i.payments || []).forEach((p: any) => { if (S(p.date) > lastPay) lastPay = S(p.date); if (S(i.issueDate) && S(p.date)) payDays.push(days(S(i.issueDate), S(p.date))); });
    if (openAmt <= 0.005) return;
    exposure += openAmt; open++;
    if (S(i.dueDate) && S(i.dueDate) < todayISO) { overdue += openAmt; maxOver = Math.max(maxOver, days(S(i.dueDate), todayISO)); }
  });
  const openOrders = (orders || []).filter(o => o && ["Confirmed"].includes(o.status) && isMine(o.client))
    .reduce((s, o) => s + (o.items || []).reduce((a: number, it: any) => a + (String(it.pricingUnit || "") === "box" ? num(it.boxes) : num(it.qty)) * num(it.unitPrice), 0) * rateOf(o), 0);
  const limit = num(contact?.terms?.creditLimitPLN);   // v7.28.1 (Batch L): the terms own the credit limit
  return { client: clientName, limitPLN: limit, exposurePLN: r2(exposure), usagePct: limit > 0 ? r2((exposure + openOrders) / limit * 100) : null, overduePLN: r2(overdue), maxOverdueDays: maxOver, openInvoices: open, lastPaymentDate: lastPay, avgDaysToPay: payDays.length ? Math.round(payDays.reduce((s, d) => s + d, 0) / payDays.length) : null, openOrdersPLN: r2(openOrders) };
}
export function clientRiskTable(invoices: any[], orders: any[], contacts: any[], todayISO: string): ClientRisk[] {
  // v7.27.1 (FZ-24): one row per company id; parties still named in text only get a row of their own under that text
  const ids = new Map<string, string>(); const texts = new Set<string>();
  const note = (party: any) => { if (!party) return; if (party.id != null) ids.set(String(party.id), S(party.name)); else if (S(party.name)) texts.add(S(party.name)); };
  (invoices || []).forEach(i => { if (i?.kind === "SALES" && !["Cancelled", "Draft"].includes(i.paymentStatus)) note(i.counterparty); });
  (orders || []).forEach(o => { if (o?.status === "Confirmed") note(o.client); });
  const byId = (id: string) => (contacts || []).find(c => c && String(c.id) === id) || { id, name: ids.get(id) };
  return [...Array.from(ids.keys()).map(id => { const c: any = byId(id); return clientRisk(S(c.name) || ids.get(id) || "", invoices, orders, c, todayISO); }),
  ...Array.from(texts).map(n => clientRisk(n, invoices, orders, null, todayISO))]
    .sort((a, b) => (b.overduePLN - a.overduePLN) || (b.exposurePLN - a.exposurePLN));
}

// ── FN-5: THE RESULT OF EVERY PURCHASE (firm-price mirror of the consignment settlement) ──
export interface PoResult { poNumber: string; lots: number; receivedKg: number; soldKg: number; revenuePLN: number; purchasePLN: number; landedOtherPLN: number; directPLN: number; concessionsPLN: number; recoveriesPLN: number; marginPLN: number; marginPerKg: number | null; fullySold: boolean; }
function sourcesLot(it: any, lot: any): boolean {
  if (it?.sourceType === "STOCK" && String(it.sourceRef) === String(lot.number)) return true;
  
  return false;
}
export function poResult(po: any, lots: any[], orders: any[], shipments: any[]): PoResult {
  const myLots = (lots || []).filter(l => String(l?.poRef) === String(po?.number));
  const live = (orders || []).filter(o => o && !["Draft", "Cancelled"].includes(o.status));
  let revenue = 0, sold = 0, concessions = 0;
  live.forEach(o => {
    const fx = rateOf(o);
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
// v6.99.87 (A-PT-1, owner ruling 1 Oct): the warehouse agreement (FN-6) and its calculator are retired — nothing read them
