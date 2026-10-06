import { ENV_LABEL } from "./remoteStore";
// ─── v6.99.70 (A-BK-1/2, owner 27 Sept): AUTOMATIC BACKUP TO A FOLDER — the browser part ────────────────────────────
// The owner chooses a folder once (ideally one OneDrive or Google Drive already syncs, so a copy leaves the laptop). The app
// writes an "Export all data" file there on opening, then two minutes after the changes stop, at most every 15 minutes,
// and keeps the newest 30 plus one per day for 30 days. Restoring is the existing Settings → Import; there is no new path.
//
// Where the browser cannot write to a folder (only Chrome and Edge can), a daily "Download today's backup" strip is the
// fallback. The rules live in autoBackup.domain.ts; this file only talks to the browser.
//
// What is stored, and where: the folder HANDLE sits in this browser's IndexedDB (a handle cannot be written as text), the
// small status record in localStorage under "marianna-erp:autoBackup". Both are per-browser preferences like the user name —
// not in DATA_KEYS, never exported, never imported.

import { useEffect, useState } from "react";
import { exportAllData, DATA_KEYS, dataKey, STORAGE_VERSION } from "./useLocalStoredState";
import { APP_VERSION } from "./version";
import { tick, afterWrite, afterFailure, autoFileName, planRetention, fingerprint, localDay, EMPTY_CLOCK, BackupClock, TICK_MS, setBackupCopyLabel } from "./autoBackup.domain";

const PREF_KEY = "marianna-erp:autoBackup";
const IDB_NAME = "marianna-erp-prefs";
const IDB_STORE = "kv";
const HANDLE_KEY = "backupFolder";
const FLUSH_TIMEOUT_MS = 8000;

export type BackupMode = "unsupported" | "starting" | "notSet" | "active" | "paused" | "failed";
export interface AutoBackupStatus {
  mode: BackupMode;
  folderName: string;
  lastWrittenAt: string;   // ISO, last file written from this browser
  lastFileName: string;
  lastError: string;       // session only: a failure is judged against the data, not remembered
  filesKept: number;
  lastDownloadDay: string; // YYYY-MM-DD of the last "Export all data" / daily download
  snoozedDay: string;      // "Later" hides the amber strip for the rest of that day
  busy: boolean;
}

interface Prefs { folderName?: string; writtenFp?: string; wroteAt?: number; lastWrittenAt?: string; lastFileName?: string; filesKept?: number; lastDownloadDay?: string; snoozedDay?: string; }
function readPrefs(): Prefs { try { const raw = window.localStorage.getItem(PREF_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; } }
function writePrefs(p: Prefs): void { try { window.localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* a preference must never break the app */ } }
function patchPrefs(p: Partial<Prefs>): Prefs { const next = { ...readPrefs(), ...p }; writePrefs(next); return next; }

export function folderBackupSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as any).showDirectoryPicker === "function";
}

// ── status bus (same pattern as storageHealth) ─────────────────────────────────────────────────────────────────────
function initialStatus(): AutoBackupStatus {
  const p = typeof window === "undefined" ? {} : readPrefs();
  return {
    mode: folderBackupSupported() ? "starting" : "unsupported",
    folderName: p.folderName || "", lastWrittenAt: p.lastWrittenAt || "", lastFileName: p.lastFileName || "", lastError: "",
    filesKept: p.filesKept || 0, lastDownloadDay: p.lastDownloadDay || "", snoozedDay: p.snoozedDay || "", busy: false,
  };
}
let status: AutoBackupStatus | null = null;
const listeners: Array<() => void> = [];
function current(): AutoBackupStatus { if (!status) status = initialStatus(); return status; }
function setStatus(p: Partial<AutoBackupStatus>): void { status = { ...current(), ...p }; listeners.forEach(fn => { try { fn(); } catch {} }); }
export function getAutoBackupStatus(): AutoBackupStatus { return current(); }
export function useAutoBackupStatus(): AutoBackupStatus {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force(x => x + 1);
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }, []);
  return current();
}

// ── IndexedDB: only the folder handle ──────────────────────────────────────────────────────────────────────────────
function idb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore(IDB_STORE); } catch {} };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function idbGet(key: string): Promise<any> {
  const db = await idb(); if (!db) return null;
  return new Promise(resolve => { try { const r = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(key); r.onsuccess = () => resolve(r.result ?? null); r.onerror = () => resolve(null); } catch { resolve(null); } });
}
async function idbSet(key: string, val: any): Promise<void> {
  const db = await idb(); if (!db) return;
  return new Promise(resolve => { try { const tx = db.transaction(IDB_STORE, "readwrite"); tx.objectStore(IDB_STORE).put(val, key); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); } catch { resolve(); } });
}
async function idbDel(key: string): Promise<void> {
  const db = await idb(); if (!db) return;
  return new Promise(resolve => { try { const tx = db.transaction(IDB_STORE, "readwrite"); tx.objectStore(IDB_STORE).delete(key); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); } catch { resolve(); } });
}

