// v6.40.0 — audit bus. Modules call recordAudit({module, docType, docNumber,
// action, summary}); App installs the sink, which enriches with user/time/id and
// appends to the capped store. Failures are swallowed — recording must never
// interfere with the operation being recorded.
let sink: ((e: any) => void) | null = null;
export function setAuditSink(fn: ((e: any) => void) | null): void { sink = fn; }
export function recordAudit(e: { module: string; docType: string; docNumber: string; action: string; summary: string }): void {
  try { if (sink) sink(e); } catch { /* never disturb the operation */ }
}
