# v6.3.0 — Feedback batch: duplicates & merge, shipment form rework, import documents, custom ports, inventory fixes

## Contacts
1. **Duplicate detection on save.** Saving a new counterparty (or renaming /
   changing the tax ID of an existing one) now checks for duplicates: strict
   match on tax ID, **fuzzy match on company name** (punctuation and legal
   suffixes like "Sp. z o.o.", "S.r.l.", "GmbH" are ignored, so
   "Owoce Polska" matches "Owoce Polska Sp. z o.o."). A review dialog offers
   **Open existing / Merge… / Save anyway**.
2. **Merge dialog.** Side-by-side field-by-field choice of which value to keep
   (name, address, tax ID, payment terms, notes...). Contact people and linked
   documents are combined automatically; secondary types and services are
   unioned. The kept record remembers the absorbed record's id, so existing
   POs, SOs and shipments **re-point to the surviving record** automatically.
3. **⧉ Find duplicates** button in the Contacts toolbar scans the whole list
   for suspected pairs (same tax ID or similar name) and lets you review &
   merge each pair.

## Inventory
4. **Record movement / Record inspection fixed.** Both dialogs errored on any
   quantity for lots created by export ("direct flow") POs:
   - "Direct Expected" lots now default the movement type to **Receipt (IN)**
     (previously they fell through to Transfer with a 0 kg max).
   - Ship-out / damage / inspection write-offs on direct lots now validate
     against the **expected (direct) quantity** instead of physical kg — goods
     on direct flows never enter our warehouse, so physical kg is always 0.
   - When a movement type genuinely has 0 kg available, a clear amber hint
     explains why and what to do, instead of a dead-end error.
5. **Lot status fix.** After receiving goods, lot status now derives correctly
   (In Stock / Customs / Shipped Out). Since the v5.8 location consolidation it
   compared against the wrong taxonomy and showed "In Transit" for everything.
6. **Linked SOs via shipments.** The Linked column (list) and Linked documents
   (lot detail) now also show SOs connected to the lot **through a shipment**
   (header SO refs and per-goods SO refs), with a "via SHP-..." tag.
7. **Quantity breakdown compacted** to a single dense strip (figures + bar on
   one row, one-line variance note) in the PO-module style.

## Shipments
8. **Date semantics.** "Loading date · loaded at supplier" (start of shipment)
   and "Expected delivery · delivered to client" (per purchase/sales
   agreements) — labels and tooltips in both the create and edit forms.
9. **Vehicles field removed.** The manual header counter is gone; the unit
   count is now **derived automatically** from the transport units on each leg
   and shown read-only.
10. **Customs / broker is a dropdown** sourced from Contacts (Brokers and any
    counterparty offering the Customs service) — same pattern as Carrier and
    Forwarder. Legacy free-text values stay visible until a broker is picked.
11. **Billing status moved** from the header into the **Costs and billing**
    section.
12. **Standard document checklist.** Every shipment now carries: Invoice,
    Packing list, EUR.1, Phytosanitary certificate, Export declaration — plus
    **CMR** when there's a road leg, **BL** for sea, **AWB** for air
    (conditional). Rows can be added manually and removed; a new **N/A** status
    marks irrelevant ones. New field: **Courier tracking nr (DHL)** + date for
    the original document set sent to the client (shown in the shipment detail).
13. **Leg numbering.** Each leg card in the edit form is headed **Leg #1,
    Leg #2…** with its mode badge — matching the Unit #N pattern.
14. **From / To selection reworked.** Free-text datalist replaced by a grouped
    dropdown (Our warehouses / Suppliers / Ports & airports / Clients /
    Customs); sea/air/rail legs list ports first. **✏ Custom…** keeps free
    text for one-off places. Legs **auto-chain**: a new leg starts where the
    previous one ends, and filling a leg's "To" pre-fills the next leg's empty
    "From".
15. **Mode-driven leg & unit fields.** Road legs/units show only truck,
    trailer and driver fields; Sea/Rail show container, seal, booking, BL and
    shipping line; Air shows AWB, booking and airline. (Replaces the v6.2.2
    "TBA prefill" approach — irrelevant fields are simply not shown.)
16. **Leg defaults by mode.** Multimodal shipments start with **2 legs**
    (road pre-carriage + sea main); every other mode starts with **1 leg** of
    that mode. Extra legs (e.g. on-carriage after customs) are added with
    "+ Activate extra leg". A shipment always keeps at least one leg.

## Sales Orders
17. **Import permit no. & ACID no.** New fields on the SO (Order details).
    Both print on the bilingual SO document and are included in the SO email.
18. **Single-use alarm with override.** While typing, the form warns live if
    the permit/ACID number is already used on another SO. On save, a blocking
    warning lists the conflicting SO(s) and their shipments; the user can
    explicitly **override and continue**, and the override is recorded in the
    SO notes with a timestamp.

## Locations / Settings
19. **Custom ports & locations.** New **Settings → Locations & ports** panel:
    add ports, airports, client sites, supplier sites, warehouses or customs
    points (name, country, type, address). They appear in every destination
    and leg From/To dropdown across all modules, get IDs from 10000 up (never
    clashing with built-ins), are stored with your data, and are included in
    the JSON export/import. The page reloads after add/remove so all modules
    pick the change up.

(Test build — data is browser-local; export from Settings to back up.)
