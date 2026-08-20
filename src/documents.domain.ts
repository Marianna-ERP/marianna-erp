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
  const linkedSalesOrders = (orders || [])
    .filter((o: any) => (o.items || []).some((it: any) => it.sourceType === "PO" && it.sourceRef === po.number))
    .map((o: any) => o.number);
  return {
    linkedShipments: shipmentsForPO(po.number, shipments),
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
        (so.items || []).some((it: any) => it.sourceType === "PO" && it.sourceRef === l.poRef)).map((l: any) => l.number))
  ));
  return {
    linkedShipments: shipmentsForSO(so.number, shipments),
    linkedInvoices: invoicesForCounterpartyDoc(so.number, "SO", invoices),
    linkedLots,
  };
}

/**
 * BP-3: the PO's sales-link state, derived from the SOs that source from it.
 * Unsold / Linked / Partially sold / Fully sold — quantity-aware where possible.
 */
export function poSalesLink(po: any, orders: any[]) {
  const soLines: any[] = [];
  (orders || []).forEach(o => {
    if (o.status === "Cancelled") return;
    (o.items || []).forEach((it: any) => {
      if (it.sourceType === "PO" && it.sourceRef === po.number) soLines.push({ o, it });
    });
  });
  const linkedSOs = Array.from(new Set(soLines.map(x => x.o.number)));
  if (!linkedSOs.length) return { state: "Unsold", label: "Unsold", linkedSOs: [], soldKg: 0, orderedKg: 0, pct: 0 };

  const orderedKg = (po.items || []).reduce((s: number, l: any) => s + (parseFloat(l.qty) || 0), 0);
  const soldKg = soLines.reduce((s: number, x: any) => s + (parseFloat(x.it.qty) || 0), 0);
  const pct = orderedKg > 0 ? Math.round((soldKg / orderedKg) * 100) : 0;

  let state: string, label: string;
  if (orderedKg > 0 && soldKg >= orderedKg - 0.001) { state = "Fully"; label = "Fully sold"; }
  else if (linkedSOs.length > 1) { state = "Multiple"; label = `Sold to ${linkedSOs.length} orders (${pct}%)`; }
  else if (orderedKg > 0 && soldKg > 0 && pct < 100) { state = "Partial"; label = `Partially sold — ${linkedSOs[0]} (${pct}%)`; }
  else { state = "Linked"; label = `Linked to ${linkedSOs[0]}`; }
  return { state, label, linkedSOs, soldKg, orderedKg, pct };
}
