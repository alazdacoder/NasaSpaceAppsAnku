import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { LinkPill, Mark } from "../components/Shell";
import { cx } from "../components/ui";
import { CARDS, UNKNOWN_DEMO_CARD, lookupCard, normalizeCardId, type CardTarget } from "../lib/cards";
import { useApp } from "../lib/context";
import { LangSwitch, t } from "../lib/i18n";
import { ThemeSwitch } from "../lib/theme";
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
  const { clock, meta, setCrewId } = useApp();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: "standby" });
  const [reader, setReader] = useState<ReaderState>(() => readerState());
  const [simOpen, setSimOpen] = useState(false);
  const timer = useRef<number>();

  const open = (target: CardTarget) => {
    if (target.kind === "crew") {
      setCrewId(target.crewId);
      navigate("/crew");
    } else {
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
    return () => { window.clearInterval(id); window.clearTimeout(timer.current); };
  }, []);

  const welcome = phase.kind === "ok"
    ? phase.target.holder ? t("Welcome, {name}", { name: phase.target.holder.split(" ")[0] })
      : phase.target.kind === "crew" ? t("Welcome, Astronaut {n}", { n: phase.target.n }) : t("Welcome, lab team")
    : "";

  const title = phase.kind === "ok" ? welcome
    : phase.kind === "unknown" ? t("This card is not on the crew list")
    : t("Hold your crew card to the back of the device");
  const sub = phase.kind === "ok"
    ? phase.target.kind === "crew" ? t("Opening your health space…") : t("Opening the lab team view…")
    : phase.kind === "unknown" ? t("Card {id}. Try another card, or sign in below.", { id: phase.id })
    : t("SHMS reads the card and opens your own health space.");

  const status = phase.kind === "ok" ? t("Card confirmed")
    : phase.kind === "unknown" ? t("Unknown card")
    : reader === "ready" ? t("Ready to read a card")
    : reader === "off" ? t("NFC is turned off. Turn it on in the phone's settings.")
    : t("This device has no card reader. Sign in below, or simulate a tap.");

  const day = clock ? (clock.phase === "inflight" ? t("Mission day {d}", { d: clock.today }) : clock.phase === "preflight" ? t("Before launch") : t("Back on Earth")) : "";

  return (
    <div className="relative flex min-h-[100svh] flex-col overflow-hidden login-sky">
      <header className="relative z-10 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:px-8 sm:py-5">
        <span className="flex items-center gap-2.5 text-xl font-extrabold tracking-tight text-fg">
          <Mark size={30} /> SHMS
          <span className="hidden text-sm font-medium text-slate-400 md:inline">{t("Space Health Management System")}</span>
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
            {phase.kind === "standby" && reader !== "off" && (
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

        {/* Manual sign-in: present, quiet. */}
        <div className="absolute inset-x-0 bottom-5 z-10 flex flex-col items-center gap-3 px-4 text-sm text-[#BFD6EC]">
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
            <span>{t("No card?")}</span>
            <span className="text-[#BFD6EC]">{t("Astronaut")}</span>
            {(meta?.crew ?? []).map((c, i) => (
              <button key={c.id} onClick={() => open({ kind: "crew", crewId: c.id, n: i + 1 })} aria-label={c.name}
                className="h-9 min-w-[36px] rounded-full border border-white/25 px-2 font-semibold tabular-nums text-white transition-colors hover:bg-white/10">
                {i + 1}
              </button>
            ))}
            <span aria-hidden className="mx-1 hidden text-[#7F9BB8] sm:inline">·</span>
            <button onClick={() => open({ kind: "team" })}
              className="h-9 rounded-full border border-white/25 px-3 font-semibold text-white transition-colors hover:bg-white/10">
              {t("Lab team")}
            </button>
          </div>

          <div className="relative">
            <button onClick={() => setSimOpen((v) => !v)} aria-expanded={simOpen}
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-[#BFD6EC] underline decoration-white/30 underline-offset-4 hover:text-white">
              <Icon name="nfc" size={14} />{t("Simulate a card tap")}
            </button>
            {simOpen && (
              <div className="absolute bottom-10 left-1/2 max-h-[60vh] w-[340px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-y-auto rounded-tile border border-ink-700 bg-ink-900 p-2 text-left text-fg shadow-lift">
                <p className="px-2 pb-1.5 pt-1 text-xs text-slate-400">{t("Demo cards on this device. Pick one to tap it.")}</p>
                {[...Object.keys(CARDS), UNKNOWN_DEMO_CARD].map((id) => {
                  const target = CARDS[id];
                  const role = !target ? t("not on the list") : target.kind === "crew" ? t("Astronaut {n}", { n: target.n }) : t("Lab team");
                  const who = target?.holder ? `${target.holder} · ${role}` : role;
                  return (
                    <button key={id} onClick={() => { setSimOpen(false); handleTag(id); }}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-ink-850">
                      <span className="font-mono text-[13px]">{id}</span>
                      <span className={cx("text-xs", target ? "text-slate-400" : "text-warn")}>{who}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <p className="max-w-2xl text-center text-xs leading-snug text-[#BFD6EC]">{t("Simulated data")} · {meta?.disclaimer}</p>
        </div>
      </div>
    </div>
  );
}
