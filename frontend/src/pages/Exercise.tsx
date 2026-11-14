import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AXIS, GRID, TrendBlock } from "../components/charts";
import { Button, Card, Empty, ProgressBar, Stat, cx } from "../components/ui";
import { api, dayLabel, fmt, usePoll, type Metric, type Task } from "../lib/api";
import { useApp } from "../lib/context";

interface WorkoutView {
  active: boolean; device?: "ared" | "t2" | "cevis"; device_label?: string; settings?: Record<string, any>;
  elapsed_s?: number; hr?: number; hr_source?: string; samples?: { t: number; hr: number }[];
  sets_done?: { exercise: string; load_kg: number; reps: number }[]; scale?: number; target_hr?: number;
}
interface ExerciseData {
  today: { slot: string; device: "ared" | "t2" | "cevis"; minutes: number; label: string }[];
  tasks: Task[]; weekly_target_min: number; weekly_range_min: [number, number]; last7_min: number; today_min: number;
  weeks: { week: number; label: string; ared: number; t2: number; cevis: number; total: number }[];
  strength: Record<string, { day: number; load_kg: number }[]>;
  sessions: { id: number; day: number; device: string; minutes: number; avg_hr: number; max_hr: number; details: any; source: string }[];
  trends: Record<string, Metric>; limits: { ared_peak_load_kg: number; t2_peak_speed_kmh: number; cevis_max_watts: number; source: string };
  ared_exercises: string[]; defaults: Record<string, number>; workout: WorkoutView; hr_rest: number;
}
interface Summary { device: string; minutes: number; avg_hr: number; max_hr: number; details: any; samples: { t: number; hr: number }[]; last7_min: number; weekly_target_min: number }

const DEV_LABEL: Record<string, string> = { ared: "ARED", t2: "T2 treadmill", cevis: "CEVIS cycle" };
const DEV_COLOR: Record<string, string> = { ared: "#38bdf8", t2: "#a78bfa", cevis: "#34d399" };
const EX_COLOR = ["#38bdf8", "#a78bfa", "#34d399", "#f472b6"];

function mmss(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function Stepper({ label, value, unit, step, onChange, max, min = 0, decimals = 0 }: {
  label: string; value: number; unit: string; step: number; onChange: (v: number) => void; max: number; min?: number; decimals?: number;
}) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <button aria-label={`Decrease ${label}`} className="h-14 w-14 rounded-xl bg-ink-700 text-3xl font-bold active:bg-ink-600" onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}>−</button>
        <div className="min-w-[90px] flex-1 text-center">
          <span className="text-3xl font-bold tabular-nums">{fmt(value, decimals)}</span>
          <span className="ml-1 text-slate-400">{unit}</span>
        </div>
        <button aria-label={`Increase ${label}`} className="h-14 w-14 rounded-xl bg-ink-700 text-3xl font-bold active:bg-ink-600" onClick={() => onChange(Math.min(max, +(value + step).toFixed(2)))}>+</button>
      </div>
      <div className="mt-1 text-xs text-slate-500">max {max} {unit}</div>
    </div>
  );
}

/** Real heart-rate strap over Web Bluetooth (standard Heart Rate service 0x180D). */
function useBluetoothHR(crewId: string) {
  const [state, setState] = useState<"idle" | "connecting" | "connected" | "unsupported" | "error">(
    typeof navigator !== "undefined" && (navigator as any).bluetooth ? "idle" : "unsupported");
  const [bpm, setBpm] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const lastPost = useRef(0);
  const connect = async () => {
    const bt = (navigator as any).bluetooth;
    if (!bt) { setState("unsupported"); return; }
    try {
      setState("connecting");
      const device = await bt.requestDevice({ filters: [{ services: ["heart_rate"] }] });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService("heart_rate");
      const ch = await service.getCharacteristic("heart_rate_measurement");
      ch.addEventListener("characteristicvaluechanged", (ev: any) => {
        const v: DataView = ev.target.value;
        const flags = v.getUint8(0);
        const hr = flags & 1 ? v.getUint16(1, true) : v.getUint8(1);
        setBpm(hr);
        const now = Date.now();
        if (now - lastPost.current > 900) {
          lastPost.current = now;
          api(`/api/crew/${crewId}/workout/hr`, { body: { bpm: hr } }).catch(() => undefined);
        }
      });
      await ch.startNotifications();
      device.addEventListener("gattserverdisconnected", () => setState("idle"));
      setState("connected");
      setMsg(device.name ?? "HR strap");
    } catch (e: any) {
      setState("error");
      setMsg(e?.message ?? "Could not connect");
    }
  };
  return { state, bpm, msg, connect };
}

