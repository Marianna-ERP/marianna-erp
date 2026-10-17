// storeShapes.ts — v7.24.3 (FZ-01 step 2, owner approved 15 Oct): A SAVE WRITES THE CLEAN SHAPE.
// The tidy-ups (companies, POs, SOs, lots, invoices) used to run once when the app opened — on the browser's cached copy, never
// on the shared data that arrives after it, so old fields kept coming back (the owner's files of 15 Oct: 18 POs, 50 lots, 77
// invoices still carrying them). They now run on what a save WRITES: every record that is new or changed passes through its
// tidy-up on its way into the store; records nobody touched are left exactly as they are.

/** The store after a write: each record that is new or changed (not the same object as before) is passed through `shape`. */
export function shapeWritten(prev: any[] | null | undefined, next: any, shape: (rec: any) => any): any {
  if (!Array.isArray(next) || next === prev) return next;
  const was = new Set(prev || []);
  let changed = false;
  const out = next.map((r: any) => { if (!r || typeof r !== "object" || was.has(r)) return r; const s = shape(r); if (s !== r) changed = true; return s; });
  return changed ? out : next;
}

/** A store setter that tidies what it writes (the same call shapes as React's setState: a value or an updater). */
export function shapingSetter(set: (u: any) => void, shape: (rec: any) => any): (u: any) => void {
  return (u: any) => set((prev: any[]) => shapeWritten(prev, typeof u === "function" ? u(prev) : u, shape));
}
