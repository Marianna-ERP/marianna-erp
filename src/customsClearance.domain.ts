// ─────────────────────────────────────────────────────────────────────────────
import { S } from "./format";
// customsClearance.domain.ts — v6.99.44 (X-1, X-5…X-9, owner 19 Sept)
// A customs clearance belongs to the UNIT that crosses the border. The agent's CC529C release message (Polish
// customs, XML) carries every fact tagged — MRN, LRN, dates, offices, the truck's plates, kilos, packages, CN,
// the invoice declared — so the clearance line is FILLED from the file, matched to the truck by plates, and
// cross-checked against the shipment. The user types nothing; without a file, three fields suffice.
// ─────────────────────────────────────────────────────────────────────────────
const num = (v: any) => { const n = parseFloat(S(v).replace(",", ".")); return isFinite(n) ? n : 0; };

// v6.99.72 (A-CU-3, owner 28 Sept): the agent sends TWO messages per truck — the release (CC529C) and, days later, the
// exit confirmation (CC599C, "IE-599": the goods left the EU — the evidence behind 0 % VAT on the export invoice) — plus
// their own SAD working copy. All three name the same truck, invoice and kilos, so a file FINDS its shipment by itself:
// a CC599C by the MRN its CC529C already put on a line; a CC529C by plates, then invoice, loading date, consignee, kilos.
// Nothing is attached on a guess: only an MRN match or plates + invoice count as exact; the rest is proposed.
export type ClearanceStatus = "Pending" | "Declared" | "Released" | "Exited" | "Held";
export const CLEARANCE_STATUSES: ClearanceStatus[] = ["Pending", "Declared", "Released", "Exited", "Held"];
export interface UnitClearance {
  unitId: any; type?: string; mrn?: string; lrn?: string; declaredOn?: string; releasedOn?: string;
  officeExport?: string; officeExit?: string; status: ClearanceStatus;
  plates?: string; grossKg?: number; netKg?: number; packages?: number; cn?: string; invoiceRef?: string; incoterm?: string; place?: string; consignee?: string; note?: string;
  sourceFile?: string;
  exitedOn?: string; exitOffice?: string; exitResult?: string; exitFile?: string;   // v6.99.72: from the CC599C
}

/** One line per unit on the border-crossing leg (leg 1 for road; the sea leg's containers are cleared at the port). */
export function clearanceLinesFor(sh: any): UnitClearance[] {
  const units = ((sh?.legs || [])[0]?.vehicles || []);
  const existing: UnitClearance[] = Array.isArray(sh?.customsUnits) ? sh.customsUnits : [];
  return units.map((u: any) => existing.find(c => String(c.unitId) === String(u.id)) || { unitId: u.id, status: "Pending" as const });
}

