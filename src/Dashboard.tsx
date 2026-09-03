import React, { useMemo } from "react";
import { fmtNum } from "./format";
import { Card } from "./ui";
import { SO_PRE_DISPATCH_STATUSES as PRE_DISPATCH_STATUSES } from "./types";
import { aggregateNetMargins } from "./operationalCosts";
import { localMonthISO, localTodayISO } from "./dates";
import { buildLedger } from "./ledger";
import { claimsNeedingNotice, addDays } from "./claimReadiness.domain";

// ─── DASHBOARD ──────────────────────────────────────────────────────────────
// Phase 1 dashboard: reads live state from PO / SO / Inventory / Contacts and
// renders a KPI overview. No own state, no mutations — pure consumer.
//
// The shell passes in: { pos, orders, lots, contacts, onNavigate }
//
// "onNavigate(moduleKey)" lets dashboard buttons jump to a module ("Open PO" etc.)

// PRE_DISPATCH set imported from ./types (Batch 0).

function fmtMoney(n, cur = "PLN") {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return `${Number(n).toLocaleString("pl-PL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ${cur}`;
}


function MiniBar({ items }: any) {
  const total = items.reduce((s, it) => s + (it.val || 0), 0);
  if (total === 0) return <div style={{ height: 4, background: "#F3F4F6", borderRadius: 3 }} />;
  return (
    <div style={{ display: "flex", gap: 3, height: 4, borderRadius: 3, overflow: "hidden", background: "#F3F4F6" }}>
      {items.map((it, j) => it.val > 0 ? (
        <div key={j} style={{ flex: it.val, background: it.color, borderRadius: 3 }} />
      ) : null)}
    </div>
  );
}

