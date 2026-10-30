// storeMerge.domain.ts — v7.14.0 (A-RV-01, owner 9 Oct): when a colleague saved the same kind of record first, MERGE RECORD BY RECORD
// instead of setting my whole change aside. Pure (no network, no storage): base = the copy I last saw, mine = what I am saving,
// theirs = what the colleague saved.
//   · a record only I changed (or added, or removed) → mine
//   · a record only they changed → theirs
//   · a record we BOTH changed differently → theirs stays, mine is kept aside and named, so the person can choose (a clash)
//   · a NEW document of mine whose number a colleague took meanwhile → the next free number, named (never two documents with one
//     number); not when other stores already point at that number — then it is a clash to settle by hand
// A store that is not a list of records with ids, nor a plain object, returns null: the old rule applies (theirs, mine aside).

export interface MergeClash { id: string; label: string; mine: any }
export interface MergeRenumber { id: string; from: string; to: string }
export interface MergeResult { merged: any; clashes: MergeClash[]; renumbered: MergeRenumber[]; mineApplied: number }

const eq = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
const idOf = (r: any): string | null => (r && typeof r === "object" && r.id !== undefined && r.id !== null && r.id !== "" ? String(r.id) : null);
const labelOf = (r: any) => String(r?.number || r?.name || r?.label || r?.docNumber || r?.id || "");
const isPlainObject = (v: any) => !!v && typeof v === "object" && !Array.isArray(v);

/** The stores whose documents carry a number the app gives out (prefix-YEAR-NNNN). */
const NUMBERED_STORES = ["pos", "orders", "shipments", "lots", "claims"];

/** The next free number in the series of `num` (same prefix, same width), given the numbers in use. */
export function nextFreeNumber(num: string, inUse: string[]): string {
  const m = /^(.*?)(\d+)$/.exec(String(num || "")); if (!m) return "";
  const [, prefix, digits] = m;
  let max = 0; (inUse || []).forEach(u => { const x = /^(.*?)(\d+)$/.exec(String(u || "")); if (x && x[1] === prefix) max = Math.max(max, parseInt(x[2], 10)); });
  return prefix + String(max + 1).padStart(digits.length, "0");
}

export function mergeStore(key: string, base: any, mine: any, theirs: any, referencedElsewhere: (num: string) => boolean = () => false): MergeResult | null {
  // ── lists of records with ids (orders, POs, lots, shipments, invoices, the audit log, …) ──
  if (Array.isArray(mine) && Array.isArray(theirs) && (base === undefined || base === null || Array.isArray(base))) {
    const b = Array.isArray(base) ? base : [];
    if (![...b, ...mine, ...theirs].every(r => idOf(r) !== null)) return null;
    const bM = new Map(b.map(r => [idOf(r) as string, r])); const mM = new Map(mine.map(r => [idOf(r) as string, r])); const tM = new Map(theirs.map(r => [idOf(r) as string, r]));
    const clashes: MergeClash[] = []; let mineApplied = 0;
    const decide = (id: string): any => {
      const br = bM.get(id), mr = mM.get(id), tr = tM.get(id);
      const mineChanged = !eq(mr, br), theirsChanged = !eq(tr, br);
      if (!mineChanged) return tr;
      if (!theirsChanged) { mineApplied++; return mr; }
      if (eq(mr, tr)) return tr;
      clashes.push({ id, label: labelOf(mr || tr || br), mine: mr ?? null }); return tr;
    };
    const merged: any[] = [];
    theirs.forEach(r => { const v = decide(idOf(r) as string); if (v !== undefined) merged.push(v); });
    mine.forEach(r => { const id = idOf(r) as string; if (tM.has(id)) return; if (bM.has(id)) { const v = decide(id); if (v !== undefined) merged.push(v); return; } mineApplied++; merged.push(r); });
    // numbers: a new document of mine may not share its number with a colleague's
    const renumbered: MergeRenumber[] = [];
    if (NUMBERED_STORES.includes(key)) {
      merged.forEach((r, i) => {
        const id = idOf(r) as string; if (bM.has(id) || tM.has(id) || !r?.number) return;
        const clash = merged.some((o, j) => j !== i && String(o?.number) === String(r.number));
        if (!clash) return;
        if (referencedElsewhere(String(r.number))) { clashes.push({ id, label: `${r.number} (number taken meanwhile; other records already point at it)`, mine: r }); return; }
        const to = nextFreeNumber(String(r.number), merged.map(o => String(o?.number || "")));
        if (!to) return;
        renumbered.push({ id, from: String(r.number), to }); merged[i] = { ...r, number: to };
      });
    }
    return { merged, clashes, renumbered, mineApplied };
  }
  // ── plain objects (company, numbering, heals, FX settings, …): key by key ──
  if (isPlainObject(mine) && isPlainObject(theirs) && (base === undefined || base === null || isPlainObject(base))) {
    const b = isPlainObject(base) ? base : {};
    const out: any = {}; const clashes: MergeClash[] = []; let mineApplied = 0;
    Array.from(new Set([...Object.keys(theirs), ...Object.keys(mine), ...Object.keys(b)])).forEach(k => {
      const br = b[k], mr = mine[k], tr = theirs[k];
      let v: any;
      if (eq(mr, br)) v = tr; else if (eq(tr, br)) { v = mr; mineApplied++; } else if (eq(mr, tr)) v = tr; else { v = tr; clashes.push({ id: k, label: k, mine: mr ?? null }); }
      if (v !== undefined) out[k] = v;
    });
    return { merged: out, clashes, renumbered: [], mineApplied };
  }
  return null;
}
