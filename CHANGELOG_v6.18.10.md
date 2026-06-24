# v6.18.10 — Inventory correctness: ship-out location & client-side quality claims

Two inventory bugs from testing. The other inventory points (journey steps, moving
customs out of Inventory, return-to-warehouse flow) are still in design — decided
separately.

## #3 — A partial ship-out no longer "moves" the remaining stock to the client
Shipping part of a lot used to stamp the *whole* lot's location as the client, so the
remainder looked like it was "at the client" (and Record movement defaulted "From" to
the client, and a partly-shipped lot wrongly showed "Shipped Out"). Now a ship-out
reduces stock but **leaves the lot located in the warehouse** until its physical
quantity reaches zero. So: ship 20 of 100 → 80 kg stays **In Stock at the warehouse**,
and "From" defaults to the warehouse. The movement still records where the 20 kg went.

## #5 — A client-side quality issue no longer depletes your warehouse stock
When a defect is found **at the client after you shipped**, recording it used to
subtract from warehouse stock (your 100 → ship 20 → report 5 gave 75 instead of 80).
Now, when "Detected at" is a client location, the quality issue becomes a **client
claim**:
- it does **not** change warehouse stock (your example correctly stays at 80),
- you pick the delivery/SO and enter the agreed credit value + currency,
- it creates a **draft credit note** to the client (linked to that sales invoice if one
  exists), which you finalise in Invoices.

A defect found **at our warehouse / on arrival** still behaves as before (Damage reduces
stock on hand; Reclassify changes grade). The "Detected at" answer decides which path
runs, so the form barely changes.

## Please test
1. Receive a lot (e.g. 100 kg), ship 20 via an EXW ship-out → remainder shows 80 kg
   **In Stock at the warehouse**; Record movement "From" defaults to the warehouse.
2. Fully ship a lot → it shows Shipped Out.
3. Record a quality issue with "Detected at = At the client": stock is unchanged, and a
   draft CREDIT note for the value you entered appears in Invoices (under Credit/debit
   notes), linked to the sales invoice if there is one.
4. Record a quality issue with "Detected at = At our warehouse": stock reduces as before.

## Still to decide (Inventory review, not in this build)
- #1 Journey steps that stay unfilled after arrival (make them event-driven, or demote
  to the movement history).
- #2 Move customs out of Inventory onto the Shipment (EU vs non-EU; broker vs forwarder;
  T1 transit) — agreed in principle.
- #4 Return-to-warehouse after a dispute (return shipment + cost + stock reversal).

## Verified
- Type-checked clean (0 project errors) via the offline stub harness.

> Run `npm install && npm run verify` locally before deploying.
