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
    costLines: [], defectType: "", defectPct: "", soldInMarket: null,
    recoveredEGP: "", egpPerEur: "", plnPerEur: "",
    totalCostEUR: 0, defectValueEUR: 0, recoveredEUR: 0,
    requestedEUR: 0, acceptedEUR: null,
    status: "Draft", resolvedAt: "", evidence: [],
    financeNoteId: null, movementRef: null, notes: "",
    ...overrides,
  } as Claim;
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
