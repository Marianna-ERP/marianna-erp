# v6.18.20 — Fakturownia cost-import: correct date + invoice number

## Fixes (Finance → Operational costs → Import from Fakturownia)
- **CSV import was stamping the import date instead of the invoice issue date.** The date
  parser only accepted strict `yyyy-mm-dd` / `dd.mm.yyyy`, but when a CSV is read the date
  cell is often re-serialised into a format that missed — so the date came back empty and
  fell back to "today". The file is now read with proper date handling (`cellDates` +
  ISO `dateNF`) and the parser also accepts single-digit day/month, so CSV dates land
  correctly (XLS keeps working as before).
- **The invoice number was not imported (CSV or XLS).** Auto-detection of the "Numer/Number"
  column didn't match the header in your export, so the number came back blank. The import
  now shows **column pickers** for *Invoice no.* and *Issue date*, pre-filled with what was
  auto-detected — if either is wrong or blank, point it at the right column and the preview
  updates instantly. This works regardless of how Fakturownia labels the columns.

## Verified
- Type-checked clean (0 project errors); all imports at file tops (production-build safe).

> Run `npm install && npm run build` (or `npm run verify`) locally before deploying.

---
### Discussed in chat (design — not built yet)
- **Duplicate-invoice safety + better organisation of cost invoices**, mirroring the
  contacts duplicate/merge tool. Proposal and options are in the chat for your decision
  before building.
