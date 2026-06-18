import type { TestResult } from "@/lib/types";

/**
 * Inputs the runner has after a step finishes. A transport failure (network /
 * parse error) is signalled by `transportOk: false` — in that case the step
 * fails regardless of assertions.
 */
export interface StepOutcome {
  /** True when the request itself completed with a 2xx status. */
  transportOk: boolean;
  /** Assertion results from the post-response script (empty if none ran). */
  tests: TestResult[];
  /** Hard script error (syntax / uncaught) — fails the step if present. */
  scriptError?: string | null;
}

export interface StepVerdict {
  passed: boolean;
  /** Number of assertions that passed. */
  assertionsPassed: number;
  /** Total assertions that ran. */
  assertionsTotal: number;
  /** Number of assertions that failed (derived). */
  assertionsFailed: number;
}

/**
 * Decide whether a collection-runner step passes.
 *
 * Rule:
 *  - A hard `scriptError` always fails the step.
 *  - When the step has assertions, it passes only if the transport succeeded
 *    AND every assertion passed.
 *  - When the step has NO assertions, fall back to the legacy 2xx rule
 *    (`transportOk`).
 *
 * This keeps existing assertion-free collections behaving exactly as before
 * while surfacing assertion failures on requests that do have tests.
 */
export function stepVerdict(outcome: StepOutcome): StepVerdict {
  const assertionsTotal = outcome.tests.length;
  const assertionsPassed = outcome.tests.filter((t) => t.passed).length;
  const assertionsFailed = assertionsTotal - assertionsPassed;

  const hasScriptError = Boolean(outcome.scriptError);
  const passed = hasScriptError
    ? false
    : assertionsTotal > 0
      ? outcome.transportOk && assertionsFailed === 0
      : outcome.transportOk;

  return { passed, assertionsPassed, assertionsTotal, assertionsFailed };
}
