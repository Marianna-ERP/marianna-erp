# Shipments / Logistics module

This build adds a new `src/Shipments.tsx` module and a standalone copy in `standalone/Shipments.tsx`.

## What the module covers

- Road, sea and multimodal shipments.
- Carrier / forwarder / broker selection from Contacts when running inside the shell.
- Truck plate, trailer plate, driver name and driver phone registration.
- Container, seal, booking, vessel, voyage and BL registration for sea / multimodal flows.
- Linked PO, SO and Inventory lot references.
- Goods lines with product, packaging, kg, gross kg and pallets.
- Cost lines for road freight, sea freight, pre-carriage, on-carriage, customs, port handling, warehouse, insurance, demurrage and other charges.
- Transport order confirmation printout based on the provided road transport order layout.
- Billing queue status: Not ready -> Ready for supplier invoice -> Supplier invoice received -> Cost allocated -> Closed.
- Inventory cost allocation: logistics costs can be pushed into the linked lot `costs` array.
- Inventory movement simulation: delivered SO shipments can create `SHIP_OUT` movements on linked lots.

## Seed scenarios

1. `SHP-2025-0107` - road transport order based on the provided facsimile: Biala Rawska -> Venice Cold Stores, apples, 19,422 kg net, 22,500 kg gross, 21 pallets, +2/+4 C, freight 1,700 EUR.
2. `SHP-2026-0045` - multimodal Morocco import with pre-carriage, sea container, BL, customs and port-to-warehouse on-carriage.
3. `SHP-2026-0060` - road SO delivery scenario linked to `SO-2026-0102`, `PO-2026-0121` and `LOT-2026-0100`.

## How to simulate

1. Open the app and go to the new `Shipments` tab.
2. Select `SHP-2025-0107` and click `Transport order` to preview and print the carrier confirmation.
3. Select `SHP-2026-0045` to inspect the multimodal container scenario with container / BL data.
4. Select `SHP-2026-0060`, edit truck / driver fields, then mark it `Delivered`.
5. Click `Send to billing queue` and then `Allocate costs to lots`.
6. Open Inventory and check the linked lot to see cost / movement effects where matching lot references exist.

## Notes

This is still frontend-only. Billing is represented as a queue/status on the shipment. When an Invoices / Accounts Payable module is added, logistics cost lines can be exported into supplier invoice drafts directly.
