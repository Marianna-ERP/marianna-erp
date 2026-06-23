# v6.18.9 — PO → purchase invoice on arrival (#5)

The last of the testing-feedback items, done on its own because it touches the Finance
ledger.

## What changed
- When a **firm-price PO reaches "Arrived"** (goods received), it now surfaces as a
  **purchase (COST) invoice** in the Invoices module — counterparty = supplier, linked
  to the PO, amount = the PO purchase value in PLN. Consignment POs are excluded (they
  settle as producer payouts, not purchase invoices).
- If you haven't entered the supplier's invoice number yet, the purchase invoice shows
  with no number and a note "Awaiting the supplier's invoice number — add it here when
  received." Open it and fill in the real number when the document arrives.
- The Finance **ledger now reads that purchase from the invoice**, and the old
  *computed* PO-purchase line **skips any PO that already has a purchase invoice**. So a
  PO is counted exactly once: as a computed commitment while Confirmed, and as a purchase
  invoice once Arrived. The Ledger shows it as kind "PO purchase".

## Why "Arrived" and not "Confirmed"
Per your choice: the supplier's invoice becomes a real payable on receipt of goods, so
the purchase invoice appears at Arrived. A Confirmed-but-not-arrived PO still shows in
the ledger as a commitment (computed), exactly as before — it just isn't an invoice yet.

## Validation (same cross-check as v6.18.6)
Your **Payable open** total should be **unchanged** after upgrading. What changes is
presentation: arrived firm-price POs are now itemised as purchase invoices (visible in
Invoices) instead of computed-only lines. Note your Payable-open before and after; they
should match, with arrived POs now appearing in the Invoices module.

## Please test
1. Take a firm-price PO to Arrived → a purchase invoice appears in Invoices, linked to
   the PO, for the purchase amount.
2. Finance → Ledger: the PO shows once (as "PO purchase"), not twice; Payable-open
   unchanged vs before.
3. A Confirmed (not arrived) firm PO still shows as a computed payable, no invoice yet.
4. A consignment PO does **not** create a purchase invoice.
5. Enter the supplier's invoice number on the purchase invoice → it's recorded.

## Verified
- Type-checked clean (0 project errors) via the offline stub harness.

> Run `npm install && npm run verify` locally before deploying.
