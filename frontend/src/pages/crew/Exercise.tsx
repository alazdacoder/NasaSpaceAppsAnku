import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { LiveWorkout, type Limits, type Summary, type WorkoutView } from "../../components/LiveWorkout";
import { Ring } from "../../components/Ring";
import { Button, Card, Empty, PageTitle, ProgressBar, Stat, cx } from "../../components/ui";
import { api, dayLabel, deviceName, exerciseName, fmt, usePoll, type Phase, type Task } from "../../lib/api";
import { useApp, useCrewName } from "../../lib/context";
import { t } from "../../lib/i18n";

interface ExerciseData {
  phase: Phase;
  today: { slot: string; device: "ared" | "t2" | "cevis" | "rehab"; minutes: number; label: string; kcal_est: number }[];
  tasks: Task[];
  weekly_target_min: number;
  weekly_range_min: [number, number];
  last7_min: number;
  today_min: number;
  sessions: {
    id: number;
    day: number;
    device: string;
    minutes: number;
    avg_hr: number;
    max_hr: number;
    details: any;
    source: string;
    kcal: number | null;
  }[];
  limits: Limits;
  ared_exercises: string[];
  workout: WorkoutView;
}

export default function Exercise() {
  const { crewId } = useApp();
  const crewName = useCrewName();
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
    } finally {
      setStarting(false);
    }
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
      <PageTitle
        sub={
          post
            ? t("Back on Earth: reconditioning with your trainer rebuilds strength and balance.")
            : t("Your plan for today, then a live workout with heart rate, calories, and ocular pressure protection.")
        }
        right={
          <Link
            to="/crew/ocular"
            className="inline-flex min-h-[42px] items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 text-xs font-bold text-accent hover:bg-accent/20"
          >
            <Icon name="eye" size={16} />
            {t("Check Tonometer IOP ›")}
          </Link>
        }
      >
        {t("Exercise")} · {crewName}
      </PageTitle>

      {err && <div className="rounded-2xl border border-bad/50 bg-bad/10 p-4 text-bad">{err}</div>}

      {/* Ocular & Biologic Liquid Safety Note for Microgravity Resistance Exercise */}
      {!post && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-telemetry/30 bg-gradient-to-r from-[#1D1532] via-[#161B26] to-[#121D28] px-4 py-3 text-xs text-slate-200">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-telemetry/20 text-telemetry">
              <Icon name="eye" size={16} />
            </span>
            <span>
              <strong className="text-white">{t("Ocular Biologic Liquid Protection")}:</strong>{" "}
              {t(
                "Exhale smoothly during heavy ARED lifts to prevent Valsalva spikes in intraocular pressure (IOP) and intracranial fluid pressure.",
              )}
            </span>
          </div>
          <Link to="/crew/ocular" className="font-bold text-accent hover:underline">
            {t("Post-Workout Tonometer Scan ›")}
          </Link>
        </div>
      )}

      {data.workout.active ? (
        <LiveWorkout
          crewId={crewId}
          view={data.workout}
          exercises={data.ared_exercises}
          limits={data.limits}
          onFinish={(s) => {
            setSummary(s);
            refresh();
          }}
        />
      ) : (
        <Card
          className="border-white/[0.08] bg-gradient-to-br from-[#0F2421] via-[#181C24] to-[#131C2B]"
          title={
            <span className="flex items-center gap-2">
              <Icon name="exercise" size={18} className="text-ok" />
              {t("Today's plan")}
            </span>
          }
        >
          {data.today.length === 0 && (
            <p className="text-lg text-slate-300">{t("Landing day: no exercise. Rest and move only with help.")}</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {data.today.map((p) => {
              const task = data.tasks.find((x) => x.task_id === `workout:${p.slot}`);
              const done = task?.status === "done";
              return (
                <div
                  key={p.slot}
                  className={cx(
                    "flex flex-col justify-between rounded-2xl border p-5 transition-all",
                    done
                      ? "border-ok/50 bg-ok/10 shadow-glowGreen"
                      : "border-white/[0.07] bg-ink-850/90 hover:border-accent/40",
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-2xl font-black tracking-tight text-white">{p.label}</div>
                      <div className="mt-0.5 text-sm font-semibold text-accent">
                        {t("{m} min · about {k} kcal", { m: p.minutes, k: p.kcal_est })}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">{task?.detail}</div>
                    </div>
                    {done && (
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ok text-lg font-black text-ink-950">
                        ✓
                      </span>
                    )}
                  </div>
                  <Button
                    kind={done ? "ghost" : "primary"}
                    className="mt-4 w-full text-base shadow-glowBlue"
                    disabled={starting}
                    onClick={() => start(p.device)}
                  >
                    {done ? t("Start another session") : t("Start live workout")}
                  </Button>
                </div>
              );
            })}
          </div>
          {!post && (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-400">
              {t("Other machine:")}
              {(["ared", "t2", "cevis"] as const)
                .filter((d) => !data.today.some((p) => p.device === d))
                .map((d) => (
                  <button
                    key={d}
                    className="min-h-[40px] rounded-full border border-white/10 bg-ink-850 px-4 text-xs font-bold text-slate-200 hover:border-accent/40 hover:text-accent"
                    onClick={() => start(d)}
                  >
                    {deviceName(d)}
                  </button>
                ))}
            </div>
          )}
        </Card>
      )}

      {summary && (
        <Card
          title={t("Well done! Session summary")}
          className="border-ok/50 shadow-glowGreen"
          right={
            <button className="min-h-[40px] px-2 text-sm text-slate-400 hover:text-white" onClick={() => setSummary(null)}>
              {t("Close ✕")}
            </button>
          }
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t("Machine")} value={summary.device_label} />
            <Stat label={t("Time")} value={fmt(summary.minutes, 1)} unit={t("min")} />
            <Stat label={t("Energy burned")} value={fmt(summary.kcal, 0)} unit="kcal" color="#FF9100" />
            <Stat label={t("Avg / max heart rate")} value={`${summary.avg_hr}/${summary.max_hr}`} unit={t("bpm")} color="#FF5252" />
          </div>
          <div className="mt-4">
            <div className="mb-1.5 flex justify-between text-sm">
              <span>{t("Last 7 days: {n} min", { n: summary.last7_min })}</span>
              <span>{t("target {n} min/week", { n: summary.weekly_target_min })}</span>
            </div>
            <ProgressBar value={summary.last7_min / summary.weekly_target_min} color="#00E676" height={12} />
          </div>
          <p className="mt-2 text-sm text-slate-300">{t("Burned so far today: {n} kcal", { n: summary.kcal_today })}</p>
          {summary.details?.exercises && (
            <div className="mt-1 text-sm text-accent">
              {summary.details.exercises.map((e: any) => `${exerciseName(e.exercise)} ${e.load_kg} kg × ${e.sets}`).join(" · ")}
            </div>
          )}
        </Card>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Card title={t("This week")}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-5xl font-black tabular-nums text-white">
                {data.last7_min}
                <span className="ml-1.5 text-lg font-medium text-slate-400">{t("min")}</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {t("last 7 days · target ~{n}", { n: data.weekly_target_min })}
              </div>
            </div>
            <Ring
              value={data.last7_min / Math.max(1, data.weekly_target_min)}
              size={84}
              stroke={8}
              color={data.last7_min < lo ? "#FF9100" : "#00E676"}
              label={`${Math.round((data.last7_min / Math.max(1, data.weekly_target_min)) * 100)}%`}
            />
          </div>
          <div className="mt-4">
            <ProgressBar
              value={data.last7_min / data.weekly_target_min}
              height={12}
              marker={lo / data.weekly_target_min}
              color={data.last7_min < lo ? "#FF9100" : "#00E676"}
            />
          </div>
          <p className="mt-3 text-sm text-slate-300">
            {post
              ? t("After landing the target is your daily reconditioning session, not minutes.")
              : data.last7_min < lo
                ? t("Below the usual range. Exercise protects bone, muscle and heart.")
                : data.last7_min > hi
                  ? t("Above the usual range. Make sure you recover.")
                  : t("Inside the usual in-flight range. Good work.")}
          </p>
        </Card>

        <Card title={t("Recent sessions")}>
          <ul className="space-y-2.5">
            {data.sessions.slice(0, 5).map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-2xl border border-white/[0.05] bg-ink-850 px-4 py-2.5"
              >
                <span>
                  <span className="font-bold text-white">{deviceName(s.device)}</span>{" "}
                  <span className="text-xs text-slate-400">· {dayLabel(s.day)}</span>
                </span>
                <span className="font-mono text-sm text-accent">
                  {fmt(s.minutes, 0)} {t("min")} · {s.kcal !== null ? `${fmt(s.kcal, 0)} kcal` : "–"}
                </span>
              </li>
            ))}
            {data.sessions.length === 0 && <li className="text-slate-500">{t("No sessions yet.")}</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
