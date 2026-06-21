# v6.4.1 — System test results & date-integrity fixes

## Tested by direct execution (40 scenario tests, all passing)
- Margin engine: forecast vs actual, FX conversion, zero-revenue safety,
  cancelled-SO exclusion.
- Overhead allocation: by-revenue full & proportional split, Budget costs
  excluded from Actual but included in Forecast, manual allocation, Draft SOs
  excluded, net P/L = contribution − overhead.
- Contacts duplicate matching: legal suffixes (Sp. z o.o., S.r.l., GmbH...),
  tax-ID matching incl. PL-prefix, self-exclusion on edit, no over-matching of
  short names.
- Shipment document checklist: per-mode conditionality (CMR/BL/AWB),
  idempotency, case-insensitive dedup.
- Shipment→SO derivation: via PO sourcing, cancelled SOs excluded, unions deduped.
- Inventory engine: receipt→In Stock, port→Customs, ship-out→Shipped Out,
  damage write-off math, direct-lot availability basis, Draft SOs not linked.

## Fixes
1. **"Delivery before PO arrival" warning was dead** — it compared against a
   field name that doesn't exist (`expectedDelivery` vs `expectedDeliveryDate`).
   Test scenario 3.5 works again.
2. **POs no longer show "overdue loading" on the loading day itself** — both
   the KPI and the list indicator now compare against midnight-normalized today.
3. **Pre-carriage legs** no longer default their delivery date to the client's
   FINAL delivery date (which v6.4.0's leg-driven transport order would have
   printed on the road carrier's order). They default to the loading date.
4. **All "today" defaults now use LOCAL time** (new shared `dates.ts`).
   Previously, between local midnight and ~01:00/02:00 Polish time, new
   POs/SOs/movements/costs were stamped with yesterday's date.
5. **Dashboard "upcoming deliveries (7 days)" includes today** (day 0); it
   previously excluded SOs delivering today.
6. **Header-vs-leg date drift warning** in the shipment edit form: when the
   header loading/expected-delivery dates disagree with the first/last leg, an
   amber note reminds you the transport order prints the LEG dates.
7. **Legacy datetime values** ("2025-10-13T09:00") in leg dates now display as
   clean dates on the document and detail (time lives in the new time fields).
8. **Settings reset relabelled** "Start fresh — erase ALL data" (it previously
   said "reset to demo data", but the test shell starts empty).
9. **Shipment detail Goods table** backfills the SO number from derived links
   (same fix the transport order and header pills got in v6.4.0).
