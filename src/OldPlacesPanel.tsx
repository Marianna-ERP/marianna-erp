// OldPlacesPanel.tsx — v7.32.0 (FZ-04a, owner 26 Oct): "OLD PLACES TO REPLACE", at the top of Parties › Locations while any remain.
// Each old company-like entry of the places store is shown with the records that use it; the owner picks the address that replaces it
// (a company's address from Parties, or a public place), clicks "Replace everywhere" — every field in every record is changed, the audit
// trail records it, the entry is deleted. An entry used nowhere is simply deleted.
import React, { useMemo, useState } from "react";
import LocationPicker from "./LocationPicker";
import { readCustomLocations, removeCustomLocation, locationById } from "./locations";
import { oldPlacesToReplace, replacePlaceEverywhere } from "./placeReplace.domain";
import { recordAudit } from "./audit";

export function OldPlacesPanel({ contacts = [], pos = [], orders = [], lots = [], shipments = [], setPOs = null, setOrders = null, setLots = null, setShipments = null, onDone = null }: any) {
  const [pick, setPick] = useState<Record<string, any>>({}); const [tick, setTick] = useState(0);
  const items = useMemo(() => oldPlacesToReplace({ pos, orders, lots, shipments }, readCustomLocations()), [pos, orders, lots, shipments, tick]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return null;
  const canWrite = typeof setPOs === "function" && typeof setOrders === "function" && typeof setLots === "function" && typeof setShipments === "function";
  const uses = (u: any) => [["POs", u.pos], ["SOs", u.orders], ["lots", u.lots], ["shipments", u.shipments]].filter(([, v]: any) => v.length).map(([k, v]: any) => `${v.length} ${k} (${v.slice(0, 4).join(", ")}${v.length > 4 ? ", …" : ""})`).join(" · ");
  const replace = (it: any) => {
    const to = pick[String(it.place.id)]; if (to == null || !canWrite) return;
    const target = locationById(to, contacts); const res = replacePlaceEverywhere({ pos, orders, lots, shipments }, it.place.id, to);
    if (res.changed.some(c => c.store === "pos")) setPOs(() => res.pos); if (res.changed.some(c => c.store === "orders")) setOrders(() => res.orders);
    if (res.changed.some(c => c.store === "lots")) setLots(() => res.lots); if (res.changed.some(c => c.store === "shipments")) setShipments(() => res.shipments);
    res.changed.forEach(c => recordAudit({ module: "Parties", docType: c.store === "pos" ? "PO" : c.store === "orders" ? "SO" : c.store === "lots" ? "Lot" : "Shipment", docNumber: c.number, action: "place replaced", summary: `${it.place.name} → ${target ? target.name : to} (${c.fields} field${c.fields > 1 ? "s" : ""})` }));
    removeCustomLocation(Number(it.place.id)); setTick(x => x + 1); if (onDone) onDone();
  };
  const drop = (it: any) => { removeCustomLocation(Number(it.place.id)); recordAudit({ module: "Parties", docType: "Locations", docNumber: String(it.place.id), action: "deleted", summary: `${it.place.name} — an old entry used nowhere` }); setTick(x => x + 1); if (onDone) onDone(); };
  return (
    <div data-old-places="1" style={{ border: "1px solid #FDE68A", background: "#FFFBEB", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>Old places to replace — {items.length}</div>
      <div style={{ fontSize: 11, color: "#92400E", marginBottom: 6 }}>These entries are not public places: they are company addresses the first version created itself. Pick the address from Parties that replaces each one; every record that uses it is updated, then the entry is deleted.</div>
      {items.map((it: any) => (
        <div key={it.place.id} data-old-place={it.place.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr) auto", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px solid #FDE68A", fontSize: 12 }}>
          <div><b>{it.place.name}</b> <span style={{ color: "#64748B" }}>· {it.place.type}{it.place.address ? ` · ${it.place.address}` : ""}</span><div style={{ fontSize: 11, color: "#475569" }}>{it.total ? `used by ${uses(it.uses)}` : "used nowhere"}</div></div>
          {it.total ? <LocationPicker value={pick[String(it.place.id)] ?? ""} contacts={contacts} placeholder="— the address that replaces it —" onChange={(r: any) => setPick(p => ({ ...p, [String(it.place.id)]: r && r.id != null ? r.id : null }))} /> : <span />}
          {it.total
            ? <button type="button" disabled={!canWrite || pick[String(it.place.id)] == null} onClick={() => replace(it)} style={{ fontSize: 12, fontWeight: 700, padding: "6px 10px", borderRadius: 7, border: "1px solid #CA8A04", background: "#fff", color: "#92400E", cursor: "pointer" }}>Replace everywhere</button>
            : <button type="button" onClick={() => drop(it)} style={{ fontSize: 12, padding: "6px 10px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer" }}>Delete</button>}
        </div>
      ))}
    </div>
  );
}
