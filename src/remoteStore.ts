// ─── v6.99.148 (AUD-01/03/04/05, owner 4–5 Oct): THE SHARED RECORD STORE ─────────────────────────────────────────────
// Until now every browser kept its own copy of the data. With the two settings present (REACT_APP_SUPABASE_URL and
// REACT_APP_SUPABASE_ANON_KEY) the app keeps ONE copy for everyone, in Supabase: one row per store (contacts, pos, lots…),
// each with a version. A person logs in; the app pulls every store, then every local save is pushed, pinned to the
// version it last saw — if a colleague saved the same store meanwhile, the push is refused, the colleague's copy is
// pulled in and a notice names the store (the person's own last change is kept in a local "conflict copy" they can export).
// Every 20 seconds the app asks for new versions, so colleagues' work appears without a refresh.
// Without the two settings the app behaves exactly as before, on this browser alone.
import { DATA_KEYS, applyStoreFromRemote, readStoreValue, setStoreWrittenHook, createBackup } from "./useLocalStoredState";

// v6.99.149 (owner 5 Oct): which copy this is — "TEST" on the preview address (a separate Supabase project), nothing on production
declare const process: any;
export const ENV_LABEL = String(process.env.REACT_APP_ENV_LABEL || "").trim();

// v6.99.150 (owner 6 Oct: "I reach the page without any credentials") — MY FAULT in v6.99.148: the settings were read behind a
// `typeof process !== "undefined"` guard; the build replaces process.env.X with its value, but `process` itself does not exist
// in the browser, so the guard was false and the app never saw the settings. The plain form below is what the build expects.
export const REMOTE_URL = String(process.env.REACT_APP_SUPABASE_URL || "").replace(/\/+$/, "");
export const REMOTE_KEY = String(process.env.REACT_APP_SUPABASE_ANON_KEY || "");
export const remoteConfigured = () => !!(REMOTE_URL && REMOTE_KEY);

