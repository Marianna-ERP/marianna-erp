# v6.33.2 — dead-code elimination + typecheck restoration (Batch 7 · B7-7)

A cleanup release from the thorough analysis pass. No behavior changes intended; every
removal is a symbol the compiler proved unreferenced.

## Removed (49 unused-symbol warnings → 0)
- **An entire dead feature:** Inventory's CustomsModal + its state, save handler, brokers
  list and the LotDetail prop — customs has lived on the Shipment (structured, per-leg)
  since Batch 3; this was the pre-rebuild leftover, unreachable from any button.
- **Flow-era leftovers in PurchaseOrders:** FLOW_DESTINATION_TYPE, locType, the stage
  stepper state, and five imports from the retired flow-first model (the shim itself stays —
  legacy POs still reconcile).
- **Three dead constant tables in the trade engine** (TRADE_MOVEMENTS / HANDOVER_POINTS /
  CARGO_PLANS — the old dropdown datasets, referenced by nothing including tests).
- Dead local components (Finance Lbl, Shipments TextArea), dead helpers (consignment/
  documents norm, chipStyle ×2, locationInputValue/locationDatalistId), and ~15 unused
  locals/imports across all modules and engines.

## Fixed
- **`npm run typecheck` restored to a real gate:** root tsconfig gains `"types": []` (the
  same TS-4.9 fix v6.32.0 applied to the tests config) — 6,591 lines of @types/node noise
  → **0 errors**, so the script means something again.
- HOW_TO_DEPLOY.md Node version corrected to 24.x (both mentions).

## Honesty note
- The cleanup itself tripped three traps — two brace-matching orphans and one duplicated
  `const loc` where the *used* copy was removed first — all caught by the type-check +
  real-build gates before packaging. Working exactly as designed since v6.26.1.

## Gate
- Suite **152/152** · typecheck **0 errors total** · eslint unused-vars **0** ·
  **real CRA production build: PASSED**. Complete-repo zip per P-6.
