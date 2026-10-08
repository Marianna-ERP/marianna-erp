// v7.4.2 (A-REC-1, owner 6–7 Oct): "Recover from a backup" — compare, tick, bring back with what each record needs; nothing removed.
import React, { useEffect, useState } from "react";
import { compareBackup, planRecovery, applyRecovery, labelOf, StoreDiff } from "./recovery.domain";
import { listSnapshots, readSnapshot, readSharedNow, replaceSharedStores, sharedCopyAsExport, storesFromExport, readSession, isSharedMode } from "./remoteStore";
import { readStoreValue, writeSharedStoreValue, STORAGE_VERSION } from "./useLocalStoredState";
import { APP_VERSION } from "./version";
import { recordAudit } from "./audit";
import { localTodayISO } from "./dates";

const btn: any = { padding: "7px 14px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };
const fmtWhen = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); };

export default function RecoveryPanel({ onClose }: { onClose: () => void }) {
  const [snaps, setSnaps] = useState<string[]>([]); const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  const [source, setSource] = useState<{ label: string; stores: Record<string, any> } | null>(null);
  const [current, setCurrent] = useState<Record<string, any>>({}); const [diffs, setDiffs] = useState<StoreDiff[]>([]);
  const [ticked, setTicked] = useState<Record<string, boolean>>({}); const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => { if (isSharedMode()) listSnapshots().then(setSnaps); }, []);
  async function load(label: string, stores: Record<string, any>) {
    setBusy("Comparing…"); setErr("");
    try {
      const now = isSharedMode() ? await readSharedNow() : Object.fromEntries(Object.keys(stores).map(k => [k, readStoreValue(k)]));
      setCurrent(now); setSource({ label, stores }); setDiffs(compareBackup(now, stores)); setTicked({});
    } catch (e: any) { setErr(String(e?.message || e)); }
    setBusy("");
  }
  const tk = (key: string, rec: any) => `${key}|${rec?.id ?? rec?.number}`;
  const chosen = diffs.flatMap(d => [...d.missing.map(r => ({ key: d.key, rec: r })), ...d.differ.map(x => ({ key: d.key, rec: x.backup }))]).filter(c => ticked[tk(c.key, c.rec)]);
  async function recover() {
    if (!source || !chosen.length) return;
    const plan = planRecovery(current, source.stores, chosen);
    const extra = plan.take.filter(t => t.why !== "chosen");
    const lines = plan.take.map(t => `${t.why === "chosen" ? "•" : "  ↳"} ${t.key}: ${labelOf(t.rec)}${t.why === "chosen" ? "" : ` (${t.why})`}`);
    if (!window.confirm(`Bring back ${chosen.length} record(s) from ${source.label}${extra.length ? `, with ${extra.length} record(s) they need` : ""}?\n\n${lines.slice(0, 40).join("\n")}${lines.length > 40 ? `\n… +${lines.length - 40} more` : ""}\n\nNothing that exists now is removed.${isSharedMode() ? " The shared data as it is now is downloaded first." : ""}`)) return;
    setBusy("Recovering…");
    try {
      const next = applyRecovery(current, plan);
      if (isSharedMode()) {
        const json = await sharedCopyAsExport(APP_VERSION, STORAGE_VERSION); const blob = new Blob([json], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `marianna-shared-copy-before-recovery-${localTodayISO()}.json`; document.body.appendChild(a); a.click(); a.remove();
        await replaceSharedStores(next, readSession()?.email || "");
      } else Object.entries(next).forEach(([k, v]) => writeSharedStoreValue(k, v));
      recordAudit({ module: "System", docType: "Recovery", docNumber: source.label, action: "updated", summary: `recovered ${plan.take.length} record(s): ${plan.take.map(t => labelOf(t.rec)).join(", ").slice(0, 700)}` });
      window.alert(`${plan.take.length} record(s) brought back. The page reloads to show them.`); window.location.reload();
    } catch (e: any) { setErr(`Recovery failed: ${String(e?.message || e)}`); setBusy(""); }
  }
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: 860, maxWidth: "96vw", maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #EBEBEB" }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Recover from a backup</div>
          <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>Choose a backup; tick what to bring back. Each record returns with what it needs; nothing that exists now is removed.</div>
        </div>
        <div style={{ padding: 22 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <label style={{ ...btn, display: "inline-block" }}>Choose a backup file…<input type="file" accept=".json,application/json" style={{ display: "none" }} onChange={async e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return; try { const p = storesFromExport(await f.text()); await load(`${f.name}`, p.stores); } catch (x: any) { setErr(String(x?.message || x)); } }} /></label>
            {isSharedMode() && <select value="" onChange={async e => { const t = e.target.value; if (!t) return; setBusy("Reading the snapshot…"); try { await load(`the snapshot of ${fmtWhen(t)}`, await readSnapshot(t)); } catch (x: any) { setErr(String(x?.message || x)); setBusy(""); } }} style={{ ...btn, fontWeight: 600 }}>
              <option value="">{snaps.length ? "…or a Supabase snapshot" : "no Supabase snapshot yet (guide step 6)"}</option>
              {snaps.map(s => <option key={s} value={s}>{fmtWhen(s)}</option>)}
            </select>}
            {busy && <span style={{ fontSize: 12, color: "#B45309", fontWeight: 700 }}>{busy}</span>}
            {err && <span style={{ fontSize: 12, color: "#DC2626", fontWeight: 700 }}>{err}</span>}
          </div>
          {source && <div style={{ fontSize: 12.5, color: "#334155", marginBottom: 8 }}>Comparing <b>{source.label}</b> with today's data:</div>}
          {source && diffs.map(d => (
            <div key={d.key} style={{ border: "1px solid #EBEBEB", borderRadius: 8, marginBottom: 8 }}>
              <div onClick={() => setOpen(o => ({ ...o, [d.key]: !o[d.key] }))} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", cursor: "pointer", fontSize: 12.5, background: "#F9FAFB" }}>
                <b>{d.label}</b>
                <span style={{ color: d.missing.length || d.differ.length ? "#B45309" : "#94A3B8", fontWeight: 700 }}>{d.missing.length} missing now · {d.differ.length} different · {d.added.length} added since</span>
              </div>
              {open[d.key] && (d.missing.length + d.differ.length > 0) && <div style={{ padding: "6px 12px 10px" }}>
                {d.missing.map(r => <label key={tk(d.key, r)} style={{ display: "flex", gap: 8, fontSize: 12.5, padding: "2px 0" }}><input type="checkbox" checked={!!ticked[tk(d.key, r)]} onChange={e => setTicked(t => ({ ...t, [tk(d.key, r)]: e.target.checked }))} /><span><b>{labelOf(r)}</b> <span style={{ color: "#B45309" }}>missing now</span></span></label>)}
                {d.differ.map(x => <label key={tk(d.key, x.backup)} style={{ display: "flex", gap: 8, fontSize: 12.5, padding: "2px 0" }}><input type="checkbox" checked={!!ticked[tk(d.key, x.backup)]} onChange={e => setTicked(t => ({ ...t, [tk(d.key, x.backup)]: e.target.checked }))} /><span><b>{labelOf(x.backup)}</b> <span style={{ color: "#64748B" }}>differs — ticked, the backup's version replaces today's</span></span></label>)}
              </div>}
            </div>
          ))}
        </div>
        <div style={{ padding: "12px 22px", borderTop: "1px solid #EBEBEB", display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#64748B", marginRight: "auto" }}>{chosen.length ? `${chosen.length} record(s) ticked` : "nothing ticked"}</span>
          <button onClick={onClose} style={btn}>Close</button>
          <button disabled={!chosen.length || !!busy} onClick={recover} style={{ ...btn, border: "none", background: chosen.length ? "#16A34A" : "#E5E7EB", color: chosen.length ? "#fff" : "#94A3B8" }}>Bring back</button>
        </div>
      </div>
    </div>
  );
}
