import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
          <AreaChart data={data} margin={{ top: 12, right: 16, left: 6, bottom: 8 }}>
            <CartesianGrid vertical={false} stroke="#334155" strokeDasharray="3 3" opacity={0.65} />
            <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fill: "#cbd5e1", fontSize: 12 }} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={42} tickFormatter={(value) => `${value}%`} tickLine={false} axisLine={false} tick={{ fill: "#cbd5e1", fontSize: 12 }} />
            <Tooltip
              contentStyle={{ backgroundColor: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)" }}
              labelStyle={{ color: "#111827", fontWeight: 600 }}
              itemStyle={{ fontWeight: 500 }}
              formatter={(value) => `${Number(value).toFixed(1)}%`}
              labelFormatter={(label) => `Year ${label}`}
            />
            {MARKOV_CLASS_LABELS.map((label) => <Area key={label} type="monotone" dataKey={label} stackId="class" stroke="#0f172a" strokeWidth={1.25} fill={colors[label]} fillOpacity={0.9} />)}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-muted-foreground sm:grid-cols-3 2xl:grid-cols-4">
        {MARKOV_CLASS_LABELS.map((label) => <span key={label} className="flex items-center gap-1.5 whitespace-nowrap"><span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colors[label] }} aria-hidden="true" />{label}</span>)}
      </div>
    </section>
  );
}
