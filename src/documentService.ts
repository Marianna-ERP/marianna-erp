// ─────────────────────────────────────────────────────────────────────────────
// documentService.ts — shared document rendering (Consolidation Batch 2, R3)
//
// printHtmlNode moved here from Shipments 1:1 (it was the app's only definition
// after earlier consolidation). Every module's print/PDF path adopts this
// service during its screen-rebuild batch; the email helpers join it there too.
// ─────────────────────────────────────────────────────────────────────────────

export function printHtmlNode(nodeId, title) {
  const node = document.getElementById(nodeId);
  if (!node) { alert("Print preview not ready"); return; }
  const existing = document.getElementById(`${nodeId}-frame`);
  if (existing) existing.remove();
  const iframe = document.createElement("iframe");
  iframe.id = `${nodeId}-frame`;
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  @page { size: A4; margin: 10mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: Arial, Calibri, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table { border-collapse: collapse; width: 100%; page-break-inside: avoid; }
  tr { page-break-inside: avoid; }
  img { max-width: 100%; }
</style></head><body>${node.outerHTML}</body></html>`;
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) { iframe.remove(); return; }
  doc.open(); doc.write(html); doc.close();
  const fire = () => {
    const prevTitle = document.title; // v6.18.8 (#1): name the saved PDF after the document
    document.title = title || prevTitle;
    try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch {}
    setTimeout(() => { iframe.remove(); document.title = prevTitle; }, 1000);
  };
  const img = doc.querySelector("img");
  if (img && !img.complete) {
    img.addEventListener("load", () => setTimeout(fire, 100));
    img.addEventListener("error", () => setTimeout(fire, 100));
    setTimeout(fire, 2000);
  } else {
    setTimeout(fire, 200);
  }
}
