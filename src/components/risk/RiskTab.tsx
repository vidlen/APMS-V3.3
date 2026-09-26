import { useMemo, useState } from "react";
import { ChevronLeft, Download, Map as MapIcon, Table as TableIcon } from "lucide-react";
import type { SectionData } from "@/lib/pci-utils";
import type { SurveyYear } from "@/lib/survey-years";
import type { GeoJSONFeatureCollection } from "@/lib/geojson-types";
import type { DistressTally } from "@/lib/dominant-distress";
import type { RepairLogStats } from "@/lib/repair-log";
import { usePavementData } from "@/hooks/usePavementData";
import { toUnitRiskInputs } from "@/lib/risk-unit-adapter";
import { scoreUnits, type UnitRiskResult } from "@/lib/risk-unit";
import { downloadUnitRiskResultsCsv } from "@/lib/risk-unit-export";
import { ICAO_GRID_PROVENANCE, ICAO_ZONES, type IcaoZoneName } from "@/config/icaoMatrix";
import { DEFAULT_LIKELIHOOD_SOURCE, RISK_BANDS, type LikelihoodSource } from "@/config/riskScales";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import IcaoMatrixPanel from "./IcaoMatrixPanel";
import DistressCoveragePanel from "./DistressCoveragePanel";
import RiskMethodologyPanel from "./RiskMethodologyPanel";
import VariantComparisonPanel from "./VariantComparisonPanel";
import UnitRiskPanel, { UnitDetail } from "./UnitRiskPanel";
import RiskMapView from "./RiskMapView";

interface RiskTabProps {
  sections: SectionData[];
  selectedYear: SurveyYear;
  /** PCI sample units already loaded for this year (usePavementData), keyed
   *  by Section. Used only to count branches with sample-unit distress
   *  evidence for the coverage panel below - Metode B itself fetches its own
   *  current/previous-year data per selected runway (see the useMemo below). */
  unitsBySection?: Record<string, GeoJSONFeatureCollection>;
  /** The repair log, already aggregated against this year's branch set
   *  (Home.tsx: aggregateRepairLog(...).byBranch) - used only for the
   *  coverage panel's branch-union count, not for scoring. */
  repairLogByBranch?: Record<string, DistressTally[]>;
  /** Same aggregation's resolution counts, for the coverage panel. */
  repairLogStats?: RepairLogStats;
}

const EMPTY_UNITS: Record<string, GeoJSONFeatureCollection> = {};
const EMPTY_LOG: Record<string, DistressTally[]> = {};
const EMPTY_STATS: RepairLogStats = {
  total: 0,
  byFacility: 0,
  byLocation: 0,
  unresolvedGroup: 0,
  unknownFacility: 0,
  skippedNoDistress: 0,
  aggregatedWithoutSeverity: 0,
  aggregated: 0,
  branchesCovered: 0,
};

// Metode B only has real per-unit distress + PCI for these two branches
// (metode-b-spec_4.md section 0.6) - every other branch has no sample-unit
// collection to score at all, so the tab is scoped to a choice between them.
const RUNWAY_OPTIONS: { id: string; label: string }[] = [
  { id: "06/24", label: "RWY 06/24" },
  { id: "07L/25R", label: "RWY 07L/25R" },
];

type RiskView = "map" | "table";
type ColorBy = "degree" | "icao";

