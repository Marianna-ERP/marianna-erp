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


## V5.5 — PO/SO destination handling and SO document parity

- PO UI wording now says **Purchase Incoterm** instead of **Buy Incoterm**. The internal field name remains `buyIncoterm` to avoid a storage migration.
- Sales Orders can now print/save PDF and open the email workflow directly from the edit form for any non-draft SO, matching the Purchase Orders flow.
- PO and SO destination dropdowns now include common ports used in export/import flows, plus a free-text destination override for missing ports or one-off terminals.
- For direct export CIF/CFR sales, the PO/SO destination should be the **client destination port**. For DAP/DDP it should be the **client receiving site**. For EXW it should normally be the pickup warehouse/site.
- Inventory and Shipments now know the same common port IDs so expected lots and transport orders display port destinations correctly.

## V5.6 - Shipments revision

The Shipments module now separates transport mode from warehousing costs, supports open/manual From-To leg locations, allows extra legs only when needed, and generates carrier/forwarder-specific transport orders with only the selected provider's relevant legs and agreed price. See `V5_6_SHIPMENTS_REVISION.md`.

## V5.7 - Finance overhead allocation

This version adds operational overhead into Finance. Sales P/L now shows contribution margin before overhead and net P/L after allocated operational costs. The new Finance → Operational Costs view lets testers add salaries, rent, accountant fees, general petrol, software and other overhead, then allocate those costs to Sales Orders by revenue, kg sold, order count, shipment count, gross margin, manual allocation or not allocated.

See `V5_7_FINANCE_OVERHEAD.md` for details.

## Update V5.8 - Integrity workflows

This version adds integrity rules requested during testing:

- Contact edits refresh saved PO/SO counterparty snapshots and transport documents resolve providers from live Contacts.
- SOs cannot move past Draft while any referenced PO is Draft, Cancelled or missing.
- Direct-flow POs create `Direct Expected` traceability lots in Inventory instead of pretending goods arrive in Marianna warehouse.
- Inventory linked documents now shows SOs sourced from the PO behind a lot, not only SOs sourced directly from a stock lot.
- Manual Inventory movement is clarified as receipt/adjustment/exceptional correction; cost-bearing physical movements should be managed from Shipments.
- Cancelled POs block related expected lots and return non-terminal related SOs to Draft for sourcing review.

See `V5_8_INTEGRITY_WORKFLOWS.md` for details.

## Update V6.3.0 - Feedback batch

- Contacts: duplicate detection on save (tax-ID strict + fuzzy name), a field-by-field merge dialog that combines people/linked docs and re-points existing documents, and a "Find duplicates" scan.
- Inventory: fixed Record movement / Record inspection erroring on any quantity for direct-flow lots; fixed lot status derivation after the v5.8 location consolidation; Linked now also shows SOs connected via shipments; compact quantity breakdown.
- Shipments: loading/expected-delivery date semantics clarified; Vehicles field removed (derived unit count); customs/broker dropdown from Contacts; billing status moved to Costs and billing; standard conditional document checklist + DHL courier tracking for documents sent to client; numbered legs; grouped From/To selectors with auto-chaining; mode-driven leg/unit fields; Multimodal defaults to 2 legs, other modes to 1.
- Sales Orders: Import permit no. and ACID no. fields (printed and emailed), with a single-use duplicate alarm and recorded override.
- Settings: user-managed custom locations/ports available across all modules and included in JSON export/import.

See `CHANGELOG_v6.3.0.md` for details.

## Update V6.4.0 - Shipment & transport order rework

- PO supplier filter shows only suppliers with POs (with counts; dropdown when many).
- Shipments list rows are one compact line (number · mode · status + missing-docs dot); detail header trimmed to number/mode/status/billing + PO/SO/LOT pills, with SO links derived from all sources.
- Temp recorder no. field (checklist + printed order); per-currency cost subtotals with PLN total and EUR equivalent; per-leg pickup/delivery time fields.
- Transport order is now strictly leg-scoped: places and date+time from the selected legs only (no shipment-level fallback — fixes the supplier-privacy leak and the CIF date logic); mode-driven unit table without From→To/Kg; SO backfilled in cargo; road orders keep standard CMR terms, sea/air/rail orders use manually entered terms saved per shipment; goods line covers trailer/container.
- "Port warehouse" custom location type.

See `CHANGELOG_v6.4.0.md` for details.

## Update V6.4.1 - System test & date-integrity hotfix

40 engine scenario tests added and passing (margins, overhead, duplicates, checklists, inventory recompute). Fixes: dead delivery-vs-PO-arrival warning; PO overdue off-by-one; pre-carriage delivery date default; local-time "today" everywhere; Dashboard upcoming-deliveries includes today; header-vs-leg date drift warning; legacy datetime display; Settings reset copy; Goods table SO backfill. See CHANGELOG_v6.4.1.md.

## Update V6.5.0 - Warehouse charges

Warehouse tariffs on Contacts (kg/day + pallet/day, handling, sorting, free days, operated locations); per-lot expected charges card with sorting log and per-lot expected invoice in Inventory; Finance → Warehouse charges tab with monthly expected-vs-invoice reconciliation, variance, and Approve & allocate into lot landed costs (flows into SO P/L). New pure engine warehouseCharges.ts; test suite now 48 scenarios. See CHANGELOG_v6.5.0.md.

## Update V6.6.0 - Consignment & settlement

Consignment pricing mode on POs (no purchase price — settled on sales); seasonal commission rates on producers; per-lot/truck settlement in Inventory with auto gross sales, full expense deduction, bilingual printable statement, producer-invoice variance, and closing that writes producer invoice + commission credit into lot costs so SO P/L equals the commission; CN/HS codes on SO lines and the printed SO. New engine consignment.ts; suite now 56 scenarios. See CHANGELOG_v6.6.0.md.

## Update V6.7.0 - Fakturownia cost bridge

Invoice-number field on operational costs; Copy last month button; Import from Fakturownia (cost register XLS/CSV) with lenient PL/EN column detection, duplicate protection, category guessing, per-row allocation method, and automatic routing of warehouse suppliers into the Warehouse charges reconciliation. Fixed a Finance prop-annotation issue that would have broken the production build. Suite now 64 scenarios. See CHANGELOG_v6.7.0.md.

## Update V6.7.1 - Build hotfix

Fixed the TS2551 build failure in SalesOrders (expectedDeliveryDate vs the standalone stub's expectedDelivery). Releases are now verified with a full TypeScript type-check replicating the production build. Cumulative zip — supersedes v6.4.1 through v6.7.0.

## Update V6.8.0 - Fakturownia live bridge (read-only)

Settings → Fakturownia connection (account + API token, kept browser-local and excluded from exports, with Test connection). Finance → Operational Costs gains live "Fetch cost invoices from Fakturownia" (read-only) feeding the same review screen as the file import, with duplicate protection, category guessing and warehouse routing. Graceful CORS fallback to file import. See CHANGELOG_v6.8.0.md.

## Update V6.9.0 - Financial loop closed

Finance gains a Receivables & Payables ledger (sales invoices in; producer payouts, warehouse/cost invoices and firm POs out; overdue flagged; mark-paid; net position). SO detail gains read-only Fakturownia sales-invoice matching (KSeF number + paid status, flowing into Receivables). TEST_SCENARIOS.md rewritten for v6.9. New engine ledger.ts; suite now 72 scenarios. See CHANGELOG_v6.9.0.md.
