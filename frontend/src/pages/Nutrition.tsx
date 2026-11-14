import { useState } from "react";
import { TrendBlock } from "../components/charts";
import { Button, Card, Empty, ProgressBar, SourceTag, Unverified, cx } from "../components/ui";
import { api, dayLabel, fmt, usePoll, type Metric, type Task } from "../lib/api";
import { useApp } from "../lib/context";

interface Target { value: number; range?: [number, number]; max?: boolean; source: string; verified: boolean }
interface NutritionData {
  today_entries: { id: number; kind: string; payload: any }[];
  today_totals: Record<string, number>;
  targets: Record<string, Target>;
  water_target_l: number;
  metrics: Record<string, Metric>;
  supplements: { protocol_id: number; label: string; dose_text: string; status: string; adherence: number | null; start_day: number;
    doses: { day: number; taken: number; source: string }[]; today_task: Task | null }[];
  catalog: { id: string; label: string; kcal: number }[];
  catalog_verified: boolean;
}

const NUTRIENTS: [string, string, string][] = [
  ["kcal", "Energy", "kcal"], ["protein_g", "Protein", "g"], ["sodium_mg", "Sodium", "mg"], ["calcium_mg", "Calcium", "mg"], ["vitd_iu", "Vitamin D", "IU"],
];

