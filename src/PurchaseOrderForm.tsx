// PurchaseOrderForm.tsx — v6.99.68 (A-AUD-2, owner): moved out of PurchaseOrders.tsx unchanged; the module's shared helpers are imported from it.
import React from "react";
import LocationPicker from "./LocationPicker";
import { Card, Lbl, SectionTitle, useConfirm} from "./ui";
import { FX_RATES } from "./fx";
import { ItemVarietyPicker } from "./ProductPicker";
import { PAGE_MAX } from "./ui";
import { cnCodeForItem } from "./productCatalog";
import { derivePOLineQuantities, paymentDaysFor, paymentBasisOf, paymentTermsLabel, PAYMENT_BASES, copyPOLine } from "./po.domain";
import { documentTotals, totalsLine, effectiveCounts } from "./pricingUnit.domain";
import { handoverPointForIncoterm, namedPlacePoolForIncoterm, handoverSentence } from "./tradeFlow.domain";
import { isEstimatedLine } from "./so.domain";
import { localTodayISO } from "./dates";
import { nextId } from "./ids";
import { poTermsMissing, poWarnings } from "./purchaseOrderGuards";
import { readCountries } from "./Contacts";
import { recordAudit } from "./audit";
import { warehouseAddressLocations, unifiedLocations, locationById, counterpartyLocations } from "./locations";
import { CONTACTS_REF, CURRENCIES, FlowBadge, INCOTERMS_BUY, Inp, PO_PACKAGING_TYPES, PO_STATUSES, QUALITY_GRADES, SUPPLIERS, Sel, StatusBadge, fmtMoney, fmtNum, netTotal, totalQtyKg } from "./PurchaseOrders";

