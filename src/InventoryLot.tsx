// InventoryLot.tsx — v6.99.68 (A-AUD-2, owner): moved out of Inventory.tsx unchanged; the module's shared helpers are imported from it.
import { lotValue } from "./lotView.domain";   // v6.99.81 (A-IN)
import React, { useState } from "react";
import { Card, ActionButton, DocLink } from "./ui";
import { PAGE_MAX } from "./ui";
import { PrintLogo } from "./brand";
import { buildTraceTree } from "./trace.domain";
import { computeLotWarehouseCharges } from "./warehouseCharges";
import { customsSummary } from "./customs.domain";
import { fmtNum } from "./format";
import { issueReportNumber } from "./reportNumbers";
import { localTodayISO, formatDMY } from "./dates";
import { gradeSplit, inspectionTotals } from "./seasonOps.domain";
import { INSPECTION_CONTEXTS, INSPECTION_OUTCOMES, LocationPill, LotDirectionBadge, LotWorkbench, MOVEMENT_TYPES, QualityBadge, SectionTitle, StatusBadge, VarianceBadge, costPerKg, customsStagesForLot, fmtMoney, journeyForLot, locById, lotReservations, num, printHtmlNodeInv, soRefsFor, standardStageLabel } from "./Inventory";
import { SeasonActions } from "./InventoryWindows";

