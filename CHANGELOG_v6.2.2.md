# v6.2.2 — UI batch: button labels & colours, tax field merge, shipment dates, mode-driven TBA

1. **Every Edit button is now labelled with text, not just an icon.** The contact-people
   edit control reads "✎ Edit contact"; company edit reads "✎ Edit company"; PO/SO/
   Shipment/Inventory/Finance edits all show "Edit" text.

2. **Tax field merged.** Contacts now has a single field "NIP / Local Tax ID / EU VAT
   number" (the EU VAT is just the local number with a country prefix). Existing records
   that had a separate EU VAT value fold into this field automatically.

3. **Add buttons are green** across all modules (+ New PO/SO, + New shipment,
   + Add line/unit/cost, + Record movement, + Add contact, New Counterparty, etc.).

4. **Edit buttons are blue** across all modules.

5. **Shipment dates.** In the create dialog, "Delivery date" is renamed "Expected
   delivery date". The shipment's own loading and expected-delivery dates are now the
   source shown in the shipment header/transport order (with the leg date only as a
   fallback), so what you set when creating — and what you change when editing — drives
   the header consistently.

6. **Mode-driven field prefill (TBA).** When you set a leg's (or transport unit's) mode:
   - Road → container, seal, booking, BL and shipping line are prefilled "TBA"
     (not used for road).
   - Sea / Rail / Air → truck plate, trailer plate, driver name and driver phone are
     prefilled "TBA".
   Prefill only fills EMPTY fields (never overwrites what you typed) and every field
   stays fully editable.

(Test build — empty shell; data is browser-local, export from Settings to back up.)