export default function Nutrition() {
  const { crewId } = useApp();
  const { data, refresh } = usePoll<NutritionData>(`/api/crew/${crewId}/nutrition`, 4000);
  const [flash, setFlash] = useState("");
  if (!data) return <Empty />;

  const add = async (body: any, label: string) => {
    await api(`/api/crew/${crewId}/manual`, { body });
    setFlash(`Logged: ${label}`);
    setTimeout(() => setFlash(""), 2000);
    refresh();
  };
  const m = data.metrics;
  const feeling = data.today_entries.filter((e) => e.kind === "feeling").pop()?.payload.value;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold">Nutrition</h1>
        {flash && <span className="rounded-lg bg-ok/15 px-3 py-1 font-semibold text-ok">{flash}</span>}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Log now" right={!data.catalog_verified ? <Unverified source="Food catalogue nutrient values are illustrative" /> : undefined}>
          <div className="text-sm text-slate-400">Water</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {[0.25, 0.5, 0.75].map((l) => <Button key={l} kind="ghost" onClick={() => add({ kind: "water", liters: l }, `${l * 1000} mL water`)}>+{l * 1000} mL</Button>)}
          </div>
          <div className="mt-4 text-sm text-slate-400">Food (galley meals are auto-logged; add extras here)</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {data.catalog.map((c) => <Button key={c.id} kind="ghost" onClick={() => add({ kind: "food", item: c.id }, c.label)}>{c.label}</Button>)}
          </div>
          <div className="mt-4 text-sm text-slate-400">How do I feel today?</div>
          <div className="mt-1 flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => add({ kind: "feeling", value: n }, `feeling ${n}/5`)}
                className={cx("h-14 w-14 rounded-xl text-xl font-bold", feeling === n ? "bg-accent text-ink-950" : "bg-ink-800")}>{n}</button>
            ))}
            <span className="self-center text-sm text-slate-400">1 = bad · 5 = great</span>
          </div>
        </Card>

        <Card title="Today so far (your entries)">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-ink-850 p-3">
              <div className="text-sm text-slate-400">Extra water</div>
              <div className="text-3xl font-bold">{fmt(data.today_totals.water_l ?? 0, 2)} <span className="text-base text-slate-400">L</span></div>
              <div className="text-sm text-slate-400">today's target {data.water_target_l} L total</div>
            </div>
            <div className="rounded-xl bg-ink-850 p-3">
              <div className="text-sm text-slate-400">Extra food</div>
              <div className="text-3xl font-bold">{fmt(data.today_totals.kcal ?? 0, 0)} <span className="text-base text-slate-400">kcal</span></div>
              <div className="text-sm text-slate-400">on top of galley meals</div>
            </div>
          </div>
          <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-sm text-slate-300">
            {data.today_entries.length === 0 && <li className="text-slate-500">Nothing logged yet today.</li>}
            {data.today_entries.map((e) => (
              <li key={e.id}>• {e.kind === "water" ? `${e.payload.liters * 1000} mL water` : e.kind === "food" ? e.payload.label : e.kind === "feeling" ? `Feeling ${e.payload.value}/5` : `Supplement dose`}</li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Yesterday against plan" right={<span className="text-sm text-slate-400">full day, incl. auto-logged galley meals</span>}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {NUTRIENTS.map(([key, label, unit]) => {
            const mm = m[key];
            const t = data.targets[key];
            const v = mm?.value ?? 0;
            const ratio = t ? v / t.value : 0;
            const inRange = t?.range ? v >= t.range[0] && v <= t.range[1] : t?.max ? v <= t.value : v >= t.value * 0.9;
            return (
              <div key={key} className="rounded-xl bg-ink-850 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{label}</span>
                  {t && <SourceTag verified={t.verified} source={t.source} />}
                </div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{fmt(v, 0)} <span className="text-base font-normal text-slate-400">/ {t?.max ? "max " : ""}{t?.value} {unit}</span></div>
                <div className="my-2"><ProgressBar value={Math.min(ratio, 1.3) / 1.3} marker={1 / 1.3} color={inRange ? "#22c55e" : "#fbbf24"} /></div>
                <div className="text-xs text-slate-400">
                  {t?.range ? `Flight range ${t.range[0]}–${t.range[1]} ${unit}. ` : ""}baseline {fmt(mm?.baseline_mean, 0)} {unit}
                </div>
                <div className="mt-1 text-sm text-slate-300">{mm?.meaning}</div>
              </div>
            );
          })}
          {m.water_l && (
            <div className="rounded-xl bg-ink-850 p-3">
              <div className="flex items-center justify-between"><span className="font-semibold">Water</span><Unverified source="Water target model is a simulation assumption" /></div>
              <div className="mt-1 text-2xl font-bold">{fmt(m.water_l.value, 2)} <span className="text-base font-normal text-slate-400">/ {data.water_target_l} L</span></div>
              <div className="my-2"><ProgressBar value={(m.water_l.value ?? 0) / data.water_target_l} color={(m.water_l.value ?? 0) >= data.water_target_l ? "#22c55e" : "#fbbf24"} /></div>
              <div className="text-sm text-slate-300">{m.water_l.meaning}</div>
            </div>
          )}
        </div>
      </Card>

      <Card title="Supplements against plan">
        {data.supplements.length === 0 && <p className="text-slate-400">No supplement protocol. If the Lab finds a need, a task will appear on Today.</p>}
        {data.supplements.map((s) => (
          <div key={s.protocol_id} className="rounded-xl bg-ink-850 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{s.label} <span className="font-normal text-slate-400">· {s.dose_text}</span></div>
                <div className="text-sm text-slate-400">Since {dayLabel(s.start_day)} · adherence {s.adherence === null ? "–" : `${Math.round(s.adherence * 100)}%`}</div>
              </div>
              {s.today_task && s.today_task.status !== "done" ? (
                <Button kind="ok" onClick={() => api(`/api/crew/${crewId}/tasks/${encodeURIComponent(s.today_task!.task_id)}/confirm`, { method: "POST" }).then(refresh)}>Took today's dose</Button>
              ) : <span className="font-semibold text-ok">{s.today_task ? "Today's dose taken ✓" : ""}</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Last 14 days of doses">
              {s.doses.map((d) => (
                <span key={d.day} title={`${dayLabel(d.day)}: ${d.taken ? "taken" : "missed"} (${d.source})`}
                  className={cx("flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold", d.taken ? "bg-ok/80 text-ink-950" : "bg-bad/30 text-bad")}>
                  {d.day}
                </span>
              ))}
            </div>
          </div>
        ))}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>{m.kcal && <TrendBlock m={m.kcal} height={200} />}</Card>
        <Card>{m.water_l && <TrendBlock m={m.water_l} height={200} />}</Card>
      </div>
    </div>
  );
}
