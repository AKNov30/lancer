import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { initTelemetry } from "@/lib/telemetry";
import { useTheme } from "@/stores/theme-store";
import App from "./App";

initTelemetry();
useTheme.getState().init();

// One-shot localStorage migration: clear ALL react-resizable-panels keys so
// any corrupted layout from before the scrollbar/handle fix is wiped.
// (The actual key format is `react-resizable-panels:<autoSave>` — verified
// against v4.11 source. The old guess `PanelGroup:sizes:*` was wrong.)
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k?.startsWith("react-resizable-panels:")) {
      localStorage.removeItem(k);
    }
  }
} catch {
  /* localStorage unavailable */
}

// biome-ignore lint/style/noNonNullAssertion: standard Vite scaffold — root element is always present
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
