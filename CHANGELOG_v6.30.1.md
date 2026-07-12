# Update v6.30.1 — Cross-module coherence fix batch

Fresh read of the whole codebase against the v6.17 audit and the Batch 0–7a decisions.
Good news first: the audit gate sequence is verifiably implemented (stable ids, structured
soRef, auto SHIP_OUT, lot-delete guard, replace-by-source in Finance and costAllocation,
single FX source). This batch fixes the drift and gaps found around those decisions.
Suite: 117 → 125 scenarios, all passing. Full typecheck clean.

## Fixes

1. **integrityCheck — false LOT_OVERSOLD on shipped lots (error-level noise).**
   The checker still used the wide 7-status reserving set that Batch 1 removed as dead
   code: Shipped+ orders already had their kg subtracted via SHIP_OUT, so counting them
   as reserving double-subtracted and flagged every correctly shipped lot as oversold.
   Now aligned with `SO_PRE_DISPATCH_STATUSES` (Confirmed/Reserved/Loading).

2. **integrityCheck — ORPHAN_SO_POLINE was dead.** `|| po.items.length > 0` made the
   check pass whenever the PO had any line at all. Now strict when the SO line names an
   explicit `sourceLineId`; legacy lines (null id) keep the lenient fallback.

3. **warehouseCharges — voided movements accrued charges.** `computeStoragePeriods` and
   the handling in/out sums now exclude `voided` movements, in parity with
   `recomputeLotFromMovements` (v6.18.17). A voided IN no longer inflates kg-days or
   handling in the expected warehouse invoice / monthly reconciliation.

4. **types.ts — ShipmentLeg contract corrected.** The declared field names
   (originLocationId/destinationLocationId/loadingDate/unloadingDate/units) were never
   used by any code; every builder and the posting engine use
   fromLocationId/toLocationId/fromCustom/toCustom/plannedPickupDate/…/vehicles.
   Contract now matches reality so future modules can't code against phantom fields.

5. **Settlement commission invoice — Invoices crash + empty Fakturownia payload.**
   `category: "COMMISSION"` was outside the InvoiceCategory union and unmapped in
   CATEGORY_META: closing a settlement crashed the Invoices list render. Added to the
   union + meta (violet badge), and category lookups now fall back to OTHER instead of
   crashing. The draft's positions also used a non-canonical shape
   ({description, qty, unitPrice}) invisible to buildFakturowniaPayload — now
   {name, quantity, unit, vatRate, grossTotal}, so a push carries the real line.

6. **SO cancel — phantom stock on direct lots.** `reverseCancelledSOInInventory`
   restored physicalKg on pass-through lots that were never in our warehouse, creating
   sellable phantom stock. Direct lots are now skipped; physically delivered goods come
   back via a RETURN shipment or a claim, not a cancel.

7. **Shipment posting — over-issue surfaced (7a parity).** OUTBOUND posting clamped an
   over-issue silently; it now accumulates `overIssuedKg` exactly like the movement
   reducer, so the LOT_OVER_ISSUE safeguard also catches shipment-driven over-issues.

8. **Last hardcoded FX removed.** The EUR display fallback in Shipments costs (4.25)
   now uses `defaultFxRate("EUR")` from fx.ts.

Cosmetic: integrityCheck section comments renumbered (two sections were both "5"/"6").
tests/tsconfig.json adds `"types": []` (TS 4.9 chokes on newer transitive @types/node
under Node 24) and compiles warehouseCharges/fx/ids/invoicing for the new scenarios.

## New test scenarios (8)
- Shipped SO no longer raises LOT_OVERSOLD; pre-dispatch oversell still flagged.
- ORPHAN_SO_POLINE fires on an explicit missing line id; legacy null id tolerated.
- Voided IN excluded from kg-days + handling; voided SHIP_OUT doesn't reduce storage.
- Commission invoice survives buildFakturowniaPayload with name + gross intact.
- OUTBOUND over-issue lands in overIssuedKg and is flagged end-to-end.
