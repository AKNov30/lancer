import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useMock } from "@/stores/mock-store";
import { MockConfigDialog } from "./mock-config-dialog";

export function MockPanel() {
  const running = useMock((s) => s.running);
  const port = useMock((s) => s.port);
  const error = useMock((s) => s.error);
  const stop = useMock((s) => s.stop);

  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="flex items-center justify-end gap-2 border-border border-t bg-card px-3 py-1 text-xs">
      {running ? (
        <>
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-green-500" />
            <span className="font-medium">Mock · localhost:{port}</span>
          </span>
          <Button size="xs" variant="ghost" onClick={() => void stop()}>
            Stop
          </Button>
        </>
      ) : (
        <>
          <span className="text-muted-foreground">Mock off</span>
          <Button size="xs" variant="ghost" onClick={() => setDialogOpen(true)}>
            Start mock…
          </Button>
        </>
      )}

      {error && (
        <span className="truncate text-destructive" title={error}>
          {error}
        </span>
      )}

      <MockConfigDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
