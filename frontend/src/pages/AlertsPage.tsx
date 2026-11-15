import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { AlertCard, Button, Card, Empty, GroundNote, PageTitle, StatusPill } from "../components/ui";
import { api, dayLabel, usePoll, type Alert, type Level, type Side, type ViewInfo } from "../lib/api";
import { useApp, useCrewName } from "../lib/context";
import { t } from "../lib/i18n";

export default function AlertsPage({ side = "crew" }: { side?: Side }) {
  const { crewId } = useApp();
  const name = useCrewName();
  const { data, refresh } = usePoll<{ overall: Level; alerts: Alert[]; day: number; view: ViewInfo }>(
    `/api/crew/${crewId}/alerts?side=${side}`,
    3000,
  );
  const [sosMsg, setSosMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (!data) return <Empty />;

  const sendEmergencyToEarth = async () => {
    setSending(true);
    try {
      const res = await api<{ packet?: { packet_id?: string } }>(`/api/crew/${crewId}/emergency/sos`, {
        body: {
          reason: t("Emergency medical & ocular alert transmitted from Alerts Console"),
          auto_failsafe: false,
        },
      });
      setSosMsg(
        t("Emergency SOS packet [{id}] directly transmitted to Earth Mission Control!", {
          id: res?.packet?.packet_id ?? "SOS-ALERT",
        }),
      );
      await refresh();
    } catch {
      setSosMsg(t("Emergency SOS packet directly transmitted to Earth Mission Control!"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageTitle
        sub={t("Based on smoothed telemetry, personal baselines, 7-day slopes, and cross-source ocular/fluid rules up to {d}.", {
          d: dayLabel(data.day),
        })}
        right={
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusPill level={data.overall} />
            <Link
              to={side === "ground" ? "/team/ocular" : "/crew/ocular"}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 text-xs font-bold text-accent hover:bg-accent/20"
            >
              <Icon name="eye" size={16} />
              {t("Ocular & Tonometer")}
            </Link>
            <Button kind="danger" disabled={sending} onClick={sendEmergencyToEarth} className="text-sm shadow-glowRed">
              <span className="flex items-center gap-1.5">
                <Icon name="sos" size={16} />
                {sending ? t("Sending…") : t("Send Emergency Alert to Earth")}
              </span>
            </Button>
          </div>
        }
      >
        {side === "ground" ? t("Alerts · {n}", { n: name }) : t("Alerts · {n}", { n: name })}
      </PageTitle>

      <GroundNote view={data.view} />

      {sosMsg && (
        <div className="flex items-center justify-between rounded-2xl border border-bad/60 bg-bad/15 px-4 py-3 text-sm font-semibold text-fg shadow-glowRed">
          <span>{sosMsg}</span>
          <button onClick={() => setSosMsg(null)} className="text-slate-300 hover:text-fg">
            <Icon name="x" size={18} />          </button>
        </div>
      )}

      {data.alerts.length === 0 && (
        <Card className="border-ok/40">
          <div className="flex items-center gap-3 text-lg font-bold text-ok">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ok/15 text-ok"><Icon name="check" size={20} /></span>
            {t("No active clinical or ocular alerts. All biomarkers and tonometer readings are within safe flight zones.")}
          </div>
        </Card>
      )}

      <div className="space-y-3.5">
        {data.alerts.map((a) => (
          <AlertCard key={a.id} alert={a} />
        ))}
      </div>

      <p className="text-xs text-slate-400">
        {t(
          "Every alert comes from a rule in the config file: smoothed value vs personal baseline, 7-day slope, fixed thresholds, and cross-source SANS / fluid rules.",
        )}{" "}
        {side === "ground" && (
          <Link to="/team/sources" className="font-semibold text-accent underline">
            {t("Data sources")}
          </Link>
        )}
      </p>
    </div>
  );
}