// ── the engine ─────────────────────────────────────────────────────────────────────────────────────────────────────
let handle: any = null;
let clock: BackupClock = { ...EMPTY_CLOCK };
let started = false;
let timer: any = null;

/** The fingerprint of what is stored right now (raw strings — no parsing). */
export function currentFingerprint(): string {
  try { return fingerprint(DATA_KEYS.map(k => [k, window.localStorage.getItem(dataKey(k))] as [string, string | null])); } catch { return ""; }
}

function describe(err: any): string {
  const name = String(err?.name || "");
  if (name === "NotFoundError") return "The backup folder can't be found — it may have been moved, renamed or deleted. Choose it again in Settings.";
  if (name === "NoModificationAllowedError" || name === "InvalidStateError") return "The backup folder is read-only or busy. Choose another folder in Settings.";
  if (name === "QuotaExceededError") return "The disk holding the backup folder is full.";
  return String(err?.message || err || "Unknown error");
}

let retriedOnce = false;   // v7.1.8 (A-BK-5): a transient failure gets one quiet retry
async function writeFile(fp: string): Promise<boolean> {
  if (!handle) return false;
  setStatus({ busy: true });
  const now = new Date();
  try {
    const json = exportAllData();                          // exactly the "Export all data" file (BK-2)
    const name = autoFileName(now, APP_VERSION);
    const fh = await handle.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(json);
    await w.close();
    // the file is safe from here — v7.1.8 (A-BK-5): whatever happens while tidying old copies is "retention postponed", never a failed backup
    let kept = current().filesKept || 0;
    try {
      const names: string[] = [];
      for await (const [n, h] of handle.entries()) { if (h && h.kind === "file") names.push(String(n)); }
      const plan = planRetention(names, now);
      for (const r of plan.remove) { try { await handle.removeEntry(r); } catch { /* a locked file stays; next time */ } }
      kept = plan.keep.length;
    } catch (tidyErr) { console.warn("[auto-backup] retention postponed:", tidyErr); }
    clock = afterWrite(clock, fp, now.getTime());
    patchPrefs({ writtenFp: fp, wroteAt: now.getTime(), lastWrittenAt: now.toISOString(), lastFileName: name, filesKept: kept });
    setStatus({ mode: "active", busy: false, lastError: "", lastWrittenAt: now.toISOString(), lastFileName: name, filesKept: kept });
    return true;
  } catch (err: any) {
    clock = afterFailure(clock, now.getTime());
    patchPrefs({ wroteAt: now.getTime() });
    if (String(err?.name) === "NotAllowedError" || String(err?.name) === "SecurityError") setStatus({ mode: "paused", busy: false });
    else if (!retriedOnce && (String(err?.name) === "InvalidStateError" || String(err?.name) === "NoModificationAllowedError")) {   // v7.1.8 (A-BK-5): "busy" is transient — one quiet retry; a missing folder or anything else shows at once
      retriedOnce = true; setStatus({ busy: false }); const tm: any = setTimeout(() => { runTick("force").finally(() => { retriedOnce = false; }); }, 30_000); if (tm && typeof tm.unref === "function") tm.unref(); console.warn("[auto-backup] write failed once (busy) — retrying in 30 s:", err);
    }
    else setStatus({ mode: "failed", busy: false, lastError: describe(err) });
    console.warn("[auto-backup] write failed:", err);
    return false;
  }
}

/** One look. `force` writes regardless of the timing and of equal data (Back up now, Retry, the first file after choosing);
 *  `ifDirty` writes whenever the data differs from the last file, ignoring the timing (Resume, before an overwrite). */
export let backupAllowed = () => true;   // v7.1.8 (A-BK-5): App tells the backup whether this tab holds the pen (the tab lock)
export function setBackupAllowed(fn: () => boolean) { backupAllowed = fn; }
async function runTick(mode: "normal" | "ifDirty" | "force" = "normal"): Promise<void> {
  if (!backupAllowed()) return;
  const st = current();
  if (!handle || st.busy || (st.mode !== "active" && st.mode !== "failed")) return;
  const p = readPrefs();   // another tab may have written meanwhile — the last file is shared knowledge
  clock = { ...clock, writtenFp: p.writtenFp || "", wroteAt: Math.max(clock.wroteAt, p.wroteAt || 0) };
  const fp = currentFingerprint(); if (!fp) return;
  const r = tick(clock, fp, Date.now()); clock = r.clock;
  const dirty = fp !== clock.writtenFp;
  if (mode === "force" || (mode === "ifDirty" && dirty) || (mode === "normal" && r.write)) await writeFile(fp);
}

