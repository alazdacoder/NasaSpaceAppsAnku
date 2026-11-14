import { useCallback, useEffect, useRef, useState } from "react";
import { getLang, t } from "./i18n";

export type Level = "green" | "amber" | "red";

export interface Rec { id: string; text: string; source: string; verified: boolean }
export type Side = "crew" | "ground";
export interface ViewInfo { side: Side; data_day: number; phase: Phase; state_mission_t?: number; state_age_s?: number }
export type Phase = "preflight" | "inflight" | "postflight";
export interface Alert {
  id: string; kind: "metric" | "cross" | "protocol"; title: string; level: Level; reason: string;
  recs: Rec[]; metrics: string[]; source: string; verified: boolean;
}
export interface Threshold { type: string; value: number; level: Level; source: string; verified: boolean; rec?: string }
export interface Point { day: number; value: number; ewma: number }
export interface Metric {
  metric: string; label: string; unit: string; decimals: number; group: string; device: string; meaning: string;
  direction: string; thresholds: Threshold[]; verified: boolean; estimate_note?: string | null; has_rules: boolean;
  points: Point[]; value: number | null; ewma: number | null; baseline_mean: number | null; baseline_sd?: number | null;
  z?: number | null; pct?: number | null; slope?: number; anomaly?: boolean; status: Level;
  triggered: { level: Level; reason: string; rule: string; source: string; verified: boolean }[];
  day?: number; stale?: boolean;
}
export interface Task {
  crew_id: string; day: number; task_id: string; kind: string; title: string; detail: string;
  status: "pending" | "done" | "auto" | "missed" | "expired"; payload: Record<string, any>;
}
export interface Clock {
  mission_t: number; today: number; hour: number; day_seconds: number; phase: Phase; mission_days: number;
  landing_day: number; last_day: number; r_day: number | null; days_to_landing: number | null;
  day_seconds_options: number[]; seed: number; finished: boolean;
}
export interface LinkStatus {
  profile: string; profile_label: string; delay_s: number; delay_min_s: number; delay_max_s: number; blackout: boolean;
  forced_blackout: boolean; window_change_in_s: number | null; queued: number; in_flight: number; delivered: number;
  acked: number; next_seq: number; last_acked_seq: number | null; last_received_seq: number | null;
  next_arrival_in_s: number | null; ground_data_age_s: number | null; source: string; verified: boolean;
}
export interface ProtocolTarget {
  metric: string; label: string; start: number; target: number; current: number; progress: number;
  history: { day: number; progress: number }[]; days_to_target: number | null; source?: string; verified?: boolean;
}
export interface Protocol {
  protocol_id: number; type: string; label: string; dose_text: string; start_day: number; status: string;
  started_by: string; reason: string; days_since_start: number; adherence: number | null; score: number | null;
  targets: ProtocolTarget[]; days_to_target_total: number | null; days_to_target_left: number | null;
  source: string; verified: boolean;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: any; raw?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Lang": getLang() };
  const init: RequestInit = { method: opts.method ?? (opts.body !== undefined || opts.raw !== undefined ? "POST" : "GET"), headers };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  } else if (opts.raw !== undefined) {
    headers["Content-Type"] = "text/csv";
    init.body = opts.raw;
  }
  const r = await fetch(path, init);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail ?? msg; } catch { /* ignore */ }
    throw new ApiError(r.status, String(msg));
  }
  return r.json();
}

/** Poll an endpoint. Returns data, error and a manual refresh. */
export function usePoll<T = any>(path: string | null, ms = 2500) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  const refresh = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const d = await api<T>(p);
      if (pathRef.current === p) { setData(d); setError(null); }
    } catch (e: any) {
      setError(e?.message ?? t("Request failed"));
    }
  }, []);

  useEffect(() => {
    setData(null);
    if (!path) return;
    refresh();
    const id = window.setInterval(refresh, ms);
    return () => window.clearInterval(id);
  }, [path, ms, refresh]);

  return { data, error, refresh };
}

// ---------------------------------------------------------------- formatting
export function fmt(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return v.toFixed(decimals);
}

let LANDING_DAY = 180;
export function setLandingDay(d: number) {
  LANDING_DAY = d;
}
export function landingDay(): number {
  return LANDING_DAY;
}

/** L-3 before launch, "Day 12" in flight, R+2 after landing (R = return). */
export function dayLabel(day: number): string {
  if (day < 0) return `L${day}`;
  if (day >= LANDING_DAY) return `R+${day - LANDING_DAY}`;
  return t("Day {n}", { n: day });
}

/** Short axis tick: L-3 · 12 · R+2 */
export function dayTick(day: number): string {
  if (day < 0) return `L${day}`;
  if (day >= LANDING_DAY) return `R+${day - LANDING_DAY}`;
  return `${day}`;
}

export function missionTime(c: Clock | undefined | null): string {
  if (!c) return "";
  const h = Math.floor(c.hour);
  const m = Math.floor((c.hour - h) * 60);
  return `${dayLabel(c.today)} · ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function clockTime(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.round((hour - Math.floor(hour)) * 60);
  return `${String(m === 60 ? h + 1 : h).padStart(2, "0")}:${String(m === 60 ? 0 : m).padStart(2, "0")}`;
}

export function missionTOf(t_: number | null | undefined): string {
  if (t_ === null || t_ === undefined) return "–";
  const day = Math.floor(t_);
  const hr = (t_ - day) * 24;
  const h = Math.floor(hr);
  const m = Math.floor((hr - h) * 60);
  return `${dayLabel(day)} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function duration(s: number | null | undefined): string {
  if (s === null || s === undefined || !isFinite(s)) return "–";
  if (s < 1) return t("<1 s");
  if (s < 90) return t("{n} s", { n: Math.round(s) });
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  if (m < 60) return t("{m} min {s} s", { m, s: String(sec).padStart(2, "0") });
  return t("{h} h {m} min", { h: Math.floor(m / 60), m: m % 60 });
}

export function levelText(l: Level): string {
  return { green: t("All good"), amber: t("Watch"), red: t("Act now") }[l];
}
export const LEVEL_COLOR: Record<Level, string> = { green: "#22c55e", amber: "#fbbf24", red: "#f43f5e" };

/** Machine names (ids from the server) */
export function deviceName(d: string): string {
  return ({ ared: "ARED", t2: t("T2 treadmill"), cevis: t("CEVIS cycle"), rehab: t("Reconditioning") } as Record<string, string>)[d] ?? d;
}

export function exerciseName(e: string): string {
  return ({ squat: t("squat"), deadlift: t("deadlift"), "heel raise": t("heel raise"), "bench press": t("bench press") } as Record<string, string>)[e] ?? e;
}
