// ─── DATA INTEGRITY CHECKER ─────────────────────────────────────────────────
//
// A single pure function that scans the whole dataset for structural problems —
// the kinds of silent corruption that the per-module entry guards don't catch
// because they arise from imports, deletes, edits, legacy data, or cross-module
// drift rather than from a single form submission.
//
// No React, no storage, no mutation. Give it the app state; it returns a
// severity-ranked list of issues. The UI can render a "N data issues" badge and
// a detail panel from the result. Nothing here changes behaviour — it only
// reports — so it is safe to run on every load.
//
// Issue severities:
//   "error"   — will produce wrong money figures or a broken reference NOW.
//   "warning" — risky / likely a mistake, but not certainly wrong.
//   "info"    — worth knowing; benign in isolation.

export type IssueSeverity = "error" | "warning" | "info";

export interface IntegrityIssue {
  severity: IssueSeverity;
  code: string;            // stable machine code, e.g. "ORPHAN_LOT_PO"
  module: string;          // where to go to fix it
  entity: string;          // the record at fault, e.g. "LOT-2026-0091"
  message: string;         // human-readable explanation
}

export interface IntegrityResult {
  issues: IntegrityIssue[];
  counts: { error: number; warning: number; info: number; total: number };
  okay: boolean;           // true when there are no errors (warnings allowed)
}

export interface IntegrityInputs {
  contacts?: any[];
  pos?: any[];
  lots?: any[];
  orders?: any[];
  shipments?: any[];
  warehouseInvoices?: any[];
  operationalCosts?: any[];
  creditNotes?: any[];
}

// ── small helpers (kept local so this module has zero imports) ──
function num(v: any): number { const x = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(x) ? x : 0; }
function r2(x: number): number { return Math.round(x * 100) / 100; }
function norm(s: any): string { return String(s ?? "").trim().toLowerCase(); }
function arr<T = any>(v: any): T[] { return Array.isArray(v) ? v : []; }

const RESERVING_SO_STATUSES = new Set(["Confirmed", "Reserved", "Loading", "Shipped", "Delivered", "Invoiced", "Closed"]);
const SHIPPED_PLUS = new Set(["Shipped", "Delivered", "Invoiced", "Closed"]);

