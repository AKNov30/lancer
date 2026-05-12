import { useState } from "react";
import { useMock } from "@/stores/mock-store";
import { MockConfigDialog } from "./mock-config-dialog";

/**
 * Compact mock status pill — designed to live inside the global StatusBar.
 * Clickable: running → click to stop, off → click to open config dialog.
 */
export function MockPanel() {
  const running = useMock((s) => s.running);
  const port = useMock((s) => s.port);
  const error = useMock((s) => s.error);
  const stop = useMock((s) => s.stop);

  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      {running ? (
        <button
          type="button"
          onClick={() => void stop()}
          title="Click to stop the local mock server"
          className="flex items-center gap-1.5 hover:text-foreground"
        >
          <span className="size-1.5 rounded-full bg-[color:var(--color-success)]" />
          <span>Mock localhost:{port}</span>
          <span className="text-muted-foreground/50 hover:text-destructive">· stop</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          title="Start a mock server from an OpenAPI spec"
          className="flex items-center gap-1.5 hover:text-foreground"
        >
          <span className="size-1.5 rounded-full bg-muted-foreground/30" />
          <span>Mock off</span>
          <span className="text-muted-foreground/50 hover:text-foreground">· start</span>
        </button>
      )}

      {error && (
        <span className="max-w-[40ch] truncate text-destructive" title={error}>
          ! {error}
        </span>
      )}

      <MockConfigDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
