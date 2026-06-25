# v6.18.14 — Seven fixes from testing

## #1 — PO email now sees the supplier's email live
The email dialog used a copy of the supplier taken when the PO was created, so an email
added in Contacts afterwards wasn't seen without a refresh. It now resolves the email
**live from Contacts** at send time (primary contact → any contact with an email →
company email), falling back to the embedded copy. Same live resolution applied to the
SO email dialog.

## #6 — Transport order email sees the first provider's email
The provider email was read only from the *primary* contact. If the email sat on another
contact (or the primary had none), the dialog couldn't open the draft — which is why it
worked for the second provider but not the first. It now resolves the email robustly
(primary → any contact with an email → company email), so each provider's email is found.

## #2 — Email → "Save PDF" names the file after the document
The Save-PDF step inside the email dialogs printed without setting the page title, so the
file got a generic name (the main-screen Print/PDF was already fixed in v6.18.8). The PO
email Save-PDF now names the file after the PO; the SO and transport-order email Save-PDF
were already correct.

## #3 — A PO with downstream links is fully locked
Once a Sales Order line, a non-cancelled shipment, or received/moved inventory is linked
to a PO, the PO is now **completely locked**: fields can't be edited, the status can't be
changed (including reverting to Draft), and it can't be cancelled or deleted — each
attempt explains what's linked. The only way to remove it is to **unlink every downstream
document first**, then delete. (Previously you could revert to Draft and edit it, which
corrupted downstream records.)

## #4 — New shipment no longer defaults to PO-001
The Create Shipment form starts with **"— Select PO —"** (nothing pre-selected) and won't
let you create until you choose the PO/SO, so a shipment can't be built against the wrong
PO by accident.

## #5 — "Actual" dates can't be set in the future
Every field that records something that has already happened is now capped at **today**:
PO order date and actual-availability; shipment actual loaded/unloaded and documents
"sent on"; inventory movement, sorting and return dates; invoice issue and sale dates.
Planned/expected/due dates are left free (they're legitimately in the future).

## Verified
- Type-checked clean (0 project errors) via the offline stub harness.

## Coming next (their own releases)
- **Consistent dd/mm/yyyy dates** everywhere displayed and printed.
- **Product catalog** — Item + Variety pickers on PO and SO lines, a Settings manager,
  import/export, on-the-fly add (one shared list). Seeded from your Items list.

> Run `npm install && npm run verify` locally before deploying.
