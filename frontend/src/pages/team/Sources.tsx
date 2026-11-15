import { useState } from "react";
import { C } from "../../lib/theme";
import { Button, Card, Empty, PageTitle, SourceTag, cx } from "../../components/ui";
import { api, usePoll } from "../../lib/api";
import { t } from "../../lib/i18n";

interface SourcesData {
  references: { id: string; label: string; value: any; unit: string; range?: number[]; sd?: number; note?: string; source: string; verified: boolean }[];
  thresholds: { metric: string; label: string; rule: string; level: string; unit: string; source: string; verified: boolean; phases?: string[] | null }[];
  cross_rules: { id: string; title: string; level: string; when: { metric: string; field: string; op: string; value: number }[]; phases?: string[] | null; source: string; verified: boolean }[];
  recommendations: { id: string; text: string; source: string; verified: boolean }[];
  unverified: { kind: string; id: string; description: string; source: string }[];
  disclaimer: string;
}
interface Osdr {
  origin: "live" | "cache" | "fallback"; fetched_at: string; query_url: string; error: string | null;
  studies: { accession: string; title: string; description: string; topics: string[]; url: string }[];
}

function SourceText({ s }: { s: string }) {
  return (
    <span className="break-words">
      {s.split(/\s*;\s*/).map((part, i) => (
        <span key={i}>{i > 0 && " · "}{part.startsWith("http") ? <a className="text-accent underline" href={part} target="_blank" rel="noreferrer">{part.replace("https://", "")}</a> : t(part)}</span>
      ))}
    </span>
  );
}

function levelWord(l: string) {
  return ({ red: t("red"), amber: t("amber"), green: t("green") } as Record<string, string>)[l] ?? l;
}
function phaseWords(p?: string[] | null) {
  if (!p) return "";
  const w: Record<string, string> = { preflight: t("preflight"), inflight: t("in flight"), postflight: t("post-flight") };
  return ` (${p.map((x) => w[x] ?? x).join(", ")})`;
}

