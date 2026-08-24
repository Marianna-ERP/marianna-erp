// ─────────────────────────────────────────────────────────────────────────────
// trace.domain.ts — one-click lot traceability (Safeguards batch 7a)
//
// The recall question every produce ERP must answer in one click:
// "this lot is contaminated — where did it come from, and everywhere it went."
// Pure composition of the links that already exist (Batch 4a computed links):
// lot → PO/supplier → shipments → sales orders/clients → invoices.
// ─────────────────────────────────────────────────────────────────────────────

function arr(v: any): any[] { return Array.isArray(v) ? v : []; }
function refs(v: any): string[] { return arr(v).filter(Boolean).map(String); }

export interface TraceTree {
  lot: { number: string; product: string; variety?: string; receivedKg?: number; physicalKg?: number };
  origin: { poNumber: string | null; supplier: string | null; supplierAddress?: string; origin?: string };
  shipments: Array<{ number: string; status?: string; direction?: string; carrier?: string; from?: string; to?: string; dates?: string }>;
  sales: Array<{ soNumber: string; client: string; qtyKg: number; status?: string; destination?: string }>;
  invoices: Array<{ number: string; kind?: string; counterparty?: string; gross?: string }>;
  generatedAt: string;
}

export function buildTraceTree(lot: any, inp: { pos?: any[]; orders?: any[]; shipments?: any[]; invoices?: any[] }, todayISO: string): TraceTree {
  const pos = arr(inp.pos), orders = arr(inp.orders), shipments = arr(inp.shipments), invoices = arr(inp.invoices);
  const po = pos.find(p => p.number === lot.poRef) || null;

  // v6.69.0: shipments that CARRIED this lot — nothing wider.
  //
  // This used to match any shipment sharing the lot's PO, which is the same
  // over-broad predicate removed from Inventory in v6.59.0 and from the
  // shipment header in v6.58.0. Here it mattered more than on a screen: a
  // recall report that names a shipment which never carried the lot sends you
  // to clients who never received the goods, and hands a counterparty a
  // document that falls apart the moment they check one line.
  //
  // The rule is the one used everywhere else — the GOODS decide. Header lotRefs
  // are trusted only for a shipment that has no goods rows yet (a booking),
  // because those refs are seeded from the source document at creation.
  // A RECALL ERRS TOWARD INCLUDING. Excluding a shipment that did carry the lot
  // means a client eats the goods; including one that didn't costs a phone call.
  // So this narrows only where there is POSITIVE EVIDENCE of a different lot —
  // never where the data simply cannot tell.
  const carriesLot = (s: any) => {
    const goods = arr(s.goods);
    if (goods.some((g: any) => String(g.lotRef || "") === String(lot.number))) return true;
    // Goods rows naming OTHER lots are proof this shipment carried those, not
    // this one — the case that put SHP-2026-0002 in LOT-2026-0001's report.
    if (goods.some((g: any) => g.lotRef)) return false;
    if (refs(s.lotRefs).includes(String(lot.number))) return true;
    // No lot evidence either way (a booking, or a shipment recorded before goods
    // rows existed): fall back to the PO link rather than dropping it silently.
    return !!(lot.poRef && (refs(s.poRefs).includes(lot.poRef) || goods.some((g: any) => g.poRef === lot.poRef)));
  };
  const ship = shipments.filter(carriesLot).map(s => ({
    number: s.number, status: s.status, direction: s.tradeDirection || undefined,
    carrier: s.carrierName || undefined,
    from: s.originText || s.legs?.[0]?.fromCustom || undefined,
    to: s.destinationText || (s.legs || []).slice(-1)[0]?.toCustom || undefined,
    dates: [s.expectedLoadingDate, s.expectedDeliveryDate].filter(Boolean).join(" → ") || undefined,
  }));

  // Sales orders drawing on this lot: STOCK lines on the lot, or PO lines on its PO.
  const sales: TraceTree["sales"] = [];
  orders.forEach(o => {
    if (o.status === "Cancelled") return;
    arr(o.items).forEach((it: any) => {
      // v6.69.0: a PO-sourced line sells THIS lot only when it draws on the same
      // PO LINE. Matching the whole PO listed every lot of that order against
      // every sale from it — LOT-2026-0001 (19 422 kg) reported 38 844 kg sold
      // across three lines, one of them to a client who bought a different lot.
      // poLineId is authoritative when both sides carry it; without it, fall
      // back to the PO plus a product match rather than the PO alone.
      // Same principle: narrow only on positive evidence of a DIFFERENT line.
      // poLineId is authoritative when both sides carry it. Otherwise, a stated
      // product/variety that differs proves it is another line; anything the
      // data cannot distinguish stays IN the report.
      const lineDiffers = (it.sourceLineId != null && lot.poLineId != null)
        ? String(it.sourceLineId) !== String(lot.poLineId)
        : (!!it.product && !!lot.product &&
           (String(it.product).trim().toLowerCase() !== String(lot.product).trim().toLowerCase() ||
            (!!it.variety && !!lot.variety && String(it.variety).trim().toLowerCase() !== String(lot.variety).trim().toLowerCase())));
      const sameLine = !lineDiffers;
      const hits = (it.sourceType === "STOCK" && String(it.sourceRef) === String(lot.number)) ||
        (it.sourceType === "PO" && lot.poRef && String(it.sourceRef) === String(lot.poRef) && sameLine);
      if (hits) sales.push({
        soNumber: o.number, client: o.client?.name || "(client)",
        qtyKg: parseFloat(it.qty) || 0, status: o.status,
        destination: o.destinationText || o.client?.address || undefined,
      });
    });
  });

  // Invoices linked to the lot, its PO, or the SOs above.
  const soNums = new Set(sales.map(s => s.soNumber));
  const inv = invoices.filter(v => {
    const links = arr(v.links);
    if (links.some((lk: any) => (lk.type === "LOT" && lk.number === lot.number) || (lk.type === "PO" && lk.number === lot.poRef))) return true;
    if (v.poRef && v.poRef === lot.poRef) return true;
    if (v.soRef && soNums.has(v.soRef)) return true;
    return false;
  }).map(v => ({ number: v.number || "(draft)", kind: v.kind, counterparty: v.counterparty?.name, gross: v.grossAmount != null ? `${v.grossAmount} ${v.currency || ""}`.trim() : undefined }));

  return {
    lot: { number: lot.number, product: lot.product || "", variety: lot.variety || undefined, receivedKg: lot.receivedKg, physicalKg: lot.physicalKg },
    origin: { poNumber: lot.poRef || null, supplier: po?.supplier?.name || null, supplierAddress: po?.supplier?.address || undefined, origin: (po?.items || [])[0]?.origin || undefined },
    shipments: ship, sales, invoices: inv,
    generatedAt: todayISO,
  };
}
