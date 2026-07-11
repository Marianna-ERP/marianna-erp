# Marianna ERP — Invoicing Module · Design Spec (for review, no code yet)

**Status:** Draft for review · **Targets:** v6.18 (Invoicing) then v6.19 (Cost Allocation)
**Builds on:** v6.17.3 (stable ids + structured `soRef`)

This spec describes a new **top-level Invoicing module** that becomes the single source
of truth for every invoice in and out, plus credit/debit notes. It consolidates four
partial representations that exist today and is reachable by Operations/Admin **without**
entering Finance (so P/L stays protected). Read it, mark anything that doesn't match how
Marianna actually works, and we lock the data model before any code.

---

## 1. Why this module exists

Today invoices live in four disconnected places:
- **Sales invoices** → stored as `pendingInvoices` on each Sales Order (interim, never promoted).
- **Warehouse invoices** → `warehouseInvoices`, handled in Finance → Warehouse charges.
- **Cost invoices** → imported into `operationalCosts` (those with an `invoiceNo`).
- **Receivables/Payables** → the ledger *derives* lines from all of the above; stores only paid-flags.

The result: no single list of "every invoice," no consistent numbering/status, and the
ledger doing double duty. The Invoicing module makes one invoice model that all of these
become, and the ledger + P/L then read from it instead of deriving it.

---

## 2. Access & placement (decided)

- **Own top-level nav item** ("Invoices"), beside Finance — not a Finance tab.
- **Operations / Admin / Sales / FD / GM can all open it.** Operations & Admin see BOTH
  sales and cost invoices and may issue credit/debit notes on either side.
- Rationale (decided): deal-level gross margin is inferable from invoices anyway, but the
  *true* net margin depends on monthly shared costs + overheads that only resolve in
  Finance — so the precise P/L stays protected by living in Finance, not by hiding invoices.
- **Finance stays role-gated** as today (P/L + allocation results = FD/GM only).

---

## 3. The unified invoice model

One record type for every invoice, in or out. Proposed shape (fields, not code):

| Field | Meaning |
|---|---|
| `id` | stable id (via `ids.ts`) |
| `kind` | `SALES` (we issue, receivable) · `COST` (we receive, payable) |
| `costScope` | for COST only: `SHIPMENT` · `MONTHLY_SHARED` · `OVERHEAD` (drives allocation — see §6) |
| `category` | `SINV` (sales) · `PURCHASE` · `FORWARDER` · `BROKER` · `WAREHOUSE` · `TRANSPORT` · `OTHER` |
| `number` | invoice number (our series for SALES; the supplier's for COST) |
| `counterparty` | `{ id, name, nip }` snapshot (resolved by id, like PO/SO) |
| `issueDate` / `saleDate` / `dueDate` | dates; `dueDate` from payment terms |
| `currency` / `fxRate` | document currency + locked rate (via `fx.ts` default if blank) |
| `netAmount` / `vatRate` / `vatAmount` / `grossAmount` | money in document currency |
| `netPLN` / `grossPLN` | PLN equivalents (for the ledger & P/L) |
| `periodFrom` / `periodTo` | for MONTHLY_SHARED (broker/warehouse) — the service period |
| `links[]` | `[{ type: "SO"|"PO"|"Shipment"|"Lot", number }]` — what this invoice relates to |
| `paymentStatus` | `Draft · Issued · Sent · Partially paid · Paid · Overdue · Cancelled` |
| `paidAmount` | running total paid |
| `notes` / `attachment` | free text + optional PDF reference |
| `creditNotes[]` | linked credit/debit note ids (see §5) |
| `allocation` | for COST: how its cost was split (see §6) — written by the allocation engine |
| `fakturownia` | `{ exported: bool, ref }` — handoff marker |
| `createdAt` / `createdBy` | audit |

**Migration of existing data (no data loss):**
- SO `pendingInvoices` → `SALES` invoices, `links` includes the SO. The SO keeps showing
  "invoice issued" by reading the Invoicing module instead of its own array.
- `warehouseInvoices` → `COST` / `WAREHOUSE`, `costScope: MONTHLY_SHARED`.
- `operationalCosts` with an `invoiceNo` → `COST` (category per supplier type), overhead-type
  ones get `costScope: OVERHEAD`.
- Existing `creditNotes` → §5 model (already close).

---

## 4. What the module does (screens)

**4.1 Invoice list (landing).** One table of all invoices. Columns: direction arrow,
category badge, number, counterparty, issue/due dates, gross (+PLN), status, links, flags
(📎 attachment, ↩ credit note). Filters: direction (receivable/payable), category, status,
date range, search. KPI strip: receivable open, payable open, overdue, due within 7 days.

**4.2 Create / edit invoice.**
- **Sales invoice:** usually born from an SO becoming Shipped (the existing modal), but can
  also be created here directly. Promotes the old `pendingInvoices` flow into a real record.
- **Cost invoice:** record a supplier/forwarder/broker/warehouse invoice — either by hand
  or via the existing **Fakturownia import** (XLS/CSV or live API). On entry you pick the
  **cost scope** (§6), which decides how it later allocates.

**4.3 Invoice detail.** Full document view, linked SO/PO/shipment/lots, payment history,
credit/debit notes against it, PDF preview, Fakturownia handoff button.

**4.4 Record payment.** Mark paid / partially paid (moves the "paid flag" job out of the
ledger and onto the invoice itself, which the ledger then reads).

---

## 5. Credit & debit notes

Extends today's credit-note model (which already has `direction`, `partyName`, `category`,
`relatedRef`, `amount`, `currency`, `fxRate`, `status`, `reason`).

