# Test fixtures — anonymised copies of real files

These are the owner's operational files, frozen at the moment they showed something the code must keep handling —
**anonymised** (v7.21.2, AUD-50): every company and person name, tax number (NIP, VAT, EORI, TIN, REGON), street and
postcode, e-mail, phone, bank account, plate, container / seal / booking / BL / CMR / AWB / tracking number, ACID and
import-permit number and MRN is an invented one — the same real value got the same invented value in every file, so the
files still agree with each other. Kilos, prices, dates, our own document numbers (PO / SO / SHP / LOT …) and invoice
numbers are kept: the tests check the code against them. Our own company's identity is kept: it is in the app's code and on
every document we send. Values the app's own code also writes (a few counterparties, places and plates) are kept too, so
the files keep matching the code — they leave the code under A-RV-39. The table real → invented was never written down.

**Adding a real file:** anonymise it first, together with the suites that will name things from it —
`node tests/anonymise.cjs <the new file> --tests tests/*.cjs tests/fixtures/README.md` — then write its tests against the
invented names. Run it on the new file only: the files already here are anonymised.

| File | What it is | Which tests |
|---|---|---|
| `marianna-erp_MERGED_2026-09-25.json` | The merged owner + colleague file (v6.99.55 export). The default data file for the screen suites, the ledger-drift check and the planning-board scenarios. | render-smoke, unsaved-guard, ledger-drift, round-trip 68 |
| `marianna-erp_v6.99.50_schema-v2_2026-09-23T14-11-42.json` | Before the clean-up: 40 orphan lots, 7 invoices pointing at documents that no longer exist. Proves the integrity check still finds them. | round-trip 65 |
| `marianna-erp_v6.99.52_schema-v2_2026-09-23T16-04-33.json` | 67 of last season's lots under this season's POs; two seasons present. Proves EXPECTED_LOT_MISMATCH and the season archive round trip. | round-trip 66, 67 |
| `marianna-erp_v6.99.66_schema-v2_2026-09-26T14-16-24.json` | Before the v6.99.67 heal: stored direction copies on 34 shipments. | round-trip 75 |
| `marianna-erp_v6.99.72_schema-v2_2026-09-28T13-44-40.json` | The owner's 28 Sept file with SHP-2026-0035 (two trucks from two producers → two containers, booking LB928): its containers printed the whole shipment each, its trucks load at each other's producer, its booking POD differs from the SO, and PO-2026-0041 carries 31 June. | round-trip 78–80, render-smoke |
| `marianna-erp_v6.99.79_schema-v2_2026-09-29T11-01-43.json` | The owner's 29 Sept file with her season workbook imported into the planning sheet (six week tabs, 37 rows). | sheet-typing |
| `marianna-erp_v6.99.82_schema-v2_2026-09-30T11-51-38.json` | The owner's 30 Sept file: a consignment DDP purchase (PO-2026-0043, Legugeva → AGRO-MAX), its expected lot, the supplier-delivered shipment SHP-2026-0036 and a QC report at the client. | round-trip 83 |
| `marianna-erp_v6.99.82_schema-v2_2026-09-30T13-13-23.json` | The owner's 30 Sept 13:13 file: PO-2026-0043's settlement record (rate 4.35, commission 6.5 %, provisional EUR258/2026 = 37 000 EUR) and SO-2026-0026 (PLN) selling from it. | round-trip 84, render-smoke |
| `marianna-erp_v6.99.85_schema-v2_2026-10-01T12-50-07.json` | The owner's 1 Oct file: PO-2026-0044 (DDP, consignment) with its supplier truck SHP-2026-0037 carrying actual loading / unloading dates, and LOT-2026-0127/0128 received on 1 Oct though they arrived mid-June. | round-trip 86, render-smoke |
| `marianna-erp_v6.99.86_schema-v2_2026-10-01T14-46-09.json` | The owner's 1 Oct 14:46 file: a client QC report on LOT-2026-0126 (14 270 kg delivered vs 14 300 loaded) and a warehouse QC on LOT-2026-0127 (11 000 kg on the report vs a 10 985 kg receipt). | round-trip 87, render-smoke |
| `marianna-erp_v6.99.87_schema-v2_2026-10-01T16-29-32.json` | The owner's 1 Oct 16:29 file: SHP-2026-0039, a groupage of PO-2026-0044's stock (LOT-0127/0128 at AGRO-HURT) for SO-0027/0028/0029; SHP-0030/0031 with carriers on their legs, SHP-0034/0035 with carriers on their trucks. | round-trip 88–96, render-smoke |
| `marianna-erp_v6.99.98_schema-v2_2026-10-02T12-20-49.json` | The owner's 2 Oct file: PO-2026-0044 received at AGRO-HURT and sold to SO-0027/0028/0029 by the groupage SHP-2026-0039 (delivered). | round-trip 98–104, render-smoke |
| `CC529C_26PL445010188G5KO3_1.xml` | The agent's release for export (AES IE-529) for truck JSI4708L/SMM8968H, 5 May 2026. | round-trip 61 |
| `CC599C_26PL445010188G5KO3_1.xml` | The exit confirmation (IE-599) of the same declaration: left the EU 12 May 2026 at IT137103. | A-CU-3 |
| `CC599C_26PL445010285B4WB2_1.xml` | A second exit confirmation (truck BM819DS/YUEVV45, exit 18 May 2026 at IT137100). | A-CU-3 |
| `SAD_25520.xml` | The agent's own working copy of the same declaration (their software's format, no MRN). | A-CU-3 |
| `sample_season_workbook.xlsx` | A **sample** in her 26-column layout (five week tabs, 21 rows, plates taken from the merged file) standing in for her real season workbook, which the app no longer needs. | round-trip 68, 73; render-smoke |

Rules: a scenario that cannot run without its fixture prints `⤳ SKIPPED — fixture missing: …` and the rest of the
suite goes on. Paths come only from `tests/fixtures.cjs` — never from a chat's upload folder.
