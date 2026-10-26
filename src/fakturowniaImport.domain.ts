import { parseNum } from "./numbers";
import { resolveFxRate } from "./fx";   // v6.99.133 (AUD-36): one FX fallback — a foreign invoice without a rate takes the settings' rate, never 1
// ─────────────────────────────────────────────────────────────────────────────
// v6.39.0 — Fakturownia IMPORT domain (pure, tested).
//
// The Invoices module owns the Fakturownia import (user ruling C-1: the old
// Finance→Operational-costs import is removed entirely). Cost invoices are
// fetched (API, income=0) or read from the register file, staged, TAGGED, and
// posted to where they belong:
//
//   GOODS     → COST invoice in the register, linked to the supplier's PO
//               (C-2: invoice-vs-PO amounts shown side by side; full three-way
//               match is a later step)
//   FREIGHT   → COST invoice linked to the shipment; the matched Expected
//               freight cost line flips to "Received" + invoice number
//   CUSTOMS   → same, for the customs cost line
//   WAREHOUSE → warehouse-invoice record (reconciled against tariffs in
//               Finance → Warehouse charges — exact parity with the old flow)
//   OVERHEAD  → operational-cost row (still created — but via Invoices, the
//               single owner)
//   SKIP      → not posted
//
// Fakturownia remains the read-only register of record: the ERP references
// invoice numbers, it never writes back.
// ─────────────────────────────────────────────────────────────────────────────
import { nextId } from "./ids";
import { localTodayISO } from "./dates";
import { defaultFxRate } from "./fx";
import { rolesOf } from "./counterparty.domain";   // v7.28.2 (Batch L)
import { scopeOf } from "./invoicePlus.domain";   // v7.26.1 (A-INV-6)

export const IMPORT_TAGS = ["GOODS", "FREIGHT", "CUSTOMS", "WAREHOUSE", "OVERHEAD", "SKIP"] as const;
export type ImportTag = typeof IMPORT_TAGS[number];

export const FREIGHT_COST_TYPES = new Set(["road_freight", "sea_freight", "air_freight", "rail_freight"]);

const num = (v: any) => parseNum(v);   // v6.99.128 (AUD-12): the one parser — "1 230,50" is 1 230,50, not 1
const norm = (s: any) => String(s || "").trim().toLowerCase();

/** A staged row — one Fakturownia cost invoice awaiting a tag. */
export interface StagedRow {
  key: string;
  number: string;
  seller: string;
  sellerTaxNo?: string;
  sellerAddr?: { street?: string; postcode?: string; city?: string; country?: string };   // v7.32.1 (INV-QC): kept for "New company from this invoice"
  date: string;        // issue date
  dueDate?: string;
  net: number;
  gross: number;
  currency: string;
  fxRate: number;
  fktId?: any;
  description?: string;
}

/** v6.63.0 (D-08): a COST invoice's counterparty is the party that is NOT us.
 *  Depending on account configuration Fakturownia can return our own company in
 *  the seller slot of an expense record — importing that blindly made every cost
 *  invoice show Marianna as its own supplier. Whichever side's tax number (or,
 *  failing that, name) matches OUR company is us; the counterparty is the other. */
function normTax(v: any): string { return String(v ?? "").toLowerCase().replace(/[^0-9a-z]/g, ""); }
export function counterpartySideOfMapped(m: any, myTaxNo?: string, myName?: string): { name: string; taxNo: string; addr?: any } {
  const sellerIsUs =
    (!!myTaxNo && normTax(m.sellerTaxNo) !== "" && normTax(m.sellerTaxNo) === normTax(myTaxNo)) ||
    (!!myName && String(m.sellerName || "").toLowerCase().includes(String(myName).toLowerCase()));
  if (sellerIsUs) return { name: String(m.buyerName || ""), taxNo: String(m.buyerTaxNo || ""), addr: m.buyerAddr };
  return { name: String(m.sellerName || ""), taxNo: String(m.sellerTaxNo || ""), addr: m.sellerAddr };
}

