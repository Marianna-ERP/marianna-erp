// ── CLAIM READINESS (v6.71.0) — Claims Phase 3, completed ───────────────────
// Three things a claim needs that the system could not previously tell you:
//
//   1. WHEN NOTICE IS DUE. The deadline field and the overdue flag existed, but
//      nothing set a deadline — you typed each one from memory. A notice period
//      missed loses the claim regardless of its merit, and the periods differ by
//      who you are claiming against.
//
//   2. WHAT EVIDENCE THIS CLAIM NEEDS. docLinks.claimEvidenceGaps was written
//      and never called, because it reads a SHIPMENT's document list while a
//      claim carries its own free-typed evidence array — the two were never
//      connected. And what a claim needs depends on the respondent: a carrier
//      claim and a producer claim are lost for different reasons.
//
//   3. WHETHER THE MONEY AGREES WITH THE PAPER. A claim's accepted amount moves
//      the P/L; the credit note is the legal document. Nothing checked that the
//      two said the same thing, so they could drift apart silently.
//
// Owner ruling (Aug 2026): all three REPORT, none of them block. "A truck at a
// border does not wait for a form" — and sometimes you notify first and gather
// the evidence after, because the deadline will not wait either. The value here
// is knowing at nine in the morning what is missing before you send at eleven.

import { parseNum } from "./numbers";

const n = parseNum;
const S = (v: any) => String(v ?? "").trim();

// ── 1. NOTICE DEADLINES ─────────────────────────────────────────────────────
// Defaults only. Every one is overridable on the claim, because the contract
// or the consignment note wins over any default we could hold here.
//
// The CMR Convention (road) gives 7 days from delivery for non-apparent damage;
// apparent damage must be noted AT delivery. Hague-Visby (sea) gives 3 days for
// non-apparent damage. Warsaw/Montreal (air) gives 14 days. Commercial claims
// against a producer or from a client follow the contract, so the defaults here
// are conservative working assumptions rather than law.

export interface NoticeRule { days: number; from: "delivery" | "discovery"; basis: string; }

export const NOTICE_DEFAULTS: Record<string, NoticeRule> = {
  Carrier:      { days: 7,  from: "delivery",  basis: "CMR Convention — 7 days from delivery for damage not apparent at handover (apparent damage must be noted ON the CMR at delivery)" },
  Forwarder:    { days: 3,  from: "delivery",  basis: "Hague-Visby — 3 days for damage not apparent at discharge" },
  ShippingLine: { days: 3,  from: "delivery",  basis: "Hague-Visby — 3 days for damage not apparent at discharge" },
  Supplier:     { days: 14, from: "discovery", basis: "Commercial — quality defect, notified promptly after the client reports it" },
  Warehouse:    { days: 14, from: "discovery", basis: "Commercial — per the storage agreement" },
  Client:       { days: 30, from: "discovery", basis: "Commercial — the window in which we accept a client's claim" },
};

