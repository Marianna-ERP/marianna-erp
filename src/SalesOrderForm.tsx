import { parseNum } from "./numbers";
// SalesOrderForm.tsx — v6.99.68 (A-AUD-2, owner): moved out of SalesOrders.tsx unchanged; the module's shared helpers are imported from it.
import LocationPicker from "./LocationPicker";
import React, { useState, useMemo } from "react";
import { Card, Lbl, SectionTitle, useConfirm, ActionButton } from "./ui";
import { ItemVarietyPicker } from "./ProductPicker";
import { PAGE_MAX } from "./ui";
import { SO_STATUSES } from "./types";
import { clientExposurePLN } from "./payments.domain";
import { defaultFxRate } from "./fx";
import { deriveSoStatus, statusContradiction, isPhysicalStatus, effectiveSoStatus, isShippedOrLater, soRank } from "./statusOwnership.domain";
import { gradeAvailability as gradeAvailabilityOf } from "./seasonOps.domain";
import { lineFromPOLine, lockRate } from "./so.domain";
import { lineTotal as lineTotalPU, pricingUnit as pricingUnitOf, convertLineUnit, kgPerBoxForLine, unresolvedBoxLines, documentTotals, totalsLine, effectiveCounts } from "./pricingUnit.domain";
import { localTodayISO, formatDMY } from "./dates";
import { nextId } from "./ids";
import { paymentBasisOf, PAYMENT_BASES } from "./po.domain";
import { readCountries } from "./Contacts";
import { useUnsavedGuard } from "./unsaved";
import { CLIENTS, CURRENCIES, INCOTERMS_SELL, Inp, LOTS, PACKAGING_TYPES_REF, PO_REFS, QUALITY_GRADES, QualityBadge, RAW_LOTS, SHIPMENTS_REF, Sel, SourceBadge, computeLineAvailability, fmtMoney, fmtNum, lotReservations, netTotal, poLineReservations, sameSoDuplicateSources, supplierNameForPO, validatePOReadinessForSO, validateSourcing } from "./SalesOrders";

// ─── SOURCE PICKER MODAL ──────────────────────────────────────────────────
// Lets the user pick where a SO line's goods will come from: a stock lot, or a PO.
// Filters intelligently by product (case-insensitive substring match).
export function SourcePickerModal({ lineItem, lineIndex, allOrders = [], currentOrderId = null, onCancel, onPick }: any) {
  const [tab, setTab] = useState("STOCK"); // STOCK | PO
  const [filter, setFilter] = useState(lineItem.product || "");

  const productMatch = (p) => !filter || (p || "").toLowerCase().includes(filter.toLowerCase());

  const byNumDesc = (a: any, b: any) => String(b?.number || "").localeCompare(String(a?.number || ""), undefined, { numeric: true });
  const matchingLots = LOTS.filter(l => productMatch(l.product)).sort(byNumDesc); // v6.81.0 (D-58): newest first
  // PO lines: flatten POs to their items, filter on product
  const matchingPOLines = [...PO_REFS].sort(byNumDesc).flatMap(po =>
    po.items.map(it => ({ ...it, _po: po }))
  ).filter(x => productMatch(x.product)); // v6.81.0 (D-58): newest PO first

  function pickLot(lot) {
    onPick({
      sourceType: "STOCK",
      sourceRef: lot.number,
      sourceLineId: null,
      // Auto-fill spec fields from the lot for convenience
      product: lot.product,
      variety: lot.variety || "",
      cnCode: lot.cnCode || "",
      origin: lot.origin,
      size: lot.size,
      quality: lot.quality,
      packaging: lot.packaging,
    });
  }
  function pickPO(poLine) {
    onPick({
      sourceType: "PO",
      sourceRef: poLine._po.number,
      sourceLineId: poLine.id,
      product: poLine.product,
      variety: poLine.variety || "",
      cnCode: poLine.cnCode || "",
      origin: poLine.origin,
      size: poLine.size,
      quality: poLine.quality,
      packaging: poLine.packaging,
      ...lineFromPOLine(poLine), // v6.95.0 (SO-2): unit, boxes and kg/box follow the PO line
      pallets: poLine.pallets ?? "",  // v6.99.6 (A-R9-4): pallets follow the PO line (user adjusts)
      // v6.92.0 (A-R8-6, owner ruling): pre-fill the AVAILABLE quantity — the PO line minus what other
      // non-cancelled SOs already reserve from it — never the full line when part of it is sold elsewhere.
      qty: (() => { const r = poLineReservations(poLine._po, poLine, allOrders, currentOrderId); const base = (poLine.available ?? poLine.qty); const avail = Math.max(0, Math.round((parseFloat(String(base)) || 0) - (r?.totalReserved || 0))); return avail > 0 ? avail : ""; })(),
      _poExpectedDelivery: poLine._po.expectedDelivery, // signal up to the form for the delivery date warning
    });
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#fff", borderRadius: 14, width: "min(820px, 96vw)", maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #EBEBEB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Pick source for line {lineIndex + 1}</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Source the goods from stock (lot in our warehouse) or from a PO (pre-sold from supplier)</div>
          </div>
          <ActionButton action="close" onClick={onCancel} />
        </div>

        <div style={{ padding: "12px 24px", borderBottom: "1px solid #F3F4F6", display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setTab("STOCK")} style={{ padding: "6px 14px", borderRadius: 7, border: tab === "STOCK" ? "1px solid #0369A1" : "1px solid #E5E7EB", background: tab === "STOCK" ? "#E0F2FE" : "#fff", color: tab === "STOCK" ? "#0369A1" : "#555", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>📦 From Stock ({matchingLots.length})</button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "#888" }}>Filter by product:</span>
            <Inp value={filter} onChange={e => setFilter(e.target.value)} placeholder="e.g. Carrot" style={{ width: 200 }} />
          </div>
        </div>

        <div style={{ padding: 20, overflowY: "auto", flex: 1, background: "#FAFAFA" }}>
          {tab === "STOCK" && (
            matchingLots.length === 0 ? (
              <div style={{ textAlign: "center", color: "#AAA", padding: 30, fontSize: 13 }}>No matching lots in stock.</div>
            ) : (
              matchingLots.map(lot => {
                const live = lotReservations(lot, allOrders, currentOrderId);
                // v6.99.38 (A-R26-3, owner): a class I line may only be offered what class I holds. The lot's raw
                // stock would show class II fruit as if it could serve a class I sale — which is how a sorted lot
                // appeared to have more first class than it had.
                const rawLot = (RAW_LOTS || []).find((l: any) => String(l.number) === String(lot.number)) || null;
                const lineClass = String(lineItem?.grade || lineItem?.quality || "I").toUpperCase() === "II" ? "II" : "I";
                const byGrade = rawLot ? gradeAvailabilityOf(rawLot, allOrders, currentOrderId) : null;
                const classAvailable = byGrade ? (lineClass === "II" ? byGrade.II : byGrade.I) : live.liveAvailable;
                const offer = byGrade ? Math.max(0, Math.min(live.liveAvailable, classAvailable)) : live.liveAvailable;
                const isEmpty = offer <= 0;
                return (
                <div key={lot.number} onClick={() => pickLot(lot)}
                  style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 10, padding: "12px 14px", marginBottom: 8, cursor: "pointer", display: "grid", gridTemplateColumns: "140px 1fr 90px 130px", gap: 12, alignItems: "center", opacity: isEmpty ? 0.65 : 1 }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#0369A1"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "#EBEBEB"}>
                  <div>
                    <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, fontWeight: 700, color: "#0369A1" }}>{lot.number}</div>
                    {(lot as any).status && <span style={{ display: "inline-block", marginTop: 3, fontSize: 9.5, fontWeight: 700, padding: "1px 7px", borderRadius: 5, background: "#F0FDF4", color: "#15803D", border: "1px solid #BBF7D0" }}>{(lot as any).status}</span>}
                    {/* v6.99.127 (A-ONE-1): where the lot is — expected at the producer, in our stock, or direct — and the PO it comes from */}
                    <div style={{ fontSize: 10.5, color: "#64748B", marginTop: 2 }}>{(lot as any).lotState === "rejected by quality report" ? "⚠ rejected by the quality report — not for sale until sorted or returned" : (lot as any).lotState === "expected" ? "expected · not yet received" : (lot as any).lotState === "direct" ? "direct · producer → client" : (lot as any).lotState === "in stock" ? "in our stock" : (lot as any).lotState || ""}{(lot as any).poRef ? ` · from ${(lot as any).poRef}` : ""}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{lot.product}{(lot as any).variety ? " — " + (lot as any).variety : ""}</div>
                    {/* v6.59.0: both views now carry the SAME facts under the
                        item and variety — size, origin, packaging, supplier and
                        the arrival. The two tabs used to describe a lot and a PO
                        line differently, so choosing between them meant reading
                        two different layouts. The 4th column is gone: it held a
                        warehouse for stock and a permanent dash for a PO line
                        that has not arrived anywhere yet. */}
                    <div style={{ fontSize: 11, color: "#888" }}>{lot.size} · {lot.origin} · {lot.packaging}</div>
                    <div style={{ fontSize: 10, color: "#AAA", marginTop: 2 }}>
                      Supplier: {(() => { const po = PO_REFS.find((x: any) => x.number === lot.poRef); return po?.supplierName || po?.supplier?.name || "—"; })()}
                      {(lot as any).arrivalDate ? ` · arrived ${formatDMY((lot as any).arrivalDate)}` : " · arrival not recorded"}
                      {lot.poRef ? ` · from ${lot.poRef}` : ""}
                      {lot.warehouse ? ` · ${lot.warehouse}` : ""}
                    </div>
                    {live.reservations.length > 0 && (
                      <div style={{ fontSize: 10, color: "#166534", marginTop: 3 }}>
                        Reserved: {live.reservations.map(r => `${fmtNum(r.qty)} kg by ${r.soNumber}`).join(" · ")}
                      </div>
                    )}
                  </div>
                  <div><QualityBadge quality={lot.quality} /></div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isEmpty ? "#9CA3AF" : "#16A34A" }}>{fmtNum(offer)} kg</div>
                    <div style={{ fontSize: 10, color: "#888" }}>available as class {lineClass}</div>
                    {byGrade && (byGrade.II > 0 || byGrade.I > 0) && <div style={{ fontSize: 9.5, color: "#94A3B8" }}>lot holds I {fmtNum(byGrade.I)} · II {fmtNum(byGrade.II)}</div>}
                    {live.totalReserved > 0 && (
                      <div style={{ fontSize: 9.5, color: "#AAA", marginTop: 1 }}>of {fmtNum(lot.availableKg)} total</div>
                    )}
                  </div>
                </div>
                );
              })
            )
          )}
          {tab === "PO" && (
            matchingPOLines.length === 0 ? (
              <div style={{ textAlign: "center", color: "#AAA", padding: 30, fontSize: 13 }}>No matching POs.</div>
            ) : (
              matchingPOLines.map((line, idx) => {
                const live = poLineReservations(line._po, line, allOrders, currentOrderId);
                const isEmpty = live.liveAvailable <= 0;
                return (
                <div key={`${line._po.number}-${line.id}`} onClick={() => pickPO(line)}
                  style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 10, padding: "12px 14px", marginBottom: 8, cursor: "pointer", display: "grid", gridTemplateColumns: "140px 1fr 90px 130px", gap: 12, alignItems: "center", opacity: isEmpty ? 0.65 : 1 }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#166534"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "#EBEBEB"}>
                  <div>
                    <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, fontWeight: 700, color: "#166534" }}>{line._po.number}</div>
                    <span style={{
                      display: "inline-block", marginTop: 3, padding: "1px 6px", borderRadius: 4,
                      fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em",
                      background: line._po.status === "Draft" ? "#F3F4F6" : "#DBEAFE",
                      color: line._po.status === "Draft" ? "#6B7280" : "#2563EB",
                    }}>{line._po.status}</span>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{line.product}{(line as any).variety ? " — " + (line as any).variety : ""}</div>
                    <div style={{ fontSize: 11, color: "#888" }}>{line.size} · {line.origin} · {line.packaging}</div>
                    <div style={{ fontSize: 10, color: "#AAA", marginTop: 2 }}>
                      Supplier: {line._po.supplierName || line._po.supplier?.name || "—"}
                      {line._po.expectedDelivery ? ` · arriving ${formatDMY(line._po.expectedDelivery)}` : " · arrival not scheduled"}
                      {` · from ${line._po.number}`}
                    </div>
                    {live.reservations.length > 0 && (
                      <div style={{ fontSize: 10, color: "#166534", marginTop: 3 }}>
                        Reserved: {live.reservations.map(r => `${fmtNum(r.qty)} kg by ${r.soNumber}`).join(" · ")}
                      </div>
                    )}
                  </div>
                  <div><QualityBadge quality={line.quality} /></div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isEmpty ? "#9CA3AF" : "#9D174D" }}>{fmtNum(live.liveAvailable)} kg</div>
                    <div style={{ fontSize: 10, color: "#888" }}>live available</div>
                    {live.totalReserved > 0 && (
                      <div style={{ fontSize: 9.5, color: "#AAA", marginTop: 1 }}>of {fmtNum(line.available)} total</div>
                    )}
                  </div>
                </div>
                );
              })
            )
          )}
        </div>
      </div>
    </div>
  );
}