export function stagedRowFromMapped(m: any, idx: number, myTaxNo?: string, myName?: string): StagedRow {
  const cur = String(m.currency || "PLN").toUpperCase();
  const party = counterpartySideOfMapped(m, myTaxNo, myName);
  return {
    ...(String(m.kind || "").toLowerCase() === "correction" ? { isCorrection: true, correctedFktId: m.correctedFktId ?? null } : {}),   // v7.34.0 (CN-1)
    key: `api:${m.fktId ?? idx}`,
    number: String(m.number || ""),
    seller: party.name,
    sellerTaxNo: party.taxNo,
    ...(party.addr && Object.values(party.addr).some((v: any) => String(v || "").trim()) ? { sellerAddr: party.addr } : {}),   // v7.32.1 (INV-QC)
    date: m.issueDate || m.sellDate || localTodayISO(),
    dueDate: m.dueDate || "",
    net: num(m.netTotal),
    gross: num(m.grossTotal),
    currency: cur,
    fxRate: defaultFxRate(cur),
    fktId: m.fktId,
    description: String(m.description || ""),
  };
}

/** Already registered? (a non-cancelled COST invoice with the same number) */
export function isDuplicateCostInvoice(number: string, invoices: any[]): boolean {
  const n = norm(number);
  if (!n) return false;
  return (invoices || []).some((i: any) => i.kind === "COST" && i.paymentStatus !== "Cancelled" && norm(i.number) === n);
}

/** Find the counterparty record for a seller (name or tax-no match). */
/** The seller's company. v7.25.1 (FZ-17, owner 17 Oct): an invoice is LINKED only by its tax number (NIP, then the EU VAT id) —
 *  { byName: false }; a name is a suggestion for the review list, never a link (A-RV-13: two companies of one name could swap). */
export function contactForSeller(row: { seller: string; sellerTaxNo?: string }, contacts: any[], opts: { byName?: boolean } = {}): any | null {
  const byName = opts.byName !== false;
  const name = norm(row.seller);
  const tax = norm(row.sellerTaxNo).replace(/[^0-9a-z]/g, "");
  return (contacts || []).find((c: any) => {
    // v6.40.1 (audit A1): the real tax fields are nip + vatEuId (the previous
    // vatNumber/taxNo names were phantoms).
    const cNip = norm(c.nip).replace(/[^0-9a-z]/g, "");
    const cVatEu = norm(c.vatEuId).replace(/[^0-9a-z]/g, "");
    if (tax && ((cNip && tax === cNip) || (cVatEu && tax === cVatEu))) return true;
    if (!byName) return false;
    const cName = norm(c.name);
    return !!cName && (cName === name || (name.length > 4 && (cName.includes(name) || name.includes(cName))));
  }) || null;
}

function contactTypes(c: any): string[] {
  // v6.40.1 (audit A1): contacts store type (primary) + additionalTypes[] — the
  // previously-read "types" field never existed, so additional roles were
  // invisible to the import suggestions.
  if (!c) return [];
  return rolesOf(c)
    .filter(Boolean).map((t: any) => String(t));
}

export function poValuePLN(po: any): number {
  const fx = num(po?.fxRate) || 1;
  const total = (po?.items || []).reduce((s: number, it: any) => s + num(it.qty) * num(it.price), 0);
  return Math.round(total * fx * 100) / 100;
}

export interface Suggestion {
  tag: ImportTag;
  contactId?: any;
  shipmentNumber?: string;
  costLineId?: any;
  poNumber?: string;
  poPLN?: number;
  reason: string;
}

/**
 * Suggest a tag + link for a staged row: the seller's party role decides the
 * tag; open "Expected" cost lines (by supplier or amount) decide the shipment
 * link; the supplier's POs decide the goods link (nearest by value).
 */
