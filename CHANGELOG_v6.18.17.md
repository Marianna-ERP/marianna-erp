# v6.18.17 — Product inheritance, lifecycle rules, shipment & transport fixes

## Product = Item + Variety + CN/HS, flowing PO → SO → lot → shipment
- **CN/HS code** is now entered **per PO line** and carried downstream.
- A **Sales Order line sourced from a PO/stock now inherits and locks** the Item,
  Variety and CN/HS — they show read-only ("inherited from the linked source"), no longer
  a re-pickable dropdown. The Item/Variety picker only appears on a manual (unsourced) line.
- **Lots** now store the variety and CN/HS from their PO, and **Inventory shows Item —
  Variety** (lists, detail, journey, movement history).
- **Every product field reports Item — Variety**: PO/SO documents, shipment goods (editor,
  print, detail), inventory, and lists.

## PO / SO lifecycle
- A **Draft (or Cancelled) PO/SO can't be used as a base** for a new shipment — they're
  filtered out of the source list.
- Once a PO has any downstream link, its **status dropdown is disabled** (not just guarded).
- **Cancelling the SO (and its shipment/inventory) frees the PO again** — a cancelled SO no
  longer counts as a dependent.

## Cancellation (PO / SO / Shipment)
- A cancelled order/shipment is shown **red** in its list, opens **read-only** (the Edit
  button is replaced by a "Cancelled — read-only" badge), and its **status can't be changed**
  — it's kept for the record but **can't be reactivated**.

## Inventory — void instead of cancel
- A wrongly-entered **manual** movement/transfer/reclass/claim can be **Voided**: it stays in
  the lot history (shown red, struck-through, "VOIDED") but is **excluded from the stock
  recompute**. System events (receiving IN, ship-out, return reversal) are protected and
  can't be voided, since they're driven by the PO/shipment/return.

## Edit-shipment fixes
- **Kg field** no longer captures only the first digit / loses the cursor — the input was
  remounting on the first keystroke (stable key applied).
- **Multimodal cost & billing** now creates **one freight line per activated leg** (type from
  each leg's mode, supplier from each leg's carrier/forwarder), instead of a single lumped
  sea-freight line on the first supplier.
- A **new cost line defaults to the shipment's working currency** (e.g. EUR), not PLN.

## Transport-order email
- The per-leg order no longer borrows the **first leg's** information — `providerLegs` used to
  fall back to leg 1, which is why the second-leg forwarder's order showed the wrong
  loading/unloading. Each provider's order now reflects **only its own leg(s)**.
- The email is **addressed to the company**, and the **PDF filename includes the provider
  name** (e.g. `SHP-2026-0107 — MSC.pdf`) so multi-leg orders don't collide.

## Verified
- Type-checked clean (0 project errors); all imports at file tops (production-build safe).

> Run `npm install && npm run build` (or `npm run verify`) locally before deploying.
