import { paymentBasisOf } from "./po.domain";
import { S } from "./format";
import { formatAddress } from "./address.domain";   // v7.28.10 (Batch L)
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
/** v7.28.11 (Batch L · FZ-03, P-12): A COMPANY'S COUNTRY IS ITS CODE — the name is read from the countries list (Settings ›
 *  Countries), or the built-in names; the old name field only for a company whose code is still missing. */
export function countryNameOf(iso: any): string {
  const k = S(iso).toUpperCase(); if (!k) return "";
  const u = USER_COUNTRIES.find(x => S(x.iso).toUpperCase() === k); if (u && S(u.name)) return S(u.name);
  const n = Object.keys(COUNTRY_ISO).find(name => (COUNTRY_ISO as any)[name] === k && name.length > 2);
  return n ? n.replace(/\b([a-z])/g, (m: string) => m.toUpperCase()) : k;
}
export function companyCountryIso(c: any): string { return S(c?.countryIso).toUpperCase() || countryIso(c?.country) || countryIso(c?.addr?.country); }
export function companyCountryName(c: any): string { const iso = companyCountryIso(c); return iso ? countryNameOf(iso) : S(c?.country); }
export function isEU(country: any): boolean | null { const iso = countryIso(country); if (!iso) return null; const u = USER_COUNTRIES.find(x => S(x.iso).toUpperCase() === iso); return u ? !!u.eu : EU.has(iso); }

// ── CP-1 / CP-2 / CP-9: normalisation (idempotent) ────────────────────────────
export function normaliseCounterparty(c: any): { contact: any; changed: boolean } {
  let n: any = { ...c }; let changed = false;
  // CP-1: one roles[]
  const roles: string[] = Array.isArray(c.roles) ? [...c.roles] : [];
  [c.type, ...(c.additionalTypes || [])].forEach((t: any) => { const r = S(t); if (r && !roles.includes(r)) roles.push(r); });
  if (JSON.stringify(roles) !== JSON.stringify(c.roles || [])) { n.roles = roles; changed = true; }
  if (!S(n.type) && roles.length) { n.type = roles[0]; changed = true; }
  if ("additionalTypes" in n) { delete n.additionalTypes; changed = true; }   // v7.28.2 (Batch L · FZ-03): roles[] owns them; type stays the primary one
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
  // v7.28.1 (Batch L · FZ-03, RM-2 F-1): the terms{} block owns the payment days, the credit limit and the currency — the flat copies,
  // folded above when the terms had none, are no longer written
  ["paymentTermsDays", "creditLimitPLN", "defaultCurrency"].forEach(k => { if (k in n) { delete n[k]; changed = true; } });
  // v7.28.10 (Batch L · FZ-03): the structured parts own the address — the one-line copy goes once they are complete
  if ("address" in n && addressComplete(n)) { delete n.address; changed = true; }
  ["paymentTerms", "paymentTermsOther", "finance", "services", "linkedDocs"].forEach(k => { if (k in n) { delete n[k]; changed = true; } });   // CP-2 text fields, CP-9 cache
  // CP-6
  const iso = countryIso(c.country); if (iso && n.countryIso !== iso) { n.countryIso = iso; changed = true; }
  // CP-3 · v7.28.2 (Batch L · FZ-03): ONE list of persons, people[] — every screen reads it through peopleOf(); a record written
  // before keeps its old contacts[] until it is next saved: the list moves into people[] (when people[] is empty) and is dropped
  const people = Array.isArray(c.people) && c.people.length ? c.people : (Array.isArray(c.contacts) && c.contacts.length ? c.contacts : (Array.isArray(c.people) ? c.people : []));
  if (!Array.isArray(c.people) || c.people !== people) { n.people = people; changed = true; }
  if ("contacts" in n) { delete n.contacts; changed = true; }
  // v7.28.11 (Batch L · FZ-03): the code owns the country — the name and the address's copy of it go once the code is known
  if ("country" in n && !S(n.country) && !S(n.countryIso)) { delete n.country; changed = true; }   // an empty name says nothing
  if (S(n.countryIso)) {
  if ("country" in n) { delete n.country; changed = true; }
  if (n.addr && typeof n.addr === "object" && "country" in n.addr) { const a = { ...n.addr }; delete a.country; n.addr = a; changed = true; }
  }
  if (typeof n.name === "string" && n.name !== n.name.trim()) { n.name = n.name.trim(); changed = true; }   // v7.35.0 (PARTY-1): no stray space in a name
  return { contact: n, changed };
}

/** v7.28.2 (Batch L · FZ-03, P-12): A COMPANY'S PERSONS — people[]; the only place the old contacts[] is still read (a record written
 *  before this version, until it is next saved). */
/** v7.28.2 (Batch L · FZ-03, P-12): A COMPANY'S ROLES — roles[] (the primary type among them); the old additionalTypes is read only
 *  here, for a record written before, until it is next saved. */
