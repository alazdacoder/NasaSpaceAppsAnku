/** One small, consistent icon set: 24-unit grid, 2px round strokes, currentColor. */
const PATHS: Record<string, string> = {
  today: "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  exercise: "M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11",
  energy: "M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 1.6 1 2.6 2 3 0-3 .5-5.5.5-8z",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  food: "M5 3v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M7 12v9M16 3c-1.7 0-3 2-3 5s1.3 4 3 4v9",
  mind: "M9.5 4.5A3 3 0 0 0 6 7.5a3 3 0 0 0-1.5 5.3A3 3 0 0 0 8 17.5a3 3 0 0 0 4 1.7V5.2a3 3 0 0 0-2.5-.7zM14.5 4.5A3 3 0 0 1 18 7.5a3 3 0 0 1 1.5 5.3 3 3 0 0 1-3.5 4.7 3 3 0 0 1-4 1.7",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0",
  pulse: "M3 12h4l2.5-6 4 12 2.5-6H21",
  flask: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9",
  apple: "M12 7c-1-2-3-3-5-2.5C4.5 5.2 4 8 4.5 11c.6 4 3 8 5.5 8 1 0 1.3-.5 2-.5s1 .5 2 .5c2.5 0 4.9-4 5.5-8 .5-3-.5-5.8-2.5-6.5-2-.5-4 .5-5 2.5zM12 7c0-2 1-3.5 2.5-4",
  compass: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z",
  clipboard: "M9 4h6v3H9zM9 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H15M12 11v6M9 14h6",
  radiation: "M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM10.6 10.3 7 4.5a8 8 0 0 0-4 7h6.5M13.4 10.3 17 4.5a8 8 0 0 1 4 7h-6.5M12 13.5V20a8 8 0 0 0 7-4M12 20a8 8 0 0 1-7-4",
  chip: "M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 7.5v.5",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  droplet: "M12 3s-6 6.5-6 11a6 6 0 0 0 12 0c0-4.5-6-11-6-11z",
  wrench: "M14.5 6.5a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 0-2-2zM14.5 6.5 17 4",
  smile: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5v.5M15 9.5v.5",
  phone: "M6.5 3.5h3l1.5 4-2 1.5a10 10 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2z",
  cross: "M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z",
  star: "M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z",
  pause: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10 9v6M14 9v6",
  card: "M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM6.5 9.5h3v2.5h-3zM6.5 15h7M15 10h3M15 13h3",
  nfc: "M7.5 8.5a5 5 0 0 1 0 7M11 6a8.5 8.5 0 0 1 0 12M14.5 3.5a12 12 0 0 1 0 17",
  user: "M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4.5 20a7.5 7.5 0 0 1 15 0",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  alert: "M12 4 2.5 20h19zM12 10v4.5M12 17.5v.5",
  chevron: "M9 6l6 6-6 6",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  scan: "M4 8V6a2 2 0 0 1 2-2h2M4 16v2a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v2M16 20h2a2 2 0 0 0 2-2v-2M7 12h10",
  sos: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v5M12 16.5v.5",
  orbit: "M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0M3 12c0-3.5 4-6.5 9-6.5s9 3 9 6.5-4 6.5-9 6.5-9-3-9-6.5z",
  satellite: "M4.9 19.1C3 17.2 2 14.7 2 12s1-5.2 2.9-7.1M7.8 16.2c-1.2-1.1-1.8-2.6-1.8-4.2s.6-3.1 1.8-4.2M16.2 7.8c1.2 1.1 1.8 2.6 1.8 4.2s-.6 3.1-1.8 4.2M19.1 4.9C21 6.8 22 9.3 22 12s-1 5.2-2.9 7.1M12 12h.01",
  shield: "M12 3l7 3v5c0 5-3.2 8.7-7 10-3.8-1.3-7-5-7-10V6l7-3z",
  sliders: "M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M11 16v4",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className, label }: { name: IconName | string; size?: number; className?: string; label?: string }) {
  const d = PATHS[name] ?? PATHS.info;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
      strokeLinejoin="round" className={className} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={d} />
    </svg>
  );
}

/** Activity kinds on the energy timeline. */
export const ACTIVITY_ICON: Record<string, IconName> = {
  sleep: "moon", hygiene: "droplet", meal: "food", planning: "clipboard", science: "flask", maintenance: "wrench",
  exercise: "exercise", leisure: "smile", family_call: "phone", medical: "cross", vestibular_rehab: "compass",
  eva: "star", rest: "pause", skipped: "pause",
};
