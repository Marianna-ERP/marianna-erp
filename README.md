# MARIANNA ERP — Integration Shell

Integrated build of the FreshTrade ERP. Purchase Orders, Inventory, Sales Orders, Shipments and Counterparties run together with shared state, plus a dashboard.

## What's in this folder

```
freshtrade-erp/
├── package.json
├── tsconfig.json
├── public/
│   └── index.html
├── src/
│   ├── index.tsx           ← React entry point
│   ├── App.tsx             ← shell: top nav, holds all state
│   ├── Dashboard.tsx       ← Phase 1 dashboard
│   ├── Contacts.tsx        ← integrated (accepts shell state)
│   ├── PurchaseOrders.tsx  ← integrated
│   ├── Inventory.tsx       ← integrated (reads live SOs from shell)
│   ├── SalesOrders.tsx     ← integrated (reads live lots + POs from shell)
│   ├── Shipments.tsx       ← integrated logistics / transport module
│   └── shell_seed.ts       ← combines each module's seed data
└── standalone/             ← standalone module copies for solo testing
    └── Shipments.tsx
```

## How to run in StackBlitz

1. Open https://stackblitz.com/fork/react-ts
2. **Replace `package.json`** with the one from this folder (adds `xlsx` for Contacts' Fakturownia import)
3. **Delete the default `src/App.tsx`** that StackBlitz generated
4. **Upload everything from `src/`** into the StackBlitz `src/` folder (drag-and-drop all files)
5. Replace `public/index.html` with the one from this folder
6. StackBlitz auto-reloads. You should see the top nav with 6 tabs (Dashboard / Purchase Orders / Inventory / Sales Orders / Shipments / Counterparties) and the dashboard view by default.

## How to run a single standalone module

The `standalone/` folder includes standalone modules that work on their own (no shell required). To test one:

1. Open https://stackblitz.com/fork/react-ts
2. Paste the standalone module's contents into `src/App.tsx`
3. For Contacts specifically, add `"xlsx": "^0.18.5"` to package.json. Shipments does not need extra dependencies.
4. Save — that one module renders alone

## What works end-to-end

- **Cross-module reservations**: confirm an SO in Sales Orders → open the lot in Inventory → see the reservation appear under "RESERVATIONS"
- **Live source picker**: the SO source picker reads real lots from Inventory state and real POs from PO state — so available kg in the picker reflects current Inventory + commitments from other SOs
- **Dashboard KPIs**: pull from all four state slices live; click a card to jump to that module
- **Edits persist across module switches** (within the same browser session — no backend yet)

## What's deliberately not wired yet

- **Client/supplier picker integration**: SO still uses its local CLIENTS array, PO still uses local SUPPLIERS. The Contacts module is editable but those edits don't yet flow to the SO/PO dropdowns. This is a follow-up pass.
- **Auto-lot creation on PO confirmation**: when a PO is confirmed, no Expected lot is created in Inventory automatically. The lot has to be added manually.
- **Auto SHIP_OUT on SO Shipped**: when an SO is marked Shipped, the corresponding lot doesn't get a SHIP_OUT movement automatically. Manual workflow for now.

These are workflow enhancements, not architectural problems. The shared-state plumbing is in place; the workflows just need to be wired through the appropriate `setX` callbacks.

## State architecture

All canonical state lives in `App.tsx`:

```js
const [contacts, setContacts] = useState(SHELL_SEED.contacts);
const [pos, setPOs]           = useState(SHELL_SEED.pos);
const [lots, setLots]         = useState(SHELL_SEED.lots);
const [orders, setOrders]     = useState(SHELL_SEED.orders);
const [shipments, setShipments] = useState(SHELL_SEED.shipments);
```

Each module accepts these as optional props. When props are provided (integration mode), they're used directly. When not (standalone mode), each module falls back to its local seed via `useState`.

The Inventory module's `lotReservations(lot, sourceSOs)` and `soRefsFor(lot, sourceSOs)` accept the live SOs array as a second argument — same pattern.

The SalesOrders module syncs the module-scope `LOTS` and `PO_REFS` references at the top of every render. This is a pragmatic choice (the alternative was plumbing data through ~14 call sites in 4 internal functions). It works because React renders synchronously, so the assignment happens before any reader runs.

## Known quirk — module-scope mutables

`SalesOrders.tsx` uses `let LOTS` and `let PO_REFS` at module scope. These are intentionally not `const`. They get reassigned at the top of each render of the main `SalesOrders` component. This pattern is **not safe under React Strict Mode or concurrent rendering** because the same module could be invoked twice in parallel render passes. For now, with non-Strict-Mode standard rendering, it's fine.

If we hit Strict Mode in the future, the fix is to refactor `LOTS` and `PO_REFS` into a React ref or context that the helpers read from via a hook. Two passes of refactoring instead of one — defer until needed.


## Shipments / Logistics module

This version adds `src/Shipments.tsx` and a standalone copy in `standalone/Shipments.tsx`. The module tracks road, sea and multimodal shipments, prints a carrier transport order confirmation, stores truck / driver / container / BL data, records expected logistics costs, sends shipments to a billing queue, and can allocate logistics costs into linked Inventory lots.

See `SHIPMENTS_MODULE.md` for the scenario guide.

## Update 2026-05-28 - Shipments v2

This update adds the second version of the Shipments / Logistics workflow.

Highlights:

- PO -> Inventory transfer is blocked if product, quantity or price are missing/zero.
- Cancelled SOs are soft-cancelled and can reverse Inventory `SHIP_OUT` movements with an auditable `REVERSAL` movement.
- Sales Orders now support email draft generation similar to Purchase Orders.
- Transport Orders are bilingual English / Polish, include the MARIANNA logo, and can be prepared for email from the shipment detail page.
- Shipment header statuses are reduced to Booked, Confirmed, Loaded, Arrived, Delivered, Closed and Cancelled.
- Shipment header modes are Road, Sea, Rail, Air and Multimodal.
- Shipment legs now support Air mode.
- Each leg can track multiple transport units, allowing one shipment to contain multiple trucks, containers, AWBs or rail units.
- Seed scenario `SHP-2026-0070` demonstrates 4 sea containers split into 5 road trucks after port arrival.

See `UPDATE_2026_05_28.md` for details.
