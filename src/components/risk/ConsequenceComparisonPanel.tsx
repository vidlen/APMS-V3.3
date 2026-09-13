import { useMemo } from "react";
import type { UnitRiskResult } from "@/lib/risk-unit";
import { CONSEQUENCE_MATRIX, CONSEQUENCE_VALUES, NO_DISTRESS_CONSEQUENCE } from "@/config/riskScales";

interface ConsequenceComparisonPanelProps {
  results: UnitRiskResult[];
}

/** Pre-B-R2 Consequence reading, reconstructed from CONSEQUENCE_MATRIX -
 *  the exact formula scoreUnit used before consequence-apirm.ts/fod-index.ts
 *  replaced it (metode-b-r2 brief section 5.1). Assumes role 'runway', the
 *  only role RiskTab ever scores. */
function oldConsequence(r: UnitRiskResult): number {
  return r.dominantDistress === "" ? NO_DISTRESS_CONSEQUENCE : CONSEQUENCE_MATRIX.runway[r.hazardClass];
}

function countBy(results: UnitRiskResult[], key: (r: UnitRiskResult) => number): Map<number, number> {
  const counts = new Map<number, number>();
  for (const r of results) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
  return counts;
}

function CompareRow({ label, oldC, newC }: { label: string; oldC: number; newC: number }) {
  const diff = oldC !== newC;
  return (
    <div className="flex items-center justify-between gap-2 py-0.5 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${diff ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
        {oldC} <span className="text-muted-foreground/60">/</span> {newC}
      </span>
    </div>
  );
}

// Section 8.5 (metode-b-r2 brief, optional panel, done last): old
// CONSEQUENCE_MATRIX[role][hazardClass] reading side by side with the new
// max(consequenceApirm, consequenceFod) reading, over one results array -
// Consequence doesn't depend on likelihood source (test "11" in
// risk-unit.test.ts pins this), so there is no A/B split to show here.
export default function ConsequenceComparisonPanel({ results }: ConsequenceComparisonPanelProps) {
  const oldCounts = useMemo(() => countBy(results, oldConsequence), [results]);
  const newCounts = useMemo(() => countBy(results, (r) => r.consequence), [results]);
  const shifted = useMemo(() => results.filter((r) => oldConsequence(r) !== r.consequence).length, [results]);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="bg-card border-b border-border px-4 py-3">
        <h3 className="panel-label">Consequence comparison &mdash; old CONSEQUENCE_MATRIX vs. new (APIRM / FOD)</h3>
        <p className="text-[11px] text-muted-foreground mt-1">Counts shown as old / new; bold where they differ.</p>
      </div>
      <div className="p-4 max-w-xs">
        {CONSEQUENCE_VALUES.map((c) => (
          <CompareRow key={c} label={`C = ${c}`} oldC={oldCounts.get(c) ?? 0} newC={newCounts.get(c) ?? 0} />
        ))}
      </div>
      <div className="px-4 pb-4 text-[11px] text-muted-foreground">
        <span className="font-mono font-semibold text-foreground">{shifted}</span> of {results.length} unit(s) get a
        different Consequence under the new axes.
      </div>
    </div>
  );
}
