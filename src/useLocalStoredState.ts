import { migrateFlowCleanup } from "./flowCleanup.migration";
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
import { planRingPrune, isQuotaError } from "./autoBackup.domain";

export const STORAGE_VERSION = 2; // v6.37.0: flow-model retirement (migration 2)
// v6.99.70 (A-BK-3): the planning budget of the browser store, in characters — the same conservative figure the Settings
// gauge always used (5 MB at 2 bytes per character). The local ring is sized against it, so the two can never disagree.
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
  // v6.99.70 (A-BK-3, owner): THE DATA ALWAYS WINS. When the browser store is full, the oldest local snapshot gives way
  // and the save is tried again; the save fails (and the red banner says so) only when no snapshot is left to give way.
  // Before, a full store failed the save while every old snapshot stayed.
  let dropped = 0;
  for (;;) {
    try { window.localStorage.setItem(storageKey(name), json); break; }
    catch (err: any) {
      if (isQuotaError(err) && dropOldestBackup()) { dropped++; continue; }
      markWriteFailing(name, err); return;
    }
  }
  if (dropped) console.info(`[storage] ${dropped} local snapshot(s) gave way so "${name}" could be saved.`);
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

// ── Migration runner (skeleton — Batch 5) ────────────────────────────────────
// The old strategy on STORAGE_VERSION bump was "ignore old keys, fresh seed",
// which silently ABANDONS user data. From now on a bump runs migrations:
// each entry upgrades all stores from version N-1 to N. On app load, if the
// current-version keys are absent but an older version's exist, we migrate
// forward and keep the old keys untouched as a safety copy.
export const MIGRATIONS: Record<number, (all: Record<string, any>) => Record<string, any>> = {
  // v6.37.0: retire the legacy flow model from stored data (backfill incoterms,
  // bake template journeys for never-shipped legacy lots, drop the flow key).
  2: migrateFlowCleanup,
};

export function runMigrationsIfNeeded(): { migrated: boolean; from?: number } {
  if (typeof window === "undefined" || !window.localStorage) return { migrated: false };
  try {
    const probe = window.localStorage.getItem(storageKey(DATA_KEYS[0]));
    if (probe !== null) return { migrated: false }; // current version already populated
    for (let v = STORAGE_VERSION - 1; v >= 1; v--) {
      const oldKey = `${NAMESPACE}:v${v}:${DATA_KEYS[0]}`;
      if (window.localStorage.getItem(oldKey) === null) continue;
      let all: Record<string, any> = {};
      DATA_KEYS.forEach(k => {
        const raw = window.localStorage.getItem(`${NAMESPACE}:v${v}:${k}`);
        if (raw !== null) { try { all[k] = JSON.parse(raw); } catch {} }
      });
      for (let step = v + 1; step <= STORAGE_VERSION; step++) {
        const fn = MIGRATIONS[step];
        if (fn) all = fn(all);
      }
      Object.entries(all).forEach(([k, val]) => writeToStorage(k, val));
      console.info(`[storage] Migrated data v${v} → v${STORAGE_VERSION} (old keys kept as safety copy).`);
      return { migrated: true, from: v };
    }
  } catch (err) { console.warn("[storage] Migration check failed:", err); }
  return { migrated: false };
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
// and wiped by reset). Per-user preferences (userRole, userName, dismissed
// banners) are deliberately NOT here — sharing a file shouldn't overwrite a
// colleague's name/role. v6.17: creditNotes + logisticsPoints were missing, so
// shared files silently dropped them — now included.
export const DATA_KEYS = [
  "heals",   // v6.99.145 (AUD-46): which one-time heals this DATASET has had — travels with the data, so an older file imported here is healed again
  "contacts", "pos", "lots", "orders", "shipments", "operationalCosts",
  "customLocations", "warehouseInvoices", "settledRefs", "creditNotes", "logisticsPoints",
  // v6.18.1: the Invoicing module's stores were missing — without these, invoices
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
  "loadPlans",
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
  "auditLog"];

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

// ─── Local backup ring (v6.17) ──────────────────────────────────────────────
// A rolling set of full snapshots kept in localStorage so an overwriting import,
// a reset, or a bad edit is recoverable. Backup keys are NOT version-namespaced,
// so they survive a future STORAGE_VERSION bump. Best-effort: if storage is full
// we prune oldest and retry, and every path is wrapped so a backup failure never
// blocks the user's action.

export interface BackupMeta { id: string; label: string; createdAt: string; version: number; sizeKB: number; }

const BACKUP_INDEX_KEY = `${NAMESPACE}:backups`;
const backupSnapKey = (id: string) => `${NAMESPACE}:backup:${id}`;
// v6.99.70 (A-BK-3, owner): the ring is limited by SPACE, not by a count of 8. On the 25 Sept file one snapshot was 1.2 million
// characters — so "the last 8" were really 1 to 3, sharing the store with the live data. Snapshots are now stored compact and
// kept while the whole store stays under 70 % of its budget (planRingPrune); the newest is always kept.
function snapshotChars(id: string): number { try { return (window.localStorage.getItem(backupSnapKey(id)) || "").length; } catch { return 0; } }
/** Characters used by everything of ours EXCEPT the snapshots — the live data, preferences, counters. */
function liveChars(): number {
  let total = 0;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(NAMESPACE + ":") || k.startsWith(`${NAMESPACE}:backup:`) || k === BACKUP_INDEX_KEY) continue;
      total += k.length + (window.localStorage.getItem(k) || "").length;
    }
  } catch { /* best effort */ }
  return total;
}
/** Drop the oldest snapshot (used when the live data needs the space). False when there is none left. */
function dropOldestBackup(): boolean {
  const index = readBackupIndex();
  if (!index.length) return false;
  const oldest = index.shift()!;
  try { window.localStorage.removeItem(backupSnapKey(oldest.id)); } catch {}
  writeBackupIndex(index);
  return true;
}

