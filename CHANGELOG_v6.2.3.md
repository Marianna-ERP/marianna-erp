# v6.2.3 — Quality Issue workflow + Packaging materials

## Record Quality Issue (discoverable now)
- A red "⚠ Record quality issue" button sits next to "Record movement" on every lot,
  and on the Quality Issues card — so it's easy to find (the inspection entry point was
  previously unclear).
- Damage and Reclassify are removed from the plain movement dropdown; they are now
  recorded as quality issues (quality-driven, as they should be). The stock write-off
  (Damage/weight loss/rejection) and the audit entry (Reclassify) are still created
  automatically behind the scenes.
- A quality issue captures: when/context (arrival, storage, customs, client feedback),
  the issue type, a free "where it happened" note (e.g. collapsed on 1st leg due to bad
  driving; reefer too warm on sea leg; mould reported by client), affected kg, and
  findings.
- Works for direct export too: when the client reports a problem after delivery, record
  it against the lot — no warehouse stop required.

## Credit notes can target any invoice
- A quality issue can propose a credit note and you choose which invoice it is against:
  supplier, carrier (1st leg), forwarder (sea leg), the client's sales invoice, or other.
  The proposal (amount, currency, target) is stored on the lot, ready for the Invoicing
  module to formalise.

## Packaging materials (own stock)
- "+ New packaging material" in Inventory creates a simple stock item (crates, cartons,
  pallets) held at our warehouse, counted in units.
- It uses the normal movement engine: receive in (Stock In), and dispatch to a supplier
  either free (a Ship Out movement) or with a truck (create a Shipment).
- Packaging items skip the produce-specific journey and customs views.

(Test build — empty shell; data is browser-local, export from Settings to back up.)
