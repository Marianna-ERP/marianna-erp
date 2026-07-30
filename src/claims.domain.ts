// ─── v6.48.0  CLAIMS — a first-class document ────────────────────────────────
// Claims used to be two unrelated things: a "producer claim" nested inside
// lot.claims[] (numbered, with the full cost-and-defect maths) and a "client
// claim" that was only a CLAIM movement plus a credit note — unnumbered, with no
// status and no document. Neither could name a carrier, a forwarder or a
// shipping line, and because a claim lived inside one lot it could not cover the
// several lots a single reefer failure damages.
//
// Phase 1 (this file) RE-HOMES the document into its own store without changing
// how anything behaves. The maths engine (claim.domain.ts) is untouched — it
// mirrors the paper Claim Request Form and is the best part of the old design.
//
// It also fixes two defects found while tracing the old code:
//   D1  A lot could only ever hold ONE claim. The save path kept "other" claims
//       with `filter(c => c.id && claim.id ? ... : false)`, and for a NEW claim
//       claim.id is undefined — so every existing claim was silently dropped.
//   D2  Claim numbers were derived from the render snapshot of `lots`, so two
//       claims issued without an intervening re-render could take the same one.
//       Numbering now reads the claims store and is computed at write time.
//
// The record carries the fields Phase 2 needs (respondent kind, direction,
// many-to-many subjects, parent/child chain, lifecycle, notice deadlines,
// evidence) so that adding transport and temperature claims later is wiring, not
// another migration.

export type ClaimDirection = "RECOVERY" | "CONCESSION";
// RECOVERY  — we claim FROM a counterparty (reduces our cost)
// CONCESSION — a client claims from US (reduces our revenue)

export type RespondentKind = "Supplier" | "Carrier" | "Forwarder" | "ShippingLine" | "Warehouse" | "Client";

/**
 * How the claim's value is arrived at.
 *  DEFECT — the paper Claim Request Form: consignment cost x defect % less what
 *           was recovered in the market. Right for quality claims.
 *  COSTS  — money the counterparty cost us with no cargo damaged at all: a truck
 *           sent to the wrong terminal, demurrage, storage, re-delivery.
 *  MIXED  — both at once, which is the normal shape of a transport claim: cargo
 *           lost in the collapsed pallets PLUS the cost of re-palletising before
 *           the container could load.
 */
export type ClaimBasis = "DEFECT" | "COSTS" | "MIXED";
export const CLAIM_BASES: ClaimBasis[] = ["DEFECT", "COSTS", "MIXED"];

export type ClaimCause =
  | "Quality defect" | "Transport damage" | "Temperature deviation"
  | "Shortage" | "Delay/demurrage" | "Wrong delivery";

export type ClaimStatus =
  | "Draft" | "Notified" | "Submitted" | "Under review"
  | "Accepted" | "Partially accepted" | "Rejected" | "Settled" | "Closed";

export const CLAIM_DIRECTIONS: ClaimDirection[] = ["RECOVERY", "CONCESSION"];
export const RESPONDENT_KINDS: RespondentKind[] = ["Supplier", "Carrier", "Forwarder", "ShippingLine", "Warehouse", "Client"];
export const CLAIM_CAUSES: ClaimCause[] = ["Quality defect", "Transport damage", "Temperature deviation", "Shortage", "Delay/demurrage", "Wrong delivery"];
export const CLAIM_STATUSES: ClaimStatus[] = ["Draft", "Notified", "Submitted", "Under review", "Accepted", "Partially accepted", "Rejected", "Settled", "Closed"];

/** Statuses at which a claim no longer awaits an answer. */
const TERMINAL = new Set<string>(["Rejected", "Settled", "Closed"]);
export function isClaimOpen(c: any): boolean { return !TERMINAL.has(String(c?.status || "Draft")); }

