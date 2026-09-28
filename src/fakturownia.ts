// ─── v6.8: FAKTUROWNIA / INVOICEOCEAN API CLIENT ────────────────────────────
// Thin client around the Fakturownia REST API (api_token auth, JSON).
// IMPORTANT: the token is entered by the user in Settings and lives ONLY in
// this browser's localStorage — never hard-coded, never exported with data.
// Browser CORS may block direct calls on some accounts; every caller must
// handle {ok:false, corsLikely:true} by falling back to the XLS/CSV import.



export interface FakturowniaConfig {
  subdomain: string;   // e.g. "marianna2"  → https://marianna2.fakturownia.pl
  apiToken: string;
  liveWriteEnabled?: boolean;  // v6.18.4: live invoice creation is OFF unless explicitly enabled
}

const CONFIG_KEY = "marianna-erp:v1:fakturowniaConfig";

export function readFakturowniaConfig(): FakturowniaConfig | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || !c.subdomain || !c.apiToken) return null;
    return { subdomain: String(c.subdomain).trim(), apiToken: String(c.apiToken).trim(), liveWriteEnabled: c.liveWriteEnabled === true };
  } catch { return null; }
}

export function writeFakturowniaConfig(c: FakturowniaConfig | null): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (!c) window.localStorage.removeItem(CONFIG_KEY);
    else window.localStorage.setItem(CONFIG_KEY, JSON.stringify({ subdomain: c.subdomain.trim(), apiToken: c.apiToken.trim(), liveWriteEnabled: c.liveWriteEnabled === true }));
  } catch { /* ignore */ }
}

export function fakturowniaBase(c: FakturowniaConfig): string {
  const sub = c.subdomain.replace(/^https?:\/\//, "").replace(/\.fakturownia\.pl.*$/, "").replace(/\/.*$/, "");
  return `https://${sub}.fakturownia.pl`;
}

export interface FktResult<T> { ok: boolean; data?: T; status?: number; error?: string; corsLikely?: boolean }

async function fktGet(c: FakturowniaConfig, path: string, params: Record<string, any>): Promise<FktResult<any>> {
  const url = new URL(fakturowniaBase(c) + path);
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v)); });
  url.searchParams.set("api_token", c.apiToken);
  try {
    const res = await fetch(url.toString(), { method: "GET", headers: { Accept: "application/json" } });
    if (!res.ok) {
      return { ok: false, status: res.status, error: res.status === 401 ? "Unauthorized — check the API token." : `Fakturownia answered HTTP ${res.status}.` };
    }
    return { ok: true, data: await res.json(), status: res.status };
  } catch (err: any) {
    // fetch() throws TypeError on network failure AND on CORS blocks — indistinguishable.
    return { ok: false, error: String(err?.message || err), corsLikely: true };
  }
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

export async function fetchInvoices(c: FakturowniaConfig, opts: FetchInvoicesOptions = {}): Promise<FktResult<any[]>> {
  const all: any[] = [];
  const perPage = opts.perPage || 100;
  const maxPages = opts.maxPages || 10;
  for (let page = 1; page <= maxPages; page++) {
    const r = await fktGet(c, "/invoices.json", {
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
export async function fetchDepartments(c: FakturowniaConfig): Promise<FktResult<any[]>> {
  const r = await fktGet(c, "/departments.json", { page: 1, per_page: 100 });
  if (!r.ok) return r as FktResult<any[]>;
  return { ok: true, data: Array.isArray(r.data) ? r.data : [] };
}

export async function testConnection(c: FakturowniaConfig): Promise<FktResult<{ count: number }>> {
  const r = await fktGet(c, "/invoices.json", { page: 1, per_page: 1, period: "this_month" });
  if (!r.ok) return r as any;
  return { ok: true, data: { count: Array.isArray(r.data) ? r.data.length : 0 } };
}

// ── Invoice creation (push) ──────────────────────────────────────────────────
// POST /invoices.json. `body` is the full payload object built by
// invoicing.buildFakturowniaPayload (it already contains api_token + invoice).
// Mirrors fktGet's CORS-tolerant error handling: a browser POST may be blocked by
// CORS exactly like reads, in which case corsLikely is true and the caller should
// fall back to the copy-payload / backend path.
export async function createInvoice(c: FakturowniaConfig, body: any): Promise<FktResult<any>> {
  const url = new URL(fakturowniaBase(c) + "/invoices.json");
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...body, api_token: c.apiToken }),
    });
    if (!res.ok) {
      // v6.63.0 (D-07): Fakturownia's error body NAMES the offending fields —
      // discarding it made every 422 undiagnosable ("check required fields").
      let detail = "";
      try {
        const body = await res.json();
        detail = typeof body === "string" ? body : JSON.stringify(body?.message ?? body?.errors ?? body).slice(0, 400);
      } catch { try { detail = (await res.text()).slice(0, 400); } catch {} }
      const base = res.status === 401 ? "Unauthorized — the API token may be read-only or invalid."
        : res.status === 422 ? "Fakturownia rejected the invoice data (HTTP 422)."
        : `Fakturownia answered HTTP ${res.status}.`;
      return { ok: false, status: res.status, error: detail ? `${base} Details: ${detail}` : base };
    }
    return { ok: true, data: await res.json(), status: res.status };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err), corsLikely: true };
  }
}

// ── Tolerant mapping of a Fakturownia invoice JSON to the shapes the ERP uses ─
export interface MappedInvoice {
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
  paid: boolean;
  paidAmount: number;
  status: string;
  description: string;
  oid: string;
  ksefNo: string;
}

function num(v: any): number { const x = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(x) ? x : 0; }
function str(v: any): string { return v === null || v === undefined ? "" : String(v); }

export function mapInvoice(raw: any): MappedInvoice {
  const gross = num(raw?.price_gross ?? raw?.gross_price ?? raw?.total_price_gross);
  const paidAmount = num(raw?.paid ?? raw?.paid_price);
  const statusStr = str(raw?.status).toLowerCase();
  return {
    fktId: raw?.id,
    number: str(raw?.number),
    kind: str(raw?.kind || "vat"),
    income: raw?.income === undefined ? true : (String(raw.income) === "1" || raw.income === true || raw.income === 1),
    issueDate: str(raw?.issue_date).slice(0, 10),
    sellDate: str(raw?.sell_date).slice(0, 10),
    dueDate: str(raw?.payment_to).slice(0, 10),
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
    // "paid" in Fakturownia is the paid AMOUNT; status "paid" is authoritative.
    paid: statusStr === "paid" || (gross > 0 && paidAmount >= gross),
    paidAmount,
    status: str(raw?.status),
    description: str(raw?.description),
    oid: str(raw?.oid),
    ksefNo: str(raw?.ksef_number ?? raw?.ksef_no ?? raw?.ksef_reference_number),
  };
}


