import { useState } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { AXIS, GRID, TrendBlock } from "../components/charts";
import { SimBadge } from "../components/Layout";
import { Button, Card, Empty, ProgressBar, StatusDot, StatusPill, cx } from "../components/ui";
import { api, dayLabel, duration, fmt, missionTOf, missionTime, usePoll, type Level, type LinkStatus, type Metric } from "../lib/api";
import { useApp } from "../lib/context";

interface GroundState {
  crew_id: string; mission_t: number; today: number; overall: Level;
  alerts: { id: string; title: string; level: Level; reason: string; kind: string; recs: string[] }[];
  protocols: { protocol_id: number; label: string; score: number | null; start_day: number; days_since_start: number; days_to_target_left: number | null; adherence: number | null; started_by: string;
    targets: { metric: string; label: string; start: number; target: number; current: number; progress: number }[] }[];
  tasks: { task_id: string; title: string; status: string }[];
  live: Record<string, number>; workout_active: boolean;
}
interface Overview {
  crew: { id: string; name: string; role: string; state: GroundState | null; data_mission_t?: number; data_age_s?: number; received_age_s?: number; seq?: number; ground_last_day: number | null }[];
  link: LinkStatus; onboard_clock: any;
}
interface Packet { seq: number; crew_id: string | null; kind: string; status: string; age_s: number; arrives_in_s: number | null }

