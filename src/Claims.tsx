import React, { useState, useMemo } from "react";
import { Card, Lbl, SectionTitle, SmallButton, DocRef, cancelledDocSet, useConfirm } from "./ui";
import { claimBlockReason, staleClaimWarnings } from "./cancellation.domain";
import { inspectLink } from "./docLinks.domain";
import {
  CLAIM_STATUSES, CLAIM_CAUSES, RESPONDENT_KINDS, CLAIM_DIRECTIONS, CLAIM_BASES,
  isClaimOpen, claimsSummary, incidentNet, nextClaimNumber, blankClaim,
  buildClaimFinanceNote, claimNoteMode,
  requestedFromBasis, buildClaimPostings, applyPostingsToLots, applyPostingsToOrders,
  reverseClaimPostings,
} from "./claims.domain";
import { localTodayISO } from "./dates";
import { nextId } from "./ids";

// ─── v6.48.0  CLAIMS MODULE (Phase 1: the register) ──────────────────────────
// Claims are now documents in their own right rather than rows hidden inside a
// lot. This view is the register: every claim, which way the money flows, who is
// on the other side, what was asked, what was agreed, and what is still open.
//
// Phase 1 deliberately does not add new capability (transport/temperature claims
// raised from a shipment, the concession→recovery chain, routing an accepted
// amount into the P/L). The record already carries the fields for those, so
// Phase 2 is wiring rather than another migration.

