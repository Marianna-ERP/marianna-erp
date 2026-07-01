# v6.18.21 — Audit correctness fixes (P0-1, P0-5, P0-6, P1)

Four low-risk fixes verified against the independent v6.18.17 audit.

## Fixes
- **Lot deletion is now hard-blocked when referenced (audit P0-5).** Deleting a lot that
  has Sales Order / Shipment references or any received goods / recorded movements used to
  be a confirm-through — you could OK past the warning and orphan SO/shipment/COGS links.
  It's now blocked outright with an explanation; only a genuinely empty, unreferenced lot
  can be removed. (Cancel the dependent documents or void the movements first.)
- **Shipment ids no longer use Date.now() (audit P0-6).** The shipment builders and the
  customs cost line now use the stable `nextId()` generator, removing the same-millisecond
  collision risk and keeping ids consistent with the rest of the app.
- **Inventory product filter is derived from stock, not a hardcoded list (audit P1).** The
  filter dropdown now lists the products actually in inventory (which come from the
  catalog-picked PO), instead of a static array that had drifted from the catalog.
- **Ledger paid-check is currency-correct (audit P0-1).** The amount-based "paid" fallback
  compared paid amount (invoice currency) against gross in PLN; it now converts by fx rate.
  In practice fully-paid non-PLN invoices already showed Paid via the payment-status path,
  so this is a consistency tidy rather than a behaviour change.

## Verified
- Type-checked clean (0 project errors); all imports at file tops (production-build safe).

> Run `npm install && npm run build` (or `npm run verify`) locally before deploying.

---
### Audit items NOT in this release (need design decisions — staged deliberately)
- **P0-2** fold legacy Finance credit-notes into Invoices.financeNotes + include notes in
  ledger totals.
- **P0-3 / tracker P1-2** cost-ownership flag to stop shipment-cost double-counting.
- **P0-4** make Invoices the sole invoice writer (retire SO pendingInvoices).
- **P0-7** not applicable — our package already includes package.json/tsconfig.json/vercel.json/.npmrc.
