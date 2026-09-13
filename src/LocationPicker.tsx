// ── v6.99.10: ONE location picker for the whole system — grouped by kind, alphabetical, from unifiedLocations().
// Counterparties answer "who"; locations answer "where". A counterparty's addresses ARE locations (sites), so there is
// one list: ports · port warehouses / customs points · our warehouses · supplier sites · client sites · other.
import React from "react";
import { unifiedLocations } from "./locations";

const KIND_LABEL: Record<string, string> = { PORT: "Ports", PORT_WAREHOUSE: "Port warehouses / customs", CUSTOMS: "Port warehouses / customs", OWN: "Our warehouses", WAREHOUSE: "Warehouses (counterparty)", SUPPLIER: "Supplier sites", CLIENT: "Client sites", BROKER: "Brokers / agents", OTHER: "Other" };
const ORDER = ["PORT", "PORT_WAREHOUSE", "CUSTOMS", "OWN", "WAREHOUSE", "SUPPLIER", "CLIENT", "BROKER", "OTHER"];

export default function LocationPicker({ value, onChange, contacts = [], kinds = null, preferredKinds = null, placeholder = "— location —", disabled = false, style = {}, title = "" }: any) {
  const all = unifiedLocations(contacts || []).filter((l: any) => !kinds || kinds.includes(String(l.legacyType || l.type || "OTHER").toUpperCase()));
  const groups: Record<string, any[]> = {};
  all.forEach((l: any) => { const k = String(l.legacyType || l.type || "OTHER").toUpperCase(); (groups[k] = groups[k] || []).push(l); });
  const pref = (preferredKinds || []).map((k: string) => String(k).toUpperCase());
  const rank = (k: string) => (pref.includes(k) ? pref.indexOf(k) - 100 : (ORDER.indexOf(k) < 0 ? 99 : ORDER.indexOf(k)));
  const keys = Object.keys(groups).sort((a, b) => rank(a) - rank(b));
  const current = all.find((l: any) => String(l.id) === String(value)) || all.find((l: any) => String(l.name) === String(value)) || null;
  return (
    <select value={current ? String(current.id) : ""} disabled={disabled} title={title}
      onChange={e => { if (e.target.value === "__add__") { window.dispatchEvent(new CustomEvent("marianna:navigate", { detail: { module: "contacts", tab: kinds && kinds.every((k: string) => ["PORT", "CUSTOMS", "BORDER"].includes(k)) ? "ports" : "companies" } })); return; } const hit = all.find((l: any) => String(l.id) === e.target.value) || null; onChange && onChange(hit ? { id: hit.id, name: hit.name, location: hit } : { id: null, name: "", location: null }); }}
      style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 7, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: disabled ? "#F9FAFB" : "#fff", boxSizing: "border-box", ...style }}>
      <option value="">{placeholder}</option>
      {!current && value ? <option value="">(typed: {String(value)})</option> : null}
      <option value="__add__">＋ Not in the list? Add it in the Directory…</option>
      {keys.map(k => <optgroup key={k} label={(pref.includes(k) ? "★ " : "") + (KIND_LABEL[k] || k)}>{groups[k].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), "pl")).map((l: any) => <option key={String(l.id)} value={String(l.id)}>{l.name}{l.country ? ` · ${l.country}` : ""}</option>)}</optgroup>)}
    </select>
  );
}