const num = (v: any) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const eur = (v: any) => `€${num(v).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const INP: any = { width: "100%", boxSizing: "border-box", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, background: "#fff", fontFamily: "inherit" };

const DIR_STYLE: any = {
  RECOVERY:   { bg: "#DCFCE7", fg: "#166534", label: "Recovery", hint: "we claim from a counterparty — reduces our cost" },
  CONCESSION: { bg: "#FEF3C7", fg: "#92400E", label: "Concession", hint: "a client claims from us — reduces our revenue" },
};
const BASIS_LABEL: any = {
  DEFECT: "Defect % — the Claim Request Form maths",
  COSTS:  "Costs caused — no cargo damaged (demurrage, re-delivery, repalletising)",
  MIXED:  "Both — cargo lost AND costs caused (the usual transport claim)",
};
const STATUS_STYLE: any = {
  Draft: "#94A3B8", Notified: "#2563EB", Submitted: "#2563EB", "Under review": "#D97706",
  Accepted: "#16A34A", "Partially accepted": "#16A34A", Rejected: "#DC2626", Settled: "#059669", Closed: "#64748B",
};

function Pill({ bg, fg, children, title }: any) {
  return <span title={title} style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 9px", fontSize: 10.5, fontWeight: 800, whiteSpace: "nowrap" }}>{children}</span>;
}

export default function Claims({ claims = [], setClaims, contacts = [], lots = [], setLots = null, orders = [], setOrders = null, pos = [], shipments = [], financeNotes = [], setFinanceNotes = null, invoices = [], claimSeed = null, onClaimSeedConsumed = null }: any) {
  // v6.54.0: "a cancelled document never happened, so there are no claims on it".
  const cancelledRefs = cancelledDocSet(shipments, orders, pos);
  // Resolve a claim subject ref to the actual document, whichever module owns it.
  // Wrapped in useCallback so the memo below has a stable, honest dependency.
  const lookupSubject = React.useCallback((s: any) => {
    const ref = String(s?.ref || "");
    return (shipments || []).find((x: any) => String(x.number) === ref)
      || (orders || []).find((x: any) => String(x.number) === ref)
      || (pos || []).find((x: any) => String(x.number) === ref) || null;
  }, [shipments, orders, pos]);
  const staleClaims = useMemo(() => staleClaimWarnings(claims, lookupSubject), [claims, lookupSubject]);
  const { confirm: uiConfirm, dialogNode } = useConfirm();
  const [selectedId, setSelectedId] = useState<any>(null);
  const [q, setQ] = useState("");
  const [dirFilter, setDirFilter] = useState("All");
  const [openOnly, setOpenOnly] = useState(false);

  const today = localTodayISO();
  const summary = useMemo(() => claimsSummary(claims, today), [claims, today]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (claims || []).filter((c: any) => {
      if (dirFilter !== "All" && c.direction !== dirFilter) return false;
      if (openOnly && !isClaimOpen(c)) return false;
      if (!needle) return true;
      const hay = [c.number, c.respondent?.name, c.cause, c.status, c.defectType,
        ...(c.subjects || []).map((s: any) => s.ref)].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(needle);
    }).sort((a: any, b: any) => String(b.number).localeCompare(String(a.number)));
  }, [claims, q, dirFilter, openOnly]);

  const selected = (claims || []).find((c: any) => String(c.id) === String(selectedId)) || null;

  const patch = (id: any, changes: any) =>
    setClaims((prev: any[]) => (prev || []).map(c => String(c.id) === String(id) ? { ...c, ...changes } : c));

  // v6.63.0 (D-13): arriving from another module with context — SO+SINV for a
  // client claim, shipment+transport invoice for a carrier claim, lot+PO+PINV
  // for a producer claim. One claim per seed; the seed is consumed immediately.
  React.useEffect(() => {
    if (!claimSeed) return;
    const c = blankClaim({
      id: nextId(),
      number: nextClaimNumber(claims, new Date(today).getFullYear() || 2026),
      date: today,
      status: "Draft",
      direction: claimSeed.direction || (String(claimSeed.respondentKind) === "Client" ? "CONCESSION" : "RECOVERY"),
      respondent: { kind: claimSeed.respondentKind || "Supplier", contactId: claimSeed.contactId ?? null, name: claimSeed.respondentName || "" },
      cause: claimSeed.cause || "Quality defect",
      subjects: claimSeed.subjects || [],
      notes: claimSeed.notes || "",
    });
    setClaims((prev: any[]) => [...(prev || []), c]);
    setSelectedId(c.id);
    if (typeof onClaimSeedConsumed === "function") onClaimSeedConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimSeed]);

  // v6.63.0 (D-13): finalisation produces the MONEY DOCUMENT, per the owner's
  // rulings — client → credit note we issue; supplier/carrier → their credit
  // note if received, otherwise a DEBIT note we issue (what we need to get).
  const finaliseNote = async (c: any) => {
    if (typeof setFinanceNotes !== "function") return;
    if (c.financeNoteId || (financeNotes || []).some((nt: any) => String(nt.source) === `claim:${c.number}`)) {
      await uiConfirm({ tone: "warn", title: "Already documented", message: `${c.number} already has its credit/debit note. Corrections go through a new note in Invoices.`, confirmLabel: "OK", cancelLabel: "Close" });
      return;
    }
    if (!(Number(c.acceptedEUR) > 0) || !(Number(c.plnPerEur) > 0)) {
      await uiConfirm({ tone: "warn", title: "No agreed amount", message: "Enter the accepted EUR amount and the PLN/EUR rate first — the note documents the money that was actually agreed.", confirmLabel: "OK", cancelLabel: "Close" });
      return;
    }
    let mode;
    if (String(c.respondent?.kind) === "Client") {
      const ok = await uiConfirm({ tone: "warn", title: `Issue credit note to ${c.respondent?.name || "the client"}?`, message: `CREDIT note (we give back) for €${c.acceptedEUR} ≈ ${(Number(c.acceptedEUR) * Number(c.plnPerEur)).toLocaleString("pl-PL")} PLN, linked to ${c.number}.`, confirmLabel: "Issue credit note" });
      if (!ok) return;
      mode = claimNoteMode(c, false);
    } else {
      const theyIssued = await uiConfirm({ tone: "warn", title: `${c.respondent?.name || "The respondent"} — did they issue a credit note?`, message: `If YES: their CREDIT note is recorded (reduces what we owe them).\nIf NO: WE issue a DEBIT note to them for €${c.acceptedEUR} — what we need to get (owner ruling).`, confirmLabel: "Yes — record their credit note", cancelLabel: "No — we issue a debit note" });
      mode = claimNoteMode(c, !!theyIssued);
    }
    const note = buildClaimFinanceNote(c, mode, { nextId, todayISO: () => today, invoices });
    setFinanceNotes((prev: any[]) => [note, ...(prev || [])]);
    patch(c.id, { financeNoteId: note.id, resolvedAt: c.resolvedAt || today, status: ["Settled", "Closed"].includes(String(c.status)) ? c.status : "Settled" });
  };

  const addClaim = () => {
    const c = blankClaim({
      id: nextId(),
      number: nextClaimNumber(claims, new Date(today).getFullYear() || 2026),
      date: today,
      status: "Draft",
    });
    setClaims((prev: any[]) => [...(prev || []), c]);
    setSelectedId(c.id);
  };

  // has this claim already landed in the P/L?
  const isPosted = (c: any) => {
    const src = `claim:${c?.number}`;
    return (lots || []).some((l: any) => (l.costs || []).some((x: any) => String(x?.source) === src))
        || (orders || []).some((o: any) => (o.claimAdjustments || []).some((a: any) => String(a?.source) === src));
  };

  const postClaim = async (c: any) => {
    const { postings, warnings } = buildClaimPostings(c, { todayISO: today });
    if (!postings.length) {
      await uiConfirm({ tone: "warn", title: "Nothing to post", message: warnings.join("\n") || "This claim has no agreed amount yet.", confirmLabel: "OK", cancelLabel: "Close" });
      return;
    }
    const lines = postings.map((p: any) => `${p.kind === "SO_REVENUE" ? "Revenue" : "Lot cost"} ${p.ref}: ${p.amountPLN.toLocaleString("pl-PL")} PLN`).join("\n");
    const ok = await uiConfirm({
      tone: "warn", title: `Post ${c.number} to the P/L?`,
      message: `${lines}\n\nThis changes the margin of the sales order(s) involved — including deals already closed, which is correct: the money really did change. It can be reversed.`,
      confirmLabel: "Post",
    });
    if (!ok) return;
    if (typeof setLots === "function") setLots((prev: any[]) => applyPostingsToLots(prev || [], postings));
    if (typeof setOrders === "function") setOrders((prev: any[]) => applyPostingsToOrders(prev || [], postings));
    patch(c.id, { status: c.status === "Settled" ? "Settled" : "Accepted", resolvedAt: c.resolvedAt || today });
  };

  const unpostClaim = async (c: any) => {
    if (!(await uiConfirm({ tone: "danger", title: `Reverse ${c.number}'s posting?`, message: "The adjustment is removed from the lots and sales orders. The claim itself stays.", confirmLabel: "Reverse" }))) return;
    const r = reverseClaimPostings(c, lots || [], orders || []);
    if (typeof setLots === "function") setLots(() => r.lots);
    if (typeof setOrders === "function") setOrders(() => r.orders);
  };

  // the chain: a concession we granted usually justifies claiming it back
  const recoverFrom = (parent: any) => {
    const c = blankClaim({
      id: nextId(),
      number: nextClaimNumber(claims, new Date(today).getFullYear() || 2026),
      direction: "RECOVERY",
      respondent: { kind: "Supplier", contactId: null, name: "" },
      cause: parent.cause, basis: parent.basis || "DEFECT",
      subjects: (parent.subjects || []).filter((s: any) => s.kind !== "SO"),
      parentClaimId: parent.id,
      date: today, status: "Draft",
      plnPerEur: parent.plnPerEur,
      notes: `Recovery against ${parent.number}`,
    });
    setClaims((prev: any[]) => [...(prev || []), c]);
    setSelectedId(c.id);
  };

  const removeClaim = async (c: any) => {
    if (!(await uiConfirm({ tone: "danger", title: `Delete ${c.number}?`, message: "The claim document is removed. Any credit note or inventory movement it produced stays where it is.", confirmLabel: "Delete" }))) return;
    setClaims((prev: any[]) => (prev || []).filter((x: any) => String(x.id) !== String(c.id)));
    setSelectedId(null);
  };

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", background: "#FAFAFA" }}>
      {dialogNode}

      <div style={{ padding: "22px 28px 12px", borderBottom: "1px solid #EBEBEB", background: "#FAFAFA" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.01em" }}>Claims</div>
          <div style={{ fontSize: 12, color: "#64748B" }}>
            {summary.total} total · {summary.open} open · recovery {eur(summary.openRecoveryEUR)} · concession {eur(summary.openConcessionEUR)}
          </div>
          <div style={{ flex: 1 }} />
          <SmallButton kind="dark" onClick={addClaim}>+ New claim</SmallButton>
        </div>

        {(summary.overdue.length > 0 || summary.noEvidence.length > 0) && (
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {summary.overdue.length > 0 && (
              <div style={{ padding: "6px 11px", borderRadius: 7, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 11.5, color: "#991B1B" }}>
                ⏱ <strong>Notice deadline passed, never notified:</strong> {summary.overdue.join(", ")}
              </div>
            )}
            {summary.noEvidence.length > 0 && (
              <div style={{ padding: "6px 11px", borderRadius: 7, background: "#FFFBEB", border: "1px solid #FDE68A", fontSize: 11.5, color: "#92400E" }}>
                📎 <strong>No evidence linked:</strong> {summary.noEvidence.join(", ")}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search number, party, lot, SO, cause…" style={{ ...INP, maxWidth: 320 }} />
          <select value={dirFilter} onChange={e => setDirFilter(e.target.value)} style={{ ...INP, maxWidth: 190 }}>
            <option value="All">Both directions</option>
            {CLAIM_DIRECTIONS.map(d => <option key={d} value={d}>{DIR_STYLE[d].label}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569", cursor: "pointer" }}>
            <input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} /> Open only
          </label>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "16px 28px 28px", display: "grid", gridTemplateColumns: selected ? "1.15fr 1fr" : "1fr", gap: 16, alignItems: "start" }}>

        {/* ── register ── */}
        <Card>
          <SectionTitle>REGISTER ({rows.length})</SectionTitle>
          {/* v6.54.0: a live claim whose subject was cancelled AFTER it was raised.
              Never auto-voided — it may already be with the counterparty — but it
              cannot sit silently, because it now rests on a movement that never
              happened. Someone withdraws the claim or un-cancels the document. */}
          {staleClaims.length > 0 && (
            <div style={{ margin: "0 0 10px", padding: "9px 11px", borderRadius: 7, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 11.5, color: "#991B1B" }}>
              <strong>{staleClaims.length} claim{staleClaims.length === 1 ? "" : "s"} rest{staleClaims.length === 1 ? "s" : ""} on a cancelled document</strong>
              <div style={{ marginTop: 4, lineHeight: 1.5 }}>
                {staleClaims.map(w => (
                  <div key={w.claimNumber}>
                    · {w.claimNumber} —{" "}
                    {claimBlockReason(w.deadRefs.map(r => ({ kind: "shipment" as const, ref: r })), (s: any) => lookupSubject(s))}
                  </div>
                ))}
              </div>
            </div>
          )}
          {!rows.length && (
            <div style={{ fontSize: 12.5, color: "#94A3B8", padding: "10px 0" }}>
              No claims match. Producer claims still start from a lot in Inventory; client claims from the sales order — both now appear here as numbered documents.
            </div>
          )}
          {rows.map((c: any) => {
            const ds = DIR_STYLE[c.direction] || DIR_STYLE.RECOVERY;
            const amount = c.acceptedEUR != null && c.acceptedEUR !== "" ? num(c.acceptedEUR) : num(c.requestedEUR);
            const agreed = c.acceptedEUR != null && c.acceptedEUR !== "";
            return (
              <div key={c.id} onClick={() => setSelectedId(c.id)}
                style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 10, alignItems: "center", padding: "9px 6px", borderBottom: "1px solid #F1F5F9", cursor: "pointer", background: String(c.id) === String(selectedId) ? "#F8FAFC" : "transparent" }}>
                <Pill bg={ds.bg} fg={ds.fg} title={ds.hint}>{ds.label}</Pill>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                    {c.number} <span style={{ fontWeight: 400, color: "#64748B" }}>· {c.respondent?.name || c.respondent?.kind || "—"}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#94A3B8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {[c.cause, (c.subjects || []).map((s: any) => s.ref).join(" · "), c.date].filter(Boolean).join(" — ")}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {eur(amount)}
                  <div style={{ fontSize: 9.5, fontWeight: 500, color: agreed ? "#059669" : "#94A3B8" }}>{agreed ? "agreed" : "requested"}</div>
                </div>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: STATUS_STYLE[c.status] || "#64748B", whiteSpace: "nowrap", minWidth: 92, textAlign: "right" }}>{c.status}</div>
              </div>
            );
          })}
        </Card>

        {/* ── detail ── */}
        {selected && (() => {
          const ds = DIR_STYLE[selected.direction] || DIR_STYLE.RECOVERY;
          const net = selected.parentClaimId ? incidentNet(claims, selected.parentClaimId) : incidentNet(claims, selected.id);
          const family = net.members.length > 1 ? net : null;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Card>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{selected.number}</div>
                  <Pill bg={ds.bg} fg={ds.fg} title={ds.hint}>{ds.label}</Pill>
                  <div style={{ flex: 1 }} />
                  {selected.direction === "CONCESSION" && (
                    <SmallButton kind="green" onClick={() => recoverFrom(selected)} title="Create a linked claim against the party responsible">+ Recover from supplier / carrier</SmallButton>
                  )}
                  <SmallButton kind="red" onClick={() => removeClaim(selected)}>Delete</SmallButton>
                  <SmallButton onClick={() => setSelectedId(null)}>Close</SmallButton>
                </div>
                <div style={{ fontSize: 11.5, color: "#64748B", marginBottom: 12, lineHeight: 1.5 }}>{ds.hint}</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <Lbl>Direction</Lbl>
                    <select value={selected.direction} onChange={e => patch(selected.id, { direction: e.target.value })} style={INP}>
                      {CLAIM_DIRECTIONS.map(d => <option key={d} value={d}>{DIR_STYLE[d].label} — {DIR_STYLE[d].hint}</option>)}
                    </select>
                  </div>
                  <div>
                    <Lbl>Status</Lbl>
                    <select value={selected.status} onChange={e => patch(selected.id, { status: e.target.value })} style={INP}>
                      {CLAIM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <Lbl>Respondent — who is on the other side</Lbl>
                    <select value={selected.respondent?.kind || "Supplier"} onChange={e => patch(selected.id, { respondent: { ...(selected.respondent || {}), kind: e.target.value } })} style={INP}>
                      {RESPONDENT_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </div>
                  <div>
                    <Lbl>Name</Lbl>
                    <input value={selected.respondent?.name || ""} onChange={e => patch(selected.id, { respondent: { ...(selected.respondent || {}), name: e.target.value } })} placeholder="e.g. Konkret" style={INP} />
                  </div>
                  <div>
                    <Lbl>Cause</Lbl>
                    <select value={selected.cause} onChange={e => patch(selected.id, { cause: e.target.value })} style={INP}>
                      {CLAIM_CAUSES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div><Lbl>Claim date</Lbl><input type="date" value={selected.date || ""} onChange={e => patch(selected.id, { date: e.target.value })} style={INP} /></div>
                  <div><Lbl>Notified on</Lbl><input type="date" value={selected.notifiedAt || ""} onChange={e => patch(selected.id, { notifiedAt: e.target.value })} style={INP} /></div>
                  <div>
                    <Lbl>Notice deadline{selected.noticeDeadline && !selected.notifiedAt && selected.noticeDeadline < today ? <span style={{ color: "#DC2626", fontWeight: 700 }}> · passed</span> : null}</Lbl>
                    <input type="date" value={selected.noticeDeadline || ""} onChange={e => patch(selected.id, { noticeDeadline: e.target.value })} style={INP} />
                  </div>
                  <div><Lbl>Requested (EUR)</Lbl><input type="number" value={selected.requestedEUR ?? ""} onChange={e => patch(selected.id, { requestedEUR: e.target.value })} style={INP} /></div>
                  <div>
                    <Lbl>Agreed after negotiation (EUR)</Lbl>
                    <input type="number" value={selected.acceptedEUR ?? ""} onChange={e => patch(selected.id, { acceptedEUR: e.target.value === "" ? null : e.target.value })} placeholder="blank until agreed" style={INP} />
                  </div>
                </div>

                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed #E5E7EB" }}>
                  <Lbl>How this claim is built</Lbl>
                  <select value={selected.basis || "DEFECT"} onChange={e => patch(selected.id, { basis: e.target.value })} style={INP}>
                    {CLAIM_BASES.map((b: any) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
                  </select>
                  {(selected.basis === "COSTS" || selected.basis === "MIXED") && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div><Lbl>Cargo lost (kg)</Lbl><input type="number" value={selected.lostKg ?? ""} onChange={e => patch(selected.id, { lostKg: e.target.value })} style={INP} /></div>
                        <div><Lbl>Value of the lost cargo (EUR)</Lbl><input type="number" value={selected.lostValueEUR ?? ""} onChange={e => patch(selected.id, { lostValueEUR: e.target.value })} style={INP} /></div>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <Lbl>Costs this party caused</Lbl>
                        {(selected.causedCosts || []).map((cc: any, i: number) => (
                          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 130px auto", gap: 8, marginBottom: 5 }}>
                            <input value={cc.label || ""} onChange={e => patch(selected.id, { causedCosts: (selected.causedCosts || []).map((x: any, xi: number) => xi === i ? { ...x, label: e.target.value } : x) })} placeholder="Repalletising / demurrage / re-delivery" style={{ ...INP, padding: "6px 8px" }} />
                            <input type="number" value={cc.amountEUR ?? ""} onChange={e => patch(selected.id, { causedCosts: (selected.causedCosts || []).map((x: any, xi: number) => xi === i ? { ...x, amountEUR: e.target.value } : x) })} placeholder="EUR" style={{ ...INP, padding: "6px 8px" }} />
                            <SmallButton kind="red" onClick={() => patch(selected.id, { causedCosts: (selected.causedCosts || []).filter((_: any, xi: number) => xi !== i) })}>✕</SmallButton>
                          </div>
                        ))}
                        <SmallButton onClick={() => patch(selected.id, { causedCosts: [...(selected.causedCosts || []), { label: "", amountEUR: "" }] })}>+ Cost</SmallButton>
                      </div>
                      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontSize: 11.5, color: "#475569" }}>Computed from this basis: <strong>{eur(requestedFromBasis(selected))}</strong></div>
                        <SmallButton onClick={() => patch(selected.id, { requestedEUR: requestedFromBasis(selected) })}>Use as requested</SmallButton>
                      </div>
                    </div>
                  )}
                  <div style={{ marginTop: 10 }}>
                    <Lbl>EUR → PLN rate used when posting</Lbl>
                    <input type="number" value={selected.plnPerEur ?? ""} onChange={e => patch(selected.id, { plnPerEur: e.target.value })} placeholder="e.g. 4.30" style={{ ...INP, maxWidth: 180 }} />
                  </div>
                </div>

                {/* ── posting the agreed amount into the P/L ── */}
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed #E5E7EB" }}>
                  {(() => {
                    const { postings, warnings } = buildClaimPostings(selected, { todayISO: today });
                    const posted = isPosted(selected);
                    return <>
                      <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.5, marginBottom: 8 }}>
                        {selected.direction === "CONCESSION"
                          ? "Posting reduces this sales order's revenue by the agreed amount."
                          : "Posting reduces the affected lots' cost by the agreed amount, which flows through COGS into the sales order's margin."}
                        {" "}It is a dated, source-tagged adjustment — the original figures are never rewritten, and it can be reversed.
                      </div>
                      {postings.length > 0 && (
                        <div style={{ background: "#F8FAFC", border: "1px solid #E5E7EB", borderRadius: 7, padding: "7px 10px", fontSize: 11.5, marginBottom: 8 }}>
                          {postings.map((p: any, i: number) => (
                            <div key={i}>{p.kind === "SO_REVENUE" ? "Revenue" : "Lot cost"} <strong>{p.ref}</strong> {p.amountPLN.toLocaleString("pl-PL")} PLN</div>
                          ))}
                        </div>
                      )}
                      {warnings.map((w: string, i: number) => (
                        <div key={i} style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 7, padding: "6px 10px", fontSize: 11.5, color: "#92400E", marginBottom: 6 }}>{w}</div>
                      ))}
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <SmallButton kind="dark" onClick={() => postClaim(selected)}>{posted ? "Re-post agreed amount" : "Post agreed amount to P/L"}</SmallButton>
                        <SmallButton kind="green" onClick={() => finaliseNote(selected)} title="Client → credit note we issue. Supplier/carrier → their credit note, or a debit note we issue if they don't send one.">{selected.financeNoteId ? "Money document ✓" : "Create credit/debit note"}</SmallButton>
                        {posted && <SmallButton kind="red" onClick={() => unpostClaim(selected)}>Reverse posting</SmallButton>}
                        {posted && <span style={{ fontSize: 11, color: "#059669", fontWeight: 700 }}>✓ posted</span>}
                      </div>
                    </>;
                  })()}
                </div>

                {selected.acceptedEUR != null && selected.acceptedEUR !== "" && num(selected.acceptedEUR) !== num(selected.requestedEUR) && (
                  <div style={{ marginTop: 10, padding: "7px 11px", borderRadius: 7, background: "#F0F9FF", border: "1px solid #BAE6FD", fontSize: 11.5, color: "#0C4A6E" }}>
                    Agreed {eur(selected.acceptedEUR)} against {eur(selected.requestedEUR)} requested — a difference of {eur(num(selected.requestedEUR) - num(selected.acceptedEUR))}.
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  <Lbl>Notes</Lbl>
                  <textarea value={selected.notes || ""} onChange={e => patch(selected.id, { notes: e.target.value })} rows={3} style={{ ...INP, resize: "vertical" }} />
                </div>
              </Card>

              <Card>
                <SectionTitle>WHAT IT COVERS</SectionTitle>
                {!(selected.subjects || []).length && <div style={{ fontSize: 12, color: "#94A3B8" }}>Nothing linked yet.</div>}
                {(selected.subjects || []).map((s: any, i: number) => {
                  // v6.54.0: a subject cancelled AFTER the claim was raised. The
                  // claim is not voided automatically — it may already be with the
                  // counterparty — but it must not look sound while resting on a
                  // movement that never happened.
                  const dead = cancelledRefs.has(String(s.ref));
                  return (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: "1px solid #F1F5F9", fontSize: 12 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: "#64748B", minWidth: 66 }}>{s.kind}</span>
                      <DocRef num={s.ref} cancelledSet={cancelledRefs} />
                      {s.affectedKg ? <span style={{ color: "#64748B" }}>· {num(s.affectedKg).toLocaleString("pl-PL")} kg affected</span> : null}
                      {dead && <span style={{ fontSize: 10, fontWeight: 700, color: "#B91C1C", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 4, padding: "1px 6px" }}
                        title="This document was cancelled after the claim was raised. A cancelled document never happened — withdraw the claim, or un-cancel the document.">cancelled — resolve</span>}
                    </div>
                  );
                })}
                <div style={{ marginTop: 8, fontSize: 10.5, color: "#94A3B8", lineHeight: 1.5 }}>
                  A claim can cover several lots — one reefer failure damages a whole container, not one pallet. Phase 2 adds raising a claim straight from a shipment.
                </div>
              </Card>

              <Card>
                <SectionTitle>EVIDENCE</SectionTitle>
                {!(selected.evidence || []).length && (
                  <div style={{ fontSize: 12, color: "#94A3B8" }}>No evidence linked. A claim lives or dies on the survey report, the temperature log, the CMR remarks and the signed loading protocol.</div>
                )}
                {(selected.evidence || []).map((e: any, i: number) => {
                  const info = inspectLink(e.link);
                  return (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: 8, alignItems: "center", padding: "5px 0", borderBottom: "1px solid #F1F5F9" }}>
                      <input value={e.kind || ""} onChange={ev => patch(selected.id, { evidence: (selected.evidence || []).map((x: any, xi: number) => xi === i ? { ...x, kind: ev.target.value } : x) })} placeholder="CMR / Temperature log" style={{ ...INP, padding: "5px 7px", fontSize: 12 }} />
                      <input value={e.link || ""} onChange={ev => patch(selected.id, { evidence: (selected.evidence || []).map((x: any, xi: number) => xi === i ? { ...x, link: ev.target.value } : x) })} placeholder="https://www.dropbox.com/…" style={{ ...INP, padding: "5px 7px", fontSize: 12, ...(e.link && !info.ok ? { borderColor: "#FCA5A5", background: "#FEF2F2" } : {}) }} />
                      <div style={{ fontSize: 11, minWidth: 74 }}>
                        {e.link ? (info.ok ? <a href={e.link} target="_blank" rel="noreferrer" style={{ color: "#2563EB", fontWeight: 700, textDecoration: "none" }}>📎 {info.label} ↗</a> : <span style={{ color: "#DC2626", fontWeight: 700 }}>⚠ bad</span>) : <span style={{ color: "#CBD5E1" }}>—</span>}
                      </div>
                      <SmallButton kind="red" onClick={() => patch(selected.id, { evidence: (selected.evidence || []).filter((_: any, xi: number) => xi !== i) })}>✕</SmallButton>
                    </div>
                  );
                })}
                <div style={{ marginTop: 8 }}>
                  <SmallButton onClick={() => patch(selected.id, { evidence: [...(selected.evidence || []), { kind: "", ref: "", link: "" }] })}>+ Evidence</SmallButton>
                </div>
              </Card>

              {family && (
                <Card>
                  <SectionTitle>INCIDENT — CONCEDED VS RECOVERED</SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, textAlign: "center" }}>
                    <div><div style={{ fontSize: 10.5, color: "#92400E", fontWeight: 700 }}>CONCEDED</div><div style={{ fontSize: 15, fontWeight: 800 }}>{eur(family.conceded)}</div></div>
                    <div><div style={{ fontSize: 10.5, color: "#166534", fontWeight: 700 }}>RECOVERED</div><div style={{ fontSize: 15, fontWeight: 800 }}>{eur(family.recovered)}</div></div>
                    <div><div style={{ fontSize: 10.5, color: "#64748B", fontWeight: 700 }}>NET</div><div style={{ fontSize: 15, fontWeight: 800, color: family.net > 0 ? "#DC2626" : "#059669" }}>{eur(family.net)}</div></div>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 10.5, color: "#94A3B8", lineHeight: 1.5 }}>
                    The gap is a commercial decision, not an error — sometimes you concede more to a client than you recover, to keep the relationship.
                  </div>
                </Card>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
