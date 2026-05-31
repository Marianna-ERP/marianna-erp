# v6.0 — Per-leg transport orders + locations + dates + sea-leg fields

Built on the v5.8 trunk. Bundles the v5.9 work (locations + dates + sea-leg) with
the per-leg transport order fix you flagged.

## Headline fix: per-provider transport orders (was: both legs on one wrong order)

**The problem:** a multimodal shipment generated ONE transport order showing both
the road leg AND the sea leg — so you couldn't send it to the carrier or the
forwarder, because each got the other's details and pricing.

**Root cause found:** when a shipment was generated from a PO without an explicit
carrier, the road leg's `carrierId` defaulted to the forwarder's id (`carrierId ||
forwarderId || 15`). Both legs collapsed onto one provider, so one order showed
everything. The seed multimodal shipment had the same defect (all 3 legs = id 15).

**The fix:**
1. Road legs no longer borrow the forwarder's id. If no carrier is chosen they get
   a distinct `TBD_CARRIER_ID` sentinel ("TBD carrier — to be assigned"), so the
   road and sea legs stay separate providers.
2. The transport-order document is now scoped to the SELECTED legs: loading/delivery
   DATES come from the leg (not the whole shipment), the route shows first-leg-from →
   last-leg-to, the CARGO table shows only goods on those legs, and the FREIGHT shows
   only that provider's cost.
3. The print modal now lets you **pick the provider AND tick which legs** go on the
   order (you asked for "let me pick which legs"). Default selection = that provider's
   legs; you can adjust.
4. The email modal scopes its body (dates, freight) and the attached PDF to the
   selected provider's legs too.
5. Seed shipment SHP-2026-0045 fixed: road legs → carrier (Trans-Logistics, id 9),
   sea leg → forwarder (Raben, id 15). It now correctly produces TWO separate orders.

So a multimodal shipment now yields one clean order per provider — the carrier's
order shows only the road leg(s) and road freight; the forwarder's shows only the
sea leg and sea freight.

## Also in this release (the v5.9 work)

- **Shared locations** (`src/locations.ts`): one source of truth, ID conflicts fixed
  via aliasing, no seed IDs changed.
- **Date semantics**: "Expected delivery date" + `means:` dropdown + separate "Actual"
  date on PO and SO.
- **Sea-leg fields**: `vesselName` → `shippingLine` (the company, e.g. MSC);
  `voyageNumber` removed entirely.

## Deferred to next session

- Flow taxonomy rename + `isDirectFlow()` fix (load-bearing — needs its own isolated deploy).
- #6 From/To auto-fill improvement (real supplier address + chosen port warehouse).

## Files

**New:** `src/locations.ts`
**Modified:** `src/Inventory.tsx`, `src/PurchaseOrders.tsx`, `src/SalesOrders.tsx`, `src/Shipments.tsx`

## Test after deploy

1. Open the multimodal seed shipment **SHP-2026-0045** → Transport order.
2. The provider dropdown should offer TWO providers: Trans-Logistics (carrier) and Raben (forwarder).
3. Pick the carrier → the order shows only the road leg(s), road freight, road route. Pick the forwarder → only the sea leg, sea freight, port-to-port.
4. The leg checkboxes let you add/remove legs from the order.
5. Create a NEW shipment from a PO without choosing a carrier → the road leg shows "TBD carrier — to be assigned", NOT the forwarder.

---

## v6.0.1 build fix (eslintConfig)

Vercel build was failing with:
`src/App.tsx Line 147:5 Definition for rule 'react-hooks/exhaustive-deps' was not found`

**Cause:** App.tsx line 147 has `// eslint-disable-next-line react-hooks/exhaustive-deps`
(added to silence a hook dependency warning), but package.json had NO `eslintConfig`
block — so the build-time ESLint never loaded the react-app preset that DEFINES that
rule, and errored on the unknown rule reference.

**Fix:** added the standard CRA `eslintConfig` block to package.json:
```json
"eslintConfig": { "extends": ["react-app"] }
```
This loads eslint-config-react-app (which includes eslint-plugin-react-hooks),
so the rule resolves and the disable-comment works as intended.

This is a config gap that would have bitten any future eslint-disable comment too —
now fixed permanently. No source code changed.
