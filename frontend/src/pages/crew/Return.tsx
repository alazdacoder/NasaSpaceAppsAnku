import { useState } from "react";
import { C } from "../../lib/theme";
import { Icon } from "../../components/Icon";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, TIP } from "../../components/charts";
import { Ring } from "../../components/Ring";
import { Button, Card, Empty, PageTitle, ProgressBar, Rating, SimpleAlert, Unverified, cx } from "../../components/ui";
import { api, dayLabel, dayTick, fmt, usePoll, type Alert, type Metric, type Phase, type Task } from "../../lib/api";
import { useApp, useCrewName } from "../../lib/context";
import { t } from "../../lib/i18n";

export interface Effects {
  sot_drop: number;
  tandem_drop: number;
  dizzy0: number;
  ortho_rise: number;
  training: number;
  tau_days: number;
  days_to_baseline: number;
}
export interface ReadinessInfo {
  level: number;
  label: string;
  max_level: number;
  activities: { id: string; label: string; min_level: number; allowed: boolean }[];
  levels: { level: number; label: string; sot_pct_min: number; tandem_min: number; dizzy_max: number }[];
  source: string;
  verified: boolean;
}
export interface ReturnData {
  phase: Phase;
  landing_day: number;
  today: number;
  days_to_landing: number | null;
  r_day: number | null;
  metrics: Record<string, Metric>;
  readiness: ReadinessInfo | null;
  readiness_config: ReadinessInfo;
  recovery: {
    start: number;
    baseline: number;
    current: number;
    progress: number;
    history: { day: number; progress: number }[];
    days_to_90: number | null;
    days_since_landing: number;
  } | null;
  prediction: {
    if_all_training: Effects;
    training_so_far: Effects;
    training_done: number;
    training_planned: number;
    training_window_start: number;
    landing_effects: Effects | null;
  };
  baseline: { vest_sot: number | null; vest_tandem: number | null; ortho_hr_rise: number | null };
  alerts: Alert[];
  tasks: Task[];
  flights: number;
  susceptibility: number;
  tau_days: number;
  model: {
    source: string;
    verified: boolean;
    prelanding_training_days: number;
    duration_ref_days: number;
    training_benefit: number;
  };
}

export function ReadinessRing({ level, max, label }: { level: number; max: number; label: string }) {
  const colors = [C.bad, C.warn, C.warn, C.accent, C.ok];
  const c = colors[Math.min(colors.length - 1, Math.round((level / Math.max(1, max)) * (colors.length - 1)))];
  return (
    <div className="flex items-center gap-4">
      <Ring value={level / Math.max(1, max)} size={112} stroke={10} color={c} label={`${level}/${max}`} sub={t("Readiness")} />
      <div>
        <div className="text-xs font-bold text-slate-400">{t("Today you may")}</div>
        <div className="mt-1 text-2xl font-black text-fg">{label}</div>
      </div>
    </div>
  );
}

