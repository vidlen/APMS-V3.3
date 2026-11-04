// src/config/texture.ts
// Ambang, kelas tampilan, dan warna tab Macrotexture ada di berkas ini saja.
//
// Ambang FAA AC 150/5320-12C par. 3-23b (existing pavements), rata-rata texture depth per runway zone:
//   (1) < 1.14 mm: ukur texture depth setiap survei friction
//   (2) < 0.76 mm tetapi > 0.40 mm: rencanakan perbaikan dalam satu tahun
//   (3) < 0.25 mm: perbaiki dalam 2 bulan
// Rentang 0.25–0.40 mm tidak disebut AC; ditampilkan sebagai "gap", bukan diberi tindakan.
// par. 3-24: kedalaman groove tidak pernah ikut diukur. Cocokkan nomor halaman dengan salinan AC sebelum dikutip di naskah.
import type { RunwayId } from "../types/skid.ts";

export const TEXTURE_LEVELS_MM = { measure: 1.14, plan: 0.76, gapUpper: 0.4, correct: 0.25 } as const;
// ASTM E1845 pers. 1: ETD = 0.2 + 0.8·MPD (mm).
export const ETD_A = 0.2;
export const ETD_B = 0.8;
export const TEXTURE_KEEL_HALF_WIDTH_M = 6; // KEPUTUSAN penelitian; diterapkan di paket MATLAB, web hanya mencatat
export const TEXTURE_HIGH_MPD_MM = 2.0;
export const TEXTURE_LANE_MIN_N = 20;
// KEPUTUSAN penelitian (skema SKG, 2 Nov 2026): K tingkat Minimum dan tingkat Perencanaan dari tekstur.
export const TEXTURE_K_MINIMUM_MM = 0.4;
export const TEXTURE_K_PLANNING_MM = 0.76;
// KEPUTUSAN tampilan (bukan kelas FAA): batas bawah inklusif.
export const TEXTURE_DISPLAY_BANDS = [0.85, 0.95, 1.05] as const;
export const TEXTURE_UNIT_COUNT: Record<RunwayId, number> = { "06-24": 300, "07L-25R": 360 };

export type TextureFaaLevel = "ok" | "measure" | "plan" | "gap" | "correct";
export type TextureClass = "ok" | "d4" | "d3" | "d2" | "d1" | "plan" | "gap" | "correct" | "noData";

export const TEXTURE_CLASSES: TextureClass[] = ["ok", "d4", "d3", "d2", "d1", "plan", "gap", "correct", "noData"];

export const etdFromMpd = (mpd: number): number => ETD_A + ETD_B * mpd;

/** Tingkat FAA dari ETD. Batas bawah inklusif, jadi 0,40 masih `plan` dan 0,25 masih `gap`. */
export function faaLevel(etd: number): TextureFaaLevel {
  if (etd >= TEXTURE_LEVELS_MM.measure) return "ok";
  if (etd >= TEXTURE_LEVELS_MM.plan) return "measure";
  if (etd >= TEXTURE_LEVELS_MM.gapUpper) return "plan";
  if (etd >= TEXTURE_LEVELS_MM.correct) return "gap";
  return "correct";
}

/** Kelas warna peta. Hanya rentang `measure` (0,76–1,14) yang dipecah jadi pita tampilan d1..d4. */
export function classifyTexture(etd: number | null): TextureClass {
  if (etd === null || Number.isNaN(etd)) return "noData";
  const level = faaLevel(etd);
  if (level !== "measure") return level;
  const i = TEXTURE_DISPLAY_BANDS.findIndex((lower) => etd < lower);
  return (["d1", "d2", "d3"] as const)[i] ?? "d4";
}

// Ramp cokelat sengaja berbeda dari skala PCI, ungu skid, dan teal BBI. Merah muda–merah tua disisakan untuk tingkat
// FAA di bawah 0,76. Kontras teks di atas warna isi ≥ 4,5:1 (diuji di texture.test.ts); noData memakai warna teks tema.
export const TEXTURE_CLASS_META: Record<TextureClass, { label: string; color: string; text: string }> = {
  ok: { label: "≥ 1.14 mm", color: "#5C3A1A", text: "#FFFFFF" },
  d4: { label: "1.05 – < 1.14", color: "#8B5E34", text: "#FFFFFF" },
  d3: { label: "0.95 – < 1.05", color: "#B9875A", text: "#1E1309" },
  d2: { label: "0.85 – < 0.95", color: "#DDB98F", text: "#2B1D0E" },
  d1: { label: "0.76 – < 0.85", color: "#F2E3CC", text: "#2B1D0E" },
  plan: { label: "< 0.76 mm (plan correction)", color: "#C2185B", text: "#FFFFFF" },
  gap: { label: "0.25 – < 0.40 mm (no action stated)", color: "#880E4F", text: "#FFFFFF" },
  correct: { label: "< 0.25 mm (correct within 2 months)", color: "#4A0626", text: "#FFFFFF" },
  noData: { label: "No keel values", color: "rgba(140,140,140,0.25)", text: "hsl(var(--foreground))" },
};

export const TEXTURE_FAA_TEXT: Record<TextureFaaLevel, string> = {
  ok: "At or above 1.14 mm",
  measure: "Below 1.14 mm: measure texture depth at every friction survey (3-23b(1))",
  plan: "Below 0.76 mm: plan correction within a year (3-23b(2))",
  gap: "0.25–0.40 mm: between 3-23b(2) and (3); the AC states no action",
  correct: "Below 0.25 mm: correct within 2 months (3-23b(3))",
};

export const TEXTURE_SERIES = { keel: "#8B5E34", full: "#8C8C8C", zone: "#5C3A1A", zoneOpacity: 0.35 } as const;

export const TEXTURE_THRESHOLD_LINES: { y: number; label: string; color: string; dash?: string }[] = [
  { y: 1.14, label: "1.14 mm: measure with friction surveys", color: "#5F5E5A", dash: "2 4" },
  { y: 0.76, label: "0.76 mm: plan correction", color: "#C2185B", dash: "6 4" },
  { y: 0.4, label: "0.40 mm", color: "#880E4F", dash: "2 2" },
  { y: 0.25, label: "0.25 mm: correct within 2 months", color: "#4A0626" },
];
