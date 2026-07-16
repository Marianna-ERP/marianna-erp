# v6.34.6 — Over-ship guard: the fulfilling movement decides (incoterm + port)

The keystone for multi-carrier / consolidation flows. The over-ship block now understands
WHICH shipment actually fulfils a PO/SO, so pre-carriage road legs don't block the onward
sea leg — while ordinary shipments still consume and close the order exactly as before.

## The rule (pure, tested engine — tradeFlow.shipmentFulfilsOrder)
A shipment consumes the PO/SO shipped budget when it is the **fulfilling movement**:
- **FOB / FCA / EXW sales** — obligation ends at the port / handover; the leg to the port
  IS fulfilment → it consumes.
- **CIF / CFR / CPT / CIP sales** — main carriage is on us, so an onward (sea) leg follows;
  the **pre-carriage road leg to a PORT does NOT consume** (the onward leg does), preventing
  the double-count in the 5-trucks→4-containers case.
- **DAP / DDP / direct road (no port hop)** — the movement is the fulfilment → consumes.
- Counts only from **Booked** onward (a Draft still being built never consumes) — so the same
  PO/SO can't be booked twice.

This closes the hole where "inbound never consumes" would have left a direct-road-export PO/SO
perpetually open: now a road-direct sale consumes and closes normally; only a road-to-PORT leg
under a freight-onward incoterm is exempt.

## Port identification — no new structure
Ports use the existing first-class **"Port" location type** (Koper, Gdańsk, Jeddah, Rotterdam…
already built in). The guard reads the shipment's destination location type — nothing added to
counterparties. To capture a specific transshipment-warehouse address, add it as a Port location
in Settings (not as a counterparty).

## Also
- **Sea no longer forces Multimodal.** A shipment's mode is a per-shipment choice; sea being
  part of a CIF trade no longer auto-sets Multimodal. The SO's read-only "⚓" sea mirror is
  removed (it triggered nothing).
- 1:1 multimodal net/gross: goods left as "All legs" already appear identically on the road and
  sea transport orders — no divergence unless you explicitly assign goods per leg (the split).

## Gate
- Suite 160 → **165** (direct-road consumes; FOB-to-port consumes; CIF road-to-port exempt +
  its sea leg consumes; Draft never; freight-onward set exact) · typecheck 0 · eslint unused 0 ·
  real CRA build PASSED.

## Still to come (next release — deliberately not stacked here)
- SO multi-shipment with per-line partial quantities (parity with PO).
- Full PO/SO create-dialog UI unification.
