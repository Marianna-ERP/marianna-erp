# V5.6 - Shipments module revision

This update revises the Shipments / Logistics module based on operational feedback.

## Changes

- Removed `Warehouse` from leg mode dropdowns. Handling / warehousing remains a cost type, not a transport mode.
- Header modes remain: Road, Sea, Rail, Air, Multimodal.
- Leg and transport-unit modes are now: Road, Sea, Rail, Air.
- Reworked leg route fields:
  - `From` and `To` are now open inputs with datalist suggestions from the location master.
  - Users can select an existing location or type any manual loading/unloading place.
  - Printed transport orders use each leg's own From/To as loading/unloading place.
- Added `+ Activate extra leg` to the shipment editor.
  - Most shipments can use one or two legs.
  - A third/fourth leg is added only when needed.
  - Extra legs can be removed when more than two are present.
- Improved transport order logic for shipments involving multiple providers.
  - The print modal now has a provider selector.
  - The email modal now has a provider selector.
  - The generated order is filtered to the selected carrier / forwarder.
  - The provider sees only the legs and agreed price relevant to their own order.
- Multi-truck / multi-container tracking remains through `Transport units` inside each leg.

## Operational example

For an import with 4 sea containers and 5 road trucks after arrival port:

- Leg 1: Sea, provider = forwarder/shipping line, 4 container units.
- Leg 2: Road, provider = road carrier, 5 truck units.

The forwarder receives a sea/forwarder order with container/BL information and sea/forwarder cost.
The road carrier receives a road transport order with only the port pickup, warehouse delivery, truck units and agreed road price.

## Files changed

- `src/Shipments.tsx`
- `standalone/Shipments.tsx`
