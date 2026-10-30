// ─── v6.8: FAKTUROWNIA / INVOICEOCEAN API CLIENT ────────────────────────────
// v7.21.1 (AUD-49, owner 11 Oct): THE TOKEN NEVER REACHES A BROWSER. It is a hidden Vercel setting read only by the app's server
// part (api/fakturownia.js), which makes every Fakturownia call for a signed-in person — so the browser-blocked (CORS) failures go
// too. Here the browser keeps one thing of its own: the live-push switch. A token an older build left in this browser is removed
// the first time the configuration is read. Callers still handle {ok:false} by offering the file import.
import { sessionToken } from "./remoteStore";
import { paymentMethodFrom } from "./payments.domain";   // v7.57.0 (PAY-1)
import { parseNum } from "./numbers";   // v7.22.2 (FZ-22)

export interface FakturowniaConfig {
  liveWriteEnabled?: boolean;  // v6.18.4: live invoice creation is OFF unless explicitly enabled (per browser)
}

const CONFIG_KEY = "marianna-erp:v1:fakturowniaConfig";

export function readFakturowniaConfig(): FakturowniaConfig {
  if (typeof window === "undefined" || !window.localStorage) return { liveWriteEnabled: false };
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return { liveWriteEnabled: false };
    const c = JSON.parse(raw) || {};
    const live = c.liveWriteEnabled === true;
    if ("apiToken" in c || "subdomain" in c) window.localStorage.setItem(CONFIG_KEY, JSON.stringify({ liveWriteEnabled: live }));   // v7.21.1: the old token leaves this browser
    return { liveWriteEnabled: live };
  } catch { return { liveWriteEnabled: false }; }
}

export function writeFakturowniaConfig(c: FakturowniaConfig | null): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (!c) window.localStorage.removeItem(CONFIG_KEY);
    else window.localStorage.setItem(CONFIG_KEY, JSON.stringify({ liveWriteEnabled: c.liveWriteEnabled === true }));
  } catch { /* ignore */ }
}

export interface FktResult<T> { ok: boolean; data?: T; status?: number; error?: string; corsLikely?: boolean }

