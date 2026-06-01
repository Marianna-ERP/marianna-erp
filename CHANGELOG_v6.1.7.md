# v6.1.7 — Clear Movement-vs-Shipment guidance (EXW)

Rewrote the notice at the top of Record Movement to state the rule plainly:

- Record a **movement** here when the goods move but **we don't arrange the transport** —
  e.g. an **EXW sale where the client collects with their own truck** (use "Ship Out"),
  or for receipts, transfers between locations, and stock corrections.
- If **we book / pay for / document the transport** (carrier, freight cost, transport
  order), create it from **Shipments** instead, so the cost and paperwork stay linked
  to the lot.

Also added an EXW cue to the live "Ship Out" type description: "Use for an EXW sale
where the client collects with their own truck (no transport on our side)."

Mental model: Shipment = "we are moving the goods" (we book/pay/document transport);
Movement = "the goods moved" (a stock fact, incl. when the client collects, plus
receipts/transfers/corrections/write-offs).
