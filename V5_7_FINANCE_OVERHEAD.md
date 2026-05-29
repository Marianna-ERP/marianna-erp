# MARIANNA ERP V5.7 - Finance Overhead Allocation

This update implements the recommended P/L structure for every Sales Order:

```txt
Revenue
- COGS / landed product cost
- Direct logistics and shipment costs
= Contribution margin

Contribution margin
- Allocated operational overhead
= Net P/L
```

## Added

- `src/operationalCosts.ts`
  - Operational cost seed data
  - Allocation methods
  - Overhead allocation engine
  - SO margin with overhead
  - Net aggregate and grouping helpers

## Finance module changes

The Finance tab now has two views:

1. **Sales P/L**
   - Revenue
   - COGS
   - Direct shipment costs
   - Contribution margin
   - Allocated overhead
   - Net P/L
   - Top clients by net P/L
   - Top products by net P/L
   - Monthly net P/L

2. **Operational Costs**
   - Add/edit/delete overhead entries
   - Track cost period, category, cost center, amount, currency, status and allocation method
   - Compare Forecast allocation vs Actual allocation

## Operational cost fields

Each operational cost contains:

- period, e.g. `2026-05`
- date
- category: salary, office rent, accountant, petrol, software, bank fees, insurance, phone/internet, office supplies, other
- supplier/payee
- amount, currency, FX rate and amount PLN
- cost center: admin, sales, operations, logistics, finance, general
- allocation method
- status: Budget, Expected, Received, Posted, Paid

## Allocation methods

- `by_revenue` - default for general overhead such as office rent
- `by_kg_sold` - useful for operations/logistics salaries
- `by_order_count` - useful for accountant/admin workload
- `by_gross_margin` - allocates more to more profitable SOs
- `by_shipment_count` - useful for logistics coordination overhead
- `manual` - explicit SO allocations
- `not_allocated` - tracked but excluded from SO P/L

## Forecast vs Actual

Forecast includes:

- Budget
- Expected
- Received
- Posted
- Paid

Actual includes only:

- Received
- Posted
- Paid

This allows you to compare expected profitability before month-end against real booked overhead after supplier invoices / payroll / admin costs are posted.

## Sales Order detail

The SO profitability card now shows:

- Revenue
- Contribution margin before overhead
- Allocated overhead
- Net P/L after overhead
- Detailed overhead lines in the cost breakdown

## State and persistence

`operationalCosts` is now part of the shell state and localStorage export/import/reset flow.

Existing Vercel deployments can apply the patch without changing `package.json`.
