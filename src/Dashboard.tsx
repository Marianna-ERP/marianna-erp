import React from "react";
import { movementTiles, documentTiles, deadlineTiles, ownerTiles, warehouseTiles, integrityTile, tileSetsFor } from "./dashboard.domain";
import { clientRiskTable } from "./financePlus.domain";
import { currentUser } from "./permissions.domain";
import { Card } from "./ui";

import {localTodayISO } from "./dates";
import { ModulePage } from "./ui";

// ─── DASHBOARD ──────────────────────────────────────────────────────────────
// Phase 1 dashboard: reads live state from PO / SO / Inventory / Contacts and
// renders a KPI overview. No own state, no mutations — pure consumer.
//
// The shell passes in: { pos, orders, lots, contacts, onNavigate }
//
// "onNavigate(moduleKey)" lets dashboard buttons jump to a module ("Open PO" etc.)

// PRE_DISPATCH set imported from ./types (Batch 0).



export default function Dashboard({ pos = [], orders = [], lots = [], contacts = [], shipments = [], invoices = [], claims = [], financeNotes = [], onNavigate = () => {}, inspections = [], stockCounts = [], closedPeriods = [], poSettlements = [], users = [], userName = "", integrityIssues = [] }: any) {
  return (
    <ModulePage title="Dashboard" right={<span style={{ fontSize: 11, color: "#AAA" }}>{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>}>   {/* v6.99.61 (A-HD-1/2) */}
      <div>

        {/* v6.99.4 (DA-1…DA-8): role-composed tile sets — exceptions and today's events only; "none" in green when nothing */}
        {(() => {
          const today = localTodayISO();
          const me = currentUser(users, userName);
          const sets = tileSetsFor(me);
          const groups: Array<{ title: string; tiles: any[] }> = [];
          if (sets.includes("operations")) {
            groups.push({ title: "TODAY'S MOVEMENTS", tiles: movementTiles(shipments, today) });
            groups.push({ title: "DOCUMENTS OUTSTANDING", tiles: documentTiles(shipments, orders, invoices, pos) });
            groups.push({ title: "DEADLINES", tiles: deadlineTiles(lots, inspections, contacts, pos, claims, today) });
          }
          if (sets.includes("owner")) {
            const risk = clientRiskTable(invoices, orders, contacts, today);
            groups.push({ title: "OWNER CONTROLS", tiles: ownerTiles(closedPeriods, poSettlements, financeNotes, risk, today) });
          }
          if (sets.includes("warehouse")) {
            const locId = (me as any)?.locationId ?? (lots.find((l: any) => (Number(l.physicalKg) || 0) > 0)?.locationId ?? null);
            groups.push({ title: "WAREHOUSE — THIS MORNING", tiles: warehouseTiles(lots, shipments, inspections, stockCounts, locId, today) });
          }
          groups.push({ title: "DATA", tiles: [integrityTile(integrityIssues || [])] });
          const color = (t: string) => t === "bad" ? "#DC2626" : t === "warn" ? "#D97706" : "#16A34A";
          return groups.map(g => (
            <div key={g.title} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", letterSpacing: 0.5, marginBottom: 6 }}>{g.title}</div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, g.tiles.length))}, 1fr)`, gap: 12 }}>
                {g.tiles.map((t: any) => (
                  <Card key={t.key} style={{ cursor: "pointer", borderLeft: `4px solid ${color(t.tone)}` }}>
                    <div onClick={() => onNavigate(t.module === "integrity" ? "settings" : t.module)}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", letterSpacing: 0.4 }}>{t.title}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: color(t.tone), marginTop: 4 }}>{t.count ? `${t.count} · ` : ""}{t.detail}</div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ));
        })()}
        <div style={{ marginTop: 10, fontSize: 10.5, color: "#AAA", textAlign: "center" }}>The Dashboard shows what needs attention today. Analysis lives in Finance; registers in their modules.</div>
      </div>
    </ModulePage>
  );
}
