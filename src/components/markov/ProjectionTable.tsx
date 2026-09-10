import { MARKOV_CLASS_LABELS } from "@/config/markovParams";
import type { MarkovProjection } from "@/lib/markov";

export default function ProjectionTable({ projection }: { projection: MarkovProjection[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="min-w-[900px] w-full text-xs tabular-nums">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-3 py-3 text-left font-semibold">Year</th>
            {MARKOV_CLASS_LABELS.map((label) => <th key={label} className="px-3 py-3 text-right font-semibold">{label}</th>)}
            <th className="px-3 py-3 text-right font-semibold text-foreground">PCI</th>
          </tr>
        </thead>
        <tbody>
          {projection.map((row) => (
            <tr key={row.year} className="border-t border-border hover:bg-muted/30">
              <th className="px-3 py-2.5 text-left font-medium text-foreground">{row.year}</th>
              {row.classShare.map((share, index) => <td key={index} className="px-3 py-2.5 text-right">{(share * 100).toFixed(1)}%</td>)}
              <td className="px-3 py-2.5 text-right font-semibold text-foreground">{row.pci.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
