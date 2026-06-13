import React, { useMemo, useState } from "react";
import { MarginMode } from "./marginCalculations";
import { localTodayISO, localMonthISO } from "./dates";
import { warehouseMonthCharges, tariffHasRates } from "./warehouseCharges";
import * as XLSX from "xlsx";
import { readFakturowniaConfig, fetchInvoices, mapInvoice } from "./fakturownia";
import { buildLedger } from "./ledger";
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



// ─── v6.7: FAKTUROWNIA COST-REGISTER IMPORT ─────────────────────────────────
// Reads the cost/expense register exported from Fakturownia (XLS/XLSX/CSV).
// Column detection is lenient (PL/EN headers). Each row is reviewed: routed to
// an Operational Cost (category guessed from text, editable) or — when the
// supplier is a tariffed warehouse — to a Warehouse invoice for reconciliation.
function guessCostCategory(text: string): string {
  const t = String(text || "").toLowerCase();
  if (/paliw|fuel|orlen|petrol|tank/.test(t)) return "petrol";
  if (/czynsz|najem|rent|landlord/.test(t)) return "office_rent";
  if (/ksi[eę]gow|account|biuro rachun/.test(t)) return "accountant";
  if (/energi|pr[aą]d|electric|gaz|water|woda/.test(t)) return "office_rent";
  if (/telefon|internet|phone|play|orange|t-mobile|plus/.test(t)) return "phone_internet";
  if (/ubezpiecz|insur|pzu|warta/.test(t)) return "insurance";
  if (/oprogram|software|subscript|licen|saas|google|microsoft/.test(t)) return "software";
  if (/bank|prowizj|fee/.test(t)) return "bank_fees";
  if (/wynagrodz|salary|payroll|zus|p[ił]t/.test(t)) return "salary";
  if (/t[lł]umacz|translat/.test(t)) return "other";
  return "other";
}

function findCol(headers: string[], ...keys: string[]): number {
  const H = headers.map(h => String(h || "").toLowerCase());
  for (const k of keys) {
    const i = H.findIndex(h => h.includes(k));
    if (i >= 0) return i;
  }
  return -1;
}

