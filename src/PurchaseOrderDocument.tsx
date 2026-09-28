// PurchaseOrderDocument.tsx — v6.99.68 (A-AUD-2, owner): moved out of PurchaseOrders.tsx unchanged; the module's shared helpers are imported from it.
import React from "react";
import { useConfirm} from "./ui";
import { paymentBasisOf, paymentTermsLabel } from "./po.domain";
import { documentTotals } from "./pricingUnit.domain";
import { formatAddress, addressOf, liveParty } from "./address.domain";
import { formatDMY } from "./dates";
import { placeForPrint } from "./locations";
import { BiLbl, COMPANY, CONTACTS_REF, PO_PACKAGING_TYPES, PrintLogo, destinationDisplay, netTotal } from "./PurchaseOrders";

export function PODoc({ order }: any) {
  const total = netTotal(order.items);
  const currency = order.currency || order.items[0]?.currency || "PLN";
  const paymentDisplay = paymentTermsLabel(paymentBasisOf(order), order.paymentDays, true);   // v6.99.23: derived from the one source

  // Single source of truth for the row labels in the metadata + supplier blocks
  const meta = [
    { en: "PO No.",             pl: "Nr zamówienia",          value: order.number,             strong: true },
    { en: "Order date",         pl: "Data zamówienia",        value: formatDMY(order.orderDate) },
    { en: "Loading date",       pl: "Data załadunku",         value: formatDMY(order.loadingDate) },
    { en: "Expected delivery",  pl: "Przewidywana dostawa",   value: formatDMY(order.expectedDeliveryDate) },
    { en: "Destination",        pl: "Miejsce docelowe",       value: placeForPrint(order.destinationLocationId, order.destinationText, CONTACTS_REF || []).line || destinationDisplay(order) },   // v6.99.39 (D-1): with the address
    { en: "Purchase Incoterm",  pl: "Warunki zakupu Incoterms", value: order.buyIncoterm,      strong: true },
    { en: "Payment",            pl: "Warunki płatności",      value: paymentDisplay },
  ];
  const supplierRows = [
    { en: "Name",      pl: "Nazwa",   value: order.supplier?.name || "—" },
    { en: "Country",   pl: "Kraj",    value: order.supplier?.country || "—" },
    { en: "Address",   pl: "Adres",   value: formatAddress(addressOf(liveParty(order.supplier, CONTACTS_REF || [])), { oneLine: true }) || liveParty(order.supplier, CONTACTS_REF || [])?.address || "—" },   // v6.99.40 (ADDR-1)
    { en: "NIP / VAT", pl: "NIP / VAT", value: order.supplier?.nip || "—" },
    { en: "Contact",   pl: "Kontakt", value: order.supplier?.contact || "—" },
  ];

  return (
    <div style={{ fontFamily: "Calibri, Arial, sans-serif", fontSize: 10.5, color: "#111", width: "100%" }}>
      {/* HEADER — logo top-left, title center, blank right for breathing room */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
        <tbody>
          <tr>
            <td style={{ width: "35%", verticalAlign: "middle", padding: "4px 0" }}>
              <PrintLogo />
            </td>
            <td style={{ width: "65%", textAlign: "right", verticalAlign: "middle" }}>
              <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.1 }}>Purchase Order</div>
              <div style={{ fontSize: 13, fontStyle: "italic", color: "#555", marginTop: 2 }}>Zamówienie zakupu</div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* META + BUYER */}
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
              <BiLbl en="Buyer" pl="Nabywca" />
              <div style={{ marginTop: 4, fontWeight: 700, fontSize: 12 }}>{COMPANY.name}</div>
              <div style={{ fontSize: 11 }}>{COMPANY.person}</div>
              {COMPANY.address.split("\n").map((l, i) => <div key={i} style={{ fontSize: 11 }}>{l}</div>)}
              <div style={{ fontSize: 11, marginTop: 2 }}><span style={{ fontWeight: 600 }}>NIP:</span> {COMPANY.nip}</div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* SUPPLIER */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: -1 }}>
        <thead>
          <tr>
            <th colSpan={2} style={{ border: "1px solid #ccc", background: "#f9f9f9", padding: "6px 10px", textAlign: "left" }}>
              <BiLbl en="Supplier" pl="Dostawca / Sprzedawca" />
            </th>
          </tr>
        </thead>
        <tbody>
          {supplierRows.map(r => (
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
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", fontWeight: 700 }}>
                  {item.product}{item.variety ? <span style={{ fontWeight: 400 }}> — {item.variety}</span> : null}
                  {item.coloration && <div style={{ fontSize: 9.5, color: "#666", fontWeight: 400, fontStyle: "italic" }}>{item.coloration}</div>}
                </td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px" }}>{item.origin}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "center" }}>{item.size}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "center" }}>Kl. {item.quality}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px" }}>{item.packaging || "—"}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "center" }}>{item.pallets || "—"}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "center" }}>{item.unit || "Kg"}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "right" }}>{parseFloat(item.qty || 0).toLocaleString("pl-PL")}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "right" }}>{(order.pricingMode || "firm") === "consignment" ? "—" : parseFloat(item.unitPrice || 0).toFixed(2)}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "center" }}>{(order.pricingMode || "firm") === "consignment" ? "—" : order.currency}</td>
                <td style={{ border: "1px solid #ccc", padding: "5px 8px", textAlign: "right", fontWeight: 600 }}>{(order.pricingMode || "firm") === "consignment" ? "Konsygnacja / Consignment" : parseFloat(lt).toLocaleString("pl-PL", { minimumFractionDigits: 2 })}</td>
              </tr>
            );
          })}
          <tr style={{ background: "#F3F4F6" }}><td colSpan={9} style={{ border: "1px solid #ccc", padding: "6px 8px", fontWeight: 700, fontSize: 10.5 }}>{(() => { const t = documentTotals(order.items, PO_PACKAGING_TYPES, order.fxRate); return `RAZEM / TOTAL: ${t.kg.toLocaleString("pl-PL")} kg · ${t.boxes.toLocaleString("pl-PL")} opak./boxes · ${t.pallets.toLocaleString("pl-PL")} pal. · ${(order.pricingMode || "firm") === "consignment" ? "konsygnacja / consignment" : t.value.toLocaleString("pl-PL", { minimumFractionDigits: 2 }) + " " + order.currency}`; })()}</td></tr>
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
            <td style={{ border: "1px solid #ccc", padding: "6px 8px", textAlign: "right", fontWeight: 700, fontSize: 12, verticalAlign: "top" }}>{(order.pricingMode || "firm") === "consignment" ? <span style={{ fontSize: 10.5 }}>Konsygnacja — rozliczenie ze sprzedaży / Consignment — settled on sales</span> : <>
              {total.toLocaleString("pl-PL", { minimumFractionDigits: 2 })} {currency}
            </>}</td>
          </tr>
        </tbody>
      </table>

      {/* SIGNATURES — placed before the legal clause; reduced cell padding */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #ccc", padding: "10px 10px 6px", width: "50%", textAlign: "center", color: "#888" }}>
              <div style={{ height: 14 }} />
              <div style={{ borderTop: "1px solid #555", paddingTop: 3, margin: "0 auto", maxWidth: 220 }}>
                <BiLbl en="Supplier signature" pl="Podpis dostawcy" align="center" />
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

      {/* LEGAL ACCEPTANCE CLAUSE — printed at the end of the page, both languages */}
      <div style={{ marginTop: 8, padding: "6px 10px", border: "1px solid #E5E7EB", borderRadius: 4, background: "#FAFAFA" }}>
        <div style={{ fontSize: 7.5, color: "#666", fontStyle: "italic", lineHeight: 1.35, marginBottom: 4 }}>
          In the absence of any written objections from the supplier, the PO shall be considered accepted even if it is not signed, stamped, or returned by the supplier. The supplier remains responsible for the quality of the product until it reaches the final destination, provided that all transport conditions have been properly met.
        </div>
        <div style={{ fontSize: 7.5, color: "#666", fontStyle: "italic", lineHeight: 1.35 }}>
          W przypadku braku jakichkolwiek pisemnych zastrzeżeń ze strony dostawcy, zamówienie (PO) uznaje się za zaakceptowane, nawet jeśli nie zostało podpisane, opieczętowane ani odesłane przez dostawcę. Dostawca ponosi odpowiedzialność za jakość produktu aż do momentu dostarczenia go do miejsca docelowego, pod warunkiem że wszystkie warunki transportu zostały prawidłowo spełnione.
        </div>
      </div>
    </div>
  );
}

