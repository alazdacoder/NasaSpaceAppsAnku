import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { CrewSwitcher, LinkPill, SimBadge } from "../components/Shell";
import { missionTime } from "../lib/api";
import { useApp, useCrewName } from "../lib/context";
import { LangSwitch, t } from "../lib/i18n";

function PortalCard({
  to,
  icon,
  title,
  who,
  points,
  accent,
  gradient,
  badge,
}: {
  to: string;
  icon: string;
  title: string;
  who: string;
  points: string[];
  accent: string;
  gradient: string;
  badge: string;
}) {
  return (
    <Link
      to={to}
      className="group relative flex flex-col overflow-hidden rounded-card border border-white/[0.08] bg-ink-900/95 p-6 shadow-card backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/20 sm:p-7"
    >
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-br ${gradient} opacity-30 transition-opacity group-hover:opacity-50`} />
      <div className="relative flex items-start justify-between gap-3">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 shadow-lg"
          style={{ background: `${accent}22`, color: accent, boxShadow: `0 0 24px ${accent}33` }}
        >
          <Icon name={icon} size={28} />
        </span>
        <span
          className="rounded-full border px-3 py-1 text-xs font-extrabold uppercase tracking-wider"
          style={{ color: accent, borderColor: `${accent}55`, background: `${accent}18` }}
        >
          {badge}
        </span>
      </div>
      <div className="relative mt-4">
        <h2 className="text-2xl font-extrabold tracking-tight text-white">{title}</h2>
        <p className="mt-0.5 text-sm font-medium text-slate-400">{who}</p>
      </div>
      <ul className="relative mt-5 flex-1 space-y-2.5 text-sm text-slate-200">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2.5">
            <span className="mt-0.5 font-bold" style={{ color: accent }}>
              ●
            </span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <span
        className="relative mt-6 inline-flex min-h-[50px] items-center justify-center rounded-full text-base font-extrabold text-ink-950 transition group-hover:brightness-110"
        style={{ background: accent, boxShadow: `0 0 22px ${accent}44` }}
      >
        {t("Open")} ›
      </span>
    </Link>
  );
}

export default function Portal() {
  const { clock, meta } = useApp();
  const crewName = useCrewName();
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-center gap-3 rounded-full border border-white/[0.07] bg-ink-900/90 px-5 py-3 shadow-card backdrop-blur-xl">
        <span className="flex items-center gap-2 text-xl font-black tracking-tight text-white">
          <span className="inline-block h-3 w-3 rounded-full bg-accent shadow-glowBlue" aria-hidden />
          SHMS
        </span>
        <span className="hidden text-sm font-medium text-slate-300 sm:inline">
          {t("Space Health Management System")}
        </span>
        <SimBadge />
        <span className="rounded-full bg-ink-850 px-3 py-1 font-mono text-xs font-bold text-slate-200">
          {missionTime(clock)}
        </span>
        <LinkPill />
        <div className="ml-auto flex items-center gap-2">
          <LangSwitch />
        </div>
      </header>

      {/* Hero Banner */}
      <div className="relative mt-6 overflow-hidden rounded-card border border-white/[0.08] bg-gradient-to-br from-[#0E2238] via-[#151B28] to-[#211536] p-6 shadow-card sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-accent/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 left-1/3 h-56 w-56 rounded-full bg-telemetry/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-accent">
              <Icon name="eye" size={14} />
              {t("Antigravity Biometrics · Space Ocular Tonometer · Direct Earth SOS")}
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
              {t("Orbital Crew Health & Space Ocular Telemetry Hub")}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-300 sm:text-base">
              {t(
                "Continuous astronaut health monitoring with paired Space Tonometer intraocular pressure (IOP) tracking, microgravity biologic liquid redistribution analysis, and automated emergency space-to-Earth transmission.",
              )}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {t("Active Astronaut Profile")}: <strong className="text-accent">{crewName}</strong>
            </span>
            <CrewSwitcher />
          </div>
        </div>
      </div>

      {/* 3 Portal Modules */}
      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <PortalCard
          to="/crew"
          icon="today"
          accent="#00E5FF"
          gradient="from-[#00E5FF] to-[#0077FF]"
          badge={t("Onboard Tablet")}
          title={t("Astronaut")}
          who={t("Personal Daily Health & Countermeasure Hub")}
          points={[
            t("Samsung Health-style modular dashboard & daily mission tasks"),
            t("Live ARED, T2 & CEVIS workouts with heart rate and kcal"),
            t("Energy score, water & galley nutrition, mood & PVT reaction test"),
            t("Pre-landing training & post-landing gravity re-adaptation"),
          ]}
        />

        <PortalCard
          to="/crew/ocular"
          icon="eye"
          accent="#00E676"
          gradient="from-[#00E676] to-[#00E5FF]"
          badge={t("Tonometer + SOS")}
          title={t("Ocular & Tonometer")}
          who={t("Eye-Based Health Check & Biologic Liquid System")}
          points={[
            t("Live intraocular pressure (IOP mmHg) from paired space tonometer"),
            t("Cephalad biologic liquid movement (mL) & intracranial pressure (ICP)"),
            t("24-hour optic nerve pressure trend & one-tap calibration scan"),
            t("Emergency Ground-to-Space Protocol: direct SOS alert to Earth"),
          ]}
        />

        <PortalCard
          to="/team"
          icon="grid"
          accent="#B388FF"
          gradient="from-[#B388FF] to-[#651FFF]"
          badge={t("Mission Control")}
          title={t("Lab team")}
          who={t("Ground · Flight Surgeons, Ophthalmology & Lab")}
          points={[
            t("All 5 astronauts (Astronaut 1–5), alerts & protocols at a glance"),
            t("Dedicated Ground Ocular & Tonometer Command Matrix"),
            t("Every biomarker with EWMA, baseline ± SD, z-score & 7-day slope"),
            t("Mission simulation controls: Mars delay, link blackout & event injection"),
          ]}
        />
      </div>

      <p className="mt-6 text-center text-xs text-slate-500">{meta?.disclaimer}</p>
    </div>
  );
}
