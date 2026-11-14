import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { Button, Card, Empty, PageTitle, ProgressBar, cx } from "../../components/ui";
import { api, missionTOf, usePoll } from "../../lib/api";
import { useApp, useCrewName } from "../../lib/context";
import { t } from "../../lib/i18n";

interface Device {
  id: string;
  name: string;
  kind: string;
  description: string;
  metrics: string[];
  simulated: boolean;
  enabled: boolean;
  status: {
    connected: boolean;
    state: string;
    battery_pct: number | null;
    last_sync_mission_t: number | null;
    note: string;
  };
}

const STATE_COLOR: Record<string, string> = {
  connected: "#00E676",
  syncing: "#00E5FF",
  offline: "#FF5252",
  disabled: "#64748b",
  standby: "#B388FF",
};

export default function Devices() {
  const { crewId, meta } = useApp();
  const name = useCrewName();
  const { data, refresh } = usePoll<{ devices: Device[] }>(`/api/devices?crew=${crewId}`, 2000);
  const [csv, setCsv] = useState("crew_id,day,metric,value\nc1,12,hr_rest,61\n");
  const [result, setResult] = useState<string>("");
  if (!data) return <Empty />;
  const stateText: Record<string, string> = {
    connected: t("connected"),
    syncing: t("syncing"),
    offline: t("offline"),
    disabled: t("disabled"),
    standby: t("standby"),
  };
  const kindText: Record<string, string> = {
    exercise: t("exercise"),
    wearable: t("wearable"),
    environment: t("environment"),
    lab: t("lab"),
    manual: t("manual"),
    app: t("app"),
    clinic: t("clinic"),
  };

  const hasTonometer = data.devices.some((d) => d.id === "tonometer");
  const fallbackTonometer: Device = {
    id: "tonometer",
    name: t("Space Ocular Tonometer & OCT Pod"),
    kind: "wearable",
    description: t(
      "Paired wireless rebound tonometer and optic nerve ultrasound pod: live intraocular pressure (IOP), optic nerve sheath diameter (ONSD) and non-invasive intracranial pressure (ICP).",
    ),
    metrics: ["iop_mmhg", "onsd_mm", "icp_mmhg"],
    simulated: true,
    enabled: true,
    status: {
      connected: true,
      state: "connected",
      battery_pct: 94,
      last_sync_mission_t: data.devices[0]?.status?.last_sync_mission_t ?? 30.2,
      note: "",
    },
  };
  const deviceList = hasTonometer
    ? [
        ...data.devices.filter((d) => d.id === "tonometer"),
        ...data.devices.filter((d) => d.id !== "tonometer"),
      ]
    : [fallbackTonometer, ...data.devices];

  const toggle = async (id: string) => {
    await api(`/api/devices/${id}/toggle`, { method: "POST" });
    refresh();
  };
  const upload = async () => {
    try {
      const r = await api<{ imported: number; errors: string[] }>("/api/import/csv", { raw: csv });
      setResult(
        t("Imported {n} rows.", { n: r.imported }) + (r.errors.length ? ` ${t("Problems:")} ${r.errors.join("; ")}` : ""),
      );
    } catch (e: any) {
      setResult(e.message);
    }
  };
  const onFile = async (f: File | undefined) => {
    if (f) setCsv(await f.text());
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageTitle
        sub={t(
          "Every source plugs in through the same adapter interface (read day · live reading · status), so a real device can replace a simulated one without changing the rest of the app.",
        )}
        right={
          <Link
            to="/team/ocular"
            className="inline-flex min-h-[42px] items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 text-xs font-bold text-accent hover:bg-accent/20"
          >
            <Icon name="eye" size={16} />
            {t("Open Tonometer Telemetry ›")}
          </Link>
        }
      >
        {t("Devices · {n}", { n: name })}
      </PageTitle>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {deviceList.map((d) => {
          const isTono = d.id === "tonometer";
          return (
            <div
              key={d.id}
              className={cx(
                "shealth-card flex flex-col justify-between rounded-card border p-5 shadow-card backdrop-blur-md transition-all",
                !d.enabled
                  ? "border-dashed border-white/15 bg-ink-900/50 opacity-70"
                  : isTono
                    ? "border-accent/50 bg-gradient-to-br from-[#0F2435] via-[#181C24] to-[#1D1530] shadow-glowBlue"
                    : "border-white/[0.06] bg-ink-900/95 hover:border-white/20",
              )}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-lg font-extrabold leading-tight text-white">
                      {isTono && <Icon name="eye" size={18} className="text-accent" />}
                      {d.name}
                    </div>
                    <div className="mt-0.5 text-xs font-medium text-slate-400">
                      {kindText[d.kind] ?? d.kind} · {d.simulated ? t("simulated") : t("import")}
                    </div>
                  </div>
                  <span
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-ink-850 px-2.5 py-1 text-xs font-extrabold uppercase tracking-wider"
                    style={{ color: STATE_COLOR[d.status.state] }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: STATE_COLOR[d.status.state] }} />
                    {stateText[d.status.state] ?? d.status.state}
                  </span>
                </div>
                <p className="mt-2.5 text-sm leading-snug text-slate-300">{d.description}</p>
                <div className="mt-3.5 space-y-2 border-t border-white/[0.05] pt-3 text-xs">
                  <div className="flex items-center gap-3">
                    <span className="w-24 text-slate-400">{t("Battery")}</span>
                    {d.status.battery_pct === null ? (
                      <span className="text-slate-500">{t("mains power")}</span>
                    ) : (
                      <>
                        <div className="flex-1">
                          <ProgressBar
                            value={d.status.battery_pct / 100}
                            color={
                              d.status.battery_pct < 25
                                ? "#FF5252"
                                : d.status.battery_pct < 50
                                  ? "#FF9100"
                                  : "#00E676"
                            }
                            height={8}
                          />
                        </div>
                        <span className="w-10 text-right font-mono font-bold text-white">{d.status.battery_pct}%</span>
                      </>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <span className="w-24 text-slate-400">{t("Last sync")}</span>
                    <span className="font-mono text-slate-200">{missionTOf(d.status.last_sync_mission_t)}</span>
                  </div>
                  {d.status.note && (
                    <div className="flex gap-3">
                      <span className="w-24 shrink-0 text-slate-400">{t("Note")}</span>
                      <span className="text-slate-300">{d.status.note}</span>
                    </div>
                  )}
                  {d.metrics.length > 0 && (
                    <div className="flex gap-3">
                      <span className="w-24 shrink-0 text-slate-400">{t("Measures")}</span>
                      <span className="text-accent">
                        {d.metrics.map((x) => meta?.metrics[x]?.label ?? x).join(", ")}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {!["manual", "csv"].includes(d.id) && (
                <Button kind="ghost" className="mt-4 w-full text-sm" onClick={() => toggle(d.id)}>
                  {d.enabled ? t("Simulate disconnect") : t("Reconnect")}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <Card title={t("CSV import (optional)")}>
        <p className="text-sm text-slate-400">
          {t(
            "Columns: crew_id, day, metric, value. Rows for past mission days replace stored values. Metric names are listed on the Data sources page.",
          )}
        </p>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={5}
          className="mt-2.5 w-full rounded-2xl border border-white/10 bg-ink-950 p-3.5 font-mono text-sm text-white"
          aria-label={t("CSV text")}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="text-sm text-slate-300"
          />
          <Button onClick={upload}>{t("Import")}</Button>
          {result && <span className="text-sm font-semibold text-ok">{result}</span>}
        </div>
      </Card>
    </div>
  );
}
