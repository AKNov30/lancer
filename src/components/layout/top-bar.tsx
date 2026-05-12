import { HistorySheet } from "@/components/history/history-sheet";
import { EnvSwitcher } from "@/components/request/env-switcher";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { useWorkspace } from "@/stores/workspace-store";

export function TopBar() {
  const rootPath = useWorkspace((s) => s.rootPath);

  return (
    <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-border border-b bg-card px-3">
      {/* Left: brand + workspace */}
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="font-display text-base italic text-[color:var(--color-primary)]"
        >
          &rsaquo;
        </span>
        <span className="font-display text-base italic">Lancer</span>
        {rootPath && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="truncate font-mono text-muted-foreground text-xs" title={rootPath}>
              {rootPath}
            </span>
          </>
        )}
      </div>

      {/* Right: global controls */}
      <div className="flex shrink-0 items-center gap-1">
        <EnvSwitcher />
        <HistorySheet />
        <SettingsSheet />
      </div>
    </header>
  );
}
