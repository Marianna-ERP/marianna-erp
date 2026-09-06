// ─────────────────────────────────────────────────────────────────────────────
// poSettlement.domain.ts — v6.90.0: THE TRUCK'S FINAL RESULT (settlement per PO)
// Owner rulings 6 Sept 2026 (VEGA_PRO_REPORTING_MAPPING.md §1, §4, §5):
//   V1 one PO = one truck → the settlement is FOR THE PO, summing its lots by variety
//   expenses before commission = warehouse service + additional costs (incl. the
//        direct costs of the sales sourced from the truck — G5)
//   recoveries: producer → payout deduction; anyone else → expense reduction (G6)
//   rate per truck: default = the last sales invoice of the truck, editable (bank cost)
//   V5 expected credit note from the producer = provisional − net sales before commission
//   V6 compensation: offset the commission on both invoices, transfer the net due
//   V4 one commission invoice per truck, issued in the Monday run
//   waste = kg counted, never sold; class II same lot as a grade
// Pure. Reads the stores it needs; writes nothing.
// ─────────────────────────────────────────────────────────────────────────────
const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;
const r0 = (v: number) => Math.round(v);

export interface POSettlementRecord {
  id: any; poNumber: string; status: "Open" | "Closed"; number?: string;
  ratePLNperEUR?: any; provisionalInvoiceNo?: string; provisionalEUR?: any; commissionPct?: any;
  closedAt?: string; expectedCreditNoteId?: any; commissionInvoiceId?: any; runId?: any; notes?: string;
}

function lotsOfPO(po: any, lots: any[]): any[] { return (lots || []).filter(l => String(l?.poRef) === String(po?.number)); }
function sourcesLot(it: any, lot: any): boolean {
  if (it?.sourceType === "STOCK" && String(it.sourceRef) === String(lot.number)) return true;
  if (it?.sourceType === "PO" && lot.poRef && String(it.sourceRef) === String(lot.poRef)) {
    if (it.sourceLineId != null && lot.poLineId != null) return String(it.sourceLineId) === String(lot.poLineId);
    return S(it.product).toLowerCase() === S(lot.product).toLowerCase() && (!it.variety || !lot.variety || S(it.variety).toLowerCase() === S(lot.variety).toLowerCase());
  }
  return false;
}

export interface VarietyLine { lotNumber: string; product: string; variety: string; receivedKg: number; classIKg: number; classIIKg: number; wasteKg: number; soldKg: number; soldKgII: number; salesPLN: number; salesPLNII: number; pricePerKgPLN: number; pricePerKgPLNII: number; onStockKg: number; }

export interface POSettlementCalc {
  poNumber: string; lines: VarietyLine[];
  grossPLN: number; creditNotesPLN: number; warehousePLN: number; additionalPLN: number; thirdPartyRecoveriesPLN: number; expensesPLN: number;
  producerRecoveriesPLN: number; netPLN: number;
  ratePLNperEUR: number; netSalesEUR: number; commissionPct: number; commissionEUR: number; netAfterCommissionEUR: number;
  provisionalEUR: number; differenceEUR: number; expectedCreditNoteEUR: number; extraInvoiceEUR: number; transferEUR: number;
  fullySold: boolean; warnings: string[];
}

/** Default rate: the last sales invoice of the truck that carries an EUR rate; else the PO's own rate. */
export function defaultTruckRate(po: any, lots: any[], orders: any[], invoices: any[]): number {
  const soNums = new Set((orders || []).filter(o => (o.items || []).some((it: any) => lotsOfPO(po, lots).some(l => sourcesLot(it, l)))).map(o => String(o.number)));
  const sinvs = (invoices || []).filter(i => i?.kind === "SALES" && i.paymentStatus !== "Cancelled" && (i.links || []).some((l: any) => l.type === "SO" && soNums.has(String(l.number))))
    .sort((a, b) => String(a.issueDate || "").localeCompare(String(b.issueDate || "")));
  const last = sinvs.slice(-1)[0];
  if (last && String(last.currency || "").toUpperCase() === "EUR" && num(last.fxRate) > 0) return num(last.fxRate);
  if (num(po?.fxRate) > 0 && String(po?.currency || "").toUpperCase() === "EUR") return num(po.fxRate);
  return 0;
}