/** What a claim is about — many-to-many, so one reefer failure can name several lots. */
export interface ClaimSubject {
  kind: "LOT" | "SO" | "PO" | "SHIPMENT" | "LEG";
  ref: string;
  affectedKg?: number;
}

export interface ClaimEvidence {
  kind: string;   // "Survey report" | "Temperature log" | "CMR" | "Loading protocol" | "Photos" | …
  ref: string;
  link: string;   // Dropbox share link (see docLinks.domain)
}

export interface Claim {
  id: any;
  number: string;                 // CLM-YYYY-NNNN — house convention, EVERY claim
  direction: ClaimDirection;
  respondent: { kind: RespondentKind; contactId: any; name: string };
  cause: ClaimCause;
  subjects: ClaimSubject[];
  parentClaimId: any;             // a RECOVERY triggered by a CONCESSION
  date: string;
  notifiedAt: string;
  noticeDeadline: string;
  /** cost lines + defect maths — shapes owned by claim.domain.ts */
  costLines: any[];
  /** v6.49.0: how this claim is built (see ClaimBasis). */
  basis: ClaimBasis;
  /** COSTS/MIXED side — cargo actually lost, and the costs the party caused us. */
  lostKg: any;
  lostValueEUR: any;
  causedCosts: { label: string; amountEUR: any }[];
  defectType: string;
  defectPct: any;
  soldInMarket: boolean | null;
  recoveredEGP: any;
  egpPerEur: any;
  plnPerEur: any;
  totalCostEUR: any;
  defectValueEUR: any;
  recoveredEUR: any;
  requestedEUR: any;              // what we asked for
  acceptedEUR: any;               // what was agreed after negotiation — the number that moves the P/L
  status: ClaimStatus;
  resolvedAt: string;
  evidence: ClaimEvidence[];
  financeNoteId: any;             // the credit note it produced
  movementRef: any;              // the CLAIM movement that carries claimedKg
  notes: string;
  migratedFrom?: string;          // provenance when lifted out of the old structures
}

const num = (v: any) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const str = (v: any) => String(v ?? "").trim();

/** Next claim number from the CLAIMS store (not from lots — that was defect D2). */
export function nextClaimNumber(claims: any[], year: number): string {
  const prefix = `CLM-${year}-`;
  let max = 0;
  (claims || []).forEach((c: any) => {
    const n = str(c?.number);
    if (!n.startsWith(prefix)) return;
    const v = parseInt(n.slice(prefix.length), 10);
    if (!isNaN(v) && v > max) max = v;
  });
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export function blankClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: null, number: "", direction: "RECOVERY",
    respondent: { kind: "Supplier", contactId: null, name: "" },
    cause: "Quality defect", subjects: [], parentClaimId: null,
    date: "", notifiedAt: "", noticeDeadline: "",
    costLines: [], basis: "DEFECT", lostKg: "", lostValueEUR: "", causedCosts: [],
    defectType: "", defectPct: "", soldInMarket: null,
    recoveredEGP: "", egpPerEur: "", plnPerEur: "",
    totalCostEUR: 0, defectValueEUR: 0, recoveredEUR: 0,
    requestedEUR: 0, acceptedEUR: null,
    status: "Draft", resolvedAt: "", evidence: [],
    financeNoteId: null, movementRef: null, notes: "",
    ...overrides,
  } as Claim;
}

/** What the claim asks for, derived from its basis. */
export function requestedFromBasis(c: any): number {
  const basis = str(c?.basis) || "DEFECT";
  const causedEUR = (c?.causedCosts || []).reduce((a: number, x: any) => a + num(x?.amountEUR), 0);
  const defectEUR = num(c?.defectValueEUR) - num(c?.recoveredEUR);
  const lostEUR = num(c?.lostValueEUR);
  let total = 0;
  if (basis === "DEFECT") total = defectEUR > 0 ? defectEUR : num(c?.requestedEUR);
  else if (basis === "COSTS") total = lostEUR + causedEUR;
  else total = (defectEUR > 0 ? defectEUR : 0) + lostEUR + causedEUR;
  return Math.round(Math.max(0, total) * 100) / 100;
}

