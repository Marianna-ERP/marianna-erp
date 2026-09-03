import React, { useState } from "react";
import { localTodayISO } from "./dates";
import { nextId } from "./ids";
import { PrintLogo } from "./brand";
import { SmallButton, Lbl, useConfirm } from "./ui";
import { printHtmlNode } from "./documentService";
import { inspectLink } from "./docLinks.domain";
import {
  buildLoadingProtocol, deriveRows, protocolTotals, protocolExceptions, protocolGaps,
  unitGoodsLines, protocolForUnit, protocolsForShipment, checkTruckLoad, signatureWarnings,
  isBlankRow, filledRows, padToSheet, SHEET_MIN_ROWS, packagingResolution,
  PALLET_CAPACITY,
} from "./loadingProtocol.domain";

// ─── v6.46.0  LOADING PROTOCOL / KARTA ZAŁADUNKU ─────────────────────────────
// Generated for the producer, who fills it in and has it signed and stamped by
// himself (wydawca) AND the transport company's driver (kierowca) at loading.
// A clean signed sheet is what makes a later transport claim provable.
//
// Bilingual by design: Polish first (the producer and driver sign it), English
// underneath so a non-Polish carrier can read it too.

const TXT: any = {
  title:      { pl: "KARTA ZAŁADUNKU", en: "LOADING PROTOCOL" },
  supplier:   { pl: "Dostawca", en: "Supplier" },
  receiver:   { pl: "Odbiorca", en: "Receiver" },
  plates:     { pl: "Nr rejestracyjny pojazdu", en: "Vehicle registration no." },
  assortment: { pl: "Asortyment", en: "Assortment" },
  chamber:    { pl: "Temperatura komory chłodniczej przed załadunkiem", en: "Cold chamber temperature before loading" },
  clean1:     { pl: "Potwierdzenie czystości środka transportu", en: "Confirmation the vehicle is clean" },
  clean2:     { pl: "Potwierdzenie czystości komory chłodniczej", en: "Confirmation the cold chamber is clean" },
  odours:     { pl: "Obecność obcych zapachów", en: "Presence of foreign odours" },
  packaging:  { pl: "Stan opakowań i palet", en: "Condition of packaging and pallets" },
  palletNo:   { pl: "Nr palety", en: "Pallet no." },
  item:       { pl: "Towar", en: "Item" },
  variety:    { pl: "Odmiana", en: "Variety" },
  qty:        { pl: "Ilość opakowań szt x KG", en: "Packages pcs x kg" },
  size:       { pl: "Rozmiar", en: "Calibre" },
  boxesOk:    { pl: "Skrzynki w dobrym stanie", en: "Boxes in good condition" },
  goodsOk:    { pl: "Towar nieuszkodzony", en: "Goods undamaged" },
  remarks:    { pl: "Uwagi", en: "Remarks" },
  observ:     { pl: "Obserwacje", en: "Observations" },
  driver:     { pl: "KIEROWCA", en: "DRIVER" },
  issuer:     { pl: "WYDAWCA", en: "ISSUER" },
  date:       { pl: "DATA", en: "DATE" },
  stampSign:  { pl: "PIECZĄTKA I PODPIS", en: "STAMP AND SIGNATURE" },
  recorders:  { pl: "Nr rejestratorów temperatury", en: "Temperature recorder no." },
  version:    { pl: "Wersja", en: "Version" },
  page:       { pl: "Strona", en: "Page" },
};
const FOOT1 = {
  pl: "1. Odbiorca zostawia za sobą prawo ubiegać się o odszkodowanie kosztów w razie uszkodzenia towaru / przewrócenia palet pod czas transportu.",
  en: "1. The receiver reserves the right to claim compensation for costs in the event of damage to the goods / overturning of pallets during transport.",
};
const FOOT2 = {
  pl: "2. Kierowca ma obowiązek wydruku temperatury z naczepy chłodni po rozładunku.",
  en: "2. The driver is obliged to print the temperature record from the refrigerated trailer after unloading.",
};

/** Bilingual label: Polish bold, English italic underneath. */
function BL({ k, align = "left" }: any) {
  const t = TXT[k] || { pl: k, en: "" };
  return (
    <div style={{ textAlign: align, lineHeight: 1.15 }}>
      <div style={{ fontWeight: 700, fontSize: 9.5 }}>{t.pl}</div>
      <div style={{ fontStyle: "italic", color: "#555", fontSize: 8 }}>{t.en}</div>
    </div>
  );
}

const TD: any = { border: "1px solid #333", padding: "3px 4px", fontSize: 9.5, verticalAlign: "middle" };
const SUMTD: any = { ...TD, border: "2px solid #111", background: "#F8FAFC" };
const TH: any = { ...TD, background: "#F3F4F6", fontWeight: 700, textAlign: "center" };
const INP: any = { width: "100%", boxSizing: "border-box", border: "1px solid #E5E7EB", borderRadius: 5, padding: "5px 7px", fontSize: 12 };

