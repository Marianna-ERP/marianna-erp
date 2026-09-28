// ShipmentEditor.tsx — v6.99.68 (A-AUD-2, owner): moved out of Shipments.tsx unchanged; the module's shared helpers are imported from it.
import LocationPicker from "./LocationPicker";
import React, { useState } from "react";
import { CUSTOMS_PLACES, CUSTOMS_PARTIES, readCustoms, customsGaps } from "./customs.domain";
import { MOVEMENT_LABELS as MOVE_LBL, shipmentTradeDirection } from "./tradeFlow.domain";
import { SmallButton, useConfirm } from "./ui";
import { derivedBillingStatus, legKgChecks, autoFillSingleUnitKg } from "./shipments.domain";
import { clearanceLinesFor, crossCheckClearance, parseCustomsFile, findClearanceHome, applyCustomsFile, detachClearance, CLEARANCE_STATUSES, CUSTOMS_FILE_LABEL } from "./customsClearance.domain";   // v6.99.72 (A-CU-3)
import { containerRecorder, allocationRemaining, unitKg, allocateGoodsToTrucks, setFeeders, feedersOf, cutOffWarnings, stuffingViolations, blankBooking, setUnitLoad, addFeederChecked, truckRemainingForFeeding, autoAllocate, carrierOfUnit, followBookingDates } from "./shipmentModel.domain";
import { grossForGoodsLine, PACKAGING_SEED } from "./packaging.domain";
import { inspectLink } from "./docLinks.domain";
import { localTodayISO, formatDMY } from "./dates";
import { nextId } from "./ids";
import { appendSourceGoods, normalizeCustoms, syncLegFreightCostLines } from "./shipments.domain";
import { recordAudit } from "./audit";
import { resolveFxRate, defaultFxRate, documentFxDefault } from "./fx";
import { locationById, placeForPrint } from "./locations";
import { useUnsavedGuard, dirtyEntries } from "./unsaved";
import { COST_TYPES, Card, HEADER_MODES, Inp, LEG_MODES, LEG_STATUSES, Lbl, ModeBadge, STATUS_ORDER, SectionTitle, Sel, Stage, allUnitsCarrierNames, blankTransportUnit, costLinesByCarrierLegApply, countryOfLocation, findUnitIn, fmtMoney, fmtNum, goodsRowCap, isFreightCostType, logisticsProviders, modeChangePatch, parseNum, shipmentCostPLN, shipmentVehicleCount, syncCustomsCostLine, todayISO, transportUnitsForLeg, withStandardDocs, setContactsRef, setOtherShipmentsRef } from "./Shipments";

