# MARIANNA ERP — User Manual (v6.33.0)

A practical guide to the day-to-day cycle: counterparties → purchase orders →
shipments → inventory → sales orders → invoices → finance. This edition fully
replaces the v6.10 manual — the PO/SO trade model, the shipment editor, cost
handling, settlements and claims have all been rebuilt since then.

---

## 1. Getting started

- The app runs in the browser. All data lives in this browser's local storage
  and travels in the Settings → **Export all data** file.
- **Automatic backup (v6.99.70).** In Settings → *Automatic backup folder*, choose
  a folder once — best one that OneDrive or Google Drive already syncs, so a copy
  leaves the computer. The app writes a file there when it opens, then two
  minutes after your changes stop (at most every 15 minutes), and keeps the
  newest 30 files plus one per day for 30 days. Each file is an ordinary Export
  file: to restore, use Settings → Import. Works in Chrome and Edge; in other
  browsers a strip offers *Download today's backup* once a day. After a browser
  restart Chrome may ask for the folder again — choose *Allow on every visit*.
- Settings → *Local backups* keeps snapshots taken before each import, restore
  or wipe, in this browser, as long as there is room. When your data needs the
  space, the oldest snapshot gives way first.
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

### Links, views and small changes (v6.99.76–79)

- **Document numbers are links.** In a PO's or SO's *Linked documents* box (and
  wherever a document number chip is shown) a click opens that document in its
  module; a blue strip offers **Back to …** the document you came from. With an
  unsaved form open, the usual "leave?" question comes first.
- **PO view:** *Order details* (was Terms), *Loading date*, *Expected delivery
  date*; Payment now shows what the PO holds (e.g. *30 days from invoice date*).
- **SO view:** line items in the PO's columns (Source, Product, Origin, Kl.,
  Packaging, Boxes, Qty, Unit price, Total) with the PO's total row; the Client box
  shows Client, NIP/VAT, Contact, e-mail; *Order details* lists order date, expected
  loading and delivery dates, sales incoterm, destination, payment, import permit and
  ACID, one per line.
- **PO form: ⧉ copies a line** — the copy lands under it with every field, so only
  what differs (e.g. the size) is changed. On a consignment PO the line total reads
  *Consignment*.
- **Planning sheet:** *Copy tab* is gone; Ctrl+V of rows from Excel still works.

### What the units take from the documents (v6.99.73–75)

- **A truck loads where its goods are.** Each truck's loading place and date come from
  the PO of the goods it carries (on EXW/FCA the producer's site and the PO's loading
  date), never from the shipment's first PO. A truck sent somewhere else shows an amber
  note with **Use it**; a truck carrying goods from two places is named, and you split
  it or list every stop on the order. In a multimodal shipment a new truck drives to
  the booking's POL.
- **Containers sail on their booking.** Every container takes the booking's POL, POD,
  ETD and ETA where it has none — also containers added before the booking was
  complete. What you typed stays; a container off its booking's port shows
  **↺ booking**. Changing the booking's port moves the containers still on the old one.
- **The POD comes from the sales order** when the SO's destination is a port — now
  stored, not only shown. A booking discharging elsewhere shows *SO-… delivers to …*.
- **Red outline = the transport order still needs it**: each unit's loading place and
  date, delivery place and date, and the booking's POL, POD, ETD, ETA (the same rule
  that holds back *Mark sent*). Nothing is blocked.
- **The sea order prints each container's own cargo** — what its trucks put in it.
  Before v6.99.73 every container showed the whole shipment.
- **A date must exist.** The date field refuses 31/06 or 29/02 in a normal year;
  Settings → integrity check lists any such date already stored.

### A company's addresses (v6.99.97)

Every address of a company — the main one and any further delivery or warehouse site —
now keeps an id of its own. Before, a second or third address would have been confused
with the first one (no company in the data had one yet). An address keeps its id when the
company is saved.

### Groupage — one truck, several orders (v6.99.92–96)

- **Create window:** after choosing the first sales order (or purchase order), add more
  with **+ add a sales order (groupage)** — one drop each (or one pickup each for POs).
  The shipment carries every order's goods rows; there is no single governing order.
- **The tour** shows on the truck in the editor: the loading stops come from where the
  goods are (the lot's warehouse; the PO's place for goods not yet received), the drops
  from each sales order's destination and delivery date. Set the order of the drops with
  ↑ ↓ — that order is all the truck stores. A sales order without a destination is named
  in red.
- **The transport order** of a groupage truck prints the tour: each loading and each
  drop in order, with its kilos and its sales order. Single-drop orders print as before.
- **Goods already in stock load where the lot is** (not at the producer).
- Every window's **Close** button is drawn again.

### Version 7 — Settings on the shared data (v7.0.0)

