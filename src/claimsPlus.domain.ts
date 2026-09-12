// ─────────────────────────────────────────────────────────────────────────────
// claimsPlus.domain.ts — v6.97.0: CLAIMS BATCH (CL-1…CL-9, owner 10 Sept 2026)
//   CL-4 as RULED: the agreement's QC-report deadline WARNS, never blocks — periods change,
//   parties agree extensions; an agreed extension recorded on the claim silences the warning.
// Pure. Builds on claims.domain / claimReadiness / claimCostChain / payments.domain.
// ─────────────────────────────────────────────────────────────────────────────
import { claimMoney } from "./claims.domain";
import { applyPaymentEvent, outstandingAmount } from "./payments.domain";
import { NOTICE_DEFAULTS, addDays } from "./claimReadiness.domain";

const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

// ── CL-2: the defect comes from the Inspection the claim references ───────────
export function defectFromInspection(claim: any, inspections: any[]): { defectType: string; defectPct: number; description: string; inspection: any | null } {
  const ins = (inspections || []).find(x => String(x.id) === String(claim?.inspectionId)) || null;
  if (!ins) return { defectType: S(claim?.defectType), defectPct: num(claim?.defectPct), description: S(claim?.defectNotes), inspection: null };
  const names = (ins.defects || []).map((d: any) => `${d.name} ${num(d.pct)}%`).join(", ");
  const total = r2((ins.defects || []).reduce((s: number, d: any) => s + num(d.pct), 0));
  return { defectType: names, defectPct: total, description: S(ins.observations), inspection: ins };
}
/** Inspections that could be the claim's evidence: those on the claim's lots / PO. */
export function inspectionCandidates(claim: any, inspections: any[]): any[] {
  const lots = new Set((claim?.subjects || []).filter((s: any) => String(s.kind).toUpperCase() === "LOT").map((s: any) => String(s.ref)));
  const pos = new Set((claim?.subjects || []).filter((s: any) => String(s.kind).toUpperCase() === "PO").map((s: any) => String(s.ref)));
  return (inspections || []).filter(x => lots.has(String(x.lotNumber)) || (x.poRef && pos.has(String(x.poRef))));
}

// ── CL-3: evidence as REFERENCES to what already exists ───────────────────────
export interface EvidenceRef { kind: string; ref: string; label: string; link?: string; }
export function evidenceCandidates(claim: any, ctx: { inspections?: any[]; shipments?: any[]; protocolsFor?: (sh: any) => any[] }): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  inspectionCandidates(claim, ctx.inspections || []).forEach(x => out.push({ kind: x.stage === "client" ? "Client claim" : "Survey report", ref: `inspection:${x.id}`, label: `Inspection ${x.date} · ${x.lotNumber} · ${x.verdict}`, link: (x.links || [])[0] }));
  const refs = new Set((claim?.subjects || []).map((s: any) => String(s.ref)));
  (ctx.shipments || []).forEach(sh => {
    const carries = refs.has(String(sh.number)) || (sh.lotRefs || []).some((r: any) => refs.has(String(r))) || (sh.goods || []).some((g: any) => refs.has(String(g.lotRef)) || refs.has(String(g.soRef)) || refs.has(String(g.poRef)));
    if (!carries) return;
    (sh.documents || []).forEach((d: any, i: number) => out.push({ kind: S(d.type || "Document"), ref: `doc:${sh.number}:${i}`, label: `${S(d.type)} · ${sh.number} · ${S(d.status) || "—"}`, link: S(d.link) }));
    (ctx.protocolsFor ? ctx.protocolsFor(sh) : (sh.loadingProtocols || [])).forEach((p: any) => out.push({ kind: "Loading protocol", ref: `protocol:${p.number}`, label: `${p.number} · ${p.status || "Draft"}`, link: S(p.link) }));
    (sh.legs || []).forEach((l: any) => (l.vehicles || []).forEach((u: any) => { if (S(u.tempRecorderNo)) out.push({ kind: "Temperature record", ref: `recorder:${sh.number}:${u.id}`, label: `Recorder ${u.tempRecorderNo} · ${u.truckPlate || u.containerNumber || ""}`.trim() }); }));
  });
  return out;
}
export function attachEvidence(claim: any, e: EvidenceRef): any {
  const cur = claim?.evidence || [];
  if (cur.some((x: any) => String(x.ref) === String(e.ref))) return claim;
  return { ...claim, evidence: [...cur, { kind: e.kind, ref: e.ref, link: e.link || "", note: e.label }] };
}

