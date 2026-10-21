import { parseNum } from "./numbers";   // v7.22.2 (FZ-22)
// ─────────────────────────────────────────────────────────────────────────────
// legacy.ts — v6.99.67 (A-AUD-1, owner) · the readers of RETIRED mirror fields, gathered in one place
// Each accessor reads the SOURCE first and the retired mirror only as a fallback for data written before the mirror was
// retired. When the DDL drops a mirror column (freeze item F-1), the fallback is deleted HERE and nowhere else.
// Mirrors and their sources:  paymentTermsDays → terms.paymentDays (v6.99.23/45)   ·   people[] → contacts[] (v6.99.45)
//                             grade → quality (v6.99.27)   ·   unit.qtyKg → unit.load[] (v6.99.8)   ·   address text → addr (v6.99.40)
//                             PO items[].currency → the PO header currency (v7.18.8, BP-51) — no reader at all; the DDL drops it
// ─────────────────────────────────────────────────────────────────────────────
const num = (v: any): number => parseNum(v);   // v7.22.2 (FZ-22): one reader for every number — spaces and a decimal comma read the same everywhere

/** Payment days of a counterparty: the terms first, the retired flat field only for old records. */
export function paymentDaysOf(cp: any): number {
  const t = cp?.terms || {};
  return num(t.paymentDays) > 0 ? num(t.paymentDays) : 0;   // v7.28.1 (Batch L): the flat column is gone — the terms own it
}