export function computePOSettlement(input: {
  po: any; lots: any[]; orders: any[]; invoices?: any[]; shipments?: any[]; claims?: any[];
  ratePLNperEUR: any; provisionalEUR?: any; commissionPct: any;
}): POSettlementCalc {
  const { po, lots, orders } = input;
  const myLots = lotsOfPO(po, lots);
  const warnings: string[] = [];
  const liveOrders = (orders || []).filter(o => o && o.status !== "Draft" && o.status !== "Cancelled");
  const lines: VarietyLine[] = myLots.map(lot => {
    let soldKg = 0, soldKgII = 0, salesPLN = 0, salesPLNII = 0;
    liveOrders.forEach(o => (o.items || []).forEach((it: any) => {
      if (!sourcesLot(it, lot)) return;
      const kg = num(it.qty); const fx = num(o.fxRate) || 1;
      const price = String(it.pricingUnit || "") === "box" && num(it.kgPerBox) > 0 ? num(it.unitPrice) / num(it.kgPerBox) : num(it.unitPrice);
      const isII = /\bII\b|class ?2|klasa ?2|second/i.test(String(it.quality || it.grade || ""));
      if (isII) { soldKgII += kg; salesPLNII += kg * price * fx; } else { soldKg += kg; salesPLN += kg * price * fx; }
    }));
    const g = lot.grades || {};
    const received = num(lot.receivedKg);
    const wasteKg = num(g.waste);
    const onStock = Math.max(0, r0(received - wasteKg - soldKg - soldKgII));
    return { lotNumber: lot.number, product: lot.product || "", variety: lot.variety || "", receivedKg: r0(received), classIKg: r0(num(g.I)), classIIKg: r0(num(g.II)), wasteKg: r0(wasteKg),
      soldKg: r0(soldKg), soldKgII: r0(soldKgII), salesPLN: r2(salesPLN), salesPLNII: r2(salesPLNII),
      pricePerKgPLN: soldKg > 0 ? r2(salesPLN / soldKg) : 0, pricePerKgPLNII: soldKgII > 0 ? r2(salesPLNII / soldKgII) : 0, onStockKg: onStock };
  });
  const grossPLN = r2(lines.reduce((s, l) => s + l.salesPLN + l.salesPLNII, 0));

  // client credit notes: concession postings on the sourcing SOs, this truck's kg share of each SO
  let creditNotesPLN = 0;
  liveOrders.forEach(o => {
    const adj = (o.claimAdjustments || o.adjustments || []).filter((a: any) => String(a?.source || "").startsWith("claim:"));
    if (!adj.length) return;
    const truckKg = (o.items || []).filter((it: any) => myLots.some(l => sourcesLot(it, l))).reduce((s: number, it: any) => s + num(it.qty), 0);
    const soKg = (o.items || []).reduce((s: number, it: any) => s + num(it.qty), 0);
    if (!(truckKg > 0) || !(soKg > 0)) return;
    adj.forEach((a: any) => { creditNotesPLN += Math.abs(num(a.pln ?? a.amountPLN)) * Math.min(1, truckKg / soKg); });
  });
  creditNotesPLN = r2(creditNotesPLN);

  // expenses: lot costs (warehouse service, allocated freight, customs) — never CONSIGN outputs
  let warehousePLN = 0, additionalPLN = 0, producerRecoveriesPLN = 0, thirdPartyRecoveriesPLN = 0;
  const claimRespondent = (src: string) => { const id = src.slice(6); const c = (input.claims || []).find((x: any) => String(x.number) === id || String(x.id) === id); return S(c?.respondent?.kind); };
  myLots.forEach(lot => (lot.costs || []).forEach((c: any) => {
    const src = String(c.source || "");
    if (src.startsWith("CONSIGN")) return;
    if (c.type === "purchase") return;
    const pln = num(c.pln);
    if (!pln) return;
    if (src.startsWith("claim:")) {
      const kind = claimRespondent(src);
      if (kind === "Supplier") producerRecoveriesPLN += Math.abs(pln); else thirdPartyRecoveriesPLN += Math.abs(pln);   // G6
      return;
    }
    const t = String(c.type || c.label || "").toLowerCase();
    if (/warehouse|storage|handling|sorting|service/.test(t)) warehousePLN += pln; else additionalPLN += pln;
  }));
  // G5: direct costs of the sales sourced from the truck (outbound shipments), by this truck's kg share
  (input.shipments || []).forEach((sh: any) => {
    if (String(sh?.purpose || "").toUpperCase() !== "OUTBOUND" || String(sh?.status) === "Cancelled") return;
    const goods = sh.goods || [];
    const totalKg = goods.reduce((s: number, g: any) => s + num(g.qtyKg), 0);
    if (!(totalKg > 0)) return;
    const truckKg = goods.filter((g: any) => myLots.some(l => String(g.lotRef) === String(l.number) || (g.poRef && String(g.poRef) === String(po.number)))).reduce((s: number, g: any) => s + num(g.qtyKg), 0);
    if (!(truckKg > 0)) return;
    const share = Math.min(1, truckKg / totalKg);
    (sh.costs || []).forEach((c: any) => { additionalPLN += num(c.amountPLN) * share; });
  });
  warehousePLN = r2(warehousePLN); additionalPLN = r2(additionalPLN);
  const expensesPLN = r2(Math.max(0, warehousePLN + additionalPLN - thirdPartyRecoveriesPLN));
  producerRecoveriesPLN = r2(producerRecoveriesPLN); thirdPartyRecoveriesPLN = r2(thirdPartyRecoveriesPLN);

  const netPLN = r2(grossPLN - creditNotesPLN - expensesPLN - producerRecoveriesPLN);
  const rate = num(input.ratePLNperEUR);
  if (!(rate > 0)) warnings.push("No PLN→EUR rate on this settlement — take the last sales invoice's rate and add the bank's EUR purchase cost.");
  const netSalesEUR = rate > 0 ? r2(netPLN / rate) : 0;
  const pct = num(input.commissionPct);
  const commissionEUR = r2(netSalesEUR * pct / 100);
  const netAfterCommissionEUR = r2(netSalesEUR - commissionEUR);
  const provisionalEUR = r2(num(input.provisionalEUR));
  const differenceEUR = r2(netSalesEUR - provisionalEUR);
  const fullySold = lines.every(l => l.onStockKg <= 1);
  if (!fullySold) warnings.push(`Not fully sold: ${lines.filter(l => l.onStockKg > 1).map(l => `${l.variety || l.lotNumber} ${l.onStockKg} kg on stock`).join(", ")} — this is an INTERIM report.`);
  return { poNumber: po.number, lines, grossPLN, creditNotesPLN, warehousePLN, additionalPLN, thirdPartyRecoveriesPLN, expensesPLN, producerRecoveriesPLN, netPLN,
    ratePLNperEUR: rate, netSalesEUR, commissionPct: pct, commissionEUR, netAfterCommissionEUR,
    provisionalEUR, differenceEUR, expectedCreditNoteEUR: provisionalEUR > 0 ? r2(Math.max(0, -differenceEUR)) : 0, extraInvoiceEUR: provisionalEUR > 0 ? r2(Math.max(0, differenceEUR)) : 0,
    transferEUR: r2(netAfterCommissionEUR), fullySold, warnings };
}