// ── CL-4 (as ruled): the agreement's QC deadline WARNS, never blocks ──────────
export function qcReportWarning(claim: any, lot: any, inspections: any[], agreement: { qualityReportDays?: any } | null): string {
  if (String(claim?.direction || "").toUpperCase() !== "RECOVERY" || String(claim?.respondent?.kind || "") !== "Supplier") return "";
  if (S(claim?.agreedExtension)) return "";                                  // the parties agreed otherwise — recorded on the claim
  const days = num(agreement?.qualityReportDays); if (!(days > 0) || !lot) return "";
  const arrival = S(lot.arrivalDate) || (lot.movements || []).filter((m: any) => m.type === "IN" && !m.voided).map((m: any) => S(m.date)).sort()[0] || "";
  if (!arrival) return "";
  const due = addDays(arrival, days);
  const onTime = (inspections || []).some(x => String(x.lotNumber) === String(lot.number) && S(x.date) && S(x.date) <= due);
  if (onTime) return "";
  return `The agreement requires a quality report within ${days} day(s) of arrival (${arrival} → due ${due}) and none was recorded by then — ${S(claim?.respondent?.name) || "the producer"} may refuse this claim on that ground. If an extension was agreed, record it on the claim.`;
}

// ── CL-5: the chain sees the SALE's direct costs (delivery / return / re-delivery freight) ──
export function saleDirectCostLines(lotRefs: string[], orders: any[], shipments: any[], share = 1): Array<{ key: string; label: string; origin: "OURS"; amountPLN: number; lotRef?: string; suggested: boolean; note?: string; source: string }> {
  const lots = new Set((lotRefs || []).map(String));
  const soNums = new Set<string>();
  (orders || []).forEach(o => { if (o && o.status !== "Cancelled" && (o.items || []).some((it: any) => (it.sourceType === "STOCK" && lots.has(String(it.sourceRef))))) soNums.add(String(o.number)); });
  const out: any[] = [];
  (shipments || []).forEach(sh => {
    if (!sh || String(sh.status) === "Cancelled") return;
    const goods = sh.goods || [];
    const carries = goods.some((g: any) => lots.has(String(g.lotRef)) || soNums.has(String(g.soRef))) || (sh.lotRefs || []).some((r: any) => lots.has(String(r))) || (sh.soRefs || []).some((r: any) => soNums.has(String(r)));
    if (!carries) return;
    const purpose = String(sh.purpose || "").toUpperCase();
    if (purpose === "INBOUND") return;   // inbound freight is landed cost — already on the lot
    (sh.costs || []).forEach((c: any) => {
      const pln = r2(num(c.amountPLN) * Math.max(0, Math.min(1, num(share) || 1)));
      if (pln <= 0) return;
      out.push({ key: `sale:${sh.number}:${c.id ?? c.type}`, label: `${c.label || c.type || "Freight"} — ${sh.number} (${purpose === "RETURN" || /RET/.test(String(sh.number)) ? "return" : "delivery"})`, origin: "OURS", amountPLN: pln, suggested: true, note: "direct cost of the sale — not on the lot", source: `sale:${sh.number}:${c.id ?? c.type}` });
    });
  });
  return out;
}

// ── CL-6: settle by OFFSET from the claim — one action ────────────────────────
export function offsetNoteAgainstInvoice(note: any, invoice: any, deps: { nextId: () => any; todayISO: () => string }): { invoice: any; note: any; appliedAmount: number; error?: string } {
  if (!note || !invoice) return { invoice, note, appliedAmount: 0, error: "Note or invoice missing." };
  if (String(note.currency || "PLN").toUpperCase() !== String(invoice.currency || "PLN").toUpperCase()) return { invoice, note, appliedAmount: 0, error: `Currency mismatch — note ${note.currency}, invoice ${invoice.currency}.` };
  const source = `note:${note.id}`;
  if ((invoice.payments || []).some((p: any) => String(p.source) === source)) return { invoice, note, appliedAmount: 0, error: "This note is already applied to this invoice." };
  const remaining = r2(num(note.amount) - num(note.appliedAmount));
  const open = outstandingAmount(invoice);
  const amt = r2(Math.min(remaining, open));
  if (!(amt > 0)) return { invoice, note, appliedAmount: 0, error: "Nothing left to offset." };
  const inv2 = applyPaymentEvent(invoice, { date: deps.todayISO(), amount: amt, method: "Offset / compensation", note: `${note.noteType} note ${note.number || note.id} — claim ${note.relatedRef || ""}`.trim(), source }, deps.nextId);
  const note2 = { ...note, appliedAmount: r2(num(note.appliedAmount) + amt), appliedTo: [...(note.appliedTo || []), { invoiceId: invoice.id, invoiceNumber: invoice.number, amount: amt, date: deps.todayISO() }], status: r2(num(note.amount) - num(note.appliedAmount) - amt) <= 0.005 ? "Settled" : (note.status === "Draft" ? "Issued" : note.status) };
  return { invoice: inv2, note: note2, appliedAmount: amt };
}

