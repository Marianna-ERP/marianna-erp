import { paymentBasisOf } from "./po.domain";
import { S } from "./format";
import { parseNum } from "./numbers";   // v7.22.2 (FZ-22)
// ─────────────────────────────────────────────────────────────────────────────
// counterparty.domain.ts — v6.99.2: COUNTERPARTIES BATCH (CP-1…CP-7, CP-9; owner 11 Sept 2026)
// Pure.
// ─────────────────────────────────────────────────────────────────────────────
const num = (v: any): number => parseNum(v);   // v7.22.2 (FZ-22): one reader for every number — spaces and a decimal comma read the same everywhere

export const ROLES = ["Client", "Supplier", "Carrier", "Forwarder", "Broker", "Warehouse", "ShippingLine", "Other"] as const;

// ── CP-6: country as ISO code + EU flag ───────────────────────────────────────
const COUNTRY_ISO: Record<string, string> = { poland: "PL", polska: "PL", germany: "DE", deutschland: "DE", italy: "IT", italia: "IT", spain: "ES", france: "FR", hungary: "HU", croatia: "HR", slovenia: "SI", greece: "GR", "czech republic": "CZ", czechia: "CZ", slovakia: "SK", austria: "AT", netherlands: "NL", belgium: "BE", romania: "RO", bulgaria: "BG", lithuania: "LT", latvia: "LV", estonia: "EE", portugal: "PT", ireland: "IE", denmark: "DK", sweden: "SE", finland: "FI", cyprus: "CY", malta: "MT", luxembourg: "LU",
  ukraine: "UA", belarus: "BY", egypt: "EG", jordan: "JO", "saudi arabia": "SA", qatar: "QA", oman: "OM", libya: "LY", uae: "AE", "united arab emirates": "AE", morocco: "MA", turkey: "TR", "united kingdom": "GB", uk: "GB", chile: "CL", colombia: "CO", cambodia: "KH", norway: "NO", switzerland: "CH", serbia: "RS" };
const EU = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"]);
let USER_COUNTRIES: Array<{ iso: string; name: string; eu: boolean }> = [];
export function setUserCountries(list: any[]) { USER_COUNTRIES = Array.isArray(list) ? list : []; }
export function countryIso(country: any): string { const k = S(country).toLowerCase(); if (!k) return ""; if (/^[a-z]{2}$/i.test(S(country))) return S(country).toUpperCase(); const u = USER_COUNTRIES.find(x => S(x.name).toLowerCase() === k); if (u) return S(u.iso).toUpperCase(); return COUNTRY_ISO[k] || ""; }
/** v7.19.6 (A-TD-5): the address's lines, with the country added only when the address does not already end with it (any spelling). */
export function addressWithCountry(address: any, country: any): string[] {
  const lines = String(address || "").split(/\n/).map((s: string) => s.trim()).filter(Boolean); const c = S(country); if (!c) return lines;
  const last = (lines.join(",").split(",").map((s: string) => s.trim()).filter(Boolean).slice(-1)[0] || "");
  const same = (countryIso(last) && countryIso(last) === countryIso(c)) || last.toLowerCase() === c.toLowerCase();
  return same ? lines : [...lines, c];
}
export function isEU(country: any): boolean | null { const iso = countryIso(country); if (!iso) return null; const u = USER_COUNTRIES.find(x => S(x.iso).toUpperCase() === iso); return u ? !!u.eu : EU.has(iso); }

