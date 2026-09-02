import { parseNum } from "./numbers";
// ─────────────────────────────────────────────────────────────────────────────
// claim.domain.ts — the Producer Claim document (Batch 6a, BP-55b / BP-33 / BP-37)
//
// Mirrors the business's Claim Request Form: quantify the total cost of the
// damaged consignment at the client's warehouse (multi-currency: PLN via the
// NBP rate, EGP via the EGP/EUR rate, EUR as-is), apply the defect percentage,
// subtract what was recovered by selling the defected product in the market,
// and request the balance from the producer as a credit note.
//
// Ownership (frozen map): the claim EVENT lives on the Inventory lot; the
// requested CREDIT NOTE is a FinanceNote (direction "incoming" — it reduces
// what we owe the producer, which the Batch-5b ledger flip already counts).
// All money maths per-line-rounded to 2dp, exactly like the paper form.
// ─────────────────────────────────────────────────────────────────────────────

// v6.32.0 (R7b-4): comma-aware canonical parser — "1,5" now parses as 1.5.
const n = parseNum;
function r2(v: number): number { return Math.round(v * 100) / 100; }

export type ClaimCurrency = "PLN" | "EUR" | "EGP";

export interface ClaimCostLine {
  id?: any;
  label: string;          // e.g. "Product — Golden 65-70-80"
  party?: string;         // e.g. supplier / carrier name
  invoiceNo?: string;     // e.g. "351/12/2025"
  amount: any;            // in `currency`
  currency: ClaimCurrency;
  rate?: any;             // PLN: PLN-per-EUR (NBP) · EGP: EGP-per-EUR · EUR: ignored
}

export interface ClaimRates { plnPerEur?: any; egpPerEur?: any; }

/** One line's EUR value: own rate first, claim-level fallback second. */
export function lineEUR(line: ClaimCostLine, rates: ClaimRates = {}): number {
  const amt = n(line.amount);
  if (!amt) return 0;
  if (line.currency === "EUR") return r2(amt);
  if (line.currency === "PLN") {
    const rate = n(line.rate) || n(rates.plnPerEur);
    return rate > 0 ? r2(amt / rate) : 0;
  }
  // EGP
  const rate = n(line.rate) || n(rates.egpPerEur);
  return rate > 0 ? r2(amt / rate) : 0;
}

export interface ClaimComputation {
  lines: Array<ClaimCostLine & { eur: number }>;
  totalCostEUR: number;     // total cost of consignment at client's warehouse
  defectValueEUR: number;   // defectPct × totalCost
  recoveredEUR: number;     // market recovery for the defected product
  creditNoteEUR: number;    // requested from the producer
}

export function computeClaim(input: {
  costLines: ClaimCostLine[];
  defectPct: any;                    // e.g. 42
  soldInMarket?: boolean;
  recoveredAmount?: any;             // in recoveredCurrency (default EGP)
  recoveredCurrency?: ClaimCurrency;
  recoveredRate?: any;               // per-EUR rate for that currency
  rates?: ClaimRates;
}): ClaimComputation {
  const rates = input.rates || {};
  const lines = (input.costLines || []).map(l => ({ ...l, eur: lineEUR(l, rates) }));
  const totalCostEUR = r2(lines.reduce((s, l) => s + l.eur, 0));
  const pct = Math.max(0, Math.min(100, n(input.defectPct)));
  const defectValueEUR = r2(totalCostEUR * pct / 100);
  let recoveredEUR = 0;
  if (input.soldInMarket !== false && n(input.recoveredAmount) > 0) {
    recoveredEUR = lineEUR({
      label: "recovered", amount: input.recoveredAmount,
      currency: input.recoveredCurrency || "EGP", rate: input.recoveredRate,
    }, rates);
  }
  const creditNoteEUR = r2(Math.max(0, defectValueEUR - recoveredEUR));
  return { lines, totalCostEUR, defectValueEUR, recoveredEUR, creditNoteEUR };
}

// v6.79.0 (W-2): nextClaimNumber and buildClaimNote were REMOVED from this file.
// They were a second numbering scheme (scanning lot.claims[]) and a second note
// builder beside claims.domain's — two generators for one number series. This
// module now holds the defect MATHS only (lineEUR / computeClaim), which the
// Claims module's cost lines still use.
