# v6.34.8 — SO multi-shipment parity + PO/SO create-dialog unification

You can now create multiple shipments from an SO exactly as from a PO, and both paths present
the same information the same way — so you can fairly test which is the more convenient entry
point with real data.

## SO multi-shipment, with partial quantities (parity with PO)
- The SO builder now honours **per-line "ship now (kg)"** (defaults to the line's remaining
  un-shipped quantity), selected-lines ticking, and stamps **soLineId** so per-line shipped-kg
  is counted correctly across several shipments.
- An SO line of 30 000 kg can ship 12 000 on one truck and the remaining 18 000 on the next —
  the second shipment defaults to 18 000 and doesn't false-block. (Test-pinned.)

## Unified create dialog (PO and SO show the same thing)
- The over-ship **guard + progress bar** (already shipped / this shipment / total, with the
  block message) now render for **both** PO and SO sources via one source-agnostic state — no
  more PO-only progress. Labels read "This SO…" / "This PO…" appropriately.
- The **Products-to-load** tick list with the per-line ship-now inputs now appears for **SO**
  sources too, identical to PO.
- The consume-aware counting (v6.34.6: only Booked-plus, fulfilling movements count) applies
  uniformly to both sources.

## Gate (verified twice)
- Suite 165 → **166** (SO line split across two shipments) · typecheck 0 · eslint unused 0 ·
  real CRA build PASSED.

## Next
- Continue the staged flow retirement (Phase C): retire FLOW_TYPES journey timeline +
  ownership-per-stage, replacing with shipment-derived truth, module by module.
