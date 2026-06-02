# v6.2.0 — Inspection & weight-loss (V6.2), on the lot

Inspection now lives inside Inventory, on the lot, and can be recorded at ANY stage —
not only on arrival.

## Inspections card (lot detail)
- "Record inspection" opens a dialog where you set:
  - When/context: Arrival QC, Warehouse-reported, Client feedback, or Customs examination.
  - Outcome: Passed, Weight loss / shrinkage, Damaged / spoiled, Quality downgrade, or
    Client rejection.
  - Affected quantity (kg) for outcomes that reduce stock.
  - Findings / notes.
  - Optionally, a proposed credit note (amount + currency).
- Recorded inspections are listed on the lot with context, outcome, any kg lost,
  findings, and any proposed credit note.

## Outcomes connect to the rest of the system
- A weight-loss / damage / rejection outcome automatically records a DAMAGE write-off
  movement for the affected kg, so stock on hand, location and status are recalculated
  through the same movement engine (consistent with manual movements).
- A proposed credit note is stored on the lot and clearly marked as "to be issued in
  Invoicing" — formal issuing will come with the Invoicing module.

This is a TEST build (empty shell). Still browser-local; export from Settings to back up.
