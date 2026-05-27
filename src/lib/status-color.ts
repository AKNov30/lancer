/**
 * Canonical HTTP status-code → CSS-variable color map. Single source of truth
 * for the status colors used across the response viewer and history sheet.
 * Each color resolves against the active theme via the semantic `--color-*`
 * custom properties defined in the global stylesheet.
 *
 * Buckets follow the standard HTTP families: 5xx → destructive, 4xx → warning,
 * 3xx → info, 2xx → success, anything else → muted foreground.
 */
export function statusColor(code: number): string {
  if (code >= 500) return "var(--color-destructive)";
  if (code >= 400) return "var(--color-warning)";
  if (code >= 300) return "var(--color-info)";
  if (code >= 200) return "var(--color-success)";
  return "var(--color-muted-foreground)";
}
