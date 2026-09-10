import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MarkovProjection, MarkovVariant } from "@/lib/markov";

interface ProjectionChartProps {
  n8: MarkovProjection[];
  dirichlet: MarkovProjection[];
  activeVariant: MarkovVariant;
}

export default function ProjectionChart({ n8, dirichlet, activeVariant }: ProjectionChartProps) {
  const data = n8.map((row, index) => ({ year: row.year, n8: row.pci, dirichlet: dirichlet[index]?.pci }));
  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <h3 className="font-condensed text-base font-semibold text-foreground">PCI by year</h3>
      <p className="mt-1 text-xs text-muted-foreground">Both variants are shown together. The active line is emphasized; the dashed line marks the PCI 70 reference.</p>
      <div className="mt-4 h-72" role="img" aria-label="PCI projection chart from 2026 to 2031 for two Markov variants">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 16, left: 2, bottom: 8 }}>
            <CartesianGrid vertical={false} stroke="#334155" strokeDasharray="3 3" opacity={0.65} />
            <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fill: "#cbd5e1", fontSize: 12 }} />
            <YAxis domain={[70, 92]} width={38} tickLine={false} axisLine={false} tick={{ fill: "#cbd5e1", fontSize: 12 }} />
            <Tooltip
              contentStyle={{ backgroundColor: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)" }}
              labelStyle={{ color: "#111827", fontWeight: 600 }}
              itemStyle={{ fontWeight: 500 }}
              formatter={(value) => Number(value).toFixed(2)}
              labelFormatter={(label) => `Year ${label}`}
            />
            <ReferenceLine y={70} stroke="#94a3b8" strokeDasharray="4 4" opacity={0.7} />
            <Line type="monotone" dataKey="n8" name="Monotonic, n=8" stroke="#1d4ed8" strokeWidth={activeVariant === "n8" ? 3 : 1.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="dirichlet" name="Dirichlet α=2" stroke="#b45309" strokeWidth={activeVariant === "dirichlet" ? 3 : 1.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
