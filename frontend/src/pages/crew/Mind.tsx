import { useEffect, useRef, useState } from "react";
import { SimpleLine } from "../../components/charts";
import { Button, Card, Empty, PageTitle, Rating, SimpleAlert, Unverified, cx } from "../../components/ui";
import { api, fmt, usePoll, type Alert, type Metric, type Rec } from "../../lib/api";
import { useApp } from "../../lib/context";
import { t } from "../../lib/i18n";

interface MindData {
  metrics: Record<string, Metric>; alerts: Alert[]; tips: Rec[];
  checkin_today: Record<string, number> | null; pvt_today: { mean_rt_ms: number; lapses: number } | null;
  live_calls_possible: boolean;
}

const QUESTIONS: { key: string; q: string; low: string; high: string; faces: string[] }[] = [
  { key: "feeling", q: "How do you feel today?", low: "bad", high: "great", faces: ["☹", "🙁", "😐", "🙂", "😄"] },
  { key: "stress", q: "How stressed are you?", low: "calm", high: "very stressed", faces: ["😌", "🙂", "😐", "😟", "😫"] },
  { key: "tiredness", q: "How tired are you?", low: "fresh", high: "exhausted", faces: ["⚡", "🙂", "😐", "🥱", "😴"] },
  { key: "connection", q: "How connected do you feel to family, friends and crew?", low: "alone", high: "very close", faces: ["🏝", "🙁", "😐", "🙂", "🤝"] },
];

