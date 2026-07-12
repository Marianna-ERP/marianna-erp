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

  // Shipments touching this lot: header lotRefs, goods lotRef, or the lot's PO.
  const ship = shipments.filter(s =>
    refs(s.lotRefs).includes(lot.number) ||
    arr(s.goods).some((g: any) => g.lotRef === lot.number) ||
    (lot.poRef && (refs(s.poRefs).includes(lot.poRef) || arr(s.goods).some((g: any) => g.poRef === lot.poRef)))
  ).map(s => ({
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
      const hits = (it.sourceType === "STOCK" && it.sourceRef === lot.number) ||
        (it.sourceType === "PO" && lot.poRef && it.sourceRef === lot.poRef);
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
