import { useConfirm } from "./ui";
import { parseBankCSV, matchBankLines, bankPaymentEvent, upsertBankAccountFromStatement } from "./bankReconciliation.domain";
import { advanceFromBankLine, advanceRemaining, applyAdvanceToInvoice, advanceSources, linkAdvanceToProforma } from "./advances.domain";
import { realizedFxPLN } from "./payments.domain";
import { canOpenFinance } from "./permissions.domain";
import { isShippedOrLater } from "./statusOwnership.domain";
import { upsertBudget, budgetVariance, BUDGET_MEASURES } from "./budgets.domain";
import { applyPaymentEvent as bankApplyPaymentEvent } from "./payments.domain";
import React, { useMemo, useState } from "react";
import { markInvoicePaidViaLedger, unmarkLedgerPaid } from "./payments.domain";
import { computeSOMargin } from "./marginCalculations";
import { nextId } from "./ids";
import { MarginMode } from "./marginCalculations";
import { localTodayISO, localMonthISO } from "./dates";
import { warehouseMonthCharges, tariffHasRates } from "./warehouseCharges";
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

const catLabel = (k: any) => OPERATIONAL_COST_CATEGORIES.find(c => c.key === k)?.label || String(k || "").replace(/_/g, " ");
const methodLabel = (k: any) => ALLOCATION_METHODS.find(m => m.key === k)?.label || String(k || "").replace(/_/g, " ");

