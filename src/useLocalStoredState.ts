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

export const STORAGE_VERSION = 1;
const NAMESPACE = "marianna-erp";

function storageKey(name: string): string {
  return `${NAMESPACE}:v${STORAGE_VERSION}:${name}`;
}

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

function writeToStorage<T>(name: string, value: T): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(storageKey(name), JSON.stringify(value));
  } catch (err) {
    console.warn(`[localStorage] Could not write "${name}":`, err);
  }
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
];

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
