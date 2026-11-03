import { useCallback, useEffect, useRef } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import { fromLonLat } from "ol/proj";
import { asArray } from "ol/color";
import { Style, Fill, Stroke } from "ol/style";
import { Zoom } from "ol/control";
import type { FeatureLike } from "ol/Feature";
import { BBI_CLASS_META, classifyBbi } from "@/config/bbi";
import type { BbiRunwayBundle } from "@/hooks/useBbiData";
import { subscribeHoverUnit } from "./hover-store";
import { bbiText } from "./bbi-ui";
import "ol/ol.css";

interface BbiMapProps {
  bundle: BbiRunwayBundle;
  selectedUnit: number | null;
  onSelect: (unit: number) => void;
}

const GEOJSON_OPTS = { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" };
const SELECTED_COLOR = "#FACC15";
const HOVER_COLOR = "#FFFFFF";

/** Re-expresses any CSS colour at (its own alpha × mul). */
function withAlpha(color: string, mul: number): string {
  const [r, g, b, a] = asArray(color);
  return `rgba(${r},${g},${b},${a * mul})`;
}

let hatch: CanvasPattern | null | undefined;
/** Thin screen-space hatch over a unit whose governing value lies in the first 120 m of a run. */
function startOfRunHatch(): CanvasPattern | null {
  if (hatch !== undefined) return hatch;
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext("2d");
  if (!ctx) return (hatch = null);
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 8);
  ctx.lineTo(8, 0);
  ctx.moveTo(-2, 2);
  ctx.lineTo(2, -2);
  ctx.moveTo(6, 10);
  ctx.lineTo(10, 6);
  ctx.stroke();
  return (hatch = ctx.createPattern(canvas, "repeat"));
}

// Same basemap as the PCI map. Each sample-unit polygon is filled by the class of its governing BBI. No per-line
// layer: the line offsets are still provisional, and each unit spans the full runway width.
export default function BbiMap({ bundle, selectedUnit, onSelect }: BbiMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const unitLayerRef = useRef<VectorLayer | null>(null);

  const live = useRef({ onSelect });
  useEffect(() => {
    live.current = { onSelect };
  });

  const unitStyle = useCallback(
    (feature: FeatureLike) => {
      const u = bundle.data.units[Number(feature.getId()) - 1];
      const g = u?.governing ?? null;
      const cls = classifyBbi(g?.bbi ?? null, g?.zone ?? null);
      const isSelected = selectedUnit === u?.unit;
      const covered = cls !== "noData";
      const base = new Style({
        zIndex: isSelected ? 10 : 0,
        fill: new Fill({ color: withAlpha(BBI_CLASS_META[cls].color, covered ? 0.8 : 1) }),
        stroke: new Stroke({
          color: isSelected ? SELECTED_COLOR : "rgba(255,255,255,0.9)",
          width: isSelected ? 3 : covered ? 0.5 : 0.8,
          lineDash: covered || isSelected ? undefined : [4, 3],
        }),
      });
      const pattern = g?.start_of_run ? startOfRunHatch() : null;
      return pattern ? [base, new Style({ zIndex: isSelected ? 10 : 0, fill: new Fill({ color: pattern }) })] : base;
    },
    [bundle, selectedUnit],
  );

  useEffect(() => {
    if (!mapRef.current) return;
    const features = new GeoJSON().readFeatures(bundle.polygons, GEOJSON_OPTS);
    const unitSource = new VectorSource({ features });
    const unitLayer = new VectorLayer({ source: unitSource });
    unitLayerRef.current = unitLayer;

    // Outline that follows the pointer over the profile (see hover-store.ts).
    const hoverSource = new VectorSource();
    const hoverLayer = new VectorLayer({
      source: hoverSource,
      zIndex: 100,
      style: new Style({ stroke: new Stroke({ color: HOVER_COLOR, width: 3 }), fill: new Fill({ color: "rgba(255,255,255,0.35)" }) }),
    });
    const byUnit = new Map(features.map((f) => [Number(f.getId()), f]));
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

    map.on("pointermove", (e) => {
      if (e.dragging) return;
      const f = hitAt(e.pixel);
      map.getViewport().style.cursor = f ? "pointer" : "";
      if (!f) {
        tooltipEl.style.display = "none";
        return;
      }
      const unit = Number(f.getId());
      const g = bundle.data.units[unit - 1]?.governing;
      tooltipEl.textContent = g ? `Unit ${unit} · BBI ${bbiText(g.bbi)} · ${g.line} · ${g.zone}` : `Unit ${unit} · not covered`;
      const evt = e.originalEvent as PointerEvent;
      tooltipEl.style.display = "block";
      tooltipEl.style.left = evt.pageX + 12 + "px";
      tooltipEl.style.top = evt.pageY - 30 + "px";
    });

    // OpenLayers sends no move once the pointer has left the map, so the tooltip is hidden here.
    map.getViewport().addEventListener("pointerleave", () => {
      tooltipEl.style.display = "none";
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
