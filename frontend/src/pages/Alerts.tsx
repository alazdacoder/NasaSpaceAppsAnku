import { Link } from "react-router-dom";
import { AlertCard, Empty, StatusPill } from "../components/ui";
import { dayLabel, usePoll, type Alert, type Level } from "../lib/api";
import { useApp } from "../lib/context";

export default function Alerts() {
  const { crewId } = useApp();
  const { data } = usePoll<{ overall: Level; alerts: Alert[]; day: number }>(`/api/crew/${crewId}/alerts`, 3000);
  if (!data) return <Empty />;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">Alerts</h1>
        <StatusPill level={data.overall} />
        <span className="text-slate-400">based on data up to {dayLabel(data.day)}</span>
      </div>
      {data.alerts.length === 0 && <div className="rounded-2xl border border-ok/40 bg-ok/5 p-6 text-lg text-ok">No alerts.</div>}
      {data.alerts.map((a) => <AlertCard key={a.id} alert={a} />)}
      <p className="text-sm text-slate-500">
        Every alert comes from a rule in the config file (see <Link to="/sources" className="text-accent">Data sources</Link>):
        smoothed value vs your personal baseline, 7-day slope, fixed thresholds, and cross-source rules.
      </p>
    </div>
  );
}
