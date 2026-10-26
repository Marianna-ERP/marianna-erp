import { localTodayISO } from "./dates";
// ─────────────────────────────────────────────────────────────────────────────
// bankReconciliation.domain.ts — v6.67.0 (D-33)
//
// Owner rulings (2026-08-21): CSV imports; ALWAYS one-click confirm (never
// auto-post); RECEIVABLES first; matching tolerance ±0.05 in any currency.
//
// Built against the owner's real August statements from both banks:
//   • PKO "advanced" export — comma-quoted, header row, dot decimals, mixed
//     currencies in one file, pipe-packed "Operation data" field, and titles
//     that WRAP so invoice numbers arrive broken by spaces mid-number
//     ("PBG/ 004897/2026/06"). Idempotency: the bank's Transaction identifier.
//   • Santander export — semicolon-separated, no header (row 1 is the account
//     card), dd-mm-yyyy dates, comma decimals, a per-file sequence number.
//     Idempotency: account + sequence + date + amount.
//
// Nothing here touches invoices directly. The output of a confirmed match is a
// standard PAYMENT EVENT (payments.domain), carrying source `bank:{lineId}` so
// re-importing the same statement can never double-post.
// ─────────────────────────────────────────────────────────────────────────────

export interface BankLine {
  id: string;                 // idempotency key — see per-format notes above
  date: string;               // ISO yyyy-mm-dd
  amount: number;             // signed; credit > 0
  currency: string;
  counterparty: string;
  counterpartyAccount: string;
  title: string;
  account: string;            // OUR account (digits only)
  raw?: string;
}

export interface ParsedStatement {
  format: "PKO" | "SANTANDER" | "UNKNOWN";
  account: string;
  currency: string;           // account currency when the file states one ("" for mixed/per-line)
  lines: BankLine[];
  skipped: number;            // unparseable rows
}

