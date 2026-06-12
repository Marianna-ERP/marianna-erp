import React, { useMemo, useState } from "react";
import { MarginMode } from "./marginCalculations";
import { localTodayISO, localMonthISO } from "./dates";
import { warehouseMonthCharges, tariffHasRates } from "./warehouseCharges";
import {
  aggregateNetMargins,
  groupAndAggregateNetMargins,
  OperationalCost,
  OPERATIONAL_COST_CATEGORIES,
  ALLOCATION_METHODS,
} from "./operationalCosts";

// ─── FINANCE MODULE ─────────────────────────────────────────────────────────
// V5.7 adds Operational Costs and overhead allocation. Direct costs stay on
// Shipments/Inventory. Overhead stays here and is allocated to SO P/L by rules.

function safe(n: any): number {
  const v = parseFloat(n);
  return isFinite(v) ? v : 0;
}
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
function Button({ children, onClick, variant = "default", disabled = false }: any) {
  const styles: any = {
    default: { bg: "#fff", color: "#111", border: "#E5E7EB" },
    primary: { bg: "#111", color: "#fff", border: "#111" },
    danger: { bg: "#fff", color: "#DC2626", border: "#FECACA" },
  };
  const s = styles[variant] || styles.default;
  return <button disabled={disabled} onClick={onClick} style={{ padding: "7px 12px", borderRadius: 7, border: `1px solid ${s.border}`, background: disabled ? "#F3F4F6" : s.bg, color: disabled ? "#AAA" : s.color, fontSize: 12, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit" }}>{children}</button>;
}
function Field({ label, children }: any) {
  return <label style={{ display: "block" }}><div style={{ fontSize: 10.5, color: "#888", fontWeight: 600, marginBottom: 4 }}>{label}</div>{children}</label>;
}
function Inp(props: any) {
  return <input {...props} style={{ width: "100%", padding: "8px 9px", border: "1px solid #E5E7EB", borderRadius: 7, fontSize: 12, fontFamily: "inherit", ...(props.style || {}) }} />;
}
function Sel(props: any) {
  return <select {...props} style={{ width: "100%", padding: "8px 9px", border: "1px solid #E5E7EB", borderRadius: 7, fontSize: 12, fontFamily: "inherit", background: "#fff", ...(props.style || {}) }}>{props.children}</select>;
}
function StatBlock({ label, value, valueColor, sub }: any) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: "#888", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: valueColor || "#111", marginTop: 4, letterSpacing: "-0.3px" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function BarRow({ label, value, maxValue, marginPct, sub }: any) {
  const pct = maxValue > 0 ? Math.max(0, Math.min(100, (Math.abs(value) / maxValue) * 100)) : 0;
  const isLoss = value < 0;
  const isThin = marginPct !== undefined && marginPct >= 0 && marginPct < 5;
  const color = isLoss ? "#DC2626" : isThin ? "#D97706" : "#16A34A";
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid #F9FAFB" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <div style={{ fontSize: 12.5, color: "#444", fontWeight: 500 }}>{label}{sub && <span style={{ color: "#AAA", marginLeft: 6, fontSize: 11 }}>· {sub}</span>}</div>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          <div style={{ fontSize: 12.5, color, fontWeight: 600 }}>{fmtPLN(value)}</div>
          {marginPct !== undefined && <div style={{ fontSize: 11, color, fontWeight: 500, width: 50, textAlign: "right" }}>{fmtPct(marginPct)}</div>}
        </div>
      </div>
      <div style={{ height: 5, background: "#F3F4F6", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

function newCostTemplate(): OperationalCost {
  const now = new Date();
  const period = localMonthISO();
  return {
    id: Date.now(),
    period,
    date: localTodayISO(),
    category: "salary",
    description: "",
    supplierName: "",
    amount: 0,
    currency: "PLN",
    fxRate: 1,
    amountPLN: 0,
    costCenter: "general",
    allocationMethod: "by_revenue",
    status: "Expected",
    notes: "",
  };
}


// ─── v6.5: WAREHOUSE CHARGES — expected vs invoiced, per warehouse per month ─
function WarehouseChargesView({ lots = [], setLots = null, contacts = [], warehouseInvoices = [], setWarehouseInvoices = null }: any) {
  const warehouses = (contacts || []).filter((c: any) => tariffHasRates(c.warehouseTariff));
  const [whId, setWhId] = useState<any>(warehouses[0]?.id ?? "");
  const [period, setPeriod] = useState(localMonthISO());
  const [inv, setInv] = useState<any>({ invoiceNo: "", amount: "", currency: "PLN", fxRate: 1, date: localTodayISO(), notes: "" });
  const today = localTodayISO();
  const result = whId ? warehouseMonthCharges(lots, contacts, whId, period, today) : { rows: [], total: 0, totalPLN: 0, currency: "PLN" };
  const periodInvoices = (warehouseInvoices || []).filter((i: any) => String(i.warehouseId) === String(whId) && i.period === period);
  const invoicedPLN = periodInvoices.reduce((s: number, i: any) => s + (parseFloat(i.amountPLN) || 0), 0);
  const variancePLN = Math.round((invoicedPLN - result.totalPLN) * 100) / 100;
  const wh = warehouses.find((w: any) => String(w.id) === String(whId));

  function addInvoice() {
    if (!setWarehouseInvoices || !whId) return;
    const amount = parseFloat(inv.amount) || 0;
    if (amount <= 0 || !inv.invoiceNo.trim()) return;
    const fx = parseFloat(inv.fxRate) || 1;
    const rec = { id: Date.now(), warehouseId: whId, warehouseName: wh?.name || "", period, invoiceNo: inv.invoiceNo.trim(), date: inv.date, amount, currency: inv.currency, fxRate: fx, amountPLN: Math.round(amount * fx * 100) / 100, status: "Received", notes: inv.notes };
    setWarehouseInvoices((prev: any[]) => [...(prev || []), rec]);
    setInv({ invoiceNo: "", amount: "", currency: inv.currency, fxRate: inv.fxRate, date: today, notes: "" });
  }

  function approveInvoice(invoice: any) {
    if (!setWarehouseInvoices) return;
    if (!result.rows.length) { window.alert("No expected charges computed for this warehouse/month — nothing to allocate against."); return; }
    if (!window.confirm(`Approve invoice ${invoice.invoiceNo} (${invoice.amountPLN.toLocaleString("pl-PL")} PLN) and allocate it into the ${result.rows.length} lot(s) of ${period}?\n\nThe amount is split across lots proportionally to their expected charges and becomes part of each lot's landed cost (visible in SO P/L).`)) return;
    const totalExpectedPLN = result.totalPLN || 1;
    const allocations = result.rows.map((r: any) => ({ lotNumber: r.lotNumber, amountPLN: Math.round(invoice.amountPLN * (r.totalPLN / totalExpectedPLN) * 100) / 100 }));
    if (setLots) {
      const source = `WHINV-${invoice.id}`;
      setLots((prev: any[]) => prev.map((lot: any) => {
        const a = allocations.find(x => x.lotNumber === lot.number);
        if (!a || a.amountPLN <= 0) return lot;
        if ((lot.costs || []).some((c: any) => c.source === source)) return lot;
        return { ...lot, costs: [...(lot.costs || []), { id: Date.now() + Math.random(), type: "Warehousing", label: `${invoice.warehouseName || "Warehouse"} ${period} · inv ${invoice.invoiceNo}`, pln: a.amountPLN, source }] };
      }));
    }
    setWarehouseInvoices((prev: any[]) => prev.map((i: any) => i.id === invoice.id ? { ...i, status: "Approved", allocatedLots: allocations } : i));
  }

  function deleteInvoice(invoice: any) {
    if (invoice.status === "Approved") { window.alert("This invoice is approved and already allocated into lot costs — it can't be deleted from here."); return; }
    if (!window.confirm(`Delete invoice ${invoice.invoiceNo}?`)) return;
    setWarehouseInvoices && setWarehouseInvoices((prev: any[]) => prev.filter((i: any) => i.id !== invoice.id));
  }

  const box: any = { background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "16px 18px", marginBottom: 14 };
  if (!warehouses.length) return (
    <div style={box}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Warehouse charges</div>
      <div style={{ fontSize: 12.5, color: "#666", lineHeight: 1.6 }}>
        No warehouse tariffs configured yet. Open <strong>Contacts</strong>, edit your warehouse counterparty (type "Warehouse"),
        fill the <strong>Warehouse tariff</strong> section (kg/day or pallet/day rate, handling, sorting, free days) and tick the
        location(s) it operates. Expected charges then appear here and on every lot stored there.
      </div>
    </div>
  );
  return (
    <>
      <div style={{ ...box, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 4 }}>Warehouse</div>
          <select value={whId} onChange={e => setWhId(e.target.value)} style={{ border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, background: "#fff" }}>
            {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 4 }}>Month</div>
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)} style={{ border: "1px solid #E5E7EB", borderRadius: 6, padding: "7px 10px", fontSize: 13 }} />
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#888" }}>EXPECTED ({period})</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{result.totalPLN.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} PLN</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#888" }}>INVOICED</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: invoicedPLN ? "#111" : "#AAA" }}>{invoicedPLN.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} PLN</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#888" }}>VARIANCE</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: !invoicedPLN ? "#AAA" : Math.abs(variancePLN) < 1 ? "#16A34A" : variancePLN > 0 ? "#DC2626" : "#D97706" }}>
            {invoicedPLN ? `${variancePLN > 0 ? "+" : ""}${variancePLN.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} PLN` : "—"}
          </div>
        </div>
      </div>

      <div style={box}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em", marginBottom: 10 }}>EXPECTED CHARGES PER LOT · {period} <span style={{ fontWeight: 500, letterSpacing: 0, textTransform: "none" }}>— the "per-lot expected invoice" for warehouses that bill at dispatch</span></div>
        {!result.rows.length && <div style={{ fontSize: 12, color: "#AAA", fontStyle: "italic" }}>No chargeable lot activity at this warehouse in {period}.</div>}
        {result.rows.map((r: any) => (
          <div key={r.lotNumber} style={{ borderBottom: "1px solid #F3F4F6", padding: "8px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "ui-monospace, Menlo, monospace" }}>{r.lotNumber}</span>
              <span style={{ fontSize: 13, fontWeight: 800 }}>{r.totalPLN.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} PLN</span>
            </div>
            {r.lines.map((l: any, i: number) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#666", padding: "2px 0 2px 14px" }}>
                <span>{l.label}{l.date ? ` · ${l.date}` : ""}</span>
                <span>{l.amountPLN.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} PLN</span>
              </div>
            ))}
          </div>
        ))}
        {result.rows.length > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, fontSize: 13, fontWeight: 800 }}>
            <span>Total expected — invoice we should receive</span>
            <span>{result.totalPLN.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} PLN</span>
          </div>
        )}
      </div>

      <div style={box}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em", marginBottom: 10 }}>WAREHOUSE INVOICES · {period}</div>
        {periodInvoices.map((i: any) => (
          <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, border: "1px solid #F3F4F6", borderRadius: 8, padding: "9px 12px", marginBottom: 8 }}>
            <div>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{i.invoiceNo}</span>
              <span style={{ fontSize: 11.5, color: "#888", marginLeft: 8 }}>{i.date} · {i.amount.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} {i.currency}{i.currency !== "PLN" ? ` @ ${i.fxRate}` : ""} = {i.amountPLN.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} PLN</span>
              {i.notes && <div style={{ fontSize: 11, color: "#999" }}>{i.notes}</div>}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, padding: "3px 9px", borderRadius: 6, background: i.status === "Approved" ? "#DCFCE7" : "#FEF3C7", color: i.status === "Approved" ? "#15803D" : "#92400E" }}>{i.status}</span>
              {i.status !== "Approved" && <button onClick={() => approveInvoice(i)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#16A34A", color: "#fff", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Approve &amp; allocate to lots</button>}
              {i.status !== "Approved" && <button onClick={() => deleteInvoice(i)} style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid #FECACA", background: "#fff", color: "#DC2626", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✕</button>}
            </div>
          </div>
        ))}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.9fr 0.7fr 0.7fr 1fr 1.2fr auto", gap: 8, alignItems: "end", marginTop: 6 }}>
          <div><div style={{ fontSize: 10.5, fontWeight: 600, color: "#888", marginBottom: 3 }}>Invoice no.</div><input value={inv.invoiceNo} onChange={e => setInv({ ...inv, invoiceNo: e.target.value })} placeholder="FV/2026/06/123" style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "7px 9px", fontSize: 12.5 }} /></div>
          <div><div style={{ fontSize: 10.5, fontWeight: 600, color: "#888", marginBottom: 3 }}>Amount</div><input type="number" value={inv.amount} onChange={e => setInv({ ...inv, amount: e.target.value })} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "7px 9px", fontSize: 12.5 }} /></div>
          <div><div style={{ fontSize: 10.5, fontWeight: 600, color: "#888", marginBottom: 3 }}>Currency</div><select value={inv.currency} onChange={e => setInv({ ...inv, currency: e.target.value, fxRate: e.target.value === "PLN" ? 1 : inv.fxRate })} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "7px 9px", fontSize: 12.5, background: "#fff" }}>{["PLN", "EUR", "USD"].map(c => <option key={c}>{c}</option>)}</select></div>
          <div><div style={{ fontSize: 10.5, fontWeight: 600, color: "#888", marginBottom: 3 }}>FX→PLN</div><input type="number" step="0.01" value={inv.fxRate} onChange={e => setInv({ ...inv, fxRate: e.target.value })} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "7px 9px", fontSize: 12.5 }} /></div>
          <div><div style={{ fontSize: 10.5, fontWeight: 600, color: "#888", marginBottom: 3 }}>Date</div><input type="date" value={inv.date} onChange={e => setInv({ ...inv, date: e.target.value })} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "7px 9px", fontSize: 12.5 }} /></div>
          <div><div style={{ fontSize: 10.5, fontWeight: 600, color: "#888", marginBottom: 3 }}>Notes</div><input value={inv.notes} onChange={e => setInv({ ...inv, notes: e.target.value })} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "7px 9px", fontSize: 12.5 }} /></div>
          <button onClick={addInvoice} disabled={!inv.invoiceNo.trim() || !(parseFloat(inv.amount) > 0)} style={{ padding: "8px 14px", borderRadius: 7, border: "none", background: (!inv.invoiceNo.trim() || !(parseFloat(inv.amount) > 0)) ? "#E5E7EB" : "#16A34A", color: (!inv.invoiceNo.trim() || !(parseFloat(inv.amount) > 0)) ? "#9CA3AF" : "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>+ Record invoice</button>
        </div>
        <div style={{ fontSize: 10.5, color: "#888", marginTop: 8, lineHeight: 1.5 }}>
          Approving an invoice splits its PLN amount across the month's lots proportionally to their expected charges and adds it to each lot's
          <strong> landed cost</strong> — from there it flows into SO P/L automatically. Variance shows invoiced − expected: red = warehouse charged more than the tariff predicts.
        </div>
      </div>
    </>
  );
}

