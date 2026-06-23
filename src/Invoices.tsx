import React, { useMemo, useState } from "react";
import { nextId } from "./ids";
import { resolveFxRate, defaultFxRate } from "./fx";
import { readFakturowniaConfig, createInvoice } from "./fakturownia";
import {
  Invoice, FinanceNote, InvoiceCategory, PaymentStatus,
  recomputeInvoiceMoney, isLocked, invoiceDirection,
  buildFakturowniaPayload, noteSignedPLN,
} from "./invoicing";
import { localTodayISO } from "./dates";

const COMPANY = { name: "MARIANNA", nip: "PL525-284-27-87" };

// ── shared atoms (match app style) ──
function Card({ children, style }: any) { return <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "16px 18px", ...style }}>{children}</div>; }
function SectionTitle({ children, right }: any) { return <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}><div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em" }}>{children}</div>{right}</div>; }
function Lbl({ children }: any) { return <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>{children}</label>; }
function Inp({ value, onChange, type, placeholder, disabled, style }: any) { return <input value={value ?? ""} onChange={onChange} type={type || "text"} placeholder={placeholder} disabled={disabled} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: disabled ? "#999" : "#111", outline: "none", fontFamily: "inherit", background: disabled ? "#F9FAFB" : "#fff", ...style }} />; }
function Sel({ value, onChange, children, disabled, style }: any) { return <select value={value ?? ""} onChange={onChange} disabled={disabled} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: disabled ? "#F9FAFB" : "#fff", ...style }}>{children}</select>; }

const CATEGORY_META: Record<InvoiceCategory, { label: string; color: string; bg: string }> = {
  SINV: { label: "Sales", color: "#16A34A", bg: "#DCFCE7" },
  PURCHASE: { label: "Purchase", color: "#DC2626", bg: "#FEE2E2" },
  FORWARDER: { label: "Forwarder", color: "#DC2626", bg: "#FEE2E2" },
  BROKER: { label: "Broker/Customs", color: "#DC2626", bg: "#FEE2E2" },
  WAREHOUSE: { label: "Warehouse", color: "#DC2626", bg: "#FEE2E2" },
  TRANSPORT: { label: "Transport", color: "#DC2626", bg: "#FEE2E2" },
  OTHER: { label: "Other cost", color: "#DC2626", bg: "#FEE2E2" },
};
const STATUS_META: Record<PaymentStatus, { bg: string; color: string }> = {
  Draft: { bg: "#F3F4F6", color: "#6B7280" }, Issued: { bg: "#DBEAFE", color: "#2563EB" },
  Sent: { bg: "#E0F2FE", color: "#0284C7" }, "Partially paid": { bg: "#FEF3C7", color: "#D97706" },
  Paid: { bg: "#DCFCE7", color: "#16A34A" }, Overdue: { bg: "#FEE2E2", color: "#DC2626" },
  Cancelled: { bg: "#F3F4F6", color: "#9CA3AF" },
};
function money(n: number, cur?: string) { if (n == null || isNaN(n)) return "—"; return `${Number(n).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? " " + cur : ""}`; }
function daysUntil(d: string) { if (!d) return null; const t = new Date(localTodayISO()); const x = new Date(d); return Math.floor((x.getTime() - t.getTime()) / 86400000); }

