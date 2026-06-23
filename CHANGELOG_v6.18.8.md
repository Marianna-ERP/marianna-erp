# v6.18.8 — Testing-feedback batch (UX, status & visibility)

Fixes from real testing. Six of the seven items reported; the seventh (PO → purchase
invoice) touches the ledger and is being done as its own isolated change next.

## #1 — Saved PDFs are named after the document
PO, SO, shipment transport orders and the inventory settlement statement now set the
filename to the document number when you Print / Save as PDF (e.g. `SO-2026-0091`,
`SHP-2026-0070-<provider>`). The browser was using the app's page title before, which
caused confusing generic filenames. (Technical note: the print iframe already had the
right title, but browsers take the PDF filename from the main page title — that's what
this now sets.)

## #2 — Transport order: "Mark sent" moved after "Email"
Button order is now Print / PDF → Email → Mark sent → Close, matching the natural
workflow (produce it, send it, then mark it sent).

## #3 — Inventory quality-issue window now fits the screen
The Record movement / Record quality-issue modal was a fixed size and could run off a
shorter screen with no way to scroll. It's now height-capped and scrolls, so every
field is reachable.

## #4 — Issuing a client invoice moves the SO to "Invoiced"
Issuing the sales invoice from a Shipped/Delivered SO now advances its status to
**Invoiced** automatically, instead of leaving it on Delivered. Closed stays Closed.

## #6 — Credit/debit note currency follows the linked invoice
When you pick "Against invoice", the currency is taken from that invoice and the
currency selector is **locked** (greyed, labelled "from invoice"), so a note can't be
raised in a different currency than the invoice it corrects.

## #7 — Credit/debit notes are visible in the Invoices list
They used to be hidden, attached only to their invoice. The main Invoices view now
shows them under a "Credit / debit notes" section with type, number, counterparty,
date, signed amount, status and the linked invoice. Clicking a note opens its invoice
(or the note itself if standalone). The same search / direction / status filters apply.

## Coming next (isolated)
- **#5 — PO → purchase invoice:** an arrived/confirmed firm-price PO will surface a
  purchase (COST) invoice in the Invoices module, and the Finance ledger will read it
  from there instead of computing the PO purchase separately — so it's visible as an
  invoice without double-counting. Ledger-affecting, so it ships on its own with the
  same before/after totals check we used for v6.18.6.

## Verified
- Type-checked clean (0 project errors) via the offline stub harness.

> Run `npm install && npm run verify` locally before deploying.
