// ShipmentDetail.tsx — v6.99.68 (A-AUD-2, owner): moved out of Shipments.tsx unchanged; the module's shared helpers are imported from it.
import { documentRegister } from "./shipmentModel.domain";
import React from "react";
import { customsGaps, customsComplete, customsSummary, customsApplies } from "./customs.domain";
import { SmallButton, DocRef, cancelledDocSet } from "./ui";
import { carriedRefs } from "./shipments.domain";
import { inspectLink, summariseDocs } from "./docLinks.domain";
import { formatDMY } from "./dates";
import { lotStockCheck } from "./receipts.domain";
import { nextShipmentAction, canonicalStatus } from "./shipments.domain";
import { protocolsForShipment, assignmentCheck } from "./loadingProtocol.domain";
import { shipmentWarnings } from "./moduleGuards.domain";
import { BillingBadge, Card, ChecklistLine, ForwarderReports, MODE_CONFIG, ModeBadge, SectionTitle, StatusBadge, costTypeLabel, fmtMoney, fmtNum, legDisplayStatus, locationTextFromFields, parseNum, pillStyle, providerById, providerName, roadTruckCount, shipmentCostPLN, shipmentKg, shipmentSORefs, td, th, transportUnitsForLeg } from "./Shipments";
import { TransportOrdersCard } from "./ShipmentDocuments";

