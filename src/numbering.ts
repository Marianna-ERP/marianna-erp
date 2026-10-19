// numbering.ts — v7.27.8 (A-W5, owner ruling 19 Oct 2026, RM-2 F-2): NEW NUMBERS FROM THE DATABASE'S SHARED COUNTER.
// Every new PO, SO, shipment, lot, claim, loading protocol and settlement takes its number here when it is created or
// saved: the database counter (supabase/numbering.sql) gives each browser its own number, so two people can never give
// out the same one. The counter starts from the highest number the app already holds (the "floor"). Where the app runs
// without the shared database (a browser-only copy, the checks), or before the script is installed, the number is the
// highest in use + 1 — as before — and Settings → Numbering says so.
import { REMOTE_URL, REMOTE_KEY, rpc } from "./remoteStore";

export type NumberKind = "PO" | "SO" | "SHP" | "LOT" | "CLM" | "LP" | "SET";
export type NumberSource = "database" | "browser";

/** The highest serial of KIND-YEAR-NNNN among the numbers given. */
export function highestInUse(numbers: any[], kind: NumberKind, year: number): number {
  const re = new RegExp(`^${kind}-${year}-(\\d+)$`);
  return (numbers || []).reduce((mx: number, n: any) => { const m = String(n ?? "").trim().match(re); return m ? Math.max(mx, parseInt(m[1], 10) || 0) : mx; }, 0);
}
export function formatDocNumber(kind: NumberKind, year: number, serial: number): string { return `${kind}-${year}-${String(serial).padStart(4, "0")}`; }

let lastSource: NumberSource | null = null; let lastProblem = "";
/** Where the last number came from, and why not the database if it did not — read by Settings → Numbering. */
export function numberingStatus(): { source: NumberSource | null; problem: string } { return { source: lastSource, problem: lastProblem }; }

/** Take COUNT consecutive numbers of KIND for YEAR. inUse: the numbers the app holds for that kind (the floor). */
export async function issueNumbers(kind: NumberKind, year: number, inUse: any[], count = 1): Promise<{ numbers: string[]; source: NumberSource }> {
  const floor = highestInUse(inUse, kind, year); const n = Math.max(1, Math.floor(count));
  const local = () => ({ numbers: Array.from({ length: n }, (_, i) => formatDocNumber(kind, year, floor + 1 + i)), source: "browser" as NumberSource });
  if (!REMOTE_URL || !REMOTE_KEY) { lastSource = "browser"; lastProblem = "this copy runs without the shared database"; return local(); }
  try {
    const res = await rpc("next_doc_numbers", { p_kind: kind, p_year: year, p_floor: floor, p_count: n });
    if (!res.ok) { lastSource = "browser"; lastProblem = res.status === 404 ? "the counter is not installed (supabase/numbering.sql)" : `the database answered ${res.status}`; return local(); }
    const first = Number(await res.json());
    if (!(first > 0)) { lastSource = "browser"; lastProblem = "the database gave no number"; return local(); }
    lastSource = "database"; lastProblem = "";
    return { numbers: Array.from({ length: n }, (_, i) => formatDocNumber(kind, year, first + i)), source: "database" };
  } catch (e: any) { lastSource = "browser"; lastProblem = String(e?.message || e || "no connection"); return local(); }
}
export async function issueNumber(kind: NumberKind, year: number, inUse: any[]): Promise<string> { return (await issueNumbers(kind, year, inUse, 1)).numbers[0]; }

/** Is the counter installed in this copy's database? null when the copy has no shared database. */
export async function counterInstalled(): Promise<boolean | null> {
  if (!REMOTE_URL || !REMOTE_KEY) return null;
  try { const r = await rpc("doc_counters_ready", {}); return r.ok; } catch { return false; }
}
