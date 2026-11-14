import { useState } from "react";
import { TrendBlock } from "../../components/charts";
import { AlertCard, Card, Empty, GroundNote, MetricCard, PageTitle, Seg, SourceTag, Stat, cx } from "../../components/ui";
import { dayLabel, fmt, usePoll, type Alert, type Metric, type ViewInfo } from "../../lib/api";
import { useApp, useCrewName } from "../../lib/context";
import { getLang, t } from "../../lib/i18n";

export interface Session { day: number; date: string; status: "done" | "missed" | "today" | "today_done" | "planned"; results: Record<string, number | null> }
export interface MissionTest {
  id: string; label: string; detail: string; metrics: string[]; category_id: number; category: string; mrid: string;
  sessions: Session[]; next: Session | null;
}
export interface AnnualPlan {
  month: string; age: number; in_flight: boolean; source: string; verified: boolean;
  items: { id: string; label: string; rule: string; due: boolean }[];
}
export interface LsahData {
  profile: { name: string; role: string; sex: "F" | "M"; birth: string; age: number; flights: number; last_dxa_year: number };
  annual: AnnualPlan; tests: MissionTest[]; metrics: Record<string, Metric>; alerts: Alert[];
  dates: { today: string; launch: string; landing: string }; source: string; schedule: { source: string; verified: boolean };
  view: ViewInfo;
}
interface CatalogEntry {
  id: number; title: string; variables: string; mrid: string; app_metrics: string[];
  phases: { pre: boolean; in: boolean; post: boolean; annual: string };
}
interface Catalog { source: string; verified: boolean; catalog: CatalogEntry[] }

export function monthName(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(getLang() === "tr" ? "tr-TR" : "en-GB", { month: "long", year: "numeric" });
}

