import { MARKOV_CLASS_LABELS } from "@/config/markovParams";
import type { MarkovVariant, Matrix7 } from "@/lib/markov";

interface TransitionMatrixPanelProps {
  nRaw: Matrix7;
  nMonotone: Matrix7;
  tpm: Matrix7;
  variant: MarkovVariant;
}

function MatrixTable({ title, matrix, highlight, probability = false, variant, nSource }: { title: string; matrix: Matrix7; highlight?: Matrix7; probability?: boolean; variant?: MarkovVariant; nSource?: Matrix7 }) {
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <table className="min-w-[760px] w-full text-[11px] tabular-nums">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th className="px-2 py-2 text-left font-medium">Source</th>
            {MARKOV_CLASS_LABELS.map((label) => <th key={label} className="px-2 py-2 text-right font-medium">{label}</th>)}
            <th className="px-2 py-2 text-right font-medium">n</th>
            {probability && <th className="px-2 py-2 text-left font-medium">Notes</th>}
          </tr>
        </thead>
        <tbody>
          {MARKOV_CLASS_LABELS.map((label, rowIndex) => {
            const n = (nSource?.[rowIndex] ?? matrix[rowIndex]).reduce((sum, value) => sum + value, 0);
            const description = !probability ? "" : rowIndex === 6
              ? "absorbing"
              : n === 0
                ? variant === "dirichlet" ? "prior-driven, n=0" : "fill probability, n=0"
                : variant === "dirichlet" ? `Dirichlet + observed, n=${n}` : `observed, n=${n}`;
            return (
              <tr key={label} className="border-b border-border/60 last:border-0">
                <th className="px-2 py-2 text-left font-medium text-foreground">{label}</th>
                {matrix[rowIndex].map((value, columnIndex) => {
                  const moved = highlight && Math.abs(value - highlight[rowIndex][columnIndex]) > 1e-9;
                  return <td key={columnIndex} className={`px-2 py-2 text-right ${moved ? "bg-amber-500/15 font-semibold text-foreground" : ""}`}>{probability ? value.toFixed(4) : value}</td>;
                })}
                <td className="px-2 py-2 text-right text-muted-foreground">{n}</td>
                {probability && <td className="px-2 py-2 text-muted-foreground">{description}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function TransitionMatrixPanel({ nRaw, nMonotone, tpm, variant }: TransitionMatrixPanelProps) {
  return (
    <div className="space-y-6">
      <MatrixTable title="Raw N matrix" matrix={nRaw} />
      <div>
        <MatrixTable title="Monotonic N matrix (changed cells highlighted)" matrix={nMonotone} highlight={nRaw} />
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Transitions into a better class are moved to the source-class diagonal before the TPM is calculated.</p>
      </div>
      <MatrixTable title={`Active TPM — ${variant === "n8" ? "Monotonic, n=8" : "Dirichlet α=2"}`} matrix={tpm} probability variant={variant} nSource={nMonotone} />
    </div>
  );
}
