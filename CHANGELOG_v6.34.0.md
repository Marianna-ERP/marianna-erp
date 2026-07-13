# v6.34.0 — Shipment resolves its trade direction from real ends (BP-61)

From your Koper analysis: the shipment now determines its trade direction from the
producer's country and the *governing sales order's* destination — not by blindly echoing
the PO's provisional movement. One CIF-Koper purchase can father an EU-import truck and a
T1 cross-trade truck; each shipment now resolves independently and correctly.

## The problem you identified
- Direction was resolved from the PO alone. But a single PO (buy CIF Koper) legitimately
  splits at the port into per-client trucks — one to a Ukrainian client on T1
  (**cross-trade**, never enters the EU) and others to EU clients (**import**). The PO can't
  hold one answer; the *shipment* must, and it needs the SO to know the destination.

## What changed
- **`shipmentTradeDirection` now resolves from the real ends** via the four-class matrix:
  producer country (from the PO) × final destination country (from the governing SO's
  destination — ruling: the SO's named place per its sell incoterm, so a CIF-to-a-port sale
  goes where the goods physically go). Resolution order: manual override → derived from ends
  → PO provisional (no SO) → legacy. Test-pinned on the exact Koper case.
- **Creating a shipment from a PO linked to more than one active SO now asks which SO/client
  this truck is for** (Reading 1 — prompt whenever there's a choice of client). Each option
  previews the direction it implies; a "None — to our warehouse" choice covers the unsold
  portion. A PO with one SO uses it automatically; a PO with none defaults to import by the
  producer's location.
- **The governing SO is an editable field on the shipment**, beside Trade direction — a
  wrong attribution is fixable, and the Auto label shows the derived answer live
  ("Auto — Cross-trade (derived)").
- Your manual direction override still wins for the subtleties the matrix can't infer
  (goods transiting an EU port under T1).

## Scope note
- Your operation splits into single-destination trucks at the port (no one truck carries
  goods for two final countries), so direction is resolved per shipment, not per goods-row —
  the lighter, correct model for how you actually work.

## Tests & gate
- Suite **152 → 157, all green** (Koper split → import + cross-trade from one PO; no-SO
  fallback; SO-destination-over-client-country; manual override; intra-EU). Typecheck 0 ·
  eslint unused 0 · **real CRA production build: PASSED**.
