import React, { useEffect, useState } from "react";
import Dashboard from "./Dashboard";
import Contacts from "./Contacts";
import PurchaseOrders from "./PurchaseOrders";
import Inventory from "./Inventory";
import SalesOrders from "./SalesOrders";
import Shipments from "./Shipments";
import Finance from "./Finance";
import Settings from "./Settings";
import { SHELL_SEED } from "./shell_seed";
import { useLocalStoredState } from "./useLocalStoredState";
import { APP_VERSION } from "./version";
import IntegrityBadge from "./IntegrityBadge";

// ─── MARIANNA ERP — INTEGRATION SHELL ──────────────────────────────────────
// Owns canonical state for the frontend prototype and passes it to each module.
// State is persisted in browser localStorage via useLocalStoredState so testers
// can refresh, close the browser, and continue with the same test data.


function normalizeName(value: any) {
  return String(value || "").trim().toLowerCase();
}

function primaryContact(c: any) {
  return (c?.contacts || []).find((p: any) => p.isPrimary) || (c?.contacts || [])[0] || {};
}

function counterpartySnapshot(c: any) {
  const primary = primaryContact(c);
  return {
    id: c.id,
    name: c.name,
    country: c.country,
    nip: c.nip,
    vatEuId: c.vatEuId,
    type: c.type,
    additionalTypes: c.additionalTypes || [],
    address: c.address,
    defaultCurrency: c.defaultCurrency,
    paymentTerms: c.paymentTerms,
    paymentTermsOther: c.paymentTermsOther,
    services: c.services || [],
    contact: primary?.name || "",
    email: primary?.email || "",
    phone: primary?.phone || "",
  };
}

function resolveCounterpartySnapshot(saved: any, contacts: any[]) {
  if (!saved) return saved;
  const byId = contacts.find((c: any) => String(c.id) === String(saved.id));
  // Merged duplicates: the surviving record keeps the absorbed record's id in
  // mergedFromIds, so documents that referenced the removed duplicate re-point here.
  const byMergedId = contacts.find((c: any) => (c.mergedFromIds || []).map(String).includes(String(saved.id)));
  const byName = contacts.find((c: any) => normalizeName(c.name) === normalizeName(saved.name));
  const c = byId || byMergedId || byName;
  return c ? counterpartySnapshot(c) : saved;
}

function refreshPOCounterparties(pos: any[], contacts: any[]) {
  return (pos || []).map((po: any) => ({
    ...po,
    supplier: resolveCounterpartySnapshot(po.supplier, contacts),
  }));
}

function refreshSOCounterparties(orders: any[], contacts: any[]) {
  return (orders || []).map((so: any) => ({
    ...so,
    client: resolveCounterpartySnapshot(so.client, contacts),
  }));
}

function refreshShipmentCounterparties(shipments: any[], contacts: any[]) {
  // Shipments mostly store provider IDs and therefore already resolve live data at print/email time.
  // This pass refreshes any legacy/snapshot provider fields that may exist in imported data.
  return (shipments || []).map((sh: any) => ({
    ...sh,
    carrier: resolveCounterpartySnapshot(sh.carrier, contacts),
    forwarder: resolveCounterpartySnapshot(sh.forwarder, contacts),
    broker: resolveCounterpartySnapshot(sh.broker, contacts),
  }));
}

const NAV_ITEMS = [
  { key: "dashboard", icon: "⊞", label: "Dashboard" },
  { key: "finance", icon: "Σ", label: "Finance" },
  { key: "pos", icon: "↓", label: "Purchase Orders" },
  { key: "lots", icon: "▣", label: "Inventory" },
  { key: "orders", icon: "↑", label: "Sales Orders" },
  { key: "shipments", icon: "▤", label: "Shipments" },
  { key: "contacts", icon: "◻", label: "Counterparties" },
  { key: "settings", icon: "⚙", label: "Settings" },
];

function TopNav({ active, onNav = () => {}, rightSlot = null }: any) {
  return (
    <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", minHeight: 56, display: "flex", alignItems: "center", gap: 0, flexShrink: 0, overflowX: "auto" }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: "#111", letterSpacing: "-0.3px", marginRight: 24, whiteSpace: "nowrap" }}>
        MARIANNA <span style={{ fontSize: 11, fontWeight: 500, color: "#AAA", marginLeft: 6, letterSpacing: 0 }}>ERP</span>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {NAV_ITEMS.map(n => {
          const isActive = active === n.key;
          return (
            <button key={n.key} onClick={() => onNav(n.key)}
              style={{
                padding: "8px 12px", borderRadius: 7,
                border: "none",
                background: isActive ? "#111" : "transparent",
                color: isActive ? "#fff" : "#666",
                fontSize: 12.5, fontWeight: isActive ? 600 : 500,
                cursor: "pointer",
                display: "flex", alignItems: "center", gap: 6,
                fontFamily: "inherit",
                transition: "background 0.12s",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "#F3F4F6"; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
              <span style={{ fontSize: 13, opacity: 0.75 }}>{n.icon}</span>
              {n.label}
            </button>
          );
        })}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "#AAA", paddingLeft: 16, whiteSpace: "nowrap" }}>
        {rightSlot}
        <span title="App build version. Everyone sharing a JSON file must be on the same version." style={{ fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 700, color: "#64748B", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 11, padding: "2px 8px" }}>v{APP_VERSION}</span>
        <span>Hazem Osman</span>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#111", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>HO</div>
      </div>
    </div>
  );
}

