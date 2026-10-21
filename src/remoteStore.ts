// ─── v6.99.148 (AUD-01/03/04/05, owner 4–5 Oct): THE SHARED RECORD STORE ─────────────────────────────────────────────
// Until now every browser kept its own copy of the data. With the two settings present (REACT_APP_SUPABASE_URL and
// REACT_APP_SUPABASE_ANON_KEY) the app keeps ONE copy for everyone, in Supabase: one row per store (contacts, pos, lots…),
// each with a version. A person logs in; the app pulls every store, then every local save is pushed, pinned to the
// version it last saw — if a colleague saved the same store meanwhile, the push is refused, the colleague's copy is
// pulled in and a notice names the store (the person's own last change is kept in a local "conflict copy" they can export).
// Every 20 seconds the app asks for new versions, so colleagues' work appears without a refresh.
// Without the two settings the app behaves exactly as before, on this browser alone.
import { DATA_KEYS, applyStoreFromRemote, readStoreValue, setStoreWrittenHook } from "./useLocalStoredState";
import { mergeStore } from "./storeMerge.domain";   // v7.14.0 (A-RV-01): record-by-record merge when a colleague saved first

// v6.99.149 (owner 5 Oct): which copy this is — "TEST" on the preview address (a separate Supabase project), nothing on production
declare const process: any;
export const ENV_LABEL = String(process.env.REACT_APP_ENV_LABEL || "").trim();

