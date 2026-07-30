// ─── v6.47.0  DOCUMENT LINKS ─────────────────────────────────────────────────
// Signed originals (CMR with the receiving warehouse's remarks, the returned
// loading protocol, phytosanitary certificates, BLs) live in the business's
// Dropbox. Until the backend can hold files, the ERP records WHERE a document
// is rather than the document itself: type, reference, the date it came back,
// and a share link you can click through to.
//
// Why not store the file: everything currently lives in one browser's
// localStorage, capped at roughly 5-10 MB in total — the same space that holds
// every contact, PO, SO, lot and shipment. A single scanned CMR runs 200 KB-2 MB
// and text-encoding inflates it by a third, so a handful of scans would consume
// the whole database. Links cost nothing and migrate cleanly: when the backend
// arrives, a stored link becomes an uploaded file with the same metadata around it.

export type LinkHost = "Dropbox" | "Google Drive" | "OneDrive" | "SharePoint" | "Other";

export interface LinkInfo {
  ok: boolean;        // is it a usable http(s) link
  host: LinkHost;     // recognised provider, for the little badge
  label: string;      // short human label, e.g. "Dropbox"
  reason?: string;    // why it isn't usable
}

/** Classify + sanity-check a pasted share link. We never rewrite the URL: a
 *  Dropbox "?dl=0" link opens their preview page, which is what people expect. */
export function inspectLink(raw: any): LinkInfo {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: false, host: "Other", label: "", reason: "empty" };
  if (!/^https?:\/\//i.test(s)) {
    return { ok: false, host: "Other", label: "", reason: "Must start with http:// or https://" };
  }
  let host = "";
  try { host = new URL(s).hostname.toLowerCase(); } catch { return { ok: false, host: "Other", label: "", reason: "Not a valid web address" }; }

  if (host.includes("dropbox.")) return { ok: true, host: "Dropbox", label: "Dropbox" };
  if (host.includes("drive.google.") || host.includes("docs.google.")) return { ok: true, host: "Google Drive", label: "Drive" };
  if (host.includes("1drv.ms") || host.includes("onedrive.")) return { ok: true, host: "OneDrive", label: "OneDrive" };
  if (host.includes("sharepoint.")) return { ok: true, host: "SharePoint", label: "SharePoint" };
  return { ok: true, host: "Other", label: host.replace(/^www\./, "") };
}

export function isUsableLink(raw: any): boolean { return inspectLink(raw).ok; }

/** A document row counts as "on file" when it has a working link. */
export function hasFile(doc: any): boolean { return isUsableLink(doc?.link); }

/** Rows that are settled (we have them, or they don't apply). */
const SETTLED = new Set(["have it", "sent", "n/a"]);
export function isSettled(doc: any): boolean {
  return SETTLED.has(String(doc?.status || "").trim().toLowerCase());
}

export interface DocRegisterSummary {
  total: number;
  settled: number;
  outstanding: number;
  withFile: number;
  settledWithoutFile: string[];   // types we say we have but can't produce
  badLinks: string[];             // types whose link is unusable
}

/** Register health for a document set — what's outstanding, and what we claim to
 *  hold but couldn't actually produce if a carrier or insurer asked. */
export function summariseDocs(docs: any[]): DocRegisterSummary {
  const rows = docs || [];
  const settledWithoutFile: string[] = [];
  const badLinks: string[] = [];
  let settled = 0, withFile = 0;

  rows.forEach(d => {
    const type = String(d?.type || "document").trim() || "document";
    const linkRaw = String(d?.link || "").trim();
    const info = inspectLink(linkRaw);
    if (linkRaw && !info.ok) badLinks.push(type);
    if (info.ok) withFile++;
    if (isSettled(d)) {
      settled++;
      // "N/A" needs no file; "Have it"/"Sent" should be produceable
      if (String(d.status).trim().toLowerCase() !== "n/a" && !info.ok) settledWithoutFile.push(type);
    }
  });

  return {
    total: rows.length,
    settled,
    outstanding: rows.length - settled,
    withFile,
    settledWithoutFile,
    badLinks,
  };
}

/** Is this document set strong enough to support a claim? Evidence needs the
 *  actual paper, not just a tick. */
export function claimEvidenceGaps(docs: any[], required: string[] = ["CMR"]): string[] {
  const rows = docs || [];
  const gaps: string[] = [];
  required.forEach(want => {
    const row = rows.find(d => String(d?.type || "").trim().toLowerCase() === want.toLowerCase());
    if (!row) { gaps.push(`${want}: not on the document list`); return; }
    if (!isSettled(row)) { gaps.push(`${want}: not received yet`); return; }
    if (!hasFile(row)) gaps.push(`${want}: received but no scan linked — a claim needs the signed copy`);
  });
  return gaps;
}
