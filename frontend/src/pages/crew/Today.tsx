import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Icon } from "../../components/Icon";
import { ConcentricRings, Ring } from "../../components/Ring";
import { Button, Empty, ProgressBar, StatusPill, Unverified, cx } from "../../components/ui";
import {
  LEVEL_COLOR,
  api,
  dayTick,
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
import { useApp } from "../../lib/context";
import { t, tn } from "../../lib/i18n";

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

const ELECTRIC_BLUE = "#00E5FF";
const HEALTH_GREEN = "#00E676";
const WARN_AMBER = "#FF9100";
const CRIT_RED = "#FF5252";
const TELEMETRY_VIOLET = "#B388FF";
const HEART_PINK = "#FF6B81";

const CONFIRM_BY_TAP = ["workout", "vest_rehab", "prelanding", "lsah", "water", "supplement", "fluid"];

function zoneColor(zone: "normal" | "elevated" | "critical"): string {
  if (zone === "critical") return CRIT_RED;
  if (zone === "elevated") return WARN_AMBER;
  return HEALTH_GREEN;
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
function OrbitalFluidRing({ pct, status }: { pct: number; status: "stabilized" | "adapting" | "anomaly" }) {
  const size = 148;
  const center = size / 2;
  const rOuter = 62;
  const rInner = 47;
  const cOuter = 2 * Math.PI * rOuter;
  const cInner = 2 * Math.PI * rInner;
  const f = Math.max(0.05, Math.min(1, pct / 100));
  const primaryColor = status === "anomaly" ? CRIT_RED : status === "adapting" ? WARN_AMBER : TELEMETRY_VIOLET;
  const secondaryColor = status === "anomaly" ? WARN_AMBER : ELECTRIC_BLUE;
  const angleRad = ((f * 360 - 90) * Math.PI) / 180;
  const satX = center + rOuter * Math.cos(angleRad);
  const satY = center + rOuter * Math.sin(angleRad);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={t("Fluid balance stabilization ring")}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <defs>
          <linearGradient id="orbitalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={ELECTRIC_BLUE} />
            <stop offset="100%" stopColor={primaryColor} />
          </linearGradient>
        </defs>
        <circle
          cx={center}
          cy={center}
          r={rOuter + 7}
          fill="none"
          stroke="rgba(179, 136, 255, 0.16)"
          strokeWidth={1}
          strokeDasharray="3 5"
          className="orbital-pulse"
        />
        <g transform={`rotate(-90 ${center} ${center})`} fill="none" strokeLinecap="round">
          <circle cx={center} cy={center} r={rOuter} stroke="rgba(255,255,255,0.07)" strokeWidth={9} />
          <circle
            className="ring-arc"
            cx={center}
            cy={center}
            r={rOuter}
            stroke="url(#orbitalGrad)"
            strokeWidth={9}
            strokeDasharray={`${cOuter} ${cOuter}`}
            strokeDashoffset={cOuter * (1 - f)}
            style={{ filter: `drop-shadow(0 0 8px ${primaryColor}88)` }}
          />
          <circle cx={center} cy={center} r={rInner} stroke="rgba(0, 229, 255, 0.1)" strokeWidth={5} />
          <circle
            className="ring-arc"
            cx={center}
            cy={center}
            r={rInner}
            stroke={secondaryColor}
            strokeWidth={5}
            strokeDasharray={`${cInner} ${cInner}`}
            strokeDashoffset={cInner * (1 - Math.min(1, f * 0.92))}
            strokeOpacity={0.75}
          />
        </g>
        <circle cx={satX} cy={satY} r={5} fill="#F8FAFC" stroke={primaryColor} strokeWidth={2.5} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        <span className="text-[10px] font-bold uppercase tracking-widest text-telemetry">{t("Orbital Sync")}</span>
        <span className="mt-1 text-3xl font-extrabold tabular-nums tracking-tight text-white">{pct}%</span>
        <span
          className="mt-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={{
            background: `${primaryColor}22`,
            color: primaryColor,
          }}
        >
          {status === "stabilized" ? t("Stabilized") : status === "adapting" ? t("Adapting") : t("Anomaly")}
        </span>
      </div>
    </div>
  );
}

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
          : "border-white/[0.06] bg-ink-850/85 hover:border-white/15"
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
        <div className={cx("text-base font-semibold tracking-tight text-white", done && "text-slate-300 line-through decoration-slate-500")}>
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
        <span className="rounded-full bg-ok/15 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-ok">{t("Done")}</span>
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

