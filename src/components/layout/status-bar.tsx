import { MockPanel } from "@/components/mock/mock-panel";
import { useRequest } from "@/stores/request-store";

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "0.0.1";

export function StatusBar() {
  const loading = useRequest((s) => s.loading);

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between gap-3 border-border border-t bg-card px-3 font-mono text-[10px] text-muted-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <MockPanel />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {loading && (
          <span className="flex items-center gap-1 text-[color:var(--color-primary)]">
            <span className="size-1.5 animate-pulse rounded-full bg-[color:var(--color-primary)]" />
            Sending…
          </span>
        )}
        <span>v{APP_VERSION}</span>
      </div>
    </footer>
  );
}
