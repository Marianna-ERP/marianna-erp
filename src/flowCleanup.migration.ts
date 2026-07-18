// ─────────────────────────────────────────────────────────────────────────────
// v6.37.0 — SCHEMA MIGRATION 2: retirement of the legacy "flow" model.
//
// Every primary behaviour has been shipment/incoterm-derived since Phase C
// (v6.34.7 … v6.35.3). This one-time migration removes the last dependency on
// the legacy flow key from STORED DATA, so the flow fallback code can be
// deleted from the app:
//
//   • POs  — backfill buyIncoterm / tradeMovement / directFlow from the flow
//            key where the structured fields are missing, then drop flow.
//   • Lots — backfill buyIncoterm from the (migrated) PO; if a lot relied on
//            the flow-template journey (no stored journey AND no shipment),
//            BAKE that journey into lot.journey one last time so nothing the
//            user could see is lost; then drop flow.
//
// A migration must be an immutable snapshot: everything it needs is FROZEN
// here (copies of the legacy tables as they existed at retirement). It never
// imports live app code, so future edits cannot silently change what this
// migration does. Pure + idempotent: running it on already-clean data is a
// no-op. The storage runner keeps the old v1 keys as a safety copy.
// ─────────────────────────────────────────────────────────────────────────────

// Frozen copy of tradeFlow.domain's FLOW_TO_STRUCT at retirement.
const FROZEN_FLOW_TO_STRUCT: Record<string, any> = {
  EXP_EXWS:    { tradeMovement: "EXPORT", purchaseIncoterm: "EXW", cargoPlan: "CLIENT_PICKUP" },
  EXP_FOB:     { tradeMovement: "EXPORT", purchaseIncoterm: "EXW", cargoPlan: "TO_PORT" },
  EXP_CIF:     { tradeMovement: "EXPORT", purchaseIncoterm: "EXW", cargoPlan: "TO_PORT" },
  EXP_DDP_EU:  { tradeMovement: "EXPORT", purchaseIncoterm: "EXW", cargoPlan: "DIRECT_TO_CLIENT" },
  EXP_DDP_XEU: { tradeMovement: "EXPORT", purchaseIncoterm: "EXW", cargoPlan: "DIRECT_TO_CLIENT" },
  IMP_EXWS_WH: { tradeMovement: "IMPORT", purchaseIncoterm: "EXW", cargoPlan: "OUR_WAREHOUSE" },
  IMP_EXWS_DIR:{ tradeMovement: "IMPORT", purchaseIncoterm: "EXW", cargoPlan: "DIRECT_TO_CLIENT" },
  IMP_CIF_WH:  { tradeMovement: "IMPORT", purchaseIncoterm: "CIF", cargoPlan: "OUR_WAREHOUSE" },
  IMP_CIF_DIR: { tradeMovement: "IMPORT", purchaseIncoterm: "CIF", cargoPlan: "DIRECT_TO_CLIENT" },
  IMP_DDP_WH:  { tradeMovement: "IMPORT", purchaseIncoterm: "DDP", cargoPlan: "OUR_WAREHOUSE" },
  IMP_DDP_DIR: { tradeMovement: "IMPORT", purchaseIncoterm: "DDP", cargoPlan: "DIRECT_TO_CLIENT" },
};

