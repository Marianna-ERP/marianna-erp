# MARIANNA ERP — User Manual (v6.10.0)

A practical guide to running the day-to-day cycle: counterparties → purchase
orders → shipments → inventory → sales orders → finance. Sections marked **NEW
v6.10** describe behaviour introduced in this release.

---

## 1. Getting started

- The app runs in the browser. All your data lives in this browser’s local
  storage and is included in the Settings → Export JSON backup. Export regularly.
- The left sidebar switches modules: Dashboard, Counterparties, Purchase Orders,
  Shipments, Inventory, Sales Orders, Finance, Settings.
- Most screens have a list on one side and a detail/edit panel on the other.
  “Save” persists to local storage immediately.

---

## 2. Counterparties

Counterparties are every company you deal with: clients, suppliers, carriers,
forwarders, brokers and **warehouses**. One company can wear several hats (e.g.
a client that is also a carrier) via **“Also acts as”**.

### Adding / editing a counterparty
1. Click **+ New** (or **Edit** on a selected company).
2. Set the **Primary type** and any additional types.
3. Fill company name, country, the **NIP / Tax ID / EU VAT** field, and address.

### Warehouse tariff (companies typed “Warehouse”)
When a counterparty is a Warehouse, a **Warehouse tariff** section appears. It is
used to predict and check that warehouse’s invoices.

- **NEW v6.10 — decimals with a comma.** Storage, handling in/out, sorting, free
  days and FX → PLN all accept comma decimals (e.g. type `0,30`). What you type is
  kept as-is while editing; it is converted to a number when you press Save.
- **NEW v6.10 — Locations this warehouse operates.** The picker lists all
  warehouse locations **and** every warehouse counterparty’s address(es), not just
  the two built-in warehouses. Tick the locations whose stored lots should be
  charged on this tariff.
- **NEW v6.10 — Additional delivery addresses.** A warehouse company can have more
  than one site. Use **+ Add another address** to record each one; these become
  selectable warehouse destinations elsewhere.

### Find duplicates / merge
1. Use **Find duplicates** to scan for likely repeats (by tax ID, then by name).
2. Choose **Merge…** to combine a duplicate into a kept record.
3. For each differing field, pick which side wins.
   - **NEW v6.10 — tax identity.** NIP and EU-VAT now move together as one choice.
     Whichever side you pick supplies *both* values, so an old EU-VAT can no longer
     stick around after a merge. If you pick a side whose VAT is empty, the VAT is
     cleared.

---

## 3. Purchase Orders (PO)

A PO records what you buy from a supplier.

### Creating / editing
1. **+ New PO**, choose the supplier, set order date and **loading date** (when the
   supplier loads your truck/container — goods leave origin).
2. Set the **purchase Incoterm** (EXW, FCA, FOB, CIF, DDP, …) and destination flow.
3. Add **line items**. Each line has product, origin, size, quality, **Qty (kg)**,
   unit price, packaging, **Boxes** and **Pallets**.
   - **NEW v6.10 — Boxes.** Record the number of boxes per line. The PO detail
     view shows a Boxes column and a Boxes total.

### Status and the loading date
The lifecycle is Draft → Confirmed → In Production → Shipped → Arrived → Closed.

- **NEW v6.10 — ship gating.** You cannot set the status to **Shipped, Arrived or
  Closed while the loading date is still in the future.** The app blocks the change
  and tells you the loading date hasn’t been reached. If the loading date really
  changed, update it first, then change the status.

---

## 4. Shipments

A shipment moves goods along one or more **legs** (Road / Sea / Air / Rail). Each
leg has a route (From → To), dates, **transport units**, and costs.

### Creating a shipment
1. **Create shipment**, pick the source (from a PO, an SO, or Manual) and the mode.
2. In **Provider and cost**, choose the carrier/forwarder and enter the freight.
   - **NEW v6.10 — DDP purchases.** If you build the shipment from a **DDP** PO,
     this section changes: there is **no carrier to order and no freight cost on
     your side** (the supplier arranges transport). Instead you record the
     **incoming truck plate, trailer, driver name and phone** so you can track the
     delivery. These details seed the first leg’s transport unit, and the leg is
     created with zero cost (responsibility = Supplier).

### Editing legs
Open a shipment → **Edit** → the **Legs** section.

- **Route (From / To).**
  - **NEW v6.10 — free text.** Below each From/To dropdown there is now always a
    **free-text box**. Pick a known place from the dropdown, *or* type an address
    manually (useful for DDP and one-off places). Typing in the box overrides the
    dropdown for that side.
