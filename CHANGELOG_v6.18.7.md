# v6.18.7 — Stabilization batch (P1/P2, low-risk)

First batch of the P1/P2 work — the safe closeouts. No P/L math changes (those come
in the next, isolated batch). Bigger items (v6.19 expected-vs-actual + lot splitting,
and the file-split/interfaces refactor) stay deferred on purpose.

## P1-4 — Duplicate-invoice guard at entry
Saving an invoice now warns if another invoice of the same kind, number and
counterparty already exists ("…looks like a duplicate — save anyway?"). It's a
warning, not a hard block, since a number can legitimately repeat across different
counterparties. Complements the duplicate-number *detection* added to the integrity
checker in v6.18.6.

## P1-6 — Integrity checker extended (finishing what P0-7 started)
Two more checks, both pointing at the specific record:
- **Delivered shipment, no movement:** a shipment marked Delivered whose lots have no
  recorded inventory movement — i.e. the "apply inventory" step was missed, so stock
  wasn't received/shipped.
- **Unallocated shipment costs:** a Delivered/Arrived shipment carrying logistics costs
  that were never allocated to lot costing — those costs are missing from COGS until
  allocated.

## P1-9 — Multi-PO shipment via SO aggregation (verified)
Confirmed in code: a sales order that sources lines from several POs already produces a
shipment whose header `poRefs` lists every distinct PO, and each goods row carries its
own `poRef`/`soRef`/`lotRef`. So one delivery covering, say, potatoes from one supplier
and carrots from another (aggregated on a single SO) is already supported — no change
needed. This is the recommended route for mixed loads.

## P2-7 — Stricter local/CI build gate
Added two npm scripts:
- `npm run typecheck` — `tsc --noEmit` (pure type check)
- `npm run verify` — type-check **and** a CI-strict build that fails on warnings

Use `npm run verify` before deploying. The Vercel deploy path (`build:vercel`) is
unchanged.

## P2-8 — Robust JSON export
The shipments JSON export now attaches the link to the document and defers revoking the
object URL, so the download fires reliably across browsers (Firefox in particular).

## Verified
- Type-checked clean (0 project errors) via the offline stub harness.

> Run `npm install && npm run verify` locally before deploying.
