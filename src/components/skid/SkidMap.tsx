import { useCallback, useEffect, useMemo, useRef } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import LineString from "ol/geom/LineString";
import { fromLonLat } from "ol/proj";
import { asArray } from "ol/color";
import { createEmpty, extend, type Extent } from "ol/extent";
import { Style, Fill, Stroke } from "ol/style";
import { Zoom } from "ol/control";
import type { FeatureLike } from "ol/Feature";
import { classifySkid, SKID_CLASS_META } from "@/config/skid";
import { governingFor, laneMu, unitStationRange } from "@/lib/skid";
import { laneLine, makeStationProjector } from "@/lib/skid-geo";
import type { RunwayId, SkidBasis, SkidUnit } from "@/types/skid";
import type { SkidRunwayBundle } from "@/hooks/useSkidData";
import { BASIS_LABEL, RUNWAYS, RUNWAY_BY_ID, muText, type MapLanes, type SelectedUnit } from "./skid-ui";
import "ol/ol.css";

interface SkidMapProps {
  bundles: Record<RunwayId, SkidRunwayBundle>;
  runway: RunwayId;
  basis: SkidBasis;
  selected: SelectedUnit | null;
  mapLanes: MapLanes;
  onSelect: (runway: RunwayId, unit: number) => void;
}

