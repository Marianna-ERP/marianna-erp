# v6.34.4 — Partial line shipment: ship a PO line across several trucks

## The bug
A PO line could only ship all-or-nothing. Ticking a 42 000 kg line always loaded the full
42 000 — so after a first 21 000 kg shipment, the second was computed as 21 000 already +
42 000 again = 63 000, "exceeds the PO by 21 000 kg", and hard-blocked. You could never ship
the remaining half.

## The fix
- Each ticked product line now has a **"ship now (kg)"** input that **defaults to the line's
  remaining un-shipped quantity** (ruling #1). First truck: defaults to 42 000, you type
  21 000. Second truck: the line knows 21 000 already shipped, so it **defaults to 21 000
  remaining** — accept and go. No false block.
- Per-line shipped-kg is now tracked (goods rows stamp their source **poLineId**), so
  "remaining" is correct at the line level, not just the PO total.
- **Over-shipping stays a hard block** (ruling #2): entering more than a line's remaining is
  flagged red and blocked, with the remaining figure shown inline ("/ 21 000 left").

## Gate
- Suite **160/160** (new: 42 000 → 21 000 + 21 000 across two trucks) · typecheck 0 ·
  eslint unused 0 · real CRA build PASSED.
