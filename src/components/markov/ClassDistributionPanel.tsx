import { MARKOV_CLASS_LABELS } from "@/config/markovParams";
import { pciCategories } from "@/lib/pci-utils";

interface ClassDistributionPanelProps {
  previous: number[];
  next: number[];
}

const colors = Object.fromEntries(pciCategories.map((category) => [category.label, category.color]));

export default function ClassDistributionPanel({ previous, next }: ClassDistributionPanelProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-xs tabular-nums">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th className="px-2 py-2 text-left font-medium">Class</th>
            <th className="px-2 py-2 text-right font-medium">2025</th>
            <th className="px-2 py-2 text-right font-medium">2026</th>
            <th className="px-2 py-2 text-right font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {MARKOV_CLASS_LABELS.map((label, index) => (
            <tr key={label} className="border-b border-border/60 last:border-0">
              <td className="px-2 py-2 font-medium text-foreground">
                <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colors[label] }} aria-hidden="true" />
                {label}
              </td>
              <td className="px-2 py-2 text-right">{previous[index]}</td>
              <td className="px-2 py-2 text-right">{next[index]}</td>
              <td className="px-2 py-2 text-right text-muted-foreground">{next[index] - previous[index] > 0 ? "+" : ""}{next[index] - previous[index]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
