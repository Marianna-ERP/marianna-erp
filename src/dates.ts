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