export default function App() {
  const [contacts, _setContacts] = useLocalStoredState("contacts", SHELL_SEED.contacts);
  const [pos, setPOs] = useLocalStoredState("pos", SHELL_SEED.pos);
  const [lots, setLots] = useLocalStoredState("lots", SHELL_SEED.lots);
  const [orders, setOrders] = useLocalStoredState("orders", SHELL_SEED.orders);
  const [shipments, setShipments] = useLocalStoredState("shipments", SHELL_SEED.shipments);
  const [operationalCosts, setOperationalCosts] = useLocalStoredState("operationalCosts", SHELL_SEED.operationalCosts);
  const [warehouseInvoices, setWarehouseInvoices] = useLocalStoredState("warehouseInvoices", SHELL_SEED.warehouseInvoices || []);
  const [settledRefs, setSettledRefs] = useLocalStoredState("settledRefs", []);
  const [creditNotes, setCreditNotes] = useLocalStoredState("creditNotes", []);
  const [logisticsPoints, setLogisticsPoints] = useLocalStoredState("logisticsPoints", []);
  // Current user role — drives P/L visibility. No login system yet; switchable in Settings.
  const [userRole, setUserRole] = useLocalStoredState("userRole", "General Manager");
  const [userName, setUserName] = useLocalStoredState("userName", "");

  function setContactsCascade(update: any) {
    _setContacts(update);
  }

  useEffect(() => {
    setPOs((prevPOs: any[]) => refreshPOCounterparties(prevPOs, contacts));
    setOrders((prevOrders: any[]) => refreshSOCounterparties(prevOrders, contacts));
    setShipments((prevShipments: any[]) => refreshShipmentCounterparties(prevShipments, contacts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts]);

  const [activeModule, setActiveModule] = useState("dashboard");
  // One-time reminder for testers to export/back up their data (localStorage only).
  const [backupReminderDismissed, setBackupReminderDismissed] = useLocalStoredState("backupReminderDismissed", false);

  function reloadFromStorage() {
    window.location.reload();
  }

  function renderActive() {
    switch (activeModule) {
      case "dashboard":
        return <Dashboard pos={pos} orders={orders} lots={lots} contacts={contacts} shipments={shipments} operationalCosts={operationalCosts} onNavigate={setActiveModule} />;
      case "finance":
        return <Finance orders={orders} lots={lots} setLots={setLots} contacts={contacts} pos={pos} shipments={shipments} operationalCosts={operationalCosts} setOperationalCosts={setOperationalCosts} warehouseInvoices={warehouseInvoices} setWarehouseInvoices={setWarehouseInvoices} settledRefs={settledRefs} setSettledRefs={setSettledRefs} creditNotes={creditNotes} setCreditNotes={setCreditNotes} />;
      case "contacts":
        return <Contacts contacts={contacts} setContacts={setContactsCascade} logisticsPoints={logisticsPoints} setLogisticsPoints={setLogisticsPoints} />;
      case "pos":
        return <PurchaseOrders pos={pos} setPOs={setPOs} contacts={contacts} lots={lots} setLots={setLots} orders={orders} setOrders={setOrders} shipments={shipments} />;
      case "lots":
        return <Inventory lots={lots} setLots={setLots} allOrders={orders} contacts={contacts} shipments={shipments} pos={pos} />;
      case "orders":
        return <SalesOrders orders={orders} setOrders={setOrders} invLots={lots} setLots={setLots} allPOs={pos} contacts={contacts} shipments={shipments} operationalCosts={operationalCosts} userRole={userRole} userName={userName} />;
      case "shipments":
        return <Shipments shipments={shipments} setShipments={setShipments} contacts={contacts} pos={pos} setPOs={setPOs} lots={lots} setLots={setLots} orders={orders} setOrders={setOrders} onNavigate={setActiveModule} />;
      case "settings":
        return <Settings reloadFromStorage={reloadFromStorage} userRole={userRole} setUserRole={setUserRole} userName={userName} setUserName={setUserName} />;
      default:
        return null;
    }
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, system-ui, sans-serif", color: "#111", background: "#FAFAFA" }}>
      <TopNav active={activeModule} onNav={setActiveModule} rightSlot={
        <IntegrityBadge
          data={{ contacts, pos, lots, orders, shipments, warehouseInvoices, operationalCosts, creditNotes }}
          onNavigate={setActiveModule}
        />
      } />
      {!backupReminderDismissed && (
        <div style={{ background: "#FEF3C7", borderBottom: "1px solid #FDE68A", padding: "10px 28px", display: "flex", alignItems: "center", gap: 12, fontSize: 12.5, color: "#92400E", flexShrink: 0 }}>
          <span style={{ fontSize: 15 }}>💾</span>
          <span style={{ flex: 1, lineHeight: 1.45 }}>
            <strong>Test build — your data lives only in this browser.</strong> It survives refreshes and updates here, but is lost if you switch browser/device, use a private window, or clear browsing data. Back it up regularly via <strong>Settings → Export all data</strong>, and send that file with any bug report.
          </span>
          <button onClick={() => { setActiveModule("settings"); }} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #D97706", background: "#fff", color: "#92400E", fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>Open Settings</button>
          <button onClick={() => setBackupReminderDismissed(true)} style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: "transparent", color: "#92400E", fontSize: 16, cursor: "pointer", lineHeight: 1 }} title="Dismiss">×</button>
        </div>
      )}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {renderActive()}
      </div>
    </div>
  );
}
