import React, { useState } from "react";
import { ModulePage } from "./ui";
import { filterAudit } from "./auditTrail.domain";

// v6.40.0 — the AUDIT view: a read-only logbook of business events. Passive by
// design — recording and alerting are separate concerns; all guards/alerts live
// where they always did.
const MODULES = ["All", "Purchase orders", "Sales orders", "Shipments", "Inventory", "Invoices"];

export default function AuditTrail({ auditLog = [] }: any) {
  const [q, setQ] = useState("");
  const [mod, setMod] = useState("All");
  const rows = filterAudit(auditLog, { module: mod, q }).slice(0, 300);
  const fmt = (ts: string) => {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts || "—";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const actionColor = (a: string) =>
    a === "cancelled" ? "#DC2626" : a === "created" ? "#16A34A" : a === "status" ? "#0369A1"
    : a === "imported" || a === "allocated" ? "#7C3AED" : a === "claim" ? "#B45309" : "#64748B";
  const inp: any = { border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 12px", fontSize: 13, background: "#fff" };
  return (
    <ModulePage title="Audit trail" right={<span title="A passive logbook of business events (created · status · cancelled · allocated · imported · movements · claims). It records only; every alert and guard works as before. The oldest entries roll off past 5 000 events." style={{ fontSize: 11.5, color: "#94A3B8", cursor: "help" }}>{(auditLog || []).length.toLocaleString("pl-PL")} event(s) · records only ⓘ</span>}>   {/* v6.99.64 (A-HD-1): the module the header pass missed */}
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <input style={{ ...inp, flex: "1 1 240px", maxWidth: 340 }} value={q} onChange={e => setQ(e.target.value)} placeholder="Search document, user, text…" />
        <select style={inp} value={mod} onChange={e => setMod(e.target.value)}>{MODULES.map(m => <option key={m}>{m}</option>)}</select>
        <div style={{ alignSelf: "center", fontSize: 11.5, color: "#94A3B8" }}>{rows.length}{rows.length === 300 ? "+" : ""} of {(auditLog || []).length} events</div>
      </div>
      <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "130px 110px 150px 130px 110px 1fr", padding: "9px 16px", background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
          {["WHEN", "USER", "MODULE", "DOCUMENT", "ACTION", "WHAT HAPPENED"].map((h, i) => <div key={i} style={{ fontSize: 9.5, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em" }}>{h}</div>)}
        </div>
        {rows.map((e: any) => (
          <div key={`${e.id}-${e.ts}`} style={{ display: "grid", gridTemplateColumns: "130px 110px 150px 130px 110px 1fr", padding: "8px 16px", borderBottom: "1px solid #F8FAFC", fontSize: 12, alignItems: "center" }}>
            <div style={{ color: "#64748B", fontSize: 11.5 }}>{fmt(e.ts)}</div>
            <div style={{ fontWeight: 600 }}>{e.user || "—"}</div>
            <div style={{ color: "#64748B" }}>{e.module}</div>
            <div style={{ fontFamily: "ui-monospace, Menlo, monospace", color: "#2563EB" }}>{e.docNumber || "—"}</div>
            <div><span style={{ fontSize: 10, fontWeight: 700, color: actionColor(e.action) }}>{String(e.action || "").toUpperCase()}</span></div>
            <div style={{ color: "#475569" }}>{e.summary}</div>
          </div>
        ))}
        {rows.length === 0 && <div style={{ padding: 22, textAlign: "center", color: "#AAA", fontSize: 12.5 }}>No events yet — they appear here as you work (create, change status, cancel, allocate, import…).</div>}
      </div>
    </ModulePage>
  );
}
