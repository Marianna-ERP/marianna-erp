# v6.35.4 — T-20 fixed: arrival auto-posts the receipt; manual movement is transfer-only

## The real cause of T-20
The report was "cancelling an SO resets a DDP→warehouse lot to Expected/0". Investigation
(static tracing + two runtime reproductions) showed the SO-cancel does NOT reset anything — a
properly-received lot survives it intact. The "Expected/0" state was the lot's TRUE state: its
shipment showed Arrived, but the inventory receipt had never been posted, because auto-posting
only happened on the "Delivered" transition — not on "Arrived". Cancelling the SO merely
re-rendered Inventory and made the never-received state visible.

## Fix 1 — arrival posts the receipt automatically
- Marking a shipment **Arrived** now posts the inventory movement (the lot's IN receipt), not
  only "Delivered". For an inbound shipment, arrival at the warehouse IS the receipt. Posting is
  idempotent (guarded), so running on both Arrived and Delivered never double-posts.
  (Test-pinned: an inbound shipment posts exactly one IN, and re-posting adds none.)

## Fix 2 — manual movement is TRANSFER only
- Per the rule "the system should be automated to reduce human error; manual movement is only
  between warehouses": the Record-movement dialog now offers **Transfer only**. Receipts (IN)
  and dispatches (SHIP_OUT) are no longer manual options — arrival posts the receipt, and an EXW
  client-collection posts the ship-out via its collection shipment. This removes the manual
  receipt/dispatch that let a lot's state drift from its shipment in the first place. Quality
  issues/write-offs remain in the separate "Record quality issue" flow; existing IN/SHIP_OUT
  movements can still be edited.

## Gate (verified twice + runtime reproduction)
- Suite 170 → **171** · typecheck 0 · eslint unused 0 · real CRA build PASSED.
