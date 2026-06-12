# v6.6.0 — Consignment sales & per-truck settlement, CN/HS codes

The papryka case: producers send goods on consignment (to our warehouse or
direct to the client); we sell at our prices; at the end the producer invoices
us the NET sales value (gross sales − all expenses) and we invoice them our
commission on that net value.

## Purchase Orders
1. **Pricing mode: "Firm price" vs "Consignment — settled on sales".**
   Consignment POs save and confirm WITHOUT purchase prices (the old
   price-required validation is skipped); line price fields show a
   "Consignment ⚖" marker, and the printed bilingual PO shows
   "Konsygnacja / Consignment" instead of prices and totals.
2. Lots created from consignment POs are flagged **⚖ consignment** with an
   empty cost base (no fake purchase cost poisoning margins).

## Contacts
3. **Seasonal commission rates** on Supplier counterparties: season label,
   valid-from date, % — the rate valid on the settlement date is prefilled
   automatically (rates change every season, history is kept).

## Inventory — per-lot/truck settlement
4. Consignment lots show a purple banner with settlement status and an
   **Open settlement** button.
5. The **Settlement screen** auto-computes: gross sales (every SO line sourced
   from this lot — by stock ref or via the PO — kg × your price × FX),
   minus ALL tracked expenses (allocated freight, approved warehouse charges,
   customs…) plus manual expense lines → **net sales value** → commission
   (% prefilled from the producer's season rate) → **producer payout**.
   Warnings flag unsold kg, missing prices, over-sourcing and negative net.
6. **Bilingual settlement statement** (EN/PL) — printable/PDF — showing the
   producer exactly how the number was built: sales table, deducted expenses,
   net sales value ("producer invoices us this amount"), commission, payout.
7. **Lifecycle:** Draft → Statement sent → producer invoice recorded (number +
   amount, instant **variance vs expected net**) → **Close settlement**, which
   writes TWO cost components onto the lot — the producer invoice (+) and your
   commission invoice (−, commission recalculated on the ACTUAL invoiced net) —
   so the existing margin engine lands each consignment SO's P/L at exactly
   your commission. Closing is idempotent (can't double-write).

## Sales Orders
8. **CN / HS code** per SO line (e.g. 08081080), printed on the SO document
   under the product — ready for the Fakturownia invoice footer (v6.7 bridge).
9. **P/L card consignment awareness:** SOs selling consignment goods show a
   clear note — before settlement the figures exclude the producer cost; after
   closing, the P/L is final and ≈ your commission.

## Engine & tests
- New pure module `consignment.ts` with **8 executed scenario tests**: season
  rate selection by date, gross across STOCK + PO-sourced lines with FX,
  cancelled-SO exclusion, net/commission/payout math, idempotent recompute
  after closing, partial-sale and negative-net warnings, cost-component signs.
  Total suite: 56 scenarios, all passing.
