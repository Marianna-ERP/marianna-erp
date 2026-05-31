# Marianna ERP — Test Scenarios (v6.0.6)

A structured set of end-to-end tests to confirm the system is solid. Work through
them in order. Each scenario lists **what to do**, **what you should see**, and a
**pass/fail** box you can tick. If something doesn't match, note it and send feedback.

> Tip before you start: in **Settings → Data management** you can export your test data
> to a JSON file at any point, so you can share the exact state you're seeing.

---

## 0. Setup & roles

| # | Step | Expected result | Pass |
|---|------|-----------------|------|
| 0.1 | Open **Settings → Current user & role**. Set role to **General Manager**, name "GM test". | Role and name save; they persist after a page reload. | ☐ |
| 0.2 | Switch role to **Assistant**, reload the page. | Role still shows **Assistant** after reload (persisted). | ☐ |
| 0.3 | Set role back to **General Manager** for the rest of the tests. | — | ☐ |

---

## 1. Contacts — baseline parties

| # | Step | Expected result | Pass |
|---|------|-----------------|------|
| 1.1 | Open **Contacts**. Confirm the four baseline test parties exist. | Supplier **Owoce Polska Sp. z o.o.** (Poland); Client **Nile Fresh Imports** (Egypt); Carrier **PolTrans Drogowy** (Poland, road); Forwarder **Adriatica Forwarding S.r.l.** (Italy, Sea/Road/Customs). | ☐ |
| 1.2 | Open **PolTrans Drogowy**. Check its services. | Services include **Road** only. | ☐ |
| 1.3 | Open **Adriatica Forwarding**. Check its services. | Services include **Sea, Road, Customs**. | ☐ |
| 1.4 | Create a brand-new test client (any country). Save. Reopen it. | New client saves and reappears with all fields intact. | ☐ |

---

## 2. Purchase Order — multi-product, with pallets

