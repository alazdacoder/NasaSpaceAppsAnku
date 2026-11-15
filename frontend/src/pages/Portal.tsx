import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { LinkPill, Mark } from "../components/Shell";
import { cx } from "../components/ui";
import { CARDS, UNKNOWN_DEMO_CARD, lookupCard, normalizeCardId, teamMembers, type CardTarget } from "../lib/cards";
import { crewLabel, useApp } from "../lib/context";
import { LangSwitch, t } from "../lib/i18n";
import { ThemeSwitch, useTheme } from "../lib/theme";
import { onCardTap, readerState, type ReaderState } from "../lib/nfc";

type Phase = { kind: "standby" } | { kind: "ok"; target: CardTarget } | { kind: "unknown"; id: string };

const OPEN_DELAY_MS = 1100;

/** The crew card sitting on the limb. */
function CrewCard({ phase }: { phase: Phase }) {
  const ok = phase.kind === "ok";
  const bad = phase.kind === "unknown";
  return (
    <div key={phase.kind === "unknown" ? phase.id : phase.kind}
      className={cx("relative h-[92px] w-[146px] rounded-[14px] bg-white p-3 text-left shadow-[0_18px_36px_-14px_rgba(6,22,40,0.6)]",
        ok && "card-settle", bad && "nudge")}>
      <div className="flex items-center justify-between">
        <span className="block h-[18px] w-[24px] rounded-[4px] bg-sun" />
        <Icon name="nfc" size={18} className="text-[#56708C]" />
      </div>
      <span className="mt-3 block h-2 w-[86px] rounded-full bg-[#0E2A47]" />
      <span className="mt-1.5 block h-1.5 w-[56px] rounded-full bg-[#D5E0EB]" />
      {ok && (
        <span className="check-pop absolute -right-3 -top-3 flex h-9 w-9 items-center justify-center rounded-full bg-ok text-white shadow-glowGreen">
          <Icon name="check" size={20} />
        </span>
      )}
      {bad && (
        <span className="absolute -right-3 -top-3 flex h-9 w-9 items-center justify-center rounded-full bg-warn text-white">
          <Icon name="x" size={18} />
        </span>
      )}
    </div>
  );
}

