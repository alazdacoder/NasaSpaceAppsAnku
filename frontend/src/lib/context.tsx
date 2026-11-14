import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setLandingDay, usePoll, type Clock, type LinkStatus } from "./api";

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

export function AppProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [crewId, setCrew] = useState<string>(readCrew);
  const { data, refresh } = usePoll<Clock & { link: LinkStatus }>("/api/clock", 1000);

  useEffect(() => {
    let alive = true;
    const load = () => api<Meta>("/api/meta").then((m) => {
      if (!alive) return;
      setLandingDay(m.clock.landing_day);
      setMeta(m);
    }).catch(() => setTimeout(load, 1500));
    load();
    return () => { alive = false; };
  }, []);

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
  return meta?.crew.find((c) => c.id === crewId)?.name ?? "";
}
