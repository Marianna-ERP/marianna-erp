# v6.4.0 — PO filter, shipment list & header, transport order rework (per-leg logic), temp recorder, EUR totals

## Purchase Orders
1. **Supplier filter is practical now.** Chips show only suppliers that actually
   have POs, ordered by PO count and showing the count ("Owoce Polska · 7").
   With more than 8 active suppliers the chips collapse into a searchable
   dropdown.

## Shipments — list & header
2. **Compact list rows.** Each row is now a single line: SHP number · mode ·
   status, so many more shipments fit on screen. A small amber dot flags
   missing documents; hover any row for the full summary (purpose, provider,
   dates, missing docs).
3. **Detail header cleaned up.** Shows exactly: number, mode, status, billing
   status, and the PO / SO / LOT pills. The SO pill now appears reliably — it
   is derived from header links ∪ per-goods links ∪ SOs sourcing the linked PO
   (previously only the header link was used, which was often empty). Route,
   provider and dates are no longer repeated in the header.

## Shipments — fields
4. **Temp recorder no.** New field next to the temperature settings; shown in
   the operational checklist and printed on the transport order beside
   Temperature (matches what is reported on the invoice).
5. **Costs and billing totals.** The total now shows per-currency subtotals,
   the PLN total, and the **EUR equivalent** (rate taken from your EUR cost
   lines, fallback 4.25): e.g. `12 000 PLN + 2 500 EUR → Total 22 625 PLN ≈ 5 323 EUR`.
6. **Per-leg pickup & delivery times.** Free-text time fields (e.g.
   "08:00–14:00", "by 12:00") under each leg's pickup/delivery dates.

## Transport order confirmation — reworked around the LEG
7. **Leg-scoped, privacy-correct.** The order now describes ONLY the selected
   legs: loading/unloading places and the loading & unloading **date + time**
   come from the first/last selected leg — never from shipment-level
   origin/destination. A sea/air/rail forwarder's order can no longer leak the
   supplier site that only the road carrier needs to know. (This also fixes the
   CIF export case: each provider's order carries its own leg's dates.)
8. **Unit table by mode, decluttered.** From→To and Kg columns removed (places
   are in the header fields, kg in the cargo table). Road orders show Leg ·
   Mode · Truck/Trailer · Driver/Phone; sea/air/rail orders show Leg · Mode ·
   Container/Seal · BL/AWB; mixed orders show both sets.
9. **Cargo table: SO number fixed.** Goods rows created before the SO link have
   it backfilled live from the shipment's derived SO links.
10. **Terms by mode.** Road-only orders keep the standard 10 CMR clauses.
    Sea/air/rail orders get a **manually entered terms text** (edited right in
    the transport-order screen, one line per clause, saved on the shipment and
    reused for its future orders). Empty terms print as "as per separate
    agreement / booking confirmation".
11. **Goods line** now reads "Food goods - clean trailer / container · Towar
    spozywczy - czysta naczepa / kontener" to cover all modes.
12. **Customs clearance** on the document prefers the live broker picked from
    Contacts over legacy free text. The agreed-price fallback no longer prints
    the whole shipment's PLN total on a single provider's order (now "TBA / per
    agreement") — same privacy principle as point 7.
13. **Leg checkboxes** in the order screen are labelled "Leg #1 · Road" to
    match the edit form.

## Settings
14. **"Port warehouse"** added to the custom location types — for the
    forwarder-indicated warehouse at the port of loading used as the road
    leg's destination in export flows.

(Coming in v6.5.0: rented-warehouse storage & sorting charges — kg/day and
pallet/day tariffs with optional free period, per-lot kg-day accrual, sorting
log, and monthly expected-vs-invoice reconciliation per warehouse.)
