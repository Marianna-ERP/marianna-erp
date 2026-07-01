# v6.18.18 — Product/variety everywhere, cancelled-SO cleanup, contacts VAT, tidy-up

## Product now shows Item — Variety everywhere it was still item-only
- **Sales Order → new line → pick source:** the picker window (both *from stock* and
  *from PO* views) now shows the variety next to the item, so you can tell varieties apart
  when choosing a source.
- **Inventory main view:** the line under each lot now reads **Item — Variety**, matching
  the lot detail and movement views.
- **Full product-display audit:** swept every module for product fields and added the
  variety where it was missing — shipment goods line + the auto goods description, and the
  Dashboard lot list. Inventory search now also matches on variety.

## Contacts — VAT under the company name
- In the parties list, the line under a company name showed only the local **NIP**, so a
  company whose number is an **EU VAT** (the usual case for foreign suppliers/clients, and
  for CSV-imported contacts) showed "—" there — even though the detail panel showed it
  correctly. The list now falls back to the EU VAT id, so the number always appears.
  (No data was lost — this was a display-only gap.)

## Cancelled SO no longer lingers in linked records
- When a Sales Order is cancelled, it's now removed from the **linked-records** view of both
  the originating **Purchase Order** and the **Shipment** — even if its number had already
  been stored on the shipment before it was cancelled.

## Shipments toolbar tidy-up
- Removed the stray **Export JSON** and **Open contacts** buttons from the Shipments header.
  Data export lives in **Settings**, and Contacts is reachable from the main navigation —
  these didn't belong on the shipment screen.

## Verified
- Type-checked clean (0 project errors); all imports at file tops (production-build safe).

> Run `npm install && npm run build` (or `npm run verify`) locally before deploying.

---
### Still open (need your input — covered in chat, not in this build)
- **DAP/DDP freight cost line can't be erased** — recommended a minimal fix; awaiting your
  pick between "allow erasing it" vs "lock it to N/A".
- **Deleting an SO appears to reset a DDP→warehouse lot to Expected/0** — the SO-cancel path
  I can see only reverses real ship-outs and never resets a received lot, so I need one
  repro detail to pin it before touching the inventory engine.
