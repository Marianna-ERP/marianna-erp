# v6.34.7 — Flow retirement, Step 1: fix the two Inventory symptoms

The obsolete flow model is being retired in careful stages. This first step removes the two
confusing symptoms you're actually hitting, WITHOUT ripping out the flow key wholesale (the
journey/ownership rendering still uses it and is load-bearing for existing lots — that's the
staged Phase C that follows).

## Symptom 1 — the lot no longer mislabels its movement
- A lot from an **EXW purchase + CIF sale** was showing "IMP · EXWs → our WH", derived from the
  static PO flow key. The lot detail and list now show a **direction badge derived from the lot's
  actual shipment** (which owns the trade direction since v6.34.0) — Import / Export / Intra-EU /
  Cross-trade, resolved from the real ends. The old flow-key `FlowBadge` is removed.

## Symptom 2 — manual movement is scoped to transfers + corrections
- The Record-movement dialog now leads with **Transfer** (relocation between your locations) as the
  primary manual action, and states plainly that **receipts and dispatches are driven by Shipments**
  (marking a shipment Delivered posts the receipt / ship-out with transport + cost + paperwork
  linked to the lot). **Receipt (IN)** remains for opening balances / corrections on manually-created
  lots; **Ship Out** remains only for the genuine EXW "client collects with own truck" case (no
  transport on our side). This matches the agreement that manual movement = transfers, everything
  else governed by the shipment module.

## Deliberately NOT done here (staged Phase C, next releases)
- The `FLOW_TYPES` table still drives the lot journey timeline + ownership-per-stage. Retiring it
  means replacing those consumers with shipment-derived truth, module by module, each fully gated —
  not a risky big-bang during your real-data testing.

## Gate (verified twice for stability)
- Suite 165/165 · typecheck 0 · eslint unused 0 · real CRA build PASSED.
