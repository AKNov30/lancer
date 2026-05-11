import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { initTelemetry } from "@/lib/telemetry";
import App from "./App";

initTelemetry();

// biome-ignore lint/style/noNonNullAssertion: standard Vite scaffold — root element is always present
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
