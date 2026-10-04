// ShipmentDocuments.tsx — v6.99.68 (A-AUD-2, owner): moved out of Shipments.tsx unchanged; the module's shared helpers are imported from it.
import React, { useState } from "react";
import { SmallButton, ActionButton } from "./ui";
import { jobsByCarrierLeg, effectiveLoad, truckTour, tourGaps } from "./shipmentModel.domain";
import { grossForGoodsLine } from "./packaging.domain";
import { formatDMY } from "./dates";
import { printHtmlNode } from "./documentService";
import { placeForPrint } from "./locations";
import { COMPANY, Card, FieldPrint, Inp, LOGO_DATA_URL, Lbl, SectionTitle, Sel, blankTransportUnit, cargoVariance, fmtMoney, fmtNum, locationTextFromFields, parseNum, providerById, providerCosts, providerIdsForShipment, providerLegs, providerRoleForLeg, providerRolePL, providerUnitsForLeg, shipmentCostPLN, todayISO } from "./Shipments";

export function TransportOrderDocument({ shipment, contacts, providerId, legIds, orders = [], customTerms = "", pos = [], packagingTypes = [], lots = [] }: any) {
  const docNo = shipment.transportOrderNo || shipment.number;
  const effectiveProviderId = providerId || shipment.carrierId || shipment.forwarderId;
  const provider: any = providerById(effectiveProviderId, contacts) || {};
  const broker: any = providerById(shipment.brokerId, contacts) || null;
  // Legs on this order: if explicit legIds given, use those; else all of this provider's legs.
  const providerScopedLegs = providerLegs(shipment, effectiveProviderId);
  const selectedLegs = (legIds && legIds.length)
    ? (shipment.legs || []).filter((l: any) => legIds.map(String).includes(String(l.id)))
    : providerScopedLegs;
  const firstLeg = selectedLegs[0] || (shipment.legs || [])[0] || {};
  const lastLeg = selectedLegs[selectedLegs.length - 1] || firstLeg;
  const selectedCosts = providerCosts(shipment, effectiveProviderId);
  const providerRole = providerRoleForLeg(firstLeg, effectiveProviderId);
  // v6.4.0 PRIVACY RULE: this order describes ONLY the selected legs. Places and
  // dates come from the legs themselves — never from shipment-level origin/
  // destination — so a sea forwarder's order can't leak the supplier's site that
  // only the road carrier needs to know.
  const loadingPlace = locationTextFromFields(firstLeg.fromLocationId, firstLeg.fromCustom);
  const unloadingPlace = locationTextFromFields(lastLeg.toLocationId, lastLeg.toCustom);
  const withTime = (date: any, time: any) => {
    const d = String(date || "").slice(0, 10) || "TBA"; // tolerate legacy "YYYY-MM-DDTHH:mm" values
    return time ? `${d}, ${time}` : d;
  };
  // v6.99.7 (A-R9-12): the UNITS own places, dates and times — the leg's are only the fallback
  const orderUnits = selectedLegs.flatMap((l: any) => providerUnitsForLeg(l, effectiveProviderId, shipment));
  const firstUnit = orderUnits[0] || {}; const lastUnit = orderUnits[orderUnits.length - 1] || {};
  // v6.99.39 (D-1): the order prints the place WITH its address — resolved from the unit's location id, the text as fallback
  const unitLoadingPlace = placeForPrint(firstUnit.pickupLocationId, firstUnit.pickupText, contacts || []).line;
  const unitUnloadingPlace = placeForPrint(lastUnit.deliveryLocationId, lastUnit.deliveryText, contacts || []).line;
  const loadingPlaceFinal = unitLoadingPlace || loadingPlace; const unloadingPlaceFinal = unitUnloadingPlace || unloadingPlace;
  const loadingDates = Array.from(new Set(orderUnits.map((u: any) => String(u.plannedLoadingDate || "").slice(0, 10)).filter(Boolean)));
  const loadingDateTime = loadingDates.length ? loadingDates.map(d => { const u = orderUnits.find((x: any) => String(x.plannedLoadingDate || "").slice(0, 10) === d); return withTime(d, u?.plannedLoadingTime); }).join(" / ") : withTime(firstLeg.plannedPickupDate, firstLeg.plannedPickupTime);
  const unloadingDateTime = lastUnit.plannedDeliveryDate ? withTime(lastUnit.plannedDeliveryDate, lastUnit.plannedDeliveryTime) : withTime(lastLeg.plannedDeliveryDate, lastLeg.plannedDeliveryTime);
  const allRoad = selectedLegs.length > 0 && selectedLegs.every((l: any) => l.mode === "Road");
  const anyRoad = selectedLegs.some((l: any) => l.mode === "Road");
  const anyNonRoad = selectedLegs.some((l: any) => l.mode !== "Road");
  // Agreed price for this order. There are three possible sources of the freight
  // figure, and they represent the SAME money entered at different granularities —
  // so we pick ONE by priority rather than adding them (which double-counted):
  //   1. Per-unit prices (most granular: each truck/container priced individually)
  //   2. Cost & Billing lines for this provider
  //   3. Leg-level cost amounts
  const orderCurrency = selectedCosts[0]?.currency || firstLeg.costCurrency || "PLN";
  const costLinesTotal = selectedCosts.reduce((sum, c) => sum + parseNum(c.amount), 0);
  const legCostTotal = selectedLegs.reduce((sum, l) => sum + parseNum(l.costAmount), 0);
  const unitPriceTotal = selectedLegs.reduce((sum, l) => sum + providerUnitsForLeg(l, effectiveProviderId, shipment).reduce((u, unit) => u + parseNum(unit.costAmount || unit.unitPrice), 0), 0);
  const agreedPriceTotal = unitPriceTotal > 0 ? unitPriceTotal : (costLinesTotal > 0 ? costLinesTotal : legCostTotal);
  const agreedPriceText = agreedPriceTotal > 0
    ? fmtMoney(agreedPriceTotal, orderCurrency)
    : "TBA / per agreement";
  const tempText = shipment.temperatureMinC || shipment.temperatureMaxC ? `${shipment.temperatureMinC ?? ""}/${shipment.temperatureMaxC ?? ""}°C - continuous reefer / agregat ciagly` : "TBA";
  // v6.4.0: SO refs backfilled live — goods rows created before the SO link have
  // empty soRef, so fall back to the shipment's derived SO links.
  // v6.99.50 (TO-3): document refs are no longer printed per cargo line (the carrier's block is per truck)
  // v6.99.50 (TO-3): soFallback no longer needed — the carrier's cargo block prints per truck, not per document line
  // Goods scoped to the selected legs: a leg carries goods whose lotRef/poRef/soRef
  // appears on it, OR (fallback) all shipment goods if legs don't carry explicit refs.
  const legGoodsRefs = new Set<string>();
  selectedLegs.forEach((leg: any) => {
    providerUnitsForLeg(leg, effectiveProviderId, shipment).forEach((u: any) => { if (u.lotRef) legGoodsRefs.add(String(u.lotRef)); });
    (leg.goodsRefs || []).forEach((r: any) => legGoodsRefs.add(String(r)));
  });
  // v6.34.5 (Problem A): if goods are assigned to legs (legNo), scope to the selected
  // legs' numbers — each carrier's order lists only its own goods. Fall back to the
  // ref-based scoping, then to all goods.
  const selectedLegNos = new Set(selectedLegs.map((lg: any) => {
    const idx = (shipment.legs || []).indexOf(lg);
    return idx >= 0 ? idx + 1 : null;
  }).filter(Boolean).map(String));
  const anyGoodsAssigned = (shipment.goods || []).some((g: any) => g.legNo != null && g.legNo !== "");
  // v6.99.8: the order carries what THIS carrier's units load — kg per goods row from the units' allocations (whole rows only when no unit has a load)
  const providerLoadUnits = selectedLegs.flatMap((l: any) => providerUnitsForLeg(l, effectiveProviderId, shipment));
  const loadByRow: Record<string, number> = {};
  // v6.99.73 (A-TO-7): a container's load is what its trucks put in it — never "all goods"
  providerLoadUnits.forEach((u: any) => effectiveLoad(shipment, u).forEach((a: any) => { loadByRow[String(a.goodsLineId)] = (loadByRow[String(a.goodsLineId)] || 0) + (parseNum(a.qtyKg, 0)); }));
  const hasLoads = Object.keys(loadByRow).length > 0;
  const scopedGoods = hasLoads
    ? (shipment.goods || []).filter((g: any) => loadByRow[String(g.id)] > 0).map((g: any) => { const kg = loadByRow[String(g.id)]; const ratio = parseNum(g.qtyKg, 0) > 0 ? kg / parseNum(g.qtyKg, 0) : 1; return { ...g, qtyKg: kg, boxes: g.boxes ? Math.round(parseNum(g.boxes, 0) * ratio) : g.boxes, pallets: g.pallets ? Math.round(parseNum(g.pallets, 0) * ratio * 10) / 10 : g.pallets, grossKg: g.grossKg ? Math.round(parseNum(g.grossKg, 0) * ratio) : g.grossKg }; })
    : (anyGoodsAssigned
    ? (shipment.goods || []).filter((g: any) => g.legNo == null || g.legNo === "" || selectedLegNos.has(String(g.legNo)))
    : (legGoodsRefs.size
        ? (shipment.goods || []).filter((g: any) => legGoodsRefs.has(String(g.lotRef)) || legGoodsRefs.has(String(g.poRef)) || legGoodsRefs.has(String(g.soRef)))
        : (shipment.goods || [])));
  const units = selectedLegs.flatMap((leg, li) => {
    const rows = providerUnitsForLeg(leg, effectiveProviderId, shipment);
    const legExtra = { legBL: leg.blNumber || "", legBooking: leg.bookingNumber || "", legShippingLine: leg.shippingLine || "" };
    if (!rows.length) return [{ ...blankTransportUnit(leg.mode), ...legExtra, legNo: li + 1, legMode: leg.mode, legStatus: leg.status }];
    return rows.map((u, ui) => ({ ...u, ...legExtra, legNo: li + 1, unitNo: ui + 1, legMode: leg.mode, legStatus: leg.status }));
  });
  // v6.14: per-unit columns. Container is per unit; BL/booking/shipping line are
  // leg-level (one BL per leg) and carried in via legBL; CMR is per road unit;
  // temperature recorder is per unit.
  const unitCols = [
    { h: "Leg", render: (u: any, i: number) => `${u.legNo}.${u.unitNo || i + 1}` },
    { h: "Mode", render: (u: any) => u.mode || u.legMode },
    ...(anyRoad ? [
      { h: "Truck / Trailer", render: (u: any) => (u.mode || u.legMode) === "Road" ? ([u.truckPlate || u.vehiclePlate, u.trailerPlate].filter(Boolean).join(" / ") || "TBA") : "—" },
      { h: "Driver / Phone", render: (u: any) => (u.mode || u.legMode) === "Road" ? ([u.driverName, u.driverPhone].filter(Boolean).join(" / ") || "TBA") : "—" },
      { h: "CMR", render: (u: any) => (u.mode || u.legMode) === "Road" ? (u.cmrNumber || "TBA") : "—" },
    ] : []),
    ...(anyNonRoad ? [
      { h: "Container", render: (u: any) => (u.mode || u.legMode) !== "Road" ? (u.containerNumber || "TBA") : "—" },
      { h: "BL / AWB", render: (u: any) => (u.mode || u.legMode) !== "Road" ? ([(u.mode || u.legMode) === "Air" ? u.awbNumber : u.legBL, u.bookingNumber || u.legBooking].filter(Boolean).join(" / ") || "TBA") : "—" },
    ] : []),
    { h: "Temp recorder", render: (u: any) => u.tempRecorderNo || "—" },
  ];
  const ROAD_TERMS = [
    ["Payment is due 30 days after receipt of the invoice with confirmed original CMR / POD and loading specification.", "Platnosc nastepuje 30 dni po otrzymaniu faktury wraz z potwierdzonym oryginalem CMR / POD i specyfikacja zaladunku."],
    ["The carrier is financially responsible for the transported cargo.", "Przewoznik odpowiada materialnie za przewozony ladunek."],
    ["The loading space must be clean, free of foreign smells, mould and pest traces.", "Przestrzen ladunkowa musi byc czysta, bez obcych zapachow, plesni i sladow szkodnikow."],
    ["The driver must supervise loading, unloading and correctness of transport documents.", "Kierowca zobowiazany jest dopilnowac zaladunku, rozladunku i prawidlowosci dokumentow."],
    [`In case of any problem the driver must immediately contact MARIANNA at ${COMPANY.emergencyPhone}.`, `W przypadku problemow kierowca musi natychmiast skontaktowac sie z MARIANNA pod numerem ${COMPANY.emergencyPhone}.`],
    ["The agreed transport temperature must be maintained continuously where applicable.", "Podczas przewozu nalezy stale utrzymywac uzgodniona temperature, jezeli dotyczy."],
    ["Loaded vehicles / containers must remain under supervision and protected against uncontrolled access.", "Zaladowane pojazdy / kontenery musza pozostawac pod nadzorem i byc zabezpieczone przed dostepem osob trzecich."],
    ["No written objection within one hour is treated as acceptance of this transport order.", "Brak pisemnego sprzeciwu w ciagu jednej godziny oznacza przyjecie zlecenia do realizacji."],
    ["The carrier confirms valid transport insurance and must provide a copy of the policy on request.", "Przewoznik oswiadcza, ze posiada wazne ubezpieczenie przewoznika i przedstawi kopie polisy na zadanie."],
    ["Disputes are subject to Polish transport law / CMR and the competent court for Warsaw.", "Spory podlegaja polskiemu prawu przewozowemu / CMR i sadowi wlasciwemu dla Warszawy."],
  ];
  const manualTermsLines = String(customTerms || shipment.customOrderTerms || "").split("\n").map(s => s.trim()).filter(Boolean);

  return (
    <div style={{ background: "#fff", color: "#111", fontFamily: "Arial, Calibri, sans-serif", fontSize: 10, lineHeight: 1.22, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #111", paddingBottom: 6, marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <img src={LOGO_DATA_URL} alt="MARIANNA" style={{ width: 82, height: "auto", objectFit: "contain" }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 850 }}>{COMPANY.name}</div>
            <div>{COMPANY.address1}</div><div>{COMPANY.address2}</div><div>NIP: {COMPANY.nip}</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 13, fontWeight: 850 }}>{providerRole.toUpperCase()} ORDER / ZLECENIE DLA {providerRolePL(providerRole)}</div>
          <div style={{ fontSize: 12, fontWeight: 800 }}>No {docNo}</div>
          <div>Page / Strona: 1/1 · Date / Data: {todayISO()}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 10px" }}>
        <FieldPrint en="Carrier / contractor" pl="Zleceniobiorca" value={`${provider.name || "TBA"}\n${provider.address || ""}\nNIP ${provider.nip || "-"}`} />
        <FieldPrint en="Transport units" pl="Liczba pojazdow / jednostek" value={`${units.length || 1} unit(s) / pojazd(y)`} />
        {(() => {
          // v6.99.96 (A-GR-4, owner ruling 1 Oct): a groupage truck prints its TOUR — loading stops from the lots, drops from the
          // SOs, in the truck's order, each with its cargo; a single-drop truck prints exactly as before
          const tours = orderUnits.map((u: any) => ({ u, t: truckTour(shipment, u, pos || [], lots || [], orders || []) })).filter((x: any) => x.t.isTour);
          if (tours.length) {
            const pl = (id: any, text: any) => { const p = placeForPrint(id, text, contacts || []); return p.line || p.name || String(text || "") || "TBA"; };
            const k = (v: number) => `${Math.round(v).toLocaleString("pl-PL")} kg`;
            return (
              <div style={{ gridColumn: "1 / -1", border: "1px solid #ccc", padding: "4px 6px" }}>
                <div style={{ fontWeight: 800 }}>Route stops / Punkty trasy</div>
                {tours.map(({ u, t }: any, ti: number) => <div key={ti} style={{ marginTop: ti ? 6 : 2 }}>
                  {tours.length > 1 && <div style={{ fontWeight: 700, fontSize: 10 }}>{u.truckPlate || `unit ${ti + 1}`}</div>}
                  {[...t.loads.map((l: any, i: number) => ({ kind: "Loading / Zaladunek", n: i + 1, place: pl(l.id, l.text), what: `${k(l.kg)}`, date: u.plannedLoadingDate || "" })),
                    ...t.drops.map((dr: any, i: number) => ({ kind: "Unloading / Rozladunek", n: i + 1, place: dr.missing ? `TBA — ${dr.soNumber} has no destination` : pl(dr.placeId, dr.placeText), what: `${k(dr.kg)} · ${dr.soNumber}${dr.client ? " · " + dr.client : ""}`, date: dr.date }))]
                    .map((st: any, si: number) => <div key={si} style={{ display: "flex", gap: 6 }}>
                      <div style={{ fontWeight: 800, minWidth: 14 }}>{si + 1}.</div>
                      <div style={{ fontWeight: 700, minWidth: 92 }}>{st.kind}</div>
                      <div style={{ flex: 1 }}>{st.place}{st.date ? ` — ${st.date}` : ""} — {st.what}</div>
                    </div>)}
                </div>)}
              </div>);
          }
          const extraStops = providerScopedLegs.flatMap((l: any) => l.stops || []);
          if (!extraStops.length) return (<>
            <FieldPrint en="Loading place" pl="Miejsce zaladunku" value={loadingPlaceFinal} />
            <FieldPrint en="Unloading place" pl="Miejsce rozladunku" value={unloadingPlaceFinal} />
          </>);
          // FB-8: stops are ADDITIVE — the base loading/unloading stay and the extra
          // stops are inserted into the tour, so the first load/unload never disappear.
          const tourStops = [
            { id: "base-load", kind: "loading", custom: loadingPlace, plannedAt: "", notes: "base loading" },
            ...extraStops,
            { id: "base-unload", kind: "unloading", custom: unloadingPlace, plannedAt: "", notes: "base unloading" },
          ];
          return (
            <div style={{ gridColumn: "1 / -1", border: "1px solid #ccc", padding: "4px 6px" }}>
              <div style={{ fontWeight: 800 }}>Route stops / Punkty trasy</div>
              {tourStops.map((st: any, si: number) => (
                <div key={st.id || si} style={{ display: "flex", gap: 6 }}>
                  <div style={{ fontWeight: 800, minWidth: 14 }}>{si + 1}.</div>
                  <div style={{ fontWeight: 700, minWidth: 92 }}>{st.kind === "unloading" ? "Unloading / Rozladunek" : "Loading / Zaladunek"}</div>
                  <div style={{ flex: 1 }}>{st.custom || "TBA"}{st.plannedAt ? ` — ${st.plannedAt}` : ""}{st.notes ? ` — ${st.notes}` : ""}</div>
                </div>
              ))}
            </div>
          );
        })()}
        <FieldPrint en="Customs clearance" pl="Odprawa celna" value={broker ? `${broker.name}\n${broker.address || ""}` : (shipment.customsClearance || "TBA")} />
        <FieldPrint en="Temperature" pl="Temperatura" value={tempText} />
        {(() => {
          // v6.14 (#6): booking / BL / shipping line are leg-level and cover all
          // units — surface them once here for sea/rail legs.
          const seaLeg = selectedLegs.find((l: any) => l.mode === "Sea" || l.mode === "Rail");
          if (!seaLeg) return null;
          const v = [seaLeg.bookingNumber && `Booking ${seaLeg.bookingNumber}`, seaLeg.blNumber && `BL ${seaLeg.blNumber}`, seaLeg.shippingLine].filter(Boolean).join("\n") || "TBA";
          return <FieldPrint en="Booking / BL / Line" pl="Booking / konosament / linia" value={v} />;
        })()}
        <FieldPrint en="Loading date & time" pl="Data i godzina zaladunku" value={loadingDateTime} />
        <FieldPrint en="Unloading date & time" pl="Data i godzina rozladunku" value={unloadingDateTime} />
        <FieldPrint en="Goods" pl="Towar" value="Food goods - clean trailer / container · Towar spozywczy - czysta naczepa / kontener" />
        <FieldPrint en={`Agreed price for this ${providerRole.toLowerCase()} order`} pl="Uzgodniony fracht dla tego zlecenia" value={agreedPriceText} />
      </div>

      {/* v6.99.50 (TO-3, owner): the CARRIER plans by pallets and gross weight (road limits), not by size — per truck, derived from the
          goods and the packaging (kg/box, boxes/pallet, box tare, pallet tare in Settings). ≈ while the PO line is still ESTIMATED.
          Varieties and net kilos per line belong on the loading protocol and the CMR, not here. */}
      <div style={{ marginTop: 8, fontWeight: 850, fontSize: 11 }}>Cargo / Ladunek</div>
      <table style={{ marginTop: 3, borderCollapse: "collapse", width: "100%" }}>
        <thead><tr>{["Transport unit / Jednostka", "Product / Produkt", "Pallets / Palety", "Kg brutto / Gross (up to)", "Temperature / Temp."].map(h => <th key={h} style={{ border: "1px solid #D1D5DB", padding: 3, background: "#F3F4F6", textAlign: "left" }}>{h}</th>)}</tr></thead>
        <tbody>
          {(() => {
            const est = (g: any) => { const po = (pos || []).find((pp: any) => String(pp.number) === String(g.poRef)); const line = po ? (po.items || []).find((it: any, k: number) => String(it.id ?? k + 1) === String(g.poLineId)) || (po.items || []).find((it: any) => String(it.product) === String(g.product) && String(it.size || "") === String(g.size || "")) : null; return line ? String(line.quantityStatus || "FINAL").toUpperCase() === "ESTIMATED" : false; };
            const rowsFor = (u: any) => {
              const loads = effectiveLoad(shipment, u);   // v6.99.73 (A-TO-7): the container's own cargo, from its feeder trucks
              const rows = loads.length ? loads.map((a: any) => ({ g: scopedGoods.find((g: any) => String(g.id) === String(a.goodsLineId)) || (shipment.goods || []).find((g: any) => String(g.id) === String(a.goodsLineId)), kg: parseNum(a.qtyKg) })).filter((r: any) => r.g) : scopedGoods.map((g: any) => ({ g, kg: parseNum(g.qtyKg) }));
              let pallets = 0, gross = 0, anyEst = false; const products = new Set<string>();
              rows.forEach(({ g, kg }: any) => { const gr = grossForGoodsLine({ ...g, qtyKg: kg, boxes: undefined, pallets: undefined }, packagingTypes || []); pallets += gr.pallets || 0; gross += gr.grossKg || kg; if (est(g)) anyEst = true; products.add(`${g.product}${g.packaging ? ", " + g.packaging : ""}`); });
              return { pallets, gross, anyEst, product: Array.from(products).join(" · ") || "—" };
            };
            const units = orderUnits.length ? orderUnits : [{ truckPlate: "", containerNo: "" }];
            const tot = { pallets: 0, gross: 0, anyEst: false };
            const trs = units.map((u: any, k: number) => { const r = rowsFor(u); tot.pallets += r.pallets; tot.gross += r.gross; tot.anyEst = tot.anyEst || r.anyEst; return (
              <tr key={k}>
                <td style={{ border: "1px solid #D1D5DB", padding: 3, fontWeight: 700 }}>{u.truckPlate || u.containerNo || `unit ${k + 1}`}{u.trailerPlate ? ` / ${u.trailerPlate}` : ""}</td>
                <td style={{ border: "1px solid #D1D5DB", padding: 3 }}>{r.product}</td>
                <td style={{ border: "1px solid #D1D5DB", padding: 3, textAlign: "right" }}>{r.anyEst ? "≈ " : ""}{r.pallets || "—"}</td>
                <td style={{ border: "1px solid #D1D5DB", padding: 3, textAlign: "right" }}>{r.anyEst ? "≈ " : ""}{r.gross ? fmtNum(Math.round(r.gross)) : "—"}</td>
                <td style={{ border: "1px solid #D1D5DB", padding: 3 }}>{tempText || "—"}</td>
              </tr>); });
            return <>
              {trs}
              {units.length > 1 && <tr style={{ fontWeight: 800, background: "#F3F4F6" }}><td style={{ border: "1px solid #D1D5DB", padding: 3 }} colSpan={2}>Total / Razem</td><td style={{ border: "1px solid #D1D5DB", padding: 3, textAlign: "right" }}>{tot.anyEst ? "≈ " : ""}{tot.pallets}</td><td style={{ border: "1px solid #D1D5DB", padding: 3, textAlign: "right" }}>{tot.anyEst ? "≈ " : ""}{fmtNum(Math.round(tot.gross))}</td><td style={{ border: "1px solid #D1D5DB", padding: 3 }} /></tr>}
              <tr><td colSpan={5} style={{ padding: "4px 3px", fontSize: 9.5, color: "#555", border: "none" }}>{tot.anyEst ? "≈ estimated — quantities not yet final with the producer. " : ""}Final weights per transport unit are stated on the loading protocol and the CMR. / Ostateczne wagi na protokole załadunku i CMR.</td></tr>
            </>;
          })()}
        </tbody>
      </table>

      <div style={{ marginTop: 8, fontWeight: 850, fontSize: 11 }}>{allRoad ? "Truck / driver information · Dane pojazdow i kierowcow" : anyRoad ? "Transport units · Dane jednostek transportowych" : "Container / BL / AWB information · Dane kontenerow"}</div>
      <table style={{ marginTop: 3, borderCollapse: "collapse", width: "100%" }}>
        <thead><tr>{unitCols.map(c => <th key={c.h} style={{ border: "1px solid #D1D5DB", padding: 3, background: "#F9FAFB", textAlign: "left" }}>{c.h}</th>)}</tr></thead>
        <tbody>{units.map((u, i) => <tr key={i}>
          {unitCols.map(c => <td key={c.h} style={{ border: "1px solid #D1D5DB", padding: 3 }}>{c.render(u, i)}</td>)}
        </tr>)}</tbody>
      </table>

      <div style={{ marginTop: 6, fontWeight: 850, fontSize: 9.5 }}>Terms / Warunki</div>{/* v6.99.140 (A-TO-8, owner): the terms in a smaller type — room below for the carrier's signature and stamp */}
      {allRoad ? (
        <ol style={{ marginTop: 2, paddingLeft: 14, marginBottom: 0, fontSize: 8, lineHeight: 1.25 }}>{ROAD_TERMS.map((t, i) => <li key={i} style={{ marginBottom: 1 }}><span>{t[0]}</span> <span style={{ color: "#555", fontStyle: "italic" }}>/ {t[1]}</span></li>)}</ol>
      ) : manualTermsLines.length > 0 ? (
        <ol style={{ marginTop: 2, paddingLeft: 14, marginBottom: 0, fontSize: 8, lineHeight: 1.25 }}>{manualTermsLines.map((t, i) => <li key={i} style={{ marginBottom: 1 }}>{t}</li>)}</ol>
      ) : (
        <div style={{ marginTop: 3, fontStyle: "italic", color: "#555" }}>Terms as per separate agreement / booking confirmation. · Warunki zgodnie z odrebna umowa / potwierdzeniem bookingu.</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 30, marginTop: 14 }}>
        <div style={{ borderTop: "1px solid #111", paddingTop: 4, textAlign: "center" }}>Ordering party / Zleceniodawca<br/>Date, stamp and signature / Data, pieczatka i podpis</div>
        <div style={{ borderTop: "1px solid #111", paddingTop: 4, textAlign: "center" }}>Carrier / Zleceniobiorca<br/>Date, stamp and signature / Data, pieczatka i podpis</div>
      </div>
    </div>
  );
}

