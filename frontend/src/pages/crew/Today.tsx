import { useState, type ReactNode } from "react";
import { C } from "../../lib/theme";
import { Link, useNavigate } from "react-router-dom";
import { Icon, type IconName } from "../../components/Icon";
import { Button, Empty, ProgressBar, StatusPill, Unverified, cx } from "../../components/ui";
import {
  api,
  duration,
  fmt,
  missionTime,
  usePoll,
  type Alert,
  type Clock,
  type Level,
  type LinkStatus,
  type Metric,
  type OcularTelemetry,
  type Task,
} from "../../lib/api";
import { useApp, useCrewName } from "../../lib/context";
import { t } from "../../lib/i18n";

interface Readiness {
  level: number;
  label: string;
  max_level: number;
  activities: { id: string; label: string; allowed: boolean }[];
}
interface Driver {
  metric: string;
  label: string;
  value: number;
  unit: string;
  decimals: number;
  status: Level;
}
interface TodayData {
  crew: { id: string; name: string; role: string };
  overall: Level;
  alerts: Alert[];
  tasks: Task[];
  sleep: { sleep_h: Metric; sleep_quality: Metric };
  sleep_nights: { day: number; value: number }[];
  baselines: { hr: number | null; spo2: number | null; core_temp: number | null; co2_mmhg: number | null };
  alert_drivers: Driver[];
  water_target_l: number;
  protocols: {
    protocol_id: number;
    label: string;
    score: number | null;
    days_since_start: number;
    days_to_target_left: number | null;
    dose_text: string;
  }[];
  energy: { kcal_so_far: number; kcal_expected: number; live: { kcal: number } | null };
  intake_yesterday: number | null;
  mind: { checkin: Record<string, number> | null; wellbeing: number | null; stress: number | null };
  readiness: Readiness | null;
  ocular?: OcularTelemetry;
  live: Record<string, number>;
  autopilot: boolean;
  workout_active: boolean;
  link?: LinkStatus;
}

const CONFIRM_BY_TAP = ["workout", "vest_rehab", "prelanding", "lsah", "water", "supplement", "fluid"];

function zoneColor(zone: "normal" | "elevated" | "critical"): string {
  if (zone === "critical") return C.bad;
  if (zone === "elevated") return C.warn;
  return C.ok;
}

function zoneLabel(zone: "normal" | "elevated" | "critical"): string {
  if (zone === "critical") return t("Critical");
  if (zone === "elevated") return t("Elevated");
  return t("Normal");
}

