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

export function exportAllData(): string {
  const keys = ["contacts", "pos", "lots", "orders", "shipments"];
  const data: any = {
    _meta: {
      app: "marianna-erp",
      version: STORAGE_VERSION,
      exportedAt: new Date().toISOString(),
    },
  };
  for (const key of keys) {
    data[key] = readFromStorage(key, null);
  }
  return JSON.stringify(data, null, 2);
}

export function importAllData(jsonString: string): { ok: boolean; error?: string; loaded?: string[] } {
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
    return { ok: false, error: `Export was made on schema v${parsed._meta.version}, but this app uses v${STORAGE_VERSION}. Migration not yet supported.` };
  }
  const loaded: string[] = [];
  const keys = ["contacts", "pos", "lots", "orders", "shipments"];
  for (const key of keys) {
    if (parsed[key] !== undefined && parsed[key] !== null) {
      writeToStorage(key, parsed[key]);
      loaded.push(key);
    }
  }
  return { ok: true, loaded };
}

export function clearAllData(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const keys = ["contacts", "pos", "lots", "orders", "shipments"];
  for (const key of keys) {
    try {
      window.localStorage.removeItem(storageKey(key));
    } catch (err) {
      console.warn(`[localStorage] Could not clear "${key}":`, err);
    }
  }
}
