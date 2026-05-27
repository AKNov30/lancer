import { GripVerticalIcon, XIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import type { KvRow } from "@/lib/types";
import { cn } from "@/lib/utils";

interface KvTableProps {
  rows: KvRow[];
  onChange: (rows: KvRow[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Optional description column (Postman-style) */
  showDescription?: boolean;
  /** Optional hint shown beneath the table */
  hint?: string;
  /** Class for the outer container */
  className?: string;
}

/**
 * A k-v table editor with per-row enabled toggle, drag-handle affordance,
 * delete-on-hover, and an always-present empty trailing row (Bruno /
 * Postman pattern).
 *
 * The trailing empty row is *synthesized* in the display layer rather than
 * being a separate phantom Input — this way typing into it promotes the
 * row in-place via the same onChange code path real rows use, so focus is
 * preserved by React's reconciliation (no focus-transfer hacks).
 */
export function KvTable({
  rows,
  onChange,
  keyPlaceholder = "key",
  valuePlaceholder = "value",
  showDescription = false,
  hint,
  className,
}: KvTableProps) {
  /**
   * Display rows = real rows + one synthesized empty trailing row.
   * The trailing row's index is always `rows.length`.
   */
  const displayRows = useMemo<KvRow[]>(
    () => [...rows, { enabled: true, key: "", value: "" }],
    [rows],
  );
  const trailingIdx = rows.length;

  const handleChange = useCallback(
    (idx: number, patch: Partial<KvRow>) => {
      if (idx === trailingIdx) {
        // User typed into the synthesized trailing row → append as a real row.
        // React keeps the SAME input DOM element in place (the new real row
        // takes index N; a fresh trailing row appears at N+1) so focus is
        // preserved without manual focus management.
        onChange([...rows, { ...displayRows[idx], ...patch }]);
      } else {
        onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
      }
    },
    [rows, displayRows, trailingIdx, onChange],
  );

  const removeRow = useCallback(
    (idx: number) => {
      if (idx === trailingIdx) return; // can't remove the trailing phantom
      onChange(rows.filter((_, i) => i !== idx));
    },
    [rows, trailingIdx, onChange],
  );

  /** Total grid columns including drag handle, enabled, key, value, [description], delete */
  const gridCols = useMemo(() => {
    if (showDescription) return "20px 24px 1fr 1.5fr 1fr 28px";
    return "20px 24px 1fr 1.5fr 28px";
  }, [showDescription]);

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Header row */}
      <div
        className="grid items-center gap-2 border-border/40 border-b px-1 py-1.5 font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase"
        style={{ gridTemplateColumns: gridCols }}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span>Key</span>
        <span>Value</span>
        {showDescription && <span>Description</span>}
        <span aria-hidden="true" />
      </div>

      {/* Data rows */}
      <div role="list" className="flex flex-col">
        {displayRows.map((row, idx) => {
          const isTrailing = idx === trailingIdx;
          return (
            <KvTableRow
              key={idx}
              row={row}
              gridCols={gridCols}
              keyPlaceholder={keyPlaceholder}
              valuePlaceholder={valuePlaceholder}
              showDescription={showDescription}
              isTrailing={isTrailing}
              onChange={(patch) => handleChange(idx, patch)}
              onRemove={() => removeRow(idx)}
            />
          );
        })}
      </div>

      {hint && <p className="mt-2 px-1 text-muted-foreground text-[11px] italic">{hint}</p>}
    </div>
  );
}

interface RowProps {
  row: KvRow;
  gridCols: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  showDescription: boolean;
  /** True if this is the synthesized empty trailing row */
  isTrailing: boolean;
  onChange: (patch: Partial<KvRow>) => void;
  onRemove: () => void;
}

function KvTableRow({
  row,
  gridCols,
  keyPlaceholder,
  valuePlaceholder,
  showDescription,
  isTrailing,
  onChange,
  onRemove,
}: RowProps) {
  return (
    <div
      role="listitem"
      className={cn(
        "group/row grid items-center gap-2 rounded-sm px-1 py-1 transition-colors duration-150",
        "hover:bg-accent/30",
        !row.enabled && !isTrailing && "opacity-50",
        isTrailing && "opacity-60 hover:opacity-100",
      )}
      style={{ gridTemplateColumns: gridCols }}
    >
      {/* Drag handle (visual only for now) */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        disabled={isTrailing}
        className={cn(
          "grid h-5 w-5 cursor-grab place-items-center text-muted-foreground/30 opacity-0 transition-opacity active:cursor-grabbing",
          !isTrailing && "group-hover/row:opacity-100",
          isTrailing && "cursor-default",
        )}
      >
        <GripVerticalIcon className="size-3" strokeWidth={1.75} aria-hidden="true" />
      </button>

      {/* Enabled checkbox — dashed border on the trailing row */}
      <button
        type="button"
        role="checkbox"
        aria-checked={row.enabled}
        onClick={() => !isTrailing && onChange({ enabled: !row.enabled })}
        disabled={isTrailing}
        className={cn(
          "grid size-4 place-items-center rounded-sm border transition-all duration-150",
          isTrailing
            ? "cursor-default border-dashed border-muted-foreground/30 text-muted-foreground/40"
            : row.enabled
              ? "cursor-pointer border-primary bg-primary text-primary-foreground shadow-xs"
              : "cursor-pointer border-border bg-background hover:border-primary/50",
        )}
        title={isTrailing ? "" : row.enabled ? "Disable row" : "Enable row"}
      >
        {isTrailing ? (
          <svg viewBox="0 0 16 16" className="size-2.5" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          row.enabled && (
            <svg
              viewBox="0 0 16 16"
              className="size-3 animate-in fade-in-0 zoom-in-50 duration-150"
              aria-hidden="true"
            >
              <path
                d="M3 8.5l3 3 7-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )
        )}
      </button>

      {/* Key */}
      <Input
        value={row.key}
        onChange={(e) => onChange({ key: e.target.value })}
        placeholder={keyPlaceholder}
        aria-label={keyPlaceholder}
        className="h-7 cursor-text border-transparent bg-transparent px-2 font-mono text-xs shadow-none hover:border-border focus:border-ring"
      />

      {/* Value */}
      <Input
        value={row.value}
        onChange={(e) => onChange({ value: e.target.value })}
        placeholder={valuePlaceholder}
        aria-label={valuePlaceholder}
        className="h-7 cursor-text border-transparent bg-transparent px-2 font-mono text-xs shadow-none hover:border-border focus:border-ring"
      />

      {/* Description (optional) */}
      {showDescription && (
        <Input
          value={row.description ?? ""}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="description"
          aria-label="description"
          className="h-7 cursor-text border-transparent bg-transparent px-2 text-xs shadow-none hover:border-border focus:border-ring"
        />
      )}

      {/* Remove — hidden on trailing row */}
      {!isTrailing ? (
        <button
          type="button"
          onClick={onRemove}
          className="grid h-5 w-5 cursor-pointer place-items-center rounded-sm text-muted-foreground/40 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover/row:opacity-100"
          title="Remove row"
          aria-label="Remove row"
        >
          <XIcon className="size-3" strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
    </div>
  );
}
