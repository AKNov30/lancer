import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { HistorySheet } from "@/components/history/history-sheet";
import { EnvSwitcher } from "@/components/request/env-switcher";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { type Theme, useTheme } from "@/stores/theme-store";
import { useWorkspace } from "@/stores/workspace-store";

const NEXT_THEME: Record<Theme, Theme> = {
  light: "dark",
  dark: "system",
  system: "light",
};

function ThemeToggle() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);

  const Icon = theme === "light" ? SunIcon : theme === "dark" ? MoonIcon : MonitorIcon;
  const label =
    theme === "light"
      ? "Light theme — click to switch to Dark"
      : theme === "dark"
        ? "Dark theme — click to switch to System"
        : "System theme — click to switch to Light";

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 w-7 p-0"
      aria-label={label}
      title={label}
      onClick={() => setTheme(NEXT_THEME[theme])}
    >
      <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
    </Button>
  );
}

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
        <ThemeToggle />
        <HistorySheet />
        <SettingsSheet />
      </div>
    </header>
  );
}