function readBackupIndex(): BackupMeta[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try { const raw = window.localStorage.getItem(BACKUP_INDEX_KEY); return raw ? (JSON.parse(raw) as BackupMeta[]) : []; }
  catch { return []; }
}
function writeBackupIndex(list: BackupMeta[]): void {
  try { window.localStorage.setItem(BACKUP_INDEX_KEY, JSON.stringify(list)); }
  catch (err) { console.warn("[backup] index write failed:", err); }
}

// v7.2.5 (A-SET-5, owner 6 Oct): on the shared data the browser takes NO local snapshots — the folder backup and the restore's own
// download keep the copies, and the browser's room is kept for the data. App switches this off when the shared data is on.
let snapshotsOn = true;
export function setLocalSnapshots(on: boolean) { snapshotsOn = !!on; }
export function createBackup(label: string): BackupMeta | null {
  if (!snapshotsOn) return null;
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const json = exportAllData(false);   // v6.99.70 (A-BK-3): compact — same content, about a third smaller
    const id = String(Date.now());
    const index = readBackupIndex();
    const tryWrite = () => window.localStorage.setItem(backupSnapKey(id), json);
    try { tryWrite(); }
    catch (err) {
      // Quota — drop oldest snapshots and retry until it fits or none remain.
      let wrote = false;
      while (index.length) {
        const oldest = index.shift()!;
        try { window.localStorage.removeItem(backupSnapKey(oldest.id)); } catch {}
        try { tryWrite(); wrote = true; break; } catch {}
      }
      if (!wrote) { writeBackupIndex(index); return null; }
    }
    const meta: BackupMeta = { id, label: label || "Backup", createdAt: new Date().toISOString(), version: STORAGE_VERSION, sizeKB: Math.max(1, Math.round(json.length / 1024)) };
    index.push(meta);
    const drop = planRingPrune(index.map(b => ({ id: b.id, chars: snapshotChars(b.id) })), liveChars(), STORAGE_BUDGET_CHARS);
    drop.forEach(oldId => { try { window.localStorage.removeItem(backupSnapKey(oldId)); } catch {} });
    writeBackupIndex(index.filter(b => !drop.includes(b.id)));
    return meta;
  } catch (err) {
    console.warn("[backup] createBackup failed:", err);
    return null;
  }
}

