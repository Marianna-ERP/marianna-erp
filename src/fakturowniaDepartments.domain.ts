// ── FAKTUROWNIA DEPARTMENTS = BANK ACCOUNTS (v6.75.0) ───────────────────────
// Owner's account carries SEVEN departments across TWO companies, each holding
// one bank account in one currency:
//
//   Marianna EUR PKO     EUR   (MAIN)      Marianna PLN ERSTE   PLN
//   Marianna EUR ERSTE   EUR               Marianna PLN PKO     PLN
//   Marianna EUR WISE    EUR               Marianna USD PKO     USD
//   Marianna SLO EUR PKO EUR   — a SEPARATE LEGAL ENTITY (tax id SI46357335)
//
// Fakturownia's own guidance is that several bank accounts are handled by
// several departments, and the invoice chooses one.
//
// WHAT WENT WRONG: v6.66.0 stopped sending seller fields — correctly, because
// sending seller_name made Fakturownia try to CREATE a department, which the
// account's security level rightly blocks as an invoice-fraud vector. But the
// note left behind assumed "a single-company account applies its default
// department automatically". This account is not single-company. So EVERY
// pushed invoice took the default, Marianna EUR PKO — meaning a PLN invoice
// printed a EUR account number, and a USD invoice did too. The client then has
// wrong payment details on a document that has already reached KSeF.
//
// THE FIX: send `department_id`, which SELECTS an existing department rather
// than creating one — so it is safe where seller_name was not.
//
// Note that currency alone cannot decide: there are three EUR accounts. The
// currency narrows the choice; a stated default per currency settles it; and an
// invoice may override. Nothing is guessed when the answer is ambiguous.

export interface FktDepartment {
  id: number | string;      // Fakturownia's own department id — the value sent
  name: string;             // "Marianna EUR PKO"
  currency: string;         // "EUR"
  bankAccount?: string;
  taxNo?: string;           // a different tax id means a different legal entity
  legalName?: string;       // identical across departments of one company
  isMain?: boolean;
}

const S = (v: any) => String(v ?? "").trim();
const CUR = (v: any) => S(v).toUpperCase() || "PLN";

/** Departments that can issue in this currency. */
export function departmentsForCurrency(all: FktDepartment[], currency: any): FktDepartment[] {
  const c = CUR(currency);
  return (all || []).filter(d => CUR(d.currency) === c);
}

export interface DepartmentChoice {
  department: FktDepartment | null;
  /** why this one — shown to the user before they push */
  reason: string;
  /** true when the user must choose: several candidates and no stated default */
  ambiguous: boolean;
}

/**
 * Which department (bank account) an invoice should be issued from.
 *
 * Order: an explicit choice on the invoice · the stated default for its
 * currency · the only candidate in that currency · otherwise ambiguous.
 *
 * `taxNo` scopes to one legal entity — the Slovenian company must never issue
 * on the Polish company's account, whatever the currency.
 */
