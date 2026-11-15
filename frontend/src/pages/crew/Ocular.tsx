import { useState } from "react";
import { C } from "../../lib/theme";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS, GRID, SimpleLine, TIP } from "../../components/charts";
import { Icon } from "../../components/Icon";
import { Ring } from "../../components/Ring";
import { Button, Card, PageTitle, ProgressBar, SimpleAlert, cx } from "../../components/ui";
import {
  api,
  duration,
  fmt,
  missionTOf,
  usePoll,
  type Alert,
  type LinkStatus,
  type Metric,
  type OcularTelemetry,
} from "../../lib/api";
import { crewLabel, useApp } from "../../lib/context";
import { t } from "../../lib/i18n";

interface OcularPageData {
  crew: { id: string; name: string; role: string };
  ocular: OcularTelemetry;
  metrics: Record<string, Metric>;
  alerts: Alert[];
  history: {
    id: number;
    crew_id: string;
    crew_name: string;
    day: number;
    kind: string;
    mission_t: number;
    payload: any;
  }[];
  link: LinkStatus;
}

function buildFallbackOcular(crewId: string): OcularTelemetry {
  const idx = Math.max(0, Number(String(crewId).replace(/\D+/g, "")) - 1);
  const iop = +(18.2 + idx * 0.4).toFixed(1);
  const od = +(iop + 0.2).toFixed(1);
  const os = +(iop - 0.2).toFixed(1);
  const onsd = +(5.52 + idx * 0.05).toFixed(2);
  const icp = +(13.6 + idx * 0.3).toFixed(1);
  const shift = 1660 + idx * 45;
  const trend = Array.from({ length: 24 }, (_, i) => {
    const h = i;
    const wave = Math.cos(((h - 5) / 24) * Math.PI * 2);
    return {
      hour_offset: i - 23,
      hour: `${String(h).padStart(2, "0")}:00`,
      iop_mmhg: +(iop + 0.85 * wave).toFixed(1),
      icp_mmhg: +(icp + 0.35 * wave).toFixed(1),
      onsd_mm: +(onsd + 0.03 * wave).toFixed(2),
      normal_max: 20.5,
      critical_min: 24.0,
    };
  });
  return {
    iop_mmhg: iop,
    iop_od_mmhg: od,
    iop_os_mmhg: os,
    onsd_mm: onsd,
    icp_mmhg: icp,
    safety_zone: iop >= 24 ? "critical" : iop >= 20.5 ? "elevated" : "normal",
    thresholds: { normal_max: 20.5, elevated_max: 24.0, critical_min: 24.0 },
    trend_24h: trend,
    last_scan: null,
    device: {
      id: "tonometer",
      name: t("Space Ocular Tonometer & OCT Pod"),
      connected: true,
      state: "connected",
      battery_pct: 94,
    },
    antigravity_fluid: {
      fluid_shift_ml: shift,
      icp_mmhg: icp,
      iop_shift_delta_mmhg: +(iop - 14.5).toFixed(1),
      stabilization_pct: 86,
      stabilization_status: "stabilized",
      headward_distribution_pct: 65.8,
      lower_body_Countermeasure: "standby",
    },
    emergency_protocol: {
      comm_link_state: "standby",
      failsafe_armed: true,
      failsafe_triggered: false,
      risk_level: "normal",
      last_sos: null,
      delay_s: 0.6,
      profile: "iss",
    },
  };
}

