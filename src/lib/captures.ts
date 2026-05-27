import { JSONPath } from "jsonpath-plus";
import type { Capture } from "@/stores/request-store";

/**
 * Apply post-response captures to a response body. Returns the list of
 * `[varName, value]` pairs to merge into the runtime overlay.
 *
 * Failure modes are silent: a JSONPath that fails to parse, a body that
 * isn't JSON, or a match that returns `undefined`/`null` all just skip the
 * capture. A single bad expression must NOT abort the others — chained
 * captures often share a response and we want partial success.
 */
export function runCaptures(
  captures: Capture[],
  bodyText: string | null | undefined,
): Array<[string, string]> {
  if (!bodyText || captures.length === 0) return [];
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return [];
  }
  const out: Array<[string, string]> = [];
  for (const c of captures) {
    if (!c.enabled || !c.envVar.trim() || !c.jsonpath.trim()) continue;
    try {
      const matches = JSONPath({ path: c.jsonpath, json: json as object, wrap: false });
      if (matches === undefined || matches === null) continue;
      const value = typeof matches === "string" ? matches : JSON.stringify(matches);
      out.push([c.envVar.trim(), value]);
    } catch {
      // Bad JSONPath expression — skip silently.
    }
  }
  return out;
}
