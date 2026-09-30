// ─── v6.99.84 (A-ST-6, owner 30 Sept): the truck's SALES REPORT on the company's standard document template ────────────
// Same header as the printed PO (logo left, bilingual title right), the producer and our company side by side, then the
// sales per variety and the settlement in the order the owner ruled on 30 Sept: sales → costs → our commission → the
// producer's correction (credit note or extra invoice against net sales BEFORE commission) → what moves after compensation.
// Every figure comes from computePOSettlement — the report never recalculates.
import React from "react";
import { BiLbl, COMPANY, PrintLogo } from "./PurchaseOrders";
import { formatDMY } from "./dates";

const n0 = (v: number) => Math.round(v || 0).toLocaleString("pl-PL");
const n2 = (v: number) => (v || 0).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SalesReportDoc({ order, calc, supplierRef = "", no = "", today = "", producerName = "" }: any) {
  const cur = calc.currency || "EUR"; const prod = producerName || order?.supplier?.name || "the producer";
  const cell: any = { border: "1px solid #ccc", padding: "5px 7px", fontSize: 10.5 };
  const th: any = { ...cell, background: "#F3F4F6", fontWeight: 700, fontSize: 9.5, textAlign: "right" };
  const row = (label: string, value: string, strong = false, color = "#111") => (
    <tr><td style={{ ...cell, borderRight: "none" }}>{label}</td><td style={{ ...cell, borderLeft: "none", textAlign: "right", fontWeight: strong ? 700 : 500, color, whiteSpace: "nowrap" }}>{value}</td></tr>);
  const bal = calc.balanceEUR || 0;
  return (
    <div style={{ fontFamily: "Arial, Calibri, sans-serif", color: "#111", width: "100%" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}><tbody><tr>
        <td style={{ width: "35%", verticalAlign: "middle", padding: "4px 0" }}><PrintLogo /></td>
        <td style={{ width: "65%", textAlign: "right", verticalAlign: "middle" }}>
          <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.1 }}>Sales report</div>
          <div style={{ fontSize: 13, fontStyle: "italic", color: "#555", marginTop: 2 }}>Raport sprzedaży</div>
        </td></tr></tbody></table>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}><tbody><tr>
        <td style={{ ...cell, width: "50%", verticalAlign: "top" }}>
          {[["Report no.", "Nr raportu", no || "—"], ["Date", "Data", formatDMY(today) || "—"], ["Purchase order", "Zamówienie", order?.number || "—"], ["Producer's reference", "Nr producenta", supplierRef || "—"], ["Status", "Status", calc.fullySold ? "final — fully sold" : "interim — not fully sold"]].map(([en, pl, v], i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 3 }}><div style={{ flex: "0 0 45%" }}><span style={{ fontWeight: 700, fontSize: 9.5 }}>{en}</span><span style={{ fontStyle: "italic", color: "#777", fontSize: 8.5, marginLeft: 4 }}>{pl}</span></div><div style={{ fontSize: 11, fontWeight: 600 }}>{v}</div></div>))}
        </td>
        <td style={{ ...cell, verticalAlign: "top" }}>
          <BiLbl en="Producer" pl="Producent" /><div style={{ marginTop: 3, fontWeight: 700, fontSize: 12 }}>{prod}</div>
          <div style={{ marginTop: 8 }}><BiLbl en="Sold by" pl="Sprzedawca" /></div><div style={{ marginTop: 3, fontWeight: 700, fontSize: 12 }}>{COMPANY.name}</div>
          {COMPANY.address.split("\n").map((l: string, i: number) => <div key={i} style={{ fontSize: 10.5 }}>{l}</div>)}<div style={{ fontSize: 10.5 }}>NIP {COMPANY.nip}</div>
        </td></tr></tbody></table>

      <div style={{ fontSize: 11, fontWeight: 700, margin: "4px 0" }}>Sales per variety <span style={{ fontWeight: 400, color: "#555" }}>· kg and PLN, excl. VAT{calc.salesBasis === "invoice" ? " · at the sales invoices' rates" : calc.salesBasis === "mixed" ? " · invoiced and ordered sales" : " · from the sales orders (not yet invoiced)"}</span></div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
        <thead><tr><th style={{ ...th, textAlign: "left" }}>Variety · lot</th><th style={th}>Received kg</th><th style={th}>Class I kg</th><th style={th}>Class II kg</th><th style={th}>Waste kg</th><th style={th}>Sold kg</th><th style={th}>PLN / kg</th><th style={th}>Value PLN</th></tr></thead>
        <tbody>{(calc.lines || []).map((l: any) => { const sold = (l.soldKg || 0) + (l.soldKgII || 0); const val = (l.salesPLN || 0) + (l.salesPLNII || 0); return (
          <tr key={l.lotNumber}><td style={{ ...cell, textAlign: "left" }}><b>{l.variety || l.product}</b> <span style={{ color: "#777" }}>{l.lotNumber}</span></td>
            <td style={{ ...cell, textAlign: "right" }}>{l.receivedKg ? n0(l.receivedKg) : l.expectedKg ? <span style={{ color: "#888" }}>{n0(l.expectedKg)} expected</span> : "0"}</td>
            <td style={{ ...cell, textAlign: "right" }}>{n0(l.classIKg)}</td><td style={{ ...cell, textAlign: "right" }}>{n0(l.classIIKg)}</td><td style={{ ...cell, textAlign: "right" }}>{n0(l.wasteKg)}</td>
            <td style={{ ...cell, textAlign: "right" }}>{n0(sold)}</td><td style={{ ...cell, textAlign: "right" }}>{sold ? n2(val / sold) : "—"}</td><td style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{n2(val)}</td></tr>); })}</tbody>
      </table>

      <table style={{ width: "62%", marginLeft: "auto", borderCollapse: "collapse" }}><tbody>
        {row("Sales (excl. VAT)", `${n2(calc.grossPLN)} PLN`, true)}
        {calc.creditNotesPLN ? row("− Client credit notes", `${n2(calc.creditNotesPLN)} PLN`) : null}
        {calc.warehousePLN ? row("− Warehouse service", `${n2(calc.warehousePLN)} PLN`) : null}
        {calc.additionalPLN ? row("− Transport and other costs", `${n2(calc.additionalPLN)} PLN`) : null}
        {calc.thirdPartyRecoveriesPLN ? row("+ Recovered from third parties", `${n2(calc.thirdPartyRecoveriesPLN)} PLN`) : null}
        {calc.producerRecoveriesPLN ? row("− Claims against the producer", `${n2(calc.producerRecoveriesPLN)} PLN`) : null}
        {row("Sales after costs", `${n2(calc.netPLN)} PLN`, true)}
        {cur !== "PLN" ? row(`Rate PLN → ${cur}`, String(calc.ratePLNperEUR || "—")) : null}
        {cur !== "PLN" ? row("Sales after costs", `${n2(calc.netSalesEUR)} ${cur}`, true) : null}
        {row(`Our commission ${calc.commissionPct} %`, `${n2(calc.commissionEUR)} ${cur}`)}
        {row("Due to the producer after commission", `${n2(calc.netAfterCommissionEUR)} ${cur}`, true)}
        {calc.provisionalEUR ? row(`Producer's provisional invoice${calc.provisionalCurrency !== cur ? ` (${n2(calc.provisionalOriginal)} ${calc.provisionalCurrency})` : ""}`, `${n2(calc.provisionalEUR)} ${cur}`) : null}
        {calc.provisionalEUR ? row(calc.correctionEUR >= 0 ? `1 · ${prod} issues an EXTRA INVOICE` : `1 · ${prod} issues a CREDIT NOTE`, `${n2(Math.abs(calc.correctionEUR))} ${cur}`, true, calc.correctionEUR >= 0 ? "#B45309" : "#6D28D9") : null}
        {calc.provisionalEUR ? row(`2 · ${COMPANY.name} issues its COMMISSION INVOICE`, `${n2(calc.commissionEUR)} ${cur}`, true) : null}
        {calc.provisionalEUR ? row(`3 · After compensation — ${bal >= 0 ? `we owe ${prod}` : `${prod} owes us`}`, `${n2(Math.abs(bal))} ${cur}`, true, "#15803D") : null}
      </tbody></table>
      <div style={{ marginTop: 14, fontSize: 9, color: "#777" }}>Credit note or extra invoice against the sales after costs before commission; our commission invoice follows and the two are compensated.</div>
    </div>
  );
}
