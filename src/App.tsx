import React, { useEffect, useState } from "react";
import Dashboard from "./Dashboard";
import Contacts from "./Contacts";
import PurchaseOrders from "./PurchaseOrders";
import Inventory from "./Inventory";
import SalesOrders from "./SalesOrders";
import Shipments from "./Shipments";
import Finance from "./Finance";
import Settings from "./Settings";
import { PRODUCT_CATALOG_SEED } from "./productCatalog";
import { SHELL_SEED } from "./shell_seed";
import { useLocalStoredState, useStorageHealth, runMigrationsIfNeeded } from "./useLocalStoredState";
import { setAuditSink } from "./audit";
import { appendAudit } from "./auditTrail.domain";
import AuditTrail from "./AuditTrail";
import { convertSettledRefsToEvents } from "./payments.domain";
import { APP_VERSION } from "./version";
import IntegrityBadge from "./IntegrityBadge";
import { primeIdsFrom } from "./ids";
import Invoices from "./Invoices";
import { migrateLegacyInvoices, stripPendingInvoices, migrateLegacyCreditNotes } from "./invoicing";

// Batch 5: migrate older-version stored data forward BEFORE any hook reads it
// (module scope — runs before the App component's hooks read the stores).
// NOTE (v6.26.1): this call must sit AFTER all imports — CRA's eslint
// `import/first` rule fails the build otherwise. That exact mistake broke the
// v6.26.0 deploy; the release gate now runs the real CRA build to catch it.
runMigrationsIfNeeded();

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

// v6.18.2: nav grouped into clusters so it stays compact and doesn't scroll.
// Short labels keep it tight; full names remain as tooltips.
const NAV_GROUPS: { items: { key: string; icon: string; label: string; short: string }[] }[] = [
  { items: [{ key: "dashboard", icon: "⊞", label: "Dashboard", short: "Dashboard" }] },
  { items: [
    { key: "pos", icon: "↓", label: "Purchase Orders", short: "POs" },
    { key: "lots", icon: "▣", label: "Inventory", short: "Inventory" },
    { key: "orders", icon: "↑", label: "Sales Orders", short: "SOs" },
    { key: "shipments", icon: "▤", label: "Shipments", short: "Shipments" },
  ] },
  { items: [
    { key: "invoices", icon: "₣", label: "Invoices", short: "Invoices" },
    { key: "finance", icon: "Σ", label: "Finance", short: "Finance" },
    { key: "audit", icon: "≡", label: "Audit trail", short: "Audit" },
  ] },
  { items: [
    { key: "contacts", icon: "◻", label: "Counterparties", short: "Parties" },
    { key: "settings", icon: "⚙", label: "Settings", short: "Settings" },
  ] },
];

