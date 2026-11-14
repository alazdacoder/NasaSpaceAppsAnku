import { TrendBlock } from "../components/charts";
import { Card, Empty, MetricCard, Stat, Unverified } from "../components/ui";
import { dayLabel, fmt, usePoll, type Metric } from "../lib/api";
import { useApp } from "../lib/context";

interface EnvData {
  metrics: Record<string, Metric>; live: Record<string, number>; profile: string; dose_rate_msv_day: number;
  dose_rate_verified: boolean; events: { kind: string; label: string; start_day: number; end_day: number; origin: string }[];
}

export default function Environment() {
  const { crewId } = useApp();
  const { data } = usePoll<EnvData>(`/api/crew/${crewId}/environment`, 4000);
  if (!data) return <Empty />;
  const m = data.metrics;
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <h1 className="text-3xl font-bold">Environment <span className="text-lg font-normal text-slate-400">· your personal exposure</span></h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="CO₂ now (personal monitor)" value={fmt(data.live.co2_mmhg, 1)} unit="mmHg" sub={`baseline ${fmt(m.co2_mmhg?.baseline_mean, 1)} (on the ground)`} />
        <Stat label="CO₂ today (average)" value={fmt(m.co2_mmhg?.value, 1)} unit="mmHg" sub="amber above 3.0" />
        <Stat label="Radiation yesterday" value={fmt(m.rad_msv?.value, 2)} unit="mSv" sub={<span>dose rate ~{data.dose_rate_msv_day} mSv/day ({data.profile}) {!data.dose_rate_verified && <Unverified />}</span>} />
        <Stat label="Mission dose so far" value={fmt(m.rad_cum?.value, 1)} unit="mSv" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card title="CO₂ exposure">{m.co2_mmhg && <TrendBlock m={m.co2_mmhg} height={230} />}</Card>
        {m.co2_mmhg && <MetricCard m={m.co2_mmhg} showChart={false} />}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Daily radiation dose">{m.rad_msv && <TrendBlock m={m.rad_msv} height={220} />}</Card>
        <Card title="Cumulative mission dose">{m.rad_cum && <TrendBlock m={m.rad_cum} height={220} />}</Card>
      </div>
      {data.events.length > 0 && (
        <Card title="Environment events">
          <ul className="space-y-1">{data.events.map((e, i) => <li key={i}>{e.label}: {dayLabel(e.start_day)} – {dayLabel(e.end_day)} <span className="text-slate-500">({e.origin})</span></li>)}</ul>
        </Card>
      )}
      <p className="text-sm text-slate-500">CO₂ and radiation thresholds and dose rates are simulation assumptions (marked unverified), not NASA limits.</p>
    </div>
  );
}