// ── queries ────────────────────────────────────────────────────────────────
export function subjectRefs(c: any, kind: ClaimSubject["kind"]): string[] {
  return (c?.subjects || []).filter((s: any) => s?.kind === kind).map((s: any) => str(s.ref)).filter(Boolean);
}
export function claimsForLot(claims: any[], lotNumber: any): any[] {
  const want = str(lotNumber);
  return (claims || []).filter(c => subjectRefs(c, "LOT").includes(want));
}
export function claimsForSO(claims: any[], soNumber: any): any[] {
  const want = str(soNumber);
  return (claims || []).filter(c => subjectRefs(c, "SO").includes(want));
}
export function claimsForShipment(claims: any[], shipmentNumber: any): any[] {
  const want = str(shipmentNumber);
  return (claims || []).filter(c => subjectRefs(c, "SHIPMENT").includes(want));
}

/** The claimed quantity a claim attributes to one lot. */
export function affectedKgForLot(c: any, lotNumber: any): number {
  const want = str(lotNumber);
  return (c?.subjects || []).filter((s: any) => s?.kind === "LOT" && str(s.ref) === want)
    .reduce((a: number, s: any) => a + num(s.affectedKg), 0);
}

/**
 * Net exposure for an incident: what we conceded to the client, less what we
 * recovered from the parties responsible. The gap is a commercial decision —
 * sometimes you give the client more than you recover to protect the
 * relationship — so it is reported, never flagged as an error.
 * Uses accepted amounts where known, falling back to requested.
 */
export function incidentNet(claims: any[], rootClaimId: any) {
  const all = claims || [];
  const root = all.find((c: any) => String(c?.id) === String(rootClaimId));
  if (!root) return { conceded: 0, recovered: 0, net: 0, members: [] as any[] };
  const family = [root, ...all.filter((c: any) => String(c?.parentClaimId ?? "") === String(root.id))];
  const amount = (c: any) => (c.acceptedEUR != null && c.acceptedEUR !== "" ? num(c.acceptedEUR) : num(c.requestedEUR));
  const conceded = family.filter(c => c.direction === "CONCESSION").reduce((a, c) => a + amount(c), 0);
  const recovered = family.filter(c => c.direction === "RECOVERY").reduce((a, c) => a + amount(c), 0);
  return {
    conceded: Math.round(conceded * 100) / 100,
    recovered: Math.round(recovered * 100) / 100,
    net: Math.round((conceded - recovered) * 100) / 100,
    members: family,
  };
}

// ── migration (Phase 1) ────────────────────────────────────────────────────
export interface MigrationResult { claims: Claim[]; notes: string[]; changed: boolean; }

/**
 * Lift every existing claim into the new store.
 *   • lot.claims[]  → RECOVERY claims against the Supplier (the producer)
 *   • CLAIM movements carrying claimValue → CONCESSION claims against the Client
 *     (these had no number, no status and no document at all)
 * The originals are LEFT IN PLACE untouched: nothing writes to them any more, and
 * keeping them means a migration bug can never destroy the only copy. Claims that
 * were already migrated (matched by provenance) are never duplicated.
 */
