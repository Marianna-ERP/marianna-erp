# v6.7.0 — Fakturownia cost bridge, invoice-backed costs, copy-last-month

Principle confirmed with Hazem: Fakturownia (linked to KSeF) is the ONLY
official invoice register — the ERP never duplicates it. The ERP holds the
operational picture and pulls invoice identity from Fakturownia exports.

## Operational costs are now invoice-backed
1. **Invoice no. field** on every operational cost (supplier, number, date,
   value — the received invoice is the canonical record). Shown in the cost
   list; used for import dedupe. Manual entry stays for non-invoice costs
   (payroll, taxes).
2. **⟳ Copy last month** — clones the most recent month's cost lines into the
   next month as "Expected" (skipping ones already present, clearing invoice
   numbers). Rent/salaries/subscriptions no longer get retyped; they firm up
   to "Received" as the real invoices arrive.

## 📥 Import from Fakturownia (cost register)
3. Export your **cost/expense register** from Fakturownia (XLS/XLSX/CSV — the
   invoices issued TO you via KSeF) and load it in Finance → Operational
   Costs. Column detection is lenient (Polish or English headers: Numer/Number,
   Sprzedawca/Seller, Data wystawienia/Issue date, Netto/Net, Waluta/Currency).
4. **Review screen per row:** include/exclude, supplier, date, amount; rows
   whose invoice number already exists are flagged "already imported" and
   pre-unticked (safe to re-import the same export monthly).
5. **Smart routing:** suppliers recognized as tariffed warehouses are routed to
   **Warehouse invoices** (landing directly in the v6.5 reconciliation tab);
   everything else becomes an **Operational cost** with the category guessed
   from the text (paliwo→petrol, czynsz→rent, księgowość→accountant,
   wynagrodzenia→salary, telefon/internet, ubezpieczenie, software, bank
   fees…) — every guess editable before import, allocation method selectable
   per row (default: by revenue).
6. Imported costs arrive as status **"Received"**, so they count in Actual P/L
   immediately and in Forecast as always.

## Fixed
7. Finance component's TypeScript prop annotation was missing the props added
   in v6.5 (setLots, contacts, warehouseInvoices) — this would have failed the
   production build.

## Tests
8 new executed checks for the import helpers (category guessing on Polish
invoice texts, lenient PL/EN column detection). Suite total: 64 scenarios.

**Next (v6.8):** the sales side of the bridge — income-register import with
invoice↔SO matching, payment status → receivables, and the "Prepare for
Fakturownia" payload on the SO (lines + CN/HS + ACID/permit/temp-recorder
footer ready to paste).
