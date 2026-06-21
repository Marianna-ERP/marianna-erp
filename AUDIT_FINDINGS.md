# Marianna ERP v6.17.0 — Consolidated Audit Findings

A line-by-line read of all six modules (Contacts, Purchase Orders, Inventory, Sales
Orders, Shipments, Finance) and the shared cores (App, useLocalStoredState,
marginCalculations, warehouseCharges, consignment, ledger, fakturownia). Read in
dependency order to find root causes rather than symptoms.

This is an audit only — no code was changed. It revises the original weak-points list:
some items were already handled well; a few new ones surfaced; and several symptoms
trace back to two shared root causes.

---

## The two root causes

Almost every correctness risk traces back to one of these:

### ROOT CAUSE A — Movements carry no structured link to the Sales Order
SHIP_OUT / REVERSAL / DAMAGE movements store only a free-text `note`. The whole
"actual" P/L chain — COGS attribution, cancellation reversal, shipped-quantity
reconciliation — works by `String(note).includes(soNumber)`. There is no `soRef`
field. Everything downstream inherits the fragility of substring-matching a
human-typed string.
  Affected: marginCalculations (COGS actual), SalesOrders (reverse on cancel),
  consignment (sales lines), integrity (shipped-without-movement detection).

### ROOT CAUSE B — Identity is positional, not stable
Records are keyed by `Math.max(existing id) + 1` (counterparties, contact people) or
`Date.now()` (lots, POs, SOs). Neither guarantees a *stable, never-reused* identity:
max+1 recycles an id after the highest record is deleted; Date.now() can collide when
several records are created in the same millisecond (e.g. lots generated in a loop at
PO confirm use `Date.now() + idx`, which is safe, but lot/PO/SO created from different
modules can still coincide). Because counterparty snapshots resolve by id, a recycled
id silently re-points a document to the wrong company.
  Affected: App snapshot cascade, all cross-module references.

Fixing these two removes or de-risks the majority of the individual findings below.

---

## Findings by module

### Contacts (2,093 lines) — the most mature module
- **C-1 (high, ROOT B):** `max(id)+1` id generation can recycle a counterparty/contact
  id after a delete, silently re-pointing PO/SO snapshots to a different company.
- **C-2 (medium):** Import duplicate detection (exact name / exact tax) is narrower
  than the merge tool's fuzzy matcher (suffix-stripping + containment). The import can
  admit a duplicate the merge tool would have caught.
- **C-3 (low):** Tax-id dedup falls back to name-only when the tax string is short or
  malformed; compounds C-2.
- **C-4 (low, soft-ref):** `linkedDocs` on a counterparty is an unmaintained string
  array of PO/SO numbers; can drift out of sync. Display-only today.
- **C-5 (low, cascade):** Delete-company confirms by contact count only; it does not
  warn that live POs/SOs/shipments reference the company. (Integrity check now flags
  the resulting orphan after the fact.)
- **Good:** merge engine preserves `mergedFromIds` so App re-points old documents;
  tax parser separates NIP vs EU-VAT correctly; save normalizes numeric tariff fields.

### Purchase Orders (2,060 lines) — strong, well-guarded
- **P-1 (medium):** Lot regeneration de-dups by product *name* when `poLineId` is
  empty (`buildExpectedLotsFromPO`, ~line 1611). A PO with two lines of the same
  product can mis-match, so a second same-product line may not get its own lot.
- **P-2 (low, ROOT B):** New lots use `Date.now() + idx` ids — safe within one confirm,
  but not coordinated with Inventory's own id scheme for manually-added lots.
