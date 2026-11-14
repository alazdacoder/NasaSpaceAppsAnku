import { Link } from "react-router-dom";
import { AlertCard, Empty, GroundNote, StatusPill } from "../components/ui";
import { dayLabel, usePoll, type Alert, type Level, type Side, type ViewInfo } from "../lib/api";
import { useApp, useCrewName } from "../lib/context";
import { t } from "../lib/i18n";

export default function AlertsPage({ side = "crew" }: { side?: Side }) {
  const { crewId } = useApp();
  const name = useCrewName();
  const { data } = usePoll<{ overall: Level; alerts: Alert[]; day: number; view: ViewInfo }>(`/api/crew/${crewId}/alerts?side=${side}`, 3000);
  if (!data) return <Empty />;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">{side === "ground" ? t("Alerts · {n}", { n: name }) : t("Alerts")}</h1>
        <StatusPill level={data.overall} />
        <span className="text-slate-400">{t("based on data up to {d}", { d: dayLabel(data.day) })}</span>
      </div>
      <GroundNote view={data.view} />
      {data.alerts.length === 0 && <div className="rounded-2xl border border-ok/40 bg-ok/5 p-6 text-lg text-ok">{t("No alerts.")}</div>}
      {data.alerts.map((a) => <AlertCard key={a.id} alert={a} />)}
      <p className="text-sm text-slate-500">
        {t("Every alert comes from a rule in the config file: smoothed value vs personal baseline, 7-day slope, fixed thresholds, and cross-source rules.")}{" "}
        {side === "ground" && <Link to="/team/sources" className="text-accent">{t("Data sources")}</Link>}
      </p>
    </div>
  );
}
