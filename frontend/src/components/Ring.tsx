import type { ReactNode } from "react";
import { themePalette } from "../lib/theme";

/**
 * Ring gauge. `sweep` 360 = a full progress ring; less = an open gauge (gap at the bottom).
 * `marker` draws a small dot on the track, e.g. the wearer's personal normal or a limit.
 */
export function Ring({ value, min = 0, max = 1, marker, color, size = 112, stroke = 10, sweep = 360, children, label, sub }: {
  value: number | null | undefined; min?: number; max?: number; marker?: number | null; color: string; size?: number; stroke?: number;
  sweep?: number; children?: ReactNode; label?: string; sub?: ReactNode; glow?: boolean;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = (sweep / 360) * c;
  const frac = (x: number) => Math.max(0, Math.min(1, (x - min) / (max - min || 1)));
  const f = value === null || value === undefined || Number.isNaN(value) ? 0 : frac(value);
  const start = 90 + (360 - sweep) / 2;              // degrees, clockwise from 3 o'clock
  let dot: { x: number; y: number } | null = null;
  if (marker !== null && marker !== undefined) {
    const a = ((start + frac(marker) * sweep) * Math.PI) / 180;
    dot = { x: size / 2 + r * Math.cos(a), y: size / 2 + r * Math.sin(a) };
  }
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <g transform={`rotate(${start} ${size / 2} ${size / 2})`} fill="none" strokeLinecap="round" strokeWidth={stroke}>
          <circle cx={size / 2} cy={size / 2} r={r} stroke={themePalette().track} strokeDasharray={`${arc} ${c}`} />
          <circle className="ring-arc" cx={size / 2} cy={size / 2} r={r} stroke={color} strokeDasharray={`${arc} ${c}`}
            strokeDashoffset={arc * (1 - f)}
            style={{ opacity: f > 0 ? 1 : 0 }} />
        </g>
        {dot && <circle cx={dot.x} cy={dot.y} r={stroke / 2 - 1.5} fill={themePalette().tipBg} stroke={color} strokeWidth={2} />}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        {children ?? (
          <>
            {label && <span className={`${size < 70 ? "text-[11px]" : size < 100 ? "text-base" : "text-xl"} font-black tracking-tight tabular-nums text-fg`}>{label}</span>}
            {sub && <span className="mt-1 text-[10px] font-bold text-slate-400">{sub}</span>}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Samsung Health-inspired Concentric Activity Rings & Orbital Progress Ring.
 * Renders up to 3 nested glowing rings with smooth caps.
 */
export function ConcentricRings({
  rings,
  size = 128,
  stroke = 9,
  gap = 4,
  children,
  label,
}: {
  rings: { value: number; max: number; color: string }[];
  size?: number;
  stroke?: number;
  gap?: number;
  children?: ReactNode;
  label?: string;
}) {
  const center = size / 2;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <g transform={`rotate(-90 ${center} ${center})`} fill="none" strokeLinecap="round" strokeWidth={stroke}>
          {rings.map((ring, idx) => {
            const r = (size - stroke) / 2 - idx * (stroke + gap);
            if (r <= 6) return null;
            const c = 2 * Math.PI * r;
            const f = Math.max(0.03, Math.min(1, ring.value / (ring.max || 1)));
            return (
              <g key={idx}>
                <circle cx={center} cy={center} r={r} stroke={ring.color} strokeOpacity={0.16} />
                <circle
                  className="ring-arc"
                  cx={center}
                  cy={center}
                  r={r}
                  stroke={ring.color}
                  strokeDasharray={`${c} ${c}`}
                  strokeDashoffset={c * (1 - f)}

                />
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">{children}</div>
    </div>
  );
}
