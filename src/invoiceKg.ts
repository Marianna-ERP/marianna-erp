// invoiceKg.ts — v7.53.0: the kilos on an invoice, in a file that imports nothing (read by the overheads rule and the import).
/** v7.52.0 (PL-1 prerequisite): THE KILOS ON AN INVOICE — the sum of its lines counted in kilograms (kg, kilogram, t → ×1000). One
 *  function for every reader (the overheads per kilo invoiced, the data check). */
export function kgOnInvoice(inv: any): number {
  return (inv?.positions || []).reduce((s: number, p: any) => { const u = String(p?.unit || "").toLowerCase().trim(); const q = Number(p?.quantity) || 0;
    if (/^(kg|kilo|kilogram|kilogramy|kilogramów|kgs)\.?$/.test(u)) return s + q; if (/^(t|tona|tony|ton|tonne)\.?$/.test(u)) return s + q * 1000; return s; }, 0);
}
