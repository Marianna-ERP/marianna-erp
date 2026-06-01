# v6.0.10 — PO list overlap, shipment goods edit, price double-count, more seed data

1. **PO list — flow column overlap on EXP·CIF.** The list view's flow column was too
   narrow for long labels, so the badge bled into the value column. Widened the flow
   column and let the flow badge wrap within its column so it can never overlap again.
   (The detail/edit headers were fixed earlier; this was the LIST row.)

2. **Pallets added to an SO after the shipment was created.** The shipment goods are a
   snapshot taken at creation, so a later SO edit didn't reach them. Added an editable
   "Goods on this shipment" section in Edit shipment where you can adjust qty and
   pallets directly — so the transport order then shows the corrected pallet figure.

3. **Per-unit price + cost line double-counted.** If you set "price for this unit" AND a
   Cost & Billing line, the transport order added both. They represent the same money
   at different granularity, so the agreed price now picks ONE source by priority
   (per-unit prices → cost lines → leg costs) and never sums them.

4. **More baseline test data:**
   - Ports added: Ravenna, Rijeka, Bremerhaven, Gdynia, Damietta (Trieste, Venice,
     Genova, Koper, Hamburg, Gdańsk, Port Said, Alexandria already existed).
   - Clients (Egypt): Cairo Fresh Trading, Delta Produce Co.
   - Suppliers (Egypt): Alex Agro Export, Nile Valley Farms.
   - Suppliers (Poland): Sadowniczy Eksport Sp. z o.o., Warzywa Polskie S.A.
