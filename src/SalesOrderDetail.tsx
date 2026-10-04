// SalesOrderDetail.tsx — v6.99.68 (A-AUD-2, owner): moved out of SalesOrders.tsx unchanged; the module's shared helpers are imported from it.
import React, { useState } from "react";
import SOMarginCard from "./SOMarginCard";
import { Card, Lbl, SectionTitle, cancelledDocSet, ActionButton, DocLink } from "./ui";
import { PAGE_MAX } from "./ui";
import { SO_STATUSES } from "./types";
import { computedSOLinks } from "./documents.domain";
import { paymentText } from "./po.domain";   // v6.99.76 (A-SV-4)
import { effectiveCounts } from "./pricingUnit.domain";
import { effectiveSoStatus, isShippedOrLater } from "./statusOwnership.domain";
import { actualDeliveryDate, deliveryDelayDays, deliveryEventFor } from "./so.domain";
import { lineTotal as lineTotalPU, pricingUnit as pricingUnitOf, quantityLabel, documentTotals } from "./pricingUnit.domain";
import { localTodayISO, formatDMY } from "./dates";
import { Inp, LOCATION_TYPES, LifecycleBar, PACKAGING_TYPES_REF, QualityBadge, SHIPMENTS_REF, Sel, SourceBadge, StatusBadge, buildInvoiceFromSO, computeLineAvailability, destinationDisplay, fmtDate, fmtMoney, fmtNum, locById, netTotal, nextSINVNumber, supplierNameForPO } from "./SalesOrders";

