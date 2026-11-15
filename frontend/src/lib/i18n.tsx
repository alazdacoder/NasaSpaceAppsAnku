import { Fragment, createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { TR } from "../i18n/tr";

/**
 * English / Turkish.
 *
 * UI text is written in English and wrapped in t("..."). The Turkish dictionary in
 * src/i18n/tr.ts is keyed by that English text; a missing entry falls back to English.
 * Text that comes from the server (alerts, reasons, metric names, tips) is translated
 * by the server: every request carries the X-Lang header.
 */
export type Lang = "en" | "tr";
export const LANGS: { id: Lang; label: string; name: string }[] = [
  { id: "en", label: "EN", name: "English" },
  { id: "tr", label: "TR", name: "Türkçe" },
];

function readLang(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get("lang");   // shareable link: ?lang=tr
    if (q === "en" || q === "tr") {
      try { localStorage.setItem("lang", q); } catch { /* ignore */ }
      return q;
    }
  } catch { /* ignore */ }
  try {
    const v = localStorage.getItem("lang");
    if (v === "en" || v === "tr") return v;
  } catch { /* ignore */ }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
}

let current: Lang = readLang();
const missing = new Set<string>();

export function getLang(): Lang {
  return current;
}

/** Translate UI text. `{name}` placeholders are filled from `p`. */
export function t(s: string, p?: Record<string, string | number | null | undefined>): string {
  let out = s;
  if (current === "tr") {
    const hit = TR[s];
    if (hit === undefined) {
      if (import.meta.env.DEV && !missing.has(s)) {
        missing.add(s);
        console.warn("[i18n] missing Turkish text:", JSON.stringify(s));
      }
    } else {
      out = hit;
    }
  }
  if (p) out = out.replace(/\{(\w+)\}/g, (_, k) => (p[k] !== undefined && p[k] !== null ? String(p[k]) : `{${k}}`));
  return out;
}

/** Plural helper: t1("{n} task left", "{n} tasks left", n). */
export function tn(one: string, many: string, n: number, p?: Record<string, string | number>): string {
  return t(n === 1 ? one : many, { n, ...p });
}

interface LangCtx { lang: Lang; setLang: (l: Lang) => void }
const Ctx = createContext<LangCtx>({ lang: current, setLang: () => undefined });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Lang>(current);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    current = l;
    try { localStorage.setItem("lang", l); } catch { /* ignore */ }
    setState(l);
  }, []);
  // Remount everything below on a language switch: every screen re-renders and re-fetches
  // its data in the new language (server text included).
  return <Ctx.Provider value={{ lang, setLang }}><Fragment key={lang}>{children}</Fragment></Ctx.Provider>;
}

export function useLang(): LangCtx {
  return useContext(Ctx);
}

export function LangSwitch({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <div role="radiogroup" aria-label={t("Language")} className={`flex rounded-full border border-ink-700 bg-ink-900 p-1 ${className}`}>
      {LANGS.map((l) => (
        <button key={l.id} role="radio" aria-checked={lang === l.id} title={l.name} onClick={() => setLang(l.id)}
          className={`min-h-[40px] min-w-[44px] rounded-full px-2 text-sm font-bold transition ${lang === l.id ? "bg-fg text-ink-950" : "text-slate-400 hover:bg-ink-850 hover:text-fg"}`}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
