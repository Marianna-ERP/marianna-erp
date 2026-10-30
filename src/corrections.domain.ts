// corrections.domain.ts — v7.45.0 (INV2-1 / INV2-2, Invoices analysis 29 Oct): ONE CORRECTION RECOGNISER, ONE PARENT FINDER, ONE DUPLICATE KEY
// for every way a document enters (the sales import, the purchase import from the API or from a file, a correction typed into Fakturownia
// as a negative invoice, the conversion banner). Owner decision 29 Oct: a correction carries the rate of the invoice it corrects.
const S = (v: any) => String(v ?? "").trim();
const digits = (v: any) => S(v).replace(/[^0-9A-Za-z]/g, "").toUpperCase().replace(/^PL/, "");
const normNo = (v: any) => S(v).replace(/\s+/g, "").toUpperCase();
/** A correction: Fakturownia's kind, a negative total, or a correction-style number or wording (FK, KF, KOR, FSKOR, "korekta", "do faktury"). */
export function isCorrectionRow(r: any): boolean {
  if (!r) return false;
  if (S(r.kind).toLowerCase() === "correction") return true;
  const gross = Number(r.gross ?? r.grossAmount ?? r.grossTotal); if (isFinite(gross) && gross < 0) return true;
  const no = S(r.number); const text = `${S(r.description)} ${S(r.notes)}`;
  return /^(FK|KF|FSKOR|KOR)[\s/_-]/i.test(no) || /(^|[\s/_-])KOR([\s/_-]|$)/i.test(no) || /korekt|do faktury/i.test(text);
}
/** The invoice number a correction names in its text ("korekta do faktury EUR276/2026", "… do Faktury FV 9/2026"). */
export function citedNumber(r: any): string {
  const text = `${S(r?.description)} ${S(r?.notes)}`;
  const m = text.match(/(?:do\s+faktury|korekta\s+do|dotyczy\s+faktury|to\s+invoice)\s*(?:nr\.?|no\.?)?\s*([A-Z0-9][A-Z0-9/_.-]*\d[A-Z0-9/_.-]*)/i);
  return m ? m[1].replace(/[.,;]+$/, "") : "";
}
/** The invoice a correction corrects: Fakturownia id → KSeF number → the number named in its text with the same company's NIP. */
export function findCorrectedInvoice(r: any, invoices: any[], partyTaxNo?: string): any | null {
  const live = (invoices || []).filter((i: any) => i && S(i.paymentStatus) !== "Cancelled" && !(Number(i.grossAmount) < 0));   // a correction never corrects a correction
  const fid = r?.correctedFktId; if (fid != null && S(fid)) { const hit = live.find((i: any) => S((i.fakturownia || {}).fktId ?? (i.fakturownia || {}).ref) === S(fid)); if (hit) return hit; }
  const ks = S(r?.correctedKsef); if (ks) { const hit = live.find((i: any) => S(i.ksefNo) === ks); if (hit) return hit; }
  const cited = normNo(citedNumber(r)); const tax = digits(partyTaxNo ?? r?.sellerTaxNo ?? r?.buyerTaxNo);
  if (cited) { const hit = live.find((i: any) => normNo(i.number) === cited && (!tax || !digits(i.counterparty?.taxNo || i.counterparty?.nip) || digits(i.counterparty?.taxNo || i.counterparty?.nip) === tax)); if (hit) return hit; }
  return null;
}
/** One duplicate key across invoices AND notes: Fakturownia id, then KSeF number, then the company's NIP with the number. */
export function alreadyImported(r: any, invoices: any[], notes: any[] = []): { as: "invoice" | "note"; number: string } | null {
  const fid = S(r?.fktId); const ks = S(r?.ksefNo); const no = normNo(r?.number); const tax = digits(r?.sellerTaxNo ?? r?.buyerTaxNo ?? r?.taxNo);
  const docs: Array<{ as: "invoice" | "note"; d: any }> = [...(invoices || []).filter(Boolean).map((d: any) => ({ as: "invoice" as const, d })), ...(notes || []).filter(Boolean).map((d: any) => ({ as: "note" as const, d }))];
  for (const { as, d } of docs) {
    if (S(d.paymentStatus || d.status) === "Cancelled") continue;
    const dFid = S((d.fakturownia || {}).fktId ?? (d.fakturownia || {}).ref ?? (S(d.source).match(/^fakturownia-correction:(\d+)$/) || [])[1]);
    if (fid && dFid && dFid === fid) return { as, number: S(d.number) };
    if (ks && S(d.ksefNo) && S(d.ksefNo) === ks) return { as, number: S(d.number) };
    const dTax = digits((d.counterparty || {}).taxNo || (d.counterparty || {}).nip || d.partyTaxNo);
    if (no && normNo(d.number) === no && (!tax || !dTax || dTax === tax)) return { as, number: S(d.number) };
  }
  return null;
}
