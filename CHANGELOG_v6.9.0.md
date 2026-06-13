# v6.9.0 — Financial loop closed: Receivables & Payables, sales-invoice matching

Closes the money side before Phase 2, so real-data testing exercises the full
cycle and the backend schema can be designed from a complete model.

## Finance → Receivables & Payables (new tab)
- One ledger of everything owed, pulled from existing data:
  - **Receivables** ← sales invoices issued on SOs.
  - **Payables** ← producer payouts (closed consignment settlements), warehouse
    invoices, invoice-backed operational costs, and firm-price PO purchases.
  - Payroll/taxes (no invoice number) are excluded by design.
- Per item: counterparty, document no., date, due date, amount in PLN, and a
  status — **Open / Overdue / Paid** (overdue computed from the due date).
- Summary cards: receivable open & overdue, payable open & overdue, and the
  **net position** (receivable − payable). Filter by direction; hide paid.
- **Mark paid** toggles settlement (kept in app state, exported with your data).

## Sales-invoice matching from Fakturownia (read-only)
- On an SO with a pending invoice: **Match from Fakturownia** pulls the real
  invoice by number (or by client tax-ID + amount + date), storing its **KSeF
  number** and **paid status** on the SO.
- Matched paid status flows straight into Receivables — no manual marking needed
  once matched. Read-only; graceful CORS fallback as in v6.8.

## Refreshed testing
- **TEST_SCENARIOS.md rewritten for v6.9** — 11 sections covering consignment,
  warehouse charges, leg-scoped transport orders, the financial loop, and the
  Fakturownia bridge. This is the script for extensive real-data testing.

## Engine & tests
- New pure module `ledger.ts` with **8 executed scenario tests** (receivable/
  payable classification, overdue detection, mark-paid, Fakturownia paid sync,
  producer-payout math, exclusions, totals & net position). Suite total: 72
  scenarios, all passing; full TypeScript build type-check clean.

## After this: real-data testing, then Phase 2 (backend).
