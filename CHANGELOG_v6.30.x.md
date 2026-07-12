# Update v6.30.1 — Cross-module coherence fix batch

Fresh read of the whole codebase against the v6.17 audit and the Batch 0–7a decisions.
Good news first: the audit gate sequence is verifiably implemented (stable ids, structured
soRef, auto SHIP_OUT, lot-delete guard, replace-by-source in Finance and costAllocation,
single FX source). This batch fixes the drift and gaps found around those decisions.
Suite: 117 → 125 scenarios, all passing. Full typecheck clean.

## Fixes

1. **integrityCheck — false LOT_OVERSOLD on shipped lots (error-level noise).**
   The checker still used the wide 7-status reserving set that Batch 1 removed as dead
   code: Shipped+ orders already had their kg subtracted via SHIP_OUT, so counting them
   as reserving double-subtracted and flagged every correctly shipped lot as oversold.
   Now aligned with `SO_PRE_DISPATCH_STATUSES` (Confirmed/Reserved/Loading).

2. **integrityCheck — ORPHAN_SO_POLINE was dead.** `|| po.items.length > 0` made the
   check pass whenever the PO had any line at all. Now strict when the SO line names an
   explicit `sourceLineId`; legacy lines (null id) keep the lenient fallback.

3. **warehouseCharges — voided movements accrued charges.** `computeStoragePeriods` and
   the handling in/out sums now exclude `voided` movements, in parity with
   `recomputeLotFromMovements` (v6.18.17). A voided IN no longer inflates kg-days or
   handling in the expected warehouse invoice / monthly reconciliation.

4. **types.ts — ShipmentLeg contract corrected.** The declared field names
   (originLocationId/destinationLocationId/loadingDate/unloadingDate/units) were never
   used by any code; every builder and the posting engine use
   fromLocationId/toLocationId/fromCustom/toCustom/plannedPickupDate/…/vehicles.
   Contract now matches reality so future modules can't code against phantom fields.

5. **Settlement commission invoice — Invoices crash + empty Fakturownia payload.**
   `category: "COMMISSION"` was outside the InvoiceCategory union and unmapped in
   CATEGORY_META: closing a settlement crashed the Invoices list render. Added to the
   union + meta (violet badge), and category lookups now fall back to OTHER instead of
   crashing. The draft's positions also used a non-canonical shape
   ({description, qty, unitPrice}) invisible to buildFakturowniaPayload — now
   {name, quantity, unit, vatRate, grossTotal}, so a push carries the real line.

6. **SO cancel — phantom stock on direct lots.** `reverseCancelledSOInInventory`
   restored physicalKg on pass-through lots that were never in our warehouse, creating
   sellable phantom stock. Direct lots are now skipped; physically delivered goods come
   back via a RETURN shipment or a claim, not a cancel.

7. **Shipment posting — over-issue surfaced (7a parity).** OUTBOUND posting clamped an
   over-issue silently; it now accumulates `overIssuedKg` exactly like the movement
   reducer, so the LOT_OVER_ISSUE safeguard also catches shipment-driven over-issues.

8. **Last hardcoded FX removed.** The EUR display fallback in Shipments costs (4.25)
   now uses `defaultFxRate("EUR")` from fx.ts.

Cosmetic: integrityCheck section comments renumbered (two sections were both "5"/"6").
tests/tsconfig.json adds `"types": []` (TS 4.9 chokes on newer transitive @types/node
under Node 24) and compiles warehouseCharges/fx/ids/invoicing for the new scenarios.

## New test scenarios (8)
- Shipped SO no longer raises LOT_OVERSOLD; pre-dispatch oversell still flagged.
- ORPHAN_SO_POLINE fires on an explicit missing line id; legacy null id tolerated.
- Voided IN excluded from kg-days + handling; voided SHIP_OUT doesn't reduce storage.
- Commission invoice survives buildFakturowniaPayload with name + gross intact.
- OUTBOUND over-issue lands in overIssuedKg and is flagged end-to-end.

---

# Update v6.30.2 — Clean system (G1 completion)

Real-data finding: after a full reset, demo counterparties were still available to
issue POs. Three leak paths, all the same class (Batch 0's G1 "dual-data-path removed"
was partial):

1. **PurchaseOrders `suppliersFromContacts`** fell back to the 5 stub suppliers when
   Contacts was empty (`mapped.length ? mapped : SUPPLIERS`). The SO side was fixed in
   Batch 0; the PO side was missed. Now: empty Contacts = empty supplier picker.
2. **Shipments used length-based fallbacks** (`extPOs && extPOs.length ? extPOs :
   localPOs`) for POs/lots/orders — a clean (empty) store silently swapped in the
   STANDALONE_* demo data in the create-shipment pickers. Now nullish (`??`), with the
   `= []` prop defaults removed so "standalone" and "clean system" are distinguishable.
3. **FALLBACK_PROVIDERS were merged unconditionally into carrier/forwarder/broker
   picker options** — demo providers (DSV, Pekaes, MSC…) appeared even on a clean
   system. Options now list Contacts only. Legacy shipments referencing a fallback id
   still display correctly via providerById (same-named live contact preferred, T-25);
   on next edit the provider is re-picked from Contacts.

Behavioural note for testers: on a clean system, PO/shipment creation now correctly
requires adding counterparties first — pickers start empty by design.

Suite 125/125; full typecheck clean. Tracker: reopen/annotate G1 (B0-1) as completed here.

---

# Update v6.31.0 — P1-2 interim (direct costs), close-out gate, tripwires

