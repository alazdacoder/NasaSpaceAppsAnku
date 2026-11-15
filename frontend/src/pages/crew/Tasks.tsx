import { useState } from "react";
import { Empty, PageTitle, ProgressBar } from "../../components/ui";
import { api, usePoll, type Task } from "../../lib/api";
import { useApp } from "../../lib/context";
import { t, tn } from "../../lib/i18n";
import { C } from "../../lib/theme";
import { TaskRow } from "./Today";

interface TasksData {
  tasks: Task[];
  autopilot: boolean;
  protocols: {
    protocol_id: number;
    label: string;
    score: number | null;
    days_since_start: number;
    days_to_target_left: number | null;
  }[];
}

/** Today's tasks and the protocols running for this crew member (opened from the home tile). */
export default function Tasks() {
  const { crewId } = useApp();
  const { data, refresh } = usePoll<TasksData>(`/api/crew/${crewId}/today`, 2500);
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return <Empty />;

  const tasks = data.tasks ?? [];
  const pending = tasks.filter((x) => x.status !== "done").length;
  const confirm = async (id: string) => {
    setBusy(id);
    try {
      await api(`/api/crew/${crewId}/tasks/${encodeURIComponent(id)}/confirm`, { method: "POST" });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-6">
      <PageTitle
        sub={pending === 0 ? t("All tasks done today") : tn("{n} task left today", "{n} tasks left today", pending)}
        right={
          data.autopilot ? (
            <span
              className="rounded-full border border-ink-700 bg-ink-850 px-3 py-1 text-xs text-slate-400"
              title={t("Tasks you don't confirm are completed by the simulated crew at their usual adherence.")}
            >
              {t("demo autopilot on")}
            </span>
          ) : undefined
        }
      >
        {t("Today's tasks")}
      </PageTitle>

      <div className="space-y-2.5">
        {tasks.map((x) => (
          <TaskRow key={x.task_id} t={x} busy={busy === x.task_id} onConfirm={() => confirm(x.task_id)} />
        ))}
      </div>

      {(data.protocols ?? []).length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.protocols.map((p) => {
            const s = p.score ?? 0;
            return (
              <section key={p.protocol_id} className="rounded-tile border border-ink-700 bg-ink-900 p-4 shadow-card">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-bold text-fg">{p.label}</h2>
                  <span className="text-2xl font-extrabold tabular-nums text-fg">
                    {p.score === null ? "–" : `${Math.round(s * 100)}%`}
                  </span>
                </div>
                <div className="my-3">
                  <ProgressBar value={s} color={s > 0.6 ? C.ok : s > 0.3 ? C.warn : C.bad} height={8} />
                </div>
                <p className="text-sm text-slate-400">
                  {t("Is it working? Day {d}", { d: p.days_since_start })}
                  {p.days_to_target_left !== null
                    ? ` · ${t("~{n} days to target", { n: Math.ceil(p.days_to_target_left) })}`
                    : p.days_since_start >= 4
                    ? ` · ${t("not on track to target")}`
                    : ""}
                </p>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
