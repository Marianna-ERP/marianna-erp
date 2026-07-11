// ─── STABLE ID GENERATION ───────────────────────────────────────────────────
//
// Root-cause fix: ids must be stable and NEVER reused. The app previously minted
// ids as `Math.max(existing)+1` (recycles an id after the highest record is
// deleted) or `Date.now()` (collides when several records are created in the same
// millisecond, e.g. lots generated in a loop). Either way a reused id can silently
// re-point a saved counterparty snapshot — or any cross-module reference — to the
// wrong record.
//
// This module hands out monotonically increasing integer ids from a counter that
// is persisted in localStorage, so it survives reloads and never goes backwards.
// A reused id is therefore impossible within a browser. To stay safe even across
// devices/imports, the counter is seeded above the maximum id already present in
// loaded data (see `primeIdsFrom`).
//
// Ids remain plain numbers, so all existing `String(id)` comparisons keep working
// and nothing downstream needs to change.

const COUNTER_KEY = "marianna-erp:idCounter";

// In-memory mirror so rapid successive calls within one tick don't race on storage.
let counter = 0;
let loaded = false;

function loadCounter(): number {
  if (loaded) return counter;
  loaded = true;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const raw = window.localStorage.getItem(COUNTER_KEY);
      counter = raw ? Math.max(0, parseInt(raw, 10) || 0) : 0;
    }
  } catch { counter = 0; }
  // Floor: never start below a millisecond timestamp, so ids minted now always sort
  // after ids created by the previous `Date.now()` scheme in already-saved data.
  const floor = Date.now();
  if (counter < floor) counter = floor;
  return counter;
}

function persist() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(COUNTER_KEY, String(counter));
    }
  } catch { /* best-effort; in-memory counter still monotonic this session */ }
}

// The single id minting function. Always returns a fresh, larger integer.
export function nextId(): number {
  loadCounter();
  counter += 1;
  persist();
  return counter;
}

// Convenience for code that wants several ids at once (e.g. lots in a loop).
export function nextIds(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(nextId());
  return out;
}

// Raise the counter above every id present in the supplied collections. Call this
// once at startup with all loaded entities (and after importing a JSON file), so
// the generator can never collide with ids that arrived from storage or an import.
export function primeIdsFrom(...collections: any[][]): void {
  loadCounter();
  let max = counter;
  const scan = (list: any[]) => {
    (list || []).forEach((rec: any) => {
      const id = Number(rec?.id);
      if (isFinite(id) && id > max) max = id;
      // Scan one level of common nested id-bearing arrays.
      ["contacts", "items", "movements", "costs", "legs", "commissionRates"].forEach(k => {
        (rec?.[k] || []).forEach((child: any) => {
          const cid = Number(child?.id);
          if (isFinite(cid) && cid > max) max = cid;
        });
      });
    });
  };
  collections.forEach(scan);
  if (max > counter) { counter = max; persist(); }
}