export default function Portal() {
  const { clock, meta, setCrewId, setUser } = useApp();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: "standby" });
  const [reader, setReader] = useState<ReaderState>(() => readerState());
  const [menuOpen, setMenuOpen] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const timer = useRef<number>();

  const open = (target: CardTarget) => {
    if (target.kind === "crew") {
      setCrewId(target.crewId);
      setUser({ name: target.holder ?? crewLabel(target.crewId), side: "crew" });
      navigate("/crew");
    } else {
      setUser({ name: target.holder ?? t("Lab team"), role: target.role, side: "team" });
      navigate("/team");
    }
  };

  const handleTag = (raw: string) => {
    window.clearTimeout(timer.current);
    const target = lookupCard(raw);
    if (!target) {
      setPhase({ kind: "unknown", id: normalizeCardId(raw) });
      try { navigator.vibrate?.([40, 60, 40]); } catch { /* no haptics */ }
      return;
    }
    setPhase({ kind: "ok", target });
    try { navigator.vibrate?.(35); } catch { /* no haptics */ }
    timer.current = window.setTimeout(() => open(target), OPEN_DELAY_MS);
  };

  const tagRef = useRef(handleTag);
  tagRef.current = handleTag;
  useEffect(() => onCardTap((id) => tagRef.current(id)), []);
  useEffect(() => {
    // The phone's NFC switch can change while the app is open.
    const id = window.setInterval(() => setReader(readerState()), 2000);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { window.clearInterval(id); window.clearTimeout(timer.current); window.removeEventListener("keydown", onKey); };
  }, []);

  const welcome = phase.kind === "ok"
    ? phase.target.holder ? t("Welcome, {name}", { name: phase.target.holder.split(" ")[0] })
      : phase.target.kind === "crew" ? t("Welcome, Astronaut {n}", { n: phase.target.n }) : t("Welcome, lab team")
    : "";

  // Computers (and the web demo) have no card reader: signing in by name is the main way in.
  const noReader = reader === "none" && phase.kind === "standby";

  const title = phase.kind === "ok" ? welcome
    : phase.kind === "unknown" ? t("This card is not on the crew list")
    : noReader ? t("Who is signing in?")
    : t("Hold your crew card to the back of the device");
  const sub = phase.kind === "ok"
    ? phase.target.kind === "crew" ? t("Opening your health space…") : t("Opening the lab team view…")
    : phase.kind === "unknown" ? t("Card {id}. Try another card, or sign in below.", { id: phase.id })
    : noReader ? t("This device has no card reader. Pick your name to open your health space.")
    : t("SHMS reads the card and opens your own health space.");

  const status = phase.kind === "ok" ? t("Card confirmed")
    : phase.kind === "unknown" ? t("Unknown card")
    : reader === "ready" ? t("Ready to read a card")
    : reader === "off" ? t("NFC is turned off. Turn it on in the phone's settings.")
    : t("No card reader on this device");

  const day = clock ? (clock.phase === "inflight" ? t("Mission day {d}", { d: clock.today }) : clock.phase === "preflight" ? t("Before launch") : t("Back on Earth")) : "";

  return (
    <div className="relative flex min-h-[100svh] flex-col overflow-hidden login-sky" data-bar-top={theme === "dark" ? "#040b16" : "#ffffff"} data-bar-bottom="#0e2a47">
      <header className="relative z-10 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:px-8 sm:py-5">
        <span className="flex items-center gap-2.5 text-fg">
          <Mark size={30} />
          <span className="flex flex-col leading-tight sm:flex-row sm:items-baseline sm:gap-2.5">
            <span className="text-xl font-extrabold tracking-tight">{t("SHMS")}</span>
            <span className="text-xs font-medium text-slate-400 sm:text-sm">{t("Space Health Management System")}</span>
          </span>
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          {day && <span className="hidden font-semibold text-slate-300 sm:inline">{day}</span>}
          <LinkPill />
          <LangSwitch />
          <ThemeSwitch />
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-3xl px-5 pt-[5vh] text-center sm:pt-[7vh]" aria-live="polite">
        <h1 className="text-[34px] font-extrabold leading-[1.04] tracking-[-0.03em] text-fg sm:text-[52px] lg:text-[60px]">{title}</h1>
        <p className={cx("mx-auto mt-4 max-w-xl text-[17px] sm:text-xl", phase.kind === "unknown" ? "text-warn" : "text-slate-400")}>{sub}</p>
      </section>

      {/* Earth seen from the cupola: the limb is where the card is read. */}
      <div className="relative min-h-[470px] flex-1">
        <div aria-hidden className="earth absolute left-1/2 top-[150px] h-[2400px] w-[2400px] -translate-x-1/2 rounded-full" />

        <div className="absolute left-1/2 top-[150px] -translate-x-1/2 -translate-y-1/2">
          <div className="relative flex h-[230px] w-[230px] items-center justify-center">
            {phase.kind === "standby" && reader === "ready" && (
              <>
                <span aria-hidden className="read-wave absolute inset-0 rounded-full border-2 border-limb" />
                <span aria-hidden className="read-wave d2 absolute inset-0 rounded-full border-2 border-limb" />
                <span aria-hidden className="read-wave d3 absolute inset-0 rounded-full border-2 border-limb" />
              </>
            )}
            {phase.kind === "ok" && <span aria-hidden className="absolute inset-6 rounded-full border-2 border-[#7BE0AE]" />}
            <CrewCard phase={phase} />
          </div>
        </div>

        <p className="absolute inset-x-0 top-[290px] px-6 text-center text-base font-semibold text-white">
          <span aria-hidden className={cx("mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle",
            phase.kind === "ok" ? "bg-[#7BE0AE]" : phase.kind === "unknown" ? "bg-[#FFC27A]" : reader === "ready" ? "bg-limb orbital-pulse" : "bg-[#9FB2C4]")} />
          {status}
        </p>

        {/* No reader: signing in by name is the way in, so it leads, right under the card. */}
        {noReader && (
          <div className="absolute inset-x-0 top-[336px] z-10 flex flex-col items-center gap-3 px-4 sm:flex-row sm:justify-center">
            <button onClick={() => { setSimOpen(false); setMenuOpen(true); }} aria-haspopup="dialog" aria-expanded={menuOpen}
              className="inline-flex h-14 w-full max-w-xs items-center justify-center gap-2.5 rounded-full bg-white px-7 text-lg font-bold text-[#0E2A47] shadow-lift transition hover:brightness-95 active:scale-[0.97] sm:w-auto">
              <Icon name="user" size={20} />{t("Sign in without a card")}
            </button>
            <button onClick={() => { setSimOpen(true); setMenuOpen(true); }} aria-haspopup="dialog"
              className="inline-flex h-12 w-full max-w-xs items-center justify-center gap-2 rounded-full border border-white/40 px-6 font-semibold text-white transition-colors hover:bg-white/10 sm:w-auto">
              <Icon name="nfc" size={18} />{t("Simulate a card tap")}
            </button>
          </div>
        )}

        {/* With a reader: manual sign-in stays one quiet button; the choices open in a sheet. */}
        <div className="absolute inset-x-0 bottom-5 z-10 flex flex-col items-center gap-3 px-4 text-sm text-[#BFD6EC]">
          {!noReader && (
            <button onClick={() => setMenuOpen(true)} aria-haspopup="dialog" aria-expanded={menuOpen}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-white/25 px-4 font-semibold text-white transition-colors hover:bg-white/10">
              <Icon name="user" size={16} />{t("No card? Sign in another way")}
            </button>
          )}
          <p className="max-w-2xl text-center text-xs leading-snug text-[#BFD6EC]">{t("Simulated data")} · {meta?.disclaimer}</p>
        </div>
      </div>
      {menuOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-[#06121F]/50 sm:items-center" onClick={() => setMenuOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label={t("Sign in without a card")} onClick={(e) => e.stopPropagation()}
            className="max-h-[85svh] w-full max-w-md overflow-y-auto rounded-t-card border border-ink-700 bg-ink-900 p-5 text-fg shadow-lift sm:rounded-card">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">{t("Sign in without a card")}</h2>
              <button onClick={() => setMenuOpen(false)} aria-label={t("Close")}
                className="flex h-10 w-10 items-center justify-center rounded-full text-slate-400 hover:bg-ink-850 hover:text-fg">
                <Icon name="x" size={18} />
              </button>
            </div>

            <h3 className="mt-4 text-sm font-semibold text-slate-400">{t("Astronauts")}</h3>
            <ul className="mt-1 divide-y divide-ink-700 border-y border-ink-700">
              {(meta?.crew ?? []).map((c, i) => (
                <li key={c.id}>
                  <button onClick={() => open({ kind: "crew", crewId: c.id, n: i + 1 })}
                    className="flex min-h-[52px] w-full items-center justify-between gap-3 px-1 text-left hover:bg-ink-850">
                    <span className="font-semibold">{c.name}</span>
                    <span className="flex items-center gap-1 text-sm text-slate-400">{c.role}<Icon name="chevron" size={16} /></span>
                  </button>
                </li>
              ))}
            </ul>

            <h3 className="mt-5 text-sm font-semibold text-slate-400">{t("Lab team")}</h3>
            <ul className="mt-1 divide-y divide-ink-700 border-y border-ink-700">
              {teamMembers().map((m) => (
                <li key={m.holder}>
                  <button onClick={() => open({ kind: "team", holder: m.holder, role: m.role })}
                    className="flex min-h-[52px] w-full items-center justify-between gap-3 px-1 text-left hover:bg-ink-850">
                    <span className="font-semibold">{m.holder}</span>
                    <span className="flex items-center gap-1 text-sm text-slate-400">{m.role ? t(m.role) : t("Scientist")}<Icon name="chevron" size={16} /></span>
                  </button>
                </li>
              ))}
            </ul>

            <button onClick={() => setSimOpen((v) => !v)} aria-expanded={simOpen}
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
              <Icon name="nfc" size={16} />{t("Simulate a card tap")}
            </button>
            {simOpen && (
              <div className="mt-2">
                <p className="pb-1.5 text-xs text-slate-400">{t("Demo cards on this device. Pick one to tap it.")}</p>
                {[...Object.keys(CARDS), UNKNOWN_DEMO_CARD].map((id) => {
                  const target = CARDS[id];
                  const role = !target ? t("not on the list") : target.kind === "crew" ? t("Astronaut {n}", { n: target.n }) : t("Lab team");
                  const who = target?.holder ? `${target.holder} · ${role}` : role;
                  return (
                    <button key={id} onClick={() => { setSimOpen(false); setMenuOpen(false); handleTag(id); }}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-ink-850">
                      <span className="font-mono text-[13px]">{id}</span>
                      <span className={cx("text-right text-xs", target ? "text-slate-400" : "text-warn")}>{who}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
