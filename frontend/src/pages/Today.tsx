import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, Empty, ProgressBar, StatusPill, Unverified, cx } from "../components/ui";
import { LEVEL_COLOR, LEVEL_TEXT, api, fmt, missionTime, usePoll, type Alert, type Level, type Metric, type Task } from "../lib/api";
import { useApp } from "../lib/context";

interface TodayData {
  crew: { id: string; name: string; role: string };
  overall: Level; alerts: Alert[]; tasks: Task[];
  sleep: { sleep_h: Metric; sleep_quality: Metric };
  water_target_l: number;
  protocols: { protocol_id: number; label: string; score: number | null; days_since_start: number; days_to_target_left: number | null; dose_text: string }[];
  live: Record<string, number>; autopilot: boolean; workout_active: boolean;
}

const STATUS_LABEL: Record<string, string> = { done: "Done", auto: "Done (auto-logged)", missed: "Missed", expired: "Expired" };

export function TaskRow({ t, onConfirm, busy }: { t: Task; onConfirm: () => void; busy: boolean }) {
  const nav = useNavigate();
  const done = t.status === "done";
  const isStart = t.kind === "supplement_start";
  return (
    <div className={cx("flex flex-wrap items-center gap-4 rounded-xl border p-4",
      done ? "border-ok/40 bg-ok/5" : isStart ? "border-bad/60 bg-bad/10" : "border-ink-700 bg-ink-850")}>
      <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl font-bold",
        done ? "bg-ok text-ink-950" : "border-2 border-ink-600 text-slate-500")}>{done ? "✓" : ""}</span>
      <div className="min-w-0 flex-1">
        <div className="text-lg font-semibold">{t.title}</div>
        <div className="text-slate-400">{t.detail}</div>
        {isStart && (
          <div className="mt-1 text-sm text-rose-200">
            From Lab alert “{t.payload.alert_title}”: {t.payload.reason}
            {t.payload.verified === false && <Unverified className="ml-2" />}
          </div>
        )}
      </div>
      {done ? (
        <span className="font-semibold text-ok">{STATUS_LABEL.done}</span>
      ) : (
        <div className="flex gap-2">
          {t.kind === "workout" && (
            <Button kind="ghost" onClick={() => nav(`/exercise?start=${t.payload.device}`)}>Start live</Button>
          )}
          <Button kind={isStart ? "danger" : "ok"} onClick={onConfirm} disabled={busy} className="min-w-[140px]">
            {isStart ? "Start & take dose" : t.kind === "workout" ? "Mark done" : "Confirm"}
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
  const pending = data.tasks.filter((t) => t.status !== "done").length;
  const sleep = data.sleep.sleep_h;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Status header */}
      <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-ink-700 bg-ink-900 p-5">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full"
          style={{ background: `${LEVEL_COLOR[data.overall]}22`, border: `5px solid ${LEVEL_COLOR[data.overall]}` }}>
          <span className="text-center text-sm font-bold uppercase leading-tight" style={{ color: LEVEL_COLOR[data.overall] }}>
            {LEVEL_TEXT[data.overall]}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm uppercase tracking-wide text-slate-400">Good {(clock?.hour ?? 8) < 12 ? "morning" : (clock?.hour ?? 8) < 18 ? "afternoon" : "evening"}</div>
          <h1 className="text-3xl font-bold">{data.crew.name}</h1>
          <div className="text-slate-400">{data.crew.role} · {missionTime(clock)} · {pending} task{pending === 1 ? "" : "s"} left today</div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Heart rate", fmt(data.live.hr, 0), "bpm"],
            ["Blood O₂", fmt(data.live.spo2, 0), "%"],
            ["Core temp", fmt(data.live.core_temp, 1), "°C"],
            ["CO₂", fmt(data.live.co2_mmhg, 1), "mmHg"],
          ].map(([l, v, u]) => (
            <div key={l} className="rounded-xl bg-ink-850 px-3 py-2 text-center">
              <div className="text-xs text-slate-400">{l}</div>
              <div className="text-2xl font-bold tabular-nums">{v}<span className="ml-1 text-sm font-normal text-slate-400">{u}</span></div>
            </div>
          ))}
        </div>
      </div>

      {/* Alert banner — one tap to all alerts */}
      {top ? (
        <Link to="/alerts" className="block">
          <div className={cx("flex items-center gap-4 rounded-2xl border-2 p-4 transition hover:brightness-110",
            top.level === "red" ? "border-bad bg-bad/15" : "border-warn bg-warn/10")}>
            <span className="text-3xl" aria-hidden>{top.level === "red" ? "⚠" : "!"}</span>
            <div className="min-w-0 flex-1">
              <div className="text-xl font-bold">{top.title}</div>
              <div className="text-slate-200">{top.reason}</div>
              {top.recs[0] && <div className="mt-1 font-semibold text-accent">→ {top.recs[0].text}</div>}
            </div>
            <span className="shrink-0 rounded-xl border border-white/20 px-4 py-3 font-semibold">
              {data.alerts.length > 1 ? `All ${data.alerts.length} alerts ›` : "Details ›"}
            </span>
          </div>
        </Link>
      ) : (
        <div className="rounded-2xl border border-ok/40 bg-ok/5 p-4 text-lg font-semibold text-ok">No alerts. Keep going.</div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Today's tasks" className="lg:col-span-2"
          right={!data.autopilot ? undefined : <span className="text-xs text-slate-500" title="Tasks you don't confirm are completed by the simulated crew at their usual adherence.">demo autopilot on</span>}>
          <div className="space-y-3">
            {data.tasks.map((t) => <TaskRow key={t.task_id} t={t} busy={busy === t.task_id} onConfirm={() => confirm(t.task_id)} />)}
          </div>
        </Card>

        <div className="space-y-5">
          <Card title="Last night's sleep">
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-bold tabular-nums">{fmt(sleep.value, 1)}</span>
              <span className="text-xl text-slate-400">h</span>
              <StatusPill level={sleep.status} />
            </div>
            <div className="mt-1 text-slate-400">
              Efficiency {fmt(data.sleep.sleep_quality.value, 0)}% · your preflight baseline {fmt(sleep.baseline_mean, 1)} h
            </div>
            <p className="mt-2 text-sm text-slate-300">{sleep.meaning}</p>
            <Link to="/body" className="mt-2 inline-block text-accent">Sleep history ›</Link>
          </Card>

          <Card title="Supplement protocols">
            {data.protocols.length === 0 && <p className="text-slate-400">No active protocol.</p>}
            {data.protocols.map((p) => (
              <Link to="/lab" key={p.protocol_id} className="block rounded-xl bg-ink-850 p-3 hover:bg-ink-800">
                <div className="flex justify-between font-semibold"><span>{p.label}</span><span className="tabular-nums">{p.score === null ? "–" : `${Math.round(p.score * 100)}%`}</span></div>
                <div className="my-2"><ProgressBar value={p.score ?? 0} color={(p.score ?? 0) > 0.6 ? "#22c55e" : (p.score ?? 0) > 0.3 ? "#fbbf24" : "#f43f5e"} /></div>
                <div className="text-sm text-slate-400">
                  Response score · day {p.days_since_start}
                  {p.days_to_target_left !== null ? ` · ~${Math.ceil(p.days_to_target_left)} days to target` : p.days_since_start >= 4 ? " · not on track to target" : ""}
                </div>
              </Link>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
