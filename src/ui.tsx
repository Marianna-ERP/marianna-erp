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
import DateInput from "./DateInput";   // v7.44.0: the shared Inp's date branch
import { parseNum } from "./numbers";   // v7.38.0

// v6.81.0 (D-53, owner ruling): ONE page-width standard — use the screen, cap at 1720 px
// so 27" monitors do not stretch tables into unreadable lines. Every module root reads this.
export const PAGE_MAX = 1720;


// v6.99.61 (A-HD-1, owner): ONE module header — the bar PO, SO, Inventory, Invoices and Parties already use: white, 52 px,
// title 16 px bold on the left, actions on the right, no paragraph. Every other module renders this component.
export function ModuleHeader({ title, right = null }: any) {
  return (
    <div data-module-header="1" style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", padding: "0 28px", height: 52, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>{title}</div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>{right}</div>
    </div>
  );
}
// v6.99.61 (A-HD-2): the reference page — header, then a full-width body with 24/28 px padding (no width cap)
export function ModulePage({ title, right = null, children, background = "#FAFAFA" }: any) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background }}>
      <ModuleHeader title={title} right={right} />
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>{children}</div>
    </div>
  );
}

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
  // v6.99.69 (A-BT-1): the vocabulary — save/confirm = green · close = black · delete = red · remove/cancel = white · add = green text · edit = blue text
  if (kind === "close") kind = "dark"; if (kind === "save" || kind === "confirm") kind = "green"; if (kind === "delete") kind = "red";
  const dark = kind === "dark";
  const green = kind === "green";
  const amber = kind === "amber";
  const red = kind === "red";
  const blue = kind === "blue" || kind === "edit" || kind === "import" || kind === "export";
  const addK = kind === "add"; const removeK = kind === "remove";
  const bg = disabled ? "#F3F4F6" : dark ? "#0F172A" : green ? "#16A34A" : amber ? "#D97706" : red ? "#DC2626" : "#fff";
  const color = disabled ? "#AAA" : dark || green || amber || red ? "#fff" : blue ? "#2563EB" : addK ? "#15803D" : removeK ? "#DC2626" : "#444";
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
  // v6.99.92 (A-DEL-2): 'close' was missing too — 17 window headers drew no Close
  close:       { icon: "",   label: "Close",              kind: "close",  title: "Close this window" },
  // v6.99.88 (A-DEL-1): 'delete' was missing from this list, so every <ActionButton action="delete"> drew NOTHING (PO, SO, lot, cost rows)
  delete:      { icon: "",   label: "Delete",             kind: "delete", title: "Delete this record — it stays on record, struck through and read-only; blocked while other documents depend on it" },
  // v6.99.99 (A-DEL-4, owner ruling 2 Oct): Withdraw removed — Delete is the one action; a deleted record stays on record (struck through, read-only)
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

export function DocRef({ num, cancelledSet, style = {}, prefix = "", from = "" }: any) {
  if (num == null || num === "") return null;
  const cancelled = cancelledSet && cancelledSet.has(String(num));
  const struck = cancelled
    ? { textDecoration: "line-through", textDecorationColor: "#DC2626", textDecorationThickness: "1.5px", color: "#B91C1C", opacity: 0.8 }
    : {};
  return <DocLink num={num} from={from}><span title={cancelled ? "Cancelled — kept on record, no longer active" : undefined} style={{ ...style, ...struck }}>{prefix}{num}</span></DocLink>;
}

