// ─── v6.99.81 (A-IN, owner 29 Sept): what the inventory list and the lot view SAY about a lot ─────────────────────
// Pure readers over the stored lot — the stored statuses and quantities do not change. Six things the owner found
// unclear are decided here once: the status word, whether a lot is direct, its value in its own state, the arrival /
// age cell, the two shipments behind a "+100 %" badge, and the flow when no shipment exists yet.
import { S } from "./format";

const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };

/** Plain words on the badge: Expected · In transit · In stock · Shipped · Delivered · Cancelled (the stored value stays). */
export function lotStatusLabel(status: any): { label: string; color: string; bg: string } {
  const s = S(status);
  if (/^Direct Expected$|^Expected$/.test(s)) return { label: "Expected", color: "#6B7280", bg: "#F3F4F6" };
  if (/^In Transit$/i.test(s)) return { label: "In transit", color: "#0284C7", bg: "#E0F2FE" };
  if (/^Customs$/i.test(s)) return { label: "Customs", color: "#D97706", bg: "#FEF3C7" };
  if (/^In Stock$/i.test(s)) return { label: "In stock", color: "#16A34A", bg: "#DCFCE7" };
  if (/^Shipped Out$/i.test(s)) return { label: "Shipped", color: "#2563EB", bg: "#DBEAFE" };
  if (/^Delivered/i.test(s)) return { label: "Delivered", color: "#0F766E", bg: "#CCFBF1" };
  if (/Cancelled/i.test(s)) return { label: "Cancelled", color: "#DC2626", bg: "#FEE2E2" };
  if (/^Damaged$/i.test(s)) return { label: "Damaged", color: "#DC2626", bg: "#FEE2E2" };
  return { label: s || "—", color: "#6B7280", bg: "#F3F4F6" };
}

/** A direct lot goes producer → client and never sits with us — whatever location its last movement left on it. */
export function lotIsDirect(lot: any): boolean {
  return !!lot?.directFlow || S(lot?.custodyType) === "Direct" || /direct/i.test(S(lot?.status));
}

/** The lot's value in its own state, with the word that goes under it. */
export function lotValue(lot: any, costPerKg: number): { pln: number; kg: number; label: "in stock" | "delivered" | "shipped" | "expected" | "—" } {
  const phys = num(lot?.physicalKg), rec = num(lot?.receivedKg), exp = num(lot?.expectedKg);
  if (/Cancelled/i.test(S(lot?.status))) return { pln: 0, kg: 0, label: "—" };
  if (phys > 0) return { pln: phys * costPerKg, kg: phys, label: "in stock" };
  if (rec > 0) return { pln: rec * costPerKg, kg: rec, label: /Delivered/i.test(S(lot?.status)) ? "delivered" : "shipped" };
  if (exp > 0) return { pln: exp * costPerKg, kg: exp, label: "expected" };
  return { pln: 0, kg: 0, label: "—" };
}

const liveIns = (lot: any) => (lot?.movements || []).filter((m: any) => m && !m.voided && m.type === "IN" && m.date);
const liveOuts = (lot: any) => (lot?.movements || []).filter((m: any) => m && !m.voided && m.type === "SHIP_OUT" && m.date);
const dayDiff = (a: string, b: string) => Math.max(0, Math.floor((new Date(a).getTime() - new Date(b).getTime()) / 86400000));

/** The "Arrived · age" cell: stock lots count their days with us; direct lots show their dates and never a count. */
export function lotArrivedCell(lot: any, todayISO: string): { kind: "stock" | "direct" | "expected" | "none"; date?: string; days?: number; loaded?: string; delivered?: string } {
  const ins = liveIns(lot).map((m: any) => String(m.date)).sort();
  if (lotIsDirect(lot)) {
    const outs = liveOuts(lot).map((m: any) => String(m.date)).sort();
    const loaded = ins[0] || S(lot?.loadingDate) || "";
    const delivered = /Delivered/i.test(S(lot?.status)) ? (outs[outs.length - 1] || S(lot?.arrivalDate) || "") : "";
    if (!loaded && !delivered) return S(lot?.arrivalDate) ? { kind: "expected", date: S(lot?.arrivalDate) } : { kind: "none" };
    return { kind: "direct", loaded, delivered };
  }
  if (ins.length && num(lot?.physicalKg) > 0) return { kind: "stock", date: ins[0], days: dayDiff(todayISO, ins[0]) };
  if (ins.length) return { kind: "stock", date: ins[0], days: undefined };
  return S(lot?.arrivalDate) ? { kind: "expected", date: S(lot?.arrivalDate) } : { kind: "none" };
}

/** A lot received by more than one shipment: the two (or more) shipments, so the badge can say so. */
export function lotLoadedBy(lot: any): string[] {
  return Array.from(new Set(liveIns(lot).map((m: any) => S(m.shipmentRef || m.ref)).filter(Boolean)));
}
export function lotLoadedTwice(lot: any): string[] | null { const by = lotLoadedBy(lot); return by.length > 1 && num(lot?.receivedKg) > num(lot?.expectedKg) ? by : null; }
