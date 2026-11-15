import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { dayLabel, duration, missionTime, usePoll, type Alert, type Clock, type Level } from "../lib/api";
import { useApp } from "../lib/context";
import { LangSwitch, t } from "../lib/i18n";
import { keepForLogin, onCardTap } from "../lib/nfc";
import { ThemeSwitch } from "../lib/theme";
import { Icon } from "./Icon";
import { StatusDot, cx } from "./ui";

/** SHMS mark: a planet with the atmosphere line crossing it. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden className="shrink-0">
      <circle cx="14" cy="14" r="11" className="fill-fg" />
      <path d="M3.6 17.5c4.4-3.6 15.4-6.4 21.2-6.2" fill="none" stroke="#7FC4F5" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="21.6" cy="11.6" r="2" className="fill-ink-900" />
    </svg>
  );
}

export function SimBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/35 bg-warnsoft px-3 py-1 text-xs font-bold text-warn">
      {t("Simulated data")}
    </span>
  );
}

export function LinkPill() {
  const { link } = useApp();
  if (!link) return null;
  const level: Level = link.blackout ? "red" : link.in_flight > 0 && link.delay_s > 5 ? "amber" : "green";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900 px-3 py-1 text-sm" title={t("Ground link (store-and-forward). The app never waits for it.")}>
      <StatusDot level={level} size={10} />
      <span className="text-fg sm:hidden">{t("Ground link")}</span>
      <span className="hidden text-fg sm:inline">{link.profile_label.split(" (")[0]}</span>
      <span className="text-slate-400">{link.blackout ? t("blackout") : duration(link.delay_s)}</span>
      {link.queued + link.in_flight > 0 && <span className="text-slate-400">· {t("{n} pkt", { n: link.queued + link.in_flight })}</span>}
    </span>
  );
}

export function PhaseChip() {
  const { clock } = useApp();
  if (!clock) return null;
  if (clock.phase === "postflight") {
    return <span className="rounded-full bg-rest/10 px-3 py-1 text-sm font-semibold text-rest">{t("Back on Earth · {r}", { r: dayLabel(clock.today) })}</span>;
  }
  if (clock.phase === "preflight") {
    return <span className="rounded-full bg-ink-850 px-3 py-1 text-sm font-semibold text-slate-300">{t("Before launch")}</span>;
  }
  return <span className="hidden rounded-full bg-ink-850 px-3 py-1 text-sm text-slate-300 lg:inline">{t("Landing in {n} days", { n: clock.days_to_landing ?? 0 })}</span>;
}

export function CrewSwitcher() {
  const { meta, crewId, setCrewId } = useApp();
  return (
    <div role="radiogroup" aria-label={t("Crew member (demo switcher)")} className="flex items-center gap-0.5 rounded-full border border-ink-700 bg-ink-900 p-1 pl-3">
      <span className="mr-1 hidden text-sm font-semibold text-slate-400 min-[400px]:inline sm:inline">{t("Astronaut")}</span>
      {meta?.crew.map((c, i) => {
        const active = c.id === crewId;
        return (
          <button key={c.id} role="radio" aria-checked={active} aria-label={c.name} onClick={() => setCrewId(c.id)}
            className={cx("h-[36px] min-w-[36px] rounded-full text-sm font-bold tabular-nums transition-colors",
              active ? "bg-fg text-ink-950" : "text-slate-400 hover:bg-ink-850 hover:text-fg")}
            title={`${c.name} — ${c.role}`}>
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}

/** Where the mission is, 0..1, from the first preflight day to the last day after landing. */
export function missionProgress(clock: Clock | null): number {
  if (!clock) return 0.5;
  const first = Math.min(0, clock.today, -10);
  const last = Math.max(clock.last_day, clock.landing_day + 1);
  return Math.max(0, Math.min(1, (clock.today - first) / (last - first)));
}

/** The atmosphere line under every header; its bright point is the mission's position. */
export function LimbLine() {
  const { clock } = useApp();
  const p = missionProgress(clock);
  return (
    <div className="limb-line" style={{ ["--limb-pos" as string]: `${(4 + p * 92).toFixed(1)}%` }}
      role="img" aria-label={t("Mission progress {p}%", { p: Math.round(p * 100) })} />
  );
}

/** A crew card tapped on any page goes to the card reader screen, which signs that person in. */
function useCardTapSwitch() {
  const navigate = useNavigate();
  useEffect(() => onCardTap((id) => { keepForLogin(id); navigate("/"); }), [navigate]);
}

interface NavItem { to: string; label: string; icon: string; end?: boolean }

function SideNav({ items, footer }: { items: NavItem[]; footer?: React.ReactNode }) {
  return (
    <nav className="sticky top-[67px] hidden h-[calc(100vh-67px)] w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-ink-700 bg-ink-900 px-3 py-4 md:flex">
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end}
          className={({ isActive }) => cx("flex min-h-[46px] items-center gap-3 rounded-full px-4 text-[15px] font-semibold transition-colors duration-150",
            isActive ? "bg-accentsoft text-accent" : "text-slate-400 hover:bg-ink-850 hover:text-fg")}>
          <Icon name={n.icon} className="shrink-0" />{n.label}
        </NavLink>
      ))}
      <div className="mt-auto px-3 pb-1 pt-4 text-xs leading-snug text-slate-500">{footer}</div>
    </nav>
  );
}

