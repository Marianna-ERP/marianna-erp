// ─────────────────────────────────────────────────────────────────────────────
// referenceGuards.ts — v6.63.0 (Batch A: D-01 / D-02 / D-04)
//
// One pure home for the question "is this record still referenced anywhere?",
// asked before any hard delete. Two guards:
//
//   referencesToContact(id, stores)   — every place a counterparty id appears
//   referencesToLocation(id, stores)  — every place a location id appears
//
// Design rules (matching the lot-delete guard that already existed):
//   • Cancelled documents STILL block: nothing is deleted under the keep-
//     everything ruling, and a cancelled PO's supplier snapshot must stay
//     resolvable for the record.
//   • The guard REPORTS grouped, human-readable blockers; the caller decides
//     the dialog. Pure: no React, no storage, no alerts.
//   • In Supabase these become ON DELETE RESTRICT foreign keys; this module is
//     the single list of which columns those FKs live on.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReferenceReport {
  total: number;
  /** grouped, ready-to-print lines, e.g. "Purchase Order(s): PO-2026-0001, PO-2026-0002" */
  blockers: string[];
}

const S = (v: any) => String(v ?? "");
const same = (a: any, b: any) => a !== null && a !== undefined && a !== "" && S(a) === S(b);

function group(map: Record<string, Set<string>>): ReferenceReport {
  const blockers: string[] = [];
  let total = 0;
  Object.keys(map).forEach(k => {
    const refs = Array.from(map[k]);
    if (!refs.length) return;
    total += refs.length;
    blockers.push(`${k}: ${refs.slice(0, 8).join(", ")}${refs.length > 8 ? ` (+${refs.length - 8} more)` : ""}`);
  });
  return { total, blockers };
}

export interface ContactRefStores {
  pos?: any[]; orders?: any[]; shipments?: any[]; invoices?: any[];
  claims?: any[]; warehouseInvoices?: any[]; operationalCosts?: any[];
}

/** Every reference to a counterparty id, across all stores that can hold one.
 *  Covers the leg-level and cost-line ids the integrity checker never audited. */
export function referencesToContact(contactId: any, stores: ContactRefStores): ReferenceReport {
  const hits: Record<string, Set<string>> = {
    "Purchase Order(s)": new Set(), "Sales Order(s)": new Set(), "Shipment(s)": new Set(),
    "Invoice(s)": new Set(), "Claim(s)": new Set(), "Warehouse invoice(s)": new Set(),
  };
  (stores.pos || []).forEach(po => { if (same(po?.supplier?.id, contactId)) hits["Purchase Order(s)"].add(S(po.number || po.id)); });
  (stores.orders || []).forEach(so => { if (same(so?.client?.id, contactId)) hits["Sales Order(s)"].add(S(so.number || so.id)); });
  (stores.shipments || []).forEach(sh => {
    const n = S(sh.number || sh.id);
    if (same(sh?.carrierId, contactId) || same(sh?.forwarderId, contactId) || same(sh?.brokerId, contactId)) hits["Shipment(s)"].add(n);
    if (same(sh?.customs?.brokerId, contactId)) hits["Shipment(s)"].add(n);
    (sh?.legs || []).forEach((l: any) => { if (same(l?.carrierId, contactId) || same(l?.forwarderId, contactId)) hits["Shipment(s)"].add(n); });
    (sh?.costs || []).forEach((c: any) => { if (same(c?.supplierId, contactId)) hits["Shipment(s)"].add(n); });
  });
  (stores.invoices || []).forEach(inv => { if (same(inv?.counterparty?.id, contactId)) hits["Invoice(s)"].add(S(inv.number || inv.id)); });
  (stores.claims || []).forEach(cl => { if (same(cl?.respondent?.contactId, contactId)) hits["Claim(s)"].add(S(cl.number || cl.id)); });
  (stores.warehouseInvoices || []).forEach(w => { if (same(w?.warehouseId, contactId)) hits["Warehouse invoice(s)"].add(S(w.invoiceNo || w.id)); });
  return group(hits);
}

export interface LocationRefStores {
  lots?: any[]; shipments?: any[]; pos?: any[]; orders?: any[]; contacts?: any[];
}

/** Every reference to a location id — including movement history, which is the
 *  reference that made a deleted location blank out a lot (M8/D-04). */
export function referencesToLocation(locationId: any, stores: LocationRefStores): ReferenceReport {
  const hits: Record<string, Set<string>> = {
    "Lot(s)": new Set(), "Shipment(s)": new Set(), "Purchase Order(s)": new Set(),
    "Sales Order(s)": new Set(), "Warehouse tariff(s)": new Set(),
  };
  (stores.lots || []).forEach(lot => {
    const n = S(lot.number || lot.id);
    if (same(lot?.locationId, locationId) || same(lot?.baseLocationId, locationId)) hits["Lot(s)"].add(n);
    (lot?.movements || []).forEach((m: any) => { if (same(m?.fromId, locationId) || same(m?.toId, locationId)) hits["Lot(s)"].add(n); });
  });
  (stores.shipments || []).forEach(sh => {
    const n = S(sh.number || sh.id);
    if (same(sh?.originLocationId, locationId) || same(sh?.destinationLocationId, locationId)) hits["Shipment(s)"].add(n);
    (sh?.legs || []).forEach((l: any) => {
      if (same(l?.fromLocationId, locationId) || same(l?.toLocationId, locationId)) hits["Shipment(s)"].add(n);
      (l?.stops || []).forEach((st: any) => { if (same(st?.locationId, locationId)) hits["Shipment(s)"].add(n); });
    });
  });
  (stores.pos || []).forEach(po => { if (same(po?.destinationLocationId, locationId)) hits["Purchase Order(s)"].add(S(po.number || po.id)); });
  (stores.orders || []).forEach(so => { if (same(so?.destinationLocationId, locationId)) hits["Sales Order(s)"].add(S(so.number || so.id)); });
  (stores.contacts || []).forEach(c => {
    const ids = (c?.warehouseTariff?.locationIds || []).map(S);
    if (ids.includes(S(locationId))) hits["Warehouse tariff(s)"].add(S(c.name || c.id));
  });
  return group(hits);
}
