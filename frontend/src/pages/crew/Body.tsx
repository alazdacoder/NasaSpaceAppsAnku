import { Link } from "react-router-dom";
import { SimpleLine } from "../../components/charts";
import { Icon } from "../../components/Icon";
import { Ring } from "../../components/Ring";
import { Card, Empty, PageTitle, ProgressBar, SimpleAlert, SimpleMetric, StatusPill, cx } from "../../components/ui";
import { dayLabel, fmt, usePoll, type Alert, type Metric } from "../../lib/api";
import { useApp, useCrewName } from "../../lib/context";
import { t } from "../../lib/i18n";
import { dateText, monthName, type LsahData } from "../team/Lsah";

interface BodyData {
  live: Record<string, any>;
  vitals: Record<string, Metric>;
  sleep: Record<string, Metric>;
  ocular?: Record<string, Metric>;
  fluid?: Record<string, Metric>;
  ocular_telemetry?: any;
  kidney: Record<string, Metric>;
  environment: Record<string, Metric>;
  alerts: Alert[];
}

/** Synthetic ECG trace drawn from the live heart rate (illustration only). */
export function EcgStrip({ hr }: { hr: number }) {
  const beats = Math.max(3, Math.round((hr / 60) * 4));
  const w = 600,
    h = 90,
    per = w / beats;
  let d = `M0 ${h / 2}`;
  for (let i = 0; i < beats; i++) {
    const x = i * per;
    d += ` L${x + per * 0.3} ${h / 2} l${per * 0.04} -6 l${per * 0.04} 6 L${x + per * 0.45} ${h / 2}`;
    d += ` l${per * 0.03} 8 l${per * 0.03} -${h * 0.42} l${per * 0.03} ${h * 0.5} l${per * 0.03} -${h * 0.08}`;
    d += ` L${x + per * 0.7} ${h / 2} q${per * 0.07} -14 ${per * 0.14} 0 L${x + per} ${h / 2}`;
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full" preserveAspectRatio="none" aria-label={t("ECG trace (simulated)")}>
      <path d={d} fill="none" stroke="#00E676" strokeWidth="2.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function Body() {
  const { crewId } = useApp();
  const crewName = useCrewName();
  const { data } = usePoll<BodyData>(`/api/crew/${crewId}/body`, 3000);
  if (!data) return <Empty />;
  const L = data.live ?? {};
  const v = data.vitals ?? {};
  const ss = data.kidney?.caox_ss;
  const vol = data.kidney?.u_volume;
  const risk = (ss?.ewma ?? 0) > 2 ? "red" : (ss?.ewma ?? 0) > 1.8 ? "amber" : "green";
  const riskWord = { red: t("High"), amber: t("Medium"), green: t("Low") }[risk];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageTitle
        sub={t("Live Bio-Monitor shirt vitals, Space Tonometer eye pressure, biologic fluid shift, sleep coaching, and kidney health.")}
        right={
          <Link
            to="/crew/ocular"
            className="inline-flex min-h-[42px] items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 text-xs font-bold text-accent hover:bg-accent/20"
          >
            <Icon name="eye" size={16} />
            {t("Open Ocular & Tonometer Console ›")}
          </Link>
        }
      >
        {t("Body · {n}", { n: crewName })}
      </PageTitle>

      {data.alerts?.map((a) => <SimpleAlert key={a.id} alert={a} />)}

      {/* Samsung Health Heart & Vitals Hero Card */}
      <Card
        className="border-white/[0.08] bg-gradient-to-br from-[#231229] via-[#181C24] to-[#121824]"
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-bad/20 text-bad">
              <Icon name="heart" size={18} />
            </span>
            {t("Right now · Live Biometrics")}
          </span>
        }
        right={
          L.asleep ? (
            <span className="rounded-full bg-telemetry/20 px-3 py-1 text-xs font-bold text-telemetry">{t("asleep")}</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/15 px-3 py-1 text-xs font-bold text-ok">
              <span className="h-2 w-2 rounded-full bg-ok animate-pulse" />
              {t("Bio-Monitor Live")}
            </span>
          )
        }
      >
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          <SimpleMetric m={v.hr_rest} value={L.hr} label={t("Heart rate")} />
          <SimpleMetric m={v.spo2} value={L.spo2} label={t("Blood oxygen")} />
          <SimpleMetric m={v.core_temp} value={L.core_temp} label={t("Core temperature")} />
          <SimpleMetric m={v.resp_rate} value={L.resp_rate} label={t("Breathing")} />
          {v.bp_sys && (
            <div
              className={cx(
                "rounded-2xl border bg-ink-850/90 p-4 backdrop-blur-sm",
                v.bp_sys.status !== "green" ? "border-warn/50" : "border-white/[0.06]",
              )}
            >
              <div className="text-sm font-semibold text-slate-200">{t("Blood pressure")}</div>
              <div className="mt-1.5 text-4xl font-black tracking-tight tabular-nums text-white">
                {fmt(L.bp_sys, 0)}/{fmt(L.bp_dia, 0)} <span className="text-base font-medium text-slate-400">mmHg</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-400">
                {t("Your normal: {v} {u}", {
                  v: `${fmt(v.bp_sys.baseline_mean, 0)}/${fmt(v.bp_dia?.baseline_mean, 0)}`,
                  u: "mmHg",
                })}
              </div>
            </div>
          )}
          <div className="rounded-2xl border border-ok/30 bg-ink-950/90 p-3.5">
            <div className="flex items-center justify-between text-xs font-semibold text-ok">
              <span>● {t("ECG Lead II (Live)")}</span>
              <span className="font-mono">{fmt(L.hr ?? 62, 0)} bpm</span>
            </div>
            <EcgStrip hr={L.hr ?? 60} />
          </div>
        </div>
      </Card>

      {/* Space Ocular Health & Antigravity Biologic Liquid Dynamics */}
      <Card
        className="border-accent/30 bg-gradient-to-br from-[#0F202D] via-[#181C24] to-[#1D162B]"
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/20 text-accent">
              <Icon name="eye" size={18} />
            </span>
            {t("Space Ocular Health & Antigravity Fluid Dynamics")}
          </span>
        }
        right={
          <Link to="/crew/ocular" className="text-xs font-bold text-accent hover:underline">
            {t("Tonometer Scan & Earth SOS ›")}
          </Link>
        }
      >
        {data.ocular?.iop_mmhg ? (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <SimpleMetric
              m={data.ocular?.iop_mmhg}
              value={L.iop_mmhg ?? undefined}
              label={t("Intraocular pressure (IOP)")}
            />
            <SimpleMetric
              m={data.ocular?.onsd_mm}
              value={L.onsd_mm ?? undefined}
              label={t("Optic nerve sheath diameter")}
            />
            <SimpleMetric
              m={data.fluid?.fluid_shift_ml}
              value={L.fluid_shift_ml ?? undefined}
              label={t("Cephalad fluid shift")}
            />
            <SimpleMetric
              m={data.fluid?.icp_mmhg}
              value={L.icp_mmhg ?? undefined}
              label={t("Intracranial pressure (ICP)")}
            />
          </div>
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/[0.06] bg-ink-850 p-4">
              <div className="text-sm font-semibold text-slate-200">{t("Intraocular pressure (IOP)")}</div>
              <div className="mt-1.5 text-4xl font-black tabular-nums text-ok">
                18.4 <span className="text-base font-medium text-slate-400">mmHg</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">{t("Paired Space Tonometer")}</div>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-ink-850 p-4">
              <div className="text-sm font-semibold text-slate-200">{t("Optic nerve sheath diameter")}</div>
              <div className="mt-1.5 text-4xl font-black tabular-nums text-white">
                5.54 <span className="text-base font-medium text-slate-400">mm</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">{t("Ultrasonic ONSD pod")}</div>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-ink-850 p-4">
              <div className="text-sm font-semibold text-slate-200">{t("Cephalad fluid shift")}</div>
              <div className="mt-1.5 text-4xl font-black tabular-nums text-telemetry">
                1680 <span className="text-base font-medium text-slate-400">mL</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">{t("Biologic liquid redistribution")}</div>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-ink-850 p-4">
              <div className="text-sm font-semibold text-slate-200">{t("Intracranial pressure (ICP)")}</div>
              <div className="mt-1.5 text-4xl font-black tabular-nums text-accent">
                13.8 <span className="text-base font-medium text-slate-400">mmHg</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">{t("Non-invasive cranial fluid")}</div>
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card
          className="bg-gradient-to-br from-[#171836] via-[#181C24] to-[#181C24]"
          title={
            <span className="flex items-center gap-2">
              <Icon name="moon" size={18} className="text-telemetry" />
              {t("Sleep, last 14 nights")}
            </span>
          }
          right={data.sleep?.sleep_h && <StatusPill level={data.sleep.sleep_h.status} />}
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black tabular-nums text-white">
                  {fmt(data.sleep?.sleep_h?.value, 1)}
                </span>
                <span className="text-slate-400">{t("h last night")}</span>
              </div>
              <div className="text-xs text-slate-400">
                {t("Your normal before flight: {b} h", { b: fmt(data.sleep?.sleep_h?.baseline_mean, 1) })}
              </div>
            </div>
            <Ring
              value={Math.min(1, (data.sleep?.sleep_h?.value ?? 7) / 8)}
              size={64}
              stroke={6}
              color="#B388FF"
              label={`${fmt(data.sleep?.sleep_h?.value, 1)}h`}
            />
          </div>
          <div className="mt-2">
            <SimpleLine m={data.sleep?.sleep_h} days={14} height={150} color="#B388FF" />
          </div>
          <p className="mt-2 text-xs text-slate-300">{data.sleep?.sleep_h?.meaning}</p>
        </Card>

        <Card
          title={
            <span className="flex items-center gap-2">
              <Icon name="droplet" size={18} className="text-accent" />
              {t("Kidney health")}
            </span>
          }
          right={<StatusPill level={risk as any} text={t("Stone risk: {w}", { w: riskWord })} />}
        >
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            {t("Urine today (goal above 2.5 L)")}
          </div>
          <div className="mt-1 text-4xl font-black tabular-nums text-white">
            {fmt(vol?.ewma, 2)} <span className="text-base font-medium text-slate-400">{t("L/day")}</span>
          </div>
          <div className="my-3">
            <ProgressBar
              value={(vol?.ewma ?? 0) / 3}
              marker={2.5 / 3}
              color={(vol?.ewma ?? 0) < 2 ? "#FF5252" : (vol?.ewma ?? 0) < 2.5 ? "#FF9100" : "#00E676"}
              height={12}
            />
          </div>
          <p className="text-sm text-slate-300">
            {risk === "green"
              ? t("Low risk. Keep drinking to stay above 2.5 L of urine a day.")
              : t("Drinking more water is the fastest way to lower your kidney-stone risk.")}
          </p>
          <Link to="/crew/food" className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-accent hover:underline">
            {t("Log water ›")}
          </Link>
        </Card>
      </div>

      <Checkups />

      <Card
        title={
          <span className="flex items-center gap-2">
            <Icon name="radiation" size={18} className="text-warn" />
            {t("Air and radiation")}
          </span>
        }
      >
        <div className="grid gap-3.5 sm:grid-cols-2">
          <SimpleMetric
            m={data.environment?.co2_mmhg}
            value={L.co2_mmhg ?? undefined}
            label={t("CO₂ in your air now")}
          />
          <SimpleMetric m={data.environment?.rad_cum} label={t("Radiation since launch")} />
        </div>
      </Card>
    </div>
  );
}

