import React, { useMemo, useState } from "react";
import { checkIntegrity, IntegrityInputs, IntegrityIssue } from "./integrityCheck";

// A small always-visible badge that runs the pure integrity checker over current
// app state and summarises problems. Click to open a panel listing each issue.
// Read-only: it reports, it never mutates state.

const SEV_COLOR: Record<string, string> = { error: "#DC2626", warning: "#D97706", info: "#64748B" };
const SEV_BG: Record<string, string> = { error: "#FEF2F2", warning: "#FFF7ED", info: "#F1F5F9" };

export default function IntegrityBadge({ data, onNavigate }: { data: IntegrityInputs; onNavigate?: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const result = useMemo(() => checkIntegrity(data), [data]);
  const { counts, issues } = result;

  const hasError = counts.error > 0;
  const hasWarn = counts.warning > 0;
  const tone = hasError ? "error" : hasWarn ? "warning" : "info";
  const clean = counts.total === 0;

  const moduleKey = (m: string) => {
    const s = m.toLowerCase();
    if (s.includes("inventory")) return "lots";
    if (s.includes("sales")) return "orders";
    if (s.includes("purchase")) return "pos";
    if (s.includes("shipment")) return "shipments";
    if (s.includes("finance") || s.includes("warehouse")) return "finance";
    if (s.includes("counterpart") || s.includes("contact")) return "contacts";
    return null;
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Data integrity check"
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "3px 10px", borderRadius: 11, cursor: "pointer",
          border: `1px solid ${clean ? "#D1FAE5" : tone === "error" ? "#FECACA" : "#FED7AA"}`,
          background: clean ? "#ECFDF5" : SEV_BG[tone],
          color: clean ? "#047857" : SEV_COLOR[tone],
          fontSize: 11, fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap",
        }}>
        <span style={{ fontSize: 12 }}>{clean ? "✓" : tone === "error" ? "⚠" : "⚠"}</span>
        {clean ? "Data OK" : `${counts.total} data issue${counts.total === 1 ? "" : "s"}`}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 80 }} />
          <div style={{
            position: "absolute", right: 0, top: 32, zIndex: 81,
            width: 420, maxHeight: 460, overflow: "auto",
            background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12,
            boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
          }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: 13 }}>Data integrity</strong>
              <span style={{ fontSize: 11, color: "#888" }}>
                {counts.error} error{counts.error === 1 ? "" : "s"} · {counts.warning} warning{counts.warning === 1 ? "" : "s"} · {counts.info} info
              </span>
            </div>
            {clean ? (
              <div style={{ padding: "20px 16px", fontSize: 12.5, color: "#047857" }}>
                ✓ No structural problems found. References resolve, no lot is oversold, and settlements look consistent.
              </div>
            ) : (
              <div style={{ padding: "6px 0" }}>
                {issues.map((iss: IntegrityIssue, i: number) => {
                  const key = moduleKey(iss.module);
                  return (
                    <div key={i} style={{ padding: "9px 16px", borderBottom: i < issues.length - 1 ? "1px solid #F7F7F7" : "none", display: "flex", gap: 10 }}>
                      <span style={{ color: SEV_COLOR[iss.severity], fontSize: 13, lineHeight: "16px" }}>{iss.severity === "error" ? "●" : iss.severity === "warning" ? "▲" : "○"}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12.5, color: "#111", lineHeight: 1.4 }}>{iss.message}</div>
                        <div style={{ fontSize: 10.5, color: "#9CA3AF", marginTop: 3, display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{iss.entity}</span>
                          <span>·</span>
                          {key && onNavigate
                            ? <button onClick={() => { onNavigate(key); setOpen(false); }} style={{ border: "none", background: "none", color: "#2563EB", cursor: "pointer", fontSize: 10.5, padding: 0, fontFamily: "inherit" }}>Go to {iss.module} →</button>
                            : <span>{iss.module}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ padding: "10px 16px", borderTop: "1px solid #F3F4F6", fontSize: 10.5, color: "#9CA3AF", lineHeight: 1.5 }}>
              This check is read-only — it never changes your data. It flags structural problems (broken references, oversold lots, double-counted settlements) that can distort figures. Fix them in the linked module.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
