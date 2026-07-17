# v6.36.2 — P3: Claims get a front door

## The claims register (Finance → CLAIMS)
One place listing **every claim**: producer claims (CLM documents from the lot's quality flow)
and client claims (recorded against deliveries), each with type, reference, date, lot,
linked PO/SO, detail (defect % / kg / value) and status — including whether a credit note has
been drafted. Newest first. The register is read-only by design: each claim is edited where it
lives, and the empty state says exactly where to start one.

## Record a client claim FROM THE SO (where complaints actually arrive)
On a Shipped/Delivered/Invoiced/Closed SO: **⚠ Record client claim** — pick the delivered lot
(pre-filtered to the lots that shipped for this SO), enter affected kg (optional), the claim
value and a note. It logs the claim against the lot (warehouse stock untouched — those kg
already left) and **drafts the outgoing credit note** exactly like the Inventory quality flow,
linked to the sales invoice when one exists. Finalise the credit note in Invoices.

## Unchanged, now findable
The existing flows stay where they were — producer claim on the lot, client claim via the
lot's quality issue — the register and the SO button just give them the missing front door.

## Gate (verified twice)
- Suite 172/172 · typecheck 0 · eslint unused 0 · real CRA build PASSED.

The system-review plan (P1 → P2 → P3) is now fully delivered.
