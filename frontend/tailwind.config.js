/** @type {import('tailwindcss').Config} */
// "Cupola Daylight" (light) and "Cupola Night" (dark). Every colour is a CSS variable
// holding "R G B", set in index.css for each theme, so opacity modifiers keep working.
// The `ink` scale names surfaces (950 = page, 900 = card, 850 = soft tile, 800/700 = wells
// and hairlines) and `fg` / `slate` name text, so every page reads the same tokens.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "./frontend/index.html", "./frontend/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "rgb(var(--ink-950) / <alpha-value>)",
          925: "rgb(var(--ink-925) / <alpha-value>)",
          900: "rgb(var(--ink-900) / <alpha-value>)",
          850: "rgb(var(--ink-850) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
        },
        fg: "rgb(var(--fg) / <alpha-value>)",
        limb: "rgb(var(--limb) / <alpha-value>)",
        sun: "rgb(var(--sun) / <alpha-value>)",
        slate: {
          50: "rgb(var(--slate-50) / <alpha-value>)",
          100: "rgb(var(--slate-100) / <alpha-value>)",
          200: "rgb(var(--slate-200) / <alpha-value>)",
          300: "rgb(var(--slate-300) / <alpha-value>)",
          400: "rgb(var(--slate-400) / <alpha-value>)",
          500: "rgb(var(--slate-500) / <alpha-value>)",
          600: "rgb(var(--slate-600) / <alpha-value>)",
          700: "rgb(var(--slate-700) / <alpha-value>)",
        },
        ok: "rgb(var(--ok) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        bad: "rgb(var(--bad) / <alpha-value>)",
        badfill: "rgb(var(--bad-fill) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        energy: "rgb(var(--energy) / <alpha-value>)",
        rest: "rgb(var(--rest) / <alpha-value>)",
        telemetry: "rgb(var(--rest) / <alpha-value>)",
        // soft state grounds for alerts and selection
        warnsoft: "rgb(var(--warn-soft) / <alpha-value>)",
        badsoft: "rgb(var(--bad-soft) / <alpha-value>)",
        accentsoft: "rgb(var(--accent-soft) / <alpha-value>)",
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
