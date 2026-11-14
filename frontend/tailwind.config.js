/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#04060b", 900: "#0a0f1a", 850: "#0f1624", 800: "#151e2f", 700: "#1f2a40", 600: "#2c3a55" },
        ok: "#22c55e",
        warn: "#fbbf24",
        bad: "#f43f5e",
        accent: "#38bdf8",
      },
      fontSize: { base: ["17px", "1.5"] },
    },
  },
  plugins: [],
};
