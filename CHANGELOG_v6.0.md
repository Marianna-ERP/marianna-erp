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

---

## v6.0.2 — testing feedback fixes

1. **PO/SO email text** — now opens "Dear {company name}," and signs "Best regards, MARIANNA" (was: contact person / Hazem Osman).

2. **PO linked records now computed live** — the PO detail's LINKED RECORDS section now:
   - Adds a **Sales orders** row (SOs whose line items source from this PO) — previously missing entirely.
   - Computes **Shipments** by scanning live shipments whose `poRefs` include this PO (so a shipment created from the PO shows up immediately, instead of "not yet").
   - Inventory lots row unchanged (was already working).

3. **SO line items — supplier under PO number** — for PO-sourced lines, the source badge now shows the supplier name beneath the PO number.

4. **Baseline test data added** (4 contacts) for end-to-end logistics testing:
   - Supplier (Poland): "Owoce Polska Sp. z o.o."
   - Client (Egypt): "Nile Fresh Imports" (Alexandria, CIF, USD)
   - Carrier (Poland, road): "PolTrans Drogowy"
   - Forwarder (Italy): "Adriatica Forwarding S.r.l." (Sea/Road/Customs)

Inventory lot notes summary: left as-is (confirmed helpful).

---

## v6.0.3 — Shipment detail-view & transport-order fixes (testing round 2)

All from direct testing of a direct-export PO→shipment:

1. **Export shipment mislabeled "PO import"** — purpose is now decided purely by the
   PO flow direction (EXP → export), regardless of transport mode. Previously only
   road-mode exports were labeled correctly.

2. **Phantom WH-01 Poznań on legs** — `buildShipmentFromPO` no longer defaults the
   destination to WH-01 (id 1) or origin to id 3. They start unset so the user's
   actual PO destination is used; multimodal intermediate legs start with no location
   rather than hardcoded port ids.

3. **Same cost shown on every leg** — the multimodal builder no longer copies one
   freight amount onto all legs. Each leg starts at 0 cost for the user to fill, so
   the per-leg cost display reflects the real figures.

4. **SO number missing in goods PO/SO/Lot** — goods rows now carry the SO ref when the
   shipment is linked to an SO (via opts.soRefs), instead of a hardcoded blank.

5. **Pallets auto-showing 22** — pallets are no longer auto-calculated from kg. They
   default to 0 (or the value entered on the PO line) until you set them.

6. **Transport-order dropdown showed an uninvolved company** — the provider dropdown
   now lists ONLY actual leg providers (carriers/forwarders moving goods), not
   cost-line suppliers (which could include a broker or other non-transport party).

7. **"2 units for 1 truck"** — the Transport units count now reflects only the legs on
   the selected order, and the builder no longer creates phantom legs for a simple
   direct road export (1 leg = 1 unit).

8. **Polish header "DLA PROVIDE" → "DLA CARRIER"** — the provider role now resolves to
   Carrier by default, so the bilingual header reads "CARRIER ORDER / ZLECENIE DLA CARRIER".

9. **One-page A4 print** — header, fonts, table padding, section spacing and the terms
   list were tightened (terms now render inline EN / PL instead of stacked) so the
   transport order fits on a single A4 page.

Costs/billing view: confirmed correct, unchanged.
