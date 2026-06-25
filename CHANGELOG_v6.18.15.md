# v6.18.15 — Batch 1: consistent dd/mm/yyyy dates

A single shared formatter (`formatDMY`) now renders dates as **dd/mm/yyyy** wherever they
are **displayed and printed**, across all modules.

## Where it's applied
- **Printed / emailed documents:** PO and SO document date rows, and the PO / SO / transport
  order email bodies.
- **List views:** PO list (load / delivery), SO list (order / delivery), Invoices list
  (issue / due) and the credit/debit note rows (date).
- **Detail panels:** SO → linked invoice (issue / due); shipment actual loaded / unloaded.
- **Inventory:** the lot journey timeline and stage dates, and the movement-history dates.

## What it does NOT change (by design)
- **Date pickers** (the `<input type="date">` fields) still show the format your browser /
  OS uses — that's controlled by the browser and can't be forced to dd/mm/yyyy without
  replacing every picker with a custom field. Underneath, dates are still stored as ISO
  (`yyyy-mm-dd`), so nothing about your data or sorting changes — only how dates are shown.
- Date **logic** (comparisons, "overdue", journey calculations) is untouched.

## Note on coverage
This covers the dates you see and send most. If a stray ISO-style date turns up anywhere
in testing, it's a one-line wrap to fix — send me where and I'll mop it up. The internal
cells of the *printed* transport-order document weren't located cleanly this pass; flag it
if it still shows yyyy-mm-dd and I'll convert it.

## Verified
- Type-checked clean (0 project errors); the formatter safely returns "" for empty values
  and leaves unrecognised strings untouched.

> Run `npm install && npm run verify` locally before deploying. Batch 2 (the product
> catalog) follows separately.