export function suggestForRow(row: StagedRow, contacts: any[], shipments: any[], pos: any[]): Suggestion {
  const c = contactForSeller(row, contacts);
  const rowPLN = Math.round((row.net || row.gross) * (resolveFxRate(row.fxRate, row.currency)) * 100) / 100;
  const types = contactTypes(c).map(norm);
  const has = (...keys: string[]) => types.some(t => keys.some(k => t.includes(k)));

  const matchLine = (wantCustoms: boolean): { shipmentNumber?: string; costLineId?: any } | null => {
    let best: any = null;
    (shipments || []).forEach((sh: any) => {
      if (sh.status === "Cancelled") return;
      (sh.costs || []).forEach((line: any) => {
        const isCustoms = line.type === "customs";
        if (wantCustoms !== isCustoms) return;
        if (!wantCustoms && !FREIGHT_COST_TYPES.has(String(line.type))) return;
        if ((line.invoiceStatus || "Expected") !== "Expected") return;
        const linePLN = num(line.amountPLN);
        const byParty = c && line.supplierId != null && String(line.supplierId) === String(c.id);
        const diff = Math.abs(linePLN - rowPLN);
        const byAmount = rowPLN > 0 && linePLN > 0 && diff <= Math.max(2, rowPLN * 0.01);
        if (!byParty && !byAmount) return;
        const score = (byParty ? 0 : 1000) + diff;
        if (!best || score < best.score) best = { score, shipmentNumber: sh.number, costLineId: line.id };
      });
    });
    return best ? { shipmentNumber: best.shipmentNumber, costLineId: best.costLineId } : null;
  };

  if (has("carrier", "forwarder", "transport", "spedy")) {
    const m = matchLine(false);
    return { tag: "FREIGHT", contactId: c?.id, ...(m || {}), reason: m ? `carrier/forwarder · matches expected freight on ${m.shipmentNumber}` : "carrier/forwarder party" };
  }
  if (has("broker", "customs", "agencja")) {
    const m = matchLine(true);
    return { tag: "CUSTOMS", contactId: c?.id, ...(m || {}), reason: m ? `customs party · matches expected customs on ${m.shipmentNumber}` : "customs party" };
  }
  if (has("warehouse", "magazyn") || (c && c.warehouseTariff)) {
    return { tag: "WAREHOUSE", contactId: c?.id, reason: "warehouse party" };
  }
  if (has("supplier", "producer", "dostaw")) {
    // GOODS: the supplier's nearest-by-value open PO (C-2: amounts side by side)
    let best: any = null;
    (pos || []).forEach((po: any) => {
      if (po.status === "Cancelled") return;
      const sName = norm(po.supplier?.name);
      const byId = c && po.supplier?.id != null && String(po.supplier.id) === String(c.id);
      const byName = !!sName && sName === norm(row.seller);
      if (!byId && !byName) return;
      const v = poValuePLN(po);
      const diff = Math.abs(v - rowPLN);
      if (!best || diff < best.diff) best = { diff, poNumber: po.number, poPLN: v };
    });
    return best
      ? { tag: "GOODS", contactId: c?.id, poNumber: best.poNumber, poPLN: best.poPLN, reason: `supplier · nearest PO ${best.poNumber}` }
      : { tag: "GOODS", contactId: c?.id, reason: "supplier party (no PO matched — pick one)" };
  }
  // amount-only rescue: an Expected freight/customs line with this exact value
  const f = matchLine(false); if (f) return { tag: "FREIGHT", ...(f as any), reason: `amount matches expected freight on ${f.shipmentNumber}` };
  const cu = matchLine(true); if (cu) return { tag: "CUSTOMS", ...(cu as any), reason: `amount matches expected customs on ${cu.shipmentNumber}` };
  return { tag: "OVERHEAD", contactId: c?.id, reason: c ? "no operational match — overhead" : "unknown seller — overhead" };
}

