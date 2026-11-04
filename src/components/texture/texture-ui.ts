import type { TextureClass } from "@/config/texture";
import type { RunwayId } from "@/types/skid";

export interface TextureRunwayMeta {
  id: RunwayId;
  label: string;
  /** Threshold at x = 0 on the chart axis, and the far one. */
  startEnd: string;
  farEnd: string;
}

export const TEXTURE_RUNWAYS: TextureRunwayMeta[] = [
  { id: "06-24", label: "RWY 06/24", startEnd: "06", farEnd: "24" },
  { id: "07L-25R", label: "RWY 07L/25R", startEnd: "07L", farEnd: "25R" },
];

/** Visible x range [from, to] in metres from the start threshold; null = whole runway. */
export type XDomain = [number, number] | null;

export const fmtInt = (n: number): string => Math.round(n).toLocaleString("en-US");
export const fmtX = (n: number): string => n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const mmText = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : v.toFixed(3));

/** "+15.67", "−3.20", "0.00" */
export const offsetText = (v: number, digits = 2): string => (v === 0 ? (0).toFixed(digits) : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`);

/** "…_002987.jpg" from an LCMS image name. */
export const shortImage = (image: string): string => {
  const i = image.lastIndexOf("_");
  return i < 0 ? image : `…${image.slice(i)}`;
};

/** Band of a unit's keel ETD in words; only the zone average is an FAA verdict. */
const BAND_TEXT: Record<Exclude<TextureClass, "noData">, string> = {
  ok: "At or above 1.14 mm",
  d4: "1.05 – < 1.14 mm",
  d3: "0.95 – < 1.05 mm",
  d2: "0.85 – < 0.95 mm",
  d1: "0.76 – < 0.85 mm",
  plan: "Below 0.76 mm",
  gap: "0.25 – < 0.40 mm",
  correct: "Below 0.25 mm",
};
export const unitBandText = (cls: Exclude<TextureClass, "noData">): string => `${BAND_TEXT[cls]} (display band; FAA judges the zone average)`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "28 Jun 2026" from "2026-06-28". */
export function dateText(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