const GEOJSON_OPTS = { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" };
const SELECTED_COLOR = "#FACC15";

/** Re-expresses any CSS colour at (its own alpha × mul). */
function withAlpha(color: string, mul: number): string {
  const [r, g, b, a] = asArray(color);
  return `rgba(${r},${g},${b},${a * mul})`;
}

// Skid-resistance map: same basemap and view as the PCI map; sample units are
// filled by the governing-lane class, optionally with one coloured line per
// lane over the units.
export default function SkidMap({ bundles, runway, basis, selected, mapLanes, onSelect }: SkidMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<OlMap | null>(null);
  const unitLayerRef = useRef<VectorLayer | null>(null);
  const laneSourceRef = useRef<VectorSource | null>(null);
  const extentsRef = useRef<Partial<Record<RunwayId, Extent>>>({});

  const unitsByRw = useMemo(
    () =>
      Object.fromEntries(
        RUNWAYS.map((r) => [r.id, new Map(bundles[r.id].data.units.map((u) => [u.unit, u]))]),
      ) as Record<RunwayId, Map<number, SkidUnit>>,
    [bundles],
  );

  // The pointer handlers are bound once; they read the latest props from here.
  const live = useRef({ unitsByRw, basis, onSelect });
  useEffect(() => {
    live.current = { unitsByRw, basis, onSelect };
  });

  const unitStyle = useCallback(
    (feature: FeatureLike) => {
      const rw = feature.get("rw") as RunwayId;
      const unit = feature.get("sampleUnit") as number;
      const u = unitsByRw[rw].get(unit);
      const cls = classifySkid(u ? (governingFor(u, basis)?.mu ?? null) : null);
      const dim = rw === runway ? 1 : 0.4;
      const isSelected = selected?.runway === rw && selected.unit === unit;
      const measured = cls !== "noData";
      return new Style({
        zIndex: isSelected ? 10 : 0,
        fill: new Fill({
          color: withAlpha(SKID_CLASS_META[cls].color, (measured ? (mapLanes !== "off" ? 0.25 : 0.75) : 1) * dim),
        }),
        stroke: new Stroke({
          color: isSelected ? SELECTED_COLOR : `rgba(255,255,255,${dim})`,
          width: isSelected ? 3 : measured ? 0.5 : 0.8,
          lineDash: measured || isSelected ? undefined : [4, 3],
        }),
      });
    },
    [unitsByRw, basis, runway, selected, mapLanes],
  );

  useEffect(() => {
    if (!mapRef.current) return;
    const unitSource = new VectorSource();
    const unitLayer = new VectorLayer({ source: unitSource });
    const laneSource = new VectorSource();
    const laneLayer = new VectorLayer({
      source: laneSource,
      // A dark casing keeps the pale classes readable on the satellite imagery.
      style: (feature, resolution) => {
        const width = Math.max(2, 1.2 / resolution);
        return [
          new Style({ stroke: new Stroke({ color: "rgba(0,0,0,0.55)", width: width + 1.5 }) }),
          new Style({ stroke: new Stroke({ color: SKID_CLASS_META[feature.get("cls") as keyof typeof SKID_CLASS_META].color, width }) }),
        ];
      },
    });
    unitLayerRef.current = unitLayer;
    laneSourceRef.current = laneSource;

    const all = createEmpty();
    for (const rw of RUNWAYS) {
      const features = new GeoJSON().readFeatures(bundles[rw.id].units, GEOJSON_OPTS);
      const ext = createEmpty();
      for (const f of features) {
        f.set("rw", rw.id);
        // Both unit files number their features 1..N; a shared VectorSource silently drops id collisions.
        f.setId(undefined);
        const g = f.getGeometry();
        if (g) extend(ext, g.getExtent());
      }
      extentsRef.current[rw.id] = ext;
      extend(all, ext);
      unitSource.addFeatures(features);
    }

    const map = new OlMap({
      target: mapRef.current,
      layers: [
        new TileLayer({
          source: new XYZ({
            url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
            attributions: "Google Satellite",
          }),
        }),
        unitLayer,
        laneLayer,
      ],
      view: new View({ center: fromLonLat([106.66, -6.12]), zoom: 14, maxZoom: 19, minZoom: 11 }),
      controls: [new Zoom()],
    });
    map.getView().fit(all, { padding: [48, 48, 48, 48], maxZoom: 17 });
    mapInstance.current = map;

    const tooltipEl = document.createElement("div");
    tooltipEl.className = "map-tooltip";
    tooltipEl.style.display = "none";
    document.body.appendChild(tooltipEl);

    // Lane lines sit above the unit polygons, so a line hit wins over the unit.
    const hitAt = (pixel: number[]) =>
      map.forEachFeatureAtPixel(pixel, (f) => f, { hitTolerance: 3 }) as Feature | undefined;

    map.on("click", (e) => {
      const f = hitAt(e.pixel);
      if (!f) return;
      live.current.onSelect(f.get("rw") as RunwayId, (f.get("unit") ?? f.get("sampleUnit")) as number);
    });

    map.on("pointermove", (e) => {
      if (e.dragging) return;
      const f = hitAt(e.pixel);
      map.getViewport().style.cursor = f ? "pointer" : "";
      if (!f) {
        tooltipEl.style.display = "none";
        return;
      }
      const rw = f.get("rw") as RunwayId;
      const label = RUNWAY_BY_ID[rw].label;
      const { unitsByRw: byRw, basis: b } = live.current;
      if (f.get("lane")) {
        tooltipEl.textContent = `${label} · ${f.get("lane")} · Unit ${f.get("unit")} — μ ${muText(f.get("mu") as number)} (${BASIS_LABEL[b]} basis)`;
      } else {
        const unit = f.get("sampleUnit") as number;
        const u = byRw[rw].get(unit);
        const g = u ? governingFor(u, b) : null;
        tooltipEl.textContent = g
          ? `${label} · Unit ${unit} — μ ${muText(g.mu)} (${g.lane}) · ${BASIS_LABEL[b]} basis`
          : `${label} · Unit ${unit} — not measured`;
      }
      const evt = e.originalEvent as PointerEvent;
      tooltipEl.style.display = "block";
      tooltipEl.style.left = evt.pageX + 12 + "px";
      tooltipEl.style.top = evt.pageY - 30 + "px";
    });

    return () => {
      map.setTarget(undefined);
      tooltipEl.remove();
    };
    // bundles never change after the first load.
  }, [bundles]);

  useEffect(() => {
    unitLayerRef.current?.setStyle(unitStyle);
  }, [unitStyle]);

  // One line per lane per unit for the active runway, coloured by that lane's class.
  useEffect(() => {
    const source = laneSourceRef.current;
    if (!source) return;
    source.clear();
    if (mapLanes !== "unit") return;
    const { units } = bundles[runway].data;
    const project = makeStationProjector(units);
    const features: Feature[] = [];
    for (const u of units) {
      if (!u.lanes_measured) continue;
      const [s1, s2] = unitStationRange(units, u.unit);
      for (const lane of u.lanes) {
        const mu = laneMu(lane, basis);
        if (mu === null) continue;
        features.push(
          new Feature({
            geometry: new LineString(laneLine(project, s1, s2, lane.offset_m)),
            rw: runway,
            unit: u.unit,
            lane: lane.lane,
            mu,
            cls: classifySkid(mu),
          }),
        );
      }
    }
    source.addFeatures(features);
  }, [bundles, runway, basis, mapLanes]);

  const zoomTo = (rw: RunwayId) => {
    const ext = extentsRef.current[rw];
    if (ext) mapInstance.current?.getView().fit(ext, { padding: [48, 48, 48, 48], maxZoom: 17, duration: 300 });
  };

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="w-full h-full" />
      <div className="absolute top-3 right-3 z-10 flex flex-wrap justify-end gap-1.5">
        {RUNWAYS.map((r) => (
          <button
            key={r.id}
            onClick={() => zoomTo(r.id)}
            className="panel-surface h-8 px-3 rounded-md text-xs font-medium text-primary hover:bg-secondary transition-colors"
          >
            Zoom to {r.id.replace("-", "/")}
          </button>
        ))}
      </div>
    </div>
  );
}
