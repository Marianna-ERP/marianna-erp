// ── STRUCTURED CUSTOMS (v6.60.0) ────────────────────────────────────────────
// Before this release customs was half-structured: a role, a country and a
// free-text note whose placeholder read "Declaration ref, phyto, duties…".
// Everything that mattered operationally lived in that sentence, which meant
// nothing could be counted, chased or checked — and the halfness produced its
// own defect, the "Cleared by no clearance required (AM SPED…)" line fixed in
// v6.58.0, where a role and a broker contradicted each other unnoticed.
//
// The same four facts are now held for every shipment:
//
//   WHERE     cleared — in Poland, at the port of loading, on arrival
//   WHO       did it — our agent, our forwarder, the client's broker, nobody
//   WHAT      document it produced, and its reference (an EX-1 and its MRN,
//             a T1 and its discharge, an import SAD)
//   STATUS    not required / pending / in progress / cleared, and the date
//
// This matters beyond tidiness in two specific ways for this business:
// clearance in Poland and clearance at the port of loading are different
// parties to chase and a different cost line, and the export declaration
// reference is the proof for zero-rating — if it is buried in a note, nothing
// can tell you it is missing before you invoice.

export const CUSTOMS_PLACES: Record<string, string> = {
  PL: "Poland (before departure)",
  PORT_LOADING: "Port of loading (abroad)",
  PORT_ARRIVAL: "Port of arrival",
  CUSTOMS_POINT: "Customs point en route",
  OTHER: "Elsewhere",
};

export const CUSTOMS_PARTIES: Record<string, string> = {
  OUR_BROKER: "Our Polish agent",
  FORWARDER: "Our forwarder",
  CLIENT_BROKER: "The client's broker",
  SUPPLIER: "The supplier",
};

export const CUSTOMS_DOCS: Record<string, string> = {
  EX1: "Export declaration (EX-1)",
  T1: "T1 transit",
  SAD: "Import SAD",
  EUR1: "EUR.1 movement certificate",
  OTHER: "Other",
};

export const CUSTOMS_STATUSES = ["Pending", "In progress", "Cleared"] as const;

export interface CustomsRecord {
  applies?: boolean;
  place?: string;
  party?: string;
  brokerId?: any;
  docType?: string;
  declRef?: string;        // MRN / declaration number
  status?: string;
  clearedOn?: string;
  cost?: number;
  currency?: string;
  fxRate?: number;
  notes?: string;
  /** legacy (pre-v6.60.0) */
  role?: string;
  country?: string;
}

/** Reads a pre-v6.60.0 record forward without rewriting it — the same approach
 *  used for per-truck protocols and legacy leg fields. Nothing stored changes;
 *  the old role simply answers as a place and a party. */
export function readCustoms(c: any): CustomsRecord {
  const r = { ...(c || {}) } as CustomsRecord;
  if (!r.party && r.role) {
    r.party = r.role === "PL_BROKER" ? "OUR_BROKER"
      : r.role === "FORWARDER" ? "FORWARDER"
      : r.role === "T1_LOCAL" ? "OUR_BROKER" : r.party;
  }
  if (!r.place) {
    if (r.role === "PL_BROKER") r.place = "PL";
    else if (r.role === "FORWARDER") r.place = "PORT_LOADING";
    else if (r.role === "T1_LOCAL") r.place = "CUSTOMS_POINT";
    else if (r.country) r.place = String(r.country).toLowerCase().startsWith("pol") ? "PL" : "OTHER";
  }
  if (!r.docType && r.role === "T1_LOCAL") r.docType = "T1";
  return r;
}

/** Does this shipment need clearance at all? */
export function customsApplies(c: any): boolean {
  const r = readCustoms(c);
  // Legacy "not_required" was a ROLE, which is what let it collide with a named
  // broker and produce a self-contradicting sentence.
  if (r.role === "not_required") return false;
  return !!r.applies;
}

/** One plain sentence for any screen that shows a lot's or shipment's customs.
 *  Replaces the ad-hoc concatenation in Inventory that could contradict itself. */
export function customsSummary(c: any, brokerName?: string): string {
  const r = readCustoms(c);
  if (!customsApplies(r)) return "No customs clearance required";
  const where = CUSTOMS_PLACES[r.place || ""] || "";
  const who = CUSTOMS_PARTIES[r.party || ""] || "";
  const doc = CUSTOMS_DOCS[r.docType || ""] || "";
  const parts: string[] = [];
  if (String(r.status || "") === "Cleared") {
    parts.push(doc && r.declRef ? `Cleared — ${doc} ${r.declRef}` : doc ? `Cleared — ${doc}` : "Cleared");
    if (r.clearedOn) parts.push(`on ${r.clearedOn}`);
  } else {
    parts.push(`Clearance ${String(r.status || "pending").toLowerCase()}`);
  }
  if (where) parts.push(`· ${where}`);
  const party = brokerName || who;
  if (party) parts.push(`· ${party}`);
  return parts.join(" ");
}

export interface CustomsGap { field: string; why: string; }

/** What is missing before this clearance can be called complete.
 *  Reported, never blocking — a truck at the border does not wait for a form. */
export function customsGaps(c: any, opts?: { isExport?: boolean }): CustomsGap[] {
  const r = readCustoms(c);
  if (!customsApplies(r)) return [];
  const gaps: CustomsGap[] = [];
  if (!r.place) gaps.push({ field: "place", why: "where it is cleared decides who you chase and where the cost lands" });
  if (!r.party) gaps.push({ field: "party", why: "no one is named as responsible for this clearance" });
  if (String(r.status || "") === "Cleared") {
    if (!r.docType) gaps.push({ field: "document", why: "cleared, but no document type recorded" });
    if (!String(r.declRef || "").trim()) {
      gaps.push({
        field: "reference",
        why: opts?.isExport
          ? "the export declaration reference is the proof for zero-rating — without it the invoice has no support"
          : "a cleared declaration with no reference cannot be produced if it is questioned",
      });
    }
    if (!r.clearedOn) gaps.push({ field: "date", why: "cleared, but no date recorded" });
  }
  return gaps;
}

/** Is the clearance finished and evidenced? Drives the operational checklist. */
export function customsComplete(c: any, opts?: { isExport?: boolean }): boolean {
  if (!customsApplies(c)) return true;          // nothing to do is a finished state
  return String(readCustoms(c).status || "") === "Cleared" && customsGaps(c, opts).length === 0;
}

/** Shipments whose clearance is outstanding, so "what is stuck in customs" can
 *  be answered without opening each one. Cancelled shipments never count — a
 *  movement that never happened cannot be waiting at a border. */
export function outstandingCustoms(shipments: any[]): Array<{ number: string; status: string; place: string; party: string }> {
  return (shipments || [])
    .filter(s => {
      const st = String(s?.status || "").trim();
      if (st === "Cancelled" || st === "Canceled" || st === "Void") return false;
      if (!customsApplies(s?.customs)) return false;
      return String(readCustoms(s.customs).status || "Pending") !== "Cleared";
    })
    .map(s => {
      const r = readCustoms(s.customs);
      return {
        number: String(s.number), status: String(r.status || "Pending"),
        place: CUSTOMS_PLACES[r.place || ""] || "", party: CUSTOMS_PARTIES[r.party || ""] || "",
      };
    });
}
