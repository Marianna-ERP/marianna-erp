// InventoryWindows.tsx — v6.99.68 (A-AUD-2, owner): moved out of Inventory.tsx unchanged; the module's shared helpers are imported from it.
import LocationPicker from "./LocationPicker";
import QualityReportDoc from "./QualityReportDoc";
import React, { useState } from "react";
import { Lbl, SmallButton, useConfirm } from "./ui";
import { issueReportNumber, lastReportNumber } from "./reportNumbers";
import { localTodayISO } from "./dates";
import { nextId } from "./ids";
import { r0 } from "./format";
import { sortingJob as runSortingJob, gradeSplit, blankInspection, PEPPER_DEFECTS, applyStockCount, gradeCommitmentWarning, inspectionVerdict, tolerancesFromLast, countLinesForLot, countedKgOf, samplePctOf, sortablePools, beforeReceiptWarning, clientReportKg, repostDirectToReport } from "./seasonOps.domain";
import { recordAudit } from "./audit";
import { CountWindow, Inp, InspectionWindow, MOVEMENT_TYPES, Sel, SortingWindow, locType, lotReservations, mergedLocations, num, parseNum, printHtmlNodeInv, qhDelete, qhEdit, qhPrint, supplierRefOf, today } from "./Inventory";

// ─── MOVEMENT MODAL ─────────────────────────────────────────────────────────
export function MovementModal({ lot, liveSOs = [], editing = null, initialMode = "movement", contacts = [], allLots = [], shipments = [], onCancel, onConfirm }: any) {
  const moveLocs = mergedLocations(contacts);
  // Default to TRANSFER for in-stock lots; IN for Expected/Direct Expected lots
  // (v6.3.0 fix — "Direct Expected" previously fell through to TRANSFER whose max
  // was 0 kg, making every quantity error out). In edit mode, prefill.
  // v6.11 (#11) / v6.13 (#14): two modes — "movement" (IN / Transfer / Ship Out)
  // and "quality" (Damage / Reclassify). The mode is fixed by which button opened
  // the modal (Record movement vs the red Record quality issue), so there is no
  // in-modal tab toggle anymore.
  const QUALITY_TYPES = ["DAMAGE", "RECLASS", "CLAIM"];
  // v6.35.4: manual movement is TRANSFER ONLY (relocation between our locations).
  // Receipts (IN) and dispatches (SHIP_OUT) are driven by Shipments — arrival posts the
  // receipt automatically, and an EXW client-collection posts the ship-out via its
  // collection shipment. This removes the manual receipt/dispatch that let a lot's state
  // drift from its shipment (T-20). Quality corrections stay in the separate quality mode.
  const MOVEMENT_MODE_TYPES = ["TRANSFER"]; // v6.99.28 (owner): DAMAGE is owned by the QUALITY INSPECTION (and the sorting job / stock count) — a manual movement moves goods, it never judges them. Legacy damage rows stay visible and voidable in the history. // v6.96.0 (IN-1, owner money rule): by hand only cost-free transfers and damage/corrections — receipts, ship-outs and reversals are shipment postings
  const mode: "movement" | "quality" = editing ? (QUALITY_TYPES.includes(editing.type) ? "quality" : "movement") : (initialMode === "quality" ? "quality" : "movement");
  const [type, setType] = useState(editing?.type || (mode === "quality" ? "DAMAGE" : "TRANSFER"));
  // v6.13 (#15): where the quality problem was detected along the journey.
  const QUALITY_DETECTED_AT = ["At port of discharge", "At the client (export delivery)", "At our warehouse (on arrival)", "At the client's warehouse (direct delivery)", "At supplier / origin", "Other"];
  const [detectedAt, setDetectedAt] = useState(editing?.detectedAt || QUALITY_DETECTED_AT[0]);
  const [qty, setQty] = useState(editing ? String(editing.qtyKg ?? "") : "");
  const [fromId, setFromId] = useState(editing?.fromId ?? lot.locationId);
  const [toId, setToId] = useState(editing?.toId ?? lot.locationId);
  const [note, setNote] = useState(editing?.note || "");
  const [soRef, setSoRef] = useState(editing?.soRef || "");
  const [date, setDate] = useState(editing?.date || today);
  // v6.18.10 (#5): a quality issue detected AT THE CLIENT (after we shipped) is a
  // client claim, not a warehouse write-off — it leaves our stock alone and drives a
  // credit note. "Detected at" decides which path runs.
  const CLIENT_SIDE_DETECTION = ["At the client (export delivery)", "At the client's warehouse (direct delivery)"];
  const clientSide = mode === "quality" && CLIENT_SIDE_DETECTION.includes(detectedAt);
  const lotShipSoRefs = Array.from(new Set((lot.movements || []).filter((m: any) => m.type === "SHIP_OUT" && m.soRef).map((m: any) => m.soRef)));
  const clientSORefs = (lotShipSoRefs.length ? lotShipSoRefs : (liveSOs || []).map((o: any) => o.number)).filter(Boolean);
  const [claimSoRef, setClaimSoRef] = useState(editing?.soRef || lotShipSoRefs[0] || "");
  const [claimValue, setClaimValue] = useState(editing?.claimValue != null ? String(editing.claimValue) : "");
  const [claimCurrency, setClaimCurrency] = useState(editing?.claimCurrency || "PLN");
  const effectiveType = clientSide && type === "DAMAGE" ? "CLAIM" : type;
  const reservationState = lotReservations(lot, liveSOs, { lots: allLots, shipments });
  // Direct-flow lots never physically enter our warehouse (physicalKg stays 0),
  // so quantity-reducing movements validate against the expected/direct quantity —
  // consistent with how lotReservations computes availability for direct lots.
  const isDirect = !!lot.directFlow || lot.status === "Direct Expected";
  const physicalBasis = isDirect
    ? Math.max(parseNum(lot.expectedKg), lot.physicalKg || 0)
    : (lot.physicalKg || 0);
  // In edit mode the max should add back this movement's own effect so it isn't
  // double-counted against itself.
  const selfQty = editing && (editing.type === type) ? parseNum(editing.qtyKg) : 0;
  const maxByType = {
    IN:       Infinity,
    TRANSFER: physicalBasis + selfQty,
    // v6.11 (#8): a Ship Out is the *physical* dispatch — for an EXW sale the lot is
    // already reserved/sold (liveAvailable = 0), which used to block it. Cap by the
    // physical (or expected, for direct flows) quantity instead of the reserved-net.
    SHIP_OUT: physicalBasis + selfQty,
    DAMAGE:   physicalBasis + selfQty,
    RECLASS:  physicalBasis + selfQty,
    CLAIM:    (parseNum(lot.receivedKg) || physicalBasis) + selfQty, // can't claim more than was ever received
  };
  const max = maxByType[effectiveType] ?? Infinity;
  const qtyNum = parseFloat(qty) || 0;
  const isInvalid = qtyNum <= 0 || qtyNum > max || (clientSide && !(parseFloat(claimValue) > 0));
  const typeInfo = MOVEMENT_TYPES[type] || {};
  const showRoute = type === "TRANSFER" || type === "IN" || type === "SHIP_OUT";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, padding: "24px 16px", overflowY: "auto" }}>
      <div style={{ background: "#fff", borderRadius: 14, width: 540, maxWidth: "100%", maxHeight: "calc(100vh - 48px)", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", margin: "auto" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #EBEBEB" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{editing ? (mode === "quality" ? "Edit quality issue" : "Edit movement") : (mode === "quality" ? "Record quality issue" : "Record movement")}</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{lot.number} · {lot.product}{lot.variety ? " — " + lot.variety : ""} · received {(lot.receivedKg || 0).toLocaleString()} kg, physical {(lot.physicalKg || 0).toLocaleString()} kg</div>
        </div>
        <div style={{ padding: 24 }}>
          {mode === "movement" ? (
            <div style={{ padding: "10px 12px", background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 8, fontSize: 11, color: "#92400E", lineHeight: 1.5, marginBottom: 16 }}>
              <strong>Manual movement relocates stock between your own locations</strong> (e.g. port → warehouse, warehouse → warehouse). Everything else is automatic: a shipment posts the <strong>receipt</strong> when it arrives and the <strong>ship-out</strong> when it delivers — with transport, cost and paperwork linked to the lot. To receive or dispatch goods, use <strong>Shipments</strong>, not a manual movement. (Quality issues and write-offs are recorded via <em>Record quality issue</em>.)
            </div>
          ) : clientSide ? (
            <div style={{ padding: "10px 12px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, fontSize: 11, color: "#1E40AF", lineHeight: 1.5, marginBottom: 16 }}>
              <strong>Client claim (goods already shipped).</strong> Because this defect was found at the client after delivery, it will <strong>not</strong> change your warehouse stock — those kg already left. Recording it logs a client claim against the delivery and creates a <strong>draft credit note</strong> to the client for the value below, which you can finalise in Invoices.
            </div>
          ) : (
            <div style={{ padding: "10px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, fontSize: 11, color: "#991B1B", lineHeight: 1.5, marginBottom: 16 }}>
              <strong>Quality issue (goods in our hands).</strong> <strong>Damage</strong> writes off rejected kg (reduces stock on hand), and <strong>Reclassify</strong> changes the quality grade (e.g. Kl. I → Kl. II) with no quantity change. If the defect is reported by the client after you shipped, change "Detected at" to a client location — it becomes a claim that won't touch your stock.
            </div>
          )}

          <div style={{ marginBottom: 4 }}><Lbl>{mode === "quality" ? "Quality issue type" : "Movement type"}</Lbl>
            <Sel value={type} onChange={e => setType(e.target.value)}>
              {Object.entries(MOVEMENT_TYPES).filter(([k]) => k !== "REVERSAL" && (mode === "quality" ? QUALITY_TYPES.includes(k) : MOVEMENT_MODE_TYPES.includes(k))).map(([k, v]: any) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </Sel>
          </div>
          {/* Live plain-language description of the selected type */}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#F8FAFC", border: "1px solid #EEF2F7", borderRadius: 8, padding: "8px 10px", marginBottom: 14 }}>
            <span style={{ color: typeInfo.color, fontWeight: 800, fontSize: 14, lineHeight: 1 }}>{typeInfo.icon}</span>
            <span style={{ fontSize: 11, color: "#475569", lineHeight: 1.4 }}>{typeInfo.desc}{type === "IN" ? " — increases stock on hand." : type === "TRANSFER" ? " — same quantity, new location." : type === "SHIP_OUT" ? " — reduces stock on hand. Use for an EXW sale where the client collects with their own truck (no transport on our side)." : type === "DAMAGE" ? " — reduces stock on hand and records a write-off." : type === "RECLASS" ? " — no quantity change." : ""}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <Lbl>Quantity (kg) <span style={{ color: "#AAA", fontWeight: 400 }}>· max {max === Infinity ? "∞" : max.toLocaleString()}</span></Lbl>
              <Inp value={qty} onChange={e => setQty(e.target.value)} type="number" placeholder="0" />
            </div>
            <div>
              <Lbl>Date</Lbl>
              <Inp value={date} onChange={e => setDate(e.target.value)} type="date" noFuture />
            </div>
          </div>

          {clientSide && (
            <div style={{ marginBottom: 12, padding: "12px 14px", background: "#F8FAFF", border: "1px solid #DBEAFE", borderRadius: 8 }}>
              <div style={{ marginBottom: 10 }}>
                <Lbl>Delivery / sales order this claim is against</Lbl>
                <Sel value={claimSoRef} onChange={e => setClaimSoRef(e.target.value)}>
                  <option value="">— select the delivery —</option>
                  {clientSORefs.map((r: any) => <option key={r} value={r}>{r}</option>)}
                </Sel>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 12 }}>
                <div>
                  <Lbl>Agreed credit value</Lbl>
                  <Inp value={claimValue} onChange={e => setClaimValue(e.target.value)} type="number" placeholder="0.00" />
                </div>
                <div>
                  <Lbl>Currency</Lbl>
                  <Sel value={claimCurrency} onChange={e => setClaimCurrency(e.target.value)}>{["PLN", "EUR", "USD"].map(c => <option key={c}>{c}</option>)}</Sel>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#64748B", marginTop: 8, lineHeight: 1.4 }}>The {qty || "0"} kg won't be removed from warehouse stock. A draft credit note for this value goes to the client (linked to the sales invoice if one exists); finalise it in Invoices.</div>
            </div>
          )}

          {showRoute && !clientSide && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 24px 1fr", gap: 8, alignItems: "end", marginBottom: 12 }}>
              <div>
                <Lbl>{type === "IN" ? "Received from" : "From"}</Lbl>
                <Sel value={fromId} onChange={e => setFromId(parseInt(e.target.value))}>
                  {moveLocs.map((l: any) => <option key={l.id} value={l.id}>{locType(l.type).icon} {l.name}</option>)}
                </Sel>
              </div>
              <div style={{ textAlign: "center", paddingBottom: 9, color: "#94A3B8", fontSize: 16 }}>→</div>
              <div>
                <Lbl>{type === "SHIP_OUT" ? "Shipped to" : "To"}</Lbl>
                <LocationPicker value={toId ?? ""} contacts={contacts} onChange={(r: any) => setToId(r.id)} placeholder="— destination —" />
              </div>
            </div>
          )}

          {mode === "quality" && (
            <div style={{ marginBottom: 14 }}>
              <Lbl>Where was it detected?</Lbl>
              <Sel value={detectedAt} onChange={e => setDetectedAt(e.target.value)}>
                {QUALITY_DETECTED_AT.map(d => <option key={d}>{d}</option>)}
              </Sel>
              <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4, lineHeight: 1.4 }}>The problem is recorded against this lot, but it's usually found later in the journey — at the port of discharge, on arrival at our warehouse, or at the client.</div>
            </div>
          )}

          {type === "SHIP_OUT" && (
            <div style={{ marginBottom: 14 }}>
              <Lbl>For Sales Order <span style={{ color: "#BBB", fontWeight: 400 }}>(links this dispatch to the SO for correct P/L)</span></Lbl>
              <select value={soRef} onChange={e => setSoRef(e.target.value)} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", background: "#fff" }}>
                <option value="">— none / not linked —</option>
                {(reservationState.reservations || []).map((r: any) => (
                  <option key={r.soNumber} value={r.soNumber}>{r.soNumber}{r.clientName ? ` · ${r.clientName}` : ""} ({r.qty.toLocaleString("pl-PL")} kg)</option>
                ))}
                {/* Also allow any non-cancelled SO that sources this lot, even if not currently reserving */}
                {(liveSOs || [])
                  .filter((o: any) => !(reservationState.reservations || []).some((r: any) => r.soNumber === o.number))
                  .filter((o: any) => (o.items || []).some((it: any) => (it.sourceType === "STOCK" && it.sourceRef === lot.number)))
                  .map((o: any) => <option key={o.number} value={o.number}>{o.number}{o.client?.name ? ` · ${o.client.name}` : ""}</option>)}
              </select>
            </div>
          )}

          <div style={{ marginBottom: 18 }}>
            <Lbl>Note</Lbl>
            <Inp value={note} onChange={e => setNote(e.target.value)} placeholder={mode === "quality" ? "e.g. 2 pallets soft/over-ripe found on arrival at Gdańsk" : "e.g. Reserved for SO-2026-0094 (Biedronka)"} />
          </div>
          {isInvalid && qty && (
            <div style={{ padding: "8px 12px", background: "#FEE2E2", color: "#9A1B1B", fontSize: 12, borderRadius: 6, marginBottom: 12 }}>
              {qtyNum > max ? `Quantity exceeds max (${max.toLocaleString()} kg)` : "Quantity must be greater than zero"}
            </div>
          )}
          {max === 0 && type !== "IN" && (
            <div style={{ padding: "8px 12px", background: "#FEF3C7", border: "1px solid #FDE68A", color: "#92400E", fontSize: 12, borderRadius: 6, marginBottom: 12 }}>
              This lot has <strong>no {type === "SHIP_OUT" ? "available" : "physical"} stock yet</strong>, so a {String(typeInfo.label || type).toLowerCase()} of any quantity is blocked.
              {(lot.physicalKg || 0) === 0 && !isDirect && <> Record a <strong>⊕ Receipt (IN)</strong> first to bring goods into stock, then come back to this movement.</>}
              {type === "SHIP_OUT" && (lot.physicalKg || 0) > 0 && <> All physical stock is currently reserved by confirmed SOs.</>}
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onCancel} style={{ flex: 1, padding: "10px", border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button onClick={() => onConfirm({ id: editing?.id, type: effectiveType, qtyKg: qtyNum, fromId, toId, note, date, soRef: effectiveType === "CLAIM" ? (claimSoRef || null) : (type === "SHIP_OUT" ? (soRef || null) : (editing?.soRef ?? null)), ...(mode === "quality" ? { detectedAt } : {}), ...(effectiveType === "CLAIM" ? { claimValue: parseFloat(claimValue) || 0, claimCurrency } : {}) })} disabled={isInvalid}
              style={{ flex: 1, padding: "10px", border: "none", borderRadius: 8, background: isInvalid ? "#D1D5DB" : "#111", color: "#fff", fontSize: 13, fontWeight: 600, cursor: isInvalid ? "not-allowed" : "pointer" }}>
              {editing ? "Save changes" : (mode === "quality" ? "Record quality issue" : "Record movement")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SeasonActions({ lot, lots = [], setLots = null, inspections = [], setInspections = null, stockCounts = [], setStockCounts = null, recompute, claims = [], settlements = [], orders = [], pos = [], contacts = [], userName = "", shipments: shipmentsRef = [], users = [] }: any) {
  const { confirm: uiConfirm, alert: uiAlert, dialogNode } = useConfirm();   // v7.22.5 (A-RV-17): the app's own windows, not the browser's   // v7.18.5: + users
  // v6.99.19 (A-R14-8): once a claim on this lot is finalised or its truck settlement is closed, the facts behind them are frozen.
  const frozenBy = (() => {
    const cl = (claims || []).find((c: any) => ["Settled", "Accepted", "Closed"].includes(String(c.status)) && ((c.subjects || []).some((s: any) => String(s.ref) === String(lot.number)) || String(c.rootDoc?.number) === String(lot.poRef)));
    if (cl) return `claim ${cl.number} is ${String(cl.status).toLowerCase()}`;
    const st = (settlements || []).find((s: any) => String(s.poNumber) === String(lot.poRef) && s.status === "Closed");
    if (st) return `settlement ${st.number || ""} is closed`.trim();
    return "";
  })();

  const [win, setWin] = React.useState<"" | "inspect" | "sort" | "count">("");
  const [ins, setIns] = React.useState<any>(null);
  const [qrNos, setQrNos] = React.useState<any>({});
  const [sortF, setSortF] = React.useState<any>(null);
  const [countF, setCountF] = React.useState<any>(null);
  const cat = PEPPER_DEFECTS;   // v6.99.33 (owner): the producer's defect list is part of the report definition — nothing to configure
  const myIns = (inspections || []).filter((x: any) => String(x.lotNumber) === String(lot.number)).sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
  const myJobs = (lot.sortingJobs || []).slice().sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
  const myCounts = (stockCounts || []).filter((c: any) => (c.lines || []).some((l: any) => String(l.lotNumber) === String(lot.number))).sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));
  const po = (pos || []).find((p: any) => String(p.number) === String(lot.poRef)) || null;
  const g = gradeSplit(lot);


  // v6.99.33 (owner): a sorting job can be corrected or removed. The ledger is never rewritten: its RECLASS / DAMAGE
  // movements are VOIDED (visible, with a reason) and the job record is dropped; editing then re-posts a fresh job.
  function voidJob(j: any, why: string) {
    const src = `sorting:${j.id}`;
    const next = { ...lot, movements: (lot.movements || []).map((m: any) => String(m.source || "") === src && !m.voided ? { ...m, voided: true, voidReason: `sorting job ${why} on ${localTodayISO()}` } : m), sortingJobs: (lot.sortingJobs || []).filter((x: any) => String(x.id) !== String(j.id)) };
    const healed = recompute(next, next.movements);
    setLots && setLots((prev: any[]) => (prev || []).map((l: any) => l.id === lot.id ? healed : l));
    recordAudit({ module: "Inventory", docType: "Lot", docNumber: lot.number, action: "movement", summary: `Sorting job of ${j.date} ${why} — its movements voided` });
  }
  function openInspection(existing?: any) {
    setIns(existing ? { ...existing } : ((b: any) => ({ ...b, inspector: b.inspector || userName || "" }))(blankInspection(lot, { nextId, todayISO: localTodayISO, po, tolerances: tolerancesFromLast(inspections, lot.product) })));   // v7.18.5: the person signed in
    setWin("inspect");
  }
  function openSorting() {
    const last = myIns[0];
    // v6.99.34 (A-R24-3): start from the pool that still has goods — the unsorted remainder first, never the whole lot again.
    const pools = sortablePools(lot);
    const first = pools.find(x => x.kg > 0) || pools[0];
    setSortF({ date: localTodayISO(), followsInspection: last ? String(last.id) : "", fromPool: first.key, kgIn: first.kg || "", classIKg: "", classIIKg: "", wasteKg: "", by: "", hours: "", note: "" });
    setWin("sort");
  }
  function openCount() {
    // v6.99.34 (A-R24-4): only what the counter types is held in state — the system figures are read from the lot at render,
    // so a sorting or another count in the same session cannot leave the window counting against stale numbers.
    const kgPerBox = num((po?.items || []).find((it: any) => String(it.id) === String(lot.poLineId))?.kgPerBox) || num(lot.kgPerBox) || "";
    setCountF({ date: localTodayISO(), by: userName || "", reason: "", kgPerBox, entries: {} });
    setWin("count");
  }
  React.useEffect(() => { const h = () => openInspection(); window.addEventListener("marianna:open-inspection", h); return () => window.removeEventListener("marianna:open-inspection", h); });

  const bigBtn = (color: string, bg: string, icon: string, title: string, sub: string, onClick: any) => (
    <button onClick={onClick} disabled={!!frozenBy} style={{ flex: "1 1 210px", textAlign: "left", padding: "10px 14px", borderRadius: 10, border: `1px solid ${color}`, background: frozenBy ? "#F3F4F6" : bg, cursor: frozenBy ? "not-allowed" : "pointer" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color }}>{icon} {title}</div>
      <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>{sub}</div>
    </button>
  );

  return (
    <div style={{ background: "#fff", border: "2px solid #0E7490", borderRadius: 12, marginBottom: 16, overflow: "hidden" }}>{dialogNode}
      <div style={{ background: "#ECFEFF", borderBottom: "1px solid #A5F3FC", padding: "8px 16px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#0E7490", letterSpacing: "0.04em" }}>QUALITY &amp; HANDLING</div>
        <div style={{ fontSize: 11, color: "#0F766E" }}>class I {g.I.toLocaleString("pl-PL")} kg · class II {g.II.toLocaleString("pl-PL")} kg · waste {g.waste.toLocaleString("pl-PL")} kg</div>
      </div>
      <div style={{ padding: "12px 16px" }}>
        {frozenBy && <div style={{ fontSize: 11, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 7, padding: "6px 9px", marginBottom: 10 }}>🔒 Locked — {frozenBy}. Correct by voiding a movement in the history, or by re-opening the settlement.</div>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          {bigBtn("#0E7490", "#F0FDFA", "🔬", "Quality inspection", "check the goods and judge them", () => openInspection())}
          {bigBtn("#7C3AED", "#F5F3FF", "⚖", "Sorting job", "split what the inspection said to sort", openSorting)}
          {bigBtn("#B45309", "#FFFBEB", "📋", "Stock count", "verify what is physically there", openCount)}
        </div>

        {/* the timeline — one line per act, newest first */}
        {!myIns.length && !myJobs.length && !myCounts.length && <div style={{ fontSize: 12, color: "#94A3B8" }}>Nothing recorded yet — inspect the goods before sorting.</div>}
        {myIns.map((x: any) => { const v = inspectionVerdict(x); return (
          <div key={String(x.id)} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, padding: "5px 0", borderTop: "1px solid #F1F5F9", flexWrap: "wrap" }}>
            <span style={{ width: 20 }}>🔬</span>
            <b style={{ fontFamily: "inherit", fontVariantNumeric: "tabular-nums" }}>{x.number || qrNos[String(x.id)] || lastReportNumber("QR", String(x.id)) || "—"}</b>
            <span>{x.date} · {x.stage} · {x.inspector || "—"}</span>
            <span>checked {num(x.checkedQty).toLocaleString("pl-PL")} {x.unit || "kg"} ({samplePctOf(x)} %)</span>
            <span>defects <b>{v.totalPct} %</b></span>
            <span style={{ fontWeight: 800, color: v.acceptable ? "#16A34A" : "#DC2626" }}>{v.acceptable ? "Acceptable" : "Not acceptable"}</span>
            <span style={{ color: "#64748B" }}>· {x.verdict}</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {!frozenBy && <button onClick={() => openInspection(x)} style={qhEdit}>Edit</button>}
              <button style={qhPrint} onClick={() => { const no = x.number || lastReportNumber("QR", String(x.id)) || issueReportNumber("QR", `${lot.number} · inspection ${x.date}`, userName, "Inventory"); setQrNos((m: any) => ({ ...m, [String(x.id)]: no })); setTimeout(() => printHtmlNodeInv(`insp-print-${x.id}`, `${no}-${lot.number}`), 60); }}>⎙ Print</button>
              {!frozenBy && setInspections && <button style={qhDelete} onClick={async () => { if (!(await uiConfirm({ title: "Please confirm", message: `Delete the inspection of ${x.date}?` }))) return; setInspections((prev: any[]) => (prev || []).map((p: any) => String(p.id) === String(x.id) ? { ...p, status: "Cancelled", cancelledAt: localTodayISO() } : p))   /* v6.99.126 (AUD-44): kept, struck through */; recordAudit({ module: "Inventory", docType: "Lot", docNumber: lot.number, action: "deleted", summary: `Inspection ${x.date} deleted` }); }}>🗑 Delete</button>}
            </span>
            <QualityReportDoc x={x} lot={lot} no={x.number || qrNos[String(x.id)] || lastReportNumber("QR", String(x.id))} supplierRef={supplierRefOf(lot, shipmentsRef)} />
          </div>
        ); })}
        {myJobs.map((j: any) => (
          <div key={String(j.id)} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, padding: "5px 0", borderTop: "1px solid #F1F5F9", flexWrap: "wrap" }}>
            <span style={{ width: 20 }}>⚖</span><span>{j.date}</span>
            <span>sorted <b>{Math.round(num(j.kgIn)).toLocaleString("pl-PL")} kg</b> → I {Math.round(num(j.classIKg)).toLocaleString("pl-PL")} · II {Math.round(num(j.classIIKg)).toLocaleString("pl-PL")} · waste {Math.round(num(j.wasteKg)).toLocaleString("pl-PL")}</span>
            {j.by ? <span>· {j.by}</span> : null}{j.hours ? <span>· {j.hours} h</span> : null}
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {!frozenBy && <button style={qhEdit} onClick={() => { voidJob(j, "corrected"); setSortF({ date: j.date, followsInspection: j.followsInspection || "", kgIn: j.kgIn, classIKg: j.classIKg, classIIKg: j.classIIKg, wasteKg: j.wasteKg, by: j.by || "", hours: j.hours || "", note: j.note || "" }); setWin("sort"); }}>Edit</button>}
              {!frozenBy && <button style={qhDelete} onClick={async () => { if (!(await uiConfirm({ title: "Please confirm", message: `Delete the sorting job of ${j.date}? Its RECLASS and DAMAGE movements are voided (they stay visible in the history).` }))) return; voidJob(j, "deleted"); }}>🗑 Delete</button>}
            </span>
          </div>
        ))}
        {myCounts.map((c: any) => { const mine = (c.lines || []).filter((l: any) => String(l.lotNumber) === String(lot.number)); return (
          <div key={String(c.id)} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, padding: "5px 0", borderTop: "1px solid #F1F5F9", flexWrap: "wrap" }}>
            <span style={{ width: 20 }}>📋</span><span>{c.date} count</span>
            {mine.map((l: any, k: number) => <span key={k}>{l.grade ? `class ${l.grade}: ` : ""}counted {Math.round(num(l.countedKg)).toLocaleString("pl-PL")} vs system {Math.round(num(l.systemKg)).toLocaleString("pl-PL")} → <b style={{ color: num(l.diffKg) ? "#B45309" : "#16A34A" }}>{num(l.diffKg) >= 0 ? "+" : ""}{Math.round(num(l.diffKg))} kg</b></span>)}
            {c.by ? <span>· {c.by}</span> : null}
          </div>
        ); })}
      </div>

      {win === "inspect" && ins && (
        <InspectionWindow users={users} ins={ins} setIns={setIns} lot={lot} cat={cat} onClose={() => setWin("")} onSave={async (final0: any) => {
          const w = beforeReceiptWarning(lot, final0.date); if (w) { (await uiAlert({ message: "⚠ " + w })); return; }
          // v6.99.101 (A-QC-5, owner 2 Oct — one source): the report's number is issued when it is SAVED and stored on it; prints read it from there
          const final = { ...final0, number: final0.number || lastReportNumber("QR", String(final0.id)) || issueReportNumber("QR", `${lot.number} · inspection ${final0.date}`, userName, "Inventory") };
          setInspections && setInspections((prev: any[]) => (prev || []).some((p: any) => String(p.id) === String(final.id)) ? (prev || []).map((p: any) => String(p.id) === String(final.id) ? final : p) : [...(prev || []), final]);
          recordAudit({ module: "Inventory", docType: "Lot", docNumber: lot.number, action: "movement", summary: `Quality inspection ${final.date} · defects ${inspectionVerdict(final).totalPct}% · ${final.verdict}` });
          // v6.99.87 (A-QC-4): a direct lot already delivered takes the client's report's kilos — its pass-through pair is re-posted
          { const kg = clientReportKg(lot.number, [final], lot); const direct = !!lot.directFlow || lot.custodyType === "Direct" || /direct/i.test(String(lot.status || ""));
            if (kg && direct && setLots) { const next = repostDirectToReport(lot, kg); if (next !== lot) { setLots((prev: any[]) => (prev || []).map((l: any) => l.id === lot.id ? recompute(next, next.movements) : l)); recordAudit({ module: "Inventory", docType: "Lot", docNumber: lot.number, action: "movement", summary: `Delivered kilos re-posted to the client's QC report: ${Math.round(kg).toLocaleString("pl-PL")} kg` }); } } }
          setWin("");
        }} />
      )}
      {win === "sort" && sortF && (
        <SortingWindow f={sortF} setF={setSortF} lot={lot} inspections={myIns} contacts={contacts} onClose={() => setWin("")} onSave={async () => {
          const w = beforeReceiptWarning(lot, sortF.date); if (w) { (await uiAlert({ message: "⚠ " + w })); return; }
          const r = runSortingJob(lot, { ...sortF, fromPool: sortF.fromPool || "UNSORTED", date: sortF.date || localTodayISO() }, { nextId });
          if (r.error) { (await uiAlert({ message: r.error })); return; }
          const healed = recompute(r.lot, r.lot.movements);
          setLots && setLots((prev: any[]) => (prev || []).map((l: any) => l.id === lot.id ? healed : l));
          recordAudit({ module: "Inventory", docType: "Lot", docNumber: lot.number, action: "movement", summary: `Sorting job: I ${sortF.classIKg} · II ${sortF.classIIKg} · waste ${sortF.wasteKg} kg` });
          const warn = gradeCommitmentWarning(healed, orders || []); if (warn) (await uiAlert({ message: "⚠ " + warn }));
          setWin("");
        }} />
      )}
      {win === "count" && countF && (
        <CountWindow users={users} f={countF} setF={setCountF} lot={lot} onClose={() => setWin("")} onSave={async () => {
          const w = beforeReceiptWarning(lot, countF.date); if (w) { (await uiAlert({ message: "⚠ " + w })); return; }
          const lines = countLinesForLot(lot).filter((r: any) => !r.informational).map((r: any) => { const e = { ...(countF.entries || {})[r.grade || "-"], kgPerBox: countF.kgPerBox }; const counted = countedKgOf(e as any);
            return { lotNumber: lot.number, grade: r.grade, countedKg: counted, systemKg: r.systemKg, diffKg: r0(counted - num(r.systemKg)), pallets: (e as any).pallets, boxesPerPallet: (e as any).boxesPerPallet, looseBoxes: (e as any).looseBoxes }; });
          const count = { id: nextId(), date: countF.date || localTodayISO(), locationId: lot.locationId, by: countF.by || userName || "", lines };
          const res = applyStockCount(lots || [], count as any, countF.reason || "stock count", { nextId });
          setLots && setLots((prev: any[]) => (prev || []).map((l: any) => { const hit = (res.lots || []).find((x: any) => x.id === l.id); return hit ? recompute(hit, hit.movements) : l; }));
          setStockCounts && setStockCounts((prev: any[]) => [...(prev || []), count]);
          recordAudit({ module: "Inventory", docType: "Lot", docNumber: lot.number, action: "movement", summary: `Stock count ${count.date}: ${lines.map((l: any) => `${l.grade ? "class " + l.grade + " " : ""}${l.diffKg >= 0 ? "+" : ""}${l.diffKg} kg`).join(" · ")}` });
          setWin("");
        }} />
      )}
    </div>
  );
}

