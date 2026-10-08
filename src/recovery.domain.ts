// ─── v7.4.0 (A-REC-1, owner 6–7 Oct): RECOVER FROM A BACKUP — RECORD BY RECORD, NOT ALL OR NOTHING ─────────────────
// A backup (a file from the backup folder, an export, or a Supabase snapshot) is COMPARED with today's data, module by
// module: records the backup has that are MISSING now, records that DIFFER, records ADDED since. The person ticks what to
// bring back; each chosen record returns WITH what it needs that is missing too (its company, its place, its PO, its lots…).
// Nothing that exists now is removed; a record that differs is replaced only when it is ticked. Master data is never removed.

export const RECOVERABLE: Array<{ key: string; label: string }> = [
  { key: "contacts", label: "Companies" }, { key: "customLocations", label: "Locations" },
  { key: "pos", label: "Purchase orders" }, { key: "lots", label: "Lots" }, { key: "orders", label: "Sales orders" },
  { key: "shipments", label: "Shipments" }, { key: "invoices", label: "Invoices" }, { key: "financeNotes", label: "Credit / debit notes" },
  { key: "claims", label: "Claims" }, { key: "inspections", label: "Quality reports" }, { key: "operationalCosts", label: "Operational costs" },
  { key: "poSettlements", label: "Truck settlements" },
];
const MASTER = new Set(["contacts", "customLocations", "productCatalog", "packagingTypes", "users", "company", "numbering"]);
export const isMasterStore = (k: string) => MASTER.has(k);

const keyOf = (r: any) => (r && r.id != null ? `id:${r.id}` : r && r.number ? `no:${r.number}` : "");
export const labelOf = (r: any) => String(r?.number || r?.name || r?.id || "—");

export interface StoreDiff { key: string; label: string; missing: any[]; differ: Array<{ now: any; backup: any }>; added: any[] }
export function compareBackup(current: Record<string, any>, backup: Record<string, any>): StoreDiff[] {
  return RECOVERABLE.filter(s => Array.isArray(backup[s.key])).map(s => {
    const cur = new Map<string, any>(); (Array.isArray(current[s.key]) ? current[s.key] : []).forEach((r: any) => { const k = keyOf(r); if (k) cur.set(k, r); });
    const bak = new Map<string, any>(); (backup[s.key] || []).forEach((r: any) => { const k = keyOf(r); if (k) bak.set(k, r); });
    const missing: any[] = [], differ: Array<{ now: any; backup: any }> = [], added: any[] = [];
    bak.forEach((r, k) => { const n = cur.get(k); if (!n) missing.push(r); else if (JSON.stringify(n) !== JSON.stringify(r)) differ.push({ now: n, backup: r }); });
    cur.forEach((r, k) => { if (!bak.has(k)) added.push(r); });
    return { key: s.key, label: s.label, missing, differ, added };
  });
}

// references a record makes to other records — by field NAME only, so a quantity never passes for an id
const REF_KEY = /^(.*Id|.*Ref|.*Refs|lotNumber|lotRef|poRef|soRef|sourceRef|invoiceId|claimId|counterpartyId|supplierId|clientId)$/;
function refsOf(rec: any): string[] {
  const out: string[] = [];
  const walk = (o: any, k: string) => {
    if (o == null) return;
    if (Array.isArray(o)) { o.forEach(x => walk(x, k)); return; }
    if (typeof o === "object") {
      if (["supplier", "client", "counterparty", "producer", "carrier", "forwarder", "warehouse"].includes(k) && o.id != null) out.push(String(o.id));
      Object.entries(o).forEach(([kk, v]) => walk(v, kk)); return;
    }
    if (REF_KEY.test(k) && (typeof o === "string" || typeof o === "number") && String(o).trim()) out.push(String(o));
  };
  Object.entries(rec || {}).forEach(([k, v]) => { if (k !== "id" && k !== "number") walk(v, k); });
  return out;
}

export interface RecoveryPlan { take: Array<{ key: string; rec: any; why: string }>; }
/** The chosen records plus everything they need that is missing now (followed transitively), never something that exists now. */
export function planRecovery(current: Record<string, any>, backup: Record<string, any>, chosen: Array<{ key: string; rec: any }>): RecoveryPlan {
  const nowIds = new Set<string>(); const bakIndex = new Map<string, { key: string; rec: any }>();
  RECOVERABLE.forEach(s => {
    (Array.isArray(current[s.key]) ? current[s.key] : []).forEach((r: any) => { if (r?.id != null) nowIds.add(String(r.id)); if (r?.number) nowIds.add(String(r.number)); if (r?.siteId != null) nowIds.add(String(r.siteId)); });
    (Array.isArray(backup[s.key]) ? backup[s.key] : []).forEach((r: any) => { [r?.id, r?.number, r?.siteId].filter(x => x != null && x !== "").forEach(x => { if (!bakIndex.has(String(x))) bakIndex.set(String(x), { key: s.key, rec: r }); }); });
  });
  const take: Array<{ key: string; rec: any; why: string }> = []; const seen = new Set<string>();
  const add = (key: string, rec: any, why: string) => { const k = key + "|" + keyOf(rec); if (seen.has(k)) return; seen.add(k); take.push({ key, rec, why }); refsOf(rec).forEach(ref => { if (nowIds.has(ref)) return; const hit = bakIndex.get(ref); if (hit) add(hit.key, hit.rec, `needed by ${labelOf(rec)}`); }); };
  chosen.forEach(c => add(c.key, c.rec, "chosen"));
  return { take };
}
/** Today's stores with the plan applied — added or replaced by id / number; nothing removed. */
export function applyRecovery(current: Record<string, any>, plan: RecoveryPlan): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  plan.take.forEach(({ key, rec }) => {
    const list = out[key] || (Array.isArray(current[key]) ? current[key].slice() : []);
    const k = keyOf(rec); const i = list.findIndex((r: any) => keyOf(r) === k);
    if (i >= 0) list[i] = rec; else list.push(rec);
    out[key] = list;
  });
  return out;
}