/** v7.26.0 (A-INV-1): the VAT rate an invoice's two amounts say, precise enough that net + VAT gives back its gross to the grosz
*  (a rate rounded to whole percent turned 1 234,56 into 1 230,00); 0 when either amount is missing. */
export function vatRateOf(net: any, gross: any): number {
const a = num(net), b = num(gross); if (!a || !b) return 0;
return Math.round(((b / a) - 1) * 100 * 1e6) / 1e6;
}

/** Build the register COST invoice for a posted row (money recomputed by the caller).
*  v7.26.0 (A-INV-1): the net is never taken for the gross (nor the other way round) — a row missing one is posted only when the
*  user ticks it, and carries amountsIncomplete so the data checks name it. */
export function buildCostInvoice(row: StagedRow, tag: ImportTag, link: { shipmentNumber?: string; poNumber?: string }, contact: any | null): any {
const incomplete = !num(row.net) || !num(row.gross);
const net = num(row.net) || num(row.gross);
const vatRate = vatRateOf(row.net, row.gross);
  const links: any[] = [];
  if ((tag === "FREIGHT" || tag === "CUSTOMS") && link.shipmentNumber) links.push({ type: "Shipment", number: link.shipmentNumber });
  if (tag === "GOODS" && link.poNumber) links.push({ type: "PO", number: link.poNumber });
  return {
    id: nextId(),
    kind: "COST",
    category: (tag === "FREIGHT" ? "FREIGHT" : tag === "CUSTOMS" ? "CUSTOMS" : tag === "WAREHOUSE" ? "WAREHOUSE" : tag === "GOODS" ? "PURCHASE" : "OTHER") as any,   // v6.99.120 (AUD-18): the tag names the category
    costScope: scopeOf(tag === "FREIGHT" ? "FREIGHT" : tag === "CUSTOMS" ? "CUSTOMS" : tag === "WAREHOUSE" ? "WAREHOUSE" : tag === "GOODS" ? "PURCHASE" : "OTHER"),   // v7.26.1 (A-INV-6)
    number: row.number,
    counterparty: contact ? { id: contact.id, name: contact.name } : { name: row.seller, ...(row.sellerTaxNo ? { taxNo: row.sellerTaxNo } : {}), ...(row.sellerAddr ? { addr: row.sellerAddr } : {}) },   // v7.32.1 (INV-QC): what the invoice knows, for a company created from it
    issueDate: row.date, saleDate: row.date, dueDate: row.dueDate || "",
    paymentMethod: "Transfer",
    currency: row.currency, fxRate: resolveFxRate(row.fxRate, row.currency),
    netAmount: net, vatRate, ...(incomplete ? { amountsIncomplete: true } : {}),
    positions: [], links,
    paymentStatus: "Issued", paidAmount: 0,   // v6.99.120 (AUD-18, owner rule 11): a received invoice, open until the BANK clears it — Fakturownia's paid flag is never read
    notes: `Imported from Fakturownia${row.description ? ` — ${row.description}` : ""}`,
    attachment: null, allocation: null,
    fakturownia: { exported: false, fktId: row.fktId ?? null },
    source: "fakturownia-import",
    createdAt: localTodayISO(),
  };
}

/** Flip the matched shipment cost line to Received + invoice number. Pure. */
export function applyReceivedCostLine(sh: any, costLineId: any, invoiceNumber: string): any {
  return {
    ...sh,
    costs: (sh.costs || []).map((c: any) =>
      String(c.id) === String(costLineId)
        ? { ...c, invoiceStatus: "Received", invoiceRef: invoiceNumber }
        : c),
  };
}

/** Operational-cost row for an OVERHEAD-tagged invoice (parity with the old import). */
export function operationalCostFromRow(row: StagedRow, category: string): any {
const amount = row.net || row.gross;   // the cost itself stays the net, as before (Finance's figures do not move)
const vatRate = vatRateOf(row.net, row.gross);   // v7.26.0 (A-INV-1): the register invoice made from it keeps its VAT
  const fx = resolveFxRate(row.fxRate, row.currency);
  return {
    id: nextId(),
    period: String(row.date || localTodayISO()).slice(0, 7),
    date: row.date || localTodayISO(),
    category, description: row.description || `${row.seller} ${row.number}`.trim(),
    supplierName: row.seller, invoiceNo: row.number,
    amount, currency: row.currency, fxRate: fx, vatRate,
    amountPLN: Math.round(amount * fx * 100) / 100,
    costCenter: "general", allocationMethod: "by_revenue",
    status: "Received", notes: "Imported from Fakturownia (Invoices)",
  };
}