/** v6.99.72: the agent's files escape "&" as &amp; — "Al Baraka For Import &amp;" must read as the name it is. */
export function unescapeXml(v: string): string { return S(v).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))); }
function tag(xml: string, name: string): string { const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`)); return m ? unescapeXml(m[1]) : ""; }
function tags(xml: string, name: string): string[] { const re = new RegExp(`<${name}>([^<]*)</${name}>`, "g"); const out: string[] = []; let m: RegExpExecArray | null; while ((m = re.exec(xml))) out.push(unescapeXml(m[1])); return out; }

/** Read the CC529C (export release) XML. Tolerant: any tag missing simply stays empty. */
export function parseCC529C(xmlText: string): Partial<UnitClearance> & { ok: boolean; countriesOfRouting?: string[]; invoiceValue?: number; invoiceCurrency?: string; messageType?: string } {
  const x = String(xmlText || "");
  if (!/<MRN>/.test(x) && !/<LRN>/.test(x)) return { ok: false };
  // the means of transport at departure: <TransportEquipment>/<DepartureTransportMeans> → typeOfIdentification 30 + identificationNumber plates
  const ids = tags(x, "identificationNumber");
  const plates = ids.find(v => /[A-Z]{2,3}\d|\d[A-Z]/.test(v) && v.includes("/")) || ids.find(v => /^[A-Z]{1,3}[A-Z0-9 ]{3,}$/.test(v) && !v.startsWith("PL") && v !== "STATEK") || "";
  // the invoice: <SupportingDocument><type>N380</type><referenceNumber>FV…</referenceNumber>
  let invoiceRef = "";
  const sd = x.match(/<type>N380<\/type>\s*<referenceNumber>([^<]*)<\/referenceNumber>/) || x.match(/<referenceNumber>([^<]*)<\/referenceNumber>\s*<type>N380<\/type>/);
  if (sd) invoiceRef = S(sd[1]);
  const consigneeName = (() => { const m = x.match(/<Consignee>[\s\S]*?<name>([^<]*)<\/name>/); return m ? unescapeXml(m[1]) : ""; })();
  // v6.99.72 (A-CU-3): a CC599C carries the exit — date, actual office, control result; a CC529C has none of them
  const messageType = tag(x, "messageType") || ((x.match(/<(?:\w+:)?(CC5\d\dC)\b/) || [])[1] || "");
  const exitedOn = tag(x, "exitDate").slice(0, 10);
  const exitOffice = (x.match(/<CustomsOfficeOfExitActual>[\s\S]*?<referenceNumber>([^<]*)</) || [])[1] || "";
  const exitResult = (x.match(/<ExitControlResult>[\s\S]*?<code>([^<]*)</) || [])[1] || "";
  const offices = tags(x, "referenceNumber").filter(v => /^[A-Z]{2}\d{6}$/.test(v));
  return {
    ok: true,
    mrn: tag(x, "MRN"), lrn: tag(x, "LRN"),
    type: [tag(x, "declarationType"), tag(x, "additionalDeclarationType")].filter(Boolean).join(" "),
    declaredOn: tag(x, "declarationAcceptanceDate").slice(0, 10), releasedOn: tag(x, "releaseDate").slice(0, 10),
    officeExport: (x.match(/<CustomsOfficeOfExport>[\s\S]*?<referenceNumber>([^<]*)</) || [])[1] || offices[0] || "",
    officeExit: (x.match(/<CustomsOfficeOfExit(?:Declared|Actual)?>[\s\S]*?<referenceNumber>([^<]*)</) || [])[1] || offices.find(o => o !== offices[0]) || "",
    plates, grossKg: num(tag(x, "grossMass")), netKg: num(tag(x, "netMass")), packages: num(tag(x, "numberOfPackages")),
    cn: (tag(x, "harmonizedSystemSubHeadingCode") + tag(x, "combinedNomenclatureCode")) || "",
    invoiceRef, incoterm: tag(x, "incotermCode"), place: tag(x, "location"), consignee: consigneeName,
    countriesOfRouting: tags(x, "country").filter(c => /^[A-Z]{2}$/.test(c)),
    invoiceValue: num(tag(x, "totalAmountInvoiced")), invoiceCurrency: tag(x, "invoiceCurrency"),
    status: exitedOn ? "Exited" : tag(x, "releaseDate") ? "Released" : "Declared",
    messageType, exitedOn, exitOffice: unescapeXml(exitOffice), exitResult: S(exitResult),
  };
}

/** Which unit does a set of plates belong to? "WGR52365/WGR2UU2" matches truck or trailer, spaces and case ignored. */
export function matchUnitByPlates(sh: any, plates: string): any | null {
  const norm = (v: any) => S(v).toUpperCase().replace(/[\s-]/g, "");
  const parts = S(plates).split("/").map(norm).filter(Boolean);
  if (!parts.length) return null;
  const units = (sh?.legs || []).flatMap((l: any) => l.vehicles || []);
  return units.find((u: any) => parts.some(p => p === norm(u.truckPlate) || p === norm(u.trailerPlate))) || null;
}

/** What disagrees between the declaration and our shipment. Empty = everything matches. */
export function crossCheckClearance(c: Partial<UnitClearance>, sh: any, unit: any, orders: any[] = [], invoices: any[] = []): string[] {
  const out: string[] = [];
  const kgLoaded = unit ? (unit.load || []).reduce((s: number, a: any) => s + num(a.qtyKg), 0) || num(unit.qtyKg) : 0;
  if (c.netKg && kgLoaded && Math.abs(c.netKg - kgLoaded) > 1) out.push(`declared ${Math.round(c.netKg).toLocaleString("pl-PL")} kg net — the truck carries ${Math.round(kgLoaded).toLocaleString("pl-PL")} kg`);
  const ourCN = new Set((sh?.goods || []).map((g: any) => S(g.cnCode).replace(/\s/g, "")).filter(Boolean));
  if (c.cn && ourCN.size && !ourCN.has(S(c.cn))) out.push(`declared CN ${c.cn} — the goods rows carry ${Array.from(ourCN).join(", ")}`);
  const so = (orders || []).find((o: any) => String(o.number) === String(sh?.governingSoRef || (sh?.soRefs || [])[0])) || null;
  if (so && c.incoterm && S(so.sellIncoterm).toUpperCase() !== S(c.incoterm).toUpperCase()) out.push(`declared ${c.incoterm} — the sale is ${so.sellIncoterm}`);
  if (so && c.consignee && S(so.client?.name) && !S(c.consignee).toLowerCase().includes(S(so.client.name).toLowerCase().slice(0, 8))) out.push(`consignee "${c.consignee}" — the client is ${so.client.name}`);
  if (c.invoiceRef) {
    const linked = (invoices || []).filter((iv: any) => (iv.links || []).some((l: any) => l.type === "SO" && so && String(l.number) === String(so.number)) || (iv.links || []).some((l: any) => l.type === "Shipment" && String(l.number) === String(sh?.number)));
    if (linked.length && !linked.some((iv: any) => S(iv.number).replace(/\s/g, "") === S(c.invoiceRef).replace(/\s/g, ""))) out.push(`declared on invoice ${c.invoiceRef} — linked invoice(s): ${linked.map((iv: any) => iv.number).join(", ")}`);
  }
  return out;
}

// ─── v6.99.72 (A-CU-3): which file is it, where does it belong, attach it once, detach it whole ───────────────────
export type CustomsFileKind = "CC529C" | "CC599C" | "SAD" | "unknown";
export interface ParsedCustomsFile extends Partial<UnitClearance> { ok: boolean; kind: CustomsFileKind; agentRef?: string; invoiceValue?: number; invoiceCurrency?: string; countriesOfRouting?: string[]; }
const attr = (xml: string, el: string, name: string): string => { const m = xml.match(new RegExp(`<${el}\\b[^>]*\\b${name}="([^"]*)"`)); return m ? unescapeXml(m[1]) : ""; };

