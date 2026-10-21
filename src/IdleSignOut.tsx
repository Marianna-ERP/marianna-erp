// IdleSignOut.tsx — v7.30.3 (Batch M · M-4, external audit 21 Oct: F-16; owner 21 Oct: "60 minutes, a two-minute warning").
// A signed-in session ends after 60 minutes with no activity on this browser. Two minutes before, a warning offers to stay signed in;
// any activity (a key, a click, the mouse) counts as staying. Unsaved work is never thrown away: while an editor holds unsaved
// changes the session is not ended — the warning stays and asks to save first.
import React, { useEffect, useRef, useState } from "react";
import { logout } from "./remoteStore";
import { dirtyEntries } from "./unsaved";

export const IDLE_MINUTES = 60, WARNING_MINUTES = 2;

export function IdleSignOut({ active = false }: { active?: boolean }) {
  const last = useRef(Date.now()); const [warn, setWarn] = useState<"" | "soon" | "unsaved">("");
  useEffect(() => {
    if (!active) return;
    const touch = () => { last.current = Date.now(); setWarn(w => (w ? "" : w)); };
    const events = ["mousedown", "mousemove", "keydown", "touchstart", "wheel", "scroll"];
    events.forEach(e => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      const idle = Date.now() - last.current;
      if (idle >= IDLE_MINUTES * 60000) { if (dirtyEntries().length) { setWarn("unsaved"); return; } logout(); window.location.reload(); return; }
      if (idle >= (IDLE_MINUTES - WARNING_MINUTES) * 60000) setWarn(w => (w === "unsaved" ? w : "soon"));
    }, 15000);
    return () => { events.forEach(e => window.removeEventListener(e, touch)); window.clearInterval(timer); };
  }, [active]);
  if (!active || !warn) return null;
  return (
    <div role="alertdialog" aria-live="assertive" style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: "18px 20px", maxWidth: 420, boxShadow: "0 10px 30px rgba(0,0,0,0.2)", fontSize: 13, color: "#111" }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>{warn === "unsaved" ? "You have unsaved changes" : "Still there?"}</div>
        <div style={{ color: "#475569", lineHeight: 1.5 }}>{warn === "unsaved"
          ? `This browser has had no activity for ${IDLE_MINUTES} minutes, but an editor holds unsaved changes, so you stay signed in. Save them, then you can step away.`
          : `This browser has had no activity for almost ${IDLE_MINUTES} minutes. To protect the data you will be signed out in ${WARNING_MINUTES} minutes.`}</div>
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button type="button" onClick={() => { last.current = Date.now(); setWarn(""); }} style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: "#111", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Stay signed in</button>
        </div>
      </div>
    </div>
  );
}
