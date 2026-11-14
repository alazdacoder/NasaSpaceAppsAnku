import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, TIP } from "../../components/charts";
import { ACTIVITY_ICON, Icon } from "../../components/Icon";
import { Ring } from "../../components/Ring";
import { Card, Empty, PageTitle, SimpleAlert, Stat, Unverified, cx } from "../../components/ui";
import { clockTime, dayTick, fmt, usePoll, type Alert, type Metric } from "../../lib/api";
import { useApp, useCrewName } from "../../lib/context";
import { t } from "../../lib/i18n";

export const ACT_COLOR: Record<string, string> = {
  sleep: "#B388FF",
  hygiene: "#64748b",
  meal: "#00E676",
  planning: "#94a3b8",
  science: "#00E5FF",
  maintenance: "#38bdf8",
  exercise: "#FF9100",
  ared: "#FF9100",
  t2: "#FF5252",
  cevis: "#00E5FF",
  rehab: "#FF9100",
  leisure: "#B388FF",
  family_call: "#f472b6",
  medical: "#00E676",
  vestibular_rehab: "#B388FF",
  eva: "#facc15",
  rest: "#475569",
  skipped: "#475569",
};

export interface Block {
  kind: string;
  start: number;
  end: number;
  minutes: number;
  label: string;
  device?: string;
  status: "done" | "now" | "next";
  kcal_total: number;
  kcal_so_far: number;
  met?: number;
  estimate?: boolean;
  logged?: boolean;
  overtime?: boolean;
}
interface EnergyData {
  today: {
    hour: number;
    mass_kg: number;
    blocks: Block[];
    kcal_so_far: number;
    kcal_expected: number;
    live: { device: string; kcal: number; kcal_min: number } | null;
    workload_h: number;
  };
  metrics: Record<string, Metric>;
  daily: ({ day: number; total: number; intake: number | null } & Record<string, number>)[];
  alerts: Alert[];
  model: { source: string; verified: boolean };
}