/** v6.99.70 (A-BK-3): snapshots written by earlier builds were pretty-printed; rewrite them compact once, on opening.
 *  Nothing is dropped here — the space limit applies when the next snapshot is taken. Returns how many were rewritten. */
export function compactLocalBackups(): number {
  if (typeof window === "undefined" || !window.localStorage) return 0;
  const index = readBackupIndex(); let n = 0;
  index.forEach(b => {
    try {
      const raw = window.localStorage.getItem(backupSnapKey(b.id));
      if (!raw || raw.indexOf("\n") < 0) return;   // compact JSON never holds a raw line break
      const compact = JSON.stringify(JSON.parse(raw));
      window.localStorage.setItem(backupSnapKey(b.id), compact);
      b.sizeKB = Math.max(1, Math.round(compact.length / 1024)); n++;
    } catch { /* leave it as it was */ }
  });
  if (n) writeBackupIndex(index);
  return n;
}

export function listBackups(): BackupMeta[] {
  return readBackupIndex().slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getBackupJSON(id: string): string | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try { return window.localStorage.getItem(backupSnapKey(id)); }
  catch { return null; }
}

export function deleteBackup(id: string): void {
  try { window.localStorage.removeItem(backupSnapKey(id)); } catch {}
  writeBackupIndex(readBackupIndex().filter(b => b.id !== id));
}

export function restoreBackup(id: string): { ok: boolean; error?: string; loaded?: string[]; backup?: BackupMeta | null } {
  const json = getBackupJSON(id);
  if (!json) return { ok: false, error: "Backup snapshot not found." };
  // Snapshot the present state first, then restore without double-backing-up.
  createBackup("Auto — before restore");
  return importAllData(json, { autoBackup: false });
}

export function importAllData(jsonString: string, opts: { autoBackup?: boolean } = {}): { ok: boolean; error?: string; loaded?: string[]; cleared?: string[]; backup?: BackupMeta | null } {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    return { ok: false, error: "File is not valid JSON. " + (err instanceof Error ? err.message : String(err)) };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "File does not contain an object." };
  }
  if (!parsed._meta || parsed._meta.app !== "marianna-erp") {
    return { ok: false, error: "File is not a MARIANNA ERP export (missing _meta.app marker)." };
  }
  if (parsed._meta.version !== STORAGE_VERSION) {
    return { ok: false, error: `This file was made on schema v${parsed._meta.version}, but this app uses v${STORAGE_VERSION}. Everyone must be on the same app build to share files — update to the same version, then try again.` };
  }
  // Safety net: snapshot current data BEFORE overwriting it.
  let backup: BackupMeta | null = null;
  if (opts.autoBackup !== false) backup = createBackup("Auto — before import");
  const loaded: string[] = [];
  const cleared: string[] = [];
  for (const key of DATA_KEYS) {
    if (parsed[key] !== undefined && parsed[key] !== null) {
      writeToStorage(key, parsed[key]);
      loaded.push(key);
    } else if (TRANSACTIONAL_KEYS.includes(key)) {
      // v6.99.51 (A-FS-3, owner): a file is a WHOLE snapshot. A transactional store absent from the file used to be LEFT AS IT WAS,
      // silently mixing two generations of data — lots from one export pointing at POs from another (the 40 orphan lots).
      // Now the absent store is cleared with the import; master stores (contacts, places, catalogue…) are kept and reported.
      try { const had = window.localStorage.getItem(storageKey(key)); if (had) { window.localStorage.removeItem(storageKey(key)); cleared.push(key); } } catch {}
    }
  }
  return { ok: true, loaded, cleared, backup };
}

