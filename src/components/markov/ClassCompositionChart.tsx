import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MARKOV_CLASS_LABELS } from "@/config/markovParams";
import { pciCategories } from "@/lib/pci-utils";
import type { MarkovProjection } from "@/lib/markov";

const colors = Object.fromEntries(pciCategories.map((category) => [category.label, category.color]));

export default function ClassCompositionChart({ projection }: { projection: MarkovProjection[] }) {
  const data = projection.map((row) => Object.fromEntries([["year", row.year], ...MARKOV_CLASS_LABELS.map((label, index) => [label, row.classShare[index] * 100])]));
  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <h3 className="font-condensed text-base font-semibold text-foreground">Class composition by year</h3>
      <p className="mt-1 text-xs text-muted-foreground">The seven condition-class shares for the active variant.</p>
      <div className="mt-4 h-72" role="img" aria-label="Stacked area chart of condition-class composition from 2026 to 2031">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 12, right: 12, left: -18, bottom: 4 }}>
            <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
            <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(value) => `${Number(value).toFixed(1)}%`} labelFormatter={(label) => `Year ${label}`} />
            {MARKOV_CLASS_LABELS.map((label) => <Area key={label} type="monotone" dataKey={label} stackId="class" stroke={colors[label]} fill={colors[label]} fillOpacity={0.8} />)}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
        {MARKOV_CLASS_LABELS.map((label) => <span key={label}><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: colors[label] }} aria-hidden="true" />{label}</span>)}
      </div>
    </section>
  );
}