// ── v6.99.79 (A-NAV-1, owner 28 Sept): a document number takes you to its document ─────────────────────────────────
// App provides `open`; any number it can resolve (PO, SO, shipment, lot, invoice) becomes a link. Outside App (tests,
// print) nothing changes: the number renders exactly as before. A click never also triggers the row it sits in.
export const DocNavContext = React.createContext<null | { open: (num: string, from?: string) => void; canOpen: (num: string) => boolean; kindOf?: (num: string) => string }>(null);
// v7.23.3 (A-UI-1, owner 13 Oct): ONE COLOUR PER KIND OF DOCUMENT, on every screen — applied by the link itself, so no screen picks
// its own; no icon before a number; the number in the app's own font, with even-width figures
export const DOC_COLOURS: Record<string, string> = { pos: "#1D4ED8", orders: "#15803D", shipments: "#0E7490", lots: "#B45309", invoices: "#7C3AED", claims: "#BE123C" };
export function DocLink({ num, from = "", children }: any) {
  const nav = React.useContext(DocNavContext);
  if (!nav || !nav.canOpen(String(num))) return <>{children}</>;
  return <a href={`#open/${encodeURIComponent(String(num))}`} data-doclink="1" title={`Open ${num}`} onClick={e => { e.preventDefault(); e.stopPropagation(); nav.open(String(num), from ? String(from) : ""); }} style={{ textDecoration: "none", cursor: "pointer", color: DOC_COLOURS[nav.kindOf ? nav.kindOf(String(num)) : ""] || undefined, fontFamily: "inherit", fontVariantNumeric: "tabular-nums" }}>{children}</a>;
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
        <div style={{ padding: "8px 20px 16px", fontSize: 12, color: "#444", lineHeight: 1.55, whiteSpace: "pre-line" }}>{message}</div>
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

// ── v6.99.69 (A-CF-3, owner): after a save, a short "Saved ✓" that fades by itself — reassurance without a click ──
export function notifySaved(what: string): void {
  try {
    if (typeof document === "undefined") return;
    let host = document.getElementById("mar-saved-toast");
    if (!host) { host = document.createElement("div"); host.id = "mar-saved-toast"; host.setAttribute("style", "position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;flex-direction:column;gap:6px;pointer-events:none"); document.body.appendChild(host); }
    const el = document.createElement("div");
    el.textContent = `Saved ✓ ${what || ""}`.trim();
    el.setAttribute("style", "background:#16A34A;color:#fff;font:600 12.5px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:8px 14px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.18);opacity:0;transition:opacity .2s");
    host.appendChild(el); requestAnimationFrame(() => { el.style.opacity = "1"; });
    setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 2200);
  } catch { /* never let a toast break a save */ }
}

/** v7.38.0 (AUD3-B2 / B4, external audit 28 Oct: "the shipment editor turns an FX rate of 4.2650 into 42,650"): THE ONE NUMBER FIELD.
 *  What is typed stays as typed (a dot, a comma, a space) while the field has the focus; it is read once, with the one number reader,
 *  when the field is left or Enter is pressed. disabled / placeholder / title pass through, so a locked number field is locked. */
export function NumInput({ value, onNumber, disabled = false, placeholder, title, style, ...rest }: any) {
  const [text, setText] = React.useState<string | null>(null);
  const commit = () => { if (text == null) return; const n = parseNum(text); setText(null); if (typeof onNumber === "function" && String(n) !== String(value ?? "")) onNumber(n); };
  return <input {...rest} type="text" inputMode="decimal" disabled={disabled} placeholder={placeholder} title={title} style={style}
    value={text != null ? text : (value ?? "")} onFocus={(e: any) => { if (!disabled) setText(String(value ?? "")); if (rest.onFocus) rest.onFocus(e); }}
    onChange={(e: any) => setText(e.target.value)} onBlur={(e: any) => { commit(); if (rest.onBlur) rest.onBlur(e); }}
    onKeyDown={(e: any) => { if (e.key === "Enter") commit(); if (rest.onKeyDown) rest.onKeyDown(e); }} />;
}

// v7.44.0 (AUD3 redundancy): the one copy of Sel that PurchaseOrders.tsx, SalesOrders.tsx, Shipments.tsx shared, word for word
export function Sel({ value, onChange = () => {}, children, style = {}, disabled = false }: any) {
  const base = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: disabled ? "#F9FAFB" : "#fff" };
  return <select value={value || ""} onChange={onChange} disabled={disabled} style={{ ...base, ...style }}>{children}</select>;
}

// v7.44.0 (AUD3 redundancy): the one copy of Inp that PurchaseOrders.tsx, SalesOrders.tsx shared, word for word
export function Inp({ value, onChange = () => {}, type = "text", placeholder = "", style = {}, disabled = false, list, title, max, min, noFuture }: any) {
  if (type === "date") return <DateInput value={value} onChange={onChange} disabled={disabled} placeholder={placeholder} style={style} min={min} max={max} noFuture={noFuture} title={title} />; // v6.81.0 (D-52)
  if (type === "number") return <input value={value ?? ""} onChange={(e: any) => onChange && onChange({ target: { value: String(e.target.value).replace(",", ".") } })} inputMode="decimal" placeholder={placeholder || undefined} disabled={undefined} style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", background: "#fff", ...(style || {}) }} title={undefined} />; // v6.99.6 (A-R9-5): Polish comma decimals accepted
  const base = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: disabled ? "#F9FAFB" : "#fff" };
  return <input value={value ?? ""} onChange={onChange} type={type || "text"} placeholder={placeholder} disabled={disabled} list={list} title={title} max={max} style={{ ...base, ...style }} />;
}

// v7.44.0 (AUD3 redundancy): the one copy of Card that Finance.tsx, Settings.tsx shared, word for word
export function FlatCard({ children, style }: any) {
  return <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "18px 20px", ...style }}>{children}</div>;
}