export function ShipmentDetail({ shipment, contacts, orders = [], pos = [], lots = [], packagingTypes = [], onEdit, onPrint, onEmail, onQuickStatus, onSendBilling, onAllocateCosts, onApplyInventory , onLoadingProtocol , onRaiseClaim, onStuffing = null, onDevanning = null, onMarkTOSent = null }: any) {
  const provider = providerById(shipment.carrierId || shipment.forwarderId, contacts);
  const cancelledRefs = cancelledDocSet(pos, orders); // v6.35.1: strike cancelled PO/SO refs
  const missingDocs = (shipment.documents || []).filter(d => ["Required", "Missing"].includes(d.status));
  const soPills = shipmentSORefs(shipment, orders);
  return <div style={{ display: "grid", gap: 14 }}>
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14 }}>
        <div>
          {/* v6.4.0 header: number · mode · status · billing + document pills only.
              Route, provider and dates live in the cards below — not repeated here. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ fontSize: 24, fontWeight: 700, color: "#111", fontFamily: "ui-monospace, Menlo, monospace" }}>{shipment.number}</div><ModeBadge mode={shipment.mode} /><StatusBadge status={shipment.status} /><BillingBadge status={shipment.billingStatus} /></div>
          {/* v6.58.0: related documents come from the goods ON BOARD, not the
              creation seeds — a shipment carrying one lot must not display its
              source's other POs and lots as if it moved them. */}
          {(() => { const cr = carriedRefs(shipment); return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>{cr.poRefs.map(r => <span key={r} style={pillStyle("#DBEAFE", "#2563EB")}><DocRef num={r} cancelledSet={cancelledRefs} /></span>)}{cr.soRefs.map(r => <span key={r} style={pillStyle("#DCFCE7", "#16A34A")}><DocRef num={r} cancelledSet={cancelledRefs} /></span>)}{cr.lotRefs.map(r => <span key={r} style={pillStyle("#F5F3FF", "#7C3AED")}>{r}</span>)}</div>
          ); })()}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {shipment.status === "Cancelled"
            ? <span style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid #FECACA", background: "#FEF2F2", color: "#B91C1C", fontSize: 12, fontWeight: 600 }}>Cancelled — read-only</span>
            : <SmallButton kind="blue" onClick={onEdit}>Edit</SmallButton>}
          <SmallButton onClick={onPrint} kind="dark">Transport order</SmallButton>
          {/* v6.46.0: the loading protocol (Karta załadunku) — the signed sheet that
              makes a later transport claim provable. Road loading only. */}
          {/* v6.53.0: one sheet per truck — the button reports the whole set, so a
              shipment with two trucks cannot look complete on the strength of one. */}
          {(shipment.legs || []).some((l: any) => l.mode === "Road") && (() => {
            const sheets = protocolsForShipment(shipment);
            const trucks = roadTruckCount(shipment);
            const back = sheets.filter((p: any) => p.status === "Returned").length;
            const kind = !sheets.length ? undefined : (back >= trucks ? "green" : "blue");
            return (
              <SmallButton onClick={onLoadingProtocol} kind={kind}>
                Loading protocol{sheets.length ? (trucks > 1 ? ` · ${back}/${trucks} back` : ` · ${sheets[0].status}`) : ""}
              </SmallButton>
            );
          })()}
          {/* v6.49.0 (claims Phase 2): raise a transport or temperature claim against
              the carrier, forwarder or shipping line — the case the old design could
              not express at all, because a claim could only ever name the producer. */}
          {onRaiseClaim && <SmallButton onClick={onRaiseClaim} kind="red">Raise transport claim</SmallButton>}
          {/* BP-22: only the NEXT logical action, not every status at once. */}
          {(() => {
            const na = nextShipmentAction(shipment);
            return na ? <SmallButton onClick={() => onQuickStatus(na.to)} kind={na.kind}>{na.label}</SmallButton> : null;
          })()}
          {/* v6.58.0: billing/costing actions live with the other header
              buttons (user ruling) — buried at the bottom of costs & billing,
              "Apply inventory movement" was the button nobody found. */}
          {/* v6.80.0 (D-48): "Send to billing queue" retired — billing status derives from the cost lines. */}
          {String(shipment.purpose || "").toUpperCase() !== "OUTBOUND"
            ? <SmallButton onClick={onAllocateCosts} kind="green">Allocate costs to lots</SmallButton>
            : <span title="v6.80.0 (D-41): an outbound delivery's freight is a DIRECT cost of the sale — it lands in the SO margin, never in lot landed cost." style={{ fontSize: 11, color: "#94A3B8", alignSelf: "center" }}>Direct cost of sale — not allocated to lots</span>}
          <SmallButton onClick={onApplyInventory} title="Normally automatic on Loaded/Arrived — use only to re-post after editing goods.">Re-post inventory</SmallButton>
          {!["Closed", "Cancelled"].includes(canonicalStatus(shipment.status)) &&
            <SmallButton kind="red" onClick={() => onQuickStatus("Cancelled")} title="Cancel this shipment — it stays on record (read-only) but no longer counts toward the PO/SO.">Cancel shipment</SmallButton>}
        </div>
      </div>
    </Card>

    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 14 }}>
      <Card>
        <SectionTitle>Route / legs</SectionTitle>
        {(shipment.legs || []).map((leg, i) => { const mc = MODE_CONFIG[leg.mode] || MODE_CONFIG.Road; return <div key={leg.id || i} style={{ display: "grid", gridTemplateColumns: "36px 70px 1fr 1fr 1.1fr", gap: 10, alignItems: "start", padding: "10px 0 10px 10px", borderLeft: `3px solid ${mc.color}`, borderBottom: i === (shipment.legs || []).length - 1 ? "none" : "1px solid #F1F5F9" }}>
          <div style={{ width: 26, height: 26, borderRadius: 999, background: mc.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>{i + 1}</div>
          <div><ModeBadge mode={leg.mode} /><div style={{ marginTop: 4 }}><StatusBadge status={legDisplayStatus(leg.status, shipment.status)} /></div>
            {/* v6.58.0 (user ruling): each leg names its OWN carrier or
                forwarder — a road+sea shipment has two providers and the
                header can only show one. */}
            {(() => { const prov = providerName(leg.carrierId || leg.forwarderId || (leg.mode === "Sea" || leg.mode === "Air" ? shipment.forwarderId : shipment.carrierId), contacts);
              return prov ? <div style={{ fontSize: 10, color: "#475569", marginTop: 4, maxWidth: 66, overflowWrap: "break-word" }} title={leg.forwarderId ? "Forwarder" : "Carrier"}>{prov}</div> : null; })()}
          </div>
          <div><div style={{ fontSize: 10.5, color: "#888", fontWeight: 700 }}>LOADING</div><div style={{ fontSize: 12, color: "#333" }}>{((leg.vehicles || []).map((u: any) => String(u.pickupText || "").trim()).find(Boolean)) || locationTextFromFields(leg.fromLocationId, leg.fromCustom)}</div><div style={{ fontSize: 11, color: "#888" }}>{(() => { const u = (leg.vehicles || []); const planned = u.map((x: any) => String(x.plannedLoadingDate || "")).filter(Boolean).sort()[0] || String(leg.plannedPickupDate || "").slice(0, 10); const actual = u.map((x: any) => String(x.loadedAt || "")).filter(Boolean).sort()[0]; return actual ? <><b style={{ color: "#0F766E" }}>{actual}</b><span style={{ color: "#94A3B8", fontSize: 10.5 }}> loaded{planned && planned !== actual ? ` · planned ${planned}` : ""}</span></> : (planned || "-"); })()}</div></div>
          <div><div style={{ fontSize: 10.5, color: "#888", fontWeight: 700 }}>UNLOADING</div><div style={{ fontSize: 12, color: "#333" }}>{((leg.vehicles || []).map((u: any) => String(u.deliveryText || "").trim()).find(Boolean)) || locationTextFromFields(leg.toLocationId, leg.toCustom)}</div><div style={{ fontSize: 11, color: "#888" }}>{(() => { const u = (leg.vehicles || []); const planned = u.map((x: any) => String(x.plannedDeliveryDate || "")).filter(Boolean).sort().slice(-1)[0] || String(leg.plannedDeliveryDate || "").slice(0, 10); const actual = u.map((x: any) => String(x.deliveredAt || x.unloadedAt || x.dischargedAt || "")).filter(Boolean).sort().slice(-1)[0]; return actual ? <><b style={{ color: "#0F766E" }}>{actual}</b><span style={{ color: "#94A3B8", fontSize: 10.5 }}> unloaded{planned && planned !== actual ? ` · planned ${planned}` : ""}</span></> : (planned || "-"); })()}</div></div>
          <div style={{ fontSize: 11.5, color: "#555", lineHeight: 1.45 }}>
            {transportUnitsForLeg(leg).length > 0 ? transportUnitsForLeg(leg).map((u, ui) => (
              <div key={u.id || ui} style={{ padding: "4px 0", borderBottom: ui === transportUnitsForLeg(leg).length - 1 ? "none" : "1px dashed #E5E7EB" }}>
                <div><strong>Unit {ui + 1}</strong> · {u.mode || leg.mode} · {u.qtyKg ? `${fmtNum(u.qtyKg)} kg` : "kg TBA"}</div>
                {(u.truckPlate || u.trailerPlate || u.driverName || leg.mode === "Road" || leg.mode === "Rail") && <div>Truck: <strong>{u.truckPlate || u.vehiclePlate || "TBA"}</strong> / trailer {u.trailerPlate || "TBA"} · Driver: {u.driverName || "TBA"} {u.driverPhone ? `(${u.driverPhone})` : ""}{(u.mode || leg.mode) === "Road" ? ` · CMR ${u.cmrNumber || "TBA"}` : ""}</div>}
                {(u.containerNumber || (u.mode || leg.mode) === "Sea" || (u.mode || leg.mode) === "Rail") && <div>Container: <strong>{u.containerNumber || "TBA"}</strong> · BL {leg.blNumber || "pending"} · Booking {leg.bookingNumber || "TBA"}{leg.shippingLine ? ` · ${leg.shippingLine}` : ""}</div>}
                {(u.awbNumber || leg.mode === "Air") && <div>AWB: <strong>{u.awbNumber || "TBA"}</strong></div>}
                {u.tempRecorderNo && <div>Temp recorder: <strong>{u.tempRecorderNo}</strong></div>}
                {(u.actualLoadDate || u.actualUnloadDate) && <div>Actual: loaded <strong>{formatDMY(u.actualLoadDate) || "—"}</strong> · unloaded <strong>{formatDMY(u.actualUnloadDate) || "—"}</strong></div>}
              </div>
            )) : <div>Transport unit details: TBA</div>}
          </div>
        </div>; })}
      </Card>
      <TransportOrdersCard packagingTypes={packagingTypes} shipment={shipment} contacts={contacts} onMarkSent={onMarkTOSent} onCompose={onEmail ? (cid: any, li: number) => onEmail(cid, li) : null} />
      {/* v6.99.87 (A-SD-1, owner): the goods right under the route and the transport orders */}
      <Card>
        <SectionTitle>Goods</SectionTitle>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><thead><tr style={{ color: "#888", textAlign: "left", borderBottom: "1px solid #E5E7EB" }}><th style={th}>Product</th><th style={th}>Origin</th><th style={th}>Quality / size</th><th style={th}>Packaging</th><th style={th}>PO / SO / Lot</th><th style={{ ...th, textAlign: "right" }}>Qty kg</th><th style={{ ...th, textAlign: "right" }}>Pallets</th></tr></thead><tbody>{(shipment.goods || []).map(g => <tr key={g.id} style={{ borderBottom: "1px solid #F1F5F9" }}><td style={td}><strong>{g.product}{g.variety ? " — " + g.variety : ""}</strong><div style={{ color: "#888", fontSize: 11 }}>{g.description}</div></td><td style={td}>{g.origin || "-"}</td><td style={td}>{g.quality || "-"} / {g.size || "-"}</td><td style={td}>{g.packaging || "-"}</td><td style={td}><div>{g.poRef || "-"}</div><div>{g.soRef || soPills.join(", ") || "-"}</div><div>{g.lotRef || "-"}</div></td><td style={{ ...td, textAlign: "right" }}>{fmtNum(g.qtyKg)}</td><td style={{ ...td, textAlign: "right" }}>{fmtNum(g.pallets)}</td></tr>)}</tbody></table>
      </Card>
      {onStuffing && <ForwarderReports shipment={shipment} orders={orders} onStuffing={onStuffing} onDevanning={onDevanning} />}
      {/* v6.99.87 (A-SD-2, owner ruling): the document register merged into Documents below */}

      <Card>
        {/* v6.58.0: the four face boxes (route / dates / on board / carrier)
            are REMOVED on user ruling — route read shipment-level location
            fields that real data does not populate (legs carry the truth), so
            the box confidently showed the wrong place. The checklist returns
            to the top of the card. */}
        {/* v6.78.0: what is incomplete, while you work rather than at the save
            button. Plates only count once goods are moving — a booking sent to
            the carrier before the registration is known is complete as it is. */}
        {(() => {
          const w = shipmentWarnings(shipment, {
            strict: ["Loaded", "Arrived", "Delivered", "Closed"].includes(canonicalStatus(shipment.status)),
            isExport: String(shipment.tradeDirection || "") === "EXPORT",
          });
          if (!w.length) return null;
          return <div style={{ marginBottom: 12, padding: "9px 11px", borderRadius: 8, background: "#FFFBEB", border: "1px solid #FDE68A", fontSize: 11.5, color: "#92400E" }}>
            <strong>Incomplete — none of this blocks</strong>
            <div style={{ marginTop: 4, lineHeight: 1.5 }}>{w.map((x, i) => <div key={i}>· {x.why}</div>)}</div>
          </div>;
        })()}
        <SectionTitle>Operational checklist</SectionTitle>
        <ChecklistLine ok={!!provider} label="Carrier / forwarder selected" />
        <ChecklistLine ok={(shipment.goods || []).length > 0} label="Goods lines present" />
        <ChecklistLine ok={(shipment.costs || []).some(c => parseNum(c.amountPLN) > 0)} label="Freight cost entered" />
        <ChecklistLine ok={(shipment.confirmationStatus || "") === "Sent" || (shipment.confirmationStatus || "") === "Generated"} label="Transport confirmation generated" />
        {/* v6.46.0: a signed loading protocol is what makes a transport claim provable. */}
        {(shipment.legs || []).some((l: any) => l.mode === "Road") && (() => {
          // v6.53.0: EVERY truck's sheet has to be back. One returned sheet out of
          // three is not evidence for the other two loads.
          const sheets = protocolsForShipment(shipment);
          const trucks = roadTruckCount(shipment);
          const back = sheets.filter((p: any) => p.status === "Returned").length;
          return <ChecklistLine ok={back >= trucks && trucks > 0} label="Loading protocol signed & returned"
            warnText={trucks > 1 && back < trucks ? `${back}/${trucks} trucks` : ""} />;
        })()}
        {/* v6.53.0: once ANY truck has an assignment, silence about the rest is the
            dangerous state — a sheet would print short and no one would know. */}
        {(() => {
          const units = (shipment.legs || []).filter((l: any) => l.mode === "Road").flatMap((l: any) => transportUnitsForLeg(l));
          const gaps = assignmentCheck(shipment.goods || [], units);
          if (!gaps.length) return null;
          const short = gaps.filter((g: any) => g.unassignedKg > 0);
          const over = gaps.filter((g: any) => g.overKg > 0);
          return <ChecklistLine ok={false} label="Goods assigned to trucks"
            warnText={[short.length ? `${short.length} line(s) unassigned` : "", over.length ? `${over.length} over-assigned` : ""].filter(Boolean).join(" · ")} />;
        })()}
        {/* v6.55.0: the constraint that replaces the PO guard — physical, not
            policy. A lot cannot ship kilos it does not hold, whatever the
            paperwork says. Reported, so a mis-keyed quantity surfaces here
            rather than as a negative stock balance three screens away. */}
        {(() => {
          const short = lotStockCheck(shipment.goods || [], lots || []);
          if (!short.length) return null;
          return <ChecklistLine ok={false} label="Lots hold what this shipment moves"
            warnText={`${short[0].lotRef} short by ${Math.round(short[0].shortKg).toLocaleString("pl-PL")} kg${short.length > 1 ? ` (+${short.length - 1} more)` : ""}`} />;
        })()}
        {/* v6.60.0: customs on the checklist, with the declaration reference
            named. "What is stuck in customs" should be answerable here. */}
        {customsApplies(shipment.customs) && (() => {
          const isExport = String(shipment.tradeDirection || "") === "EXPORT";
          const done = customsComplete(shipment.customs, { isExport });
          const gaps = customsGaps(shipment.customs, { isExport });
          return <ChecklistLine ok={done} label={customsSummary(shipment.customs)}
            warnText={gaps.length ? gaps.map(g => g.field).join(", ") + " missing" : ""} />;
        })()}
        <ChecklistLine ok={missingDocs.length === 0} label="Required documents received" warnText={missingDocs.length ? `${missingDocs.length} missing` : ""} />
        {/* v6.47.0: a tick is not evidence — flag anything we say we hold but couldn't produce. */}
        {(() => {
          const sum = summariseDocs(shipment.documents || []);
          if (!sum.settledWithoutFile.length && !sum.badLinks.length) return null;
          const bits: string[] = [];
          if (sum.settledWithoutFile.length) bits.push(`no scan: ${sum.settledWithoutFile.join(", ")}`);
          if (sum.badLinks.length) bits.push(`bad link: ${sum.badLinks.join(", ")}`);
          return <ChecklistLine ok={false} label="Signed scans on file" warnText={bits.join(" · ")} />;
        })()}
        {String(shipment.purpose || "").toUpperCase() === "OUTBOUND"
          ? <ChecklistLine ok={true} label="Costs allocated to lots — n/a (direct cost of sale)" />
          : <ChecklistLine ok={["Cost allocated", "Allocated to lots", "Closed"].includes(String(shipment.billingStatus || ""))} label="Costs allocated to lots" />}
        {(() => {
          const recs = (shipment.legs || []).flatMap((l: any) => transportUnitsForLeg(l)).map((u: any) => u.tempRecorderNo).filter(Boolean);
          return <ChecklistLine ok={recs.length > 0} label={`Temp recorder registered${recs.length ? ` (${recs.join(", ")})` : ""}`} warnText={!recs.length ? "reported on invoice" : ""} />;
        })()}
        {(shipment.mode === "Sea" || shipment.mode === "Multimodal") && (() => {
          // v6.43.0 (test-round #9): container/BL numbers may be recorded at leg
          // level OR per transport unit (vehicles[]). Check both so a container
          // entered on the sea unit isn't reported as missing.
          const legHasContainer = (l: any) => !!l.containerNumber || transportUnitsForLeg(l).some((u: any) => !!u.containerNumber);
          const legHasBL = (l: any) => !!l.blNumber || transportUnitsForLeg(l).some((u: any) => !!u.blNumber);
          const legs = shipment.legs || [];
          return <>
            <ChecklistLine ok={legs.some(legHasContainer)} label="Container number registered" />
            <ChecklistLine ok={legs.some(legHasBL)} label="BL number registered" />
          </>;
        })()}
      </Card>
    </div>


    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <Card>
        <SectionTitle>Costs / billing</SectionTitle>
        {(shipment.costs || []).map(c => <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, borderBottom: "1px solid #F1F5F9", padding: "8px 0" }}>
          <div><div style={{ fontSize: 12, fontWeight: 700 }}>{costTypeLabel(c.type)} - {providerName(c.supplierId, contacts)}</div><div style={{ fontSize: 11, color: "#888" }}>{c.invoiceStatus} {c.invoiceRef ? `- ${c.invoiceRef}` : ""} - {c.notes}</div></div>
          <div style={{ textAlign: "right" }}><div style={{ fontSize: 12, fontWeight: 800 }}>{fmtMoney(c.amount, c.currency)}</div><div style={{ fontSize: 11, color: "#888" }}>{fmtMoney(c.amountPLN, "PLN")}</div></div>
        </div>)}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}><div style={{ fontSize: 12, color: "#888" }}>Cost / kg: <strong style={{ color: "#111" }}>{shipmentKg(shipment) ? fmtMoney(shipmentCostPLN(shipment) / shipmentKg(shipment), "PLN") : "-"}</strong></div><div style={{ fontSize: 15, fontWeight: 850 }}>{fmtMoney(shipmentCostPLN(shipment), "PLN")}</div></div>
        {/* v6.58.0: the three action buttons moved to the shipment header. */}
      </Card>
      <Card>
        <SectionTitle>Documents</SectionTitle>
        {/* v6.99.87 (A-SD-2): the transport order and the loading protocols, from the shipment (read-only), with the register's status colours */}
        {documentRegister(shipment, protocolsForShipment(shipment)).filter((r: any) => r.kind === "Transport order" || r.kind === "Loading protocol").map((r: any, i: number) => (
          <div key={"reg-" + i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 6, borderBottom: "1px solid #F3F4F6", padding: "6px 0", fontSize: 12, alignItems: "center" }}>
            <div><b>{r.kind}</b> <span style={{ color: "#94A3B8", fontFamily: "ui-monospace, Menlo, monospace" }}>{r.ref}</span></div>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: r.status === "Returned" || r.status === "Have it" || r.status === "N/A" ? "#16A34A" : r.status === "Sent" ? "#0284C7" : "#B45309" }}>{r.status}</span>
            <span style={{ fontSize: 10.5, color: "#94A3B8" }}>{r.date || ""}</span>
          </div>))}
        {/* v6.47.0: the register now shows WHERE each signed original is. Files can't
            live in the browser's storage, so each row carries a Dropbox share link. */}
        {(() => {
          const sum = summariseDocs(shipment.documents || []);
          if (!sum.total) return null;
          return <div style={{ fontSize: 11, color: "#64748B", marginBottom: 5 }}>
            {sum.settled} of {sum.total} settled · <strong style={{ color: sum.withFile ? "#059669" : "#94A3B8" }}>{sum.withFile} scan{sum.withFile === 1 ? "" : "s"} linked</strong>
            {sum.outstanding ? ` · ${sum.outstanding} outstanding` : ""}
          </div>;
        })()}
        {(shipment.documents || []).map(d => {
          const info = inspectLink(d.link);
          return <div key={d.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 6, borderBottom: "1px solid #F1F5F9", padding: "8px 0", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{d.type} {d.ref ? `- ${d.ref}` : ""}</div>
              <div style={{ fontSize: 11, color: "#888" }}>{[d.date ? `received ${d.date}` : "", d.notes].filter(Boolean).join(" · ")}</div>
            </div>
            <div style={{ fontSize: 11 }}>
              {d.link
                ? (info.ok
                    ? <a href={d.link} target="_blank" rel="noreferrer" style={{ color: "#2563EB", fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>📎 {info.label} ↗</a>
                    : <span title={info.reason} style={{ color: "#DC2626", fontWeight: 700, whiteSpace: "nowrap" }}>⚠ bad link</span>)
                : <span style={{ color: "#CBD5E1", whiteSpace: "nowrap" }}>no scan</span>}
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, minWidth: 62, textAlign: "right", color: d.status === "N/A" ? "#94A3B8" : ["Received", "Approved", "Generated", "Sent", "Have it"].includes(d.status) ? "#059669" : "#D97706" }}>{d.status}</div>
          </div>;
        })}
        {(shipment.docsCourierTrackingNo || shipment.docsCourierDate) && (
          <div style={{ marginTop: 10, padding: "5px 8px", background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 7, fontSize: 11.5, color: "#0C4A6E" }}>
            📦 Original documents sent to client — courier tracking <strong style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{shipment.docsCourierTrackingNo || "—"}</strong>{shipment.docsCourierDate ? ` · sent ${shipment.docsCourierDate}` : ""}
          </div>
        )}
      </Card>
    </div>
    {shipment.notes && <Card><SectionTitle>Notes</SectionTitle><div style={{ fontSize: 12.5, color: "#555", whiteSpace: "pre-line" }}>{shipment.notes}</div></Card>}
  </div>;
}