function TopNav({ active, onNav = () => {}, rightSlot = null }: any) {
  return (
    <div style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", minHeight: 56, display: "flex", alignItems: "center", gap: 0, flexShrink: 0, overflowX: "auto" }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: "#111", letterSpacing: "-0.3px", marginRight: 24, whiteSpace: "nowrap" }}>
        MARIANNA <span style={{ fontSize: 11, fontWeight: 500, color: "#AAA", marginLeft: 6, letterSpacing: 0 }}>ERP</span>
      </div>
      <div style={{ display: "flex", gap: 0, alignItems: "center" }}>
        {NAV_GROUPS.map((group, gi) => (
          <React.Fragment key={gi}>
            {gi > 0 && <div style={{ width: 1, height: 22, background: "#ECECEC", margin: "0 8px", flexShrink: 0 }} />}
            <div style={{ display: "flex", gap: 2 }}>
              {group.items.map(n => {
                const isActive = active === n.key;
                return (
                  <button key={n.key} onClick={() => onNav(n.key)} title={n.label}
                    style={{
                      padding: "7px 9px", borderRadius: 7,
                      border: "none",
                      background: isActive ? "#111" : "transparent",
                      color: isActive ? "#fff" : "#666",
                      fontSize: 12, fontWeight: isActive ? 600 : 500,
                      cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 5,
                      fontFamily: "inherit",
                      transition: "background 0.12s",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "#F3F4F6"; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
                    <span style={{ fontSize: 13, opacity: 0.75 }}>{n.icon}</span>
                    {n.short}
                  </button>
                );
              })}
            </div>
          </React.Fragment>
        ))}
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
  const [invoices, setInvoices] = useLocalStoredState("invoices", []);
  const [productCatalog, setProductCatalog] = useLocalStoredState("productCatalog", PRODUCT_CATALOG_SEED);
  const [financeNotes, setFinanceNotes] = useLocalStoredState("financeNotes", []);
  const [logisticsPoints, setLogisticsPoints] = useLocalStoredState("logisticsPoints", []);
  // Current user role — drives P/L visibility. No login system yet; switchable in Settings.
  const [userRole, setUserRole] = useLocalStoredState("userRole", "General Manager");
  const [userName, setUserName] = useLocalStoredState("userName", "");
  // v6.40.0: the audit logbook — passive, capped, exported with everything else.
  const [auditLog, setAuditLog] = useLocalStoredState("auditLog", []);
  setAuditSink((e: any) => setAuditLog((prev: any[]) => appendAudit(prev || [], {
    id: Date.now() * 10 + Math.floor(Math.random() * 10),
    ts: new Date().toISOString(),
    user: userName || "user",
    ...e,
  })));

  function setContactsCascade(update: any) {
    _setContacts(update);
  }

  useEffect(() => {
    setPOs((prevPOs: any[]) => refreshPOCounterparties(prevPOs, contacts));
    setOrders((prevOrders: any[]) => refreshSOCounterparties(prevOrders, contacts));
    setShipments((prevShipments: any[]) => refreshShipmentCounterparties(prevShipments, contacts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts]);

  // Keep the stable-id generator primed above every id already in loaded data, so a
  // freshly minted id can never collide with one from storage or a JSON import.
  useEffect(() => {
    primeIdsFrom(contacts, pos, lots, orders, shipments, warehouseInvoices, operationalCosts);
  }, [contacts, pos, lots, orders, shipments, warehouseInvoices, operationalCosts]);

  // Fold the four legacy invoice representations (SO pendingInvoices, warehouse
  // invoices, invoice-backed operational costs) into the unified Invoicing model.
  // Idempotent by source tag — safe to run on every relevant change; never duplicates.
  useEffect(() => {
    setInvoices((prev: any[]) => {
      const merged = migrateLegacyInvoices({ existing: prev || [], orders, warehouseInvoices, operationalCosts, pos });
      return merged.length !== (prev || []).length ? merged : prev;
    });
    // v6.33.0 (A3-6): the register is now the sole owner — once this snapshot's
    // pendingInvoices are folded (idempotent by source tag above), strip them
    // from the orders. Same-reference return when clean, so no effect loop.
    setOrders((prev: any[]) => stripPendingInvoices(prev).orders);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, warehouseInvoices, operationalCosts, pos]);

  // v6.33.0 (A3-5 residue): one-shot fold of the legacy Finance creditNotes
  // array into the canonical notes model (idempotent by source tag), after
  // which they finally enter the receivable/payable totals (BP-37). The legacy
  // array is then emptied; importing an old backup re-triggers the fold.
  useEffect(() => {
    if (!(creditNotes || []).length) return;
    setFinanceNotes((prev: any[]) => migrateLegacyCreditNotes({ existing: prev || [], creditNotes }));
    setCreditNotes([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditNotes]);

  const [activeModule, setActiveModule] = useState("dashboard");
  // One-time reminder for testers to export/back up their data (localStorage only).
  const [backupReminderDismissed, setBackupReminderDismissed] = useLocalStoredState("backupReminderDismissed", false);
  const storageHealthState = useStorageHealth(); // Batch 5: surface failed writes

  // Batch 5d (BP-39): one-time conversion — legacy "mark paid" flags on invoices
  // become tagged payment events. Idempotent: converted refs are removed.
  const settledConversionDone = React.useRef(false);
  React.useEffect(() => {
    if (settledConversionDone.current) return;
    settledConversionDone.current = true;
    const invRefs = (settledRefs || []).filter((r: string) => String(r).startsWith("INV:") || String(r).startsWith("SINV:"));
    if (!invRefs.length) return;
    const res = convertSettledRefsToEvents(invoices, settledRefs, { todayISO: () => new Date().toISOString().slice(0, 10), nextId: () => Date.now() + Math.floor(Math.random() * 1000) });
    if (res.converted > 0) { setInvoices(res.invoices); setSettledRefs(res.settledRefs); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reloadFromStorage() {
    window.location.reload();
  }

  function renderActive() {
    switch (activeModule) {
      case "dashboard":
        return <Dashboard pos={pos} orders={orders} lots={lots} contacts={contacts} shipments={shipments} operationalCosts={operationalCosts} onNavigate={setActiveModule} />;
      case "audit":
        return <AuditTrail auditLog={auditLog} />;
      case "finance":
        return <Finance orders={orders} lots={lots} setLots={setLots} contacts={contacts} pos={pos} shipments={shipments} operationalCosts={operationalCosts} setOperationalCosts={setOperationalCosts} warehouseInvoices={warehouseInvoices} setWarehouseInvoices={setWarehouseInvoices} settledRefs={settledRefs} setSettledRefs={setSettledRefs} invoices={invoices} setInvoices={setInvoices} financeNotes={financeNotes} />;
      case "contacts":
        return <Contacts contacts={contacts} setContacts={setContactsCascade} logisticsPoints={logisticsPoints} setLogisticsPoints={setLogisticsPoints} />;
      case "pos":
        return <PurchaseOrders pos={pos} setPOs={setPOs} contacts={contacts} lots={lots} setLots={setLots} orders={orders} setOrders={setOrders} shipments={shipments} productCatalog={productCatalog} setProductCatalog={setProductCatalog} />;
      case "lots":
        return <Inventory lots={lots} setLots={setLots} allOrders={orders} contacts={contacts} shipments={shipments} setShipments={setShipments} pos={pos} invoices={invoices} setInvoices={setInvoices} financeNotes={financeNotes} setFinanceNotes={setFinanceNotes} />;
      case "orders":
        return <SalesOrders orders={orders} setOrders={setOrders} invLots={lots} setLots={setLots} allPOs={pos} contacts={contacts} shipments={shipments} setShipments={setShipments} operationalCosts={operationalCosts} invoices={invoices} setInvoices={setInvoices} financeNotes={financeNotes} setFinanceNotes={setFinanceNotes} userRole={userRole} userName={userName} productCatalog={productCatalog} setProductCatalog={setProductCatalog} />;
      case "shipments":
        return <Shipments shipments={shipments} setShipments={setShipments} contacts={contacts} pos={pos} setPOs={setPOs} lots={lots} setLots={setLots} orders={orders} setOrders={setOrders} onNavigate={setActiveModule} />;
      case "invoices":
        return <Invoices invoices={invoices} setInvoices={setInvoices} notes={financeNotes} setNotes={setFinanceNotes} contacts={contacts} orders={orders} pos={pos} shipments={shipments} setShipments={setShipments} lots={lots} operationalCosts={operationalCosts} setOperationalCosts={setOperationalCosts} warehouseInvoices={warehouseInvoices} setWarehouseInvoices={setWarehouseInvoices} />;
      case "settings":
        return <Settings reloadFromStorage={reloadFromStorage} userRole={userRole} setUserRole={setUserRole} userName={userName} setUserName={setUserName} productCatalog={productCatalog} setProductCatalog={setProductCatalog} />;
      default:
        return null;
    }
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, system-ui, sans-serif", color: "#111", background: "#FAFAFA" }}>
      <TopNav active={activeModule} onNav={setActiveModule} rightSlot={
        <IntegrityBadge
          data={{ contacts, pos, lots, orders, shipments, warehouseInvoices, operationalCosts, creditNotes, invoices, financeNotes }}
          onNavigate={setActiveModule}
        />
      } />
      {storageHealthState.failing && (
        <div style={{ background: "#FEF2F2", borderBottom: "2px solid #DC2626", padding: "10px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>🛑</span>
          <div style={{ fontSize: 12.5, color: "#991B1B", lineHeight: 1.45 }}>
            <strong>Saving to browser storage is FAILING</strong> (key "{storageHealthState.failedKey}": {storageHealthState.lastError || "storage full or disabled"}).
            Your latest changes exist only in this tab and will be LOST on refresh — go to <strong>Settings → Export</strong> now, then free space (delete old backups) and reload.
          </div>
        </div>
      )}
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
