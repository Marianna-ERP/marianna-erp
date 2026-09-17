// ── v6.99.37 (QA-1/QA-5, owner ruling 16 Sept): ONE QUALITY REPORT ──
// A document has one component. This is printed by the lot (Inventory) and by the truck settlement
// (Purchase Orders); neither draws its own version, so the two papers can never drift apart again.
import React from "react";
import { PrintLogo } from "./brand";
import { inspectionVerdict, samplePctOf } from "./seasonOps.domain";

const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : 0; };

export default function QualityReportDoc({ x, lot, no, supplierRef = "", inline = false }: any) {
  const v = inspectionVerdict(x);
  // v6.99.33 (owner): readable on paper — wide first columns that never wrap, centred figures, air between the sections.
  const cell = { border: "1px solid #999", padding: "4px 7px", fontSize: 11, textAlign: "center" } as any;
  const left = { ...cell, textAlign: "left", whiteSpace: "nowrap" } as any;
  const hd = { ...cell, background: "#F3F4F6", fontWeight: 700 } as any;
  const hdL = { ...left, background: "#F3F4F6", fontWeight: 700 } as any;
  const section = { fontWeight: 800, margin: "20px 0 6px", fontSize: 12.5, letterSpacing: "0.03em" } as any;
  const green = "#166534", red = "#B91C1C";
  return (
    <div id={`insp-print-${x.id}`} style={{ position: "absolute", left: -10000, top: 0, width: 780, background: "#fff", fontFamily: "Arial", fontSize: 12, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", borderBottom: "2px solid #111", paddingBottom: 10, marginBottom: 10 }}>
        <PrintLogo width={180} />
        <div style={{ marginLeft: "auto", textAlign: "right" }}><div style={{ fontSize: 15, fontWeight: 800 }}>QUALITY REPORT</div><div style={{ fontSize: 13, fontWeight: 800, fontFamily: "ui-monospace, Menlo, monospace" }}>{no || ""}</div></div>
      </div>
      <div style={{ textAlign: "center", margin: "22px 0 24px" }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>{lot.product}{lot.variety ? ` — ${lot.variety}` : ""}</div>
        {/* v6.99.34 (A-R24-7, owner): our reference and the supplier's, same type, side by side — the only link between the two vocabularies */}
        <div style={{ fontSize: 16, fontWeight: 800, marginTop: 6 }}>{lot.number}{supplierRef ? `  ·  supplier ref ${supplierRef}` : ""}</div>
      </div>

      <table style={{ borderCollapse: "collapse", width: "100%" }}><tbody>
        <tr><td style={hdL}>Date</td><td style={cell}>{x.date}</td><td style={hdL}>Location</td><td style={cell}>{x.stage}</td></tr>
        <tr><td style={hdL}>Inspector</td><td style={cell}>{x.inspector || "—"}</td><td style={hdL}>Temperature</td><td style={cell}>{x.temperature ?? "—"}</td></tr>
        <tr><td style={hdL}>Quantity delivered</td><td style={cell}>{num(x.orderedQty).toLocaleString("pl-PL")} {x.unit || "kg"}</td><td style={hdL}>Quantity checked</td><td style={cell}>{num(x.checkedQty).toLocaleString("pl-PL")} {x.unit || "kg"} ({samplePctOf(x)} %)</td></tr>
      </tbody></table>

      <div style={section}>EXTERNAL QUALITY</div>
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
        <colgroup><col style={{ width: "34%" }} /><col style={{ width: "18%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /></colgroup>
        <tbody>
          <tr><th style={hdL}>Check</th>{["Expected", "Max", "Avg", "Min", "Result"].map(h => <th key={h} style={hd}>{h}</th>)}</tr>
          {(x.externalChecks || []).map((c: any, i: number) => <tr key={i}><td style={left}>{c.name}</td>{[c.expected ?? "—", c.max ?? "—", c.avg ?? "—", c.min ?? "—", c.status || "Not checked"].map((val: any, k: number) => <td key={k} style={cell}>{val}</td>)}</tr>)}
        </tbody>
      </table>

      <div style={section}>DEFECTS</div>
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
        <colgroup><col style={{ width: "22%" }} /><col style={{ width: "58%" }} /><col style={{ width: "20%" }} /></colgroup>
        <tbody>
          <tr><th style={hdL}>Category</th><th style={hdL}>Defect</th><th style={hd}>% found</th></tr>
          {!(x.defects || []).length && <tr><td style={left} colSpan={3}>— none recorded —</td></tr>}
          {(x.defects || []).map((d: any, i: number) => <tr key={i}><td style={left}>{d.category}</td><td style={{ ...left, whiteSpace: "normal" }}>{d.name}</td><td style={cell}>{d.pct}</td></tr>)}
        </tbody>
      </table>

      <table style={{ borderCollapse: "collapse", marginTop: 14, width: "100%", tableLayout: "fixed" }}>
        <colgroup><col style={{ width: "34%" }} /><col style={{ width: "16%" }} /><col style={{ width: "16%" }} /><col style={{ width: "14%" }} /><col style={{ width: "20%" }} /></colgroup>
        <tbody>
          <tr><th style={hdL}>Category</th>{["Total %", "Tolerance %", "Net %", "Result"].map(h => <th key={h} style={hd}>{h}</th>)}</tr>
          {v.rows.map((r: any) => <tr key={r.category}>
            <td style={left}>{r.category} defects</td><td style={cell}>{r.pct}</td><td style={cell}>{r.tolerance}</td><td style={{ ...cell, fontWeight: 700 }}>{r.net}</td>
            <td style={{ ...cell, fontWeight: 800, color: r.acceptable ? green : red }}>{r.acceptable ? "Acceptable" : "Not acceptable"}</td>
          </tr>)}
          <tr style={{ background: "#F9FAFB" }}>
            <td style={{ ...left, fontWeight: 800 }}>Total quality report</td>
            <td style={{ ...cell, fontWeight: 800 }}>{v.totalPct}</td><td style={{ ...cell, fontWeight: 800 }}>{v.totalTolerance}</td><td style={{ ...cell, fontWeight: 800 }}>{v.totalNet}</td>
            <td style={{ ...cell, fontWeight: 800, color: v.acceptable ? green : red }}>{v.acceptable ? "Acceptable" : "Not acceptable"}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ margin: "22px 0 6px", fontSize: 12.5 }}>Verdict: <b>{x.verdict}</b>{x.observations ? ` · ${x.observations}` : ""}</div>
      <div style={{ margin: "6px 0 22px", fontSize: 13, fontWeight: 800, color: v.recommendation === "Reject" ? red : v.recommendation === "Sort" ? "#B45309" : green }}>
        Recommendation: {v.recommendation} <span style={{ fontWeight: 500, color: "#444", fontSize: 11.5 }}>— {v.advice}</span>
      </div>
      <div style={{ fontSize: 9.5, color: "#666", borderTop: "1px solid #DDD", paddingTop: 8 }}>Issued from MARIANNA ERP · {no || ""} · recorded in the audit trail.</div>
    </div>
  );
}

