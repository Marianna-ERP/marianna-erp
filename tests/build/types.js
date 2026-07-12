"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// types.ts — shared data contracts (Consolidation Batch 0)
//
// One place where the shape of every core record is declared. Modules import
// these instead of re-declaring or assuming shapes. The project compiles with
// strict:false, so these interfaces are the *contract*, tightened gradually:
// fields are typed as they exist in real stored data today (optional-heavy on
// purpose — records created by older versions may lack newer fields).
//
// Blueprint references: BP-1..54 (Consolidation Blueprint), Ownership Map §2.
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.SO_PRE_DISPATCH_STATUSES = exports.SO_STATUSES = void 0;
// ── Canonical SO status semantics (single source — BP-48 / Batch 0) ─────────
// Visual + ordering map used by SalesOrders (and any module showing SO badges).
exports.SO_STATUSES = {
    Draft: { bg: "#F3F4F6", color: "#6B7280", order: 0, desc: "Being prepared — can edit freely" },
    Confirmed: { bg: "#DBEAFE", color: "#2563EB", order: 1, desc: "Agreed with client, prices locked" },
    Reserved: { bg: "#E0F2FE", color: "#0369A1", order: 2, desc: "Stock allocated / PO confirmed" },
    Loading: { bg: "#FEF3C7", color: "#D97706", order: 3, desc: "Goods being prepared / loaded" },
    Shipped: { bg: "#EDE9FE", color: "#7C3AED", order: 4, desc: "Handed to carrier, en route" },
    Delivered: { bg: "#DCFCE7", color: "#16A34A", order: 5, desc: "Client confirmed receipt" },
    Invoiced: { bg: "#D1FAE5", color: "#059669", order: 6, desc: "Sales invoice (SINV) issued" },
    Closed: { bg: "#F3F4F6", color: "#374151", order: 7, desc: "Paid and complete" },
    Cancelled: { bg: "#FEE2E2", color: "#DC2626", order: -1, desc: "Cancelled" },
};
// Statuses that reserve stock in the SalesOrders availability engine and are
// counted as the pre-dispatch pipeline on the Dashboard. (Identical 3-status
// sets in both files today — centralised without behaviour change.)
exports.SO_PRE_DISPATCH_STATUSES = new Set(["Confirmed", "Reserved", "Loading"]);
// ⚠ KNOWN DIVERGENCE (Batch 0 finding, resolve in Batch 1 with tests):
// Inventory's local lotReservations uses a WIDER reserving set
// (Confirmed…Closed, 7 statuses), so Inventory's availability display and the
// SalesOrders engine can disagree for Shipped/Delivered/Invoiced/Closed orders.
// Deliberately NOT unified here — changing either set changes availability
// behaviour. The Batch 1 engine unification decides the correct semantics.
