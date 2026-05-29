# MARIANNA ERP — V5 integration pass

This package reconciles the uploaded V4/V5 file set with the latest corrected Shipments v2 base.

## Main fixes in this package

- Rebuilt `src/App.tsx` so all uploaded modules are actually mounted:
  - Dashboard
  - Finance
  - Purchase Orders
  - Inventory
  - Sales Orders
  - Shipments
  - Counterparties
  - Settings
- Restored the corrected Shipments v2 workflow and kept it integrated with PO / SO / Inventory.
- Kept the Sales Order email workflow from the corrected v2 build.
- Kept Purchase Order -> Inventory validation from the corrected v2 build.
- Kept Sales Order cancellation reversal into Inventory from the corrected v2 build.
- Added localStorage persistence using `useLocalStoredState.ts` for contacts, POs, lots, SOs and shipments.
- Added Settings module route for JSON export, JSON import and reset to demo data.
- Added Finance module route and passed live `orders`, `lots`, `pos` and `shipments` into it.
- Injected `SOMarginCard` into Sales Order detail pages, with live lots / POs / shipment costs.
- Added a Dashboard KPI card for current-month margin and navigation to Finance.
- Updated App navigation to include Finance and Settings.

## Validation

A TypeScript `noEmit` project check was run in this environment with temporary local shims for React/XLSX because `node_modules` are not installed in the sandbox. The project source check passed with 0 TypeScript errors. The temporary shim file was removed before packaging.

For local verification, run:

```bash
npm install
npm run build
npm start
```

## Notes

This remains frontend-only. All persistence is browser-local via localStorage. For multi-user shared data, the next architectural step is a real backend with authentication, database storage and audit trail.
