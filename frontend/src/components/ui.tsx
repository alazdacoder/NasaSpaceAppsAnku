import type { ReactNode } from "react";
import { LEVEL_COLOR, dayLabel, duration, fmt, levelText, type Alert, type Level, type Metric, type ViewInfo } from "../lib/api";
import { t } from "../lib/i18n";
import { Sparkline } from "./charts";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ children, className, title, right }: { children: ReactNode; className?: string; title?: ReactNode; right?: ReactNode }) {
  return (
    <section className={cx("rounded-2xl border border-ink-700 bg-ink-900 p-4 sm:p-5", className)}>
      {(title || right) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-lg font-semibold text-slate-100">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageTitle({ children, sub, right }: { children: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold">{children}</h1>
        {sub && <p className="mt-1 text-slate-400">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function StatusDot({ level, size = 14 }: { level: Level; size?: number }) {
  return (
    <span
      aria-label={levelText(level)}
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: LEVEL_COLOR[level], boxShadow: `0 0 0 3px ${LEVEL_COLOR[level]}33` }}
    />
  );
}

export function StatusPill({ level, text }: { level: Level; text?: string }) {
  const cls = { green: "bg-ok/15 text-ok border-ok/40", amber: "bg-warn/15 text-warn border-warn/40", red: "bg-bad/15 text-bad border-bad/50" }[level];
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-sm font-semibold", cls)}>
      <StatusDot level={level} size={10} />
      {text ?? levelText(level)}
    </span>
  );
}

export function Unverified({ source, className }: { source?: string; className?: string }) {
  return (
    <span
      title={source ? t("Not checked against a NASA source. Source: {s}", { s: t(source) }) : t("Not checked against a NASA source")}
      className={cx("inline-flex items-center rounded border border-dashed border-warn/70 px-1.5 py-0 text-[11px] font-semibold uppercase tracking-wide text-warn", className)}
    >
      {t("unverified")}
    </span>
  );
}

export function SourceTag({ verified, source }: { verified: boolean; source?: string }) {
  if (!verified) return <Unverified source={source} />;
  return (
    <span title={source} className="inline-flex items-center rounded border border-ok/40 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-ok">
      {t("verified")}
    </span>
  );
}

export function Button({ children, onClick, kind = "primary", className, disabled, title, type = "button" }: {
  children: ReactNode; onClick?: () => void; kind?: "primary" | "ghost" | "danger" | "ok"; className?: string;
  disabled?: boolean; title?: string; type?: "button" | "submit";
}) {
  const k = {
    primary: "bg-accent text-ink-950 hover:bg-sky-300",
    ok: "bg-ok text-ink-950 hover:bg-green-400",
    danger: "bg-bad text-white hover:bg-rose-400",
    ghost: "border border-ink-600 bg-ink-800 text-slate-100 hover:bg-ink-700",
  }[kind];
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx("min-h-[48px] rounded-xl px-5 py-2 text-base font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40", k, className)}
    >
      {children}
    </button>
  );
}

export function ProgressBar({ value, color = "#38bdf8", height = 10, marker }: { value: number; color?: string; height?: number; marker?: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative w-full overflow-hidden rounded-full bg-ink-700" style={{ height }}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${v * 100}%`, background: color }} />
      {marker !== undefined && (
        <div className="absolute top-0 h-full w-0.5 bg-white/80" style={{ left: `${Math.max(0, Math.min(1, marker)) * 100}%` }} />
      )}
    </div>
  );
}

