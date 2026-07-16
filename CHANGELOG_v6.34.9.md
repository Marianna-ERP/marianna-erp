# v6.34.9 — Phase C (flow retirement), Step 2: lot journey from real shipments

Continuing the staged retirement of the obsolete flow model. This step replaces the SOURCE
of a lot's journey timeline — from the static flow template to the lot's actual shipment legs.

## What changed
- A lot with no stored journey now builds its journey **from its real shipment legs**
  (origin → each leg's mode + destination), instead of the `FLOW_TYPES` stage template. An
  EXW-purchase + CIF-sale lot now shows its true path (e.g. "Producer WH → Road → Koper Port →
  Sea → Client WH") rather than a canned "IMP · EXWs → our WH" template.
- Stage labels now prefer the **real leg-derived label**; the flow template label is used only
  as a fallback for legacy lots that have neither a stored journey nor any shipments.
- Progress (done/active/pending + actual dates) continues to be driven by real shipment legs,
  customs and movements exactly as before — only the base template source changed.

## Deliberately staged
- The flow key still backs **ownership-per-stage** (`ownershipForStage`) and the customs-stage
  set for legacy lots. Those are the next Phase C steps, done separately and gated — not stacked
  here, to keep Inventory stable during your real-data testing.

## Verification
- Runtime smoke-tested (a road+sea lot produces the correct 3-stage journey from its legs).
- Suite 166/166 · typecheck 0 · eslint unused 0 · real CRA build PASSED (verified twice).
