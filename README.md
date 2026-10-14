# MARIANNA ERP

The trading system of Marianna, a fresh-produce trading business in Poland: purchases from producers, stock in lots, sales,
shipments by road and sea, invoices through Fakturownia, claims and finance. React + TypeScript, deployed on Vercel; the data
is shared by every signed-in user through Supabase.

## Modules

- **Dashboard** — what needs attention today, the terms to review, the data checks.
- **POs** — purchases from producers and suppliers; their incoterm decides the named place and who moves the goods.
- **Inventory** — the lots: expected, received, moved, sold, written off; their costs and quality reports.
- **SOs** — sales; every line sells a lot; availability, margin, invoicing.
- **Shipments** — legs, trucks and containers, transport orders, loading protocols, customs, documents; the planning sheet.
- **Invoices** — sales and cost invoices, payments, credit and debit notes; Fakturownia sends and imports.
- **Claims** — quality and transport claims, routed by the incoterms.
- **Finance** — operational costs, warehouse charges, settlements, bank, results.
- **Counterparties** — companies, their people and places; ports, warehouses, countries.
- **Settings** — company, users and rights, product catalogue, packaging, Fakturownia, backups and restore.

## Data

Every list (companies, POs, lots, sales, shipments, invoices…) is one shared store. Changes from different people merge record
by record; ids cannot collide between browsers. A copy without the two Supabase settings shows "This copy isn't connected".
The stores and the shape of their records: `src/types.ts` (`StoreRecords`). One incoterm table answers every incoterm question:
`src/incoterms.domain.ts`.

## Run and check

```
npm ci
npm start                      # needs REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY
CI=true npm run build          # the strict build Vercel runs
```

The checks live in `tests/` and run on Poland's clock:

```
export TZ=Europe/Warsaw
npx tsc -p tests/tsconfig.json
node tests/run-engines.cjs        # engines
node tests/audit-roundtrip.cjs    # round-trip checks against the data files
node tests/phase3-matrix.cjs      # status matrix
node tests/render-smoke.cjs       # every screen renders
node tests/connections.cjs        # screens wired to their data
node tests/source-gates.cjs       # code rules (one incoterm table, no browser pop-ups, no unused or unreachable code…)
```

plus `ledger-drift`, `unsaved-guard`, `backup-folder`, `sheet-typing`, `shared-merge`, `server-fakturownia` and `npm-audit`.
The data files in `tests/fixtures/` are anonymised (`tests/anonymise.cjs`, see `tests/fixtures/README.md`).

## Deploy

See `HOW_TO_DEPLOY.md`: TEST first, then main; the Vercel settings, including the two hidden Fakturownia settings read by
the server part `api/fakturownia.js`.

## Folders

- `src/` — the app: one file per screen, `*.domain.ts` for the rules behind them.
- `api/` — the server part (Fakturownia).
- `vendor/` — the SheetJS package the app installs from.
- `tests/` — the checks and their anonymised data files.
- `USER_MANUAL.md` — how to use the app.

## How work is done

Every request is registered in the Action Tracker first; nothing is built before its batch is approved; one topic per
version; every version passes all the checks above, and the printed documents are compared before release.
