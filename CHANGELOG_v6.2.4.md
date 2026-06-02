# v6.2.4 — Transport dates, sequential check, default-leg TBA, PO supplier search, import dedup, PO density

1. **Transport order uses the leg's own dates.** The transport order document now shows
   each leg's planned pickup/delivery dates (the shipment header date is only a
   fallback). The shipment-detail header still uses the shipment's own dates — the two
   are intentionally distinct.

2. **Sequential leg-date check.** In the leg editor, if a leg's pickup date is earlier
   than the previous leg's delivery date, an inline warning appears (cargo must arrive
   before the next leg can start).

3. **Default leg now follows the TBA rule.** The mode-driven "TBA" prefill (Road →
   container/seal/booking/BL/shipping line; Sea/Rail/Air → truck/trailer/driver fields)
   is now applied to the initial leg when the editor opens, not only to legs added
   afterwards. Still fills empty fields only, always editable.

4. **PO supplier filter is now a search field.** Instead of a button per supplier
   (unworkable with ~200 names), type part of a supplier's name to filter; "Clear"
   resets it.

5. **Import duplicate handling.** When the Fakturownia import finds possible duplicates,
   a bar offers: "Import all (incl. duplicates)", "Keep originals (skip duplicates)", or
   tick/untick individual rows to choose exactly which to import.

6. **Density pass — Purchase Orders list (sample).** The KPI strip is more compact
   (smaller cards, value on the right, less padding/whitespace) so more shows above the
   fold. This is the proposed style — once you approve it, the same density pass will be
   applied to the other modules.

Note: BL/CMR confirmation needs no new field — those are tracked in the Shipments
documents section already.

(Test build — empty shell; data is browser-local, export from Settings to back up.)
