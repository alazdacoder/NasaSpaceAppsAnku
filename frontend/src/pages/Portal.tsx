import { Link } from "react-router-dom";
import { SimBadge } from "../components/Shell";
import { missionTime } from "../lib/api";
import { useApp } from "../lib/context";
import { LangSwitch, t } from "../lib/i18n";

function PortalCard({ to, icon, title, who, points, accent }: { to: string; icon: string; title: string; who: string; points: string[]; accent: string }) {
  return (
    <Link to={to} className="group flex flex-col rounded-3xl border-2 border-ink-700 bg-ink-900 p-6 transition hover:border-accent/70 hover:bg-ink-850 sm:p-8">
      <div className="flex items-center gap-4">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl text-4xl" style={{ background: `${accent}22`, color: accent }}>{icon}</span>
        <div>
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-slate-400">{who}</p>
        </div>
      </div>
      <ul className="mt-5 flex-1 space-y-2 text-slate-300">
        {points.map((p) => <li key={p} className="flex gap-2"><span style={{ color: accent }}>✓</span><span>{p}</span></li>)}
      </ul>
      <span className="mt-6 inline-flex min-h-[52px] items-center justify-center rounded-xl text-lg font-bold text-ink-950 transition group-hover:brightness-110" style={{ background: accent }}>
        {t("Open")} ›
      </span>
    </Link>
  );
}

export default function Portal() {
  const { clock, meta } = useApp();
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6 sm:py-10">
      <header className="flex flex-wrap items-center gap-3">
        <span className="text-2xl font-bold"><span className="text-accent">◎</span> {t("Crew Health Hub")}</span>
        <SimBadge />
        <span className="font-mono text-slate-400">{missionTime(clock)}</span>
        <LangSwitch className="ml-auto" />
      </header>
      <p className="mt-4 max-w-3xl text-lg text-slate-300">
        {t("A personal health hub for astronauts. It works onboard without the ground and syncs when a link is available. Choose who you are:")}
      </p>
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <PortalCard to="/crew" icon="◉" accent="#38bdf8" title={t("Astronaut")} who={t("Onboard tablet · simple")}
          points={[t("Today's tasks with one tap"), t("Live workout with heart rate and calories"), t("Energy burned during your day"),
            t("Mood check-in and a reaction test"), t("Return to Earth: balance and what you may do")]} />
        <PortalCard to="/team" icon="▦" accent="#a78bfa" title={t("Lab team")} who={t("Ground · flight surgeons, lab and psychology")}
          points={[t("All crew, alerts and protocols at a glance"), t("Every metric with baseline, z-score, slope and rules"),
            t("Urine chemistry, energy, mental health and vestibular detail"), t("Data arrives through the delayed ground link"),
            t("Demo panel: mission profile, clock, events, landing")]} />
      </div>
      <p className="mt-6 text-sm text-slate-500">{meta?.disclaimer}</p>
    </div>
  );
}
