// Shell seed — for the TEST SHELL this is intentionally EMPTY so each tester starts
// with a completely clean system and populates their own real data. Locations/ports
// remain built-in (reference data in ./locations). The per-module demo arrays
// (INIT_COUNTERPARTIES, INIT_LOTS, etc.) still exist for standalone/dev use and can
// be re-enabled here later if a richly-seeded demo build is wanted.
//
// To restore the demo dataset, swap the [] values below for the imported arrays.

// import { INIT_COUNTERPARTIES } from "./Contacts";
// import { INITIAL_ORDERS as INIT_POS } from "./PurchaseOrders";
// import { INIT_LOTS } from "./Inventory";
// import { INIT_ORDERS as INIT_SOS } from "./SalesOrders";
// import { INIT_SHIPMENTS } from "./Shipments";
// import { INIT_OPERATIONAL_COSTS } from "./operationalCosts";

export const SHELL_SEED = {
  contacts: [] as any[],
  pos: [] as any[],
  lots: [] as any[],
  orders: [] as any[],
  shipments: [] as any[],
  operationalCosts: [] as any[],
};
