import { ENV_LABEL } from "./remoteStore";
// ─── v6.99.70 (A-BK-1, owner 27 Sept): the backup folder card (Settings) and the backup banner (App) ────────────────
// Each is a pure VIEW over the status (so the render smoke can open every case) plus a thin connected wrapper.
// Button vocabulary (A-BT-1): the action that saves = green · leave it for now / stop = white.
import React, { useState } from "react";
import { Card, SectionTitle, SmallButton, useConfirm } from "./ui";
import { localDay, KEEP_NEWEST, KEEP_DAILY_DAYS } from "./autoBackup.domain";
import {
  AutoBackupStatus, useAutoBackupStatus, chooseBackupFolder, backupNow, stopFolderBackup, resumeBackupFolder,
  downloadAllData, snoozeBackupBanner, bannerFor,
} from "./autoBackup";

function when(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso); if (isNaN(d.getTime())) return "—";
  const today = localDay(new Date()) === localDay(d);
  return today ? `today ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : d.toLocaleString([], { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const ROW: any = { display: "grid", gridTemplateColumns: "150px 1fr", gap: 8, fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid #F5F5F5" };
const KEY: any = { color: "#888", fontWeight: 600 };

export function AutoBackupCardView({ status, onChoose, onBackupNow, onStop, onDownload, message = null }: any) {
  const st: AutoBackupStatus = status;
  const set = st.mode === "active" || st.mode === "paused" || st.mode === "failed";
  const modeLine = st.mode === "active" ? { text: "On", color: "#16A34A" }
    : st.mode === "paused" ? { text: "Paused — the browser needs your permission again (Back up to folder now resumes it)", color: "#B45309" }
    : st.mode === "failed" ? { text: "Last write failed", color: "#DC2626" }
    : st.mode === "starting" ? { text: "Starting…", color: "#888" }
    : { text: "Not set up", color: "#B45309" };
  return (
    <Card style={{ marginBottom: 16, padding: "20px 22px" }}>
      <SectionTitle>AUTOMATIC BACKUP FOLDER</SectionTitle>
      {ENV_LABEL && <div style={{ fontSize: 12, color: "#6D28D9", fontWeight: 700, marginBottom: 8 }}>{ENV_LABEL} copy — its files are named marianna-erp-{ENV_LABEL}_auto_… ; choose a separate folder from the real copy's.</div>}{/* v7.1.9 (A-BK-6) */}
      {st.mode === "unsupported" ? (
        <>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
            This browser can't write to a folder — Chrome and Edge can. Here, a strip at the top offers <strong>Download today's backup</strong> once a day; keep those files somewhere other than this computer. Any <strong>Export all data</strong> counts as today's backup.
          </div>
          <div style={ROW}><div style={KEY}>Last download</div><div>{st.lastDownloadDay ? (st.lastDownloadDay === localDay(new Date()) ? "today" : st.lastDownloadDay) : "—"}</div></div>
          <div style={{ marginTop: 12 }}><SmallButton kind="green" onClick={onDownload}>Download today's backup</SmallButton></div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 14, lineHeight: 1.55 }}>
            A copy of all your data is written to a folder you choose — when the app opens, then two minutes after your changes stop (at most every 15 minutes). Choose a folder that <strong>OneDrive or Google Drive already syncs</strong>, so a copy leaves this computer. The newest {KEEP_NEWEST} files are kept, plus one per day for {KEEP_DAILY_DAYS} days. Each file is an ordinary <strong>Export all data</strong> file: to restore, use Import above.
          </div>
          <div style={ROW}><div style={KEY}>Status</div><div style={{ color: modeLine.color, fontWeight: 700 }}>{modeLine.text}</div></div>
          <div style={ROW}><div style={KEY}>Folder</div><div>{set ? (st.folderName || "—") : "—"}</div></div>
          <div style={ROW}><div style={KEY}>Last file</div><div>{st.lastFileName ? <>{when(st.lastWrittenAt)} · <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11.5 }}>{st.lastFileName}</span></> : "—"}</div></div>
          <div style={ROW}><div style={KEY}>Files kept</div><div>{st.filesKept || "—"}</div></div>
          {st.mode === "failed" && st.lastError && <div style={{ marginTop: 10, padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8, fontSize: 12.5, color: "#991B1B" }}>{st.lastError}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <SmallButton kind="green" onClick={onChoose} disabled={st.busy}>{set ? "Change folder…" : "Choose folder…"}</SmallButton>
            {set && <SmallButton kind="green" onClick={onBackupNow} disabled={st.busy}>{st.busy ? "Writing…" : "Back up to folder now"}</SmallButton>}
            {set && <SmallButton onClick={onStop} disabled={st.busy}>Stop automatic backup</SmallButton>}
          </div>
        </>
      )}
      {message && <div style={{ marginTop: 12, fontSize: 12.5, color: message.kind === "error" ? "#991B1B" : "#065F46" }}>{message.text}</div>}
    </Card>
  );
}

export function AutoBackupCard() {
  const st = useAutoBackupStatus();
  const { confirm, dialogNode } = useConfirm();
  const [message, setMessage] = useState<{ kind: string; text: string } | null>(null);
  return (
    <>
      {dialogNode}
      <AutoBackupCardView status={st} message={message}
        onChoose={async () => { const r = await chooseBackupFolder(); if (r.message) setMessage({ kind: r.ok ? "success" : "error", text: r.message }); }}
        onBackupNow={async () => { const ok = await backupNow(); setMessage(ok ? { kind: "success", text: "Backup written to the folder." } : { kind: "error", text: "The backup could not be written — see the status above." }); }}
        onStop={async () => {
          if (!(await confirm({ tone: "warn", title: "Stop automatic backup?", message: `The app stops writing to "${st.folderName}". The files already there stay.`, confirmLabel: "Stop", cancelLabel: "Keep backing up" }))) return;
          await stopFolderBackup(); setMessage({ kind: "success", text: "Automatic backup stopped. The files already in the folder stay." });
        }}
        onDownload={() => { try { const n = downloadAllData(); setMessage({ kind: "success", text: `Downloaded ${n}.` }); } catch (e: any) { setMessage({ kind: "error", text: "Download failed: " + String(e?.message || e) }); } }} />
    </>
  );
}

export function BackupBannerView({ kind, status, onChoose, onResume, onRetry, onDownload, onLater, onOpenSettings }: any) {
  if (kind === "none") return null;
  const red = kind === "failed";
  const text = kind === "notSet" ? <><strong>Automatic backup is not set up</strong> — your data lives only in this browser. Choose a folder once (ideally one OneDrive or Google Drive syncs) and the app keeps a copy there by itself.</>
    : kind === "paused" ? <><strong>Automatic backup is paused</strong> — the browser needs your permission again for the folder "{status.folderName}". One click resumes it.</>
    : kind === "failed" ? <><strong>Automatic backup failed.</strong> {status.lastError || "The last file could not be written."} Your data is safe in this browser; the folder copy is not up to date.</>
    : <><strong>Your data lives only in this browser</strong>, which can't write to a folder. Download today's backup and keep it somewhere other than this computer.</>;
  return (
    <div data-backup-banner={kind} style={{ background: red ? "#FEF2F2" : "#FEF3C7", borderBottom: `1px solid ${red ? "#FCA5A5" : "#FDE68A"}`, padding: "10px 28px", display: "flex", alignItems: "center", gap: 12, fontSize: 12.5, color: red ? "#991B1B" : "#92400E", flexShrink: 0 }}>
      <span style={{ fontSize: 15 }}>{red ? "🛑" : "💾"}</span>
      <span style={{ flex: 1, lineHeight: 1.45 }}>{text}</span>
      {kind === "notSet" && <SmallButton kind="green" onClick={onChoose}>Choose backup folder</SmallButton>}
      {kind === "paused" && <SmallButton kind="green" onClick={onResume}>Resume</SmallButton>}
      {kind === "failed" && <SmallButton kind="green" onClick={onRetry}>Retry</SmallButton>}
      {kind === "failed" && <SmallButton onClick={onOpenSettings}>Open Settings</SmallButton>}
      {kind === "unsupported" && <SmallButton kind="green" onClick={onDownload}>Download today's backup</SmallButton>}
      {!red && <SmallButton onClick={onLater}>Later</SmallButton>}
    </div>
  );
}

export function BackupBanner({ onOpenSettings }: any) {
  const st = useAutoBackupStatus();
  const kind = bannerFor(st, localDay(new Date()));
  return <BackupBannerView kind={kind} status={st} onOpenSettings={onOpenSettings}
    onChoose={async () => { await chooseBackupFolder(); }}
    onResume={async () => { await resumeBackupFolder(); }}
    onRetry={async () => { await backupNow(); }}
    onDownload={() => { try { downloadAllData(); } catch { /* the Settings card reports the details */ } }}
    onLater={() => snoozeBackupBanner()} />;
}
