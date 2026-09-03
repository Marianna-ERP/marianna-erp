import React from "react";
// ── v6.81.0 (D-52): dd/mm/yyyy DATE INPUT ─────────────────────────────────────
// Every value the app PRINTS was already dd/mm/yyyy (formatDMY). What showed
// mm/dd/yyyy were the native <input type="date"> fields: Chrome formats those in
// the BROWSER's UI language and ignores the page. This component shows and
// accepts dd/mm/yyyy text, stores ISO (yyyy-mm-dd) exactly as before, and keeps
// the native calendar one click away. Owner ruling: dd/mm/yyyy in the whole ERP.
function isoToDmy(iso: any): string {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}
function dmyToIso(txt: string): string | null {
  const m = String(txt || "").trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export default function DateInput({ value, onChange, disabled, placeholder, style, title }: any) {
  const [txt, setTxt] = React.useState(isoToDmy(value));
  const [bad, setBad] = React.useState(false);
  React.useEffect(() => { setTxt(isoToDmy(value)); setBad(false); }, [value]);
  const pickerRef = React.useRef<any>(null);
  const emit = (iso: string) => onChange && onChange({ target: { value: iso } });
  const commit = () => {
    if (!txt.trim()) { setBad(false); if (value) emit(""); return; }
    const iso = dmyToIso(txt);
    if (iso) { setBad(false); if (iso !== value) emit(iso); } else setBad(true);
  };
  const base: any = { width: "100%", border: `1px solid ${bad ? "#DC2626" : "#E5E7EB"}`, borderRadius: 6, padding: "8px 30px 8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: disabled ? "#F9FAFB" : "#fff", boxSizing: "border-box" };
  return (
    <div style={{ position: "relative", width: "100%", ...(style || {}) }} title={title}>
      <input value={txt} disabled={disabled} placeholder={placeholder || "dd/mm/yyyy"} inputMode="numeric"
        onChange={e => setTxt(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") commit(); }} style={base} />
      <input ref={pickerRef} type="date" value={value || ""} disabled={disabled} onChange={e => emit(e.target.value)} tabIndex={-1}
        style={{ position: "absolute", right: 0, top: 0, width: 28, height: "100%", opacity: 0, cursor: disabled ? "default" : "pointer" }} />
      <span onClick={() => !disabled && pickerRef.current?.showPicker?.()} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#94A3B8", pointerEvents: "none" }}>📅</span>
    </div>
  );
}