From v7 every release belongs to the shared-data era.
- **On the real shared data** there is no erase button: nobody can wipe the business's data.
  **Import** a backup restores it INTO the shared data for everyone — after showing the file's
  counts and asking you to type RESTORE, with the shared copy as it was downloaded first.
- **Archiving a season** removes it from the shared data (after its export file is saved).
- **On the TEST copy** the two reset buttons stay and act on the shared test data.
- The page explains where the data lives; the pill in the top bar has **sign out**.

### The shared data (v6.99.148)

With the two Supabase settings in place (see *docs/SHARED_STORE_SETUP.md*), the app keeps
ONE copy of the data for everyone: you sign in, the app loads the shared data, every save
goes to it, and colleagues' saves appear within 20 seconds. The pill in the top bar says
*shared · synced / saving / offline*. If two people change the same store within seconds,
the first save wins, the other person is told which store and keeps a conflict copy. Without
the settings nothing changes.

### Clean-up II, part 2 (v6.99.143–147)

- A stock movement's note names a document only as a whole number (old data without
  references); PO-line ids compare as text.
- The one-time heals are recorded inside the dataset, so an older file imported here is
  healed again; the rounding helpers never produce NaN; a bank line without a date books
  on today's date.
- A lot whose latest quality report says **Rejected** is shown in the sales picker but has
  nothing available until sorting or a return decides.
- The 17 integrity errors in the 2 Oct data are listed in *MARIANNA_Data_Errors_2_Oct.md*
  with how to correct each kind.

### Clean-up II, part 1 (v6.99.137–142)

- **Create shipment:** Source type, Reference and Mode on one line; the Groupage box tinted;
  the route preview reads where the goods are (the lot's place, or the PO's for goods not yet
  received) — never "our warehouse" by default.
- **Edit shipment:** the standalone groupage bar is gone; "+ add an order's goods" sits in the
  Goods box for an order joining after creation.
- **Transport order:** the terms in a smaller type, leaving room for the carrier's signature
  and stamp.
- **The import learns by seller — and by content for a multi-role seller:** Dantex (rent) and
  Orlen (fuel) are learned from the seller; AGRO-HURT (client, supplier and warehouse) from
  the last invoice whose line names resemble the new one's; nothing resembling → no guess.
- A sale line's PO cost line is found by id, then by product and variety — never "the first
  line".

### The import learns; likely links (v6.99.135–136)

- **Importing from Fakturownia:** each row is proposed from the seller's most recent earlier
  invoice — its kind, category and warehouse — marked *proposed from <that invoice>*; a
  same-seller invoice within ±10 % of the last amount is marked *recurring monthly*. Correct
  a seller's category once and the next import follows it.
- **Linking an invoice:** the Linked documents section lists only the likely documents
  (same counterparty, number quoted, matching amount or period), each with its reason, plus
  what is already linked; anything else by typing the full number.

### Consistency (v6.99.128–134)

- The Fakturownia import and the commission rate read numbers the one way ("1 230,50",
  "6,5"); the truck's commission defaults to the rate valid on its date.
- Bank matching ignores the words every company name carries (Spółka, Handel, Trans…).
- A client's credit note that names a lot — itself or through its claim — counts for that
  lot's truck in full; an unnamed note is shared by kilos.
- Once a sale is invoiced, its P/L revenue is the invoice's net less the client's notes —
  the rule the truck settlement already followed.
- A foreign invoice without a rate takes the settings' rate for its currency, never 1.
- Boxes are whole numbers; kilos derive from boxes × kg/box once.
- A claim with several lots splits by kilos only when every lot has its kilos.

### One source for every sale: the lot (v6.99.127)

A sales line always sells a **lot**. The picker shows lots with their state — *expected ·
not yet received* (sold ahead, as a PO line used to be), *in our stock*, or *direct ·
producer → client* — and the PO each comes from; the separate "PO lines" tab is gone. A
lot not yet received is available for its expected kilos, and other sales of the same lot
reserve it. Existing PO-sourced lines were pointed once at the lot made from their PO line
(126 of 135 in the 2 Oct data; the 9 left belong to deleted orders of deleted POs). Nothing
else changed: every sale's status and every truck settlement read the same as before.

### Clean-up I (v6.99.123–126)

- The old per-lot settlement window and the stock-history delete are gone (the truck
  settlement is the one settlement; a movement is voided, never erased); the empty
  document linker too.
- The **Load plans** tab is retired — the shipment's trucks, containers and forwarder
  reports do what it did. Existing plan records are kept as data.
- The sales report PDF is named with the supplier's reference and the producer.
- Deleting a lot, an operational cost or a quality report keeps it on record, marked
  Deleted, like every other document.

