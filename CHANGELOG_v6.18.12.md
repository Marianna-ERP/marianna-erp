# v6.18.12 — Customs moves to the Shipment (#2) + Return to warehouse (#4)

Two model changes from the inventory review. Test on real data before deploying.

## #2 — Customs clearance now lives on the Shipment, not the lot
Customs isn't a property of a lot sitting in a warehouse — it's a per-shipment event
that only happens when crossing the EU border. So:

- **Inventory** no longer manages customs. The lot's CUSTOMS panel is now a short
  read-only note pointing to the shipment; the journey's customs step still completes
  automatically when the goods arrive (the v6.18.11 back-fill).
- **Shipments → open a shipment → Customs clearance** is a new structured section:
  - "Customs clearance applies" (tick only when the shipment crosses the EU border —
    EU→EU needs none).
  - **Cleared by:** Our PL broker · Forwarder (abroad) · T1 transit + our local broker.
  - Country of clearance, status (Pending / In progress / Cleared), **T1 transit** flag.
  - **Customs cost** + currency + FX — synced into the shipment's cost lines as a
    `customs` line (so it allocates and reaches Finance like any other cost).

  The on-screen guidance restates the rules: export cleared by your PL broker or the
  forwarder abroad before exit; CIF import cleared at EU entry by the forwarder, or moved
  under T1 and cleared by your local broker.

## #4 — Return to warehouse after a dispute
When a client sends cargo back, open the lot → **↩ Return to warehouse** (the button
appears once a lot has been shipped out). Enter the returned kg, the from/to locations,
the return transport cost, date and reason. On confirm:

- the returned kg are **restored to your warehouse stock** (a reversal movement, and the
  lot's location moves back to the warehouse), and
- the return truck is booked as its **own shipment** (`RET-YYYY-####`, purpose RETURN,
  Delivered) carrying the **return-freight cost**, so the cost is captured.

A return is a **standalone event**: it does **not** reopen or alter the original sales
order. Settle the money side with the client through a quality issue / credit note
(the #5 flow) if a credit is due.

## Please test
1. Shipment → Customs clearance: tick applies, pick a role, enter a cost → save → a
   `customs` cost line appears on the shipment; untick → the line is removed.
2. Inventory lot → the CUSTOMS panel is now just a pointer to the shipment (no Edit).
3. A lot you've shipped out → ↩ Return to warehouse → stock goes back up, location is the
   warehouse, and a `RET-…` shipment with the return cost appears in Shipments.
4. Confirm the original SO is untouched by the return.

## Verified
- Type-checked clean (0 project errors) via the offline stub harness.

> Run `npm install && npm run verify` locally before deploying. This is a model change
> across Inventory + Shipments — please run the scenario tests.
