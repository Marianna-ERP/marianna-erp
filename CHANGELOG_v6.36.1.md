# v6.36.1 — P2 visibility: stock age in Inventory · PO KPIs from real state

## Inventory — stock age (the number fresh produce runs on)
- Every lot row now shows its **arrival date and age in days** (from the first real receipt),
  colour-coded: ≤7 d green, 8–14 d amber, >14 d red.
- New **sort control**: Oldest stock first / Newest first (lots with no arrival sort last).

## PO KPIs — derived from what actually happened
- The old cards counted PO **statuses** that nothing auto-advances (a PO often stays
  "Confirmed" while its shipments and lots move on) — so "ARRIVED" was permanently 0 and
  "LOADING OVERDUE" kept flagging POs whose goods had long since shipped.
- Now derived from linked state: **OPEN** (not closed/cancelled) · **GOODS IN** (a lot with
  real received kg) · **OPEN VALUE** · **LOADING OVERDUE** excludes any PO with a live
  (Booked+) shipment or received goods.

## Honest corrections to the system review
Three review findings were over-claims from too-narrow greps, discovered while building:
the Container/BL fields were already mode-gated; Inventory **already had** a 5-card KPI strip
(IN STOCK / STOCK VALUE / AT PORT / WITH VARIANCE / DAMAGED); and **VALUE was already a list
column** (with cost/kg). Only the age/arrival gap and the PO KPI staleness were real — those
are what this release fixes. Working code was left untouched.

## Gate (verified twice)
- Suite 172/172 · typecheck 0 · eslint unused 0 · real CRA build PASSED.

## Next (per the plan)
- P3: Claims register + SO-side entry point.
