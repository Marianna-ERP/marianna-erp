# v6.18.6 — Invoices as the single source of truth (P0-7)

The Finance ledger and P/L now read invoices from the unified **Invoices** module
instead of three separate legacy stores. This removes the duplicate representation
the audits flagged, so anything you add, edit or pay in Invoices flows straight into
the ledger.

## What changed
- **The ledger now reads the unified `invoices` store** for receivables (sales
  invoices) and invoice-based payables (warehouse, freight/forwarder/broker and other
  cost invoices). The old direct reads of `orders.pendingInvoices`, `warehouseInvoices`
  and invoice-backed `operationalCosts` are gone from the ledger.
- Those legacy records are still **folded into `invoices` automatically** (the existing
  idempotent migration), so they become a migration input rather than a parallel truth.
- **Computed commitments are unchanged:** producer consignment payouts (from closed
  settlements) and firm-price PO purchase commitments are still derived from inventory
  and the POs. Payroll/taxes (no invoice number) remain excluded.
- **Finance** now receives `invoices` and `financeNotes`; the ledger note text was
  updated to say where the numbers come from.
- **Integrity checker** now sees invoices and finance notes, and flags: invoice links
  to a missing SO/PO/Lot/Shipment, payments recorded above the invoice total, duplicate
  invoice numbers (within sales / within cost), and a credit/debit note pointing at a
  missing invoice.

## How to validate (built-in cross-check)
Because the legacy records are migrated into `invoices`, the ledger totals **should be
the same as before** for data you haven't touched in the Invoices module. So:
1. Note your **Receivable open / Payable open / Net position** before upgrading.
2. Upgrade, reload, open Finance → Ledger.
3. The three totals should match — **any difference should be explained by invoices you
   added, edited or paid in the Invoices module** (which is the whole point: that module
   is now authoritative).

## One continuity caveat
"Mark paid" in the **old** ledger stored a flag separate from the invoice. Sales
invoices cleared that way are still recognised. A *warehouse or cost* invoice that was
marked paid **only** via the old ledger flag (not on the record itself) may show as open
again — just mark it paid once more, ideally by recording the payment on the invoice in
the Invoices module so it stays the source of truth.

## Please test before deploying
1. Finance → Ledger totals reconcile per the cross-check above.
2. Add a sales invoice in Invoices → it appears as a receivable in the ledger.
3. Record a payment on it → it clears in the ledger.
4. Add a cost invoice → appears as a payable; a credit note against it shows in integrity if the invoice is later removed.
5. Producer payout and PO-purchase lines still appear (computed) and are unchanged.

## Verified
- Type-checked clean (0 project errors) via the offline stub harness.

> Run `npm install && npm run build` locally before deploying.
