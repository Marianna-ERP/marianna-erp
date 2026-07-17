# v6.35.2 — Phase C step 4: customs stages from shipments; flow key fully demoted to legacy fallback

The final planned Phase C step for Inventory. The obsolete flow model no longer drives any
lot behaviour as the primary source — it survives only as a last-resort fallback for genuinely
legacy lots (old data with a flow key but no shipments/incoterms).

## What changed
- The lot's **customs indicator** is now derived from its **real shipments** — a shipment with
  customs applied, classified by trade direction (import / export / both for cross-trade) —
  instead of the flow template's customs stages. A lot whose shipment has no customs shows no
  customs note; one whose shipment clears import customs shows "import", etc. (Runtime-tested.)

## Flow key status after this step
`FLOW_TYPES` in Inventory is now read in exactly two places, both **legacy fallbacks only**:
- ownership-per-stage — reached only when a lot's incoterms can't be resolved (v6.35.1 made
  incoterms the primary source);
- the journey template — reached only when a lot has neither a stored journey nor any shipments
  (v6.34.9 made shipment legs the primary source).

Every primary path — direction badge, journey timeline, ownership, customs — is now
shipment/incoterm-derived. The table is kept (not deleted) so existing legacy lots don't break
during real-data testing; it can be removed later once no legacy lots remain.

## Not in scope here
- The separate `FLOW_TYPES` table in PurchaseOrders still has active reads (incoterm-family
  labels, the sea-default hint). That's a distinct retirement, handled separately when we turn
  to the PO module — not stacked here.

## Gate (verified twice + runtime smoke)
- Suite 170/170 · typecheck 0 · eslint unused 0 · real CRA build PASSED.
