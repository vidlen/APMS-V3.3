import type { MarkovVariant } from "@/lib/markov";

const OPTIONS: { value: MarkovVariant; label: string; description: string }[] = [
  { value: "n8", label: "Monotonic, n=8", description: "Uses monotonic frequencies without an added prior." },
  { value: "dirichlet", label: "Dirichlet α=2", description: "Adds a 0.5/0.5 prior to stay and one-class deterioration." },
];

interface VariantToggleProps {
  value: MarkovVariant;
  onChange: (value: MarkovVariant) => void;
}

export default function VariantToggle({ value, onChange }: VariantToggleProps) {
  return (
    <div className="inline-flex max-w-full rounded-md border border-border bg-muted/40 p-1" role="group" aria-label="Markov projection variant">
      {OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            title={option.description}
            onClick={() => onChange(option.value)}
            className={`min-h-10 rounded px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              selected ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
