// ─────────────────────────────────────────────────────────────────────────────
// documents.domain.ts — pure computed document links (Consolidation Batch 4a)
//
// BP-3 / BP-49: a PO/SO must not rely on stored linkedShipments/linkedLots/
// linkedInvoices arrays (they drift — the same class as the counterparty
// linkedDocs issue). Linked records are DERIVED from the other documents that
// reference this one. Pure + parameterised; no React, no module state.
// ─────────────────────────────────────────────────────────────────────────────

function refsOf(v: any): string[] {
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  return v ? [String(v)] : [];
}

/** Shipments that reference a PO (header poRefs or any goods-line poRef). */
function shipmentsForPO(poNumber: string, shipments: any[]): string[] {
  const out = new Set<string>();
  (shipments || []).forEach(s => {
    const hit = refsOf(s.poRefs).includes(poNumber) ||
      (s.goods || []).some((g: any) => g.poRef === poNumber);
    if (hit) out.add(s.number);
  });
  return Array.from(out);
}
function shipmentsForSO(soNumber: string, shipments: any[]): string[] {
  const out = new Set<string>();
  (shipments || []).forEach(s => {
    const hit = refsOf(s.soRefs).includes(soNumber) ||
      (s.goods || []).some((g: any) => g.soRef === soNumber);
    if (hit) out.add(s.number);
  });
  return Array.from(out);
}
function lotsForPO(poNumber: string, lots: any[]): string[] {
  return (lots || []).filter(l => l.poRef === poNumber).map(l => l.number);
}
function invoicesForCounterpartyDoc(docNumber: string, kind: "PO" | "SO", invoices: any[]): string[] {
  const out = new Set<string>();
  (invoices || []).forEach(inv => {
    // v6.63.0 (BUG #1 fix): canonical invoices carry links as {type, number}
    // OBJECTS — mapping them with String() produced "[object Object]" and no
    // register invoice ever matched. Extract .number for objects; keep the
    // legacy string fields working exactly as before.
    const linkNumbers = (Array.isArray(inv.links) ? inv.links : [])
      .map((l: any) => (l && typeof l === "object") ? String(l.number ?? "") : String(l ?? ""))
      .filter(Boolean);
    const links = [...refsOf(inv.poRef), ...refsOf(inv.soRef), ...linkNumbers,
      ...refsOf(inv.sourceRef), ...(inv.positions || []).flatMap((p: any) => [...refsOf(p.poRef), ...refsOf(p.soRef)])];
    if (links.includes(docNumber)) out.add(inv.number);
  });
  return Array.from(out);
}

/** Computed linked records for a PO (BP-49). */
export function computedPOLinks(po: any, { shipments = [], lots = [], invoices = [], orders = [] }: any) {
  // SOs that source from this PO (any line sourceType PO + sourceRef == po.number)
  // v7.1.4 (A-PV-5, owner 6 Oct): a sale names its LOT (A-ONE-1) — the PO's sales are the sales of its lots; the old PO-sourced path is kept for history
  const lotNos = new Set((lots || []).filter((l: any) => l && l.poRef === po.number).map((l: any) => String(l.number)));
  const linkedSalesOrders = (orders || [])
    .filter((o: any) => o && o.status !== "Cancelled" && (o.items || []).some((it: any) => (it.sourceType === "STOCK" && lotNos.has(String(it.sourceRef)))))
    .map((o: any) => o.number);
  const viaLots = (shipments || []).filter((s: any) => s && s.status !== "Cancelled" && (s.goods || []).some((g: any) => lotNos.has(String(g.lotRef)))).map((s: any) => s.number);
  return {
    linkedShipments: Array.from(new Set([...shipmentsForPO(po.number, shipments), ...viaLots])),
    linkedLots: lotsForPO(po.number, lots),
    linkedInvoices: invoicesForCounterpartyDoc(po.number, "PO", invoices),
    linkedSalesOrders,
  };
}

/** Computed linked records for an SO (BP-49). */
export function computedSOLinks(so: any, { shipments = [], invoices = [], lots = [] }: any) {
  const linkedLots = Array.from(new Set(
    (so.items || [])
      .map((it: any) => it.sourceType === "STOCK" ? it.sourceRef : null)
      .filter(Boolean)
      .concat((lots || []).filter((l: any) =>
        false).map((l: any) => l.number))
  ));
  return {
    linkedShipments: shipmentsForSO(so.number, shipments),
    linkedInvoices: invoicesForCounterpartyDoc(so.number, "SO", invoices),
    linkedLots,
  };
}
