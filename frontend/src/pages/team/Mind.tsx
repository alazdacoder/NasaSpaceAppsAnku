import { TrendBlock } from "../../components/charts";
import { Icon } from "../../components/Icon";
import { AlertCard, Card, Empty, GroundNote, MetricCard, PageTitle } from "../../components/ui";
import { fmt, usePoll, type Alert, type Metric, type Rec, type ViewInfo } from "../../lib/api";
import { useApp, useCrewName } from "../../lib/context";
import { t } from "../../lib/i18n";

interface MindData { metrics: Record<string, Metric>; alerts: Alert[]; tips: Rec[]; view: ViewInfo; live_calls_possible: boolean }

export default function TeamMind() {
  const { crewId } = useApp();
  const name = useCrewName();
  const { data } = usePoll<MindData>(`/api/crew/${crewId}/mind?side=ground`, 6000);
  if (!data) return <Empty />;
  const m = data.metrics;
  const checkin = ["feeling", "stress", "tiredness", "connection"];
  const objective = ["pvt_rt_ms", "pvt_lapses", "workload_h", "contact_week_min"];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageTitle sub={t("Daily check-in, reaction test (PVT), workload and private contact")}>{t("Mental health · {n}", { n: name })}</PageTitle>
      <GroundNote view={data.view} />
      <div className="rounded-xl border border-violet-400/40 bg-violet-500/10 p-3 text-sm text-slate-200">
        {t("Confidential behavioural-health data: for the flight surgeon and the crew psychologist only. Self-ratings are the crew member's own words; treat changes as a reason to talk, not a diagnosis.")}
      </div>
      {data.alerts.length === 0 ? <div className="rounded-2xl border border-ok/40 bg-ok/5 p-4 text-ok">{t("No behavioural-health alerts.")}</div>
        : data.alerts.map((a) => <AlertCard key={a.id} alert={a} />)}
      {!data.live_calls_possible && <div className="rounded-xl border border-warn/50 bg-warn/10 p-3 text-warn">{t("Current link delay rules out live calls; private contact falls to recorded messages.")}</div>}

      <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
        {m.wellbeing && <MetricCard m={m.wellbeing} big personal={false} />}
        <Card>{m.wellbeing && <TrendBlock m={m.wellbeing} height={220} />}</Card>
      </div>
      <p className="text-sm text-slate-500">{t("Wellbeing index = mean of (feeling−1)/4, (5−stress)/4, (5−tiredness)/4 and (connection−1)/4, × 100.")}</p>

      <Card title={t("Daily check-in (self-rated 1-5)")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {checkin.filter((k) => m[k]).map((k) => <MetricCard key={k} m={m[k]} personal={false} />)}
        </div>
      </Card>

      <Card title={t("Objective signals")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {objective.filter((k) => m[k]).map((k) => <MetricCard key={k} m={m[k]} personal={false} />)}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>{m.pvt_rt_ms && <TrendBlock m={m.pvt_rt_ms} height={200} />}</Card>
        <Card>{m.stress && <TrendBlock m={m.stress} height={200} />}</Card>
        <Card>{m.connection && <TrendBlock m={m.connection} height={200} />}</Card>
        <Card>{m.workload_h && <TrendBlock m={m.workload_h} height={200} />}</Card>
      </div>
      {data.tips.length > 0 && (
        <Card title={t("Recommendations shown to the crew member")}>
          <ul className="space-y-1">{data.tips.map((r) => <li key={r.id} className="flex items-start gap-1.5"><Icon name="chevron" size={16} className="mt-1 shrink-0 text-accent" /><span>{r.text}</span></li>)}</ul>
        </Card>
      )}
      <p className="text-sm text-slate-500">{t("Reaction time now {v} ms (baseline {b} ms).", { v: fmt(m.pvt_rt_ms?.value, 0), b: fmt(m.pvt_rt_ms?.baseline_mean, 0) })}</p>
    </div>
  );
}
