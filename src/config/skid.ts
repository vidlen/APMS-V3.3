// src/config/skid.ts
// Semua ambang, warna, dan aturan kelas ada di berkas ini saja.
// Sumber: FAA AC 150/5320-12C (18 Mar 1997, masih berlaku; Change 9 tgl 29 Mei 2025 hanya memperbarui
// daftar alat di Lampiran 4 dan kini mencantumkan "Moventor Oy Skiddometer BV11").
import type { LaneCode, SkidBasis } from "../types/skid.ts";

// Tabel 3-2, baris "Airport Equipment Co. Skiddometer" (BV-11), 40 mph = 65 km/j.
export const SKID_THRESHOLDS = { minimum: 0.5, maintenancePlanning: 0.6, newDesign: 0.82 } as const;
// Tabel 3-2, 60 mph = 95 km/j. Hanya referensi: survei Juni 2026 tidak punya data 95 km/j.
export const SKID_THRESHOLDS_95KMH = { minimum: 0.34, maintenancePlanning: 0.47, newDesign: 0.74 } as const;

// Par. 3-20 dan Lampiran 3 par. 1.a(3): penilaian memakai rata-rata segmen 500 ft (152,4 m).
export const DEFAULT_SKID_BASIS: SkidBasis = "10m"; // KEPUTUSAN pemilik (26 Okt 2026): tampilan hanya 10 m, tombol Basis dihapus
export const SKID_SEGMENT_M = 152.4;
// Lampiran 3 par. 1.a(5): rata-rata tiap segmen 500 ft harus berulang dalam ±0,06 (2 simpangan baku).
export const SKID_REPEATABILITY_MU = 0.06;
// Lampiran 3 par. 1.a(7) dan 1.b(1): kecepatan uji 65 km/j dengan toleransi ±5 km/j.
export const SKID_SPEED = { target: 65, tol: 5 } as const;
// Par. 3-20.c: "... and the adjacent 500 foot (152 m) segments are below the Maintenance Planning Friction Level".
// "all" = semua segmen tetangga harus < 0,60 (bacaan harfiah); "any" = cukup satu tetangga. KEPUTUSAN — lihat brief §11.
export const FAA_320_ADJACENT: "all" | "any" = "all";

export const LANE_ORDER: LaneCode[] = ["L6.0", "L4.5", "L3.0", "L1.5", "R1.5", "R3.0", "R4.5", "R6.0"];

// Warna garis per lajur untuk mode "Compare". Warna = jarak dari CL (palet Okabe–Ito, ramah buta warna),
// garis penuh = kiri, putus-putus = kanan. Sengaja berbeda dari ramp ungu kelas.
export const LANE_STYLE: Record<LaneCode, { color: string; dash: string }> = {
  "L6.0": { color: "#CC79A7", dash: "" },
  "L4.5": { color: "#009E73", dash: "" },
  "L3.0": { color: "#D55E00", dash: "" },
  "L1.5": { color: "#0072B2", dash: "" },
  "R1.5": { color: "#0072B2", dash: "6 3" },
  "R3.0": { color: "#D55E00", dash: "6 3" },
  "R4.5": { color: "#009E73", dash: "6 3" },
  "R6.0": { color: "#CC79A7", dash: "6 3" },
};

// Par. 3-15.b: jalur survei FAA = 3 m dan 6 m di kanan CL searah pendaratan.
// Uji 2026 berjalan ke arah 06 / 07L, jadi untuk pendaratan searah uji jalurnya R3.0 + R6.0,
// dan untuk pendaratan arah sebaliknya (24 / 25R) jalurnya L3.0 + L6.0.
export const FAA_TRACKS: Record<"withTest" | "againstTest", LaneCode[]> = {
  withTest: ["R3.0", "R6.0"],
  againstTest: ["L3.0", "L6.0"],
};

export type SkidClass = "belowMinimum" | "belowMaintenance" | "aboveMaintenance" | "newDesign" | "noData";

export function classifySkid(mu: number | null): SkidClass {
  if (mu === null || Number.isNaN(mu)) return "noData";
  if (mu < SKID_THRESHOLDS.minimum) return "belowMinimum";
  if (mu < SKID_THRESHOLDS.maintenancePlanning) return "belowMaintenance";
  if (mu < SKID_THRESHOLDS.newDesign) return "aboveMaintenance";
  return "newDesign";
}

export const SKID_CLASS_META: Record<SkidClass, { label: string; color: string; text: string }> = {
  belowMinimum: { label: "Below minimum (< 0.50)", color: "#3C3489", text: "#FFFFFF" },
  belowMaintenance: { label: "Below maintenance planning (< 0.60)", color: "#7F77DD", text: "#FFFFFF" },
  aboveMaintenance: { label: "Above maintenance planning", color: "#AFA9EC", text: "#26215C" },
  newDesign: { label: "At new-design level (≥ 0.82)", color: "#EEEDFE", text: "#26215C" },
  noData: { label: "Not measured", color: "rgba(140,140,140,0.25)", text: "#444441" },
};

// Garis ambang FAA di semua grafik.
export const FAA_LINES = [
  { value: SKID_THRESHOLDS.minimum, label: "Minimum 0.50", color: "#3C3489", dash: "" },
  { value: SKID_THRESHOLDS.maintenancePlanning, label: "Maint. planning 0.60", color: "#7F77DD", dash: "6 4" },
  { value: SKID_THRESHOLDS.newDesign, label: "New design 0.82", color: "#5F5E5A", dash: "2 4" },
] as const;
