/** @type {import('tailwindcss').Config} */
// "Cupola Daylight" (light) and "Cupola Night" (dark). Every colour is a CSS variable
// holding "R G B", set in index.css for each theme, so opacity modifiers keep working.
// The `ink` scale names surfaces (950 = page, 900 = card, 850 = soft tile, 800/700 = wells
// and hairlines) and `fg` / `slate` name text, so every page reads the same tokens.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "./frontend/index.html", "./frontend/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: v("ink-950"),
          925: v("ink-925"),
          900: v("ink-900"),
          850: v("ink-850"),
          800: v("ink-800"),
          700: v("ink-700"),
          600: v("ink-600"),
        },
        fg: v("fg"),
        limb: v("limb"),
        sun: v("sun"),
        slate: {
          50: v("slate-50"),
          100: v("slate-100"),
          200: v("slate-200"),
          300: v("slate-300"),
          400: v("slate-400"),
          500: v("slate-500"),
          600: v("slate-600"),
          700: v("slate-700"),
        },
        ok: v("ok"),
        warn: v("warn"),
        bad: v("bad"),
        badfill: v("bad-fill"),
        accent: v("accent"),
        energy: v("energy"),
        rest: v("rest"),
        telemetry: v("rest"),
        // soft state grounds for alerts and selection
        warnsoft: v("warn-soft"),
        badsoft: v("bad-soft"),
        accentsoft: v("accent-soft"),
      },
      borderRadius: { card: "24px", tile: "18px" },
      boxShadow: {
        card: "var(--shadow-card)",
        lift: "var(--shadow-lift)",
        // kept as names so old call sites stay valid; all are soft offset shadows
        glowBlue: "0 6px 16px -8px rgb(var(--accent) / 0.55)",
        glowGreen: "0 6px 16px -10px rgb(var(--ok) / 0.45)",
        glowViolet: "0 6px 16px -10px rgb(var(--rest) / 0.45)",
        glowRed: "0 6px 18px -10px rgb(var(--bad) / 0.5)",
        glowAmber: "0 6px 18px -10px rgb(var(--warn) / 0.45)",
      },
      fontFamily: {
        sans: ['"Public Sans"', "system-ui", "-apple-system", '"Segoe UI"', "Roboto", "sans-serif"],
      },
      fontSize: { base: ["16px", "1.5"] },
    },
  },
  plugins: [],
};
