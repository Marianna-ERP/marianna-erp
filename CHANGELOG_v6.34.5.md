# v6.34.5 — Customs cost fix · transport-order per-carrier scoping · net+gross weights

## Customs cost line — no more duplicate, no more resurrection
- Adding customs after creating a shipment could leave **two** customs cost lines (one on a
  broker you don't use), and deleting the wrong one brought it **back** on the next edit.
- Cause: the auto-line was rebuilt with a fresh id every save (so edits/duplicates diverged),
  and deleting it didn't stop the save-time sync from regenerating it.
- Fix: the auto customs line now has a **stable identity** (one line, preserved id, broker from
  the customs section), and **deleting it switches "customs applies" off** so it stays gone.
  Any manual supplier you set on it is preserved.

## Transport order — each carrier sees only its own goods (Problem A)
- When a shipment has more than one leg/carrier, each goods line can now be **assigned to a leg
  (carrier)** in the Goods section. Each carrier's transport order then lists **only the goods on
  its leg** — no more showing the whole PO to every carrier. Goods left as "All legs" still show
  on every order (unchanged default).

## Net + gross weight on the transport order
- The cargo table now prints **Net (kg)** and **Gross (kg)** per line, with a **totals row** for
  the truck. Net comes from the PO quantity (as before); gross is editable per goods line in the
  Goods section (defaults to the builder's estimate) — the figure carriers need on the order.

## Gate
- Suite 160/160 · typecheck 0 · eslint unused 0 · real CRA build PASSED.
