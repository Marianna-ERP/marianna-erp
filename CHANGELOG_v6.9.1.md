# v6.9.1 — Finance & Counterparties fixes (partial v6.10 batch, verified)

This is the **verified first half** of the v6.10 fix batch. Each change below was
made against the real v6.9.0 code and passes a transpile/syntax check. The
remaining items (PO, Shipments, SO) and the user manual are tracked at the
bottom and will land in v6.10.0.

> Note on building: this package has no `node_modules` bundled, so a full
> type-checked `react-scripts build` was not run here. Changes were verified with
> a standalone TypeScript transpile pass on every source file. Run
> `npm install && npm run build` locally to confirm a clean production build.

## Finance → Operational Costs

### Entries view redesigned (points 1–3)
- The **Operational Cost Entries** register now shows the columns you asked for:
  **Date · Supplier · Category · Status · Amount** (Date and Supplier were never
  shown before — that is why invoices imported from Fakturownia *looked* like
  they had lost their number and issue date; the data was imported, just not
  displayed).
- Each row has a **hover preview panel** showing the full detail — period, date,
  supplier, invoice no., category, cost center, allocation method, amount in
  original currency + PLN (with FX), description and notes.
- **Edit** and **Delete** remain available inline on every row.

### Filters (point 4)
- Filter the register **by period** and **by supplier** (dropdowns built from the
  data you actually have), with a one-click *clear filters* and a live
  count + filtered total.

### Import robustness (point 1, root cause)
- Widened the Fakturownia file-import **column detection** so more export header
  variants for the invoice number and the issue/sell date are recognised
  (e.g. "Numer faktury", "Nr faktury", "Data wystawienia", "Data faktury",
  English equivalents).

## Counterparties

### Merge: EU-VAT can now always be cleared (point 5)
- When merging two contacts, the tax identity (**NIP + EU VAT**) is now a single
  paired choice: the side you pick wins **completely**, so a stale `vatEuId`
  carried over from the kept record can no longer resurface. The merge dialog
  also detects and displays a tax difference even when the value only lives in
  the EU-VAT field.

### Tariff / commission numeric inputs accept `0,00` (point 6)
- Warehouse tariff fields (storage, handling in/out, sorting, free days,
  FX → PLN) and the consignment commission % now accept **comma decimals**
  (e.g. `0,30`). The raw text is kept while you type (so `0,` and `0.` no longer
  collapse to `0`) and is converted to a number once, on save. The warehouse
  charge engine's parser is now comma-tolerant as well.

### "Locations this warehouse operates" widened (point 7)
- The picker is no longer limited to the two seed warehouses. It now lists all
  warehouse-type locations **plus every warehouse counterparty's address(es)**.

### Multiple warehouse addresses (point 8, part 1)
- A counterparty marked as **Warehouse** can now hold **additional delivery
  addresses** (Edit counterparty → Warehouse tariff → *Additional delivery
  addresses*). These addresses are exposed as selectable locations via new
  helpers in `locations.ts` (`warehouseLocationOptions`,
  `warehouseDestinationOptions`, `warehouseAddressLocations`).

## Files touched
- `src/Finance.tsx` — entries view, filters, hover detail, import keywords.
- `src/Contacts.tsx` — merge tax pairing, raw-text numeric inputs + save-time
  coercion, broadened operates picker, extra-addresses UI, modal now receives
  the contacts list.
- `src/locations.ts` — warehouse-counterparty location/destination helpers.
- `src/warehouseCharges.ts` — comma-tolerant `safeN`.

## Still pending for v6.10.0 (not in this build)
- **PO**: block status → *Shipped* before the loading date; add **boxes** per
  item line. (points 9–10)
- **Shipments**: DDP carrier/truck tracking in provider & cost; free-text
  From/To on legs; move truck/trailer/driver to the **unit** section; DDP
  supplier→warehouse leg with no road-freight cost. (points 11–14)
- **Sales Orders**: incoterm/delivery destination defaulting to the client
  address with an **"Other" free-text** option. (point 15)
- **Destination dropdowns** consuming `warehouseDestinationOptions` across
  SO/PO/Shipments (point 8, part 2).
- The **user manual**.
