// Shell seed — pulls each module's local seed array and combines them.
// The standalone modules still use these same arrays internally (when no props
// are passed). When mounted in the shell, the shell passes its (now shared)
// state and the modules mutate it instead.

import { INIT_COUNTERPARTIES } from "./Contacts";
import { INITIAL_ORDERS as INIT_POS } from "./PurchaseOrders";
import { INIT_LOTS } from "./Inventory";
import { INIT_ORDERS as INIT_SOS } from "./SalesOrders";
import { INIT_SHIPMENTS } from "./Shipments";
import { INIT_OPERATIONAL_COSTS } from "./operationalCosts";

export const SHELL_SEED = {
  contacts: INIT_COUNTERPARTIES,
  pos:      INIT_POS,
  lots:     INIT_LOTS,
  orders:   INIT_SOS,
  shipments: INIT_SHIPMENTS,
  operationalCosts: INIT_OPERATIONAL_COSTS,
};