// ─── INVOICE CREATION MODAL ───────────────────────────────────────────────
// Triggered when an SO transitions to Shipped. Previews the Sales Invoice (SINV)
// that will be created from the SO data and asks the user to confirm.
// User can adjust VAT rate, payment method, and dates before confirming.
//
// Interim behavior (no backend yet): the invoice object is stored in this SO's
// v6.33.0 (A3-6): the canonical invoice is written to the Invoices REGISTER
// (sole owner); the SO keeps only the number in `linkedInvoices`.
// record of the invoice that needs to be created in Fakturownia / the Invoices module.
export function InvoiceCreationModal({ order, existingInvoiceNumbers, onCancel, onConfirm }: any) {
  const today = localTodayISO();
  const initial = buildInvoiceFromSO(order, nextSINVNumber(existingInvoiceNumbers || []), today);
  const [invoice, setInvoice] = useState(initial);

  const sf = (k, v) => setInvoice(prev => {
    const next = { ...prev, [k]: v };
    // Recalc VAT/gross on rate or net change
    if (k === "vatRate" || k === "netAmount") {
      const r = parseFloat(k === "vatRate" ? v : next.vatRate) || 0;
      const n = parseFloat(k === "netAmount" ? v : next.netAmount) || 0;
      next.vatAmount = Math.round(n * r) / 100;
      next.grossAmount = Math.round((n + next.vatAmount) * 100) / 100;
      next.netPLN = Math.round(n * (parseFloat(String(next.fxRate)) || 1) * 100) / 100;
      next.grossPLN = Math.round(next.grossAmount * (parseFloat(String(next.fxRate)) || 1) * 100) / 100;
    }
    return next;
  });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#fff", borderRadius: 14, width: "min(720px, 96vw)", maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #EBEBEB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Issue Sales Invoice from {order.number}</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Goods shipped — review the invoice details and confirm to create the SINV</div>
          </div>
          <ActionButton action="close" onClick={onCancel} />
        </div>

        <div style={{ padding: 20, overflowY: "auto", background: "#FAFAFA", flex: 1 }}>
          {/* Backend-phase note */}
          <div style={{ padding: "10px 14px", background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 8, marginBottom: 14, fontSize: 11, color: "#92400E", lineHeight: 1.5 }}>
            <strong>Interim flow (no backend yet):</strong> the invoice will be saved on this SO as a "pending" record. When the Invoices module is integrated, it will be created there automatically. For now, also enter it in Fakturownia and link the PDF.
          </div>

          <Card style={{ marginBottom: 12 }}>
            <SectionTitle>INVOICE HEADER</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><Lbl>Invoice number</Lbl><Inp value={invoice.number} onChange={e => sf("number", e.target.value)} /></div>
              <div><Lbl>Type</Lbl><div style={{ padding: "8px 10px", background: "#DCFCE7", color: "#16A34A", borderRadius: 6, fontSize: 12, fontWeight: 700, fontFamily: "ui-monospace, Menlo, monospace" }}>SINV · Sales Invoice (↑ Receivable)</div></div>
              <div><Lbl>Issue date</Lbl><Inp value={invoice.issueDate} onChange={e => sf("issueDate", e.target.value)} type="date" noFuture /></div>
              <div><Lbl>Sale date</Lbl><Inp value={invoice.saleDate} onChange={e => sf("saleDate", e.target.value)} type="date" noFuture /></div>
              <div><Lbl>Due date</Lbl><Inp value={invoice.dueDate} onChange={e => sf("dueDate", e.target.value)} type="date" /></div>
              <div><Lbl>Payment method</Lbl>
                <Sel value={invoice.paymentMethod} onChange={e => sf("paymentMethod", e.target.value)}>
                  {["Transfer", "Cash", "Card", "Compensation", "Prepaid"].map(p => <option key={p}>{p}</option>)}
                </Sel>
              </div>
            </div>
          </Card>

          <Card style={{ marginBottom: 12 }}>
            <SectionTitle>BUYER (NABYWCA)</SectionTitle>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{invoice.counterparty?.name || "—"}</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>NIP {invoice.counterparty?.nip || "—"}</div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{invoice.counterparty?.address || "—"}</div>
          </Card>

          <Card style={{ marginBottom: 12 }}>
            <SectionTitle>AMOUNTS · VAT</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
              <div><Lbl>Currency</Lbl><div style={{ padding: "8px 10px", fontSize: 13, fontWeight: 600 }}>{invoice.currency}</div></div>
              <div><Lbl>FX rate to PLN</Lbl><div style={{ padding: "8px 10px", fontSize: 13 }}>{invoice.fxRate}</div></div>
              <div><Lbl>Net</Lbl><div style={{ padding: "8px 10px", fontSize: 13, fontWeight: 600 }}>{fmtMoney(invoice.netAmount, invoice.currency)}</div></div>
              <div>
                <Lbl>VAT rate <span style={{ color: "#D97706" }}>· review</span></Lbl>
                <Sel value={invoice.vatRate} onChange={e => sf("vatRate", parseFloat(e.target.value) || 0)}>
                  {[0, 5, 8, 23].map(r => <option key={r} value={r}>{r}%</option>)}
                </Sel>
              </div>
            </div>
            <div style={{ marginTop: 12, padding: 12, background: "#F9FAFB", borderRadius: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div><div style={{ fontSize: 10, color: "#888" }}>NET</div><div style={{ fontSize: 14, fontWeight: 600 }}>{fmtMoney(invoice.netAmount, invoice.currency)}</div></div>
              <div><div style={{ fontSize: 10, color: "#888" }}>VAT ({invoice.vatRate}%)</div><div style={{ fontSize: 14, fontWeight: 600 }}>{fmtMoney(invoice.vatAmount, invoice.currency)}</div></div>
              <div><div style={{ fontSize: 10, color: "#888" }}>GROSS / Do zapłaty</div><div style={{ fontSize: 16, fontWeight: 700, color: "#16A34A" }}>{fmtMoney(invoice.grossAmount, invoice.currency)}</div></div>
            </div>
          </Card>

          <Card>
            <SectionTitle>LINES (FROM SO)</SectionTitle>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#F9FAFB" }}>
                  <th style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, color: "#888", fontWeight: 700, letterSpacing: "0.06em" }}>PRODUCT</th>
                  <th style={{ padding: "6px 8px", textAlign: "right", fontSize: 10, color: "#888", fontWeight: 700, letterSpacing: "0.06em" }}>QTY</th>
                  <th style={{ padding: "6px 8px", textAlign: "right", fontSize: 10, color: "#888", fontWeight: 700, letterSpacing: "0.06em" }}>PRICE</th>
                  <th style={{ padding: "6px 8px", textAlign: "right", fontSize: 10, color: "#888", fontWeight: 700, letterSpacing: "0.06em" }}>LINE TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((it, i) => {
                  const lt = lineTotalPU(it, PACKAGING_TYPES_REF); // v6.79.0: box-aware
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ padding: "6px 8px" }}>{it.product}{it.variety ? <span style={{ fontWeight: 400, color: "#666" }}> — {it.variety}</span> : null}</td>
                      {/* v6.61.0: a line sold by box prints what was sold —
                          boxes and the per-box price — with the kilos alongside,
                          because the kilos are what physically move and what a
                          customs declaration or a claim will refer to. */}
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{quantityLabel(it, PACKAGING_TYPES_REF)}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtMoney(it.unitPrice, order.currency)}{pricingUnitOf(it) === "box" ? "/box" : "/kg"}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{fmtMoney(lt, order.currency)}</td>
                    </tr>
                  );
                })}
                <tr style={{ background: "#F3F4F6" }}><td colSpan={9} style={{ border: "1px solid #ccc", padding: "6px 8px", fontWeight: 700, fontSize: 10.5 }}>{(() => { const t = documentTotals(order.items, PACKAGING_TYPES_REF, order.fxRate); return `RAZEM / TOTAL: ${t.kg.toLocaleString("pl-PL")} kg · ${t.boxes.toLocaleString("pl-PL")} opak./boxes · ${t.pallets.toLocaleString("pl-PL")} pal. · ${(order.pricingMode || "firm") === "consignment" ? "konsygnacja / consignment" : t.value.toLocaleString("pl-PL", { minimumFractionDigits: 2 }) + " " + order.currency}`; })()}</td></tr>
              </tbody>
            </table>
          </Card>
        </div>

        <div style={{ padding: "14px 24px", borderTop: "1px solid #EBEBEB", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onCancel} style={{ padding: "8px 18px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel — Don't create invoice yet</button>
          <button onClick={() => onConfirm(invoice)} style={{ padding: "8px 20px", borderRadius: 7, border: "none", background: "#16A34A", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>✓ Create Sales Invoice</button>
        </div>
      </div>
    </div>
  );
}

// ─── ORDER DETAIL ─────────────────────────────────────────────────────────
export function OrderDetail({ order, soInvoices = [], onBack, onEdit, onPrint, onEmail, onDelete, onIssueInvoice, onRecordCollection = null, onRecordClientClaim = null, fktConfigured = false, onMatchInvoices = () => {}, fktMatching = false, fktMatchMsg = null, allOrders = [], lots = [], pos = [], shipments = [], operationalCosts = [], userRole = "General Manager", userName = "" }: any) {
  // BP-49: linked records are COMPUTED from the documents that reference this SO,
  // not read from stored arrays (which drift).
  const computedLinks = computedSOLinks(order, { shipments, invoices: (soInvoices || []).filter((i: any) => i.paymentStatus !== "Cancelled"), lots });
  // P/L visibility rule:
  //  - Assistant & Operations: never see P/L
  //  - Sales: see P/L only for SOs they created (createdBy === their name)
  //  - Financial Director & General Manager: see all P/L
  const canSeePL = (() => {
    if (userRole === "Financial Director" || userRole === "General Manager") return true;
    if (userRole === "Sales") return !!order.createdBy && order.createdBy === userName;
    return false; // Assistant, Operations, or unknown
  })();
  const total = netTotal(order.items);
  const destination = locById(order.destinationLocationId);
  const destinationLabel = destinationDisplay(order);
  const availability = ["Shipped", "Delivered", "Invoiced", "Closed"].includes(String(effectiveSoStatus(order, SHIPMENTS_REF || []))) ? [] : computeLineAvailability(order.items, allOrders, order.id);   // v6.99.15 (A-R11-9)
  const overageCount = availability.filter(a => a.hasOverage).length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#2563EB", fontWeight: 500 }}>← Sales Orders</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          {(() => {
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
                onClick={isDraft ? undefined : onEmail}
                disabled={isDraft}
                title={isDraft ? "Confirm the SO first — drafts cannot be emailed to clients" : ""}
                style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #E5E7EB", background: isDraft ? "#F9FAFB" : "#fff", color: isDraft ? "#9CA3AF" : "#111", fontSize: 12, fontWeight: 600, cursor: isDraft ? "not-allowed" : "pointer" }}
              >✉ Email Client</button>
            );
          })()}
          {(() => {
            // Issue Invoice button: only meaningful after Shipped, hidden if already invoiced.
            const shippedOrLater = isShippedOrLater(order, shipments); // v6.79.0 (W-1): the shipments decide
            // v6.66.0 (D-21): the register — non-cancelled SALES invoices only — is
            // the SOLE truth. The stored order.linkedInvoices array is never cleared
            // on cancel, so consulting it hid this button forever after a cancel.
            const alreadyInvoiced = soInvoices.some((iv: any) => iv.paymentStatus !== "Cancelled");
            if (!shippedOrLater || alreadyInvoiced || !onIssueInvoice) return null;
            return (
              <button onClick={onIssueInvoice} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #16A34A", background: "#16A34A", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                💰 Issue Sales Invoice
              </button>
            );
          })()}
          {order.sellIncoterm === "EXW" && !["Cancelled", "Draft"].includes(order.status) && onRecordCollection && (
            <button onClick={onRecordCollection} title="EXW: the client collects — records the pickup and creates a minimal collection shipment (no transport order, no freight on our side)."
              style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #0369A1", background: "#F0F9FF", color: "#0369A1", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>🚚 Record client collection</button>
          )}
          {["Shipped", "Delivered", "Invoiced", "Closed"].includes(order.status) && onRecordClientClaim && (
            <button onClick={onRecordClientClaim} title="The client reports a quality problem on delivered goods. Records the claim against the delivery and drafts a credit note — warehouse stock is not touched (those kg already left)."
              style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #B45309", background: "#FFFBEB", color: "#B45309", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>⚠ Record client claim</button>
          )}
          {order.status === "Cancelled"
            ? <span style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #FECACA", background: "#FEF2F2", color: "#B91C1C", fontSize: 12, fontWeight: 600 }}>Deleted — read-only</span>
            : <button onClick={onEdit} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #2563EB", background: "#fff", color: "#2563EB", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Edit</button>}
          <ActionButton action="delete" onClick={onDelete} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", background: "#FAFAFA" }}>
        <div style={{ maxWidth: PAGE_MAX, margin: "0 auto" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <StatusBadge status={order.status} />
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#111", fontFamily: "ui-monospace, Menlo, monospace" }}>{order.number}</div>
              <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>{order.client?.name || "—"}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#888" }}>Net total</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#111" }}>{fmtMoney(total, order.currency)}</div>
              {order.currency !== "PLN" && order.fxRate && <div style={{ fontSize: 12, color: "#888" }}>≈ {fmtMoney(total * order.fxRate, "PLN")} · rate {order.fxRate}</div>}
              {order.currency !== "PLN" && order.fxLockedAt && <div style={{ fontSize: 10.5, color: "#94A3B8" }} title="v6.95.0 (SO-8): the rate is a locked fact">rate {order.fxRate} locked {order.fxLockedAt}</div>}
              {(() => { const ev = deliveryEventFor(order.sellIncoterm); const act = actualDeliveryDate(order, shipments); const d = deliveryDelayDays(order, shipments);
                return <div style={{ fontSize: 10.5, color: d != null && d > 0 ? "#B45309" : "#94A3B8", marginTop: 2 }} title={`v6.95.0 (SO-3): for ${order.sellIncoterm || "these terms"} delivery means ${ev.where}`}>delivery ({ev.where}): planned {order.deliveryDate || "—"}{act ? ` · actual ${act}` : " · not yet"}{d != null ? ` · ${d > 0 ? d + " day(s) late" : d < 0 ? Math.abs(d) + " day(s) early" : "on time"}` : ""}</div>; })()}
            </div>
          </div>

          {overageCount > 0 && (
            <div style={{ padding: "12px 16px", background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 8, marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ fontSize: 20 }}>⚠️</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#92400E" }}>
                  {overageCount} line{overageCount === 1 ? "" : "s"} exceed available supply
                </div>
                <div style={{ fontSize: 11, color: "#92400E", marginTop: 4, lineHeight: 1.5 }}>
                  This SO promises more kg than what's currently available across stock + POs (after netting other active SOs). Edit the order to reduce qty, switch source, or arrange more supply.
                </div>
              </div>
            </div>
          )}

          {/* Lifecycle bar */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>LIFECYCLE</SectionTitle>
            <LifecycleBar status={order.status} />
            <div style={{ marginTop: 8, fontSize: 11, color: "#888", fontStyle: "italic" }}>{SO_STATUSES[order.status]?.desc}</div>
          </Card>

          {canSeePL ? (
            <SOMarginCard order={order} lots={lots} pos={pos} shipments={shipments} operationalCosts={operationalCosts} allOrders={allOrders} />
          ) : (
            <Card style={{ marginBottom: 16 }}>
              <SectionTitle>PROFITABILITY (P/L)</SectionTitle>
              <div style={{ fontSize: 12.5, color: "#888", lineHeight: 1.5 }}>
                Profitability is hidden for your role ({userRole || "—"}). {userRole === "Sales" ? "Sales users can see P/L only for orders they created." : "P/L is visible to Sales (own orders), Financial Director, and General Manager."} You can change the active role in Settings.
              </div>
            </Card>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
            <div>
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle>LINE ITEMS ({order.items.length})</SectionTitle>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
                      {/* v6.99.76 (A-SV-1, owner): Source · Product · Origin · Kl · Packaging · Boxes · Qty · Unit price · Total — the PO's box */}
                      {["Source", "Product", "Origin", "Kl.", "Packaging", "Boxes", "Qty kg", "Unit price", "Total"].map((h, i) => (
                        <th key={i} style={{ padding: "8px 6px", textAlign: i >= 5 ? "right" : i === 3 ? "center" : "left", fontSize: 10, color: "#888", fontWeight: 700, letterSpacing: "0.06em" }}>{h.toUpperCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((it, i) => {
                      const lt = lineTotalPU(it, PACKAGING_TYPES_REF); // v6.79.0: box-aware
                      const av = availability[i] || {};
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid #F9FAFB", background: av.hasOverage ? "#FFFBEB" : undefined }}>
                          <td style={{ padding: "10px 6px" }}><SourceBadge sourceType={it.sourceType} sourceRef={it.sourceRef} supplierName={it.sourceType === "PO" ? supplierNameForPO(it.sourceRef) : ""} /></td>
                          <td style={{ padding: "10px 6px" }}>
                            <div style={{ fontWeight: 600 }}>{it.product}{it.variety ? <span style={{ fontWeight: 400, color: "#666" }}> — {it.variety}</span> : null}</div>
                            {(it.size || it.coloration) && <div style={{ fontSize: 10.5, color: "#AAA" }}>{[it.size, it.coloration].filter(Boolean).join(" · ")}</div>}
                          </td>
                          <td style={{ padding: "10px 6px", color: "#555" }}>{it.origin || "—"}</td>
                          <td style={{ padding: "10px 6px", textAlign: "center" }}><QualityBadge quality={it.quality} /></td>
                          <td style={{ padding: "10px 6px", color: "#666", fontSize: 11.5 }}>{it.packaging || "—"}</td>
                          <td style={{ padding: "10px 6px", textAlign: "right", color: "#555" }}>{(() => { const bx = String(it.pricingUnit || "kg") !== "kg" ? parseFloat(it.boxes) : effectiveCounts(it, PACKAGING_TYPES_REF || []).boxes; return bx ? fmtNum(bx) : "—"; })()}</td>
                          <td style={{ padding: "10px 6px", textAlign: "right", fontWeight: 600 }}>
                            {fmtNum(it.qty)} kg
                            {av.hasOverage && (
                              <div style={{ fontSize: 10, color: "#92400E", fontWeight: 700, marginTop: 2 }}>
                                ⚠ short by {fmtNum(av.overage)} kg
                              </div>
                            )}
                            {it.sourceType && it.sourceRef && av.lineQty > 0 && !av.hasOverage && (
                              <div style={{ fontSize: 10, color: "#16A34A", fontWeight: 600, marginTop: 2 }}>
                                ✓ {fmtNum(av.combinedAvailable)} kg avail.
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "10px 6px", textAlign: "right" }}>{fmtMoney(it.unitPrice, order.currency)}</td>
                          <td style={{ padding: "10px 6px", textAlign: "right", fontWeight: 700 }}>{fmtMoney(lt, order.currency)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    {/* v6.99.76 (A-SV-1, owner): the PO's total row — boxes, kg and value under their own columns */}
                    <tr style={{ background: "#F9FAFB" }}>
                      <td colSpan={5} style={{ padding: "10px 6px", fontWeight: 700, color: "#111" }}>Total</td>
                      <td style={{ padding: "10px 6px", textAlign: "right", fontWeight: 700 }}>{fmtNum(order.items.reduce((s2: number, it: any) => s2 + ((String(it.pricingUnit || "kg") !== "kg" ? parseFloat(it.boxes) : effectiveCounts(it, PACKAGING_TYPES_REF || []).boxes) || 0), 0)) || "—"}</td>
                      <td style={{ padding: "10px 6px", textAlign: "right", fontWeight: 700 }}>{fmtNum(order.items.reduce((s2: number, it: any) => s2 + (parseFloat(it.qty) || 0), 0))} kg</td>
                      <td></td>
                      <td style={{ padding: "10px 6px", textAlign: "right", fontWeight: 700, fontSize: 14 }}>{fmtMoney(total, order.currency)}</td>
                    </tr>
                  </tfoot>
                </table>
              </Card>

              {/* v6.45.0: LINKED DOCUMENTS moved under Line items (user request) + renamed for consistency */}
              {(computedLinks.linkedInvoices?.length > 0 || computedLinks.linkedShipments?.length > 0) && (
                <Card style={{ marginBottom: 16 }}>
                  <SectionTitle>LINKED DOCUMENTS</SectionTitle>
                  {computedLinks.linkedInvoices?.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>SALES INVOICES</div>
                      {computedLinks.linkedInvoices.map(inv => (
                        <DocLink key={inv} num={inv} from={order.number}>                        <div style={{ display: "inline-block", padding: "4px 8px", margin: "2px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 5, fontSize: 11, fontWeight: 600, color: "#1D4ED8", fontFamily: "ui-monospace, Menlo, monospace" }}>{inv}</div></DocLink>
                      ))}
                    </div>
                  )}
                  {computedLinks.linkedShipments?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>SHIPMENTS</div>
                      {/* v6.54.0: these chips were plain text and so escaped the
                          cancelled-ref styling every other module applies — a
                          cancelled shipment read here exactly like a live one. */}
                      {computedLinks.linkedShipments.map(s => {
                        const dead = cancelledDocSet(shipments).has(String(s));
                        return (
                          <DocLink key={s} num={s} from={order.number}><div title={dead ? "Cancelled — kept on record, no longer active" : undefined}
                            style={{ display: "inline-block", padding: "4px 8px", margin: "2px", background: dead ? "#FEF2F2" : "#F3E8FF", border: `1px solid ${dead ? "#FECACA" : "#DDD6FE"}`, borderRadius: 5, fontSize: 11, fontWeight: 600, color: dead ? "#B91C1C" : "#7C3AED", fontFamily: "ui-monospace, Menlo, monospace", ...(dead ? { textDecoration: "line-through", textDecorationColor: "#DC2626", textDecorationThickness: "1.5px" } : {}) }}>{s}</div></DocLink>
                        );
                      })}
                    </div>
                  )}
                </Card>
              )}
              {order.notes && (
                <Card style={{ marginBottom: 16 }}>
                  <SectionTitle>NOTES</SectionTitle>
                  <div style={{ fontSize: 12.5, color: "#444", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{order.notes}</div>
                </Card>
              )}
            </div>

            <div>
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle>CLIENT</SectionTitle>{/* v6.99.76 (A-SV-2, owner): Client · NIP/VAT · Contact · e-mail — the PO's supplier box */}
                {(() => { const cl: any = order.client || {}; const row = (lbl: string, v: any, mono = false) => <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, color: "#888" }}>{lbl}</div><div style={{ fontSize: 12, color: "#444", fontFamily: mono ? "ui-monospace, Menlo, monospace" : "inherit" }}>{v || "—"}</div></div>;
                  return <div style={{ fontSize: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 8 }}>{cl.name || "—"}</div>
                    {row("NIP / VAT", cl.vatEuId || cl.nip, true)}
                    {row("Contact", [cl.contact, cl.phone].filter(Boolean).join(" · "))}
                    <div><div style={{ fontSize: 10, color: "#888" }}>Email</div>{cl.email ? <a href={`mailto:${cl.email}`} style={{ fontSize: 12, color: "#2563EB", textDecoration: "none" }}>{cl.email}</a> : <div style={{ fontSize: 12, color: "#444" }}>—</div>}</div>
                  </div>; })()}
              </Card>

              <Card style={{ marginBottom: 16 }}>
                <SectionTitle>ORDER DETAILS</SectionTitle>{/* v6.99.76 (A-SV-3, owner): was TERMS — one field per line, the PO's font; currency left to the totals */}
                <div style={{ display: "grid", gap: 10, fontSize: 12 }}>
                  <div><div style={{ fontSize: 10, color: "#888" }}>ORDER DATE</div><div style={{ fontWeight: 500 }}>{fmtDate(order.orderDate)}</div></div>
                  <div><div style={{ fontSize: 10, color: "#888" }}>EXPECTED LOADING DATE</div><div style={{ fontWeight: 500 }}>{fmtDate(order.expectedLoadingDate)}</div></div>
                  <div><div style={{ fontSize: 10, color: "#888" }}>EXPECTED DELIVERY DATE</div><div style={{ fontWeight: 500 }}>{fmtDate(order.deliveryDate)}</div></div>
                  <div><div style={{ fontSize: 10, color: "#888" }}>SALES INCOTERM</div><div style={{ fontWeight: 600 }}>{order.sellIncoterm || "—"}</div></div>
                  <div><div style={{ fontSize: 10, color: "#888" }}>DESTINATION</div><div style={{ fontWeight: 500 }}>{destinationLabel !== "—" ? `${(destination && (LOCATION_TYPES[destination.legacyType] || LOCATION_TYPES[destination.type])?.icon) || "📍"} ${destinationLabel}` : "—"}</div></div>
                  <div><div style={{ fontSize: 10, color: "#888" }}>PAYMENT</div><div style={{ fontWeight: 500 }}>{paymentText(order)}</div></div>
                  <div><div style={{ fontSize: 10, color: "#888" }}>IMPORT PERMIT NO.</div><div style={{ fontWeight: 500 }}>{order.importPermitNo || "—"}</div></div>
                  <div><div style={{ fontSize: 10, color: "#888" }}>ACID NO.</div><div style={{ fontWeight: 500 }}>{order.acidNo || "—"}</div></div>
                </div>
              </Card>

              {soInvoices.length > 0 && (
                <Card style={{ marginBottom: 16, border: "1px solid #BBF7D0", background: "#F0FDF4" }}>
                  <SectionTitle>SALES INVOICE READY</SectionTitle>
                  {soInvoices.map((inv, idx) => (
                    <div key={idx} style={{ background: "#fff", border: "1px solid #BBF7D0", borderRadius: 8, padding: "10px 12px", marginBottom: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: inv.paymentStatus === "Cancelled" ? "#B91C1C" : "#16A34A", textDecoration: inv.paymentStatus === "Cancelled" ? "line-through" : "none", fontFamily: "ui-monospace, Menlo, monospace" }}>{inv.number}</div>
                          <div style={{ fontSize: 10, color: "#888", marginTop: 1 }}>SINV · Issue {formatDMY(inv.issueDate)} · Due {formatDMY(inv.dueDate)}</div>
                        </div>
                        <div style={{ padding: "2px 8px", background: inv.paymentStatus === "Cancelled" ? "#FEF2F2" : "#DCFCE7", color: inv.paymentStatus === "Cancelled" ? "#B91C1C" : "#16A34A", borderRadius: 4, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em" }} title="v6.80.0 (D-44): the register's own status — not a fixed 'READY'">{String(inv.paymentStatus || "Draft").toUpperCase()}</div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 11, color: "#444" }}>
                        <div>Net: <strong>{fmtMoney(inv.netAmount, inv.currency)}</strong></div>
                        <div>VAT ({inv.vatRate}%): <strong>{fmtMoney(inv.vatAmount, inv.currency)}</strong></div>
                        <div style={{ gridColumn: "span 2", paddingTop: 4, borderTop: "1px solid #F3F4F6" }}>Gross: <strong style={{ fontSize: 13, color: "#111" }}>{fmtMoney(inv.grossAmount, inv.currency)}</strong></div>
                      </div>
                    </div>
                  ))}
                  {soInvoices.some(inv => inv.paymentStatus !== "Cancelled" && (inv.fakturownia?.exported || inv.fakturownia?.fktId)) ? (
                    <div style={{ fontSize: 10.5, color: "#0C4A6E", marginTop: 8, lineHeight: 1.5, padding: "7px 10px", background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 6 }}>
                      {soInvoices.filter(inv => inv.paymentStatus !== "Cancelled" && (inv.fakturownia?.exported || inv.fakturownia?.fktId)).map((inv, i) => (
                        <div key={i}>✓ Matched in Fakturownia{inv.fakturownia?.ksef ? <> · KSeF <span style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{inv.fakturownia.ksef}</span></> : null} · <strong>{inv.fakturownia?.paid ? "PAID" : "unpaid"}</strong></div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 10, color: "#16A34A", marginTop: 8, lineHeight: 1.4, fontStyle: "italic" }}>
                      Enter this invoice in Fakturownia, then use "Match from Fakturownia" to pull its KSeF number and paid status.
                    </div>
                  )}
                  {fktConfigured && (
                    <button onClick={() => onMatchInvoices(order)} disabled={fktMatching} style={{ marginTop: 8, padding: "6px 12px", borderRadius: 7, border: "none", background: fktMatching ? "#A7F3D0" : "#16A34A", color: "#fff", fontSize: 11.5, fontWeight: 700, cursor: fktMatching ? "wait" : "pointer", fontFamily: "inherit" }}>{fktMatching ? "Matching…" : "↻ Match from Fakturownia (read-only)"}</button>
                  )}
                  {fktMatchMsg && <div style={{ fontSize: 10.5, color: fktMatchMsg.kind === "error" ? "#DC2626" : "#15803D", marginTop: 6 }}>{fktMatchMsg.text}</div>}
                </Card>
              )}


            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
