import { useMemo } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, ReferenceArea, Tooltip, XAxis, YAxis } from "recharts";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TEXTURE_LANE_MIN_N, TEXTURE_SERIES, etdFromMpd } from "@/config/texture";
import { useElementWidth } from "@/hooks/useElementWidth";
import { laneRows, type TextureLaneRow, type TextureZoneChoice } from "@/lib/texture";
import type { TextureRunwayData } from "@/types/texture";
import { mmText, offsetText } from "./texture-ui";

const AXIS = "#555555";
const TICK = { fontSize: 10, fill: AXIS };
const THIN_OPACITY = 0.3;

function LaneTip({ active, payload }: { active?: boolean; payload?: { payload: TextureLaneRow }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-800 shadow-md tabular-nums whitespace-nowrap">
      <div className="font-medium">
        {offsetText(row.from, 1)} to {offsetText(row.to, 1)} m
      </div>
      {row.n === 0 ? (
        <div>No values</div>
      ) : (
        <>
          <div>
            n {row.n} · MPD {mmText(row.mpd)} mm · ETD {mmText(row.etd)} mm
          </div>
          {row.thin && <div>Few values (n &lt; {TEXTURE_LANE_MIN_N})</div>}
        </>
      )}
    </div>
  );
}

interface TextureCrossSectionProps {
  data: TextureRunwayData;
  zone: TextureZoneChoice;
  onZone: (zone: TextureZoneChoice) => void;
  narrow: boolean;
}

// Mean MPD per 0.5 m lane across the runway, north on the left. The right axis reads the same bars as ETD.
export default function TextureCrossSection({ data, zone, onZone, narrow }: TextureCrossSectionProps) {
  const [plotRef, plotWidth] = useElementWidth<HTMLDivElement>();
  const rows = useMemo(() => laneRows(data, zone), [data, zone]);
  const top = rows.reduce((m, r) => Math.max(m, r.mpd ?? 0), 0);
  const yMax = Math.ceil(Math.max(1, top * 1.05) * 5) / 5;
  const yTicks = Array.from({ length: Math.round(yMax / 0.2) + 1 }, (_, i) => Math.round(i * 2) / 10);
  const etdDomain: [number, number] = [etdFromMpd(0), etdFromMpd(yMax)];
  const half = data.keel.half_width_m;

  return (
    <div className="px-4 py-3 bg-card border-t border-border">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-2">
        <h3 className="panel-label">Across the runway · mean per 0.5 m lane</h3>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={String(zone)}
          onValueChange={(v) => v && onZone(v === "all" ? "all" : (Number(v) as TextureZoneChoice))}
          aria-label="Part of the runway"
        >
          <ToggleGroupItem value="all">Whole runway</ToggleGroupItem>
          {data.zones.map((z) => (
            <ToggleGroupItem key={z.zone} value={String(z.zone)}>
              {z.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="rounded-md bg-[#FBFAF7] text-[#1F1F1F] p-3">
        <div ref={plotRef} className="w-full">
          {plotWidth > 0 && (
            <ComposedChart width={plotWidth} height={narrow ? 240 : 280} data={rows} margin={{ top: 12, right: 4, bottom: 18, left: 4 }} barCategoryGap={0}>
              <CartesianGrid stroke="#E6E5DF" vertical={false} />
              <XAxis
                type="number"
                dataKey="x"
                domain={[-30, 30]}
                ticks={[-30, -24, -18, -12, -6, 0, 6, 12, 18, 24, 30]}
                interval={0}
                tick={TICK}
                tickFormatter={(v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0")}
                tickSize={4}
                stroke={AXIS}
                label={{ value: "Offset from the runway axis (m)", position: "insideBottom", offset: -12, fill: AXIS, fontSize: 11 }}
              />
              <YAxis
                yAxisId="mpd"
                domain={[0, yMax]}
                allowDataOverflow
                ticks={yTicks}
                tickFormatter={(v: number) => v.toFixed(1)}
                tick={TICK}
                width={44}
                stroke={AXIS}
                label={{ value: "MPD (mm)", angle: -90, position: "insideLeft", offset: 12, fill: AXIS, fontSize: 11, style: { textAnchor: "middle" } }}
              />
              <YAxis
                yAxisId="etd"
                orientation="right"
                domain={etdDomain}
                allowDataOverflow
                ticks={yTicks.map(etdFromMpd)}
                tickFormatter={(v: number) => v.toFixed(2)}
                tick={TICK}
                width={48}
                stroke={AXIS}
                label={{ value: "ETD (mm)", angle: 90, position: "insideRight", offset: 12, fill: AXIS, fontSize: 11, style: { textAnchor: "middle" } }}
              />
              <ReferenceArea
                yAxisId="mpd"
                x1={-half}
                x2={half}
                fill={TEXTURE_SERIES.keel}
                fillOpacity={0.1}
                stroke={TEXTURE_SERIES.keel}
                strokeOpacity={0.5}
                strokeDasharray="3 3"
                label={{ value: `Keel ±${half} m`, position: "insideTop", fill: TEXTURE_SERIES.zone, fontSize: 10 }}
              />
              <Bar yAxisId="mpd" dataKey="mpd" isAnimationActive={false} minPointSize={0}>
                {rows.map((r) => (
                  <Cell key={r.x} fill={TEXTURE_SERIES.keel} fillOpacity={r.thin ? THIN_OPACITY : 1} />
                ))}
              </Bar>
              <Tooltip content={<LaneTip />} isAnimationActive={false} filterNull={false} cursor={{ fill: "#000000", fillOpacity: 0.06 }} />
            </ComposedChart>
          )}
          <div className="flex justify-between text-[11px] font-medium text-neutral-600 px-12 -mt-4">
            <span>North</span>
            <span>South</span>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5">
        Lanes use offsets rounded to 0.01 m; keel statistics use the package's keel flag, so the −6..+6 m lanes can differ from the keel figures by a few values. Pale bars: fewer than {TEXTURE_LANE_MIN_N} values.
      </p>
    </div>
  );
}
