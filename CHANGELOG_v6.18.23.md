# v6.18.23 — "From stock" source picker now carries variety + CN/HS

## Fix
- **New SO → Pick source → From stock** was missing the variety (and CN/HS), while
  "From PO" showed them — so sourcing a line from inventory produced an incomplete line.
- Root cause: the adapter that feeds the picker (`_adaptLotsFromInventory`) mapped only
  number/product/quality/size/origin/warehouse/qty/packaging and **dropped `variety` and
  `cnCode`**. The PO adapter kept them (it spreads the whole line), which is why the two
  tabs differed. The lot display fix in v6.18.18 read a field the adapter never supplied.
- Now the stock adapter passes **variety, cnCode and poRef** through, so the picker row
  shows "Item — Variety" and the sourced SO line inherits variety + CN/HS, exactly like a
  PO-sourced line.
- **Older lots** created before the PO→lot variety copy are handled too: if a lot lacks
  variety/CN-HS, they're backfilled from the lot's originating PO line so existing stock
  is also complete.

## Verified
- Type-checked clean (0 project errors, strict:false to match the project build);
  all imports at file tops.

> Run `npm install && npm run build` locally before deploying.
