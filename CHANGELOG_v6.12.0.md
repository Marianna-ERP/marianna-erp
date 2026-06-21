# v6.12.0 — Unified location source (foundation) · Counterparties → Logistics points

First step of the locations remodelling. Goal: one source for every From / To /
Destination, with no duplicated data entry, and the transport confirmation left
exactly as it is.

> Transpile/syntax-checked only — no `node_modules` here. Run
> `npm install && npm run build` locally before deploying.

## What changed

- **New: Counterparties → "Logistics points" tab.** The single place to manage the
  locations that are *not* a counterparty's own premises: **ports of loading /
  discharge, relay points, and forwarder cross-dock warehouses** (third-party
  sites, deliberately NOT tied to the forwarder's address). Add / edit / delete,
  saved with your data and in the JSON export.

- **One registry feeds everything.** Logistics points register into the shared
  location list at load — before any screen snapshots it — so they appear in
  every From / To / Destination picker across PO, SO, Inventory and Shipments,
  and resolve on the **transport confirmation**, with no change to that document.

- **Settings → "Locations & ports" is now deprecated.** It shows a note pointing
  to the Logistics points tab. Anything you added there still works and still
  resolves on existing documents; just add new points in the new tab.

- Saving a logistics point reloads the app so the registry re-bootstraps and the
  new point shows everywhere consistently (same mechanism the old custom
  locations used).

## Design this is built on
- The **incoterm sets the handover point** (buy incoterm on the PO, sell incoterm
  on the SO); it is not tied to import/export by document type.
- The **legs are composed from the physical route**; a relay / cross-dock leg is
  inserted whenever the route needs it (e.g. EU→non-EU by road), for any incoterm.

## Not in this version yet (next step)
- Pulling **supplier / client / warehouse** locations fully from their counterparty
  records (today suppliers/clients still also come from the built-in list; warehouse
  counterparties already resolve). 
- **Incoterm-guided handover defaults** and one-click **relay/cross-dock leg
  insertion** in the shipment builder.
- The transport confirmation stays untouched in this pass by design.
