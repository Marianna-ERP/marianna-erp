# v6.17.3 — Structural hardening gates 5–8 (audit follow-through complete)

Builds on v6.17.2 (stable ids + structured soRef). All eight gates from the audit
are now implemented. Type-checks clean; no data migration required.

## Gate 5 — Inventory lot-delete guard (was a silent hard delete)
Deleting a lot now scans for dependents first — non-cancelled Sales Orders sourcing
it, shipments referencing it, and any received goods / recorded movements. If any
exist, you get a specific warning listing them and must explicitly confirm that the
references will be broken. The misleading "It will be soft-deleted" message is gone
(the delete is real, and now says so).

## Gate 6 — Allocation & settlement: replace-by-ref discipline
- Approving a warehouse invoice now REMOVES any prior cost line tagged to that invoice
  before writing the fresh split, across all lots — so re-approving a corrected invoice
  re-allocates cleanly and a lot dropped from the set loses its stale share, instead of
  the old "skip if already present" (which left stale costs in COGS).
- Closing a consignment settlement applies the same discipline to its two cost
  components — re-closing rewrites cleanly and can no longer double-count.

## Gate 7 — Single FX source of truth
New `fx.ts` holds the default PLN reference rates. The hardcoded 4.25 / 3.9 literals
scattered across Finance, Inventory and Shipments (and PO's separate 4.2531 / 3.8812
constant) all now resolve through it. A document's own captured rate still always wins;
this only unifies the fallback so the same currency can't convert at two different
default rates in different screens.

## Gate 8 — Import dedup unified with the merge tool
The Fakturownia import now flags duplicates with the SAME fuzzy matcher the merge
screen uses (tax-digit match ignoring country prefix + legal-suffix-stripped name
containment), instead of the narrower exact-name/exact-tax rule. It catches cases like
"FreshFarm" vs "FreshFarm ES Sp. z o.o." and "PL8351595299" vs "8351595299" that the
old import would have admitted as new records.
