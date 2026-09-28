// ─── v6.99.70 (A-BK-1..3, owner 27 Sept): AUTOMATIC BACKUPS — the pure rules ─────────────────────────────────────────
// The browser part (folder handle, file writes, the banner) lives in autoBackup.ts; everything that DECIDES lives here,
// so the tests can pin it without a browser. Four rules:
//   1. the file name — one pattern, local time, so the folder sorts by date and the owner can find "yesterday afternoon";
//   2. retention — the newest 30 files, plus the newest file of each of the last 30 days; files that are not ours are
//      never touched (a manual export dropped into the same folder stays);
//   3. timing — on opening, then two minutes after the changes stop, at most every 15 minutes (and at the 15-minute mark
//      when the changes never stop); nothing is written when the data equals the last file;
//   4. the local ring — snapshots are kept while the whole browser store stays under 70 % of its budget (the level at which
//      Settings turns amber); the newest snapshot is always kept.

export const AUTO_PREFIX = "marianna-erp_auto_";
const AUTO_RE = /^marianna-erp_auto_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})_v[0-9A-Za-z.-]+\.json$/;

export const KEEP_NEWEST = 30;
export const KEEP_DAILY_DAYS = 30;
export const QUIET_MS = 2 * 60 * 1000;          // "two minutes after your changes stop"
export const MIN_INTERVAL_MS = 15 * 60 * 1000;  // "at most every 15 minutes"
export const TICK_MS = 30 * 1000;               // how often the app looks

const pad = (n: number) => String(n).padStart(2, "0");
/** The local calendar day, YYYY-MM-DD (not UTC: a file written at 01:30 in Warsaw belongs to that day). */
export function localDay(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/** marianna-erp_auto_2026-09-27_16-30-05_v6.99.70.json */
export function autoFileName(now: Date, appVersion: string): string {
  return `${AUTO_PREFIX}${localDay(now)}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}_v${appVersion}.json`;
}

export function parseAutoFileName(name: string): { day: string; stamp: string } | null {
  const m = AUTO_RE.exec(String(name || ""));
  if (!m) return null;
  return { day: m[1], stamp: `${m[1]}T${m[2]}:${m[3]}:${m[4]}` };
}

/** Which automatic files to keep and which to delete. Only names matching our pattern are ever listed in either. */
export function planRetention(names: string[], now: Date, keepNewest = KEEP_NEWEST, keepDays = KEEP_DAILY_DAYS): { keep: string[]; remove: string[] } {
  const ours = (names || [])
    .map(n => ({ n, p: parseAutoFileName(n) }))
    .filter((x): x is { n: string; p: { day: string; stamp: string } } => !!x.p)
    .sort((a, b) => b.p.stamp.localeCompare(a.p.stamp) || b.n.localeCompare(a.n));
  const keep = new Set<string>();
  ours.slice(0, keepNewest).forEach(x => keep.add(x.n));
  const firstDay = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (keepDays - 1)));
  const seen = new Set<string>();
  ours.forEach(x => { if (x.p.day >= firstDay && !seen.has(x.p.day)) { seen.add(x.p.day); keep.add(x.n); } });
  return { keep: ours.filter(x => keep.has(x.n)).map(x => x.n), remove: ours.filter(x => !keep.has(x.n)).map(x => x.n) };
}

// ── timing ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface BackupClock {
  seenFp: string;      // the data as the app last looked at it ("" = not looked yet in this session)
  changedAt: number;   // when the data last changed (0 = not since opening)
  dirtySince: number;  // when the data first differed from the last file (0 = it doesn't)
  wroteAt: number;     // last write attempt (success or failure) — the 15-minute limit counts from here
  writtenFp: string;   // the data in the last file actually written
}
export const EMPTY_CLOCK: BackupClock = { seenFp: "", changedAt: 0, dirtySince: 0, wroteAt: 0, writtenFp: "" };

/** One look at the data. Returns the updated clock and whether to write a file now. */
export function tick(c: BackupClock, fp: string, now: number): { clock: BackupClock; write: boolean } {
  const k: BackupClock = { ...c };
  if (!k.seenFp) k.seenFp = fp;                                  // the first look after opening is not a change
  else if (fp !== k.seenFp) { k.seenFp = fp; k.changedAt = now; }
  const dirty = !!fp && fp !== k.writtenFp;
  if (!dirty) { k.dirtySince = 0; return { clock: k, write: false }; }
  if (!k.dirtySince) k.dirtySince = now;
  if (k.wroteAt && now - k.wroteAt < MIN_INTERVAL_MS) return { clock: k, write: false };
  const quiet = now - k.changedAt >= QUIET_MS;
  const longDirty = now - k.dirtySince >= MIN_INTERVAL_MS;
  return { clock: k, write: quiet || longDirty };
}
export function afterWrite(c: BackupClock, fp: string, now: number): BackupClock { return { ...c, writtenFp: fp, wroteAt: now, dirtySince: 0 }; }
/** A failed write waits the same 15 minutes before the next automatic try — no retry storm; Retry in the banner is immediate. */
export function afterFailure(c: BackupClock, now: number): BackupClock { return { ...c, wroteAt: now }; }

/** A cheap fingerprint of the stored data (FNV-1a over key + raw value, plus the total length). Equal data → equal print. */
export function fingerprint(entries: Array<[string, string | null | undefined]>): string {
  let h = 0x811c9dc5; let len = 0;
  for (const [key, raw] of entries) {
    const s = `${key}\u0001${raw == null ? "" : raw}\u0002`;
    len += s.length;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  }
  return `${len}:${(h >>> 0).toString(16)}`;
}

// ── the local ring (BK-3) ───────────────────────────────────────────────────────────────────────────────────────────
export const RING_CEILING = 0.7;   // the Settings gauge turns amber at 70 % — the ring alone must never push it there
export const RING_MAX_COUNT = 20;  // a list-length bound only; space is the real limit
/** Oldest-first ring in, ids to drop out: the oldest go while the store is over the ceiling; the newest always stays. */
export function planRingPrune(ring: Array<{ id: string; chars: number }>, liveChars: number, budgetChars: number, ceiling = RING_CEILING, maxCount = RING_MAX_COUNT): string[] {
  const list = (ring || []).slice();
  const drop: string[] = [];
  const total = () => liveChars + list.reduce((s, b) => s + (b.chars || 0), 0);
  while (list.length > 1 && (list.length > maxCount || total() > ceiling * budgetChars)) drop.push(list.shift()!.id);
  return drop;
}

/** The storage error that means "full" — the only one for which dropping a snapshot can help. */
export function isQuotaError(err: any): boolean {
  const name = String(err?.name || ""); const code = Number(err?.code);
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014;
}