/** Fallback generator if the backend server process was started before the ocular module was added. */
function buildFallbackOcular(
  data: TodayData,
  crewId: string,
  clock: Clock | null | undefined,
  override?: Partial<OcularTelemetry> | null
): OcularTelemetry {
  const crewNum = parseInt(crewId.replace(/\D/g, ""), 10) || 1;
  const curHour = Math.floor(clock?.hour ?? 8);
  const co2 = data.live?.co2_mmhg ?? 2.4;
  const baseIop = Number((18.1 + crewNum * 0.35 + Math.max(0, co2 - 2.4) * 0.6).toFixed(1));
  const iop = override?.iop_mmhg ?? baseIop;
  const od = override?.iop_od_mmhg ?? Number((iop + 0.2).toFixed(1));
  const os = override?.iop_os_mmhg ?? Number((iop - 0.2).toFixed(1));
  const onsd = override?.onsd_mm ?? Number((5.48 + crewNum * 0.04 + (iop > 23 ? 0.85 : 0)).toFixed(2));
  const icp = override?.icp_mmhg ?? Number((13.4 + crewNum * 0.25 + (iop > 23 ? 6.2 : 0)).toFixed(1));
  const shiftMl = override?.antigravity_fluid?.fluid_shift_ml ?? Math.round(1620 + crewNum * 45 + (iop > 23 ? 640 : 0));

  const safety_zone: "normal" | "elevated" | "critical" =
    iop >= 24.0 || onsd >= 6.3 || icp >= 19.5
      ? "critical"
      : iop >= 20.5 || onsd >= 5.8 || icp >= 16.5
      ? "elevated"
      : "normal";

  const rawStab = 94 - Math.max(0, (shiftMl - 1450) / 16) - Math.max(0, (iop - 17.5) * 4.2);
  const stabPct = Math.max(18, Math.min(98, Math.round(rawStab)));
  const stabStatus: "stabilized" | "adapting" | "anomaly" =
    safety_zone === "critical" || stabPct < 52 ? "anomaly" : stabPct < 76 ? "adapting" : "stabilized";

  const trend_24h = Array.from({ length: 24 }, (_, idx) => {
    const hOffset = idx - 23;
    const hClock = (curHour + hOffset + 24) % 24;
    const frac = hClock / 24;
    const circ = Math.cos(2 * Math.PI * (frac - 0.22));
    const wave = Math.sin((idx + crewNum) * 0.7) * 0.25;
    const ptIop = hOffset === 0 ? iop : Number((baseIop + 0.85 * circ + wave).toFixed(1));
    return {
      hour_offset: hOffset,
      hour: `${String(hClock).padStart(2, "0")}:00`,
      iop_mmhg: ptIop,
      icp_mmhg: Number((icp + 0.35 * circ).toFixed(1)),
      onsd_mm: Number((onsd + 0.03 * circ).toFixed(2)),
      normal_max: 20.5,
      critical_min: 24.0,
    };
  });

  const lastSos = override?.emergency_protocol?.last_sos ?? null;
  const failsafeTriggered = safety_zone === "critical" || shiftMl >= 2250 || lastSos !== null;
  const inBlackout = Boolean(data.link?.blackout);

  return {
    iop_mmhg: iop,
    iop_od_mmhg: od,
    iop_os_mmhg: os,
    onsd_mm: onsd,
    icp_mmhg: icp,
    safety_zone,
    thresholds: { normal_max: 20.5, elevated_max: 24.0, critical_min: 24.0 },
    trend_24h,
    last_scan: override?.last_scan ?? null,
    device: {
      id: "tonometer",
      name: "Space Ocular Tonometer & OCT Pod",
      connected: true,
      state: "connected",
      battery_pct: 94 - crewNum * 2,
    },
    antigravity_fluid: {
      fluid_shift_ml: shiftMl,
      icp_mmhg: icp,
      iop_shift_delta_mmhg: Number(Math.max(0, iop - (14.4 + crewNum * 0.25)).toFixed(1)),
      stabilization_pct: stabPct,
      stabilization_status: stabStatus,
      headward_distribution_pct: Number(Math.min(78, 52 + shiftMl / 120).toFixed(1)),
      lower_body_Countermeasure: stabStatus === "anomaly" ? "active" : "standby",
    },
    emergency_protocol: {
      comm_link_state: inBlackout ? "blackout" : failsafeTriggered ? "active" : "standby",
      failsafe_armed: true,
      failsafe_triggered: failsafeTriggered,
      risk_level: safety_zone,
      last_sos: lastSos,
      delay_s: data.link?.delay_s ?? 0.5,
      profile: data.link?.profile ?? "iss",
    },
  };
}

/** Sleek Orbital Progress Ring for the Antigravity & Fluid Dynamics module. */
export function TaskRow({ t: task, onConfirm, busy }: { t: Task; onConfirm: () => void; busy: boolean }) {
  const nav = useNavigate();
  const done = task.status === "done";
  const isStart = task.kind === "supplement_start";
  const opens: Record<string, string> = { checkin: "/crew/mind", dizziness: "/crew/return" };
  const tappable = !done && CONFIRM_BY_TAP.includes(task.kind);
  const circle = cx(
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors duration-200",
    done ? "check-pop bg-ok text-ink-950" : isStart ? "border-2 border-bad/70" : "border-2 border-ink-600"
  );
  return (
    <div
      className={cx(
        "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-tile border p-4 transition-all duration-300",
        done
          ? "border-ok/30 bg-ok/[0.08]"
          : isStart
          ? "border-bad/40 bg-bad/[0.10]"
          : "border-ink-700 bg-ink-850/85 hover:border-ink-600"
      )}
    >
      {tappable ? (
        <button
          onClick={onConfirm}
          disabled={busy}
          aria-label={t("Mark done: {x}", { x: task.title })}
          className={cx(circle, "hover:border-ok hover:bg-ok/15 disabled:opacity-50")}
        />
      ) : (
        <span className={circle} aria-hidden>
          {done ? <Icon name="check" size={22} /> : null}
        </span>
      )}
      <div className="min-w-[180px] flex-1">
        <div className={cx("text-base font-semibold tracking-tight text-fg", done && "text-slate-300 line-through decoration-slate-500")}>
          {task.title}
        </div>
        <div className="text-sm text-slate-400">{task.detail}</div>
        {isStart && (
          <div className="mt-1 text-xs text-slate-300">
            {t("From Lab alert “{a}”: {r}", { a: task.payload.alert_title, r: task.payload.reason })}
            {task.payload.verified === false && <Unverified className="ml-2" />}
          </div>
        )}
      </div>
      {done ? (
        <span className="rounded-full bg-ok/15 px-3.5 py-1 text-xs font-bold text-ok">{t("Done")}</span>
      ) : opens[task.kind] ? (
        <Button kind="primary" onClick={() => nav(opens[task.kind])}>
          {t("Open")}
        </Button>
      ) : (
        <div className="flex flex-wrap gap-2">
          {task.kind === "workout" && (
            <Button kind="ghost" onClick={() => nav(`/crew/exercise?start=${task.payload.device}`)}>
              {t("Start live")}
            </Button>
          )}
          <Button kind={isStart ? "danger" : "ok"} onClick={onConfirm} disabled={busy}>
            {isStart
              ? t("Start & take dose")
              : ["workout", "vest_rehab", "prelanding", "lsah"].includes(task.kind)
              ? t("Mark done")
              : t("Confirm")}
          </Button>
        </div>
      )}
    </div>
  );
}


