// ShipmentCreate.tsx — v6.99.68 (A-AUD-2, owner): moved out of Shipments.tsx unchanged; the module's shared helpers are imported from it.
import React, { useState } from "react";
import { MOVEMENT_LABELS as MOVE_LBL, shipmentTradeDirection } from "./tradeFlow.domain";
import { SmallButton, ActionButton } from "./ui";
import { isCancelled } from "./cancellation.domain";
import { formatDMY } from "./dates";
import { nextId } from "./ids";
import { appendSourceGoods } from "./shipments.domain";   // v6.99.94
import { placeForPrint } from "./locations";
import { Card, HEADER_MODES, Inp, Lbl, SectionTitle, Sel, buildManualShipment, buildShipmentFromPO, buildShipmentFromSO, countryOfLocation, fmtNum, locById, locText, mergedLocations, modeChangePatch, parseNum, todayISO } from "./Shipments";

export function CreateShipmentModal({ pos, orders, lots, contacts, shipments, onCancel, onCreate }: any) {
  const [sourceType, setSourceType] = useState("PO");
  const [governingSoPrompt, setGoverningSoPrompt] = useState(null); // v6.34.0: {po, sos} when a multi-SO PO needs a pick
  const [ref, setRef] = useState(""); // v6.18.14 (#4): no PO pre-selected — force a choice
  const [moreRefs, setMoreRefs] = useState<string[]>([]);   // v6.99.94 (A-GR-2, owner): groupage — more SOs (several drops) or POs (several pickups) on one shipment
  // Which PO line ids are loaded on this shipment (default: all). Lets the user load
  // a subset of a multi-product PO.
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [lineQtys, setLineQtys] = useState<Record<string, string>>({}); // v6.34.4: per-line 'ship now' kg (defaults to remaining)
  const [form, setForm] = useState({
    mode: "Road",
    carrierId: null,
    forwarderId: null,
    amount: "",
    currency: "PLN",
    fxRate: "1",
    loadingDate: todayISO(),
    expectedDeliveryDate: todayISO(),
    temperatureMinC: "2",
    temperatureMaxC: "8",
    originLocationId: null,
    destinationLocationId: null,
    product: "Goods",
    qtyKg: "1000",
    pallets: "1",
    lotRef: "",
    poRef: "",
    soRef: "",
    notes: "",
    // v6.10 (#11): under a DDP purchase the supplier arranges/pays the carrier;
    // we don't order it, but we track the incoming truck + driver to follow the
    // delivery. These seed the first leg's transport unit.
    ddpTruckPlate: "",
    ddpTrailerPlate: "",
    ddpDriverName: "",
    ddpDriverPhone: "",
  });
  function sf(k, v) { setForm(prev => ({ ...prev, [k]: v })); }
  const selectedPO = (pos || []).find(p => p.number === ref);
  const isDDPPurchase = sourceType === "PO" && !!selectedPO && String(selectedPO.buyIncoterm || "").toUpperCase() === "DDP";
  const selectedSO = (orders || []).find(o => o.number === ref);
  const selectedLot = (lots || []).find(l => l.number === form.lotRef);
  // v6.18.3 (#5): HARD-BLOCK over-shipping a PO. Compare kg already on non-cancelled
  // shipments for this PO, plus what THIS shipment would add (the selected lines'
  // qty), against the PO quantity. No override once it's fully covered or would exceed.
  // v6.34.8: source-agnostic descriptor so PO and SO share the same guard + progress + partial-qty UI.
  const srcDoc = sourceType === "PO" ? selectedPO : sourceType === "SO" ? selectedSO : null;
  const srcItems: any[] = srcDoc?.items || [];
  const srcRefMatch = (sh2: any) => sourceType === "PO"
    ? (sh2.poRefs || []).includes(selectedPO?.number)
    : (sh2.soRefs || []).includes(selectedSO?.number) || (sh2.goods || []).some((g: any) => g.soRef === selectedSO?.number);
  const srcGoodsMatch = (g: any) => sourceType === "PO" ? g.poRef === selectedPO?.number : g.soRef === selectedSO?.number;
  const srcLineKey = (g: any) => String((sourceType === "PO" ? (g.poLineId ?? g.lineId) : (g.soLineId ?? g.lineId)) ?? "");

  // v6.55.0: RECEIPTS, not "shipped". Only the inbound movement counts against a
  // PO line — a transfer to the warehouse or a delivery to a client moves goods
  // already received, and counting those is what made a PO look shipped twice.
  const lineShippedKgOuter: Record<string, number> = (() => {
    const map: Record<string, number> = {};
    if (!srcDoc) return map;
    // v6.58.0 REGRESSION FIX: v6.55.0 counted only INBOUND receipts here, but
    // the real flow ships OUTBOUND straight from the PO (EXW buy -> CIF sell),
    // so nothing was deducted and a second shipment re-proposed goods already
    // moved — and the phantom line bled into the transport order. The pre-fill
    // deducts kg on ANY live shipment of the line; nothing blocks (v6.55.0).
    (shipments || []).filter((s: any) => srcRefMatch(s) && !isCancelled(s))
      .forEach((s: any) => (s.goods || []).forEach((g: any) => {
        if (!srcGoodsMatch(g)) return;
        const key = srcLineKey(g);
        if (key) map[key] = (map[key] || 0) + parseNum(g.qtyKg);
      }));
    return map;
  })();
  const poShipState = (() => {
    if (!srcDoc) return null;
    const existing = (shipments || []).filter((s: any) => srcRefMatch(s) && !isCancelled(s));
    const poQty = srcItems.reduce((a: number, it: any) => a + parseNum(it.qty), 0);
    const shippedKg = existing.reduce((sum: number, s2: any) => sum + (s2.goods || []).filter((g: any) => srcGoodsMatch(g)).reduce((a: number, g: any) => a + parseNum(g.qtyKg), 0), 0);
    // v6.34.4: 'this shipment' kg = the per-line entered amounts (default: remaining), not the full line.
    const enteredFor = (it: any, idx: number) => {
      const id = String(it.id ?? idx + 1);
      const rem = Math.max(0, parseNum(it.qty) - (lineShippedKgOuter[id] || 0));
      const v = lineQtys[id];
      return (v === undefined || v === "") ? rem : parseNum(v);
    };
    const thisKg = srcItems.reduce((a: number, it: any, idx: number) => {
      const id = String(it.id ?? idx + 1);
      const on = selectedItemIds.length === 0 || selectedItemIds.map(String).includes(id);
      return a + (on ? enteredFor(it, idx) : 0);
    }, 0);
    const projected = shippedKg + thisKg;
    // v6.55.0: these are now WARNINGS, never blocks. A producer loading more than
    // ordered is routine and the PO already carries a variance field; refusing to
    // record the truck that is standing at the dock helps nobody.
    const overReceipt = sourceType === "PO" && String((form as any).flow || (form as any).purpose || "").toUpperCase().includes("PICKUP") && poQty > 0 && projected > poQty + 1;
    return { existing, poQty, shippedKg, thisKg, projected, remaining: Math.max(0, poQty - shippedKg), overReceipt, exceedBy: Math.max(0, Math.round(projected - poQty)) };
  })();

  // v6.34.4: per-LINE shipped kg (across non-cancelled shipments of this PO), so each
  // line's remaining-to-ship is correct — a PO line can ship across several trucks.
  const lineShippedKg = lineShippedKgOuter; // v6.34.8: same source-agnostic map
  const lineRemaining = (it: any, idx: number) => {
    const id = String(it.id ?? idx + 1);
    return Math.max(0, parseNum(it.qty) - (lineShippedKg[id] || 0));
  };
  const needsRef = sourceType !== "Manual" && !ref; // v6.18.14 (#4)
  // v6.55.0: the ONLY reason creation is blocked is a missing source reference.
  // The over-shipping guard is gone — a PO is consumed by sales orders, not by
  // movements, so no count of shipments can tell you a PO is used up.
  // v6.99.66 (A-SA-1, owner): a DRAFT sale may start a shipment (the buyer can still change), but its lines must be sourced — the truck
  // needs to know where it loads, and the producer's packing list needs the link to update the sale
  const draftUnsourced = sourceType === "SO" && selectedSO && selectedSO.status === "Draft" ? (selectedSO.items || []).filter((it: any) => !(it.sourceType && it.sourceRef)).length : 0;
  const blockCreate = needsRef || draftUnsourced > 0;
  // v6.16 (#4): the PO loading date starts the whole shipment and the SO delivery
  // date ends it. Prefill the header Expected loading / delivery dates from those
  // when the reference changes (in-between dates are set per leg later).
  React.useEffect(() => {
    if (sourceType === "PO" && selectedPO) {
      const linkedSO = (orders || []).find((o: any) => (o.items || []).some((it: any) => it.sourceType === "PO" && it.sourceRef === selectedPO.number));
      setForm(prev => ({
        ...prev,
        loadingDate: selectedPO.loadingDate || prev.loadingDate,
        expectedDeliveryDate: (linkedSO && (linkedSO.expectedDeliveryDate || linkedSO.deliveryDate)) || selectedPO.expectedDeliveryDate || prev.expectedDeliveryDate,   // v6.99.59 (A-OW-2)
      }));
    } else if (sourceType === "SO" && selectedSO) {
      const linkedPO = (pos || []).find((p: any) => (selectedSO.items || []).some((it: any) => it.sourceType === "PO" && it.sourceRef === p.number));
      setForm(prev => ({
        ...prev,
        loadingDate: selectedSO.expectedLoadingDate || (linkedPO && (linkedPO.expectedDeliveryDate || linkedPO.loadingDate)) || prev.loadingDate,   // v6.99.59 (A-OW-2): the SO's expected loading, else where its PO delivers
        expectedDeliveryDate: selectedSO.expectedDeliveryDate || selectedSO.deliveryDate || prev.expectedDeliveryDate,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, sourceType]);
  // v6.99.12: the create window no longer asks for providers — carriers live on the units (D9)
  // v6.99.43 (M-5): the preview describes THIS shipment — the ticked lines with the kilos entered, not the whole order
  function previewGoods(): string {
    const rows = (srcItems || []).map((it: any, idx: number) => { const id = String(it.id ?? idx + 1); const rem = lineRemaining(it, idx); if (rem <= 0) return null; const on = selectedItemIds.length === 0 || selectedItemIds.includes(id); if (!on) return null; const v = lineQtys[id] === undefined ? rem : parseNum(lineQtys[id]); return `${it.product}${it.variety ? " " + it.variety : ""} ${fmtNum(v)} kg`; }).filter(Boolean);
    return rows.length ? rows.join(", ") : "nothing left to load";
  }
  function create(governingSoRef = "") {
    // v6.99.43 (M-3, owner): a line can never ship more than what is left of it — the field is red, and Create refuses.
    if (sourceType !== "Manual") {
      const overs = (srcItems || []).map((it: any, idx: number) => { const id = String(it.id ?? idx + 1); const rem = lineRemaining(it, idx); const v = lineQtys[id] === undefined ? rem : parseNum(lineQtys[id]); return v > rem + 1 ? `${it.product || "line " + id}: ${fmtNum(v)} kg entered, ${fmtNum(rem)} kg left` : null; }).filter(Boolean);
      if (overs.length) { window.alert("Over the remainder:\n" + overs.join("\n")); return; }
    }
    let sh;
    if (sourceType === "PO" && selectedPO) {
      // v6.34.0 (BP-61, Reading 1): SOs sourcing from this PO. If MORE THAN ONE,
      // ask which SO/client this truck is for (mirrors the physical split at the
      // port) rather than silently attributing the wrong one — direction depends
      // on it. One SO → use it. None → unsold portion to our warehouse.
      const linkedSOList = (orders || [])
        .filter(o => o.status !== "Cancelled" && (o.items || []).some(it => it.sourceType === "PO" && it.sourceRef === selectedPO.number));
      if (linkedSOList.length > 1 && !governingSoRef) {
        setGoverningSoPrompt({ po: selectedPO, sos: linkedSOList });
        return; // wait for the pick; the picker calls create(chosenRef) to resume
      }
      const governing = (governingSoRef && governingSoRef !== "__none__")
        ? linkedSOList.find(o => o.number === governingSoRef)
        : (governingSoRef === "__none__" ? null : (linkedSOList[0] || null));
      const soRefs = governing ? [governing.number] : [];
      sh = buildShipmentFromPO(selectedPO, { ...form, soRefs, governingSoRef: governing?.number || "", selectedItemIds, lineQtys }, shipments, lots, governing, contacts);
    }
    else if (sourceType === "SO" && selectedSO) sh = buildShipmentFromSO(selectedSO, { ...form, selectedItemIds, lineQtys, governingSoRef: selectedSO.number }, shipments, lots, contacts); // v6.82.0 (Round 6): the chosen SO IS the governing sale
    else sh = buildManualShipment(form, shipments);
    // v6.10 (#11/#14): for a DDP purchase we don't order the carrier and carry no
    // freight cost on the supplier→warehouse leg. Seed the first road leg's unit
    // with the tracked incoming truck/driver, drop the carrier, zero the cost.
    if (isDDPPurchase && sh && Array.isArray(sh.legs) && sh.legs.length) {
      const firstRoad = sh.legs.find((l: any) => l.mode === "Road") || sh.legs[0];
      if (firstRoad) {
        firstRoad.carrierId = null;
        firstRoad.costAmount = 0;
        firstRoad.costPLN = 0;
        firstRoad.costResponsibility = "Supplier";
        if (form.ddpTruckPlate || form.ddpTrailerPlate || form.ddpDriverName || form.ddpDriverPhone) {
          firstRoad.vehicles = [{
            id: nextId(), mode: "Road", qtyKg: parseNum(form.qtyKg), pallets: parseNum(form.pallets),
            truckPlate: form.ddpTruckPlate || "", trailerPlate: form.ddpTrailerPlate || "",
            driverName: form.ddpDriverName || "", driverPhone: form.ddpDriverPhone || "",
            notes: "Supplier-arranged carrier (DDP)",
          }];
          firstRoad.vehiclePlate = form.ddpTruckPlate || "";
          firstRoad.trailerPlate = form.ddpTrailerPlate || "";
          firstRoad.driverName = form.ddpDriverName || "";
          firstRoad.driverPhone = form.ddpDriverPhone || "";
        }
      }
    }
    // v6.99.94 (A-GR-2): a groupage takes every ticked order's goods; no single governing order — each goods row keeps its own SO / PO / lot
    if (moreRefs.length) {
      let g: any = sh; const kind = sourceType === "PO" ? "PO" : "SO";
      moreRefs.forEach(no => { const doc = (kind === "PO" ? (pos || []) : (orders || [])).find((x: any) => String(x.number) === String(no)); if (doc) g = appendSourceGoods(g, kind, doc, lots || [], { todayISO: () => new Date().toISOString().slice(0, 10), nextId }); });
      g = { ...g, groupage: true, ...(kind === "SO" ? { governingSoRef: null } : {}) };
      onCreate(g); return;
    }
    onCreate(sh);
  }
  return <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(17,24,39,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
    <div style={{ width: 880, maxHeight: "90vh", overflow: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.22)", border: "1px solid #E5E7EB" }}>
      <div style={{ padding: "18px 22px", borderBottom: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><div style={{ fontSize: 18, fontWeight: 800 }}>Create shipment</div><div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>Build from PO, SO or a manual transport order.</div></div>
        <ActionButton action="close" onClick={onCancel} />
      </div>
      <div style={{ padding: 22, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <Card style={{ gridColumn: "1 / 3" }}>
          <SectionTitle>Source</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 160px 160px", gap: 12 }}>
            <div><Lbl>Source type</Lbl><Sel value={sourceType} onChange={e => { setSourceType(e.target.value); setRef(""); }}><option value="PO">From PO</option><option value="SO">From SO</option>{/* v6.99.43 (M-2, owner): Manual retired — a transfer between our warehouses is a movement, a return to the producer is the lot's Return action */}</Sel></div>
            {draftUnsourced > 0 && <div style={{ gridColumn: "1 / -1", fontSize: 11.5, fontWeight: 700, color: "#B91C1C", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, padding: "5px 8px" }}>{(selectedSO as any)?.number} is a draft with {draftUnsourced} unsourced line{draftUnsourced > 1 ? "s" : ""} — source them from the PO first (the truck needs to know where it loads).</div>}
            <div><Lbl>Reference</Lbl>{sourceType === "PO" ? <Sel value={ref} onChange={e => setRef(e.target.value)}><option value="">— Select PO —</option>{[...(pos || [])].sort((a: any, b: any) => String(b.number || "").localeCompare(String(a.number || ""), undefined, { numeric: true })).filter((p: any) => p.status !== "Draft" && p.status !== "Cancelled").map(p => <option key={p.number} value={p.number}>{p.number} - {p.supplier?.name}</option>)}</Sel> : sourceType === "SO" ? <Sel value={ref} onChange={e => setRef(e.target.value)}><option value="">— Select SO —</option>{[...(orders || [])].sort((a: any, b: any) => String(b.number || "").localeCompare(String(a.number || ""), undefined, { numeric: true })).filter((o: any) => o.status !== "Cancelled").map(o => <option key={o.number} value={o.number}>{o.number} - {o.client?.name}{o.status === "Draft" ? " — draft (the client may still change)" : ""}</option>)}</Sel> : <Inp value={form.notes} onChange={e => sf("notes", e.target.value)} placeholder="Manual notes" />}</div>
            {(sourceType === "PO" || sourceType === "SO") && ref && (() => {   // v6.99.94 (A-GR-2): groupage from the first window
              const pool = (sourceType === "PO" ? (pos || []).filter((p: any) => !isCancelled(p) && p.status !== "Draft") : (orders || []).filter((o: any) => !isCancelled(o) && o.status !== "Draft")).filter((x: any) => String(x.number) !== String(ref));
              return <div style={{ gridColumn: "1 / -1" }}><Lbl>Groupage <span style={{ color: "#BBB", fontWeight: 400 }}>· {sourceType === "SO" ? "more sales orders on the same truck — one drop each" : "more purchase orders on the same truck — one pickup each"}</span></Lbl>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  {moreRefs.map(no => <span key={no} style={{ padding: "3px 8px", borderRadius: 12, background: "#EEF2FF", color: "#3730A3", fontSize: 12, fontWeight: 700 }}>{no} <SmallButton kind="remove" title="Take it off the groupage" onClick={() => setMoreRefs(m => m.filter(x => x !== no))}>Remove</SmallButton></span>)}
                  <Sel value="" onChange={e => { const v = e.target.value; if (v) setMoreRefs(m => m.includes(v) ? m : [...m, v]); }} style={{ maxWidth: 360 }}>
                    <option value="">{moreRefs.length ? "+ add another" : `+ add a ${sourceType === "SO" ? "sales" : "purchase"} order (groupage)`}</option>
                    {pool.filter((x: any) => !moreRefs.includes(String(x.number))).map((x: any) => <option key={x.number} value={x.number}>{x.number} · {sourceType === "SO" ? (x.client?.name || "") : (x.supplier?.name || "")}</option>)}
                  </Sel>
                  {moreRefs.length > 0 && <span style={{ fontSize: 11.5, color: "#3730A3", fontWeight: 700 }}>Groupage · {moreRefs.length + 1} {sourceType === "SO" ? "drops" : "pickups"}</span>}
                </div></div>; })()}
            <div><Lbl>Mode</Lbl><Sel value={form.mode} onChange={e => setForm(prev => modeChangePatch(prev, e.target.value))}>{HEADER_MODES.map(m => <option key={m}>{m}</option>)}</Sel></div>
            {/* v6.92.0 (A-R8-7): the freight currency belongs to the unit price, not to the shipment. */}
          </div>
        </Card>

        {poShipState && poShipState.poQty > 0 && (poShipState.existing.length > 0 || poShipState.overReceipt) && (() => {
          const pct = Math.min(100, Math.round((poShipState.shippedKg / poShipState.poQty) * 100));
          const thisPct = Math.min(100 - pct, Math.round((poShipState.thisKg / poShipState.poQty) * 100));
          const blocked = false; // v6.55.0: nothing here blocks any more — informational only.
          return (
            <Card style={{ gridColumn: "1 / 3", background: blocked ? "#FEF2F2" : "#FFFBEB", border: `1px solid ${blocked ? "#FECACA" : "#FDE68A"}` }}>
              <div style={{ fontSize: 12.5, color: blocked ? "#991B1B" : "#92400E", lineHeight: 1.5, marginBottom: 10 }}>
                {poShipState.overReceipt ? "⚠" : "ℹ"} <strong>{srcDoc?.number}</strong> {sourceType === "PO" ? "has been received on" : "already has"} {poShipState.existing.length} shipment(s){poShipState.existing.length ? `: ${poShipState.existing.map((s: any) => s.number).join(", ")}` : ""}.
              </div>
              {/* kg bar: shipped (solid) + this shipment (striped) against PO total */}
              <div style={{ display: "flex", height: 22, borderRadius: 6, overflow: "hidden", border: "1px solid #E5E7EB", background: "#fff", marginBottom: 8 }}>
                <div style={{ width: `${pct}%`, background: "#3B82F6" }} title={`${sourceType === "PO" ? "Already received" : "Already shipped"}: ${fmtNum(poShipState.shippedKg)} kg`} />
                <div style={{ width: `${thisPct}%`, background: poShipState.overReceipt ? "#D97706" : "#22C55E", backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(255,255,255,0.35) 5px, rgba(255,255,255,0.35) 10px)" }} title={`This shipment: ${fmtNum(poShipState.thisKg)} kg`} />
              </div>
              <div style={{ fontSize: 11.5, color: "#475569", display: "flex", gap: 16, flexWrap: "wrap" }}>
                <span><span style={{ display: "inline-block", width: 9, height: 9, background: "#3B82F6", borderRadius: 2, marginRight: 4 }} />{sourceType === "PO" ? "Already received" : "Already shipped"} <strong>{fmtNum(poShipState.shippedKg)}</strong></span>
                <span><span style={{ display: "inline-block", width: 9, height: 9, background: poShipState.overReceipt ? "#D97706" : "#22C55E", borderRadius: 2, marginRight: 4 }} />This shipment <strong>{fmtNum(poShipState.thisKg)}</strong></span>
                <span>{sourceType} total <strong>{fmtNum(poShipState.poQty)}</strong> kg</span>
              </div>
              {blocked && (
                <div style={{ fontSize: 12.5, color: "#991B1B", fontWeight: 700, marginTop: 10 }}>
                  {poShipState.overReceipt
                    ? `More is arriving than was ordered — over by ${fmtNum(poShipState.exceedBy)} kg. Recorded as variance; nothing is blocked.`
                    : `${fmtNum(poShipState.remaining)} kg of this ${sourceType} not yet received.`}
                </div>
              )}
            </Card>
          );
        })()}

        {srcDoc && srcItems.length > 0 && (
          <Card>
            <SectionTitle>Products to load on this shipment</SectionTitle>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>This {sourceType} has {srcItems.length} product line(s). Tick the ones physically loaded on this shipment — only those appear on the transport order and goods. (None ticked = all loaded.)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {srcItems.map((it: any, idx: number) => {
                const id = String(it.id ?? idx + 1);
                // v6.99.43 (M-3, owner): what already went is not offered again. A line with nothing left is shown greyed and
                // cannot be ticked; a partially shipped line offers its remainder and says where the rest went.
                const rem0 = lineRemaining(it, idx);
                const done = rem0 <= 0;
                const shippedOn = (shipments || []).filter((s2: any) => s2 && s2.status !== "Cancelled" && (s2.goods || []).some((g: any) => (sourceType === "PO" ? String(g.poRef) === String(ref) && String(g.poLineId) === id : String(g.soRef) === String(ref) && String(g.soLineId) === id) && parseNum(g.qtyKg) > 0)).map((s2: any) => s2.number);
                const checked = !done && (selectedItemIds.length === 0 ? true : selectedItemIds.includes(id));
                return (
                  <label key={id} style={{ display: "inline-flex", gap: 7, alignItems: "center", fontSize: 12.5, border: "1px solid", borderColor: done ? "#E5E7EB" : (checked ? "#2563EB" : "#E5E7EB"), opacity: done ? 0.55 : 1, cursor: done ? "not-allowed" : "pointer", background: done ? "#F8FAFC" : checked ? "#EFF6FF" : "#fff", borderRadius: 8, padding: "7px 11px" }}>
                    <input type="checkbox" checked={checked} disabled={done} title={done ? `fully shipped${shippedOn.length ? " on " + shippedOn.join(", ") : ""}` : ""} onChange={() => { if (done) return;
                      const all = srcItems.map((x: any, i2: number) => String(x.id ?? i2 + 1));
                      // If currently "all" (empty), start from the full set, then toggle this id off.
                      const base = selectedItemIds.length === 0 ? all : selectedItemIds;
                      const next = base.includes(id) ? base.filter(x => x !== id) : [...base, id];
                      // If user re-selected everything, collapse back to "all" (empty array).
                      setSelectedItemIds(next.length === all.length ? [] : next);
                    }} />
                    <span><strong>{it.product || "Product"}{it.variety ? " — " + it.variety : ""}</strong>{it.size ? ` · ${it.size}` : ""}{it.packaging ? ` · ${it.packaging}` : ""} · ordered {fmtNum(parseNum(it.qty))} kg{done ? <span style={{ marginLeft: 6, color: "#DC2626", fontWeight: 700 }}>fully shipped{shippedOn.length ? ` on ${shippedOn.join(", ")}` : ""}</span> : (rem0 < parseNum(it.qty) ? <span style={{ marginLeft: 6, color: "#B45309" }}>{fmtNum(parseNum(it.qty) - rem0)} kg already on {shippedOn.join(", ") || "another shipment"}</span> : null)}</span>
                    {checked && (() => {
                      const rem = lineRemaining(it, idx);
                      const val = lineQtys[id] === undefined ? String(rem) : lineQtys[id];
                      const over = parseNum(val) > rem + 1;   // v6.99.43 (M-3): shown red AND refused at create (below)
                      return (
                        <span onClick={(e: any) => e.preventDefault()} style={{ display: "inline-flex", alignItems: "center", gap: 5, marginLeft: 4 }}>
                          <span style={{ fontSize: 11, color: "#64748B" }}>ship now</span>
                          <input type="text" inputMode="decimal" value={val} onClick={(e: any) => e.stopPropagation()} onChange={e => { const v = e.target.value; setLineQtys(m => ({ ...m, [id]: v })); }}
                            style={{ width: 78, border: "1px solid", borderColor: over ? "#DC2626" : "#CBD5E1", borderRadius: 6, padding: "3px 6px", fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace", textAlign: "right" }} />
                          <span style={{ fontSize: 10.5, color: over ? "#DC2626" : "#94A3B8" }}>/ {fmtNum(rem)} left</span>
                        </span>
                      );
                    })()}
                  </label>
                );
              })}
            </div>
          </Card>
        )}
        {/* v6.99.43 (M-4, owner): "Provider and cost" left the create window — the carrier and the price live on the UNIT (v6.99.8); the leg provider was a vestige nothing reads. */}
        <Card>
          <SectionTitle>Dates</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><Lbl>Expected loading date <span style={{ color: "#2563EB", fontWeight: 400 }}>{(selectedSO || selectedPO) ? `· from ${(selectedSO || selectedPO).number}` : ""}</span></Lbl>{(selectedSO || selectedPO)
              ? <div style={{ padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 13, background: "#F8FAFC" }}>{form.loadingDate ? formatDMY(form.loadingDate) : "— not on the document —"}</div>
              : <Inp type="date" value={form.loadingDate} onChange={e => sf("loadingDate", e.target.value)} />}</div>
            <div><Lbl>Expected delivery date <span style={{ color: "#2563EB", fontWeight: 400 }}>{(selectedSO || selectedPO) ? `· from ${(selectedSO || selectedPO).number}` : ""}</span></Lbl>{(selectedSO || selectedPO)
              ? <div style={{ padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 13, background: "#F8FAFC" }}>{form.expectedDeliveryDate ? formatDMY(form.expectedDeliveryDate) : "— not on the document —"}</div>
              : <Inp type="date" value={form.expectedDeliveryDate} onChange={e => sf("expectedDeliveryDate", e.target.value)} />}</div>
          </div>
          {/* BP-60 part C (v6.57.0): creating a shipment is BOOKING a truck.
              Temperature range moved to the editor's Execution stage — it is
              carried forward from the product defaults and almost never changed
              at booking, so asking for it here was two fields of noise on the
              screen you use most. Plates, drivers and recorder numbers were
              already there; this finishes the job. */}
          <div style={{ marginTop: 9, fontSize: 10.5, color: "#94A3B8", lineHeight: 1.5 }}>
            Temperature range, plates, drivers and recorder numbers are set in the shipment editor once the carrier confirms — booking only needs who, what, where and when.
          </div>
        </Card>
        {sourceType === "Manual" && <Card style={{ gridColumn: "1 / 3" }}>
          <SectionTitle>Manual goods and route</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.7fr 0.7fr 1fr 1fr", gap: 10 }}>
            <div><Lbl>Product</Lbl><Inp value={form.product} onChange={e => sf("product", e.target.value)} /></div>
            <div><Lbl>Qty kg</Lbl><Inp type="number" value={form.qtyKg} onChange={e => sf("qtyKg", e.target.value)} /></div>
            <div><Lbl>Pallets</Lbl><Inp type="number" value={form.pallets} onChange={e => sf("pallets", e.target.value)} /></div>
            <div><Lbl>From</Lbl><Sel value={form.originLocationId} onChange={e => sf("originLocationId", e.target.value)}>{mergedLocations(contacts).map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</Sel></div>
            <div><Lbl>To</Lbl><Sel value={form.destinationLocationId} onChange={e => sf("destinationLocationId", e.target.value)}>{mergedLocations(contacts).map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</Sel></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
            <div><Lbl>PO ref</Lbl><Inp value={form.poRef} onChange={e => sf("poRef", e.target.value)} /></div>
            <div><Lbl>SO ref</Lbl><Inp value={form.soRef} onChange={e => sf("soRef", e.target.value)} /></div>
            <div><Lbl>Lot ref</Lbl><Sel value={form.lotRef} onChange={e => sf("lotRef", e.target.value)}><option value="">No lot</option>{(lots || []).map(l => <option key={l.number} value={l.number}>{l.number} - {l.product}</option>)}</Sel>{selectedLot && <div style={{ fontSize: 10.5, color: "#888", marginTop: 3 }}>Stock: {fmtNum(selectedLot.physicalKg)} kg</div>}</div>
          </div>
        </Card>}
        <Card style={{ gridColumn: "1 / 3", background: "#F9FAFB" }}>
          <SectionTitle>Preview</SectionTitle>
          <div style={{ fontSize: 12, color: "#444", lineHeight: 1.6 }}>
            {sourceType === "PO" && selectedPO && <div><strong>{selectedPO.number}</strong> from {selectedPO.supplier?.name}. Loading now: {previewGoods()}. Route: {placeForPrint(null, selectedPO.supplier?.name ? `${selectedPO.supplier.name}` : "", contacts).line || "supplier"} → {placeForPrint(selectedPO.destinationLocationId, selectedPO.destinationText, contacts).line || "—"}.</div>}   {/* v6.99.43 (M-5): what this shipment carries and where it really goes, with the address */}
            {sourceType === "SO" && selectedSO && <div><strong>{selectedSO.number}</strong> for {selectedSO.client?.name}. Loading now: {previewGoods()}. Route: our warehouse → {placeForPrint(selectedSO.destinationLocationId, selectedSO.destinationText || selectedSO.client?.address, contacts).line || "—"}.</div>}
            {sourceType === "Manual" && <div>Manual shipment: {form.product}, {fmtNum(form.qtyKg)} kg, {locText(form.originLocationId)} {"->"} {locText(form.destinationLocationId)}.</div>}
          </div>
        </Card>
      </div>
      <div style={{ padding: "14px 22px", borderTop: "1px solid #E5E7EB", display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <SmallButton onClick={onCancel}>Cancel</SmallButton>
        <SmallButton kind="green" onClick={() => create()} disabled={blockCreate} title={needsRef ? `Select a ${sourceType} first` : "step 2 opens right away: arrange the transport"}>Create and arrange →</SmallButton>
      </div>

      {/* v6.34.0 (BP-61): which SO/client is this truck for? Shown only when the
          source PO links more than one active SO — mirrors the physical split at
          the port. Each choice resolves this shipment's trade direction from its
          own real ends (producer × that SO's destination). */}
      {governingSoPrompt && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", zIndex: 8000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setGoverningSoPrompt(null)}>
          <div onClick={(e: any) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: 560, maxWidth: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.3)", padding: 22 }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>Which sales order is this truck for?</div>
            <div style={{ fontSize: 12, color: "#64748B", marginBottom: 14 }}>
              PO <b>{governingSoPrompt.po.number}</b> is sold to {governingSoPrompt.sos.length} clients. Pick the one this shipment serves — it sets the destination and the trade direction. If this truck is the unsold portion going to your warehouse, choose that.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
              {governingSoPrompt.sos.map((o: any) => {
                const dir = shipmentTradeDirection(null, governingSoPrompt.po, o, countryOfLocation);
                const lbl = MOVE_LBL[dir] || MOVE_LBL.IMPORT;
                const dest = o.destinationText || (o.destinationLocationId != null ? (locById(o.destinationLocationId)?.name || "") : "") || o.client?.country || "—";
                return (
                  <button key={o.number} onClick={() => { setGoverningSoPrompt(null); create(o.number); }} style={{ textAlign: "left", border: "1px solid #E5E7EB", borderRadius: 9, padding: "10px 12px", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 800, color: "#2563EB" }}>{o.number}</span>
                    <span style={{ fontSize: 12.5 }}>{o.client?.name || "(client)"} · {o.sellIncoterm || "—"} {dest}</span>
                    <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 800, color: "#fff", background: lbl.color, borderRadius: 999, padding: "2px 9px" }}>{lbl.label}</span>
                  </button>
                );
              })}
              <button onClick={() => { setGoverningSoPrompt(null); create("__none__"); }} style={{ textAlign: "left", border: "1px dashed #CBD5E1", borderRadius: 9, padding: "10px 12px", background: "#F8FAFC", cursor: "pointer", fontSize: 12.5, color: "#475569" }}>
                None — this truck is the unsold portion going to our warehouse
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  </div>;
}
