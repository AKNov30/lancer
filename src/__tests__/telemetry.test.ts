import { beforeEach, describe, expect, it } from "vitest";
import { isTelemetryEnabled, setTelemetryEnabled } from "@/lib/telemetry";

describe("telemetry", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("is disabled by default", () => {
    expect(isTelemetryEnabled()).toBe(false);
  });

  it("setTelemetryEnabled(true) flips the flag", () => {
    setTelemetryEnabled(true);
    expect(isTelemetryEnabled()).toBe(true);
  });

  it("setTelemetryEnabled(false) clears the flag", () => {
    setTelemetryEnabled(true);
    setTelemetryEnabled(false);
    expect(isTelemetryEnabled()).toBe(false);
  });
});