function CatBadge({ cat }: { cat: InvoiceCategory }) { const m = CATEGORY_META[cat]; return <span style={{ background: m.bg, color: m.color, padding: "2px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, fontFamily: "ui-monospace, Menlo, monospace" }}>{cat}</span>; }
function StatusBadge({ s }: { s: PaymentStatus }) { const m = STATUS_META[s] || STATUS_META.Draft; return <span style={{ background: m.bg, color: m.color, padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{s}</span>; }
function DirPill({ inv }: { inv: Invoice }) { const r = invoiceDirection(inv) === "receivable"; return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: r ? "#16A34A" : "#DC2626", fontWeight: 600 }}><span style={{ fontSize: 13 }}>{r ? "↑" : "↓"}</span>{r ? "Receivable" : "Payable"}</span>; }

// ════════════════════════════════════════════════════════════════════════════
export default function Invoices(props: any) {
  const { invoices = [], setInvoices, notes = [], setNotes, contacts = [], orders = [], pos = [], shipments = [], lots = [] } = props;
  const [view, setView] = useState<"list" | "form" | "detail" | "note">("list");
  const [selId, setSelId] = useState<number | null>(null);
  const [form, setForm] = useState<any>(null);
  const [noteForm, setNoteForm] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [fDir, setFDir] = useState<"All" | "receivable" | "payable">("All");
  const [fStatus, setFStatus] = useState<string>("All");
  const [pushState, setPushState] = useState<{ id: number; msg: string; tone: string } | null>(null);

  const selected: Invoice | null = useMemo(() => invoices.find((i: Invoice) => i.id === selId) || null, [invoices, selId]);

  // KPIs (PLN, net of paid)
  const recvOpen = invoices.filter((i: Invoice) => invoiceDirection(i) === "receivable" && i.paymentStatus !== "Paid" && i.paymentStatus !== "Cancelled").reduce((s: number, i: Invoice) => s + (i.grossPLN - i.paidAmount * (i.fxRate || 1)), 0);
  const payOpen = invoices.filter((i: Invoice) => invoiceDirection(i) === "payable" && i.paymentStatus !== "Paid" && i.paymentStatus !== "Cancelled").reduce((s: number, i: Invoice) => s + (i.grossPLN - i.paidAmount * (i.fxRate || 1)), 0);
  const overdue = invoices.filter((i: Invoice) => { if (i.paymentStatus === "Paid" || i.paymentStatus === "Cancelled") return false; const d = daysUntil(i.dueDate); return d !== null && d < 0; }).length;

  const filtered = invoices.filter((i: Invoice) =>
    (!search || i.number.toLowerCase().includes(search.toLowerCase()) || (i.counterparty?.name || "").toLowerCase().includes(search.toLowerCase()) || i.links.some(l => l.number.toLowerCase().includes(search.toLowerCase()))) &&
    (fDir === "All" || invoiceDirection(i) === fDir) &&
    (fStatus === "All" || i.paymentStatus === fStatus)
  ).sort((a: Invoice, b: Invoice) => String(b.issueDate || "").localeCompare(String(a.issueDate || "")));

  // #7: credit/debit notes also belong in the main view (not only hidden on their
  // invoice). Same search / direction / status filters; a credit reduces the
  // receivable/payable, a debit increases it.
  const invoiceById = useMemo(() => new Map((invoices as Invoice[]).map((i: Invoice) => [i.id, i])), [invoices]);
  const noteDir = (nt: any) => (nt.direction === "incoming" ? "payable" : "receivable");
  const filteredNotes = (notes || []).filter((nt: any) =>
    (!search || String(nt.number || "").toLowerCase().includes(search.toLowerCase()) || String(nt.partyName || "").toLowerCase().includes(search.toLowerCase()) || String(nt.relatedRef || "").toLowerCase().includes(search.toLowerCase())) &&
    (fDir === "All" || noteDir(nt) === fDir) &&
    (fStatus === "All" || nt.status === fStatus)
  ).sort((a: any, b: any) => String(b.date || "").localeCompare(String(a.date || "")));

  // ── handlers ──
  function newInvoice(kind: "SALES" | "COST") {
    setForm(recomputeInvoiceMoney({
      id: undefined, kind, category: kind === "SALES" ? "SINV" : "PURCHASE",
      costScope: kind === "COST" ? "SHIPMENT" : undefined,
      number: "", counterparty: null, issueDate: localTodayISO(), saleDate: localTodayISO(), dueDate: "",
      paymentMethod: "Transfer", currency: "PLN", fxRate: 1, netAmount: 0, vatRate: kind === "SALES" ? 5 : 23,
      vatAmount: 0, grossAmount: 0, netPLN: 0, grossPLN: 0, positions: [], links: [],
      paymentStatus: "Draft", paidAmount: 0, notes: "", attachment: null, creditNoteIds: [],
      allocation: null, fakturownia: { exported: false }, source: "", createdAt: localTodayISO(),
    }));
    setView("form");
  }
  function editInvoice(inv: Invoice) {
    if (isLocked(inv)) { window.alert("This invoice has been sent / exported and is locked. To change it, issue a credit or debit note."); return; }
    setForm({ ...inv }); setView("form");
  }
  function saveForm() {
    const rec = recomputeInvoiceMoney(form) as Invoice;
    if (!rec.number && rec.kind === "COST") { window.alert("Enter the supplier's invoice number."); return; }
    if (!rec.counterparty) { window.alert("Select the counterparty."); return; }
    // P1-4: guard against entering the same invoice twice (same kind + number +
    // counterparty). A warning, not a hard block — occasionally a number legitimately
    // repeats across counterparties, but same-counterparty + same-number is almost
    // always a double entry.
    const numNorm = String(rec.number || "").trim().toLowerCase();
    if (numNorm) {
      const dupe = (invoices || []).find((p: Invoice) =>
        p.id !== rec.id && p.kind === rec.kind && p.paymentStatus !== "Cancelled" &&
        String(p.number || "").trim().toLowerCase() === numNorm &&
        String(p.counterparty?.name || "").trim().toLowerCase() === String(rec.counterparty?.name || "").trim().toLowerCase());
      if (dupe && !window.confirm(`A ${rec.kind === "SALES" ? "sales" : "cost"} invoice "${rec.number}" from ${rec.counterparty?.name || "this counterparty"} already exists. This looks like a duplicate — save anyway?`)) return;
    }
    setInvoices((prev: Invoice[]) => {
      const exists = prev.find(p => p.id === rec.id);
      if (exists) return prev.map(p => p.id === rec.id ? { ...(rec as Invoice) } : p);
      return [...prev, { ...(rec as Invoice), id: nextId(), source: rec.source || `manual:${Date.now()}` }];
    });
    setView("list"); setForm(null);
  }
  function markStatus(inv: Invoice, status: PaymentStatus) {
    setInvoices((prev: Invoice[]) => prev.map(p => p.id === inv.id ? { ...p, paymentStatus: status, locked: status === "Sent" ? true : p.locked } : p));
  }
  function recordPayment(inv: Invoice) {
    const remaining = inv.grossAmount - inv.paidAmount;
    const amtStr = window.prompt(`Record payment for ${inv.number} (${inv.currency}). Remaining ${money(remaining, inv.currency)}:`, remaining.toFixed(2));
    if (amtStr == null) return;
    const amt = parseFloat(amtStr) || 0;
    setInvoices((prev: Invoice[]) => prev.map(p => {
      if (p.id !== inv.id) return p;
      const paid = (p.paidAmount || 0) + amt;
      const status: PaymentStatus = paid >= p.grossAmount - 0.01 ? "Paid" : paid > 0 ? "Partially paid" : p.paymentStatus;
      return { ...p, paidAmount: paid, paymentStatus: status };
    }));
  }
  async function sendToFakturownia(inv: Invoice) {
    if (inv.kind !== "SALES") { window.alert("Only sales invoices are pushed to Fakturownia."); return; }
    const cfg = readFakturowniaConfig();
    if (!cfg) { window.alert("Fakturownia is not configured. Add the account name and API token in Settings first."); return; }
    // v6.18.4 (P0-1): live invoice creation is OFF by default. Until there's a
    // backend with a server-side token, roles and an audit trail, pushing a real
    // invoice from the browser is a legal/accounting action we don't enable silently.
    if (!cfg.liveWriteEnabled) {
      window.alert("Live invoice creation in Fakturownia is turned OFF (the safe default).\n\nUse “Copy payload” to create this invoice manually in Fakturownia, or enable live write in Settings → Fakturownia for a controlled, authorised test.");
      return;
    }
    if (!window.confirm(`Send ${inv.number || "this invoice"} to Fakturownia?\n\nThis creates a REAL invoice there (Fakturownia assigns the legal number) and locks it here — further changes will need a credit/debit note.`)) return;
    setPushState({ id: inv.id, msg: "Sending to Fakturownia…", tone: "#2563EB" });
    const payload = buildFakturowniaPayload(inv, { apiToken: cfg.apiToken, sellerName: COMPANY.name, sellerTaxNo: COMPANY.nip, govSaveAndSend: false });
    const res = await createInvoice(cfg, payload);
    if (res.ok) {
      const legal = res.data?.number || inv.number;
      const fid = res.data?.id;
      setInvoices((prev: Invoice[]) => prev.map(p => p.id === inv.id ? { ...p, paymentStatus: "Sent", locked: true, number: legal || p.number, fakturownia: { exported: true, ref: fid, legalNumber: legal } } : p));
      setPushState({ id: inv.id, msg: `✓ Created in Fakturownia${legal ? ` as ${legal}` : ""}.`, tone: "#16A34A" });
    } else if (res.corsLikely) {
      setPushState({ id: inv.id, msg: "Browser blocked the direct call (CORS). Use the copy-payload fallback, or this needs the backend.", tone: "#D97706" });
    } else {
      setPushState({ id: inv.id, msg: `Failed: ${res.error || "unknown error"}`, tone: "#DC2626" });
    }
  }
  function copyPayload(inv: Invoice) {
    const cfg = readFakturowniaConfig();
    const payload = buildFakturowniaPayload(inv, { apiToken: cfg?.apiToken || "API_TOKEN", sellerName: COMPANY.name, sellerTaxNo: COMPANY.nip, govSaveAndSend: false });
    const text = JSON.stringify(payload, null, 2);
    try { navigator.clipboard?.writeText(text); setPushState({ id: inv.id, msg: "Payload copied to clipboard.", tone: "#2563EB" }); }
    catch { window.prompt("Copy this payload:", text); }
  }

  // ── credit/debit note ──
  function newNote(againstInvoice?: Invoice) {
    setNoteForm({
      id: undefined, noteType: "CREDIT", direction: againstInvoice ? (againstInvoice.kind === "SALES" ? "outgoing" : "incoming") : "outgoing",
      invoiceId: againstInvoice?.id ?? null, relatedRef: againstInvoice?.links?.[0]?.number || "",
      partyName: againstInvoice?.counterparty?.name || "", category: "Quality complaint",
      amount: "", currency: againstInvoice?.currency || "PLN", fxRate: againstInvoice?.fxRate || 1, status: "Draft", reason: "", date: localTodayISO(),
    });
    setView("note");
  }
  function saveNote() {
    const f = noteForm;
    if (!(parseFloat(f.amount) > 0)) { window.alert("Enter an amount greater than zero."); return; }
    if (!String(f.partyName || "").trim()) { window.alert("Enter the counterparty."); return; }
    const fx = resolveFxRate(f.fxRate, f.currency);
    const rec: FinanceNote = { ...f, id: f.id ?? nextId(), amount: parseFloat(f.amount) || 0, fxRate: fx, amountPLN: Math.round((parseFloat(f.amount) || 0) * fx * 100) / 100 };
    setNotes((prev: FinanceNote[]) => { const ex = (prev || []).find(p => p.id === rec.id); return ex ? prev.map(p => p.id === rec.id ? rec : p) : [...(prev || []), rec]; });
    if (rec.invoiceId != null) setInvoices((prev: Invoice[]) => prev.map(p => p.id === rec.invoiceId ? { ...p, creditNoteIds: Array.from(new Set([...(p.creditNoteIds || []), rec.id])) } : p));
    setView(selected ? "detail" : "list"); setNoteForm(null);
  }

  // ════════════════ ROUTES ════════════════
  if (view === "form" && form) return <InvoiceForm form={form} setForm={setForm} onSave={saveForm} onCancel={() => { setView("list"); setForm(null); }} contacts={contacts} orders={orders} pos={pos} shipments={shipments} lots={lots} />;
  if (view === "note" && noteForm) return <NoteForm form={noteForm} setForm={setNoteForm} onSave={saveNote} onCancel={() => { setView(selected ? "detail" : "list"); setNoteForm(null); }} contacts={contacts} invoices={invoices} orders={orders} pos={pos} shipments={shipments} />;
  if (view === "detail" && selected) return (
    <InvoiceDetail
      inv={selected} notes={notes}
      onBack={() => { setView("list"); setSelId(null); }}
      onEdit={() => editInvoice(selected)}
      onPayment={() => recordPayment(selected)}
      onMarkStatus={(s: PaymentStatus) => markStatus(selected, s)}
      onSend={() => sendToFakturownia(selected)}
      onCopyPayload={() => copyPayload(selected)}
      onNote={() => newNote(selected)}
      pushState={pushState && pushState.id === selected.id ? pushState : null}
    />
  );

  // ════════════════ LIST ════════════════
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#FAFAFA" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", flexShrink: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Invoices</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={() => newInvoice("SALES")} style={{ padding: "6px 12px", borderRadius: 7, border: "none", background: "#16A34A", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>+ Sales invoice</button>
          <button onClick={() => newInvoice("COST")} style={{ padding: "6px 12px", borderRadius: 7, border: "none", background: "#DC2626", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>+ Cost invoice</button>
          <button onClick={() => newNote()} style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#7C3AED" }}>+ Credit/Debit note</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
          {[
            { l: "RECEIVABLE · OPEN", v: money(recvOpen, "PLN"), c: "#16A34A" },
            { l: "PAYABLE · OPEN", v: money(payOpen, "PLN"), c: "#DC2626" },
            { l: "NET POSITION", v: money(recvOpen - payOpen, "PLN"), c: recvOpen - payOpen >= 0 ? "#16A34A" : "#DC2626" },
            { l: "OVERDUE", v: String(overdue), c: overdue > 0 ? "#DC2626" : "#111" },
          ].map((k, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ fontSize: 10, color: "#888", fontWeight: 700, letterSpacing: "0.04em" }}>{k.l}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: k.c, marginTop: 3 }}>{k.v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search number, counterparty, linked SO/PO/shipment…" style={{ flex: "1 1 260px", minWidth: 240, border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 14px", fontSize: 13, outline: "none", background: "#fff" }} />
          <div style={{ display: "flex", gap: 4 }}>
            {(["All", "receivable", "payable"] as const).map(d => <button key={d} onClick={() => setFDir(d)} style={{ padding: "6px 12px", borderRadius: 20, border: "1px solid", borderColor: fDir === d ? "#111" : "#E5E7EB", background: fDir === d ? "#111" : "#fff", color: fDir === d ? "#fff" : "#555", fontSize: 12, cursor: "pointer", textTransform: "capitalize" }}>{d}</button>)}
          </div>
          <Sel value={fStatus} onChange={(e: any) => setFStatus(e.target.value)} style={{ width: 150 }}>
            {["All", ...Object.keys(STATUS_META)].map(s => <option key={s}>{s}</option>)}
          </Sel>
        </div>

        <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "64px 150px 1fr 96px 96px 130px 130px 90px", padding: "10px 16px", background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
            {["TYPE", "NUMBER", "COUNTERPARTY", "ISSUED", "DUE", "GROSS", "STATUS", "LINKED"].map((h, i) => <div key={i} style={{ fontSize: 10, fontWeight: 700, color: "#AAA", letterSpacing: "0.05em" }}>{h}</div>)}
          </div>
          {filtered.length === 0 && filteredNotes.length === 0 && <div style={{ padding: "36px", textAlign: "center", color: "#AAA", fontSize: 13 }}>No invoices yet. Create one above, or they'll appear here as Sales Orders are invoiced and cost invoices are recorded.</div>}
          {filtered.map((i: Invoice, idx: number) => {
            const d = daysUntil(i.dueDate); const od = i.paymentStatus !== "Paid" && i.paymentStatus !== "Cancelled" && d !== null && d < 0;
            return (
              <div key={i.id} onClick={() => { setSelId(i.id); setView("detail"); }} style={{ display: "grid", gridTemplateColumns: "64px 150px 1fr 96px 96px 130px 130px 90px", padding: "11px 16px", borderBottom: idx < filtered.length - 1 ? "1px solid #F3F4F6" : "none", alignItems: "center", cursor: "pointer" }} onMouseEnter={e => (e.currentTarget.style.background = "#FAFAFA")} onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                <div><CatBadge cat={i.category} /></div>
                <div><div style={{ fontSize: 12.5, fontWeight: 600, color: "#2563EB", fontFamily: "ui-monospace, Menlo, monospace" }}>{i.number || "—"}</div><DirPill inv={i} /></div>
                <div><div style={{ fontSize: 13, fontWeight: 500 }}>{i.counterparty?.name || "—"}</div>{i.counterparty?.nip && <div style={{ fontSize: 11, color: "#AAA" }}>NIP {i.counterparty.nip}</div>}</div>
                <div style={{ fontSize: 12, color: "#555" }}>{i.issueDate || "—"}</div>
                <div><div style={{ fontSize: 12, color: od ? "#DC2626" : "#555", fontWeight: od ? 600 : 400 }}>{i.dueDate || "—"}</div>{od && <div style={{ fontSize: 10, color: "#DC2626", fontWeight: 600 }}>{Math.abs(d as number)}d late</div>}</div>
                <div><div style={{ fontSize: 13, fontWeight: 600 }}>{money(i.grossAmount, i.currency)}</div>{i.currency !== "PLN" && <div style={{ fontSize: 10, color: "#AAA" }}>{money(i.grossPLN, "PLN")}</div>}</div>
                <div><StatusBadge s={i.paymentStatus} /></div>
                <div style={{ fontSize: 11, color: "#1D4ED8", fontFamily: "ui-monospace, Menlo, monospace" }}>{i.links[0]?.number || "—"}{i.links.length > 1 && <span style={{ color: "#AAA" }}> +{i.links.length - 1}</span>}{(i.creditNoteIds?.length > 0) && <span title="has credit/debit notes" style={{ color: "#7C3AED", marginLeft: 6 }}>↩</span>}</div>
              </div>
            );
          })}
          {filteredNotes.length > 0 && (
            <div style={{ padding: "8px 16px", background: "#FAFAFA", borderTop: "1px solid #EEE", fontSize: 10, fontWeight: 700, color: "#AAA", letterSpacing: "0.05em" }}>CREDIT / DEBIT NOTES</div>
          )}
          {filteredNotes.map((nt: any, idx: number) => {
            const linked = nt.invoiceId != null ? invoiceById.get(nt.invoiceId) : null;
            const isCredit = nt.noteType !== "DEBIT";
            return (
              <div key={`note-${nt.id}`} onClick={() => { if (linked) { setSelId(linked.id); setView("detail"); } else { setNoteForm({ ...nt }); setView("note"); } }} style={{ display: "grid", gridTemplateColumns: "64px 150px 1fr 96px 96px 130px 130px 90px", padding: "11px 16px", borderBottom: idx < filteredNotes.length - 1 ? "1px solid #F3F4F6" : "none", alignItems: "center", cursor: "pointer" }} onMouseEnter={e => (e.currentTarget.style.background = "#FAFAFA")} onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                <div><span style={{ background: isCredit ? "#FFF7ED" : "#EFF6FF", color: isCredit ? "#9A3412" : "#1D4ED8", padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em" }}>{isCredit ? "CREDIT" : "DEBIT"}</span></div>
                <div><div style={{ fontSize: 12.5, fontWeight: 600, color: "#9A3412", fontFamily: "ui-monospace, Menlo, monospace" }}>{nt.number || "(note)"}</div><div style={{ fontSize: 10, color: "#AAA" }}>{nt.category || nt.reason || "—"}</div></div>
                <div><div style={{ fontSize: 13, fontWeight: 500 }}>{nt.partyName || "—"}</div></div>
                <div style={{ fontSize: 12, color: "#555" }}>{nt.date || "—"}</div>
                <div style={{ fontSize: 12, color: "#AAA" }}>—</div>
                <div><div style={{ fontSize: 13, fontWeight: 600, color: isCredit ? "#9A3412" : "#1D4ED8" }}>{isCredit ? "−" : "+"}{money(nt.amount, nt.currency)}</div></div>
                <div><StatusBadge s={nt.status} /></div>
                <div style={{ fontSize: 11, color: "#1D4ED8", fontFamily: "ui-monospace, Menlo, monospace" }}>{linked ? (linked.number || "(invoice)") : "standalone"}</div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 16, fontSize: 11, color: "#AAA", textAlign: "center" }}>{filtered.length} of {invoices.length} invoices{filteredNotes.length > 0 ? ` · ${filteredNotes.length} credit/debit note${filteredNotes.length > 1 ? "s" : ""}` : ""} · Sales invoices push to Fakturownia on Send (Fakturownia assigns the legal number) · KSeF submission stays managed in Fakturownia</div>
      </div>
    </div>
  );
}

// ════════════════ DETAIL ════════════════
function InvoiceDetail({ inv, notes, onBack, onEdit, onPayment, onMarkStatus, onSend, onCopyPayload, onNote, pushState }: any) {
  const locked = isLocked(inv);
  const relatedNotes = (notes || []).filter((nt: FinanceNote) => (inv.creditNoteIds || []).includes(nt.id) || nt.invoiceId === inv.id);
  const netAdjust = relatedNotes.reduce((s: number, nt: FinanceNote) => s + noteSignedPLN(nt), 0);
  const remaining = inv.grossAmount - inv.paidAmount;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#2563EB", fontWeight: 500 }}>← Invoices</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {!locked && <button onClick={onEdit} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>✎ Edit</button>}
          {inv.paymentStatus !== "Paid" && inv.paymentStatus !== "Cancelled" && <button onClick={onPayment} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #16A34A", color: "#16A34A", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>💰 Record payment</button>}
          {inv.kind === "SALES" && inv.paymentStatus === "Issued" && <button onClick={onSend} style={{ padding: "5px 14px", borderRadius: 7, border: "none", background: "#0284C7", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>→ Send to Fakturownia</button>}
          {inv.kind === "SALES" && inv.paymentStatus === "Draft" && <button onClick={() => onMarkStatus("Issued")} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #2563EB", color: "#2563EB", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Mark Issued</button>}
          <button onClick={onNote} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#7C3AED" }}>↩ Credit/Debit note</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          {pushState && <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: pushState.tone === "#16A34A" ? "#ECFDF5" : pushState.tone === "#DC2626" ? "#FEF2F2" : pushState.tone === "#D97706" ? "#FFF7ED" : "#EFF6FF", color: pushState.tone, border: `1px solid ${pushState.tone}33` }}>{pushState.msg}{pushState.tone === "#D97706" && <button onClick={onCopyPayload} style={{ marginLeft: 10, padding: "3px 10px", borderRadius: 6, border: "1px solid #D97706", background: "#fff", color: "#D97706", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Copy payload</button>}</div>}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6 }}><CatBadge cat={inv.category} /><DirPill inv={inv} /><StatusBadge s={inv.paymentStatus} />{locked && <span style={{ fontSize: 11, color: "#0284C7", fontWeight: 600 }}>🔒 locked</span>}</div>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "ui-monospace, Menlo, monospace" }}>{inv.number || "(no number yet)"}</div>
              <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>{CATEGORY_META[inv.category].label} · {inv.counterparty?.name || "—"}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#888" }}>Gross total</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{money(inv.grossAmount, inv.currency)}</div>
              {inv.currency !== "PLN" && <div style={{ fontSize: 12, color: "#888" }}>{money(inv.grossPLN, "PLN")} · rate {inv.fxRate}</div>}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Card><SectionTitle>DATES & PAYMENT</SectionTitle>
              <Row k="Issue date" v={inv.issueDate || "—"} /><Row k="Sale date" v={inv.saleDate || "—"} /><Row k="Due date" v={inv.dueDate || "—"} /><Row k="Payment method" v={inv.paymentMethod || "—"} />
              {inv.paidAmount > 0 && <Row k="Paid so far" v={money(inv.paidAmount, inv.currency)} />}
              {inv.paymentStatus !== "Paid" && inv.paidAmount > 0 && <Row k="Remaining" v={money(remaining, inv.currency)} />}
            </Card>
            <Card><SectionTitle>AMOUNTS</SectionTitle>
              <Row k="Net" v={money(inv.netAmount, inv.currency)} /><Row k={`VAT ${inv.vatRate}%`} v={money(inv.vatAmount, inv.currency)} /><Row k="Gross" v={money(inv.grossAmount, inv.currency)} bold />
              {inv.currency !== "PLN" && <Row k="Gross (PLN)" v={money(inv.grossPLN, "PLN")} />}
              {inv.kind === "COST" && inv.costScope && <Row k="Cost scope" v={inv.costScope === "SHIPMENT" ? "Shipment-scoped" : inv.costScope === "MONTHLY_SHARED" ? "Monthly shared (allocated)" : "Overhead (not allocated)"} />}
            </Card>
          </div>

          <Card style={{ marginTop: 16 }}><SectionTitle>PARTIES</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
              <div><Lbl>Sprzedawca / Seller</Lbl><div style={{ fontSize: 13, fontWeight: 600 }}>{inv.kind === "SALES" ? COMPANY.name : inv.counterparty?.name || "—"}</div><div style={{ fontSize: 11, color: "#888" }}>NIP {inv.kind === "SALES" ? COMPANY.nip : inv.counterparty?.nip || "—"}</div></div>
              <div><Lbl>Nabywca / Buyer</Lbl><div style={{ fontSize: 13, fontWeight: 600 }}>{inv.kind === "SALES" ? inv.counterparty?.name || "—" : COMPANY.name}</div><div style={{ fontSize: 11, color: "#888" }}>NIP {inv.kind === "SALES" ? inv.counterparty?.nip || "—" : COMPANY.nip}</div></div>
            </div>
          </Card>

          {inv.links.length > 0 && <Card style={{ marginTop: 16 }}><SectionTitle>LINKED DOCUMENTS</SectionTitle><div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{inv.links.map((l: any, i: number) => <div key={i} style={{ padding: "6px 12px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 6, fontSize: 12, color: "#1D4ED8", fontWeight: 600 }}>{l.type} · {l.number}</div>)}</div></Card>}

          {relatedNotes.length > 0 && <Card style={{ marginTop: 16 }}><SectionTitle>CREDIT / DEBIT NOTES</SectionTitle>{relatedNotes.map((nt: FinanceNote, i: number) => <div key={i} style={{ padding: "10px 12px", background: nt.noteType === "DEBIT" ? "#EFF6FF" : "#FFF7ED", border: `1px solid ${nt.noteType === "DEBIT" ? "#BFDBFE" : "#FED7AA"}`, borderRadius: 8, marginBottom: 8, display: "flex", justifyContent: "space-between" }}><div><div style={{ fontSize: 12.5, fontWeight: 600 }}>{nt.noteType === "DEBIT" ? "Debit" : "Credit"} note · {nt.reason || nt.category}</div><div style={{ fontSize: 11, color: "#888" }}>{nt.date} · {nt.partyName}</div></div><div style={{ fontSize: 13, fontWeight: 700, color: nt.noteType === "DEBIT" ? "#1D4ED8" : "#9A3412" }}>{nt.noteType === "DEBIT" ? "+" : "−"}{money(nt.amount, nt.currency)}</div></div>)}<div style={{ fontSize: 11.5, color: "#666", marginTop: 4 }}>Net adjustment: {money(netAdjust, "PLN")} (applied to receivable/payable in Finance)</div></Card>}

          {inv.notes && <Card style={{ marginTop: 16 }}><SectionTitle>NOTES</SectionTitle><div style={{ fontSize: 12.5, color: "#444", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{inv.notes}</div></Card>}
        </div>
      </div>
    </div>
  );
}
function Row({ k, v, bold }: any) { return <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #F7F7F7" }}><span style={{ fontSize: 12, color: "#666" }}>{k}</span><span style={{ fontSize: 13, fontWeight: bold ? 700 : 500 }}>{v}</span></div>; }

// ════════════════ FORM ════════════════
function InvoiceForm({ form, setForm, onSave, onCancel, contacts, orders, pos, shipments, lots }: any) {
  const sf = (k: string, v: any) => setForm((f: any) => recomputeInvoiceMoney({ ...f, [k]: v }));
  const isSales = form.kind === "SALES";
  const wanted = isSales ? ["Client"] : form.category === "FORWARDER" ? ["Forwarder"] : form.category === "BROKER" ? ["Broker"] : form.category === "WAREHOUSE" ? ["Warehouse"] : form.category === "TRANSPORT" ? ["Carrier"] : ["Supplier", "Carrier", "Forwarder", "Broker", "Warehouse"];
  const partyOptions = (contacts || []).filter((c: any) => { const ts = [c.type, ...(c.additionalTypes || [])]; return ts.some((t: string) => wanted.includes(t)); });
  const docOptions = [...(orders || []).map((o: any) => ({ type: "SO", number: o.number })), ...(pos || []).map((p: any) => ({ type: "PO", number: p.number })), ...(shipments || []).map((s: any) => ({ type: "Shipment", number: s.number }))];

  function setParty(id: string) { const c = partyOptions.find((x: any) => String(x.id) === String(id)); sf("counterparty", c ? { id: c.id, name: c.name, nip: c.nip || c.vatEuId } : null); }
  function toggleLink(d: any) { const ex = (form.links || []).find((l: any) => l.number === d.number); sf("links", ex ? form.links.filter((l: any) => l.number !== d.number) : [...(form.links || []), d]); }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#2563EB", fontWeight: 500 }}>← Invoices</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <button onClick={onCancel} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          <button onClick={onSave} style={{ padding: "5px 16px", borderRadius: 7, border: "none", background: "#111", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Save invoice</button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{form.id ? `Edit ${form.number || "invoice"}` : isSales ? "New sales invoice" : "New cost invoice"}</div>
          <div style={{ fontSize: 12, color: "#AAA", marginBottom: 20 }}>{isSales ? "A receivable we issue. Push to Fakturownia on Send — it assigns the legal number." : "A payable we received. Pick its category and cost scope so allocation can handle it."}</div>

          <Card style={{ marginBottom: 16 }}><SectionTitle>INVOICE DETAILS</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
              {!isSales && <div><Lbl>Category</Lbl><Sel value={form.category} onChange={(e: any) => sf("category", e.target.value)}>{(["PURCHASE", "FORWARDER", "BROKER", "WAREHOUSE", "TRANSPORT", "OTHER"] as InvoiceCategory[]).map(c => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}</Sel></div>}
              {!isSales && <div><Lbl>Cost scope</Lbl><Sel value={form.costScope} onChange={(e: any) => sf("costScope", e.target.value)}><option value="SHIPMENT">Shipment-scoped</option><option value="MONTHLY_SHARED">Monthly shared</option><option value="OVERHEAD">Overhead</option></Sel></div>}
              <div><Lbl>Invoice number {isSales && <span style={{ color: "#BBB", fontWeight: 400 }}>(Fakturownia assigns on Send)</span>}</Lbl><Inp value={form.number} onChange={(e: any) => sf("number", e.target.value)} placeholder={isSales ? "auto / optional" : "supplier's number"} /></div>
              <div><Lbl>Issue date</Lbl><Inp type="date" value={form.issueDate} onChange={(e: any) => sf("issueDate", e.target.value)} /></div>
              <div><Lbl>Sale date</Lbl><Inp type="date" value={form.saleDate} onChange={(e: any) => sf("saleDate", e.target.value)} /></div>
              <div><Lbl>Due date</Lbl><Inp type="date" value={form.dueDate} onChange={(e: any) => sf("dueDate", e.target.value)} /></div>
              <div><Lbl>Payment method</Lbl><Sel value={form.paymentMethod} onChange={(e: any) => sf("paymentMethod", e.target.value)}>{["Transfer", "Cash", "Card", "Compensation", "Prepaid"].map(p => <option key={p}>{p}</option>)}</Sel></div>
              {form.costScope === "MONTHLY_SHARED" && <><div><Lbl>Period from</Lbl><Inp type="date" value={form.periodFrom} onChange={(e: any) => sf("periodFrom", e.target.value)} /></div><div><Lbl>Period to</Lbl><Inp type="date" value={form.periodTo} onChange={(e: any) => sf("periodTo", e.target.value)} /></div></>}
              <div style={{ gridColumn: "span 2" }}><Lbl>{isSales ? "Buyer (client)" : "Seller (counterparty)"}</Lbl><Sel value={form.counterparty?.id || ""} onChange={(e: any) => setParty(e.target.value)}><option value="">— select —</option>{partyOptions.map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.nip ? ` (NIP ${c.nip})` : ""}</option>)}</Sel></div>
            </div>
          </Card>

          <Card style={{ marginBottom: 16 }}><SectionTitle>AMOUNTS & CURRENCY</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
              <div><Lbl>Currency</Lbl><Sel value={form.currency} onChange={(e: any) => { setForm((f: any) => recomputeInvoiceMoney({ ...f, currency: e.target.value, fxRate: defaultFxRate(e.target.value) })); }}>{["PLN", "EUR", "USD"].map(c => <option key={c}>{c}</option>)}</Sel></div>
              <div><Lbl>FX rate to PLN</Lbl><Inp type="number" value={form.fxRate} onChange={(e: any) => sf("fxRate", e.target.value)} /></div>
              <div><Lbl>Net amount</Lbl><Inp type="number" value={form.netAmount} onChange={(e: any) => sf("netAmount", e.target.value)} /></div>
              <div><Lbl>VAT rate (%)</Lbl><Sel value={form.vatRate} onChange={(e: any) => sf("vatRate", e.target.value)}>{[0, 5, 8, 23].map(r => <option key={r} value={r}>{r}%</option>)}</Sel></div>
            </div>
            <div style={{ marginTop: 14, padding: 14, background: "#F9FAFB", borderRadius: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div><div style={{ fontSize: 10, color: "#888" }}>Net</div><div style={{ fontSize: 14, fontWeight: 600 }}>{money(form.netAmount, form.currency)}</div></div>
              <div><div style={{ fontSize: 10, color: "#888" }}>VAT {form.vatRate}%</div><div style={{ fontSize: 14, fontWeight: 600 }}>{money(form.vatAmount, form.currency)}</div></div>
              <div><div style={{ fontSize: 10, color: "#888" }}>Gross</div><div style={{ fontSize: 16, fontWeight: 700 }}>{money(form.grossAmount, form.currency)}</div>{form.currency !== "PLN" && <div style={{ fontSize: 10, color: "#AAA" }}>{money(form.grossPLN, "PLN")}</div>}</div>
            </div>
          </Card>

          <Card style={{ marginBottom: 16 }}><SectionTitle>LINKED DOCUMENTS</SectionTitle>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {docOptions.slice(0, 40).map((d: any) => { const on = (form.links || []).find((l: any) => l.number === d.number); return <button key={d.type + d.number} onClick={() => toggleLink(d)} style={{ padding: "6px 12px", border: `1px solid ${on ? "#2563EB" : "#E5E7EB"}`, background: on ? "#EFF6FF" : "#fff", borderRadius: 8, fontSize: 12, color: on ? "#1D4ED8" : "#555", cursor: "pointer", fontWeight: on ? 600 : 400 }}>{on && "✓ "}{d.type} {d.number}</button>; })}
              {docOptions.length === 0 && <div style={{ fontSize: 12, color: "#AAA" }}>No SOs / POs / shipments to link yet.</div>}
            </div>
          </Card>

          <Card><SectionTitle>NOTES</SectionTitle><textarea value={form.notes || ""} onChange={(e: any) => sf("notes", e.target.value)} rows={3} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", outline: "none", resize: "vertical" }} /></Card>
        </div>
      </div>
    </div>
  );
}

// ════════════════ NOTE FORM ════════════════
function NoteForm({ form, setForm, onSave, onCancel, contacts, invoices, orders, pos, shipments }: any) {
  const sf = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const wanted = form.direction === "outgoing" ? ["Client"] : ["Supplier", "Carrier", "Forwarder", "Broker", "Warehouse"];
  const partyOptions = Array.from(new Set((contacts || []).filter((c: any) => { const ts = [c.type, ...(c.additionalTypes || [])]; return ts.some((t: string) => wanted.includes(t)); }).map((c: any) => c.name).filter(Boolean))).sort();
  const invoiceOptions = (invoices || []).filter((i: Invoice) => form.direction === "outgoing" ? i.kind === "SALES" : i.kind === "COST");
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#2563EB", fontWeight: 500 }}>← Back</button>
        <div style={{ marginLeft: "auto" }}><button onClick={onSave} style={{ padding: "5px 16px", borderRadius: 7, border: "none", background: "#7C3AED", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Save note</button></div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>{form.id ? "Edit note" : "New credit / debit note"}</div>
          <Card>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div><Lbl>Note type</Lbl><Sel value={form.noteType} onChange={(e: any) => sf("noteType", e.target.value)}><option value="CREDIT">Credit note (reduces amount)</option><option value="DEBIT">Debit note (increases amount)</option></Sel></div>
              <div><Lbl>Direction</Lbl><Sel value={form.direction} onChange={(e: any) => sf("direction", e.target.value)}><option value="outgoing">Outgoing (to a client)</option><option value="incoming">Incoming (from a supplier/carrier)</option></Sel></div>
              <div style={{ gridColumn: "span 2" }}><Lbl>Against invoice (optional but recommended)</Lbl><Sel value={form.invoiceId ?? ""} onChange={(e: any) => { const id = e.target.value ? parseInt(e.target.value) : null; const inv = invoiceOptions.find((x: Invoice) => x.id === id); setForm((f: any) => ({ ...f, invoiceId: id, partyName: inv?.counterparty?.name || f.partyName, currency: inv?.currency || f.currency, relatedRef: inv?.links?.[0]?.number || f.relatedRef })); }}><option value="">— not linked —</option>{invoiceOptions.map((i: Invoice) => <option key={i.id} value={i.id}>{i.number || "(no number)"} · {i.counterparty?.name} · {money(i.grossAmount, i.currency)}</option>)}</Sel></div>
              <div><Lbl>Counterparty</Lbl><Sel value={form.partyName} onChange={(e: any) => sf("partyName", e.target.value)}><option value="">— select —</option>{partyOptions.map((nm: any) => <option key={nm}>{nm}</option>)}</Sel></div>
              <div><Lbl>Reason</Lbl><Sel value={form.category} onChange={(e: any) => sf("category", e.target.value)}>{["Quality complaint", "Short delivery", "Pricing correction", "Returned goods", "Damaged in transit", "Additional charge", "Other"].map(r => <option key={r}>{r}</option>)}</Sel></div>
              <div><Lbl>Amount</Lbl><Inp type="number" value={form.amount} onChange={(e: any) => sf("amount", e.target.value)} /></div>
              <div><Lbl>Currency{form.invoiceId != null ? " (from invoice)" : ""}</Lbl><Sel value={form.currency} disabled={form.invoiceId != null} title={form.invoiceId != null ? "Currency follows the linked invoice" : ""} onChange={(e: any) => { sf("currency", e.target.value); sf("fxRate", defaultFxRate(e.target.value)); }} style={form.invoiceId != null ? { background: "#F3F4F6", color: "#6B7280" } : undefined}>{["PLN", "EUR", "USD"].map(c => <option key={c}>{c}</option>)}</Sel></div>
              <div style={{ gridColumn: "span 2" }}><Lbl>Detail</Lbl><Inp value={form.reason} onChange={(e: any) => sf("reason", e.target.value)} placeholder="What this note covers" /></div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
