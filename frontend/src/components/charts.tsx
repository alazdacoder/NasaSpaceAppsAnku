import {
  CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from "recharts";
import { LEVEL_COLOR, dayLabel, dayTick, fmt, landingDay, type Level, type Metric, type Point } from "../lib/api";
import { t } from "../lib/i18n";

export const AXIS = { stroke: "#64748b", fontSize: 13 };
export const GRID = "#1f2a40";
export const TIP = { background: "#0a0f1a", border: "1px solid #2c3a55" };

export function Sparkline({ points, baseline, status }: { points: Point[]; baseline?: number | null; status: Level }) {
  const data = points.slice(-45);
  return (
    <div className="h-14 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, bottom: 4, left: 0, right: 0 }}>
          <YAxis hide domain={["auto", "auto"]} />
          {baseline !== null && baseline !== undefined && <ReferenceLine y={baseline} stroke="#64748b" strokeDasharray="4 4" />}
          <Line type="monotone" dataKey="ewma" stroke={status === "green" ? "#38bdf8" : LEVEL_COLOR[status]} strokeWidth={2.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartTooltip({ active, payload, label, unit, decimals }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm shadow-xl">
      <div className="font-semibold">{dayLabel(Number(label ?? row.day))}</div>
      {row.value !== undefined && <div>{t("Raw")}: {fmt(row.value, decimals)} {unit}</div>}
      {row.ewma !== undefined && <div className="text-accent">{t("Smoothed")}: {fmt(row.ewma, decimals)} {unit}</div>}
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
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="day" type="number" domain={["dataMin", "dataMax"]} tick={AXIS} stroke="#334155" tickFormatter={dayTick} allowDecimals={false} />
          <YAxis tick={AXIS} stroke="#334155" width={48} domain={[lo - pad, hi + pad]} tickFormatter={(v) => fmt(v, m.decimals > 1 ? m.decimals - 1 : m.decimals)} />
          {hasBand && (
            <ReferenceArea y1={(m.baseline_mean as number) - (m.baseline_sd as number)} y2={(m.baseline_mean as number) + (m.baseline_sd as number)}
              fill="#64748b" fillOpacity={0.15} stroke="none" ifOverflow="extendDomain" />
          )}
          {hasBand && <ReferenceLine y={m.baseline_mean as number} stroke="#94a3b8" strokeDasharray="5 5" label={{ value: t("baseline"), fill: "#94a3b8", fontSize: 12, position: "insideTopLeft" }} />}
          {m.thresholds.filter((x) => thr.includes(x.value)).map((x, i) => (
            <ReferenceLine key={i} y={x.value} stroke={LEVEL_COLOR[x.level]} strokeDasharray="2 4"
              label={{ value: `${x.value}${x.verified ? "" : ` (${t("unverified")})`}`, fill: LEVEL_COLOR[x.level], fontSize: 12, position: "insideBottomRight" }} />
          ))}
          {pts[0].day < 0 && pts[pts.length - 1].day >= 0 && <ReferenceLine x={0} stroke="#38bdf8" strokeOpacity={0.6} label={{ value: t("launch"), fill: "#38bdf8", fontSize: 12, position: "insideTopRight" }} />}
          {pts[0].day < land && pts[pts.length - 1].day >= land && <ReferenceLine x={land} stroke="#a78bfa" strokeOpacity={0.8} label={{ value: t("landing"), fill: "#a78bfa", fontSize: 12, position: "insideTopLeft" }} />}
          <Tooltip content={<ChartTooltip unit={m.unit} decimals={m.decimals} />} />
          <Scatter dataKey="value" fill="#64748b" r={2.5} isAnimationActive={false} />
          <Line type="monotone" dataKey="ewma" stroke="#38bdf8" strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendBlock({ m, days, height, from }: { m: Metric; days?: number; height?: number; from?: number }) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{m.label} <span className="font-normal text-slate-400">({m.unit || "–"})</span></span>
        <span className="text-sm text-slate-400">{t("grey dots = daily value · blue = smoothed · band = baseline ± SD")}</span>
      </div>
      <TrendChart m={m} days={days} height={height} from={from} />
    </div>
  );
}

/** Small, simple line for the astronaut portal: last N days, no statistics. */
export function SimpleLine({ m, days = 14, height = 120, color = "#38bdf8" }: { m?: Metric; days?: number; height?: number; color?: string }) {
  if (!m) return null;
  const pts = m.points.slice(-days);
  if (pts.length < 2) return <div className="text-sm text-slate-500">{t("Not enough data yet")}</div>;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <LineChart data={pts} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="day" tick={AXIS} tickFormatter={dayTick} />
          <YAxis tick={AXIS} width={40} domain={["auto", "auto"]} />
          {m.baseline_mean !== null && m.baseline_mean !== undefined && <ReferenceLine y={m.baseline_mean} stroke="#94a3b8" strokeDasharray="5 5" />}
          <Tooltip contentStyle={TIP} labelFormatter={(d) => dayLabel(Number(d))} formatter={(v: any) => [fmt(Number(v), m.decimals), m.label]} />
          <Line dataKey="value" stroke={color} strokeWidth={3} dot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
