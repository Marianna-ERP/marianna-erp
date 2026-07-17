# v6.35.1 — System-wide struck-through cancelled docs · Phase C step 3 (ownership from incoterms)

## System-wide strike-through for cancelled documents
- A single shared renderer (`DocRef` in ui.tsx) now strikes through any cancelled document
  number in red wherever it appears as a reference — not just the PO list. Applied to:
  - PO list LINKED DOCUMENTS (cancelled shipments)
  - SO list linked documents (cancelled source POs / shipments)
  - Shipment detail PO/SO reference pills
  - Inventory lot list source-PO reference
- Documents are soft-cancelled (kept on record), so the number stays visible but is clearly
  voided. One implementation means consistent behaviour everywhere and easy future extension.

## Phase C step 3 — lot ownership-per-stage now derives from real incoterms
- Continuing the flow-model retirement: a lot's ownership at each journey stage
  (not_owned / owned / handed_over) is now computed from the **real buy incoterm (its PO)** and
  **sell incoterm (its governing SO)**, via a pure tested engine (`ownershipAtPoint`), instead
  of the static flow key. An EXW-buy + CIF-sell lot is correctly "owned" from the supplier
  through the destination port, then "handed over" — regardless of any legacy flow label.
- The flow key remains only as a fallback for legacy lots whose incoterms can't be resolved.

## Phase C status
- Step 1 (v6.34.7) lot direction badge ✓ · Step 2 (v6.34.9) journey from shipments ✓ ·
  Step 3 (this) ownership from incoterms ✓. Next: retire the flow-derived customs-stage set,
  then remove FLOW_TYPES once nothing reads it.

## Gate (verified twice)
- Suite 166 → **170** (ownership-from-incoterm cases incl. EXW+CIF) · typecheck 0 ·
  eslint unused 0 · real CRA build PASSED.
