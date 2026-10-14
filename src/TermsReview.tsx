// TermsReview.tsx — v7.20.0 (A-INC-2, owner 11 Oct — P-9: 'any inconsistency with the incoterms is flagged for review').
// One finding per line: the term, the document whose term it is, the record that disagrees (it opens) and what disagrees.
// Amber, never red — red is kept for errors and risks. Nothing here changes a record: the person reviewing decides whether
// the term or the record is wrong.
import React from "react";
import { DocLink } from "./ui";
import { TERMS_KIND_LABEL } from "./incoterms.domain";

const MONO = "ui-monospace, Menlo, monospace";
/** The Shipments list filter that shows the review (also the Dashboard tile's hand-off). */
export const TERMS_REVIEW = "Terms to review";

/** One finding. `here` is the record being viewed (its own number is not repeated as a link); a shipment record opens with
 *  `onOpenShipment` when the Shipments module gives one, every other record through its document link. */
export function TermsFindingLine({ f, here = "", onOpenShipment = null }: any) {
  const rec = String(f?.record || ""), doc = String(f?.doc || "");
  const link = (n: string) => <DocLink num={n}><span style={{ fontFamily: MONO, fontWeight: 700, color: "#1D4ED8" }}>{n}</span></DocLink>;
  const recNode = !rec || rec === here || rec === doc ? null
    : f.recordKind === "shipment" && onOpenShipment
      ? <button type="button" onClick={e => { e.stopPropagation(); onOpenShipment(rec); }} title={`Open ${rec}`} style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontFamily: MONO, fontWeight: 700, fontSize: 11, color: "#1D4ED8" }}>{rec}</button>
      : link(rec);
  return <div data-terms-finding={f?.kind} style={{ padding: "7px 10px", borderTop: "1px solid #FDE68A" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 11 }}>
      <span title="The incoterm" style={{ fontFamily: MONO, fontWeight: 800, padding: "1px 6px", borderRadius: 5, background: "#FEF3C7", color: "#92400E" }}>{f?.term || "—"}</span>
      {doc ? <span title="The document whose term it is">{doc === here || (doc === rec && f.recordKind === "shipment") ? <span style={{ fontFamily: MONO, fontWeight: 700, color: "#334155" }}>{doc}</span> : link(doc)}</span> : null}
      {recNode ? <><span style={{ color: "#94A3B8" }}>→</span><span title="The record that disagrees — opens it">{recNode}</span></> : null}
      <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 700, color: "#B45309" }}>{(TERMS_KIND_LABEL as any)[f?.kind] || f?.kind}</span>
    </div>
    <div style={{ fontSize: 11.5, color: "#92400E", lineHeight: 1.45, marginTop: 3 }}>⚠ {f?.text}</div>
  </div>;
}

/** The findings on one record (a shipment, a sale, a purchase) — shown where the record is shown. */
export function TermsFindingsBox({ findings = [], here = "", onOpenShipment = null }: any) {
  if (!(findings || []).length) return null;
  return <div data-terms-box="1" style={{ border: "1px solid #FDE68A", background: "#FFFBEB", borderRadius: 8, overflow: "hidden" }} title="v7.20.0 (A-INC-2): flagged for review, never changed">
    <div style={{ padding: "7px 10px", fontSize: 11.5, fontWeight: 800, color: "#92400E" }}>⚠ Terms to review ({findings.length}) — the incoterms say otherwise. Nothing was changed: whoever reviews decides whether the term or the record is wrong.</div>
    {findings.map((f: any, i: number) => <TermsFindingLine key={i} f={f} here={here} onOpenShipment={onOpenShipment} />)}
  </div>;
}

/** The review list in the Shipments module — every finding, sales and purchases included; each line opens its record. */
export function TermsReviewList({ findings = [], onOpenShipment = null }: any) {
  if (!(findings || []).length) return <div data-terms-review="0" style={{ padding: 18, fontSize: 12.5, color: "#16A34A", fontWeight: 700 }}>Nothing disagrees with the incoterms.</div>;
  const records = new Set(findings.map((f: any) => f.record)).size;
  return <div data-terms-review="1" style={{ background: "#FFFBEB" }}>
    <div style={{ padding: "9px 12px", fontSize: 11.5, color: "#92400E", lineHeight: 1.45 }}>
      <strong>{findings.length} inconsistenc{findings.length === 1 ? "y" : "ies"} with the incoterms</strong> on {records} record{records === 1 ? "" : "s"} — each line names the term, the document and the record, and opens it. Nothing is changed until someone reviews it.
    </div>
    {findings.map((f: any, i: number) => <TermsFindingLine key={i} f={f} onOpenShipment={onOpenShipment} />)}
  </div>;
}
