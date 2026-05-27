import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import pkg from "./package.json" with { type: "json" };

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ mode }) => {
  // Make package.json version available as import.meta.env.VITE_APP_VERSION
  // so the UI can display the running version (proof-of-build).
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
      watch: { ignored: ["**/src-tauri/**"] },
    },
    envPrefix: ["VITE_", "TAURI_ENV_*"],
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(env.VITE_APP_VERSION ?? pkg.version),
      "import.meta.env.VITE_BUILD_TIME": JSON.stringify(new Date().toISOString()),
    },
  };
});