/** Read any of the three files the agent sends. The SAD is their own software's copy of the declaration (attributes, no
 *  MRN): only what is needed to FIND the truck is read from it — plates, invoice, date, consignee, CN. */
export function parseCustomsFile(xmlText: string): ParsedCustomsFile {
  const x = String(xmlText || "");
  if (/<SADUE\b/.test(x)) {
    const inv = (x.match(/<DokumWymag\b[^>]*KodDokum="N380"[^>]*NrDokum="([^"]*)"/) || x.match(/<DokumWymag\b[^>]*NrDokum="([^"]*)"[^>]*KodDokum="N380"/) || [])[1] || "";
    const consignee = (() => { const m = x.match(/<Firmy\b[^>]*RodzKon="C"[^>]*\bNazwa="([^"]*)"/) || x.match(/<Firmy\b[^>]*\bNazwa="([^"]*)"[^>]*RodzKon="C"/); return m ? unescapeXml(m[1]) : ""; })();
    return {
      ok: true, kind: "SAD", agentRef: attr(x, "P1Kontekst", "IDSADu"), declaredOn: attr(x, "P1Kontekst", "DataDekl").slice(0, 10),
      plates: attr(x, "NaWyjsciu", "Znaki"), invoiceRef: unescapeXml(inv), consignee, cn: attr(x, "P33KodTowaru", "KodCN"),
      incoterm: attr(x, "P20WarDostawy", "Kod"), place: attr(x, "P20WarDostawy", "Miejsce"), officeExport: attr(x, "P1Kontekst", "UCZgloszenia"), officeExit: attr(x, "SADUE", "P29UCGraniczny"),
      type: [attr(x, "P1Kontekst", "Dekl1"), attr(x, "P1Kontekst", "Dekl2")].filter(Boolean).join(" "), status: "Declared",
    };
  }
  const r = parseCC529C(x) as any;
  if (!r.ok) return { ok: false, kind: "unknown" };
  const kind: CustomsFileKind = r.messageType === "CC599C" || r.exitedOn ? "CC599C" : r.messageType === "CC529C" || r.mrn ? "CC529C" : "unknown";
  return { ...r, kind };
}

