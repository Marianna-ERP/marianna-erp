// ── THE PRODUCER COST CHAIN (v6.70.0) ───────────────────────────────────────
// Owner's scenario, stated Aug 2026:
//
//   "We can issue a claim to the producer for defected product that normally is
//    issued to us by the client upon the arrival of cargo to destination while
//    being transported in optimal conditions. This type of claim would include
//    the costs sustained to move the cargo from origin to destination INCLUDING
//    the custom clearance by us and by the client and the transport by us and by
//    the client from port to warehouse EVEN IF the sale is CIF and our purchase
//    is EXW."
//
// That last clause is the whole problem. Buying EXW and selling CIF means the
// producer's paperwork shows a price at his gate and nothing else. Everything
// between his gate and the client's warehouse was spent by us or by the client,
// and when the fruit turns out to be defective — with the temperature record
// proving the transport was sound — that whole spend is what the claim is for.
//
// Until now the recovery claim opened with an EMPTY cost table, so every line
// was retyped from memory. This module fills it, and it distinguishes two kinds
// of money, because they come from opposite places:
//
//   OURS      — already in the system. The lot carries its landed cost:
//               purchase, freight, customs, warehouse. Derived, never typed.
//
//   THEIRS    — the client's own clearance and his haulage from port to his
//               warehouse. These were never on our books; they reach us inside
//               the client's claim against us. Nothing can derive them, so they
//               are entered once and marked as pass-through — visibly, so the
//               producer can see what he is being asked to cover and why.
//
// Design: PURE and SUGGESTING. It proposes lines with real amounts; the user
// ticks what belongs in this claim. It never writes to a claim by itself —
// exaggerating a claim is worse than under-claiming, and the person signing it
// has to own every line.

import { parseNum } from "./numbers";

const n = parseNum;
const r2 = (v: number) => Math.round(v * 100) / 100;

export type CostOrigin = "OURS" | "CLIENT";

export interface ChainCostLine {
  /** stable key so re-deriving never duplicates a line the user already has */
  key: string;
  label: string;
  origin: CostOrigin;
  amountPLN: number;
  /** which lot the money sits on — blank for a pass-through line */
  lotRef?: string;
  /** true when this line is only a proposal the user has not accepted yet */
  suggested: boolean;
  note?: string;
}

/** Cost types that belong in a defect claim against the producer.
 *  A claim asks the producer to cover getting his fruit to the client. It does
 *  NOT ask him to cover our commission, our overhead, or another claim's
 *  postings — those are ours whatever the fruit was like. */
const CLAIMABLE = new Set([
  "purchase", "freight", "road_freight", "sea_freight", "air_freight", "rail_freight",
  "customs", "clearance", "warehouse", "storage", "handling", "insurance", "inspection",
]);
const NEVER_CLAIMABLE_SOURCE = ["CONSIGN", "CLAIM"];

function claimable(c: any): boolean {
  const src = String(c?.source || "").toUpperCase();
  if (NEVER_CLAIMABLE_SOURCE.some(p => src.startsWith(p))) return false;
  const t = String(c?.type || "").toLowerCase().replace(/\s+/g, "_");
  if (CLAIMABLE.has(t)) return true;
  // Allocated shipment lines carry a human label rather than a code type.
  return /freight|customs|clearance|warehouse|storage|handling|transport/i.test(String(c?.type || c?.label || ""));
}

/** OUR side of the chain, derived from the lots the claim is about.
 *  `affectedShare` scales every line to the portion actually claimed: a 42%
 *  defect on a lot claims 42% of what it cost to bring that lot in — claiming
 *  the whole landed cost for a partial defect is the fastest way to have the
 *  entire claim dismissed. */
export function ourChainCosts(lots: any[], lotRefs: string[], affectedShare = 1): ChainCostLine[] {
  const wanted = new Set((lotRefs || []).map(String));
  const share = Math.max(0, Math.min(1, n(affectedShare) || 1));
  const out: ChainCostLine[] = [];
  (lots || []).forEach(lot => {
    if (!wanted.has(String(lot?.number))) return;
    (lot.costs || []).forEach((c: any, i: number) => {
      if (!claimable(c)) return;
      const pln = r2(n(c.pln ?? c.amountPLN ?? c.amount) * share);
      if (pln <= 0) return;
      out.push({
        key: `lot:${lot.number}:${c.source || c.type || i}`,
        label: `${c.label || c.type || "Cost"} — ${lot.number}`,
        origin: "OURS",
        amountPLN: pln,
        lotRef: String(lot.number),
        suggested: true,
        note: share < 1 ? `${Math.round(share * 100)}% of the lot's landed cost (the affected share)` : undefined,
      });
    });
  });
  return out;
}

