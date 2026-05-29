import React, { useMemo, useState } from "react";
import { aggregateMargins, groupAndAggregateMargins, computeSOMargin, MarginMode } from "./marginCalculations";

// ─── FINANCE MODULE ─────────────────────────────────────────────────────────
// Aggregate P/L view across all Sales Orders. Reads live state and shows
// breakdowns by client, product, and month, plus a top-line summary.
//
// Phase 1: P/L analytics (this module). Phase 2 will add: receivables aging,
// cash flow forecast, supplier payment schedules, FX exposure analysis.
//
// All numbers come from marginCalculations.ts — single source of truth.

function fmtPLN(n: number): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Math.round(n).toLocaleString("pl-PL") + " PLN";
}
function fmtPLNcompact(n: number): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M PLN";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "k PLN";
  return Math.round(n).toLocaleString("pl-PL") + " PLN";
}
function fmtPct(n: number): string {
  if (!isFinite(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
}

function Card({ children, style }: any) {
  return <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "18px 20px", ...style }}>{children}</div>;
}

function SectionTitle({ children, right }: any) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em" }}>{children}</div>
      {right}
    </div>
  );
}

// Stat block — used in the top summary row
function StatBlock({ label, value, valueColor, sub }: any) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: "#888", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: valueColor || "#111", marginTop: 4, letterSpacing: "-0.3px" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// Horizontal bar row — used in client / product / month breakdowns
function BarRow({ label, value, maxValue, marginPct, sub }: any) {
  const pct = maxValue > 0 ? Math.max(0, Math.min(100, (Math.abs(value) / maxValue) * 100)) : 0;
  const isLoss = value < 0;
  const isThinMargin = marginPct !== undefined && marginPct >= 0 && marginPct < 5;
  const color = isLoss ? "#DC2626" : isThinMargin ? "#D97706" : "#16A34A";

  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid #F9FAFB" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <div style={{ fontSize: 12.5, color: "#444", fontWeight: 500 }}>
          {label}
          {sub && <span style={{ color: "#AAA", marginLeft: 6, fontSize: 11 }}>· {sub}</span>}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          <div style={{ fontSize: 12.5, color, fontWeight: 600 }}>{fmtPLN(value)}</div>
          {marginPct !== undefined && (
            <div style={{ fontSize: 11, color, fontWeight: 500, width: 50, textAlign: "right" }}>{fmtPct(marginPct)}</div>
          )}
        </div>
      </div>
      <div style={{ height: 5, background: "#F3F4F6", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

export default function Finance({
  orders = [],
  lots = [],
  pos = [],
  shipments = [],
}: {
  orders?: any[];
  lots?: any[];
  pos?: any[];
  shipments?: any[];
}) {
  const [mode, setMode] = useState<MarginMode>("forecast");

  // Top-line aggregate — exclude Draft (no commitment yet) and Cancelled
  const totalAgg = useMemo(
    () => aggregateMargins(orders, lots, pos, shipments, mode, o => o.status !== "Draft"),
    [orders, lots, pos, shipments, mode]
  );

  // Delivered-only aggregate (real revenue & costs from settled orders)
  const deliveredAgg = useMemo(
    () => aggregateMargins(orders, lots, pos, shipments, mode, o => ["Shipped", "Delivered", "Invoiced", "Closed"].includes(o.status)),
    [orders, lots, pos, shipments, mode]
  );

  // In-pipeline aggregate (active but not yet shipped)
  const pipelineAgg = useMemo(
    () => aggregateMargins(orders, lots, pos, shipments, mode, o => ["Confirmed", "Reserved", "Loading"].includes(o.status)),
    [orders, lots, pos, shipments, mode]
  );

  // By client (exclude Drafts which haven't been committed yet)
  const byClient = useMemo(
    () => groupAndAggregateMargins(orders, lots, pos, shipments, mode, o => o.client?.name || "—", o => o.status !== "Draft").slice(0, 10),
    [orders, lots, pos, shipments, mode]
  );

  // By product family (use first product on each SO — most SOs have one anyway)
  const byProduct = useMemo(
    () => groupAndAggregateMargins(orders, lots, pos, shipments, mode, o => (o.items && o.items[0]?.product) || "—", o => o.status !== "Draft").slice(0, 10),
    [orders, lots, pos, shipments, mode]
  );

  // By month (use orderDate YYYY-MM)
  const byMonth = useMemo(() => {
    const groups = groupAndAggregateMargins(orders, lots, pos, shipments, mode, o => (o.orderDate || "").substring(0, 7) || "—", o => o.status !== "Draft");
    // Sort by month ascending for trend view
    return groups.sort((a, b) => a.key.localeCompare(b.key));
  }, [orders, lots, pos, shipments, mode]);

  // Most recent 6 months
  const recentMonths = byMonth.slice(-6);

  // Find max for bar scaling
  const maxClientMargin = Math.max(...byClient.map(g => Math.abs(g.agg.totalMarginPLN)), 1);
  const maxProductMargin = Math.max(...byProduct.map(g => Math.abs(g.agg.totalMarginPLN)), 1);
  const maxMonthMargin = Math.max(...recentMonths.map(g => Math.abs(g.agg.totalMarginPLN)), 1);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "24px 28px", background: "#FAFAFA" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#111", letterSpacing: "-0.3px" }}>Finance · P&L Analytics</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
              {mode === "forecast"
                ? "Forecast view — full commitments, expected costs"
                : "Actual view — shipped revenue, settled costs"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 2, background: "#F3F4F6", padding: 3, borderRadius: 7 }}>
            {(["forecast", "actual"] as MarginMode[]).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                padding: "6px 14px", borderRadius: 5,
                border: "none",
                background: mode === m ? "#fff" : "transparent",
                color: mode === m ? "#111" : "#666",
                fontSize: 12, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
                boxShadow: mode === m ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                textTransform: "capitalize",
              }}>{m}</button>
            ))}
          </div>
        </div>

        {/* Top KPIs */}
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle>OVERALL · ALL ACTIVE SALES ORDERS</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            <StatBlock
              label="REVENUE"
              value={fmtPLN(totalAgg.totalRevenuePLN)}
              sub={`${totalAgg.orderCount} order${totalAgg.orderCount === 1 ? "" : "s"}`}
            />
            <StatBlock
              label="COGS"
              value={fmtPLN(totalAgg.totalCOGSPLN)}
              valueColor="#7C3AED"
              sub="cost of goods sold"
            />
            <StatBlock
              label="DIRECT COSTS"
              value={fmtPLN(totalAgg.totalDirectPLN)}
              valueColor="#F59E0B"
              sub="logistics from shipments"
            />
            <StatBlock
              label="MARGIN"
              value={fmtPLN(totalAgg.totalMarginPLN)}
              valueColor={totalAgg.totalMarginPLN < 0 ? "#DC2626" : "#16A34A"}
              sub={fmtPct(totalAgg.avgMarginPct) + " average"}
            />
          </div>
        </Card>

        {/* Two-column: Pipeline vs Delivered */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
          <Card>
            <SectionTitle>PIPELINE — CONFIRMED / RESERVED / LOADING</SectionTitle>
            <div style={{ fontSize: 28, fontWeight: 700, color: pipelineAgg.totalMarginPLN < 0 ? "#DC2626" : "#16A34A", letterSpacing: "-0.5px" }}>
              {fmtPLN(pipelineAgg.totalMarginPLN)}
            </div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
              expected margin · {fmtPct(pipelineAgg.avgMarginPct)} on {fmtPLN(pipelineAgg.totalRevenuePLN)} revenue
            </div>
            <div style={{ fontSize: 11, color: "#AAA", marginTop: 6 }}>
              {pipelineAgg.orderCount} order{pipelineAgg.orderCount === 1 ? "" : "s"} not yet shipped
            </div>
          </Card>
          <Card>
            <SectionTitle>DELIVERED — SHIPPED / INVOICED / CLOSED</SectionTitle>
            <div style={{ fontSize: 28, fontWeight: 700, color: deliveredAgg.totalMarginPLN < 0 ? "#DC2626" : "#16A34A", letterSpacing: "-0.5px" }}>
              {fmtPLN(deliveredAgg.totalMarginPLN)}
            </div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
              realized margin · {fmtPct(deliveredAgg.avgMarginPct)} on {fmtPLN(deliveredAgg.totalRevenuePLN)} revenue
            </div>
            <div style={{ fontSize: 11, color: "#AAA", marginTop: 6 }}>
              {deliveredAgg.orderCount} order{deliveredAgg.orderCount === 1 ? "" : "s"} settled
            </div>
          </Card>
        </div>

        {/* Two-column: by Client + by Product */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
          <Card>
            <SectionTitle>TOP CLIENTS BY MARGIN</SectionTitle>
            {byClient.length === 0 ? (
              <div style={{ fontSize: 12, color: "#AAA", padding: "12px 0" }}>No data yet.</div>
            ) : (
              byClient.map(g => (
                <BarRow
                  key={g.key}
                  label={g.key}
                  value={g.agg.totalMarginPLN}
                  maxValue={maxClientMargin}
                  marginPct={g.agg.avgMarginPct}
                  sub={`${g.agg.orderCount} order${g.agg.orderCount === 1 ? "" : "s"} · ${fmtPLNcompact(g.agg.totalRevenuePLN)} revenue`}
                />
              ))
            )}
          </Card>

          <Card>
            <SectionTitle>TOP PRODUCTS BY MARGIN</SectionTitle>
            {byProduct.length === 0 ? (
              <div style={{ fontSize: 12, color: "#AAA", padding: "12px 0" }}>No data yet.</div>
            ) : (
              byProduct.map(g => (
                <BarRow
                  key={g.key}
                  label={g.key}
                  value={g.agg.totalMarginPLN}
                  maxValue={maxProductMargin}
                  marginPct={g.agg.avgMarginPct}
                  sub={`${g.agg.orderCount} order${g.agg.orderCount === 1 ? "" : "s"} · ${fmtPLNcompact(g.agg.totalRevenuePLN)} revenue`}
                />
              ))
            )}
          </Card>
        </div>

        {/* Monthly trend */}
        <Card>
          <SectionTitle>MONTHLY MARGIN — LAST 6 MONTHS</SectionTitle>
          {recentMonths.length === 0 ? (
            <div style={{ fontSize: 12, color: "#AAA", padding: "12px 0" }}>No data yet.</div>
          ) : (
            recentMonths.map(g => (
              <BarRow
                key={g.key}
                label={g.key}
                value={g.agg.totalMarginPLN}
                maxValue={maxMonthMargin}
                marginPct={g.agg.avgMarginPct}
                sub={`${g.agg.orderCount} order${g.agg.orderCount === 1 ? "" : "s"} · ${fmtPLNcompact(g.agg.totalRevenuePLN)} revenue`}
              />
            ))
          )}
        </Card>

        {/* Footer note */}
        <div style={{ marginTop: 16, padding: "12px 16px", background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 8, fontSize: 11, color: "#92400E", lineHeight: 1.5 }}>
          <strong>P&L scope (Phase 1):</strong> Revenue × COGS × Direct logistics costs. Overhead allocation (rent, salaries, software) is excluded — it'll be added as configurable Phase 2 work. Currency: PLN. Cancelled SOs are excluded from all aggregates.
        </div>

        <div style={{ marginTop: 12, fontSize: 11, color: "#AAA", textAlign: "center" }}>
          Phase 2 will add: receivables aging · cash flow forecast · supplier payment schedule · FX exposure
        </div>
      </div>
    </div>
  );
}