const num = (v: any): number => {
  const s = String(v ?? "").replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
};
const digits = (v: any) => String(v || "").replace(/\D/g, "");
const isoFrom = (v: string): string => {
  const s = String(v || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
};

/** Minimal CSV row splitter that respects double quotes (PKO format). */
function splitQuoted(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === "," && !inQ) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parsePKO(text: string): ParsedStatement {
  const rows = text.split(/\r?\n/).filter(r => r.trim());
  const lines: BankLine[] = [];
  let skipped = 0, account = "";
  rows.slice(1).forEach(row => {
    const cols = splitQuoted(row);
    if (cols.length < 6) { skipped++; return; }
    const [opDate, , data, opType, amount, currency] = cols;
    const kv: Record<string, string> = {};
    String(data).split("|").forEach(part => {
      const i = part.indexOf(":");
      if (i > 0) kv[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    });
    const own = digits(kv["Account"]);
    if (own) account = account || own;
    const txid = kv["Transaction identifier"] || "";
    if (!txid) { skipped++; return; }
    lines.push({
      id: `pko:${own || account}:${txid}`,
      date: isoFrom(opDate),
      amount: num(amount),
      currency: String(currency || "PLN").toUpperCase(),
      counterparty: kv["Counterparty name and address"] || (opType || ""),
      counterpartyAccount: digits(kv["Counterparty account"]),
      title: kv["Title"] || "",
      account: own || account,
      raw: row,
    });
  });
  return { format: "PKO", account, currency: "", lines, skipped };
}

function parseSantander(text: string): ParsedStatement {
  const rows = text.split(/\r?\n/).filter(r => r.trim());
  let account = "", currency = "";
  const lines: BankLine[] = [];
  let skipped = 0;
  rows.forEach((row, idx) => {
    const cols = row.split(";");
    if (idx === 0 || String(cols[2] || "").trim().startsWith("'")) {
      // account card row: …;'IBAN;owner;CUR;…
      account = digits(cols[2]) || account;
      currency = String(cols[4] || currency || "PLN").toUpperCase();
      return;
    }
    if (cols.length < 7) { skipped++; return; }
    const [d1, , title, cpty, cptyAcc, amount, balance, seq] = cols;
    lines.push({
      id: `san:${account}:${String(seq || "").trim() || idx}:${isoFrom(d1)}:${String(amount).trim()}:${String(balance).trim()}`,
      date: isoFrom(d1),
      amount: num(amount),
      currency,
      counterparty: String(cpty || "").trim(),
      counterpartyAccount: digits(cptyAcc),
      title: String(title || "").trim(),
      account,
      raw: row,
    });
  });
  return { format: "SANTANDER", account, currency, lines, skipped };
}

export function parseBankCSV(text: string): ParsedStatement {
  const head = String(text || "").slice(0, 200);
  if (/^"Operation date"/i.test(head.trim())) return parsePKO(text);
  if (head.includes(";") && /;'?\s*\d{2}\s?\d{4}/.test(head)) return parseSantander(text);
  if (head.includes(";")) return parseSantander(text);
  return { format: "UNKNOWN", account: "", currency: "", lines: [], skipped: 0 };
}

// ── MATCHING ──────────────────────────────────────────────────────────────────

export interface MatchSuggestion {
  line: BankLine;
  direction?: "receivable" | "payable";
  rank: "NUMBER" | "AMOUNT+PARTY" | "AMOUNT" | "NONE" | "ALREADY" | "IGNORED";
  invoiceId: any | null;
  invoiceNumber?: string;
  candidates: Array<{ id: any; number: string; outstanding: number; counterparty: string }>;
  reason: string;
}

/** Whitespace-proof haystack: bank titles WRAP mid-number ("PBG/ 004897/…"),
 *  so both the title and every invoice number are compared with ALL whitespace
 *  removed, case-insensitively. */
const squash = (v: any) => String(v || "").toLowerCase().replace(/\s+/g, "");

// v6.99.130 (AUD-24): the words every company name carries never make a match — "Spółka", "Handel", "Trans", "Agro"… count for nothing
const GENERIC_NAME_WORDS = new Set(["spółka", "spolka", "jawna", "akcyjna", "cywilna", "komandytowa", "firma", "handel", "handlowa", "handlowe", "handlowo", "usługowa", "uslugowa", "usługi", "uslugi", "trans", "transport", "logistics", "logistyka", "agro", "fruit", "fruits", "owoce", "warzywa", "group", "grupa", "gmbh", "limited", "company", "export", "import", "hurt", "sprzedaż", "sprzedaz", "przedsiębiorstwo", "przedsiebiorstwo", "produkcyjno"]);
const nameTokens = (v: any) => String(v || "").toLowerCase().replace(/[^a-ząćęłńóśźż0-9 ]/gi, " ").split(/\s+/).filter(t => t.length >= 4 && !GENERIC_NAME_WORDS.has(t));
function partyOverlap(a: any, b: any): boolean {
  const ta = nameTokens(a), tb = new Set(nameTokens(b));
  return ta.some(t => tb.has(t));
}

export function appliedBankSources(invoices: any[]): Set<string> {
  const out = new Set<string>();
  (invoices || []).forEach(i => (i.payments || []).forEach((p: any) => { if (String(p.source || "").startsWith("bank:")) out.add(String(p.source)); }));
  return out;
}

/** Receivables-first matcher (owner ruling). Credit lines only; every match is a
 *  SUGGESTION — posting always takes the user's one-click confirm. */
/** v7.34.0 (CN-1, owner 26 Oct): an invoice's OPEN amount — its gross, less its credit notes, plus its debit notes, less what is paid — so a
 *  payment of "invoice − credit note" matches. Notes count when they are not cancelled. */
export function openAmountWithNotes(i: any, notes: any[] = []): number {
  const mine = (notes || []).filter((n: any) => n && n.invoiceId != null && String(n.invoiceId) === String(i?.id) && !/Cancelled/i.test(String(n.status || "")));
  const adj = mine.reduce((s: number, n: any) => s + (String(n.noteType).toUpperCase() === "DEBIT" ? 1 : -1) * (Number(n.amount) || 0), 0);
  return Math.round(((Number(i?.grossAmount) || 0) + adj - (Number(i?.paidAmount) || 0)) * 100) / 100;
}
export function matchBankLines(lines: BankLine[], invoices: any[], opts?: { tolerance?: number; ownNames?: string[]; notes?: any[] }): MatchSuggestion[] {
  const tol = opts?.tolerance ?? 0.05;   // owner ruling: ±0.05 in ANY currency
  const ownNames = (opts?.ownNames || ["MARIANNA", "HAZEM OSMAN"]).map(squash);
  const applied = appliedBankSources(invoices);
  const outstandingOf = (i: any) => openAmountWithNotes(i, opts?.notes || []);   // v7.34.0 (CN-1): net of the invoice's notes
  // v6.87.0 (owner ruling, 5 Sept): BOTH directions. A credit line settles a
  // RECEIVABLE (our sales invoice); a debit line settles a PAYABLE (a supplier's,
  // carrier's or forwarder's cost invoice). Pro-formas never match. Same ranking.
  const openAll = (invoices || []).filter(i =>
    (i.kind === "SALES" || i.kind === "COST") && !i.isProforma && i.paymentStatus !== "Cancelled" && i.paymentStatus !== "Draft" && outstandingOf(i) > 0.005);

  return (lines || []).map(line => {
    const base: any = { line, candidates: [] as any[], direction: line.amount > 0 ? "receivable" : "payable" };
    if (applied.has(`bank:${line.id}`)) return { ...base, rank: "ALREADY" as const, invoiceId: null, reason: "Already recorded from a previous import of this statement." };
    if (!(Math.abs(line.amount) > 0)) return { ...base, rank: "IGNORED" as const, invoiceId: null, reason: "Zero-amount line." };
    const cptySq = squash(line.counterparty);
    if (ownNames.some(n => n && cptySq.includes(n))) return { ...base, rank: "IGNORED" as const, invoiceId: null, reason: "Own-account / intra-company transfer." };
    const direction: "receivable" | "payable" = line.amount > 0 ? "receivable" : "payable";
    const open = openAll.filter(i => direction === "receivable" ? i.kind === "SALES" : i.kind === "COST");
    const amt = Math.abs(line.amount);

    const sameCur = open.filter(i => String(i.currency || "PLN").toUpperCase() === line.currency);
    const titleSq = squash(line.title);

    // ① the transfer title quotes the invoice number (whitespace-proof)
    // v6.99.119 (AUD-22): a whole-token match — "1/07/2026" must not be found inside "71/07/2026" (that paid invoice was suggested for a fresh transfer)
    const byNumber = sameCur.filter(i => { const nsq = squash(i.number); if (nsq.length < 4) return false; const idx = titleSq.indexOf(nsq); if (idx < 0) return false; const before = titleSq[idx - 1], after = titleSq[idx + nsq.length]; return !(before && /[0-9]/.test(before)) && !(after && /[0-9]/.test(after)); });
    if (byNumber.length === 1) {
      const i = byNumber[0];
      return { ...base, rank: "NUMBER" as const, invoiceId: i.id, invoiceNumber: i.number, reason: `Transfer title quotes ${i.number}.` };
    }
    if (byNumber.length > 1) {
      return { ...base, rank: "NONE" as const, invoiceId: null, reason: "Title quotes several invoices — split the amount manually.",
        candidates: byNumber.map(i => ({ id: i.id, number: i.number, outstanding: outstandingOf(i), counterparty: i.counterparty?.name || "" })) };
    }

    // ② exact outstanding (±tolerance) + counterparty name overlap
    const byAmountParty = sameCur.filter(i => Math.abs(outstandingOf(i) - amt) <= tol && partyOverlap(line.counterparty, i.counterparty?.name));
    if (byAmountParty.length === 1) {
      const i = byAmountParty[0];
      return { ...base, rank: "AMOUNT+PARTY" as const, invoiceId: i.id, invoiceNumber: i.number, reason: `Amount equals the outstanding of ${i.number} and the payer matches ${i.counterparty?.name}.` };
    }

    // ③ unique amount match without a name
    const byAmount = sameCur.filter(i => Math.abs(outstandingOf(i) - amt) <= tol);
    if (byAmount.length === 1) {
      const i = byAmount[0];
      return { ...base, rank: "AMOUNT" as const, invoiceId: i.id, invoiceNumber: i.number, reason: `Amount equals the outstanding of ${i.number} (payer name not matched — check before confirming).` };
    }

    return { ...base, rank: "NONE" as const, invoiceId: null, reason: direction === "payable" && !sameCur.length ? "Debit with no open payable in this currency — a bank charge, tax or a cost not yet invoiced." : "No confident match — pick the invoice manually.",
      candidates: sameCur.map(i => ({ id: i.id, number: i.number, outstanding: outstandingOf(i), counterparty: i.counterparty?.name || "" }))
        .sort((a, b) => Math.abs(a.outstanding - line.amount) - Math.abs(b.outstanding - line.amount)).slice(0, 8) };
  });
}

/** The payment event a confirmed line produces (partial payments accumulate naturally). */
export function bankPaymentEvent(line: BankLine): { date: string; amount: number; method: string; note: string; source: string } {
  return {
    date: /^\d{4}-\d{2}-\d{2}/.test(String(line?.date || "")) ? String(line.date).slice(0, 10) : localTodayISO(),   // v6.99.146 (AUD-48): a CSV line without a date books today, not "undefined"
    amount: Math.round(Math.abs(Number(line?.amount) || 0) * 100) / 100,   // v6.87.0: debit lines settle payables
    method: "Bank transfer",
    note: `Bank ${String(line?.account || "").slice(-4)}: ${String(line?.counterparty || "").slice(0, 60)}${line.title ? " — " + String(line.title).slice(0, 80) : ""}`,
    source: `bank:${line.id}`,
  };
}


// ── v6.68.0 (F-4): BANK ACCOUNTS REGISTRY ─────────────────────────────────────
// ── v7.26.5 (A-INV-5, owner 17 Oct): ONE BANK PAYMENT, SEVERAL INVOICES ─────────────────────────────────────────────────────
// A supplier is paid for several invoices in one transfer, and a client pays several invoices at once. A bank line can be split over
// the open invoices of its direction and currency: the ones its title quotes (in the order quoted), else the payer's invoices whose
// open amounts add up to it (the fewest, oldest first), else the payer's oldest open invoices in turn. What is left stays on the line
// (recorded as an advance, if wanted). Each invoice gets its share as a payment from that bank line — the line counts as recorded.
const r2b = (v: number) => Math.round(v * 100) / 100;
export function splitBankLine(line: BankLine, invoices: any[], opts?: { tolerance?: number; notes?: any[] }): { allocations: Array<{ invoiceId: any; number: string; amount: number; outstanding: number }>; remainder: number; how: "title" | "exact" | "oldest" | "none"; open: any[] } {
  const tol = opts?.tolerance ?? 0.05; const amt = r2b(Math.abs(Number(line?.amount) || 0)); const kind = Number(line?.amount) > 0 ? "SALES" : "COST";
  const outstandingOf = (i: any) => openAmountWithNotes(i, opts?.notes || []);   // v7.34.0 (CN-1): net of the invoice's notes
  const open = (invoices || []).filter((i: any) => i && i.kind === kind && !i.isProforma && i.paymentStatus !== "Cancelled" && i.paymentStatus !== "Draft" && outstandingOf(i) > 0.005 && String(i.currency || "PLN").toUpperCase() === String(line?.currency || "PLN").toUpperCase())
    .sort((a: any, b: any) => String(a.issueDate || "").localeCompare(String(b.issueDate || "")));
  const fill = (list: any[]) => { let left = amt; const al: any[] = []; list.forEach((i: any) => { if (left <= 0.005) return; const o = outstandingOf(i); const a = r2b(Math.min(o, left)); al.push({ invoiceId: i.id, number: String(i.number || ""), amount: a, outstanding: o }); left = r2b(left - a); }); return { al, left }; };
  const titleSq = squash(line?.title);
  const quoted = open.map((i: any) => ({ i, at: squash(i.number).length >= 4 ? titleSq.indexOf(squash(i.number)) : -1 })).filter(x => x.at >= 0).sort((a, b) => a.at - b.at).map(x => x.i);
  if (quoted.length >= 2) { const f = fill(quoted); return { allocations: f.al, remainder: f.left, how: "title", open }; }
  const party = open.filter((i: any) => partyOverlap(line?.counterparty, i.counterparty?.name)).slice(0, 12);
  for (let size = 1; size <= Math.min(6, party.length); size++) {   // the fewest invoices that add up to the line, oldest first
    const idx: number[] = []; let found: any[] | null = null;
    const walk = (start: number, sum: number) => { if (found) return; if (idx.length === size) { if (Math.abs(sum - amt) <= tol) found = idx.map(k => party[k]); return; } for (let k = start; k < party.length; k++) { idx.push(k); walk(k + 1, sum + outstandingOf(party[k])); idx.pop(); if (found) return; } };
    walk(0, 0);
    if (found) return { allocations: (found as any[]).map((i: any) => ({ invoiceId: i.id, number: String(i.number || ""), amount: outstandingOf(i), outstanding: outstandingOf(i) })), remainder: 0, how: "exact", open };
  }
  if (party.length) { const f = fill(party); return { allocations: f.al, remainder: f.left, how: "oldest", open }; }
  return { allocations: [], remainder: amt, how: "none", open };
}
/** One invoice's share of a split bank line, as its payment (the line's source, so a re-import never posts it again). */
export function bankShareEvent(line: BankLine, amount: number, k: number, n: number): { date: string; amount: number; method: string; note: string; source: string } {
  const e = bankPaymentEvent(line); return { ...e, amount: r2b(Math.abs(Number(amount) || 0)), note: `${e.note} — part ${k} of ${n}` };
}

export interface BankAccount {
  id: any; bank: string; accountDigits: string; currency: string;
  lastImportDate: string; lastKnownBalance: number | null; label?: string;
}

/** Every imported statement registers/updates its account. Santander statements
 *  carry a running balance (first data row = most recent); PKO's advanced export
 *  doesn't, so its balance stays whatever was last known / manually set. */
export function upsertBankAccountFromStatement(accounts: BankAccount[], parsed: ParsedStatement, deps: { nextId: () => any; todayISO: () => string }): BankAccount[] {
  if (!parsed?.account) return accounts || [];
  const bankName = parsed.format === "PKO" ? "PKO BP" : parsed.format === "SANTANDER" ? "Santander" : "Bank";
  const latestBalance = parsed.format === "SANTANDER" && parsed.lines.length
    ? (() => { const raw = String(parsed.lines[0].raw || "").split(";"); const v = parseFloat(String(raw[6] || "").replace(",", ".")); return isFinite(v) ? v : null; })()
    : null;
  const existing = (accounts || []).find(a => a.accountDigits === parsed.account);
  if (existing) {
    return (accounts || []).map(a => a.accountDigits === parsed.account
      ? { ...a, currency: parsed.currency || a.currency, lastImportDate: deps.todayISO(), lastKnownBalance: latestBalance ?? a.lastKnownBalance }
      : a);
  }
  return [...(accounts || []), {
    id: deps.nextId(), bank: bankName, accountDigits: parsed.account,
    currency: parsed.currency || "mixed", lastImportDate: deps.todayISO(),
    lastKnownBalance: latestBalance, label: `${bankName} …${parsed.account.slice(-4)}`,
  }];
}