- **Credit note** = reduces an amount. **Outgoing** (we credit a client, reduces a
  receivable) or **incoming** (a supplier/carrier/forwarder credits us, reduces a payable).
- **Debit note** = increases an amount / additional charge (the mirror). Same structure with
  a `noteType: CREDIT|DEBIT` flag.
- Each note **links to the invoice it adjusts** (by id now, not by a loose ref string — this
  is the soRef-style fix applied to notes), so the ledger and P/L net them correctly.
- Quality-issue-driven proposals (from Inventory) flow here to be formalised, carrying their
  suggested target (supplier / carrier / forwarder / client).

**Open question Q1:** today credit notes are a Finance tab. Do they MOVE to Invoicing
(operations can issue them — matches your requirement) or appear in BOTH? Recommend: live in
Invoicing, Finance reads them.

---

## 6. Cost allocation (the v6.19 half — specified here so the model fits)

Every COST invoice has a **scope** chosen at entry:

**6.1 `SHIPMENT` — the common case (e.g. forwarder all-in).**
One invoice tied to one shipment (possibly several containers). Splits **within** that
shipment across its containers/lots. Basis: per-container or by-kg (you pick).
No cross-shipment allocation → no moving-target P/L. This is most invoices.

**6.2 `MONTHLY_SHARED` — the genuinely shared monthly invoices.**
Covers many shipments/lots over a period (`periodFrom`/`periodTo`).
- **Broker (standalone customs agent):** basis = **per cleared container/truck** that month.
  The system counts customs clearances in the period (from lot `customs` overlays / shipment
  customs events tied to that broker) and divides the fee per event.
- **Warehouse:** basis = **kg-days** within the period (the engine that already exists).
- Re-allocation uses the replace-by-ref discipline already added in v6.17.3.

**6.3 `OVERHEAD` — salaries, rent, software.**
Never touched to a lot/SO. Stays in the operational-costs overhead pool, spread across SO
P/L by the existing `by_revenue`-type rule. Finance-only visibility.

