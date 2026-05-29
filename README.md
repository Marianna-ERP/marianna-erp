# MARIANNA ERP — Integrated Prototype

Integrated React + TypeScript prototype for FreshTrade / MARIANNA ERP.

## Modules included

- Dashboard — live operational KPI overview
- Finance — aggregate P/L analytics
- Purchase Orders — procurement workflow and PO -> Inventory expected lot creation
- Inventory — lots, movements, reservations and cost allocation
- Sales Orders — SO lifecycle, sourcing, email/print workflow and inline P/L card
- Shipments — logistics tracking for road / sea / rail / air / multimodal movements
- Counterparties — clients, suppliers, carriers, forwarders, warehouses and contacts
- Settings — local JSON export/import/reset for tester data

## Project structure

```txt
freshtrade-erp/
├── package.json
├── tsconfig.json
├── public/
│   └── index.html
├── src/
│   ├── index.tsx
│   ├── App.tsx
│   ├── Dashboard.tsx
│   ├── Finance.tsx
│   ├── Contacts.tsx
│   ├── PurchaseOrders.tsx
│   ├── Inventory.tsx
│   ├── SalesOrders.tsx
│   ├── Shipments.tsx
│   ├── Settings.tsx
│   ├── SOMarginCard.tsx
│   ├── marginCalculations.ts
│   ├── useLocalStoredState.ts
│   └── shell_seed.ts
└── standalone/
    └── Shipments.tsx
```

## How to run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## How to build

```bash
npm run build
```

## Data persistence

The app is still frontend-only. It stores tester data in the browser using localStorage. Use **Settings -> Export all data as JSON** before resetting or sharing a test scenario.

## Key workflows to test

1. Create/confirm a PO with valid product, quantity and price; check that an Expected lot appears in Inventory.
2. Create/confirm an SO sourced from stock; check the reservation in Inventory.
3. Ship and then cancel an SO; check the Inventory REVERSAL movement.
4. Open Shipments and test the bilingual EN/PL transport order email/print flow.
5. Open a Sales Order detail page and review the P/L card.
6. Open Finance and review aggregate profitability by client, product and month.
7. Use Settings to export/import/reset browser-local data.
