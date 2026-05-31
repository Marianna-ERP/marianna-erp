# v6.0.5 — SO duplicate detection, role-based P/L, shipment providers & SO link

1. **SO same-source double-assignment** — when two lines in ONE sales order draw from
   the same source (same PO line, or same lot), the form now warns:
   - A banner above the line items lists the affected lines and combined qty.
   - Each duplicated line gets an inline "Same source used twice" notice.
   This catches assigning one physical product twice in a single SO. (It's a warning,
   not a hard block, since legitimately splitting one PO line across two SO lines —
   e.g. different prices — is still allowed.)

2. **Role-based P/L visibility** — added a simple user role system:
   - New "Current user & role" card in Settings: pick Assistant / Operations / Sales /
     Financial Director / General Manager, and optionally your name.
   - SO profitability (P/L) is now gated:
     - Assistant & Operations: P/L hidden entirely.
     - Sales: P/L visible only for SOs they created (tagged by name on creation).
     - Financial Director & General Manager: see all P/L.
   - When hidden, a short note explains why and points to Settings.
   - (No login yet — this is a switch for testing. Existing SOs have no creator tag,
     so Sales won't see their P/L until they create new ones under their name.)

3. **Multimodal shipment "Providers" section** — for Multimodal/Sea shipments the
   Provider section is renamed "Providers" and the single freight-amount input is
   removed (it never fit a 2-provider shipment). Costs are entered per leg later in
   the shipment's Cost & Billing section, avoiding duplication. Single-mode shipments
   keep the freight input as before.

4. **SO number visible in shipments built from a linked PO** — when you create a
   shipment from a PO that an SO sources from, the shipment now auto-carries that SO
   number: it shows in the header pills and in the Goods view's PO/SO/Lot column,
   the same way the PO and lot numbers already did.

(Reminder: shipment fixes apply to NEWLY created shipments; recreate to see them.)
