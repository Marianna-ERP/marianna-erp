import { claimNoteMismatches } from "./claimReadiness.domain";
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
  invoices?: any[];
  financeNotes?: any[];
  /** v6.63.0 (D-13/audit gaps): claims and load plans join the audit. */
  claims?: any[];
  loadPlans?: any[];
  /** v6.79.0: previously unaudited stores */
  advancePayments?: any[];
  bankAccounts?: any[];
  productCatalog?: any[];
}

// ── small helpers (kept local so this module has zero imports) ──
function num(v: any): number { const x = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(x) ? x : 0; }
function r2(x: number): number { return Math.round(x * 100) / 100; }
function norm(s: any): string { return String(s ?? "").trim().toLowerCase(); }
function arr<T = any>(v: any): T[] { return Array.isArray(v) ? v : []; }

// v6.30.1: aligned with SO_PRE_DISPATCH_STATUSES (types.ts / Batch 1 decision).
// Shipped+ orders already had their kg physically subtracted via SHIP_OUT, so
// counting them as reserving here double-subtracted and raised false LOT_OVERSOLD
// errors on every correctly shipped lot. Kept as a local copy (this module has
// zero imports by design) — if the canonical set changes, change both.
const RESERVING_SO_STATUSES = new Set(["Confirmed", "Reserved", "Loading"]);
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
          // v6.30.1: the old `|| po.items.length > 0` made this check dead — any PO
          // with at least one line passed, so a missing line id was never flagged.
          // Strict when the SO line names an explicit sourceLineId; a legacy line
          // (sourceLineId null → defaulted) only requires the PO to have lines,
          // because legacy PO line ids are timestamps and "1" would never match.
          const hasLine = it.sourceLineId != null
            ? arr(po.items).some((l: any) => String(l.id) === String(it.sourceLineId))
            : arr(po.items).length > 0;
          const lineId = it.sourceLineId ?? 1;
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

  // Shipment refs pointing at missing lots. (PO/SO refs are checked ONCE, in
  // 7a.4 below, as errors — v6.31.0 removed the duplicate warnings this section
  // used to emit for the same condition, which double-counted the badge.)
  shipments.forEach((sh: any) => {
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

  // ── 9. Invoices & finance notes (v6.18.6, P0-7) ────────────────────────────
  const invoices = arr(inp.invoices);
  const financeNotes = arr(inp.financeNotes);

  // ── v6.63.0: the six blind stores get eyes (audit gap closure) ──────────────
  const claims = arr(inp.claims);
  const loadPlans = arr(inp.loadPlans);
  const docNumberSets = {
    LOT: new Set(lots.map((x: any) => String(x.number))),
    SO: new Set(orders.map((x: any) => String(x.number))),
    PO: new Set(pos.map((x: any) => String(x.number))),
    SHIPMENT: new Set(shipments.map((x: any) => String(x.number))),
    INVOICE: new Set(invoices.map((x: any) => String(x.number))),
  } as Record<string, Set<string>>;
  const knownContactIds = new Set(contacts.map((c: any) => String(c.id)));

  claims.forEach((c: any) => {
    const label = c.number || "(unnumbered claim)";
    (c.subjects || []).forEach((s: any) => {
      if (s?.kind === "LEG") return; // legs live inside shipments; the shipment ref is the anchor
      const set = docNumberSets[String(s?.kind)];
      if (set && s?.ref && !set.has(String(s.ref)))
        add("warning", "CLAIM_ORPHAN_SUBJECT", "Claims", label, `Subject ${s.kind} ${s.ref} no longer exists — the claim points at a ghost document.`);
    });
    const cid = c?.respondent?.contactId;
    if (cid !== null && cid !== undefined && cid !== "" && !knownContactIds.has(String(cid)))
      add("warning", "CLAIM_ORPHAN_CONTACT", "Claims", label, `Respondent contact (id ${cid}) no longer exists.`);
    if (c?.financeNoteId && !financeNotes.some((nt: any) => String(nt.id) === String(c.financeNoteId)))
      add("warning", "CLAIM_ORPHAN_NOTE", "Claims", label, `The credit/debit note this claim produced (id ${c.financeNoteId}) no longer exists.`);
    if (c?.parentClaimId && !claims.some((p: any) => String(p.id) === String(c.parentClaimId)))
      add("warning", "CLAIM_ORPHAN_PARENT", "Claims", label, `The client claim that triggered this recovery (id ${c.parentClaimId}) no longer exists.`);
  });

  loadPlans.forEach((lp: any) => {
    const label = lp.number || lp.name || "(unnamed plan)";
    const refs = new Set([...(lp.shipmentRefs || []), ...((lp.map || []).map((m: any) => m.shipmentRef))].filter(Boolean).map(String));
    refs.forEach(ref => {
      if (!docNumberSets.SHIPMENT.has(ref))
        add("warning", "LOADPLAN_ORPHAN_SHIPMENT", "Load plans", label, `Plan references shipment ${ref}, which no longer exists — its totals silently exclude that cargo.`);
    });
  });

  // ── v6.79.0 (review): the stores that had NO checks ────────────────────────
  const advances = arr((inp as any).advancePayments);
  const bankAccounts = arr((inp as any).bankAccounts);
  const opCosts = arr((inp as any).operationalCosts);
  const catalog = arr((inp as any).productCatalog);
  const invById79 = new Map(invoices.map((i: any) => [String(i.id), i]));

  advances.forEach((a: any) => {
    const label = `${a.counterpartyName || "advance"} ${a.date || ""} ${a.amount} ${a.currency || ""}`.trim();
    const allocated = (a.allocations || []).reduce((s: number, x: any) => s + (Number(x.amount) || 0), 0);
    if (allocated - (Number(a.amount) || 0) > 0.01)
      add("error", "ADVANCE_OVERALLOCATED", "Finance", label, `Allocated ${allocated.toLocaleString("pl-PL")} against an advance of ${Number(a.amount).toLocaleString("pl-PL")} — money applied that was never received.`);
    if (a.proformaId != null && a.proformaId !== "" && !invById79.has(String(a.proformaId)))
      add("warning", "ADVANCE_ORPHAN_PROFORMA", "Finance", label, `The pro-forma this advance answers (id ${a.proformaId}) no longer exists.`);
    (a.allocations || []).forEach((x: any) => {
      if (!invById79.has(String(x.invoiceId)))
        add("warning", "ADVANCE_ALLOC_ORPHAN", "Finance", label, `An allocation of ${Number(x.amount).toLocaleString("pl-PL")} points at invoice ${x.invoiceNumber || x.invoiceId}, which no longer exists.`);
    });
    if (!(a.proformaId != null && a.proformaId !== ""))
      add("info", "ADVANCE_NO_PROFORMA", "Finance", label, "Advance not linked to its pro-forma (owner ruling: every advance answers one).");
  });

  const seenAcct = new Set<string>();
  bankAccounts.forEach((b: any) => {
    const k = String(b.accountDigits || "");
    if (k && seenAcct.has(k)) add("warning", "BANKACCOUNT_DUP", "Finance", b.label || k, `Bank account …${k.slice(-4)} is registered twice.`);
    seenAcct.add(k);
  });

  opCosts.forEach((c: any) => {
    const s = String(c.source || "");
    if (!s.startsWith("invoice:")) return;
    const inv = invById79.get(s.slice(8));
    if (!inv) add("warning", "OPCOST_MIRROR_ORPHAN", "Finance", c.invoiceNo || c.description || "cost", "This overhead line mirrors a register invoice that no longer exists — the sync should have removed it.");
    else if (inv.paymentStatus === "Cancelled") add("warning", "OPCOST_MIRROR_CANCELLED", "Finance", c.invoiceNo || "cost", "This overhead line mirrors a CANCELLED invoice — it should not count in overhead.");
  });

  if (catalog.length) {
    const items = new Set(catalog.map((c: any) => String(c.item || "").trim().toLowerCase()));
    const used = new Map<string, Set<string>>();
    const mark = (name: any, doc: string) => { const k = String(name || "").trim().toLowerCase(); if (!k || items.has(k)) return; (used.get(k) || used.set(k, new Set()).get(k)!).add(doc); };
    pos.forEach((p: any) => p.status !== "Cancelled" && (p.items || []).forEach((it: any) => mark(it.product, p.number)));
    orders.forEach((o: any) => o.status !== "Cancelled" && (o.items || []).forEach((it: any) => mark(it.product, o.number)));
    used.forEach((docs, name) => add("info", "CATALOG_ITEM_UNKNOWN", "Settings", name, `"${name}" is used on ${docs.size} live document(s) but is not in the product catalog (renamed or removed).`));
  }

  // v6.79.0: claim money vs paper — an agreed amount moves the P/L; the note is the legal document.
  claimNoteMismatches(claims, (id: any) => financeNotes.find((nt: any) => String(nt.id) === String(id)))
    .forEach(x => add("warning", "CLAIM_NOTE_MISMATCH", "Claims", x.number, x.recon.message));

  // Goods ROWS were never audited (only header refs) — yet posting reads the rows.
  shipments.forEach((sh: any) => {
    if (sh.status === "Cancelled") return;
    const label = sh.number || "(unnumbered shipment)";
    (sh.goods || []).forEach((g: any) => {
      if (g?.lotRef && !docNumberSets.LOT.has(String(g.lotRef)))
        add("warning", "SHIP_ROW_ORPHAN", "Shipments", label, `A goods row points at lot ${g.lotRef}, which doesn't exist — delivery would post nothing for it.`);
      if (g?.soRef && !docNumberSets.SO.has(String(g.soRef)))
        add("warning", "SHIP_ROW_ORPHAN", "Shipments", label, `A goods row points at sales order ${g.soRef}, which doesn't exist.`);
      if (g?.poRef && !docNumberSets.PO.has(String(g.poRef)))
        add("warning", "SHIP_ROW_ORPHAN", "Shipments", label, `A goods row points at purchase order ${g.poRef}, which doesn't exist.`);
    });
  });
  const shipByNumber = new Set(shipments.map((s: any) => String(s.number)));
  const invoiceById = new Map(invoices.map((i: any) => [String(i.id), i]));

  // Invoice links pointing at records that no longer exist.
  invoices.forEach((inv: any) => {
    if (inv?.paymentStatus === "Cancelled") return;
    const label = inv.number || `invoice #${inv.id}`;
    arr(inv.links).forEach((lk: any) => {
      const num2 = String(lk?.number || "");
      if (!num2) return;
      const missing =
        (lk.type === "SO" && !orderByNumber.has(num2)) ||
        (lk.type === "PO" && !poByNumber.has(num2)) ||
        (lk.type === "Lot" && !lotByNumber.has(num2)) ||
        (lk.type === "Shipment" && !shipByNumber.has(num2));
      if (missing) add("warning", "INVOICE_ORPHAN_LINK", "Invoices", label,
        `Invoice links to ${lk.type} ${num2}, which no longer exists.`);
    });
    // A recorded payment larger than the invoice total.
    if (num(inv.paidAmount) > num(inv.grossPLN || inv.netPLN) + 0.01 && num(inv.grossPLN || inv.netPLN) > 0) {
      add("warning", "INVOICE_OVERPAID", "Invoices", label,
        `Recorded payments (${r2(num(inv.paidAmount))}) exceed the invoice total (${r2(num(inv.grossPLN || inv.netPLN))}).`);
    }
  });

  // Duplicate invoice numbers within the same direction (sales vs cost).
  const invKeySeen = new Map<string, number>();
  invoices.forEach((inv: any) => {
    const num2 = norm(inv.number);
    if (!num2 || inv.paymentStatus === "Cancelled") return;
    const k = `${inv.kind || "?"}|${num2}`;
    invKeySeen.set(k, (invKeySeen.get(k) || 0) + 1);
  });
  invKeySeen.forEach((count, k) => {
    if (count > 1) add("warning", "DUPLICATE_INVOICE_NO", "Invoices", k.split("|")[1],
      `${count} ${k.split("|")[0] === "SALES" ? "sales" : "cost"} invoices share the number "${k.split("|")[1]}".`);
  });

  // Finance note (credit/debit) pointing at a missing invoice.
  financeNotes.forEach((note: any) => {
    if (note?.invoiceId == null) return;
    if (!invoiceById.has(String(note.invoiceId))) {
      add("warning", "NOTE_ORPHAN_INVOICE", "Invoices", note.number || `${note.noteType || "note"} #${note.id}`,
        `${note.noteType || "Credit/debit"} note references invoice #${note.invoiceId}, which no longer exists.`);
    }
  });

  // ── 10. Shipment ↔ inventory consistency (v6.18.7, P1-6) ───────────────────
  // A delivered shipment whose lots show no recorded movement — stock probably
  // wasn't received/shipped (the "apply inventory" step was missed).
  shipments.forEach((sh: any) => {
    if (sh?.status !== "Delivered") return;
    // v6.62.0: judge only the lots this shipment ACTUALLY CARRIES. Header
    // lotRefs are seeded from the source document at creation, so a shipment
    // carrying one lot could list three — and the two it never touched, still
    // Expected with no movements, raised this warning against a shipment that
    // had done nothing wrong. Same root cause already fixed for the shipment
    // header display (carriedRefs, v6.58.0) and for Inventory (shipmentsForLot,
    // v6.59.0); this check was missed then.
    const carried = arr(sh.goods).map((g: any) => g.lotRef).filter(Boolean).map(String);
    const lotRefs = new Set(carried.length ? carried : arr(sh.lotRefs).filter(Boolean).map(String));
    if (!lotRefs.size) return;
    const anyMissing = [...lotRefs].some((lr) => {
      const lot = lotByNumber.get(lr);
      if (!lot) return false; // missing lot is reported separately
      return !arr(lot.movements).some((m: any) => String(m.shipmentRef) === String(sh.number));
    });
    if (anyMissing) add("warning", "SHIPMENT_NO_MOVEMENT", "Shipments", sh.number || "(unnumbered shipment)",
      `Shipment is Delivered but at least one of its lots has no inventory movement — stock may not have been received or shipped out. Open it and apply the inventory movement.`);
  });

  // A delivered/arrived shipment carrying logistics costs that were never allocated
  // to inventory lot costing — those costs are missing from COGS.
  shipments.forEach((sh: any) => {
    if (sh?.status === "Cancelled") return; // v6.66.0 (D-28)
    if (!["Delivered", "Arrived"].includes(sh?.status)) return;
    const hasCost = arr(sh.costs).some((c: any) => num(c.amountPLN) > 0);
    if (hasCost && sh.billingStatus !== "Cost allocated") {
      add("info", "SHIPMENT_COST_UNALLOCATED", "Shipments", sh.number || "(unnumbered shipment)",
        `Shipment has logistics costs not yet allocated to inventory (billing status: ${sh.billingStatus || "—"}). They won't appear in lot COGS until allocated.`);
    }
  });


  // ── Safeguards batch 7a ──────────────────────────────────────────────────
  // 7a.1 Duplicate invoice per counterparty + number (BP-40 completion): the
  // same legal number from the same party twice = double-counted money.
  {
    const seen = new Map<string, string>();
    invoices.forEach((v: any) => {
      if (v?.paymentStatus === "Cancelled") return; // v6.66.0 (D-28): a cancelled invoice frees its number
      const num = String(v.number || "").trim();
      if (!num) return; // drafts without official numbers are fine
      const key = `${String(v.counterparty?.name || "").trim().toLowerCase()}::${num.toLowerCase()}`;
      if (seen.has(key)) add("error", "DUP_INVOICE", "Invoices", num,
        `Duplicate invoice "${num}" for ${v.counterparty?.name || "(party)"} — the same legal number is registered twice (double-counted money).`);
      else seen.set(key, num);
    });
  }
  // 7a.2 Derived paidAmount vs payment events out of sync (Batch 5b invariant).
  invoices.forEach((v: any) => {
    if (!Array.isArray(v.payments) || !v.payments.length) return;
    const sum = Math.round(v.payments.reduce((s: number, p: any) => s + (parseFloat(p.amount) || 0), 0) * 100) / 100;
    const cached = Math.round((parseFloat(v.paidAmount) || 0) * 100) / 100;
    if (Math.abs(sum - cached) > 0.01) add("warning", "PAY_MISMATCH", "Invoices", v.number || "(draft)",
      `Paid amount ${cached} differs from the sum of payment events ${sum} — recalculated on next payment edit, but worth a look.`);
  });
  // 7a.3 Over-issued lots: shipping/damaging more than existed was silently
  // clamped before; the reducer now reports the excess.
  lots.forEach((l: any) => {
    const over = parseFloat(l.overIssuedKg) || 0;
    if (over > 0) add("error", "LOT_OVER_ISSUE", "Inventory", l.number || "(lot)",
      `${over} kg more was shipped/damaged out of this lot than it ever contained — a quantity was mistyped somewhere (the stock was clamped at 0, but the movements don't add up).`);
  });
  // 7a.4 Shipments pointing at documents that don't exist.
  {
    const poNums = new Set(pos.map((p: any) => p.number));
    const soNums = new Set(orders.map((o: any) => o.number));
    shipments.forEach((s: any) => {
      (Array.isArray(s.poRefs) ? s.poRefs : []).forEach((r: string) => {
        if (r && !poNums.has(r)) add("error", "SHIP_PO_MISSING", "Shipments", s.number || "(shipment)",
          `References PO ${r}, which no longer exists.`);
      });
      (Array.isArray(s.soRefs) ? s.soRefs : []).forEach((r: string) => {
        if (r && !soNums.has(r)) add("error", "SHIP_SO_MISSING", "Shipments", s.number || "(shipment)",
          `References SO ${r}, which no longer exists.`);
      });
    });
  }

  // ── v6.31.0: close-out completeness, receipt-loss tripwire, FX sanity ──────

  // 11.1 SO CLOSE-OUT COMPLETENESS. The business reads an SO's P/L once, at
  // close — so a Closed SO with provisional cost data means the one number that
  // matters was read incomplete. Aggregates the reasons into a single warning.
  {
    const shipmentsForSO = (soNumber: string) =>
      shipments.filter((s: any) => s && s.status !== "Cancelled" && (
        arr(s.soRefs).map(String).includes(String(soNumber)) ||
        arr(s.goods).some((g: any) => String(g?.soRef || "") === String(soNumber))));
    orders.forEach((o: any) => {
      if (o?.status !== "Closed") return;
      const reasons: string[] = [];
      const linked = shipmentsForSO(o.number);
      const expectedCosts = linked.flatMap((s: any) => arr(s.costs).filter((c: any) => (c.invoiceStatus || "Expected") === "Expected"));
      if (expectedCosts.length) reasons.push(`${expectedCosts.length} shipment cost line(s) still "Expected" (no invoice received)`);
      // Sourced lots with no cost data → COGS reads zero for those kg.
      arr(o.items).forEach((it: any) => {
        if (it.sourceType === "STOCK" && it.sourceRef) {
          const lot = lotByNumber.get(String(it.sourceRef));
          if (lot && !arr(lot.costs).length) reasons.push(`lot ${it.sourceRef} has no cost data`);
        }
      });
      // No traceable SHIP_OUT at all → actual COGS is zero (mirrors check 3,
      // which only covers Shipped+; Closed is where it is fatal for the number).
      let shipped = 0;
      lots.forEach((lot: any) => arr(lot.movements).forEach((m: any) => {
        if (m.voided) return;
        const matches = m.soRef ? String(m.soRef) === String(o.number) : String(m.note || "").includes(String(o.number));
        if (m.type === "SHIP_OUT" && matches) shipped += num(m.qtyKg);
      }));
      const demand = arr(o.items).reduce((s: number, it: any) => s + num(it.qty), 0);
      if (shipped <= 0 && demand > 0) reasons.push("no SHIP_OUT movement traceable to this SO — actual COGS reads zero");
      if (reasons.length) add("warning", "SO_CLOSED_PL_INCOMPLETE", "Sales Orders", o.number || "(unnumbered SO)",
        `SO is Closed but its final P/L is incomplete: ${reasons.slice(0, 3).join("; ")}${reasons.length > 3 ? ` (+${reasons.length - 3} more)` : ""}. The close-out figure is understated or provisional.`);
    });
  }

  // 11.2 RECEIPT-LOSS TRIPWIRE (T-20). "Lot reset to Expected/0 kg although the
  // shipment shows arrived" is under investigation awaiting a repro — these two
  // read-only checks catch the aftermath the moment it happens on real data.
  lots.forEach((l: any) => {
    const inMoves = arr(l.movements).filter((m: any) => m?.type === "IN" && !m.voided);
    const receivedKg = num(l.receivedKg);
    if (inMoves.length && (l.status === "Expected" || (receivedKg === 0 && num(l.physicalKg) === 0 && !arr(l.movements).some((m: any) => m?.type === "SHIP_OUT" && !m.voided)))) {
      add("error", "LOT_RECEIPT_INCONSISTENT", "Inventory", l.number || "(lot)",
        `Lot has ${inMoves.length} IN movement(s) but reads ${l.status || "Expected"} / ${receivedKg} kg received — its receipt state was reset while the history survived. (T-20 tripwire: note what was done just before this appeared.)`);
    }
    if (receivedKg > 0 && arr(l.movements).length > 0 && !inMoves.length) {
      add("warning", "LOT_RECEIPT_NO_MOVEMENT", "Inventory", l.number || "(lot)",
        `Lot shows ${receivedKg} kg received but no (non-voided) IN movement — state and history have drifted; a recompute would zero it.`);
    }
  });

  // 11.3 FX SANITY (tier-2 item, pulled forward — found live in real data: an EUR
  // SO with fxRate 1 understates PLN revenue ~4×). A non-PLN document whose
  // locked rate is missing or ≈1 almost certainly never had its rate set.
  {
    const fxSuspect = (cur: any, fx: any) => {
      const c = String(cur || "PLN").toUpperCase();
      if (c === "PLN") return false;
      const r = num(fx);
      return r <= 1.05; // 0/blank parses to 0; EUR/USD ≈ 4 — anything ≤1.05 is unset
    };
    orders.forEach((o: any) => {
      if (o?.status === "Cancelled" || o?.status === "Draft") return;
      if (fxSuspect(o.currency, o.fxRate)) add("warning", "FX_RATE_SUSPECT", "Sales Orders", o.number || "(SO)",
        `SO is in ${String(o.currency).toUpperCase()} with fxRate ${num(o.fxRate) || "blank"} — PLN revenue and margin are understated until the locked rate is set.`);
    });
    pos.forEach((p: any) => {
      if (p?.status === "Cancelled" || p?.status === "Draft") return;
      if (fxSuspect(p.currency, p.fxRate)) add("warning", "FX_RATE_SUSPECT", "Purchase Orders", p.number || "(PO)",
        `PO is in ${String(p.currency).toUpperCase()} with fxRate ${num(p.fxRate) || "blank"} — PLN cost is understated until the locked rate is set.`);
    });
    arr(inp.invoices).forEach((v: any) => {
      if (!v || v.paymentStatus === "Cancelled") return;
      if (fxSuspect(v.currency, v.fxRate)) add("warning", "FX_RATE_SUSPECT", "Invoices", v.number || `invoice #${v.id}`,
        `Invoice is in ${String(v.currency).toUpperCase()} with fxRate ${num(v.fxRate) || "blank"} — its PLN amounts are understated.`);
    });
  }

  // ── v6.32.0: operational-testing safeguards ─────────────────────────────

  // 12.1 DUPLICATE LIVE SHIPMENT. Two non-cancelled shipments for the same SO
  // with identical goods kg and identical cost totals — the re-booked-truck
  // pattern where the superseded booking was never cancelled, silently doubling
  // freight in the SO's P/L. (Found live: SHP-2026-0005 / 0006.)
  {
    const live = shipments.filter((s: any) => s && s.status !== "Cancelled");
    // v6.73.0: the LOTS CARRIED are part of the identity. Matching only on
    // sales order + kilos + cost total flagged five trucks of equal size against
    // one order as duplicates of each other — which is precisely the owner's
    // normal flow (five trucks collect from producers and feed four containers,
    // all against one sale). Two shipments carrying DIFFERENT lots are two
    // trucks, however alike their totals look.
    const key = (s: any) => {
      const sos = arr(s.soRefs).filter(Boolean).map(String).sort().join("+");
      const kg = arr(s.goods).reduce((t: number, g: any) => t + num(g?.qtyKg), 0);
      const cost = arr(s.costs).reduce((t: number, c: any) => t + (num(c?.amountPLN) || num(c?.amount) * (num(c?.fxRate) || 1)), 0);
      const lots = Array.from(new Set(arr(s.goods).map((g: any) => String(g?.lotRef || "")).filter(Boolean))).sort().join("+");
      return sos ? `${sos}|${Math.round(kg)}|${Math.round(cost)}|${lots}` : null;
    };
    const seen = new Map<string, string>();
    live.forEach((s: any) => {
      const k = key(s);
      if (!k) return;
      if (seen.has(k)) {
        add("warning", "DUP_LIVE_SHIPMENT", "Shipments", s.number || "(shipment)",
          `Looks like a duplicate of ${seen.get(k)} — same SO link, same goods kg, same cost total, both live. If one superseded the other, cancel the old booking; otherwise the SO carries the freight twice.`);
      } else seen.set(k, s.number || "(shipment)");
    });
  }

  // 12.2 STALE BILLING FLAG. billingStatus says "Cost allocated" but no lot
  // carries this shipment's allocation tags (Batch-1b replace-by-source) — the
  // allocation never ran or was reverted; the flag misleads the tester.
  shipments.forEach((sh: any) => {
    if (!sh || sh.status === "Cancelled") return; // v6.66.0 (D-28): a cancelled shipment's flags are history, not alerts
    if (sh.billingStatus !== "Cost allocated") return;
    if (!arr(sh.costs).length) return;
    // v6.62.0: an OUTBOUND delivery never builds landed cost (v6.51.0), so
    // "no lot carries the allocation" is the correct outcome, not a stale flag.
    // Such shipments now carry "Direct cost of sale" instead — but any left on
    // the old flag must not be reported as broken.
    if (String(sh.purpose || "").toUpperCase() === "OUTBOUND") return;
    const tagged = lots.some((l: any) => arr(l.costs).some((c: any) => String(c?.source || "").startsWith(`${sh.number}/`)));
    if (!tagged) add("warning", "STALE_BILLING_FLAG", "Shipments", sh.number || "(shipment)",
      `billingStatus is "Cost allocated" but no lot carries this shipment's cost allocation — the flag is stale (allocation never ran, was reverted, or the shipment was cancelled). Re-run the allocation or reset the status.`);
  });

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
