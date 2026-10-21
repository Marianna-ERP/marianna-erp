// JourneyProposalCard.tsx — v7.29.0 (SC-15): the proposed journey in the new-shipment window. Every leg can be changed — its mode,
// where it starts, where it ends — removed, or added to; a port the rules need but do not name is marked to pick. "Use this journey"
// is ticked by default; unticked, the shipment is built as before.
import React from "react";
import LocationPicker from "./LocationPicker";
import { placeIdOf } from "./journeyProposal.domain";   // v7.30.10

const MODES = ["Road", "Sea", "Air", "Rail"];

export function JourneyProposalCard({ legs = [], setLegs, note = "", use = true, setUse, contacts = [] }: any) {
  const upd = (i: number, k: string, v: any) => setLegs((prev: any[]) => prev.map((l: any, j: number) => j === i ? { ...l, [k]: v, ...(k === "fromLocationId" ? { pickFrom: false } : k === "toLocationId" ? { pickTo: false } : {}) } : l));
  const sel: any = { padding: "5px 7px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 12, background: "#fff" };
  return (
    <div data-journey-proposal="1" style={{ gridColumn: "1 / 3", border: "1px solid #DBEAFE", background: "#F8FAFF", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Proposed journey — from the PO's and the SO's rules</div>
        <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }}><input type="checkbox" checked={!!use} onChange={e => setUse(e.target.checked)} /> Use this journey</label>
      </div>
      {note && <div style={{ fontSize: 12, color: "#475569", marginTop: 6 }}>{note}</div>}
      {legs.map((l: any, i: number) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "84px minmax(0, 1fr) minmax(0, 1fr) auto", gap: 6, alignItems: "center", padding: "6px 0", borderTop: "1px solid #E0E7FF", fontSize: 12, opacity: use ? 1 : 0.55 }}>
          <select style={sel} value={l.mode} onChange={e => upd(i, "mode", e.target.value)}>{MODES.map(m => <option key={m}>{m}</option>)}</select>
          <div><LocationPicker value={l.fromLocationId ?? ""} onChange={(v: any) => upd(i, "fromLocationId", placeIdOf(v))} contacts={contacts} />{l.pickFrom && <div style={{ fontSize: 11, color: "#B45309", marginTop: 2 }}>pick where this leg starts</div>}</div>
          <div><LocationPicker value={l.toLocationId ?? ""} onChange={(v: any) => upd(i, "toLocationId", placeIdOf(v))} contacts={contacts} />{l.pickTo && <div style={{ fontSize: 11, color: "#B45309", marginTop: 2 }}>pick where this leg ends</div>}</div>
          <button type="button" onClick={() => setLegs((prev: any[]) => prev.filter((_: any, j: number) => j !== i))} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer" }} title="Remove this leg">×</button>
          <div style={{ gridColumn: "1 / 5", fontSize: 11, color: "#64748B" }}>{l.why}</div>
        </div>
      ))}
      <button type="button" onClick={() => setLegs((prev: any[]) => [...prev, { mode: "Road", fromLocationId: (prev[prev.length - 1] || {}).toLocationId ?? null, toLocationId: null, why: "added by hand", pickTo: true }])} style={{ marginTop: 6, fontSize: 12, padding: "5px 10px", borderRadius: 6, border: "1px solid #CBD5E1", background: "#fff", cursor: "pointer" }}>+ Add a leg</button>
    </div>
  );
}
