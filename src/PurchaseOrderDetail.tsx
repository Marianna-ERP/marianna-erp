// PurchaseOrderDetail.tsx — v6.99.68 (A-AUD-2, owner): moved out of PurchaseOrders.tsx unchanged; the module's shared helpers are imported from it.
import DateInput from "./DateInput";
import React from "react";
import { Card, Lbl, SectionTitle, ActionButton } from "./ui";
import { ItemVarietyPicker } from "./ProductPicker";
import { PAGE_MAX, SmallButton } from "./ui";
import { cnCodeForItem } from "./productCatalog";
import { effectiveCounts } from "./pricingUnit.domain";
import { formatAddress, addressOf, liveParty } from "./address.domain";
import { isEstimatedLine } from "./so.domain";
import { paymentText } from "./po.domain";   // v6.99.76 (A-PV-2)
import { CONTACTS_REF, FlowBadge, LOCATION_TYPES, LifecycleTimeline, LinkRow, PO_PACKAGING_TYPES, QUALITY_GRADES, QualityBadge, StatusBadge, TruckSettlementCard, VarianceBadge, destinationDisplay, fmtDate, fmtMoney, fmtNum, locById, netTotal, plnTotal, totalQtyKg } from "./PurchaseOrders";

// ── v6.99.36 (A-R25-6, owner): the supplier's truck is registered in ONE window, confirmed before anything is created ──
// ── v6.99.50 (TO-2, owner): THE PRODUCER'S PACKING LIST in one window — final kilos per line, a size the order did not
// have (at its own price), a line not loaded (0). Allowed on a Confirmed PO with a shipment, as long as nothing was received
// or shipped: securing the truck must not freeze the order. The shipment's goods rows re-derive; the truck total is what it is.
export function PackingResultWindow({ order, onClose, onConfirm, preview = null, catalog = [], setCatalog = null, packagingTypes = [], counts = null }: any) {
  const [rows, setRows] = React.useState<any[]>(() => (order.items || []).map((it: any, i: number) => ({ lineId: it.id ?? i + 1, it, qty: isEstimatedLine(it) ? "" : String(it.qty ?? ""), boxes: "" })));
  const [added, setAdded] = React.useState<any[]>([]);
  const [choice, setChoice] = React.useState<Record<string, string>>({});
  const [prices, setPrices] = React.useState<Record<string, any>>({});
  // v6.99.65 (A-PK-6, owner): every field except coloration — variety only when the catalogue item has varieties
  const missingOf = (a: any): string[] => { const hasVar = ((catalog || []).find((c: any) => String(c.item) === String(a.product))?.varieties || []).length > 0;
    return [!String(a.product || "").trim() && "item", hasVar && !String(a.variety || "").trim() && "variety", !String(a.size || "").trim() && "size", !String(a.quality || "").trim() && "quality", !(parseFloat(a.qty) > 0) && "quantity", !(parseFloat(a.unitPrice) > 0) && "unit price", !(a.packagingId || String(a.packaging || "").trim()) && "packaging"].filter(Boolean) as string[]; };
  const incomplete = added.map((a: any, i: number) => ({ i, miss: missingOf(a) })).filter(x => x.miss.length);
  const payload = () => [...rows.map(r => ({ lineId: r.lineId, qty: String(r.qty).trim() === "" ? undefined : parseFloat(String(r.qty).replace(",", ".")), boxes: String(r.boxes ?? "").trim() === "" ? undefined : parseFloat(String(r.boxes).replace(",", ".")) })), ...added.filter(a => parseFloat(a.qty) > 0).map(a => ({ newLine: { ...a, qty: parseFloat(String(a.qty).replace(",", ".")), unitPrice: parseFloat(String(a.unitPrice).replace(",", ".")) || 0 } }))];
  const inp: any = { border: "1px solid #E5E7EB", borderRadius: 7, padding: "6px 8px", fontSize: 12.5, width: "100%", boxSizing: "border-box" };
  const total = rows.reduce((s, r) => s + (parseFloat(String(r.qty).replace(",", ".")) || (String(r.qty).trim() === "" ? (parseFloat(r.it.qty) || 0) : 0)), 0) + added.reduce((s, a) => s + (parseFloat(String(a.qty).replace(",", ".")) || 0), 0);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "50px 16px", overflow: "auto" }}>
      <div style={{ background: "#fff", borderRadius: 12, width: "min(900px, 100%)", border: "2px solid #7C3AED", overflow: "hidden" }}>
        <div style={{ background: "#F5F3FF", borderBottom: "1px solid #DDD6FE", padding: "10px 16px" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#6D28D9" }}>📦 Producer's packing list · {order.number}</div>
          <div style={{ fontSize: 11.5, color: "#64748B" }}>the final kilos per line — blank keeps the estimate · 0 = not loaded · anything loaded that the order did not have is added below as an additional item</div>
        </div>
        <div style={{ padding: "12px 16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 0.8fr 0.8fr 1fr 1fr 0.9fr", gap: 8, fontSize: 10, fontWeight: 700, color: "#94A3B8" }}><div>LINE</div><div>SIZE</div><div>CLASS</div><div>ESTIMATED / ORDERED</div><div>FINAL KG</div><div>BOXES LOADED</div></div>
          {rows.map((r, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 0.8fr 0.8fr 1fr 1fr 0.9fr", gap: 8, alignItems: "center", padding: "4px 0", borderTop: "1px solid #F1F5F9" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>{r.it.product}{r.it.variety ? ` — ${r.it.variety}` : ""}</div><div style={{ fontSize: 12 }}>{r.it.size || "—"}</div><div style={{ fontSize: 12 }}>{r.it.quality || "—"}</div>
            <div style={{ fontSize: 12 }}>{Math.round(parseFloat(r.it.qty) || 0).toLocaleString("pl-PL")} kg {isEstimatedLine(r.it) ? <span style={{ color: "#B45309" }}>≈ estimated</span> : <span style={{ color: "#94A3B8" }}>final</span>}</div>
            <input type="number" value={r.qty} onChange={e => setRows(rows.map((x, k) => k === i ? { ...x, qty: e.target.value } : x))} placeholder={isEstimatedLine(r.it) ? "final kg" : String(r.it.qty)} style={inp} />
            {/* v6.99.65 (A-PK-4): the boxes follow the final kilos (from the packaging); type the producer's count if it differs */}
            {(() => { const fk = String(r.qty).trim() === "" ? parseFloat(r.it.qty) : parseFloat(String(r.qty).replace(",", ".")); const d = counts ? counts({ ...r.it, qty: fk, boxesManual: undefined, palletsManual: undefined }).boxes : null;
              return <input type="number" value={r.boxes} onChange={e => setRows(rows.map((x, k) => k === i ? { ...x, boxes: e.target.value } : x))} placeholder={d != null ? String(d) : "boxes"} title={d != null ? `${d} from the final kilos and the packaging — type the producer's count if it differs` : "no packaging on this line"} style={inp} />; })()}
          </div>)}
          <div style={{ fontSize: 10.5, fontWeight: 800, color: "#94A3B8", margin: "12px 0 4px" }}>ADDITIONAL ITEMS — loaded, not on the order</div>
          {/* v6.99.57 (A-PK-1, owner): the PO line's own editors — item/variety from the catalogue, size, quality, quantity, price, coloration, packaging.
              Origin and unit come from the order; the quantity is FINAL (it is what is loaded); CN code, boxes and pallets derive. */}
          <datalist id="pk-sizes">{Array.from(new Set((order.items || []).map((x: any) => String(x.size || "")).filter(Boolean))).map((v: any) => <option key={v} value={v} />)}</datalist>
          <datalist id="pk-colorations">{Array.from(new Set((order.items || []).map((x: any) => String(x.coloration || "")).filter(Boolean))).map((v: any) => <option key={v} value={v} />)}</datalist>
          {added.map((a, i) => { const set = (patch: any) => setAdded(added.map((x, k) => k === i ? { ...x, ...patch } : x)); return (
            <div key={a.id || i} style={{ border: "1px solid #EDE9FE", borderRadius: 8, padding: "8px", marginBottom: 6, background: "#FFFFFF" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 2fr) 0.8fr 0.7fr 0.8fr 0.8fr 1fr 1.2fr 34px", gap: 8, alignItems: "end" }}>
                <div><Lbl>Item / Variety</Lbl><ItemVarietyPicker catalog={catalog} setCatalog={setCatalog || (() => {})} item={a.product || ""} variety={a.variety || ""} onItem={(v: string) => set({ product: v, variety: "", cnCode: cnCodeForItem(catalog, v) || "" })} onVariety={(v: string) => set({ variety: v })} /></div>
                <div><Lbl>Size</Lbl><input list="pk-sizes" value={a.size} onChange={e => set({ size: e.target.value })} placeholder="60-65" style={missingOf(a).includes("size") ? { ...inp, borderColor: "#DC2626", background: "#FEF2F2" } : inp} /></div>
                <div><Lbl>Quality</Lbl><select value={a.quality || "I"} onChange={e => set({ quality: e.target.value })} style={inp}>{QUALITY_GRADES.map(g => <option key={g}>{g}</option>)}</select></div>
                <div><Lbl>Quantity ({a.pricingUnit || "kg"})</Lbl><input type="number" value={a.qty} onChange={e => set({ qty: e.target.value })} placeholder="final" style={missingOf(a).includes("quantity") ? { ...inp, borderColor: "#DC2626", background: "#FEF2F2" } : inp} /></div>
                <div><Lbl>Unit price ({order.currency || "PLN"})</Lbl><input type="number" value={a.unitPrice} onChange={e => set({ unitPrice: e.target.value })} style={missingOf(a).includes("unit price") ? { ...inp, borderColor: "#DC2626", background: "#FEF2F2" } : inp} /></div>
                <div><Lbl>Coloration</Lbl><input list="pk-colorations" value={a.coloration || ""} onChange={e => set({ coloration: e.target.value })} style={inp} /></div>
                <div><Lbl>Packaging</Lbl><select value={a.packagingId ?? ""} onChange={e => { const pk = (packagingTypes || []).find((t: any) => String(t.id) === e.target.value); set({ packagingId: pk ? pk.id : null, packaging: pk ? pk.label : "" }); }} style={missingOf(a).includes("packaging") ? { ...inp, borderColor: "#DC2626", background: "#FEF2F2" } : inp}><option value="">— choose —</option>{(packagingTypes || []).map((t: any) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
                <button onClick={() => setAdded(added.filter((_, k) => k !== i))} title="remove this item" style={{ border: "1px solid #FECACA", background: "#fff", color: "#DC2626", borderRadius: 6, height: 32, cursor: "pointer" }}>✕</button>
              </div>
              <div style={{ fontSize: 10.5, color: "#64748B", marginTop: 4 }}>taken from the order: origin <b>{a.origin || "—"}</b> · unit <b>{a.pricingUnit || "kg"}</b> · quantity <b>final</b>{a.cnCode ? <> · CN <b>{a.cnCode}</b></> : null} · boxes and pallets derive from the packaging</div>
            </div>); })}
          <button onClick={() => { const b = (order.items || [])[0] || {}; setAdded([...added, { id: `pk-${Date.now()}-${added.length + 1}`, product: b.product || "", variety: "", size: "", quality: b.quality || "I", qty: "", unitPrice: "", coloration: "", packaging: "", packagingId: null, cnCode: cnCodeForItem(catalog, b.product) || "", origin: b.origin || "", pricingUnit: b.pricingUnit || "kg" }]); }}
            style={{ width: "100%", padding: "8px", marginTop: 4, border: "2px dashed #7C3AED", borderRadius: 8, background: "#F5F3FF", color: "#6D28D9", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>⊕ Add additional items</button>
          <div style={{ marginTop: 12, fontSize: 13, fontWeight: 800 }}>Truck total: {Math.round(total).toLocaleString("pl-PL")} kg</div>
          {/* v6.99.56 (A-PL-2, owner): what follows — the sale is what was loaded, so it takes the final kilos; a new size joins it at a price to agree */}
          {preview && (() => { const pv = preview(payload(), { choice, prices }); return (
            <div style={{ marginTop: 12, border: "1px solid #DDD6FE", borderRadius: 8, padding: "8px 10px", background: "#FAF5FF" }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: "#6D28D9", marginBottom: 4 }}>WHAT FOLLOWS</div>
              <div style={{ fontSize: 11.5, color: "#475569" }}>Expected lots rebuilt from the final lines · shipments not yet loaded re-derive their goods.</div>
              {pv.soChanges.map((s: string, i: number) => <div key={i} style={{ fontSize: 12, marginTop: 3 }}>• {s}</div>)}
              {pv.questions.map((q: any) => <div key={q.key} style={{ fontSize: 12, marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}><span style={{ color: "#92400E", fontWeight: 700 }}>? {q.label}</span>
                <select value={choice[q.key] || ""} onChange={e => setChoice({ ...choice, [q.key]: e.target.value })} style={{ border: "1px solid #E5E7EB", borderRadius: 6, padding: "4px 6px", fontSize: 12 }}><option value="">— choose —</option>{q.options.map((o: string) => <option key={o}>{o}</option>)}</select></div>)}
              {added.filter(a => parseFloat(a.qty) > 0).map((a: any) => <div key={a.id} style={{ fontSize: 12, marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
                <span>Sales price for {[a.product, a.variety, a.size].filter(Boolean).join(" ") || "the additional item"} <span style={{ color: "#94A3B8" }}>(blank = to agree — the sales invoice waits for it)</span></span>
                <input type="number" value={prices[a.id] ?? ""} onChange={e => setPrices({ ...prices, [a.id]: e.target.value })} placeholder="price / kg" style={{ width: 110, border: "1px solid #E5E7EB", borderRadius: 6, padding: "4px 6px", fontSize: 12 }} /></div>)}
            </div>); })()}
        </div>
        <div style={{ borderTop: "1px solid #E5E7EB", background: "#F8FAFC", padding: "10px 16px", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <SmallButton onClick={onClose}>Cancel</SmallButton>
          {incomplete.length > 0 && <span style={{ fontSize: 11.5, color: "#B91C1C", fontWeight: 700, alignSelf: "center" }}>Additional item{incomplete.length > 1 ? "s" : ""} incomplete: {incomplete.map(x => `#${x.i + 1} — ${x.miss.join(", ")}`).join(" · ")}</span>}
          <button disabled={incomplete.length > 0} onClick={() => { if (incomplete.length) return; onConfirm(payload(), { choice, prices }); }}
            style={{ padding: "6px 16px", borderRadius: 7, border: "none", background: "#16A34A", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>Quantities are final</button>
        </div>
      </div>
    </div>
  );
}

export function SupplierTruckWindow({ order, lots = [], onClose, onConfirm }: any) {
  const [f, setF] = React.useState<any>({ plate: "", trailer: "", driver: "", supplierRef: "", eta: "", recorder: "", note: "" });
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const myLots = (lots || []).filter((l: any) => String(l.poRef) === String(order.number));
  const inp: any = { border: "1px solid #E5E7EB", borderRadius: 7, padding: "7px 9px", fontSize: 12.5, width: "100%", boxSizing: "border-box" };
  const [asking, setAsking] = React.useState(false);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "50px 16px", overflow: "auto" }}>
      <div style={{ background: "#fff", borderRadius: 12, width: "min(820px, 100%)", border: "2px solid #0F766E", overflow: "hidden" }}>
        <div style={{ background: "#F0FDFA", borderBottom: "1px solid #99F6E4", padding: "10px 16px" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#0F766E" }}>🚚 Register the supplier's truck</div>
          <div style={{ fontSize: 11.5, color: "#64748B" }}>{order.number} · {order.supplier?.name || ""} · the supplier delivers ({order.buyIncoterm}) — we track the truck, we do not pay for it</div>
        </div>
        <div style={{ padding: "14px 16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            <div><Lbl>Truck plate</Lbl><input value={f.plate} onChange={e => set("plate", e.target.value)} placeholder="WGM 4421K" style={inp} /></div>
            <div><Lbl>Trailer plate</Lbl><input value={f.trailer} onChange={e => set("trailer", e.target.value)} style={inp} /></div>
            <div><Lbl>Driver</Lbl><input value={f.driver} onChange={e => set("driver", e.target.value)} style={inp} /></div>
            <div><Lbl>Supplier's reference</Lbl><input value={f.supplierRef} onChange={e => set("supplierRef", e.target.value)} placeholder="GM-004" style={inp} title="their own shipment reference — the link between their paperwork and ours" /></div>
            <div><Lbl>ETA</Lbl><DateInput value={f.eta} onChange={(e: any) => set("eta", e.target.value)} /></div>
            <div><Lbl>Temperature recorder</Lbl><input value={f.recorder} onChange={e => set("recorder", e.target.value)} placeholder="TR-88412" style={inp} /></div>
          </div>
          <div style={{ marginTop: 10 }}><Lbl>Note</Lbl><input value={f.note} onChange={e => set("note", e.target.value)} style={inp} /></div>
          <div style={{ marginTop: 12, fontSize: 11.5, color: "#64748B" }}>
            Carrying {myLots.length} lot(s): {myLots.map((l: any) => `${l.number} · ${l.product}${l.variety ? " " + l.variety : ""} ${Math.round(Number(l.expectedKg) || 0).toLocaleString("pl-PL")} kg`).join(" · ") || "—"}
          </div>
        </div>
        <div style={{ borderTop: "1px solid #E5E7EB", background: "#F8FAFC", padding: "10px 16px", display: "flex", gap: 8, alignItems: "center" }}>
          {asking && <span style={{ fontSize: 12, fontWeight: 700, color: "#92400E" }}>Create the inbound shipment for {f.plate || "this truck"}{f.supplierRef ? ` (${f.supplierRef})` : ""}?</span>}
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <SmallButton kind="close" onClick={onClose}>Close</SmallButton>
            {asking
              ? <><SmallButton onClick={() => setAsking(false)}>No</SmallButton><button onClick={() => onConfirm(f)} style={{ padding: "6px 16px", borderRadius: 7, border: "none", background: "#0F766E", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>Yes, register</button></>
              : <button onClick={() => setAsking(true)} style={{ padding: "6px 16px", borderRadius: 7, border: "none", background: "#0F766E", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>Register truck</button>}
          </span>
        </div>
      </div>
    </div>
  );
}

export function OrderDetail({ users = [], userName = "", supplierTrucks = [], onOpenShipment = null, order, onBack, onEdit, onDelete, onPrint, onEmail, computedShipments = [], computedSOs = [], computedLots = null, computedInvoices = null, expectedLots = [], onReceiveLot = null, onRegisterTruck = null, settlement = null, ctxOrders = [], onPackingResult = null }: any) {
  const total = netTotal(order.items);
  const totalKg = totalQtyKg(order.items);
  const totalPLN = plnTotal(order);
  const dest = locById(order.destinationLocationId);
  const destLabel = destinationDisplay(order);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#2563EB", fontWeight: 500 }}>← Purchase Orders</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          {(() => {
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
              <button onClick={isDraft ? undefined : onEmail} disabled={isDraft} title={tip} style={draftStyle}>✉ Email</button>
            </>;
          })()}
          {order.status === "Cancelled"
            ? <span style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #FECACA", background: "#FEF2F2", color: "#B91C1C", fontSize: 12, fontWeight: 600 }}>Deleted — read-only</span>
            : <button onClick={onEdit} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #2563EB", background: "#fff", color: "#2563EB", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Edit</button>}
          <ActionButton action="delete" onClick={onDelete} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
        <div style={{ maxWidth: PAGE_MAX, margin: "0 auto" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 20 }}>
            <div style={{ minWidth: 0, flex: "1 1 auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                <StatusBadge status={order.status} />
                {(order.buyIncoterm || order.tradeMovement) && <FlowBadge order={order} />}
                <VarianceBadge variance={order.variance} />
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#111", fontFamily: "ui-monospace, Menlo, monospace", marginBottom: 4 }}>{order.number}</div>
              <div style={{ fontSize: 13, color: "#444" }}>{order.supplier?.name} · {order.supplier?.country} {destLabel !== "—" && <>· destination {dest ? LOCATION_TYPES[dest.type]?.icon : "📍"} {destLabel}</>}</div>
            </div>
            <div style={{ textAlign: "right", flex: "0 0 auto", whiteSpace: "nowrap" }}>
              <div style={{ fontSize: 11, color: "#888" }}>Total value</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#111" }}>{fmtMoney(total, order.currency)}</div>
              {order.currency !== "PLN" && <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{fmtMoney(totalPLN, "PLN")} · rate {order.fxRate}</div>}
              <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{fmtNum(totalKg)} kg total</div>
            </div>
          </div>

          {/* Lifecycle */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>LIFECYCLE</SectionTitle>
            <LifecycleTimeline status={order.status} />
          </Card>

          {/* Two-column body */}
          {/* v6.99.104 (A-PV-3, owner): the truck settlement takes the whole width */}
          {settlement && (order.pricingMode || "firm") === "consignment" && <TruckSettlementCard order={order} {...settlement} />}
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 20 }}>
            <div>
              {/* Line items */}
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle>LINE ITEMS ({order.items.length})</SectionTitle>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: "#F9FAFB" }}>
                      {["Product", "Origin", "Size", "Kl.", "Packaging", "Boxes", "Qty kg", "Unit price", "Total"].map((h, i) => (
                        <th key={i} style={{ padding: "8px 10px", textAlign: i >= 5 ? "right" : "left", fontSize: 10, fontWeight: 700, color: "#888", letterSpacing: "0.06em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((it, i) => {
                      const lt = (parseFloat(it.qty) || 0) * (parseFloat(it.unitPrice) || 0);
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                          <td style={{ padding: "10px", fontWeight: 600 }}>
                            {it.product}{it.variety ? <span style={{ fontWeight: 400, color: "#666" }}> — {it.variety}</span> : null}
                            {it.coloration && <div style={{ fontSize: 10.5, color: "#AAA", fontWeight: 400 }}>{it.coloration}</div>}
                          </td>
                          <td style={{ padding: "10px", color: "#555" }}>{it.origin || "—"}</td>
                          <td style={{ padding: "10px", color: "#555" }}>{it.size || "—"}</td>
                          <td style={{ padding: "10px" }}><QualityBadge quality={it.quality} /></td>
                          <td style={{ padding: "10px", color: "#666", fontSize: 11.5 }}>{it.packaging || "—"}</td>
                          <td style={{ padding: "10px", textAlign: "right", color: "#555" }}>{(() => { const b = String(it.pricingUnit || "kg") !== "kg" ? parseFloat(it.boxes) : effectiveCounts(it, PO_PACKAGING_TYPES || []).boxes; return b ? fmtNum(b) : "—"; })()}</td>
                          <td style={{ padding: "10px", textAlign: "right", fontWeight: 600 }}>{fmtNum(it.qty)}</td>
                          <td style={{ padding: "10px", textAlign: "right" }}>{(order.pricingMode || "firm") === "consignment" ? <span style={{ color: "#7C3AED", fontWeight: 600 }}>Consignment ⚖</span> : <>{parseFloat(it.unitPrice || 0).toFixed(2)} {order.currency}</>}</td>
                          <td style={{ padding: "10px", textAlign: "right", fontWeight: 700 }}>{lt.toLocaleString("pl-PL", { minimumFractionDigits: 2 })}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: "#F9FAFB" }}>
                      <td colSpan={5} style={{ padding: "10px", fontWeight: 700, color: "#111" }}>Total</td>
                      <td style={{ padding: "10px", textAlign: "right", fontWeight: 700 }}>{fmtNum(order.items.reduce((s: number, it: any) => s + ((String(it.pricingUnit || "kg") !== "kg" ? parseFloat(it.boxes) : effectiveCounts(it, PO_PACKAGING_TYPES || []).boxes) || 0), 0)) || "—"}</td>
                      <td style={{ padding: "10px", textAlign: "right", fontWeight: 700 }}>{fmtNum(totalKg)} kg</td>
                      <td></td>
                      <td style={{ padding: "10px", textAlign: "right", fontWeight: 700, fontSize: 14 }}>{fmtMoney(total, order.currency)}</td>
                    </tr>
                  </tbody>
                </table>
              </Card>

              {/* v7.1.5 (A-PV-6, owner 6 Oct): Linked documents directly under Line items (was under Order details since v6.99.104) */}
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle>LINKED DOCUMENTS</SectionTitle>
                <LinkRow label="Sales orders" items={computedSOs} color="#16A34A" bg="#DCFCE7" from={order.number} />
                <LinkRow label="Shipments" items={computedShipments} color="#0284C7" bg="#E0F2FE" from={order.number} />
                {(() => { const sos = (computedSOs || []); const direct = (ctxOrders || []).filter((o: any) => o.status !== "Cancelled" && o.status !== "Draft" && (o.items || []).some((it: any) => it.sourceType === "PO" && it.sourceRef === order.number) && ["EXW", "DAP", "DPU", "DDP", "CIF", "CFR", "FOB", "FCA"].includes(String(o.sellIncoterm || "").toUpperCase())); void sos;
                  return direct.length ? <div style={{ fontSize: 11, color: "#166534", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 6, padding: "4px 8px", marginBottom: 8 }} title="v6.94.0 (PO-7): the pass-through flag is DERIVED — here is why">↗ Direct to client — because {direct.map((o: any) => `${o.number} sells ${o.sellIncoterm}`).join(", ")}; the goods never enter our warehouse</div> : null; })()}
                <LinkRow label="Inventory lots" items={computedLots ?? order.linkedLots} color="#92400E" bg="#FEF3C7" from={order.number} />
                {/* v6.79.0 (owner request): the DDP truck arrives with the PO number on the delivery
                    note — so receiving lives HERE too, not only on the lot in Inventory. */}
                {typeof onPackingResult === "function" && order.status === "Confirmed" && (order.items || []).some((it: any) => isEstimatedLine(it)) && (
                  <div style={{ marginTop: 8, padding: "8px 10px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8 }}>
                    <div style={{ fontSize: 11.5, color: "#92400E", fontWeight: 700 }}>Quantities are ESTIMATED — prices agreed, kilos to be confirmed by the producer's packing result. Transport can be booked on these figures (v6.95.0, PO-10).</div>
                    <button onClick={onPackingResult} style={{ marginTop: 6, padding: "4px 10px", borderRadius: 6, border: "none", background: "#B45309", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>📦 Enter packing result → quantities final</button>
                  </div>
                )}
                {/* v6.99.36 (A-R25-6, owner): the supplier truck moved OUT of Linked documents — it has its own box under the line items */}
                {typeof onReceiveLot === "function" && (expectedLots || []).length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 10.5, color: "#92400E", fontWeight: 700 }}>Expected · direct receipt:</span>
                    {expectedLots.map((l: any) => (
                      <button key={String(l.id)} onClick={() => onReceiveLot(l)} title="DDP / supplier-delivered arrival with no shipment of ours — posts the receipt movement" style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#16A34A", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>📥 Receive {l.number} ({Math.round(parseFloat(l.expectedKg) || 0).toLocaleString("pl-PL")} kg)</button>
                    ))}
                  </div>
                )}
                {/* v6.63.0 (BUG #2 fix): invoices are DERIVED from the register via its links[]
                    — the stored legacy array was never updated by the Invoices module, so a
                    cost invoice linked to this PO was invisible here. */}
                <LinkRow label="Invoices" items={computedInvoices ?? order.linkedInvoices} color="#16A34A" bg="#DCFCE7" />
                <div style={{ marginTop: 10, fontSize: 10.5, color: "#AAA", lineHeight: 1.5, fontStyle: "italic" }}>
                  Links are computed live: sales orders that source from this PO, shipments that carry it, and lots created from it.
                </div>
              </Card>

              {/* v6.45.0: LINKED DOCUMENTS moved under Line items (user request) + renamed for consistency */}
              {/* v6.99.36 (A-R25-6): SUPPLIER'S TRUCK — its own box under the lines, showing what was registered */}
              {["DDP", "DAP", "DPU"].includes(String(order.buyIncoterm || "").toUpperCase()) && order.status !== "Draft" && (() => {
                const trucks = supplierTrucks || [];   // v6.99.42 (hotfix): was filtering a list of NUMBERS for .arrangedBy — never matched, the box always read empty
                return (
                  <Card style={{ marginBottom: 16, borderLeft: "4px solid #0F766E" }}>
                    <SectionTitle right={typeof onRegisterTruck === "function" ? <button onClick={onRegisterTruck} style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid #0F766E", background: "#F0FDFA", color: "#0F766E", fontSize: 11.5, fontWeight: 800, cursor: "pointer" }}>🚚 {trucks.length ? "Register another truck" : "Register supplier's truck"}</button> : null}>SUPPLIER'S TRUCK <span style={{ fontWeight: 500, textTransform: "none", color: "#94A3B8" }}>— the supplier delivers ({order.buyIncoterm}); we track the movement, the freight is theirs</span></SectionTitle>
                    {!trucks.length && <div style={{ fontSize: 12, color: "#94A3B8" }}>No truck registered yet. Register it when the supplier announces the plates and the ETA.</div>}
                    {trucks.map((s: any) => { const u = (s.legs || []).flatMap((l: any) => l.vehicles || [])[0] || {}; return (
                      <div key={s.number} style={{ borderTop: "1px solid #F1F5F9", padding: "8px 0" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1fr 1fr 1fr 1fr auto", gap: 8, fontSize: 12, alignItems: "center" }}>
                          <div><b>{s.number}</b></div>
                          <div><span style={{ color: "#94A3B8", fontSize: 10.5 }}>truck </span><b>{u.truckPlate || "—"}</b>{u.trailerPlate ? <span style={{ color: "#64748B" }}> / {u.trailerPlate}</span> : null}</div>
                          <div>{s.supplierRef || u.supplierRef ? <span style={{ background: "#1D4ED8", color: "#fff", padding: "1px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{s.supplierRef || u.supplierRef}</span> : <span style={{ color: "#94A3B8" }}>no supplier ref</span>}</div>
                          <div><span style={{ color: "#94A3B8", fontSize: 10.5 }}>ETA </span>{u.eta || u.plannedDeliveryDate || s.expectedDeliveryDate || "—"}</div>
                          <div><span style={{ color: "#94A3B8", fontSize: 10.5 }}>recorder </span>{u.tempRecorderNo || "—"}</div>
                          <div style={{ fontWeight: 700, color: s.status === "Delivered" ? "#16A34A" : "#B45309" }}>{s.status}</div>
                          <div>{typeof onOpenShipment === "function" && <SmallButton onClick={() => onOpenShipment(s.number)}>Open</SmallButton>}</div>
                        </div>
                        <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>
                          {u.driverName ? `driver ${u.driverName}${u.driverPhone ? " · " + u.driverPhone : ""} · ` : ""}
                          {(s.goods || []).length ? `carrying ${(s.goods || []).map((g: any) => `${g.lotRef || g.product} ${Math.round(Number(g.qtyKg) || 0).toLocaleString("pl-PL")} kg`).join(", ")}` : ""}
                          {s.notes ? ` · ${s.notes}` : ""}
                        </div>
                      </div>
                    ); })}
                  </Card>
                );
              })()}

              {order.notes && (
                <Card style={{ marginBottom: 16 }}>
                  <SectionTitle>NOTES</SectionTitle>
                  <div style={{ fontSize: 12.5, color: "#444", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{order.notes}</div>
                </Card>
              )}
            </div>

            {/* Right column */}
            <div>
              {/* Supplier */}
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle>SUPPLIER</SectionTitle>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 4 }}>{order.supplier?.name}</div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>{order.supplier?.country}</div>
                {order.supplier?.nip && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, color: "#888" }}>NIP / VAT</div><div style={{ fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace" }}>{order.supplier.nip}</div></div>}
                {liveParty(order.supplier, CONTACTS_REF || [])?.address && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, color: "#888" }}>Address</div><div style={{ fontSize: 12, color: "#444" }}>{formatAddress(addressOf(liveParty(order.supplier, CONTACTS_REF || [])), { oneLine: true }) || liveParty(order.supplier, CONTACTS_REF || [])?.address}</div></div>}
                {order.supplier?.contact && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, color: "#888" }}>Contact</div><div style={{ fontSize: 12, color: "#444" }}>{order.supplier.contact}</div></div>}
                {order.supplier?.email && <div><div style={{ fontSize: 10, color: "#888" }}>Email</div><a href={`mailto:${order.supplier.email}`} style={{ fontSize: 12, color: "#2563EB", textDecoration: "none" }}>{order.supplier.email}</a></div>}
              </Card>

              {/* Dates + payment */}
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle>ORDER DETAILS</SectionTitle>{/* v6.99.76 (A-PV-1, owner): was TERMS */}
                <div style={{ display: "grid", gap: 10, fontSize: 12 }}>
                  <div><div style={{ fontSize: 10, color: "#888" }}>ORDER DATE</div><div style={{ fontWeight: 500 }}>{fmtDate(order.orderDate)}</div></div>
                  <div title="When the supplier loads our truck/container — goods leave origin"><div style={{ fontSize: 10, color: "#888" }}>LOADING DATE <span style={{ color: "#BBB", fontWeight: 400 }}>· goods leave origin</span></div><div style={{ fontWeight: 500 }}>{fmtDate(order.loadingDate)}</div></div>
                  <div title="When goods are expected to arrive at the destination"><div style={{ fontSize: 10, color: "#888" }}>EXPECTED DELIVERY DATE <span style={{ color: "#BBB", fontWeight: 400 }}>· goods arrive</span></div><div style={{ fontWeight: 500 }}>{fmtDate(order.expectedDeliveryDate)}</div></div>
                  <div><div style={{ fontSize: 10, color: "#888" }}>PURCHASE INCOTERM</div><div style={{ fontWeight: 600 }}>{order.buyIncoterm || "—"}</div></div>
                  <div><div style={{ fontSize: 10, color: "#888" }}>DESTINATION</div><div style={{ fontWeight: 500 }}>{destLabel}</div></div>
                  <div>
                    <div style={{ fontSize: 10, color: "#888" }}>SEA FREIGHT</div>
<div style={{ fontWeight: 600, color: "#888" }}>—</div>
                  </div>
                  <div><div style={{ fontSize: 10, color: "#888" }}>PAYMENT</div><div style={{ fontWeight: 500 }}>{paymentText(order, liveParty(order.supplier, CONTACTS_REF || []) || order.supplier)}</div></div>
                  <div><div style={{ fontSize: 10, color: "#888" }}>FX RATE</div><div style={{ fontWeight: 500, fontFamily: "ui-monospace, Menlo, monospace" }}>{order.fxRate} {order.currency} → PLN {order.fxLockedAt && <span style={{ fontSize: 10, color: "#AAA", fontFamily: "inherit" }}>(locked {order.fxLockedAt})</span>}</div></div>
                </div>
              </Card>

              {/* Variance (when arrived) */}
              {order.variance && order.variance.receivedKg != null && (
                <Card style={{ marginBottom: 16 }}>
                  <SectionTitle>QUANTITY VARIANCE</SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                    <div><div style={{ fontSize: 10, color: "#888" }}>EXPECTED</div><div style={{ fontSize: 16, fontWeight: 700 }}>{fmtNum(order.variance.expectedKg)} kg</div></div>
                    <div><div style={{ fontSize: 10, color: "#888" }}>RECEIVED</div><div style={{ fontSize: 16, fontWeight: 700 }}>{fmtNum(order.variance.receivedKg)} kg</div></div>
                  </div>
                  {(() => {
                    const delta = order.variance.receivedKg - order.variance.expectedKg;
                    const pct = (delta / order.variance.expectedKg) * 100;
                    if (delta === 0) return <div style={{ fontSize: 12, color: "#16A34A" }}>✓ Quantity matched exactly</div>;
                    return (
                      <div style={{ padding: "10px 12px", background: delta < 0 ? "#FEF3C7" : "#DBEAFE", border: `1px solid ${delta < 0 ? "#FDE68A" : "#BFDBFE"}`, borderRadius: 6, fontSize: 11.5, color: delta < 0 ? "#92400E" : "#1E40AF" }}>
                        <strong>{delta > 0 ? "Surplus" : "Shortfall"}:</strong> {Math.abs(delta).toLocaleString()} kg ({pct.toFixed(2)}%)
                      </div>
                    );
                  })()}
                </Card>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
