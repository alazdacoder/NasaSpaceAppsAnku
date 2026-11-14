import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { dayLabel, duration, missionTime, usePoll, type Alert, type Level } from "../lib/api";
import { useApp } from "../lib/context";
import { LangSwitch, t } from "../lib/i18n";
import { Icon } from "./Icon";
import { StatusDot, cx } from "./ui";

export function SimBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-warn/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-warn">
      {t("Simulated data")}
    </span>
  );
}

export function LinkPill() {
  const { link } = useApp();
  if (!link) return null;
  const color = link.blackout ? "#FF5252" : link.in_flight > 0 && link.delay_s > 5 ? "#FF9100" : "#00E676";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-ink-850 px-3 py-1 text-sm" title={t("Ground link (store-and-forward). The app never waits for it.")}>
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
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
    return <span className="rounded-full bg-rest/15 px-3 py-1 text-sm font-semibold text-rest">{t("Back on Earth · {r}", { r: dayLabel(clock.today) })}</span>;
  }
  if (clock.phase === "preflight") {
    return <span className="rounded-full bg-ink-850 px-3 py-1 text-sm font-semibold text-slate-300">{t("Before launch")}</span>;
  }
  return <span className="hidden rounded-full bg-ink-850 px-3 py-1 text-sm text-slate-300 lg:inline">{t("Landing in {n} days", { n: clock.days_to_landing ?? 0 })}</span>;
}

export function CrewSwitcher() {
  const { meta, crewId, setCrewId } = useApp();
  return (
    <div role="radiogroup" aria-label={t("Crew member (demo switcher)")} className="flex flex-wrap items-center gap-1 rounded-full border border-white/[0.07] bg-ink-900/90 p-1 backdrop-blur-md">
      {meta?.crew.map((c) => {
        const active = c.id === crewId;
        return (
          <button key={c.id} role="radio" aria-checked={active} aria-label={c.name} onClick={() => setCrewId(c.id)}
            className={cx("min-h-[38px] rounded-full px-3 text-xs font-semibold tracking-tight tabular-nums transition-all sm:text-sm",
              active ? "bg-accent text-ink-950 shadow-glowBlue font-bold" : "text-slate-300 hover:bg-ink-800 hover:text-white")}
            title={`${c.name} — ${c.role}`}>
            {c.name}
          </button>
        );
      })}
    </div>
  );
}

interface NavItem { to: string; label: string; icon: string; end?: boolean }

function SideNav({ items, footer }: { items: NavItem[]; footer?: React.ReactNode }) {
  return (
    <nav className="sticky top-[68px] hidden h-[calc(100vh-68px)] w-64 shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-white/[0.05] bg-ink-950/80 p-3.5 backdrop-blur-xl md:flex">
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end}
          className={({ isActive }) => cx("group flex min-h-[50px] items-center gap-3.5 rounded-full px-5 text-sm font-semibold transition-all duration-200",
            isActive ? "bg-accent/15 text-accent border border-accent/30 shadow-glowBlue" : "text-slate-400 hover:bg-ink-900 hover:text-slate-100")}>
          <Icon name={n.icon} className="shrink-0" />{n.label}
        </NavLink>
      ))}
      <div className="mt-auto px-4 pb-2 text-xs leading-snug text-slate-500">{footer}</div>
    </nav>
  );
}

