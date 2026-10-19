// DatesChain.tsx — v7.27.18 (A-D-4): the dates chain as one line under a document's header; a gap is amber.
import React from "react";
import { formatDMY } from "./dates";
import type { ChainStep } from "./datesChain.domain";

export function DatesChain({ steps = [] }: { steps: ChainStep[] }) {
  if (!steps.length) return null;
  return (
    <div data-dates-chain="1" style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 6, fontSize: 12, color: "#475569", margin: "4px 0 10px" }}>
      {steps.map((s, i) => (
        <React.Fragment key={s.label}>
          {i > 0 && <span aria-hidden="true" style={{ color: "#CBD5E1" }}>→</span>}
          <span title={s.gap ? "a gap: a later step already has a date" : ""} style={{ fontWeight: s.date ? 600 : 400, color: s.gap ? "#B45309" : s.date ? "#1F2937" : "#94A3B8" }}>
            {s.label} {s.date ? formatDMY(s.date) : s.gap ? "— missing" : "—"}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}