/** Add whole days to an ISO date. Returns "" when the base date is unusable. */
export function addDays(iso: string, days: number): string {
  const s = S(iso).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface DeadlineSuggestion { deadline: string; days: number; from: string; basis: string; }

/** The suggested notice deadline for a claim. `baseDate` is the delivery date
 *  where one is known, else the claim's own date (the day it was raised, which
 *  is the day the problem was discovered). Never overwrites a deadline the user
 *  has already set — see applyDeadlineDefault. */
export function suggestNoticeDeadline(claim: any, baseDate?: string): DeadlineSuggestion | null {
  const kind = S(claim?.respondent?.kind);
  const rule = NOTICE_DEFAULTS[kind];
  if (!rule) return null;
  const base = S(baseDate) || S(claim?.date);
  const deadline = addDays(base, rule.days);
  if (!deadline) return null;
  return { deadline, days: rule.days, from: rule.from, basis: rule.basis };
}

/** Set the deadline only when the claim has none. A deadline someone typed is a
 *  decision — a default must never quietly replace it. */
export function applyDeadlineDefault(claim: any, baseDate?: string): any {
  if (S(claim?.noticeDeadline)) return claim;
  const s = suggestNoticeDeadline(claim, baseDate);
  return s ? { ...claim, noticeDeadline: s.deadline } : claim;
}

export type DeadlineState = "none" | "ok" | "due-soon" | "passed" | "notified";

export interface DeadlineStatus { state: DeadlineState; daysLeft: number | null; message: string; }

/** Where this claim stands against its notice deadline. */
export function deadlineStatus(claim: any, todayISO: string): DeadlineStatus {
  const dl = S(claim?.noticeDeadline);
  if (S(claim?.notifiedAt)) {
    return { state: "notified", daysLeft: null, message: `Notified ${S(claim.notifiedAt)} — the notice period is satisfied.` };
  }
  if (!dl) return { state: "none", daysLeft: null, message: "No notice deadline set." };
  const msPerDay = 86400000;
  const a = new Date(`${S(todayISO).slice(0, 10)}T00:00:00`).getTime();
  const b = new Date(`${dl.slice(0, 10)}T00:00:00`).getTime();
  if (!isFinite(a) || !isFinite(b)) return { state: "none", daysLeft: null, message: "No notice deadline set." };
  const daysLeft = Math.round((b - a) / msPerDay);
  if (daysLeft < 0) {
    return { state: "passed", daysLeft, message: `Notice deadline passed ${-daysLeft} day(s) ago and no notification is recorded. A claim notified late is usually refused on the notice period alone, whatever its merits.` };
  }
  if (daysLeft <= 2) {
    return { state: "due-soon", daysLeft, message: `Notice due in ${daysLeft} day(s) — notify the respondent even if the evidence is still being gathered. The deadline will not wait for the survey.` };
  }
  return { state: "ok", daysLeft, message: `Notice due in ${daysLeft} day(s).` };
}

/** Claims whose notice deadline is passed or imminent, worst first. Drives the
 *  aging view: "what will I lose this week if I do nothing". */
export function claimsNeedingNotice(claims: any[], todayISO: string): Array<{ claim: any; status: DeadlineStatus }> {
  const CLOSED = new Set(["Settled", "Rejected", "Withdrawn", "Cancelled"]);
  return (claims || [])
    .filter(c => c && !CLOSED.has(S(c.status)) && !S(c.notifiedAt))
    .map(c => ({ claim: c, status: deadlineStatus(c, todayISO) }))
    .filter(x => x.status.state === "passed" || x.status.state === "due-soon")
    .sort((a, b) => (a.status.daysLeft ?? 0) - (b.status.daysLeft ?? 0));
}

// ── 2. EVIDENCE ─────────────────────────────────────────────────────────────
// What a claim needs depends on WHO it is against, because each kind of claim is
// lost for a different reason. These are the documents that decide the argument.

export interface EvidenceRequirement { kind: string; why: string; }

export const EVIDENCE_BY_RESPONDENT: Record<string, EvidenceRequirement[]> = {
  Carrier: [
    { kind: "CMR", why: "with the receiving warehouse's remarks — without remarks written at delivery the carrier will say the damage was already there when he loaded" },
    { kind: "Loading protocol", why: "signed at the producer's dock: proof of the condition the goods left in" },
    { kind: "Photos", why: "of the damage as unloaded, before anything is moved" },
  ],
  Forwarder: [
    { kind: "Temperature record", why: "the download and its recorder serial — a reefer claim without the trace is only an assertion" },
    { kind: "Bill of lading", why: "the contract of carriage and its condition clauses" },
    { kind: "Survey report", why: "an independent inspection at discharge" },
  ],
  ShippingLine: [
    { kind: "Temperature record", why: "the download and its recorder serial — a reefer claim without the trace is only an assertion" },
    { kind: "Bill of lading", why: "the contract of carriage and its condition clauses" },
    { kind: "Survey report", why: "an independent inspection at discharge" },
  ],
  Supplier: [
    { kind: "Loading protocol", why: "signed at HIS dock — it is what shows the goods left in the condition he claims" },
    { kind: "Survey report", why: "the defect quantified at destination by someone independent" },
    { kind: "Temperature record", why: "this is what proves the transport was sound, so the fault is the produce and not the journey" },
    { kind: "Client claim", why: "the claim your client made on you — the origin of the figures you are passing on" },
  ],
  Client: [
    { kind: "Client claim", why: "their written claim and its figures" },
    { kind: "Photos", why: "the condition they reported" },
  ],
  Warehouse: [
    { kind: "Survey report", why: "the condition found, and when" },
    { kind: "Photos", why: "the damage as found in store" },
  ],
};

/** The controlled list of evidence kinds, so the gate can match reliably.
 *  Free text stays allowed on a claim for anything unusual — it simply cannot
 *  be checked automatically. */
export const EVIDENCE_KINDS: string[] = Array.from(new Set(
  Object.values(EVIDENCE_BY_RESPONDENT).flat().map(r => r.kind)
)).concat(["Weighbridge ticket", "Packing list", "Invoice", "Other"]);

export interface EvidenceGap { kind: string; why: string; state: "missing" | "no-link"; }

/** Evidence this claim needs and does not yet have.
 *
 *  "missing"  — nothing of that kind is attached at all.
 *  "no-link"  — a row names it, but carries no usable link. This is the case
 *               worth catching: someone ticks that the CMR arrived while the
 *               scan sits in an inbox, and "we have it" is not the same as
 *               being able to produce it when the carrier's insurer asks.
 *
 *  Matching is loose on purpose — "CMR with remarks" satisfies "CMR" — because
 *  people describe documents in their own words and a gate that fires on
 *  wording is a gate that gets ignored. */
export function claimEvidenceGaps(claim: any, isUsableLink: (v: any) => boolean): EvidenceGap[] {
  const required = EVIDENCE_BY_RESPONDENT[S(claim?.respondent?.kind)] || [];
  const rows = (claim?.evidence || []).filter(Boolean);
  const gaps: EvidenceGap[] = [];
  required.forEach(req => {
    const want = req.kind.toLowerCase();
    const hits = rows.filter((e: any) => {
      const k = S(e.kind).toLowerCase();
      return k === want || k.includes(want) || want.includes(k.length >= 4 ? k : want);
    });
    if (!hits.length) { gaps.push({ kind: req.kind, why: req.why, state: "missing" }); return; }
    if (!hits.some((e: any) => isUsableLink(e.link))) {
      gaps.push({ kind: req.kind, why: "named on the claim but no scan is linked — a claim needs the document itself, not a note that it exists", state: "no-link" });
    }
  });
  return gaps;
}

/** One sentence for the moment a claim is about to be sent. Empty when ready.
 *  A WARNING, never a block (owner ruling): a claim is sometimes notified before
 *  the survey is back, because the notice period will not wait for it. */
export function evidenceWarning(gaps: EvidenceGap[]): string {
  if (!gaps.length) return "";
  const missing = gaps.filter(g => g.state === "missing").map(g => g.kind);
  const unlinked = gaps.filter(g => g.state === "no-link").map(g => g.kind);
  const parts: string[] = [];
  if (missing.length) parts.push(`not attached: ${missing.join(", ")}`);
  if (unlinked.length) parts.push(`named but no scan linked: ${unlinked.join(", ")}`);
  return `This claim is missing evidence — ${parts.join("; ")}. You can send it anyway (the notice period does not wait for the survey), but the respondent will ask for these.`;
}

// ── 3. THE MONEY AGAINST THE PAPER ──────────────────────────────────────────
// The accepted amount moves the P/L. The credit note is the legal document.
// If they disagree, the ledger and the accounts say different things and nothing
// on either screen says so.

export interface NoteReconciliation {
  state: "no-amount" | "no-note" | "matched" | "differs";
  acceptedEUR: number;
  noteEUR: number;
  differenceEUR: number;
  message: string;
}

/** Compare a settled claim with the credit/debit note it produced.
 *  `findNote` resolves claim.financeNoteId to the note record. */
export function reconcileClaimNote(claim: any, findNote: (id: any) => any): NoteReconciliation {
  const accepted = n(claim?.acceptedEUR);
  const note = claim?.financeNoteId != null ? findNote(claim.financeNoteId) : null;
  const noteEUR = note ? (S(note.currency).toUpperCase() === "EUR" ? n(note.amount) : n(note.amountEUR)) : 0;
  if (accepted <= 0) {
    return { state: "no-amount", acceptedEUR: 0, noteEUR, differenceEUR: 0, message: "No agreed amount recorded yet — nothing to reconcile." };
  }
  if (!note) {
    return {
      state: "no-note", acceptedEUR: accepted, noteEUR: 0, differenceEUR: accepted,
      message: `An amount of €${accepted.toLocaleString("pl-PL")} has been agreed but no credit or debit note has been raised. The P/L has moved and the legal document does not exist.`,
    };
  }
  const diff = Math.round((accepted - noteEUR) * 100) / 100;
  if (Math.abs(diff) <= 0.01) {
    return { state: "matched", acceptedEUR: accepted, noteEUR, differenceEUR: 0, message: `Agreed amount and ${S(note.noteType) || "note"} ${S(note.number) || ""} agree.`.trim() };
  }
  return {
    state: "differs", acceptedEUR: accepted, noteEUR, differenceEUR: diff,
    message: `The agreed amount (€${accepted.toLocaleString("pl-PL")}) and the note (€${noteEUR.toLocaleString("pl-PL")}) differ by €${Math.abs(diff).toLocaleString("pl-PL")}. One of them is wrong: the P/L follows the claim, the ledger follows the note.`,
  };
}

/** Every settled claim whose money and paper disagree — for a register-wide
 *  check rather than one claim at a time. */
export function claimNoteMismatches(claims: any[], findNote: (id: any) => any): Array<{ number: string; recon: NoteReconciliation }> {
  return (claims || [])
    .filter(c => c && ["Accepted", "Settled"].includes(S(c.status)))
    .map(c => ({ number: S(c.number), recon: reconcileClaimNote(c, findNote) }))
    .filter(x => x.recon.state === "no-note" || x.recon.state === "differs");
}
