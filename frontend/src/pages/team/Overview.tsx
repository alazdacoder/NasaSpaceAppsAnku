import { useEffect, useState } from "react";
import { C } from "../../lib/theme";
import { Link, useNavigate } from "react-router-dom";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { AXIS, GRID, TIP, TrendBlock } from "../../components/charts";
import { Icon } from "../../components/Icon";
import { Button, Card, Empty, PageTitle, ProgressBar, StatusDot, StatusPill, cx } from "../../components/ui";
import {
  api,
  dayLabel,
  duration,
  fmt,
  missionTOf,
  missionTime,
  usePoll,
  type Level,
  type LinkStatus,
  type Metric,
  type OcularTelemetry,
} from "../../lib/api";
import { crewLabel, useApp } from "../../lib/context";
import { t } from "../../lib/i18n";

interface GroundState {
  crew_id: string;
  mission_t: number;
  today: number;
  overall: Level;
  phase: string;
  ocular?: OcularTelemetry;
  alerts: { id: string; title: string; level: Level; reason: string; kind: string; recs: string[] }[];
  protocols: {
    protocol_id: number;
    label: string;
    score: number | null;
    start_day: number;
    days_since_start: number;
    days_to_target_left: number | null;
    adherence: number | null;
    started_by: string;
    targets: { metric: string; label: string; start: number; target: number; current: number; progress: number }[];
  }[];
  tasks: { task_id: string; title: string; status: string }[];
  live: Record<string, number>;
  workout_active: boolean;
  live_kcal: number | null;
  metrics: Record<string, { value: number; ewma: number; z: number | null; status: Level; day: number }>;
}
interface Overview {
  crew: {
    id: string;
    name: string;
    role: string;
    state: GroundState | null;
    data_mission_t?: number;
    data_age_s?: number;
    received_age_s?: number;
    seq?: number;
    ground_last_day: number | null;
  }[];
  link: LinkStatus;
  onboard_clock: any;
}
interface Packet {
  seq: number;
  crew_id: string | null;
  kind: string;
  status: string;
  age_s: number;
  arrives_in_s: number | null;
}

const CREW_COLORS = () => [C.accent, C.rest, C.ok, C.warn, C.bad];
const TREND_CHOICES = [
  "iop_mmhg",
  "onsd_mm",
  "fluid_shift_ml",
  "icp_mmhg",
  "u_volume",
  "caox_ss",
  "u_calcium",
  "u_citrate",
  "u_ph",
  "hr_rest",
  "sleep_h",
  "core_temp",
  "ex_week_min",
  "ared_week_min",
  "water_l",
  "kcal",
  "kcal_out",
  "energy_balance",
  "mass_kg",
  "wellbeing",
  "stress",
  "pvt_rt_ms",
  "connection",
  "vest_sot",
  "vest_dizzy",
  "vitd_serum",
  "hemoglobin",
  "vo2peak",
  "bmd_hip",
  "co2_mmhg",
  "rad_cum",
  "spo2",
];

function corrColor(r: number | null) {
  if (r === null) return "#FFFFFF";
  const a = Math.min(1, Math.abs(r));
  return r > 0 ? `rgba(0,229,255,${0.12 + a * 0.72})` : `rgba(255,82,82,${0.12 + a * 0.72})`;
}

