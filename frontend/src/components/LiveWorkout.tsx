import { DEMO } from "../demo/client";
import { useEffect, useRef, useState } from "react";
import { C } from "../lib/theme";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { api, exerciseName, fmt } from "../lib/api";
import { getLang, t } from "../lib/i18n";
import { AXIS, GRID } from "./charts";
import { Button, Card, cx } from "./ui";

export interface WorkoutView {
  active: boolean; device?: "ared" | "t2" | "cevis" | "rehab"; device_label?: string; settings?: Record<string, any>;
  elapsed_s?: number; hr?: number; hr_source?: string; samples?: { t: number; hr: number; kcal?: number }[];
  sets_done?: { exercise: string; load_kg: number; reps: number }[]; scale?: number; target_hr?: number;
  kcal?: number; kcal_min?: number; met?: number;
}
export interface Limits { ared_peak_load_kg: number; t2_peak_speed_kmh: number; cevis_max_watts: number; source: string }
export interface Summary {
  device: string; device_label: string; minutes: number; avg_hr: number; max_hr: number; details: any; kcal: number;
  samples: { t: number; hr: number }[]; last7_min: number; weekly_target_min: number; kcal_today: number;
}

export function mmss(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function Stepper({ label, value, unit, step, onChange, max, min = 0, decimals = 0 }: {
  label: string; value: number; unit: string; step: number; onChange: (v: number) => void; max: number; min?: number; decimals?: number;
}) {
  return (
    <div className="border-t border-ink-700 pt-3 pb-1">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <button aria-label={t("Decrease {x}", { x: label })} className="h-14 w-14 rounded-xl bg-ink-700 text-3xl font-bold active:bg-ink-600" onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}>−</button>
        <div className="min-w-[90px] flex-1 text-center">
          <span className="text-3xl font-bold tabular-nums">{fmt(value, decimals)}</span>
          <span className="ml-1 text-slate-400">{unit}</span>
        </div>
        <button aria-label={t("Increase {x}", { x: label })} className="h-14 w-14 rounded-xl bg-ink-700 text-3xl font-bold active:bg-ink-600" onClick={() => onChange(Math.min(max, +(value + step).toFixed(2)))}>+</button>
      </div>
      <div className="mt-1 text-xs text-slate-500">{t("max {m} {u}", { m: max, u: unit })}</div>
    </div>
  );
}

/** Real heart-rate strap over Web Bluetooth (standard Heart Rate service 0x180D). */
function useBluetoothHR(crewId: string) {
  const [state, setState] = useState<"idle" | "connecting" | "connected" | "unsupported" | "error">(
    typeof navigator !== "undefined" && (navigator as any).bluetooth ? "idle" : "unsupported");
  const [bpm, setBpm] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const lastPost = useRef(0);
  const connect = async () => {
    const bt = (navigator as any).bluetooth;
    if (!bt) { setState("unsupported"); return; }
    try {
      setState("connecting");
      const device = await bt.requestDevice({ filters: [{ services: ["heart_rate"] }] });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService("heart_rate");
      const ch = await service.getCharacteristic("heart_rate_measurement");
      ch.addEventListener("characteristicvaluechanged", (ev: any) => {
        const v: DataView = ev.target.value;
        const flags = v.getUint8(0);
        const hr = flags & 1 ? v.getUint16(1, true) : v.getUint8(1);
        setBpm(hr);
        const now = Date.now();
        if (now - lastPost.current > 900) {
          lastPost.current = now;
          api(`/api/crew/${crewId}/workout/hr`, { body: { bpm: hr } }).catch(() => undefined);
        }
      });
      await ch.startNotifications();
      device.addEventListener("gattserverdisconnected", () => setState("idle"));
      setState("connected");
      setMsg(device.name ?? t("HR strap"));
    } catch (e: any) {
      setState("error");
      setMsg(e?.message ?? t("Could not connect"));
    }
  };
  return { state, bpm, msg, connect };
}