// ── CP-1 / CP-2 / CP-9: normalisation (idempotent) ────────────────────────────
export function normaliseCounterparty(c: any): { contact: any; changed: boolean } {
  let n: any = { ...c }; let changed = false;
  // CP-1: one roles[]
  const roles: string[] = Array.isArray(c.roles) ? [...c.roles] : [];
  [c.type, ...(c.additionalTypes || [])].forEach((t: any) => { const r = S(t); if (r && !roles.includes(r)) roles.push(r); });
  if (JSON.stringify(roles) !== JSON.stringify(c.roles || [])) { n.roles = roles; changed = true; }
  if (!S(n.type) && roles.length) { n.type = roles[0]; changed = true; }
  // CP-2: one terms{} block
  const terms: any = { ...(c.terms || {}) };
  const legacyDays = num(c.paymentTermsDays) || (S(c.paymentTerms).match(/(\d{1,3})/) ? num(S(c.paymentTerms).match(/(\d{1,3})/)![1]) : 0) || num(c.finance?.paymentDays);
  if (legacyDays > 0 && !(num(terms.paymentDays) > 0)) terms.paymentDays = legacyDays;
  if (num(c.creditLimitPLN) > 0 && !(num(terms.creditLimitPLN) > 0)) terms.creditLimitPLN = num(c.creditLimitPLN);
  if (S(c.defaultCurrency) && !S(terms.defaultCurrency)) terms.defaultCurrency = S(c.defaultCurrency).toUpperCase();
  if (num(c.noticeDays) > 0 && !(num(terms.noticeDays) > 0)) terms.noticeDays = num(c.noticeDays);
  if (num(c.qualityReportDays) > 0 && !(num(terms.qualityReportDays) > 0)) terms.qualityReportDays = num(c.qualityReportDays);
  if (c.fakturowniaDepartmentId != null && terms.fakturowniaDepartmentId == null) terms.fakturowniaDepartmentId = c.fakturowniaDepartmentId;
  if (!S(terms.paymentBasis)) terms.paymentBasis = paymentBasisOf(c);   // v6.99.23: one payment-terms source on the party too
  if (JSON.stringify(terms) !== JSON.stringify(c.terms || {})) { n.terms = terms; changed = true; }
  // mirrors kept in sync for existing readers (paymentTermsDays / creditLimitPLN are read by PO-2, SO-4, F-3)
  if (num(terms.paymentDays) > 0 && num(n.paymentTermsDays) !== num(terms.paymentDays)) { n.paymentTermsDays = num(terms.paymentDays); changed = true; }
  if (num(terms.creditLimitPLN) > 0 && num(n.creditLimitPLN) !== num(terms.creditLimitPLN)) { n.creditLimitPLN = num(terms.creditLimitPLN); changed = true; }
  ["paymentTerms", "paymentTermsOther", "finance", "services", "linkedDocs"].forEach(k => { if (k in n) { delete n[k]; changed = true; } });   // CP-2 text fields, CP-9 cache
  // CP-6
  const iso = countryIso(c.country); if (iso && n.countryIso !== iso) { n.countryIso = iso; changed = true; }
  // CP-3: ONE list of persons. The screens still read `contacts`; `people` is the same array (rename at the DDL).
  // HOTFIX v6.99.5: v6.99.4 deleted `contacts`, which every list/form reads → crash. Restore it from `people` and keep both in step.
  const people = Array.isArray(c.contacts) && c.contacts.length ? c.contacts : (Array.isArray(c.people) ? c.people : (Array.isArray(c.contacts) ? c.contacts : []));
  if (!Array.isArray(c.contacts) || c.contacts !== people) { n.contacts = people; changed = true; }
  if (!Array.isArray(c.people) || c.people !== people) { n.people = people; changed = true; }
  return { contact: n, changed };
}

export function personFor(contact: any, role: string): { name: string; email: string; phone: string } | null {
  const people = (contact?.contacts && contact.contacts.length ? contact.contacts : contact?.people) || [];
  const hit = people.find((p: any) => S(p.role).toLowerCase() === S(role).toLowerCase() && S(p.email)) || people.find((p: any) => S(p.email)) || null;
  return hit ? { name: S(hit.name), email: S(hit.email), phone: S(hit.phone) } : (S(contact?.email) ? { name: S(contact?.name), email: S(contact.email), phone: S(contact?.phone) } : null);
}
export function missingPeopleInfo(contacts: any[], used: Set<string>): string[] {
  return (contacts || []).filter(c => c && !c.archived && !c.deleted && used.has(S(c.name).toLowerCase()) && !personFor(c, "Buyer")).map(c => S(c.name));
}

// ── CP-4: archive honoured by pickers ─────────────────────────────────────────
export function activeParties(contacts: any[], role?: string): any[] {
  return (contacts || []).filter(c => c && !c.archived && !c.deleted && (!role || (c.roles || [c.type]).includes(role)));
}
/** v7.10.2 (A-RV-15 · CP-4): what a company picker offers — the live companies (activeParties), plus any archived one this
 *  document already names, so an existing document keeps showing its company (marked by archivedMark). */
