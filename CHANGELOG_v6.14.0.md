# v6.14.0 — Transport-confirmation cluster (leg / unit / document rework)

This is the second half of the post-test batch. It completes the shipment
rework you asked to see as one whole form. v6.14.0 includes everything from
v6.13.0 plus the leg/unit/document/transport-confirmation changes below.

> Transpile/syntax-checked only — no `node_modules` here. Please run
> `npm install && npm run build` locally, then check the complete shipment form.

## Leg vs unit data model
- **#4 — Temperature recorder moved to the unit.** Removed from the shipment
  header; each truck/container now has its own "Temp recorder no." (different load,
  different recorder).
- **#5 — Container number is per unit; seal number removed.** The sea/rail leg no
  longer has Container or Seal fields. One shipment can carry several containers,
  each entered on its own unit. Seal isn't used, so it's gone everywhere.
- **#6 — Booking no., BL no. and shipping line stay on the leg** and cover all
  units on that leg (shown once).
- **#12 — CMR number per road unit** (each truck has one CMR).

## Documents section
- **#9 — "Transport order" removed from the checklist** — it's tracked from the
  email sent to each carrier/forwarder, not as a manual row.
- **#13 — "CMR" removed from the checklist** — it's captured per road unit.
- **#10 — BL reference comes from the leg** (read-only in the document row, no
  double entry).
- **#11 — Export-declaration reference comes from the Inventory export clearance**
  (the lot's SAD/MRN), shown read-only in the document row.
- Old shipments that already had Transport order / CMR rows simply hide them in the
  editable list.

## Transport confirmation (the carrier/forwarder order)
- **#7a — Per-leg data now resolves correctly.** The unit table shows Container
  (per unit), BL/AWB (BL from the leg, AWB per air unit), CMR (per road unit) and
  Temp recorder (per unit). Booking / BL / line appear once as a leg-level field.
  The format and bilingual EN/PL terms are otherwise unchanged.
- **#7b — Email button is now inside the transport-order document** (next to
  Print / PDF), matching the PO and SO document toolbars.

## Also in this version (carried from the v6.13.0 half)
Carrier/forwarder/customs pull from Counterparties (type fallback); PO lifecycle
bar standardised to the SO style; Inventory "Record quality issue" as its own red
button with a "where detected" field; sea-unit Kg width fixed; credit notes split
into client (outgoing) vs supplier/transporter (incoming).

## Please verify when testing
- Open an **existing** shipment and confirm its transport confirmation still shows
  the correct From/To, carrier, dates and cargo.
- Enter a container per unit, a CMR per road truck, a temp recorder per unit, and a
  BL on the sea leg — then check they appear correctly on the printed order.
- Confirm the export-declaration row picks up the SAD/MRN from the lot's Inventory
  export clearance.