**computeDirectCosts rewritten** (P1-2 interim / BP-28B groundwork). Four defects,
all confirmed on real data:
  (a) under-capture — only header soRefs were read; goods-row SO links contributed 0;
  (b) vertical double-count — a cost line already allocated to lots (Batch-1b tag
      `SHP-x/costId`) also counted as a direct cost;
  (c) horizontal double-count — the FULL shipment cost was charged to EVERY linked SO;
  (d) cancelled shipments still contributed costs.
Now: linked SOs = header soRefs ∪ goods[].soRef; pro-rata by each SO's kg share of the
goods rows (equal split when no kg assigned); lot-allocated cost lines skipped;
Cancelled shipments excluded (T-14). Actual-mode invoice-status gate unchanged.
The BP-26/41 cost-ownership flag remains the formalisation; it now inherits a correct,
test-pinned function.

**Integrity checker +4** (v6.31.0 section):
- SO_CLOSED_PL_INCOMPLETE (warning): a Closed SO with provisional cost data — cost
  lines still "Expected", sourced lots without costs, or no traceable SHIP_OUT. The
  business reads the P/L once, at close; this makes "Closed" mean "consuntivabile".
- LOT_RECEIPT_INCONSISTENT (error) + LOT_RECEIPT_NO_MOVEMENT (warning): T-20 tripwires —
  catch the "lot reset to Expected/0 kg" aftermath the moment it happens on real data.
- FX_RATE_SUSPECT (warning): non-PLN SO/PO/invoice with fxRate ≤ 1.05 (tier-2 pulled
  forward — found live: an EUR SO with fxRate 1 understates PLN revenue ~4×).

**Also:** A5 — checker no longer reports each broken shipment PO/SO ref twice (the
7a.4 errors are the single source; ORPHAN_SHIP_LOT kept); A3 — Shipments.tsx
nextShipmentNumber is year-scoped like the domain generator (diverged every 1 Jan).

Suite 138/138 (13 new pinned scenarios); full typecheck clean.

---

# Update v6.32.0 — Core-module batch for the operational test round

Scope agreed with the business: testing is currently focused on PO / SO /
Shipments / Inventory, so the pending core work ships NOW so the round tests
the final behaviour. Invoicing/Finance ownership work (A3-6 + A3-5 residue)
follows as v6.33.0 before invoicing tests begin.

## P1-1 — actual revenue/COGS per shipped line (with A1 as its foundation)
- **Canonical SO-line → lot matcher** (salesOrders.domain.findLotForSOLine):
  poLineId-first (FB-1), variety-aware (FB-12), claimed-set so one lot serves
  one line. Adopted by marginCalculations, shipments.domain (delegation),
  consignment.lineSourcesLot and the SO-cancel reversal. Real-data effect: a
  5-line same-product PO no longer resolves every line to the FIRST lot —
  actual COGS uses each line's own cost basis; consignment settlements no
  longer attribute one variety's sales to another variety.
- **Per-line shipped kg engine** (shippedKgByLine): SHIP_OUT movements (net of
  reversals) + a Delivered-but-not-posted safety net, deduped via shipmentRef.
- **Actual revenue is now evidence-based and partial**: kg delivered × price
  per line ("6 000/10 000 kg" labels). Deliberate recognition rule: goods
  merely LOADED are not yet revenue — revenue and COGS recognise together at
  Delivered/posting (recognising revenue earlier showed absurd mid-flight
  margins: full revenue, zero cost). Legacy orders marked Shipped with zero
  shipping evidence keep the old 100% figure WITH a warning.

## P1-7 — terms-aware shipment origin/destination defaults
The PO named place (BP-56) is the handover point, i.e. where OUR journey
starts: EXW/FCA/FOB/CIF/CFR/CIP shipments now default their ORIGIN to it (a
CIF journey starts at the port of discharge, not the producer); DAP/DPU/DDP
keep the supplier origin and default the DESTINATION to the named place. This
supersedes the original "port of arrival field" idea — the field already
exists as the named place.

## Integrity checker +2 (testing safeguards)
- DUP_LIVE_SHIPMENT: two live shipments, same SO, same goods kg, same cost
  total — the re-booked-truck-never-cancelled pattern (found live: SHP-0005/6).
- STALE_BILLING_FLAG: billingStatus "Cost allocated" with no allocation tags on
  any lot (found live: cancelled SHP-2026-0002).

## R7b quiet items
- **R7b-4 numbers.ts**: canonical comma-aware parser ("1,5" → 1.5; "1.234,56"
  and "1,234.56" both → 1234.56) adopted by the claim / settlement / payments
  engines — Polish decimal commas no longer silently truncate.
- **R7b-3**: CatalogItem is ONE contract (types.ts), re-exported.
- **R7b-5**: dead code removed (aggregateMargins pair, PAYABLE_CATEGORIES,
  linkedSORefs condition); ~50 KB of demo/standalone seed arrays moved out of
  the production bundle → dev/demoSeed.reference.ts (nothing imports it).
  Standalone module mounts now start empty.
- **R7b-6**: overhead allocation basis memoised (WeakMap on the state-array
  references — any React state update invalidates naturally). Aggregate
  Finance views drop from O(n²·m) margin recomputations to O(n).

## Docs & process
- **USER_MANUAL.md fully rewritten for v6.32.0** (was v6.10 — three rebuilds
  stale): purchase terms model, one-step shipment editor, event-driven
  inventory, claims/returns, Invoices ownership, evidence-based P/L, clean
  system, comma decimals.
- Standing rule adopted: every batch ships with the tracker updated and a
  changelog entry (tracker row P-5).

Suite 148/148 (10 new pinned scenarios); full typecheck clean. Real-data
regression: forecast figures identical to the v6.31.0 reconciliation; actual
coherently zero pre-delivery; the two new checks fire on the known real cases.
