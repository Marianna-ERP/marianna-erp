# v6.1.5 — FX field fix, Incoterm-standard journey wording + black/grey ownership, movement notice

1. **SO & PO "FX rate to PLN" field — un-deletable zero fixed.** The field coerced
   empty input to 0 on every keystroke, leaving a "0" you couldn't clear. It now holds
   the raw value while you type (empty stays empty); calculations still safely treat a
   blank rate as 1. Fixed in both Sales Orders and Purchase Orders.

2. **Journey wording standardised to Incoterm terms.** Stage labels are now derived
   from one labelling function (single source of truth) using the flow's Incoterm
   family — e.g. "EXW — at supplier (ex works)", "FOB — loaded on vessel (port of
   loading)", "CIF — arrived at destination port", "Export/Import customs cleared",
   "Received into our warehouse", "Delivered to client".

3. **Black/grey ownership emphasis on the journey.** Stages where the goods are OURS
   (our risk) now render in solid black bold; the supplier's and client's portions
   render in grey. Combined with the existing green "OURS" badge and the done/active/
   pending status dots.

4. **Record-movement notice moved above the movement type.** The advisory note (use
   Shipments when a truck/cost is involved) now appears at the top of the Record
   Movement dialog, before the Movement type field.
