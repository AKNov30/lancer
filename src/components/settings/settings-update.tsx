import { check } from "@tauri-apps/plugin-updater";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SettingsUpdate() {
  const [status, setStatus] = useState<string>("idle");
  const [error, setError] = useState<string | null>(null);

  async function checkForUpdates() {
    setStatus("checking");
    setError(null);
    try {
      const update = await check();
      if (update?.available) {
        setStatus(`update available: v${update.version}`);
        await update.downloadAndInstall();
        setStatus("installed; restarting");
      } else {
        setStatus("up to date");
      }
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void checkForUpdates()}>
          Check for updates
        </Button>
        <span className="text-muted-foreground text-xs">{status}</span>
      </div>
      {error && <pre className="text-destructive text-xs">{error}</pre>}
    </div>
  );
}
