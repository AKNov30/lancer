import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpenIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
          <DialogTitle>Start mock server</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Spec file picker */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">OpenAPI spec (.yaml / .json)</Label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void pickSpecFile()}
                className="cursor-pointer gap-1.5"
              >
                <FolderOpenIcon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                Pick file…
              </Button>
              {specPath && (
                <span
                  className="min-w-0 truncate font-mono text-muted-foreground text-xs"
                  title={specPath}
                >
                  {specPath.split(/[/\\]/).pop()}
                </span>
              )}
            </div>
          </div>

          {/* Port input — use shared Input primitive for consistent focus ring */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mock-port" className="text-xs">
              Port
            </Label>
            <Input
              id="mock-port"
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              className="w-32 nums-tabular font-mono text-xs"
            />
          </div>

          {/* Error */}
          {startError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
              <span className="font-medium text-destructive">Failed:</span>
              <span className="break-all font-mono text-muted-foreground">{startError}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} className="cursor-pointer">
            Cancel
          </Button>
          <Button
            onClick={() => void handleStart()}
            disabled={!canStart}
            className="cursor-pointer disabled:cursor-not-allowed"
          >
            {starting ? "Starting…" : "Start mock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
