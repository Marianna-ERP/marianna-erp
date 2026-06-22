# v6.18.2 — UI/UX batch (items 1–4)

A usability patch on top of v6.18.1. No data-model or financial-logic changes.

## 1. Status field — aligned and more visible (PO + SO)
The Status field now sits in the **same place** in both the Purchase Order and
Sales Order forms — the first cell of the Order Details card — and is styled with a
**colored left border matching the status** (and colored text), so it reads at a
glance instead of being a quiet dropdown buried mid-form. The SO status keeps its
existing "only Draft/Cancelled available until sourced & supplied" logic.

## 2. Data check-up badge — now clearly clickable
The integrity badge already opened a panel listing each problem with the exact
record (e.g. "Shipment SH-… references PO-… which no longer exists") and a "Go to
module" link — but it didn't look clickable, so it was easy to miss. Added a ▾
chevron that rotates when open and a clearer tooltip ("click to see which records
have problems"). No change to the checks themselves.

## 3. Top navigation — grouped and compact
The nav is now grouped into clusters with thin dividers — Dashboard · (Purchase
Orders / Inventory / Sales Orders / Shipments) · (Invoices / Finance) ·
(Counterparties / Settings) — with shorter labels (full names on hover) and tighter
spacing, so it no longer scrolls off the side of the screen.

## 4. Shipment documents — light, optional tracker
Reworked so it won't be a daily burden:
- **Collapsed by default** — one line you can expand only when you want it, showing
  a "done/total" count. Clearly labelled **optional — never blocks a shipment**.
- **No more per-row dates.** Each document is just a simple state: **Missing / Have
  it / Sent / N/A**.
- **Refs still auto-fill** (BL from the leg, export declaration from the lot's
  customs clearance) and stay read-only so nothing is typed twice.
- The courier-waybill field for originals-to-client is kept, inside the panel.
- New/standard documents now start as "Missing" rather than "Required".

## Verified
- Type-checked clean (0 project errors) with the offline stub harness.

> Run `npm install && npm run build` locally before deploying.