function FakturowniaCostImportModal({ contacts = [], operationalCosts = [], onImport, onClose }: any) {
  const [rows, setRows] = useState<any[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const tariffWarehouses = (contacts || []).filter((c: any) => tariffHasRates(c.warehouseTariff));

  function handleFile(e: any) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name); setError("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result as ArrayBuffer, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
        if (!aoa.length) { setError("File appears empty."); return; }
        const headers = (aoa[0] || []).map((x: any) => String(x || ""));
        const cNo = findCol(headers, "numer", "number", "nr ");
        const cSeller = findCol(headers, "sprzedawca", "kontrahent", "seller", "dostawca", "supplier", "nazwa");
        const cDate = findCol(headers, "data wystaw", "issue date", "data sprzeda", "data");
        const cNet = findCol(headers, "netto", "net");
        const cGross = findCol(headers, "brutto", "gross");
        const cCur = findCol(headers, "walut", "currency");
        const cDesc = findCol(headers, "opis", "description", "tytu", "produkt", "kategoria");
        if (cNo < 0 && cSeller < 0) { setError("Could not recognize columns — expected headers like Numer/Number, Sprzedawca/Seller, Netto/Net. Export the cost register from Fakturownia as XLS/CSV and try again."); return; }
        const existingInvNos = new Set((operationalCosts || []).map((c: any) => String(c.invoiceNo || "").trim().toLowerCase()).filter(Boolean));
        const parsed = aoa.slice(1).filter(r => (r || []).some(x => String(x || "").trim() !== "")).map((r: any[], i: number) => {
          const invoiceNo = cNo >= 0 ? String(r[cNo] || "").trim() : "";
          const seller = cSeller >= 0 ? String(r[cSeller] || "").trim() : "";
          const rawDate = cDate >= 0 ? String(r[cDate] || "").trim() : "";
          const dm = rawDate.match(/(\d{4})-(\d{2})-(\d{2})/) || rawDate.match(/(\d{2})[./](\d{2})[./](\d{4})/);
          const date = dm ? (dm[1].length === 4 ? `${dm[1]}-${dm[2]}-${dm[3]}` : `${dm[3]}-${dm[2]}-${dm[1]}`) : "";
          const num = (v: any) => parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")) || 0;
          const net = cNet >= 0 ? num(r[cNet]) : 0;
          const gross = cGross >= 0 ? num(r[cGross]) : 0;
          const amount = net || gross;
          const currency = cCur >= 0 ? (String(r[cCur] || "PLN").trim().toUpperCase() || "PLN") : "PLN";
          const desc = cDesc >= 0 ? String(r[cDesc] || "").trim() : "";
          const whMatch = tariffWarehouses.find((w: any) => seller && String(w.name || "").toLowerCase().includes(seller.toLowerCase().slice(0, 12)) || seller.toLowerCase().includes(String(w.name || "").toLowerCase().slice(0, 12)));
          const dup = invoiceNo && existingInvNos.has(invoiceNo.toLowerCase());
          return {
            id: i, include: !dup && amount > 0, dup,
            invoiceNo, seller, date, amount, currency,
            fxRate: currency === "PLN" ? 1 : currency === "EUR" ? 4.25 : 3.9,
            description: desc || `${seller} ${invoiceNo}`.trim(),
            route: whMatch ? "warehouse" : "cost",
            warehouseId: whMatch ? whMatch.id : (tariffWarehouses[0]?.id ?? ""),
            category: guessCostCategory(`${seller} ${desc}`),
            allocationMethod: "by_revenue",
          };
        });
        if (!parsed.length) setError("No data rows found under the header.");
        setRows(parsed);
      } catch (err: any) {
        setError("Could not parse the file: " + (err?.message || String(err)));
      }
    };
    reader.onerror = () => setError("Could not read the file.");
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  function setRow(i: number, k: string, v: any) { setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [k]: v } : r)); }
  const included = rows.filter(r => r.include);

  // v6.8: live read-only fetch of cost invoices (income=0) straight from the API.
  const fktCfg = readFakturowniaConfig();
  const [livePeriod, setLivePeriod] = useState("this_month");
  const [liveBusy, setLiveBusy] = useState(false);
  async function fetchLive() {
    if (!fktCfg) return;
    setLiveBusy(true); setError("");
    const r = await fetchInvoices(fktCfg, { income: 0, period: livePeriod });
    setLiveBusy(false);
    if (!r.ok) {
      setError(r.corsLikely
        ? "The browser couldn't reach Fakturownia directly (CORS). Use the file export below instead — live sync will run from the Phase-2 backend."
        : (r.error || "Fetch failed."));
      return;
    }
    const mapped = (r.data || []).map(mapInvoice);
    const existingInvNos = new Set((operationalCosts || []).map((c: any) => String(c.invoiceNo || "").trim().toLowerCase()).filter(Boolean));
    setFileName(`Fakturownia · ${livePeriod}`);
    setRows(mapped.map((m: any, i: number) => {
      const dup = m.number && existingInvNos.has(m.number.toLowerCase());
      const whMatch = tariffWarehouses.find((w: any) => m.sellerName && (String(w.name || "").toLowerCase().includes(m.sellerName.toLowerCase().slice(0, 12)) || m.sellerName.toLowerCase().includes(String(w.name || "").toLowerCase().slice(0, 12))));
      return {
        id: i, include: !dup && (m.netTotal || m.grossTotal) > 0, dup,
        invoiceNo: m.number, seller: m.sellerName, date: m.issueDate || m.sellDate,
        amount: m.netTotal || m.grossTotal, currency: m.currency,
        fxRate: m.currency === "PLN" ? 1 : m.currency === "EUR" ? 4.25 : 3.9,
        description: m.description || `${m.sellerName} ${m.number}`.trim(),
        route: whMatch ? "warehouse" : "cost",
        warehouseId: whMatch ? whMatch.id : (tariffWarehouses[0]?.id ?? ""),
        category: guessCostCategory(`${m.sellerName} ${m.description}`),
        allocationMethod: "by_revenue",
      };
    }));
    if (!mapped.length) setError(`No cost invoices found for "${livePeriod}".`);
  }

  function doImport() {
    const costs: any[] = []; const whInvoices: any[] = [];
    included.forEach((r, i) => {
      const amountPLN = Math.round(r.amount * (parseFloat(r.fxRate) || 1) * 100) / 100;
      if (r.route === "warehouse" && r.warehouseId) {
        const wh = tariffWarehouses.find((w: any) => String(w.id) === String(r.warehouseId));
        whInvoices.push({ id: Date.now() + i, warehouseId: r.warehouseId, warehouseName: wh?.name || r.seller, period: String(r.date || localTodayISO()).slice(0, 7), invoiceNo: r.invoiceNo, date: r.date || localTodayISO(), amount: r.amount, currency: r.currency, fxRate: parseFloat(r.fxRate) || 1, amountPLN, status: "Received", notes: `Imported from Fakturownia (${fileName})` });
      } else {
        costs.push({ id: Date.now() + i, period: String(r.date || localTodayISO()).slice(0, 7), date: r.date || localTodayISO(), category: r.category, description: r.description, supplierName: r.seller, invoiceNo: r.invoiceNo, amount: r.amount, currency: r.currency, fxRate: parseFloat(r.fxRate) || 1, amountPLN, costCenter: "general", allocationMethod: r.allocationMethod, status: "Received", notes: `Imported from Fakturownia (${fileName})` });
      }
    });
    onImport(costs, whInvoices);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 130, padding: 20 }}>
      <div style={{ width: 1020, maxHeight: "92vh", overflow: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #EBEBEB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Import cost invoices from Fakturownia</div>
            <div style={{ fontSize: 11.5, color: "#888", marginTop: 2 }}>In Fakturownia: open your <strong>cost/expense register</strong> (the invoices issued TO you via KSeF) and export it as XLS or CSV, then load the file here. Nothing is retyped — review and confirm below.</div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 22, color: "#888", cursor: "pointer" }}>×</button>
        </div>
        <div style={{ padding: "14px 22px" }}>
          {fktCfg && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12, padding: "10px 12px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#15803D" }}>Live sync</span>
              <select value={livePeriod} onChange={e => setLivePeriod(e.target.value)} style={{ border: "1px solid #E5E7EB", borderRadius: 6, padding: "6px 9px", fontSize: 12.5, background: "#fff" }}>
                <option value="this_month">This month</option>
                <option value="last_month">Last month</option>
                <option value="this_year">This year</option>
              </select>
              <button onClick={fetchLive} disabled={liveBusy} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: liveBusy ? "#A7F3D0" : "#16A34A", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: liveBusy ? "wait" : "pointer", fontFamily: "inherit" }}>{liveBusy ? "Fetching…" : "Fetch cost invoices from Fakturownia"}</button>
              <span style={{ fontSize: 11, color: "#16803D" }}>read-only · {fktCfg.subdomain}.fakturownia.pl</span>
            </div>
          )}
          <label style={{ display: "inline-block", padding: "8px 16px", borderRadius: 7, background: "#111", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {fktCfg ? "…or choose an exported file" : "Choose Fakturownia export file…"}
            <input type="file" accept=".xls,.xlsx,.csv" onChange={handleFile} style={{ display: "none" }} />
          </label>
          {fileName && <span style={{ fontSize: 12, color: "#666", marginLeft: 10 }}>{fileName} · {rows.length} row(s)</span>}
          {error && <div style={{ marginTop: 10, padding: "8px 12px", background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 7, fontSize: 12, color: "#991B1B" }}>{error}</div>}
          {rows.length > 0 && (
            <div style={{ marginTop: 12, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                <thead><tr style={{ textAlign: "left", color: "#888", borderBottom: "1px solid #EEE" }}>
                  <th style={{ padding: 6 }}></th><th>Invoice</th><th>Supplier</th><th>Date</th><th style={{ textAlign: "right" }}>Amount</th><th>Route to</th><th>Category / Warehouse</th><th>Allocation</th>
                </tr></thead>
                <tbody>{rows.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #F5F5F5", opacity: r.include ? 1 : 0.45, background: r.dup ? "#FFFBEB" : "transparent" }}>
                    <td style={{ padding: 6 }}><input type="checkbox" checked={r.include} onChange={e => setRow(i, "include", e.target.checked)} /></td>
                    <td style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{r.invoiceNo || "—"}{r.dup && <div style={{ fontSize: 9.5, color: "#92400E", fontWeight: 700 }}>already imported</div>}</td>
                    <td>{r.seller || "—"}</td>
                    <td>{r.date || "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{r.amount.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} {r.currency}</td>
                    <td>
                      <select value={r.route} onChange={e => setRow(i, "route", e.target.value)} style={{ border: "1px solid #E5E7EB", borderRadius: 5, padding: "3px 6px", fontSize: 11, background: "#fff" }}>
                        <option value="cost">Operational cost</option>
                        {tariffWarehouses.length > 0 && <option value="warehouse">Warehouse invoice</option>}
                      </select>
                    </td>
                    <td>
                      {r.route === "warehouse" ? (
                        <select value={r.warehouseId} onChange={e => setRow(i, "warehouseId", e.target.value)} style={{ border: "1px solid #E5E7EB", borderRadius: 5, padding: "3px 6px", fontSize: 11, background: "#fff" }}>
                          {tariffWarehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      ) : (
                        <select value={r.category} onChange={e => setRow(i, "category", e.target.value)} style={{ border: "1px solid #E5E7EB", borderRadius: 5, padding: "3px 6px", fontSize: 11, background: "#fff" }}>
                          {OPERATIONAL_COST_CATEGORIES.map((c: any) => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                      )}
                    </td>
                    <td>
                      {r.route === "cost" ? (
                        <select value={r.allocationMethod} onChange={e => setRow(i, "allocationMethod", e.target.value)} style={{ border: "1px solid #E5E7EB", borderRadius: 5, padding: "3px 6px", fontSize: 11, background: "#fff" }}>
                          {ALLOCATION_METHODS.map((m: any) => <option key={m.key} value={m.key}>{m.label}</option>)}
                        </select>
                      ) : <span style={{ fontSize: 10.5, color: "#888" }}>reconciled in Warehouse charges</span>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
        <div style={{ padding: "14px 22px", borderTop: "1px solid #EBEBEB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 11.5, color: "#888" }}>{included.length} of {rows.length} selected · costs import as status "Received" (counted in Actual P/L)</div>
          <button disabled={!included.length} onClick={doImport} style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: included.length ? "#16A34A" : "#E5E7EB", color: included.length ? "#fff" : "#9CA3AF", fontSize: 13, fontWeight: 700, cursor: included.length ? "pointer" : "not-allowed", fontFamily: "inherit" }}>Import {included.length} invoice(s)</button>
        </div>
      </div>
    </div>
  );
}


// ─── v6.9: RECEIVABLES & PAYABLES VIEW ──────────────────────────────────────
function LedgerView({ orders = [], lots = [], pos = [], warehouseInvoices = [], operationalCosts = [], settledRefs = [], setSettledRefs = null }: any) {
  const [dir, setDir] = useState<"all" | "receivable" | "payable">("all");
  const [hidePaid, setHidePaid] = useState(true);
  const today = localTodayISO();
  const { items, totals } = buildLedger({ orders, lots, pos, warehouseInvoices, operationalCosts, settledRefs, todayISO: today });

  function togglePaid(ref: string) {
    if (!setSettledRefs) return;
    setSettledRefs((prev: string[]) => (prev || []).includes(ref) ? prev.filter(r => r !== ref) : [...(prev || []), ref]);
  }

  const shown = items
    .filter(i => dir === "all" || i.direction === dir)
    .filter(i => !hidePaid || i.status !== "Paid")
    .sort((a, b) => {
      const rank = (x: any) => x.status === "Overdue" ? 0 : x.status === "Open" ? 1 : 2;
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999"));
    });

  const fmt = (x: number) => x.toLocaleString("pl-PL", { minimumFractionDigits: 2 }) + " PLN";
  const card: any = { background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "14px 16px" };
  const statusColor = (s: string) => s === "Overdue" ? "#DC2626" : s === "Paid" ? "#16A34A" : "#D97706";

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14 }}>
        <div style={card}><div style={{ fontSize: 11, color: "#888" }}>RECEIVABLE · OPEN</div><div style={{ fontSize: 19, fontWeight: 800, color: "#16A34A" }}>{fmt(totals.receivableOpenPLN)}</div><div style={{ fontSize: 10.5, color: "#DC2626" }}>{fmt(totals.receivableOverduePLN)} overdue</div></div>
        <div style={card}><div style={{ fontSize: 11, color: "#888" }}>PAYABLE · OPEN</div><div style={{ fontSize: 19, fontWeight: 800, color: "#DC2626" }}>{fmt(totals.payableOpenPLN)}</div><div style={{ fontSize: 10.5, color: "#DC2626" }}>{fmt(totals.payableOverduePLN)} overdue</div></div>
        <div style={card}><div style={{ fontSize: 11, color: "#888" }}>NET POSITION</div><div style={{ fontSize: 19, fontWeight: 800, color: totals.netPositionPLN >= 0 ? "#16A34A" : "#DC2626" }}>{fmt(totals.netPositionPLN)}</div><div style={{ fontSize: 10.5, color: "#888" }}>receivable − payable</div></div>
        <div style={{ ...card, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
          <div style={{ display: "flex", gap: 4, background: "#F3F4F6", borderRadius: 7, padding: 3 }}>
            {(["all", "receivable", "payable"] as const).map(d => (
              <button key={d} onClick={() => setDir(d)} style={{ flex: 1, padding: "4px 6px", borderRadius: 5, border: "none", background: dir === d ? "#fff" : "transparent", color: dir === d ? "#111" : "#888", fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize" }}>{d}</button>
            ))}
          </div>
          <label style={{ fontSize: 11, color: "#666", display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={hidePaid} onChange={e => setHidePaid(e.target.checked)} /> Hide paid</label>
        </div>
      </div>

      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "#FAFAFA", textAlign: "left", color: "#888" }}>
            {["", "Type", "Counterparty", "Document", "Date", "Due", "Amount", "Status", ""].map((h, i) => <th key={i} style={{ padding: "9px 10px", fontWeight: 700, fontSize: 10.5, borderBottom: "1px solid #EEE" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {shown.map(i => (
              <tr key={i.ref} style={{ borderBottom: "1px solid #F5F5F5" }}>
                <td style={{ padding: "8px 10px" }}><span title={i.direction} style={{ fontSize: 14 }}>{i.direction === "receivable" ? "↓" : "↑"}</span></td>
                <td style={{ padding: "8px 10px" }}>{i.kind}<div style={{ fontSize: 10, color: "#AAA" }}>{i.note || ""}</div></td>
                <td style={{ padding: "8px 10px", fontWeight: 600 }}>{i.counterparty}</td>
                <td style={{ padding: "8px 10px", fontFamily: "ui-monospace, Menlo, monospace" }}>{i.documentNo}</td>
                <td style={{ padding: "8px 10px", color: "#888" }}>{i.date || "—"}</td>
                <td style={{ padding: "8px 10px", color: i.status === "Overdue" ? "#DC2626" : "#888", fontWeight: i.status === "Overdue" ? 700 : 400 }}>{i.dueDate || "—"}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{i.amountPLN.toLocaleString("pl-PL", { minimumFractionDigits: 2 })}{i.currency !== "PLN" ? <span style={{ fontSize: 9.5, color: "#AAA" }}> PLN</span> : <span style={{ fontSize: 9.5, color: "#AAA" }}> PLN</span>}</td>
                <td style={{ padding: "8px 10px" }}><span style={{ fontSize: 10.5, fontWeight: 800, color: statusColor(i.status) }}>{i.status}</span></td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>
                  <button onClick={() => togglePaid(i.ref)} title={i.status === "Paid" ? "Mark unpaid" : "Mark paid"} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid", borderColor: i.status === "Paid" ? "#E5E7EB" : "#BBF7D0", background: i.status === "Paid" ? "#fff" : "#F0FDF4", color: i.status === "Paid" ? "#888" : "#15803D", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{i.status === "Paid" ? "Undo" : "Mark paid"}</button>
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={9} style={{ padding: 18, textAlign: "center", color: "#AAA", fontStyle: "italic" }}>Nothing to show. {hidePaid ? "Untick \"Hide paid\" to see settled items." : ""}</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10.5, color: "#AAA", marginTop: 8, lineHeight: 1.5 }}>
        Receivables come from sales invoices issued on SOs; payables from producer payouts (closed consignment settlements), warehouse invoices, invoice-backed operational costs, and firm-price PO purchases. Payroll and taxes (no invoice number) are excluded. "Mark paid" is a manual flag now; once Fakturownia sales-invoice matching is connected, paid status syncs from there.
      </div>
    </>
  );
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
  settledRefs = [],
  setSettledRefs = null,
  pos = [],
  shipments = [],
  operationalCosts = [],
  setOperationalCosts,
}: {
  orders?: any[];
  lots?: any[];
  setLots?: any;
  contacts?: any[];
  warehouseInvoices?: any[];
  setWarehouseInvoices?: any;
  settledRefs?: string[];
  setSettledRefs?: any;
  pos?: any[];
  shipments?: any[];
  operationalCosts?: OperationalCost[];
  setOperationalCosts?: any;
}) {
  const [mode, setMode] = useState<MarginMode>("forecast");
  const [tab, setTab] = useState<"pl" | "costs" | "warehouse" | "ledger">("pl");
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

  const [showFktImport, setShowFktImport] = useState(false);

  // v6.7: clone the most recent month's costs into the following month as "Expected".
  function copyLastMonth() {
    if (!setOperationalCosts) return;
    const periods = Array.from(new Set((operationalCosts || []).map((c: OperationalCost) => c.period).filter(Boolean))).sort();
    const last = periods[periods.length - 1];
    if (!last) { alert("No costs recorded yet — nothing to copy."); return; }
    const [y, m] = String(last).split("-").map(Number);
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    const next = `${ny}-${String(nm).padStart(2, "0")}`;
    const source = (operationalCosts || []).filter((c: OperationalCost) => c.period === last);
    const existingNext = (operationalCosts || []).filter((c: OperationalCost) => c.period === next);
    const copies = source
      .filter((c: OperationalCost) => !existingNext.some(e => e.description === c.description && e.category === c.category))
      .map((c: OperationalCost, i: number) => ({ ...c, id: Date.now() + i, period: next, date: `${next}-${String(c.date || "").slice(8, 10) || "15"}`, status: "Expected" as any, invoiceNo: "", allocations: undefined, notes: `Copied from ${last}. ${c.notes || ""}`.trim() }));
    if (!copies.length) { alert(`All ${last} costs already exist in ${next}.`); return; }
    if (!window.confirm(`Copy ${copies.length} cost line(s) from ${last} into ${next} as "Expected"?`)) return;
    setOperationalCosts((prev: OperationalCost[]) => [...(prev || []), ...copies]);
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
              {(["pl", "costs", "warehouse", "ledger"] as const).map(t => <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 12px", borderRadius: 5, border: "none", background: tab === t ? "#fff" : "transparent", color: tab === t ? "#111" : "#666", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: tab === t ? "0 1px 2px rgba(0,0,0,0.05)" : "none" }}>{t === "pl" ? "Sales P/L" : t === "costs" ? "Operational Costs" : t === "warehouse" ? "Warehouse charges" : "Receivables & Payables"}</button>)}
            </div>
            <div style={{ display: "flex", gap: 2, background: "#F3F4F6", padding: 3, borderRadius: 7 }}>
              {(["forecast", "actual"] as MarginMode[]).map(m => <button key={m} onClick={() => setMode(m)} style={{ padding: "6px 14px", borderRadius: 5, border: "none", background: mode === m ? "#fff" : "transparent", color: mode === m ? "#111" : "#666", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: mode === m ? "0 1px 2px rgba(0,0,0,0.05)" : "none", textTransform: "capitalize" }}>{m}</button>)}
            </div>
          </div>
        </div>

        {tab === "ledger" ? (
          <LedgerView orders={orders} lots={lots} pos={pos} warehouseInvoices={warehouseInvoices} operationalCosts={operationalCosts} settledRefs={settledRefs} setSettledRefs={setSettledRefs} />
        ) : tab === "warehouse" ? (
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
                  <Field label="Invoice no. (received)"><Inp value={(form as any).invoiceNo || ""} onChange={(e: any) => setForm({ ...form, invoiceNo: e.target.value } as any)} placeholder="FV/2026/06/123 — from Fakturownia/KSeF" /></Field>
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
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <SectionTitle>OPERATIONAL COST ENTRIES</SectionTitle>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={copyLastMonth} title="Copy every cost of the most recent month into the next month as Expected — adjust amounts where needed" style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid #BFDBFE", background: "#fff", color: "#2563EB", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>⟳ Copy last month</button>
                      <button onClick={() => setShowFktImport(true)} title="Import the cost-invoice register exported from Fakturownia (XLS/CSV)" style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: "#16A34A", color: "#fff", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>📥 Import from Fakturownia</button>
                    </div>
                  </div>
                  {(operationalCosts || []).length === 0 ? <div style={{ fontSize: 12, color: "#AAA", padding: "12px 0" }}>No operational costs yet.</div> : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead><tr style={{ textAlign: "left", color: "#888", borderBottom: "1px solid #EEE" }}><th style={{ padding: 7 }}>Period</th><th>Description</th><th>Category</th><th>Method</th><th>Status</th><th style={{ textAlign: "right" }}>Amount</th><th></th></tr></thead>
                        <tbody>{(operationalCosts || []).slice().sort((a, b) => String(b.period).localeCompare(String(a.period))).map((c: OperationalCost) => <tr key={c.id} style={{ borderBottom: "1px solid #F5F5F5" }}>
                          <td style={{ padding: 7, color: "#666" }}>{c.period}</td>
                          <td><div style={{ fontWeight: 600, color: "#333" }}>{c.description}</div><div style={{ fontSize: 10.5, color: "#AAA" }}>{c.supplierName || "—"}{(c as any).invoiceNo ? <span style={{ fontFamily: "ui-monospace, Menlo, monospace" }}> · {(c as any).invoiceNo}</span> : null}</div></td>
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
      {showFktImport && (
        <FakturowniaCostImportModal
          contacts={contacts}
          operationalCosts={operationalCosts}
          onClose={() => setShowFktImport(false)}
          onImport={(costs: any[], whInvoices: any[]) => {
            if (costs.length && setOperationalCosts) setOperationalCosts((prev: any[]) => [...(prev || []), ...costs]);
            if (whInvoices.length && setWarehouseInvoices) setWarehouseInvoices((prev: any[]) => [...(prev || []), ...whInvoices]);
            setShowFktImport(false);
            alert(`Imported ${costs.length} operational cost(s)` + (whInvoices.length ? ` and ${whInvoices.length} warehouse invoice(s) (reconcile them in the Warehouse charges tab)` : "") + ".");
          }}
        />
      )}
    </div>
  );
}