// v6.99.150 (owner 6 Oct: "I reach the page without any credentials") — MY FAULT in v6.99.148: the settings were read behind a
// `typeof process !== "undefined"` guard; the build replaces process.env.X with its value, but `process` itself does not exist
// in the browser, so the guard was false and the app never saw the settings. The plain form below is what the build expects.
// v6.99.151 (owner 6 Oct: "Invalid path specified in request URL"): the Project URL is often copied with a path on it
// (…supabase.co/rest/v1/); every call then went to …/rest/v1/auth/v1/… and Supabase refused the path. Only the address's
// origin (https://<project>.supabase.co) is kept, whatever was pasted, with spaces trimmed.
export function originOf(v: any): string { const t = String(v || "").trim(); if (!t) return ""; try { return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`).origin; } catch { return t.replace(/\/+$/, ""); } }
export const REMOTE_URL = originOf(process.env.REACT_APP_SUPABASE_URL);
export const REMOTE_KEY = String(process.env.REACT_APP_SUPABASE_ANON_KEY || "").trim();
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
/** v7.21.1 (AUD-49): the signed-in person's session token — what the server part checks before it calls Fakturownia. */
export async function sessionToken(): Promise<string | null> { try { return await freshToken(); } catch { return null; } }
async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await freshToken(); if (!token) throw new Error("not logged in");
  return fetch(`${REMOTE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: REMOTE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
}

/** v7.27.8 (A-W5): call a database function (Supabase RPC) as the person signed in. */
export async function rpc(name: string, body: any): Promise<Response> { return rest(`rpc/${name}`, { method: "POST", body: JSON.stringify(body || {}) }); }

// ── the sync engine ────────────────────────────────────────────────────────────────────────────────────────────────────
/** v7.14.0 (A-RV-01): what a merge has to tell the person — a record both changed (theirs kept, mine aside, "Use mine"), or a new
 *  document of mine renumbered because a colleague took its number meanwhile. */
export type SyncNotice = { key: string; kind: "clash" | "renumbered"; id: string; label: string; by?: string; at: string; to?: string };
export type SyncState = { status: "off" | "login" | "pulling" | "synced" | "saving" | "offline" | "empty" | "refused"; refusedKey?: string; conflicts: string[]; lastPull?: string; by?: Record<string, string>; notices?: SyncNotice[] };
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
export async function pullAll(): Promise<{ empty: boolean }> {
  emit({ status: "pulling" });
  const rows = await fetchRows();

  const by: Record<string, string> = {};
  rows.forEach(r => { const json = JSON.stringify(r.data); known.set(r.key, { version: r.version, json }); by[r.key] = r.updated_by || ""; if (DATA_KEYS.includes(r.key)) applyStoreFromRemote(r.key, r.data); });
  emit({ status: rows.length ? "synced" : "empty", lastPull: new Date().toISOString(), by });
  return { empty: rows.length === 0 };
}
/** v6.99.152 (owner 6 Oct): the FIRST upload — from this browser, or from an exported JSON file — only into an EMPTY shared copy.
 *  It refuses when the shared copy already holds data (nobody overwrites colleagues' work by pressing a button), then pulls,
 *  so this browser takes exactly what went up (its own data is kept as a snapshot first). */
export async function uploadStores(source: Record<string, any>, by: string): Promise<number> {
  const existing = await fetchRows("key");
  if (existing.length) throw new Error(`the shared data already holds ${existing.length} store(s) — nothing was uploaded. A first upload only goes into an empty shared copy.`);
  const now = new Date().toISOString();
  const body = DATA_KEYS.map(key => ({ key, data: source[key] ?? (key === "heals" ? {} : []), version: 1, updated_by: by, updated_at: now }));
  const res = await rest("stores", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`upload failed (${res.status})`);
  await pullAll(); return body.length;
}
/** An exported Marianna JSON file (Settings → Export all data) read as stores — what it holds, counted, for the confirmation. */
export function storesFromExport(text: string): { stores: Record<string, any>; summary: string; meta: any } {
  const j = JSON.parse(text); const src = j && typeof j === "object" ? (j.data && typeof j.data === "object" && !Array.isArray(j.data) ? j.data : j) : {};
  if (!j || j._meta?.app !== "marianna-erp") throw new Error("this is not a Marianna export file");
  const stores: Record<string, any> = {}; DATA_KEYS.forEach(k => { if (src[k] !== undefined) stores[k] = src[k]; });
  const n = (k: string) => (Array.isArray(stores[k]) ? stores[k].length : 0);
  const summary = [["pos", "POs"], ["orders", "sales orders"], ["lots", "lots"], ["shipments", "shipments"], ["invoices", "invoices"], ["contacts", "companies"]].map(([k, l]) => `${n(k)} ${l}`).join(", ");
  return { stores, summary, meta: j._meta || {} };
}
/** v7.30.0 (Batch M · M-1): a change the shared copy's rules refused (only the owner changes the users, the roles, the closed months
 *  and the company profile; the audit trail only grows) — said plainly, and this browser takes the shared version back, so it never
 *  keeps a change nobody else can see. */
async function refused(key: string): Promise<void> {
  emit({ status: "refused", refusedKey: key });
  try { const fresh = (await fetchRows()).find((r: any) => r.key === key); if (fresh) { known.set(key, { version: fresh.version, json: JSON.stringify(fresh.data) }); applyStoreFromRemote(key, fresh.data); } } catch { /* the next pull brings it back */ }
}
async function pushNow(key: string, json: string, by: string, attempt = 0): Promise<void> {
  const k = known.get(key);
  if (k && k.json === json) return;   // an echo of what was pulled — nothing to push
  emit({ status: "saving" });
  const data = JSON.parse(json); const now = new Date().toISOString();
  if (!k) {   // the store does not exist in the shared copy yet
    const res = await rest("stores", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify([{ key, data, version: 1, updated_by: by, updated_at: now }]) });
    if (res.status === 401 || res.status === 403) { await refused(key); return; }   // v7.30.0 (Batch M · M-1): the database's rules said no
    if (!res.ok) { emit({ status: "offline" }); return; }
    known.set(key, { version: 1, json }); emit({ status: "synced" }); return;
  }
  const res = await rest(`stores?key=eq.${encodeURIComponent(key)}&version=eq.${k.version}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ data, version: k.version + 1, updated_by: by, updated_at: now }) });
  if (res.status === 401 || res.status === 403) { await refused(key); return; }   // v7.30.0 (Batch M · M-1): the database's rules said no
  if (!res.ok) { emit({ status: "offline" }); return; }
  const rows: Row[] = await res.json();
  if (rows.length) { known.set(key, { version: rows[0].version, json }); emit({ status: "synced", conflicts: state.conflicts.filter(c => c !== key) }); return; }
  // nobody matched the version: a colleague saved this store first.
  const fresh = (await fetchRows()).find(r => r.key === key);
  // v7.14.0 (A-RV-01, owner 9 Oct): merge record by record — my records go up beside theirs; only a record we BOTH changed stays theirs
  // (mine kept aside, "Use mine" offered); a new document of mine whose number they took gets the next free one, said so.
  const merge = fresh && attempt < 3 ? mergeStore(key, k ? JSON.parse(k.json) : undefined, data, fresh.data, (num: string) => referencedElsewhere(key, num)) : null;
  if (fresh && merge) {
    const who = fresh.updated_by || ""; const at = new Date().toISOString();
    const notices: SyncNotice[] = [
      ...merge.clashes.map(c => { try { window.localStorage.setItem(clashKey(key, c.id), JSON.stringify(c.mine)); } catch { /* best effort */ } return { key, kind: "clash" as const, id: c.id, label: c.label, by: who, at }; }),
      ...merge.renumbered.map(r => ({ key, kind: "renumbered" as const, id: r.id, label: r.from, to: r.to, by: who, at })),
    ];
    const mergedJson = JSON.stringify(merge.merged);
    known.set(key, { version: fresh.version, json: JSON.stringify(fresh.data) });
    emit({ notices: [...(state.notices || []), ...notices], by: { ...(state.by || {}), [key]: who } });
    if (mergedJson === JSON.stringify(fresh.data)) { applyStoreFromRemote(key, fresh.data); emit({ status: "synced" }); return; }
    applyStoreFromRemote(key, merge.merged);   // the screen shows the merge at once; known still holds theirs, so it is pushed next
    return pushNow(key, mergedJson, by, attempt + 1);   // pinned to their version; a third colleague in between merges again
  }
  // the old rule, for a store that is not records with ids (or after three tries): keep my copy aside, take theirs, say so
  try { window.localStorage.setItem(`marianna:conflict:${key}:${now}`, json); } catch { /* best effort */ }
  if (fresh) { known.set(key, { version: fresh.version, json: JSON.stringify(fresh.data) }); applyStoreFromRemote(key, fresh.data); }
  emit({ status: "synced", conflicts: Array.from(new Set([...state.conflicts, key])), by: { ...(state.by || {}), [key]: fresh?.updated_by || "" } });
}
const clashKey = (key: string, id: string) => `marianna:clash:${key}:${id}`;
/** Does any OTHER store already point at this document number? (then a new document is not silently renumbered) */
function referencedElsewhere(key: string, num: string): boolean {
  const needle = JSON.stringify(String(num));
  return DATA_KEYS.some(k => { if (k === key || k === "auditLog") return false; try { return JSON.stringify(readStoreValue(k) ?? null).includes(needle); } catch { return false; } });
}
let lastBy = "";
/** "Use mine" on a clash: my version of that record replaces theirs, and goes up like any save. */
export async function keepMine(key: string, id: string): Promise<boolean> {
  let mine: any = null; try { mine = JSON.parse(window.localStorage.getItem(clashKey(key, id)) || "null"); } catch { mine = null; }
  const cur = readStoreValue(key); let next: any;
  if (Array.isArray(cur)) { const i = cur.findIndex((r: any) => String(r?.id) === String(id)); next = mine === null ? cur.filter((r: any) => String(r?.id) !== String(id)) : i >= 0 ? cur.map((r: any, j: number) => (j === i ? mine : r)) : [...cur, mine]; }
  else if (cur && typeof cur === "object") { next = { ...cur }; if (mine === null) delete next[id]; else next[id] = mine; }
  else return false;
  applyStoreFromRemote(key, next);
  try { window.localStorage.removeItem(clashKey(key, id)); } catch { /* best effort */ }
  emit({ notices: (state.notices || []).filter(n => !(n.key === key && n.id === id && n.kind === "clash")) });
  await pushNow(key, JSON.stringify(next), lastBy); return true;
}
export function dismissNotice(key: string, id: string, kind: string) { emit({ notices: (state.notices || []).filter(n => !(n.key === key && n.id === id && n.kind === kind)) }); }
/** Local writes follow to the shared copy, 1.5 s after the last keystroke per store. */
export function startSync(by: string): () => void {
  lastBy = by;   // v7.14.0: "Use mine" pushes as the person signed in
  setStoreWrittenHook((key, json) => {
    if (!DATA_KEYS.includes(key)) return;
    if (state.status === "empty") return;   // v6.99.152: before the first upload nothing goes up — no stray store from a test browser
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

// ─── v7.0.0 (A-SH-1, owner 6 Oct): DELIBERATE CHANGES TO THE WHOLE SHARED COPY ────────────────────────────────────────
// Restore a backup into the shared copy, archive a season in it, or (TEST copy only) wipe it. Each replaces the named stores
// with NEW versions, so every signed-in tab takes them on its next poll; colleagues' unsaved edits to those stores lose the race
// and are told so (the usual conflict notice).
export const isTestCopy = () => /^test$/i.test(ENV_LABEL);
/** v7.24.0 (A-BK-7, owner 15 Oct): the copy's mark in every backup file's NAME — "-TEST" on the test copy, nothing on the real one —
 *  so two exports of the same version can be told apart without opening them. */
export const fileLabel = (): string => { const l = ENV_LABEL.toUpperCase().replace(/[^A-Z0-9]/g, ""); return l ? `-${l}` : ""; };
export async function replaceSharedStores(stores: Record<string, any>, by: string): Promise<number> {
  const current = await fetchRows("key,version"); const ver = new Map(current.map(r => [r.key, r.version]));
  const now = new Date().toISOString(); let n = 0;
  for (const key of Object.keys(stores).filter(k => DATA_KEYS.includes(k))) {
    const data = stores[key]; const v = ver.get(key);
    const res = v == null
      ? await rest("stores", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ key, data, version: 1, updated_by: by, updated_at: now }]) })
      : await rest(`stores?key=eq.${encodeURIComponent(key)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ data, version: Number(v) + 1, updated_by: by, updated_at: now }) });
    if (!res.ok) throw new Error(`writing ${key} failed (${res.status}) — ${n} store(s) were replaced before the failure`);
    known.set(key, { version: v == null ? 1 : Number(v) + 1, json: JSON.stringify(data) }); n++;
  }
  return n;
}
/** The whole shared copy as a Marianna export file (for the download taken before any replacement). */
export async function sharedCopyAsExport(appVersion: string, storageVersion: number): Promise<string> {
  const rows = await fetchRows(); const out: any = { _meta: { app: "marianna-erp", version: storageVersion, appVersion, exportedAt: new Date().toISOString(), source: "shared copy" + (ENV_LABEL ? ` (${ENV_LABEL})` : ""), copy: ENV_LABEL.toUpperCase() || "REAL" } };   // v7.24.0 (A-BK-7)
  rows.forEach(r => { out[r.key] = r.data; }); return JSON.stringify(out);
}

