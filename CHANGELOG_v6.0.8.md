# v6.0.8 — Manual pallet field on Sales Order lines

Added a **Pallets (for this sale)** field to each Sales Order line item, next to
Packaging. This is entered manually rather than inherited from the PO, because an SO
often sells only PART of a PO line — so the PO's full pallet count wouldn't be correct
for the sale.

- The value flows into any shipment built from the SO (Goods → Pallets), replacing the
  old behaviour where SO-built shipments showed a wrong kg-based guess or 0.
- The pallet count also shows in the SO detail line (e.g. "L · Spain · 5 kg carton · 12 pallets").
- Leave it blank if not yet known; it simply shows 0/— downstream until entered.
