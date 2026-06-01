# v6.1.1 — Packaging & Pallets on PO/SO prints; removed dead standalone folder

1. **Packaging + Pallets now appear on the PO print** (sent to supplier) and the
   **SO print** (sent to client). Both documents' goods tables gained two columns —
   "Packaging / Opakowanie" and "Pallets / Palety" — bilingual like the rest of the
   table. Empty values show "—".

2. **Removed the dead `standalone/Shipments.tsx` folder.** It was an outdated duplicate
   (from before recent fixes), not imported anywhere and not part of the build — the
   app builds from `src/`. Removing it prevents confusion about which file is live.
   (The "standalone mode" comments inside the real src/ files are unrelated — they
   describe how a module behaves when run without props, and are untouched.)
