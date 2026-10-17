import { parseNum } from "./numbers";

// ─── v6.6: CONSIGNMENT (COMMISSION) SETTLEMENT ENGINE ───────────────────────
// Producer ships goods on consignment; we sell at our prices, deduct all
// attributable expenses, and settle per lot/truck:
//
//   gross sales      = kg sold × our SO prices (converted to PLN)
//   net sales value  = gross − expenses               → producer's invoice to us
//   our commission   = season % × net sales value     → our invoice to producer
//   producer payout  = net − commission
//
// Closing a settlement writes TWO cost components onto the lot (+producer
// invoice, −commission credit) so the existing margin engine lands each
// consignment SO's P/L at exactly the commission.

export interface CommissionBand { fromPLN: any; toPLN?: any; pct: any }
/** v6.81.0 (D-57, owner ruling): tiers are decided PER TRUCK — the settlement's own
 *  gross sales pick the band. A rate without bands is flat (today's behaviour). */
export interface CommissionRate { id?: number; season: string; validFrom: string; pct: number; bands?: CommissionBand[] }

export function commissionPctForSales(rate: CommissionRate | null | undefined, grossPLN: number): number | null {
  if (!rate) return null;
  const bands = (rate.bands || []).filter(b => b && isFinite(parseFloat(String(b.pct))));
  if (!bands.length) return n(rate.pct);
  const hit = bands
    .slice().sort((a, b) => n(a.fromPLN) - n(b.fromPLN))
    .filter(b => grossPLN >= n(b.fromPLN) && (b.toPLN === undefined || b.toPLN === null || String(b.toPLN) === "" || grossPLN < n(b.toPLN)))
    .pop();
  return hit ? n(hit.pct) : n(rate.pct);
}

export interface SettlementSalesLine {
  soNumber: string; client: string; product: string;
  kg: number; unitPrice: number; currency: string; fxRate: number; pln: number;
}
export interface SettlementExpenseLine { label: string; pln: number; source?: string; manual?: boolean; id?: number }

export interface LotSettlementCalc {
  grossPLN: number;
  salesLines: SettlementSalesLine[];
  expenseLines: SettlementExpenseLine[];
  expensesPLN: number;
  netPLN: number;
  commissionPct: number;
  commissionPLN: number;
  payoutPLN: number;
  soldKg: number;
  warnings: string[];
}

function n(v: any): number { return parseNum(v); }
/** The season rate RECORD (with bands) valid on a date — for per-truck banding. */
export function currentCommissionRate(producer: any, dateISO: string): CommissionRate | null {
  const rates: CommissionRate[] = (producer?.commissionRates || []).filter((r: any) => r && isFinite(parseNum(r.pct as any)) && String(r.pct ?? "").trim() !== "");
  if (!rates.length) return null;
  const applicable = rates.filter(r => !r.validFrom || String(r.validFrom) <= String(dateISO)).sort((a, b) => String(a.validFrom || "").localeCompare(String(b.validFrom || "")));
  return applicable[applicable.length - 1] || rates[0];
}

// Does an SO line source from this lot (directly, or via the lot's PO)?
export function lineSourcesLot(item: any, lot: any): boolean {
  if (!item || !lot) return false;
  if (item.sourceType === "STOCK" && String(item.sourceRef) === String(lot.number)) return true;
  
  return false;
}