export function TransportOrderPrintModal({ shipment, contacts, orders = [], lots = [], onSaveTerms = () => {}, onClose, onMarkSent, onEmail, pos = [], packagingTypes = [] }: any) {
  const providerIds = providerIdsForShipment(shipment);
  const [providerId, setProviderId] = useState(providerIds[0] || shipment.carrierId || shipment.forwarderId || "");
  // Which legs go on this order. Default: the legs belonging to the chosen provider.
  const defaultLegIds = (sh: any, pid: any) => providerLegs(sh, pid).map((l: any) => String(l.id));
  const [legIds, setLegIds] = useState<string[]>(defaultLegIds(shipment, providerId));
  // v6.4.0: editable terms for non-road orders (road orders use the standard
  // CMR clauses). One terms text per shipment, persisted.
  const [termsText, setTermsText] = useState(shipment.customOrderTerms || "");
  const [termsSaved, setTermsSaved] = useState(false);
  // When the provider changes, reset the leg selection to that provider's legs.
  function changeProvider(pid: string) { setProviderId(pid); setLegIds(defaultLegIds(shipment, pid)); }
  function toggleLeg(id: string) { setLegIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); }
  const allLegs = shipment.legs || [];
  const selectedLegObjs = allLegs.filter((l: any) => legIds.includes(String(l.id)));
  const orderIsRoadOnly = selectedLegObjs.length > 0 && selectedLegObjs.every((l: any) => l.mode === "Road");
  return <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
    <div style={{ width: 980, maxHeight: "94vh", overflow: "auto", background: "#fff", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.24)" }}>
      <div style={{ padding: "12px 18px", borderBottom: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><strong>Transport order confirmation</strong><span style={{ color: "#888", marginLeft: 8, fontSize: 12 }}>One clean order per provider — pick the provider and the legs it covers.</span></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Sel value={providerId} onChange={e => changeProvider(e.target.value)} style={{ minWidth: 300, maxWidth: 460 }}>{providerIds.map(id => { const p: any = providerById(id, contacts) || {}; return <option key={id} value={id}>{p.name || id}</option>; })}</Sel><SmallButton onClick={() => printHtmlNode("transport-order-print", `${shipment.number} — ${(providerById(providerId, contacts) || {}).name || providerId}`)} kind="dark" disabled={!legIds.length}>Print / PDF</SmallButton>{onEmail && <SmallButton onClick={() => onEmail(providerId)} kind="blue">✉ Email</SmallButton>}<SmallButton onClick={onMarkSent} kind="green">Mark sent</SmallButton><SmallButton kind="close" onClick={onClose}>Close</SmallButton></div>
      </div>
      <div style={{ padding: "10px 18px", borderBottom: "1px solid #F1F5F9", background: "#FAFAFA", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#64748B" }}>LEGS ON THIS ORDER:</span>
        {allLegs.map((leg: any, i: number) => {
          const checked = legIds.includes(String(leg.id));
          // v6.99.73 (A-TO-7, owner): the box names the CHOSEN provider's own route on this leg — its units' places — and
          // changes with the provider; the leg's own start (the shipment's first producer) is only the fallback
          const mine = providerUnitsForLeg(leg, providerId, shipment);
          const nm = (id: any, text: any) => { const p = placeForPrint(id, text, contacts || []); return p.name || String(text || ""); };
          const uniqJoin = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).join(" + ");
          const from = (mine.length && uniqJoin(mine.map((u: any) => nm(u.pickupLocationId, u.pickupText)))) || locationTextFromFields(leg.fromLocationId, leg.fromCustom);
          const to = (mine.length && uniqJoin(mine.map((u: any) => nm(u.deliveryLocationId, u.deliveryText)))) || locationTextFromFields(leg.toLocationId, leg.toCustom);
          return <label key={leg.id} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, color: checked ? "#111" : "#94A3B8", cursor: "pointer", border: "1px solid", borderColor: checked ? "#2563EB" : "#E5E7EB", borderRadius: 7, padding: "5px 9px", background: checked ? "#EFF6FF" : "#fff" }}>
            <input type="checkbox" checked={checked} onChange={() => toggleLeg(String(leg.id))} />
            <span><strong>Leg #{i + 1} · {leg.mode}</strong> · {from} → {to}</span>
          </label>;
        })}
        {!legIds.length && <span style={{ fontSize: 11, color: "#DC2626", fontWeight: 700 }}>Select at least one leg.</span>}
      </div>
      {!orderIsRoadOnly && legIds.length > 0 && (
        <div style={{ padding: "10px 18px", borderBottom: "1px solid #F1F5F9", background: "#FFFBEB" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#92400E", marginBottom: 5 }}>TERMS FOR THIS SEA / AIR / RAIL ORDER <span style={{ fontWeight: 500 }}>(the standard clauses are road/CMR-specific — enter the agreed terms; one line per clause; saved on this shipment)</span></div>
          <textarea value={termsText} onChange={e => { setTermsText(e.target.value); setTermsSaved(false); }} rows={3} placeholder={"e.g. Payment 30 days after invoice with BL copy.\nFreight all-in per booking confirmation ...\nDemurrage / detention as per line tariff."} style={{ width: "100%", border: "1px solid #FCD34D", borderRadius: 7, padding: "7px 10px", fontSize: 12, fontFamily: "inherit", resize: "vertical", background: "#fff" }} />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6, gap: 8, alignItems: "center" }}>
            {termsSaved && <span style={{ fontSize: 11, color: "#16A34A", fontWeight: 700 }}>✓ saved</span>}
            <SmallButton kind="green" onClick={() => { onSaveTerms(termsText); setTermsSaved(true); }}>Save terms</SmallButton>
          </div>
        </div>
      )}
      <div style={{ padding: 22, background: "#ECECEC" }}>
        <div id="transport-order-print" style={{ width: "190mm", margin: "0 auto", background: "#fff", boxShadow: "0 3px 16px rgba(0,0,0,0.18)" }}>
          <TransportOrderDocument lots={lots} pos={pos} packagingTypes={packagingTypes} shipment={shipment} contacts={contacts} providerId={providerId} legIds={legIds} orders={orders} customTerms={termsText} />
        </div>
      </div>
    </div>
  </div>;
}

export function TransportOrderEmailModal({ shipment, contacts, orders = [], lots = [], onClose, onMarkSent, pos = [], packagingTypes = [] }: any) {
  const providerIds = providerIdsForShipment(shipment);
  const [providerId, setProviderId] = useState(providerIds[0] || shipment.carrierId || shipment.forwarderId || "");
  const provider: any = providerById(providerId, contacts) || {};
  const providerLegList: any[] = providerLegs(shipment, providerId);
  const firstProviderLeg: any = providerLegList[0] || {};
  const lastProviderLeg: any = providerLegList[providerLegList.length - 1] || firstProviderLeg;
  // v6.16 (#7): show the freight in the currency chosen for this provider's leg(s),
  // not the system PLN default. Mixed currencies are listed per currency.
  const freightText = (() => {
    const pCosts = providerCosts(shipment, providerId);
    const byCur: Record<string, number> = {};
    pCosts.forEach((c: any) => { const cur = c.currency || "PLN"; byCur[cur] = (byCur[cur] || 0) + parseNum(c.amount); });
    const entries = Object.entries(byCur).filter(([, v]) => v > 0);
    return entries.length ? entries.map(([cur, v]) => fmtMoney(v, cur)).join(" + ") : fmtMoney(shipmentCostPLN(shipment), "PLN");
  })();
  const makeBody = () => `Dear ${provider.name || provider.contact || "Carrier / Forwarder"},\n\nPlease find attached our bilingual transport order ${shipment.transportOrderNo || shipment.number}.\n\nLoading: ${locationTextFromFields(firstProviderLeg.fromLocationId || shipment.originLocationId, firstProviderLeg.fromCustom || shipment.originCustom)}\nDelivery: ${locationTextFromFields(lastProviderLeg.toLocationId || shipment.destinationLocationId, lastProviderLeg.toCustom || shipment.destinationCustom)}\nDate: ${formatDMY(firstProviderLeg.plannedPickupDate || shipment.loadingDate) || "TBA"}\nFreight: ${freightText}\n\nPlease confirm receipt and send truck / driver / container details when available.\n\nBest regards,\nMARIANNA`;
  const [subject, setSubject] = useState(`Transport Order ${shipment.transportOrderNo || shipment.number} / Zlecenie transportowe — ${COMPANY.name}`);
  const [body, setBody] = useState(makeBody());
  // v6.16 (#6): for multimodal there are several providers — when the user switches
  // the provider, rebuild the body so it addresses the chosen carrier/forwarder
  // (and its own leg + freight), instead of keeping the first provider's text.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => { setBody(makeBody()); }, [providerId]);
  const recipient = provider.email || "";
  function openMailClient() {
    const mailto = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
    if (onMarkSent) onMarkSent();
  }
  return <div style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
    <div style={{ width: 660, maxHeight: "94vh", overflow: "auto", background: "#fff", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.24)" }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><strong>Email transport order</strong><div style={{ color: "#888", fontSize: 12 }}>Save PDF first, then open an email draft and attach the PDF.</div></div>
        <ActionButton action="close" onClick={onClose} />
      </div>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ padding: "10px 12px", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, fontSize: 12, color: "#92400E" }}>Until the backend email service is built, this follows the same two-step workflow as PO/SO email: save the document as PDF, then open your mail client.</div>
        <div><Lbl>Provider</Lbl><Sel value={providerId} onChange={e => setProviderId(e.target.value)}>{providerIds.map(id => { const p: any = providerById(id, contacts) || {}; return <option key={id} value={id}>{p.name || id}</option>; })}</Sel></div><div><Lbl>TO</Lbl><Inp value={recipient || "(no email — set it on this carrier in Contacts, or reselect the carrier above)"} disabled style={{ background: "#F9FAFB", color: recipient ? "#111" : "#B45309" }} /></div>
        <div><Lbl>SUBJECT</Lbl><Inp value={subject} onChange={e => setSubject(e.target.value)} /></div>
        <div><Lbl>MESSAGE</Lbl><textarea value={body} onChange={e => setBody(e.target.value)} rows={10} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", outline: "none", resize: "vertical", lineHeight: 1.6 }} /></div>
        <div style={{ position: "absolute", left: -99999, top: 0 }}><div id="transport-order-email-doc" style={{ width: "190mm" }}><TransportOrderDocument lots={lots} pos={pos} packagingTypes={packagingTypes} shipment={shipment} contacts={contacts} providerId={providerId} legIds={providerLegList.map((l: any) => String(l.id))} orders={orders} customTerms={shipment.customOrderTerms || ""} /></div></div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", borderTop: "1px solid #F3F4F6", paddingTop: 14 }}>
          <SmallButton onClick={onClose}>Cancel</SmallButton>
          <SmallButton onClick={() => printHtmlNode("transport-order-email-doc", `${shipment.number} — ${(providerById(providerId, contacts) || {}).name || providerId}`)} kind="blue">① Save PDF</SmallButton>
          <button onClick={openMailClient} disabled={!recipient} title={!recipient ? "Carrier / forwarder email missing in Contacts" : ""} style={{ padding: "8px 14px", borderRadius: 7, border: "none", background: recipient ? "#16A34A" : "#D1D5DB", color: "#fff", fontWeight: 700, cursor: recipient ? "pointer" : "not-allowed" }}>② Open email draft →</button>
        </div>
      </div>
    </div>
  </div>;
}

