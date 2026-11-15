import { onThemeChange, themePalette } from "../lib/theme";
import { C } from "../lib/theme";
import {
  CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from "recharts";
import { LEVEL_COLOR, dayLabel, dayTick, fmt, landingDay, type Level, type Metric, type Point } from "../lib/api";
import { t } from "../lib/i18n";

export const AXIS = { stroke: C.faint, fontSize: 12 };
export let GRID = C.grid;
export const TIP: Record<string, string> = {};
function syncChartColors() {
  const p = themePalette();
  AXIS.stroke = p.axis;
  GRID = p.grid;
  Object.assign(TIP, { background: p.tipBg, border: `1px solid ${p.tipBorder}`, borderRadius: "14px", boxShadow: p.tipShadow, color: p.tipText });
}
syncChartColors();
onThemeChange(syncChartColors);

export function Sparkline({ points, baseline, status }: { points: Point[]; baseline?: number | null; status: Level }) {
  const data = points.slice(-45);
  return (
    <div className="h-14 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, bottom: 4, left: 0, right: 0 }}>
          <YAxis hide domain={["auto", "auto"]} />
          {baseline !== null && baseline !== undefined && <ReferenceLine y={baseline} stroke={C.faint} strokeDasharray="4 4" />}
          <Line type="monotone" dataKey="ewma" stroke={status === "green" ? C.accent : LEVEL_COLOR[status]} strokeWidth={2.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartTooltip({ active, payload, label, unit, decimals }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-2xl border border-ink-600 bg-ink-950/95 px-3.5 py-2.5 text-sm shadow-2xl backdrop-blur-xl">
      <div className="font-semibold text-fg">{dayLabel(Number(label ?? row.day))}</div>
      {row.value !== undefined && <div className="text-slate-300">{t("Raw")}: <span className="tabular-nums font-semibold text-fg">{fmt(row.value, decimals)}</span> {unit}</div>}
      {row.ewma !== undefined && <div className="text-accent">{t("Smoothed")}: <span className="tabular-nums font-bold">{fmt(row.ewma, decimals)}</span> {unit}</div>}
    </div>
  );
}

/** Full trend: raw dots, EWMA line, personal baseline band (mean ± SD), thresholds, launch and landing markers. */
export function TrendChart({ m, height = 220, days, from }: { m: Metric; height?: number; days?: number; from?: number }) {
  let pts = days ? m.points.slice(-days) : m.points;
  if (from !== undefined) pts = pts.filter((p) => p.day >= from);
  if (pts.length < 2) return <div className="flex h-24 items-center text-slate-500">{t("Not enough data yet")}</div>;
  const hasBand = m.baseline_mean !== null && m.baseline_mean !== undefined && m.baseline_sd;
  const vals = pts.flatMap((p) => [p.value, p.ewma]);
  const thr = m.thresholds.map((x) => x.value).filter((v) => v > Math.min(...vals) * 0.7 && v < Math.max(...vals) * 1.3);
  const lo = Math.min(...vals, ...thr, hasBand ? (m.baseline_mean as number) - (m.baseline_sd as number) : Infinity);
  const hi = Math.max(...vals, ...thr, hasBand ? (m.baseline_mean as number) + (m.baseline_sd as number) : -Infinity);
  const pad = (hi - lo) * 0.08 || 1;
  const land = landingDay();
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <ComposedChart data={pts} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="day" type="number" domain={["dataMin", "dataMax"]} tick={AXIS} stroke={GRID} tickFormatter={dayTick} allowDecimals={false} />
          <YAxis tick={AXIS} stroke={GRID} width={48} domain={[lo - pad, hi + pad]} tickFormatter={(v) => fmt(v, m.decimals > 1 ? m.decimals - 1 : m.decimals)} />
          {hasBand && (
            <ReferenceArea y1={(m.baseline_mean as number) - (m.baseline_sd as number)} y2={(m.baseline_mean as number) + (m.baseline_sd as number)}
              fill={C.accent} fillOpacity={0.07} stroke="none" ifOverflow="extendDomain" />
          )}
          {hasBand && <ReferenceLine y={m.baseline_mean as number} stroke={C.faint} strokeDasharray="5 5" label={{ value: t("baseline"), fill: C.faint, fontSize: 12, position: "insideTopLeft" }} />}
          {m.thresholds.filter((x) => thr.includes(x.value)).map((x, i) => (
            <ReferenceLine key={i} y={x.value} stroke={LEVEL_COLOR[x.level]} strokeDasharray="2 4"
              label={{ value: `${x.value}${x.verified ? "" : ` (${t("unverified")})`}`, fill: LEVEL_COLOR[x.level], fontSize: 12, position: "insideBottomRight" }} />
          ))}
          {pts[0].day < 0 && pts[pts.length - 1].day >= 0 && <ReferenceLine x={0} stroke={C.accent} strokeOpacity={0.6} label={{ value: t("launch"), fill: C.accent, fontSize: 12, position: "insideTopRight" }} />}
          {pts[0].day < land && pts[pts.length - 1].day >= land && <ReferenceLine x={land} stroke={C.rest} strokeOpacity={0.8} label={{ value: t("landing"), fill: C.rest, fontSize: 12, position: "insideTopLeft" }} />}
          <Tooltip content={<ChartTooltip unit={m.unit} decimals={m.decimals} />} />
          <Scatter dataKey="value" fill="#9FB2C4" r={2.5} isAnimationActive={false} />
          <Line type="monotone" dataKey="ewma" stroke={C.accent} strokeWidth={2.8} dot={false} isAnimationActive={false} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendBlock({ m, days, height, from }: { m: Metric; days?: number; height?: number; from?: number }) {
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-fg">{m.label} <span className="font-normal text-slate-400">({m.unit || "–"})</span></span>
        <span className="text-xs text-slate-400">{t("grey dots = daily value · blue = smoothed · band = baseline ± SD")}</span>
      </div>
      <TrendChart m={m} days={days} height={height} from={from} />
    </div>
  );
}

/** Small, simple line for the astronaut portal: last N days, no statistics. */
export function SimpleLine({ m, days = 14, height = 120, color = C.accent }: { m?: Metric; days?: number; height?: number; color?: string }) {
  if (!m) return null;
  const pts = m.points.slice(-days);
  if (pts.length < 2) return <div className="text-sm text-slate-500">{t("Not enough data yet")}</div>;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <LineChart data={pts} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="day" tick={AXIS} tickFormatter={dayTick} />
          <YAxis tick={AXIS} width={40} domain={["auto", "auto"]} />
          {m.baseline_mean !== null && m.baseline_mean !== undefined && <ReferenceLine y={m.baseline_mean} stroke={C.faint} strokeDasharray="5 5" />}
          <Tooltip contentStyle={TIP} labelFormatter={(d) => dayLabel(Number(d))} formatter={(v: any) => [fmt(Number(v), m.decimals), m.label]} />
          <Line dataKey="value" stroke={color} strokeWidth={3} dot={{ r: 3, fill: color }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