function KpiCard({ label, value, valueColor, tag, sub, items, onClick }: any) {
  return (
    <div onClick={onClick} style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "16px 18px", cursor: onClick ? "pointer" : "default", transition: "border 0.15s" }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.borderColor = "#111"; }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.borderColor = "#EBEBEB"; }}>
      <div style={{ fontSize: 11, color: "#888", fontWeight: 600, marginBottom: 8, letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: valueColor || "#111", letterSpacing: "-0.5px", lineHeight: 1 }}>{value}</div>
      {tag && <div style={{ fontSize: 12, color: valueColor || "#2563EB", marginTop: 4, fontWeight: 500 }}>{tag}</div>}
      {sub && <div style={{ fontSize: 12, color: "#AAA", marginBottom: 12 }}>{sub}</div>}
      {items && items.length > 0 && (
        <>
          <div style={{ marginTop: 8, marginBottom: 8 }}><MiniBar items={items} /></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
            {items.map((it, j) => (
              <div key={j} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#888" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: it.color }} />
                <span>{it.label} <strong style={{ color: "#444" }}>{it.val}</strong></span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Dashboard({ pos = [], orders = [], lots = [], contacts = [], shipments = [], operationalCosts = [], invoices = [], claims = [], financeNotes = [], onNavigate = () => {} }: any) {
  // v6.80.0 (D-51, owner review): the Dashboard answers "what needs my attention TODAY";
  // Finance answers "how are we doing". These tiles are EXCEPTIONS that open their module —
  // no totals, no breakdowns, nothing the Finance P/L already shows.
  const attention = useMemo(() => {
    const today = localTodayISO();
    const led = buildLedger({ invoices, financeNotes, orders, lots, pos, warehouseInvoices: [], operationalCosts: [], todayISO: today });
    const overdue = led.items.filter(i => i.direction === "receivable" && i.status === "Overdue");
    const in7 = (d: string) => d && d >= today && d <= addDays(today, 7);
    const payDue = led.items.filter(i => i.direction === "payable" && i.status !== "Paid" && in7(i.dueDate));
    const stockLots = (lots || []).filter((l: any) => (Number(l.physicalKg) || 0) > 0);
    const stockKg = stockLots.reduce((s: number, l: any) => s + (Number(l.physicalKg) || 0), 0);
    const stockValue = stockLots.reduce((s: number, l: any) => { const kg = Number(l.receivedKg) || Number(l.physicalKg) || 0; const cost = (l.costs || []).reduce((a: number, c: any) => a + (Number(c.pln) || 0), 0); return s + (kg > 0 ? cost / kg * (Number(l.physicalKg) || 0) : 0); }, 0);
    const ageing = stockLots.filter((l: any) => { const lastIn = (l.movements || []).filter((m: any) => m.type === "IN" && !m.voided).map((m: any) => String(m.date || "")).sort().pop(); return lastIn && lastIn < addDays(today, -30); }).length;
    const notices = claimsNeedingNotice(claims, today);
    return { overdueCount: overdue.length, overduePLN: overdue.reduce((s, i) => s + i.amountPLN, 0), payDueCount: payDue.length, payDuePLN: payDue.reduce((s, i) => s + i.amountPLN, 0), stockKg, stockValue, ageing, notices: notices.length };
  }, [invoices, financeNotes, orders, lots, pos, claims]);
  // ── PO summary ─────────────────────────────────────────────────────────
  // v6.40.1 (audit A2): DERIVED truth, not statuses — PO statuses beyond
  // Confirmed are manual-only (nothing auto-advances them; same finding as the
  // v6.36.1 PO-KPI fix). The widget now derives its buckets from real linked
  // lots and shipments, like the PO module's own KPIs.
  const openPOs = pos.filter(p => p.status !== "Closed" && p.status !== "Cancelled");
  const poGoodsIn = (p: any) => lots.some((l: any) => l.poRef === p.number && ((parseFloat(l.receivedKg) || 0) > 0 || (parseFloat(l.physicalKg) || 0) > 0));
  const poInTransit = (p: any) => shipments.some((s: any) => (s.poRefs || []).includes(p.number) && s.status !== "Cancelled" && s.status !== "Draft");
  const activePOCount = openPOs.length;
  const activePOValuePLN = openPOs
    .reduce((sum, p) => {
      const lineSum = (p.items || []).reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.unitPrice) || 0), 0);
      return sum + lineSum * (p.fxRate || 1);
    }, 0);
  const poBuckets = {
    draft: openPOs.filter(p => p.status === "Draft").length,
    awaiting: openPOs.filter(p => p.status !== "Draft" && !poGoodsIn(p) && !poInTransit(p)).length,
    transit: openPOs.filter(p => p.status !== "Draft" && !poGoodsIn(p) && poInTransit(p)).length,
    goodsIn: openPOs.filter(p => p.status !== "Draft" && poGoodsIn(p)).length,
  };

  // ── SO summary ─────────────────────────────────────────────────────────
  const soByStatus = useMemo(() => {
    const m: any = {};
    orders.forEach(o => { m[o.status] = (m[o.status] || 0) + 1; });
    return m;
  }, [orders]);

  const activeSOStatuses = new Set(["Draft", "Confirmed", "Reserved", "Loading", "Shipped"]);
  const activeSOCount = orders.filter(o => activeSOStatuses.has(o.status)).length;
  const activeSOValuePLN = orders
    .filter(o => activeSOStatuses.has(o.status))
    .reduce((sum, o) => {
      const lineSum = (o.items || []).reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.unitPrice) || 0), 0);
      return sum + lineSum * (o.fxRate || 1);
    }, 0);

  const upcomingDeliveryCount = orders.filter(o => {
    if (!o.deliveryDate || !activeSOStatuses.has(o.status)) return false;
    // v6.4.1 fix: midnight-normalized so an SO delivering TODAY counts as upcoming (day 0).
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const days = Math.round((new Date(o.deliveryDate).getTime() - startOfToday.getTime()) / 86400000);
    return days >= 0 && days <= 7;
  }).length;

  // ── Inventory summary ──────────────────────────────────────────────────
  const inStockLots = lots.filter(l => l.status === "In Stock");
  const totalKgInStock = inStockLots.reduce((s, l) => s + (l.physicalKg || 0), 0);
  const lotsByStatus = useMemo(() => {
    const m: any = {};
    lots.forEach(l => { m[l.status] = (m[l.status] || 0) + 1; });
    return m;
  }, [lots]);
  const lotsAtPort = lots.filter(l => l.status === "In Transit" || l.status === "Customs").length;

  // Total live reservations across all lots (SOs in pre-dispatch state).
  // This is what's promised but not yet shipped — a working "promised but not delivered" figure.
  const totalReservedKg = useMemo(() => {
    let total = 0;
    lots.forEach(lot => {
      orders.forEach(o => {
        if (!PRE_DISPATCH_STATUSES.has(o.status)) return;
        (o.items || []).forEach(it => {
          if (it.sourceType !== "STOCK") return;
          if (it.sourceRef !== lot.number) return;
          if ((it.product || "").toLowerCase().trim() !== (lot.product || "").toLowerCase().trim()) return;
          total += parseFloat(it.qty) || 0;
        });
      });
    });
    return total;
  }, [lots, orders]);

  // ── Contacts summary ───────────────────────────────────────────────────
  const contactsByType = useMemo(() => {
    const m: any = { Client: 0, Supplier: 0, Carrier: 0, Broker: 0, Forwarder: 0, Warehouse: 0, Other: 0 };
    contacts.forEach(c => {
      const types = [c.type, ...(c.additionalTypes || [])];
      types.forEach(t => { if (m[t] !== undefined) m[t]++; });
    });
    return m;
  }, [contacts]);
  const totalContacts = contacts.length;

  // -- Shipments / logistics summary ---------------------------------------
  const openShipments = shipments.filter(s => !["Closed", "Cancelled"].includes(s.status)).length;
  const inTransitShipments = shipments.filter(s => ["Loaded", "Arrived"].includes(s.status)).length;
  const shipmentDocsMissing = shipments.filter(s => (s.documents || []).some(d => ["Required", "Missing"].includes(d.status))).length;
  const logisticsCostPLN = shipments.reduce((sum, s) => sum + (s.costs || []).reduce((cs, c) => cs + (parseFloat(c.amountPLN) || ((parseFloat(c.amount) || 0) * (parseFloat(c.fxRate) || 1))), 0), 0);

  // -- Finance / margin summary -------------------------------------------
  const currentMonth = localMonthISO();
  const marginThisMonth = useMemo(() => aggregateNetMargins(
    orders,
    lots,
    pos,
    shipments,
    "forecast",
    o => o.status !== "Draft" && o.status !== "Cancelled" && String(o.orderDate || "").slice(0, 7) === currentMonth,
    operationalCosts,
    orders
  ), [orders, lots, pos, shipments, operationalCosts, currentMonth]);
  // v6.40.1 (audit A3): the accrual figure exists since v6.37.1 — show both.
  const marginActual = useMemo(() => aggregateNetMargins(
    orders, lots, pos, shipments, "actual",
    o => o.status !== "Draft" && o.status !== "Cancelled" && String(o.orderDate || "").slice(0, 7) === currentMonth,
    operationalCosts, orders
  ), [orders, lots, pos, shipments, operationalCosts, currentMonth]);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "24px 28px", background: "#FAFAFA" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {/* Header strip */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#111", letterSpacing: "-0.3px" }}>Dashboard</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>Live snapshot — Phase 1 · pulls from PO · SO · Inventory · Contacts</div>
          </div>
          <div style={{ fontSize: 11, color: "#AAA" }}>
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </div>
        </div>

        {/* v6.80.0 (D-51): ATTENTION TODAY — exceptions only */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
          {[
            ["OVERDUE RECEIVABLES", attention.overdueCount ? `${attention.overdueCount} · ${fmtNum(Math.round(attention.overduePLN))} PLN` : "none", attention.overdueCount ? "#DC2626" : "#16A34A", "finance"],
            ["PAYABLES DUE ≤ 7 DAYS", attention.payDueCount ? `${attention.payDueCount} · ${fmtNum(Math.round(attention.payDuePLN))} PLN` : "none", attention.payDueCount ? "#D97706" : "#16A34A", "finance"],
            ["STOCK ON HAND", `${fmtNum(Math.round(attention.stockKg))} kg · ${fmtNum(Math.round(attention.stockValue))} PLN landed${attention.ageing ? ` · ${attention.ageing} lot(s) > 30 days` : ""}`, attention.ageing ? "#D97706" : "#111", "lots"],
            ["CLAIM NOTICES DUE", attention.notices ? `${attention.notices} passed / due ≤ 2 days` : "none", attention.notices ? "#DC2626" : "#16A34A", "claims"],
          ].map(([k, v, color, mod]) => (
            <Card key={String(k)} style={{ cursor: "pointer", borderLeft: `4px solid ${color}` }}>
              <div onClick={() => onNavigate(String(mod))}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", letterSpacing: 0.4 }}>{k}</div>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: String(color), marginTop: 4 }}>{v}</div>
              </div>
            </Card>
          ))}
        </div>

        {/* Primary KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 14, marginBottom: 16 }}>
          <KpiCard
            label="ACTIVE PURCHASE ORDERS"
            value={activePOCount}
            tag={fmtMoney(activePOValuePLN, "PLN")}
            sub="committed to suppliers"
            valueColor="#2563EB"
            onClick={() => onNavigate && onNavigate("pos")}
            items={[
              { label: "Draft", val: poBuckets.draft, color: "#94A3B8" },
              { label: "Awaiting shipment", val: poBuckets.awaiting, color: "#2563EB" },
              { label: "In transit", val: poBuckets.transit, color: "#F59E0B" },
              { label: "Goods received", val: poBuckets.goodsIn, color: "#16A34A" },
            ]}
          />
          <KpiCard
            label="ACTIVE SALES ORDERS"
            value={activeSOCount}
            tag={fmtMoney(activeSOValuePLN, "PLN")}
            sub={upcomingDeliveryCount > 0 ? `${upcomingDeliveryCount} delivering this week` : "no near-term deliveries"}
            valueColor="#16A34A"
            onClick={() => onNavigate && onNavigate("orders")}
            items={[
              { label: "Draft", val: soByStatus.Draft || 0, color: "#94A3B8" },
              { label: "Confirmed", val: (soByStatus.Confirmed || 0) + (soByStatus.Reserved || 0) + (soByStatus.Loading || 0), color: "#16A34A" },
              { label: "Shipped", val: soByStatus.Shipped || 0, color: "#F59E0B" },
              { label: "Delivered", val: (soByStatus.Delivered || 0) + (soByStatus.Invoiced || 0), color: "#94A3B8" },
            ]}
          />
          <KpiCard
            label="SHIPMENTS"
            value={openShipments}
            tag={fmtMoney(logisticsCostPLN, "PLN")}
            sub={shipmentDocsMissing > 0 ? `${shipmentDocsMissing} missing docs` : `${inTransitShipments} in transit`}
            valueColor="#D97706"
            onClick={() => onNavigate && onNavigate("shipments")}
            items={[
              { label: "Open", val: openShipments, color: "#D97706" },
              { label: "In transit", val: inTransitShipments, color: "#7C3AED" },
              { label: "Docs", val: shipmentDocsMissing, color: "#DC2626" },
            ]}
          />
          <KpiCard
            label="MARGIN THIS MONTH"
            value={fmtMoney(marginThisMonth.totalNetMarginPLN, "PLN")}
            tag={`${marginThisMonth.avgNetMarginPct.toFixed(1)}% net · forecast`}
            sub={`actual (accrual): ${fmtMoney(marginActual.totalNetMarginPLN, "PLN")}`}
            valueColor={marginThisMonth.totalNetMarginPLN < 0 ? "#DC2626" : marginThisMonth.avgNetMarginPct < 5 ? "#D97706" : "#16A34A"}
            onClick={() => onNavigate && onNavigate("finance")}
            items={[
              { label: "Revenue", val: Math.max(0, Math.round(marginThisMonth.totalRevenuePLN / 1000)), color: "#2563EB" },
              { label: "Costs", val: Math.max(0, Math.round((marginThisMonth.totalCOGSPLN + marginThisMonth.totalDirectPLN + marginThisMonth.totalOverheadPLN) / 1000)), color: "#D97706" },
              { label: "Margin", val: Math.max(0, Math.round(Math.abs(marginThisMonth.totalNetMarginPLN) / 1000)), color: marginThisMonth.totalNetMarginPLN < 0 ? "#DC2626" : "#16A34A" },
            ]}
          />
          <KpiCard
            label="INVENTORY"
            value={fmtNum(Math.round(totalKgInStock))}
            tag={`${inStockLots.length} lots in stock`}
            sub={lotsAtPort > 0 ? `${lotsAtPort} in transit / customs` : "all clear"}
            valueColor="#7C3AED"
            onClick={() => onNavigate && onNavigate("lots")}
            items={[
              { label: "In Stock", val: lotsByStatus["In Stock"] || 0, color: "#16A34A" },
              { label: "In Transit", val: lotsByStatus["In Transit"] || 0, color: "#0284C7" },
              { label: "Customs", val: lotsByStatus.Customs || 0, color: "#D97706" },
              { label: "Expected", val: lotsByStatus.Expected || 0, color: "#94A3B8" },
            ]}
          />
          <KpiCard
            label="COUNTERPARTIES"
            value={totalContacts}
            tag={`${contactsByType.Client} clients · ${contactsByType.Supplier} suppliers`}
            sub="in the directory"
            valueColor="#0284C7"
            onClick={() => onNavigate && onNavigate("contacts")}
            items={[
              { label: "Clients", val: contactsByType.Client, color: "#16A34A" },
              { label: "Suppliers", val: contactsByType.Supplier, color: "#2563EB" },
              { label: "Logistics", val: contactsByType.Carrier + contactsByType.Forwarder + contactsByType.Warehouse, color: "#D97706" },
              { label: "Brokers", val: contactsByType.Broker, color: "#7C3AED" },
            ]}
          />
        </div>

        {/* Reservations / commitments callout — visible only when there are pre-dispatch reservations */}
        {totalReservedKg > 0 && (
          <Card style={{ marginBottom: 16, borderLeft: "4px solid #7C3AED", background: "#FAF8FF" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 12, color: "#5B21B6", fontWeight: 700, letterSpacing: "0.03em" }}>STOCK COMMITTED TO ACTIVE SALES ORDERS</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#7C3AED", marginTop: 4 }}>{fmtNum(totalReservedKg)} kg</div>
                <div style={{ fontSize: 11, color: "#7C3AED", marginTop: 2, opacity: 0.85 }}>Reserved by SOs in Confirmed / Reserved / Loading status — physically still in our warehouses</div>
              </div>
              <button onClick={() => onNavigate && onNavigate("lots")} style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid #7C3AED", background: "#fff", color: "#7C3AED", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>View by lot →</button>
            </div>
          </Card>
        )}

        {/* Lower row — two columns */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {/* Recent Active SOs */}
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em" }}>RECENT ACTIVE SALES ORDERS</div>
              <span onClick={() => onNavigate && onNavigate("orders")} style={{ fontSize: 12, color: "#2563EB", cursor: "pointer" }}>View all →</span>
            </div>
            {orders.filter(o => activeSOStatuses.has(o.status)).slice(0, 6).map(o => {
              const lineSum = (o.items || []).reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.unitPrice) || 0), 0);
              return (
                <div key={o.id} style={{ display: "grid", gridTemplateColumns: "140px 1fr 90px 100px", gap: 10, padding: "8px 0", borderBottom: "1px solid #F9FAFB", alignItems: "center" }}>
                  <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, color: "#2563EB", fontWeight: 600 }}>{o.number}</div>
                  <div style={{ fontSize: 12, color: "#444" }}>{o.client?.name || "—"}</div>
                  <div style={{ fontSize: 11, color: "#888" }}>{o.status}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, textAlign: "right" }}>{fmtMoney(lineSum, o.currency || "PLN")}</div>
                </div>
              );
            })}
            {orders.filter(o => activeSOStatuses.has(o.status)).length === 0 && (
              <div style={{ fontSize: 12, color: "#AAA", padding: "16px 0", textAlign: "center" }}>No active sales orders.</div>
            )}
          </Card>

          {/* Recent Lots */}
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em" }}>INVENTORY — RECENT LOTS</div>
              <span onClick={() => onNavigate && onNavigate("lots")} style={{ fontSize: 12, color: "#2563EB", cursor: "pointer" }}>View all →</span>
            </div>
            {lots.slice(0, 6).map(l => (
              <div key={l.id} style={{ display: "grid", gridTemplateColumns: "140px 1fr 100px 80px", gap: 10, padding: "8px 0", borderBottom: "1px solid #F9FAFB", alignItems: "center" }}>
                <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, color: "#2563EB", fontWeight: 600 }}>{l.number}</div>
                <div>
                  <div style={{ fontSize: 12, color: "#444", fontWeight: 500 }}>{l.product}{l.variety ? " — " + l.variety : ""}</div>
                  <div style={{ fontSize: 10, color: "#AAA" }}>{l.size || "—"} · {l.origin || "—"}</div>
                </div>
                <div style={{ fontSize: 11, color: "#888" }}>{l.status}</div>
                <div style={{ fontSize: 12, fontWeight: 600, textAlign: "right", color: l.physicalKg > 0 ? "#16A34A" : "#AAA" }}>{fmtNum(l.physicalKg || 0)} kg</div>
              </div>
            ))}
            {lots.length === 0 && (
              <div style={{ fontSize: 12, color: "#AAA", padding: "16px 0", textAlign: "center" }}>No lots tracked yet.</div>
            )}
          </Card>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 16, fontSize: 11, color: "#AAA", textAlign: "center" }}>
          Phase 1 dashboard · Phase 2 adds: cash flow timeline · margin analysis · supplier performance · low-stock alerts
        </div>
      </div>
    </div>
  );
}