export const CUSTOMS_FILE_LABEL: Record<CustomsFileKind, string> = { CC529C: "Release for export (CC529C)", CC599C: "Exit confirmation (CC599C)", SAD: "Declaration copy (SAD)", unknown: "Not a customs file" };

const normPlate = (v: any) => S(v).toUpperCase().replace(/[\s-]/g, "");
const normRef = (v: any) => S(v).replace(/\s/g, "").toUpperCase();
/** The day the truck loaded — the same field order the cut-off check uses. */
export function unitLoadingDate(sh: any, leg: any, u: any): string { return S(u?.loadedAt || u?.plannedLoadingDate || leg?.plannedPickupDate || sh?.loadedOn || sh?.plannedLoadingDate).slice(0, 10); }
const daysApart = (a: string, b: string): number | null => { if (!a || !b) return null; const d = (new Date(a).getTime() - new Date(b).getTime()) / 86400000; return isFinite(d) ? Math.abs(d) : null; };

export interface ClearanceHome { shipment: any; unit: any; leg: any; line: UnitClearance | null; confidence: "exact" | "probable"; reasons: string[]; score: number; }
export interface ClearanceSearch { exact: ClearanceHome | null; candidates: ClearanceHome[]; reason: string; }

/** Where does this file belong? Exact = its MRN is already on a line (the CC599C after its CC529C), or the truck's plates
 *  plus the invoice it declares point at one shipment. Everything else is a candidate for the user to confirm. */