### Audit batch 3 — dates (v6.99.122)

- Every date the app writes is the LOCAL day: the Excel import keeps the sheet's own
  dates (they used to come in one day early), a due date adds days on the calendar (the
  March clock change no longer shifts it), and "today" is Poland's today everywhere.
- The code no longer contains a single UTC-date conversion outside the dates helper, and
  the source gate keeps it so.
- **Data check:** planning rows imported before this version may carry dates one day
  early — compare a few against the original workbook before trusting them.

### Audit batch 2 — money (v6.99.116–121)

- **Pushing to Fakturownia:** every line must carry its own price and the lines must add
  up to the invoice; otherwise the push is refused with the reasons. A quantity of 0 is
  never turned into 1 and the invoice total is never spread over lines.
- **Re-opening a truck settlement** withdraws the expected notes it created; closing it
  again keeps the same SET number.
- **Shipment costs** never allocate more than the cost and never lose a grosz.
- **Bank matching** finds an invoice number only as a whole token in the transfer title.
- **The bank is the source of payment (rule 11).** Invoices imported from Fakturownia come
  in as *Issued* (received) with their category from the tag — never Draft, never Paid;
  Fakturownia's paid flag is not read anywhere. The ledger lists what is still
  outstanding on each open invoice; a Draft is not yet a document. Existing imported
  Drafts were moved to Issued once at start-up (audit-logged).

### Audit batch 1 — the gates (v6.99.110–115)

- The test suites run on Poland's clock and report every failure before stopping; two
  source gates refuse any new UTC-date conversion or ad-hoc number parsing in the code.
- A voided stock movement stays on the lot, struck through with its reason; it is simply
  left out of the arithmetic.
- The shipment's stock-shortage check reads the kilos real lots carry, so it fires.
- **One writing tab per browser:** a second MARIANNA tab opens read-only with a notice;
  *Use this tab instead* hands the pen over and the other tab becomes read-only.
- The dashboard's "Month to close" names the right month.

### Class split and warehouse costs (v6.99.108–109)

- **One class split**, from the stock ledger: everything received that was not reclassified
  to class II or written off as waste is class I. The lot's stock tile, the sales
  availability, the settlement and the sales report all read the same split (before, the
  settlement showed class I = 0 until a sorting job was done).
- **A warehouse's invoice reaches the lots.** On a cost invoice from a warehouse company,
  **Allocate to lots** spreads its net amount over the lots that were at that warehouse in
  the chosen period, by kilo-days; you can adjust the amounts (they must add up to the
  invoice). The allocation writes each lot's *warehouse* cost line, which the truck
  settlement, the lot value and the P/L read. Allocating again replaces the earlier lines.

### Delete and Cancel — one standard (v6.99.99)

- **Delete** on a PO, SO, shipment, lot, invoice, claim or company never erases it: the
  record stays on record, marked **Deleted**, struck through in red wherever it appears,
  and opens read-only; it is out of stock, totals and status. The audit log keeps who
  deleted it.
- A record that other documents depend on cannot be deleted: the window lists those
  documents by number — delete them first.
- **Cancel** only closes a form or a window and goes back.
- Status filters have a *Deleted* entry; the former "Withdraw" is gone.
- Shipment view: Operational checklist | Documents on one row, Costs / billing | Notes on
  the next; the Route / legs row names the trucks' carriers and the booking's forwarder.
- PO-2026-0044 and alike (v6.99.100–104): a groupage truck posts one ship-out per sale;
  a quality report gets its number when saved; the PO's Linked documents show the sales
  made from its lots; the settlement box sits full width above Order details and Linked
  documents, with its deductions under *less* / *plus* and zero lines hidden.


### One owner for a lot's quantity, and the layouts (v6.99.87)

- **Received in our warehouse → the receipt owns the quantity.** The quality report
  pre-fills the received kilos; a different figure shows *the receipt says … kg —
  correct the receipt if this report is right*.
- **Delivered direct to the client → the client's quality report owns it.** Marking
  the truck Delivered posts the report's kilos (no report yet: the loaded kilos); a
  report saved after the delivery re-posts the lot to its kilos. The difference shows
  as the lot's variance; the settlement takes sold kilos from the sale, the shortage
  goes through the client's credit note.
- A PO's truck that names its sale (governing order) delivers as a pass-through to
  that sale.
- **Lot view:** right column = Linked documents, Inspections, Movement history, Notes.
- **Shipment view:** Goods sit right under the route and the transport orders; one
  *Documents* box (the transport order and loading protocols first, then the stored
  rows); *Containers — forwarder's reports* says what its two reports do.
- **Edit shipment:** the governing order has a line of its own (purchase and sale side by side).
- **Parties:** the warehouse agreement section and *Charged through our forwarder* are
  gone; the company panel shows only on the Companies tab.

