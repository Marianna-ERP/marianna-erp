// v6.99.114 (AUD-02): browser plumbing for tabLock — BroadcastChannel where it exists, otherwise everyone writes (as before).
import { useEffect, useRef, useState } from "react";
import { newTabState, onNoAnswer, onTabMessage, takeOver, TabState } from "./tabLock";
export function useSingleTab(channelName = "marianna-erp-tabs"): { readOnly: boolean; deciding: boolean; takeOver: () => void } {
  const [st, setSt] = useState<TabState>(() => newTabState(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`));
  const chRef = useRef<any>(null); const stRef = useRef(st); stRef.current = st;
  useEffect(() => {
    if (typeof window === "undefined" || typeof (window as any).BroadcastChannel !== "function") { setSt(s => ({ ...s, role: "writer" })); return; }
    const ch = new (window as any).BroadcastChannel(channelName); chRef.current = ch;
    ch.onmessage = (ev: any) => { const r = onTabMessage(stRef.current, ev.data); if (r.st !== stRef.current) setSt(r.st); if (r.reply) ch.postMessage(r.reply); };
    ch.postMessage({ type: "hello", id: stRef.current.id });
    const t = setTimeout(() => setSt(s => onNoAnswer(s)), 350);
    return () => { clearTimeout(t); ch.close(); };
  }, [channelName]);
  return { readOnly: st.role === "readonly", deciding: st.role === "deciding", takeOver: () => { const r = takeOver(stRef.current); setSt(r.st); chRef.current?.postMessage(r.announce); } };
}
