# v6.18.19 — DAP/DDP freight line can now be erased

## Fix
- **Edit shipment → Costs and billing → "Bought DAP/DDP":** ticking this box already
  swapped the freight line's lock (🔒) for a delete (✕) button, but the delete handler
  still hard-blocked freight lines — so clicking ✕ only showed the "can't delete freight"
  alert. The deletion block is now lifted whenever **Bought DAP/DDP** is ticked, so a
  freight line that genuinely belongs to the supplier (who arranges and pays transport)
  can be removed. With the box unticked, freight lines stay protected as before; the alert
  now also points to the toggle.

## Verified
- Type-checked clean (0 project errors); all imports at file tops (production-build safe).

> Run `npm install && npm run build` (or `npm run verify`) locally before deploying.

---
### Still open (awaiting your re-test)
- **Deleting an SO appears to reset a DDP→warehouse lot to Expected/0.** The SO-cancel path
  only reverses real ship-outs and never resets a received lot, so I need one detail from
  your re-test to pin it: after deleting the SO, does the lot's movement history still show
  the inbound "IN" receipt, or has that movement disappeared?
