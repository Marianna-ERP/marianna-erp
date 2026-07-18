# v6.37.1 — Direct costs reach Finance: freight mirror sync · auto-allocation · accrual P/L

Fixes the reported loss: a shipment with truck + container + customs costs showed nothing in
Finance even after allocation and delivery. Root causes verified with a runtime reproduction;
the same scenario is now a permanent test (truck 4 500 + sea 8 000 + customs 1 200 → all in
lot landed cost).

## Freight mirror sync (the core fix)
- Freight entered on the shipment's **legs** (the truck rate, the sea rate) now mirrors into
  the shipment's **costs** on every save — one managed line per leg with a stable identity,
  exactly like the customs sync. Previously costs were a one-time snapshot taken at creation
  (when legs were usually 0), so later leg-cost edits were financially invisible.
- Re-syncing preserves each line's **invoice status and invoice reference**; clearing a leg's
  cost removes its line; legacy snapshot lines are adopted, never duplicated; manually added
  cost lines are never touched.

## Delivery allocates automatically (ruling: automate)
- Marking a shipment **Delivered** now allocates its costs into lot landed cost automatically
  (idempotent — replace-by-source). Editing costs on an already-allocated shipment
  re-allocates on save, so lot costing never goes stale. The manual button remains for
  allocating earlier.

## Cancellation reverses allocated costs (backward gap)
- Cancelling a shipment now also removes its allocated cost lines from lots — no phantom
  landed cost from a cancelled shipment (the cost-side mirror of the v6.35.5 stock reversal).
  The confirmation toast reports both reversals.

## Actual P/L is accrual (your ruling A)
- In the **actual** P/L, a cost counts once its shipment is **Delivered/Closed**, even if the
  supplier's invoice hasn't arrived — the P/L of a concluded trade shows its true result.
  Invoice status keeps tracking payables separately; before conclusion, only invoiced costs
  count. The old behaviour silently zeroed un-invoiced costs forever.
- The P/L's stale warning banner is replaced by an accurate description of the flow.

## Gate (verified twice)
- Suite 166 → **169** (mirror-sync + adoption + ref-preservation + accrual) · typecheck 0 ·
  eslint unused 0 · real CRA build PASSED.
