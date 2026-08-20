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

export const STORAGE_VERSION = 2; // v6.37.0: flow-model retirement (migration 2)
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

function writeToStorage<T>(name: string, value: T): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(storageKey(name), JSON.stringify(value));
    if (storageHealth.failing) { storageHealth.failing = false; storageHealth.lastError = ""; notifyHealth(); }
  } catch (err: any) {
    console.warn(`[localStorage] Could not write "${name}":`, err);
    storageHealth.failing = true;
    storageHealth.lastError = String(err?.message || err);
    storageHealth.failedKey = name;
    storageHealth.failedAt = new Date().toISOString();
    notifyHealth();
  }
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
  const budgetKB = 5 * 1024; // conservative common browser budget
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

export function useLocalStoredState<T>(name: string, initialValue: T): [T, (v: T | ((prev: T) => T)) => void] {
  // Read once on mount; thereafter state is the source of truth and we write through.
  const [state, setState] = useState<T>(() => readFromStorage(name, initialValue));

  // Persist both the first seed load and all later edits. This makes Settings -> Export
  // useful even before the user has changed anything in the current browser.
  useEffect(() => {
    writeToStorage(name, state);
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
 "auditLog"];

export function exportAllData(): string {
  const data: any = {
    _meta: {
      app: "marianna-erp",
      version: STORAGE_VERSION,
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
    },
  };
  for (const key of DATA_KEYS) {
    data[key] = readFromStorage(key, null);
  }
  return JSON.stringify(data, null, 2);
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
const MAX_BACKUPS = 8;

function readBackupIndex(): BackupMeta[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try { const raw = window.localStorage.getItem(BACKUP_INDEX_KEY); return raw ? (JSON.parse(raw) as BackupMeta[]) : []; }
  catch { return []; }
}
function writeBackupIndex(list: BackupMeta[]): void {
  try { window.localStorage.setItem(BACKUP_INDEX_KEY, JSON.stringify(list)); }
  catch (err) { console.warn("[backup] index write failed:", err); }
}

export function createBackup(label: string): BackupMeta | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const json = exportAllData();
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
    while (index.length > MAX_BACKUPS) {
      const oldest = index.shift()!;
      try { window.localStorage.removeItem(backupSnapKey(oldest.id)); } catch {}
    }
    writeBackupIndex(index);
    return meta;
  } catch (err) {
    console.warn("[backup] createBackup failed:", err);
    return null;
  }
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

export function importAllData(jsonString: string, opts: { autoBackup?: boolean } = {}): { ok: boolean; error?: string; loaded?: string[]; backup?: BackupMeta | null } {
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
  for (const key of DATA_KEYS) {
    if (parsed[key] !== undefined && parsed[key] !== null) {
      writeToStorage(key, parsed[key]);
      loaded.push(key);
    }
  }
  return { ok: true, loaded, backup };
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