| # | Step | Expected result | Pass |
|---|------|-----------------|------|
| 2.1 | Open **Purchase Orders → + New PO**. Supplier = **Owoce Polska**. | Form opens; supplier selectable. | ☐ |
| 2.2 | Add **3 different products** (e.g. Apple, Pear, Carrot), each with a qty, packaging, and a **Pallets** value. | Each line accepts a Pallets number next to Packaging. | ☐ |
| 2.3 | Set the PO flow to an **export** flow (so it's a supplier→client-port direct export). Save the PO and confirm it. | PO saves; status can move past Draft. | ☐ |
| 2.4 | Reopen the PO. | All 3 products, their pallets, packaging, and the export flow are intact. | ☐ |
| 2.5 | Try to **email** the PO. Look at the email text. | Greeting reads **"Dear Owoce Polska Sp. z o.o.,"** and signs **"Best regards, MARIANNA"** (not a contact person / Hazem). | ☐ |

---

## 3. Sales Order — sourcing, duplicate detection, dates

| # | Step | Expected result | Pass |
|---|------|-----------------|------|
| 3.1 | Open **Sales Orders → + New SO**. Client = **Nile Fresh Imports**. | Form opens. | ☐ |
| 3.2 | Add **2 lines**, both sourced from the **same product line of the PO** you made in test 2. | A warning banner appears: **"Same source assigned to more than one line"**, listing both lines and the combined kg. Each line also shows an inline "Same source used twice" notice. | ☐ |
| 3.3 | Change one line to source from a **different** PO product. | The duplicate warning disappears. | ☐ |
| 3.4 | In a line, source more kg than the PO line has available. | An availability/overage warning appears for that line. | ☐ |
| 3.5 | Set the SO's expected delivery date **earlier** than the PO arrival. | A "Delivery date is before PO arrival" warning appears. | ☐ |
| 3.6 | Look at the line-item **Source** badge for a PO-sourced line. | Under the PO number, the **supplier name** is shown. | ☐ |
| 3.7 | Email the SO. | Greeting reads **"Dear Nile Fresh Imports,"**, signs **"Best regards, MARIANNA"**. | ☐ |

---

## 4. P/L visibility by role

| # | Step | Expected result | Pass |
|---|------|-----------------|------|
| 4.1 | As **General Manager**, open any SO detail. | The **Profitability (P/L)** card shows full numbers. | ☐ |
| 4.2 | Settings → set role to **Operations**. Reopen the same SO. | P/L is **hidden**, with a short note explaining it's hidden for your role. | ☐ |
| 4.3 | Settings → set role to **Sales**, name "Anna". Create a **new** SO (it gets tagged to Anna). Open it. | P/L is **visible** for this SO (Anna created it). | ☐ |
| 4.4 | Still as **Sales / Anna**, open an SO you did **not** create (e.g. a seed SO). | P/L is **hidden** (Sales sees only their own). | ☐ |
| 4.5 | Settings → **Financial Director**. Open any SO. | P/L is **visible** for all SOs. | ☐ |
| 4.6 | Return role to **General Manager**. | — | ☐ |

---

## 5. Direct export shipment (single road leg) — the core flow

> Use the **export PO** from test 2.

| # | Step | Expected result | Pass |
|---|------|-----------------|------|
| 5.1 | **Shipments → Create shipment**. Source = **From PO**, pick your export PO. Mode = **Road**. | Create modal opens. | ☐ |
| 5.2 | In **Products to load on this shipment**, untick one product so only **2 of the 3** are loaded. | Only 2 products stay ticked. | ☐ |
| 5.3 | Pick **PolTrans Drogowy** as the carrier. Enter a freight amount. Create. | Shipment is created. | ☐ |
| 5.4 | Open the new shipment's **general view** (list row + detail header). | Purpose reads **PO export** (not "PO import"). Route shows **supplier → client port** — **no WH-01 Poznań** anywhere. | ☐ |
| 5.5 | Look at the **Goods** section. | Only the **2 loaded products** appear (not all 3). Each row shows **PO number, SO number (if linked), and Lot**. Pallets reflect what you entered (not an auto-guess like 22). | ☐ |
| 5.6 | Look at the **Route / legs** section. | **No "Cost: 0" line** in the leg display (costs live in Cost/Billing). | ☐ |
| 5.7 | Open **Transport order confirmation**. | Provider dropdown shows **PolTrans Drogowy** (the carrier you chose), **not** Trans-Logistics. Header reads **"CARRIER ORDER / ZLECENIE DLA CARRIER"**. | ☐ |
| 5.8 | In the transport order, check the unit count and print. | **1 unit** for the single truck. The document fits on **one A4 page** when printed/saved as PDF. | ☐ |

---

## 6. Multimodal export shipment (road + sea, two providers)

| # | Step | Expected result | Pass |
|---|------|-----------------|------|
| 6.1 | Create a shipment from a sea/export PO, Mode = **Multimodal**. | The provider section is titled **"Providers"** (not "Provider and cost"). | ☐ |
| 6.2 | In **Providers**, pick **PolTrans Drogowy** as road carrier and **Adriatica Forwarding** as sea forwarder. | Both can be selected independently. **No single freight-amount input** here (a note explains costs are entered per leg later). | ☐ |
| 6.3 | Create and open the shipment. Open **Transport order confirmation**. | Provider dropdown lists **two** providers: PolTrans (carrier) and Adriatica (forwarder) — and **no uninvolved company**. | ☐ |
| 6.4 | Select **PolTrans** in the dropdown. | The order shows **only the road leg(s)**, road route, and road cargo — not the sea leg. | ☐ |
| 6.5 | Select **Adriatica** in the dropdown. | The order shows **only the sea leg**, port-to-port, and its cargo. | ☐ |
| 6.6 | Use the **leg checkboxes** to add/remove a leg from the order. | The document updates to include only the ticked legs. | ☐ |

---

## 7. Editing a shipment — costs and containers

| # | Step | Expected result | Pass |
|---|------|-----------------|------|
| 7.1 | Edit the multimodal shipment → **Costs and billing**. Click **+ Add cost**. | A new line is added with type **Other** and a **delete (✕)** button. | ☐ |
| 7.2 | Click the **✕** on that new line. | After a confirm, the line is deleted. | ☐ |
| 7.3 | Look at the **road freight** / **sea freight** lines. | They show a **lock 🔒** instead of a delete button; trying to remove them is blocked with an explanation. | ☐ |
| 7.4 | Edit a **sea leg**. Type a full container number (e.g. **MSCU1234567**) in the Container field. | The whole number is **visible** in the field (it's now wide enough). | ☐ |
| 7.5 | Add a second **transport unit** to a leg and enter a container + seal. | Container and Seal are **separate fields**, both fully readable. | ☐ |
| 7.6 | Save and reopen the shipment. | All cost lines, container numbers and units persist correctly. | ☐ |

---

## 8. PO ↔ SO ↔ Shipment linkage

| # | Step | Expected result | Pass |
|---|------|-----------------|------|
| 8.1 | Open the export **PO** from test 2 → **Linked records**. | A **Sales orders** row lists the SO(s) that source from this PO. A **Shipments** row lists the shipment(s) you created from it. | ☐ |
| 8.2 | Open the **shipment** you built → header pills. | Shows the **PO number**, the **SO number** (if the PO was linked to an SO), and **Lot** number(s). | ☐ |

---

## 9. Inventory (current state)

| # | Step | Expected result | Pass |
|---|------|-----------------|------|
| 9.1 | Open **Inventory**. Open a lot's detail → **Notes** summary. | The lot notes summary is present and readable. | ☐ |
| 9.2 | Confirm lots created from a direct-export PO show the correct lot number and product. | Lot number and product match the PO. | ☐ |

> Note: deeper inventory features (lot journey/ownership, weight-loss events, multi-destination splits) are **not built yet** — see the roadmap. Don't test those.

---

## 10. Data safety

| # | Step | Expected result | Pass |
|---|------|-----------------|------|
| 10.1 | Settings → **Export** your data to JSON. | A JSON file downloads. | ☐ |
| 10.2 | Reload the page. | All your test data (POs, SOs, shipments, role) is still there (it's stored in your browser). | ☐ |

---

## How to report

For anything that fails: note the **scenario number**, what you **expected**, and what you
**saw**. If you can, export your data (10.1) so the exact state can be reproduced.
Screenshots of the specific screen help a lot.
