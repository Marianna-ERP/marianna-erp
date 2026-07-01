# v6.18.24 — SO availability no longer double-counts a received PO

## Fix
- **New SO → line sourced from stock → the availability panel double-counted.** It showed
  e.g. "On lot 4 300 kg + Other sources 14 300 kg = Combined 18 600 kg", but the 14 300 was
  the very PO that had already been received into that lot — so the same goods were counted
  twice (once as the lot, once as still-incoming PO supply).
- Root cause: `computeLineAvailability` summed "other PO supply" for the same product without
  excluding POs whose goods are **already received into a lot**. A received PO's goods live in
  the stock lots, not in an incoming pipeline.
- Fix: a PO that has a lot with physical/received stock is now treated as received and left
  out of the "other sources" sum. Genuinely expected (not-yet-received) POs still count as
  incoming, so multi-source availability stays correct.
- For your case this now reads: **On lot 4 300 kg → Combined 4 300 kg**, with no phantom
  other source.

## Note
- Partial receipts (part of a PO in a lot, part still to arrive) now count only the received
  part as available — a conservative under-count rather than the previous over-count, which
  is the safer side for committing stock.

## Verified
- Type-checked clean (0 errors, strict:false to match the project); imports at file tops.

> Run `npm install && npm run build` locally before deploying.
