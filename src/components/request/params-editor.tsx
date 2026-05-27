import { KvTable } from "@/components/ui/kv-table";
import { type KvRow, kvRowsToTuples } from "@/lib/types";
import { useRequest } from "@/stores/request-store";

/**
 * Editor for URL query parameters with one-way sync into the URL:
 *
 * When the user edits a query row, we strip the URL's existing `?…` and
 * append the rebuilt query string. The URL bar remains the source of truth
 * for the base path — typing into the URL there does not retroactively
 * rewrite rows (avoids fight-the-cursor bugs).
 */
export function ParamsEditor() {
  const query = useRequest((s) => s.request.query);
  const setUrl = useRequest((s) => s.setUrl);
  const setQuery = useRequest((s) => s.setQuery);
  const url = useRequest((s) => s.request.url);

  function applyQuery(rows: KvRow[]) {
    setQuery(rows);
    const tuples = kvRowsToTuples(rows);
    const qIdx = url.indexOf("?");
    const base = qIdx === -1 ? url : url.slice(0, qIdx);
    if (tuples.length === 0) {
      setUrl(base);
    } else {
      const search = new URLSearchParams(tuples).toString();
      setUrl(`${base}?${search}`);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <KvTable
        rows={query}
        onChange={applyQuery}
        keyPlaceholder="param"
        valuePlaceholder="value"
        hint="Query params are appended to the URL automatically. Disable a row with the checkbox to skip it without deleting."
      />
    </div>
  );
}
