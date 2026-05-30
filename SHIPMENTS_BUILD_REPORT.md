# Shipments build report

## Added

- `src/Shipments.tsx`: integrated logistics / shipment module.
- `standalone/Shipments.tsx`: standalone copy that can be pasted into `src/App.tsx` for isolated testing.
- `SHIPMENTS_MODULE.md`: scenario and workflow notes.

## Integrated in shell

- `App.tsx` now imports `Shipments`.
- The top navigation now includes `Shipments`.
- `App.tsx` owns canonical `shipments` state using `SHELL_SEED.shipments`.
- `Shipments` receives live `contacts`, `pos`, `lots`, `orders` plus the corresponding setter callbacks.
- `shell_seed.ts` imports `INIT_SHIPMENTS` from `Shipments.tsx`.
- `Dashboard.tsx` now accepts `shipments` and shows a logistics KPI card.

## Main workflows now simulated

- Create shipment from PO.
- Create shipment from SO.
- Create manual road / sea / multimodal shipment.
- Generate printable road transport confirmation based on the carrier order facsimile.
- Mark confirmation generated / sent.
- Register truck plate, trailer plate, driver name and driver phone.
- Register container, seal, booking, BL, vessel and voyage.
- Record expected freight / customs / handling cost lines.
- Send shipment to billing queue.
- Allocate logistics costs into linked Inventory lot costing.
- Apply inventory movements for linked lots, including `SHIP_OUT` for SO deliveries.
- Link shipment numbers back to related PO and SO records.

## Verification

A TypeScript `noEmit` check was run with temporary local shims for React / XLSX because `node_modules` are not installed in this runtime. The check passed with no project errors after the shims were added. The shims were removed before packaging.
