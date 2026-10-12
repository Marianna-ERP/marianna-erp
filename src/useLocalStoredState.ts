// ─── Local-storage-backed React state hook ──────────────────────────────────
//
// Drop-in replacement for useState. Reads initial value from localStorage if
// available, otherwise uses the provided default. Writes through to localStorage
// on every change.
//
// Versioning:
//   The key is namespaced as "marianna-erp:v{N}:{name}". If we change the data
//   shape in a breaking way, bump STORAGE_VERSION below and old keys will be
//   ignored automatically. Users get the fresh seed.
//
// Safety:
//   - localStorage may throw (quota exceeded, private browsing). All access is
//     wrapped in try/catch and falls back gracefully to in-memory state.
//   - Corrupt JSON in storage is ignored — initial value used instead.
//   - SSR-safe (won't crash if `window` is undefined).

import { useState, useEffect } from "react";
import { APP_VERSION } from "./version";
import { addressWithCountry } from "./counterparty.domain";   // v7.19.6 (A-TD-5)

export const STORAGE_VERSION = 2; // v6.37.0: flow-model retirement (migration 2)
// v6.99.70 (A-BK-3): the planning budget of the browser store, in characters — the same conservative figure the Settings
// gauge always used (5 MB at 2 bytes per character). The local ring is sized against it, so the two can never disagree.
/** v7.21.0 (A-RV-19, owner ruling B 8 Oct): the single-browser mode and its local snapshot ring are gone — the snapshots an
 *  older build left in this browser are removed once, so they stop taking the room the shared data's cache needs. */
export function dropLegacySnapshots(): number {
  if (typeof window === "undefined" || !window.localStorage) return 0;
  const ls = window.localStorage; const gone: string[] = [];
  for (let i = 0; i < ls.length; i++) { const k = ls.key(i) || ""; if (k === `${NAMESPACE}:backups` || k.startsWith(`${NAMESPACE}:backup:`)) gone.push(k); }
  gone.forEach(k => { try { ls.removeItem(k); } catch { /* best effort */ } });
  return gone.length;
}
export const STORAGE_BUDGET_CHARS = 5 * 1024 * 1024 / 2;
const NAMESPACE = "marianna-erp";

function storageKey(name: string): string {
  return `${NAMESPACE}:v${STORAGE_VERSION}:${name}`;
}
// v6.38.0: exported so side-stores (locations.ts) always address the CURRENT
// version's keys instead of hardcoding "v1" — the bug that made post-migration
// Settings edits land in the stale safety copy.
export function dataKey(name: string): string { return storageKey(name); }

function readFromStorage<T>(name: string, fallback: T): T {
  if (typeof window === "undefined" || !window.localStorage) return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey(name));
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    // Bad JSON, quota issue, or storage disabled. Fall back to seed silently.
    console.warn(`[localStorage] Could not read "${name}":`, err);
    return fallback;
  }
}

// ── Storage health (Batch 5 opening slice) ──────────────────────────────────
// A failed write (quota full, storage disabled) must NOT be silent: the user
// could keep working for an hour with nothing persisting. Any write failure
// flips a global flag that App surfaces as a persistent warning banner.
export const storageHealth: { failing: boolean; lastError: string; failedKey: string; failedAt: string; listeners: Array<() => void> } = {
  failing: false, lastError: "", failedKey: "", failedAt: "", listeners: [],
};
function notifyHealth() { storageHealth.listeners.forEach(fn => { try { fn(); } catch {} }); }

export function readStoreValue(name: string): any { return readFromStorage(name, []); }
export function writeStoreValue(name: string, value: any): void { writeToStorage(name, value); }
/** v7.3.3 (A-SYNC-1): a shared store written OUTSIDE a React hook (places, the report register…) must reach the shared data too —
 *  before, these writes stayed in the one browser and the next reload pulled the older shared copy over them. */
export function writeSharedStoreValue(name: string, value: any): void {
  writeToStorage(name, value);
  if (onStoreWritten) { try { onStoreWritten(name, JSON.stringify(value)); } catch { /* best effort */ } }
}
function markWriteFailing(name: string, err: any): void {
  console.warn(`[localStorage] Could not write "${name}":`, err);
  storageHealth.failing = true;
  storageHealth.lastError = String(err?.message || err);
  storageHealth.failedKey = name;
  storageHealth.failedAt = new Date().toISOString();
  notifyHealth();
}
function writeToStorage<T>(name: string, value: T): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  let json: string;
  try { json = JSON.stringify(value); } catch (err: any) { markWriteFailing(name, err); return; }
  // v7.21.0 (A-RV-19): no local snapshots any more, so nothing gives way — a save that does not fit fails and the red banner says so
  try { window.localStorage.setItem(storageKey(name), json); }
  catch (err: any) { markWriteFailing(name, err); return; }
  if (storageHealth.failing) { storageHealth.failing = false; storageHealth.lastError = ""; notifyHealth(); }
}

