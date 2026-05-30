import React, { useState } from "react";
import Dashboard from "./Dashboard";
import Contacts from "./Contacts";
import PurchaseOrders from "./PurchaseOrders";
import Inventory from "./Inventory";
import SalesOrders from "./SalesOrders";
import Shipments from "./Shipments";
import Settings from "./Settings";
import Finance from "./Finance";
import { useLocalStoredState } from "./useLocalStoredState";

// ─── FRESHTRADE ERP — INTEGRATION SHELL ─────────────────────────────────────
// Owns the canonical state for all four entities and passes it down to each module.
// Each module accepts optional state props (integration mode) and falls back to its
// own seed data (standalone mode).
//
// Why a shell at all? Each module previously stubbed its sibling modules' data
// (Inventory stubbed SOs, SO stubbed lots+POs). The shell replaces those stubs with
// live cross-module data — so reservations on lots show real active SOs, source
// pickers in SOs show real lots, and the dashboard reads everything.
//
// State flow:
//   App  ─owns─►  contacts, pos, lots, orders
//      │
//      ├── Dashboard       (read-only consumer of all four)
//      ├── Contacts        (owns contact mutations)
//      ├── PurchaseOrders  (owns PO mutations; reads contacts for supplier picker — future)
//      ├── Inventory       (owns lot mutations; reads orders for live reservations)
//      └── SalesOrders     (owns SO mutations; reads lots + POs for source picker)

// ─── SEED IMPORTS ───────────────────────────────────────────────────────────
// We pull the seed data from each module's local seed by importing the module
// briefly to extract it — but since modules don't export their seed, the simplest
// approach is: each module already runs its own useState fallback when we pass
// `undefined`, then we MIRROR that state into the shell on first paint. We can't
// "see" the seeds from here.
//
// Solution: we duplicate a minimal seed here for the shell's initial state. On
// integration test the modules will mutate the shell's state, and the shell's
// state stays canonical.
//
// To keep this file maintainable, we use minimal placeholder seeds matching the
// shape each module expects. When a module first renders with our state, it'll
// happily mutate from there. If we want richer initial demos, we can copy the
// modules' seed arrays into here later.
//
// For now: SHELL_SEED has the integration-test data — same SOs, lots, POs as the
// modules have in their standalone seeds. Keeps reservations + cross-references
// realistic on first load.

import { SHELL_SEED } from "./shell_seed";

// ─── NAVIGATION ────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { key: "dashboard", icon: "⊞", label: "Dashboard" },
  { key: "pos",       icon: "↓", label: "Purchase Orders" },
  { key: "lots",      icon: "▣", label: "Inventory" },
  { key: "orders",    icon: "↑", label: "Sales Orders" },
  { key: "shipments", icon: "▤", label: "Shipments" },
  { key: "contacts",  icon: "◻", label: "Counterparties" },
  { key: "finance",   icon: "$", label: "Finance" },
  { key: "settings",  icon: "⚙", label: "Settings" },
];

function TopNav({ active, onNav = () => {} }: any) {
  return (
    <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 56, display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: "#111", letterSpacing: "-0.3px", marginRight: 32 }}>
        MARIANNA <span style={{ fontSize: 11, fontWeight: 500, color: "#AAA", marginLeft: 6, letterSpacing: 0 }}>ERP</span>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {NAV_ITEMS.map(n => {
          const isActive = active === n.key;
          return (
            <button key={n.key} onClick={() => onNav(n.key)}
              style={{
                padding: "8px 14px", borderRadius: 7,
                border: "none",
                background: isActive ? "#111" : "transparent",
                color: isActive ? "#fff" : "#666",
                fontSize: 13, fontWeight: isActive ? 600 : 500,
                cursor: "pointer",
                display: "flex", alignItems: "center", gap: 7,
                fontFamily: "inherit",
                transition: "background 0.12s",
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "#F3F4F6"; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
              <span style={{ fontSize: 14, opacity: 0.7 }}>{n.icon}</span>
              {n.label}
            </button>
          );
        })}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "#AAA" }}>
        <span>Hazem Osman</span>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#111", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>HO</div>
      </div>
    </div>
  );
}

// ─── APP ───────────────────────────────────────────────────────────────────
export default function App() {
  // Canonical state — owned by the shell, persisted to localStorage so each
  // colleague's browser keeps their test data between page refreshes.
  // First-time visitors get SHELL_SEED. After that, their own edits stick.
  // Settings → "Reset to demo" wipes localStorage and reloads.
  const [contacts, setContacts]   = useLocalStoredState("contacts",  SHELL_SEED.contacts);
  const [pos, setPOs]             = useLocalStoredState("pos",       SHELL_SEED.pos);
  const [lots, setLots]           = useLocalStoredState("lots",      SHELL_SEED.lots);
  const [orders, setOrders]       = useLocalStoredState("orders",    SHELL_SEED.orders);
  const [shipments, setShipments] = useLocalStoredState("shipments", SHELL_SEED.shipments);

  // Active module
  const [activeModule, setActiveModule] = useState("dashboard");

  // No-op — Settings triggers window.location.reload() after import/reset,
  // which is the most reliable way to make every module pick up the new state.
  function reloadFromStorage() {
    window.location.reload();
  }

  function renderActive() {
    switch (activeModule) {
      case "dashboard":
        return <Dashboard pos={pos} orders={orders} lots={lots} contacts={contacts} shipments={shipments} onNavigate={setActiveModule} />;
      case "contacts":
        return <Contacts contacts={contacts} setContacts={setContacts} />;
      case "pos":
        return <PurchaseOrders pos={pos} setPOs={setPOs} contacts={contacts} lots={lots} setLots={setLots} />;
      case "lots":
        return <Inventory lots={lots} setLots={setLots} allOrders={orders} />;
      case "orders":
        return <SalesOrders orders={orders} setOrders={setOrders} invLots={lots} setLots={setLots} allPOs={pos} shipments={shipments} contacts={contacts} />;
      case "shipments":
        return <Shipments shipments={shipments} setShipments={setShipments} contacts={contacts} pos={pos} setPOs={setPOs} lots={lots} setLots={setLots} orders={orders} setOrders={setOrders} onNavigate={setActiveModule} />;
      case "finance":
        return <Finance orders={orders} lots={lots} pos={pos} shipments={shipments} />;
      case "settings":
        return <Settings reloadFromStorage={reloadFromStorage} />;
      default:
        return null;
    }
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, system-ui, sans-serif", color: "#111", background: "#FAFAFA" }}>
      <TopNav active={activeModule} onNav={setActiveModule} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {renderActive()}
      </div>
    </div>
  );
}