// ─── v6.99.86 (owner 1 Oct): receiving a supplier-delivered lot — the date is the truck's, not today's ─────────────────
// Was a bare prompt for the kilos, posting the receipt on TODAY's date; LOT-2026-0127/0128 arrived on 14–15 June and
// were booked in on 1 October. Now: kilos, the date proposed from the truck (actual unloading → planned delivery →
// the PO's expected delivery), the place the stock goes to, and a note.
export function ReceiveLotModal({ lot, suggested, locationName = "", onCancel, onConfirm }: any) {
  const [kg, setKg] = useState(String(Math.round(parseFloat(String(lot?.expectedKg)) || 0)));
  const [date, setDate] = useState(suggested?.date || localTodayISO());
  const [note, setNote] = useState("");
  const n = parseFloat(String(kg).replace(",", ".")) || 0; const exp = parseFloat(String(lot?.expectedKg)) || 0;
  const inp: any = { border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, width: "100%", boxSizing: "border-box" };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: 460, maxWidth: "94vw", boxShadow: "0 24px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #EBEBEB" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>Receive {lot?.number}</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{lot?.product}{lot?.variety ? " — " + lot.variety : ""} · delivered by the supplier, no shipment of ours</div>
        </div>
        <div style={{ padding: 22, display: "grid", gap: 12 }}>
          <div><Lbl>Kilos actually received <span style={{ color: "#BBB", fontWeight: 400 }}>· expected {Math.round(exp).toLocaleString("pl-PL")} kg</span></Lbl><input type="number" value={kg} onChange={e => setKg(e.target.value)} style={inp} autoFocus />
            {exp > 0 && n > 0 && Math.abs(n - exp) >= 1 && <div style={{ fontSize: 11, color: n < exp ? "#B45309" : "#0F766E", marginTop: 3, fontWeight: 600 }}>{n < exp ? "short" : "over"} by {Math.round(Math.abs(n - exp)).toLocaleString("pl-PL")} kg — recorded on the receipt</div>}</div>
          <div><Lbl>Arrival date <span style={{ color: "#BBB", fontWeight: 400 }}>· from {suggested?.from || "today"}</span></Lbl><input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} /></div>
          <div><Lbl>Into</Lbl><div style={{ ...inp, background: "#F8FAFC", color: "#334155" }}>{locationName || "the lot's location"}</div></div>
          <div><Lbl>Note</Lbl><input value={note} onChange={e => setNote(e.target.value)} placeholder="optional" style={inp} /></div>
        </div>
        <div style={{ padding: "12px 22px", borderTop: "1px solid #EBEBEB", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <SmallButton onClick={onCancel}>Cancel</SmallButton>
          <SmallButton kind="confirm" disabled={!(n > 0) || !date} onClick={() => onConfirm({ kg: n, date, note })}>Receive {n > 0 ? Math.round(n).toLocaleString("pl-PL") + " kg" : ""}</SmallButton>
        </div>
      </div>
    </div>
  );
}
