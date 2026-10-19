// CompanyPicker.tsx — v7.27.15 (A-RV-26 · A-AU-8, owner approved 17 Oct; P-8 / A-RV-13): ONE WAY TO NAME A COMPANY ON A RECORD.
// A claim's respondent, an operational cost's payee and a finance note's party are picked from Counterparties and stored by id
// (with the name copied for reading). A record that still carries only a typed name shows it as "typed, not linked": one pick links
// it. When the company is not in the directory yet, "Add to the directory" creates it with that name in one click — no extra work
// compared with typing it.
import React from "react";
import { S } from "./format";

const roleOf = (c: any): string[] => [c?.type, ...(Array.isArray(c?.roles) ? c.roles : [])].filter(Boolean).map((r: any) => String(r));

export function CompanyPicker({ contacts = [], value = null, typedName = "", roles = null, onPick, onAdd = null, disabled = false, style = {} }: any) {
  const id = value != null && value !== "" ? String(value) : "";
  const list = (contacts || []).filter((c: any) => c && (String(c.id) === id || (!c.deleted && !c.archived && (!roles || roleOf(c).some(r => roles.includes(r))))))
    .slice().sort((a: any, b: any) => S(a.name).localeCompare(S(b.name), "pl"));
  const typed = S(typedName);
  const exact = typed ? (contacts || []).some((c: any) => c && !c.deleted && S(c.name).toLowerCase() === typed.toLowerCase()) : false;
  const pick = (v: string) => { const c = (contacts || []).find((x: any) => String(x.id) === v) || null; onPick && onPick(c); };
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <select disabled={disabled} value={id} onChange={e => pick(e.target.value)} style={{ minWidth: 220, padding: "6px 8px", border: `1px solid ${!id && typed ? "#F59E0B" : "#E5E7EB"}`, borderRadius: 6, fontSize: 13, background: "#fff", ...style }}>
        <option value="">{!id && typed ? `"${typed}" — typed, not linked: pick its company` : "— pick a company —"}</option>
        {list.map((c: any) => <option key={String(c.id)} value={String(c.id)}>{S(c.name)}{c.deleted ? " (deleted)" : c.archived ? " (archived)" : ""}</option>)}
      </select>
      {!id && typed && !exact && typeof onAdd === "function" && !disabled && (
        <button type="button" onClick={() => { const c = onAdd(typed); if (c) onPick && onPick(c); }} style={{ fontSize: 12, padding: "6px 10px", borderRadius: 6, border: "1px solid #CBD5E1", background: "#fff", cursor: "pointer" }} title="Creates the company in Counterparties with this name, and links it">
          + Add "{typed}" to the directory
        </button>
      )}
    </div>
  );
}

/** A company the picker adds: the minimal record Counterparties holds, with the role the place it was added from asks for. */
export function newCompanyRecord(name: string, role: string, nextId: () => any): any {
  return { id: nextId(), name: S(name), type: role, roles: [role], country: "", nip: "", addr: {}, people: [], contacts: [], terms: {} };
}
