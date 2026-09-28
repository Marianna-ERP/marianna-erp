// ─── v6.99.72 (A-CU-3, owner 28 Sept): IMPORT CUSTOMS FILES — one place for everything the agent sends ─────────────
// The agent's two emails (release CC529C, exit confirmation CC599C) and their SAD copy are dropped here together. Each
// file shows what it is, its facts, and the shipment and truck it belongs to, with the reason. Exact (an MRN already on a
// line, or plates + the invoice) is pre-selected; anything else the user chooses from the candidates or leaves. Nothing is
// attached on a guess. The rules of the clearance line are untouched: one line per truck, filled from the file, cross-checked.
import React, { useState } from "react";
import { SmallButton } from "./ui";
import { recordAudit } from "./audit";
import { CUSTOMS_FILE_LABEL } from "./customsClearance.domain";
import { ImportRow, planImport, applyImport, withChoice, homeKey, homeLabel } from "./customsImport.domain";

const KIND_COLOR: Record<string, string> = { CC529C: "#0F766E", CC599C: "#1D4ED8", SAD: "#6B7280", unknown: "#DC2626" };

export function CustomsImportView({ rows, setRows, onAttach, onClose, onFiles, result }: any) {
  const chosen = rows.filter((r: ImportRow) => r.choice).length;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: 860, maxWidth: "94vw", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #EBEBEB", display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>Import customs files</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>Drop everything the agent sent — release (CC529C), exit confirmation (CC599C), SAD copy. Each file finds its truck; you confirm the rest.</div>
          </div>
          <div style={{ marginLeft: "auto" }}><SmallButton kind="close" onClick={onClose}>Close</SmallButton></div>
        </div>
        <div style={{ padding: 22, overflowY: "auto", flex: 1 }}>
          {!result && (
            <label onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onFiles(Array.from(e.dataTransfer.files || [])); }}
              style={{ display: "block", border: "2px dashed #CBD5E1", borderRadius: 10, padding: "18px 16px", textAlign: "center", color: "#475569", fontSize: 12.5, cursor: "pointer", marginBottom: 16, background: "#F8FAFC" }}>
              Drop the agent's .xml files here, or click to choose (several at once)
              <input type="file" accept=".xml,.XML" multiple style={{ display: "none" }} onChange={e => onFiles(Array.from(e.target.files || []))} />
            </label>
          )}
          {rows.map((r: ImportRow, i: number) => {
            const p = r.parsed; const s = r.search; const options = (s.exact ? [s.exact] : []).concat(s.candidates);
            return (
              <div key={i} style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: "12px 14px", marginBottom: 10, background: r.done ? "#F0FDF4" : "#fff" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.04em", color: "#fff", background: KIND_COLOR[p.kind] || "#6B7280", borderRadius: 6, padding: "2px 8px", fontFamily: "ui-monospace, Menlo, monospace" }}>{p.kind === "unknown" ? "?" : p.kind}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{CUSTOMS_FILE_LABEL[p.kind]}</span>
                  <span style={{ fontSize: 11.5, color: "#888", fontFamily: "ui-monospace, Menlo, monospace" }}>{r.name}</span>
                </div>
                {p.ok && (
                  <div style={{ fontSize: 12, color: "#444", marginTop: 6, lineHeight: 1.6 }}>
                    {p.mrn && <span>MRN <strong>{p.mrn}</strong> · </span>}
                    {p.plates && <span>truck <strong>{p.plates}</strong> · </span>}
                    {p.invoiceRef && <span>invoice <strong>{p.invoiceRef}</strong> · </span>}
                    {p.netKg ? <span>{Math.round(p.netKg).toLocaleString("pl-PL")} kg net · </span> : null}
                    {p.consignee && <span>to {p.consignee} · </span>}
                    {p.kind === "CC599C" ? <span>left the EU <strong>{p.exitedOn || "?"}</strong>{p.exitOffice ? ` at ${p.exitOffice}` : ""}</span> : p.releasedOn ? <span>released {p.releasedOn}</span> : p.declaredOn ? <span>declared {p.declaredOn}</span> : null}
                  </div>
                )}
                {r.done ? (
                  <div style={{ marginTop: 8, fontSize: 12.5, color: "#166534", fontWeight: 600 }}>✓ Attached to {r.done}</div>
                ) : !p.ok ? (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#B91C1C" }}>{s.reason}</div>
                ) : (
                  <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "start" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: s.exact ? "#166534" : options.length ? "#92400E" : "#B91C1C", paddingTop: 6, whiteSpace: "nowrap" }}>{s.exact ? "Belongs to" : options.length ? "Confirm" : "Not placed"}</div>
                    <div>
                      {options.length ? (
                        <select value={r.choice} onChange={e => setRows((prev: ImportRow[]) => withChoice(prev, i, e.target.value))}
                          style={{ width: "100%", border: `1px solid ${s.exact ? "#86EFAC" : "#FCD34D"}`, borderRadius: 7, padding: "6px 9px", fontSize: 12.5, background: "#fff", fontFamily: "inherit" }}>
                          {!s.exact && <option value="">— leave this file out —</option>}
                          {options.map(h => <option key={homeKey(h)} value={homeKey(h)}>{homeLabel(h)}{h.confidence === "exact" ? " (exact)" : ""}</option>)}
                        </select>
                      ) : <div style={{ fontSize: 12, color: "#B91C1C", paddingTop: 6 }}>{s.reason}</div>}
                      {options.length > 0 && (() => { const h = options.find(o => homeKey(o) === r.choice) || options[0]; return (
                        <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>{s.exact ? "" : s.reason + " — "}{h.reasons.join(" · ")}</div>
                      ); })()}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {result && <div style={{ marginTop: 6, fontSize: 12.5, color: "#166534", fontWeight: 600 }}>{result}</div>}
        </div>
        <div style={{ padding: "12px 22px", borderTop: "1px solid #EBEBEB", display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          {!result && rows.length > 0 && <span style={{ fontSize: 12, color: "#666", marginRight: "auto" }}>{chosen} of {rows.length} file(s) will be attached</span>}
          {!result && rows.length > 0 && <SmallButton onClick={() => setRows([])}>Clear</SmallButton>}
          {!result && <SmallButton kind="confirm" disabled={!chosen} onClick={onAttach}>{chosen ? `Attach ${chosen} file${chosen === 1 ? "" : "s"}` : "Attach"}</SmallButton>}
          {result && <SmallButton kind="close" onClick={onClose}>Close</SmallButton>}
        </div>
      </div>
    </div>
  );
}

export default function CustomsImportModal({ shipments, setShipments, invoices = [], onClose }: any) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [result, setResult] = useState<string>("");
  const onFiles = (files: File[]) => {
    Promise.all(files.map(f => new Promise<{ name: string; text: string }>(res => { const rd = new FileReader(); rd.onload = () => res({ name: f.name, text: String(rd.result || "") }); rd.onerror = () => res({ name: f.name, text: "" }); rd.readAsText(f); })))
      .then(list => setRows(prev => prev.concat(planImport(list, shipments || [], invoices || []))));
  };
  const onAttach = () => {
    const r = applyImport(rows, shipments || []);
    setShipments(r.shipments);
    r.done.forEach(d => { const row = rows.find(x => x.name === d.name); recordAudit({ module: "Shipments", docType: "Shipment", docNumber: d.where.split(" · ")[0], action: "updated", summary: `${row ? CUSTOMS_FILE_LABEL[row.parsed.kind] : "Customs file"} ${row?.parsed.mrn || ""} attached from ${d.name} (${d.where})` }); });
    setRows(prev => prev.map(x => { const d = r.done.find(y => y.name === x.name); return d ? { ...x, done: d.where } : x; }));
    setResult(`${r.done.length} file(s) attached. Open the shipment to see the line; the register carries the documents.`);
  };
  return <CustomsImportView rows={rows} setRows={setRows} onAttach={onAttach} onClose={onClose} onFiles={onFiles} result={result} />;
}
