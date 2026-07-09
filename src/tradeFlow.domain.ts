// ─────────────────────────────────────────────────────────────────────────────
// tradeFlow.domain.ts — structured PO trade fields ⇄ legacy flow key (Batch 4b)
//
// BP-1 exposes the trade structure as explicit, editable fields. BP-12 keeps the
// legacy `flow` key (which Shipments and Inventory read heavily —
// FLOW_TYPES[lot.flow], isExport, journey templates) working by DERIVING it from
// the structured fields, and vice-versa for existing data. Bidirectional and
// lossless across the 12 known flows; unknown keys degrade gracefully.
//
// The four structured fields (BP-1):
//   tradeMovement : "EXPORT" | "IMPORT"           (we sell from PL/EU · we buy in)
//   purchaseIncoterm : EXW | FCA | FOB | CIF | DAP | DDP …
//   handoverPoint : "supplier" | "origin_port" | "dest_port" | "our_wh" | "client"
//   cargoPlan : "OUR_WAREHOUSE" | "DIRECT_TO_CLIENT" | "TO_PORT" | "CLIENT_PICKUP"
// ─────────────────────────────────────────────────────────────────────────────

// Legacy flow key → structured fields (for existing POs/lots).
const FLOW_TO_STRUCT: Record<string, any> = {
  EXP_EXWS:   { tradeMovement: "EXPORT", purchaseIncoterm: "EXW", handoverPoint: "supplier",    cargoPlan: "CLIENT_PICKUP" },
  EXP_FOB:    { tradeMovement: "EXPORT", purchaseIncoterm: "EXW", handoverPoint: "origin_port", cargoPlan: "TO_PORT" },
  EXP_CIF:    { tradeMovement: "EXPORT", purchaseIncoterm: "EXW", handoverPoint: "dest_port",   cargoPlan: "TO_PORT" },
  EXP_DDP_EU: { tradeMovement: "EXPORT", purchaseIncoterm: "EXW", handoverPoint: "client",      cargoPlan: "DIRECT_TO_CLIENT" },
  EXP_DDP_XEU:{ tradeMovement: "EXPORT", purchaseIncoterm: "EXW", handoverPoint: "client",      cargoPlan: "DIRECT_TO_CLIENT" },
  IMP_EXWS_WH:{ tradeMovement: "IMPORT", purchaseIncoterm: "EXW", handoverPoint: "supplier",    cargoPlan: "OUR_WAREHOUSE" },
  IMP_EXWS_DIR:{tradeMovement: "IMPORT", purchaseIncoterm: "EXW", handoverPoint: "supplier",    cargoPlan: "DIRECT_TO_CLIENT" },
  IMP_CIF_WH: { tradeMovement: "IMPORT", purchaseIncoterm: "CIF", handoverPoint: "dest_port",   cargoPlan: "OUR_WAREHOUSE" },
  IMP_CIF_DIR:{ tradeMovement: "IMPORT", purchaseIncoterm: "CIF", handoverPoint: "dest_port",   cargoPlan: "DIRECT_TO_CLIENT" },
  IMP_DDP_WH: { tradeMovement: "IMPORT", purchaseIncoterm: "DDP", handoverPoint: "our_wh",      cargoPlan: "OUR_WAREHOUSE" },
  IMP_DDP_DIR:{ tradeMovement: "IMPORT", purchaseIncoterm: "DDP", handoverPoint: "client",      cargoPlan: "DIRECT_TO_CLIENT" },
};

export function flowToStruct(flow: string): any {
  return FLOW_TO_STRUCT[flow] || null;
}

/**
 * Structured fields → the legacy flow key (BP-12 shim). Deterministic inverse of
 * the table above; picks the closest legacy flow so downstream FLOW_TYPES lookups,
 * journey templates and isExport keep working unchanged.
 */
export function structToFlow(s: any): string {
  if (!s || !s.tradeMovement) return "";
  const inc = String(s.purchaseIncoterm || "EXW").toUpperCase();
  const direct = s.cargoPlan === "DIRECT_TO_CLIENT";
  const pickup = s.cargoPlan === "CLIENT_PICKUP";
  const toPort = s.cargoPlan === "TO_PORT";

  if (s.tradeMovement === "EXPORT") {
    if (pickup) return "EXP_EXWS";
    if (toPort) return s.handoverPoint === "dest_port" || s.requiresSea ? "EXP_CIF" : "EXP_FOB";
    if (direct) return s.crossBorder ? "EXP_DDP_XEU" : "EXP_DDP_EU";
    return "EXP_CIF";
  }
  // IMPORT
  if (inc === "DDP" || inc === "DAP") return direct ? "IMP_DDP_DIR" : "IMP_DDP_WH";
  if (inc === "CIF" || inc === "CFR") return direct ? "IMP_CIF_DIR" : "IMP_CIF_WH";
  // EXW/FCA/FOB purchase
  return direct ? "IMP_EXWS_DIR" : "IMP_EXWS_WH";
}

/** Round-trip stability check used by tests: struct→flow→struct preserves the essentials. */
export function isDirectCargoPlan(s: any): boolean {
  return s?.cargoPlan === "DIRECT_TO_CLIENT";
}

export const TRADE_MOVEMENTS = [
  { code: "IMPORT", label: "Import — we buy (origin overseas / EU)" },
  { code: "EXPORT", label: "Export — we sell (origin in PL / EU)" },
];
export const HANDOVER_POINTS = [
  { code: "supplier",    label: "Supplier site (we take over at the producer)" },
  { code: "origin_port", label: "Port of loading" },
  { code: "dest_port",   label: "Port of discharge" },
  { code: "our_wh",      label: "Our warehouse" },
  { code: "client",      label: "Client / destination" },
];
export const CARGO_PLANS = [
  { code: "OUR_WAREHOUSE",    label: "To our warehouse (stock / split distribution)" },
  { code: "DIRECT_TO_CLIENT", label: "Direct to client (back-to-back — never our warehouse)" },
  { code: "TO_PORT",          label: "To port (onward by sea)" },
  { code: "CLIENT_PICKUP",    label: "Client collects (EXW — no logistics on our side)" },
];

/** Ensure a PO has both representations in sync (called on load / save). */
export function reconcilePOFlow(po: any): any {
  // If structured fields are present, they win and the legacy flow is derived.
  if (po.tradeMovement) {
    const flow = structToFlow(po) || po.flow || "";
    return { ...po, flow, directFlow: isDirectCargoPlan(po) };
  }
  // Otherwise derive structured fields from the legacy flow (existing data).
  const s = flowToStruct(po.flow);
  if (s) return { ...po, ...s, directFlow: s.cargoPlan === "DIRECT_TO_CLIENT" };
  return po;
}
