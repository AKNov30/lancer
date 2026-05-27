import { CheckIcon, GlobeIcon, LockKeyholeIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { type AppSettings, getSettings, type ProxyConfig, setSettings } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const EMPTY: ProxyConfig = {
  enabled: false,
  url: "",
  username: "",
  password: "",
  noProxy: "",
};

/**
 * Proxy configuration UI inside the Settings sheet.
 *
 * Values are loaded from disk on mount and saved on the explicit "Save"
 * button — not on every keystroke — so users can iterate on a URL without
 * triggering a partial rebuild of the underlying reqwest::Client per char.
 */
export function SettingsProxy() {
  const [draft, setDraft] = useState<ProxyConfig>(EMPTY);
  const [loaded, setLoaded] = useState<ProxyConfig>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from disk on mount
  useEffect(() => {
    void (async () => {
      try {
        const s = await getSettings();
        setDraft(s.proxy);
        setLoaded(s.proxy);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(loaded);

  function update<K extends keyof ProxyConfig>(key: K, value: ProxyConfig[K]) {
    setDraft({ ...draft, [key]: value });
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const next: AppSettings = { proxy: draft };
      await setSettings(next);
      setLoaded(draft);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Enable toggle */}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <GlobeIcon
            className="size-3.5 text-muted-foreground"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <Label className="text-xs">Route requests through a proxy</Label>
        </div>
        <Switch
          checked={draft.enabled}
          onCheckedChange={(v) => update("enabled", v)}
          title={draft.enabled ? "Disable proxy" : "Enable proxy"}
        />
      </div>

      {/* Proxy URL */}
      <div className={cn("flex flex-col gap-1.5", !draft.enabled && "opacity-50")}>
        <Label htmlFor="proxy-url" className="text-xs">
          Proxy URL
        </Label>
        <Input
          id="proxy-url"
          value={draft.url}
          onChange={(e) => update("url", e.target.value)}
          placeholder="http://proxy.corp.local:8080  or  socks5://1.2.3.4:1080"
          disabled={!draft.enabled}
          className="h-8 cursor-text font-mono text-xs"
        />
        <p className="text-muted-foreground/70 text-[11px]">
          Schemes supported: <code className="font-mono">http://</code> ·{" "}
          <code className="font-mono">https://</code> · <code className="font-mono">socks5://</code>
        </p>
      </div>

      {/* Basic auth */}
      <div className={cn("grid grid-cols-2 gap-2", !draft.enabled && "opacity-50")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="proxy-user" className="flex items-center gap-1.5 text-xs">
            <LockKeyholeIcon className="size-3" strokeWidth={1.75} aria-hidden="true" />
            Username
          </Label>
          <Input
            id="proxy-user"
            value={draft.username}
            onChange={(e) => update("username", e.target.value)}
            placeholder="(optional)"
            disabled={!draft.enabled}
            className="h-8 cursor-text font-mono text-xs"
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="proxy-pass" className="text-xs">
            Password
          </Label>
          <Input
            id="proxy-pass"
            type="password"
            value={draft.password}
            onChange={(e) => update("password", e.target.value)}
            placeholder="(optional)"
            disabled={!draft.enabled}
            className="h-8 cursor-text font-mono text-xs"
            autoComplete="off"
          />
        </div>
      </div>

      {/* No-proxy list */}
      <div className={cn("flex flex-col gap-1.5", !draft.enabled && "opacity-50")}>
        <Label htmlFor="proxy-bypass" className="text-xs">
          Bypass hosts
        </Label>
        <Input
          id="proxy-bypass"
          value={draft.noProxy}
          onChange={(e) => update("noProxy", e.target.value)}
          placeholder="localhost, 127.0.0.1, *.internal"
          disabled={!draft.enabled}
          className="h-8 cursor-text font-mono text-xs"
        />
        <p className="text-muted-foreground/70 text-[11px]">
          Comma-separated. Requests to these hosts go direct.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-destructive text-xs">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-muted-foreground/70 text-[11px] italic">
          Restart Lancer for proxy changes to apply.
        </p>
        <div className="flex items-center gap-2">
          {savedFlash && (
            <span className="flex items-center gap-1 text-[color:var(--color-success)] text-xs">
              <CheckIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              Saved
            </span>
          )}
          <Button
            size="sm"
            onClick={save}
            disabled={!dirty || saving}
            className="h-7 cursor-pointer text-xs disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save proxy"}
          </Button>
        </div>
      </div>
    </div>
  );
}
