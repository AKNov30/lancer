import * as Sentry from "@sentry/browser";

const ENABLED_KEY = "lancer.telemetry.crashReports";

const DEFAULT_DSN = import.meta.env.VITE_TELEMETRY_DSN ?? "";
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "0.0.0";

export function isTelemetryEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ENABLED_KEY) === "true";
}

export function setTelemetryEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ENABLED_KEY, String(enabled));
}

let initialised = false;

/**
 * Opt-in crash reporting. Disabled by default; the user must explicitly
 * toggle it on in Settings → Privacy. Even when enabled, no telemetry is
 * sent unless a DSN is configured at build time via `VITE_TELEMETRY_DSN`.
 */
export function initTelemetry(): void {
  if (initialised) return;
  if (!isTelemetryEnabled()) return;
  if (!DEFAULT_DSN) return;

  Sentry.init({
    dsn: DEFAULT_DSN,
    release: `lancer@${APP_VERSION}`,
    tracesSampleRate: 0, // crash reports only — no performance traces
    sendDefaultPii: false,
    // Scrub anything that smells like a credential before sending.
    beforeSend(event) {
      // Redact any header values that look like auth tokens.
      if (event.request?.headers) {
        for (const k of Object.keys(event.request.headers)) {
          if (/auth|key|token|secret|password|cookie/i.test(k)) {
            event.request.headers[k] = "[redacted]";
          }
        }
      }
      return event;
    },
  });
  initialised = true;
}
