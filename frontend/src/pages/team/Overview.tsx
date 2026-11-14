import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { AXIS, GRID, TIP, TrendBlock } from "../../components/charts";
import { Button, Card, Empty, ProgressBar, StatusDot, StatusPill, cx } from "../../components/ui";
import { api, dayLabel, duration, fmt, missionTOf, missionTime, usePoll, type Level, type LinkStatus, type Metric } from "../../lib/api";
import { useApp } from "../../lib/context";
import { t } from "../../lib/i18n";

interface GroundState {
  crew_id: string; mission_t: number; today: number; overall: Level; phase: string;
  alerts: { id: string; title: string; level: Level; reason: string; kind: string; recs: string[] }[];
  protocols: { protocol_id: number; label: string; score: number | null; start_day: number; days_since_start: number; days_to_target_left: number | null; adherence: number | null; started_by: string;
    targets: { metric: string; label: string; start: number; target: number; current: number; progress: number }[] }[];
  tasks: { task_id: string; title: string; status: string }[];
  live: Record<string, number>; workout_active: boolean; live_kcal: number | null;
  metrics: Record<string, { value: number; ewma: number; z: number | null; status: Level; day: number }>;
}
interface Overview {
  crew: { id: string; name: string; role: string; state: GroundState | null; data_mission_t?: number; data_age_s?: number; received_age_s?: number; seq?: number; ground_last_day: number | null }[];
  link: LinkStatus; onboard_clock: any;
}
interface Packet { seq: number; crew_id: string | null; kind: string; status: string; age_s: number; arrives_in_s: number | null }

const CREW_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#f472b6"];
const TREND_CHOICES = ["u_volume", "caox_ss", "u_calcium", "u_citrate", "u_ph", "hr_rest", "sleep_h", "core_temp", "ex_week_min", "ared_week_min",
  "water_l", "kcal", "kcal_out", "energy_balance", "mass_kg", "wellbeing", "stress", "pvt_rt_ms", "connection", "vest_sot", "vest_dizzy", "co2_mmhg", "rad_cum", "spo2"];

function corrColor(r: number | null) {
  if (r === null) return "#0f1624";
  const a = Math.min(1, Math.abs(r));
  return r > 0 ? `rgba(56,189,248,${0.12 + a * 0.75})` : `rgba(244,63,94,${0.12 + a * 0.75})`;
}

