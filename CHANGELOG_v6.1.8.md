# v6.1.8 — Test build: clean empty shell + data-safety controls

This build is prepared for your colleagues to test by entering REAL data.

1. **Completely empty start.** No demo contacts, purchase orders, sales orders,
   shipments, lots, or operational costs. Each tester begins with a clean system and
   populates their own data. (Locations and ports remain built in as reference data.)

2. **Data lives in the browser (no server yet).** It survives page refreshes and new
   version releases on the same browser/device, but is lost on a different browser/
   device, a private window, or if browsing data is cleared.

3. **Data-safety controls in Settings:**
   - Export all data — download a JSON snapshot (use for backups and bug reports).
   - Import — load a colleague's JSON (replaces current data).
   - Start fresh / clear all — wipe back to an empty system (guarded by confirmation).

4. **One-time backup reminder.** A dismissible banner at the top reminds testers to
   export their data and to attach the export to bug reports.

Note: a real shared backend/database is intentionally deferred until the data model
stabilises (after the Invoicing module), to avoid repeated migrations while features
are still being designed.
