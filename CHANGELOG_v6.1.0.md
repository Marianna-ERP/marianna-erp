# v6.1.0 — Lot Journey foundation (6.1a): enriched flows + data-driven isDirectFlow

This is the FOUNDATION step for the lot journey & ownership feature. It is deliberately
small and low-risk: nothing the user sees changes, no seed data changes, and the one
behavioural function (isDirectFlow) is proven to give identical results to before.

## What changed (internal only)

1. **Each of the 11 flow codes is now enriched with explicit journey/ownership fields**
   (additive — the existing group/short/desc/buyIncoterms/defaultRequiresSea are untouched):
   - `direction` (EXP/IMP)
   - `landsInOwnWarehouse` (does the goods physically pass through OUR warehouse)
   - `buyOwnershipStart` / `sellOwnershipEnd` — the journey points where goods BECOME
     ours and STOP being ours, derived from the buy/sell Incoterm. The "owned" segment
     runs between them. (CIF/CFR purchases: we take ownership at the DESTINATION port,
     per your confirmation.)
   - `stageTemplate` — the ordered journey stages for that flow (supplier → road → port
     → customs → sea → dest port → our WH / client, as applicable).

2. **`isDirectFlow()` now reads the explicit `landsInOwnWarehouse` field** instead of
   string-matching the flow code. VERIFIED: produces identical results to the old
   string logic for all 11 flows (so direct-flow lot creation behaves exactly as
   before). The old string heuristic remains as a fallback for safety.

## What this enables (next steps, not in this build)
- 6.1b: generate the lot journey (planned stages) when a PO is CONFIRMED.
- 6.1c: ownership boundary overlay (dim not-yet-owned / handed-over stages).
- 6.1d: customs as an independent overlay.

## Test
Nothing visible should change. Confirm normal operation:
- POs still confirm, ship, and create lots correctly (direct-flow POs especially).
- The flow dropdown, labels, and descriptions are unchanged.