/** One call to the app's server part. `corsLikely` keeps its old meaning for the callers: the call could not be made at all. */
async function fktCall(op: string, params: Record<string, any> = {}, body?: any): Promise<FktResult<any>> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "Sign in to MARIANNA first." };
  const qs = new URLSearchParams({ op });
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") qs.set(k, String(v)); });
  try {
    const res = await fetch(`/api/fakturownia?${qs.toString()}`, { method: body ? "POST" : "GET", headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let j: any = null; try { j = await res.json(); } catch { j = null; }
    if (!res.ok) return { ok: false, status: res.status, error: (j && j.error) || `The server part answered HTTP ${res.status}.` };
    return { ok: true, data: j, status: res.status };
  } catch (err: any) {
    return { ok: false, error: "The app's server part could not be reached — use the file import.", corsLikely: true };
  }
}

/** v7.26.6 (A-INV-2): an invoice's PDF from Fakturownia, through the app's server part (the token never reaches the browser). */
export async function fetchInvoicePdf(fktId: any): Promise<{ ok: boolean; blob?: Blob; error?: string }> {
  const token = await sessionToken(); if (!token) return { ok: false, error: "Sign in to MARIANNA first." };
  try {
    const res = await fetch(`/api/fakturownia?op=pdf&id=${encodeURIComponent(String(fktId ?? ""))}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/pdf" } });
    if (!res.ok) { let j: any = null; try { j = await res.json(); } catch { j = null; } return { ok: false, error: (j && j.error) || `The server part answered HTTP ${res.status}.` }; }
    return { ok: true, blob: await res.blob() };
  } catch { return { ok: false, error: "The app's server part could not be reached." }; }
}

/** Whether the server part holds a Fakturownia connection (and which account); null when it cannot be asked. */
export async function fakturowniaStatus(): Promise<{ configured: boolean; account: string; testCopy: boolean } | null> {
  const r = await fktCall("status");
  return r.ok && r.data ? { configured: !!r.data.configured, account: String(r.data.account || ""), testCopy: !!r.data.testCopy } : null;
}

// ── Invoice fetching ─────────────────────────────────────────────────────────
// period: "this_month" | "last_month" | "more" (with date_from/date_to)
export interface FetchInvoicesOptions {
  income?: 0 | 1;          // 1 = our sales invoices, 0 = cost invoices received
  period?: string;
  dateFrom?: string;       // used when period === "more"
  dateTo?: string;
  search?: string;         // e.g. an SO number placed in invoice description/oid
  perPage?: number;
  maxPages?: number;
}

export async function fetchInvoices(_c: FakturowniaConfig, opts: FetchInvoicesOptions = {}): Promise<FktResult<any[]>> {
  const all: any[] = [];
  const perPage = opts.perPage || 100;
  const maxPages = opts.maxPages || 10;
  for (let page = 1; page <= maxPages; page++) {
    const r = await fktCall("invoices", {
      page, per_page: perPage,
      period: opts.period || (opts.dateFrom ? "more" : "this_month"),
      date_from: opts.dateFrom, date_to: opts.dateTo,
      income: opts.income,
      search: opts.search,
    });
    if (!r.ok) return r as FktResult<any[]>;
    const batch = Array.isArray(r.data) ? r.data : [];
    all.push(...batch);
    if (batch.length < perPage) break;
  }
  return { ok: true, data: all };
}

/** v6.75.0: the account's departments — each one holds a bank account in a
 *  currency. Read-only; the ERP never creates a department (Fakturownia blocks
 *  that for good reason), it only chooses among those that exist. */
export async function fetchDepartments(_c: FakturowniaConfig): Promise<FktResult<any[]>> {
  const r = await fktCall("departments", { page: 1, per_page: 100 });
  if (!r.ok) return r as FktResult<any[]>;
  return { ok: true, data: Array.isArray(r.data) ? r.data : [] };
}

export async function testConnection(_c: FakturowniaConfig): Promise<FktResult<{ count: number; account?: string }>> {
  return fktCall("test");
}

// ── Invoice creation (push) ──────────────────────────────────────────────────
// `body` is the payload built by invoicing.buildFakturowniaPayload (the invoice, no token — the server part adds its own).
// The TEST copy's server refuses it. The caller keeps the live-push switch and the "Copy payload" fallback.
export async function createInvoice(_c: FakturowniaConfig, body: any): Promise<FktResult<any>> {
  const payload = { ...(body || {}) }; delete payload.api_token;
  return fktCall("create", {}, payload);
}

/** v7.48.0 (INV2-7, owner decision 29 Oct — one register): a purchase invoice entered in the ERP (a foreign supplier's) registered in
 *  Fakturownia as an expense. The supplier is the seller; we are the buyer. Fakturownia's id comes back and is kept on the invoice, so the
 *  next "Import from Fakturownia" recognises it as already imported. */
export function expensePayload(inv: any, us: { name: string; nip: string }): any {
  const cp = inv?.counterparty || {}; const gross = Number(inv?.grossAmount) || 0; const net = Number(inv?.netAmount) || 0;
  const rate = net > 0 ? Math.round(((gross / net) - 1) * 100) : 0;
  return { invoice: { number: String(inv?.number || ""), issue_date: String(inv?.issueDate || "").slice(0, 10), sell_date: String(inv?.saleDate || inv?.issueDate || "").slice(0, 10),
    payment_to: String(inv?.dueDate || "").slice(0, 10) || undefined, currency: String(inv?.currency || "PLN"),
    seller_name: String(cp.name || ""), seller_tax_no: String(cp.taxNo || cp.nip || ""), buyer_name: us.name, buyer_tax_no: us.nip,
    positions: [{ name: `Purchase — invoice ${String(inv?.number || "")}`, quantity: 1, total_price_gross: gross, tax: [0, 5, 8, 23].includes(rate) ? rate : "np" }] } };
}
export async function registerExpense(payload: any): Promise<FktResult<any>> { return fktCall("expense", {}, payload); }

// ── Tolerant mapping of a Fakturownia invoice JSON to the shapes the ERP uses ─
export interface MappedInvoice {
  correctedFktId?: any;   // v7.34.0 (CN-1)
  buyerAddr?: { street?: string; postcode?: string; city?: string; country?: string };    // v6.99.41 (ADDR-4)
  sellerAddr?: { street?: string; postcode?: string; city?: string; country?: string };
  fktId: any;
  number: string;
  kind: string;
  income: boolean;
  issueDate: string;
  sellDate: string;
  dueDate: string;
  sellerName: string;
  sellerTaxNo: string;
  buyerName: string;
  buyerTaxNo: string;
  netTotal: number;
  grossTotal: number;
  currency: string;
  exchangeRate: number;   // v7.26.3 (A-INV-3 / FZ-06): the rate printed on the invoice (0 when Fakturownia sends none)
  paid: boolean;
  paidAmount: number;
  status: string;
  description: string;
  oid: string;
  ksefNo: string;
  paymentMethod?: string; dueFromDays?: boolean;   // v7.56.0 / v7.57.0
  positions?: Array<{ name: string; quantity: number; unit: string; netPrice?: number; grossTotal?: number; vatRate?: any }>;   // v7.52.0
}

function num(v: any): number { return parseNum(v); }   // v7.22.2 (FZ-22)
function str(v: any): string { return v === null || v === undefined ? "" : String(v); }

export function mapInvoice(raw: any): MappedInvoice {
  // v7.26.0 (A-INV-1): the gross as Fakturownia gives it; when it gives none, net + VAT — never the net alone
  const g0 = raw?.price_gross ?? raw?.gross_price ?? raw?.total_price_gross; const t0 = raw?.price_tax ?? raw?.tax_price;
  const gross = g0 != null && String(g0).trim() !== "" ? num(g0) : (t0 != null && String(t0).trim() !== "" ? num(raw?.price_net ?? raw?.net_price ?? raw?.total_price_net) + num(t0) : 0);
  const paidAmount = num(raw?.paid ?? raw?.paid_price);
  const statusStr = str(raw?.status).toLowerCase();
  return {
    fktId: raw?.id,
    number: str(raw?.number),
    kind: str(raw?.kind || "vat"),
    correctedFktId: raw?.invoice_id ?? raw?.from_invoice_id ?? null,   // v7.34.0 (CN-1): a correction names the invoice it corrects
    income: raw?.income === undefined ? true : (String(raw.income) === "1" || raw.income === true || raw.income === 1),
    issueDate: str(raw?.issue_date).slice(0, 10),
    sellDate: str(raw?.sell_date).slice(0, 10),
    // v7.56.0 (DUE-1, owner 30 Oct: "the system does not read the due dates correctly"): Fakturownia's date, else its NUMBER OF DAYS
    // ('payment_to_kind') counted from the issue date; else empty (the company's terms then apply, marked as such)
    dueDate: (() => { const d = str(raw?.payment_to).slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; const k = Number(str(raw?.payment_to_kind)); const iss = str(raw?.issue_date).slice(0, 10);
      if (isFinite(k) && k >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(iss)) { const [y, m, dd] = iss.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1, dd + k)); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`; }
      return ""; })(),
    paymentMethod: paymentMethodFrom(raw?.payment_type),   // v7.57.0 (PAY-1): card stays card
    sellerName: str(raw?.seller_name),
    sellerTaxNo: str(raw?.seller_tax_no),
    buyerName: str(raw?.buyer_name),
    buyerTaxNo: str(raw?.buyer_tax_no),
    // v6.99.41 (ADDR-4): an imported invoice brings the buyer's address as parts — used when a party is created from it
    buyerAddr: { street: str(raw?.buyer_street), postcode: str(raw?.buyer_post_code), city: str(raw?.buyer_city), country: str(raw?.buyer_country) },
    sellerAddr: { street: str(raw?.seller_street), postcode: str(raw?.seller_post_code), city: str(raw?.seller_city), country: str(raw?.seller_country) },
    netTotal: num(raw?.price_net ?? raw?.net_price ?? raw?.total_price_net),
    grossTotal: gross,
    currency: str(raw?.currency || "PLN").toUpperCase(),
    exchangeRate: num(raw?.exchange_rate ?? raw?.exchange_currency_rate ?? raw?.currency_exchange_rate),
    // "paid" in Fakturownia is the paid AMOUNT; status "paid" is authoritative.
    paid: statusStr === "paid" || (gross > 0 && paidAmount >= gross),
    paidAmount,
    status: str(raw?.status),
    description: str(raw?.description),
    oid: str(raw?.oid),
    ksefNo: str(raw?.ksef_number ?? raw?.ksef_no ?? raw?.ksef_reference_number),
    // v7.52.0 (PL-1 prerequisite, owner approved 29 Oct): the invoice's lines — with their quantity and unit, so a sale's kilos are known
    positions: Array.isArray(raw?.positions) ? raw.positions.map((p: any) => ({ name: str(p?.name), quantity: Number(String(p?.quantity ?? "").replace(",", ".")) || 0, unit: str(p?.quantity_unit), netPrice: Number(p?.price_net) || undefined, grossTotal: Number(p?.total_price_gross) || undefined, vatRate: p?.tax })) : [],
  };
}


