import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AXIS, GRID, TIP, TrendBlock } from "../../components/charts";
import { AlertCard, Card, Empty, GroundNote, MetricCard, PageTitle, ProgressBar, SourceTag, Unverified } from "../../components/ui";
import { clockTime, dayLabel, dayTick, deviceName, exerciseName, fmt, usePoll, type Alert, type Metric, type ViewInfo } from "../../lib/api";
import { useApp, useCrewName } from "../../lib/context";
import { t } from "../../lib/i18n";
import { ACT_COLOR } from "../crew/Energy";

interface ExerciseData {
  weekly_target_min: number; weekly_range_min: [number, number]; last7_min: number;
  weeks: { week: number; label: string; ared: number; t2: number; cevis: number; rehab: number; total: number }[];
  strength: Record<string, { day: number; load_kg: number }[]>;
  sessions: { id: number; day: number; device: string; minutes: number; avg_hr: number; max_hr: number; details: any; source: string; kcal: number | null }[];
  trends: Record<string, Metric>; limits: { ared_peak_load_kg: number; source: string }; view: ViewInfo;
}
interface EnergyData {
  metrics: Record<string, Metric>; daily: ({ day: number; total: number; intake: number | null } & Record<string, number>)[];
  yesterday: { kind: string; device: string | null; label: string; start_h: number; end_h: number; minutes: number; met: number; kcal: number }[];
  alerts: Alert[]; met_table: { kind: string; met: number; label: string }[];
  model: { ared_met: [number, number]; rehab_met: number; t2: { resting_ml_kg_min: number; ml_per_m: number }; cevis_gross_efficiency: number;
    kcal_per_l_o2: number; kcal_per_kg_body_mass: number; source: string; verified: boolean };
  view: ViewInfo;
}

const DEV_COLOR: Record<string, string> = { ared: "#00E5FF", t2: "#B388FF", cevis: "#00E676", rehab: "#FF9100" };
const EX_COLOR = ["#00E5FF", "#B388FF", "#00E676", "#FF9100"];
const PART_KEYS = ["sleep", "hygiene", "meal", "planning", "science", "maintenance", "eva", "medical", "leisure", "family_call", "rest", "skipped", "vestibular_rehab", "ared", "t2", "cevis", "rehab"];
const PART_LABEL: Record<string, string> = {
  sleep: "Sleep", hygiene: "Hygiene", meal: "Meal", planning: "Daily planning conference", science: "Science work", maintenance: "Maintenance",
  eva: "Spacewalk (EVA)", medical: "Medical tests & debriefs", leisure: "Free time", family_call: "Family call", rest: "Rest",
  skipped: "Skipped session (rest)", vestibular_rehab: "Vestibular rehab",
};

