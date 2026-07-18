# v6.37.0 — The flow model is gone: one-time data migration + full code retirement

The lean-out release you green-lit. The legacy "flow" key — demoted to a dormant fallback
through Phase C (v6.34.7 → v6.35.3) — is now removed from BOTH stored data and code.

## One-time data migration (automatic, on first load)
On the first open after deploying, the storage runner migrates your data v1 → v2:
- **POs**: any pre-incoterm PO gets its **buy incoterm / trade movement / direct-flow**
  backfilled from its legacy flow key; the flow key is then dropped.
- **Lots**: buy incoterm backfilled from the (migrated) PO. A legacy lot that never shipped
  and relied on the old template journey gets that journey **baked into stored data** one last
  time — nothing you could see is lost. Lots with shipments keep deriving their journey live.
- The migration is a frozen, self-contained snapshot (it imports no live app code), pure and
  idempotent, covered by 4 dedicated tests plus a runtime rehearsal of the real runner.
- **Your v1 data keys are kept untouched as a safety copy** — the runner's built-in backup.
  Settings → Export remains the recommended manual backup before deploying.

## Code retired (the lean part)
- Both **FLOW_TYPES** tables (Inventory + PurchaseOrders) — deleted.
- The **flow ⇄ struct shim** (FLOW_TO_STRUCT, structToFlow, flowToStruct, reconcilePOFlow,
  composePOFlow) — deleted. PO save now derives direct-ness live from the governing sale
  (poDirectFromSOs); no flow key is ever written again.
- `isDirectFlow` / `directFlowLabel` / the template journey seed / flow-based ownership and
  stage labels — deleted. `flow` and `flowLabel` removed from the type model.
- **Kept, because they're live**: `directFlow` (from the sale's cargo plan) and the
  "Direct Expected" status; `custodyType` remains readable for old records.

## A real improvement the cleanup exposed
Shipment-derived journey stages carried a placeholder ownership ("ours"). They now compute
**real ownership per stage from the buy/sell incoterms** — the EXW+CIF lot shows
owned-through-destination-port / handed-over-after on its live shipment journey too.

## Behaviour note
A lot with no shipments no longer shows a canned template journey — its journey appears from
its first shipment (legacy never-shipped lots keep their baked journey from the migration).

## Gate (verified twice + runner rehearsal)
- Suite **166/166** — 10 tests of the retired shim removed (their behaviour lives on as the
  migration's frozen tables, freshly tested), 4 migration tests added · typecheck 0 ·
  eslint unused 0 · real CRA build PASSED.
