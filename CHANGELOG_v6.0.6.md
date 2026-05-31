# v6.0.6 — Cost-line delete, partial-load cargo, wider container fields

1. **Cost & Billing — delete lines, protect freight.** You can now delete a cost line
   you added by mistake (each non-freight line has a ✕ delete button with a confirm).
   The core freight lines (road/sea/air/rail freight) are LOCKED (🔒) and can't be
   deleted, so a shipment never loses its freight cost. New manual lines default to
   type "Other" (freely deletable).

2. **Load only some PO products on a shipment.** The Create-Shipment modal now has a
   "Products to load on this shipment" picker. If a PO has 3 products and you load only
   2, only those 2 appear in the shipment goods and on the transport order's Cargo /
   Ladunek table. (None ticked = all loaded, as before.)

3. **Container number field widened.** On a sea leg, the Container field is now wide
   enough to show a full number like MSCU1234567. In the per-unit (multi-truck /
   multi-container) editor, Container and Seal are now SEPARATE, fully-readable fields
   instead of one cramped combined field.

Plus: a TEST_SCENARIOS.md document is included with a full end-to-end test script.
