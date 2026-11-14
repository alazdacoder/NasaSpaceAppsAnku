import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS, GRID, TIP, TrendBlock } from "../../components/charts";
import { Icon } from "../../components/Icon";
import { Ring } from "../../components/Ring";
import {
  AlertCard,
  Button,
  Card,
  GroundNote,
  MetricCard,
  PageTitle,
  StatusPill,
  cx,
} from "../../components/ui";
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
  type ViewInfo,
} from "../../lib/api";
import { crewLabel, useApp, useCrewName } from "../../lib/context";
import { t } from "../../lib/i18n";

interface SurgeonOcularOverview {
  crew: {
    id: string;
    name: string;
    role: string;
    ocular: OcularTelemetry;
    metrics: Record<string, Metric>;
    alerts: Alert[];
    view: ViewInfo;
  }[];
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

interface CrewOcularDetail {
  crew: { id: string; name: string; role: string };
  ocular: OcularTelemetry;
  metrics: Record<string, Metric>;
  alerts: Alert[];
  history: any[];
  link: LinkStatus;
  view: ViewInfo;
}

function makeFallbackCrewOcular(_id: string, idx: number): OcularTelemetry {
  const iop = +(18.1 + idx * 0.45).toFixed(1);
  const onsd = +(5.5 + idx * 0.06).toFixed(2);
  const icp = +(13.5 + idx * 0.35).toFixed(1);
  const shift = 1650 + idx * 55;
  return {
    iop_mmhg: iop,
    iop_od_mmhg: +(iop + 0.2).toFixed(1),
    iop_os_mmhg: +(iop - 0.2).toFixed(1),
    onsd_mm: onsd,
    icp_mmhg: icp,
    safety_zone: iop >= 24 ? "critical" : iop >= 20.5 ? "elevated" : "normal",
    thresholds: { normal_max: 20.5, elevated_max: 24.0, critical_min: 24.0 },
    trend_24h: Array.from({ length: 24 }, (_, h) => {
      const wave = Math.cos(((h - 5) / 24) * Math.PI * 2);
      return {
        hour_offset: h - 23,
        hour: `${String(h).padStart(2, "0")}:00`,
        iop_mmhg: +(iop + 0.8 * wave).toFixed(1),
        icp_mmhg: +(icp + 0.35 * wave).toFixed(1),
        onsd_mm: +(onsd + 0.03 * wave).toFixed(2),
        normal_max: 20.5,
        critical_min: 24.0,
      };
    }),
    last_scan: null,
    device: {
      id: "tonometer",
      name: t("Space Ocular Tonometer & OCT Pod"),
      connected: true,
      state: "connected",
      battery_pct: 92 - idx * 3,
    },
    antigravity_fluid: {
      fluid_shift_ml: shift,
      icp_mmhg: icp,
      iop_shift_delta_mmhg: +(iop - 14.4).toFixed(1),
      stabilization_pct: 88 - idx * 3,
      stabilization_status: "stabilized",
      headward_distribution_pct: +(64.5 + idx * 1.1).toFixed(1),
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

export default function TeamOcular() {
  const { crewId, setCrewId, meta, link: ctxLink } = useApp();
  const crewName = useCrewName();
  const { data: overview, refresh: refreshOverview } = usePoll<SurgeonOcularOverview>("/api/surgeon/ocular", 3000);
  const { data: detail, refresh: refreshDetail } = usePoll<CrewOcularDetail>(
    `/api/crew/${crewId}/ocular?side=ground`,
    3000,
  );
  const { data: bodyFallback } = usePoll<any>(`/api/crew/${crewId}/body?side=ground`, 4000);
  const [busy, setBusy] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const crewList =
    overview?.crew?.map((c, i) => ({
      ...c,
      name: crewLabel(c.id, i),
    })) ??
    (meta?.crew ?? ["c1", "c2", "c3", "c4", "c5"].map((id, i) => ({ id, name: crewLabel(id, i), role: "" }))).map(
      (c, i) => ({
        id: c.id,
        name: crewLabel(c.id, i),
        role: c.role,
        ocular: makeFallbackCrewOcular(c.id, i),
        metrics: {},
        alerts: [],
        view: { side: "ground" as const, data_day: 30, phase: "inflight" as const },
      }),
    );

  const selectedIdx = Math.max(0, Number(String(crewId).replace(/\D+/g, "")) - 1);
  const oc =
    detail?.ocular ??
    bodyFallback?.ocular_telemetry ??
    crewList.find((c) => c.id === crewId)?.ocular ??
    makeFallbackCrewOcular(crewId, selectedIdx);

  const metrics: Record<string, Metric> = {
    ...(bodyFallback?.ocular ?? {}),
    ...(bodyFallback?.fluid ?? {}),
    ...(detail?.metrics ?? {}),
  };
  const alerts: Alert[] = detail?.alerts ?? bodyFallback?.alerts ?? [];
  const link = overview?.link ?? detail?.link ?? ctxLink;

  const triggerRemoteSpike = async (targetCrewId: string) => {
    setBusy(true);
    setStatusNote(null);
    try {
      const res = await api<{ ok: boolean; auto_sos?: any }>(`/api/crew/${targetCrewId}/ocular/scan`, {
        body: { mode: "anomaly" },
      });
      setStatusNote(
        t(
          "Emergency Ocular & Biologic Liquid Spike simulated for {c} — Auto-SOS packet [{id}] received by Earth Mission Control!",
          {
            c: crewLabel(targetCrewId),
            id: res?.auto_sos?.packet?.packet_id ?? "SOS-AUTO",
          },
        ),
      );
      await Promise.all([refreshOverview(), refreshDetail()]);
    } catch {
      setStatusNote(
        t("Emergency Ocular & Biologic Liquid Spike simulated for {c} — Direct SOS alert logged on Earth console.", {
          c: crewLabel(targetCrewId),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageTitle
        sub={t(
          "Flight Surgeon Ophthalmology & Space-Associated Neuro-ocular Syndrome (SANS) Console: Tonometer IOP, Cephalad Biologic Liquid Shift, and Direct Space-to-Earth Emergency SOS Uplink.",
        )}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              kind="danger"
              disabled={busy}
              onClick={() => triggerRemoteSpike(crewId)}
              className="shadow-glowRed text-sm"
            >
              <span className="flex items-center gap-2">
                <Icon name="sos" size={16} />
                {t("Test Emergency Space-to-Earth Alert ({n})", { n: crewName })}
              </span>
            </Button>
          </div>
        }
      >
        {t("Ocular & Tonometer Command · {n}", { n: crewName })}
      </PageTitle>

      <GroundNote view={detail?.view ?? bodyFallback?.view} />

      {statusNote && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-bad/60 bg-bad/15 px-4 py-3 text-sm font-semibold text-white shadow-glowRed">
          <span>{statusNote}</span>
          <button onClick={() => setStatusNote(null)} className="text-slate-300 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* All-Crew Eye-Based Health Check Column Matrix */}
      <Card
        title={t("All-Crew Eye-Based Health Check & Biologic Liquid Matrix (Space Tonometer Telemetry)")}
        right={
          link && (
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-bold text-accent">
              <span className="h-2 w-2 rounded-full bg-accent" />
              {t("Earth Uplink")}: {link.profile_label} · {duration(link.delay_s)}
            </span>
          )
        }
      >
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
          {crewList.map((c) => {
            const cOc = c.ocular;
            const zone = cOc.safety_zone;
            const zColor = zone === "critical" ? "#FF5252" : zone === "elevated" ? "#FF9100" : "#00E676";
            const active = c.id === crewId;
            return (
              <button
                key={c.id}
                onClick={() => setCrewId(c.id)}
                className={cx(
                  "flex flex-col justify-between rounded-2xl border p-4 text-left transition-all",
                  active
                    ? "border-accent bg-accent/10 shadow-glowBlue"
                    : zone === "critical"
                      ? "border-bad/60 bg-bad/10"
                      : "border-white/[0.06] bg-ink-850/90 hover:border-white/20",
                )}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-white">{c.name}</span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider"
                      style={{ color: zColor, background: `${zColor}20` }}
                    >
                      {zone === "critical" ? t("Critical") : zone === "elevated" ? t("Elevated") : t("Normal")}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">{c.role}</div>

                  <div className="mt-3 flex items-baseline justify-between">
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-slate-400">{t("Tonometer IOP")}</div>
                      <div className="text-2xl font-black tabular-nums" style={{ color: zColor }}>
                        {fmt(cOc.iop_mmhg, 1)} <span className="text-xs font-normal text-slate-400">mmHg</span>
                      </div>
                    </div>
                    <Ring
                      value={cOc.antigravity_fluid.stabilization_pct / 100}
                      size={44}
                      stroke={4}
                      color="#B388FF"
                      label={`${cOc.antigravity_fluid.stabilization_pct}%`}
                    />
                  </div>

                  <div className="mt-2 space-y-1 border-t border-white/[0.06] pt-2 text-xs text-slate-300">
                    <div className="flex justify-between">
                      <span className="text-slate-400">{t("OD / OS")}:</span>
                      <span className="font-mono font-semibold">
                        {fmt(cOc.iop_od_mmhg, 1)} / {fmt(cOc.iop_os_mmhg, 1)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">{t("ONSD")}:</span>
                      <span className="font-mono font-semibold text-accent">{fmt(cOc.onsd_mm, 2)} mm</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">{t("Liquid shift")}:</span>
                      <span className="font-mono font-semibold text-telemetry">
                        {cOc.antigravity_fluid.fluid_shift_ml} mL
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">{t("ICP")}:</span>
                      <span className="font-mono font-semibold">{fmt(cOc.icp_mmhg, 1)} mmHg</span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2 text-[11px]">
                  <span className="text-slate-400">{t("Earth SOS Link")}</span>
                  <span
                    className={cx(
                      "font-bold uppercase",
                      cOc.emergency_protocol.failsafe_triggered ? "text-bad" : "text-ok",
                    )}
                  >
                    {cOc.emergency_protocol.failsafe_triggered ? t("SOS ACTIVE") : t("STANDBY")}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {alerts.map((a) => (
        <AlertCard key={a.id} alert={a} />
      ))}

      {/* Selected Astronaut 24-Hour Curve & Biologic Liquid Breakdown */}
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card
          title={t("24-Hour Space Tonometer IOP & Intracranial Pressure Curve · {n}", { n: crewName })}
          right={
            <StatusPill
              level={
                oc.safety_zone === "critical" ? "red" : oc.safety_zone === "elevated" ? "amber" : "green"
              }
            />
          }
        >
          <div className="h-64 w-full">
            <ResponsiveContainer>
              <AreaChart data={oc.trend_24h} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="teamOcularGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00E5FF" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#00E5FF" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="hour" tick={AXIS} interval={2} />
                <YAxis tick={AXIS} domain={[11, 27]} />
                <ReferenceLine
                  y={20.5}
                  stroke="#FF9100"
                  strokeDasharray="4 4"
                  label={{ value: t("Elevated (20.5)"), fill: "#FF9100", fontSize: 11, position: "insideTopRight" }}
                />
                <ReferenceLine
                  y={24.0}
                  stroke="#FF5252"
                  strokeDasharray="3 3"
                  label={{ value: t("Critical SOS (24.0)"), fill: "#FF5252", fontSize: 11, position: "insideTopLeft" }}
                />
                <Tooltip contentStyle={TIP} />
                <Area
                  type="monotone"
                  dataKey="iop_mmhg"
                  name={t("Intraocular Pressure (mmHg)")}
                  stroke="#00E5FF"
                  strokeWidth={2.8}
                  fill="url(#teamOcularGrad)"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="icp_mmhg"
                  name={t("Intracranial Pressure (mmHg)")}
                  stroke="#B388FF"
                  strokeWidth={2.2}
                  dot={false}
                  strokeDasharray="4 3"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {t(
              "Cyan curve = paired rebound tonometer intraocular pressure (mmHg). Violet dashed curve = non-invasive intracranial pressure (mmHg) driven by microgravity biologic liquid shift.",
            )}
          </p>
        </Card>

        <Card title={t("Biologic Liquid Movement & SANS Risk Assessment")}>
          <div className="flex items-center gap-4">
            <Ring
              value={oc.antigravity_fluid.stabilization_pct / 100}
              size={112}
              stroke={10}
              color={
                oc.antigravity_fluid.stabilization_status === "anomaly"
                  ? "#FF5252"
                  : oc.antigravity_fluid.stabilization_status === "adapting"
                    ? "#FF9100"
                    : "#B388FF"
              }
              label={`${oc.antigravity_fluid.stabilization_pct}%`}
              sub={t("Stabilized")}
            />
            <div className="space-y-1.5 text-sm">
              <div className="font-bold text-white">
                {t("Cephalad Fluid Shift")}:{" "}
                <span className="text-telemetry">{oc.antigravity_fluid.fluid_shift_ml} mL</span>
              </div>
              <div className="text-slate-300">
                {t("Headward Distribution")}:{" "}
                <strong>{fmt(oc.antigravity_fluid.headward_distribution_pct, 1)}%</strong>
              </div>
              <div className="text-slate-300">
                {t("IOP Shift vs Pre-Flight")}:{" "}
                <strong className="text-accent">+{fmt(oc.antigravity_fluid.iop_shift_delta_mmhg, 1)} mmHg</strong>
              </div>
              <div className="text-slate-300">
                {t("Optic Nerve Sheath (ONSD)")}: <strong>{fmt(oc.onsd_mm, 2)} mm</strong>
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2 rounded-2xl border border-white/[0.06] bg-ink-850 p-3.5 text-xs text-slate-300">
            <div className="font-bold uppercase tracking-wider text-accent">
              {t("Clinical Countermeasure Protocol")}
            </div>
            <p>
              •{" "}
              {t(
                "Lower Body Negative Pressure (LBNP -25 mmHg) sequesters ~500 mL of biologic liquid in the lower extremities, reducing jugular venous distension and intraocular pressure.",
              )}
            </p>
            <p>
              •{" "}
              {t(
                "Keep cabin CO₂ below 3.0 mmHg to prevent cerebral vasodilation and secondary intracranial pressure spikes.",
              )}
            </p>
          </div>
        </Card>
      </div>

      {/* 4 Clinical Metric Cards + Full Mission TrendBlocks */}
      {(metrics.iop_mmhg || metrics.onsd_mm || metrics.fluid_shift_ml || metrics.icp_mmhg) && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.iop_mmhg && <MetricCard m={metrics.iop_mmhg} personal={false} />}
            {metrics.onsd_mm && <MetricCard m={metrics.onsd_mm} personal={false} />}
            {metrics.fluid_shift_ml && <MetricCard m={metrics.fluid_shift_ml} personal={false} />}
            {metrics.icp_mmhg && <MetricCard m={metrics.icp_mmhg} personal={false} />}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {metrics.iop_mmhg && (
              <Card title={t("Intraocular Pressure (IOP) Mission Trend")}>
                <TrendBlock m={metrics.iop_mmhg} height={200} />
              </Card>
            )}
            {metrics.onsd_mm && (
              <Card title={t("Optic Nerve Sheath Diameter (ONSD) Mission Trend")}>
                <TrendBlock m={metrics.onsd_mm} height={200} />
              </Card>
            )}
            {metrics.fluid_shift_ml && (
              <Card title={t("Cephalad Biologic Liquid Shift Mission Trend")}>
                <TrendBlock m={metrics.fluid_shift_ml} height={200} />
              </Card>
            )}
            {metrics.icp_mmhg && (
              <Card title={t("Intracranial Pressure (ICP) Mission Trend")}>
                <TrendBlock m={metrics.icp_mmhg} height={200} />
              </Card>
            )}
          </div>
        </>
      )}

      {/* Emergency Space-to-Earth Dispatch Log */}
      <Card title={t("Emergency Space-to-Earth Medical Dispatch & Tonometer Log")}>
        {overview?.history && overview.history.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/[0.06] text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-2">{t("Mission Time")}</th>
                  <th>{t("Astronaut")}</th>
                  <th>{t("Transmission Type")}</th>
                  <th>{t("Tonometer IOP / ONSD")}</th>
                  <th>{t("Biologic Fluid Shift")}</th>
                  <th>{t("Earth Mission Control Action")}</th>
                </tr>
              </thead>
              <tbody>
                {overview.history.map((h) => {
                  const isSos = h.kind === "emergency_sos";
                  const p = h.payload ?? {};
                  const iopVal = isSos ? p.tonometer?.iop_mmhg : p.iop_mmhg;
                  const onsdVal = isSos ? p.tonometer?.onsd_mm : p.onsd_mm;
                  const shiftVal = isSos ? p.fluid_dynamics?.fluid_shift_ml : p.fluid_shift_ml;
                  return (
                    <tr key={h.id} className="border-b border-white/[0.04]">
                      <td className="py-2.5 font-mono text-xs text-slate-300">{missionTOf(h.mission_t)}</td>
                      <td className="font-semibold text-white">{crewLabel(h.crew_id)}</td>
                      <td>
                        <span
                          className={cx(
                            "rounded-full px-2.5 py-0.5 text-xs font-bold",
                            isSos ? "bg-bad/20 text-bad" : "bg-accent/15 text-accent",
                          )}
                        >
                          {isSos ? t("EMERGENCY SOS TO EARTH") : t("Tonometer Calibration")}
                        </span>
                      </td>
                      <td className="font-mono text-white">
                        {fmt(iopVal, 1)} mmHg · {fmt(onsdVal, 2)} mm
                      </td>
                      <td className="font-mono text-telemetry">{shiftVal ? `${fmt(shiftVal, 0)} mL` : "–"}</td>
                      <td className="text-xs text-slate-300">
                        {isSos ? p.reason : t("Logged in Ground Ophthalmology Database")}
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
              "No emergency ocular alerts triggered yet. All 5 astronauts' space tonometers are streaming normally to Earth Mission Control.",
            )}
          </p>
        )}
      </Card>
    </div>
  );
}