- **Good (revises original WP#3 down):** PO "delete" is a **soft cancel** that cascades:
  `reflectCancelledPOInInventory` blocks (never destroys) physically-received lots and
  zeroes only still-expected ones; `reflectCancelledPOInSOs` resets dependent non-
  terminal SOs to Draft with a recorded reason. Duplicate-number guard on save. FX is
  locked at confirm (`fxLockedAt`). Orphan-lot pruning only removes unreceived,
  no-movement expected lots. This module is a model for how the others should behave.

### Inventory (1,988 lines) — clean engine, two real gaps
- **I-1 (high, ROOT A):** Movements are recorded with free-text `note` and **no
  `soRef`**. This is the origin of the note-parsing fragility the margin engine suffers.
- **I-2 (high, cascade):** `deleteLot` is a **hard delete** (filter-out) with no
  dependent check — unlike PO's soft cancel. Deleting a lot still referenced by an SO
  line or shipment leaves dangling refs and breaks COGS. (Confirm text even says "soft-
  deleted", but the code deletes outright — a misleading message.)
- **I-3 (medium, ROOT A / disconnect):** **Nothing auto-posts SHIP_OUT.** All SHIP_OUT
  movements in the system are seed data; none are created when an SO becomes Shipped or
  a shipment is dispatched. The actual-COGS path depends on a human manually recording
  a ship-out in Inventory, with a correctly-typed note containing the SO number. This is
  the single biggest *operational* gap — it's how "SO shipped but COGS reads zero"
  happens in normal use.
- **I-4 (medium, FX):** `saveCustoms` uses **hardcoded FX** (EUR 4.25, USD 3.9) to
  convert customs cost to PLN, rather than the PO's locked rate or a single source.
- **Good:** `recomputeLotFromMovements` correctly replays the whole movement list from
  a stable base — the right "replay from scratch" discipline; customs cost mirror
  replaces its prior line (no double-count); movement edit/delete recompute consistently.

### Sales Orders (2,719 lines) — strongest entry guards, one disconnect
- **S-1 (high, ROOT A):** Cancel-reversal matches SHIP_OUT by `note.includes(number)`
  (same fragility as I-1). A reversal can miss or over-restore on note edits/collisions.
- **S-2 (medium, disconnect):** Becoming "Shipped" opens an invoice modal but does **not**
  post SHIP_OUT to Inventory (see I-3). The status and the physical movement are not
  linked, so they can diverge.
- **Good:** the oversell gate (original WP#2) is **fully enforced** here — save is
  blocked at non-Draft status when any line exceeds availability, with sourcing,
  PO-readiness, and single-use import-permit/ACID-number guards (with a recorded
  override). This is the best-guarded save path in the app.

### Shipments (2,309 lines)
- **SH-1 (medium, WP#7 precursor):** Shipment costs carry `invoiceStatus`
  (Expected/Received) and `allocationMethod` but allocation to lot costs happens in
  Finance; there's no reverse path if a cost line changes after allocation.
- **SH-2 (low):** `saveShipment` is a plain overwrite with no referential checks on
  its `poRefs`/`soRefs`/`lotRefs` (integrity check now flags broken ones).
- **Good:** there is no destructive shipment delete (only cost/document-row removal),
  which avoids a whole class of orphan risk; FX rates are stored per cost line.

### Finance (1,073 lines)
- **F-1 (high, WP#7 + checker mismatch):** `approveInvoice` allocates warehouse cost
  onto lots tagged `source: "WHINV-" + id`, guarded against re-adding the same source —
  but it is **append-with-guard, not replace**: a corrected/re-approved invoice will not
  re-allocate cleanly, leaving stale cost in COGS. NOTE: the source prefix is `WHINV-`
  (hyphen); the integrity checker I shipped looked for `WHINV:` (colon) — so the checker
  currently misses these. **This is a bug in my checker to fix before relying on it.**
- **F-2 (medium, FX):** Hardcoded EUR 4.25 / USD 3.9 in two places (lines 223, 270),
  same as I-4.
- **Good:** the ledger and warehouse-charges engines are pure and clean; warehouse
  kg-days clipping with monthly windows and free-day handling is correct and testable.

### Shared cores
- **X-1 (resolved):** Import **already** refuses a schema-version mismatch
  (`importAllData`, useLocalStoredState line 179) — original WP#6 "version gate" is done.
- **X-2 (good):** `exportAllData` stamps version; non-versioned backup keys survive a
  STORAGE_VERSION bump; ErrorBoundary offers a backup download on render crash.
- **X-3 (good):** Fakturownia token is browser-only, never exported; CORS handled with a
  documented XLS/CSV fallback.
- **X-4 (info):** Everything is one shared localStorage blob with per-key writes; multi-
  entity operations are not transactional (original WP#6). Acceptable for the prototype;
  the real mitigation is the planned backend.

---

## How the original weak-points list changes

| # | Original weak point | Verdict after audit |
|---|---|---|
| 1 | P/L parses free-text notes | **CONFIRMED — top priority (ROOT A).** Add `soRef` to movements. |
| 2 | Oversell gate | **ALREADY ENFORCED** in SO save. Integrity check adds defence-in-depth. |
| 3 | Deletes don't cascade | **SPLIT:** PO cancel cascades well; **Inventory lot delete does NOT (I-2)** and is the real gap. SO cancel reverses (but via note-match). |
| 4 | Counterparty snapshot drift | **CONFIRMED + deeper (ROOT B, C-1):** id recycling is the underlying cause. |
| 5 | Consignment double-write | **CONFIRMED** (idempotent only by convention); checker now detects it. |
| 6 | Single blob, no transactions / import mismatch | **PARTLY RESOLVED:** version gate already exists (X-1); transactionality awaits backend. |
| 7 | Allocations no reversal | **CONFIRMED (F-1)**, plus a checker prefix bug to fix (`WHINV-` vs `WHINV:`). |

New findings not in the original list: **ROOT B (id recycling/collision)**, **I-3/S-2
(SHIP_OUT never auto-posted)**, **I-4/F-2 (hardcoded FX)**, **P-1 (same-product lot
de-dup)**, **C-2/C-3 (import dedup narrower than merge)**.

---

## Recommended gate sequence (after this audit)

1. **Fix the checker's `WHINV-` prefix bug** (cheap; makes the tool trustworthy).
2. **Stable ids (ROOT B):** monotonic non-reused ids (counter or UUID). Prerequisite for
   the snapshot gate to be sound.
3. **Structured `soRef` on movements (ROOT A):** add the field; make the margin engine,
   reversal, and consignment read it; keep the note as decoration. Highest correctness win.
4. **Auto-post SHIP_OUT (I-3/S-2):** when an SO becomes Shipped (or a dispatch is
   recorded), post the SHIP_OUT with the structured `soRef` — closes the status/physical
   disconnect.
5. **Inventory lot delete guard (I-2):** block or cascade like PO does; fix the
   misleading "soft-deleted" message.
6. **Allocation replace-by-ref (F-1):** re-allocation removes prior lines for that
   invoice ref, then rewrites.
7. **Single FX source (I-4/F-2):** one rates table / the locked rate, no hardcoded literals.
8. **Unify import dedup with the merge matcher (C-2/C-3).**

Items 2 and 3 are the structural backbone; everything else is contained once they're done.