export function dateText(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(getLang() === "tr" ? "tr-TR" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_STYLE: Record<Session["status"], string> = {
  done: "bg-ok/20 text-ok border-ok/40", missed: "bg-bad/15 text-bad border-bad/40", today: "bg-accent text-ink-950 border-accent",
  today_done: "bg-accent/30 text-accent border-accent", planned: "bg-ink-850 text-slate-400 border-ink-700",
};

function annualText(a: string) {
  if (a === "yes") return "✓";
  if (a === "Every 3 yr.") return t("every 3 years");
  if (a === "Age-based") return t("by age");
  return a ? a : "";
}

function CatalogTable({ metrics }: { metrics: Record<string, { label: string }> | undefined }) {
  const { data } = usePoll<Catalog>("/api/lsah", 600000);
  const [f, setF] = useState<"all" | "pre" | "in" | "post" | "annual" | "app">("all");
  if (!data) return <Card title={t("LSAH test catalog")}><Empty /></Card>;
  const rows = data.catalog.filter((c) => f === "all" || (f === "app" ? c.app_metrics.length > 0 : f === "annual" ? !!c.phases.annual : c.phases[f]));
  const mark = (b: boolean) => (b ? <span className="font-bold text-ok">✓</span> : <span className="text-slate-600">–</span>);
  return (
    <Card title={t("LSAH test catalog ({n} categories)", { n: data.catalog.length })} right={<SourceTag verified={data.verified} source={data.source} />}>
      <p className="mb-3 text-sm text-slate-400">{t("Every data category LSAH holds, with the mission phase it is collected in and the NASA medical requirement (MRID) behind it. The last column shows which measurements of this app belong to the category.")}</p>
      <Seg size="sm" value={f} onChange={setF} options={[
        { id: "all", label: t("All") }, { id: "pre", label: t("Before flight") }, { id: "in", label: t("In flight") },
        { id: "post", label: t("After flight") }, { id: "annual", label: t("Annual") }, { id: "app", label: t("In this app") }]} />
      <div className="mt-3 max-h-[560px] overflow-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="sticky top-0 bg-ink-900 text-slate-400">
            <tr><th className="py-2 pr-2">{t("Category")}</th><th className="px-1 text-center">{t("Pre")}</th><th className="px-1 text-center">{t("In")}</th>
              <th className="px-1 text-center">{t("Post")}</th><th className="px-1 text-center">{t("Annual")}</th><th className="px-2">MRID</th><th>{t("In this app")}</th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-ink-800 align-top">
                <td className="py-2 pr-2"><div className="font-semibold text-slate-100">{c.title}</div><div className="text-xs text-slate-400">{c.variables}</div></td>
                <td className="px-1 text-center">{mark(c.phases.pre)}</td><td className="px-1 text-center">{mark(c.phases.in)}</td>
                <td className="px-1 text-center">{mark(c.phases.post)}</td><td className="px-1 text-center text-xs">{annualText(c.phases.annual)}</td>
                <td className="px-2 font-mono text-xs text-slate-400">{c.mrid}</td>
                <td className="text-xs text-accent">{c.app_metrics.map((m) => metrics?.[m]?.label ?? m).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function TestCalendar({ tests, compact }: { tests: MissionTest[]; compact?: boolean }) {
  return (
    <div className="space-y-3">
      {tests.map((x) => (
        <div key={x.id} className="rounded-xl bg-ink-850 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-semibold">{x.label}</div>
            {!compact && <div className="text-xs text-slate-400">{t("LSAH category: {c}", { c: x.category })} · <span className="font-mono">{x.mrid}</span></div>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {x.sessions.map((s) => {
              const res = Object.entries(s.results).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${fmt(v, 2)}`).join(", ");
              return (
                <span key={s.day} title={`${dateText(s.date)}${res ? ` · ${res}` : ""}`}
                  className={cx("rounded-lg border px-2 py-1 text-xs font-semibold tabular-nums", STATUS_STYLE[s.status])}>
                  {dayLabel(s.day)}{s.status === "done" ? " ✓" : s.status === "missed" ? " ✕" : ""}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TeamLsah() {
  const { crewId, meta } = useApp();
  const name = useCrewName();
  const { data } = usePoll<LsahData>(`/api/crew/${crewId}/lsah?side=ground`, 6000);
  if (!data) return <Empty />;
  const p = data.profile;
  const m = data.metrics;
  const due = data.annual.items.filter((i) => i.due);
  const notDue = data.annual.items.filter((i) => !i.due);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageTitle sub={t("Lifetime Surveillance of Astronaut Health: NASA's medical tests before, during and after flight, and every year.")}>
        {t("LSAH · {n}", { n: name })}
      </PageTitle>
      <GroundNote view={data.view} />
      <div className="rounded-xl border border-warn/50 bg-warn/5 p-3 text-sm text-slate-200">
        {t("Real LSAH records are protected by the Privacy Act and HIPAA and released only as grouped data or through an approved NASA data request. This crew is fictional: the tests, phases and annual-exam rules come from LSAH documents, the values are simulated.")}
      </div>
      {data.alerts.map((a) => <AlertCard key={a.id} alert={a} />)}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={t("Age")} value={p.age} sub={p.sex === "F" ? t("female") : t("male")} />
        <Stat label={t("Flights")} value={p.flights} sub={p.flights > 1 ? t("experienced") : t("first flight")} />
        <Stat label={t("Birth month")} value={<span className="text-xl">{monthName(p.birth)}</span>} sub={t("sets the annual exam month")} />
        <Stat label={t("Last DXA")} value={p.last_dxa_year} sub={t("before this mission's tests")} />
        <Stat label={t("Mission")} value={<span className="text-base">{dateText(data.dates.launch)}</span>} sub={t("landing {d}", { d: dateText(data.dates.landing) })} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Card title={t("Next annual exam: {m}", { m: monthName(data.annual.month) })} right={<SourceTag verified={data.annual.verified} source={data.annual.source} />}>
          <p className="text-sm text-slate-300">
            {t("Age then: {a}.", { a: data.annual.age })} {data.annual.in_flight ? t("It falls during the mission, so it is done with the post-flight exams.") : ""}
          </p>
          <ul className="mt-3 space-y-1.5">
            {due.map((i) => <li key={i.id} className="flex gap-2"><span className="text-ok">✓</span><span>{i.label}</span></li>)}
          </ul>
          {notDue.length > 0 && (
            <div className="mt-3 border-t border-ink-800 pt-2 text-sm text-slate-500">
              <div className="mb-1">{t("Not due this year:")}</div>
              <ul className="space-y-1">{notDue.map((i) => <li key={i.id}>– {i.label}</li>)}</ul>
            </div>
          )}
        </Card>
        <Card title={t("LSAH tests during this mission")} right={<SourceTag verified={data.schedule.verified} source={data.schedule.source} />}>
          <TestCalendar tests={data.tests} />
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
            <span className={cx("rounded border px-1.5", STATUS_STYLE.done)}>{t("done")}</span>
            <span className={cx("rounded border px-1.5", STATUS_STYLE.missed)}>{t("missed")}</span>
            <span className={cx("rounded border px-1.5", STATUS_STYLE.today)}>{t("today")}</span>
            <span className={cx("rounded border px-1.5", STATUS_STYLE.planned)}>{t("planned")}</span>
            <span>{t("The categories are LSAH's; the exact days are this demo's choice.")}</span>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {["bmd_hip", "vo2peak", "vitd_serum", "hemoglobin"].map((k) => m[k] && <MetricCard key={k} m={m[k]} showChart={false} personal={false} />)}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {["vitd_serum", "hemoglobin", "vo2peak", "bmd_hip"].map((k) => m[k] && <Card key={k}><TrendBlock m={m[k]} height={190} /></Card>)}
      </div>

      <CatalogTable metrics={meta?.metrics} />
    </div>
  );
}
