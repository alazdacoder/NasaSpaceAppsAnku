import { fileURLToPath } from "node:url";

// fileURLToPath gives a real path on Windows too ("D:\..."), unlike URL.pathname ("/D:/...").
export default { plugins: { tailwindcss: { config: fileURLToPath(new URL("./tailwind.config.js", import.meta.url)) }, autoprefixer: {} } };
