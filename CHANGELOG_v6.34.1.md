# v6.34.1 — PO/SO refinements from the module-by-module review (4 items)

## Item 1 — PO place selector now follows the incoterm (mid)
- The box is renamed **INCOTERM DELIVERY (PURCHASE)** and behaves like the SO's: choosing the
  incoterm **defaults the delivery place** — EXW/FCA → the supplier's address; DAP/DDP → our
  warehouse address; FOB/CFR/CIF → left for you to pick from the ports pool. The custom
  free-text field is always available. A one-line guidance hint under the field explains what
  to fill for the chosen incoterm.

## Item 2 — one PDF route for Print/PDF and Email→Save PDF (mid)
- Both buttons now render the **same document node through the same routine** — previously
  two nodes had drifted apart, which is why the saved-file name (the PO/SO number) had stopped
  appearing on the Email→Save path. Unified, so the filename is the document number on **both**
  paths. Applied to **PO and SO**.
- Removed the bordered **Terms/Incoterms box** from the top of the generated PDF — the incoterm
  already appears in the document body, so it was redundant. PO and SO.

## Item 3 — PO summary table columns (low)
- Removed the **FLOW** column (no longer meaningful post-rebuild). Renamed **LINKED** →
  **LINKED DOCUMENTS**, and the cell now lists the actual document **numbers**
  (shipments / lots / invoices) instead of just a count.

## Item 4 — CN/HS auto-fill, with the missing foundation built first (mid)
- The premise was broken: there was **nowhere to store a CN code**. Added a **CN/HS column to
  the Settings product catalog** (per item), included in the **CSV import/export** round-trip
  (header `CN/HS`, recognised on import).
- Then: picking a product on a PO line **auto-fills its CN/HS from the catalog** — empty-only,
  so a manually-entered code is never overwritten.

## Tests & gate
- Suite **157 → 159** (per-item CN set/lookup; CSV round-trip preserves CN). Typecheck 0 ·
  eslint unused 0 · **real CRA production build: PASSED**.