function BottomNav({ items }: { items: NavItem[] }) {
  return (
    <nav className="fixed inset-x-3 bottom-3 z-30 flex overflow-x-auto rounded-full border border-ink-700 bg-ink-900/95 px-1.5 py-1 pb-[max(4px,env(safe-area-inset-bottom))] shadow-lift md:hidden">
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end}
          className={({ isActive }) => cx("flex min-h-[54px] min-w-[68px] flex-1 flex-col items-center justify-center rounded-full px-2 text-center text-[11px] font-semibold transition-colors",
            isActive ? "bg-accentsoft text-accent" : "text-slate-400 hover:text-fg")}>
          <Icon name={n.icon} size={20} className="mb-0.5" />{n.label}
        </NavLink>
      ))}
    </nav>
  );
}

function SignOut() {
  return (
    <Link to="/" title={t("Sign out and go back to the card reader")} aria-label={t("Sign out")}
      className="flex min-h-[44px] items-center gap-2 rounded-full border border-ink-700 bg-ink-900 px-4 text-sm font-semibold text-slate-300 transition-colors hover:bg-ink-850 hover:text-fg">
      <Icon name="card" size={18} /><span className="hidden sm:inline">{t("Sign out")}</span>
    </Link>
  );
}

/** Astronaut portal: simple, only what the crew member needs. */
export function CrewLayout() {
  const { meta, crewId, clock } = useApp();
  useCardTapSwitch();
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
      <header className="top-0 z-30 bg-ink-900/95 sm:sticky">
        <div className="flex items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:flex-wrap sm:px-6">
          <Link to="/crew" className="flex items-center gap-2.5 text-lg font-extrabold tracking-tight text-fg">
            <Mark /> <span className="hidden sm:inline">SHMS</span> <span className="hidden text-sm font-normal text-slate-400 2xl:inline">{t("Space Health Management System")}</span>
          </Link>
          <span className="hidden sm:inline-flex"><SimBadge /></span>
          <span className="hidden rounded-full bg-ink-850 px-3 py-1 text-sm font-semibold tabular-nums text-fg sm:inline" title={t("Mission clock (simulated, fast)")}>{missionTime(clock)}</span>
          <PhaseChip />
          <div className="ml-auto flex items-center gap-1.5 sm:flex-wrap sm:gap-2">
            <div className="hidden sm:block"><CrewSwitcher /></div>
            <Link to="/crew/alerts" aria-label={t("{n} alerts", { n: nAlerts })}
              className={cx("flex min-h-[44px] items-center gap-2 rounded-full border px-3 font-semibold transition-colors sm:px-4",
                urgent ? "border-bad/40 bg-badsoft text-bad" : nAlerts ? "border-warn/40 bg-warnsoft text-warn" : "border-ink-700 bg-ink-900 text-slate-300")}>
              {alerts && <StatusDot level={alerts.overall} size={12} />}
              <span className="hidden sm:inline">{t("Alerts")}</span> <span className="tabular-nums">{nAlerts}</span>
            </Link>
            <LangSwitch />
            <ThemeSwitch />
            <SignOut />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 pb-2 sm:hidden"><SimBadge /><CrewSwitcher /></div>
        <LimbLine />
      </header>
      <div className="flex flex-1">
        <SideNav items={nav} footer={meta?.disclaimer} />
        <main className="min-w-0 flex-1 px-4 pb-28 pt-5 sm:px-6 md:pb-10" key={loc.pathname}>
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
  useCardTapSwitch();
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
      <header className="top-0 z-30 bg-ink-900/95 sm:sticky">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link to="/team" className="flex items-center gap-2.5 text-lg font-extrabold tracking-tight text-fg">
            <Mark /> SHMS
            <span className="rounded-full bg-rest/10 px-2.5 py-0.5 text-xs font-bold text-rest">{t("Lab team · Ground")}</span>
          </Link>
          <SimBadge />
          <span className="hidden rounded-full bg-ink-850 px-3 py-1 text-sm font-semibold tabular-nums text-fg sm:inline" title={t("Onboard mission clock")}>{t("Onboard")} {missionTime(clock)}</span>
          <LinkPill />
          {link && link.ground_data_age_s !== null && (link.ground_data_age_s ?? 0) > 30 && (
            <span className="rounded-full border border-warn/35 bg-warnsoft px-3 py-1 text-sm font-semibold text-warn">{t("Ground data {a} old", { a: duration(link.ground_data_age_s) })}</span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {showCrew && <CrewSwitcher />}
            <LangSwitch />
            <ThemeSwitch />
            <SignOut />
          </div>
        </div>
        <LimbLine />
      </header>
      <div className="flex flex-1">
        <SideNav items={nav} footer={<>{t("Everything here comes from the ground copy, which lags the crew by the link delay.")}<br /><br />{meta?.disclaimer}</>} />
        <main className="min-w-0 flex-1 px-4 pb-28 pt-5 sm:px-6 md:pb-10" key={loc.pathname}>
          <Outlet />
        </main>
      </div>
      <BottomNav items={nav} />
    </div>
  );
}
