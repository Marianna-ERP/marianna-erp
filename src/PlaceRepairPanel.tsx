// PlaceRepairPanel.tsx — v7.28.8 (FZ-36): the route places to repair, on the Shipments screen until none is left.
// The clear ones are filled in one click; every other one is picked once from any place. The panel disappears when the list is empty.
import React, { useMemo, useState } from "react";
import LocationPicker from "./LocationPicker";
import { locationById, counterpartyLocations } from "./locations";
import { placesToRepair, repairPlace } from "./placeRepair.domain";

export function PlaceRepairPanel({ shipments = [], setShipments = null, contacts = [], pos = [], orders = [] }: any) {
  const [picked, setPicked] = useState<Record<string, any>>({});
  const items = useMemo(() => placesToRepair(shipments || [], { known: (id: any) => !!locationById(id, contacts || []), pos, orders, contacts, sitesOf: (c: any) => counterpartyLocations([c]), nameOf: (id: any) => String((locationById(id, contacts || []) || {}).name || "") }), [shipments, contacts, pos, orders]);
  if (!items.length || typeof setShipments !== "function") return null;
  const clear = items.filter(i => i.fill); const open = items.filter(i => !i.fill);
  const apply = (list: Array<{ shipment: string; oldId: string; newId: any }>) => setShipments((prev: any[]) => (prev || []).map((sh: any) => {
    const mine = list.filter(x => String(x.shipment) === String(sh?.number)); return mine.reduce((acc: any, x) => repairPlace(acc, x.oldId, x.newId), sh);
  }));
  const key = (i: any) => `${i.shipment}|${i.oldId}`;
  return (
    <div data-place-repair="1" style={{ border: "1px solid #FDE68A", background: "#FFFBEB", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Route places to repair — {items.length} on {new Set(items.map(i => i.shipment)).size} shipment(s)</div>
        <div style={{ fontSize: 12, color: "#64748B", flex: 1 }}>These routes point at company addresses saved before the company numbers changed; each is repaired once.</div>
        {clear.length > 0 && <button type="button" onClick={() => apply(clear.map(i => ({ shipment: i.shipment, oldId: i.oldId, newId: i.fill!.id })))} style={{ fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "none", background: "#111", color: "#fff", cursor: "pointer" }}>Fill the {clear.length} clear one(s)</button>}
      </div>
      {clear.map(i => <div key={key(i)} style={{ fontSize: 12, padding: "6px 0", borderTop: "1px solid #FEF3C7" }}><b>{i.shipment}</b> · {i.where.join(", ")} → <b>{i.fill!.name}</b> <span style={{ color: "#64748B" }}>({i.fill!.why})</span></div>)}
      {open.map(i => <div key={key(i)} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 260px auto", gap: 8, alignItems: "center", fontSize: 12, padding: "6px 0", borderTop: "1px solid #FEF3C7" }}>
        <div><b>{i.shipment}</b> · {i.where.join(", ")} <span style={{ color: "#92400E" }}>— pick the place</span></div>
        <LocationPicker value={picked[key(i)] ?? ""} onChange={(v: any) => setPicked(p => ({ ...p, [key(i)]: v }))} contacts={contacts} />
        <button type="button" disabled={picked[key(i)] == null || picked[key(i)] === ""} onClick={() => apply([{ shipment: i.shipment, oldId: i.oldId, newId: picked[key(i)] }])} style={{ fontSize: 12, padding: "6px 10px", borderRadius: 6, border: "1px solid #CBD5E1", background: "#fff", cursor: "pointer" }}>Use</button>
      </div>)}
    </div>
  );
}
