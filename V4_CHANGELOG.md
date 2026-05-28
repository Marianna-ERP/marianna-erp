# V4 — Finance & P/L

## What's new

Two new modules and one big new feature visible inside SalesOrders.

### 1. Per-SO Profitability card (inside SalesOrders → SO detail)

Every SO detail page now shows a "Profitability · P&L" card at the top, between the lifecycle bar and the line items.

**What it shows:**
- Revenue (in SO currency AND PLN)
- Total costs (COGS + direct logistics)
- Margin amount (PLN) and percentage
- Color-coded margin: green (healthy), amber (thin <5%), red (loss)
- Stacked bar visualization of cost composition
- Loss warning callout if margin is negative
- Thin-margin warning if margin is 0–5%
- Expandable details: revenue lines, COGS lines per lot/PO, direct cost lines per shipment

**Forecast vs Actual toggle:**
- **Forecast**: counts the full SO commitment (whether shipped or not), uses PO purchase prices as cost proxy for stock not yet arrived, uses all expected shipment costs
- **Actual**: counts only kg actually shipped (traced via SHIP_OUT movements), uses real lot costs, only counts shipment costs with invoiceStatus ≠ "Expected"

**Auto-selects** based on SO status: Confirmed/Reserved/Loading → Forecast; Shipped/Delivered/Invoiced/Closed → Actual. User can flip.

### 2. New Finance module (top-nav tab)

Full P/L analytics across all SOs. Four sections:

- **Overall KPI strip** — Revenue, COGS, Direct, Margin (with %) across all active orders
- **Pipeline vs Delivered** — split between not-yet-shipped (forward-looking) and settled (historical)
- **Top clients by margin** — top 10 by margin contribution, with revenue and margin %
- **Top products by margin** — same breakdown by product family
- **Monthly trend** — last 6 months

Same Forecast/Actual toggle as the per-SO card. Cancelled SOs excluded everywhere. Drafts excluded from aggregates.

### 3. Margin this month on Dashboard

New 6th KPI card in the Dashboard top row. Click → jumps to Finance.

## Architecture

**New files:**
- `src/marginCalculations.ts` — pure functions, no React. `computeSOMargin()` is the heart; `aggregateMargins()` and `groupAndAggregateMargins()` are convenience wrappers for Finance.
- `src/SOMarginCard.tsx` — the inline P/L card
- `src/Finance.tsx` — the new module

**Modified files:**
- `src/SalesOrders.tsx` — accepts `shipments` prop, OrderDetail renders SOMarginCard
- `src/App.tsx` — Finance nav + route, passes shipments to SalesOrders
- `src/Dashboard.tsx` — Margin this month KPI card, grid 5→6 columns

**Unchanged:**
- Inventory, Purchase Orders, Contacts, Shipments, Settings — all the same

## What the math does

For each SO line, COGS attribution:

```
STOCK line:
  attributable_kg = (mode == "actual" ? net_ship_outs_for_so_from_lot : line_qty)
  line_cogs = attributable_kg × lot_cost_per_kg  (in PLN)
  where lot_cost_per_kg = sum(lot.costs[].pln) / lot.receivedKg

PO line:
  if mode == "forecast":
    line_cogs = line_qty × po.unitPrice × po.fxRate
  if mode == "actual":
    if PO has arrived (matching lot exists):
      use lot-based attribution (same as STOCK)
    else:
      line_cogs = 0 (PO not yet arrived → no actual cost yet)
```

Direct costs from `Shipments[].costs[]` where `shipment.soRefs` includes this SO. Filtered by `invoiceStatus` in Actual mode (only counted if Received/Cost allocated, not Expected).

Revenue: `qty × unitPrice` per line, total × `fxRate` → PLN. Actual mode shows 0 for not-yet-shipped lines.

## Known notes / future work

**Seed data warning:** The included seed data has Yellow Bell Pepper with cost basis 12.15 PLN/kg sold at 2.85 PLN/kg in SO-2026-0091. The math is correct; the seed is unrealistic. Real data will produce realistic margins. When you fix seed numbers later, set lot costs proportional to sale prices (~70-80% of sale price for a healthy 20-30% margin).

**REVERSAL handling:** If an SO was Shipped and then Cancelled, the lot's SHIP_OUT is reversed via a REVERSAL movement. The margin code subtracts REVERSAL kg from SHIP_OUT kg when computing actual attribution, so Cancelled SOs correctly show 0 COGS in actual mode.

**Currency model:** All COGS and direct costs reported in PLN. SO-currency totals shown for revenue and margin (since those are quoted in the deal currency). When we add invoicing, we can add EUR/USD-only views.

**Phase 2 P/L features (deferred):**
- Overhead allocation (configurable % per SO, or auto-distributed)
- Per-line shipping status (partial SO shipments)
- Receivables aging
- Cash flow forecast
- FX exposure analysis
- Supplier payment schedules

## Update workflow

If you've already deployed V3 to Vercel via GitHub:

1. Open your local `marianna-erp/` repo folder
2. Copy these from V4/src into `src/`:
   - `marginCalculations.ts` (new)
   - `SOMarginCard.tsx` (new)
   - `Finance.tsx` (new)
   - `SalesOrders.tsx` (replaces existing)
   - `App.tsx` (replaces existing)
   - `Dashboard.tsx` (replaces existing)
3. Open GitHub Desktop → review changes
4. Commit message: `V4 — Finance module + per-SO P/L cards`
5. Push to GitHub
6. Wait ~30 seconds for Vercel to rebuild

Your testers will see the new tabs the next time they reload the page. **Their existing data is preserved** — V4 only adds new components, doesn't change the localStorage schema. `STORAGE_VERSION` stays at 1.

## What to test

Open any seed SO that's Shipped (e.g., SO-2026-0091) and look at the P/L card:
- It should show ACTUAL view by default (status is Shipped)
- Toggle to FORECAST and watch numbers change
- Open "Show cost breakdown" — verify line-level COGS attribution
- Open Finance tab → see all SOs aggregated by client, product, month
