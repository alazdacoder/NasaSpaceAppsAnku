import { useState } from "react";
import { Button, Card, Empty, PageTitle, ProgressBar, Unverified, cx } from "../../components/ui";
import { api, dayLabel, fmt, usePoll, type Metric, type Task } from "../../lib/api";
import { useApp } from "../../lib/context";
import { t } from "../../lib/i18n";

interface Target { value: number; range?: [number, number]; max?: boolean; source: string; verified: boolean }
interface NutritionData {
  today_entries: { id: number; kind: string; payload: any }[];
  today_totals: Record<string, number>; targets: Record<string, Target>; water_target_l: number;
  metrics: Record<string, Metric>;
  supplements: { protocol_id: number; label: string; dose_text: string; adherence: number | null; start_day: number;
    doses: { day: number; taken: number; source: string }[]; today_task: Task | null }[];
  catalog: { id: string; label: string; kcal: number }[]; catalog_verified: boolean; water_task: Task | null;
}

export default function Food() {
  const { crewId } = useApp();
  const { data, refresh } = usePoll<NutritionData>(`/api/crew/${crewId}/nutrition`, 4000);
  const [flash, setFlash] = useState("");
  if (!data) return <Empty />;

  const add = async (body: any, label: string) => {
    await api(`/api/crew/${crewId}/manual`, { body });
    setFlash(t("Logged: {x}", { x: label }));
    setTimeout(() => setFlash(""), 2000);
    refresh();
  };
  const m = data.metrics;
  const extraWater = data.today_totals.water_l ?? 0;
  const rows: [string, string, string, number | undefined][] = [
    ["kcal", t("Energy"), "kcal", data.targets.kcal?.value],
    ["protein_g", t("Protein"), "g", data.targets.protein_g?.value],
    ["water_l", t("Water"), "L", data.water_target_l],
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageTitle sub={t("Log water and extra food in one tap. Galley meals are logged for you.")}
        right={flash ? <span className="rounded-lg bg-ok/15 px-3 py-2 font-semibold text-ok">{flash}</span> : undefined}>{t("Food & water")}</PageTitle>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title={t("Water")}>
          <div className="text-sm text-slate-400">{t("Today's target: {n} L in total", { n: data.water_target_l })}</div>
          <div className="mt-1 text-3xl font-bold">{t("+{n} L logged", { n: fmt(extraWater, 2) })}</div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[0.25, 0.5, 0.75].map((l) => <Button key={l} kind="ghost" className="text-lg" onClick={() => add({ kind: "water", liters: l }, t("{n} mL water", { n: l * 1000 }))}>+{l * 1000} mL</Button>)}
          </div>
          {data.water_task && (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-ink-850 p-3">
              <span>{data.water_task.title}</span>
              {data.water_task.status === "done" ? <span className="font-semibold text-ok">✓ {t("Done")}</span>
                : <Button kind="ok" onClick={() => api(`/api/crew/${crewId}/tasks/water/confirm`, { method: "POST" }).then(refresh)}>{t("I drank it")}</Button>}
            </div>
          )}
        </Card>

        <Card title={t("Extra food")} right={!data.catalog_verified ? <Unverified source="Food catalogue nutrient values are illustrative" /> : undefined}>
          <div className="grid grid-cols-2 gap-2">
            {data.catalog.map((c) => (
              <Button key={c.id} kind="ghost" onClick={() => add({ kind: "food", item: c.id }, c.label)} className="text-left">
                <div>{c.label}</div><div className="text-xs font-normal text-slate-400">{c.kcal} kcal</div>
              </Button>
            ))}
          </div>
          <div className="mt-3 text-sm text-slate-400">{t("Extra today: {n} kcal", { n: fmt(data.today_totals.kcal ?? 0, 0) })}</div>
        </Card>
      </div>

      {data.supplements.map((s) => (
        <Card key={s.protocol_id} title={t("Supplement: {x}", { x: s.label })}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-lg">{s.dose_text}</div>
              <div className="text-sm text-slate-400">{t("Since {d} · taken {p} of the time", { d: dayLabel(s.start_day), p: s.adherence === null ? "–" : `${Math.round(s.adherence * 100)}%` })}</div>
            </div>
            {s.today_task && s.today_task.status !== "done" ? (
              <Button kind="ok" className="text-lg" onClick={() => api(`/api/crew/${crewId}/tasks/${encodeURIComponent(s.today_task!.task_id)}/confirm`, { method: "POST" }).then(refresh)}>{t("Took today's dose")}</Button>
            ) : <span className="text-lg font-semibold text-ok">{s.today_task ? t("Today's dose taken ✓") : ""}</span>}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label={t("Last 14 days of doses")}>
            {s.doses.map((d) => (
              <span key={d.day} title={`${dayLabel(d.day)}: ${d.taken ? t("taken") : t("missed")}`}
                className={cx("flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold", d.taken ? "bg-ok/80 text-ink-950" : "bg-bad/30 text-bad")}>
                {d.taken ? "✓" : "✕"}
              </span>
            ))}
          </div>
        </Card>
      ))}

      <Card title={t("Yesterday")} right={<span className="text-sm text-slate-400">{t("whole day, galley meals included")}</span>}>
        <div className="grid gap-4 sm:grid-cols-3">
          {rows.map(([key, label, unit, target]) => {
            const v = m[key]?.value ?? 0;
            const ok = target ? v >= target * 0.9 : true;
            return (
              <div key={key} className="rounded-xl bg-ink-850 p-4">
                <div className="flex items-center justify-between font-semibold">{label}
                  <span className={cx("rounded-full px-2 text-sm", ok ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn")}>{ok ? t("On target") : t("Below target")}</span>
                </div>
                <div className="mt-1 text-3xl font-bold tabular-nums">{fmt(v, key === "water_l" ? 1 : 0)} <span className="text-base font-normal text-slate-400">/ {target ? fmt(target, key === "water_l" ? 1 : 0) : "–"} {unit}</span></div>
                <div className="my-2"><ProgressBar value={target ? v / target : 0} color={ok ? "#22c55e" : "#fbbf24"} /></div>
                <div className="text-sm text-slate-400">{m[key]?.meaning}</div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
