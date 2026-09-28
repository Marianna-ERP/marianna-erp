// ─── v6.99.72 (A-CU-3): the import batch — plan, choose, apply. Pure, so the tests can drive it without a browser. ───
import { nextId } from "./ids";
import { parseCustomsFile, findClearanceHome, applyCustomsFile, ParsedCustomsFile, ClearanceSearch, ClearanceHome } from "./customsClearance.domain";

export interface ImportRow { name: string; parsed: ParsedCustomsFile; search: ClearanceSearch; own?: ClearanceSearch; choice: string; done?: string; }
export const homeKey = (h: ClearanceHome) => `${h.shipment.id}|${h.unit.id}`;
export const homeLabel = (h: ClearanceHome) => `${h.shipment.number} · ${h.unit.truckPlate || h.unit.containerNo || "unit"}${h.unit.trailerPlate ? "/" + h.unit.trailerPlate : ""}`;

/** Pure: read the files, find their homes, pre-select the exact ones. Used by the modal and by the tests. */
export function planImport(files: Array<{ name: string; text: string }>, shipments: any[], invoices: any[]): ImportRow[] {
  const rows: ImportRow[] = files.map(f => {
    const parsed = parseCustomsFile(f.text);
    const search: ClearanceSearch = parsed.ok ? findClearanceHome(parsed, shipments, invoices) : { exact: null, candidates: [], reason: "Not a customs file (no MRN, LRN or SAD header)" };
    return { name: f.name, parsed, search, choice: search.exact ? homeKey(search.exact) : "" };
  });
  // the two emails usually arrive together: an exit confirmation follows the release of the same MRN in this very batch
  const norm = (v: any) => String(v || "").replace(/\s/g, "").toUpperCase();
  rows.forEach(r => {
    if (r.parsed.kind !== "CC599C" || r.search.exact || !r.parsed.mrn) return;
    const rel = rows.find(x => x.parsed.kind === "CC529C" && norm(x.parsed.mrn) === norm(r.parsed.mrn) && x.choice);
    if (!rel) return;
    const home = [rel.search.exact, ...rel.search.candidates].find(h => h && homeKey(h) === rel.choice);
    if (!home) return;
    r.own = r.search;
    r.search = { exact: { ...home, confidence: "exact", reasons: [`its release CC529C (MRN ${r.parsed.mrn}) is in this batch — same truck`] }, candidates: [], reason: "" };
    r.choice = homeKey(home);
  });
  return rows;
}

/** Pure: apply the chosen rows in file order (a release before the exit that follows it), returning the new shipments. */
export function applyImport(rows: ImportRow[], shipments: any[]): { shipments: any[]; done: Array<{ name: string; where: string }>; } {
  let list = shipments.slice(); const done: Array<{ name: string; where: string }> = [];
  const order = (k: string) => k === "SAD" ? 0 : k === "CC529C" ? 1 : 2;
  rows.filter(r => r.choice).sort((a, b) => order(a.parsed.kind) - order(b.parsed.kind)).forEach(r => {
    const [shId, unitId] = r.choice.split("|");
    const idx = list.findIndex(s => String(s.id) === shId); if (idx < 0) return;
    list[idx] = applyCustomsFile(list[idx], unitId, r.parsed, r.name, nextId);
    const u = (list[idx].legs || []).flatMap((l: any) => l.vehicles || []).find((x: any) => String(x.id) === unitId) || {};
    done.push({ name: r.name, where: `${list[idx].number} · ${u.truckPlate || "unit"}` });
  });
  return { shipments: list, done };
}

/** Pure: change one row's choice; an exit confirmation of the same MRN in the batch follows its release. */
export function withChoice(rows: ImportRow[], i: number, value: string): ImportRow[] {
  const norm = (v: any) => String(v || "").replace(/\s/g, "").toUpperCase();
  const changed = rows[i]; if (!changed) return rows;
  return rows.map((x, k) => {
    if (k === i) return { ...x, choice: value };
    if (changed.parsed.kind === "CC529C" && x.parsed.kind === "CC599C" && norm(x.parsed.mrn) === norm(changed.parsed.mrn) && !x.done) {
      const home = [changed.search.exact, ...changed.search.candidates].find(h => h && homeKey(h) === value);
      return home ? { ...x, own: x.own || x.search, choice: value, search: { exact: { ...home, confidence: "exact", reasons: [`its release CC529C (MRN ${x.parsed.mrn}) is in this batch — same truck`] }, candidates: [], reason: "" } }
                  : { ...x, choice: "", search: x.own || x.search };
    }
    return x;
  });
}