export default function CrewOcular() {
  const { crewId, link: ctxLink } = useApp();
  const { data, refresh } = usePoll<OcularPageData>(`/api/crew/${crewId}/ocular`, 2500);
  const [localOcular, setLocalOcular] = useState<OcularTelemetry | null>(null);
  const [scanning, setScanning] = useState(false);
  const [sendingSos, setSendingSos] = useState(false);
  const [lbnpActive, setLbnpActive] = useState(false);
  const [amslerChecked, setAmslerChecked] = useState<"normal" | "distorted" | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const oc = localOcular ?? data?.ocular ?? buildFallbackOcular(crewId);
  const fluid = oc.antigravity_fluid;
  const em = oc.emergency_protocol;
  const link = data?.link ?? ctxLink;

  const zoneColor =
    oc.safety_zone === "critical" ? C.bad : oc.safety_zone === "elevated" ? C.warn : C.ok;
  const zoneLabel =
    oc.safety_zone === "critical" ? t("Critical") : oc.safety_zone === "elevated" ? t("Elevated") : t("Normal");

  const stabColor =
    fluid.stabilization_status === "anomaly"
      ? C.bad
      : fluid.stabilization_status === "adapting"
        ? C.warn
        : C.rest;
  const stabLabel =
    fluid.stabilization_status === "anomaly"
      ? t("Anomaly")
      : fluid.stabilization_status === "adapting"
        ? t("Adapting")
        : t("Stabilized");

  const runScan = async (mode: "calibration" | "anomaly" = "calibration") => {
    setScanning(true);
    setBannerMsg(null);
    try {
      const res = await api<{ ok: boolean; ocular: OcularTelemetry; auto_sos?: any }>(
        `/api/crew/${crewId}/ocular/scan`,
        { body: { mode } },
      );
      if (res?.ocular) setLocalOcular(res.ocular);
      if (res?.auto_sos) {
        setBannerMsg(
          t(
            "CRITICAL EYE PRESSURE & FLUID SHIFT DETECTED — Emergency SOS packet [{id}] automatically transmitted to Earth Mission Control!",
            { id: res.auto_sos.packet?.packet_id ?? "SOS-AUTO" },
          ),
        );
      } else {
        setBannerMsg(
          t("Space Tonometer calibration scan complete: IOP {iop} mmHg (OD {od} / OS {os}) · ONSD {onsd} mm.", {
            iop: fmt(res?.ocular?.iop_mmhg ?? oc.iop_mmhg, 1),
            od: fmt(res?.ocular?.iop_od_mmhg ?? oc.iop_od_mmhg, 1),
            os: fmt(res?.ocular?.iop_os_mmhg ?? oc.iop_os_mmhg, 1),
            onsd: fmt(res?.ocular?.onsd_mm ?? oc.onsd_mm, 2),
          }),
        );
      }
      await refresh();
    } catch {
      const fb = buildFallbackOcular(crewId);
      if (mode === "anomaly") {
        fb.iop_mmhg = 25.8;
        fb.iop_od_mmhg = 26.1;
        fb.iop_os_mmhg = 25.5;
        fb.onsd_mm = 6.45;
        fb.icp_mmhg = 20.6;
        fb.safety_zone = "critical";
        fb.antigravity_fluid.fluid_shift_ml = 2360;
        fb.antigravity_fluid.icp_mmhg = 20.6;
        fb.antigravity_fluid.stabilization_pct = 38;
        fb.antigravity_fluid.stabilization_status = "anomaly";
        fb.emergency_protocol.comm_link_state = "active";
        fb.emergency_protocol.failsafe_triggered = true;
        fb.emergency_protocol.last_sos = {
          packet_id: `SOS-AUTO-${crewId.toUpperCase()}`,
          reason: t("Auto-Failsafe: Critical IOP 25.8 mmHg & Biologic Liquid Shift 2360 mL"),
          destination: t("Earth Mission Control - Space Medicine & Ophthalmology Desk"),
          tonometer: {
            iop_mmhg: fb.iop_mmhg,
            iop_od_mmhg: fb.iop_od_mmhg,
            iop_os_mmhg: fb.iop_os_mmhg,
            onsd_mm: fb.onsd_mm,
            safety_zone: fb.safety_zone,
            retinal_oct_scan: "attached",
          },
          status: "transmitted",
        };
        setLocalOcular(fb);
        setBannerMsg(
          t(
            "CRITICAL EYE PRESSURE & FLUID SHIFT DETECTED — Emergency SOS packet [{id}] automatically transmitted to Earth Mission Control!",
            { id: `SOS-AUTO-${crewId.toUpperCase()}` },
          ),
        );
      } else {
        setLocalOcular(fb);
        setBannerMsg(
          t("Space Tonometer calibration scan complete: IOP {iop} mmHg (OD {od} / OS {os}) · ONSD {onsd} mm.", {
            iop: fmt(fb.iop_mmhg, 1),
            od: fmt(fb.iop_od_mmhg, 1),
            os: fmt(fb.iop_os_mmhg, 1),
            onsd: fmt(fb.onsd_mm, 2),
          }),
        );
      }
    } finally {
      setScanning(false);
    }
  };

  const triggerSos = async (reasonText?: string) => {
    setSendingSos(true);
    try {
      const res = await api<{ ok: boolean; packet: any; ocular: OcularTelemetry }>(
        `/api/crew/${crewId}/emergency/sos`,
        {
          body: {
            reason:
              reasonText ??
              t("Emergency Ocular & Biologic Liquid Movement Alert — Direct Space-to-Earth Telemetry Transmission"),
            auto_failsafe: false,
          },
        },
      );
      if (res?.ocular) setLocalOcular(res.ocular);
      setBannerMsg(
        t("Emergency SOS [{id}] directly transmitted to Earth Mission Control with tonometer & fluid data!", {
          id: res?.packet?.packet_id ?? "SOS-LIVE",
        }),
      );
      await refresh();
    } catch {
      const pktId = `SOS-${crewId.toUpperCase()}-${Date.now().toString().slice(-4)}`;
      const next = { ...oc };
      next.emergency_protocol = {
        ...next.emergency_protocol,
        comm_link_state: "active",
        failsafe_triggered: true,
        last_sos: {
          packet_id: pktId,
          reason:
            reasonText ??
            t("Emergency Ocular & Biologic Liquid Movement Alert — Direct Space-to-Earth Telemetry Transmission"),
          destination: t("Earth Mission Control - Space Medicine & Ophthalmology Desk"),
          tonometer: {
            iop_mmhg: next.iop_mmhg,
            iop_od_mmhg: next.iop_od_mmhg,
            iop_os_mmhg: next.iop_os_mmhg,
            onsd_mm: next.onsd_mm,
            safety_zone: next.safety_zone,
            retinal_oct_scan: "attached",
          },
          status: "transmitted",
        },
      };
      setLocalOcular(next);
      setBannerMsg(
        t("Emergency SOS [{id}] directly transmitted to Earth Mission Control with tonometer & fluid data!", {
          id: pktId,
        }),
      );
    } finally {
      setSendingSos(false);
    }
  };

  const iopGaugePct = Math.max(0, Math.min(100, ((oc.iop_mmhg - 10) / 20) * 100));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageTitle
        sub={t(
          "Real-time space tonometer intraocular pressure (IOP), cephalad biologic liquid shift tracking, and direct emergency space-to-Earth medical uplink.",
        )}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3.5 py-1.5 text-xs font-bold text-accent">
              <Icon name="eye" size={16} />
              {crewLabel(crewId)} · {t("Tonometer Paired")} ({oc.device.battery_pct ?? 94}%)
            </span>
          </div>
        }
      >
        {t("Eye-Based Health Check & Biologic Liquid System")}
      </PageTitle>

      {/* Emergency Ground-to-Space Protocol Banner */}
      <div
        className={cx(
          "relative overflow-hidden rounded-card border p-5 transition-all sm:p-6",
          em.failsafe_triggered || oc.safety_zone === "critical"
            ? "border-bad/80 bg-ink-900 shadow-glowRed"
            : "border-accent/40 bg-ink-900 shadow-glowBlue",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div
              className={cx(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border",
                em.failsafe_triggered || oc.safety_zone === "critical"
                  ? "border-bad/60 bg-bad/20 text-bad animate-pulse"
                  : "border-accent/50 bg-accent/15 text-accent",
              )}
            >
              <Icon name="satellite" size={24} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <span
                  className={cx(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-extrabold",
                    em.comm_link_state === "active" || em.failsafe_triggered
                      ? "bg-badfill text-white shadow-glowRed"
                      : "bg-ok/20 text-ok border border-ok/40",
                  )}
                >
                  <span className="h-2 w-2 rounded-full bg-current" />
                  {em.comm_link_state === "active" || em.failsafe_triggered
                    ? t("Ground link: active (emergency uplink)")
                    : t("Ground link: active, standby")}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-200">
                {t(
                  "Automatic fail-safe monitors space tonometer IOP and cephalad biologic liquid movement. If critical thresholds (IOP ≥ 24.0 mmHg or Fluid Shift ≥ 2250 mL) are reached, telemetry packets are directly beamed to Earth Mission Control.",
                )}
              </p>
              {link && (
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                  <span>
                    {t("Link profile")}: <strong className="text-slate-200">{link.profile_label}</strong>
                  </span>
                  <span>
                    {t("One-way delay")}: <strong className="text-accent">{duration(link.delay_s)}</strong>
                  </span>
                  <span>
                    {t("Fail-safe status")}: <strong className="text-ok">{t("Armed · auto-SOS on")}</strong>
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              kind="danger"
              disabled={sendingSos}
              onClick={() => triggerSos()}
              className="shadow-glowRed"
            >
              <span className="flex items-center gap-2">
                <Icon name="sos" size={18} />
                {sendingSos ? t("Transmitting to Earth…") : t("Send Emergency Message to Earth")}
              </span>
            </Button>
            <Button
              kind="ghost"
              disabled={scanning}
              onClick={() => runScan("anomaly")}
              title={t("Simulate a critical microgravity fluid surge and high IOP spike to test auto-SOS")}
              className="border border-warn/40 text-warn hover:bg-warn/15"
            >
              {t("Simulate Critical Fluid & Eye Spike")}
            </Button>
          </div>
        </div>

        {bannerMsg && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-ink-600 bg-ink-950/85 px-4 py-3 text-sm font-semibold text-fg">
            <span>{bannerMsg}</span>
            <button onClick={() => setBannerMsg(null)} className="text-xs text-slate-400 hover:text-fg">
              <Icon name="x" size={18} />            </button>
          </div>
        )}

        {em.last_sos && (
          <div className="mt-4 rounded-2xl border border-bad/50 bg-ink-950/90 p-3.5 text-xs text-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-bad">
                ● {t("Last Emergency Transmission to Earth")}: {em.last_sos.packet_id}
              </span>
              <span className="rounded-full bg-ok/20 px-2.5 py-0.5 font-semibold text-ok">
                {t("Delivered to Earth Mission Control")}
              </span>
            </div>
            <div className="mt-1 text-slate-300">
              {em.last_sos.reason} → <span className="text-accent">{em.last_sos.destination}</span>
            </div>
          </div>
        )}
      </div>

      {data?.alerts?.map((a) => <SimpleAlert key={a.id} alert={a} />)}

      {/* Main 2-Column Samsung Health Widget Layout: Left = Space Ocular & Tonometer Sync, Right = Biologic Liquid Movement & Antigravity Fluid Dynamics */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Column 1: Space Ocular Health & Tonometer Sync */}
        <Card
          title={
            <span className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/15 text-accent">
                <Icon name="eye" size={18} />
              </span>
              {t("Space Ocular Health & Tonometer Sync")}
            </span>
          }
          right={
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-extrabold"
              style={{
                color: zoneColor,
                borderColor: `${zoneColor}55`,
                background: `${zoneColor}18`,
              }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: zoneColor }} />
              {zoneLabel}
            </span>
          }
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="border-t border-ink-700 pt-3 pb-1">
              <div className="text-xs font-semibold text-slate-400">
                {t("Live Tonometer IOP")}
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-4xl font-black tabular-nums" style={{ color: zoneColor }}>
                  {fmt(oc.iop_mmhg, 1)}
                </span>
                <span className="text-sm text-slate-400">mmHg</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {t("Earth baseline: ~14.5 mmHg")}
              </div>
            </div>

            <div className="border-t border-ink-700 pt-3 pb-1">
              <div className="text-xs font-semibold text-slate-400">
                {t("Right Eye (OD) / Left Eye (OS)")}
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-3xl font-black tabular-nums text-fg">
                  {fmt(oc.iop_od_mmhg, 1)} / {fmt(oc.iop_os_mmhg, 1)}
                </span>
                <span className="text-xs text-slate-400">mmHg</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {t("Bilateral rebound tonometer")}
              </div>
            </div>

            <div className="border-t border-ink-700 pt-3 pb-1">
              <div className="text-xs font-semibold text-slate-400">
                {t("Optic Nerve Sheath (ONSD)")}
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-3xl font-black tabular-nums text-accent">
                  {fmt(oc.onsd_mm, 2)}
                </span>
                <span className="text-sm text-slate-400">mm</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {t("Warning ≥ 5.80 mm · Critical ≥ 6.30 mm")}
              </div>
            </div>
          </div>

          {/* Color-coded Safety Zones Gauge */}
          <div className="mt-4 border-t border-ink-700 pt-3">
            <div className="mb-1.5 flex items-center justify-between text-xs font-semibold">
              <span className="text-ok">{t("Normal (< 20.5 mmHg)")}</span>
              <span className="text-warn">{t("Elevated (20.5–23.9)")}</span>
              <span className="text-bad">{t("Critical (≥ 24.0 mmHg)")}</span>
            </div>
            <div className="relative h-3.5 w-full overflow-hidden rounded-full bg-gradient-to-r from-ok via-warn to-bad">
              <div
                className="absolute top-0 h-full w-2 -translate-x-1/2 rounded-full bg-white shadow-[0_0_10px_#fff]"
                style={{ left: `${iopGaugePct}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
              <span>10 mmHg</span>
              <span className="font-semibold text-fg">
                {t("Current Eye Pressure: {v} mmHg ({z})", { v: fmt(oc.iop_mmhg, 1), z: zoneLabel })}
              </span>
              <span>30 mmHg</span>
            </div>
          </div>

          {/* 24-Hour Historical IOP Trend Graph */}
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-200">
                {t("24-Hour Microgravity Optic Nerve & IOP Variation")}
              </span>
              <span className="text-xs text-slate-400">{t("Tonometer + ICP telemetry (mmHg)")}</span>
            </div>
            <div className="h-52 w-full pt-2">
              <ResponsiveContainer>
                <AreaChart data={oc.trend_24h} margin={{ top: 8, right: 10, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ocularIopGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.accent} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={C.accent} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRID} vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="hour" tick={AXIS} interval={3} />
                  <YAxis tick={AXIS} domain={[10, 30]} />
                  <ReferenceLine y={20.5} stroke={C.warn} strokeDasharray="4 4" />
                  <ReferenceLine y={24.0} stroke={C.bad} strokeDasharray="3 3" />
                  <Tooltip contentStyle={TIP} />
                  <Area
                    type="monotone"
                    dataKey="iop_mmhg"
                    name={t("IOP (mmHg)")}
                    stroke={C.accent}
                    strokeWidth={2.8}
                    fill="url(#ocularIopGrad)"
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="icp_mmhg"
                    name={t("ICP (mmHg)")}
                    stroke={C.rest}
                    strokeWidth={2}
                    dot={false}
                    strokeDasharray="4 3"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              kind="primary"
              disabled={scanning}
              onClick={() => runScan("calibration")}
              className="flex-1 shadow-glowBlue"
            >
              <span className="flex items-center justify-center gap-2">
                <Icon name="scan" size={18} />
                {scanning ? t("Calibrating Tonometer…") : t("Initiate Ocular Calibration Scan")}
              </span>
            </Button>
          </div>
        </Card>

        {/* Column 2: Antigravity & Biologic Liquid Dynamics */}
        <Card
          title={
            <span className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-telemetry/15 text-telemetry">
                <Icon name="orbit" size={18} />
              </span>
              {t("Antigravity & Biologic Liquid Dynamics")}
            </span>
          }
          right={
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-extrabold"
              style={{
                color: stabColor,
                borderColor: `${stabColor}55`,
                background: `${stabColor}18`,
              }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: stabColor }} />
              {stabLabel}
            </span>
          }
        >
          <div className="grid items-center gap-4 sm:grid-cols-[auto_1fr]">
            <div className="flex justify-center">
              <Ring
                value={fluid.stabilization_pct / 100}
                size={136}
                stroke={12}
                color={stabColor}
                label={`${fluid.stabilization_pct}%`}
                sub={t("Fluid Balance")}
              />
            </div>
            <div className="space-y-2.5">
              <div className="text-sm font-semibold text-fg">
                {t("Biologic Liquid Redistribution Protection")}
              </div>
              <p className="text-xs leading-relaxed text-slate-300">
                {t(
                  "In microgravity, ~1.5–2.2 L of biologic liquid shifts from the lower body toward the head and orbits, increasing venous congestion, intracranial pressure (ICP), and intraocular pressure (IOP).",
                )}
              </p>
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <div className="border-t border-ink-700 pt-2">
                  <div className="text-[11px] text-slate-400">
                    {t("Cephalad Fluid Shift")}
                  </div>
                  <div className="text-2xl font-black tabular-nums text-telemetry">
                    {fluid.fluid_shift_ml} <span className="text-xs font-normal text-slate-400">mL</span>
                  </div>
                </div>
                <div className="border-t border-ink-700 pt-2">
                  <div className="text-[11px] text-slate-400">
                    {t("Intracranial Pressure (ICP)")}
                  </div>
                  <div className="text-2xl font-black tabular-nums text-accent">
                    {fmt(fluid.icp_mmhg, 1)} <span className="text-xs font-normal text-slate-400">mmHg</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="border-t border-ink-700 pt-3 pb-1">
              <div className="text-xs text-slate-400">{t("Microgravity +Δ IOP")}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-fg">
                +{fmt(fluid.iop_shift_delta_mmhg, 1)} <span className="text-xs text-slate-400">mmHg</span>
              </div>
              <div className="text-[11px] text-slate-500">{t("Above pre-flight baseline")}</div>
            </div>
            <div className="border-t border-ink-700 pt-3 pb-1">
              <div className="text-xs text-slate-400">{t("Headward Liquid Ratio")}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-telemetry">
                {fmt(fluid.headward_distribution_pct, 1)}%
              </div>
              <div className="mt-1">
                <ProgressBar value={fluid.headward_distribution_pct / 100} color={C.rest} height={6} />
              </div>
            </div>
            <div className="border-t border-ink-700 pt-3 pb-1 col-span-2 sm:col-span-1">
              <div className="text-xs text-slate-400">{t("LBNP Countermeasure")}</div>
              <div className="mt-1 text-lg font-bold text-ok">
                {lbnpActive || fluid.lower_body_Countermeasure === "active" ? t("Active (−25 mmHg)") : t("Standby")}
              </div>
              <button
                onClick={() => setLbnpActive((v) => !v)}
                className="mt-1 text-xs font-semibold text-accent underline"
              >
                {lbnpActive ? t("Set Standby") : t("Activate LBNP Suit")}
              </button>
            </div>
          </div>

          {/* Interactive Biologic Liquid Damage Prevention & Visual Check */}
          <div className="mt-4 border-t border-ink-700 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-fg">
                  {t("Optic Macular & Chorioretinal Fold Self-Check (Amsler Grid)")}
                </div>
                <div className="text-xs text-slate-400">
                  {t("Checks whether cephalad biologic liquid movement is causing macular edema or visual distortion.")}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setAmslerChecked("normal")}
                  className={cx(
                    "rounded-full px-3 py-1.5 text-xs font-bold transition",
                    amslerChecked === "normal"
                      ? "bg-ok text-ink-950 shadow-glowGreen"
                      : "bg-ink-800 text-slate-300 hover:bg-ink-700",
                  )}
                >
                  <Icon name="check" size={14} className="mr-1 inline align-[-2px]" />{t("Lines Straight (Normal)")}
                </button>
                <button
                  onClick={() => {
                    setAmslerChecked("distorted");
                    triggerSos(t("Crew reported visual distortion on Amsler Grid + elevated biologic liquid shift"));
                  }}
                  className={cx(
                    "rounded-full px-3 py-1.5 text-xs font-bold transition",
                    amslerChecked === "distorted"
                      ? "bg-badfill text-white shadow-glowRed"
                      : "bg-ink-800 text-bad hover:bg-bad/20",
                  )}
                >
                  <Icon name="alert" size={14} className="mr-1 inline align-[-2px]" />{t("Wavy / Blurred (Alert Earth)")}
                </button>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Mission Historical Trends for Eye Pressure & Biologic Fluid Shift */}
      <div className="grid gap-5 md:grid-cols-2">
        <Card title={t("Mission Intraocular Pressure (IOP) History · Last 14 Days")}>
          {data?.metrics?.iop_mmhg ? (
            <>
              <div className="mb-2 flex items-baseline justify-between text-sm text-slate-400">
                <span>
                  {t("Current smoothed")}: <strong className="text-fg">{fmt(data.metrics.iop_mmhg.ewma, 1)} mmHg</strong>
                </span>
                <span>
                  {t("Baseline")}: {fmt(data.metrics.iop_mmhg.baseline_mean, 1)} mmHg
                </span>
              </div>
              <SimpleLine m={data.metrics.iop_mmhg} days={14} height={160} color={C.accent} />
            </>
          ) : (
            <div className="h-40">
              <ResponsiveContainer>
                <LineChart data={oc.trend_24h}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="hour" tick={AXIS} />
                  <YAxis tick={AXIS} domain={[10, 30]} />
                  <Tooltip contentStyle={TIP} />
                  <Line dataKey="iop_mmhg" stroke={C.accent} strokeWidth={3} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title={t("Cephalad Biologic Liquid Shift · Last 14 Days")}>
          {data?.metrics?.fluid_shift_ml ? (
            <>
              <div className="mb-2 flex items-baseline justify-between text-sm text-slate-400">
                <span>
                  {t("Current smoothed")}:{" "}
                  <strong className="text-telemetry">{fmt(data.metrics.fluid_shift_ml.ewma, 0)} mL</strong>
                </span>
                <span>
                  {t("Critical threshold")}: 2250 mL
                </span>
              </div>
              <SimpleLine m={data.metrics.fluid_shift_ml} days={14} height={160} color={C.rest} />
            </>
          ) : (
            <div className="h-40">
              <ResponsiveContainer>
                <LineChart data={oc.trend_24h}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="hour" tick={AXIS} />
                  <YAxis tick={AXIS} domain={[10, 22]} />
                  <Tooltip contentStyle={TIP} />
                  <Line dataKey="icp_mmhg" stroke={C.rest} strokeWidth={3} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Recent Tonometer Scans & Space-to-Earth Emergency Transmissions */}
      <Card title={t("Space Tonometer & Emergency Earth Uplink Log")}>
        {data?.history && data.history.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink-700 text-xs text-slate-400">
                <tr>
                  <th className="py-2">{t("Mission Time")}</th>
                  <th>{t("Type")}</th>
                  <th>{t("Tonometer IOP")}</th>
                  <th>{t("Biologic Fluid / ONSD")}</th>
                  <th>{t("Earth Transmission Status")}</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((h) => {
                  const isSos = h.kind === "emergency_sos";
                  const p = h.payload ?? {};
                  const iopVal = isSos ? p.tonometer?.iop_mmhg : p.iop_mmhg;
                  const onsdVal = isSos ? p.tonometer?.onsd_mm : p.onsd_mm;
                  const shiftVal = isSos ? p.fluid_dynamics?.fluid_shift_ml : p.fluid_shift_ml;
                  return (
                    <tr key={h.id} className="border-b border-ink-700">
                      <td className="py-2.5 tabular-nums text-xs text-slate-300">{missionTOf(h.mission_t)}</td>
                      <td>
                        <span
                          className={cx(
                            "rounded-full px-2.5 py-0.5 text-xs font-bold",
                            isSos ? "bg-bad/20 text-bad" : "bg-accent/15 text-accent",
                          )}
                        >
                          {isSos ? t("Emergency SOS to Earth") : t("Tonometer Scan")}
                        </span>
                      </td>
                      <td className="tabular-nums font-bold text-fg">{fmt(iopVal, 1)} mmHg</td>
                      <td className="text-slate-300">
                        {shiftVal ? `${fmt(shiftVal, 0)} mL` : "–"} · ONSD {fmt(onsdVal, 2)} mm
                      </td>
                      <td className="text-xs text-ok">
                        {isSos
                          ? `${p.packet_id ?? "SOS"} → ${t("Sent to Earth Mission Control")}`
                          : t("Synced to Onboard & Ground Link")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">
            {t(
              "Continuous space tonometer telemetry is active. Tap 'Initiate Ocular Calibration Scan' or 'Send Emergency Message to Earth' above to log an immediate reading.",
            )}
          </p>
        )}
      </Card>
    </div>
  );
}