function CheckIn({ crewId, today, onDone }: { crewId: string; today: Record<string, number> | null; onDone: () => void }) {
  const [vals, setVals] = useState<Record<string, number | null>>(() => ({
    feeling: today?.feeling ?? null, stress: today?.stress ?? null, tiredness: today?.tiredness ?? null, connection: today?.connection ?? null,
  }));
  const [saved, setSaved] = useState(false);
  const complete = QUESTIONS.every((q) => vals[q.key] !== null);
  const save = async () => {
    await api(`/api/crew/${crewId}/manual`, { body: { kind: "checkin", ...vals } });
    setSaved(true);
    onDone();
  };
  return (
    <Card title={t("Daily check-in")} right={today && !saved ? <span className="text-sm text-ok">✓ {t("done today, you can change it")}</span> : undefined}>
      <div className="space-y-5">
        {QUESTIONS.map((q) => (
          <div key={q.key}>
            <div className="mb-2 text-lg font-semibold">{t(q.q)}</div>
            <Rating value={vals[q.key]} onChange={(v) => { setVals((s) => ({ ...s, [q.key]: v })); setSaved(false); }}
              low={t(q.low)} high={t(q.high)} faces={q.faces} />
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button kind="ok" className="min-w-[200px] text-lg" disabled={!complete} onClick={save}>{t("Save check-in")}</Button>
        {saved && <span className="font-semibold text-ok">{t("Saved. Thank you.")}</span>}
      </div>
      <p className="mt-3 text-sm text-slate-500">{t("Your answers are shared only with the flight surgeon and the crew psychologist.")}</p>
    </Card>
  );
}

type PvtState = "idle" | "wait" | "go" | "early" | "done";
const TRIALS = 10;

/** A short PVT-style reaction test: tap as soon as the circle turns orange. */
function ReactionTest({ crewId, normal, onDone }: { crewId: string; normal: number | null | undefined; onDone: () => void }) {
  const [state, setState] = useState<PvtState>("idle");
  const [rts, setRts] = useState<number[]>([]);
  const [falseStarts, setFalseStarts] = useState(0);
  const shownAt = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const next = () => {
    setState("wait");
    timer.current = window.setTimeout(() => { shownAt.current = performance.now(); setState("go"); }, 1500 + Math.random() * 2500);
  };
  const start = () => { setRts([]); setFalseStarts(0); next(); };
  const tap = async () => {
    if (state === "wait") {
      window.clearTimeout(timer.current);
      setFalseStarts((n) => n + 1);
      setState("early");
      timer.current = window.setTimeout(next, 900);
    } else if (state === "go") {
      const rt = performance.now() - shownAt.current;
      const all = [...rts, rt];
      setRts(all);
      if (all.length >= TRIALS) {
        setState("done");
        const mean = all.reduce((a, b) => a + b, 0) / all.length;
        const lapses = all.filter((x) => x > 500).length;
        await api(`/api/crew/${crewId}/manual`, { body: { kind: "pvt", mean_rt_ms: Math.round(Math.max(100, Math.min(2000, mean))), lapses, trials: all.length } }).catch(() => undefined);
        onDone();
      } else {
        next();
      }
    }
  };
  const mean = rts.length ? rts.reduce((a, b) => a + b, 0) / rts.length : null;
  const lapses = rts.filter((x) => x > 500).length;

  return (
    <Card title={t("Reaction test")} right={<span className="text-sm text-slate-400">{t("{n} taps, about 30 seconds", { n: TRIALS })}</span>}>
      <p className="text-slate-300">{t("Tap the big button as soon as it turns orange. It checks how alert you are today.")}</p>
      <button onClick={state === "idle" || state === "done" ? start : tap}
        className={cx("mt-3 flex h-48 w-full select-none items-center justify-center rounded-3xl text-2xl font-bold transition",
          state === "go" ? "bg-orange-400 text-ink-950" : state === "early" ? "bg-bad/30 text-bad" : state === "wait" ? "bg-ink-700 text-slate-300" : "bg-accent text-ink-950")}>
        {state === "idle" ? t("Start test") : state === "wait" ? t("Wait…") : state === "go" ? t("TAP!") : state === "early" ? t("Too early!") : t("Test again")}
      </button>
      <div className="mt-3 flex flex-wrap gap-4 text-slate-300">
        <span>{t("Taps: {n}/{m}", { n: rts.length, m: TRIALS })}</span>
        {mean !== null && <span>{t("Average: {n} ms", { n: Math.round(mean) })}</span>}
        <span>{t("Slow taps (>500 ms): {n}", { n: lapses })}</span>
        {falseStarts > 0 && <span>{t("Too early: {n}", { n: falseStarts })}</span>}
      </div>
      {state === "done" && mean !== null && (
        <p className="mt-2 text-lg font-semibold">
          {normal && mean > normal * 1.2 ? t("Slower than your normal ({n} ms). Take it easy with demanding tasks today.", { n: Math.round(normal) })
            : t("Close to your normal ({n} ms). Saved.", { n: normal ? Math.round(normal) : "–" })}
        </p>
      )}
    </Card>
  );
}

export default function Mind() {
  const { crewId } = useApp();
  const { data, refresh } = usePoll<MindData>(`/api/crew/${crewId}/mind`, 5000);
  if (!data) return <Empty />;
  const m = data.metrics;
  const wb = m.wellbeing;
  const wbVal = wb?.value;
  const wbWord = wbVal === null || wbVal === undefined ? "–" : wbVal >= 65 ? t("Good") : wbVal >= 50 ? t("Okay") : t("Low");

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageTitle sub={t("Long missions are hard on the mind too. A short daily check-in helps you and the ground notice early.")}
        right={!wb?.verified ? <Unverified source="Simulation design assumption" /> : undefined}>{t("Mind")}</PageTitle>

      <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
        <Card title={t("Your wellbeing")}>
          <div className="flex items-baseline gap-3">
            <span className="text-6xl font-black tabular-nums">{fmt(wbVal, 0)}</span><span className="text-xl text-slate-400">/100</span>
            <span className={cx("rounded-full px-3 py-1 text-lg font-bold", wbVal !== undefined && wbVal !== null && wbVal >= 65 ? "bg-ok/15 text-ok" : wbVal !== undefined && wbVal !== null && wbVal >= 50 ? "bg-warn/15 text-warn" : "bg-bad/15 text-bad")}>{wbWord}</span>
          </div>
          <div className="text-sm text-slate-400">{t("from yesterday's check-in · your normal {n}", { n: fmt(wb?.baseline_mean, 0) })}</div>
          <SimpleLine m={wb} days={14} height={130} color="#c084fc" />
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            {(["stress", "tiredness", "connection"] as const).map((k) => m[k] && (
              <div key={k} className="rounded-lg bg-ink-850 px-3 py-2">
                <div className="text-slate-400">{m[k].label}</div>
                <div className="text-xl font-bold">{fmt(m[k].ewma, 1)}<span className="text-sm text-slate-400">/5</span></div>
              </div>
            ))}
            {m.pvt_rt_ms && (
              <div className="rounded-lg bg-ink-850 px-3 py-2">
                <div className="text-slate-400">{t("Reaction time")}</div>
                <div className="text-xl font-bold">{fmt(m.pvt_rt_ms.value, 0)}<span className="text-sm text-slate-400"> ms</span></div>
              </div>
            )}
          </div>
        </Card>
        <div className="space-y-3">
          {data.alerts.map((a) => <SimpleAlert key={a.id} alert={a} />)}
          {data.alerts.length === 0 && <div className="rounded-2xl border border-ok/40 bg-ok/5 p-4 text-lg text-ok">{t("No concerns. Keep looking after yourself.")}</div>}
          {!data.live_calls_possible && (
            <div className="rounded-2xl border border-violet-400/40 bg-violet-500/10 p-4 text-slate-200">
              {t("The link delay is too long for live calls. Record a video message for home instead; it will be sent at the next link window.")}
            </div>
          )}
          <Card title={t("Ideas for today")}>
            <ul className="space-y-2 text-slate-200">
              {(data.tips.length ? data.tips.map((r) => r.text) : [t("Take 15-20 minutes for yourself today - music, the window view, or a chat with the crew."),
                t("Keep a regular sleep time; dim screens an hour before."), t("Exercise also lifts your mood.")]).map((x, i) => (
                <li key={i} className="flex gap-2"><span className="text-accent">→</span><span>{x}</span></li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <CheckIn crewId={crewId} today={data.checkin_today} onDone={refresh} />
      <ReactionTest crewId={crewId} normal={m.pvt_rt_ms?.baseline_mean} onDone={refresh} />
      {data.pvt_today && <p className="text-sm text-slate-400">{t("Today's test: {n} ms average, {l} slow taps.", { n: Math.round(data.pvt_today.mean_rt_ms), l: data.pvt_today.lapses })}</p>}
    </div>
  );
}
