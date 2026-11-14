import { TrendBlock } from "../components/charts";
import { Card, Empty, MetricCard, Stat } from "../components/ui";
import { fmt, usePoll, type Metric } from "../lib/api";
import { useApp } from "../lib/context";

interface BodyData { live: Record<string, any>; vitals: Record<string, Metric>; sleep: Record<string, Metric> }

/** Synthetic ECG trace drawn from the live heart rate (illustration only). */
function EcgStrip({ hr }: { hr: number }) {
  const beats = Math.max(3, Math.round((hr / 60) * 4));
  const w = 600, h = 90, per = w / beats;
  let d = `M0 ${h / 2}`;
  for (let i = 0; i < beats; i++) {
    const x = i * per;
    d += ` L${x + per * 0.3} ${h / 2} l${per * 0.04} -6 l${per * 0.04} 6 L${x + per * 0.45} ${h / 2}`;
    d += ` l${per * 0.03} 8 l${per * 0.03} -${h * 0.42} l${per * 0.03} ${h * 0.5} l${per * 0.03} -${h * 0.08}`;
    d += ` L${x + per * 0.7} ${h / 2} q${per * 0.07} -14 ${per * 0.14} 0 L${x + per} ${h / 2}`;
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full" preserveAspectRatio="none" aria-label="ECG trace (simulated)">
      <path d={d} fill="none" stroke="#22c55e" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function Body() {
  const { crewId } = useApp();
  const { data } = usePoll<BodyData>(`/api/crew/${crewId}/body`, 3000);
  if (!data) return <Empty />;
  const L = data.live;
  const v = data.vitals;
  const order = ["hr_rest", "resp_rate", "bp_sys", "bp_dia", "spo2", "skin_temp", "activity"];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <h1 className="text-3xl font-bold">Body</h1>

      <Card title="Right now" right={<span className="text-sm text-slate-400">Bio-Monitor shirt + headband, T-Mini {L.asleep ? "· asleep" : ""}</span>}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Heart rate" value={fmt(L.hr, 0)} unit="bpm" color="#fb7185" sub={`resting baseline ${fmt(v.hr_rest?.baseline_mean, 0)}`} />
          <Stat label="Breathing" value={fmt(L.resp_rate, 0)} unit="/min" sub={`baseline ${fmt(v.resp_rate?.baseline_mean, 0)}`} />
          <Stat label="Blood pressure" value={`${fmt(L.bp_sys, 0)}/${fmt(L.bp_dia, 0)}`} unit="mmHg" sub={`baseline ${fmt(v.bp_sys?.baseline_mean, 0)}/${fmt(v.bp_dia?.baseline_mean, 0)}`} />
          <Stat label="Blood oxygen" value={fmt(L.spo2, 0)} unit="%" sub={`baseline ${fmt(v.spo2?.baseline_mean, 0)}`} />
          <Stat label="Core temp" value={fmt(L.core_temp, 2)} unit="°C" sub={`baseline ${fmt(v.core_temp?.baseline_mean, 2)}`} />
          <Stat label="Skin temp" value={fmt(L.skin_temp, 1)} unit="°C" sub={`baseline ${fmt(v.skin_temp?.baseline_mean, 1)}`} />
        </div>
        <div className="mt-3 rounded-xl bg-ink-950 p-2">
          <div className="px-1 text-xs text-slate-500">ECG lead (illustrative trace from live heart rate)</div>
          <EcgStrip hr={L.hr ?? 60} />
        </div>
      </Card>

      <Card title="Sleep history (wrist actigraph)">
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          {data.sleep.sleep_h && <TrendBlock m={data.sleep.sleep_h} height={220} />}
          <div className="space-y-3">
            {data.sleep.sleep_h && <MetricCard m={data.sleep.sleep_h} showChart={false} />}
            {data.sleep.sleep_quality && <MetricCard m={data.sleep.sleep_quality} showChart={false} />}
          </div>
        </div>
        {data.sleep.light_lux && <div className="mt-4"><TrendBlock m={data.sleep.light_lux} height={140} /></div>}
      </Card>

      <Card title="Core temperature">
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          {v.core_temp && <TrendBlock m={v.core_temp} height={200} />}
          {v.core_temp && <MetricCard m={v.core_temp} showChart={false} />}
        </div>
      </Card>

      <Card title="Vitals over time">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {order.filter((k) => v[k]).map((k) => <MetricCard key={k} m={v[k]} />)}
        </div>
        {v.hr_rest && <div className="mt-4"><TrendBlock m={v.hr_rest} height={200} /></div>}
      </Card>
    </div>
  );
}
