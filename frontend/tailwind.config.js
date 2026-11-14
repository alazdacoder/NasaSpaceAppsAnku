/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "./frontend/index.html", "./frontend/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Deep OLED dark mode (#0D0F12 primary surface with #181C24 card backgrounds)
        ink: {
          950: "#0D0F12",
          925: "#12151B",
          900: "#181C24",
          850: "#1E2430",
          800: "#252C3A",
          700: "#2F384A",
          600: "#3E4A61",
        },
        ok: "#00E676",        // Samsung Health vibrant health green
        warn: "#FF9100",      // Warning amber
        bad: "#FF5252",       // Critical red / coral
        accent: "#00E5FF",    // Samsung Health electric blue
        energy: "#FF9100",    // Calories, nutrition, activity amber
        rest: "#B388FF",      // Telemetry violet / space & antigravity modules
        telemetry: "#B388FF", // Space & antigravity telemetry violet
      },
      borderRadius: { card: "28px", tile: "22px" },
      boxShadow: {
        card: "inset 0 1px 0 rgba(255,255,255,0.06), 0 14px 32px -16px rgba(0,0,0,0.82)",
        lift: "inset 0 1px 0 rgba(255,255,255,0.10), 0 20px 42px -14px rgba(0,0,0,0.9)",
        glowBlue: "0 0 28px -6px rgba(0, 229, 255, 0.35)",
        glowGreen: "0 0 28px -6px rgba(0, 230, 118, 0.35)",
        glowViolet: "0 0 28px -6px rgba(179, 136, 255, 0.38)",
        glowRed: "0 0 32px -4px rgba(255, 82, 82, 0.45)",
      },
      fontFamily: {
        sans: ["Inter", "Roboto", '"One UI Sans"', '"Google Sans"', '"Segoe UI Variable Text"', "system-ui", "-apple-system", "sans-serif"],
      },
      fontSize: { base: ["16px", "1.5"] },
    },
  },
  plugins: [],
};
