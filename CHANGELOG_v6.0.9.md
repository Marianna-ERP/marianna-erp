# v6.0.9 — LOT movement crash fix + per-unit actual loading/unloading dates

1. **CRASH FIX — recording a movement on a LOT.** The movement modal's From/To
   dropdowns render every location, and the shared location list includes a BROKER
   (customs) location whose type wasn't in Inventory's icon table — so the lookup
   `LOCATION_TYPES["BROKER"].icon` threw and crashed the screen.
   Fixed by:
   - Adding BROKER and CUSTOMS to the location-type table (with a 🛃 icon).
   - Making ALL location-type lookups go through a safe `locType()` helper that falls
     back to a neutral default, so no future location type can crash the page.
   - Applied the same hardening to Purchase Orders (which had the same fragile lookup).

2. **Per-truck actual loading / unloading dates.** In Edit shipment → "Transport units
   for this leg", each unit now has **Actual loaded on** and **Actual unloaded on** date
   fields. These are separate from the leg's planned pickup/delivery dates on the
   transport order, so you can track the real loading/unloading of each individual
   truck (which can differ when a leg has more than one unit). The actual dates also
   show in the shipment detail's leg view when filled.
