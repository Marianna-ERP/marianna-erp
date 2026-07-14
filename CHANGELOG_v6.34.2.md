# v6.34.2 — Module review round 2 (PO + SO, 5 items)

## Item 2 revisited — PDF filename now actually sticks (PO + SO)
- Root cause found: the browser reads the **top document's title** for the Save-as-PDF
  filename **when you confirm the save** — which happens long after `print()` returns. The
  old code restored the title after a 1-second timeout, so by the time you picked the folder
  the title was already back to the app default (blank filename). Fixed on all four routines
  (PO print + PO email-save, SO print + SO email-save): restore the title on `onafterprint`
  (real dialog close), with a long safety-net fallback. The saved file is now named after the
  PO/SO number regardless of which button you use.

## SO — destination free-text clears when it isn't the client address
- Switching the delivery mode to anything other than "client's registered address" now
  **clears** the free-text and any previously-picked place. Picking a known place (e.g. a CIF
  discharge port) also clears a stale client address if it was still sitting in the field.
  Fixes the CIF-with-client-address inconsistency.

## PO — flow fully removed from the main screen
- Removed the **flow filter** control (and its state/predicate) from the header — flow is no
  longer owned by the PO, so the filter no longer belongs. Combined with v6.34.1's removal of
  the FLOW **column**, the table header and the row data now line up correctly (no more
  right-shifted columns). Dead `FLOW_GROUPS` constant removed.

## SO — summary table clarity
- Header **Number → SO Number**, **Sources → Linked documents**, and the cell now **lists all**
  linked source documents instead of truncating to the first two.

## SO — the two "Delivered/Deliveries" indicators disambiguated
- The adjacent KPI cards read almost identically ("DELIVERED · to invoice" vs "DELIVERIES ·
  ≤7 days") but mean opposite things in time. Relabelled to **AWAITING INVOICE · delivered**
  (past: your invoicing backlog) and **DUE SOON · next 7 days** (future: deliveries to prepare),
  each with an explanatory tooltip.

## Gate
- Suite **159/159** · typecheck 0 · eslint unused 0 · **real CRA production build: PASSED**.
