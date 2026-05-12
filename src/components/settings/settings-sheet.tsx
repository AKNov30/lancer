import { SettingsIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { isTelemetryEnabled, setTelemetryEnabled } from "@/lib/telemetry";
import { SettingsUpdate } from "./settings-update";

export function SettingsSheet() {
  const [enabled, setEnabled] = useState(isTelemetryEnabled());
  const [restartHint, setRestartHint] = useState(false);

  function toggleTelemetry() {
    const next = !enabled;
    setTelemetryEnabled(next);
    setEnabled(next);
    setRestartHint(true);
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          aria-label="Settings"
          title="Settings"
        >
          <SettingsIcon className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[480px] sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>Privacy, updates, and about.</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Updates */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Updates</h3>
            <SettingsUpdate />
          </section>

          <Separator />

          {/* Privacy */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Privacy</h3>
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label htmlFor="crash-reports" className="text-xs">
                  Crash reports
                </Label>
                <p className="text-muted-foreground text-xs">
                  Send anonymised crash reports so we can fix bugs. Disabled by default. Header
                  values containing tokens/passwords are redacted before sending.
                </p>
              </div>
              <Button
                id="crash-reports"
                size="sm"
                variant={enabled ? "default" : "outline"}
                onClick={toggleTelemetry}
              >
                {enabled ? "On" : "Off"}
              </Button>
            </div>
            {restartHint && (
              <p className="mt-2 text-muted-foreground text-xs">
                Restart Lancer for the change to take effect.
              </p>
            )}
          </section>

          <Separator />

          {/* About */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">About</h3>
            <dl className="grid grid-cols-[100px_1fr] gap-1 font-mono text-xs">
              <dt className="text-muted-foreground">Version</dt>
              <dd>{import.meta.env.VITE_APP_VERSION ?? "dev"}</dd>
              <dt className="text-muted-foreground">License</dt>
              <dd>FSL-1.1 (free core) → MIT @ Year 2</dd>
            </dl>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
