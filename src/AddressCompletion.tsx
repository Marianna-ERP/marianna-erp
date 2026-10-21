// AddressCompletion.tsx — v7.28.10 (Batch L · FZ-03, owner 20 Oct "now"): THE COMPANY ADDRESSES TO COMPLETE, in the Directory until none
// is left. A company whose address is still only one line of text gets its street, postcode and city here — prefilled by splitting that
// line (marked when the split is uncertain), each to check and save; once its parts are complete, the one-line copy goes on save.
import React, { useMemo, useState } from "react";
import { parseAddress } from "./address.domain";
import { addressComplete, companyCountryName } from "./counterparty.domain";

const S = (v: any) => String(v ?? "").trim();

export function AddressCompletion({ companies = [], setCompanies = null }: any) {
  const todo = useMemo(() => (companies || []).filter((c: any) => c && !c.deleted && S(c.address) && !addressComplete(c)), [companies]);
  const [draft, setDraft] = useState<Record<string, any>>({});
  if (!todo.length || typeof setCompanies !== "function") return null;
  const partsOf = (c: any) => { const d = draft[S(c.id)]; if (d) return d; const p: any = parseAddress(c.address, companyCountryName(c)); const a = c.addr || {}; return { street: S(a.street) || S(p.street), postcode: S(a.postcode) || S(p.postcode), city: S(a.city) || S(p.city), check: !!p.needsCheck }; };
  const set = (c: any, k: string, v: string) => setDraft(d => ({ ...d, [S(c.id)]: { ...partsOf(c), [k]: v } }));
  const save = (c: any) => { const p = partsOf(c); setCompanies((prev: any[]) => (prev || []).map((x: any) => (x && S(x.id) === S(c.id)) ? { ...x, addr: { ...(x.addr || {}), street: S(p.street), postcode: S(p.postcode), city: S(p.city) } } : x)); setDraft(d => { const n = { ...d }; delete n[S(c.id)]; return n; }); };
  const inp: any = { padding: "5px 7px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 12, width: "100%", boxSizing: "border-box" };
  return (
    <div data-address-completion="1" style={{ margin: "8px 28px 0", border: "1px solid #FDE68A", background: "#FFFBEB", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>Company addresses to complete — {todo.length}</div>
      <div style={{ fontSize: 12, color: "#64748B", margin: "2px 0 8px" }}>These companies have their address as one line of text only. Check the street, postcode and city taken from it, then save; documents print the address from these parts.</div>
      {todo.map((c: any) => { const p = partsOf(c); const ok = S(p.street) && S(p.postcode) && S(p.city); return (
        <div key={S(c.id)} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1.3fr) 110px minmax(0, 1fr) auto", gap: 6, alignItems: "center", padding: "6px 0", borderTop: "1px solid #FEF3C7", fontSize: 12 }}>
          <div><b>{S(c.name)}</b><div style={{ color: "#64748B", fontSize: 11 }}>{S(c.address)}{p.check ? " · check the split" : ""}</div></div>
          <input style={inp} value={p.street} onChange={e => set(c, "street", e.target.value)} placeholder="Street and number" />
          <input style={inp} value={p.postcode} onChange={e => set(c, "postcode", e.target.value)} placeholder="Postcode" />
          <input style={inp} value={p.city} onChange={e => set(c, "city", e.target.value)} placeholder="City" />
          <button type="button" disabled={!ok} onClick={() => save(c)} style={{ fontSize: 12, padding: "5px 10px", borderRadius: 6, border: "1px solid #CBD5E1", background: ok ? "#111" : "#F3F4F6", color: ok ? "#fff" : "#9CA3AF", cursor: ok ? "pointer" : "default" }}>Save</button>
        </div>); })}
    </div>
  );
}
