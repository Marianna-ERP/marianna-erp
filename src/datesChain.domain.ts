// datesChain.domain.ts — v7.27.18 (A-D-4, the owner's 'your call' → built with the document pages): THE DATES CHAIN OF A DOCUMENT.
// One line on a PO, an SO and a shipment: ordered → loaded → arrived / received → delivered → invoiced → paid, each date read from the
// record that owns it (the trucks, the lots, the invoices and their payments). A step left without a date while a later one has
// one is a GAP, shown at a glance — nothing is typed and nothing is stored.
import { shipmentDates } from "./shipmentModel.domain";
import { shipmentsDeliveringSale } from "./so.domain";   // v7.29.3 (FZ-38)

const S = (v: any) => String(v ?? "").trim();
export interface ChainStep { label: string; date: string; gap: boolean }

const first = (vals: string[]) => vals.map(S).filter(Boolean).sort()[0] || "";
const last = (vals: string[]) => { const v = vals.map(S).filter(Boolean).sort(); return v[v.length - 1] || ""; };
const live = (x: any) => x && !["Cancelled"].includes(S(x.status)) && S(x.paymentStatus) !== "Cancelled";
const linked = (inv: any, type: string, no: any) => (inv?.links || []).some((l: any) => l && l.type === type && S(l.number) === S(no));
/** Paid = the day its invoices became fully paid: the last payment, once every invoice is paid. */
function paidOn(invoices: any[]): string {
  if (!invoices.length || !invoices.every((i: any) => S(i.paymentStatus) === "Paid")) return "";
  return last(invoices.flatMap((i: any) => (i.payments || []).filter((p: any) => p && !p.voided).map((p: any) => S(p.date)))) || "";
}
function withGaps(steps: Array<{ label: string; date: string }>): ChainStep[] {
  return steps.map((s, k) => ({ ...s, date: S(s.date).slice(0, 10), gap: !S(s.date) && steps.slice(k + 1).some(x => S(x.date)) }));
}

export function soDatesChain(so: any, ctx: { shipments?: any[]; invoices?: any[]; pos?: any[]; lots?: any[] } = {}): ChainStep[] {
  const ships = shipmentsDeliveringSale(so, ctx.shipments || [], { pos: ctx.pos, lots: ctx.lots }).filter((s: any) => live(s));   // v7.29.3 (FZ-38): the supplier's truck that delivers it counts
  const d = ships.map((s: any) => shipmentDates(s));
  const inv = (ctx.invoices || []).filter((i: any) => live(i) && i.kind === "SALES" && !i.isProforma && linked(i, "SO", so?.number));
  return withGaps([
    { label: "Ordered", date: S(so?.orderDate) },
    { label: "Loaded", date: first(d.map(x => x.loaded)) },
    { label: "Delivered", date: last(d.map(x => x.delivered)) },
    { label: "Invoiced", date: first(inv.map((i: any) => S(i.issueDate))) },
    { label: "Paid", date: paidOn(inv) },
  ]);
}

export function poDatesChain(po: any, ctx: { shipments?: any[]; lots?: any[]; invoices?: any[] } = {}): ChainStep[] {
  const ships = (ctx.shipments || []).filter((s: any) => live(s) && (s.poRefs || []).includes(po?.number));
  const d = ships.map((s: any) => shipmentDates(s));
  const lots = (ctx.lots || []).filter((l: any) => l && S(l.poRef) === S(po?.number));
  const received = first(lots.flatMap((l: any) => (l.movements || []).filter((m: any) => m && !m.voided && S(m.type) === "IN").map((m: any) => S(m.date))));
  const inv = (ctx.invoices || []).filter((i: any) => live(i) && i.kind === "COST" && !i.isProforma && linked(i, "PO", po?.number));
  return withGaps([
    { label: "Ordered", date: S(po?.orderDate) },
    { label: "Loaded", date: first(d.map(x => x.loaded)) },
    { label: "Received", date: received },
    { label: "Invoiced", date: first(inv.map((i: any) => S(i.issueDate))) },
    { label: "Paid", date: paidOn(inv) },
  ]);
}

export function shipmentDatesChain(sh: any, ctx: { orders?: any[]; invoices?: any[] } = {}): ChainStep[] {
  const d = shipmentDates(sh);
  const sos = Array.from(new Set([...(sh?.soRefs || []), S(sh?.governingSoRef), ...((sh?.goods || []).map((g: any) => S(g?.soRef)))].filter(Boolean)));
  const inv = (ctx.invoices || []).filter((i: any) => live(i) && i.kind === "SALES" && !i.isProforma && (linked(i, "Shipment", sh?.number) || sos.some(no => linked(i, "SO", no))));
  return withGaps([
    { label: "Loaded", date: d.loaded },
    { label: "Delivered", date: d.delivered },
    { label: "Invoiced", date: first(inv.map((i: any) => S(i.issueDate))) },
    { label: "Paid", date: paidOn(inv) },
  ]);
}