export function OrderForm({ order, setOrder, productSuggestions = [], allOrders = [], clients = CLIENTS, contacts = [], productCatalog = [], setProductCatalog, onSave, onCancel, onPrint, onEmail , allInvoices = [] }: any) {
  const { confirm: ofConfirm, alert: ofAlert, dialogNode: ofNode } = useConfirm(); // v6.44.0 (#6 warning) + v6.63.0 (D-10 forward-only alert)
  // v6.99.15: the destination is a LocationPicker over unifiedLocations() — no module-level list any more.
  const sf = (k, v) => setOrder(o => ({ ...o, [k]: v }));
  // v6.79.0 (W-1): locks read the EFFECTIVE status — a typed label cannot unlock what the shipments locked, or lock what never moved.
  const soFullyLocked = (_st: any, o?: any) => isShippedOrLater(o || order, SHIPMENTS_REF);
  const si = (i, k, v) => setOrder(o => soFullyLocked(o.status, o) ? o : ({ ...o, items: o.items.map((it, idx) => idx === i ? { ...it, [k]: v } : it) }));
  const addItem = () => setOrder(o => soFullyLocked(o.status, o) ? o : ({ ...o, items: [...o.items, { id: nextId(), product: "", variety: "", cnCode: "", origin: "", size: "", quality: "I", unit: "Kg", qty: "", pallets: "", unitPrice: "", sourceType: null, sourceRef: "", sourceLineId: null, packaging: "" }] }));
  const removeItem = (i) => setOrder(o => soFullyLocked(o.status, o) ? o : ({ ...o, items: o.items.filter((_, idx) => idx !== i) }));
  const setClient = (name) => {
    const c = clients.find(c => c.name === name);
    // v6.99.59 (A-OW-1, owner): the party's TERMS (payment basis + days, default currency) come with it — the picker's list holds only
    // the party's identity, so they are read from the live counterparty by id. The SO keeps them as the terms agreed for this sale.
    const live: any = c ? (contacts || []).find((x: any) => String(x.id) === String(c.id)) : null;
    const tr: any = (live && live.terms) || {};
    setOrder(o => {
      const next: any = { ...o, client: c || null };
      if (live) {
        if (tr.paymentBasis) next.paymentBasis = tr.paymentBasis;
        if (tr.paymentDays !== undefined && tr.paymentDays !== null && tr.paymentDays !== "") next.paymentDays = tr.paymentDays;
        const cur = tr.defaultCurrency || live.defaultCurrency; if (cur) next.currency = cur;
      }
      // v6.10 (#15): the delivery destination defaults to the client's own
      // registered address, unless the user has switched to an "Other" address.
      if ((o.destinationMode || ((o.destinationLocationId || o.destinationText) ? "other" : "client")) === "client") {
        next.destinationMode = "client";
        next.destinationLocationId = null;
        next.destinationText = c?.address || "";
      }
      return next;
    });
  };
  // v6.10 (#15): "client" = deliver to the client's registered address;
  // "other" = a different place (dropdown or free text).
  const destMode = order.destinationMode || ((order.destinationLocationId || order.destinationText) ? "other" : "client");
  const setDestMode = (mode) => {
    // v6.34.2 (module review): "client" fills the registered address; anything else
    // CLEARS the free-text and any picked place, so a stale client address can't
    // linger under a CIF/port choice (item: CIF + client address inconsistency).
    if (mode === "client") setOrder(o => ({ ...o, destinationMode: "client", destinationLocationId: null, destinationText: o.client?.address || "" }));
    else setOrder(o => ({ ...o, destinationMode: "other", destinationLocationId: null, destinationText: "" }));
  };
  // v6.11 (#7): destination guidance must match the chosen Incoterm.
  const incotermDestinationHint = (() => {
    const ic = String(order.sellIncoterm || "").toUpperCase();
    if (ic === "EXW") return "EXW — we don't deliver: the client collects from the supplier or our warehouse, so no destination is required.";
    if (ic === "FCA" || ic === "FOB") return `${ic} — destination is the relay point or the port of departure where we hand the goods over.`;
    if (ic === "CIF" || ic === "CFR") return `${ic} — destination is the port of arrival.`;
    if (ic === "DAP" || ic === "DDP") return `${ic} — destination is the client's address, or another address the client indicates.`;
    return "Select the Sell Incoterm above for destination guidance.";
  })();

  // v6.3.0: live duplicate check for import-document numbers. Import permits and
  // ACID numbers are single-use — flag immediately if another SO already carries them.
  const permitDupes = React.useMemo(() => {
    const result: any = {};
    (["importPermitNo", "acidNo"] as const).forEach(field => {
      const v = String(order[field] || "").trim().toLowerCase();
      if (!v || v === "n/a") return;
      const clash = (allOrders || []).find(p => p.id !== order.id && String(p[field] || "").trim().toLowerCase() === v);
      if (clash) result[field] = clash.number;
    });
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.importPermitNo, order.acidNo, order.id, allOrders]);

  // Source picker state
  const [sourceFor, setSourceFor] = useState(null); // index of item being sourced, or null
  function applySource(idx, patch) {
    const { _poExpectedDelivery, ...rest } = patch;
    setOrder(o => {
      const items = o.items.map((it, i) => i === idx ? { ...it, ...rest } : it);
      // If we just sourced from a PO and SO delivery is before PO ETA, store the PO ETA for the warning
      let _poETAByLine = { ...(o._poETAByLine || {}) };
      if (rest.sourceType === "PO" && _poExpectedDelivery) {
        _poETAByLine[idx] = _poExpectedDelivery;
      } else {
        delete _poETAByLine[idx];
      }
      return { ...o, items, _poETAByLine };
    });
    setSourceFor(null);
  }
  function clearSource(idx) {
    setOrder(o => {
      const items = o.items.map((it, i) => i === idx ? { ...it, sourceType: null, sourceRef: "", sourceLineId: null } : it);
      const _poETAByLine = { ...(o._poETAByLine || {}) };
      delete _poETAByLine[idx];
      return { ...o, items, _poETAByLine };
    });
  }

  // Status lock: once Confirmed+, currency/fx and pricing fields lock to prevent accidental edits
  const lockedStatuses = new Set(["Confirmed", "Loading", "Shipped", "Delivered", "Invoiced", "Closed"]);
  const isLocked = lockedStatuses.has(effectiveSoStatus(order, SHIPMENTS_REF)); // v6.79.0 (W-1)
  // v6.44.0 (test-round #6, ruling): from SHIPPED onward the SO is FULLY locked —
  // line items, quantities, sourcing and shipping addresses can no longer change
  // (the goods are on their way; the commercial deal is fixed). A warning is shown
  // before this lock takes effect (see the banner below).
  const FULLY_LOCKED_STATUSES = new Set(["Shipped", "Delivered", "Invoiced", "Closed"]);
  const fullyLocked = FULLY_LOCKED_STATUSES.has(effectiveSoStatus(order, SHIPMENTS_REF)); // v6.79.0 (W-1)

  // Sourcing rule: every line must be sourced (stock lot OR PO in any status) before
  // the SO can move past Draft. This is a hard business rule — we can't promise goods
  // to a client unless we have a concrete procurement plan.
  const sourcing = validateSourcing(order.items);
  const nonDraftStatuses = Object.keys(SO_STATUSES).filter(s => s !== "Draft" && s !== "Cancelled");
  // Is the user currently trying to be in a non-Draft, non-Cancelled status while unsourced?
  const sourcingBlock = !sourcing.allSourced && nonDraftStatuses.includes(order.status);
  const poReadinessIssues = validatePOReadinessForSO(order.items);
  const poReadinessBlock = poReadinessIssues.length > 0 && nonDraftStatuses.includes(order.status);

  // Per-line availability check — does each line have enough stock/PO supply to fulfill it?
  // Aggregates across all matching sources (primary source + any other lot/PO with same product).
  // HARD BLOCK on non-Draft statuses (same as sourcing): can't promise to a client what we can't supply.
  // Batch 1 (G3): memoized — recompute only when the lines or other orders change,
  // not on every keystroke in unrelated fields.
  const availability = useMemo(() => {
    // v6.99.15 (A-R11-9): an order already loaded / shipped / delivered is history, not a promise — its kilos left the lot as SHIP_OUT, so
    // checking them against what remains would always "exceed". The check applies to orders still to be fulfilled.
    const eff = effectiveSoStatus(order, SHIPMENTS_REF || []);
    if (["Shipped", "Delivered", "Invoiced", "Closed"].includes(String(eff))) return [];
    return computeLineAvailability(order.items, allOrders, order.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.items, allOrders, order.id, order.status, order.statusOverride]);
  const overageCount = availability.filter(a => a.hasOverage).length;
  const availabilityBlock = overageCount > 0 && nonDraftStatuses.includes(order.status);

  // Same-SO duplicate sources: a set of line indices that share a source with another
  // line in THIS order (e.g. the same PO product assigned twice). Map index -> info.
  const dupSourceGroups = sameSoDuplicateSources(order.items);
  const dupLineIndex = {}; // lineIndex -> { sourceRef, sourceLineId, totalQty, count, others:[idx] }
  Object.values(dupSourceGroups).forEach((g: any) => {
    g.indices.forEach((idx: number) => {
      dupLineIndex[idx] = { sourceRef: g.sourceRef, sourceLineId: g.sourceLineId, sourceType: g.sourceType, totalQty: g.totalQty, count: g.indices.length, others: g.indices.filter((x: number) => x !== idx) };
    });
  });
  const hasDuplicateSources = Object.keys(dupSourceGroups).length > 0;

  // Single combined flag for any rule blocking the current status
  // v6.99.60 (A-SO-1, owner): a sale is not confirmed without what it sells and at what price. A line the producer's packing list
  // added to an already confirmed SO at "price to agree" is exempt from the PRICE here — the sales invoice waits for it (v6.99.56).
  const priceQtyGaps = (order.items || []).map((it: any, i: number) => { const miss: string[] = [];
    if (!(parseFloat(it.qty) > 0 || parseFloat(it.boxes) > 0)) miss.push("quantity");
    if (!(parseFloat(it.unitPrice) > 0) && !it.priceToAgree) miss.push("sell price");
    return miss.length ? `line ${i + 1}${it.product ? ` (${[it.product, it.variety, it.size].filter(Boolean).join(" ")})` : ""}: ${miss.join(" and ")}` : null; }).filter(Boolean) as string[];
  const priceQtyBlock = priceQtyGaps.length > 0 && nonDraftStatuses.includes(order.status);
  const isBlocked = sourcingBlock || poReadinessBlock || availabilityBlock || priceQtyBlock;
  // v6.99.60: the leave-guard lives HERE, where the blocks are known — "Save and continue" never saves what the Save button would refuse
  useUnsavedGuard({ id: "so-form", label: order?.number ? `Sales order ${order.number}` : "the new sales order", draft: order, save: () => { if (!isBlocked) onSave(order); } });

  // PO-ETA-vs-SO-delivery warning: if any line sourced from a PO has ETA after this SO's deliveryDate, surface it
  const deliveryWarnings = [];
  order.items.forEach((it, idx) => {
    if (it.sourceType === "PO" && it.sourceRef) {
      const po = PO_REFS.find(p => p.number === it.sourceRef);
      // v6.4.1 fix: field is expectedDeliveryDate — the old name (expectedDelivery)
      // never existed, so this warning could never fire.
      const poETA = po && ((po as any).expectedDeliveryDate || (po as any).expectedDelivery);
      if (po && order.deliveryDate && poETA && order.deliveryDate < poETA) {
        deliveryWarnings.push({ idx, lineProduct: it.product, poRef: it.sourceRef, poETA });
      }
    }
  });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {ofNode}
      {sourceFor !== null && (
        <SourcePickerModal
          lineItem={order.items[sourceFor]}
          lineIndex={sourceFor}
          allOrders={allOrders}
          currentOrderId={order.id}
          onCancel={() => setSourceFor(null)}
          onPick={(patch) => applySource(sourceFor, patch)}
        />
      )}
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#2563EB", fontWeight: 500 }}>← Sales Orders</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          {onPrint && (() => {
            const isDraft = order.status === "Draft";
            return (
              <button
                onClick={isDraft ? undefined : onPrint}
                disabled={isDraft}
                title={isDraft ? "Confirm the SO first — drafts cannot be printed or shared with clients" : ""}
                style={{
                  padding: "5px 14px", borderRadius: 7,
                  border: "1px solid #E5E7EB",
                  background: isDraft ? "#F9FAFB" : "#fff",
                  color: isDraft ? "#9CA3AF" : "#111",
                  fontSize: 12, fontWeight: 600,
                  cursor: isDraft ? "not-allowed" : "pointer"
                }}>Print</button>
            );
          })()}
          {(() => {
            const isDraft = order.status === "Draft";
            return (
              <button
                type="button"
                onClick={isDraft ? undefined : onEmail}
                disabled={isDraft}
                title={isDraft ? "Confirm the SO first — drafts cannot be emailed to clients" : ""}
                style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #E5E7EB", background: isDraft ? "#F9FAFB" : "#fff", color: isDraft ? "#9CA3AF" : "#111", fontSize: 12, fontWeight: 600, cursor: isDraft ? "not-allowed" : "pointer" }}
              >✉ Email Client</button>
            );
          })()}
          <button onClick={onCancel} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          <button
            onClick={() => onSave(order)}
            disabled={isBlocked}
            title={
              sourcingBlock ? `Cannot save as ${order.status} with unsourced lines — pick sources first or set status back to Draft` :
              poReadinessBlock ? `Cannot save as ${order.status} while a sourced PO is Draft, Cancelled or missing.` :
              availabilityBlock ? `Cannot save as ${order.status} — ${overageCount} line(s) exceed available supply. Reduce qty, change source, or set status back to Draft.` :
              ""
            }
            style={{
              padding: "5px 16px", borderRadius: 7, border: "none",
              background: isBlocked ? "#D1D5DB" : "#111",
              color: "#fff", fontSize: 12, fontWeight: 600,
              cursor: isBlocked ? "not-allowed" : "pointer"
            }}>
            Save SO
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", background: "#FAFAFA" }}>
        <div style={{ maxWidth: PAGE_MAX, margin: "0 auto" }}>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#111" }}>{order.id ? `Edit ${order.number}` : "New Sales Order"}</div>
            <div style={{ fontSize: 12, color: "#AAA", marginTop: 2 }}>Sell to a client — goods come from stock or pre-sold from a PO</div>
          </div>

          {priceQtyBlock && (
            <div style={{ padding: "12px 16px", background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 8, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#991B1B" }}>Cannot save as {order.status} — {priceQtyGaps.length} line{priceQtyGaps.length === 1 ? "" : "s"} without quantity or sell price</div>
              <div style={{ fontSize: 11.5, color: "#991B1B", marginTop: 4, lineHeight: 1.5 }}>{priceQtyGaps.join(" · ")}. Keep it as Draft until they are known.</div>
            </div>
          )}
          {sourcingBlock && (
            <div style={{ padding: "12px 16px", background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 8, marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ fontSize: 20 }}>🚫</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#991B1B" }}>Cannot save as {order.status} — {sourcing.unsourcedIndexes.length} line{sourcing.unsourcedIndexes.length === 1 ? " is" : "s are"} unsourced</div>
                <div style={{ fontSize: 11, color: "#991B1B", marginTop: 4, lineHeight: 1.5 }}>
                  Every line item must be sourced from either a stock lot or a purchase order (any status, including Draft) before this SO can move past Draft.
                  {sourcing.unsourcedIndexes.length > 0 && (
                    <span> Unsourced: line{sourcing.unsourcedIndexes.length === 1 ? "" : "s"} <strong>{sourcing.unsourcedIndexes.map(i => i + 1).join(", ")}</strong>.</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {poReadinessBlock && (
            <div style={{ padding: "12px 16px", background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 8, marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ fontSize: 20 }}>🚫</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#991B1B" }}>Cannot save as {order.status} — source PO is not confirmed</div>
                <div style={{ fontSize: 11, color: "#991B1B", marginTop: 4, lineHeight: 1.5 }}>
                  A Sales Order cannot be confirmed/reserved/shipped while it refers to a Purchase Order in Draft, Cancelled or missing status. Blocked: <strong>{poReadinessIssues.map((x: any) => `${x.poRef} (${x.status})`).join(", ")}</strong>.
                </div>
              </div>
            </div>
          )}

          {/* v6.61.0: a line priced per box with no box weight cannot be
              converted, and inventing one would put a wrong number on an
              invoice. Say so before that happens. */}
          {(() => { const bad = unresolvedBoxLines(order.items, PACKAGING_TYPES_REF);
            return bad.length ? (
              <div style={{ margin: "0 0 10px", padding: "9px 11px", borderRadius: 7, background: "#FFFBEB", border: "1px solid #FDE68A", fontSize: 11.5, color: "#92400E" }}>
                <strong>Priced per box, but no box weight is set</strong> for {Array.from(new Set(bad)).join(", ")}. Set the packaging on the line so boxes can convert to kilos.
              </div>
            ) : null; })()}
          {overageCount > 0 && (
            availabilityBlock ? (
              <div style={{ padding: "12px 16px", background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 8, marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ fontSize: 20 }}>🚫</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#991B1B" }}>
                    Cannot save as {order.status} — {overageCount} line{overageCount === 1 ? "" : "s"} exceed available supply
                  </div>
                  <div style={{ fontSize: 11, color: "#991B1B", marginTop: 4, lineHeight: 1.5 }}>
                    You cannot confirm a Sales Order while it promises more goods than we can supply. For each flagged line, either reduce qty, switch to a source with more available stock or PO supply, or arrange more procurement (a new or larger PO). To save without confirming, set status back to Draft.
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: "12px 16px", background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 8, marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ fontSize: 20 }}>⚠️</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#92400E" }}>
                    {overageCount} line{overageCount === 1 ? "" : "s"} exceed available supply (Draft only)
                  </div>
                  <div style={{ fontSize: 11, color: "#92400E", marginTop: 4, lineHeight: 1.5 }}>
                    This SO is over-allocated. You can keep it as a Draft while procurement scales up supply, but it cannot be Confirmed in this state.
                  </div>
                </div>
              </div>
            )
          )}

          {/* Order details */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>ORDER DETAILS</SectionTitle>
            {/* v6.99.26 (owner): identity · dates · import documents, one row each */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <Lbl>SO number <span style={{ color: "#16A34A", fontWeight: 500 }}>· system number{!order.id ? ", auto-generated" : ""}</span></Lbl>
                {/* BP-18: controlled document id — display/copy only. */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", border: "1px solid #E5E7EB", borderRadius: 8, background: "#F8FAFC", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, fontWeight: 700, color: "#334155" }}>
                  <span>{order.number || "SO-2026-…"}</span>
                  <button type="button" onClick={() => { try { navigator.clipboard.writeText(order.number || ""); } catch {} }} title="Copy SO number" style={{ marginLeft: "auto", border: "1px solid #E5E7EB", background: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 11, cursor: "pointer", fontWeight: 700, color: "#64748B" }}>Copy</button>
                </div>
              </div>
              <div>
                <Lbl>Client</Lbl>
                <Sel value={order.client?.name || ""} onChange={e => setClient(e.target.value)}>
                  <option value="">— select —</option>
                  {clients.map(c => <option key={c.id} value={c.name}>{c.name} {c.country ? `· ${c.country}` : ""} {c.nip ? `(NIP ${c.nip})` : ""}</option>)}
                </Sel>
              </div>
              <div><Lbl>Status</Lbl>
                {/* v6.77.0 STATUS OWNERSHIP. The sales order owns the COMMERCIAL
                    statuses (Draft, Confirmed, Invoiced, Closed, Cancelled). The
                    PHYSICAL ones — Reserved, Loading, Shipped, Delivered — are
                    the shipments' to state, and are shown here as a derived badge
                    rather than typed. Owner rulings: no partial state, an order
                    ships only when ALL of its goods have moved, and an override
                    is allowed but must say so. */}
                {(() => {
                  const d = deriveSoStatus(order, SHIPMENTS_REF);
                  if (!d.derived && !d.overridden) return null;
                  return <div style={{ marginBottom: 6, padding: "7px 10px", borderRadius: 7, fontSize: 11.5,
                    background: d.overridden ? "#FFFBEB" : "#F0F9FF",
                    border: `1px solid ${d.overridden ? "#FDE68A" : "#BAE6FD"}`,
                    color: d.overridden ? "#92400E" : "#0369A1" }}>
                    <strong>{d.status}</strong>{d.overridden ? " · set by hand" : " · from the shipments"}
                    <div style={{ marginTop: 3, lineHeight: 1.45 }}>{d.reason}</div>
                  </div>;
                })()}
                <Sel value={order.status || "Draft"} onChange={async e => {
                  const nv = e.target.value;
                  // v6.79.0 (W-1): the lock reads the EFFECTIVE status — what the shipments say.
                  const effNow = effectiveSoStatus(order, SHIPMENTS_REF);
                  const wasLocked = ["Shipped", "Delivered", "Invoiced", "Closed"].includes(effNow);
                  const willLock = ["Shipped", "Delivered", "Invoiced", "Closed"].includes(String(nv));
                  // v6.63.0 (D-10, ruling D4): a locked SO moves FORWARD only.
                  // The old dropdown let Shipped→Draft happen silently, with the
                  // shipped kg and postings left orphaned behind the label (M2).
                  const curOrd = soRank(effNow); // v6.79.0 (W-1)
                  const nvOrd = (SO_STATUSES[nv] || {}).order ?? 0;
                  if (wasLocked && nv !== "Cancelled" && nvOrd < curOrd) {
                    await ofAlert({ tone: "warn", title: "Forward only", message: `This sales order is ${order.status} — goods have physically moved, so its status can only advance (or be Cancelled, which reverses the postings). Moving it back to ${nv} would leave shipped kilograms behind a label that denies them.` });
                    return;
                  }
                  // v6.77.0: typing a PHYSICAL status the shipments do not support
                  // is exactly the drift that left six orders Shipped or Invoiced
                  // with no dispatch and a zero COGS. Warned, not blocked — and
                  // proceeding records it as a deliberate override so it never
                  // looks like a derived fact.
                  if (isPhysicalStatus(nv)) {
                    const clash = statusContradiction({ ...order, status: nv, statusOverride: "" }, SHIPMENTS_REF);
                    if (clash) {
                      const go = await ofConfirm({ tone: "warn", title: `Set ${nv} by hand?`,
                        message: `${clash}\n\nSetting it here records an override, so the screen will show it was set by hand rather than taken from the shipments.`,
                        confirmLabel: `Set ${nv} anyway`, cancelLabel: "Go back" });
                      if (!go) return;
                      setOrder((o: any) => ({ ...o, statusOverride: nv, statusOverrideReason: "Set by hand — shipments do not show it yet", statusOverrideAt: localTodayISO() }));
                    }
                  }
                  if (willLock && !wasLocked) {
                    // v6.95.0 (SO-8): the rate becomes a locked fact at confirm, with its date.
                    if (!order.fxLockedAt && String(order.currency || "PLN").toUpperCase() !== "PLN") setOrder((o: any) => lockRate(o, localTodayISO()));
                    // v6.92.0 (A-R8-1, owner ruling R3): no line may be confirmed without a quantity and a price.
                    const empty = (order.items || []).filter((it: any) => String(it.product || "").trim() && !((String(it.pricingUnit || "") === "box" ? (parseFloat(String(it.boxes)) || 0) : (parseFloat(String(it.qty)) || 0)) > 0 && (parseFloat(String(it.unitPrice)) || 0) > 0));
                    if (empty.length) { await ofAlert({ tone: "warn", title: "Quantity and price required", message: `${empty.length} line(s) have no quantity or no price. A sales order cannot be confirmed with an empty line — fill them in first (owner ruling R3).` }); return; }
                    // v6.92.0 (A-R8-2): a foreign-currency order needs a real rate — 1.0 is the PLN default, not a rate.
                    if (String(order.currency || "PLN").toUpperCase() !== "PLN" && Math.abs((parseFloat(String(order.fxRate)) || 0) - 1) < 1e-9) { await ofAlert({ tone: "warn", title: "FX rate missing", message: `The order is in ${order.currency} but its rate to PLN is 1.0. Set the rate before confirming — every amount in the ERP nets in PLN at the document's own locked rate.` }); return; }
                    // v6.89.0 (R2, owner ruling): every sale rests on a purchase — a line without a PO line or a lot cannot be confirmed.
                    const unsourced = (order.items || []).filter((it: any) => String(it.product || "").trim() && !(["PO", "STOCK"].includes(String(it.sourceType || "")) && String(it.sourceRef || "").trim()));
                    if (unsourced.length) { await ofAlert({ tone: "warn", title: "Every sale rests on a purchase", message: `${unsourced.length} line(s) have no source. Pick the PO line or the stock lot each line sells from — a free-typed line cannot be confirmed (owner ruling R2).` }); return; }
                    // v6.68.0 (F-3): credit control at the moment of commitment.
                    const clientRec = (contacts || []).find((c: any) => String(c.name || "").trim().toLowerCase() === String(order.client?.name || "").trim().toLowerCase());
                    const limit = parseFloat(String(clientRec?.creditLimitPLN ?? "")) || 0;
                    if (limit > 0) {
                      const soPLN = (order.items || []).reduce((a: number, it: any) => a + ((String(it.pricingUnit || "") === "box" ? (parseFloat(String(it.boxes)) || 0) : (parseFloat(String(it.qty)) || 0)) * (parseFloat(String(it.unitPrice)) || 0)), 0) * (parseFloat(String(order.fxRate)) || 1);
                      const exposure = clientExposurePLN(order.client?.name, allInvoices || []);
                      if (exposure + soPLN > limit) {
                        const goOn = await ofConfirm({ tone: "danger", title: "Credit limit exceeded", message: `${order.client?.name}: open receivables ${exposure.toLocaleString("pl-PL")} PLN + this order ≈ ${Math.round(soPLN).toLocaleString("pl-PL")} PLN exceed the limit of ${limit.toLocaleString("pl-PL")} PLN.\n\nConfirm the order anyway?`, confirmLabel: "Confirm anyway", cancelLabel: "Hold the order" });
                        if (!goOn) return;
                      }
                    }
                    const ok = await ofConfirm({ tone: "warn", title: `Move to ${nv}?`, message: `Once this sales order is ${nv}, it becomes LOCKED — line items, quantities, sourcing and the shipping address can no longer be changed. To correct something afterwards you'd issue a credit/debit note or a new order.\n\nProceed?`, confirmLabel: `Yes, move to ${nv}`, cancelLabel: "Not yet" });
                    if (!ok) return;
                  }
                  sf("status", nv);
                }} disabled={order.status === "Cancelled"}
                  title={order.status === "Cancelled" ? "This SO is cancelled — read-only and can't be reactivated." : ""}
                  style={{ borderLeft: `4px solid ${(SO_STATUSES[order.status || "Draft"] || {}).color || "#9CA3AF"}`, fontWeight: 700, color: (SO_STATUSES[order.status || "Draft"] || {}).color || "#111" }}>
                  {Object.keys(SO_STATUSES).map(s => {
                    // Draft and Cancelled are always available; everything else requires all lines to be
                    // (a) sourced AND (b) have enough combined available qty to cover the demanded qty.
                    const curOrd2 = (SO_STATUSES[order.status || "Draft"] || {}).order ?? 0;
                    const isBackward = ["Shipped", "Delivered", "Invoiced", "Closed"].includes(String(order.status)) && s !== "Cancelled" && ((SO_STATUSES[s] || {}).order ?? 0) < curOrd2;
                    if (s === "Draft" || s === "Cancelled") return <option key={s} value={s} disabled={s === "Draft" && isBackward}>{s}{s === "Draft" && isBackward ? "  — forward only" : ""}</option>;
                    if (isBackward) return <option key={s} value={s} disabled>{s}  — forward only</option>;
                    const needsSource = !sourcing.allSourced;
                    const needsSupply = overageCount > 0;
                    const needsPOReady = poReadinessIssues.length > 0;
                    const disabled = needsSource || needsSupply || needsPOReady;
                    const reason = needsSource && needsSupply ? "  — needs sourcing + supply"
                      : needsSource ? "  — needs sourcing"
                      : needsSupply ? "  — short on supply"
                      : needsPOReady ? "  — PO not confirmed"
                      : "";
                    return <option key={s} value={s} disabled={disabled}>{s}{reason}</option>;
                  })}
                </Sel>
                {(!sourcing.allSourced || overageCount > 0 || poReadinessIssues.length > 0) && (
                  <div style={{ fontSize: 10, color: "#D97706", marginTop: 3, lineHeight: 1.4 }}>
                    {!sourcing.allSourced && (
                      <div>{sourcing.unsourcedIndexes.length} line{sourcing.unsourcedIndexes.length === 1 ? "" : "s"} unsourced</div>
                    )}
                    {poReadinessIssues.length > 0 && (
                      <div>{poReadinessIssues.length} line{poReadinessIssues.length === 1 ? "" : "s"} sourced from a Draft/Cancelled/missing PO</div>
                    )}
                    {overageCount > 0 && (
                      <div>{overageCount} line{overageCount === 1 ? "" : "s"} short on supply</div>
                    )}
                    <div style={{ marginTop: 2 }}>only Draft / Cancelled available</div>
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
              <div>
                <Lbl>Order date</Lbl>
                <Inp value={order.orderDate} onChange={e => sf("orderDate", e.target.value)} type="date" title="The date the SO was created/agreed with the client" />
              </div>
              <div>
                {/* v6.99.44 (H-10, owner): the day we load at OUR warehouse for this client — the shipment's expected loading reads it */}
                <Lbl>Expected loading date <span style={{ color: "#AAA", fontWeight: 400 }}>· at our warehouse</span></Lbl>
                <Inp type="date" value={order.expectedLoadingDate || ""} onChange={e => sf("expectedLoadingDate", e.target.value)} disabled={fullyLocked} />
              </div>
              <div>
                <Lbl>Expected delivery date</Lbl>
                <Inp value={order.deliveryDate} onChange={e => sf("deliveryDate", e.target.value)} type="date" title="When the goods are expected to reach the agreed point" />
                {/* FB-14: redundant 'means' dropdown removed. */}
              </div>
              <div>
                <Lbl>Actual delivery</Lbl>
                {/* BP-17: not typed here — comes from the linked Shipment delivery event
                    (or the dispatch/collection event for EXW). Read-only. */}
                <div style={{ padding: "9px 11px", border: "1px dashed #E5E7EB", borderRadius: 8, background: "#FAFAFA", fontSize: 12.5, color: order.actualDeliveryDate ? "#334155" : "#9CA3AF" }}>
                  {order.actualDeliveryDate ? `${order.actualDeliveryDate} · from shipment` : ((order.linkedShipments?.length || 0) ? "Pending shipment delivery" : "No linked shipment")}
                </div>
                <div style={{ fontSize: 10, color: "#AAA", marginTop: 3, lineHeight: 1.4 }}>{order.status === "Delivered" ? "Fill in the date goods reached the client" : "Set status to Delivered to enable"}</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <Lbl>Import permit no. <span style={{ color: "#AAA", fontWeight: 400 }}>· client-country import licence</span></Lbl>
                <Inp value={order.importPermitNo === "N/A" ? "" : (order.importPermitNo || "")} onChange={e => sf("importPermitNo", e.target.value)} placeholder={order.importPermitNo === "N/A" ? "Not applicable" : "e.g. IP-2026-00871"} disabled={order.importPermitNo === "N/A"} />
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#666", marginTop: 4, cursor: "pointer" }}>
                  <input type="checkbox" checked={order.importPermitNo === "N/A"} onChange={e => sf("importPermitNo", e.target.checked ? "N/A" : "")} /> Not applicable
                </label>
                {permitDupes.importPermitNo && (
                  <div style={{ fontSize: 10, color: "#DC2626", marginTop: 3, fontWeight: 600 }}>⚠ Already used on {permitDupes.importPermitNo}</div>
                )}
              </div>
              <div>
                <Lbl>ACID no. <span style={{ color: "#AAA", fontWeight: 400 }}>· Egypt Advance Cargo Information Declaration</span></Lbl>
                <Inp value={order.acidNo === "N/A" ? "" : (order.acidNo || "")} onChange={e => sf("acidNo", e.target.value)} placeholder={order.acidNo === "N/A" ? "Not applicable" : "19-digit ACID"} disabled={order.acidNo === "N/A"} />
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#666", marginTop: 4, cursor: "pointer" }}>
                  <input type="checkbox" checked={order.acidNo === "N/A"} onChange={e => sf("acidNo", e.target.checked ? "N/A" : "")} /> Not applicable
                </label>
                {permitDupes.acidNo && (
                  <div style={{ fontSize: 10, color: "#DC2626", marginTop: 3, fontWeight: 600 }}>⚠ Already used on {permitDupes.acidNo}</div>
                )}
              </div>
            </div>
              {/* v6.99.27: duplicated Status / import-permit / ACID blocks removed — the reorder in v6.99.26 left a second copy */}
          </Card>

          {/* Incoterm + destination */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>INCOTERM · DELIVERY</SectionTitle>
            {/* v6.99.27 (owner): the sale's terms panel wears the same colours as the purchase terms on the PO */}
            <div style={{ border: "1px solid #E0E7FF", background: "#F5F7FF", borderRadius: 10, padding: "12px 14px", display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14 }}>
              <div>
                <Lbl>Sell Incoterm</Lbl>
                <Sel value={order.sellIncoterm || ""} onChange={e => sf("sellIncoterm", e.target.value)} disabled={isLocked}>
                  <option value="">— select —</option>
                  {INCOTERMS_SELL.map(i => <option key={i.code} value={i.code}>{i.code}</option>)}
                </Sel>
                {order.sellIncoterm && (
                  <div style={{ fontSize: 10.5, color: "#888", marginTop: 4, lineHeight: 1.4 }}>
                    {INCOTERMS_SELL.find(i => i.code === order.sellIncoterm)?.label}
                  </div>
                )}
              </div>
              <div>
                <Lbl>Destination <span style={{ color: "#BBB", fontWeight: 400 }}>· follows sell incoterm</span></Lbl>
                <div style={{ fontSize: 10.5, color: order.sellIncoterm ? "#2563EB" : "#888", margin: "2px 0 6px", lineHeight: 1.4 }}>{incotermDestinationHint}</div>
                {(() => {
                  // FB-11: the destination options adapt to the sell incoterm — the term decides
                  // where WE deliver, so we surface the right place type first.
                  const ic = String(order.sellIncoterm || "").toUpperCase();
                  const portLed = ["CIF", "CFR", "FOB", "FCA"].includes(ic);
                  const clientLed = ["DAP", "DDP"].includes(ic);
                  const whLed = ic === "EXW";
                  return (
                <Sel value={destMode} onChange={e => setDestMode(e.target.value)}>
                  <option value="client">Client's registered address{clientLed ? " (recommended)" : ""}</option>
                  <option value="other">{portLed ? "Port / named place (recommended)" : whLed ? "Our warehouse (EXW pickup)" : "Other address (specify below)"}</option>
                </Sel>
                  );
                })()}
                {destMode === "client" ? (
                  <div style={{ marginTop: 8, padding: "9px 11px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#FAFAFA", fontSize: 12, color: "#444", lineHeight: 1.45 }}>
                    {order.client ? (
                      order.client.address
                        ? <><strong>{order.client.name}</strong><div style={{ color: "#666", marginTop: 2 }}>{order.client.address}{order.client.country ? `, ${order.client.country}` : ""}</div></>
                        : <span style={{ color: "#B45309" }}>This client has no address on file — add one in Counterparties, or choose “Other address”.</span>
                    ) : (
                      <span style={{ color: "#888" }}>Select the client above — the delivery destination defaults to their registered address.</span>
                    )}
                  </div>
                ) : (
                  <>
                    <LocationPicker value={order.destinationLocationId ?? order.destinationText ?? ""} contacts={contacts} disabled={fullyLocked} placeholder="— destination (client site, port, warehouse) —" onChange={(r: any) => setOrder((o: any) => ({ ...o, destinationLocationId: r.id, destinationText: r.name }))} title="v6.99.10: one location list for every destination" style={{ marginTop: 6 }} />
                    <div style={{ fontSize: 10.5, color: "#888", marginTop: 4, lineHeight: 1.4 }}>
                      Pick the destination from the Directory (relay, port, or client site as the Incoterm requires). Free text takes precedence on the printed SO.
                    </div>
                  </>
                )}
              </div>
            </div>
          </Card>

          {/* Currency */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>PAYMENT · CURRENCY{isLocked && <span style={{ marginLeft: 8, fontSize: 10, color: "#D97706", fontWeight: 600 }}>🔒 locked at {order.status}</span>}</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.8fr 1fr", gap: 14, alignItems: "start" }}>   {/* v6.99.26 (owner): payment terms · currency · FX rate */}
              <div>
                <Lbl>Payment terms</Lbl>
                <div style={{ display: "grid", gridTemplateColumns: paymentBasisOf(order) === "INVOICE" ? "90px 1fr" : "1fr", gap: 8 }}>
                  {paymentBasisOf(order) === "INVOICE" && <Inp disabled={isLocked} type="number" value={order.paymentDays ?? ""} onChange={e => sf("paymentDays", parseFloat(e.target.value) || 0)} placeholder="days" title="v6.99.23: days from the invoice issue date (owner ruling); the sales invoice's due date derives from this" />}
                  <Sel disabled={isLocked} value={paymentBasisOf(order)} onChange={e => sf("paymentBasis", e.target.value)}>
                    {PAYMENT_BASES.map((b: any) => <option key={b.value} value={b.value}>{b.value === "INVOICE" ? "days from invoice date" : b.label}</option>)}
                  </Sel>
                </div>
              </div>
              <div><Lbl>Currency</Lbl>
                <Sel value={order.currency} onChange={e => { const cur = e.target.value; setOrder((o: any) => ({ ...o, currency: cur, fxRate: cur === "PLN" ? 1 : ((parseFloat(String(o.fxRate)) || 1) !== 1 ? o.fxRate : defaultFxRate(cur)) })); }} disabled={isLocked}>
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </Sel>
              </div>
              <div><Lbl>FX rate to PLN</Lbl>
                <Inp value={order.fxRate ?? ""} onChange={e => sf("fxRate", e.target.value)} type="number" disabled={isLocked} />
                {order.fxLockedAt && <div style={{ fontSize: 10, color: "#888", marginTop: 3 }}>Locked {order.fxLockedAt}</div>}
              </div>
            </div>
          </Card>

          {/* Delivery date warnings */}
          {deliveryWarnings.length > 0 && (
            <div style={{ padding: "10px 14px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#92400E", marginBottom: 4 }}>⚠ Delivery date is before PO arrival</div>
              {deliveryWarnings.map(w => (
                <div key={w.idx} style={{ fontSize: 11, color: "#92400E" }}>
                  Line {w.idx + 1} ({w.lineProduct}) is sourced from {w.poRef} which arrives <strong>{w.poETA}</strong>, but SO delivery is set to <strong>{order.deliveryDate}</strong>. Consider pushing SO delivery later.
                </div>
              ))}
            </div>
          )}

          {hasDuplicateSources && (
            <div style={{ padding: "10px 14px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#92400E", marginBottom: 4 }}>⚠ Same source assigned to more than one line</div>
              {Object.values(dupSourceGroups).map((g: any, gi) => (
                <div key={gi} style={{ fontSize: 11, color: "#92400E" }}>
                  Lines {g.indices.map((x: number) => x + 1).join(", ")} all draw from <strong>{g.sourceRef}</strong>{g.sourceType === "PO" ? ` (line ${g.sourceLineId})` : ""} — combined <strong>{fmtNum(g.totalQty)} kg</strong>. If this is one physical product, you may be assigning it twice; merge the lines or pick a different source.
                </div>
              ))}
            </div>
          )}

          {fullyLocked && (
            <div style={{ margin: "0 0 12px", padding: "10px 14px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 12, color: "#991B1B", lineHeight: 1.5 }}>
              🔒 <strong>This sales order is locked.</strong> Once an SO reaches <strong>{order.status}</strong>, its line items, quantities, sourcing and shipping address can no longer be changed — the goods are on their way and the commercial deal is fixed. To correct something, issue a credit/debit note or a new order.
            </div>
          )}
          {/* Line items */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle right={<div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => { const idx = order.items.length; addItem(); setTimeout(() => setSourceFor(idx), 0); }} style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: "#0369A1", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }} title="Add a line sourced from a PO or stock — product, variety, packaging, origin, size and quality are copied automatically; you set only price, quantity and pallets.">+ Add from PO / stock</button>
              <button onClick={addItem} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #16A34A", background: "#fff", color: "#16A34A", fontSize: 11, fontWeight: 600, cursor: "pointer" }} title="Add an empty line to fill in manually">+ Blank line</button>
            </div>}>LINE ITEMS ({order.items.length}){fullyLocked && <span style={{ marginLeft: 8, fontSize: 10, color: "#DC2626", fontWeight: 700 }}>🔒 locked ({order.status})</span>}</SectionTitle>
            <datalist id="so-product-suggestions">
              {productSuggestions.map(p => <option key={p} value={p} />)}
            </datalist>
            {order.items.map((it, i) => {
              const lineTotal = lineTotalPU(it, PACKAGING_TYPES_REF);
              const lineNeedsSource = !it.sourceType || !it.sourceRef;
              const lineIsBlocking = lineNeedsSource && nonDraftStatuses.includes(order.status);
              const avail = availability[i] || {};
              const showAvail = it.sourceType && it.sourceRef && avail.lineQty > 0;
              const lineOverageBlocks = avail.hasOverage && nonDraftStatuses.includes(order.status);
              // v6.99.22 (G-4/G-5, owner approval): sorting turned part of the lot into class II — the line promises a class we no longer have.
              const gradeShort = avail.grade && avail.gradeShort > 0.5 ? avail.gradeShort : 0;
              const canAdjust = gradeShort > 0 && !soFullyLocked(order.status, order) && !["Shipped", "Delivered", "Invoiced", "Closed"].includes(String(effectiveSoStatus(order, SHIPMENTS_REF || [])));
              return (
                <div key={i} style={{
                  marginBottom: 12, padding: 12, borderRadius: 8,
                  background: lineIsBlocking || lineOverageBlocks ? "#FEF2F2" : (avail.hasOverage ? "#FFFBEB" : "#FAFAFA"),
                  border: lineIsBlocking || lineOverageBlocks ? "1px solid #FCA5A5" : (avail.hasOverage ? "1px solid #FCD34D" : "1px solid #F3F4F6")
                }}>
                  {/* Source bar */}
                  {gradeShort > 0 && (
                    <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 7, padding: "7px 10px", marginBottom: 8, fontSize: 11.5, color: "#92400E" }}>
                      <b>Class {avail.grade}: only {Number(avail.primaryAvailable || 0).toLocaleString("pl-PL")} kg available</b> of the {Number(avail.lineQty || 0).toLocaleString("pl-PL")} kg on this line — short {gradeShort.toLocaleString("pl-PL")} kg. Sorting moved part of {it.sourceRef} to another class.
                      {canAdjust ? (
                        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                          <button type="button" onClick={() => { const keep = Math.max(0, Math.round(Number(avail.primaryAvailable) || 0)); const rest = Math.round((Number(avail.lineQty) || 0) - keep); setOrder((o: any) => { const items = [...o.items]; items[i] = { ...items[i], qty: keep }; items.splice(i + 1, 0, { ...items[i], id: nextId(), qty: rest, grade: String(items[i].grade || "I").toUpperCase() === "II" ? "I" : "II", unitPrice: "" }); return { ...o, items }; }); }} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid #7C3AED", background: "#fff", color: "#7C3AED", fontWeight: 700, cursor: "pointer" }} title="Split: keep what this class has, sell the rest as the other class — same lot, one delivery; the price is negotiated per class, so type it">Split by grade</button>
                          <button type="button" onClick={() => { const keep = Math.max(0, Math.round(Number(avail.primaryAvailable) || 0)); setOrder((o: any) => { const items = [...o.items]; items[i] = { ...items[i], qty: keep }; items.splice(i + 1, 0, { ...items[i], id: nextId(), qty: Math.round((Number(avail.lineQty) || 0) - keep), sourceType: "", sourceRef: "", sourceLineId: null }); return { ...o, items }; }); }} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid #0E7490", background: "#fff", color: "#0E7490", fontWeight: 700, cursor: "pointer" }} title="Keep this class and source the shortfall from another lot or PO — the new line waits for its source">Source the rest elsewhere</button>
                          <button type="button" onClick={() => { const keep = Math.max(0, Math.round(Number(avail.primaryAvailable) || 0)); setOrder((o: any) => { const items = [...o.items]; items[i] = { ...items[i], qty: keep }; return { ...o, items }; }); }} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid #B45309", background: "#fff", color: "#B45309", fontWeight: 700, cursor: "pointer" }} title="Deliver what this class holds; the rest stays in stock for another sale">Short-deliver</button>
                        </div>
                      ) : (
                        <div style={{ marginTop: 6, fontWeight: 600 }}>The goods have already been loaded or invoiced — history is not edited. Raise a <b>client claim</b> from this order for the grade difference; the credit note nets into the sale and the producer settlement (owner rule G-5).</div>
                      )}
                    </div>
                  )}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: "6px 10px", borderRadius: 6,
                    background: it.sourceType
                      ? (it.sourceType === "STOCK" ? "#E0F2FE" : "#FCE7F3")
                      : (lineIsBlocking ? "#FEE2E2" : "#FEF3C7")
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: lineIsBlocking ? "#991B1B" : "#444" }}>
                      {lineIsBlocking ? "⚠ Source required:" : "Source:"}
                    </span>
                    <SourceBadge sourceType={it.sourceType} sourceRef={it.sourceRef} supplierName={it.sourceType === "PO" ? supplierNameForPO(it.sourceRef) : ""} />
                    <button onClick={() => setSourceFor(i)} style={{
                      padding: "3px 10px", borderRadius: 5,
                      border: lineIsBlocking ? "1px solid #991B1B" : "1px solid #E5E7EB",
                      background: lineIsBlocking ? "#991B1B" : "#fff",
                      color: lineIsBlocking ? "#fff" : "#111",
                      fontSize: 11, fontWeight: 600, cursor: "pointer"
                    }}>
                      {it.sourceType ? "Change source" : "Pick source →"}
                    </button>
                    {it.sourceType && (
                      <button onClick={() => clearSource(i)} title="Remove the source link from this line" style={{ padding: "3px 10px", borderRadius: 5, border: "1px solid #FECACA", background: "#FEF2F2", color: "#DC2626", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✕ Clear source</button>
                    )}
                    <div style={{ marginLeft: "auto", fontSize: 10.5, color: lineIsBlocking ? "#991B1B" : "#777" }}>
                      {lineIsBlocking
                        ? `Required to save as ${order.status}`
                        : (!it.sourceType && "Pick a stock lot or PO this line will draw from")}
                    </div>
                  </div>

                  {/* Product mismatch warning — fires if the picked source's product
                      doesn't match this line's product (user picked the wrong lot/PO) */}
                  {avail.primaryProductMismatch && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: "6px 10px", borderRadius: 6,
                      background: "#FEE2E2", border: "1px solid #FCA5A5", fontSize: 11,
                    }}>
                      <span style={{ fontWeight: 700, color: "#991B1B" }}>⚠ Product mismatch:</span>
                      <span style={{ color: "#991B1B" }}>
                        This line is <strong>{it.product || "(no product)"}</strong> but the picked source ({it.sourceRef}) is a different product. Pick a source whose product matches.
                      </span>
                    </div>
                  )}

                  {/* Duplicate-source warning — fires if another line in THIS SAME order
                      already draws from this exact source (same PO line or same lot). */}
                  {dupLineIndex[i] && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: "6px 10px", borderRadius: 6,
                      background: "#FEF3C7", border: "1px solid #FCD34D", fontSize: 11,
                    }}>
                      <span style={{ fontWeight: 700, color: "#92400E" }}>⚠ Same source used twice:</span>
                      <span style={{ color: "#92400E" }}>
                        {dupLineIndex[i].count} lines in this order draw from <strong>{dupLineIndex[i].sourceRef}</strong>{dupLineIndex[i].sourceType === "PO" ? ` (line ${dupLineIndex[i].sourceLineId})` : ""} — combined {fmtNum(dupLineIndex[i].totalQty)} kg. If this is one physical product, you may be assigning it twice. Merge the lines or pick a different source.
                      </span>
                    </div>
                  )}

                  {/* Availability strip — shows when the line is sourced and has a qty */}
                  {showAvail && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 12, marginBottom: 10, padding: "6px 10px", borderRadius: 6,
                      background: lineOverageBlocks ? "#FEE2E2" : (avail.hasOverage ? "#FEF3C7" : "#F9FAFB"),
                      border: lineOverageBlocks ? "1px solid #FCA5A5" : (avail.hasOverage ? "1px solid #FCD34D" : "1px solid #F3F4F6"),
                      fontSize: 11,
                    }}>
                      <span style={{ fontWeight: 700, color: lineOverageBlocks ? "#991B1B" : (avail.hasOverage ? "#92400E" : "#555") }}>
                        {lineOverageBlocks ? "🚫 Insufficient supply:" : avail.hasOverage ? "⚠ Availability:" : "Availability:"}
                      </span>
                      <span style={{ color: "#444" }}>
                        Demand <strong>{fmtNum(avail.lineQty)} kg</strong>
                      </span>
                      <span style={{ color: "#AAA" }}>·</span>
                      <span style={{ color: "#444" }}>
                        On {it.sourceType === "STOCK" ? "lot" : "PO line"} <strong>{fmtNum(avail.primaryAvailable)} kg</strong>
                      </span>
                      {avail.otherSourcesAvailable > 0 && (
                        <>
                          <span style={{ color: "#AAA" }}>+</span>
                          <span style={{ color: "#444" }}>
                            Other sources <strong>{fmtNum(avail.otherSourcesAvailable)} kg</strong>
                            <span style={{ color: "#888", fontSize: 10 }}>
                              {avail.otherStockKg > 0 && ` (📦 ${fmtNum(avail.otherStockKg)}`}
                              {avail.otherStockKg > 0 && avail.otherPOKg > 0 && ` + `}
                              {avail.otherPOKg > 0 && `🚚 ${fmtNum(avail.otherPOKg)}`}
                              {(avail.otherStockKg > 0 || avail.otherPOKg > 0) && `)`}
                            </span>
                          </span>
                        </>
                      )}
                      <span style={{ color: "#AAA" }}>=</span>
                      <span style={{ color: lineOverageBlocks ? "#991B1B" : (avail.hasOverage ? "#92400E" : "#16A34A"), fontWeight: 600 }}>
                        Combined <strong>{fmtNum(avail.combinedAvailable)} kg</strong>
                      </span>
                      {avail.hasOverage && (
                        <span style={{ marginLeft: "auto", fontWeight: 700, color: lineOverageBlocks ? "#991B1B" : "#92400E" }}>
                          {lineOverageBlocks ? `Blocks ${order.status} — short by ${fmtNum(avail.overage)} kg` : `Short by ${fmtNum(avail.overage)} kg`}
                        </span>
                      )}
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(190px, 1.9fr) 1fr 0.6fr 0.7fr 1fr 0.9fr minmax(140px, 1.6fr)", gap: 8, alignItems: "end" }}>   {/* v6.99.27 (owner): item · origin · size · class · qty · priced per · sell price */}
                    <div>
                      <Lbl>Item / Variety {it.sourceType && it.sourceRef ? <span style={{ color: "#2563EB", fontWeight: 400 }}>· from {it.sourceType === "PO" ? "PO" : "stock"}</span> : null}</Lbl>
                      {it.sourceType && it.sourceRef
                        ? <div style={{ border: "1px solid #E5E7EB", borderRadius: 6, padding: "7px 9px", fontSize: 12.5, background: "#F9FAFB", color: "#374151", minHeight: 18 }} title="Inherited from the linked source — clear the source link to change the product">{it.product || "—"}{it.variety ? ` — ${it.variety}` : ""}</div>
                        : <ItemVarietyPicker catalog={productCatalog} setCatalog={setProductCatalog} item={it.product || ""} variety={it.variety || ""} onItem={(v: string) => si(i, "product", v)} onVariety={(v: string) => si(i, "variety", v)} />}
                    </div>
                    <div><Lbl>Origin{it.sourceType && it.sourceRef ? <span style={{ color: "#2563EB", fontWeight: 400 }}> · from {it.sourceType === "PO" ? "PO" : "stock"}</span> : null}</Lbl><Sel value={it.origin || ""} onChange={e => si(i, "origin", e.target.value)} disabled={fullyLocked || !!(it.sourceType && it.sourceRef)} title="v6.99.26 (owner): country of origin — the list is the Directory's Countries tab"><option value="">— country —</option>{readCountries().map((c: any) => <option key={c.iso} value={c.name}>{c.name}</option>)}{it.origin && !readCountries().some((c: any) => c.name === it.origin) && <option value={it.origin}>{it.origin}</option>}</Sel></div>
                    <div><Lbl>Size{it.sourceType && it.sourceRef ? <span style={{ color: "#2563EB", fontWeight: 400 }}> · from {it.sourceType === "PO" ? "PO" : "stock"}</span> : null}</Lbl><Inp value={it.size} onChange={e => si(i, "size", e.target.value)} placeholder="70-80" disabled={fullyLocked || !!(it.sourceType && it.sourceRef)} /></div>
                    <div><Lbl>Class{it.sourceType && it.sourceRef ? <span style={{ color: "#2563EB", fontWeight: 400 }}> · from {it.sourceType === "PO" ? "PO" : "stock"}</span> : null}</Lbl><Sel value={it.grade || it.quality || "I"} disabled={fullyLocked || !!(it.sourceType && it.sourceRef)} title="v6.99.27 (one source): the class sold — the same fact the sorting produces. Availability is checked against this class in the source lot." onChange={e => { const v = e.target.value; si(i, "grade", v); si(i, "quality", v); }}>{QUALITY_GRADES.map(q => <option key={q}>{q}</option>)}</Sel></div>
                    {/* v6.99.35 (P0): the quantity follows the pricing unit. My v6.99.26 reorder kept only the BOXES branch,
                        so a line priced per kg had no kilo field at all — the order could not be completed. */}
                    {pricingUnitOf(it) === "box" ? (
                      <div><Lbl>Qty (boxes)</Lbl><Inp type="number" value={it.boxes ?? ""} onChange={e => {
                        const b = Math.round(parseFloat(e.target.value) || 0);
                        const kgPerBox = kgPerBoxForLine(it, PACKAGING_TYPES_REF);
                        setOrder(o => ({ ...o, items: o.items.map((x, ix) => ix === i ? { ...x, boxes: Math.max(0, Math.round(parseNum(b))), qty: kgPerBox > 0 ? Math.round(Math.max(0, Math.round(parseNum(b))) * kgPerBox * 1000) / 1000 : x.qty } : x) }));
                      }} placeholder="e.g. 400" disabled={fullyLocked} /></div>
                    ) : (
                      <div><Lbl>Qty (kg)</Lbl><Inp type="number" value={it.qty} onChange={e => si(i, "qty", e.target.value)} placeholder="e.g. 8000" disabled={fullyLocked} /></div>
                    )}
                    <div><Lbl>Priced per</Lbl><Sel value={pricingUnitOf(it)} disabled={fullyLocked}
                      onChange={e => setOrder(o => ({ ...o, items: o.items.map((x, ix) => ix === i ? convertLineUnit(x, e.target.value, PACKAGING_TYPES_REF) : x) }))}>
                      <option value="kg">kg</option>
                      <option value="box">box</option>
                    </Sel></div>
                    <div><Lbl>Sell price {pricingUnitOf(it) === "box" ? "/ box" : "/ kg"}{it.priceToAgree && !(parseFloat(it.unitPrice) > 0) ? <span style={{ color: "#DC2626", fontWeight: 800 }}> · price to agree</span> : null}</Lbl><Inp type="number" value={it.unitPrice ?? ""} style={it.priceToAgree && !(parseFloat(it.unitPrice) > 0) ? { borderColor: "#DC2626", background: "#FEF2F2" } : undefined} onChange={e => si(i, "unitPrice", e.target.value)} placeholder={pricingUnitOf(it) === "box" ? "e.g. 36.40" : "e.g. 2.80"} disabled={isLocked} /></div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 0.8fr 0.8fr 1fr 1.1fr 38px", gap: 8, alignItems: "end", marginTop: 8 }}>
                    <div><Lbl>Coloration</Lbl><Inp value={it.coloration ?? ""} onChange={e => si(i, "coloration", e.target.value)} disabled={fullyLocked} placeholder="from the PO line" title="v6.99.26 (owner): copied from the purchase line when the source is picked; editable" /></div>
                    <div>
                      <Lbl>Packaging</Lbl>
                      <Inp value={it.packaging} onChange={e => { const v = e.target.value; const pk = (PACKAGING_TYPES_REF || []).find((p: any) => String(p.label).toLowerCase() === String(v).toLowerCase()); si(i, "packaging", v); si(i, "packagingId", pk ? pk.id : null); }} placeholder="pick a packaging type, or type it" list="so-packaging-types" title="v6.88.0: pick from Settings → Packaging types so gross weight, pallet table and kg/box derive exactly" />
                      <datalist id="so-packaging-types">{(PACKAGING_TYPES_REF || []).map((p: any) => <option key={p.id} value={p.label} />)}</datalist>
                    </div>
                    {/* v6.99.46 (A-PO-11, owner): the same rule as the PO — counts from the line's packaging, manual override marked and reversible */}
                    {(() => { const ec = effectiveCounts(it, PACKAGING_TYPES_REF || []); const isBoxUnit = pricingUnitOf(it) !== "kg"; return <>
                    <div><Lbl>Boxes{isBoxUnit ? "" : (ec.boxesManual ? <span style={{ color: "#B45309" }}> (manual) <button onClick={() => si(i, "boxesManual", null)} title="back to the derived figure" style={{ border: "none", background: "none", cursor: "pointer", color: "#2563EB", fontSize: 11, padding: 0 }}>↺</button></span> : (ec.derived.hasPackaging ? " (derived)" : ""))}</Lbl>
                      {isBoxUnit
                        ? <Inp type="number" value={it.boxes ?? ""} onChange={e => si(i, "boxes", e.target.value)} disabled={fullyLocked} />
                        : <Inp type="number" value={ec.boxes ?? ""} onChange={e => si(i, "boxesManual", e.target.value)} disabled={fullyLocked} placeholder={ec.derived.hasPackaging ? "" : "choose a packaging"} title={ec.derived.hasPackaging ? `${ec.derived.kgPerBox} kg per box` : "the packaging decides the box count — pick it first"} style={ec.boxesManual ? { borderColor: "#F59E0B" } : {}} />}
                    </div>
                    <div><Lbl>Pallets{ec.palletsManual ? <span style={{ color: "#B45309" }}> (manual) <button onClick={() => si(i, "palletsManual", null)} title="back to the derived figure" style={{ border: "none", background: "none", cursor: "pointer", color: "#2563EB", fontSize: 11, padding: 0 }}>↺</button></span> : (ec.derived.pallets != null ? " (derived)" : "")}</Lbl>
                      <Inp type="number" value={ec.pallets ?? ""} onChange={e => si(i, "palletsManual", e.target.value)} disabled={fullyLocked} placeholder={ec.derived.boxesPerPallet > 0 ? "e.g. 12" : (ec.derived.hasPackaging ? "boxes per pallet not set" : "choose a packaging")} title={ec.derived.boxesPerPallet > 0 ? `${ec.derived.boxesPerPallet} boxes per pallet` : ""} style={ec.palletsManual ? { borderColor: "#F59E0B" } : {}} />
                    </div>
                    </>; })()}
                    <div><Lbl>CN / HS code</Lbl><Inp value={it.cnCode || ""} onChange={e => si(i, "cnCode", e.target.value)} placeholder="e.g. 08081080" title="Customs nomenclature code — printed on the SO and used on the Fakturownia invoice. Inherited from the PO when the line is sourced from one." disabled={!!(it.sourceType && it.sourceRef)} /></div>
                    <div style={{ minWidth: 96 }}><Lbl>Line total</Lbl><div style={{ padding: "8px 2px", fontSize: 12, fontWeight: 700, color: "#111", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }} title={lineTotal.toLocaleString("pl-PL", { minimumFractionDigits: 2 })}>{lineTotal.toLocaleString("pl-PL", { minimumFractionDigits: 2 })}</div></div>
                    <button onClick={() => removeItem(i)} disabled={order.items.length <= 1} style={{ height: 33, padding: "0 6px", border: "1px solid #FECACA", borderRadius: 6, background: "#fff", color: "#DC2626", fontSize: 11, cursor: order.items.length <= 1 ? "not-allowed" : "pointer", opacity: order.items.length <= 1 ? 0.4 : 1 }}>🗑</button>
                  </div>
                </div>
              );
            })}
            <div style={{ marginTop: 14, padding: 14, background: "#F9FAFB", borderRadius: 8, display: "flex", justifyContent: "flex-end", gap: 24 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: "#888" }}>NET TOTAL</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtMoney(netTotal(order.items), order.currency)}</div>
              </div>
            </div>
            <div style={{ marginTop: 12, padding: "6px 10px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 7, fontSize: 12, fontWeight: 700, color: "#166534" }} title="v6.99.6 (A-R9-2): totals of the lines — check before Confirm">Σ {totalsLine(documentTotals(order.items, PACKAGING_TYPES_REF, order.fxRate), order.currency)}</div>
          </Card>

          {/* Notes */}
          <Card>
            <SectionTitle>NOTES</SectionTitle>
            <textarea value={order.notes || ""} onChange={e => sf("notes", e.target.value)} rows={3} style={{ width: "100%", border: "1.5px solid #F59E0B", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", outline: "none", background: "#fff", resize: "vertical" }} placeholder="Special instructions, pallet labels, etc." />
          </Card>
        </div>
      </div>
    </div>
  );
}
