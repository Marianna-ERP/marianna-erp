# v6.5.0 — Warehouse charges: tariffs, accrual, sorting log, invoice reconciliation

The DDP-papryka problem: goods sit in a rented warehouse that bills storage per
kg/day (or per pallet/day) plus per-kg sorting — and you need to double-check
their invoices. v6.5.0 predicts those charges from data the system already has.

## Contacts — Warehouse tariff
- Counterparties of type **Warehouse** get a tariff section: storage **per
  kg/day AND per pallet/day** (pallet basis is used when its rate is set and the
  lot has a pallet count), handling in/out per kg, sorting per kg, **free days**
  from receipt (default 0), currency + FX, and the **locations this warehouse
  operates** (links the tariff to WH-01, WH-02, or your custom warehouse
  locations).

## Inventory — per-lot expected charges
- Lot detail gains a **"Warehouse charges — expected"** card: chargeable
  kg-days (or pallet-days) computed day-by-day from the lot's movements
  (receipt → partial dispatches → today), storage / handling-in / handling-out /
  sorting lines, and a highlighted **"Expected invoice for this lot (to date)"**
  total — covering warehouses that bill **per lot at dispatch**.
- **+ Record sorting** button: log "sorted N kg on date" the day it happens;
  each event prices at the tariff's sorting rate. Sorting does not change
  stock — rejected kg are still recorded as quality issues.
- Free period correctly reduces only the storage line; same-day in/out yields
  zero storage but still charges handling.

## Finance — Warehouse charges tab (monthly reconciliation)
- New third tab next to Operational Costs. Pick **warehouse + month**: every
  lot's expected charges for that month (storage clipped to the month,
  handling/sorting events inside it) sum to **the invoice you should receive**.
- **Record the actual invoice** (number, amount, currency/FX, date) when it
  arrives → instant **variance** (red = warehouse charged more than the tariff
  predicts), with the per-lot breakdown to find where.
- **Approve & allocate**: splits the invoiced PLN across the month's lots
  proportionally to their expected charges and writes it into each lot's
  **landed cost** — flowing automatically into SO P/L and Finance analytics
  through the existing margin engine. Approval is idempotent (re-approving
  can't double-charge a lot) and approved invoices can't be deleted.
- Warehouse invoices are part of the data set: persisted, exported/imported
  with the Settings JSON.

## Engine & tests
- New pure module `warehouseCharges.ts` (no UI, no storage) with **8 executed
  scenario tests**: kg-day math across partial dispatches, free-period
  clipping, pallet-basis precedence, monthly window clipping across two
  months, same-day in/out, EUR→PLN conversion, no-tariff null. Total test
  suite now 48, all passing.