// Batch 6b hard gate: a PO leaving Draft — or being printed/emailed to the
// producer — must carry its purchase terms. "CIF" without "CIF Alexandria" is
// only half the contract, so the incoterm and its named place gate together.
export function OrderForm({ order, setOrder, productSuggestions = [], suppliers = SUPPLIERS, contacts = [], allSOs = [], allShipments = [], lots = [], productCatalog = [], setProductCatalog, onSave, onCancel, onPrint, onEmail }: any) {
  const { alert: ofAlert, dialogNode: ofPONode } = useConfirm(); // P2-6 completion
  const sf = (k, v) => setOrder(o => ({ ...o, [k]: v }));
  const si = (idx, k, v) => setOrder(o => { const it = [...o.items]; it[idx] = { ...it[idx], [k]: v };
    // v6.94.0 (PO-1, owner ruling): base is kg; boxes allowed as the ordered unit — type one, the other derives from the packaging type.
    if (["qty", "boxes", "pricingUnit", "packaging", "packagingId"].includes(k)) it[idx] = derivePOLineQuantities(it[idx], PO_PACKAGING_TYPES, k === "qty" ? "qty" : k === "boxes" ? "boxes" : k === "pricingUnit" ? "unit" : "packaging");
    return { ...o, items: it }; });
  // v6.10 (#9): goods can't be Shipped (or beyond) before they are loaded at origin.
  const SHIP_OR_LATER = ["Shipped", "Arrived", "Closed"];

  // v6.18.5 (P0-5) + v6.18.14 (#3): once anything downstream depends on this PO — a
  // linked SO line, a non-cancelled shipment, or a lot that's been received/moved — the
  // PO is the base of the structure and is FULLY locked: no field edits and no status
  // change at all (including revert-to-Draft and Cancel). It can only be removed by
  // unlinking every downstream document first, then deleting.
  const poNum = order.number;
  // v6.81.0 (D-54): a DRAFT sale is an intention, not a dependency — it must not lock the PO it draws from (Draft↔Draft deadlock, PO-2026-0031).
  const hasLinkedSO = (allSOs || []).some((so: any) => so.status !== "Cancelled" && so.status !== "Draft" && (so.items || []).some((it: any) => it.sourceType === "PO" && it.sourceRef === poNum));
  const hasShipment = (allShipments || []).some((sh: any) => (sh.poRefs || []).includes(poNum) && sh.status !== "Cancelled");
  // v6.35.0: a lot whose linked shipments are ALL cancelled must not keep the PO locked —
  // otherwise cancelling everything to fix the PO leaves it permanently trapped. We treat a
  // lot as "really received/moved" only if it has a non-cancelled shipment, OR it carries
  // manual movements that are not shipment-driven receipts.
  const shipmentsForLot = (lotNo: string) => (allShipments || []).filter((sh: any) =>
    (sh.lotRefs || []).map(String).includes(String(lotNo)) ||
    (sh.goods || []).some((g: any) => String(g.lotRef) === String(lotNo)));
  const lotReceivedOrMoved = (lots || []).some((l: any) => {
    if (l.poRef !== poNum) return false;
    // v6.76.0: VOIDED movements must not lock the PO. Record a receipt on a
    // direct-DDP lot, then void it because it was wrong, and `movements.length`
    // still counted it — so a Confirmed PO with no sales order and no live
    // movement could never return to Draft. Nothing is deleted in this system,
    // so "there is history here" is never the same question as "something
    // depends on this". Only LIVE movements and real kilos lock it.
    const liveMoves = (l.movements || []).filter((m: any) => m && !m.voided);
    const received = (parseFloat(l.receivedKg) > 0) || (parseFloat(l.physicalKg) > 0) || liveMoves.length > 0;
    if (!received) return false;
    // If this lot has any linked shipment, only a NON-cancelled one keeps it "live".
    const shs = shipmentsForLot(l.number);
    if (shs.length > 0) return shs.some((sh: any) => sh.status !== "Cancelled");
    // No shipments at all: a lot with real received kg / movements is a genuine manual receipt → still locks.
    return received;
  });
  const hasDependents = hasLinkedSO || hasShipment || lotReceivedOrMoved;
  const terminalStatus = ["Arrived", "Shipped", "Closed", "Cancelled", "Invoiced"].includes(order.status);
  const isLocked = !!order.id && (hasDependents || (order.status !== "Draft" && terminalStatus)); // fully locked once anything depends on it

  const setStatus = (newStatus) => {
    recordAudit({ module: "Purchase orders", docType: "PO", docNumber: order.number, action: newStatus === "Cancelled" ? "cancelled" : "status", summary: `Status → ${newStatus}` });
    if (hasDependents) {
      const what = [hasLinkedSO && "a Sales Order", hasShipment && "a shipment", lotReceivedOrMoved && "received / moved inventory"].filter(Boolean).join(", ");
      ofAlert({ tone: "warn", title: "PO locked", message: `This PO is locked: it has downstream dependents (${what}).\n\nWhile anything is linked, its status can't be changed (including back to Draft) or cancelled — that would corrupt the linked records. Unlink all downstream documents first, then the PO can be changed or deleted.` });
      return;
    }
    if (SHIP_OR_LATER.includes(newStatus) && order.loadingDate && String(order.loadingDate) > localTodayISO()) {
      ofAlert({ tone: "warn", title: "Too early", message: `This PO can't be set to "${newStatus}" yet — the loading date (${order.loadingDate}) hasn't been reached.\n\nGoods can't leave origin before they are loaded. Update the loading date if it has actually changed, or wait until the loading date.` });
      return;
    }
    sf("status", newStatus);
  };
  const WAREHOUSE_ADDRESS = ((unifiedLocations(contacts || []).find((l: any) => ["WAREHOUSE", "OWN"].includes(String(l.legacyType))) || {}) as any).address || (warehouseAddressLocations(contacts || [])[0] || {}).name || "";
  const addItem = () => setOrder(o => ({ ...o, items: [...o.items, { id: nextId(), product: "", variety: "", cnCode: "", coloration: "", origin: "", size: "", quality: "I", unit: "Kg", qty: "", pallets: "", boxes: "", unitPrice: "", currency: o.currency || "PLN", packaging: "" }] }));
  const removeItem = (idx) => setOrder(o => ({ ...o, items: o.items.filter((_, i) => i !== idx) }));
  const copyItem = (idx) => setOrder(o => ({ ...o, items: copyPOLine(o.items, idx, nextId()) }));   // v6.99.77 (A-POL-1)
  const sSupplier = (name) => sf("supplier", suppliers.find(s => s.name === name) || null);

  const total = netTotal(order.items);
  const totalKg = totalQtyKg(order.items);
  const totalInPLN = total * (parseFloat(order.fxRate) || FX_RATES[order.currency] || 1);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {ofPONode}
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#2563EB", fontWeight: 500 }}>← Purchase Orders</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          {order.id && (() => {
            const isDraft = order.status === "Draft";
            const draftStyle = {
              padding: "5px 14px", borderRadius: 7, border: "1px solid #E5E7EB",
              background: isDraft ? "#F9FAFB" : "#fff",
              color: isDraft ? "#9CA3AF" : "#111",
              fontSize: 12, fontWeight: 600,
              cursor: isDraft ? "not-allowed" : "pointer"
            };
            const tip = isDraft ? "Confirm the PO first — drafts cannot be printed or sent to suppliers" : "";
            return <>
              <button onClick={isDraft ? undefined : onPrint} disabled={isDraft} title={tip} style={draftStyle}>Print</button>
              <button onClick={isDraft ? undefined : onEmail} disabled={isDraft} title={tip} style={draftStyle}>✉ Email Supplier</button>
            </>;
          })()}
          <button onClick={onCancel} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          <button onClick={() => onSave(order)} style={{ padding: "5px 16px", borderRadius: 7, border: "none", background: "#111", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Save</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
        <div style={{ maxWidth: PAGE_MAX, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, gap: 20 }}>
            <div style={{ minWidth: 0, flex: "1 1 auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                <StatusBadge status={order.status || "Draft"} />
                {(order.buyIncoterm || order.tradeMovement) && <FlowBadge order={order} />}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#111", fontFamily: "ui-monospace, Menlo, monospace" }}>{order.id ? order.number : "New Purchase Order"}</div>
              <div style={{ fontSize: 12, color: "#AAA", marginTop: 2 }}>{isLocked ? "Locked — commercial terms can't change; downstream records depend on this PO" : order.status !== "Draft" && order.id ? "Confirmed — still editable (nothing depends on it yet); edits re-sync the expected lot" : "Draft — all fields editable"}</div>
            </div>
            <div style={{ textAlign: "right", flex: "0 0 auto", whiteSpace: "nowrap" }}>
              <div style={{ fontSize: 11, color: "#888" }}>Total net</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#111" }}>{fmtMoney(total, order.currency)}</div>
              {order.currency !== "PLN" && <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{fmtMoney(totalInPLN, "PLN")} · rate {order.fxRate}</div>}
              <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{fmtNum(totalKg)} kg total</div>
            </div>
          </div>

          {isLocked && (
            <div style={{ marginBottom: 16, padding: "11px 14px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, fontSize: 12.5, color: "#92400E", lineHeight: 1.5 }}>
              🔒 <strong>This PO is locked.</strong> Its commercial terms (product, quantities, supplier, incoterm, flow, pricing) can't be changed because something downstream already depends on it{(() => {
                const reasons = [hasLinkedSO && "a sales order is sourced from it", hasShipment && "a shipment references it", lotReceivedOrMoved && "its goods have been received or moved"].filter(Boolean);
                return reasons.length ? ` — ${reasons.join(", ")}` : "";
              })()}. Every field is now locked — the PO is the building block the whole deal is built on, so once anything references it, it's frozen. To change anything, cancel this PO and raise a new one.
            </div>
          )}
          {!isLocked && order.id && order.status !== "Draft" && (
            <div style={{ marginBottom: 16, padding: "11px 14px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, fontSize: 12.5, color: "#1E40AF", lineHeight: 1.5 }}>
              ✎ <strong>Confirmed, and still editable.</strong> Nothing depends on this PO yet (no sales order, no shipment, goods not received), so you can still change its details — saving will re-sync the expected inventory lot. ⚠ As soon as you link a sales order, create a shipment, or receive goods, THIS PO LOCKS COMPLETELY — every field becomes read-only and can't be changed again. Get the details right now. (Reverting to Draft withdraws the not-yet-received lot.)
            </div>
          )}

          {/* Header card */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>ORDER DETAILS</SectionTitle>
            {/* v6.99.24 (owner): identity on one line, the four dates on the next */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <Lbl>PO number <span style={{ color: "#16A34A", fontWeight: 500 }}>· system number{!order.id ? ", auto-generated" : ""}</span></Lbl>
                {/* BP-6: number is a controlled document id — display/copy only, never edited. */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", border: "1px solid #E5E7EB", borderRadius: 8, background: "#F8FAFC", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, fontWeight: 700, color: "#334155" }}>
                  <span>{order.number || "PO-2026-…"}</span>
                  <button type="button" onClick={() => { try { navigator.clipboard.writeText(order.number || ""); } catch {} }} title="Copy PO number" style={{ marginLeft: "auto", border: "1px solid #E5E7EB", background: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 11, cursor: "pointer", fontWeight: 700, color: "#64748B" }}>Copy</button>
                </div>
              </div>
              <div>
                <Lbl>Supplier</Lbl>
                <Sel disabled={isLocked} value={order.supplier?.name || ""} onChange={e => sSupplier(e.target.value)}>
                  <option value="">— select —</option>
                  {suppliers.map(s => <option key={s.id} value={s.name}>{s.name} {s.country ? `· ${s.country}` : ""} {s.nip ? `(NIP ${s.nip})` : ""}</option>)}
                </Sel>
              </div>
              <div>
                <Lbl>Status</Lbl>
                <Sel value={order.status || "Draft"} onChange={e => setStatus(e.target.value)} disabled={hasDependents || order.status === "Cancelled"}
                  title={order.status === "Cancelled" ? "This PO is cancelled — kept for the record, read-only, and can't be reactivated." : hasDependents ? "Locked — a Sales Order, shipment or inventory depends on this PO. Unlink everything first." : ""}
                  style={{ borderLeft: `4px solid ${(PO_STATUSES[order.status || "Draft"] || {}).color || "#9CA3AF"}`, fontWeight: 700, color: (PO_STATUSES[order.status || "Draft"] || {}).color || "#111" }}>
                  {Object.keys(PO_STATUSES).map(s => <option key={s}>{s}</option>)}
                </Sel>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
              <div>
                <Lbl>Order date</Lbl>
                <Inp disabled={isLocked} value={order.orderDate} onChange={e => sf("orderDate", e.target.value)} type="date" noFuture title="The date the PO was created/agreed with the supplier" />
              </div>
              <div>
                <Lbl>Loading date</Lbl>
                <Inp disabled={isLocked} value={order.loadingDate} onChange={e => sf("loadingDate", e.target.value)} type="date" title="When the supplier loads our truck / container — goods leave origin" />
                <div style={{ fontSize: 10, color: "#AAA", marginTop: 3, lineHeight: 1.4 }}>Goods leave origin</div>
              </div>
              <div>
                <Lbl>Expected delivery date</Lbl>
                <Inp disabled={isLocked} value={order.expectedDeliveryDate} onChange={e => sf("expectedDeliveryDate", e.target.value)} type="date" title="When the goods are expected to arrive at the agreed handover point" />
                {/* FB-14: 'means' dropdown removed — the handover point (derived from the incoterm) already says where. */}
              </div>
              <div>
                <Lbl>Actual availability</Lbl>
                {/* BP-9: no longer typed here — the real date comes from the Shipment arrival /
                    Inventory receipt event. Shown read-only when known. */}
                <div style={{ padding: "9px 11px", border: "1px dashed #E5E7EB", borderRadius: 8, background: "#FAFAFA", fontSize: 12.5, color: order.actualAvailabilityDate ? "#334155" : "#9CA3AF" }}>
                  {order.actualAvailabilityDate ? `${order.actualAvailabilityDate} · from arrival/receipt` : "From shipment arrival / inventory receipt"}
                </div>
                <div style={{ fontSize: 10, color: "#AAA", marginTop: 3, lineHeight: 1.4 }}>Fill once it arrives</div>
              </div>
            </div>
          </Card>

          {/* Flow + Incoterm + Sea */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>FLOW · PURCHASE INCOTERM · DESTINATION</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              {/* ═══ Batch 6b (BP-56 final): PURCHASE TERMS — the contract, not the machinery.
                  Incoterm + named place are THE inputs; movement + handover derive; the
                  direct-ness derives live from the governing sale (poDirectFromSOs at save). */}
              <div style={{ gridColumn: "1 / -1", border: "1px solid #E0E7FF", background: "#F5F7FF", borderRadius: 10, padding: "12px 14px", marginBottom: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#4338CA", letterSpacing: "0.04em", marginBottom: 8 }}>INCOTERM DELIVERY (PURCHASE) <span style={{ fontWeight: 500, color: "#818CF8" }}>· required to confirm / print / send</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 10 }}>
                  <div>
                    <Lbl>Purchase incoterm *</Lbl>
                    <Sel value={order.buyIncoterm || ""} onChange={e => { const inc = e.target.value; setOrder(o => {
                      const hp = handoverPointForIncoterm(inc);
                      // v6.34.1 (item 1): default the delivery place per the incoterm, mirroring the SO.
                      // EXW/FCA → supplier's address; DAP/DDP → our warehouse address; FOB/CFR/CIF → leave for a port pick.
                      const ic = String(inc).toUpperCase();
                      let patch: any = { ...o, buyIncoterm: inc, purchaseIncoterm: inc, handoverPoint: hp || o.handoverPoint };
                      if (ic === "EXW" || ic === "FCA") {
                        // v6.99.48 (A-PO-13, owner): the named place defaults to the SUPPLIER'S OWN SITE (a registered place — it prints and it passes G-1), adjustable from the picker
                        const sites = counterpartyLocations((CONTACTS_REF || []).filter((c: any) => String(c.id) === String(o.supplier?.id)));
                        const site = sites[0] || null;
                        patch.destinationLocationId = site ? site.id : null; patch.destinationText = site ? site.name : (o.supplier?.address || o.destinationText || "");
                      }
                      else if (ic === "DAP" || ic === "DDP") { patch.destinationLocationId = null; patch.destinationText = (WAREHOUSE_ADDRESS || "") || o.destinationText || ""; }
                      else { patch.destinationText = o.destinationText || ""; } // ports: user picks from the pool
                      return patch;
                    }); }} disabled={isLocked}>
                      <option value="">— select —</option>
                      {INCOTERMS_BUY.map(i => <option key={i.code} value={i.code}>{i.code}</option>)}
                    </Sel>
                  </div>
                  <div>
                    {(() => {
                      const pool = namedPlacePoolForIncoterm(order.buyIncoterm);
                      // v6.99.13 (A-LOC-2): the ONE picker, preferred kinds first (from the incoterm), every other place in its own group below; no free text
                      return (<>
                        <Lbl>{pool.label} *</Lbl>
                        <LocationPicker disabled={isLocked} value={order.destinationLocationId ?? order.destinationText ?? ""} contacts={contacts} preferredKinds={pool.types} placeholder={`— ${pool.label.toLowerCase()} —`} onChange={(r: any) => setOrder((o: any) => ({ ...o, destinationLocationId: r.id, destinationText: r.name }))} />
                        <div style={{ fontSize: 10.5, color: "#6366F1", marginTop: 5 }}>{(() => {
                          const ic = String(order.buyIncoterm || "").toUpperCase();
                          if (!ic) return "Select the purchase incoterm — it sets what to fill here.";
                          if (ic === "EXW" || ic === "FCA") return `${ic} — pickup at the supplier's premises (defaults to the supplier address).`;
                          if (ic === "FOB") return "FOB — name the port of loading.";
                          if (ic === "CFR" || ic === "CIF") return `${ic} — name the port of discharge (destination port).`;
                          if (ic === "DAP") return "DAP — delivery place (defaults to our warehouse; change if elsewhere).";
                          if (ic === "DDP") return "DDP — delivered to our address (duties paid by the supplier).";
                          return "";
                        })()}</div>
                      </>);
                    })()}
                  </div>
                </div>
                {(() => {
                  // v6.43.0 (test-round #2): the provisional IMPORT/EXPORT chip is
                  // removed — trade direction is the shipment's truth, and a flow-era
                  // guess here was misleading (showed intra-EU on a CIF export). The
                  // contractual handover sentence stays; it's a fact of the incoterm.
                  const placeName = order.destinationText || (locationById(order.destinationLocationId)?.name) || "";
                  if (!order.buyIncoterm) return null;
                  return (
                    <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "#FBFCFF", border: "1px dashed #E0E7FF", fontSize: 11.5, color: "#4338CA", lineHeight: 1.45 }}>
                      {handoverSentence(order.buyIncoterm, placeName)}
                    </div>
                  );
                })()}
                {/* v6.72.0 READINESS. Everything that would stop or weaken this
                    order, shown WHILE you are filling it in rather than at the
                    moment you press save — the difference between a note and an
                    obstacle. Red is a hard gate, amber costs you later. */}
                {(() => {
                  const gate = poTermsMissing(order);
                  const warn = poWarnings(order);
                  if (!gate && !warn.length) {
                    return order.status === "Draft" ? (
                      <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "#F0FDF4", border: "1px solid #BBF7D0", fontSize: 11.5, color: "#166534" }}>
                        ✓ Ready to confirm — terms complete, every line has what the protocol and customs will need.
                      </div>
                    ) : null;
                  }
                  return (
                    <div style={{ marginTop: 10, padding: "9px 11px", borderRadius: 8, fontSize: 11.5,
                      background: gate ? "#FEF2F2" : "#FFFBEB",
                      border: `1px solid ${gate ? "#FECACA" : "#FDE68A"}`,
                      color: gate ? "#991B1B" : "#92400E" }}>
                      {gate && <div style={{ fontWeight: 700, marginBottom: warn.length ? 5 : 0 }}>
                        Cannot be confirmed without {gate}.
                      </div>}
                      {warn.length > 0 && <>
                        {gate ? <div style={{ fontWeight: 700, marginBottom: 4, color: "#92400E" }}>Also incomplete — these do not block:</div> : null}
                        <div style={{ lineHeight: 1.5, color: "#92400E" }}>{warn.map((w, i) => <div key={i}>· {w}</div>)}</div>
                      </>}
                    </div>
                  );
                })()}
              </div>
              {/* v6.29.0: the legacy Destination field is GONE — the named place in
                  PURCHASE TERMS is the single location fact on a PO (both wrote the
                  same stored keys, so nothing is lost). Onward routing belongs to the
                  shipment; disposition to the sale. */}
            </div>
            {/* v6.43.0 (test-round #3/#4): the "Sea freight involved" toggle is
                removed — transport planning (road/sea/multimodal legs) is owned by
                the Shipment module, not declared on the PO. */}
          </Card>

          {/* Pricing */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>PAYMENT · CURRENCY · FX</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1.3fr 0.8fr 0.9fr", gap: 14, alignItems: "start" }}>   {/* v6.99.24 (owner): terms · pricing · currency · rate on one line */}
              <div>
                {/* v6.99.23 (owner): ONE payment-terms field — a basis, plus days only when days apply. The legacy text dropdown is retired. */}
                <Lbl>Payment terms</Lbl>
                <div style={{ display: "grid", gridTemplateColumns: paymentBasisOf(order) === "INVOICE" ? "90px 1fr" : "1fr", gap: 8 }}>
                  {paymentBasisOf(order) === "INVOICE" && <Inp disabled={isLocked} type="number" value={order.paymentDays ?? paymentDaysFor(order, order.supplier)} onChange={e => sf("paymentDays", parseFloat(e.target.value) || 0)} placeholder={String(paymentDaysFor(order, order.supplier) || 30)} title="Days counted from the invoice issue date (owner ruling) — the purchase invoice's due date derives from this" />}
                  <Sel disabled={isLocked} value={paymentBasisOf(order)} onChange={e => sf("paymentBasis", e.target.value)}>
                    {PAYMENT_BASES.map(b => <option key={b.value} value={b.value}>{b.value === "INVOICE" ? "days from invoice date" : b.label}</option>)}
                  </Sel>
                </div>
                <div style={{ fontSize: 10.5, color: "#94A3B8", marginTop: 4 }}>{paymentTermsLabel(paymentBasisOf(order), order.paymentDays ?? paymentDaysFor(order, order.supplier))} — printed on the order and used for the invoice's due date</div>
              </div>
              <div>
                <Lbl>Pricing</Lbl>
                <Sel value={order.pricingMode || "firm"} onChange={e => sf("pricingMode", e.target.value)} disabled={isLocked}
                  title="Consignment: the producer's price is settled from your sales later — the PO saves WITHOUT purchase prices.">
                  <option value="firm">Firm price</option>
                  <option value="consignment">Consignment — settled on sales</option>
                </Sel>
              </div>
              <div>
                <Lbl>Currency</Lbl>
                <Sel value={order.currency} onChange={e => setOrder(o => ({ ...o, currency: e.target.value, items: (o.items || []).map(it => ({ ...it, currency: e.target.value })) }))} disabled={isLocked}>
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </Sel>
              </div>
              <div>
                <Lbl>FX rate to PLN {isLocked && <span style={{ color: "#888", fontWeight: 400 }}>(locked)</span>}</Lbl>
                <Inp type="number" value={order.fxRate ?? ""} onChange={e => sf("fxRate", e.target.value)} disabled={isLocked} />
                {order.fxLockedAt && <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>Locked on {order.fxLockedAt}</div>}
              </div>
            </div>
          </Card>

          {/* Line items */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle right={<button onClick={isLocked ? undefined : addItem} disabled={isLocked} title={isLocked ? "Confirmed PO — line items are locked" : ""} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #16A34A", background: "#fff", color: isLocked ? "#9CA3AF" : "#16A34A", fontSize: 11, fontWeight: 600, cursor: isLocked ? "not-allowed" : "pointer", opacity: isLocked ? 0.5 : 1 }}>+ Add line</button>}>LINE ITEMS ({order.items.length})</SectionTitle>
            {/* Shared datalist — product autocomplete pulls from this; grows as POs are added */}
            <datalist id="po-product-suggestions">
              {productSuggestions.map(p => <option key={p} value={p} />)}
            </datalist>
            <fieldset disabled={isLocked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            {order.items.map((it, i) => {
              const lineTotal = (parseFloat(it.qty) || 0) * (parseFloat(it.unitPrice) || 0);
              // Normalize product casing on blur — if user typed "golden delicious" but list has "Golden Delicious", match it
              return (
                <div key={i} style={{ marginBottom: 12, padding: 12, background: "#FAFAFA", borderRadius: 8, border: "1px solid #F3F4F6" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(190px, 2fr) 1fr 0.7fr 0.7fr 1fr 0.8fr 1fr minmax(130px, 1.3fr)", gap: 8, alignItems: "end" }}>   {/* v6.99.24 (owner): item · origin · size · quality · qty · unit · quantity type · unit price */}
                    <div>
                      <Lbl>Item / Variety</Lbl>
                      <ItemVarietyPicker catalog={productCatalog} setCatalog={setProductCatalog} item={it.product || ""} variety={it.variety || ""} onItem={(v: string) => {
                        // v6.34.1 (BP-8): auto-fill CN/HS from the catalog on product pick,
                        // empty-only so a manually-entered code is never overwritten.
                        setOrder(o => ({ ...o, items: o.items.map((row: any, ri: number) => {
                          if (ri !== i) return row;
                          const cn = (!row.cnCode || !String(row.cnCode).trim()) ? cnCodeForItem(productCatalog, v) : row.cnCode;
                          return { ...row, product: v, cnCode: cn };
                        }) }));
                      }} onVariety={(v: string) => si(i, "variety", v)} />
                    </div>
                    <div><Lbl>Origin</Lbl><Sel value={it.origin || ""} onChange={e => si(i, "origin", e.target.value)} title="v6.99.24 (owner): country of origin — the list is the Directory's Countries tab"><option value="">— country —</option>{readCountries().map((c: any) => <option key={c.iso} value={c.name}>{c.name}</option>)}{it.origin && !readCountries().some((c: any) => c.name === it.origin) && <option value={it.origin}>{it.origin}</option>}</Sel></div>
                    <div><Lbl>Size</Lbl><Inp value={it.size} onChange={e => si(i, "size", e.target.value)} placeholder="70-80" /></div>
                    <div><Lbl>Quality</Lbl><Sel value={it.quality} onChange={e => si(i, "quality", e.target.value)}>{QUALITY_GRADES.map(q => <option key={q}>{q}</option>)}</Sel></div>
                    <div><Lbl>Qty (kg){String(it.pricingUnit || "kg") === "box" ? " (derived)" : ""}{isEstimatedLine(it) ? " · ESTIMATED" : ""}</Lbl><Inp type="number" value={it.qty} onChange={e => si(i, "qty", e.target.value)} placeholder="e.g. 19500" disabled={isLocked && !isEstimatedLine(it)} title={isEstimatedLine(it) ? "v6.95.0 (PO-10): quantities are ESTIMATED until the producer's packing result — editable even on a confirmed order; prices and terms are locked" : ""} /></div>
                    <div><Lbl>Unit</Lbl><Sel value={it.pricingUnit || "kg"} onChange={e => si(i, "pricingUnit", e.target.value)} title="v6.94.0 (PO-1): order in kg or in boxes — the other figure derives from the packaging type"><option value="kg">kg</option><option value="box">box</option></Sel></div>
                    <div><Lbl>Quantity</Lbl><Sel value={isEstimatedLine(it) ? "ESTIMATED" : "FINAL"} onChange={e => si(i, "quantityStatus", e.target.value)} disabled={isLocked && !isEstimatedLine(it)} title="v6.95.0 (PO-10): ESTIMATED = agreed price, quantity to be confirmed by the producer's packing result"><option value="FINAL">Final</option><option value="ESTIMATED">Estimated</option></Sel></div>
                    <div><Lbl>Unit price</Lbl>{(order.pricingMode || "firm") === "consignment"
                      ? <div style={{ padding: "8px 10px", border: "1px dashed #D8B4FE", borderRadius: 6, fontSize: 12, color: "#7C3AED", background: "#FAF5FF", fontWeight: 600 }} title="Consignment — the producer's price is settled from your sales">Consignment ⚖</div>
                      : <Inp type="number" value={it.unitPrice} onChange={e => si(i, "unitPrice", e.target.value)} placeholder="e.g. 2.80" />}</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "0.85fr 1.4fr 0.8fr 0.7fr 0.85fr minmax(112px, 1.1fr) 38px 38px", gap: 8, alignItems: "end", marginTop: 8 }}>   {/* coloration · packaging · boxes · pallets · CN/HS · line total · copy · delete — v6.99.77 (A-POL-1, owner): two rows kept; copy sits before delete on THIS row; the line total keeps room for "Consignment" */}
                    <div><Lbl>Coloration</Lbl><Inp value={it.coloration} onChange={e => si(i, "coloration", e.target.value)} placeholder="przełamany / red / etc." /></div>
                    <div><Lbl>Packaging</Lbl><Inp value={it.packaging} onChange={e => { const v = e.target.value; const pk = (PO_PACKAGING_TYPES || []).find((p: any) => String(p.label).toLowerCase() === String(v).toLowerCase()); si(i, "packaging", v); si(i, "packagingId", pk ? pk.id : null); }} placeholder="pick a packaging type, or type it" list="po-packaging-types" />
                      <datalist id="po-packaging-types">{(PO_PACKAGING_TYPES || []).map((p: any) => <option key={p.id} value={p.label} />)}</datalist></div>
                    {/* v6.99.46 (A-PO-11, owner): boxes and pallets derive from the LINE'S packaging (never the product default);
                        a typed figure is a manual override, marked and reversible with ↺; the override survives re-derivation. */}
                    {(() => { const ec = effectiveCounts(it, PO_PACKAGING_TYPES || []); const isBoxUnit = String(it.pricingUnit || "kg") !== "kg"; return <>
                    <div><Lbl>Boxes{isBoxUnit ? "" : (ec.boxesManual ? <span style={{ color: "#B45309" }}> (manual) <button onClick={() => si(i, "boxesManual", null)} title="back to the derived figure" style={{ border: "none", background: "none", cursor: "pointer", color: "#2563EB", fontSize: 11, padding: 0 }}>↺</button></span> : (ec.derived.hasPackaging ? " (derived)" : ""))}</Lbl>
                      {isBoxUnit
                        ? <Inp type="number" value={it.boxes ?? ""} onChange={e => si(i, "boxes", e.target.value)} placeholder="e.g. 1500" />
                        : <Inp type="number" value={ec.boxes ?? ""} onChange={e => si(i, "boxesManual", e.target.value)} placeholder={ec.derived.hasPackaging ? "e.g. 1500" : "choose a packaging"} title={ec.derived.hasPackaging ? `${ec.derived.kgPerBox} kg per box` : "the packaging decides the box count — pick it first"} style={ec.boxesManual ? { borderColor: "#F59E0B" } : {}} />}
                    </div>
                    <div><Lbl>Pallets{ec.palletsManual ? <span style={{ color: "#B45309" }}> (manual) <button onClick={() => si(i, "palletsManual", null)} title="back to the derived figure" style={{ border: "none", background: "none", cursor: "pointer", color: "#2563EB", fontSize: 11, padding: 0 }}>↺</button></span> : (ec.derived.pallets != null ? " (derived)" : "")}</Lbl>
                      <Inp type="number" value={ec.pallets ?? ""} onChange={e => si(i, "palletsManual", e.target.value)} placeholder={ec.derived.boxesPerPallet > 0 ? "e.g. 24" : (ec.derived.hasPackaging ? "boxes per pallet not set" : "choose a packaging")} title={ec.derived.boxesPerPallet > 0 ? `${ec.derived.boxesPerPallet} boxes per pallet` : ""} style={ec.palletsManual ? { borderColor: "#F59E0B" } : {}} />
                    </div>
                    </>; })()}
                    <div><Lbl>CN / HS code</Lbl><Inp value={it.cnCode ?? ""} onChange={e => si(i, "cnCode", e.target.value)} placeholder="e.g. 0808 10" title="Customs tariff code for this item — carried to the SO and shipment" /></div>
                    <div><Lbl>Line total</Lbl>{(order.pricingMode || "firm") === "consignment"
                      ? <div style={{ padding: "8px 10px", fontSize: 13, fontWeight: 700, color: "#7C3AED", whiteSpace: "nowrap" }} title="Consignment: priced from the sales later">Consignment</div>
                      : <div style={{ padding: "8px 10px", fontSize: 13, fontWeight: 700, color: "#111", whiteSpace: "nowrap" }}>{lineTotal.toLocaleString("pl-PL", { minimumFractionDigits: 2 })}</div>}</div>
                    <button onClick={() => copyItem(i)} title="Copy this line — the copy lands right under it; change what differs (e.g. the size)" disabled={isLocked} style={{ height: 33, padding: "0 6px", border: "1px solid #2563EB", borderRadius: 6, background: "#fff", color: "#2563EB", fontSize: 14, fontWeight: 800, cursor: isLocked ? "not-allowed" : "pointer", opacity: isLocked ? 0.4 : 1 }}>⧉</button>
                    <button onClick={() => removeItem(i)} title="Delete this line" disabled={order.items.length <= 1} style={{ height: 33, padding: "0 6px", border: "1px solid #DC2626", borderRadius: 6, background: "#DC2626", color: "#fff", fontSize: 13, fontWeight: 800, cursor: order.items.length <= 1 ? "not-allowed" : "pointer", opacity: order.items.length <= 1 ? 0.4 : 1 }}>🗑</button>
                  </div>
                </div>
              );
            })}
            </fieldset>
          <div style={{ marginTop: 8, padding: "6px 10px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 7, fontSize: 12, fontWeight: 700, color: "#166534" }} title="v6.99.6 (A-R9-2): totals of the lines — check before Confirm">Σ {totalsLine(documentTotals(order.items, PO_PACKAGING_TYPES, order.fxRate), order.currency)}</div>
            </Card>

          {/* Notes */}
          <Card>
            <SectionTitle>NOTES</SectionTitle>
            <textarea disabled={isLocked} value={order.notes || ""} onChange={e => sf("notes", e.target.value)} rows={4} placeholder="Special instructions, packing requirements, labels…"
              style={{ width: "100%", border: "1.5px solid #F59E0B", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", outline: "none", resize: "vertical", lineHeight: 1.6 }} />
          </Card>
        </div>
      </div>
    </div>
  );
}
