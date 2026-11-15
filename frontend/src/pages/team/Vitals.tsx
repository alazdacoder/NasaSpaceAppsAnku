import { Link } from "react-router-dom";
import { C } from "../../lib/theme";
import { TrendBlock } from "../../components/charts";
import { Icon } from "../../components/Icon";
import { AlertCard, Card, Empty, GroundNote, MetricCard, PageTitle, Stat } from "../../components/ui";
import { fmt, usePoll, type Alert, type Metric, type ViewInfo } from "../../lib/api";
import { useApp, useCrewName } from "../../lib/context";
import { t } from "../../lib/i18n";
import { EcgStrip } from "../crew/Body";

interface BodyData {
  live: Record<string, any>;
  vitals: Record<string, Metric>;
  sleep: Record<string, Metric>;
  ocular?: Record<string, Metric>;
  fluid?: Record<string, Metric>;
  alerts: Alert[];
  view: ViewInfo;
}

export default function Vitals() {
  const { crewId } = useApp();
  const name = useCrewName();
  const { data } = usePoll<BodyData>(`/api/crew/${crewId}/body?side=ground`, 3000);
  if (!data) return <Empty />;
  const L = data.live ?? {};
  const v = data.vitals ?? {};
  const order = ["hr_rest", "resp_rate", "bp_sys", "bp_dia", "spo2", "skin_temp", "activity"];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageTitle
        sub={t("Bio-Monitor shirt + headband, Space Tonometer pod, T-Mini core temperature, wrist actigraph")}
        right={
          <Link
            to="/team/ocular"
            className="inline-flex min-h-[42px] items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 text-xs font-bold text-accent hover:bg-accent/20"
          >
            <Icon name="eye" size={16} />
            {t("Ocular & Tonometer Command")}
          </Link>
        }
      >
        {t("Vitals & sleep · {n}", { n: name })}
      </PageTitle>
      <GroundNote view={data.view} />
      {data.alerts?.map((a) => <AlertCard key={a.id} alert={a} />)}

      <Card
        title={t("Latest live reading (from the last status packet)")}
        right={L.asleep ? <span className="text-sm text-slate-400">{t("asleep")}</span> : undefined}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label={t("Heart rate")}
            value={fmt(L.hr, 0)}
            unit={t("bpm")}
            color={C.bad}
            sub={t("baseline {v}", { v: fmt(v.hr_rest?.baseline_mean, 0) })}
          />
          <Stat
            label={t("Breathing")}
            value={fmt(L.resp_rate, 0)}
            unit="/min"
            color={C.accent}
            sub={t("baseline {v}", { v: fmt(v.resp_rate?.baseline_mean, 0) })}
          />
          <Stat
            label={t("Blood pressure")}
            value={`${fmt(L.bp_sys, 0)}/${fmt(L.bp_dia, 0)}`}
            unit="mmHg"
            sub={t("baseline {v}", {
              v: `${fmt(v.bp_sys?.baseline_mean, 0)}/${fmt(v.bp_dia?.baseline_mean, 0)}`,
            })}
          />
          <Stat
            label={t("Blood oxygen")}
            value={fmt(L.spo2, 0)}
            unit="%"
            color={C.ok}
            sub={t("baseline {v}", { v: fmt(v.spo2?.baseline_mean, 0) })}
          />
          <Stat
            label={t("Core temp")}
            value={fmt(L.core_temp, 2)}
            unit="°C"
            color={C.warn}
            sub={t("baseline {v}", { v: fmt(v.core_temp?.baseline_mean, 2) })}
          />
          <Stat
            label={t("Skin temp")}
            value={fmt(L.skin_temp, 1)}
            unit="°C"
            sub={t("baseline {v}", { v: fmt(v.skin_temp?.baseline_mean, 1) })}
          />
        </div>
        <div className="mt-4 rounded-2xl border border-ok/30 bg-ink-950 p-3">
          <div className="px-1 text-xs font-semibold text-ok">
            ● {t("ECG lead (illustrative trace from live heart rate)")}
          </div>
          <EcgStrip hr={L.hr ?? 60} />
        </div>
      </Card>

      <Card
        title={t("Space Ocular Health & Antigravity Fluid Dynamics")}
        right={
          <Link to="/team/ocular" className="text-xs font-bold text-accent hover:underline">
            {t("Full Ocular & Tonometer Matrix")}
          </Link>
        }
      >
        {data.ocular?.iop_mmhg ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.ocular?.iop_mmhg && <MetricCard m={data.ocular.iop_mmhg} personal={false} />}
            {data.ocular?.onsd_mm && <MetricCard m={data.ocular.onsd_mm} personal={false} />}
            {data.fluid?.fluid_shift_ml && <MetricCard m={data.fluid.fluid_shift_ml} personal={false} />}
            {data.fluid?.icp_mmhg && <MetricCard m={data.fluid.icp_mmhg} personal={false} />}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t("Intraocular pressure (IOP)")} value={fmt(L.iop_mmhg ?? 18.4, 1)} unit="mmHg" color={C.accent} sub={t("Paired Space Tonometer")} />
            <Stat label={t("Optic nerve sheath diameter")} value={fmt(L.onsd_mm ?? 5.54, 2)} unit="mm" color={C.ok} sub={t("Ultrasonic ONSD pod")} />
            <Stat label={t("Cephalad fluid shift")} value={fmt(L.fluid_shift_ml ?? 1680, 0)} unit="mL" color={C.rest} sub={t("Biologic liquid redistribution")} />
            <Stat label={t("Intracranial pressure (ICP)")} value={fmt(L.icp_mmhg ?? 13.8, 1)} unit="mmHg" color={C.warn} sub={t("Non-invasive cranial fluid")} />
          </div>
        )}
      </Card>

      <Card title={t("Sleep history (wrist actigraph)")}>
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          {data.sleep?.sleep_h && <TrendBlock m={data.sleep.sleep_h} height={220} />}
          <div className="space-y-3">
            {data.sleep?.sleep_h && <MetricCard m={data.sleep.sleep_h} showChart={false} personal={false} />}
            {data.sleep?.sleep_quality && <MetricCard m={data.sleep.sleep_quality} showChart={false} personal={false} />}
          </div>
        </div>
        {data.sleep?.light_lux && (
          <div className="mt-4">
            <TrendBlock m={data.sleep.light_lux} height={140} />
          </div>
        )}
      </Card>

      <Card title={t("Core temperature")}>
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          {v.core_temp && <TrendBlock m={v.core_temp} height={200} />}
          {v.core_temp && <MetricCard m={v.core_temp} showChart={false} personal={false} />}
        </div>
      </Card>

      <Card title={t("Vitals over time")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {order
            .filter((k) => v[k])
            .map((k) => (
              <MetricCard key={k} m={v[k]} personal={false} />
            ))}
        </div>
        {v.hr_rest && (
          <div className="mt-4">
            <TrendBlock m={v.hr_rest} height={200} />
          </div>
        )}
      </Card>
    </div>
  );
}
