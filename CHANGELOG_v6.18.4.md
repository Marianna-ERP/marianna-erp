# v6.18.4 — Stabilization batch 1 (P0, low-risk)

First slice of the stabilization sprint from the combined audit tracker. Three
high-priority, low-risk items. No inventory-creation or invoicing-architecture
changes yet (those are the bigger P0-5/6/7 work, done separately).

## P0-1 — Fakturownia live invoice creation is OFF by default
- The Invoices "Send to Fakturownia" action no longer creates a real invoice unless
  live write is **explicitly enabled** in Settings → Fakturownia. With it off (the
  default), Send explains itself and points to **Copy payload** (create it manually
  in Fakturownia) — so there's no accidental live-accounting action from the browser.
- Added a clearly-worded **"Allow creating real invoices"** toggle in Settings
  (default off, with a warning when on).
- Fixed the contradiction the audit flagged: Settings used to say the connection was
  "read-only … never creates" while the Invoices module could write. The text now
  describes it accurately (read/match by default; gated write only when enabled).

## P0-2 — Export files carry the app version, and mismatches are flagged
- The exported JSON `_meta` now includes `appVersion` (not just the schema version).
- On import, if the file was made on a different build, you get a clear warning in the
  confirm dialog (an older file with no version stamp is flagged too). Schema-version
  mismatch remains a hard block; a backup is still taken before any import.

## P0-4 — New counterparties appear in pickers immediately (no refresh)
- Extended the live-merge (added for PO destinations in v6.18.3) to the **Sales Order
  destination**, **shipment leg Loading/Unloading** and **create-shipment From/To**
  pickers, and the **Inventory movement** from/to pickers. A client, supplier or
  warehouse added this session now shows up right away — no browser refresh — via a
  new shared, deduped `counterpartyLocations(contacts)` helper.

## Still outstanding (tracked, deliberately not in this batch)
- **P0-3** schema migration runner — schedule when the model settles.
- **P0-5 / P0-6** action-based PO→lot sync + TRANSFER updates lot location — the
  event-driven inventory change; the most consequential correctness work, done as its
  own focused step.
- **P0-7** make Invoices the single source of truth (wire into Finance/ledger/integrity).

## Verified
- Type-checked clean (0 project errors) via the offline stub harness.

> Run `npm install && npm run build` locally before deploying.
