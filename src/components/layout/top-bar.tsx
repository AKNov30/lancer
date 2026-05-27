import { MonitorIcon, MoonIcon, MoonStarIcon, SunIcon } from "lucide-react";
import { HistorySheet } from "@/components/history/history-sheet";
import { EnvSwitcher } from "@/components/request/env-switcher";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { type Theme, useTheme } from "@/stores/theme-store";
import { useWorkspace } from "@/stores/workspace-store";
import { WindowControls } from "./window-controls";
import { WorkspaceSwitcher } from "./workspace-switcher";

const NEXT_THEME: Record<Theme, Theme> = {
  light: "dark",
  dark: "dark-soft",
  "dark-soft": "system",
  system: "light",
};

const THEME_INFO: Record<Theme, { icon: typeof SunIcon; label: string; next: string }> = {
  light: { icon: SunIcon, label: "Light", next: "Dark" },
  dark: { icon: MoonIcon, label: "Dark", next: "Soft Dark" },
  "dark-soft": { icon: MoonStarIcon, label: "Soft Dark", next: "System" },
  system: { icon: MonitorIcon, label: "System", next: "Light" },
};

function ThemeToggle() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);

  const info = THEME_INFO[theme];
  const Icon = info.icon;
  const label = `${info.label} theme — click to switch to ${info.next}`;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="group h-7 w-7 cursor-pointer p-0 transition-transform duration-200 hover:scale-110 active:scale-95"
      aria-label={label}
      title={label}
      onClick={() => setTheme(NEXT_THEME[theme])}
    >
      <Icon
        key={theme}
        className="size-4 transition-transform duration-300 animate-in fade-in-0 spin-in-90"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </Button>
  );
}

export function TopBar() {
  const rootPath = useWorkspace((s) => s.rootPath);

  return (
    <header className="surface-glass relative flex h-10 shrink-0 items-stretch border-b border-transparent">
      {/* Gradient hairline divider at the bottom — fades to edges */}
      <div aria-hidden="true" className="divider-fade-h absolute inset-x-0 bottom-0" />

      {/* Left: brand + workspace (own drag region) */}
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2 pr-2 pl-3">
        <span
          aria-hidden="true"
          className="brand-chevron pointer-events-none animate-lancer-pulse select-none font-display text-base italic"
        >
          &rsaquo;
        </span>
        <span
          data-tauri-drag-region
          className="pointer-events-none select-none font-display text-base italic"
        >
          Lancer
        </span>
        <span
          className="pointer-events-none select-none rounded-full border border-primary/30 bg-primary/10 px-1.5 py-px font-mono font-medium text-[10px] text-primary nums-tabular shadow-xs"
          title={`Lancer v${import.meta.env.VITE_APP_VERSION ?? "dev"} · built ${import.meta.env.VITE_BUILD_TIME ?? "now"}`}
        >
          v{import.meta.env.VITE_APP_VERSION ?? "dev"}
        </span>
        {rootPath && (
          <>
            <span aria-hidden="true" className="pointer-events-none text-muted-foreground/40">
              ·
            </span>
            {/* Clickable workspace name with recent dropdown. Sits outside
                the drag-region so the button can be clicked. */}
            <div className="pointer-events-auto min-w-0" data-tauri-drag-region={false}>
              <WorkspaceSwitcher />
            </div>
          </>
        )}
      </div>

      {/* Right: global controls */}
      <div className="flex shrink-0 items-center gap-1 px-2">
        <EnvSwitcher />
        <ThemeToggle />
        <HistorySheet />
        <SettingsSheet />
      </div>

      {/* Window controls — separated so close-hover red doesn't touch other buttons */}
      <WindowControls />
    </header>
  );
}
