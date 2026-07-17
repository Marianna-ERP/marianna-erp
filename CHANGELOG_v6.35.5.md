# v6.35.5 — P1 batch 1: road-mode fixes · shipment cancel reverses posted stock

First batch of the system-review plan (P1). All findings verified in code before fixing.

## Road-mode fixes (the bugs you sensed)
- **Changing the Mode now keeps the shipment consistent.** A single-leg shipment's leg follows
  the header mode (Road→Sea updates the leg, not just the label). Switching to **Multimodal**
  appends the missing Sea leg so header and legs always agree.
- **Your provider selection no longer vanishes on mode switch.** Road stores the provider in
  `carrierId` while Sea/Air use `forwarderId` — switching modes previously left the selection
  stranded in the field the UI stopped reading. The selection now migrates between the fields.
- **A manual Multimodal shipment starts with both legs** (road pre-carriage + sea main),
  matching the PO/SO builders — no more single-Road-leg multimodal.
- Honest correction to the review: the reported "Container/BL fields on road trucks" was NOT a
  bug — those fields were already correctly gated (my grep missed the surrounding guards).

## Cancelling a posted shipment now reverses its stock
- Cancelling a shipment that had already posted receipts/ship-outs left phantom kg in
  Inventory. Cancellation now **voids the shipment's movements** and recomputes each touched
  lot — history is kept (auditable), quantities and status return to their true state. The
  cancel confirmation says so explicitly.
- Engine fix uncovered by the new test: the stock reducer's **status** decision counted voided
  movements, so a fully-reversed lot stayed "In Stock · 0 kg" instead of returning to
  "Expected". Status now uses only live movements.

## Gate (verified twice)
- Suite 171 → **172** (post→void→recompute round-trip) · typecheck 0 · eslint unused 0 ·
  real CRA build PASSED.

## Next (per the plan)
- v6.36.0: Settings **Ports & locations manager** (P1 item 2).
