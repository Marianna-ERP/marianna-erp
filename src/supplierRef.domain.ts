// v7.8.0 (A-PO-REF-1, owner 8 Oct): the producer's reference is unique, like the import permit and the ACID number.
// Compared without spaces, dashes, dots, slashes and letter case; deleted POs and trucks do not count.
export const refKey = (v: any) => String(v ?? "").toLowerCase().replace(/[\s\-_./]/g, "");
/** Where else this reference is already used (PO numbers), excluding the PO being edited. */
export function supplierRefUsedOn(ref: any, exceptPO: any, pos: any[], shipments: any[]): string[] {
  const k = refKey(ref); if (!k) return [];
  const out = new Set<string>();
  (pos || []).forEach((p: any) => { if (p && p.status !== "Cancelled" && String(p.number) !== String(exceptPO) && refKey(p.supplierRef) === k) out.add(String(p.number)); });
  (shipments || []).forEach((s: any) => { if (!s || s.status === "Cancelled") return; const own = (s.poRefs || []).map(String); if (own.includes(String(exceptPO))) return; if (refKey(s.supplierRef) === k) out.add(String(own[0] || s.number)); });
  return Array.from(out);
}
/** Every reference used on more than one PO (for the integrity check). */
export function duplicateSupplierRefs(pos: any[], shipments: any[]): Array<{ ref: string; on: string[] }> {
  const by = new Map<string, { ref: string; on: Set<string> }>();
  const add = (ref: any, doc: string) => { const k = refKey(ref); if (!k) return; const e = by.get(k) || { ref: String(ref), on: new Set<string>() }; e.on.add(doc); by.set(k, e); };
  (pos || []).forEach((p: any) => { if (p && p.status !== "Cancelled") add(p.supplierRef, String(p.number)); });
  (shipments || []).forEach((s: any) => { if (s && s.status !== "Cancelled") add(s.supplierRef, String((s.poRefs || [])[0] || s.number)); });
  return Array.from(by.values()).filter(e => e.on.size > 1).map(e => ({ ref: e.ref, on: Array.from(e.on) }));
}
