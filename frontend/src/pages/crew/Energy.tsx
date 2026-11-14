import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, TIP } from "../../components/charts";
import { Card, Empty, PageTitle, SimpleAlert, Stat, Unverified, cx } from "../../components/ui";
import { clockTime, dayTick, fmt, usePoll, type Alert, type Metric } from "../../lib/api";
import { useApp } from "../../lib/context";
import { t } from "../../lib/i18n";

export const ACT_ICON: Record<string, string> = {
  sleep: "☾", hygiene: "◌", meal: "◍", planning: "☰", science: "⚗", maintenance: "⚙", exercise: "⚡", leisure: "☺",
  family_call: "☎", medical: "✚", vestibular_rehab: "⊕", eva: "✧", rest: "○", skipped: "○",
};
export const ACT_COLOR: Record<string, string> = {
  sleep: "#6366f1", hygiene: "#64748b", meal: "#22c55e", planning: "#94a3b8", science: "#38bdf8", maintenance: "#0ea5e9",
  exercise: "#fb923c", ared: "#fb923c", t2: "#f97316", cevis: "#fdba74", rehab: "#fb923c", leisure: "#a78bfa",
  family_call: "#f472b6", medical: "#2dd4bf", vestibular_rehab: "#c084fc", eva: "#facc15", rest: "#475569", skipped: "#475569",
};

export interface Block {
  kind: string; start: number; end: number; minutes: number; label: string; device?: string; status: "done" | "now" | "next";
  kcal_total: number; kcal_so_far: number; met?: number; estimate?: boolean; logged?: boolean; overtime?: boolean;
}
interface EnergyData {
  today: { hour: number; mass_kg: number; blocks: Block[]; kcal_so_far: number; kcal_expected: number;
    live: { device: string; kcal: number; kcal_min: number } | null; workload_h: number };
  metrics: Record<string, Metric>; daily: ({ day: number; total: number; intake: number | null } & Record<string, number>)[];
  alerts: Alert[]; model: { source: string; verified: boolean };
}

