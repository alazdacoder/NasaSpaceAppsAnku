import { useCallback, useEffect, useRef, useState } from "react";

export type Level = "green" | "amber" | "red";

export interface Rec { id: string; text: string; source: string; verified: boolean }
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
  mission_t: number; today: number; hour: number; day_seconds: number; phase: string; mission_days: number;
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
  const init: RequestInit = { method: opts.method ?? (opts.body !== undefined || opts.raw !== undefined ? "POST" : "GET") };
  if (opts.body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(opts.body);
  } else if (opts.raw !== undefined) {
    init.headers = { "Content-Type": "text/csv" };
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
      setError(e?.message ?? "Request failed");
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

export function dayLabel(day: number): string {
  return day < 0 ? `L${day}` : `Day ${day}`;
}

export function missionTime(c: Clock | undefined | null): string {
  if (!c) return "";
  const h = Math.floor(c.hour);
  const m = Math.floor((c.hour - h) * 60);
  return `${dayLabel(c.today)} · ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function missionTOf(t: number | null | undefined): string {
  if (t === null || t === undefined) return "–";
  const day = Math.floor(t);
  const hr = (t - day) * 24;
  const h = Math.floor(hr);
  const m = Math.floor((hr - h) * 60);
  return `${dayLabel(day)} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function duration(s: number | null | undefined): string {
  if (s === null || s === undefined || !isFinite(s)) return "–";
  if (s < 1) return "<1 s";
  if (s < 90) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  if (m < 60) return `${m} min ${String(sec).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const LEVEL_TEXT: Record<Level, string> = { green: "All good", amber: "Watch", red: "Act now" };
export const LEVEL_COLOR: Record<Level, string> = { green: "#22c55e", amber: "#fbbf24", red: "#f43f5e" };