export function migrateClaims(input: { lots?: any[]; orders?: any[]; pos?: any[]; existing?: any[] }, deps: { todayISO: () => string; nextId: () => any }): MigrationResult {
  const lots = input.lots || [];
  const pos = input.pos || [];
  const existing = (input.existing || []).slice();
  const seen = new Set(existing.map((c: any) => str(c?.migratedFrom)).filter(Boolean));
  const out: Claim[] = [];
  const notes: string[] = [];
  const year = new Date(deps.todayISO()).getFullYear() || 2026;

  const allFor = () => existing.concat(out);

  lots.forEach((lot: any) => {
    const lotNo = str(lot?.number);
    const po = pos.find((p: any) => str(p?.number) === str(lot?.poRef)) || null;
    const supplierName = po?.supplier?.name || str(po?.supplierName) || "";

    // 1) producer claims nested on the lot
    (lot?.claims || []).forEach((old: any, idx: number) => {
      const prov = `lot:${lotNo}:claim:${old?.id ?? idx}`;
      if (seen.has(prov)) return;
      const number = str(old?.number) || nextClaimNumber(allFor(), year);
      out.push(blankClaim({
        id: deps.nextId(),
        number,
        direction: "RECOVERY",
        respondent: { kind: "Supplier", contactId: po?.supplierId ?? null, name: supplierName },
        cause: "Quality defect",
        subjects: [
          { kind: "LOT", ref: lotNo, affectedKg: num(old?.affectedKg) || undefined },
          ...(lot?.poRef ? [{ kind: "PO" as const, ref: str(lot.poRef) }] : []),
        ],
        date: str(old?.date),
        costLines: old?.lines || old?.costLines || [],
        basis: "DEFECT",
        defectType: str(old?.defectType),
        defectPct: old?.defectPct ?? "",
        soldInMarket: old?.soldInMarket ?? null,
        recoveredEGP: old?.recoveredEGP ?? "",
        egpPerEur: old?.egpPerEur ?? "",
        plnPerEur: old?.plnPerEur ?? "",
        totalCostEUR: old?.totalCostEUR ?? 0,
        defectValueEUR: old?.defectValueEUR ?? 0,
        recoveredEUR: old?.recoveredEUR ?? 0,
        requestedEUR: old?.requestedCreditEUR ?? old?.requestedEUR ?? 0,
        acceptedEUR: old?.acceptedEUR ?? null,
        status: (str(old?.status) === "Issued" ? "Submitted" : str(old?.status) || "Draft") as ClaimStatus,
        resolvedAt: str(old?.resolvedAt),
        notes: str(old?.notes),
        migratedFrom: prov,
      }));
      notes.push(`${number}: producer claim lifted from ${lotNo}`);
    });

    // 2) client claims that only existed as CLAIM movements
    (lot?.movements || []).forEach((m: any) => {
      if (str(m?.type) !== "CLAIM" || m?.voided) return;
      if (!(num(m?.claimValue) > 0)) return;              // producer-claim marker movements carry no value
      const prov = `lot:${lotNo}:movement:${m?.id}`;
      if (seen.has(prov)) return;
      const number = nextClaimNumber(allFor(), year);
      const soRef = str(m?.soRef);
      out.push(blankClaim({
        id: deps.nextId(),
        number,
        direction: "CONCESSION",
        respondent: { kind: "Client", contactId: null, name: "" },
        cause: "Quality defect",
        subjects: [
          { kind: "LOT", ref: lotNo, affectedKg: num(m?.qtyKg) || undefined },
          ...(soRef ? [{ kind: "SO" as const, ref: soRef }] : []),
        ],
        date: str(m?.date),
        requestedEUR: 0,
        acceptedEUR: null,
        status: "Settled",                                  // the credit note was already issued
        resolvedAt: str(m?.date),
        movementRef: m?.id ?? null,
        notes: [str(m?.note), num(m?.claimValue) ? `Credit ${num(m.claimValue)} ${str(m?.claimCurrency) || "PLN"}` : ""].filter(Boolean).join(" · "),
        migratedFrom: prov,
      }));
      notes.push(`${number}: client claim created from ${lotNo} movement (was unnumbered)`);
    });
  });

  return { claims: existing.concat(out), notes, changed: out.length > 0 };
}

