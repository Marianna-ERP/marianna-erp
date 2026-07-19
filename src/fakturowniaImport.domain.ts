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

export const IMPORT_TAGS = ["GOODS", "FREIGHT", "CUSTOMS", "WAREHOUSE", "OVERHEAD", "SKIP"] as const;
export type ImportTag = typeof IMPORT_TAGS[number];

export const FREIGHT_COST_TYPES = new Set(["road_freight", "sea_freight", "air_freight", "rail_freight"]);

const num = (v: any) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const norm = (s: any) => String(s || "").trim().toLowerCase();

/** A staged row — one Fakturownia cost invoice awaiting a tag. */
export interface StagedRow {
  key: string;
  number: string;
  seller: string;
  sellerTaxNo?: string;
  date: string;        // issue date
  dueDate?: string;
  net: number;
  gross: number;
  currency: string;
  fxRate: number;
  fktId?: any;
  description?: string;
}

export function stagedRowFromMapped(m: any, idx: number): StagedRow {
  const cur = String(m.currency || "PLN").toUpperCase();
  return {
    key: `api:${m.fktId ?? idx}`,
    number: String(m.number || ""),
    seller: String(m.sellerName || ""),
    sellerTaxNo: String(m.sellerTaxNo || ""),
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
export function contactForSeller(row: { seller: string; sellerTaxNo?: string }, contacts: any[]): any | null {
  const name = norm(row.seller);
  const tax = norm(row.sellerTaxNo).replace(/[^0-9a-z]/g, "");
  return (contacts || []).find((c: any) => {
    const cTax = norm(c.vatNumber || c.taxNo || c.nip).replace(/[^0-9a-z]/g, "");
    if (tax && cTax && tax === cTax) return true;
    const cName = norm(c.name);
    return !!cName && (cName === name || (name.length > 4 && (cName.includes(name) || name.includes(cName))));
  }) || null;
}

function contactTypes(c: any): string[] {
  if (!c) return [];
  if (Array.isArray(c.types)) return c.types.map((t: any) => String(t));
  return c.type ? [String(c.type)] : [];
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
  const rowPLN = Math.round((row.net || row.gross) * (row.fxRate || 1) * 100) / 100;
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

/** Build the register COST invoice for a posted row (money recomputed by the caller). */
export function buildCostInvoice(row: StagedRow, tag: ImportTag, link: { shipmentNumber?: string; poNumber?: string }, contact: any | null): any {
  const net = row.net || row.gross;
  const gross = row.gross || row.net;
  const vatRate = net > 0 && gross > net ? Math.round(((gross / net) - 1) * 100) : 0;
  const links: any[] = [];
  if ((tag === "FREIGHT" || tag === "CUSTOMS") && link.shipmentNumber) links.push({ type: "Shipment", number: link.shipmentNumber });
  if (tag === "GOODS" && link.poNumber) links.push({ type: "PO", number: link.poNumber });
  return {
    id: nextId(),
    kind: "COST",
    category: "PURCHASE",
    costScope: tag === "FREIGHT" || tag === "CUSTOMS" ? "SHIPMENT" : tag === "OVERHEAD" ? "OVERHEAD" : undefined,
    number: row.number,
    counterparty: contact ? { id: contact.id, name: contact.name } : { name: row.seller },
    issueDate: row.date, saleDate: row.date, dueDate: row.dueDate || "",
    paymentMethod: "Transfer",
    currency: row.currency, fxRate: row.fxRate || 1,
    netAmount: net, vatRate,
    positions: [], links,
    paymentStatus: "Draft", paidAmount: 0,
    notes: `Imported from Fakturownia${row.description ? ` — ${row.description}` : ""}`,
    attachment: null, creditNoteIds: [], allocation: null,
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
  const amount = row.net || row.gross;
  const fx = row.fxRate || 1;
  return {
    id: nextId(),
    period: String(row.date || localTodayISO()).slice(0, 7),
    date: row.date || localTodayISO(),
    category, description: row.description || `${row.seller} ${row.number}`.trim(),
    supplierName: row.seller, invoiceNo: row.number,
    amount, currency: row.currency, fxRate: fx,
    amountPLN: Math.round(amount * fx * 100) / 100,
    costCenter: "general", allocationMethod: "by_revenue",
    status: "Received", notes: "Imported from Fakturownia (Invoices)",
  };
}

/** Warehouse-invoice record for a WAREHOUSE-tagged invoice (parity with the old import). */
export function warehouseInvoiceFromRow(row: StagedRow, wh: any): any {
  const amount = row.net || row.gross;
  const fx = row.fxRate || 1;
  return {
    id: nextId(),
    warehouseId: wh?.id ?? "",
    warehouseName: wh?.name || row.seller,
    period: String(row.date || localTodayISO()).slice(0, 7),
    invoiceNo: row.number,
    date: row.date || localTodayISO(),
    amount, currency: row.currency, fxRate: fx,
    amountPLN: Math.round(amount * fx * 100) / 100,
    status: "Received",
    notes: "Imported from Fakturownia (Invoices)",
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
      if (/[/\-]/.test(v) && /\d/.test(v)) s += 2;          // separator + digit  → FV/79/06/2026
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