export function BalanceChart({
  m,
  landing,
  baseline,
  height = 200,
}: {
  m?: Metric;
  landing: number;
  baseline: number | null;
  height?: number;
}) {
  if (!m) return null;
  const pts = m.points.filter((p) => p.day >= landing);
  if (pts.length < 1) return <div className="text-slate-500">{t("First balance test results arrive tomorrow.")}</div>;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <LineChart data={pts} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="day" tick={AXIS} tickFormatter={dayTick} />
          <YAxis
            tick={AXIS}
            width={40}
            domain={[
              (dataMin: number) => Math.min(dataMin, baseline ?? dataMin) - 5,
              (dataMax: number) => Math.max(dataMax, baseline ?? dataMax) + 3,
            ]}
            tickFormatter={(v) => fmt(v, 0)}
          />
          {baseline !== null && (
            <ReferenceLine
              y={baseline}
              stroke={C.ok}
              strokeDasharray="5 5"
              label={{ value: t("your normal"), fill: C.ok, fontSize: 12, position: "insideBottomLeft" }}
            />
          )}
          <Tooltip contentStyle={TIP} labelFormatter={(d) => dayLabel(Number(d))} formatter={(v: any) => [fmt(Number(v), 0), m.label]} />
          <Line dataKey="value" stroke={C.rest} strokeWidth={3} dot={{ r: 4, fill: C.rest }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function DizzinessCheck({ crewId, onDone, done }: { crewId: string; onDone: () => void; done: boolean }) {
  const [v, setV] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <Card
      title={t("How dizzy are you right now?")}
      right={done ? <span className="text-sm font-bold text-ok"><Icon name="check" size={14} className="mr-1 inline align-[-2px]" />{t("done today")}</span> : undefined}
    >
      <Rating
        value={v}
        onChange={(x) => {
          setV(x);
          setSaved(false);
        }}
        min={0}
        max={10}
        low={t("not at all")}
        high={t("very")}
      />
      <div className="mt-3 flex items-center gap-3">
        <Button
          kind="ok"
          disabled={v === null}
          onClick={async () => {
            await api(`/api/crew/${crewId}/manual`, { body: { kind: "dizziness", value: v } });
            setSaved(true);
            onDone();
          }}
        >
          {t("Save")}
        </Button>
        {saved && <span className="font-bold text-ok">{t("Saved. It updates tomorrow's readiness.")}</span>}
      </div>
    </Card>
  );
}

function TaskList({
  tasks,
  crewId,
  refresh,
  title,
}: {
  tasks: Task[];
  crewId: string;
  refresh: () => void;
  title: string;
}) {
  const list = tasks.filter((x) => x.kind !== "dizziness" && x.kind !== "workout");
  if (!list.length) return null;
  return (
    <Card title={title}>
      <div className="space-y-2.5">
        {list.map((x) => (
          <div
            key={x.task_id}
            className={cx(
              "flex flex-wrap items-center gap-3 rounded-2xl border p-3.5",
              x.status === "done" ? "border-ok/40 bg-ok/10" : "border-ink-700 bg-ink-850",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="font-bold text-fg">{x.title}</div>
              <div className="text-xs text-slate-400">{x.detail}</div>
            </div>
            {x.status === "done" ? (
              <span className="font-bold text-ok"><Icon name="check" size={14} className="mr-1 inline align-[-2px]" />{t("Done")}</span>
            ) : (
              <Button
                kind="ok"
                onClick={() =>
                  api(`/api/crew/${crewId}/tasks/${encodeURIComponent(x.task_id)}/confirm`, { method: "POST" }).then(
                    refresh,
                  )
                }
              >
                {t("Mark done")}
              </Button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Explainer() {
  return (
    <Card title={t("Why balance changes after landing")}>
      <ul className="space-y-2.5 text-sm text-slate-300">
        <li className="flex gap-2.5">
          <span className="font-bold text-telemetry">1</span>
          <span>
            {t("Your inner ear senses gravity and head tilt. In weightlessness your brain learns to ignore those signals.")}
          </span>
        </li>
        <li className="flex gap-2.5">
          <span className="font-bold text-telemetry">2</span>
          <span>
            {t(
              "Back on Earth the signals return, but the brain still expects weightlessness: dizziness, unsteady walking, a feeling of tilting.",
            )}
          </span>
        </li>
        <li className="flex gap-2.5">
          <span className="font-bold text-telemetry">3</span>
          <span>{t("Blood also pools in the legs when you stand, so you may feel faint.")}</span>
        </li>
        <li className="flex gap-2.5">
          <span className="font-bold text-telemetry">4</span>
          <span>
            {t("The brain re-learns in days to weeks. Training before landing and rehab after it make that faster and safer.")}
          </span>
        </li>
      </ul>
    </Card>
  );
}

export default function Return() {
  const { crewId } = useApp();
  const crewName = useCrewName();
  const { data, refresh } = usePoll<ReturnData>(`/api/crew/${crewId}/return`, 4000);
  if (!data) return <Empty />;
  const m = data.metrics;
  const unv = !data.model.verified ? <Unverified source={data.model.source} /> : undefined;

  if (data.phase !== "postflight") {
    const p = data.prediction;
    const best = p.if_all_training;
    const window = data.today >= p.training_window_start;
    return (
      <div className="mx-auto max-w-5xl space-y-5">
        <PageTitle sub={t("Prepare now so the first days on Earth are safe.")} right={unv}>
          {t("Return to Earth")} · {crewName}
        </PageTitle>
        <div className="grid gap-5 md:grid-cols-[1fr_1.3fr]">
          <Card className="border-telemetry/40 bg-ink-900">
            <h2 className="text-sm font-bold text-slate-300">{t("Landing in")}</h2>
            <div className="mt-1 text-7xl font-black tabular-nums text-telemetry">{data.days_to_landing}</div>
            <div className="text-xl font-semibold text-slate-300">{t("days")}</div>
            <div className="mt-3 text-xs text-slate-400">
              {t("Landing day: {d}", { d: `${t("Day {n}", { n: data.landing_day })} · R+0` })}
            </div>
          </Card>
          <Card title={t("What to expect (your prediction)")}>
            <div className="grid grid-cols-2 gap-3.5">
              <div className="border-t border-ink-700 pt-3 pb-1">
                <div className="text-xs font-semibold text-slate-400">
                  {t("Balance on landing day")}
                </div>
                <div className="mt-1 text-3xl font-black text-warn">−{fmt(best.sot_drop * 100, 0)}%</div>
                <div className="text-xs text-slate-500">{t("compared with your normal")}</div>
              </div>
              <div className="border-t border-ink-700 pt-3 pb-1">
                <div className="text-xs font-semibold text-slate-400">
                  {t("Back to normal in")}
                </div>
                <div className="mt-1 text-3xl font-black text-ok">~{Math.ceil(best.days_to_baseline)}</div>
                <div className="text-xs text-slate-500">{t("days after landing")}</div>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-300">
              {t("This assumes you do all {n} pre-landing training sessions. Each session done lowers the drop.", {
                n: p.training_planned,
              })}
              {data.flights > 1 ? ` ${t("Your earlier flight helps: people adapt faster the second time.")}` : ""}
            </p>
          </Card>
        </div>

        <Card
          title={t("Pre-landing training")}
          right={
            <span className="text-xs font-semibold text-slate-400">
              {t("{d}/{n} sessions done", { d: p.training_done, n: p.training_planned })}
            </span>
          }
        >
          <ProgressBar value={p.training_done / p.training_planned} color={C.rest} height={12} />
          <p className="mt-2.5 text-sm text-slate-300">
            {window
              ? t("Training is on your Today list every day until landing.")
              : t("Starts {d} ({n} days before landing). It will appear on your Today list.", {
                  d: dayLabel(p.training_window_start),
                  n: p.training_planned,
                })}
          </p>
        </Card>

        <TaskList tasks={data.tasks} crewId={crewId} refresh={refresh} title={t("Your preparation tasks")} />

        <Card title={t("Your plan after landing")}>
          <ol className="space-y-2.5">
            {data.readiness_config.levels.map((lv) => (
              <li
                key={lv.level}
                className="flex items-center gap-3.5 border-t border-ink-700 pt-3 pb-1.5"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-telemetry/20 font-black text-telemetry">
                  {lv.level}
                </span>
                <span className="font-bold text-fg">{lv.label}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-slate-400">
            {t("Each morning your balance test and dizziness decide your level. Driving needs the flight surgeon's clearance.")}
          </p>
        </Card>
        <Explainer />
      </div>
    );
  }

  const r = data.readiness;
  const rec = data.recovery;
  const dizzyDone = data.tasks.some((x) => x.kind === "dizziness" && x.status === "done");
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageTitle sub={t("Welcome back. Your balance is re-learning gravity; here is what is safe today.")} right={unv}>
        {t("Balance · {r}", { r: dayLabel(data.today) })}
      </PageTitle>
      {r && (
        <Card>
          <div className="grid gap-5 md:grid-cols-2">
            <ReadinessRing level={r.level} max={r.max_level} label={r.label} />
            <ul className="space-y-2">
              {r.activities.map((a) => (
                <li
                  key={a.id}
                  className={cx(
                    "flex items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-base font-semibold",
                    a.allowed ? "border-ok/40 bg-ok/10 text-fg" : "border-ink-700 bg-ink-850 text-slate-400",
                  )}
                >
                  <span
                    className={cx(
                      "flex h-7 w-7 items-center justify-center rounded-full text-sm font-black",
                      a.allowed ? "bg-ok text-ink-950" : "bg-bad/25 text-bad",
                    )}
                  >
                    {a.allowed ? <Icon name="check" size={16} /> : <Icon name="x" size={16} />}
                  </span>
                  <span>{a.label}</span>
                </li>
              ))}
            </ul>
          </div>
          {data.r_day === 0 && (
            <p className="mt-3 text-sm text-slate-300">
              {t("Landing day: move only with help. Your first balance tests are today; tomorrow you will see your results.")}
            </p>
          )}
        </Card>
      )}

      {data.alerts.map((a) => (
        <SimpleAlert key={a.id} alert={a} />
      ))}

      <div className="grid gap-5 md:grid-cols-2">
        <DizzinessCheck crewId={crewId} onDone={refresh} done={dizzyDone} />
        <Card title={t("Your balance score")}>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-black tabular-nums text-fg">
              {fmt(m.vest_sot?.points.filter((p) => p.day >= data.landing_day).slice(-1)[0]?.value, 0)}
            </span>
            <span className="text-slate-400">/100 · {t("your normal {n}", { n: fmt(data.baseline.vest_sot, 0) })}</span>
          </div>
          {rec && (
            <div className="mt-2">
              <ProgressBar value={rec.progress} color={C.rest} height={12} />
            </div>
          )}
          <div className="mt-1 text-xs text-slate-400">
            {rec ? t("{p}% of the way back", { p: Math.round(rec.progress * 100) }) : ""}
            {rec?.days_to_90 !== null && rec?.days_to_90 !== undefined
              ? ` · ${t("~{n} more days to near normal", { n: Math.max(0, Math.ceil(rec.days_to_90 - rec.days_since_landing - 1)) })}`
              : ""}
          </div>
          <BalanceChart m={m.vest_sot} landing={data.landing_day} baseline={data.baseline.vest_sot} height={170} />
        </Card>
      </div>

      <TaskList tasks={data.tasks} crewId={crewId} refresh={refresh} title={t("Today's balance tasks")} />

      <Card title={t("Safety tips")}>
        <ul className="space-y-2 text-sm text-slate-200">
          <li className="flex items-start gap-1.5"><Icon name="chevron" size={16} className="mt-1 shrink-0 text-accent" /><span>{t("Stand up in stages - sit for a minute first, drink water, tense your leg muscles.")}</span></li>
          <li className="flex items-start gap-1.5"><Icon name="chevron" size={16} className="mt-1 shrink-0 text-accent" /><span>{t("Move your head slowly. Avoid quick turns and bending down.")}</span></li>
          <li className="flex items-start gap-1.5"><Icon name="chevron" size={16} className="mt-1 shrink-0 text-accent" /><span>{t("Use handrails and good light at night.")}</span></li>
          <li className="flex items-start gap-1.5"><Icon name="chevron" size={16} className="mt-1 shrink-0 text-accent" /><span>{t("Do not drive until the flight surgeon clears you.")}</span></li>
        </ul>
      </Card>
      <Explainer />
    </div>
  );
}
