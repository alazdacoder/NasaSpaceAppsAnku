import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { dayLabel, duration, missionTime, usePoll, type Alert, type Level } from "../lib/api";
import { useApp } from "../lib/context";
import { LangSwitch, t } from "../lib/i18n";
import { StatusDot, cx } from "./ui";

export function SimBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border-2 border-warn bg-warn/10 px-2 py-0.5 text-xs font-extrabold uppercase tracking-wider text-warn">
      {t("Simulated data")}
    </span>
  );
}

export function LinkPill() {
  const { link } = useApp();
  if (!link) return null;
  const color = link.blackout ? "#f43f5e" : link.in_flight > 0 && link.delay_s > 5 ? "#fbbf24" : "#22c55e";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-ink-600 bg-ink-850 px-3 py-1 text-sm" title={t("Ground link (store-and-forward). The app never waits for it.")}>
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span className="hidden sm:inline">{link.profile_label.split(" (")[0]}</span>
      <span className="text-slate-400">{link.blackout ? t("blackout") : duration(link.delay_s)}</span>
      {link.queued + link.in_flight > 0 && <span className="text-slate-400">· {t("{n} pkt", { n: link.queued + link.in_flight })}</span>}
    </span>
  );
}

export function PhaseChip() {
  const { clock } = useApp();
  if (!clock) return null;
  if (clock.phase === "postflight") {
    return <span className="rounded-full bg-violet-500/15 px-3 py-1 text-sm font-semibold text-violet-300">{t("Back on Earth · {r}", { r: dayLabel(clock.today) })}</span>;
  }
  if (clock.phase === "preflight") {
    return <span className="rounded-full bg-ink-800 px-3 py-1 text-sm font-semibold text-slate-300">{t("Before launch")}</span>;
  }
  return <span className="hidden rounded-full bg-ink-800 px-3 py-1 text-sm text-slate-300 lg:inline">{t("Landing in {n} days", { n: clock.days_to_landing ?? 0 })}</span>;
}

export function CrewSwitcher({ compact }: { compact?: boolean }) {
  const { meta, crewId, setCrewId } = useApp();
  return (
    <div role="radiogroup" aria-label={t("Crew member (demo switcher)")} className="flex flex-wrap gap-1 rounded-xl border border-ink-700 bg-ink-900 p-1">
      {meta?.crew.map((c) => (
        <button key={c.id} role="radio" aria-checked={c.id === crewId} onClick={() => setCrewId(c.id)}
          className={cx("min-h-[44px] rounded-lg px-3 text-sm font-semibold transition",
            c.id === crewId ? "bg-accent text-ink-950" : "text-slate-300 hover:bg-ink-700")}
          title={`${c.name} — ${c.role}`}>
          {compact ? c.name.split(" ")[0] : c.name.split(" ")[0]}
        </button>
      ))}
    </div>
  );
}

interface NavItem { to: string; label: string; icon: string; end?: boolean }

function SideNav({ items, footer }: { items: NavItem[]; footer?: React.ReactNode }) {
  return (
    <nav className="sticky top-[73px] hidden h-[calc(100vh-73px)] w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-ink-800 p-3 md:flex">
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end}
          className={({ isActive }) => cx("flex min-h-[52px] items-center gap-3 rounded-xl px-4 text-base font-semibold transition",
            isActive ? "bg-ink-800 text-white ring-1 ring-accent/50" : "text-slate-400 hover:bg-ink-900 hover:text-slate-100")}>
          <span className="w-5 text-center text-accent">{n.icon}</span>{n.label}
        </NavLink>
      ))}
      <div className="mt-auto rounded-xl border border-ink-800 p-3 text-xs leading-snug text-slate-500">{footer}</div>
    </nav>
  );
}

