# v6.15.0 — Compact module summaries, dropdown filters, Settings cleanup, unified From/To source

> Transpile/syntax-checked only — run `npm install && npm run build` locally before deploying.

## Space-saving across the main tabs
- **Compact summaries.** The KPI strips on PO, Inventory, SO and Shipments are now
  shorter (smaller cards, no third sub-line — the detail moved to a hover tooltip),
  so the list shows sooner and more rows fit.
- **Filters are dropdowns, not button rows.** PO (status / flow / supplier),
  Inventory (status / location / product / quality) and SO (status / client) now use
  compact dropdowns on a single row instead of multi-row chip strips. (Shipments
  already used dropdowns.)

## Shipments
- **Removed the "Email order" button from the shipment header** — emailing is done
  from inside the transport order form now (next to Print / PDF), so the header is
  tidier.
- **Wider provider dropdown** in the transport order confirmation so the full
  carrier/forwarder name and detail are visible.

## Settings
- **Removed the "Locations & ports" section entirely.** Ports / relay points /
  cross-dock warehouses live in **Counterparties → Logistics points**, and
  supplier / client / warehouse addresses come from the counterparty record. Any
  locations added in older versions still resolve on existing documents.

## Finance
- **Header tab buttons now have borders**, and the **Credit Notes** button is a
  distinct violet so it stands out.

## From / To / Destination now source from Counterparties (#6)
- Supplier, client and warehouse **addresses entered in the Counterparties module
  now appear in every From / To / Destination picker** (and resolve on the transport
  confirmation). They're registered into the shared location list at load — before
  any screen snapshots it — using a stable id per counterparty address, alongside the
  logistics points from v6.12.
- Note: as with logistics points, a **newly added counterparty appears in the
  pickers after the next reload** (the location registry rebuilds on load).

## Please verify when testing
- Open a leg's From/To and an SO destination — your real suppliers, clients and
  warehouses (from Counterparties) should be listed, grouped by role, along with
  your logistics points.
- Confirm existing documents still show their saved locations correctly.
