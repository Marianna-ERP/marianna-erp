// ── PURCHASE ORDER GUARDS (v6.72.0) ─────────────────────────────────────────
// The rules that decide whether a purchase order may be confirmed, and what is
// merely incomplete. Extracted from the screen so they are pure and testable —
// the screen imports them and renders; it does not decide.
//
// Owner ruling, Aug 2026: THREE HARD GATES, everything else reports.
//   Gates    supplier · purchase incoterm · named place   (plus the per-line
//            product / quantity / price rules that guard lot creation)
//   Warnings loading date · variety · CN-HS · packaging · calibre
//
// The split is not about importance, it is about consequence. A PO with no
// supplier produces stock whose owner cannot be resolved. A PO with no CN code
// produces a customs problem you can still fix. One is broken; the other is
// merely unfinished, and an order the supplier is waiting for should not stop
// for something you can complete before the truck loads.

export function poTermsMissing(o: any): string | null {
  // v6.72.0 (owner ruling): the SUPPLIER is a hard gate. Confirming a PO creates
  // its expected lots, and those lots carry poRef back to this order — so a PO
  // confirmed with nobody on it produces stock whose owner cannot be resolved,
  // and the producer claim chain reads the supplier from exactly here. It sits
  // FIRST because it is the most fundamental of the three.
  if (!(o?.supplier?.name || "").trim() && o?.supplierId == null) return "the supplier";
  if (!o?.buyIncoterm) return "the purchase incoterm";
  if (!(o?.destinationLocationId || (o?.destinationText || "").trim())) return `the named place for ${o.buyIncoterm}`;
  return null;
}

/** v6.72.0 — things that WEAKEN a purchase order but must not stop it.
 *  Owner ruling: report, do not block. You may genuinely confirm before the
 *  producer has told you the variety, and a PO waiting on a CN code is a PO the
 *  supplier has not received. Each line says what it costs later, not just that
 *  a field is empty — a warning that only names a field gets ignored. */
export function poWarnings(o: any): string[] {
  const out: string[] = [];
  if (!(o?.loadingDate || "").trim()) {
    out.push("No loading date — the expected lot gets no timing, and the shipment has nothing to default its pickup to.");
  }
  const items = (o?.items || []).filter((it: any) => (it?.product || "").trim());
  const noVariety = items.filter((it: any) => !(it?.variety || "").trim()).length;
  if (noVariety) {
    out.push(`${noVariety} line(s) with no variety — variety locks downstream and prints on the loading protocol the producer signs.`);
  }
  const noCn = items.filter((it: any) => !(it?.cnCode || "").trim()).length;
  if (noCn) {
    out.push(`${noCn} line(s) with no CN/HS code — customs needs it, and it is far harder to add once the goods have moved.`);
  }
  const noPack = items.filter((it: any) => !(it?.packaging || "").trim() && it?.packagingId == null).length;
  if (noPack) {
    out.push(`${noPack} line(s) with no packaging — without a box weight the loading protocol cannot build its pallet table at all, and you find out at the dock.`);
  }
  const noSize = items.filter((it: any) => !(it?.size || "").trim()).length;
  if (noSize) {
    out.push(`${noSize} line(s) with no calibre — it prints on the protocol and follows the goods to the client.`);
  }
  return out;
}
