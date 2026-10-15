// ShipmentDetail.tsx — the shipment's own page.
// v7.23.5 (A-SHV-1, owner approved 13 Oct after four rounds of the mock): the shipment opens as a full page, like a PO or an SO —
// a header with the facts you check first and every action; the steps left to close it; the route and the goods open; the long
// sections folded to one summary line until opened. Same data, same editor, same printed documents.
import { documentRegister, shipmentDates, containerMap } from "./shipmentModel.domain";
import React, { useState } from "react";
import { customsGaps, customsComplete, customsSummary, customsApplies } from "./customs.domain";
import { SmallButton, DocRef, cancelledDocSet } from "./ui";
import { carriedRefs, nextShipmentAction, canonicalStatus } from "./shipments.domain";
import { inspectLink, summariseDocs } from "./docLinks.domain";
import { formatDMY } from "./dates";
import { lotStockCheck } from "./receipts.domain";
import { protocolsForShipment, assignmentCheck } from "./loadingProtocol.domain";
import { shipmentWarnings } from "./moduleGuards.domain";
import { BillingBadge, Card, countryOfLocation, ChecklistLine, ForwarderReports, ModeBadge, StatusBadge, costTypeLabel, fmtMoney, fmtNum, legDisplayStatus, locationTextFromFields, parseNum, providerById, providerIdsForShipment, providerName, roadTruckCount, shipmentCostPLN, shipmentKg, transportUnitsForLeg } from "./Shipments";
import { TransportOrdersCard } from "./ShipmentDocuments";
import { shipmentTradeDirection } from "./tradeFlow.domain";   // v7.12.1 (A-TD-2)
import { TermsFindingsBox } from "./TermsReview";   // v7.20.0 (A-INC-2)
import { soClientName } from "./salesOrders.domain";
import DateInput from "./DateInput";
import { localTodayISO } from "./dates";

const S = (v: any) => String(v ?? "").trim();
const head: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#94A3B8", letterSpacing: ".06em", textTransform: "uppercase" };
const thL: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 600, color: "#94A3B8", padding: "6px 8px", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap" };
const tdL: React.CSSProperties = { textAlign: "left", fontSize: 12, padding: "7px 8px", borderBottom: "1px solid #F1F5F9", verticalAlign: "top" };
const day = (actual: any, planned: any) => S(actual) ? <span>{formatDMY(S(actual).slice(0, 10))}</span> : S(planned) ? <span style={{ color: "#94A3B8" }}>{formatDMY(S(planned).slice(0, 10))} (planned)</span> : <span style={{ color: "#CBD5E1" }}>—</span>;

