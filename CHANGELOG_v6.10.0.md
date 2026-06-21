# v6.10.0 — 14-point fix batch across six modules

Completes the batch begun in v6.9.1 (Finance + Counterparties) with the Purchase
Orders, Shipments and Sales Orders fixes, plus a user manual. Every source file
passes a TypeScript transpile/syntax check.

> Build note: this package ships without `node_modules`, so a full type-checked
> `react-scripts build` was not run here. Run `npm install && npm run build`
> locally to confirm a clean production build before deploying.

## Finance → Operational Costs (carried from v6.9.1)
- Entries register now shows **Date · Supplier · Category · Status · Amount**,
  with a **hover-preview** of full detail and inline **Edit / Delete**.
- **Filter by period and by supplier**, with a live count + filtered total.
- Wider Fakturownia import column detection (invoice no. + date variants).

## Counterparties (carried from v6.9.1)
- Merge: NIP + EU-VAT are one paired choice, so a stale VAT can't resurface.
- Tariff / commission inputs accept comma decimals (`0,30`); coerced on save.
- “Locations this warehouse operates” lists all warehouse locations + every
  warehouse counterparty’s address(es).
- Warehouse counterparties can hold **multiple delivery addresses**.

## Purchase Orders (new in v6.10.0)
- **#9 — Ship gating:** a PO can’t move to **Shipped / Arrived / Closed** while
  its **loading date is still in the future**; the change is blocked with a clear
  message. Update the loading date if it actually changed.
- **#10 — Boxes per line:** each item line now has a **Boxes** field; it’s shown
  in the read-only detail table (with a column total) and travels with the data.

## Shipments (new in v6.10.0)
- **#11 — DDP purchase:** the create-shipment **Provider & cost** section detects
  a DDP purchase and switches to capturing the **incoming truck + driver** (the
  supplier arranges the carrier). The created leg carries **no freight cost on
  our side**, no ordered carrier, and the truck/driver seed the leg’s first unit.
- **#12 — Free-text From/To:** the leg **From** and **To** selectors now always
  show a **free-text box below the dropdown**, so a place/address can be typed
  manually (e.g. for DDP). Typing overrides the dropdown for that side.
- **#13 — Unit-scoped vehicle data:** truck plate, trailer plate, driver name and
  phone are **only in the per-unit section** now (the duplicate leg-level fields
  were removed). Units are what the transport order is built from. Existing legs
  with legacy truck/driver values still appear as a unit automatically.
- **#14 — DDP leg cost:** a DDP supplier→warehouse leg is created with **zero
  cost** and `costResponsibility = "Supplier"`, so it carries no road-freight
  charge on our books.

## Sales Orders (new in v6.10.0)
- **#15 — Delivery destination:** the **Incoterm · Delivery** section now has a
  **“Deliver to”** choice: **Client’s registered address** (the default —
  auto-filled from the selected client) or **Other address**. “Other” reveals the
  known-place dropdown plus a **free-text** field for a one-off delivery address.
  The chosen destination prints on the SO (free text takes precedence).

## Files touched in v6.10.0
- `src/PurchaseOrders.tsx` — ship-date guard, boxes field + detail column.
- `src/Shipments.tsx` — DDP create block, always-on free-text From/To, units as
  the single home for truck/driver, DDP zero-cost leg.
- `src/SalesOrders.tsx` — destination mode (client address default + Other).
- `src/Finance.tsx`, `src/Contacts.tsx`, `src/locations.ts`,
  `src/warehouseCharges.ts` — carried from v6.9.1.

## Still open (noted, not yet built)
- **#8 (part 2):** a structured **warehouse-counterparty dropdown** inside the
  SO destination selector. The helpers exist in `locations.ts`
  (`warehouseDestinationOptions`), but wiring them into the SO form needs the
  full `contacts` list threaded into `OrderForm`. The free-text destination
  already lets a warehouse address be entered manually in the meantime.
- Surfacing **Boxes** on the printed PO document (it is captured and shown in the
  app’s detail view; the print template still lists kg/pallets only).
