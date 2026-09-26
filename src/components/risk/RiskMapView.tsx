import { useCallback, useEffect, useMemo, useRef } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import { fromLonLat } from "ol/proj";
import { asArray } from "ol/color";
import { Style, Fill, Stroke, Text } from "ol/style";
import { Zoom } from "ol/control";
import type { FeatureLike } from "ol/Feature";
import type { GeoJSONFeatureCollection } from "@/lib/geojson-types";
import type { UnitRiskResult } from "@/lib/risk-unit";
import "ol/ol.css";

interface RiskMapViewProps {
  /** Sample-unit polygons of the selected runway, same collection the PCI map draws. */
  units?: GeoJSONFeatureCollection;
  results: UnitRiskResult[];
  selectedUnit: number | null;
  /** Must be stable (a state setter) - the map's click handler is bound once. */
  onSelectUnit: (unit: number | null) => void;
  /** ICAO cell picked in the matrix - units outside it are dimmed. */
  selectedCell: string | null;
  /** Fill by Fine-Kinney degree colour or by ICAO zone colour. */
  colorBy: "degree" | "icao";
}

function withAlpha(hex: string, alpha: number): number[] {
  const [r, g, b] = asArray(hex);
  return [r, g, b, alpha];
}

// Sample units coloured by Fine-Kinney degree or ICAO zone. Same base map
// and tooltip look as MapView (the PCI map), but kept separate: MapView's
// section/branch drill-down and PCI styling don't apply here.
export default function RiskMapView({ units, results, selectedUnit, onSelectUnit, selectedCell, colorBy }: RiskMapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<OlMap | null>(null);
  const layerRef = useRef<VectorLayer | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const byUnit = useMemo(() => new Map(results.map((r) => [r.unitNumber, r])), [results]);
  const byUnitRef = useRef(byUnit);

  useEffect(() => {
    byUnitRef.current = byUnit;
  }, [byUnit]);

  const styleFunction = useCallback(
    (feature: FeatureLike) => {
      const unit = feature.get("sampleUnit") as number;
      const r = byUnit.get(unit);
      const dimmed = selectedCell !== null && r?.icao.cell !== selectedCell;
      const isSelected = unit === selectedUnit;
      const color = r && (colorBy === "icao" ? r.icao.zoneColor : r.band.color);
      return new Style({
        zIndex: isSelected ? 1 : 0,
        fill: new Fill({ color: color ? withAlpha(color, dimmed ? 0.15 : 0.85) : "rgba(120,120,120,0.4)" }),
        stroke: new Stroke({
          color: isSelected ? "rgba(255,255,255,0.95)" : dimmed ? "rgba(35,35,35,0.25)" : "rgba(20,20,20,0.85)",
          width: isSelected ? 2.5 : 0.8,
        }),
        text: new Text({
          text: String(unit ?? ""),
          font: '600 10px "Fira Sans", system-ui, sans-serif',
          fill: new Fill({ color: "#111" }),
          stroke: new Stroke({ color: "rgba(255,255,255,0.85)", width: 2 }),
          overflow: false,
        }),
      });
    },
    [byUnit, selectedUnit, selectedCell, colorBy],
  );

  useEffect(() => {
    if (!mapRef.current) return;
    const source = new VectorSource();
    const layer = new VectorLayer({ source });
    sourceRef.current = source;
    layerRef.current = layer;

    const map = new OlMap({
      target: mapRef.current,
      layers: [
        new TileLayer({
          source: new XYZ({
            url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
            attributions: "Google Satellite",
          }),
        }),
        layer,
      ],
      view: new View({ center: fromLonLat([106.66, -6.12]), zoom: 14, maxZoom: 19, minZoom: 11 }),
      controls: [new Zoom()],
    });
    mapInstance.current = map;

    const tooltipEl = document.createElement("div");
    tooltipEl.className = "map-tooltip";
    tooltipEl.style.display = "none";
    document.body.appendChild(tooltipEl);

    const unitAt = (pixel: number[]) =>
      map.forEachFeatureAtPixel(pixel, (f) => f.get("sampleUnit") as number | undefined);

    map.on("click", (e) => onSelectUnit(unitAt(e.pixel) ?? null));

    map.on("pointermove", (e) => {
      const unit = unitAt(e.pixel);
      const r = unit === undefined ? undefined : byUnitRef.current.get(unit);
      map.getViewport().style.cursor = unit === undefined ? "" : "pointer";
      if (!r) {
        tooltipEl.style.display = "none";
        return;
      }
      tooltipEl.innerHTML = `<strong>Sample Unit <span class="font-mono">${r.unitNumber}</span></strong> &middot; Degree ${r.band.degree} &middot; ICAO <span class="font-mono">${r.icao.cell}</span> &middot; R <span class="font-mono">${r.riskScore.toFixed(1)}</span>`;
      const evt = e.originalEvent as PointerEvent;
      tooltipEl.style.display = "block";
      tooltipEl.style.left = evt.pageX + 12 + "px";
      tooltipEl.style.top = evt.pageY - 30 + "px";
    });

    return () => {
      map.setTarget(undefined);
      tooltipEl.remove();
    };
  }, [onSelectUnit]);

  // Swap in the runway's units and frame them whenever the runway/year changes.
  useEffect(() => {
    const source = sourceRef.current;
    const map = mapInstance.current;
    if (!source || !map) return;
    source.clear();
    if (!units) return;
    source.addFeatures(
      new GeoJSON().readFeatures(units, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }),
    );
    const extent = source.getExtent();
    if (extent) map.getView().fit(extent, { padding: [48, 48, 48, 48], maxZoom: 17 });
  }, [units]);

  useEffect(() => {
    layerRef.current?.setStyle(styleFunction);
  }, [styleFunction]);

  return <div ref={mapRef} className="w-full h-full" />;
}
