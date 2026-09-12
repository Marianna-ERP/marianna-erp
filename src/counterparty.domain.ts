// ─────────────────────────────────────────────────────────────────────────────
// counterparty.domain.ts — v6.99.2: COUNTERPARTIES BATCH (CP-1…CP-7, CP-9; owner 11 Sept 2026)
// Pure.
// ─────────────────────────────────────────────────────────────────────────────
const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };

export const ROLES = ["Client", "Supplier", "Carrier", "Forwarder", "Broker", "Warehouse", "ShippingLine", "Other"] as const;

// ── CP-6: country as ISO code + EU flag ───────────────────────────────────────
const COUNTRY_ISO: Record<string, string> = { poland: "PL", polska: "PL", germany: "DE", deutschland: "DE", italy: "IT", italia: "IT", spain: "ES", france: "FR", hungary: "HU", croatia: "HR", slovenia: "SI", greece: "GR", "czech republic": "CZ", czechia: "CZ", slovakia: "SK", austria: "AT", netherlands: "NL", belgium: "BE", romania: "RO", bulgaria: "BG", lithuania: "LT", latvia: "LV", estonia: "EE", portugal: "PT", ireland: "IE", denmark: "DK", sweden: "SE", finland: "FI", cyprus: "CY", malta: "MT", luxembourg: "LU",
  ukraine: "UA", belarus: "BY", egypt: "EG", jordan: "JO", "saudi arabia": "SA", qatar: "QA", oman: "OM", libya: "LY", uae: "AE", "united arab emirates": "AE", morocco: "MA", turkey: "TR", "united kingdom": "GB", uk: "GB", chile: "CL", colombia: "CO", cambodia: "KH", norway: "NO", switzerland: "CH", serbia: "RS" };
const EU = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"]);
export function countryIso(country: any): string { const k = S(country).toLowerCase(); if (!k) return ""; if (/^[a-z]{2}$/i.test(S(country))) return S(country).toUpperCase(); return COUNTRY_ISO[k] || ""; }
export function isEU(country: any): boolean | null { const iso = countryIso(country); return iso ? EU.has(iso) : null; }

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
  if (JSON.stringify(terms) !== JSON.stringify(c.terms || {})) { n.terms = terms; changed = true; }
  // mirrors kept in sync for existing readers (paymentTermsDays / creditLimitPLN are read by PO-2, SO-4, F-3)
  if (num(terms.paymentDays) > 0 && num(n.paymentTermsDays) !== num(terms.paymentDays)) { n.paymentTermsDays = num(terms.paymentDays); changed = true; }
  if (num(terms.creditLimitPLN) > 0 && num(n.creditLimitPLN) !== num(terms.creditLimitPLN)) { n.creditLimitPLN = num(terms.creditLimitPLN); changed = true; }
  ["paymentTerms", "paymentTermsOther", "finance", "services", "linkedDocs"].forEach(k => { if (k in n) { delete n[k]; changed = true; } });   // CP-2 text fields, CP-9 cache
  // CP-6
  const iso = countryIso(c.country); if (iso && n.countryIso !== iso) { n.countryIso = iso; changed = true; }
  // CP-3: people[] is the one list of persons (legacy `contacts` array folds in)
  if (Array.isArray(c.contacts) && c.contacts.length && !(Array.isArray(c.people) && c.people.length)) { n.people = c.contacts.map((p: any) => ({ ...p, role: p.role || "Other" })); changed = true; }
  if ("contacts" in n) { delete n.contacts; changed = true; }
  if (!Array.isArray(n.people)) { n.people = []; changed = true; }
  return { contact: n, changed };
}

// ── CP-3: people by role, for the composers ───────────────────────────────────
export const PERSON_ROLES = ["Buyer", "Sales", "Accountant", "Dispatcher", "Quality", "Director", "Other"] as const;
export function personFor(contact: any, role: string): { name: string; email: string; phone: string } | null {
  const people = contact?.people || [];
  const hit = people.find((p: any) => S(p.role).toLowerCase() === S(role).toLowerCase() && S(p.email)) || people.find((p: any) => S(p.email)) || null;
  return hit ? { name: S(hit.name), email: S(hit.email), phone: S(hit.phone) } : (S(contact?.email) ? { name: S(contact?.name), email: S(contact.email), phone: S(contact?.phone) } : null);
}
export function missingPeopleInfo(contacts: any[], used: Set<string>): string[] {
  return (contacts || []).filter(c => c && !c.archived && used.has(S(c.name).toLowerCase()) && !personFor(c, "Buyer")).map(c => S(c.name));
}

// ── CP-4: archive honoured by pickers ─────────────────────────────────────────
export function activeParties(contacts: any[], role?: string): any[] {
  return (contacts || []).filter(c => c && !c.archived && (!role || (c.roles || [c.type]).includes(role)));
}

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
