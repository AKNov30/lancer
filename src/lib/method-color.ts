import type { Method } from "@/lib/types";

/**
 * Canonical HTTP-method → CSS-variable color map. Single source of truth for
 * the method colors used across the sidebar, tab bar, command palette, history,
 * runner, and method picker. Each color resolves against the active theme via
 * the `--color-method-*` custom properties defined in the global stylesheet.
 */
export const METHOD_COLOR: Record<Method, string> = {
  GET: "var(--color-method-get)",
  POST: "var(--color-method-post)",
  PUT: "var(--color-method-put)",
  PATCH: "var(--color-method-patch)",
  DELETE: "var(--color-method-delete)",
  HEAD: "var(--color-method-head)",
  OPTIONS: "var(--color-method-options)",
};

/**
 * Resolve the color for any method string. Accepts a loose `string` (e.g. a
 * method read off a `.bru` file or history entry) and falls back to the muted
 * foreground for anything that isn't a known HTTP method.
 */
export function methodColor(method: string): string {
  return METHOD_COLOR[method as Method] ?? "var(--color-muted-foreground)";
}
