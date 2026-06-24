# v6.18.11 — Lot journey: arrival fills in the earlier steps (#1)

## The problem
The lot journey only marked a step "done" when its own granular evidence existed — a
specific leg's actual load/unload date, or a customs flag set to "Cleared". In real
use those fields often aren't filled in, so a lot that had clearly **arrived in the
warehouse** still showed the sea / customs / road steps as empty. The journey looked
fragmented even when the goods were home.

## The fix — monotonic back-fill
Physical presence at a later point proves every earlier transit point happened: a lot
can't be **In Stock** without having passed the port, customs and the road leg. So the
journey now works out the **furthest point actually reached** — from the lot's
movements and status (received / at port / shipped out / delivered) — and marks **every
step up to that point as done**, using the planned date where no actual date was
entered. Steps beyond the reached point stay pending, and the first pending step is
still highlighted as the current one.

So once a lot is received into the warehouse, its whole inbound chain (sea, customs,
inland) shows complete; once it's shipped to the client, the delivery step completes
too — without anyone having to fill in every leg date by hand. Any actual dates you
*do* enter are still shown in preference to the planned ones.

## Note
This doesn't change where customs lives yet — that's the separate #2 item (move customs
out of Inventory onto the Shipment), still to be built. For now the import-customs step
simply completes correctly along with the rest of the chain when the goods arrive.

## Please test
1. A lot with no leg dates entered, received into the warehouse (In Stock) → the sea /
   customs / road / port steps now all show done, not empty.
2. A lot shipped to the client → the client/delivery step completes.
3. A lot still in transit (not yet received) → only the steps up to its real position
   are done; the next one is highlighted.

## Verified
- Type-checked clean (0 project errors) via the offline stub harness.

> Run `npm install && npm run verify` locally before deploying.
