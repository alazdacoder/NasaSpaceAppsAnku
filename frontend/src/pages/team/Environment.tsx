import { TrendBlock } from "../../components/charts";
import { Card, Empty, GroundNote, MetricCard, PageTitle, Stat, Unverified } from "../../components/ui";
import { dayLabel, fmt, usePoll, type Metric, type ViewInfo } from "../../lib/api";
import { useApp, useCrewName } from "../../lib/context";
import { t } from "../../lib/i18n";

interface EnvData {
  metrics: Record<string, Metric>; live: Record<string, number>; profile: string; dose_rate_msv_day: number; view: ViewInfo;
  dose_rate_verified: boolean; events: { kind: string; label: string; start_day: number; end_day: number; origin: string }[];
}

export default function Environment() {
  const { crewId } = useApp();
  const name = useCrewName();
  const { data } = usePoll<EnvData>(`/api/crew/${crewId}/environment?side=ground`, 5000);
  if (!data) return <Empty />;
  const m = data.metrics;
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageTitle sub={t("Personal CO₂ monitor and radiation dosimeter")}>{t("Environment · {n}", { n: name })}</PageTitle>
      <GroundNote view={data.view} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("CO₂ (latest status)")} value={fmt(data.live.co2_mmhg, 1)} unit="mmHg" sub={t("baseline {v} (on the ground)", { v: fmt(m.co2_mmhg?.baseline_mean, 1) })} />
        <Stat label={t("CO₂ last full day")} value={fmt(m.co2_mmhg?.value, 1)} unit="mmHg" sub={t("amber above 3.0")} />
        <Stat label={t("Radiation last full day")} value={fmt(m.rad_msv?.value, 2)} unit="mSv" sub={<span>{t("dose rate ~{r} mSv/day ({p})", { r: data.dose_rate_msv_day, p: data.profile })} {!data.dose_rate_verified && <Unverified />}</span>} />
        <Stat label={t("Mission dose so far")} value={fmt(m.rad_cum?.value, 1)} unit="mSv" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card title={t("CO₂ exposure")}>{m.co2_mmhg && <TrendBlock m={m.co2_mmhg} height={230} />}</Card>
        {m.co2_mmhg && <MetricCard m={m.co2_mmhg} showChart={false} personal={false} />}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t("Daily radiation dose")}>{m.rad_msv && <TrendBlock m={m.rad_msv} height={220} />}</Card>
        <Card title={t("Cumulative mission dose")}>{m.rad_cum && <TrendBlock m={m.rad_cum} height={220} />}</Card>
      </div>
      {data.events.length > 0 && (
        <Card title={t("Environment events")}>
          <ul className="space-y-1">{data.events.map((e, i) => <li key={i}>{e.label}: {dayLabel(e.start_day)} – {dayLabel(e.end_day)} <span className="text-slate-500">({t(e.origin)})</span></li>)}</ul>
        </Card>
      )}
      <p className="text-sm text-slate-500">{t("CO₂ and radiation thresholds and dose rates are simulation assumptions (marked unverified), not NASA limits.")}</p>
    </div>
  );
}
