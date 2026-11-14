import { NavLink, Link, Outlet, useLocation } from "react-router-dom";
import { duration, missionTime, usePoll, type Alert, type Level } from "../lib/api";
import { useApp } from "../lib/context";
import { StatusDot, cx } from "./ui";

const NAV = [
  { to: "/", label: "Today", icon: "◉" },
  { to: "/exercise", label: "Exercise", icon: "⚡" },
  { to: "/body", label: "Body", icon: "♥" },
  { to: "/nutrition", label: "Nutrition", icon: "◍" },
  { to: "/lab", label: "Lab", icon: "⚗" },
  { to: "/environment", label: "Environment", icon: "☢" },
  { to: "/devices", label: "Devices", icon: "⌁" },
  { to: "/sources", label: "Data sources", icon: "ⓘ" },
];

export function SimBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border-2 border-warn bg-warn/10 px-2 py-0.5 text-xs font-extrabold uppercase tracking-wider text-warn">
      Simulated data
    </span>
  );
}

export function LinkPill() {
  const { link } = useApp();
  if (!link) return null;
  const color = link.blackout ? "#f43f5e" : link.in_flight > 0 && link.delay_s > 5 ? "#fbbf24" : "#22c55e";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-ink-600 bg-ink-850 px-3 py-1 text-sm" title="Ground link (store-and-forward). The app never waits for it.">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span className="hidden sm:inline">{link.profile_label.split(" (")[0]}</span>
      <span className="text-slate-400">{link.blackout ? "blackout" : link.delay_s >= 60 ? duration(link.delay_s) : `${link.delay_s} s`}</span>
      {link.queued + link.in_flight > 0 && <span className="text-slate-400">· {link.queued + link.in_flight} pkt</span>}
    </span>
  );
}

export default function Layout() {
  const { meta, crewId, setCrewId, clock } = useApp();
  const { data: alerts } = usePoll<{ overall: Level; alerts: Alert[] }>(`/api/crew/${crewId}/alerts`, 3000);
  const loc = useLocation();
  const nAlerts = alerts?.alerts.length ?? 0;
  const urgent = alerts?.alerts.filter((a) => a.level === "red").length ?? 0;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-ink-700 bg-ink-950/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <span className="text-accent">◎</span> Crew Health Hub
          </Link>
          <SimBadge />
          <span className="font-mono text-base text-slate-200 tabular-nums" title="Mission clock (simulated, fast)">{missionTime(clock)}</span>
          <LinkPill />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Crew member (demo switcher)" className="flex flex-wrap gap-1 rounded-xl border border-ink-700 bg-ink-900 p-1">
              {meta?.crew.map((c) => (
                <button key={c.id} role="radio" aria-checked={c.id === crewId} onClick={() => setCrewId(c.id)}
                  className={cx("min-h-[44px] rounded-lg px-3 text-sm font-semibold transition",
                    c.id === crewId ? "bg-accent text-ink-950" : "text-slate-300 hover:bg-ink-700")}
                  title={`${c.name} — ${c.role}`}>
                  {c.name.split(" ")[0]}
                </button>
              ))}
            </div>
            <Link to="/alerts" aria-label={`${nAlerts} alerts`}
              className={cx("flex min-h-[48px] items-center gap-2 rounded-xl border px-4 font-semibold",
                urgent ? "border-bad bg-bad/15 text-bad" : nAlerts ? "border-warn/60 bg-warn/10 text-warn" : "border-ink-600 text-slate-300")}>
              {alerts && <StatusDot level={alerts.overall} size={12} />}
              Alerts <span className="tabular-nums">{nAlerts}</span>
            </Link>
            <Link to="/surgeon" className="flex min-h-[48px] items-center rounded-xl border border-ink-600 px-4 text-sm font-semibold text-slate-300 hover:bg-ink-800">
              Surgeon view
            </Link>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <nav className="sticky top-[73px] hidden h-[calc(100vh-73px)] w-52 shrink-0 flex-col gap-1 border-r border-ink-800 p-3 md:flex">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"}
              className={({ isActive }) => cx("flex min-h-[52px] items-center gap-3 rounded-xl px-4 text-base font-semibold transition",
                isActive ? "bg-ink-800 text-white ring-1 ring-accent/50" : "text-slate-400 hover:bg-ink-900 hover:text-slate-100")}>
              <span className="w-5 text-center text-accent">{n.icon}</span>{n.label}
            </NavLink>
          ))}
          <div className="mt-auto rounded-xl border border-ink-800 p-3 text-xs leading-snug text-slate-500">
            {meta?.disclaimer}
          </div>
        </nav>
        <main className="min-w-0 flex-1 px-4 pb-28 pt-4 sm:px-6 md:pb-10" key={loc.pathname}>
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-ink-700 bg-ink-950/95 pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"}
            className={({ isActive }) => cx("flex min-h-[60px] min-w-[76px] flex-1 flex-col items-center justify-center text-xs font-semibold",
              isActive ? "text-accent" : "text-slate-400")}>
            <span className="text-lg">{n.icon}</span>{n.label.split(" ")[0]}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