function BottomNav({ items }: { items: NavItem[] }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-ink-700 bg-ink-950/95 pb-[env(safe-area-inset-bottom)] md:hidden">
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end}
          className={({ isActive }) => cx("flex min-h-[60px] min-w-[76px] flex-1 flex-col items-center justify-center px-1 text-center text-xs font-semibold",
            isActive ? "text-accent" : "text-slate-400")}>
          <span className="text-lg">{n.icon}</span>{n.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** Astronaut portal: simple, only what the crew member needs. */
export function CrewLayout() {
  const { meta, crewId, clock } = useApp();
  const { data: alerts } = usePoll<{ overall: Level; alerts: Alert[] }>(`/api/crew/${crewId}/alerts`, 3000);
  const loc = useLocation();
  const nAlerts = alerts?.alerts.length ?? 0;
  const urgent = alerts?.alerts.filter((a) => a.level === "red").length ?? 0;
  const nav: NavItem[] = [
    { to: "/crew", label: t("Today"), icon: "◉", end: true },
    { to: "/crew/exercise", label: t("Exercise"), icon: "⚡" },
    { to: "/crew/energy", label: t("Energy"), icon: "✦" },
    { to: "/crew/body", label: t("Body"), icon: "♥" },
    { to: "/crew/food", label: t("Food & water"), icon: "◍" },
    { to: "/crew/mind", label: t("Mind"), icon: "✿" },
    { to: "/crew/return", label: clock?.phase === "postflight" ? t("Balance") : t("Return to Earth"), icon: "⊕" },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-ink-700 bg-ink-950/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link to="/crew" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <span className="text-accent">◎</span> {t("Crew Health Hub")}
            <span className="hidden rounded-md bg-ink-800 px-2 py-0.5 text-xs font-semibold text-slate-300 sm:inline">{t("Astronaut")}</span>
          </Link>
          <SimBadge />
          <span className="font-mono text-base text-slate-200 tabular-nums" title={t("Mission clock (simulated, fast)")}>{missionTime(clock)}</span>
          <PhaseChip />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <CrewSwitcher />
            <Link to="/crew/alerts" aria-label={t("{n} alerts", { n: nAlerts })}
              className={cx("flex min-h-[48px] items-center gap-2 rounded-xl border px-4 font-semibold",
                urgent ? "border-bad bg-bad/15 text-bad" : nAlerts ? "border-warn/60 bg-warn/10 text-warn" : "border-ink-600 text-slate-300")}>
              {alerts && <StatusDot level={alerts.overall} size={12} />}
              {t("Alerts")} <span className="tabular-nums">{nAlerts}</span>
            </Link>
            <LangSwitch />
            <Link to="/" title={t("Switch portal")} className="flex min-h-[48px] items-center rounded-xl border border-ink-600 px-3 text-sm font-semibold text-slate-300 hover:bg-ink-800">
              {t("Portals")}
            </Link>
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <SideNav items={nav} footer={meta?.disclaimer} />
        <main className="min-w-0 flex-1 px-4 pb-28 pt-4 sm:px-6 md:pb-10" key={loc.pathname}>
          <Outlet />
        </main>
      </div>
      <BottomNav items={nav} />
    </div>
  );
}

/** Lab-team (ground) portal: every detail, from the link-delayed ground copy. */
export function TeamLayout() {
  const { meta, clock, link } = useApp();
  const loc = useLocation();
  const nav: NavItem[] = [
    { to: "/team", label: t("Overview"), icon: "▦", end: true },
    { to: "/team/alerts", label: t("Alerts"), icon: "!" },
    { to: "/team/vitals", label: t("Vitals & sleep"), icon: "♥" },
    { to: "/team/exercise", label: t("Exercise & energy"), icon: "⚡" },
    { to: "/team/urine", label: t("Urine lab"), icon: "⚗" },
    { to: "/team/nutrition", label: t("Nutrition"), icon: "◍" },
    { to: "/team/mind", label: t("Mental health"), icon: "✿" },
    { to: "/team/vestibular", label: t("Vestibular"), icon: "⊕" },
    { to: "/team/environment", label: t("Environment"), icon: "☢" },
    { to: "/team/devices", label: t("Devices"), icon: "⌁" },
    { to: "/team/sources", label: t("Data sources"), icon: "ⓘ" },
  ];
  const showCrew = loc.pathname !== "/team" && !loc.pathname.startsWith("/team/sources");
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-ink-700 bg-ink-950/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link to="/team" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <span className="text-violet-400">◎</span> {t("Crew Health Hub")}
            <span className="rounded-md bg-violet-500/15 px-2 py-0.5 text-xs font-semibold text-violet-300">{t("Lab team · Ground")}</span>
          </Link>
          <SimBadge />
          <span className="font-mono text-sm text-slate-300 tabular-nums" title={t("Onboard mission clock")}>{t("Onboard")} {missionTime(clock)}</span>
          <LinkPill />
          {link && link.ground_data_age_s !== null && (link.ground_data_age_s ?? 0) > 30 && (
            <span className="rounded-full bg-warn/15 px-3 py-1 text-sm font-semibold text-warn">{t("Ground data {a} old", { a: duration(link.ground_data_age_s) })}</span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {showCrew && <CrewSwitcher />}
            <LangSwitch />
            <Link to="/crew" className="flex min-h-[48px] items-center rounded-xl border border-ink-600 px-4 text-sm font-semibold text-slate-300 hover:bg-ink-800">
              {t("Astronaut portal ›")}
            </Link>
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <SideNav items={nav} footer={<>{t("Everything here comes from the ground copy, which lags the crew by the link delay.")}<br /><br />{meta?.disclaimer}</>} />
        <main className="min-w-0 flex-1 px-4 pb-28 pt-4 sm:px-6 md:pb-10" key={loc.pathname}>
          <Outlet />
        </main>
      </div>
      <BottomNav items={nav} />
    </div>
  );
}