// Frozen copy of the journey stage templates + ownership boundaries
// (Inventory/PurchaseOrders FLOW_TYPES at retirement).
const FROZEN_TEMPLATES: Record<string, { buyStart: string; sellEnd: string; stages: { kind: string; label: string }[] }> = {
  EXP_EXWS:    { buyStart: "never", sellEnd: "never", stages: [{ kind: "supplier", label: "At producer (ready)" }, { kind: "client", label: "Collected by client" }] },
  EXP_FOB:     { buyStart: "supplier", sellEnd: "origin_port", stages: [{ kind: "supplier", label: "At producer" }, { kind: "transit_road", label: "Road to port of loading" }, { kind: "origin_port", label: "Port of loading (handed to client)" }] },
  EXP_CIF:     { buyStart: "supplier", sellEnd: "dest_port", stages: [{ kind: "supplier", label: "At producer" }, { kind: "transit_road", label: "Road to port of loading" }, { kind: "origin_port", label: "Port of loading" }, { kind: "customs_export", label: "Export customs" }, { kind: "transit_sea", label: "Sea freight" }, { kind: "dest_port", label: "Destination port (handed to client)" }] },
  EXP_DDP_EU:  { buyStart: "supplier", sellEnd: "client", stages: [{ kind: "supplier", label: "At producer" }, { kind: "transit_road", label: "Road to client (intra-EU)" }, { kind: "client", label: "Delivered to client" }] },
  EXP_DDP_XEU: { buyStart: "supplier", sellEnd: "client", stages: [{ kind: "supplier", label: "At producer" }, { kind: "transit_road", label: "Road to border" }, { kind: "customs_export", label: "Export customs" }, { kind: "transit_road", label: "Road to client" }, { kind: "client", label: "Delivered to client" }] },
  IMP_EXWS_WH: { buyStart: "supplier", sellEnd: "our_wh", stages: [{ kind: "supplier", label: "At supplier" }, { kind: "transit_road", label: "Road to port of loading" }, { kind: "origin_port", label: "Port of loading" }, { kind: "transit_sea", label: "Sea freight" }, { kind: "dest_port", label: "Destination port" }, { kind: "customs_import", label: "Import customs" }, { kind: "transit_road", label: "Road to our warehouse" }, { kind: "our_wh", label: "In our warehouse" }] },
  IMP_EXWS_DIR:{ buyStart: "supplier", sellEnd: "client", stages: [{ kind: "supplier", label: "At supplier" }, { kind: "transit_road", label: "Road to port of loading" }, { kind: "origin_port", label: "Port of loading" }, { kind: "transit_sea", label: "Sea freight" }, { kind: "dest_port", label: "Destination port" }, { kind: "customs_import", label: "Import customs" }, { kind: "transit_road", label: "Road to client" }, { kind: "client", label: "Delivered to client" }] },
  IMP_CIF_WH:  { buyStart: "dest_port", sellEnd: "our_wh", stages: [{ kind: "supplier", label: "At supplier (supplier ships)" }, { kind: "transit_sea", label: "Sea freight (supplier's risk)" }, { kind: "dest_port", label: "Destination port (we take over)" }, { kind: "customs_import", label: "Import customs" }, { kind: "transit_road", label: "Road to our warehouse" }, { kind: "our_wh", label: "In our warehouse" }] },
  IMP_CIF_DIR: { buyStart: "dest_port", sellEnd: "client", stages: [{ kind: "supplier", label: "At supplier (supplier ships)" }, { kind: "transit_sea", label: "Sea freight (supplier's risk)" }, { kind: "dest_port", label: "Destination port (we take over)" }, { kind: "customs_import", label: "Import customs" }, { kind: "transit_road", label: "Road to client" }, { kind: "client", label: "Delivered to client" }] },
  IMP_DDP_WH:  { buyStart: "our_wh", sellEnd: "our_wh", stages: [{ kind: "supplier", label: "At supplier (supplier delivers)" }, { kind: "transit_road", label: "Supplier's delivery (their risk)" }, { kind: "our_wh", label: "Received in our warehouse" }] },
  IMP_DDP_DIR: { buyStart: "never", sellEnd: "never", stages: [{ kind: "supplier", label: "At supplier (supplier delivers)" }, { kind: "client", label: "Delivered to client (pass-through)" }] },
};

const FROZEN_POINT_ORDER = ["supplier", "origin_port", "vessel", "dest_port", "our_wh", "client"];
const FROZEN_KIND_TO_POINT: Record<string, string> = {
  supplier: "supplier", origin_port: "origin_port", customs_export: "origin_port",
  transit_sea: "vessel", dest_port: "dest_port", customs_import: "dest_port",
  our_wh: "our_wh", client: "client", transit_road: "supplier",
};

