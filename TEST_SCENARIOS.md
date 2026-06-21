# MARIANNA ERP — Test Scenarios (v6.9)

End-to-end tests for real-data testing. Work top to bottom; each lists what to do
and what you should see. Export your data (Settings -> Export) before big changes
so you can share the exact state if something looks wrong.

This build is browser-local: data lives in this browser only. Back it up via
Settings -> Export regularly.

---

## 0. Setup & roles
- Settings -> set role **General Manager**, name "GM". Reload -> both persist.
- Switch to **Operations**, reload -> still Operations. Set back to GM.

## 1. Counterparties - incl. new fields
- Create a **Supplier** "Papryka Farm". In its card add a **commission season rate**:
  season "2026/27", valid-from 2026-06-01, 10%.
- Create a **Warehouse** "Logipark" -> fill the **Warehouse tariff**: storage
  0.01/kg/day, sorting 0.10/kg, 2 free days; tick the location it operates (add a
  warehouse location first in Settings -> Locations & ports if needed).
- Create a **Client** with a tax/NIP number (needed for invoice matching later).
- **Duplicates:** create "Papryka Farm Sp. z o.o." -> expect the fuzzy duplicate
  warning with Open / Merge / Save-anyway. Try Merge; try the toolbar Find duplicates.

## 2. Locations & ports
- Settings -> Locations & ports -> add a port and a "Port warehouse". Confirm they
  appear in PO/SO/shipment destination dropdowns.

## 3. Firm-price PO -> Inventory
- New PO, Pricing = **Firm price**, products with qty + price + pallets, export flow.
  Confirm -> Expected lot in Inventory. Email PO -> "Dear ...," signs "MARIANNA".

## 4. Consignment PO (the papryka case)
- New PO, supplier = **Papryka Farm**, Pricing = **Consignment - settled on sales**.
- Expect: price fields show "Consignment"; saves/confirms WITHOUT prices; printed PO
  shows "Konsygnacja / Consignment". Confirm -> a consignment lot with empty cost base.

## 5. Sales Orders - sourcing, permit/ACID, CN code
- New SO, client = your tax-ID client. 2 lines sourced from the PO(s).
- Fill **Import permit no.**, **ACID no.**, and a **CN/HS code** per line.
- Reuse the same permit/ACID on a second SO -> live warning + blocking alarm on save
  with an override option.
- Email & print the SO -> permit, ACID, CN/HS appear on the document.

## 6. Shipments - leg-scoped transport orders
- Create a **Multimodal** shipment from an export PO -> expect 2 legs by default
  (road pre-carriage + sea). Single-mode shipments start with 1 leg.
- Edit a leg: Road shows truck/driver only; Sea shows container/seal/BL/line only.
  Set per-leg pickup & delivery times.
- Header date labels clarified; **Temp recorder no.** field present; customs/broker is
  a Contacts dropdown; billing status in Costs and billing (PLN + EUR totals).
- Documents checklist auto-includes Invoice/Packing list/EUR.1/Phyto/Export decl +
  CMR/BL/AWB by mode, plus DHL courier tracking.
- Transport order: pick a provider + its legs -> shows ONLY that provider's legs,
  places, date+time (no shipment-level origin leak). Road keeps CMR terms; sea/air/
  rail use the editable manual terms box.

## 7. Inventory - movements, quality, warehouse charges
- Open a **Direct Expected** lot -> Record movement and Record inspection: quantity
  entry works (no "max 0 kg" error).
- Receive into the warehouse lot (IN) -> status In Stock; partial Ship Out; damage.
- **Warehouse charges card:** chargeable kg-days + per-lot expected invoice;
  **+ Record sorting** logs a sorting event.
- Linked column shows SOs connected via shipments ("via SHP-...").

## 8. Consignment settlement (per truck)
- Consignment lot -> **Open settlement**. Gross sales auto-pull from SOs; expenses
  from lot costs; commission % prefilled from the season rate.
- Add a manual expense; check net = gross - expenses, commission = % x net, payout =
  net - commission. Print the bilingual statement.
- Record producer invoice no + amount (see variance) -> Close settlement. An SO that
  sold this lot now shows P/L ~ your commission.

## 9. Finance - P/L, overhead, warehouse, ledger
- Sales P/L: open an SO card; toggle Forecast/Actual; consignment note shows.
- Operational Costs: add overhead; set allocation methods; **Copy last month**; pin a
  one-off (import permit translation) to one SO via Manual allocation.
- Warehouse charges: warehouse + month -> expected; record actual invoice -> variance;
  Approve & allocate -> flows into lot cost.
- **Receivables & Payables (NEW):** sales invoices as receivables; producer payouts /
  warehouse / cost invoices / firm POs as payables; overdue flagged; Mark paid toggles;
  net position updates.

## 10. Fakturownia (read-only) - optional, needs connection
- Settings -> Fakturownia connection: account + API token -> Test connection (token
  stays in this browser, excluded from export).
- Finance -> Operational Costs -> Fetch cost invoices from Fakturownia -> review screen.
- SO with a pending invoice -> Match from Fakturownia -> pulls KSeF number + paid status;
  paid status then shows in Receivables.
- If CORS blocks the browser, the UI says so and the file import still works.

## 11. Data safety
- Settings -> Export JSON. Reload -> data persists. Confirm the export does NOT contain
  your Fakturownia token.

---

## How to report
Note the scenario number, what you expected, what you saw. Export your data so the
exact state can be reproduced. Screenshots help.
