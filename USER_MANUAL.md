# MARIANNA ERP — User Manual (v6.33.0)

A practical guide to the day-to-day cycle: counterparties → purchase orders →
shipments → inventory → sales orders → invoices → finance. This edition fully
replaces the v6.10 manual — the PO/SO trade model, the shipment editor, cost
handling, settlements and claims have all been rebuilt since then.

---

## 1. Getting started

- The app runs in the browser. All data lives in this browser's local storage
  and travels in the Settings → **Export JSON** backup. Export regularly; the
  app also keeps an automatic backup ring and takes a backup before every
  import and reset (Settings → Local backups).
- A **clean system starts empty by design**: after a reset, the PO supplier
  picker, the SO client picker and the shipment carrier/forwarder pickers show
  nothing until you add counterparties. No demo data exists anywhere.
- The **integrity badge** (top bar) continuously audits your data: broken
  references, oversold lots, duplicate invoices, suspicious FX rates, duplicate
  live shipments, incomplete closed orders. Click it whenever it turns amber or
  red — each finding says what is wrong and where.

---

## 2. Counterparties

Every company you deal with: clients, suppliers, carriers, forwarders, brokers
and warehouses. One company can wear several hats via **"Also acts as"**.

- Fill company name, country, **NIP / Tax ID / EU VAT** and address. Foreign
  companies without a Polish NIP show their EU VAT in the list.
- **Warehouse companies** get a tariff section (storage, handling, sorting,
  free days) used to predict and check that warehouse's invoices, and can carry
  several operating addresses — each becomes a selectable location.
- **Find duplicates / Merge** scans by tax id, then name; when merging, NIP and
  EU-VAT move together as one choice.
- CSV import groups multiple contact rows per company into one counterparty.
- A counterparty referenced by any document cannot be hard-deleted.

Decimal commas are accepted in every numeric field of the engines (`0,30` and
`0.30` are the same number) — the old "use a dot if the field rejects the
comma" tip is obsolete.

---

## 3. Purchase Orders

A PO records **the purchase agreement**: supplier, terms, lines, money. It does
not own the route (Shipments) or the stock (Inventory).

### Purchase terms (the current model)
1. Pick the supplier, order date and **loading date**.
2. Set the **purchase Incoterm** and the **named place** — the place adapts to
   the incoterm (producer site for EXW, port of loading for FOB, **port of
   discharge for CIF/CFR**, your warehouse for DDP). The app derives and shows:
   - the **trade movement** badge (Import / Export / Intra-EU / Cross-trade),
   - a plain-language **handover sentence** ("Seller delivers when …").
3. You cannot Confirm, print or email a PO without incoterm + named place.

There is no flow-type dropdown and no disposition on the PO any more: **what
happens to the goods after purchase is decided by the sale** (the SO), per
portion. The PO only says how you bought.

### Lines, status, locking
- Each line: product **Item + Variety** from the catalog (Settings), CN/HS,
  origin, size, quality, qty (kg), unit price, packaging, boxes, pallets. Item,
  variety and CN/HS inherit downstream (SO → lot → shipment) and lock there.
- Editable statuses are **Draft / Confirmed / Cancelled**. Operational progress
  (linked SO, shipment, receipt) shows as computed badges — you never set
  "Shipped" by hand.
- A Confirmed PO with anything linked downstream is locked; each block tells
  you what is linked. Cancelled = red, read-only, kept for the record.
- The PO number is system-generated and read-only.

Confirming a PO creates its **expected lots** (one per line, `poLineId`-linked);
editing the PO re-syncs still-expected lots; reverting to Draft withdraws them.

---

## 4. Shipments

Shipments own the **physical route** and the **transport money**.

### Creating
**+ New shipment** opens the one-step full-page editor on a draft — nothing is
saved until Save. Pick the source PO or SO explicitly (no silent default).

- **Origin defaults follow the purchase terms** (new in v6.32.0): for
  EXW/FCA/FOB/CIF/CFR/CIP the origin pre-fills with the PO's **named place** —
  so a CIF purchase starts its journey at the port of discharge, not at the
  producer. For DAP/DPU/DDP (supplier delivers) the origin stays the supplier
  and the destination pre-fills with the named place.
- **Groupage**: the SOURCES bar ("+ add goods from PO/SO") loads several POs or
  SOs on one truck; every goods row remembers its own PO/SO/lot.
- **Multi-stop legs**: each road leg can carry an ordered stop list; the
  printed transport order renders the numbered tour (base route + stops).
- Leg 2 pickup cannot precede leg 1 delivery.

### Status and inventory
The lifecycle is **Draft → Booked → Loaded → Delivered → Closed** (plus
Cancelled), and only the **next** logical action button shows. Inventory posts
**automatically as the status advances** — since v6.58.0 marking **Loaded**
already posts (for an outbound shipment, leaving the dock IS the movement), and
Delivered/Closed post their stage too: receipt for inbound, SHIP_OUT for
outbound, moves for transfers — driven by the shipment's purpose, never typed
by hand. Posting is idempotent, so each stage posts exactly once. The header
keeps a **Re-post inventory** button for corrections after editing goods; you
should never need it in the normal flow. Direct/EXW pass-through sales post the IN+SHIP_OUT pair at handover.

### Costs
- Freight and FX live as **cost lines**, not in the create step. Each line has
  a currency, FX, an **invoice status** (Expected → Received → Checked) and the
  cost responsibility (Marianna / Supplier / Client).
- **Allocate costs to lots** writes the shipment costs into the lots' landed
  cost (replace-by-source: re-running never duplicates; editing a cost and
  re-allocating replaces the old value).
- DAP/DDP purchases are supplier-arranged: responsibility Supplier, the
  supplier-paid freight line can be erased.
