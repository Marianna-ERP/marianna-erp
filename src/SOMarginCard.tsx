import React, { useMemo, useState } from "react";
import { MarginMode } from "./marginCalculations";
import { computeSOMarginWithOverhead } from "./operationalCosts";

// ─── SO MARGIN CARD ─────────────────────────────────────────────────────────
// Drop-in component rendered inside OrderDetail. Shows revenue, COGS, direct
// costs, and the resulting margin for one SO, with a toggle between Forecast
// and Actual views.
//
// Designed to read live state from props — no internal data fetching, no
// localStorage, no side effects. Pure presentation.

function fmtPLN(n: number): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " PLN";
}
function fmtSO(n: number, currency: string): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + currency;
}
function fmtPct(n: number): string {
  if (!isFinite(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
}

export default function SOMarginCard({
  order,
  lots = [],
  pos = [],
  shipments = [],
  operationalCosts = [],
  allOrders = [],
}: {
  order: any;
  lots?: any[];
  pos?: any[];
  shipments?: any[];
  operationalCosts?: any[];
  allOrders?: any[];
}) {
  const [mode, setMode] = useState<MarginMode>(() => {
    // Default heuristic: if SO is Confirmed/Reserved/Loading, show Forecast.
    // If SO is Shipped/Delivered/Invoiced/Closed, show Actual.
    // Draft → Forecast. User can flip.
    const settled = ["Shipped", "Delivered", "Invoiced", "Closed"].includes(order.status);
    return settled ? "actual" : "forecast";
  });

  const margin = useMemo(
    () => computeSOMarginWithOverhead(order, lots, pos, shipments, mode, operationalCosts, allOrders),
    [order, lots, pos, shipments, operationalCosts, allOrders, mode]
  );

  // v6.6: consignment awareness — sources from consignment lots mean P/L will
  // equal our commission once the settlement closes; before that, COGS is absent.
  const consignmentSources = React.useMemo(() => {
    const hits: any[] = [];
    (order.items || []).forEach((it: any) => {
      const lot = (lots || []).find((l: any) =>
        (it.sourceType === "STOCK" && String(it.sourceRef) === String(l.number)) ||
        (it.sourceType === "PO" && l.poRef && String(it.sourceRef) === String(l.poRef) && String(it.product || "").trim().toLowerCase() === String(l.product || "").trim().toLowerCase()));
      if (lot && lot.consignment && !hits.find(h => h.number === lot.number)) hits.push(lot);
    });
    return hits;
  }, [order, lots]);
  const openConsignment = consignmentSources.filter((l: any) => !(l.settlement && l.settlement.status === "Closed"));

  const isLoss = margin.netMarginPLN < 0;
  const isThinMargin = margin.netMarginPLN >= 0 && margin.netMarginPct < 5;
  const marginColor = isLoss ? "#DC2626" : isThinMargin ? "#D97706" : "#16A34A";

  return (
    <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
      {/* Header with toggle */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em" }}>PROFITABILITY · P&L</div>
          <div style={{ fontSize: 10.5, color: "#888", marginTop: 2 }}>
            {mode === "forecast"
              ? "Forecast — full SO commitment, expected costs"
              : "Actual — shipped quantities, settled costs"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 2, background: "#F3F4F6", padding: 3, borderRadius: 7 }}>
          {(["forecast", "actual"] as MarginMode[]).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: "5px 12px", borderRadius: 5,
              border: "none",
              background: mode === m ? "#fff" : "transparent",
              color: mode === m ? "#111" : "#666",
              fontSize: 11, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
              boxShadow: mode === m ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
              textTransform: "capitalize",
            }}>{m}</button>
          ))}
        </div>
      </div>

      {/* Big numbers row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 10, color: "#888" }}>REVENUE</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#111", marginTop: 2 }}>{fmtSO(margin.revenueSO, margin.currency)}</div>
          {margin.currency !== "PLN" && (
            <div style={{ fontSize: 11, color: "#888" }}>{fmtPLN(margin.revenuePLN)}</div>
          )}
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#888" }}>CONTRIBUTION</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: margin.contributionMarginPLN < 0 ? "#DC2626" : "#16A34A", marginTop: 2 }}>{fmtPLN(margin.contributionMarginPLN)}</div>
          <div style={{ fontSize: 11, color: "#888" }}>{fmtPct(margin.contributionMarginPct)} before overhead</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#888" }}>ALLOCATED OVERHEAD</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#64748B", marginTop: 2 }}>{fmtPLN(margin.overheadCostsPLN)}</div>
          <div style={{ fontSize: 11, color: "#888" }}>{margin.overheadLines.length} overhead line(s)</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#888" }}>NET P/L</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: marginColor, marginTop: 2 }}>{fmtPLN(margin.netMarginPLN)}</div>
          <div style={{ fontSize: 12, color: marginColor, fontWeight: 600 }}>{fmtPct(margin.netMarginPct)}</div>
          {margin.currency !== "PLN" && (
            <div style={{ fontSize: 11, color: "#888" }}>{fmtSO(margin.netMarginSO, margin.currency)}</div>
          )}
        </div>
      </div>

      {/* Stacked bar showing cost composition */}
      {margin.revenuePLN > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: "#F3F4F6", border: "1px solid #F3F4F6" }}>
            {margin.cogsPLN > 0 && (
              <div title={`COGS: ${fmtPLN(margin.cogsPLN)}`} style={{ flex: margin.cogsPLN, background: "#7C3AED" }} />
            )}
            {margin.directCostsPLN > 0 && (
              <div title={`Direct: ${fmtPLN(margin.directCostsPLN)}`} style={{ flex: margin.directCostsPLN, background: "#F59E0B" }} />
            )}
            {margin.overheadCostsPLN > 0 && (
              <div title={`Overhead: ${fmtPLN(margin.overheadCostsPLN)}`} style={{ flex: margin.overheadCostsPLN, background: "#64748B" }} />
            )}
            {!isLoss && margin.netMarginPLN > 0 && (
              <div title={`Net P/L: ${fmtPLN(margin.netMarginPLN)}`} style={{ flex: margin.netMarginPLN, background: "#16A34A" }} />
            )}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 10.5, color: "#666", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 8, height: 8, background: "#7C3AED", borderRadius: 2 }} />
              <span>COGS {fmtPLN(margin.cogsPLN)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 8, height: 8, background: "#F59E0B", borderRadius: 2 }} />
              <span>Direct {fmtPLN(margin.directCostsPLN)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 8, height: 8, background: "#64748B", borderRadius: 2 }} />
              <span>Overhead {fmtPLN(margin.overheadCostsPLN)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 8, height: 8, background: marginColor, borderRadius: 2 }} />
              <span>Net P/L {fmtPLN(margin.netMarginPLN)}</span>
            </div>
          </div>
        </div>
      )}

      {consignmentSources.length > 0 && (
        <div style={{ padding: "8px 12px", background: "#FAF5FF", border: "1px solid #DDD6FE", borderRadius: 6, fontSize: 12, color: "#6D28D9", marginBottom: 12 }}>
          ⚖ This SO sells <strong>consignment goods</strong> ({consignmentSources.map((l: any) => l.number).join(", ")}).
          {openConsignment.length
            ? " The producer's price is settled from sales — figures above EXCLUDE the producer cost until the settlement closes; the final P/L will equal your commission."
            : " Settlement closed — the producer invoice and your commission are in the costs, so the P/L above is final (≈ your commission)."}
        </div>
      )}
      {/* Loss warning */}
      {isLoss && (
        <div style={{ padding: "8px 12px", background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 6, fontSize: 12, color: "#991B1B", marginBottom: 12 }}>
          ⚠ This SO is currently {mode === "forecast" ? "projected to lose" : "showing a loss of"} <strong>{fmtPLN(Math.abs(margin.netMarginPLN))}</strong>.
          {mode === "forecast"
            ? " Review costs and sales prices before confirming."
            : " Costs exceed revenue — investigate underlying cost components below."}
        </div>
      )}
      {isThinMargin && !isLoss && (
        <div style={{ padding: "8px 12px", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 6, fontSize: 12, color: "#92400E", marginBottom: 12 }}>
          ⚠ Net margin is thin ({fmtPct(margin.netMarginPct)}) — small cost increases could turn this into a loss.
        </div>
      )}

      {/* Warnings */}
      {margin.warnings.length > 0 && (
        <div style={{ padding: "8px 12px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 6, fontSize: 11, color: "#1E40AF", marginBottom: 12 }}>
          {margin.warnings.map((w, i) => <div key={i}>· {w}</div>)}
        </div>
      )}

      {/* Detailed breakdown — collapsible would be nice but kept open for now */}
      <details>
        <summary style={{ fontSize: 11.5, color: "#666", fontWeight: 600, cursor: "pointer", padding: "4px 0" }}>
          Show cost breakdown
        </summary>
        <div style={{ marginTop: 10, fontSize: 11.5 }}>
          {/* Revenue lines */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#AAA", letterSpacing: "0.04em", marginBottom: 4 }}>REVENUE LINES</div>
            {margin.revenueLines.map((l, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #F9FAFB", color: l.amountSO === 0 ? "#AAA" : "#444" }}>
                <span>{l.label}{l.note ? <span style={{ color: "#999", fontSize: 10.5 }}> — {l.note}</span> : null}</span>
                <span style={{ fontWeight: 500 }}>{fmtSO(l.amountSO || 0, margin.currency)}</span>
              </div>
            ))}
          </div>

          {/* COGS lines */}
          {margin.cogsLines.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#AAA", letterSpacing: "0.04em", marginBottom: 4 }}>COGS LINES</div>
              {margin.cogsLines.map((l, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #F9FAFB", color: "#444" }}>
                  <span>{l.label}{l.note ? <span style={{ color: "#999", fontSize: 10.5 }}> — {l.note}</span> : null}</span>
                  <span style={{ fontWeight: 500 }}>{fmtPLN(l.amountPLN)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Direct cost lines */}
          {margin.directLines.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#AAA", letterSpacing: "0.04em", marginBottom: 4 }}>DIRECT / LOGISTICS COSTS</div>
              {margin.directLines.map((l, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #F9FAFB", color: "#444" }}>
                  <span>{l.label}{l.note ? <span style={{ color: "#999", fontSize: 10.5 }}> — {l.note}</span> : null}</span>
                  <span style={{ fontWeight: 500 }}>{fmtPLN(l.amountPLN)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Overhead lines */}
          {margin.overheadLines.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#AAA", letterSpacing: "0.04em", marginBottom: 4 }}>ALLOCATED OPERATIONAL OVERHEAD</div>
              {margin.overheadLines.map((l, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #F9FAFB", color: "#444" }}>
                  <span>{l.label}{l.note ? <span style={{ color: "#999", fontSize: 10.5 }}> — {l.note}</span> : null}</span>
                  <span style={{ fontWeight: 500 }}>{fmtPLN(l.amountPLN)}</span>
                </div>
              ))}
            </div>
          )}

          {margin.cogsLines.length === 0 && margin.directLines.length === 0 && (
            <div style={{ fontSize: 11, color: "#AAA", fontStyle: "italic", padding: "8px 0" }}>
              No COGS, direct costs or overhead computed yet.
              {mode === "actual" && " For Actual view, costs only show after lot cost data exists and shipments have invoiced costs."}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