/** Subscribe-to-health hook for the App banner. */
export function useStorageHealth(): { failing: boolean; lastError: string; failedKey: string } {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force(x => x + 1);
    storageHealth.listeners.push(fn);
    return () => { const i = storageHealth.listeners.indexOf(fn); if (i >= 0) storageHealth.listeners.splice(i, 1); };
  }, []);
  return { failing: storageHealth.failing, lastError: storageHealth.lastError, failedKey: storageHealth.failedKey };
}

// ── Storage usage (Settings panel) ───────────────────────────────────────────
export function storageUsage(): { perKey: Array<{ key: string; kb: number }>; totalKB: number; budgetKB: number; pct: number } {
  const perKey: Array<{ key: string; kb: number }> = [];
  let total = 0;
  if (typeof window !== "undefined" && window.localStorage) {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(NAMESPACE + ":")) continue;
      const v = window.localStorage.getItem(k) || "";
      const kb = Math.round(((k.length + v.length) * 2) / 1024); // UTF-16 ≈ 2 bytes/char
      perKey.push({ key: k.replace(`${NAMESPACE}:v${STORAGE_VERSION}:`, ""), kb });
      total += kb;
    }
  }
  perKey.sort((a, b) => b.kb - a.kb);
  const budgetKB = Math.round((STORAGE_BUDGET_CHARS * 2) / 1024); // conservative common browser budget (v6.99.70: one constant)
  return { perKey, totalKB: total, budgetKB, pct: Math.min(100, Math.round((total / budgetKB) * 100)) };
}

// v6.99.148 (AUD-01/03, the shared store): the hook keeps working on this browser's storage exactly as before; two small doors
// let the shared store in — applyStoreFromRemote(name, value) sets a store from the shared copy, and onStoreWritten is told of
// every local write so the shared copy can follow. Without the shared store configured, neither is ever used.
const storeSetters = new Map<string, (v: any) => void>();
export let onStoreWritten: ((name: string, json: string) => void) | null = null;
export function setStoreWrittenHook(fn: ((name: string, json: string) => void) | null) { onStoreWritten = fn; }
export function applyStoreFromRemote(name: string, value: any): boolean { const set = storeSetters.get(name); if (!set) { writeToStorage(name, value); return false; } set(value); return true; }
export function useLocalStoredState<T>(name: string, initialValue: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => readFromStorage(name, initialValue));
  useEffect(() => { storeSetters.set(name, setState as any); return () => { storeSetters.delete(name); }; }, [name]);
  useEffect(() => {
    writeToStorage(name, state);
    if (onStoreWritten) { try { onStoreWritten(name, JSON.stringify(state)); } catch { /* the shared copy is best effort */ } }
  }, [name, state]);
  return [state, setState];
}

// ─── Bulk helpers — used by the Settings module ─────────────────────────────

// Single source of truth for which stores are real DATA (shared via export/import
// and wiped by reset). Per-user preferences (userName, dismissed
// banners) are deliberately NOT here — sharing a file shouldn't overwrite a
// colleague's name/role. v6.17: creditNotes + logisticsPoints were missing, so
// shared files silently dropped them — now included.
export const DATA_KEYS = [
  "roles",   // v7.5.0 (A-ROLE-1): the business's roles and their rights — shared
  "heals",   // v6.99.145 (AUD-46): which one-time heals this DATASET has had — travels with the data, so an older file imported here is healed again
  "contacts", "pos", "lots", "orders", "shipments", "operationalCosts",
  "customLocations", "warehouseInvoices", "settledRefs", "creditNotes", // v6.18.1: the Invoicing module's stores were missing — without these, invoices
  // and credit/debit notes were dropped from shared JSON files, auto-backups and
  // reset. They are real data and must travel with everything else.
  "invoices", "financeNotes",
  // v6.18.16: the controlled Item/Variety product catalog.
  "productCatalog",
  // v6.44.0 (test-round #7): packaging types (box capacity + tare) for gross weight.
  "packagingTypes",
  // v6.48.0: claims are their own document now (were nested in lot.claims[]).
  "claims",
  // v6.56.0: load plans — real data, must travel with export/import and backup.
  // v6.69.0: advance payments (v6.68.0 F-1) and the bank accounts registry
  // (v6.68.0 F-4) were declared in App but NEVER REGISTERED HERE — so every
  // export, auto-backup and import silently dropped them, exactly as happened
  // to creditNotes/logisticsPoints in v6.17 and invoices/financeNotes in
  // v6.18.1. Adding a store without adding it here is now a THIRD occurrence of
  // the same trap; see the export-completeness test in tests/run-engines.cjs,
  // which fails if a store is declared in App and missing from this list.
  "advancePayments", "bankAccounts",
  // v6.79.0 (F-5/F-6): users & permissions; monthly budgets.
  "users", "budgets",
  // v6.89.0: inspections, stock counts, defect catalogue.
  "inspections", "stockCounts", "defectCatalogue",
  // v6.90.0: settlements per PO.
  "poSettlements",
  // v6.99.0: closed periods (FN-1) and FX settings (FN-7). settledRefs is DEPRECATED (FN-8) — kept importable only.
  "closedPeriods", "fxSettings",
  // v6.99.3: company settings, numbering prefixes.
  "company", "numbering", "defectTolerances", "reportRegister", "archivedSeasons", "seasonSettings", "planningSheets", "planningSheetLog",
  "auditLog", "auditArchive"];   // v7.17.4 (A-RV-12): the audit entries past the cap

