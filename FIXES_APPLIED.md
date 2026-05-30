# MARIANNA ERP - Fix pass

This package contains the corrected project files prepared from the uploaded ERP integration shell.

## Main fixes applied

- Fixed the duplicate `finance` property in `Contacts.tsx`.
- Hardened the Fakturownia/XLSX FileReader import path in `Contacts.tsx` by validating `ArrayBuffer` before reading.
- Added TypeScript-safe `any` props to small JSX helper components and main shell modules where TypeScript inferred `{}` or mandatory props incorrectly.
- Fixed shell prop typing for `Contacts`, `PurchaseOrders`, `Inventory`, `SalesOrders`, and `Dashboard`.
- Integrated live Contacts into Purchase Order supplier dropdowns via `getCounterpartiesByType(..., "Supplier")`.
- Integrated live Contacts into Sales Order client dropdowns via `getCounterpartiesByType(..., "Client")`.
- Corrected seed inconsistency: `PO-2026-0121` now matches the SO source product (`Red Bell Pepper`).
- Corrected `PO-2026-0121` destination location from an invalid ID to a valid warehouse ID.
- Added missing `Euro-Papryka Tarczyn` client location in Inventory for `SHIP_OUT` movements using `toId: 14`.
- Replaced hardcoded overdue comparison date in Purchase Orders with `new Date()`.
- Updated Sales Order reservation logic so shipped/delivered/invoiced/closed orders are not double-counted against Inventory availability in integrated mode.
- Fixed the Sales Order `Date.now()` double-call bug when creating a new shipped SO and opening the invoice modal.
- Added a safer manual `SHIP_OUT` bound in Inventory using live available kg so manual movements cannot consume reserved stock.

## Validation notes

- A TypeScript `noEmit` check was run in this environment using temporary module shims because `node_modules` was not available here.
- The temporary shim file was not included in this package.
- In your local/StackBlitz environment, run `npm install` and then `npm run build` or `npm start` with the package dependencies.

## Files included

- `package.json`
- `tsconfig.json`
- `README.md`
- `public/index.html`
- `src/index.tsx`
- `src/App.tsx`
- `src/shell_seed.ts`
- `src/Dashboard.tsx`
- `src/Contacts.tsx`
- `src/PurchaseOrders.tsx`
- `src/Inventory.tsx`
- `src/SalesOrders.tsx`