### Dates, the PO's truck and the direct receipt (v6.99.86)

- **The list and the detail show the trucks' dates**: the actual loading and
  unloading once entered (in green), the planned ones until then.
- **A shipment made from a PO shows its governing order**: the purchase it comes
  from, and the sale it goes to, which you can choose (a DDP truck straight to a
  client). Naming the sale makes it count for that order's status.
- **Receiving a supplier-delivered lot** opens a window: the kilos, the arrival
  date proposed from the truck (its actual unloading, else its planned delivery,
  else the PO's expected delivery) — never today's date by default — the place the
  stock goes to, and a note.

### Customs files (v6.99.72)

The agent sends two e-mails per truck: the **release for export (CC529C)** on
the day of loading and, a week or two later, the **exit confirmation (CC599C)**
— the IE-599 that says the goods left the EU, the document behind 0 % VAT on
the export invoice. Their own SAD copy may come too. Drop all of them at once
in **Shipments → Import customs files**:

- Each file shows what it is, its facts (MRN, plates, invoice, kilos, exit
  date) and the shipment and truck it belongs to, with the reason.
- **Exact** (the MRN is already on a line, or the plates *and* the invoice
  point at one shipment) is pre-selected. Anything else you confirm from the
  candidates, or leave out. Nothing is attached on a guess.
- An exit confirmation dropped together with its release follows it.
- A file dropped twice changes nothing. **Detach file** on the line undoes an
  attachment whole (line back to *Pending*, register rows removed).

The line in the shipment editor still accepts a single file; if it belongs to
another shipment, the app names that shipment and refuses. The clearance
status gains **Exited**; the sales invoice's detail shows *exit confirmed* or
*exit not confirmed yet* per truck, straight from the shipments.

### The truck settlement (consignment POs, v6.99.84)

The box works in three columns:

1. **In PLN** — sales excl. VAT (from the sales invoices at their locked rates, or the
   sales orders until invoiced), less client credit notes, warehouse service, transport
   and other costs, claims against the producer, plus what third parties paid back.
2. **In the PO's currency** (EUR, USD or PLN) at the one rate in the box — sales after
   costs, our commission, what the producer is due after commission, and his provisional
   invoice (entered in its own currency; a third currency asks for its PLN rate).
3. **What moves**, as agreed with the producer: (1) he issues a credit note or an extra
   invoice for the difference between his provisional and the sales before commission;
   (2) we issue our commission invoice; (3) after compensation — who owes whom, and, when
   his provisional invoice is in the register, what is still to transfer.

Since v6.99.85: the **provisional invoice is picked from the register** (the producer's
cost invoices) — its net, currency, rate and payments follow, so *still to transfer* is
automatic; once a sale is invoiced, **the invoices' net less their credit notes** are the
sales (the order only until then); closing expects **both** the producer's credit note and
his extra invoice in the register; a **consignment lot** shows *priced at settlement* and,
once the provisional is known, ≈ PLN/kg provisional; **Finance → Consignment positions**
lists every consignment PO with sold / on stock, sales after costs, due after commission,
the provisional and its payment, and who owes whom.

A direct lot shows its expected kilos until the truck is Delivered. **Sales report**
prints on the company template; **Quality report** prints the lot's reports. A sales
order selling straight from a PO can be invoiced as soon as the supplier's truck is
Loaded. The PO list marks consignment POs and has a *Consignment* filter.

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

### The list and the lot view (v6.99.81)

- **Status** is one plain word: Expected, In transit, In stock, Shipped, Delivered,
  Cancelled. The stored value is unchanged.
- **Product** reads item — variety; size, packaging, origin; producer.
- **Arrived · age**: a stock lot shows its arrival date and days on stock (green,
  amber, red); a direct lot shows *Direct* with its loading and delivery dates and no
  count; an expected lot shows its expected date.
- **Location & flow**: a direct lot always reads *Direct · producer → client*, and its
  Import/Export comes from the PO and the sale even before a shipment exists.
- **Quantity**: free in green, reserved in orange.
- **Value PLN** is the lot's value in its own state — *in stock*, *delivered* or
  *expected* — with the cost per kg beneath. It is no longer 0 for goods that went
  direct.
- **+100 % under a lot number** means the same goods were loaded on two shipments
  (last season's trucks and then the sea shipment); hover to see which. Settings →
  integrity check lists them. Kept as history.
- **Lot view**: three header lines (lot; product, size, packaging, origin; class,
  location and flow); the value block follows the rule above; the workbench has a
  light header led by the PO number and the supplier's reference; the cost-breakdown
  box is gone (the header shows the cost per kg); linked documents are links.

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
