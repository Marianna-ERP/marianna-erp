# v6.18.5 — Event-driven inventory (P0-5 & P0-6)

The most consequential correctness fix on the tracker. Both items share one root
cause — inventory state wasn't driven by events — so they're done together.
**This touches how lots are created, updated and received. Please run the
scenario checklist below before relying on it.**

## P0-5 — Action-based PO ↔ expected-lot sync (replaces the blunt lock)

**Before:** once a PO left Draft, all commercial fields were locked, and the
expected lot was created once and never updated (`if (already) return;`). Correcting
a destination or quantity on a confirmed PO silently did nothing to the lot.

**Now:**
- A confirmed PO stays **editable as long as nothing depends on it** — no sales order
  is sourced from it, no (non-cancelled) shipment references it, and its goods haven't
  been received or moved. The PO is the base of the structure, so the moment something
  is built on it, its commercial terms **lock automatically** (the banner says which
  dependency triggered the lock).
- While it's still editable, **saving re-syncs the expected lot** — destination,
  quantity, price, product, flow, packaging all propagate. Only lots that haven't
  received goods or moved are touched; real stock is never rewritten.
- **Reverting Confirmed → Draft withdraws** the not-yet-received expected lot (it was
  auto-committed on confirm). Received/used lots are left untouched.
- A lot becomes **"received" from the inbound shipment's delivery** (see P0-6) or a
  manual Inventory receipt — **not** from toggling the PO status. This fixes the
  "PO marked Arrived but inventory still Expected" mismatch at the source.

## P0-6 — A delivered inbound shipment actually moves/receives the lot

**Before:** delivering a PO/transfer shipment recorded a TRANSFER movement but left the
lot's location, status and stock unchanged — so an arrived import still read "Expected"
at the old place.

**Now**, when an inbound (non-SO) shipment is marked Delivered:
- If the lot **hadn't been received yet** → it's **received into the destination**
  (records an `IN` movement, sets received/physical kg, status → In Stock, location →
  the shipment's final stop).
- If the lot was **already in stock** → it's an **internal transfer** (location moves,
  stock unchanged).
- If it's a **direct-flow** lot (goods go straight to the client, never our warehouse)
  → marked delivered without inflating warehouse stock.
- Re-applying the same shipment is a no-op (per-shipment guard), so no double receipts.
- Outbound SO deliveries (SHIP_OUT) are unchanged.

The written movement and the stored lot state now agree, so the two readers (Inventory's
recompute-from-movements and modules that read the stored fields) stay consistent.

## Please test before deploying (these exercise the changed paths)
1. Confirm a PO with no SO/shipment → edit its destination/quantity → save → the
   expected lot reflects the change.
2. Source a sales order from that PO → reopen the PO → it's now **locked** (banner
   names the SO). Same after creating a shipment that references it.
3. Confirm a PO, then revert it to Draft → its expected lot is **withdrawn**; a PO
   whose lot was already received does **not** lose stock on revert.
4. Inbound import: create PO → confirm → create the shipment → mark it **Delivered**
   → the lot becomes **In Stock at the destination** with the received kg.
5. Re-trigger the delivery / click "Apply inventory" again → **no** second receipt.
6. A direct-flow PO's delivery → lot is **not** added to warehouse stock.
7. Cancel a confirmed PO → expected lots blocked/cancelled, sourced SOs return to Draft
   (unchanged behaviour — confirm it still holds).

## Verified
- Type-checked clean (0 project errors) via the offline stub harness.

> Run `npm install && npm run build` locally before deploying.
