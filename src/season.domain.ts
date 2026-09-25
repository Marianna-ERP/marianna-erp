// ─────────────────────────────────────────────────────────────────────────────
// season.domain.ts — v6.99.54 (AR-1…7, owner ruling 23 Sept)
// Numbers continue across seasons. The old season is ARCHIVED: tagged, hidden from the day-to-day screens, exportable to
// its own JSON, re-importable read-only. Nothing is deleted at season end, and nothing about a document changes except
// how it is shown. A lot that still holds kilos is this season's stock whenever it was bought — it never archives.
// ─────────────────────────────────────────────────────────────────────────────
const S = (v: any) => String(v ?? "").trim();
const num = (v: any) => { const n = parseFloat(S(v).replace(",", ".")); return isFinite(n) ? n : 0; };

export interface SeasonSettings { startMonth: number; startDay: number; }   // default 1 July
export const DEFAULT_SEASON: SeasonSettings = { startMonth: 7, startDay: 1 };

/** "2025/26" for any date between 1 Jul 2025 and 30 Jun 2026 (with the default boundary). */
export function seasonOf(dateISO: any, st: SeasonSettings = DEFAULT_SEASON): string {
  const d = S(dateISO).slice(0, 10); const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
  const startsThisYear = mo > st.startMonth || (mo === st.startMonth && da >= st.startDay);
  const y0 = startsThisYear ? y : y - 1;
  return `${y0}/${String((y0 + 1) % 100).padStart(2, "0")}`;
}
export function currentSeason(todayISO: string, st: SeasonSettings = DEFAULT_SEASON): string { return seasonOf(todayISO, st); }

export type DocKind = "po" | "so" | "shipment" | "lot" | "invoice" | "claim" | "settlement" | "inspection" | "count" | "note" | "warehouseInvoice" | "cost";

/** The date that decides a document's season. One rule per kind, documented here and nowhere else. */
export function docDate(kind: DocKind, doc: any, ctx: { pos?: any[] } = {}): string {
  if (!doc) return "";
  switch (kind) {
    case "po": return S(doc.orderDate || doc.createdAt);
    case "so": return S(doc.orderDate || doc.createdAt);
    case "shipment": return S(doc.loadingDate || (doc.legs || []).flatMap((l: any) => l.vehicles || []).map((u: any) => u.loadedAt || u.plannedLoadingDate).filter(Boolean).sort()[0] || doc.expectedDeliveryDate || doc.createdAt);
    case "lot": { const ins = (doc.movements || []).filter((m: any) => m && !m.voided && m.type === "IN").map((m: any) => S(m.date)).filter(Boolean).sort(); if (ins[0]) return ins[0]; if (doc.arrivalDate) return S(doc.arrivalDate); const po = (ctx.pos || []).find((p: any) => String(p.number) === String(doc.poRef)); return S(po?.orderDate || doc.createdAt); }
    case "invoice": return S(doc.issueDate || doc.saleDate || doc.createdAt);
    case "claim": return S(doc.date || doc.openedAt || doc.createdAt);
    case "settlement": return S(doc.closedAt || doc.createdAt || doc.date);
    case "inspection": return S(doc.date);
    case "count": return S(doc.date);
    case "note": return S(doc.date || doc.issueDate || doc.createdAt);
    case "warehouseInvoice": return S(doc.issueDate || doc.date || doc.createdAt);
    case "cost": return S(doc.date || doc.createdAt);
  }
  return "";
}
export function docSeason(kind: DocKind, doc: any, st: SeasonSettings, ctx: { pos?: any[] } = {}): string { return seasonOf(docDate(kind, doc, ctx), st); }

/** Archived = its season is closed — except a lot that still holds kilos, which is live stock. */
export function isArchived(kind: DocKind, doc: any, archivedSeasons: string[], st: SeasonSettings, ctx: { pos?: any[] } = {}): boolean {
  if (!archivedSeasons || !archivedSeasons.length) return false;
  if (kind === "lot" && num(doc?.physicalKg) > 0) return false;
  const s = docSeason(kind, doc, st, ctx);
  return !!s && archivedSeasons.includes(s);
}

export const STORE_KIND: Record<string, DocKind> = { pos: "po", orders: "so", shipments: "shipment", lots: "lot", invoices: "invoice", claims: "claim", poSettlements: "settlement", inspections: "inspection", stockCounts: "count", financeNotes: "note", creditNotes: "note", warehouseInvoices: "warehouseInvoice", operationalCosts: "cost" };

/** Which seasons exist in the data, with document counts. */
export function seasonsPresent(data: Record<string, any[]>, st: SeasonSettings): Array<{ season: string; count: number }> {
  const acc: Record<string, number> = {};
  Object.entries(STORE_KIND).forEach(([store, kind]) => (data[store] || []).forEach((doc: any) => { const s = docSeason(kind, doc, st, { pos: data.pos || [] }); if (s) acc[s] = (acc[s] || 0) + 1; }));
  return Object.entries(acc).map(([season, count]) => ({ season, count })).sort((a, b) => b.season.localeCompare(a.season));
}

/** AR-5: one JSON with the season's documents (archived ones) plus every master store — a normal MARIANNA file. */
export function sliceSeason(data: Record<string, any>, season: string, st: SeasonSettings, masterKeys: string[], meta: any): any {
  const out: any = { _meta: { ...(meta || {}), archiveSeason: season, exportedAt: new Date().toISOString() } };
  masterKeys.forEach(k => { if (data[k] !== undefined) out[k] = data[k]; });
  Object.entries(STORE_KIND).forEach(([store, kind]) => { out[store] = (data[store] || []).filter((doc: any) => isArchived(kind, doc, [season], st, { pos: data.pos || [] })); });
  out.archivedSeasons = [season];
  return out;
}
/** AR-5: drop the exported season's archived documents from the live data. */
export function removeSeason(data: Record<string, any>, season: string, st: SeasonSettings): { data: Record<string, any>; removed: Record<string, number> } {
  const removed: Record<string, number> = {}; const next: Record<string, any> = { ...data };
  Object.entries(STORE_KIND).forEach(([store, kind]) => { const before = (data[store] || []).length; next[store] = (data[store] || []).filter((doc: any) => !isArchived(kind, doc, [season], st, { pos: data.pos || [] })); const n = before - next[store].length; if (n) removed[store] = n; });
  return { data: next, removed };
}
/** AR-5: bring an archive file back — appended, duplicates by number/id skipped; its season is marked archived so it stays hidden. */
export function appendArchive(current: Record<string, any>, file: any): { data: Record<string, any>; added: Record<string, number>; skipped: number; seasons: string[] } {
  const added: Record<string, number> = {}; let skipped = 0; const next: Record<string, any> = { ...current };
  Object.keys(STORE_KIND).forEach(store => {
    const have = new Set((current[store] || []).map((d: any) => String(d?.number ?? d?.id)));
    const incoming = (file[store] || []).filter((d: any) => { const k = String(d?.number ?? d?.id); if (have.has(k)) { skipped++; return false; } have.add(k); return true; });
    if (incoming.length) { next[store] = [...(current[store] || []), ...incoming]; added[store] = incoming.length; }
  });
  const seasons: string[] = Array.isArray(file.archivedSeasons) ? file.archivedSeasons : (file._meta?.archiveSeason ? [file._meta.archiveSeason] : []);
  next.archivedSeasons = Array.from(new Set([...(current.archivedSeasons || []), ...seasons]));
  return { data: next, added, skipped, seasons };
}
