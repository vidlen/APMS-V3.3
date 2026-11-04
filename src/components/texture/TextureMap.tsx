import { useCallback, useEffect, useRef } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import LineString from "ol/geom/LineString";
import type Polygon from "ol/geom/Polygon";
import { fromLonLat } from "ol/proj";
import { asArray } from "ol/color";
import { Style, Fill, Stroke } from "ol/style";
import { Zoom } from "ol/control";
import type { FeatureLike } from "ol/Feature";
import { TEXTURE_CLASS_META, classifyTexture } from "@/config/texture";
import type { TextureRunwayBundle } from "@/hooks/useTextureData";
import { thinHatchPattern } from "@/lib/hatch-pattern";
import { hasHighKeel, type TextureZoneChoice } from "@/lib/texture";
import { setHoverUnit, subscribeHoverUnit } from "./hover-store";
import { mmText } from "./texture-ui";
import "ol/ol.css";

interface TextureMapProps {
  bundle: TextureRunwayBundle;
  selectedUnit: number | null;
  zone: TextureZoneChoice;
  onSelect: (unit: number) => void;
}

const GEOJSON_OPTS = { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" };
const SELECTED_COLOR = "#FACC15";
const HOVER_COLOR = "#FFFFFF";
/** Units outside the zone picked in the table fade to this share of their colour. */
const OTHER_ZONE_ALPHA = 0.3;

/** Re-expresses any CSS colour at (its own alpha × mul). */
function withAlpha(color: string, mul: number): string {
  const [r, g, b, a] = asArray(color);
  return `rgba(${r},${g},${b},${a * mul})`;
}

/** The transverse edge of a unit polygon that faces the next unit: its two corners nearest that unit's centre. */
function facingEdge(a: Polygon, b: Polygon): number[][] {
  const [x, y] = b.getInteriorPoint().getCoordinates();
  const dist = (p: number[]) => Math.hypot(p[0] - x, p[1] - y);
  return a.getCoordinates()[0].slice(0, -1).sort((p, q) => dist(p) - dist(q)).slice(0, 2);
}

// Same basemap as the PCI map. Each sample-unit polygon is filled by the class of its keel ETD. No per-band
// layer: units are what FAA levels and the SKG scheme read.
export default function TextureMap({ bundle, selectedUnit, zone, onSelect }: TextureMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const unitLayerRef = useRef<VectorLayer | null>(null);

  const live = useRef({ onSelect });
  useEffect(() => {
    live.current = { onSelect };
  });

  const unitStyle = useCallback(
    (feature: FeatureLike) => {
      const u = bundle.data.units[Number(feature.getId()) - 1];
      const etd = u?.keel.etd_mm ?? null;
      const isSelected = selectedUnit === u?.unit;
      const covered = etd !== null;
      const mul = (covered ? 0.8 : 1) * (zone !== "all" && u?.zone !== zone ? OTHER_ZONE_ALPHA : 1);
      const base = new Style({
        zIndex: isSelected ? 10 : 0,
        fill: new Fill({ color: withAlpha(TEXTURE_CLASS_META[classifyTexture(etd)].color, mul) }),
        stroke: new Stroke({
          color: isSelected ? SELECTED_COLOR : "rgba(255,255,255,0.9)",
          width: isSelected ? 3 : covered ? 0.5 : 0.8,
          lineDash: covered || isSelected ? undefined : [4, 3],
        }),
      });
      const pattern = u && hasHighKeel(u) ? thinHatchPattern() : null;
      return pattern ? [base, new Style({ zIndex: isSelected ? 10 : 0, fill: new Fill({ color: pattern }) })] : base;
    },
    [bundle, selectedUnit, zone],
  );

  useEffect(() => {
    if (!mapRef.current) return;
    const features = new GeoJSON().readFeatures(bundle.polygons, GEOJSON_OPTS);
    const unitSource = new VectorSource({ features });
    const unitLayer = new VectorLayer({ source: unitSource });
    unitLayerRef.current = unitLayer;
    const byUnit = new Map(features.map((f) => [Number(f.getId()), f]));

    // A thin line across the runway between the FAA zones.
    const boundaries = bundle.data.zones.slice(0, -1).flatMap((z) => {
      const a = byUnit.get(z.units[1])?.getGeometry() as Polygon | undefined;
      const b = byUnit.get(z.units[1] + 1)?.getGeometry() as Polygon | undefined;
      return a && b ? [new Feature(new LineString(facingEdge(a, b)))] : [];
    });
    const boundaryLayer = new VectorLayer({
      source: new VectorSource({ features: boundaries }),
      zIndex: 50,
      style: new Style({ stroke: new Stroke({ color: "#FFFFFF", width: 1.5 }) }),
    });

    // Outline that follows the pointer over the charts (see hover-store.ts).
    const hoverSource = new VectorSource();
    const hoverLayer = new VectorLayer({
      source: hoverSource,
      zIndex: 100,
      style: new Style({ stroke: new Stroke({ color: HOVER_COLOR, width: 3 }), fill: new Fill({ color: "rgba(255,255,255,0.35)" }) }),
    });
    const unsubscribeHover = subscribeHoverUnit((unit) => {
      hoverSource.clear();
      const f = unit === null ? undefined : byUnit.get(unit);
      const g = f?.getGeometry();
      if (g) hoverSource.addFeature(new Feature(g));
    });

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
        boundaryLayer,
        hoverLayer,
      ],
      view: new View({ center: fromLonLat([106.66, -6.12]), zoom: 14, maxZoom: 19, minZoom: 11 }),
      controls: [new Zoom()],
    });
    const extent = unitSource.getExtent();
    if (extent) map.getView().fit(extent, { padding: [48, 48, 48, 48], maxZoom: 17 });

    const tooltipEl = document.createElement("div");
    tooltipEl.className = "map-tooltip";
    tooltipEl.style.display = "none";
    document.body.appendChild(tooltipEl);

    const hitAt = (pixel: number[]) => map.forEachFeatureAtPixel(pixel, (f) => f, { layerFilter: (l) => l === unitLayer, hitTolerance: 3 });

    map.on("click", (e) => {
      const f = hitAt(e.pixel);
      if (f) live.current.onSelect(Number(f.getId()));
    });

    let lastHover: number | null = null;
    const hover = (unit: number | null) => {
      if (unit !== lastHover) setHoverUnit(unit);
      lastHover = unit;
    };

    map.on("pointermove", (e) => {
      if (e.dragging) return;
      const f = hitAt(e.pixel);
      map.getViewport().style.cursor = f ? "pointer" : "";
      if (!f) {
        tooltipEl.style.display = "none";
        hover(null);
        return;
      }
      const unit = Number(f.getId());
      hover(unit);
      const u = bundle.data.units[unit - 1];
      const label = bundle.data.zones[(u?.zone ?? 1) - 1].label;
      tooltipEl.textContent = u?.keel.etd_mm != null ? `Unit ${unit} · keel ETD ${mmText(u.keel.etd_mm)} mm · zone ${u.zone} (${label})` : `Unit ${unit} · no keel values · zone ${u?.zone} (${label})`;
      const evt = e.originalEvent as PointerEvent;
      tooltipEl.style.display = "block";
      tooltipEl.style.left = evt.pageX + 12 + "px";
      tooltipEl.style.top = evt.pageY - 30 + "px";
    });

    // OpenLayers sends no move once the pointer has left the map, so the tooltip is hidden here.
    map.getViewport().addEventListener("pointerleave", () => {
      tooltipEl.style.display = "none";
      hover(null);
    });

    return () => {
      unsubscribeHover();
      map.setTarget(undefined);
      tooltipEl.remove();
    };
  }, [bundle]);

  useEffect(() => {
    unitLayerRef.current?.setStyle(unitStyle);
  }, [unitStyle]);

  return <div ref={mapRef} className="w-full h-full" />;
}