/** v7.28.10 (Batch L · FZ-03, P-12): A COMPANY'S ADDRESS — its structured parts (street, postcode, city) as one line; the old one-line
 *  text only for a company whose parts are not complete yet (the Directory lists those to complete). */
export function companyAddressLine(c: any, opts: { withCountry?: boolean } = {}): string {
// documents print the country on its own line (addressWithCountry), so the company's line leaves it out; a place's line keeps it
// the parts when complete; while they are not, the one-line text if there is one (it holds more), else whatever parts there are
const a = c?.addr || {}; const parts = () => { const line = formatAddress({ ...a, country: "" }, { oneLine: true, withCountry: false }); const cn = opts.withCountry ? companyCountryName(c) : ""; return [line, cn].filter(Boolean).join(", "); };   // v7.28.11: the name from the code
if (addressComplete(c)) return parts(); if (S(c?.address)) return S(c.address); return (S(a.street) || S(a.city) || S(a.postcode)) ? parts() : "";
}
export function addressComplete(c: any): boolean { const a = c?.addr || {}; return !!(S(a.street) && S(a.city) && S(a.postcode)); }
export function rolesOf(c: any): string[] {
  const out: string[] = []; const add = (r: any) => { const s = S(r); if (s && !out.includes(s)) out.push(s); };
  if (Array.isArray(c?.roles) && c.roles.length) { add(c?.type); c.roles.forEach(add); return out; }
  add(c?.type); (Array.isArray(c?.additionalTypes) ? c.additionalTypes : []).forEach(add); return out;
}
export function peopleOf(c: any): any[] { return Array.isArray(c?.people) && (c.people.length || !Array.isArray(c?.contacts)) ? c.people : (Array.isArray(c?.contacts) ? c.contacts : []); }

export function personFor(contact: any, role: string): { name: string; email: string; phone: string } | null {
  const people = peopleOf(contact);   // v7.28.2 (Batch L): the one reader
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
const primaryPersonOf = (c: any) => peopleOf(c).find((p: any) => p.isPrimary) || peopleOf(c)[0] || {};   // v7.28.2
/** The company as a document shows it (the fields the documents have always carried). */
/** v7.28.1: the terms of a company, read in one place — payment days, credit limit (PLN), currency. */
export function creditLimitOf(c: any): number { return num(c?.terms?.creditLimitPLN); }
export function currencyOf(c: any): string { return S(c?.terms?.defaultCurrency).toUpperCase(); }
export function companyCopy(c: any): any {
  const p = primaryPersonOf(c);
  // v7.28.1 (Batch L · FZ-27): the copy carries the currency from the terms and none of the retired payment-terms text
  return { id: c.id, name: c.name, country: companyCountryName(c), nip: c.nip, vatEuId: c.vatEuId, type: c.type, roles: rolesOf(c), address: companyAddressLine(c),
  defaultCurrency: (c.terms || {}).defaultCurrency || "", services: c.services || [], contact: p?.name || "", email: p?.email || "", phone: p?.phone || "" };
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

/** v7.32.1 (INV-QC, owner 26 Oct): A COMPANY FROM AN INVOICE — the record the Invoices panel creates for a company the register
 *  names in text only (a petrol station, a one-off carrier): name, tax number, address parts and country as the invoice carries them,
 *  the role from the invoice's side (Supplier for a cost invoice, Client for a sales invoice); the common address base, the country
 *  code; not a loading place by default. The same tidy-up as any company applies on save. */
export function newCompanyFromInvoice(inv: any, nextId: () => any, role?: "Supplier" | "Client"): any {
  const cp = inv?.counterparty || {}; const r = role || (S(inv?.kind).toUpperCase() === "SALES" ? "Client" : "Supplier");
  const taxRaw = S(cp.taxNo || cp.nip); const prefix = (taxRaw.match(/^([A-Za-z]{2})/) || [])[1]; const digits = taxRaw.replace(/[^0-9A-Za-z]/g, "");
  const addr = cp.addr || {}; const fromPrefix = prefix && countryNameOf(prefix.toUpperCase()) !== prefix.toUpperCase() ? prefix.toUpperCase() : "";
  const iso = countryIso(addr.country) || fromPrefix || "";   // v7.32.2: only a country the list knows — else left to the form's Countries list
  const nip = digits ? (prefix ? digits.slice(2) : digits) : "";
  const id = nextId(); return { ...(id != null ? { id } : {}), name: S(cp.name), roles: [r], type: r, countryIso: iso,
    addr: { street: S(addr.street), postcode: S(addr.postcode), city: S(addr.city) },
    nip, vatEuId: prefix && prefix.toUpperCase() !== "PL" ? taxRaw : "", terms: { defaultCurrency: S(inv?.currency) || "PLN", paymentDays: 30 }, services: [], notes: `Created from invoice ${S(inv?.number)}`, people: [], isPlace: false, createdFromInvoice: S(inv?.number) };
}