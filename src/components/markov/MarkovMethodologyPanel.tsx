export default function MarkovMethodologyPanel() {
  return (
    <div className="space-y-3 text-xs leading-relaxed text-muted-foreground">
      <p>Rows show the 2025 source class and columns show the 2026 destination class. Every TPM row sums to one.</p>
      <p>Monotonisation moves transitions into a better class to the diagonal. Rows without observations use a fill probability in the monotonic variant and a 0.5/0.5 prior in the Dirichlet variant.</p>
      <p>Projected PCI is the weighted average of class midpoints plus an offset that aligns the 2026 anchor year with the unit PCI average.</p>
    </div>
  );
}