/** Called once from App on opening. */
export async function startAutoBackup(): Promise<void> {
  setBackupCopyLabel(ENV_LABEL);   // v7.1.9 (A-BK-6): TEST files named apart
  if (started || typeof window === "undefined") return;
  started = true;
  if (!folderBackupSupported()) { setStatus({ mode: "unsupported" }); return; }
  handle = await idbGet(HANDLE_KEY);
  if (!handle) { setStatus({ mode: "notSet" }); return; }
  let perm = "prompt";
  try { perm = await handle.queryPermission({ mode: "readwrite" }); } catch { perm = "prompt"; }
  setStatus({ mode: perm === "granted" ? "active" : "paused", folderName: String(handle.name || readPrefs().folderName || "") });
  timer = setInterval(() => { runTick("normal"); }, TICK_MS);
  setTimeout(() => { runTick("normal"); }, 3000);   // "on opening" — after the load-time normalisations have settled
}

/** Settings → Choose folder… (must be called from a click). */
export async function chooseBackupFolder(): Promise<{ ok: boolean; message: string }> {
  if (!folderBackupSupported()) return { ok: false, message: "This browser can't write to a folder. Chrome and Edge can." };
  let h: any;
  try { h = await (window as any).showDirectoryPicker({ id: "marianna-erp-backups", mode: "readwrite", startIn: "documents" }); }
  catch (err: any) {
    if (String(err?.name) === "AbortError") return { ok: false, message: "" };
    return { ok: false, message: "The browser refused that folder (" + describe(err) + "). Try a sub-folder you created yourself, e.g. \"MARIANNA backups\" inside OneDrive or Google Drive." };
  }
  handle = h;
  await idbSet(HANDLE_KEY, h);
  patchPrefs({ folderName: String(h.name || "") });
  setStatus({ mode: "active", folderName: String(h.name || ""), lastError: "" });
  if (!timer) timer = setInterval(() => { runTick("normal"); }, TICK_MS);
  await runTick("force");
  const st = current();
  return st.mode === "active" ? { ok: true, message: `Backups go to "${st.folderName}". First file written: ${st.lastFileName}.` } : { ok: false, message: st.lastError || "The first backup could not be written." };
}

/** The banner's Resume (must be called from a click): the browser asks for access again after a restart. */
export async function resumeBackupFolder(): Promise<boolean> {
  if (!handle) handle = await idbGet(HANDLE_KEY);
  if (!handle) { setStatus({ mode: "notSet" }); return false; }
  let perm = "denied";
  try { perm = await handle.requestPermission({ mode: "readwrite" }); } catch { perm = "denied"; }
  if (perm !== "granted") { setStatus({ mode: "paused" }); return false; }
  setStatus({ mode: "active", lastError: "" });
  if (!timer) timer = setInterval(() => { runTick("normal"); }, TICK_MS);
  await runTick("ifDirty");
  return true;
}

/** Back up now / Retry. */
export async function backupNow(): Promise<boolean> {
  if (current().mode === "paused") return resumeBackupFolder();
  await runTick("force");
  return current().mode === "active";
}

/** Before an import, a restore or a wipe: whatever is not yet in the folder goes there first (never blocks for long). */
export async function flushFolderBackup(): Promise<void> {
  if (!handle || current().mode !== "active") return;
  await Promise.race([runTick("ifDirty"), new Promise(r => setTimeout(r, FLUSH_TIMEOUT_MS))]);
}

/** Settings → Stop automatic backup. The files already in the folder stay. */
export async function stopFolderBackup(): Promise<void> {
  handle = null;
  if (timer) { clearInterval(timer); timer = null; }
  await idbDel(HANDLE_KEY);
  patchPrefs({ folderName: "" });
  setStatus({ mode: folderBackupSupported() ? "notSet" : "unsupported", folderName: "", lastError: "" });
}

/** "Export all data" and the daily download share one routine; either counts as today's backup. Returns the file name. */
export function downloadAllData(): string {
  const json = exportAllData();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  // v6.17: stamp the build + schema version so testers can see at a glance whether a shared file matches their build.
  a.download = `marianna-erp_v${APP_VERSION}_schema-v${STORAGE_VERSION}_${stamp}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  const day = localDay(new Date());
  patchPrefs({ lastDownloadDay: day });
  setStatus({ lastDownloadDay: day });
  return a.download;
}

/** "Later" on the amber strip: hidden for the rest of today. A failure (red) cannot be snoozed. */
export function snoozeBackupBanner(): void { const day = localDay(new Date()); patchPrefs({ snoozedDay: day }); setStatus({ snoozedDay: day }); }

/** What the banner shows, if anything. Pure over the status and today, so the render smoke can pin every case. */
export function bannerFor(st: AutoBackupStatus, today: string): "none" | "unsupported" | "notSet" | "paused" | "failed" {
  if (st.mode === "failed") return "failed";
  if (st.snoozedDay === today) return "none";
  if (st.mode === "paused") return "paused";
  if (st.mode === "notSet") return "notSet";
  if (st.mode === "unsupported") return st.lastDownloadDay === today ? "none" : "unsupported";
  return "none";
}
