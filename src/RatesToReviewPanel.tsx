// RatesToReviewPanel.tsx — v7.33.2 (FX-1): "Rates to review", in Finance › Operational Costs and on the Shipments screen while any remain.
// The NBP tables of the dates in the list are read first; then every listed rate can be set to its date's NBP rate in one click, or kept.
import React, { useEffect, useMemo, useState } from "react";
import { ensureNbpRange, fxRateFor } from "./fx";
import { ratesToReview, applyRates } from "./rateReview.domain";
import { recordAudit } from "./audit";
import { addDaysISO } from "./dates";

export function RatesToReviewPanel({ shipments = null, setShipments = null, operationalCosts = null, setOperationalCosts = null }: any) {
  const [tick, setTick] = useState(0); const [open, setOpen] = useState(false);
  const data = { shipments: shipments || [], operationalCosts: operationalCosts || [] };
  const items = useMemo(() => ratesToReview(data, (c, d) => fxRateFor(c, d)), [shipments, operationalCosts, tick]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const dates = items.map(i => i.date).sort(); if (!dates.length) return;
    ensureNbpRange(addDaysISO(dates[0], -14), dates[dates.length - 1]).then(() => setTick(x => x + 1)); }, [items.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return null;
  const apply = (mode: "nbp" | "agreed", list = items) => { const r = applyRates(data, list, mode);
    if (shipments && typeof setShipments === "function" && list.some(i => i.key.startsWith("sh:"))) setShipments(() => r.shipments);
    if (operationalCosts && typeof setOperationalCosts === "function" && list.some(i => i.key.startsWith("op:"))) setOperationalCosts(() => r.operationalCosts);
    recordAudit({ module: shipments ? "Shipments" : "Finance", docType: "Rates", docNumber: `${list.length} record(s)`, action: "updated", summary: mode === "nbp" ? `NBP rate of each record's own date set on ${list.length} record(s) — FX-1` : `${list.length} rate(s) kept as agreed — FX-1` }); };
  const ready = items.filter(i => i.nbp != null);
  return <div data-rates-to-review="1" style={{ border: "1px solid #FDE68A", background: "#FFFBEB", borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 12 }}>
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <b style={{ fontSize: 13 }}>Rates to review — {items.length}</b>
      <span style={{ color: "#92400E" }}>A foreign-currency amount takes the NBP rate of the last working day before its own date; these have none, or another.</span>
      {ready.length > 0 && <button type="button" onClick={() => apply("nbp", ready)} style={{ marginLeft: "auto", padding: "5px 10px", borderRadius: 7, border: "1px solid #CA8A04", background: "#fff", color: "#92400E", fontWeight: 700, cursor: "pointer" }}>Set the NBP rate on all {ready.length}</button>}
      <button type="button" onClick={() => setOpen(o => !o)} style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer" }}>{open ? "Hide" : "Review"}</button>
    </div>
    {open && <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}><tbody>{items.map(i => <tr key={i.key} style={{ borderTop: "1px solid #FEF3C7" }}>
      <td style={{ padding: "4px 6px" }}>{i.kind}</td><td style={{ padding: "4px 6px" }}>{i.ref}</td><td style={{ padding: "4px 6px" }}>{i.date.split("-").reverse().join("/")}</td>
      <td style={{ padding: "4px 6px" }}>{i.currency} {i.rate > 1 ? i.rate.toFixed(4) : "no rate"}</td><td style={{ padding: "4px 6px", fontWeight: 700 }}>{i.nbp != null ? `NBP ${i.nbp.toFixed(4)}` : "NBP not read yet"}</td>
      <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>{i.nbp != null && <button type="button" onClick={() => apply("nbp", [i])} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer" }}>Set NBP</button>} <button type="button" onClick={() => apply("agreed", [i])} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer" }}>Keep (agreed)</button></td>
    </tr>)}</tbody></table>}
  </div>;
}