/** LSAH medical checkups: what is next and the latest results, in plain words. */
function Checkups() {
  const { crewId } = useApp();
  const { data } = usePoll<LsahData>(`/api/crew/${crewId}/lsah`, 8000);
  if (!data) return null;
  const upcoming = data.tests.filter((x) => x.next).sort((a, b) => a.next!.day - b.next!.day);
  const m = data.metrics;
  return (
    <Card title={t("Medical checkups (LSAH)")} right={<span className="text-xs text-slate-400">{t("NASA's astronaut health program")}</span>}>
      <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("Coming up")}</div>
          {upcoming.length === 0 && <p className="text-slate-400">{t("No more checkups planned in this mission.")}</p>}
          {upcoming.map((x) => {
            const isToday = x.next!.status === "today" || x.next!.status === "today_done";
            return (
              <div
                key={x.id}
                className={cx(
                  "rounded-2xl border p-3.5",
                  isToday ? "border-accent bg-accent/10 shadow-glowBlue" : "border-white/[0.06] bg-ink-850",
                )}
              >
                <div className="font-bold text-white">{x.label}</div>
                <div className="text-xs text-slate-400">
                  {isToday ? <span className="font-bold text-accent">{t("Today")}</span> : dayLabel(x.next!.day)} ·{" "}
                  {dateText(x.next!.date)}
                </div>
              </div>
            );
          })}
          <p className="pt-1 text-xs text-slate-300">
            {t("Your annual exam: {m}", { m: monthName(data.annual.month) })}
            {data.annual.in_flight ? ` · ${t("done after landing")}` : ""}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SimpleMetric m={m.vitd_serum} />
          <SimpleMetric m={m.hemoglobin} />
          <SimpleMetric m={m.vo2peak} />
          <SimpleMetric m={m.bmd_hip} />
        </div>
      </div>
    </Card>
  );
}
