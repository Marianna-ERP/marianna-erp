// ─── v6.4.1: shared LOCAL date helpers ──────────────────────────────────────
// new Date().toISOString() returns UTC: between local midnight and ~01:00/02:00
// Polish time, "today" came out as YESTERDAY. These helpers use local time.
export function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function localMonthISO(): string {
  return localTodayISO().slice(0, 7);
}

// ─── v6.18.15: one display format everywhere → dd/mm/yyyy ────────────────────
// Accepts an ISO date ("2026-06-25"), an ISO datetime, or a Date. Returns "" for
// empty/invalid input so it can wrap any field safely without throwing.
export function formatDMY(value: any): string {
  if (value == null || value === "") return "";
  let y: number, m: number, d: number;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return "";
    y = value.getFullYear(); m = value.getMonth() + 1; d = value.getDate();
  } else {
    const s = String(value).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // yyyy-mm-dd[...]
    if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
    else {
      const parsed = new Date(s);
      if (isNaN(parsed.getTime())) return s; // unknown format — leave as-is
      y = parsed.getFullYear(); m = parsed.getMonth() + 1; d = parsed.getDate();
    }
  }
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}
