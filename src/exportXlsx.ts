// ── v6.99.0: EXCEL EXPORT — every list exports what you see (rows as filtered, columns as shown) ──
import * as XLSX from "xlsx";
export interface XlsxColumn { key: string; label: string; fmt?: (v: any, row: any) => any; }
export function exportRowsToXlsx(filename: string, rows: any[], columns: XlsxColumn[], sheetName = "Export"): void {
  const data = (rows || []).map(r => { const o: any = {}; columns.forEach(c => { const v = c.fmt ? c.fmt(r[c.key], r) : r[c.key]; o[c.label] = v === undefined || v === null ? "" : v; }); return o; });
  const ws = XLSX.utils.json_to_sheet(data, { header: columns.map(c => c.label) });
  ws["!cols"] = columns.map(c => ({ wch: Math.min(48, Math.max(10, c.label.length + 2, ...data.slice(0, 200).map(d => String(d[c.label] ?? "").length + 1))) }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}
export const stamp = () => new Date().toISOString().slice(0, 10);

/** v6.99.3: the Vega Pro SALES REPORT in exactly their sheet layout (owner-supplied template). */
export function exportVegaProSalesReport(meta: { completionDate: string; shipmentRef: string; poNumber: string }, rows: Array<{ item: string; soldKg: number; unitEUR: number; amountEUR: number }>, commission: { pct: number; eur: number }, filename?: string): void {
  const aoa: any[][] = [
    ["Marianna — AUTHENTIC TASTE OF QUALITY", "", "", "SALES REPORT"], [],
    ["Completion date:", meta.completionDate], ["Shipment reference number:", meta.shipmentRef], ["Purchase order:", meta.poNumber], [],
    ["Item", "Sold quantity kg (net)", "item unit price (EUR / kg)", "Amount (EUR)"],
    ...rows.map(r => [r.item, r.soldKg, r.unitEUR || "", r.amountEUR || ""]),
    ["Total:", rows.reduce((s, r) => s + (r.soldKg || 0), 0), "", Math.round(rows.reduce((s, r) => s + (r.amountEUR || 0), 0) * 100) / 100],
    [`Commission ${commission.pct}%`, "", "", -Math.round(commission.eur * 100) / 100],
    ["Payable amount:", "", "", Math.round((rows.reduce((s, r) => s + (r.amountEUR || 0), 0) - commission.eur) * 100) / 100],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!cols"] = [{ wch: 34 }, { wch: 22 }, { wch: 26 }, { wch: 16 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Sales report");
  XLSX.writeFile(wb, (filename || `sales_report_${meta.shipmentRef || meta.poNumber}_${stamp()}`) + ".xlsx");
}