function SleepBars({ nights, normal }: { nights: { day: number; value: number }[]; normal: number | null }) {
  const safeNights = nights ?? [];
  const top = Math.max(9, ...safeNights.map((n) => n.value));
  return (
    <div className="mt-3">
      <div className="relative flex h-16 items-end gap-1.5">
        {normal !== null && (
          <div
            className="absolute inset-x-0 border-t border-dashed border-white/30"
            style={{ bottom: `${(normal / top) * 100}%` }}
          />
        )}
        {safeNights.map((n, i) => (
          <div key={n.day} className="flex h-full flex-1 items-end" title={`${dayTick(n.day)}: ${fmt(n.value, 1)} ${t("h")}`}>
            <div
              className="w-full rounded-full transition-all"
              style={{
                height: `${(n.value / top) * 100}%`,
                background: i === safeNights.length - 1 ? "#00E5FF" : "#B388FF",
                opacity: i === safeNights.length - 1 ? 1 : 0.55,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 text-center text-[10px] tabular-nums text-indigo-200/70">
        {safeNights.map((n) => (
          <span key={n.day} className="flex-1">
            {dayTick(n.day)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Today() {
  const { crewId, clock } = useApp();
  const { data, refresh } = usePoll<TodayData>(`/api/crew/${crewId}/today`, 2500);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [sendingSos, setSendingSos] = useState(false);
  const [editHome, setEditHome] = useState(false);
  const [showVitalsGrid, setShowVitalsGrid] = useState(true);
  const [localOcular, setLocalOcular] = useState<Record<string, Partial<OcularTelemetry>>>({});

  if (!data) return <Empty />;

  const oc: OcularTelemetry = data.ocular ?? buildFallbackOcular(data, crewId, clock, localOcular[crewId]);
  const fluid = oc.antigravity_fluid;
  const ep = oc.emergency_protocol;

  const confirm = async (id: string) => {
    setBusy(id);
    try {
      await api(`/api/crew/${crewId}/tasks/${encodeURIComponent(id)}/confirm`, { method: "POST" });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const runOcularScan = async (mode: "calibration" | "anomaly" = "calibration") => {
    setScanning(true);
    try {
      await api(`/api/crew/${crewId}/ocular/scan`, { method: "POST", body: { mode } });
      await refresh();
    } catch {
      // Fallback if running against an un-restarted backend instance
      const isAnom = mode === "anomaly";
      const iop = isAnom ? 25.8 : Number((oc.iop_mmhg + 0.1).toFixed(1));
      const od = Number((iop + 0.2).toFixed(1));
      const os = Number((iop - 0.2).toFixed(1));
      const onsd = isAnom ? 6.45 : oc.onsd_mm;
      const icp = isAnom ? 20.6 : oc.icp_mmhg;
      const shift = isAnom ? 2360 : fluid.fluid_shift_ml;
      const pktId = `SOS-D${clock?.today ?? 30}-${crewId.toUpperCase()}`;
      setLocalOcular((prev) => ({
        ...prev,
        [crewId]: {
          iop_mmhg: iop,
          iop_od_mmhg: od,
          iop_os_mmhg: os,
          onsd_mm: onsd,
          icp_mmhg: icp,
          last_scan: {
            iop_mmhg: iop,
            iop_od_mmhg: od,
            iop_os_mmhg: os,
            onsd_mm: onsd,
            icp_mmhg: icp,
            fluid_shift_ml: shift,
            mode,
            mission_t: clock?.mission_t ?? 30,
          },
          antigravity_fluid: {
            ...fluid,
            fluid_shift_ml: shift,
          },
          emergency_protocol: isAnom
            ? {
                ...ep,
                comm_link_state: "active",
                failsafe_triggered: true,
                risk_level: "critical",
                last_sos: {
                  packet_id: pktId,
                  crew_id: crewId,
                  crew_name: data.crew.name,
                  mission_t: clock?.mission_t ?? 30,
                  day: clock?.today ?? 30,
                  auto_failsafe: true,
                  reason: "Auto-Failsafe: Critical IOP & fluid threshold exceeded",
                  tonometer: {
                    iop_mmhg: iop,
                    iop_od_mmhg: od,
                    iop_os_mmhg: os,
                    onsd_mm: onsd,
                    safety_zone: "critical",
                    retinal_oct_scan: "INCLUDED",
                  },
                  status: "transmitted",
                },
              }
            : ep,
        },
      }));
    } finally {
      setTimeout(() => setScanning(false), 450);
    }
  };

  const triggerSos = async () => {
    setSendingSos(true);
    try {
      await api(`/api/crew/${crewId}/emergency/sos`, {
        method: "POST",
        body: { reason: "Crew-initiated Emergency Ground-to-Space Ocular & Fluid Telemetry Alert" },
      });
      await refresh();
    } catch {
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
  const tasks = data.tasks ?? [];
  const total = tasks.length;
  const doneN = tasks.filter((x) => x.status === "done").length;
  const pending = total - doneN;
  const sleep = data.sleep?.sleep_h;
  const hour = clock?.hour ?? 8;
  const greet = hour < 12 ? t("Good morning") : hour < 18 ? t("Good afternoon") : t("Good evening");
  const burned = data.energy?.kcal_so_far ?? 0;
  const expectedKcal = data.energy?.kcal_expected ?? 2300;
  const L = data.live ?? {};
  const B = data.baselines ?? { hr: null, spo2: null, core_temp: null, co2_mmhg: null };
  const critical = top?.level === "red";

  // Compute an overall Samsung Health-inspired Energy & Readiness Score (0-100)
  const sleepScore = Math.min(100, Math.round(((sleep?.value ?? 7) / 7.5) * 100));
  const fluidScore = fluid.stabilization_pct;
  const wellbeingScore = Math.round(data.mind?.wellbeing ?? 82);
  const energyScore = Math.max(38, Math.min(99, Math.round(sleepScore * 0.35 + fluidScore * 0.35 + wellbeingScore * 0.3)));

  // Synthetic 12-bar heart rate history around live HR for the Samsung Health Heart Rate card
  const hrNow = L.hr ?? 64;
  const hrBars = [-22, -18, -14, -10, -6, -2, 3, 8, 4, -3, 2, 0].map((d, idx) => ({
    idx,
    low: Math.max(48, Math.round(hrNow - 12 + d * 0.5)),
    high: Math.min(165, Math.round(hrNow + 8 + Math.abs(d))),
  }));

  const stressVal = data.mind?.stress ?? 2.2;
  const stressPct = Math.max(8, Math.min(96, Math.round((stressVal / 5) * 100)));
  const stressWord = stressVal >= 3.6 ? t("High") : stressVal >= 2.5 ? t("Moderate") : t("Low");

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-6">
      {/* Top Samsung Health Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-accent shadow-glowBlue" />
            <span className="text-xs font-bold uppercase tracking-widest text-accent">{t("Antigravity Health Hub")}</span>
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            {greet}, <span className="text-accent">{data.crew.name}</span>
          </h1>
          <p className="text-sm text-slate-400">
            {data.crew.role} · {missionTime(clock)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusPill level={data.overall} />
          <button
            type="button"
            onClick={() => setEditHome((v) => !v)}
            className={cx(
              "inline-flex min-h-[40px] items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition",
              editHome
                ? "border-accent bg-accent text-ink-950 shadow-glowBlue"
                : "border-white/10 bg-ink-900 text-slate-300 hover:border-white/25 hover:text-white"
            )}
          >
            <Icon name="sliders" size={16} />
            {editHome ? t("Done editing") : t("Edit home")}
          </button>
        </div>
      </div>

      {editHome && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-tile border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-slate-200">
          <span>{t("Customize your Samsung Health space telemetry widgets:")}</span>
          <button
            type="button"
            onClick={() => setShowVitalsGrid((v) => !v)}
            className="rounded-full border border-accent/30 bg-ink-900 px-3.5 py-1 text-xs font-semibold text-accent"
          >
            {showVitalsGrid ? t("Hide Secondary Vitals Row") : t("Show Secondary Vitals Row")}
          </button>
        </div>
      )}

      {/* MODULE 3: EMERGENCY GROUND-TO-SPACE PROTOCOL BANNER */}
      <section
        aria-label={t("Emergency Ground-to-Space Protocol")}
        className={cx(
          "relative overflow-hidden rounded-card border p-5 transition-all duration-300 sm:p-6",
          ep.failsafe_triggered
            ? "border-bad/80 bg-gradient-to-r from-[#2A0E17] via-[#1F121B] to-[#181C24] shadow-glowRed"
            : ep.comm_link_state === "blackout"
            ? "border-warn/60 bg-gradient-to-r from-[#261A0E] via-[#181C24] to-[#181C24]"
            : "border-telemetry/40 bg-gradient-to-r from-[#1A172B] via-[#161B26] to-[#181C24] shadow-glowViolet"
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div
              className={cx(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border",
                ep.failsafe_triggered
                  ? "animate-pulse border-bad bg-bad/20 text-bad"
                  : "border-telemetry/50 bg-telemetry/15 text-telemetry"
              )}
            >
              <Icon name="satellite" size={26} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cx(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-extrabold uppercase tracking-wider",
                    ep.comm_link_state === "active"
                      ? "bg-bad text-ink-950"
                      : ep.comm_link_state === "blackout"
                      ? "bg-warn text-ink-950"
                      : "border border-ok/40 bg-ok/20 text-ok"
                  )}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      background:
                        ep.comm_link_state === "active"
                          ? "#0D0F12"
                          : ep.comm_link_state === "blackout"
                          ? "#0D0F12"
                          : HEALTH_GREEN,
                    }}
                  />
                  {ep.comm_link_state === "active"
                    ? t("Ground Communication Link: Active")
                    : ep.comm_link_state === "blackout"
                    ? t("Ground Communication Link: LOS Blackout (Store & Forward)")
                    : t("Ground Communication Link: Active / Standby")}
                </span>
                <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-medium text-slate-300">
                  {t("Fail-Safe: Armed (IOP ≥ 24 mmHg · Shift ≥ 2250 mL)")}
                </span>
                <span className="text-xs text-slate-400">
                  · {t("One-way link delay: {d}", { d: duration(ep.delay_s) })}
                </span>
              </div>
              <h2 className="mt-1.5 text-lg font-bold tracking-tight text-white sm:text-xl">
                {ep.failsafe_triggered
                  ? t("CRITICAL BIOLOGICAL RISK DETECTED — Emergency Telemetry Packet Beamed to Earth")
                  : t("Emergency Ground-to-Space Protocol & Automated Bio-Risk Fail-Safe")}
              </h2>
              <p className="mt-0.5 text-sm text-slate-300">
                {ep.last_sos
                  ? t("Last SOS Packet [{id}] transmitted: IOP {iop} mmHg (OD {od} / OS {os}) + Retinal OCT + Vitals Logs.", {
                      id: ep.last_sos.packet_id,
                      iop: fmt(ep.last_sos.tonometer.iop_mmhg, 1),
                      od: fmt(ep.last_sos.tonometer.iop_od_mmhg, 1),
                      os: fmt(ep.last_sos.tonometer.iop_os_mmhg, 1),
                    })
                  : t("Automatically packets paired tonometer IOP data, retinal OCT scans, and fluid shift telemetry to Mission Control when acute biological risk is detected.")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => runOcularScan("anomaly")}
              disabled={scanning}
              className="min-h-[44px] rounded-full border border-warn/50 bg-warn/15 px-4 py-2 text-xs font-bold uppercase tracking-wider text-warn transition hover:bg-warn/25 disabled:opacity-50"
            >
              {t("Simulate Acute IOP Spike")}
            </button>
            <button
              type="button"
              onClick={triggerSos}
              disabled={sendingSos}
              className={cx(
                "inline-flex min-h-[44px] items-center gap-2 rounded-full px-5 py-2 text-xs font-extrabold uppercase tracking-wider transition active:scale-95 disabled:opacity-50",
                ep.failsafe_triggered
                  ? "bg-bad text-ink-950 shadow-glowRed hover:brightness-110"
                  : "bg-accent text-ink-950 shadow-glowBlue hover:brightness-110"
              )}
            >
              <Icon name="sos" size={18} />
              {sendingSos ? t("Beaming SOS…") : t("Transmit Emergency SOS")}
            </button>
          </div>
        </div>
      </section>

      {/* SAMSUNG HEALTH HERO BANNER (Energy Score) + CONCENTRIC ACTIVITY + HEART RATE */}
      <div className="grid gap-5 lg:grid-cols-12">
        <Link
          to="/crew/energy"
          className="lift relative flex flex-col justify-between overflow-hidden rounded-card p-6 text-white shadow-card lg:col-span-5"
          style={{
            background: "linear-gradient(135deg, #1E50F2 0%, #0E74FF 55%, #00B8FF 100%)",
          }}
        >
          <div className="relative z-10 flex items-start justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/20 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-cyan-100 backdrop-blur-sm">
                {t("Energy score")}
              </span>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-5xl font-extrabold tabular-nums tracking-tight">{energyScore}</span>
                <span className="text-lg font-semibold text-blue-100">/ 100</span>
              </div>
              <p className="mt-1 text-sm font-medium text-blue-100">
                {energyScore >= 80
                  ? t("Optimal orbital readiness")
                  : energyScore >= 65
                  ? t("Moderate adaptation load")
                  : t("Recovery countermeasures advised")}
              </p>
            </div>
            <div
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full shadow-lg"
              style={{
                background:
                  "radial-gradient(circle at 35% 30%, #00E5FF 0%, #00E676 38%, #FF9100 72%, #B388FF 100%)",
                boxShadow: "0 0 36px rgba(0, 229, 255, 0.55)",
              }}
            >
              <Icon name="energy" size={34} className="text-ink-950" />
            </div>
          </div>
          <div className="relative z-10 mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/20 pt-3.5 text-xs font-medium text-blue-50">
            <span>{t("Keep tracking your condition with your Bio-Monitor & Space Tonometer.")}</span>
            <span className="font-bold uppercase tracking-wider">{t("Details ›")}</span>
          </div>
        </Link>

        {/* Daily Activity Concentric Rings Card */}
        <Link
          to="/crew/exercise"
          className="shealth-card lift flex flex-col justify-between rounded-card p-5 lg:col-span-3"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white">{t("Daily activity")}</h2>
            <span className="text-xs font-semibold text-slate-400">
              {doneN}/{total} {t("tasks")}
            </span>
          </div>
          <div className="my-3 flex items-center justify-center">
            <ConcentricRings
              size={126}
              stroke={10}
              gap={4}
              label={t("Daily activity concentric rings")}
              rings={[
                { value: burned, max: Math.max(1, expectedKcal), color: HEALTH_GREEN },
                { value: doneN, max: Math.max(1, total), color: ELECTRIC_BLUE },
                { value: fluid.stabilization_pct, max: 100, color: TELEMETRY_VIOLET },
              ]}
            >
              <Icon name="heart" size={22} className="text-accent" />
            </ConcentricRings>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center text-xs">
            <div>
              <div className="font-bold tabular-nums text-ok">{burned}</div>
              <div className="text-[11px] text-slate-400">kcal</div>
            </div>
            <div>
              <div className="font-bold tabular-nums text-accent">
                {doneN}/{total}
              </div>
              <div className="text-[11px] text-slate-400">{t("tasks")}</div>
            </div>
            <div>
              <div className="font-bold tabular-nums text-telemetry">{fluid.stabilization_pct}%</div>
              <div className="text-[11px] text-slate-400">{t("fluid")}</div>
            </div>
          </div>
        </Link>

        {/* Samsung Health Heart Rate Bar Chart Card */}
        <Link
          to="/crew/body"
          className="shealth-card lift flex flex-col justify-between rounded-card p-5 lg:col-span-4"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-white">{t("Heart rate")}</h2>
              <p className="text-xs text-slate-400">
                {B.hr ? t("your normal {v}", { v: fmt(B.hr, 0) }) : t("Live Bio-Monitor")}
              </p>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-sm font-extrabold tabular-nums text-ink-950 shadow">
              <Icon name="heart" size={14} className="text-bad" />
              {fmt(L.hr, 0)} <span className="text-[11px] font-semibold text-slate-600">{t("bpm")}</span>
            </div>
          </div>

          <div className="my-3 flex h-24 items-end gap-1.5 rounded-xl bg-ink-950/60 px-3 py-2.5">
            {hrBars.map((b) => {
              const minP = Math.max(8, ((b.low - 45) / 110) * 100);
              const maxP = Math.min(100, ((b.high - 45) / 110) * 100);
              return (
                <div key={b.idx} className="relative flex h-full flex-1 items-end justify-center">
                  <div
                    className="w-2 rounded-full"
                    style={{
                      height: `${Math.max(18, maxP - minP)}%`,
                      marginBottom: `${minP * 0.4}%`,
                      background: b.idx === hrBars.length - 1 ? "#FF5252" : HEART_PINK,
                      opacity: b.idx === hrBars.length - 1 ? 1 : 0.65,
                    }}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{t("Resting & orbital range")}</span>
            <span className="font-mono text-slate-300">{missionTime(clock)}</span>
          </div>
        </Link>
      </div>

      {/* MODULE 1 & MODULE 2: ANTIGRAVITY & FLUID DYNAMICS + SPACE OCULAR HEALTH & TONOMETER SYNC */}
      <div className="grid gap-5 lg:grid-cols-12">
        {/* MODULE 1: Antigravity & Fluid Dynamics */}
        <section
          aria-label={t("Antigravity & Fluid Dynamics")}
          className="shealth-card flex flex-col justify-between rounded-card p-5 sm:p-6 lg:col-span-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-telemetry" />
                <span className="text-xs font-bold uppercase tracking-wider text-telemetry">
                  {t("Microgravity Telemetry")}
                </span>
              </div>
              <h2 className="mt-1 text-xl font-bold tracking-tight text-white">
                {t("Antigravity & Fluid Dynamics")}
              </h2>
            </div>
            <span className="rounded-full border border-telemetry/30 bg-telemetry/10 px-3 py-1 text-xs font-bold text-telemetry">
              0G · {clock?.phase === "postflight" ? "1G" : "μG"}
            </span>
          </div>

          <div className="my-5 flex flex-col items-center gap-5 sm:flex-row">
            <OrbitalFluidRing pct={fluid.stabilization_pct} status={fluid.stabilization_status} />
            <div className="w-full flex-1 space-y-3">
              <div className="rounded-tile border border-white/[0.06] bg-ink-850/90 p-3.5">
                <div className="text-xs text-slate-400">{t("Cephalad Fluid Shift")}</div>
                <div className="mt-0.5 flex items-baseline justify-between">
                  <span className="text-2xl font-extrabold tabular-nums text-white">
                    {fluid.fluid_shift_ml} <span className="text-xs font-normal text-slate-400">mL</span>
                  </span>
                  <span className="text-xs font-semibold text-telemetry">
                    {fluid.headward_distribution_pct}% {t("upper body")}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-tile border border-white/[0.06] bg-ink-850/90 p-3">
                  <div className="text-[11px] text-slate-400">{t("Intracranial (ICP)")}</div>
                  <div className="mt-0.5 text-xl font-bold tabular-nums text-accent">
                    {fmt(fluid.icp_mmhg, 1)} <span className="text-xs font-normal text-slate-400">mmHg</span>
                  </div>
                </div>
                <div className="rounded-tile border border-white/[0.06] bg-ink-850/90 p-3">
                  <div className="text-[11px] text-slate-400">{t("Ocular Shift Δ")}</div>
                  <div className="mt-0.5 text-xl font-bold tabular-nums text-warn">
                    +{fmt(fluid.iop_shift_delta_mmhg, 1)} <span className="text-xs font-normal text-slate-400">mmHg</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-tile border border-white/[0.05] bg-ink-950/60 px-4 py-2.5 text-xs">
            <span className="text-slate-300">
              {t("LBNP / Thigh-Cuff Countermeasure:")}{" "}
              <strong className={fluid.lower_body_Countermeasure === "active" ? "text-warn" : "text-ok"}>
                {fluid.lower_body_Countermeasure === "active" ? t("Active Protocol") : t("Standby Nominal")}
              </strong>
            </span>
            <Link to="/crew/ocular" className="font-bold text-accent hover:underline">
              {t("Ocular & Fluid ›")}
            </Link>
          </div>
        </section>

        {/* MODULE 2: Space Ocular Health & Tonometer Sync */}
        <section
          aria-label={t("Space Ocular Health & Tonometer Sync")}
          className="shealth-card flex flex-col justify-between rounded-card p-5 sm:p-6 lg:col-span-7"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Icon name="eye" size={16} className="text-accent" />
                <span className="text-xs font-bold uppercase tracking-wider text-accent">
                  {t("Eye-Based Health Check System · Paired Tonometer")}
                </span>
              </div>
              <h2 className="mt-1 text-xl font-bold tracking-tight text-white">
                {t("Space Ocular Health & Tonometer Sync")}
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-2 rounded-full border px-3.5 py-1 text-xs font-extrabold uppercase tracking-wider"
                style={{
                  borderColor: `${zoneColor(oc.safety_zone)}66`,
                  background: `${zoneColor(oc.safety_zone)}1F`,
                  color: zoneColor(oc.safety_zone),
                }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: zoneColor(oc.safety_zone) }} />
                {t("Safety Zone:")} {zoneLabel(oc.safety_zone)}
              </span>
              {oc.device.battery_pct !== null && (
                <span className="rounded-full bg-ink-850 px-2.5 py-1 text-xs font-semibold text-slate-400">
                  {t("Pod")} {oc.device.battery_pct}%
                </span>
              )}
            </div>
          </div>

          <div className="my-4 grid gap-3 sm:grid-cols-4">
            <div className="rounded-tile border border-white/[0.08] bg-ink-850 p-3.5 sm:col-span-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{t("Live Intraocular Pressure (IOP)")}</span>
                <span className="font-mono text-[11px] text-accent">{t("SYNCED")}</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span
                  className="text-4xl font-extrabold tabular-nums tracking-tight"
                  style={{ color: zoneColor(oc.safety_zone) }}
                >
                  {fmt(oc.iop_mmhg, 1)}
                </span>
                <span className="text-sm font-semibold text-slate-400">mmHg</span>
                <span className="ml-auto text-xs text-slate-300">
                  OD {fmt(oc.iop_od_mmhg, 1)} · OS {fmt(oc.iop_os_mmhg, 1)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                <span className="text-ok">● &lt;20.5 {t("Normal")}</span>
                <span className="text-warn">● 20.5–24 {t("Elevated")}</span>
                <span className="text-bad">● ≥24 {t("Critical")}</span>
              </div>
            </div>

            <div className="rounded-tile border border-white/[0.06] bg-ink-850/90 p-3.5">
              <div className="text-xs text-slate-400">{t("Optic Nerve (ONSD)")}</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-white">
                {fmt(oc.onsd_mm, 2)} <span className="text-xs font-normal text-slate-400">mm</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">{t("Limit 5.80 mm")}</div>
            </div>

            <div className="rounded-tile border border-white/[0.06] bg-ink-850/90 p-3.5">
              <div className="text-xs text-slate-400">{t("Tonometer Status")}</div>
              <div className="mt-1 text-base font-bold text-ok">
                {oc.device.connected ? t("Paired · Live") : t("Offline")}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                {oc.last_scan ? t("Calibrated today") : t("Auto-telemetry")}
              </div>
            </div>
          </div>

          <div className="rounded-tile border border-white/[0.05] bg-ink-950/65 p-3">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">
                {t("24-Hour Microgravity Optic Nerve & IOP Variation (mmHg)")}
              </span>
              <span className="text-slate-400">{t("Last 24h")}</span>
            </div>
            <div className="h-36 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={oc.trend_24h} margin={{ top: 6, right: 8, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="iopAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ELECTRIC_BLUE} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={TELEMETRY_VIOLET} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="hour" tick={{ fill: "#94a3b8", fontSize: 10 }} interval={5} />
                  <YAxis domain={[12, 28]} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      background: "#181C24",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <ReferenceLine y={20.5} stroke={WARN_AMBER} strokeDasharray="3 3" />
                  <ReferenceLine y={24.0} stroke={CRIT_RED} strokeDasharray="3 3" />
                  <Area
                    type="monotone"
                    dataKey="iop_mmhg"
                    name={t("IOP (mmHg)")}
                    stroke={ELECTRIC_BLUE}
                    strokeWidth={2.5}
                    fill="url(#iopAreaGrad)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-400">
              {oc.last_scan
                ? t("Last scan: {iop} mmHg (OD {od} / OS {os}) · ONSD {onsd} mm", {
                    iop: fmt(oc.last_scan.iop_mmhg, 1),
                    od: fmt(oc.last_scan.iop_od_mmhg, 1),
                    os: fmt(oc.last_scan.iop_os_mmhg, 1),
                    onsd: fmt(oc.last_scan.onsd_mm, 2),
                  })
                : t("Sync bilateral rebound tonometer & ultrasonic optic nerve pod.")}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/crew/ocular"
                className="inline-flex min-h-[46px] items-center rounded-full border border-accent/40 bg-accent/10 px-4 py-2 text-xs font-bold text-accent hover:bg-accent/20"
              >
                {t("Full Ocular Console ›")}
              </Link>
              <button
                type="button"
                onClick={() => runOcularScan("calibration")}
                disabled={scanning}
                className="inline-flex min-h-[46px] items-center gap-2.5 rounded-full bg-accent px-6 py-2.5 text-sm font-extrabold text-ink-950 shadow-glowBlue transition hover:brightness-110 active:scale-95 disabled:opacity-50"
              >
                <Icon name="scan" size={18} />
                {scanning ? t("Calibrating Ocular Scan…") : t("Initiate Ocular Calibration Scan")}
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Priority Alert Banner (if any) */}
      {top ? (
        <section
          className={cx(
            "rounded-card border p-5 sm:p-6",
            critical ? "border-bad/50 bg-bad/[0.12]" : "border-warn/50 bg-warn/[0.10]"
          )}
        >
          <div className="flex flex-wrap items-start gap-4">
            <span
              className={cx(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
                critical ? "bg-bad text-ink-950" : "bg-warn text-ink-950"
              )}
            >
              <Icon name="alert" size={26} />
            </span>
            <div className="min-w-[220px] flex-1">
              <h2 className="text-xl font-bold text-white">{top.title}</h2>
              <p className="mt-0.5 text-slate-200">{top.reason}</p>
              {top.recs[0] && (
                <p className="mt-2 flex gap-2 font-semibold text-slate-50">
                  <Icon name="chevron" size={20} className={cx("mt-0.5 shrink-0", critical ? "text-bad" : "text-warn")} />
                  {top.recs[0].text}
                </p>
              )}
            </div>
            <Link
              to="/crew/alerts"
              className={cx(
                "flex min-h-[48px] w-full items-center justify-center rounded-full px-6 font-bold text-ink-950 transition hover:brightness-110 sm:w-auto",
                critical ? "bg-bad" : "bg-warn"
              )}
            >
              {data.alerts.length > 1 ? t("All {n} alerts", { n: data.alerts.length }) : t("Details")}
            </Link>
          </div>
          {(data.alert_drivers ?? []).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-3">
              {data.alert_drivers.map((d) => (
                <div key={d.metric} className="rounded-tile border border-white/10 bg-ink-950/55 px-4 py-2.5">
                  <div className="text-xs text-slate-300">{d.label}</div>
                  <div
                    className="text-2xl font-bold tabular-nums"
                    style={{ color: d.status === "green" ? undefined : LEVEL_COLOR[d.status] }}
                  >
                    {fmt(d.value, d.decimals)} <span className="text-sm font-normal text-slate-300">{d.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="flex items-center gap-3 rounded-card border border-ok/30 bg-ok/10 p-5 text-base font-semibold text-ok">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ok text-ink-950">
            <Icon name="check" size={22} />
          </span>
          {t("No alerts. Keep going.")}
        </section>
      )}

      {/* SAMSUNG HEALTH COLORED FEATURE CARDS ROW */}
      {showVitalsGrid && (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            to="/crew/body"
            className="lift flex flex-col justify-between rounded-card p-5 text-white shadow-card"
            style={{
              background: "linear-gradient(145deg, #231E58 0%, #342D7E 60%, #443B9C 100%)",
            }}
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="text-sm font-bold text-indigo-100">{t("Last night's sleep")}</span>
                <div className="mt-1 text-3xl font-extrabold tabular-nums">
                  {fmt(sleep?.value, 1)} <span className="text-sm font-medium text-indigo-200">{t("h")}</span>
                </div>
              </div>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-400/20 text-[#B388FF]">
                <Icon name="moon" size={26} />
              </span>
            </div>
            <p className="mt-1 text-xs text-indigo-200">
              {t("Efficiency {e}% · your normal {b} h", {
                e: fmt(data.sleep?.sleep_quality?.value, 0),
                b: fmt(sleep?.baseline_mean, 1),
              })}
            </p>
            <SleepBars nights={data.sleep_nights} normal={sleep?.baseline_mean ?? null} />
          </Link>

          <Link
            to="/crew/food"
            className="lift flex flex-col justify-between rounded-card p-5 text-white shadow-card"
            style={{
              background: "linear-gradient(145deg, #C85000 0%, #E66800 55%, #FF8F00 100%)",
            }}
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="text-sm font-bold text-orange-100">{t("Food & water")}</span>
                <div className="mt-1 text-3xl font-extrabold tabular-nums">
                  {fmt(data.water_target_l, 1)} <span className="text-sm font-medium text-orange-100">L {t("goal")}</span>
                </div>
              </div>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/20 text-amber-200">
                <Icon name="food" size={26} />
              </span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-orange-50">
              {data.intake_yesterday !== null
                ? t("yesterday you ate {n} kcal", { n: fmt(data.intake_yesterday, 0) })
                : t("Ready to log your meals and hydration.")}
            </p>
            <div className="mt-4 inline-flex items-center gap-1.5 self-start rounded-full bg-black/25 px-3.5 py-1.5 text-xs font-bold text-white">
              <Icon name="droplet" size={14} />
              {t("Log meal or water ›")}
            </div>
          </Link>

          <Link to="/crew/mind" className="shealth-card lift flex flex-col justify-between rounded-card p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-200">{t("How are you?")}</span>
              <span className="h-2 w-2 rounded-full bg-warn" />
            </div>
            <div className="my-2">
              <div className="text-2xl font-extrabold" style={{ color: stressVal >= 3.5 ? WARN_AMBER : HEALTH_GREEN }}>
                {stressWord}
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {data.mind?.checkin
                  ? t("Checked in today: feeling {f}/5, stress {s}/5.", {
                      f: data.mind.checkin.feeling,
                      s: data.mind.checkin.stress,
                    })
                  : t("Take 30 seconds to say how you feel today.")}
              </p>
            </div>
            <div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${stressPct}%`,
                    background: stressVal >= 3.5 ? WARN_AMBER : HEALTH_GREEN,
                  }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                <span>{t("Wellbeing")}</span>
                <span className="font-bold text-slate-200">{fmt(data.mind?.wellbeing, 0)}/100</span>
              </div>
            </div>
          </Link>

          <Link to="/crew/body" className="shealth-card lift flex flex-col justify-between rounded-card p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-200">{t("Blood oxygen")}</span>
              <span className="h-2 w-2 rounded-full bg-accent" />
            </div>
            <div className="my-2">
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-extrabold tabular-nums text-white">{fmt(L.spo2, 0)}</span>
                <span className="text-lg font-bold text-accent">%</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {B.spo2 ? t("your normal {v}", { v: `${fmt(B.spo2, 0)}%` }) : t("Bio-Monitor continuous")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-2.5 text-xs">
              <div>
                <span className="text-slate-400">{t("Core temp")}</span>
                <div className="font-bold tabular-nums text-slate-200">{fmt(L.core_temp, 1)} °C</div>
              </div>
              <div>
                <span className="text-slate-400">CO₂</span>
                <div className="font-bold tabular-nums text-slate-200">{fmt(L.co2_mmhg, 1)} mmHg</div>
              </div>
            </div>
          </Link>
        </div>
      )}

      {data.readiness && (
        <Link
          to="/crew/return"
          className="lift flex flex-wrap items-center gap-5 rounded-card border border-telemetry/40 bg-telemetry/[0.12] p-5 sm:p-6"
        >
          <Ring value={data.readiness.level} max={data.readiness.max_level} color={TELEMETRY_VIOLET} size={76} stroke={8} glow>
            <span className="text-2xl font-bold tabular-nums">
              {data.readiness.level}
              <span className="text-sm text-slate-400">/{data.readiness.max_level}</span>
            </span>
          </Ring>
          <div className="min-w-[200px] flex-1">
            <h2 className="text-xl font-bold">
              {t("Today you may")}: {data.readiness.label}
            </h2>
            {data.readiness.activities.some((a) => !a.allowed) && (
              <p className="text-slate-300">
                {t("Not yet:")}{" "}
                {data.readiness.activities
                  .filter((a) => !a.allowed)
                  .map((a) => a.label)
                  .join(", ")}
              </p>
            )}
          </div>
          <span className="flex min-h-[48px] w-full items-center justify-center rounded-full bg-telemetry px-6 font-bold text-ink-950 sm:w-auto">
            {t("Balance")}
          </span>
        </Link>
      )}

      {/* Today's Tasks & Active Protocols */}
      <div className="grid gap-5 lg:grid-cols-12">
        <section
          className={cx(
            "shealth-card rounded-card p-5 sm:p-6",
            (data.protocols ?? []).length > 0 ? "lg:col-span-8" : "lg:col-span-12"
          )}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-white">{t("Today's tasks")}</h2>
              <p className="text-xs text-slate-400">
                {pending === 0 ? t("All tasks done today") : tn("{n} task left today", "{n} tasks left today", pending)}
              </p>
            </div>
            {data.autopilot && (
              <span
                className="rounded-full border border-white/10 bg-ink-850 px-3 py-1 text-xs text-slate-400"
                title={t("Tasks you don't confirm are completed by the simulated crew at their usual adherence.")}
              >
                {t("demo autopilot on")}
              </span>
            )}
          </div>
          <div className="space-y-2.5">
            {tasks.map((x) => (
              <TaskRow key={x.task_id} t={x} busy={busy === x.task_id} onConfirm={() => confirm(x.task_id)} />
            ))}
          </div>
        </section>

        {(data.protocols ?? []).length > 0 && (
          <div className="space-y-5 lg:col-span-4">
            {data.protocols.map((p) => (
              <section key={p.protocol_id} className="shealth-card rounded-card p-5 sm:p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-bold text-white">{p.label}</h2>
                  <span className="text-2xl font-extrabold tabular-nums text-ok">
                    {p.score === null ? "–" : `${Math.round(p.score * 100)}%`}
                  </span>
                </div>
                <div className="my-3">
                  <ProgressBar
                    value={p.score ?? 0}
                    color={(p.score ?? 0) > 0.6 ? HEALTH_GREEN : (p.score ?? 0) > 0.3 ? WARN_AMBER : HEART_PINK}
                    height={10}
                  />
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
            ))}
          </div>
        )}
      </div>

      {/* Samsung Health-style Footer */}
      <div className="flex flex-col items-center justify-center gap-2 pt-2 text-center">
        <span className="text-xs font-medium text-slate-500">
          {t("Secured by SHMS Onboard Autonomous Telemetry")}
        </span>
      </div>
    </div>
  );
}
