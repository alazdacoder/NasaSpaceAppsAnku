import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LiveWorkout, type Limits, type Summary, type WorkoutView } from "../../components/LiveWorkout";
import { Button, Card, Empty, PageTitle, ProgressBar, Stat, cx } from "../../components/ui";
import { api, dayLabel, deviceName, exerciseName, fmt, usePoll, type Phase, type Task } from "../../lib/api";
import { useApp } from "../../lib/context";
import { t } from "../../lib/i18n";

interface ExerciseData {
  phase: Phase;
  today: { slot: string; device: "ared" | "t2" | "cevis" | "rehab"; minutes: number; label: string; kcal_est: number }[];
  tasks: Task[]; weekly_target_min: number; weekly_range_min: [number, number]; last7_min: number; today_min: number;
  sessions: { id: number; day: number; device: string; minutes: number; avg_hr: number; max_hr: number; details: any; source: string; kcal: number | null }[];
  limits: Limits; ared_exercises: string[]; workout: WorkoutView;
}

export default function Exercise() {
  const { crewId } = useApp();
  const { data, refresh } = usePoll<ExerciseData>(`/api/crew/${crewId}/exercise`, 4000);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [params, setParams] = useSearchParams();
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState("");

  const start = async (device: string) => {
    setStarting(true);
    setErr("");
    try {
      await api(`/api/crew/${crewId}/workout/start`, { body: { device } });
      setSummary(null);
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally { setStarting(false); }
  };

  useEffect(() => {
    const dev = params.get("start");
    if (dev && data && !data.workout.active) {
      setParams({}, { replace: true });
      start(dev);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, data?.workout.active]);

  if (!data) return <Empty />;
  const [lo, hi] = data.weekly_range_min;
  const post = data.phase === "postflight";

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageTitle sub={post ? t("Back on Earth: reconditioning with your trainer rebuilds strength and balance.") : t("Your plan for today, then a live workout with heart rate and calories.")}>{t("Exercise")}</PageTitle>
      {err && <div className="rounded-xl border border-bad/50 bg-bad/10 p-3 text-bad">{err}</div>}

      {data.workout.active ? (
        <LiveWorkout crewId={crewId} view={data.workout} exercises={data.ared_exercises} limits={data.limits}
          onFinish={(s) => { setSummary(s); refresh(); }} />
      ) : (
        <Card title={t("Today's plan")}>
          {data.today.length === 0 && <p className="text-lg text-slate-300">{t("Landing day: no exercise. Rest and move only with help.")}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {data.today.map((p) => {
              const task = data.tasks.find((x) => x.task_id === `workout:${p.slot}`);
              const done = task?.status === "done";
              return (
                <div key={p.slot} className={cx("rounded-2xl border p-4", done ? "border-ok/50 bg-ok/5" : "border-ink-700 bg-ink-850")}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-2xl font-bold">{p.label}</div>
                      <div className="text-slate-400">{t("{m} min · about {k} kcal", { m: p.minutes, k: p.kcal_est })}</div>
                      <div className="text-sm text-slate-400">{task?.detail}</div>
                    </div>
                    {done && <span className="text-3xl text-ok">✓</span>}
                  </div>
                  <Button className="mt-3 w-full text-lg" disabled={starting} onClick={() => start(p.device)}>
                    {done ? t("Start another session") : t("Start live workout")}
                  </Button>
                </div>
              );
            })}
          </div>
          {!post && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-400">
              {t("Other machine:")}
              {(["ared", "t2", "cevis"] as const).filter((d) => !data.today.some((p) => p.device === d)).map((d) => (
                <button key={d} className="min-h-[44px] rounded-lg border border-ink-600 px-3 text-slate-200" onClick={() => start(d)}>{deviceName(d)}</button>
              ))}
            </div>
          )}
        </Card>
      )}

      {summary && (
        <Card title={t("Well done! Session summary")} className="border-ok/50" right={<button className="min-h-[44px] px-2 text-slate-400" onClick={() => setSummary(null)}>{t("Close ✕")}</button>}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t("Machine")} value={summary.device_label} />
            <Stat label={t("Time")} value={fmt(summary.minutes, 1)} unit={t("min")} />
            <Stat label={t("Energy burned")} value={fmt(summary.kcal, 0)} unit="kcal" color="#fdba74" />
            <Stat label={t("Avg / max heart rate")} value={`${summary.avg_hr}/${summary.max_hr}`} unit={t("bpm")} />
          </div>
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-sm"><span>{t("Last 7 days: {n} min", { n: summary.last7_min })}</span><span>{t("target {n} min/week", { n: summary.weekly_target_min })}</span></div>
            <ProgressBar value={summary.last7_min / summary.weekly_target_min} color="#22c55e" height={14} />
          </div>
          <p className="mt-2 text-slate-300">{t("Burned so far today: {n} kcal", { n: summary.kcal_today })}</p>
          {summary.details?.exercises && (
            <div className="mt-1 text-slate-300">{summary.details.exercises.map((e: any) => `${exerciseName(e.exercise)} ${e.load_kg} kg × ${e.sets}`).join(" · ")}</div>
          )}
        </Card>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Card title={t("This week")}>
          <div className="text-5xl font-bold tabular-nums">{data.last7_min}<span className="ml-1 text-xl text-slate-400">{t("min")}</span></div>
          <div className="mt-1 text-slate-400">{t("last 7 days · target ~{n}", { n: data.weekly_target_min })}</div>
          <div className="mt-3"><ProgressBar value={data.last7_min / data.weekly_target_min} height={16} marker={lo / data.weekly_target_min} color={data.last7_min < lo ? "#fbbf24" : "#22c55e"} /></div>
          <p className="mt-3 text-slate-300">
            {post ? t("After landing the target is your daily reconditioning session, not minutes.")
              : data.last7_min < lo ? t("Below the usual range. Exercise protects bone, muscle and heart.")
                : data.last7_min > hi ? t("Above the usual range. Make sure you recover.") : t("Inside the usual in-flight range. Good work.")}
          </p>
        </Card>
        <Card title={t("Recent sessions")}>
          <ul className="space-y-2">
            {data.sessions.slice(0, 5).map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-xl bg-ink-850 px-3 py-2">
                <span><span className="font-semibold">{deviceName(s.device)}</span> <span className="text-slate-400">· {dayLabel(s.day)}</span></span>
                <span className="text-slate-300">{fmt(s.minutes, 0)} {t("min")} · {s.kcal !== null ? `${fmt(s.kcal, 0)} kcal` : "–"}</span>
              </li>
            ))}
            {data.sessions.length === 0 && <li className="text-slate-500">{t("No sessions yet.")}</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
