# v6.35.3 — Phase C complete: PurchaseOrders flow demoted to legacy fallback

The final Phase C step. Every primary path across Inventory AND PurchaseOrders is now
shipment/incoterm-derived; the flow key survives only as a dormant legacy fallback for old data.

## PurchaseOrders changes
- **Sea-default hint** now derives from the buy incoterm (freight-onward CIF/CFR/CPT/CIP → sea)
  instead of the flow template's `defaultRequiresSea`.
- **Ownership** in the PO's expected-lot journey seed now uses the real buy/sell incoterms
  (via `ownershipAtPoint`), matching Inventory (v6.35.1). The flow-key ownership is fallback only.
- The PO **FlowBadge** was already incoterm-first (v6.29.0); `FLOW_TYPES` is now read only inside
  legacy fallback branches (badge fallback, incoterm-family labels, journey-seed stages for old POs).

## Phase C — COMPLETE
- Step 1 (v6.34.7) lot direction badge from shipment ✓
- Step 2 (v6.34.9) lot journey from shipment legs ✓
- Step 3 (v6.35.1) ownership-per-stage from incoterms ✓
- Step 4 (v6.35.2) lot customs from shipments ✓
- Step 5 (this) PurchaseOrders flow demoted to fallback ✓

The obsolete flow model no longer drives any behaviour for records with real data. `FLOW_TYPES`
is retained (not deleted) purely so genuinely legacy lots/POs don't break — removable later once
no legacy records remain (see the cleanup plan discussed with the team).

## Gate (verified twice)
- Suite 170/170 · typecheck 0 · eslint unused 0 · real CRA build PASSED.
