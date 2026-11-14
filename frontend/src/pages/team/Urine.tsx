import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, TIP, TrendBlock } from "../../components/charts";
import { AlertCard, Card, Empty, GroundNote, MetricCard, PageTitle, ProgressBar, SourceTag, StatusPill, Unverified } from "../../components/ui";
import { dayLabel, dayTick, fmt, usePoll, type Alert, type Metric, type Protocol, type ViewInfo } from "../../lib/api";
import { useApp, useCrewName } from "../../lib/context";
import { t } from "../../lib/i18n";

interface LabData {
  metrics: Record<string, Metric>; alerts: Alert[]; protocols: Protocol[]; bone_alert: Alert | null; stone_alert: Alert | null;
  pending_protocol_task: { task_id: string; title: string; detail?: string; status: string } | null; view: ViewInfo;
}

export function ProtocolCard({ p }: { p: Protocol }) {
  const score = p.score ?? 0;
  const color = score > 0.6 ? "#22c55e" : score > 0.3 ? "#fbbf24" : "#f43f5e";
  const rows = (p.targets[0]?.history ?? []).map((h, i) => {
    const r: Record<string, number> = { day: h.day };
    p.targets.forEach((x) => { if (x.history[i]) r[x.metric] = Math.round(x.history[i].progress * 100); });
    r.score = Math.round((p.targets.reduce((s, x) => s + (x.history[i]?.progress ?? 0), 0) / p.targets.length) * 100);
    return r;
  });
  const working = p.score === null ? t("Too early to tell") : p.days_since_start < 7 ? t("Building up — check again in a few days")
    : score >= 0.6 ? t("Yes — markers are moving toward target") : score >= 0.35 ? t("Partly — slower than expected") : t("No — markers are barely moving");
  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-850 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xl font-bold">{p.label} <SourceTag verified={p.verified} source={p.source} /></div>
          <div className="text-slate-400">{t("{dose} · since {d} ({n} days) · started by {who}", { dose: p.dose_text, d: dayLabel(p.start_day), n: p.days_since_start, who: t(p.started_by) })}</div>
          <div className="text-sm text-slate-500">{t("adherence {a}", { a: p.adherence === null ? "–" : `${Math.round(p.adherence * 100)}%` })}</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-slate-400">{t("Response score")}</div>
          <div className="text-5xl font-black tabular-nums" style={{ color }}>{p.score === null ? "–" : Math.round(score * 100)}<span className="text-xl">%</span></div>
        </div>
      </div>
      <div className="mt-2"><ProgressBar value={score} color={color} height={14} /></div>
      <div className="mt-3 text-lg"><span className="font-semibold">{t("Is it working?")} </span>{working}</div>
      <div className="text-slate-400">
        {p.days_to_target_left !== null ? t("Estimated {n} more days to reach target (exponential fit).", { n: Math.ceil(p.days_to_target_left) })
          : p.score !== null && p.days_since_start >= 4 ? t("At the current trend the target will not be reached.") : ""}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {p.targets.map((x) => (
          <div key={x.metric} className="rounded-xl bg-ink-900 p-3">
            <div className="flex items-center justify-between font-semibold">{x.label} {x.verified === false && <Unverified source={x.source} />}</div>
            <div className="text-sm text-slate-400">{t("start {a} → now {b} → target {c}", { a: fmt(x.start, 2), b: fmt(x.current, 2), c: fmt(x.target, 2) })}</div>
            <div className="mt-2"><ProgressBar value={x.progress} color={color} /></div>
            <div className="mt-1 text-sm">{t("{p}% of the way", { p: Math.round(x.progress * 100) })} {x.days_to_target !== null ? `· ${t("target ~day {n} of protocol", { n: Math.ceil(x.days_to_target) })}` : ""}</div>
          </div>
        ))}
      </div>
      {rows.length > 1 && (
        <div className="mt-3 h-44">
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="day" tick={AXIS} tickFormatter={dayTick} />
              <YAxis tick={AXIS} domain={[0, 100]} width={40} unit="%" />
              <ReferenceLine y={90} stroke="#22c55e" strokeDasharray="4 4" />
              <Tooltip contentStyle={TIP} labelFormatter={(d) => dayLabel(Number(d))} />
              <Line dataKey="score" name={t("Response score")} stroke={color} strokeWidth={3} dot={false} isAnimationActive={false} />
              {p.targets.map((x, i) => <Line key={x.metric} dataKey={x.metric} name={x.label} stroke={i ? "#a78bfa" : "#38bdf8"} strokeDasharray="4 3" dot={false} isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">
        {t("Response score = 1 − |current − target| / |start − target| per marker, on smoothed values, clipped to 0–1, averaged. It shows how far urine markers have moved toward target. It is not a measure of bioavailability.")}
      </p>
    </div>
  );
}

export default function Urine() {
  const { crewId } = useApp();
  const name = useCrewName();
  const { data } = usePoll<LabData>(`/api/crew/${crewId}/lab?side=ground`, 4000);
  if (!data) return <Empty />;
  const m = data.metrics;
  const ss = m.caox_ss, vol = m.u_volume, ca = m.u_calcium;
  const order = ["u_volume", "u_calcium", "u_citrate", "u_oxalate", "u_ph", "u_sg", "u_uric_acid", "u_creatinine", "u_sodium", "u_potassium", "u_magnesium"];
  const others = data.alerts.filter((a) => a.id !== "stone_risk" && a.id !== "bone_loss");

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageTitle sub={t("Urine sensor bay (UWMS), 24 h samples")}>{t("Urine lab · {n}", { n: name })}</PageTitle>
      <GroundNote view={data.view} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title={t("Kidney-stone risk")} className="lg:col-span-2" right={ss && <StatusPill level={ss.status} />}>
          {ss && (
            <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
              <div>
                <div className="text-sm text-slate-400">{t("CaOx supersaturation (smoothed)")}</div>
                <div className="text-6xl font-black tabular-nums" style={{ color: (ss.ewma ?? 0) > 2 ? "#f43f5e" : (ss.ewma ?? 0) > 1.8 ? "#fbbf24" : "#22c55e" }}>{fmt(ss.ewma, 2)}</div>
                <div className="text-sm text-slate-400">{t("risk threshold 2.0")} <SourceTag verified source="https://ntrs.nasa.gov/citations/20090019087" /></div>
                <div className="mt-1 text-sm text-slate-400">{t("preflight baseline {v}", { v: fmt(ss.baseline_mean, 2) })}</div>
                <div className="mt-2"><Unverified source={ss.estimate_note ?? undefined} /> <span className="text-xs text-slate-500">{t("estimate, not EQUIL2")}</span></div>
                <div className="mt-3 text-sm text-slate-400">{t("Urine volume")}</div>
                <div className="text-3xl font-bold">{fmt(vol?.ewma, 2)} <span className="text-base text-slate-400">{t("L/day")}</span></div>
                <div className="text-sm text-slate-400">{t("risk higher <2.0 · lowest >2.5")} <SourceTag verified source="https://ntrs.nasa.gov/citations/20000084164" /></div>
              </div>
              <TrendBlock m={ss} height={230} />
            </div>
          )}
          {data.stone_alert && <div className="mt-3"><AlertCard alert={data.stone_alert} /></div>}
          {data.pending_protocol_task && (
            <div className="mt-3 rounded-xl border-2 border-bad/60 bg-bad/10 p-4">
              <div className="text-lg font-bold">{t("Recommended to the crew member: {x}", { x: data.pending_protocol_task.title })}</div>
              <div className="text-slate-300">{data.pending_protocol_task.status === "done" ? t("Accepted onboard.") : t("Waiting for the crew member to accept it on their Today screen.")}</div>
            </div>
          )}
        </Card>

        <Card title={t("Bone-loss indicators")} right={data.bone_alert ? <StatusPill level={data.bone_alert.level} /> : <StatusPill level="green" text={t("No warning")} />}>
          {ca && (
            <>
              <div className="text-sm text-slate-400">{t("Urine calcium vs preflight baseline")}</div>
              <div className="text-4xl font-bold">{ca.pct !== null && ca.pct !== undefined ? `${ca.pct > 0 ? "+" : ""}${fmt(ca.pct, 0)}%` : "–"}</div>
              <div className="text-sm text-slate-400">{t("{v} mg/day · baseline {b} · trend {s} mg/day per day", { v: fmt(ca.ewma, 0), b: fmt(ca.baseline_mean, 0), s: fmt(ca.slope, 1) })}</div>
              <div className="mt-1 text-sm text-slate-300">{t("In flight, urine calcium can rise up to ~50% as bone breaks down.")} <SourceTag verified source="https://ntrs.nasa.gov/citations/20000084164" /></div>
            </>
          )}
          {m.ared_week_min && (
            <div className="mt-3">
              <div className="text-sm text-slate-400">{t("Resistance exercise (ARED), last 7 days")}</div>
              <div className="text-3xl font-bold">{fmt(m.ared_week_min.value, 0)} <span className="text-base text-slate-400">{t("min")}</span></div>
            </div>
          )}
          {data.bone_alert && <div className="mt-3"><AlertCard alert={data.bone_alert} /></div>}
          {ca && <div className="mt-3"><TrendBlock m={ca} height={150} /></div>}
        </Card>
      </div>

      <Card title={t("Is the supplement protocol working?")}>
        {data.protocols.length === 0 ? <p className="text-slate-400">{t("No protocol yet.")}</p> : (
          <div className="space-y-4">{data.protocols.map((p) => <ProtocolCard key={p.protocol_id} p={p} />)}</div>
        )}
      </Card>

      {others.length > 0 && (
        <Card title={t("Other lab alerts")}><div className="space-y-3">{others.map((a) => <AlertCard key={a.id} alert={a} />)}</div></Card>
      )}

      <Card title={t("Urine results against preflight baseline")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {order.filter((k) => m[k]).map((k) => <MetricCard key={k} m={m[k]} personal={false} />)}
        </div>
      </Card>
    </div>
  );
}
