# v6.18.13 — Counterparties: import from CSV

Closes the gap you spotted: you could import from Fakturownia and **export** to CSV,
but there was no **CSV import**.

## What's new
- A new **📥 Import CSV** button sits next to Import from Fakturownia and Export CSV.
- It reads a CSV with the **same columns as Export CSV** (`Type, Also acts as, Company,
  Country, NIP, EU VAT, Address, Currency, Payment Terms, Services, Person Name, Role,
  Email, Phone, Primary, Notes`), so a file you exported (or a colleague edited in a
  spreadsheet) imports straight back in — a clean round-trip.
- **Multiple rows for the same company are merged** into one counterparty with several
  contact people (the export writes one row per person; the import puts them back
  together). "Also acts as" and "Services" lists are split on `;`.
- It runs the **same duplicate detection** as the Fakturownia import and the merge tool
  (tax-number match + legal-suffix-stripped name match). Likely duplicates are flagged
  and left unticked, so you review before importing; everything else is selected by
  default. The existing review screen (filter by type / new / duplicate, bulk-assign
  type, per-row select) works exactly as it does for Fakturownia.
- Handles quoted fields with embedded commas, quotes and line breaks.

## Please test
1. Contacts → Export CSV, then Import CSV with that same file → every existing contact is
   flagged as a duplicate (nothing re-added unless you tick it).
2. Edit the exported CSV (add a new company, add a second person to an existing company),
   then Import CSV → the new company comes in; the existing one shows as a duplicate; the
   second person is grouped under the right company.
3. A CSV without a "Company" column → a clear "doesn't look like a contacts export"
   message rather than a crash.

## Verified
- Type-checked clean (0 project errors); CSV parsing/grouping unit-checked on a sample.

> Run `npm install && npm run verify` locally before deploying.
