import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { LEVEL_COLOR } from "./api";
import { t } from "./i18n";

export type Theme = "light" | "dark";

const KEY = "shms-theme";

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Colours that charts and SVGs need as plain values (they can't read CSS variables). */
const PALETTES: Record<Theme, { axis: string; grid: string; tipBg: string; tipBorder: string; tipText: string; tipShadow: string;
  ok: string; warn: string; bad: string; accent: string; muted: string; track: string }> = {
  light: { axis: "#56708C", grid: "#E6EDF4", tipBg: "#FFFFFF", tipBorder: "#D5E0EB", tipText: "#0E2A47", tipShadow: "0 10px 28px -14px rgba(14,42,71,0.35)",
    ok: "#17834F", warn: "#B45F00", bad: "#C62F45", accent: "#2F7FD8", muted: "#7B90A6", track: "#E6EDF4" },
  dark: { axis: "#869EBA", grid: "#1C3150", tipBg: "#0E1D32", tipBorder: "#243C5E", tipText: "#E8F0F8", tipShadow: "0 12px 30px -14px rgba(0,0,0,0.8)",
    ok: "#40C482", warn: "#ECA848", bad: "#EE5A6E", accent: "#549CEC", muted: "#869EBA", track: "#192E4C" },
};

let current: Theme = stored() ?? systemTheme();
const listeners = new Set<() => void>();

/** Named colours for inline styles and SVG; each read returns the current theme's value. */
const NAMED: Record<Theme, Record<string, string>> = {
  light: { ok: "#17834F", warn: "#B45F00", bad: "#C62F45", accent: "#2F7FD8", fg: "#0E2A47", muted: "#4A6582", faint: "#7B90A6", rest: "#2C5A8A", energy: "#A36A12", grid: "#E6EDF4", line: "#D5E0EB" },
  dark: { ok: "#40C482", warn: "#ECA848", bad: "#EE5A6E", accent: "#549CEC", fg: "#E8F0F8", muted: "#9AB1CA", faint: "#869EBA", rest: "#80AADE", energy: "#E2A450", grid: "#1C3150", line: "#243C5E" },
};
export const C = {
  get ok() { return NAMED[current].ok; }, get warn() { return NAMED[current].warn; }, get bad() { return NAMED[current].bad; },
  get accent() { return NAMED[current].accent; }, get fg() { return NAMED[current].fg; }, get muted() { return NAMED[current].muted; },
  get faint() { return NAMED[current].faint; }, get rest() { return NAMED[current].rest; }, get energy() { return NAMED[current].energy; },
  get grid() { return NAMED[current].grid; }, get line() { return NAMED[current].line; },
};

export function themePalette() {
  return PALETTES[current];
}

function apply(theme: Theme) {
  current = theme;
  const p = PALETTES[theme];
  Object.assign(LEVEL_COLOR, { green: p.ok, amber: p.warn, red: p.bad });
  document.documentElement.dataset.theme = theme;
  listeners.forEach((l) => l());
}

// Set the theme before the first render, so there is no flash.
if (typeof document !== "undefined") apply(current);

export function onThemeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const ThemeCtx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: current, setTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(current);
  useEffect(() => {
    // Follow the system until the person picks a theme themselves.
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onSys = () => { if (!stored()) { apply(systemTheme()); setThemeState(current); } };
    mq?.addEventListener?.("change", onSys);
    return () => mq?.removeEventListener?.("change", onSys);
  }, []);
  const setTheme = (next: Theme) => {
    try { localStorage.setItem(KEY, next); } catch { /* private mode: still switch for this visit */ }
    apply(next);
    setThemeState(next);
  };
  // Remount below on change, so charts pick up the new palette.
  return <ThemeCtx.Provider value={{ theme, setTheme }}><div key={theme} className="contents">{children}</div></ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}

/** Light / dark switch: one round button showing what it switches to. */
export function ThemeSwitch({ onDark = false }: { onDark?: boolean }) {
  const { theme, setTheme } = useTheme();
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? t("Switch to dark mode") : t("Switch to light mode");
  return (
    <button type="button" onClick={() => setTheme(next)} aria-label={label} title={label}
      className={onDark
        ? "flex h-[44px] w-[44px] items-center justify-center rounded-full border border-white/25 text-white transition-colors hover:bg-white/10"
        : "flex h-[44px] w-[44px] items-center justify-center rounded-full border border-ink-700 bg-ink-900 text-slate-300 transition-colors hover:bg-ink-850 hover:text-fg"}>
      <Icon name={next === "dark" ? "moon" : "today"} size={19} />
    </button>
  );
}
