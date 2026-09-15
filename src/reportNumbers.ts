// ── v6.99.31 (owner 15 Sept): EVERY REPORT CARRIES ITS OWN NUMBER ──
// A printed report is a document: it must be identifiable afterwards (which trace, which quality report, for which
// lot, issued by whom, when). One register, one helper, one audit line — the same discipline as the business documents.
import { recordAudit } from "./audit";

const KEY = "marianna-erp:v2:reportRegister";
export type ReportKind = "TRC" | "QR" | "SRP" | "SET";
export const REPORT_LABEL: Record<string, string> = { TRC: "Traceability / recall report", QR: "Quality report", SRP: "Sales report", SET: "Settlement" };

export interface IssuedReport { number: string; kind: ReportKind; subject: string; issuedAt: string; by: string; }

export function readReportRegister(): IssuedReport[] {
  try { const raw = window.localStorage.getItem(KEY); const list = raw ? JSON.parse(raw) : []; return Array.isArray(list) ? list : []; } catch { return []; }
}
/** Mint the next number of its kind for this year and record the issue. */
export function issueReportNumber(kind: ReportKind, subject: string, by = "", module = "Inventory"): string {
  const year = new Date().getFullYear();
  const reg = readReportRegister();
  const seq = reg.filter(r => r.kind === kind && String(r.number).includes(`-${year}-`)).length + 1;
  const number = `${kind}-${year}-${String(seq).padStart(4, "0")}`;
  const entry: IssuedReport = { number, kind, subject: String(subject || ""), issuedAt: new Date().toISOString().slice(0, 10), by: String(by || "") };
  try { window.localStorage.setItem(KEY, JSON.stringify([...reg, entry])); } catch { /* best effort */ }
  recordAudit({ module, docType: "Report", docNumber: number, action: "created", summary: `${REPORT_LABEL[kind] || kind} issued for ${subject}${by ? ` by ${by}` : ""}` });
  return number;
}
/** The number already issued for this subject, if the report was printed before (so a reprint keeps its identity). */
export function lastReportNumber(kind: ReportKind, subject: string): string {
  const hits = readReportRegister().filter(r => r.kind === kind && String(r.subject) === String(subject));
  return hits.length ? hits[hits.length - 1].number : "";
}