// ─── v7.4.1 (A-REC-2, owner 6 Oct): THE TWICE-A-DAY SNAPSHOTS SUPABASE KEEPS (13:00 and 20:00 Warsaw, 30 days) ─────────
/** The moments a snapshot exists for, newest first (empty when the snapshots table is not set up yet). */
export async function listSnapshots(): Promise<string[]> {
  try { const res = await rest("store_snapshots?select=taken_at&order=taken_at.desc&limit=2000"); if (!res.ok) return []; const rows: any[] = await res.json(); return Array.from(new Set(rows.map(r => String(r.taken_at)))); }
  catch { return []; }
}
/** The whole shared data as it was at that moment, as stores. */
export async function readSnapshot(takenAt: string): Promise<Record<string, any>> {
  const res = await rest(`store_snapshots?select=key,data&taken_at=eq.${encodeURIComponent(takenAt)}`); if (!res.ok) throw new Error(`reading the snapshot failed (${res.status})`);
  const rows: any[] = await res.json(); const out: Record<string, any> = {}; rows.forEach(r => { out[r.key] = r.data; }); return out;
}
/** Today's shared data as stores (for the comparison). */
export async function readSharedNow(): Promise<Record<string, any>> { const rows = await fetchRows("key,data"); const out: Record<string, any> = {}; rows.forEach(r => { out[r.key] = r.data; }); return out; }
