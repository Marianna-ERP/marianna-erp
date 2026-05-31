# v6.0.4 — Shipment / transport-order testing fixes (round 3)

NOTE: The shipment you were testing was built BEFORE these fixes, so its old
values (WH-01 origin, wrong carrier, zero leg costs) are saved in your browser.
Delete that test shipment and create a FRESH one from your export PO to see the
fixes take effect.

1. **Phantom WH-01 Poznań in the general/detail route** — two root causes fixed:
   - The Create-Shipment modal had hardcoded defaults `originLocationId: 1` (WH-01)
     and `destinationLocationId: 10`. These now start empty (null) so the PO drives them.
   - `buildShipmentFromPO` now sets the origin from the supplier's REAL address as
     free text when the supplier isn't in the fixed location list (so new baseline
     suppliers like "Owoce Polska" work, instead of falling back to WH-01).
   - The detail-view route line now derives From → To from the actual first/last leg,
     not the stale shipment-level origin/destination.

2. **Cost removed from the Route/legs section** — that line showed 0 (misleading);
   the real per-leg figures live in the Cost / Billing section below.

3. **Transport order showed the wrong carrier (Trans-Logistics instead of PolTrans)** —
   root cause: for a MULTIMODAL shipment the create modal's provider picker only
   edited the forwarder, never the carrier, so the carrier stayed at its default.
   Now multimodal/sea shows BOTH a "Road carrier" and a "Sea forwarder" picker,
   each with a "— none —" option, so your chosen carrier is actually saved.

4. **Pallets** — there was no pallets input anywhere. Added a **Pallets** field to
   each Purchase Order line item (next to Packaging). The value flows into the
   shipment goods (PO/SO/Lot → pallets column) instead of being auto-guessed.
   Two seed POs now carry sample pallet counts (33 and 20) for demonstration.

Also retained from the previous round: export/import label by flow direction,
per-leg costs start at 0, SO ref carried into goods, provider dropdown lists only
real leg providers, transport units counted per selected order, "DLA CARRIER"
Polish header, one-page A4 print.

## Test (with a FRESH shipment)
1. Open a PO line item → set the **Pallets** value, save.
2. Delete the old test shipment.
3. Create a new shipment from your export PO; for multimodal pick BOTH the road
   carrier (PolTrans) and the sea forwarder (Adriatica).
4. General/detail route should show supplier → port (no WH-01).
5. Route/legs section shows no cost line; Cost/Billing shows the real figures.
6. Transport order → provider dropdown offers PolTrans and Adriatica; picking
   PolTrans shows PolTrans (not Trans-Logistics), 1 unit for the single road leg.
