import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // The web demo (GitHub Pages) lives under /<repo>/; every other build is served from /.
  base: process.env.SHMS_BASE || "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 1200 },
  worker: { format: "es" },
});
