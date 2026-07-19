// ─────────────────────────────────────────────────────────────────────────────
// v6.40.0 — AUDIT TRAIL domain (pure, tested).
//
// A passive, append-only logbook of business-level events: who did what, when,
// to which document. It NEVER blocks, validates or alerts — all existing guards
// and error alerts are untouched; this only records, so problems can be traced
// instead of guessed at. Lifecycle events only (created / status / cancelled /
// allocated / imported / movement / claim), not field-level keystrokes.
//
// The log is CAPPED: localStorage is finite, so the oldest entries roll off
// once the cap is reached. Stored under DATA_KEYS ("auditLog"), so it exports,
// backs up and migrates together with everything else.
// ─────────────────────────────────────────────────────────────────────────────

export const AUDIT_CAP = 5000;

export interface AuditEvent {
  id: number;
  ts: string;          // ISO datetime
  user: string;
  module: string;      // "Purchase orders" | "Sales orders" | "Shipments" | "Inventory" | "Invoices" | …
  docType: string;     // "PO" | "SO" | "Shipment" | "Lot" | "Invoice" | "Import"
  docNumber: string;
  action: string;      // "created" | "saved" | "status" | "cancelled" | "allocated" | "imported" | "movement" | "claim"
  summary: string;     // one human-readable line
}

/** Append an entry; oldest entries roll off past the cap. Pure. */
export function appendAudit(log: AuditEvent[], entry: AuditEvent, cap: number = AUDIT_CAP): AuditEvent[] {
  const next = [...(log || []), entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** All events for one document (any module), oldest first. */
export function auditForDoc(log: AuditEvent[], docNumber: string): AuditEvent[] {
  const n = String(docNumber || "").trim().toLowerCase();
  if (!n) return [];
  return (log || []).filter(e => String(e.docNumber || "").toLowerCase() === n);
}

/** Viewer filter: by module and free text (doc number / user / summary). Newest first. */
export function filterAudit(log: AuditEvent[], opts: { module?: string; q?: string } = {}): AuditEvent[] {
  const mod = opts.module && opts.module !== "All" ? opts.module : null;
  const q = String(opts.q || "").trim().toLowerCase();
  return [...(log || [])]
    .filter(e => (!mod || e.module === mod) &&
      (!q || `${e.docNumber} ${e.user} ${e.summary} ${e.action}`.toLowerCase().includes(q)))
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)) || (b.id || 0) - (a.id || 0));
}
