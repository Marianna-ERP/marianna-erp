# v6.35.0 — PO lock release on cancellation · red Delete buttons + confirmation · struck-through cancelled links

Three fixes from the PO-2026-0011 report (a PO with a wrong FX rate that stayed trapped).

## 1. A PO no longer stays locked after you cancel its shipments/SOs
- The lock had three triggers: a linked SO, a linked shipment, or a lot that was
  received/moved. The SO and shipment checks already ignored cancelled ones — but the **lot**
  check did not. So a lot created by a shipment kept the PO locked even after that shipment was
  cancelled, trapping the PO (you couldn't fix the FX rate).
- Now: a lot whose linked shipments are **all cancelled** no longer counts as received/moved, so
  cancelling the shipments (and SOs) releases the PO for correction. A lot with a genuine
  non-cancelled shipment, or real manual movements, still locks as before.

## 2. Delete/Cancel buttons are red and ask for confirmation (system-wide)
- The shipment delete action was a button labelled **"Cancel"**, not red, executing immediately.
  It's now a **red "Cancel shipment"** button with a **confirmation step** explaining the shipment
  is kept on record (read-only) and stops counting toward its PO/SO.
- The **Delete** buttons on PO, SO and Lot detail are now **red-filled** (were red-outlined).
  Their handlers already required confirmation; that's unchanged. Other destructive actions
  (Finance, Settings, Contacts) already confirm.

## 3. Cancelled linked documents are struck through in red
- In the PO list's **LINKED DOCUMENTS** cell, a cancelled shipment number is now kept but shown
  **struck through with a red line** (voided-but-on-record), so you can see at a glance which
  links were cancelled versus still live.

## Gate (verified twice)
- Suite 166/166 · typecheck 0 · eslint unused 0 · real CRA build PASSED.
