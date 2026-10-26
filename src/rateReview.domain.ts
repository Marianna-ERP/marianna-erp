// rateReview.domain.ts — v7.33.2 (FX-1, owner 26 Oct): THE RATES TO REVIEW. A foreign-currency cost line, transport-unit price or operational
// cost whose rate is missing (1 or none) or is not the NBP rate of its own date — the table of the last working day before it — is listed,
// unless the team kept its rate as agreed. "Set the NBP rate" writes that rate (and the PLN amount where the record keeps one).
import { parseNum } from "./numbers";
const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => parseNum(v);   // FZ-22: the one number reader
const ISO = /^\d{4}-\d{2}-\d{2}/;
export interface RateItem { key: string; kind: "cost line" | "unit price" | "operational cost"; ref: string; currency: string; date: string; rate: number; nbp: number | null; }
/** The records to review; rateFor(currency, date) reads the NBP tables (null while a table is not read). */
export function ratesToReview(data: { shipments?: any[]; operationalCosts?: any[] }, rateFor: (c: string, d: string) => number | null): RateItem[] {
  const out: RateItem[] = [];
  const push = (key: string, kind: RateItem["kind"], ref: string, cur: any, date: any, rate: any, agreed: any) => {
    const c = S(cur).toUpperCase(); if (!c || c === "PLN" || agreed) return; const d = S(date).slice(0, 10); if (!ISO.test(d)) return;
    const r = num(rate); const nbp = rateFor(c, d);
    if (!(r > 1) || (nbp != null && Math.abs(r - nbp) > 0.00005)) out.push({ key, kind, ref, currency: c, date: d, rate: r, nbp });
  };
  (data.shipments || []).forEach((sh: any) => {
    if (!sh || S(sh.status) === "Cancelled") return;
    const loadDay = S(((sh.legs || [])[0]?.vehicles || [])[0]?.loadedAt || ((sh.legs || [])[0]?.vehicles || [])[0]?.plannedLoadingDate);
    (sh.costs || []).forEach((c: any) => { if (num(c?.amount) > 0) push(`sh:${sh.id}:cost:${c.id}`, "cost line", `${S(sh.number)} · ${S(c.type) || "cost"}`, c.currency, S(c.date) || loadDay, c.fxRate, c.fxAgreed); });
    (sh.legs || []).forEach((l: any, li: number) => (l?.vehicles || []).forEach((u: any, ui: number) => {
      if (num(u?.costAmount) > 0) push(`sh:${sh.id}:unit:${li}:${ui}`, "unit price", `${S(sh.number)} · ${S(u.truckPlate) || `unit ${ui + 1}`}`, u.priceCurrency || l.costCurrency, S(u.loadedAt || u.plannedLoadingDate) || loadDay, u.costFxRate ?? l.costFxRate, u.fxAgreed);
    }));
  });
  (data.operationalCosts || []).forEach((c: any) => { if (c && num(c.amount) > 0) push(`op:${c.id}`, "operational cost", `${S(c.supplierName) || S(c.description)} · ${S(c.invoiceNo)}`.replace(/ · $/, ""), c.currency, c.date, c.fxRate, c.fxAgreed); });
  return out;
}
/** Write the NBP rate (or mark the rate agreed) on the listed records; untouched records stay the same objects. */
export function applyRates(data: { shipments?: any[]; operationalCosts?: any[] }, items: RateItem[], mode: "nbp" | "agreed"): { shipments: any[]; operationalCosts: any[] } {
  const by = new Map(items.map(i => [i.key, i]));
  const fix = (rec: any, key: string, rateField: string, plnFrom?: string) => { const it = by.get(key); if (!it) return rec;
    if (mode === "agreed") return { ...rec, fxAgreed: true };
    if (it.nbp == null) return rec; const n: any = { ...rec, [rateField]: it.nbp };
    if (plnFrom && "amountPLN" in rec) n.amountPLN = Math.round(num(rec[plnFrom]) * it.nbp * 100) / 100; return n; };
  const shipments = (data.shipments || []).map((sh: any) => {
    if (!sh) return sh; const keys = Array.from(by.keys()).filter(k => k.startsWith(`sh:${sh.id}:`)); if (!keys.length) return sh;
    return { ...sh, costs: (sh.costs || []).map((c: any) => fix(c, `sh:${sh.id}:cost:${c.id}`, "fxRate", "amount")),
      legs: (sh.legs || []).map((l: any, li: number) => ({ ...l, vehicles: (l.vehicles || []).map((u: any, ui: number) => fix(u, `sh:${sh.id}:unit:${li}:${ui}`, "costFxRate")) })) };
  });
  const operationalCosts = (data.operationalCosts || []).map((c: any) => c ? fix(c, `op:${c.id}`, "fxRate", "amount") : c);
  return { shipments, operationalCosts };
}
