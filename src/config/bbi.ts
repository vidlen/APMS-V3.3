// src/config/bbi.ts
// Batas, kelas tampilan, dan warna tab Roughness (BBI) ada di berkas ini saja.
// Sumber batas 1,0: FAA AC 150/5380-9 (nomor paragraf mengikuti README_BBI_RWY0624.md; cocokkan dengan salinan AC sebelum dikutip di naskah).
import type { BbiZone } from "../types/bbi.ts";
import type { RunwayId } from "../types/skid.ts";

export const BBI_LIMIT = 1.0;
export const BBI_START_OF_RUN_M = 120;
export const BBI_TRIMMED_END_M = 250;
export const BBI_UNIT_COUNT: Record<RunwayId, number> = { "06-24": 300, "07L-25R": 360 };
// s_akhir unit lama 300 di batas_unit_0624.csv. CSV web hanya memuat angka ini terbulatkan (stasiun + jarak = 2999,30).
export const BBI_AXIS_LENGTH_M: Partial<Record<RunwayId, number>> = { "06-24": 2999.304 };
// KEPUTUSAN tampilan (bukan kelas FAA): batas bawah inklusif; kelas terakhir di bawah batas memuat 1,0.
export const BBI_DISPLAY_BANDS = [0.2, 0.4, 0.6, 0.8] as const;

export type BbiClass = "b0" | "b1" | "b2" | "b3" | "b4" | "excessive" | "unacceptable" | "noData";

export const BBI_CLASSES: BbiClass[] = ["b0", "b1", "b2", "b3", "b4", "excessive", "unacceptable", "noData"];

/** Zona di atas batas FAA menang atas angka; `noData` hanya untuk unit tidak tercakup. */
export function classifyBbi(bbi: number | null, zone: BbiZone | null): BbiClass {
  if (zone === "Excessive") return "excessive";
  if (zone === "Unacceptable") return "unacceptable";
  if (bbi === null || Number.isNaN(bbi)) return "noData";
  const i = BBI_DISPLAY_BANDS.findIndex((lower) => bbi < lower);
  return (["b0", "b1", "b2", "b3"] as const)[i] ?? "b4";
}

// Ramp teal sengaja berbeda dari skala PCI dan dari ungu skid; oranye/merah disisakan untuk zona di atas batas FAA.
// Teks b3 dan excessive digelapkan dari brief §9 (putih hanya 3,1:1 dan 3,6:1); noData memakai warna teks tema
// supaya terbaca di latar terang maupun gelap. Semua di atas 4,5:1 (diuji di bbi.test.ts).
export const BBI_CLASS_META: Record<BbiClass, { label: string; color: string; text: string }> = {
  b0: { label: "< 0.2", color: "#F1EFE8", text: "#2C2C2A" },
  b1: { label: "0.2 – < 0.4", color: "#D3E4E1", text: "#1F3B37" },
  b2: { label: "0.4 – < 0.6", color: "#9CC5BE", text: "#1F3B37" },
  b3: { label: "0.6 – < 0.8", color: "#5E9E95", text: "#0B1F1C" },
  b4: { label: "0.8 – 1.0", color: "#2F6F67", text: "#FFFFFF" },
  excessive: { label: "Excessive", color: "#E8590C", text: "#1A0A00" },
  unacceptable: { label: "Unacceptable", color: "#9B1C1C", text: "#FFFFFF" },
  noData: { label: "Not covered", color: "rgba(140,140,140,0.25)", text: "hsl(var(--foreground))" },
};

// Warna per lintasan (palet Okabe–Ito, ramah buta warna). Sisi L garis penuh, sisi R putus-putus.
export const BBI_PASS_COLOR: Record<number, string> = { 1: "#0072B2", 2: "#D55E00", 3: "#009E73", 5: "#CC79A7" };
export const BBI_OTHER_PASS_COLOR = "#5F5E5A";
export const BBI_R_DASH = "6 3";