export function AlertCard({ alert, compact }: { alert: Alert; compact?: boolean }) {
  const border = { green: "border-ok/40", amber: "border-warn/60", red: "border-bad/70" }[alert.level];
  const bg = { green: "bg-ok/5", amber: "bg-warn/5", red: "bg-bad/10" }[alert.level];
  return (
    <div className={cx("rounded-xl border-l-4 border p-4", border, bg)}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusDot level={alert.level} />
        <span className="text-lg font-semibold">{alert.title}</span>
        {alert.kind === "cross" && <span className="rounded bg-accent/15 px-2 text-xs font-semibold text-accent">{t("cross-source")}</span>}
        {!alert.verified && <Unverified source={alert.source} />}
      </div>
      <p className="mt-1 text-slate-300"><span className="font-semibold text-slate-200">{t("Why:")} </span>{alert.reason}</p>
      {!compact && alert.recs.length > 0 && (
        <ul className="mt-2 space-y-1">
          {alert.recs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-2 text-slate-100">
              <span className="mt-1 text-accent">→</span>
              <span className="flex-1">{r.text}</span>
              {!r.verified && <Unverified source={r.source} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Astronaut view: one plain sentence and the first thing to do. */
export function SimpleAlert({ alert }: { alert: Alert }) {
  const border = { green: "border-ok/40", amber: "border-warn/60", red: "border-bad/70" }[alert.level];
  return (
    <div className={cx("rounded-xl border-l-4 border bg-ink-850 p-4", border)}>
      <div className="flex items-center gap-2 text-lg font-semibold"><StatusDot level={alert.level} />{alert.title}</div>
      <p className="mt-1 text-slate-300">{alert.reason}</p>
      {alert.recs[0] && <p className="mt-1 font-semibold text-accent">→ {alert.recs[0].text}</p>}
    </div>
  );
}

function baselineText(m: Metric, personal: boolean): string {
  if (m.baseline_mean === null || m.baseline_mean === undefined) return t("No preflight baseline (cumulative or weekly value)");
  const sd = m.baseline_sd ? ` ± ${fmt(m.baseline_sd, m.decimals)}` : "";
  return `${personal ? t("Your baseline") : t("Baseline")} ${fmt(m.baseline_mean, m.decimals)}${sd} ${m.unit}`.trim();
}

export function MetricCard({ m, showChart = true, big, personal = true }: { m: Metric; showChart?: boolean; big?: boolean; personal?: boolean }) {
  const val = m.ewma ?? m.value;
  return (
    <div className={cx("rounded-xl border bg-ink-850 p-4",
      m.status === "red" ? "border-bad/60" : m.status === "amber" ? "border-warn/50" : "border-ink-700")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-300">
            {m.label}
            {!m.verified && m.has_rules && <Unverified source={m.thresholds.find((x) => !x.verified)?.source ?? m.estimate_note ?? undefined} />}
            {m.estimate_note && <Unverified source={m.estimate_note} />}
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className={cx("font-bold tabular-nums", big ? "text-4xl" : "text-3xl")}>{fmt(val, m.decimals)}</span>
            <span className="text-slate-400">{m.unit}</span>
          </div>
        </div>
        {m.has_rules ? <StatusDot level={m.status} /> : null}
      </div>
      <div className="mt-1 text-sm text-slate-400">
        {baselineText(m, personal)}
        {m.pct !== null && m.pct !== undefined && Math.abs(m.pct) >= 1 && (m.baseline_mean ?? 0) > 0 && (
          <span className={cx("ml-2 font-semibold", Math.abs(m.pct) > 20 ? "text-warn" : "text-slate-300")}>
            {m.pct > 0 ? "+" : ""}{fmt(m.pct, 0)}%
          </span>
        )}
        {m.anomaly && <span className="ml-2 rounded bg-bad/20 px-1.5 text-xs font-bold text-bad">{t("anomaly")}</span>}
      </div>
      {showChart && m.points.length > 1 && (
        <div className="mt-2"><Sparkline points={m.points} baseline={m.baseline_mean} status={m.status} /></div>
      )}
      <p className="mt-2 text-sm leading-snug text-slate-300">{m.meaning}</p>
      {m.triggered?.length > 0 && (
        <p className="mt-1 text-sm font-medium" style={{ color: m.status === "red" ? "#fb7185" : "#fcd34d" }}>{m.triggered[0].reason}</p>
      )}
      <div className="mt-1 text-xs text-slate-500">
        {t("smoothed (EWMA) · last raw {v} · 7-day slope {s}/day", { v: fmt(m.value, m.decimals), s: fmt(m.slope, Math.max(1, m.decimals)) })}
        {m.day !== undefined && m.day !== null && <> · {dayLabel(m.day)}</>}
      </div>
    </div>
  );
}

/** Astronaut view of a number: big value, plain status word, baseline and meaning. No statistics. */
export function SimpleMetric({ m, value, unit, label }: { m?: Metric; value?: number | null; unit?: string; label?: string }) {
  if (!m) return null;
  const v = value !== undefined ? value : m.ewma ?? m.value;
  const word = !m.has_rules ? null : m.status === "green" ? t("Normal") : m.status === "amber" ? t("Watch") : t("Act now");
  return (
    <div className={cx("rounded-2xl border bg-ink-850 p-4", m.status === "red" ? "border-bad/60" : m.status === "amber" ? "border-warn/50" : "border-ink-700")}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-base font-semibold text-slate-200">{label ?? m.label}</div>
        {word && <span className={cx("rounded-full px-2.5 py-0.5 text-sm font-bold",
          m.status === "green" ? "bg-ok/15 text-ok" : m.status === "amber" ? "bg-warn/15 text-warn" : "bg-bad/15 text-bad")}>{word}</span>}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-4xl font-bold tabular-nums">{fmt(v, m.decimals)}</span>
        <span className="text-lg text-slate-400">{unit ?? m.unit}</span>
      </div>
      {m.baseline_mean !== null && m.baseline_mean !== undefined && (
        <div className="text-sm text-slate-400">{t("Your normal: {v} {u}", { v: fmt(m.baseline_mean, m.decimals), u: unit ?? m.unit })}</div>
      )}
      <p className="mt-2 text-sm leading-snug text-slate-300">{m.meaning}</p>
    </div>
  );
}

export function Empty({ text }: { text?: string }) {
  return <div className="flex min-h-[30vh] items-center justify-center text-slate-400">{text ?? t("Loading…")}</div>;
}

export function Stat({ label, value, unit, sub, color }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; color?: string }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-3xl font-bold tabular-nums" style={color ? { color } : undefined}>{value}</span>
        {unit && <span className="text-slate-400">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-sm text-slate-400">{sub}</div>}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, size = "md" }: {
  value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void; size?: "sm" | "md";
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-ink-700 bg-ink-900 p-1">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} aria-pressed={value === o.id}
          className={cx("rounded-lg px-3 font-semibold transition", size === "sm" ? "min-h-[36px] text-sm" : "min-h-[44px]",
            value === o.id ? "bg-accent text-ink-950" : "text-slate-300 hover:bg-ink-700")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Lab-team pages: says the data is the ground copy and how old it is. */
export function GroundNote({ view }: { view?: ViewInfo }) {
  if (!view || view.side !== "ground") return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-slate-300">
      <span className="font-semibold text-accent">{t("Ground copy")}</span>
      <span>{t("daily data up to {d}", { d: dayLabel(view.data_day) })}</span>
      {view.state_age_s !== undefined && <span>· {t("latest status is {a} old", { a: duration(view.state_age_s) })}</span>}
      <span className="text-slate-500">· {t("arrived through the ground link")}</span>
    </div>
  );
}

/** A 1-5 rating row with big touch targets. */
export function Rating({ value, onChange, low, high, max = 5, min = 1, faces }: {
  value: number | null; onChange: (v: number) => void; low: string; high: string; max?: number; min?: number; faces?: string[];
}) {
  const vals = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {vals.map((n, i) => (
          <button key={n} onClick={() => onChange(n)} aria-pressed={value === n}
            className={cx("flex h-14 min-w-[56px] flex-col items-center justify-center rounded-xl px-2 text-lg font-bold transition",
              value === n ? "bg-accent text-ink-950" : "bg-ink-800 text-slate-200 hover:bg-ink-700")}>
            {faces ? <span className="text-xl leading-none">{faces[i]}</span> : null}
            <span className={faces ? "text-xs" : ""}>{n}</span>
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-500" style={{ maxWidth: vals.length * 64 }}><span>{low}</span><span>{high}</span></div>
    </div>
  );
}
