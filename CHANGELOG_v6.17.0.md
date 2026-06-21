# v6.17.0 — Safety nets for the file-sharing testing phase (+ held frontend fixes)

> Transpile/syntax-checked only — run `npm install && npm run build` locally before deploying.
> Everyone testing must update to the SAME build (v6.17.0) before exchanging JSON files.

## Data-safety nets (the focus of this release)

- **Auto-backup before every import and reset.** Before an import overwrites your
  data — or a reset wipes it — a full snapshot is saved automatically, so an
  accidental overwrite is now reversible.
- **Local backups panel (Settings).** Lists the automatic snapshots (last 8) with
  **Restore** and **Delete**, plus a **Create backup now** button. Restoring also
  backs up the current state first, so it's reversible too.
- **Loud import confirmation.** Importing now asks you to confirm, spelling out
  that it REPLACES everything (no merge) and that a backup is taken first.
- **App-version badge** in the top bar (v6.17.0). Since people in different places
  share files, this lets everyone confirm they're on the same build — files from a
  different version can't be imported, and the error now says so plainly.
- **Version-stamped exports.** Export filenames now include the app + schema
  version, e.g. `marianna-erp_v6.17.0_schema-v1_2026-06-…json`.
- **Error boundary.** If a screen ever crashes, you now get a recovery screen that
  says your data is safe (it's untouched in the browser), offers a one-click backup
  download, and a reload — instead of a blank page that looks like data loss.
- **Bug fixed: shared files were dropping data.** Credit notes and logistics points
  were missing from export/import/reset, so sharing a JSON silently lost them — now
  included.

## Frontend fixes (previously held back for your review)

- **Cancelled shipments no longer show under the PO.** The PO's linked records use
  the live list and exclude cancelled shipments.
- **Confirmed PO is locked.** Once a PO leaves Draft, product, quantities, supplier,
  incoterm, flow and commercial terms can't be changed (inventory and downstream
  orders depend on them); dates, status and notes stay editable. A banner explains it.
- **Credit notes list** — Reason and Ref are separate columns (Reason gets the
  space and truncates with a tooltip), and Amount and Status are distinct columns
  with Status shown as a colored badge.

## How this helps your current workflow
You're sharing one JSON file between people in different locations. Until a shared
backend exists, keep to **one editor at a time** and **everyone on the same build**;
these nets make the file-swap recoverable if something goes wrong.

## Notes for later (deferred by design while the schema still moves)
Full schema-migration runner, the integrity/health-check panel, and the data-access
seam for the eventual backend — to be built when the frontend settles.
