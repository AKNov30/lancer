import { ClockIcon, FilePlusIcon, PinIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { methodColor } from "@/lib/method-color";
import { statusColor } from "@/lib/status-color";
import { isMethod, type Method } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useHistory } from "@/stores/history-store";
import { useTabs } from "@/stores/request-store";
import { useUi } from "@/stores/ui-store";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function dateBucket(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const isSameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isSameDay) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return "Yesterday";
  }

  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function HistorySheet() {
  const { entries, loading, query, load, search, togglePin, clear } = useHistory();
  const newTab = useTabs((s) => s.newTab);
  const tabsApi = useTabs;
  const [searchInput, setSearchInput] = useState("");
  const [open, setOpen] = useState(false);

  /**
   * Promote a history entry to a fresh scratch tab. Headers from the entry's
   * stored JSON are restored; sensitive ones (auth/cookie) were already
   * redacted by the history layer, so this is safe to surface as-is.
   */
  function saveAsRequest(entry: { method: string; url: string; headersJson: string }) {
    let headers: { enabled: boolean; key: string; value: string }[] = [];
    try {
      const parsed = JSON.parse(entry.headersJson) as Array<[string, string]>;
      if (Array.isArray(parsed)) {
        headers = parsed.map(([k, v]) => ({ enabled: true, key: k, value: v }));
      }
    } catch {
      /* fall back to empty headers */
    }
    const method: Method = isMethod(entry.method) ? entry.method : "GET";
    const id = newTab({ name: "From history" });
    tabsApi.setState((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              request: { ...t.request, url: entry.url, method, headers },
              dirty: true,
            }
          : t,
      ),
    }));
    setOpen(false);
  }

  // Command palette can request this sheet to open. We watch the pending
  // action and forward it to our internal state, then clear so a repeat
  // works.
  const pendingAction = useUi((s) => s.pendingAction);
  const clearPendingAction = useUi((s) => s.clearPendingAction);
  useEffect(() => {
    if (pendingAction?.type === "open-history") {
      setOpen(true);
      void load();
      clearPendingAction();
    }
  }, [pendingAction, clearPendingAction, load]);

  // Debounce search input → store query
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== query) {
        void search(searchInput);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [searchInput, query, search]);

  // Group entries — pinned first as one group, then by date bucket
  const groups = useMemo(() => {
    const pinned = entries.filter((e) => e.pinned);
    const unpinned = entries.filter((e) => !e.pinned);
    const map = new Map<string, typeof entries>();
    if (pinned.length > 0) map.set("Pinned", pinned);
    for (const entry of unpinned) {
      const bucket = dateBucket(entry.timestamp);
      const arr = map.get(bucket) ?? [];
      arr.push(entry);
      map.set(bucket, arr);
    }
    return Array.from(map.entries());
  }, [entries]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 cursor-pointer p-0 transition-transform duration-200 hover:scale-110 active:scale-95"
          aria-label="Request history"
          title="Request history"
        >
          <ClockIcon className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[560px] sm:max-w-[560px]">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <SheetTitle>Request history</SheetTitle>
              <SheetDescription>
                {entries.length} {entries.length === 1 ? "request" : "requests"} · sensitive headers
                redacted
              </SheetDescription>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 cursor-pointer gap-1 px-2 text-destructive text-xs hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed"
                  disabled={entries.length === 0}
                >
                  <Trash2Icon className="size-3" strokeWidth={1.75} aria-hidden="true" />
                  Clear
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear history?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all {entries.length} history entries (pinned and
                    unpinned). This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" size="sm" onClick={clear}>
                    Clear all
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {/* Search input — debounced 200ms */}
          <div className="relative mt-2">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground/60"
              strokeWidth={1.75}
            />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search URL or method…"
              className="h-8 cursor-text border-border/60 pl-8 pr-8 font-mono text-xs shadow-none focus:shadow-[var(--shadow-glow)]"
              aria-label="Search history"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute top-1/2 right-2 grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded-sm text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Clear search"
                title="Clear search"
              >
                <XIcon className="size-3" strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
          </div>
        </SheetHeader>

        <SheetBody className="px-3">
          {loading && entries.length === 0 && (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              Loading…
            </div>
          )}

          {!loading && entries.length === 0 && !query && (
            <div className="bg-mesh-primary flex flex-col items-center justify-center gap-2 py-16 text-center">
              <div className="grid size-12 place-items-center rounded-full bg-card shadow-sm ring-1 ring-border">
                <ClockIcon
                  className="size-5 text-muted-foreground/50"
                  strokeWidth={1.25}
                  aria-hidden="true"
                />
              </div>
              <p className="font-medium text-foreground text-sm">No requests yet</p>
              <p className="max-w-[32ch] text-muted-foreground/70 text-xs">
                Send your first request from the editor and it will appear here.
              </p>
            </div>
          )}

          {!loading && entries.length === 0 && query && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <SearchIcon
                className="size-6 text-muted-foreground/40"
                strokeWidth={1.25}
                aria-hidden="true"
              />
              <p className="text-muted-foreground text-sm">No matches for &ldquo;{query}&rdquo;</p>
            </div>
          )}

          {groups.map(([bucket, rows], gIdx) => (
            <div key={bucket} className={cn(gIdx > 0 && "mt-4")}>
              <h4 className="sticky top-0 z-10 -mx-3 mb-2 flex items-center gap-1.5 bg-background/80 px-3 py-1 font-mono font-semibold text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase backdrop-blur">
                {bucket === "Pinned" && (
                  <PinIcon
                    className="size-3 text-[color:var(--color-warning)]"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                )}
                {bucket}
                <span className="ml-auto nums-tabular text-muted-foreground/40">{rows.length}</span>
              </h4>
              <ul className="space-y-1.5">
                {rows.map((entry, idx) => {
                  const methodC = methodColor(entry.method);
                  const statusC = statusColor(entry.status);
                  return (
                    <li key={entry.id}>
                      <div
                        className={cn(
                          "group flex flex-col gap-1 rounded-md border bg-card/40 px-3 py-2",
                          "transition-all duration-150 ease-out",
                          "hover:-translate-y-px hover:bg-card hover:shadow-sm",
                          "fade-in-0 slide-in-from-top-1 animate-in",
                          entry.pinned
                            ? "border-[color:var(--color-warning)]/40 hover:border-[color:var(--color-warning)]/60"
                            : "border-border/60 hover:border-primary/40",
                        )}
                        style={{ animationDelay: `${Math.min(idx, 10) * 25}ms` }}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="w-12 shrink-0 rounded-[3px] border px-1 py-px text-center font-mono font-semibold text-[10px] uppercase tracking-wider nums-tabular"
                            style={{
                              color: methodC,
                              backgroundColor: `color-mix(in oklch, ${methodC} 12%, transparent)`,
                              borderColor: `color-mix(in oklch, ${methodC} 25%, transparent)`,
                            }}
                          >
                            {entry.method}
                          </span>
                          <span
                            className="inline-flex shrink-0 items-center rounded border px-1.5 py-px font-mono font-semibold text-[11px] nums-tabular"
                            style={{
                              color: statusC,
                              backgroundColor: `color-mix(in oklch, ${statusC} 12%, transparent)`,
                              borderColor: `color-mix(in oklch, ${statusC} 25%, transparent)`,
                            }}
                          >
                            {entry.status}
                          </span>
                          <span
                            className="min-w-0 flex-1 truncate font-mono text-foreground text-xs"
                            title={entry.url}
                          >
                            {entry.url}
                          </span>
                          <button
                            type="button"
                            onClick={() => saveAsRequest(entry)}
                            className="grid size-6 cursor-pointer place-items-center rounded-sm text-muted-foreground/40 opacity-0 transition-all hover:bg-accent hover:text-primary group-hover:opacity-100"
                            aria-label="Save as request"
                            title="Save as new request (opens new tab)"
                          >
                            <FilePlusIcon
                              className="size-3"
                              strokeWidth={1.75}
                              aria-hidden="true"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => void togglePin(entry.id, entry.pinned)}
                            className={cn(
                              "grid size-6 cursor-pointer place-items-center rounded-sm transition-all",
                              "hover:bg-accent",
                              entry.pinned
                                ? "text-[color:var(--color-warning)]"
                                : "text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-[color:var(--color-warning)]",
                            )}
                            aria-label={entry.pinned ? "Unpin" : "Pin"}
                            title={entry.pinned ? "Unpin" : "Pin to top"}
                          >
                            <PinIcon
                              className={cn("size-3", entry.pinned && "fill-current")}
                              strokeWidth={1.75}
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 pl-[60px] text-muted-foreground text-[11px] nums-tabular">
                          <span>{formatTime(entry.timestamp)}</span>
                          <span aria-hidden="true" className="text-muted-foreground/30">
                            ·
                          </span>
                          <span>{entry.elapsedMs} ms</span>
                          <span aria-hidden="true" className="text-muted-foreground/30">
                            ·
                          </span>
                          <span>{formatBytes(entry.sizeBytes)}</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
