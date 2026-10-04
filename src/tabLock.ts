// ─── v6.99.114 (AUD-02, external audit 4 Oct): ONE WRITING TAB PER BROWSER ─────────────────────────────────────────
// Every store is one blob in localStorage, written whole on each change. Two tabs of the app in the same browser silently
// overwrite each other: tab B saves its stale copy and tab A's new PO is gone. The rule now: the first tab writes; any later
// tab opens READ-ONLY with a notice and a "Use this tab instead" button that hands the pen over (the other tab turns read-only).
// The decision is a small state machine (testable); the browser plumbing (BroadcastChannel) is in useSingleTab.
export type TabMsg = { type: "hello" | "alive" | "takeover"; id: string };
export type TabState = { id: string; role: "writer" | "readonly" | "deciding" };
export function newTabState(id: string): TabState { return { id, role: "deciding" }; }
/** What this tab does on a message from another tab. */
export function onTabMessage(st: TabState, msg: TabMsg): { st: TabState; reply: TabMsg | null } {
  if (!msg || msg.id === st.id) return { st, reply: null };
  if (msg.type === "hello") return { st, reply: st.role === "writer" ? { type: "alive", id: st.id } : null };   // a newcomer asks: the writer answers
  if (msg.type === "alive") return { st: st.role === "deciding" ? { ...st, role: "readonly" } : st, reply: null };   // someone already writes: stand down
  if (msg.type === "takeover") return { st: { ...st, role: "readonly" }, reply: null };   // another tab took the pen
  return { st, reply: null };
}
/** No writer answered within the grace period: this tab writes. */
export function onNoAnswer(st: TabState): TabState { return st.role === "deciding" ? { ...st, role: "writer" } : st; }
/** The person asks this tab to take over. */
export function takeOver(st: TabState): { st: TabState; announce: TabMsg } { return { st: { ...st, role: "writer" }, announce: { type: "takeover", id: st.id } }; }