// ── v6.99.51 (A-FS-1, owner 23 Sept): START A FRESH SEASON — the master data stays, everything transactional goes TOGETHER ──
// The only wipe was "clear ALL data" (contacts included), so the season was reset by deleting documents one by one,
// which left lots, invoices and claims pointing at documents that no longer existed. One action, one moment, nothing dependent survives.
export const MASTER_KEYS = ["contacts", "customLocations", "logisticsPoints", "productCatalog", "packagingTypes", "users", "fxSettings", "company", "numbering", "bankAccounts", "defectCatalogue", "defectTolerances", "budgets", "archivedSeasons", "seasonSettings"];
export const TRANSACTIONAL_KEYS = DATA_KEYS.filter(k => !MASTER_KEYS.includes(k));
export function transactionalCounts(): Array<{ key: string; count: number }> {
  if (typeof window === "undefined" || !window.localStorage) return [];
  return TRANSACTIONAL_KEYS.map(key => { let count = 0; try { const raw = window.localStorage.getItem(storageKey(key)); const v = raw ? JSON.parse(raw) : null; count = Array.isArray(v) ? v.length : (v && typeof v === "object" ? Object.keys(v).length : 0); } catch { count = 0; } return { key, count }; }).filter(x => x.count > 0);
}
export function startFreshSeason(opts: { autoBackup?: boolean; resetNumbering?: boolean } = {}): BackupMeta | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  const backup = opts.autoBackup !== false ? createBackup("Auto — before starting a fresh season") : null;
  for (const key of TRANSACTIONAL_KEYS) { try { window.localStorage.removeItem(storageKey(key)); } catch (err) { console.warn(`[localStorage] Could not clear "${key}":`, err); } }
  // the report register and the audit log are transactional too, but they live under their own keys
  for (const extra of ["reportRegister", "traceRegister"]) { try { window.localStorage.removeItem(storageKey(extra)); } catch {} }
  if (opts.resetNumbering) { try { window.localStorage.removeItem(storageKey("numbering")); } catch {} }
  return backup;
}

export function clearAllData(opts: { autoBackup?: boolean } = {}): BackupMeta | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  const backup = opts.autoBackup !== false ? createBackup("Auto — before reset") : null;
  for (const key of DATA_KEYS) {
    try {
      window.localStorage.removeItem(storageKey(key));
    } catch (err) {
      console.warn(`[localStorage] Could not clear "${key}":`, err);
    }
  }
  return backup;
}

// ── v6.99.67 (A-AUD-1, owner): ONE company profile. Five documents carried their own literal company block — a copy of
// master data — so a change in Settings never reached them. They read this instead; the literal values are the fallback
// for a field Settings has not filled yet, so nothing printed changes until the owner changes it in Settings.
export const COMPANY_DEFAULTS = { name: "MARIANNA", person: "Hazem Osman", address: "ul. Długa 29,\n00-238 Warszawa\nPolska", nip: "PL525-284-27-87", regon: "387501311", phone: "", email: "", emergencyPhone: "+48 784 775 065" };
/** The transport order's letterhead used a longer trade name and a two-line address; it derives from the profile the same way. */
export function companyForTransportOrder(): { name: string; address1: string; address2: string; nip: string; emergencyPhone: string } {
  const p = companyProfile(); const lines = String(p.address || "").split(/\n/).map((s: string) => s.trim()).filter(Boolean);
  return { name: p.tradeName || (p.name === COMPANY_DEFAULTS.name ? "MARIANNA HAZEM OSMAN" : p.name), address1: lines[0]?.replace(/,$/, "") === "ul. Długa 29" ? "ul. Dluga 29" : (lines[0] || "").replace(/,$/, ""), address2: lines.length > 1 ? lines.slice(1).join(" - ") : "", nip: p.nip === COMPANY_DEFAULTS.nip ? "PL 525-284-27-87" : p.nip, emergencyPhone: p.emergencyPhone || p.phone || "" };
}
export function companyProfile(): typeof COMPANY_DEFAULTS & Record<string, any> {
  let stored: any = {}; try { stored = readFromStorage("company", {}) || {}; } catch { stored = {}; }
  const out: any = { ...COMPANY_DEFAULTS };
  Object.keys(stored).forEach(k => { const v = stored[k]; if (v !== undefined && v !== null && String(v).trim() !== "") out[k] = v; });
  return out;
}
