# V5 — Locations, Flows & Date semantics

This is a foundation release. It doesn't add a visible new module — instead it fixes structural problems that were blocking the bigger Inventory redesign (V6). Think of it as paying down debt so the next step is clean.

## Three changes

### 1. One canonical Locations list (`src/locations.ts` — NEW)

**The problem it fixes:** V4 had four separate `LOCATIONS` arrays (one each in PurchaseOrders, Inventory, Shipments, SalesOrders) with **conflicting IDs**. For example, id `8` meant "Algeciras Port" in PurchaseOrders but "Biedronka DC Poznań" in Inventory. Any time a `destinationLocationId` crossed module boundaries it could resolve to the wrong place — a latent data-corruption bug.

**The fix:** a single canonical list with clean, range-based IDs:
- `101-199` our storage (RentedWarehouse today, OwnWarehouse when you open your own)
- `201-299` supplier facilities
- `301-399` client facilities
- `401-499` ports
- `501-599` airports (new — for the air-export flow)
- `601-699` port warehouses (3rd-party port storage)
- `701-799` customs / brokers

Each location now has a `type` and a `capabilities` object (storage / customsClearance / refrigerated / qualityInspection / sorting) plus an optional `operatorContactId` linking to the company that runs the place. **This is how the system is ready for the day Marianna owns a warehouse** — you just add a location with `type: "OwnWarehouse"` and `operatorContactId: null`; everything else keeps working.

All 54 location references across the four modules were renumbered to the canonical IDs. All four modules now `import { LOCATIONS, locById } from "./locations"`.

### 2. Canonical PO flow taxonomy (`src/flows.ts` — NEW)

10 flow codes covering Marianna's real-world journeys:

| Code | Meaning |
|------|---------|
| `EXP_BY_SEA_CIF` | Sea export, CIF to destination port |
| `EXP_BY_AIR_CIF` | Air export, CIF (blueberries etc.) |
| `EXP_BY_TRUCK_DAP` | Road export, delivered to client |
| `EXP_BY_TRUCK_RELAY` | Road export, handover at relay point |
| `IMP_CIF_TO_OUR_WH` | Sea import CIF → our rented warehouse |
| `IMP_CIF_TO_CLIENT_WH` | Sea import CIF → direct to client |
| `IMP_CIF_CROSSDOCK` | Import CIF, client picks up at port |
| `IMP_DDP_TO_OUR_WH` | Supplier DDP → our warehouse |
| `IMP_DDP_TO_CLIENT_WH` | Supplier DDP → direct to client |
| `IMP_EXW` | We arrange everything from supplier door |

Each flow carries metadata: direction, default Incoterm, whether it needs a sea/air leg, the typical destination type, and the **ownership transfer event** (when goods become / stop being ours — used in V6 for the inventory ownership boundary).

Existing seed POs were re-tagged from the old V4 codes to these. `flow` is now a required dropdown on the PO form, and selecting a flow auto-fills the sea-freight flag and the date-meaning.

### 3. Date semantics — "Expected delivery date" + meaning + actual

**The problem it fixes:** the single `deliveryDate` / `expectedDeliveryDate` field was ambiguous — did it mean pickup? arrival at port? arrival at our warehouse? delivery to client? Different people read it differently.

**The fix (minimal, per your choice of Option A):**
- The date field is now labelled **"Expected delivery date"** (SO) / **"Expected availability date"** (PO)
- A small **`promisedDateMeans`** dropdown sits under it, so the date is never ambiguous again. Options on SO: Delivery to client / Pickup-ready at our side / Handover at relay / Loading at supplier / Arrival at destination port. On PO: Pickup from supplier / Arrival at port / Arrival at our warehouse / Arrival at client.
- A separate **actual** date field (`actualDeliveryDate` on SO, `actualAvailabilityDate` on PO) — left blank until it actually happens, so you can compare promised vs actual.
- `promisedDateMeans` auto-sets from the chosen flow (PO) or sell Incoterm (SO), but stays editable.

The original `deliveryDate` / `expectedDeliveryDate` field names are unchanged, so nothing downstream breaks. The new fields sit alongside.

## Files

**New:**
- `src/locations.ts` — canonical Locations + helpers + legacy migration map
- `src/flows.ts` — flow taxonomy + date-meaning enums + helpers

**Modified:**
- `src/PurchaseOrders.tsx` — flow dropdown (10 codes), new date fields + meaning, canonical locations
- `src/SalesOrders.tsx` — new date fields + meaning, canonical locations, fixed destination dropdown
- `src/Inventory.tsx` — canonical locations, location-type UI metadata, migrated flow codes
- `src/Shipments.tsx` — canonical locations, migrated standalone seed flow codes
- `src/Dashboard.tsx` — resilient promised-date read

**Unchanged:** App.tsx, Contacts.tsx, Finance.tsx, SOMarginCard.tsx, marginCalculations.ts, Settings.tsx, useLocalStoredState.ts, shell_seed.ts

## What did NOT change (deferred to V6)

- The lot model itself (no journey stages yet)
- Inventory ownership boundaries (the data is in flows.ts but not yet applied to lots)
- Inspection / QC workflow
- Split & reroute operations
- Customs as an independent milestone

V5 lays the groundwork (locations with capabilities, flow ownership events, date clarity); V6 builds the journey-based Inventory on top of it.

## localStorage note

The new fields are additive and the storage schema version is unchanged, so existing tester data keeps working. New POs/SOs get the new fields; old ones simply have `promisedDateMeans` default to a sensible value and `actual*` dates blank until filled.

## Update workflow

Copy these into your repo's `src/`:
- `locations.ts` (new), `flows.ts` (new)
- `PurchaseOrders.tsx`, `SalesOrders.tsx`, `Inventory.tsx`, `Shipments.tsx`, `Dashboard.tsx` (replace)

Commit message: `V5 — canonical locations + flow taxonomy + date semantics`. Push, Vercel rebuilds.