function frozenOwnership(tpl: { buyStart: string; sellEnd: string; stages: { kind: string }[] }, idx: number): string {
  if (tpl.buyStart === "never" || tpl.sellEnd === "never") return "not_owned";
  // a transit leg follows the point it departs FROM (nearest preceding non-transit stage)
  let point = FROZEN_KIND_TO_POINT[tpl.stages[idx].kind] || "supplier";
  const k = tpl.stages[idx].kind;
  if (k === "transit_road" || k === "transit_sea") {
    for (let j = idx - 1; j >= 0; j--) {
      const pk = tpl.stages[j].kind;
      if (pk !== "transit_road" && pk !== "transit_sea") { point = FROZEN_KIND_TO_POINT[pk] || point; break; }
    }
  }
  const p = FROZEN_POINT_ORDER.indexOf(point);
  const s = FROZEN_POINT_ORDER.indexOf(tpl.buyStart);
  const e = FROZEN_POINT_ORDER.indexOf(tpl.sellEnd);
  if (p === -1 || s === -1 || e === -1) return "owned";
  if (p < s) return "not_owned";
  if (p > e) return "handed_over";
  return "owned";
}

/** Bake the legacy flow-template journey for a lot (what journeyForLot's fallback produced). */
function bakeJourney(lot: any): any[] {
  const tpl = FROZEN_TEMPLATES[String(lot.flow || "")];
  if (!tpl) return [];
  const load = lot.loadingDate || null;
  const arrive = lot.arrivalDate || null;
  const n = tpl.stages.length;
  return tpl.stages.map((st, i) => {
    let plannedDate: string | null = null;
    if (load && arrive && n > 1) {
      const t0 = new Date(load).getTime();
      const t1 = new Date(arrive).getTime();
      plannedDate = new Date(t0 + ((t1 - t0) * i) / (n - 1)).toISOString().split("T")[0];
    } else if (i === 0) plannedDate = load;
    else if (i === n - 1) plannedDate = arrive;
    return { seq: i + 1, kind: st.kind, label: st.label, ownership: frozenOwnership(tpl, i), plannedDate, actualDate: null, status: "pending" };
  });
}

function lotHasShipment(lot: any, shipments: any[]): boolean {
  return (shipments || []).some((sh: any) =>
    (sh?.lotRefs || []).map(String).includes(String(lot.number)) ||
    (sh?.goods || []).some((g: any) => String(g?.lotRef) === String(lot.number)));
}

/**
 * MIGRATIONS[2] — flow retirement. Pure and idempotent.
 * Transforms the whole data dict as the storage runner expects.
 */
export function migrateFlowCleanup(all: Record<string, any>): Record<string, any> {
  const out = { ...all };
  const shipments = Array.isArray(all.shipments) ? all.shipments : [];

  if (Array.isArray(all.pos)) {
    out.pos = all.pos.map((po: any) => {
      const p = { ...po };
      const st = p.flow ? FROZEN_FLOW_TO_STRUCT[String(p.flow)] : null;
      if (st) {
        if (!p.buyIncoterm && !p.purchaseIncoterm) p.buyIncoterm = st.purchaseIncoterm;
        if (!p.tradeMovement) p.tradeMovement = st.tradeMovement;
        if (p.directFlow === undefined) p.directFlow = st.cargoPlan === "DIRECT_TO_CLIENT";
      }
      delete p.flow; delete p.flowLabel;
      return p;
    });
  }

  const poByNumber: Record<string, any> = {};
  (Array.isArray(out.pos) ? out.pos : []).forEach((p: any) => { if (p?.number) poByNumber[String(p.number)] = p; });

  if (Array.isArray(all.lots)) {
    out.lots = all.lots.map((lot: any) => {
      const l = { ...lot };
      const po = l.poRef ? poByNumber[String(l.poRef)] : null;
      if (!l.buyIncoterm && !l.purchaseIncoterm && po && po.buyIncoterm) l.buyIncoterm = po.buyIncoterm;
      const hasJourney = Array.isArray(l.journey) && l.journey.length > 0;
      if (!hasJourney && l.flow && !lotHasShipment(l, shipments)) {
        const baked = bakeJourney(l);
        if (baked.length) l.journey = baked;
      }
      delete l.flow; delete l.flowLabel;
      return l;
    });
  }

  return out;
}
