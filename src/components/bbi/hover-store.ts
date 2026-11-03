type Listener = (unit: number | null) => void;

// A plain subscription instead of React state: hover fires many times a second and only
// the map highlight cares, so the rest of the tab must not re-render for it.
const listeners = new Set<Listener>();

export const setHoverUnit = (unit: number | null): void => listeners.forEach((l) => l(unit));

export function subscribeHoverUnit(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