/** Register health — what is open, what is overdue on notice, what lacks evidence. */
export function claimsSummary(claims: any[], todayISO: string) {
  const rows = claims || [];
  const open = rows.filter(isClaimOpen);
  const overdue = open.filter(c => str(c.noticeDeadline) && str(c.noticeDeadline) < todayISO && !str(c.notifiedAt));
  const noEvidence = open.filter(c => !(c.evidence || []).some((e: any) => str(e?.link)));
  const amount = (c: any) => (c.acceptedEUR != null && c.acceptedEUR !== "" ? num(c.acceptedEUR) : num(c.requestedEUR));
  return {
    total: rows.length,
    open: open.length,
    overdue: overdue.map(c => c.number),
    noEvidence: noEvidence.map(c => c.number),
    openRecoveryEUR: Math.round(open.filter(c => c.direction === "RECOVERY").reduce((a, c) => a + amount(c), 0) * 100) / 100,
    openConcessionEUR: Math.round(open.filter(c => c.direction === "CONCESSION").reduce((a, c) => a + amount(c), 0) * 100) / 100,
  };
}


// ─── v6.49.0  POSTING AN ACCEPTED CLAIM ──────────────────────────────────────
// Ruling: "the amount accepted after negotiation is different from the amount
// requested; at the end this will impact the P/L of this SO — whether it is money
// we get less from the client, or money we pay less to the producer of the PO
// linked or the shipment SHP linked."
//
// So only the ACCEPTED figure ever moves anything, and it routes by respondent:
//   Client                                   → less REVENUE on the sales order
//   Supplier / Carrier / Forwarder / Line /
//   Warehouse                                → less COST on the affected lots
// Both land as a dated, source-tagged adjustment (`claim:CLM-…`) that is additive
// and reversible — the original figures are never overwritten, exactly like the
// shipment cost allocator. A closed deal's margin therefore moves legitimately
// when a claim settles months later.

export interface ClaimPosting {
  kind: "LOT_COST" | "SO_REVENUE";
  ref: string;            // lot number or SO number
  amountPLN: number;      // NEGATIVE: reduces the cost or the revenue
  source: string;         // claim:CLM-2026-0001
  label: string;
  date: string;
}

const POSTABLE = new Set<string>(["Accepted", "Partially accepted", "Settled"]);
export function isPostable(c: any): boolean {
  return POSTABLE.has(str(c?.status)) && num(c?.acceptedEUR) > 0;
}

/**
 * Turn an accepted claim into its P/L adjustments.
 * Recoveries spread across the claim's lots pro-rata by affected kg (evenly when
 * no kg are stated). Concessions land on the sales order.
 */
export function buildClaimPostings(claim: any, opts: { plnPerEur?: any; todayISO?: string } = {}): { postings: ClaimPosting[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!isPostable(claim)) return { postings: [], warnings: ["Claim is not accepted, or the agreed amount is zero"] };

  const rate = num(opts.plnPerEur) || num(claim?.plnPerEur);
  if (!(rate > 0)) return { postings: [], warnings: ["No EUR→PLN rate on the claim — set one before posting"] };

  const acceptedPLN = Math.round(num(claim.acceptedEUR) * rate * 100) / 100;
  const source = `claim:${str(claim.number)}`;
  const date = str(opts.todayISO) || str(claim.resolvedAt) || str(claim.date);
  const who = str(claim?.respondent?.name) || str(claim?.respondent?.kind);

  if (str(claim.direction) === "CONCESSION") {
    const sos = subjectRefs(claim, "SO");
    if (!sos.length) return { postings: [], warnings: ["Concession has no sales order to reduce — link the SO first"] };
    const each = Math.round((acceptedPLN / sos.length) * 100) / 100;
    return {
      postings: sos.map(ref => ({
        kind: "SO_REVENUE" as const, ref, amountPLN: -each, source,
        label: `Claim ${claim.number} — credit to ${who || "client"}`, date,
      })),
      warnings: sos.length > 1 ? ["Split evenly across the linked sales orders"] : [],
    };
  }

  // RECOVERY → reduce the cost carried by the affected lots
  const lotSubjects = (claim?.subjects || []).filter((s: any) => s?.kind === "LOT" && str(s.ref));
  if (!lotSubjects.length) return { postings: [], warnings: ["Recovery has no lots to credit — link the affected lot(s) first"] };

  const totalKg = lotSubjects.reduce((a: number, s: any) => a + num(s.affectedKg), 0);
  const postings = lotSubjects.map((s: any, i: number) => {
    const share = totalKg > 0 ? num(s.affectedKg) / totalKg : 1 / lotSubjects.length;
    return {
      kind: "LOT_COST" as const,
      ref: str(s.ref),
      amountPLN: -(Math.round(acceptedPLN * share * 100) / 100),
      source,
      label: `Claim ${claim.number} accepted — ${who || "counterparty"}`,
      date,
    };
  });
  // absorb rounding drift into the first posting so the total is exact
  const drift = Math.round((-acceptedPLN - postings.reduce((a, p) => a + p.amountPLN, 0)) * 100) / 100;
  if (drift && postings.length) postings[0].amountPLN = Math.round((postings[0].amountPLN + drift) * 100) / 100;
  if (!(totalKg > 0)) warnings.push("No affected kg stated — split evenly across the linked lots");
  return { postings, warnings };
}

