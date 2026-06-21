# v6.13.0 — Shipment providers, Inventory quality issues, PO lifecycle, credit notes

First half of the post-test batch — the items that are independent of the
transport-confirmation rework, so they can be tested on their own. The leg / unit
/ document restructure (which rewrites the transport confirmation) is the next,
focused pass.

> Transpile/syntax-checked only — run `npm install && npm run build` locally
> before deploying.

## Done in this version

- **Carrier / forwarder / customs now pull from Counterparties** (create shipment
  and edit header). A counterparty entered as Carrier / Forwarder / Broker with no
  "services" list was being filtered out; now the dropdowns fall back to the
  counterparty **type**, so your real contacts appear. (#2, #3)

- **PO lifecycle view standardised to the SO view** — same pill-chip bar with
  check-marks for completed stages. (#1)

- **Inventory: "Record quality issue" is its own red button** beside "Record
  movement". The in-modal tab is gone; each button opens the right form. (#14)

- **Quality issue — "Where was it detected?"** field added (port of discharge / at
  the client on an export / at our warehouse on arrival / at the client's warehouse
  on a direct delivery / at supplier-origin / other). The problem is still recorded
  against the lot, but now captures where in the journey it surfaced. (#15)

- **Sea unit "Kg" field width** reduced — it no longer stretches across the row. (#8)

- **Credit notes** now match the workflow: **Outgoing** = we issue to a **client**;
  **Incoming** = we request one from the **supplier or transporter** at fault. The
  counterparty list filters to clients vs suppliers/carriers/forwarders by
  direction, with matching labels. (#16)

## Next pass — the transport-confirmation cluster (not in this version)
These are tightly coupled (they share the leg/unit data model and the transport
confirmation document), so they'll ship together and be tested as one:
- Move **temperature recorder** to the unit (per truck). (#4)
- Move **container number** to the unit; **remove the seal-number** field. (#5)
- Keep **booking no., BL no., shipping line at the leg** (cover all units). (#6)
- Add a **CMR number per road unit**. (#12)
- **Transport confirmation**: fix per-leg data pickup; move the **Email** button
  inside the module to match PO/SO. (#7)
- **Documents section**: remove **Transport order** (auto-detected on email) and
  **CMR** (now per unit) from the checklist; pull **BL reference from the leg** and
  the **export declaration reference from the Inventory export clearance**.
  (#9, #10, #11, #13)