function newCostTemplate(): OperationalCost {
  const period = localMonthISO();
  return {
    id: nextId(),
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



// v6.39.0 (ruling C-1): the Fakturownia import moved to the INVOICES module
// (tagged staging: goods / freight / customs / warehouse / overhead). The file
// parser lives on in fakturowniaImport.domain.



// ─── v6.9: RECEIVABLES & PAYABLES VIEW ──────────────────────────────────────


// ── v6.68.0 (F-1/F-4): ADVANCES ON ACCOUNT + BANK ACCOUNTS ────────────────────
function AdvancesPanel({ advancePayments = [], setAdvancePayments = null, invoices = [], setInvoices = null, bankAccounts = [] }: any) {
  const [pick, setPick] = React.useState<Record<string, any>>({});
  const [amt, setAmt] = React.useState<Record<string, string>>({});
  const [err, setErr] = React.useState<Record<string, string>>({});
  const openAdv = (advancePayments || []).filter((a: any) => advanceRemaining(a) > 0.005);
  const outstandingOf = (i: any) => Math.round(((Number(i.grossAmount) || 0) - (Number(i.paidAmount) || 0)) * 100) / 100;
  if (!openAdv.length && !(bankAccounts || []).length) return null;
  function apply(a: any) {
    const inv = (invoices || []).find((i: any) => String(i.id) === String(pick[a.id]));
    if (!inv || typeof setInvoices !== "function" || typeof setAdvancePayments !== "function") return;
    const r: any = applyAdvanceToInvoice(a, inv, amt[a.id] ?? Math.min(advanceRemaining(a), outstandingOf(inv)), { nextId, todayISO: () => localTodayISO() });
    if (r.error) { setErr(e => ({ ...e, [a.id]: r.error })); return; }
    setErr(e => ({ ...e, [a.id]: "" }));
    setInvoices((prev: any[]) => (prev || []).map((i: any) => String(i.id) === String(inv.id) ? r.invoice : i));
    setAdvancePayments((prev: any[]) => (prev || []).map((x: any) => String(x.id) === String(a.id) ? r.advance : x));
  }
  return (
    <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "14px 18px", marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 380px", minWidth: 340 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>💠 Advances on account {openAdv.length ? `(${openAdv.length} open)` : ""}</div>
          {!openAdv.length && <div style={{ fontSize: 11.5, color: "#94A3B8" }}>No unallocated advances. Record one from a bank line ("→ Advance").</div>}
          {openAdv.map((a: any) => {
            const rem = advanceRemaining(a);
            const candidates = (invoices || []).filter((i: any) => i.kind === "SALES" && i.paymentStatus !== "Cancelled" && i.paymentStatus !== "Draft" && String(i.currency || "PLN").toUpperCase() === a.currency && outstandingOf(i) > 0.005);
            return (
              <div key={String(a.id)} style={{ borderTop: "1px solid #F1F5F9", padding: "8px 0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 190px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{a.counterpartyName || "—"}</div>
                  <div style={{ fontSize: 10.5, color: "#94A3B8" }}>{a.date} · received {a.amount.toLocaleString("pl-PL")} {a.currency}</div>
                  {a.proformaNumber
                    ? <div style={{ fontSize: 10.5, fontWeight: 700, color: "#7C3AED" }}>↳ pro-forma {a.proformaNumber}</div>
                    : (() => { const pf = (invoices || []).filter((i: any) => i.isProforma && i.paymentStatus !== "Cancelled" && String(i.currency || "PLN").toUpperCase() === a.currency);
                        return pf.length ? <select value="" onChange={(e: any) => { const inv = pf.find((x: any) => String(x.id) === String(e.target.value)); if (!inv) return; const r: any = linkAdvanceToProforma(a, inv); if (!r.error) setAdvancePayments((prev: any[]) => (prev || []).map((x: any) => String(x.id) === String(a.id) ? r : x)); }} style={{ marginTop: 2, border: "1px dashed #DDD6FE", color: "#7C3AED", borderRadius: 6, padding: "3px 6px", fontSize: 10.5 }}>
                          <option value="">link pro-forma… (owner ruling: every advance answers one)</option>
                          {pf.map((i: any) => <option key={String(i.id)} value={i.id}>{i.number} · {i.counterparty?.name}</option>)}
                        </select> : <div style={{ fontSize: 10, color: "#C4B5FD" }}>no pro-forma linked yet — mark one in Invoices (Document type → Pro-forma)</div>; })()}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: "#7C3AED", fontVariantNumeric: "tabular-nums" }}>{rem.toLocaleString("pl-PL")} {a.currency} left</div>
                <select value={pick[a.id] ?? ""} onChange={(e: any) => setPick(p => ({ ...p, [a.id]: e.target.value }))} style={{ border: "1px solid #E5E7EB", borderRadius: 6, padding: "5px 8px", fontSize: 11.5, maxWidth: 230 }}>
                  <option value="">— apply to invoice —</option>
                  {candidates.map((i: any) => <option key={String(i.id)} value={i.id}>{i.number} · open {outstandingOf(i).toLocaleString("pl-PL")}</option>)}
                </select>
                <input type="number" value={amt[a.id] ?? ""} placeholder="amount" onChange={(e: any) => setAmt(m => ({ ...m, [a.id]: e.target.value }))} style={{ width: 92, border: "1px solid #E5E7EB", borderRadius: 6, padding: "5px 8px", fontSize: 11.5 }} />
                <button disabled={!pick[a.id]} onClick={() => apply(a)} style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: pick[a.id] ? "#7C3AED" : "#CBD5E1", color: "#fff", fontSize: 11.5, fontWeight: 800, cursor: pick[a.id] ? "pointer" : "not-allowed" }}>Apply</button>
                {err[a.id] && <div style={{ width: "100%", fontSize: 11, color: "#B91C1C" }}>{err[a.id]}</div>}
              </div>
            );
          })}
        </div>
        {(bankAccounts || []).length > 0 && (
          <div style={{ flex: "0 1 260px" }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>🏛 Bank accounts</div>
            {(bankAccounts || []).map((b: any) => (
              <div key={String(b.id)} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, padding: "4px 0", borderTop: "1px solid #F1F5F9" }}>
                <div><b>{b.label || b.bank}</b> <span style={{ color: "#94A3B8" }}>{b.currency}</span></div>
                <div style={{ fontVariantNumeric: "tabular-nums", color: "#334155" }}>{b.lastKnownBalance != null ? b.lastKnownBalance.toLocaleString("pl-PL", { minimumFractionDigits: 2 }) : "—"}<span style={{ color: "#CBD5E1" }}> · {b.lastImportDate}</span></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── v6.67.0 (D-33): BANK STATEMENT IMPORT — receivables-first, one-click confirm ──
// Owner rulings: CSV (PKO + Santander formats auto-detected), matches are NEVER
// auto-posted (the Confirm click is the act), tolerance ±0.05 in any currency.
// A confirmed line becomes a standard payment event with source bank:{lineId} —
// re-importing the same statement can never double-post.
function BankImportPanel({ invoices = [], setInvoices = null, nextId, advancePayments = [], setAdvancePayments = null, bankAccounts = [], setBankAccounts = null }: any) {
  const [parsed, setParsed] = React.useState<any>(null);
  const [done, setDone] = React.useState<Record<string, string>>({});
  const [pick, setPick] = React.useState<Record<string, any>>({});
  const fileRef = React.useRef<any>(null);
  const suggestions = React.useMemo(() => parsed ? matchBankLines(parsed.lines, invoices) : [], [parsed, invoices]);

  function onFile(f: any) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const p = parseBankCSV(String(reader.result || ""));
      setParsed(p); setDone({}); setPick({});
      // v6.68.0 (F-4): every statement registers/refreshes its account.
      if (typeof setBankAccounts === "function") setBankAccounts((prev: any[]) => upsertBankAccountFromStatement(prev || [], p, { nextId, todayISO: () => localTodayISO() }));
    };
    reader.readAsText(f, "UTF-8");
  }
  function confirmLine(s: any, invoiceId: any) {
    if (typeof setInvoices !== "function" || invoiceId == null) return;
    const evt = bankPaymentEvent(s.line);
    setInvoices((prev: any[]) => (prev || []).map((i: any) => String(i.id) === String(invoiceId) ? bankApplyPaymentEvent(i, evt, nextId) : i));
    setDone(d => ({ ...d, [s.line.id]: String(invoiceId) }));
  }

  const credits = suggestions.filter((s: any) => s.rank !== "IGNORED");
  const ignored = suggestions.length - credits.length;
  const fmtA = (n: number, c: string) => `${n.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} ${c}`;

  return (
    <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>🏦 Bank import — receivables</div>
        <div style={{ fontSize: 11, color: "#888" }}>PKO & Santander CSV exports · every match takes your click — nothing posts itself</div>
        <div style={{ marginLeft: "auto" }}>
          <button onClick={() => fileRef.current?.click()} style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: "#0369A1", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Upload statement CSV</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e: any) => onFile(e.target.files?.[0])} />
        </div>
      </div>
      {parsed && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, color: "#555", marginBottom: 8 }}>
            {parsed.format} · account …{String(parsed.account).slice(-6)} · {parsed.lines.length} lines ({ignored} debit/fee/own-transfer lines set aside — payables phase comes later){parsed.skipped ? ` · ${parsed.skipped} unparseable` : ""}
          </div>
          {credits.length === 0 && <div style={{ fontSize: 12, color: "#94A3B8", padding: 8 }}>No credit lines to match in this file.</div>}
          {credits.map((s: any) => {
            const doneInv = done[s.line.id];
            const chosen = pick[s.line.id] ?? s.invoiceId;
            const badge = s.rank === "NUMBER" ? ["invoice № in title", "#065F46", "#ECFDF5"]
              : s.rank === "AMOUNT+PARTY" ? ["amount + payer", "#1D4ED8", "#EFF6FF"]
              : s.rank === "AMOUNT" ? ["amount only — verify payer", "#B45309", "#FFFBEB"]
              : s.rank === "ALREADY" ? ["already recorded", "#6B7280", "#F3F4F6"]
              : ["no match — pick manually", "#B91C1C", "#FEF2F2"];
            return (
              <div key={s.line.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 4px", borderTop: "1px solid #F1F5F9", flexWrap: "wrap" }}>
                <div style={{ minWidth: 82, fontSize: 11.5, color: "#555" }}>{s.line.date}</div>
                <div style={{ flex: "1 1 220px", minWidth: 200 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{String(s.line.counterparty).slice(0, 46) || "—"}</div>
                  <div style={{ fontSize: 10.5, color: "#94A3B8" }} title={s.line.title}>{String(s.line.title).slice(0, 70)}</div>
                </div>
                <div style={{ minWidth: 110, textAlign: "right", fontSize: 13, fontWeight: 800, color: "#16A34A", fontVariantNumeric: "tabular-nums" }}>{fmtA(s.line.amount, s.line.currency)}</div>
                <span style={{ fontSize: 10, fontWeight: 800, color: badge[1], background: badge[2], borderRadius: 5, padding: "2px 8px" }} title={s.reason}>{badge[0]}</span>
                {doneInv ? (
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: "#065F46" }}>✓ recorded on {(invoices.find((i: any) => String(i.id) === String(doneInv)) || {}).number}</span>
                ) : s.rank === "ALREADY" ? null : (
                  <>
                    <select value={chosen ?? ""} onChange={(e: any) => setPick(p => ({ ...p, [s.line.id]: e.target.value }))} style={{ border: "1px solid #E5E7EB", borderRadius: 6, padding: "5px 8px", fontSize: 11.5, maxWidth: 260 }}>
                      <option value="">— pick invoice —</option>
                      {(s.invoiceId != null && !s.candidates.length ? [{ id: s.invoiceId, number: s.invoiceNumber, outstanding: null, counterparty: "" }] : s.candidates).map((c: any) => (
                        <option key={String(c.id)} value={c.id}>{c.number}{c.outstanding != null ? ` · open ${c.outstanding.toLocaleString("pl-PL")}` : ""}{c.counterparty ? ` · ${c.counterparty}` : ""}</option>
                      ))}
                    </select>
                    <button disabled={chosen == null || chosen === ""} onClick={() => confirmLine(s, chosen)} style={{ padding: "5px 14px", borderRadius: 7, border: "none", background: chosen != null && chosen !== "" ? "#16A34A" : "#CBD5E1", color: "#fff", fontSize: 12, fontWeight: 800, cursor: chosen != null && chosen !== "" ? "pointer" : "not-allowed" }}>Confirm receipt</button>
                    {typeof setAdvancePayments === "function" && (advanceSources(advancePayments).has(`bank:${s.line.id}`)
                      ? <span style={{ fontSize: 11, fontWeight: 800, color: "#7C3AED" }}>✓ advance</span>
                      : <button onClick={() => setAdvancePayments((prev: any[]) => [advanceFromBankLine(s.line, { nextId }), ...(prev || [])])} title="v6.68.0 (F-1): money received BEFORE any invoice exists — record it on account; apply it to invoices later from the Advances panel." style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #7C3AED", background: "#fff", color: "#7C3AED", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>→ Advance</button>)}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LedgerView({ orders = [], lots = [], pos = [], invoices = [], setInvoices = null, financeNotes = [], warehouseInvoices = [], operationalCosts = [], settledRefs = [], setSettledRefs = null, advancePayments = [], setAdvancePayments = null, bankAccounts = [], setBankAccounts = null }: any) {
  const { alert: lvAlert, dialogNode: lvNode } = useConfirm(); // P2-6
  const [dir, setDir] = useState<"all" | "receivable" | "payable">("all");
  const [hidePaid, setHidePaid] = useState(true);
  const today = localTodayISO();
  const { items, totals } = buildLedger({ orders, lots, pos, invoices, financeNotes, settledRefs, todayISO: today });

  async function togglePaid(ref: string) {
    // Batch 5d (BP-39): for INVOICES, "mark paid" writes a tagged payment EVENT on
    // the invoice (the flag store is retired for them). PO/PAYOUT commitment rows
    // keep the flag — they have no invoice record to carry events.
    if (String(ref).startsWith("INV:") && setInvoices) {
      const id = String(ref).slice(4);
      const inv = (invoices || []).find((x: any) => String(x.id) === id);
      if (!inv) return;
      const isPaidNow = inv.paymentStatus === "Paid";
      if (!isPaidNow) {
        setInvoices((prev: any[]) => prev.map((x: any) => String(x.id) === id ? markInvoicePaidViaLedger(x, today, nextId) : x));
      } else {
        const un = unmarkLedgerPaid(inv);
        if (un === null) { await lvAlert({ tone: "warn", title: "Paid by recorded payments", message: "This invoice is paid by recorded payments — edit them in the Invoices module." }); return; }
        setInvoices((prev: any[]) => prev.map((x: any) => String(x.id) === id ? un : x));
      }
      return;
    }
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
      {lvNode}
      {(() => { const fx = (invoices || []).reduce((s: number, i: any) => s + realizedFxPLN(i), 0);
        return Math.abs(fx) > 0.005 ? <div style={{ fontSize: 11.5, fontWeight: 700, color: fx >= 0 ? "#065F46" : "#B91C1C", background: fx >= 0 ? "#ECFDF5" : "#FEF2F2", border: "1px solid " + (fx >= 0 ? "#A7F3D0" : "#FECACA"), borderRadius: 8, padding: "6px 12px", marginBottom: 10 }}>Realized FX {fx >= 0 ? "gain" : "loss"} to date: {fx.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} PLN <span style={{ fontWeight: 400, color: "#64748B" }}>(from payments recorded with a bank settlement rate — v6.68.0 F-2)</span></div> : null; })()}
      <BankImportPanel invoices={invoices} setInvoices={setInvoices} nextId={nextId} advancePayments={advancePayments} setAdvancePayments={setAdvancePayments} bankAccounts={bankAccounts} setBankAccounts={setBankAccounts} />
      <AdvancesPanel advancePayments={advancePayments} setAdvancePayments={setAdvancePayments} invoices={invoices} setInvoices={setInvoices} bankAccounts={bankAccounts} />
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
                  <button onClick={() => togglePaid(i.ref)} title={i.status === "Paid" ? (i.direction === "receivable" ? "Undo receipt" : "Mark unpaid") : (i.direction === "receivable" ? "Record that the client's money arrived" : "Mark paid")} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid", borderColor: i.status === "Paid" ? "#E5E7EB" : "#BBF7D0", background: i.status === "Paid" ? "#fff" : "#F0FDF4", color: i.status === "Paid" ? "#888" : "#15803D", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{i.status === "Paid" ? "Undo" : (i.direction === "receivable" ? "Record receipt" : "Mark paid")}</button>
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={9} style={{ padding: 18, textAlign: "center", color: "#AAA", fontStyle: "italic" }}>Nothing to show. {hidePaid ? "Untick \"Hide paid\" to see settled items." : ""}</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10.5, color: "#AAA", marginTop: 8, lineHeight: 1.5 }}>
        Receivables and invoice-based payables (sales, warehouse, freight and other cost invoices) now read from the <strong>Invoices</strong> module — the single source of truth — so anything you add, edit or pay there flows straight into this ledger and the P/L. Producer payouts (closed consignment settlements) and firm-price PO purchase commitments are still computed from inventory and the POs. Payroll and taxes (no invoice number) are excluded. "Mark paid" here is a manual flag; recording a payment on the invoice itself (Invoices module) is the cleaner way and also clears it here.
      </div>
    </>
  );
}

// ─── v6.5: WAREHOUSE CHARGES — expected vs invoiced, per warehouse per month ─
function WarehouseChargesView({ lots = [], setLots = null, contacts = [], warehouseInvoices = [], setWarehouseInvoices = null }: any) {
  const { confirm: wcConfirm, alert: wcAlert, dialogNode: wcNode } = useConfirm(); // P2-6
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
    const rec = { id: nextId(), warehouseId: whId, warehouseName: wh?.name || "", period, invoiceNo: inv.invoiceNo.trim(), date: inv.date, amount, currency: inv.currency, fxRate: fx, amountPLN: Math.round(amount * fx * 100) / 100, status: "Received", notes: inv.notes };
    setWarehouseInvoices((prev: any[]) => [...(prev || []), rec]);
    setInv({ invoiceNo: "", amount: "", currency: inv.currency, fxRate: inv.fxRate, date: today, notes: "" });
  }

  async function approveInvoice(invoice: any) {
    if (!setWarehouseInvoices) return;
    if (!result.rows.length) { await wcAlert({ tone: "warn", title: "Nothing to allocate", message: "No expected charges computed for this warehouse/month — nothing to allocate against." }); return; }
    if (!(await wcConfirm({ tone: "warn", title: `Approve invoice ${invoice.invoiceNo}?`, message: `${invoice.amountPLN.toLocaleString("pl-PL")} PLN allocated into the ${result.rows.length} lot(s) of ${period}.\n\nThe amount is split across lots proportionally to their expected charges and becomes part of each lot's landed cost (visible in SO P/L).`, confirmLabel: "Approve & allocate" }))) return;
    const totalExpectedPLN = result.totalPLN || 1;
    const allocations = result.rows.map((r: any) => ({ lotNumber: r.lotNumber, amountPLN: Math.round(invoice.amountPLN * (r.totalPLN / totalExpectedPLN) * 100) / 100 }));
    if (setLots) {
      const source = `WHINV-${invoice.id}`;
      const byLot = new Map(allocations.map((a: any) => [String(a.lotNumber), a.amountPLN]));
      setLots((prev: any[]) => prev.map((lot: any) => {
        // Replace-by-ref discipline: remove any prior line tagged to THIS invoice
        // (so re-approving a corrected invoice re-allocates cleanly instead of
        // stacking or going stale), then add the fresh share if this lot has one.
        const withoutPrior = (lot.costs || []).filter((c: any) => c.source !== source);
        const amt = byLot.get(String(lot.number));
        if (amt && amt > 0) {
          return { ...lot, costs: [...withoutPrior, { id: nextId(), type: "Warehousing", label: `${invoice.warehouseName || "Warehouse"} ${period} · inv ${invoice.invoiceNo}`, pln: amt, source }] };
        }
        // Lot no longer in the allocation set: keep it stripped of any stale line.
        return withoutPrior.length === (lot.costs || []).length ? lot : { ...lot, costs: withoutPrior };
      }));
    }
    setWarehouseInvoices((prev: any[]) => prev.map((i: any) => i.id === invoice.id ? { ...i, status: "Approved", allocatedLots: allocations } : i));
  }

  async function deleteInvoice(invoice: any) {
    if (invoice.status === "Approved") { await wcAlert({ tone: "warn", title: "Can't delete", message: "This invoice is approved and already allocated into lot costs — it can't be deleted from here." }); return; }
    if (!(await wcConfirm({ tone: "danger", title: `Delete invoice ${invoice.invoiceNo}?`, confirmLabel: "Delete" }))) return;
    setWarehouseInvoices && setWarehouseInvoices((prev: any[]) => prev.filter((i: any) => i.id !== invoice.id));
  }

  const box: any = { background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "16px 18px", marginBottom: 14 };
  if (!warehouses.length) return (
    <div style={box}>
      {wcNode}
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

// ─── CREDIT NOTES (v6.11 · #12) ──────────────────────────────────────────────
// A credit note adjusts a balance with a counterparty: an INCOMING note (in our
// favour) is one a supplier / carrier / warehouse issues to us (e.g. for damaged
// goods or a transport claim); an OUTGOING note is one we issue to a client. They
// are recorded here and can be reconciled against Receivables & Payables.
// v6.33.0 (A3-5): the legacy Credit Notes tab is retired — legacy records are
// folded into the canonical FinanceNote model (Invoices module owns notes) and
// now enter the receivable/payable totals (BP-37).

export default function Finance({
  claims = [],
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
  invoices = [],
  setInvoices = null,
  financeNotes = [],
  advancePayments = [],
  setAdvancePayments = null,
  bankAccounts = [],
  setBankAccounts = null,
  budgets = [],
  setBudgets = null,
  users = [],
  userName = "",
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
  invoices?: any[];
  setInvoices?: any;
  financeNotes?: any[];
  claims?: any[];
  advancePayments?: any[];
  setAdvancePayments?: any;
  bankAccounts?: any[];
  setBankAccounts?: any;
  budgets?: any[];
  setBudgets?: any;
  users?: any[];
  userName?: string;
}) {
  const { confirm: finConfirm, alert: finAlert, dialogNode: finNode } = useConfirm(); // P2-6
  const [mode, setMode] = useState<MarginMode>("forecast");
  const [tab, setTab] = useState<"pl" | "costs" | "warehouse" | "ledger">("pl");
  const [form, setForm] = useState<OperationalCost>(() => newCostTemplate());
  // v6.10: filters + hover-preview for the Operational Cost Entries register.
  const [costPeriodFilter, setCostPeriodFilter] = useState<string>("all");
  const [costSupplierFilter, setCostSupplierFilter] = useState<string>("all");
  const [openCost, setOpenCost] = useState<OperationalCost | null>(null);

  const committedFilter = (o: any) => o.status !== "Draft";
  const totalAgg = useMemo(() => aggregateNetMargins(orders, lots, pos, shipments, mode, committedFilter, operationalCosts, orders), [orders, lots, pos, shipments, mode, operationalCosts]);
  const deliveredAgg = useMemo(() => aggregateNetMargins(orders, lots, pos, shipments, mode, (o: any) => isShippedOrLater(o, shipments), operationalCosts, orders), [orders, lots, pos, shipments, mode, operationalCosts]);
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

  // v6.10: distinct periods & suppliers for the entry-register filters, and the
  // filtered list itself (sorted by date desc, falling back to period).
  const costPeriods = useMemo(
    () => Array.from(new Set((operationalCosts || []).map((c: OperationalCost) => c.period).filter(Boolean))).sort((a, b) => String(b).localeCompare(String(a))),
    [operationalCosts]
  );
  const costSuppliers = useMemo(
    () => Array.from(new Set((operationalCosts || []).map((c: OperationalCost) => (c.supplierName || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [operationalCosts]
  );
  const filteredCosts = useMemo(
    () => (operationalCosts || [])
      .filter((c: OperationalCost) => costPeriodFilter === "all" || c.period === costPeriodFilter)
      .filter((c: OperationalCost) => costSupplierFilter === "all" || (c.supplierName || "").trim() === costSupplierFilter)
      .slice()
      .sort((a, b) => String(b.date || b.period || "").localeCompare(String(a.date || a.period || ""))),
    [operationalCosts, costPeriodFilter, costSupplierFilter]
  );
  const filteredCostTotalPLN = useMemo(
    () => filteredCosts.reduce((s: number, c: OperationalCost) => s + (safe(c.amountPLN) || safe(c.amount) * (safe(c.fxRate) || 1)), 0),
    [filteredCosts]
  );

  async function saveCost() {
    if (!setOperationalCosts) return;
    const amountPLN = safe(form.amountPLN) || safe(form.amount) * (safe(form.fxRate) || 1);
    if (!form.period || !form.description || amountPLN <= 0) {
      await finAlert({ tone: "warn", title: "Missing fields", message: "Please enter period, description and a positive amount." });
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

  async function deleteCost(id: number) {
    if (!setOperationalCosts) return;
    if (!(await finConfirm({ tone: "danger", title: "Delete operational cost?", confirmLabel: "Delete" }))) return;
    setOperationalCosts((prev: OperationalCost[]) => (prev || []).filter(c => c.id !== id));
  }


  // v6.7: clone the most recent month's costs into the following month as "Expected".
  async function copyLastMonth() {
    if (!setOperationalCosts) return;
    const periods = Array.from(new Set((operationalCosts || []).map((c: OperationalCost) => c.period).filter(Boolean))).sort();
    const last = periods[periods.length - 1];
    if (!last) { await finAlert({ tone: "warn", title: "Nothing to copy", message: "No costs recorded yet — nothing to copy." }); return; }
    const [y, m] = String(last).split("-").map(Number);
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    const next = `${ny}-${String(nm).padStart(2, "0")}`;
    const source = (operationalCosts || []).filter((c: OperationalCost) => c.period === last);
    const existingNext = (operationalCosts || []).filter((c: OperationalCost) => c.period === next);
    const copies = source
      .filter((c: OperationalCost) => !existingNext.some(e => e.description === c.description && e.category === c.category))
      .map((c: OperationalCost, i: number) => ({ ...c, id: nextId(), period: next, date: `${next}-${String(c.date || "").slice(8, 10) || "15"}`, status: "Expected" as any, invoiceNo: "", allocations: undefined, notes: `Copied from ${last}. ${c.notes || ""}`.trim() }));
    if (!copies.length) { await finAlert({ tone: "info", title: "Already copied", message: `All ${last} costs already exist in ${next}.` }); return; }
    if (!(await finConfirm({ tone: "warn", title: "Copy cost lines forward?", message: `Copy ${copies.length} cost line(s) from ${last} into ${next} as "Expected"?`, confirmLabel: "Copy" }))) return;
    setOperationalCosts((prev: OperationalCost[]) => [...(prev || []), ...copies]);
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "24px 28px", background: "#FAFAFA" }}>
      {finNode}
      <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#111", letterSpacing: "-0.3px" }}>Finance · P&L Analytics</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
              {mode === "forecast" ? "Forecast — commitments, expected costs and budget overhead" : "Actual — shipped revenue, settled costs and posted overhead"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 6, background: "#F3F4F6", padding: 3, borderRadius: 8 }}>
              {(["pl", "costs", "warehouse", "ledger"] as const).filter(t => canOpenFinance(users, userName, t)).map(t => {
                const active = tab === t;
                const label = t === "pl" ? "Sales P/L" : t === "costs" ? "Operational Costs" : t === "warehouse" ? "Warehouse charges" : "Receivables & Payables";
                return <button key={t} onClick={() => setTab(t)} style={{
                  padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  border: `1px solid ${active ? "#CBD5E1" : "#E5E7EB"}`,
                  background: "#fff",
                  color: active ? "#111" : "#666",
                  boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                }}>{label}</button>;
              })}
            </div>
            <div style={{ display: "flex", gap: 2, background: "#F3F4F6", padding: 3, borderRadius: 7 }}>
              {(["forecast", "actual"] as MarginMode[]).map(m => <button key={m} onClick={() => setMode(m)} style={{ padding: "6px 14px", borderRadius: 5, border: "none", background: mode === m ? "#fff" : "transparent", color: mode === m ? "#111" : "#666", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: mode === m ? "0 1px 2px rgba(0,0,0,0.05)" : "none", textTransform: "capitalize" }}>{m}</button>)}
            </div>
          </div>
        </div>

        {tab === "ledger" ? (
          <LedgerView orders={orders} lots={lots} pos={pos} invoices={invoices} setInvoices={setInvoices} financeNotes={financeNotes} settledRefs={settledRefs} setSettledRefs={setSettledRefs} advancePayments={advancePayments} setAdvancePayments={setAdvancePayments} bankAccounts={bankAccounts} setBankAccounts={setBankAccounts} />
        ) : tab === "warehouse" ? (
          <WarehouseChargesView lots={lots} setLots={setLots} contacts={contacts} warehouseInvoices={warehouseInvoices} setWarehouseInvoices={setWarehouseInvoices} />
        ) : tab === "pl" ? (
          <>
            <Card style={{ marginBottom: 16 }}>
              <SectionTitle>OVERALL · ALL ACTIVE SALES ORDERS</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 14 }}>
                <StatBlock label="REVENUE" value={fmtPLN(totalAgg.totalRevenuePLN)} sub={`${totalAgg.orderCount} order${totalAgg.orderCount === 1 ? "" : "s"}`} />
                {/* v6.20.2 note (Batch 3 pending): direct transport costs are being reworked under
                    the cost-ownership model. */}
                <StatBlock label="COGS" value={fmtPLN(totalAgg.totalCOGSPLN)} valueColor="#7C3AED" sub="product / landed cost" />
                <StatBlock label="DIRECT COSTS" value={fmtPLN(totalAgg.totalDirectPLN)} valueColor="#F59E0B" sub="shipments / logistics" />
                <StatBlock label="CONTRIBUTION (before overhead)" value={fmtPLN(totalAgg.totalContributionPLN)} valueColor={totalAgg.totalContributionPLN < 0 ? "#DC2626" : "#16A34A"} sub={fmtPct(totalAgg.avgContributionPct)} />
                <StatBlock label="OVERHEAD" value={fmtPLN(totalAgg.totalOverheadPLN)} valueColor="#64748B" sub="allocated operating cost" />
                <StatBlock label="NET P/L" value={fmtPLN(totalAgg.totalNetMarginPLN)} valueColor={totalAgg.totalNetMarginPLN < 0 ? "#DC2626" : "#16A34A"} sub={fmtPct(totalAgg.avgNetMarginPct)} />
              </div>
              {canOpenFinance(users, userName, "budget") && typeof setBudgets === "function" && (() => {
                const period = localTodayISO().slice(0, 7);
                const actuals: any = { revenue: totalAgg.totalRevenuePLN, contribution: totalAgg.totalContributionPLN, overhead: totalAgg.totalOverheadPLN, net: totalAgg.totalNetMarginPLN ?? 0 };
                const rows = budgetVariance(budgets, period, actuals);
                return (
                  <div style={{ marginTop: 10, border: "1px dashed #DDD6FE", borderRadius: 8, padding: "8px 12px", fontSize: 11.5 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <b style={{ color: "#7C3AED" }}>Budget vs actual · {period}</b>
                      <span style={{ color: "#94A3B8" }}>(v6.79.0 F-6 — owner only; set a monthly target per measure)</span>
                      {BUDGET_MEASURES.map(mz => (
                        <label key={mz} style={{ display: "flex", gap: 4, alignItems: "center" }}>{mz}
                          <input type="number" placeholder="PLN" defaultValue={(budgets || []).find((b: any) => b.period === period && b.measure === mz)?.amountPLN ?? ""}
                            onBlur={(e: any) => { const v = parseFloat(e.target.value); if (!isFinite(v)) return; setBudgets((prev: any[]) => upsertBudget(prev || [], { id: `${period}:${mz}`, period, measure: mz, amountPLN: v })); }}
                            style={{ width: 96, border: "1px solid #E5E7EB", borderRadius: 6, padding: "3px 6px", fontSize: 11 }} />
                        </label>
                      ))}
                    </div>
                    {rows.length > 0 && <div style={{ marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
                      {rows.map(r => <span key={r.measure} style={{ color: r.variancePLN >= 0 ? "#065F46" : "#B91C1C", fontWeight: 700 }}>{r.measure}: {r.actualPLN.toLocaleString("pl-PL")} vs {r.budgetPLN.toLocaleString("pl-PL")} ({r.variancePLN >= 0 ? "+" : ""}{r.variancePLN.toLocaleString("pl-PL")}{r.variancePct != null ? ` · ${r.variancePct}%` : ""})</span>)}
                    </div>}
                  </div>
                );
              })()}
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
            <div style={{ marginBottom: 22 }}>
              <SectionTitle>CLAIMS <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "#94A3B8" }}>· producer claims (CLM) and client claims, with their credit notes</span></SectionTitle>
              {(() => {
                // v6.36.2 (P3): the claims REGISTER — one place listing every claim.
                // Producer claims live on the lot (lot.claims); client claims are CLAIM
                // movements. Edited where they live: producer → Inventory lot; client →
                // SO detail ("Record client claim") or the lot's quality flow.
                const rows: any[] = [];
                // v6.48.0: claims are their own documents now — the register reads the
                // claims store. Every claim has a number, including the client ones
                // that used to exist only as movements.
                (claims || []).forEach((c: any) => {
                  const lotRef = (c.subjects || []).find((x: any) => x.kind === "LOT")?.ref || "";
                  const other = (c.subjects || []).find((x: any) => x.kind === "PO" || x.kind === "SO" || x.kind === "SHIPMENT")?.ref || "";
                  const amt = c.acceptedEUR != null && c.acceptedEUR !== "" ? c.acceptedEUR : c.requestedEUR;
                  rows.push({
                    kind: c.direction === "CONCESSION" ? "Client" : (c.respondent?.kind || "Supplier"),
                    ref: c.number || "(draft)", date: c.date || "",
                    lot: lotRef, doc: other,
                    detail: [
                      c.cause || "",
                      c.defectPct ? `${c.defectPct}% defect` : "",
                      Number(amt) ? `€${Number(amt).toLocaleString("pl-PL")}${c.acceptedEUR != null && c.acceptedEUR !== "" ? " agreed" : " requested"}` : "",
                      c.respondent?.name || "",
                    ].filter(Boolean).join(" · "),
                    status: c.status || "Draft",
                  });
                });
                (lots || []).forEach((l: any) => {
                  const documented = new Set((claims || []).map((c: any) => String(c.movementRef ?? "")).filter(Boolean));
                  (l.movements || []).filter((m: any) => m && !m.voided && m.type === "CLAIM" && !documented.has(String(m.id))).forEach((m: any) => rows.push({
                    kind: "Client", ref: `${l.number}`, date: m.date || "",
                    lot: l.number, doc: m.soRef || "", detail: [m.qtyKg ? `${Number(m.qtyKg).toLocaleString("pl-PL")} kg` : "", m.claimValue ? `${Number(m.claimValue).toLocaleString("pl-PL")} ${m.claimCurrency || "PLN"}` : ""].filter(Boolean).join(" · "),
                    status: (financeNotes || []).some((n: any) => n.source === m.source) ? "Credit note drafted" : "Recorded",
                  }));
                });
                rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
                if (!rows.length) return <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 10, padding: 16, fontSize: 12.5, color: "#94A3B8" }}>No claims recorded. Producer claims start from the lot (Inventory); client claims from the SO ("Record client claim") or the lot's quality flow.</div>;
                return (
                  <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "90px 130px 90px 120px 120px 1fr 130px", padding: "8px 14px", background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
                      {["TYPE", "REF", "DATE", "LOT", "PO / SO", "DETAIL", "STATUS"].map((h, i) => <div key={i} style={{ fontSize: 9.5, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em" }}>{h}</div>)}
                    </div>
                    {rows.map((r, i) => (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "90px 130px 90px 120px 120px 1fr 130px", padding: "8px 14px", borderBottom: i < rows.length - 1 ? "1px solid #F8FAFC" : "none", fontSize: 12, alignItems: "center" }}>
                        <div><span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: r.kind === "Producer" ? "#FEF3C7" : "#FEE2E2", color: r.kind === "Producer" ? "#B45309" : "#B91C1C" }}>{r.kind}</span></div>
                        <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 600 }}>{r.ref}</div>
                        <div style={{ color: "#64748B" }}>{r.date || "—"}</div>
                        <div style={{ fontFamily: "ui-monospace, Menlo, monospace", color: "#7C3AED" }}>{r.lot}</div>
                        <div style={{ fontFamily: "ui-monospace, Menlo, monospace", color: "#2563EB" }}>{r.doc || "—"}</div>
                        <div style={{ color: "#475569" }}>{r.detail || "—"}</div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: r.status === "Issued" ? "#16A34A" : r.status === "Credit note drafted" ? "#0369A1" : "#64748B" }}>{r.status}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

                {byProduct.length === 0 ? <div style={{ fontSize: 12, color: "#AAA", padding: "12px 0" }}>No data yet.</div> : byProduct.map(g => <BarRow key={g.key} label={g.key} value={g.agg.totalNetMarginPLN} maxValue={maxProductNet} marginPct={g.agg.avgNetMarginPct} sub={`${g.agg.orderCount} SO · ${fmtPLNcompact(g.agg.totalRevenuePLN)} revenue · overhead ${fmtPLNcompact(g.agg.totalOverheadPLN)}`} />)}
              </Card>
            </div>

            <Card style={{ marginBottom: 18 }}>
              <SectionTitle>P/L BY SALES ORDER</SectionTitle>
              <div style={{ fontSize: 10.5, color: "#64748B", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 7, padding: "7px 10px", marginTop: 10 }}>
                Direct costs flow automatically (v6.37.1): freight entered on shipment legs mirrors into the shipment's costs, delivery allocates them into lot landed cost, and the <b>actual</b> P/L counts a cost once it's invoiced <b>or</b> its shipment is Delivered/Closed (accrual). Costs already in a lot's landed cost arrive here through COGS — never double-counted.
              </div>
              {(() => {
                const rows = (orders || [])
                  .filter(committedFilter)
                  .map((o: any) => ({ o, m: computeSOMargin(o, lots, pos, shipments, mode) }))
                  .sort((a: any, b: any) => (b.m.marginPLN || 0) - (a.m.marginPLN || 0));
                if (!rows.length) return <div style={{ fontSize: 12, color: "#AAA", padding: "12px 0" }}>No committed sales orders yet.</div>;
                return (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "130px 1fr 90px 110px 110px 110px 120px 70px", gap: 8, padding: "6px 8px", fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>
                      <div>SO</div><div>Client</div><div>Status</div><div style={{ textAlign: "right" }}>Revenue</div><div style={{ textAlign: "right" }}>COGS</div><div style={{ textAlign: "right" }}>Direct</div><div style={{ textAlign: "right" }}>Net margin</div><div style={{ textAlign: "right" }}>%</div>
                    </div>
                    {rows.map(({ o, m }: any) => (
                      <div key={o.id} style={{ display: "grid", gridTemplateColumns: "130px 1fr 90px 110px 110px 110px 120px 70px", gap: 8, padding: "8px 8px", fontSize: 12, borderTop: "1px solid #F1F5F9", alignItems: "center" }}>
                        <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 700, color: "#0369A1" }}>{o.number}</div>
                        <div style={{ color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.client?.name || "—"}</div>
                        <div style={{ fontSize: 11, color: "#64748B" }}>{o.status}</div>
                        <div style={{ textAlign: "right" }}>{fmtPLNcompact(m.revenuePLN)}</div>
                        <div style={{ textAlign: "right", color: "#64748B" }}>{fmtPLNcompact(m.cogsPLN)}</div>
                        <div style={{ textAlign: "right", color: "#64748B" }}>{fmtPLNcompact(m.directCostsPLN)}</div>
                        <div style={{ textAlign: "right", fontWeight: 700, color: (m.marginPLN || 0) >= 0 ? "#16A34A" : "#DC2626" }}>{fmtPLNcompact(m.marginPLN)}</div>
                        <div style={{ textAlign: "right", color: "#94A3B8" }}>{m.marginPct}%</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </Card>

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
            <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1.1fr", gap: 14, alignItems: "start" }}>
              <Card style={{ order: 2 }}>
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
                  <Field label="Cost invoice no. (actual)"><Inp value={(form as any).invoiceRef || ""} onChange={(e: any) => setForm({ ...form, invoiceRef: e.target.value } as any)} placeholder="e.g. FS 106/2026 — links this line to the real invoice" /></Field>
                </div>
                <div style={{ marginTop: 10 }}>
                  <Field label="Notes"><Inp value={form.notes || ""} onChange={(e: any) => setForm({ ...form, notes: e.target.value })} placeholder="Internal note" /></Field>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <Button variant="primary" onClick={saveCost}>Save cost</Button>
                  <Button onClick={() => setForm(newCostTemplate())}>Clear</Button>
                </div>
                <div style={{ marginTop: 12, fontSize: 11, color: "#888", lineHeight: 1.45 }}>
                  These lines are the overhead BUDGET / PLAN. Forecast counts every status; ACTUAL counts a line once it's linked to a real cost invoice (invoice no. above) — or, for unlinked legacy lines, once its status is Received / Posted / Paid. The invoice itself lives in the Invoices module (the money-document registry); direct delivery petrol belongs on the Shipment, not here.
                </div>
              </Card>

              <div style={{ order: 1 }}>
                <Card style={{ marginBottom: 14 }}>
                  <SectionTitle>OVERHEAD BUDGET / PLAN — SUMMARY</SectionTitle>
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
                    </div>
                  </div>
                  {/* v6.10: filter by period and by supplier */}
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "8px 0 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "#888" }}>PERIOD</span>
                      <select value={costPeriodFilter} onChange={e => setCostPeriodFilter(e.target.value)} style={{ border: "1px solid #E5E7EB", borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: "inherit", background: "#fff" }}>
                        <option value="all">All periods</option>
                        {costPeriods.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "#888" }}>SUPPLIER</span>
                      <select value={costSupplierFilter} onChange={e => setCostSupplierFilter(e.target.value)} style={{ border: "1px solid #E5E7EB", borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: "inherit", background: "#fff", maxWidth: 220 }}>
                        <option value="all">All suppliers</option>
                        {costSuppliers.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    {(costPeriodFilter !== "all" || costSupplierFilter !== "all") && (
                      <button onClick={() => { setCostPeriodFilter("all"); setCostSupplierFilter("all"); }} style={{ border: "none", background: "transparent", color: "#2563EB", cursor: "pointer", fontSize: 11.5, fontFamily: "inherit" }}>clear filters</button>
                    )}
                    <div style={{ marginLeft: "auto", fontSize: 11, color: "#888" }}>{filteredCosts.length} entr{filteredCosts.length === 1 ? "y" : "ies"} · <strong>{fmtPLN(filteredCostTotalPLN)}</strong></div>
                  </div>

                  {/* v6.11.1 (#): click a row to open/close its full detail */}
                  <div style={{ minHeight: 64, marginBottom: 10, padding: "9px 12px", borderRadius: 8, border: "1px dashed #E5E7EB", background: "#FCFCFD", fontSize: 11.5, color: "#555" }}>
                    {openCost ? (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <div style={{ fontWeight: 700, color: "#333" }}>Entry detail</div>
                          <button onClick={() => setOpenCost(null)} style={{ border: "1px solid #E5E7EB", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 11, padding: "2px 8px", color: "#666" }}>Close ✕</button>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginBottom: 4 }}>
                          <span><span style={{ color: "#AAA" }}>Period</span> <strong>{openCost.period || "—"}</strong></span>
                          <span><span style={{ color: "#AAA" }}>Date</span> <strong>{openCost.date || "—"}</strong></span>
                          <span><span style={{ color: "#AAA" }}>Supplier</span> <strong>{openCost.supplierName || "—"}</strong></span>
                          <span><span style={{ color: "#AAA" }}>Invoice no.</span> <strong style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{(openCost as any).invoiceNo || "—"}</strong></span>
                          <span><span style={{ color: "#AAA" }}>Category</span> <strong>{catLabel(openCost.category)}</strong></span>
                          <span><span style={{ color: "#AAA" }}>Cost center</span> <strong>{openCost.costCenter || "—"}</strong></span>
                          <span><span style={{ color: "#AAA" }}>Allocation</span> <strong>{methodLabel(openCost.allocationMethod)}</strong></span>
                          <span><span style={{ color: "#AAA" }}>Amount</span> <strong>{safe(openCost.amount).toLocaleString("pl-PL", { minimumFractionDigits: 2 })} {openCost.currency}</strong>{openCost.currency !== "PLN" ? <span style={{ color: "#AAA" }}> · {fmtPLN(safe(openCost.amountPLN) || safe(openCost.amount) * (safe(openCost.fxRate) || 1))} @ {openCost.fxRate}</span> : null}</span>
                        </div>
                        <div style={{ color: "#333" }}>{openCost.description || "—"}</div>
                        {openCost.notes ? <div style={{ color: "#999", marginTop: 2, fontStyle: "italic" }}>{openCost.notes}</div> : null}
                      </div>
                    ) : (
                      <span style={{ color: "#AAA" }}>Click a row to open its full detail (period, date, cost center, invoice no., allocation, notes). Use Edit to correct or Delete to remove.</span>
                    )}
                  </div>

                  {(operationalCosts || []).length === 0 ? (
                    <div style={{ fontSize: 12, color: "#AAA", padding: "12px 0" }}>No operational costs yet.</div>
                  ) : filteredCosts.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#AAA", padding: "12px 0" }}>No entries match the current filter.</div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead><tr style={{ textAlign: "left", color: "#888", borderBottom: "1px solid #EEE" }}><th style={{ padding: 7 }}>Date</th><th>Supplier</th><th>Category</th><th>Status</th><th style={{ textAlign: "right" }}>Amount</th><th></th></tr></thead>
                        <tbody>{filteredCosts.map((c: OperationalCost) => <tr key={c.id} onClick={() => setOpenCost(prev => (prev && prev.id === c.id ? null : c))} style={{ borderBottom: "1px solid #F5F5F5", background: openCost && openCost.id === c.id ? "#F1F5F9" : "transparent", cursor: "pointer" }}>
                          <td style={{ padding: 7, color: "#666", whiteSpace: "nowrap" }}>{c.date || c.period || "—"}</td>
                          <td><div style={{ fontWeight: 600, color: "#333" }}>{c.supplierName || "—"}</div>{(c as any).invoiceNo ? <div style={{ fontSize: 10.5, color: "#AAA", fontFamily: "ui-monospace, Menlo, monospace" }}>{(c as any).invoiceNo}</div> : null}</td>
                          <td>{catLabel(c.category)}</td>
                          <td><span style={{ padding: "2px 6px", borderRadius: 999, background: c.status === "Budget" ? "#EFF6FF" : c.status === "Expected" ? "#FEF3C7" : "#ECFDF5", color: c.status === "Budget" ? "#1D4ED8" : c.status === "Expected" ? "#92400E" : "#065F46", fontSize: 10.5 }}>{c.status}</span></td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtPLN(safe(c.amountPLN) || safe(c.amount) * (safe(c.fxRate) || 1))}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}><button onClick={(e) => { e.stopPropagation(); editCost(c); }} style={{ border: "none", background: "transparent", color: "#2563EB", cursor: "pointer", fontSize: 11 }}>Edit</button><button onClick={(e) => { e.stopPropagation(); deleteCost(c.id); }} style={{ border: "none", background: "transparent", color: "#DC2626", cursor: "pointer", fontSize: 11 }}>Delete</button></td>
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