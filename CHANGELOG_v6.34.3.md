# v6.34.3 — Hotfix: PO table column alignment (the real cause)

## What was actually wrong
The PO summary table's data rows were shifted one column right of their headers — VALUE
appeared empty, the amount sat under LOAD/DELIVERY, dates drifted toward LINKED DOCUMENTS.

My earlier fixes (v6.34.1 removed the FLOW column header; v6.34.2 removed the flow filter)
did **not** solve this, and I incorrectly reported the columns as aligned. The true cause,
found by counting cells against headers: the header row has **6** cells but each data row
had **7** — a leftover **⚓ SEA freight badge cell** with no matching header (a sibling of
the removed FLOW cell). Both rows use the same 6-column grid, so the extra cell pushed every
value one slot to the right.

## Fix
- Removed the orphan SEA-badge cell; folded the ⚓ SEA indicator into the VALUE cell (small
  inline badge next to the amount) so the signal is kept without a column of its own.
- Verified programmatically: data row now has exactly **6** cells matching the **6** headers.

## Gate
- Suite 159/159 · typecheck 0 · eslint unused 0 · real CRA build PASSED.