export function TransportOrdersCard({ shipment, contacts = [], onMarkSent = null, onCompose = null, packagingTypes = [], orders = [], pos = [], lots = [] }: any) {
  const variance = cargoVariance(shipment, packagingTypes || []);
  const jobs = jobsByCarrierLeg(shipment);
  if (!jobs.length) return null;
  const name = (id: any) => ((contacts || []).find((c: any) => String(c.id) === String(id)) || {}).name || "(carrier not set)";
  const sent = shipment.transportOrders || {};
  return (
    <Card>
      {variance && Math.abs(variance.overKg) > 50 && (
        <div style={{ fontSize: 11.5, fontWeight: 700, color: variance.overKg > 0 ? "#92400E" : "#166534", background: variance.overKg > 0 ? "#FFFBEB" : "#F0FDF4", border: `1px solid ${variance.overKg > 0 ? "#FDE68A" : "#BBF7D0"}`, borderRadius: 7, padding: "6px 9px", marginBottom: 8 }}>
          ⚠ The carrier was told ≈ {variance.told.pallets} pallets · {variance.told.grossKg.toLocaleString("pl-PL")} kg gross — the goods now derive {variance.now.pallets} pallets · {variance.now.grossKg.toLocaleString("pl-PL")} kg ({variance.overKg > 0 ? "+" : ""}{variance.overKg.toLocaleString("pl-PL")} kg). {variance.overKg > 0 ? "Call the carrier before loading day; re-send the order as an amendment." : "Under what was booked — no action needed."}
        </div>
      )}
      <SectionTitle>Transport orders — one per carrier per leg</SectionTitle>
      {jobs.map((j: any) => {
        const st = sent[j.key];
        const dates = Array.from(new Set(j.units.map((u: any) => String(u.plannedLoadingDate || u.loadedAt || "")).filter(Boolean))).join(", ");
        return <div key={j.key} style={{ display: "grid", gridTemplateColumns: "1.4fr 0.6fr 1fr 1fr 1fr auto", gap: 8, alignItems: "center", fontSize: 11.5, padding: "5px 0", borderTop: "1px solid #F8FAFC" }}>
          <div><b>{name(j.carrierId)}</b> · leg {j.legIndex + 1} ({j.mode})</div>
          <div>{j.units.length} unit(s)</div>
          <div>{Math.round(j.kg).toLocaleString("pl-PL")} kg</div>
          <div>{j.amount ? `${j.amount.toLocaleString("pl-PL")} ${j.currency}` : "—"}</div>
          <div style={{ color: "#64748B" }}>{dates || "dates —"}</div>
          <div style={{ display: "flex", gap: 6 }}>
            {onCompose && <SmallButton onClick={() => onCompose(j.carrierId, j.legIndex)}>Order</SmallButton>}
            {(() => {   // v6.99.39 (G-5, owner): the order names places and dates — it cannot be SENT until its units carry them
              const gaps: string[] = (j.units || []).flatMap((u: any) => tourGaps(u, truckTour(shipment, u, pos || [], lots || [], orders || [])));   // v6.99.95 (A-GR-3): a tour truck needs every drop's destination, not one delivery place   // v6.99.75 (A-UN-4): the one rule — the editor outlines the same fields in red
              // v6.99.50 (TO-5, owner): the carrier needs pallets and gross weight — derivable from an ESTIMATE with a packaging; without that the order says nothing about the load
              { const g0 = (shipment.goods || []); const anyKg = g0.some((g: any) => parseNum(g.qtyKg) > 0); const anyPk = g0.some((g: any) => grossForGoodsLine(g, packagingTypes || []).pallets > 0); if (!anyKg) gaps.push("quantities (even estimated)"); else if (!anyPk) gaps.push("a packaging on the goods (pallets and gross derive from it)"); }
              const missing = Array.from(new Set(gaps)) as string[];
              if (st?.sentAt) return <span style={{ fontSize: 10.5, fontWeight: 800, color: "#16A34A" }}>sent {st.sentAt}</span>;
              if (!onMarkSent) return null;
              if (missing.length) return <span title={`Complete on the units: ${missing.join(", ")}`} style={{ fontSize: 10.5, color: "#B45309", fontWeight: 700 }}>⚠ needs {missing.join(", ")}</span>;
              return <SmallButton kind="green" onClick={() => onMarkSent(j.key)}>Mark sent</SmallButton>;
            })()}
          </div>
        </div>;
      })}
    </Card>
  );
}
