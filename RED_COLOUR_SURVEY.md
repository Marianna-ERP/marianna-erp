# Red colour survey — v6.99.107 (A-CLR-1, owner ruling 2 Oct)

Rule: red = an error or a hazard (something wrong, blocked, dangerous — missing data, blockers, overdue money, old perishables, delete). A plain timing hint uses amber.

Red uses found: 211 (plus the one changed). Changed in this release: 1 — PurchaseOrders.tsx, the list's date column when an active PO's loading date has passed (a timing hint) → amber. Of the rest, 92 sit next to a fault word (missing, blocked, overdue, damaged, delete…) and are kept; 119 have no such word on their line and are marked for a second look — they are mostly delete buttons, status badges and emphasis in forms, but each should be glanced at before the rule is called complete.

| File | Line | Decision | Context |
|---|---:|---|---|
| App.tsx | 612 | kept — error / hazard | {leaveAsk.refused && The save did not go through — the form is still open with your changes. Fix what it asked |
| App.tsx | 616 | kept — emphasis / delete / badge | { const t = leaveAsk.target; setLeaveAsk(null); setActiveModule(t); }} style={{ padding: "6px 14px", borderRad |
| App.tsx | 641 | kept — emphasis / delete / badge |  |
| App.tsx | 643 | kept — emphasis / delete / badge |  |
| AuditTrail.tsx | 21 | kept — error / hazard | a === "cancelled" ? "#DC2626" : a === "created" ? "#16A34A" : a === "status" ? "#0369A1" |
| BackupPanel.tsx | 27 | kept — error / hazard | : st.mode === "failed" ? { text: "Last write failed", color: "#DC2626" } |
| BackupPanel.tsx | 50 | kept — error / hazard | {st.mode === "failed" && st.lastError && {st.lastError} } |
| BackupPanel.tsx | 58 | kept — emphasis / delete / badge | {message && {message.text} } |
| BackupPanel.tsx | 90 | kept — emphasis / delete / badge |  |
| Claims.tsx | 48 | kept — error / hazard | Accepted: "#16A34A", "Partially accepted": "#16A34A", Rejected: "#DC2626", Settled: "#059669", Closed: "#64748 |
| Claims.tsx | 49 | kept — error / hazard | Withdrawn: "#DC2626", Cancelled: "#DC2626", // v6.83.0 (owner ruling): cancelled/withdrawn = red everywhere |
| Claims.tsx | 291 | kept — emphasis / delete / badge |  |
| Claims.tsx | 330 | kept — emphasis / delete / badge | fontSize: 11.5, color: passed.length ? "#991B1B" : "#92400E" }}> |
| Claims.tsx | 347 | kept — emphasis / delete / badge |  |
| Claims.tsx | 473 | kept — emphasis / delete / badge | return Notice deadline{ds.state === "passed" ? · passed |
| Claims.tsx | 481 | kept — emphasis / delete / badge | return |
| Claims.tsx | 572 | kept — emphasis / delete / badge | color: rec.state === "differs" ? "#991B1B" : "#92400E" }}> |
| Claims.tsx | 641 | kept — emphasis / delete / badge | {dead && <span style={{ fontSize: 10, fontWeight: 700, color: "#B91C1C", background: "#FEF2F2", border: "1px s |
| Claims.tsx | 748 | kept — emphasis / delete / badge | {e.link ? (info.ok ? 📎 {info.label} ↗ : ⚠ bad ) : — } |
| Claims.tsx | 768 | kept — emphasis / delete / badge | NET 0 ? "#DC2626" : "#059669" }}>{eur(family.net)} |
| Contacts.tsx | 60 | kept — emphasis / delete / badge | Customs: { bg: "#FEE2E2", color: "#991B1B", icon: "🛃" }, |
| Contacts.tsx | 385 | kept — error / hazard | removeExtraAddress(i)} style={{ border: "1px solid #FECACA", background: "#fff", color: "#DC2626", borderRadiu |
| Contacts.tsx | 405 | kept — error / hazard | removeCommissionRate(i)} style={{ border: "1px solid #FECACA", background: "#fff", color: "#DC2626", borderRad |
| Contacts.tsx | 592 | kept — error / hazard | { if (await cdConfirm({ tone: "danger", title: `Remove ${p.name}?`, confirmLabel: "Remove" })) onDeletePerson( |
| Contacts.tsx | 616 | kept — error / hazard | { if (await cdConfirm({ tone: "danger", title: `Delete ${counterparty.name}?`, message: `This deletes the comp |
| Contacts.tsx | 1293 | kept — error / hazard | Keeping {keep.name} {incoming.id != null ? <> — absorbing {incoming.name} (it will be removed; its contact peo |
| Contacts.tsx | 1363 | kept — emphasis / delete / badge | These are different companies — save anyway |
| Contacts.tsx | 1466 | kept — error / hazard | {mine && { if (used > 0) { window.alert(`${l.name} is used by ${used} document(s) — it cannot be removed while |
| Contacts.tsx | 1501 | kept — error / hazard | {list.map(x => {x.iso} {x.name} {x.eu ? "EU" : "non-EU"} setForm({ ...x })} style={{ fontSize: 11, border: "1p |
| Contacts.tsx | 1952 | kept — error / hazard | { if (await ctConfirm({ tone: "danger", title: `Delete ${c.name}?`, message: `This deletes the company and ${c |
| CustomsImportModal.tsx | 12 | kept — emphasis / delete / badge | const KIND_COLOR: Record = { CC529C: "#0F766E", CC599C: "#1D4ED8", SAD: "#6B7280", unknown: "#DC2626" }; |
| CustomsImportModal.tsx | 56 | kept — emphasis / delete / badge | {s.reason} |
| CustomsImportModal.tsx | 59 | kept — error / hazard | {s.exact ? "Belongs to" : options.length ? "Confirm" : "Not placed"} |
| CustomsImportModal.tsx | 67 | kept — emphasis / delete / badge | ) : {s.reason} } |
| Dashboard.tsx | 47 | kept — error / hazard | const color = (t: string) => t === "bad" ? "#DC2626" : t === "warn" ? "#D97706" : "#16A34A"; |
| DateInput.tsx | 40 | kept — error / hazard | const base: any = { width: "100%", border: `1px solid ${bad ¦¦ warn ? "#DC2626" : "#E5E7EB"}`, borderRadius: 6 |
| DateInput.tsx | 48 | kept — error / hazard | {warn && date {warn} } |
| Finance.tsx | 74 | kept — error / hazard | danger: { bg: "#fff", color: "#DC2626", border: "#FECACA" }, |
| Finance.tsx | 101 | kept — emphasis / delete / badge | const color = isLoss ? "#DC2626" : isThin ? "#D97706" : "#16A34A"; |
| Finance.tsx | 179 | kept — emphasis / delete / badge | P/L {closed ? "(frozen)" : "(live — all active orders)"} = 0 ? "#16A34A" : "#DC2626"} /> |
| Finance.tsx | 180 | kept — emphasis / delete / badge | RECEIVABLES · PAYABLES |
| Finance.tsx | 182 | kept — emphasis / delete / badge | CASH PROJECTION (today, PLN) {cash.buckets.map((b: any) => = 0 ? "#16A34A" : "#DC2626"} />)} |
| Finance.tsx | 222 | kept — emphasis / delete / badge | = 0 ? "#16A34A" : "#DC2626" }}>{f(r.marginPLN)} |
| Finance.tsx | 223 | kept — emphasis / delete / badge | = 0 ? "#166534" : "#DC2626" }}>{r.marginPerKg != null ? r.marginPerKg.toLocaleString("pl-PL", { minimumFractio |
| Finance.tsx | 227 | kept — emphasis / delete / badge | TOTAL {f(tot.kg)} {f(tot.revenue)} = 0 ? "#16A34A" : "#DC2626" }}>{f(tot.margin)} {tot.kg > 0 ? (tot.margin /  |
| Finance.tsx | 244 | kept — error / hazard | {rows.map(r => {r.client} {r.limitPLN ? fmt(r.limitPLN) : "—"} {fmt(r.exposurePLN)} {fmt(r.openOrdersPLN)} 100 |
| Finance.tsx | 310 | kept — error / hazard | {st.lines.map((l, i) => {l.date} {l.type} {l.ref}{l.note ? · {l.note} : null} {l.dueDate ¦¦ ""}{l.overdueDays  |
| Finance.tsx | 312 | kept — error / hazard | Overdue now: {fmt(st.overdue) ¦¦ "0,00"} {st.currency} · aging: current {fmt(st.aging.current) ¦¦ "0"} · 1–30  |
| Finance.tsx | 365 | kept — emphasis / delete / badge | {err[a.id] && {err[a.id]} } |
| Finance.tsx | 443 | kept — error / hazard | : ["no match — pick manually", "#B91C1C", "#FEF2F2"]; |
| Finance.tsx | 451 | kept — emphasis / delete / badge | 0 ? "#16A34A" : "#DC2626", fontVariantNumeric: "tabular-nums" }}>{s.line.amount > 0 ? "+" : "−"}{fmtA(Math.abs |
| Finance.tsx | 518 | kept — error / hazard | const statusColor = (s: string) => s === "Overdue" ? "#DC2626" : s === "Paid" ? "#16A34A" : "#D97706"; |
| Finance.tsx | 524 | kept — emphasis / delete / badge | return Math.abs(fx) > 0.005 ? = 0 ? "#065F46" : "#B91C1C", background: fx >= 0 ? "#ECFDF5" : "#FEF2F2", border |
| Finance.tsx | 531 | kept — error / hazard | RECEIVABLE · OPEN {fmt(totals.receivableOpenPLN)} {fmt(totals.receivableOverduePLN)} overdue |
| Finance.tsx | 532 | kept — error / hazard | PAYABLE · OPEN {fmt(totals.payableOpenPLN)} {fmt(totals.payableOverduePLN)} overdue |
| Finance.tsx | 533 | kept — emphasis / delete / badge | NET POSITION = 0 ? "#16A34A" : "#DC2626" }}>{fmt(totals.netPositionPLN)} receivable − payable |
| Finance.tsx | 557 | kept — error / hazard | {i.dueDate ¦¦ "—"} |
| Finance.tsx | 662 | kept — emphasis / delete / badge | 0 ? "#DC2626" : "#D97706" }}> |
| Finance.tsx | 931 | kept — emphasis / delete / badge |  |
| Finance.tsx | 933 | kept — emphasis / delete / badge |  |
| Finance.tsx | 955 | kept — emphasis / delete / badge | {rows.map(r => = 0 ? "#065F46" : "#B91C1C", fontWeight: 700 }}>{r.measure}: {r.actualPLN.toLocaleString("pl-PL |
| Finance.tsx | 965 | kept — emphasis / delete / badge | {fmtPLN(pipelineAgg.totalNetMarginPLN)} |
| Finance.tsx | 971 | kept — emphasis / delete / badge | {fmtPLN(deliveredAgg.totalNetMarginPLN)} |
| Finance.tsx | 1029 | kept — emphasis / delete / badge | {r.kind} |
| Finance.tsx | 1072 | kept — emphasis / delete / badge | = 0 ? "#16A34A" : "#DC2626" }}>{fmtPLNcompact(m.marginPLN)} |
| IntegrityBadge.tsx | 8 | kept — error / hazard | const SEV_COLOR: Record = { error: "#DC2626", warning: "#D97706", info: "#64748B" }; |
| Inventory.tsx | 62 | kept — error / hazard | Cancelled: { color: "#DC2626", bg: "#FEE2E2", desc: "Cancelled expected procurement" }, |
| Inventory.tsx | 63 | kept — error / hazard | "Blocked · PO Cancelled": { color: "#DC2626", bg: "#FEE2E2", desc: "PO cancelled; review any physical stock ma |
| Inventory.tsx | 68 | kept — error / hazard | Damaged: { color: "#DC2626", bg: "#FEE2E2", desc: "Written off — damaged beyond use" }, |
| Inventory.tsx | 350 | kept — error / hazard | DAMAGE: { label: "Damage", color: "#DC2626", icon: "⚠", desc: "Write-off — damaged or rejected" }, |
| Inventory.tsx | 488 | kept — emphasis / delete / badge | "Industrial": { bg: "#FEE2E2", color: "#991B1B" }, // processing-grade — red |
| Inventory.tsx | 597 | kept — emphasis / delete / badge | function ageColor(days: number): string { return days <= 7 ? "#16A34A" : days <= 14 ? "#D97706" : "#DC2626"; } |
| Inventory.tsx | 781 | kept — error / hazard | {invalid && kg && Quantity must be between 0 and {maxKg.toLocaleString("pl-PL")} kg. } |
| Inventory.tsx | 851 | kept — error / hazard | export const qhDelete: any = { ...qhBtn, border: "1px solid #DC2626", background: "#DC2626", color: "#fff" }; |
| Inventory.tsx | 964 | kept — error / hazard | {r.acceptable ? "Acceptable" : "Not acceptable"} |
| Inventory.tsx | 1089 | kept — error / hazard | {tile("ARRIVAL", arrival ? <>{arrival.number} · {arrival.arrangedBy === "SUPPLIER" ? "supplier's truck" : "our |
| Inventory.tsx | 1091 | kept — error / hazard | {tile("QUALITY", lastIns ? <>{lastIns.stage} {lastIns.date} defects {inspectionTotals(lastIns).totalPct}% · {l |
| Inventory.tsx | 1502 | kept — error / hazard | 0 ? "#DC2626" : "#111", marginTop: 2 }}>{fmtNum(totalDamagedKg)} kg |
| Inventory.tsx | 1585 | kept — error / hazard | {l.damagedKg > 0 && {fmtNum(l.damagedKg)} damaged } |
| InventoryLot.tsx | 32 | kept — error / hazard | { key: "Damaged", kg: lot.damagedKg ¦¦ 0, color: "#DC2626" }, |
| InventoryLot.tsx | 103 | kept — error / hazard | DAMAGED {fmtNum(lot.damagedKg)} kg |
| InventoryLot.tsx | 274 | kept — error / hazard | const ST: any = { cleared: { t: "Cleared", c: "#059669", bg: "#DCFCE7" }, in_progress: { t: "Being cleared", c |
| InventoryLot.tsx | 370 | kept — emphasis / delete / badge |  |
| InventoryLot.tsx | 442 | kept — error / hazard | const chip = (s: string) => ({ Draft: "#94A3B8", Issued: "#B45309", Accepted: "#15803D", Rejected: "#DC2626",  |
| InventoryLot.tsx | 448 | kept — error / hazard | {lot.damagedKg > 0 && damaged {Number(lot.damagedKg).toLocaleString("pl-PL")} kg } |
| InventoryLot.tsx | 480 | kept — error / hazard | {isVoided ? "✕" : mt.icon} |
| InventoryLot.tsx | 483 | kept — emphasis / delete / badge |  |
| InventoryLot.tsx | 484 | kept — emphasis / delete / badge | {mt.label} |
| InventoryLot.tsx | 485 | kept — emphasis / delete / badge | · {fmtNum(m.qtyKg)} kg |
| InventoryLot.tsx | 486 | kept — emphasis / delete / badge | {isMove && · {fromLoc?.name} → {toLoc?.name} } |
| InventoryLot.tsx | 487 | kept — error / hazard | {isVoided && VOIDED } |
| InventoryLot.tsx | 492 | kept — error / hazard | {canVoid && onVoidMovement && onVoidMovement(m.id)} title="Void this entry — kept in the record but removed fr |
| InventoryWindows.tsx | 99 | kept — emphasis / delete / badge |  |
| InventoryWindows.tsx | 304 | kept — emphasis / delete / badge | {invVariance !== null && Math.abs(invVariance) >= 1 && 0 ? "#DC2626" : "#D97706", marginTop: 3, fontWeight: 60 |
| InventoryWindows.tsx | 477 | kept — error / hazard | {v.acceptable ? "Acceptable" : "Not acceptable"} |
| Invoices.tsx | 50 | kept — emphasis / delete / badge | PURCHASE: { label: "Purchase", color: "#DC2626", bg: "#FEE2E2" }, |
| Invoices.tsx | 51 | kept — emphasis / delete / badge | FORWARDER: { label: "Forwarder", color: "#DC2626", bg: "#FEE2E2" }, |
| Invoices.tsx | 52 | kept — emphasis / delete / badge | BROKER: { label: "Broker/Customs", color: "#DC2626", bg: "#FEE2E2" }, |
| Invoices.tsx | 53 | kept — emphasis / delete / badge | WAREHOUSE: { label: "Warehouse", color: "#DC2626", bg: "#FEE2E2" }, |
| Invoices.tsx | 54 | kept — emphasis / delete / badge | TRANSPORT: { label: "Transport", color: "#DC2626", bg: "#FEE2E2" }, |
| Invoices.tsx | 55 | kept — emphasis / delete / badge | OTHER: { label: "Other cost", color: "#DC2626", bg: "#FEE2E2" }, |
| Invoices.tsx | 60 | kept — error / hazard | Paid: { bg: "#DCFCE7", color: "#16A34A" }, Overdue: { bg: "#FEE2E2", color: "#DC2626" }, |
| Invoices.tsx | 61 | kept — error / hazard | Cancelled: { bg: "#FEE2E2", color: "#DC2626" }, // v6.83.0 (owner ruling): cancelled = red everywhere |
| Invoices.tsx | 69 | kept — emphasis / delete / badge | function DirPill({ inv }: { inv: Invoice }) { const r = invoiceDirection(inv) === "receivable"; return {r ? "↑ |
| Invoices.tsx | 239 | kept — error / hazard | {error && {error} } |
| Invoices.tsx | 260 | kept — emphasis / delete / badge | {r.seller}{r.dup && (() => { const info = duplicateCostInvoiceInfo(r.number, invoices); return DUPLICATE{info  |
| Invoices.tsx | 545 | kept — error / hazard | setPushState({ id: inv.id, msg: `Failed: ${res.error ¦¦ "unknown error"}`, tone: "#DC2626" }); |
| Invoices.tsx | 611 | kept — emphasis / delete / badge | newInvoice("COST")} style={{ padding: "6px 12px", borderRadius: 7, border: "none", background: "#DC2626", colo |
| Invoices.tsx | 623 | kept — emphasis / delete / badge | { l: "PAYABLE · OPEN", v: money(payOpen, "PLN"), c: "#DC2626" }, |
| Invoices.tsx | 624 | kept — emphasis / delete / badge | { l: "NET POSITION", v: money(recvOpen - payOpen, "PLN"), c: recvOpen - payOpen >= 0 ? "#16A34A" : "#DC2626" } |
| Invoices.tsx | 625 | kept — error / hazard | { l: "OVERDUE", v: String(overdue), c: overdue > 0 ? "#DC2626" : "#111" }, |
| Invoices.tsx | 654 | kept — emphasis / delete / badge | {i.number ¦¦ "—"} {i.isProforma && PRO-FORMA } |
| Invoices.tsx | 657 | kept — error / hazard | {formatDMY(i.dueDate) ¦¦ "—"} {od && {Math.abs(d as number)}d late } |
| Invoices.tsx | 705 | kept — error / hazard | {inv.paymentStatus !== "Paid" && inv.paymentStatus !== "Cancelled" && onMarkStatus("Cancelled")} style={{ padd |
| Invoices.tsx | 720 | kept — error / hazard | {onDeletePayment && onDeletePayment(p.id)} title="Remove payment event" style={{ marginLeft: "auto", border: " |
| Invoices.tsx | 734 | kept — emphasis / delete / badge | {pushState && {pushState.msg}{pushState.tone === "#D97706" && Copy payload } } |
| LoadPlans.tsx | 185 | kept — error / hazard | delMapRow(i)} title="Remove this line" style={{ border: "1px solid #FECACA", background: "#fff", color: "#DC26 |
| LoadingProtocolModal.tsx | 293 | kept — emphasis / delete / badge |  |
| LoadingProtocolModal.tsx | 318 | kept — emphasis / delete / badge | background: load.limit ? "#FEF2F2" : "#F0FDF4", border: `1px solid ${load.limit ? "#FECACA" : "#BBF7D0"}`, col |
| LoadingProtocolModal.tsx | 335 | kept — emphasis / delete / badge | : · {inspectLink(p.scanLink).reason} ) : null} |
| LoadingProtocolModal.tsx | 401 | kept — emphasis / delete / badge |  |
| LoadingProtocolModal.tsx | 410 | kept — emphasis / delete / badge |  |
| PlanningSheet.tsx | 138 | kept — error / hazard | Delete tab } |
| PlanningSheet.tsx | 145 | kept — emphasis / delete / badge | {usage.map(u => {u.label} {u.filledPct}% {u.medianDaysBeforeLoading === null ? "—" : u.medianDaysBeforeLoading |
| PlanningSheet.tsx | 166 | kept — error / hazard | deleteRow(ri)} style={{ border: "none", background: "none", cursor: "pointer", color: "#B91C1C", fontWeight: 8 |
| PurchaseOrderDetail.tsx | 56 | kept — error / hazard | Size set({ size: e.target.value })} placeholder="60-65" style={missingOf(a).includes("size") ? { ...inp, borde |
| PurchaseOrderDetail.tsx | 58 | kept — error / hazard | Quantity ({a.pricingUnit ¦¦ "kg"}) set({ qty: e.target.value })} placeholder="final" style={missingOf(a).inclu |
| PurchaseOrderDetail.tsx | 59 | kept — error / hazard | Unit price ({order.currency ¦¦ "PLN"}) set({ unitPrice: e.target.value })} style={missingOf(a).includes("unit  |
| PurchaseOrderDetail.tsx | 61 | kept — error / hazard | Packaging { const pk = (packagingTypes ¦¦ []).find((t: any) => String(t.id) === e.target.value); set({ packagi |
| PurchaseOrderDetail.tsx | 62 | kept — error / hazard | setAdded(added.filter((_, k) => k !== i))} title="remove this item" style={{ border: "1px solid #FECACA", back |
| PurchaseOrderDetail.tsx | 84 | kept — emphasis / delete / badge | {incomplete.length > 0 && Additional item{incomplete.length > 1 ? "s" : ""} incomplete: {incomplete.map(x => ` |
| PurchaseOrderDetail.tsx | 162 | kept — error / hazard | ? Deleted — read-only |
| PurchaseOrderForm.tsx | 293 | kept — emphasis / delete / badge | color: gate ? "#991B1B" : "#92400E" }}> |
| PurchaseOrderForm.tsx | 409 | kept — error / hazard | removeItem(i)} title="Delete this line" disabled={order.items.length 🗑 |
| PurchaseOrders.tsx | 99 | kept — error / hazard | Cancelled: { bg: "#FEE2E2", color: "#DC2626", desc: "" }, |
| PurchaseOrders.tsx | 173 | kept — emphasis / delete / badge | "Industrial": { bg: "#FEE2E2", color: "#991B1B" }, // processing-grade — red |
| PurchaseOrders.tsx | 435 | kept — error / hazard | {isCancelled && ✕ Deleted } |
| PurchaseOrders.tsx | 573 | kept — emphasis / delete / badge | style={docBtn("#DC2626", "#FEF2F2")} title="possible until the commission invoice is issued">↩ Re-open settlem |
| PurchaseOrders.tsx | 786 | kept — emphasis / delete / badge | <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#B91C1C", background: "#FEF2F2", border:  |
| PurchaseOrders.tsx | 1292 | kept — error / hazard | 0 ? "#DC2626" : "#111", marginTop: 2 }}>{overdueLoading} |
| PurchaseOrders.tsx | 1340 | kept — error / hazard | <div key={o.id} style={{ display: "grid", gridTemplateColumns: "150px 1fr 110px 110px 100px 130px 170px", padd |
| PurchaseOrders.tsx | 1346 | kept — emphasis / delete / badge | {o.number} |
| QualityReportDoc.tsx | 18 | kept — emphasis / delete / badge | const green = "#166534", red = "#B91C1C"; |
| SOMarginCard.tsx | 70 | kept — emphasis / delete / badge | const marginColor = isLoss ? "#DC2626" : isThinMargin ? "#D97706" : "#16A34A"; |
| SOMarginCard.tsx | 111 | kept — emphasis / delete / badge | {fmtPLN(margin.contributionMarginPLN)} |
| SOMarginCard.tsx | 177 | kept — emphasis / delete / badge |  |
| SalesOrderDetail.tsx | 222 | kept — error / hazard | ? Deleted — read-only |
| SalesOrderDetail.tsx | 363 | kept — emphasis / delete / badge | style={{ display: "inline-block", padding: "4px 8px", margin: "2px", background: dead ? "#FEF2F2" : "#F3E8FF", |
| SalesOrderDetail.tsx | 411 | kept — emphasis / delete / badge | {inv.number} |
| SalesOrderDetail.tsx | 414 | kept — emphasis / delete / badge | {String(inv.paymentStatus ¦¦ "Draft").toUpperCase()} |
| SalesOrderDetail.tsx | 437 | kept — emphasis / delete / badge | {fktMatchMsg && {fktMatchMsg.text} } |
| SalesOrderForm.tsx | 448 | kept — error / hazard | Cannot save as {order.status} — {priceQtyGaps.length} line{priceQtyGaps.length === 1 ? "" : "s"} without quant |
| SalesOrderForm.tsx | 449 | kept — emphasis / delete / badge | {priceQtyGaps.join(" · ")}. Keep it as Draft until they are known. |
| SalesOrderForm.tsx | 456 | kept — error / hazard | Cannot save as {order.status} — {sourcing.unsourcedIndexes.length} line{sourcing.unsourcedIndexes.length === 1 |
| SalesOrderForm.tsx | 457 | kept — emphasis / delete / badge |  |
| SalesOrderForm.tsx | 471 | kept — error / hazard | Cannot save as {order.status} — source PO is not confirmed |
| SalesOrderForm.tsx | 472 | kept — emphasis / delete / badge |  |
| SalesOrderForm.tsx | 493 | kept — emphasis / delete / badge |  |
| SalesOrderForm.tsx | 496 | kept — emphasis / delete / badge |  |
| SalesOrderForm.tsx | 682 | kept — emphasis / delete / badge | ⚠ Already used on {permitDupes.importPermitNo} |
| SalesOrderForm.tsx | 692 | kept — emphasis / delete / badge | ⚠ Already used on {permitDupes.acidNo} |
| SalesOrderForm.tsx | 804 | kept — emphasis / delete / badge |  |
| SalesOrderForm.tsx | 813 | kept — emphasis / delete / badge | }>LINE ITEMS ({order.items.length}){fullyLocked && 🔒 locked ({order.status}) } |
| SalesOrderForm.tsx | 854 | kept — emphasis / delete / badge |  |
| SalesOrderForm.tsx | 860 | kept — emphasis / delete / badge | border: lineIsBlocking ? "1px solid #991B1B" : "1px solid #E5E7EB", |
| SalesOrderForm.tsx | 861 | kept — emphasis / delete / badge | background: lineIsBlocking ? "#991B1B" : "#fff", |
| SalesOrderForm.tsx | 868 | kept — error / hazard | clearSource(i)} title="Remove the source link from this line" style={{ padding: "3px 10px", borderRadius: 5, b |
| SalesOrderForm.tsx | 870 | kept — emphasis / delete / badge |  |
| SalesOrderForm.tsx | 884 | kept — emphasis / delete / badge | ⚠ Product mismatch: |
| SalesOrderForm.tsx | 885 | kept — emphasis / delete / badge |  |
| SalesOrderForm.tsx | 913 | kept — emphasis / delete / badge |  |
| SalesOrderForm.tsx | 938 | kept — emphasis / delete / badge |  |
| SalesOrderForm.tsx | 942 | kept — emphasis / delete / badge |  |
| SalesOrderForm.tsx | 974 | kept — emphasis / delete / badge | Sell price {pricingUnitOf(it) === "box" ? "/ box" : "/ kg"}{it.priceToAgree && !(parseFloat(it.unitPrice) > 0) |
| SalesOrderForm.tsx | 996 | kept — error / hazard | removeItem(i)} disabled={order.items.length 🗑 |
| SalesOrders.tsx | 410 | kept — emphasis / delete / badge | "Industrial": { bg: "#FEE2E2", color: "#991B1B" }, |
| SalesOrders.tsx | 465 | kept — error / hazard | {isCancelled && ✕ Cancelled } |
| SalesOrders.tsx | 1342 | kept — emphasis / delete / badge | {o.number} |
| Settings.tsx | 48 | kept — error / hazard | danger: { bg: "#fff", color: "#DC2626", border: "#FECACA" }, |
| Settings.tsx | 234 | kept — error / hazard | if (await lpConfirm({ tone: "danger", title: `Remove ${l.name}?`, message: "Nothing references this location.  |
| Settings.tsx | 464 | kept — error / hazard | rmItem(c.item)} title="Remove item" style={{ border: "1px solid #FECACA", color: "#DC2626", background: "#fff" |
| Settings.tsx | 509 | kept — error / hazard | setUsers((prev: any[]) => (prev ¦¦ []).filter((x: any) => x.id !== u.id))} style={{ marginLeft: "auto", border |
| Settings.tsx | 836 | kept — error / hazard | color: message.kind === "success" ? "#065F46" : message.kind === "error" ? "#991B1B" : "#1E40AF", |
| Settings.tsx | 939 | kept — error / hazard | color: fktMsg.kind === "success" ? "#065F46" : fktMsg.kind === "error" ? "#991B1B" : "#1E40AF" }}> |
| Settings.tsx | 950 | kept — emphasis / delete / badge | {fktLiveWrite && ⚠ Live creation is enabled — “Send to Fakturownia” will create real invoices. Use only in a c |
| Settings.tsx | 1058 | kept — emphasis / delete / badge |  |
| ShipmentCreate.tsx | 222 | kept — emphasis / delete / badge | {draftUnsourced > 0 && {(selectedSO as any)?.number} is a draft with {draftUnsourced} unsourced line{draftUnso |
| ShipmentCreate.tsx | 246 | kept — emphasis / delete / badge |  |
| ShipmentCreate.tsx | 260 | kept — emphasis / delete / badge |  |
| ShipmentCreate.tsx | 293 | kept — emphasis / delete / badge | {it.product ¦¦ "Product"}{it.variety ? " — " + it.variety : ""} {it.size ? ` · ${it.size}` : ""}{it.packaging  |
| ShipmentCreate.tsx | 302 | kept — error / hazard | style={{ width: 78, border: "1px solid", borderColor: over ? "#DC2626" : "#CBD5E1", borderRadius: 6, padding:  |
| ShipmentCreate.tsx | 303 | kept — emphasis / delete / badge | / {fmtNum(rem)} left |
| ShipmentDetail.tsx | 37 | kept — error / hazard | ? Cancelled — read-only |
| ShipmentDetail.tsx | 248 | kept — emphasis / delete / badge | : ⚠ bad link ) |
| ShipmentDocuments.tsx | 313 | kept — emphasis / delete / badge | {!legIds.length && Select at least one leg. } |
| ShipmentEditor.tsx | 320 | kept — error / hazard | { setCloseAsk(false); onCancel(); }} style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid #FECACA |
| ShipmentEditor.tsx | 489 | kept — emphasis / delete / badge | return w.length ? {w.map((x, i) => ⚠ {x} )} : null; })()} |
| ShipmentEditor.tsx | 530 | kept — emphasis / delete / badge | ⛔ {v} |
| ShipmentEditor.tsx | 533 | kept — emphasis / delete / badge |  |
| ShipmentEditor.tsx | 628 | kept — error / hazard | Unload {k + 1} · {dr.missing ? no destination — set it on {dr.soNumber} : {nm(dr.placeId, dr.placeText)} } · { |
| ShipmentEditor.tsx | 672 | kept — error / hazard | {draft.arrangedBy !== "SUPPLIER" && Price for this unit{!(parseNum(u.costAmount) > 0) && draft.arrangedBy !==  |
| ShipmentEditor.tsx | 896 | kept — emphasis / delete / badge | {(() => { const alloc = trucks.reduce((s: number, u: any) => s + parseNum(((u.load ¦¦ []).find((x: any) => Str |
| ShipmentEditor.tsx | 932 | kept — error / hazard | Supplier{!c.supplierId ? · missing : null} updateCost(i, "supplierId", e.target.value ? parseNum(e.target.valu |
| ShipmentEditor.tsx | 1008 | kept — emphasis / delete / badge | : · {linkInfo.reason} ) : null} |
| Shipments.tsx | 82 | kept — error / hazard | Cancelled: { bg: "#FEE2E2", color: "#DC2626" }, |
| Shipments.tsx | 1031 | kept — emphasis / delete / badge | style={{ padding: "8px 12px", borderBottom: "1px solid #F1F5F9", cursor: "pointer", background: dead ? "#FEF2F |
| Shipments.tsx | 1033 | kept — emphasis / delete / badge | {sh.number} |
| ui.tsx | 67 | kept — emphasis / delete / badge | const bg = disabled ? "#F3F4F6" : dark ? "#0F172A" : green ? "#16A34A" : amber ? "#D97706" : red ? "#DC2626" : |
| ui.tsx | 68 | kept — error / hazard | const color = disabled ? "#AAA" : dark ¦¦ green ¦¦ amber ¦¦ red ? "#fff" : blue ? "#2563EB" : addK ? "#15803D" |
| ui.tsx | 135 | kept — emphasis / delete / badge | ? { textDecoration: "line-through", textDecorationColor: "#DC2626", textDecorationThickness: "1.5px", color: " |
| ui.tsx | 153 | kept — error / hazard | const accent = tone === "danger" ? "#DC2626" : tone === "warn" ? "#D97706" : "#2563EB"; |