export default function ExerciseEnergy() {
  const { crewId } = useApp();
  const name = useCrewName();
  const { data } = usePoll<ExerciseData>(`/api/crew/${crewId}/exercise?side=ground`, 6000);
  const { data: en } = usePoll<EnergyData>(`/api/crew/${crewId}/energy?side=ground&days=21`, 6000);
  if (!data || !en) return <Empty />;
  const [lo, hi] = data.weekly_range_min;
  const strengthDays = Array.from(new Set(Object.values(data.strength).flat().map((p) => p.day))).sort((a, b) => a - b);
  const strengthRows = strengthDays.map((d) => {
    const row: Record<string, number> = { day: d };
    for (const [ex, pts] of Object.entries(data.strength)) {
      const p = pts.find((x) => x.day === d);
      if (p) row[ex] = p.load_kg;
    }
    return row;
  });
  const parts = PART_KEYS.filter((k) => en.daily.some((d) => (d as any)[k]));
  const daily = en.daily.map((d) => ({ ...d, label: dayTick(d.day) }));
  const m = en.model;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageTitle sub={t("ARED, T2, CEVIS and ground reconditioning; energy burned per activity, energy balance and body mass.")}>{t("Exercise & energy · {n}", { n: name })}</PageTitle>
      <GroundNote view={en.view} />
      {en.alerts.map((a) => <AlertCard key={a.id} alert={a} />)}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {en.metrics.kcal_out && <MetricCard m={en.metrics.kcal_out} personal={false} />}
        {en.metrics.energy_balance && <MetricCard m={en.metrics.energy_balance} personal={false} />}
        {en.metrics.mass_kg && <MetricCard m={en.metrics.mass_kg} personal={false} />}
        {en.metrics.kcal_exercise && <MetricCard m={en.metrics.kcal_exercise} personal={false} />}
      </div>

      <Card title={t("Energy burned per activity (kcal/day) vs intake")} right={!m.verified ? <Unverified source={m.source} /> : undefined}>
        <div className="h-72">
          <ResponsiveContainer>
            <ComposedChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={AXIS} />
              <YAxis tick={AXIS} width={48} />
              <Tooltip contentStyle={TIP} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {parts.map((k) => <Bar key={k} dataKey={k} stackId="a" name={PART_LABEL[k] ? t(PART_LABEL[k]) : deviceName(k)} fill={ACT_COLOR[k] ?? "#64748b"} />)}
              <Line dataKey="intake" name={t("Intake")} stroke="#00E676" strokeWidth={3} dot={{ r: 3 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
          {daily.slice(-7).map((d) => <span key={d.day}>{dayLabel(d.day)}: {t("burned {b} · ate {a}", { b: d.total, a: d.intake ?? "–" })}</span>)}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t("Energy balance")}>{en.metrics.energy_balance && <TrendBlock m={en.metrics.energy_balance} height={200} />}</Card>
        <Card title={t("Body mass (SLAMMD)")}>{en.metrics.mass_kg && <TrendBlock m={en.metrics.mass_kg} height={200} />}</Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card title={t("Activities on {d}", { d: dayLabel(en.view.data_day) })}>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-ink-900 text-slate-400"><tr><th className="py-1">{t("Time")}</th><th>{t("Activity")}</th><th>{t("min")}</th><th>MET</th><th className="text-right">kcal</th></tr></thead>
              <tbody>
                {en.yesterday.map((a, i) => (
                  <tr key={i} className="border-t border-ink-800">
                    <td className="py-1 font-mono text-slate-400">{clockTime(a.start_h)}–{clockTime(a.end_h)}</td>
                    <td><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: ACT_COLOR[a.device ?? a.kind] ?? "#64748b" }} />{a.label}</td>
                    <td className="tabular-nums">{fmt(a.minutes, 0)}</td>
                    <td className="tabular-nums">{fmt(a.met, 1)}</td>
                    <td className="text-right tabular-nums">{fmt(a.kcal, 0)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-ink-600 font-bold"><td className="py-1" /><td>{t("Total")}</td><td /><td /><td className="text-right">{fmt(en.yesterday.reduce((s, a) => s + a.kcal, 0), 0)}</td></tr>
              </tbody>
            </table>
          </div>
        </Card>
        <Card title={t("How energy is calculated")}>
          <ul className="space-y-2 text-sm text-slate-300">
            <li>{t("Everyday activities: kcal = MET × body mass (kg) × hours (1 MET = 1 kcal/kg/h).")}</li>
            <li>{t("ARED: MET from {a} (light) to {b} (heavy), set by load ÷ (2 × body mass).", { a: m.ared_met[0], b: m.ared_met[1] })}</li>
            <li>{t("T2: ACSM running equation, VO₂ = {r} + {k} × speed (m/min) × harness load ÷ body mass; {o} kcal per litre O₂.", { r: m.t2.resting_ml_kg_min, k: m.t2.ml_per_m, o: m.kcal_per_l_o2 })}</li>
            <li>{t("CEVIS: watts ÷ {e} gross efficiency.", { e: m.cevis_gross_efficiency })}</li>
            <li>{t("Ground reconditioning: {m} MET.", { m: m.rehab_met })}</li>
            <li>{t("Body mass changes by energy balance ÷ {k} kcal/kg.", { k: m.kcal_per_kg_body_mass })}</li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            {en.met_table.map((x) => <span key={x.kind} className="rounded bg-ink-850 px-2 py-1">{x.label} <b>{x.met}</b></span>)}
          </div>
          <div className="mt-2"><SourceTag verified={m.verified} source={m.source} /> <span className="text-xs text-slate-500">{t(m.source)}</span></div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title={t("Last 7 days")} className="lg:col-span-1">
          <div className="text-5xl font-bold tabular-nums">{data.last7_min}<span className="ml-1 text-xl text-slate-400">{t("min")}</span></div>
          <div className="mt-1 text-slate-400">{t("target ~{n} (range {lo}–{hi})", { n: data.weekly_target_min, lo, hi })}</div>
          <div className="mt-3"><ProgressBar value={data.last7_min / data.weekly_target_min} height={16} marker={lo / data.weekly_target_min} color={data.last7_min < lo ? "#FF9100" : "#00E676"} /></div>
          <p className="mt-2 text-xs text-slate-500">{t("Source: {s}", { s: data.limits.source })}</p>
        </Card>
        <Card title={t("Weekly minutes vs target")} className="lg:col-span-2">
          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={data.weeks.slice(-12)} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={AXIS} />
                <YAxis tick={AXIS} width={44} />
                <ReferenceArea y1={lo} y2={hi} fill="#00E676" fillOpacity={0.08} />
                <ReferenceLine y={data.weekly_target_min} stroke="#00E676" strokeDasharray="5 5" label={{ value: t("{n} target", { n: data.weekly_target_min }), fill: "#00E676", fontSize: 12, position: "insideTopLeft" }} />
                <Tooltip contentStyle={TIP} />
                <Legend />
                {(["ared", "t2", "cevis", "rehab"] as const).map((d) => <Bar key={d} dataKey={d} stackId="a" name={deviceName(d)} fill={DEV_COLOR[d]} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t("Strength trend (ARED best load per day)")}>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={strengthRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="day" tick={AXIS} type="number" domain={["dataMin", "dataMax"]} tickFormatter={dayTick} allowDecimals={false} />
                <YAxis tick={AXIS} width={44} unit=" kg" />
                <Tooltip contentStyle={TIP} labelFormatter={(d) => dayLabel(Number(d))} />
                <Legend />
                {Object.keys(data.strength).map((ex, i) => (
                  <Line key={ex} dataKey={ex} name={exerciseName(ex)} stroke={EX_COLOR[i % 4]} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-sm text-slate-400">{t("Peak ARED load is {n} kg. A falling line means lost strength.", { n: data.limits.ared_peak_load_kg })}</p>
        </Card>
        <Card title={t("Fitness trend")}>
          <div className="space-y-4">
            {data.trends.cevis_watts && <TrendBlock m={data.trends.cevis_watts} height={130} />}
            {data.trends.hr_exercise && <TrendBlock m={data.trends.hr_exercise} height={130} />}
          </div>
        </Card>
      </div>

      <Card title={t("Recent sessions")}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="text-sm text-slate-400"><tr><th className="py-2">{t("Day")}</th><th>{t("Machine")}</th><th>{t("Time")}</th><th>{t("Avg / max HR")}</th><th>kcal</th><th>{t("Details")}</th><th>{t("Logged by")}</th></tr></thead>
            <tbody>
              {data.sessions.map((s) => (
                <tr key={s.id} className="border-t border-ink-800">
                  <td className="py-2">{dayLabel(s.day)}</td>
                  <td>{deviceName(s.device)}</td>
                  <td>{fmt(s.minutes, 0)} {t("min")}</td>
                  <td>{s.avg_hr} / {s.max_hr}</td>
                  <td>{fmt(s.kcal, 0)}</td>
                  <td className="text-sm text-slate-300">
                    {s.details.exercises ? s.details.exercises.map((e: any) => `${exerciseName(e.exercise)} ${e.load_kg} kg`).join(", ")
                      : s.details.speed_kmh ? t("{v} km/h, harness {h} kg", { v: s.details.speed_kmh, h: s.details.harness_kg })
                        : s.details.watts ? `${s.details.watts} W` : t("walking, strength, balance")}
                  </td>
                  <td className="text-sm text-slate-400">{s.source === "user" ? t("crew (live)") : s.source === "task" ? t("crew (tap)") : t("simulated")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
