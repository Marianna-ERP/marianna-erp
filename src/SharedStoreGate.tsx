import { useConfirm } from "./ui";   // v7.22.5 (A-RV-17)
// v6.99.148: the login and the sync status for the shared store — shown only when the two settings are present
import React, { useEffect, useState } from "react";
import { remoteConfigured, readSession, login, logout, pullAll, uploadStores, storesFromExport, startSync, onSync, SyncState, clearConflict, ENV_LABEL, keepMine, dismissNotice } from "./remoteStore";   // v7.14.0: + keepMine, dismissNotice

export function useSharedStore(userLabel: string): { ready: boolean; sync: SyncState; node: React.ReactNode } {
  const configured = remoteConfigured();
  const [session, setSession] = useState(() => (configured ? readSession() : null));
  const [sync, setSync] = useState<SyncState>({ status: configured ? "login" : "off", conflicts: [] });
  const [pulled, setPulled] = useState(false); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  useEffect(() => onSync(setSync), []);
  useEffect(() => {
    if (!configured || !session) return;
    let stop: null | (() => void) = null; let alive = true;
    (async () => {
      try { await pullAll(); if (!alive) return; setPulled(true); stop = startSync(session.email || userLabel); }
      catch (e: any) { if (/not logged in|401|403/.test(String(e?.message))) { logout(); setSession(null); } else setErr(String(e?.message || e)); }
    })();
    return () => { alive = false; if (stop) stop(); };
  }, [configured, session, userLabel]);
  // v7.21.0 (A-RV-19, owner ruling B 8 Oct): there is no single-browser mode any more — a copy without the two shared-data settings
  // does not run on its own browser's data; it says what is missing. An old backup is looked at by restoring it into TEST.
  if (!configured) return { ready: false, sync, node: (
    <div data-not-connected="1" style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8FAFC", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "26px 30px", width: 420, boxShadow: "0 24px 60px rgba(0,0,0,0.12)" }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#111" }}>MARIANNA</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginTop: 12 }}>This copy isn't connected to the shared data.</div>
        <div style={{ fontSize: 12, color: "#64748B", marginTop: 6, lineHeight: 1.55 }}>It needs the two shared-data settings in Vercel: REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY. The app no longer runs on one browser's own data — to look at an old backup, restore it into the TEST copy.</div>
      </div>
    </div>) };
  if (!session) {
    return { ready: false, sync, node: (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8FAFC", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
        <div style={{ background: "#fff", borderRadius: 14, padding: "26px 30px", width: 380, boxShadow: "0 24px 60px rgba(0,0,0,0.12)" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#111" }}>MARIANNA{ENV_LABEL && <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 800, color: "#fff", background: "#7C3AED", padding: "2px 8px", borderRadius: 6, verticalAlign: "middle" }}>{ENV_LABEL}</span>}</div>
          <div style={{ fontSize: 12, color: "#64748B", marginTop: 4, marginBottom: 16 }}>Shared data — sign in with your Marianna account.</div>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="e-mail" autoComplete="username" style={{ width: "100%", boxSizing: "border-box", border: "1px solid #E5E7EB", borderRadius: 8, padding: "10px 12px", fontSize: 14, marginBottom: 8 }} />
          <input value={pw} onChange={e => setPw(e.target.value)} placeholder="password" type="password" autoComplete="current-password" onKeyDown={async e => { if (e.key === "Enter") { setBusy(true); setErr(""); try { setSession(await login(email.trim(), pw)); } catch (x: any) { setErr(String(x?.message || x)); } setBusy(false); } }} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #E5E7EB", borderRadius: 8, padding: "10px 12px", fontSize: 14, marginBottom: 12 }} />
          {err && <div style={{ fontSize: 12, color: "#DC2626", fontWeight: 600, marginBottom: 10 }}>{err}</div>}
          <button disabled={busy || !email || !pw} onClick={async () => { setBusy(true); setErr(""); try { setSession(await login(email.trim(), pw)); } catch (x: any) { setErr(String(x?.message || x)); } setBusy(false); }} style={{ width: "100%", padding: "10px", borderRadius: 8, border: "none", background: busy ? "#94A3B8" : "#111", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{busy ? "Signing in…" : "Sign in"}</button>
        </div>
      </div>) };
  }
  if (!pulled) {
    return { ready: false, sync, node: (<div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#475569" }}>{err ? <div style={{ color: "#DC2626", fontWeight: 700 }}>{err} — <button onClick={() => { logout(); setSession(null); }}>sign in again</button></div> : "Loading the shared data…"}</div>) };
  }
  return { ready: true, sync, node: null };
}

/** The status pill + conflict notices + the one-time upload offer, for the top bar. */
export function SharedStoreStatus({ sync, userLabel }: { sync: SyncState; userLabel: string }) {
  const { confirm: uiConfirm, alert: uiAlert, dialogNode } = useConfirm();   // v7.22.5 (A-RV-17): the app's own windows, not the browser's
  const [busy, setBusy] = useState(false);
  if (sync.status === "off") return null;
  const color = sync.status === "refused" ? "#B91C1C" : sync.status === "synced" ? "#15803D" : sync.status === "saving" || sync.status === "pulling" ? "#B45309" : sync.status === "offline" ? "#DC2626" : "#6366F1";
  const label = sync.status === "refused" ? (sync.refusedKey === "auditLog" ? "shared · the audit trail only grows — this window was behind; it has been brought up to date" : `shared · a change to ${sync.refusedKey || "a list"} was refused — only the owner (Settings › Users) can change it`) :   /* v7.50.2 (BUG-1): the real reason */ sync.status === "synced" ? "shared · synced" : sync.status === "saving" ? "shared · saving…" : sync.status === "pulling" ? "shared · loading…" : sync.status === "offline" ? "shared · offline — changes kept here, retried on the next save" : sync.status === "empty" ? "shared store is empty" : "shared";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, color }} title={sync.lastPull ? `last pulled ${sync.lastPull.slice(11, 19)} UTC` : ""}>{dialogNode}
      <span style={{ width: 8, height: 8, borderRadius: 4, background: color, display: "inline-block" }} />{label}
      {sync.status === "empty" && <>
        {/* v6.99.152 (owner 6 Oct): the first shared data from an EXPORTED FILE — e.g. a colleague's browser copy — without importing it into this browser first */}
        <label style={{ padding: "3px 10px", borderRadius: 6, border: "1px solid #7C3AED", background: "#F5F3FF", color: "#6D28D9", fontSize: 11, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
          {busy ? "Uploading…" : "Upload a JSON export as the shared data"}
          <input type="file" accept=".json,application/json" disabled={busy} style={{ display: "none" }} onChange={async e => {
            const file = e.target.files && e.target.files[0]; e.target.value = ""; if (!file) return;
            try {
              const parsed = storesFromExport(await file.text());
              const when = parsed.meta?.exportedAt ? String(parsed.meta.exportedAt).replace("T", " ").slice(0, 16) + " UTC" : "unknown time";
              if (!(await uiConfirm({ title: "Please confirm", message: `Make the file "${file.name}" the shared data${ENV_LABEL ? ` (${ENV_LABEL})` : ""}?\n\nExported ${when}, app ${parsed.meta?.appVersion || "?"}.\nIt holds: ${parsed.summary}.\n\nEveryone who signs in after this — you included — will see exactly this data; each browser keeps a snapshot of its own data first. Anything entered after the file was exported is NOT in it.` }))) return;
              setBusy(true); const n = await uploadStores(parsed.stores, userLabel); (await uiAlert({ message: `${n} stores uploaded from ${file.name} — the file's data is now the shared data, and this browser shows it.` }));
            } catch (x: any) { (await uiAlert({ message: String(x?.message || x) })); }
            setBusy(false);
          }} />
        </label>
      </>}
      {/* v7.1.1 (A-USR-2): the Sign out button now sits beside the person's initials in the top bar */}
      {(sync.notices || []).map(n => (   /* v7.14.0 (A-RV-01): what a merge with a colleague's save has to say — amber, a choice where there is one */
        <span key={`${n.kind}:${n.key}:${n.id}`} data-sync-notice={n.kind} style={{ padding: "2px 8px", borderRadius: 6, background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A" }}>
          {n.kind === "clash"
            ? <>{n.label}: {n.by || "a colleague"} changed it at the same time — their version is kept, yours is set aside <button onClick={() => { keepMine(n.key, n.id); }} style={{ marginLeft: 4, fontSize: 11, border: "1px solid #FDE68A", background: "#fff", borderRadius: 5, cursor: "pointer" }}>Use mine</button></>
            : <>your new {n.label} is now {n.to} — {n.by || "a colleague"} took that number meanwhile</>}
          <button onClick={() => dismissNotice(n.key, n.id, n.kind)} style={{ marginLeft: 4, fontSize: 11, border: "1px solid #FDE68A", background: "#fff", borderRadius: 5, cursor: "pointer" }}>OK</button>
        </span>))}
      {sync.conflicts.map(k => <span key={k} style={{ padding: "2px 8px", borderRadius: 6, background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A" }}>{k}: a colleague{sync.by?.[k] ? ` (${sync.by[k]})` : ""} saved first — their copy was taken; your last change is kept as a conflict copy <button onClick={() => clearConflict(k)} style={{ marginLeft: 6, border: "none", background: "none", color: "#92400E", cursor: "pointer", fontWeight: 800 }}>✓</button></span>)}
    </span>
  );
}

/** v6.99.149 (owner 5 Oct): the strip across the top of a TEST copy — impossible to confuse with the real one. */
export function EnvironmentStrip() {
  if (!ENV_LABEL) return null;
  return <div style={{ background: "#7C3AED", color: "#fff", textAlign: "center", fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", padding: "4px 0", flexShrink: 0 }}>{ENV_LABEL} DATA — this is the test copy; nothing here touches the real data</div>;
}