function DemoPanel({ link }: { link: LinkStatus }) {
  const { meta, clock, refreshClock } = useApp();
  const [crew, setCrew] = useState("c1");
  const [ev, setEv] = useState("dehydration");
  const [marsDelay, setMarsDelay] = useState(Math.round(link.profile === "mars" ? link.delay_s : 1320));
  const [msg, setMsg] = useState("");
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const say = (x: string) => { setMsg(x); setTimeout(() => setMsg(""), 3500); };
  const post = async (path: string, body: any, note: string) => {
    setBusy(true);
    try { await api(path, { body }); refreshClock(); say(note); } catch (e: any) { say(e.message); } finally { setBusy(false); }
  };
  const speeds = clock?.day_seconds_options ?? [0, 120, 60, 20, 5];
  const land = clock?.landing_day ?? 180;

  return (
    <Card title={t("Demo panel")} className="border-accent/40" right={msg && <span className="text-sm font-semibold text-ok">{msg}</span>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-sm text-slate-400">{t("Mission profile (ground link)")}</div>
            <div className="flex flex-wrap gap-2">
              {meta && Object.entries(meta.profiles).map(([id, p]) => (
                <button key={id} onClick={() => post("/api/demo/profile", { profile: id, delay_s: id === "mars" ? marsDelay : undefined }, t("Profile: {p}", { p: p.label }))}
                  className={cx("min-h-[48px] rounded-xl px-4 font-semibold", link.profile === id ? "bg-accent text-ink-950" : "bg-ink-800")}>{p.label}</button>
              ))}
            </div>
            <label className="mt-2 block text-sm text-slate-400">
              {t("Mars one-way delay:")} <span className="font-semibold text-slate-100">{duration(marsDelay)}</span>
              <input type="range" min={meta?.profiles.mars?.delay_min_s ?? 20} max={meta?.profiles.mars?.delay_max_s ?? 1320} step={10} value={marsDelay}
                onChange={(e) => setMarsDelay(Number(e.target.value))}
                onMouseUp={() => link.profile === "mars" && post("/api/demo/profile", { profile: "mars", delay_s: marsDelay }, t("Mars delay {d}", { d: duration(marsDelay) }))}
                onTouchEnd={() => link.profile === "mars" && post("/api/demo/profile", { profile: "mars", delay_s: marsDelay }, t("Mars delay {d}", { d: duration(marsDelay) }))}
                className="mt-1 w-full accent-sky-400" />
            </label>
            <label className="mt-2 flex min-h-[44px] items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={link.forced_blackout} onChange={(e) => post("/api/demo/blackout", { on: e.target.checked }, e.target.checked ? t("Blackout forced") : t("Blackout cleared"))} />
              {t("Force link blackout (loss of signal)")}
            </label>
          </div>
          <div>
            <div className="mb-1 text-sm text-slate-400">{t("Mission clock")} · {missionTime(clock)} · {clock?.day_seconds ? t("1 day = {s} s", { s: clock.day_seconds }) : t("paused")}</div>
            <div className="flex flex-wrap gap-2">
              {speeds.map((s) => (
                <button key={s} onClick={() => post("/api/demo/speed", { day_seconds: s }, s ? t("1 day = {s} s", { s }) : t("Paused"))}
                  className={cx("min-h-[48px] rounded-xl px-4 font-semibold", clock?.day_seconds === s ? "bg-accent text-ink-950" : "bg-ink-800")}>
                  {s === 0 ? t("Pause") : t("1 day / {s} s", { s })}
                </button>
              ))}
              <button disabled={busy} className="min-h-[48px] rounded-xl bg-ink-800 px-4 font-semibold" onClick={() => post("/api/demo/skip", { days: 1 }, t("+1 day"))}>{t("+1 day")}</button>
              <button disabled={busy} className="min-h-[48px] rounded-xl bg-ink-800 px-4 font-semibold" onClick={() => post("/api/demo/skip", { days: 7 }, t("+7 days"))}>{t("+7 days")}</button>
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm text-slate-400">{t("Return to Earth (fast-forward, takes a few seconds)")}</div>
            <div className="flex flex-wrap gap-2">
              {[{ r: -14, l: t("Pre-landing training (L−14)") }, { r: 0, l: "R+0" }, { r: 1, l: "R+1" }, { r: 3, l: "R+3" }, { r: 7, l: "R+7" }].map((x) => (
                <button key={x.r} disabled={busy || (clock ? land + x.r <= clock.today : false)}
                  onClick={() => post("/api/demo/jump", { r_day: x.r }, t("Jumped to {d}", { d: x.r < 0 ? `${dayLabel(land + x.r)}` : `R+${x.r}` }))}
                  className="min-h-[48px] rounded-xl bg-violet-500/20 px-4 font-semibold text-violet-200 disabled:opacity-40">{x.l}</button>
              ))}
            </div>
            {busy && <div className="mt-1 text-sm text-slate-400">{t("Simulating the days in between…")}</div>}
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-sm text-slate-400">{t("Inject event")}</div>
            <div className="flex flex-wrap gap-2">
              <select value={crew} onChange={(e) => setCrew(e.target.value)} className="min-h-[48px] rounded-xl border border-ink-600 bg-ink-850 px-3">
                {meta?.crew.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={ev} onChange={(e) => setEv(e.target.value)} className="min-h-[48px] rounded-xl border border-ink-600 bg-ink-850 px-3">
                {meta && Object.entries(meta.injectable_events).map(([id, e]) => <option key={id} value={id}>{t("{l} ({d} d)", { l: e.label, d: e.days })}</option>)}
              </select>
              <Button onClick={() => post("/api/demo/inject", { crew_id: crew, kind: ev }, t("Event injected"))}>{t("Inject")}</Button>
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm text-slate-400">{t("Autopilot (simulated crew completes tasks you don't confirm)")}</div>
            <AutopilotToggles />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder={t("seed (default 42)")} className="min-h-[48px] w-44 rounded-xl border border-ink-600 bg-ink-850 px-3" />
            <Button kind="danger" disabled={busy} onClick={() => post("/api/demo/reset", { seed }, t("Simulation reset"))}>{t("Reset simulation")}</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function AutopilotToggles() {
  const { meta } = useApp();
  const [state, setState] = useState<Record<string, boolean>>({});
  useEffect(() => { api<Record<string, boolean>>("/api/demo/autopilot").then(setState).catch(() => undefined); }, []);
  return (
    <div className="flex flex-wrap gap-2">
      {meta?.crew.map((c) => {
        const on = state[c.id] ?? true;
        return (
          <button key={c.id} onClick={async () => { await api("/api/demo/autopilot", { body: { crew_id: c.id, on: !on } }); setState((s) => ({ ...s, [c.id]: !on })); }}
            className={cx("min-h-[44px] rounded-xl px-3 text-sm font-semibold", on ? "bg-ok/20 text-ok" : "bg-ink-800 text-slate-400")}>
            {c.name.split(" ")[0]}: {on ? t("on") : t("off")}
          </button>
        );
      })}
    </div>
  );
}

function LinkPanel({ link }: { link: LinkStatus }) {
  const { data } = usePoll<{ status: LinkStatus; packets: Packet[] }>("/api/link", 1000);
  const age = link.ground_data_age_s;
  const st: Record<string, string> = { queued: t("queued"), in_flight: t("in transit"), delivered: t("delivered"), acked: t("acked") };
  return (
    <Card title={t("Ground link")} right={<span className={cx("rounded-full px-3 py-1 text-sm font-bold", link.blackout ? "bg-bad/20 text-bad" : "bg-ok/15 text-ok")}>{link.blackout ? t("LOSS OF SIGNAL") : t("LINK UP")}</span>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-ink-850 p-3"><div className="text-sm text-slate-400">{t("Profile")}</div><div className="text-lg font-bold">{link.profile_label}</div></div>
        <div className="rounded-xl bg-ink-850 p-3"><div className="text-sm text-slate-400">{t("One-way delay")}</div><div className="text-2xl font-bold">{duration(link.delay_s)}</div></div>
        <div className="rounded-xl bg-ink-850 p-3"><div className="text-sm text-slate-400">{t("Newest data on ground is")}</div><div className={cx("text-2xl font-bold", (age ?? 0) > 60 ? "text-warn" : "")}>{t("{a} old", { a: duration(age) })}</div></div>
        <div className="rounded-xl bg-ink-850 p-3"><div className="text-sm text-slate-400">{link.blackout ? t("Signal back in") : t("Next blackout in")}</div><div className="text-2xl font-bold">{link.window_change_in_s === null ? t("forced") : duration(link.window_change_in_s)}</div></div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
        <div><div className="text-3xl font-bold tabular-nums">{link.queued}</div><div className="text-sm text-slate-400">{t("queued onboard")}</div></div>
        <div><div className="text-3xl font-bold tabular-nums text-warn">{link.in_flight}</div><div className="text-sm text-slate-400">{t("in transit")}</div></div>
        <div><div className="text-3xl font-bold tabular-nums text-ok">{link.delivered}</div><div className="text-sm text-slate-400">{t("delivered")}</div></div>
        <div><div className="text-3xl font-bold tabular-nums">{link.next_arrival_in_s === null ? "–" : duration(link.next_arrival_in_s)}</div><div className="text-sm text-slate-400">{t("next packet arrives")}</div></div>
      </div>
      {data && (
        <div className="mt-3 max-h-56 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-ink-900 text-slate-400"><tr><th className="py-1">#</th><th>{t("Kind")}</th><th>{t("Crew")}</th><th>{t("Status")}</th><th>{t("Created")}</th><th>{t("Arrives in")}</th></tr></thead>
            <tbody>
              {data.packets.map((p) => (
                <tr key={p.seq} className="border-t border-ink-800">
                  <td className="py-1 font-mono">{p.seq}</td><td>{p.kind}</td><td>{p.crew_id ?? "–"}</td>
                  <td className={cx(p.status === "in_flight" ? "text-warn" : p.status === "queued" ? "text-slate-300" : "text-ok")}>{st[p.status] ?? p.status}</td>
                  <td>{t("{a} ago", { a: duration(p.age_s) })}</td><td>{p.arrives_in_s === null ? "" : duration(p.arrives_in_s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">{t("Store-and-forward: onboard updates become numbered packets. The crew app never waits for the ground. Delays run in real time; link profile values are unverified.")}</p>
    </Card>
  );
}

function Trends({ crewIds }: { crewIds: { id: string; name: string }[] }) {
  const [cid, setCid] = useState("c1");
  const [sel, setSel] = useState<string[]>(["caox_ss", "u_volume", "wellbeing", "energy_balance"]);
  const { meta } = useApp();
  const { data } = usePoll<{ metrics: Record<string, Metric>; ground_last_day: number }>(`/api/surgeon/crew/${cid}/series?metrics=${sel.join(",")}`, 5000);
  return (
    <Card title={t("Trends per metric (ground copy)")} right={data && <span className="text-sm text-slate-400">{t("ground has data up to {d}", { d: dayLabel(data.ground_last_day) })}</span>}>
      <div className="flex flex-wrap gap-2">
        {crewIds.map((c) => <button key={c.id} onClick={() => setCid(c.id)} className={cx("min-h-[44px] rounded-xl px-3 font-semibold", cid === c.id ? "bg-accent text-ink-950" : "bg-ink-800")}>{c.name}</button>)}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {TREND_CHOICES.map((m) => (
          <button key={m} onClick={() => setSel((s) => s.includes(m) ? s.filter((x) => x !== m) : [...s, m].slice(-6))}
            className={cx("min-h-[36px] rounded-lg px-2.5 text-sm", sel.includes(m) ? "bg-accent/20 text-accent ring-1 ring-accent" : "bg-ink-850 text-slate-400")}>
            {meta?.metrics[m]?.label ?? m}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-5 lg:grid-cols-2">
        {data && sel.filter((m) => data.metrics[m]).map((m) => (
          <div key={m} className="rounded-xl bg-ink-850 p-3">
            <div className="mb-1 flex items-center gap-2 text-sm">
              <StatusDot level={data.metrics[m].status} size={10} />
              <span>{t("now {v} {u}", { v: fmt(data.metrics[m].ewma, data.metrics[m].decimals), u: data.metrics[m].unit })}</span>
              {data.metrics[m].z !== null && data.metrics[m].z !== undefined && <span className="text-slate-400">z {fmt(data.metrics[m].z, 1)}</span>}
              <span className="text-slate-400">{t("slope {s}/day", { s: fmt(data.metrics[m].slope, 2) })}</span>
            </div>
            <TrendBlock m={data.metrics[m]} height={170} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function Correlations({ crewIds }: { crewIds: { id: string; name: string }[] }) {
  const [crew, setCrew] = useState("all");
  const [pair, setPair] = useState<[string, string]>(["sleep_h", "pvt_rt_ms"]);
  const { data } = usePoll<{ metrics: string[]; labels: Record<string, string>; matrix: (number | null)[][]; n_days: number; scatter: { crew_id: string; day: number; x: number; y: number }[] | null }>(
    `/api/surgeon/correlations?crew=${crew}&x=${pair[0]}&y=${pair[1]}`, 15000);
  if (!data) return <Card title={t("Correlations")}><Empty /></Card>;
  const byCrew = crewIds.map((c, i) => ({ ...c, color: CREW_COLORS[i], pts: (data.scatter ?? []).filter((p) => p.crew_id === c.id) }));
  return (
    <Card title={t("Correlations (in-flight days, ground data)")} right={<span className="text-sm text-slate-400">{t("{n} crew-days · tap a cell", { n: data.n_days })}</span>}>
      <div className="mb-2 flex flex-wrap gap-2">
        {[{ id: "all", name: t("All crew") }, ...crewIds].map((c) => <button key={c.id} onClick={() => setCrew(c.id)} className={cx("min-h-[40px] rounded-lg px-3 text-sm font-semibold", crew === c.id ? "bg-accent text-ink-950" : "bg-ink-800")}>{c.name}</button>)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-0.5 text-xs">
            <thead><tr><th />{data.metrics.map((m) => <th key={m} className="h-28 w-9 align-bottom"><div className="w-9 origin-bottom-left translate-x-4 whitespace-nowrap text-left font-normal text-slate-400" style={{ transform: "rotate(-60deg)" }}>{data.labels[m]}</div></th>)}</tr></thead>
            <tbody>
              {data.metrics.map((a, i) => (
                <tr key={a}>
                  <td className="whitespace-nowrap pr-2 text-right text-slate-400">{data.labels[a]}</td>
                  {data.matrix[i].map((r, j) => (
                    <td key={j}>
                      <button onClick={() => setPair([a, data.metrics[j]])} title={`${data.labels[a]} / ${data.labels[data.metrics[j]]}: r = ${r ?? "n/a"}`}
                        className={cx("h-9 w-9 rounded text-[11px] font-semibold tabular-nums", pair[0] === a && pair[1] === data.metrics[j] && "ring-2 ring-white")}
                        style={{ background: corrColor(r) }}>{r === null ? "" : i === j ? "" : r.toFixed(1)}</button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-500">{t("Pearson r. Blue = rise together · red = one rises as the other falls. Correlation is not causation.")}</p>
        </div>
        <div className="h-80 rounded-xl bg-ink-850 p-2">
          <div className="px-2 text-sm font-semibold">{data.labels[pair[0]] ?? pair[0]} / {data.labels[pair[1]] ?? pair[1]}</div>
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
              <CartesianGrid stroke={GRID} />
              <XAxis dataKey="x" type="number" tick={AXIS} domain={["auto", "auto"]} name={data.labels[pair[0]]} />
              <YAxis dataKey="y" type="number" tick={AXIS} domain={["auto", "auto"]} width={44} name={data.labels[pair[1]]} />
              <ZAxis range={[24, 24]} />
              <Tooltip contentStyle={TIP} />
              {byCrew.map((c) => <Scatter key={c.id} name={c.name} data={c.pts} fill={c.color} isAnimationActive={false} />)}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}

function CrewCard({ c, onOpen }: { c: Overview["crew"][number]; onOpen: () => void }) {
  const s = c.state;
  const stale = (c.data_age_s ?? 0) > 60;
  const m = s?.metrics ?? {};
  const post = s?.phase === "postflight";
  return (
    <div className={cx("rounded-2xl border bg-ink-900 p-4", s?.overall === "red" ? "border-bad/60" : s?.overall === "amber" ? "border-warn/50" : "border-ink-700")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><div className="text-lg font-bold">{c.name}</div><div className="text-sm text-slate-400">{c.role}</div></div>
        {s && <StatusPill level={s.overall} />}
      </div>
      {!s ? <div className="mt-3 text-slate-400">{t("No data received yet.")}</div> : (
        <>
          <div className={cx("mt-2 rounded-lg px-2 py-1 text-sm", stale ? "bg-warn/15 text-warn" : "bg-ink-850 text-slate-300")}>
            {t("Data from {t} · {a} old", { t: missionTOf(c.data_mission_t), a: duration(c.data_age_s) })}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-xs">
            <div className="rounded-lg bg-ink-850 p-1.5"><div className="text-slate-400">{t("Wellbeing")}</div><div className="text-base font-bold">{fmt(m.wellbeing?.value, 0)}</div></div>
            <div className="rounded-lg bg-ink-850 p-1.5"><div className="text-slate-400">{t("Energy bal.")}</div><div className="text-base font-bold">{fmt(m.energy_balance?.ewma, 0)}</div></div>
            {post ? <div className="rounded-lg bg-violet-500/15 p-1.5"><div className="text-violet-300">{t("Readiness")}</div><div className="text-base font-bold">{fmt(m.vest_readiness?.value, 0)}/4</div></div>
              : <div className="rounded-lg bg-ink-850 p-1.5"><div className="text-slate-400">{t("Reaction")}</div><div className="text-base font-bold">{fmt(m.pvt_rt_ms?.value, 0)}</div></div>}
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {s.alerts.slice(0, 4).map((a) => <li key={a.id} className="flex gap-2"><StatusDot level={a.level} size={10} /><span>{a.title}</span></li>)}
            {s.alerts.length > 4 && <li className="text-slate-500">{t("+{n} more", { n: s.alerts.length - 4 })}</li>}
            {s.alerts.length === 0 && <li className="text-ok">{t("No alerts")}</li>}
          </ul>
          <div className="mt-2 text-sm text-slate-400">
            {t("Tasks: {d}/{n} done · HR {hr}", { d: s.tasks.filter((x) => x.status === "done").length, n: s.tasks.length, hr: fmt(s.live.hr, 0) })}
            {s.workout_active ? ` · ${t("exercising now ({k} kcal)", { k: s.live_kcal ?? 0 })}` : ""}
          </div>
          {s.protocols.map((p) => (
            <div key={p.protocol_id} className="mt-2">
              <div className="flex justify-between text-sm"><span>{p.label}</span><span>{p.score === null ? "–" : `${Math.round(p.score * 100)}%`}</span></div>
              <ProgressBar value={p.score ?? 0} color={(p.score ?? 0) > 0.6 ? "#22c55e" : (p.score ?? 0) > 0.3 ? "#fbbf24" : "#f43f5e"} height={8} />
            </div>
          ))}
          <button onClick={onOpen} className="mt-3 min-h-[44px] w-full rounded-xl bg-ink-800 font-semibold text-accent hover:bg-ink-700">{t("Open details ›")}</button>
        </>
      )}
    </div>
  );
}

export default function TeamOverview() {
  const { meta, setCrewId } = useApp();
  const nav = useNavigate();
  const { data } = usePoll<Overview>("/api/surgeon/overview", 1500);
  const { data: evts } = usePoll<{ events: { seq: number; crew_name: string; kind: string; level: string; text: string; mission_t: number; age_s: number; transit_s: number }[] }>("/api/surgeon/events", 3000);
  if (!data || !meta) return <Empty />;
  const crewIds = meta.crew.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t("All crew")}</h1>
          <p className="text-slate-400">{t("Onboard clock {c} — everything below arrived through the ground link.", { c: missionTime(data.onboard_clock) })}</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.crew.map((c) => <CrewCard key={c.id} c={c} onOpen={() => { setCrewId(c.id); nav("/team/alerts"); }} />)}
      </div>

      <DemoPanel link={data.link} />
      <LinkPanel link={data.link} />

      <Card title={t("Protocols and response score")}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="text-sm text-slate-400"><tr><th className="py-2">{t("Crew")}</th><th>{t("Protocol")}</th><th>{t("Since")}</th><th>{t("Started by")}</th><th>{t("Adherence")}</th><th>{t("Response")}</th><th>{t("Markers")}</th><th>{t("Days to target")}</th></tr></thead>
            <tbody>
              {data.crew.flatMap((c) => (c.state?.protocols ?? []).map((p) => (
                <tr key={`${c.id}-${p.protocol_id}`} className="border-t border-ink-800 align-top">
                  <td className="py-2">{c.name}</td><td>{p.label}</td><td>{dayLabel(p.start_day)}</td><td>{t(p.started_by)}</td>
                  <td>{p.adherence === null ? "–" : `${Math.round(p.adherence * 100)}%`}</td>
                  <td className="font-bold" style={{ color: (p.score ?? 0) > 0.6 ? "#22c55e" : (p.score ?? 0) > 0.3 ? "#fbbf24" : "#f43f5e" }}>{p.score === null ? "–" : `${Math.round(p.score * 100)}%`}</td>
                  <td className="text-sm">{p.targets.map((x) => t("{l}: {a}→{b} (target {c})", { l: x.label, a: fmt(x.start, 2), b: fmt(x.current, 2), c: fmt(x.target, 2) })).join(" · ")}</td>
                  <td>{p.days_to_target_left === null ? (p.days_since_start >= 4 ? t("not on track") : "–") : `~${Math.ceil(p.days_to_target_left)}`}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </Card>

      <Trends crewIds={crewIds} />
      <Correlations crewIds={crewIds} />

      <Card title={t("Event log (as received on the ground)")}>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-ink-900 text-slate-400"><tr><th className="py-1">#</th><th>{t("Mission time")}</th><th>{t("Crew")}</th><th>{t("Event")}</th><th>{t("Transit")}</th></tr></thead>
            <tbody>
              {evts?.events.map((e) => (
                <tr key={e.seq} className="border-t border-ink-800 align-top">
                  <td className="py-1 font-mono text-slate-500">{e.seq}</td>
                  <td className="whitespace-nowrap pr-2">{missionTOf(e.mission_t)}</td>
                  <td className="whitespace-nowrap pr-2">{e.crew_name}</td>
                  <td className={cx(e.level === "red" ? "text-rose-300" : e.level === "amber" || e.level === "warn" ? "text-amber-200" : "")}>{e.text}</td>
                  <td className="whitespace-nowrap text-slate-400">{duration(e.transit_s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
