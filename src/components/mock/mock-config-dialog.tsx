import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMock } from "@/stores/mock-store";

const DEFAULT_PORT = 8787;

interface MockConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MockConfigDialog({ open, onOpenChange }: MockConfigDialogProps) {
  const start = useMock((s) => s.start);

  const [specPath, setSpecPath] = useState<string | null>(null);
  const [port, setPort] = useState<number>(DEFAULT_PORT);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  async function pickSpecFile() {
    try {
      const picked = await openDialog({
        multiple: false,
        filters: [{ name: "OpenAPI Spec", extensions: ["yaml", "yml", "json"] }],
      });
      if (typeof picked === "string") {
        setSpecPath(picked);
        setStartError(null);
      }
    } catch (e) {
      setStartError(String(e));
    }
  }

  async function handleStart() {
    if (!specPath) return;
    setStarting(true);
    setStartError(null);
    try {
      await start(specPath, port);
      handleClose();
    } catch (e) {
      setStartError(String(e));
    } finally {
      setStarting(false);
    }
  }

  function handleClose() {
    onOpenChange(false);
    setSpecPath(null);
    setPort(DEFAULT_PORT);
    setStartError(null);
    setStarting(false);
  }

  const canStart = Boolean(specPath) && !starting;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start Mock Server</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {/* Spec file picker */}
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">OpenAPI spec (.yaml / .json)</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void pickSpecFile()}>
                Pick file…
              </Button>
              {specPath && (
                <span className="min-w-0 truncate font-mono text-xs" title={specPath}>
                  {specPath.split(/[/\\]/).pop()}
                </span>
              )}
            </div>
          </div>

          {/* Port input */}
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Port</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              className="h-8 w-28 rounded-md border bg-background px-3 text-sm ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-none"
            />
          </div>

          {/* Error */}
          {startError && (
            <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-xs">
              {startError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => void handleStart()} disabled={!canStart}>
            {starting ? "Starting…" : "Start mock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