/** A section folded to one line until opened (v7.23.5). */
function Fold({ title, summary, open, onToggle, children }: any) {
  return <Card style={{ padding: 0 }}>
    <button type="button" onClick={onToggle} aria-expanded={open} style={{ all: "unset", boxSizing: "border-box", width: "100%", display: "grid", gridTemplateColumns: "14px 180px 1fr", gap: 10, alignItems: "center", padding: "12px 16px", cursor: "pointer" }}>
      <span style={{ color: "#94A3B8", fontSize: 11, transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" }}>▶</span>
      <span style={head}>{title}</span>
      <span style={{ fontSize: 13, color: "#64748B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", visibility: open ? "hidden" : "visible" }}>{summary}</span>
    </button>
    {open && <div style={{ padding: "0 16px 14px" }}>{children}</div>}
  </Card>;
}

/** v7.23.6 (A-SHV-1, owner 13 Oct): who a shipment is for — the clients of the sales it carries (by id, else by name). */
function clientKeys(sh: any, orders: any[]): string[] {
  return carriedRefs(sh).soRefs.map((r: string) => { const o: any = (orders || []).find((x: any) => S(x.number) === S(r)); return o ? S(o.client?.id ?? o.clientId ?? soClientName(o)) : ""; }).filter(Boolean);
}
/** v7.23.6: one DHL envelope can carry the originals of several shipments of the same client — they are listed, ticked, saved together. */
function OriginalsWindow({ shipment, orders, allShipments, onSave, onClose }: any) {
  const mine = clientKeys(shipment, orders);
  const others = (allShipments || []).filter((s: any) => s && S(s.number) !== S(shipment.number) && canonicalStatus(s.status) !== "Cancelled" && !S(s.docsCourierTrackingNo) && !S(s.docsCourierDate) && clientKeys(s, orders).some(k => mine.includes(k)));
  const [dhl, setDhl] = useState(S(shipment.docsCourierTrackingNo)); const [date, setDate] = useState(S(shipment.docsCourierDate).slice(0, 10) || localTodayISO());
  const [tick, setTick] = useState<Record<string, boolean>>(() => Object.fromEntries(others.map((s: any) => [S(s.number), true])));
  const chosen = [S(shipment.number), ...others.filter((s: any) => tick[S(s.number)]).map((s: any) => S(s.number))];
  return <div role="dialog" aria-label="Originals sent by DHL" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
    <div style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", width: "min(480px, 92vw)", maxHeight: "86vh", overflow: "auto" }}>
      <div style={{ fontSize: 16, fontWeight: 700 }}>Originals sent by DHL</div>
      <div style={{ fontSize: 12, color: "#64748B", marginBottom: 10 }}>{shipment.number}{mine.length ? "" : " · no client on this shipment"}</div>
      <div style={{ fontSize: 12, color: "#64748B", margin: "8px 0 4px" }}>DHL number</div>
      <input aria-label="DHL number" value={dhl} onChange={e => setDhl(e.target.value)} placeholder="e.g. 4417 2209 13" style={{ width: "100%", boxSizing: "border-box", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />
      <div style={{ fontSize: 12, color: "#64748B", margin: "10px 0 4px" }}>Sent on</div>
      <DateInput value={date} onChange={(v: string) => setDate(v)} noFuture />
      <div style={{ fontSize: 12, color: "#64748B", margin: "12px 0 4px" }}>In the same envelope — the client's other shipments still waiting for their originals</div>
      {others.length ? others.map((s: any) => <label key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: "1px solid #F1F5F9", fontSize: 13 }}>
        <input type="checkbox" checked={!!tick[S(s.number)]} onChange={() => setTick(x => ({ ...x, [S(s.number)]: !x[S(s.number)] }))} /><b>{s.number}</b> · {carriedRefs(s).soRefs.join(", ")}</label>)
        : <div style={{ fontSize: 12, color: "#94A3B8" }}>No other shipment to this client is waiting for its originals.</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <SmallButton onClick={onClose}>Cancel</SmallButton>
        <SmallButton kind="green" onClick={() => { if (!S(dhl)) return; onSave(chosen, S(dhl), date); onClose(); }}>{`Save on ${chosen.length} shipment${chosen.length > 1 ? "s" : ""}`}</SmallButton>
      </div>
    </div>
  </div>;
}

export function ShipmentDetail({ shipment, contacts, orders = [], pos = [], lots = [], packagingTypes = [], termsFindings = [], onEdit, onPrint, onEmail, onQuickStatus, onSendBilling, onAllocateCosts, onApplyInventory, onLoadingProtocol, onRaiseClaim, onStuffing = null, onDevanning = null, onMarkTOSent = null, openAll = false, allShipments = [], onSetOriginals = null }: any) {
  const [open, setOpen] = useState<Record<string, boolean>>(openAll ? { route: true, goods: true, checklist: true, documents: true, orders: true, costs: true, notes: true } : { route: true, goods: true });   // openAll: the suites read every section in one render
  const [more, setMore] = useState(false);
  const [dhlOpen, setDhlOpen] = useState(false);   // v7.23.6
  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));
  const provider = providerById(shipment.carrierId || shipment.forwarderId, contacts);
  const cancelledRefs = cancelledDocSet(pos, orders);
  const missingDocs = (shipment.documents || []).filter((d: any) => ["Required", "Missing"].includes(d.status));
  const dead = canonicalStatus(shipment.status) === "Cancelled";
  const isExport = shipmentTradeDirection(shipment, { pos, orders, countryOf: countryOfLocation }) === "EXPORT";   // v7.12.1 (A-TD-2)
  const cr = carriedRefs(shipment); const dts = shipmentDates(shipment);
  const providers = Array.from(new Set(providerIdsForShipment(shipment).map((id: any) => providerName(id, contacts)).filter(Boolean)));
  const legs: any[] = shipment.legs || [];
  const stops: string[] = []; legs.forEach((l: any, i: number) => { const from = locationTextFromFields(l.fromLocationId, l.fromCustom), to = locationTextFromFields(l.toLocationId, l.toCustom); if (i === 0 && S(from)) stops.push(S(from)); if (S(to) && stops[stops.length - 1] !== S(to)) stops.push(S(to)); });
  const na = dead ? null : nextShipmentAction(shipment);

  // ── the checklist, once — the same lines as before, and the steps left to close the shipment come from it ──
  const checks: Array<{ ok: boolean; label: string; warn?: string; step?: string }> = [];
  checks.push({ ok: !!provider, label: "Carrier / forwarder selected", step: "Choose the carrier or forwarder" });
  checks.push({ ok: (shipment.goods || []).length > 0, label: "Goods lines present", step: "Add the goods" });
  checks.push({ ok: (shipment.costs || []).some((c: any) => parseNum(c.amountPLN) > 0), label: "Freight cost entered", step: "Enter the freight cost" });
  checks.push({ ok: ["Sent", "Generated"].includes(S(shipment.confirmationStatus)), label: "Transport confirmation generated", step: "Send the transport order" });
  if (legs.some((l: any) => l.mode === "Road")) { const sheets = protocolsForShipment(shipment); const trucks = roadTruckCount(shipment); const back = sheets.filter((p: any) => p.status === "Returned").length;
    checks.push({ ok: back >= trucks && trucks > 0, label: "Loading protocol signed & returned", warn: trucks > 1 && back < trucks ? `${back}/${trucks} trucks` : "", step: "Get the loading protocol signed back" }); }
  { const units = legs.filter((l: any) => l.mode === "Road").flatMap((l: any) => transportUnitsForLeg(l)); const gaps = assignmentCheck(shipment.goods || [], units);
    if (gaps.length) { const short = gaps.filter((g: any) => g.unassignedKg > 0), over = gaps.filter((g: any) => g.overKg > 0); checks.push({ ok: false, label: "Goods assigned to trucks", warn: [short.length ? `${short.length} line(s) unassigned` : "", over.length ? `${over.length} over-assigned` : ""].filter(Boolean).join(" · "), step: "Assign the goods to the trucks" }); } }
  { const short = lotStockCheck(shipment.goods || [], lots || []); if (short.length) checks.push({ ok: false, label: "Lots hold what this shipment moves", warn: `${short[0].lotRef} short by ${Math.round(short[0].shortKg).toLocaleString("pl-PL")} kg${short.length > 1 ? ` (+${short.length - 1} more)` : ""}`, step: `Check the stock of ${short[0].lotRef}` }); }
  if (customsApplies(shipment.customs)) { const done = customsComplete(shipment.customs, { isExport }); const gaps = customsGaps(shipment.customs, { isExport }); checks.push({ ok: done, label: customsSummary(shipment.customs), warn: gaps.length ? gaps.map((g: any) => g.field).join(", ") + " missing" : "", step: "Complete the customs" }); }
  checks.push({ ok: missingDocs.length === 0, label: "Required documents received", warn: missingDocs.length ? `${missingDocs.length} missing` : "", step: `Collect the missing documents: ${missingDocs.map((d: any) => d.type).join(", ")}` });
  { const sum = summariseDocs(shipment.documents || []); if (sum.settledWithoutFile.length || sum.badLinks.length) { const bits: string[] = []; if (sum.settledWithoutFile.length) bits.push(`no scan: ${sum.settledWithoutFile.join(", ")}`); if (sum.badLinks.length) bits.push(`bad link: ${sum.badLinks.join(", ")}`); checks.push({ ok: false, label: "Signed scans on file", warn: bits.join(" · "), step: "Link the signed scans" }); } }
  if (S(shipment.purpose).toUpperCase() === "OUTBOUND") checks.push({ ok: true, label: "Costs allocated to lots — n/a (direct cost of sale)" });
  else checks.push({ ok: ["Cost allocated", "Allocated to lots", "Closed"].includes(S(shipment.billingStatus)), label: "Costs allocated to lots", step: "Allocate the costs to the lots" });
  { const recs = legs.flatMap((l: any) => transportUnitsForLeg(l)).map((u: any) => u.tempRecorderNo).filter(Boolean); checks.push({ ok: recs.length > 0, label: `Temp recorder registered${recs.length ? ` (${recs.join(", ")})` : ""}`, warn: !recs.length ? "reported on invoice" : "" }); }
  if (shipment.mode === "Sea" || shipment.mode === "Multimodal") {
    const legHasContainer = (l: any) => !!l.containerNumber || transportUnitsForLeg(l).some((u: any) => !!u.containerNumber);
    const legHasBL = (l: any) => !!l.blNumber || transportUnitsForLeg(l).some((u: any) => !!u.blNumber);
    checks.push({ ok: legs.some(legHasContainer), label: "Container number registered", step: "Enter the container number" });
    checks.push({ ok: legs.some(legHasBL), label: "BL number registered", step: "Get the B/L number" });
  }
  const openChecks = checks.filter(c => !c.ok);
  const originalsSent = !!(S(shipment.docsCourierTrackingNo) || S(shipment.docsCourierDate));
  const needsOriginals = isExport && (shipment.documents || []).length > 0;
  const steps = dead ? [] : [...openChecks.filter(c => c.step).map(c => c.step as string), ...(needsOriginals && !originalsSent ? ["Send the originals to the client by DHL"] : []), ...(na ? [na.label] : [])];
  const warnings = shipmentWarnings(shipment, { strict: ["Loaded", "Arrived", "Delivered", "Closed"].includes(canonicalStatus(shipment.status)), isExport });

  const fact = (k: string, v: any) => <div><div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 2 }}>{k}</div><div style={{ fontSize: 13, fontWeight: 600 }}>{v}</div></div>;
  const refLines = (refs: string[], nameOf: (r: string) => string) => refs.length ? refs.map(r => <div key={r} style={{ marginBottom: 6 }}><DocRef num={r} cancelledSet={cancelledRefs} /><div style={{ fontWeight: 500 }}>{nameOf(r)}</div></div>) : <span style={{ color: "#CBD5E1" }}>—</span>;
  const clientOf = (r: string) => { const o: any = (orders || []).find((x: any) => S(x.number) === r); return o ? soClientName(o) : ""; };
  const supplierOf = (r: string) => { const p: any = (pos || []).find((x: any) => S(x.number) === r); return p ? S(p.supplier?.name || p.supplierName || p.supplier) : ""; };
  const cmap = containerMap(shipment);
  const sentOrders = Object.keys(shipment.transportOrders || {}).length;
  const costLines = (shipment.costs || []).length;

  return <div style={{ display: "grid", gap: 12 }}>
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><div style={{ fontSize: 20, fontWeight: 700, color: "#111" }}>{shipment.number}</div><ModeBadge mode={shipment.mode} /><StatusBadge status={shipment.status} /><BillingBadge status={shipment.billingStatus} /></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
          {dead
            ? <span style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid #FECACA", background: "#FEF2F2", color: "#B91C1C", fontSize: 12, fontWeight: 600 }}>Deleted — read-only</span>
            : <SmallButton kind="blue" onClick={onEdit}>Edit</SmallButton>}
          <SmallButton onClick={onPrint} kind="dark">Transport order</SmallButton>
          {legs.some((l: any) => l.mode === "Road") && (() => { const sheets = protocolsForShipment(shipment); const trucks = roadTruckCount(shipment); const back = sheets.filter((p: any) => p.status === "Returned").length;
            return <SmallButton onClick={onLoadingProtocol} kind={!sheets.length ? undefined : (back >= trucks ? "green" : "blue")}>Loading protocol{sheets.length ? (trucks > 1 ? ` · ${back}/${trucks} back` : ` · ${sheets[0].status}`) : ""}</SmallButton>; })()}
          {na && <SmallButton onClick={() => onQuickStatus(na.to)} kind={na.kind}>{na.label}</SmallButton>}
          {S(shipment.purpose).toUpperCase() !== "OUTBOUND"
            ? <SmallButton onClick={onAllocateCosts} kind="green">Allocate costs to lots</SmallButton>
            : <span title="An outbound delivery's freight is a direct cost of the sale — it lands in the SO margin, never in lot landed cost." style={{ fontSize: 11, color: "#94A3B8" }}>Direct cost of sale — not allocated to lots</span>}
          <span style={{ position: "relative" }}>
            <SmallButton onClick={() => setMore(m => !m)}>More ▾</SmallButton>
            {more && <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: 6, zIndex: 5, boxShadow: "0 8px 24px rgba(0,0,0,.12)", minWidth: 240 }}>
              <SmallButton onClick={() => { setMore(false); onApplyInventory(); }} title="Normally automatic on Loaded / Arrived">Re-post inventory</SmallButton>
              <div style={{ fontSize: 11, color: "#64748B", padding: "4px 4px 2px" }}>Writes the shipment's stock movements again — only needed after editing a shipment that was already loaded.</div>
            </div>}
          </span>
          {onRaiseClaim && <SmallButton onClick={onRaiseClaim} kind="red">Raise transport claim</SmallButton>}
          {!["Closed", "Cancelled"].includes(canonicalStatus(shipment.status)) && <SmallButton kind="red" onClick={() => onQuickStatus("Cancelled")} title="Delete — the shipment stays on record, struck through and read-only; it no longer counts toward the PO / SO.">Delete shipment</SmallButton>}
        </div>
      </div>
      {stops.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px", margin: "10px 0 12px", fontSize: 13 }}>{stops.map((x, i) => <React.Fragment key={i}>{i > 0 && <span style={{ color: "#94A3B8" }}>→</span>}<span style={{ padding: "3px 9px", borderRadius: 7, background: "#F2F2F0" }}>{x}</span></React.Fragment>)}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px 16px" }}>
        {fact("Loading", day(dts.loaded, dts.plannedLoading))}
        {fact("Delivery", day(dts.delivered, dts.plannedDelivery))}
        {fact("SO / Client", refLines(cr.soRefs, clientOf))}
        {fact("PO / Supplier", refLines(cr.poRefs, supplierOf))}
        {fact("LOT", cr.lotRefs.length ? cr.lotRefs.map(r => <div key={r} style={{ marginBottom: 4 }}><DocRef num={r} cancelledSet={cancelledRefs} /></div>) : <span style={{ color: "#CBD5E1" }}>—</span>)}
        {fact("Carriers / Forwarders", providers.length ? providers.map(p => <div key={p}>{p}</div>) : <span style={{ color: "#CBD5E1" }}>—</span>)}
        {fact("Weight", shipmentKg(shipment) ? `${fmtNum(shipmentKg(shipment))} kg` : "—")}
      </div>
    </Card>

    {steps.length > 0 && <Card><div style={head}>Next steps to close this shipment</div><ol style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 13 }}>{steps.map((s, i) => <li key={i} style={{ margin: "3px 0" }}>{s}</li>)}</ol></Card>}
    {termsFindings.length ? <TermsFindingsBox findings={termsFindings} here={shipment.number} /> : null}

    <Fold title="Route and legs" summary={`${legs.length} leg${legs.length === 1 ? "" : "s"}`} open={!!open.route} onToggle={() => toggle("route")}>
      {legs.map((leg: any, i: number) => { const units: any[] = transportUnitsForLeg(leg); const sea = ["Sea", "Air", "Rail"].includes(S(leg.mode)); const b0 = (shipment.bookings || [])[0];
        return <div key={leg.id || i} style={{ border: "1px solid #F1F5F9", borderRadius: 10, marginTop: 10, overflowX: "auto" }}>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #F1F5F9", fontSize: 13, fontWeight: 700 }}>Leg {i + 1} · {leg.mode} <span style={{ fontWeight: 400, color: "#64748B" }}>{locationTextFromFields(leg.fromLocationId, leg.fromCustom)} → {locationTextFromFields(leg.toLocationId, leg.toCustom)}</span></div>
          {!units.length ? <div style={{ padding: 10, fontSize: 12, color: "#94A3B8" }}>No trucks or containers yet.</div> : sea
            ? <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["BL number", "Container number", "Forwarder", "ETD", "ETA", "Port of Discharge (POD)", "Truck number loaded into it"].map(h => <th key={h} style={thL}>{h}</th>)}</tr></thead>
                <tbody>{units.map((u: any, ui: number) => { const ref = S(u.containerNumber || u.id); const fed = cmap.filter(r => r.containerRef === ref).map(r => r.fromUnit);
                  return <tr key={u.id || ui}><td style={tdL}>{S(u.blNumber || leg.blNumber) || "—"}</td><td style={tdL}>{S(u.containerNumber) || "—"}</td><td style={tdL}>{providerName(b0?.forwarderId ?? leg.forwarderId, contacts) || "—"}</td><td style={tdL}>{formatDMY(S(leg.etd || leg.plannedPickupDate || u.plannedLoadingDate).slice(0, 10)) || "—"}</td><td style={tdL}>{formatDMY(S(leg.eta || leg.plannedDeliveryDate || u.plannedDeliveryDate).slice(0, 10)) || "—"}</td><td style={tdL}>{locationTextFromFields(leg.toLocationId, leg.toCustom) || "—"}</td><td style={tdL}>{fed.length ? fed.join(" · ") : "—"}</td></tr>; })}</tbody></table>
            : <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["Truck number", "Trailer number", "Carrier", "Loading place", "Unloading place", "Loading date", "Unloading date", "Status"].map(h => <th key={h} style={thL}>{h}</th>)}</tr></thead>
                <tbody>{units.map((u: any, ui: number) => { const loaded = S(u.actualLoadDate || u.loadedAt), unloaded = S(u.actualUnloadDate || u.deliveredAt || u.unloadedAt || u.dischargedAt);
                  return <tr key={u.id || ui}><td style={tdL}>{S(u.truckPlate || u.vehiclePlate) || "—"}</td><td style={tdL}>{S(u.trailerPlate) || "—"}</td><td style={tdL}>{providerName(u.carrierId ?? leg.carrierId, contacts) || "—"}</td><td style={tdL}>{S(u.pickupText) || locationTextFromFields(leg.fromLocationId, leg.fromCustom) || "—"}</td><td style={tdL}>{S(u.deliveryText) || locationTextFromFields(leg.toLocationId, leg.toCustom) || "—"}</td><td style={tdL}>{day(loaded, u.plannedLoadingDate || leg.plannedPickupDate)}</td><td style={tdL}>{day(unloaded, u.plannedDeliveryDate || leg.plannedDeliveryDate)}</td><td style={tdL}>{unloaded ? "Unloaded" : loaded ? "Loaded" : legDisplayStatus(leg.status, shipment.status)}</td></tr>; })}</tbody></table>}
        </div>; })}
      {onStuffing && <div style={{ marginTop: 10 }}><ForwarderReports shipment={shipment} orders={orders} onStuffing={onStuffing} onDevanning={onDevanning} /></div>}
    </Fold>

    <Fold title="Goods" summary={`${(shipment.goods || []).length} line(s) · ${fmtNum(shipmentKg(shipment))} kg`} open={!!open.goods} onToggle={() => toggle("goods")}>
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["Product", "Variety", "Packaging", "LOT", "PO / Supplier", "Weight"].map(h => <th key={h} style={thL}>{h}</th>)}</tr></thead>
        <tbody>{(shipment.goods || []).map((g: any, gi: number) => <tr key={g.id || gi}><td style={tdL}>{g.product || "—"}</td><td style={tdL}>{g.variety || "—"}</td><td style={tdL}>{g.packaging || "—"}</td><td style={tdL}>{g.lotRef ? <DocRef num={g.lotRef} cancelledSet={cancelledRefs} /> : "—"}</td><td style={tdL}>{g.poRef ? <><DocRef num={g.poRef} cancelledSet={cancelledRefs} /><div>{supplierOf(S(g.poRef))}</div></> : "—"}</td><td style={tdL}>{fmtNum(g.qtyKg)} kg</td></tr>)}</tbody></table></div>
    </Fold>

    <Fold title="Checklist" summary={`${openChecks.length} open of ${checks.length}`} open={!!open.checklist} onToggle={() => toggle("checklist")}>
      {warnings.length > 0 && <div style={{ marginBottom: 12, padding: "9px 11px", borderRadius: 8, background: "#FFFBEB", border: "1px solid #FDE68A", fontSize: 11, color: "#92400E" }}><strong>Incomplete — none of this blocks</strong><div style={{ marginTop: 4, lineHeight: 1.5 }}>{warnings.map((x: any, i: number) => <div key={i}>· {x.why}</div>)}</div></div>}
      {checks.map((c, i) => <ChecklistLine key={i} ok={c.ok} label={c.label} warnText={c.warn || ""} />)}
    </Fold>

    <Fold title="Documents" summary={`${missingDocs.length} of ${(shipment.documents || []).length} missing · originals ${originalsSent ? "sent" : "not sent yet"}`} open={!!open.documents} onToggle={() => toggle("documents")}>
      {documentRegister(shipment, protocolsForShipment(shipment)).filter((r: any) => r.kind === "Transport order" || r.kind === "Loading protocol").map((r: any, i: number) => (
        <div key={"reg-" + i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 6, borderBottom: "1px solid #F3F4F6", padding: "6px 0", fontSize: 12, alignItems: "center" }}>
          <div><b>{r.kind}</b> <span style={{ color: "#94A3B8" }}>{r.ref}</span></div>
          <span style={{ fontSize: 10, fontWeight: 700, color: r.status === "Returned" || r.status === "Have it" || r.status === "N/A" ? "#16A34A" : r.status === "Sent" ? "#0284C7" : "#B45309" }}>{r.status}</span>
          <span style={{ fontSize: 10, color: "#94A3B8" }}>{r.date || ""}</span>
        </div>))}
      {(() => { const sum = summariseDocs(shipment.documents || []); if (!sum.total) return null;
        return <div style={{ fontSize: 11, color: "#64748B", margin: "6px 0 5px" }}>{sum.settled} of {sum.total} settled · <strong style={{ color: sum.withFile ? "#059669" : "#94A3B8" }}>{sum.withFile} scan{sum.withFile === 1 ? "" : "s"} linked</strong>{sum.outstanding ? ` · ${sum.outstanding} outstanding` : ""}</div>; })()}
      {(shipment.documents || []).map((d: any) => { const info = inspectLink(d.link);
        return <div key={d.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 6, borderBottom: "1px solid #F1F5F9", padding: "8px 0", alignItems: "center" }}>
          <div><div style={{ fontSize: 12, fontWeight: 700 }}>{d.type} {d.ref ? `- ${d.ref}` : ""}</div><div style={{ fontSize: 11, color: "#888" }}>{[d.date ? `received ${d.date}` : "", d.notes].filter(Boolean).join(" · ")}</div></div>
          <div style={{ fontSize: 11 }}>{d.link ? (info.ok ? <a href={d.link} target="_blank" rel="noreferrer" style={{ color: "#2563EB", fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>{info.label} ↗</a> : <span title={info.reason} style={{ color: "#DC2626", fontWeight: 700, whiteSpace: "nowrap" }}>bad link</span>) : <span style={{ color: "#CBD5E1", whiteSpace: "nowrap" }}>no scan</span>}</div>
          <div style={{ fontSize: 11, fontWeight: 800, minWidth: 62, textAlign: "right", color: d.status === "N/A" ? "#94A3B8" : ["Received", "Approved", "Generated", "Sent", "Have it"].includes(d.status) ? "#059669" : "#D97706" }}>{d.status}</div>
        </div>; })}
      <div style={{ marginTop: 10, padding: "6px 9px", background: originalsSent ? "#F0F9FF" : "#F8FAFC", border: `1px solid ${originalsSent ? "#BAE6FD" : "#E2E8F0"}`, borderRadius: 7, fontSize: 12, color: originalsSent ? "#0C4A6E" : "#64748B" }}>
        {originalsSent ? <>Originals sent to the client{shipment.docsCourierDate ? ` on ${formatDMY(S(shipment.docsCourierDate).slice(0, 10))}` : ""} — DHL <strong>{shipment.docsCourierTrackingNo || "—"}</strong></> : "Originals to the client: not sent yet"}
        {!dead && onSetOriginals && <span style={{ marginLeft: 10 }}><SmallButton kind={originalsSent ? undefined : "green"} onClick={() => setDhlOpen(true)}>{originalsSent ? "Change" : "Originals sent by DHL…"}</SmallButton></span>}
      </div>
      {dhlOpen && <OriginalsWindow shipment={shipment} orders={orders} allShipments={allShipments} onSave={onSetOriginals} onClose={() => setDhlOpen(false)} />}
    </Fold>

    <Fold title="Transport orders" summary={`${sentOrders} sent`} open={!!open.orders} onToggle={() => toggle("orders")}>
      <TransportOrdersCard orders={orders} pos={pos} lots={lots} packagingTypes={packagingTypes} shipment={shipment} contacts={contacts} onMarkSent={onMarkTOSent} onCompose={onEmail ? (cid: any, li: number) => onEmail(cid, li) : null} />
    </Fold>

    <Fold title="Costs" summary={costLines ? `${costLines} line${costLines === 1 ? "" : "s"} · ${fmtMoney(shipmentCostPLN(shipment), "PLN")}` : "none"} open={!!open.costs} onToggle={() => toggle("costs")}>
      {(shipment.costs || []).map((c: any) => <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, borderBottom: "1px solid #F1F5F9", padding: "8px 0" }}>
        <div><div style={{ fontSize: 12, fontWeight: 700 }}>{costTypeLabel(c.type)} - {providerName(c.supplierId, contacts)}</div><div style={{ fontSize: 11, color: "#888" }}>{c.invoiceStatus} {c.invoiceRef ? `- ${c.invoiceRef}` : ""} - {c.notes}</div></div>
        <div style={{ textAlign: "right" }}><div style={{ fontSize: 12, fontWeight: 800 }}>{fmtMoney(c.amount, c.currency)}</div><div style={{ fontSize: 11, color: "#888" }}>{fmtMoney(c.amountPLN, "PLN")}</div></div>
      </div>)}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}><div style={{ fontSize: 12, color: "#888" }}>Cost / kg: <strong style={{ color: "#111" }}>{shipmentKg(shipment) ? fmtMoney(shipmentCostPLN(shipment) / shipmentKg(shipment), "PLN") : "-"}</strong></div><div style={{ fontSize: 14, fontWeight: 800 }}>{fmtMoney(shipmentCostPLN(shipment), "PLN")}</div></div>
    </Fold>

    <Fold title="Notes" summary={S(shipment.notes) ? "1 note" : "none"} open={!!open.notes} onToggle={() => toggle("notes")}>
      {S(shipment.notes) ? <div style={{ fontSize: 12, color: "#555", whiteSpace: "pre-line" }}>{shipment.notes}</div> : <div style={{ fontSize: 12, color: "#94A3B8" }}>No notes.</div>}
    </Fold>
  </div>;
}
