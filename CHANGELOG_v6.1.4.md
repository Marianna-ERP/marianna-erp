# v6.1.4 — Lot Journey 6.1d: customs overlay + movement-driven stage status; All-default filters

## Status filters default to "All"
- Inventory now defaults to "All" lots (was "In our possession"). PO and SO already
  default to All. So all three modules open showing everything.

## 6.1d — Customs as an independent, editable overlay
- Lots whose flow includes customs (export and/or import) now show a **CUSTOMS** card
  on the lot detail, separate from the journey timeline.
- Each clearance is editable: status (Not started / In progress / Cleared / Held),
  declaration ref (SAD / MRN), clearance date, customs broker (from contacts), and a
  customs cost + currency.
- The customs **cost flows into the lot's cost breakdown** (and thus cost-per-kg).
  Editing replaces the prior customs line for that clearance — no double-counting.

## 6.1d — Journey stage status driven by actuals
- Journey stages now reflect reality instead of all-"pending":
  - Stages the goods have physically passed show **done** (green ✓).
  - The current stage shows **active** (amber "● IN PROGRESS").
  - Later stages stay pending (grey).
- "How far along" is inferred from the lot's movements, current location and status
  (e.g. received into our WH ⇒ stages up to the warehouse are done).
- Customs stages reflect the customs overlay: "Cleared" ⇒ done, "In progress" ⇒ active.

Ownership colouring (from 6.1c) is unchanged and combines with the new status: a stage
can be both "ours" (green OURS badge) and "done" (green ✓ dot).
