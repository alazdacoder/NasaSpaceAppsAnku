import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { t } from "../lib/i18n";
import { bootDemo, onBoot, type BootStep } from "./client";

const STEPS: { id: BootStep; label: string }[] = [
  { id: "runtime", label: "Loading Python in your browser" },
  { id: "packages", label: "Loading the health engine" },
  { id: "mission", label: "Starting your simulated mission" },
];

/**
 * Web demo: holds the app until the in-browser backend is up (first visit takes a few
 * seconds while Python downloads; the browser caches it after that).
 */
export function DemoGate({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<BootStep>("runtime");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    bootDemo();
    return onBoot((s, e) => { setStep(s); setError(e); });
  }, []);

  if (step === "ready") return <>{children}</>;

  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm rounded-card border border-ink-700 bg-ink-900 p-6 shadow-card">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}logo.png`} width={36} height={36} alt="" aria-hidden className="rounded" />
          <div>
            <div className="text-lg font-extrabold tracking-tight text-fg">{t("SHMS")}</div>
            <div className="text-sm text-slate-400">{t("Web demo · simulated data")}</div>
          </div>
        </div>
        <div className="limb-line mt-5" style={{ ["--limb-pos" as string]: `${Math.max(8, ((at + 1) / STEPS.length) * 100)}%` }} />
        {step === "failed" ? (
          <div className="mt-5 space-y-3" role="alert">
            <p className="font-semibold text-bad">{t("The demo could not start in this browser.")}</p>
            <p className="break-words text-xs text-slate-400">{error}</p>
            <button type="button" onClick={() => location.reload()}
              className="min-h-[48px] w-full rounded-full bg-accent px-6 font-semibold text-white">
              {t("Try again")}
            </button>
          </div>
        ) : (
          <ol className="mt-5 space-y-2.5" aria-live="polite">
            {STEPS.map((s, i) => (
              <li key={s.id} className={"flex items-center gap-2 " + (i < at ? "text-ok" : i === at ? "font-semibold text-fg" : "text-slate-500")}>
                {i < at ? <Icon name="check" size={16} /> : <span className="w-4 text-center tabular-nums">{i + 1}</span>}
                {t(s.label)}
              </li>
            ))}
          </ol>
        )}
        <p className="mt-5 text-xs leading-relaxed text-slate-400">
          {t("Everything runs on your device: your mission is private and resets when you close the tab. The first visit downloads about 20 MB.")}
        </p>
      </div>
    </div>
  );
}
