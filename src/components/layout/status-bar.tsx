import { MockPanel } from "@/components/mock/mock-panel";
import { useRequest } from "@/stores/request-store";

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "0.0.1";

export function StatusBar() {
  const loading = useRequest((s) => s.loading);

  return (
    <footer className="relative flex h-6 shrink-0 items-center justify-between gap-3 border-border border-t bg-card px-3 font-mono text-[10px] text-muted-foreground nums-tabular">
      <div aria-hidden="true" className="divider-fade-h absolute inset-x-0 top-0" />
      <div className="flex min-w-0 items-center gap-3">
        <MockPanel />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {loading && (
          <span className="flex items-center gap-1.5 text-[color:var(--color-primary)]">
            <span
              aria-hidden="true"
              className="relative inline-flex size-1.5 rounded-full bg-[color:var(--color-primary)]"
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 animate-ping rounded-full bg-[color:var(--color-primary)] opacity-60"
              />
            </span>
            <span>Sending…</span>
          </span>
        )}
        <span title={`Lancer version ${APP_VERSION}`} className="cursor-help">
          v{APP_VERSION}
        </span>
      </div>
    </footer>
  );
}