export function checkIntegrity(inp: IntegrityInputs): IntegrityResult {
  const issues: IntegrityIssue[] = [];
  const add = (severity: IssueSeverity, code: string, module: string, entity: string, message: string) =>
    issues.push({ severity, code, module, entity, message });

  const contacts = arr(inp.contacts);
  const pos = arr(inp.pos);
  const lots = arr(inp.lots);
  const orders = arr(inp.orders);
  const shipments = arr(inp.shipments);
  const warehouseInvoices = arr(inp.warehouseInvoices);

  // Lookup sets for fast reference checks.
  const poByNumber = new Map(pos.map((p: any) => [String(p.number), p]));
  const lotByNumber = new Map(lots.map((l: any) => [String(l.number), l]));
  const orderByNumber = new Map(orders.map((o: any) => [String(o.number), o]));
  const contactIds = new Set(contacts.map((c: any) => String(c.id)));
  const contactMergedIds = new Set(
    contacts.flatMap((c: any) => arr(c.mergedFromIds).map(String))
  );

  // ── 1. Orphaned references ────────────────────────────────────────────────
  // Lot pointing at a PO that no longer exists.
  lots.forEach((lot: any) => {
    if (lot?.poRef && !poByNumber.has(String(lot.poRef))) {
      add("error", "ORPHAN_LOT_PO", "Inventory", lot.number || "(unnumbered lot)",
        `Lot references PO ${lot.poRef}, which no longer exists. Its purchase cost and supplier payout cannot resolve.`);
    }
  });

  // SO line pointing at a missing lot or PO line.
  orders.forEach((o: any) => {
    if (o?.status === "Cancelled") return;
    arr(o.items).forEach((it: any) => {
      if (it.sourceType === "STOCK" && it.sourceRef && !lotByNumber.has(String(it.sourceRef))) {
        add("error", "ORPHAN_SO_LOT", "Sales Orders", o.number || "(unnumbered SO)",
          `Line "${it.product || "—"}" sources stock lot ${it.sourceRef}, which no longer exists. COGS cannot be computed.`);
      }
      if (it.sourceType === "PO" && it.sourceRef) {
        const po = poByNumber.get(String(it.sourceRef));
        if (!po) {
          add("error", "ORPHAN_SO_PO", "Sales Orders", o.number || "(unnumbered SO)",
            `Line "${it.product || "—"}" sources PO ${it.sourceRef}, which no longer exists. COGS cannot be computed.`);
        } else {
          const lineId = it.sourceLineId ?? 1;
          const hasLine = arr(po.items).some((l: any) => String(l.id) === String(lineId)) || arr(po.items).length > 0;
          if (!hasLine) {
            add("warning", "ORPHAN_SO_POLINE", "Sales Orders", o.number || "(unnumbered SO)",
              `Line "${it.product || "—"}" references PO ${it.sourceRef} line ${lineId}, which is missing.`);
          }
        }
      }
      if (!it.sourceType || !it.sourceRef) {
        // unsourced lines are only a problem once the SO is committed
        if (o.status && o.status !== "Draft") {
          add("warning", "SO_LINE_UNSOURCED", "Sales Orders", o.number || "(unnumbered SO)",
            `Line "${it.product || "—"}" has no source assigned but the SO is ${o.status}. COGS will be missing.`);
        }
      }
    });
  });

  // Shipment refs pointing at missing POs / SOs / lots.
  shipments.forEach((sh: any) => {
    arr(sh.poRefs).forEach((ref: any) => {
      if (!poByNumber.has(String(ref))) add("warning", "ORPHAN_SHIP_PO", "Shipments", sh.number || "(unnumbered shipment)", `Shipment references PO ${ref}, which no longer exists.`);
    });
    arr(sh.soRefs).forEach((ref: any) => {
      if (!orderByNumber.has(String(ref))) add("warning", "ORPHAN_SHIP_SO", "Shipments", sh.number || "(unnumbered shipment)", `Shipment references SO ${ref}, which no longer exists.`);
    });
    arr(sh.lotRefs).forEach((ref: any) => {
      if (!lotByNumber.has(String(ref))) add("warning", "ORPHAN_SHIP_LOT", "Shipments", sh.number || "(unnumbered shipment)", `Shipment references lot ${ref}, which no longer exists.`);
    });
  });

  // ── 2. Oversold lots (defence in depth behind the SO confirm gate) ─────────
  // Sum reserving-SO demand per lot and compare to availableKg. The SO form
  // blocks this at entry, but imported/edited data can still arrive oversold.
  lots.forEach((lot: any) => {
    const avail = num(lot.availableKg ?? lot.physicalKg ?? lot.receivedKg);
    let reserved = 0;
    const claimers: string[] = [];
    orders.forEach((o: any) => {
      if (!RESERVING_SO_STATUSES.has(o.status)) return;
      arr(o.items).forEach((it: any) => {
        if (it.sourceType === "STOCK" && String(it.sourceRef) === String(lot.number) && norm(it.product) === norm(lot.product)) {
          const q = num(it.qty);
          if (q > 0) { reserved += q; claimers.push(o.number); }
        }
      });
    });
    if (reserved > avail + 0.01 && reserved > 0) {
      add("error", "LOT_OVERSOLD", "Inventory", lot.number || "(unnumbered lot)",
        `Committed ${r2(reserved).toLocaleString("pl-PL")} kg exceeds available ${r2(avail).toLocaleString("pl-PL")} kg (claimed by ${[...new Set(claimers)].join(", ")}).`);
    }
  });

  // ── 3. SO marked shipped+ but no traceable SHIP_OUT for it ─────────────────
  // The margin engine attributes COGS by matching the SO number inside SHIP_OUT
  // movement notes. If a committed SO has no such movement, COGS is understated.
  orders.forEach((o: any) => {
    if (!SHIPPED_PLUS.has(o.status)) return;
    const soNo = String(o.number);
    let shippedKg = 0;
    lots.forEach((lot: any) => {
      arr(lot.movements).forEach((m: any) => {
        const matches = m.soRef ? String(m.soRef) === soNo : String(m.note || "").includes(soNo);
        if (m.type === "SHIP_OUT" && matches) shippedKg += num(m.qtyKg);
        if (m.type === "REVERSAL" && matches) shippedKg -= num(m.qtyKg);
      });
    });
    const demand = arr(o.items).reduce((s: number, it: any) => s + num(it.qty), 0);
    if (shippedKg <= 0 && demand > 0) {
      add("warning", "SO_SHIPPED_NO_MOVEMENT", "Sales Orders", soNo,
        `SO is ${o.status} but no SHIP_OUT movement is traceable to it. Its COGS will read as zero.`);
    }
  });

  // ── 4. SHIP_OUT note ambiguity (substring collision) ───────────────────────
  // If one SO number is a substring of another, note-based matching is unsafe.
  const soNumbers = orders.map((o: any) => String(o.number)).filter(Boolean);
  soNumbers.forEach((a: string) => {
    soNumbers.forEach((b: string) => {
      if (a !== b && b.includes(a)) {
        add("info", "SO_NUMBER_SUBSTRING", "Sales Orders", a,
          `SO number "${a}" is contained inside "${b}". Note-based ship-out matching could confuse the two; a structured soRef on movements avoids this.`);
      }
    });
  });

  // ── 5. Consignment settlement double-write ─────────────────────────────────
  // The settlement writes two cost lines keyed CONSIGN-<id> / CONSIGNC-<id>.
  // More than one of either means a re-close didn't replace cleanly → double count.
  lots.forEach((lot: any) => {
    const costs = arr(lot.costs);
    const purch = costs.filter((c: any) => String(c.source || "") === `CONSIGN-${lot.id}`);
    const comm = costs.filter((c: any) => String(c.source || "") === `CONSIGNC-${lot.id}`);
    if (purch.length > 1) add("error", "CONSIGN_DOUBLE_PURCHASE", "Inventory", lot.number || "(unnumbered lot)", `${purch.length} consignment purchase components on one lot — settlement double-counted.`);
    if (comm.length > 1) add("error", "CONSIGN_DOUBLE_COMMISSION", "Inventory", lot.number || "(unnumbered lot)", `${comm.length} commission credit components on one lot — settlement double-counted.`);
  });

  // ── 6. Allocations referencing a missing warehouse invoice ─────────────────
  // Cost lines tagged with a warehouse-invoice ref whose invoice no longer exists.
  // Finance tags allocated warehouse cost lines with source `WHINV-<id>` (hyphen).
  const whInvoiceIds = new Set(warehouseInvoices.map((w: any) => `WHINV-${w.id}`));
  lots.forEach((lot: any) => {
    arr(lot.costs).forEach((c: any) => {
      const src = String(c.source || "");
      if (src.startsWith("WHINV-") && !whInvoiceIds.has(src)) {
        add("warning", "ALLOC_MISSING_INVOICE", "Inventory", lot.number || "(unnumbered lot)",
          `A cost line is tagged to ${src}, but that warehouse invoice no longer exists. The allocation is stale.`);
      }
    });
  });

  // ── 7. Counterparty snapshots whose id no longer resolves ──────────────────
  const checkSnapshot = (snap: any, module: string, entity: string, role: string) => {
    if (!snap || snap.id === undefined || snap.id === null) return;
    const id = String(snap.id);
    if (!contactIds.has(id) && !contactMergedIds.has(id)) {
      add("warning", "SNAPSHOT_UNRESOLVED", module, entity,
        `${role} "${snap.name || id}" no longer matches a counterparty by id (only by name, which is unreliable). Re-select it to re-link.`);
    }
  };
  pos.forEach((p: any) => checkSnapshot(p.supplier, "Purchase Orders", p.number || "(unnumbered PO)", "Supplier"));
  orders.forEach((o: any) => checkSnapshot(o.client, "Sales Orders", o.number || "(unnumbered SO)", "Client"));

  // ── 8. Duplicate primary keys (numbers / ids) ──────────────────────────────
  const dupScan = (list: any[], key: string, module: string, label: string) => {
    const seen = new Map<string, number>();
    list.forEach((x: any) => { const k = String(x?.[key] ?? ""); if (!k) return; seen.set(k, (seen.get(k) || 0) + 1); });
    seen.forEach((count, k) => { if (count > 1) add("error", "DUPLICATE_KEY", module, k, `${count} ${label} share the ${key} "${k}". References to it are ambiguous.`); });
  };
  dupScan(pos, "number", "Purchase Orders", "POs");
  dupScan(lots, "number", "Inventory", "lots");
  dupScan(orders, "number", "Sales Orders", "SOs");
  dupScan(shipments, "number", "Shipments", "shipments");

  const counts = {
    error: issues.filter(i => i.severity === "error").length,
    warning: issues.filter(i => i.severity === "warning").length,
    info: issues.filter(i => i.severity === "info").length,
    total: issues.length,
  };

  // Stable sort: errors first, then warnings, then info; preserve discovery order within.
  const rank = { error: 0, warning: 1, info: 2 } as const;
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return { issues, counts, okay: counts.error === 0 };
}