export default function Finance({
  orders = [],
  lots = [],
  setLots = null,
  contacts = [],
  warehouseInvoices = [],
  setWarehouseInvoices = null,
  pos = [],
  shipments = [],
  operationalCosts = [],
  setOperationalCosts,
}: {
  orders?: any[];
  lots?: any[];
  pos?: any[];
  shipments?: any[];
  operationalCosts?: OperationalCost[];
  setOperationalCosts?: any;
}) {
  const [mode, setMode] = useState<MarginMode>("forecast");
  const [tab, setTab] = useState<"pl" | "costs" | "warehouse">("pl");
  const [form, setForm] = useState<OperationalCost>(() => newCostTemplate());

  const committedFilter = (o: any) => o.status !== "Draft";
  const totalAgg = useMemo(() => aggregateNetMargins(orders, lots, pos, shipments, mode, committedFilter, operationalCosts, orders), [orders, lots, pos, shipments, mode, operationalCosts]);
  const deliveredAgg = useMemo(() => aggregateNetMargins(orders, lots, pos, shipments, mode, (o: any) => ["Shipped", "Delivered", "Invoiced", "Closed"].includes(o.status), operationalCosts, orders), [orders, lots, pos, shipments, mode, operationalCosts]);
  const pipelineAgg = useMemo(() => aggregateNetMargins(orders, lots, pos, shipments, mode, (o: any) => ["Confirmed", "Reserved", "Loading"].includes(o.status), operationalCosts, orders), [orders, lots, pos, shipments, mode, operationalCosts]);
  const byClient = useMemo(() => groupAndAggregateNetMargins(orders, lots, pos, shipments, mode, (o: any) => o.client?.name || "—", committedFilter, operationalCosts).slice(0, 10), [orders, lots, pos, shipments, mode, operationalCosts]);
  const byProduct = useMemo(() => groupAndAggregateNetMargins(orders, lots, pos, shipments, mode, (o: any) => (o.items && o.items[0]?.product) || "—", committedFilter, operationalCosts).slice(0, 10), [orders, lots, pos, shipments, mode, operationalCosts]);
  const byMonth = useMemo(() => groupAndAggregateNetMargins(orders, lots, pos, shipments, mode, (o: any) => (o.orderDate || "").substring(0, 7) || "—", committedFilter, operationalCosts).sort((a, b) => a.key.localeCompare(b.key)), [orders, lots, pos, shipments, mode, operationalCosts]);
  const recentMonths = byMonth.slice(-6);

  const maxClientNet = Math.max(...byClient.map(g => Math.abs(g.agg.totalNetMarginPLN)), 1);
  const maxProductNet = Math.max(...byProduct.map(g => Math.abs(g.agg.totalNetMarginPLN)), 1);
  const maxMonthNet = Math.max(...recentMonths.map(g => Math.abs(g.agg.totalNetMarginPLN)), 1);

  const totalOperationalCostPLN = useMemo(() => (operationalCosts || []).reduce((s: number, c: OperationalCost) => s + (safe(c.amountPLN) || safe(c.amount) * (safe(c.fxRate) || 1)), 0), [operationalCosts]);
  const costsByPeriod = useMemo(() => {
    const map: Record<string, number> = {};
    (operationalCosts || []).forEach((c: OperationalCost) => {
      const key = c.period || "—";
      map[key] = (map[key] || 0) + (safe(c.amountPLN) || safe(c.amount) * (safe(c.fxRate) || 1));
    });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [operationalCosts]);

  function saveCost() {
    if (!setOperationalCosts) return;
    const amountPLN = safe(form.amountPLN) || safe(form.amount) * (safe(form.fxRate) || 1);
    if (!form.period || !form.description || amountPLN <= 0) {
      alert("Please enter period, description and a positive amount.");
      return;
    }
    const cost: OperationalCost = { ...form, amount: safe(form.amount), fxRate: safe(form.fxRate) || 1, amountPLN };
    setOperationalCosts((prev: OperationalCost[]) => {
      const exists = (prev || []).some(c => c.id === cost.id);
      return exists ? prev.map(c => c.id === cost.id ? cost : c) : [...(prev || []), cost];
    });
    setForm(newCostTemplate());
  }

  function editCost(c: OperationalCost) {
    setTab("costs");
    setForm({ ...c });
  }

  function deleteCost(id: number) {
    if (!setOperationalCosts) return;
    if (!window.confirm("Delete this operational cost?")) return;
    setOperationalCosts((prev: OperationalCost[]) => (prev || []).filter(c => c.id !== id));
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "24px 28px", background: "#FAFAFA" }}>
      <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#111", letterSpacing: "-0.3px" }}>Finance · P&L Analytics</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
              {mode === "forecast" ? "Forecast — commitments, expected costs and budget overhead" : "Actual — shipped revenue, settled costs and posted overhead"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 2, background: "#F3F4F6", padding: 3, borderRadius: 7 }}>
              {(["pl", "costs", "warehouse"] as const).map(t => <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 12px", borderRadius: 5, border: "none", background: tab === t ? "#fff" : "transparent", color: tab === t ? "#111" : "#666", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: tab === t ? "0 1px 2px rgba(0,0,0,0.05)" : "none" }}>{t === "pl" ? "Sales P/L" : t === "costs" ? "Operational Costs" : "Warehouse charges"}</button>)}
            </div>
            <div style={{ display: "flex", gap: 2, background: "#F3F4F6", padding: 3, borderRadius: 7 }}>
              {(["forecast", "actual"] as MarginMode[]).map(m => <button key={m} onClick={() => setMode(m)} style={{ padding: "6px 14px", borderRadius: 5, border: "none", background: mode === m ? "#fff" : "transparent", color: mode === m ? "#111" : "#666", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: mode === m ? "0 1px 2px rgba(0,0,0,0.05)" : "none", textTransform: "capitalize" }}>{m}</button>)}
            </div>
          </div>
        </div>

        {tab === "warehouse" ? (
          <WarehouseChargesView lots={lots} setLots={setLots} contacts={contacts} warehouseInvoices={warehouseInvoices} setWarehouseInvoices={setWarehouseInvoices} />
        ) : tab === "pl" ? (
          <>
            <Card style={{ marginBottom: 16 }}>
              <SectionTitle>OVERALL · ALL ACTIVE SALES ORDERS</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 14 }}>
                <StatBlock label="REVENUE" value={fmtPLN(totalAgg.totalRevenuePLN)} sub={`${totalAgg.orderCount} order${totalAgg.orderCount === 1 ? "" : "s"}`} />
                <StatBlock label="COGS" value={fmtPLN(totalAgg.totalCOGSPLN)} valueColor="#7C3AED" sub="product / landed cost" />
                <StatBlock label="DIRECT COSTS" value={fmtPLN(totalAgg.totalDirectPLN)} valueColor="#F59E0B" sub="shipments / logistics" />
                <StatBlock label="CONTRIBUTION" value={fmtPLN(totalAgg.totalContributionPLN)} valueColor={totalAgg.totalContributionPLN < 0 ? "#DC2626" : "#16A34A"} sub={fmtPct(totalAgg.avgContributionPct)} />
                <StatBlock label="OVERHEAD" value={fmtPLN(totalAgg.totalOverheadPLN)} valueColor="#64748B" sub="allocated operating cost" />
                <StatBlock label="NET P/L" value={fmtPLN(totalAgg.totalNetMarginPLN)} valueColor={totalAgg.totalNetMarginPLN < 0 ? "#DC2626" : "#16A34A"} sub={fmtPct(totalAgg.avgNetMarginPct)} />
              </div>
            </Card>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
              <Card>
                <SectionTitle>PIPELINE — CONFIRMED / RESERVED / LOADING</SectionTitle>
                <div style={{ fontSize: 28, fontWeight: 700, color: pipelineAgg.totalNetMarginPLN < 0 ? "#DC2626" : "#16A34A", letterSpacing: "-0.5px" }}>{fmtPLN(pipelineAgg.totalNetMarginPLN)}</div>
                <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>net forecast · {fmtPct(pipelineAgg.avgNetMarginPct)} after {fmtPLN(pipelineAgg.totalOverheadPLN)} overhead</div>
                <div style={{ fontSize: 11, color: "#AAA", marginTop: 6 }}>{pipelineAgg.orderCount} active order{pipelineAgg.orderCount === 1 ? "" : "s"} not yet shipped</div>
              </Card>
              <Card>
                <SectionTitle>DELIVERED — SHIPPED / INVOICED / CLOSED</SectionTitle>
                <div style={{ fontSize: 28, fontWeight: 700, color: deliveredAgg.totalNetMarginPLN < 0 ? "#DC2626" : "#16A34A", letterSpacing: "-0.5px" }}>{fmtPLN(deliveredAgg.totalNetMarginPLN)}</div>
                <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>net actual · {fmtPct(deliveredAgg.avgNetMarginPct)} after {fmtPLN(deliveredAgg.totalOverheadPLN)} overhead</div>
                <div style={{ fontSize: 11, color: "#AAA", marginTop: 6 }}>{deliveredAgg.orderCount} settled order{deliveredAgg.orderCount === 1 ? "" : "s"}</div>
              </Card>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
              <Card>
                <SectionTitle>TOP CLIENTS BY NET P/L</SectionTitle>
                {byClient.length === 0 ? <div style={{ fontSize: 12, color: "#AAA", padding: "12px 0" }}>No data yet.</div> : byClient.map(g => <BarRow key={g.key} label={g.key} value={g.agg.totalNetMarginPLN} maxValue={maxClientNet} marginPct={g.agg.avgNetMarginPct} sub={`${g.agg.orderCount} SO · ${fmtPLNcompact(g.agg.totalRevenuePLN)} revenue · overhead ${fmtPLNcompact(g.agg.totalOverheadPLN)}`} />)}
              </Card>
              <Card>
                <SectionTitle>TOP PRODUCTS BY NET P/L</SectionTitle>
                {byProduct.length === 0 ? <div style={{ fontSize: 12, color: "#AAA", padding: "12px 0" }}>No data yet.</div> : byProduct.map(g => <BarRow key={g.key} label={g.key} value={g.agg.totalNetMarginPLN} maxValue={maxProductNet} marginPct={g.agg.avgNetMarginPct} sub={`${g.agg.orderCount} SO · ${fmtPLNcompact(g.agg.totalRevenuePLN)} revenue · overhead ${fmtPLNcompact(g.agg.totalOverheadPLN)}`} />)}
              </Card>
            </div>

            <Card>
              <SectionTitle>MONTHLY NET P/L — LAST 6 MONTHS</SectionTitle>
              {recentMonths.length === 0 ? <div style={{ fontSize: 12, color: "#AAA", padding: "12px 0" }}>No data yet.</div> : recentMonths.map(g => <BarRow key={g.key} label={g.key} value={g.agg.totalNetMarginPLN} maxValue={maxMonthNet} marginPct={g.agg.avgNetMarginPct} sub={`${g.agg.orderCount} SO · contribution ${fmtPLNcompact(g.agg.totalContributionPLN)} · overhead ${fmtPLNcompact(g.agg.totalOverheadPLN)}`} />)}
            </Card>

            <div style={{ marginTop: 16, padding: "12px 16px", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 8, fontSize: 11, color: "#065F46", lineHeight: 1.5 }}>
              <strong>P&L scope V5.7:</strong> Revenue - COGS - direct shipment costs = contribution margin. Contribution margin - allocated operational overhead = net P/L. Cancelled SOs are excluded. Draft SOs are excluded from committed aggregates.
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.5fr", gap: 14, alignItems: "start" }}>
              <Card>
                <SectionTitle>{form.id && (operationalCosts || []).some(c => c.id === form.id) ? "EDIT OPERATIONAL COST" : "ADD OPERATIONAL COST"}</SectionTitle>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field label="Period"><Inp value={form.period} onChange={(e: any) => setForm({ ...form, period: e.target.value })} placeholder="2026-05" /></Field>
                  <Field label="Date"><Inp type="date" value={form.date} onChange={(e: any) => setForm({ ...form, date: e.target.value })} /></Field>
                  <Field label="Category"><Sel value={form.category} onChange={(e: any) => setForm({ ...form, category: e.target.value })}>{OPERATIONAL_COST_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</Sel></Field>
                  <Field label="Cost center"><Sel value={form.costCenter} onChange={(e: any) => setForm({ ...form, costCenter: e.target.value })}>{["admin", "sales", "operations", "logistics", "finance", "general"].map(c => <option key={c} value={c}>{c}</option>)}</Sel></Field>
                  <Field label="Description"><Inp value={form.description} onChange={(e: any) => setForm({ ...form, description: e.target.value })} placeholder="Office rent - May" /></Field>
                  <Field label="Supplier / payee"><Inp value={form.supplierName || ""} onChange={(e: any) => setForm({ ...form, supplierName: e.target.value })} placeholder="Landlord / employee / accountant" /></Field>
                  <Field label="Amount"><Inp type="number" value={form.amount} onChange={(e: any) => setForm({ ...form, amount: safe(e.target.value), amountPLN: safe(e.target.value) * (safe(form.fxRate) || 1) })} /></Field>
                  <Field label="Currency"><Sel value={form.currency} onChange={(e: any) => setForm({ ...form, currency: e.target.value })}>{["PLN", "EUR", "USD"].map(c => <option key={c} value={c}>{c}</option>)}</Sel></Field>
                  <Field label="FX rate to PLN"><Inp type="number" value={form.fxRate} onChange={(e: any) => setForm({ ...form, fxRate: safe(e.target.value) || 1, amountPLN: safe(form.amount) * (safe(e.target.value) || 1) })} /></Field>
                  <Field label="Amount PLN"><Inp type="number" value={form.amountPLN} onChange={(e: any) => setForm({ ...form, amountPLN: safe(e.target.value) })} /></Field>
                  <Field label="Allocation method"><Sel value={form.allocationMethod} onChange={(e: any) => setForm({ ...form, allocationMethod: e.target.value as any })}>{ALLOCATION_METHODS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</Sel></Field>
                  <Field label="Status"><Sel value={form.status} onChange={(e: any) => setForm({ ...form, status: e.target.value as any })}>{["Budget", "Expected", "Received", "Posted", "Paid"].map(s => <option key={s} value={s}>{s}</option>)}</Sel></Field>
                </div>
                <div style={{ marginTop: 10 }}>
                  <Field label="Notes"><Inp value={form.notes || ""} onChange={(e: any) => setForm({ ...form, notes: e.target.value })} placeholder="Internal note" /></Field>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <Button variant="primary" onClick={saveCost}>Save cost</Button>
                  <Button onClick={() => setForm(newCostTemplate())}>Clear</Button>
                </div>
                <div style={{ marginTop: 12, fontSize: 11, color: "#888", lineHeight: 1.45 }}>
                  Forecast counts Budget / Expected / Received / Posted / Paid. Actual counts only Received / Posted / Paid. Direct delivery petrol should normally be entered as a Shipment cost, not as overhead.
                </div>
              </Card>

              <div>
                <Card style={{ marginBottom: 14 }}>
                  <SectionTitle>OPERATIONAL COSTS SUMMARY</SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
                    <StatBlock label="TOTAL COSTS" value={fmtPLN(totalOperationalCostPLN)} sub={`${(operationalCosts || []).length} entries`} />
                    <StatBlock label="FORECAST ALLOCATED" value={fmtPLN(aggregateNetMargins(orders, lots, pos, shipments, "forecast", committedFilter, operationalCosts, orders).totalOverheadPLN)} valueColor="#64748B" sub="budget + expected + booked" />
                    <StatBlock label="ACTUAL ALLOCATED" value={fmtPLN(aggregateNetMargins(orders, lots, pos, shipments, "actual", committedFilter, operationalCosts, orders).totalOverheadPLN)} valueColor="#64748B" sub="received / posted / paid" />
                  </div>
                  <div style={{ marginTop: 12, fontSize: 11, color: "#888" }}>
                    {costsByPeriod.map(([period, amount]) => <span key={period} style={{ display: "inline-block", marginRight: 12 }}>{period}: <strong>{fmtPLN(amount)}</strong></span>)}
                  </div>
                </Card>

                <Card>
                  <SectionTitle>OPERATIONAL COST ENTRIES</SectionTitle>
                  {(operationalCosts || []).length === 0 ? <div style={{ fontSize: 12, color: "#AAA", padding: "12px 0" }}>No operational costs yet.</div> : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead><tr style={{ textAlign: "left", color: "#888", borderBottom: "1px solid #EEE" }}><th style={{ padding: 7 }}>Period</th><th>Description</th><th>Category</th><th>Method</th><th>Status</th><th style={{ textAlign: "right" }}>Amount</th><th></th></tr></thead>
                        <tbody>{(operationalCosts || []).slice().sort((a, b) => String(b.period).localeCompare(String(a.period))).map((c: OperationalCost) => <tr key={c.id} style={{ borderBottom: "1px solid #F5F5F5" }}>
                          <td style={{ padding: 7, color: "#666" }}>{c.period}</td>
                          <td><div style={{ fontWeight: 600, color: "#333" }}>{c.description}</div><div style={{ fontSize: 10.5, color: "#AAA" }}>{c.supplierName || "—"}</div></td>
                          <td>{String(c.category).replace(/_/g, " ")}</td>
                          <td>{String(c.allocationMethod).replace(/_/g, " ")}</td>
                          <td><span style={{ padding: "2px 6px", borderRadius: 999, background: c.status === "Budget" ? "#EFF6FF" : c.status === "Expected" ? "#FEF3C7" : "#ECFDF5", color: c.status === "Budget" ? "#1D4ED8" : c.status === "Expected" ? "#92400E" : "#065F46", fontSize: 10.5 }}>{c.status}</span></td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtPLN(safe(c.amountPLN) || safe(c.amount) * (safe(c.fxRate) || 1))}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}><button onClick={() => editCost(c)} style={{ border: "none", background: "transparent", color: "#2563EB", cursor: "pointer", fontSize: 11 }}>Edit</button><button onClick={() => deleteCost(c.id)} style={{ border: "none", background: "transparent", color: "#DC2626", cursor: "pointer", fontSize: 11 }}>Delete</button></td>
                        </tr>)}</tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
