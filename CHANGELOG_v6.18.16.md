# v6.18.16 — Batch 2: Product catalog (Item / Variety)

So the team stops typing the same product five different ways, products are now
picked from one controlled list of **Item → Variety**.

## What's new
- **A single product catalog**, seeded from your items list — plural item names,
  "Granny Smith" capitalisation fixed: Apples (29 varieties), Carrots, Garlic, Kiwis,
  Nectarines, Onions, Oranges, Peaches, Plums, Potatoes. ("Naidared" left as-is — adjust
  it in Settings if it should be Najdared/Idared.) Sizes are deliberately not here.
- **Item + Variety pickers on PO and SO lines** — two linked dropdowns. Pick the item, the
  variety list narrows to that item. Inventory inherits the product from the PO, so it
  needs no picker.
- **On-the-fly "➕ Add new…"** on either dropdown adds the item/variety to the catalog
  there and then, so it's standardised from the next use. It writes to the **same one
  list** — no duplicate source to keep in sync.
- **Settings → Product catalog** — manage the list directly: add / remove items, add /
  remove varieties (as chips), **Import CSV** (columns `Item, Variety`, or your xlsx
  exported to CSV) and **Export CSV**.
- The chosen **variety prints and displays** next to the item on PO/SO documents, emails
  and lists (e.g. "Apples — Gala").

## Safe with existing data
- The product line still stores the item in the existing `product` field; **variety** is a
  new field alongside it — none of the lot-matching / margin logic changed.
- Any product typed before this exists still shows and works; in the picker it appears as
  "<name> (not in list)" so nothing is lost. You can re-pick it from the catalog any time.
- The catalog travels with your JSON export / backups like every other store.

## Verified
- Type-checked clean (0 project errors).

> Run `npm install && npm run verify` locally before deploying. Note: the add-new prompt
> uses the browser's input box for now (consistent with the other quick prompts); it can
> become an in-app modal when we do the alert/confirm→modal pass.

## Build fix (re-issued)
The first v6.18.16 zip failed the Vercel build on an ESLint rule (`import/first`) because
the `ItemVarietyPicker` import sat mid-file in PurchaseOrders.tsx. `tsc` accepts that, but
the production build's ESLint doesn't. The import is moved to the top with the others — no
behaviour change. This re-issued zip replaces the previous v6.18.16.
