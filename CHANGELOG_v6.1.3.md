# v6.1.3 — EXW sale support, PO default filter, distinct leg colors

1. **Blank carrier option for EXW / client-arranged sales.** When creating a shipment,
   the carrier and forwarder pickers now default to BLANK (— select — / — none —)
   instead of pre-selecting the first carrier. So when you sell EXW (the client sends
   their own truck), just leave the carrier blank.
   - The shipment built from an SO no longer forces a default carrier (was id 17) or a
     default freight amount (was 1450 PLN). With no carrier chosen, the road-freight
     cost line is created with NO supplier and a ZERO amount — correct when the freight
     isn't on our behalf. The freight line stays locked (can't be deleted) but reads 0.

2. **Purchase Orders list defaults to "All" status** (was "Active"), so all POs show by
   default.

3. **Distinct colour per leg type in Shipments.** Road / Sea / Rail / Air / Multimodal
   now have clearly separated colours (Sea moved to a distinct teal so it no longer
   looks like Road's blue) and each carries an icon (🚚 🚢 🚆 ✈️ 🔀). In the Route/legs
   view each leg also gets a matching coloured left border and numbered dot, so
   different legs of one shipment are easy to tell apart at a glance.
