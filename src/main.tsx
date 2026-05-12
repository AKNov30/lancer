import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { initTelemetry } from "@/lib/telemetry";
import { useTheme } from "@/stores/theme-store";
import App from "./App";

initTelemetry();
useTheme.getState().init();

// biome-ignore lint/style/noNonNullAssertion: standard Vite scaffold — root element is always present
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