function LiveWorkout({ crewId, view, onFinish, exercises, limits }: {
  crewId: string; view: WorkoutView; onFinish: (s: Summary) => void;
  exercises: string[]; limits: ExerciseData["limits"];
}) {
  const [live, setLive] = useState<WorkoutView>(view);
  const bt = useBluetoothHR(crewId);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    let ws: WebSocket | null = null;
    let poll: number | undefined;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws/crew/${crewId}/workout`);
      ws.onmessage = (e) => setLive(JSON.parse(e.data));
      ws.onerror = () => { poll = window.setInterval(() => api<WorkoutView>(`/api/crew/${crewId}/workout`).then(setLive), 1000); };
    } catch {
      poll = window.setInterval(() => api<WorkoutView>(`/api/crew/${crewId}/workout`).then(setLive), 1000);
    }
    return () => { ws?.close(); if (poll) window.clearInterval(poll); };
  }, [crewId]);

  if (!live.active) return null;
  const s = live.settings ?? {};
  const update = (settings: Record<string, any>, log_set = false) =>
    api<WorkoutView>(`/api/crew/${crewId}/workout/update`, { body: { settings, log_set } }).then(setLive);
  const finish = async () => onFinish(await api<Summary>(`/api/crew/${crewId}/workout/finish`, { method: "POST" }));
  const cancel = async () => { await api(`/api/crew/${crewId}/workout/cancel`, { method: "POST" }); onFinish(null as any); };

  return (
    <Card className="border-accent/60" title={<span>Live: {live.device_label}</span>}
      right={<span className="rounded-full bg-bad/20 px-3 py-1 text-sm font-bold text-bad">● REC</span>}>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-3">
          <div className="flex items-end gap-4 rounded-2xl bg-ink-850 p-4">
            <div>
              <div className="text-sm text-slate-400">Heart rate · {live.hr_source}</div>
              <div className="text-7xl font-black tabular-nums text-rose-400">{live.hr}<span className="ml-1 text-2xl font-semibold text-slate-400">bpm</span></div>
              <div className="text-sm text-slate-400">target ≈ {live.target_hr} bpm for this intensity</div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-sm text-slate-400">Elapsed</div>
              <div className="text-4xl font-bold tabular-nums">{mmss(live.elapsed_s ?? 0)}</div>
              <div className="text-xs text-slate-500">demo time ×{live.scale}</div>
            </div>
          </div>
          {live.device === "ared" && (
            <>
              <div className="flex flex-wrap gap-2">
                {exercises.map((e) => (
                  <button key={e} onClick={() => update({ exercise: e })}
                    className={cx("min-h-[48px] rounded-xl px-4 font-semibold capitalize", s.exercise === e ? "bg-accent text-ink-950" : "bg-ink-800 text-slate-200")}>{e}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Stepper label="Load" value={Number(s.load_kg)} unit="kg" step={5} max={limits.ared_peak_load_kg} onChange={(v) => update({ load_kg: v })} />
                <Stepper label="Reps" value={Number(s.reps)} unit="" step={1} min={1} max={30} onChange={(v) => update({ reps: v })} />
              </div>
              <Button kind="primary" className="w-full text-lg" onClick={() => update({}, true)}>Log set ({(live.sets_done ?? []).length} done)</Button>
              {(live.sets_done ?? []).length > 0 && (
                <ol className="space-y-1 text-slate-300">
                  {live.sets_done!.map((x, i) => <li key={i}>Set {i + 1}: <span className="capitalize">{x.exercise}</span> · {x.load_kg} kg × {x.reps}</li>)}
                </ol>
              )}
            </>
          )}
          {live.device === "t2" && (
            <div className="grid grid-cols-2 gap-3">
              <Stepper label="Speed" value={Number(s.speed_kmh)} unit="km/h" step={0.5} decimals={1} max={limits.t2_peak_speed_kmh} onChange={(v) => update({ speed_kmh: v })} />
              <Stepper label="Harness load" value={Number(s.harness_kg)} unit="kg" step={2} max={150} onChange={(v) => update({ harness_kg: v })} />
            </div>
          )}
          {live.device === "cevis" && (
            <Stepper label="Power" value={Number(s.watts)} unit="W" step={10} max={limits.cevis_max_watts} onChange={(v) => update({ watts: v })} />
          )}
          <div className="flex gap-3">
            <Button kind="ok" className="flex-1 text-lg" onClick={finish}>Finish & log</Button>
            <Button kind="ghost" onClick={cancel}>Cancel</Button>
          </div>
          <div className="rounded-xl border border-ink-700 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold">Real HR strap (optional)</span>
              {bt.state === "unsupported" ? <span className="text-slate-500">Web Bluetooth not available in this browser</span> : (
                <Button kind="ghost" onClick={bt.connect} disabled={bt.state === "connecting" || bt.state === "connected"}>
                  {bt.state === "connected" ? `Connected: ${bt.msg}` : bt.state === "connecting" ? "Connecting…" : "Connect via Bluetooth"}
                </Button>
              )}
              {bt.bpm !== null && <span className="text-rose-300">{bt.bpm} bpm</span>}
              {bt.state === "error" && <span className="text-bad">{bt.msg}</span>}
            </div>
          </div>
        </div>
        <div className="h-[340px] rounded-2xl bg-ink-850 p-3">
          <ResponsiveContainer>
            <LineChart data={live.samples ?? []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="t" tick={AXIS} tickFormatter={(t) => mmss(t)} type="number" domain={["dataMin", "dataMax"]} />
              <YAxis tick={AXIS} domain={[50, 190]} width={40} />
              {live.target_hr && <ReferenceLine y={live.target_hr} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: "target", fill: "#fbbf24", fontSize: 12 }} />}
              <Line type="monotone" dataKey="hr" stroke="#fb7185" strokeWidth={3} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}

export default function Exercise() {
  const { crewId } = useApp();
  const { data, refresh } = usePoll<ExerciseData>(`/api/crew/${crewId}/exercise`, 4000);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [params, setParams] = useSearchParams();
  const [starting, setStarting] = useState(false);

  const start = async (device: string) => {
    setStarting(true);
    try {
      await api(`/api/crew/${crewId}/workout/start`, { body: { device } });
      setSummary(null);
      await refresh();
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
  const pct = data.last7_min / data.weekly_target_min;
  const strengthDays = Array.from(new Set(Object.values(data.strength).flat().map((p) => p.day))).sort((a, b) => a - b);
  const strengthRows = strengthDays.map((d) => {
    const row: Record<string, number> = { day: d };
    for (const [ex, pts] of Object.entries(data.strength)) {
      const p = pts.find((x) => x.day === d);
      if (p) row[ex] = p.load_kg;
    }
    return row;
  });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <h1 className="text-3xl font-bold">Exercise</h1>

      {data.workout.active ? (
        <LiveWorkout crewId={crewId} view={data.workout} exercises={data.ared_exercises} limits={data.limits}
          onFinish={(s) => { setSummary(s); refresh(); }} />
      ) : (
        <Card title="Today's prescription">
          <div className="grid gap-3 sm:grid-cols-2">
            {data.today.map((p) => {
              const task = data.tasks.find((t) => t.task_id === `workout:${p.slot}`);
              const done = task?.status === "done";
              return (
                <div key={p.slot} className={cx("rounded-2xl border p-4", done ? "border-ok/50 bg-ok/5" : "border-ink-700 bg-ink-850")}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xl font-bold">{p.label}</div>
                      <div className="text-slate-400">{p.minutes} min · {task?.detail}</div>
                    </div>
                    {done && <span className="text-2xl text-ok">✓</span>}
                  </div>
                  <Button className="mt-3 w-full text-lg" disabled={starting} onClick={() => start(p.device)}>
                    {done ? "Start another session" : "Start live workout"}
                  </Button>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-400">
            Other machine:
            {(["ared", "t2", "cevis"] as const).filter((d) => !data.today.some((p) => p.device === d)).map((d) => (
              <button key={d} className="rounded-lg border border-ink-600 px-3 py-1.5 text-slate-200" onClick={() => start(d)}>{DEV_LABEL[d]}</button>
            ))}
          </div>
        </Card>
      )}

      {summary && (
        <Card title="Session summary" className="border-ok/50" right={<button className="text-slate-400" onClick={() => setSummary(null)}>Close ✕</button>}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Machine" value={DEV_LABEL[summary.device]} />
            <Stat label="Time" value={fmt(summary.minutes, 1)} unit="min" />
            <Stat label="Avg heart rate" value={summary.avg_hr} unit="bpm" />
            <Stat label="Max heart rate" value={summary.max_hr} unit="bpm" />
          </div>
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-sm"><span>Last 7 days: {summary.last7_min} min</span><span>target {summary.weekly_target_min} min/week</span></div>
            <ProgressBar value={summary.last7_min / summary.weekly_target_min} color="#22c55e" height={14} />
          </div>
          {summary.details?.exercises && (
            <div className="mt-2 text-slate-300">{summary.details.exercises.map((e: any) => `${e.exercise} ${e.load_kg} kg × ${e.sets} sets`).join(" · ")}</div>
          )}
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="This week" className="lg:col-span-1">
          <div className="text-5xl font-bold tabular-nums">{data.last7_min}<span className="ml-1 text-xl text-slate-400">min</span></div>
          <div className="mt-1 text-slate-400">last 7 days · target ~{data.weekly_target_min} (range {lo}–{hi})</div>
          <div className="mt-3"><ProgressBar value={pct} height={16} marker={lo / data.weekly_target_min} color={data.last7_min < lo ? "#fbbf24" : "#22c55e"} /></div>
          <p className="mt-3 text-sm text-slate-300">
            {data.last7_min < lo ? "Below the usual in-flight range. Exercise protects bone, muscle and heart." :
              data.last7_min > hi ? "Above the usual range. Make sure you recover." : "Inside the usual in-flight range (450–720 min/week)."}
          </p>
          <p className="mt-2 text-xs text-slate-500">Source: {data.limits.source}</p>
        </Card>
        <Card title="Weekly minutes vs target" className="lg:col-span-2">
          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={data.weeks.slice(-12)} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={AXIS} />
                <YAxis tick={AXIS} width={44} />
                <ReferenceArea y1={lo} y2={hi} fill="#22c55e" fillOpacity={0.08} />
                <ReferenceLine y={data.weekly_target_min} stroke="#22c55e" strokeDasharray="5 5" label={{ value: "600 target", fill: "#22c55e", fontSize: 12, position: "insideTopLeft" }} />
                <Tooltip contentStyle={{ background: "#0a0f1a", border: "1px solid #2c3a55" }} />
                <Legend />
                <Bar dataKey="ared" stackId="a" name="ARED" fill={DEV_COLOR.ared} />
                <Bar dataKey="t2" stackId="a" name="T2" fill={DEV_COLOR.t2} />
                <Bar dataKey="cevis" stackId="a" name="CEVIS" fill={DEV_COLOR.cevis} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-slate-500">The current week is partial.</p>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Strength trend (ARED best load per day)">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={strengthRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="day" tick={AXIS} type="number" domain={["dataMin", "dataMax"]} tickFormatter={(d) => (d < 0 ? `L${d}` : d)} />
                <YAxis tick={AXIS} width={44} unit=" kg" />
                <Tooltip contentStyle={{ background: "#0a0f1a", border: "1px solid #2c3a55" }} labelFormatter={(d) => dayLabel(Number(d))} />
                <Legend />
                {Object.keys(data.strength).map((ex, i) => (
                  <Line key={ex} dataKey={ex} stroke={EX_COLOR[i % 4]} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-sm text-slate-400">Peak ARED load is {data.limits.ared_peak_load_kg} kg. A falling line means lost strength.</p>
        </Card>
        <Card title="Fitness trend">
          <div className="space-y-4">
            {data.trends.cevis_watts && <TrendBlock m={data.trends.cevis_watts} height={130} />}
            {data.trends.hr_exercise && <TrendBlock m={data.trends.hr_exercise} height={130} />}
          </div>
        </Card>
      </div>

      <Card title="Recent sessions">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead className="text-sm text-slate-400"><tr><th className="py-2">Day</th><th>Machine</th><th>Time</th><th>Avg / max HR</th><th>Details</th><th>Logged by</th></tr></thead>
            <tbody>
              {data.sessions.map((s) => (
                <tr key={s.id} className="border-t border-ink-800">
                  <td className="py-2">{dayLabel(s.day)}</td>
                  <td>{DEV_LABEL[s.device]}</td>
                  <td>{fmt(s.minutes, 0)} min</td>
                  <td>{s.avg_hr} / {s.max_hr}</td>
                  <td className="text-sm text-slate-300">
                    {s.details.exercises ? s.details.exercises.map((e: any) => `${e.exercise} ${e.load_kg} kg`).join(", ")
                      : s.details.speed_kmh ? `${s.details.speed_kmh} km/h, harness ${s.details.harness_kg} kg` : `${s.details.watts} W`}
                  </td>
                  <td className="text-sm text-slate-400">{s.source === "user" ? "you (live)" : s.source === "task" ? "you (tap)" : "simulated"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
