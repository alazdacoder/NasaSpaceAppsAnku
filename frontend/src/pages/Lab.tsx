import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, TrendBlock } from "../components/charts";
import { AlertCard, Button, Card, Empty, MetricCard, ProgressBar, SourceTag, StatusPill, Unverified } from "../components/ui";
import { api, dayLabel, fmt, usePoll, type Alert, type Metric, type Protocol, type Task } from "../lib/api";
import { useApp } from "../lib/context";

interface LabData {
  metrics: Record<string, Metric>; alerts: Alert[]; protocols: Protocol[]; bone_alert: Alert | null; stone_alert: Alert | null;
  pending_protocol_task: Task | null;
}

export function ProtocolCard({ p }: { p: Protocol }) {
  const score = p.score ?? 0;
  const color = score > 0.6 ? "#22c55e" : score > 0.3 ? "#fbbf24" : "#f43f5e";
  const rows = (p.targets[0]?.history ?? []).map((h, i) => {
    const r: Record<string, number> = { day: h.day };
    p.targets.forEach((t) => { if (t.history[i]) r[t.metric] = Math.round(t.history[i].progress * 100); });
    r.score = Math.round((p.targets.reduce((s, t) => s + (t.history[i]?.progress ?? 0), 0) / p.targets.length) * 100);
    return r;
  });
  const working = p.score === null ? "Too early to tell" : p.days_since_start < 7 ? "Building up — check again in a few days"
    : score >= 0.6 ? "Yes — markers are moving toward target" : score >= 0.35 ? "Partly — slower than expected" : "No — markers are barely moving";
  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-850 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xl font-bold">{p.label} <SourceTag verified={p.verified} source={p.source} /></div>
          <div className="text-slate-400">{p.dose_text} · since {dayLabel(p.start_day)} ({p.days_since_start} days) · started by {p.started_by}</div>
          <div className="text-sm text-slate-500">adherence {p.adherence === null ? "–" : `${Math.round(p.adherence * 100)}%`}</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-slate-400">Response score</div>
          <div className="text-5xl font-black tabular-nums" style={{ color }}>{p.score === null ? "–" : Math.round(score * 100)}<span className="text-xl">%</span></div>
        </div>
      </div>
      <div className="mt-2"><ProgressBar value={score} color={color} height={14} /></div>
      <div className="mt-3 text-lg"><span className="font-semibold">Is it working? </span>{working}</div>
      <div className="text-slate-400">
        {p.days_to_target_left !== null ? `Estimated ${Math.ceil(p.days_to_target_left)} more days to reach target (exponential fit).`
          : p.score !== null && p.days_since_start >= 4 ? "At the current trend the target will not be reached." : ""}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {p.targets.map((t) => (
          <div key={t.metric} className="rounded-xl bg-ink-900 p-3">
            <div className="flex items-center justify-between font-semibold">{t.label} {t.verified === false && <Unverified source={t.source} />}</div>
            <div className="text-sm text-slate-400">start {fmt(t.start, 2)} → now {fmt(t.current, 2)} → target {fmt(t.target, 2)}</div>
            <div className="mt-2"><ProgressBar value={t.progress} color={color} /></div>
            <div className="mt-1 text-sm">{Math.round(t.progress * 100)}% of the way {t.days_to_target !== null ? `· target ~day ${Math.ceil(t.days_to_target)} of protocol` : ""}</div>
          </div>
        ))}
      </div>
      {rows.length > 1 && (
        <div className="mt-3 h-44">
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="day" tick={AXIS} />
              <YAxis tick={AXIS} domain={[0, 100]} width={40} unit="%" />
              <ReferenceLine y={90} stroke="#22c55e" strokeDasharray="4 4" />
              <Tooltip contentStyle={{ background: "#0a0f1a", border: "1px solid #2c3a55" }} labelFormatter={(d) => dayLabel(Number(d))} />
              <Line dataKey="score" name="Response score" stroke={color} strokeWidth={3} dot={false} isAnimationActive={false} />
              {p.targets.map((t, i) => <Line key={t.metric} dataKey={t.metric} name={t.label} stroke={i ? "#a78bfa" : "#38bdf8"} strokeDasharray="4 3" dot={false} isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Response score = 1 − |current − target| / |start − target| per marker, on smoothed values, clipped to 0–1, averaged.
        It shows how far urine markers have moved toward target. It is not a measure of bioavailability.
      </p>
    </div>
  );
}

export default function Lab() {
  const { crewId } = useApp();
  const { data, refresh } = usePoll<LabData>(`/api/crew/${crewId}/lab`, 3000);
  const [busy, setBusy] = useState(false);
  if (!data) return <Empty />;
  const m = data.metrics;
  const ss = m.caox_ss, vol = m.u_volume, ca = m.u_calcium;
  const order = ["u_volume", "u_calcium", "u_citrate", "u_oxalate", "u_ph", "u_sg", "u_uric_acid", "u_creatinine", "u_sodium", "u_potassium", "u_magnesium"];
  const start = async () => {
    if (!data.pending_protocol_task) return;
    setBusy(true);
    try { await api(`/api/crew/${crewId}/tasks/${encodeURIComponent(data.pending_protocol_task.task_id)}/confirm`, { method: "POST" }); await refresh(); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <h1 className="text-3xl font-bold">Lab <span className="text-lg font-normal text-slate-400">· urine sensor bay (UWMS), 24 h samples</span></h1>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Kidney-stone risk" className="lg:col-span-2" right={ss && <StatusPill level={ss.status} />}>
          {ss && (
            <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
              <div>
                <div className="text-sm text-slate-400">CaOx supersaturation (smoothed)</div>
                <div className="text-6xl font-black tabular-nums" style={{ color: (ss.ewma ?? 0) > 2 ? "#f43f5e" : (ss.ewma ?? 0) > 1.8 ? "#fbbf24" : "#22c55e" }}>{fmt(ss.ewma, 2)}</div>
                <div className="text-sm text-slate-400">risk threshold 2.0 <SourceTag verified source="https://ntrs.nasa.gov/citations/20090019087" /></div>
                <div className="mt-1 text-sm text-slate-400">your preflight baseline {fmt(ss.baseline_mean, 2)}</div>
                <div className="mt-2"><Unverified source={ss.estimate_note ?? undefined} /> <span className="text-xs text-slate-500">estimate, not EQUIL2</span></div>
                <div className="mt-3 text-sm text-slate-400">Urine volume</div>
                <div className="text-3xl font-bold">{fmt(vol?.ewma, 2)} <span className="text-base text-slate-400">L/day</span></div>
                <div className="text-sm text-slate-400">risk higher &lt;2.0 · lowest &gt;2.5 <SourceTag verified source="https://ntrs.nasa.gov/citations/20000084164" /></div>
              </div>
              <TrendBlock m={ss} height={230} />
            </div>
          )}
          {data.stone_alert && <div className="mt-3"><AlertCard alert={data.stone_alert} /></div>}
          {data.pending_protocol_task && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border-2 border-bad/60 bg-bad/10 p-4">
              <div className="flex-1">
                <div className="text-lg font-bold">Recommended: {data.pending_protocol_task.title}</div>
                <div className="text-slate-300">{data.pending_protocol_task.detail}. The task is on your Today screen.</div>
              </div>
              <Button kind="danger" disabled={busy} onClick={start}>Start & take dose</Button>
            </div>
          )}
        </Card>

        <Card title="Bone-loss indicators" right={data.bone_alert ? <StatusPill level={data.bone_alert.level} /> : <StatusPill level="green" text="No warning" />}>
          {ca && (
            <>
              <div className="text-sm text-slate-400">Urine calcium vs your baseline</div>
              <div className="text-4xl font-bold">{ca.pct !== null && ca.pct !== undefined ? `${ca.pct > 0 ? "+" : ""}${fmt(ca.pct, 0)}%` : "–"}</div>
              <div className="text-sm text-slate-400">{fmt(ca.ewma, 0)} mg/day · baseline {fmt(ca.baseline_mean, 0)} · trend {fmt(ca.slope, 1)} mg/day per day</div>
              <div className="mt-1 text-sm text-slate-300">In flight, urine calcium can rise up to ~50% as bone breaks down. <SourceTag verified source="https://ntrs.nasa.gov/citations/20000084164" /></div>
            </>
          )}
          {m.ared_week_min && (
            <div className="mt-3">
              <div className="text-sm text-slate-400">Resistance exercise (ARED), last 7 days</div>
              <div className="text-3xl font-bold">{fmt(m.ared_week_min.value, 0)} <span className="text-base text-slate-400">min</span></div>
            </div>
          )}
          {data.bone_alert && <div className="mt-3"><AlertCard alert={data.bone_alert} /></div>}
          {ca && <div className="mt-3"><TrendBlock m={ca} height={150} /></div>}
        </Card>
      </div>

      <Card title="Is the supplement protocol working?">
        {data.protocols.length === 0 ? <p className="text-slate-400">No protocol yet.</p> : (
          <div className="space-y-4">{data.protocols.map((p) => <ProtocolCard key={p.protocol_id} p={p} />)}</div>
        )}
      </Card>

      {data.alerts.filter((a) => a.id !== "stone_risk" && a.id !== "bone_loss").length > 0 && (
        <Card title="Other lab alerts">
          <div className="space-y-3">{data.alerts.filter((a) => a.id !== "stone_risk" && a.id !== "bone_loss").map((a) => <AlertCard key={a.id} alert={a} />)}</div>
        </Card>
      )}

      <Card title="Urine results against your baseline">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {order.filter((k) => m[k]).map((k) => <MetricCard key={k} m={m[k]} />)}
        </div>
      </Card>
    </div>
  );
}
