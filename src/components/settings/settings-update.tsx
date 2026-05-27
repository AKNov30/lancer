import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  // An update exists but has NOT been installed yet — the user must
  // explicitly click "Download & install" before anything is downloaded.
  | { kind: "found"; version: string }
  | { kind: "uptodate" }
  | { kind: "installing"; version: string }
  | { kind: "installed"; version: string }
  | { kind: "error"; message: string };

export function SettingsUpdate() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });
  // Hold the resolved update handle between the check and the explicit
  // download step so the second button can install without re-checking.
  const pendingUpdate = useRef<Update | null>(null);

  async function checkForUpdates() {
    setStatus({ kind: "checking" });
    try {
      const update = await check();
      if (update?.available) {
        // Surface the available version and wait for explicit consent —
        // never download/install automatically.
        pendingUpdate.current = update;
        setStatus({ kind: "found", version: update.version });
      } else {
        pendingUpdate.current = null;
        setStatus({ kind: "uptodate" });
      }
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }

  async function installUpdate() {
    const update = pendingUpdate.current;
    if (!update) return;
    setStatus({ kind: "installing", version: update.version });
    try {
      await update.downloadAndInstall();
      pendingUpdate.current = null;
      setStatus({ kind: "installed", version: update.version });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }

  const busy = status.kind === "checking" || status.kind === "installing";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={status.kind === "found" ? "outline" : "default"}
          onClick={() => void checkForUpdates()}
          disabled={busy}
          className="w-fit cursor-pointer gap-1.5 transition-transform duration-150 hover:-translate-y-px active:scale-[0.98] active:translate-y-0 disabled:cursor-not-allowed disabled:hover:translate-y-0"
        >
          {busy ? (
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCwIcon className="size-3.5" aria-hidden="true" />
          )}
          {status.kind === "found" ? "Check again" : "Check for updates"}
        </Button>

        {/* Two-step UX: a found update only installs after this explicit click. */}
        {status.kind === "found" && (
          <Button
            size="sm"
            onClick={() => void installUpdate()}
            className="w-fit cursor-pointer gap-1.5 transition-transform duration-150 hover:-translate-y-px active:scale-[0.98] active:translate-y-0 disabled:cursor-not-allowed"
          >
            <DownloadIcon className="size-3.5" aria-hidden="true" />
            Download &amp; install
          </Button>
        )}
      </div>

      {/* Status line with icon (no more "idle"/"up to date" debug-style text) */}
      {status.kind !== "idle" && <StatusLine status={status} />}
    </div>
  );
}

function StatusLine({ status }: { status: UpdateStatus }) {
  const map: Record<
    UpdateStatus["kind"],
    { icon: typeof CheckCircle2Icon; color: string; text: string }
  > = {
    idle: { icon: CheckCircle2Icon, color: "var(--color-muted-foreground)", text: "" },
    checking: {
      icon: Loader2Icon,
      color: "var(--color-info)",
      text: "Checking for updates…",
    },
    found: {
      icon: DownloadIcon,
      color: "var(--color-info)",
      text: status.kind === "found" ? `Update available: v${status.version}` : "",
    },
    installed: {
      icon: CheckCircle2Icon,
      color: "var(--color-success)",
      text: status.kind === "installed" ? `Installed v${status.version} — restart to apply` : "",
    },
    uptodate: {
      icon: CheckCircle2Icon,
      color: "var(--color-success)",
      text: "You're up to date",
    },
    installing: {
      icon: DownloadIcon,
      color: "var(--color-info)",
      text: status.kind === "installing" ? `Downloading v${status.version}…` : "",
    },
    error: { icon: AlertCircleIcon, color: "var(--color-destructive)", text: "" },
  };

  const cfg = map[status.kind];
  const Icon = cfg.icon;

  if (status.kind === "error") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
        <AlertCircleIcon
          className="size-3.5 shrink-0 text-destructive"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-destructive">Update check failed</div>
          <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
            {status.message}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs" style={{ color: cfg.color }}>
      <Icon
        className={cn("size-3.5", status.kind === "checking" && "animate-spin")}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span>{cfg.text}</span>
    </div>
  );
}
