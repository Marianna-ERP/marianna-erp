import React, { useState, useMemo } from "react";
import { PAGE_MAX } from "./ui";
import { Card, SectionTitle, SmallButton, DocRef, cancelledDocSet, useConfirm } from "./ui";
import {
  blankLoadPlan, planShipments, planTotals, mapGaps, containerContents,
  tracebackFromContainer, planGaps,
} from "./loadPlan.domain";
import { localTodayISO } from "./dates";
import { nextId } from "./ids";

const INP: any = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 6, padding: "6px 8px", fontSize: 12.5, boxSizing: "border-box" };
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
const fmt = (n: number) => Math.round(n).toLocaleString("pl-PL");

/**
 * LOAD PLAN TAB (v6.56.0)
 *
 * The commercial movement that your five trucks and four containers actually
 * are. Option B: shipments keep one carrier each and stay exactly as they were;
 * this groups them. Nothing numeric is stored here — every figure is derived
 * from the member shipments, so a plan can never drift from them.
 */
export default function LoadPlans({ loadPlans = [], setLoadPlans, shipments = [], contacts = [], costPLN = () => 0, onOpenShipment = null }: any) {
  const { confirm: uiConfirm, dialogNode } = useConfirm();
  const [selectedId, setSelectedId] = useState<any>(null);
  const cancelledRefs = useMemo(() => cancelledDocSet(shipments), [shipments]);
  const plans = loadPlans || [];
  const selected = plans.find((p: any) => p.id === selectedId) || plans[0] || null;

  const patch = (id: any, fields: any) =>
    setLoadPlans((prev: any[]) => (prev || []).map(p => p.id === id ? { ...p, ...fields } : p));

  function create() {
    const today = localTodayISO();
    const p = blankLoadPlan(plans, new Date(today).getFullYear() || 2026, nextId(), today);
    setLoadPlans((prev: any[]) => [...(prev || []), p]);
    setSelectedId(p.id);
  }

  async function remove(p: any) {
    if (!(await uiConfirm({ tone: "danger", title: "Delete this load plan?", message: `${p.number} groups ${(p.shipmentRefs || []).length} shipment(s). Deleting the plan does NOT touch the shipments themselves — they stay exactly as they are.`, confirmLabel: "Delete plan" }))) return;
    setLoadPlans((prev: any[]) => (prev || []).filter(x => x.id !== p.id));
    setSelectedId(null);
  }

  const members = selected ? planShipments(selected, shipments) : [];
  const totals = selected ? planTotals(selected, shipments, costPLN) : null;
  const gaps = selected ? planGaps(selected, shipments) : [];
  const containers = selected ? containerContents(selected) : [];
  const unmapped = selected ? mapGaps(selected, shipments) : [];

  const toggleMember = (numRef: string) => {
    if (!selected) return;
    const has = (selected.shipmentRefs || []).includes(numRef);
    patch(selected.id, {
      shipmentRefs: has ? selected.shipmentRefs.filter((r: string) => r !== numRef) : [...(selected.shipmentRefs || []), numRef],
      // Removing a shipment must not leave orphan map rows pointing at it.
      map: has ? (selected.map || []).filter((e: any) => e.shipmentRef !== numRef && e.containerRef !== numRef) : (selected.map || []),
    });
  };

  const addMapRow = () => {
    if (!selected) return;
    patch(selected.id, { map: [...(selected.map || []), { containerRef: "", shipmentRef: "", qtyKg: 0 }] });
  };
  const setMapRow = (i: number, field: string, v: any) => {
    if (!selected) return;
    patch(selected.id, { map: (selected.map || []).map((e: any, ix: number) => ix === i ? { ...e, [field]: field === "qtyKg" ? num(v) : v } : e) });
  };
  const delMapRow = (i: number) => {
    if (!selected) return;
    patch(selected.id, { map: (selected.map || []).filter((_: any, ix: number) => ix !== i) });
  };

  return <div style={{ flex: 1, overflow: "hidden", padding: "16px 28px 24px" }}>
    {dialogNode}
    <div style={{ maxWidth: PAGE_MAX, margin: "0 auto", height: "100%", display: "grid", gridTemplateColumns: "330px 1fr", gap: 16 }}>

      {/* ── register ── */}
      <Card style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <SectionTitle>LOAD PLANS ({plans.length})</SectionTitle>
          <SmallButton kind="green" onClick={create}>+ New</SmallButton>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {!plans.length && <div style={{ padding: 16, fontSize: 12, color: "#94A3B8", lineHeight: 1.6 }}>
            No load plans yet. A load plan groups the shipments of one commercial movement — five trucks collecting from three producers, transshipped into four containers, is one plan and nine shipments.
          </div>}
          {plans.map((p: any) => {
            const t = planTotals(p, shipments, costPLN);
            const g = planGaps(p, shipments);
            return <div key={p.id} onClick={() => setSelectedId(p.id)}
              style={{ padding: "9px 13px", borderBottom: "1px solid #F1F5F9", cursor: "pointer", background: selected?.id === p.id ? "#F9FAFB" : "#fff", borderLeft: selected?.id === p.id ? "4px solid #111" : "4px solid transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 12.5, fontWeight: 800 }}>{p.number}</span>
                {g.length === 0
                  ? <span style={{ fontSize: 9.5, fontWeight: 700, color: "#166534", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 999, padding: "1px 7px" }}>complete</span>
                  : <span title={g.join(" · ")} style={{ fontSize: 9.5, fontWeight: 700, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 999, padding: "1px 7px" }}>{g.length} open</span>}
              </div>
              <div style={{ fontSize: 10.5, color: "#64748B", marginTop: 3 }}>
                {p.name ? `${p.name} · ` : ""}{t.live} shipment(s) · {fmt(t.kg)} kg
              </div>
            </div>;
          })}
        </div>
      </Card>

      {/* ── detail ── */}
      <div style={{ overflow: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        {!selected && <Card><div style={{ fontSize: 12.5, color: "#94A3B8" }}>Select or create a load plan.</div></Card>}

        {selected && <>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 850 }}>{selected.number}</div>
                <input value={selected.name || ""} onChange={e => patch(selected.id, { name: e.target.value })}
                  placeholder="Name this movement — e.g. Jordan export week 33" style={{ ...INP, marginTop: 6, maxWidth: 420 }} />
              </div>
              <SmallButton kind="red" onClick={() => remove(selected)}>Delete plan</SmallButton>
            </div>
            {totals && <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginTop: 12 }}>
              {[["SHIPMENTS", `${totals.live}${totals.cancelled ? ` (+${totals.cancelled} cancelled)` : ""}`],
                ["WEIGHT", `${fmt(totals.kg)} kg`],
                ["PALLETS", String(totals.pallets || "—")],
                ["FREIGHT", totals.freightPLN ? `${fmt(totals.freightPLN)} PLN` : "—"],
                ["PROTOCOLS", totals.protocolsTotal ? `${totals.protocolsBack}/${totals.protocolsTotal} back` : "—"]].map(([k, v]) => (
                <div key={k} style={{ background: "#FAFAFA", border: "1px solid #F1F5F9", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: "#94A3B8", letterSpacing: 0.4 }}>{k}</div>
                  <div style={{ fontSize: 14, fontWeight: 800, marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>}
            {totals && (totals.poRefs.length > 0 || totals.soRefs.length > 0) && (
              <div style={{ marginTop: 10, fontSize: 11, color: "#64748B" }}>
                {totals.poRefs.length > 0 && <span>Orders in: {totals.poRefs.join(", ")}</span>}
                {totals.poRefs.length > 0 && totals.soRefs.length > 0 && <span> · </span>}
                {totals.soRefs.length > 0 && <span>Orders out: {totals.soRefs.join(", ")}</span>}
              </div>
            )}
            {gaps.length > 0 && (
              <div style={{ marginTop: 11, padding: "9px 11px", borderRadius: 7, background: "#FFFBEB", border: "1px solid #FDE68A", fontSize: 11.5, color: "#92400E" }}>
                <strong>Not complete</strong>
                <div style={{ marginTop: 4, lineHeight: 1.5 }}>{gaps.map((g, i) => <div key={i}>· {g}</div>)}</div>
              </div>
            )}
          </Card>

          {/* ── members ── */}
          <Card>
            <SectionTitle>SHIPMENTS IN THIS PLAN</SectionTitle>
            <div style={{ fontSize: 10.5, color: "#94A3B8", marginBottom: 8, lineHeight: 1.5 }}>
              Tick every shipment belonging to this movement — the trucks and the sea or air legs. Each keeps its own carrier and its own transport order; grouping them changes nothing about the shipments themselves.
            </div>
            <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid #F1F5F9", borderRadius: 7 }}>
              {(shipments || []).map((sh: any) => {
                const on = (selected.shipmentRefs || []).includes(sh.number);
                return <label key={sh.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 9px", borderBottom: "1px solid #F8FAFC", fontSize: 11.5, cursor: "pointer" }}>
                  <input type="checkbox" checked={on} onChange={() => toggleMember(sh.number)} />
                  <DocRef num={sh.number} cancelledSet={cancelledRefs} />
                  <span style={{ color: "#94A3B8" }}>{sh.mode} · {sh.status}</span>
                  <span style={{ marginLeft: "auto", color: "#64748B" }}>{fmt((sh.goods || []).reduce((a: number, g: any) => a + num(g.qtyKg), 0))} kg</span>
                </label>;
              })}
            </div>
          </Card>

          {/* ── transshipment map ── */}
          <Card>
            <SectionTitle>TRANSSHIPMENT MAP</SectionTitle>
            <div style={{ fontSize: 10.5, color: "#94A3B8", marginBottom: 8, lineHeight: 1.5 }}>
              What the forwarder reports once the containers are loaded: which truck went into which container. Where one truck is split, enter the kilos per container. This is the chain a damage claim runs back along — container, to trucks, to each truck's signed loading protocol, to the producer.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 0.8fr 40px", gap: 8, fontSize: 10, fontWeight: 700, color: "#94A3B8", padding: "0 2px 5px" }}>
              <div>CONTAINER / RECEIVING UNIT</div><div>TRUCK (SHIPMENT)</div><div>KG IN IT</div><div />
            </div>
            {(selected.map || []).map((e: any, i: number) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 0.8fr 40px", gap: 8, marginBottom: 5, alignItems: "center" }}>
                <input value={e.containerRef || ""} onChange={ev => setMapRow(i, "containerRef", ev.target.value)} placeholder="MSKU 123456-7" style={INP} list="lp-containers" />
                <select value={e.shipmentRef || ""} onChange={ev => setMapRow(i, "shipmentRef", ev.target.value)} style={INP}>
                  <option value="">— pick a truck —</option>
                  {members.map((m: any) => <option key={m.id} value={m.number}>{m.number} · {m.mode}</option>)}
                </select>
                <input type="number" value={e.qtyKg || ""} onChange={ev => setMapRow(i, "qtyKg", ev.target.value)} placeholder="0" style={INP} />
                <button onClick={() => delMapRow(i)} title="Remove this line" style={{ border: "1px solid #FECACA", background: "#fff", color: "#DC2626", borderRadius: 6, cursor: "pointer", height: 30 }}>✕</button>
              </div>
            ))}
            <datalist id="lp-containers">
              {Array.from(new Set((selected.map || []).map((e: any) => e.containerRef).filter(Boolean))).map((c: any) => <option key={c} value={c} />)}
            </datalist>
            <SmallButton onClick={addMapRow}>+ Line</SmallButton>
            {unmapped.length > 0 && (
              <div style={{ marginTop: 10, padding: "8px 11px", borderRadius: 7, background: "#FFFBEB", border: "1px solid #FDE68A", fontSize: 11.5, color: "#92400E" }}>
                {unmapped.map(g => <div key={g.shipmentRef}>
                  · {g.shipmentRef}: {g.unmappedKg > 1 ? `${fmt(g.unmappedKg)} kg not placed in any container` : `${fmt(g.overKg)} kg more placed than the truck carries`}
                </div>)}
              </div>
            )}
          </Card>

          {/* ── what each container holds ── */}
          {containers.length > 0 && <Card>
            <SectionTitle>WHAT EACH CONTAINER HOLDS</SectionTitle>
            <div style={{ fontSize: 10.5, color: "#94A3B8", marginBottom: 8 }}>
              Read this the day the client reports damage: the container names its trucks, and each truck's loading protocol carries the producer, variety, calibre and the condition signed at the dock.
            </div>
            {containers.map(c => (
              <div key={c.containerRef} style={{ border: "1px solid #F1F5F9", borderRadius: 8, padding: "9px 11px", marginBottom: 7 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800, fontFamily: "ui-monospace, Menlo, monospace" }}>{c.containerRef}</span>
                  <span style={{ fontSize: 11, color: "#64748B" }}>{fmt(c.kg)} kg</span>
                </div>
                <div style={{ marginTop: 5, fontSize: 11.5, color: "#334155" }}>
                  fed by {tracebackFromContainer(selected, c.containerRef).map((r, i, arr) => (
                    <span key={r}>
                      <span onClick={() => onOpenShipment && onOpenShipment(r)} style={{ cursor: onOpenShipment ? "pointer" : "default", textDecoration: onOpenShipment ? "underline" : "none" }}>{r}</span>
                      {i < arr.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </Card>}

          <Card>
            <SectionTitle>NOTES</SectionTitle>
            <textarea value={selected.notes || ""} onChange={e => patch(selected.id, { notes: e.target.value })} rows={3} style={{ ...INP, resize: "vertical" }} />
          </Card>
        </>}
      </div>
    </div>
  </div>;
}
