import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { MARKOV_CLASS_LABELS, MARKOV_PARAMS } from "@/config/markovParams";
import { computeMarkov, type MarkovResult, type MarkovVariant } from "@/lib/markov";
import VariantToggle from "./VariantToggle";
import ClassDistributionPanel from "./ClassDistributionPanel";
import TransitionMatrixPanel from "./TransitionMatrixPanel";
import ProjectionTable from "./ProjectionTable";
import ProjectionChart from "./ProjectionChart";
import ClassCompositionChart from "./ClassCompositionChart";
import MarkovMethodologyPanel from "./MarkovMethodologyPanel";

type PciSource = { features: { properties: { sampleUnit: number; pci_score: number } }[] };
type Snapshot = {
  generatedAt: string;
  variants: Record<MarkovVariant, { projection: { year: number; pci: number }[] }>;
};
type OpenPanel = "parameter" | "distribution" | "matrix" | "method" | null;

function sourceToPci(source: PciSource) {
  return source.features
    .slice()
    .sort((left, right) => left.properties.sampleUnit - right.properties.sampleUnit)
    .map((feature) => feature.properties.pci_score);
}

function Disclosure({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
        <span className="panel-label">{title}</span>
        {open ? <ChevronUp size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronDown size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
      </button>
      {open && <div className="border-t border-border px-4 py-4 sm:px-5">{children}</div>}
    </section>
  );
}

function ParameterPanel({ result }: { result: MarkovResult }) {
  const entries = [
    ["Class width", `${MARKOV_PARAMS.classWidth} points`, "The interval between ASTM D5340 class boundaries."],
    ["Class boundaries", MARKOV_PARAMS.classLowerBounds.join(" · "), "Lower boundaries from Good through Failed."],
    ["Class midpoints", MARKOV_PARAMS.classMidpoints.join(" · "), "Representative values used to calculate PCI from the class distribution."],
    ["Measured rate", `${result.measuredRate.toFixed(6)} points/year`, "The 2025 PCI average minus the 2026 PCI average from the JSON data."],
    ["Fill probability", result.pFill.toFixed(6), "One minus the measured rate divided by class width."],
    ["Offset", result.offset.toFixed(3), "The 2026 PCI average minus the 2026 class-midpoint average."],
    ["n threshold", String(MARKOV_PARAMS.thresholdN), "Rows below this n use the fill probability in the monotonic variant."],
    ["Dirichlet alpha", String(MARKOV_PARAMS.dirichletAlpha), "The total prior strength over {stay, deteriorate by one class}."],
  ];
  return <div className="grid gap-3 sm:grid-cols-2">{entries.map(([label, value, source]) => <div key={label} className="rounded-md border border-border/70 bg-muted/20 p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground">{value}</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{source}</p></div>)}</div>;
}

function snapshotDifference(result: MarkovResult, snapshot: Snapshot | null) {
  if (!snapshot) return null;
  let largest = { difference: 0, year: 2026 };
  (Object.keys(result.variants) as MarkovVariant[]).forEach((variant) => {
    result.variants[variant].projection.forEach((row, index) => {
      const reference = snapshot.variants[variant]?.projection[index];
      if (!reference) return;
      const difference = Math.abs(row.pci - reference.pci);
      if (difference > largest.difference) largest = { difference, year: row.year };
    });
  });
  return largest.difference > 0.01 ? largest : null;
}

export default function MarkovTab() {
  const [variant, setVariant] = useState<MarkovVariant>("n8");
  const [openPanel, setOpenPanel] = useState<OpenPanel>("parameter");
  const [inputs, setInputs] = useState<{ previous: number[]; next: number[] } | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/data/runway-06-24-units-2025.json").then((response) => response.ok ? response.json() as Promise<PciSource> : Promise.reject(new Error("The 2025 PCI data could not be loaded."))),
      fetch("/data/runway-06-24-units-2026.json").then((response) => response.ok ? response.json() as Promise<PciSource> : Promise.reject(new Error("The 2026 PCI data could not be loaded."))),
      fetch("/data/markov-06-24-snapshot.json").then((response) => response.ok ? response.json() as Promise<Snapshot> : Promise.reject(new Error("The Markov snapshot could not be loaded."))),
    ])
      .then(([previous, next, reference]) => {
        if (!cancelled) {
          setInputs({ previous: sourceToPci(previous), next: sourceToPci(next) });
          setSnapshot(reference);
        }
      })
      .catch((reason: unknown) => !cancelled && setError(reason instanceof Error ? reason.message : "The Markov data could not be loaded."));
    return () => { cancelled = true; };
  }, []);

  const result = useMemo(() => inputs && computeMarkov(inputs.previous, inputs.next, MARKOV_PARAMS), [inputs]);
  const drift = useMemo(() => result && snapshotDifference(result, snapshot), [result, snapshot]);

  if (error) return <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-destructive">{error}</div>;
  if (!result) return <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-muted-foreground">Loading the RWY 06/24 Markov calculation…</div>;

  const active = result.variants[variant].projection;
  const final = active.at(-1)!;
  const first = active[0];
  const averageRate = (first.pci - final.pci) / (active.length - 1);
  const poorOrBelow = (row: typeof first) => row.classShare.slice(3).reduce((sum, share) => sum + share, 0) * 100;
  const cards = [
    ["PCI 2031", final.pci.toFixed(2), "points"],
    ["Average rate", averageRate.toFixed(2), "points/year"],
    ["Good-class units", `${(first.classShare[0] * 100).toFixed(1)}% → ${(final.classShare[0] * 100).toFixed(1)}%`, "2026 to 2031"],
    ["Poor or below", `${poorOrBelow(first).toFixed(1)}% → ${poorOrBelow(final).toFixed(1)}%`, "2026 to 2031"],
  ];

  return (
    <main className="mx-auto max-w-6xl space-y-7 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-condensed text-2xl font-semibold tracking-tight text-foreground">Markov Projection</h2>
          <p className="mt-1 max-w-[72ch] text-sm leading-relaxed text-muted-foreground">Network condition projection from the 2025 to 2026 PCI transition. Year 2026 is the anchor and the horizon ends in 2031.</p>
        </div>
        <VariantToggle value={variant} onChange={setVariant} />
      </header>

      {drift && <div role="status" className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" /><p>The figures on this page differ from those used in the thesis. The largest difference is {drift.difference.toFixed(2)} points in {drift.year}. The source data may have changed since the snapshot was created on {snapshot?.generatedAt}.</p></div>}

      <section aria-labelledby="projection-results" className="space-y-4">
        <div><h3 id="projection-results" className="font-condensed text-lg font-semibold text-foreground">Projection results</h3><p className="mt-1 text-sm text-muted-foreground">The active variant updates the cards, table, TPM, and composition chart.</p></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value, detail]) => <article key={label} className="rounded-lg border border-border bg-card p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-mono text-xl font-semibold tabular-nums text-foreground">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></article>)}</div>
        <ProjectionTable projection={active} />
      </section>

      <section aria-labelledby="calculation" className="space-y-3"><div><h3 id="calculation" className="font-condensed text-lg font-semibold text-foreground">Calculation</h3><p className="mt-1 text-sm text-muted-foreground">Open one panel at a time to trace the calculation chain.</p></div>
        <Disclosure title="1. Parameters" open={openPanel === "parameter"} onToggle={() => setOpenPanel(openPanel === "parameter" ? null : "parameter")}><ParameterPanel result={result} /></Disclosure>
        <Disclosure title="2. Class distribution" open={openPanel === "distribution"} onToggle={() => setOpenPanel(openPanel === "distribution" ? null : "distribution")}><ClassDistributionPanel previous={result.classDistribution.previous} next={result.classDistribution.next} /></Disclosure>
        <Disclosure title="3–4. N matrix and TPM" open={openPanel === "matrix"} onToggle={() => setOpenPanel(openPanel === "matrix" ? null : "matrix")}><TransitionMatrixPanel nRaw={result.nRaw} nMonotone={result.nMonotone} tpm={result.variants[variant].tpm} variant={variant} /></Disclosure>
        <Disclosure title="5. How to read this" open={openPanel === "method"} onToggle={() => setOpenPanel(openPanel === "method" ? null : "method")}><MarkovMethodologyPanel /></Disclosure>
      </section>

      <section aria-labelledby="charts" className="space-y-3"><div><h3 id="charts" className="font-condensed text-lg font-semibold text-foreground">Charts</h3><p className="mt-1 text-sm text-muted-foreground">Visual summary of PCI and class-composition change across the horizon.</p></div><div className="grid gap-4 lg:grid-cols-2"><ProjectionChart n8={result.variants.n8.projection} dirichlet={result.variants.dirichlet.projection} activeVariant={variant} /><ClassCompositionChart projection={active} /></div></section>

      <section aria-labelledby="limitations" className="rounded-lg border border-border bg-muted/25 p-4 sm:p-5"><h3 id="limitations" className="font-condensed text-lg font-semibold text-foreground">Limitations</h3><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground"><li>The matrix is built from one year pair, 2025 to 2026. No years remain for a hold-out check.</li><li>The pair also contains survey-coverage changes: 111 units lost all L&amp;T cracking records and 29 lost all alligator-cracking records between surveys.</li><li>Grouping PCI into 15-point classes removes within-class information, so the model rate is faster than the measured rate.</li><li>Four matrix rows, Poor through Failed, have no observations. They are entirely assumption-driven and no data can correct them.</li></ul><p className="mt-3 text-xs text-muted-foreground">Classes: {MARKOV_CLASS_LABELS.join(" · ")}</p></section>
    </main>
  );
}
