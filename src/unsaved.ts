// ─────────────────────────────────────────────────────────────────────────────
// unsaved.ts — v6.99.58 (A-US-1…4, owner 25 Sept)
// Typing into a form and jumping to another module lost the work. Every editor that holds a draft registers here while
// it is open; every way of leaving a module asks the registry first. "Dirty" means the draft differs from what the
// editor looked like once it had opened and settled — so opening and closing without a change never asks.
// Deliberately NOT auto-save: saving still goes through the editor's own Save, with every gate.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from "react";

export interface UnsavedEntry { id: string; label: string; isDirty: () => boolean; save?: () => any; }
const registry = new Map<string, UnsavedEntry>();

export function registerUnsaved(e: UnsavedEntry): () => void {
  registry.set(e.id, e);
  return () => { if (registry.get(e.id) === e) registry.delete(e.id); };
}
export function dirtyEntries(): UnsavedEntry[] {
  return Array.from(registry.values()).filter(e => { try { return e.isDirty(); } catch { return false; } });
}
/** The editors open right now (dirty or not) — for the tests and the dialog. */
export function openEditors(): string[] { return Array.from(registry.values()).map(e => e.label); }
function snapshot(v: any): string { try { return JSON.stringify(v ?? null); } catch { return String(Math.random()); } }

/** The time an editor is given to settle (derivations run on mount) before its baseline is taken. */
const SETTLE_MS = 400;

/** Register the editor while `active`. `save` is the editor's own Save — the same function its button calls. */
/** `resetKey`: an editor that stays open after saving (it clears itself) passes something that changes on save, so it re-baselines. */
export function useUnsavedGuard(opts: { id: string; label: string; draft: any; save?: () => any; active?: boolean; resetKey?: any }) {
  const active = opts.active !== false;
  const draftRef = useRef<any>(opts.draft); draftRef.current = opts.draft;
  const saveRef = useRef<any>(opts.save); saveRef.current = opts.save;
  const labelRef = useRef<string>(opts.label); labelRef.current = opts.label;
  const baseline = useRef<string | null>(null);
  useEffect(() => {
    if (!active) return;
    baseline.current = null;
    const t = setTimeout(() => { baseline.current = snapshot(draftRef.current); }, SETTLE_MS);
    const off = registerUnsaved({
      id: opts.id,
      get label() { return labelRef.current; },
      isDirty: () => baseline.current !== null && snapshot(draftRef.current) !== baseline.current,
      save: () => (typeof saveRef.current === "function" ? saveRef.current() : undefined),
    } as UnsavedEntry);
    return () => { clearTimeout(t); off(); };
  }, [active, opts.id, opts.resetKey]);   // eslint-disable-line react-hooks/exhaustive-deps
}

/** After a save, the editor either closes (unregisters) or stays dirty (its gate refused). Wait and tell which. */
export async function saveAndCheck(entries: UnsavedEntry[]): Promise<boolean> {
  for (const e of entries) { if (typeof e.save === "function") { try { await e.save(); } catch { /* the editor reported it */ } } }
  await new Promise(r => setTimeout(r, 250));
  return dirtyEntries().length === 0;
}