export function LotDetail({ lot, pos = [], onBack, onMove, onQualityIssue, onEditMovement, onDeleteMovement, onVoidMovement, onDelete, onInspect, onReturn, liveSOs, shipments, allLots = [], contacts = [], onRecordSorting, onOpenSettlement, onOpenClaim = null, onDirectReceive = null, tracePOs = [], traceInvoices = [], lotClaims = [], season = null , userName = "" }: any) {
  // v6.99.30 (A-R21-3, owner): a recall document must be identifiable afterwards — it carries its own number,
  // minted when it is issued and written to the audit trail with the lot and the person who ran it.
  const [traceNo, setTraceNo] = useState<string>("");
  const seasonInspections = season?.inspections || [];   // v6.99.17 (A-R13-9): ONE inspections store — the legacy card reads it too
  const res = lotReservations(lot, liveSOs, { lots: allLots, shipments });
  const cpk = costPerKg(lot);
  const variance = (lot.receivedKg || 0) - (lot.expectedKg || 0);
  const shippedOutKg = Math.max(0, (lot.receivedKg || 0) - (lot.physicalKg || 0) - (lot.damagedKg || 0) - (lot.wasteKg || 0));   // v6.99.34 (A-R24-1)

  // Qty stripe segments — show the lifecycle of the receivedKg
  const segments = [
    { key: "Available",   kg: res.liveAvailable,   color: "#16A34A" },
    { key: "Reserved",    kg: res.totalReserved,   color: "#7C3AED" },
    { key: "Shipped out", kg: shippedOutKg,        color: "#2563EB" },
    { key: "Damaged",     kg: lot.damagedKg || 0,  color: "#DC2626" },
    { key: "Waste (sorting)", kg: lot.wasteKg || 0, color: "#6B7280" },
  ].filter(s => s.kg > 0);
  const totalKg = segments.reduce((s, x) => s + x.kg, 0);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#2563EB", fontWeight: 500 }}>← Inventory</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <button onClick={onMove} title="v6.99.28: cost-free transfers only — damage belongs to the quality inspection" style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #7DD3FC", background: "#E0F2FE", color: "#0369A1", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Record movement</button>
          {/* v6.99.30 (A-R21-1, owner): the header's "Report quality issue" is gone — quality has ONE entry, the Quality inspection in Season actions */}
          {(lot.movements || []).some((m: any) => m.type === "SHIP_OUT") && (
            <button onClick={onReturn} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #7C3AED", background: "#fff", color: "#7C3AED", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>↩ Return to warehouse</button>
          )}
          {/* v6.99.28 (owner): only a purchase the SUPPLIER delivers (DDP / DAP / DPU) is received here — every other lot arrives through its shipment */}
          {typeof onDirectReceive === "function" && (lot.status === "Expected" || lot.status === "Direct Expected") && !(lot.movements || []).some((m: any) => !m.voided) && ["DDP", "DAP", "DPU"].includes(String((pos || []).find((x: any) => String(x.number) === String(lot.poRef))?.buyIncoterm || "").toUpperCase()) && (
            <button onClick={onDirectReceive} title="For DDP / direct arrivals with no shipment of ours: posts the receipt movement so the stock becomes available." style={{ padding: "5px 14px", borderRadius: 7, border: "none", background: "#16A34A", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>📥 Receive into stock (direct/DDP)</button>
          )}
          <ActionButton action="delete" onClick={onDelete} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
        <div style={{ maxWidth: PAGE_MAX, margin: "0 auto" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22 }}>
            <div>
              {/* v6.59.0 (user ruling): the lot NUMBER comes first. Status,
                  class and the expected/received variance sat above it, so the
                  eye met three qualifiers before the thing being qualified. */}
              <div style={{ fontSize: 26, fontWeight: 700, color: "#111", fontFamily: "ui-monospace, Menlo, monospace", marginBottom: 6 }}>{lot.number}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <StatusBadge status={lot.status} />
                <VarianceBadge expected={lot.expectedKg} actual={lot.receivedKg} lot={lot} />
              </div>
              {/* v6.59.0: the supplier — asked far more often than the packaging. */}
              {(() => { const po = (pos || []).find((x: any) => String(x.number) === String(lot.poRef));
                const sup = po?.supplier?.name || lot.supplierName || "";
                // v6.65.0 (owner request): the supplier must read as a different kind of
                // information than the product — amber, smaller caps, not near-black.
                return sup ? <div style={{ fontSize: 11.5, fontWeight: 700, color: "#0369A1", letterSpacing: "0.03em", textTransform: "uppercase", marginBottom: 2 }}>{sup}</div> : null; })()}
              {/* v6.99.81 (A-IN-8, owner): line 2 — product, item, size, packaging, origin; line 3 — class, location and flow */}
              <div style={{ fontSize: 14, color: "#444" }}>{lot.product}{lot.variety ? " — " + lot.variety : ""} · {lot.size || "—"} · {lot.packaging || "—"} · {lot.origin || "—"}</div>
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><QualityBadge quality={lot.quality} /><LocationPill locationId={lot.locationId} lot={lot} /><LotDirectionBadge lot={lot} shipments={shipments} orders={liveSOs} pos={pos} /></div>
            </div>
            <div style={{ textAlign: "right" }}>
              {/* v6.99.81 (A-IN-7/8, owner): the value in the lot's own state — in stock · delivered · expected — and the cost per kg; received kg lives in the breakdown below */}
              {(() => { const v = lotValue(lot, cpk); return <>
                <div style={{ fontSize: 11, color: "#888" }}>Value {v.label !== "—" ? <span style={{ fontWeight: 700, color: v.label === "in stock" ? "#16A34A" : v.label === "expected" ? "#B45309" : "#0F766E" }}>{v.label}</span> : null}</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: "#111" }}>{fmtMoney(v.pln)}</div>
                <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{fmtMoney(cpk)}/kg</div>
              </>; })()}
            </div>
          </div>

          {/* Qty breakdown — v6.3.0 compact strip (PO-module density): figures + bar on one row */}
          <Card style={{ marginBottom: 12, padding: "12px 16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(78px, 1fr))", gap: 10, alignItems: "center" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#AAA", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>QUANTITY<br />BREAKDOWN</div>
              <div><div style={{ fontSize: 9, color: "#888" }}>EXPECTED</div><div style={{ fontSize: 12.5, fontWeight: 600, color: "#555" }}>{fmtNum(lot.expectedKg)} kg</div></div>
              <div><div style={{ fontSize: 9, color: "#888" }}>RECEIVED</div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#111" }}>{fmtNum(lot.receivedKg)} kg</div></div>
              <div title="Live: physicalKg − reservations from pre-dispatch SOs"><div style={{ fontSize: 9, color: "#16A34A" }}>AVAILABLE</div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#16A34A" }}>{fmtNum(res.liveAvailable)} kg</div></div>
              <div title="From Confirmed/Reserved/Loading SOs"><div style={{ fontSize: 9, color: "#7C3AED" }}>RESERVED</div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#7C3AED" }}>{fmtNum(res.totalReserved)} kg</div></div>
              {(() => { const g = { ...gradeSplit(lot), waste: num(lot.wasteKg) || gradeSplit(lot).waste }; return (g.II > 0 || g.waste > 0) ? <><div title="v6.99.19: sorted classes — CLASS II is sound fruit reclassified by sorting; WASTE is what the sorting threw away (a DAMAGE movement with source sorting:). DAMAGED is any other loss: transit damage, a count adjustment, damage found in store."><div style={{ fontSize: 9, color: "#166534" }}>CLASS I</div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#166534" }}>{fmtNum(g.I)} kg</div></div><div><div style={{ fontSize: 9, color: "#B45309" }}>CLASS II</div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#B45309" }}>{fmtNum(g.II)} kg</div></div><div><div style={{ fontSize: 9, color: "#6B7280" }}>WASTE (sorting)</div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#6B7280" }}>{fmtNum(g.waste)} kg</div></div></> : null; })()}
              <div><div title="v6.99.19: DAMAGED = losses outside sorting (transit, store, count adjustments). Sorting waste is shown separately."><div style={{ fontSize: 9, color: "#DC2626" }}>DAMAGED</div></div><div style={{ fontSize: 12.5, fontWeight: 700, color: "#DC2626" }}>{fmtNum(lot.damagedKg)} kg</div></div>
              <div>
                {totalKg > 0 && (
                  <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", border: "1px solid #F3F4F6" }} title={segments.map(s => `${s.key}: ${s.kg.toLocaleString()} kg`).join("  ·  ")}>
                    {segments.map((s, i) => (
                      <div key={i} title={`${s.key}: ${s.kg.toLocaleString()} kg (${((s.kg / totalKg) * 100).toFixed(1)}%)`} style={{ background: s.color, width: `${(s.kg / totalKg) * 100}%` }} />
                    ))}
                  </div>
                )}
              </div>
            </div>
            {variance !== 0 && lot.receivedKg > 0 && (
              <div style={{ marginTop: 8, padding: "5px 9px", background: variance < 0 ? "#FEF3C7" : "#DBEAFE", border: `1px solid ${variance < 0 ? "#FDE68A" : "#BFDBFE"}`, borderRadius: 6, fontSize: 11, color: variance < 0 ? "#92400E" : "#1E40AF" }}>
                <strong>{variance > 0 ? "Surplus" : "Shortfall"}:</strong> {Math.abs(variance).toLocaleString()} kg ({((variance / lot.expectedKg) * 100).toFixed(2)}%) vs PO {lot.poRef}
                <span title={variance < 0 ? "Common causes: moisture loss in transit, weight check at port, damage. Consider raising a damage report if responsibility lies with carrier or supplier." : "Higher than ordered — confirm with supplier."} style={{ marginLeft: 6, cursor: "help", color: "inherit", opacity: 0.7 }}>ⓘ</span>
              </div>
            )}
          </Card>

          {/* v6.6: consignment banner + settlement entry point */}
          {lot.consignment && (
            <Card style={{ marginBottom: 12, border: "1px solid #DDD6FE", background: "#FAF5FF" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: "#6D28D9" }}>⚖ CONSIGNMENT LOT — price settled on sales</div>
                  <div style={{ fontSize: 11.5, color: "#7C3AED", marginTop: 3, lineHeight: 1.5 }}>
                    Producer's goods in our custody. Sell at your prices; all expenses are deducted at settlement.
                    Settled per truck on the purchase order (all lots of the PO together; expenses include delivery freight; producer invoice in its own currency).
                    {lot.settlement?.closedAt ? ` · closed ${lot.settlement.closedAt}` : lot.settlement?.sentAt ? ` · statement sent ${lot.settlement.sentAt}` : ""}
                  </div>
                </div>
{/* v6.99.17 (A-R13-2, ownership): the settlement is per PO (truck) and lives in PURCHASE ORDERS — the old per-lot settlement is retired */}
                <span style={{ fontSize: 11.5, color: "#6D28D9", fontWeight: 700 }}>Settlement: on {lot.poRef || "the PO"} (Purchase Orders → Truck settlement)</span>
                {onOpenClaim && (
                  <button onClick={() => onOpenClaim(lot)} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: "#B45309", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", marginLeft: 8 }} title="Quantify damage on this consignment and request a credit note from the producer">
                    {(lotClaims || []).length ? `Producer claim (${(lotClaims || []).length})` : "Producer claim"}
                  </button>
                )}
                <button onClick={() => { const no = issueReportNumber("TRC", lot.number, userName); setTraceNo(no); setTimeout(() => printHtmlNodeInv("lot-trace-doc", `${no}-${lot.number}`), 60); }} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #0F766E", background: "#fff", color: "#0F766E", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", marginLeft: 8 }} title="One-click recall report: where this lot came from and everywhere it went — supplier, shipments, clients, invoices.">
                  🔎 Trace / recall
                </button>
              </div>
            </Card>
          )}

          {/* v6.5: expected warehouse charges — predicted from movements + tariff */}
          {(() => {
            const wh = computeLotWarehouseCharges(lot, contacts, localTodayISO());
            if (!wh) return null;
            return (
              <Card style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <SectionTitle>WAREHOUSE CHARGES — EXPECTED · {wh.warehouseName.toUpperCase()}</SectionTitle>
                    <div style={{ fontSize: 10.5, color: "#888", marginTop: -8 }}>
                      {wh.basis === "pallet"
                        ? `${wh.chargeablePalletDays.toLocaleString("pl-PL")} chargeable pallet-days`
                        : `${wh.chargeableKgDays.toLocaleString("pl-PL")} chargeable kg-days`}
                      {" "}accrued to date · predicted from this lot's movements — compare against the warehouse invoice
                    </div>
                  </div>
                  <button onClick={() => onRecordSorting && onRecordSorting(lot)} style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: "#16A34A", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>+ Record sorting</button>
                </div>
                {wh.lines.map((l, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #F9FAFB", fontSize: 12, color: "#444" }}>
                    <span>{l.label}{l.date ? <span style={{ color: "#999", fontSize: 10.5 }}> · {formatDMY(l.date)}</span> : null}{l.note ? <span style={{ color: "#999", fontSize: 10.5 }}> — {l.note}</span> : null}</span>
                    <span style={{ fontWeight: 600 }}>{l.amount.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} {wh.currency}</span>
                  </div>
                ))}
                {!wh.lines.length && <div style={{ fontSize: 11, color: "#AAA", fontStyle: "italic" }}>No chargeable activity yet (free period or no stock days).</div>}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, padding: "8px 10px", background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 7 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#0C4A6E" }}>Expected invoice for this lot (to date)</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#0C4A6E" }}>
                    {wh.total.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} {wh.currency}
                    {wh.currency !== "PLN" && <span style={{ fontWeight: 500, color: "#0369A1", marginLeft: 8, fontSize: 11 }}>≈ {wh.totalPLN.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} PLN</span>}
                  </span>
                </div>
                {wh.notes.map((n, i) => <div key={i} style={{ fontSize: 10.5, color: "#92400E", marginTop: 6 }}>ⓘ {n}</div>)}
                <div style={{ fontSize: 10, color: "#AAA", marginTop: 6 }}>Monthly totals per warehouse and invoice reconciliation: Finance → Warehouse charges.</div>
              </Card>
            );
          })()}
          {res.reservations.length > 0 && (
            <Card style={{ marginBottom: 16, border: "1px solid #DDD6FE", background: "#FAF8FF" }}>
              <SectionTitle>RESERVATIONS · {res.reservations.length} SO{res.reservations.length !== 1 ? "s" : ""}</SectionTitle>
              <div style={{ display: "grid", gap: 8 }}>
                {res.reservations.map((r, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "160px 1fr 100px 100px", gap: 10, alignItems: "center", padding: "8px 10px", background: "#fff", border: "1px solid #EDE9FE", borderRadius: 7 }}>
                    <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, fontWeight: 700, color: "#7C3AED" }}>{r.soNumber}</div>
                    <div style={{ fontSize: 12, color: "#555" }}>{r.clientName}</div>
                    <div><StatusBadge status={r.status} /></div>
                    <div style={{ textAlign: "right", fontSize: 12.5, fontWeight: 600, color: "#7C3AED" }}>{fmtNum(r.qty)} kg</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 10.5, color: "#888", fontStyle: "italic" }}>
                Only SOs in Confirmed/Reserved/Loading status count against live availability. Shipped+ SOs have already physically left and are reflected in SHIP_OUT movements.
              </div>
            </Card>
          )}

          {/* Two-column body */}
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
            <div>
              {/* Journey (v6.1b) — planned stages from the PO flow, with ownership coding */}
              {(() => { const journey = journeyForLot(lot, shipments || [], liveSOs || []); return journey.length > 0 && (
                <Card style={{ marginBottom: 16 }}>
                  <SectionTitle>JOURNEY · {journey.length} STAGES</SectionTitle>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 14, lineHeight: 1.5 }}>
                    Planned route for this lot, from its flow. <span style={{ color: "#16A34A", fontWeight: 600 }}>Green = ours (our risk)</span>; grey = not yet ours / handed to client.
                  </div>
                  <div style={{ position: "relative" }}>
                    {journey.map((s, i) => {
                      const owned = s.ownership === "owned";
                      const tagText = s.ownership === "owned" ? "OURS" : s.ownership === "not_owned" ? "supplier's" : "client's";
                      const done = s.status === "done";
                      const active = s.status === "active";
                      const dotColor = done ? "#16A34A" : active ? "#D97706" : (owned ? "#86EFAC" : "#D1D5DB");
                      // Black/gray emphasis: stages where goods are OURS render in black;
                      // the supplier's / client's portions render gray.
                      const textColor = owned ? "#111827" : "#9CA3AF";
                      const labelText = s.label || standardStageLabel(s.kind); // v6.34.9: prefer the real (shipment-derived) stage label
                      const last = i === journey.length - 1;
                      return (
                        <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", paddingBottom: last ? 0 : 16, position: "relative" }}>
                          {!last && <div style={{ position: "absolute", left: 7, top: 18, bottom: 0, width: 2, background: done ? "#16A34A" : "#E5E7EB" }} />}
                          <div style={{ width: 16, height: 16, borderRadius: "50%", background: dotColor, flexShrink: 0, marginTop: 2, border: "2px solid #fff", boxShadow: "0 0 0 1px " + dotColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 900 }}>{done ? "✓" : ""}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                              <span style={{ fontSize: 13, fontWeight: owned ? 700 : 500, color: textColor }}>{labelText}{active && <span style={{ color: "#D97706", fontWeight: 700, fontSize: 10, marginLeft: 6 }}>● IN PROGRESS</span>}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, color: owned ? "#16A34A" : "#9CA3AF", background: owned ? "#DCFCE7" : "#F3F4F6", padding: "1px 7px", borderRadius: 10, whiteSpace: "nowrap" }}>{tagText}</span>
                            </div>
                            <div style={{ fontSize: 11, marginTop: 2, color: done ? "#9CA3AF" : active ? "#D97706" : "#9CA3AF" }}>
                              {done
                                ? `${formatDMY(s.actualDate || s.plannedDate) || ""} · done`
                                : active
                                  ? `${s.plannedDate ? "planned " + formatDMY(s.plannedDate) : "date TBA"} · in progress`
                                  : `${s.plannedDate ? "planned " + formatDMY(s.plannedDate) : "date TBA"}`}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ); })()}

              {/* Customs overlay (v6.1d) — independent clearance events, editable */}
              {(() => {
                const kinds = customsStagesForLot(lot, shipments);
                if (kinds.length === 0) return null;
                return (
                  <Card style={{ marginBottom: 16 }}>
                    <SectionTitle>CUSTOMS CLEARANCE</SectionTitle>
                    {/* v6.51.0 (user ruling): was a signpost saying "managed in shipments".
                        Now it SUMMARISES the clearance facts already held on the shipments
                        that carried this lot, so the lot answers "was this cleared, by whom,
                        under what reference, at what cost" without opening each shipment. */}
                    {(() => {
                      const carrying = (shipments || []).filter((s: any) => s && s.status !== "Cancelled"
                        && ((s.goods || []).some((g: any) => String(g.lotRef) === String(lot.number)) || (s.lotRefs || []).includes(lot.number)));
                      const withCustoms = carrying.filter((s: any) => (s.customs || {}).applies);
                      const customsCostPLN = (lot.costs || [])
                        .filter((c: any) => String(c.type || "").toLowerCase().includes("customs"))
                        .reduce((a: number, c: any) => a + (parseFloat(c.pln) || 0), 0);
                      if (!withCustoms.length && !customsCostPLN) {
                        return <div style={{ fontSize: 12, color: "#94A3B8", lineHeight: 1.6 }}>
                          No customs clearance recorded on the shipments carrying this lot. Clearance is captured on the shipment (Shipments → <em>Customs clearance</em>) and summarised here.
                        </div>;
                      }
                      const ROLE: any = { our_broker: "our Polish broker", forwarder_abroad: "the forwarder abroad", t1_local_broker: "a local broker under T1", not_required: "no clearance required" };
                      const ST: any = { cleared: { t: "Cleared", c: "#059669", bg: "#DCFCE7" }, in_progress: { t: "Being cleared", c: "#B45309", bg: "#FEF3C7" }, pending: { t: "Not yet cleared", c: "#B91C1C", bg: "#FEE2E2" } };
                      const allCleared = withCustoms.every((s: any) => String((s.customs || {}).status) === "cleared");
                      return <div>
                        {/* one plain sentence first — the answer most people want */}
                        <div style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.6, marginBottom: 10 }}>
                          {withCustoms.length === 0
                            ? "No customs clearance was needed for the shipments carrying this lot."
                            : allCleared
                              ? <>These goods have been <strong style={{ color: "#059669" }}>cleared through customs</strong>{withCustoms.length > 1 ? ` on all ${withCustoms.length} shipments that carried them` : ""}.</>
                              : <>Customs is <strong style={{ color: "#B45309" }}>not yet complete</strong> for these goods — see the shipment(s) below.</>}
                        </div>
                        {withCustoms.map((s: any, i: number) => {
                          const c = s.customs || {};
                          const st = ST[String(c.status || "pending")] || ST.pending;
                          const broker = (contacts || []).find((x: any) => String(x.id) === String(c.brokerId || s.brokerId));
                          const who = ROLE[c.role] || "";
                          // v6.58.0: role "not_required" used to concatenate into
                          // "Cleared by no clearance required (broker name)" — nonsense.
                          // v6.60.0: the shared summary replaces this ad-hoc
                          // concatenation, so one sentence is produced the same
                          // way everywhere and cannot contradict itself.
                          const shared = customsSummary(c, broker?.name);
                          const sentence = shared || (c.role === "not_required" ? "No customs clearance was required for this shipment" : [
                            who ? `Cleared by ${who}` : "",
                            broker?.name ? `(${broker.name})` : "",
                            c.place ? `at ${c.place}` : "",
                            c.t1Transit ? "· moved under T1 transit" : "",
                            c.entryRef ? `· entry ${c.entryRef}` : "",
                          ].filter(Boolean).join(" "));
                          return <div key={i} style={{ padding: "8px 0", borderTop: i ? "1px solid #F1F5F9" : "none", fontSize: 12 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
                              <span style={{ fontWeight: 700 }}>{s.number}</span>
                              <span style={{ background: st.bg, color: st.c, borderRadius: 999, padding: "1px 9px", fontSize: 10.5, fontWeight: 800 }}>{st.t}</span>
                            </div>
                            <div style={{ color: "#64748B", lineHeight: 1.5 }}>{sentence || "No clearance details recorded on this shipment."}</div>
                          </div>;
                        })}
                        <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid #E5E7EB", fontSize: 12, color: "#334155", lineHeight: 1.55 }}>
                          {customsCostPLN > 0
                            ? <>Customs and duty cost included in this lot's landed cost: <strong>{customsCostPLN.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} PLN</strong>. It is already part of the cost of goods used in every sale from this lot.</>
                            : <span style={{ color: "#94A3B8" }}>No customs cost has been allocated to this lot.</span>}
                        </div>
                      </div>;
                    })()}
                  </Card>
                );
              })()}

              {/* Inspections (v6.2) — recordable at any stage */}
              {season && <LotWorkbench lot={lot} pos={pos} shipments={shipments} inspections={season.inspections} claims={season.claims || []} orders={liveSOs} settlements={season.settlements || []} contacts={contacts} />}
              {season && <SeasonActions lot={lot} {...season} />}
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle right={<button onClick={onInspect} style={{ fontSize: 11, padding: "4px 10px", border: "1px solid #0E7490", background: "#fff", color: "#0E7490", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>+ Record inspection</button>}>INSPECTIONS{(lot.inspections || []).length ? ` (${lot.inspections.length})` : ""}</SectionTitle>
                {(lot.inspections || []).length === 0 && <div style={{ fontSize: 12, color: "#AAA" }}>No inspections recorded. Record one when goods are checked on arrival, in storage, by a client, or at customs.</div>}
                {([...(lot.inspections || []), ...((seasonInspections || []).filter((x: any) => String(x.lotNumber) === String(lot.number)).map((x: any) => ({ date: x.date, context: `${x.stage} — quality inspection`, outcome: x.verdict, findings: `defects ${inspectionTotals(x).totalPct}%: ` + ((x.defects || []).map((d: any) => `${d.name} ${d.pct}%`).join(", ") || "none") + (x.observations ? ` — ${x.observations}` : "") + (x.inspector ? ` · ${x.inspector}` : ""), lossKg: 0, creditNote: null, _season: true })))]).map((ins, i) => {
                  const ctx = INSPECTION_CONTEXTS.find(c => c.code === ins.context);
                  const out = INSPECTION_OUTCOMES.find(o => o.code === ins.outcome);
                  const bad = ins.outcome !== "ok";
                  return (
                    <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid #F3F4F6" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#111" }}>🔍 {ctx ? ctx.label.split(" (")[0] : ins.context}</div>
                        <span style={{ fontSize: 10.5, color: "#AAA" }}>{ins.date}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: bad ? "#B91C1C" : "#16A34A", fontWeight: 600, marginTop: 3 }}>
                        {out ? out.label : ins.outcome}{ins.lossKg ? ` · −${fmtNum(ins.lossKg)} kg` : ""}
                      </div>
                      {ins.findings && <div style={{ fontSize: 11.5, color: "#666", marginTop: 3 }}>{ins.findings}</div>}
                      {ins.creditNote && <div style={{ fontSize: 11, color: "#92400E", marginTop: 4, background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 6, padding: "4px 8px", display: "inline-block" }}>Proposed credit note: {fmtNum(ins.creditNote.amount)} {ins.creditNote.currency} (to be issued in Invoicing)</div>}
                    </div>
                  );
                })}
              </Card>

              {/* Movement history */}
              <Card style={{ marginBottom: 16 }}>
                {(() => {
                  // Safeguards 7a: the recall report — hidden, print-only.
                  const co = (() => { try { return JSON.parse(window.localStorage.getItem("marianna-erp:v2:company") || "{}"); } catch { return {}; } })();
                  const companyName = co.name || "MARIANNA";
                  const companyAddress = co.address || "";
                  const companyNip = co.nip || "";
                  const t = buildTraceTree(lot, { contacts, pos: tracePOs, orders: liveSOs, shipments, invoices: traceInvoices }, localTodayISO());
                  const cell = { border: "1px solid #999", padding: "4px 6px", fontSize: 11 } as any;
                  const hd = { ...cell, background: "#F3F4F6", fontWeight: 700 } as any;
                  return (
                    <div id="lot-trace-doc" style={{ position: "absolute", left: -10000, top: 0, width: 780, background: "#fff", color: "#111", fontFamily: "Arial, Calibri, sans-serif", fontSize: 12, padding: 24 }}>
                      {/* v6.99.30 (owner 15 Sept): the recall document — real logo, its own number, three sections in the owner's order */}
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, borderBottom: "2px solid #111", paddingBottom: 10, marginBottom: 12 }}>
                        <PrintLogo width={200} />
                        <div style={{ marginLeft: "auto", textAlign: "right", fontSize: 9.5, color: "#444" }}>{companyName}<br />{companyAddress}<br />{companyNip ? `NIP ${companyNip}` : ""}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                        <div style={{ fontSize: 17, fontWeight: 800 }}>TRACEABILITY / RECALL REPORT</div>
                        <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "ui-monospace, Menlo, monospace" }}>{traceNo}</div>
                      </div>
                      <div style={{ marginBottom: 12, fontSize: 11, color: "#444" }}>Lot / Partia: <b>{t.lot.number}</b> · generated / wygenerowano {t.generatedAt}{userName ? ` · ${userName}` : ""}</div>

                      <div style={{ fontWeight: 800, margin: "10px 0 4px" }}>1. PURCHASE / ZAKUP</div>
                      <table><tbody>
                        {[["PO / Zamówienie", t.origin.poNumber || "—"], ["Lot / Partia", t.lot.number], ["Supplier / Dostawca", t.origin.supplier || "—"], ["Origin / Pochodzenie", t.origin.origin || "—"],
                          ["Product / Produkt", `${t.lot.product}${t.lot.variety ? ` — ${t.lot.variety}` : ""}`], ["Packaging / Opakowanie", t.lot.packaging || "—"], ["Size / Kaliber", t.lot.size || "—"],
                          ["Quantity received / Ilość przyjęta", `${Number(t.lot.receivedKg || 0).toLocaleString("pl-PL")} kg`],
                          ["Still in stock / Na stanie", `${Number(t.lot.physicalKg || 0).toLocaleString("pl-PL")} kg${(t.lot.inStockII || 0) > 0 ? ` — class I ${Number(t.lot.inStockI || 0).toLocaleString("pl-PL")} kg · class II ${Number(t.lot.inStockII || 0).toLocaleString("pl-PL")} kg` : ""}`]
                        ].map(([k, v]: any) => <tr key={k}><td style={{ ...cell, width: 230, background: "#F9FAFB" }}>{k}</td><td style={cell}>{v}</td></tr>)}
                      </tbody></table>

                      <div style={{ fontWeight: 800, margin: "14px 0 4px" }}>2. SHIPMENTS / TRANSPORTY ({t.shipments.length})</div>
                      <table><tbody>
                        <tr>{["Shipment / Transport", "Loading place / Miejsce załadunku", "Loading date", "Unloading place / Miejsce rozładunku", "Unloading date", "Carrier / Przewoźnik"].map(h => <th key={h} style={hd}>{h}</th>)}</tr>
                        {!t.shipments.length && <tr><td style={cell} colSpan={6}>— none yet / brak —</td></tr>}
                        {t.shipments.map((s: any) => <tr key={s.number}>{[s.number, s.from || "—", s.loadedAt || "—", s.to || "—", s.unloadedAt || "—", s.carrier || "—"].map((v: any, k: number) => <td key={k} style={cell}>{v}</td>)}</tr>)}
                      </tbody></table>

                      <div style={{ fontWeight: 800, margin: "14px 0 4px" }}>3. SOLD TO / SPRZEDANO ({t.sales.length})</div>
                      <table><tbody>
                        <tr>{["SO", "Client / Klient", "Qty kg", "Incoterm", "Delivery place / Miejsce dostawy", "Delivery date"].map(h => <th key={h} style={hd}>{h}</th>)}</tr>
                        {!t.sales.length && <tr><td style={cell} colSpan={6}>— none yet / brak —</td></tr>}
                        {t.sales.map((s: any) => <tr key={s.soNumber}>{[s.soNumber, s.client, Number(s.qtyKg || 0).toLocaleString("pl-PL"), s.incoterm || "—", s.destination || "—", s.deliveredAt || "—"].map((v: any, k: number) => <td key={k} style={cell}>{v}</td>)}</tr>)}
                      </tbody></table>
                      <div style={{ fontWeight: 700, margin: "10px 0 4px", fontSize: 11 }}>Related invoices / Powiązane faktury ({t.invoices.length})</div>
                      <table><tbody>
                        <tr>{["Invoice / Faktura", "Kind", "Counterparty / Kontrahent", "Gross"].map(h => <th key={h} style={hd}>{h}</th>)}</tr>
                        {!t.invoices.length && <tr><td style={cell} colSpan={4}>— none yet / brak —</td></tr>}
                        {t.invoices.map((iv: any) => <tr key={iv.number}>{[iv.number, iv.kind || "—", iv.counterparty || "—", iv.gross || "—"].map((v: any, k: number) => <td key={k} style={cell}>{v}</td>)}</tr>)}
                      </tbody></table>
                      <div style={{ marginTop: 16, fontSize: 9.5, color: "#666" }}>Issued from MARIANNA ERP · {traceNo} · this report is recorded in the audit trail.</div>
                    </div>
                  );
                })()}
                {(() => {
                  // Batch 6c (BP-33): one place for the lot's quality story —
                  // claims, claimed/damaged totals, quality movements.
                  const claims = lotClaims || [];   // v6.48.0: from the claims store
                  const qmoves = (lot.movements || []).filter((m: any) => ["DAMAGE", "RECLASS", "CLAIM"].includes(m.type));
                  if (!claims.length && !qmoves.length && !(lot.claimedKg > 0) && !(lot.damagedKg > 0)) return null;
                  const chip = (s: string) => ({ Draft: "#94A3B8", Issued: "#B45309", Accepted: "#15803D", Rejected: "#DC2626", Settled: "#4338CA" } as any)[s] || "#94A3B8";
                  return (
                    <div style={{ border: "1px solid #FDE68A", background: "#FFFBEB", borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: claims.length ? 8 : 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "#B45309", letterSpacing: "0.04em" }}>QUALITY & CLAIMS</div>
                        {lot.claimedKg > 0 && <span style={{ fontSize: 10.5, color: "#B45309" }}>claimed {Number(lot.claimedKg).toLocaleString("pl-PL")} kg</span>}
                        {lot.damagedKg > 0 && <span style={{ fontSize: 10.5, color: "#DC2626" }}>damaged {Number(lot.damagedKg).toLocaleString("pl-PL")} kg</span>}
                        {qmoves.length > 0 && <span style={{ fontSize: 10.5, color: "#94A3B8" }}>· {qmoves.length} quality movement{qmoves.length !== 1 ? "s" : ""} in the history below</span>}
                      </div>
                      {claims.map((c: any) => (
                        <div key={String(c.id)} onClick={() => onOpenClaim && onOpenClaim(lot)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 7, background: "#fff", border: "1px solid #FDE68A", marginBottom: 4, cursor: onOpenClaim ? "pointer" : "default", fontSize: 12 }}>
                          <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 800, color: "#B45309" }}>{c.number || "draft"}</span>
                          <span style={{ color: "#64748B" }}>{c.date}</span>
                          <span>{c.defectType || "defect"} · {c.defectPct || 0}%{c.affectedKg ? ` · ${Number(c.affectedKg).toLocaleString("pl-PL")} kg` : ""}</span>
                          <span style={{ marginLeft: "auto", fontWeight: 700 }}>{c.requestedCreditEUR ? `€${Number(c.requestedCreditEUR).toLocaleString("pl-PL", { minimumFractionDigits: 2 })}` : ""}</span>
                          {c.status === "Accepted" && c.acceptedEUR ? <span style={{ fontSize: 10.5, color: "#15803D" }}>accepted €{Number(c.acceptedEUR).toLocaleString("pl-PL", { minimumFractionDigits: 2 })}</span> : null}
                          <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: chip(c.status), borderRadius: 999, padding: "1px 8px" }}>{c.status || "Draft"}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <SectionTitle>MOVEMENT HISTORY ({lot.movements.length})</SectionTitle>
                {lot.movements.length === 0 && (
                  <div style={{ fontSize: 12, color: "#AAA", padding: "12px 0" }}>No movements yet — this lot is still in "Expected" status.</div>
                )}
                {lot.movements.length > 0 && (
                  <div style={{ position: "relative" }}>
                    <div style={{ position: "absolute", left: 11, top: 14, bottom: 14, width: 1, background: "#E5E7EB" }} />
                    {lot.movements.map((m, i) => {
                      const mt = MOVEMENT_TYPES[m.type] || { color: "#888", label: m.type, icon: "·" };
                      const fromLoc = locById(m.fromId);
                      const toLoc = locById(m.toId);
                      const isMove = m.fromId !== m.toId;
                      const isVoided = !!m.voided;
                      const canVoid = !isVoided && ["TRANSFER", "DAMAGE", "CLAIM", "RECLASS"].includes(m.type); // manual events only; IN/SHIP_OUT/REVERSAL are system-driven
                      return (
                        <div key={i} style={{ display: "flex", gap: 14, paddingBottom: 14, position: "relative", opacity: isVoided ? 0.6 : 1 }}>
                          <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#fff", border: `2px solid ${isVoided ? "#DC2626" : mt.color}`, color: isVoided ? "#DC2626" : mt.color, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, zIndex: 1 }}>{isVoided ? "✕" : mt.icon}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                              <div style={{ fontSize: 12.5, textDecoration: isVoided ? "line-through" : "none", color: isVoided ? "#B91C1C" : undefined }}>
                                <span style={{ fontWeight: 600, color: isVoided ? "#B91C1C" : mt.color }}>{mt.label}</span>
                                <span style={{ color: isVoided ? "#B91C1C" : "#444", marginLeft: 6 }}>· {fmtNum(m.qtyKg)} kg</span>
                                {isMove && <span style={{ color: isVoided ? "#B91C1C" : "#666", marginLeft: 6 }}>· {fromLoc?.name} → {toLoc?.name}</span>}
                                {isVoided && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: "#B91C1C", background: "#FEE2E2", border: "1px solid #FECACA", borderRadius: 5, padding: "1px 6px" }}>VOIDED</span>}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                                <span style={{ fontSize: 11, color: "#AAA" }}>{formatDMY(m.date)}</span>
                                {!isVoided && onEditMovement && <button onClick={() => onEditMovement(m)} title="Edit movement" style={{ fontSize: 10.5, padding: "2px 7px", border: "1px solid #2563EB", background: "#fff", borderRadius: 5, cursor: "pointer", color: "#2563EB", fontWeight: 600 }}>Edit</button>}
                                {canVoid && onVoidMovement && <button onClick={() => onVoidMovement(m.id)} title="Void this entry — kept in the record but removed from stock" style={{ fontSize: 10.5, padding: "2px 7px", border: "1px solid #FECACA", background: "#fff", borderRadius: 5, cursor: "pointer", color: "#DC2626", fontWeight: 600 }}>Void</button>}
                              </div>
                            </div>
                            {m.note && <div style={{ fontSize: 11.5, color: "#888", marginTop: 2, textDecoration: isVoided ? "line-through" : "none" }}>{m.note}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* Notes */}
              {lot.notes && (
                <Card>
                  <SectionTitle>NOTES</SectionTitle>
                  <div style={{ fontSize: 12.5, color: "#444", lineHeight: 1.5 }}>{lot.notes}</div>
                </Card>
              )}
            </div>

            {/* Right column */}
            <div>
              {/* Linked docs */}
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle>LINKED DOCUMENTS</SectionTitle>
                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#888", marginBottom: 3 }}>PURCHASE ORDER</div>
                    {lot.poRef ? (
                      <DocLink num={lot.poRef} from={lot.number}><div style={{ padding: "6px 10px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 6, fontSize: 12.5, color: "#1D4ED8", fontWeight: 600, fontFamily: "ui-monospace, Menlo, monospace", display: "inline-block" }}>{lot.poRef}</div></DocLink>
                    ) : <span style={{ fontSize: 12, color: "#AAA" }}>—</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#888", marginBottom: 3 }}>SALES ORDERS ({soRefsFor(lot, liveSOs, shipments).length})</div>
                    {soRefsFor(lot, liveSOs, shipments).length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {soRefsFor(lot, liveSOs, shipments).map(s => (
                          <DocLink key={s.number} num={s.number} from={lot.number}><div title={`${s.clientName || ""}${s.status && s.status !== "—" ? ` · ${s.status}` : ""}${s.viaShipment ? ` · linked via shipment ${s.viaShipment}` : ""}`} style={{ padding: "4px 8px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 5, fontSize: 11, color: "#15803D", fontWeight: 600, fontFamily: "ui-monospace, Menlo, monospace" }}>
                            {s.number}{s.viaShipment ? <span style={{ fontSize: 9, color: "#16A34A", fontWeight: 700, marginLeft: 4 }}>via {s.viaShipment}</span> : null}
                          </div></DocLink>
                        ))}
                      </div>
                    ) : <span style={{ fontSize: 12, color: "#AAA" }}>Not yet linked</span>}
                  </div>
                  {/* v6.99.81 (A-IN-11, owner): the location and the dates left this box — they are in the header and the Arrived column */}
                </div>
              </Card>

              {/* v6.99.81 (A-IN-12, owner): the cost-breakdown box is gone — the header shows the value and the cost per kg */}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
