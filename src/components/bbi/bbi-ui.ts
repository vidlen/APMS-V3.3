import { BBI_OTHER_PASS_COLOR, BBI_PASS_COLOR, BBI_R_DASH } from "@/config/bbi";
import type { BbiLineMeta } from "@/types/bbi";
import type { RunwayId } from "@/types/skid";

export interface BbiRunwayMeta {
  id: RunwayId;
  label: string;
  /** Threshold at x = 0 on the profile axis, and the far one. */
  startEnd: string;
  farEnd: string;
}

export const BBI_RUNWAYS: BbiRunwayMeta[] = [
  { id: "06-24", label: "RWY 06/24", startEnd: "06", farEnd: "24" },
  { id: "07L-25R", label: "RWY 07L/25R", startEnd: "07L", farEnd: "25R" },
];

export const NO_07L_HINT = "No BBI for RWY 07L/25R: the ERD profile was exported at 1 m spacing; BBI needs the 0.25 m profile.";
export const START_OF_RUN_HINT = "First 120 m of the run: 120 m straightedge not yet complete";

/** Visible x range [from, to] in metres from the start threshold; null = whole runway. */
export type XDomain = [number, number] | null;

export const fmtInt = (n: number): string => Math.round(n).toLocaleString("en-US");
export const fmtX = (n: number): string => n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const bbiText = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : v.toFixed(3));

/** "0.0", "+5.4", "−3.6" */
export const offsetText = (v: number): string => (v === 0 ? "0.0" : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`);

/** Colour = pass, dash = side (L solid, R dashed). */
export const lineStyle = (m: BbiLineMeta): { color: string; dash: string | undefined } => ({
  color: BBI_PASS_COLOR[m.pass] ?? BBI_OTHER_PASS_COLOR,
  dash: m.side === "R" ? BBI_R_DASH : undefined,
});

/** The line on the other side of the same pass. */
export const mirrorLine = (code: string): string => `${code.slice(0, -1)}${code.endsWith("L") ? "R" : "L"}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "28 Jun 2026" from "2026-06-28". */
export function dateText(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** ["1–3", "298–300"] -> "1–3 and 298–300" */
export function joinRanges(parts: string[]): string {
  if (parts.length < 2) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