const SESSION_KEY = "marianna:shared:session";
type Session = { access_token: string; refresh_token: string; expires_at: number; email: string };
export function readSession(): Session | null { try { const s = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null"); return s && s.access_token ? s : null; } catch { return null; } }
function saveSession(s: Session | null) { if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else window.localStorage.removeItem(SESSION_KEY); }

async function authCall(path: string, body: any): Promise<any> {
  const res = await fetch(`${REMOTE_URL}/auth/v1/${path}`, { method: "POST", headers: { apikey: REMOTE_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error_description || j.msg || j.message || `login failed (${res.status})`);
  return j;
}
export async function login(email: string, password: string): Promise<Session> {
  const j = await authCall("token?grant_type=password", { email, password });
  const s: Session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000, email: j.user?.email || email };
  saveSession(s); return s;
}
export function logout() { saveSession(null); }
async function freshToken(): Promise<string | null> {
  const s = readSession(); if (!s) return null;
  if (Date.now() < s.expires_at - 60_000) return s.access_token;
  try { const j = await authCall("token?grant_type=refresh_token", { refresh_token: s.refresh_token }); const n: Session = { ...s, access_token: j.access_token, refresh_token: j.refresh_token || s.refresh_token, expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000 }; saveSession(n); return n.access_token; }
  catch { saveSession(null); return null; }
}
async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await freshToken(); if (!token) throw new Error("not logged in");
  return fetch(`${REMOTE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: REMOTE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
}

// ── the sync engine ────────────────────────────────────────────────────────────────────────────────────────────────────
export type SyncState = { status: "off" | "login" | "pulling" | "synced" | "saving" | "offline" | "empty"; conflicts: string[]; lastPull?: string; by?: Record<string, string> };
type Known = { version: number; json: string };
const known = new Map<string, Known>();   // what this tab last pulled or successfully pushed, per store
const pending = new Map<string, { json: string; timer: any }>();
let listeners: Array<(s: SyncState) => void> = []; let state: SyncState = { status: remoteConfigured() ? "login" : "off", conflicts: [] };
function emit(patch: Partial<SyncState>) { state = { ...state, ...patch }; listeners.forEach(l => l(state)); }
export function onSync(l: (s: SyncState) => void): () => void { listeners.push(l); l(state); return () => { listeners = listeners.filter(x => x !== l); }; }
export function syncState(): SyncState { return state; }

type Row = { key: string; data: any; version: number; updated_at?: string; updated_by?: string };
async function fetchRows(select = "key,data,version,updated_at,updated_by"): Promise<Row[]> {
  const res = await rest(`stores?select=${select}`); if (!res.ok) throw new Error(`pull failed (${res.status})`); return res.json();
}
/** What this browser holds, counted — shown before the upload so nobody pushes the wrong data by accident. */
export function localSummary(): string {
  const n = (k: string) => { const v = readStoreValue(k); return Array.isArray(v) ? v.length : 0; };
  return [["pos", "POs"], ["orders", "sales orders"], ["lots", "lots"], ["shipments", "shipments"], ["invoices", "invoices"], ["contacts", "companies"]].map(([k, l]) => `${n(k)} ${l}`).join(", ");
}
const FIRST_PULL_MARK = "marianna:shared:firstPullSnapshot";
export async function pullAll(): Promise<{ empty: boolean }> {
  emit({ status: "pulling" });
  const rows = await fetchRows();
  // v6.99.149 (owner 5 Oct): the FIRST time the shared copy replaces this browser's data, this browser's data is kept as a local snapshot first
  if (rows.length && !window.localStorage.getItem(FIRST_PULL_MARK)) {
    try { createBackup(`Auto — before the shared data replaced this browser's (${localSummary()})`); window.localStorage.setItem(FIRST_PULL_MARK, new Date().toISOString()); } catch { /* the snapshot is best effort; the pull goes on */ }
  }
  const by: Record<string, string> = {};
  rows.forEach(r => { const json = JSON.stringify(r.data); known.set(r.key, { version: r.version, json }); by[r.key] = r.updated_by || ""; if (DATA_KEYS.includes(r.key)) applyStoreFromRemote(r.key, r.data); });
  emit({ status: rows.length ? "synced" : "empty", lastPull: new Date().toISOString(), by });
  return { empty: rows.length === 0 };
}
/** The first person with an empty shared store uploads this browser's data once — every store, version 1. */
export async function uploadAllLocal(by: string): Promise<number> {
  const body = DATA_KEYS.map(key => ({ key, data: readStoreValue(key), version: 1, updated_by: by, updated_at: new Date().toISOString() }));
  const res = await rest("stores", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`upload failed (${res.status})`);
  body.forEach(b => known.set(b.key, { version: 1, json: JSON.stringify(b.data) })); emit({ status: "synced" }); return body.length;
}
async function pushNow(key: string, json: string, by: string): Promise<void> {
  const k = known.get(key);
  if (k && k.json === json) return;   // an echo of what was pulled — nothing to push
  emit({ status: "saving" });
  const data = JSON.parse(json); const now = new Date().toISOString();
  if (!k) {   // the store does not exist in the shared copy yet
    const res = await rest("stores", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify([{ key, data, version: 1, updated_by: by, updated_at: now }]) });
    if (!res.ok) { emit({ status: "offline" }); return; }
    known.set(key, { version: 1, json }); emit({ status: "synced" }); return;
  }
  const res = await rest(`stores?key=eq.${encodeURIComponent(key)}&version=eq.${k.version}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ data, version: k.version + 1, updated_by: by, updated_at: now }) });
  if (!res.ok) { emit({ status: "offline" }); return; }
  const rows: Row[] = await res.json();
  if (rows.length) { known.set(key, { version: rows[0].version, json }); emit({ status: "synced", conflicts: state.conflicts.filter(c => c !== key) }); return; }
  // nobody matched the version: a colleague saved this store first — keep my copy aside, take theirs, say so
  try { window.localStorage.setItem(`marianna:conflict:${key}:${now}`, json); } catch { /* best effort */ }
  const fresh = (await fetchRows()).find(r => r.key === key);
  if (fresh) { known.set(key, { version: fresh.version, json: JSON.stringify(fresh.data) }); applyStoreFromRemote(key, fresh.data); }
  emit({ status: "synced", conflicts: Array.from(new Set([...state.conflicts, key])), by: { ...(state.by || {}), [key]: fresh?.updated_by || "" } });
}
/** Local writes follow to the shared copy, 1.5 s after the last keystroke per store. */
export function startSync(by: string): () => void {
  setStoreWrittenHook((key, json) => {
    if (!DATA_KEYS.includes(key)) return;
    const p = pending.get(key); if (p) clearTimeout(p.timer);
    pending.set(key, { json, timer: setTimeout(() => { pending.delete(key); pushNow(key, json, by).catch(() => emit({ status: "offline" })); }, 1500) });
  });
  const poll = setInterval(async () => {
    if (pending.size) return;   // never pull over a save in flight
    try {
      const versions: Row[] = await fetchRows("key,version,updated_by");
      const changed = versions.filter(r => DATA_KEYS.includes(r.key) && (known.get(r.key)?.version ?? 0) < r.version);
      if (!changed.length) { if (state.status === "offline") emit({ status: "synced" }); return; }
      const rows = await fetchRows(); const by2 = { ...(state.by || {}) };
      rows.filter(r => changed.some(c => c.key === r.key)).forEach(r => { known.set(r.key, { version: r.version, json: JSON.stringify(r.data) }); applyStoreFromRemote(r.key, r.data); by2[r.key] = r.updated_by || ""; });
      emit({ status: "synced", lastPull: new Date().toISOString(), by: by2 });
    } catch { emit({ status: "offline" }); }
  }, 20_000);
  return () => { clearInterval(poll); setStoreWrittenHook(null); };
}
export function clearConflict(key: string) { emit({ conflicts: state.conflicts.filter(c => c !== key) }); }
