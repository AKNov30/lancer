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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useHistory } from "@/stores/history-store";

function statusColor(status: number): string {
  if (status >= 500) return "bg-red-500/15 text-red-600 dark:text-red-400";
  if (status >= 400) return "bg-orange-500/15 text-orange-600 dark:text-orange-400";
  if (status >= 300) return "bg-yellow-500/15 text-yellow-600 dark:text-yellow-600";
  if (status >= 200) return "bg-green-500/15 text-green-700 dark:text-green-400";
  return "bg-muted text-muted-foreground";
}

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

export function HistorySheet() {
  const { entries, loading, load, clear } = useHistory();

  return (
    <Sheet onOpenChange={(open) => open && load()}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
          History
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-[520px] flex-col gap-0 p-0 sm:max-w-[520px]">
        <SheetHeader className="border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle className="text-sm">Request History</SheetTitle>
              <SheetDescription className="text-xs">
                Last {entries.length} requests — sensitive headers redacted
              </SheetDescription>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                  disabled={entries.length === 0}
                >
                  Clear all
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear history?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all {entries.length} history entries. This action
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" size="sm" onClick={clear}>
                    Clear
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              Loading…
            </div>
          )}
          {!loading && entries.length === 0 && (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              No requests yet — send one to see it here.
            </div>
          )}
          {!loading && entries.length > 0 && (
            <ul className="divide-y divide-border">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-col gap-1 px-4 py-2.5 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-muted-foreground w-12 shrink-0">
                      {entry.method}
                    </span>
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${statusColor(entry.status)}`}
                    >
                      {entry.status}
                    </span>
                    <span className="truncate font-mono text-xs text-foreground flex-1 min-w-0">
                      {entry.url}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 pl-14 text-muted-foreground text-xs">
                    <span>{formatTime(entry.timestamp)}</span>
                    <span>{entry.elapsedMs} ms</span>
                    <span>{formatBytes(entry.sizeBytes)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
