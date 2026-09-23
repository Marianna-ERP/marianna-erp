import React, { useMemo, useState } from "react";
import { orphanLotsToRemove, danglingLinks, checkIntegrity, IntegrityInputs, IntegrityIssue } from "./integrityCheck";

// A small always-visible badge that runs the pure integrity checker over current
// app state and summarises problems. Click to open a panel listing each issue.
// Read-only: it reports, it never mutates state.

const SEV_COLOR: Record<string, string> = { error: "#DC2626", warning: "#D97706", info: "#64748B" };
const SEV_BG: Record<string, string> = { error: "#FEF2F2", warning: "#FFF7ED", info: "#F1F5F9" };

export default function IntegrityBadge({ data, onNavigate, onRepair }: { data: IntegrityInputs; onNavigate?: (m: string) => void; onRepair?: (kind: "orphanLots" | "danglingLinks") => void }) {
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
        title={clean ? "Data integrity check — click for details" : "Click to see which records have problems"}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "3px 10px", borderRadius: 11, cursor: "pointer",
          border: `1px solid ${clean ? "#D1FAE5" : tone === "error" ? "#FECACA" : "#FED7AA"}`,
          background: clean ? "#ECFDF5" : SEV_BG[tone],
          color: clean ? "#047857" : SEV_COLOR[tone],
          fontSize: 11, fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap",
        }}>
        <span style={{ fontSize: 12 }}>{clean ? "✓" : "⚠"}</span>
        {clean ? "Data OK" : `${counts.total} data issue${counts.total === 1 ? "" : "s"}`}
        <span style={{ fontSize: 9, opacity: 0.7, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.12s" }}>▾</span>
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 80 }} />
          <div style={{
            position: "fixed", right: 16, top: 52, zIndex: 81,
            width: 420, maxWidth: "calc(100vw - 32px)", maxHeight: "70vh", overflow: "auto",
            background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12,
            boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
          }}>
            {/* v6.99.51 (A-FS-2, owner): repairs for the leftovers of a season reset done by hand */}
            {onRepair && (() => { const ol = orphanLotsToRemove((data as any).lots || [], (data as any).pos || []); const dl = danglingLinks((data as any).invoices || [], (data as any).claims || [], (data as any).pos || [], (data as any).orders || [], (data as any).shipments || []);
              if (!ol.length && !dl.invoices.length && !dl.claims.length) return null;
              return <div style={{ padding: "10px 14px", background: "#FFFBEB", borderBottom: "1px solid #FDE68A", display: "grid", gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#92400E" }}>REPAIRS — leftovers of documents deleted by hand</div>
                {ol.length > 0 && <button onClick={() => onRepair("orphanLots")} style={{ textAlign: "left", fontSize: 11.5, border: "1px solid #FDE68A", background: "#fff", borderRadius: 7, padding: "6px 9px", cursor: "pointer" }}>🧹 Remove {ol.length} orphan lot(s) — their PO no longer exists and they hold no stock: {ol.slice(0, 4).map((l: any) => l.number).join(", ")}{ol.length > 4 ? "…" : ""}</button>}
                {(dl.invoices.length > 0 || dl.claims.length > 0) && <button onClick={() => onRepair("danglingLinks")} style={{ textAlign: "left", fontSize: 11.5, border: "1px solid #FDE68A", background: "#fff", borderRadius: 7, padding: "6px 9px", cursor: "pointer" }}>🔗 Unlink {dl.invoices.length} invoice(s) and {dl.claims.length} claim(s) from documents that no longer exist</button>}
              </div>; })()}
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