/** The SALES REPORT rows in the owner's template: item = variety + class; waste rows carry kg only. */
export function salesReportRows(calc: POSettlementCalc): Array<{ item: string; soldKg: number; unitEUR: number; amountEUR: number }> {
  const rate = calc.ratePLNperEUR || 0;
  const out: any[] = [];
  calc.lines.forEach(l => {
    const name = l.variety || l.product || l.lotNumber;
    out.push({ item: `${name} I.`, soldKg: l.soldKg, unitEUR: rate > 0 && l.soldKg > 0 ? r2(l.pricePerKgPLN / rate) : 0, amountEUR: rate > 0 ? r2(l.salesPLN / rate) : 0 });
    if (l.soldKgII > 0 || l.classIIKg > 0) out.push({ item: `${name} II.`, soldKg: l.soldKgII, unitEUR: rate > 0 && l.soldKgII > 0 ? r2(l.pricePerKgPLNII / rate) : 0, amountEUR: rate > 0 ? r2(l.salesPLNII / rate) : 0 });
    if (l.wasteKg > 0) out.push({ item: `${name} waste`, soldKg: l.wasteKg, unitEUR: 0, amountEUR: 0 });
  });
  return out;
}

/** V5: the producer's expected credit note (incoming CREDIT, status Expected) — or nothing when the difference is not in his favour. */
export function expectedProducerCreditNote(po: any, calc: POSettlementCalc, deps: { nextId: () => any; todayISO: () => string }): any | null {
  if (!(calc.expectedCreditNoteEUR > 0)) return null;
  const fx = calc.ratePLNperEUR || 1;
  return { id: deps.nextId(), noteType: "CREDIT", direction: "incoming", issuedBy: "COUNTERPARTY", status: "Expected",
    partyName: po.supplier?.name || "Producer", partyId: po.supplier?.id ?? null, category: "Consignment adjustment",
    amount: calc.expectedCreditNoteEUR, currency: "EUR", fxRate: fx, amountPLN: r2(calc.expectedCreditNoteEUR * fx),
    reason: `Expected: ${po.number} provisional ${calc.provisionalEUR.toLocaleString("pl-PL")} EUR → net sales ${calc.netSalesEUR.toLocaleString("pl-PL")} EUR before commission`,
    date: deps.todayISO(), relatedRef: po.number, expected: true };
}

