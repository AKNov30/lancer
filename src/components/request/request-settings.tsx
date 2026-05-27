import { ClockIcon, RefreshCwIcon, ShieldAlertIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useRequest } from "@/stores/request-store";

/**
 * Per-request HTTP overrides — timeout, redirect policy, TLS verification.
 * Every value is optional: leaving fields blank uses the app default
 * (30s timeout, follow up to 10 redirects, verify TLS).
 */
export function RequestSettings() {
  const options = useRequest((s) => s.request.options);
  const setOptions = useRequest((s) => s.setOptions);

  function update<K extends keyof typeof options>(key: K, value: (typeof options)[K]) {
    setOptions({ ...options, [key]: value });
  }

  const insecureOn = options.insecureSkipVerify === true;
  const redirectsOff = options.followRedirects === false;

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="grid w-full gap-4">
        {/* Timeout */}
        <SettingRow
          icon={ClockIcon}
          title="Request timeout"
          hint="Maximum time to wait for the response. Leave empty for the default (30 seconds)."
        >
          <div className="flex items-center gap-2">
            <Input
              id="opt-timeout"
              type="number"
              min={1}
              placeholder="30000"
              value={options.timeoutMs ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                update("timeoutMs", v === "" ? null : Number(v));
              }}
              className="h-8 w-32 cursor-text font-mono nums-tabular text-xs"
            />
            <span className="text-muted-foreground text-xs">ms</span>
            {options.timeoutMs != null && (
              <button
                type="button"
                onClick={() => update("timeoutMs", null)}
                className="cursor-pointer text-[10px] text-muted-foreground/60 hover:text-foreground"
              >
                reset to default
              </button>
            )}
          </div>
        </SettingRow>

        {/* Follow redirects */}
        <SettingRow
          icon={RefreshCwIcon}
          title="Follow redirects"
          hint="When enabled, Lancer follows HTTP 3xx redirects automatically. Disable to inspect the Location header on the original response."
        >
          <div className="flex flex-col gap-2">
            <ToggleSwitch
              checked={!redirectsOff}
              onChange={(v) => update("followRedirects", v ? null : false)}
              label={redirectsOff ? "Off" : "On (up to 10)"}
            />
            {!redirectsOff && (
              <div className="flex items-center gap-2 text-xs">
                <Label htmlFor="opt-max-redirects" className="text-muted-foreground">
                  Max redirects
                </Label>
                <Input
                  id="opt-max-redirects"
                  type="number"
                  min={1}
                  max={50}
                  placeholder="10"
                  value={options.maxRedirects ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    update("maxRedirects", v === "" ? null : Number(v));
                  }}
                  className="h-7 w-20 cursor-text font-mono nums-tabular text-xs"
                />
              </div>
            )}
          </div>
        </SettingRow>

        {/* SSL verification */}
        <SettingRow
          icon={ShieldAlertIcon}
          title="TLS certificate verification"
          hint="When disabled, Lancer accepts ANY certificate — self-signed, expired, wrong host. Use only for local development or trusted internal endpoints."
          danger={insecureOn}
        >
          <ToggleSwitch
            checked={insecureOn}
            onChange={(v) => update("insecureSkipVerify", v ? true : null)}
            label={insecureOn ? "Skip verification (insecure)" : "Verify (default)"}
            danger={insecureOn}
          />
        </SettingRow>
      </div>
    </div>
  );
}

interface SettingRowProps {
  icon: typeof ClockIcon;
  title: string;
  hint?: string;
  danger?: boolean;
  children: React.ReactNode;
}

function SettingRow({ icon: Icon, title, hint, danger, children }: SettingRowProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-card/40 p-4 shadow-xs transition-colors",
        danger ? "border-destructive/40 bg-destructive/5" : "border-border/60",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md border",
            danger
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-border/60 bg-card text-muted-foreground",
          )}
        >
          <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h4
            className={cn("font-semibold text-sm", danger ? "text-destructive" : "text-foreground")}
          >
            {title}
          </h4>
          {hint && <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">{hint}</p>}
        </div>
      </div>
      <div className="ml-11">{children}</div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label,
  danger,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        variant={danger ? "danger" : "default"}
        title={`Click to ${checked ? "disable" : "enable"}`}
      />
      <span
        className={cn(
          "font-medium text-xs",
          danger && checked ? "text-destructive" : "text-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}
