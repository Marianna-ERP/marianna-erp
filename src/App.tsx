import React, { useEffect, useState, useMemo } from "react";
import { checkIntegrity } from "./integrityCheck";
import Dashboard from "./Dashboard";
import Contacts from "./Contacts";
import PurchaseOrders from "./PurchaseOrders";
import Inventory from "./Inventory";
import SalesOrders from "./SalesOrders";
import Shipments from "./Shipments";
import Finance from "./Finance";
import Settings from "./Settings";
import { PRODUCT_CATALOG_SEED } from "./productCatalog";
import { PACKAGING_SEED } from "./packaging.domain";
import { migrateReferencedSeeds, pruneOrphanMigratedSeeds, migratePlaceAddresses, stampSiteIds } from "./locations";
import { normaliseLot } from "./seasonOps.domain";
import { normalisePO } from "./po.domain";
import { normaliseSO } from "./so.domain";
import { foldLegacyClaimFields } from "./claimsPlus.domain";
import { normaliseInvoiceCategory } from "./invoicePlus.domain";
import { normaliseCounterparty } from "./counterparty.domain";
import { migrateAddressOn } from "./address.domain";
import { healShipmentModel } from "./shipmentModel.domain";
import { setFxSettings as applyFxSettings, fetchNbpRates } from "./fx";
import { poDirectFromSOs } from "./tradeFlow.domain";
import { healRound645, healRound651 } from "./heal.v645";
import { migrateClaims } from "./claims.domain";
import Claims from "./Claims";
import { costTypeLabel, costInventoryType } from "./Shipments";
import { localTodayISO } from "./dates";
import { nextId as globalNextId, nextId } from "./ids";
import { SHELL_SEED } from "./shell_seed";
import { useLocalStoredState, useStorageHealth, runMigrationsIfNeeded } from "./useLocalStoredState";
import { setAuditSink, recordAudit } from "./audit";
import { appendAudit } from "./auditTrail.domain";
import AuditTrail from "./AuditTrail";
import { convertSettledRefsToEvents } from "./payments.domain";
import { APP_VERSION } from "./version";
import IntegrityBadge from "./IntegrityBadge";
import { primeIdsFrom } from "./ids";
import Invoices from "./Invoices";
import { migrateLegacyInvoices, stripPendingInvoices, migrateLegacyCreditNotes } from "./invoicing";
import { syncOverheadOpCosts } from "./operationalCosts";
import { normaliseStoredSoStatus } from "./statusOwnership.domain";
import { canOpenModule } from "./permissions.domain";
import { orphanLotsToRemove, danglingLinks } from "./integrityCheck";
import { isArchived, STORE_KIND, DEFAULT_SEASON } from "./season.domain";

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
    { key: "claims", icon: "⚖", label: "Claims", short: "Claims" },
    { key: "audit", icon: "≡", label: "Audit trail", short: "Audit" },
  ] },
  { items: [
    { key: "contacts", icon: "◻", label: "Counterparties", short: "Parties" },
    { key: "settings", icon: "⚙", label: "Settings", short: "Settings" },
  ] },
];