export function pickerParties(contacts: any[], keep?: any): any[] {
  const keepIds = new Set((Array.isArray(keep) ? keep : [keep]).filter((v: any) => v !== undefined && v !== null && v !== "").map((v: any) => S(v)));
  const kept = (contacts || []).filter(c => c && (c.archived || c.deleted) && keepIds.has(S(c.id)));
  return [...activeParties(contacts), ...kept];
}
export const archivedMark = (c: any): string => (c && c.deleted ? " (deleted)" : c && c.archived ? " (archived)" : "");   // v7.17.0 (A-DEL-5)

// ── CP-5: Fakturownia id kept; match by id, then NIP ──────────────────────────
export function matchImported(contacts: any[], imported: { fakturowniaId?: any; nip?: any; name?: any }): any | null {
  const byId = imported.fakturowniaId != null ? (contacts || []).find(c => String(c.fakturowniaId) === String(imported.fakturowniaId)) : null;
  if (byId) return byId;
  const nip = S(imported.nip).replace(/\D/g, "");
  if (nip) { const byNip = (contacts || []).find(c => S(c.nip).replace(/\D/g, "") === nip); if (byNip) return byNip; }
  return null;
}

// ── CP-7: producer agreement block with validity ──────────────────────────────
export interface ProducerAgreement { season: string; validFrom?: string; validTo?: string; commissionPct?: any; bands?: Array<{ fromPLN: any; toPLN?: any; pct: any }>; qualityReportDays?: any; salesReportDays?: any; noticeDays?: any; reportRatePLNperEUR?: any; template?: string; notes?: string; }
export function currentAgreement(contact: any, dateISO: string): ProducerAgreement | null {
  const list: ProducerAgreement[] = contact?.agreements || [];
  const valid = list.filter(a => (!a.validFrom || a.validFrom <= dateISO) && (!a.validTo || a.validTo >= dateISO)).sort((a, b) => S(b.validFrom).localeCompare(S(a.validFrom)));
  return valid[0] || null;
}

// ── v7.25.0 (A-RV-13 / FZ-02, owner 17 Oct): ONE SOURCE FOR EACH COMPANY ─────────────────────────────────────────────────────
// A PO, an SO and a shipment name their companies by id; the screens read the company live from Counterparties. The copy a document
// carries is never rewritten on a company edit any more, and a company is never looked up by NAME (two companies of one name could
// swap) — one not found by its id (or by a merged duplicate's id) shows its stored copy and is named in the data checks.
const primaryPersonOf = (c: any) => (c?.contacts || []).find((p: any) => p.isPrimary) || (c?.contacts || [])[0] || {};
/** The company as a document shows it (the fields the documents have always carried). */
export function companyCopy(c: any): any {
  const p = primaryPersonOf(c);
  return { id: c.id, name: c.name, country: c.country, nip: c.nip, vatEuId: c.vatEuId, type: c.type, additionalTypes: c.additionalTypes || [], address: c.address,
    defaultCurrency: c.defaultCurrency, paymentTerms: c.paymentTerms, paymentTermsOther: c.paymentTermsOther, services: c.services || [], contact: p?.name || "", email: p?.email || "", phone: p?.phone || "" };
}
/** The company a document names, read live by its id or a merged duplicate's id — never by name. Not found: the copy as stored. */
export function liveCompany(saved: any, contacts: any[]): any {
  if (!saved || saved.id == null) return saved;
  const id = String(saved.id);
  const c = (contacts || []).find((x: any) => x && String(x.id) === id) || (contacts || []).find((x: any) => x && (x.mergedFromIds || []).map(String).includes(id));
  return c ? companyCopy(c) : saved;
}
/** Documents with their companies read live; a document whose copy already equals the live company stays the very same object. */
export function withLiveCompanies(docs: any[], fields: string[], contacts: any[]): any[] {
  let any = false;
  const out = (docs || []).map((d: any) => {
    if (!d) return d; let o = d;
    fields.forEach(f => { const s = d[f]; if (!s || typeof s !== "object") return; const live = liveCompany(s, contacts); if (live !== s && JSON.stringify(live) !== JSON.stringify(s)) { if (o === d) o = { ...d }; o[f] = live; } });
    if (o !== d) any = true; return o;
  });
  return any ? out : (docs || []);
}
