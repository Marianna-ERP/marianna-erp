# V5.5 minor changes

## Applied changes

1. Purchase Orders
   - Changed the visible label from **Buy Incoterm** to **Purchase Incoterm**.
   - Added destination to the printable PO document.
   - Added a destination free-text override below the dropdown.
   - Expanded the port list for export/import scenarios.

2. Sales Orders
   - The edit form now shows **Print / PDF** and **Email Client** for non-draft SOs even before leaving the form, matching PO behavior.
   - Expanded the destination dropdown with ports.
   - Added a destination free-text override.
   - The SO print/email document now uses the custom destination text when provided.

3. Inventory and Shipments
   - Added the same common port IDs so PO/SO destinations are displayed consistently in expected lots and transport orders.
   - Shipment creation from PO/SO carries the custom destination text forward where available.

## Destination rule

- **EXP CIF / CFR / FOB sales**: destination = client destination port / terminal.
- **DAP / DDP sales**: destination = client receiving site / DC.
- **EXW sales**: destination = pickup warehouse/site.
- **Imports to our warehouse**: destination = our warehouse.
- **Imports direct to client**: destination = client site, or port if the commercial delivery point ends at port.

Long term, destinations should move into a central Location Master with searchable ports, warehouses, suppliers and clients.