const CREW_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#f472b6"];
const TREND_CHOICES = ["u_volume", "caox_ss", "u_calcium", "u_citrate", "u_ph", "hr_rest", "sleep_h", "core_temp", "ex_week_min", "ared_week_min", "water_l", "kcal", "co2_mmhg", "rad_cum", "spo2", "feeling"];

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
  const say = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 3000); };
  const post = async (path: string, body: any, note: string) => { await api(path, { body }); refreshClock(); say(note); };
  const speeds = clock?.day_seconds_options ?? [0, 120, 60, 20, 5];

  return (
    <Card title="Demo panel" className="border-accent/40" right={msg && <span className="text-sm font-semibold text-ok">{msg}</span>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-sm text-slate-400">Mission profile (ground link)</div>
            <div className="flex flex-wrap gap-2">
              {meta && Object.entries(meta.profiles).map(([id, p]) => (
                <button key={id} onClick={() => post("/api/demo/profile", { profile: id, delay_s: id === "mars" ? marsDelay : undefined }, `Profile: ${p.label}`)}
                  className={cx("min-h-[48px] rounded-xl px-4 font-semibold", link.profile === id ? "bg-accent text-ink-950" : "bg-ink-800")}>{p.label}</button>
              ))}
            </div>
            <label className="mt-2 block text-sm text-slate-400">
              Mars one-way delay: <span className="font-semibold text-slate-100">{duration(marsDelay)}</span>
              <input type="range" min={meta?.profiles.mars?.delay_min_s ?? 20} max={meta?.profiles.mars?.delay_max_s ?? 1320} step={10} value={marsDelay}
                onChange={(e) => setMarsDelay(Number(e.target.value))}
                onMouseUp={() => link.profile === "mars" && post("/api/demo/profile", { profile: "mars", delay_s: marsDelay }, `Mars delay ${duration(marsDelay)}`)}
                onTouchEnd={() => link.profile === "mars" && post("/api/demo/profile", { profile: "mars", delay_s: marsDelay }, `Mars delay ${duration(marsDelay)}`)}
                className="mt-1 w-full accent-sky-400" />
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={link.forced_blackout} onChange={(e) => post("/api/demo/blackout", { on: e.target.checked }, e.target.checked ? "Blackout forced" : "Blackout cleared")} />
              Force link blackout (loss of signal)
            </label>
          </div>
          <div>
            <div className="mb-1 text-sm text-slate-400">Mission clock · {missionTime(clock)} · {clock?.day_seconds ? `1 day = ${clock.day_seconds} s` : "paused"}</div>
            <div className="flex flex-wrap gap-2">
              {speeds.map((s) => (
                <button key={s} onClick={() => post("/api/demo/speed", { day_seconds: s }, s ? `1 day = ${s} s` : "Paused")}
                  className={cx("min-h-[48px] rounded-xl px-4 font-semibold", clock?.day_seconds === s ? "bg-accent text-ink-950" : "bg-ink-800")}>
                  {s === 0 ? "Pause" : `1 day / ${s} s`}
                </button>
              ))}
              <button className="min-h-[48px] rounded-xl bg-ink-800 px-4 font-semibold" onClick={() => post("/api/demo/skip", { days: 1 }, "+1 day")}>+1 day</button>
              <button className="min-h-[48px] rounded-xl bg-ink-800 px-4 font-semibold" onClick={() => post("/api/demo/skip", { days: 7 }, "+7 days")}>+7 days</button>
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-sm text-slate-400">Inject event</div>
            <div className="flex flex-wrap gap-2">
              <select value={crew} onChange={(e) => setCrew(e.target.value)} className="min-h-[48px] rounded-xl border border-ink-600 bg-ink-850 px-3">
                {meta?.crew.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={ev} onChange={(e) => setEv(e.target.value)} className="min-h-[48px] rounded-xl border border-ink-600 bg-ink-850 px-3">
                {meta && Object.entries(meta.injectable_events).map(([id, e]) => <option key={id} value={id}>{e.label} ({e.days} d)</option>)}
              </select>
              <Button onClick={() => post("/api/demo/inject", { crew_id: crew, kind: ev }, "Event injected")}>Inject</Button>
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm text-slate-400">Autopilot (simulated crew completes tasks you don't confirm)</div>
            <AutopilotToggles />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="seed (default 42)" className="min-h-[48px] w-44 rounded-xl border border-ink-600 bg-ink-850 px-3" />
            <Button kind="danger" onClick={() => post("/api/demo/reset", { seed }, "Simulation reset")}>Reset simulation</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function AutopilotToggles() {
  const { meta } = useApp();
  const [state, setState] = useState<Record<string, boolean>>({});
  return (
    <div className="flex flex-wrap gap-2">
      {meta?.crew.map((c) => {
        const on = state[c.id] ?? true;
        return (
          <button key={c.id} onClick={async () => { await api("/api/demo/autopilot", { body: { crew_id: c.id, on: !on } }); setState((s) => ({ ...s, [c.id]: !on })); }}
            className={cx("min-h-[44px] rounded-xl px-3 text-sm font-semibold", on ? "bg-ok/20 text-ok" : "bg-ink-800 text-slate-400")}>
            {c.name.split(" ")[0]}: {on ? "on" : "off"}
          </button>
        );
      })}
    </div>
  );
}

function LinkPanel({ link }: { link: LinkStatus }) {
  const { data } = usePoll<{ status: LinkStatus; packets: Packet[] }>("/api/link", 1000);
  const age = link.ground_data_age_s;
  return (
    <Card title="Ground link" right={<span className={cx("rounded-full px-3 py-1 text-sm font-bold", link.blackout ? "bg-bad/20 text-bad" : "bg-ok/15 text-ok")}>{link.blackout ? "LOSS OF SIGNAL" : "LINK UP"}</span>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-ink-850 p-3"><div className="text-sm text-slate-400">Profile</div><div className="text-lg font-bold">{link.profile_label}</div></div>
        <div className="rounded-xl bg-ink-850 p-3"><div className="text-sm text-slate-400">One-way delay</div><div className="text-2xl font-bold">{duration(link.delay_s)}</div></div>
        <div className="rounded-xl bg-ink-850 p-3"><div className="text-sm text-slate-400">Newest data on ground is</div><div className={cx("text-2xl font-bold", (age ?? 0) > 60 ? "text-warn" : "")}>{duration(age)} old</div></div>
        <div className="rounded-xl bg-ink-850 p-3"><div className="text-sm text-slate-400">{link.blackout ? "Signal back in" : "Next blackout in"}</div><div className="text-2xl font-bold">{link.window_change_in_s === null ? "forced" : duration(link.window_change_in_s)}</div></div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
        <div><div className="text-3xl font-bold tabular-nums">{link.queued}</div><div className="text-sm text-slate-400">queued onboard</div></div>
        <div><div className="text-3xl font-bold tabular-nums text-warn">{link.in_flight}</div><div className="text-sm text-slate-400">in flight</div></div>
        <div><div className="text-3xl font-bold tabular-nums text-ok">{link.delivered}</div><div className="text-sm text-slate-400">delivered</div></div>
        <div><div className="text-3xl font-bold tabular-nums">{link.next_arrival_in_s === null ? "–" : duration(link.next_arrival_in_s)}</div><div className="text-sm text-slate-400">next packet arrives</div></div>
      </div>
      {data && (
        <div className="mt-3 max-h-56 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-ink-900 text-slate-400"><tr><th className="py-1">#</th><th>Kind</th><th>Crew</th><th>Status</th><th>Created</th><th>Arrives in</th></tr></thead>
            <tbody>
              {data.packets.map((p) => (
                <tr key={p.seq} className="border-t border-ink-800">
                  <td className="py-1 font-mono">{p.seq}</td><td>{p.kind}</td><td>{p.crew_id ?? "–"}</td>
                  <td className={cx(p.status === "in_flight" ? "text-warn" : p.status === "queued" ? "text-slate-300" : "text-ok")}>{p.status.replace("_", " ")}</td>
                  <td>{duration(p.age_s)} ago</td><td>{p.arrives_in_s === null ? "" : duration(p.arrives_in_s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">Store-and-forward: onboard updates become numbered packets. The crew app never waits for the ground. Delays run in real time; link profile values are unverified.</p>
    </Card>
  );
}

function Trends({ crewIds }: { crewIds: { id: string; name: string }[] }) {
  const [cid, setCid] = useState("c1");
  const [sel, setSel] = useState<string[]>(["caox_ss", "u_volume", "u_calcium", "hr_rest"]);
  const { meta } = useApp();
  const { data } = usePoll<{ metrics: Record<string, Metric>; ground_last_day: number }>(`/api/surgeon/crew/${cid}/series?metrics=${sel.join(",")}`, 5000);
  return (
    <Card title="Trends per metric (ground copy)" right={data && <span className="text-sm text-slate-400">ground has data up to {dayLabel(data.ground_last_day)}</span>}>
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
              <span>now {fmt(data.metrics[m].ewma, data.metrics[m].decimals)} {data.metrics[m].unit}</span>
              {data.metrics[m].z !== null && data.metrics[m].z !== undefined && <span className="text-slate-400">z {fmt(data.metrics[m].z, 1)}</span>}
              <span className="text-slate-400">slope {fmt(data.metrics[m].slope, 2)}/day</span>
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
  const [pair, setPair] = useState<[string, string]>(["water_l", "u_volume"]);
  const { data } = usePoll<{ metrics: string[]; labels: Record<string, string>; matrix: (number | null)[][]; n_days: number; scatter: { crew_id: string; day: number; x: number; y: number }[] | null }>(
    `/api/surgeon/correlations?crew=${crew}&x=${pair[0]}&y=${pair[1]}`, 15000);
  if (!data) return <Card title="Correlations"><Empty /></Card>;
  const byCrew = crewIds.map((c, i) => ({ ...c, color: CREW_COLORS[i], pts: (data.scatter ?? []).filter((p) => p.crew_id === c.id) }));
  return (
    <Card title="Correlations (in-flight days, ground data)" right={<span className="text-sm text-slate-400">{data.n_days} crew-days · tap a cell</span>}>
      <div className="mb-2 flex flex-wrap gap-2">
        {[{ id: "all", name: "All crew" }, ...crewIds].map((c) => <button key={c.id} onClick={() => setCrew(c.id)} className={cx("min-h-[40px] rounded-lg px-3 text-sm font-semibold", crew === c.id ? "bg-accent text-ink-950" : "bg-ink-800")}>{c.name}</button>)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-0.5 text-xs">
            <thead><tr><th />{data.metrics.map((m) => <th key={m} className="h-28 w-9 align-bottom"><div className="w-9 origin-bottom-left translate-x-4 -rotate-60 whitespace-nowrap text-left font-normal text-slate-400" style={{ transform: "rotate(-60deg)" }}>{data.labels[m]}</div></th>)}</tr></thead>
            <tbody>
              {data.metrics.map((a, i) => (
                <tr key={a}>
                  <td className="whitespace-nowrap pr-2 text-right text-slate-400">{data.labels[a]}</td>
                  {data.matrix[i].map((r, j) => (
                    <td key={j}>
                      <button onClick={() => setPair([a, data.metrics[j]])} title={`${data.labels[a]} vs ${data.labels[data.metrics[j]]}: r = ${r ?? "n/a"}`}
                        className={cx("h-9 w-9 rounded text-[11px] font-semibold tabular-nums", pair[0] === a && pair[1] === data.metrics[j] && "ring-2 ring-white")}
                        style={{ background: corrColor(r) }}>{r === null ? "" : i === j ? "" : r.toFixed(1)}</button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-500">Pearson r. Blue = rise together · red = one rises as the other falls. Correlation is not causation.</p>
        </div>
        <div className="h-80 rounded-xl bg-ink-850 p-2">
          <div className="px-2 text-sm font-semibold">{data.labels[pair[0]] ?? pair[0]} vs {data.labels[pair[1]] ?? pair[1]}</div>
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
              <CartesianGrid stroke={GRID} />
              <XAxis dataKey="x" type="number" tick={AXIS} domain={["auto", "auto"]} name={pair[0]} />
              <YAxis dataKey="y" type="number" tick={AXIS} domain={["auto", "auto"]} width={44} name={pair[1]} />
              <ZAxis range={[24, 24]} />
              <Tooltip contentStyle={{ background: "#0a0f1a", border: "1px solid #2c3a55" }} />
              {byCrew.map((c) => <Scatter key={c.id} name={c.name} data={c.pts} fill={c.color} isAnimationActive={false} />)}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}

export default function Surgeon() {
  const { meta } = useApp();
  const { data } = usePoll<Overview>("/api/surgeon/overview", 1500);
  const { data: evts } = usePoll<{ events: { seq: number; crew_name: string; kind: string; level: string; text: string; mission_t: number; age_s: number; transit_s: number }[] }>("/api/surgeon/events", 3000);
  if (!data || !meta) return <div className="p-6"><Empty /></div>;
  const crewIds = meta.crew.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-ink-700 bg-ink-950/95 px-4 py-3 backdrop-blur">
        <span className="text-lg font-bold"><span className="text-accent">◎</span> Flight Surgeon · Ground</span>
        <SimBadge />
        <span className="text-sm text-slate-400">Onboard clock {missionTime(data.onboard_clock)} — everything below arrived through the ground link</span>
        <Link to="/" className="ml-auto flex min-h-[48px] items-center rounded-xl border border-ink-600 px-4 font-semibold hover:bg-ink-800">Crew app ›</Link>
      </header>
      <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
        <DemoPanel link={data.link} />
        <LinkPanel link={data.link} />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {data.crew.map((c) => {
            const s = c.state;
            const stale = (c.data_age_s ?? 0) > 60;
            return (
              <div key={c.id} className={cx("rounded-2xl border bg-ink-900 p-4", s?.overall === "red" ? "border-bad/60" : s?.overall === "amber" ? "border-warn/50" : "border-ink-700")}>
                <div className="flex items-start justify-between">
                  <div><div className="text-lg font-bold">{c.name}</div><div className="text-sm text-slate-400">{c.role}</div></div>
                  {s && <StatusPill level={s.overall} />}
                </div>
                {!s ? <div className="mt-3 text-slate-400">No data received yet.</div> : (
                  <>
                    <div className={cx("mt-2 rounded-lg px-2 py-1 text-sm", stale ? "bg-warn/15 text-warn" : "bg-ink-850 text-slate-300")}>
                      Data from {missionTOf(c.data_mission_t)} · {duration(c.data_age_s)} old
                    </div>
                    <ul className="mt-2 space-y-1 text-sm">
                      {s.alerts.slice(0, 4).map((a) => <li key={a.id} className="flex gap-2"><StatusDot level={a.level} size={10} /><span>{a.title}</span></li>)}
                      {s.alerts.length > 4 && <li className="text-slate-500">+{s.alerts.length - 4} more</li>}
                      {s.alerts.length === 0 && <li className="text-ok">No alerts</li>}
                    </ul>
                    <div className="mt-2 text-sm text-slate-400">
                      Tasks: {s.tasks.filter((t) => t.status === "done").length}/{s.tasks.length} done · HR {fmt(s.live.hr, 0)} · {s.workout_active ? "exercising now" : "not exercising"}
                    </div>
                    {s.protocols.map((p) => (
                      <div key={p.protocol_id} className="mt-2">
                        <div className="flex justify-between text-sm"><span>{p.label}</span><span>{p.score === null ? "–" : `${Math.round(p.score * 100)}%`}</span></div>
                        <ProgressBar value={p.score ?? 0} color={(p.score ?? 0) > 0.6 ? "#22c55e" : (p.score ?? 0) > 0.3 ? "#fbbf24" : "#f43f5e"} height={8} />
                      </div>
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </div>

        <Card title="Protocols and response score">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="text-sm text-slate-400"><tr><th className="py-2">Crew</th><th>Protocol</th><th>Since</th><th>Started by</th><th>Adherence</th><th>Response</th><th>Markers</th><th>Days to target</th></tr></thead>
              <tbody>
                {data.crew.flatMap((c) => (c.state?.protocols ?? []).map((p) => (
                  <tr key={`${c.id}-${p.protocol_id}`} className="border-t border-ink-800 align-top">
                    <td className="py-2">{c.name}</td><td>{p.label}</td><td>{dayLabel(p.start_day)}</td><td>{p.started_by}</td>
                    <td>{p.adherence === null ? "–" : `${Math.round(p.adherence * 100)}%`}</td>
                    <td className="font-bold" style={{ color: (p.score ?? 0) > 0.6 ? "#22c55e" : (p.score ?? 0) > 0.3 ? "#fbbf24" : "#f43f5e" }}>{p.score === null ? "–" : `${Math.round(p.score * 100)}%`}</td>
                    <td className="text-sm">{p.targets.map((t) => `${t.label}: ${fmt(t.start, 2)}→${fmt(t.current, 2)} (target ${fmt(t.target, 2)})`).join(" · ")}</td>
                    <td>{p.days_to_target_left === null ? (p.days_since_start >= 4 ? "not on track" : "–") : `~${Math.ceil(p.days_to_target_left)}`}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </Card>

        <Trends crewIds={crewIds} />
        <Correlations crewIds={crewIds} />

        <Card title="Event log (as received on the ground)">
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-ink-900 text-slate-400"><tr><th className="py-1">#</th><th>Mission time</th><th>Crew</th><th>Event</th><th>Transit</th></tr></thead>
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
        <p className="pb-6 text-sm text-slate-500">{meta.disclaimer}</p>
      </main>
    </div>
  );
}