**Open question Q2 (the one still parked):** for MONTHLY_SHARED, when only some covered lots
have sold — do we **re-split as lots sell** (already-sold lots' cost keeps changing) or
**compute once, recognise the fixed share when each lot sells** (stable per-lot cost)? This
must be decided before 6.2 is built. The Invoicing module (recording the invoice) does NOT
depend on it; only the allocation result does.

---

## 7. How other modules change

- **Sales Orders:** the "Issue Sales Invoice" modal writes a real Invoicing record instead of
  `pendingInvoices`. The SO detail reads its invoice(s) from Invoicing. (Backwards step:
  migrate existing `pendingInvoices` on load.)
- **Finance → Receivables & Payables:** stops *deriving* invoices; reads them from Invoicing.
  Keeps its job: open/overdue/paid, net position, payment tracking. Becomes a pure money lens.
- **Finance → Warehouse / Operational Costs:** the *recording* of these invoices moves to
  Invoicing; Finance keeps the *allocation results* and P/L (FD/GM only).
- **Inventory:** quality-issue credit-note proposals post into Invoicing's notes inbox.
- **Integrity checker:** add checks for invoices (orphan links, notes pointing at missing
  invoices, allocation referencing missing invoice — the WHINV check already exists).

---

## 8. Build sequence

1. **v6.18 — Invoicing module:** unified model + list/detail/create + migration of the four
   sources + credit/debit notes + payment recording + Fakturownia handoff + nav item & access.
   Ledger switches to reading from it. (Does NOT need Q2 resolved.)
2. **v6.19 — Cost Allocation engine:** scope-driven allocation (shipment / monthly-shared /
   overhead), the "per cleared unit" basis for the broker, kg-days for warehouse. (Needs Q2.)

---

## 9. Decisions — RESOLVED

- **Q1 — Credit/debit notes live in Invoicing.** Operations issue them; Finance reads them.
- **Q2 — Compute once, recognise the fixed share when each lot sells.** A monthly-shared
  invoice's per-lot share is computed ONCE against the full covered set, written to each lot,
  but only enters P/L when that lot sells. Already-sold lots' cost never moves. Unsold lots
  carry their share in inventory value until they move.
- **Q3 — Auto-transfer to Fakturownia on Send (see §10 for the verified API contract).**
- **Q4 — Edit lock at "Sent", not "Issued".** Draft = freely editable; Issued = still
  editable (catch errors before it leaves); Sent / pushed to Fakturownia = locked. A
  correction then requires a credit/debit note, not an edit.
- **Q5 — Net in PLN at each invoice's own locked `fxRate`.** Confirmed. We send `currency`
  to Fakturownia and govern by our locked PLN figures rather than their NBP `exchange_currency`.

---

## 10. Fakturownia push — verified API contract (Q3)

**Endpoint:** `POST https://{domain}.fakturownia.pl/invoices.json` with `{ api_token, invoice: {...} }`.

**Mapping SALES invoice → Fakturownia payload:**
| Fakturownia field | Source in our model |
|---|---|
| `kind` | `"vat"` |
| `number` | our SINV number (or `null` to let Fakturownia auto-number — TBD per Q3-a below) |
| `issue_date` / `sell_date` / `payment_to` | our `issueDate` / `saleDate` / `dueDate` |
| `payment_type` | from `paymentMethod` (e.g. `"transfer"`) |
| `seller_*` | Marianna (from COMPANY constant) — or omit to use Fakturownia account default |
| `buyer_name` / `buyer_tax_no` | client snapshot name + NIP |
| `buyer_company` | `true` (clients are companies — key for KSeF auto-send) |
| `currency` | our document currency |
| `positions[]` | each SO line → `{ name, quantity, quantity_unit: "kg", tax: <5/8/23>, total_price_gross }` |

**Timing:** push happens at **Send** (not Issue) — consistent with Q4's lock and with KSeF
being a "final / submit to authority" action. On success, store the returned Fakturownia
invoice id in `fakturownia.ref` and lock the record.

**KSeF (regulatory — verify applicability with the accountant):** Poland's National e-Invoice
System (KSeF) obligation for VAT payers is being phased in from Feb 2026 (we are past that
date now, so it is in active rollout). Fakturownia submits to KSeF when the request includes
`gov_save_and_send: true`, and requires `buyer_company: true`. KSeF authorisation must first
be set up inside Fakturownia's own settings (one-time, by the account owner). Design
implication: the push must support a `gov_save_and_send` toggle so invoices can flow to KSeF
where required — built ready now to avoid rework as the obligation widens.

**Sub-questions — RESOLVED:**
- **Q3-a — Fakturownia auto-numbers.** Send `number: null`; store the returned legal number
  back on our record. Our internal SINV number (if any) is for our reference only.
- **Q3-b — Token scope: assume write-capable, verify by a single live test push during build.**
  Fakturownia tokens are typically full-access (same token reads + writes), so the token used
  for the cost-invoice import very likely also creates invoices. KSeF is confirmed authorised
  in Fakturownia. The only real unknowns are browser CORS on POST and the live result — both
  to be confirmed with one test invoice, not assumed.
- **Q3-c — KSeF handled by Fakturownia for now.** Do NOT send `gov_save_and_send` from the ERP;
  the invoice lands in Fakturownia and KSeF submission stays under Fakturownia's control. Build
  the push with the flag as a single toggle (default OFF) so it can be enabled later — safety
  first, reversible.

---

## 11. Placement

Insert a new `{ key: "invoices", ... }` nav item **between `shipments` and `contacts`** in
`NAV_ITEMS`. The actual current order is: Dashboard · Finance · Purchase Orders · Inventory ·
Sales Orders · **Shipments ·** [Invoices ←new] **· Counterparties** · Settings. (Finance keeps
its current position; only the Invoices item is added, directly after Shipments and before
Counterparties, exactly as requested.)

**CORS note:** the existing read integration documents a CORS fallback (XLS/CSV) because
browser-side calls to Fakturownia can be blocked. The same applies to write: a direct
browser POST may be blocked, in which case the push needs the (deferred) backend, or a
copy-payload / manual-confirm fallback in the interim. To confirm during build.
