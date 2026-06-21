# v6.17.1 — Data integrity safety net (gate 1 of the structural hardening)

## New: continuous integrity check (read-only)
A pure checker now scans the whole dataset and a badge in the top bar shows
"Data OK" or "N data issues". Click it for a ranked list (errors → warnings →
info), each linking to the module to fix. It NEVER changes data — it only reports.

It catches the structural problems that per-form guards can't, because they arise
from imports, deletes, edits, or legacy data rather than a single submission:
- Orphaned references (lot → missing PO; SO line → missing lot/PO; shipment → missing PO/SO/lot)
- Oversold lots (committed kg > available kg) — defence in depth behind the SO confirm gate
- SOs marked Shipped+ with no traceable SHIP_OUT movement (COGS would read zero)
- SO-number substring collisions (note-based ship-out matching could confuse two SOs)
- Consignment settlement double-writes (duplicate CONSIGN / commission components)
- Cost allocations tagged to a warehouse invoice that no longer exists (stale)
- Counterparty snapshots whose id no longer resolves (name-only match is unreliable)
- Duplicate primary keys (two POs / lots / SOs / shipments sharing a number)

## Oversell gate
Confirmed the Sales Order module already ENFORCES this: a non-Draft SO cannot be
saved while any line exceeds available supply (the save button is disabled with an
explanatory tooltip). No change needed there; the integrity check adds a second
layer that also catches oversold states arriving via import or direct edits.

No existing behaviour changed. Two new files (integrityCheck.ts, IntegrityBadge.tsx)
and a small wiring change in App.tsx. Type-checks clean.