/** TAK / NIE presented as the paper form does: both printed, the chosen one boxed. */
function TakNie({ value, yes = "TAK", no = "NIE" }: any) {
  const box = (on: boolean) => ({
    padding: "0 5px", fontWeight: on ? 800 : 400,
    border: on ? "1.5px solid #111" : "1px solid transparent",
    borderRadius: 3, color: on ? "#111" : "#666",
  });
  return (
    <span style={{ fontSize: 9.5 }}>
      <span style={box(value === true)}>{yes}</span>
      <span style={{ margin: "0 3px", color: "#999" }}>/</span>
      <span style={box(value === false)}>{no}</span>
    </span>
  );
}

export default function LoadingProtocolModal({
  shipment, contacts = [], pos = [], packagingTypes = [], allShipments = [],
  companyName = "", company = null, gateReason = "", shipmentCancelled = false, onSave, onClose,
}: any) {
  const { confirm: uiConfirm, alert: uiAlert, dialogNode } = useConfirm();

  // ── v6.53.0: ONE SHEET PER TRUCK ──────────────────────────────────────────
  // The road legs' transport units are the sheets. A shipment with one truck
  // behaves exactly as before; a shipment with three trucks gets three
  // independently numbered sheets, each covering only what that truck carries.
  const trucks = React.useMemo(() => {
    const out: any[] = [];
    (shipment?.legs || []).forEach((leg: any) => {
      if (leg?.mode !== "Road") return;
      const units = (Array.isArray(leg.vehicles) && leg.vehicles.length)
        ? leg.vehicles
        : [{ id: `leg${leg.id}-u1`, truckPlate: leg.vehiclePlate || "", trailerPlate: leg.trailerPlate || "", driverName: leg.driverName || "" }];
      units.forEach((u: any, i: number) => out.push({ leg, unit: u, label: u.truckPlate || u.vehiclePlate || `Truck ${out.length + 1}`, idx: i }));
    });
    return out.length ? out : [{ leg: (shipment?.legs || [])[0] || {}, unit: {}, label: "Truck 1", idx: 0 }];
  }, [shipment]);

  const [truckIx, setTruckIx] = useState(0);
  const current = trucks[Math.min(truckIx, trucks.length - 1)] || trucks[0];

  const makeSheet = React.useCallback((t: any, alreadyDrafted: any[]) => {
    const stored = protocolForUnit(shipment, t.unit?.id);
    // v6.57.0: a sheet saved before this release holds only its derived rows.
    // Pad it on read so it prints the full 21 lines, without rewriting stored
    // data — the same fold-forward approach used for per-truck protocols.
    if (stored) return { ...stored, rows: padToSheet(stored.rows || []) };
    const poRef = (shipment?.poRefs || [])[0] || "";
    const po = (pos || []).find((x: any) => x.number === poRef);
    const supplier = po?.supplier || (contacts || []).find((c: any) => String(c.id) === String(po?.supplierId)) || null;
    const carrier = (contacts || []).find((c: any) => String(c.id) === String(t.leg?.carrierId));
    // Numbering must not collide with sheets drafted in this session but not
    // yet saved, or two trucks would print the same LP number.
    const others = [
      ...(allShipments || []).flatMap((s: any) => protocolsForShipment(s)),
      ...alreadyDrafted,
    ].filter(Boolean);
    return buildLoadingProtocol(
      { shipment, leg: t.leg, unit: t.unit, goods: shipment?.goods, supplier, receiverName: companyName,
        carrierName: carrier?.name || "", types: packagingTypes, existingProtocols: others },
      { todayISO: () => localTodayISO(), nextId }, // v6.80.0 (W-7): central counter
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipment, pos, contacts, allShipments, companyName, packagingTypes]);

  // Each truck's sheet is kept separately, so switching trucks never loses typing.
  const [sheets, setSheets] = useState<Record<string, any>>(() => {
    const seed: Record<string, any> = {};
    const drafted: any[] = [];
    trucks.forEach((t, i) => {
      const s = makeSheet(t, drafted);
      seed[String(i)] = s;
      drafted.push(s);
    });
    return seed;
  });

  const p = sheets[String(truckIx)] || sheets["0"];
  const setP = (fn: any) => setSheets((all: any) => ({ ...all, [String(truckIx)]: typeof fn === "function" ? fn(all[String(truckIx)]) : fn }));

  /** The goods this truck actually carries — the basis of its pallet table. */
  const truckGoods = unitGoodsLines(shipment?.goods || [], current?.unit);

  const sf = (k: string, v: any) => setP((x: any) => ({ ...x, [k]: v }));
  const sc = (k: string, v: any) => setP((x: any) => ({ ...x, checks: { ...x.checks, [k]: v } }));
  const sr = (i: number, k: string, v: any) =>
    setP((x: any) => ({ ...x, rows: (x.rows || []).map((r: any, ri: number) => ri === i ? { ...r, [k]: v } : r) }));

  const renumber = (rows: any[]) => rows.map((r: any, i: number) => ({ ...r, no: i + 1 }));
  const addRow = () => setP((x: any) => {
    const last = (x.rows || [])[(x.rows || []).length - 1];
    return { ...x, rows: renumber([...(x.rows || []), { no: 0, boxes: last?.boxes || 72, kgPerBox: last?.kgPerBox || 13, size: "", boxesOk: null, goodsOk: null, remarks: "", observations: "" }]) };
  });
  const removeRow = (i: number) => setP((x: any) => ({ ...x, rows: renumber((x.rows || []).filter((_: any, ri: number) => ri !== i)) }));
  const regenerate = async () => {
    if (!(await uiConfirm({ tone: "warn", title: "Re-derive the pallet table?", message: "The rows will be rebuilt from what this truck is assigned to carry. Anything typed into the table (calibres, conditions, remarks) will be lost.", confirmLabel: "Re-derive" }))) return;
    setP((x: any) => ({ ...x, rows: deriveRows(truckGoods, packagingTypes) }));  // deriveRows pads to 21
  };

  const totals = protocolTotals(p, packagingTypes, (truckGoods || [])[0]?.product);
  // v6.57.0: how many of the sheet's 21 lines actually carry goods.
  const usedRows = filledRows(p.rows || []).length;
  // v6.58.1: sheets saved before this release have no product on their rows.
  // Fall back to the truck's goods rather than re-deriving (which would discard
  // whatever the producer already wrote), so old sheets print an Item too.
  const legacyProduct = String((truckGoods || [])[0]?.product || "");
  // v6.74.0: the registration numbers are read LIVE from the transport unit.
  // They were captured when the sheet was CREATED, so a protocol drafted before
  // the plates were typed printed "Nr rejestracyjny pojazdu" permanently blank —
  // and re-deriving to pick them up would have discarded everything the producer
  // had written. The unit is the truth about which truck this is; the stored
  // value only answers for a sheet whose unit has since been removed.
  const livePlates = {
    truckPlate: String(current?.unit?.truckPlate || current?.unit?.vehiclePlate || p.truckPlate || ""),
    trailerPlate: String(current?.unit?.trailerPlate || p.trailerPlate || ""),
    driverName: String(current?.unit?.driverName || p.driverName || ""),
    containerNumber: String(current?.unit?.containerNumber || (p as any).containerNumber || ""),
  };
  // v6.57.1: if a goods line has no resolvable packaging there is no box weight,
  // so no pallet split is possible and the table comes out empty. Say so.
  const pkgCheck = packagingResolution(truckGoods, packagingTypes);
  const exceptions = protocolExceptions(p);
  const gaps = protocolGaps(p);
  const sigWarnings = signatureWarnings(p);
  const recorderText = (p.recorderNos || []).join(", ");
  // v6.53.0: a truck fills by floor space or by weight, whichever binds first.
  const load = checkTruckLoad(totals.pallets, totals.grossKg, p.palletType || "standard");

  const save = async (status?: string) => {
    // v6.54.0: the shipment was cancelled — the truck never ran. Its sheets stay
    // on record but are read-only: nothing may be issued, edited or marked back.
    if (shipmentCancelled) {
      await uiAlert({ tone: "warn", title: "Shipment cancelled",
        message: "This shipment was cancelled, so its loading protocols are void and read-only. A cancelled movement never happened — there is nothing to send or record against it." });
      return;
    }
    // v6.53.0: an unconfirmed PO must not put a truck under load. Issuing is
    // blocked; recording a sheet that has already come back never is — the
    // paperwork exists whatever the order status now says.
    if (status === "Sent" && gateReason) {
      await uiAlert({ tone: "warn", title: "Order not confirmed", message: gateReason });
      return;
    }
    const next = status ? { ...p, status, returnedAt: status === "Returned" ? (p.returnedAt || localTodayISO()) : p.returnedAt } : p;
    if (status === "Returned" && gaps.length) {
      const ok = await uiConfirm({
        tone: "warn", title: "Record as returned anyway?",
        message: `This sheet is still missing:\n\n• ${gaps.join("\n• ")}\n\nA sheet with gaps is weaker evidence if you later claim against the carrier.`,
        confirmLabel: "Record anyway", cancelLabel: "Go back",
      });
      if (!ok) return;
    }
    setP(next);
    onSave(next, current?.unit?.id);
    if (status === "Returned") {
      await uiAlert({
        tone: exceptions.length ? "warn" : "info",
        title: exceptions.length ? "Recorded — with exceptions" : "Recorded — clean",
        message: exceptions.length
          ? `The sheet records ${exceptions.length} exception(s):\n\n• ${exceptions.slice(0, 8).join("\n• ")}\n\nThese are the grounds for a transport claim.`
          : "The sheet is clean: the goods left in good order and the driver signed for it. That is what makes a later transport claim provable.",
      });
    }
  };

  const st = p.status || "Draft";
  const badge = st === "Returned" ? { bg: "#DCFCE7", fg: "#166534" } : st === "Sent" ? { bg: "#DBEAFE", fg: "#1D4ED8" } : { bg: "#F3F4F6", fg: "#555" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(17,24,39,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      {dialogNode}
      <div style={{ width: "min(1180px, calc(100vw - 24px))", height: "calc(100vh - 24px)", overflow: "auto", background: "#fff", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>

        {/* ── toolbar (not printed) ── */}
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "#fff", borderBottom: "1px solid #E5E7EB", padding: "12px 18px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Loading protocol · Karta załadunku</div>
          <div style={{ fontSize: 12, color: "#666" }}>{p.number} · {shipment?.number}</div>
          <span style={{ background: badge.bg, color: badge.fg, borderRadius: 999, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>{st}</span>
          <div style={{ flex: 1 }} />
          <SmallButton onClick={() => printHtmlNode("loading-protocol-print", `${p.number} — ${shipment?.number}`)} kind="dark">Print / PDF</SmallButton>
          <SmallButton onClick={() => save("Sent")} kind="blue">Mark sent to producer</SmallButton>
          <SmallButton onClick={() => save("Returned")} kind="green">Record returned sheet</SmallButton>
          <SmallButton onClick={() => save()}>Save</SmallButton>
          <SmallButton onClick={onClose}>Close</SmallButton>
        </div>

        {/* ── v6.53.0: one sheet per truck (not printed) ── */}
        {trucks.length > 1 && (
          <div style={{ padding: "9px 18px", background: "#fff", borderBottom: "1px solid #E5E7EB", display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#334155" }}>Truck</span>
            {trucks.map((t: any, i: number) => {
              const s = sheets[String(i)] || {};
              const on = i === truckIx;
              const done = s.status === "Returned";
              return (
                <button key={i} onClick={() => setTruckIx(i)} style={{
                  border: on ? "1.5px solid #111827" : "1px solid #E5E7EB", background: done ? "#DCFCE7" : on ? "#F3F4F6" : "#fff",
                  borderRadius: 999, padding: "4px 12px", fontSize: 11.5, fontWeight: on ? 800 : 600, cursor: "pointer", color: "#111827",
                }}>
                  {t.label}{s.number ? ` · ${s.number}` : ""}{s.status && s.status !== "Draft" ? ` · ${s.status}` : ""}
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 10.5, color: "#64748B" }}>Each truck has its own sheet, signed by its own driver at the dock.</span>
          </div>
        )}

        {/* ── capture panel (not printed) ── */}
        <div style={{ padding: "14px 18px", background: "#F9FAFB", borderBottom: "1px solid #E5E7EB" }}>
          <div style={{ fontSize: 11.5, color: "#555", lineHeight: 1.5, marginBottom: 10 }}>
            Print this and send it to the producer, who fills it in and has it <strong>signed and stamped by both himself and the driver</strong> at loading.
            Calibre is left blank on purpose — it is only known when the pallets are built. Temperature recorder numbers are picked from the producer's pack at loading,
            so record them here when the signed sheet comes back.
          </div>
          {shipmentCancelled && (
            <div style={{ padding: "8px 11px", borderRadius: 7, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 11.5, color: "#991B1B", marginBottom: 10 }}>
              <strong style={{ textDecoration: "line-through" }}>Void</strong> — the shipment was cancelled, so this sheet is no longer evidence of anything. It stays on record and can still be printed for the file, but it cannot be issued or marked returned.
            </div>
          )}
          {!pkgCheck.ok && (
            <div style={{ padding: "8px 11px", borderRadius: 7, background: "#FFFBEB", border: "1px solid #FDE68A", fontSize: 11.5, color: "#92400E", marginBottom: 10 }}>
              <strong>No pallet table can be built</strong> — packaging is not set for {Array.from(new Set(pkgCheck.unresolved)).join(", ")}. The sheet needs a box weight and boxes-per-pallet to split the load (19 422 kg ÷ 13 kg = 1 494 boxes → 20 × 72 + 1 × 54 = 21 pallets). Set the packaging type on the PO line or in Settings, then re-derive.
            </div>
          )}
          {gateReason && !shipmentCancelled && (
            <div style={{ padding: "8px 11px", borderRadius: 7, background: "#FFFBEB", border: "1px solid #FDE68A", fontSize: 11.5, color: "#92400E", marginBottom: 10 }}>
              <strong>Not ready to issue</strong> — {gateReason}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 10 }}>
            <div>
              <Lbl>Pallet type on this truck</Lbl>
              <select value={p.palletType || "standard"} onChange={e => sf("palletType", e.target.value)} style={INP}>
                <option value="standard">Standard 1200×1000 — {PALLET_CAPACITY.standard} per truck</option>
                <option value="euro">Euro 1200×800 — {PALLET_CAPACITY.euro} per truck</option>
              </select>
            </div>
            <div><Lbl>Departed on</Lbl><input type="date" value={p.departedOn || ""} onChange={e => sf("departedOn", e.target.value)} style={INP} /></div>
            <div style={{ gridColumn: "span 2", display: "flex", alignItems: "flex-end" }}>
              <div style={{ fontSize: 11.5, padding: "7px 11px", borderRadius: 7, width: "100%",
                background: load.limit ? "#FEF2F2" : "#F0FDF4", border: `1px solid ${load.limit ? "#FECACA" : "#BBF7D0"}`, color: load.limit ? "#991B1B" : "#166534" }}>
                {load.limit === "weight"
                  ? <><strong>Over payload</strong> — {load.grossKg.toLocaleString("pl-PL")} kg gross against {load.maxKg.toLocaleString("pl-PL")} kg. Weight binds before space; this truck could not legally move.</>
                  : load.limit === "pallets"
                    ? <><strong>Over floor space</strong> — {load.pallets} pallets against {load.maxPallets}.</>
                    : <>Fits: {load.pallets}/{load.maxPallets} pallets · {load.grossKg.toLocaleString("pl-PL")}/{load.maxKg.toLocaleString("pl-PL")} kg gross.</>}
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            <div><Lbl>Chamber temp. before loading (°C)</Lbl><input value={p.chamberTempBeforeC || ""} onChange={e => sf("chamberTempBeforeC", e.target.value)} placeholder="e.g. 2" style={INP} /></div>
            <div><Lbl>Temperature recorder no(s), comma separated</Lbl><input value={recorderText} onChange={e => sf("recorderNos", e.target.value.split(",").map(s => s.trim()).filter(Boolean))} placeholder="241002PDF2476186, 241002PDF2476099" style={INP} /></div>
            <div><Lbl>Driver signed (date)</Lbl><input type="date" value={p.driverSignedDate || ""} onChange={e => sf("driverSignedDate", e.target.value)} style={INP} /></div>
            <div><Lbl>Producer signed (date)</Lbl><input type="date" value={p.issuerSignedDate || ""} onChange={e => sf("issuerSignedDate", e.target.value)} style={INP} /></div>
            <div style={{ gridColumn: "span 2" }}>
              <Lbl>Link to the signed scan {p.scanLink ? (inspectLink(p.scanLink).ok
                ? <a href={p.scanLink} target="_blank" rel="noreferrer" style={{ color: "#2563EB", fontWeight: 700, textDecoration: "none" }}>· open {inspectLink(p.scanLink).label} ↗</a>
                : <span style={{ color: "#DC2626", fontWeight: 400 }}>· {inspectLink(p.scanLink).reason}</span>) : null}</Lbl>
              <input value={p.scanLink || ""} onChange={e => sf("scanLink", e.target.value)} placeholder="https://www.dropbox.com/… (the stamped, signed sheet)"
                style={{ ...INP, ...(p.scanLink && !inspectLink(p.scanLink).ok ? { borderColor: "#FCA5A5", background: "#FEF2F2" } : {}) }} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 10 }}>
            {([["transportClean", "Vehicle clean"], ["chamberClean", "Chamber clean"], ["foreignOdours", "Foreign odours PRESENT"], ["packagingCompliant", "Packaging/pallets compliant"]] as any).map(([k, label]: any) => (
              <div key={k}>
                <Lbl>{label}</Lbl>
                <select value={p.checks?.[k] === true ? "y" : p.checks?.[k] === false ? "n" : ""} onChange={e => sc(k, e.target.value === "y" ? true : e.target.value === "n" ? false : null)} style={INP}>
                  <option value="">— not filled —</option>
                  <option value="y">{k === "foreignOdours" ? "Yes — odours present" : "Yes"}</option>
                  <option value="n">{k === "foreignOdours" ? "No foreign odours" : "No"}</option>
                </select>
              </div>
            ))}
          </div>

          {/* pallet table editor */}
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Pallet table — {totals.pallets} pallets · {totals.boxes} boxes · net {totals.netKg.toLocaleString("pl-PL")} kg · gross {totals.grossKg.toLocaleString("pl-PL")} kg</div>
            <div style={{ flex: 1 }} />
            <SmallButton onClick={addRow}>+ Pallet</SmallButton>
            <SmallButton onClick={regenerate}>↻ Re-derive from goods</SmallButton>
            <span style={{ fontSize: 10.5, color: "#64748B", marginLeft: 8 }}>
              {usedRows} pallet{usedRows === 1 ? "" : "s"} loaded · sheet prints {Math.max(SHEET_MIN_ROWS, (p.rows || []).length)} lines
            </span>
          </div>
          <div style={{ maxHeight: 240, overflow: "auto", marginTop: 8, border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
              <thead><tr style={{ background: "#F3F4F6" }}>
                {["#", "Boxes", "kg/box", "Calibre", "Boxes OK", "Goods OK", "Remarks", ""].map((h, i) => (
                  <th key={i} style={{ padding: "5px 7px", textAlign: "left", fontWeight: 700, position: "sticky", top: 0, background: "#F3F4F6" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {/* v6.57.0: rows beyond the derived load are the sheet's spare
                    lines. They stay editable — the producer may well load a 22nd
                    pallet — but are greyed so nobody mistakes them for cargo. */}
                {(p.rows || []).map((r: any, i: number) => (
                  <tr key={i} style={{ borderTop: "1px solid #F1F5F9", background: isBlankRow(r) ? "#FCFCFD" : "#fff", opacity: isBlankRow(r) ? 0.62 : 1 }}>
                    <td style={{ padding: "3px 7px", fontWeight: 700, color: isBlankRow(r) ? "#9CA3AF" : "#111" }}>{r.no}</td>
                    {/* v6.74.0: a spare line's 0 used to sit in the box and could
                        not be cleared — you had to select it and type over. An
                        empty line should LOOK empty; 0 is only shown once someone
                        has actually typed it. */}
                    <td style={{ padding: "3px 4px" }}><input type="number" value={r.boxes || ""} placeholder="—" onChange={e => sr(i, "boxes", e.target.value === "" ? 0 : (parseFloat(e.target.value) || 0))} style={{ ...INP, width: 66, padding: "3px 5px" }} /></td>
                    <td style={{ padding: "3px 4px" }}><input type="number" value={r.kgPerBox || ""} placeholder="—" onChange={e => sr(i, "kgPerBox", e.target.value === "" ? 0 : (parseFloat(e.target.value) || 0))} style={{ ...INP, width: 62, padding: "3px 5px" }} /></td>
                    <td style={{ padding: "3px 4px" }}><input value={r.size || ""} onChange={e => sr(i, "size", e.target.value)} placeholder="70-80" style={{ ...INP, width: 74, padding: "3px 5px" }} /></td>
                    {(["boxesOk", "goodsOk"] as any).map((k: any) => (
                      <td key={k} style={{ padding: "3px 4px" }}>
                        <select value={r[k] === true ? "y" : r[k] === false ? "n" : ""} onChange={e => sr(i, k, e.target.value === "y" ? true : e.target.value === "n" ? false : null)} style={{ ...INP, width: 72, padding: "3px 4px" }}>
                          <option value="">—</option><option value="y">Tak</option><option value="n">Nie</option>
                        </select>
                      </td>
                    ))}
                    <td style={{ padding: "3px 4px" }}><input value={r.remarks || ""} onChange={e => sr(i, "remarks", e.target.value)} placeholder="Brak" style={{ ...INP, padding: "3px 5px" }} /></td>
                    <td style={{ padding: "3px 4px", textAlign: "right" }}><SmallButton kind="red" onClick={() => removeRow(i)}>✕</SmallButton></td>
                  </tr>
                ))}
                {!(p.rows || []).length && <tr><td colSpan={8} style={{ padding: "10px 8px", color: "#9CA3AF" }}>No pallets — add rows or re-derive from the shipment's goods lines.</td></tr>}
              </tbody>
            </table>
          </div>

          {sigWarnings.length > 0 && (
            <div style={{ marginTop: 10, padding: "8px 11px", borderRadius: 7, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 11.5, color: "#991B1B" }}>
              <strong>Signature timing</strong> — both parties sign at the dock, before departure.
              <div style={{ marginTop: 4, lineHeight: 1.5 }}>{sigWarnings.map((w, i) => <div key={i}>· {w}</div>)}</div>
            </div>
          )}

          {(exceptions.length > 0 || gaps.length > 0) && (
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: exceptions.length && gaps.length ? "1fr 1fr" : "1fr", gap: 10 }}>
              {exceptions.length > 0 && (
                <div style={{ padding: "8px 11px", borderRadius: 7, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 11.5, color: "#991B1B" }}>
                  <strong>{exceptions.length} exception(s) recorded</strong> — grounds for a transport claim.
                  <div style={{ marginTop: 4, lineHeight: 1.5 }}>{exceptions.slice(0, 6).map((x, i) => <div key={i}>· {x}</div>)}{exceptions.length > 6 ? <div>· +{exceptions.length - 6} more</div> : null}</div>
                </div>
              )}
              {gaps.length > 0 && (
                <div style={{ padding: "8px 11px", borderRadius: 7, background: "#FFFBEB", border: "1px solid #FDE68A", fontSize: 11.5, color: "#92400E" }}>
                  <strong>Still to come back</strong>
                  <div style={{ marginTop: 4, lineHeight: 1.5 }}>{gaps.map((x, i) => <div key={i}>· {x}</div>)}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── THE PRINTED DOCUMENT ── */}
        <div id="loading-protocol-print" style={{ padding: 22, background: "#fff", color: "#111", fontFamily: "Arial, Helvetica, sans-serif" }}>
          <div style={{ border: "1.5px solid #111", marginBottom: 8 }}>
            {/* v6.66.0 (R-UI3): ONE outer border holds the whole header — company,
                temperature recorders and the document title. The old two-column
                table drew cell borders that intersected and cut across the title. */}
            <div style={{ display: "flex", alignItems: "stretch" }}>
              <div style={{ width: "34%", padding: "6px 8px", textAlign: "center", borderRight: "1px solid #999" }}>
                <PrintLogo width={150} />
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 0.5, marginTop: 2 }}>{company?.name || p.receiverName || "MARIANNA"}</div>
                {company?.address1 ? <div style={{ fontSize: 8 }}>{company.address1}</div> : null}
                {company?.address2 ? <div style={{ fontSize: 8 }}>{company.address2}</div> : null}
                {company?.nip ? <div style={{ fontSize: 8 }}>NIP: {company.nip}</div> : null}
              </div>
              <div style={{ flex: 1, padding: "6px 8px", fontSize: 8.5 }}>
                <div style={{ fontWeight: 700, fontSize: 9 }}>{TXT.recorders.pl}</div>
                <div style={{ fontStyle: "italic", color: "#555" }}>{TXT.recorders.en}</div>
                <div style={{ marginTop: 3, fontFamily: "monospace", fontSize: 10, minHeight: 26 }}>
                  {(p.recorderNos || []).length ? (p.recorderNos || []).map((n: string, i: number) => <div key={i}>{n}</div>) : <div style={{ color: "#999" }}>……………………………………</div>}
                </div>
              </div>
            </div>
            <div style={{ borderTop: "1px solid #999", padding: "7px 6px", textAlign: "center", fontWeight: 800, fontSize: 12.5, letterSpacing: 0.5, lineHeight: 1.35 }}>{TXT.title.pl} / {TXT.title.en}</div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
            <tbody>
              <tr>
                <td style={{ ...TD, width: "50%", verticalAlign: "top", border: "none", paddingLeft: 0 }}>
                  <BL k="supplier" />
                  <div style={{ fontSize: 11, minHeight: 15, borderBottom: "1px dotted #999", marginBottom: 7 }}>{p.supplierName || ""}</div>
                  <BL k="plates" />
                  <div style={{ fontSize: 11, fontWeight: 700, minHeight: 15, borderBottom: "1px dotted #999", marginBottom: 7 }}>
                    {[livePlates.truckPlate, livePlates.trailerPlate].filter(Boolean).join(" / ") || livePlates.containerNumber || ""}
                  </div>
                  <BL k="assortment" />
                  <div style={{ fontSize: 11, minHeight: 15, borderBottom: "1px dotted #999", marginBottom: 7 }}>{p.assortment || ""}</div>
                  <BL k="chamber" />
                  <div style={{ fontSize: 11, fontWeight: 700, minHeight: 15, borderBottom: "1px dotted #999" }}>{p.chamberTempBeforeC ? `${p.chamberTempBeforeC} °C` : ""}</div>
                </td>
                <td style={{ ...TD, width: "50%", verticalAlign: "top", border: "none" }}>
                  <BL k="receiver" />
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 7 }}>{p.receiverName}</div>
                  <BL k="clean1" /><div style={{ marginBottom: 5 }}><TakNie value={p.checks?.transportClean} /></div>
                  <BL k="clean2" /><div style={{ marginBottom: 5 }}><TakNie value={p.checks?.chamberClean} /></div>
                  <BL k="odours" /><div style={{ marginBottom: 5 }}><TakNie value={p.checks?.foreignOdours} yes="TAK" no="NIE MA OBCYCH" /></div>
                  <BL k="packaging" /><div><TakNie value={p.checks?.packagingCompliant} yes="ZGODNY" no="NIEZGODNY" /></div>
                </td>
              </tr>
            </tbody>
          </table>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {/* v6.58.0 column order (user ruling): pallet no, packages
                    (BOX COUNT — 72 x 13 kg), item, variety, calibre, boxes in
                    good condition, goods undamaged, remarks. The Observations
                    column is removed: it duplicated Remarks and its width was
                    what pushed the signatures onto a second page. Widths now
                    total 100% and fit one page with the signatures at the foot. */}
                <th style={{ ...TH, width: "6%" }}><BL k="palletNo" align="center" /></th>
                <th style={{ ...TH, width: "13%" }}><BL k="qty" align="center" /></th>
                <th style={{ ...TH, width: "14%" }}><BL k="item" align="center" /></th>
                <th style={{ ...TH, width: "13%" }}><BL k="variety" align="center" /></th>
                <th style={{ ...TH, width: "11%" }}><BL k="size" align="center" /></th>
                <th style={{ ...TH, width: "12%" }}><BL k="boxesOk" align="center" /></th>
                <th style={{ ...TH, width: "12%" }}><BL k="goodsOk" align="center" /></th>
                <th style={{ ...TH, width: "19%" }}><BL k="remarks" align="center" /></th>
              </tr>
            </thead>
            <tbody>
              {/* v6.57.0: the sheet prints 21 numbered lines whatever the truck
                  carries, because the producer writes on the paper at the dock.
                  Blank lines are ruled and numbered but left empty and slightly
                  taller, so there is room to write by hand. */}
              {(p.rows || []).map((r: any, i: number) => {
                const blank = isBlankRow(r);
                const cell = blank ? { ...TD, height: 17, background: "#fff" } : TD;
                return (
                  <tr key={i}>
                    <td style={{ ...cell, textAlign: "center", fontWeight: 700, color: blank ? "#9CA3AF" : "#111" }}>{r.no}</td>
                    <td style={{ ...cell, textAlign: "center" }}>{blank ? "" : `${r.boxes} × ${r.kgPerBox} kg`}</td>
                    <td style={{ ...cell, textAlign: "center" }}>{blank ? "" : (r.product || legacyProduct)}</td>
                    <td style={{ ...cell, textAlign: "center" }}>{r.variety || ""}</td>
                    <td style={{ ...cell, textAlign: "center", minWidth: 44 }}>{r.size || ""}</td>
                    <td style={{ ...cell, textAlign: "center" }}>{r.boxesOk === true ? "Tak" : r.boxesOk === false ? "Nie" : ""}</td>
                    <td style={{ ...cell, textAlign: "center" }}>{r.goodsOk === true ? "Tak" : r.goodsOk === false ? "Nie" : ""}</td>
                    <td style={cell}>{r.remarks || ""}</td>
                  </tr>
                );
              })}
              {(p.rows || []).length > 0 && (
                <tr>
                  {/* v6.62.0 (user ruling): the summary is boxed in a heavier
                      border so the totals read as their own block rather than
                      as one more pallet line. */}
                  <td style={{ ...SUMTD, fontWeight: 800, textAlign: "center" }}>{totals.pallets}</td>
                  <td style={{ ...SUMTD, fontWeight: 800, textAlign: "center" }}>{totals.boxes} szt</td>
                  <td style={{ ...SUMTD, fontWeight: 700, fontSize: 8.5 }} colSpan={6}>
                    Netto / Net {totals.netKg.toLocaleString("pl-PL")} kg · Brutto / Gross {totals.grossKg.toLocaleString("pl-PL")} kg
                    <span style={{ fontWeight: 400, color: "#555" }}> (opakowania / packaging {totals.boxTareTotalKg.toLocaleString("pl-PL")} kg + palety / pallets {totals.palletTareTotalKg.toLocaleString("pl-PL")} kg)</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ border: "1px solid #333", borderTop: "none", padding: "5px 6px", fontSize: 8, lineHeight: 1.45 }}>
            <div style={{ fontWeight: 700 }}>{FOOT1.pl}</div>
            <div style={{ fontStyle: "italic", color: "#555", marginBottom: 3 }}>{FOOT1.en}</div>
            <div style={{ fontWeight: 700 }}>{FOOT2.pl}</div>
            <div style={{ fontStyle: "italic", color: "#555" }}>{FOOT2.en}</div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
            <tbody>
              <tr>
                {(["driver", "issuer"] as any).map((who: any) => (
                  <td key={who} style={{ width: "50%", verticalAlign: "top", padding: "0 10px 0 0", border: "none" }}>
                    <div style={{ fontWeight: 800, fontSize: 10 }}>{TXT[who].pl} <span style={{ fontWeight: 400, fontStyle: "italic", color: "#555" }}>/ {TXT[who].en}</span></div>
                    <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "baseline" }}>
                      <div style={{ fontWeight: 700, fontSize: 9.5 }}>{TXT.date.pl} / {TXT.date.en}</div>
                      <div style={{ flex: 1, borderBottom: "1px solid #333", fontSize: 11, fontWeight: 700, minHeight: 15 }}>
                        {who === "driver" ? (p.driverSignedDate || "") : (p.issuerSignedDate || "")}
                      </div>
                    </div>
                    {/* v6.58.0 (user ruling): the pre-printed driver name and
                        carrier line under the signature box is removed. The
                        driver writes his own name when he signs — printing it
                        for him adds nothing and pre-empts the signature. */}
                    <div style={{ fontWeight: 700, fontSize: 9.5, marginTop: 8 }}>{TXT.stampSign.pl}</div>
                    <div style={{ fontStyle: "italic", color: "#555", fontSize: 8 }}>{TXT.stampSign.en}</div>
                    <div style={{ height: 54, border: "1px dashed #999", borderRadius: 4, marginTop: 3 }} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>

          <div style={{ marginTop: 8, fontSize: 8, color: "#666", display: "flex", justifyContent: "space-between" }}>
            <span>{p.number} · {p.shipmentRef}{trucks.length > 1 ? ` · ${current?.label} (${truckIx + 1}/${trucks.length})` : ""}</span>
            {/* v6.57.1: page number belongs in the footer (moved out of the
                header grid, where it sat beside the retired Wersja box). */}
            <span style={{ fontWeight: 700 }}>{TXT.page?.pl || "Strona"} 1 / 1</span>
            <span style={{ fontStyle: "italic" }}>Confidential</span>
          </div>
        </div>
      </div>
    </div>
  );
}
