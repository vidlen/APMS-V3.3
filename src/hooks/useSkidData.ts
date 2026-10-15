import { useEffect, useState } from "react";
import { loadJson, SkidRunwaySchema } from "@/lib/skid-schema";
import { SEED_SAMPLE_UNIT_SOURCES } from "@/lib/sample-units";
import type { GeoJSONFeatureCollection } from "@/lib/geojson-types";
import type { RunwayId, SkidRunwayData } from "@/types/skid";
import { RUNWAYS } from "@/components/skid/skid-ui";

export interface SkidRunwayBundle {
  data: SkidRunwayData;
  /** Sample-unit polygons of the 2026 seed file - the same file whose numbering
   *  test C (skid.test.ts) checks the skid JSON against. */
  units: GeoJSONFeatureCollection;
}

// Module-level cache: every consumer shares one fetch, and switching tabs
// never re-downloads or re-validates a file.
const cache = new Map<string, Promise<unknown>>();

/** Loads `load()` once per `key`. A null key means "not needed yet" (lazy loading). */
export function useCachedLoad<T>(key: string | null, load: () => Promise<T>) {
  const [result, setResult] = useState<{ key: string; data?: T; error?: string } | null>(null);

  useEffect(() => {
    if (!key) return;
    let live = true;
    let pending = cache.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = load();
      pending.catch(() => cache.delete(key));
      cache.set(key, pending);
    }
    pending.then(
      (data) => live && setResult({ key, data }),
      (e) => live && setResult({ key, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
    // `load` is a closure over `key`; keying on `key` alone is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const mine = result?.key === key ? result : null;
  return { data: mine?.data, error: mine?.error, loading: key !== null && !mine };
}

async function loadAll(): Promise<Record<RunwayId, SkidRunwayBundle>> {
  const entries = await Promise.all(
    RUNWAYS.map(async (rw) => {
      const unitsUrl = SEED_SAMPLE_UNIT_SOURCES["2026"][rw.unitKey];
      const [data, units] = await Promise.all([
        loadJson(`/data/skid-${rw.id}-2026.json`, SkidRunwaySchema),
        fetch(unitsUrl).then((res) => {
          if (!res.ok) throw new Error(`${unitsUrl}: HTTP ${res.status}`);
          return res.json() as Promise<GeoJSONFeatureCollection>;
        }),
      ]);
      return [rw.id, { data, units }] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<RunwayId, SkidRunwayBundle>;
}

/** Per-unit skid data and unit polygons for both runways, loaded once. */
export function useSkidData() {
  return useCachedLoad("skid-units", loadAll);
}