/** The "Export all data" file. v6.99.70 (A-BK-2): the automatic folder backup writes exactly this (pretty); the local
 *  ring stores the same content compact (`pretty = false`), about a third smaller. Import reads either. */
export function exportAllData(pretty: boolean = true): string {
  const data: any = {
    _meta: {
      app: "marianna-erp",
      version: STORAGE_VERSION,
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
    },
  };
  for (const key of DATA_KEYS) {
    const v = readFromStorage(key, null);
    // v6.79.0 (W-10): creditNotes is a DEPRECATED store (folded into financeNotes on load).
    // It stays importable so old backups still fold, but an empty one is not exported.
    if (key === "creditNotes" && Array.isArray(v) && v.length === 0) continue;
    data[key] = v;
  }
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}

// ── v6.99.51 (A-FS-1, owner 23 Sept): START A FRESH SEASON — the master data stays, everything transactional goes TOGETHER ──
// The only wipe was "clear ALL data" (contacts included), so the season was reset by deleting documents one by one,
// which left lots, invoices and claims pointing at documents that no longer existed. One action, one moment, nothing dependent survives.
export const MASTER_KEYS = ["contacts", "customLocations", "productCatalog", "packagingTypes", "users", "fxSettings", "company", "numbering", "bankAccounts", "defectCatalogue", "defectTolerances", "budgets", "archivedSeasons", "seasonSettings"];
export const TRANSACTIONAL_KEYS = DATA_KEYS.filter(k => !MASTER_KEYS.includes(k));
export function transactionalCounts(): Array<{ key: string; count: number }> {
  if (typeof window === "undefined" || !window.localStorage) return [];
  return TRANSACTIONAL_KEYS.map(key => { let count = 0; try { const raw = window.localStorage.getItem(storageKey(key)); const v = raw ? JSON.parse(raw) : null; count = Array.isArray(v) ? v.length : (v && typeof v === "object" ? Object.keys(v).length : 0); } catch { count = 0; } return { key, count }; }).filter(x => x.count > 0);
}
export function startFreshSeason(opts: { resetNumbering?: boolean } = {}): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  for (const key of TRANSACTIONAL_KEYS) { try { window.localStorage.removeItem(storageKey(key)); } catch (err) { console.warn(`[localStorage] Could not clear "${key}":`, err); } }
  // the report register and the audit log are transactional too, but they live under their own keys
  for (const extra of ["reportRegister", "traceRegister"]) { try { window.localStorage.removeItem(storageKey(extra)); } catch {} }
  if (opts.resetNumbering) { try { window.localStorage.removeItem(storageKey("numbering")); } catch {} }
}

export function clearAllData(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  for (const key of DATA_KEYS) {
    try {
      window.localStorage.removeItem(storageKey(key));
    } catch (err) {
      console.warn(`[localStorage] Could not clear "${key}":`, err);
    }
  }
}

// ── v6.99.67 (A-AUD-1, owner): ONE company profile. Five documents carried their own literal company block — a copy of
// master data — so a change in Settings never reached them. They read this instead; the literal values are the fallback
// for a field Settings has not filled yet, so nothing printed changes until the owner changes it in Settings.
export const COMPANY_DEFAULTS = { name: "MARIANNA", person: "Hazem Osman", address: "ul. Długa 29,\n00-238 Warszawa\nPolska", country: "Poland", nip: "PL525-284-27-87", regon: "387501311", phone: "", email: "", emergencyPhone: "+48 784 775 065" };
/** The transport order's letterhead used a longer trade name and a two-line address; it derives from the profile the same way. */
/** v7.19.6 (A-TD-5): the company's address lines as printed — the country follows when the address does not already name it. */
export function companyAddressLines(p: any = companyProfile()): string[] { return addressWithCountry(p?.address, p?.country); }
export function companyForTransportOrder(): { name: string; address1: string; address2: string; nip: string; emergencyPhone: string } {
  const p = companyProfile(); const lines = companyAddressLines(p);   // v7.19.6 (A-TD-5)
  return { name: p.tradeName || (p.name === COMPANY_DEFAULTS.name ? "MARIANNA HAZEM OSMAN" : p.name), address1: lines[0]?.replace(/,$/, "") === "ul. Długa 29" ? "ul. Dluga 29" : (lines[0] || "").replace(/,$/, ""), address2: lines.length > 1 ? lines.slice(1).join(" - ") : "", nip: p.nip === COMPANY_DEFAULTS.nip ? "PL 525-284-27-87" : p.nip, emergencyPhone: p.emergencyPhone || p.phone || "" };
}
export function companyProfile(): typeof COMPANY_DEFAULTS & Record<string, any> {
  let stored: any = {}; try { stored = readFromStorage("company", {}) || {}; } catch { stored = {}; }
  const out: any = { ...COMPANY_DEFAULTS };
  Object.keys(stored).forEach(k => { const v = stored[k]; if (v !== undefined && v !== null && String(v).trim() !== "") out[k] = v; });
  return out;
}