function BottomNav({ items }: { items: NavItem[] }) {
  return (
    <nav className="fixed inset-x-3 bottom-3 z-30 flex overflow-x-auto rounded-full border border-white/10 bg-ink-900/90 px-2 py-1 pb-[env(safe-area-inset-bottom)] shadow-[0_12px_36px_rgba(0,0,0,0.85)] backdrop-blur-xl md:hidden">
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end}
          className={({ isActive }) => cx("flex min-h-[54px] min-w-[68px] flex-1 flex-col items-center justify-center rounded-full px-2 text-center text-[11px] font-semibold transition-all",
            isActive ? "bg-white/10 text-accent" : "text-slate-400 hover:text-slate-200")}>
          <Icon name={n.icon} size={20} className="mb-0.5" />{n.label}
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
    { to: "/crew", label: t("Today"), icon: "today", end: true },
    { to: "/crew/ocular", label: t("Ocular & Tonometer"), icon: "eye" },
    { to: "/crew/exercise", label: t("Exercise"), icon: "exercise" },
    { to: "/crew/energy", label: t("Energy"), icon: "energy" },
    { to: "/crew/body", label: t("Body"), icon: "heart" },
    { to: "/crew/food", label: t("Food & water"), icon: "food" },
    { to: "/crew/mind", label: t("Mind"), icon: "mind" },
    { to: "/crew/return", label: clock?.phase === "postflight" ? t("Balance") : t("Return to Earth"), icon: "globe" },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/85 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link to="/crew" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden /> SHMS <span className="hidden text-sm font-normal text-slate-400 xl:inline">{t("Space Health Management System")}</span>
            <span className="hidden rounded-full bg-ink-850 px-2.5 py-0.5 text-xs font-semibold text-slate-300 sm:inline">{t("Astronaut")}</span>
          </Link>
          <SimBadge />
          <span className="rounded-full bg-ink-850 px-3 py-1 text-sm font-semibold tabular-nums text-slate-100" title={t("Mission clock (simulated, fast)")}>{missionTime(clock)}</span>
          <PhaseChip />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <CrewSwitcher />
            <Link to="/crew/alerts" aria-label={t("{n} alerts", { n: nAlerts })}
              className={cx("flex min-h-[44px] items-center gap-2 rounded-full px-4 font-semibold transition-colors",
                urgent ? "bg-bad/15 text-bad hover:bg-bad/25" : nAlerts ? "bg-warn/15 text-warn hover:bg-warn/25" : "bg-ink-850 text-slate-300")}>
              {alerts && <StatusDot level={alerts.overall} size={12} />}
              {t("Alerts")} <span className="tabular-nums">{nAlerts}</span>
            </Link>
            <LangSwitch />
            <Link to="/" title={t("Switch portal")} className="flex min-h-[44px] items-center rounded-full bg-ink-850 px-4 text-sm font-semibold text-slate-300 transition-colors hover:bg-ink-700">
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
    { to: "/team", label: t("Overview"), icon: "grid", end: true },
    { to: "/team/ocular", label: t("Ocular & Tonometer"), icon: "eye" },
    { to: "/team/alerts", label: t("Alerts"), icon: "bell" },
    { to: "/team/vitals", label: t("Vitals & sleep"), icon: "pulse" },
    { to: "/team/exercise", label: t("Exercise & energy"), icon: "exercise" },
    { to: "/team/urine", label: t("Urine lab"), icon: "flask" },
    { to: "/team/nutrition", label: t("Nutrition"), icon: "apple" },
    { to: "/team/mind", label: t("Mental health"), icon: "mind" },
    { to: "/team/vestibular", label: t("Vestibular"), icon: "compass" },
    { to: "/team/lsah", label: t("LSAH tests"), icon: "clipboard" },
    { to: "/team/environment", label: t("Environment"), icon: "radiation" },
    { to: "/team/devices", label: t("Devices"), icon: "chip" },
    { to: "/team/sources", label: t("Data sources"), icon: "info" },
  ];
  const showCrew = loc.pathname !== "/team" && !loc.pathname.startsWith("/team/sources");
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/85 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link to="/team" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <span className="h-2.5 w-2.5 rounded-full bg-rest" aria-hidden /> SHMS <span className="hidden text-sm font-normal text-slate-400 xl:inline">{t("Space Health Management System")}</span>
            <span className="rounded-full bg-rest/15 px-2.5 py-0.5 text-xs font-semibold text-rest">{t("Lab team · Ground")}</span>
          </Link>
          <SimBadge />
          <span className="rounded-full bg-ink-850 px-3 py-1 text-sm font-semibold tabular-nums text-slate-100" title={t("Onboard mission clock")}>{t("Onboard")} {missionTime(clock)}</span>
          <LinkPill />
          {link && link.ground_data_age_s !== null && (link.ground_data_age_s ?? 0) > 30 && (
            <span className="rounded-full bg-warn/15 px-3 py-1 text-sm font-semibold text-warn">{t("Ground data {a} old", { a: duration(link.ground_data_age_s) })}</span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {showCrew && <CrewSwitcher />}
            <LangSwitch />
            <Link to="/crew" className="flex min-h-[44px] items-center rounded-full bg-ink-850 px-4 text-sm font-semibold text-slate-300 transition-colors hover:bg-ink-700">
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