export function LiveWorkout({ crewId, view, onFinish, exercises, limits }: {
  crewId: string; view: WorkoutView; onFinish: (s: Summary | null) => void; exercises: string[]; limits: Limits;
}) {
  const [live, setLive] = useState<WorkoutView>(view);
  const bt = useBluetoothHR(crewId);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    let ws: WebSocket | null = null;
    let poll: number | undefined;
    const startPoll = () => { poll = window.setInterval(() => api<WorkoutView>(`/api/crew/${crewId}/workout`).then(setLive), 1000); };
    if (DEMO) { startPoll(); return () => { if (poll) window.clearInterval(poll); }; }
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws/crew/${crewId}/workout?lang=${getLang()}`);
      ws.onmessage = (e) => setLive(JSON.parse(e.data));
      ws.onerror = startPoll;
    } catch {
      startPoll();
    }
    return () => { ws?.close(); if (poll) window.clearInterval(poll); };
  }, [crewId]);

  if (!live.active) return null;
  const s = live.settings ?? {};
  const update = (settings: Record<string, any>, log_set = false) =>
    api<WorkoutView>(`/api/crew/${crewId}/workout/update`, { body: { settings, log_set } }).then(setLive);
  const finish = async () => onFinish(await api<Summary>(`/api/crew/${crewId}/workout/finish`, { method: "POST" }));
  const cancel = async () => { await api(`/api/crew/${crewId}/workout/cancel`, { method: "POST" }); onFinish(null); };

  return (
    <Card className="border-accent/60" title={<span>{t("Live: {d}", { d: live.device_label ?? "" })}</span>}
      right={<span className="rounded-full bg-bad/20 px-3 py-1 text-sm font-bold text-bad">● REC</span>}>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="border-t border-ink-700 pt-3 pb-1">
              <div className="text-xs font-semibold text-slate-400">{t("Heart rate")} · {live.hr_source}</div>
              <div className="mt-1 text-5xl font-black tabular-nums text-bad sm:text-6xl">{live.hr}<span className="ml-1 text-lg font-semibold text-slate-400">{t("bpm")}</span></div>
              <div className="text-xs text-slate-400">{t("target ≈ {n} bpm", { n: live.target_hr })}</div>
            </div>
            <div className="border-t border-ink-700 pt-3 pb-1">
              <div className="text-xs font-semibold text-slate-400">{t("Energy burned")}</div>
              <div className="mt-1 text-5xl font-black tabular-nums text-warn sm:text-6xl">{fmt(live.kcal, 0)}<span className="ml-1 text-lg font-semibold text-slate-400">kcal</span></div>
              <div className="text-xs text-slate-400">{t("{r} kcal/min · {m} MET", { r: fmt(live.kcal_min, 1), m: fmt(live.met, 1) })}</div>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-2xl bg-ink-850 px-4 py-3">
            <span className="text-sm text-slate-400">{t("Elapsed")}</span>
            <span className="text-4xl font-bold tabular-nums">{mmss(live.elapsed_s ?? 0)}</span>
            <span className="text-xs text-slate-500">{t("demo time ×{n}", { n: live.scale })}</span>
          </div>
          {live.device === "ared" && (
            <>
              <div className="flex flex-wrap gap-2">
                {exercises.map((e) => (
                  <button key={e} onClick={() => update({ exercise: e })}
                    className={cx("min-h-[48px] rounded-xl px-4 font-semibold capitalize", s.exercise === e ? "bg-accent text-ink-950" : "bg-ink-800 text-slate-200")}>{exerciseName(e)}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Stepper label={t("Load")} value={Number(s.load_kg)} unit="kg" step={5} max={limits.ared_peak_load_kg} onChange={(v) => update({ load_kg: v })} />
                <Stepper label={t("Reps")} value={Number(s.reps)} unit="" step={1} min={1} max={30} onChange={(v) => update({ reps: v })} />
              </div>
              <Button kind="primary" className="w-full text-lg" onClick={() => update({}, true)}>{t("Log set ({n} done)", { n: (live.sets_done ?? []).length })}</Button>
              {(live.sets_done ?? []).length > 0 && (
                <ol className="space-y-1 text-slate-300">
                  {live.sets_done!.map((x, i) => <li key={i}>{t("Set {i}", { i: i + 1 })}: <span className="capitalize">{exerciseName(x.exercise)}</span> · {x.load_kg} kg × {x.reps}</li>)}
                </ol>
              )}
            </>
          )}
          {live.device === "t2" && (
            <div className="grid grid-cols-2 gap-3">
              <Stepper label={t("Speed")} value={Number(s.speed_kmh)} unit={t("km/h")} step={0.5} decimals={1} max={limits.t2_peak_speed_kmh} onChange={(v) => update({ speed_kmh: v })} />
              <Stepper label={t("Harness load")} value={Number(s.harness_kg)} unit="kg" step={2} max={150} onChange={(v) => update({ harness_kg: v })} />
            </div>
          )}
          {live.device === "cevis" && (
            <Stepper label={t("Power")} value={Number(s.watts)} unit="W" step={10} max={limits.cevis_max_watts} onChange={(v) => update({ watts: v })} />
          )}
          {live.device === "rehab" && (
            <div className="border-t border-ink-700 pt-3 pb-1 text-slate-300">{t("Ground reconditioning with your trainer: walking, strength and balance. Stop and sit down if you feel dizzy.")}</div>
          )}
          <div className="flex gap-3">
            <Button kind="ok" className="flex-1 text-lg" onClick={finish}>{t("Finish & log")}</Button>
            <Button kind="ghost" onClick={cancel}>{t("Cancel")}</Button>
          </div>
          <div className="rounded-xl border border-ink-700 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold">{t("Real HR strap (optional)")}</span>
              {bt.state === "unsupported" ? <span className="text-slate-500">{t("Web Bluetooth not available in this browser")}</span> : (
                <Button kind="ghost" onClick={bt.connect} disabled={bt.state === "connecting" || bt.state === "connected"}>
                  {bt.state === "connected" ? t("Connected: {d}", { d: bt.msg }) : bt.state === "connecting" ? t("Connecting…") : t("Connect via Bluetooth")}
                </Button>
              )}
              {bt.bpm !== null && <span className="text-bad">{bt.bpm} {t("bpm")}</span>}
              {bt.state === "error" && <span className="text-bad">{bt.msg}</span>}
            </div>
          </div>
        </div>
        <div className="h-[380px] border-t border-ink-700 pt-3 pb-1">
          <ResponsiveContainer>
            <LineChart data={live.samples ?? []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="t" tick={AXIS} tickFormatter={(x) => mmss(x)} type="number" domain={["dataMin", "dataMax"]} />
              <YAxis yAxisId="hr" tick={AXIS} domain={[50, 190]} width={40} />
              <YAxis yAxisId="kcal" orientation="right" tick={AXIS} width={44} domain={[0, "auto"]} />
              {live.target_hr && <ReferenceLine yAxisId="hr" y={live.target_hr} stroke={C.warn} strokeDasharray="4 4" label={{ value: t("target"), fill: C.warn, fontSize: 12 }} />}
              <Line yAxisId="hr" type="monotone" dataKey="hr" name={t("Heart rate")} stroke={C.bad} strokeWidth={3} dot={false} isAnimationActive={false} />
              <Line yAxisId="kcal" type="monotone" dataKey="kcal" name="kcal" stroke={C.accent} strokeWidth={2.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="-mt-1 flex justify-center gap-4 text-xs text-slate-400">
            <span><span className="text-bad">━</span> {t("heart rate (left)")}</span>
            <span><span className="text-accent">┅</span> {t("kcal burned (right)")}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