export function chooseDepartment(
  invoice: any,
  all: FktDepartment[],
  defaults: Record<string, any> = {},
): DepartmentChoice {
  const currency = CUR(invoice?.currency);
  const entity = S(invoice?.sellerTaxNo);
  let pool = departmentsForCurrency(all, currency);
  if (entity) {
    const scoped = pool.filter(d => S(d.taxNo) === entity);
    if (scoped.length) pool = scoped;
  }

  const explicit = invoice?.fakturowniaDepartmentId;
  if (explicit != null && S(explicit)) {
    const hit = (all || []).find(d => S(d.id) === S(explicit));
    if (hit) {
      return CUR(hit.currency) === currency
        ? { department: hit, reason: `Chosen on this invoice — ${hit.name}`, ambiguous: false }
        : { department: hit, reason: `Chosen on this invoice — ${hit.name}, but its account is in ${hit.currency} and the invoice is in ${currency}. Check before sending.`, ambiguous: true };
    }
  }

  const preferred = defaults[currency];
  if (preferred != null && S(preferred)) {
    const hit = pool.find(d => S(d.id) === S(preferred)) || (all || []).find(d => S(d.id) === S(preferred));
    if (hit) return { department: hit, reason: `Default account for ${currency} — ${hit.name}`, ambiguous: false };
  }

  if (pool.length === 1) {
    return { department: pool[0], reason: `The only ${currency} account — ${pool[0].name}`, ambiguous: false };
  }
  if (pool.length > 1) {
    return {
      department: null, ambiguous: true,
      reason: `${pool.length} accounts can issue in ${currency} (${pool.map(d => d.name).join(", ")}). Choose one, or set a default for ${currency} in Settings.`,
    };
  }
  return {
    department: null, ambiguous: true,
    reason: `No Fakturownia account is set up for ${currency}. Without one the invoice would carry the account of whichever department Fakturownia treats as its main — which is how a ${currency} invoice ends up printing a EUR account number.`,
  };
}

/** Blocks the push when the account cannot be settled. Wrong payment details on
 *  a document that has reached KSeF are corrected only by another document. */
export function departmentBlockReason(choice: DepartmentChoice): string {
  if (choice.department && !choice.ambiguous) return "";
  return choice.reason;
}

/** Map Fakturownia's /departments.json rows onto our shape. */
export function mapDepartments(raw: any[]): FktDepartment[] {
  return (raw || []).map((d: any) => {
    // v6.76.0: the LABEL is the shortcut ("Marianna EUR PKO"), not `name` —
    // `name` is the LEGAL name and is identical on every department
    // ("Marianna Hazem Osman"). Reading `name` first made all seven accounts
    // display the same text, and since that text contains no currency they all
    // fell back to PLN. Two columns on Fakturownia's own page; we were reading
    // the wrong one.
    const label = S(d?.shortcut || d?.department_name || d?.name || `Department ${d?.id}`);
    const account = S(d?.bank_account || d?.bank_account_number || d?.account_number);
    // Currency, in order of trust: an explicit field · the currency named in the
    // label · the currency named on the account. NEVER defaulted to PLN — an
    // account whose currency we cannot read is left BLANK so the user sets it,
    // because a wrong guess here is a wrong account number on a real invoice.
    const named = (S(label).match(/\b(EUR|PLN|USD|GBP|CHF|CZK|SEK)\b/i) || [])[1]
      || (S(account).match(/\b(EUR|PLN|USD|GBP|CHF|CZK|SEK)\b/i) || [])[1];
    return {
      id: d?.id,
      name: label,
      legalName: S(d?.name),
      currency: d?.currency ? CUR(d.currency) : (named ? CUR(named) : ""),
      bankAccount: account,
      taxNo: S(d?.tax_no),
      isMain: d?.main === true || d?.main === "1",
    };
  }).filter(d => d.id != null);
}

/** Apply the currencies the user set by hand in Settings. Parsing a label is
 *  guesswork; seven rows set once is not. The stored map wins over anything
 *  derived, so a correction always sticks. */
export function applyDepartmentCurrencies(all: FktDepartment[], overrides: Record<string, any>): FktDepartment[] {
  return (all || []).map(d => {
    const o = (overrides || {})[String(d.id)];
    return o ? { ...d, currency: CUR(o) } : d;
  });
}

/** Accounts whose currency is still unknown — they cannot be chosen until it is
 *  set, and saying so is better than silently treating them as PLN. */
export function departmentsNeedingCurrency(all: FktDepartment[]): FktDepartment[] {
  return (all || []).filter(d => !S(d.currency));
}

/** Distinct legal entities in the department list — a different tax id is a
 *  different company, and its invoices must never issue on the other's account. */
export function entitiesOf(all: FktDepartment[]): string[] {
  return Array.from(new Set((all || []).map(d => S(d.taxNo)).filter(Boolean)));
}
