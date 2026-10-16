import type { RunwayId } from "@/types/skid";

/** A point the pointer is over in the profile or per-metre heatmap: station along the runway axis
 *  (m from the outer edge of unit 1) and the lane's nominal lateral offset (m, negative = left). */
export interface HoverPoint {
  runway: RunwayId;
  station: number;
  offset: number;
}

type Listener = (p: HoverPoint | null) => void;

// A plain subscription instead of React state: hover fires many times a second and only
// the map marker cares, so the rest of the tab must not re-render for it.
const listeners = new Set<Listener>();

export const setHover = (p: HoverPoint | null): void => listeners.forEach((l) => l(p));

export function subscribeHover(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
