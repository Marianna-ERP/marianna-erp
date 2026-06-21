# v6.18.0 — Invoicing module

A new top-level **Invoices** module (nav item placed after Shipments, before
Counterparties) that is the single source of truth for every invoice in and out,
plus credit/debit notes. Reachable by Operations/Admin without entering Finance —
the precise P/L stays protected in Finance.

## What's new
- **Unified invoice model** for SALES (receivable) and COST (payable) invoices, with
  category (SINV/Purchase/Forwarder/Broker/Warehouse/Transport/Other) and, for costs,
  a cost SCOPE (Shipment-scoped / Monthly-shared / Overhead) that drives allocation.
- **Automatic migration (no data loss):** existing SO pending invoices, warehouse
  invoices, and invoice-backed operational costs are folded into the new model on load.
  Idempotent — runs safely on every change, never duplicates. Payroll/taxes without an
  invoice number stay out (as before).
- **List view:** receivable/payable/net-position/overdue KPIs, search, direction + status
  filters, one row per invoice with type, number, counterparty, dates, gross (+PLN), status
  and linked SO/PO/shipment.
- **Create / edit:** sales or cost invoice; pick counterparty, amounts (net/VAT/gross with
  live PLN at the locked FX rate), cost scope and period (for monthly-shared), and link to
  SO/PO/shipment.
- **Edit lock at "Sent":** Draft and Issued are editable; once Sent / pushed to Fakturownia
  the invoice is locked — a change then needs a credit/debit note.
- **Credit & debit notes:** issue against any invoice (linked by id), incoming or outgoing,
  credit (reduces) or debit (increases). Shown on the invoice with the net adjustment.
- **Fakturownia push (sales invoices):** on Send, POST to /invoices.json. Fakturownia
  assigns the legal number (we store it back) and the record locks. KSeF stays managed by
  Fakturownia for now (the gov_save_and_send flag is built in but OFF — flip later). If the
  browser blocks the call (CORS), a "Copy payload" fallback is offered.

## Notes for testing
- Sales invoices still also appear via the SO flow; they now surface in Invoices too.
- The Fakturownia push needs the account + token configured in Settings, KSeF authorised
  in Fakturownia, and a token with write permission. The first real push is the live test
  of whether browser CORS allows it — if not, use Copy payload / await the backend.
- Type-checks clean. No STORAGE_VERSION bump — existing data is preserved and migrated.
