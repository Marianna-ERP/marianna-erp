# v6.18.3 — Warehouse, locations, integrity panel & over-ship guard

Safe UI/logic fixes from the discussion. No inventory-creation changes (that's the
separate #4 work) and no data-model migration.

## 1. Warehouse "operates at" location (Counterparties)
A warehouse now lists **its own address(es)** as where it operates — not the global
list of every warehouse (which wrongly offered the seed WH-01/WH-02). Billing stays
against the warehouse's main legal address regardless of which of its sites holds the
goods; add an extra address for a second site. Fixed the stale "Settings → Locations
& ports" hint (that page was removed earlier).

## 2. New warehouse appears in the PO destination immediately (no refresh)
The Purchase Order destination dropdown now merges live warehouse counterparty
addresses from the current data, so a warehouse you just added shows up right away —
no browser refresh. (Deduplicated against the built-in list. The same one-line merge
can be extended to the Sales Order destination and shipment-leg pickers if you hit it
there too.)

## 3. Data-checker panel is now readable
The integrity panel was rendered inside the top nav, whose horizontal overflow clipped
it (and any scroll dismissed it). It now opens as a fixed popover anchored to the
viewport, so it stays put and fully visible while you read the listed records. The
checks and the per-record detail (which lot/SO/shipment and the broken ref) are
unchanged.

## 4. Over-shipping a PO is now hard-blocked (no override)
Creating a shipment for a PO now shows a clear kg bar — **already shipped** (blue) +
**this shipment** (striped) against the **PO total** — with the exact numbers. If the
PO is already fully shipped, or this shipment would push the cumulative kg over the
PO total, **Create is blocked** with no override. (This shipment's load is taken from
the product lines you tick.)

## Deferred by agreement
- The **action-based PO lock + expected-lot sync** (edits propagate, revert withdraws
  the unreceived lot, receipt is driven by the inbound shipment's delivery) — its own
  focused change next, since it rewrites how inventory lots are created/updated.
- The **CIF port-of-arrival origin default** — bundled with that PO-model work.
- **Lot splitting** (part sold at the port, part to the warehouse) — roadmap, pairs
  with the v6.19 cost-allocation milestone.

## Verified
- Type-checked clean (0 project errors) via the offline stub harness.

> Run `npm install && npm run build` locally before deploying.
