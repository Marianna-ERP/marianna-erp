// ─────────────────────────────────────────────────────────────────────────────
// ui.tsx — shared UI kit (Consolidation Batch 2, R2)
//
// Canonical versions of the primitives that were byte-identical across modules
// (verified by diff before unification — no visual change). Modules whose local
// variant had drifted visually keep it for now and converge during their own
// screen-rebuild batch (Shipments→B3, PO/SO→B4, Finance/Invoices→B5); the
// divergences are logged in the tracker.
//
// Also home of ConfirmDialog / useConfirm — the in-app replacement for
// window.confirm/alert (audit P2-6). Adoption is progressive: Inventory
// converts in this batch as the pattern; every rebuilt screen adopts it.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useCallback } from "react";

// v6.81.0 (D-53, owner ruling): ONE page-width standard — use the screen, cap at 1720 px
// so 27" monitors do not stretch tables into unreadable lines. Every module root reads this.
export const PAGE_MAX = 1720;

export function Card({ children, style = {} }: any) {
  return <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "18px 20px", ...style }}>{children}</div>;
}

export function Lbl({ children }: any) {
  return <label style={{ fontSize: 11, fontWeight: 600, color: "#888", display: "block", marginBottom: 4 }}>{children}</label>;
}

export function SectionTitle({ children, right = null }: any) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#AAA", letterSpacing: "0.06em" }}>{children}</div>
      {right}
    </div>
  );
}

export function SmallButton({ children, onClick, kind = "default", disabled = false, title = "" }: any) {
  const dark = kind === "dark";
  const green = kind === "green";
  const amber = kind === "amber";
  const red = kind === "red";
  const blue = kind === "blue";
  const bg = disabled ? "#F3F4F6" : dark ? "#111" : green ? "#16A34A" : amber ? "#D97706" : red ? "#DC2626" : "#fff";
  const color = disabled ? "#AAA" : dark || green || amber || red ? "#fff" : blue ? "#2563EB" : "#444";
  const border = dark || green || amber || red ? "none" : blue ? "1px solid #2563EB" : "1px solid #E5E7EB";
  return <button disabled={disabled} title={title} onClick={onClick} style={{ padding: "7px 11px", borderRadius: 7, border, background: bg, color, fontSize: 12, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{children}</button>;
}


// ─── v6.73.0: STANDARD ACTION BUTTONS ───────────────────────────────────────
// Owner ruling: "make sure that the function buttons across all the modules have
// the same format and colour… we need them to be standardised becoming user
// friendly."
//
// Before this, each screen chose its own colour and wording for the same action:
// "+ New", "+ Add", "Add new" — some green, some plain. A user learns a button
// by its SHAPE AND COLOUR long before they read it, so the same action must look
// the same in every module, and two different actions must never look alike.
//
// One table, one meaning per row. To add an action, add it HERE — not in a
// screen — so the next module cannot drift.
export const ACTIONS: Record<string, { icon: string; label: string; kind: string; title: string }> = {
  create:      { icon: "+",  label: "Add new",            kind: "green",  title: "Create a new record" },
  importCsv:   { icon: "⤒",  label: "Import CSV",         kind: "default", title: "Import records from a CSV file" },
  exportCsv:   { icon: "⤓",  label: "Export CSV",         kind: "default", title: "Export these records to a CSV file" },
  importFkt:   { icon: "⤒",  label: "Import from Fakturownia", kind: "blue", title: "Fetch documents from Fakturownia" },
  print:       { icon: "⎙",  label: "Print / PDF",        kind: "dark",   title: "Print or save as PDF" },
  email:       { icon: "✉",  label: "Email",              kind: "dark",   title: "Open the email draft" },
  save:        { icon: "",   label: "Save",               kind: "dark",   title: "Save changes" },
  cancelDoc:   { icon: "",   label: "Cancel",             kind: "red",    title: "Cancel this document — it stays on record" },
  remove:      { icon: "✕",  label: "Remove",             kind: "red",    title: "Remove this line" },
  confirmDoc:  { icon: "✓",  label: "Confirm",            kind: "green",  title: "Confirm this document" },
  allocate:    { icon: "⇄",  label: "Allocate",           kind: "amber",  title: "Allocate costs" },
  refresh:     { icon: "↻",  label: "Refresh",            kind: "default", title: "Recompute from source" },
};

/** The one way to render a standard action. Screens name the ACTION, never the
 *  colour — which is what stops the same action looking different in two places.
 *  `label` overrides the wording where a screen needs to be specific
 *  ("Add new supplier"); the icon and colour never change. */
export function ActionButton({ action, onClick, disabled = false, label, title }: any) {
  const a = ACTIONS[action];
  if (!a) return null;
  return (
    <SmallButton kind={a.kind} onClick={onClick} disabled={disabled} title={title || a.title}>
      {a.icon ? `${a.icon} ` : ""}{label || a.label}
    </SmallButton>
  );
}

// ── v6.35.1: system-wide struck-through rendering for cancelled/voided documents ──
// Documents are soft-cancelled (kept on record), never hard-deleted. Anywhere a doc
// number is shown as a reference, wrap it in <DocRef> so a cancelled one is visibly
// voided (red strike-through) rather than looking live.
export function cancelledDocSet(...lists: any[][]): Set<string> {
  const s = new Set<string>();
  lists.forEach(list => (list || []).forEach((d: any) => {
    if (d && d.status === "Cancelled" && d.number != null) s.add(String(d.number));
  }));
  return s;
}

export function DocRef({ num, cancelledSet, style = {}, prefix = "" }: any) {
  if (num == null || num === "") return null;
  const cancelled = cancelledSet && cancelledSet.has(String(num));
  const struck = cancelled
    ? { textDecoration: "line-through", textDecorationColor: "#DC2626", textDecorationThickness: "1.5px", color: "#B91C1C", opacity: 0.8 }
    : {};
  return <span title={cancelled ? "Cancelled — kept on record, no longer active" : undefined} style={{ ...style, ...struck }}>{prefix}{num}</span>;
}

// ── In-app dialogs (P2-6) ────────────────────────────────────────────────────

function DialogShell({ tone, title, message, buttons, input = null }: any) {
  const accent = tone === "danger" ? "#DC2626" : tone === "warn" ? "#D97706" : "#2563EB";
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 14, maxWidth: 460, width: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.25)", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px 4px", display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: accent, flexShrink: 0 }} />
          <div style={{ fontSize: 14, fontWeight: 800, color: "#111" }}>{title}</div>
        </div>
        <div style={{ padding: "8px 20px 16px", fontSize: 12.5, color: "#444", lineHeight: 1.55, whiteSpace: "pre-line" }}>{message}</div>
        {input && <div style={{ padding: "0 20px 16px" }}>{input}</div>}
        <div style={{ padding: "12px 20px", background: "#F8FAFC", display: "flex", justifyContent: "flex-end", gap: 8 }}>{buttons}</div>
      </div>
    </div>
  );
}