/** Apply LOT_COST postings to lots, replacing any prior posting from the same claim. */
export function applyPostingsToLots(lots: any[], postings: ClaimPosting[]): any[] {
  const byLot: Record<string, ClaimPosting[]> = {};
  postings.filter(p => p.kind === "LOT_COST").forEach(p => { (byLot[p.ref] = byLot[p.ref] || []).push(p); });
  if (!Object.keys(byLot).length) return lots || [];
  return (lots || []).map((l: any) => {
    const mine = byLot[str(l?.number)];
    if (!mine) return l;
    const sources = new Set(mine.map(p => p.source));
    const kept = (l.costs || []).filter((c: any) => !sources.has(str(c?.source)));
    const added = mine.map(p => ({
      id: undefined, type: "claim_credit", label: p.label, source: p.source,
      amount: p.amountPLN, currency: "PLN", fxRate: 1, pln: p.amountPLN, date: p.date,
    }));
    return { ...l, costs: [...kept, ...added] };
  });
}

/** Apply SO_REVENUE postings to orders, replacing any prior posting from the same claim. */
export function applyPostingsToOrders(orders: any[], postings: ClaimPosting[]): any[] {
  const bySO: Record<string, ClaimPosting[]> = {};
  postings.filter(p => p.kind === "SO_REVENUE").forEach(p => { (bySO[p.ref] = bySO[p.ref] || []).push(p); });
  if (!Object.keys(bySO).length) return orders || [];
  return (orders || []).map((o: any) => {
    const mine = bySO[str(o?.number)];
    if (!mine) return o;
    const sources = new Set(mine.map(p => p.source));
    const kept = (o.claimAdjustments || []).filter((a: any) => !sources.has(str(a?.source)));
    const added = mine.map(p => ({ source: p.source, label: p.label, amountPLN: p.amountPLN, date: p.date }));
    return { ...o, claimAdjustments: [...kept, ...added] };
  });
}

/** Reverse everything a claim posted (used when an acceptance is undone). */
export function reverseClaimPostings(claim: any, lots: any[], orders: any[]): { lots: any[]; orders: any[] } {
  const source = `claim:${str(claim?.number)}`;
  return {
    lots: (lots || []).map((l: any) => (l.costs || []).some((c: any) => str(c?.source) === source)
      ? { ...l, costs: (l.costs || []).filter((c: any) => str(c?.source) !== source) } : l),
    orders: (orders || []).map((o: any) => (o.claimAdjustments || []).some((a: any) => str(a?.source) === source)
      ? { ...o, claimAdjustments: (o.claimAdjustments || []).filter((a: any) => str(a?.source) !== source) } : o),
  };
}
