import { TrendBlock } from "../../components/charts";
import { Card, Empty, GroundNote, PageTitle, ProgressBar, SourceTag, Unverified, cx } from "../../components/ui";
import { dayLabel, fmt, usePoll, type Metric, type ViewInfo } from "../../lib/api";
import { useApp, useCrewName } from "../../lib/context";
import { t } from "../../lib/i18n";

interface Target { value: number; range?: [number, number]; max?: boolean; source: string; verified: boolean }
interface NutritionData {
  targets: Record<string, Target>; water_target_l: number; metrics: Record<string, Metric>; view: ViewInfo;
  supplements: { protocol_id: number; label: string; dose_text: string; status: string; adherence: number | null; start_day: number;
    doses: { day: number; taken: number; source: string }[] }[];
}

export default function TeamNutrition() {
  const { crewId } = useApp();
  const name = useCrewName();
  const { data } = usePoll<NutritionData>(`/api/crew/${crewId}/nutrition?side=ground`, 6000);
  if (!data) return <Empty />;
  const m = data.metrics;
  const nutrients: [string, string, string][] = [
    ["kcal", t("Energy"), "kcal"], ["protein_g", t("Protein"), "g"], ["sodium_mg", t("Sodium"), "mg"], ["calcium_mg", t("Calcium"), "mg"], ["vitd_iu", t("Vitamin D"), "IU"],
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageTitle sub={t("Galley meals (auto-logged) plus the crew member's own entries")}>{t("Nutrition · {n}", { n: name })}</PageTitle>
      <GroundNote view={data.view} />
      <Card title={t("Last full day against plan ({d})", { d: dayLabel(data.view.data_day) })}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {nutrients.map(([key, label, unit]) => {
            const mm = m[key];
            const tg = data.targets[key];
            const v = mm?.value ?? 0;
            const ratio = tg ? v / tg.value : 0;
            const inRange = tg?.range ? v >= tg.range[0] && v <= tg.range[1] : tg?.max ? v <= tg.value : v >= tg.value * 0.9;
            return (
              <div key={key} className="rounded-xl bg-ink-850 p-3">
                <div className="flex items-center justify-between"><span className="font-semibold">{label}</span>{tg && <SourceTag verified={tg.verified} source={tg.source} />}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{fmt(v, 0)} <span className="text-base font-normal text-slate-400">/ {tg?.max ? t("max") + " " : ""}{tg?.value} {unit}</span></div>
                <div className="my-2"><ProgressBar value={Math.min(ratio, 1.3) / 1.3} marker={1 / 1.3} color={inRange ? "#00E676" : "#FF9100"} /></div>
                <div className="text-xs text-slate-400">{tg?.range ? t("Flight range {a}–{b} {u}. ", { a: tg.range[0], b: tg.range[1], u: unit }) : ""}{t("baseline {v} {u}", { v: fmt(mm?.baseline_mean, 0), u: unit })}</div>
                <div className="mt-1 text-sm text-slate-300">{mm?.meaning}</div>
              </div>
            );
          })}
          {m.water_l && (
            <div className="rounded-xl bg-ink-850 p-3">
              <div className="flex items-center justify-between"><span className="font-semibold">{t("Water")}</span><Unverified source="Water target model is a simulation assumption" /></div>
              <div className="mt-1 text-2xl font-bold">{fmt(m.water_l.value, 2)} <span className="text-base font-normal text-slate-400">/ {data.water_target_l} L</span></div>
              <div className="my-2"><ProgressBar value={(m.water_l.value ?? 0) / data.water_target_l} color={(m.water_l.value ?? 0) >= data.water_target_l ? "#00E676" : "#FF9100"} /></div>
              <div className="text-sm text-slate-300">{m.water_l.meaning}</div>
            </div>
          )}
        </div>
      </Card>

      <Card title={t("Supplement adherence")}>
        {data.supplements.length === 0 && <p className="text-slate-400">{t("No supplement protocol.")}</p>}
        <div className="space-y-3">
          {data.supplements.map((s) => (
            <div key={s.protocol_id} className="rounded-xl bg-ink-850 p-4">
              <div className="text-lg font-semibold">{s.label} <span className="font-normal text-slate-400">· {s.dose_text}</span></div>
              <div className="text-sm text-slate-400">{t("Since {d} · adherence {a}", { d: dayLabel(s.start_day), a: s.adherence === null ? "–" : `${Math.round(s.adherence * 100)}%` })}</div>
              <div className="mt-3 flex flex-wrap gap-1.5" aria-label={t("Last 14 days of doses")}>
                {s.doses.map((d) => (
                  <span key={d.day} title={`${dayLabel(d.day)}: ${d.taken ? t("taken") : t("missed")} (${t(d.source)})`}
                    className={cx("flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold", d.taken ? "bg-ok/80 text-ink-950" : "bg-bad/30 text-bad")}>{d.day}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>{m.kcal && <TrendBlock m={m.kcal} height={200} />}</Card>
        <Card>{m.water_l && <TrendBlock m={m.water_l} height={200} />}</Card>
        <Card>{m.protein_g && <TrendBlock m={m.protein_g} height={180} />}</Card>
        <Card>{m.sodium_mg && <TrendBlock m={m.sodium_mg} height={180} />}</Card>
      </div>
    </div>
  );
}
