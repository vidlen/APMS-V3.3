// src/lib/skid-geo.ts — geometri lajur di peta (EPSG:3857). Sengaja TIDAK mengimpor `ol`:
// `ol` tidak punya peta "exports", jadi `import "ol/proj"` gagal di node --test. Rumus Web Mercator cukup ditulis di sini.
import type { SkidUnit } from "../types/skid.ts";

const R = 6378137;

/** [lon, lat] → [x, y] EPSG:3857 (sama dengan fromLonLat di OpenLayers). */
export function toMercator(lonlat: readonly [number, number]): [number, number] {
  const [lon, lat] = lonlat;
  return [(R * lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
}

/** (stasiun, offset) → titik EPSG:3857. offset_m < 0 = kiri arah uji. */
export type StationProjector = (station: number, offset_m: number) => [number, number];

/** Garis tengah runway dibentuk dari centroid unit (di station_mid_m) dan diinterpolasi linear.
 *  Skala diambil dari jarak antarcentroid itu sendiri, jadi meter stasiun (proyeksi lokal pipeline)
 *  dan meter Web Mercator tidak tercampur. Satu garis lurus dengan faktor 1/cos(lat) saja
 *  meleset sampai ±4 m di ujung runway — terlalu besar untuk tampilan per meter. */
export function makeStationProjector(units: readonly SkidUnit[]): StationProjector {
  const nodes = [...units]
    .sort((a, b) => a.station_mid_m - b.station_mid_m)
    .map((u) => ({ s: u.station_mid_m, p: toMercator(u.centroid_lonlat) }));
  if (nodes.length < 2) throw new Error("makeStationProjector: need at least 2 units");
  return (station, offset_m) => {
    let lo = 0;
    let hi = nodes.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (nodes[mid].s <= station) lo = mid;
      else hi = mid - 1;
    }
    const a = nodes[lo];
    const b = nodes[lo + 1];
    const dx = b.p[0] - a.p[0];
    const dy = b.p[1] - a.p[1];
    const len = Math.hypot(dx, dy);
    const f = (station - a.s) / (b.s - a.s);
    const scale = len / (b.s - a.s); // meter Mercator per meter stasiun di titik ini
    const ux = -dx / len; // arah uji = menuju ambang 24 / 25R = stasiun mengecil
    const uy = -dy / len;
    const side = -offset_m * scale; // kiri arah uji = (-uy, ux)
    return [a.p[0] + f * dx - uy * side, a.p[1] + f * dy + ux * side];
  };
}

/** Garis satu lajur dari stasiun s1 ke s2 (misalnya batas unit, atau bacaan iFrom..iTo ± 0,5 m). */
export function laneLine(project: StationProjector, s1: number, s2: number, offset_m: number): [number, number][] {
  return [project(s1, offset_m), project(s2, offset_m)];
}