/**
 * Promise-based in-app confirm/alert.
 *   const { confirm, alert, dialogNode } = useConfirm();
 *   if (!(await confirm({ title, message, confirmLabel, tone }))) return;
 * Render {dialogNode} once at the module root.
 */
export function useConfirm() {
  const [dlg, setDlg] = useState<any>(null);
  const [inputVal, setInputVal] = useState("");
  const resolver = useRef<any>(null);

  const close = useCallback((result: boolean) => {
    setDlg(null);
    if (resolver.current) { resolver.current(result); resolver.current = null; }
  }, []);

  // v6.42.0 (P2-6): promise-based prompt — resolves to the entered string, or null on cancel.
  const closePrompt = useCallback((val: string | null) => {
    setDlg(null);
    if (resolver.current) { resolver.current(val); resolver.current = null; }
  }, []);

  const confirm = useCallback((opts: any) => new Promise<boolean>(res => {
    resolver.current = res;
    setDlg({ kind: "confirm", tone: opts.tone || "warn", title: opts.title || "Please confirm", message: opts.message || "", confirmLabel: opts.confirmLabel || "Confirm", cancelLabel: opts.cancelLabel || "Cancel" });
  }), []);

  const alert = useCallback((opts: any) => new Promise<boolean>(res => {
    resolver.current = res;
    setDlg({ kind: "alert", tone: opts.tone || "info", title: opts.title || "Notice", message: opts.message || "", confirmLabel: opts.okLabel || "OK" });
  }), []);

  const prompt = useCallback((opts: any) => new Promise<string | null>(res => {
    resolver.current = res;
    setInputVal(opts.defaultValue || "");
    setDlg({ kind: "prompt", tone: opts.tone || "info", title: opts.title || "Enter a value", message: opts.message || "", confirmLabel: opts.confirmLabel || "OK", cancelLabel: opts.cancelLabel || "Cancel", placeholder: opts.placeholder || "" });
  }), []);

  const dialogNode = dlg ? (
    <DialogShell tone={dlg.tone} title={dlg.title} message={dlg.message}
      input={dlg.kind === "prompt" ? (
        <input autoFocus value={inputVal} placeholder={dlg.placeholder}
          onChange={(e: any) => setInputVal(e.target.value)}
          onKeyDown={(e: any) => { if (e.key === "Enter") closePrompt(inputVal); if (e.key === "Escape") closePrompt(null); }}
          style={{ width: "100%", boxSizing: "border-box", border: "1px solid #D1D5DB", borderRadius: 8, padding: "8px 11px", fontSize: 13 }} />
      ) : null}
      buttons={
        dlg.kind === "confirm" ? (<>
          <SmallButton onClick={() => close(false)}>{dlg.cancelLabel}</SmallButton>
          <SmallButton kind={dlg.tone === "danger" ? "red" : "dark"} onClick={() => close(true)}>{dlg.confirmLabel}</SmallButton>
        </>) : dlg.kind === "prompt" ? (<>
          <SmallButton onClick={() => closePrompt(null)}>{dlg.cancelLabel}</SmallButton>
          <SmallButton kind="dark" onClick={() => closePrompt(inputVal)}>{dlg.confirmLabel}</SmallButton>
        </>) : (
          <SmallButton kind="dark" onClick={() => close(true)}>{dlg.confirmLabel}</SmallButton>
        )
      } />
  ) : null;

  return { confirm, alert, prompt, dialogNode };
}
