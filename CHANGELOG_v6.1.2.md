# v6.1.2 — Lot Journey & Ownership (6.1b+6.1c): visible journey on each lot

The lot journey is now visible. This builds directly on the v6.1.0 flow foundation.

## What's new

1. **Lot journey generated from the flow.** When a PO is confirmed, each created lot
   now carries a `journey` — the ordered planned stages for that flow (e.g. EXP·CIF:
   at producer → road to port → port of loading → export customs → sea freight →
   destination port). Each stage has a planned date (spread between loading and
   expected delivery) and a status (pending → active → done; actuals fill in later).

2. **Ownership boundary, by Incoterm.** Each stage is tagged OURS / not-ours-yet /
   client's, derived from the flow's buy & sell Incoterm boundaries (the owned segment
   you confirmed: buy-boundary → sell-boundary; CIF/CFR purchases = ownership starts at
   the DESTINATION port). Transit legs (road/sea) correctly inherit the ownership of
   the point they depart from — e.g. on IMP·CIF→our-WH, the inland road leg AFTER the
   destination port is correctly "ours", while the sea leg before it is the supplier's.

3. **JOURNEY card on the lot detail (Inventory).** A vertical timeline shows each stage
   with a green dot + "OURS" badge for owned stages and grey for not-yet-ours /
   handed-over, plus the planned date and status. Existing/seed lots also show a journey
   (generated on the fly from their flow) so you can see it immediately without
   re-confirming a PO.

## Verified
- isDirectFlow behaviour unchanged (from 6.1.0).
- Ownership tagging checked against EXP·CIF, IMP·CIF→WH, EXP·EXWs — matches the
  confirmed buy→sell ownership model.

## Next (not in this build)
- 6.1d: customs as an independent overlay; later, driving stage status from actual
  shipment movements.
