// ─── v6.32.0 (R7b-4): canonical numeric parsing for the engines ─────────────
// The codebase had 17 parsers with 4 semantics; the claim / settlement /
// payments engines were dot-only, so a Polish decimal comma ("1,5") silently
// parsed as 1 — the USER_MANUAL even documented the inconsistency as a tip.
// One rule, engine-wide:
//   • trims and strips spaces (incl. thousands "1 234,56")
//   • a single comma with no dot → decimal comma ("1,5" → 1.5)
//   • comma AND dot → the LAST separator is the decimal one
//     ("1.234,56" → 1234.56; "1,234.56" → 1234.56)
//   • invalid → 0 (the engines' existing convention)
export function parseNum(v: any): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v ?? "").trim();
  if (!s) return 0;
  s = s.replace(/\s|\u00A0/g, "");
  const hasC = s.includes(","), hasD = s.includes(".");
  if (hasC && hasD) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasC) {
    s = (s.match(/,/g) || []).length === 1 ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const x = parseFloat(s);
  return isFinite(x) ? x : 0;
}