export default function RiskTab({
  sections,
  selectedYear,
  unitsBySection = EMPTY_UNITS,
  repairLogByBranch = EMPTY_LOG,
  repairLogStats = EMPTY_STATS,
}: RiskTabProps) {
  // Map first, like the PCI tab; the table keeps the full register and panels.
  const [view, setView] = useState<RiskView>("map");
  const [branchId, setBranchId] = useState<string>(RUNWAY_OPTIONS[0].id);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<number | null>(null);
  const [colorBy, setColorBy] = useState<ColorBy>("degree");
  // Section 9.1: runtime state, not persisted to localStorage - every session
  // starts on DEFAULT_LIKELIHOOD_SOURCE.
  const [likelihoodSource, setLikelihoodSource] = useState<LikelihoodSource>(DEFAULT_LIKELIHOOD_SOURCE);

  const previousYearNum = Number(selectedYear) - 1;
  const previousYear = String(previousYearNum);
  const { unitsBySection: currentUnitsBySection, loading } = usePavementData(selectedYear);
  const { unitsBySection: previousUnitsBySection } = usePavementData(previousYear);

  const inputs = useMemo(() => {
    const currentFc = currentUnitsBySection[branchId];
    if (!currentFc) return [];
    const previousFc = previousUnitsBySection[branchId];
    return toUnitRiskInputs(branchId, "runway", Number(selectedYear), currentFc, previousFc, previousYearNum);
  }, [branchId, selectedYear, previousYearNum, currentUnitsBySection, previousUnitsBySection]);

  // Section 9.1: recompute the WHOLE array on every variant change, never patch
  // riskScore alone - band/icao/dru all depend on likelihood too.
  const results: UnitRiskResult[] = useMemo(() => scoreUnits(inputs, likelihoodSource), [inputs, likelihoodSource]);
  // Section 9.2/9.3: both variants, always scored, independent of which is
  // active - drives the comparison panel and the "shifted only" table mode.
  const resultsA = useMemo(() => scoreUnits(inputs, "tdv"), [inputs]);
  const resultsB = useMemo(() => scoreUnits(inputs, "pci"), [inputs]);

  const handleSelectSource = (source: LikelihoodSource) => {
    setLikelihoodSource(source);
    // Section 9.4 item 1: a cell selected under the old variant may not exist
    // under the new one - clear it rather than leave a filter with no rows.
    setSelectedCell(null);
  };

  // "Covered" here means the union of branches with sample-unit distress
  // evidence or repair-log evidence - the two sources that still have any
  // way to fire post-cleanup (the admin-override and reviewed-inventory
  // tiers had no live writer left once the Branch Register admin screen was
  // removed, and both real-evidence branches already resolve via sample
  // units, so this union reproduces the old precedence-chain count exactly
  // for the committed data).
  const coveredBranches = useMemo(() => {
    const covered = new Set<string>(Object.keys(unitsBySection));
    for (const [branch, tallies] of Object.entries(repairLogByBranch)) {
      if (tallies.length > 0) covered.add(branch);
    }
    return covered.size;
  }, [unitsBySection, repairLogByBranch]);

  const handleSelectCell = (cell: string | null) => {
    setSelectedCell((prev) => (prev === cell ? null : cell));
  };

  const handleSelectBranch = (id: string) => {
    setBranchId(id);
    // Unit numbers repeat across runways - a selection can't carry over.
    setSelectedUnit(null);
  };

  const selectedResult = results.find((r) => r.unitNumber === selectedUnit);
  // Map legend rows for whichever scheme colours the units.
  const legend = useMemo(
    () =>
      colorBy === "degree"
        ? RISK_BANDS.map((b) => ({
            key: String(b.degree),
            color: b.color,
            label: `Degree ${b.degree}`,
            detail: b.situation,
            count: results.filter((r) => r.band.degree === b.degree).length,
          }))
        : (Object.keys(ICAO_ZONES) as IcaoZoneName[]).map((z) => ({
            key: z,
            color: ICAO_ZONES[z].color,
            label: z,
            detail: ICAO_ZONES[z].action,
            count: results.filter((r) => r.icao.zone === z).length,
          })),
    [colorBy, results],
  );

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-card border-b border-border">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && setView(v as RiskView)}>
            <ToggleGroupItem value="map" aria-label="Map view">
              <MapIcon size={13} /> Map
            </ToggleGroupItem>
            <ToggleGroupItem value="table" aria-label="Table view">
              <TableIcon size={13} /> Table
            </ToggleGroupItem>
          </ToggleGroup>

          <ToggleGroup type="single" variant="outline" size="sm" value={branchId} onValueChange={(v) => v && handleSelectBranch(v)}>
            {RUNWAY_OPTIONS.map((r) => (
              <ToggleGroupItem key={r.id} value={r.id}>
                {r.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Likelihood</span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={likelihoodSource}
            onValueChange={(v) => v && handleSelectSource(v as LikelihoodSource)}
          >
            <ToggleGroupItem value="pci" title="Likelihood from the unit's own PCI, read on the ASTM condition class. Uses the full-precision survey figure. Default B-R3 variant.">
              B &middot; PCI unit
            </ToggleGroupItem>
            <ToggleGroupItem value="tdv" title="Likelihood from the sum of deduct value across every distress on the unit. Preserves the signal from stacked distress types. Shown for comparison against variant B.">
              A &middot; deduct ASTM (comparison)
            </ToggleGroupItem>
          </ToggleGroup>
          <button
            onClick={() => downloadUnitRiskResultsCsv(results, { branchId, surveyYear: Number(selectedYear), likelihoodSource })}
            className="h-8 inline-flex items-center gap-1.5 px-3 rounded-md text-xs font-medium border border-border text-foreground hover:bg-secondary transition-colors"
            title="Export this table's scored results as CSV, with branch/year/variant in the header"
          >
            <Download size={12} /> Export CSV
          </button>
        </div>
      </div>

      {view === "map" ? (
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          <div className="relative flex-1 min-h-[300px]">
            <RiskMapView
              units={currentUnitsBySection[branchId]}
              results={results}
              selectedUnit={selectedUnit}
              onSelectUnit={setSelectedUnit}
              selectedCell={selectedCell}
              colorBy={colorBy}
            />
            {selectedCell && (
              <button
                onClick={() => setSelectedCell(null)}
                className="panel-surface absolute top-3 right-3 z-10 h-8 px-3 rounded-md text-xs font-medium text-primary"
              >
                Cell {selectedCell} &middot; Clear
              </button>
            )}
          </div>

          <aside className="shrink-0 md:w-[440px] max-h-[50%] md:max-h-none overflow-y-auto custom-scrollbar bg-card border-t md:border-t-0 md:border-l border-border">
            {loading ? (
              <div className="text-sm text-muted-foreground px-4 py-10 text-center">Loading sample units...</div>
            ) : results.length === 0 ? (
              <div className="text-sm text-muted-foreground px-4 py-10 text-center">
                No sample-unit data for this runway in {selectedYear}.
              </div>
            ) : selectedResult ? (
              <div className="p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedUnit(null)}
                    className="p-1 -ml-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label="Back to all units"
                    title="Back to all units"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <h3 className="panel-label">
                    {RUNWAY_OPTIONS.find((o) => o.id === branchId)?.label} &middot; Unit{" "}
                    <span className="text-foreground">{selectedResult.unitNumber}</span>
                  </h3>
                </div>
                <UnitDetail r={selectedResult} />
              </div>
            ) : (
              <div className="p-4 space-y-5">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="panel-label">
                      {colorBy === "degree" ? "Fine-Kinney degree" : "ICAO zone"} &mdash; {results.length} units
                    </h3>
                    <ToggleGroup type="single" variant="outline" size="sm" value={colorBy} onValueChange={(v) => v && setColorBy(v as ColorBy)}>
                      <ToggleGroupItem value="degree" title="Colour units by Fine-Kinney degree (R = L × F × C)">
                        Fine-Kinney
                      </ToggleGroupItem>
                      <ToggleGroupItem value="icao" title="Colour units by ICAO Doc 9859 risk zone">
                        ICAO
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  <ul>
                    {legend.map((row) => (
                      <li key={row.key} className="hairline-row flex items-center gap-3 py-2 text-xs">
                        <span className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ backgroundColor: row.color }} />
                        <span className="font-medium text-foreground shrink-0">{row.label}</span>
                        <span className="text-muted-foreground truncate" title={row.detail}>{row.detail}</span>
                        <span className="ml-auto font-mono tabular-nums text-foreground">{row.count}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-muted-foreground mt-2">Click a unit on the map for its score.</p>
                </div>
                <IcaoMatrixPanel results={results} selectedCell={selectedCell} onSelectCell={handleSelectCell} />
              </div>
            )}
          </aside>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-6 py-8 space-y-5">
            <div>
              <h2 className="font-condensed text-xl font-semibold tracking-tight text-foreground">
                Risk Management
              </h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-[70ch]">
                Sample-unit level Fine-Kinney scoring (Metode B) for RWY 06/24 and RWY 07L/25R, using
                ICAO Doc 9859 for the operational verdict.
              </p>
              <p className="text-xs text-muted-foreground/80 italic mt-1 max-w-[70ch]">
                Calculated only using processes found in literature, not yet adhering to Angkasa Pura's SMS.
                Still subject to change.
              </p>
            </div>

            <p className="text-[11px] text-muted-foreground border border-dashed border-border rounded-md px-3 py-2">
              {ICAO_GRID_PROVENANCE}
            </p>

            <IcaoMatrixPanel results={results} selectedCell={selectedCell} onSelectCell={handleSelectCell} />

            <VariantComparisonPanel resultsA={resultsA} resultsB={resultsB} />

            <DistressCoveragePanel
              stats={repairLogStats}
              coveredBranches={coveredBranches}
              totalBranches={sections.length}
              sampleUnitBranchCount={Object.keys(unitsBySection).length}
            />

            <RiskMethodologyPanel results={results} likelihoodSource={likelihoodSource} />

            <UnitRiskPanel
              selectedYear={selectedYear}
              results={results}
              compareA={resultsA}
              compareB={resultsB}
              likelihoodSource={likelihoodSource}
              loading={loading}
              selectedCell={selectedCell}
              onClearCellFilter={() => setSelectedCell(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
