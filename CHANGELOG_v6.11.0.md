# v6.11.0 — 12-point fix batch (PO · SO · Shipments · Inventory · Finance)

Addresses the issues reported after testing v6.10.0. Every source file passes a
TypeScript transpile/syntax check.

> Build note: this package ships without `node_modules`, so a full type-checked
> `react-scripts build` was not run here. Run `npm install && npm run build`
> locally to confirm a clean production build before deploying.

## Purchase Orders
- **#1 — Print currency.** A new PO's first line was hard-coded to PLN while
  added lines inherited the order currency, so a EUR PO printed line 1 in PLN and
  line 2 in EUR. Changing the order currency now propagates to every line, and the
  printout / detail show the order currency consistently.
- **#2 — Deleting a line left the item in Inventory.** Saving a PO now prunes the
  still-expected lot of any removed line. Only lots with no received goods and no
  movements are removed, so real stock is never lost.

## Sales Orders
- **#3 — Line total spilled out of the form.** The item row declared 8 columns but
  rendered 9 fields, so everything after Qty was misaligned. The grid is now 9
  columns and the total cell is shrink-safe.
- **#4 — P&L figures overflowed with large PLN values.** The profitability card is
  now a 2×2 grid with right-sized, tabular, truncation-safe figures.
- **#5 — Actual delivery date** is disabled until the SO status is **Delivered**.
- **#6 — Import permit / ACID “Not Applicable”.** Each field has a *Not applicable*
  toggle (stored as “N/A”); the duplicate cross-check and save-guard skip N/A.
- **#7 — Destination guidance now matches the Incoterm:** EXW → no destination
  (client collects); FCA/FOB → relay or port of departure; CIF/CFR → port of
  arrival; DAP/DDP → client address or another address the client indicates.

## Shipments
- **#9 — Removed the date helper wordings** (“· loaded at supplier” / “· delivered
  to client”) on the create- and edit-shipment Loading / Expected-delivery dates,
  since they don't fit every case.
- **#10 — DAP/DDP supplier-paid transport.** Costs & billing has a toggle: *Bought
  DAP/DDP — supplier arranges & pays transport*. When set, it explains there's no
  freight cost on our side and unlocks the otherwise-protected freight line so it
  can be removed.

## Inventory
- **#8 — EXW Ship Out “Quantity exceeds max 0”.** A Ship Out is the physical
  dispatch, but it was capped by reserved-net availability (0 once the lot is sold
  for EXW). It's now capped by the physical (or expected, for direct flows)
  quantity, so EXW dispatches can be recorded. From = supplier/our warehouse, To =
  client address (all locations selectable).
- **#11 — Movement vs Quality issue.** The lot action modal now has two tabs:
  **Movement** (Receipt / Transfer / Ship Out) and **Record quality issue**
  (Damage / Reclassify, for post-sorting results). Damage & Reclassify are no
  longer mixed into the movement list.

## Finance
- **#12 — Credit notes.** A new **Credit Notes** tab records credit notes related
  to transport, shipments, clients, suppliers or warehouses: date, direction
  (incoming = received by us / outgoing = issued by us), counterparty, category,
  related ref (shipment / PO / SO / invoice), amount, currency, FX, status and
  reason. It totals incoming vs outgoing (and net) in PLN. Data persists in local
  storage and is included in the Settings → Export JSON backup.

## Files touched
- `src/PurchaseOrders.tsx` — currency propagation + print/detail currency; orphan-lot pruning on save.
- `src/SalesOrders.tsx` — line grid; actual-delivery gating; permit/ACID N/A; incoterm destination guidance.
- `src/SOMarginCard.tsx` — P&L 2×2 layout for large figures.
- `src/Shipments.tsx` — removed date helper text; DAP/DDP supplier-managed-transport toggle.
- `src/Inventory.tsx` — Ship Out cap fix; movement / quality-issue tabs.
- `src/Finance.tsx` + `src/App.tsx` — Credit Notes feature + persisted store.

## Still open / partial
- **#8 (part 2 of earlier):** structured warehouse-counterparty dropdown inside the
  SO destination selector still needs `contacts` threaded into the SO form; the
  free-text destination covers manual entry in the meantime.
- **Credit notes** are recorded and totalled in their own tab; automatic netting
  into the Receivables & Payables position is not wired yet (reconcile via the
  “Related ref” field for now).
- **Boxes** on the printed PO document (captured and shown in-app; print template
  still lists kg/pallets).