export function EditShipmentModal({ shipment, contacts, lots = [], pos = [], orders = [], packagingTypes = [], onSave, onCancel, allShipmentsForCap = [], invoices = [] }: any) {
  setContactsRef(contacts || []);
  setOtherShipmentsRef(allShipmentsForCap || []);
  // v6.57.0 (BP-60 part D): which lifecycle stage is expanded. Booking opens by
  // default because that is where a new shipment starts; the rest stay closed
  // until their information exists.
  // v6.99.49 (S-2): the phase that opens follows the status — arranging while Draft/Booked, executing once loaded, closing once delivered
  const [openStages, setOpenStages] = useState<Record<string, boolean>>(() => { const st = String(shipment?.status || ""); const ex = ["Loaded", "In transit"].includes(st); const cl = ["Delivered", "Closed"].includes(st); return { booking: !ex && !cl, execution: ex, closing: cl }; });
  const toggleStage = (k: string) => setOpenStages(o => ({ ...o, [k]: !o[k] }));
  const { confirm: uiConfirm, alert: uiAlert, dialogNode: editDialogNode } = useConfirm(); // P2-6
  const [draft, setDraft] = useState(() => {
    const d = withStandardDocs(JSON.parse(JSON.stringify(shipment)));
    d.customs = normalizeCustoms(d.customs || d.customsClearance); // BP-27 string→object migration on open
    return d;
  });
  // v6.99.58 (A-US): the Save button and the leave-guard call the SAME function — so every warning and gate still applies
  function saveShipmentDraft() {
          // v6.99.44 (L-6, owner): a unit with no price or no carrier is named before saving — a warning, never a block (the price can arrive after the booking)
          if (draft.arrangedBy !== "SUPPLIER") {
            const gaps = (draft.legs || []).flatMap((l: any, li: number) => (l.vehicles || []).map((u: any, ui: number) => { const miss = [!(parseNum(u.costAmount) > 0) && "no price", (carrierOfUnit(draft, l, u) == null) && "no carrier"].filter(Boolean); return miss.length ? `leg ${li + 1} · ${u.truckPlate || u.containerNo || "unit " + (ui + 1)}: ${miss.join(", ")}` : null; })).filter(Boolean);
            // v6.99.59 (A-CB-1): a cost line without its carrier / forwarder is named too — the line only LOOKED complete before
            (draft.costs || []).forEach((c: any, ci: number) => { if (!c.supplierId && (parseNum(c.amount) > 0 || c.type)) gaps.push(`cost line ${ci + 1} (${c.type || "cost"}${parseNum(c.amount) > 0 ? " · " + c.amount + " " + (c.currency || "") : ""}): no supplier`); });
            if (gaps.length && !window.confirm("Some items are incomplete:\n" + gaps.join("\n") + "\n\nSave anyway?")) return;
          }
          onSave(costLinesByCarrierLegApply(syncCustomsCostLine(autoAllocate(autoFillSingleUnitKg(draft), 0))));
  }
  useUnsavedGuard({ id: "shipment-editor", label: `Shipment ${draft?.number || ""}`.trim(), draft, save: () => saveShipmentDraft() });
  // v6.99.59 (A-OW-3): closing the WINDOW asks like leaving the module does — the guard covers both
  const [closeAsk, setCloseAsk] = useState(false);
  function requestClose() { if (dirtyEntries().some((e: any) => e.id === "shipment-editor")) setCloseAsk(true); else onCancel(); }
  const [govChange, setGovChange] = useState(false);   // v6.99.44 (H-6)
  const [govPrev, setGovPrev] = useState<string>("");   // v6.99.59 (A-OW-6)
  // v6.93.0: roadProviders no longer used — carriers live on the units (A-R8-4/9)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const roadProviders = logisticsProviders(contacts, "Road");
  const customsProviders = logisticsProviders(contacts, "Customs");
  function sf(k, v) { setDraft(prev => ({ ...prev, [k]: v })); }
  function updateLeg(idx, k, v) {
    // FB-16: a later leg can't load before the previous leg delivers.
    if (k === "plannedPickupDate" && idx > 0) {
      const prevDel = String((draft.legs || [])[idx - 1]?.plannedDeliveryDate || "").slice(0, 10);
      if (prevDel && v && String(v).slice(0, 10) < prevDel) {
        // FB-16: silently clamp — a later leg can't load before the previous delivers.
        v = prevDel;
      }
    }
    setDraft(prev => ({ ...prev, legs: (prev.legs || []).map((l, i) => i === idx ? { ...l, [k]: v } : l) }));
  }
  // v6.3.0: set a leg's From/To in one update, and auto-chain — when leg N's "To"
  // changes and leg N+1 has an empty "From", the next leg starts where this one ends.
  function updateGood(idx, k, v) {
    setDraft(prev => ({ ...prev, goods: (prev.goods || []).map((g, i) => {
      if (i !== idx) return g;
      const ng: any = { ...g, [k]: v };
      // v6.44.0 (#7): when net changes and gross hasn't been hand-set, keep gross
      // in step with the packaging tare (net + boxes*tare).
      if (k === "qtyKg" && (!g.grossKg || g._grossAuto)) {
        const gr = grossForGoodsLine({ qtyKg: v, product: ng.product, packaging: ng.packaging }, packagingTypes.length ? packagingTypes : PACKAGING_SEED);
        ng.grossKg = gr.grossKg; ng._grossAuto = true;
      }
      if (k === "grossKg") ng._grossAuto = false; // user took over
      return ng;
    }) }));
  }
  function autoGross(idx: number) {
    setDraft(prev => ({ ...prev, goods: (prev.goods || []).map((g, i) => {
      if (i !== idx) return g;
      const gr = grossForGoodsLine({ qtyKg: g.qtyKg, product: g.product, packaging: g.packaging }, packagingTypes.length ? packagingTypes : PACKAGING_SEED);
      return { ...g, grossKg: gr.grossKg, _grossAuto: true };
    }) }));
  }
  function updateCost(idx, k, v) {
    setDraft(prev => ({ ...prev, costs: (prev.costs || []).map((c, i) => {
      if (i !== idx) return c;
      const next = { ...c, [k]: v };
      if (["amount", "fxRate", "currency"].includes(k)) next.amountPLN = Math.round(parseNum(next.amount) * parseNum(next.fxRate, next.currency === "PLN" ? 1 : 1) * 100) / 100;
      return next;
    }) }));
  }
  function updateDoc(idx, k, v) {
    setDraft(prev => ({ ...prev, documents: (prev.documents || []).map((d, i) => i === idx ? { ...d, [k]: v } : d) }));
  }
  function addDoc() {
    setDraft(prev => ({ ...prev, documents: [...(prev.documents || []), { id: nextId(), type: "", ref: "", status: "Missing", date: "", notes: "", link: "" }] }));
  }
  async function removeDoc(idx) {
    const d = (draft.documents || [])[idx];
    if (d && (d.type || d.ref) && !(await uiConfirm({ tone: "warn", title: "Remove document row", message: `Remove document row "${d.type || d.ref}"?`, confirmLabel: "Remove" }))) return;
    setDraft(prev => ({ ...prev, documents: (prev.documents || []).filter((_, i) => i !== idx) }));
  }
  // v6.58.0 (user ruling): a two-leg shipment must open with one preliminary
  // cost line PER LEG — carrier's road leg and forwarder's sea leg — instead of
  // an empty table typed from scratch. Zero-amount until priced; only fills a
  // truly empty cost table so nothing already entered is touched.
  React.useEffect(() => {
    // v6.62.0: the v6.58.0 rule only filled a TRULY EMPTY cost table, so typing
    // a freight amount on the create form seeded one line and silently disabled
    // the whole thing — which is why it worked on one trial and not the next.
    // Now: ensure ONE line per leg that has a provider, adding only what is
    // missing and never touching what has been entered.
    const legs = (draft.legs || []).filter((l: any) => l.mode && (l.carrierId || l.forwarderId));
    if (legs.length < 2) return;
    const missing = legs.filter((l: any) => !(draft.costs || []).some((c: any) =>
      String(c.legId ?? "") === String(l.id) ||
      String(c.supplierId ?? "") === String(l.carrierId || l.forwarderId)));
    if (!missing.length) return;
    setDraft((prev: any) => ({ ...prev, costs: [...(prev.costs || []), ...missing.map((l: any, i: number) => ({
      id: nextId() + i, type: l.mode === "Sea" ? "sea_freight" : l.mode === "Air" ? "air_freight" : l.mode === "Rail" ? "rail_freight" : "road_freight", legId: l.id,
      supplierId: l.carrierId || l.forwarderId || prev.carrierId || prev.forwarderId || 1001,
      amount: 0, currency: l.costCurrency || "PLN", fxRate: resolveFxRate(null, l.costCurrency || "PLN"),
      amountPLN: 0, invoiceStatus: "Expected", invoiceRef: "", allocationMethod: "by_kg",
      notes: `Leg ${i + 1} · ${l.mode}`,
    }))] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(draft.legs || []).length, (draft.legs || []).map((l: any) => `${l.carrierId || ""}/${l.forwarderId || ""}`).join(",")]);

  function addCost() {
    // New manual lines default to a non-freight type ("other") so they're freely
    // deletable; freight lines are reserved for the per-leg freight created by the builder.
    // v6.18.17 (D11): default the currency to the shipment's working currency (taken from an
    // existing cost line, else the first leg) instead of always PLN, with the matching FX.
    setDraft(prev => {
      const baseCur = (prev.costs && prev.costs[0] && prev.costs[0].currency) || ((prev.legs || [])[0] || {}).costCurrency || "PLN";
      return { ...prev, costs: [...(prev.costs || []), { id: nextId(), type: "other", supplierId: prev.carrierId || prev.forwarderId || 1001, amount: 0, currency: baseCur, fxRate: resolveFxRate(null, baseCur), amountPLN: 0, invoiceStatus: "Expected", invoiceRef: "", allocationMethod: "by_kg", notes: "" }] };
    });
  }
  async function removeCost(idx) {
    const c = (draft.costs || [])[idx];
    // v6.34.5: deleting the auto customs line must also switch OFF "customs applies",
    // otherwise the save-time sync regenerates it (the resurrection bug).
    if (c && (c._customsAuto || c.source === "customs-auto")) {
      setDraft((d: any) => ({ ...d, customs: { ...(d.customs || {}), applies: false }, costs: (d.costs || []).filter((_: any, i: number) => i !== idx) }));
      return;
    }
    // Freight lines are normally protected — a shipment must keep its freight cost.
    // Exception (v6.18.19): a DAP/DDP purchase ("Bought DAP/DDP" ticked) means the
    // supplier arranges and pays transport, so no freight belongs to us — the line can
    // be erased. This matches the UI, which already shows the ✕ instead of the lock then.
    if (c && isFreightCostType(c.type) && !draft.supplierManagedTransport) {
      await uiAlert({ tone: "warn", title: "Freight line is protected", message: "Freight lines (road / sea / air / rail freight) can't be deleted here — a shipment must keep its freight cost. Change the amount to 0 if it doesn't apply, or edit the type.\n\nIf the supplier arranges and pays transport, tick \u201cBought DAP/DDP\u201d above and this line can be removed." });
      return;
    }
    if (!(await uiConfirm({ tone: "danger", title: "Delete cost line", message: "Delete this cost line?", confirmLabel: "Delete" }))) return;
    setDraft(prev => ({ ...prev, costs: (prev.costs || []).filter((_, i) => i !== idx) }));
  }

  function updateVehicle(legIdx, unitIdx, k, v) {
    setDraft(prev => ({
      ...prev,
      legs: (prev.legs || []).map((leg, i) => {
        if (i !== legIdx) return leg;
        const units = transportUnitsForLeg(leg);
        const nextUnits = (units.length ? units : [blankTransportUnit(leg.mode)]).map((u, ui) => {
          if (ui !== unitIdx) return u;
          return { ...u, [k]: v };
        });
        return { ...leg, vehicles: nextUnits };
      })
    }));
  }

  // v6.99.44 (L-3/L-4/L-5, owner): what the documents already know is PROPOSED on the unit — loading place from the PO
  // (or the lot's warehouse), delivery place from the SO (or the PO's named place), expected dates from the documents.
  // The unit stays editable: the truck's plan refines the order's expectation.
  function unitProposals(d: any) {
    const so = (orders || []).find((o: any) => String(o.number) === String(d.governingSoRef || (d.soRefs || [])[0])) || null;
    const po = (pos || []).find((pp: any) => (d.poRefs || []).includes(pp.number)) || null;
    const inbound = String(d.purpose || "").toUpperCase() === "INBOUND" || (!!po && !so);
    const lotOf = (d.goods || []).map((g: any) => (lots || []).find((l: any) => String(l.number) === String(g.lotRef))).find(Boolean);
    const loadId = inbound ? (po?.destinationLocationId && ["EXW", "FCA"].includes(String(po?.buyIncoterm || "").toUpperCase()) ? po.destinationLocationId : null) : (lotOf?.locationId ?? null);
    const loadText = inbound ? (po?.destinationText || po?.supplier?.name || "") : "";
    const delId = inbound ? (po?.destinationLocationId ?? null) : (so?.destinationLocationId ?? null);
    const delText = inbound ? (po?.destinationText || "") : (so?.destinationText || so?.client?.address || "");
    const loadDate = inbound ? (po?.loadingDate || "") : (so?.expectedLoadingDate || "");
    const delDate = inbound ? (po?.expectedDeliveryDate || "") : (so?.expectedDeliveryDate || "");
    return { loadId, loadText, delId, delText, loadDate, delDate, from: inbound ? po?.number : so?.number };
  }
  function addVehicle(legIdx) {
    setDraft(prev => {
      const unit: any = blankTransportUnit((prev.legs || [])[legIdx]?.mode);
      if (legIdx === 0) { const pr = unitProposals(prev); if (pr.loadId != null || pr.loadText) { unit.pickupLocationId = pr.loadId; unit.pickupText = pr.loadText; } if (pr.delId != null || pr.delText) { unit.deliveryLocationId = pr.delId; unit.deliveryText = pr.delText; } if (pr.loadDate) unit.plannedLoadingDate = pr.loadDate; if (pr.delDate) unit.plannedDeliveryDate = pr.delDate; }   // v6.99.44 (L-3/4/5)
      if (legIdx > 0 && ["sea", "air", "rail"].includes(String((prev.legs || [])[legIdx]?.mode || "").toLowerCase())) {   // v6.99.44 (L-7, owner)
        const b = (prev.bookings || [])[0] || {};
        if (b.polId != null || b.pol) { unit.pickupLocationId = b.polId ?? null; unit.pickupText = b.pol || unit.pickupText; }
        if (b.podId != null || b.pod) { unit.deliveryLocationId = b.podId ?? null; unit.deliveryText = b.pod || unit.deliveryText; }
        if (b.etd) unit.plannedLoadingDate = b.etd; if (b.eta) unit.plannedDeliveryDate = b.eta;
      }
      // v6.99.6 (A-R9-13): the new unit pre-fills with what is still UNALLOCATED on each goods row (only on the road leg; containers take their kg from feeders)
      if (legIdx === 0) {
        const load = (prev.goods || []).map((g: any) => ({ goodsLineId: g.id, qtyKg: allocationRemaining(prev, g.id) })).filter((a: any) => a.qtyKg > 0);
        if (load.length) { unit.load = load; }   // v6.99.8: NOT manual — it takes the remainder now and re-derives with the goods later
      }
      return { ...prev, legs: (prev.legs || []).map((leg, i) => i === legIdx ? { ...leg, vehicles: [...transportUnitsForLeg(leg), unit] } : leg) };
    });
  }
  function removeVehicle(legIdx, unitIdx) {
    // v6.99.69 (A-CF-2, owner): a row in an unsaved editor goes without a dialog — unless the truck already carries what someone typed
    { const u: any = transportUnitsForLeg((draft.legs || [])[legIdx] || {})[unitIdx] || {}; const has = [u.truckPlate, u.trailerPlate, u.driverName].some(Boolean) || parseNum(u.costAmount) > 0;
      if (has && !window.confirm(`Remove ${u.truckPlate || u.containerNo || "this unit"}? Its plates, driver and price are lost.`)) return; }
    setDraft(prev => ({
      ...prev,
      legs: (prev.legs || []).map((leg, i) => i === legIdx ? { ...leg, vehicles: transportUnitsForLeg(leg).filter((_, ui) => ui !== unitIdx) } : leg)
    }));
  }
  function addLeg() {
    setDraft(prev => {
      const prevLegs = prev.legs || [];
      const last = prevLegs[prevLegs.length - 1];
      return {
        ...prev,
        legs: [...prevLegs, {
          id: nextId(),
          mode: prev.mode === "Sea" ? "Sea" : "Road",
          status: "Booked",
          // auto-chain: a new leg starts where the previous one ends
          fromLocationId: last ? (last.toLocationId ?? null) : null,
          toLocationId: null,
          fromCustom: last ? (last.toLocationId ? "" : (last.toCustom || "")) : "",
          toCustom: "",
          carrierId: prev.carrierId || null,
          forwarderId: prev.forwarderId || null,
          plannedPickupDate: prev.loadingDate || todayISO(),
          plannedDeliveryDate: prev.expectedDeliveryDate || todayISO(),
          // v6.66.0 (D-23): multimodal redundancy — what the truck carried IS what
          // the container carries. Each unit of the new leg starts with the previous
          // leg's weight, pallets and temp-recorder number (all editable, for the
          // collapsed-pallet repack case).
          vehicles: transportUnitsForLeg(last || {}).map((u: any) => ({
            ...blankTransportUnit(prev.mode === "Sea" ? "Sea" : "Road"),
            qtyKg: u.qtyKg || 0, pallets: u.pallets || 0, tempRecorderNo: u.tempRecorderNo || "",
          })),
          notes: ""
        }]
      };
    });
  }
  async function removeLeg(legIdx) {
    { const leg: any = (draft.legs || [])[legIdx] || {}; const units = transportUnitsForLeg(leg).length; if (units && !window.confirm(`Remove leg ${legIdx + 1} with its ${units} unit(s)? Their plates, prices and dates are lost.`)) return; }   // v6.99.69 (A-CF-2)
    if ((draft.legs || []).length <= 1) { await uiAlert({ tone: "warn", title: "Can't remove leg", message: "A shipment needs at least one leg." }); return; }
    setDraft(prev => {
      if ((prev.legs || []).length <= 1) { return prev; }
      return { ...prev, legs: (prev.legs || []).filter((_, i) => i !== legIdx) };
    });
  }

  return <div style={{ position: "fixed", inset: 0, zIndex: 65, background: "rgba(17,24,39,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
    {editDialogNode}
    <div style={{ width: "min(1400px, calc(100vw - 20px))", height: "calc(100vh - 20px)", overflow: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.22)", border: "1px solid #E5E7EB" }}>
      <div style={{ padding: "18px 22px", borderBottom: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          {closeAsk && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ background: "#fff", borderRadius: 12, width: "min(480px, 100%)", border: "2px solid #D97706", overflow: "hidden" }}>
                <div style={{ background: "#FFFBEB", borderBottom: "1px solid #FDE68A", padding: "12px 16px", fontSize: 14, fontWeight: 800, color: "#92400E" }}>Unsaved changes on {draft.number}</div>
                <div style={{ padding: "12px 16px", fontSize: 13, color: "#334155" }}>Closing now loses what you changed since opening.</div>
                <div style={{ borderTop: "1px solid #E5E7EB", background: "#F8FAFC", padding: "10px 16px", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => setCloseAsk(false)} style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Stay</button>
                  <button onClick={() => { setCloseAsk(false); onCancel(); }} style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid #FECACA", background: "#fff", color: "#B91C1C", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Close without saving</button>
                  <button onClick={() => { setCloseAsk(false); saveShipmentDraft(); }} style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: "#16A34A", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>Save and close</button>
                </div>
              </div>
            </div>
          )}
          <div style={{ fontSize: 18, fontWeight: 800 }}>{draft.__isNew ? "New shipment" : "Edit"} {draft.number}{draft.__isNew && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 6, background: "#DBEAFE", color: "#2563EB", verticalAlign: "middle" }}>STEP 2 OF 2 · arrange the transport · nothing saved until you click Save</span>}</div>
          <div style={{ fontSize: 12, color: "#888" }}>Route, legs, units, goods sources, costs, customs and documents — the complete operational document in one place.</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "#94A3B8" }}>SOURCES:</span>
            {[...(draft.poRefs || []), ...(draft.soRefs || [])].map((r: any) => <span key={r} style={{ fontSize: 10.5, fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "#F1F5F9", color: "#334155" }}>{r}</span>)}
            <span style={{ fontSize: 10.5, color: "#94A3B8" }}> · carrying {(draft.goods || []).length} row(s) · {(draft.goods || []).reduce((t: number, g: any) => t + (parseFloat(g.qtyKg) || 0), 0).toLocaleString("pl-PL")} kg{(() => { const docs = Array.from(new Set([...(draft.poRefs || []), ...(draft.soRefs || [])])); return docs.length ? ` (from ${docs.join(" and ")})` : ""; })()}</span>{/* v6.99.49 (H-1): the shipment's own goods, from every document it carries */}
          </div>
          {/* Groupage add-source bar (BP-53) — one prominent line so linking more cargo is easy. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "nowrap", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 9, padding: "8px 10px" }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: "#1D4ED8" }}>GROUPAGE · add another document's cargo:</span>{/* v6.99.49 (H-2) */}
            <select value="" onChange={e => { const po = pos.find((p: any) => p.number === e.target.value); if (po) setDraft(prev => appendSourceGoods(prev, "PO", po, lots, { todayISO: localTodayISO, nextId })); e.target.value = ""; }}
              style={{ fontSize: 12, fontWeight: 700, padding: "7px 10px", borderRadius: 7, border: "1px solid #2563EB", background: "#fff", color: "#1D4ED8", cursor: "pointer", width: 230, maxWidth: 230, textOverflow: "ellipsis" }}>   {/* v6.99.59 (A-OW-4 · H-2): both pickers on one line */}
              <option value="">＋ Link another PO…</option>
              {pos.filter((p: any) => !["Draft", "Cancelled"].includes(p.status) && !(draft.poRefs || []).includes(p.number)).map((p: any) => <option key={p.number} value={p.number}>{p.number} — {p.supplier?.name || ""}</option>)}
            </select>
            <select value="" onChange={e => { const so = orders.find((o: any) => o.number === e.target.value); if (so) setDraft(prev => appendSourceGoods(prev, "SO", so, lots, { todayISO: localTodayISO, nextId })); e.target.value = ""; }}
              style={{ fontSize: 12, fontWeight: 700, padding: "7px 10px", borderRadius: 7, border: "1px solid #2563EB", background: "#fff", color: "#1D4ED8", cursor: "pointer", width: 230, maxWidth: 230, textOverflow: "ellipsis" }}>   {/* v6.99.59 (A-OW-4 · H-2): both pickers on one line */}
              <option value="">＋ Link another SO…</option>
              {orders.filter((o: any) => !["Draft", "Cancelled"].includes(o.status) && !(draft.soRefs || []).includes(o.number)).map((o: any) => <option key={o.number} value={o.number}>{o.number} — {o.client?.name || ""}</option>)}
            </select>
          </div>
        </div>
        <button onClick={() => requestClose()} style={{ padding: "6px 16px", borderRadius: 7, border: "none", background: "#475569", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }} title="v6.99.59 (A-OW-5): close the editor — it asks first if something is not saved">Close</button>
      </div>
      <div style={{ padding: 22, display: "grid", gap: 12 }}>
        <Stage title="1 · Arrange" subtitle="source · header & booking · units with carrier, price, places and expected dates → the transport order"
          open={openStages.booking} onToggle={() => toggleStage("booking")}
          done={[draft.carrierId || draft.forwarderId, draft.loadingDate, draft.originLocationId, draft.destinationLocationId].filter(Boolean).length}
          total={4}>
        <Card>
          <SectionTitle>Header</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            <div><Lbl>Status</Lbl>{/* v6.63.0 (D-11, ruling D3): the edit form no longer changes status —
                the dropdown bypassed the next-action flow (Delivered→anything with no
                posting reversal, M7). Statuses move only via the action buttons on the
                shipment card; Cancel is the only backward path. */}
              <Sel value={draft.status} onChange={() => {}} disabled title="Status changes only through the action buttons (Confirm booking / Mark loaded / Mark delivered / Cancel) — they post and reverse inventory correctly.">{STATUS_ORDER.map(s => <option key={s}>{s}</option>)}</Sel></div>
            {/* v6.99.44 (H-4, owner): mode was decided at creation; once a unit exists, changing it would reshape the legs */}
            {(() => { const hasUnits = (draft.legs || []).some((l: any) => (l.vehicles || []).length); return (
              <div><Lbl>Mode{hasUnits ? <span style={{ color: "#BBB", fontWeight: 400 }}> · set at creation</span> : null}</Lbl>
                {hasUnits ? <div style={{ padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 13, background: "#F8FAFC" }}>{draft.mode}</div>
                  : <Sel value={draft.mode} onChange={e => setDraft(prev => modeChangePatch(prev, e.target.value))}>{HEADER_MODES.map(m => <option key={m}>{m}</option>)}</Sel>}
              </div>); })()}
            {/* v6.58.0: courier tracking + originals-sent moved BACK to the
                Closing stage beside documents (user ruling, reversing v6.50.0).
                With the editor now staged by lifecycle, "where the documents
                are" is the natural home again — the v6.50.0 problem was the
                unstaged editor, not the fields' location. */}
            <div><Lbl>Trade direction <span style={{ color: "#BBB", fontWeight: 400 }}>· owns the journey</span></Lbl>
              {(() => {
                const govSO = (orders || []).find((o: any) => o.number === draft.governingSoRef) || null;
                const govPO = (pos || []).find((p: any) => (draft.poRefs || []).includes(p.number)) || null;
                const auto = shipmentTradeDirection({ ...draft, tradeDirection: null }, govPO, govSO, countryOfLocation);
                return (
                  <div title="v6.99.44 (H-5, owner): derived from the producer's and the client's countries — Auto">
                    <div style={{ padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 13, background: "#F8FAFC" }}>{MOVE_LBL[auto]?.label || auto} <span style={{ color: "#94A3B8", fontSize: 11 }}>· Auto{govPO?.supplier?.country || govSO?.client?.country ? ` (${govPO?.supplier?.country || "PL"} → ${govSO?.client?.country || "PL"})` : ""}</span></div>
                    {draft.tradeDirection && <div style={{ fontSize: 10.5, color: "#92400E", marginTop: 3 }}>manual override stored: {MOVE_LBL[draft.tradeDirection]?.label || draft.tradeDirection} <button onClick={() => sf("tradeDirection", null)} style={{ marginLeft: 6, fontSize: 10.5, border: "1px solid #FDE68A", background: "#FFFBEB", borderRadius: 5, cursor: "pointer" }}>use Auto</button></div>}
                  </div>
                );
              })()}
            </div>
            {String(draft.purpose || "").toUpperCase() !== "INBOUND" && draft.arrangedBy !== "SUPPLIER" && <div><Lbl>Governing sales order <span style={{ color: "#BBB", fontWeight: 400 }}>· sets destination</span></Lbl>
              {/* v6.99.44 (H-6, owner): chosen at creation — shown, not re-asked; a re-sale can still change it */}
              {!govChange && draft.governingSoRef ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ flex: 1, padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 13, background: "#F8FAFC" }}>{draft.governingSoRef} · {((orders || []).find((o: any) => o.number === draft.governingSoRef) || {}).client?.name || ""}</div>
                  <SmallButton onClick={() => { setGovPrev(draft.governingSoRef || ""); setGovChange(true); }}>change</SmallButton>
                </div>
              ) : (<div style={{ display: "flex", gap: 6, alignItems: "center" }}><div style={{ flex: 1 }}><Sel value={draft.governingSoRef || ""} onChange={e => sf("governingSoRef", e.target.value || "")} title="Which client's truck this is. Sets the destination and, with the producer's country, the trade direction. Change it if this shipment was attributed to the wrong sales order.">
                <option value="">None — to our warehouse</option>
                {(orders || []).filter((o: any) => o.status !== "Cancelled" && ((draft.soRefs || []).includes(o.number) || String(draft.governingSoRef) === String(o.number) || (draft.goods || []).some((g: any) => String(g.soRef) === String(o.number)) || (draft.poRefs || []).some((pr: string) => (o.items || []).some((it: any) => it.sourceType === "PO" && it.sourceRef === pr)) || (draft.lotRefs || []).some((lr: string) => (o.items || []).some((it: any) => it.sourceType === "STOCK" && String(it.sourceRef) === String(lr))))).map((o: any) => (
                  <option key={o.number} value={o.number}>{o.number} · {o.client?.name || "(client)"}</option>
                ))}
              </Sel></div>
                {/* v6.99.59 (A-OW-6, owner): the change is closed explicitly — Done keeps it and freezes the field, Cancel puts back what was there */}
                {govChange && <SmallButton kind="green" onClick={() => setGovChange(false)}>✓ Done</SmallButton>}
                {govChange && <SmallButton onClick={() => { sf("governingSoRef", govPrev); setGovChange(false); }}>Cancel</SmallButton>}
              </div>
              )}
            </div>}
            {/* v6.99.66 (A-SA-3, owner): the delivery place was copied from the sale at creation — if the sale's destination changed
                (a new client on a draft SO), say so; never rewrite the trucks and containers silently */}
            {(() => { const so = (orders || []).find((o: any) => String(o.number) === String(draft.governingSoRef || (draft.soRefs || [])[0])); const dest = so?.destinationLocationId;
              const legs = draft.legs || []; const last = legs[legs.length - 1]; const units = (last?.vehicles || []).filter((u: any) => u.deliveryLocationId != null && u.deliveryLocationId !== "");
              const off = dest != null && dest !== "" ? units.filter((u: any) => String(u.deliveryLocationId) !== String(dest)) : [];
              if (!off.length) return null;
              const name = (id: any) => placeForPrint(id, "", contacts || []).name || String(id);
              return <div style={{ gridColumn: "1 / -1", fontSize: 11.5, fontWeight: 700, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, padding: "5px 8px" }}>⚠ {so.number} now delivers to {name(dest)} — {off.length} unit{off.length > 1 ? "s" : ""} on the last leg still deliver{off.length > 1 ? "" : "s"} to {Array.from(new Set(off.map((u: any) => name(u.deliveryLocationId)))).join(", ")}. Check the units if the client changed.</div>; })()}
            {/* v6.99.44 (H-11, owner): expected dates flow DOCUMENT → shipment (the units' planned dates refine them); actual dates flow shipment → document. Never the other way. */}
            {(() => {
              const govSO = (orders || []).find((o: any) => o.number === draft.governingSoRef) || (orders || []).find((o: any) => (draft.soRefs || []).includes(o.number)) || null;
              const govPO = (pos || []).find((pp: any) => (draft.poRefs || []).includes(pp.number)) || null;
              const units = (draft.legs || []).flatMap((l: any) => l.vehicles || []);
              const uLoad = units.map((u: any) => String(u.plannedLoadingDate || "").slice(0, 10)).filter(Boolean).sort()[0] || "";
              const uDel = units.map((u: any) => String(u.plannedDeliveryDate || "").slice(0, 10)).filter(Boolean).sort().slice(-1)[0] || "";
              const inbound = String(draft.purpose || "").toUpperCase() === "INBOUND" || (!!govPO && !govSO);
              const docLoad = inbound ? (govPO?.loadingDate || "") : (govSO?.expectedLoadingDate || "");
              const docDel = inbound ? (govPO?.expectedDeliveryDate || "") : (govSO?.expectedDeliveryDate || "");
              const load = uLoad || docLoad || draft.loadingDate || ""; const del = uDel || docDel || draft.expectedDeliveryDate || "";
              const src = (u: string, d: string, doc: any) => u ? "from the units' plan" : d ? `from ${doc?.number || "the order"}` : (draft.loadingDate || draft.expectedDeliveryDate ? "legacy header value" : "not set");
              const box = (v: string) => <div style={{ padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 13, background: "#F8FAFC" }}>{v ? formatDMY(v) : "—"}</div>;
              return <>
                <div><Lbl>Expected loading date <span style={{ color: "#BBB", fontWeight: 400 }}>· {src(uLoad, docLoad, inbound ? govPO : govSO)}</span></Lbl>{box(load)}</div>
                <div><Lbl>Expected delivery date <span style={{ color: "#BBB", fontWeight: 400 }}>· {src(uDel, docDel, inbound ? govPO : govSO)}</span></Lbl>{box(del)}</div>
              </>;
            })()}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 110px", gap: 10, marginTop: 10 }}>
            <div><Lbl>Carriers (from the units)</Lbl><div style={{ padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 12.5, background: "#F9FAFB" }} title="v6.93.0 (A-R8-9): the carrier lives on each truck/container — set it there">{Array.from(new Set(allUnitsCarrierNames(draft, contacts))).join(", ") || "— none on the units yet —"}</div></div>
            {/* v6.99.14 (A-R10-1): header Forwarder removed — the BOOKING's forwarder is the one source (old records read forward) */}
            {/* v6.99.44 (H-7/H-8, owner): one glance at the header — carriers · forwarder · broker — all READ from where they are decided */}
            <div><Lbl>Forwarder (from the booking)</Lbl><div style={{ padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 13, background: "#F8FAFC" }}>{(() => { const f = (draft.bookings || [])[0]?.forwarderId; const c = f != null ? (contacts || []).find((x: any) => String(x.id) === String(f)) : null; return c?.name || "—"; })()}</div></div>
            <div><Lbl>Customs / broker (from the clearance)</Lbl><div style={{ padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 13, background: "#F8FAFC" }}>{(() => { const b = draft.brokerId; const c = b != null && b !== "" ? (contacts || []).find((x: any) => String(x.id) === String(b)) : null; const lines2 = (draft.customsUnits || []); const rel = lines2.filter((u: any) => u.status === "Released").length; return c ? `${c.name}${lines2.length ? ` · ${rel} of ${lines2.length} released` : ""}` : (draft.customsApplies === false ? "not required" : "—"); })()}</div></div>
            <div><Lbl>Units <span style={{ color: "#AAA", fontWeight: 400 }}>· derived</span></Lbl><div style={{ padding: "8px 10px", border: "1px solid #F3F4F6", borderRadius: 6, fontSize: 13, fontWeight: 700, color: "#334155", background: "#FAFAFA" }} title="Counted automatically from the transport units on each leg">{shipmentVehicleCount(draft) || "—"}</div></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "120px 120px 1fr", gap: 10, marginTop: 10 }}>
            <div><Lbl>Temp min C</Lbl><Inp type="number" value={draft.temperatureMinC} onChange={e => sf("temperatureMinC", parseNum(e.target.value))} /></div>
            <div><Lbl>Temp max C</Lbl><Inp type="number" value={draft.temperatureMaxC} onChange={e => sf("temperatureMaxC", parseNum(e.target.value))} /></div>
            <div><Lbl>Notes</Lbl><Inp value={draft.notes} onChange={e => sf("notes", e.target.value)} /></div>
          </div>
        </Card>
        {/* v6.99.59 (A-OW-7, owner): Header → Booking → Units — the booking sits right under the header */}
        {["sea", "multimodal", "air", "rail"].includes(String(draft.mode || "").toLowerCase()) && (() => {
          // v6.85.0 (D5, owner ruling): the BOOKING exists before any container number does —
          // booking no., cut-off, ETD, ETA, POL/POD, containers planned. Vessel/voyage optional.
          const b = (draft.bookings || [])[0] || null;
          const sb = (k: string, v: any) => setDraft((d: any) => { const cur = (d.bookings || [])[0] || blankBooking(nextId());
            let legs = d.legs;
            if (k === "etd" || k === "eta") legs = followBookingDates(d.legs, k as any, cur[k], v);   // v6.99.62 (A-SE-1, owner)
            return { ...d, legs, bookings: [{ ...cur, [k]: v }, ...((d.bookings || []).slice(1))] }; });
          return (
            <Card>
              <SectionTitle>Booking (sea / air / rail) — one place for the booking</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(170px, 1.6fr) minmax(120px, 1fr) 132px 132px 132px", gap: 10 }}>
                <div><Lbl>Forwarder</Lbl><Sel value={b?.forwarderId ?? ""} onChange={e => sb("forwarderId", e.target.value || null)} title="v6.99.8: one forwarder per booking — every container on it is carried by him; the sea freight line names him"><option value="">— forwarder —</option>{(contacts || []).filter((c: any) => ["Forwarder", "Carrier", "ShippingLine"].includes(c.type) || (c.roles || []).some((r: string) => ["Forwarder", "Carrier", "ShippingLine"].includes(r))).map((c: any) => <option key={String(c.id)} value={c.id}>{c.name}</option>)}</Sel></div>
                <div><Lbl>Booking no.</Lbl><Inp value={b?.number || ""} onChange={e => sb("number", e.target.value)} placeholder="from the forwarder" /></div>
                <div><Lbl>Cut-off</Lbl><Inp type="date" value={b?.cutOff || ""} onChange={e => sb("cutOff", e.target.value)} /></div>
                <div><Lbl>ETD</Lbl><Inp type="date" value={b?.etd || ""} onChange={e => sb("etd", e.target.value)} /></div>
                <div><Lbl>ETA</Lbl><Inp type="date" value={b?.eta || ""} onChange={e => sb("eta", e.target.value)} /></div>
              </div>
              {/* v6.99.59 (A-BK-2, owner): warnings, not blocks — a late vessel is a fact to act on */}
              {(() => { const so = (orders || []).find((o: any) => String(o.number) === String(draft.governingSoRef || (draft.soRefs || [])[0])); const due = String(so?.expectedDeliveryDate || "").slice(0, 10);
                const w: string[] = [];
                if (b?.eta && due && String(b.eta) > due) w.push(`ETA ${formatDMY(b.eta)} is AFTER the expected delivery of ${so.number} (${formatDMY(due)}) — the container lands too late for the sale.`);
                if (b?.cutOff && b?.etd && String(b.cutOff) > String(b.etd)) w.push(`Cut-off ${formatDMY(b.cutOff)} is after the ETD ${formatDMY(b.etd)}.`);
                if (b?.etd && b?.eta && String(b.eta) < String(b.etd)) w.push(`ETA ${formatDMY(b.eta)} is before the ETD ${formatDMY(b.etd)}.`);
                return w.length ? <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 700, color: "#B91C1C", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, padding: "5px 8px" }}>{w.map((x, i) => <div key={i}>⚠ {x}</div>)}</div> : null; })()}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 8 }}>   {/* ports, containers planned, BL, line */}
                {(() => {
                  // v6.99.44 (H-12, owner): the named place of the governing document is the POL under FOB/FCA and the POD under CFR/CIF/DAP-port —
                  // pre-filled by incoterm, labelled with its source, editable (a booking can legitimately differ from the contract).
                  const so = (orders || []).find((o: any) => String(o.number) === String(draft.governingSoRef || (draft.soRefs || [])[0])) || null;
                  const po = (pos || []).find((pp: any) => (draft.poRefs || []).includes(pp.number)) || null;
                  const doc: any = so || po; const ic = String((so ? so.sellIncoterm : po?.buyIncoterm) || "").toUpperCase();
                  const named = doc ? locationById(doc.destinationLocationId, contacts || []) : null;
                  const isPort = !!named && (named.legacyType === "PORT" || String(named.type) === "Port");
                  const polDoc = isPort && ["FOB", "FCA", "FAS"].includes(ic) ? named : null;
                  const podDoc = isPort && ["CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"].includes(ic) ? named : null;
                  const srcLbl = (which: any) => which && doc ? <span style={{ color: "#2563EB", fontWeight: 400 }}> · from {doc.number} ({ic})</span> : null;
                  const bp = { polDoc, podDoc, srcLbl };
                  return <>
                <div><Lbl>POL{bp.srcLbl(bp.polDoc)}</Lbl><LocationPicker value={b?.polId ?? b?.pol ?? (bp.polDoc?.id ?? "")} contacts={contacts} kinds={["PORT"]} placeholder="— port of loading —" onChange={(r: any) => { sb("pol", r.name); sb("polId", r.id); }} /></div>
                <div><Lbl>POD{bp.srcLbl(bp.podDoc)}</Lbl><LocationPicker value={b?.podId ?? b?.pod ?? (bp.podDoc?.id ?? (() => { const so = (orders || []).find((o: any) => String(o.number) === String(draft.governingSoRef || (draft.soRefs || [])[0])); const dl = so ? locationById(so.destinationLocationId, contacts || []) : null; return dl && dl.legacyType === "PORT" ? dl.name : ""; })())} contacts={contacts} kinds={["PORT"]} placeholder="— port of discharge —" title="defaults from the sales order's destination when it is a port" onChange={(r: any) => { sb("pod", r.name); sb("podId", r.id); }} /></div>
                  </>;
                })()}
                <div><Lbl>Containers planned</Lbl><Inp type="number" value={b?.containersPlanned ?? ""} onChange={e => sb("containersPlanned", parseNum(e.target.value, 0))} /></div>
                <div><Lbl>BL / AWB / CIM no. (when issued)</Lbl><Inp value={b?.blNumber || ""} onChange={e => sb("blNumber", e.target.value)} /></div>
                <div><Lbl>Shipping line / airline / railway</Lbl><Inp value={b?.shippingLine || ""} onChange={e => sb("shippingLine", e.target.value)} /></div>
              </div>
              <details style={{ marginTop: 8 }}><summary style={{ fontSize: 11, color: "#94A3B8", cursor: "pointer" }}>Vessel / voyage (optional)</summary>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                  <div><Lbl>Vessel</Lbl><Inp value={b?.vessel || ""} onChange={e => sb("vessel", e.target.value)} /></div>
                  <div><Lbl>Voyage</Lbl><Inp value={b?.voyage || ""} onChange={e => sb("voyage", e.target.value)} /></div>
                </div></details>
            </Card>
          );
        })()}
        {/* v6.99.49 (S-2, owner): the UNITS are ARRANGING — carrier, price, places, expected dates → the transport order — so they live in phase 1 */}
        <Card>
          {cutOffWarnings(draft).map((w: any, k: number) => (
            <div key={"co" + k} style={{ marginBottom: 6, padding: "7px 10px", borderRadius: 7, background: "#FFFBEB", border: "1px solid #FDE68A", fontSize: 11.5, color: "#92400E", fontWeight: 600 }}>
              ⏱ {w.unit}: loading {w.loadingDate} cannot make booking {w.booking}'s cut-off — latest loading {w.latest}.
            </div>
          ))}
          {stuffingViolations(draft).map((v: string, k: number) => (
            <div key={"sv" + k} style={{ marginBottom: 6, padding: "7px 10px", borderRadius: 7, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 11.5, color: "#B91C1C", fontWeight: 600 }}>⛔ {v}</div>
          ))}
          {legKgChecks(draft).map((c: any) => (
            <div key={c.leg} style={{ marginBottom: 8, padding: "7px 10px", borderRadius: 7, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 11.5, color: "#B91C1C", fontWeight: 600 }}>
              Leg {c.leg} ({c.mode}): the {c.units} unit(s) carry {c.unitsKg.toLocaleString("pl-PL")} kg but the goods table says {c.goodsKg.toLocaleString("pl-PL")} kg — {c.deltaKg > 0 ? "over" : "under"} by {Math.abs(c.deltaKg).toLocaleString("pl-PL")} kg. The loading protocols and the transport order print what the units say.
            </div>
          ))}
          <SectionTitle right={<span style={{ display: "flex", gap: 6 }}>{(((draft.legs || [])[0]?.vehicles || []).length > 1) && <SmallButton onClick={() => setDraft((d: any) => allocateGoodsToTrucks(d, 0))} title="v6.85.0 (D8): allocate the goods evenly across the trucks of leg 1 — kilos derive from the allocation">Spread evenly across the trucks</SmallButton>}<SmallButton onClick={addLeg}>+ Activate extra leg</SmallButton></span>}>Legs - route, truck / driver / container / BL</SectionTitle>
          {(() => {
            // v6.4.1: the printed transport order takes dates from the LEGS, while the
            // list/header show the shipment-level dates — warn when they disagree.
            const legs = draft.legs || [];
            const fl = legs[0] || {}, ll = legs[legs.length - 1] || fl;
            const flPick = String(fl.plannedPickupDate || "").slice(0, 10);
            const llDel = String(ll.plannedDeliveryDate || "").slice(0, 10);
            const mismatches = [];
            if (draft.loadingDate && flPick && draft.loadingDate !== flPick) mismatches.push(`header loading date ${draft.loadingDate} ≠ first leg pickup ${flPick}`);
            if (draft.expectedDeliveryDate && llDel && draft.expectedDeliveryDate !== llDel) mismatches.push(`header expected delivery ${draft.expectedDeliveryDate} ≠ last leg delivery ${llDel}`);
            return mismatches.length ? (
              <div style={{ marginBottom: 10, padding: "7px 10px", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 7, fontSize: 11.5, color: "#92400E" }}>
                ⚠ Header and leg dates disagree ({mismatches.join("; ")}). The transport order prints the <strong>leg</strong> dates.
              </div>
            ) : null;
          })()}
          {(draft.legs || []).map((leg, i) => <div key={leg.id || i} style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 12, marginBottom: 10, background: "#FAFAFA" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: "#111" }}>Leg #{i + 1}</span>
                <ModeBadge mode={leg.mode} />
              </div>
              {(draft.legs || []).length > 1 && <SmallButton onClick={() => removeLeg(i)}>Remove leg</SmallButton>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "120px 140px 1fr", gap: 9 }}>
              <div><Lbl>Mode</Lbl><Sel value={leg.mode} onChange={e => updateLeg(i, "mode", e.target.value)}>{LEG_MODES.map(m => <option key={m}>{m}</option>)}</Sel></div>
              <div><Lbl>Status</Lbl><Sel value={leg.status} onChange={e => updateLeg(i, "status", e.target.value)}>{LEG_STATUSES.map(st => <option key={st}>{st}</option>)}</Sel></div>
              <div style={{ alignSelf: "end", fontSize: 11, color: "#64748B" }} title="v6.99.8 (owner ruling): the leg keeps mode and status; places, dates and times live on each UNIT below and print on the transport order">places · dates · times → on the units</div>
            </div>
            {/* v6.99.44 (L-1, owner): the STOPS list retired — a groupage tour is expressed by the units' loading and delivery places, which come from the grouped documents. Nothing downstream read the stops. Stored leg.stops retire at the DDL. */}
            {leg.mode === "Road" && <div style={{ marginTop: 8, fontSize: 11, color: "#64748B", fontStyle: "italic" }}>Truck, trailer, driver name and phone are entered per unit below — they describe the vehicle performing the leg and feed the transport order.</div>}
            {(leg.mode === "Sea" || leg.mode === "Rail") && <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 1fr", gap: 9, marginTop: 9 }}>
              {/* v6.93.0 (A-R8-15): booking / BL / line live in the header Booking section — one place */}
              {/* v6.93.0 (A-R8-15): booking / BL / line live in the header Booking section — one place */}
              {/* v6.99.8: shipping line lives on the booking (header) only */}
            </div>}
            {(leg.mode === "Sea" || leg.mode === "Rail") && <div style={{ marginTop: 6, fontSize: 11, color: "#64748B", fontStyle: "italic" }}>Container numbers are entered per unit below (one shipment can carry several containers). Booking, BL and shipping line above cover all units on this leg.</div>}
            {leg.mode === "Air" && <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1.2fr", gap: 9, marginTop: 9 }}>
              <div><Lbl>AWB</Lbl><Inp value={leg.awbNumber || ""} onChange={e => updateLeg(i, "awbNumber", e.target.value)} placeholder="e.g. 020-12345675" /></div>
              {/* v6.93.0 (A-R8-15): booking / BL / line live in the header Booking section — one place */}
              {/* v6.93.0 (A-R8-15): booking / BL / line live in the header Booking section — one place */}
            </div>}
            <div style={{ marginTop: 12, borderTop: "1px dashed #CBD5E1", paddingTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#334155" }}>Transport units for this leg · trucks / containers / AWB</div>
                <SmallButton kind="green" onClick={() => addVehicle(i)}>+ Add unit</SmallButton>
              </div>
              {(transportUnitsForLeg(leg).length ? transportUnitsForLeg(leg) : [blankTransportUnit(leg.mode)]).map((u, ui) => { const uMode = leg.mode; /* Batch 3c (feedback): units inherit the leg's mode — no per-unit Mode box */ return <div key={`leg${i}-u${ui}`} style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: "10px 12px", marginBottom: 10, background: "#FCFCFD" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#334155" }}>Unit #{ui + 1}</div>
                  <SmallButton onClick={() => removeVehicle(i, ui)}>Remove</SmallButton>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr 1fr"   /* v6.99.59 (A-SU-2/3): one layout for road and sea */, gap: 9, marginBottom: 9 }}>
                  <div><Lbl>Mode</Lbl><div style={{ fontSize: 12.5, padding: "7px 0", fontWeight: 700, color: "#334155" }}>{uMode} <span style={{ fontWeight: 400, color: "#94A3B8" }}>(from leg)</span></div></div>
                  {i > 0 && (transportUnitsForLeg(draft.legs[i - 1]) || []).length > 0 && (
                    <div style={{ gridColumn: "1 / -1" }}><Lbl>Fed by trucks (v6.85.0 — many-to-many; kg only when a truck is split)</Lbl>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {(transportUnitsForLeg(draft.legs[i - 1]) || []).map((x: any) => {
                          // v6.99.59 (A-SU-1, owner): the lone-truck rule applies LIVE — one truck carries all the goods — the same rule Save applies
                          const dLive = autoFillSingleUnitKg(draft); const liveKg = unitKg(findUnitIn(dLive, x.id) || x, dLive); const liveRem = truckRemainingForFeeding(dLive, x.id, u.id);
                          const cur = feedersOf(u); const f = cur.find((z: any) => String(z.fromUnitId) === String(x.id));
                          return <label key={String(x.id)} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11.5, border: "1px solid " + (f ? "#7C3AED" : "#E5E7EB"), borderRadius: 6, padding: "3px 7px", background: f ? "#F5F3FF" : "#fff" }}>
                            <input type="checkbox" checked={!!f} disabled={!f && liveRem <= 0} title={!f && liveKg <= 0 ? "Allocate the goods to this truck first" : !f && liveRem <= 0 ? "Already fully placed in other containers" : ""} onChange={() => { if (f) { setDraft((d: any) => setFeeders(d, u.id, cur.filter((z: any) => String(z.fromUnitId) !== String(x.id)))); return; } const r = addFeederChecked(draft, u.id, x.id); if (r.error) { window.alert(r.error); return; } setDraft(() => r.sh); }} />
                            {x.truckPlate || `unit ${x.id}`} · {Math.round(unitKg(x, draft)).toLocaleString("pl-PL")} kg
                            {f && <input type="number" placeholder="split kg" value={f.kg ?? ""} onChange={e => { const v = parseNum(e.target.value, 0); setDraft((d: any) => setFeeders(d, u.id, cur.map((z: any) => String(z.fromUnitId) === String(x.id) ? { ...z, kg: v || undefined } : z))); }} style={{ width: 70, border: "1px solid #DDD6FE", borderRadius: 4, padding: "1px 4px", fontSize: 11 }} />}
                          </label>;
                        })}
                      </div>
                    </div>
                  )}
                  {uMode !== "Road" ? <div style={{ gridColumn: "2 / -1", gridRow: 1 }}><Lbl>Carrier (from the booking)</Lbl><div style={{ padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 12.5, background: "#F9FAFB" }}>{(() => { const f = (contacts || []).find((c: any) => String(c.id) === String((draft.bookings || [])[0]?.forwarderId)); return f ? f.name : "— set the forwarder on the booking —"; })()}</div></div> : <div><Lbl>Carrier</Lbl>
                    <Sel value={u.carrierId ?? ""} onChange={e => updateVehicle(i, ui, "carrierId", e.target.value || null)} title="v6.85.0 (D9): the carrier lives on the unit — one shipment may use several; transport orders go out per carrier">
                      <option value="">— choose the carrier —</option>{/* v6.99.44 (L-2, owner): "leg default" was a vestige of the pre-v6.99.8 leg carrier that nothing reads */}
                      {(contacts || []).filter((c: any) => ["Carrier", "Forwarder"].includes(c.type) || (c.roles || []).some((r: string) => ["Carrier", "Forwarder"].includes(r))).map((c: any) => <option key={String(c.id)} value={c.id}>{c.name}</option>)}
                    </Sel>
                  </div>}
                  {uMode === "Road" && <div><Lbl>Truck plate</Lbl><Inp value={u.truckPlate || u.vehiclePlate || ""} onChange={e => updateVehicle(i, ui, "truckPlate", e.target.value)} /></div>}
                  {uMode === "Road" && <div><Lbl>Trailer plate</Lbl><Inp value={u.trailerPlate || ""} onChange={e => updateVehicle(i, ui, "trailerPlate", e.target.value)} /></div>}
                  <div style={{ gridColumn: "1 / 4" }}><Lbl>Loading place{(() => { const pr = unitProposals(draft); return (pr.loadId != null && String(u.pickupLocationId) === String(pr.loadId)) ? <span style={{ color: "#2563EB", fontWeight: 400 }}> · from {pr.from}</span> : null; })()}</Lbl><LocationPicker value={u.pickupLocationId ?? u.pickupText ?? ""} contacts={contacts} placeholder={leg.fromCustom || leg.fromText || "— pickup location —"} onChange={(r: any) => { updateVehicle(i, ui, "pickupLocationId", r.id); updateVehicle(i, ui, "pickupText", r.name); }} title="v6.99.10: one location list — printed on the transport order" /></div>
                  <div style={{ gridColumn: "4 / 5" }}><Lbl>Expected loading date{uMode !== "Road" && (draft.bookings || [])[0]?.etd ? (u.loadDateManual && String(u.plannedLoadingDate || "") !== String((draft.bookings || [])[0].etd) ? <span style={{ color: "#B45309", fontWeight: 700 }}> · manual — booking ETD {formatDMY((draft.bookings || [])[0].etd)} <button onClick={() => { updateVehicle(i, ui, "plannedLoadingDate", (draft.bookings || [])[0].etd); updateVehicle(i, ui, "loadDateManual", false); }} title="back to the booking's date" style={{ border: "none", background: "none", color: "#2563EB", cursor: "pointer", padding: 0, fontSize: 11 }}>↺</button></span> : <span style={{ color: "#2563EB", fontWeight: 400 }}> · from the booking</span>) : null}</Lbl><div style={{ display: "grid", gridTemplateColumns: "118px 56px", gap: 4 }}><Inp type="date" value={u.plannedLoadingDate ?? ""} onChange={e => { updateVehicle(i, ui, "plannedLoadingDate", e.target.value); if (uMode !== "Road") updateVehicle(i, ui, "loadDateManual", true); }} placeholder="dd/mm/yyyy" /><Inp value={u.plannedLoadingTime ?? ""} onChange={e => updateVehicle(i, ui, "plannedLoadingTime", e.target.value)} placeholder="hh:mm" title="loading time (free text)" /></div></div>
                  <div style={{ gridColumn: "1 / 4" }}><Lbl>Delivery place{(() => { const pr = unitProposals(draft); return (pr.delId != null && String(u.deliveryLocationId) === String(pr.delId)) ? <span style={{ color: "#2563EB", fontWeight: 400 }}> · from {pr.from}</span> : null; })()}</Lbl><LocationPicker value={u.deliveryLocationId ?? u.deliveryText ?? ""} contacts={contacts} placeholder={leg.toCustom || leg.toText || "— delivery location —"} onChange={(r: any) => { updateVehicle(i, ui, "deliveryLocationId", r.id); updateVehicle(i, ui, "deliveryText", r.name); }} /></div>
                  <div style={{ gridColumn: "4 / 5" }}><Lbl>Expected delivery date{uMode !== "Road" && (draft.bookings || [])[0]?.eta ? (u.deliveryDateManual && String(u.plannedDeliveryDate || "") !== String((draft.bookings || [])[0].eta) ? <span style={{ color: "#B45309", fontWeight: 700 }}> · manual — booking ETA {formatDMY((draft.bookings || [])[0].eta)} <button onClick={() => { updateVehicle(i, ui, "plannedDeliveryDate", (draft.bookings || [])[0].eta); updateVehicle(i, ui, "deliveryDateManual", false); }} title="back to the booking's date" style={{ border: "none", background: "none", color: "#2563EB", cursor: "pointer", padding: 0, fontSize: 11 }}>↺</button></span> : <span style={{ color: "#2563EB", fontWeight: 400 }}> · from the booking</span>) : null}</Lbl><div style={{ display: "grid", gridTemplateColumns: "118px 56px", gap: 4 }}><Inp type="date" value={u.plannedDeliveryDate ?? ""} onChange={e => { updateVehicle(i, ui, "plannedDeliveryDate", e.target.value); if (uMode !== "Road") updateVehicle(i, ui, "deliveryDateManual", true); }} /><Inp value={u.plannedDeliveryTime ?? ""} onChange={e => updateVehicle(i, ui, "plannedDeliveryTime", e.target.value)} placeholder="hh:mm" title="unloading time (free text)" /></div></div>
                </div>
                {uMode === "Road" && <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.2fr 1fr 1fr", gap: 9, marginBottom: 9 }}>
                  <div><Lbl>Driver name</Lbl><Inp value={u.driverName || ""} onChange={e => updateVehicle(i, ui, "driverName", e.target.value)} /></div>
                  <div><Lbl>Driver phone</Lbl><Inp value={u.driverPhone || ""} onChange={e => updateVehicle(i, ui, "driverPhone", e.target.value)} placeholder="+48 ..." /></div>
                  <div><Lbl>CMR no.</Lbl><Inp value={u.cmrNumber || ""} onChange={e => updateVehicle(i, ui, "cmrNumber", e.target.value)} placeholder="one per truck" title="Each truck has its own CMR number" /></div>
                  <div><Lbl>Temp recorder no.</Lbl><Inp value={u.tempRecorderNo || ""} onChange={e => updateVehicle(i, ui, "tempRecorderNo", e.target.value)} placeholder="e.g. TR-88412" title="Temperature recorder serial for this truck's load" /></div>

                </div>}
                {uMode !== "Road" && <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.4fr", gap: 9 }}>
                  <div><Lbl>Container</Lbl><Inp value={u.containerNumber || ""} onChange={e => updateVehicle(i, ui, "containerNumber", e.target.value)} placeholder="MSCU1234567" /></div>
                  <div><Lbl>Temp recorder no.</Lbl><Inp value={feedersOf(u).length > 0 ? containerRecorder(u, draft) : (u.tempRecorderNo || "")} onChange={e => updateVehicle(i, ui, "tempRecorderNo", e.target.value)} placeholder="e.g. TR-88412" title="Temperature recorder serial for this container's load" disabled={feedersOf(u).length > 0} /></div>
                </div>}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1.4fr", gap: 9, marginTop: 9 }}>
                  <div><Lbl>Actual loaded on</Lbl><Inp type="date" noFuture value={u.loadedAt || u.actualLoadDate || ""} onChange={e => updateVehicle(i, ui, "loadedAt", e.target.value)} /></div>
                  <div><Lbl>Actual unloaded on</Lbl><Inp type="date" noFuture value={u.unloadedAt || u.actualUnloadDate || ""} onChange={e => updateVehicle(i, ui, "unloadedAt", e.target.value)} /></div>
                  <div><Lbl>Kg{((u.load || []).some((a: any) => parseNum(a?.qtyKg, 0) > 0) || feedersOf(u).length) ? " (derived)" : ""}</Lbl>
                    {((u.load || []).some((a: any) => parseNum(a?.qtyKg, 0) > 0) || feedersOf(u).length)
                      ? <div style={{ padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 13, background: "#F9FAFB", fontWeight: 600 }} title="v6.85.0 (D8): derived from the goods allocation / feeder trucks — never typed">{Math.round(unitKg(u, draft)).toLocaleString("pl-PL")}</div>
                      : <Inp type="number" value={u.qtyKg || ""} onChange={e => updateVehicle(i, ui, "qtyKg", parseNum(e.target.value))} />}
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", fontSize: 10.5, color: "#64748B", paddingBottom: 8 }}>Actual dates for this unit (truck: loaded / unloaded; container: stuffed / discharged) — never in the future; planned dates live on the unit above.</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "90px 160px 1fr", gap: 9, marginTop: 9 }}>
                  <div><Lbl>Currency</Lbl><Sel value={u.priceCurrency || leg.costCurrency || "PLN"} onChange={e => { const cur = e.target.value; updateVehicle(i, ui, "priceCurrency", cur); updateLeg(i, "costCurrency", cur); updateLeg(i, "costFxRate", documentFxDefault(cur)); }} title="v6.93.0 (A-R8-17): the price's own currency (default: the carrier's)">{["PLN", "EUR", "USD"].map(c => <option key={c}>{c}</option>)}</Sel></div>
                  {draft.arrangedBy !== "SUPPLIER" && <div><Lbl>Price for this unit{!(parseNum(u.costAmount) > 0) && draft.arrangedBy !== "SUPPLIER" ? <span style={{ color: "#DC2626", fontWeight: 400 }}> · missing</span> : null}</Lbl><Inp type="number" value={u.costAmount || ""} onChange={e => updateVehicle(i, ui, "costAmount", parseNum(e.target.value))} placeholder="0" style={!(parseNum(u.costAmount) > 0) && draft.arrangedBy !== "SUPPLIER" ? { borderColor: "#DC2626", background: "#FEF2F2" } : {}} /></div>}   {/* v6.99.44 (L-6, owner): red until a price is in; Save warns, does not block · SD-4: a supplier's truck has no price of ours */}
                  <div style={{ display: "flex", alignItems: "flex-end", fontSize: 10.5, color: "#64748B", paddingBottom: 8 }}>Optional — set this when each truck/container has a different price. The transport order totals all unit prices for the carrier.</div>
                </div>
                {/* ── v6.53.0: WHAT THIS UNIT CARRIES ──────────────────────────
                    Ruling: goods are assigned per unit. The loading protocol for
                    this truck derives its pallet table from exactly these kilos,
                    so a line split across two trucks prints two correct sheets
                    instead of one sheet repeated. Leave every box empty when a
                    single truck takes the whole shipment — the normal case. */}
                {uMode === "Road" && (draft.goods || []).length > 0 && <div style={{ marginTop: 11, borderTop: "1px dashed #E2E8F0", paddingTop: 9 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: "#334155" }}>Loaded on this truck</div>
                    <div style={{ fontSize: 10.5, color: "#64748B" }}>Leave blank if this truck takes the whole shipment.</div>
                    <div style={{ flex: 1 }} />
                    <div><Lbl>Pallet type</Lbl></div>
                    <select value={u.palletType || "standard"} onChange={e => updateVehicle(i, ui, "palletType", e.target.value)}
                      style={{ border: "1px solid #E5E7EB", borderRadius: 6, padding: "5px 7px", fontSize: 12 }}>
                      <option value="standard">Standard · 26</option>
                      <option value="euro">Euro · 33</option>
                    </select>
                  </div>
                  {(draft.goods || []).map(g => {
                    const assigned = ((u.load || []).find(a => String(a.goodsLineId) === String(g.id)) || {}).qtyKg;
                    const lineTotal = parseNum(g.qtyKg, 0);
                    const takenElsewhere = transportUnitsForLeg(leg).reduce((s, other, oi) => oi === ui ? s
                      : s + parseNum(((other.load || []).find(a => String(a.goodsLineId) === String(g.id)) || {}).qtyKg, 0), 0);
                    const room = Math.max(0, lineTotal - takenElsewhere);
                    return <div key={g.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.6fr", gap: 9, alignItems: "center", marginBottom: 5 }}>
                      <div style={{ fontSize: 11.5, color: "#334155" }}>
                        {g.product}{g.variety ? ` · ${g.variety}` : ""}{g.size ? ` · ${g.size}` : ""}
                      </div>
                      <Inp type="number" value={assigned || ""} placeholder={`${room}`} onChange={e => {
                        const v = parseNum(e.target.value);
                        // v6.92.0 (A-R8-14): a truck can never be allocated more than the row has left.
                        const r = setUnitLoad(draft, u.id, g.id, v);
                        if (r.error) { window.alert(r.error); return; }
                        const rest = (u.load || []).filter(a => String(a.goodsLineId) !== String(g.id));
                        updateVehicle(i, ui, "load", v > 0 ? [...rest, { goodsLineId: g.id, qtyKg: v }] : rest);
                        updateVehicle(i, ui, "manualLoad", true);
                      }} />
                      <div style={{ fontSize: 10.5, color: room > 0 ? "#64748B" : "#B45309" }}>
                        kg — line {lineTotal.toLocaleString("pl-PL")} kg{takenElsewhere > 0 ? ` · ${takenElsewhere.toLocaleString("pl-PL")} on other trucks` : ""}
                      </div>
                    </div>;
                  })}
                </div>}
              </div>; })}
              <div style={{ fontSize: 10.5, color: "#64748B" }}>Use several units when one shipment has multiple trucks/containers. Example: 4 sea containers and 5 road trucks at arrival port are recorded as two legs with 4 sea units and 5 road units.</div>
            </div>
          </div>)}
        </Card>
        </Stage>

        <Stage title="2 · Execute" subtitle="goods allocation · customs clearance · what actually moved"
          open={openStages.execution} onToggle={() => toggleStage("execution")}
          done={[(draft.legs || []).some((l: any) => transportUnitsForLeg(l).some((u: any) => u.truckPlate || u.containerNumber)),
                 (draft.legs || []).some((l: any) => transportUnitsForLeg(l).some((u: any) => u.driverName)),
                 (draft.goods || []).length > 0,
                 (draft.customs || {}).required === false || !!(draft.customs || {}).status].filter(Boolean).length}
          total={4}>
        <Card>
          <SectionTitle>Customs clearance</SectionTitle>
          <div style={{ fontSize: 11, color: "#64748B", marginBottom: 10, lineHeight: 1.5 }}>
            EU → EU needs no clearance. Crossing the EU border does: on <strong>export</strong> your PL broker or the forwarder abroad clears it before exit; on <strong>import (CIF)</strong> it's cleared at EU entry by the forwarder, or you move it under <strong>T1</strong> and clear with your local broker.
          </div>
          {(() => {
            const c = draft.customs || {};
            const setC = (k: string, v: any) => setDraft((prev: any) => ({ ...prev, customs: { ...(prev.customs || {}), [k]: v } }));
            return (
              <>
                <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>   {/* v6.99.59 (A-CU-1): the two regime boxes side by side */}
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!c.applies} onChange={e => setC("applies", e.target.checked)} /> Customs clearance applies to this shipment
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, cursor: "pointer", border: `1.5px solid ${c.t1 ? "#7C3AED" : "#DDD6FE"}`, background: c.t1 ? "#F5F3FF" : "#fff", color: "#5B21B6", borderRadius: 8, padding: "5px 10px" }}>
                  <input type="checkbox" checked={!!c.t1} onChange={e => setC("t1", e.target.checked)} style={{ width: 16, height: 16 }} /> Moved under T1 transit
                </label>
                </div>
                {c.applies && (
                  <>
                    {/* v6.60.0: WHERE / WHO / WHAT / STATUS, in fields. These
                        used to be a role, a free-text country and a note whose
                        placeholder read "Declaration ref, phyto, duties…" — so
                        the declaration number, the only thing that proves
                        zero-rating, lived in prose nothing could check. */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      <div><Lbl>Cleared where</Lbl><Sel value={readCustoms(c).place || "PL"} onChange={e => setC("place", e.target.value)}>
                        {Object.keys(CUSTOMS_PLACES).map(k => <option key={k} value={k}>{CUSTOMS_PLACES[k]}</option>)}
                      </Sel></div>
                      <div><Lbl>Cleared by</Lbl><Sel value={readCustoms(c).party || "OUR_BROKER"} onChange={e => setC("party", e.target.value)}>
                        {Object.keys(CUSTOMS_PARTIES).map(k => <option key={k} value={k}>{CUSTOMS_PARTIES[k]}</option>)}
                      </Sel></div>
                      <div><Lbl>Status</Lbl><Sel value={c.status || "Pending"} onChange={e => setC("status", e.target.value)}>{["Pending", "In progress", "Cleared"].map(s => <option key={s}>{s}</option>)}</Sel></div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 100px 100px", gap: 10, marginTop: 10 }}>   {/* v6.99.59 (A-CU-1): broker wide, FX narrow */}
                      {/* v6.99.44 (H-7): the broker is decided HERE, with the clearance; the header reads it */}
                      <div><Lbl>Customs / broker</Lbl>
                        <Sel value={draft.brokerId || ""} onChange={e => sf("brokerId", e.target.value ? parseNum(e.target.value) : null)}>
                          <option value="">None / not required</option>
                          {customsProviders.map(p2 => <option key={p2.id} value={p2.id}>{p2.name}</option>)}
                        </Sel>
                      </div>
                      <div><Lbl>Customs cost</Lbl><Inp type="number" value={c.cost ?? ""} onChange={e => setC("cost", parseNum(e.target.value))} /></div>
                      <div><Lbl>Currency</Lbl><Sel value={c.currency || "PLN"} onChange={e => setC("currency", e.target.value)}>{["PLN", "EUR", "USD"].map(x => <option key={x}>{x}</option>)}</Sel></div>
                      <div><Lbl>FX → PLN</Lbl><Inp type="number" value={c.fxRate ?? (!c.currency || c.currency === "PLN" ? 1 : "")} onChange={e => setC("fxRate", parseNum(e.target.value))} /></div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 130px", gap: 10, marginTop: 10 }}>
                      {/* v6.99.44 (X-1, X-5…X-9, owner): the clearance belongs to the UNIT that crosses the border — one line per truck,
                          filled from the agent's CC529C file, matched by plates, cross-checked; typed fallback = MRN · released on · type. */}
                      <div style={{ gridColumn: "1 / -1", marginTop: 6 }}>
                        <div style={{ fontSize: 10.5, fontWeight: 800, color: "#94A3B8", marginBottom: 6 }}>CLEARANCE PER UNIT <span style={{ fontWeight: 500 }}>— drop the agent's file (release CC529C or exit confirmation CC599C, .xml) on the line, or type the MRN · several at once: Shipments → Import customs files</span></div>
                        {clearanceLinesFor(draft).map((cl: any) => {
                          const u = (draft.legs || []).flatMap((l: any) => l.vehicles || []).find((x: any) => String(x.id) === String(cl.unitId)) || {};
                          const setCl = (patch: any) => setDraft((prev: any) => { const cur = clearanceLinesFor(prev); return { ...prev, customsUnits: cur.map((x: any) => String(x.unitId) === String(cl.unitId) ? { ...x, ...patch } : x) }; });
                          const issues = cl.mrn ? crossCheckClearance(cl, draft, u, orders, invoices) : [];
                          const onFile = (file: any) => { if (!file) return; const rd = new FileReader(); rd.onload = () => {
                            // v6.99.72 (A-CU-3): the file says where it belongs; a drop on the wrong shipment is refused with the right one named
                            const parsed = parseCustomsFile(String(rd.result || "")); if (!parsed.ok) { uiAlert({ title: "Not a customs file", message: "Nothing read — the file carries no MRN, LRN or SAD header." }); return; }
                            const home = findClearanceHome(parsed, allShipmentsForCap || [], invoices || []);
                            const elsewhere = home.exact && String(home.exact.shipment.id) !== String(draft.id);
                            if (elsewhere) { uiAlert({ title: "This file belongs to another shipment", message: `${CUSTOMS_FILE_LABEL[parsed.kind]} — ${home.exact!.reasons.join("; ")}.\n\nIt belongs to ${home.exact!.shipment.number} (${home.exact!.unit.truckPlate || "unit"}). Attach it there, or use Shipments → Import customs files.` }); return; }
                            const onThis = (home.exact && String(home.exact.shipment.id) === String(draft.id)) ? home.exact : home.candidates.find(h => String(h.shipment.id) === String(draft.id)) || null;
                            const go = () => {
                              setDraft((prev: any) => applyCustomsFile(prev, cl.unitId, parsed, file.name, nextId));
                              recordAudit({ module: "Shipments", docType: "Shipment", docNumber: draft.number, action: "updated", summary: `${CUSTOMS_FILE_LABEL[parsed.kind]} ${parsed.mrn || parsed.agentRef || ""} read from ${file.name} for ${u.truckPlate || "unit"}` });
                            };
                            if (!onThis) { uiConfirm({ tone: "warn", title: "The plates are not on this shipment", message: `This file names the truck ${parsed.plates || "?"}${parsed.invoiceRef ? ` and invoice ${parsed.invoiceRef}` : ""}; ${home.reason || "no truck of this shipment matches"}.\n\nAttach it to ${u.truckPlate || "this line"} anyway?`, confirmLabel: "Attach anyway", cancelLabel: "Leave it" }).then((ok: boolean) => { if (ok) go(); }); return; }
                            if (String(onThis.unit.id) !== String(cl.unitId)) { uiConfirm({ tone: "warn", title: "Another truck of this shipment", message: `This file is for ${parsed.plates}, which is ${onThis.unit.truckPlate || "another unit"} — attach it to THIS line (${u.truckPlate || "unit"}) anyway?`, confirmLabel: "Attach here", cancelLabel: "Leave it" }).then((ok: boolean) => { if (ok) go(); }); return; }
                            go();
                          }; rd.readAsText(file); };
                          return <div key={String(cl.unitId)} style={{ display: "grid", gridTemplateColumns: "150px 110px 1.4fr 120px 120px 110px auto", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px solid #F1F5F9" }}
                            onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}>
                            <div style={{ fontSize: 12, fontWeight: 700 }}>{u.truckPlate || u.containerNo || `Unit #${(((draft.legs || [])[0]?.vehicles || []).findIndex((x: any) => String(x.id) === String(cl.unitId)) + 1) || 1}`}{u.trailerPlate ? <span style={{ color: "#64748B" }}> / {u.trailerPlate}</span> : null}</div>
                            <Inp value={cl.type || ""} onChange={e => setCl({ type: e.target.value })} placeholder="EX A" />
                            <Inp value={cl.mrn || ""} onChange={e => setCl({ mrn: e.target.value })} placeholder="MRN" />
                            <Inp type="date" value={cl.releasedOn || ""} onChange={e => setCl({ releasedOn: e.target.value, status: e.target.value ? "Released" : cl.status })} noFuture />
                            <Sel value={cl.status || "Pending"} onChange={e => setCl({ status: e.target.value })}>{CLEARANCE_STATUSES.map(s => <option key={s}>{s}</option>)}</Sel>
                            <div style={{ fontSize: 10.5, color: "#64748B" }}>{cl.exitedOn ? <span style={{ color: "#1D4ED8", fontWeight: 700 }}>left the EU {cl.exitedOn}{cl.exitOffice ? ` · ${cl.exitOffice}` : ""}</span> : cl.officeExport ? `${cl.officeExport} → ${cl.officeExit || "?"}` : ""}</div>
                            <label title="v6.99.59 (A-CU-2): the agent's CC529C release (.xml) — or drop it on the line" style={{ fontSize: 11.5, fontWeight: 800, border: "none", background: "#0F766E", color: "#fff", borderRadius: 7, padding: "6px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>Import file<input type="file" accept=".xml,.XML" style={{ display: "none" }} onChange={e => onFile(e.target.files?.[0])} /></label>
                            {issues.length > 0 && <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, padding: "4px 8px" }}>{issues.map((s, k) => <div key={k}>⚠ {s}</div>)}</div>}
                            {cl.mrn && !issues.length && cl.sourceFile && <div style={{ gridColumn: "1 / -1", fontSize: 10.5, color: "#16A34A" }}>✓ matches the shipment · {cl.sourceFile}{cl.exitFile ? ` · exit: ${cl.exitFile}` : ""}</div>}
                            {cl.mrn && <div style={{ gridColumn: "1 / -1" }}><SmallButton kind="remove" title="v6.99.72 (A-CU-3): the line goes back to Pending and its register rows go with it — the mistake is undone whole" onClick={() => { uiConfirm({ tone: "warn", title: "Detach the customs file?", message: `The line of ${u.truckPlate || "this unit"} goes back to Pending and the register rows for MRN ${cl.mrn} are removed. The file itself is not touched.`, confirmLabel: "Detach", cancelLabel: "Keep" }).then((ok: boolean) => { if (ok) { setDraft((prev: any) => detachClearance(prev, cl.unitId)); recordAudit({ module: "Shipments", docType: "Shipment", docNumber: draft.number, action: "updated", summary: `Customs file detached from ${u.truckPlate || "unit"} (MRN ${cl.mrn})` }); } }); }}>Detach file</SmallButton></div>}
                          </div>;
                        })}
                        {!clearanceLinesFor(draft).length && <div style={{ fontSize: 11.5, color: "#94A3B8" }}>Add the units first — each truck is cleared on its own.</div>}
                      </div>
                    </div>
                    {(() => {
                      const gaps = customsGaps(c, { isExport: String(draft.tradeDirection || "") === "EXPORT" });
                      return gaps.length ? (
                        <div style={{ marginTop: 10, padding: "8px 11px", borderRadius: 7, background: "#FFFBEB", border: "1px solid #FDE68A", fontSize: 11.5, color: "#92400E" }}>
                          {gaps.map(g => <div key={g.field}>· <strong>{g.field}</strong> — {g.why}</div>)}
                        </div>
                      ) : null;
                    })()}
                    <div style={{ marginTop: 10 }}><Lbl>Notes</Lbl><Inp value={c.notes || ""} onChange={e => setC("notes", e.target.value)} placeholder="Phyto, duties, anything the fields above do not cover" /></div>
                    <div style={{ fontSize: 10.5, color: "#94A3B8", marginTop: 6 }}>The customs cost is synced into this shipment's cost lines (type "customs") for allocation.</div>
                  </>
                )}
              </>
            );
          })()}
        </Card>
        {/* v6.83.0 (owner ruling): GOODS first — what will be loaded — then the legs that carry it. */}
        <Card>
          <SectionTitle>Goods on this shipment</SectionTitle>
          <div style={{ fontSize: 11, color: "#64748B", marginBottom: 10 }}>Adjust quantities and pallets here — e.g. if you entered pallets on the SO after creating this shipment, update them here so the transport order shows the right figure.</div>
          {(draft.goods || []).length === 0 && <div style={{ fontSize: 12, color: "#AAA" }}>No goods lines on this shipment.</div>}
          {(draft.legs || []).length > 1 && (
            <div style={{ fontSize: 11, color: "#0369A1", background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 7, padding: "7px 10px", marginBottom: 10 }}>
              This shipment has {(draft.legs || []).length} legs / carriers. Assign each goods line to the leg that carries it — each carrier's transport order then lists <strong>only its own goods</strong>.
            </div>
          )}
          {/* v6.99.44 (X-3/X-4, owner): rows grouped by the document they came from, each with a sub-total; under each row the kilos per truck (a view of unit.load[]). */}
          {(() => {
            const groupsOf = new Map<string, any[]>();
            (draft.goods || []).forEach((g: any, gi: number) => { const key = g.soRef || g.poRef || "—"; if (!groupsOf.has(key)) groupsOf.set(key, []); groupsOf.get(key)!.push(gi); });
            const trucks = ((draft.legs || [])[0]?.vehicles || []);
            const loaded = ["Loaded", "In transit", "Delivered"].includes(String(draft.status));
            const setLoad = (ti: number, goodsId: any, kg: number) => setDraft((prev: any) => ({ ...prev, legs: (prev.legs || []).map((l: any, li: number) => li !== 0 ? l : { ...l, vehicles: (l.vehicles || []).map((u: any, ui: number) => { if (ui !== ti) return u; const rest = (u.load || []).filter((a: any) => String(a.goodsLineId) !== String(goodsId)); return { ...u, load: kg > 0 ? [...rest, { goodsLineId: goodsId, qtyKg: kg }] : rest, manualLoad: true }; }) }) }));
            return Array.from(groupsOf.entries()).map(([key, idxs]) => {
              const doc: any = (orders || []).find((o: any) => o.number === key) || (pos || []).find((pp: any) => pp.number === key) || null;
              const sub = idxs.reduce((s, gi) => s + parseNum((draft.goods || [])[gi]?.qtyKg), 0);
              return <div key={key} style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: "#1D4ED8" }}>{key}</div>
                  <div style={{ fontSize: 11.5, color: "#64748B" }}>{doc?.client?.name || doc?.supplier?.name || ""}</div>
                  <div style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700 }}>{fmtNum(sub)} kg</div>
                  {!loaded && groupsOf.size > 1 && <SmallButton kind="red" onClick={() => { if (!window.confirm(`Remove ${key} and its ${idxs.length} row(s) from this shipment?`)) return; setDraft((prev: any) => ({ ...prev, goods: (prev.goods || []).filter((_: any, gi: number) => !idxs.includes(gi)), soRefs: (prev.soRefs || []).filter((r: string) => r !== key), poRefs: (prev.poRefs || []).filter((r: string) => r !== key) })); }}>Remove</SmallButton>}
                </div>
                {idxs.map(i => { const g: any = (draft.goods || [])[i]; return <div key={g.id || i}>
                    <div style={{ display: "grid", gridTemplateColumns: (draft.legs || []).length > 1 ? "1.8fr 0.9fr 0.9fr 0.7fr 1.1fr" : "2fr 1fr 1fr 0.8fr", gap: 9, marginBottom: 8, alignItems: "end" }}>
            <div><Lbl>Product</Lbl><div style={{ fontSize: 12.5, fontWeight: 600, padding: "6px 0" }}>{g.product}{g.variety ? ` — ${g.variety}` : ""}{g.size ? ` · ${g.size}` : ""}</div></div>
            <div><Lbl>Net (kg){(() => { const cap = goodsRowCap(g, draft, orders, pos); return cap != null ? ` (max ${Math.round(cap).toLocaleString("pl-PL")})` : ""; })()}</Lbl><Inp type="number" value={g.qtyKg || ""} onChange={e => {
              // v6.99.7 (A-R9-11): a goods row can carry less than its SO/PO line (partial load) but never more than the line's remainder;
              // trucks re-derive proportionally unless one was set by hand (then the leg banner shows the gap).
              const v = parseNum(e.target.value); const cap = goodsRowCap(g, draft, orders, pos);
              if (cap != null && v > cap + 0.5) { window.alert(`This line has only ${Math.round(cap).toLocaleString("pl-PL")} kg left on its order — a shipment cannot carry more than the sale (or purchase) holds.`); return; }
              updateGood(i, "qtyKg", v);
              setDraft((d: any) => (d.legs || []).some((l: any) => (l.vehicles || []).some((u: any) => u.manualLoad)) ? d : autoAllocate(d, 0));
            }} /></div>
            {/* v6.50.0: the field itself sits in line with its siblings; the derivation
                is explained on its own line beneath the whole row (see below). */}
            <div><Lbl>Gross (kg)</Lbl><Inp type="number" value={g.grossKg || ""} onChange={e => updateGood(i, "grossKg", parseNum(e.target.value))} placeholder="0" title="Gross weight incl. packaging and pallets — printed on the transport order" /></div>
            <div><Lbl>Pallets{!g.pallets ? " (derived)" : ""}</Lbl><Inp type="number" value={g.pallets || (grossForGoodsLine(g, packagingTypes || []).pallets || "")} onChange={e => updateGood(i, "pallets", parseNum(e.target.value))} placeholder="0" title="v6.93.0 (A-R8-11): derived per line from its packaging type (boxes ÷ boxes per pallet); type to override" /></div>
            {/* v6.93.0 (A-R8-11): "on leg / carrier" column retired — the allocation of goods to TRUCKS (unit loads) says who carries what */}
            <div style={{ fontSize: 10.5, color: "#94A3B8" }}>{[g.poRef, g.soRef, g.lotRef].filter(Boolean).join(" / ") || "—"}</div>
            {/* v6.50.0: the gross-weight derivation, on its own line beneath the row so
                it explains the calculation without knocking the fields out of line. */}
            {(() => {
              const gr = grossForGoodsLine({ qtyKg: g.qtyKg, product: g.product, packaging: g.packaging, pallets: g.pallets }, packagingTypes.length ? packagingTypes : PACKAGING_SEED);
              if (!(gr.grossKg > 0)) return null;
              const detail = gr.boxes
                ? `${fmtNum(parseNum(g.qtyKg))} net + ${gr.boxes} × ${gr.tareKg} kg packaging${gr.pallets ? ` + ${gr.pallets} × ${gr.palletTareKg} kg pallets` : ""} = ${fmtNum(gr.grossKg)} kg gross`
                : `≈ ${fmtNum(gr.grossKg)} kg gross (estimated — packaging unknown)`;
              return <div style={{ gridColumn: "1 / -1", fontSize: 10.5, color: "#64748B", marginTop: -2 }}>
                {detail}{" · "}
                <span onClick={() => autoGross(i)} style={{ color: "#2563EB", cursor: "pointer", textDecoration: "underline" }}>use this</span>
              </div>;
            })()}
          </div>
                  {trucks.length > 1 && <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 11, padding: "4px 0 8px 4px", color: "#475569" }}>
                    <span style={{ fontWeight: 700, color: "#94A3B8" }}>on trucks:</span>
                    {trucks.map((u: any, ti: number) => { const a = (u.load || []).find((x: any) => String(x.goodsLineId) === String(g.id)); return <span key={ti} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{u.truckPlate || `truck ${ti + 1}`} <input type="number" value={a ? a.qtyKg : ""} onChange={e => setLoad(ti, g.id, parseNum(e.target.value))} disabled={loaded} style={{ width: 80, border: "1px solid #E5E7EB", borderRadius: 5, padding: "3px 6px", fontSize: 11 }} /> kg</span>; })}
                    {(() => { const alloc = trucks.reduce((s: number, u: any) => s + parseNum(((u.load || []).find((x: any) => String(x.goodsLineId) === String(g.id)) || {}).qtyKg), 0); const un = Math.round(parseNum(g.qtyKg) - alloc); return <span style={{ fontWeight: 800, color: un === 0 ? "#16A34A" : "#DC2626" }}>unallocated {fmtNum(un)} kg</span>; })()}
                  </div>}
                </div>; })}
              </div>;
            });
          })()}
        </Card>
        </Stage>

        <Stage title="3 · Close" subtitle="costs and billing · the document file"
          open={openStages.closing} onToggle={() => toggleStage("closing")}
          done={[(draft.costs || []).some((c: any) => parseNum(c.amount) > 0),
                 !!draft.billingStatus && draft.billingStatus !== "Not ready",
                 (draft.documents || []).some((d: any) => d.status === "Have it" || d.status === "Sent")].filter(Boolean).length}
          total={3}>
        <Card>
          <SectionTitle right={<SmallButton kind="green" onClick={addCost}>+ Add cost</SmallButton>}>Costs and billing</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 8, alignItems: "end", marginBottom: 8, paddingBottom: 8, borderBottom: "1px dashed #E5E7EB" }}>
            <div><Lbl>Billing status</Lbl><div style={{ padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 12.5, background: "#F9FAFB", fontWeight: 600 }} title="v6.80.0 (D-48): derived from the cost lines' invoice status and the allocation — nothing to set by hand">{derivedBillingStatus(syncLegFreightCostLines(syncCustomsCostLine(draft)), lots || [])}</div></div>
            <div style={{ fontSize: 10.5, color: "#888", lineHeight: 1.45, paddingBottom: 7 }}>Tracks where this shipment is in the cost cycle — from waiting for the supplier's freight invoice to costs allocated into lots.</div>
          </div>
          {/* v6.11 (#10): DAP/DDP purchases — the supplier arranges and pays the
              carrier, so there is no freight cost on our side. The toggle records
              that and unlocks the otherwise-protected freight line so it can be
              removed. */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155", marginBottom: draft.supplierManagedTransport ? 6 : 12, cursor: "pointer" }}>
            <input type="checkbox" checked={!!draft.supplierManagedTransport} onChange={e => sf("supplierManagedTransport", e.target.checked)} />
            Bought DAP/DDP — the supplier arranges &amp; pays transport (no freight cost on our side)
          </label>
          {draft.supplierManagedTransport && (
            <div style={{ fontSize: 11, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 10px", marginBottom: 12, lineHeight: 1.45 }}>
              We don't manage or pay for this transport, so no freight cost belongs to us here. Remove any freight line below (now unlocked). Use the legs' transport units only to track the incoming truck/driver.
            </div>
          )}
          {(draft.costs || []).map((c, i) => <div key={c.id || i} style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 0.7fr 0.6fr 0.8fr 1fr 1fr 0.5fr", gap: 8, marginBottom: 8 }}>
            <div><Lbl>Type</Lbl><Sel value={c.type} onChange={e => updateCost(i, "type", e.target.value)}>{COST_TYPES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}</Sel></div>
            <div><Lbl>Supplier{!c.supplierId ? <span style={{ color: "#DC2626", fontWeight: 800 }}> · missing</span> : null}</Lbl><Sel value={c.supplierId || ""} style={!c.supplierId ? { borderColor: "#DC2626", background: "#FEF2F2" } : undefined} onChange={e => updateCost(i, "supplierId", e.target.value ? parseNum(e.target.value) : null)}><option value="">— choose the supplier —</option>{logisticsProviders(contacts).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Sel></div>   {/* v6.99.59 (A-CB-1): no silent first option */}
            <div><Lbl>Amount</Lbl><Inp type="number" value={c.amount} onChange={e => updateCost(i, "amount", e.target.value)} /></div>
            <div><Lbl>Curr.</Lbl><Sel value={c.currency} onChange={e => updateCost(i, "currency", e.target.value)}><option>PLN</option><option>EUR</option><option>USD</option></Sel></div>
            <div><Lbl>FX</Lbl><Inp type="number" value={c.fxRate} onChange={e => updateCost(i, "fxRate", e.target.value)} /></div>
            <div><Lbl>Status</Lbl><Sel value={c.invoiceStatus} onChange={e => updateCost(i, "invoiceStatus", e.target.value)}><option>Expected</option><option>Received</option><option>Approved</option><option>Posted</option><option>Paid</option></Sel></div>
            <div><Lbl>Invoice ref</Lbl><Inp value={c.invoiceRef} onChange={e => updateCost(i, "invoiceRef", e.target.value)} /></div>
            <div><Lbl>&nbsp;</Lbl>{(isFreightCostType(c.type) && !draft.supplierManagedTransport && String(c.source || "").startsWith("LEGCAR:"))
              ? <span title="Derived from the unit prices — set the unit's price to 0 to remove it" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 34, width: "100%", color: "#9CA3AF", fontSize: 14 }}>🔒</span>
              : <button onClick={() => removeCost(i)} title="Delete this cost line" style={{ height: 34, width: "100%", border: "1px solid #FECACA", background: "#fff", color: "#DC2626", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>✕</button>}</div>
          </div>)}
          {(() => {
            // v6.4.0: per-currency subtotals + PLN total + EUR equivalent.
            const byCur: Record<string, number> = {};
            (draft.costs || []).forEach((c: any) => { const cur = c.currency || "PLN"; byCur[cur] = (byCur[cur] || 0) + parseNum(c.amount); });
            const subtotals = Object.entries(byCur).filter(([, v]) => v > 0).map(([cur, v]) => fmtMoney(v, cur)).join(" + ");
            const totalPLN = shipmentCostPLN(draft);
            const eurLine = (draft.costs || []).find((c: any) => c.currency === "EUR" && parseNum(c.fxRate) > 0);
            const eurRate = eurLine ? parseNum(eurLine.fxRate) : defaultFxRate("EUR"); // v6.30.1: no hardcoded FX — fx.ts is the single source
            const totalEUR = eurRate > 0 ? totalPLN / eurRate : 0;
            return (
              <div style={{ textAlign: "right", fontSize: 13, color: "#444", marginTop: 8 }}>
                {subtotals && Object.keys(byCur).length > 1 && <span style={{ fontSize: 11.5, color: "#888", marginRight: 10 }}>{subtotals} →</span>}
                Total: <strong>{fmtMoney(totalPLN, "PLN")}</strong>
                <span style={{ color: "#888", marginLeft: 8 }}>≈ <strong style={{ color: "#444" }}>{fmtMoney(totalEUR, "EUR")}</strong> <span style={{ fontSize: 10.5 }}>(at {eurRate.toFixed(2)})</span></span>
              </div>
            );
          })()}
        </Card>
        <Card>
          {(() => {
            // v6.18.2 (#4): a LIGHT, OPTIONAL tracker — collapsed by default, no
            // per-row dates, simple Missing / Have it / Sent state. It never blocks
            // a shipment; it's just somewhere to note document progress if useful.
            const legBL = (draft.legs || []).map((l: any) => l.blNumber).filter(Boolean)[0] || "";
            const exportDeclRef = "";   // v6.99.44 (X-8, owner): the transport order goes to the carrier BEFORE clearance exists — it never prints an MRN
            const rows = (draft.documents || [])
              .map((d: any, i: number) => ({ d, i }))
              .filter(({ d }) => !["transport order", "cmr"].includes(String(d.type || "").trim().toLowerCase()));
            const ready = rows.filter(({ d }) => ["Have it", "Sent", "N/A"].includes(d.status)).length;
            const STATES = ["Missing", "Have it", "Sent", "N/A"];
            return (
              <details>
                <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 10, userSelect: "none" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#111", letterSpacing: "0.02em" }}>📄 DOCUMENTS</span>
                  <span style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 400 }}>optional tracker — never blocks a shipment</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: ready === rows.length ? "#16A34A" : "#64748B", background: "#F3F4F6", borderRadius: 10, padding: "2px 9px" }}>{ready}/{rows.length} done ▾</span>
                </summary>
                <div style={{ marginTop: 14 }}>
                  {/* v6.58.0: courier tracking + originals-sent back beside the
                      documents they track (user ruling, reversing v6.50.0). */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                    <div><Lbl>Courier tracking nr — originals to client</Lbl><Inp value={draft.docsCourierTrackingNo || ""} onChange={e => sf("docsCourierTrackingNo", e.target.value)} placeholder="e.g. DHL 1234567890" /></div>
                    <div><Lbl>Originals sent on</Lbl><Inp type="date" value={draft.docsCourierDate || ""} onChange={e => sf("docsCourierDate", e.target.value)} noFuture /></div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                    <SmallButton kind="green" onClick={addDoc}>+ Add document</SmallButton>
                  </div>
                  {rows.map(({ d, i }) => {
                    const t = String(d.type || "").trim().toLowerCase();
                    const isBL = t === "bl";
                    const isExportDecl = t === "export declaration";
                    const autoRef = isBL ? legBL : (isExportDecl ? exportDeclRef : "");
                    const locked = !!autoRef;
                    const refValue = locked ? autoRef : d.ref;
                    const stateOpts = STATES.includes(d.status) ? STATES : [d.status, ...STATES];
                    const linkInfo = inspectLink(d.link);
                    return <div key={d.id || i} style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 0.85fr 0.85fr 1.5fr 32px", gap: 8, marginBottom: 7, alignItems: "end" }}>
                      <div><Lbl>Type</Lbl><Inp value={d.type} onChange={e => updateDoc(i, "type", e.target.value)} /></div>
                      <div><Lbl>Ref {locked ? <span style={{ color: "#2563EB", fontWeight: 400 }}>· {isBL ? "from leg" : "from clearance"}</span> : null}</Lbl><Inp value={refValue} onChange={e => updateDoc(i, "ref", e.target.value)} disabled={locked} title={isBL ? "Taken from the sea/rail leg's BL number" : (isExportDecl ? "Taken from the lot's export clearance (SAD/MRN) in Inventory" : "")} style={locked ? { background: "#F9FAFB", color: "#666" } : undefined} /></div>
                      <div><Lbl>State</Lbl><Sel value={d.status} onChange={e => updateDoc(i, "status", e.target.value)}>{stateOpts.map((s: string) => <option key={s} value={s}>{s}</option>)}</Sel></div>
                      <div><Lbl>Received</Lbl><Inp type="date" value={d.date || ""} onChange={e => updateDoc(i, "date", e.target.value)} noFuture title="The date the signed original came back" /></div>
                      {/* v6.47.0: link to the scan in Dropbox (or Drive/OneDrive). The file
                          itself can't live here — localStorage would fill up after a few scans. */}
                      <div>
                        <Lbl>Link to scan {d.link ? (linkInfo.ok
                          ? <a href={d.link} target="_blank" rel="noreferrer" style={{ color: "#2563EB", fontWeight: 700, textDecoration: "none" }}>· open {linkInfo.label} ↗</a>
                          : <span style={{ color: "#DC2626", fontWeight: 400 }}>· {linkInfo.reason}</span>) : null}</Lbl>
                        <Inp value={d.link || ""} onChange={e => updateDoc(i, "link", e.target.value)} placeholder="https://www.dropbox.com/…"
                          title="Paste the Dropbox share link for the signed scan"
                          style={d.link && !linkInfo.ok ? { borderColor: "#FCA5A5", background: "#FEF2F2" } : undefined} />
                      </div>
                      <button onClick={() => removeDoc(i)} title="Remove this document row"
                        style={{ border: "1px solid #FECACA", background: "#fff", color: "#DC2626", borderRadius: 6, padding: "8px 0", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>✕</button>
                    </div>;
                  })}
                  <div style={{ fontSize: 10.5, color: "#9CA3AF", marginTop: 8, lineHeight: 1.45 }}>
                    The standard set (invoice, packing list, EUR.1, phytosanitary, export declaration, BL/AWB) is added automatically. The transport order is tracked from the carrier email; the CMR is per road unit. BL and export-declaration refs fill in on their own. Paste a Dropbox share link for each signed scan — anyone with the link can open it, so keep the links inside the business.
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px dashed #E5E7EB", alignItems: "end" }}>
                    {/* v6.50.0: courier tracking moved up to the shipment header — it is
                        checked far too often to be buried in the documents section. */}
                    <div style={{ fontSize: 10.5, color: "#64748B", paddingBottom: 8 }}>Waybill the original document set was sent to the client under.</div>
                  </div>
                </div>
              </details>
            );
          })()}
        </Card>
        </Stage>
      </div>
      <div style={{ padding: "14px 22px", borderTop: "1px solid #E5E7EB", display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <SmallButton onClick={() => requestClose()}>Cancel</SmallButton>
        <SmallButton kind="save" onClick={() => saveShipmentDraft()}>Save</SmallButton>
      </div>
    </div>
  </div>;
}
