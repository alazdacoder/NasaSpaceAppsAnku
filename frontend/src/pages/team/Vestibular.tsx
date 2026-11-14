import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, TIP, TrendBlock } from "../../components/charts";
import { AlertCard, Card, Empty, GroundNote, MetricCard, PageTitle, ProgressBar, Stat, Unverified } from "../../components/ui";
import { dayLabel, dayTick, fmt, usePoll } from "../../lib/api";
import { useApp, useCrewName } from "../../lib/context";
import { t } from "../../lib/i18n";
import { BalanceChart, ReadinessRing, type Effects, type ReturnData } from "../crew/Return";

function EffectsTable({ e, title }: { e: Effects; title: string }) {
  return (
    <div className="rounded-xl bg-ink-850 p-3">
      <div className="mb-2 font-semibold">{title}</div>
      <table className="w-full text-sm">
        <tbody>
          <tr><td className="py-0.5 text-slate-400">{t("Balance score drop")}</td><td className="text-right font-semibold">−{fmt(e.sot_drop * 100, 0)}%</td></tr>
          <tr><td className="py-0.5 text-slate-400">{t("Tandem-walk steps lost")}</td><td className="text-right font-semibold">{fmt(e.tandem_drop, 1)}</td></tr>
          <tr><td className="py-0.5 text-slate-400">{t("Dizziness on landing")}</td><td className="text-right font-semibold">{fmt(e.dizzy0, 1)}/10</td></tr>
          <tr><td className="py-0.5 text-slate-400">{t("Extra stand-test HR rise")}</td><td className="text-right font-semibold">+{fmt(e.ortho_rise, 0)} {t("bpm")}</td></tr>
          <tr><td className="py-0.5 text-slate-400">{t("Pre-landing training done")}</td><td className="text-right font-semibold">{fmt(e.training * 100, 0)}%</td></tr>
          <tr><td className="py-0.5 text-slate-400">{t("Recovery time constant")}</td><td className="text-right font-semibold">{fmt(e.tau_days, 1)} {t("days")}</td></tr>
          <tr><td className="py-0.5 text-slate-400">{t("Days to within 5% of baseline")}</td><td className="text-right font-semibold">~{fmt(e.days_to_baseline, 1)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

export default function TeamVestibular() {
  const { crewId } = useApp();
  const name = useCrewName();
  const { data } = usePoll<ReturnData & { view: any }>(`/api/crew/${crewId}/return?side=ground`, 5000);
  if (!data) return <Empty />;
  const m = data.metrics;
  const post = data.phase === "postflight";
  const land = data.landing_day;
  const readyPts = (m.vest_readiness?.points ?? []).filter((p) => p.day >= land);
  const cfg = data.readiness_config;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageTitle sub={t("Post-flight vestibular dysfunction: balance (posturography), tandem walk, dizziness, stand test")}
        right={!data.model.verified ? <Unverified source={data.model.source} /> : undefined}>{t("Vestibular · {n}", { n: name })}</PageTitle>
      <GroundNote view={data.view} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("Phase")} value={post ? t("Post-flight") : data.phase === "preflight" ? t("Before launch") : t("In flight")} sub={post ? dayLabel(land + (data.r_day ?? 0)) : t("{n} days to landing", { n: data.days_to_landing ?? 0 })} />
        <Stat label={t("Flights")} value={data.flights} sub={data.flights > 1 ? t("experienced: faster re-adaptation") : t("first flight")} />
        <Stat label={t("Susceptibility")} value={fmt(data.susceptibility, 2)} sub={t("1.0 = average crew member")} />
        <Stat label={t("Preflight balance baseline")} value={fmt(data.baseline.vest_sot, 0)} unit="/100" sub={t("tandem {n}/10", { n: fmt(data.baseline.vest_tandem, 1) })} />
      </div>

      {data.alerts.map((a) => <AlertCard key={a.id} alert={a} />)}

      {post && data.readiness && (
        <Card title={t("Return readiness (from the latest test day)")}>
          <div className="grid gap-5 lg:grid-cols-[1fr_1.5fr]">
            <ReadinessRing level={data.readiness.level} max={data.readiness.max_level} label={data.readiness.label} />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-400"><tr><th className="py-1">{t("Level")}</th><th>{t("Balance vs baseline")}</th><th>{t("Tandem ≥")}</th><th>{t("Dizziness ≤")}</th></tr></thead>
                <tbody>
                  {cfg.levels.map((lv) => (
                    <tr key={lv.level} className={`border-t border-ink-800 ${lv.level === data.readiness!.level ? "bg-violet-500/15 font-semibold" : ""}`}>
                      <td className="py-1">{lv.level} · {lv.label}</td><td>≥ {lv.sot_pct_min}%</td><td>{lv.tandem_min}</td><td>{lv.dizzy_max}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 text-xs text-slate-500">{cfg.activities.map((a) => `${a.label} ≥ ${a.min_level}`).join(" · ")}</div>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {post && data.prediction.landing_effects ? <EffectsTable e={data.prediction.landing_effects} title={t("Model landing effects (fixed at landing)")} />
          : <EffectsTable e={data.prediction.if_all_training} title={t("Prediction if all pre-landing training is done")} />}
        <Card title={t("Pre-landing training")}>
          <div className="text-4xl font-bold">{data.prediction.training_done}<span className="text-lg text-slate-400">/{data.prediction.training_planned}</span></div>
          <div className="my-2"><ProgressBar value={data.prediction.training_done / data.prediction.training_planned} color="#c084fc" /></div>
          <p className="text-sm text-slate-300">{t("Window opens {d}. Full training lowers landing effects by {p}% in the model.", { d: dayLabel(data.prediction.training_window_start), p: Math.round(data.model.training_benefit * 100) })}</p>
          {data.recovery && (
            <div className="mt-3 rounded-xl bg-ink-850 p-3">
              <div className="font-semibold">{t("Balance recovery (measured)")}</div>
              <div className="text-sm text-slate-300">
                {t("{p}% recovered from {a} to {b} toward baseline {c}", { p: Math.round(data.recovery.progress * 100), a: fmt(data.recovery.start, 0), b: fmt(data.recovery.current, 0), c: fmt(data.recovery.baseline, 0) })}
              </div>
              <div className="text-sm text-slate-400">
                {data.recovery.days_to_90 !== null ? t("Exponential fit: 90% recovered by day {n} after landing.", { n: fmt(data.recovery.days_to_90, 1) }) : t("Not enough post-flight points for a fit yet.")}
              </div>
            </div>
          )}
        </Card>
      </div>

      {post ? (
        <>
          <Card title={t("Balance score after landing")}><BalanceChart m={m.vest_sot} landing={land} baseline={data.baseline.vest_sot} height={240} /></Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>{m.vest_tandem && <TrendBlock m={m.vest_tandem} from={land - 10} height={190} />}</Card>
            <Card>{m.vest_dizzy && <TrendBlock m={m.vest_dizzy} from={land - 10} height={190} />}</Card>
            <Card>{m.ortho_hr_rise && <TrendBlock m={m.ortho_hr_rise} from={land - 10} height={190} />}</Card>
            <Card title={t("Readiness level by day")}>
              {readyPts.length < 1 ? <p className="text-slate-500">{t("No post-flight tests received yet.")}</p> : (
                <div className="h-48">
                  <ResponsiveContainer>
                    <LineChart data={readyPts} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="day" tick={AXIS} tickFormatter={dayTick} />
                      <YAxis tick={AXIS} width={30} domain={[0, 4]} allowDecimals={false} />
                      <ReferenceLine y={4} stroke="#22c55e" strokeDasharray="4 4" />
                      <Tooltip contentStyle={TIP} labelFormatter={(d) => dayLabel(Number(d))} />
                      <Line type="stepAfter" dataKey="value" name={t("Level")} stroke="#c084fc" strokeWidth={3} dot={{ r: 4 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>
        </>
      ) : (
        <Card title={t("Preflight baseline tests")}>
          <p className="mb-3 text-slate-300">{t("Balance tests need gravity, so they run before launch and after landing only. In flight the dizziness rating covers space motion sickness in the first days.")}</p>
          <div className="grid gap-4 lg:grid-cols-2">
            {m.vest_sot && <TrendBlock m={m.vest_sot} height={170} />}
            {m.vest_dizzy && <TrendBlock m={m.vest_dizzy} height={170} />}
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(["vest_sot", "vest_tandem", "vest_dizzy", "ortho_hr_rise"] as const).map((k) => m[k] && <MetricCard key={k} m={m[k]} showChart={false} personal={false} />)}
      </div>
      <p className="text-sm text-slate-500">
        {t("Model: landing effects scale with √(mission days ÷ {d}), the crew member's susceptibility and pre-landing training; they fade with the personal time constant, a little faster with daily vestibular rehab. All values are simulation assumptions.", { d: data.model.duration_ref_days })}
      </p>
    </div>
  );
}