// ─── PRINT MODAL ────────────────────────────────────────────────────────────
export function PrintModal({ order, onClose }: any) {
  const { alert: pmAlert, dialogNode: pmNode } = useConfirm(); // P2-6 completion
  // Inject a hidden iframe into the current document, populate it with the
  // A4-styled print HTML, then call print on the iframe's window.
  // This approach is more reliable than window.open + document.write, because
  //   (1) iframes are not blocked by popup blockers,
  //   (2) it works inside sandboxed contexts like StackBlitz preview,
  //   (3) document.write is treated as deprecated in modern Chrome.
  function printDoc() {
    const node = document.getElementById("po-print-doc");
    if (!node) {
      pmAlert({ tone: "warn", title: "Print", message: "Print preview not ready — please try again in a moment." });
      return;
    }

    // Remove any leftover print frame from a previous run
    const existing = document.getElementById("po-print-frame");
    if (existing) existing.remove();

    // Create the hidden iframe
    const iframe = document.createElement("iframe");
    iframe.id = "po-print-frame";
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${order.number}</title>
<style>
  @page { size: A4; margin: 12mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: Calibri, Arial, sans-serif;
    color: #111;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  #po-print-doc { width: 186mm; margin: 0 auto; }
  table { page-break-inside: avoid; border-collapse: collapse; }
  tr { page-break-inside: avoid; page-break-after: auto; }
  img { max-width: 100%; }
</style>
</head>
<body>${node.outerHTML}</body>
</html>`;

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      pmAlert({ tone: "warn", title: "Print", message: "Unable to open the print preview window. Please try again." });
      iframe.remove();
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    // Wait for the embedded base64 logo image to load before triggering print
    const fire = () => {
      // v6.18.8 (#1): the browser's "Save as PDF" uses the top document's title for
      // the default filename, so temporarily set it to the PO number, then restore.
      // v6.34.2: the browser reads the TOP document's title for the Save-as-PDF
      // filename when the user CONFIRMS the save — long after print() returns. Restore
      // on afterprint (real dialog close), not a 1s timeout, so the number sticks.
      const prevTitle = document.title;
      document.title = order.number || prevTitle;
      const restore = () => { document.title = prevTitle; iframe.remove(); };
      try {
        iframe.contentWindow?.focus();
        const w = iframe.contentWindow as any; if (w) w.onafterprint = restore;
        iframe.contentWindow?.print();
      } catch (e) {
        console.error("Print failed:", e);
        pmAlert({ tone: "warn", title: "Print", message: "Printing failed. Try opening the artifact in its own window and printing from there." });
      }
      setTimeout(() => { if (document.title === (order.number || prevTitle)) restore(); }, 60000);
    };

    // The image inside the iframe needs to finish loading first
    const img = doc.querySelector("img");
    if (img && !img.complete) {
      img.addEventListener("load", () => setTimeout(fire, 100));
      img.addEventListener("error", () => setTimeout(fire, 100));
      // Safety fallback: fire after 2s even if events don't trigger
      setTimeout(fire, 2000);
    } else {
      setTimeout(fire, 200);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      {pmNode}
      <div style={{ background: "#fff", borderRadius: 14, width: "min(940px, 96vw)", maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #EBEBEB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Preview · {order.number}</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>A4 format · in the print dialog, set Destination to "Save as PDF"</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={printDoc} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #2563EB", background: "#2563EB", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Print</button>
            <button onClick={onClose} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Close</button>
          </div>
        </div>
        <div style={{ padding: 24, overflowY: "auto", background: "#ECECEC" }}>
          {/* On-screen preview sized to mimic an A4 sheet */}
          <div id="po-print-doc" style={{ background: "#fff", padding: "8mm", boxShadow: "0 2px 12px rgba(0,0,0,0.15)", width: "186mm", margin: "0 auto", boxSizing: "content-box" }}>
            <PODoc order={order} />
          </div>
        </div>
      </div>
    </div>
  );
}
