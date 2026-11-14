import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, Empty, ProgressBar, StatusPill, Unverified, cx } from "../../components/ui";
import { LEVEL_COLOR, api, fmt, levelText, missionTime, usePoll, type Alert, type Level, type Metric, type Task } from "../../lib/api";
import { useApp } from "../../lib/context";
import { t, tn } from "../../lib/i18n";

interface Readiness { level: number; label: string; max_level: number; activities: { id: string; label: string; allowed: boolean }[] }
interface TodayData {
  crew: { id: string; name: string; role: string };
  overall: Level; alerts: Alert[]; tasks: Task[];
  sleep: { sleep_h: Metric; sleep_quality: Metric };
  water_target_l: number;
  protocols: { protocol_id: number; label: string; score: number | null; days_since_start: number; days_to_target_left: number | null; dose_text: string }[];
  energy: { kcal_so_far: number; kcal_expected: number; live: { kcal: number } | null };
  intake_yesterday: number | null;
  mind: { checkin: Record<string, number> | null; wellbeing: number | null; stress: number | null };
  readiness: Readiness | null;
  live: Record<string, number>; autopilot: boolean; workout_active: boolean;
}

export function TaskRow({ t: task, onConfirm, busy }: { t: Task; onConfirm: () => void; busy: boolean }) {
  const nav = useNavigate();
  const done = task.status === "done";
  const isStart = task.kind === "supplement_start";
  const opens: Record<string, string> = { checkin: "/crew/mind", dizziness: "/crew/return" };
  return (
    <div className={cx("flex flex-wrap items-center gap-4 rounded-xl border p-4",
      done ? "border-ok/40 bg-ok/5" : isStart ? "border-bad/60 bg-bad/10" : "border-ink-700 bg-ink-850")}>
      <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl font-bold",
        done ? "bg-ok text-ink-950" : "border-2 border-ink-600 text-slate-500")}>{done ? "✓" : ""}</span>
      <div className="min-w-[200px] flex-1">
        <div className="text-lg font-semibold">{task.title}</div>
        <div className="text-slate-400">{task.detail}</div>
        {isStart && (
          <div className="mt-1 text-sm text-rose-200">
            {t("From Lab alert “{a}”: {r}", { a: task.payload.alert_title, r: task.payload.reason })}
            {task.payload.verified === false && <Unverified className="ml-2" />}
          </div>
        )}
      </div>
      {done ? (
        <span className="font-semibold text-ok">{t("Done")}</span>
      ) : opens[task.kind] ? (
        <Button kind="primary" onClick={() => nav(opens[task.kind])} className="min-w-[140px]">{t("Open")} ›</Button>
      ) : (
        <div className="flex gap-2">
          {task.kind === "workout" && (
            <Button kind="ghost" onClick={() => nav(`/crew/exercise?start=${task.payload.device}`)}>{t("Start live")}</Button>
          )}
          <Button kind={isStart ? "danger" : "ok"} onClick={onConfirm} disabled={busy} className="min-w-[140px]">
            {isStart ? t("Start & take dose") : task.kind === "workout" || task.kind === "vest_rehab" || task.kind === "prelanding" ? t("Mark done") : t("Confirm")}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function Today() {
  const { crewId, clock } = useApp();
  const { data, refresh } = usePoll<TodayData>(`/api/crew/${crewId}/today`, 2500);
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return <Empty />;

  const confirm = async (id: string) => {
    setBusy(id);
    try { await api(`/api/crew/${crewId}/tasks/${encodeURIComponent(id)}/confirm`, { method: "POST" }); await refresh(); }
    finally { setBusy(null); }
  };
  const top = data.alerts[0];
  const pending = data.tasks.filter((x) => x.status !== "done").length;
  const sleep = data.sleep.sleep_h;
  const hour = clock?.hour ?? 8;
  const greet = hour < 12 ? t("Good morning") : hour < 18 ? t("Good afternoon") : t("Good evening");
  const burned = data.energy.kcal_so_far;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-ink-700 bg-ink-900 p-5">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full"
          style={{ background: `${LEVEL_COLOR[data.overall]}22`, border: `5px solid ${LEVEL_COLOR[data.overall]}` }}>
          <span className="text-center text-sm font-bold uppercase leading-tight" style={{ color: LEVEL_COLOR[data.overall] }}>
            {levelText(data.overall)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm uppercase tracking-wide text-slate-400">{greet}</div>
          <h1 className="text-3xl font-bold">{data.crew.name}</h1>
          <div className="text-slate-400">{data.crew.role} · {missionTime(clock)} · {tn("{n} task left today", "{n} tasks left today", pending)}</div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            [t("Heart rate"), fmt(data.live.hr, 0), t("bpm")],
            [t("Blood O₂"), fmt(data.live.spo2, 0), "%"],
            [t("Core temp"), fmt(data.live.core_temp, 1), "°C"],
            ["CO₂", fmt(data.live.co2_mmhg, 1), "mmHg"],
          ] as const).map(([l, v, u]) => (
            <div key={l} className="rounded-xl bg-ink-850 px-3 py-2 text-center">
              <div className="text-xs text-slate-400">{l}</div>
              <div className="text-2xl font-bold tabular-nums">{v}<span className="ml-1 text-sm font-normal text-slate-400">{u}</span></div>
            </div>
          ))}
        </div>
      </div>

      {top ? (
        <Link to="/crew/alerts" className="block">
          <div className={cx("flex flex-wrap items-center gap-4 rounded-2xl border-2 p-4 transition hover:brightness-110",
            top.level === "red" ? "border-bad bg-bad/15" : "border-warn bg-warn/10")}>
            <span className="text-3xl" aria-hidden>{top.level === "red" ? "⚠" : "!"}</span>
            <div className="min-w-[220px] flex-1">
              <div className="text-xl font-bold">{top.title}</div>
              <div className="text-slate-200">{top.reason}</div>
              {top.recs[0] && <div className="mt-1 font-semibold text-accent">→ {top.recs[0].text}</div>}
            </div>
            <span className="w-full shrink-0 rounded-xl border border-white/20 px-4 py-3 text-center font-semibold sm:w-auto">
              {data.alerts.length > 1 ? t("All {n} alerts ›", { n: data.alerts.length }) : t("Details ›")}
            </span>
          </div>
        </Link>
      ) : (
        <div className="rounded-2xl border border-ok/40 bg-ok/5 p-4 text-lg font-semibold text-ok">{t("No alerts. Keep going.")}</div>
      )}

      {data.readiness && (
        <Link to="/crew/return" className="block rounded-2xl border-2 border-violet-400/50 bg-violet-500/10 p-4 transition hover:brightness-110">
          <div className="flex flex-wrap items-center gap-4">
            <div className="text-4xl font-black text-violet-300">{data.readiness.level}<span className="text-lg text-slate-400">/{data.readiness.max_level}</span></div>
            <div className="min-w-[200px] flex-1">
              <div className="text-sm uppercase tracking-wide text-violet-300">{t("Today you may")}</div>
              <div className="text-xl font-bold">{data.readiness.label}</div>
              <div className="text-sm text-slate-300">
                {data.readiness.activities.filter((a) => !a.allowed).length > 0 && <>{t("Not yet:")} {data.readiness.activities.filter((a) => !a.allowed).map((a) => a.label).join(", ")}</>}
              </div>
            </div>
            <span className="w-full rounded-xl border border-white/20 px-4 py-3 text-center font-semibold sm:w-auto">{t("Balance ›")}</span>
          </div>
        </Link>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title={t("Today's tasks")} className="lg:col-span-2"
          right={!data.autopilot ? undefined : <span className="text-xs text-slate-500" title={t("Tasks you don't confirm are completed by the simulated crew at their usual adherence.")}>{t("demo autopilot on")}</span>}>
          <div className="space-y-3">
            {data.tasks.map((x) => <TaskRow key={x.task_id} t={x} busy={busy === x.task_id} onConfirm={() => confirm(x.task_id)} />)}
          </div>
        </Card>

        <div className="space-y-5">
          <Card title={t("Energy today")}>
            <Link to="/crew/energy" className="block">
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-bold tabular-nums text-orange-300">{burned}</span>
                <span className="text-lg text-slate-400">{t("kcal burned so far")}</span>
              </div>
              <div className="my-2"><ProgressBar value={burned / Math.max(1, data.energy.kcal_expected)} color="#fdba74" height={12} /></div>
              <div className="text-sm text-slate-400">
                {t("About {n} kcal by the end of the day", { n: data.energy.kcal_expected })}
                {data.intake_yesterday !== null && <> · {t("yesterday you ate {n} kcal", { n: fmt(data.intake_yesterday, 0) })}</>}
              </div>
              {data.energy.live && <div className="mt-1 font-semibold text-orange-300">{t("Workout now: {n} kcal", { n: fmt(data.energy.live.kcal, 0) })}</div>}
              <span className="mt-2 inline-block text-accent">{t("Activities ›")}</span>
            </Link>
          </Card>

          <Card title={t("How are you?")}>
            {data.mind.checkin ? (
              <div className="text-slate-300">
                {t("Checked in today: feeling {f}/5, stress {s}/5.", { f: data.mind.checkin.feeling, s: data.mind.checkin.stress })}
                {data.mind.wellbeing !== null && <div className="mt-1 text-sm text-slate-400">{t("Wellbeing yesterday: {n}/100", { n: fmt(data.mind.wellbeing, 0) })}</div>}
              </div>
            ) : (
              <p className="text-slate-300">{t("Take 30 seconds to say how you feel today.")}</p>
            )}
            <Link to="/crew/mind" className="mt-3 inline-flex min-h-[48px] items-center rounded-xl bg-ink-800 px-4 font-semibold text-accent hover:bg-ink-700">
              {data.mind.checkin ? t("Mind ›") : t("Check in ›")}
            </Link>
          </Card>

          <Card title={t("Last night's sleep")}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-5xl font-bold tabular-nums">{fmt(sleep.value, 1)}</span>
              <span className="text-xl text-slate-400">{t("h")}</span>
              <StatusPill level={sleep.status} />
            </div>
            <div className="mt-1 text-slate-400">
              {t("Efficiency {e}% · your normal {b} h", { e: fmt(data.sleep.sleep_quality.value, 0), b: fmt(sleep.baseline_mean, 1) })}
            </div>
            <Link to="/crew/body" className="mt-2 inline-block text-accent">{t("Sleep history ›")}</Link>
          </Card>

          {data.protocols.length > 0 && (
            <Card title={t("Supplement")}>
              {data.protocols.map((p) => (
                <div key={p.protocol_id} className="rounded-xl bg-ink-850 p-3">
                  <div className="flex justify-between font-semibold"><span>{p.label}</span><span className="tabular-nums">{p.score === null ? "–" : `${Math.round(p.score * 100)}%`}</span></div>
                  <div className="my-2"><ProgressBar value={p.score ?? 0} color={(p.score ?? 0) > 0.6 ? "#22c55e" : (p.score ?? 0) > 0.3 ? "#fbbf24" : "#f43f5e"} /></div>
                  <div className="text-sm text-slate-400">
                    {t("Is it working? Day {d}", { d: p.days_since_start })}
                    {p.days_to_target_left !== null ? ` · ${t("~{n} days to target", { n: Math.ceil(p.days_to_target_left) })}` : p.days_since_start >= 4 ? ` · ${t("not on track to target")}` : ""}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
