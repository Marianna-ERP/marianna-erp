# v6.36.0 — Settings: Ports & locations manager (P1 item 2)

The panel removed in v6.15 is rebuilt — you can finally see, add and edit the locations that
feed the port pickers, the over-ship guard and the transport-order addresses.

## What you can do now (Settings → PORTS & LOCATIONS)
- **See everything in one list**: built-in reference ports/warehouses, your custom locations,
  logistics points and counterparty-warehouse addresses — searchable, filterable by type, each
  tagged with its source.
- **Add your own locations**: ports, port/transshipment warehouses, airports, client sites,
  supplier sites, own/rented warehouses, customs points — with the real street address that
  prints on transport orders. New Port-typed locations immediately participate in the
  incoterm port pools and the over-ship guard's port detection.
- **Edit built-ins**: the hardcoded reference list (Koper, Gdańsk, Jeddah…) can now carry your
  real details — e.g. the exact transshipment-warehouse address on Koper. Overrides are stored
  separately, marked "edited", and can be **Reset** to the original at any time.
- **Edit or remove custom locations** (removal asks for confirmation).
- Logistics points and counterparty warehouses remain managed where they live (Parties) — the
  list says so instead of offering half-working edits.

## How it works
- Built on the surviving custom-locations engine (localStorage) plus a new per-id **overrides
  store** for built-ins, both applied at app load before any module snapshots the location
  list. Saving a change reloads the app (the documented pattern) so every picker is consistent.

## Gate (verified twice)
- Suite 172/172 · typecheck 0 · eslint unused 0 · real CRA build PASSED.

## Next (per the plan)
- P2: Inventory KPI strip + age/value columns · PO KPI vocabulary refresh.