export function findClearanceHome(p: ParsedCustomsFile, shipments: any[], invoices: any[] = []): ClearanceSearch {
  const all = (shipments || []);
  const homes: ClearanceHome[] = [];
  // 1. the MRN is already on a line
  if (p.mrn) {
    for (const sh of all) for (const line of (sh.customsUnits || []) as UnitClearance[]) {
      if (normRef(line.mrn) === normRef(p.mrn)) {
        const hit = (sh.legs || []).flatMap((l: any) => (l.vehicles || []).map((u: any) => ({ l, u }))).find((x: any) => String(x.u.id) === String(line.unitId));
        if (hit) return { exact: { shipment: sh, unit: hit.u, leg: hit.l, line, confidence: "exact", reasons: [`MRN ${p.mrn} is already on this truck's line`], score: 100 }, candidates: [], reason: "" };
      }
    }
  }
  // a CC599C whose release was never attached still finds its truck by plates — but only ever as a proposal
  const noRelease = p.kind === "CC599C" && !!p.mrn;
  // 2. the plates
  const parts = S(p.plates).split("/").map(normPlate).filter(Boolean);
  if (!parts.length) return { exact: null, candidates: [], reason: "The file names no truck plates, so it cannot be placed" };
  const invNo = normRef(p.invoiceRef);
  for (const sh of all) {
    if (String(sh.status) === "Cancelled") continue;
    for (const leg of (sh.legs || [])) for (const u of (leg.vehicles || [])) {
      const truck = normPlate(u.truckPlate), trailer = normPlate(u.trailerPlate);
      const truckHit = !!truck && parts.includes(truck), trailerHit = !!trailer && parts.includes(trailer);
      if (!truckHit && !trailerHit) continue;
      const reasons: string[] = []; let score = truckHit ? 40 : 15;
      reasons.push(truckHit ? `truck ${u.truckPlate} is on this shipment` : `only the trailer ${u.trailerPlate} matches (the truck is another)`);
      const soRefs = [sh.governingSoRef, ...(sh.soRefs || [])].map(normRef).filter(Boolean);
      const invoiceLinked = invNo && (invoices || []).some((iv: any) => normRef(iv.number) === invNo && (iv.links || []).some((l: any) => (l.type === "Shipment" && normRef(l.number) === normRef(sh.number)) || (l.type === "SO" && soRefs.includes(normRef(l.number)))));
      if (invoiceLinked) { score += 40; reasons.push(`invoice ${p.invoiceRef} is linked to this shipment`); }
      const ld = unitLoadingDate(sh, leg, u); const gap = daysApart(p.declaredOn || "", ld);
      if (gap !== null && gap <= 3) { score += 15; reasons.push(`declared ${p.declaredOn}, loaded ${ld}`); }
      else if (gap !== null && gap > 14) { score -= 20; reasons.push(`declared ${p.declaredOn} but this truck loaded ${ld}`); }
      const kg = (u.load || []).reduce((s: number, a: any) => s + num(a.qtyKg), 0) || num(u.qtyKg);
      if (p.netKg && kg && Math.abs(p.netKg - kg) <= 1) { score += 10; reasons.push(`${Math.round(kg)} kg on the truck, as declared`); }
      const client = S((sh.clientName) || "") || S(sh.client?.name || "");
      if (p.consignee && client && S(p.consignee).toLowerCase().includes(client.toLowerCase().slice(0, 8))) { score += 10; reasons.push(`consignee matches ${client}`); }
      const line = ((sh.customsUnits || []) as UnitClearance[]).find(c => String(c.unitId) === String(u.id)) || null;
      if (line?.mrn && p.mrn && normRef(line.mrn) !== normRef(p.mrn)) { score -= 30; reasons.push(`this line already carries another MRN (${line.mrn})`); }
      homes.push({ shipment: sh, unit: u, leg, line, confidence: "probable", reasons, score });
    }
  }
  homes.sort((a, b) => b.score - a.score || S(b.shipment.number).localeCompare(S(a.shipment.number)));
  const top = homes[0];
  if (top && top.score >= 80 && !noRelease) { top.confidence = "exact"; return { exact: top, candidates: homes.slice(1), reason: "" }; }
  const why = noRelease ? `No line carries MRN ${p.mrn} yet (the release CC529C was not attached) — confirm the truck` : homes.length ? "More than the plates is needed — confirm the shipment" : `No shipment carries the plates ${p.plates}`;
  return { exact: null, candidates: homes, reason: why };
}

/** The register rows a file produces — one per kind, keyed by MRN so a file dropped twice adds nothing. */
export function registerRowsFor(p: ParsedCustomsFile, unit: any, fileName: string): Array<{ type: string; ref: string; status: string; date: string; notes: string }> {
  const plate = S(unit?.truckPlate || unit?.containerNo || "");
  if (p.kind === "CC599C") return [{ type: "Exit confirmation (CC599C)", ref: p.mrn || "", status: "Have it", date: p.exitedOn || "", notes: `${plate} · left the EU at ${p.exitOffice || "?"} · from ${fileName}` }];
  if (p.kind === "SAD") return [{ type: "Customs declaration copy (SAD)", ref: p.agentRef ? `SAD ${p.agentRef}` : (p.invoiceRef || ""), status: "Have it", date: p.declaredOn || "", notes: `${plate} · from ${fileName}` }];
  return [
    { type: "Export declaration (EAD)", ref: p.mrn || "", status: "Have it", date: p.releasedOn || "", notes: `${plate} · from ${fileName}` },
    { type: "Customs release (CC529C)", ref: p.mrn || "", status: "Have it", date: p.releasedOn || "", notes: plate },
  ];
}

