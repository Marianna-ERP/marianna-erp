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

// v7.21.13 (FZ-15, owner 12 Oct): AN ID TWO BROWSERS CANNOT SHARE. On the shared data "the highest id I have seen + 1" let two
// browsers that saw the same data mint the same next id — and the record merge then took two documents for one. An id is now
// the millisecond × 1000 + this browser's own tag (0–999, drawn once and kept): two browsers with different tags can never
// produce the same id, and one browser never repeats itself (a second id in the same millisecond moves to the next one).
// Ids keep their size and still sort by time. Existing ids never change.
const TAG_KEY = "marianna-erp:idTag";
let tag = -1;
function loadTag(): number {
  if (tag >= 0) return tag;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const t = parseInt(String(window.localStorage.getItem(TAG_KEY) ?? ""), 10);
      if (Number.isInteger(t) && t >= 0 && t < 1000) { tag = t; return tag; }
    }
  } catch { /* fall through to a fresh tag */ }
  tag = Math.floor(Math.random() * 1000);
  try { if (typeof window !== "undefined" && window.localStorage) window.localStorage.setItem(TAG_KEY, String(tag)); } catch { /* best effort */ }
  return tag;
}

// The single id minting function. Always returns a fresh, larger integer, ending in this browser's tag.
export function nextId(): number {
  loadCounter();
  const ms = Math.max(Date.now(), Math.floor(counter / 1000) + 1);
  counter = ms * 1000 + loadTag();
  persist();
  return counter;
}


// Raise the counter above every id present in the supplied collections. Call this
// once at startup with all loaded entities (and after importing a JSON file), so
// the generator can never collide with ids that arrived from storage or an import.
export function primeIdsFrom(...collections: any[][]): void {
  loadCounter();
  let max = counter;
  // v7.21.13 (FZ-15): every nested record counts (payments, units, bookings, claim lines…), not six named arrays; only ids in a
  // number's exact range — a computed site id (company id × 100, A-ID-1) is not an id and must not push the counter past it
  const visit = (v: any, depth: number) => {
    if (depth > 5 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(x => visit(x, depth + 1)); return; }
    const id = Number(v.id);
    if (Number.isSafeInteger(id) && id < 1e16 && id > max) max = id;
    Object.keys(v).forEach(k => { const x = v[k]; if (x !== null && typeof x === "object") visit(x, depth + 1); });
  };
  collections.forEach(list => visit(list, 0));
  if (max > counter) { counter = max; persist(); }
}
