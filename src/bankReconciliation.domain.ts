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

const nameTokens = (v: any) => String(v || "").toLowerCase().replace(/[^a-ząćęłńóśźż0-9 ]/gi, " ").split(/\s+/).filter(t => t.length >= 4);
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
export function matchBankLines(lines: BankLine[], invoices: any[], opts?: { tolerance?: number; ownNames?: string[] }): MatchSuggestion[] {
  const tol = opts?.tolerance ?? 0.05;   // owner ruling: ±0.05 in ANY currency
  const ownNames = (opts?.ownNames || ["MARIANNA", "HAZEM OSMAN"]).map(squash);
  const applied = appliedBankSources(invoices);
  const outstandingOf = (i: any) => Math.round(((Number(i.grossAmount) || 0) - (Number(i.paidAmount) || 0)) * 100) / 100;
  const open = (invoices || []).filter(i =>
    i.kind === "SALES" && i.paymentStatus !== "Cancelled" && i.paymentStatus !== "Draft" && outstandingOf(i) > 0.005);

  return (lines || []).map(line => {
    const base = { line, candidates: [] as any[] };
    if (applied.has(`bank:${line.id}`)) return { ...base, rank: "ALREADY" as const, invoiceId: null, reason: "Already recorded from a previous import of this statement." };
    if (!(line.amount > 0)) return { ...base, rank: "IGNORED" as const, invoiceId: null, reason: "Debit/fee line — payables come in a later phase (owner ruling: receivables first)." };
    const cptySq = squash(line.counterparty);
    if (ownNames.some(n => n && cptySq.includes(n))) return { ...base, rank: "IGNORED" as const, invoiceId: null, reason: "Own-account / intra-company transfer." };

    const sameCur = open.filter(i => String(i.currency || "PLN").toUpperCase() === line.currency);
    const titleSq = squash(line.title);

    // ① the transfer title quotes the invoice number (whitespace-proof)
    const byNumber = sameCur.filter(i => { const nsq = squash(i.number); return nsq.length >= 4 && titleSq.includes(nsq); });
    if (byNumber.length === 1) {
      const i = byNumber[0];
      return { ...base, rank: "NUMBER" as const, invoiceId: i.id, invoiceNumber: i.number, reason: `Transfer title quotes ${i.number}.` };
    }
    if (byNumber.length > 1) {
      return { ...base, rank: "NONE" as const, invoiceId: null, reason: "Title quotes several invoices — split the amount manually.",
        candidates: byNumber.map(i => ({ id: i.id, number: i.number, outstanding: outstandingOf(i), counterparty: i.counterparty?.name || "" })) };
    }

    // ② exact outstanding (±tolerance) + counterparty name overlap
    const byAmountParty = sameCur.filter(i => Math.abs(outstandingOf(i) - line.amount) <= tol && partyOverlap(line.counterparty, i.counterparty?.name));
    if (byAmountParty.length === 1) {
      const i = byAmountParty[0];
      return { ...base, rank: "AMOUNT+PARTY" as const, invoiceId: i.id, invoiceNumber: i.number, reason: `Amount equals the outstanding of ${i.number} and the payer matches ${i.counterparty?.name}.` };
    }

    // ③ unique amount match without a name
    const byAmount = sameCur.filter(i => Math.abs(outstandingOf(i) - line.amount) <= tol);
    if (byAmount.length === 1) {
      const i = byAmount[0];
      return { ...base, rank: "AMOUNT" as const, invoiceId: i.id, invoiceNumber: i.number, reason: `Amount equals the outstanding of ${i.number} (payer name not matched — check before confirming).` };
    }

    return { ...base, rank: "NONE" as const, invoiceId: null, reason: "No confident match — pick the invoice manually.",
      candidates: sameCur.map(i => ({ id: i.id, number: i.number, outstanding: outstandingOf(i), counterparty: i.counterparty?.name || "" }))
        .sort((a, b) => Math.abs(a.outstanding - line.amount) - Math.abs(b.outstanding - line.amount)).slice(0, 8) };
  });
}

/** The payment event a confirmed line produces (partial payments accumulate naturally). */
export function bankPaymentEvent(line: BankLine): { date: string; amount: number; method: string; note: string; source: string } {
  return {
    date: line.date,
    amount: Math.round(line.amount * 100) / 100,
    method: "Bank transfer",
    note: `Bank ${line.account.slice(-4)}: ${String(line.counterparty).slice(0, 60)}${line.title ? " — " + String(line.title).slice(0, 80) : ""}`,
    source: `bank:${line.id}`,
  };
}
