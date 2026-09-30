# Test fixtures — real files the suites read

These are the owner's own operational files, frozen at the moment they showed something the code
must keep handling. They are business data: this repository must stay **private**.

| File | What it is | Which tests |
|---|---|---|
| `marianna-erp_MERGED_2026-09-25.json` | The merged owner + colleague file (v6.99.55 export). The default data file for the screen suites, the ledger-drift check and the planning-board scenarios. | render-smoke, unsaved-guard, ledger-drift, round-trip 68 |
| `marianna-erp_v6.99.50_schema-v2_2026-09-23T14-11-42.json` | Before the clean-up: 40 orphan lots, 7 invoices pointing at documents that no longer exist. Proves the integrity check still finds them. | round-trip 65 |
| `marianna-erp_v6.99.52_schema-v2_2026-09-23T16-04-33.json` | 67 of last season's lots under this season's POs; two seasons present. Proves EXPECTED_LOT_MISMATCH and the season archive round trip. | round-trip 66, 67 |
| `marianna-erp_v6.99.66_schema-v2_2026-09-26T14-16-24.json` | Before the v6.99.67 heal: stored direction copies on 34 shipments. | round-trip 75 |
| `marianna-erp_v6.99.72_schema-v2_2026-09-28T13-44-40.json` | The owner's 28 Sept file with SHP-2026-0035 (two trucks from two producers → two containers, booking BK001): its containers printed the whole shipment each, its trucks load at each other's producer, its booking POD differs from the SO, and PO-2026-0041 carries 31 June. | round-trip 78–80, render-smoke |
| `marianna-erp_v6.99.79_schema-v2_2026-09-29T11-01-43.json` | The owner's 29 Sept file with her season workbook imported into the planning sheet (six week tabs, 37 rows). | sheet-typing |
| `marianna-erp_v6.99.82_schema-v2_2026-09-30T11-51-38.json` | The owner's 30 Sept file: a consignment DDP purchase (PO-2026-0043, Vega-Pro → AGRO-MAX), its expected lot, the supplier-delivered shipment SHP-2026-0036 and a QC report at the client. | round-trip 83 |
| `marianna-erp_v6.99.82_schema-v2_2026-09-30T13-13-23.json` | The owner's 30 Sept 13:13 file: PO-2026-0043's settlement record (rate 4.35, commission 6.5 %, provisional EUR258/2026 = 37 000 EUR) and SO-2026-0026 (PLN) selling from it. | round-trip 84, render-smoke |
| `CC529C_26PL445010003K5TB3_1.xml` | The agent's release for export (AES IE-529) for truck WRA5749J/WRA5925F, 5 May 2026. | round-trip 61 |
| `CC599C_26PL445010003K5TB3_1.xml` | The exit confirmation (IE-599) of the same declaration: left the EU 12 May 2026 at IT137103. | A-CU-3 |
| `CC599C_26PL445010003B8HB3_1.xml` | A second exit confirmation (truck WR367HW/WPYTP71, exit 18 May 2026 at IT137100). | A-CU-3 |
| `SAD_25520.xml` | The agent's own working copy of the same declaration (their software's format, no MRN). | A-CU-3 |
| `sample_season_workbook.xlsx` | A **sample** in her 26-column layout (five week tabs, 21 rows, plates taken from the merged file) standing in for her real season workbook, which the app no longer needs. | round-trip 68, 73; render-smoke |

Rules: a scenario that cannot run without its fixture prints `⤳ SKIPPED — fixture missing: …` and the rest of the
suite goes on. Paths come only from `tests/fixtures.cjs` — never from a chat's upload folder.
