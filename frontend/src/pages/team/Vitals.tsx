import { TrendBlock } from "../../components/charts";
import { AlertCard, Card, Empty, GroundNote, MetricCard, PageTitle, Stat } from "../../components/ui";
import { fmt, usePoll, type Alert, type Metric, type ViewInfo } from "../../lib/api";
import { useApp, useCrewName } from "../../lib/context";
import { t } from "../../lib/i18n";
import { EcgStrip } from "../crew/Body";

interface BodyData { live: Record<string, any>; vitals: Record<string, Metric>; sleep: Record<string, Metric>; alerts: Alert[]; view: ViewInfo }

export default function Vitals() {
  const { crewId } = useApp();
  const name = useCrewName();
  const { data } = usePoll<BodyData>(`/api/crew/${crewId}/body?side=ground`, 3000);
  if (!data) return <Empty />;
  const L = data.live;
  const v = data.vitals;
  const order = ["hr_rest", "resp_rate", "bp_sys", "bp_dia", "spo2", "skin_temp", "activity"];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageTitle sub={t("Bio-Monitor shirt + headband, T-Mini core temperature, wrist actigraph")}>{t("Vitals & sleep · {n}", { n: name })}</PageTitle>
      <GroundNote view={data.view} />
      {data.alerts.map((a) => <AlertCard key={a.id} alert={a} />)}

      <Card title={t("Latest live reading (from the last status packet)")} right={L.asleep ? <span className="text-sm text-slate-400">{t("asleep")}</span> : undefined}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label={t("Heart rate")} value={fmt(L.hr, 0)} unit={t("bpm")} color="#fb7185" sub={t("baseline {v}", { v: fmt(v.hr_rest?.baseline_mean, 0) })} />
          <Stat label={t("Breathing")} value={fmt(L.resp_rate, 0)} unit="/min" sub={t("baseline {v}", { v: fmt(v.resp_rate?.baseline_mean, 0) })} />
          <Stat label={t("Blood pressure")} value={`${fmt(L.bp_sys, 0)}/${fmt(L.bp_dia, 0)}`} unit="mmHg" sub={t("baseline {v}", { v: `${fmt(v.bp_sys?.baseline_mean, 0)}/${fmt(v.bp_dia?.baseline_mean, 0)}` })} />
          <Stat label={t("Blood oxygen")} value={fmt(L.spo2, 0)} unit="%" sub={t("baseline {v}", { v: fmt(v.spo2?.baseline_mean, 0) })} />
          <Stat label={t("Core temp")} value={fmt(L.core_temp, 2)} unit="°C" sub={t("baseline {v}", { v: fmt(v.core_temp?.baseline_mean, 2) })} />
          <Stat label={t("Skin temp")} value={fmt(L.skin_temp, 1)} unit="°C" sub={t("baseline {v}", { v: fmt(v.skin_temp?.baseline_mean, 1) })} />
        </div>
        <div className="mt-3 rounded-xl bg-ink-950 p-2">
          <div className="px-1 text-xs text-slate-500">{t("ECG lead (illustrative trace from live heart rate)")}</div>
          <EcgStrip hr={L.hr ?? 60} />
        </div>
      </Card>

      <Card title={t("Sleep history (wrist actigraph)")}>
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          {data.sleep.sleep_h && <TrendBlock m={data.sleep.sleep_h} height={220} />}
          <div className="space-y-3">
            {data.sleep.sleep_h && <MetricCard m={data.sleep.sleep_h} showChart={false} personal={false} />}
            {data.sleep.sleep_quality && <MetricCard m={data.sleep.sleep_quality} showChart={false} personal={false} />}
          </div>
        </div>
        {data.sleep.light_lux && <div className="mt-4"><TrendBlock m={data.sleep.light_lux} height={140} /></div>}
      </Card>

      <Card title={t("Core temperature")}>
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          {v.core_temp && <TrendBlock m={v.core_temp} height={200} />}
          {v.core_temp && <MetricCard m={v.core_temp} showChart={false} personal={false} />}
        </div>
      </Card>

      <Card title={t("Vitals over time")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {order.filter((k) => v[k]).map((k) => <MetricCard key={k} m={v[k]} personal={false} />)}
        </div>
        {v.hr_rest && <div className="mt-4"><TrendBlock m={v.hr_rest} height={200} /></div>}
      </Card>
    </div>
  );
}
