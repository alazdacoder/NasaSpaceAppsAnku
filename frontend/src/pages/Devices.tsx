import { useState } from "react";
import { Button, Card, Empty, ProgressBar, cx } from "../components/ui";
import { api, missionTOf, usePoll } from "../lib/api";
import { useApp } from "../lib/context";

interface Device {
  id: string; name: string; kind: string; description: string; metrics: string[]; simulated: boolean; enabled: boolean;
  status: { connected: boolean; state: string; battery_pct: number | null; last_sync_mission_t: number | null; note: string };
}

const STATE_COLOR: Record<string, string> = { connected: "#22c55e", syncing: "#38bdf8", offline: "#f43f5e", disabled: "#64748b" };

export default function Devices() {
  const { crewId, meta } = useApp();
  const { data, refresh } = usePoll<{ devices: Device[] }>(`/api/devices?crew=${crewId}`, 2000);
  const [csv, setCsv] = useState("crew_id,day,metric,value\nc1,12,hr_rest,61\n");
  const [result, setResult] = useState<string>("");
  if (!data) return <Empty />;

  const toggle = async (id: string) => { await api(`/api/devices/${id}/toggle`, { method: "POST" }); refresh(); };
  const upload = async () => {
    try {
      const r = await api<{ imported: number; errors: string[] }>("/api/import/csv", { raw: csv });
      setResult(`Imported ${r.imported} rows.${r.errors.length ? " Problems: " + r.errors.join("; ") : ""}`);
    } catch (e: any) { setResult(e.message); }
  };
  const onFile = async (f: File | undefined) => { if (f) setCsv(await f.text()); };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <h1 className="text-3xl font-bold">Devices</h1>
      <p className="text-slate-400">
        Every source plugs in through the same adapter interface (read day · live reading · status), so a real device can replace a simulated one without changing the rest of the app.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.devices.map((d) => (
          <div key={d.id} className={cx("rounded-2xl border bg-ink-900 p-4", d.enabled ? "border-ink-700" : "border-dashed border-ink-600 opacity-70")}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-lg font-semibold leading-tight">{d.name}</div>
                <div className="text-sm capitalize text-slate-400">{d.kind} · {d.simulated ? "simulated" : "import"}</div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-800 px-2.5 py-1 text-sm font-semibold capitalize" style={{ color: STATE_COLOR[d.status.state] }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATE_COLOR[d.status.state] }} />{d.status.state}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-300">{d.description}</p>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center gap-3">
                <span className="w-24 text-slate-400">Battery</span>
                {d.status.battery_pct === null ? <span className="text-slate-500">mains power</span> : (
                  <>
                    <div className="flex-1"><ProgressBar value={d.status.battery_pct / 100} color={d.status.battery_pct < 25 ? "#f43f5e" : d.status.battery_pct < 50 ? "#fbbf24" : "#22c55e"} /></div>
                    <span className="w-12 text-right tabular-nums">{d.status.battery_pct}%</span>
                  </>
                )}
              </div>
              <div className="flex gap-3"><span className="w-24 text-slate-400">Last sync</span><span>{missionTOf(d.status.last_sync_mission_t)}</span></div>
              {d.status.note && <div className="flex gap-3"><span className="w-24 text-slate-400">Note</span><span>{d.status.note}</span></div>}
              {d.metrics.length > 0 && (
                <div className="flex gap-3"><span className="w-24 shrink-0 text-slate-400">Measures</span>
                  <span className="text-slate-300">{d.metrics.map((x) => meta?.metrics[x]?.label ?? x).join(", ")}</span></div>
              )}
            </div>
            {!["manual", "csv"].includes(d.id) && (
              <Button kind="ghost" className="mt-3 w-full" onClick={() => toggle(d.id)}>{d.enabled ? "Simulate disconnect" : "Reconnect"}</Button>
            )}
          </div>
        ))}
      </div>

      <Card title="CSV import (optional)">
        <p className="text-sm text-slate-400">Columns: crew_id, day, metric, value. Rows for past mission days replace stored values. Metric names are listed on the Data sources page.</p>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={5}
          className="mt-2 w-full rounded-xl border border-ink-600 bg-ink-950 p-3 font-mono text-sm" aria-label="CSV text" />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
          <Button onClick={upload}>Import</Button>
          {result && <span className="text-sm">{result}</span>}
        </div>
      </Card>
    </div>
  );
}
