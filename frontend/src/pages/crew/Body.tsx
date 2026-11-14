import { Link } from "react-router-dom";
import { SimpleLine } from "../../components/charts";
import { Card, Empty, PageTitle, ProgressBar, SimpleAlert, SimpleMetric, StatusPill, cx } from "../../components/ui";
import { dayLabel, fmt, usePoll, type Alert, type Metric } from "../../lib/api";
import { useApp } from "../../lib/context";
import { t } from "../../lib/i18n";
import { dateText, monthName, type LsahData } from "../team/Lsah";

interface BodyData {
  live: Record<string, any>; vitals: Record<string, Metric>; sleep: Record<string, Metric>;
  kidney: Record<string, Metric>; environment: Record<string, Metric>; alerts: Alert[];
}

/** Synthetic ECG trace drawn from the live heart rate (illustration only). */
export function EcgStrip({ hr }: { hr: number }) {
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
    <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full" preserveAspectRatio="none" aria-label={t("ECG trace (simulated)")}>
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
  const ss = data.kidney.caox_ss;
  const vol = data.kidney.u_volume;
  const risk = (ss?.ewma ?? 0) > 2 ? "red" : (ss?.ewma ?? 0) > 1.8 ? "amber" : "green";
  const riskWord = { red: t("High"), amber: t("Medium"), green: t("Low") }[risk];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageTitle sub={t("Your vitals right now, last nights' sleep, kidney health and the air you breathe.")}>{t("Body")}</PageTitle>
      {data.alerts.map((a) => <SimpleAlert key={a.id} alert={a} />)}

      <Card title={t("Right now")} right={L.asleep ? <span className="text-sm text-slate-400">{t("asleep")}</span> : undefined}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SimpleMetric m={v.hr_rest} value={L.hr} label={t("Heart rate")} />
          <SimpleMetric m={v.spo2} value={L.spo2} label={t("Blood oxygen")} />
          <SimpleMetric m={v.core_temp} value={L.core_temp} label={t("Core temperature")} />
          <SimpleMetric m={v.resp_rate} value={L.resp_rate} label={t("Breathing")} />
          {v.bp_sys && (
            <div className={cx("rounded-2xl border bg-ink-850 p-4", v.bp_sys.status !== "green" ? "border-warn/50" : "border-ink-700")}>
              <div className="text-base font-semibold text-slate-200">{t("Blood pressure")}</div>
              <div className="mt-1 text-4xl font-bold tabular-nums">{fmt(L.bp_sys, 0)}/{fmt(L.bp_dia, 0)} <span className="text-lg text-slate-400">mmHg</span></div>
              <div className="text-sm text-slate-400">{t("Your normal: {v} {u}", { v: `${fmt(v.bp_sys.baseline_mean, 0)}/${fmt(v.bp_dia?.baseline_mean, 0)}`, u: "mmHg" })}</div>
            </div>
          )}
          <div className="rounded-2xl border border-ink-700 bg-ink-850 p-3">
            <div className="text-sm text-slate-400">{t("ECG (illustration from live heart rate)")}</div>
            <EcgStrip hr={L.hr ?? 60} />
          </div>
        </div>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title={t("Sleep, last 14 nights")} right={data.sleep.sleep_h && <StatusPill level={data.sleep.sleep_h.status} />}>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold">{fmt(data.sleep.sleep_h?.value, 1)}</span><span className="text-slate-400">{t("h last night")}</span>
          </div>
          <div className="text-sm text-slate-400">{t("Your normal before flight: {b} h", { b: fmt(data.sleep.sleep_h?.baseline_mean, 1) })}</div>
          <SimpleLine m={data.sleep.sleep_h} days={14} height={150} color="#818cf8" />
          <p className="text-sm text-slate-300">{data.sleep.sleep_h?.meaning}</p>
        </Card>

        <Card title={t("Kidney health")} right={<StatusPill level={risk as any} text={t("Stone risk: {w}", { w: riskWord })} />}>
          <div className="text-sm text-slate-400">{t("Urine today (goal above 2.5 L)")}</div>
          <div className="text-4xl font-bold tabular-nums">{fmt(vol?.ewma, 2)} <span className="text-lg text-slate-400">{t("L/day")}</span></div>
          <div className="my-2"><ProgressBar value={(vol?.ewma ?? 0) / 3} marker={2.5 / 3} color={(vol?.ewma ?? 0) < 2 ? "#f43f5e" : (vol?.ewma ?? 0) < 2.5 ? "#fbbf24" : "#22c55e"} height={14} /></div>
          <p className="text-slate-300">
            {risk === "green" ? t("Low risk. Keep drinking to stay above 2.5 L of urine a day.")
              : t("Drinking more water is the fastest way to lower your kidney-stone risk.")}
          </p>
          <Link to="/crew/food" className="mt-2 inline-block text-accent">{t("Log water ›")}</Link>
        </Card>
      </div>

      <Checkups />

      <Card title={t("Air and radiation")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <SimpleMetric m={data.environment.co2_mmhg} value={L.co2_mmhg ?? undefined} label={t("CO₂ in your air now")} />
          <SimpleMetric m={data.environment.rad_cum} label={t("Radiation since launch")} />
        </div>
      </Card>
    </div>
  );
}

/** LSAH medical checkups: what is next and the latest results, in plain words. */
function Checkups() {
  const { crewId } = useApp();
  const { data } = usePoll<LsahData>(`/api/crew/${crewId}/lsah`, 8000);
  if (!data) return null;
  const upcoming = data.tests.filter((x) => x.next).sort((a, b) => a.next!.day - b.next!.day);
  const m = data.metrics;
  return (
    <Card title={t("Medical checkups (LSAH)")} right={<span className="text-sm text-slate-400">{t("NASA's astronaut health program")}</span>}>
      <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
        <div className="space-y-2">
          <div className="text-sm text-slate-400">{t("Coming up")}</div>
          {upcoming.length === 0 && <p className="text-slate-400">{t("No more checkups planned in this mission.")}</p>}
          {upcoming.map((x) => {
            const isToday = x.next!.status === "today" || x.next!.status === "today_done";
            return (
              <div key={x.id} className={cx("rounded-xl border p-3", isToday ? "border-accent bg-accent/10" : "border-ink-700 bg-ink-850")}>
                <div className="font-semibold">{x.label}</div>
                <div className="text-sm text-slate-400">
                  {isToday ? <span className="font-bold text-accent">{t("Today")}</span> : dayLabel(x.next!.day)} · {dateText(x.next!.date)}
                </div>
              </div>
            );
          })}
          <p className="pt-1 text-sm text-slate-300">
            {t("Your annual exam: {m}", { m: monthName(data.annual.month) })}
            {data.annual.in_flight ? ` · ${t("done after landing")}` : ""}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SimpleMetric m={m.vitd_serum} />
          <SimpleMetric m={m.hemoglobin} />
          <SimpleMetric m={m.vo2peak} />
          <SimpleMetric m={m.bmd_hip} />
        </div>
      </div>
    </Card>
  );
}