/** A token name from index.css (e.g. "energy") as a solid colour and a soft wash. */
const tone = (v: string) => ({ solid: `rgb(var(--${v}))`, soft: `rgb(var(--${v}) / 0.14)` });

/**
 * One home tile: a small square that shows a single reading and opens its page.
 * Wide tiles span both columns on a phone.
 */
function Tile({ to, icon, color, label, wide, children }: {
  to: string;
  icon: IconName;
  color: string;
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const c = tone(color);
  return (
    <Link
      to={to}
      className={cx(
        "lift flex min-h-[140px] flex-col rounded-tile border border-ink-700 bg-ink-900 p-4 shadow-card",
        wide && "col-span-2"
      )}
    >
      <div className="flex items-center gap-1.5 min-[400px]:gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: c.soft, color: c.solid }}>
          <Icon name={icon} size={16} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-300 min-[400px]:text-sm">{label}</span>
      </div>
      <div className="pt-4">{children}</div>
    </Link>
  );
}

/** The big number on a tile, with its unit. */
function Big({ value, unit, color }: { value: ReactNode; unit?: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-[32px] font-extrabold leading-none tracking-tight tabular-nums text-fg" style={color ? { color } : undefined}>
        {value}
      </span>
      {unit && <span className="text-sm font-semibold text-slate-400">{unit}</span>}
    </div>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-slate-400">{children}</p>;
}

export default function Today() {
  const { crewId, clock } = useApp();
  const crewName = useCrewName();
  const { data, refresh } = usePoll<TodayData>(`/api/crew/${crewId}/today`, 2500);
  const [sendingSos, setSendingSos] = useState(false);
  const [localOcular, setLocalOcular] = useState<Record<string, Partial<OcularTelemetry>>>({});

  if (!data) return <Empty />;

  const oc: OcularTelemetry = data.ocular ?? buildFallbackOcular(data, crewId, clock, localOcular[crewId]);
  const fluid = oc.antigravity_fluid;
  const ep = oc.emergency_protocol;

  const triggerSos = async () => {
    setSendingSos(true);
    try {
      await api(`/api/crew/${crewId}/emergency/sos`, {
        method: "POST",
        body: { reason: "Crew-initiated Emergency Ground-to-Space Ocular & Fluid Telemetry Alert" },
      });
      await refresh();
    } catch {
      // Fallback if running against an un-restarted backend instance
      const pktId = `SOS-D${clock?.today ?? 30}-${crewId.toUpperCase()}`;
      setLocalOcular((prev) => ({
        ...prev,
        [crewId]: {
          ...prev[crewId],
          emergency_protocol: {
            ...ep,
            comm_link_state: "active",
            failsafe_triggered: true,
            last_sos: {
              packet_id: pktId,
              crew_id: crewId,
              crew_name: data.crew.name,
              mission_t: clock?.mission_t ?? 30,
              day: clock?.today ?? 30,
              auto_failsafe: false,
              reason: "Manual crew SOS trigger",
              tonometer: {
                iop_mmhg: oc.iop_mmhg,
                iop_od_mmhg: oc.iop_od_mmhg,
                iop_os_mmhg: oc.iop_os_mmhg,
                onsd_mm: oc.onsd_mm,
                safety_zone: oc.safety_zone,
                retinal_oct_scan: "INCLUDED",
              },
              status: "transmitted",
            },
          },
        },
      }));
    } finally {
      setSendingSos(false);
    }
  };

  const top = data.alerts?.[0];
  const critical = top?.level === "red";
  const tasks = data.tasks ?? [];
  const total = tasks.length;
  const doneN = tasks.filter((x) => x.status === "done").length;
  const pending = total - doneN;
  const next = tasks.find((x) => x.status === "pending");
  const sleep = data.sleep?.sleep_h;
  const hour = clock?.hour ?? 8;
  const greet = hour < 12 ? t("Good morning") : hour < 18 ? t("Good afternoon") : t("Good evening");
  const burned = data.energy?.kcal_so_far ?? 0;
  const expectedKcal = data.energy?.kcal_expected ?? 2300;
  const L = data.live ?? {};
  const B = data.baselines ?? { hr: null, spo2: null, core_temp: null, co2_mmhg: null };

  const sleepScore = Math.min(100, Math.round(((sleep?.value ?? 7) / 7.5) * 100));
  const wellbeingScore = Math.round(data.mind?.wellbeing ?? 82);
  const energyScore = Math.max(38, Math.min(99, Math.round(sleepScore * 0.35 + fluid.stabilization_pct * 0.35 + wellbeingScore * 0.3)));


  const stressVal = data.mind?.stress ?? 2.2;
  const stressHigh = stressVal >= 3.5;
  const stressWord = stressVal >= 3.6 ? t("High") : stressVal >= 2.5 ? t("Moderate") : t("Low");
  const postflight = clock?.phase === "postflight";
  const sosSent = ep.failsafe_triggered;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-6">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h1 className="text-[26px] font-extrabold tracking-[-0.02em] text-fg sm:text-[32px]">
            {greet}, <span className="text-accent">{crewName}</span>
          </h1>
          <p className="text-sm text-slate-400">
            {data.crew.role} · {missionTime(clock)}
          </p>
        </div>
        {!top && <StatusPill level={data.overall} />}
      </div>

      {/* Alert: the one thing that should not hide inside a tile. */}
      {top ? (
        <Link
          to="/crew/alerts"
          className={cx(
            "lift flex items-center gap-3 rounded-tile border p-4",
            critical ? "border-bad/50 bg-badsoft" : "border-warn/50 bg-warnsoft"
          )}
        >
          <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", critical ? "bg-badfill text-white" : "bg-warn text-ink-950")}>
            <Icon name="alert" size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-fg">{top.title}</div>
            <div className="truncate text-sm text-slate-300">{top.recs[0]?.text ?? top.reason}</div>
          </div>
          <span className="shrink-0 text-sm font-bold text-fg">
            {data.alerts.length > 1 ? t("All {n} alerts", { n: data.alerts.length }) : t("Details")}
          </span>
        </Link>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Tile to="/crew/tasks" icon="check" color="ok" label={t("Today's tasks")} wide>
          <div className="flex items-end justify-between gap-3">
            <Big value={pending === 0 ? t("All done") : pending} unit={pending === 0 ? undefined : t("left")} color={pending === 0 ? C.ok : undefined} />
            <span className="text-sm font-semibold tabular-nums text-slate-400">{doneN}/{total}</span>
          </div>
          <div className="mt-2.5">
            <ProgressBar value={total ? doneN / total : 0} color={C.ok} height={8} />
          </div>
          <Sub>{next ? t("Next: {task}", { task: next.title }) : t("All tasks done today")}</Sub>
        </Tile>

        <Tile to="/crew/energy" icon="energy" color="energy" label={t("Energy score")}>
          <Big value={energyScore} unit="/ 100" />
          <Sub>
            {energyScore >= 80 ? t("Ready for a full day") : energyScore >= 65 ? t("Take it steady") : t("Rest and recover")}
          </Sub>
        </Tile>

        <Tile to="/crew/body" icon="heart" color="bad" label={t("Heart rate")}>
          <Big value={fmt(L.hr, 0)} unit={t("bpm")} />
          <Sub>{B.hr ? t("your normal {v}", { v: fmt(B.hr, 0) }) : t("Live Bio-Monitor")}</Sub>
        </Tile>

        <Tile to="/crew/body" icon="moon" color="rest" label={t("Sleep")}>
          <Big value={fmt(sleep?.value, 1)} unit={t("h")} />
          <Sub>{sleep?.baseline_mean ? t("your normal {v}", { v: `${fmt(sleep.baseline_mean, 1)} ${t("h")}` }) : t("Last night's sleep")}</Sub>
        </Tile>

        <Tile to="/crew/exercise" icon="exercise" color="accent" label={t("Daily activity")}>
          <Big value={fmt(burned, 0)} unit="kcal" />
          <Sub>{t("of {n} kcal expected", { n: fmt(expectedKcal, 0) })}</Sub>
        </Tile>

        <Tile to="/crew/ocular" icon="eye" color="accent" label={t("Ocular & Tonometer")} wide>
          <div className="flex items-end justify-between gap-4">
            <div>
              <Big value={fmt(oc.iop_mmhg, 1)} unit="mmHg" color={zoneColor(oc.safety_zone)} />
              <Sub>
                {t("Eye pressure")} · {zoneLabel(oc.safety_zone)}
              </Sub>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold tabular-nums text-fg">
                {fluid.stabilization_pct}<span className="text-xs font-semibold text-slate-400">%</span>
              </div>
              <div className="text-xs text-slate-400">{t("Fluid balance")}</div>
            </div>
          </div>
        </Tile>

        <Tile to="/crew/food" icon="food" color="energy" label={t("Food & water")}>
          <Big value={fmt(data.water_target_l, 1)} unit={`L ${t("goal")}`} />
          <Sub>
            {data.intake_yesterday !== null
              ? t("yesterday you ate {n} kcal", { n: fmt(data.intake_yesterday, 0) })
              : t("Log meal or water")}
          </Sub>
        </Tile>

        <Tile to="/crew/mind" icon="mind" color="rest" label={t("How are you?")}>
          <Big value={stressWord} color={stressHigh ? C.warn : undefined} />
          <Sub>{data.mind?.checkin ? t("Stress level") : t("Take 30 seconds to check in")}</Sub>
        </Tile>

        <Tile to="/crew/body" icon="droplet" color="accent" label={t("Blood oxygen")}>
          <Big value={fmt(L.spo2, 0)} unit="%" />
          <Sub>{B.spo2 ? t("your normal {v}", { v: `${fmt(B.spo2, 0)}%` }) : t("Bio-Monitor continuous")}</Sub>
        </Tile>

        <Tile to="/crew/return" icon="globe" color="rest" label={postflight ? t("Balance") : t("Return to Earth")}>
          {data.readiness ? (
            <>
              <Big value={data.readiness.level} unit={`/ ${data.readiness.max_level}`} />
              <Sub>{data.readiness.label}</Sub>
            </>
          ) : (
            <>
              <Big value={t("Plan")} />
              <Sub>{t("Get ready for landing")}</Sub>
            </>
          )}
        </Tile>
      </div>

      {/* Emergency: always one tap away, kept small until it is needed. */}
      <div
        className={cx(
          "mt-2 flex items-center gap-3 rounded-tile border p-3 pl-4",
          sosSent ? "border-bad/60 bg-badsoft" : "border-ink-700 bg-ink-900"
        )}
      >
        <Icon name="satellite" size={20} className={sosSent ? "text-bad" : "text-slate-400"} />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold text-fg">
            {sosSent
              ? t("SOS sent to Earth")
              : ep.comm_link_state === "blackout"
              ? t("Ground link: blackout")
              : t("Ground link: active")}
          </div>
          <div className="truncate text-xs text-slate-400">
            {ep.last_sos ? ep.last_sos.packet_id : t("One-way link delay: {d}", { d: duration(ep.delay_s) })}
          </div>
        </div>
        <button
          type="button"
          onClick={triggerSos}
          disabled={sendingSos}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full bg-badfill px-4 text-sm font-extrabold text-white transition hover:brightness-110 active:scale-95 disabled:opacity-50"
        >
          <Icon name="sos" size={18} />
          {sendingSos ? t("Sending…") : t("SOS")}
        </button>
      </div>
    </div>
  );
}
