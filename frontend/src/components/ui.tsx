import type { ReactNode } from "react";
import { LEVEL_COLOR, LEVEL_TEXT, fmt, type Alert, type Level, type Metric } from "../lib/api";
import { Sparkline } from "./charts";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ children, className, title, right }: { children: ReactNode; className?: string; title?: ReactNode; right?: ReactNode }) {
  return (
    <section className={cx("rounded-2xl border border-ink-700 bg-ink-900 p-4 sm:p-5", className)}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-lg font-semibold text-slate-100">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusDot({ level, size = 14 }: { level: Level; size?: number }) {
  return (
    <span
      aria-label={LEVEL_TEXT[level]}
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: LEVEL_COLOR[level], boxShadow: `0 0 0 3px ${LEVEL_COLOR[level]}33` }}
    />
  );
}

export function StatusPill({ level, text }: { level: Level; text?: string }) {
  const cls = { green: "bg-ok/15 text-ok border-ok/40", amber: "bg-warn/15 text-warn border-warn/40", red: "bg-bad/15 text-bad border-bad/50" }[level];
  return (
    <span className={cx("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold", cls)}>
      <StatusDot level={level} size={10} />
      {text ?? LEVEL_TEXT[level]}
    </span>
  );
}

export function Unverified({ source, className }: { source?: string; className?: string }) {
  return (
    <span
      title={source ? `Not checked against a NASA source. Source: ${source}` : "Not checked against a NASA source"}
      className={cx("inline-flex items-center rounded border border-dashed border-warn/70 px-1.5 py-0 text-[11px] font-semibold uppercase tracking-wide text-warn", className)}
    >
      unverified
    </span>
  );
}

export function SourceTag({ verified, source }: { verified: boolean; source?: string }) {
  if (!verified) return <Unverified source={source} />;
  return (
    <span title={source} className="inline-flex items-center rounded border border-ok/40 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-ok">
      verified
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
        {alert.kind === "cross" && <span className="rounded bg-accent/15 px-2 text-xs font-semibold text-accent">cross-source</span>}
        {!alert.verified && <Unverified source={alert.source} />}
      </div>
      <p className="mt-1 text-slate-300"><span className="font-semibold text-slate-200">Why: </span>{alert.reason}</p>
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

function baselineText(m: Metric): string {
  if (m.baseline_mean === null || m.baseline_mean === undefined) return "No preflight baseline (cumulative or weekly value)";
  const sd = m.baseline_sd ? ` ± ${fmt(m.baseline_sd, m.decimals)}` : "";
  return `Your baseline ${fmt(m.baseline_mean, m.decimals)}${sd} ${m.unit}`.trim();
}

export function MetricCard({ m, showChart = true, big }: { m: Metric; showChart?: boolean; big?: boolean }) {
  const val = m.ewma ?? m.value;
  return (
    <div className={cx("rounded-xl border bg-ink-850 p-4",
      m.status === "red" ? "border-bad/60" : m.status === "amber" ? "border-warn/50" : "border-ink-700")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-300">
            {m.label}
            {!m.verified && m.has_rules && <Unverified source={m.thresholds.find((t) => !t.verified)?.source ?? m.estimate_note ?? undefined} />}
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
        {baselineText(m)}
        {m.pct !== null && m.pct !== undefined && Math.abs(m.pct) >= 1 && (
          <span className={cx("ml-2 font-semibold", Math.abs(m.pct) > 20 ? "text-warn" : "text-slate-300")}>
            {m.pct > 0 ? "+" : ""}{fmt(m.pct, 0)}%
          </span>
        )}
        {m.anomaly && <span className="ml-2 rounded bg-bad/20 px-1.5 text-xs font-bold text-bad">anomaly</span>}
      </div>
      {showChart && m.points.length > 1 && (
        <div className="mt-2"><Sparkline points={m.points} baseline={m.baseline_mean} status={m.status} /></div>
      )}
      <p className="mt-2 text-sm leading-snug text-slate-300">{m.meaning}</p>
      {m.triggered?.length > 0 && (
        <p className="mt-1 text-sm font-medium" style={{ color: m.status === "red" ? "#fb7185" : "#fcd34d" }}>{m.triggered[0].reason}</p>
      )}
      <div className="mt-1 text-xs text-slate-500">smoothed (EWMA) · last raw {fmt(m.value, m.decimals)} · 7-day slope {fmt(m.slope, Math.max(1, m.decimals))}/day</div>
    </div>
  );
}

export function Empty({ text = "Loading…" }: { text?: string }) {
  return <div className="flex min-h-[30vh] items-center justify-center text-slate-400">{text}</div>;
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