/** Attach a file to a truck: the line is filled (a release fills the release facts, an exit adds the exit facts on top,
 *  a SAD only files itself), the register rows are replaced by type + ref (replace-by-ref, never duplicated). */
export function applyCustomsFile(sh: any, unitId: any, p: ParsedCustomsFile, fileName: string, nextId: () => any): any {
  const lines = clearanceLinesFor(sh);
  const unit = (sh.legs || []).flatMap((l: any) => l.vehicles || []).find((u: any) => String(u.id) === String(unitId)) || {};
  const customsUnits = lines.map(line => {
    if (String(line.unitId) !== String(unitId)) return line;
    if (p.kind === "SAD") return { ...line, plates: line.plates || p.plates, invoiceRef: line.invoiceRef || p.invoiceRef, declaredOn: line.declaredOn || p.declaredOn, status: line.mrn ? line.status : (line.status === "Pending" ? "Declared" : line.status) };
    if (p.kind === "CC599C") return { ...line, mrn: line.mrn || p.mrn, lrn: line.lrn || p.lrn, exitedOn: p.exitedOn, exitOffice: p.exitOffice, exitResult: p.exitResult, exitFile: fileName, status: "Exited" as ClearanceStatus, officeExit: p.exitOffice || line.officeExit };
    const { ok, kind, countriesOfRouting, invoiceValue, invoiceCurrency, agentRef, exitedOn, exitOffice, exitResult, messageType, ...rest } = p as any;
    return { ...line, ...rest, status: line.exitedOn ? "Exited" : rest.status, sourceFile: fileName };
  });
  const rows = registerRowsFor(p, unit, fileName);
  const keep = (sh.documents || []).filter((d: any) => !rows.some(r => r.type === d.type && normRef(r.ref) === normRef(d.ref)));
  // a customs file on a truck means customs applies to the shipment — otherwise the editor would hide the line it just filled
  const customs = { ...(sh.customs || {}), applies: true };
  return { ...sh, customs, customsUnits, documents: [...keep, ...rows.map(r => ({ id: nextId(), ...r, link: "" }))] };
}

/** Detach: the line goes back to Pending and every register row of its MRN goes with it. */
export function detachClearance(sh: any, unitId: any): any {
  const line = clearanceLinesFor(sh).find(l => String(l.unitId) === String(unitId));
  const mrn = normRef(line?.mrn);
  const customsUnits = clearanceLinesFor(sh).map(l => String(l.unitId) === String(unitId) ? { unitId: l.unitId, status: "Pending" as ClearanceStatus } : l);
  const documents = (sh.documents || []).filter((d: any) => !(mrn && normRef(d.ref) === mrn && /Export declaration|Customs release|Exit confirmation/.test(S(d.type))));
  return { ...sh, customsUnits, documents };
}

/** For the sales invoice: what customs says about it, straight from the shipments — no store of its own. */
export function customsForInvoice(invoiceNumber: string, shipments: any[]): Array<{ shipment: string; plates: string; mrn: string; releasedOn: string; exitedOn: string; exitOffice: string; status: ClearanceStatus }> {
  const want = normRef(invoiceNumber); if (!want) return [];
  const out: any[] = [];
  (shipments || []).forEach(sh => ((sh.customsUnits || []) as UnitClearance[]).forEach(line => {
    if (normRef(line.invoiceRef) !== want) return;
    const u = (sh.legs || []).flatMap((l: any) => l.vehicles || []).find((x: any) => String(x.id) === String(line.unitId)) || {};
    out.push({ shipment: sh.number, plates: [u.truckPlate, u.trailerPlate].filter(Boolean).join("/") || S(line.plates), mrn: S(line.mrn), releasedOn: S(line.releasedOn), exitedOn: S(line.exitedOn), exitOffice: S(line.exitOffice), status: line.status });
  }));
  return out;
}
