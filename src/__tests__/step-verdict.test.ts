import { describe, expect, it } from "vitest";
import { stepVerdict } from "@/lib/step-verdict";
import type { TestResult } from "@/lib/types";

const pass = (name: string): TestResult => ({ name, passed: true });
const fail = (name: string, error = "expected x to be y"): TestResult => ({
  name,
  passed: false,
  error,
});

describe("stepVerdict — collection-runner pass rule", () => {
  it("fails a step with a failing assertion even on a 2xx response", () => {
    const v = stepVerdict({
      transportOk: true,
      tests: [pass("status is 200"), fail("body has token")],
    });
    expect(v.passed).toBe(false);
    expect(v.assertionsPassed).toBe(1);
    expect(v.assertionsFailed).toBe(1);
    expect(v.assertionsTotal).toBe(2);
  });

  it("passes a step where all assertions pass on a 2xx response", () => {
    const v = stepVerdict({
      transportOk: true,
      tests: [pass("status is 200"), pass("body has token")],
    });
    expect(v.passed).toBe(true);
    expect(v.assertionsPassed).toBe(2);
    expect(v.assertionsFailed).toBe(0);
  });

  it("falls back to transport status when there are no assertions", () => {
    expect(stepVerdict({ transportOk: true, tests: [] }).passed).toBe(true);
    expect(stepVerdict({ transportOk: false, tests: [] }).passed).toBe(false);
  });

  it("fails when the transport failed even if all assertions passed", () => {
    const v = stepVerdict({
      transportOk: false,
      tests: [pass("body shape ok")],
    });
    expect(v.passed).toBe(false);
  });

  it("fails on a hard script error regardless of assertions/status", () => {
    const v = stepVerdict({
      transportOk: true,
      tests: [pass("status is 200")],
      scriptError: "ReferenceError: foo is not defined",
    });
    expect(v.passed).toBe(false);
  });
});
