// SalesOrderDocument.tsx — v6.99.68 (A-AUD-2, owner): moved out of SalesOrders.tsx unchanged; the module's shared helpers are imported from it.
import React from "react";
import { formatAddress, addressOf, liveParty } from "./address.domain";
import { formatDMY } from "./dates";
import { paymentBasisOf, paymentTermsLabel } from "./po.domain";
import { BiLbl, COMPANY, CONTACTS_REF, PrintLogo, destinationDisplay, destinationForPrint, netTotal } from "./SalesOrders";

export function SODoc({ order }: any) {
  const total = netTotal(order.items);
  const currency = order.currency || "PLN";
  const paymentDisplay = paymentTermsLabel(paymentBasisOf(order), order.paymentDays, true);   // v6.99.23
  const destinationLabel = destinationDisplay(order);

  const meta = [
    { en: "SO No.",             pl: "Nr zamówienia",          value: order.number,             strong: true },
    { en: "Order date",         pl: "Data zamówienia",        value: formatDMY(order.orderDate) },
    { en: "Delivery date",      pl: "Data dostawy",           value: formatDMY(order.deliveryDate) },
    { en: "Incoterm",           pl: "Warunki Incoterms",      value: order.sellIncoterm,       strong: true },
    { en: "Payment",            pl: "Warunki płatności",      value: paymentDisplay },
    { en: "Delivery to",        pl: "Miejsce dostawy",        value: destinationForPrint(order) || destinationLabel },   // v6.99.39 (D-1): with the address
    ...(order.importPermitNo ? [{ en: "Import permit no.", pl: "Nr pozwolenia importowego", value: order.importPermitNo, strong: true }] : []),
    ...(order.acidNo ? [{ en: "ACID no.", pl: "Nr ACID", value: order.acidNo, strong: true }] : []),
  ];
  const clientRows = [
    { en: "Name",      pl: "Nazwa",     value: order.client?.name    || "—" },
    { en: "Country",   pl: "Kraj",      value: order.client?.country || "—" },
    { en: "Address",   pl: "Adres",     value: formatAddress(addressOf(liveParty(order.client, CONTACTS_REF || [])), { oneLine: true }) || liveParty(order.client, CONTACTS_REF || [])?.address || "—" },   // v6.99.40 (ADDR-1)
    { en: "NIP / VAT", pl: "NIP / VAT", value: order.client?.nip     || "—" },
    { en: "Contact",   pl: "Kontakt",   value: order.client?.contact || "—" },
  ];

  return (
    <div style={{ fontFamily: "Calibri, Arial, sans-serif", fontSize: 10.5, color: "#111", width: "100%" }}>
      {/* HEADER */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
        <tbody>
          <tr>
            <td style={{ width: "35%", verticalAlign: "middle", padding: "4px 0" }}>
              <PrintLogo />
            </td>
            <td style={{ width: "65%", textAlign: "right", verticalAlign: "middle" }}>
              <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.1 }}>Sales Order</div>
              <div style={{ fontSize: 13, fontStyle: "italic", color: "#555", marginTop: 2 }}>Zamówienie sprzedaży</div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* META + SELLER */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #ccc", padding: "8px 10px", width: "50%", verticalAlign: "top" }}>
              {meta.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "baseline", marginBottom: i === meta.length - 1 ? 0 : 4, gap: 8 }}>
                  <div style={{ flex: "0 0 42%" }}>
                    <span style={{ fontWeight: 700, fontSize: 9.5 }}>{r.en}</span>
                    <span style={{ fontStyle: "italic", color: "#777", fontSize: 8.5, marginLeft: 4 }}>{r.pl}</span>
                  </div>
                  <div style={{ fontWeight: r.strong ? 700 : 500, fontSize: r.strong ? 12 : 11 }}>{r.value || "—"}</div>
                </div>
              ))}
            </td>
            <td style={{ border: "1px solid #ccc", padding: "8px 10px", verticalAlign: "top", width: "50%" }}>
              <BiLbl en="Seller" pl="Sprzedawca" />
              <div style={{ marginTop: 4, fontWeight: 700, fontSize: 12 }}>{COMPANY.name}</div>
              <div style={{ fontSize: 11 }}>{COMPANY.person}</div>
              {COMPANY.address.split("\n").map((l, i) => <div key={i} style={{ fontSize: 11 }}>{l}</div>)}
              <div style={{ fontSize: 11, marginTop: 2 }}><span style={{ fontWeight: 600 }}>NIP:</span> {COMPANY.nip}</div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* BUYER */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: -1 }}>
        <thead>
          <tr>
            <th colSpan={2} style={{ border: "1px solid #ccc", background: "#f9f9f9", padding: "6px 10px", textAlign: "left" }}>
              <BiLbl en="Buyer" pl="Nabywca" />
            </th>
          </tr>
        </thead>
        <tbody>
          {clientRows.map(r => (
            <tr key={r.en}>
              <td style={{ border: "1px solid #ccc", padding: "5px 10px", width: "30%", verticalAlign: "top" }}>
                <span style={{ fontWeight: 700, fontSize: 9.5 }}>{r.en}</span>
                <span style={{ fontStyle: "italic", color: "#777", fontSize: 8.5, marginLeft: 4 }}>{r.pl}</span>
              </td>
              <td style={{ border: "1px solid #ccc", padding: "5px 10px", fontWeight: 500 }}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* GOODS TABLE */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: -1 }}>
        <thead>
          <tr>
            <th colSpan={11} style={{ border: "1px solid #ccc", background: "#f9f9f9", padding: "6px 10px", textAlign: "left" }}>
              <BiLbl en="Description of goods" pl="Opis towaru" />
            </th>
          </tr>
          <tr style={{ background: "#f3f3f3" }}>
            {[
              { en: "Product",     pl: "Produkt",      align: "left" },
              { en: "Origin",      pl: "Pochodzenie",  align: "left" },
              { en: "Size",        pl: "Kaliber",      align: "center" },
              { en: "Quality",     pl: "Klasa",        align: "center" },
              { en: "Packaging",   pl: "Opakowanie",   align: "left" },
              { en: "Pallets",     pl: "Palety",       align: "center" },
              { en: "Unit",        pl: "Jedn.",        align: "center" },
              { en: "Qty",         pl: "Ilość",        align: "right" },
              { en: "Unit Price",  pl: "Cena jedn.",   align: "right" },
              { en: "Currency",    pl: "Waluta",       align: "center" },
              { en: "Total",       pl: "Wartość",      align: "right" },
            ].map((h, i) => {
              const headerAlign = h.align as "left" | "center" | "right";
              return (
                <th key={i} style={{ border: "1px solid #ccc", padding: "5px 5px", textAlign: headerAlign, verticalAlign: "bottom" }}>
                  <BiLbl en={h.en} pl={h.pl} align={headerAlign} />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, i) => {
            const lt = ((parseFloat(item.qty) || 0) * (parseFloat(item.unitPrice) || 0)).toFixed(2);
            return (
              <tr key={i}>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", fontWeight: 700 }}>{item.product}{item.variety ? <span style={{ fontWeight: 400 }}> — {item.variety}</span> : null}{item.cnCode ? <div style={{ fontSize: 8.5, fontWeight: 400, color: "#666" }}>CN/HS: {item.cnCode}</div> : null}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px" }}>{item.origin}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "center" }}>{item.size}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "center" }}>Kl. {item.quality}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px" }}>{item.packaging || "—"}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "center" }}>{item.pallets || "—"}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "center" }}>{item.unit || "Kg"}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "right" }}>{parseFloat(item.qty || 0).toLocaleString("pl-PL")}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "right" }}>{parseFloat(item.unitPrice || 0).toFixed(2)}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "center" }}>{order.currency}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "right", fontWeight: 600 }}>{parseFloat(lt).toLocaleString("pl-PL", { minimumFractionDigits: 2 })}</td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={9} style={{ border: "1px solid #ccc", padding: "6px 8px", verticalAlign: "top" }}>
              <div style={{ fontSize: 9, color: "#777" }}>
                <span style={{ fontWeight: 700, color: "#E05A2B" }}>Notes</span>
                <span style={{ fontStyle: "italic", marginLeft: 4 }}>/ Uwagi</span>
              </div>
              <div style={{ marginTop: 3, fontSize: 10.5, color: "#333", whiteSpace: "pre-wrap" }}>{order.notes || "—"}</div>
            </td>
            <td style={{ border: "1px solid #ccc", padding: "6px 8px", textAlign: "right", background: "#f9f9f9", verticalAlign: "top" }}>
              <BiLbl en="Net Total" pl="Suma netto" align="right" />
            </td>
            <td style={{ border: "1px solid #ccc", padding: "6px 8px", textAlign: "right", fontWeight: 700, fontSize: 12, verticalAlign: "top" }}>
              {total.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} {currency}
            </td>
          </tr>
        </tbody>
      </table>

      {/* SIGNATURES — no legal clause on SO per user request */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #ccc", padding: "10px 10px 6px", width: "50%", textAlign: "center", color: "#888" }}>
              <div style={{ height: 14 }} />
              <div style={{ borderTop: "1px solid #555", paddingTop: 3, margin: "0 auto", maxWidth: 220 }}>
                <BiLbl en="Seller signature" pl="Podpis sprzedawcy" align="center" />
              </div>
            </td>
            <td style={{ border: "1px solid #ccc", padding: "10px 10px 6px", width: "50%", textAlign: "center", color: "#888" }}>
              <div style={{ height: 14 }} />
              <div style={{ borderTop: "1px solid #555", paddingTop: 3, margin: "0 auto", maxWidth: 220 }}>
                <BiLbl en="Buyer signature" pl="Podpis nabywcy" align="center" />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