- **Transport units (trucks / containers / AWB).**
  - **NEW v6.10 — one home for vehicle data.** Truck plate, trailer plate, driver
    name and driver phone are entered **per unit** here (the old duplicate
    leg-level fields were removed). Use **+ Add unit** when one leg is split over
    several trucks. The transport order is generated from these units. Legs created
    before this release keep their values — they appear automatically as Unit #1.

### Costs & billing
Costs are recorded per leg/provider. A DDP supplier→warehouse leg carries no cost
on your books. The transport order and goods documents are generated from the
shipment’s legs and units.

---

## 5. Inventory

Goods received against POs become **lots**, stored at locations. Lot movements
(IN / TRANSFER / SHIP_OUT / DAMAGE / REVERSAL) drive stock levels and feed the
warehouse-charge engine. A lot stored at a tariffed warehouse location accrues
the storage / handling / sorting charges defined on that warehouse’s tariff, so
you can check the invoice you receive line by line (Finance → Warehouse charges).

---

## 6. Sales Orders (SO)

An SO records what you sell to a client; lines can come from stock or be pre-sold
from a PO.

### Incoterm · Delivery
1. Set the **Sell Incoterm** (EXW, FCA, FOB, CIF, CFR, DAP, …).
2. **NEW v6.10 — Destination “Deliver to”.** Choose:
   - **Client’s registered address** (default). When you select the client, the
     destination is auto-filled from their address on file and shown for
     confirmation. If the client has no address, add one in Counterparties or pick
     “Other”.
   - **Other address.** Reveals the known-place dropdown **plus a free-text field**
     for a one-off address the client asked you to deliver to. Free text takes
     precedence on the printed SO.

The destination shown here prints on the Sales Order confirmation.

---

## 7. Finance

Four tabs: **Sales P/L**, **Operational Costs**, **Warehouse charges**,
**Receivables & Payables**, with a Forecast / Actual toggle.

### Operational Costs
Company-level overheads (salary, rent, accountant, software, fuel, etc.), which
are allocated to sales-order P/L by the rule you choose per cost.

- **Add / edit a cost** on the left: period, date, category, cost center,
  description, supplier, invoice no., amount, currency, FX, allocation method,
  status.
- **NEW v6.10 — Entries register.** The list shows **Date · Supplier · Category ·
  Status · Amount**.
  - **Hover** any row to preview its full detail (period, date, cost center,
    invoice no., allocation, currency/FX, notes) in the panel above the table.
  - **Edit** / **Delete** are on each row.
  - **Filter by period and by supplier** using the dropdowns; the count and
    filtered total update live.
- **Import from Fakturownia.** Export your cost/expense register from Fakturownia
  as XLS/CSV and load it here (or use the live read-only fetch where available).
  Invoice number and issue date are imported and now visible as the Date and
  Supplier columns / invoice subtext.

### Warehouse charges
Reconcile each rented warehouse’s monthly invoice against the charges the system
expects from your lots’ movements and that warehouse’s tariff.

### Receivables & Payables
One ledger of everything owed — receivables from sales invoices, payables from
producer payouts, warehouse invoices, invoice-backed operational costs and
firm-price PO purchases — with Open / Overdue / Paid status and a net position.

---

## 8. Tips & housekeeping

- **Back up often:** Settings → Export JSON. Import restores everything.
- **Decimals:** comma decimals (`0,30`) are accepted on warehouse tariff and
  commission fields; elsewhere use a dot if a field rejects the comma.
- **Dates** are ISO (YYYY-MM-DD) under the hood; the date pickers handle the
  formatting.
- If a screen looks stale after an import, reload the page so every module picks
  up the change.

---

## 9. What changed in v6.10.0 (quick reference)

| # | Area | Change |
|---|------|--------|
| 1–3 | Finance · Operational Costs | Date/Supplier columns, hover detail, edit/delete |
| 4 | Finance · Operational Costs | Filter by period and supplier |
| 5 | Counterparties · Merge | NIP + EU-VAT paired; stale VAT can’t survive |
| 6 | Counterparties · Tariff | Comma decimals (`0,30`) accepted |
| 7 | Counterparties · Tariff | “Operates” lists all warehouses + addresses |
| 8 | Counterparties / Destinations | Multiple warehouse addresses (dropdown wiring in SO still pending) |
| 9 | Purchase Orders | Block Shipped/Arrived/Closed before loading date |
| 10 | Purchase Orders | Boxes per line + detail column |
| 11 | Shipments | DDP create: track truck/driver, no carrier, no cost |
| 12 | Shipments | Free-text From/To on legs |
| 13 | Shipments | Truck/trailer/driver live in the unit section |
| 14 | Shipments | DDP leg carries no freight cost |
| 15 | Sales Orders | Destination = client address, or “Other” free text |

*Manual generated for MARIANNA ERP v6.10.0.*