export function Timeline({ blocks, live }: { blocks: Block[]; live?: EnergyData["today"]["live"] }) {
  const max = Math.max(...blocks.map((b) => b.kcal_total), 1);
  return (
    <ol className="space-y-1.5">
      {blocks.map((b, i) => {
        const now = b.status === "now";
        const color = ACT_COLOR[b.device ?? b.kind] ?? "#64748b";
        return (
          <li key={i} className={cx("grid grid-cols-[64px_28px_1fr_auto] items-center gap-2 rounded-xl px-2 py-2 sm:grid-cols-[72px_32px_1fr_auto] sm:px-3",
            now ? "bg-accent/10 ring-1 ring-accent/60" : b.status === "done" ? "bg-ink-850" : "bg-ink-900")}>
            <span className="font-mono text-sm tabular-nums text-slate-400">{clockTime(b.start)}</span>
            <span className="text-center text-lg" style={{ color }} aria-hidden>{ACT_ICON[b.kind] ?? "•"}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cx("font-semibold", b.status === "next" && "text-slate-400")}>{b.label}</span>
                <span className="text-xs text-slate-500">{t("{m} min", { m: b.minutes })}</span>
                {now && <span className="rounded bg-accent px-1.5 text-xs font-bold text-ink-950">{t("NOW")}</span>}
                {b.status === "done" && b.kind === "exercise" && <span className="text-xs font-semibold text-ok">✓ {b.logged ? t("logged") : t("done")}</span>}
                {now && b.kind === "exercise" && live && <span className="text-xs font-semibold text-orange-300">{t("live")}</span>}
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-ink-700">
                <div className="h-full rounded-full" style={{ width: `${(b.kcal_total / max) * 100}%`, background: color, opacity: b.status === "next" ? 0.35 : 1 }} />
              </div>
            </div>
            <span className="text-right tabular-nums">
              <span className={cx("font-bold", b.status === "next" && "text-slate-500")}>{fmt(b.status === "done" ? b.kcal_total : b.kcal_so_far, 0)}</span>
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
  const { data } = usePoll<EnergyData>(`/api/crew/${crewId}/energy?days=7`, 3000);
  if (!data) return <Empty />;
  const td = data.today;
  const m = data.metrics;
  const bal = m.energy_balance;
  const last = data.daily[data.daily.length - 1];
  const rows = data.daily.map((d) => ({ day: dayTick(d.day), burned: d.total, eaten: d.intake }));

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageTitle sub={t("What your day costs: every activity, the energy it burns, and what you ate.")}
        right={!data.model.verified ? <Unverified source={data.model.source} /> : undefined}>{t("Energy")}</PageTitle>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("Burned so far today")} value={td.kcal_so_far} unit="kcal" color="#fdba74"
          sub={t("about {n} kcal by bedtime", { n: td.kcal_expected })} />
        <Stat label={t("Ate yesterday")} value={fmt(m.kcal?.value, 0)} unit="kcal" sub={t("flight average 2296")} />
        <Stat label={t("Burned yesterday")} value={fmt(last?.total, 0)} unit="kcal" />
        <Stat label={t("Balance yesterday")} value={`${(bal?.value ?? 0) > 0 ? "+" : ""}${fmt(bal?.value, 0)}`} unit="kcal"
          color={(bal?.value ?? 0) < -500 ? "#fbbf24" : undefined} sub={t("eaten minus burned")} />
      </div>

      {data.alerts.map((a) => <SimpleAlert key={a.id} alert={a} />)}

      {td.live && (
        <div className="rounded-2xl border-2 border-orange-300/60 bg-orange-300/10 p-4 text-lg">
          <span className="font-bold text-orange-300">{t("Workout running")}</span> · {t("{n} kcal so far at {r} kcal/min", { n: fmt(td.live.kcal, 0), r: fmt(td.live.kcal_min, 1) })}
        </div>
      )}

      <Card title={t("Today's activities")} right={<span className="text-sm text-slate-400">{t("work today: {h} h", { h: td.workload_h })}</span>}>
        <Timeline blocks={td.blocks} live={td.live} />
        <p className="mt-3 text-sm text-slate-500">
          {t("Energy = MET × body mass × hours. Exercise uses the machine settings (load, speed, watts).")}
        </p>
      </Card>

      <div className="grid gap-5 md:grid-cols-[1.5fr_1fr]">
        <Card title={t("Last 7 days: burned vs eaten")}>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="day" tick={AXIS} />
                <YAxis tick={AXIS} width={48} />
                <Tooltip contentStyle={TIP} />
                <Legend />
                <Bar dataKey="burned" name={t("Burned")} fill="#fdba74" radius={[4, 4, 0, 0]} />
                <Bar dataKey="eaten" name={t("Eaten")} fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title={t("Body mass")}>
          <div className="text-5xl font-bold tabular-nums">{fmt(m.mass_kg?.value, 1)}<span className="ml-1 text-xl text-slate-400">kg</span></div>
          <div className="mt-1 text-slate-400">{t("Your normal: {v} kg", { v: fmt(m.mass_kg?.baseline_mean, 1) })}
            {m.mass_kg?.pct !== null && m.mass_kg?.pct !== undefined && <span className={cx("ml-2 font-semibold", (m.mass_kg.pct ?? 0) < -3 ? "text-warn" : "text-slate-300")}>{m.mass_kg.pct > 0 ? "+" : ""}{fmt(m.mass_kg.pct, 1)}%</span>}
          </div>
          <p className="mt-2 text-sm text-slate-300">{m.mass_kg?.meaning}</p>
          <p className="mt-2 text-sm text-slate-300">
            {(bal?.ewma ?? 0) < -300 ? t("You are burning more than you eat. Add a snack to keep your strength.") : t("Intake and energy use are close. Keep it up.")}
          </p>
        </Card>
      </div>
    </div>
  );
}
