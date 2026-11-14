import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setLandingDay, usePoll, type Clock, type LinkStatus } from "./api";
import { t, useLang } from "./i18n";

export interface Meta {
  app_name: string; disclaimer: string;
  crew: { id: string; name: string; role: string }[];
  clock: Clock;
  profiles: Record<string, { label: string; delay_s: number; delay_min_s: number; delay_max_s: number; verified: boolean }>;
  injectable_events: Record<string, { label: string; days: number }>;
  metrics: Record<string, { label: string; unit: string; decimals: number; group: string; meaning: string; verified: boolean }>;
}

interface Ctx {
  meta: Meta | null;
  crewId: string;
  setCrewId: (id: string) => void;
  clock: Clock | null;
  link: LinkStatus | null;
  refreshClock: () => void;
}

const AppCtx = createContext<Ctx | null>(null);

function readCrew(): string {
  try { return localStorage.getItem("crewId") || "c1"; } catch { return "c1"; }
}

export function crewLabel(id: string, idx?: number): string {
  const n = idx !== undefined ? idx + 1 : Number(String(id).replace(/\D+/g, "")) || 1;
  return t("Astronaut {n}", { n });
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [crewId, setCrew] = useState<string>(readCrew);
  const { lang } = useLang();
  const { data, refresh } = usePoll<Clock & { link: LinkStatus }>("/api/clock", 1000);

  useEffect(() => {
    let alive = true;
    const load = () => api<Meta>("/api/meta").then((m) => {
      if (!alive) return;
      setLandingDay(m.clock.landing_day);
      const normalizedCrew = (m.crew ?? []).map((c, idx) => ({
        ...c,
        name: crewLabel(c.id, idx),
      }));
      const injectable = { ...(m.injectable_events ?? {}) };
      if (!injectable.ocular_spike) {
        injectable.ocular_spike = { label: t("Acute Ocular & Biologic Liquid Shift Spike"), days: 2 };
      }
      setMeta({ ...m, crew: normalizedCrew, injectable_events: injectable });
    }).catch(() => setTimeout(load, 1500));
    load();
    return () => { alive = false; };
  }, [lang]);

  useEffect(() => {
    if (data?.landing_day) setLandingDay(data.landing_day);
  }, [data?.landing_day]);

  const setCrewId = (id: string) => {
    setCrew(id);
    try { localStorage.setItem("crewId", id); } catch { /* ignore */ }
  };

  return (
    <AppCtx.Provider value={{ meta, crewId, setCrewId, clock: data, link: data?.link ?? null, refreshClock: refresh }}>
      {children}
    </AppCtx.Provider>
  );
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("AppProvider missing");
  return c;
}

export function useCrewName(): string {
  const { meta, crewId } = useApp();
  return meta?.crew.find((c) => c.id === crewId)?.name ?? crewLabel(crewId);
}