- A cancelled shipment keeps its record but is excluded from every P/L.

### Trade direction
The **shipment** owns the trade direction (editable, "Auto from source PO" by
default); the PO shows only a provisional chip.

---

## 5. Inventory

Inventory is **event-driven**: lots are created by PO confirmation, received
and shipped by shipment events. Manual movements are for internal relocation,
corrections (with reason) and opening balances only. Wrong manual entries are
**voided** (kept red/struck in history), never deleted.

- The lot detail shows: stock position (expected / received / physical /
  reserved / **available for sale** / shipped-out), the journey with real event
  dates, the movement history, the **cost breakdown** (purchase + allocated
  freight/customs/warehouse…), and the QUALITY & CLAIMS panel.
- **Producer claims**: the claim modal quantifies a defect (multi-currency,
  defect %, market recovery), issues a CLM-numbered bilingual document, books
  the requested credit note vs the producer, and logs a CLAIM movement
  (client-side claims never change warehouse stock). Resolution lifecycle:
  Issued → Accepted / Rejected / Settled.
- **Returns** restore stock via a REVERSAL movement and a standalone RET
  shipment; the original SO is not reopened — money goes the credit-note way.
- One-click **Trace/recall report** per lot: origin → shipments → clients →
  invoices, printable.
- Consignment lots show a settlement badge and a link; the settlement document
  itself lives in Invoices.

---

## 6. Sales Orders

An SO records the sale: client, **sell incoterm + destination** (the
destination adapts — ports for CIF/CFR/FOB, the client's address for DAP/DDP,
your warehouse for EXW), lines, prices.

- Add lines **from PO or from stock** (the primary path — it copies product,
  variety, CN/HS, origin, size, quality, packaging; you type only price, qty,
  pallets). Availability is variety-aware and reserves per line.
- You cannot confirm against a Draft PO, oversell availability, or confirm
  without sell terms. Cancelling an SO frees its PO and reverses any real
  ship-outs (direct pass-through lots are left untouched).
- **The sale owns the disposition**: one CIF purchase can split into an
  EXW-at-port portion, a DDP-direct portion and a to-warehouse portion, per SO.
- EXW sales use **Record client collection** — a minimal collection shipment,
  no transport order, no freight on your side.
- The per-SO **P/L drill-down** lives in Finance. Read it at close: the
  integrity badge warns if an SO is Closed while its cost data is still
  provisional (costs "Expected", lots without costs, no traceable dispatch).

### How the P/L counts (since v6.31–6.32)
- **Forecast** = full order value, PO purchase prices, expected logistics.
- **Actual** = evidence-based: revenue and COGS recognise per line, by the kg
  actually **delivered/posted** (partial deliveries show as "6 000/10 000 kg").
  Goods merely loaded are not yet revenue — revenue and cost recognise
  together. Legacy orders marked Shipped with no shipment records keep their
  old 100% figure and get a warning.
- Direct logistics costs: each SO takes **its kg share** of a groupage
  shipment's costs; costs already allocated to lots are never counted twice;
  cancelled shipments never count.

---

## 7. Invoices

The Invoices module owns every money document — **it is the sole register**:
sales invoices, purchase/cost invoices, credit & debit notes, **consignment
settlements** (SET numbers, with the auto-drafted commission invoice) and
payment events.

- "Issue Sales Invoice" on an SO writes the invoice **into this register** and
  moves a Shipped/Delivered SO to Invoiced; the SO panel and the Fakturownia
  match read and write the register too. Invoice numbering sees the whole
  register, so numbers issued here and from an SO can never collide.
- Legacy data folds in automatically and only once: old SO-embedded invoices
  and the old Finance credit-notes list migrate into the register/notes on
  load (importing an old backup re-triggers the fold; nothing duplicates).
- Payments are **events** (date, amount, method, note) — paidAmount and the
  status (Partially paid / Paid / Overdue) are derived.
- Duplicate guard: same counterparty + number + direction warns at entry and is
  audited register-wide by the integrity checker.
- Notes enter the receivable/payable totals with their sign.
- Fakturownia: live-write is OFF by default (read/import + Copy-payload).

## 8. Finance

Finance is analytics: the ledger (receivables/payables incl. notes), the P/L
with the per-SO drill-down (forecast vs actual), operational overhead
**budget** lines (actuals arrive as cost invoices linked by reference) and
warehouse-charge predictions vs invoices.

---

## 9. Settings & housekeeping

- **Export JSON** regularly; imports warn on app-version mismatch and always
  back up first. Storage health shows usage vs the ~5 MB budget.
- Product catalog manager (Item → Variety, CSV in/out).
- One editor at a time on a shared JSON; everyone on the same build (the
  version badge is in the nav).

## 10. What changed since the v6.10 manual (highlights)

- PO: flow-type replaced by **incoterm + named place** with derived movement
  and handover; statuses reduced to Draft/Confirmed/Cancelled + computed
  badges; number locked; disposition moved to the sale.
- Shipments: one-step full-page editor, groupage sources, multi-stop transport
  orders, next-action-only statuses, structured customs, costs as lines with
  invoice states, delivery-driven inventory posting, shipment-owned direction.
- Inventory: event-driven movements, void-not-delete, claims & returns,
  trace report, settlement moved to Invoices.
- Invoices: single source of truth; payment events; settlements & commission;
  notes in totals.
- P/L: per-line evidence-based actuals, pro-rata groupage costs, no
  double-counting with lot allocation, cancelled shipments excluded.
- Invoices: single register owns all invoices — the SO invoice flow writes
  there; the Finance Credit Notes tab is retired, its records folded into the
  canonical notes and finally counted in the receivable/payable totals.
- Clean system: no demo data anywhere after a reset.
- Decimal commas accepted everywhere in the engines.