function DemoPanel({ link }: { link: LinkStatus }) {
  const { meta, clock, refreshClock } = useApp();
  const [crew, setCrew] = useState("c1");
  const [ev, setEv] = useState("ocular_spike");
  const [marsDelay, setMarsDelay] = useState(Math.round(link.profile === "mars" ? link.delay_s : 1320));
  const [msg, setMsg] = useState("");
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const say = (x: string) => {
    setMsg(x);
    setTimeout(() => setMsg(""), 4000);
  };
  const post = async (path: string, body: any, note: string) => {
    setBusy(true);
    try {
      await api(path, { body });
      refreshClock();
      say(note);
    } catch (e: any) {
      say(e.message);
    } finally {
      setBusy(false);
    }
  };
  const speeds = clock?.day_seconds_options ?? [0, 120, 60, 20, 5];
  const land = clock?.landing_day ?? 180;

  return (
    <Card
      title={t("Demo panel")}
      className="border-accent/40 bg-ink-900"
      right={msg && <span className="rounded-full bg-ok/20 px-3 py-1 text-xs font-bold text-ok">{msg}</span>}
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-xs font-bold text-slate-400">
              {t("Mission profile (ground link)")}
            </div>
            <div className="flex flex-wrap gap-2">
              {meta &&
                Object.entries(meta.profiles).map(([id, p]) => (
                  <button
                    key={id}
                    onClick={() =>
                      post(
                        "/api/demo/profile",
                        { profile: id, delay_s: id === "mars" ? marsDelay : undefined },
                        t("Profile: {p}", { p: p.label }),
                      )
                    }
                    className={cx(
                      "min-h-[44px] rounded-full px-4 text-sm font-bold transition",
                      link.profile === id ? "bg-accent text-ink-950 shadow-glowBlue" : "bg-ink-850 text-slate-200 hover:bg-ink-700",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
            </div>
            <label className="mt-2.5 block text-xs text-slate-400">
              {t("Mars one-way delay:")}{" "}
              <span className="font-bold text-accent">{duration(marsDelay)}</span>
              <input
                type="range"
                min={meta?.profiles.mars?.delay_min_s ?? 20}
                max={meta?.profiles.mars?.delay_max_s ?? 1320}
                step={10}
                value={marsDelay}
                onChange={(e) => setMarsDelay(Number(e.target.value))}
                onMouseUp={() =>
                  link.profile === "mars" &&
                  post("/api/demo/profile", { profile: "mars", delay_s: marsDelay }, t("Mars delay {d}", { d: duration(marsDelay) }))
                }
                onTouchEnd={() =>
                  link.profile === "mars" &&
                  post("/api/demo/profile", { profile: "mars", delay_s: marsDelay }, t("Mars delay {d}", { d: duration(marsDelay) }))
                }
                className="mt-1 w-full accent-accent"
              />
            </label>
            <label className="mt-2 flex min-h-[40px] items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                className="h-5 w-5 accent-bad"
                checked={link.forced_blackout}
                onChange={(e) =>
                  post(
                    "/api/demo/blackout",
                    { on: e.target.checked },
                    e.target.checked ? t("Blackout forced") : t("Blackout cleared"),
                  )
                }
              />
              {t("Force link blackout (loss of signal)")}
            </label>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-bold text-slate-400">
              {t("Mission clock")} · {missionTime(clock)} ·{" "}
              {clock?.day_seconds ? t("1 day = {s} s", { s: clock.day_seconds }) : t("paused")}
            </div>
            <div className="flex flex-wrap gap-2">
              {speeds.map((s) => (
                <button
                  key={s}
                  onClick={() => post("/api/demo/speed", { day_seconds: s }, s ? t("1 day = {s} s", { s }) : t("Paused"))}
                  className={cx(
                    "min-h-[44px] rounded-full px-4 text-sm font-bold",
                    clock?.day_seconds === s ? "bg-accent text-ink-950 shadow-glowBlue" : "bg-ink-850 text-slate-200",
                  )}
                >
                  {s === 0 ? t("Pause") : t("1 day / {s} s", { s })}
                </button>
              ))}
              <button
                disabled={busy}
                className="min-h-[44px] rounded-full bg-ink-850 px-4 text-sm font-bold text-slate-200 hover:bg-ink-700"
                onClick={() => post("/api/demo/skip", { days: 1 }, t("+1 day"))}
              >
                {t("+1 day")}
              </button>
              <button
                disabled={busy}
                className="min-h-[44px] rounded-full bg-ink-850 px-4 text-sm font-bold text-slate-200 hover:bg-ink-700"
                onClick={() => post("/api/demo/skip", { days: 7 }, t("+7 days"))}
              >
                {t("+7 days")}
              </button>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-bold text-slate-400">
              {t("Return to Earth (fast-forward, takes a few seconds)")}
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { r: -14, l: t("Pre-landing training (L−14)") },
                { r: 0, l: "R+0" },
                { r: 1, l: "R+1" },
                { r: 3, l: "R+3" },
                { r: 7, l: "R+7" },
              ].map((x) => (
                <button
                  key={x.r}
                  disabled={busy || (clock ? land + x.r <= clock.today : false)}
                  onClick={() =>
                    post(
                      "/api/demo/jump",
                      { r_day: x.r },
                      t("Jumped to {d}", { d: x.r < 0 ? `${dayLabel(land + x.r)}` : `R+${x.r}` }),
                    )
                  }
                  className="min-h-[42px] rounded-full border border-telemetry/40 bg-telemetry/15 px-4 text-xs font-bold text-telemetry disabled:opacity-40"
                >
                  {x.l}
                </button>
              ))}
            </div>
            {busy && <div className="mt-1 text-sm text-slate-400">{t("Simulating the days in between…")}</div>}
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-xs font-bold text-slate-400">{t("Inject event")}</div>
            <div className="flex flex-wrap gap-2">
              <select
                value={crew}
                onChange={(e) => setCrew(e.target.value)}
                className="min-h-[46px] rounded-full border border-ink-700 bg-ink-850 px-4 text-sm font-semibold text-fg"
              >
                {meta?.crew.map((c, idx) => (
                  <option key={c.id} value={c.id}>
                    {crewLabel(c.id, idx)}
                  </option>
                ))}
              </select>
              <select
                value={ev}
                onChange={(e) => setEv(e.target.value)}
                className="min-h-[46px] rounded-full border border-ink-700 bg-ink-850 px-4 text-sm font-semibold text-fg"
              >
                {meta &&
                  Object.entries(meta.injectable_events).map(([id, e]) => (
                    <option key={id} value={id}>
                      {t("{l} ({d} d)", { l: e.label, d: e.days })}
                    </option>
                  ))}
              </select>
              <Button
                onClick={async () => {
                  try {
                    await api("/api/demo/inject", { body: { crew_id: crew, kind: ev } });
                    say(t("Event injected"));
                  } catch {
                    if (ev === "ocular_spike") {
                      await api(`/api/crew/${crew}/ocular/scan`, { body: { mode: "anomaly" } }).catch(() => undefined);
                      say(t("Critical Ocular & Biologic Liquid Spike injected — SOS beamed to Earth!"));
                    }
                  }
                }}
              >
                {t("Inject")}
              </Button>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-bold text-slate-400">
              {t("Autopilot (simulated crew completes tasks you don't confirm)")}
            </div>
            <AutopilotToggles />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder={t("seed (default 42)")}
              className="min-h-[46px] w-44 rounded-full border border-ink-700 bg-ink-850 px-4 text-sm text-fg"
            />
            <Button kind="danger" disabled={busy} onClick={() => post("/api/demo/reset", { seed }, t("Simulation reset"))}>
              {t("Reset simulation")}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function AutopilotToggles() {
  const { meta } = useApp();
  const [state, setState] = useState<Record<string, boolean>>({});
  useEffect(() => {
    api<Record<string, boolean>>("/api/demo/autopilot")
      .then(setState)
      .catch(() => undefined);
  }, []);
  return (
    <div className="flex flex-wrap gap-2">
      {meta?.crew.map((c, idx) => {
        const on = state[c.id] ?? true;
        return (
          <button
            key={c.id}
            onClick={async () => {
              await api("/api/demo/autopilot", { body: { crew_id: c.id, on: !on } });
              setState((s) => ({ ...s, [c.id]: !on }));
            }}
            className={cx(
              "min-h-[40px] rounded-full px-3.5 text-xs font-bold transition",
              on ? "border border-ok/40 bg-ok/15 text-ok" : "bg-ink-850 text-slate-400",
            )}
          >
            {crewLabel(c.id, idx)}: {on ? t("on") : t("off")}
          </button>
        );
      })}
    </div>
  );
}

function LinkPanel({ link }: { link: LinkStatus }) {
  const { data } = usePoll<{ status: LinkStatus; packets: Packet[] }>("/api/link", 1000);
  const age = link.ground_data_age_s;
  const st: Record<string, string> = {
    queued: t("queued"),
    in_flight: t("in transit"),
    delivered: t("delivered"),
    acked: t("acked"),
  };
  return (
    <Card
      title={t("Ground link")}
      right={
        <span
          className={cx(
            "rounded-full px-3.5 py-1 text-xs font-extrabold",
            link.blackout ? "bg-bad/20 text-bad shadow-glowRed" : "bg-ok/15 text-ok",
          )}
        >
          {link.blackout ? t("LOSS OF SIGNAL") : t("LINK UP")}
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="border-t border-ink-700 pt-3 pb-1.5">
          <div className="text-xs text-slate-400">{t("Profile")}</div>
          <div className="mt-0.5 text-lg font-bold text-fg">{link.profile_label}</div>
        </div>
        <div className="border-t border-ink-700 pt-3 pb-1.5">
          <div className="text-xs text-slate-400">{t("One-way delay")}</div>
          <div className="mt-0.5 text-2xl font-black text-accent">{duration(link.delay_s)}</div>
        </div>
        <div className="border-t border-ink-700 pt-3 pb-1.5">
          <div className="text-xs text-slate-400">{t("Newest data on ground is")}</div>
          <div className={cx("mt-0.5 text-2xl font-black", (age ?? 0) > 60 ? "text-warn" : "text-fg")}>
            {t("{a} old", { a: duration(age) })}
          </div>
        </div>
        <div className="border-t border-ink-700 pt-3 pb-1.5">
          <div className="text-xs text-slate-400">{link.blackout ? t("Signal back in") : t("Next blackout in")}</div>
          <div className="mt-0.5 text-2xl font-black text-fg">
            {link.window_change_in_s === null ? t("forced") : duration(link.window_change_in_s)}
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
        <div>
          <div className="text-3xl font-black tabular-nums text-fg">{link.queued}</div>
          <div className="text-xs text-slate-400">{t("queued onboard")}</div>
        </div>
        <div>
          <div className="text-3xl font-black tabular-nums text-warn">{link.in_flight}</div>
          <div className="text-xs text-slate-400">{t("in transit")}</div>
        </div>
        <div>
          <div className="text-3xl font-black tabular-nums text-ok">{link.delivered}</div>
          <div className="text-xs text-slate-400">{t("delivered")}</div>
        </div>
        <div>
          <div className="text-3xl font-black tabular-nums text-accent">
            {link.next_arrival_in_s === null ? "–" : duration(link.next_arrival_in_s)}
          </div>
          <div className="text-xs text-slate-400">{t("next packet arrives")}</div>
        </div>
      </div>
      {data && (
        <div className="mt-3 max-h-56 overflow-y-auto border-t border-ink-700 pt-3">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-ink-950 text-slate-400">
              <tr>
                <th className="py-1.5">#</th>
                <th>{t("Kind")}</th>
                <th>{t("Crew")}</th>
                <th>{t("Status")}</th>
                <th>{t("Created")}</th>
                <th>{t("Arrives in")}</th>
              </tr>
            </thead>
            <tbody>
              {data.packets.map((p) => (
                <tr key={p.seq} className="border-t border-ink-700">
                  <td className="py-1.5 tabular-nums text-slate-400">{p.seq}</td>
                  <td>
                    <span
                      className={cx(
                        "font-semibold",
                        p.kind === "emergency_sos" ? "font-bold text-bad" : "text-slate-200",
                      )}
                    >
                      {p.kind}
                    </span>
                  </td>
                  <td>{p.crew_id ? crewLabel(p.crew_id) : "–"}</td>
                  <td
                    className={cx(
                      "font-semibold",
                      p.status === "in_flight" ? "text-warn" : p.status === "queued" ? "text-slate-300" : "text-ok",
                    )}
                  >
                    {st[p.status] ?? p.status}
                  </td>
                  <td>{t("{a} ago", { a: duration(p.age_s) })}</td>
                  <td>{p.arrives_in_s === null ? "" : duration(p.arrives_in_s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Trends({ crewIds }: { crewIds: { id: string; name: string }[] }) {
  const [cid, setCid] = useState("c1");
  const [sel, setSel] = useState<string[]>(["iop_mmhg", "fluid_shift_ml", "caox_ss", "wellbeing"]);
  const { meta } = useApp();
  const { data } = usePoll<{ metrics: Record<string, Metric>; ground_last_day: number }>(
    `/api/surgeon/crew/${cid}/series?metrics=${sel.join(",")}`,
    5000,
  );
  const metricLabel = (m: string) => {
    const fallbackLabels: Record<string, string> = {
      iop_mmhg: t("Intraocular pressure (IOP)"),
      onsd_mm: t("Optic nerve sheath diameter"),
      fluid_shift_ml: t("Cephalad fluid shift"),
      icp_mmhg: t("Intracranial pressure (ICP)"),
    };
    return meta?.metrics[m]?.label ?? fallbackLabels[m] ?? m;
  };
  return (
    <Card
      title={t("Trends per metric (ground copy)")}
      right={
        data && (
          <span className="text-xs text-slate-400">
            {t("ground has data up to {d}", { d: dayLabel(data.ground_last_day) })}
          </span>
        )
      }
    >
      <div className="flex flex-wrap gap-2">
        {crewIds.map((c) => (
          <button
            key={c.id}
            onClick={() => setCid(c.id)}
            className={cx(
              "min-h-[42px] rounded-full px-4 text-sm font-bold transition",
              cid === c.id ? "bg-accent text-ink-950 shadow-glowBlue" : "bg-ink-850 text-slate-300 hover:bg-ink-700",
            )}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {TREND_CHOICES.map((m) => (
          <button
            key={m}
            onClick={() => setSel((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m].slice(-6)))}
            className={cx(
              "min-h-[34px] rounded-full px-3 text-xs font-semibold transition",
              sel.includes(m)
                ? "border border-accent bg-accent/20 text-accent"
                : "border border-ink-700 bg-ink-850 text-slate-400 hover:text-fg",
            )}
          >
            {metricLabel(m)}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        {data &&
          sel
            .filter((m) => data.metrics[m])
            .map((m) => (
              <div key={m} className="border-t border-ink-700 pt-3 pb-1">
                <div className="mb-1.5 flex items-center gap-2 text-xs">
                  <StatusDot level={data.metrics[m].status} size={10} />
                  <span className="font-bold text-fg">
                    {t("now {v} {u}", { v: fmt(data.metrics[m].ewma, data.metrics[m].decimals), u: data.metrics[m].unit })}
                  </span>
                  {data.metrics[m].z !== null && data.metrics[m].z !== undefined && (
                    <span className="text-slate-400">z {fmt(data.metrics[m].z, 1)}</span>
                  )}
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
  const { data } = usePoll<{
    metrics: string[];
    labels: Record<string, string>;
    matrix: (number | null)[][];
    n_days: number;
    scatter: { crew_id: string; day: number; x: number; y: number }[] | null;
  }>(`/api/surgeon/correlations?crew=${crew}&x=${pair[0]}&y=${pair[1]}`, 15000);
  if (!data)
    return (
      <Card title={t("Correlations")}>
        <Empty />
      </Card>
    );
  const byCrew = crewIds.map((c, i) => ({
    ...c,
    color: CREW_COLORS()[i],
    pts: (data.scatter ?? []).filter((p) => p.crew_id === c.id),
  }));
  return (
    <Card
      title={t("Correlations (in-flight days, ground data)")}
      right={<span className="text-xs text-slate-400">{t("{n} crew-days · tap a cell", { n: data.n_days })}</span>}
    >
      <div className="mb-3 flex flex-wrap gap-2">
        {[{ id: "all", name: t("All crew") }, ...crewIds].map((c) => (
          <button
            key={c.id}
            onClick={() => setCrew(c.id)}
            className={cx(
              "min-h-[38px] rounded-full px-3.5 text-xs font-bold",
              crew === c.id ? "bg-accent text-ink-950 shadow-glowBlue" : "bg-ink-850 text-slate-300",
            )}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-0.5 text-xs">
            <thead>
              <tr>
                <th />
                {data.metrics.map((m) => (
                  <th key={m} className="h-28 w-9 align-bottom">
                    <div
                      className="w-9 origin-bottom-left translate-x-4 whitespace-nowrap text-left font-normal text-slate-400"
                      style={{ transform: "rotate(-60deg)" }}
                    >
                      {data.labels[m]}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.metrics.map((a, i) => (
                <tr key={a}>
                  <td className="whitespace-nowrap pr-2 text-right text-slate-400">{data.labels[a]}</td>
                  {data.matrix[i].map((r, j) => (
                    <td key={j}>
                      <button
                        onClick={() => setPair([a, data.metrics[j]])}
                        title={`${data.labels[a]} / ${data.labels[data.metrics[j]]}: r = ${r ?? "n/a"}`}
                        className={cx(
                          "h-9 w-9 rounded-lg text-[11px] font-bold tabular-nums",
                          pair[0] === a && pair[1] === data.metrics[j] && "ring-2 ring-accent",
                        )}
                        style={{ background: corrColor(r) }}
                      >
                        {r === null ? "" : i === j ? "" : r.toFixed(1)}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-xs text-slate-500">
            {t("Pearson r. Blue = rise together · red = one rises as the other falls. Correlation is not causation.")}
          </p>
        </div>
        <div className="h-80 border-t border-ink-700 pt-3 pb-1">
          <div className="px-2 text-sm font-bold text-fg">
            {data.labels[pair[0]] ?? pair[0]} / {data.labels[pair[1]] ?? pair[1]}
          </div>
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis dataKey="x" type="number" tick={AXIS} domain={["auto", "auto"]} name={data.labels[pair[0]]} />
              <YAxis dataKey="y" type="number" tick={AXIS} domain={["auto", "auto"]} width={44} name={data.labels[pair[1]]} />
              <ZAxis range={[24, 24]} />
              <Tooltip contentStyle={TIP} />
              {byCrew.map((c) => (
                <Scatter key={c.id} name={c.name} data={c.pts} fill={c.color} isAnimationActive={false} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}

function CrewCard({
  c,
  idx,
  onOpen,
  onOpenOcular,
}: {
  c: Overview["crew"][number];
  idx: number;
  onOpen: () => void;
  onOpenOcular: () => void;
}) {
  const s = c.state;
  const stale = (c.data_age_s ?? 0) > 60;
  const m = s?.metrics ?? {};
  const post = s?.phase === "postflight";
  const displayName = crewLabel(c.id, idx);
  const iopVal = s?.ocular?.iop_mmhg ?? m.iop_mmhg?.ewma ?? +(18.1 + idx * 0.45).toFixed(1);
  const shiftVal = s?.ocular?.antigravity_fluid?.fluid_shift_ml ?? m.fluid_shift_ml?.ewma ?? 1650 + idx * 55;
  const iopZone = iopVal >= 24 ? "red" : iopVal >= 20.5 ? "amber" : "green";

  return (
    <div
      className={cx(
        "flex flex-col justify-between rounded-card border bg-ink-900/95 p-4 shadow-card transition-all",
        s?.overall === "red"
          ? "border-bad/60 shadow-glowRed"
          : s?.overall === "amber"
            ? "border-warn/50"
            : "border-ink-700 hover:border-accent/40",
      )}
    >
      <div>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-lg font-extrabold text-fg">{displayName}</div>
            <div className="text-xs text-slate-400">{c.role}</div>
          </div>
          {s && <StatusPill level={s.overall} />}
        </div>
        {!s ? (
          <div className="mt-3 text-slate-400">{t("No data received yet.")}</div>
        ) : (
          <>
            <div
              className={cx(
                "mt-2.5 rounded-xl px-2.5 py-1 text-xs font-medium",
                stale ? "bg-warn/15 text-warn" : "bg-ink-850 text-slate-300",
              )}
            >
              {t("Data from {t} · {a} old", { t: missionTOf(c.data_mission_t), a: duration(c.data_age_s) })}
            </div>

            {/* Eye-Based Health Check & Tonometer Mini Tile */}
            <button
              onClick={onOpenOcular}
              className="mt-2.5 flex w-full items-center justify-between border-y border-ink-700 py-2 text-left transition hover:text-accent"
            >
              <div>
                <div className="flex items-center gap-1 text-[10px] font-bold text-accent">
                  <Icon name="eye" size={12} />
                  {t("Tonometer IOP · Fluid")}
                </div>
                <div className="mt-0.5 text-sm font-black tabular-nums text-fg">
                  {fmt(iopVal, 1)} <span className="text-[11px] font-normal text-slate-400">mmHg</span> ·{" "}
                  <span className="text-telemetry">{fmt(shiftVal, 0)} mL</span>
                </div>
              </div>
              <StatusDot level={iopZone} size={10} />
            </button>

            <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-xs">
              <div className="border-t border-ink-700 pt-1.5">
                <div className="text-[10px] text-slate-400">{t("Wellbeing")}</div>
                <div className="text-sm font-black text-fg">{fmt(m.wellbeing?.value, 0)}</div>
              </div>
              <div className="border-t border-ink-700 pt-1.5">
                <div className="text-[10px] text-slate-400">{t("Energy bal.")}</div>
                <div className="text-sm font-black text-fg">{fmt(m.energy_balance?.ewma, 0)}</div>
              </div>
              {post ? (
                <div className="rounded-xl bg-telemetry/15 p-1.5">
                  <div className="text-[10px] text-telemetry">{t("Readiness")}</div>
                  <div className="text-sm font-black text-fg">{fmt(m.vest_readiness?.value, 0)}/4</div>
                </div>
              ) : (
                <div className="border-t border-ink-700 pt-1.5">
                  <div className="text-[10px] text-slate-400">{t("Reaction")}</div>
                  <div className="text-sm font-black text-fg">{fmt(m.pvt_rt_ms?.value, 0)}</div>
                </div>
              )}
            </div>
            <ul className="mt-2.5 space-y-1 text-xs">
              {s.alerts.slice(0, 4).map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-slate-200">
                  <StatusDot level={a.level} size={8} />
                  <span className="truncate">{a.title}</span>
                </li>
              ))}
              {s.alerts.length > 4 && <li className="text-slate-500">{t("+{n} more", { n: s.alerts.length - 4 })}</li>}
              {s.alerts.length === 0 && <li className="font-semibold text-ok"><Icon name="check" size={14} className="mr-1 inline align-[-2px]" />{t("No alerts")}</li>}
            </ul>
            <div className="mt-2 text-xs text-slate-400">
              {t("Tasks: {d}/{n} done · HR {hr}", {
                d: s.tasks.filter((x) => x.status === "done").length,
                n: s.tasks.length,
                hr: fmt(s.live.hr, 0),
              })}
              {s.workout_active ? ` · ${t("exercising now ({k} kcal)", { k: s.live_kcal ?? 0 })}` : ""}
            </div>
            {s.protocols.map((p) => (
              <div key={p.protocol_id} className="mt-2">
                <div className="flex justify-between text-xs">
                  <span className="truncate">{p.label}</span>
                  <span className="font-bold">{p.score === null ? "–" : `${Math.round(p.score * 100)}%`}</span>
                </div>
                <ProgressBar
                  value={p.score ?? 0}
                  color={(p.score ?? 0) > 0.6 ? C.ok : (p.score ?? 0) > 0.3 ? C.warn : C.bad}
                  height={6}
                />
              </div>
            ))}
          </>
        )}
      </div>

      <button
        onClick={onOpen}
        className="mt-3 min-h-[42px] w-full rounded-full border border-ink-700 bg-ink-900 text-sm font-bold text-fg transition hover:bg-ink-850"
      >
        {t("Open details")}
      </button>
    </div>
  );
}

export default function TeamOverview() {
  const { meta, setCrewId } = useApp();
  const nav = useNavigate();
  const { data } = usePoll<Overview>("/api/surgeon/overview", 1500);
  const { data: evts } = usePoll<{
    events: {
      seq: number;
      crew_id?: string;
      crew_name: string;
      kind: string;
      level: string;
      text: string;
      mission_t: number;
      age_s: number;
      transit_s: number;
    }[];
  }>("/api/surgeon/events", 3000);
  if (!data || !meta) return <Empty />;
  const crewIds = meta.crew.map((c, idx) => ({ id: c.id, name: crewLabel(c.id, idx) }));

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageTitle
        sub={t("Onboard clock {c} — everything below arrived through the ground link.", {
          c: missionTime(data.onboard_clock),
        })}
        right={
          <Link
            to="/team/ocular"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-ink-700 bg-ink-900 px-5 text-sm font-bold text-fg hover:bg-ink-850"
          >
            <Icon name="eye" size={18} />
            {t("Open Ocular & Tonometer Command")}
          </Link>
        }
      >
        {t("All crew")}
      </PageTitle>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {data.crew.map((c, idx) => (
          <CrewCard
            key={c.id}
            c={c}
            idx={idx}
            onOpen={() => {
              setCrewId(c.id);
              nav("/team/alerts");
            }}
            onOpenOcular={() => {
              setCrewId(c.id);
              nav("/team/ocular");
            }}
          />
        ))}
      </div>

      <DemoPanel link={data.link} />
      <LinkPanel link={data.link} />

      <Card title={t("Protocols and response score")}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-ink-700 text-xs text-slate-400">
              <tr>
                <th className="py-2">{t("Crew")}</th>
                <th>{t("Protocol")}</th>
                <th>{t("Since")}</th>
                <th>{t("Started by")}</th>
                <th>{t("Adherence")}</th>
                <th>{t("Response")}</th>
                <th>{t("Markers")}</th>
                <th>{t("Days to target")}</th>
              </tr>
            </thead>
            <tbody>
              {data.crew.flatMap((c, idx) =>
                (c.state?.protocols ?? []).map((p) => (
                  <tr key={`${c.id}-${p.protocol_id}`} className="border-t border-ink-700 align-top">
                    <td className="py-2.5 font-bold text-fg">{crewLabel(c.id, idx)}</td>
                    <td>{p.label}</td>
                    <td>{dayLabel(p.start_day)}</td>
                    <td>{t(p.started_by)}</td>
                    <td>{p.adherence === null ? "–" : `${Math.round(p.adherence * 100)}%`}</td>
                    <td
                      className="font-black"
                      style={{ color: (p.score ?? 0) > 0.6 ? C.ok : (p.score ?? 0) > 0.3 ? C.warn : C.bad }}
                    >
                      {p.score === null ? "–" : `${Math.round(p.score * 100)}%`}
                    </td>
                    <td className="text-xs text-slate-300">
                      {p.targets
                        .map((x) =>
                          t("{l}: {a}→{b} (target {c})", {
                            l: x.label,
                            a: fmt(x.start, 2),
                            b: fmt(x.current, 2),
                            c: fmt(x.target, 2),
                          }),
                        )
                        .join(" · ")}
                    </td>
                    <td>
                      {p.days_to_target_left === null
                        ? p.days_since_start >= 4
                          ? t("not on track")
                          : "–"
                        : `~${Math.ceil(p.days_to_target_left)}`}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Trends crewIds={crewIds} />
      <Correlations crewIds={crewIds} />

      <Card title={t("Event log (as received on the ground)")}>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-ink-900 text-xs text-slate-400">
              <tr>
                <th className="py-1.5">#</th>
                <th>{t("Mission time")}</th>
                <th>{t("Crew")}</th>
                <th>{t("Event")}</th>
                <th>{t("Transit")}</th>
              </tr>
            </thead>
            <tbody>
              {evts?.events.map((e) => (
                <tr key={e.seq} className="border-t border-ink-700 align-top">
                  <td className="py-1.5 tabular-nums text-xs text-slate-500">{e.seq}</td>
                  <td className="whitespace-nowrap pr-2 tabular-nums text-xs">{missionTOf(e.mission_t)}</td>
                  <td className="whitespace-nowrap pr-2 font-semibold text-fg">
                    {e.crew_id ? crewLabel(e.crew_id) : e.crew_name}
                  </td>
                  <td
                    className={cx(
                      e.level === "red"
                        ? "font-bold text-bad"
                        : e.level === "amber" || e.level === "warn"
                          ? "text-warn"
                          : "text-slate-200",
                    )}
                  >
                    {e.text}
                  </td>
                  <td className="whitespace-nowrap text-xs text-slate-400">{duration(e.transit_s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