/** V4/V6: one commission invoice per truck, drafted by the run; the offset (compensation) is proposed, never posted silently. */
export function commissionInvoiceDraft(po: any, calc: POSettlementCalc, settlement: POSettlementRecord, deps: { nextId: () => any; todayISO: () => string }): any {
  const fx = calc.ratePLNperEUR || 1;
  return { id: deps.nextId(), kind: "SALES", category: "COMMISSION", number: "", isProforma: false,
    counterparty: { id: po.supplier?.id ?? null, name: po.supplier?.name || "Producer", nip: po.supplier?.nip || "", address: po.supplier?.address || "" },
    issueDate: deps.todayISO(), saleDate: deps.todayISO(), dueDate: deps.todayISO(), currency: "EUR", fxRate: fx,
    netAmount: calc.commissionEUR, vatRate: 0, grossAmount: calc.commissionEUR, netPLN: r2(calc.commissionEUR * fx), grossPLN: r2(calc.commissionEUR * fx),
    paymentStatus: "Draft", paidAmount: 0, payments: [],
    positions: [{ name: `Commission ${calc.commissionPct}% — ${po.number}${settlement.number ? " · " + settlement.number : ""} — net sales ${calc.netSalesEUR.toLocaleString("pl-PL")} EUR`, quantity: 1, unit: "service", vatRate: 0, grossTotal: calc.commissionEUR }],
    links: [{ type: "PO", number: po.number }, ...(settlement.number ? [{ type: "SET", number: settlement.number }] : [])],
    source: `Commission run — ${po.number}`, notes: `Compensation proposal: offset ${calc.commissionEUR.toLocaleString("pl-PL")} EUR against the producer's invoice; transfer ${calc.transferEUR.toLocaleString("pl-PL")} EUR.` };
}

/** The Monday run: every CLOSED settlement without a commission invoice gets one (per truck). */
export function commissionRun(settlements: POSettlementRecord[], pos: any[], calcFor: (po: any, s: POSettlementRecord) => POSettlementCalc, deps: { nextId: () => any; todayISO: () => string }): { invoices: any[]; settlements: POSettlementRecord[]; runId: any } {
  const runId = deps.nextId();
  const invoices: any[] = [];
  const next = (settlements || []).map(s => {
    if (s.status !== "Closed" || s.commissionInvoiceId) return s;
    const po = (pos || []).find(p => String(p.number) === String(s.poNumber)); if (!po) return s;
    const calc = calcFor(po, s);
    if (!(calc.commissionEUR > 0)) return s;
    const inv = commissionInvoiceDraft(po, calc, s, deps);
    invoices.push(inv);
    return { ...s, commissionInvoiceId: inv.id, runId };
  });
  return { invoices, settlements: next, runId };
}

export function nextSettlementNumberPO(settlements: POSettlementRecord[], year: number): string {
  const n = (settlements || []).map(s => String(s.number || "")).filter(x => x.startsWith(`SET-${year}-`)).map(x => parseInt(x.slice(-4), 10) || 0).reduce((a, b) => Math.max(a, b), 0);
  return `SET-${year}-${String(n + 1).padStart(4, "0")}`;
}