export function Timeline({ blocks, live }: { blocks: Block[]; live?: EnergyData["today"]["live"] }) {
  const max = Math.max(...blocks.map((b) => b.kcal_total), 1);
  return (
    <ol className="space-y-2">
      {blocks.map((b, i) => {
        const now = b.status === "now";
        const color = ACT_COLOR[b.device ?? b.kind] ?? "#64748b";
        return (
          <li
            key={i}
            className={cx(
              "grid grid-cols-[64px_30px_1fr_auto] items-center gap-2.5 rounded-2xl border px-3 py-2.5 transition-all sm:grid-cols-[72px_34px_1fr_auto] sm:px-4",
              now
                ? "border-accent/60 bg-accent/10 shadow-glowBlue"
                : b.status === "done"
                  ? "border-white/[0.06] bg-ink-850/90"
                  : "border-white/[0.03] bg-ink-900/60",
            )}
          >
            <span className="font-mono text-xs font-bold tabular-nums text-slate-400">{clockTime(b.start)}</span>
            <span className="flex justify-center" style={{ color }}>
              <Icon name={ACTIVITY_ICON[b.kind] ?? "pause"} size={18} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cx("font-bold text-white", b.status === "next" && "text-slate-400")}>{b.label}</span>
                <span className="text-xs text-slate-500">{t("{m} min", { m: b.minutes })}</span>
                {now && (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-black uppercase text-ink-950">
                    {t("NOW")}
                  </span>
                )}
                {b.status === "done" && b.kind === "exercise" && (
                  <span className="text-xs font-bold text-ok">✓ {b.logged ? t("logged") : t("done")}</span>
                )}
                {now && b.kind === "exercise" && live && (
                  <span className="text-xs font-bold text-warn">{t("live")}</span>
                )}
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-ink-950">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${(b.kcal_total / max) * 100}%`,
                    background: color,
                    opacity: b.status === "next" ? 0.35 : 1,
                    boxShadow: now ? `0 0 10px ${color}` : undefined,
                  }}
                />
              </div>
            </div>
            <span className="text-right tabular-nums">
              <span className={cx("font-black text-white", b.status === "next" && "text-slate-500")}>
                {fmt(b.status === "done" ? b.kcal_total : b.kcal_so_far, 0)}
              </span>
              {b.status !== "done" && <span className="text-xs text-slate-500"> / {fmt(b.kcal_total, 0)}</span>}
              <span className="text-xs text-slate-500"> kcal</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function Energy() {
  const { crewId } = useApp();
  const crewName = useCrewName();
  const { data } = usePoll<EnergyData>(`/api/crew/${crewId}/energy?days=7`, 3000);
  if (!data) return <Empty />;
  const td = data.today;
  const m = data.metrics;
  const bal = m.energy_balance;
  const last = data.daily[data.daily.length - 1];
  const rows = data.daily.map((d) => ({ day: dayTick(d.day), burned: d.total, eaten: d.intake }));
  const burnRatio = td.kcal_expected > 0 ? td.kcal_so_far / td.kcal_expected : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageTitle
        sub={t("What your day costs: every activity, the energy it burns, and what you ate.")}
        right={!data.model.verified ? <Unverified source={data.model.source} /> : undefined}
      >
        {t("Energy")} · {crewName}
      </PageTitle>

      {/* Samsung Health Energy Score Gradient Hero Banner */}
      <div className="relative overflow-hidden rounded-card border border-accent/40 bg-gradient-to-r from-[#0B3866] via-[#0E2848] to-[#1A1638] p-6 shadow-glowBlue">
        <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-accent/25 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-widest text-accent">{t("Energy Score & Daily Burn")}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-5xl font-black tabular-nums text-white">{fmt(td.kcal_so_far, 0)}</span>
              <span className="text-lg font-semibold text-slate-300">/ {fmt(td.kcal_expected, 0)} kcal</span>
            </div>
            <p className="mt-1 text-sm text-slate-200">
              {t("Keep tracking your condition and metabolic balance across orbital activities.")}
            </p>
          </div>
          <Ring
            value={burnRatio}
            size={96}
            stroke={9}
            color="#00E5FF"
            label={`${Math.round(burnRatio * 100)}%`}
            sub={t("of day")}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Stat
          label={t("Burned so far today")}
          value={td.kcal_so_far}
          unit="kcal"
          color="#FF9100"
          sub={t("about {n} kcal by bedtime", { n: td.kcal_expected })}
        />
        <Stat label={t("Ate yesterday")} value={fmt(m.kcal?.value, 0)} unit="kcal" color="#00E676" sub={t("flight average 2296")} />
        <Stat label={t("Burned yesterday")} value={fmt(last?.total, 0)} unit="kcal" color="#00E5FF" />
        <Stat
          label={t("Balance yesterday")}
          value={`${(bal?.value ?? 0) > 0 ? "+" : ""}${fmt(bal?.value, 0)}`}
          unit="kcal"
          color={(bal?.value ?? 0) < -500 ? "#FF9100" : "#B388FF"}
          sub={t("eaten minus burned")}
        />
      </div>

      {data.alerts.map((a) => <SimpleAlert key={a.id} alert={a} />)}

      {td.live && (
        <div className="rounded-2xl border border-warn/60 bg-warn/15 p-4 text-lg shadow-glowAmber">
          <span className="font-bold text-warn">{t("Workout running")}</span> ·{" "}
          {t("{n} kcal so far at {r} kcal/min", { n: fmt(td.live.kcal, 0), r: fmt(td.live.kcal_min, 1) })}
        </div>
      )}

      <Card
        title={t("Today's activities")}
        right={<span className="text-xs font-semibold text-slate-400">{t("work today: {h} h", { h: td.workload_h })}</span>}
      >
        <Timeline blocks={td.blocks} live={td.live} />
        <p className="mt-3 text-xs text-slate-500">
          {t("Energy = MET × body mass × hours. Exercise uses the machine settings (load, speed, watts).")}
        </p>
      </Card>

      <div className="grid gap-5 md:grid-cols-[1.5fr_1fr]">
        <Card title={t("Last 7 days: burned vs eaten")}>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={AXIS} />
                <YAxis tick={AXIS} width={48} />
                <Tooltip contentStyle={TIP} />
                <Legend />
                <Bar dataKey="burned" name={t("Burned")} fill="#FF9100" radius={[6, 6, 0, 0]} />
                <Bar dataKey="eaten" name={t("Eaten")} fill="#00E676" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title={t("Body mass")}>
          <div className="text-5xl font-black tabular-nums text-white">
            {fmt(m.mass_kg?.value, 1)}
            <span className="ml-1.5 text-xl font-medium text-slate-400">kg</span>
          </div>
          <div className="mt-1 text-sm text-slate-400">
            {t("Your normal: {v} kg", { v: fmt(m.mass_kg?.baseline_mean, 1) })}
            {m.mass_kg?.pct !== null && m.mass_kg?.pct !== undefined && (
              <span className={cx("ml-2 font-bold", (m.mass_kg.pct ?? 0) < -3 ? "text-warn" : "text-accent")}>
                {m.mass_kg.pct > 0 ? "+" : ""}
                {fmt(m.mass_kg.pct, 1)}%
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-slate-300">{m.mass_kg?.meaning}</p>
          <p className="mt-2 text-sm text-slate-300">
            {(bal?.ewma ?? 0) < -300
              ? t("You are burning more than you eat. Add a snack to keep your strength.")
              : t("Intake and energy use are close. Keep it up.")}
          </p>
        </Card>
      </div>
    </div>
  );
}