function TopNav({ active, onNav = () => {}, rightSlot = null, canOpen = (_k: string) => true }: any) {
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
              {group.items.filter((n: any) => canOpen(n.key)).map(n => {
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
  const [packagingTypes, setPackagingTypes] = useLocalStoredState("packagingTypes", PACKAGING_SEED);
  const [claims, setClaims] = useLocalStoredState("claims", []);
  // v6.56.0: load plans group the shipments of one commercial movement.
  const [loadPlans, setLoadPlans] = useLocalStoredState("loadPlans", []);
  // v6.68.0 (F-1/F-4): advance payments (zaliczki) + bank accounts registry —
  // the two finance tables agreed pre-Supabase so the schema freezes complete.
  const [advancePayments, setAdvancePayments] = useLocalStoredState("advancePayments", []);
  const [bankAccounts, setBankAccounts] = useLocalStoredState("bankAccounts", []);
  // v6.79.0 (F-5/F-6, owner rulings): users & tick-box permissions; monthly budgets.
  const [users, setUsers] = useLocalStoredState("users", []);
  const [budgets, setBudgets] = useLocalStoredState("budgets", []);
  // v6.89.0 (consignment season): inspections (per lot), stock counts, defect catalogue (Settings).
  const [inspections, setInspections] = useLocalStoredState("inspections", []);
  const [stockCounts, setStockCounts] = useLocalStoredState("stockCounts", []);
  // v6.99.33: defectCatalogue / defectTolerances retired from the UI (import-compat only — see DATA_KEYS)
  // v6.90.0: settlements per PO (= per truck) — the producer's final result.
  const [poSettlements, setPoSettlements] = useLocalStoredState("poSettlements", []);
  // v6.99.0 (FN-1): closed months with their frozen snapshot; (FN-7) reference FX rates as a setting.
  const [closedPeriods, setClosedPeriods] = useLocalStoredState("closedPeriods", []);
  const [fxSettings, setFxSettings] = useLocalStoredState("fxSettings", {});
  // v6.99.54 (AR-1…4, owner): the season model — numbers continue, closed seasons are ARCHIVED (tagged, hidden, exportable)
  const [archivedSeasons, setArchivedSeasons] = useLocalStoredState<string[]>("archivedSeasons", []);
  const [seasonSettings, setSeasonSettings] = useLocalStoredState<any>("seasonSettings", DEFAULT_SEASON);
  const [includeArchived, setIncludeArchived] = useState(false);
  const archive = useMemo(() => ({ archivedSeasons, includeArchived, settings: seasonSettings || DEFAULT_SEASON, pos }), [archivedSeasons, includeArchived, seasonSettings, pos]);
  const live = useMemo(() => {   // the Dashboard, the badge and the reports read the current season unless asked otherwise
    const f = (store: string, arr: any[]) => includeArchived ? arr : (arr || []).filter((d: any) => !isArchived(STORE_KIND[store], d, archivedSeasons, seasonSettings || DEFAULT_SEASON, { pos }));
    return { pos: f("pos", pos), orders: f("orders", orders), shipments: f("shipments", shipments), lots: f("lots", lots), invoices: f("invoices", invoices), claims: f("claims", claims) };
  }, [pos, orders, shipments, lots, invoices, claims, archivedSeasons, includeArchived, seasonSettings]);
  // v6.99.31 (owner): the quality tolerances per product and category (Unacceptable is always 0).
  // v6.99.3 (SE-1/SE-3): company identity and numbering prefixes as settings.
  const [company, setCompany] = useLocalStoredState("company", {});
  const [numbering, setNumbering] = useLocalStoredState("numbering", {});
  // FX auto (owner): NBP table A on load — sets the reference rates when reachable; manual values win when typed.
  useEffect(() => { fetchNbpRates().then(r => { if (r) setFxSettings((prev: any) => ({ ...(r as any), ...(prev || {}), _nbp: (r as any)._date })); }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { applyFxSettings(fxSettings || {}); }, [fxSettings]);

  // ─── v6.45.0 one-time DATA HEAL (test-round root causes B + C) ──────────────
  // Repairs: (C) shipments closed before the v6.44.0 close-posting fix (their
  // lots never got movements → COGS/direct costs/weights/integrity wrong), and
  // (B) goods rows the old matcher pointed at the wrong lot (re-tagged, wrong
  // movements voided, goods re-posted, costs re-allocated). Runs once per
  // browser (marker), is idempotent anyway, and records itself in the audit
  // trail. See src/heal.v645.ts for the full reasoning.
  React.useEffect(() => {
    try {
      const MARK = "marianna:heal:v6.45.0";
      if (typeof window === "undefined" || window.localStorage.getItem(MARK)) return;
      const res = healRound645({ shipments, lots, orders }, {
        todayISO: localTodayISO,
        nextId: globalNextId,
        costMapper: { inventoryType: costInventoryType, label: costTypeLabel },
      });
      window.localStorage.setItem(MARK, new Date().toISOString());
      if (res.changed) {
        setShipments(res.shipments);
        setLots(res.lots);
        try { recordAudit({ module: "System", docType: "Heal", docNumber: "HEAL-6.45.0", action: "healed", summary: res.notes.slice(0, 6).join(" | ") + (res.notes.length > 6 ? ` | +${res.notes.length - 6} more` : "") }); } catch {}
      }
    } catch (e) { console.error("heal v6.45.0 failed (left data untouched):", e); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v6.51.1: the same repair, runnable on demand from Settings.
  function repairInventory() {
    const res = healRound651({ shipments, lots });
    if (res.changed) {
      setLots(res.lots);
      try { recordAudit({ module: "System", docType: "Repair", docNumber: "REPAIR-6.51.1", action: "healed", summary: res.notes.slice(0, 6).join(" | ") }); } catch {}
    }
    return res;
  }

  // ─── v6.51.0 heal: mis-posted transfers + outbound costs in landed cost ────
  React.useEffect(() => {
    try {
      const MARK = "marianna:heal:v6.51.0";
      if (typeof window === "undefined" || window.localStorage.getItem(MARK)) return;
      // v6.51.1: DO NOT claim to have healed before there is anything to heal.
      // The previous version ran once on mount and wrote the marker unconditionally
      // — so if the stores had not finished loading in that instant, the heal found
      // nothing, marked itself done and never ran again. It now waits for real data
      // and only writes the marker once it has actually processed some.
      if (!(lots || []).length || !(shipments || []).length) return;
      const res = healRound651({ shipments, lots });
      window.localStorage.setItem(MARK, new Date().toISOString());
      if (res.changed) {
        setLots(res.lots);
        try { recordAudit({ module: "System", docType: "Heal", docNumber: "HEAL-6.51.0", action: "healed", summary: res.notes.slice(0, 6).join(" | ") + (res.notes.length > 6 ? ` | +${res.notes.length - 6} more` : "") }); } catch {}
      }
    } catch (e) { console.error("heal v6.51.0 failed (left data untouched):", e); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lots.length, shipments.length]);

  // ─── v6.48.0 CLAIMS re-home (Phase 1) ──────────────────────────────────────
  // Lifts every existing claim into its own store: the producer claims nested in
  // lot.claims[] and the client claims that only ever existed as CLAIM movements
  // (unnumbered, statusless). The originals are left untouched — nothing writes
  // to them any more, so keeping them means a migration bug can't destroy the
  // only copy. Idempotent by provenance, and marker-guarded on top.
  React.useEffect(() => {
    try {
      const MARK = "marianna:claims:migrated:v6.48.0";
      if (typeof window === "undefined" || window.localStorage.getItem(MARK)) return;
      const res = migrateClaims({ lots, pos, orders, existing: claims },
        { todayISO: localTodayISO, nextId: globalNextId });
      window.localStorage.setItem(MARK, new Date().toISOString());
      if (res.changed) {
        setClaims(res.claims);
        try { recordAudit({ module: "Claims", docType: "Migration", docNumber: "CLAIMS-6.48.0", action: "migrated", summary: res.notes.slice(0, 6).join(" | ") + (res.notes.length > 6 ? ` | +${res.notes.length - 6} more` : "") }); } catch {}
      }
    } catch (e) { console.error("claims migration failed (left data untouched):", e); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [financeNotes, setFinanceNotes] = useLocalStoredState("financeNotes", []);
  // v6.99.12: logisticsPoints store retired from the UI (kept in DATA_KEYS for old backups only)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [logisticsPoints, setLogisticsPoints] = useLocalStoredState("logisticsPoints", []);
  // Current user role — drives P/L visibility. No login system yet; switchable in Settings.
  const [userRole, setUserRole] = useLocalStoredState("userRole", "General Manager");
  const [userName, setUserName] = useLocalStoredState("userName", "");
  // v6.40.0: the audit logbook — passive, capped, exported with everything else.
  const [auditLog, setAuditLog] = useLocalStoredState("auditLog", []);
  setAuditSink((e: any) => setAuditLog((prev: any[]) => appendAudit(prev || [], {
    id: nextId(), // v6.79.0 (W-7): central counter — burst writes collided under Date.now()
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

  // v6.86.0 (owner ruling): demo seed locations left the reference list; any still referenced
  // by stored documents becomes a user-managed custom location so nothing resolves to blank.
  useEffect(() => {
    const ids = new Set<string>();
    (lots || []).forEach((l: any) => { ids.add(String(l.locationId)); ids.add(String(l.baseLocationId)); (l.movements || []).forEach((m: any) => { ids.add(String(m.toId)); ids.add(String(m.fromId)); }); });
    (pos || []).forEach((p: any) => ids.add(String(p.destinationLocationId)));
    (orders || []).forEach((o: any) => ids.add(String(o.destinationLocationId)));
    (shipments || []).forEach((s: any) => (s.legs || []).forEach((lg: any) => { ids.add(String(lg.fromLocationId)); ids.add(String(lg.toLocationId)); }));
    const added = migrateReferencedSeeds(ids);
    migratePlaceAddresses();   // v6.99.41 (ADDR-3): places get their parts once, like the counterparties
    const dropped = pruneOrphanMigratedSeeds(ids);   // v6.99.29 (A-R19-4): and the ones nothing points at any more go
    if (dropped.length) recordAudit({ module: "System", docType: "Locations", docNumber: "PRUNE-6.99.29", action: "healed", summary: `Removed ${dropped.length} migrated demo place(s) no document references: ${dropped.map((d: any) => d.name).join(", ")}` });
    if (added.length) recordAudit({ module: "System", docType: "Locations", docNumber: "MIGRATE-6.86", action: "healed", summary: `Referenced demo locations kept as custom: ${added.map(a => a.name).join(", ")}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v6.82.0 (Round 6): packaging types saved before v6.46 lack boxesPerPallet/palletTareKg —
  // backfill from the seed by id/label so pallet tables split correctly.
  useEffect(() => {
    setPackagingTypes((prev: any[]) => {
      const next = (prev || []).map((p: any) => {
        const s = PACKAGING_SEED.find(x => x.id === p.id || x.label === p.label);
        if (!s) return p;
        const patch: any = {};
        if (!(Number(p.boxesPerPallet) > 0) && s.boxesPerPallet) patch.boxesPerPallet = s.boxesPerPallet;
        if (!(Number(p.palletTareKg) > 0) && s.palletTareKg) patch.palletTareKg = s.palletTareKg;
        return Object.keys(patch).length ? { ...p, ...patch } : p;
      });
      return JSON.stringify(next) !== JSON.stringify(prev || []) ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v6.94.0 (PO-3/4/5, owner decisions): purchase orders normalised once — retired derivation
  // fields dropped, legacy statuses → Confirmed, payment days from legacy text, directFlow synced.
  useEffect(() => {
    setPOs((prev: any[]) => {
      let changed = false;
      const next = (prev || []).map((p: any) => { const r = normalisePO(p, { orders: orders || [], directFromSOs: poDirectFromSOs }); if (r.changed) changed = true; return r.po; });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v6.99.11: pickers may ask to open the Directory ("＋ Add it in the Directory…") — never free text.
  useEffect(() => { const h = (e: any) => { setActiveModule("contacts"); try { window.sessionStorage.setItem("marianna:contactsTab", String(e?.detail?.tab || "companies")); } catch {} }; window.addEventListener("marianna:navigate", h); return () => window.removeEventListener("marianna:navigate", h); }, []);
  // v6.99.9: shipments healed once — unit kg mirrors in step with the derived figure; stale zero-amount leg-freight lines removed.
  useEffect(() => { setShipments((prev: any[]) => { let changed = false; const next = (prev || []).map((s: any) => { const r = healShipmentModel(s); if (r.changed) changed = true; return r.sh; }); return changed ? next : prev; }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // v6.99.40 (A-ADDR): every stored address is split into its parts ONCE — street · postcode · city · country.
  // What cannot be split (a market address, a PO box) keeps its whole text in the street line and is flagged for review;
  // the original one-line text stays until the DDL, so nothing that reads `address` breaks.
  useEffect(() => { _setContacts((prev: any[]) => { let changed = false;
    const next = (prev || []).map((c: any) => { const r = migrateAddressOn(c); let out = r.rec; if (r.changed) changed = true;
      if (Array.isArray(out.extraAddresses) && out.extraAddresses.length) {
        const sites = out.extraAddresses.map((s: any) => { const rec = typeof s === "string" ? { address: s } : s; const m = migrateAddressOn({ ...rec, country: rec.country || out.country }); if (m.changed) changed = true; return m.rec; });
        out = { ...out, extraAddresses: sites };
      }
      return out; });
    return changed ? next : prev; }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // v6.99.2 (CP-1/2/6/9): counterparties normalised once — roles[], terms{}, ISO country, people[], caches dropped.
  useEffect(() => { _setContacts((prev: any[]) => { let changed = false; const next = (prev || []).map((c: any) => { const r = normaliseCounterparty(c); if (r.changed) changed = true; return r.contact; }); return changed ? next : prev; }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // v6.96.0 (IN-6): counterparty addresses get a persistent siteId (today's derived id) — references never move again.
  useEffect(() => { _setContacts((prev: any[]) => { const r = stampSiteIds(prev || []); return r.changed ? r.contacts : prev; }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // v6.96.0 (IN-4): lots normalised once — mirrors dropped, consignment/direct synced from the PO, arrival derived, old per-lot settlement handed to poSettlements.
  useEffect(() => {
    const toMigrate: any[] = [];
    setLots((prev: any[]) => { let changed = false; const next = (prev || []).map((l: any) => { const po = (pos || []).find((p: any) => String(p.number) === String(l.poRef)); const r = normaliseLot(l, { po, poSettlements: poSettlements || [] }); if (r.changed) changed = true; if (r.settlementToMigrate) toMigrate.push(r.settlementToMigrate); return r.lot; }); return changed ? next : prev; });
    if (toMigrate.length) setPoSettlements((prev: any[]) => [...(prev || []), ...toMigrate.filter(s => !(prev || []).some((x: any) => String(x.poNumber) === String(s.poNumber))).map(s => ({ id: nextId(), poNumber: s.poNumber, status: s.status === "Closed" ? "Closed" : "Open", number: s.number, ratePLNperEUR: s.ratePLNperEUR, commissionPct: s.commissionPct ?? s.finalCommissionPct, closedAt: s.closedAt, notes: `Migrated from lot ${s.fromLot} (v6.96.0)` }))]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v6.97.0 (CL-7/CL-1): claims normalised once — legacy form fields folded, EUR mirrored into the one money model.
  useEffect(() => { setClaims((prev: any[]) => { let changed = false; const next = (prev || []).map((c: any) => { const r = foldLegacyClaimFields(c); if (r.changed) changed = true; return r.claim; }); return changed ? next : prev; }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v6.98.0 (IV-3/IV-5): invoices normalised once — one category, scope derived, creditNoteIds/locked dropped.
  useEffect(() => { setInvoices((prev: any[]) => { let changed = false; const next = (prev || []).map((i: any) => { const r = normaliseInvoiceCategory(i); if (r.changed) changed = true; return r.inv; }); return changed ? next : prev; }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v6.95.0 (SO-6): sales orders normalised once — mirrors and caches dropped, payment days from legacy text.
  useEffect(() => {
    setOrders((prev: any[]) => { let changed = false; const next = (prev || []).map((o: any) => { const r = normaliseSO(o); if (r.changed) changed = true; return r.so; }); return changed ? next : prev; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v6.79.0 (W-1): stored SO status is COMMERCIAL only. Typed physical statuses
  // from before derivation existed are normalised once: supported by shipments →
  // Confirmed (the derivation shows Shipped/Delivered); unsupported → a visible
  // override, never a silent fact. "Reserved" → Confirmed (status dropped).
  useEffect(() => {
    setOrders((prev: any[]) => {
      const next = (prev || []).map((o: any) => normaliseStoredSoStatus(o, shipments || []));
      return JSON.stringify(next) !== JSON.stringify(prev || []) ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v6.68.0 (D-34): SINGLE-ENTRY OVERHEAD — every register invoice with cost
  // scope OVERHEAD mirrors into exactly one operational cost (replace-by-ref
  // on source invoice:{id}); manual entries (salary, ZUS, taxes) untouched.
  // Same-reference return when clean, so no effect loop; the fold above skips
  // invoice:* sources, so the two mirrors can never chase each other.
  useEffect(() => {
    setOperationalCosts((prev: any[]) => {
      const next = syncOverheadOpCosts(invoices, prev || []);
      return JSON.stringify(next) !== JSON.stringify(prev || []) ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices]);

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
  const [openShipmentNumber, setOpenShipmentNumber] = useState("");   // v6.99.42: cross-module hand-off (PO → its supplier truck)
  const [openPO, setOpenPO] = useState<{ number: string; action: string }>({ number: "", action: "" });   // v6.99.56 (A-PL-5): shipment → the PO's packing list
  useEffect(() => { if (activeModule !== "pos" && openPO.number) setOpenPO({ number: "", action: "" }); }, [activeModule]);   // eslint-disable-line react-hooks/exhaustive-deps
  // v6.63.0 (D-13): ONE claims UI, many doors. The claim buttons in Sales Orders,
  // Shipments and Inventory no longer open their own mini-forms — they navigate
  // here with a pre-filled seed, so every claim is a numbered document in the
  // Claims module from birth.
  const [claimSeed, setClaimSeed] = useState<any>(null);
  const startClaim = (seed: any) => { setClaimSeed(seed); setActiveModule("claims"); };
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
    const res = convertSettledRefsToEvents(invoices, settledRefs, { todayISO: () => localTodayISO(), nextId });  // v6.79.0 (W-7)
    if (res.converted > 0) { setInvoices(res.invoices); setSettledRefs(res.settledRefs); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reloadFromStorage() {
    window.location.reload();
  }

  function renderActive() {
    switch (activeModule) {
      case "dashboard":
        return <Dashboard pos={live.pos} orders={live.orders} lots={live.lots} contacts={contacts} shipments={live.shipments} operationalCosts={operationalCosts} invoices={invoices} claims={claims} financeNotes={financeNotes} onNavigate={setActiveModule}  inspections={inspections} stockCounts={stockCounts} closedPeriods={closedPeriods} poSettlements={poSettlements} users={users} userName={userName} integrityIssues={integrityIssuesForDashboard} />;
      case "claims":
        return <Claims archive={archive} claims={claims} setClaims={setClaims} contacts={contacts} lots={lots} setLots={setLots} orders={orders} setOrders={setOrders} pos={pos} shipments={shipments}  financeNotes={financeNotes} setFinanceNotes={setFinanceNotes} invoices={invoices} claimSeed={claimSeed} onClaimSeedConsumed={() => setClaimSeed(null)}  setInvoices={setInvoices} inspections={inspections} />;
      case "audit":
        return <AuditTrail auditLog={auditLog} />;
      case "finance":
        return <Finance orders={orders} lots={lots} setLots={setLots} contacts={contacts} pos={pos} shipments={shipments} operationalCosts={operationalCosts} setOperationalCosts={setOperationalCosts} warehouseInvoices={warehouseInvoices} setWarehouseInvoices={setWarehouseInvoices} settledRefs={settledRefs} setSettledRefs={setSettledRefs} invoices={invoices} setInvoices={setInvoices} financeNotes={financeNotes} claims={claims}  advancePayments={advancePayments} setAdvancePayments={setAdvancePayments} bankAccounts={bankAccounts} setBankAccounts={setBankAccounts}  budgets={budgets} setBudgets={setBudgets} users={users} userName={userName}  closedPeriods={closedPeriods} setClosedPeriods={setClosedPeriods} poSettlements={poSettlements} />;
      case "contacts":
        return <Contacts contacts={contacts} setContacts={setContactsCascade} pos={pos} orders={orders} shipments={shipments} invoices={invoices} claims={claims} warehouseInvoices={warehouseInvoices}  users={users} userName={userName}  lots={lots} />;
      case "pos":
        return <PurchaseOrders key={"po-" + (openPO.number || "list")} initialSelectedNumber={openPO.number} initialAction={openPO.action} archive={archive} pos={pos} setPOs={setPOs} contacts={contacts} lots={lots} setLots={setLots} orders={orders} setOrders={setOrders} shipments={shipments} invoices={invoices} productCatalog={productCatalog} setProductCatalog={setProductCatalog}  packagingTypes={packagingTypes}  setShipments={setShipments}  claims={claims} inspections={inspections} poSettlements={poSettlements} setPoSettlements={setPoSettlements} setFinanceNotes={setFinanceNotes} setInvoices={setInvoices}  users={users} userName={userName}  onOpenShipment={(n: string) => { setOpenShipmentNumber(n); setActiveModule("shipments"); }} />;
      case "lots":
        return <Inventory archive={archive} lots={lots} setLots={setLots} allOrders={orders} contacts={contacts} shipments={shipments} setShipments={setShipments} pos={pos} invoices={invoices} setInvoices={setInvoices} financeNotes={financeNotes} setFinanceNotes={setFinanceNotes} claims={claims}  onStartClaim={startClaim}  inspections={inspections} setInspections={setInspections} stockCounts={stockCounts} setStockCounts={setStockCounts}  poSettlements={poSettlements}  />;
      case "orders":
        return <SalesOrders archive={archive} orders={orders} setOrders={setOrders} packagingTypes={packagingTypes} invLots={lots} setLots={setLots} allPOs={pos} contacts={contacts} shipments={shipments} setShipments={setShipments} operationalCosts={operationalCosts} invoices={invoices} setInvoices={setInvoices} financeNotes={financeNotes} setFinanceNotes={setFinanceNotes} userRole={userRole} userName={userName} productCatalog={productCatalog} setProductCatalog={setProductCatalog} claims={claims} setClaims={setClaims}  onStartClaim={startClaim} />;
      case "shipments":
        return <Shipments onOpenPacking={(n: string) => { setOpenPO({ number: n, action: "packing" }); setActiveModule("pos"); }} archive={archive} shipments={shipments} setShipments={setShipments} loadPlans={loadPlans} setLoadPlans={setLoadPlans} contacts={contacts} pos={pos} setPOs={setPOs} lots={lots} setLots={setLots} orders={orders} setOrders={setOrders} onNavigate={setActiveModule} packagingTypes={packagingTypes} setClaims={setClaims}  onStartClaim={startClaim}  invoices={invoices}  initialSelectedNumber={openShipmentNumber}  inspections={inspections} />;
      case "invoices":
        return <Invoices archive={archive} invoices={invoices} setInvoices={setInvoices} notes={financeNotes} setNotes={setFinanceNotes} contacts={contacts} orders={orders} pos={pos} shipments={shipments} setShipments={setShipments} setOrders={setOrders} lots={lots} operationalCosts={operationalCosts} setOperationalCosts={setOperationalCosts} warehouseInvoices={warehouseInvoices} setWarehouseInvoices={setWarehouseInvoices}  closedPeriods={closedPeriods} />;
      case "settings":
        return <Settings seasonSettings={seasonSettings} setSeasonSettings={setSeasonSettings} archivedSeasons={archivedSeasons} setArchivedSeasons={setArchivedSeasons} reloadFromStorage={reloadFromStorage} refStores={{ lots, shipments, pos, orders, contacts }} userRole={userRole} setUserRole={setUserRole} userName={userName} setUserName={setUserName} productCatalog={productCatalog} setProductCatalog={setProductCatalog} packagingTypes={packagingTypes} setPackagingTypes={setPackagingTypes} repairInventory={repairInventory}  users={users} setUsers={setUsers}   fxSettings={fxSettings} setFxSettings={setFxSettings}  company={company} setCompany={setCompany} numbering={numbering} setNumbering={setNumbering}  />;
      default:
        return null;
    }
  }


  // v6.99.4 (DA-7): the Dashboard's integrity tile reads the same check as the badge.
  const integrityIssuesForDashboard = useMemo(() => checkIntegrity({ contacts, pos, lots, orders, shipments, warehouseInvoices, operationalCosts, creditNotes, invoices, financeNotes, claims, loadPlans, advancePayments, bankAccounts, productCatalog } as any).issues, // eslint-disable-next-line react-hooks/exhaustive-deps
    [contacts, pos, lots, orders, shipments, warehouseInvoices, operationalCosts, invoices, financeNotes, claims, loadPlans, advancePayments, bankAccounts, productCatalog]);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, system-ui, sans-serif", color: "#111", background: "#FAFAFA" }}>
      <TopNav active={activeModule} onNav={setActiveModule} canOpen={(k: string) => canOpenModule(users, userName, k === "loadPlans" ? "loadplans" : k)} rightSlot={
        <><label title="v6.99.54 (AR-4): archived seasons stay in the file; this shows them" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#64748B", marginRight: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={includeArchived} onChange={e => setIncludeArchived(e.target.checked)} /> include archived{archivedSeasons.length ? ` (${archivedSeasons.join(", ")})` : ""}
        </label>
        <IntegrityBadge
          data={{ contacts, pos: live.pos, lots: live.lots, orders: live.orders, shipments: live.shipments, warehouseInvoices, operationalCosts, creditNotes, invoices, financeNotes, claims, loadPlans, advancePayments, bankAccounts, productCatalog }}
          onNavigate={setActiveModule}
          onRepair={(kind: "orphanLots" | "danglingLinks") => {   // v6.99.51 (A-FS-2)
            if (kind === "orphanLots") { const ol = orphanLotsToRemove(lots, pos); if (!ol.length || !window.confirm(`Remove ${ol.length} orphan lot(s)? Their PO no longer exists and they hold no stock.`)) return; const ids = new Set(ol.map((l: any) => l.id)); setLots((prev: any[]) => (prev || []).filter((l: any) => !ids.has(l.id))); recordAudit({ module: "System", docType: "Repair", docNumber: "ORPHAN-LOTS", action: "deleted", summary: `${ol.length} orphan lot(s) removed: ${ol.map((l: any) => l.number).join(", ")}` }); }
            if (kind === "danglingLinks") { const dl = danglingLinks(invoices, claims, pos, orders, shipments); const n = dl.invoices.length + dl.claims.length; if (!n || !window.confirm(`Unlink ${dl.invoices.length} invoice(s) and ${dl.claims.length} claim(s) from documents that no longer exist?`)) return;
              const bad = new Map<string, Set<string>>(dl.invoices.map(x => [String(x.id), new Set<string>(x.links.map((l: any) => l.type + ":" + l.number))]));
              setInvoices((prev: any[]) => (prev || []).map((i: any) => bad.has(String(i.id)) ? { ...i, links: (i.links || []).filter((l: any) => !bad.get(String(i.id))!.has(l.type + ":" + l.number)) } : i));
              const badC = new Map<string, Set<string>>(dl.claims.map(x => [String(x.id), new Set<string>(x.subjects.map((s: any) => s.kind + ":" + s.ref))]));
              setClaims((prev: any[]) => (prev || []).map((c: any) => badC.has(String(c.id)) ? { ...c, subjects: (c.subjects || []).filter((s: any) => !badC.get(String(c.id))!.has(s.kind + ":" + s.ref)) } : c));
              recordAudit({ module: "System", docType: "Repair", docNumber: "DANGLING-LINKS", action: "updated", summary: `${dl.invoices.length} invoice(s) and ${dl.claims.length} claim(s) unlinked from deleted documents` }); }
          }}
        /></>
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