// ── file-register parsing helpers (moved verbatim from Finance, v6.16/v6.18.20) ──
export function guessCostCategory(text: string): string {
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

export function findCol(headers: string[], ...keys: string[]): number {
  const H = headers.map(h => String(h || "").toLowerCase());
  for (const k of keys) {
    const i = H.findIndex(h => h.includes(k));
    if (i >= 0) return i;
  }
  return -1;
}

// v6.16 (#9): the Fakturownia cost-register export has several "Numer …" columns
// (accounting no., position no., order no.). Plain substring matching on "numer"
// grabbed the wrong one and left the real invoice number blank. This prefers the
// genuine invoice-number headers and skips the lookalikes.
export function findInvoiceNoCol(headers: string[], rows?: any[][]): number {
  const H = headers.map(h => String(h || "").toLowerCase().trim());
  const bad = (h: string) => /(ksi[ęe]g|konta|pozycj|zam[óo]w|ewidenc|rachunk|korekt|proform|wewn)/.test(h);
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();

  // Score how "invoice-number-like" a column's sample values are. A real invoice number
  // (e.g. FV/79/06/2026, 123/2026, INV-0007) has separators or letters+digits; a row-counter
  // column ("No." holding 1, 2, 3…) is a plain integer sequence and scores negative. This is
  // what disambiguates Fakturownia's TWO "No." columns (row counter vs actual invoice number).
  const score = (col: number): number => {
    if (!rows || col < 0) return 0;
    let s = 0, seen = 0;
    for (let r = 0; r < rows.length && seen < 25; r++) {
      const v = String((rows[r] || [])[col] ?? "").trim();
      if (!v) continue;
      seen++;
      if (/[/-]/.test(v) && /\d/.test(v)) s += 2;          // separator + digit  → FV/79/06/2026
      else if (/[a-z]/i.test(v) && /\d/.test(v)) s += 2;     // letters + digits   → INV0007
      else if (/^\d+([.,]0+)?$/.test(v)) s -= 1;             // plain integer      → row counter
    }
    return seen ? s / seen : 0;
  };

  const nameHit = (h: string) => !bad(h) && (
    ["numer faktury", "nr faktury", "numer dokumentu", "nr dokumentu", "numer obcy", "nr obcy",
     "invoice number", "invoice no", "invoice no.", "numer", "nr", "number", "no", "no."].includes(norm(h))
    || /numer faktury|nr faktury|numer dokumentu|numer obcy|invoice|faktur/.test(h)
  );

  // Header-matching candidates; if more than one (e.g. two "No." columns), pick the most
  // invoice-like by value shape.
  const candidates: number[] = [];
  H.forEach((h, i) => { if (nameHit(h)) candidates.push(i); });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    candidates.sort((a, b) => score(b) - score(a));
    return candidates[0];
  }

  // No header matched at all → scan every column for invoice-like values.
  if (rows && rows.length) {
    let best = -1, bestScore = 0.5; // require a clear signal
    for (let c = 0; c < headers.length; c++) {
      if (bad(H[c] || "")) continue;
      const sc = score(c);
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    if (best >= 0) return best;
  }
  return -1;
}


/** v6.66.0 (D-30): what an import row duplicates — for the staging badge. */
export function duplicateCostInvoiceInfo(number: string, invoices: any[]): { number: string; status: string; grossAmount: number; source: string } | null {
  const nrm = (v: any) => String(v || "").toLowerCase().replace(/\s+/g, "");
  const n = nrm(number);
  if (!n) return null;
  const hit = (invoices || []).find((i: any) => i.kind === "COST" && i.paymentStatus !== "Cancelled" && nrm(i.number) === n);
  return hit ? { number: hit.number, status: hit.paymentStatus, grossAmount: Number(hit.grossAmount) || 0, source: String(hit.source || "") } : null;
}

// ─── v6.99.135 (A-FI-1, owner 4 Oct): THE IMPORT LEARNS from the register ────────────────────────────────────────────
// Most of the monthly invoices repeat: same seller, same kind, often the same amount. Before proposing anything from rules,
// the import looks at the most recent earlier invoice of the same seller and proposes its tag, category and allocation
// period; a same-seller invoice within ±10 % of the last amount is flagged recurring. Proposals are shown as proposals.
export interface LearnedProposal { tag?: ImportTag; category?: string; operationalCategory?: string; warehouseId?: any; allocationPeriod?: "month"; recurring: boolean; from: string; }
const TAG_FROM_CATEGORY: Record<string, ImportTag> = { FREIGHT: "FREIGHT", CUSTOMS: "CUSTOMS", WAREHOUSE: "WAREHOUSE", PURCHASE: "GOODS" };
const wordsOf = (v: any) => new Set(String(v || "").toLowerCase().replace(/[^a-ząćęłńóśźż0-9 ]/gi, " ").split(/\s+/).filter(w => w.length >= 4));
const resembles = (a: any, b: any) => { const A = wordsOf(a), B = wordsOf(b); if (!A.size || !B.size) return false; let hit = 0; A.forEach(w => { if (B.has(w)) hit++; }); return hit / Math.min(A.size, B.size) >= 0.5; };
export function learnFromRegister(row: { seller: string; sellerTaxNo?: string; net?: number; gross?: number; description?: string; positions?: any[] }, invoices: any[], contacts: any[]): LearnedProposal | null {
  const c = contactForSeller(row as any, contacts);
  // v6.99.141 (A-FI-3, owner 4 Oct): a seller with several roles (client + supplier + warehouse, like AGRO-HURT) cannot be learned from the
  // seller alone — its proposal comes from the last earlier invoice whose line names resemble this one's; nothing resembling → no proposal
  const roles = c ? [c.type, ...(c.roles || []), ...(c.types || [])].filter(Boolean).map((t: any) => String(t).toLowerCase()) : [];
  const multiRole = new Set(roles).size > 1;
  const rowText = [row.description, ...((row.positions || []).map((p: any) => p?.name))].filter(Boolean).join(" ");
  const sameSeller = (invoices || []).filter((i: any) => i && i.kind !== "SALES" && i.paymentStatus !== "Cancelled" && (
    (c && i.counterparty?.id != null && String(i.counterparty.id) === String(c.id)) || (row.sellerTaxNo && i.counterparty?.taxNo && String(i.counterparty.taxNo).replace(/\D/g, "") === String(row.sellerTaxNo).replace(/\D/g, "")) || (row.seller && String(i.counterparty?.name || "").toLowerCase() === String(row.seller).toLowerCase())))
    .sort((a: any, b: any) => String(b.issueDate || "").localeCompare(String(a.issueDate || "")));
  const pool = multiRole ? sameSeller.filter((i: any) => resembles(rowText, [i.description, i.source, ...((i.positions || []).map((p: any) => p?.name))].filter(Boolean).join(" "))) : sameSeller;
  const last = pool[0]; if (!last) return null;
  const amt = Number(row.net || row.gross || 0), lastAmt = Number(last.netAmount || last.grossAmount || 0);
  const recurring = sameSeller.length >= 2 && amt > 0 && lastAmt > 0 && Math.abs(amt - lastAmt) / lastAmt <= 0.10;
  const cat = String(last.category || ""); const tag = TAG_FROM_CATEGORY[cat];
  return { tag, category: cat || undefined, operationalCategory: last.operationalCategory || last.costCategory || undefined, warehouseId: cat === "WAREHOUSE" ? (last.warehouseId ?? last.counterparty?.id) : undefined, allocationPeriod: cat === "WAREHOUSE" && last.allocation ? "month" : undefined, recurring, from: `${last.number} (${String(last.issueDate || "").slice(0, 10)})${multiRole ? " · by content" : ""}` };
}

/** v7.26.0 (A-INV-1): an invoice already registered through the old overhead path (an operational cost turned into an invoice) carried
 *  no VAT — its gross showed its net. Re-importing its month offers the correction: the rate Fakturownia's amounts say. A zero rate
 *  that Fakturownia confirms is marked checked. Nothing else about the invoice changes. */
export function vatFixFor(row: StagedRow, invoices: any[]): { invoiceId: any; opCostId: string; vatRate: number; confirmZero: boolean } | null {
  if (!num(row.net) || !num(row.gross)) return null;
  const inv = (invoices || []).find((i: any) => i && i.kind === "COST" && i.paymentStatus !== "Cancelled" && String(i.number || "").trim() === String(row.number || "").trim());
  if (!inv || !String(inv.source || "").startsWith("migrated:opCost:") || num(inv.vatRate) > 0 || inv.vatChecked) return null;
  const rate = vatRateOf(row.net, row.gross);
  return { invoiceId: inv.id, opCostId: String(inv.source).slice("migrated:opCost:".length), vatRate: rate, confirmZero: rate === 0 };
}

// ── v7.26.3 (A-INV-3, owner 17 Oct): SALES INVOICES ISSUED IN FAKTUROWNIA BELONG TO THEIR SO ───────────────────────────────────
// While the team still issues some sales invoices in Fakturownia, each comes into the register linked to its SO, so the SO reads as
// invoiced and is never invoiced twice. Its rate is the one printed on it (FZ-06: the invoice locks its rate); when Fakturownia sends
// none, the register's NBP rule (the day before the issue date) fills it, as for every foreign invoice.
export function salesRowFromMapped(m: any, idx: number): any {
  return { key: `issued:${m.fktId ?? idx}`, number: String(m.number || ""), buyer: String(m.buyerName || ""), buyerTaxNo: String(m.buyerTaxNo || ""),
    date: m.issueDate || m.sellDate || localTodayISO(), dueDate: m.dueDate || "", net: num(m.netTotal), gross: num(m.grossTotal),
    currency: String(m.currency || "PLN").toUpperCase(), fxRate: num(m.exchangeRate), fktId: m.fktId, description: String(m.description || "") };
}
/** Already in the register (a sales invoice of the same number, not cancelled)? */
export function isRegisteredSale(number: string, invoices: any[]): boolean {
  const n = String(number || "").trim(); return !!n && (invoices || []).some((i: any) => i && i.kind === "SALES" && i.paymentStatus !== "Cancelled" && String(i.number || "").trim() === n);
}
/** The SOs an issued invoice may belong to — of its client (by tax number), not yet invoiced; the SO named in the invoice first,
 *  then the closest in amount. */
export function soCandidatesForSale(row: any, orders: any[], invoices: any[], contacts: any[]): { companyId: any; list: Array<{ number: string; label: string }> } {
  const company = contactForSeller({ seller: row.buyer, sellerTaxNo: row.buyerTaxNo }, contacts, { byName: false });
  const invoiced = new Set<string>(); (invoices || []).forEach((i: any) => { if (i && i.kind === "SALES" && i.paymentStatus !== "Cancelled") (i.links || []).forEach((l: any) => { if (l && l.type === "SO") invoiced.add(String(l.number)); }); });
  const text = `${row.description || ""} ${row.number || ""}`;
  const net = (o: any) => (o.items || []).reduce((a: number, it: any) => a + num(it.qty) * num(it.unitPrice), 0);
  const list = (orders || []).filter((o: any) => o && !/Cancelled|Draft/.test(String(o.status || "")) && !invoiced.has(String(o.number)) && (company ? String(o.client?.id) === String(company.id) : norm(o.client?.name) === norm(row.buyer)))
    .map((o: any) => ({ o, named: text.includes(String(o.number)), gap: String(o.currency || "PLN").toUpperCase() === row.currency ? Math.abs(net(o) - num(row.net)) : Infinity }))
    .sort((a: any, b: any) => (Number(b.named) - Number(a.named)) || (a.gap - b.gap))
    .map((x: any) => ({ number: String(x.o.number), label: `${x.o.number}${x.named ? " · named on the invoice" : x.gap < Infinity ? ` · ${Math.round(net(x.o)).toLocaleString("pl-PL")} ${x.o.currency || "PLN"}` : ""}` }));
  return { companyId: company ? company.id : null, list };
}
/** The register entry for a sales invoice issued in Fakturownia. */
export function buildIssuedSalesInvoice(row: any, soNumber: string, contact: any | null): any {
  const net = num(row.net) || num(row.gross); const own = num(row.fxRate) > 0 && String(row.currency).toUpperCase() !== "PLN";
  return {
    id: nextId(), kind: "SALES", category: "SALES", costScope: "SALES", number: row.number,
    counterparty: contact ? { id: contact.id, name: contact.name } : { name: row.buyer },
    issueDate: row.date, saleDate: row.date, dueDate: row.dueDate || "", paymentMethod: "Transfer",
    currency: row.currency, fxRate: own ? num(row.fxRate) : resolveFxRate(defaultFxRate(row.currency), row.currency), ...(own ? { fxTableDate: row.date, fxSource: "fakturownia" } : {}),
    netAmount: net, vatRate: vatRateOf(row.net, row.gross), ...(!num(row.net) || !num(row.gross) ? { amountsIncomplete: true } : {}),
    positions: [], links: soNumber ? [{ type: "SO", number: soNumber }] : [],
    paymentStatus: "Issued", paidAmount: 0, notes: `Issued in Fakturownia${row.description ? ` — ${row.description}` : ""}`,
    attachment: null, allocation: null, fakturownia: { exported: true, fktId: row.fktId ?? null }, source: "fakturownia-issued", createdAt: localTodayISO(),
  };
}

/** v7.34.0 (CN-1, owner 26 Oct): A CORRECTING INVOICE FROM FAKTUROWNIA IS A NOTE — on the invoice it corrects (by its Fakturownia id), with
 *  its own number, issued: a correction that lowers the amount is a CREDIT note, one that raises it a DEBIT note; the party by id. */
export function noteFromCorrection(row: any, direction: "incoming" | "outgoing", invoices: any[], contact: any | null, nextId: () => any): any {
  const gross = Number(row.gross || row.net || 0); const fx = Number(row.fxRate) > 0 ? Number(row.fxRate) : 1;
  const corrected = (invoices || []).find((i: any) => i && row.correctedFktId != null && String((i.fakturownia || {}).fktId ?? (i.fakturownia || {}).ref) === String(row.correctedFktId)) || null;
  return { id: nextId(), noteType: gross < 0 ? "CREDIT" : "DEBIT", direction, number: String(row.number || ""), date: row.date, invoiceId: corrected ? corrected.id : null,
    relatedRef: corrected ? String(corrected.number || "") : "", partyId: contact ? contact.id : (corrected && corrected.counterparty ? corrected.counterparty.id ?? null : null),
    partyName: contact ? contact.name : String(row.seller || row.buyer || ""), category: "Correcting invoice", amount: Math.abs(gross), currency: String(row.currency || "PLN"), fxRate: fx,
    amountPLN: Math.round(Math.abs(gross) * fx * 100) / 100, status: "Issued", reason: `Correcting invoice ${String(row.number || "")} from Fakturownia`, source: `fakturownia-correction:${row.fktId ?? row.number}`,
    fakturownia: { fktId: row.fktId ?? null } };
}
