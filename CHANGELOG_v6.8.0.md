# v6.8.0 — Fakturownia live bridge (read-only)

Connects the ERP to your Fakturownia account to pull invoices directly — no
duplication of your official register, which stays in Fakturownia/KSeF.

## Read-only by design
- The ERP only READS invoices. No create/update/delete in this version.
- Uses Fakturownia's documented browser-callable API (api_token auth, JSON).

## Settings → Fakturownia connection
- Enter account name + API token; "Test connection" verifies it live.
- The token is stored ONLY in this browser and is deliberately EXCLUDED from
  the Settings JSON export, so it never travels in a shared data file.
- Clear security guidance: get the token from Fakturownia → Settings → API,
  treat it like a password, rotate if it was ever shared.

## Finance → Operational Costs → live cost sync
- When connected, a "Fetch cost invoices from Fakturownia" button (this month /
  last month / this year) pulls the cost register (income=0 — invoices issued
  TO you via KSeF) straight into the same review screen used by the file import.
- Same safeguards: duplicate invoices (by number) are flagged and pre-unticked;
  category guessed from text; warehouse suppliers routed to the Warehouse
  charges reconciliation; allocation method editable per row.
- The XLS/CSV file import remains as a fallback.

## CORS contingency
- Some accounts block direct browser calls (CORS). If that happens, the UI says
  so clearly and the file import still works; live sync then moves to the
  Phase-2 backend where the token lives server-side.

## Notes
- A complete read-only API client (`fakturownia.ts`) — connection storage,
  paged invoice fetch, tolerant field mapping, SO-matching with confidence
  levels, and a "prepare invoice payload" builder for the future create flow —
  is included and now wired into Settings and Finance.
- Verified with the full TypeScript build type-check; 64-scenario engine suite
  still green.

**Next (v6.9):** sales-side matching (income invoices ↔ SOs, paid/unpaid →
receivables view) and, when you're ready, "Create invoice in Fakturownia" from
an SO using the payload builder already in place.
