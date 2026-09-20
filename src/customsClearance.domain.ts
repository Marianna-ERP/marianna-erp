// ─────────────────────────────────────────────────────────────────────────────
// customsClearance.domain.ts — v6.99.44 (X-1, X-5…X-9, owner 19 Sept)
// A customs clearance belongs to the UNIT that crosses the border. The agent's CC529C release message (Polish
// customs, XML) carries every fact tagged — MRN, LRN, dates, offices, the truck's plates, kilos, packages, CN,
// the invoice declared — so the clearance line is FILLED from the file, matched to the truck by plates, and
// cross-checked against the shipment. The user types nothing; without a file, three fields suffice.
// ─────────────────────────────────────────────────────────────────────────────
const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => { const n = parseFloat(S(v).replace(",", ".")); return isFinite(n) ? n : 0; };

export interface UnitClearance {
  unitId: any; type?: string; mrn?: string; lrn?: string; declaredOn?: string; releasedOn?: string;
  officeExport?: string; officeExit?: string; status: "Pending" | "Declared" | "Released" | "Held";
  plates?: string; grossKg?: number; netKg?: number; packages?: number; cn?: string; invoiceRef?: string; incoterm?: string; place?: string; consignee?: string; note?: string;
  sourceFile?: string;
}

/** One line per unit on the border-crossing leg (leg 1 for road; the sea leg's containers are cleared at the port). */
export function clearanceLinesFor(sh: any): UnitClearance[] {
  const units = ((sh?.legs || [])[0]?.vehicles || []);
  const existing: UnitClearance[] = Array.isArray(sh?.customsUnits) ? sh.customsUnits : [];
  return units.map((u: any) => existing.find(c => String(c.unitId) === String(u.id)) || { unitId: u.id, status: "Pending" as const });
}

function tag(xml: string, name: string): string { const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`)); return m ? S(m[1]) : ""; }
function tags(xml: string, name: string): string[] { const re = new RegExp(`<${name}>([^<]*)</${name}>`, "g"); const out: string[] = []; let m: RegExpExecArray | null; while ((m = re.exec(xml))) out.push(S(m[1])); return out; }

/** Read the CC529C (export release) XML. Tolerant: any tag missing simply stays empty. */
export function parseCC529C(xmlText: string): Partial<UnitClearance> & { ok: boolean; countriesOfRouting?: string[]; invoiceValue?: number; invoiceCurrency?: string } {
  const x = String(xmlText || "");
  if (!/<MRN>/.test(x) && !/<LRN>/.test(x)) return { ok: false };
  // the means of transport at departure: <TransportEquipment>/<DepartureTransportMeans> → typeOfIdentification 30 + identificationNumber plates
  const ids = tags(x, "identificationNumber");
  const plates = ids.find(v => /[A-Z]{2,3}\d|\d[A-Z]/.test(v) && v.includes("/")) || ids.find(v => /^[A-Z]{1,3}[A-Z0-9 ]{3,}$/.test(v) && !v.startsWith("PL") && v !== "STATEK") || "";
  // the invoice: <SupportingDocument><type>N380</type><referenceNumber>FV…</referenceNumber>
  let invoiceRef = "";
  const sd = x.match(/<type>N380<\/type>\s*<referenceNumber>([^<]*)<\/referenceNumber>/) || x.match(/<referenceNumber>([^<]*)<\/referenceNumber>\s*<type>N380<\/type>/);
  if (sd) invoiceRef = S(sd[1]);
  const consigneeName = (() => { const m = x.match(/<Consignee>[\s\S]*?<name>([^<]*)<\/name>/); return m ? S(m[1]) : ""; })();
  const offices = tags(x, "referenceNumber").filter(v => /^[A-Z]{2}\d{6}$/.test(v));
  return {
    ok: true,
    mrn: tag(x, "MRN"), lrn: tag(x, "LRN"),
    type: [tag(x, "declarationType"), tag(x, "additionalDeclarationType")].filter(Boolean).join(" "),
    declaredOn: tag(x, "declarationAcceptanceDate").slice(0, 10), releasedOn: tag(x, "releaseDate").slice(0, 10),
    officeExport: (x.match(/<CustomsOfficeOfExport>[\s\S]*?<referenceNumber>([^<]*)</) || [])[1] || offices[0] || "",
    officeExit: (x.match(/<CustomsOfficeOfExit(?:Declared)?>[\s\S]*?<referenceNumber>([^<]*)</) || [])[1] || offices.find(o => o !== offices[0]) || "",
    plates, grossKg: num(tag(x, "grossMass")), netKg: num(tag(x, "netMass")), packages: num(tag(x, "numberOfPackages")),
    cn: (tag(x, "harmonizedSystemSubHeadingCode") + tag(x, "combinedNomenclatureCode")) || "",
    invoiceRef, incoterm: tag(x, "incotermCode"), place: tag(x, "location"), consignee: consigneeName,
    countriesOfRouting: tags(x, "country").filter(c => /^[A-Z]{2}$/.test(c)),
    invoiceValue: num(tag(x, "totalAmountInvoiced")), invoiceCurrency: tag(x, "invoiceCurrency"),
    status: tag(x, "releaseDate") ? "Released" : "Declared",
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
