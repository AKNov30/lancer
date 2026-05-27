import {
  MonitorIcon,
  MoonIcon,
  MoonStarIcon,
  PanelBottomIcon,
  PanelRightIcon,
  SettingsIcon,
  SunIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { isTelemetryEnabled, setTelemetryEnabled } from "@/lib/telemetry";
import { cn } from "@/lib/utils";
import { type ResponseOrientation, useLayout } from "@/stores/layout-store";
import { type Theme, useTheme } from "@/stores/theme-store";
import { useUi } from "@/stores/ui-store";
import { SettingsProxy } from "./settings-proxy";
import { SettingsUpdate } from "./settings-update";

const THEME_OPTIONS: Array<{
  value: Theme;
  label: string;
  icon: typeof SunIcon;
  /** Preview colours rendered as a 3-bar swatch on each theme card */
  preview: { bg: string; surface: string; accent: string };
}> = [
  {
    value: "light",
    label: "Light",
    icon: SunIcon,
    preview: { bg: "oklch(0.99 0 0)", surface: "oklch(0.94 0 0)", accent: "oklch(0.66 0.18 70)" },
  },
  {
    value: "dark",
    label: "Dark",
    icon: MoonIcon,
    preview: {
      bg: "oklch(0.13 0.005 240)",
      surface: "oklch(0.245 0.005 240)",
      accent: "oklch(0.86 0.17 92)",
    },
  },
  {
    value: "dark-soft",
    label: "Soft Dark",
    icon: MoonStarIcon,
    preview: {
      bg: "oklch(0.21 0.008 240)",
      surface: "oklch(0.32 0.008 240)",
      accent: "oklch(0.86 0.17 92)",
    },
  },
  {
    value: "system",
    label: "System",
    icon: MonitorIcon,
    preview: {
      bg: "linear-gradient(135deg, oklch(0.99 0 0) 50%, oklch(0.13 0.005 240) 50%)",
      surface: "oklch(0.5 0 0)",
      accent: "oklch(0.66 0.18 70)",
    },
  },
];

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card/50 p-4 shadow-xs">
      <h3 className="font-semibold text-foreground text-sm">{title}</h3>
      {description && <p className="mt-0.5 text-muted-foreground text-xs">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const ORIENTATION_OPTIONS: Array<{
  value: ResponseOrientation;
  label: string;
  icon: typeof PanelRightIcon;
  hint: string;
}> = [
  {
    value: "right",
    label: "Response on right",
    icon: PanelRightIcon,
    hint: "Side-by-side · best for wide screens",
  },
  {
    value: "bottom",
    label: "Response on bottom",
    icon: PanelBottomIcon,
    hint: "Stacked · best for laptop displays",
  },
];

export function SettingsSheet() {
  const [enabled, setEnabled] = useState(isTelemetryEnabled());
  const [restartHint, setRestartHint] = useState(false);
  const [open, setOpen] = useState(false);
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  const orientation = useLayout((s) => s.responseOrientation);
  const setOrientation = useLayout((s) => s.setResponseOrientation);

  // Command palette → "Open settings" channel.
  const pendingAction = useUi((s) => s.pendingAction);
  const clearPendingAction = useUi((s) => s.clearPendingAction);
  useEffect(() => {
    if (pendingAction?.type === "open-settings") {
      setOpen(true);
      clearPendingAction();
    }
  }, [pendingAction, clearPendingAction]);

  function toggleTelemetry(next: boolean) {
    setTelemetryEnabled(next);
    setEnabled(next);
    setRestartHint(true);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 cursor-pointer p-0 transition-transform duration-200 hover:scale-110 active:scale-95"
          aria-label="Settings"
          title="Settings"
        >
          <SettingsIcon
            className="size-4 transition-transform duration-300 hover:rotate-45"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[560px] sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>Privacy, updates, and about.</SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-4">
          <SettingsCard title="Appearance" description="Choose how Lancer looks.">
            <Label className="mb-2 block text-xs">Theme</Label>
            <div className="grid grid-cols-2 gap-2">
              {THEME_OPTIONS.map(({ value, label, icon: Icon, preview }) => {
                const active = theme === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTheme(value)}
                    className={cn(
                      "group relative flex cursor-pointer flex-col items-stretch gap-2 rounded-md border p-2 text-left transition-all duration-200",
                      "hover:-translate-y-px hover:border-primary/50 hover:shadow-md active:scale-[0.98] active:translate-y-0",
                      active
                        ? "border-primary bg-primary/5 shadow-[var(--shadow-glow)]"
                        : "border-border bg-card",
                    )}
                    title={`Switch to ${label} theme`}
                    aria-pressed={active}
                  >
                    {/* Mini preview swatch */}
                    <div
                      className="h-10 w-full overflow-hidden rounded-sm border border-border/60"
                      style={{ background: preview.bg }}
                    >
                      <div
                        className="ml-1.5 mt-1.5 h-1.5 w-6 rounded-full"
                        style={{ background: preview.surface }}
                      />
                      <div
                        className="ml-1.5 mt-1 h-1.5 w-4 rounded-full"
                        style={{ background: preview.accent }}
                      />
                    </div>
                    <div className="flex items-center justify-center gap-1.5 text-xs">
                      <Icon
                        className={cn(
                          "size-3.5 transition-transform duration-300",
                          "group-hover:scale-110 group-hover:rotate-12",
                        )}
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <span className="font-medium">{label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-muted-foreground text-xs">
              System follows your OS preference automatically.
            </p>
          </SettingsCard>

          <SettingsCard title="Layout" description="Where the Response panel sits.">
            <div className="grid grid-cols-2 gap-2">
              {ORIENTATION_OPTIONS.map(({ value, label, icon: Icon, hint }) => {
                const active = orientation === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setOrientation(value)}
                    aria-pressed={active}
                    className={cn(
                      "group flex cursor-pointer flex-col items-start gap-2 rounded-md border p-3 text-left transition-all duration-200",
                      "hover:-translate-y-px hover:border-primary/50 hover:shadow-md active:scale-[0.98] active:translate-y-0",
                      active
                        ? "border-primary bg-primary/5 shadow-[var(--shadow-glow)]"
                        : "border-border bg-card",
                    )}
                    title={hint}
                  >
                    <Icon
                      className={cn(
                        "size-4 transition-transform duration-300 group-hover:scale-110",
                        active ? "text-primary" : "text-muted-foreground",
                      )}
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <div>
                      <div className="font-medium text-xs">{label}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </SettingsCard>

          <SettingsCard title="Updates" description="Check for newer Lancer releases.">
            <SettingsUpdate />
          </SettingsCard>

          <SettingsCard
            title="Network proxy"
            description="Route all HTTP requests through a corporate or local proxy. Supports HTTP, HTTPS, and SOCKS5."
          >
            <SettingsProxy />
          </SettingsCard>

          <SettingsCard
            title="Privacy"
            description="Anonymised crash reports help us fix bugs. Off by default."
          >
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="crash-reports" className="text-xs">
                Send crash reports
                <span className="mt-0.5 block font-normal text-muted-foreground">
                  Header values containing tokens/passwords are redacted before sending.
                </span>
              </Label>
              {/* Pill toggle: looks like a switch, not a CTA */}
              <Switch
                id="crash-reports"
                checked={enabled}
                onCheckedChange={toggleTelemetry}
                title={enabled ? "Click to disable" : "Click to enable"}
              />
            </div>
            {restartHint && (
              <p className="mt-2 text-muted-foreground text-xs italic">
                Restart Lancer for the change to take effect.
              </p>
            )}
          </SettingsCard>

          <SettingsCard title="About">
            <dl className="grid grid-cols-[100px_1fr] gap-x-4 gap-y-1.5 font-mono text-xs">
              <dt className="text-muted-foreground">Version</dt>
              <dd className="nums-tabular">{import.meta.env.VITE_APP_VERSION ?? "dev"}</dd>
              <dt className="text-muted-foreground">License</dt>
              <dd className="font-sans">FSL-1.1 (free core) → MIT @ Year 2</dd>
            </dl>
          </SettingsCard>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