/** The costs the CLIENT incurred and charged into his claim against us.
 *  Nothing derives these — they arrive as figures in his claim. They are listed
 *  separately so the producer sees they are not ours, and so nobody later
 *  mistakes them for something the system computed. */
export interface PassThroughInput { label: string; amountPLN: any; note?: string; }

export function clientPassThroughCosts(lines: PassThroughInput[]): ChainCostLine[] {
  return (lines || [])
    .map((l, i) => ({
      key: `client:${i}:${String(l.label || "").slice(0, 24)}`,
      label: String(l.label || "Client cost"),
      origin: "CLIENT" as CostOrigin,
      amountPLN: r2(n(l.amountPLN)),
      suggested: false,
      note: l.note || "Incurred by the client and charged to us in their claim — not on our books",
    }))
    .filter(l => l.amountPLN > 0);
}

/** The standard things a client charges in this flow, offered as empty prompts
 *  so they are not forgotten. Amounts stay zero until someone types them. */
export const CLIENT_COST_PROMPTS: string[] = [
  "Client's import customs clearance",
  "Client's transport, port to their warehouse",
  "Client's unloading / handling",
  "Client's inspection or survey fee",
];

export interface ChainTotals {
  oursPLN: number;
  clientPLN: number;
  totalPLN: number;
  totalEUR: number;
  lines: ChainCostLine[];
  /** lots named by the claim that carry no claimable cost at all */
  lotsWithoutCosts: string[];
}

/** The chain, assembled. plnPerEur converts to the claim's own currency, which
 *  is EUR throughout the claim document. */
export function buildCostChain(input: {
  lots: any[];
  lotRefs: string[];
  affectedShare?: number;
  clientLines?: PassThroughInput[];
  plnPerEur?: any;
}): ChainTotals {
  const ours = ourChainCosts(input.lots, input.lotRefs, input.affectedShare ?? 1);
  const theirs = clientPassThroughCosts(input.clientLines || []);
  const lines = [...ours, ...theirs];
  const oursPLN = r2(ours.reduce((s, l) => s + l.amountPLN, 0));
  const clientPLN = r2(theirs.reduce((s, l) => s + l.amountPLN, 0));
  const totalPLN = r2(oursPLN + clientPLN);
  const rate = n(input.plnPerEur);
  const covered = new Set(ours.map(l => l.lotRef));
  const lotsWithoutCosts = (input.lotRefs || []).map(String).filter(r => !covered.has(r));
  return {
    oursPLN, clientPLN, totalPLN,
    totalEUR: rate > 0 ? r2(totalPLN / rate) : 0,
    lines,
    lotsWithoutCosts,
  };
}

/** Convert accepted chain lines into the claim's own cost-line shape
 *  (claim.domain's ClaimCostLine), so the existing claim maths and the printed
 *  document need no changes at all. */
export function toClaimCostLines(lines: ChainCostLine[], plnPerEur: any): any[] {
  const rate = n(plnPerEur);
  return (lines || []).map(l => ({
    label: l.origin === "CLIENT" ? `${l.label} (client's cost)` : l.label,
    party: l.origin === "CLIENT" ? "Client" : "",
    amount: l.amountPLN,
    currency: "PLN",
    rate: rate > 0 ? rate : undefined,
  }));
}

/** Merge derived lines into whatever the claim already carries, WITHOUT
 *  duplicating: a line whose key is already present is left alone, so
 *  re-deriving after adding a cost is safe and never doubles a figure.
 *  (The same replace-by-key discipline the shipment cost allocation uses.) */
export function mergeChainLines(existing: ChainCostLine[], derived: ChainCostLine[]): ChainCostLine[] {
  const have = new Set((existing || []).map(l => String(l.key)));
  return [...(existing || []), ...(derived || []).filter(l => !have.has(String(l.key)))];
}

/** What is missing before this chain is a fair statement of the loss.
 *  Reported, never blocking — the person signing decides. */
export function chainGaps(t: ChainTotals, clientLines: PassThroughInput[] = []): string[] {
  const gaps: string[] = [];
  if (!t.lines.length) gaps.push("no costs in the chain yet — the claim would ask only for the goods' value");
  t.lotsWithoutCosts.forEach(r => gaps.push(`${r} carries no allocated cost — its freight and customs may not have been allocated yet`));
  if (!clientLines.some(l => n(l.amountPLN) > 0)) {
    gaps.push("no client-side costs entered — his clearance and haulage to his warehouse are usually the largest part he charges us");
  }
  return gaps;
}