// ── CL-7: fold the legacy producer-form fields into cost lines (idempotent) ────
export function foldLegacyClaimFields(claim: any): { claim: any; changed: boolean } {
  let c: any = { ...claim }; let changed = false;
  const lines = [...(c.costLines || [])];
  const push = (label: string, amount: number, currency: string, source: string) => { if (amount > 0 && !lines.some((l: any) => l.source === source)) { lines.push({ label, amount: r2(amount), currency, source }); changed = true; } };
  if (num(c.causedCosts) > 0) push("Costs caused (legacy form)", num(c.causedCosts), c.currency || "EUR", "legacy:causedCosts");
  if (num(c.clientCosts) > 0) push("Client's costs (legacy form)", num(c.clientCosts), c.currency || "EUR", "legacy:clientCosts");
  if (num(c.lostValueEUR) > 0) push("Lost value (legacy form)", num(c.lostValueEUR), "EUR", "legacy:lostValue");
  const noteBits: string[] = [];
  if (S(c.basis)) noteBits.push(`basis: ${S(c.basis)}`);
  if (num(c.lostKg) > 0) noteBits.push(`lost kg: ${num(c.lostKg)}`);
  if (c.soldInMarket) noteBits.push(`recovered in market: ${num(c.recoveredEGP)} EGP @ ${num(c.egpPerEur)}`);
  if (noteBits.length && !S(c.notes).includes("[legacy]")) { c.notes = `${S(c.notes)}${S(c.notes) ? "\n" : ""}[legacy] ${noteBits.join(" · ")}`; changed = true; }
  ["basis", "lostKg", "causedCosts", "clientCosts", "soldInMarket", "recoveredEGP", "egpPerEur", "migratedFrom"].forEach(k => { if (k in c) { delete c[k]; changed = true; } });
  if (changed) c.costLines = lines;
  // CL-1: one money truth — mirror the legacy EUR into the general fields once
  if (!S(c.currency)) { c.currency = "EUR"; changed = true; }
  if ((c.acceptedAmount === undefined || c.acceptedAmount === null || c.acceptedAmount === "") && num(c.acceptedEUR) > 0 && String(c.currency).toUpperCase() === "EUR") { c.acceptedAmount = num(c.acceptedEUR); changed = true; }
  if ((c.requestedAmount === undefined || c.requestedAmount === null || c.requestedAmount === "") && num(c.requestedEUR) > 0 && String(c.currency).toUpperCase() === "EUR") { c.requestedAmount = num(c.requestedEUR); changed = true; }
  return { claim: c, changed };
}

// ── CL-8: notice period from the agreement overrides the legal default ─────────
export function noticeRuleFor(claim: any, counterparty: any): { days: number; from: string; basis: string } {
  const kind = S(claim?.respondent?.kind);
  const d = NOTICE_DEFAULTS[kind];
  const override = num(counterparty?.noticeDays);
  if (override > 0) return { days: override, from: d?.from || "delivery", basis: `Agreement with ${S(counterparty?.name) || kind}: ${override} day(s)` };
  return d ? { days: d.days, from: d.from, basis: d.basis } : { days: 0, from: "delivery", basis: "" };
}

/** CL-1 summary for screens: one line, any currency. */
export function claimMoneyLabel(claim: any): string {
  const m = claimMoney(claim);
  return m.amount > 0 ? `${m.amount.toLocaleString("pl-PL")} ${m.currency}${m.currency !== "PLN" && m.pln ? ` (≈ ${m.pln.toLocaleString("pl-PL")} PLN)` : ""}` : "—";
}
