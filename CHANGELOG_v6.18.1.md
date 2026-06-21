# v6.18.1 — Data-safety fix: invoicing data now travels with the dataset

A patch on top of the v6.18.0 you built on the other account. No feature changes.

## Fixed (data-loss bug)
- **`invoices` and `financeNotes` were missing from `DATA_KEYS`.** The Invoicing
  module added these two stores in v6.18.0, but they were never added to the
  shared set, so they were **excluded from JSON export/import, from the automatic
  backups, and from reset**. For a team sharing a JSON file this meant invoices and
  credit/debit notes did not transfer between machines, and any manual invoice
  status/payment edits or finance notes were lost on a share, import, or restore.
  Both stores are now included everywhere, so invoicing data is shared and
  protected like every other entity. (Same bug class as the earlier
  creditNotes/logisticsPoints fix — now closed for the new module too.)

## Housekeeping
- Synced the build version: `version.ts` and `package.json` are both **6.18.1**
  (v6.18.0 had `version.ts` at 6.18.0 but `package.json` still at 6.17.2).

## Verified
- Type-checked clean with `tsc` (0 project type errors), using module stubs so the
  check actually runs offline — note the handoff's bare `tsc -p tsconfig.json`
  command halts on the `moduleResolution` deprecation and reports nothing, which
  reads as a false "clean". Worth fixing that command (add `"ignoreDeprecations":
  "6.0"` to tsconfig, or run `npm run build` which uses the installed react types).
- All v6.17 safety nets and held fixes confirmed present (backup ring, error
  boundary, version badge, cancelled-shipment unlink, confirmed-PO lock).

> Run `npm install && npm run build` locally before deploying.
