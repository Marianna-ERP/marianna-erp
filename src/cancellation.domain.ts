// ── CANCELLATION SEMANTICS (v6.54.0) ────────────────────────────────────────
// User ruling, reaffirmed Aug 2026:
//
//   "Cancelled records stay in the system with the status cancelled and nothing
//    is deleted, to keep track of everything."
//   "If a shipment/PO/SO is cancelled, that means it NEVER HAPPENED —
//    consequently there will be no claims on it."
//
// Those two rules pull in opposite directions, and every defect this module
// fixes lives in the gap between them: the record must remain VISIBLE (the
// trail) while counting for NOTHING (the arithmetic). Before v6.54.0 the app
// honoured the first and forgot the second in several places — cancelled
// shipments were inflating the operational KPIs, their loading protocols still
// read as live evidence, and a claim could be raised against a movement that
// never took place.
//
// One home for the rule so the modules cannot drift apart again.

/** Every status string that means "cancelled" anywhere in the app. */
const CANCELLED = new Set(["Cancelled", "CANCELLED", "cancelled", "Canceled", "Void", "Voided"]);

/** Is this record cancelled? Accepts a record or a bare status string. */
export function isCancelled(recordOrStatus: any): boolean {
  const s = (recordOrStatus && typeof recordOrStatus === "object")
    ? recordOrStatus.status
    : recordOrStatus;
  return CANCELLED.has(String(s || "").trim());
}

/** Does this record count toward operational figures, exceptions and KPIs?
 *  A cancelled record never happened, so it never counts — no missing documents
 *  to chase, no costs to allocate, no invoice to wait for. */
export function countsOperationally(record: any): boolean {
  return !isCancelled(record);
}

/** Filter helper: the live members of a list. */
export function liveOnly<T>(records: T[]): T[] {
  return (records || []).filter(r => !isCancelled(r));
}

/** Split a set of linked documents into live and cancelled.
 *  Used wherever a PO/SO lists its shipments: a PO showing "3 shipments" when
 *  only 1 counts is what sends people hunting for something to delete. */
export function splitByCancelled<T>(records: T[]): { live: T[]; cancelled: T[] } {
  const live: T[] = [], cancelled: T[] = [];
  (records || []).forEach(r => (isCancelled(r) ? cancelled : live).push(r));
  return { live, cancelled };
}

/** Presentation rule (user ruling): cancelled linked documents are struck
 *  through and red. Returned as a style object so every module renders them
 *  identically — a list, a chip and a table cell should not disagree. */
export function cancelledTextStyle(cancelled: boolean): Record<string, any> {
  return cancelled
    ? { textDecoration: "line-through", color: "#DC2626" }
    : {};
}

// ── Claims ──────────────────────────────────────────────────────────────────
// "If a shipment/PO/SO is cancelled there will be no claims on it."

export interface ClaimSubjectRef { kind: "shipment" | "po" | "so" | "lot"; ref: string; }

/** Why a claim cannot be raised against these subjects — "" when it can.
 *  Blocks RAISING only. An existing claim is never invalidated by a later
 *  cancellation: it is flagged for a human to resolve (see staleClaimWarnings),
 *  because destroying a claim already sent to a counterparty would lose the
 *  trail this whole ruling exists to protect. */
export function claimBlockReason(subjects: ClaimSubjectRef[], lookup: (s: ClaimSubjectRef) => any): string {
  const dead = (subjects || [])
    .map(s => ({ s, rec: lookup(s) }))
    .filter(x => x.rec && isCancelled(x.rec));
  if (!dead.length) return "";
  const names = dead.map(x => x.s.ref).join(", ");
  const noun = dead.length === 1 ? "is cancelled" : "are cancelled";
  return `${names} ${noun} — a cancelled document never happened, so there is nothing to claim against it.`;
}

/** Claims whose subject was cancelled AFTER the claim was raised.
 *  Surfaced rather than silently voided: someone has to decide whether to
 *  withdraw the claim or un-cancel the document. */
export function staleClaimWarnings(claims: any[], lookup: (s: ClaimSubjectRef) => any): Array<{ claimNumber: string; deadRefs: string[] }> {
  const out: Array<{ claimNumber: string; deadRefs: string[] }> = [];
  (claims || []).forEach(c => {
    if (isCancelled(c)) return;                       // a cancelled claim needs no warning
    const subs: ClaimSubjectRef[] = (c.subjects || []).map((s: any) => ({
      kind: s.kind || s.type, ref: s.ref || s.number || s.docNumber,
    })).filter((s: any) => s.kind && s.ref);
    const dead = subs.filter(s => { const r = lookup(s); return r && isCancelled(r); }).map(s => s.ref);
    if (dead.length) out.push({ claimNumber: c.number, deadRefs: dead });
  });
  return out;
}

// ── Audit ───────────────────────────────────────────────────────────────────

export interface ReleaseSummary { lotPostings: number; costLots: number; protocols: number; kg: number; }

/** One sentence recording what a cancellation put back — for the audit trail,
 *  not a toast that disappears. "Nothing to release" is itself worth recording:
 *  it distinguishes a cancellation that reversed real movements from one that
 *  reversed nothing. */
export function releaseSummaryText(n: ReleaseSummary): string {
  const parts: string[] = [];
  if (n.lotPostings > 0) parts.push(`${n.lotPostings} lot posting(s) voided`);
  if (n.kg > 0) parts.push(`${Math.round(n.kg).toLocaleString("pl-PL")} kg released`);
  if (n.costLots > 0) parts.push(`allocated costs removed from ${n.costLots} lot(s)`);
  if (n.protocols > 0) parts.push(`${n.protocols} loading protocol(s) voided`);
  return parts.length ? parts.join("; ") : "nothing to release (no postings had been made)";
}