function OsdrPanel() {
  const { data: polled } = usePoll<Osdr>("/api/osdr", 600000);
  const [fresh, setFresh] = useState<Osdr | null>(null);
  const data = fresh ?? polled;
  const [topic, setTopic] = useState<string>("All");
  const [loading, setLoading] = useState(false);
  if (!data) return <Card title={t("Related NASA OSDR studies")}><Empty text={t("Asking the NASA OSDR API…")} /></Card>;
  const topics = ["All", ...Array.from(new Set(data.studies.flatMap((s) => s.topics)))];
  const list = data.studies.filter((s) => topic === "All" || s.topics.includes(topic));
  const badge = { live: "bg-ok/15 text-ok", cache: "bg-accent/15 text-accent", fallback: "bg-warn/15 text-warn" }[data.origin];
  return (
    <Card title={t("Related NASA OSDR studies (human)")}
      right={<Button kind="ghost" disabled={loading} onClick={async () => { setLoading(true); try { setFresh(await api<Osdr>("/api/osdr?refresh=true")); } finally { setLoading(false); } }}>{loading ? t("Calling…") : t("Call API now")}</Button>}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={cx("rounded px-2 py-0.5 font-bold", badge)}>{data.origin === "live" ? t("live API") : data.origin === "cache" ? t("cached response") : t("offline fallback")}</span>
        <span className="text-slate-400">{t("fetched {d}", { d: data.fetched_at })}</span>
        {data.error && <span className="text-warn">{t("Live call failed ({e}); showing cached copy.", { e: data.error })}</span>}
      </div>
      <div className="mt-1 break-all tabular-nums text-xs text-slate-500">{data.query_url}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {topics.map((x) => (
          <button key={x} onClick={() => setTopic(x)} className={cx("min-h-[40px] rounded-lg px-3 text-sm font-semibold", topic === x ? "bg-accent text-ink-950" : "bg-ink-800")}>{x === "All" ? t("All") : x}</button>
        ))}
      </div>
      <ul className="mt-3 max-h-[520px] space-y-2 overflow-y-auto pr-1">
        {list.slice(0, 60).map((s) => (
          <li key={s.accession} className="border-t border-ink-700 pt-3 pb-1">
            <a href={s.url} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">{s.accession}: {s.title}</a>
            <div className="mt-1 text-sm text-slate-400">{s.description.slice(0, 220)}{s.description.length > 220 ? "…" : ""}</div>
            {s.topics.length > 0 && <div className="mt-1 text-xs text-slate-500">{s.topics.join(" · ")}</div>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500">{t("Source: NASA Open Science Data Repository Biological Data API (visualization.osdr.nasa.gov/biodata/api). Topic tags are keyword matches made by this app. Study titles are shown in their original language.")}</p>
    </Card>
  );
}

export default function Sources() {
  const { data } = usePoll<SourcesData>("/api/sources", 60000);
  if (!data) return <Empty />;
  const kind: Record<string, string> = { model: t("model"), threshold: t("threshold"), estimate: t("estimate"), cross_rule: t("cross-source rule"),
    protocol_rule: t("protocol rule"), recommendation: t("recommendation"), nutrition_target: t("nutrition target"), link: t("link") };
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageTitle>{t("Data sources")}</PageTitle>
      <div className="rounded-2xl border-2 border-warn/60 bg-warn/5 p-4 text-warn">{data.disclaimer} {t("All device data in this app is simulated.")}</div>

      <Card title={t("Reference values (verified)")}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="text-sm text-slate-400"><tr><th className="py-2">{t("Value")}</th><th>{t("Reference")}</th><th>{t("Source")}</th><th></th></tr></thead>
            <tbody>
              {data.references.map((r) => (
                <tr key={r.id} className="border-t border-ink-800 align-top">
                  <td className="py-2 pr-3 font-semibold">{r.label}</td>
                  <td className="pr-3">
                    {String(r.value)} {typeof r.value === "number" ? r.unit : ""}
                    {r.sd ? ` ± ${r.sd}` : ""}{r.range ? ` (${t("range {a}–{b}", { a: r.range[0], b: r.range[1] })})` : ""}
                    {r.note && <div className="text-sm text-slate-400">{r.note}</div>}
                  </td>
                  <td className="pr-3 text-sm"><SourceText s={r.source} /></td>
                  <td><SourceTag verified={r.verified} source={r.source} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={t("Values still marked unverified ({n})", { n: data.unverified.length })}>
        <p className="mb-2 text-sm text-slate-400">{t("These are simulation assumptions or typical clinical ranges. They have not been checked against a NASA source and show an “unverified” tag wherever they appear.")}</p>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <tbody>
              {data.unverified.map((u, i) => (
                <tr key={i} className="border-t border-ink-800 align-top">
                  <td className="py-1.5 pr-3 text-slate-400">{kind[u.kind] ?? u.kind}</td>
                  <td className="pr-3">{u.description}</td>
                  <td className="text-slate-500">{t(u.source)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t("Alert thresholds")}>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <tbody>
                {data.thresholds.map((x, i) => (
                  <tr key={i} className="border-t border-ink-800">
                    <td className="py-1.5 pr-2">{x.label}{phaseWords(x.phases)}</td>
                    <td className="pr-2 tabular-nums">{x.rule} {x.unit}</td>
                    <td className="pr-2" style={{ color: x.level === "red" ? C.bad : C.warn }}>{levelWord(x.level)}</td>
                    <td><SourceTag verified={x.verified} source={x.source} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title={t("Cross-source rules")}>
          <ul className="max-h-96 space-y-3 overflow-y-auto">
            {data.cross_rules.map((r) => (
              <li key={r.id} className="border-t border-ink-700 pt-3 pb-1">
                <div className="flex items-center justify-between gap-2 font-semibold">{r.title}{phaseWords(r.phases)} <SourceTag verified={r.verified} source={r.source} /></div>
                <div className="mt-1 tabular-nums text-sm text-slate-300">{r.when.map((c) => `${c.metric}.${c.field} ${c.op} ${c.value}`).join(t("  AND  "))}</div>
                <div className="text-sm" style={{ color: r.level === "red" ? C.bad : C.warn }}>{levelWord(r.level)}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title={t("Recommendation list (fixed)")}>
        <ul className="space-y-2">
          {data.recommendations.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-2"><span className="w-40 shrink-0 tabular-nums text-sm text-slate-500">{r.id}</span><span className="flex-1">{r.text}</span><SourceTag verified={r.verified} source={r.source} /></li>
          ))}
        </ul>
      </Card>

      <OsdrPanel />
    </div>
  );
}
